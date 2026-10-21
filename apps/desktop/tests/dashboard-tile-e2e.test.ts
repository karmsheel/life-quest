import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-tile.json");

/** Every claim the driver must have recorded, by name. */
const SCENARIOS = [
  "skin",
  "board",
  "rows-mix",
  "no-spill",
  "card-fits-its-table",
  "operator-card",
  "row-card",
  "board-floors",
  "stable",
  "no-write",
  "clean",
  "edit-no-icon",
  "edit-menu",
  "edit-handles",
  "edit-width-drag",
  "edit-width-survives-a-reload",
  "edit-height-drag",
  "edit-height-survives-a-reload",
  "edit-width-floor-is-the-content",
  "edit-drag-row",
  "edit-keys-step",
  "edit-outside-exits",
  "edit-escape-exits",
  "edit-is-not-arrange",
  "edit-locked",
];

/**
 * The rig renders the real Dashboard in a real layout engine, so it needs the
 * Vite dev server. With the server down the test skips; `npm run dev` in another
 * terminal brings it up.
 */
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
      [path.join(desktopRoot, "e2e/dashboard-tile.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
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

type Scenario = { name: string; pass: boolean; detail: string | null };

type CardSample = {
  id: string;
  label: string;
  width: number;
  frame: number;
  covered: number;
  gridColumnStart: string;
  gridColumnEnd: string;
  rowCard: boolean;
  need: number;
  table: {
    width: number;
    preferred: number;
    min: number;
    content: number;
    columns: { header: string; width: number }[];
    maxColumns: { header: string; width: number }[];
  } | null;
  spills: { tag: string; cls: string; past: number }[];
};

type WidthSample = {
  name: string;
  width: number;
  tracks: number[];
  unitRem: string;
  minUnits: string;
  gap: number;
  inlineMinWidth: string | null;
  gridWidth: number;
  scrollport: {
    client: number;
    scroll: number;
    overflowX: string;
    scrollLeft: number;
    canScrollSideways: boolean;
  } | null;
  rows: { top: number; count: number; cards: string[] }[];
  cards: CardSample[];
};

/** What each Edit card leg measured, leg by leg. */
type EditSummary = {
  chrome: { spanIcons: number; menus: number; cards: number; chromeButtons: (string | null)[] };
  menu: { items: string[]; testIds: string[] };
  handles: {
    editing: boolean;
    ids: string[];
    handles: { pinId: string; axis: string; role: string; orientation: string; label: string }[];
    width: {
      role: string;
      orientation: string;
      label: string;
      valueNow: string;
      valueMin: string;
      valueMax: string;
    } | null;
    height: {
      role: string;
      orientation: string;
      label: string;
      valueNow: string;
      valueMin: string;
      valueMax: string;
    } | null;
  };
  width: {
    from: number;
    wanted: number;
    units: number;
    width: number;
    storedWidthRem: number | null;
    writes: number;
    reloadedUnits: number;
  };
  height: {
    from: number;
    height: number;
    storedHeightRem: number | null;
    writes: number;
    reloadedHeight: number;
  };
  floor: {
    contentUnits: number;
    unitsBefore: number;
    stoppedAt: number;
    width: number;
    storedWidthRem: number | null;
    writes: number;
  };
  row: {
    pinSpan: number | null;
    storedWidthRem: number | null;
    width: number;
    board: number;
    writes: number;
  };
  keys: {
    widthFrom: number;
    widthTo: number;
    heightFrom: number;
    heightTo: number;
    writes: number;
    spoken: string | null;
  };
  outside: { insideEditing: boolean; outsideEditing: boolean; handlesAfter: number };
  escape: { editing: boolean; handles: number };
  noop: { lifted: number; writes: number; heldAsResize: number };
  locked: { menus: number; handles: number; editing: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  what: string;
  checks: {
    scenarios: Scenario[];
    widths: WidthSample[];
    pinWrites: number;
    edits: EditSummary;
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
};

/**
 * The dashboard's tiles: every card as wide as its content needs, and a board
 * that gives way to its widest card rather than to the window.
 *
 * The fault this is aimed at was measured in the operator's own vault: a
 * "Recent transactions" pin stored one cell wide, holding a four-column nowrap
 * listing, painting outside its own frame. The rig reproduces that card exactly
 * — the view's own file says `span: 2`, the pin says `span: 1` — and the claims
 * are made against the rendered board at four window widths.
 */
describe("dashboard tile e2e", () => {
  it("sizes each card to its content and never lets a card paint outside itself", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    const recorded = report.checks.scenarios.map((s) => s.name);
    for (const name of SCENARIOS) {
      assert.ok(recorded.includes(name), `the driver never recorded the ${name} scenario`);
    }
    for (const scenario of report.checks.scenarios) {
      assert.equal(scenario.pass, true, `${scenario.name}: ${scenario.detail ?? ""}`);
    }

    // The board is the seeded nine, in the seeded order: the reported card last,
    // and the cards that must stay narrow beside the wide ones.
    assert.deepEqual(
      report.checks.widths[0]?.cards.map((card) => card.id),
      [
        "sys:goal-progress",
        "view:financial:v-listing",
        "view:financial:v-metric",
        "page:financial:ledger",
        "view:financial:v-row",
        "view:financial:v-ledger",
        "sys:pending-decisions",
        "view:financial:v-real",
        "(agents)",
      ],
    );

    // Four widths were sampled: the three the claim needs, and the first one
    // again. A round trip is what says the board settles instead of drifting.
    assert.deepEqual(
      report.checks.widths.map((entry) => entry.name),
      ["wide", "narrow", "tiny", "wide-again"],
    );

    const [wide, narrow, tiny] = report.checks.widths;
    assert.ok(wide && narrow && tiny, "a width sample is missing");
    // The board got SMALLER as the window did — otherwise "the listing asked for
    // two cells" would be a claim about a board that never had to choose.
    assert.ok(wide.tracks.length > narrow.tracks.length, "the board did not narrow with the window");

    // The reported cards: a four-column listing whose cells cannot wrap, in a pin
    // stored one cell wide. It is drawn in more than one layout unit, its table is
    // NOT stretched past the width its columns need, the card around it is within
    // one step of that width, and it is wider than the one-number metric beside it
    // — the cards are sized by what they hold.
    const listingWide = wide.cards.find((card) => card.id === "view:financial:v-listing");
    const listingNarrow = narrow.cards.find((card) => card.id === "view:financial:v-listing");
    const metricWide = wide.cards.find((card) => card.id === "view:financial:v-metric");
    assert.ok((listingWide?.covered ?? 0) >= 4, "the listing is under one minimum card wide at 1280px");
    assert.ok((listingNarrow?.covered ?? 0) >= 4, "the listing is under one minimum card at 700px");
    assert.ok(
      (listingWide?.width ?? 0) > (metricWide?.width ?? 0) + 40,
      "the listing and the metric are drawn the same width",
    );
    for (const entry of [wide, narrow, tiny]) {
      const listing = entry.cards.find((card) => card.id === "view:financial:v-listing");
      assert.ok(listing?.table, `the listing drew no table at ${entry.name}`);
      // The hole the operator reported: a table told to fill its card spends the
      // difference between its columns.
      assert.ok(
        (listing?.table?.width ?? 0) - (listing?.table?.preferred ?? 0) <= 2,
        `the listing's table was stretched to ${listing?.table?.width}px from the ` +
          `${listing?.table?.preferred}px its columns need at ${entry.name}`,
      );
      // And the empty space around it: one layout step, not 225px.
      const step = (Number.parseFloat(entry.unitRem) || 0) * 16 + entry.gap;
      assert.ok(
        (listing?.table?.content ?? 0) - (listing?.table?.preferred ?? 0) <= step,
        `the listing card leaves ${Math.round(
          (listing?.table?.content ?? 0) - (listing?.table?.preferred ?? 0),
        )}px around a ${listing?.table?.preferred}px table at ${entry.name} (one step is ${Math.round(step)}px)`,
      );
      assert.deepEqual(listing?.spills, [], `the listing paints outside its own frame at ${entry.name}`);
    }

    // And the operator's own card — their rows, their columns, their view file's
    // `span: 2` on a pin that says `span: 1` — is drawn the same way.
    for (const entry of [wide, narrow, tiny]) {
      const operator = entry.cards.find((card) => card.id === "view:financial:v-real");
      assert.ok(
        (operator?.covered ?? 0) >= 4,
        `the operator's Recent-transactions card is ${operator?.covered} unit(s) wide at ${entry.name}`,
      );
      assert.deepEqual(
        operator?.spills,
        [],
        `the operator's card paints outside its frame at ${entry.name}`,
      );
    }

    // The operator's own wide card is the whole row, at every width.
    for (const entry of report.checks.widths) {
      const row = entry.cards.find((card) => card.id === "view:financial:v-row");
      assert.equal(row?.rowCard, true, `the row card lost its class at ${entry.name}`);
      assert.ok(
        Math.abs((row?.width ?? 0) - entry.gridWidth) <= 1,
        `the row card is ${row?.width}px on a ${entry.gridWidth}px board at ${entry.name}`,
      );
    }

    // The tiny window: the board refused to shrink below its own units and the
    // sheet's scroller took the overflow sideways — no card was squeezed.
    assert.ok(tiny.scrollport, "the tiny sample has no scrollport");
    assert.ok(tiny.gridWidth > tiny.scrollport.client, "the board shrank below its own units");
    assert.equal(tiny.scrollport.canScrollSideways, true, "the sheet cannot scroll sideways");
    const unit = (Number.parseFloat(tiny.unitRem) || 4.25) * 16;
    const minCard =
      (Number.parseInt(tiny.minUnits, 10) || 4) * (unit + tiny.gap) - tiny.gap;
    for (const track of tiny.tracks) {
      assert.ok(track >= unit - 1, `a track is ${track}px against a ${unit}px unit`);
    }
    for (const card of tiny.cards) {
      assert.ok(
        card.width >= minCard - 1,
        `${card.id} is ${card.width}px against a ${Math.round(minCard)}px minimum card`,
      );
    }
    assert.deepEqual(
      tiny.cards.flatMap((card) => card.spills),
      [],
      "a card spills at the tiny width",
    );

    // And the board sized itself through the layout, never by writing pins.
    assert.equal(report.checks.pinWrites, 0, "sizing the board wrote to the vault");
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // ── Edit card: the menu, the two draggable borders, and the way out ────────
    // The operator's words were literal: the Fill-the-row icon goes, Edit card
    // joins the 3-dot menu, and the right and bottom borders drag a size onto the
    // pin. Every assertion below is a clause of that sentence.
    const { chrome, menu, handles, width, height, floor, row, keys, outside, escape, noop, locked } =
      report.checks.edits;
    assert.equal(chrome.spanIcons, 0, "the Fill-the-row icon is still on the board");
    // One card on the board is the Active-agents panel, which is page furniture
    // rather than a pin: every pin has its menu, and the helper has none.
    assert.equal(chrome.menus, chrome.cards - 1, "not every pin offers its 3-dot menu");
    assert.deepEqual(
      chrome.chromeButtons,
      Array(chrome.menus).fill("pin-menu-toggle"),
      "the chrome grew a control beside the 3-dot again",
    );
    assert.deepEqual(menu.items, ["Edit card", "Archive", "Delete"], "the menu items moved");
    assert.deepEqual(menu.testIds, ["pin-edit", "pin-archive", "pin-delete"], "the menu testids moved");
    assert.equal(handles.editing, true, "Edit card did not put the card in Edit mode");
    assert.deepEqual(handles.ids, ["view:financial:v-real"], "more than one card entered Edit mode");
    assert.equal(handles.handles.length, 2, "Edit mode did not draw two border handles");
    assert.deepEqual(
      handles.handles.map((handle) => handle.axis).sort(),
      ["height", "width"],
      "the handles are not the right and bottom borders",
    );
    assert.equal(handles.width?.orientation, "vertical", "the width handle is not the right border");
    assert.equal(handles.height?.orientation, "horizontal", "the height handle is not the bottom border");
    assert.equal(width.units, width.wanted, `the drag gave ${width.units} units, wanted ${width.wanted}`);
    assert.equal(width.writes, 1, `the width drag wrote ${width.writes} times`);
    assert.ok(width.storedWidthRem !== null, "the width drag stored no width on the pin");
    assert.equal(
      width.reloadedUnits,
      width.wanted,
      "the width did not survive a fresh render of the board",
    );
    assert.ok(height.height >= height.from + 60, `the height drag only reached ${height.height}px`);
    assert.equal(height.writes, 1, `the height drag wrote ${height.writes} times`);
    assert.ok(height.storedHeightRem !== null, "the height drag stored no height on the pin");
    assert.ok(
      Math.abs(height.reloadedHeight - height.height) <= 2,
      "the height did not survive a fresh render of the board",
    );
    // The floor: widened first, then dragged in, it stops where the table stops.
    assert.ok(floor.unitsBefore > floor.contentUnits, "the floor leg never widened the card first");
    assert.equal(floor.stoppedAt, floor.contentUnits, "the drag went below what the card's content needs");
    assert.equal(floor.writes, 2, `the floor leg wrote ${floor.writes} times, expected two drags`);
    assert.equal(row.pinSpan, 2, "a drag to the board's edge did not store the row");
    assert.equal(row.storedWidthRem, null, "the row was stored with a width as well as a span");
    assert.ok(Math.abs(row.width - row.board) <= 1, "the row card does not fill the board");
    assert.equal(keys.widthTo, keys.widthFrom + 1, "one ArrowRight did not step exactly one unit");
    assert.ok(
      keys.heightTo >= keys.heightFrom + 12,
      `one ArrowDown did not step the height: ${keys.heightFrom} → ${keys.heightTo}`,
    );
    assert.equal(keys.writes, 2, "the two keyboard steps did not write exactly twice");
    assert.equal(outside.insideEditing, true, "a press inside the card left Edit mode");
    assert.equal(outside.outsideEditing, false, "a press outside the card did not leave Edit mode");
    assert.equal(outside.handlesAfter, 0, "the handles outlived Edit mode");
    assert.equal(escape.editing, false, "Escape did not leave Edit mode");
    assert.equal(escape.handles, 0, "the handles outlived Escape");
    assert.equal(noop.lifted, 0, "a press on the width border lifted the card");
    assert.equal(noop.writes, 0, "a press on the width border wrote to the vault");
    assert.equal(noop.heldAsResize, 1, "a press on the width border did not start a resize");
    assert.equal(locked.menus, 0, "a locked board offered a card menu");
    assert.equal(locked.handles, 0, "a locked board offered a resize handle");
    assert.equal(locked.editing, 0, "a locked board was in Edit mode");
  });
});
