import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Projects on the Execute wing, rendered by the real pages in a real layout
 * engine inside the real shell. The claims live in `e2e/projects.electron.mjs`
 * (mounted on the real `AppShell`/`NavRail`/`WingProvider` with a recording stub
 * vault); this file runs that driver and refuses a report that does not hold.
 *
 * The request this rig is about has four clauses, and each is measured:
 *
 *   Projects moves from Plan to Execute on the rail, and it is the Execute wing
 *   that owns `/projects`; the register shows every built-in attribute; the
 *   project's own page carries the header, the progress timeline, the context
 *   document and the tasks/signals/Decisions/log gathered around it; and
 *   "log progress" writes `addUpdate` through the page's own IPC call and the
 *   percent and timeline change on screen.
 *
 * The rig needs the Vite dev server — the harness page is TSX. With the server
 * down the test skips; `/root/.local/bin/lifequest-e2e <worktree>` runs the
 * suite correctly against this checkout. `LIFEQUEST_DEV_PORT` points the rig at a
 * server other than 5173.
 *
 * The artifact is `e2e/artifacts/projects.json` plus the `.png`s the driver
 * captures: same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = Number(process.env.LIFEQUEST_DEV_PORT ?? 5173);
const REPORT = path.join(desktopRoot, "e2e/artifacts/projects.json");
const SHOTS = [
  path.join(desktopRoot, "e2e/artifacts/projects.png"),
  path.join(desktopRoot, "e2e/artifacts/projects-execute-wing.png"),
  path.join(desktopRoot, "e2e/artifacts/projects-detail.png"),
  path.join(desktopRoot, "e2e/artifacts/projects-new-modal.png"),
];

/** Every claim the driver must have recorded, by name. */
const SCENARIOS = [
  "skin",
  "rail-execute",
  "top-bar-tabs",
  "page-eyebrow",
  "new-project-inline",
  "modal-closed-by-default",
  "list-count",
  "list-attributes",
  "list-filter",
  "list-filter-closed",
  "wing-tab-plan",
  "rail-plan",
  "wing-tab-execute",
  "wing-switch",
  "detail-route",
  "detail-header",
  "detail-progress",
  "detail-context",
  "detail-attributes",
  "detail-collated",
  "no-overflow",
  "log-progress-range",
  "log-progress-note",
  "log-progress",
  "no-overflow-after-write",
  "modal-opens",
  "modal-escape",
  "modal-backdrop",
  "modal-cancel-click",
  "modal-cancel",
  "modal-create-title",
  "modal-create-summary",
  "modal-create-context-open",
  "modal-create-context",
  "modal-create-submit",
  "modal-create",
  "clean",
];

const EXECUTE_RAIL = ["Projects", "Daily Schedule", "Act"];
const PLAN_RAIL = ["Goals", "Life Map", "Architecture"];

