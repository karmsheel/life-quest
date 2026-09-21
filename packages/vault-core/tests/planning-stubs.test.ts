import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import {
  ensurePlanningStub,
  getPlanningStub,
  listPlanningIndex,
  setPlanningSessionId,
} from "../src/planning-stubs.ts";

function expectOk<T>(r: { ok: true; value: T } | { ok: false; error: string }): asserts r is { ok: true; value: T } {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
}

describe("planning stubs", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-planning-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("1. ensurePlanningStub weekly 2026-09-28 overall succeeds (future period allowed); file exists", async () => {
    const root = path.join(dir, "vault-1");
    const res = await createVault(root, "V1");
    expectOk(res);
    const r = await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.cadence, "weekly");
    assert.equal(r.value.period, "2026-09-28");
    const filePath = path.join(root, "planning", "weekly", "2026-09-28.md");
    await fs.access(filePath);
  });

  it("2. returned bodyMarkdown === \"\"; on-disk body has no ## Look-back / ## Keep", async () => {
    const root = path.join(dir, "vault-2");
    const res = await createVault(root, "V2");
    expectOk(res);
    const r = await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.bodyMarkdown, "");
    const filePath = path.join(root, "planning", "weekly", "2026-09-28.md");
    const raw = await fs.readFile(filePath, "utf8");
    assert.ok(!raw.includes("## Look-back"), "body should not contain ## Look-back");
    assert.ok(!raw.includes("## Keep"), "body should not contain ## Keep");
  });

  it("3. on-disk frontmatter has no locked key", async () => {
    const root = path.join(dir, "vault-3");
    const res = await createVault(root, "V3");
    expectOk(res);
    await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    const filePath = path.join(root, "planning", "weekly", "2026-09-28.md");
    const raw = await fs.readFile(filePath, "utf8");
    assert.ok(!raw.includes("locked:"), "frontmatter should not contain locked key");
  });

  it("4. scopes.overall.sessionId === null", async () => {
    const root = path.join(dir, "vault-4");
    const res = await createVault(root, "V4");
    expectOk(res);
    const r = await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.value.scopes.overall, { sessionId: null });
  });

  it("5. setPlanningSessionId then getPlanningStub returns that session id", async () => {
    const root = path.join(dir, "vault-5");
    const res = await createVault(root, "V5");
    expectOk(res);
    await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    const setRes = await setPlanningSessionId(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
      sessionId: "session-abc-123",
    });
    assert.equal(setRes.ok, true);
    if (!setRes.ok) return;
    assert.equal(setRes.value.scopes.overall.sessionId, "session-abc-123");
    const getRes = await getPlanningStub(root, "weekly", "2026-09-28");
    assert.equal(getRes.ok, true);
    if (!getRes.ok) return;
    assert.equal(getRes.value.scopes.overall.sessionId, "session-abc-123");
  });

  it("6. ensurePlanningStub health on that period adds scopes.health.sessionId === null; overall session id unchanged", async () => {
    const root = path.join(dir, "vault-6");
    const res = await createVault(root, "V6");
    expectOk(res);
    await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    await setPlanningSessionId(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
      sessionId: "overall-session-id",
    });
    const r = await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "health",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.value.scopes.health, { sessionId: null });
    assert.equal(r.value.scopes.overall.sessionId, "overall-session-id");
  });

  it("7. getPlanningStub missing file → { ok: false } matching /not found/i", async () => {
    const root = path.join(dir, "vault-7");
    const res = await createVault(root, "V7");
    expectOk(res);
    const r = await getPlanningStub(root, "weekly", "2026-09-28");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not found/i);
  });

  it("8. listPlanningIndex includes { cadence: \"weekly\", period: \"2026-09-28\" }", async () => {
    const root = path.join(dir, "vault-8");
    const res = await createVault(root, "V8");
    expectOk(res);
    await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    const r = await listPlanningIndex(root);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const found = r.value.find((e) => e.cadence === "weekly" && e.period === "2026-09-28");
    assert.ok(found, "expected to find weekly 2026-09-28 in index");
  });

  it("9. Public API gate: ../src/index.ts exposes the four functions", async () => {
    const mod = await import("../src/index.ts");
    assert.equal(typeof mod.ensurePlanningStub, "function");
    assert.equal(typeof mod.getPlanningStub, "function");
    assert.equal(typeof mod.setPlanningSessionId, "function");
    assert.equal(typeof mod.listPlanningIndex, "function");
  });

  it("10. Idempotent ensure does not clear a stored sessionId", async () => {
    const root = path.join(dir, "vault-10");
    const res = await createVault(root, "V10");
    expectOk(res);
    await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    await setPlanningSessionId(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
      sessionId: "persisted-id",
    });
    const r = await ensurePlanningStub(root, {
      cadence: "weekly",
      period: "2026-09-28",
      scope: "overall",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.scopes.overall.sessionId, "persisted-id");
  });
});
