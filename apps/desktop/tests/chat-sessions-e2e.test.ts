/**
 * The chat-sessions harness page (`e2e/chat-sessions.{html,tsx}`) and the two
 * rigs that drive it: the dock's session list (`chat-sessions.electron.mjs`)
 * and its chain view (`chat-chain.electron.mjs`). They are wrapped together
 * because they share one page, one dev-server probe and one shape of report
 * read back; each rig is still its own Electron process writing its own
 * artifact, so a failure names the concern it belongs to.
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

const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-sessions.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Row = {
  label: string;
  when: string;
  pinned: boolean;
  active: boolean;
};

type State = {
  viewport: { width: number; height: number };
  panel: Box;
  heading: string;
  list: {
    box: Box;
    clientHeight: number;
    scrollHeight: number;
    overflowY: string;
  } | null;
  listMaxHeight: string | null;
  groups: string[];
  rowCount: number;
  rows: Row[];
  lastRow: Box | null;
  body: { box: Box; display: string; hidden: boolean } | null;
  footer: { box: Box; display: string; hidden: boolean } | null;
  composer: { box: Box; display: string; focused: boolean } | null;
  /** What holds the caret, so a failure can say where it went. */
  active: { tag: string; label: string | null; composer: boolean } | null;
  threadHeader: { box: Box; label: string; actions: string[] } | null;
  renaming: boolean;
  renameValue: string | null;
  rowMenu: string[] | null;
  rowMenuRowIndex: number | null;
  rowMenuBtnCount: number;
  rowMenuBox: Box | null;
  rowMenuItems: { label: string | null; color: string }[];
  rowMenuBackground: string | null;
  rowRename: boolean;
  rowRenameValue: string | null;
  lastChatStored: string | null;
  messages: string[];
  actionsBar: Box | null;
  actionsBarBackground: string | null;
  footerBackground: string | null;
  headerIconSize: number | null;
  actions: {
    label: string | null;
    pressed: boolean;
    disabled: boolean;
    opacity: number;
    background: string;
    iconSize: number;
    icon: string | null;
  }[];
  patchCalls: { id: string; patch: Record<string, unknown> }[];
  createCalls: string[];
  deleteCalls: string[];
  confirmDialog: {
    title: string;
    message: string;
    confirmLabel: string | null;
    cancelLabel: string | null;
    box: Box | null;
    backdrop: Box | null;
    /** The scrim's computed fill: a scrim that paints nothing is not a scrim. */
    backdropBackground: string;
    /** Card centre minus the window's centre: the contract is that it is ~0. */
    offsetFromWindowX: number;
    offsetFromWindowY: number;
    /** Card centre minus the dock's centre: what it must NOT be. */
    offsetFromPanelX: number | null;
  } | null;
  messageCalls: string[];
  listCalls: number;
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  fixture: { rows: number; archived: number; hidden: number; newestLabel: string };
  states: Record<string, State>;
  screenshots: string[];
};

/**
 * The rig measures the real dock in a real Electron window, so it needs the Vite
 * dev server. With the server down the test skips; `npm run dev` in another
 * shell turns it on.
 */
/** RGB channels of a computed colour in 0–255, whatever syntax it resolved to. */
function channels(color: string | null): number[] {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  // `color(srgb …)` reports 0–1 floats while `rgb()`/`rgba()` report 0–255, so a
  // cross-syntax comparison would gap ~237 on two identical colours.
  return raw.length === 3 && raw.every((value) => value <= 1.0001)
    ? raw.map((value) => value * 255)
    : raw;
}

/** Alpha of a computed colour: 1 when it carries none. */
function alphaOf(color: string | null): number {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3] : 1;
}

/** Largest per-channel gap between two computed colours; NaN when unparseable. */
function channelDelta(a: string | null, b: string | null): number {
  const x = channels(a);
  const y = channels(b);
  if (x.length < 3 || y.length < 3) return Number.NaN;
  return Math.max(...x.map((value, index) => Math.abs(value - y[index])));
}

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
      [path.join(desktopRoot, "e2e/chat-sessions.electron.mjs")],
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

