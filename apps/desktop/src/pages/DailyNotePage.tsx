import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatLocalIsoDate,
  formatLocalIsoDayMonth,
  isoWeekOf,
  periodTodayLocalIso,
  shiftLocalIsoDate,
  type IsoWeek,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
import { asHeld, sameNote } from "@/lib/note-body";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import type { DailyNoteIndexEntry } from "@lifequest/vault-core";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** How long the page waits after the last keystroke before it writes the day. */
const AUTOSAVE_DELAY_MS = 700;

/**
 * What a write came to.
 *
 * `refused` and `failed` are not the same thing, and the difference is whether
 * the operator may walk away from the day. The vault refusing a body is an
 * *answer* — it will never store this one, and the day's file is untouched — so
 * there is nothing left on screen worth holding the operator for. A write that
 * failed is not an answer: nobody knows what is on disk, so the day is held.
 */
type WriteOutcome = "saved" | "refused" | "failed";

/**
 * The weekday of a local ISO date, or null when the string is not a date. */
function weekdayOf(date: string): string | null {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return WEEKDAYS[parsed.getDay()] ?? null;
}

/**
 * When a note was last written, for the strip's own column.
 *
 * The stamp is read at the moment the page asks for the journal, so a day's row
 * moves the instant its own write lands — which is what makes the column worth
 * having next to the date the note is *for*.
 */
