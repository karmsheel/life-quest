import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/live-dashboard-ui.json");
/** The launcher builds the throwaway world, then spawns Electron with the rig. */
const LAUNCHER = path.join(desktopRoot, "e2e/live-dashboard.mjs");
/** The rig boots the built main process, so the bundle has to exist. */
const MAIN_BUNDLE = path.join(desktopRoot, "dist-electron/main.js");

/**
 * The dashboard as a live surface, in the REAL app: an expense posted through
 * the app's own MCP door must reach a card that is already on screen, with
 * nothing clicked, navigated, or reloaded.
 *
 * This is the half `live-dashboard-e2e` cannot reach. That rig proves the ENGINE
 * moves — a window anchored on `today` reads a different day, a listing gains a
 * row written after it ran, a literal date stays frozen. It cannot prove that
 * anything ever ASKS the engine again, because the thing that asks is a React
 * component in a window: `ViewCard`, listening to `LiveDataProvider`. So this rig
 * runs the product's own main process, preload, and `ViewCard` over the product's
 * own IPC bridge, in a throwaway vault, and drives the write through the door
 * Hermes uses.
 *
 * Falsification, and why each part of it bites:
 *
 *  - The write is a real HTTP `tools/call` to the door the APP bound, carrying
 *    the token the APP minted. Delete the notice from `executeTool` and the card
 *    never learns; the wait for the new number times out and reports the rows it
 *    did draw. That is the operator's bug, reproduced.
 *  - The page counts its own module evaluations and must read 1, so "the card is
 *    up to date" cannot be a reload wearing an update's clothes.
 *  - A third card spells its date in a filter and must NOT move. If the rig could
 *    pass with every card moving, it would be proving that something repaints
 *    everything rather than that a live window is what moved.
 *
 * It needs the Vite dev server (the harness page) and the built `dist-electron`
 * bundle (the real main process). With either missing the test skips and says
 * which; `npm run dev` brings the server up and `npm run build` the bundle.
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

function runLauncher(): Promise<number> {  return new Promise((resolve, reject) => {
    // Plain Node, and `ELECTRON_RUN_AS_NODE` stripped for the child: the
    // launcher's own `createRequire("electron")` is what spawns the real app,
    // and Electron hosts export that variable, which would turn every spawned
    // Electron into plain Node and open no window at all.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      process.execPath,
      [LAUNCHER],
      { cwd: desktopRoot, timeout: 180_000, env },
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

type Sample = {
  title: string | null;
  painted: number;
  metrics: string[];
  rows: string[][];
  empty: boolean;
  errors: string[];
  shell: {
    background: string;
    border: string;
    numericCells: number;
    numericAlign: string | null;
  } | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  consoleErrors: string[];
  captureText: string;
  checks: {
    vaultOpen: boolean;
    doorReady: boolean;
    captureReply: { posted?: boolean; rowId?: string | null; ask?: string } | null;
    editReply: { ok?: boolean; error?: string } | null;
    expected: Record<string, number>;
    before: { cards: Record<string, Sample>; loads: number; commits: number; mutations: number };
    after: { cards: Record<string, Sample>; loads: number; commits: number; mutations: number };
    afterEdit: { cards: Record<string, Sample>; loads: number };
    mutationsWhileIdle: number;
    mutationsBefore: number;
    mutationsAfter: number;
    listRowsAfter: number;
    capturedRow: string[] | null;
    todayAfter: (number | null)[];
    todayPanelRows: string[][];
    frozenAfter: (number | null)[];
    todayAfterRollover: (number | null)[];
    clockMovedInRenderer: { from: string; to: string } | null;
    clockMovedInMain: string | null;
  };
};

/**
 * The numbers a metric card is showing, read back out of the text it painted.
 *
 * The rig records the card's metric as TEXT on purpose — a card that drew a
 * number into the wrong place, or drew nothing, must not pass — so the test
 * parses it the same way the rig does rather than trusting a field that was
 * written to agree with itself.
 */
function metricNumbers(sample: { cards: Record<string, Sample> }, key: string): (number | null)[] {
  return (sample.cards[key]?.metrics ?? []).map((text) => {
    const match = /-?[\d\s.,]+/.exec(text.replace(/\u00a0/g, " "));
    const value = match ? Number(match[0].replace(/[\s,]/g, "")) : NaN;
    return Number.isFinite(value) ? value : null;
  });
}

