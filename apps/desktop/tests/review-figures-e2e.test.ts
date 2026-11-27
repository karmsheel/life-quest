import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createVault,
  currentPeriod,
  defaultReviewSkill,
  defineMetric,
  ensureReview,
  ensureReviewSkill,
  getReview,
  getReviewPageBody,
  insertRows,
  installFinanceKit,
  logMetric,
  markReviewDone,
  metricOpenMarker,
  metricsOverallOpenMarker,
  periodBounds,
  prepopulateReview,
  previousPhase4DefaultReviewSkill,
  previousShippedDefaultReviewSkill,
  readLog,
  todayLocalIso,
  unlockDomain,
  writeReviewPage,
  writeReviewSkill,
} from "@lifequest/vault-core";

/**
 * The figures a review page carries, end to end, against real vaults on disk.
 *
 * Phase 5 moved the report's numbers from `lifequest-snapshot` fences in the
 * cadence skill to the area's own METRIC DEFINITIONS (Phase 4): one figure per
 * definition on its area page, one cross-domain table on the overall page
 * (daily included — a day is one overall page), written on Start while the
 * notebook is open and frozen once it is locked.
 *
 * This rig is the whole product path behind that, minus the window: the same
 * `prepopulateReview` the Start button's IPC handler calls, the same view
 * engine a dashboard card uses, and the shipped finance definitions the kit
 * installs. Every assertion is against the shipped engine on a real vault.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A figure missing or reading the wrong rows: the events pair (3 sessions,
 *     120 minutes) comes from the SAME three dated rows on one eventKey.
 *  2. A figure that ignores its window: last week's ledger rows must not leak
 *     into this week's figure.
 *  3. A gross finance figure that prints its ledger sign: Cash out is 1,000, not
 *     -1,000 — magnitude is display only, the query keeps the sign.
 *  4. A transfer counted as income or spend: Cash in/out exclude both legs, Net
 *     includes them and says so.
 *  5. A fabricated zero: a metric with no rows prints the no-rows line, and the
 *     table prints "—", never 0.
 *  6. The window lied about: "(period to date)" for a review whose period has
 *     not ended, absent for a finished one, and a local minute-precision as-of.
 *  7. A second Start appending a second block: replacement is by marker, and an
 *     identical pass leaves the page byte-identical.
 *  8. The operator's prose lost or reordered around the figures.
 *  9. A deleted definition's figure staying forever, or a locked review being
 *     rewritten after it was finished.
 * 10. A daily review growing area figures or area sections: it gets the table
 *     only.
 * 11. A default-skill upgrade that misses a shipped file, runs twice, or
 *     clobbers an operator's edit; and a custom fence no longer running beside
 *     the app's figures.
 * 12. An artifact written by a failing run: failures throw, so the artifact
 *     only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/review-figures.json");
const FIXTURES = path.join(desktopRoot, "e2e/fixtures");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** The review period every finished-period figure in this file reads. */
const PERIOD = "2026-10-12"; // a Monday
const PREVIOUS_WINDOW = "2026-10-05 → 2026-10-11";
const WINDOW = "2026-10-12 → 2026-10-18";

const HEALTH_PAGE = [
  "# Health",
  "",
  "## Look-back",
  "",
  "I slept well this week.",
  "",
  "## Keep",
  "",
  "Kept walking.",
  "",
  "## Change",
  "",
  "## Next-period intent",
  "",
  "## A custom heading",
  "",
  "Custom prose stays.",
].join("\n");