type RailRow = { label: string | null; href: string | null; active: boolean };
type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};
type NewButton = {
  label: string | null;
  type: string | null;
  rect: Rect;
  inHeader: boolean;
};
type ModalState = {
  role: string | null;
  ariaModal: string | null;
  labelledBy: string | null;
  labelledText: string | null;
  backdrop: boolean;
  backdropCoversViewport: boolean;
  formInside: boolean;
  formPresent: boolean;
  focused: string | null;
};
type Scenario = { name: string; pass: boolean; detail: string | null };
type ListRow = {
  id: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  summary: string | null;
  goal: string | null;
  domain: string | null;
  target: string | null;
  next: string | null;
  progress: string | null;
};
type TimelineRow = { note: string | null; progress: string | null; actor: string | null };
type Detail = {
  title: string | null;
  status: string | null;
  statusData: string | null;
  summary: string | null;
  meta: string[];
  stateNote: string | null;
  nextAction: string | null;
  progress: string | null;
  progressData: string | null;
  timeline: TimelineRow[];
  contextPresent: boolean;
  contextText: string | null;
  details: Record<string, string | null> | null;
  tasks: { type: string | null; summary: string | null }[];
  signals: { type: string | null; summary: string | null }[];
  decisions: { type: string | null; summary: string | null }[];
  log: { type: string | null; summary: string | null }[];
};
type Overflow = {
  document: { scrollWidth: number; clientWidth: number };
  content: { scrollWidth: number; clientWidth: number } | null;
  body: number;
};
type Report = {
  pass: boolean;
  failures: string[];
  what: string;
  checks: {
    scenarios: Scenario[];
    initial: {
      route: string | null;
      activeTab: string | null;
      tabs: { label: string | null; selected: boolean }[];
      rail: RailRow[];
      eyebrow: string | null;
      count: string | null;
      headingRect: Rect | null;
      headerRect: Rect | null;
      newButton: NewButton | null;
      rows: ListRow[];
    };
    wing: {
      plan: { activeTab: string | null; rail: RailRow[] };
      execute: { activeTab: string | null; rail: RailRow[] };
    };
    detail: Detail | null;
    afterLogProgress: {
      progress: string | null;
      timeline: TimelineRow[];
      call: { method: string; args: unknown[] } | null;
    };
    newProject: {
      inline: NewButton | null;
      heading: Rect | null;
      header: Rect | null;
      closedByDefault: boolean;
      modal: ModalState | null;
      escape: { modalClosed: boolean; focus: string | null };
      backdrop: { modalClosed: boolean; focus: string | null };
      cancel: { modalClosed: boolean };
      create: {
        count: string | null;
        newRow: ListRow | null;
        call: { method: string; args: unknown[] } | null;
      };
    };
    overflow: { detail: Overflow; afterWrite: Overflow };
    screenshots: string[];
    unmodelled: string[];
    consoleErrors: string[];
  };
};

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
      [path.join(desktopRoot, "e2e/projects.electron.mjs")],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        // The driver's own log names the step it reached; inheriting stdio keeps
        // a crash legible instead of reducing it to a bare exit code.
        stdio: "inherit",
        env: {
          ...process.env,
          LIFEQUEST_E2E_URL: `http://127.0.0.1:${DEV_PORT}/e2e/projects.html`,
        },
      },
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

const labels = (rail: RailRow[]) => rail.map((row) => row.label);