describe("live dashboard ui e2e", () => {
  it("repaints a pinned card when the agent posts a row through the MCP door", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }
    if (!fs.existsSync(MAIN_BUNDLE)) {
      t.skip("dist-electron/main.js is missing — run `npm run build` to include this e2e");
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runLauncher();
    assert.equal(fs.existsSync(REPORT), true, "the launcher wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the launcher exited non-zero");

    const { before, after, expected, captureReply } = report.checks;

    // The agent really wrote: the door answered and the row was posted, so what
    // follows is about the CARD and not about a refused write.
    assert.equal(report.checks.vaultOpen, true, "the vault never opened");
    assert.equal(report.checks.doorReady, true, "the MCP door never answered");
    assert.equal(captureReply?.posted, true, `capture_transaction did not post: ${JSON.stringify(captureReply)}`);

    // The card was already showing the old world before the write.
    assert.equal(before.cards["card-list"].rows.length, expected.listRowsBefore);
    assert.equal(before.loads, 1, "the harness page had been loaded more than once before the write");
    assert.equal(after.loads, 1, "the harness page reloaded: the update was not live");

    // The ledger table gained the row — the operator's own complaint, in the
    // operator's own words.
    assert.equal(
      after.cards["card-list"].rows.length,
      expected.listRowsAfter,
      "the recent-transactions card did not gain the posted row",
    );
    assert.ok(report.checks.capturedRow, "the posted expense is not on the card");
    // The picture changed BECAUSE of the write. This is the measured repaint, and
    // the idle sample beside it is what makes it attributable: with nothing
    // happening the cards' DOM did not move at all.
    assert.equal(
      report.checks.mutationsAfter > report.checks.mutationsBefore,
      true,
      "the cards drew no new DOM after the write, so nothing re-rendered",
    );
    assert.equal(
      report.checks.mutationsWhileIdle,
      0,
      "the cards repainted while nothing was happening, so a repaint does not prove the write was heard",
    );

    // "Today's expenses" is a live window, so it moved; its detail panel moved
    // with it. This is the reported card, repaired.
    assert.deepEqual(report.checks.todayAfter, [expected.todayAfter], "Today's expenses did not move to the new expense");
    assert.ok(report.checks.todayPanelRows.length > 0, "the composed card's table panel stayed empty");
    assert.deepEqual(
      report.checks.frozenAfter,
      [expected.frozenBefore],
      "a card with a literal date moved when a different day was written",
    );

    // ── the operator's own write, over IPC ──────────────────────────────────
    // The agent's door is one of the app's two write doors. The other is IPC, and
    // an edit made in the app has to reach the board by the same route.
    assert.equal(report.checks.editReply?.ok, true, `dbUpsertRow failed: ${JSON.stringify(report.checks.editReply)}`);
    assert.equal(
      report.checks.afterEdit.cards["card-list"].rows.length,
      expected.listRowsEdited,
      "the listing did not gain the row the operator typed",
    );
    assert.equal(
      metricNumbers(report.checks.afterEdit, "card-today")[0],
      expected.todayEdited,
      "Today's expenses did not follow the operator's own edit",
    );
    assert.equal(report.checks.afterEdit.loads, 1, "the page reloaded on the operator's edit");

    // ── the day, with no write at all ───────────────────────────────────────
    // The other half of "it's stuck on a particular day": a board left open
    // overnight. The clock is moved on both sides — the renderer's day check and
    // the engine's window — and the card follows the calendar alone.
    assert.ok(report.checks.clockMovedInMain, "the rig moved the renderer's clock but not the engine's");
    assert.deepEqual(
      report.checks.todayAfterRollover,
      [expected.todayNextDay],
      "a card anchored on today did not roll over when the day changed",
    );

    // And it is the app's own card, drawn in the app's own skin.
    for (const key of ["card-list", "card-today", "card-frozen"]) {
      assert.equal(after.cards[key].painted, 1, `${key} did not draw exactly one view card`);
      assert.deepEqual(after.cards[key].errors, [], `${key} drew an error`);
      assert.notEqual(after.cards[key].shell?.background, "rgba(0, 0, 0, 0)", `${key} drew no shell`);
    }
    assert.ok(after.cards["card-list"].shell?.numericCells, "the listing marked no column as numeric");
    assert.equal(
      after.cards["card-list"].shell?.numericAlign,
      "right",
      "the money column is not right-aligned",
    );
    assert.deepEqual(report.consoleErrors, []);
  });
});
