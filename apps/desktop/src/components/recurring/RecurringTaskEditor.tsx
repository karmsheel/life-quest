import { useMemo, useState, type FormEvent } from "react";
import {
  compareIso,
  isIsoDate,
  occurrenceOnOrAfter,
  todayLocalIso,
  type Recurrence,
  type RecurringTask,
  type Weekday,
} from "@lifequest/vault-core/map";
import { Button } from "@/components/ui/Button";
import {
  CADENCE_OPTIONS,
  MONTH_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@/lib/recurring-copy";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

/** The editor's own fields. The cadence is split into its unit's fields so
 *  switching units never loses what was typed for the next one. */
type Draft = {
  title: string;
  unit: Recurrence["unit"];
  weekday: Weekday;
  dayOfMonth: number;
  month: number;
  day: number;
  dueDate: string;
  link: string;
  notes: string;
};

function recurrenceOf(draft: Draft): Recurrence {
  switch (draft.unit) {
    case "day":
      return { unit: "day" };
    case "week":
      return { unit: "week", weekday: draft.weekday };
    case "month":
      return { unit: "month", dayOfMonth: draft.dayOfMonth };
    case "year":
      return { unit: "year", month: draft.month, day: draft.day };
  }
}

function draftOf(item: RecurringTask | null, today: string): Draft {
  if (!item) {
    // A new task is first due on the next occurrence of its default cadence,
    // which is today for "every day".
    return {
      title: "",
      unit: "day",
      weekday: 0,
      dayOfMonth: 1,
      month: 1,
      day: 1,
      dueDate: today,
      link: "",
      notes: "",
    };
  }
  const recurrence = item.recurrence;
  return {
    title: item.title,
    unit: recurrence.unit,
    weekday: recurrence.unit === "week" ? recurrence.weekday : 0,
    dayOfMonth: recurrence.unit === "month" ? recurrence.dayOfMonth : 1,
    month: recurrence.unit === "year" ? recurrence.month : 1,
    day: recurrence.unit === "year" ? recurrence.day : 1,
    dueDate: item.dueDate,
    link: item.link ?? "",
    notes: item.notes,
  };
}

/**
 * The date a cadence change re-anchors to.
 *
 * A brand-new task starts from today. An existing one starts from the later of
 * its date and today, the same floor the engine applies when an update changes
 * the rhythm without naming a date — so changing the rule cannot leave a date
 * the new rule would never produce, and a task already behind does not replay
 * past occurrences.
 */
function dueFor(
  recurrence: Recurrence,
  item: RecurringTask | null,
  today: string,
): string {
  const floor =
    item && compareIso(item.dueDate, today) > 0 ? item.dueDate : today;
  return occurrenceOnOrAfter(recurrence, floor);
}

type Props = {
  /** The record being edited; null creates a new one. */
  item: RecurringTask | null;
  /** Called after a successful write, once the vault has been refreshed. */
  onSaved: () => void;
  onCancel: () => void;
};

/**
 * Create or edit one recurring task, inline above the manager's list.
 *
 * The due date follows the cadence until the operator sets one themselves; from
 * then on it is theirs, which is the difference between "the rhythm decides the
 * date" and "the date is chosen". Save sends exactly one command — the refusal
 * it may answer with is printed beside the form rather than swallowed.
 */
export function RecurringTaskEditor({ item, onSaved, onCancel }: Props) {
  const { refresh } = useVault();
  const today = useMemo(() => todayLocalIso(), []);
  const [draft, setDraft] = useState<Draft>(() => draftOf(item, today));
  /** True once the operator has typed their own date; cadence changes stop
   *  overwriting it from that point on. */
  const [dueTouched, setDueTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  /**
   * A cadence field changed. The due date is recomputed in the same update so
   * the two cannot disagree — unless the operator has claimed the date.
   */
  function patchCadence(next: Partial<Draft>) {
    setDraft((prev) => {
      const merged = { ...prev, ...next };
      if (!dueTouched) {
        merged.dueDate = dueFor(recurrenceOf(merged), item, today);
      }
      return merged;
    });
  }

  function numberOr(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const title = draft.title.trim();
    if (!title) {
      setError("A recurring task needs a title.");
      return;
    }
    if (!isIsoDate(draft.dueDate)) {
      setError("A recurring task's due date must be a real date (YYYY-MM-DD).");
      return;
    }
    const recurrence = recurrenceOf(draft);
    const link = draft.link.trim();
    // An emptied page field clears a link that was there; a task that never had
    // one simply omits the field.
    const linkPatch = link ? { link } : item?.link ? { link: "" } : {};
    const notes = draft.notes.trim() ? draft.notes : undefined;
    setSaving(true);
    setError(null);
    try {
      const result = item
        ? await api().mapApply({
            type: "updateRecurring",
            id: item.id,
            title,
            notes: draft.notes,
            recurrence,
            dueDate: draft.dueDate,
            ...linkPatch,
          })
        : await api().mapApply({
            type: "createRecurring",
            title,
            ...(notes !== undefined ? { notes } : {}),
            recurrence,
            dueDate: draft.dueDate,
            ...linkPatch,
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save the recurring task",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="recurring-editor"
      data-testid="recurring-editor"
      onSubmit={(event) => void save(event)}
    >
      <div className="recurring-editor__head">
        <h3 className="recurring-editor__title">
          {item ? "Edit recurring task" : "New recurring task"}
        </h3>
        <p className="recurring-editor__hint muted">
          Completing an occurrence records it and moves the next due date; it
          never adds a card to the board.
        </p>
      </div>

      <div className="recurring-editor__row">
        <label className="field">
          Title
          <input
            data-testid="recurring-title"
            value={draft.title}
            maxLength={120}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="Weekly review"
            autoComplete="off"
          />
        </label>
        <label className="field">
          Repeats
          <select
            data-testid="recurring-cadence"
            value={draft.unit}
            onChange={(event) =>
              patchCadence({ unit: event.target.value as Recurrence["unit"] })
            }
          >
            {CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {draft.unit === "week" ? (
          <label className="field">
            Weekday
            <select
              data-testid="recurring-weekday"
              value={draft.weekday}
              onChange={(event) =>
                patchCadence({ weekday: Number(event.target.value) as Weekday })
              }
            >
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {draft.unit === "month" ? (
          <label className="field">
            Day of month
            <input
              type="number"
              data-testid="recurring-day-of-month"
              min={1}
              max={31}
              value={draft.dayOfMonth}
              onChange={(event) =>
                patchCadence({
                  dayOfMonth: numberOr(event.target.value, draft.dayOfMonth),
                })
              }
            />
          </label>
        ) : null}
        {draft.unit === "year" ? (
          <>
            <label className="field">
              Month
              <select
                data-testid="recurring-month"
                value={draft.month}
                onChange={(event) =>
                  patchCadence({ month: numberOr(event.target.value, draft.month) })
                }
              >
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Day
              <input
                type="number"
                data-testid="recurring-day"
                min={1}
                max={31}
                value={draft.day}
                onChange={(event) =>
                  patchCadence({ day: numberOr(event.target.value, draft.day) })
                }
              />
            </label>
          </>
        ) : null}
        <label className="field">
          {item ? "Next due" : "First due"}
          <input
            type="date"
            data-testid="recurring-due-date"
            value={draft.dueDate}
            onChange={(event) => {
              setDueTouched(true);
              patch({ dueDate: event.target.value });
            }}
            required
          />
        </label>
      </div>

      <div className="recurring-editor__row">
        <label className="field">
          Page it opens (optional)
          <input
            data-testid="recurring-link"
            value={draft.link}
            onChange={(event) => patch({ link: event.target.value })}
            placeholder="/review/weekly"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="field">
        Notes (optional)
        <textarea
          data-testid="recurring-notes"
          value={draft.notes}
          rows={2}
          maxLength={4000}
          onChange={(event) => patch({ notes: event.target.value })}
          placeholder="Anything to remember when it comes round"
        />
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="recurring-editor__actions">
        <Button
          variant="ghost"
          type="button"
          data-testid="recurring-cancel"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          data-testid="recurring-save"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save recurring task"}
        </Button>
      </div>
    </form>
  );
}
