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
  "width-control",
  "no-write",
  "clean",
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
  widthControl: string | null;
  table: {
    width: number;
    preferred: number;
    content: number;
    columns: { header: string; width: number }[];
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

type Report = {
  pass: boolean;
  failures: string[];
  what: string;
  checks: {
    scenarios: Scenario[];
    widths: WidthSample[];
    pinWrites: number;
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
  });
});
