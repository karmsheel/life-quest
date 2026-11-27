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
const REPORT = path.join(desktopRoot, "e2e/artifacts/decisions-batch.json");
const ARTIFACT_SCREENSHOTS = [
  "decisions-batch-rest.png",
  "decisions-batch-error.png",
  "decisions-batch-in-flight.png",
  "decisions-batch-approved.png",
  "decisions-batch-approving-all.png",
  "decisions-batch-all-approved.png",
];

/**
 * Approving several Decisions at once, as the operator asked for it.
 *
 * The letter of the report: an approve-all control on the far right of the pill
 * switcher; the "Decision approved" (and error) text moved to the right of the
 * switcher so cards no longer move when a line appears; and the ability to
 * click approve on a second card while the first is still writing — which used
 * to look like the first one stopped processing.
 *
 * The rig holds every resolve open until the driver releases it, so these are
 * facts about the page, not timings: how many answers were in flight at once,
 * which cards showed their own processing state, where the notice was painted,
 * and whether the list's top moved when the notice appeared.
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
      [path.join(desktopRoot, "e2e/decisions-batch.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000 },
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

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Notice = { box: Box; text: string } | null;

type Card = {
  id: string;
  title: string;
  box: Box;
  actions: Array<{ label: string; disabled: boolean }>;
  busy: boolean;
};

type Sample = {
  skin: string;
  theme: string | null;
  bar: Box | null;
  tabs: Box | null;
  approveAll: { box: Box; text: string; disabled: boolean; title: string | null } | null;
  notices: { box: Box; message: Notice; error: Notice } | null;
  list: Box | null;
  empty: string | null;
  activeTab: string | null;
  cards: Card[];
  inflight: number;
  resolves: Array<{ id: string; resolution: string; at: number }>;
};

type Report = {
  url: string;
  window: { width: number; height: number };
  states: Record<string, Sample>;
  steps: Record<string, unknown>;
  screenshots: string[];
  consoleErrors: string[];
  failures: string[];
  pass: boolean;
};

const centerY = (box: Box): number => box.top + box.height / 2;

describe("answering several Decisions at once", () => {
  it("approves cards in parallel, offers approve-all, and keeps the notice in the switcher's row so the cards never shift", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);
    assert.deepEqual(report.consoleErrors, [], "the page logged console errors");

    const {
      rest,
      failed,
      twoInFlight,
      oneLeft,
      bothApproved,
      approvingAll,
      allApproved,
    } = report.states;

    // 1 — the inbox stands on its own first: four proposals, a tab switcher, and
    //     an approve-all control in the switcher's own row.
    assert.ok(rest, "the rig never sampled the inbox at rest");
    assert.equal(rest.activeTab, "Pending", "the inbox did not open on Pending");
    assert.equal(rest.cards.length, 4, "the seeded proposals did not all reach the page");
    assert.ok(rest.bar, "the switcher and the controls have no shared row");
    assert.ok(rest.tabs, "the pill switcher is missing");
    assert.ok(rest.list, "the card list is missing");
    assert.ok(rest.approveAll, "there is no Approve all control");
    assert.equal(rest.approveAll!.text, "Approve all", "the control is not the asked-for Approve all");
    assert.equal(rest.approveAll!.disabled, false, "Approve all starts disabled");
    assert.equal(
      Math.abs(centerY(rest.approveAll!.box) - centerY(rest.tabs!)) <= 2,
      true,
      `Approve all is ${Math.abs(centerY(rest.approveAll!.box) - centerY(rest.tabs!))}px off the switcher's line`,
    );
    const cardRight = Math.max(...rest.cards.map((card) => card.box.right));
    assert.ok(
      Math.abs(rest.approveAll!.box.right - cardRight) <= 1,
      `Approve all ends at ${rest.approveAll!.box.right}, not at the cards' trailing edge ${cardRight}`,
    );
    assert.ok(
      rest.approveAll!.box.left > rest.tabs!.right,
      "Approve all is not to the right of the pill switcher",
    );
    assert.ok(rest.notices, "the notice slot is missing from the bar");
    assert.equal(rest.notices!.message, null, "a message is showing before anything was answered");
    assert.equal(rest.notices!.error, null, "an error is showing before anything failed");

    // 2 — a refusal: the card stays pending and the error takes the notice slot
    //     in the switcher's row. Neither the list nor the card moves for it.
    const failId = String(report.steps.failId ?? "");
    assert.ok(failId, "the driver never chose a card to refuse");
    assert.equal(failed.notices?.error?.text, "The proposal no longer applies (stub).", "the refusal was not said in the bar");
    const errorBox = failed.notices!.error!.box;
    assert.ok(
      errorBox.left >= failed.tabs!.right - 1,
      `the error sits ${failed.tabs!.right - errorBox.left}px left of the switcher, not to its right`,
    );
    assert.ok(
      errorBox.top >= failed.bar!.top - 1 &&
        errorBox.bottom <= failed.bar!.bottom + 1,
      "the error is not on the switcher's row",
    );
    assert.equal(failed.list!.top, rest.list!.top, "the error text pushed the cards down");
    assert.equal(failed.bar!.height, rest.bar!.height, "the error text changed the bar's height");
    const refusedCard = failed.cards.find((card) => card.id === failId);
    assert.ok(refusedCard, "the refused card left Pending");
    assert.equal(refusedCard!.busy, false, "the refused card is still marked as processing");
    assert.equal(
      refusedCard!.box.top,
      rest.cards.find((card) => card.id === failId)?.box.top,
      "the refused card moved when the error was said",
    );

    // 3 — the reported bug: a second approve while the first is still writing.
    //     Both cards must show their own "…" at once; the page used to keep one
    //     "resolving" id, so the second click erased the first's processing state.
    const firstId = String(report.steps.firstId ?? "");
    const secondId = String(report.steps.secondId ?? "");
    assert.equal(report.steps.firstClick, true, "the first Approve could not be pressed");
    assert.equal(report.steps.secondClick, true, "the second Approve could not be pressed");
    assert.equal(twoInFlight.inflight, 2, "the two answers were not both in flight");
    assert.deepEqual(
      twoInFlight.resolves.map((call) => call.id),
      [failId, firstId, secondId],
      "the page did not ask the vault to approve both cards",
    );
    const busyIds = twoInFlight.cards.filter((card) => card.busy).map((card) => card.id);
    assert.deepEqual(
      [...busyIds].sort(),
      [firstId, secondId].sort(),
      "only one card showed a processing state while two answers were in flight",
    );
    assert.equal(twoInFlight.cards.length, 4, "a card left the page before the vault answered");
    assert.equal(
      twoInFlight.list!.top,
      rest.list!.top,
      "the list moved while both cards were processing",
    );

    // 4 — the first completion must not cancel the second. Releasing one answer
    //     leaves the other card processing, and the window between them is the
    //     same height: the "Decision approved." line lives in the bar.
    assert.equal(oneLeft.inflight, 1, "releasing one answer did not leave the other in flight");
    assert.equal(oneLeft.cards.length, 3, "the first answered card did not leave Pending");
    assert.equal(
      oneLeft.cards.some((card) => card.id === firstId),
      false,
      "the first answered card is still in Pending",
    );
    assert.equal(
      oneLeft.cards.find((card) => card.id === secondId)?.busy,
      true,
      "the second answer stopped processing when the first landed",
    );
    assert.equal(
      oneLeft.notices?.message?.text,
      "Decision approved.",
      "the first approval was not said in the bar",
    );
    assert.ok(
      oneLeft.notices!.message!.box.left >= oneLeft.tabs!.right - 1,
      "the approval message is not to the right of the switcher",
    );
    assert.ok(
      oneLeft.notices!.message!.box.top >= oneLeft.bar!.top - 1 &&
        oneLeft.notices!.message!.box.bottom <= oneLeft.bar!.bottom + 1,
      "the approval message is not on the switcher's row",
    );
    assert.equal(oneLeft.list!.top, rest.list!.top, "the approval message pushed the cards down");
    assert.equal(oneLeft.bar!.height, rest.bar!.height, "the approval message changed the bar's height");

    // 5 — both answers landed independently and the queue shrank by two.
    assert.equal(bothApproved.inflight, 0, "an answer is still in flight after the release");
    assert.equal(bothApproved.cards.length, 2, "both approved cards are not gone from Pending");
    assert.equal(
      bothApproved.list!.top,
      rest.list!.top,
      "the list moved when the second approval message appeared",
    );

    // 6 — Approve all dispatches every remaining answer at once, not one behind
    //     the next. The control says it is working and is quiet meanwhile.
    const leftIds = rest.cards
      .map((card) => card.id)
      .filter((id) => id !== firstId && id !== secondId);
    assert.equal(report.steps.approveAllClick, true, "the Approve all control could not be pressed");
    assert.equal(
      approvingAll.inflight,
      leftIds.length,
      `Approve all dispatched ${approvingAll.inflight} of ${leftIds.length} pending answers`,
    );
    assert.deepEqual(
      approvingAll.resolves.slice(3).map((call) => call.id).sort(),
      [...leftIds].sort(),
      "Approve all did not ask the vault to approve exactly the pending cards",
    );
    assert.equal(approvingAll.approveAll?.text, "Approving…", "Approve all does not say it is working");
    assert.equal(approvingAll.approveAll?.disabled, true, "Approve all can be pressed twice");
    assert.deepEqual(
      approvingAll.cards.filter((card) => card.busy).map((card) => card.id).sort(),
      [...leftIds].sort(),
      "not every pending card showed its own processing state during Approve all",
    );
    assert.equal(
      approvingAll.list!.top,
      rest.list!.top,
      "the list moved while Approve all was processing",
    );

    // 7 — when the last answer lands, Pending is empty, the bar says how many
    //     were approved, and the control is quiet — all in the same row.
    assert.equal(allApproved.cards.length, 0, "Approve all left a pending card behind");
    assert.equal(allApproved.empty, "No pending proposals.", "the empty queue is not named");
    assert.equal(
      allApproved.notices?.message?.text,
      "All 2 decisions approved.",
      "Approve all did not say how many decisions it approved",
    );
    assert.ok(
      allApproved.notices!.message!.box.left >= allApproved.tabs!.right - 1,
      "the Approve all message is not to the right of the switcher",
    );
    assert.equal(allApproved.approveAll?.disabled, true, "Approve all is still offered on an empty queue");
    assert.deepEqual(
      allApproved.resolves.map((call) => call.id),
      [failId, firstId, secondId, ...leftIds],
      "the answers did not reach the vault in the order the operator gave them",
    );
    for (const call of allApproved.resolves) {
      assert.equal(call.resolution, "approved", `a non-approve call reached the vault for ${call.id}`);
    }
    const approvedInStore = allApproved.resolves.map((call) => call.id);
    assert.equal(new Set(approvedInStore).size, 4, "the four Decisions were not each answered");

    // The repeatable artifact: a JSON report plus the frames it measured.
    for (const shot of ARTIFACT_SCREENSHOTS) {
      assert.ok(report.screenshots.includes(shot), `the run did not record ${shot}`);
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", shot)),
        true,
        `${shot} was reported but not written`,
      );
    }
  });
});
