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

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Row = {
  group: string;
  label: string;
  when: string;
  whenVisible: boolean;
  active: boolean;
  archived: boolean;
  archivedTag: string;
  disabled: boolean;
  live: boolean;
  approval: boolean;
  menuOpen: boolean;
  pinned: boolean;
  pinState: boolean;
  actionsVisible: boolean;
  pin: {
    exists: boolean;
    visible: boolean;
    label: string | null;
    dataPinned: string | null;
    filled: boolean;
  };
  archive: {
    exists: boolean;
    visible: boolean;
    label: string | null;
    beforePin: boolean;
  };
  box: Box | null;
};

type Tab = {
  label: string;
  /** The square's glyph; null on a normal tab. */
  letter: string | null;
  /** The tab's accessible name; the pinned square's names its chat. */
  name: string;
  /** A pinned chat is drawn as a square: letter + pin, no label, no close. */
  pinned: boolean;
  pin: boolean;
  pinVisible: boolean;
  active: boolean | null;
  live: boolean;
  approval: boolean;
  close: string | null;
  hasClose: boolean;
  box: Box | null;
};

/** The open tab context menu, when the rig right-clicked a tab. */
type TabMenu = {
  box: Box | null;
  menuFor: string | null;
  tabId: string | null;
  itemLabels: (string | null)[];
};

