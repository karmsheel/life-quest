/**
 * Pinned chats in the dock's tab strip.
 *
 * The rig (`e2e/chat-pinned-tabs.electron.mjs`) drives the chat-tabs harness
 * page in a real Electron window — the shipping sidebar, dock, store and CSS,
 * with the IPC bridge stubbed — and measures the pinned square, the tab context
 * menu and the sidebar row's pinned/unpinned states against the shipped DOM.
 * This wrapper asserts the report the rig wrote, so a skipped or silently
 * broken run cannot pass.
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
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-pinned-tabs.json");
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Tab = {
  label: string;
  letter: string | null;
  name: string;
  pinned: boolean;
  pin: boolean;
  pinVisible: boolean;
  close: string | null;
  hasClose: boolean;
  active: boolean | null;
  box: Box | null;
};

type Row = {
  label: string;
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
  };
};

type TabMenu = {
  box: Box | null;
  menuFor: string | null;
  tabId: string | null;
  itemLabels: (string | null)[];
};

type RailMenu = {
  box: Box | null;
  itemLabels: (string | null)[];
  rowLabel: string;
};

type State = {
  viewport: { width: number; height: number };
  surface: string | null;
  thread: boolean;
  heading: string;
  rows: Row[];
  rowCount: number;
  tabs: Tab[];
  tabCount: number;
  strip: { box: Box | null } | null;
  tabMenu: TabMenu | null;
  railMenu: RailMenu | null;
  header: { actions: (string | null)[] } | null;
  renaming: boolean;
  renameValue: string | null;
  dialog: { title: string; message: string; confirm: boolean } | null;
  patchCalls: { id: string; patch: Record<string, unknown> }[];
  deleteCalls: string[];
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
      [path.join(desktopRoot, "e2e/chat-pinned-tabs.electron.mjs")],
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

const tabLabels = (state: State) => state.tabs.map((tab) => tab.label);
const pinnedTabs = (state: State) => state.tabs.filter((tab) => tab.pinned);

describe("pinned chats in the dock's tab strip", () => {
  it("draws a pinned square, offers the pinned/unpinned tab menus, and keeps the sidebar verbs in step", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });

    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "the driver wrote no report");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(exitCode, 0, "the driver exited non-zero");
    assert.deepEqual(report.failures, [], "the driver reported failures");
    assert.equal(report.pass, true);

    const {
      landing,
      activePinned,
      pinnedRowHover,
      pinnedRowMenu,
      pinnedTabMenu,
      menuEscaped,
      unpinnedTab,
      unpinnedRowHover,
      unpinnedRowMenu,
      unpinnedTabMenu,
      repinned,
      renameOpen,
      renamed,
      archivedFromTabMenu,
      bravoTab,
      deleteAsked,
      deleted,
      final,
    } = report.states;

    // A pinned chat is a tab at boot, drawn as a square: first letter + pin, no
    // label and no close, ahead of the open chat's normal tab.
    assert.equal(landing.tabCount, 2, "the landing did not draw the pinned tab beside the open chat");
    assert.equal(landing.tabs[0]?.pinned, true, "the first tab is not the pinned one");
    assert.equal(landing.tabs[0]?.letter, "P", "the pinned square does not carry the chat's letter");
    assert.equal(landing.tabs[0]?.pin, true, "the pinned square carries no pin icon");
    assert.equal(landing.tabs[0]?.hasClose, false, "the pinned square has a close control");
    assert.equal(landing.tabs[0]?.label, "", "the pinned square draws a text label");
    assert.equal(landing.tabs[1]?.pinned, false, "the open chat's tab is marked pinned");
    assert.equal(landing.tabs[1]?.label, "Alpha planning");
    assert.equal(landing.tabs[1]?.hasClose, true, "the open chat's tab has no close control");
    assert.equal(landing.heading, "Alpha planning", "the landing opened the wrong chat");
    assert.deepEqual(
      landing.header?.actions,
      [],
      "the dock header still carries chat controls",
    );

    // Clicking the square opens the pinned chat; the header hides Archive while
    // the active chat is pinned.
    assert.equal(activePinned.heading, "Pinned note", "the pinned tab did not open its chat");
    assert.equal(
      activePinned.tabs.find((tab) => tab.pinned)?.active,
      true,
      "the clicked pinned tab is not the active one",
    );
    assert.deepEqual(
      activePinned.header?.actions,
      [],
      "the dock header grew chat controls for a pinned active chat",
    );

    // The sidebar pinned row: Unpin only on hover, no Archive, and no
    // Archive/Delete in the three-dot menu.
    const pinnedRow = pinnedRowHover.rows.find((row) => row.label === "Pinned note");
    assert.equal(pinnedRow?.pinned, true, "the pinned row is not marked pinned");
    assert.equal(pinnedRow?.actionsVisible, true, "hovering the pinned row revealed no actions");
    assert.equal(pinnedRow?.pin.visible, true, "the pinned row has no visible hover pin");
    assert.equal(pinnedRow?.pin.label, "Unpin chat", "the pinned hover control is not Unpin");
    assert.equal(pinnedRow?.pin.dataPinned, "true", "the pinned hover control lost its flag");
    assert.equal(pinnedRow?.pin.filled, true, "the pinned hover pin is not filled");
    assert.equal(
      pinnedRow?.archive.visible,
      false,
      "the pinned row still shows its hover Archive control",
    );
    assert.deepEqual(
      pinnedRowMenu.railMenu?.itemLabels,
      ["Open in new tab", "Unpin chat", "Rename chat"],
      "the pinned row's menu is not the pinned subset",
    );

    // Right-clicking the pinned tab offers exactly Unpin; Escape dismisses it.
    assert.equal(pinnedTabMenu.tabMenu?.menuFor, "pinned");
    assert.equal(pinnedTabMenu.tabMenu?.tabId, "chat-pinned");
    assert.deepEqual(
      pinnedTabMenu.tabMenu?.itemLabels,
      ["Unpin chat"],
      "the pinned tab's menu offers more than Unpin",
    );
    assert.equal(
      menuEscaped.tabMenu,
      null,
      "Escape did not close the pinned tab's menu",
    );

    // Unpin reaches the gateway and the square becomes a normal tab with a close
    // control; the sidebar row and the header regain their Archive verbs.
    const unpin = unpinnedTab.patchCalls.at(-1);
    assert.equal(unpin?.id, "chat-pinned", "Unpin hit the wrong chat");
    assert.equal(unpin?.patch.pinned, false, "Unpin never reached the bridge");
    assert.equal(unpinnedTab.tabMenu, null, "the tab menu stayed open after Unpin");
    assert.equal(unpinnedTab.tabCount, 2);
    assert.deepEqual(
      pinnedTabs(unpinnedTab).map((tab) => tab.label),
      [],
      "the unpinned chat is still drawn as a pinned square",
    );
    const normalTab = unpinnedTab.tabs.find((tab) => tab.label === "Pinned note");
    assert.equal(normalTab?.hasClose, true, "the unpinned tab has no close control");
    assert.equal(normalTab?.letter, null, "the unpinned tab still draws a letter");
    assert.deepEqual(
      unpinnedTab.header?.actions,
      [],
      "the dock header grew chat controls after the unpin",
    );

    const nowUnpinnedRow = unpinnedRowHover.rows.find(
      (row) => row.label === "Pinned note",
    );
    assert.equal(nowUnpinnedRow?.pinned, false, "the row kept its pinned flag");
    assert.equal(nowUnpinnedRow?.pin.label, "Pin chat", "the row's hover control is not Pin");
    assert.equal(
      nowUnpinnedRow?.archive.visible,
      true,
      "the unpinned row did not regain its hover Archive control",
    );
    assert.equal(
      nowUnpinnedRow?.archive.label,
      "Archive chat",
      "the regained hover control is not Archive",
    );
    for (const label of ["Pin chat", "Rename chat", "Archive chat", "Delete chat"]) {
      assert.equal(
        unpinnedRowMenu.railMenu?.itemLabels.includes(label),
        true,
        `the unpinned row's menu is missing ${label}`,
      );
    }

    // Right-clicking an unpinned tab offers the four verbs.
    assert.equal(unpinnedTabMenu.tabMenu?.menuFor, "unpinned");
    assert.equal(unpinnedTabMenu.tabMenu?.tabId, "chat-pinned");
    assert.deepEqual(
      unpinnedTabMenu.tabMenu?.itemLabels,
      ["Pin chat", "Rename chat", "Archive chat", "Delete chat"],
      "the unpinned tab's menu is not Pin/Rename/Archive/Delete",
    );

    // Pin from that menu re-pins, and the square comes back at the front.
    const repin = repinned.patchCalls.at(-1);
    assert.equal(repin?.id, "chat-pinned", "Pin hit the wrong chat");
    assert.equal(repin?.patch.pinned, true, "Pin never reached the bridge");
    assert.equal(repinned.tabMenu, null, "the tab menu stayed open after Pin");
    assert.equal(repinned.tabs[0]?.pinned, true, "the re-pinned square is not first");
    assert.equal(repinned.tabs[0]?.letter, "P");
    assert.equal(repinned.tabs[0]?.hasClose, false);

    // Rename from the tab menu opens the header field on that tab's chat and
    // patches that chat's title on submit.
    assert.equal(renameOpen.renaming, true, "Rename from the tab menu opened no field");
    assert.equal(renameOpen.renameValue, "Alpha planning", "the rename field names another chat");
    const rename = renamed.patchCalls.at(-1);
    assert.equal(rename?.id, "chat-alpha", "the rename hit the wrong chat");
    assert.equal(rename?.patch.title, "Alpha renamed", "the rename never reached the bridge");
    assert.equal(renamed.heading, "Alpha renamed", "the heading kept the old name");
    assert.equal(
      renamed.tabs.some((tab) => tab.label === "Alpha renamed"),
      true,
      "the renamed chat's tab kept the old name",
    );

    // Archive from the tab menu removes the row and the tab. The pinned square is
    // then the strip's only tab, and the strip is still drawn because of it.
    const archive = archivedFromTabMenu.patchCalls.at(-1);
    assert.equal(archive?.id, "chat-alpha", "Archive hit the wrong chat");
    assert.equal(archive?.patch.archived, true, "Archive never reached the bridge");
    assert.equal(
      archivedFromTabMenu.rows.some((row) => row.label === "Alpha renamed"),
      false,
      "the archived chat is still listed",
    );
    assert.deepEqual(
      tabLabels(archivedFromTabMenu),
      [""],
      "the archived chat kept its tab",
    );
    assert.equal(archivedFromTabMenu.tabCount, 1, "one pinned tab did not draw the strip");
    assert.equal(archivedFromTabMenu.tabs[0]?.pinned, true);
    assert.equal(archivedFromTabMenu.strip !== null, true, "the strip is not drawn for one pinned tab");
    assert.equal(archivedFromTabMenu.heading, "Pinned note", "the dock did not hand over to the pinned chat");

    // A second tab for the delete step: Bravo, normal and in front.
    assert.deepEqual(tabLabels(bravoTab), ["", "Bravo budget"]);
    assert.equal(bravoTab.tabs[1]?.active, true, "the new tab is not active");
    assert.equal(bravoTab.heading, "Bravo budget");

    // Delete asks in the app's own dialog and writes only on yes.
    assert.equal(deleteAsked.dialog?.title, "Delete chat", "delete did not ask");
    assert.equal(deleteAsked.dialog?.confirm, true, "the ask has no confirm control");
    assert.deepEqual(deleteAsked.deleteCalls, [], "delete wrote before it was answered");
    assert.equal(deleted.deleteCalls.at(-1), "chat-bravo", "the delete hit the wrong chat");
    assert.equal(
      deleted.rows.some((row) => row.label === "Bravo budget"),
      false,
      "the deleted chat is still listed",
    );
    assert.equal(
      deleted.tabs.some((tab) => tab.label === "Bravo budget"),
      false,
      "the deleted chat kept its tab",
    );

    // What is left is the pinned square alone, in a strip that is still drawn.
    assert.equal(final.tabCount, 1, "the final strip is not the one pinned square");
    assert.equal(final.tabs[0]?.pinned, true);
    assert.equal(final.tabs[0]?.letter, "P");
    assert.equal(final.tabs[0]?.pin, true);
    assert.equal(final.tabs[0]?.hasClose, false);
    assert.equal(final.strip !== null, true, "the final strip is not drawn");
    assert.equal(final.heading, "Pinned note");

    // The pictures are the rig's own capturePage of the shipped shell, and they
    // exist on disk for the operator to open later.
    assert.deepEqual(report.screenshots, [
      "chat-pinned-tabs-landing.png",
      "chat-pinned-tabs-active-pinned.png",
      "chat-pinned-tabs-pinned-row-menu.png",
      "chat-pinned-tabs-pinned-tab-menu.png",
      "chat-pinned-tabs-unpinned-tab.png",
      "chat-pinned-tabs-unpinned-row-menu.png",
      "chat-pinned-tabs-repinned-tab.png",
      "chat-pinned-tabs-renamed-tab.png",
      "chat-pinned-tabs-archived-from-tab-menu.png",
      "chat-pinned-tabs-delete-dialog.png",
      "chat-pinned-tabs-final.png",
    ]);
    for (const name of report.screenshots) {
      assert.equal(
        fs.existsSync(path.join(ARTIFACTS, name)),
        true,
        `the rig captured no ${name}`,
      );
    }
  });
});
