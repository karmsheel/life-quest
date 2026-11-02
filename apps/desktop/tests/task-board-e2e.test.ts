import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Act page and its Kanban board, rendered by the real page in a real layout
 * engine. The claims live in `e2e/task-board.electron.mjs`; this file runs that
 * driver and refuses a report that does not hold.
 *
 * The request this rig is about has five clauses, and each is measured:
 *
 *   the board is a modern Kanban — six columns through In-progress and Next 30
 *   days, a card can be dragged across columns or reordered in place, a column
 *   can add its own card, and a cancelled drag writes nothing;
 *
 *   "the design is not consistent with the rest of the app" — card and column
 *   radii are read as computed pixels, not class names;
 *
 *   "put the delete option under a 3-dot menu on the card" — no card draws a bare
 *   Delete, the menu opens with one, and Delete removes the card through the
 *   board's own command;
 *
 *   "if the width of the page expands, the columns should also increase in width
 *   (up to a point)" — four sheet widths are sampled, the columns must widen
 *   together, and past the board's ceiling they must stop;
 *
 *   the Strategy badge and the Execution brief section are gone from the page.
 *
 * The second request this rig grew is measured here too:
 *
 *   "the heading size of the various cards is too big — reduce it to the heading
 *   size in the columns" — both sizes are read as computed pixels and compared,
 *   card by card, against the column heading above it;
 *
 *   "add an icon that signifies the card was added by the agent, hover says added
 *   by agent" — exactly the agent-seeded card wears the mark, and its tooltip and
 *   accessible name both say "Added by agent";
 *
 *   "send to agent" — every card offers a raised button whose visible label names
 *   its own task; pressing it asks a confirmation that explains the new session
 *   and the card's context, cancelling starts nothing, and confirming creates ONE
 *   new chat, gives it the task's id and details, and instructs the agent to call
 *   `move_task` into Done only when the work is genuinely complete. Sending
 *   writes no map command: the agent moves the card, not the person sending it;
 *
 *   "when I click add a task under a column... when I click outside the column the
 *   modal does not disappear as it should" — the column composer is open, a press
 *   inside it keeps it open, and a press outside it closes it without writing.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up. `LIFEQUEST_DEV_PORT` lets the
 * rig point at a server other than 5173 (the port the operator's own dev holds).
 *
 * The artifact is `e2e/artifacts/task-board.json` plus the `.png`s the driver
 * captures: same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = Number(process.env.LIFEQUEST_DEV_PORT ?? 5173);
const REPORT = path.join(desktopRoot, "e2e/artifacts/task-board.json");
const SHOTS = [
  path.join(desktopRoot, "e2e/artifacts/task-board.png"),
  path.join(desktopRoot, "e2e/artifacts/task-board-standard.png"),
  path.join(desktopRoot, "e2e/artifacts/task-board-menu.png"),
  path.join(desktopRoot, "e2e/artifacts/task-board-editor.png"),
  path.join(desktopRoot, "e2e/artifacts/task-board-drag.png"),
  path.join(desktopRoot, "e2e/artifacts/task-board-send-confirm.png"),
  path.join(desktopRoot, "e2e/artifacts/task-board-light.png"),
];

/** Every claim the driver must have recorded, by name. */
const SCENARIOS = [
  "skin",
  "page-order",
  "page-trimmed",
  "columns",
  "card-anatomy",
  "card-title-scale",
  "agent-origin",
  "send-agent-control",
  "menu",
  "menu-outside",
  "menu-escape",
  "send-agent-confirm",
  "send-agent-cancel",
  "send-agent",
  "send-agent-failure",
  "delete",
  "edit-open",
  "edit-move",
  "create",
  "drag-across",
  "drag-reorder",
  "drag-cancel",
  "column-add",
  "composer-outside",
  "drag-scroll",
  "width-growth",
  "width-cap",
  "no-overflow",
  "clean",
];

type Column = {
  id: string;
  label: string;
  headerCount: string;
  width: number;
  radius: number;
  cardCount: number;
  cards: string[];
};

type WidthSample = {
  name: string;
  width: number;
  pageWidth: number;
  boardWidth: number;
  gridWidth: number;
  tracks: number[];
  columns: Column[];
  total: string;
  scrollport: { client: number; scroll: number; overflowX: string } | null;
  viewport: {
    width: number;
    client: number;
    scroll: number;
    scrollLeft: number;
    overflowX: string;
  } | null;
};

type Scenario = { name: string; pass: boolean; detail: string | null };

type Chip = { label: string; danger: boolean };

type Mark = { label: string | null; title: string | null };

type DialogState = {
  role: string | null;
  modal: string | null;
  title: string | null;
  message: string | null;
  confirm: string | null;
  cancel: string | null;
};

type SendAgentControl = {
  label: string | null;
  title: string | null;
  text: string | null;
  tag: string;
  inFoot: boolean;
  iconFirst: boolean;
  style: { backgroundImage: string; boxShadow: string };
};

type SendAgentReport = {
  sessions: { id: string; title: string }[];
  dock: {
    requestedSessionId: string | null;
    requestedKickoff: string | null;
  } | null;
  mapCommands: { type?: string }[];
  confirmation: {
    dialog: DialogState | null;
    sessions: { id: string; title: string }[];
    dock: {
      requestedSessionId: string | null;
      requestedKickoff: string | null;
    } | null;
  };
  cancelled: {
    dialog: DialogState | null;
    sessions: { id: string; title: string }[];
    dock: {
      requestedSessionId: string | null;
      requestedKickoff: string | null;
    } | null;
    mapCommands: { type?: string }[];
  };
  failure: {
    error: string | null;
    sessions: { id: string; title: string }[];
    dock: {
      requestedSessionId: string | null;
      requestedKickoff: string | null;
    } | null;
  };
};

type Report = {
  pass: boolean;
  failures: string[];
  what: string;
  skin: { name: string; applied: string | null };
  checks: {
    scenarios: Scenario[];
    widths: WidthSample[];
    dom: {
      pageChildren: string[];
      heading: string | null;
      cardCount: number;
      cardRadii: number[];
      columnRadii: number[];
      chips: { id: string; chips: Chip[] }[];
      cardTitlePx: (number | null)[];
      columnTitlePx: (number | null)[];
      agentBadges: { id: string; badge: Mark | null }[];
      sendAgentControls: { id: string; title: string; control: SendAgentControl | null }[];
      sendAgent: SendAgentReport;
      dialog: DialogState | null;
      bareDeletes: number;
      menu: {
        role: string;
        items: string[];
        testIds: string[];
        danger: string[];
      } | null;
    };
    unexpectedBridgeCalls: string[];
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
      [path.join(desktopRoot, "e2e/task-board.electron.mjs")],
      {
        cwd: desktopRoot,
        timeout: 180_000,
        // The driver's own log names the step it reached; inheriting stdio keeps
        // a crash legible instead of reducing it to a bare exit code.
        stdio: "inherit",
        env: {
          ...process.env,
          LIFEQUEST_E2E_URL: `http://127.0.0.1:${DEV_PORT}/e2e/task-board.html`,
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

const columnWidths = (sample: WidthSample) =>
  sample.columns.map((column) => column.width);

describe("Act task board e2e", () => {
  it("is the board the operator asked for, at every width", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` ` +
          `(or set LIFEQUEST_DEV_PORT) to include this e2e`,
      );
      return;
    }

    const code = await runDriver();
    assert.equal(code, 0, "the task-board driver reported a failure");
    assert.ok(fs.existsSync(REPORT), `the driver wrote no report at ${REPORT}`);

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(report.pass, true, `the report failed: ${report.failures.join("; ")}`);
    assert.deepEqual(report.failures, []);
    assert.ok(report.skin.name, "the harness painted no skin");
    assert.equal(report.skin.applied, report.skin.name, "the harness painted the wrong skin");

    assert.deepEqual(
      report.checks.scenarios.map((scenario) => scenario.name),
      SCENARIOS,
      "the driver's claims moved",
    );
    for (const scenario of report.checks.scenarios) {
      assert.equal(scenario.pass, true, `${scenario.name}: ${scenario.detail}`);
    }

    // ── Page order and card anatomy ───────────────────────────────────────────
    assert.deepEqual(
      report.checks.dom.pageChildren.slice(0, 2),
      ["header", "board"],
      "the Act page draws its board before its header",
    );
    assert.equal(report.checks.dom.cardCount, 11, "the fixture's eleven cards are not on the board");
    assert.deepEqual(
      [...new Set(report.checks.dom.cardRadii)],
      [6],
      "cards are not at the design's --radius-xs step",
    );
    assert.deepEqual(
      [...new Set(report.checks.dom.columnRadii)],
      [12],
      "columns are not at the design's --radius-sm step",
    );
    assert.equal(report.checks.dom.bareDeletes, 0, "a card still draws a bare Delete");

    // The dangling link is legible as a missing link, in the destructive ink.
    const legacy = report.checks.dom.chips.find((entry) => entry.id === "t-legacy");
    assert.ok(legacy, "the dangling-link card is not on the board");
    assert.deepEqual(
      legacy?.chips.filter((chip) => chip.danger).map((chip) => chip.label),
      ["Missing goal"],
      "a dangling goal is not marked as missing",
    );

    // ── Cards are titled at the columns' own heading size ─────────────────────
    const columnSizes = [...new Set(report.checks.dom.columnTitlePx)];
    assert.equal(columnSizes.length, 1, `column headings disagree: ${JSON.stringify(columnSizes)}`);
    const headingPx = columnSizes[0];
    assert.ok(typeof headingPx === "number" && headingPx > 0, "no column heading size was measured");
    assert.equal(
      report.checks.dom.cardTitlePx.length,
      report.checks.dom.cardCount,
      "not every card's title was measured",
    );
    for (const size of report.checks.dom.cardTitlePx) {
      assert.equal(
        size,
        headingPx,
        `a card title is not the column heading's size: ${size}px vs ${headingPx}px`,
      );
    }

    // ── Provenance: one agent-added card, marked and labelled ─────────────────
    const marked = report.checks.dom.agentBadges.filter((entry) => entry.badge);
    assert.equal(marked.length, 1, `an agent mark is on ${marked.length} cards, not one`);
    assert.equal(marked[0]?.id, "t-banking", "the mark is on the wrong card");
    assert.equal(marked[0]?.badge?.label, "Added by agent", "the mark's accessible name moved");
    assert.equal(marked[0]?.badge?.title, "Added by agent", "the mark's hover text moved");

    // ── Send-to-agent: a first-class control, a new chat, a completion gate ───────
    assert.equal(
      report.checks.dom.sendAgentControls.length,
      report.checks.dom.cardCount,
      "not every card offers a send-to-agent control",
    );
    for (const entry of report.checks.dom.sendAgentControls) {
      assert.equal(entry.control?.tag, "button", `${entry.id}'s send-to-agent is not a button`);
      assert.equal(
        entry.control?.title,
        "Send to agent",
        `${entry.id}'s send-to-agent tooltip moved`,
      );
      assert.equal(
        entry.control?.text,
        "Send to agent",
        `${entry.id}'s send-to-agent visible label moved`,
      );
      assert.equal(
        entry.control?.label,
        `Send to agent: ${entry.title}`,
        `${entry.id}'s send-to-agent accessible name does not lead with its visible label`,
      );
      assert.equal(
        entry.control?.iconFirst,
        true,
        `${entry.id}'s send-to-agent has no Send glyph before the words`,
      );
      // "Shading and a 3D effect": the raised key's gradient face and its drop
      // shadow, read as computed values rather than as a class name.
      assert.match(
        entry.control?.style.backgroundImage ?? "",
        /gradient/,
        `${entry.id}'s send-to-agent has no shaded face`,
      );
      assert.notEqual(
        entry.control?.style.boxShadow,
        "none",
        `${entry.id}'s send-to-agent has no lift off the card`,
      );
    }
    // ── The press asks first, and the question explains the session ──────────
    const confirmation = report.checks.dom.sendAgent.confirmation;
    assert.equal(confirmation.dialog?.role, "dialog", "the confirmation is not a dialog");
    assert.equal(confirmation.dialog?.modal, "true", "the confirmation is not modal");
    assert.equal(confirmation.dialog?.title, "Send to agent", "the question's heading moved");
    assert.equal(confirmation.dialog?.confirm, "Send to agent", "the confirming control moved");
    assert.equal(confirmation.dialog?.cancel, "Cancel", "the cancelling control moved");
    for (const phrase of ["starts a new session", "context", "start working"]) {
      assert.ok(
        (confirmation.dialog?.message ?? "").includes(phrase),
        `the confirmation does not explain ${JSON.stringify(phrase)}: ${confirmation.dialog?.message}`,
      );
    }
    assert.equal(confirmation.sessions.length, 0, "asking started a chat before the answer");
    assert.equal(
      confirmation.dock?.requestedSessionId ?? null,
      null,
      "asking re-pointed the dock before the answer",
    );

    // ── Cancelling starts nothing ─────────────────────────────────────────────
    const cancelled = report.checks.dom.sendAgent.cancelled;
    assert.equal(cancelled.dialog, null, "the question stayed up after cancel");
    assert.equal(cancelled.sessions.length, 0, "cancelling still created a chat");
    assert.equal(
      cancelled.dock?.requestedSessionId ?? null,
      null,
      "cancelling still re-pointed the dock",
    );
    assert.deepEqual(cancelled.mapCommands, [], "cancelling wrote a map command");

    const sendAgent = report.checks.dom.sendAgent;
    assert.equal(sendAgent.sessions.length, 1, "send-to-agent did not create exactly one chat");
    assert.ok(
      sendAgent.sessions[0]?.title.includes("Ship the redesigned Act board"),
      `the chat is not named for the task: ${sendAgent.sessions[0]?.title}`,
    );
    assert.equal(
      sendAgent.dock?.requestedSessionId,
      sendAgent.sessions[0]?.id,
      "the dock was not asked to open the new chat",
    );
    const kickoff = sendAgent.dock?.requestedKickoff ?? "";
    for (const required of [
      "Task id: t-ship",
      "Ship the redesigned Act board",
      "Menus, column rhythm, responsive widths.",
      // The board-resolved link labels, not ids: a broken sendToAgentContext
      // cannot pass by handing the agent a well-formed prompt about nothing.
      "Column: This week",
      "Goal: Ship a calmer operating system",
      "Project: Act board redesign",
      "Week item: Weekly review",
      "move_task",
      'column: "done"',
    ]) {
      assert.ok(kickoff.includes(required), `the kickoff is missing ${JSON.stringify(required)}`);
    }
    assert.deepEqual(
      sendAgent.mapCommands,
      [],
      "sending a task wrote a map command; only the agent moves the card",
    );

    // A failure is reported, and creates no chat and no card movement.
    assert.equal(sendAgent.failure.error, "gateway down", "a failed send-to-agent is not reported");
    assert.equal(
      sendAgent.failure.sessions.length,
      1,
      "a failed send-to-agent still created a chat",
    );
    assert.equal(
      sendAgent.failure.dock?.requestedSessionId,
      sendAgent.sessions[0]?.id,
      "a failed send-to-agent still re-pointed the dock at a chat",
    );

    // ── The 3-dot holds the destructive action ────────────────────────────────
    assert.deepEqual(
      report.checks.dom.menu?.items,
      ["Edit details", "Delete"],
      "the card menu's items moved",
    );
    assert.deepEqual(
      report.checks.dom.menu?.testIds,
      ["task-menu-edit", "task-menu-delete"],
      "the card menu's test ids moved",
    );
    assert.deepEqual(
      report.checks.dom.menu?.danger,
      ["Delete"],
      "Delete is not the menu's destructive item",
    );
    assert.equal(report.checks.dom.menu?.role, "menu", "the popup is not a menu");

    // ── The columns widen with the page and stop at the ceiling ───────────────
    assert.deepEqual(
      report.checks.widths.map((entry) => entry.name),
      ["standard-sheet", "expanded-sheet", "wide-sheet", "capped-sheet"],
      "the sampled widths moved",
    );
    const [standard, expanded, wide, capped] = report.checks.widths;

    for (const entry of report.checks.widths) {
      assert.equal(entry.columns.length, 6, `not six columns at ${entry.name}`);
      assert.deepEqual(
        entry.columns.map((column) => column.id),
        ["done", "in-progress", "today", "this-week", "next-30-days", "backlog"],
        `the column order moved at ${entry.name}`,
      );
      const widths = columnWidths(entry);
      assert.ok(
        Math.max(...widths) - Math.min(...widths) <= 1,
        `columns are unequal at ${entry.name}: ${JSON.stringify(widths)}`,
      );
      for (const width of widths) {
        assert.ok(
          width >= 167,
          `a column fell below the readable 10.5rem floor at ${entry.name}: ${width}px`,
        );
      }
    }

    // The reported case: at the app's default sheet the columns are not pinned
    // to a 40rem page, and an expanded sheet gives them more width.
    assert.ok(
      expanded.pageWidth > standard.pageWidth + 200,
      `the page did not expand: ${standard.pageWidth} → ${expanded.pageWidth}`,
    );
    assert.ok(
      columnWidths(expanded)[0] > columnWidths(standard)[0] + 5,
      `columns did not widen: ${JSON.stringify(columnWidths(standard))} → ` +
        `${JSON.stringify(columnWidths(expanded))}`,
    );
    assert.ok(
      columnWidths(wide)[0] > columnWidths(expanded)[0] + 40,
      `columns did not widen again: ${JSON.stringify(columnWidths(expanded))} → ` +
        `${JSON.stringify(columnWidths(wide))}`,
    );

    // "Up to a point": the sheet keeps expanding, the board does not.
    assert.ok(
      capped.pageWidth > wide.pageWidth + 200,
      `the capped sheet did not expand: ${wide.pageWidth} → ${capped.pageWidth}`,
    );
    assert.ok(
      Math.abs(capped.gridWidth - wide.gridWidth) <= 1,
      `the board kept growing past its ceiling: ${wide.gridWidth} → ${capped.gridWidth}`,
    );
    assert.ok(
      columnWidths(capped)[0] <= 361,
      `a column grew past its ceiling: ${columnWidths(capped)[0]}px`,
    );

    // Nothing paints past the sheet at any width. At the standard sheet the
    // board's own viewport is what scrolls; the page itself never does.
    for (const entry of report.checks.widths) {
      const scroller = entry.scrollport;
      assert.ok(scroller, `no scrollport at ${entry.name}`);
      assert.ok(
        (scroller?.scroll ?? 0) <= (scroller?.client ?? 0) + 1,
        `the page overflows sideways at ${entry.name}: ${scroller?.scroll} in ${scroller?.client}`,
      );
      assert.ok(
        entry.boardWidth <= entry.pageWidth + 1,
        `the board (${entry.boardWidth}px) is wider than its page (${entry.pageWidth}px) at ${entry.name}`,
      );
      assert.ok(
        entry.viewport && entry.viewport.width <= entry.pageWidth + 1,
        `the board viewport overflows the page at ${entry.name}`,
      );
      assert.ok(
        (entry.viewport?.overflowX ?? "") === "auto" ||
          (entry.viewport?.overflowX ?? "") === "scroll",
        `the board viewport does not scroll at ${entry.name}`,
      );
    }

    assert.ok(
      (standard.viewport?.scroll ?? 0) > (standard.viewport?.client ?? 0) + 20,
      `the standard sheet does not scroll the six columns: ${JSON.stringify(standard.viewport)}`,
    );
    assert.ok(
      (expanded.viewport?.scroll ?? 0) <= (expanded.viewport?.client ?? 0) + 1,
      `the expanded sheet still scrolls: ${JSON.stringify(expanded.viewport)}`,
    );

    // ── The artifact ──────────────────────────────────────────────────────────
    for (const shot of SHOTS) {
      assert.ok(fs.existsSync(shot), `the driver captured no ${path.basename(shot)}`);
      assert.ok(fs.statSync(shot).size > 2_000, `${path.basename(shot)} is too small to be a picture`);
    }

    assert.deepEqual(report.checks.unexpectedBridgeCalls, [], "the page reached for an unmodelled bridge method");
    assert.deepEqual(report.checks.consoleErrors, [], "the page logged a console error");
  });
});
