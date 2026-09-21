import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { USER_ACTOR } from "../src/types.ts";
import { ensureReview, getReview, writeReview, markReviewDone, applyLockedReviewBody } from "../src/reviews.ts";
import { createDecision, resolveDecision, normalizeDecision } from "../src/decisions.ts";
import { documentTargetLabel } from "../src/documents.ts";
import { periodTitle } from "../src/period.ts";

const VALID_BODY = `# Weekly review · Week of 21 Sep 2026

## Look-back
approved-look-back

## Keep
keeping this

## Change
changing that

## Next-period intent
next stuff
`;

describe("review decisions", () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-review-decisions-"));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function freshVault(name: string): Promise<string> {
    const root = path.join(dir, name);
    const created = await createVault(root, name);
    assert.equal(created.ok, true, `createVault ${name} failed`);
    return root;
  }

  it("1. locked review: writeReview returns LOCKED and does not write", async () => {
    const root = await freshVault("vault-1");
    assert.equal((await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);
    assert.equal((await markReviewDone(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);

    const before = await getReview(root, "weekly", "2026-09-21");
    assert.equal(before.ok, true);
    if (!before.ok) return;
    const beforeBody = before.value.bodyMarkdown;

    const writeRes = await writeReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      bodyMarkdown: "should not land",
      actor: USER_ACTOR,
    });
    assert.equal(writeRes.ok, false);
    if (writeRes.ok) return;
    assert.match(writeRes.error, /LOCKED/i);

    const after = await getReview(root, "weekly", "2026-09-21");
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown, beforeBody);
  });

  it("2. createDecision with review target: pending, review type, empty domainSlugs, title", async () => {
    const root = await freshVault("vault-2");
    assert.equal((await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);
    assert.equal((await markReviewDone(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);

    const created = await createDecision(root, {
      target: { type: "review", cadence: "weekly", period: "2026-09-21" },
      proposedBodyMarkdown: VALID_BODY,
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.target.type, "review");
    assert.deepEqual(created.value.domainSlugs, []);
    assert.match(created.value.title, /Weekly review/);
  });

  it("3. approve applies body via applyLockedReviewBody; still locked", async () => {
    const root = await freshVault("vault-3");
    assert.equal((await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);
    assert.equal((await markReviewDone(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);

    const created = await createDecision(root, {
      target: { type: "review", cadence: "weekly", period: "2026-09-21" },
      proposedBodyMarkdown: VALID_BODY,
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const resolved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(resolved.ok, true);

    const review = await getReview(root, "weekly", "2026-09-21");
    assert.equal(review.ok, true);
    if (!review.ok) return;
    assert.match(review.value.bodyMarkdown, /approved-look-back/);
    assert.equal(review.value.locked, true);
  });

  it("4. unlocked review: createDecision fails with /locked/i", async () => {
    const root = await freshVault("vault-4");
    assert.equal((await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);

    const created = await createDecision(root, {
      target: { type: "review", cadence: "weekly", period: "2026-09-21" },
      proposedBodyMarkdown: VALID_BODY,
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.match(created.error, /locked/i);
  });

  it("5. missing review file: createDecision not found", async () => {
    const root = await freshVault("vault-5");
    const created = await createDecision(root, {
      target: { type: "review", cadence: "weekly", period: "2026-09-21" },
      proposedBodyMarkdown: VALID_BODY,
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.match(created.error, /not found/i);
  });

  it("6. reject leaves body unchanged; still locked", async () => {
    const root = await freshVault("vault-6");
    assert.equal((await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);
    assert.equal((await markReviewDone(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);

    const before = await getReview(root, "weekly", "2026-09-21");
    assert.equal(before.ok, true);
    if (!before.ok) return;
    const beforeBody = before.value.bodyMarkdown;

    const created = await createDecision(root, {
      target: { type: "review", cadence: "weekly", period: "2026-09-21" },
      proposedBodyMarkdown: VALID_BODY,
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const rejected = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(rejected.ok, true);

    const after = await getReview(root, "weekly", "2026-09-21");
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown, beforeBody);
    assert.equal(after.value.locked, true);
  });

  it("7. documentTargetLabel uses periodTitle", async () => {
    const label = documentTargetLabel({ type: "review", cadence: "weekly", period: "2026-09-21" }, "");
    const expected = periodTitle("weekly", "2026-09-21", "monday");
    assert.equal(label, expected);
  });

  it("8. normalizeDecision round-trips review target", async () => {
    const normalized = normalizeDecision({
      id: "test-id",
      target: { type: "review", cadence: "weekly", period: "2026-09-21" },
      proposedBodyMarkdown: "x",
    });
    assert.equal(normalized.target.type, "review");
    if (normalized.target.type === "review") {
      assert.equal(normalized.target.cadence, "weekly");
      assert.equal(normalized.target.period, "2026-09-21");
    }
  });

  it("9. applyLockedReviewBody rejects missing ## Keep", async () => {
    const root = await freshVault("vault-9");
    assert.equal((await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);
    assert.equal((await markReviewDone(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" })).ok, true);

    const before = await getReview(root, "weekly", "2026-09-21");
    assert.equal(before.ok, true);
    if (!before.ok) return;
    const beforeBody = before.value.bodyMarkdown;

    const bodyWithoutKeep = `# Weekly review · Week of 21 Sep 2026

## Look-back
stuff

## Change
changing

## Next-period intent
next
`;

    const res = await applyLockedReviewBody(root, "weekly", "2026-09-21", bodyWithoutKeep);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /Keep/);

    const after = await getReview(root, "weekly", "2026-09-21");
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.bodyMarkdown, beforeBody);
  });

  it("10. public API exports applyLockedReviewBody", async () => {
    const mod = await import("../src/index.ts");
    assert.equal(typeof mod.applyLockedReviewBody, "function");
  });
});
