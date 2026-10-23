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
 *   the board is a modern Kanban — six columns through This quarter and This
 *   month, a card can be dragged across columns or reordered in place, a column
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
  path.join(desktopRoot, "e2e/artifacts/task-board-light.png"),
];

/** Every claim the driver must have recorded, by name. */
const SCENARIOS = [
  "skin",
  "page-order",
  "page-trimmed",
  "columns",
  "card-anatomy",
  "menu",
  "menu-outside",
  "menu-escape",
  "delete",
  "edit-open",
  "edit-move",
  "create",
  "drag-across",
  "drag-reorder",
  "drag-cancel",
  "column-add",
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
        ["done", "today", "this-week", "this-month", "this-quarter", "backlog"],
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
