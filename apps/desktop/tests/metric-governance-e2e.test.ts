import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  addDatabaseColumn,
  createDatabase,
  createVault,
  defineMetric,
  deleteDatabase,
  ensureReview,
  executeMetricsTool,
  getAnalyticsMatrix,
  getDatabase,
  getMetric,
  getMetricsSummary,
  getReviewPageBody,
  insertRows,
  listDecisions,
  listMetricDefinitions,
  logMetric,
  metricOpenMarker,
  prepopulateReview,
  proposeMetricDefinitionChange,
  readLog,
  resolveDecision,
  todayLocalIso,
  unlockDomain,
  writeReviewPage,
} from "@lifequest/vault-core";
import type { DecisionRecord } from "@lifequest/vault-core";

/**
 * Metric-definition governance, end to end, against a real vault on disk.
 *
 * Spec §10.6 / §17.1: creating a definition and logging an event apply
 * immediately; EDITING or DELETING a definition changes what a review measures,
 * so it is filed as a Decision and applied only when the operator approves it.
 * The apply path re-reads the definition and refuses STALE if the file moved in
 * between, so an approval can never overwrite a version the operator never saw.
 *
 * This is the engine path behind the Analytics page's Edit/Delete actions and the
 * companion's `define_metric` tool; the IPC doors and the page are covered by
 * typecheck and the renderer rig, but every write here is the shipped engine.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A proposal that writes: the definition file must be byte-identical while
 *     the Decision is pending, and change only on approval.
 *  2. A proposal that loses what the operator saw: the target and the card title
 *     must name the metric and carry the definition and the `updatedAt` the
 *     proposal was filed against.
 *  3. An approval that overwrites attribution: `createdBy`/`createdAt` stay the
 *     definition's, `updatedAt` moves, and `metric.updated` is logged.
 *  4. A stale approval that lands anyway: a file rewritten between propose and
 *     approve must answer STALE and leave the Decision pending.
 *  5. A delete that leaves the file, or approved deletes that keep answering:
 *     the file must be gone and `metric.deleted` logged.
 *  6. An approval that the readers cannot see: the summary and the Analytics
 *     matrix (and a review figure) must show the new label after approval.
 *  7. A derived definition the bridge form cannot build: a draft naming only
 *     database/measure/time column must synthesize the one-number spec, validate
 *     it, and answer through the matrix.
 *  8. A duplicate pending card: proposing the same edit twice must return one
 *     decision id and file one Decision.
 *  9. A `define_metric` on an existing id that writes immediately: it must file
 *     the update Decision instead and leave the definition unchanged.
 * 10. An invalid proposal at apply time that is silently rejected: a source
 *     database removed between propose and approve must leave the Decision
 *     pending with the validation sentence, not write a broken definition.
 * 11. An artifact written by a failing run: failures throw, so the artifact only
 *     exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/metric-governance.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** The review period every summary/figure in this file reads. */
const PERIOD = "2026-10-12"; // a Monday
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
].join("\n");

type Json = Record<string, unknown>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}

function check(result: { ok: boolean; error?: string }, message: string): void {
  assert.equal(result.ok, true, `${message}: ${result.ok ? "" : result.error}`);
}

/** The log's events of one type. */
async function logged(
  vaultRoot: string,
  type: string,
): Promise<Array<{ payload?: Record<string, unknown>; actor?: { type?: string } }>> {
  const log = await readLog(vaultRoot);
  assert.equal(log.ok, true, "the vault log could not be read");
  return (log.ok ? log.value : [])
    .filter((event) => event.type === type)
    .map((event) => ({
      payload: (event.payload ?? {}) as Record<string, unknown>,
      actor: event.actor as { type?: string } | undefined,
    }));
}

/** A page's markdown, as the editor and the figure pass read it. */
async function page(
  vaultRoot: string,
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "yearly",
  period: string,
  scope: string,
): Promise<string> {
  const read = await getReviewPageBody(vaultRoot, cadence, period, scope);
  check(read, `page ${scope}/${period} could not be read`);
  return read.ok ? read.value.bodyMarkdown : "";
}