function formatEditedAt(updatedAt: string | null): string {
  if (!updatedAt) return "—";
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A week of earlier notes — its ISO week and the days it holds. */
type WeekGroup = IsoWeek & { entries: DailyNoteIndexEntry[] };

/**
 * The weekly toggle's label, e.g. `W36 (31 Aug - 6 Sep)`.
 *
 * The year is only appended when the week belongs to a different year from the
 * one the operator is living in: a journal read years later still names the week
 * it is actually in, while this year's weeks stay short enough to scan.
 */
function weekLabel(week: IsoWeek, currentYear: number): string {
  const year = week.year === currentYear ? "" : ` ${week.year}`;
  return `W${week.week} (${formatLocalIsoDayMonth(week.start)} - ${formatLocalIsoDayMonth(week.end)}${year})`;
}

/** The full range a weekly toggle covers, for the pointer's own tooltip. */
function weekTitle(week: IsoWeek): string {
  return `${formatLocalIsoDate(week.start)} – ${formatLocalIsoDate(week.end)}`;
}

/**
 * One note for the day.
 *
 * The date is the identity: the page edits exactly one markdown file,
 * `notes/daily/{date}.md`, and there is no "new note" control because a second
 * note for a day cannot exist. Today is the landing date; past days are open so
 * a day that got away can still be written, and the future is closed — a journal
 * is written, not scheduled, and a review must never read a day that has not
 * happened yet.
 *
 * There is no save control. The page writes the day on its own: shortly after the
 * operator stops typing, when the pointer leaves the box, and when the day is
 * left. Ctrl/Cmd+S is the same write, for the operator who asks anyway. So the
 * status line is the whole of the page's contract — "Saving…", then "Saved", or
 * the vault's own reason when it refuses.
 *
 * The vault is the source of truth, so a load overwrites the draft and a write
 * takes the file's own normalized body back — and *that* is only ever a different
 * note: the vault trims the whitespace at the end of a body, the box's own form
 * has already dropped it, and so the ordinary write answers with the note it was
 * sent. The page compares the two as notes rather than as strings for exactly that
 * reason: an autosave is not allowed to reach into the box while the operator is
 * paused mid-sentence, re-cut the paragraph under the caret, close the writing line
 * and take the caret with it (`sameNote`).
 *
 * A day with no note is an empty editor, not an error — and the page prints
 * nothing in it. An empty day is an invitation because the caret is already
 * there, not because the box is labelled; a blank paragraph is a blank line, and
 * a note with several of them is not a page of repeated instructions.
 *
 * Under the box — or beside it, once the page is wide enough — is the journal
 * itself: one row per day, newest first, each row the date the note is *for*,
 * that date's weekday, and the moment the note was last written. This week's rows
 * stay open; every earlier week folds under its own `W36 (31 Aug - 6 Sep)` toggle,
 * and the week holding the day on screen opens itself. A future-dated file is on
 * disk but is not offered — a note is written, not scheduled — and a file that
 * names no usable day is reported as unreadable where it sits, in the same three
 * columns, rather than as a link.
 *
 * The page centres its one column on the workspace, and the box opens at twice
 * the height of the studio's other note boxes: a day is written at length. A page
 * with room for both puts the strip beside the box, taking the edge away from the
 * chat dock — the strip goes left when the dock is right, and right when it is
 * left — so the note never sits under the companion's shadow.
 *
 * Leaving a day is gated on that day's own write *completing*. A write that fails
 * keeps the operator on the day they were writing, with the draft intact, because
 * nobody knows what reached the disk; a body the vault refuses does not, because
 * that is an answer rather than a loss — the day's file is untouched and the
 * refusal is on screen.
 *
 * The note is written in one box: `LiveMarkdownEditor` renders the day as prose
 * and opens the paragraph under the caret as its own markdown. There is no
 * second pane to keep in step, because there is no second surface at all — the
 * draft this page holds is the note, on every keystroke.
 */
export default function DailyNotePage() {
  const { snapshot } = useVault();
  const today = periodTodayLocalIso();

  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  /** The day whose body is in `draft`; null while a day is still on its way in. */
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The last body the vault refused, so the page stops asking by itself. */
  const [refused, setRefused] = useState<{ date: string; body: string } | null>(null);
  const [history, setHistory] = useState<DailyNoteIndexEntry[]>([]);
  /** The earlier weeks whose days are on screen; every other week is folded. */
  const [openWeeks, setOpenWeeks] = useState<string[]>([]);

  // A load for a day the operator has already left must not land in the editor.
  const loadToken = useRef(0);
  // Writes go through here one at a time, in the order the page asked for them,
  // so a day is never read before the write that belongs to it has landed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The newest draft that still has to reach the vault, tagged with its day.
  // Held in a ref rather than in state because a blur or an unmount flushes it
  // outside any render.
  const unsaved = useRef<{ date: string; body: string } | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const result = await api().dailyNoteList();
      if (result.ok) setHistory(result.value);
    } catch {
      // The history strip is a convenience; the editor is the page.
    }
  }, []);

  const loadDay = useCallback(async (target: string) => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api().dailyNoteGet(target);
      if (token !== loadToken.current) return;
      if (result.ok) {
        const body = asHeld(result.value.bodyMarkdown);
        setDraft(body);
        setSavedBody(body);
        setExists(true);
      } else if (/not found/i.test(result.error)) {
        setDraft("");
        setSavedBody("");
        setExists(false);
      } else {
        setError(result.error);
      }
      setLoadedDate(target);
    } catch (err) {
      if (token !== loadToken.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoadedDate(target);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(date);
  }, [date, loadDay]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /**
   * Write one day. Answers `saved` when the vault holds the body, `refused` when
   * the vault declined it, and `failed` when the write did not complete — the
   * caller decides whether it may move on.
   */
  const writeDay = useCallback(
    async (target: string, body: string): Promise<WriteOutcome> => {
      const run = async (): Promise<WriteOutcome> => {
        setSaving(true);
        try {
          const result = await api().dailyNoteWrite(target, body);
          if (!result.ok) {
            setError(result.error);
            setRefused({ date: target, body });
            return "refused";
          }
          setError(null);
          setRefused(null);
          setExists(true);
          // The file is the truth, and the box takes the body the vault actually
          // holds back only when the two really are different notes. They are the
          // same one after every ordinary write — the vault trims what `asHeld`
          // has already dropped — and handing that answer back to the box is not a
          // no-op: the box re-cuts a body it did not emit, so the paragraph under
          // the caret re-renders as prose, the writing line closes, and the caret
          // goes with it, mid-sentence, because the operator paused to think.
          const written = asHeld(result.value.bodyMarkdown);
          setSavedBody(written);
          setDraft((current) => {
            // A draft the operator has typed on since is theirs, not this write's
            // to overwrite — this write never saw those keystrokes.
            if (!sameNote(current, body)) return current;
            return sameNote(current, written) ? current : written;
          });
          await loadHistory();
          return "saved";
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setRefused({ date: target, body });
          return "failed";
        } finally {
          setSaving(false);
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [loadHistory],
  );

  /**
   * Write whatever is pending right now. The debounce, the blur, Ctrl+S and a day
   * change all land here, and a body the vault refused stays pending so the
   * operator can ask again rather than lose it.
   */
  const flush = useCallback(async (): Promise<WriteOutcome> => {
    // Whatever was asked for before is settled first, so this day's file is not
    // read while a write to it is still in the air.
    await queue.current;
    const job = unsaved.current;
    if (!job) return "saved";
    unsaved.current = null;
    const outcome = await writeDay(job.date, job.body);
    if (outcome !== "saved") unsaved.current = job;
    return outcome;
  }, [writeDay]);

  const onDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      setError(null);
      // Recorded here rather than in the effect below, so a blur that beats the
      // next paint still finds the draft it has to save. The draft and the file
      // are compared as notes rather than as strings: a keystroke the vault will
      // trim out of the file — the space after a word — is not a change to it.
      unsaved.current =
        loadedDate === date && !sameNote(next, savedBody) ? { date, body: next } : null;
    },
    [date, loadedDate, savedBody],
  );

  /**
   * The autosave itself: the day is written a beat after the operator stops
   * typing. A body the vault has already refused is left pending but not
   * rescheduled — the page does not hammer the vault with an answer it has.
   */
  useEffect(() => {
    // Only the day whose body is on screen is written. While another day is
    // loading, `draft` still holds the day before it.
    if (loadedDate !== date) return;
    // Read as notes, so the whitespace the vault trims at the end of a body is
    // not a difference the page owes it back: a draft that differs from the file
    // only there would otherwise be written again on every pause.
    if (sameNote(draft, savedBody)) {
      unsaved.current = null;
      return;
    }
    unsaved.current = { date, body: draft };
    if (refused && refused.date === date && refused.body === draft) return;
    if (saving) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [date, draft, savedBody, loadedDate, refused, saving, flush]);

  // The page itself can go away with a draft still pending: a closed window is
  // the one exit that is not gated on the write.
  useEffect(() => () => void flush(), [flush]);

  const goToDay = useCallback(
    async (target: string) => {
      if (target === date) return;
      // The day being left is written first, so prose never lands on another
      // date. A refusal does not hold the operator here — the vault has answered,
      // and the day's file is what it was — but a write that *failed* does: the
      // one thing an autosave must never do is drop a draft nobody can vouch for.
      if ((await flush()) === "failed") return;
      setDate(target);
    },
    [date, flush],
  );

  // Ctrl/Cmd+S writes the day, as it does in every other editor in the studio.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  // Dirty as notes, not as strings: the status line and the autosave both hang off
  // this, and the vault's own trim — a space typed between two words, not yet a
  // change to the file — must not keep the day "Saving…" after it has been saved.
  const dirty = !sameNote(draft, savedBody);
  const nextDate = useMemo(() => shiftLocalIsoDate(date, 1), [date]);
  const prevDate = useMemo(() => shiftLocalIsoDate(date, -1), [date]);
  const atToday = date >= today;
  const label = formatLocalIsoDate(date);
  const weekday = weekdayOf(date);
  const heldBack =
    refused !== null && refused.date === date && refused.body === draft;

  const status = saving
    ? "Saving…"
    : dirty
      ? heldBack
        ? "Not saved"
        : "Saving…"
      : exists
        ? "Saved"
        : "No note for this day yet";

  // The journal's own strip: days up to today, newest first. A file dated in the
  // future is on disk but is not offered — a note is written, not scheduled —
  // and a file that names no usable day is shown as unreadable, not as a link.
  const newestFirst = useMemo(
    () => history.filter((entry) => entry.date <= today).slice().reverse(),
    [history, today],
  );
  const todayHasNote = history.some((entry) => entry.date === today);

  // This week stays open: its days are what "Earlier notes" is for after today.
  // Every week before it folds under its own toggle, and a day that names no
  // real date has no week to sit in — it stays where it is, unreadable.
  const currentWeekStart = useMemo(() => isoWeekOf(today)?.start ?? today, [today]);
  const currentYear = Number(today.slice(0, 4));
  const weeks = useMemo(() => {
    const current: DailyNoteIndexEntry[] = [];
    const unreadable: DailyNoteIndexEntry[] = [];
    const grouped = new Map<string, WeekGroup>();
    for (const entry of newestFirst) {
      if (entry.error) {
        unreadable.push(entry);
        continue;
      }
      const week = isoWeekOf(entry.date);
      if (!week) {
        unreadable.push(entry);
        continue;
      }
      if (week.start === currentWeekStart) {
        current.push(entry);
        continue;
      }
      const found = grouped.get(week.start);
      if (found) found.entries.push(entry);
      else grouped.set(week.start, { ...week, entries: [entry] });
    }
    // A Map keeps insertion order, and `newestFirst` is already newest first, so
    // the weeks come out in the same order without a second sort.
    return { current, previous: [...grouped.values()], unreadable };
  }, [currentWeekStart, newestFirst]);

  // Landing on a day outside this week opens the week that day belongs to, so
  // the day on screen is never folded away inside the list below it.
  const selectedWeekStart = useMemo(() => isoWeekOf(date)?.start ?? null, [date]);
  useEffect(() => {
    if (!selectedWeekStart || selectedWeekStart === currentWeekStart) return;
    setOpenWeeks((prev) =>
      prev.includes(selectedWeekStart) ? prev : [...prev, selectedWeekStart],
    );
  }, [currentWeekStart, selectedWeekStart]);

  const toggleWeek = useCallback((start: string) => {
    setOpenWeeks((prev) =>
      prev.includes(start) ? prev.filter((week) => week !== start) : [...prev, start],
    );
  }, []);

  /** One day of the journal, in the strip's three columns. */
  const historyRow = (entry: DailyNoteIndexEntry) =>
    entry.error ? (
      <li
        key={entry.date}
        className="daily-note__history-row daily-note__history-unreadable"
        data-date={entry.date}
      >
        <span className="daily-note__history-date">{entry.date}</span>
        <span className="daily-note__history-weekday">—</span>
        <span className="daily-note__history-edited">unreadable</span>
      </li>
    ) : (
      <li key={entry.date} className="daily-note__history-row" data-date={entry.date}>
        <button
          type="button"
          className="daily-note__history-day"
          aria-current={entry.date === date ? "true" : undefined}
          onClick={() => void goToDay(entry.date)}
        >
          <span className="daily-note__history-date">
            {entry.date === today ? "Today · " : ""}
            {formatLocalIsoDate(entry.date)}
          </span>
          <span className="daily-note__history-weekday">
            {weekdayOf(entry.date) ?? "—"}
          </span>
          <span className="daily-note__history-edited">
            {formatEditedAt(entry.updatedAt)}
          </span>
        </button>
      </li>
    );

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="daily-note">
      <header className="daily-note__header">
        <h1>Daily Note</h1>
        <div className="daily-note__pager">
          <Button
            variant="outline"
            data-testid="daily-note-prev"
            onClick={() => {
              if (prevDate) void goToDay(prevDate);
            }}
            disabled={!prevDate}
          >
            ‹ Prev day
          </Button>
          <span
            className="daily-note__date"
            data-testid="daily-note-day"
            data-date={date}
          >
            {date === today ? "Today · " : ""}
            {weekday ? `${weekday}, ` : ""}
            {label}
          </span>
          <Button
            variant="outline"
            data-testid="daily-note-next"
            onClick={() => {
              if (nextDate) void goToDay(nextDate);
            }}
            disabled={!nextDate || atToday}
          >
            Next day ›
          </Button>
          {date !== today ? (
            <Button
              variant="ghost"
              data-testid="daily-note-today"
              onClick={() => void goToDay(today)}
            >
              Today
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="daily-note__workspace">
        {loading ? (
          <p className="muted daily-note__loading">Loading the day…</p>
        ) : (
          <div className="daily-note__compose">
            <div
              className="daily-note__editor"
              // The pointer leaving the box — for another pane, another app — is
              // the operator stepping away, so the day is written then rather than
              // at the end of the debounce. Moving between paragraphs stays inside.
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                void flush();
              }}
            >
              <LiveMarkdownEditor
                testId="daily-note-editor"
                value={draft}
                onChange={onDraftChange}
                slug={`daily-note-${date}`}
                ariaLabel={`Daily note for ${label}`}
                autoFocusEmpty
              />
            </div>

            <p
              className="daily-note__status muted"
              data-testid="daily-note-status"
              role="status"
            >
              {status}
            </p>
          </div>
        )}

        <section className="daily-note__history">
          <h2>Earlier notes</h2>
          {newestFirst.length === 0 ? (
            <p className="muted">
              {todayHasNote
                ? "Nothing yet."
                : "No notes yet. Today's page is the first one."}
            </p>
          ) : (
            <>
              {/* The strip is one small table: the day written *about*, its weekday,
                  and when it was last written. The header is decoration — every row
                  is a button whose own cells say the same thing — so it is hidden
                  from the reading order rather than announced twice. */}
              <div className="daily-note__history-head" aria-hidden="true">
                <span>Date</span>
                <span>Day</span>
                <span>Last edited</span>
              </div>

              {/* This week stays open: the days after today are what "Earlier
                  notes" means right now, and folding them under a click would
                  hide the one week the operator is living in. */}
              {weeks.current.length > 0 ? (
                <ul className="daily-note__history-list" data-week="current">
                  {weeks.current.map(historyRow)}
                </ul>
              ) : null}

              {/* Every week before this one folds under its own toggle. The list
                  is mounted only while the week is open, so a year of folded
                  weeks is a year of labels rather than a year of rows. */}
              {weeks.previous.map((week) => {
                const open = openWeeks.includes(week.start);
                const daysId = `daily-note-week-${week.start}-days`;
                return (
                  <div
                    className="daily-note__week"
                    key={week.start}
                    data-week={week.start}
                  >
                    <button
                      type="button"
                      className="daily-note__week-toggle"
                      data-testid={`daily-note-week-${week.start}`}
                      aria-expanded={open}
                      aria-controls={open ? daysId : undefined}
                      title={weekTitle(week)}
                      onClick={() => toggleWeek(week.start)}
                    >
                      <span className="daily-note__week-caret" aria-hidden="true">
                        ›
                      </span>
                      <span className="daily-note__week-label">
                        {weekLabel(week, currentYear)}
                      </span>
                      <span className="daily-note__week-count muted">
                        {week.entries.length}{" "}
                        {week.entries.length === 1 ? "note" : "notes"}
                      </span>
                    </button>
                    {open ? (
                      <ul className="daily-note__history-list" id={daysId}>
                        {week.entries.map(historyRow)}
                      </ul>
                    ) : null}
                  </div>
                );
              })}

              {/* A file that names no usable day belongs to no week, so it is
                  reported where it sits rather than silently dropped. */}
              {weeks.unreadable.length > 0 ? (
                <ul className="daily-note__history-list">
                  {weeks.unreadable.map(historyRow)}
                </ul>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
