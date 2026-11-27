import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  archiveDomain,
  createDomain,
  createVault,
  currentPeriod,
  defineMetric,
  getAnalyticsMatrix,
  getDatabase,
  insertRows,
  installFinanceKit,
  listMetricEvents,
  logMetric,
  periodBounds,
  periodLabel,
  previousPeriod,
  unlockDomain,
  vaultPaths,
} from "@lifequest/vault-core";
import type {
  AnalyticsMatrix,
  AnalyticsMetricRow,
  ReviewCadence,
  WeekStartDay,
} from "@lifequest/vault-core";

/**
 * The Analytics engine, end to end, against a real vault on disk and real
 * SQLite: the matrix the Phase 6 page draws, and the events list its cell panel
 * uses to log and edit a metric's rows.
 *
 * Runs with `node --experimental-strip-types --test tests/analytics-engine-e2e.test.ts`,
 * so it needs no Electron, no dev server and no window. Every assertion is
 * against the shipped engine — the same `runView` path a review figure and a
 * dashboard card take — never a mock.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A matrix that folds its own numbers instead of asking the view engine:
 *     the events counts would disagree with `getMetricsSummary` and a review
 *     figure on the same rows.
 *  2. A window ignored: a previous-period row leaking into this period's cell,
 *     or a cell's delta compared against the wrong period.
 *  3. The oldest column with no delta even though the period before it has
 *     data: the matrix must read one extra older window.
 *  4. A fabricated zero: a metric with no rows in a window must print
 *     `valueText: null` (the UI's no-data marker), never "0".
 *  5. A delta with a unit: the delta is a change, not a measurement; it must be
 *     signed and unitless ("+2", not "+2 sessions").
 *  6. A magnitude applied to the query: Cash out must print 3,000 (positive)
 *     while the ledger row stays -3,000, and its delta must be +1,000.
 *  7. Deltas computed from raw values rather than the DISPLAYED ones: a
 *     negated or abs metric would then disagree with its cells.
 *  8. A malformed definition file taking the page down, or hiding healthy rows.
 *  9. A read that creates the events table: a matrix or events list on a vault
 *     with no rows must not grow one.
 * 10. Scoping wrong: Life must group every live area (archived excluded), an
 *     area lens must answer only that area, and a stale lens must be an empty
 *     matrix with a problem rather than a throw.
 * 11. Events listing wrong: rows from another event key, rows outside the
 *     window, a non-events metric, or a column-id map that does not match the
 *     metrics database the row path writes to.
 * 12. An artifact written by a failing run: the artifact is written only at the
 *     end, after every assertion held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/analytics-engine.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

const CADENCE: ReviewCadence = "weekly";
const WEEK_START: WeekStartDay = "monday";

type Window = { period: string; label: string; start: string; end: string };

/**
 * The period windows the matrix reads: `count` DISPLAYED columns oldest→newest
 * plus the one extra older window the oldest column's delta compares against.
 * Index 0 is the extra window; indexes 1..count are the columns.
 */
function weeklyWindows(count: number): Window[] {
  const periods: string[] = [currentPeriod(CADENCE, WEEK_START)];
  for (let index = 0; index < count; index += 1) {
    const previous = previousPeriod(CADENCE, periods[periods.length - 1]!, WEEK_START);
    assert.equal(previous.ok, true, "the test could not walk the weekly periods back");
    periods.push(previous.ok ? previous.value : "");
  }
  periods.reverse();
  const windows = periods.map((period) => {
    const bounds = periodBounds(CADENCE, period, WEEK_START);
    assert.equal(bounds.ok, true, `the test could not bound ${period}`);
    return {
      period,
      label: periodLabel(CADENCE, period, WEEK_START),
      start: bounds.ok ? bounds.value.start : "",
      end: bounds.ok ? bounds.value.end : "",
    };
  });
  assert.equal(windows.length, count + 1);
  return windows;
}

/** A local calendar date `days` after `date`. */
function plusDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year!, month! - 1, day! + days));
  return at.toISOString().slice(0, 10);
}

