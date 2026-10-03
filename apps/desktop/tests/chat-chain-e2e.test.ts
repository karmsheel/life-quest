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
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-chain.json");

type Box = {
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
  box: Box;
  stamp: Box;
  message: Box;
  assignBox: Box;
  stampBackground: string | null;
  messageBackground: string | null;
};

type State = {
  heading: string;
  threadHeader: boolean;
  chatListPresent: boolean;
  chatBody: { box: Box; display: string; hidden: boolean } | null;
  chainBody: {
    box: Box;
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
    box: Box;
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
  field: { present: boolean; value?: string; disabled?: boolean; placeholder?: string };
  chatField: { present: boolean; value?: string };
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

type Report = {
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
  states: Record<string, State>;
  screenshots: string[];
};

/**
 * The chain rig measures the real dock in a real Electron window, so it needs
 * the Vite dev server. With the server down the test skips; `npm run dev` in
 * another shell turns it on.
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

describe("chat dock chain view", () => {
  it("swaps the panel to the Life-Chain and logs into it", async (t) => {
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
    const {
      landing,
      chain,
      logged,
      entered,
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
    assert.equal(entered.createCalls.length, 2, "Enter did not log the second signal");

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
