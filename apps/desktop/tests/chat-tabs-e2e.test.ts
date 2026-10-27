/**
 * The chats column and the dock's parallel tabs.
 *
 * The rig (`e2e/chat-tabs.electron.mjs`) drives the harness page
 * (`e2e/chat-tabs.{html,tsx}`) in a real Electron window: the shipping sidebar,
 * the shipping dock, the shipping store, and a stubbed bridge whose turns are
 * held open until the driver ends them. This wrapper asserts the report the rig
 * wrote, so a skipped or silently broken run cannot pass.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-tabs.json");

type Row = {
  group: string;
  label: string;
  when: string;
  active: boolean;
  live: boolean;
  approval: boolean;
  menuOpen: boolean;
};

type Tab = {
  label: string;
  active: boolean;
  live: boolean;
  approval: boolean;
  close: string | null;
};

type State = {
  rowCount: number;
  rows: Row[];
  tabs: Tab[];
  tabCount: number;
  heading: string;
  list: boolean;
  thread: boolean;
  rail: {
    label: string | null;
    title: string;
    liveCount: string;
    newChat: boolean;
    groups: string[];
  } | null;
  composer: { value: string; disabled: boolean; focused: boolean } | null;
  messages: { role: string; content: string }[];
  dialog: { title: string; message: string; confirm: boolean } | null;
  calls: { sessionId: string; input: string }[];
  patchCalls: { id: string; patch: Record<string, unknown> }[];
  deleteCalls: string[];
  messageCalls: string[];
  stopCalls: string[];
};

type Report = {
  pass: boolean;
  failures: string[];
  screenshots: string[];
  states: Record<string, State>;
};

/** The dev-server probe every desktop rig uses: no server, no run. */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
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
      [path.join(desktopRoot, "e2e/chat-tabs.electron.mjs")],
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

