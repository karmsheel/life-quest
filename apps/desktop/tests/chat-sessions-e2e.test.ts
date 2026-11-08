/**
 * The chat-sessions harness page (`e2e/chat-sessions.{html,tsx}`) and the chain
 * rig that drives it (`e2e/chat-chain.electron.mjs`). The page used to have a
 * second driver for the dock's chat list; the dock no longer carries that list —
 * the whole history is the sidebar's — so the chain rig is the page's one
 * driver now.
 *
 * The driver is still its own Electron process writing its own artifact, so a
 * failure names the concern it belongs to.
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

/** RGB channels of a computed colour in 0–255, whatever syntax it resolved to. */
function channels(color: string | null): number[] {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  // `color(srgb …)` reports 0–1 floats while `rgb()`/`rgba()` report 0–255, so a
  // cross-syntax comparison would gap ~237 on two identical colours.
  return raw.length === 3 && raw.every((value) => value <= 1.0001)
    ? raw.map((value) => value * 255)
    : raw;
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

describe("chat sessions harness", () => {

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
    /** Which surface the dock is on: "thread" | "chain" | "shortcuts". */
    surface: string | null;
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
    actionsBar: ChainBox | null;
    actionsBarBackground: string | null;
    footerBackground: string | null;
    headerIconSize: number | null;
    actions: {
      label: string | null;
      pressed: boolean;
      disabled: boolean;
      opacity: number;
      iconSize: number;
      icon: string | null;
    }[];
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
        chainClosed,
        reread,
      } = report.states;
      const total = report.fixture.total;
      const liveRows = total + 2;

      assert.equal(landing.chainBody?.hidden, true, "the chain painted on landing");
      assert.equal(landing.signalListCalls, 0, "the chain was read before it was asked for");

      // The dock's bottom action bar: five slots in order, the chain second and
      // the shortcuts reference third. The history slot that used to lead the
      // bar is gone with the dock's list.
      const slots = [
        "New chat",
        "Quick Notes",
        "Keyboard shortcuts",
        "Move chat to the left of the page",
        "Collapse chat",
      ];
      assert.deepEqual(
        landing.actions.map((slot) => slot.label),
        slots,
        "the action bar lost a slot or changed its order",
      );
      assert.deepEqual(
        landing.actions.map((slot) => slot.disabled),
        [false, false, false, false, false],
        "an action slot is inert",
      );
      assert.deepEqual(
        landing.actions.map((slot) => slot.opacity),
        [1, 1, 1, 1, 1],
        "an action slot is dimmed",
      );
      assert.equal(
        new Set(landing.actions.map((slot) => slot.icon)).size,
        slots.length,
        "two slots wear the same icon",
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
        landing.actionsBar !== null,
        `the action bar is missing: ${JSON.stringify(landing.actionsBar)}`,
      );
      assert.ok(
        Math.abs((landing.actionsBar?.bottom ?? 0) - landing.panel.bottom) <= 2,
        `the action bar does not ride the bottom edge: ${landing.actionsBar?.bottom}px vs ${landing.panel.bottom}px`,
      );
      assert.ok(
        channelDelta(landing.actionsBarBackground, landing.footerBackground) >= 8,
        `the action bar shares the composer's surface: ${landing.actionsBarBackground} vs ${landing.footerBackground}`,
      );
      assert.equal(landing.actions[1]?.label, "Quick Notes", "the chain slot is not the second slot");
      assert.equal(landing.actions[1]?.pressed, false, "the chain slot starts active");

      assert.equal(chain.heading, "Quick Notes", "the chain header names the wrong surface");
      assert.equal(chain.actions[1]?.pressed, true, "the chain slot is not marked active");
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

      assert.equal(
        chainClosed.surface,
        "thread",
        "the chain slot did not hand the surface back to the thread",
      );
      assert.equal(chainClosed.threadHeader, true, "leaving the chain left no thread up");
      assert.equal(chainClosed.chainBody?.hidden, true, "the chain stayed up behind the thread");
      assert.equal(
        chainClosed.signalListCalls,
        short.signalListCalls,
        "leaving the chain asked the vault for it again",
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
