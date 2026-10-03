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
  composer: { box: Box; display: string } | null;
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
