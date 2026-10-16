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
 * The feature this rig is about is an *absence* as much as a presence: the day
 * writes itself, so there is no Save control, and the page's own chrome — the
 * earlier-notes rows and the corners of its buttons — is the page's rather than
 * the engine's.
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

/** One row of the journal strip: its three cells, and the day it stands for. */
type Row = {
  text: string;
  date: string | null;
  weekday: string | null;
  edited: string | null;
  isoDate: string | null;
  link: boolean;
  current: boolean;
};
type Link = { label: string; href: string | null; icon: boolean; active: boolean };
/** A write to the vault, with the day the page was showing when it made it. */
type Write = { date: string; body: string; shown: string | null };
type Corners = { radius: number; height: number; background: string };
type Chrome = {
  saveControls: number;
  statusLine: boolean;
  step: number;
  pager: Corners[];
  history: Corners[];
  historyListStyle: string | null;
  historyHead: string[];
  historyHeadingSize: number | null;
  historyRowSize: number | null;
};
type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};
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

/** What one read of the page's DOM reports. Only the fields this file asserts. */
type Sample = {
  day: string | null;
  dayDate: string | null;
  body: string | null;
  status: string | null;
  chrome: Chrome;
  writes: number;
  nextDisabled: boolean | null;
  prevDisabled: boolean | null;
  todayButton: boolean;
  error: string | null;
  rows: Row[];
  boxes: number;
  splits: number;
  previews: number;
  writingLines: number;
  blockCount: number;
  rendering: number;
  editing: boolean;
  inputValue: string | null;
  inputPlaceholder: string | null;
  placeholders: number;
  strong: string | null;
  renderedText: string | null;
  showsMarkers: boolean | null;
  boxRect: Box | null;
  inputRect: Box | null;
  renderedRect: Box | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    today: string;
    yesterday: string;
    twoBack: string;
    tomorrow: string;
    farDay: string;
    farDayYear: string;
    rail: Link[];
    landing: Sample;
    emptyParagraphs: Sample;
    box: { boxes: number; splits: number; previews: number; writingLines: number };
    afterTyping: Sample;
    afterWriting: Sample;
    openedParagraph: Sample;
    afterEnter: Sample;
    afterThirdParagraph: Sample;
    afterSave: Sample;
    idleWrites: { before: number; after: number };
    previousDay: Sample;
    emptyDay: Sample;
    afterClearedDraft: Sample;
    clearRefused: Sample;
    afterClearAttempt: string | null;
    afterRefusedLeave: Sample;
    writeFailed: Sample;
    dayHeld: Sample;
    writeRecovered: Sample;
    backToToday: Sample;
    refusedWrite: Sample;
    refusedQuiet: { before: number; after: number };
    afterRetry: Sample;
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
  it("writes the day on its own in one box, under Decisions in the rail", async (t) => {
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

    const { today, yesterday, twoBack, tomorrow, farDay, farDayYear } = report.checks;

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

    // ── the page's chrome is the page's, not the engine's ───────────────────
    // Four things the operator named and this rig can measure: a Save control
    // that should not be there, corners rounded past the design's own step into a
    // pill, earlier-notes rows painting the platform's button fill behind the
    // list's bullets, and a heading over those rows that is a step larger.
    const chrome = report.checks.landing.chrome;
    assert.equal(chrome.saveControls, 0, "the page draws a save control");
    assert.equal(chrome.statusLine, true, "the page draws no autosave status line");
    assert.ok(chrome.step > 0, "the design's --radius-xs step could not be read");
    assert.ok(chrome.pager.length > 0, "the day pager drew no buttons to measure");
    assert.ok(chrome.history.length > 0, "the strip of earlier notes drew no day to measure");
    for (const button of [...chrome.pager, ...chrome.history]) {
      assert.ok(
        button.radius <= chrome.step,
        `a button is rounded to ${button.radius}px, past the ${chrome.step}px step — a pill`,
      );
    }
    assert.equal(chrome.historyListStyle, "none", "the earlier-notes list carries bullet markers");
    for (const row of chrome.history) {
      assert.equal(
        row.background,
        "rgba(0, 0, 0, 0)",
        `an earlier-notes row paints ${row.background} at rest instead of nothing`,
      );
    }

    // ── the strip is a table of three columns ───────────────────────────────
    // The date the note is *for*, that date's weekday, and when it was last
    // written — under a heading that stands a step over the rows it heads.
    assert.equal(chrome.historyHead.length, 3, "the strip does not head three columns");
    assert.ok(
      (chrome.historyHeadingSize ?? 0) > (chrome.historyRowSize ?? 0),
      `the "Earlier notes" heading is ${chrome.historyHeadingSize}px over ${chrome.historyRowSize}px rows — not larger`,
    );
    const strip = report.checks.landing.rows;
    assert.ok(strip.length > 0, "the strip listed no day at all");
    const weekdays = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    for (const row of strip) {
      assert.ok(row.isoDate, `a row names no day: ${JSON.stringify(row.text)}`);
      assert.ok(row.date, `the row for ${row.isoDate} has no date cell`);
      assert.ok(row.weekday, `the row for ${row.isoDate} has no day cell`);
      assert.ok(row.edited, `the row for ${row.isoDate} has no last-edited cell`);
      if (!row.link) {
        // A file that names no usable day: reported where it sits, with no weekday
        // to claim and nothing to open.
        assert.equal(row.weekday, "—", `the unreadable row ${row.isoDate} claims a weekday`);
        continue;
      }
      // The Day column is recomputed from the row's own date rather than trusted:
      // a weekday drawn from the wrong day cannot pass this.
      assert.equal(
        row.weekday,
        weekdays[new Date(`${row.isoDate}T00:00:00`).getDay()],
        `the row for ${row.isoDate} names the wrong weekday`,
      );
    }
    // The last-edited column is the note's own stamp, not a date the page made up:
    // the far day was seeded from another year, which today's clock cannot reach.
    const farRow = strip.find((row) => row.isoDate === farDay);
    assert.ok(farRow, `the far day (${farDay}) is missing from the strip`);
    assert.match(
      String(farRow!.edited),
      new RegExp(farDayYear),
      `the last-edited column reads ${JSON.stringify(farRow!.edited)} for a note stamped ${farDayYear}`,
    );

    // ── landing: today, empty, and nothing written ──────────────────────────
    const landing = report.checks.landing;
    assert.match(String(landing.day), /^Today · \w+day, \d{1,2} \w{3} \d{4}$/);
    assert.equal(landing.dayDate, today, "the page did not land on today");
    assert.equal(landing.body, "", "today's editor did not open empty");
    assert.equal(landing.status, "No note for this day yet");
    assert.equal(landing.writes, 0, "landing on a day wrote it without anything being typed");
    assert.equal(landing.nextDisabled, true, "the future is reachable from today");
    assert.equal(landing.prevDisabled, false);

    // One box. Not a split editor with a preview beside it, not two surfaces:
    // one editor, no second column, and one writing line open at a time.
    assert.equal(report.checks.box.boxes, 1, "the page does not draw exactly one editor box");
    assert.equal(report.checks.box.splits, 0, "the split editor grid is still on the page");
    assert.equal(report.checks.box.previews, 0, "a preview pane is still on the page");
    assert.equal(report.checks.box.writingLines, 1, "the box did not open exactly one writing line");
    assert.equal(landing.editing, true, "an empty day did not open its writing line");
    assert.equal(landing.inputValue, "");
    // An empty page is an invitation because the caret is already in it. It says
    // nothing: no placeholder text on the writing line, and none in the box.
    assert.equal(landing.inputPlaceholder, "", "the writing line carries a placeholder");
    assert.equal(landing.placeholders, 0, "an empty day printed a placeholder");

    // ── a blank paragraph is blank, however many there are ──────────────────
    // Two more blank lines used to repeat the placeholder twice. Nothing is
    // printed, and opening a line is not writing a note.
    const blanks = report.checks.emptyParagraphs;
    assert.equal(blanks.placeholders, 0, "a blank paragraph printed the page's placeholder");
    assert.equal(blanks.renderedText ?? "", "", `an empty note painted ${JSON.stringify(blanks.renderedText)}`);
    assert.equal(blanks.inputPlaceholder, "", "the open blank paragraph carries a placeholder");
    assert.equal(blanks.writes, 0, "opening blank paragraphs wrote the day");

    // ── autosave: the first write is made with nothing pressed ──────────────
    // The claim is about an absence, so it is read off the bridge's own ledger:
    // a write exists that no click and no key produced.
    const typing = report.checks.afterTyping;
    assert.equal(typing.status, "Saving…", "typing did not put the day on its way to the vault");
    assert.match(
      String(typing.inputValue),
      /\*\*Live preview\*\*/,
      "the writing line does not hold the note's own markdown",
    );
    assert.equal(typing.boxes, 1, "writing opened a second editor");
    assert.equal(
      typing.rendering,
      0,
      "the note rendered while it was still being written on one line",
    );

    const first = report.checks.firstWrite;
    assert.equal(first.length, 1, `the first autosave made ${first.length} write(s)`);
    assert.equal(first[0]!.date, today, "the first autosave wrote a day other than today");
    assert.equal(first[0]!.shown, first[0]!.date, "the first autosave wrote a day off screen");
    assert.match(String(first[0]!.body), /^Rig day: wrote the note/);
    assert.match(String(first[0]!.body), /\*\*Live preview\*\*/);

    // Live preview. The operator's markdown is what reaches the file, and the box
    // shows the prose it renders to — bold span, no markers, in the same box.
    const written = report.checks.afterWriting;
    assert.equal(written.blockCount, 2, "the note did not settle into two paragraphs");
    assert.equal(written.editing, false, "the writing line stayed open");
    assert.equal(written.strong, "Live preview", "the bold span did not render");
    assert.equal(written.showsMarkers, false, "raw markdown is painted in the box");
    assert.match(String(written.renderedText), /Rig day: wrote the note/);
    assert.doesNotMatch(
      String(written.renderedText),
      /\*\*/,
      "the box painted the asterisks the file holds",
    );

    // Opening a paragraph shows *that* paragraph's markdown and leaves the rest
    // as prose, in the column the prose held: one box, one surface, edited in
    // place rather than beside.
    const opened = report.checks.openedParagraph;
    assert.equal(
      opened.inputValue,
      "**Live preview**: the box renders as it is written.",
      "the opened paragraph is not its own markdown",
    );
    assert.equal(opened.writingLines, 1, "more than one writing line opened");
    assert.equal(
      opened.rendering,
      1,
      "opening one paragraph did not leave the other rendered",
    );
    assert.match(String(opened.renderedText), /Rig day: wrote the note/);
    assert.equal(
      opened.inputRect?.left,
      opened.renderedRect?.left,
      "the writing line opened in a column of its own beside the prose",
    );
    assert.ok(
      (opened.inputRect?.left ?? 0) >= (opened.boxRect?.left ?? 0),
      "the writing line escaped the box",
    );

    // Enter starts the next paragraph in the same box — the blank line markdown
    // needs is the editor's business, not the operator's — and that paragraph
    // reaches the vault the same way the first one did, with nothing pressed.
    assert.equal(report.checks.afterEnter.blockCount, 3, "Enter did not start a paragraph");
    assert.equal(report.checks.afterEnter.inputValue, "", "Enter opened a paragraph with text in it");
    const threeUp = report.checks.afterThirdParagraph;
    assert.equal(threeUp.blockCount, 3);
    assert.equal(threeUp.rendering, 3, "a paragraph did not render");
    assert.match(String(threeUp.renderedText), /A third paragraph/);
    assert.match(
      String(report.checks.writes[1]?.body),
      /A third paragraph, written after Enter\./,
      "the paragraph written after Enter never reached the vault",
    );

    // And an idle page writes nothing. The failure mode of an autosave is a write
    // storm, so the ledger is read twice with no operator and no change between.
    assert.deepEqual(
      report.checks.idleWrites,
      { before: report.checks.idleWrites.before, after: report.checks.idleWrites.before },
      `an untouched page wrote ${report.checks.idleWrites.after - report.checks.idleWrites.before} more time(s) on its own`,
    );

    // The write settles: the file's own body is in the editor and the day is
    // listed, so the page never disagrees with the file it just wrote.
    assert.equal(report.checks.afterSave.status, "Saved");
    assert.ok(
      report.checks.afterSave.rows.some((row) => row.text.startsWith("Today")),
      "the day just written is missing from the journal strip",
    );

    // ── a day that already has a note loads it ─────────────────────────────
    const previous = report.checks.previousDay;
    assert.equal(previous.dayDate, yesterday, "Prev day did not open yesterday");
    assert.equal(previous.body?.trimEnd(), "Yesterday: a walk, then the rig.");
    assert.equal(previous.status, "Saved");
    assert.equal(
      previous.editing,
      false,
      "a day that already has a note opened its writing line instead of reading as prose",
    );

    // ── a draft typed and cleared leaves the day as it was ──────────────────
    // Autosave is a timer, not a keystroke: "I changed my mind" must not write.
    assert.equal(report.checks.emptyDay.body, "", "an empty day was not empty");
    assert.equal(report.checks.emptyDay.placeholders, 0, "an empty day printed a placeholder");
    const clearedDraft = report.checks.afterClearedDraft;
    assert.equal(clearedDraft.body, "", "a draft typed and cleared stayed on the page");
    assert.equal(clearedDraft.status, "No note for this day yet");
    assert.equal(
      clearedDraft.writes,
      report.checks.emptyDay.writes,
      "a draft typed and cleared before the page wrote still reached the vault",
    );

    // ── a refused clear keeps the draft and the file, and does not trap ────
    // A refusal is the vault's answer, not a loss: the day's file is untouched, so
    // there is nothing on screen worth holding the operator for.
    const cleared = report.checks.clearRefused;
    assert.equal(cleared.body, "", "the cleared draft was not kept as the operator left it");
    assert.equal(cleared.status, "Not saved", "a refused day did not report itself as unsaved");
    assert.match(String(cleared.error), /needs something written/);
    assert.match(
      String(report.checks.afterClearAttempt),
      /Yesterday: a walk/,
      "a refused clear emptied the day on disk anyway",
    );
    assert.equal(
      report.checks.afterRefusedLeave.dayDate,
      twoBack,
      "the page would not let the operator leave a day the vault had merely refused",
    );
    assert.equal(
      report.checks.afterRefusedLeave.error,
      null,
      "a refusal followed the operator off the day it was refused on",
    );
    // ── a write that fails is not an answer, so the day is held ────────────
    // The other half of the same rule. A dropped bridge leaves nobody knowing what
    // reached the disk, so the one case where leaving could lose prose is the one
    // case where leaving is refused — until Ctrl+S lands the write.
    assert.match(
      String(report.checks.writeFailed.error),
      /dropped/,
      `a dropped write was not reported: ${JSON.stringify(report.checks.writeFailed.error)}`,
    );
    assert.match(String(report.checks.writeFailed.body), /^Two days back: the bridge dropped/);
    assert.equal(
      report.checks.dayHeld.dayDate,
      twoBack,
      "the page left a day whose write had failed, with nobody knowing what was on disk",
    );
    assert.match(String(report.checks.dayHeld.body), /^Two days back: the bridge dropped/);
    assert.match(String(report.checks.writeRecovered.body), /^Two days back: the bridge dropped/);
    assert.equal(report.checks.writeRecovered.error, null);
    assert.equal(report.checks.writeRecovered.status, "Saved");

    // ── the future is closed, the unusable day is text rather than a link ──
    const back = report.checks.backToToday;
    assert.equal(back.dayDate, today);
    assert.equal(back.nextDisabled, true);
    assert.match(String(back.body), /Rig day: wrote the note/);
    assert.match(String(back.body), /Live preview: the box renders as it is written\./);
    // What the vault kept is markdown, while what the box painted is prose: the
    // file's own body and the page's own rendering are two readings of one note.
    assert.match(
      String(report.checks.journal[today]),
      /\*\*Live preview\*\*/,
      "the day's file does not hold the markdown the operator wrote",
    );
    assert.match(
      String(report.checks.journal[yesterday]),
      /^Yesterday: a walk, then the rig\./,
      "a refused clear changed the day it was refused on",
    );
    assert.equal(
      back.rows.some((row) => row.isoDate === tomorrow),
      false,
      "a future-dated note was offered in the journal strip",
    );
    const unreadable = back.rows.find((row) => row.link === false);
    assert.ok(unreadable, "the unusable day was not reported as unreadable");
    assert.equal(unreadable!.weekday, "—", "the unusable day claimed a weekday");
    assert.match(String(unreadable!.edited), /unreadable/);

    // ── a refused write keeps the draft, and stops asking by itself ────────
    const refusedWrite = report.checks.refusedWrite;
    assert.match(String(refusedWrite.error), /refused/);
    assert.match(String(refusedWrite.body), /^Rig day: the vault refused/);
    assert.equal(
      refusedWrite.status,
      "Not saved",
      "a day the vault refused did not report itself as unsaved",
    );
    assert.deepEqual(
      report.checks.refusedQuiet,
      { before: report.checks.refusedQuiet.before, after: report.checks.refusedQuiet.before },
      `the page retried a body the vault had refused ${
        report.checks.refusedQuiet.after - report.checks.refusedQuiet.before
      } more time(s)`,
    );
    // Ctrl+S is the operator asking again, and it lands.
    assert.match(String(report.checks.afterRetry.body), /^Rig day: the vault refused/);
    assert.equal(report.checks.afterRetry.error, null, "the refusal stayed on screen");
    assert.equal(report.checks.afterRetry.status, "Saved");

    // ── the whole ledger ────────────────────────────────────────────────────
    // Every write this run made names the day the page was showing when it made
    // it: prose carried onto another date is the one way an autosave loses a day,
    // and this is the only place that can see all of them at once.
    const writes = report.checks.writes;
    assert.deepEqual(
      writes.filter((write) => write.shown !== write.date),
      [],
      "a write landed on a day the page was not showing",
    );
    assert.equal(writes[0]!.date, today, "the run's first write was not today's own autosave");
    assert.match(String(writes[0]!.body), /^Rig day: wrote the note/);
    // The only writes to yesterday are the two refused attempts to empty it: the
    // page never wrote prose the operator did not type on that day.
    const yesterdays = writes.filter((write) => write.date === yesterday);
    assert.ok(yesterdays.length > 0, "no write ever reached yesterday");
    for (const write of yesterdays) {
      assert.equal(write.body.trim(), "", `a write to yesterday carried prose: ${JSON.stringify(write.body)}`);
    }
    // The last two are the refusal and the Ctrl+S that answered it.
    assert.match(String(writes[writes.length - 2]?.body), /^Rig day: the vault refused/);
    assert.match(String(writes[writes.length - 1]?.body), /^Rig day: the vault refused/);

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
