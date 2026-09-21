import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault, ensurePlanningStub, ensureReview, openVault } from "../src/index.ts";
import type { Result } from "../src/types.ts";

function expectOk<T>(r: Result<T>): asserts r is { ok: true; value: T } {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
}

describe("VaultSnapshot reviews/planning index", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-snap-reviews-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("1. fresh vault: reviews [], planning [], weeklyFileCount 0", async () => {
    const root = path.join(dir, "vault-fresh");
    const created = await createVault(root, "Fresh");
    expectOk(created);
    assert.deepEqual(created.value.reviews, []);
    assert.deepEqual(created.value.planning, []);
    assert.equal(created.value.weeklyFileCount, 0);

    const opened = await openVault(root);
    expectOk(opened);
    assert.deepEqual(opened.value.reviews, []);
    assert.deepEqual(opened.value.planning, []);
    assert.equal(opened.value.weeklyFileCount, 0);
  });

  it("2. after ensureReview weekly: reviews contains entry; weeklyFileCount >= 1", async () => {
    const root = path.join(dir, "vault-review");
    const created = await createVault(root, "Review");
    expectOk(created);

    const ensured = await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    expectOk(ensured);

    const opened = await openVault(root);
    expectOk(opened);
    const hit = opened.value.reviews.find(
      (e) => e.cadence === "weekly" && e.period === "2026-09-21",
    );
    assert.ok(hit, "expected weekly/2026-09-21 in snapshot.reviews");
    assert.ok(opened.value.weeklyFileCount >= 1);
  });

  it("3. after ensurePlanningStub weekly: planning contains entry; weeklyFileCount counts both", async () => {
    const root = path.join(dir, "vault-planning");
    const created = await createVault(root, "Planning");
    expectOk(created);

    const review = await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    expectOk(review);

    const planning = await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    expectOk(planning);

    const opened = await openVault(root);
    expectOk(opened);
    const hit = opened.value.planning.find(
      (e) => e.cadence === "weekly" && e.period === "2026-09-21",
    );
    assert.ok(hit, "expected weekly/2026-09-21 in snapshot.planning");
    assert.ok(opened.value.weeklyFileCount >= 2);
  });

  it("4. corrupt review file: openVault ok; index row has error", async () => {
    const root = path.join(dir, "vault-corrupt");
    const created = await createVault(root, "Corrupt");
    expectOk(created);

    const cadenceDir = path.join(root, "reviews", "weekly");
    await fs.mkdir(cadenceDir, { recursive: true });
    await fs.writeFile(
      path.join(cadenceDir, "2026-09-14.md"),
      "garbage frontmatter\nno yaml\n",
      "utf8",
    );

    const opened = await openVault(root);
    expectOk(opened);
    assert.equal(opened.ok, true);
    const corrupt = opened.value.reviews.find((e) => e.period === "2026-09-14");
    assert.ok(corrupt, "expected corrupt period in reviews index");
    assert.ok(corrupt!.error, "expected error on corrupt index row");
  });
});
