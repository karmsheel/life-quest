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
import { formatGoalPace, goalPace, daysUntilDeadline, deadlinePressureGoals } from "../src/goal-progress.ts";
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
        deadline: null,
        metric: null,
        target: null,
        definitionOfDone: null,
        current: null,
      } satisfies Goal,
    ]);
  });

  it("creates a numeric goal with deadline, metric, and target", () => {
    const res = applyGoalCommand(
      [],
      {
        type: "createGoal",
        name: "Run",
        deadline: "2026-12-31",
        metric: "km",
        target: 100,
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value[0].deadline, "2026-12-31");
    assert.equal(res.value[0].metric, "km");
    assert.equal(res.value[0].target, 100);
    assert.equal(res.value[0].current, 0);
    assert.equal(res.value[0].definitionOfDone, null);
  });

  it("creates a numeric goal with an explicit current", () => {
    const res = applyGoalCommand(
      [],
      {
        type: "createGoal",
        name: "Run",
        metric: "km",
        target: 100,
        current: 12,
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value[0].current, 12);
  });

  it("creates a definition-of-done goal", () => {
    const res = applyGoalCommand(
      [],
      {
        type: "createGoal",
        name: "Finish the book",
        definitionOfDone: "Draft is published",
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value[0].definitionOfDone, "Draft is published");
    assert.equal(res.value[0].metric, null);
    assert.equal(res.value[0].target, null);
    assert.equal(res.value[0].current, null);
  });

  it("update can set current on a numeric goal", () => {
    const created = applyGoalCommand(
      [],
      { type: "createGoal", name: "Run", metric: "km", target: 40 },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyGoalCommand(
      created.value,
      { type: "updateGoal", id: "g1", current: 18 },
      ctx,
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value[0].current, 18);
  });

  it("clearing metric clears current", () => {
    const created = applyGoalCommand(
      [],
      { type: "createGoal", name: "Run", metric: "km", target: 40, current: 5 },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyGoalCommand(
      created.value,
      {
        type: "updateGoal",
        id: "g1",
        metric: null,
        target: null,
        definitionOfDone: "Done when shipped",
      },
      ctx,
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value[0].metric, null);
    assert.equal(updated.value[0].current, null);
  });

  it("rejects a deadline that is not YYYY-MM-DD", () => {
    const res = applyGoalCommand(
      [],
      { type: "createGoal", name: "X", deadline: "31/12/2026" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("rejects a target without a metric", () => {
    const res = applyGoalCommand(
      [],
      { type: "createGoal", name: "X", target: 10 },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
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
    assert.deepEqual(
      del.value.map((g) => g.id),
      ["g2"],
    );
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

  it("loads legacy goals missing new fields as nulls", async () => {
    const root = path.join(dir, "legacy");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).goalsJson;
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(
      p,
      `${JSON.stringify({
        goals: [
          {
            id: "old",
            name: "Legacy",
            notes: "",
            status: "open",
            domainSlug: null,
          },
        ],
      })}\n`,
      "utf8",
    );
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.value[0].name, "Legacy");
    assert.equal(loaded.value[0].deadline, null);
    assert.equal(loaded.value[0].metric, null);
    assert.equal(loaded.value[0].target, null);
    assert.equal(loaded.value[0].definitionOfDone, null);
    assert.equal(loaded.value[0].current, null);
    const still = JSON.parse(await fs.readFile(p, "utf8")) as {
      goals: Array<Record<string, unknown>>;
    };
    assert.equal("deadline" in still.goals[0], false);
    assert.equal("current" in still.goals[0], false);
  });

  it("coerces missing current to 0 when metric is set, without rewriting the file", async () => {
    const root = path.join(dir, "legacy-metric");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).goalsJson;
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(
      p,
      `${JSON.stringify({
        goals: [
          {
            id: "old-m",
            name: "Legacy metric",
            notes: "",
            status: "open",
            domainSlug: null,
            metric: "km",
            target: 50,
          },
        ],
      })}\n`,
      "utf8",
    );
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.value[0].current, 0);
    const still = JSON.parse(await fs.readFile(p, "utf8")) as {
      goals: Array<Record<string, unknown>>;
    };
    assert.equal("current" in still.goals[0], false);
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

describe("goalPace", () => {
  it("returns null without a numeric target or deadline", () => {
    assert.equal(
      goalPace({
        metric: null,
        target: null,
        current: null,
        deadline: "2026-12-31",
      }),
      null,
    );
    assert.equal(
      goalPace({
        metric: "km",
        target: 40,
        current: 10,
        deadline: null,
      }),
      null,
    );
  });

  it("reports remaining days and remaining units without inventing a start date", () => {
    const pace = goalPace(
      {
        metric: "km",
        target: 40,
        current: 28,
        deadline: "2026-09-24",
      },
      "2026-09-12",
    );
    assert.deepEqual(pace, {
      daysLeft: 12,
      remaining: 12,
      metric: "km",
      current: 28,
      target: 40,
    });
    assert.equal(formatGoalPace(pace), "12 days left · 12 km remaining");
  });

  it("clamps remaining units at zero when current meets or exceeds target", () => {
    const pace = goalPace(
      {
        metric: "pages",
        target: 10,
        current: 12,
        deadline: "2026-09-20",
      },
      "2026-09-18",
    );
    assert.ok(pace);
    assert.equal(pace.remaining, 0);
    assert.equal(formatGoalPace(pace), "2 days left · 0 pages remaining");
  });
});

describe("daysUntilDeadline", () => {
  it("returns UTC calendar days from today to deadline", () => {
    assert.equal(daysUntilDeadline("2026-09-20", "2026-09-12"), 8);
  });

  it("returns 0 when today equals deadline", () => {
    assert.equal(daysUntilDeadline("2026-09-12", "2026-09-12"), 0);
  });

  it("returns negative for overdue deadlines", () => {
    assert.equal(daysUntilDeadline("2026-09-10", "2026-09-12"), -2);
  });

  it("defaults todayIso to the local calendar date", () => {
    const result = daysUntilDeadline("2026-09-20");
    assert.ok(Number.isInteger(result));
  });
});

describe("deadlinePressureGoals", () => {
  const goals = [
    { status: "open" as const, deadline: "2026-09-19", name: "A" },
    { status: "open" as const, deadline: "2026-09-21", name: "B" },
    { status: "open" as const, deadline: "2026-09-18", name: "C" },
    { status: "done" as const, deadline: "2026-09-20", name: "D" },
    { status: "open" as const, deadline: null, name: "E" },
    { status: "open" as const, deadline: "" as unknown as string, name: "F" },
  ];

  it("includes goals due within 7 days", () => {
    const pressured = deadlinePressureGoals(goals, "2026-09-12");
    assert.deepStrictEqual(
      pressured.map((g) => g.name).sort(),
      ["A", "C"],
    );
  });

  it("excludes goals due in 8 or more days", () => {
    const pressured = deadlinePressureGoals(
      [{ status: "open" as const, deadline: "2026-09-20", name: "X" }],
      "2026-09-12",
    );
    assert.equal(pressured.length, 0);
  });

  it("includes goals due today", () => {
    const pressured = deadlinePressureGoals(
      [{ status: "open" as const, deadline: "2026-09-12", name: "Today" }],
      "2026-09-12",
    );
    assert.equal(pressured.length, 1);
  });

  it("includes overdue goals", () => {
    const pressured = deadlinePressureGoals(
      [{ status: "open" as const, deadline: "2026-09-10", name: "Overdue" }],
      "2026-09-12",
    );
    assert.equal(pressured.length, 1);
  });

  it("excludes goals without a deadline", () => {
    const pressured = deadlinePressureGoals(
      [{ status: "open" as const, deadline: null, name: "NoDeadline" }],
      "2026-09-12",
    );
    assert.equal(pressured.length, 0);
  });

  it("excludes goals that are not open", () => {
    const pressured = deadlinePressureGoals(
      [{ status: "done" as const, deadline: "2026-09-20", name: "Done" }],
      "2026-09-12",
    );
    assert.equal(pressured.length, 0);
  });
});
