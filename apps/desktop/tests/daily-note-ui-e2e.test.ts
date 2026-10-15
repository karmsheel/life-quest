import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Daily Note page and its rail entry, rendered by the real shell in a real
 * layout engine. The claims themselves live in `e2e/daily-note.electron.mjs`,
 * which drives the harness; this file runs that driver and refuses a report that
 * does not hold.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up.
 *
 * The artifact is `e2e/artifacts/daily-note.json` (plus the `.png` the driver
 * captures): same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/daily-note.json");
const SHOT = path.join(desktopRoot, "e2e/artifacts/daily-note.png");
const EDITING_SHOT = path.join(desktopRoot, "e2e/artifacts/daily-note-editing.png");
const PANEL_SHOT = path.join(desktopRoot, "e2e/artifacts/daily-note-panel.png");

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
      [path.join(desktopRoot, "e2e/daily-note.electron.mjs")],
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

type Row = { text: string; link: boolean; current: boolean };
type Link = { label: string; href: string | null; icon: boolean; active: boolean };
type Write = { date: string; body: string };
type PanelRow = {
  testId: string | null;
  label: string | null;
  excerpt: string | null;
  expanded: string | null;
  body: string | null;
};
type Panel = {
  heading: string | null;
  count: string | null;
  empty: string | null;
  rows: PanelRow[];
  noteLinks: (string | null)[];
  reviewPeriod: string | null;
  onFire: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    today: string;
    yesterday: string;
    rail: Link[];
    landing: {
      day: string | null;
      body: string | null;
      status: string | null;
      saveDisabled: boolean | null;
      nextDisabled: boolean | null;
      prevDisabled: boolean | null;
      rows: Row[];
      boxes: number;
      splits: number;
      previews: number;
      writingLines: number;
      editing: boolean;
      inputValue: string | null;
      inputPlaceholder: string | null;
    };
    box: {
      boxes: number;
      splits: number;
      previews: number;
      writingLines: number;
    };
    afterTyping: {
      status: string | null;
      saveDisabled: boolean | null;
      inputValue: string | null;
      boxes: number;
      rendering: number;
    };
    afterWriting: {
      blockCount: number;
      editing: boolean;
      strong: string | null;
      showsMarkers: boolean | null;
      renderedText: string | null;
    };
    openedParagraph: {
      inputValue: string | null;
      writingLines: number;
      rendering: number;
      renderedText: string | null;
      boxRect: { left: number; top: number; width: number; height: number } | null;
      inputRect: { left: number; top: number; width: number; height: number } | null;
      renderedRect: { left: number; top: number; width: number; height: number } | null;
    };
    afterEnter: { blockCount: number; inputValue: string | null };
    afterThirdParagraph: { blockCount: number; rendering: number; renderedText: string | null };
    afterSave: { status: string | null; body: string | null; saveDisabled: boolean | null; rows: Row[] };
    previousDay: { body: string | null; status: string | null; editing: boolean };
    emptyDay: { saveDisabled: boolean | null; status: string | null };
    clearRefused: { body: string | null; error: string | null };
    afterClearAttempt: string | null;
    backToToday: { nextDisabled: boolean | null; body: string | null; rows: Row[] };
    refusedWrite: { error: string | null; body: string | null };
    afterRetry: { body: string | null; error: string | null };
    writes: Write[];
    firstWrite: Write[];
    journal: Record<string, string>;
    panel: Panel;
    panelOpened: Panel;
    panelEmpty: Panel;
    panelWindow: { start: string; end: string };
    panelExpectedDays: string[];
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
};