describe("chat dock tabs and sidebar chats", () => {
  it("runs parallel chats as tabs and manages them from the left column", async (t) => {
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

    const {
      landing,
      opened,
      middleOpened,
      menuOpened,
      menuClosed,
      alphaLive,
      bravoReady,
      bothLive,
      interleaved,
      alphaThread,
      finished,
      alphaAgain,
      split,
      splitSettled,
      pinned,
      archived,
      asked,
      declined,
      deleted,
      background,
      closedLive,
      lateFrame,
    } = report.states;

    // The sidebar is the app's chat list, pinned first, and its rows are the
    // profile's own sessions.
    assert.equal(landing.rowCount, 5, "the sidebar did not list every chat");
    assert.equal(landing.rail?.title, "Chats", "the sidebar has no heading");
    assert.equal(landing.rail?.newChat, true, "the sidebar offers no New chat");
    assert.deepEqual(landing.rail?.groups, ["Pinned", "Recent"]);
    assert.deepEqual(
      [landing.rows[0]?.group, landing.rows[0]?.label],
      ["Pinned", "Pinned note"],
      "the pinned chat is not the first Pinned row",
    );
    assert.equal(landing.tabCount, 0, "one open chat drew a tab strip");
    assert.equal(landing.heading, "Alpha planning", "the dock landed on the wrong chat");

    // A plain click is navigation: the clicked chat takes over the main chat and
    // no tab is added. The hidden strip is the proof — a second tab would draw
    // it, and step 3 below shows the count rising only on the middle click.
    assert.equal(opened.heading, "Bravo budget", "the row click loaded the wrong chat");
    assert.equal(
      opened.messageCalls.at(-1),
      "chat-bravo",
      "the row click read a different transcript",
    );
    assert.equal(opened.tabCount, 0, "a plain click added a tab");
    assert.equal(
      opened.rows.find((row) => row.label === "Bravo budget")?.active,
      true,
      "the clicked chat is not the active row",
    );

    // A middle click keeps the chat in front and gives the clicked chat its own
    // tab: exactly two now, not three.
    assert.deepEqual(
      middleOpened.tabs.map((tab) => tab.label),
      ["Bravo budget", "Alpha planning"],
      "the middle click did not open a second tab",
    );
    assert.equal(middleOpened.tabs[1]?.active, true, "the new tab is not the active one");
    assert.equal(middleOpened.heading, "Alpha planning");

    // The row menu offers the same gesture.
    assert.deepEqual(
      menuOpened.tabs.map((tab) => tab.label),
      ["Bravo budget", "Alpha planning", "Delta automation"],
      "Open in new tab did not add a tab",
    );
    assert.equal(menuOpened.heading, "Delta automation");
    assert.equal(menuClosed.tabCount, 2, "closing the menu-opened tab left the wrong count");
    assert.equal(menuClosed.heading, "Alpha planning", "closing a tab did not hand over");
    assert.equal(
      menuClosed.rows.some((row) => row.label === "Delta automation"),
      true,
      "closing a tab removed the chat from the sidebar",
    );

    // Two turns in the air at once, each in its own tab.
    assert.equal(alphaLive.calls.length, 1, "Alpha's send never reached the bridge");
    assert.equal(alphaLive.calls[0]?.sessionId, "chat-alpha");
    assert.equal(
      alphaLive.tabs.find((tab) => tab.label === "Alpha planning")?.live,
      true,
      "Alpha's tab is not marked live",
    );
    assert.equal(alphaLive.rail?.liveCount, "1 running", "the sidebar did not count the run");
    assert.equal(
      bravoReady.composer?.disabled,
      false,
      "the composer stayed locked while another chat was running",
    );
    assert.equal(
      bravoReady.tabs.find((tab) => tab.label === "Alpha planning")?.live,
      true,
      "switching tabs dropped the other run's live state",
    );
    assert.equal(bothLive.calls.length, 2, "the second send did not reach the bridge");
    assert.deepEqual(
      bothLive.calls.map((call) => call.sessionId),
      ["chat-alpha", "chat-bravo"],
      "the two sends were not for two different chats",
    );
    assert.equal(
      bothLive.tabs.filter((tab) => tab.live).length,
      2,
      "the strip does not show both turns running",
    );
    assert.equal(
      bothLive.rows.filter((row) => row.live).length,
      2,
      "the sidebar does not show both turns running",
    );
    assert.equal(bothLive.rail?.liveCount, "2 running");

    // Frames are routed by session id: a delta for the chat that is not on
    // screen lands in that chat, not in the open one.
    const bravoText = interleaved.messages.map((m) => m.content).join(" | ");
    assert.match(bravoText, /BRAVO-ONLY-1/);
    assert.match(bravoText, /BRAVO-ONLY-2/);
    assert.match(bravoText, /Plan the bravo budget/);
    assert.doesNotMatch(bravoText, /ALPHA-ONLY/, "Alpha's deltas leaked into Bravo");
    const alphaText = alphaThread.messages.map((m) => m.content).join(" | ");
    assert.match(alphaText, /ALPHA-ONLY-1/);
    assert.match(alphaText, /ALPHA-ONLY-2/);
    assert.doesNotMatch(alphaText, /BRAVO-ONLY/, "Bravo's deltas leaked into Alpha");

    // Settling clears every live mark.
    assert.equal(finished.tabs.every((tab) => !tab.live), true, "a tab stayed live");
    assert.equal(finished.rows.every((row) => !row.live), true, "a row stayed live");
    assert.equal(finished.rail?.liveCount, "", "the running count outlived the runs");

    // A plain click during a live turn still replaces the main chat, but the
    // running chat is split into its own tab first rather than hidden.
    assert.equal(
      alphaAgain.tabs.find((tab) => tab.label === "Alpha planning")?.live,
      true,
      "Alpha's second turn is not live",
    );
    assert.equal(split.heading, "Charlie retro", "the mid-turn click did not replace the main chat");
    assert.equal(split.tabCount, 3, "the mid-turn click did not leave three tabs");
    assert.equal(
      split.tabs.find((tab) => tab.label === "Charlie retro")?.active,
      true,
      "the clicked chat did not take the active tab",
    );
    assert.equal(
      split.tabs.find((tab) => tab.label === "Alpha planning")?.live,
      true,
      "the running chat's tab was lost when the main chat was replaced",
    );
    assert.equal(
      splitSettled.tabs.every((tab) => !tab.live),
      true,
      "the split tab stayed live after its run ended",
    );

    // Sidebar management reaches the gateway and the list follows.
    const pin = pinned.patchCalls.at(-1);
    assert.equal(pin?.id, "chat-bravo", "Pin hit the wrong chat");
    assert.equal(pin?.patch.pinned, true, "Pin never reached the bridge");
    assert.deepEqual(
      [pinned.rows[0]?.group, pinned.rows[0]?.label],
      ["Pinned", "Bravo budget"],
      "the pinned chat did not move under Pinned",
    );

    const archive = archived.patchCalls.at(-1);
    assert.equal(archive?.id, "chat-alpha", "Archive hit the wrong chat");
    assert.equal(archive?.patch.archived, true, "Archive never reached the bridge");
    assert.equal(
      archived.rows.some((row) => row.label === "Alpha planning"),
      false,
      "the archived chat is still listed",
    );
    assert.equal(archived.rowCount, 4, "archive changed the wrong number of rows");
    assert.equal(
      archived.tabs.some((tab) => tab.label === "Alpha planning"),
      false,
      "the archived chat kept its tab",
    );
    assert.equal(archived.heading, "Charlie retro", "archiving a background tab moved the open thread");

    // Delete asks in the app's own dialog, writes only on yes, and hands the
    // dock to a neighbour tab.
    assert.equal(asked.dialog?.title, "Delete chat", "delete did not ask");
    assert.equal(asked.dialog?.confirm, true, "the ask has no confirm control");
    assert.deepEqual(asked.deleteCalls, [], "delete wrote before it was answered");
    assert.deepEqual(declined.deleteCalls, [], "a cancelled delete wrote anyway");
    assert.equal(declined.rowCount, 4, "a cancelled delete lost the row");
    assert.equal(deleted.deleteCalls.at(-1), "chat-charlie", "the delete hit the wrong chat");
    assert.equal(
      deleted.rows.some((row) => row.label === "Charlie retro"),
      false,
      "the deleted chat is still listed",
    );
    assert.equal(deleted.rowCount, 3, "the delete changed the wrong number of rows");
    assert.equal(deleted.tabCount, 0, "deleting the open chat left a second tab");
    assert.equal(deleted.heading, "Bravo budget", "deleting the open chat did not hand over");

    // A background run — an automation, or any chat nobody opened — appears as
    // a tab without taking the screen.
    assert.equal(background.tabCount, 2, "the background run did not grow a tab");
    assert.equal(
      background.tabs.find((tab) => tab.label === "Delta automation")?.live,
      true,
      "the background tab is not marked live",
    );
    assert.equal(
      background.tabs.find((tab) => tab.label === "Bravo budget")?.active,
      true,
      "the background run stole the active chat",
    );
    assert.equal(background.heading, "Bravo budget", "the background run moved the dock");
    assert.equal(
      background.rows.find((row) => row.label === "Delta automation")?.live,
      true,
      "the background chat's row is not live",
    );

    // Closing a live tab stops its run, and the frames already on the wire do
    // not resurrect the tab.
    assert.equal(
      closedLive.stopCalls.includes("run-delta"),
      true,
      "closing a live tab did not stop its run",
    );
    assert.equal(lateFrame.tabCount, 0, "a late frame resurrected the closed tab");
    assert.equal(lateFrame.heading, "Bravo budget", "a late frame moved the dock");
    assert.equal(
      lateFrame.rows.find((row) => row.label === "Delta automation")?.live,
      true,
      "the late frame did not land in its own run",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
