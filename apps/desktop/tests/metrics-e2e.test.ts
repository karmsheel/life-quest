import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  compileMetricSpec,
  compileMetricSpecForVault,
  createVault,
  defaultReviewSkill,
  defineMetric,
  ensureReview,
  ensureReviewSkill,
  executeMetricsTool,
  formatSnapshotNumber,
  getDatabase,
  getMetric,
  getMetricsSummary,
  getReviewSkill,
  installFinanceKit,
  insertRows,
  listMetricDefinitions,
  listRows,
  logMetric,
  previousPhase4DefaultReviewSkill,
  previousShippedDefaultReviewSkill,
  prepopulateReview,
  readLog,
  renderSnapshotMarkdown,
  runView,
  runViewBlocks,
  todayLocalIso,
  toolAllowed,
  unlockDomain,
  validateViewSpec,
  vaultPaths,
  writeReviewSkill,
} from "@lifequest/vault-core";
import type { MetricDefinition, ViewSpec } from "@lifequest/vault-core";

/**
 * The metrics substrate, end to end, against real vaults on disk and real
 * SQLite: definitions, the dated events table, the compiled spec, the period
 * summary, the presence filters, the three shipped finance definitions and the
 * default skill's cash in / cash out / net figures.
 *
 * Runs with `node --experimental-strip-types --test tests/metrics-e2e.test.ts`,
 * so it needs no Electron, no dev server and no window. Every assertion is
 * against the shipped engine, never a mock: the same `runView` path a dashboard
 * card takes.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A definition that is only in the request: no JSON on disk, or a second
 *     create silently overwriting the first (it must file a pending edit
 *     Decision and write nothing).
 *  2. An events metric whose rows are not dated rows: three sessions must be
 *     three rows with the definition's eventKey, so `count` says 3 and `sum`
 *     says the 120 minutes — from the same rows.
 *  3. A default date/value that is not today/1: log_metric's defaults are the
 *     whole convenience of manual tracking.
 *  4. Gross finance that is not gross: a transfer is two rows sharing an id,
 *     and either leg counted as income or expense inflates the figure.
 *  5. A magnitude applied to the query instead of the display: Cash out must
 *     read 3,000 while the ledger row stays -3,000.
 *  6. A fabricated zero: a metric with no rows must answer null, never 0, or
 *     the matrix lies about "not tracked".
 *  7. A period window ignored: a previous-period row leaking into this
 *     period's value, or a delta computed from the wrong window.
 *  8. Refusals that succeed: a bad derived spec, events without an eventKey, an
 *     unknown aggregation, a non-live area, a redefine that writes immediately,
 *     a log to nothing.
 *  9. Presence tests that miss empty cells: `is-not-set` must match a NULL cell,
 *     which a `neq ""` filter cannot.
 * 10. A default-skill rewrite that clobbers an operator's edit: only the
 *     byte-identical previous default may be replaced, and only once.
 * 11. The tools not reaching the door: ALL_TOOL_DEFS must name all four and
 *     each must dispatch, or a paired agent never sees them.
 * 12. An artifact written by a failing run: failures throw, so the artifact
 *     only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/metrics.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** The review period every figure and summary in this file is read over. */
const PERIOD = "2026-10-12"; // a Monday
const PREVIOUS_PERIOD = "2026-10-05";
const WINDOW_START = "2026-10-12";
const WINDOW_END = "2026-10-18";

type Json = Record<string, unknown>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}

/** The row cells of one event, as the stored JSON cells blob. */
async function eventRows(vaultRoot: string): Promise<Array<Record<string, unknown>>> {
  const dbRes = await getDatabase(vaultRoot, "health", "metrics");
  assert.equal(dbRes.ok, true, "the health Metrics database does not exist");
  const db = dbRes.value;
  const columns = new Map(db.columns.map((c) => [c.id, c.name]));
  const listed = await listRows(vaultRoot, "health", "metrics");
  assert.equal(listed.ok, true, "the health Metrics rows could not be read");
  return listed.value.map((row) => {
    const named: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(row.cells)) {
      named[columns.get(id) ?? id] = value;
    }
    return named;
  });
}

/**
 * The finance fixture: one income, one expense and a transfer MATCH inside the
 * review week, one income and one expense in the week before it.
 *
 * Hand-computed: cash in 5,000 (the transfer's incoming leg is excluded), cash
 * out 3,000 (the transfer's outgoing leg excluded, printed positive), net 2,000
 * (transfers included: +5,000 -3,000 -1,000 +1,000).
 */
