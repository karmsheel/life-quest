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
 * The automations shelf and its jobs, rendered by the real shell in a real
 * layout engine. The claims themselves live in `e2e/automation.electron.mjs`,
 * which drives the harness; this file runs that driver and refuses a report that
 * does not hold.
 *
 * The rig covers the whole shelf: the cordoned rail, the built-in manual job,
 * creating a scheduled job through the editor, editing the built-in, deleting a
 * job, and a due schedule that runs once and records itself. It also proves the
 * Daily Note's manual button still opens a fresh chat with the whole note in
 * context and the new-tracking step in the prompt.
 *
 * `buildInstructions` — the same function main uses on the way to the gateway —
 * is applied here to the captured turn, so "the agent is told" is a claim about
 * the real instruction text rather than about a field only the harness saw.
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

type AutomationTrigger =
  | { type: "manual" }
  | {
      type: "schedule";
      frequency: "daily" | "weekly";
      time: string;
      weekday: number | null;
    };

type AutomationInput = {
  name: string;
  description: string;
  prompt: string;
  host: "daily-note" | "none";
  trigger: AutomationTrigger;
  enabled: boolean;
};

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
      { cwd: desktopRoot, timeout: 180_000 },
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
type Row = {
  testId: string | null;
  name: string | null;
  description: string | null;
  trigger: string | null;
  meta: string | null;
  badge: string | null;
  actions: string[];
  error: string | null;
};
type Group = { title: string | null; description: string | null; rows: number };
type Editor = {
  name: string | null;
  description: string | null;
  host: string | null;
  triggerManual: boolean;
  triggerSchedule: boolean;
  frequency: string | null;
  weekday: string | null;
  time: string | null;
  prompt: string | null;
  enabled: boolean | null;
};
type Sample = {
  route: string | null;
  rail: {
    wing: Link[];
    shelf: Link[];
    footer: Link[];
    dividers: number;
    dividerRole: boolean;
    wingBox: Box | null;
    firstWingBox: Box | null;
    topBarBox: Box | null;
    shelfBox: Box | null;
    footerBox: Box | null;
  };
  automations: {
    heading: string | null;
    groups: Group[];
    rows: Row[];
    editorOpen: boolean;
    editor: Editor | null;
  };
  note: {
    heading: string | null;
    day: string | null;
    automationButtons: string[] | null;
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
  createCalls: AutomationInput[];
  updateCalls: { id: string; input: AutomationInput }[];
  deleteCalls: string[];
  markCalls: { id: string; patch: { status?: string; sessionId?: string } }[];
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    today: string;
    noteLength: number;
    skin: { name: string | null; applied: string | null };
    landing: Sample;
    editor: Sample["automations"];
    created: Sample["automations"] & {
      createCalls: AutomationInput[];
    };
    edits: Sample["automations"] & {
      updateCalls: { id: string; input: AutomationInput }[];
    };
    deleted: Sample["automations"] & { deleteCalls: string[] };
    scheduled: Sample;
    dayPage: Sample;
    after: Sample;
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
  screenshots: string[];
};

describe("automations e2e", () => {
  it("creates, edits and schedules automations, and feeds a whole Daily Note to a fresh chat", async (t) => {
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

    const { landing, created, edits, deleted, scheduled, dayPage, after, today } =
      report.checks;

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
    assert.deepEqual(
      landing.rail.footer.map((link) => link.label),
      ["Log"],
      "the Log is not the footer's only row",
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
    assert.ok(
      landing.rail.firstWingBox &&
        landing.rail.topBarBox &&
        landing.rail.firstWingBox.top >= landing.rail.topBarBox.bottom,
      `the wing's first icon starts at ${landing.rail.firstWingBox?.top}px, above the top bar's bottom at ${landing.rail.topBarBox?.bottom}px`,
    );

    // ── the page groups by trigger type ─────────────────────────────────────
    assert.equal(landing.automations.heading, "Automations");
    assert.deepEqual(
      landing.automations.groups.map((group) => group.title),
      ["Manual 1", "Scheduled 0"],
      "the page did not group the built-in as the only manual job",
    );
    const builtIn = landing.automations.rows.find(
      (row) => row.testId === "automation-daily-note-analyze",
    );
    assert.ok(builtIn, "the built-in row is missing");
    assert.equal(builtIn!.trigger, "manual");
    assert.match(String(builtIn!.meta), /Manual/);
    assert.match(String(builtIn!.meta), /Daily Note/);
    assert.deepEqual(
      ["Run now", "Edit", "Pause", "Delete"].filter(
        (label) => !builtIn!.actions.some((action) => action.includes(label)),
      ),
      [],
      "the built-in row lost one of its actions",
    );

    // ── creating a scheduled job ────────────────────────────────────────────
    assert.equal(created.groups[1]?.title, "Scheduled 1");
    const createInput = created.createCalls[0]!;
    assert.equal(createInput.name, "Weekly review prep");
    assert.equal(createInput.host, "none");
    assert.deepEqual(createInput.trigger, {
      type: "schedule",
      frequency: "weekly",
      time: "23:59",
      weekday: 1,
    });
    assert.equal(createInput.enabled, true);
    const createdRow = created.rows.find(
      (row) => row.testId === "automation-automation-created-1",
    );
    assert.ok(createdRow, "the created row is not on the shelf");
    assert.equal(createdRow!.trigger, "schedule");
    assert.match(String(createdRow!.meta), /Scheduled/);
    assert.match(String(createdRow!.meta), /Mondays at 23:59/);
    assert.match(String(createdRow!.meta), /No page/);

    // ── editing the built-in ────────────────────────────────────────────────
    const update = edits.updateCalls[0]!;
    assert.equal(update.id, "daily-note-analyze");
    assert.deepEqual(update.input.trigger, { type: "manual" });
    assert.match(update.input.prompt, /propose the document, page or database/);
    assert.match(update.input.prompt, /no place for yet/);
    assert.ok(
      edits.rows.some(
        (row) =>
          row.testId === "automation-daily-note-analyze" &&
          /Edited: breaks the day down/.test(row.description ?? ""),
      ),
      "the edited description did not reach the shelf",
    );

    // ── deleting the new job leaves the built-in ────────────────────────────
    assert.deepEqual(deleted.deleteCalls, ["automation-created-1"]);
    assert.equal(deleted.rows.length, 1);
    assert.equal(deleted.rows[0]!.testId, "automation-daily-note-analyze");

    // ── a due schedule runs once, writes its run, and leaves the dock shut ──
    const scheduledChat = scheduled.chatCalls.find((call) =>
      call.input.includes("Sweep"),
    );
    assert.ok(
      scheduledChat,
      "the scheduled job did not run; chat calls were " +
        JSON.stringify(scheduled.chatCalls.map((call) => call.input.slice(0, 40))),
    );
    assert.match(scheduledChat!.input, /^Sweep \d{1,2} \w{3} \d{4}/);
    assert.match(
      scheduledChat!.instructionsContext.automationContext ?? "",
      /Context note 55:/,
    );
    const scheduledMark = scheduled.markCalls.find(
      (call) => call.id === "scheduled-sweep",
    );
    assert.ok(scheduledMark, "the scheduled run did not write its last run");
    assert.equal(scheduledMark!.patch.status, "succeeded");
    assert.ok(
      !String(scheduled.chat.title ?? "").startsWith("Scheduled sweep ·") &&
        !scheduled.chat.userMessages.some((message) =>
          message.startsWith("Sweep "),
        ),
      "a scheduled run opened its chat in the dock",
    );
    const scheduledRow = scheduled.automations.rows.find(
      (row) => row.testId === "automation-scheduled-sweep",
    );
    assert.ok(scheduledRow, "the scheduled row is missing");
    assert.match(String(scheduledRow!.meta), /Last run/);

    // ── the Daily Note's manual button still opens the chat ─────────────────
    assert.equal(dayPage.note.heading, "Daily Note");
    assert.deepEqual(
      dayPage.note.automationButtons,
      ["Analyze note", "Morning focus"],
      "the Daily Note did not draw a button for each manual job",
    );
    assert.equal(dayPage.note.analyze?.label, "Analyze note");
    assert.equal(
      dayPage.note.analyze?.disabled,
      false,
      "the trigger is disabled while a note is on screen",
    );

    const expectedTitle = `Analyze note · ${new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(new Date(`${today}T00:00:00Z`))
      .replace(",", "")}`;
    const session = after.sessionCalls.find((call) => call.title === expectedTitle);
    assert.ok(session, "the manual run did not create its chat");
    assert.equal(after.chat.open, true, "the dock did not open on the new chat");
    assert.equal(after.chat.title, expectedTitle, "the dock is not showing the new chat");
    assert.equal(after.chat.userMessages.length, 1);
    assert.match(after.chat.userMessages[0]!, /Analyze the Daily Note for/);
    assert.match(after.chat.userMessages[0]!, /Kanban board/);
    assert.match(after.chat.userMessages[0]!, /Goals at different timeframes/);
    assert.match(after.chat.userMessages[0]!, /no place for yet/);
    assert.match(
      after.chat.userMessages[0]!,
      /propose the document, page or database/,
    );

    const call = after.chatCalls.find((candidate) => candidate.sessionId === session.id)!;
    assert.ok(call, "the manual run did not send a turn");
    assert.equal(call.sessionId, session.id);
    const context = call.instructionsContext.automationContext ?? "";
    assert.match(context, /AUTOMATION — ANALYZE NOTE/);
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
    assert.equal(call.instructionsContext.pageContext?.route, "/notes");

    // ── the real instructions main builds carry the note ────────────────────
    const instructions = buildInstructions(call.instructionsContext);
    assert.match(instructions, /AUTOMATION — ANALYZE NOTE/);
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
