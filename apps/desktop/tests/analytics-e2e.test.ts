import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Analytics page: the lens-scoped matrix at `/review/analytics`.
 *
 * The claims themselves live in `e2e/analytics.electron.mjs`, which drives the
 * harness; this file runs that driver and refuses a report that does not hold.
 * Every claim is restated here so a regression names the surface rather than
 * only the rig's own failure list.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up (the repository's
 * `lifequest-e2e` runner starts one itself, so the final run does not skip).
 *
 * The artifact is `e2e/artifacts/analytics.json` plus `analytics.png`: same
 * command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/analytics.json");
const SHOTS = ["analytics.png"].map((name) =>
  path.join(desktopRoot, "e2e/artifacts", name),
);

/** The Review wing's rail, in the order the design fixes. */
const REVIEW_RAIL_ROWS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Analytics"];

/** The values the fixture prints, as the page must print them. */
const CASH_OUT_TEXT = "1,234.56 (ZAR)";

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/analytics.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

/* ── the report, as the driver writes it ────────────────────────────────────── */

type Field = {
  tag: string;
  type: string | null;
  value: string | null;
  options: { value: string; label: string | null }[] | null;
};

type PeriodHeader = { testid: string; label: string | null; href: string | null };

type Cell = {
  testid: string;
  text: string | null;
  value: string | null;
  delta: string | null;
  nodata: string | null;
};

type Row = { testid: string; label: string | null };

type RailRow = { label: string | null; href: string | null; active: boolean };

type MatrixInput = { cadence: string; lens: string | null; count?: number };

type DbUpsertCall = {
  kind: "upsert";
  slug: string;
  dbId: string;
  input: { id?: string; cells: Record<string, unknown> };
};
type DbDeleteCall = {
  kind: "delete";
  slug: string;
  dbId: string;
  rowId: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  generatedAt: string;
  checks: {
    arrival: {
      location: string | null;
      page: boolean;
      eyebrow: string | null;
      cadence: Field | null;
      matrix: boolean;
      periods: number;
      error: string | null;
    };
    railRow: { rows: (string | null)[]; analytics: RailRow | null };
    railNavigation: { location: string | null; page: boolean };
    matrix: {
      cadence: string | null;
      periods: PeriodHeader[];
      areas: { testid: string; heading: string | null }[];
      rows: Row[];
      cells: number;
    };
    matrixAreas: string[];
    matrixRows: string[];
    cashOutCell: Cell | null;
    noDataCell: Cell | null;
    deltaCell: Cell | null;
    screenshot: { file: string; bytes: number };
    financeLens: {
      input: MatrixInput | null;
      areas: string[];
      rows: string[];
      periodHref: string | null;
    };
    monthlyChoice: string | null;
    monthly: {
      input: MatrixInput | null;
      periods: PeriodHeader[];
      cadence: string | null;
    };
    derivedNavigation: {
      pathname: string;
      search: string;
      slug: string;
      dbId: string;
      from: string | null;
      to: string | null;
      columnId: string | null;
    } | null;
    eventsPanel: {
      input: { area: string; metricId: string; start: string; end: string } | null;
      rows: { testid: string; text: string | null }[];
      openReview: { href: string | null; text: string | null } | null;
    };
    editRow: {
      call: DbUpsertCall | null;
      rows: { testid: string; text: string | null }[];
    };
    deleteRow: {
      call: DbDeleteCall | null;
      rows: { testid: string; text: string | null }[];
    };
    logEvent: {
      input: {
        area: string;
        metricId: string;
        date?: string;
        value?: number;
        note?: string;
      } | null;
      rows: { testid: string; text: string | null }[];
      matrixCell: Cell | null;
      matrixCallsBefore: number;
      matrixCallsAfter: number;
      status: string | null;
    };
    newMetric: {
      input: {
        area: string;
        definition: {
          id: string;
          label: string;
          unit: string;
          source: string;
          aggregation: string;
          eventKey: string;
          target?: number | null;
        };
      } | null;
      rowPresent: boolean;
    };
    derivedForm: {
      input: {
        area: string;
        definition: {
          id: string;
          label: string;
          unit: string;
          source: string;
          aggregation: string;
          databaseId?: string;
          measureColumnId?: string;
          timeColumnId?: string;
          target?: number | null;
          spec?: unknown;
        };
      } | null;
      hint: string | null;
      emptyAreaHint: string | null;
      rowPresent: boolean;
    };
    editDefinition: {
      get: { area: string; metricId: string } | null;
      form: {
        mode: string | null;
        source: string | null;
        label: string | null;
        database: string | null;
        measure: string | null;
        dateColumn: string | null;
        aggregation: string | null;
        unit: string | null;
      };
      proposal: {
        area: string;
        metricId: string;
        action: string;
        definition?: {
          id?: string;
          label?: string;
          source?: string;
          databaseId?: string;
          measureColumnId?: string;
          timeColumnId?: string;
        };
      } | null;
      proposalStatus: string | null;
      rowLabel: string | null;
      defineCallsBefore: number;
      defineCallsAfter: number;
    };
    deleteDefinition: {
      confirmShown: boolean;
      confirmText: string | null;
      proposal: {
        area: string;
        metricId: string;
        action: string;
        definition?: unknown;
      } | null;
      proposalStatus: string | null;
      rowPresent: boolean;
    };
    askCompanion: {
      kickoff: string | null;
      sessions: number;
      sessionsBefore: number;
    };
    emptyState: {
      input: MatrixInput | null;
      empty: boolean;
      text: string | null;
      rows: string[];
    };
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
    dataListenerCount: number;
    calls: string[];
  };
};

