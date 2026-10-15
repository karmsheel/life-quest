import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALL_TOOL_DEFS,
  createVault,
  dailyNotesInWindow,
  executeDailyNoteTool,
  formatLocalIsoDate,
  getDailyNote,
  getPeriodPack,
  isValidLocalIsoDate,
  listDailyNotes,
  periodBounds,
  shiftLocalIsoDate,
  todayLocalIso,
  weekStartOnOrBefore,
  writeDailyNote,
} from "@lifequest/vault-core";
import { formatReviewContext } from "../electron/review-sessions.ts";

/**
 * Daily Note, end to end, against a real vault on disk.
 *
 * This is one run of the whole product path behind the page: the operator's note
 * is written by the same `writeDailyNote` the IPC handler calls, lands as a real
 * markdown file, and is then read back by the two things that are supposed to
 * read it — a Review's period pack (and the companion instruction payload built
 * from that pack) and the companion's own read-only tools.
 *
 * The window is a week in the PAST, four weeks back. A note cannot be written for
 * a day that has not happened, so a rig pinned to the current week could only
 * write its first day: on a Tuesday, Wednesday's note is refused. A past week is
 * wholly writable on every day of the year, which is what makes the window
 * assertions deterministic rather than a function of when the suite ran.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), so it
 * needs no Electron and no dev server: vault-core is plain Node, and
 * `review-sessions.ts`'s `formatReviewContext` is the real function the main
 * process uses to put a pack in front of Hermes.
 *
 * The render half of the same feature — that the rail carries the icon under
 * Decisions and that the page writes a day — is the `daily-note-ui` rig, which
 * needs a real layout engine and a dev server.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. Two files for one day — a second write creating a sibling instead of
 *     editing the day's one file. This is the whole "one note for the day" rule.
 *  2. The note landing anywhere but `notes/daily/{YYYY-MM-DD}.md` — a nested
 *     directory, a different root, a name that is not the date.
 *  3. The body mangled by the frontmatter round trip: a heading, a `---` rule, or
 *     a trailing newline changed on the way to disk or back.
 *  4. `createdAt` reset by every save, so a day's note looks newly made each time.
 *  5. The writer's answer and the next read's answer disagreeing about the same
 *     note, which would make the page's dirty flag lie.
 *  6. An out-of-window note leaking into a review pack — a review reading a day it
 *     did not cover.
 *  7. An in-window note missing from the pack — the review silently losing a day
 *     the operator wrote.
 *  8. The companion never seeing the notes: the pack carrying them while the
 *     instruction payload that actually reaches Hermes does not.
 *  9. A tool surface that can write a note. The operator is the only author.
 * 10. A malformed date accepted, putting a note on a filename that is not a day.
 * 11. A missing `notes/daily/` read as a failure instead of an empty journal —
 *     the fresh-vault case, which is every vault before its first note.
 * 12. A stray file counted as a note, or a real note skipped.
 * 13. An empty note stored, so a review has to interpret a day with no prose.
 * 14. A note written for a day that has not happened.
 * 15. The window/limit filters on the agent's list tool ignored.
 * 16. An artifact written by a failing run. Failures throw, so the artifact only
 *     exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/daily-note-engine.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** Read a directory's file names, or [] when it does not exist. */
function fileNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe("daily note e2e", () => {
  it("stores one note per day, and a review reads the window back", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-daily-note-"));
    const vaultRoot = path.join(workDir, "vault");
    const notesDir = path.join(vaultRoot, "notes", "daily");
    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "Daily Note Rig");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);

    // ── 1. a fresh vault has no journal, and that is not a failure ───────────
    const fresh = await listDailyNotes(vaultRoot);
    assert.equal(fresh.ok, true, "a vault with no notes/ directory must read as empty");
    assert.deepEqual(fresh.ok ? fresh.value : null, [], "a fresh vault reported notes");
    checks.freshVaultIndex = fresh.ok ? fresh.value : null;

    // The window: a week wholly in the past, so every day in it is writable.
    const today = todayLocalIso();
    const pastMonday = weekStartOnOrBefore(shiftLocalIsoDate(today, -28)!, "monday");
    const bounds = periodBounds("weekly", pastMonday, "monday");
    assert.equal(bounds.ok, true, "the past week has no bounds");
    if (!bounds.ok) return;
    const { start, end } = bounds.value;

    const dayA = start;
    const dayB = shiftLocalIsoDate(start, 2)!;
    const dayC = end;
    const handEdited = shiftLocalIsoDate(start, 4)!;
    const beforeWeek = shiftLocalIsoDate(start, -1)!;
    const afterWeek = shiftLocalIsoDate(start, 7)!;
    const emptyDay = shiftLocalIsoDate(start, -2)!;
    const futureDay = shiftLocalIsoDate(today, 1)!;
    for (const date of [today, dayA, dayB, dayC, handEdited, beforeWeek, afterWeek, emptyDay, futureDay]) {
      assert.ok(isValidLocalIsoDate(date), `the rig built a bad date: ${date}`);
    }
    assert.ok(afterWeek < today, "the rig's out-of-window week is not in the past");
    assert.ok(futureDay > today, "the rig's future day is not in the future");
    checks.dates = { today, start, end, dayA, dayB, dayC, handEdited, beforeWeek, afterWeek, emptyDay, futureDay };

    // ── 2. the first write: one file, at the date's own path ─────────────────
    const bodyA = "# Monday\n\nA quiet start.\n\n---\n\nSlept badly, walked anyway.";
    const first = await writeDailyNote(vaultRoot, { date: dayA, bodyMarkdown: bodyA });
    assert.equal(first.ok, true, `the first write failed: ${first.ok ? "" : first.error}`);
    const notePath = path.join(notesDir, `${dayA}.md`);
    assert.equal(fs.existsSync(notePath), true, `no note at ${notePath}`);
    checks.fileForDay = path.relative(vaultRoot, notePath).replace(/\\/g, "/");
    checks.filesAfterFirstWrite = fileNames(notesDir);
    assert.deepEqual(
      checks.filesAfterFirstWrite,
      [`${dayA}.md`],
      "the first write did not leave exactly one file for the day",
    );

    // The file's own text: frontmatter for the date, then the body, unchanged.
    const raw = fs.readFileSync(notePath, "utf8");
    assert.match(raw, new RegExp(`^---\\ndate: ${dayA}\\n`), "the file does not open with its own date");
    assert.match(raw, /createdAt: "?\d{4}-\d{2}-\d{2}T/, "the file carries no createdAt");
    assert.match(raw, /updatedAt: "?\d{4}-\d{2}-\d{2}T/, "the file carries no updatedAt");
    assert.ok(raw.includes(bodyA), "the body did not survive the round trip to disk");
    checks.rawFile = raw;

    // ── 3. a second write edits that one file: still one file, new body ──────
    const rewritten = `${bodyA}\n\nAdded later: the walk helped.`;
    const second = await writeDailyNote(vaultRoot, { date: dayA, bodyMarkdown: rewritten });
    assert.equal(second.ok, true, `the second write failed: ${second.ok ? "" : second.error}`);
    checks.filesAfterSecondWrite = fileNames(notesDir);
    assert.deepEqual(
      checks.filesAfterSecondWrite,
      [`${dayA}.md`],
      "a second write to the same day created a second file",
    );
    if (second.ok && first.ok) {
      assert.equal(second.value.createdAt, first.value.createdAt, "the second write reset createdAt");
      assert.ok(second.value.updatedAt >= first.value.updatedAt, "updatedAt went backwards");
      checks.createdAtPreserved = second.value.createdAt === first.value.createdAt;
    }

    const readBack = await getDailyNote(vaultRoot, dayA);
    assert.equal(readBack.ok, true, "the day just written could not be read back");
    if (readBack.ok && second.ok) {
      // What the writer reported and what the next reader sees are one string:
      // no second spelling of the same note for the page to disagree with.
      assert.equal(
        readBack.value.bodyMarkdown,
        second.value.bodyMarkdown,
        "the body read back differs from the body the write reported",
      );
      assert.equal(
        readBack.value.bodyMarkdown.trimEnd(),
        rewritten.trimEnd(),
        "the operator's prose changed on the way to disk and back",
      );
      assert.equal(readBack.value.date, dayA, "the note read back under the wrong date");
      checks.bodyRoundTrip = readBack.value.bodyMarkdown;
    }

    // ── 4. the rest of the window, and days outside it on both sides ────────
    for (const [date, body] of [
      [dayB, "Tuesday: shipped the Daily Note."],
      [dayC, "Sunday: rested."],
      [beforeWeek, "Last week — must not appear in this week's review."],
      [afterWeek, "Next week — out of this week's window too."],
      [today, "Today: the ordinary case, written on the day itself."],
    ] as const) {
      const written = await writeDailyNote(vaultRoot, { date, bodyMarkdown: body });
      assert.equal(written.ok, true, `writing ${date} failed: ${written.ok ? "" : written.error}`);
    }

    // ── 4a. the future is closed at the storage layer ───────────────────────
    const futureWrite = await writeDailyNote(vaultRoot, {
      date: futureDay,
      bodyMarkdown: "Tomorrow — must not be written at all.",
    });
    checks.futureWriteRefused = futureWrite.ok ? null : futureWrite.error;
    assert.equal(futureWrite.ok, false, "a note was written for a day in the future");
    assert.match(String(checks.futureWriteRefused), /future day/);
    assert.equal(
      fs.existsSync(path.join(notesDir, `${futureDay}.md`)),
      false,
      "a refused future write still created a file",
    );

    // ── 4b. an empty note is refused, so a day has exactly two states ───────
    // A day is either a note with the operator's prose or no note at all. The
    // write path refuses an empty body, so there is no third state for a review
    // or the agent to interpret.
    const empty = await writeDailyNote(vaultRoot, { date: emptyDay, bodyMarkdown: "   \n\n" });
    checks.emptyWriteRefused = empty.ok ? null : empty.error;
    assert.equal(empty.ok, false, "an empty note was accepted");
    assert.match(String(checks.emptyWriteRefused), /needs something written/);
    assert.equal(
      fs.existsSync(path.join(notesDir, `${emptyDay}.md`)),
      false,
      "a refused empty write still created a file",
    );

    // ── 4c. files the studio did not write ──────────────────────────────────
    // A day emptied by hand: on disk, in the index, never in a review.
    fs.writeFileSync(
      path.join(notesDir, `${handEdited}.md`),
      `---\ndate: ${handEdited}\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n`,
    );
    // A day in the future, written by hand: on disk, in the index, and never in a
    // review — a period may be reviewed before it ends, and a review must not be
    // handed a day that has not happened.
    fs.writeFileSync(
      path.join(notesDir, `${futureDay}.md`),
      `---\ndate: ${futureDay}\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nTomorrow, by hand.\n`,
    );
    // A file that names no real day, and a file that is not a note at all.
    fs.writeFileSync(path.join(notesDir, "2026-02-31.md"), "not a real day\n");
    fs.writeFileSync(path.join(notesDir, "scratch.md"), "not a daily note\n");
    checks.filesOnDisk = fileNames(notesDir);

    const index = await listDailyNotes(vaultRoot);
    assert.equal(index.ok, true, "the index failed after the extra files");
    const indexDates = index.ok ? index.value.map((entry) => entry.date) : [];
    checks.indexDates = indexDates;
    // Every day on disk, oldest first, plus the file that *looks* like a note but
    // names no real day. That one stays visible as a row with an error rather
    // than being silently hidden: it is a file on disk, and the studio reports
    // what is on disk. `scratch.md` is not a note at all and has no row.
    assert.deepEqual(
      indexDates,
      ["2026-02-31", beforeWeek, dayA, dayB, handEdited, dayC, afterWeek, today, futureDay].sort(),
      "the index is not the days on disk plus the unusable look-alike",
    );
    assert.equal(indexDates.includes("scratch"), false, "a stray file was counted as a note");
    const indexErrors = index.ok
      ? index.value.filter((entry) => entry.error).map((entry) => entry.date)
      : [];
    checks.indexErrors = indexErrors;
    assert.deepEqual(
      indexErrors,
      ["2026-02-31"],
      "the file naming a non-existent day was not reported as an error row",
    );
    const goodRow = index.ok ? index.value.find((entry) => entry.date === dayA) : undefined;
    assert.ok(goodRow?.updatedAt, "a readable note was indexed without its updatedAt");
    assert.equal(goodRow?.error, undefined, "a readable note was indexed with an error");

    // ── 5. the review query: exactly the window, oldest first, with bodies ───
    const windowNotes = await dailyNotesInWindow(vaultRoot, { start, end });
    assert.equal(windowNotes.ok, true, "the window query failed");
    const windowDates = windowNotes.ok ? windowNotes.value.map((note) => note.date) : [];
    checks.windowDates = windowDates;
    assert.deepEqual(
      windowDates,
      [dayA, dayB, dayC],
      "the window query is not exactly the days inside the week that have prose",
    );

    // A day that is not a day never reaches a review, even in a window that would
    // otherwise cover it: February's pack must not carry 31 February.
    const february = await dailyNotesInWindow(vaultRoot, {
      start: "2026-02-01",
      end: "2026-02-28",
    });
    assert.equal(february.ok, true, "the February window query failed");
    checks.februaryWindowDates = february.ok ? february.value.map((n) => n.date) : null;
    assert.deepEqual(checks.februaryWindowDates, [], "an unusable date leaked into a review window");

    // A window that covers a day that has not happened does not carry it: the
    // current week may be reviewed before it ends, and a review must not be
    // handed a day in its own future.
    const throughTomorrow = await dailyNotesInWindow(vaultRoot, {
      start: today,
      end: futureDay,
    });
    checks.throughTomorrowDates = throughTomorrow.ok
      ? throughTomorrow.value.map((note) => note.date)
      : null;
    assert.deepEqual(
      checks.throughTomorrowDates,
      [today],
      "a day that has not happened was handed to a review",
    );

    const pack = await getPeriodPack(vaultRoot, {
      cadence: "weekly",
      period: pastMonday,
      scope: "overall",
    });
    assert.equal(pack.ok, true, `getPeriodPack failed: ${pack.ok ? "" : pack.error}`);
    if (!pack.ok) return;
    checks.packNoteDates = pack.value.dailyNotes.map((note) => note.date);
    checks.packMissingSources = pack.value.missingSources;
    checks.packTruncated = pack.value.truncated;
    assert.deepEqual(
      checks.packNoteDates,
      [dayA, dayB, dayC],
      "the weekly pack did not carry exactly the week's notes",
    );
    assert.equal(
      pack.value.missingSources.includes("daily-notes"),
      false,
      "the pack reported the journal as a missing source",
    );
    assert.ok(
      pack.value.dailyNotes[0]!.bodyMarkdown.includes("the walk helped"),
      "the pack carried the day's date but not the operator's latest text",
    );

    // A daily review is one day: its pack carries that day and nothing else —
    // including today's own note, the ordinary case.
    const dayPack = await getPeriodPack(vaultRoot, {
      cadence: "daily",
      period: dayB,
      scope: "overall",
    });
    assert.equal(dayPack.ok, true, "the daily pack failed");
    checks.dailyPackNoteDates = dayPack.ok ? dayPack.value.dailyNotes.map((n) => n.date) : null;
    assert.deepEqual(
      checks.dailyPackNoteDates,
      [dayB],
      "a daily review's pack did not carry exactly its own day",
    );
    const todayPack = await getPeriodPack(vaultRoot, {
      cadence: "daily",
      period: today,
      scope: "overall",
    });
    checks.todayPackNoteDates = todayPack.ok ? todayPack.value.dailyNotes.map((n) => n.date) : null;
    assert.deepEqual(
      checks.todayPackNoteDates,
      [today],
      "today's own note is not in today's pack",
    );

    // ── 6. the companion actually receives them ─────────────────────────────
    // The pack above is the same object `buildBoundReviewContext` serializes into
    // the instructions Hermes gets on every turn of a review session.
    const context = formatReviewContext({ kind: "review", pack });
    checks.companionContextBytes = context.length;
    assert.ok(
      context.includes("Tuesday: shipped the Daily Note."),
      "the companion's review instructions do not carry the operator's notes",
    );
    assert.equal(
      context.includes("Last week — must not appear"),
      false,
      "the companion's instructions leaked a note from outside the period",
    );

    // ── 7. the agent's surface: read-only, and honest about what it returns ──
    const toolNames = ALL_TOOL_DEFS.map((def) => def.name);
    checks.toolNames = toolNames.filter((name) => name.includes("daily_note"));
    assert.ok(toolNames.includes("list_daily_notes"), "list_daily_notes is not registered");
    assert.ok(toolNames.includes("get_daily_note"), "get_daily_note is not registered");
    assert.equal(
      toolNames.some((name) => /write|create|delete|update/.test(name) && name.includes("daily_note")),
      false,
      "a daily-note write tool is registered; the operator is the only author",
    );

    const listed = (await executeDailyNoteTool(vaultRoot, ACTOR, "list_daily_notes", {})) as {
      days?: { date: string; updatedAt: string | null }[];
      total?: number;
      truncated?: boolean;
      unreadable?: string[];
      future?: string[];
    };
    checks.listToolDays = listed.days?.map((entry) => entry.date);
    checks.listToolUnreadable = listed.unreadable;
    checks.listToolFuture = listed.future;
    assert.deepEqual(
      listed.unreadable,
      ["2026-02-31"],
      "the agent's list did not report the unusable look-alike as unreadable",
    );
    assert.deepEqual(
      listed.future,
      [futureDay],
      "the agent's list did not report the hand-written future day separately",
    );
    // Newest first, and only the days the operator has actually written: a day
    // that has not happened is reported, not handed over as a note.
    assert.deepEqual(
      checks.listToolDays,
      [today, beforeWeek, dayA, dayB, handEdited, dayC, afterWeek].sort().reverse(),
      "list_daily_notes is not newest first, or lost a day",
    );
    assert.equal(
      Object.keys(listed.days?.[0] ?? {}).includes("bodyMarkdown"),
      false,
      "the list tool returned bodies; that is get_daily_note's job",
    );

    const windowed = (await executeDailyNoteTool(vaultRoot, ACTOR, "list_daily_notes", {
      start,
      end,
      limit: 2,
    })) as { days?: { date: string }[]; total?: number; truncated?: boolean };
    checks.listToolWindow = {
      dates: windowed.days?.map((e) => e.date),
      total: windowed.total,
      truncated: windowed.truncated,
    };
    assert.deepEqual(
      windowed.days?.map((e) => e.date),
      [dayC, handEdited],
      "the windowed list is not the newest two days inside the window",
    );
    assert.equal(windowed.total, 4, "the windowed list lost its true total");
    assert.equal(windowed.truncated, true, "the windowed list did not report its own truncation");

    const got = (await executeDailyNoteTool(vaultRoot, ACTOR, "get_daily_note", {
      date: dayB,
    })) as { found?: boolean; note?: { bodyMarkdown: string } };
    checks.getTool = got.found;
    assert.equal(got.found, true, "get_daily_note did not find a day that has a note");
    assert.equal(
      got.note?.bodyMarkdown.trimEnd(),
      "Tuesday: shipped the Daily Note.",
      "get_daily_note returned the wrong body",
    );

    const missing = (await executeDailyNoteTool(vaultRoot, ACTOR, "get_daily_note", {
      date: "2001-01-01",
    })) as { found?: boolean; note?: unknown; error?: unknown };
    checks.getToolMissing = missing;
    assert.equal(missing.found, false, "a day with no note was not reported as unwritten");
    assert.equal(missing.error, undefined, "a day with no note was reported as an error");

    const malformed = (await executeDailyNoteTool(vaultRoot, ACTOR, "get_daily_note", {
      date: "2026-02-31",
    })) as { error?: { code: string } };
    checks.getToolMalformed = malformed.error?.code ?? null;
    assert.equal(malformed.error?.code, "MALFORMED", "a non-existent day was accepted as a note date");

    // ── 8. the day's label, as the page shows it ─────────────────────────────
    checks.label = formatLocalIsoDate(dayA);
    assert.match(String(checks.label), /^\d{1,2} [A-Z][a-z]{2} \d{4}$/, "the day label is not operator-facing");

    // ── the artifact ────────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what: "one note per day at notes/daily/{date}.md, and a weekly review pack reads exactly its window",
      command: "npm test  (this file: tests/daily-note-e2e.test.ts)",
      vault: vaultRoot,
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