type State = {
  rowCount: number;
  rows: Row[];
  tabs: Tab[];
  tabCount: number;
  /** The strip's own box; null when the strip is not drawn. */
  strip: { box: Box | null } | null;
  /** The thread's name row, the row the strip leads. */
  header: { box: Box | null } | null;
  /** The plus after the last tab; null when no strip is drawn. */
  newTab: {
    label: string | null;
    /** Explicit ARIA role; null on a plain <button>. */
    role: string | null;
    tag: string;
    visible: boolean;
    box: Box | null;
  } | null;
  tabMenu: TabMenu | null;
  chatDivider: {
    label: string | null;
    now: number;
    min: number;
    max: number;
    box: Box | null;
  } | null;
  heading: string;
  /** Which surface the dock is on: "thread" | "chain" | "shortcuts". */
  surface: string | null;
  thread: boolean;
  rail: {
    box: Box | null;
    label: string | null;
    title: string;
    liveCount: string;
    newChat: boolean;
    newChatCentered: boolean | null;
    paddingTop: number;
    paddingBottom: number;
    groups: string[];
    empty: string;
    newChatBox: Box | null;
    header: {
      box: Box;
      titleBox: Box | null;
      controls: { label: string; box: Box }[];
    } | null;
    search: {
      value: string;
      placeholder: string | null;
      focused: boolean;
      panelBox: Box;
    } | null;
    viewMenu: {
      title: string;
      items: { label: string; checked: boolean }[];
    } | null;
    listOptions: ({ includeArchived?: boolean } | null)[];
    list: {
      box: Box | null;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    } | null;
    menu: {
      box: Box | null;
      placement: string | null;
      items: number;
      rowLabel: string | null;
      rowBox: Box | null;
    } | null;
  } | null;
  composer: { value: string; disabled: boolean; focused: boolean } | null;
  messages: { role: string; content: string }[];
  renaming: boolean;
  renameValue: string | null;
  dialog: { title: string; message: string; confirm: boolean } | null;
  calls: { sessionId: string; input: string }[];
  patchCalls: { id: string; patch: Record<string, unknown> }[];
  deleteCalls: string[];
  messageCalls: string[];
  createCalls: string[];
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
      hovered,
      hoveredUnpinned,
      unhovered,
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
      hoveredBravo,
      pinned,
      hoveredPinned,
      unpinned,
      unpinnedPinnedNote,
      baseline,
      hoveredAlpha,
      archived,
      asked,
      declined,
      deleted,
      background,
      closedLive,
      lateFrame,
      header,
      searchOpen,
      searched,
      noMatch,
      closedByCross,
      closedByOutside,
      closedByEscape,
      viewMenu,
      archivedShown,
      archivedClick,
      archivedSearch,
      unarchived,
      viewMenuShown,
      archivedHidden,
      newChatTab,
      newChatKept,
      newChatActive,
      equalTabs,
      narrowTabs,
      longList,
      atFoot,
      menuFlipped,
      menuDownward,
      beforeActiveArchive,
      activeArchived,
      previousTabArchived,
      lastArchived,
      archivedViewOpen,
      blankArchived,
      blankReused,
      chainUp,
      archivedFromChain,
      renameOpen,
      renameSwitched,
      renameCancelled,
      plusOpened,
      plusAgain,
    } = report.states;

    // The sidebar is one flat list of the profile's chats, pinned first; the
    // pin/archive controls belong to a hover, not to the resting row, and the
    // rail keeps dead space above and below its rows.
    assert.equal(landing.rowCount, 5, "the sidebar did not list every chat");
    assert.equal(landing.rail?.title, "Chats", "the sidebar has no heading");
    assert.equal(landing.rail?.newChat, true, "the sidebar offers no New chat");
    assert.equal(
      landing.rail?.newChatCentered,
      true,
      "the New chat button does not centre its icon and label",
    );
    assert.ok(
      (landing.rail?.paddingTop ?? 0) >= 10,
      `the rail has no dead space above its rows (${landing.rail?.paddingTop}px)`,
    );
    assert.ok(
      (landing.rail?.paddingBottom ?? 0) >= 10,
      `the rail has no dead space below its rows (${landing.rail?.paddingBottom}px)`,
    );
    assert.equal(landing.rows[0]?.label, "Pinned note", "the pinned chat is not the first row");
    assert.equal(landing.rows[0]?.pinned, true, "the first row is not marked pinned");
    assert.equal(landing.rows[0]?.pinState, true, "the pinned row shows no resting pin mark");
    assert.deepEqual(
      landing.rows.slice(1).map((row) => row.pinned),
      [false, false, false, false],
      "an unpinned chat is marked pinned",
    );
    assert.equal(
      landing.rows.slice(1).every((row) => row.pinState === false),
      true,
      "an unpinned row wears a pin mark",
    );
    assert.equal(
      landing.rows.every((row) => row.whenVisible),
      true,
      "a resting row hides its time",
    );
    assert.equal(
      landing.rows.some((row) => row.actionsVisible),
      false,
      "pin/archive are not hover-only: a row shows its actions at rest",
    );
    // A pinned chat is a tab at boot — the pin is durable Hermes state — drawn
    // as a square (letter + pin, no label, no close) ahead of the open chat.
    assert.equal(
      landing.tabCount,
      2,
      "the landing did not draw the pinned tab beside the open chat",
    );
    assert.equal(landing.tabs[0]?.pinned, true, "the first tab is not the pinned one");
    assert.equal(landing.tabs[0]?.letter, "P", "the pinned square does not carry the chat's letter");
    assert.equal(landing.tabs[0]?.pin, true, "the pinned square carries no pin icon");
    assert.equal(landing.tabs[0]?.hasClose, false, "the pinned square has a close control");
    assert.equal(landing.tabs[0]?.label, "", "the pinned square draws a text label");
    assert.equal(landing.tabs[1]?.pinned, false, "the open chat's tab is marked pinned");
    assert.equal(landing.tabs[1]?.label, "Alpha planning");
    assert.equal(landing.tabs[1]?.hasClose, true, "the open chat's tab has no close control");
    assert.equal(landing.tabs[1]?.active, true, "the open chat's tab is not the active one");
    assert.notEqual(landing.strip, null, "the strip is not drawn for the pinned tab");
    // The swap: the tab strip leads the dock and the chat's name row sits
    // directly beneath it, measured rather than read off the JSX.
    assert.equal(
      landing.strip?.box.bottom,
      landing.header?.box.top,
      "the name row does not begin where the tab strip ends",
    );
    assert.ok(
      (landing.strip?.box.top ?? Number.POSITIVE_INFINITY) <
        (landing.header?.box.top ?? 0),
      "the tab strip is not above the chat's name row",
    );
    assert.equal(
      landing.newTab?.label,
      "New chat tab",
      "the strip ends with no New chat tab control",
    );
    assert.equal(landing.newTab?.visible, true, "the New chat tab control is not visible");
    assert.ok(
      (landing.newTab?.box?.left ?? Number.NEGATIVE_INFINITY) >=
        (landing.tabs.at(-1)?.box?.right ?? Number.POSITIVE_INFINITY),
      "the New chat tab control is not after the last tab",
    );
    assert.ok(
      (landing.newTab?.box?.right ?? Number.POSITIVE_INFINITY) <=
        (landing.strip?.box.right ?? Number.NEGATIVE_INFINITY),
      "the New chat tab control runs past the strip's trailing edge",
    );
    assert.equal(landing.heading, "Alpha planning", "the dock landed on the wrong chat");

    // A real pointer over a row reveals its pin/archive controls and hides the
    // resting time and pin mark; moving off restores the resting row.
    const hoveredPinnedRow = hovered.rows.find((row) => row.label === "Pinned note");
    assert.equal(hoveredPinnedRow?.actionsVisible, true, "hovering a row revealed no actions");
    assert.deepEqual(
      hovered.rows.filter((row) => row.actionsVisible).map((row) => row.label),
      ["Pinned note"],
      "hover revealed another row's actions",
    );
    assert.equal(hoveredPinnedRow?.whenVisible, false, "the hovering row still shows its time");
    assert.equal(
      hoveredPinnedRow?.pinState,
      false,
      "the hovering pinned row still shows its pin mark",
    );
    assert.equal(hoveredPinnedRow?.pin.exists, true, "the pinned row has no pin control");
    assert.equal(hoveredPinnedRow?.pin.visible, true, "the pinned row's hover pin is not visible");
    assert.equal(
      hoveredPinnedRow?.pin.label,
      "Unpin chat",
      "the pinned row's hover control is not Unpin",
    );
    assert.equal(
      hoveredPinnedRow?.pin.dataPinned,
      "true",
      "the hover pin control does not carry the pinned flag",
    );
    assert.equal(hoveredPinnedRow?.pin.filled, true, "the pinned hover pin is not filled");
    // A pinned row hides Archive: a pin is a promise the chat stays in the
    // working set, so archiving it is one Unpin away instead of one stray click.
    assert.equal(
      hoveredPinnedRow?.archive.visible,
      false,
      "the pinned row still shows its hover archive control",
    );

    const alphaHover = hoveredUnpinned.rows.find((row) => row.label === "Alpha planning");
    assert.equal(alphaHover?.actionsVisible, true, "hovering an unpinned row revealed no actions");
    assert.deepEqual(
      hoveredUnpinned.rows.filter((row) => row.actionsVisible).map((row) => row.label),
      ["Alpha planning"],
      "the hover leaked to another row",
    );
    assert.equal(alphaHover?.pin.visible, true, "the unpinned row's hover pin is not visible");
    assert.equal(alphaHover?.pin.label, "Pin chat", "the unpinned hover control is not Pin");
    assert.equal(
      alphaHover?.pin.dataPinned,
      null,
      "the unpinned hover pin control carries a pinned flag",
    );
    assert.equal(alphaHover?.pin.filled, false, "the unpinned hover pin is filled");
    assert.equal(
      alphaHover?.archive.visible,
      true,
      "the unpinned row's hover archive is not visible",
    );
    assert.equal(alphaHover?.archive.beforePin, true, "Archive does not sit right before Pin");

    assert.equal(
      unhovered.rows.some((row) => row.actionsVisible),
      false,
      "the hover controls stayed after the pointer left",
    );
    assert.equal(
      unhovered.rows.every((row) => row.whenVisible),
      true,
      "the resting time did not come back",
    );
    assert.equal(
      unhovered.rows.find((row) => row.label === "Pinned note")?.pinState,
      true,
      "the resting pin mark did not come back",
    );

    // A plain click is navigation: the clicked chat takes over the one tab on
    // screen, and no second tab is added. The strip keeps its single tab wearing
    // the new name; step 3 below shows the count rising only on the middle
    // click.
    assert.equal(opened.heading, "Bravo budget", "the row click loaded the wrong chat");
    assert.equal(
      opened.messageCalls.at(-1),
      "chat-bravo",
      "the row click read a different transcript",
    );
    assert.equal(opened.tabCount, 1, "a plain click added a tab");
    assert.equal(
      opened.tabs[0]?.label,
      "Bravo budget",
      "the one tab did not take the clicked chat's name",
    );
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

    // The hover pin control reaches the gateway and the list follows: a fresh
    // pin is the very first row and wears a resting pin mark.
    assert.equal(
      hoveredBravo.rows.find((row) => row.label === "Bravo budget")?.pin.visible,
      true,
      "Bravo's hover pin control did not appear",
    );
    const pin = pinned.patchCalls.at(-1);
    assert.equal(pin?.id, "chat-bravo", "Pin hit the wrong chat");
    assert.equal(pin?.patch.pinned, true, "Pin never reached the bridge");
    assert.equal(pinned.rows[0]?.label, "Bravo budget", "the pinned chat did not become the first row");
    assert.equal(pinned.rows[0]?.pinned, true, "the first row is not marked pinned");
    assert.equal(pinned.rows[0]?.pinState, true, "the pinned row lost its resting pin mark");
    assert.equal(
      pinned.rows.some((row) => row.actionsVisible),
      false,
      "the hover controls stayed up after the pointer left and the pin landed",
    );

    // The same control toggles off: Unpin leaves the front and drops the flag.
    const pinnedHover = hoveredPinned.rows.find((row) => row.label === "Bravo budget");
    assert.equal(pinnedHover?.pin.visible, true, "the pinned row's hover pin is not visible");
    assert.equal(pinnedHover?.pin.label, "Unpin chat", "the pinned hover control does not read Unpin");
    assert.equal(pinnedHover?.pin.dataPinned, "true", "the pinned hover control lost its flag");
    assert.equal(pinnedHover?.pin.filled, true, "the pinned hover pin is not filled");
    const unpin = unpinned.patchCalls.at(-1);
    assert.equal(unpin?.id, "chat-bravo", "Unpin hit the wrong chat");
    assert.equal(unpin?.patch.pinned, false, "Unpin never reached the bridge");
    const unpinnedBravo = unpinned.rows.find((row) => row.label === "Bravo budget");
    assert.equal(unpinnedBravo?.pinned, false, "the unpinned chat kept its pinned flag");
    assert.equal(unpinnedBravo?.pinState, false, "the unpinned chat still wears a pin mark");
    // The fixture's own pin was unpinned and its tab closed at 1c, so no pinned
    // row is left: the front of the list is the first of the activity order.
    assert.equal(
      unpinned.rows[0]?.label,
      "Alpha planning",
      "unpinning did not hand the front back to the activity order",
    );
    assert.equal(unpinned.tabCount, 3, "the unpinned tab left the strip");
    assert.equal(
      unpinned.tabs.every((tab) => tab.pinned === false),
      true,
      "a tab is still drawn as a pinned square",
    );
    assert.equal(
      unpinned.tabs.find((tab) => tab.label === "Bravo budget")?.hasClose,
      true,
      "the unpinned chat's tab has no close control",
    );

    // 1c left a one-chat baseline: the fixture's pinned chat was unpinned from
    // the sidebar and its now-normal tab closed, so the strip is back down to the
    // one tab it always was, and every later tab count is the unpinned one.
    const pinnedNoteUnpin = unpinnedPinnedNote.patchCalls.at(-1);
    assert.equal(pinnedNoteUnpin?.id, "chat-pinned", "the sidebar Unpin hit the wrong chat");
    assert.equal(pinnedNoteUnpin?.patch.pinned, false, "the sidebar Unpin never reached the bridge");
    assert.equal(
      unpinnedPinnedNote.tabs.find((tab) => tab.label === "Pinned note")?.hasClose,
      true,
      "the unpinned square did not become a normal tab with a close control",
    );
    assert.equal(baseline.tabCount, 1, "closing the extra tab did not leave one tab");
    assert.equal(
      baseline.tabs[0]?.label,
      "Alpha planning",
      "the one remaining tab is not the chat in front",
    );
    assert.notEqual(
      baseline.strip,
      null,
      "the strip is not drawn for one chat, so the plus is unreachable",
    );
    assert.equal(
      baseline.newTab?.visible,
      true,
      "a one-tab strip has no visible New chat tab control",
    );
    assert.ok(
      (baseline.newTab?.box?.left ?? Number.NEGATIVE_INFINITY) >=
        (baseline.tabs[0]?.box?.right ?? Number.POSITIVE_INFINITY),
      "the New chat tab control is not after the single tab",
    );
    assert.equal(baseline.heading, "Alpha planning");

    // The hover archive control removes the row and the tab it had, and does not
    // move the open thread when the archived chat is a background tab.
    assert.equal(
      hoveredAlpha.rows.find((row) => row.label === "Alpha planning")?.archive.visible,
      true,
      "Alpha's hover archive control did not appear",
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
    assert.equal(deleted.tabCount, 1, "deleting the open chat left a second tab");
    assert.equal(
      deleted.tabs[0]?.label,
      "Bravo budget",
      "deleting the open chat did not leave its neighbour as the one tab",
    );
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
    assert.equal(lateFrame.tabCount, 1, "a late frame resurrected the closed tab");
    assert.equal(
      lateFrame.tabs[0]?.label,
      "Bravo budget",
      "the late frame left something other than the one open chat",
    );
    assert.equal(lateFrame.heading, "Bravo budget", "a late frame moved the dock");
    assert.equal(
      lateFrame.rows.find((row) => row.label === "Delta automation")?.live,
      true,
      "the late frame did not land in its own run",
    );

    // The header's two controls: search the list, and choose the view it is
    // drawn from. Both sit in line with the "Chats" heading, not in a row of
    // their own above it.
    assert.deepEqual(
      header.rail?.header?.controls.map((control) => control.label),
      ["Search chats", "View options"],
      "the chats header does not carry the search and view controls",
    );
    for (const control of header.rail?.header?.controls ?? []) {
      assert.ok(
        Math.abs(
          (control.box.top + control.box.bottom) / 2 -
            (header.rail!.header!.titleBox!.top + header.rail!.header!.titleBox!.bottom) / 2,
        ) <= 4,
        `${control.label} is not on the heading's row (${JSON.stringify(control.box)} vs ${JSON.stringify(header.rail?.header?.titleBox)})`,
      );
    }
    assert.equal(header.rail?.search, null, "a search box is drawn before the icon is clicked");
    assert.equal(header.rail?.viewMenu, null, "the view menu is drawn before the icon is clicked");

    // The search icon turns the header itself into a full-width field: the
    // title and both icons step aside, and the field occupies their row.
    assert.equal(searchOpen.rail?.search?.focused, true, "the search box did not take focus");
    assert.equal(searchOpen.rail?.search?.value, "", "the search box opened with text in it");
    assert.equal(searchOpen.rail?.search?.placeholder, "Search chats");
    assert.equal(
      searchOpen.rail?.header?.titleBox,
      null,
      "the Chats title is still drawn behind the open search",
    );
    assert.deepEqual(
      searchOpen.rail?.header?.controls,
      [],
      "the header icons are still drawn behind the open search",
    );
    assert.ok(
      (searchOpen.rail?.search?.panelBox.top ?? 0) >=
        (searchOpen.rail?.header?.box.top ?? 0) - 1 &&
        (searchOpen.rail?.search?.panelBox.bottom ?? 0) <=
          (searchOpen.rail?.header?.box.bottom ?? 0) + 1,
      `the search box left the header's row (${JSON.stringify(searchOpen.rail?.search?.panelBox)} vs ${JSON.stringify(searchOpen.rail?.header?.box)})`,
    );
    assert.ok(
      Math.abs(
        (searchOpen.rail?.search?.panelBox.left ?? 0) -
          (searchOpen.rail?.newChatBox?.left ?? -99),
      ) <= 1 &&
        Math.abs(
          (searchOpen.rail?.search?.panelBox.right ?? 0) -
            (searchOpen.rail?.newChatBox?.right ?? -99),
        ) <= 1,
      `the field does not span the row the title and icons had (${JSON.stringify(searchOpen.rail?.search?.panelBox)} vs New chat ${JSON.stringify(searchOpen.rail?.newChatBox)})`,
    );
    assert.equal(searchOpen.rail?.newChat, true, "New chat left the section while searching");
    assert.deepEqual(
      searched.rows.map((row) => row.label),
      ["Delta automation"],
      "the search did not narrow the rows to the match",
    );
    assert.deepEqual(searched.rail?.groups, [], "the filtered list kept an empty group heading");
    assert.equal(searched.heading, "Bravo budget", "searching moved the open chat");
    assert.equal(noMatch.rowCount, 0, "a search with no match still listed rows");
    assert.match(
      noMatch.rail?.empty ?? "",
      /No chats match/,
      "a search with no match said nothing",
    );
    assert.equal(closedByCross.rowCount, 3, "closing the search did not bring the rows back");
    assert.equal(closedByCross.rail?.search, null, "the cross did not close the search");
    assert.equal(
      closedByCross.rail?.header?.titleBox !== null,
      true,
      "the Chats title did not come back with the header",
    );
    assert.deepEqual(
      closedByCross.rail?.header?.controls.map((control) => control.label),
      ["Search chats", "View options"],
      "the header icons did not come back",
    );
    assert.equal(
      closedByOutside.rail?.search,
      null,
      "a press outside the field did not close the search",
    );
    assert.deepEqual(
      closedByOutside.rail?.header?.controls.map((control) => control.label),
      ["Search chats", "View options"],
      "a press outside the field did not restore the header",
    );
    assert.equal(
      closedByEscape.rail?.search,
      null,
      "Escape did not close the search",
    );
    assert.deepEqual(
      closedByEscape.rail?.header?.controls.map((control) => control.label),
      ["Search chats", "View options"],
      "Escape did not restore the header",
    );

    // The view menu is the filter: hide the archived chats (the default), show
    // them as a greyed, restorable group, or show the archive alone.
    assert.equal(viewMenu.rail?.viewMenu?.title, "View options");
    assert.deepEqual(
      viewMenu.rail?.viewMenu?.items,
      [
        { label: "Hide archived chats", checked: true },
        { label: "Show archived chats", checked: false },
        { label: "Only archived chats", checked: false },
      ],
      "the view menu does not offer hide/show/only archived, or marks the wrong one",
    );
    assert.equal(
      archivedShown.rowCount,
      6,
      `showing archived chats listed ${archivedShown.rowCount} rows, expected 3 live + 3 archived`,
    );
    assert.equal(
      archivedShown.rail?.listOptions.at(-1)?.includeArchived,
      true,
      "the show-archived view did not ask the list for archived rows",
    );
    assert.ok(
      archivedShown.rail?.groups.includes("Archived"),
      `the archived rows have no group of their own: ${JSON.stringify(archivedShown.rail?.groups)}`,
    );
    const shownArchived = archivedShown.rows.filter((row) => row.archived);
    assert.deepEqual(
      shownArchived.map((row) => row.label).sort(),
      ["Alpha planning", "Echo archived", "Foxtrot archived"],
      "the archived group is not the archived chats",
    );
    for (const row of shownArchived) {
      assert.equal(row.archivedTag, "Archived", `${row.label} carries no Archived tag`);
      assert.equal(row.disabled, true, `${row.label} is openable while archived`);
      assert.equal(row.group, "Archived", `${row.label} is outside the Archived group`);
    }
    assert.equal(
      archivedShown.rows.filter((row) => !row.archived).length,
      3,
      "the live chats left the list while the archived view was shown",
    );
    assert.equal(archivedShown.heading, "Bravo budget", "showing archived chats moved the dock");
    assert.equal(
      archivedClick.heading,
      "Bravo budget",
      "clicking an archived row opened it",
    );
    assert.notEqual(
      archivedClick.messageCalls.at(-1),
      "chat-echo",
      "clicking an archived row read its transcript",
    );
    assert.deepEqual(
      archivedSearch.rows.map((row) => [row.label, row.archived]),
      [["Echo archived", true]],
      "the search did not find the archived chat while the view showed it",
    );

    // Unarchive restores the chat to the working list, and hiding the archived
    // view again leaves the restored chat where it belongs.
    assert.equal(unarchived.patchCalls.at(-1)?.id, "chat-echo", "Unarchive hit the wrong chat");
    assert.equal(
      unarchived.patchCalls.at(-1)?.patch.archived,
      false,
      "Unarchive never reached the bridge",
    );
    assert.deepEqual(
      [
        unarchived.rows.find((row) => row.label === "Echo archived")?.group,
        unarchived.rows.find((row) => row.label === "Echo archived")?.archived,
      ],
      ["", false],
      "the restored chat did not rejoin the flat working list",
    );
    assert.equal(unarchived.rowCount, 6, "unarchive changed the wrong number of rows");
    assert.deepEqual(
      viewMenuShown.rail?.viewMenu?.items,
      [
        { label: "Hide archived chats", checked: false },
        { label: "Show archived chats", checked: true },
        { label: "Only archived chats", checked: false },
      ],
      "the view menu does not mark the shown-archived view as current",
    );
    assert.equal(
      archivedHidden.rowCount,
      4,
      `hiding archived chats left ${archivedHidden.rowCount} rows, expected the 4 live chats`,
    );
    assert.equal(
      archivedHidden.rail?.listOptions.at(-1)?.includeArchived,
      false,
      "the hide-archived view did not ask for a live-only list",
    );
    assert.equal(
      archivedHidden.rail?.groups.includes("Archived"),
      false,
      "the Archived group survived the view being hidden",
    );
    assert.equal(
      archivedHidden.rows.some(
        (row) => row.label === "Echo archived" && !row.archived,
      ),
      true,
      "hiding the archived view dropped the restored chat",
    );

    // The dock's New chat keeps the chat in front: the blank conversation opens
    // as a second tab instead of replacing the open one. The old behaviour is
    // one tab with the chat that was in front gone, so both tabs are named and
    // each one's thread is visited: a tab that is merely listed is not proof the
    // chat is still open.
    assert.equal(
      newChatTab.tabCount,
      2,
      `New chat drew ${newChatTab.tabCount} tab(s) instead of a second tab beside the open chat`,
    );
    assert.deepEqual(
      newChatTab.tabs.map((tab) => tab.label),
      ["Bravo budget", "New chat"],
      "New chat did not open the blank chat as its own tab",
    );
    assert.equal(
      newChatTab.tabs[1]?.active,
      true,
      "the new chat's tab is not the one in front",
    );
    assert.equal(
      newChatTab.heading,
      "New chat",
      `the dock did not land on the new chat ("${newChatTab.heading}")`,
    );
    assert.equal(
      newChatTab.tabs.some((tab) => tab.label === "Bravo budget"),
      true,
      "New chat made the chat that was in front lose its tab",
    );
    assert.equal(
      newChatTab.rows.some((row) => row.label === "New chat"),
      true,
      "the new blank chat never joined the sidebar list",
    );
    assert.equal(
      newChatTab.createCalls.length,
      archivedHidden.createCalls.length + 1,
      "the New chat slot never asked the bridge for a chat",
    );
    assert.equal(
      newChatKept.heading,
      "Bravo budget",
      `the previous chat's tab did not bring its thread back ("${newChatKept.heading}")`,
    );
    assert.equal(newChatKept.tabCount, 2, "revisiting the previous chat dropped a tab");
    assert.equal(
      newChatKept.tabs.some((tab) => tab.label === "New chat"),
      true,
      "the new chat's tab went away when the previous chat was revisited",
    );
    assert.equal(
      newChatActive.heading,
      "New chat",
      `the new chat's tab did not bring its thread back ("${newChatActive.heading}")`,
    );
    assert.equal(
      newChatActive.tabs.find((tab) => tab.label === "New chat")?.active,
      true,
      "the new chat is not the active tab after clicking it",
    );

    // Equal tabs: at the default dock width every tab is one share of the strip,
    // whatever the length of its label; at the dock's floor they have all
    // shrunk together and are still equal to each other. A content-sized strip
    // fails the first spread, and a strip that does not shrink fails the
    // narrower-per-tab comparison.
    assert.equal(
      equalTabs.tabCount,
      3,
      `the third chat did not open a tab: ${JSON.stringify(equalTabs.tabs.map((tab) => tab.label))}`,
    );
    const equalLabels = equalTabs.tabs.map((tab) => tab.label);
    assert.deepEqual(
      equalLabels,
      ["Bravo budget", "New chat", "Delta automation"],
      "the three open chats are not the three tabs",
    );
    assert.ok(
      new Set(equalLabels.map((label) => label.length)).size > 1,
      "every tab label is the same length, so a content-sized strip would not show",
    );
    const spread = (widths: number[]) => Math.max(...widths) - Math.min(...widths);
    const equalWidths = equalTabs.tabs.map((tab) => tab.box?.width ?? Number.NaN);
    assert.equal(equalWidths.length, 3, "not every tab was measured");
    assert.ok(
      equalWidths.every((width) => Number.isFinite(width)),
      "a tab has no box to measure",
    );
    assert.ok(
      spread(equalWidths) <= 1,
      `tabs are content-sized, not equal shares of the strip: ${JSON.stringify(equalWidths)}`,
    );

    assert.notEqual(narrowTabs.chatDivider, null, "the dock has no resize handle");
    assert.equal(
      narrowTabs.chatDivider?.now,
      narrowTabs.chatDivider?.min,
      `the dock never reached its floor (${narrowTabs.chatDivider?.now}px, floor ${narrowTabs.chatDivider?.min}px), so the narrow-strip claim is untested`,
    );
    assert.ok(
      (narrowTabs.chatDivider?.now ?? Number.POSITIVE_INFINITY) <
        (equalTabs.chatDivider?.now ?? Number.NEGATIVE_INFINITY),
      `the divider did not move between the two samples (${equalTabs.chatDivider?.now}px → ${narrowTabs.chatDivider?.now}px)`,
    );
    assert.ok(
      (narrowTabs.panel?.width ?? Number.POSITIVE_INFINITY) <
        (equalTabs.panel?.width ?? Number.NEGATIVE_INFINITY),
      `the dock did not get narrower (${equalTabs.panel?.width}px → ${narrowTabs.panel?.width}px)`,
    );
    const narrowWidths = narrowTabs.tabs.map((tab) => tab.box?.width ?? Number.NaN);
    assert.equal(narrowTabs.tabCount, 3, "the strip lost a tab while the dock narrowed");
    assert.deepEqual(
      narrowTabs.tabs.map((tab) => tab.label),
      equalLabels,
      "the strip's chats changed while the dock narrowed",
    );
    assert.ok(
      narrowWidths.every((width) => Number.isFinite(width)),
      "a tab has no box at the dock's floor",
    );
    assert.ok(
      spread(narrowWidths) <= 1,
      `the tabs are not equal at the dock's floor: ${JSON.stringify(narrowWidths)}`,
    );
    assert.ok(
      narrowWidths.every(
        (width, index) => width < (equalWidths[index] ?? Number.NEGATIVE_INFINITY),
      ),
      `the tabs did not shrink with the dock: ${JSON.stringify(equalWidths)} → ${JSON.stringify(narrowWidths)}`,
    );

    // The row menu opens into the space that exists. With the history grown past
    // the list's scroll port and scrolled to its last chat, the three-dot menu
    // has to open above its row — a menu hanging below the row would be cut by
    // the list's own edge, which is the reported fault. It must sit wholly
    // inside the list and opening it must not move the list. A row at the top,
    // with the room under it, still opens downward.
    assert.ok(
      (longList.rail?.list?.scrollHeight ?? 0) >
        (longList.rail?.list?.clientHeight ?? 0) + 40,
      `the seeded history does not overflow the chats list, so the menu is never clipped (${JSON.stringify(longList.rail?.list)})`,
    );
    const footMax =
      (atFoot.rail?.list?.scrollHeight ?? 0) - (atFoot.rail?.list?.clientHeight ?? 0);
    assert.ok(
      footMax > 0 &&
        Math.abs((atFoot.rail?.list?.scrollTop ?? 0) - footMax) <= 1,
      `the chats list did not reach its last row (scrollTop ${atFoot.rail?.list?.scrollTop}, max ${footMax})`,
    );
    const footRow = atFoot.rows.at(-1);
    assert.ok(footRow, "the scrolled list has no last row");
    assert.ok(
      (footRow.box?.bottom ?? 0) <= (atFoot.rail?.list?.box?.bottom ?? 0) + 1 &&
        (footRow.box?.bottom ?? 0) >= (atFoot.rail?.list?.box?.bottom ?? 0) - 48,
      `the last row is not at the foot of the list (${JSON.stringify({ row: footRow.box, list: atFoot.rail?.list?.box })})`,
    );
    assert.equal(
      menuFlipped.rail?.menu?.placement,
      "above",
      `the last chat's row menu did not flip upward (${JSON.stringify(menuFlipped.rail?.menu)})`,
    );
    assert.equal(
      menuFlipped.rail?.menu?.rowLabel,
      footRow.label,
      "the opened menu belongs to a row other than the last chat",
    );
    assert.equal(
      menuFlipped.rail?.menu?.items,
      5,
      `the flipped menu lost its items (${menuFlipped.rail?.menu?.items})`,
    );
    assert.ok(
      (menuFlipped.rail?.menu?.box?.bottom ?? Number.POSITIVE_INFINITY) <=
        (menuFlipped.rail?.menu?.rowBox?.top ?? Number.NEGATIVE_INFINITY) + 1,
      `the flipped menu is not drawn over its row: ${JSON.stringify(menuFlipped.rail?.menu)}`,
    );
    assert.ok(
      (menuFlipped.rail?.menu?.box?.top ?? Number.NEGATIVE_INFINITY) >=
        (menuFlipped.rail?.list?.box?.top ?? Number.POSITIVE_INFINITY) - 1 &&
        (menuFlipped.rail?.menu?.box?.bottom ?? Number.POSITIVE_INFINITY) <=
          (menuFlipped.rail?.list?.box?.bottom ?? Number.NEGATIVE_INFINITY) + 1,
      `the flipped menu is clipped by the chats list: ${JSON.stringify({ menu: menuFlipped.rail?.menu?.box, list: menuFlipped.rail?.list?.box })}`,
    );
    assert.ok(
      (menuFlipped.rail?.menu?.box?.height ?? 0) > 60,
      `the flipped menu was squeezed to ${menuFlipped.rail?.menu?.box?.height}px`,
    );
    assert.ok(
      Math.abs((menuFlipped.rail?.list?.scrollTop ?? -1) - footMax) <= 1,
      `opening the menu moved the list (scrollTop ${menuFlipped.rail?.list?.scrollTop}, expected ${footMax})`,
    );
    assert.equal(
      menuDownward.rail?.menu?.placement,
      "below",
      `a roomy row's menu did not open downward (${JSON.stringify(menuDownward.rail?.menu)})`,
    );
    assert.ok(
      (menuDownward.rail?.menu?.box?.top ?? Number.NEGATIVE_INFINITY) >=
        (menuDownward.rail?.menu?.rowBox?.bottom ?? Number.POSITIVE_INFINITY) - 1 &&
        (menuDownward.rail?.menu?.box?.bottom ?? Number.POSITIVE_INFINITY) <=
          (menuDownward.rail?.list?.box?.bottom ?? Number.NEGATIVE_INFINITY) + 1,
      `the downward menu is not wholly under its row and inside the list: ${JSON.stringify({ menu: menuDownward.rail?.menu, list: menuDownward.rail?.list?.box })}`,
    );

    // Archiving the chat in front closes its tab and hands the screen to the tab
    // that takes its place — never out of the dock, which is where the operator
    // used to be dumped on a history page to pick another chat.
    assert.equal(
      activeArchived.surface,
      "thread",
      "archiving the chat in front left the thread",
    );
    assert.equal(
      activeArchived.thread,
      true,
      "archiving the chat in front left no thread up",
    );
    assert.deepEqual(
      activeArchived.tabs.map((tab) => tab.label),
      ["Bravo budget", "Delta automation"],
      "the archived tab's neighbour did not take its place in the strip",
    );
    assert.equal(
      activeArchived.heading,
      "Delta automation",
      `archiving the chat in front did not land on its neighbour ("${activeArchived.heading}")`,
    );
    assert.equal(
      activeArchived.tabs.find((tab) => tab.label === "Delta automation")?.active,
      true,
      "the neighbour that took the place is not the tab in front",
    );
    assert.equal(
      activeArchived.rows.some((row) => row.label === "New chat"),
      false,
      "the archived chat stayed in the sidebar",
    );

    // The archived tab was last in the strip: the tab before it takes the front.
    // One tab is left, and the strip still draws it with the plus beside it.
    assert.equal(
      previousTabArchived.tabCount,
      1,
      `the neighbour tab did not stay in the strip (${previousTabArchived.tabCount} tabs)`,
    );
    assert.equal(previousTabArchived.tabs[0]?.label, "Bravo budget");
    assert.equal(previousTabArchived.tabs[0]?.active, true);
    assert.equal(
      previousTabArchived.heading,
      "Bravo budget",
      `archiving the last tab did not hand the front to the tab before it ("${previousTabArchived.heading}")`,
    );
    assert.equal(
      previousTabArchived.surface,
      "thread",
      "archiving the last tab left the thread",
    );

    // Archiving the last open chat leaves a blank New chat on the thread: the
    // blank slate the New chat slot lands on, not a page to pick another chat
    // from.
    assert.equal(
      lastArchived.surface,
      "thread",
      "archiving the last open chat left the thread",
    );
    assert.equal(
      lastArchived.thread,
      true,
      "archiving the last open chat left no thread up",
    );
    assert.equal(
      lastArchived.tabCount,
      1,
      "the blank New chat did not draw its one tab",
    );
    assert.equal(
      lastArchived.tabs[0]?.label,
      "New chat",
      "the blank New chat's tab is not the chat on screen",
    );
    assert.equal(
      lastArchived.heading,
      "New chat",
      `archiving the last open chat did not open a blank New chat ("${lastArchived.heading}")`,
    );
    assert.deepEqual(
      lastArchived.messages,
      [],
      "the blank New chat archiving opened has a transcript",
    );
    assert.equal(
      lastArchived.composer?.disabled,
      false,
      "the blank New chat archiving opened cannot be typed in",
    );
    assert.equal(
      lastArchived.rows.some((row) => row.label === "New chat"),
      true,
      "the blank New chat archiving opened is not listed",
    );
    assert.equal(
      lastArchived.createCalls.length,
      previousTabArchived.createCalls.length + 1,
      `archiving the last open chat did not ask the bridge for a blank chat (${JSON.stringify(lastArchived.createCalls)})`,
    );

    // The archived view must not hand an archived blank back as the new chat:
    // with the band showing, archiving the blank in front opens a live one.
    assert.equal(
      archivedViewOpen.rows.some((row) => row.label === "New chat" && row.archived),
      true,
      "the archived view did not list the archived blank chat",
    );
    assert.equal(
      blankArchived.surface,
      "thread",
      "archiving a blank in the archived view left the thread",
    );
    assert.equal(
      blankArchived.thread,
      true,
      "archiving a blank in the archived view left no thread up",
    );
    assert.equal(
      blankArchived.heading,
      "New chat",
      `archiving a blank in the archived view did not open a blank New chat ("${blankArchived.heading}")`,
    );
    assert.equal(
      blankArchived.createCalls.length,
      archivedViewOpen.createCalls.length + 1,
      "archiving a blank in the archived view reopened the archived chat instead of making a live blank",
    );
    assert.equal(
      blankArchived.rows.some((row) => row.label === "New chat" && !row.archived),
      true,
      "the live blank chat archiving opened is not listed",
    );
    assert.equal(
      blankArchived.rows.some((row) => row.label === "New chat" && row.archived),
      true,
      "the archived blank chat left the archived view",
    );

    // The New chat slot lands on the blank chat that is already open: pressing it
    // with a live blank in front must change nothing and mint no second chat.
    assert.equal(
      blankReused.surface,
      "thread",
      `the New chat slot left the thread ("${blankReused.surface}")`,
    );
    assert.equal(
      blankReused.heading,
      "New chat",
      `the New chat slot opened something other than the blank chat ("${blankReused.heading}")`,
    );
    assert.equal(blankReused.tabCount, 1, "reusing the blank chat lost its tab");
    assert.equal(blankReused.tabs[0]?.label, "New chat");
    assert.equal(
      blankReused.createCalls.length,
      blankArchived.createCalls.length,
      "pressing New chat on its own blank chat minted a second chat",
    );

    // Archiving the chat in front while the dock shows the chain keeps the chain
    // up and opens nothing: the operator asked to put a chat away, not to be
    // handed a new one. Neither surface draws the strip — the band is the
    // thread's, and no empty band may be left behind on chain.
    assert.equal(
      chainUp.surface,
      "chain",
      "the chain never came up for the archive-from-chain case",
    );
    assert.equal(chainUp.strip, null, "the chain drew a tab strip band");
    assert.equal(
      archivedFromChain.strip,
      null,
      "archiving from the chain left a strip band on the chain",
    );
    assert.equal(
      archivedFromChain.surface,
      "chain",
      "archiving from the chain moved the dock off the chain",
    );
    assert.equal(
      archivedFromChain.thread,
      false,
      "archiving from the chain opened a thread",
    );
    assert.equal(
      archivedFromChain.tabCount,
      0,
      "archiving from the chain drew a tab strip",
    );
    assert.equal(
      archivedFromChain.createCalls.length,
      chainUp.createCalls.length,
      "archiving from the chain minted a blank chat",
    );

    // The plus after the last tab opens a new chat tab without disturbing the
    // chat in front. It is pressed from a one-tab state: the strip is drawn for
    // a single chat so the door to a second one is reachable before it exists.
    assert.equal(
      plusOpened.surface,
      "thread",
      "the plus left the thread",
    );
    assert.equal(
      plusOpened.tabCount,
      2,
      `the plus did not open a second tab (${plusOpened.tabCount} tabs)`,
    );
    assert.equal(plusOpened.tabs[0]?.label, "Seed chat 10", "the chat in front lost its tab");
    assert.equal(plusOpened.tabs[0]?.active, false, "the plus did not make the new tab active");
    assert.equal(plusOpened.tabs[1]?.label, "New chat", "the new tab is not a blank chat");
    assert.equal(plusOpened.tabs[1]?.active, true);
    assert.equal(plusOpened.heading, "New chat", "the new tab did not become the thread");
    assert.equal(
      plusOpened.createCalls.length,
      renameCancelled.createCalls.length + 1,
      "the plus did not ask the bridge for a blank chat",
    );
    assert.equal(
      plusOpened.strip?.box.bottom,
      plusOpened.header?.box.top,
      "the strip left its place above the name row after the new tab",
    );
    assert.equal(plusOpened.newTab?.tag, "button", "the plus is not a button");
    assert.equal(plusOpened.newTab?.role, null, "the plus is wearing a tab role");
    assert.ok(
      (plusOpened.newTab?.box?.left ?? Number.NEGATIVE_INFINITY) >=
        (plusOpened.tabs.at(-1)?.box?.right ?? Number.POSITIVE_INFINITY),
      "the plus is not after the last tab once a second tab exists",
    );
    assert.ok(
      (plusOpened.newTab?.box?.right ?? Number.POSITIVE_INFINITY) <=
        (plusOpened.strip?.box.right ?? Number.NEGATIVE_INFINITY),
      "the plus runs past the strip's trailing edge",
    );

    // A second press on the plus is the one-blank rule through the strip's own
    // door: it lands on the blank tab already open, so nothing is minted and the
    // strip does not grow.
    assert.equal(plusAgain.tabCount, 2, "a second plus grew the strip");
    assert.deepEqual(
      plusAgain.tabs.map((tab) => tab.label),
      ["Seed chat 10", "New chat"],
      "a second plus changed the strip's chats",
    );
    assert.equal(
      plusAgain.tabs.at(-1)?.active,
      true,
      "a second plus moved the front off the blank tab",
    );
    assert.equal(
      plusAgain.createCalls.length,
      plusOpened.createCalls.length,
      "a second plus minted a second blank chat",
    );

    // A rename field belongs to the chat it was opened on. With the dock header
    // no longer carrying chat controls, rename starts on the row; switching the
    // header to another chat must leave the field on its own row and write
    // nothing across.
    assert.equal(renameOpen.rowRenaming, true, "the row rename field never opened");
    assert.equal(renameOpen.rowRenameValue, "Wrong chat name");
    assert.equal(
      renameSwitched.heading,
      "Seed chat 10",
      `switching chats did not move the header ("${renameSwitched.heading}")`,
    );
    assert.equal(
      renameSwitched.rowRenaming,
      true,
      "the rename field disappeared when the header moved",
    );
    assert.equal(
      renameSwitched.patchCalls.some(
        (call) => typeof call.patch.title === "string",
      ),
      false,
      "a rename was written to the wrong chat",
    );
    assert.equal(renameCancelled.rowRenaming, false, "Cancel left the rename field open");

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
