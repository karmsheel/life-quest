/**
 * The dock's tab strip survive an app restart.
 *
 * The rig (`e2e/chat-tabs-restore.electron.mjs`) is run twice as two real
 * Electron processes over one profile: a seed run that opens three chats as tabs
 * and quits, then a verify run that launches the profile again and reads what
 * the dock landed on. This wrapper asserts both reports, so a skipped, silently
 * broken or half-run driver cannot pass.
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
const REPORT = path.join(
  desktopRoot,
  "e2e/artifacts/chat-tabs-restore.json",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");

type Tab = { label: string; active: boolean };

type State = {
  surface: string | null;
  heading: string;
  tabs: Tab[];
  tabCount: number;
  /** Whether the dock's tab strip band is drawn at all. */
  strip: boolean;
  thread: boolean;
  /** The blank "Ask Hermes" slate the thread shows with no chat in front. */
  emptySlate: string;
  railLabels: string[];
  messageCalls: string[];
  stored: string | null;
};

type Report = {
  phase: string;
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

function runDriver(phase: "seed" | "verify"): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [
        path.join(desktopRoot, "e2e/chat-tabs-restore.electron.mjs"),
        `--phase=${phase}`,
      ],
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

function readReport(): Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
}

const labels = (state: State) => state.tabs.map((tab) => tab.label);
const active = (state: State) =>
  state.tabs.find((tab) => tab.active)?.label ?? null;

function readStored(state: State): { tabs: string[]; activeId: string | null } {
  assert.notEqual(state.stored, null, "the profile stored no tab strip");
  return JSON.parse(state.stored as string) as {
    tabs: string[];
    activeId: string | null;
  };
}

