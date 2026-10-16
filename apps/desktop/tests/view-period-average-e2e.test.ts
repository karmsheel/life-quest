import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  VIEW_VOCABULARY,
  addDatabaseColumn,
  createDatabase,
  createVault,
  executeViewTool,
  getDatabase,
  periodsInWindow,
  runSavedView,
  runViewBlocks,
  saveView,
  upsertRow,
  windowBounds,
} from "@lifequest/vault-core";

/**
 * The two figures the dashboard could not ask for, end to end on a real vault.
 *
 * Both were reported by the operator, and both are the same missing thing seen
 * from two sides: the vocabulary could not say "the previous 4 months" and it
 * could not say "per month" or "per week". What it had was `avg`, which is the
 * average ROW — the total divided by how many transactions there were — so an
 * agent asked for "the average spend per week across the last 4 weeks" produced
 * the average transaction, a real number that answers a different question, and
 * the only honest thing it could then do was refuse.
 *
 *  1. A WINDOW OF WHOLE MONTHS. `{"kind":"previous-months","months":4}` is the
 *     four calendar months BEFORE the one today is in — 1 June to 30 September
 *     on any day of October — recomputed from the calendar on every draw, so it
 *     steps forward to 1 July..31 October by itself when the month turns and the
 *     current, partial month is never averaged in. A `custom` window would give
 *     four literal months and freeze; `last-weeks: 16` is not four months.
 *
 *  2. A PERIOD AVERAGE. `measure: "avg-per"` with `per: "week" | "month" | "day"`
 *     is the window's total divided by the CALENDAR periods it spans. It is a
 *     metric: one number, no groupBy. A month with no rows still counts, because
 *     a quiet month is a month of R0 and not a month that did not happen — which
 *     is why the divisor comes from the window and never from the rows.
 *
 * The whole thing is driven at INJECTED INSTANTS, because "every month it gets
 * recalculated" is a claim about the clock and not about a write: the same saved
 * card is run on 31 October, 1 November and 1 December and must read three
 * different numbers with nothing written between them.
 *
 * The door half is `executeViewTool` — the exact function the app's MCP door
 * calls, so this is the companion's own path and not a test-only shortcut. The
 * artifact is `e2e/artifacts/view-period-average.json`: the specs, the windows
 * they resolved to, the numbers, and the refusals, with no eyeballing. Failures
 * throw, so the artifact only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/view-period-average.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/**
 * Local noon on an ISO day.
 *
 * Noon, not midnight, for the reason `live-dashboard-e2e` records: the app's own
 * rule is the LOCAL calendar day, and a fixture built at midnight local is a
 * different UTC day in every positive-offset timezone.
 */
