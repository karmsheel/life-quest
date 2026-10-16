import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The server the LAUNCHER will actually load the harness page from, which is not
 * always 5173: a checkout running beside the operator's own dev server has to be
 * told which one is its own, and a gate that watched 5173 while the rig loaded
 * 5174 would wave through a run against somebody else's build.
 */
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const DEV_HOST = new URL(DEV_SERVER).hostname;
const DEV_PORT = Number(new URL(DEV_SERVER).port || 80);
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-card-slot.json");
/** The launcher builds the throwaway world, then spawns Electron with the rig. */
const LAUNCHER = path.join(desktopRoot, "e2e/dashboard-card-slot.mjs");
/** The rig boots the built main process, so the bundle has to exist. */
const MAIN_BUNDLE = path.join(desktopRoot, "dist-electron/main.js");

/**
 * A card the companion edits keeps its slot on the dashboard, and its elements
 * change within it. In the REAL app: the real `HomePage`, the real pin board, the
 * real preload, the real main process, over a throwaway vault, driven by the same
 * `save_view` call the companion makes through the same MCP door it uses.
 *
 * This is the half `dashboard-card-e2e` cannot reach. That suite drives the door
 * and proves the WRITE is right — the view file keeps its id, its `createdAt`, its
 * contents, and the board carries one pin for it. Every one of those was true
 * while the operator's card was sliding to the bottom of the dashboard, because
 * the fault was never in the write: it was in where the pin was PUT in the array,
 * and the board is what shows that. So this rig reads the board — on disk, and on
 * screen — and it is the only instrument that can.
 *
 * Falsification, and why each part of it bites:
 *
 *  - The turn is a real HTTP `tools/call` naming `save_view` with a `viewId`,
 *    over the door the APP bound, with the token the APP minted. A `save_view`
 *    that rebuilds the pin list as "everything except this one, then this one"
 *    fails the recorded index and reports itself as having kept a place it lost.
 *  - The card's DOM node is stamped before the turn and must survive it. A card
 *    that lands in the same index as a NEW element is not "edited in place" — it
 *    is a flash — so the index alone is not allowed to pass the leg.
 *  - A brand new card is created in the same run and MUST land at the end. If it
 *    did not, "the board did not move" would be a property of the rig rather than
 *    of the fix.
 *  - The same edit is then filed on a LOCKED board and approved, because the
 *    Decision path is a second implementation of the placement rule — in
 *    `decisions.ts` rather than in `views-tools.ts` — and the one a fix to the
 *    first would have left behind.
 *  - The edited card is third of seven, asserted as a precondition: on a board of
 *    two, "it kept its index" is true of a card that had nowhere to go.
 *
 * It needs the Vite dev server (the harness page) and the built `dist-electron`
 * bundle (the real main process). With either missing the test skips and says
 * which; `npm run dev` brings the server up and `npm run build` the bundle.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, DEV_HOST);
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runLauncher(): Promise<number> {
  return new Promise((resolve, reject) => {
    // Plain Node, and `ELECTRON_RUN_AS_NODE` stripped for the child: the
    // launcher's own `createRequire("electron")` is what spawns the real app, and
    // Electron hosts export that variable, which would turn every spawned Electron
    // into plain Node and open no window at all.
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

type Panel = { shape: string; title: string | null };

type EditReading = {
  index: number;
  top: number;
  height: number;
  probe: string | null;
  span2: boolean;
  blocks: Panel[];
  loading: boolean;
};

type Board = {
  scrollTop: number;
  maxScrollTop: number;
  order: string[];
  boxes: { index: number; id: string | null; probe: string | null; top: number; height: number }[];
  anchor: { id: string | null; top: number; offsetInCard: number } | null;
  edit: EditReading | null;
  loads: number;
};

type Report = {
  pass: boolean;
  failures: string[];
  consoleErrors: string[];
  boardSlug: string | null;
  editPinId: string;
  editIndex: number;
  checks: {
    vaultOpen: boolean;
    doorReady: boolean;
    pinsBefore: string[];
    pinsAfter: string[];
    pinsAfterApproval: string[];
    approvedEditIndex: number;
    approvedLast: string | null;
    editSpanAfter: string | null;
    replySaidItKeptItsPlace: boolean | null;
    replyPosition: number | null;
    getViewBlocks: string[];
    before: Board;
    after: Board;
    beforeLocked: { order: string[]; editIndex: number | null };
    afterNewCard: {
      order: string[];
      last: string | null;
      editIndex: number | null;
      newCardKeptItsPlace: boolean | null;
      newCardPosition: number | null;
      newCardViewId: string | null;
      newCardPinId: string;
    };
  };
};

describe("dashboard card slot e2e", () => {
  it("keeps a card the companion edits in its slot, and changes what is inside it", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_SERVER} — run \`npm run dev\` to include this e2e`);
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

    const { before, after, pinsBefore, pinsAfter } = report.checks;

    // The turn really was the companion's: the vault opened, the door answered,
    // and the app minted a token for it.
    assert.equal(report.checks.vaultOpen, true, "the vault never opened");
    assert.equal(report.checks.doorReady, true, "the MCP door never answered");

    // ── the instrument, asserted before the claim is read ───────────────────
    // Third of seven, and the board scrolls. Both are preconditions: a card that
    // is already last has nowhere to move to, and a board that fits on screen has
    // only one place on it.
    assert.ok(report.editIndex > 0, "the fixture put the edited card first");
    assert.ok(
      report.editIndex < before.order.length - 1,
      "the fixture put the edited card last, so 'it did not move' proves nothing",
    );
    assert.ok(
      before.maxScrollTop > 0,
      "the board does not scroll: this run cannot tell one place on it from another",
    );
    assert.equal(before.order.length, pinsBefore.length, "the board drew a different number of cards than it has pins");

    // ── the claim: the card did not leave the dashboard ─────────────────────
    // Said three ways, because the operator's report could mean any of them and a
    // wrong fix passes one while failing another.
    assert.deepEqual(pinsAfter, pinsBefore, "the board file reordered itself when a card was edited");
    assert.deepEqual(after.order, before.order, "the board on screen reordered itself when a card was edited");
    assert.equal(
      after.edit?.index,
      report.editIndex,
      "the edited card moved to a different place on the board",
    );
    assert.notEqual(
      after.order[after.order.length - 1],
      report.editPinId,
      "the edited card is at the bottom of the dashboard",
    );

    // The card under the eye is the same card, and the cards around it kept their
    // distance: this is what the operator sees as "the board did not move".
    assert.equal(after.anchor?.id, before.anchor?.id, "a different card is under the operator's eye");
    assert.equal(after.edit?.probe, before.edit?.probe, "the edited card was rebuilt, not edited in place");
    assert.equal(after.edit?.loading, false, "the edited card fell back to its Loading… state");
    assert.equal(after.loads, 1, "the page reloaded: the board was replaced rather than edited");

    // ── and the elements changed within it ─────────────────────────────────
    assert.deepEqual(
      before.edit?.blocks.map((panel) => panel.shape),
      ["table", "metric"],
      "the fixture's card is not the shape the turn is about",
    );
    assert.deepEqual(
      after.edit?.blocks.map((panel) => panel.shape),
      ["metric", "table"],
      "the card did not redraw with its panels in the new order",
    );

    // ── what the companion TOLD the operator ───────────────────────────────
    // The report was that the reply claimed the card had stayed in place when it
    // had not. The claim is only worth anything beside the measurement above, and
    // it is asserted here so the two can never drift apart again.
    assert.equal(
      report.checks.replySaidItKeptItsPlace,
      true,
      "save_view did not report the card as keeping its place",
    );
    assert.equal(
      report.checks.replyPosition,
      report.editIndex + 1,
      "save_view reported the card at the wrong position on the board",
    );

    // An edit that said nothing about the card's width left it as wide as it was.
    // Without this, a full-row card would be halved by an edit that only meant to
    // reorder its panels — the card leaving its place by a second door.
    assert.equal(
      report.checks.editSpanAfter,
      `${report.editPinId}:2`,
      "an edit that named no width silently changed the card's width",
    );

    // ── the control: a card that is NOT on the board still lands last ───────
    const newCard = report.checks.afterNewCard;
    assert.ok(newCard.newCardViewId, "the control leg created no card");
    assert.equal(newCard.order.length, before.order.length + 1, "the new card was not added to the board");
    assert.equal(
      newCard.last,
      `view:financial:${newCard.newCardViewId}`,
      "a brand new card did not land at the end of the board",
    );
    assert.equal(
      pinsBefore.includes(newCard.last ?? ""),
      false,
      "the 'new' card was already on the board, so landing last proves nothing",
    );
    assert.notEqual(newCard.last, report.editPinId, "the edited card is at the bottom of the dashboard");
    assert.equal(newCard.editIndex, report.editIndex, "the edited card moved when an unrelated card was added");
    assert.equal(
      newCard.newCardKeptItsPlace,
      false,
      "a brand new card reported that it had kept a place it never had",
    );
    assert.equal(newCard.newCardPosition, newCard.order.length, "the new card is not at the end of the board");

    // ── the other door: a locked board's Decision, on approval ─────────────
    // The same edit, filed because the board was locked and applied when the
    // operator approved it. A placement rule fixed in the tool alone leaves this
    // path sending the card to the bottom.
    assert.equal(
      report.checks.pinsAfterApproval.length,
      pinsBefore.length + 1,
      "approving the Decision changed the board's length by something other than the new card",
    );
    assert.equal(
      report.checks.approvedEditIndex,
      report.editIndex,
      "an approved edit moved the card to a different place on the board",
    );
    assert.notEqual(
      report.checks.approvedLast,
      report.editPinId,
      "the card reached the bottom of the board by way of the Decision path",
    );

    assert.deepEqual(report.consoleErrors, []);
  });
});