function periodOf(header: PeriodHeader): string {
  return header.testid.replace(/^analytics-period-link-/, "");
}

describe("analytics ui e2e", () => {
  it("draws the lens-scoped Analytics matrix, logs and edits events through the row path, and links every cell to its source", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) fs.rmSync(shot, { force: true });

    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true, "the driver reported a failed run");
    assert.equal(exitCode, 0, "driver exited non-zero");

    const checks = report.checks;

    // ── the literal route, the eyebrow, and the Life matrix ─────────────────
    assert.equal(
      checks.arrival.location,
      "/review/analytics",
      "the page is not on the literal /review/analytics route",
    );
    assert.equal(checks.arrival.page, true, "the Analytics page did not render");
    assert.equal(
      checks.arrival.eyebrow,
      "Review / Analytics",
      "the page's eyebrow is not Review / Analytics",
    );
    assert.equal(
      checks.arrival.cadence?.value,
      "weekly",
      "the cadence selector does not open on weekly",
    );
    assert.equal(checks.arrival.matrix, true, "the matrix did not render");
    assert.equal(checks.arrival.error, null, "the page painted its error state on arrival");

    // ── the rail: Analytics is the Review wing's sixth row, after Yearly ────
    assert.deepEqual(
      checks.railRow.rows,
      REVIEW_RAIL_ROWS,
      "the Review wing's rail rows are not Daily, Weekly, Monthly, Quarterly, Yearly, Analytics",
    );
    assert.equal(
      checks.railRow.analytics?.href,
      "/review/analytics",
      "the Analytics rail row does not route to /review/analytics",
    );
    assert.equal(
      checks.railNavigation.location,
      "/review/analytics",
      "pressing the Analytics rail row from another Review page did not land on the matrix",
    );
    assert.equal(
      checks.railNavigation.page,
      true,
      "pressing the Analytics rail row drew no page",
    );

    // ── the matrix: eight engine-labelled periods and the area groups ───────
    assert.equal(
      checks.matrix.periods.length,
      8,
      "the matrix does not draw eight period columns",
    );
    const periods = checks.matrix.periods;
    for (const header of periods) {
      assert.match(
        String(header.label),
        /\S/,
        `period ${header.testid} has no label`,
      );
      assert.ok(
        String(header.href).includes(`period=${periodOf(header)}`),
        `period ${header.testid} does not link to ?period=${periodOf(header)}`,
      );
    }
    assert.deepEqual(
      checks.matrixAreas,
      ["analytics-area-health", "analytics-area-financial"],
      "the Life lens does not draw the Health and Finance area groups in vault order",
    );
    for (const row of [
      "analytics-row-health-training-sessions",
      "analytics-row-financial-cash-in",
      "analytics-row-financial-cash-out",
      "analytics-row-financial-net-cash-flow",
    ]) {
      assert.ok(
        checks.matrixRows.includes(row),
        `the matrix has no ${row} row`,
      );
    }

    // ── values, the no-data marker, and deltas ─────────────────────────────
    assert.ok(checks.cashOutCell, "the Cash out cell was not drawn");
    assert.ok(
      `${checks.cashOutCell?.value ?? ""}${checks.cashOutCell?.text ?? ""}`.includes(
        CASH_OUT_TEXT,
      ),
      "the Cash out cell does not print its magnitude as a positive value",
    );
    assert.ok(
      !String(checks.cashOutCell?.value ?? checks.cashOutCell?.text ?? "").trim().startsWith("-"),
      "the Cash out cell prints the ledger's negative sign",
    );
    assert.ok(checks.noDataCell, "the no-data cell was not drawn");
    assert.equal(
      checks.noDataCell?.nodata,
      "true",
      'the no-data cell does not wear data-nodata="true"',
    );
    assert.ok(
      String(checks.noDataCell?.text ?? "").includes("—"),
      'the no-data cell does not print the "—" marker',
    );
    assert.ok(
      !checks.noDataCell?.delta,
      "the no-data cell carries a delta",
    );
    assert.ok(checks.deltaCell, "the delta cell was not drawn");
    assert.ok(
      String(checks.deltaCell?.delta ?? "").includes("+2") ||
        String(checks.deltaCell?.text ?? "").includes("+2"),
      "a cell whose both periods have data prints no +2 delta",
    );

    // ── the Finance lens shows only Finance rows, and scopes its links ─────
    assert.deepEqual(
      checks.financeLens.areas,
      ["analytics-area-financial"],
      "the Finance lens does not draw exactly the Finance area group",
    );
    assert.equal(
      checks.financeLens.rows.length,
      3,
      "the Finance lens does not draw the fixture's three Finance rows",
    );
    assert.ok(
      checks.financeLens.rows.every((row) => row.startsWith("analytics-row-financial-")),
      "the Finance lens leaks another area's rows",
    );
    assert.equal(
      checks.financeLens.input?.lens,
      "financial",
      "the Finance lens did not ask the engine for the Finance matrix",
    );
    assert.ok(
      String(checks.financeLens.periodHref).includes("scope=financial"),
      "the Finance lens's period link does not carry &scope=financial",
    );

    // ── the cadence switch refetches and relabels ──────────────────────────
    assert.equal(checks.monthlyChoice, "monthly", "the cadence selector has no monthly option");
    assert.equal(
      checks.monthly.input?.cadence,
      "monthly",
      "switching to monthly did not ask the engine for a monthly matrix",
    );
    assert.equal(
      checks.monthly.periods.length,
      8,
      "the monthly matrix does not draw eight period columns",
    );
    assert.notDeepEqual(
      checks.monthly.periods.map((header) => header.label),
      periods.map((header) => header.label),
      "the monthly headers still read the weekly labels",
    );
    assert.equal(
      checks.monthly.cadence,
      "monthly",
      "the cadence selector does not show monthly after the switch",
    );

    // ── an events cell: panel, fixture rows, review link ───────────────────
    assert.ok(checks.eventsPanel.input, "the events cell did not read the period's events");
    assert.equal(
      checks.eventsPanel.input?.area,
      "health",
      "the events panel read the wrong area",
    );
    assert.equal(
      checks.eventsPanel.input?.metricId,
      "training-sessions",
      "the events panel read the wrong metric",
    );
    assert.equal(
      checks.eventsPanel.rows.length,
      2,
      "the events panel does not list the fixture's two rows",
    );
    assert.deepEqual(
      checks.eventsPanel.rows.map((row) => row.testid).sort(),
      ["analytics-event-event-1", "analytics-event-event-2"],
      "the events panel lists the wrong rows",
    );
    assert.ok(
      String(checks.eventsPanel.openReview?.href).includes(
        `period=${periodOf(periods[7]!)}`,
      ),
      "the events panel's review link does not carry the cell's ?period=",
    );
    assert.ok(
      String(checks.eventsPanel.openReview?.href).includes("scope=health"),
      "the events panel's review link does not carry &scope=health",
    );

    // ── editing a row goes through the standard row path ───────────────────
    assert.ok(checks.editRow.call, "editing a row did not call dbUpsertRow");
    assert.equal(checks.editRow.call?.kind, "upsert");
    assert.equal(
      checks.editRow.call?.slug,
      "health",
      "the row edit wrote the wrong area",
    );
    assert.equal(
      checks.editRow.call?.dbId,
      "metrics",
      "the row edit wrote the wrong database",
    );
    assert.equal(
      checks.editRow.call?.input.id,
      "event-1",
      "the row edit did not write the row it edited",
    );
    const editedCells = Object.values(checks.editRow.call?.input.cells ?? {});
    assert.ok(
      editedCells.includes("training-sessions"),
      "the edited row's metric cell does not carry the event key",
    );
    assert.ok(editedCells.includes("Long run"), "the edited row kept its old note");
    assert.ok(
      editedCells.some((cell) => Number(cell) === 3),
      "the edited row did not write the typed value",
    );
    assert.ok(
      checks.editRow.rows.some((row) => String(row.text ?? "").includes("Long run")),
      "the panel does not show the edited row",
    );

    // ── deleting a row calls dbDeleteRow ───────────────────────────────────
    assert.ok(checks.deleteRow.call, "deleting a row did not call dbDeleteRow");
    assert.equal(checks.deleteRow.call?.kind, "delete");
    assert.equal(checks.deleteRow.call?.slug, "health");
    assert.equal(checks.deleteRow.call?.dbId, "metrics");
    assert.equal(checks.deleteRow.call?.rowId, "event-2");
    assert.ok(
      !checks.deleteRow.rows.some((row) => row.testid === "analytics-event-event-2"),
      "the panel still lists the deleted row",
    );

    // ── logging an event reloads the panel and the matrix ──────────────────
    assert.ok(checks.logEvent.input, "logging an event did not call metricLogEvent");
    assert.equal(checks.logEvent.input?.area, "health");
    assert.equal(checks.logEvent.input?.metricId, "training-sessions");
    assert.equal(checks.logEvent.input?.value, 2);
    assert.equal(checks.logEvent.input?.note, "Evening walk");
    assert.ok(
      checks.logEvent.rows.some((row) => row.testid === "analytics-event-event-3"),
      "the panel does not list the logged row after the reload",
    );
    assert.ok(
      checks.logEvent.matrixCallsAfter > checks.logEvent.matrixCallsBefore,
      "logging an event did not reload the matrix",
    );
    assert.ok(
      String(checks.logEvent.matrixCell?.value ?? "").includes("5"),
      "the matrix did not pick up the logged event's value",
    );

    // ── a derived cell opens its source database, pinned to its period ──────
    assert.equal(
      checks.derivedNavigation?.pathname,
      "/data/financial/finance:transactions",
      "a derived cell does not open its source database",
    );
    assert.equal(checks.derivedNavigation?.slug, "financial");
    assert.equal(checks.derivedNavigation?.dbId, "finance:transactions");
    assert.match(
      String(checks.derivedNavigation?.from),
      /^\d{4}-\d{2}-\d{2}$/,
      "a derived cell's source-database link carries no from date",
    );
    assert.match(
      String(checks.derivedNavigation?.to),
      /^\d{4}-\d{2}-\d{2}$/,
      "a derived cell's source-database link carries no to date",
    );
    assert.ok(
      String(checks.derivedNavigation?.from) <= String(checks.derivedNavigation?.to),
      "the derived cell's period link runs backwards",
    );
    assert.ok(
      checks.derivedNavigation?.columnId,
      "the derived cell's period link names no date column",
    );
    assert.ok(
      String(checks.derivedNavigation?.search).includes(
        `columnId=${checks.derivedNavigation?.columnId}`,
      ),
      "the derived cell's link does not carry the date column id in its query",
    );

    // ── the New metric form defines an events metric ───────────────────────
    assert.ok(checks.newMetric.input, "the New metric form did not call metricDefine");
    assert.equal(checks.newMetric.input?.area, "health");
    assert.equal(checks.newMetric.input?.definition.source, "events");
    assert.equal(checks.newMetric.input?.definition.label, "Prayer minutes");
    assert.equal(checks.newMetric.input?.definition.unit, "minutes");
    assert.equal(checks.newMetric.input?.definition.aggregation, "sum");
    assert.equal(checks.newMetric.input?.definition.target, 30);
    assert.equal(
      checks.newMetric.input?.definition.id,
      "prayer-minutes",
      "the definition's id is not the label slugged",
    );
    assert.equal(
      checks.newMetric.input?.definition.eventKey,
      "prayer-minutes",
      "the definition's eventKey is not the label slugged",
    );
    assert.equal(
      checks.newMetric.rowPresent,
      true,
      "the matrix did not reload with the newly defined metric",
    );

    // ── the derived form sends a derived draft; the engine builds the spec ──
    assert.ok(
      checks.derivedForm.input,
      "the New metric form's derived source did not call metricDefine",
    );
    assert.equal(checks.derivedForm.input?.area, "financial");
    assert.equal(checks.derivedForm.input?.definition.source, "derived");
    assert.equal(checks.derivedForm.input?.definition.id, "card-spend");
    assert.equal(checks.derivedForm.input?.definition.label, "Card spend");
    assert.equal(checks.derivedForm.input?.definition.unit, "ZAR");
    assert.equal(checks.derivedForm.input?.definition.aggregation, "sum");
    assert.equal(checks.derivedForm.input?.definition.databaseId, "finance:transactions");
    assert.ok(
      checks.derivedForm.input?.definition.measureColumnId,
      "the derived draft names no measure column",
    );
    assert.ok(
      checks.derivedForm.input?.definition.timeColumnId,
      "the derived draft names no date column",
    );
    assert.equal(checks.derivedForm.input?.definition.target, 2000);
    assert.equal(
      checks.derivedForm.input?.definition.spec,
      undefined,
      "the renderer built a ViewSpec; a derived draft must let the engine build it",
    );
    assert.match(
      String(checks.derivedForm.emptyAreaHint),
      /Data/,
      "the derived form did not point at Data for an area with no databases",
    );
    assert.equal(
      checks.derivedForm.rowPresent,
      true,
      "the matrix did not reload with the newly defined derived metric",
    );

    // ── editing a definition proposes an update; the matrix keeps the old row ──
    assert.ok(
      checks.editDefinition.get,
      "editing a definition did not read it through metricGet",
    );
    assert.equal(checks.editDefinition.get?.area, "financial");
    assert.equal(checks.editDefinition.get?.metricId, "cash-out");
    assert.equal(checks.editDefinition.form.mode, "edit", "the edit form is not in edit mode");
    assert.equal(checks.editDefinition.form.source, "derived");
    assert.equal(checks.editDefinition.form.label, "Cash out");
    assert.equal(checks.editDefinition.form.database, "finance:transactions");
    assert.ok(checks.editDefinition.form.measure, "the edit form did not prefill the measure column");
    assert.ok(checks.editDefinition.form.dateColumn, "the edit form did not prefill the date column");
    assert.ok(
      checks.editDefinition.proposal,
      "editing a definition did not call metricPropose",
    );
    assert.equal(checks.editDefinition.proposal?.action, "update");
    assert.equal(checks.editDefinition.proposal?.area, "financial");
    assert.equal(checks.editDefinition.proposal?.metricId, "cash-out");
    assert.equal(
      checks.editDefinition.proposal?.definition?.id,
      "cash-out",
      "an edit changed the definition id",
    );
    assert.equal(
      checks.editDefinition.proposal?.definition?.label,
      "Cash out (gross)",
      "the update proposal does not carry the changed label",
    );
    assert.equal(checks.editDefinition.proposal?.definition?.source, "derived");
    assert.equal(
      checks.editDefinition.proposal?.definition?.databaseId,
      "finance:transactions",
    );
    assert.match(
      String(checks.editDefinition.proposalStatus),
      /Sent to Decisions/,
      "the update proposal shows no status line",
    );
    assert.equal(
      checks.editDefinition.rowLabel,
      "Cash out",
      "the matrix shows the proposed label before the Decision is approved",
    );
    assert.equal(
      checks.editDefinition.defineCallsAfter,
      checks.editDefinition.defineCallsBefore,
      "editing a definition went through metricDefine; an edit must be proposed",
    );

    // ── deleting a definition confirms, then proposes a delete ─────────────
    assert.equal(checks.deleteDefinition.confirmShown, true, "Delete opened no confirm");
    assert.match(
      String(checks.deleteDefinition.confirmText),
      /Cash in/,
      "the delete confirm does not name the metric",
    );
    assert.ok(
      checks.deleteDefinition.proposal,
      "confirming the delete did not call metricPropose",
    );
    assert.equal(checks.deleteDefinition.proposal?.action, "delete");
    assert.equal(checks.deleteDefinition.proposal?.area, "financial");
    assert.equal(checks.deleteDefinition.proposal?.metricId, "cash-in");
    assert.equal(
      checks.deleteDefinition.proposal?.definition,
      undefined,
      "the delete proposal carried a definition; a delete names the metric only",
    );
    assert.match(
      String(checks.deleteDefinition.proposalStatus),
      /Sent to Decisions/,
      "the delete proposal shows no status line",
    );
    assert.equal(
      checks.deleteDefinition.rowPresent,
      true,
      "the metric row vanished after the delete proposal; the definition stays until approval",
    );

    // ── ask-companion uses the app's prepared-chat door ────────────────────
    assert.match(
      String(checks.askCompanion.kickoff),
      /define a metric for/i,
      "ask-companion sent no prepared kickoff",
    );
    assert.ok(
      checks.askCompanion.sessions > checks.askCompanion.sessionsBefore,
      "ask-companion opened no chat",
    );

    // ── the empty read is an empty STATE, not fake zeros ───────────────────
    assert.equal(
      checks.emptyState.input?.lens,
      "mind",
      "the empty-state leg did not ask for the empty lens",
    );
    assert.equal(
      checks.emptyState.empty,
      true,
      "a lens with no definitions does not show analytics-empty",
    );
    assert.deepEqual(checks.emptyState.rows, [], "the empty matrix still draws rows");

    // ── nothing unexpected ─────────────────────────────────────────────────
    assert.deepEqual(
      checks.unexpectedBridgeCalls,
      [],
      "the page called bridge methods the rig does not model",
    );
    assert.deepEqual(checks.consoleErrors, [], "the page logged console errors");
    assert.ok(
      checks.dataListenerCount >= 1,
      "the page holds no listener on the vault's change signal",
    );

    // ── the picture shows the shipped surface ──────────────────────────────
    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(shot), true, `the rig captured no ${path.basename(shot)}`);
      assert.ok(
        fs.statSync(shot).size > 10_000,
        `${path.basename(shot)} is too small to be a rendered matrix`,
      );
    }
  });
});