function rowFor(matrix: AnalyticsMatrix, areaSlug: string, metricId: string): AnalyticsMetricRow {
  const row = matrix.rows.find(
    (candidate) => candidate.areaSlug === areaSlug && candidate.metricId === metricId,
  );
  assert.ok(row, `the matrix has no ${areaSlug}/${metricId} row`);
  return row!;
}

/** A signed delta text read back as a number: "+4,000" -> 4000, "-1" -> -1. */
function deltaNumber(text: string | null): number | null {
  if (text === null) return null;
  const sign = text.startsWith("-") ? -1 : 1;
  const digits = text.replace(/^[+-]/, "").replace(/,/g, "");
  assert.match(digits, /^\d+(\.\d+)?$/, `delta is not a plain number: ${text}`);
  return sign * Number(digits);
}

async function seedFinance(
  vaultRoot: string,
  windows: Window[],
): Promise<{ current: Window; previous: Window }> {
  const current = windows[windows.length - 1]!;
  const previous = windows[windows.length - 2]!;
  const accounts = await insertRows(vaultRoot, "financial", "finance:accounts", [
    { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
  ]);
  assert.equal(accounts.ok, true, "the rig could not create the finance account");
  const categories = await insertRows(vaultRoot, "financial", "finance:categories", [
    { id: "cat-salary", cells: { name: "Salary" } },
    { id: "cat-groceries", cells: { name: "Groceries" } },
  ]);
  assert.equal(categories.ok, true, "the rig could not create the finance categories");
  // Current period: income 5,000, expense -3,000, a transfer pair (-1,000/+1,000
  // that gross figures must exclude and net must include).
  // Previous period: income 1,000, expense -2,000. The weekly fixture is dated
  // from the period windows, so the test is not tied to one calendar week.
  const posted = await insertRows(vaultRoot, "financial", "finance:transactions", [
    {
      id: "t-income",
      cells: {
        date: plusDays(current.start, 1),
        amount: 5000,
        account: "acc-1",
        category: "cat-salary",
        payee: "Employer",
      },
    },
    {
      id: "t-expense",
      cells: {
        date: plusDays(current.start, 2),
        amount: -3000,
        account: "acc-1",
        category: "cat-groceries",
        payee: "Checkers",
      },
    },
    {
      id: "t-transfer-out",
      cells: { date: plusDays(current.start, 3), amount: -1000, account: "acc-1", payee: "Savings", transfer_id: "tr-1" },
    },
    {
      id: "t-transfer-in",
      cells: { date: plusDays(current.start, 3), amount: 1000, account: "acc-1", payee: "Cheque", transfer_id: "tr-1" },
    },
    {
      id: "t-prev-income",
      cells: { date: plusDays(previous.start, 1), amount: 1000, account: "acc-1", category: "cat-salary" },
    },
    {
      id: "t-prev-expense",
      cells: { date: plusDays(previous.start, 2), amount: -2000, account: "acc-1", category: "cat-groceries" },
    },
  ]);
  assert.equal(posted.ok, true, "the rig could not post the finance transactions");
  return { current, previous };
}

describe("analytics engine e2e", () => {
  it("answers the matrix and the events list from real vault data", async () => {
    fs.rmSync(ARTIFACT, { force: true });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-analytics-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    try {
      const created = await createVault(vaultRoot, "Analytics Rig");
      assert.equal(created.ok, true, "the rig could not create a vault");
      for (const slug of ["health", "financial"]) {
        const unlocked = await unlockDomain(vaultRoot, slug);
        assert.equal(unlocked.ok, true, `unlockDomain(${slug}) failed`);
      }
      const kit = await installFinanceKit(vaultRoot, ACTOR);
      assert.equal(kit.ok, true, "the finance kit did not install");

      // ── definitions: four events metrics, one deliberately silent ─────────
      const definitions: Array<{ id: string; unit: string; aggregation: "count" | "sum"; eventKey: string }> = [
        { id: "training-sessions", unit: "sessions", aggregation: "count", eventKey: "training" },
        { id: "training-minutes", unit: "minutes", aggregation: "sum", eventKey: "training" },
        { id: "reading-sessions", unit: "sessions", aggregation: "count", eventKey: "reading" },
        { id: "prayer-sessions", unit: "sessions", aggregation: "count", eventKey: "prayer" },
        { id: "never-logged", unit: "sessions", aggregation: "count", eventKey: "nothing" },
      ];
      for (const definition of definitions) {
        const defined = await defineMetric(
          vaultRoot,
          "health",
          {
            id: definition.id,
            label: definition.id,
            unit: definition.unit,
            source: "events",
            eventKey: definition.eventKey,
            aggregation: definition.aggregation,
          },
          ACTOR,
        );
        assert.equal(defined.ok, true, `defining ${definition.id} failed: ${defined.ok ? "" : defined.error}`);
      }

      const windows = weeklyWindows(8);
      const extra = windows[0]!;
      const displayed = windows.slice(1);
      const current = windows[windows.length - 1]!;
      const previous = windows[windows.length - 2]!;
      checks.windows = { extra, displayed, current, previous };

      // training: 3 sessions / 120 minutes this period, 1 / 45 the period before
      // — the two periods a cell and its delta read.
      const training: Array<[string, number]> = [
        [current.start, 40],
        [plusDays(current.start, 1), 40],
        [plusDays(current.start, 2), 40],
        [previous.start, 45],
      ];
      for (const [date, value] of training) {
        const logged = await logMetric(vaultRoot, "health", "training-minutes", { date, value }, ACTOR);
        assert.equal(logged.ok, true, "logging a training event failed");
      }
      // reading: one event in every DISPLAYED period and none in the extra older
      // window — the oldest column's delta must be null (the period before it
      // has no rows), while every later column's delta is "0".
      for (const window of displayed) {
        const logged = await logMetric(vaultRoot, "health", "reading-sessions", { date: window.start, note: "read" }, ACTOR);
        assert.equal(logged.ok, true, "logging a reading event failed");
      }
      // prayer: one event in every window INCLUDING the extra older one — the
      // oldest column's delta must then be "0", which is only possible if the
      // matrix read the extra window.
      for (const window of windows) {
        const logged = await logMetric(vaultRoot, "health", "prayer-sessions", { date: window.start }, ACTOR);
        assert.equal(logged.ok, true, "logging a prayer event failed");
      }
      const financeWindows = await seedFinance(vaultRoot, windows);

      // ── the Life lens: every live area, in vault order ──────────────────
      const startedAt = Date.now();
      const life = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: null });
      const elapsedMs = Date.now() - startedAt;
      assert.equal(life.ok, true, `the Life matrix failed: ${life.ok ? "" : life.error}`);
      const matrix = life.ok ? life.value : null;
      assert.ok(matrix, "the Life matrix answered nothing");
      checks.lifePerf = { elapsedMs, rows: matrix!.rows.length, periods: matrix!.periods.length };
      assert.equal(matrix!.cadence, CADENCE);
      assert.equal(matrix!.lens, null);
      assert.equal(matrix!.problems.length, 0, `the clean vault reported problems: ${matrix!.problems.join("; ")}`);
      assert.equal(
        Number.isNaN(Date.parse(matrix!.asOf)),
        false,
        "the matrix's asOf is not an ISO instant",
      );
      checks.lifeAsOf = matrix!.asOf;

      // 8 columns, oldest→newest, ending at the cadence's current period, each
      // carrying its label and the exact window bounds.
      assert.equal(matrix!.periods.length, 8, "the matrix is not 8 period columns");
      assert.deepEqual(
        matrix!.periods.map((period) => period.period),
        displayed.map((window) => window.period),
        "the matrix columns are not the last 8 periods oldest→newest",
      );
      assert.equal(matrix!.periods[7]!.period, current.period, "the matrix does not end at the current period");
      for (const [index, period] of matrix!.periods.entries()) {
        const window = displayed[index]!;
        assert.equal(period.label, window.label, "a column label is not the period label");
        assert.equal(period.start, window.start, "a column start is not the period start");
        assert.equal(period.end, window.end, "a column end is not the period end");
      }

      // Rows grouped by area in vault order: Health's definitions, then
      // Finance's shipped three, each area's definitions in definition order.
      const areaOrder: string[] = [];
      for (const row of matrix!.rows) {
        if (areaOrder[areaOrder.length - 1] !== row.areaSlug) areaOrder.push(row.areaSlug);
      }
      assert.deepEqual(areaOrder, ["health", "financial"], "the Life lens did not group live areas in vault order");
      assert.equal(
        matrix!.rows.filter((row) => row.areaSlug === "health").length,
        5,
        "the Life matrix did not include every Health definition",
      );
      assert.deepEqual(
        matrix!.rows.filter((row) => row.areaSlug === "financial").map((row) => row.metricId),
        ["cash-in", "cash-out", "net-cash-flow"],
        "the Finance definitions are not in definition order",
      );
      assert.equal(
        matrix!.rows.every((row) => row.cells.length === 8),
        true,
        "a row does not have one cell per column",
      );
      assert.equal(rowFor(matrix!, "health", "training-sessions").areaName, "Health");
      assert.equal(rowFor(matrix!, "financial", "cash-in").areaName, "Finance");

      // ── events rows: counts and sums across the two periods ──────────────
      const sessions = rowFor(matrix!, "health", "training-sessions");
      const minutes = rowFor(matrix!, "health", "training-minutes");
      checks.sessions = sessions;
      checks.minutes = minutes;
      assert.equal(sessions.source, "events");
      assert.equal(sessions.aggregation, "count");
      assert.equal(sessions.databaseId, null, "an events row names a source database it does not have");
      assert.equal(minutes.aggregation, "sum");
      assert.equal(sessions.cells[7]!.valueText, "3 sessions", "this period's session count is not 3");
      assert.equal(minutes.cells[7]!.valueText, "120 minutes", "this period's minutes are not 120");
      assert.equal(sessions.cells[6]!.valueText, "1 sessions", "last period's session count is not 1");
      assert.equal(minutes.cells[6]!.valueText, "45 minutes", "last period's minutes are not 45");
      assert.equal(sessions.cells[7]!.deltaText, "+2", "the session delta is not +2");
      assert.equal(minutes.cells[7]!.deltaText, "+75", "the minutes delta is not +75");

      // Every earlier training column is no-data, and a no-data cell has no
      // delta either — never a fabricated 0.
      for (const cell of sessions.cells.slice(0, 6)) {
        assert.equal(cell.valueText, null, "a no-data training cell printed a value");
        assert.equal(cell.deltaText, null, "a no-data training cell printed a delta");
      }
      const never = rowFor(matrix!, "health", "never-logged");
      assert.equal(
        never.cells.every((cell) => cell.valueText === null && cell.deltaText === null),
        true,
        "a metric with no rows printed a value or a delta",
      );
      checks.neverLogged = never;

      // The extra older window is load-bearing: reading has no data before the
      // oldest column, so that one delta is null; prayer does, so it reads "0".
      const reading = rowFor(matrix!, "health", "reading-sessions");
      const prayer = rowFor(matrix!, "health", "prayer-sessions");
      assert.equal(reading.cells[0]!.valueText, "1 sessions");
      assert.equal(reading.cells[0]!.deltaText, null, "the oldest column invented a delta with no older rows");
      assert.equal(reading.cells[1]!.deltaText, "0", "the second column's delta is not 0");
      assert.equal(
        reading.cells.slice(2).every((cell) => cell.deltaText === "0"),
        true,
        "a reading delta is not 0 across equal columns",
      );
      assert.equal(prayer.cells[0]!.deltaText, "0", "the oldest column did not read the extra older window");

      // ── derived finance rows: gross in/out and net, magnitude display ────
      const cashIn = rowFor(matrix!, "financial", "cash-in");
      const cashOut = rowFor(matrix!, "financial", "cash-out");
      const net = rowFor(matrix!, "financial", "net-cash-flow");
      checks.finance = { cashIn, cashOut, net };
      assert.equal(cashIn.source, "derived");
      assert.equal(cashIn.databaseId, "finance:transactions", "a derived row lost its source database id");
      assert.equal(cashOut.databaseId, "finance:transactions");
      assert.equal(cashIn.cells[7]!.valueText, "5,000 (ZAR)", "cash in is not 5,000 (ZAR)");
      assert.equal(cashOut.cells[7]!.valueText, "3,000 (ZAR)", "cash out did not print positive");
      assert.equal(net.cells[7]!.valueText, "2,000 (ZAR)", "net cash flow is not 2,000 (ZAR)");
      assert.equal(cashIn.cells[6]!.valueText, "1,000 (ZAR)");
      assert.equal(cashOut.cells[6]!.valueText, "2,000 (ZAR)");
      assert.equal(net.cells[6]!.valueText, "-1,000 (ZAR)", "last period's net did not keep its sign");
      assert.equal(deltaNumber(cashIn.cells[7]!.deltaText), 4000, "the cash-in delta is not +4,000");
      assert.equal(deltaNumber(cashOut.cells[7]!.deltaText), 1000, "the cash-out delta is not +1,000");
      assert.equal(deltaNumber(net.cells[7]!.deltaText), 3000, "the net delta is not +3,000");
      assert.equal(cashOut.direction, "neutral");
      assert.equal(cashOut.target, null);
      assert.equal(cashIn.cells[7]!.deltaText, "+4,000", "the delta carries a unit or the wrong grouping");

      // Deltas equal this column's displayed value minus the previous column's:
      // where either displayed value is missing the delta is null. The oldest
      // column's previous window is the extra one, asserted explicitly above.
      for (const row of matrix!.rows) {
        for (let index = 1; index < row.cells.length; index += 1) {
          const cell = row.cells[index]!;
          const previousCell = row.cells[index - 1]!;
          if (cell.valueText === null || previousCell.valueText === null) {
            assert.equal(cell.deltaText, null, `${row.areaSlug}/${row.metricId}[${index}] has a delta with no value`);
          } else {
            assert.notEqual(
              cell.deltaText,
              null,
              `${row.areaSlug}/${row.metricId}[${index}] has a value and a previous value but no delta`,
            );
          }
        }
      }
      checks.deltaChecked = true;

      // ── an area lens answers only that area ─────────────────────────────
      const finance = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: "financial" });
      assert.equal(finance.ok, true);
      const financeMatrix = finance.ok ? finance.value : null;
      assert.equal(financeMatrix!.lens, "financial");
      assert.equal(
        financeMatrix!.rows.every((row) => row.areaSlug === "financial"),
        true,
        "the Finance lens leaked another area's rows",
      );
      assert.equal(financeMatrix!.rows.length, 3, "the Finance lens did not answer its three definitions");
      checks.financeLens = financeMatrix;

      // A stale lens (unknown or archived) is an empty matrix with a problem,
      // not a throw: a cached page link is the operator's, not a server fault.
      for (const staleLens of ["no-such-area", "mind"]) {
        const stale = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: staleLens });
        assert.equal(stale.ok, true, `lens ${staleLens} threw instead of answering empty`);
        const staleMatrix = stale.ok ? stale.value : null;
        assert.equal(staleMatrix!.rows.length, 0, `lens ${staleLens} answered rows`);
        assert.equal(staleMatrix!.problems.length, 1, `lens ${staleLens} did not report a problem`);
        assert.equal(staleMatrix!.periods.length, 8, "a stale lens lost the period columns");
      }

      // ── archived areas are excluded, not reported ───────────────────────
      const garden = await createDomain(vaultRoot, { name: "Garden", slug: "garden" });
      assert.equal(garden.ok, true, "the rig could not create the Garden area");
      const gardenMetric = await defineMetric(
        vaultRoot,
        "garden",
        {
          id: "watering",
          label: "Watering sessions",
          unit: "sessions",
          source: "events",
          eventKey: "watering",
          aggregation: "count",
        },
        ACTOR,
      );
      assert.equal(gardenMetric.ok, true, "the rig could not define the Garden metric");
      const watered = await logMetric(vaultRoot, "garden", "watering", { date: current.start }, ACTOR);
      assert.equal(watered.ok, true, "the rig could not log the Garden event");
      const withGarden = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: null });
      assert.equal(withGarden.ok, true);
      assert.equal(
        (withGarden.ok ? withGarden.value : null)!.rows.some((row) => row.areaSlug === "garden"),
        true,
        "a live area's metric is missing from the Life lens",
      );
      const archived = await archiveDomain(vaultRoot, "garden");
      assert.equal(archived.ok, true, "the rig could not archive Garden");
      const afterArchive = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: null });
      assert.equal(afterArchive.ok, true);
      const archivedMatrix = afterArchive.ok ? afterArchive.value : null;
      assert.equal(
        archivedMatrix!.rows.some((row) => row.areaSlug === "garden"),
        false,
        "an archived area's metric is still in the Life lens",
      );
      assert.equal(archivedMatrix!.problems.length, 0, "an archived area was reported as a problem");
      checks.archived = {
        areas: [...new Set(archivedMatrix!.rows.map((row) => row.areaSlug))],
      };

      // ── a malformed file is reported; healthy rows still answer ─────────
      const brokenFile = path.join(
        vaultPaths(vaultRoot).domainMetricsDir("health"),
        "broken.json",
      );
      fs.writeFileSync(brokenFile, "{ this is not json\n");
      // A well-formed but unanswerable definition: its source database is gone.
      const unanswerableFile = path.join(
        vaultPaths(vaultRoot).domainMetricsDir("health"),
        "gone.json",
      );
      fs.writeFileSync(
        unanswerableFile,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "gone",
            domainSlug: "health",
            label: "Gone",
            unit: "pages",
            source: "derived",
            spec: {
              databaseId: "does-not-exist",
              title: "Gone",
              presentation: "metric",
              groupBy: null,
              timeBucket: null,
              timeColumnId: "date",
              timeWindow: "all",
              filters: [],
              measure: "sum",
              measureColumnId: "amount",
              per: null,
              sort: { by: "value", dir: "desc" },
              limit: 12,
              convertToZar: false,
              columns: [],
            },
            aggregation: "sum",
            createdBy: "user",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      const tolerant = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: "health" });
      assert.equal(tolerant.ok, true, "a malformed definition took the matrix down");
      const tolerantMatrix = tolerant.ok ? tolerant.value : null;
      checks.problems = tolerantMatrix!.problems;
      assert.equal(
        tolerantMatrix!.problems.some((problem) => problem.includes("broken.json")),
        true,
        "the malformed definition file was not reported",
      );
      assert.equal(
        tolerantMatrix!.problems.some((problem) => problem.includes("gone.json")),
        true,
        "the unanswerable definition was not reported",
      );
      assert.equal(
        rowFor(tolerantMatrix!, "health", "training-sessions").cells[7]!.valueText,
        "3 sessions",
        "a healthy row stopped answering beside a bad file",
      );
      assert.equal(
        tolerantMatrix!.rows.some((row) => row.metricId === "gone"),
        true,
        "an unanswerable definition lost its row (it should answer nulls, not vanish)",
      );
      assert.equal(
        rowFor(tolerantMatrix!, "health", "gone").cells.every((cell) => cell.valueText === null),
        true,
        "an unanswerable definition printed a value",
      );
      fs.rmSync(brokenFile, { force: true });
      fs.rmSync(unanswerableFile, { force: true });

      // ── a read must not create the events table ─────────────────────────
      const emptyVault = path.join(workDir, "empty");
      const emptyCreated = await createVault(emptyVault, "Empty Rig");
      assert.equal(emptyCreated.ok, true);
      const emptyUnlock = await unlockDomain(emptyVault, "health");
      assert.equal(emptyUnlock.ok, true);
      const noTableBefore = await getDatabase(emptyVault, "health", "metrics");
      assert.equal(noTableBefore.ok, false, "the empty vault already had a Metrics database");
      const emptyMatrix = await getAnalyticsMatrix(emptyVault, { cadence: CADENCE, lens: null });
      assert.equal(emptyMatrix.ok, true);
      assert.equal((emptyMatrix.ok ? emptyMatrix.value : null)!.rows.length, 0);
      const noTableAfter = await getDatabase(emptyVault, "health", "metrics");
      assert.equal(noTableAfter.ok, false, "reading the matrix created the Metrics database");

      // ── listMetricEvents: filter by eventKey and window, ids for editing ─
      const trainingEvents = await listMetricEvents(vaultRoot, {
        area: "health",
        metricId: "training-minutes",
        start: current.start,
        end: current.end,
      });
      assert.equal(trainingEvents.ok, true, `listing the period's training events failed: ${trainingEvents.ok ? "" : trainingEvents.error}`);
      const events = trainingEvents.ok ? trainingEvents.value : null;
      checks.events = events;
      assert.equal(events!.areaSlug, "health");
      assert.equal(events!.metricId, "training-minutes");
      assert.equal(events!.eventKey, "training");
      assert.equal(events!.databaseId, "metrics");
      assert.equal(events!.rows.length, 3, "the period's three training rows are not three events");
      assert.deepEqual(
        events!.rows.map((row) => row.value),
        [40, 40, 40],
        "the events list values are not the logged minutes",
      );
      assert.equal(
        events!.rows.every((row) => row.date >= current.start && row.date <= current.end),
        true,
        "the events list leaked a row outside the window",
      );
      assert.equal(
        events!.rows.some((row) => row.note === "read"),
        false,
        "the events list leaked another event key's row",
      );
      assert.deepEqual(
        events!.rows.map((row) => row.date),
        [...events!.rows.map((row) => row.date)].sort().reverse(),
        "the events list is not newest first",
      );
      // The minted column ids must be the metrics database's own, so the row
      // path the panel calls writes the cells the definition reads.
      const metricsDbRes = await getDatabase(vaultRoot, "health", "metrics");
      assert.equal(metricsDbRes.ok, true);
      const dbColumns = new Map(
        (metricsDbRes.ok ? metricsDbRes.value.columns : []).map((column) => [column.name, column.id]),
      );
      assert.deepEqual(events!.columns, {
        date: dbColumns.get("date"),
        metric: dbColumns.get("metric"),
        value: dbColumns.get("value"),
        note: dbColumns.get("note"),
      });
      assert.equal(
        events!.columns.metric,
        dbColumns.get("metric"),
        "the events list's metric column id is not the database's",
      );

      // A derived metric has no rows to list.
      const derivedEvents = await listMetricEvents(vaultRoot, {
        area: "financial",
        metricId: "cash-in",
        start: current.start,
        end: current.end,
      });
      assert.equal(derivedEvents.ok, false, "a derived metric listed logged events");
      assert.match(
        derivedEvents.ok ? "" : derivedEvents.error,
        /derived/i,
        "the derived-metric refusal does not explain that it is derived",
      );

      // A window with no events answers an empty list, not an error.
      const emptyWindow = await listMetricEvents(vaultRoot, {
        area: "health",
        metricId: "training-sessions",
        start: extra.start,
        end: extra.end,
      });
      assert.equal(emptyWindow.ok, true);
      assert.equal((emptyWindow.ok ? emptyWindow.value : null)!.rows.length, 0);

      // ── log an event, then the next matrix reflects it ──────────────────
      const addition = await logMetric(vaultRoot, "health", "training-sessions", { note: "extra" }, ACTOR);
      assert.equal(addition.ok, true, "logging one more session failed");
      const afterLog = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: "health" });
      assert.equal(afterLog.ok, true);
      const afterLogMatrix = afterLog.ok ? afterLog.value : null;
      assert.equal(
        rowFor(afterLogMatrix!, "health", "training-sessions").cells[7]!.valueText,
        "4 sessions",
        "the matrix did not pick up the logged event",
      );
      checks.afterLog = rowFor(afterLogMatrix!, "health", "training-sessions").cells[7];

      // ── define a metric, then it appears ───────────────────────────────
      const definedNow = await defineMetric(
        vaultRoot,
        "health",
        {
          id: "energy-sessions",
          label: "Energy sessions",
          unit: "sessions",
          source: "events",
          eventKey: "energy",
          aggregation: "count",
        },
        ACTOR,
      );
      assert.equal(definedNow.ok, true, `defining energy-sessions failed: ${definedNow.ok ? "" : definedNow.error}`);
      const afterDefine = await getAnalyticsMatrix(vaultRoot, { cadence: CADENCE, lens: "health" });
      assert.equal(afterDefine.ok, true);
      const newRow = rowFor(afterDefine.ok ? afterDefine.value : null!, "health", "energy-sessions");
      assert.equal(newRow.label, "Energy sessions");
      assert.equal(newRow.cells.length, 8);
      assert.equal(
        newRow.cells.every((cell) => cell.valueText === null),
        true,
        "a freshly defined, unlogged metric printed a value",
      );
      checks.definedNow = newRow;

      // ── count: the page asks for its own column count ───────────────────
      const threeColumns = await getAnalyticsMatrix(vaultRoot, {
        cadence: CADENCE,
        lens: null,
        count: 3,
      });
      assert.equal(threeColumns.ok, true);
      const threeMatrix = threeColumns.ok ? threeColumns.value : null;
      assert.equal(threeMatrix!.periods.length, 3, "count did not control the column count");
      assert.equal(
        threeMatrix!.rows.every((row) => row.cells.length === 3),
        true,
        "a row does not follow the requested column count",
      );
      assert.equal(threeMatrix!.periods[2]!.period, current.period);
      checks.threeColumns = threeMatrix!.periods;

      // Monthly cadence reaches the same engine through the same call.
      const monthly = await getAnalyticsMatrix(vaultRoot, {
        cadence: "monthly",
        lens: "health",
        count: 2,
      });
      assert.equal(monthly.ok, true);
      const monthlyMatrix = monthly.ok ? monthly.value : null;
      assert.equal(monthlyMatrix!.cadence, "monthly");
      assert.equal(monthlyMatrix!.periods.length, 2);
      const currentMonthly = currentPeriod("monthly", WEEK_START);
      const previousMonthly = previousPeriod("monthly", currentMonthly, WEEK_START);
      assert.equal(previousMonthly.ok, true);
      assert.deepEqual(
        monthlyMatrix!.periods.map((period) => period.period),
        previousMonthly.ok ? [previousMonthly.value, currentMonthly] : [],
        "the monthly columns are not the last two months ending at the current one",
      );
      checks.monthly = monthlyMatrix!.periods;

      const report = {
        pass: true,
        what:
          "the Analytics matrix against a real vault: events counts/sums across two periods, derived finance rows " +
          "with gross cash in/out and net (Cash out printed positive), magnitude-aware deltas for every column including " +
          "the extra older window behind the oldest column, null cells and null deltas for no data, Life vs area lens " +
          "scoping with archived areas excluded, 8 labelled columns ending at the current period, a malformed and an " +
          "unanswerable definition reported without hiding healthy rows, a read that does not create the events table, " +
          "listMetricEvents filtered by eventKey/window with the metrics database's minted column ids, and logging/defining " +
          "showing up on the next matrix read",
        command: "node --experimental-strip-types --test tests/analytics-engine-e2e.test.ts",
        checks,
        generatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
