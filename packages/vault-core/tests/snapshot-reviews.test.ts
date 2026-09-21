import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { openVault } from "../src/index.ts";
import { ensureReview } from "../src/reviews.ts";
import { ensurePlanningStub } from "../src/planning-stubs.ts";
import { currentPeriod } from "../src/period.ts";
import type { WeekStartDay } from "../src/types.ts";

function weeklyPeriod(root: string): string {
  return currentPeriod("weekly", "monday" as WeekStartDay);
}

describe("VaultSnapshot reviews/planning/weeklyFileCount", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-snap-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("fresh vault: empty arrays, weeklyFileCount 0", async () => {
    const root = path.join(dir, "fresh");
    const created = await createVault(root, "Fresh");
    assert.equal(created.ok, true);
    const snap = await openVault(root);
    assert.equal(snap.ok, true);
    if (!snap.ok) return;
    assert.deepEqual(snap.value.reviews, []);
    assert.deepEqual(snap.value.planning, []);
    assert.equal(snap.value.weeklyFileCount, 0);
  });

  it("after ensureReview for weekly period: reviews contains cadence/period, weeklyFileCount >= 1", async () => {
    const root = path.join(dir, "with-review");
    const created = await createVault(root, "WithReview");
    assert.equal(created.ok, true);
    const period = weeklyPeriod(root);
    const ensured = await ensureReview(root, {
      cadence: "weekly",
      period,
      scope: "overall",
    });
    assert.equal(ensured.ok, true);
    const snap = await openVault(root);
    assert.equal(snap.ok, true);
    if (!snap.ok) return;
    assert.ok(snap.value.reviews.length >= 1);
    const entry = snap.value.reviews.find(
      (r) => r.cadence === "weekly" && r.period === period,
    );
    assert.ok(entry, "expected weekly review index entry");
    assert.equal(snap.value.weeklyFileCount >= 1, true);
  });

  it("after ensurePlanningStub for weekly period: planning contains cadence/period, weeklyFileCount counts both trees", async () => {
    const root = path.join(dir, "with-planning");
    const created = await createVault(root, "WithPlanning");
    assert.equal(created.ok, true);
    const period = weeklyPeriod(root);
    const ensured = await ensurePlanningStub(root, {
      cadence: "weekly",
      period,
      scope: "overall",
    });
    assert.equal(ensured.ok, true);
    const snap = await openVault(root);
    assert.equal(snap.ok, true);
    if (!snap.ok) return;
    assert.ok(snap.value.planning.length >= 1);
    const entry = snap.value.planning.find(
      (p) => p.cadence === "weekly" && p.period === period,
    );
    assert.ok(entry, "expected weekly planning index entry");
    assert.equal(snap.value.weeklyFileCount >= 1, true);
  });

  it("both review and planning files for weekly: weeklyFileCount counts both", async () => {
    const root = path.join(dir, "both-trees");
    const created = await createVault(root, "BothTrees");
    assert.equal(created.ok, true);
    const period = weeklyPeriod(root);
    assert.equal(
      (await ensureReview(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );
    assert.equal(
      (await ensurePlanningStub(root, { cadence: "weekly", period, scope: "overall" })).ok,
      true,
    );
    const snap = await openVault(root);
    assert.equal(snap.ok, true);
    if (!snap.ok) return;
    assert.equal(snap.value.weeklyFileCount, 2);
  });

  it("corrupt review file (invalid frontmatter): vault still ok, index row has error", async () => {
    const root = path.join(dir, "corrupt-review");
    const created = await createVault(root, "Corrupt");
    assert.equal(created.ok, true);
    const period = weeklyPeriod(root);
    const reviewsDir = path.join(root, "reviews", "weekly");
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(
      path.join(reviewsDir, `${period}.md`),
      "---\nnot valid yaml: [\n---\n# Broken\n",
    );
    const snap = await openVault(root);
    assert.equal(snap.ok, true);
    if (!snap.ok) return;
    const entry = snap.value.reviews.find(
      (r) => r.cadence === "weekly" && r.period === period,
    );
    assert.ok(entry, "expected index entry for corrupt review");
    assert.ok(entry!.error, "expected error field on corrupt review entry");
  });
});