describe("Projects on the Execute wing e2e", () => {
  it("is the register and the project page the spec asks for, in the shipped shell", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` ` +
          `(or set LIFEQUEST_DEV_PORT) to include this e2e`,
      );
      return;
    }

    const code = await runDriver();
    assert.equal(code, 0, "the projects driver reported a failure");
    assert.ok(fs.existsSync(REPORT), `the driver wrote no report at ${REPORT}`);

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(report.pass, true, `the report failed: ${report.failures.join("; ")}`);
    assert.deepEqual(report.failures, []);

    assert.deepEqual(
      report.checks.scenarios.map((scenario) => scenario.name),
      SCENARIOS,
      "the driver's claims moved",
    );
    for (const scenario of report.checks.scenarios) {
      assert.equal(scenario.pass, true, `${scenario.name}: ${scenario.detail}`);
    }

    // ── Projects lives on Execute, not Plan ─────────────────────────────────
    assert.equal(report.checks.initial.route, "/projects", "a cold load of /projects was somewhere else");
    assert.equal(report.checks.initial.activeTab, "Act", "the ship selected another wing for /projects");
    assert.deepEqual(
      report.checks.initial.tabs.map((tab) => tab.label),
      ["Home", "Define", "Plan", "Act", "Review"],
      "the rail's wings moved",
    );
    assert.deepEqual(labels(report.checks.initial.rail), EXECUTE_RAIL, "the Execute rail moved");
    assert.equal(report.checks.initial.rail[0]?.href, "/projects", "the Projects rail row points elsewhere");
    assert.equal(report.checks.initial.rail[0]?.active, true, "the Projects row is not the active one");
    assert.equal(report.checks.initial.eyebrow, "Execute", "the page's eyebrow does not read Execute");

    // ── The heading's New project button, measured as boxes ────────────────
    const newButton = report.checks.initial.newButton;
    const h1 = report.checks.initial.headingRect;
    const header = report.checks.initial.headerRect;
    assert.ok(newButton, "the Projects heading carries no New project button");
    assert.equal(newButton?.label, "New project", "the heading button is not labelled New project");
    assert.equal(newButton?.type, "button", "the heading button would submit a form");
    assert.equal(newButton?.inHeader, true, "the New project button is not in the page header");
    assert.ok(h1 && header, "the page header or its h1 was not measured");
    assert.ok(
      newButton.rect.top < h1.bottom && newButton.rect.bottom > h1.top,
      `the New project button is not on the h1's row: button ${JSON.stringify(newButton.rect)}, h1 ${JSON.stringify(h1)}`,
    );
    assert.ok(
      newButton.rect.left >= h1.right - 1,
      "the New project button is not to the right of the heading",
    );
    assert.ok(
      Math.abs(newButton.rect.centerY - h1.centerY) <= 6,
      `the New project button is not vertically aligned with the h1: button centre ${newButton.rect.centerY}, h1 centre ${h1.centerY}`,
    );
    assert.ok(
      header &&
        newButton.rect.left >= header.left - 1 &&
        newButton.rect.right <= header.right + 1 &&
        newButton.rect.top >= header.top - 1 &&
        newButton.rect.bottom <= header.bottom + 1,
      "the New project button sits outside the heading row's box",
    );

    // ── The composer is a modal: absent until the button is pressed ────────
    assert.equal(report.checks.newProject.closedByDefault, true, "the create form or modal is rendered before any click");

    // The Plan wing has its own three rows and no Projects.
    assert.deepEqual(labels(report.checks.wing.plan.rail), PLAN_RAIL, "the Plan rail moved");
    assert.equal(report.checks.wing.plan.activeTab, "Plan");
    assert.ok(
      !labels(report.checks.wing.plan.rail).includes("Projects"),
      "Projects is still drawn under Plan",
    );
    assert.deepEqual(labels(report.checks.wing.execute.rail), EXECUTE_RAIL, "the Execute rail moved after a switch");
    assert.equal(report.checks.wing.execute.activeTab, "Act");
    assert.equal(report.checks.wing.execute.rail[0]?.active, true, "the Projects row lost its active state");

    // ── The register shows the built-in attributes ──────────────────────────
    assert.equal(report.checks.initial.count, "4 projects", "the register's count is not the fixture's");
    assert.deepEqual(
      report.checks.initial.rows.map((row) => row.id),
      ["p-exec", "p-paused", "p-closed", "p-trip"],
      "the register's rows moved",
    );
    const [exec, paused, closed, trip] = report.checks.initial.rows;
    assert.equal(exec?.title, "Ship the Execute wing");
    assert.equal(exec?.status, "Active", "the active row's status chip is wrong");
    assert.equal(exec?.priority, "High priority", "the active row does not show its priority");
    assert.equal(exec?.goal, "Ship a calmer operating system", "the active row does not resolve its goal");
    assert.equal(exec?.domain, "Health", "the active row does not resolve its domain");
    assert.ok(String(exec?.target).includes("2026"), "the active row does not show its target date");
    assert.equal(exec?.next, "Next: Wire the rail and ship the rig", "the active row does not show its next action");
    assert.equal(exec?.progress, "60%", "the active row does not show its progress");
    assert.ok(String(exec?.summary).includes("Tools landed"), "the active row does not show its state note");
    assert.equal(paused?.status, "Paused");
    assert.equal(paused?.domain, "Unassigned", "an unassigned project did not say so");
    assert.equal(paused?.goal, "No goal", "a project with no goal did not say so");
    assert.equal(closed?.status, "Closed");
    assert.equal(closed?.progress, "100%");
    assert.equal(trip?.status, "Open");
    assert.equal(trip?.priority, "Low priority");

    // ── The project's own page ──────────────────────────────────────────────
    const detail = report.checks.detail;
    assert.ok(detail, "the driver recorded no detail page");
    assert.equal(detail?.title, "Ship the Execute wing");
    assert.equal(detail?.status, "Active");
    assert.equal(detail?.statusData, "active");
    assert.ok(String(detail?.summary).includes("Move Projects to Execute"), "the detail lost its summary");
    assert.ok(
      detail?.meta.some((line) => line.includes("Ship a calmer operating system")),
      "the detail does not resolve the goal's name",
    );
    assert.ok(detail?.meta.includes("Health"), "the detail does not resolve the domain's name");
    assert.ok(detail?.meta.includes("High priority"), "the detail does not show priority");
    assert.ok(detail?.meta.some((line) => line.includes("2026")), "the detail does not show its dates");
    assert.ok(String(detail?.stateNote).includes("Tools landed"), "the detail lost its state note");
    assert.equal(detail?.nextAction, "Wire the rail and ship the rig");
    assert.equal(detail?.progress, "60%");
    assert.equal(detail?.progressData, "60");

    assert.deepEqual(
      detail?.timeline.map((row) => row.note),
      ["Companion tools landed", "Kickoff and the schema landed"],
      "the timeline is not read newest-first from the file",
    );
    assert.deepEqual(detail?.timeline.map((row) => row.progress), ["60%", "25%"]);
    assert.ok(detail?.timeline.every((row) => row.actor === "Hermes"), "the timeline lost its actors");

    assert.equal(detail?.contextPresent, true, "the context editor is gone");
    assert.ok(String(detail?.contextText).includes("Context"), "the context editor does not hold the body");
    assert.ok(String(detail?.contextText).includes("get_project"), "the context editor lost the body's prose");

    assert.deepEqual(detail?.details, {
      title: "Ship the Execute wing",
      summary: "Move Projects to Execute and make it agent-readable",
      status: "active",
      priority: "high",
      goal: "g-exec",
      domain: "health",
      start: "2026-10-01",
      target: "2026-12-31",
    });

    // ── The collated context ────────────────────────────────────────────────
    assert.deepEqual(
      detail?.tasks.map((row) => row.summary),
      ["Write the MCP door test", "Move Projects into the Execute rail"],
      "the tasks linked by links.projectId are not collated",
    );
    assert.ok(
      detail?.signals.some((row) => String(row.summary).includes("Projects should collate")),
      "a signal reached through a linked task is not collated",
    );
    assert.ok(
      detail?.signals.some((row) => String(row.summary).includes("The rail reads Execute now")),
      "the second linked signal is not collated",
    );
    assert.equal(detail?.decisions.length, 2, "the Decisions filed against this project are not collated");
    assert.ok(
      detail?.decisions.some((row) => String(row.summary).includes("Create project: Ship the Execute wing")),
      "the create Decision is not collated",
    );
    assert.ok(
      !detail?.decisions.some((row) => String(row.summary).includes("Pause Renew the studio lease")),
      "another project's Decision leaked onto this page",
    );
    assert.deepEqual(
      detail?.log.map((row) => row.type),
      ["project.updated", "project.created"],
      "the project's log lines are not collated",
    );

    // ── Log progress writes addUpdate through the page's own call ──────────
    assert.equal(report.checks.afterLogProgress.progress, "75%", "the percent did not change");
    assert.equal(report.checks.afterLogProgress.timeline.length, 3, "the timeline did not gain the entry");
    assert.equal(
      report.checks.afterLogProgress.timeline[0]?.note,
      "Shipped the rig and proved the wing",
      "the new timeline entry is not first",
    );
    assert.equal(report.checks.afterLogProgress.timeline[0]?.progress, "75%");
    const call = report.checks.afterLogProgress.call;
    assert.ok(call, "the page wrote no projectsUpdate call");
    assert.equal(call?.args[0], "p-exec");
    const patch = call?.args[1] as { progress?: number; addUpdate?: { note?: string; progress?: number } };
    assert.equal(patch.progress, 75, "the write did not carry the percent");
    assert.equal(patch.addUpdate?.note, "Shipped the rig and proved the wing");
    assert.equal(patch.addUpdate?.progress, 75);

    // ── The New-project modal: open, Escape, scrim, Cancel, create ─────────
    const modal = report.checks.newProject.modal;
    assert.ok(modal, "the New project button opened no modal");
    assert.equal(modal?.role, "dialog", "the popup is not a dialog");
    assert.equal(modal?.ariaModal, "true", "the dialog is not marked modal");
    assert.equal(modal?.labelledBy, "new-project-title", "the dialog is not labelled by its heading");
    assert.equal(modal?.labelledText, "New project", "the dialog's label is not New project");
    assert.equal(modal?.backdrop, true, "the modal has no backdrop");
    assert.equal(modal?.backdropCoversViewport, true, "the backdrop does not cover the window");
    assert.equal(modal?.formInside, true, "the create form is not inside the dialog");
    assert.equal(modal?.focused, "project-create-title", "focus did not land on the title field");

    assert.equal(report.checks.newProject.escape.modalClosed, true, "Escape did not close the modal");
    assert.equal(
      report.checks.newProject.escape.focus,
      "project-new",
      "Escape did not return focus to the New project button",
    );
    assert.equal(report.checks.newProject.backdrop.modalClosed, true, "a press on the scrim did not close the modal");
    assert.equal(
      report.checks.newProject.backdrop.focus,
      "project-new",
      "a scrim close did not return focus to the New project button",
    );
    assert.equal(report.checks.newProject.cancel.modalClosed, true, "Cancel did not close the modal");

    const creation = report.checks.newProject.create;
    assert.equal(creation.count, "5 projects", "the register's count did not gain the created project");
    assert.equal(creation.newRow?.title, "Draft the winter plan", "the created project is not the register's first row");
    const createArg = creation.call?.args[0] as {
      title?: string;
      summary?: string;
      bodyMarkdown?: string;
    };
    assert.ok(creation.call, "submitting the modal wrote no projectsCreate call");
    assert.equal(creation.call?.method, "projectsCreate");
    assert.equal(createArg?.title, "Draft the winter plan");
    assert.equal(createArg?.summary, "Three weeks, one bag, no laptop", "the one attribute was not carried");
    assert.ok(
      String(createArg?.bodyMarkdown).includes("Book the flights before the fare rises."),
      "the context document was not carried",
    );
    // ── Nothing paints sideways at the sheet width ─────────────────────────
    for (const [label, overflow] of Object.entries(report.checks.overflow)) {
      assert.ok(
        overflow.document.scrollWidth <= overflow.document.clientWidth + 1,
        `the ${label} page overflows sideways: ${overflow.document.scrollWidth} in ${overflow.document.clientWidth}`,
      );
      assert.ok(overflow.content, `the ${label} page has no sheet scroller`);
      assert.ok(
        (overflow.content?.scrollWidth ?? 0) <= (overflow.content?.clientWidth ?? 0) + 1,
        `the ${label} page's sheet overflows: ${overflow.content?.scrollWidth} in ${overflow.content?.clientWidth}`,
      );
    }

    // ── The artifact: real captures, and a clean page ──────────────────────
    assert.deepEqual(report.checks.screenshots, SHOTS, "the driver captured other files");
    for (const shot of SHOTS) {
      assert.ok(fs.existsSync(shot), `the driver captured no ${path.basename(shot)}`);
      assert.ok(fs.statSync(shot).size > 10_000, `${path.basename(shot)} is too small to be a real capture`);
    }
    assert.deepEqual(report.checks.consoleErrors, [], "a page logged a console error");
    assert.deepEqual(
      report.checks.unmodelled.filter(
        (name) => !/^companion/.test(name) && !/^onCompanion/.test(name),
      ),
      [],
      "a page reached for an unmodelled bridge method",
    );
  });
});