function check(result: { ok: boolean; error?: string }, message: string): void {
  assert.equal(result.ok, true, `${message}: ${result.ok ? "" : result.error}`);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A page's markdown, as the editor and the foundation read it. */
async function page(
  vaultRoot: string,
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "yearly",
  period: string,
  scope: string,
): Promise<string> {
  const read = await getReviewPageBody(vaultRoot, cadence, period, scope);
  assert.equal(read.ok, true, `page ${scope}/${period} could not be read: ${read.ok ? "" : read.error}`);
  return read.ok ? read.value.bodyMarkdown : "";
}

/** The log's events of one type. */
async function logged(
  vaultRoot: string,
  type: string,
): Promise<Array<{ payload?: Record<string, unknown>; actor?: unknown }>> {
  const log = await readLog(vaultRoot);
  assert.equal(log.ok, true, "the vault log could not be read");
  return (log.ok ? log.value : [])
    .filter((event) => event.type === type)
    .map((event) => ({
      payload: (event.payload ?? {}) as Record<string, unknown>,
      actor: event.actor,
    }));
}

/** Write an operator's page body, quoting the rev the rig just read. */
async function seedPage(
  vaultRoot: string,
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "yearly",
  period: string,
  scope: string,
  bodyMarkdown: string,
): Promise<void> {
  const read = await getReviewPageBody(vaultRoot, cadence, period, scope);
  check(read, `page ${scope} could not be read before seeding`);
  if (!read.ok) return;
  const written = await writeReviewPage(vaultRoot, {
    cadence,
    period,
    scope,
    bodyMarkdown,
    baseRev: read.value.rev,
    actor: ACTOR,
  });
  assert.equal(written.ok, true, `page ${scope} could not be seeded: ${written.ok ? "" : written.error}`);
}

/** The finance fixture: income, expense and a transfer pair in the week. */
async function seedFinance(vaultRoot: string): Promise<void> {
  check(
    await insertRows(vaultRoot, "financial", "finance:accounts", [
      { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
    ]),
    "the rig could not create the finance account",
  );
  check(
    await insertRows(vaultRoot, "financial", "finance:categories", [
      { id: "cat-salary", cells: { name: "Salary" } },
      { id: "cat-groceries", cells: { name: "Groceries" } },
    ]),
    "the rig could not create the finance categories",
  );
  check(
    await insertRows(vaultRoot, "financial", "finance:transactions", [
      // This week: 5,000 in, 1,000 out, and a 2,000 transfer that cancels.
      { id: "t-income", cells: { date: "2026-10-13", amount: 5000, account: "acc-1", category: "cat-salary", payee: "Employer" } },
      { id: "t-expense", cells: { date: "2026-10-14", amount: -1000, account: "acc-1", category: "cat-groceries", payee: "Checkers" } },
      { id: "t-transfer-out", cells: { date: "2026-10-15", amount: -2000, account: "acc-1", payee: "Savings", transfer_id: "tr-1" } },
      { id: "t-transfer-in", cells: { date: "2026-10-15", amount: 2000, account: "acc-1", payee: "Cheque", transfer_id: "tr-1" } },
      // The previous week: 4,000 in, 1,500 out, for the table's deltas.
      { id: "t-prev-income", cells: { date: "2026-10-06", amount: 4000, account: "acc-1", category: "cat-salary", payee: "Employer" } },
      { id: "t-prev-expense", cells: { date: "2026-10-07", amount: -1500, account: "acc-1", category: "cat-groceries", payee: "Checkers" } },
    ]),
    "the rig could not post the finance transactions",
  );
}

/** One custom snapshot fence an operator wrote, to prove that path still runs. */
const CUSTOM_FENCE = {
  id: "my-cash-in",
  domain: "financial",
  section: "Look-back",
  title: "My cash in",
  window: "period",
  spec: {
    databaseId: "finance:transactions",
    title: "My cash in",
    presentation: "metric",
    groupBy: null,
    timeBucket: null,
    timeColumnId: "date",
    timeWindow: "all",
    filters: [{ columnId: "amount", op: "gt", value: 0 }],
    measure: "sum",
    measureColumnId: "amount",
    per: null,
    sort: { by: "value", dir: "desc" },
    limit: 12,
    convertToZar: true,
    columns: [],
  },
};

describe("review figures e2e", () => {
  it("writes one figure per definition and the overall table, refreshing by marker and freezing at lock", async () => {
    fs.rmSync(ARTIFACT, { force: true });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-figures-"));
    const checks: Record<string, unknown> = {};

    try {
      // ═══ (a) events metrics: 3 sessions and 120 minutes from one eventKey ═══
      const vaultA = path.join(workDir, "vault-a");
      check(await createVault(vaultA, "Figures Rig"), "the rig could not create a vault");
      for (const slug of ["health", "financial", "mind"]) {
        check(await unlockDomain(vaultA, slug), `unlockDomain(${slug}) failed`);
      }
      check(
        await defineMetric(
          vaultA,
          "health",
          {
            id: "training-sessions",
            label: "Training sessions",
            unit: "sessions",
            source: "events",
            eventKey: "training",
            aggregation: "count",
            formatting: { decimals: 0 },
          },
          ACTOR,
        ),
        "the sessions definition could not be created",
      );
      check(
        await defineMetric(
          vaultA,
          "health",
          {
            id: "training-minutes",
            label: "Training minutes",
            unit: "minutes",
            source: "events",
            eventKey: "training",
            aggregation: "sum",
            formatting: { decimals: 0 },
          },
          ACTOR,
        ),
        "the minutes definition could not be created",
      );
      // Three dated events, one per session, each carrying its minutes. The
      // sessions figure counts them and the minutes figure sums the same rows —
      // the point of decision 4 (one event log, one query path).
      for (const [date, value] of [
        ["2026-10-13", 40],
        ["2026-10-14", 50],
        ["2026-10-15", 30],
      ] as const) {
        check(
          await logMetric(vaultA, "health", "training-minutes", { date, value }, ACTOR),
          `the training event on ${date} could not be logged`,
        );
      }

      check(
        await ensureReview(vaultA, { cadence: "weekly", period: PERIOD, scope: "overall" }),
        "the overall review could not be created",
      );
      check(
        await ensureReview(vaultA, { cadence: "weekly", period: PERIOD, scope: "health" }),
        "the health page could not be created",
      );
      await seedPage(vaultA, "weekly", PERIOD, "health", HEALTH_PAGE);

      const firstPass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        actor: ACTOR,
      });
      check(firstPass, "the health figure pass failed");
      const healthPass = firstPass.ok ? firstPass.value : null;
      assert.ok(healthPass, "no health pass");
      checks.aPass = {
        applied: healthPass.applied,
        outcomes: healthPass.outcomes,
      };
      assert.equal(healthPass.applied, 2, "the pass wrote fewer than two health figures");
      assert.deepEqual(
        healthPass.outcomes.map((outcome) => [outcome.id, outcome.status]),
        [
          ["metric:training-minutes", "written"],
          ["metric:training-sessions", "written"],
        ],
        "the two events definitions did not land as figures in definition order",
      );

      const health = await page(vaultA, "weekly", PERIOD, "health");
      checks.aHealthPage = health;
      const minutesMarker = metricOpenMarker("training-minutes");
      const sessionsMarker = metricOpenMarker("training-sessions");
      assert.equal(countOf(health, minutesMarker), 1, "the minutes figure marker is missing or duplicated");
      assert.equal(countOf(health, sessionsMarker), 1, "the sessions figure marker is missing or duplicated");
      assert.ok(
        health.indexOf(minutesMarker) < health.indexOf(sessionsMarker),
        "the figures are not in definition order",
      );
      // The exact shape of a figure: bold label · window, the value with its
      // unit, and a local as-of minute with the provenance line.
      assert.match(
        health,
        /\*\*Training minutes\*\* · 2026-10-12 → 2026-10-18\n\n120 minutes\n\n_As of \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Source: the metrics database \(metric `training`\)_/,
        "the minutes figure does not carry label, window, value, as-of and provenance",
      );
      assert.match(
        health,
        /\*\*Training sessions\*\* · 2026-10-12 → 2026-10-18\n\n3 sessions\n\n_As of /,
        "the sessions figure does not carry its count and unit",
      );
      // Placement: under Look-back, above the operator's prose, and the
      // operator's writing before and after the block is untouched.
      const lookbackAt = health.indexOf("## Look-back");
      const keepAt = health.indexOf("## Keep");
      for (const marker of [minutesMarker, sessionsMarker]) {
        assert.ok(health.indexOf(marker) > lookbackAt, `${marker} is not under Look-back`);
        assert.ok(health.indexOf(marker) < keepAt, `${marker} landed outside Look-back`);
      }
      assert.match(health, /I slept well this week\./, "the operator's Look-back prose was lost");
      assert.match(health, /Kept walking\./, "the operator's Keep prose was lost");
      assert.match(health, /Custom prose stays\./, "the operator's extra heading was lost");
      assert.ok(
        health.indexOf(sessionsMarker) < health.indexOf("I slept well this week."),
        "the figures did not open the section ahead of the operator's prose",
      );

      // ── (e) a second Start keeps one block per figure and the same values ──
      const secondPass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        actor: ACTOR,
      });
      check(secondPass, "the second health pass failed");
      const healthTwice = secondPass.ok ? secondPass.value : null;
      assert.ok(healthTwice);
      checks.aSecond = { applied: healthTwice.applied, identical: healthTwice.bodyMarkdown === healthPass.bodyMarkdown };
      assert.equal(healthTwice.applied, 0, "a second Start rewrote unchanged figures");
      assert.equal(
        await page(vaultA, "weekly", PERIOD, "health"),
        health,
        "a second Start changed the health page",
      );
      assert.equal(countOf(health, minutesMarker), 1, "a second Start duplicated the minutes figure");
      assert.equal(countOf(health, sessionsMarker), 1, "a second Start duplicated the sessions figure");

      // ── (f) prose written after the figures survives the next Start ───────
      const withLaterProse = health.replace(
        "\n\n## Keep",
        "\n\nWritten after the figures.\n\n## Keep",
      );
      assert.notEqual(withLaterProse, health, "the rig could not place prose after the figures");
      await seedPage(vaultA, "weekly", PERIOD, "health", withLaterProse);
      const thirdPass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        actor: ACTOR,
      });
      check(thirdPass, "the pass over later prose failed");
      const healthThird = thirdPass.ok ? thirdPass.value : null;
      const healthAfterThird = await page(vaultA, "weekly", PERIOD, "health");
      checks.aProse = {
        applied: healthThird?.applied,
        keptBefore: healthAfterThird.includes("I slept well this week."),
        keptAfter: healthAfterThird.includes("Written after the figures."),
      };
      assert.equal(healthThird?.applied, 0, "a pass with unchanged figures rewrote the page");
      assert.equal(healthAfterThird, withLaterProse, "a pass changed a page whose figures were current");
      assert.match(healthAfterThird, /I slept well this week\./, "the pass lost prose that preceded the figures");
      assert.match(healthAfterThird, /Written after the figures\./, "the pass lost prose written after the figures");

      // ═══ (b) derived finance definitions: gross cash in/out and net ═══════
      check(await installFinanceKit(vaultA, ACTOR), "the finance kit did not install");
      await seedFinance(vaultA);
      check(
        await ensureReview(vaultA, { cadence: "weekly", period: PERIOD, scope: "financial" }),
        "the finance page could not be created",
      );
      const financePass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        actor: ACTOR,
      });
      check(financePass, "the finance figure pass failed");
      const finance = financePass.ok ? financePass.value : null;
      assert.ok(finance, "no finance pass");
      checks.bPass = { applied: finance.applied, outcomes: finance.outcomes };
      assert.equal(finance.applied, 3, "the pass wrote fewer than three finance figures");
      assert.deepEqual(
        finance.outcomes.map((outcome) => [outcome.id, outcome.status]),
        [
          ["metric:cash-in", "written"],
          ["metric:cash-out", "written"],
          ["metric:net-cash-flow", "written"],
        ],
        "the shipped finance definitions did not land as three figures",
      );
      const financeBody = await page(vaultA, "weekly", PERIOD, "financial");
      checks.bFinancePage = financeBody;
      assert.match(
        financeBody,
        /\*\*Cash in\*\* · 2026-10-12 → 2026-10-18\n\n5,000 \(ZAR\)\n\n_As of \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Source: the finance:transactions database_/,
        "Cash in is not 5,000 (ZAR) with its window, as-of and source",
      );
      assert.match(
        financeBody,
        /\*\*Cash out\*\* · 2026-10-12 → 2026-10-18\n\n1,000 \(ZAR\)/,
        "Cash out is not the gross 1,000 printed positive",
      );
      assert.doesNotMatch(financeBody, /-1,000/, "Cash out printed the ledger's sign instead of its size");
      assert.match(
        financeBody,
        /\*\*Net cash flow \(transfers included\)\*\* · 2026-10-12 → 2026-10-18\n\n4,000 \(ZAR\)/,
        "Net cash flow is not 4,000 (transfers included)",
      );
      const financeLookback = financeBody.indexOf("## Look-back");
      const financeKeep = financeBody.indexOf("## Keep");
      for (const marker of [
        metricOpenMarker("cash-in"),
        metricOpenMarker("cash-out"),
        metricOpenMarker("net-cash-flow"),
      ]) {
        assert.ok(financeBody.indexOf(marker) > financeLookback, `${marker} is not under Look-back`);
        assert.ok(financeBody.indexOf(marker) < financeKeep, `${marker} landed outside Look-back`);
      }

      // ═══ (c) the overall page's cross-domain table ═════════════════════════
      const overallPass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "overall",
        actor: ACTOR,
      });
      check(overallPass, "the overall figure pass failed");
      const overall = overallPass.ok ? overallPass.value : null;
      assert.ok(overall, "no overall pass");
      checks.cPass = { applied: overall.applied, outcomes: overall.outcomes };
      assert.equal(overall.applied, 1, "the overall pass wrote no cross-domain table");
      assert.deepEqual(
        overall.outcomes.map((outcome) => [outcome.id, outcome.status]),
        [["metrics:overall", "written"]],
        "the overall pass did not report the cross-domain block",
      );
      const overallBody = await page(vaultA, "weekly", PERIOD, "overall");
      checks.cOverallPage = overallBody;
      const overallMarker = metricsOverallOpenMarker();
      assert.equal(countOf(overallBody, overallMarker), 1, "the overall block marker is missing or duplicated");
      assert.match(
        overallBody,
        /\*\*Metrics this period\*\* · 2026-10-12 → 2026-10-18/,
        "the overall block does not carry its caption and window",
      );
      assert.match(
        overallBody,
        /\| Area \| Metric \| This period \| Previous period \| Δ \|\n\| --- \| --- \| --- \| --- \| --- \|/,
        "the overall table header is not the contracted one",
      );
      // Rows: every live area in notebook order, each area's definitions in
      // definition order; a window with no rows is "—", never a fabricated 0.
      const expectedRows = [
        "| Health | Training minutes | 120 minutes | — | — |",
        "| Health | Training sessions | 3 sessions | — | — |",
        "| Finance | Cash in | 5,000 (ZAR) | 4,000 (ZAR) | +1,000 |",
        "| Finance | Cash out | 1,000 (ZAR) | 1,500 (ZAR) | -500 |",
        "| Finance | Net cash flow (transfers included) | 4,000 (ZAR) | 2,500 (ZAR) | +1,500 |",
      ];
      for (const row of expectedRows) {
        assert.ok(overallBody.includes(row), `the overall table is missing the row: ${row}`);
      }
      let previousRowAt = -1;
      for (const row of expectedRows) {
        const at = overallBody.indexOf(row);
        assert.ok(at > previousRowAt, "the overall table rows are not in area/definition order");
        previousRowAt = at;
      }
      // A live area with no definitions (Mind) is not a row, and no area has a
      // fabricated zero for its empty previous window.
      assert.doesNotMatch(overallBody, /\| Mind \|/, "an area with no metric definitions appeared in the table");
      assert.doesNotMatch(overallBody, /Training (minutes|sessions) \| 0 /, "an empty window was fabricated as 0");
      assert.match(
        overallBody,
        /_As of \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Previous period: 2026-10-05 → 2026-10-11_/,
        "the overall block does not carry its as-of and previous-window line",
      );
      // The overall page carries the table ONLY — never a per-area figure.
      assert.equal(overallBody.includes("lifequest:metric:"), false, "the overall page grew a per-area figure");
      assert.doesNotMatch(overallBody, /period to date/, "a finished period's table says period to date");

      // ═══ (d) "(period to date)" only while the period is still open ═══════
      // The finished PERIOD above has no suffix (asserted). For the current one,
      // open the windows early and pick the first cadence whose current period
      // still has an end date in the future. On the one calendar day where every
      // period ends today, the rule is the boundary case: no suffix either —
      // which daily's own page proves instead.
      const settingsPath = path.join(vaultA, ".lifequest/settings.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      settings.reviewAvailability = {
        daily: { daysBeforeEnd: 0, timeOfDay: "00:00" },
        weekly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
        monthly: { daysBeforeEnd: 60, timeOfDay: "00:00" },
        quarterly: { daysBeforeEnd: 60, timeOfDay: "00:00" },
        yearly: { daysBeforeEnd: 60, timeOfDay: "00:00" },
      };
      fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      const today = todayLocalIso();
      let current: { cadence: "weekly" | "monthly" | "quarterly" | "yearly"; period: string; end: string } | null = null;
      for (const cadence of ["weekly", "monthly", "quarterly", "yearly"] as const) {
        const period = currentPeriod(cadence, "monday");
        const bounds = periodBounds(cadence, period, "monday");
        if (bounds.ok && today < bounds.value.end) {
          current = { cadence, period, end: bounds.value.end };
          break;
        }
      }
      if (current) {
        check(
          await ensureReview(vaultA, { cadence: current.cadence, period: current.period, scope: "health" }),
          "the current period's health page could not be created",
        );
        const currentPass = await prepopulateReview(vaultA, {
          cadence: current.cadence,
          period: current.period,
          scope: "health",
          actor: ACTOR,
        });
        check(currentPass, "the current period's figure pass failed");
        const currentBody = await page(vaultA, current.cadence, current.period, "health");
        checks.dCurrent = {
          cadence: current.cadence,
          period: current.period,
          end: current.end,
          today,
          hasSuffix: currentBody.includes("(period to date)"),
        };
        assert.ok(currentBody.length > 0, "the current period's page is empty");
        assert.match(
          currentBody,
          /\(period to date\)/,
          "a figure read before its period ended did not say period to date",
        );
      } else {
        // Every current period ends today: the window is not "before" its end,
        // so the honest label has no suffix. Prove the boundary on daily.
        const period = todayLocalIso();
        check(
          await ensureReview(vaultA, { cadence: "daily", period, scope: "overall" }),
          "the current daily review could not be created",
        );
        const dailyPass = await prepopulateReview(vaultA, {
          cadence: "daily",
          period,
          scope: "overall",
          actor: ACTOR,
        });
        check(dailyPass, "the current daily figure pass failed");
        const dailyBody = await page(vaultA, "daily", period, "overall");
        checks.dBoundary = { period, hasSuffix: dailyBody.includes("(period to date)") };
        assert.doesNotMatch(
          dailyBody,
          /\(period to date\)/,
          "a figure read on the period's last day claims to be period to date",
        );
      }

      // ═══ (g) a deleted definition's figure is removed on the next Start ═══
      fs.rmSync(path.join(vaultA, "domains/health/metrics/training-minutes.json"));
      const stalePass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        actor: ACTOR,
      });
      check(stalePass, "the pass after deleting a definition failed");
      const stale = stalePass.ok ? stalePass.value : null;
      assert.ok(stale, "no stale pass");
      const healthAfterStale = await page(vaultA, "weekly", PERIOD, "health");
      checks.gStale = { applied: stale.applied, outcomes: stale.outcomes };
      assert.equal(
        countOf(healthAfterStale, minutesMarker),
        0,
        "a deleted definition's figure stayed on the page",
      );
      assert.equal(
        countOf(healthAfterStale, sessionsMarker),
        1,
        "deleting one definition removed its neighbour's figure",
      );
      assert.match(healthAfterStale, /I slept well this week\./, "the stale-removal pass lost the operator's prose");
      assert.match(healthAfterStale, /Written after the figures\./, "the stale-removal pass lost later prose");
      assert.ok(
        stale.outcomes.some(
          (outcome) => outcome.status === "written" && outcome.reason?.includes("no longer exists"),
        ),
        "the stale figure's removal was not reported",
      );

      // ═══ (h) a locked notebook freezes every figure byte for byte ═════════
      check(
        await ensureReview(vaultA, { cadence: "weekly", period: PERIOD, scope: "mind" }),
        "the mind page could not be created for the gate",
      );
      for (const scope of ["health", "financial", "mind"]) {
        check(
          await markReviewDone(vaultA, { cadence: "weekly", period: PERIOD, scope }),
          `the ${scope} page could not be marked done`,
        );
      }
      const beforeLock = await getReview(vaultA, "weekly", PERIOD);
      check(beforeLock, "the review could not be read before locking");
      const beforeLockBody = beforeLock.ok ? beforeLock.value.bodyMarkdown : "";
      const healthBeforeLock = await page(vaultA, "weekly", PERIOD, "health");
      check(
        await markReviewDone(vaultA, { cadence: "weekly", period: PERIOD, scope: "overall" }),
        "the overall review could not be marked done",
      );
      const figuresBeforeLock = (await logged(vaultA, "review.figures")).length;
      const lockedPass = await prepopulateReview(vaultA, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        actor: ACTOR,
      });
      check(lockedPass, "the pass on a locked notebook failed");
      const locked = lockedPass.ok ? lockedPass.value : null;
      assert.ok(locked);
      checks.hLocked = {
        locked: locked.locked,
        applied: locked.applied,
        bodyUnchanged: locked.bodyMarkdown === beforeLockBody,
        healthUnchanged: (await page(vaultA, "weekly", PERIOD, "health")) === healthBeforeLock,
      };
      assert.equal(locked.locked, true, "a locked notebook was not reported as locked");
      assert.equal(locked.applied, 0, "a locked notebook was rewritten");
      assert.equal(locked.bodyMarkdown, beforeLockBody, "the locked review's body changed");
      assert.equal(
        await page(vaultA, "weekly", PERIOD, "health"),
        healthBeforeLock,
        "the locked health page's figures were not frozen",
      );
      assert.equal(
        (await logged(vaultA, "review.figures")).length,
        figuresBeforeLock,
        "a locked pass appended a figures log line",
      );

      // ═══ (i) a daily review gets the table and no area figures ════════════
      const vaultB = path.join(workDir, "vault-b");
      check(await createVault(vaultB, "Daily Figures Rig"), "the daily rig could not create a vault");
      for (const slug of ["health", "financial"]) {
        check(await unlockDomain(vaultB, slug), `daily rig: unlockDomain(${slug}) failed`);
      }
      check(await installFinanceKit(vaultB, ACTOR), "the daily rig's finance kit did not install");
      const dailyPeriod = "2026-10-13"; // a past day: its window opened that evening
      check(
        await defineMetric(
          vaultB,
          "health",
          {
            id: "training-sessions",
            label: "Training sessions",
            unit: "sessions",
            source: "events",
            eventKey: "training",
            aggregation: "count",
            formatting: { decimals: 0 },
          },
          ACTOR,
        ),
        "the daily rig's sessions definition could not be created",
      );
      for (const value of [30, 15]) {
        check(
          await logMetric(vaultB, "health", "training-sessions", { date: dailyPeriod, value }, ACTOR),
          "the daily rig could not log a training event",
        );
      }
      check(
        await insertRows(vaultB, "financial", "finance:accounts", [
          { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
        ]),
        "the daily rig could not create the account",
      );
      check(
        await insertRows(vaultB, "financial", "finance:transactions", [
          { id: "d-in", cells: { date: dailyPeriod, amount: 100, account: "acc-1", payee: "Employer" } },
          { id: "d-out", cells: { date: dailyPeriod, amount: -42.5, account: "acc-1", payee: "Checkers" } },
        ]),
        "the daily rig could not post the day's transactions",
      );
      check(
        await ensureReview(vaultB, { cadence: "daily", period: dailyPeriod, scope: "overall" }),
        "the daily review could not be created",
      );
      await seedPage(vaultB, "daily", dailyPeriod, "overall", [
        `# Daily review · ${dailyPeriod}`,
        "## Look-back",
        "Walked in the morning, twice.",
        "## Keep",
        "## Change",
        "## Next-period intent",
      ].join("\n\n"));
      const dailyPass = await prepopulateReview(vaultB, {
        cadence: "daily",
        period: dailyPeriod,
        scope: "overall",
        actor: ACTOR,
      });
      check(dailyPass, "the daily figure pass failed");
      const daily = dailyPass.ok ? dailyPass.value : null;
      assert.ok(daily, "no daily pass");
      const dailyBody = await page(vaultB, "daily", dailyPeriod, "overall");
      checks.iDailyPage = dailyBody;
      assert.equal(daily.applied, 1, "the daily pass wrote more than the cross-domain table");
      assert.deepEqual(
        daily.outcomes.map((outcome) => [outcome.id, outcome.status]),
        [["metrics:overall", "written"]],
        "the daily pass did not report the cross-domain table",
      );
      assert.equal(countOf(dailyBody, overallMarker), 1, "the daily review has no cross-domain table");
      assert.equal(dailyBody.includes("lifequest:metric:"), false, "the daily review grew per-area figures");
      assert.equal(dailyBody.includes("## Health"), false, "the daily review grew an area section");
      assert.equal(dailyBody.includes("## Financial"), false, "the daily review grew an area section");
      assert.match(
        dailyBody,
        /\| Health \| Training sessions \| 2 sessions \| — \| — \|/,
        "the daily table does not carry the day's health figure",
      );
      assert.match(
        dailyBody,
        /\| Finance \| Cash in \| 100 \(ZAR\) \| — \| — \|/,
        "the daily table does not carry the day's Cash in",
      );
      assert.match(dailyBody, /Walked in the morning, twice\./, "the daily pass lost the operator's prose");
      assert.ok(
        dailyBody.indexOf("Walked in the morning, twice.") > dailyBody.indexOf(overallMarker),
        "the daily table did not open the section ahead of the operator's prose",
      );
      assert.doesNotMatch(dailyBody, /period to date/, "a finished day says period to date");

      // ═══ (j) default-skill upgrades and the custom fence beside figures ═══
      const vaultC = path.join(workDir, "vault-c");
      check(await createVault(vaultC, "Skill Figures Rig"), "the skill rig could not create a vault");
      for (const slug of ["health", "financial"]) {
        check(await unlockDomain(vaultC, slug), `skill rig: unlockDomain(${slug}) failed`);
      }
      check(await installFinanceKit(vaultC, ACTOR), "the skill rig's finance kit did not install");
      check(
        await insertRows(vaultC, "financial", "finance:accounts", [
          { id: "acc-1", cells: { name: "Cheque", type: "checking", currency: "ZAR" } },
        ]),
        "the skill rig could not create the account",
      );
      check(
        await insertRows(vaultC, "financial", "finance:transactions", [
          { id: "s-in", cells: { date: "2026-10-13", amount: 250, account: "acc-1", payee: "Employer" } },
        ]),
        "the skill rig could not post a transaction",
      );

      // 0.3.4 fixture (real release bytes) → replaced once with the figures default.
      const legacyFixture = fs.readFileSync(path.join(FIXTURES, "review-skill-0.3.4-weekly.md"), "utf8");
      check(
        await writeReviewSkill(vaultC, "weekly", legacyFixture, ACTOR),
        "the skill rig could not seed the 0.3.4 default",
      );
      const afterLegacy = await ensureReviewSkill(vaultC, "weekly", ACTOR);
      check(afterLegacy, "the 0.3.4 default could not be upgraded");
      assert.equal(
        afterLegacy.ok ? afterLegacy.value.markdown : "",
        defaultReviewSkill("weekly"),
        "the 0.3.4 default was not replaced by the figures default",
      );
      const legacyMigrations = (await logged(vaultC, "review-skill.migrated")).filter(
        (event) => event.payload?.from === "0.3.4-default",
      );
      checks.jLegacy = { migrations: legacyMigrations.length, payload: legacyMigrations[0]?.payload };
      assert.equal(legacyMigrations.length, 1, "the 0.3.4 default upgrade was not logged exactly once");
      await ensureReviewSkill(vaultC, "weekly", ACTOR);
      assert.equal(
        (await logged(vaultC, "review-skill.migrated")).filter(
          (event) => event.payload?.from === "0.3.4-default",
        ).length,
        1,
        "the 0.3.4 default upgrade ran twice",
      );

      // Phase 4 default (three fences) → replaced once, on another cadence so
      // the weekly upgrade above cannot mask a missing second copy.
      const phase4Weekly = fs.readFileSync(path.join(FIXTURES, "review-skill-phase4-weekly.md"), "utf8");
      assert.equal(
        previousPhase4DefaultReviewSkill("weekly"),
        phase4Weekly,
        "the code's Phase 4 default is not byte-identical to the release fixture",
      );
      check(
        await writeReviewSkill(vaultC, "monthly", previousPhase4DefaultReviewSkill("monthly"), ACTOR),
        "the skill rig could not seed the Phase 4 default",
      );
      const afterPhase4 = await ensureReviewSkill(vaultC, "monthly", ACTOR);
      check(afterPhase4, "the Phase 4 default could not be upgraded");
      assert.equal(
        afterPhase4.ok ? afterPhase4.value.markdown : "",
        defaultReviewSkill("monthly"),
        "the Phase 4 default was not replaced by the figures default",
      );
      const phase4Migrations = (await logged(vaultC, "review-skill.migrated")).filter(
        (event) => event.payload?.from === "phase-4-default",
      );
      checks.jPhase4 = { migrations: phase4Migrations.length, payload: phase4Migrations[0]?.payload };
      assert.equal(phase4Migrations.length, 1, "the Phase 4 default upgrade was not logged exactly once");
      await ensureReviewSkill(vaultC, "monthly", ACTOR);
      assert.equal(
        (await logged(vaultC, "review-skill.migrated")).filter(
          (event) => event.payload?.from === "phase-4-default",
        ).length,
        1,
        "the Phase 4 default upgrade ran twice",
      );

      // An operator's edit is never matched by bytes and never touched.
      const edited = `${previousShippedDefaultReviewSkill("quarterly")}\n- Ask about sleep every week.\n`;
      check(
        await writeReviewSkill(vaultC, "quarterly", edited, ACTOR),
        "the skill rig could not seed the edited skill",
      );
      const afterEdited = await ensureReviewSkill(vaultC, "quarterly", ACTOR);
      check(afterEdited, "the edited skill could not be ensured");
      checks.jEdited = { untouched: afterEdited.ok && afterEdited.value.markdown.includes("Ask about sleep every week.") };
      assert.match(
        afterEdited.ok ? afterEdited.value.markdown : "",
        /Ask about sleep every week\./,
        "the upgrade clobbered an operator-edited skill",
      );

      // A custom fence still runs BESIDE the app-written figures: same page,
      // one snapshot block and the area's definition figures.
      const customSkill = [
        defaultReviewSkill("weekly").replace(/\n+$/, ""),
        "",
        "## My custom figure",
        "",
        "```lifequest-snapshot",
        JSON.stringify(CUSTOM_FENCE, null, 2),
        "```",
        "",
      ].join("\n");
      check(
        await writeReviewSkill(vaultC, "weekly", customSkill, ACTOR),
        "the skill rig could not author the custom fence",
      );
      check(
        await ensureReview(vaultC, { cadence: "weekly", period: PERIOD, scope: "overall" }),
        "the skill rig's overall review could not be created",
      );
      check(
        await ensureReview(vaultC, { cadence: "weekly", period: PERIOD, scope: "financial" }),
        "the skill rig's finance page could not be created",
      );
      const customPass = await prepopulateReview(vaultC, {
        cadence: "weekly",
        period: PERIOD,
        scope: "financial",
        actor: ACTOR,
      });
      check(customPass, "the custom-fence pass failed");
      const custom = customPass.ok ? customPass.value : null;
      assert.ok(custom);
      const customBody = await page(vaultC, "weekly", PERIOD, "financial");
      checks.jCustomFence = {
        applied: custom.applied,
        ids: custom.outcomes.map((outcome) => outcome.id),
        body: customBody,
      };
      assert.equal(custom.applied, 4, "the pass wrote the custom fence and figures unevenly");
      const customIds = custom.outcomes.map((outcome) => outcome.id);
      assert.deepEqual(
        customIds,
        ["my-cash-in", "metric:cash-in", "metric:cash-out", "metric:net-cash-flow"],
        "the custom fence and the definition figures did not both land",
      );
      assert.equal(countOf(customBody, "<!-- lifequest:snapshot:my-cash-in -->"), 1, "the custom fence did not run");
      assert.equal(countOf(customBody, "<!-- lifequest:metric:cash-in -->"), 1, "the Cash in figure is missing");
      assert.match(customBody, /\*\*My cash in\*\* · 2026-10-12 → 2026-10-18/, "the custom fence lost its window");
      assert.match(customBody, /\*\*Cash in\*\* · 2026-10-12 → 2026-10-18/, "the definition figure lost its window");

      // ── the artifact (only a run that held this far reaches this line) ────
      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(
        ARTIFACT,
        `${JSON.stringify(
          {
            pass: true,
            what:
              "an area page gets one app-written figure per metric definition (events: 3 sessions / 120 minutes; " +
              "derived: gross Cash in / Cash out and Net), with window, local as-of minute and provenance; the " +
              "overall page gets the cross-domain table with this/previous/delta and '—' for no data; " +
              "'(period to date)' appears only before a period ends; a second Start is a no-op; operator prose and " +
              "a custom lifequest-snapshot fence still work; a deleted definition's block is removed; a locked " +
              "notebook freezes figures; daily gets the table and no area figures; both shipped default skills " +
              "are upgraded once while an edited file is untouched",
            command:
              "node --experimental-strip-types --test tests/review-figures-e2e.test.ts",
            vaults: {
              a: "weekly health + finance + overall",
              b: "daily overall",
              c: "default-skill upgrades and a custom fence",
            },
            checks,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
