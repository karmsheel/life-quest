import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buildInstructions } from "../electron/companion-client.ts";

/**
 * The automations shelf and its first automation, rendered by the real shell in
 * a real layout engine. The claims themselves live in
 * `e2e/automation.electron.mjs`, which drives the harness; this file runs that
 * driver and refuses a report that does not hold.
 *
 * The two things this rig exists to prove are not visually subtle: the four
 * governed icons are cordoned at the foot of the rail, and clicking Analyze note
 * on a long day opens a fresh chat whose hidden context carries the note from
 * first word to last. `buildInstructions` — the same function main uses on the
 * way to the gateway — is applied here to the captured turn, so "the agent is
 * told" is a claim about the real instruction text rather than about a field
 * that only the harness saw.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up.
 *
 * The artifact is `e2e/artifacts/automation.json` plus the two screenshots the
 * driver captures: the Automations page and the Daily Note with the analysis
 * chat open.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/automation.json");
const SHELF_SHOT = path.join(desktopRoot, "e2e/artifacts/automation.png");
const CHAT_SHOT = path.join(desktopRoot, "e2e/artifacts/automation-chat.png");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
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
      [path.join(desktopRoot, "e2e/automation.electron.mjs")],
      { cwd: desktopRoot, timeout: 150_000 },
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

type Link = {
  label: string | null;
  href: string | null;
  icon: boolean;
  active: boolean;
};
type Box = { top: number; bottom: number };
type Sample = {
  route: string | null;
  rail: {
    wing: Link[];
    shelf: Link[];
    footer: Link[];
    dividers: number;
    dividerRole: boolean;
    wingBox: Box | null;
    shelfBox: Box | null;
    footerBox: Box | null;
  };
  automations: {
    heading: string | null;
    groupTitle: string | null;
    rows: {
      name: string | null;
      description: string | null;
      action: string | null;
      actionHref: string | null;
      testId: string | null;
    }[];
  };
  note: {
    heading: string | null;
    day: string | null;
    analyze: { label: string | null; disabled: boolean } | null;
    bodyLength: number | null;
  };
  chat: {
    open: boolean;
    title: string | null;
    userMessages: string[];
  };
  sessionCalls: { id: string; title: string }[];
  chatCalls: {
    sessionId: string;
    input: string;
    instructionsContext: {
      pageContext?: { route: string; label: string; body: string } | null;
      automationContext?: string;
      aboutMe: string;
      locked: boolean;
      vaultOpen: boolean;
    };
  }[];
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    today: string;
    noteLength: number;
    skin: { name: string | null; applied: string | null };
    landing: Sample;
    dayPage: Sample;
    after: Sample;
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
  screenshots: string[];
};

describe("automations e2e", () => {
  it("cordons the governed shelf and feeds a whole Daily Note to a fresh chat", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SHELF_SHOT, { force: true });
    fs.rmSync(CHAT_SHOT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    const { landing, dayPage, after, today } = report.checks;

    // ── the shelf is its own cordoned group, above the Log ──────────────────
    assert.deepEqual(
      landing.rail.shelf.map((link) => link.label),
      ["Life-Chain", "Decisions", "Daily Note", "Automations"],
      "the governed shelf is not the four icons the operator named",
    );
    assert.deepEqual(
      landing.rail.shelf[3],
      {
        label: "Automations",
        href: "/automations",
        icon: true,
        active: true,
      },
      "Automations is not the active icon on its own route",
    );
    assert.ok(
      landing.rail.shelfBox && landing.rail.footerBox,
      "the rail did not draw the shelf and the Log",
    );
    assert.ok(
      landing.rail.dividerRole &&
        landing.rail.dividers === 2 &&
        landing.rail.shelfBox!.top >= landing.rail.wingBox!.bottom - 2 &&
        landing.rail.footerBox!.top >= landing.rail.shelfBox!.bottom - 2,
      "the shelf is not cordoned between two dividers, above the Log",
    );

    // ── the Automations page is one line, under Daily Note ──────────────────
    assert.equal(landing.automations.heading, "Automations");
    assert.equal(landing.automations.groupTitle, "Daily Note");
    assert.equal(
      landing.automations.rows.length,
      1,
      "the Automations page draws more than the one automation",
    );
    const row = landing.automations.rows[0]!;
    assert.equal(row.name, "Analyze note");
    assert.equal(row.testId, "automation-daily-note-analyze");
    assert.match(String(row.description), /Kanban/);
    assert.match(String(row.description), /goals/i);
    assert.match(String(row.actionHref), /\/notes$/);

    // ── the Daily Note's trigger and the chat it opens ──────────────────────
    assert.equal(dayPage.note.heading, "Daily Note");
    assert.equal(dayPage.note.analyze?.label, "Analyze note");
    assert.equal(
      dayPage.note.analyze?.disabled,
      false,
      "the trigger is disabled while a note is on screen",
    );
    assert.ok(
      report.checks.noteLength > 4000,
      "the seeded note was not longer than the page-context budget",
    );

    assert.equal(after.sessionCalls.length, 1, "the run created more than one chat");
    const expectedTitle = `Analyze note · ${new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(new Date(`${today}T00:00:00Z`))
      .replace(",", "")}`;
    assert.equal(after.sessionCalls[0]!.title, expectedTitle);
    assert.equal(after.chat.open, true, "the dock did not open on the new chat");
    assert.equal(after.chat.title, expectedTitle, "the dock is not showing the new chat");
    assert.equal(after.chat.userMessages.length, 1);
    assert.match(after.chat.userMessages[0]!, /Break down the Daily Note/);
    assert.match(after.chat.userMessages[0]!, /Kanban/);
    assert.match(after.chat.userMessages[0]!, /goals at different timeframes/);
    assert.match(after.chat.userMessages[0]!, /personal and project details/);

    const call = after.chatCalls[0]!;
    assert.equal(call.sessionId, after.sessionCalls[0]!.id);
    assert.match(call.input, /tasks/i);
    assert.match(call.input, /goals/i);
    assert.match(call.input, /details/i);
    assert.doesNotMatch(
      call.input,
      /Context note 1:/,
      "the visible prompt pasted the note instead of pointing at the context",
    );
    const context = call.instructionsContext.automationContext ?? "";
    assert.match(context, /DAILY NOTE AUTOMATION — ANALYZE NOTE/);
    assert.match(context, /--- DAILY NOTE \(/);
    assert.match(context, /--- END DAILY NOTE ---/);
    assert.match(context, /^Friday: a long day, and a lot of it belongs somewhere else in LifeQuest\./m);
    assert.match(context, /Context note 1:/);
    assert.match(context, /Context note 55:/);
    assert.match(
      context,
      /Last line: the tail of the note must reach the agent's context/,
    );
    assert.ok(
      context.length > report.checks.noteLength - 200,
      `the automation context (${context.length}) is shorter than the note (${report.checks.noteLength}) — the note was not fed whole`,
    );
    assert.match(context, /Kanban board/);
    assert.match(context, /Goals at different timeframes/);
    assert.match(context, /Personal, contextual and project details/);
    assert.equal(call.instructionsContext.pageContext?.route, "/notes");

    // ── the real instructions main builds carry the note ────────────────────
    // The same function the chat handler uses; applying it to the captured turn
    // closes the gap between "the renderer sent a field" and "the agent is told".
    const instructions = buildInstructions(call.instructionsContext);
    assert.match(instructions, /DAILY NOTE AUTOMATION — ANALYZE NOTE/);
    assert.match(instructions, /Context note 55:/);
    assert.match(
      instructions,
      /Last line: the tail of the note must reach the agent's context/,
    );

    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    assert.equal(fs.existsSync(SHELF_SHOT), true, "driver captured no Automations page");
    assert.equal(fs.existsSync(CHAT_SHOT), true, "driver captured no analysis chat");
    assert.deepEqual(
      report.screenshots.sort(),
      [CHAT_SHOT, SHELF_SHOT].sort(),
      "the driver did not write both screenshots",
    );
  });
});