/** Write the operator's page body, quoting the rev the rig just read. */
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
  check(written, `page ${scope} could not be seeded`);
}

/** Every pending card about one metric, oldest first. */
async function pendingFor(
  vaultRoot: string,
  metricId: string,
): Promise<DecisionRecord[]> {
  const listed = await listDecisions(vaultRoot);
  assert.equal(listed.ok, true, "the Decisions could not be listed");
  return (listed.ok ? listed.value : []).filter(
    (decision) =>
      decision.status === "pending" &&
      decision.target.type === "metric-definition" &&
      decision.target.metricId === metricId,
  );
}

describe("metric governance e2e", () => {
  it("files edits/deletes as Decisions, applies on approval with a stale guard, and synthesizes derived drafts", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-metric-governance-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    try {
      fs.rmSync(ARTIFACT, { force: true });
      check(await createVault(vaultRoot, "Metric Governance Rig"), "the rig could not create a vault");
      check(await unlockDomain(vaultRoot, "health"), "the health area could not be unlocked");

      // The derived draft's source: an ordinary database with a date and a
      // number column. Ids are minted, so the rig reads them back.
      const createdDb = await createDatabase(vaultRoot, "health", {
        id: "training-log",
        name: "Training log",
      });
      check(createdDb, "the training-log database could not be created");
      check(
        await addDatabaseColumn(vaultRoot, "health", "training-log", {
          name: "date",
          type: "date",
        }),
        "the training-log date column could not be added",
      );
      check(
        await addDatabaseColumn(vaultRoot, "health", "training-log", {
          name: "minutes",
          type: "number",
        }),
        "the training-log minutes column could not be added",
      );
      const logDb = await getDatabase(vaultRoot, "health", "training-log");
      assert.equal(logDb.ok, true, "the training-log database could not be read");
      const dateColumnId = logDb.ok
        ? logDb.value.columns.find((column) => column.name === "date")?.id
        : undefined;
      const minutesColumnId = logDb.ok
        ? logDb.value.columns.find((column) => column.name === "minutes")?.id
        : undefined;
      assert.ok(dateColumnId, "the training-log date column has no id");
      assert.ok(minutesColumnId, "the training-log minutes column has no id");
      check(
        await insertRows(vaultRoot, "health", "training-log", [
          { id: "row-1", cells: { [dateColumnId!]: "2026-10-13", [minutesColumnId!]: 30 } },
          { id: "row-2", cells: { [dateColumnId!]: "2026-10-14", [minutesColumnId!]: 45 } },
          { id: "row-3", cells: { [dateColumnId!]: "2026-10-15", [minutesColumnId!]: 45 } },
        ]),
        "the training-log rows could not be inserted",
      );
      // One row in the CURRENT week, so the Analytics matrix (whose columns are
      // the most recent periods) has a value to answer for the derived draft.
      check(
        await insertRows(vaultRoot, "health", "training-log", [
          { id: "row-now", cells: { [dateColumnId!]: todayLocalIso(), [minutesColumnId!]: 25 } },
        ]),
        "the current-week training-log row could not be inserted",
      );

      // ── (a) an events definition: creation applies immediately ────────────
      const sessions = await defineMetric(
        vaultRoot,
        "health",
        {
          id: "training-sessions",
          label: "Training sessions",
          unit: "sessions",
          source: "events",
          eventKey: "training",
          aggregation: "count",
        },
        ACTOR,
      );
      check(sessions, "the events definition could not be created");
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
      check(minutes, "the events minutes definition could not be created");
      for (const [date, value] of [
        ["2026-10-13", 30],
        ["2026-10-14", 45],
        ["2026-10-15", 45],
      ] as const) {
        check(
          await logMetric(vaultRoot, "health", "training-minutes", { date, value }, ACTOR),
          `the training event on ${date} could not be logged`,
        );
      }
      checks.create = {
        files: ["domains/health/metrics/training-sessions.json", "domains/health/metrics/training-minutes.json"],
        createdLogged: (await logged(vaultRoot, "metric.created")).length,
      };
      assert.equal(checks.create.createdLogged, 2, "creating a definition did not log metric.created");

      // ── (b) a derived draft: only database + measure + time column ────────
      const derived = await defineMetric(
        vaultRoot,
        "health",
        {
          id: "logged-minutes",
          label: "Logged minutes",
          unit: "minutes",
          source: "derived",
          aggregation: "sum",
          databaseId: "training-log",
          measureColumnId: minutesColumnId!,
          timeColumnId: dateColumnId!,
        },
        ACTOR,
      );
      check(derived, "the derived convenience draft was refused");
      const metricFile = (id: string): string =>
        path.join(vaultRoot, "domains/health/metrics", `${id}.json`);
      const derivedOnDisk = readJson(metricFile("logged-minutes")) as Json & {
        spec?: Record<string, unknown>;
      };
      checks.derivedDraft = { spec: derivedOnDisk.spec };
      assert.ok(derivedOnDisk.spec, "the derived draft did not synthesize a spec");
      assert.equal(derivedOnDisk.spec?.presentation, "metric", "the synthesized spec does not draw one number");
      assert.equal(derivedOnDisk.spec?.databaseId, "training-log", "the synthesized spec names the wrong database");
      assert.equal(derivedOnDisk.spec?.timeColumnId, dateColumnId, "the synthesized spec names the wrong date column");
      assert.equal(derivedOnDisk.spec?.measureColumnId, minutesColumnId, "the synthesized spec names the wrong measure column");
      assert.equal(derivedOnDisk.spec?.measure, "sum", "the synthesized spec folds with the wrong measure");
      assert.equal(derivedOnDisk.spec?.groupBy, null, "the synthesized spec groups");
      assert.equal(derivedOnDisk.spec?.convertToZar, false, "the synthesized spec converts to ZAR");
      assert.deepEqual(derivedOnDisk.spec?.filters, [], "the synthesized spec carries filters");
      assert.equal(derivedOnDisk.spec?.timeWindow, "all", "the synthesized spec pins a window");

      const derivedSummary = await getMetricsSummary(vaultRoot, "health", {
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["logged-minutes"],
      });
      check(derivedSummary, "the derived convenience metric could not answer");
      const derivedRowValue = derivedSummary.ok
        ? derivedSummary.value.metrics.find((metric) => metric.id === "logged-minutes")?.value
        : undefined;
      checks.derivedSummary = { value: derivedRowValue };

      // ── (c) propose an update: a pending Decision, nothing written ────────
      const beforeUpdate = readJson(metricFile("training-minutes"));
      const updatePayload = {
        id: "training-minutes",
        label: "Training minutes logged",
        unit: "minutes",
        source: "events" as const,
        eventKey: "training",
        aggregation: "sum" as const,
        target: 200,
      };
      const updateProposal = await proposeMetricDefinitionChange(
        vaultRoot,
        {
          area: "health",
          metricId: "training-minutes",
          action: "update",
          definition: updatePayload,
        },
        ACTOR,
      );
      check(updateProposal, "the update proposal could not be filed");
      const updateDecisionId = updateProposal.ok ? updateProposal.value.decisionId : "";
      const pendingUpdate = await pendingFor(vaultRoot, "training-minutes");
      checks.updateProposal = {
        decisionId: updateDecisionId,
        title: pendingUpdate[0]?.title,
        target: pendingUpdate[0]?.target,
      };
      assert.equal(pendingUpdate.length, 1, "the update proposal did not file exactly one pending Decision");
      const updateDecision = pendingUpdate[0]!;
      assert.equal(updateDecision.id, updateDecisionId, "the returned id does not name the pending Decision");
      assert.equal(updateDecision.title, "Edit the Training minutes metric", "the card does not name the metric and the action");
      assert.equal(updateDecision.target.type, "metric-definition");
      if (updateDecision.target.type === "metric-definition") {
        assert.equal(updateDecision.target.domainSlug, "health");
        assert.equal(updateDecision.target.metricId, "training-minutes");
        assert.equal(updateDecision.target.action, "update");
        assert.equal(
          updateDecision.target.baseUpdatedAt,
          beforeUpdate.updatedAt,
          "the proposal does not carry the updatedAt it was filed against",
        );
        assert.equal(
          (updateDecision.target.definition as Json | undefined)?.label,
          "Training minutes logged",
          "the proposal does not carry the proposed definition",
        );
      }
      assert.equal(
        readJson(metricFile("training-minutes")).label,
        "Training minutes",
        "a proposal wrote the definition before approval",
      );

      // The same edit proposed twice is one card, not two.
      const duplicate = await proposeMetricDefinitionChange(
        vaultRoot,
        {
          area: "health",
          metricId: "training-minutes",
          action: "update",
          definition: updatePayload,
        },
        ACTOR,
      );
      check(duplicate, "the duplicate proposal could not be read back");
      assert.equal(
        duplicate.ok ? duplicate.value.decisionId : "",
        updateDecisionId,
        "an identical pending proposal filed a second Decision",
      );
      assert.equal((await pendingFor(vaultRoot, "training-minutes")).length, 1, "an identical proposal duplicated the card");

      // ── (d) approve: the file changes, attribution is preserved, logged ───
      const approvedUpdate = await resolveDecision(vaultRoot, updateDecisionId, "approved");
      check(approvedUpdate, "approving the update Decision failed");
      const afterUpdate = readJson(metricFile("training-minutes"));
      checks.updateApplied = {
        before: { label: beforeUpdate.label, createdBy: beforeUpdate.createdBy, createdAt: beforeUpdate.createdAt },
        after: { label: afterUpdate.label, createdBy: afterUpdate.createdBy, createdAt: afterUpdate.createdAt, updatedAt: afterUpdate.updatedAt },
      };
      assert.equal(afterUpdate.label, "Training minutes logged", "approval did not write the proposed label");
      assert.equal(afterUpdate.createdBy, beforeUpdate.createdBy, "approval changed createdBy");
      assert.equal(afterUpdate.createdAt, beforeUpdate.createdAt, "approval changed createdAt");
      assert.notEqual(afterUpdate.updatedAt, beforeUpdate.updatedAt, "approval did not move updatedAt");
      assert.equal(afterUpdate.target, 200, "approval did not write the proposed target");
      const updateLogs = await logged(vaultRoot, "metric.updated");
      checks.updateLogs = updateLogs.map((entry) => entry.payload);
      assert.equal(updateLogs.length, 1, "approving an edit did not log metric.updated");
      assert.equal(updateLogs[0]?.payload?.metricId, "training-minutes", "metric.updated names the wrong metric");
      assert.equal(updateLogs[0]?.actor?.type, "user", "metric.updated lost the actor");

      // The readers see the new definition: summary label, matrix row label.
      const updatedSummary = await getMetricsSummary(vaultRoot, "health", {
        cadence: "weekly",
        period: PERIOD,
        metricIds: ["training-minutes"],
      });
      check(updatedSummary, "the updated metric could not be summarised");
      assert.equal(
        updatedSummary.ok
          ? updatedSummary.value.metrics.find((metric) => metric.id === "training-minutes")?.label
          : "",
        "Training minutes logged",
        "the summary still reads the old label",
      );
      const matrix = await getAnalyticsMatrix(vaultRoot, {
        cadence: "weekly",
        lens: "health",
        count: 4,
      });
      check(matrix, "the Analytics matrix could not be read");
      const matrixRow = matrix.ok
        ? matrix.value.rows.find((row) => row.metricId === "training-minutes")
        : undefined;
      const derivedMatrixRow = matrix.ok
        ? matrix.value.rows.find((row) => row.metricId === "logged-minutes")
        : undefined;
      checks.matrix = {
        updatedLabel: matrixRow?.label,
        derivedLabel: derivedMatrixRow?.label,
        derivedDatabaseId: derivedMatrixRow?.databaseId,
        derivedTimeColumnId: derivedMatrixRow?.timeColumnId,
        derivedCell: derivedMatrixRow?.cells.at(-1)?.valueText,
        derivedPeriod: derivedMatrixRow?.cells.at(-1)?.period,
      };
      assert.equal(matrixRow?.label, "Training minutes logged", "the matrix still reads the old label");
      assert.equal(derivedMatrixRow?.databaseId, "training-log", "the derived matrix row does not name its source database");
      assert.equal(derivedMatrixRow?.timeColumnId, dateColumnId, "the derived matrix row does not name its time column");
      assert.equal(
        derivedMatrixRow?.cells.at(-1)?.valueText,
        "25 minutes",
        "the matrix could not answer the derived convenience draft over the current period",
      );
      assert.equal(derivedRowValue, 120, "the derived convenience metric answered the wrong total");

      // And the figures a review Start writes carry the new label.
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: PERIOD, scope: "overall" }),
        "the overall review could not be created",
      );
      check(
        await ensureReview(vaultRoot, { cadence: "weekly", period: PERIOD, scope: "health" }),
        "the health review page could not be created",
      );
      await seedPage(vaultRoot, "weekly", PERIOD, "health", HEALTH_PAGE);
      const figurePass = await prepopulateReview(vaultRoot, {
        cadence: "weekly",
        period: PERIOD,
        scope: "health",
        actor: ACTOR,
      });
      check(figurePass, "the figure pass failed");
      const healthPage = await page(vaultRoot, "weekly", PERIOD, "health");
      checks.figure = {
        marker: metricOpenMarker("training-minutes"),
        updatedLabelShown: healthPage.includes("**Training minutes logged**"),
      };
      assert.ok(
        healthPage.includes(metricOpenMarker("training-minutes")),
        "the updated definition has no figure block",
      );
      assert.match(
        healthPage,
        new RegExp(`\\*\\*Training minutes logged\\*\\* · ${WINDOW}`),
        "the figure does not print the updated label and window",
      );

      // ── (e) stale: the file moves between propose and approve ─────────────
      check(
        await defineMetric(
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
        ),
        "the reading-sessions definition could not be created",
      );
      const staleProposal = await proposeMetricDefinitionChange(
        vaultRoot,
        {
          area: "health",
          metricId: "reading-sessions",
          action: "update",
          definition: {
            id: "reading-sessions",
            label: "Reading sessions v2",
            unit: "sessions",
            source: "events",
            eventKey: "reading",
            aggregation: "count",
          },
        },
        ACTOR,
      );
      check(staleProposal, "the stale proposal could not be filed");
      const staleDecisionId = staleProposal.ok ? staleProposal.value.decisionId : "";
      // The vault moves underneath the pending card: a direct file edit with a
      // newer updatedAt is exactly what a second writer would leave.
      const rewritten = readJson(metricFile("reading-sessions"));
      fs.writeFileSync(
        metricFile("reading-sessions"),
        `${JSON.stringify(
          {
            ...rewritten,
            label: "Reading sessions (changed elsewhere)",
            updatedAt: new Date(Date.now() + 60_000).toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      const staleApproval = await resolveDecision(vaultRoot, staleDecisionId, "approved");
      checks.stale = { approved: staleApproval.ok, error: staleApproval.ok ? "" : staleApproval.error };
      assert.equal(staleApproval.ok, false, "a stale update landed");
      assert.match(
        staleApproval.ok ? "" : staleApproval.error,
        /stale/i,
        "the stale refusal does not say the proposal is stale",
      );
      assert.match(
        staleApproval.ok ? "" : staleApproval.error,
        /pending/i,
        "the stale refusal does not say the Decision stays pending",
      );
      assert.equal(
        readJson(metricFile("reading-sessions")).label,
        "Reading sessions (changed elsewhere)",
        "a stale approval overwrote the newer definition",
      );
      assert.equal((await pendingFor(vaultRoot, "reading-sessions")).length, 1, "a stale approval resolved the Decision");
      const rejected = await resolveDecision(vaultRoot, staleDecisionId, "rejected");
      check(rejected, "the stale Decision could not be rejected");

      // ── (f) delete: proposed, then applied; logged; the file is gone ──────
      const deleteProposal = await proposeMetricDefinitionChange(
        vaultRoot,
        { area: "health", metricId: "reading-sessions", action: "delete" },
        ACTOR,
      );
      check(deleteProposal, "the delete proposal could not be filed");
      const deleteDecisionId = deleteProposal.ok ? deleteProposal.value.decisionId : "";
      const pendingDelete = await pendingFor(vaultRoot, "reading-sessions");
      checks.deleteProposal = { title: pendingDelete[0]?.title, fileStillThere: fs.existsSync(metricFile("reading-sessions")) };
      assert.equal(
        pendingDelete[0]?.title,
        "Delete the Reading sessions (changed elsewhere) metric",
        "the delete card does not name the metric",
      );
      assert.equal(fs.existsSync(metricFile("reading-sessions")), true, "a delete proposal removed the file before approval");
      check(await resolveDecision(vaultRoot, deleteDecisionId, "approved"), "approving the delete failed");
      const deleteLogs = await logged(vaultRoot, "metric.deleted");
      checks.deleteLogs = deleteLogs.map((entry) => entry.payload);
      assert.equal(fs.existsSync(metricFile("reading-sessions")), false, "an approved delete left the definition file");
      assert.equal(deleteLogs.length, 1, "an approved delete did not log metric.deleted");
      assert.equal(deleteLogs[0]?.payload?.metricId, "reading-sessions", "metric.deleted names the wrong metric");
      const afterDeleteList = await listMetricDefinitions(vaultRoot, "health");
      assert.equal(
        afterDeleteList.ok && afterDeleteList.value.metrics.some((metric) => metric.id === "reading-sessions"),
        false,
        "a deleted definition is still listed",
      );

      // A stale delete: the same guard, on the removal path.
      check(
        await defineMetric(
          vaultRoot,
          "health",
          {
            id: "water-glasses",
            label: "Water glasses",
            unit: "glasses",
            source: "events",
            eventKey: "water",
            aggregation: "count",
          },
          ACTOR,
        ),
        "the water-glasses definition could not be created",
      );
      const staleDeleteProposal = await proposeMetricDefinitionChange(
        vaultRoot,
        { area: "health", metricId: "water-glasses", action: "delete" },
        ACTOR,
      );
      check(staleDeleteProposal, "the stale delete proposal could not be filed");
      const staleDeleteId = staleDeleteProposal.ok ? staleDeleteProposal.value.decisionId : "";
      const waterFile = readJson(metricFile("water-glasses"));
      fs.writeFileSync(
        metricFile("water-glasses"),
        `${JSON.stringify(
          { ...waterFile, updatedAt: new Date(Date.now() + 60_000).toISOString() },
          null,
          2,
        )}\n`,
      );
      const staleDeleteApproval = await resolveDecision(vaultRoot, staleDeleteId, "approved");
      checks.staleDelete = {
        approved: staleDeleteApproval.ok,
        error: staleDeleteApproval.ok ? "" : staleDeleteApproval.error,
      };
      assert.equal(staleDeleteApproval.ok, false, "a stale delete landed");
      assert.match(
        staleDeleteApproval.ok ? "" : staleDeleteApproval.error,
        /stale/i,
        "the stale delete refusal does not say the proposal is stale",
      );
      assert.equal(fs.existsSync(metricFile("water-glasses")), true, "a stale delete removed the file");
      check(await resolveDecision(vaultRoot, staleDeleteId, "rejected"), "the stale delete Decision could not be rejected");

      // ── (g) define_metric on an existing id files the update Decision ─────
      const toolRedefine = (await executeMetricsTool(vaultRoot, ACTOR, "define_metric", {
        domainSlug: "health",
        id: "training-minutes",
        label: "Training minutes (tool)",
        unit: "minutes",
        source: "events",
        aggregation: "sum",
        eventKey: "training",
      })) as {
        error?: { code: string; message: string };
        pending?: boolean;
        status?: string;
        decisionId?: string;
        message?: string;
        metric?: Json;
      };
      checks.toolRedefine = {
        pending: toolRedefine.pending,
        status: toolRedefine.status,
        decisionId: toolRedefine.decisionId,
        message: toolRedefine.message,
      };
      assert.equal(toolRedefine.error, undefined, `define_metric on an existing id failed: ${JSON.stringify(toolRedefine.error)}`);
      assert.equal(toolRedefine.pending, true, "define_metric on an existing id did not report a pending proposal");
      assert.equal(toolRedefine.status, "pending", "the proposal does not report the pending status");
      assert.ok(toolRedefine.decisionId, "the pending proposal does not name its Decision");
      assert.match(toolRedefine.message ?? "", new RegExp(toolRedefine.decisionId ?? ""), "the message does not name the Decision");
      assert.equal(
        readJson(metricFile("training-minutes")).label,
        "Training minutes logged",
        "define_metric on an existing id wrote immediately",
      );
      const toolPending = await pendingFor(vaultRoot, "training-minutes");
      checks.toolRedefinePending = { count: toolPending.length, title: toolPending[0]?.title };
      assert.equal(toolPending.length, 1, "define_metric on an existing id filed no/many pending Decisions");
      assert.equal(toolPending[0]?.title, "Edit the Training minutes logged metric", "the tool proposal card does not name the metric");
      check(
        await resolveDecision(vaultRoot, toolRedefine.decisionId!, "approved"),
        "the tool's update Decision could not be approved",
      );
      assert.equal(
        readJson(metricFile("training-minutes")).label,
        "Training minutes (tool)",
        "approving the tool's Decision did not write the update",
      );

      // ── (h) an invalid proposal at apply time: pending, validated, no write ─
      const derivedUpdate = await proposeMetricDefinitionChange(
        vaultRoot,
        {
          area: "health",
          metricId: "logged-minutes",
          action: "update",
          definition: {
            id: "logged-minutes",
            label: "Logged minutes v2",
            unit: "minutes",
            source: "derived",
            aggregation: "sum",
            databaseId: "training-log",
            measureColumnId: minutesColumnId!,
            timeColumnId: dateColumnId!,
          },
        },
        ACTOR,
      );
      check(derivedUpdate, "the derived update proposal could not be filed");
      const derivedUpdateId = derivedUpdate.ok ? derivedUpdate.value.decisionId : "";
      // Remove the source database between propose and approve: the proposed
      // spec is now unanswerable, and the apply must say so without writing.
      const deletedDb = await deleteDatabase(vaultRoot, "health", "training-log");
      check(deletedDb, "the rig could not remove the derived source database");
      const invalidApproval = await resolveDecision(vaultRoot, derivedUpdateId, "approved");
      checks.invalidApply = {
        approved: invalidApproval.ok,
        error: invalidApproval.ok ? "" : invalidApproval.error,
      };
      assert.equal(invalidApproval.ok, false, "an unanswerable proposal was applied");
      assert.match(
        invalidApproval.ok ? "" : invalidApproval.error,
        /Database not found|database/i,
        "the invalid-proposal refusal does not name what is wrong",
      );
      assert.equal((await pendingFor(vaultRoot, "logged-minutes")).length, 1, "an invalid proposal was resolved");
      assert.equal(
        readJson(metricFile("logged-minutes")).label,
        "Logged minutes",
        "an invalid proposal wrote the definition",
      );
      check(await resolveDecision(vaultRoot, derivedUpdateId, "rejected"), "the invalid Decision could not be rejected");
      checks.finalMetrics = (await listMetricDefinitions(vaultRoot, "health")).ok
        ? (await listMetricDefinitions(vaultRoot, "health")).value.metrics.map((metric) => metric.id)
        : [];

      // ── artifact ──────────────────────────────────────────────────────────
      const report = {
        pass: true,
        what:
          "metric-definition governance: create/log apply immediately, an edit or delete is a pending Decision " +
          "(named card, proposed definition + baseUpdatedAt), approval writes the definition preserving " +
          "createdBy/createdAt and logs metric.updated, a file changed between propose and approve answers STALE " +
          "with the Decision still pending, an approved delete removes the file and logs metric.deleted, a derived " +
          "draft naming only database/measure/time columns synthesizes a runnable one-number spec the matrix and " +
          "figures answer, define_metric on an existing id files the same update Decision, and an unanswerable " +
          "proposal stays pending",
        command: "node --experimental-strip-types --test tests/metric-governance-e2e.test.ts",
        period: PERIOD,
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
