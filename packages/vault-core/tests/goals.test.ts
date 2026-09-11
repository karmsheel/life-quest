import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyGoalCommand,
  applyGoalsCommand,
  loadGoals,
} from "../src/goals.ts";
import { createVault } from "../src/create-vault.ts";
import { vaultPaths } from "../src/paths.ts";
import type { Goal, GoalsApplyContext } from "../src/types.ts";

const ctx: GoalsApplyContext = {
  id: () => "g1",
  liveDomainSlugs: ["health", "intellectual"],
};

describe("applyGoalCommand", () => {
  it("creates an open unassigned goal", () => {
    const res = applyGoalCommand(
      [],
      { type: "createGoal", name: "Ship the guide" },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value, [
      {
        id: "g1",
        name: "Ship the guide",
        notes: "",
        status: "open",
        domainSlug: null,
      } satisfies Goal,
    ]);
  });

  it("rejects an empty name", () => {
    const res = applyGoalCommand([], { type: "createGoal", name: "   " }, ctx);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("rejects a domain that is not live", () => {
    const res = applyGoalCommand(
      [],
      { type: "createGoal", name: "X", domainSlug: "archived" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("update can change status and preserve a stored archived domain when omitted", () => {
    const created = applyGoalCommand(
      [],
      { type: "createGoal", name: "X", domainSlug: "health" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyGoalCommand(
      created.value,
      { type: "updateGoal", id: "g1", status: "done" },
      { ...ctx, liveDomainSlugs: [] },
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value[0].status, "done");
    assert.equal(updated.value[0].domainSlug, "health");
  });

  it("delete removes only that goal", () => {
    const twoCtx: GoalsApplyContext = {
      liveDomainSlugs: ["health"],
      id: (() => {
        let n = 0;
        return () => `g${++n}`;
      })(),
    };
    const a = applyGoalCommand([], { type: "createGoal", name: "A" }, twoCtx);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = applyGoalCommand(a.value, { type: "createGoal", name: "B" }, twoCtx);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    const del = applyGoalCommand(b.value, { type: "deleteGoal", id: "g1" }, twoCtx);
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.map((g) => g.id), ["g2"]);
  });
});

describe("goals persist", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-goals-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing file loads as empty and does not write", async () => {
    const root = path.join(dir, "missing");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.deepEqual(loaded.value, []);
    await assert.rejects(fs.access(vaultPaths(root).goalsJson));
  });

  it("applyGoalsCommand writes goals.json and appends a log line", async () => {
    const root = path.join(dir, "write");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const applied = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Run",
      domainSlug: "health",
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.value[0].name, "Run");
    assert.equal(applied.value[0].domainSlug, "health");
    const raw = JSON.parse(await fs.readFile(vaultPaths(root).goalsJson, "utf8")) as {
      goals: Goal[];
    };
    assert.equal(raw.goals[0].name, "Run");
    const log = await fs.readFile(vaultPaths(root).logJsonl, "utf8");
    assert.match(log, /"type":"goal.created"/);
  });

  it("malformed goals.json is not overwritten", async () => {
    const root = path.join(dir, "bad");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).goalsJson;
    await fs.writeFile(p, "{not-json", "utf8");
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal("malformed" in loaded && loaded.malformed, true);
    const applied = await applyGoalsCommand(root, { type: "createGoal", name: "X" });
    assert.equal(applied.ok, false);
    const still = await fs.readFile(p, "utf8");
    assert.equal(still, "{not-json");
  });
});