describe("the dock's tab strip across a restart", () => {
  it("brings every open chat back in the same order, with the same tab in front", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });

    const seedCode = await runDriver("seed");
    assert.equal(fs.existsSync(REPORT), true, "the seed run wrote no report");
    const seed = readReport();
    assert.deepEqual(seed.failures, [], "the seed run reported failures");
    assert.equal(seedCode, 0, "the seed run exited non-zero");
    assert.equal(seed.pass, true);
    assert.ok(seed.states.seeded, "the seed run reported no seeded state");
    assert.deepEqual(
      labels(seed.states.seeded),
      ["Alpha planning", "Bravo budget", "Charlie retro"],
      "the seed run did not leave three tabs open",
    );
    assert.equal(
      active(seed.states.seeded),
      "Alpha planning",
      "the seed run did not leave the first tab in front",
    );
    assert.deepEqual(
      readStored(seed.states.seeded).activeId,
      "chat-alpha",
      "the seed run did not remember the front tab",
    );

    const verifyCode = await runDriver("verify");
    assert.equal(fs.existsSync(REPORT), true, "the verify run wrote no report");
    const report = readReport();
    assert.equal(verifyCode, 0, "the verify run exited non-zero");
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);

    const {
      restored,
      second,
      third,
      neighbour,
      oneLeft,
      blankChat,
      closed,
      relaunch,
    } = report.states;

    // The reported bug: only the last chat came back. All three come back, in
    // their tab order, with the one the operator left in front still in front.
    assert.deepEqual(labels(restored), [
      "Alpha planning",
      "Bravo budget",
      "Charlie retro",
    ]);
    assert.deepEqual(restored.tabs.map((tab) => tab.active), [true, false, false]);
    assert.equal(active(restored), "Alpha planning");
    assert.equal(restored.heading, "Alpha planning", "the heading names another chat");
    assert.equal(restored.surface, "thread");
    assert.equal(restored.tabCount, 3, "the restored strip is not drawn");
    assert.equal(
      restored.messageCalls.includes("chat-alpha"),
      true,
      "the front chat's transcript was never read",
    );
    assert.deepEqual(readStored(restored), {
      tabs: ["chat-alpha", "chat-bravo", "chat-charlie"],
      activeId: "chat-alpha",
    });

    // A restored tab is a tab like any other: clicking it moves the thread and
    // the remembered front tab follows the last click.
    assert.equal(active(second), "Bravo budget");
    assert.equal(second.heading, "Bravo budget");
    assert.equal(active(third), "Charlie retro");
    assert.equal(readStored(third).activeId, "chat-charlie");

    // The chat archived while the app was shut loses its tab; the tab that was
    // beside it in the strip takes the front.
    assert.deepEqual(labels(neighbour), ["Alpha planning", "Bravo budget"]);
    assert.equal(active(neighbour), "Bravo budget");
    assert.equal(neighbour.heading, "Bravo budget");
    assert.equal(
      neighbour.railLabels.includes("Charlie retro"),
      false,
      "the archived chat is still listed",
    );
    assert.deepEqual(readStored(neighbour), {
      tabs: ["chat-alpha", "chat-bravo"],
      activeId: "chat-bravo",
    });

    // Archiving the front chat closes its tab and hands the front to the other
    // one, staying on the thread. Archiving the last open chat opens a blank New
    // chat — neither leaves the thread for a history page. Deleting the last
    // chat is the gesture that empties the strip deliberately.
    assert.deepEqual(readStored(oneLeft), {
      tabs: ["chat-alpha"],
      activeId: "chat-alpha",
    });
    assert.equal(
      oneLeft.railLabels.includes("Bravo budget"),
      false,
      "the archived chat is still listed",
    );
    assert.equal(
      oneLeft.surface,
      "thread",
      "archiving the front chat fell back to the history list",
    );
    assert.equal(oneLeft.heading, "Alpha planning");
    assert.equal(
      blankChat.tabCount,
      1,
      "the blank New chat did not draw its one tab",
    );
    assert.equal(
      labels(blankChat)[0],
      "New chat",
      "the blank New chat's tab is not the chat on screen",
    );
    assert.equal(
      blankChat.surface,
      "thread",
      "archiving the last open chat fell back to the history list",
    );
    assert.equal(blankChat.heading, "New chat");
    const blankStored = readStored(blankChat);
    assert.equal(blankStored.tabs.length, 1, "the blank New chat was not remembered");
    assert.equal(blankStored.activeId, blankStored.tabs[0]);
    assert.equal(closed.tabCount, 0);
    assert.equal(closed.strip, false, "an empty strip band was left drawn");
    assert.equal(
      closed.surface,
      "thread",
      "deleting the last chat left the thread for a history page",
    );
    assert.equal(
      closed.emptySlate,
      "Ask Hermes",
      "the dock did not show its blank slate after the strip emptied",
    );
    assert.equal(closed.heading, "Chat");
    assert.deepEqual(readStored(closed), { tabs: [], activeId: null });

    // A closed strip stays closed through another restart, and no chat is
    // resumed over it.
    assert.equal(relaunch.tabCount, 0);
    assert.equal(relaunch.strip, false, "the relaunch drew an empty strip band");
    assert.equal(
      relaunch.surface,
      "thread",
      "a closed strip landed on a history page instead of the blank slate",
    );
    assert.equal(
      relaunch.emptySlate,
      "Ask Hermes",
      "a closed strip did not restore the dock's blank slate",
    );
    assert.equal(relaunch.heading, "Chat");
    assert.deepEqual(relaunch.messageCalls, []);
    assert.deepEqual(readStored(relaunch), { tabs: [], activeId: null });

    // The pictures are the rig's own capturePage of the shipped shell, and they
    // exist on disk for the operator to open later.
    for (const name of [
      "chat-tabs-restore-seeded.png",
      "chat-tabs-restore-restored.png",
      "chat-tabs-restore-neighbour.png",
      "chat-tabs-restore-blank-chat.png",
      "chat-tabs-restore-closed.png",
    ]) {
      assert.equal(
        fs.existsSync(path.join(ARTIFACTS, name)),
        true,
        `the rig captured no ${name}`,
      );
    }
    assert.deepEqual(report.screenshots, [
      "chat-tabs-restore-restored.png",
      "chat-tabs-restore-neighbour.png",
      "chat-tabs-restore-blank-chat.png",
      "chat-tabs-restore-closed.png",
    ]);
  });
});