describe("daily note ui e2e", () => {
  it("writes the day in one box that renders as it is written, under Decisions in the rail", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SHOT, { force: true });
    fs.rmSync(EDITING_SHOT, { force: true });
    fs.rmSync(PANEL_SHOT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // The rail: the entry is where the operator was told it would be, with an
    // icon, and it is the active link on /notes.
    assert.deepEqual(
      report.checks.rail.map((entry) => entry.label),
      ["Life-Chain", "Decisions", "Daily Note"],
      "the rail's top group is not Life-Chain, Decisions, Daily Note",
    );
    const note = report.checks.rail[2]!;
    assert.ok(
      (note.href ?? "").endsWith("/notes"),
      `the rail entry points at ${JSON.stringify(note.href)}`,
    );
    assert.equal(note.icon, true, "the Daily Note entry has no icon");
    assert.equal(note.active, true, "Daily Note is not the active rail link on /notes");
    assert.equal(report.checks.rail[1]!.label, "Decisions", "Daily Note is not directly under Decisions");

    // The page lands on today, empty and inert.
    assert.match(String(report.checks.landing.day), /^Today · \w+day, \d{1,2} \w{3} \d{4}$/);
    assert.equal(report.checks.landing.body, "", "today's editor did not open empty");
    assert.equal(report.checks.landing.status, "No note for this day yet");
    assert.equal(report.checks.landing.saveDisabled, true);
    assert.equal(report.checks.landing.nextDisabled, true, "the future is reachable from today");
    assert.equal(report.checks.landing.prevDisabled, false);

    // One box. Not a split editor with a preview beside it, not two surfaces:
    // one editor, no second column, and one writing line open at a time.
    assert.equal(report.checks.box.boxes, 1, "the page does not draw exactly one editor box");
    assert.equal(report.checks.box.splits, 0, "the split editor grid is still on the page");
    assert.equal(report.checks.box.previews, 0, "a preview pane is still on the page");
    assert.equal(report.checks.box.writingLines, 1, "the box did not open exactly one writing line");
    assert.equal(report.checks.landing.editing, true, "an empty day did not open its writing line");
    assert.equal(report.checks.landing.inputValue, "");
    assert.ok(report.checks.landing.inputPlaceholder, "the empty day carried no invitation to write");

    // Live preview. The operator's markdown is what reaches the file, and the box
    // shows the prose it renders to — bold span, no markers, in the same box.
    assert.deepEqual(
      report.checks.writes.map((write) => write.date),
      [report.checks.today, report.checks.yesterday, report.checks.today, report.checks.today],
      "a write landed on a day other than the one on screen",
    );
    assert.match(
      String(report.checks.afterTyping.inputValue),
      /\*\*Live preview\*\*/,
      "the writing line does not hold the note's own markdown",
    );
    assert.equal(report.checks.afterTyping.boxes, 1, "writing opened a second editor");
    assert.equal(
      report.checks.afterTyping.rendering,
      0,
      "the note rendered while it was still being written on one line",
    );
    assert.equal(report.checks.afterWriting.blockCount, 2, "the note did not settle into two paragraphs");
    assert.equal(report.checks.afterWriting.editing, false, "the writing line stayed open");
    assert.equal(report.checks.afterWriting.strong, "Live preview", "the bold span did not render");
    assert.equal(report.checks.afterWriting.showsMarkers, false, "raw markdown is painted in the box");
    assert.match(String(report.checks.firstWrite[0]!.body), /\*\*Live preview\*\*/);
    assert.doesNotMatch(
      String(report.checks.afterWriting.renderedText),
      /\*\*/,
      "the box painted the asterisks the file holds",
    );

    // Opening a paragraph shows *that* paragraph's markdown and leaves the rest
    // as prose, in the column the prose held: one box, one surface, edited in
    // place rather than beside.
    assert.equal(
      report.checks.openedParagraph.inputValue,
      "**Live preview**: the box renders as it is written.",
      "the opened paragraph is not its own markdown",
    );
    assert.equal(report.checks.openedParagraph.writingLines, 1, "more than one writing line opened");
    assert.equal(
      report.checks.openedParagraph.rendering,
      1,
      "opening one paragraph did not leave the other rendered",
    );
    assert.match(String(report.checks.openedParagraph.renderedText), /Rig day: wrote the note/);
    assert.equal(
      report.checks.openedParagraph.inputRect?.left,
      report.checks.openedParagraph.renderedRect?.left,
      "the writing line opened in a column of its own beside the prose",
    );
    assert.ok(
      (report.checks.openedParagraph.inputRect?.left ?? 0) >=
        (report.checks.openedParagraph.boxRect?.left ?? 0),
      "the writing line escaped the box",
    );

    // Enter starts the next paragraph in the same box — the blank line markdown
    // needs is the editor's business, not the operator's — and it writes nothing
    // until Save does.
    assert.equal(report.checks.afterEnter.blockCount, 3, "Enter did not start a paragraph");
    assert.equal(report.checks.afterEnter.inputValue, "", "Enter opened a paragraph with text in it");
    assert.equal(report.checks.afterThirdParagraph.blockCount, 3);
    assert.equal(report.checks.afterThirdParagraph.rendering, 3, "a paragraph did not render");
    assert.match(String(report.checks.afterThirdParagraph.renderedText), /A third paragraph/);

    // Four writes: today's save, yesterday's clear, the refused attempt on
    // today, and the retry. Every one of them landed on the day on screen.
    assert.equal(report.checks.firstWrite.length, 1, "the first save was not a single write");
    assert.match(report.checks.writes[0]!.body, /^Rig day: wrote the note/);
    assert.equal(report.checks.writes[1]!.body.trim(), "", "clearing a day wrote prose");
    assert.match(report.checks.writes[2]!.body, /^Rig day: the vault refused/);
    assert.match(report.checks.writes[3]!.body, /^Rig day: the vault refused/);

    // The save settles: the file's own body is in the editor, the day is listed.
    assert.match(String(report.checks.afterSave.status), /^Saved /);
    assert.equal(report.checks.afterSave.saveDisabled, true);
    assert.ok(
      report.checks.afterSave.rows.some((row) => row.text.startsWith("Today")),
      "the day just written is missing from the journal strip",
    );

    // A day that already has a note loads it. An empty day cannot be made to
    // hold an empty note — Save stays inert — and clearing a day that has prose
    // is refused with the reason, leaving both the draft and the file alone.
    assert.equal(
      report.checks.previousDay.body?.trimEnd(),
      "Yesterday: a walk, then the rig.",
    );
    assert.equal(report.checks.previousDay.status, "Saved");
    assert.equal(
      report.checks.previousDay.editing,
      false,
      "a day that already has a note opened its writing line instead of reading as prose",
    );
    assert.equal(
      report.checks.emptyDay.saveDisabled,
      true,
      "Save was live on an empty day with nothing typed",
    );
    assert.equal(report.checks.clearRefused.body, "");
    assert.match(String(report.checks.clearRefused.error), /needs something written/);
    assert.match(
      String(report.checks.afterClearAttempt),
      /Yesterday: a walk/,
      "a refused clear emptied the day on disk anyway",
    );

    // The future is closed, the unusable day is text rather than a link.
    assert.equal(report.checks.backToToday.nextDisabled, true);
    assert.match(String(report.checks.backToToday.day), /^Today/);
    // What the vault kept is markdown, while what the box painted is prose: the
    // file's own body and the page's own rendering are two readings of one note.
    assert.match(
      String(report.checks.journal[report.checks.today]),
      /\*\*Live preview\*\*/,
      "the day's file does not hold the markdown the operator wrote",
    );
    assert.match(
      String(report.checks.journal[report.checks.yesterday]),
      /^Yesterday: a walk, then the rig\./,
      "a refused clear changed the day it was refused on",
    );
    assert.equal(
      report.checks.backToToday.rows.some((row) => row.text.includes("Tomorrow")),
      false,
      "a future-dated note was offered in the journal strip",
    );
    const unreadable = report.checks.backToToday.rows.find((row) =>
      row.text.includes("unreadable"),
    );
    assert.ok(unreadable, "the unusable day was not reported as unreadable");
    assert.equal(unreadable!.link, false, "the unusable day was offered as a link");

    // A refused write keeps the draft; the retry lands it.
    assert.match(String(report.checks.refusedWrite.error), /refused/);
    assert.match(String(report.checks.refusedWrite.body), /^Rig day: the vault refused/);
    assert.match(String(report.checks.afterRetry.body), /^Rig day: the vault refused/);
    assert.equal(report.checks.afterRetry.error, null, "the refusal stayed on screen");

    // ── the Review page's panel ─────────────────────────────────────────────
    // The panel asked for the review's own period — a week, Monday first — and
    // listed exactly the journal days inside it, newest first.
    const { start, end } = report.checks.panelWindow;
    assert.equal(
      new Date(`${start}T00:00:00`).getDay(),
      1,
      `the panel asked for a week starting on ${start}, which is not a Monday`,
    );
    assert.equal(
      Math.round(
        (new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) /
          86_400_000,
      ),
      6,
      `the panel's window ran ${start}…${end}, which is not seven days`,
    );
    assert.equal(report.checks.panel.heading, "Daily notes in this period");
    assert.deepEqual(
      report.checks.panel.rows.map((row) => row.testId),
      report.checks.panelExpectedDays.map((date) => `review-note-${date}`),
      "the panel's days are not the period's days, newest first",
    );
    assert.ok(
      report.checks.panelExpectedDays.length > 0,
      "the panel was asserted against an empty period",
    );
    assert.equal(
      report.checks.panel.count,
      String(report.checks.panelExpectedDays.length),
      "the panel's count does not match the days it listed",
    );
    for (const row of report.checks.panel.rows) {
      assert.equal(row.expanded, "false", "a day arrived already open");
      assert.equal(row.body, null, "a collapsed day had already rendered its body");
      assert.ok(row.excerpt, "a collapsed day showed no excerpt");
    }
    assert.equal(report.checks.panel.onFire, null, "the review panel reported an error");

    // Opening one day renders that day's note, and only that day's.
    const open = report.checks.panelOpened.rows.filter((row) => row.expanded === "true");
    assert.equal(open.length, 1, `opening a day left ${open.length} days open`);
    assert.ok(open[0]!.body, "an opened day rendered no body");
    assert.equal(
      report.checks.panelOpened.rows.filter((row) => row.expanded !== "true" && row.body !== null)
        .length,
      0,
      "opening one day rendered another day's body",
    );

    // A period with no notes says so, and offers the way to the day's page.
    assert.equal(report.checks.panelEmpty.rows.length, 0, "an empty period listed days");
    assert.match(String(report.checks.panelEmpty.empty), /No daily notes in this period/);
    assert.ok(
      report.checks.panelEmpty.noteLinks.some((href) => (href ?? "").endsWith("/notes")),
      "the empty panel offered no way to the day's page",
    );

    // Nothing reached the bridge that this rig does not model, and the page
    // logged nothing while the note was being written.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    assert.equal(fs.existsSync(SHOT), true, "driver captured no screenshot");
    assert.equal(
      fs.existsSync(EDITING_SHOT),
      true,
      "driver captured no screenshot of the box with a paragraph open",
    );
    assert.equal(
      fs.existsSync(PANEL_SHOT),
      true,
      "driver captured no screenshot of the review panel",
    );
  });
});