describe("chat sessions rigs", { concurrency: true }, () => {
  describe("chat sessions (dock list, row menu, pin, rename, archive, delete)", () => {
    it("lists every live chat, and carries pin/rename/archive through the bridge", async (t) => {
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

      // Restated here so the numbers are asserted by the suite, not only inside
      // the driver — and so a regression names the surface it broke.
      const { landing, list, thread, pinnedList, unpinnedList, renamed, renamedList, archived } =
        report.states;
      const created = report.states.created;
      const live = report.fixture.rows;

      // The bottom action bar: three live slots, one still reserved, and it rides
      // the bottom edge in both views.
      const slots = ["Chat history", "New chat", "Search chats (coming soon)", "Life-Chain"];
      assert.deepEqual(
        landing.actions.map((slot) => slot.label),
        slots,
        "the action bar lost a slot",
      );
      assert.deepEqual(
        landing.actions.map((slot) => slot.disabled),
        [false, false, true, false],
        "the reserved slot is not reserved, or the chain slot is inert",
      );
      assert.equal(
        new Set(landing.actions.map((slot) => slot.icon)).size,
        slots.length,
        "two slots wear the same icon",
      );
      assert.ok(
        Math.abs((landing.actionsBar?.bottom ?? 0) - landing.panel.bottom) <= 2,
        `the action bar does not ride the bottom edge: ${landing.actionsBar?.bottom}px vs ${landing.panel.bottom}px`,
      );
      assert.ok(
        (landing.actionsBar?.top ?? 0) >= (landing.footer?.box.bottom ?? 0) - 1,
        "the action bar overlaps the composer",
      );
      assert.deepEqual(
        list.actions.map((slot) => slot.label),
        slots,
        "the action bar did not survive the swap to the list",
      );
      assert.equal(list.actions[0]?.pressed, true, "history is not marked active in the list");
      assert.equal(landing.actions[0]?.pressed, false, "history is marked active on a thread");
      assert.deepEqual(
        landing.actions.map((slot) => slot.opacity < 1),
        [false, false, true, false],
        "the reserved slot is not dimmed, or the chain slot is dimmed",
      );
      assert.equal(
        new Set(landing.actions.map((slot) => slot.iconSize)).size,
        1,
        "the action icons are not all one size",
      );
      assert.ok(
        landing.actions[0].iconSize >= 18,
        `the action icons did not grow: ${landing.actions[0].iconSize}px`,
      );
      assert.ok(
        landing.actions[0].iconSize > (landing.headerIconSize ?? 0),
        `the bar's icons (${landing.actions[0].iconSize}px) are not larger than the header's (${landing.headerIconSize}px)`,
      );
      assert.ok(
        channelDelta(landing.actionsBarBackground, landing.footerBackground) >= 8,
        `the action bar shares the composer's surface: ${landing.actionsBarBackground} vs ${landing.footerBackground}`,
      );
      assert.ok(
        alphaOf(list.actions[0].background) > 0.05 &&
          alphaOf(list.actions[0].background) <= 0.5,
        `the active slot is not a tint: ${list.actions[0].background}`,
      );
      assert.equal(alphaOf(list.actions[1].background), 0, "an idle slot paints a fill");
      assert.ok(
        (list.list?.box.bottom ?? 0) <= (list.actionsBar?.top ?? 0) + 1,
        "the list runs under the action bar",
      );

      assert.ok(landing.threadHeader, "the dock did not land on a thread");
      assert.equal(
        landing.threadHeader.label,
        report.fixture.newestLabel,
        "the landing thread is not the newest chat",
      );
      assert.deepEqual(
        landing.messages.length,
        4,
        "the transcript is not the four chat rows of the seeded newest chat",
      );
      assert.equal(landing.list, null, "the list painted behind the thread");

      assert.ok(list.list, "the All chats control opened no list");
      assert.equal(
        list.listMaxHeight,
        "none",
        "list view is still capped by the thread strip's max-height",
      );
      assert.ok(
        list.list.box.height >= list.panel.height * 0.6,
        `the list is a strip again: ${list.list.box.height}px in a ${list.panel.height}px panel`,
      );
      assert.equal(list.rowCount, live, `listed ${list.rowCount} of ${live} live chats`);
      assert.equal(
        list.rows.some((row) => row.label === "Old scratch pad"),
        false,
        "an archived chat is in the list",
      );
      assert.equal(
        list.rows.some((row) => row.label === "Debug: tool loop"),
        false,
        "a hidden chat is in the list",
      );
      assert.deepEqual(list.groups, [], "group headers appeared with nothing pinned");
      assert.equal(
        list.body?.display,
        "none",
        "the transcript still paints in list view",
      );
      assert.equal(
        list.composer?.box.height,
        0,
        "the composer still paints in list view",
      );
      assert.equal(
        list.panel.width,
        landing.panel.width,
        "the panel changed width across the swap",
      );

      assert.ok(thread.threadHeader, "a row click did not open a thread");
      assert.notEqual(
        thread.threadHeader.label,
        report.fixture.newestLabel,
        "the row click reopened the resumed chat",
      );
      assert.equal(thread.list, null, "the list stayed up behind the thread");
      assert.equal(
        thread.composer?.focused,
        true,
        `opening a chat left the caret on ${JSON.stringify(thread.active)}`,
      );

      const pin = pinnedList.patchCalls.at(-1);
      assert.equal(pin?.patch.pinned, true, "pin never reached the bridge");
      assert.deepEqual(
        pinnedList.groups,
        ["Pinned", "Recent"],
        "the pinned chat got no section",
      );
      assert.equal(pinnedList.rows[0]?.pinned, true, "the pinned row is unmarked");
      assert.equal(
        pinnedList.rows[0]?.label,
        thread.threadHeader?.label,
        "the pinned row is not the chat that was pinned",
      );
      assert.equal(pinnedList.rowCount, live, "pinning lost chats");

      const unpin = unpinnedList.patchCalls.at(-1);
      assert.equal(unpin?.patch.pinned, false, "unpin never reached the bridge");
      assert.deepEqual(unpinnedList.groups, [], "the Pinned section outlived the unpin");

      const rename = renamed.patchCalls.at(-1);
      assert.equal(rename?.patch.title, "Lisbon trip planning", "rename never reached the bridge");
      assert.equal(
        renamed.threadHeader?.label,
        "Lisbon trip planning",
        "the thread kept the old name",
      );
      assert.equal(renamed.renaming, false, "the rename field stayed open");
      assert.ok(
        renamedList.rows.some((row) => row.label === "Lisbon trip planning"),
        "the list kept the old name",
      );
      assert.equal(
        renamedList.rows.some((row) => row.label === report.fixture.newestLabel),
        true,
        "the other chats left the list when one was renamed",
      );

      const archive = archived.patchCalls.at(-1);
      assert.equal(archive?.patch.archived, true, "archive never reached the bridge");
      assert.equal(archive?.id, rename?.id, "archive hit a different chat than the rename");
      assert.ok(archived.list, "archiving did not fall back to the list");
      assert.equal(archived.threadHeader, null, "the archived chat's thread is still up");
      assert.equal(
        archived.rowCount,
        live - 1,
        "the archived chat is still listed",
      );

      assert.equal(created.createCalls.length, 1, "the New chat slot never reached the bridge");
      assert.equal(created.threadHeader?.label, "New chat", "the new chat did not open as a thread");
      assert.deepEqual(created.messages, [], "the new chat opened with a transcript");
      assert.equal(
        created.patchCalls.length,
        archived.patchCalls.length,
        "creating a chat wrote session flags",
      );
      assert.equal(
        created.composer?.focused,
        true,
        `the New chat slot left the caret on ${JSON.stringify(created.active)}`,
      );

      // An empty chat is where the New chat slot goes, not what it makes: clicking
      // the slot with a blank chat already listed must reopen that chat, not mint
      // a second "New chat" row.
      const reused = report.states.reused;
      assert.equal(
        reused.createCalls.length,
        created.createCalls.length,
        "the New chat slot minted a second empty chat",
      );
      assert.equal(
        reused.threadHeader?.label,
        "New chat",
        "the reused empty chat did not reopen as a thread",
      );
      assert.deepEqual(reused.messages, [], "the reused chat opened with a transcript");
      assert.equal(
        reused.composer?.focused,
        true,
        `reusing a chat left the caret on ${JSON.stringify(reused.active)}`,
      );

      // The slot's own blank chat, already open: no create, no load, no view
      // swap. A hand-back hung only on state changes misses this one entirely.
      const again = report.states.again;
      assert.equal(
        again.createCalls.length,
        reused.createCalls.length,
        "pressing New chat on its own open chat minted another",
      );
      assert.equal(
        again.composer?.focused,
        true,
        `pressing New chat on the chat it already opened left the caret on ${JSON.stringify(again.active)}`,
      );
      assert.equal(
        report.states.reusedList.rowCount,
        report.fixture.rows,
        "reusing an empty chat added a row to the list",
      );

      // The list's own row management: a 3-dot menu per row and the three writes
      // behind it — Edit and Archive through PATCH, Delete through the gateway's
      // DELETE. The HTTP hop itself is not exercised here (no bearer key), so what
      // is pinned is that each choice reaches the bridge, and with what.
      const {
        menuState,
        rowRenameStarted,
        rowRenamed,
        rowArchived,
        deleteAsked,
        deleteDeclined,
        deleted,
        openDeleted,
      } = report.states;

      assert.equal(
        menuState.rowMenuBtnCount,
        menuState.rowCount,
        "a listed chat has no 3-dot control",
      );
      assert.deepEqual(
        menuState.rowMenu,
        ["Edit chat", "Archive chat", "Delete chat"],
        "the row menu does not offer Edit / Archive / Delete",
      );
      assert.equal(
        menuState.rowMenuRowIndex,
        1,
        "the menu opened on a different row than the control that was clicked",
      );
      assert.ok(
        (menuState.rowMenuBox?.height ?? 0) > 0 && alphaOf(menuState.rowMenuBackground) > 0.9,
        `the row menu paints no surface: ${menuState.rowMenuBackground}`,
      );
      assert.ok(
        channelDelta(menuState.rowMenuItems[2]?.color, menuState.rowMenuItems[0]?.color) >= 8 &&
          channelDelta(menuState.rowMenuItems[1]?.color, menuState.rowMenuItems[0]?.color) <= 2,
        `only Delete is destructive: ${JSON.stringify(menuState.rowMenuItems.map((item) => item.color))}`,
      );
      assert.equal(
        menuState.patchCalls.length,
        report.states.reusedList.patchCalls.length,
        "opening the row menu wrote a session flag",
      );

      assert.equal(rowRenameStarted.rowRename, true, "Edit did not put the row into rename");
      assert.equal(
        rowRenameStarted.threadHeader,
        null,
        "Edit opened the chat it was supposed to rename in place",
      );
      const rowRename = rowRenamed.patchCalls.at(-1);
      assert.equal(
        rowRename?.patch.title,
        "Kitchen reno quotes",
        "the row's rename never reached the bridge",
      );
      assert.ok(
        rowRenamed.rows.some((row) => row.label === "Kitchen reno quotes"),
        "the list kept the old name for the renamed row",
      );
      assert.equal(rowRenamed.rowRename, false, "the row's rename field stayed open");

      const rowArchive = rowArchived.patchCalls.at(-1);
      assert.equal(rowArchive?.patch.archived, true, "the row's archive never reached the bridge");
      assert.equal(
        rowArchive?.id,
        rowRename?.id,
        "the row's archive hit a different chat than its rename did",
      );
      assert.equal(
        rowArchived.rowCount,
        rowRenamed.rowCount - 1,
        "the row's archive left the chat listed",
      );
      assert.equal(rowArchived.threadHeader, null, "the row's archive opened a thread");

      // The ask is the dock's own dialog, measured rather than assumed: it has to
      // sit on the window's centre (a platform `window.confirm` put it on the
      // display's) and it must not be the dock's centre either.
      assert.ok(deleteAsked.confirmDialog, "delete never asked before it wrote");
      assert.equal(
        deleteAsked.confirmDialog.title,
        "Delete chat",
        "the question is not named for the delete it guards",
      );
      assert.match(
        deleteAsked.confirmDialog.message,
        /Delete/,
        "the question does not name the delete",
      );
      assert.deepEqual(deleteAsked.deleteCalls, [], "the delete wrote before it was answered");
      assert.ok(
        Math.abs(deleteAsked.confirmDialog.offsetFromWindowX) <= 2 &&
          Math.abs(deleteAsked.confirmDialog.offsetFromWindowY) <= 2,
        `the dialog is not centred in the window: ${deleteAsked.confirmDialog.offsetFromWindowX}px across, ${deleteAsked.confirmDialog.offsetFromWindowY}px down`,
      );
      assert.ok(
        Math.abs(deleteAsked.confirmDialog.offsetFromPanelX ?? 0) > 40,
        `the dialog is centred on the dock rather than the window: ${deleteAsked.confirmDialog.offsetFromPanelX}px`,
      );
      assert.equal(
        deleteAsked.confirmDialog.backdrop?.width,
        deleteAsked.viewport.width,
        "the scrim does not cover the window",
      );
      assert.ok(
        deleteAsked.confirmDialog.backdropBackground !== "transparent" &&
          !/\/\s*0(?:\.0+)?\)/.test(deleteAsked.confirmDialog.backdropBackground),
        `the scrim does not paint: ${deleteAsked.confirmDialog.backdropBackground}`,
      );
      assert.deepEqual(deleteDeclined.deleteCalls, [], "a cancelled delete wrote anyway");
      assert.equal(
        deleteDeclined.rowCount,
        rowArchived.rowCount,
        "a declined delete lost the row",
      );

      assert.equal(deleted.deleteCalls.length, 1, "an accepted delete never reached the bridge");
      // The row below the archived one shifts up: the delete has to hit the chat
      // whose menu was used, not the one archived just before it.
      assert.notEqual(
        deleted.deleteCalls[0],
        rowArchive?.id,
        "the delete re-hit the archived chat instead of the row it was asked from",
      );
      assert.equal(
        deleted.rowCount,
        deleteDeclined.rowCount - 1,
        "the deleted chat is still listed",
      );
      assert.equal(
        deleted.patchCalls.length,
        deleteDeclined.patchCalls.length,
        "the delete wrote session flags too",
      );

      assert.equal(
        openDeleted.lastChatStored,
        null,
        "the deleted chat is still the stored last chat",
      );
      assert.equal(
        openDeleted.rows.some((row) => row.active),
        false,
        "a chat is still marked open after its row was deleted",
      );

      for (const file of report.screenshots) {
        assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
      }
    });
  });

  const CHAIN_REPORT = path.join(desktopRoot, "e2e/artifacts/chat-chain.json");

  type ChainBox = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };

  type Item = {
    body: string;
    title: string;
    day: string;
    time: string;
    assign: { value: string; options: string[]; disabled: boolean } | null;
    menu: { present: boolean; expanded: boolean; items: string[] };
    editing: boolean;
    editValue: string | null;
    box: ChainBox;
    stamp: ChainBox;
    message: ChainBox;
    assignBox: ChainBox;
    stampBackground: string | null;
    messageBackground: string | null;
  };

  type ChainState = {
    heading: string;
    threadHeader: boolean;
    chatListPresent: boolean;
    chatBody: { box: ChainBox; display: string; hidden: boolean } | null;
    chainBody: {
      box: ChainBox;
      display: string;
      hidden: boolean;
      clientHeight: number;
      scrollHeight: number;
      scrollTop: number;
      overflowY: string;
      paddingTop: number;
      paddingBottom: number;
    } | null;
    chainList: {
      box: ChainBox;
      direction: string;
      marginTop: string;
      position: string;
      thread: {
        borderStyle: string;
        borderWidth: number;
        left: number;
        top: number;
        bottom: number;
        content: string;
      };
    } | null;
    items: Item[];
    field: {
      present: boolean;
      value?: string;
      disabled?: boolean;
      placeholder?: string;
      focused?: boolean;
    };
    chatField: { present: boolean; value?: string; focused?: boolean };
    /** What holds the caret, so a failure can say where it went. */
    active: { tag: string; label: string | null; composer: boolean } | null;
    send: { present: boolean; disabled?: boolean; type?: string; state?: string };
    actions: { label: string | null; pressed: boolean; disabled: boolean }[];
    transcript: string[];
    createCalls: Record<string, unknown>[];
    updateCalls: { id: string; patch: Record<string, unknown> }[];
    deleteCalls: { id: string; body: string | null }[];
    signalListCalls: number;
    messageCalls: string[];
    overflow: { scrollWidth: number; clientWidth: number };
  };

  type ChainReport = {
    pass: boolean;
    failures: string[];
    fixture: {
      total: number;
      newestBody: string;
      oldestId: string;
      oldestBody: string;
      domainSlug: string;
      titledBody: string;
      title: string;
      assignOptions: string[];
      archivedDomain: string;
    };
    states: Record<string, ChainState>;
    screenshots: string[];
  };


  function runChainDriver(): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile(
        electron,
        [path.join(desktopRoot, "e2e/chat-chain.electron.mjs")],
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

  /**
   * The chain rig measures the real dock in a real Electron window, so it needs
   * the Vite dev server. With the server down the test skips; `npm run dev` in
   * another shell turns it on.
   */

  describe("chat dock chain view", () => {
    it("swaps the panel to the Life-Chain and logs into it", async (t) => {
      if (!(await devServerUp())) {
        t.skip(
          `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
        );
        return;
      }

      fs.rmSync(CHAIN_REPORT, { force: true });
      const exitCode = await runChainDriver();
      assert.equal(fs.existsSync(CHAIN_REPORT), true, "driver wrote no report artifact");

      const report = JSON.parse(fs.readFileSync(CHAIN_REPORT, "utf8")) as ChainReport;
      assert.deepEqual(report.failures, []);
      assert.equal(exitCode, 0, "driver exited non-zero");
      assert.equal(report.pass, true);

      // Restated here so the numbers are asserted by the suite, not only inside
      // the driver — and so a regression names the surface it broke.
      const {
        landing,
        chain,
        logged,
        entered,
        inFlight,
        caretAfterLog,
        enterInFlight,
        caretAfterEnter,
        editing,
        cancelled,
        saved,
        assigned,
        deleted,
        short,
        chatList,
        reread,
      } = report.states;
      const total = report.fixture.total;
      const liveRows = total + 2;

      assert.equal(landing.chainBody?.hidden, true, "the chain painted on landing");
      assert.equal(landing.signalListCalls, 0, "the chain was read before it was asked for");
      assert.equal(landing.actions[3]?.label, "Life-Chain", "the last slot is not the chain");
      assert.equal(landing.actions[3]?.pressed, false, "the chain slot starts active");

      assert.equal(chain.heading, "Life-Chain", "the chain header names the wrong surface");
      assert.equal(chain.actions[3]?.pressed, true, "the chain slot is not marked active");
      assert.equal(chain.chatField.present, false, "both composers are mounted at once");
      assert.equal(chain.transcript.length, 0, "the chat transcript paints behind the chain");
      assert.equal(chain.items.length, total, `listed ${chain.items.length} of ${total} signals`);
      assert.equal(chain.items[0]?.body, report.fixture.oldestBody, "the DOM does not lead with the oldest");
      assert.equal(
        chain.items[chain.items.length - 1]?.body,
        report.fixture.newestBody,
        "the DOM does not end with the newest",
      );
      assert.equal(chain.chainList?.direction, "column", "the chain is not a top-down list");
      // The stack's anchor is an auto margin, and this is its other half: with the
      // content taller than the panel the used margin resolves to 0 (measured; a
      // fixed `margin-top` would read the same, which is why the resting case
      // below is the assertion that pins the anchor).
      assert.equal(
        chain.chainList?.marginTop,
        "0px",
        "the auto margin did not give way to the overflow",
      );
      assert.ok(
        chain.chainBody!.scrollHeight > chain.chainBody!.clientHeight,
        `the fixture no longer overflows the panel: ${chain.chainBody!.scrollHeight}px in ${chain.chainBody!.clientHeight}px`,
      );
      assert.ok(
        Math.abs(
          chain.chainBody!.scrollTop +
            chain.chainBody!.clientHeight -
            chain.chainBody!.scrollHeight,
        ) <= 2,
        `the chain does not open on its newest entry: scrollTop ${chain.chainBody!.scrollTop} in ${chain.chainBody!.scrollHeight}px`,
      );
      assert.equal(chain.send.present, false, "the send control shows on an empty draft");
      assert.equal(
        chain.field.focused,
        true,
        `the swapped-in composer did not take the caret: it is on ${JSON.stringify(chain.active)}`,
      );

      // Two blocks per row, plus the picker under the message and the thread
      // through the date boxes. Measured, not read off the source.
      for (const item of chain.items) {
        assert.ok(
          item.stamp.right <= item.message.left + 1,
          `the date block is not beside the message: stamp ${JSON.stringify(item.stamp)} message ${JSON.stringify(item.message)}`,
        );
        assert.ok(
          Math.abs(item.stamp.width - item.stamp.height) <= 2,
          `the date block is not square: ${item.stamp.width}x${item.stamp.height}`,
        );
        assert.notEqual(
          item.stampBackground,
          item.messageBackground,
          "the date block and the message block are the same colour",
        );
        assert.ok(
          item.assignBox.top >= item.message.bottom - 1 &&
            Math.abs(item.assignBox.left - item.message.left) <= 1,
          "the assignment picker is not under the message box",
        );
        assert.ok(item.day.length > 0 && /\d/.test(item.time), "the stamp misses date or time");
        assert.deepEqual(
          item.assign?.options,
          report.fixture.assignOptions,
          "the picker's options are not unassigned plus the live domains",
        );
        assert.equal(
          item.assign?.options.includes(report.fixture.archivedDomain),
          false,
          "the picker offers an archived domain",
        );
      }
      assert.equal(
        chain.chainList?.thread.borderStyle,
        "dashed",
        "the thread through the date boxes is not dashed",
      );
      assert.ok(
        chain.chainList!.thread.borderWidth > 1 && chain.chainList!.thread.borderWidth <= 3,
        `the thread is no thicker than a hairline: ${chain.chainList!.thread.borderWidth}px`,
      );
      assert.ok(
        chain.items.every(
          (item) =>
            chain.chainList!.thread.left >= item.stamp.left - (chain.chainList?.box.left ?? 0) &&
            chain.chainList!.thread.left <= item.stamp.right - (chain.chainList?.box.left ?? 0),
        ),
        "the thread does not run through the date boxes",
      );

      // The row's own controls, all three writing through the same bridge calls.
      assert.equal(editing.items[0]?.editing, true, "Edit did not open the row");
      assert.equal(
        editing.active?.label,
        "Edit signal",
        `the hand-back rule stole the caret from the row's editor: ${JSON.stringify(editing.active)}`,
      );
      assert.equal(
        editing.items[0]?.editValue,
        report.fixture.oldestBody,
        "the editor did not open on the row's own text",
      );
      assert.equal(cancelled.items[0]?.editing, false, "Cancel did not close the editor");
      assert.equal(cancelled.updateCalls.length, 0, "Cancel wrote to the chain");
      assert.deepEqual(
        saved.updateCalls[0],
        { id: report.fixture.oldestId, patch: { body: saved.items[0]?.body } },
        "the edit did not reach the bridge as a body patch",
      );
      assert.equal(saved.items.length, liveRows, "editing a row changed the chain's length");
      assert.deepEqual(
        assigned.updateCalls[1],
        { id: report.fixture.oldestId, patch: { domainSlug: report.fixture.domainSlug } },
        "the picker did not reach the bridge as a domain patch",
      );
      assert.equal(
        assigned.items.filter((item) => item.assign?.value === report.fixture.domainSlug).length,
        2,
        "the assigned domain is not the one the picker shows",
      );
      assert.equal(deleted.deleteCalls.length, 1, "Delete did not reach the bridge exactly once");
      assert.equal(deleted.items.length, liveRows - 1, "the deleted signal is still listed");
      assert.equal(
        deleted.items.some((item) => item.body === deleted.deleteCalls[0]?.body),
        false,
        "the row the id resolved to is still on the chain",
      );

      assert.deepEqual(
        logged.createCalls[0],
        {
          type: "thought",
          title: null,
          body: "Buy the standing desk before Monday",
          domainSlug: null,
        },
        "the log did not go to the bridge as a plain thought",
      );
      assert.equal(
        logged.items.length,
        total + 1,
        "the logged signal is not on the chain",
      );
      assert.equal(
        logged.items[logged.items.length - 1]?.body,
        "Buy the standing desk before Monday",
        "the logged signal is not the newest row",
      );
      assert.equal(logged.field.value, "", "the field kept its text");
      // The write disables the field, and a disabled field cannot hold the caret:
      // the browser drops it on `body`. Capture is one gesture, so the field has
      // to take it back when it comes back enabled.
      assert.equal(
        inFlight.field.disabled,
        true,
        "the field stayed live through its own write, so this rig measured nothing",
      );
      assert.equal(
        inFlight.field.focused,
        false,
        `the in-flight write kept the caret in the field: ${JSON.stringify(inFlight.active)}`,
      );
      assert.equal(
        caretAfterLog.field.focused,
        true,
        `logging a signal left the caret on ${JSON.stringify(caretAfterLog.active)}`,
      );
      assert.equal(entered.createCalls.length, 2, "Enter did not log the second signal");
      assert.equal(
        enterInFlight.field.disabled,
        true,
        "Enter's write never disabled the field, so this rig measured nothing",
      );
      assert.equal(
        enterInFlight.field.focused,
        false,
        `Enter's write kept the caret in the field it disabled: ${JSON.stringify(enterInFlight.active)}`,
      );
      assert.equal(
        caretAfterEnter.field.focused,
        true,
        `Enter left the caret on ${JSON.stringify(caretAfterEnter.active)}`,
      );

      assert.equal(short.items.length, 3, "the short chain did not shrink to the limit");
      assert.ok(
        short.chainBody!.scrollHeight <= short.chainBody!.clientHeight,
        `the short chain still overflows: ${short.chainBody!.scrollHeight}px in ${short.chainBody!.clientHeight}px`,
      );
      assert.ok(
        Math.abs(
          (short.chainList?.box.bottom ?? 0) -
            ((short.chainBody?.box.bottom ?? 0) - (short.chainBody?.paddingBottom ?? 0)),
        ) <= 2,
        "the short chain does not rest on the composer",
      );

      assert.equal(chatList.chatListPresent, true, "the chats list is not reachable from the chain");
      assert.equal(chatList.chainBody?.hidden, true, "the chain stayed up behind the chats list");
      assert.equal(
        chatList.signalListCalls,
        short.signalListCalls,
        "the chats list asked the vault for the chain",
      );
      assert.equal(
        reread.items.length,
        liveRows - 1,
        "a fresh read lost a logged signal, or resurrected the deleted one",
      );
      assert.equal(reread.createCalls.length, 2, "re-reading the chain wrote to it");
      assert.equal(reread.updateCalls.length, 2, "the row's own writes did not all land");
      assert.equal(reread.deleteCalls.length, 1, "the delete did not stick");

      for (const file of report.screenshots) {
        assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
      }
    });
  });
});
