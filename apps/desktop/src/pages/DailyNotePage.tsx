import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatLocalIsoDate,
  periodTodayLocalIso,
  shiftLocalIsoDate,
} from "@lifequest/vault-core/pure";
import { Button } from "@/components/ui/Button";
import { LiveMarkdownEditor } from "@/components/documents/LiveMarkdownEditor";
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

/** The weekday of a local ISO date, or null when the string is not a date. */
function weekdayOf(date: string): string | null {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return WEEKDAYS[parsed.getDay()] ?? null;
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
 * The vault is the source of truth, so a load overwrites the draft and a save
 * takes the file's own normalized body back. A day with no note is an empty
 * editor, not an error.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<DailyNoteIndexEntry[]>([]);

  // A load for a day the operator has already left must not land in the editor.
  const loadToken = useRef(0);

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
    setNotice(null);
    try {
      const result = await api().dailyNoteGet(target);
      if (token !== loadToken.current) return;
      if (result.ok) {
        setDraft(result.value.bodyMarkdown);
        setSavedBody(result.value.bodyMarkdown);
        setExists(true);
      } else if (/not found/i.test(result.error)) {
        setDraft("");
        setSavedBody("");
        setExists(false);
      } else {
        setError(result.error);
      }
    } catch (err) {
      if (token !== loadToken.current) return;
      setError(err instanceof Error ? err.message : String(err));
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

  const dirty = draft !== savedBody;
  const nextDate = useMemo(() => shiftLocalIsoDate(date, 1), [date]);
  const prevDate = useMemo(() => shiftLocalIsoDate(date, -1), [date]);
  const atToday = date >= today;
  const label = formatLocalIsoDate(date);
  const weekday = weekdayOf(date);

  const onSave = useCallback(async () => {
    // An empty day with nothing typed is not dirty, so Save is inert. Clearing a
    // day that has a note *is* dirty, and the vault refuses it with a reason —
    // which the page shows, keeping the operator's draft.
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api().dailyNoteWrite(date, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The file is the truth: take back the body it actually holds.
      setDraft(result.value.bodyMarkdown);
      setSavedBody(result.value.bodyMarkdown);
      setExists(true);
      setNotice(`Saved ${label}.`);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [date, dirty, label, loadHistory, draft]);

  // Ctrl/Cmd+S saves, as it does in every other editor in the studio.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void onSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSave]);

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  // The journal's own strip: days up to today, newest first. A file dated in the
  // future is on disk but is not offered — a note is written, not scheduled —
  // and a file that names no usable day is shown as unreadable, not as a link.
  const newestFirst = history
    .filter((entry) => entry.date <= today)
    .slice()
    .reverse();
  const todayHasNote = history.some((entry) => entry.date === today);

  return (
    <div className="daily-note">
      <header className="daily-note__header">
        <h1>Daily Note</h1>
        <div className="daily-note__pager">
          <Button
            variant="outline"
            data-testid="daily-note-prev"
            onClick={() => prevDate && setDate(prevDate)}
            disabled={!prevDate}
          >
            ‹ Prev day
          </Button>
          <span className="daily-note__date" data-testid="daily-note-day">
            {date === today ? "Today · " : ""}
            {weekday ? `${weekday}, ` : ""}
            {label}
          </span>
          <Button
            variant="outline"
            data-testid="daily-note-next"
            onClick={() => nextDate && setDate(nextDate)}
            disabled={!nextDate || atToday}
          >
            Next day ›
          </Button>
          {date !== today ? (
            <Button variant="ghost" data-testid="daily-note-today" onClick={() => setDate(today)}>
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

      {loading ? (
        <p className="muted">Loading the day…</p>
      ) : (
        <>
          <LiveMarkdownEditor
            testId="daily-note-editor"
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setNotice(null);
            }}
            slug={`daily-note-${date}`}
            ariaLabel={`Daily note for ${label}`}
            placeholder="How did the day go?"
            autoFocusEmpty
          />

          <div className="daily-note__actions">
            <Button
              variant="primary"
              data-testid="daily-note-save"
              onClick={onSave}
              disabled={busy || !dirty}
            >
              Save
            </Button>
            <span
              className="daily-note__status muted"
              data-testid="daily-note-status"
              role="status"
            >
              {/* The notice wins over "Unsaved changes": a refused save (the
                  vault rejects a note with no prose in it) leaves the draft
                  dirty, and the operator needs the reason, not the dirty flag.
                  Typing clears it. */}
              {notice ??
                (dirty
                  ? "Unsaved changes"
                  : exists
                    ? "Saved"
                    : "No note for this day yet")}
            </span>
          </div>
        </>
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
          <ul className="daily-note__history-list">
            {newestFirst.map((entry) =>
              entry.error ? (
                <li key={entry.date} className="daily-note__history-row">
                  <span className="muted">
                    {entry.date} · unreadable
                  </span>
                </li>
              ) : (
                <li key={entry.date} className="daily-note__history-row">
                  <button
                    type="button"
                    className="daily-note__history-day"
                    aria-current={entry.date === date ? "true" : undefined}
                    onClick={() => setDate(entry.date)}
                  >
                    <span>
                      {entry.date === today ? "Today · " : ""}
                      {formatLocalIsoDate(entry.date)}
                    </span>
                    {/* Only when the note was written after its own day: a day
                        written on the day is the ordinary case, and saying so on
                        every row is noise. */}
                    <span className="muted">
                      {entry.updatedAt && entry.updatedAt.slice(0, 10) !== entry.date
                        ? `written ${new Date(entry.updatedAt).toLocaleDateString()}`
                        : ""}
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
