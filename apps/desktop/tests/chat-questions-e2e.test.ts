import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Saved chat questions, end to end.
 *
 * The rig behind this file is `e2e/chat-questions.electron.mjs`, driving the
 * harness page (`e2e/chat-questions.{html,tsx}`) in a real Electron window. The
 * settings page, the dock, the CSS and the layout engine are shipping code; the
 * IPC bridge is stubbed so the run is hermetic. The same driver also writes a
 * real throwaway vault through `updateSettings` and reads it back through
 * `openVault`, which is the half a browser stub cannot prove.
 *
 * The artifact is `e2e/artifacts/chat-questions.json` plus four screenshots. A
 * report only exists for a run that reached the end; the assertions below are
 * what make "the run reached the end" mean the feature works.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-questions.json");
const SCREENSHOTS = [
  "chat-questions-settings-empty.png",
  "chat-questions-settings-list.png",
  "chat-questions-starters-home.png",
  "chat-questions-sent.png",
  "chat-questions-starters-review.png",
  "chat-questions-sent-review.png",
];

const FINANCIAL = "How is my current expenditure tracking with my monthly budget?";
const HEALTH = "What are the top three health issues I have been hinting at?";
const REVIEW = "What did I avoid this week?";
const HOME_PAGE = "What changed on my dashboard today?";
const GLOBAL_EDITED = "What should I focus on this week, in one sentence?";

type QuestionRow = {
  id: string | null;
  text: string;
  scope: string;
  editing: boolean;
};

type Patch = {
  count: number | null;
  questions: { text: string; scope: string; value: string | null }[] | null;
};

type Starter = {
  id: string | null;
  text: string;
  scope: string;
  box: { width: number; height: number } | null;
};

type Call = {
  sessionId: string;
  input: string;
  pageRoute: string | null;
  domainSlug: string | null;
};

type State = {
  route: string | null;
  settingsView: string | null;
  settingsTitle: string;
  activeNav: string;
  navCount: number;
  questionCount: number;
  questions: QuestionRow[];
  error: string | null;
  patches: Patch[];
  streamCalls: Call[];
  starters: Starter[];
  messages: { role: string; text: string }[];
  emptyTitle: string | null;
  panel: { left: number; right: number; width: number; height: number } | null;
  composer: { width: number; height: number } | null;
  windowOverflow: { scrollWidth: number; clientWidth: number };
  panelOverflow: { scrollWidth: number; clientWidth: number } | null;
  state: { route: string; activeDomain: string | null; settings: Record<string, unknown> } | null;
};

type Check = { label: string; pass: boolean; detail: string | null };

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  states: Record<string, State>;
  screenshots: string[];
  persistence: {
    world: string;
    created: boolean;
    saved: boolean;
    reopened: boolean;
    loaded: { id: string; text: string; scope: string; value: string | null }[];
    refused: boolean;
  } | null;
};

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
      [path.join(desktopRoot, "e2e/chat-questions.electron.mjs")],
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