async function seedFinance(vaultRoot: string): Promise<void> {
  const accounts = await insertRows(vaultRoot, "financial", "finance:accounts", [
    { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
  ]);
  assert.equal(accounts.ok, true, "the rig could not create the finance account");
  await insertRows(vaultRoot, "financial", "finance:categories", [
    { id: "cat-salary", cells: { name: "Salary" } },
    { id: "cat-groceries", cells: { name: "Groceries" } },
  ]);
  const posted = await insertRows(vaultRoot, "financial", "finance:transactions", [
    { id: "t-income", cells: { date: "2026-10-13", amount: 5000, account: "acc-1", category: "cat-salary", payee: "Employer" } },
    { id: "t-expense", cells: { date: "2026-10-14", amount: -3000, account: "acc-1", category: "cat-groceries", payee: "Checkers" } },
    { id: "t-transfer-out", cells: { date: "2026-10-15", amount: -1000, account: "acc-1", payee: "Savings", transfer_id: "tr-1" } },
    { id: "t-transfer-in", cells: { date: "2026-10-15", amount: 1000, account: "acc-1", payee: "Cheque", transfer_id: "tr-1" } },
    { id: "t-prev-income", cells: { date: "2026-10-06", amount: 1000, account: "acc-1" } },
    { id: "t-prev-expense", cells: { date: "2026-10-07", amount: -2000, account: "acc-1" } },
  ]);
  assert.equal(posted.ok, true, "the rig could not post the finance transactions");
}

/** A `metric`-presentation spec over one database, for the presence-filter check. */
function countSpec(databaseId: string, filters: ViewSpec["filters"]): ViewSpec {
  return {
    schemaVersion: 1,
    databaseId,
    title: "Count",
    presentation: "metric",
    groupBy: null,
    timeBucket: null,
    timeColumnId: null,
    timeWindow: "all",
    filters,
    measure: "count",
    measureColumnId: null,
    per: null,
    sort: { by: "value", dir: "desc" },
    limit: 12,
    convertToZar: false,
    columns: [],
  };
}

describe("metrics e2e", () => {
  it("defines, logs, summaries, filters and the shipped finance figures on real vaults", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-metrics-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    try {
      const created = await createVault(vaultRoot, "Metrics Rig");
      assert.equal(created.ok, true, "the rig could not create a vault");
      for (const slug of ["health", "financial"]) {
        const unlocked = await unlockDomain(vaultRoot, slug);
        assert.equal(unlocked.ok, true, `unlockDomain(${slug}) failed: ${unlocked.ok ? "" : unlocked.error}`);
      }
      const kit = await installFinanceKit(vaultRoot, ACTOR);
      assert.equal(kit.ok, true, `the finance kit did not install: ${kit.ok ? "" : kit.error}`);

      // ── (a) define an events metric: JSON on disk, and listed ─────────────
      const defined = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "health",
        id: "training-sessions",
        label: "Training sessions",
        unit: "sessions",
        source: "events",
        aggregation: "count",
        eventKey: "training",
      })) as { metric?: Json; error?: { code: string; message: string } };
      assert.equal(defined.error, undefined, `define_metric failed: ${JSON.stringify(defined.error)}`);
      const sessionsFile = vaultPaths(vaultRoot).domainMetric("health", "training-sessions");
      const sessionsOnDisk = readJson(sessionsFile);
      checks.defineMetric = {
        file: "domains/health/metrics/training-sessions.json",
        onDisk: sessionsOnDisk,
        createdBy: sessionsOnDisk.createdBy,
      };
      assert.equal(sessionsOnDisk.id, "training-sessions", "the definition file does not hold the metric");
      assert.equal(sessionsOnDisk.domainSlug, "health", "the definition file does not name its area");
      assert.equal(sessionsOnDisk.source, "events");
      assert.equal(sessionsOnDisk.eventKey, "training");
      assert.equal(sessionsOnDisk.schemaVersion, 1);
      assert.equal(sessionsOnDisk.createdBy, "user", "the definition did not attribute the operator");
      const metricsDb = await getDatabase(vaultRoot, "health", "metrics");
      assert.equal(metricsDb.ok, true, "the first events definition did not create the area's metrics database");
      assert.equal(metricsDb.ok ? metricsDb.value.name : "", "Metrics", "the events database is not named Metrics");
      assert.deepEqual(
        metricsDb.ok ? metricsDb.value.columns.map((c) => [c.name, c.type]) : [],
        [
          ["date", "date"],
          ["metric", "text"],
          ["value", "number"],
          ["note", "text"],
        ],
        "the events database does not have the designed columns",
      );
      const listedHealth = await listMetricDefinitions(vaultRoot, "health");
      assert.equal(listedHealth.ok, true);
      assert.equal(
        listedHealth.ok && listedHealth.value.metrics.some((m) => m.id === "training-sessions"),
        true,
        "the definition is on disk but not in listMetricDefinitions",
      );
      assert.equal(
        listedHealth.ok && listedHealth.value.problems.length,
        0,
        "a clean definition was reported as a problem",
      );

      // A second definition on the SAME eventKey: minutes are the row values.
      const minutes = await defineMetric(
        vaultRoot,
        "health",
        {
          id: "training-minutes",
          label: "Training minutes",
          unit: "minutes",
          source: "events",
          eventKey: "training",
          aggregation: "sum",
        },
        ACTOR,
      );
      assert.equal(minutes.ok, true, `defining training-minutes failed: ${minutes.ok ? "" : minutes.error}`);

      // ── (b) log three sessions / 120 minutes, and the date/value defaults ─
      const logged: Json[] = [];
      for (const [date, value] of [
        ["2026-10-13", 30],
        ["2026-10-14", 45],
        ["2026-10-15", 45],
      ] as const) {
        const result = (await executeMetricsTool(vaultRoot, ACTOR, "log_metric", {
          domainSlug: "health",
          metricId: "training-minutes",
          date,
          value,
        })) as { event?: Json; error?: { code: string; message: string } };
        assert.equal(result.error, undefined, `log_metric failed: ${JSON.stringify(result.error)}`);
        logged.push(result.event as Json);
      }
      // Default date/value: today and 1, on a different key so the counts above
      // stay exactly three sessions.
      const reading = await defineMetric(
        vaultRoot,
        "health",
        {
          id: "reading-sessions",
          label: "Reading sessions",
          unit: "sessions",
          source: "events",
          eventKey: "reading",
          aggregation: "count",
        },
        ACTOR,
      );
      assert.equal(reading.ok, true);
      const defaultLogged = (await executeMetricsTool(vaultRoot, ACTOR, "log_metric", {
        domainSlug: "health",
        metricId: "reading-sessions",
      })) as { event?: { date: string; value: number }; error?: unknown };
      assert.equal(defaultLogged.error, undefined, "logging with no date or value was refused");
      checks.logMetric = {
        logged,
        defaultEvent: defaultLogged.event,
        today: todayLocalIso(),
      };
      assert.equal(defaultLogged.event?.value, 1, "log_metric did not default the value to 1");
      assert.equal(
        defaultLogged.event?.date,
        todayLocalIso(),
        "log_metric did not default the date to today",
      );

      const rows = await eventRows(vaultRoot);
      const trainingRows = rows.filter((row) => row.metric === "training");
      checks.trainingRows = trainingRows;
      assert.equal(trainingRows.length, 3, "the three sessions are not three rows");
      assert.equal(
        trainingRows.reduce((sum, row) => sum + Number(row.value ?? 0), 0),
        120,
        "the logged minutes do not sum to 120",
      );
      assert.equal(
        rows.filter((row) => row.metric === "reading").length,
        1,
        "the defaulted event row is missing",
      );

      // The summary counts and sums from those same rows.
      const trainingSummary = await getMetricsSummary(vaultRoot, "health", {
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["training-sessions", "training-minutes", "reading-sessions"],
      });
      assert.equal(trainingSummary.ok, true, `health summary failed: ${trainingSummary.ok ? "" : trainingSummary.error}`);
      const byId = new Map(
        trainingSummary.ok ? trainingSummary.value.metrics.map((m) => [m.id, m]) : [],
      );
      checks.summaryTraining = Object.fromEntries(
        [...byId.entries()].map(([id, metric]) => [id, metric]),
      );
      assert.equal(byId.get("training-sessions")?.value, 3, "training sessions is not a count of 3");
      assert.equal(byId.get("training-minutes")?.value, 120, "training minutes is not a sum of 120");
      assert.equal(
        byId.get("training-minutes")?.provenance.databaseId,
        "metrics",
        "the events metric's provenance does not name the metrics database",
      );
      assert.equal(
        byId.get("training-minutes")?.provenance.eventKey,
        "training",
        "the events metric's provenance does not name its event",
      );
      assert.equal(byId.get("reading-sessions")?.value, null, "a metric with no rows in the period answered a number");

      // ── (c) the finance figures, hand-computed, with the transfer excluded ─
      await seedFinance(vaultRoot);
      const finance = await getMetricsSummary(vaultRoot, "financial", {
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["cash-in", "cash-out", "net-cash-flow"],
      });
      assert.equal(finance.ok, true, `finance summary failed: ${finance.ok ? "" : finance.error}`);
      const financeById = new Map(
        finance.ok ? finance.value.metrics.map((m) => [m.id, m]) : [],
      );
      const cashIn = financeById.get("cash-in");
      const cashOut = financeById.get("cash-out");
      const net = financeById.get("net-cash-flow");
      checks.financeFigures = { cashIn, cashOut, net };
      assert.ok(cashIn && cashOut && net, "the three shipped finance definitions did not answer");
      assert.equal(cashIn!.value, 5000, "cash in counted a transfer leg or missed the income");
      assert.equal(cashOut!.value, -3000, "cash out is not the gross negative side of the ledger");
      assert.equal(net!.value, 2000, "net cash flow did not include both transfer legs");
      assert.deepEqual(cashIn!.window, { start: WINDOW_START, end: WINDOW_END });
      assert.equal(cashOut!.formatting?.magnitude, "abs", "cash out lost its display-only magnitude");
      assert.equal(cashIn!.source, "derived");
      assert.equal(
        net!.label,
        "Net cash flow (transfers included)",
        "the shipped Net label does not say transfers are included",
      );

      // Cash out PRINTS positive; the raw summary value keeps the ledger's sign.
      const cashOutDefinition = await getMetric(vaultRoot, "financial", "cash-out");
      assert.equal(cashOutDefinition.ok, true, "the shipped cash-out definition could not be read");
      const cashOutSpec = compileMetricSpec(
        (cashOutDefinition.ok ? cashOutDefinition.value : null) as MetricDefinition,
        {
          start: WINDOW_START,
          end: WINDOW_END,
        },
      );
      const cashOutRun = await runViewBlocks(vaultRoot, "financial", cashOutSpec);
      assert.equal(cashOutRun.ok, true, "the cash out spec did not run");
      const cashOutMarkdown = cashOutRun.ok
        ? renderSnapshotMarkdown(
            {
              id: "finance-out",
              domain: "financial",
              section: "Look-back",
              title: "Cash out this period",
              window: "period",
              magnitude: "abs",
              spec: cashOutSpec,
            } as never,
            cashOutRun.value,
            { windowLabel: `${WINDOW_START} → ${WINDOW_END}` },
          ).markdown
        : "";
      checks.cashOutRender = cashOutMarkdown;
      assert.match(cashOutMarkdown, new RegExp(`${formatSnapshotNumber(3000)} \\(ZAR\\)`), "cash out does not render its gross size");
      assert.doesNotMatch(cashOutMarkdown, /-3,000/, "the magnitude was applied to the query instead of the display");

      // ── (d) no rows answers null, and renders "no rows", never 0 ───────────
      const cold = await defineMetric(
        vaultRoot,
        "health",
        {
          id: "cold-plunge",
          label: "Cold plunge",
          unit: "sessions",
          source: "events",
          eventKey: "cold-plunge",
          aggregation: "count",
        },
        ACTOR,
      );
      assert.equal(cold.ok, true);
      const emptySummary = await getMetricsSummary(vaultRoot, "health", {
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["cold-plunge"],
      });
      assert.equal(emptySummary.ok, true);
      const empty = emptySummary.ok ? emptySummary.value.metrics[0] : undefined;
      checks.noData = empty;
      assert.ok(empty, "the no-data metric did not answer at all");
      assert.equal(empty!.value, null, "a metric with no rows fabricated a zero");
      assert.equal(empty!.previousValue, null, "a metric with no rows fabricated a previous value");
      assert.equal(empty!.delta, null, "a metric with no rows fabricated a delta");
      const emptyDefinition = await getMetric(vaultRoot, "health", "cold-plunge");
      assert.equal(emptyDefinition.ok, true, "the no-data definition could not be read");
      const emptyCompiled = await compileMetricSpecForVault(
        vaultRoot,
        "health",
        emptyDefinition.ok ? emptyDefinition.value : ({} as MetricDefinition),
        { start: WINDOW_START, end: WINDOW_END },
      );
      assert.equal(emptyCompiled.ok, true, "the no-data metric's spec did not compile");
      const emptySpec = emptyCompiled.ok ? emptyCompiled.value : ({} as ViewSpec);
      const emptyRun = await runViewBlocks(vaultRoot, "health", emptySpec);
      assert.equal(emptyRun.ok, true);
      const emptyMarkdown = emptyRun.ok
        ? renderSnapshotMarkdown(
            {
              id: "cold-plunge",
              domain: "health",
              section: "Look-back",
              title: "Cold plunge",
              window: "period",
              spec: emptySpec,
            } as never,
            emptyRun.value,
          ).markdown
        : "";
      checks.noDataRender = emptyMarkdown;
      assert.match(emptyMarkdown, /no rows in this window/i, "the no-data figure does not say no rows");

      // ── (e) the previous period and the delta ──────────────────────────────
      assert.equal(cashIn!.previousValue, 1000, "cash in read the wrong previous period");
      assert.equal(cashIn!.delta, 4000, "the cash-in delta is not 5,000 - 1,000");
      assert.equal(cashOut!.previousValue, -2000, "cash out read the wrong previous period");
      assert.equal(cashOut!.delta, 1000, "the cash-out delta is not the change in gross spend (3,000 - 2,000)");
      assert.equal(net!.previousValue, -1000, "net read the wrong previous period");
      assert.equal(net!.delta, 3000, "the net delta is not 2,000 - (-1,000)");
      assert.deepEqual(
        cashIn!.previousWindow,
        { start: "2026-10-05", end: "2026-10-11" },
        "the previous window is not the previous week",
      );
      checks.previousPeriod = {
        period: PERIOD,
        previous: PREVIOUS_PERIOD,
        previousWindow: cashIn!.previousWindow,
      };
      assert.equal(
        typeof cashIn!.asOf,
        "string",
        "the summary carries no as-of instant for the figure to be honest about",
      );
      assert.equal(
        Number.isNaN(Date.parse(cashIn!.asOf)),
        false,
        "the summary's as-of is not an instant",
      );

      // ── (f) the refusals ──────────────────────────────────────────────────
      type ToolErr = { error?: { code?: string; message?: string } };
      const badDerived = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "financial",
        id: "bad-grouped",
        label: "Bad",
        unit: "ZAR",
        source: "derived",
        aggregation: "sum",
        spec: {
          databaseId: "finance:transactions",
          title: "Bad",
          presentation: "metric",
          groupBy: "category",
          timeBucket: null,
          timeColumnId: "date",
          timeWindow: "all",
          filters: [],
          measure: "sum",
          measureColumnId: "amount",
          per: null,
          sort: { by: "value", dir: "desc" },
          limit: 12,
          convertToZar: true,
          columns: [],
        },
      })) as ToolErr;
      const eventsNoKey = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "health",
        id: "no-key",
        label: "No key",
        unit: "sessions",
        source: "events",
        aggregation: "count",
      })) as ToolErr;
      const badAggregation = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "health",
        id: "bad-aggregation",
        label: "Bad",
        unit: "sessions",
        source: "events",
        aggregation: "median",
        eventKey: "x",
      })) as ToolErr;
      const nonLive = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "mind",
        id: "locked-area",
        label: "Locked",
        unit: "sessions",
        source: "events",
        aggregation: "count",
        eventKey: "x",
      })) as ToolErr;
      // A redefine is no longer a refusal: it files the update Decision and
      // changes nothing until the operator approves it (task-14 governance).
      const redefined = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "health",
        id: "training-sessions",
        label: "Training sessions again",
        unit: "sessions",
        source: "events",
        aggregation: "count",
        eventKey: "training",
      })) as {
        error?: { code?: string; message?: string };
        pending?: boolean;
        status?: string;
        decisionId?: string;
        message?: string;
      };
      const unknownLog = (await executeMetricsTool(vaultRoot, ACTOR, "log_metric", {
        domainSlug: "health",
        metricId: "does-not-exist",
      })) as ToolErr;
      const derivedLog = (await executeMetricsTool(vaultRoot, ACTOR, "log_metric", {
        domainSlug: "financial",
        metricId: "cash-in",
      })) as ToolErr;
      const avgPerDerived = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "financial",
        id: "average-day-spend",
        label: "Average day spend",
        unit: "ZAR",
        source: "derived",
        aggregation: "sum",
        spec: {
          databaseId: "finance:transactions",
          title: "Average day spend",
          presentation: "metric",
          groupBy: null,
          timeBucket: null,
          timeColumnId: "date",
          timeWindow: "all",
          filters: [],
          measure: "avg-per",
          measureColumnId: "amount",
          per: "day",
          sort: { by: "value", dir: "desc" },
          limit: 12,
          convertToZar: true,
          columns: [],
        },
      })) as ToolErr;
      checks.refusals = {
        badDerived: badDerived.error,
        eventsNoKey: eventsNoKey.error,
        badAggregation: badAggregation.error,
        nonLive: nonLive.error,
        redefined: {
          pending: redefined.pending,
          status: redefined.status,
          decisionId: redefined.decisionId,
          message: redefined.message,
        },
        unknownLog: unknownLog.error,
        derivedLog: derivedLog.error,
        avgPerDerived: avgPerDerived.error,
      };
      assert.equal(badDerived.error?.code, "MALFORMED", "a grouped derived spec was accepted");
      assert.match(badDerived.error?.message ?? "", /group/i, "the grouped-spec refusal does not say why");
      assert.equal(eventsNoKey.error?.code, "MALFORMED", "an events metric without an eventKey was accepted");
      assert.match(eventsNoKey.error?.message ?? "", /eventKey/i, "the eventKey refusal does not name the field");
      assert.equal(badAggregation.error?.code, "MALFORMED", "an unknown aggregation was accepted");
      assert.equal(nonLive.error?.code, "NOT_FOUND", "a definition was created in a locked area");
      assert.equal(redefined.error, undefined, "redefining an existing id was refused instead of proposed");
      assert.equal(redefined.pending, true, "redefining an existing id did not file a pending update Decision");
      assert.match(
        redefined.decisionId ?? "",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        "the pending proposal does not name its Decision",
      );
      assert.equal(unknownLog.error?.code, "NOT_FOUND", "logging to an unknown metric succeeded");
      assert.equal(derivedLog.error?.code, "MALFORMED", "a derived metric was logged as an event");
      assert.equal(avgPerDerived.error?.code, "MALFORMED", "an avg-per derived metric was accepted");
      assert.match(avgPerDerived.error?.message ?? "", /avg-per/, "the avg-per refusal does not name the measure");
      assert.equal(
        readJson(sessionsFile).label,
        "Training sessions",
        "a proposed redefine changed the definition on disk",
      );

      // ── (g) is-set / is-not-set, against a hand-built filter ───────────────
      const txDb = await getDatabase(vaultRoot, "financial", "finance:transactions");
      assert.equal(txDb.ok, true);
      const transactions = await listRows(vaultRoot, "financial", "finance:transactions");
      assert.equal(transactions.ok, true);
      const transferColId = txDb.ok
        ? txDb.value.columns.find((c) => c.name === "transfer_id")?.id
        : undefined;
      assert.ok(transferColId, "the transactions table has no transfer_id column");
      const allRows = transactions.ok ? transactions.value : [];
      // The hand-built rule, exactly the semantics the spec names: set = the
      // cell exists, is not null and is not the empty string.
      const handSet = allRows.filter((row) => {
        const value = row.cells[transferColId!];
        return value !== null && value !== undefined && value !== "";
      }).length;
      const handNotSet = allRows.filter((row) => {
        const value = row.cells[transferColId!];
        return value === null || value === undefined || value === "";
      }).length;
      assert.equal(handSet, 2, "the fixture's two transfer legs are not both set");
      assert.equal(allRows.length, 6, "the finance fixture does not hold six rows");

      const setSpec = countSpec("finance:transactions", [
        { columnId: transferColId!, op: "is-set" },
      ]);
      const notSetSpec = countSpec("finance:transactions", [
        { columnId: transferColId!, op: "is-not-set" },
      ]);
      const setRun = await runView(vaultRoot, "financial", setSpec);
      const notSetRun = await runView(vaultRoot, "financial", notSetSpec);
      checks.presenceFilters = {
        handSet,
        handNotSet,
        setValue: setRun.ok ? setRun.value.summary?.value : setRun.error,
        notSetValue: notSetRun.ok ? notSetRun.value.summary?.value : notSetRun.error,
        totalRows: allRows.length,
      };
      assert.equal(setRun.ok, true, "the is-set filter query failed");
      assert.equal(notSetRun.ok, true, "the is-not-set filter query failed");
      assert.equal(setRun.ok ? setRun.value.summary?.value : -1, handSet, "is-set disagrees with the hand-built filter");
      assert.equal(
        notSetRun.ok ? notSetRun.value.summary?.value : -1,
        handNotSet,
        "is-not-set disagrees with the hand-built filter",
      );
      // A value argument is refused, not ignored.
      const dbForValidation = txDb.ok ? txDb.value : null;
      assert.ok(dbForValidation);
      const withValue = countSpec("finance:transactions", [
        { columnId: transferColId!, op: "is-set", value: true },
      ]);
      const refused = dbForValidation ? validateViewSpec(withValue, dbForValidation) : { ok: true as const };
      checks.presenceValidation = refused;
      assert.equal(refused.ok, false, "is-set accepted a value argument");

      // ── (f2) one broken definition must not hide the healthy ones ─────────
      // A definition already on disk whose source database is gone, plus a
      // hand-edited definition using the view-only avg-per measure. The summary
      // must still answer Cash in, and report each broken one with nulls.
      const orphanedFile = vaultPaths(vaultRoot).domainMetric("financial", "orphaned");
      fs.writeFileSync(
        orphanedFile,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "orphaned",
            domainSlug: "financial",
            label: "Orphaned",
            unit: "ZAR",
            source: "derived",
            aggregation: "sum",
            spec: {
              databaseId: "deleted:db",
              title: "Orphaned",
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
              convertToZar: true,
              columns: [],
            },
            createdBy: "user",
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
      );
      const editedAvgPerFile = vaultPaths(vaultRoot).domainMetric("financial", "edited-avg-per");
      fs.writeFileSync(
        editedAvgPerFile,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "edited-avg-per",
            domainSlug: "financial",
            label: "Edited average",
            unit: "ZAR",
            source: "derived",
            aggregation: "avg",
            spec: {
              databaseId: "finance:transactions",
              title: "Edited average",
              presentation: "metric",
              groupBy: null,
              timeBucket: null,
              timeColumnId: "date",
              timeWindow: "all",
              filters: [],
              measure: "avg-per",
              measureColumnId: "amount",
              per: "day",
              sort: { by: "value", dir: "desc" },
              limit: 12,
              convertToZar: true,
              columns: [],
            },
            createdBy: "user",
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
      );
      const resilient = await getMetricsSummary(vaultRoot, "financial", {
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["cash-in", "orphaned", "edited-avg-per"],
      });
      assert.equal(resilient.ok, true, `the summary aborted on a broken definition: ${resilient.ok ? "" : resilient.error}`);
      const resilientById = new Map(
        resilient.ok ? resilient.value.metrics.map((metric) => [metric.id, metric]) : [],
      );
      const resilientProblems = resilient.ok ? resilient.value.problems : [];
      checks.resilientSummary = {
        metrics: [...resilientById.values()],
        problems: resilientProblems,
      };
      assert.equal(
        resilientById.get("cash-in")?.value,
        5000,
        "a broken definition hid the healthy metric beside it",
      );
      assert.equal(
        resilientById.get("orphaned")?.value,
        null,
        "a definition whose source database is gone fabricated a value",
      );
      assert.equal(
        resilientById.get("edited-avg-per")?.value,
        null,
        "a hand-edited avg-per definition fabricated a value",
      );
      assert.equal(
        resilientProblems.some(
          (problem) => problem.metricId === "orphaned" && /Database not found/i.test(problem.reason),
        ),
        true,
        "the deleted-database definition was not reported as a problem",
      );
      assert.equal(
        resilientProblems.some(
          (problem) =>
            problem.metricId === "edited-avg-per" && /avg-per/i.test(problem.reason),
        ),
        true,
        "the hand-edited avg-per definition was not reported as a problem",
      );
      // The whole-area read (no metricIds) is just as resilient.
      const wholeArea = await getMetricsSummary(vaultRoot, "financial", {
        cadence: "weekly",
        period: PERIOD,
      });
      assert.equal(wholeArea.ok, true, "the whole-area summary aborted on a broken definition");
      assert.equal(
        wholeArea.ok && wholeArea.value.metrics.some((metric) => metric.id === "cash-in" && metric.value === 5000),
        true,
        "the whole-area summary hid a healthy metric because another definition is broken",
      );

      // ── (i) the four tools are on the door and in ALL_TOOL_DEFS ────────────
      const names = ["define_metric", "log_metric", "list_metrics", "get_metrics_summary"];
      checks.toolDoor = {
        allToolDefs: names.filter((name) => ALL_TOOL_DEFS.some((def) => def.name === name)),
      };
      for (const name of names) {
        assert.equal(
          ALL_TOOL_DEFS.some((def) => def.name === name),
          true,
          `ALL_TOOL_DEFS does not name ${name}`,
        );
      }
      const listedViaTool = (await executeMetricsTool(vaultRoot, ACTOR, "list_metrics", {
        domainSlug: "health",
      })) as { metrics?: Array<{ id: string }>; error?: Json };
      assert.equal(listedViaTool.error, undefined, "list_metrics did not dispatch");
      assert.equal(
        listedViaTool.metrics?.some((metric) => metric.id === "training-minutes"),
        true,
        "list_metrics did not return the logged metric's definition",
      );
      const summaryViaTool = (await executeMetricsTool(vaultRoot, ACTOR, "get_metrics_summary", {
        domainSlug: "financial",
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["cash-in"],
      })) as { metrics?: Array<{ id: string; value: number | null }>; error?: Json };
      assert.equal(summaryViaTool.error, undefined, "get_metrics_summary did not dispatch");
      assert.equal(summaryViaTool.metrics?.[0]?.value, 5000, "the summary tool answered a different number");
      const allAreas = (await executeMetricsTool(vaultRoot, ACTOR, "list_metrics", {})) as {
        metrics?: Array<{ domainSlug: string }>;
        error?: Json;
      };
      assert.equal(allAreas.error, undefined);
      assert.equal(
        allAreas.metrics?.some((metric) => metric.domainSlug === "financial"),
        true,
        "the all-areas metric listing does not include the finance definitions",
      );
      assert.equal(
        ALL_TOOL_DEFS.length,
        new Set(ALL_TOOL_DEFS.map((def) => def.name)).size,
        "a metric tool duplicated an existing tool name",
      );

      // The pairing gate: reads are grantable, define/log are immediate writes
      // that still need the area in the grant, and an unclassified name fails
      // closed. A read-only grant must not be able to define or log.
      const financeGrant = {
        agentId: "agent-1",
        name: "Agent",
        access: "write" as const,
        domainSlugs: ["financial"],
        schedule: false,
      };
      const readOnlyGrant = { ...financeGrant, access: "read" as const };
      const classification = {
        listRead: toolAllowed("list_metrics", readOnlyGrant),
        summaryRead: toolAllowed("get_metrics_summary", readOnlyGrant),
        defineWrite: toolAllowed("define_metric", financeGrant),
        logWrite: toolAllowed("log_metric", financeGrant),
        defineReadOnly: toolAllowed("define_metric", readOnlyGrant),
        logReadOnly: toolAllowed("log_metric", readOnlyGrant),
        unknown: toolAllowed("redefine_metric", financeGrant),
      };
      checks.grantClassification = classification;
      assert.equal(classification.listRead, "allow", "list_metrics is not grantable as a read");
      assert.equal(classification.summaryRead, "allow", "get_metrics_summary is not grantable as a read");
      assert.equal(classification.defineWrite, "allow", "a write grant cannot define a metric");
      assert.equal(classification.logWrite, "allow", "a write grant cannot log a metric event");
      assert.equal(classification.defineReadOnly, "FORBIDDEN", "a read-only grant can define a metric");
      assert.equal(classification.logReadOnly, "FORBIDDEN", "a read-only grant can log a metric event");
      assert.equal(classification.unknown, "FORBIDDEN", "an unclassified metric tool did not fail closed");

    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    // ── (h) the default skill replacement, on a second vault ───────────────
    const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-metrics-skill-"));
    const skillVault = path.join(skillDir, "vault");
    try {
      const created = await createVault(skillVault, "Skill Rig");
      assert.equal(created.ok, true, "the skill rig could not create a vault");
      for (const slug of ["health", "financial"]) {
        const unlocked = await unlockDomain(skillVault, slug);
        assert.equal(unlocked.ok, true, `unlockDomain(${slug}) failed`);
      }
      const kit = await installFinanceKit(skillVault, ACTOR);
      assert.equal(kit.ok, true, "the skill rig could not install the finance kit");
      await seedFinance(skillVault);

      // Seed the PREVIOUS shipped defaults from FIXTURES OF THE REAL FILES, not
      // from the helpers that are supposed to recognise them. Seeding with a
      // helper would pass even if both were wrong together — which is exactly
      // how a reworded bullet made the replacement miss every real vault.
      const shippedFixturePath = path.join(
        desktopRoot,
        "e2e/fixtures/review-skill-0.3.4-weekly.md",
      );
      const shippedDefault = fs.readFileSync(shippedFixturePath, "utf8");
      const previous = previousShippedDefaultReviewSkill("weekly");
      checks.byteIdentity = {
        fixture: "e2e/fixtures/review-skill-0.3.4-weekly.md",
        fixtureBytes: shippedDefault.length,
        helperMatchesFixture: previous === shippedDefault,
      };
      assert.equal(
        previous,
        shippedDefault,
        "the code's copy of the previous default is not byte-identical to the 0.3.4 release file",
      );
      assert.match(shippedDefault, /<!-- lifequest:snapshot:finance-spend -->|"id": "finance-spend"/, "the fixture is not the old finance-spend default");

      // The Phase 4 default (three finance fences) is the SECOND shipped default
      // a real vault may still carry. Its fixture was captured from the release
      // commit, so the code copy that recognises it must match byte for byte.
      const phase4FixturePath = path.join(
        desktopRoot,
        "e2e/fixtures/review-skill-phase4-weekly.md",
      );
      const phase4Default = fs.readFileSync(phase4FixturePath, "utf8");
      checks.phase4ByteIdentity = {
        fixture: "e2e/fixtures/review-skill-phase4-weekly.md",
        fixtureBytes: phase4Default.length,
        helperMatchesFixture: previousPhase4DefaultReviewSkill("weekly") === phase4Default,
      };
      assert.equal(
        previousPhase4DefaultReviewSkill("weekly"),
        phase4Default,
        "the code's copy of the Phase 4 default is not byte-identical to the release file",
      );
      assert.match(phase4Default, /"id": "finance-in"/, "the Phase 4 fixture is not the three-fence default");

      const seeded = await writeReviewSkill(skillVault, "weekly", shippedDefault, ACTOR);
      assert.equal(seeded.ok, true);
      const before = await getReviewSkill(skillVault, "weekly");
      assert.equal(before.ok && before.value.snapshots.length, 1, "the previous default does not parse as one directive");
      assert.equal(
        before.ok && before.value.snapshots[0]?.id,
        "finance-spend",
        "the previous default is not the old finance-spend skill",
      );

      await ensureReview(skillVault, { cadence: "weekly", period: PERIOD, scope: "overall" });
      await ensureReview(skillVault, { cadence: "weekly", period: PERIOD, scope: "financial" });

      const firstPass = await prepopulateReview(skillVault, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        actor: ACTOR,
      });
      assert.equal(firstPass.ok, true, `the finance Start failed: ${firstPass.ok ? "" : firstPass.error}`);
      const first = firstPass.ok ? firstPass.value : null;
      assert.ok(first);
      const rewritten = await getReviewSkill(skillVault, "weekly");
      const rewrittenIds = rewritten.ok ? rewritten.value.snapshots.map((d) => d.id) : [];
      checks.defaultSkill = {
        previousDefaultFile: "e2e/fixtures/review-skill-0.3.4-weekly.md",
        afterStartIds: rewrittenIds,
        outcomes: first!.outcomes,
        applied: first!.applied,
        body: first!.bodyMarkdown,
        rewrittenMarkdown: rewritten.ok ? rewritten.value.markdown : null,
      };
      // Figures no longer come from fences: the migrated default declares none,
      // and the Start writes the finance definitions' figures instead.
      assert.deepEqual(
        rewrittenIds,
        [],
        "the replacement default still declares operator fences",
      );
      const rewrittenMarkdown = rewritten.ok ? rewritten.value.markdown : "";
      assert.doesNotMatch(
        rewrittenMarkdown,
        /finance-spend|Spending this period|^```lifequest-snapshot$/m,
        "the rewritten skill still carries the old figure fences",
      );
      assert.match(rewrittenMarkdown, /## Figures/, "the rewritten default does not explain the app-written figures");
      assert.equal(
        rewrittenMarkdown,
        defaultReviewSkill("weekly"),
        "the previous shipped default was not replaced by the figures default",
      );
      assert.equal(first!.applied, 3, "Start wrote fewer than three figures");
      assert.deepEqual(
        first!.outcomes.map((outcome) => [outcome.id, outcome.status]),
        [
          ["metric:cash-in", "written"],
          ["metric:cash-out", "written"],
          ["metric:net-cash-flow", "written"],
        ],
        "the three definitions did not land as three written figures",
      );
      const body = first!.bodyMarkdown;
      assert.doesNotMatch(
        body,
        /lifequest:snapshot:/,
        "the Start wrote a snapshot block from the shipped default it just replaced",
      );
      assert.match(body, /<!-- lifequest:metric:cash-in -->/, "the Cash in figure is missing");
      assert.match(body, /<!-- lifequest:metric:cash-out -->/, "the Cash out figure is missing");
      assert.match(body, /<!-- lifequest:metric:net-cash-flow -->/, "the Net figure is missing");
      assert.match(body, /\*\*Cash in\*\* · 2026-10-12 → 2026-10-18/, "the Cash in figure does not name its window");
      assert.match(body, /Net cash flow \(transfers included\)/, "the Net figure is missing or unlabelled");
      assert.match(body, new RegExp(`${formatSnapshotNumber(5000)} \\(ZAR\\)`), "Cash in is not 5,000");
      assert.match(body, new RegExp(`${formatSnapshotNumber(3000)} \\(ZAR\\)`), "Cash out is not 3,000");
      assert.match(body, new RegExp(`${formatSnapshotNumber(2000)} \\(ZAR\\)`), "Net is not 2,000");
      const earlier = body.indexOf("<!-- lifequest:metric:cash-in -->");
      const later = body.indexOf("<!-- lifequest:metric:cash-out -->");
      assert.ok(earlier !== -1 && later > earlier, "the finance figures are not in reading order");
      assert.equal(
        (body.match(/<!-- lifequest:metric:cash-in -->/g) ?? []).length,
        1,
        "the cash-in marker is not written exactly once",
      );
      assert.match(
        body,
        /_As of \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Source: the finance:transactions database_/,
        "the figure carries no as-of/source line",
      );

      // Start again: the replacement happened once and nothing else is written.
      const secondPass = await prepopulateReview(skillVault, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        actor: ACTOR,
      });
      assert.equal(secondPass.ok, true);
      const second = secondPass.ok ? secondPass.value : null;
      checks.defaultSkillSecondPass = {
        applied: second?.applied,
        identical: second?.bodyMarkdown === body,
      };
      assert.equal(second?.applied, 0, "a second Start rewrote the figures");
      assert.equal(second?.bodyMarkdown, body, "a second Start changed the review body");
      const skillLog = await readLog(skillVault);
      const migrated = (skillLog.ok ? skillLog.value : []).filter(
        (event) => event.type === "review-skill.migrated",
      );
      checks.defaultSkillMigrations = migrated.map((event) => event.payload);
      assert.equal(migrated.length, 1, "the shipped-default replacement was logged more or less than once");
      assert.equal(
        (migrated[0]!.payload as Json).from,
        "0.3.4-default",
        "the migration line does not name the 0.3.4 default it replaced",
      );

      // The Phase 4 default is replaced once too, on another cadence so the
      // weekly replacement above cannot mask a missing second copy.
      await writeReviewSkill(skillVault, "monthly", previousPhase4DefaultReviewSkill("monthly"), ACTOR);
      const phase4Ensure = await ensureReviewSkill(skillVault, "monthly", ACTOR);
      assert.equal(phase4Ensure.ok, true);
      assert.equal(
        phase4Ensure.ok ? phase4Ensure.value.markdown : "",
        defaultReviewSkill("monthly"),
        "the Phase 4 default was not replaced by the figures default",
      );
      const phase4Log = await readLog(skillVault);
      const phase4Migrated = (phase4Log.ok ? phase4Log.value : []).filter(
        (event) =>
          event.type === "review-skill.migrated" &&
          (event.payload as Json | undefined)?.from === "phase-4-default",
      );
      checks.phase4DefaultMigration = phase4Migrated.map((event) => event.payload);
      assert.equal(phase4Migrated.length, 1, "the Phase 4 default replacement was not logged exactly once");
      await ensureReviewSkill(skillVault, "monthly", ACTOR);
      const phase4Again = (await readLog(skillVault));
      const phase4AfterSecond = (phase4Again.ok ? phase4Again.value : []).filter(
        (event) =>
          event.type === "review-skill.migrated" &&
          (event.payload as Json | undefined)?.from === "phase-4-default",
      );
      assert.equal(phase4AfterSecond.length, 1, "a second Start migrated the Phase 4 default again");

      // An operator-edited skill is never matched by bytes and never touched.
      // The variant is the release fixture plus one visible rule — the operator
      // changed their file, so no release may replace it.
      const edited = `${shippedDefault}\n- Ask about sleep every week.\n`;
      await writeReviewSkill(skillVault, "quarterly", edited, ACTOR);
      const ensureEdited = await ensureReviewSkill(skillVault, "quarterly", ACTOR);
      assert.equal(ensureEdited.ok, true);
      assert.match(
        ensureEdited.ok ? ensureEdited.value.markdown : "",
        /Ask about sleep every week\./,
        "the one-time rewrite clobbered an operator-edited skill",
      );
      checks.editedSkillPreserved = true;

      const report = {
        pass: true,
        what:
          "metric definitions and dated events on disk, the period summary (count/sum, previous period, null for no " +
          "data), the is-set/is-not-set presence filters against a hand-built filter, the three shipped finance " +
          "definitions with gross cash in/out and net including transfers, and the default skill's three figures " +
          "replacing the previous shipped default exactly once",
        command: "node --experimental-strip-types --test tests/metrics-e2e.test.ts",
        checks,
        generatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
  });
});
