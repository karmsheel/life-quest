import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { vaultPaths } from "./paths.ts";
import { isValidLocalIsoDate, todayLocalIso } from "./period.ts";
import type { DailyNote, DailyNoteIndexEntry, Result } from "./types.ts";

/**
 * Daily notes — the operator's journal, one markdown file per local date.
 *
 * The vault is the source of truth, so a note is a plain file at
 * `notes/daily/{YYYY-MM-DD}.md`, git-friendly like the reviews beside it. The
 * date is the identity twice over: it is the filename *and* the frontmatter
 * `date`, so "one note for the day" is structural rather than a rule the writer
 * has to remember. A second write to the same date edits that one file; it never
 * creates a sibling.
 *
 * The filename wins on read. A hand-edited `date:` that disagrees with its own
 * filename cannot make the note claim another day's window in a review pack.
 *
 * Failures are `Result`s and reads never create anything: a missing note is
 * "Daily note not found", which every caller reads as an empty day rather than
 * as an I/O problem. A note that cannot be parsed is still readable as a body —
 * `createdAt` falls back — because losing the operator's prose to a frontmatter
 * typo would be the worst outcome this module could produce. Writing is atomic.
 */

/** The one filename shape a daily note may have. */
export const DAILY_NOTE_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseDailyNote(raw: string, date: string): DailyNote {
  const { data, body } = parseFrontmatter(raw);
  const updatedAt =
    typeof data.updatedAt === "string" && data.updatedAt
      ? data.updatedAt
      : new Date().toISOString();
  const createdAt =
    typeof data.createdAt === "string" && data.createdAt ? data.createdAt : updatedAt;
  return { date, createdAt, updatedAt, bodyMarkdown: body };
}

function serializeDailyNote(note: DailyNote): string {
  return serializeFrontmatter(
    {
      date: note.date,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    note.bodyMarkdown,
  );
}

/**
 * A body in the one form the file holds it: no CRLF, no trailing blank space,
 * and — when there is prose — exactly one closing newline. A write reports the
 * body in this form, so the writer's answer and the next read's answer are the
 * same string rather than two spellings of one note.
 */
function canonicalBody(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** Read one day's note. A date with no file is `Daily note not found`. */
export async function getDailyNote(
  rootPath: string,
  date: string,
): Promise<Result<DailyNote>> {
  if (!isValidLocalIsoDate(date)) {
    return { ok: false, error: `Invalid daily note date: ${date}` };
  }
  try {
    const raw = await fs.readFile(vaultPaths(rootPath).dailyNoteMd(date), "utf8");
    return { ok: true, value: parseDailyNote(raw, date) };
  } catch (e) {
    if (isMissing(e)) return { ok: false, error: "Daily note not found" };
    return { ok: false, error: message(e) };
  }
}

/**
 * Write the note for `date`, creating it or editing the one file that day
 * already has. The first write stamps `createdAt`; every later write keeps it.
 *
 * Two rules the write path enforces, so neither a review nor the agent ever has
 * to interpret a strange day:
 *
 * - A note must have something written in it. An empty body is refused rather
 *   than stored, so a day has exactly two states — a note with the operator's
 *   prose, or no note. Removing a day is done by deleting its file, as it is for
 *   a review.
 * - A note cannot be written for a day that has not happened. A journal is
 *   written, not scheduled, and a review must never read a day in its future.
 *   Backfilling a past day is welcome; tomorrow is not.
 */
export async function writeDailyNote(
  rootPath: string,
  input: { date: string; bodyMarkdown: string },
): Promise<Result<DailyNote>> {
  if (!isValidLocalIsoDate(input.date)) {
    return { ok: false, error: `Invalid daily note date: ${input.date}` };
  }
  const today = todayLocalIso();
  if (input.date > today) {
    return {
      ok: false,
      error: `A daily note cannot be written for a future day: ${input.date}`,
    };
  }
  const body = canonicalBody(input.bodyMarkdown);
  if (body.trim() === "") {
    return {
      ok: false,
      error: "A daily note needs something written in it",
    };
  }
  try {
    const previous = await getDailyNote(rootPath, input.date);
    const now = new Date().toISOString();
    const note: DailyNote = {
      date: input.date,
      createdAt: previous.ok ? previous.value.createdAt : now,
      updatedAt: now,
      bodyMarkdown: body,
    };
    await atomicWriteFile(
      vaultPaths(rootPath).dailyNoteMd(note.date),
      serializeDailyNote(note),
    );
    return { ok: true, value: note };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * The dates that hold a note, oldest first. Missing `notes/daily/` is an empty
 * index, not a failure; a file that cannot be read is an index row with an
 * `error`, and is never overwritten on read.
 */
export async function listDailyNotes(
  rootPath: string,
): Promise<Result<DailyNoteIndexEntry[]>> {
  let names: string[];
  try {
    const entries = await fs.readdir(vaultPaths(rootPath).dailyNotesDir, {
      withFileTypes: true,
    });
    names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (e) {
    if (isMissing(e)) return { ok: true, value: [] };
    return { ok: false, error: message(e) };
  }

  const dates = names
    .map((name) => DAILY_NOTE_FILE.exec(name)?.[1])
    .filter((date): date is string => typeof date === "string")
    .sort();

  const index: DailyNoteIndexEntry[] = [];
  for (const date of dates) {
    const note = await getDailyNote(rootPath, date);
    index.push(
      note.ok
        ? { date, updatedAt: note.value.updatedAt }
        : { date, updatedAt: null, error: note.error },
    );
  }
  return { ok: true, value: index };
}

/**
 * The notes inside an inclusive date window, oldest first — the query a review
 * period makes. Only the days in the window are read, so a yearly review costs
 * its own year and not the whole journal.
 *
 * Two days are on disk but not in a review, because neither is a day the operator
 * wrote about:
 *
 * - A day whose body holds no prose. The write path refuses an empty body, so
 *   this is the hand-edited case.
 * - A day that has not happened. A period may be reviewed before it ends, and a
 *   review must never be handed a day in its own future.
 */
export async function dailyNotesInWindow(
  rootPath: string,
  window: { start: string; end: string },
): Promise<Result<DailyNote[]>> {
  if (!isValidLocalIsoDate(window.start) || !isValidLocalIsoDate(window.end)) {
    return {
      ok: false,
      error: `Invalid daily note window: ${window.start}…${window.end}`,
    };
  }
  const listed = await listDailyNotes(rootPath);
  if (!listed.ok) return listed;

  const today = todayLocalIso();
  const notes: DailyNote[] = [];
  for (const entry of listed.value) {
    if (entry.date < window.start || entry.date > window.end) continue;
    if (entry.date > today) continue;
    if (entry.error) continue;
    const note = await getDailyNote(rootPath, entry.date);
    if (note.ok && note.value.bodyMarkdown.trim() !== "") notes.push(note.value);
  }
  return { ok: true, value: notes };
}
