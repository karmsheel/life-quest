import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import {
  ensureReview,
  getReview,
  listReviewIndex,
  markReviewDone,
  setReviewSessionId,
  unlockReview,
  writeReview,
} from "../src/reviews.ts";
import { periodBounds, periodTitle } from "../src/period.ts";
import type { Actor, Result, ReviewRecord } from "../src/types.ts";

const USER: Actor = { type: "user" };

function expectOk<T>(r: Result<T>): asserts r is { ok: true; value: T } {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
}

describe("reviews", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-reviews-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("1. ensureReview of a future weekly period → { ok: false } matching /future/i", async () => {
    const root = path.join(dir, "vault-1");
    const res = await createVault(root, "V1");
    expectOk(res);
    // future period (use nextPeriod)
    const { nextPeriod } = await import("../src/period.ts");
    const next = nextPeriod("weekly", "2026-09-21", "monday");
    expectOk(next);
    const r = await ensureReview(root, {
      cadence: "weekly",
      period: next.value,
      scope: "overall",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error.toLowerCase(), /future/);
  });

  it("2. ensureReview overall current weekly creates file with skeleton headings + overall draft", async () => {
    const root = path.join(dir, "vault-2");
    const res = await createVault(root, "V2");
    expectOk(res);
    const r = await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const rec = r.value;
    assert.equal(rec.scopes.overall.status, "draft");
    assert.equal(rec.locked, false);
    assert.equal(rec.cadence, "weekly");
    assert.equal(rec.period, "2026-09-21");
    const title = periodTitle("weekly", "2026-09-21", "monday");
    assert.equal(rec.title, title);
    assert.match(rec.bodyMarkdown, /^# /m);
    assert.match(rec.bodyMarkdown, /## Look-back/);
    assert.match(rec.bodyMarkdown, /## Keep/);
    assert.match(rec.bodyMarkdown, /## Change/);
    assert.match(rec.bodyMarkdown, /## Next-period intent/);
    // file on disk
    const filePath = path.join(root, "reviews", "weekly", "2026-09-21.md");
    await fs.access(filePath);
  });

  it("3. ensureReview health appends ## Health + four ### headings; overall stays draft", async () => {
    const root = path.join(dir, "vault-3");
    const res = await createVault(root, "V3");
    expectOk(res);
    // ensure overall first
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    const r = await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const rec = r.value;
    assert.equal(rec.scopes.health.status, "draft");
    assert.equal(rec.scopes.overall.status, "draft");
    assert.match(rec.bodyMarkdown, /## Health/);
    assert.match(rec.bodyMarkdown, /### Look-back/);
    assert.match(rec.bodyMarkdown, /### Keep/);
    assert.match(rec.bodyMarkdown, /### Change/);
    assert.match(rec.bodyMarkdown, /### Next-period intent/);
  });

  it("4. getReview missing file → { ok: false }", async () => {
    const root = path.join(dir, "vault-4");
    const res = await createVault(root, "V4");
    expectOk(res);
    const r = await getReview(root, "weekly", "2026-09-21");
    assert.equal(r.ok, false);
  });

  it("5. writeReview dropping ## Keep → { ok: false } listing Keep; file unchanged", async () => {
    const root = path.join(dir, "vault-5");
    const res = await createVault(root, "V5");
    expectOk(res);
    const e = await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    expectOk(e);
    const original = e.value;
    const badBody = [
      `# ${original.title}`,
      "",
      "## Look-back",
      "",
      "## Change",
      "",
      "## Next-period intent",
      "",
    ].join("\n");
    const r = await writeReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      bodyMarkdown: badBody,
      actor: USER,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Keep/);
    // file unchanged on disk
    const after = await getReview(root, "weekly", "2026-09-21");
    expectOk(after);
    assert.equal(after.value.bodyMarkdown, original.bodyMarkdown);
  });

  it("6. writeReview with extra ## Notes after required succeeds; extra heading remains", async () => {
    const root = path.join(dir, "vault-6");
    const res = await createVault(root, "V6");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    const title = periodTitle("weekly", "2026-09-21", "monday");
    const body = [
      `# ${title}`,
      "",
      "## Look-back",
      "",
      "## Keep",
      "",
      "## Change",
      "",
      "## Next-period intent",
      "",
      "## Notes",
      "extra",
      "",
    ].join("\n");
    const r = await writeReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      bodyMarkdown: body,
      actor: USER,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.match(r.value.bodyMarkdown, /## Notes/);
    assert.match(r.value.bodyMarkdown, /^# /m);
  });

  it("7. markReviewDone health → health done, locked === false", async () => {
    const root = path.join(dir, "vault-7");
    const res = await createVault(root, "V7");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
    });
    const r = await markReviewDone(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.scopes.health.status, "done");
    assert.equal(r.value.locked, false);
  });

  it("8. markReviewDone overall → locked === true, overall done", async () => {
    const root = path.join(dir, "vault-8");
    const res = await createVault(root, "V8");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    const r = await markReviewDone(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.scopes.overall.status, "done");
    assert.equal(r.value.locked, true);
  });

  it("9. writeReview while locked → { ok: false, error: 'LOCKED' }; file unchanged", async () => {
    const root = path.join(dir, "vault-9");
    const res = await createVault(root, "V9");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    await markReviewDone(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    const before = await getReview(root, "weekly", "2026-09-21");
    expectOk(before);
    const original = before.value;
    const title = periodTitle("weekly", "2026-09-21", "monday");
    const body = [
      `# ${title}`,
      "",
      "## Look-back",
      "",
      "## Keep",
      "",
      "## Change",
      "",
      "## Next-period intent",
      "",
    ].join("\n");
    const r = await writeReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      bodyMarkdown: body,
      actor: USER,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /LOCKED/);
    // file unchanged
    const after = await getReview(root, "weekly", "2026-09-21");
    expectOk(after);
    assert.equal(after.value.bodyMarkdown, original.bodyMarkdown);
  });

  it("10. unlockReview → locked === false; overall status stays done", async () => {
    const root = path.join(dir, "vault-10");
    const res = await createVault(root, "V10");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    await markReviewDone(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    const r = await unlockReview(root, "weekly", "2026-09-21");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.locked, false);
    assert.equal(r.value.scopes.overall.status, "done");
  });

  it("11. markReviewDone health while missing → fail", async () => {
    const root = path.join(dir, "vault-11");
    const res = await createVault(root, "V11");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    const r = await markReviewDone(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
    });
    assert.equal(r.ok, false);
  });

  it("12. listReviewIndex returns file; corrupt file → entry with error string, not a throw", async () => {
    const root = path.join(dir, "vault-12");
    const res = await createVault(root, "V12");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    // add a corrupt file
    const cadenceDir = path.join(root, "reviews", "weekly");
    await fs.writeFile(path.join(cadenceDir, "not-a-date.md"), "garbage frontmatter\n", "utf8");
    const r = await listReviewIndex(root);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.value.length >= 1);
    const corrupt = r.value.find((e) => e.period === "not-a-date");
    assert.ok(corrupt);
    assert.ok(corrupt!.error);
  });

  it("13. writeReview preserves overall Look-back and domain ### Look-back distinctly", async () => {
    const root = path.join(dir, "vault-13");
    const res = await createVault(root, "V13");
    expectOk(res);
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    await ensureReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
    });
    const title = periodTitle("weekly", "2026-09-21", "monday");
    const body = [
      `# ${title}`,
      "",
      "## Look-back",
      "overall-lb",
      "",
      "## Keep",
      "",
      "## Change",
      "",
      "## Next-period intent",
      "",
      "## Health",
      "",
      "### Look-back",
      "health-lb",
      "",
      "### Keep",
      "",
      "### Change",
      "",
      "### Next-period intent",
      "",
    ].join("\n");
    const r = await writeReview(root, {
      cadence: "weekly",
      period: "2026-09-21",
      bodyMarkdown: body,
      actor: USER,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.match(r.value.bodyMarkdown, /overall-lb/);
    assert.match(r.value.bodyMarkdown, /health-lb/);
    // health-lb must appear after ## Health, not in the overall Look-back block
    const overallLbIdx = r.value.bodyMarkdown.indexOf("overall-lb");
    const healthLbIdx = r.value.bodyMarkdown.indexOf("health-lb");
    const healthIdx = r.value.bodyMarkdown.indexOf("## Health");
    assert.ok(overallLbIdx < healthIdx, "overall Look-back before ## Health");
    assert.ok(healthLbIdx > healthIdx, "health-lb after ## Health");
  });
});
