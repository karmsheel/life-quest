import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatLocalIsoDate,
  periodBounds,
  periodTodayLocalIso,
  type ReviewCadence,
  type WeekStartDay,
} from "@lifequest/vault-core/pure";
import type { DailyNote } from "@lifequest/vault-core";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/ipc";

/**
 * The days the operator wrote, inside the period being reviewed.
 *
 * This is the operator's side of the same read a review session makes: the
 * companion receives these notes in its period pack, and this panel is where the
 * operator sees what it was given. It reads the window directly rather than the
 * pack, so a long period shows every day written — the pack's cap is an
 * instruction-payload budget, not a display rule.
 *
 * Notes are vault-level, so the panel is the same on every scope: a domain
 * review reads the same journal, narrowed only by the period.
 *
 * A note's body is rendered only once its day is opened. A year of prose mounted
 * collapsed would be a year of markdown parsed to draw a list of dates.
 */
export function DailyNotesPanel({
  cadence,
  period,
  weekStartDay,
}: {
  cadence: ReviewCadence;
  period: string;
  weekStartDay: WeekStartDay;
}) {
  const today = periodTodayLocalIso();
  // Null while the window is being read, so "loading" and "empty" are different
  // facts rather than one quiet line.
  const [notes, setNotes] = useState<DailyNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDates, setOpenDates] = useState<string[]>([]);
  const loadToken = useRef(0);

  useEffect(() => {
    const bounds = periodBounds(cadence, period, weekStartDay);
    if (!bounds.ok) {
      setNotes([]);
      setError(bounds.error);
      return;
    }
    const token = ++loadToken.current;
    setNotes(null);
    setError(null);
    setOpenDates([]);
    void (async () => {
      try {
        const result = await api().dailyNoteWindow(
          bounds.value.start,
          bounds.value.end,
        );
        if (token !== loadToken.current) return;
        if (!result.ok) {
          setNotes([]);
          setError(result.error);
          return;
        }
        setNotes(result.value);
      } catch (err) {
        if (token !== loadToken.current) return;
        setNotes([]);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [cadence, period, weekStartDay]);

  const toggle = useCallback((date: string) => {
    setOpenDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  }, []);

  const newestFirst = notes ? [...notes].reverse() : [];

  return (
    <section className="review-notes" aria-label="Daily notes in this period">
      <header className="review-notes__header">
        <h2>Daily notes in this period</h2>
        {notes && notes.length > 0 ? (
          <span className="muted">{notes.length}</span>
        ) : null}
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {notes === null ? (
        <p className="muted">Reading the journal…</p>
      ) : newestFirst.length === 0 ? (
        <>
          <p className="muted">No daily notes in this period.</p>
          <Button variant="ghost" to="/notes">
            Write today&rsquo;s note
          </Button>
        </>
      ) : (
        <ul className="review-notes__list">
          {newestFirst.map((note) => {
            const expanded = openDates.includes(note.date);
            return (
              <li key={note.date} className="review-notes__item">
                <button
                  type="button"
                  className="review-notes__day"
                  data-testid={`review-note-${note.date}`}
                  aria-expanded={expanded}
                  onClick={() => toggle(note.date)}
                >
                  <span className="review-notes__label">
                    {note.date === today ? "Today · " : ""}
                    {formatLocalIsoDate(note.date)}
                  </span>
                  <span className="muted review-notes__excerpt">
                    {excerpt(note.bodyMarkdown)}
                  </span>
                </button>
                {expanded ? (
                  <div className="review-notes__body">
                    <MarkdownView
                      markdown={note.bodyMarkdown}
                      slug={`daily-note-${note.date}`}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The one line a collapsed day shows: its first line of prose, without marks. */
function excerpt(body: string): string {
  const first =
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  const plain = first
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[>*-]\s*/, "")
    .replace(/`/g, "")
    .trim();
  return plain.length > 96 ? `${plain.slice(0, 95).trimEnd()}…` : plain;
}