describe("saved chat questions", () => {
  it("writes questions under Settings and offers the right ones, ready to send, in a new chat", async (t) => {
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
    assert.deepEqual(
      report.checks.filter((check) => !check.pass),
      [],
      "the driver's own checks did not all hold",
    );

    const { landing, added, afterEdit, home, sent, review, goals, second } =
      report.states;

    // ── the settings section ────────────────────────────────────────────────
    assert.equal(landing.settingsView, "questions", "the Questions panel did not open");
    assert.equal(landing.settingsTitle, "Chat questions");
    assert.equal(landing.activeNav, "Questions");
    assert.ok(landing.navCount >= 9, `only ${landing.navCount} settings sections`);

    // ── add: text, scope, and the stored order ──────────────────────────────
    assert.deepEqual(
      added.questions.map((row) => row.text),
      [FINANCIAL, HEALTH, REVIEW, HOME_PAGE, "What should I focus on this week?"],
      "the saved list is not the questions the operator wrote",
    );
    assert.deepEqual(
      added.questions.map((row) => row.scope),
      ["Financial domain", "Health domain", "Review wing", "Dashboard page", "Everywhere"],
      "a scope was lost between the form and the list",
    );
    assert.equal(added.patches.length, 5, "each add must write settings once");
    assert.deepEqual(added.patches[0]?.questions?.[0], {
      text: FINANCIAL,
      scope: "domain",
      value: "financial",
    });
    assert.deepEqual(added.patches[2]?.questions?.[2], {
      text: REVIEW,
      scope: "wing",
      value: "review",
    });
    assert.deepEqual(added.patches[3]?.questions?.[3], {
      text: HOME_PAGE,
      scope: "page",
      value: "/home",
    });

    // ── edit and delete go back to the same store ───────────────────────────
    assert.equal(afterEdit.questions[4]?.text, GLOBAL_EDITED, "the edit did not land");
    assert.equal(afterEdit.questions[4]?.scope, "Everywhere");
    assert.equal(afterEdit.questions.length, 5, "delete left the list the wrong size");
    assert.equal(afterEdit.patches.length, 8, "edit and delete did not write settings");

    // ── the new chat on the Dashboard with the Financial lens ───────────────
    assert.equal(home.state?.activeDomain, "financial");
    assert.deepEqual(
      home.starters.map((row) => row.text),
      [FINANCIAL, HOME_PAGE, GLOBAL_EDITED],
      "the Financial/Dashboard chat offered the wrong questions",
    );
    assert.deepEqual(
      home.starters.map((row) => row.scope),
      ["Financial", "Dashboard page", "Everywhere"],
    );
    assert.ok(
      home.starters.every((row) => row.text !== HEALTH && row.text !== REVIEW),
      "a question from another domain or wing leaked in",
    );
    assert.ok(
      (home.starters[0]?.box?.height ?? 0) > 20,
      "a starter painted with no height to click",
    );

    // ── one click sends the question itself ─────────────────────────────────
    assert.equal(sent.streamCalls.length, 1, "the click did not send one turn");
    assert.equal(sent.streamCalls[0]?.input, FINANCIAL, "the wire got different text");
    assert.equal(sent.streamCalls[0]?.pageRoute, "/home");
    assert.equal(sent.streamCalls[0]?.domainSlug, "financial");
    assert.equal(sent.starters.length, 0, "the questions stayed up over the transcript");
    assert.ok(
      sent.messages.some((message) => message.role === "user" && message.text === FINANCIAL),
      "the sent question is not in the transcript",
    );

    // ── another wing and domain: a different set ────────────────────────────
    assert.equal(review.state?.activeDomain, "health");
    assert.deepEqual(
      review.starters.map((row) => row.text),
      [HEALTH, REVIEW, GLOBAL_EDITED],
      "the Health/Weekly chat offered the wrong questions",
    );
    assert.ok(
      review.starters.every((row) => row.text !== FINANCIAL && row.text !== HOME_PAGE),
      "a question from the previous page or domain followed the operator",
    );
    assert.equal(goals.starters.some((row) => row.text === REVIEW), false);
    assert.equal(goals.starters.some((row) => row.text === HEALTH), true);

    // ── the second one-click starts its own chat in its own context ─────────
    assert.equal(second.streamCalls.length, 2);
    assert.equal(second.streamCalls[1]?.input, REVIEW);
    assert.notEqual(
      second.streamCalls[1]?.sessionId,
      second.streamCalls[0]?.sessionId,
      "the second question joined the first chat",
    );
    assert.equal(second.streamCalls[1]?.pageRoute, "/review/weekly");
    assert.equal(second.streamCalls[1]?.domainSlug, "health");

    // ── the real vault can reopen what the settings writer stored ───────────
    const persistence = report.persistence;
    assert.ok(persistence, "the driver never ran the vault roundtrip");
    assert.equal(persistence.created, true, "the throwaway vault was not created");
    assert.equal(persistence.saved, true, "updateSettings refused valid questions");
    assert.equal(persistence.reopened, true, "openVault could not read the vault back");
    assert.deepEqual(
      persistence.loaded.map(({ text, scope, value }) => ({ text, scope, value })),
      [
        { text: FINANCIAL, scope: "domain", value: "financial" },
        { text: HOME_PAGE, scope: "page", value: "/home" },
      ],
      "the vault did not give the questions back unchanged",
    );
    assert.equal(persistence.refused, false, "a question with no target was written");

    // ── the artifact is the proof ───────────────────────────────────────────
    for (const name of SCREENSHOTS) {
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", name)),
        true,
        `the rig did not capture ${name}`,
      );
    }

    const table = [
      ["state", "route", "domain", "starters", "sent"],
      [
        "home",
        String(home.route),
        String(home.state?.activeDomain),
        String(home.starters.length),
        String(sent.streamCalls.length),
      ],
      [
        "review",
        String(review.route),
        String(review.state?.activeDomain),
        String(review.starters.length),
        String(second.streamCalls.length),
      ],
      [
        "goals",
        String(goals.route),
        String(goals.state?.activeDomain),
        String(goals.starters.length),
        "—",
      ],
    ];
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    for (const row of table) {
      console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
    }
  });
});
