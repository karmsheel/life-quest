import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { appendLog } from "../src/log.ts";
import { applyGoalsCommand } from "../src/goals.ts";
import { applyMapCommand } from "../src/map/persist.ts";
import { ensureReview } from "../src/reviews.ts";
import { getPeriodPack } from "../src/index.ts";
import { vaultPaths } from "../src/paths.ts";

describe("period-pack", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-pack-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seedVault() {
    const root = path.join(dir, "vault");
    await createVault(root, "Personal");

    // 1. Log entries
    await appendLog(root, {
      domainSlug: "health",
      type: "signal",
      summary: "health-in",
      createdAt: "2026-09-22T12:00:00.000Z",
    });
    await appendLog(root, {
      domainSlug: "financial",
      type: "signal",
      summary: "fin-in",
      createdAt: "2026-09-22T12:00:00.000Z",
    });
    await appendLog(root, {
      domainSlug: "health",
      type: "signal",
      summary: "health-out",
      createdAt: "2026-09-28T12:00:00.000Z",
    });
    await appendLog(root, {
      domainSlug: null,
      type: "signal",
      summary: "unassigned-in",
      createdAt: "2026-09-22T12:00:00.000Z",
    });

    // 2-4. Goals
    const healthGoal = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Health Lift",
      domainSlug: "health",
      deadline: "2026-09-25",
    });
    assert.equal(healthGoal.ok, true);
    if (!healthGoal.ok) throw new Error("goal fail");
    const healthId = healthGoal.value[0].id;

    await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Money",
      domainSlug: "financial",
    });
    await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Unassigned Open",
    });

    // 5-7. Map events
    await applyMapCommand(
      root,
      { type: "createEvent", year: 2026, title: "Run", date: "2026-09-23", domainSlug: "health" },
      "user",
      "2026-09-23",
    );
    await applyMapCommand(
      root,
      { type: "createEvent", year: 2026, title: "Tax", date: "2026-09-23", domainSlug: "financial" },
      "user",
      "2026-09-23",
    );
    await applyMapCommand(
      root,
      { type: "createEvent", year: 2026, title: "Outside", date: "2026-09-28", domainSlug: "health" },
      "user",
      "2026-09-23",
    );

    // 8. liveDays
    await applyMapCommand(root, { type: "ensureLiveDay", date: "2026-09-22" }, "user", "2026-09-23");
    await applyMapCommand(root, { type: "ensureLiveDay", date: "2026-09-28" }, "user", "2026-09-23");

    // 9-11. Tasks
    await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "Dated health",
        column: "backlog",
        links: { date: "2026-09-23", goalId: healthId },
      },
      "user",
      "2026-09-23",
    );
    await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "Dated no goal",
        column: "backlog",
        links: { date: "2026-09-23" },
      },
      "user",
      "2026-09-23",
    );
    await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "Outside date",
        column: "backlog",
        links: { date: "2026-09-28" },
      },
      "user",
      "2026-09-23",
    );

    // 12-13. Reviews
    await ensureReview(root, { cadence: "weekly", period: "2026-09-14", scope: "overall" });
    await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "overall" });
    await ensureReview(root, { cadence: "weekly", period: "2026-09-21", scope: "health" });

    return { root, healthId };
  }

  it("1. Overall pack weekly 2026-09-21 filters correctly", async () => {
    const { root } = await seedVault();
    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const pack = res.value;

    assert.deepEqual(pack.bounds, { start: "2026-09-21", end: "2026-09-27" });

    const logSummaries = pack.log.map((e) => e.summary);
    assert.ok(logSummaries.includes("health-in"));
    assert.ok(logSummaries.includes("fin-in"));
    assert.ok(logSummaries.includes("unassigned-in"));
    assert.ok(!logSummaries.includes("health-out"));

    const eventTitles = pack.events.map((e) => e.title);
    assert.ok(eventTitles.includes("Run"));
    assert.ok(eventTitles.includes("Tax"));
    assert.ok(!eventTitles.includes("Outside"));

    const liveDayDates = pack.liveDays.map((d) => d.date);
    assert.ok(liveDayDates.includes("2026-09-22"));
    assert.ok(!liveDayDates.includes("2026-09-28"));

    const taskTitles = pack.tasks.map((t) => t.title);
    assert.ok(taskTitles.includes("Dated health"));
    assert.ok(taskTitles.includes("Dated no goal"));
    assert.ok(!taskTitles.includes("Outside date"));

    const goalNames = pack.goals.map((g) => g.name);
    assert.ok(goalNames.includes("Health Lift"));
    assert.ok(goalNames.includes("Money"));
    assert.ok(goalNames.includes("Unassigned Open"));

    assert.equal(pack.previousReview?.period, "2026-09-14");
    assert.ok(pack.domainSections.some((s) => s.slug === "health"));

    assert.deepEqual(pack.missingSources, []);
    assert.equal(pack.truncated, false);
  });

  it("2. Health pack filters to domain", async () => {
    const { root } = await seedVault();
    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "health",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const pack = res.value;

    const logSummaries = pack.log.map((e) => e.summary);
    assert.ok(logSummaries.includes("health-in"));
    assert.ok(!logSummaries.includes("fin-in"));
    assert.ok(!logSummaries.includes("unassigned-in"));

    const eventTitles = pack.events.map((e) => e.title);
    assert.ok(eventTitles.includes("Run"));
    assert.ok(!eventTitles.includes("Tax"));

    const taskTitles = pack.tasks.map((t) => t.title);
    assert.ok(taskTitles.includes("Dated health"));
    assert.ok(!taskTitles.includes("Dated no goal"));

    const goalNames = pack.goals.map((g) => g.name);
    assert.ok(goalNames.includes("Health Lift"));
    assert.ok(!goalNames.includes("Money"));

    assert.deepEqual(pack.domainSections, []);

    const liveDayDates = pack.liveDays.map((d) => d.date);
    assert.ok(liveDayDates.includes("2026-09-22"));

    assert.equal(pack.previousReview?.period, "2026-09-14");
  });

  it("3. No previous review file → previousReview null, not missingSource", async () => {
    const root = path.join(dir, "no-prev");
    await createVault(root, "Personal");
    await appendLog(root, {
      domainSlug: "health",
      type: "signal",
      summary: "in",
      createdAt: "2026-09-22T12:00:00.000Z",
    });
    await applyMapCommand(root, { type: "ensureLiveDay", date: "2026-09-22" }, "user", "2026-09-23");

    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.previousReview, null);
    assert.ok(!res.value.missingSources.includes("review"));
  });

  it("4. Malformed period → ok:false", async () => {
    const { root } = await seedVault();
    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-W38",
      scope: "overall",
    });
    assert.equal(res.ok, false);
  });

  it("5. Corrupt map.json → ok:true with missingSources map", async () => {
    const { root } = await seedVault();
    await fs.writeFile(vaultPaths(root).mapJson, "not-json", "utf8");

    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(res.value.missingSources.includes("map"));
    assert.deepEqual(res.value.events, []);
    assert.deepEqual(res.value.tasks, []);
    assert.deepEqual(res.value.liveDays, []);
    assert.ok(res.value.log.length > 0);
    assert.ok(res.value.goals.length > 0);
  });

  it("6. Truncation: 101 log rows → cap 100, truncated true", async () => {
    const root = path.join(dir, "truncate");
    await createVault(root, "Personal");
    for (let i = 0; i < 101; i++) {
      await appendLog(root, {
        domainSlug: "health",
        type: "signal",
        summary: `row-${i}`,
        createdAt: "2026-09-22T12:00:00.000Z",
      });
    }
    await applyMapCommand(root, { type: "ensureLiveDay", date: "2026-09-22" }, "user", "2026-09-23");

    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.log.length, 100);
    assert.equal(res.value.truncated, true);
  });

  it("7. Current-column tasks included only in current period", async () => {
    const root = path.join(dir, "current-col");
    await createVault(root, "Personal");
    await applyMapCommand(
      root,
      { type: "createTask", title: "Today task", column: "today" },
      "user",
      "2026-09-23",
    );
    await applyMapCommand(root, { type: "ensureLiveDay", date: "2026-09-22" }, "user", "2026-09-23");

    // Current period (whenever test runs, use currentPeriod)
    // We can't know what "current" is, so we test the past-week exclusion:
    // Pack a past week — the undated today-task should NOT be included.
    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-14",
      scope: "overall",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const taskTitles = res.value.tasks.map((t) => t.title);
    assert.ok(!taskTitles.includes("Today task"));
  });

  it("8. Inclusive bounds: start and end dates included", async () => {
    const root = path.join(dir, "bounds");
    await createVault(root, "Personal");
    await appendLog(root, {
      domainSlug: "health",
      type: "signal",
      summary: "start-day",
      createdAt: "2026-09-21T12:00:00.000Z",
    });
    await appendLog(root, {
      domainSlug: "health",
      type: "signal",
      summary: "end-day",
      createdAt: "2026-09-27T12:00:00.000Z",
    });
    await applyMapCommand(
      root,
      { type: "createEvent", year: 2026, title: "End Event", date: "2026-09-27", domainSlug: "health" },
      "user",
      "2026-09-23",
    );
    await applyMapCommand(root, { type: "ensureLiveDay", date: "2026-09-21" }, "user", "2026-09-23");

    const res = await getPeriodPack(root, {
      cadence: "weekly",
      period: "2026-09-21",
      scope: "overall",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const summaries = res.value.log.map((e) => e.summary);
    assert.ok(summaries.includes("start-day"));
    assert.ok(summaries.includes("end-day"));
    assert.ok(res.value.events.some((e) => e.title === "End Event"));
    assert.ok(res.value.liveDays.some((d) => d.date === "2026-09-21"));
  });

  it("9. Public API gate: getPeriodPack is a function exported from index", async () => {
    assert.equal(typeof getPeriodPack, "function");
  });
});
