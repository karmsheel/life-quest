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
  messages: string[];
  actionsBar: Box | null;
  actions: {
    label: string | null;
    pressed: boolean;
    disabled: boolean;
    opacity: number;
    icon: string | null;
  }[];
  patchCalls: { id: string; patch: Record<string, unknown> }[];
  createCalls: string[];
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

describe("chat sessions (dock list, pin, rename, archive)", () => {
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

    // The bottom action bar: two live slots, two reserved, and it rides the
    // bottom edge in both views.
    const slots = ["Chat history", "New chat", "Search chats (coming soon)", "More chat actions (coming soon)"];
    assert.deepEqual(
      landing.actions.map((slot) => slot.label),
      slots,
      "the action bar lost a slot",
    );
    assert.deepEqual(
      landing.actions.map((slot) => slot.disabled),
      [false, false, true, true],
      "the reserved slots are not reserved",
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
      [false, false, true, true],
      "the reserved slots are not dimmed",
    );
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

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
