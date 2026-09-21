import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createVault,
  currentPeriod,
  ensureReview,
  getReview,
  listDecisions,
  REVIEW_TOOL_DEFS,
  executeReviewTool,
} from "../src/index.ts";
import type { Actor } from "../src/types.ts";

const agent: Actor = { type: "agent", id: "a1", name: "Hermes" };

const VALID_BODY = [
  "## Look-back",
  "look-back body",
  "",
  "## Keep",
  "keep body",
  "",
  "## Change",
  "change body",
  "",
  "## Next-period intent",
  "intent body",
].join("\n");

describe("review tools", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-review-tools-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("1. REVIEW_TOOL_DEFS names are exactly the six tools", () => {
    const names = REVIEW_TOOL_DEFS.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "get_period_pack",
      "get_review",
      "list_reviews",
      "mark_review_done",
      "unlock_review",
      "write_review",
    ]);
  });

  it("2. get_review missing file → error matching /not found/i", async () => {
    const root = path.join(dir, "vault-missing");
    assert.equal((await createVault(root, "Missing")).ok, true);
    const period = currentPeriod("weekly", "monday");
    const result = await executeReviewTool(root, agent, "get_review", {
      cadence: "weekly",
      period,
    });
    assert.ok("error" in result);
    assert.match(String((result as { error: { message: string } }).error.message), /not found/i);
  });

  it("3. ensureReview then get_review / list_reviews; cadence filter", async () => {
    const root = path.join(dir, "vault-list");
    assert.equal((await createVault(root, "List")).ok, true);
    const period = currentPeriod("weekly", "monday");
    assert.equal(
      (await ensureReview(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );

    const got = await executeReviewTool(root, agent, "get_review", {
      cadence: "weekly",
      period,
    });
    assert.equal((got as { review?: { period: string } }).review?.period, period);

    const listed = await executeReviewTool(root, agent, "list_reviews", {});
    const reviews = (listed as { reviews: { cadence: string; period: string }[] }).reviews;
    assert.ok(reviews.some((e) => e.cadence === "weekly" && e.period === period));

    const dailyOnly = await executeReviewTool(root, agent, "list_reviews", {
      cadence: "daily",
    });
    const daily = (dailyOnly as { reviews: { cadence: string }[] }).reviews;
    assert.equal(
      daily.some((e) => e.cadence === "weekly"),
      false,
    );
  });

  it("4. unlocked write_review updates body", async () => {
    const root = path.join(dir, "vault-write");
    assert.equal((await createVault(root, "Write")).ok, true);
    const period = currentPeriod("weekly", "monday");
    assert.equal(
      (await ensureReview(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );

    const body = [
      "## Look-back",
      "agent-look-back",
      "",
      "## Keep",
      "agent-keep",
      "",
      "## Change",
      "agent-change",
      "",
      "## Next-period intent",
      "agent-intent",
    ].join("\n");

    const result = await executeReviewTool(root, agent, "write_review", {
      cadence: "weekly",
      period,
      body,
    });
    assert.equal((result as { review?: { locked: boolean } }).review?.locked, false);
    assert.match(
      String((result as { review?: { bodyMarkdown: string } }).review?.bodyMarkdown),
      /agent-look-back/,
    );
  });

  it("5. locked write_review creates Decision; body unchanged", async () => {
    const root = path.join(dir, "vault-locked-write");
    assert.equal((await createVault(root, "LockedWrite")).ok, true);
    const period = currentPeriod("weekly", "monday");
    assert.equal(
      (await ensureReview(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );
    const marked = await executeReviewTool(root, agent, "mark_review_done", {
      cadence: "weekly",
      period,
      scope: "overall",
    });
    assert.equal((marked as { review?: { locked: boolean } }).review?.locked, true);

    const before = await getReview(root, "weekly", period);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    const beforeBody = before.value.bodyMarkdown;

    const proposed = [
      "## Look-back",
      "should-not-land",
      "",
      "## Keep",
      "k",
      "",
      "## Change",
      "c",
      "",
      "## Next-period intent",
      "n",
    ].join("\n");

    const result = await executeReviewTool(root, agent, "write_review", {
      cadence: "weekly",
      period,
      body: proposed,
    });
    assert.equal((result as { decision?: boolean }).decision, true);
    assert.ok((result as { id?: string }).id);

    const after = await getReview(root, "weekly", period);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown, beforeBody);

    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const id = (result as { id: string }).id;
    const dec = listed.value.find((d) => d.id === id);
    assert.ok(dec);
    assert.equal(dec!.target.type, "review");
    assert.equal(dec!.actor.type, "agent");
  });

  it("6. unlock_review then unlocked write succeeds", async () => {
    const root = path.join(dir, "vault-unlock");
    assert.equal((await createVault(root, "Unlock")).ok, true);
    const period = currentPeriod("weekly", "monday");
    assert.equal(
      (await ensureReview(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );
    assert.equal(
      (
        await executeReviewTool(root, agent, "mark_review_done", {
          cadence: "weekly",
          period,
          scope: "overall",
        })
      ).error,
      undefined,
    );

    const unlocked = await executeReviewTool(root, agent, "unlock_review", {
      cadence: "weekly",
      period,
    });
    assert.equal((unlocked as { review?: { locked: boolean } }).review?.locked, false);

    const written = await executeReviewTool(root, agent, "write_review", {
      cadence: "weekly",
      period,
      body: VALID_BODY.replace("look-back body", "post-unlock"),
    });
    assert.equal((written as { review?: { locked: boolean } }).review?.locked, false);
    assert.match(
      String((written as { review?: { bodyMarkdown: string } }).review?.bodyMarkdown),
      /post-unlock/,
    );
  });

  it("7. mark_review_done without scope marks overall", async () => {
    const root = path.join(dir, "vault-mark-default");
    assert.equal((await createVault(root, "MarkDefault")).ok, true);
    const period = currentPeriod("weekly", "monday");
    assert.equal(
      (await ensureReview(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );
    const result = await executeReviewTool(root, agent, "mark_review_done", {
      cadence: "weekly",
      period,
    });
    assert.equal((result as { review?: { locked: boolean } }).review?.locked, true);
  });

  it("8. get_period_pack returns pack.cadence / pack.period / pack.scope", async () => {
    const root = path.join(dir, "vault-pack");
    assert.equal((await createVault(root, "Pack")).ok, true);
    const period = currentPeriod("weekly", "monday");
    const result = await executeReviewTool(root, agent, "get_period_pack", {
      cadence: "weekly",
      period,
    });
    const pack = (result as { pack?: { cadence: string; period: string; scope: string } }).pack;
    assert.equal(pack?.cadence, "weekly");
    assert.equal(pack?.period, period);
    assert.equal(pack?.scope, "overall");
  });

  it("9. public API exports from index", () => {
    assert.equal(typeof executeReviewTool, "function");
    assert.equal(Array.isArray(REVIEW_TOOL_DEFS), true);
  });
});