function noonOn(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

type Panel = { id: string; result: { rows: [string, number][] } };

/** One panel's single number, or null when it drew nothing. */
async function metricAt(root: string, spec: unknown, now: Date): Promise<number | null> {
  const run = await runViewBlocks(root, "financial", spec as never, now);
  assert.equal(run.ok, true, run.ok ? "" : run.error);
  const panel = (run as { ok: true; value: { blocks: Panel[] } }).value.blocks[0];
  const row = panel?.result.rows[0];
  return row ? row[1] : null;
}

/** One panel's whole row list, for the fold that must NOT be the average period. */
async function rowsAt(root: string, spec: unknown, now: Date): Promise<[string, number][]> {
  const run = await runViewBlocks(root, "financial", spec as never, now);
  assert.equal(run.ok, true, run.ok ? "" : run.error);
  return (run as { ok: true; value: { blocks: Panel[] } }).value.blocks[0]!.result.rows;
}

describe("view windows and period averages e2e", () => {
  it("answers the previous-months average and the per-week average, live, through the door", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-period-average-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "E2E Period Average");
    assert.equal(created.ok, true, created.ok ? "" : created.error);

    const db = await createDatabase(vaultRoot, "financial", { name: "Transactions" });
    assert.equal(db.ok, true, db.ok ? "" : db.error);
    const dbId = (db as { ok: true; value: { id: string } }).value.id;
    for (const column of [
      { name: "date", type: "date" as const },
      { name: "amount", type: "number" as const },
      { name: "payee", type: "text" as const },
    ]) {
      const added = await addDatabaseColumn(vaultRoot, "financial", dbId, column);
      assert.equal(added.ok, true, added.ok ? "" : added.error);
    }
    const live = await getDatabase(vaultRoot, "financial", dbId);
    assert.equal(live.ok, true, live.ok ? "" : live.error);
    const columns = (live as { ok: true; value: { columns: { id: string; name: string }[] } }).value.columns;
    const col = (name: string): string => {
      const found = columns.find((c) => c.name === name);
      assert.ok(found, `column ${name} is missing`);
      return found.id;
    };

    /**
     * The ledger the two windows read, laid out so every number below is a
     * literal that a wrong window, a wrong divisor, or a fold that pooled two
     * periods has to move.
     *
     *  - Four whole months before October, one amount each: 400 (June), 300
     *    (July), 200 (August), 100 (September) = 1000 over 4 months = 250.
     *  - Five October rows spread over the four Monday-start weeks ending
     *    2026-10-28: 20 + 10 in the week of the 5th, 40 in that of the 12th, 30
     *    in that of the 19th, 1000 in that of the 26th = 1100 over 4 weeks. FIVE
     *    rows in FOUR weeks is what makes the two averages different numbers:
     *    1100/4 = 275 per week against 1100/5 = 220 per row.
     *  - 999 dated in May, before the previous-4 window, and 5000 dated in
     *    January 2027, after every window this rig draws: a window that leaked
     *    either way would show it.
     */
    const seed = [
      { date: "2026-05-10", amount: 999, payee: "Before the window" },
      { date: "2026-06-10", amount: 400, payee: "June" },
      { date: "2026-07-10", amount: 300, payee: "July" },
      { date: "2026-08-10", amount: 200, payee: "August" },
      { date: "2026-09-10", amount: 100, payee: "September" },
      { date: "2026-10-06", amount: 20, payee: "Week of the 5th (a)" },
      { date: "2026-10-07", amount: 10, payee: "Week of the 5th (b)" },
      { date: "2026-10-14", amount: 40, payee: "Week of the 12th" },
      { date: "2026-10-21", amount: 30, payee: "Week of the 19th" },
      { date: "2026-10-27", amount: 1000, payee: "Week of the 26th" },
      { date: "2027-01-15", amount: 5000, payee: "After every window" },
    ];
    for (const row of seed) {
      const written = await upsertRow(vaultRoot, "financial", dbId, {
        cells: { [col("date")]: row.date, [col("amount")]: row.amount, [col("payee")]: row.payee },
      });
      assert.equal(written.ok, true, written.ok ? "" : written.error);
    }
    checks.seededRows = seed;

    // 2026-10-28 is a Wednesday, so the trailing four Monday-start weeks are
    // 5, 12, 19 and 26 October — the whole window inside one calendar month,
    // which keeps the weekly and the monthly claims from borrowing each other's
    // rows.
    const today = "2026-10-28";

    // ── 1. the vocabulary can say it ────────────────────────────────────────
    // This is the teaching surface the model is shown: a window or a measure it
    // cannot name is one it will approximate with the wrong number instead.
    const windows = VIEW_VOCABULARY.timeWindow as readonly unknown[];
    const measures = VIEW_VOCABULARY.measure as readonly string[];
    const per = VIEW_VOCABULARY.per as readonly string[];
    checks.vocabulary = { timeWindow: windows, measure: measures, per };
    assert.ok(measures.includes("avg-per"), `the vocabulary offers no avg-per measure: ${measures.join(", ")}`);
    assert.deepEqual([...per], ["day", "week", "month"], "the per vocabulary is not the three periods");
    for (const kind of ["last-months", "previous-months"]) {
      assert.ok(
        windows.some((w) => typeof w === "object" && w !== null && (w as { kind?: string }).kind === kind),
        `the view vocabulary does not offer ${kind}: ${JSON.stringify(windows)}`,
      );
    }

    // ── 2. the window bounds themselves ─────────────────────────────────────
    // Read off the engine rather than the run, so a number below cannot be right
    // by accident of some other arithmetic.
    const bounds = {
      previousFour: windowBounds({ kind: "previous-months", months: 4 }, today),
      lastFour: windowBounds({ kind: "last-months", months: 4 }, today),
      previousOneOnMarch31: windowBounds({ kind: "previous-months", months: 1 }, "2026-03-31"),
      previousOneOnNewYear: windowBounds({ kind: "previous-months", months: 1 }, "2026-01-15"),
      previousFourInNovember: windowBounds({ kind: "previous-months", months: 4 }, "2026-11-01"),
    };
    checks.windowBounds = bounds;
    assert.deepEqual(bounds.previousFour, { start: "2026-06-01", end: "2026-09-30" });
    assert.deepEqual(bounds.lastFour, { start: "2026-07-01", end: "2026-10-28" });
    // The current month is never in it, and the month that just ended always is.
    assert.deepEqual(bounds.previousFourInNovember, { start: "2026-07-01", end: "2026-10-31" });
    // A month boundary is a month boundary, whatever the month's length is.
    assert.deepEqual(bounds.previousOneOnMarch31, { start: "2026-02-01", end: "2026-02-28" });
    assert.deepEqual(bounds.previousOneOnNewYear, { start: "2025-12-01", end: "2025-12-31" });

    const periods = {
      fourMonths: periodsInWindow("2026-06-01", "2026-09-30", "month"),
      fourWeeks: periodsInWindow("2026-10-05", "2026-10-28", "week"),
      twentyEightDays: periodsInWindow("2026-10-01", "2026-10-28", "day"),
      onePartialMonth: periodsInWindow("2026-10-01", "2026-10-28", "month"),
    };
    checks.periods = periods;
    assert.deepEqual(periods, {
      fourMonths: 4,
      fourWeeks: 4,
      twentyEightDays: 28,
      onePartialMonth: 1,
    });

    // ── 3. the operator's own ask: the average of the previous 4 months ─────
    // "This needs an additional metric - the average spend per month, based on
    // the previous 4 months (not including current one)."
    const sumAmount = { measureColumnId: col("amount") };
    const monthlyAverage = {
      schemaVersion: 1 as const,
      databaseId: dbId,
      title: "Average monthly spend",
      presentation: "metric" as const,
      measure: "avg-per" as const,
      per: "month" as const,
      ...sumAmount,
      groupBy: null,
      timeBucket: null,
      timeColumnId: col("date"),
      timeWindow: { kind: "previous-months" as const, months: 4 },
      filters: [],
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
    };
    checks.monthlyAverageSpec = monthlyAverage;

    const monthly = await metricAt(vaultRoot, monthlyAverage, noonOn(today));
    checks.monthlyAverage = { on: today, value: monthly };
    assert.equal(monthly, 250, `the previous-4-months average read ${monthly}, expected 250 (1000 / 4)`);

    // ── 4. it recalculates every month, with no write anywhere ──────────────
    // The operator's own words: "Every month it gets recalculated." One saved
    // spec, four instants, no row written between them. October's rows are in
    // the CURRENT month, so they are excluded until the month turns; November
    // has no rows at all, so it counts as a month of R0 rather than being
    // dropped from the divisor.
    const saved = await saveView(vaultRoot, "financial", monthlyAverage as never);
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
    const savedId = (saved as { ok: true; value: { id: string } }).value.id;
    const monthlyAt = async (iso: string): Promise<number | null> => {
      const run = await runSavedView(vaultRoot, "financial", savedId, noonOn(iso));
      assert.equal(run.ok, true, run.ok ? "" : run.error);
      const panel = (run as { ok: true; value: { blocks: Panel[] } }).value.blocks[0];
      return panel?.result.rows[0]?.[1] ?? null;
    };
    const rollover = {
      "2026-10-31": await monthlyAt("2026-10-31"),
      "2026-11-01": await monthlyAt("2026-11-01"),
      "2026-12-01": await monthlyAt("2026-12-01"),
      "2026-03-15": await monthlyAt("2026-03-15"),
    };
    checks.monthlyRollover = rollover;
    assert.equal(rollover["2026-10-31"], 250, "the last day of the month still averages June..September");
    assert.equal(
      rollover["2026-11-01"],
      425,
      "on the 1st of November June..September is no longer the window: July + August + September " +
        "+ the whole of October (1100) = 1700 / 4",
    );
    assert.equal(
      rollover["2026-12-01"],
      350,
      "a month with no rows in it is a month of R0, not a month dropped from the divisor: " +
        "August + September + October = 1400 / 4",
    );
    assert.equal(
      rollover["2026-03-15"],
      0,
      "a period average over a window with no rows in it is R0, not a blank cell",
    );
    assert.notEqual(rollover["2026-10-31"], rollover["2026-11-01"], "the card did not follow the month");

    // ── 5. the weekly ask, and the number the old vocabulary could reach ────
    const weeklyAverage = {
      ...monthlyAverage,
      title: "Average weekly spend",
      per: "week" as const,
      timeWindow: { kind: "last-weeks" as const, weeks: 4 },
    };
    const weekly = await metricAt(vaultRoot, weeklyAverage, noonOn(today));
    checks.weeklyAverage = { on: today, value: weekly };
    assert.equal(weekly, 275, `the last-4-weeks average read ${weekly}, expected 275 (1100 / 4 weeks)`);

    // The same window with `avg`, which is the average ROW: 1100 over five rows.
    // This is the number the dashboard could produce BEFORE this change, and the
    // reason "the average spend per week" came back wrong rather than absent.
    const perRow = await metricAt(
      vaultRoot,
      { ...weeklyAverage, title: "Average transaction", measure: "avg" as const, per: null },
      noonOn(today),
    );
    checks.oldVocabulary = {
      what: "measure 'avg' over the same 4-week window — the average ROW, not the average week",
      averageRow: perRow,
    };
    assert.equal(
      perRow,
      220,
      "the average ROW over the same window is 220 — a real number that is not the average week, " +
        "and the whole reason measure 'avg-per' had to exist",
    );
    assert.notEqual(perRow, weekly, "the two averages must not be the same number in this fixture");

    // ── 6. `avg` divides by rows, `avg-per` by the calendar ────────────────
    // A per-DAY average over a bounded window, so a fold that divided by the
    // five rows of October (220) instead of by its 28 days (39.29) is visible.
    const dailyAverage = {
      ...monthlyAverage,
      title: "Average daily spend this month",
      per: "day" as const,
      timeWindow: "this-month" as const,
    };
    const daily = await metricAt(vaultRoot, dailyAverage, noonOn(today));
    checks.dailyAverage = { on: today, value: daily, expected: 1100 / 28 };
    assert.ok(
      daily !== null && Math.abs(daily - 1100 / 28) < 0.0001,
      `the per-day average read ${daily}, expected ${1100 / 28} (1100 over 28 days)`,
    );

    // And the month it is not: the same window with a month divisor is 1100/1.
    const lastMonths = await metricAt(
      vaultRoot,
      { ...monthlyAverage, title: "Last 4 months", timeWindow: { kind: "last-months" as const, months: 4 } },
      noonOn(today),
    );
    checks.lastMonthsAverage = lastMonths;
    assert.equal(
      lastMonths,
      425,
      "the trailing-4-months window includes the current, partial one: July..October = 1700 / 4",
    );

    // ── 7. an average of a COUNT, not of an amount ─────────────────────────
    // `measureColumnId` is optional for `avg-per`, and that is how "how many
    // transactions a week" is asked: five rows over four weeks.
    const countPerWeek = await metricAt(
      vaultRoot,
      {
        ...weeklyAverage,
        title: "Transactions per week",
        measureColumnId: undefined,
      },
      noonOn(today),
    );
    checks.countPerWeek = countPerWeek;
    assert.equal(countPerWeek, 1.25, `the per-week count read ${countPerWeek}, expected 1.25 (5 / 4)`);

    // ── 8. the door: the companion's own two calls ─────────────────────────
    // preview_view is what the agent checks with; save_view is the one call that
    // saves AND pins. Both go through executeViewTool, which is the function the
    // app's MCP door calls for every companion tool call.
    const preview = (await executeViewTool(vaultRoot, ACTOR, "preview_view", {
      domainSlug: "financial",
      spec: monthlyAverage,
    })) as { blocks?: { rows: [string, number][] }[]; error?: { message: string } };
    checks.preview = preview.error ?? preview.blocks?.[0]?.rows ?? null;
    assert.equal(preview.error, undefined, `preview_view refused the average card: ${preview.error?.message}`);
    assert.deepEqual(preview.blocks?.[0]?.rows, [["value", 250]]);

    const applied = (await executeViewTool(vaultRoot, ACTOR, "save_view", {
      domainSlug: "financial",
      boardSlug: null,
      spec: { ...monthlyAverage, title: "Average monthly spend (previous 4 months)" },
      span: 2,
    })) as {
      applied?: boolean;
      viewId?: string;
      card?: { blocks?: { rows: [string, number][] }[] };
      error?: { message: string };
    };
    checks.saveView = applied;
    assert.equal(applied.error, undefined, `save_view failed: ${applied.error?.message}`);
    assert.equal(applied.applied, true, `save_view did not land: ${JSON.stringify(applied)}`);
    assert.deepEqual(
      applied.card?.blocks?.[0]?.rows,
      [["value", 250]],
      "the reply did not carry the card's own number, so the companion cannot report it without a second call",
    );
    const pinned = await runSavedView(vaultRoot, "financial", applied.viewId as string, noonOn("2026-11-01"));
    assert.equal(pinned.ok, true, pinned.ok ? "" : pinned.error);
    const pinnedValue = (pinned as { ok: true; value: { blocks: Panel[] } }).value.blocks[0]?.result.rows[0]?.[1];
    checks.pinnedCardInNovember = pinnedValue;
    assert.equal(pinnedValue, 425, "the card the door saved did not recalculate when the month turned");

    // ── 9. a wrong spec is answered, not just refused ──────────────────────
    // The three mistakes an agent makes with this measure, each of which must
    // come back naming the field to add rather than the rule it broke.
    const refusals: Record<string, string> = {};
    const refused = async (label: string, spec: Record<string, unknown>): Promise<void> => {
      const reply = (await executeViewTool(vaultRoot, ACTOR, "preview_view", {
        domainSlug: "financial",
        spec: { ...monthlyAverage, ...spec },
      })) as {
        error?: {
          message: string;
          fix?: {
            allowed?: { measure?: string[]; per?: string[] };
            workingSpecs?: Record<string, unknown>;
            rules?: string[];
          };
        };
      };
      assert.ok(reply.error, `${label} was accepted, and it should have been refused`);
      refusals[label] = reply.error.message;
      const fix = reply.error.fix;
      assert.ok(fix?.allowed?.measure?.includes("avg-per"), `${label}: the fix does not offer avg-per`);
      assert.ok(
        fix?.workingSpecs?.averagePerMonth && fix?.workingSpecs?.averagePerWeek,
        `${label}: the fix carries no copyable average spec`,
      );
      assert.ok(
        (fix?.rules ?? []).some((r) => r.includes("avg-per")),
        `${label}: the rules do not explain the period average`,
      );
    };
    await refused("avg with a per", { measure: "avg", per: "month" });
    await refused("avg-per without a per", { per: null });
    await refused("avg-per over all time", { timeWindow: "all" });
    await refused("avg-per on a grouped table", { presentation: "table", groupBy: col("date") });
    checks.refusals = refusals;
    assert.match(refusals["avg with a per"] ?? "", /per/, "the refusal does not name per");
    assert.match(
      refusals["avg-per without a per"] ?? "",
      /'day', 'week' or 'month'/,
      "the refusal does not name the periods it accepts",
    );
    assert.match(
      refusals["avg-per over all time"] ?? "",
      /bounded timeWindow|previous-months/,
      "the refusal does not name a window that would work",
    );
    assert.match(
      refusals["avg-per on a grouped table"] ?? "",
      /metric/,
      "the refusal does not say that a period average is a metric",
    );

    // ── the artifact ───────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what:
        "a view can average per calendar period over the previous N whole months, and the window " +
        "recalculates as the month turns with no write",
      command: "npm test  (this file: tests/view-period-average-e2e.test.ts)",
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
