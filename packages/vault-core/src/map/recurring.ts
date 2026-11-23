import { addDays, compareIso, daysInMonth, isIsoDate, weekdayOf, yearOf } from "./dates.ts";
import { fail, ok } from "./errors.ts";
import type {
  ApplyContext,
  IsoDate,
  Recurrence,
  RecurringTask,
  Result,
  StoreState,
  Weekday,
} from "./types.ts";
import type { WeekStartDay } from "../types.ts";
import { weekStartOnOrBefore } from "../period.ts";

/**
 * The recurring-task record and its calendar.
 *
 * A recurring task is a STANDING RECORD, not a board task. It has no column and
 * never joins `state.tasks`; the Act board's columns are horizons of work and a
 * schedule is not work. What makes it useful is the one date it carries — the
 * next occurrence — plus an explicit rhythm for moving that date forward.
 *
 * The arithmetic here is deliberately pure and string-based (no clock, no
 * locale) so the engine, the renderer and the tool door all answer the same
 * question the same way: given this record and this local day, is it due, and
 * when is it next due?
 */

/** How many completions a record keeps. A short trace, not an archive. */
export const RECURRING_HISTORY_LIMIT = 12;

/** The four rhythms, in the order the editor offers them. */
export const RECURRENCE_UNITS = ["day", "week", "month", "year"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isWeekday(value: unknown): value is Weekday {
  return isIntegerInRange(value, 0, 6);
}

/**
 * The longest a month can be. February takes a leap year so a yearly task that
 * falls on 29 February is a real cadence — it clamps to the 28th in common
 * years instead of being refused at creation.
 */
function longestMonth(month: number): number {
  return daysInMonth(2000, month);
}

/**
 * A cadence is valid when it carries exactly the fields its unit reads.
 *
 * Hand-edited map files and tool arguments both arrive here, so the check is
 * also the reader's guard: a malformed record is dropped on load rather than
 * drawn as a row nobody can explain.
 */
export function isRecurrence(value: unknown): value is Recurrence {
  if (!isPlainObject(value)) return false;
  switch (value.unit) {
    case "day":
      return true;
    case "week":
      return isWeekday(value.weekday);
    case "month":
      return isIntegerInRange(value.dayOfMonth, 1, 31);
    case "year":
      return (
        isIntegerInRange(value.month, 1, 12) &&
        isIntegerInRange(value.day, 1, longestMonth(value.month as number))
      );
    default:
      return false;
  }
}

/** The refusal a bad cadence deserves, in the words the operator reads. */
function recurrenceProblem(value: unknown): string | null {
  if (value === undefined || value === null) return "A recurring task needs a cadence.";
  if (!isPlainObject(value)) return "A recurring task's cadence must be daily, weekly, monthly or yearly.";
  switch (value.unit) {
    case "day":
      return null;
    case "week":
      return isWeekday(value.weekday)
        ? null
        : "A weekly recurring task needs a weekday (0 = Monday … 6 = Sunday).";
    case "month":
      return isIntegerInRange(value.dayOfMonth, 1, 31)
        ? null
        : "A monthly recurring task needs a day of the month from 1 to 31.";
    case "year":
      if (!isIntegerInRange(value.month, 1, 12)) {
        return "A yearly recurring task needs a month from 1 to 12.";
      }
      return isIntegerInRange(value.day, 1, longestMonth(value.month))
        ? null
        : "A yearly recurring task needs a day that month has (29 February is allowed).";
    default:
      return "A recurring task's cadence must be daily, weekly, monthly or yearly.";
  }
}

function isoOf(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The first occurrence on or after `date`.
 *
 * This is the one date rule the whole feature hangs on:
 *  - daily comes every day, so it is the date itself;
 *  - weekly is the next day with that weekday (today counts);
 *  - monthly is anchored to the chosen DAY-OF-MONTH, so the 31st clamps to the
 *    28th in February and is the 31st again in March rather than drifting to
 *    the 28th forever;
 *  - yearly anchors to the chosen month and day, clamping 29 February to the
 *    28th in a common year.
 */
export function occurrenceOnOrAfter(recurrence: Recurrence, date: IsoDate): IsoDate {
  switch (recurrence.unit) {
    case "day":
      return date;
    case "week": {
      const delta = (recurrence.weekday - weekdayOf(date) + 7) % 7;
      return addDays(date, delta);
    }
    case "month": {
      let year = yearOf(date);
      let month = Number(date.slice(5, 7));
      // A month always holds at least one occurrence, so the second pass is the
      // worst case; the bound is a guard against an unreadable date, not a limit.
      for (let step = 0; step < 24; step += 1) {
        const day = Math.min(recurrence.dayOfMonth, daysInMonth(year, month));
        const candidate = isoOf(year, month, day);
        if (compareIso(candidate, date) >= 0) return candidate;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      return date;
    }
    case "year": {
      let year = yearOf(date);
      for (let step = 0; step < 8; step += 1) {
        const day = Math.min(recurrence.day, daysInMonth(year, recurrence.month));
        const candidate = isoOf(year, recurrence.month, day);
        if (compareIso(candidate, date) >= 0) return candidate;
        year += 1;
      }
      return date;
    }
  }
}

/** The first occurrence strictly after `after`. */
export function nextOccurrenceAfter(recurrence: Recurrence, after: IsoDate): IsoDate {
  return occurrenceOnOrAfter(recurrence, addDays(after, 1));
}

/** The last day of the week `today` falls in, following the vault's week start. */
export function recurringWeekEnd(today: IsoDate, weekStartDay: WeekStartDay): IsoDate {
  return addDays(weekStartOnOrBefore(today, weekStartDay), 6);
}

export type RecurringState = "paused" | "overdue" | "today" | "this-week" | "later";

/**
 * Which window a record falls in for `today`.
 *
 * The model names five states. The Dashboard's due list keeps only "overdue"
 * and "today" — what is owed now — while the Task Manager's list draws all
 * five and the editor names their states; keeping the answer in one function is
 * what stops those surfaces disagreeing about whether something is overdue.
 */
export function recurringState(
  item: Pick<RecurringTask, "dueDate" | "paused">,
  today: IsoDate,
  weekStartDay: WeekStartDay,
): RecurringState {
  if (item.paused) return "paused";
  const compared = compareIso(item.dueDate, today);
  if (compared < 0) return "overdue";
  if (compared === 0) return "today";
  if (compareIso(item.dueDate, recurringWeekEnd(today, weekStartDay)) <= 0) {
    return "this-week";
  }
  return "later";
}

/**
 * A page a row opens must be a route inside the app.
 *
 * The Dashboard renders the link through the router, so an external URL would
 * be a dead row at best and a way to leave the studio at worst. The rule is
 * enforced at the command, where both the operator's editor and the companion's
 * tools are checked.
 */
function normalizeLink(link: unknown): Result<string | undefined> {
  if (link === undefined || link === null) return ok(undefined);
  if (typeof link !== "string") {
    return fail("MALFORMED", "A recurring task's page must be a route inside the app.");
  }
  const trimmed = link.trim();
  if (!trimmed) return ok(undefined);
  if (!trimmed.startsWith("/") || trimmed.includes("://")) {
    return fail(
      "MALFORMED",
      "A recurring task's page must be a route inside the app, like /review/weekly.",
    );
  }
  return ok(trimmed);
}

function titleProblem(title: unknown): string | null {
  if (typeof title !== "string" || !title.trim()) {
    return "A recurring task needs a title.";
  }
  return null;
}

function dueDateProblem(dueDate: unknown): string | null {
  if (dueDate === undefined) return null;
  if (typeof dueDate !== "string" || !isIsoDate(dueDate)) {
    return "A recurring task's due date must be a real date (YYYY-MM-DD).";
  }
  return null;
}

export function createRecurring(
  state: StoreState,
  title: string,
  recurrence: Recurrence,
  ctx: ApplyContext,
  notes = "",
  dueDate?: IsoDate,
  link?: string,
): Result<StoreState> {
  const titleIssue = titleProblem(title);
  if (titleIssue) return fail("MALFORMED", titleIssue);
  const recurrenceIssue = recurrenceProblem(recurrence);
  if (recurrenceIssue) return fail("MALFORMED", recurrenceIssue);
  const dueIssue = dueDateProblem(dueDate);
  if (dueIssue) return fail("MALFORMED", dueIssue);
  const cleanedLink = normalizeLink(link);
  if (!cleanedLink.ok) return cleanedLink;

  const item: RecurringTask = {
    id: ctx.id(),
    title: title.trim(),
    notes,
    recurrence,
    dueDate: dueDate ?? occurrenceOnOrAfter(recurrence, ctx.today),
    paused: false,
    history: [],
    // Provenance is written once, from the command's actor, exactly as a task's
    // is: the board says who started it even after it is renamed.
    origin: ctx.actor === "agent" ? "agent" : "operator",
  };
  if (cleanedLink.value !== undefined) item.link = cleanedLink.value;
  return ok({ ...state, recurring: [...(state.recurring ?? []), item] });
}

export function updateRecurring(
  state: StoreState,
  id: string,
  patch: Partial<
    Pick<RecurringTask, "title" | "notes" | "recurrence" | "dueDate" | "link" | "paused">
  >,
  ctx: ApplyContext,
): Result<StoreState> {
  const recurring = state.recurring ?? [];
  const index = recurring.findIndex((item) => item.id === id);
  if (index < 0) return fail("NOT_FOUND", "Recurring task not found.");

  if (patch.title !== undefined) {
    const titleIssue = titleProblem(patch.title);
    if (titleIssue) return fail("MALFORMED", titleIssue);
  }
  if (patch.recurrence !== undefined) {
    const recurrenceIssue = recurrenceProblem(patch.recurrence);
    if (recurrenceIssue) return fail("MALFORMED", recurrenceIssue);
  }
  const dueIssue = dueDateProblem(patch.dueDate);
  if (dueIssue) return fail("MALFORMED", dueIssue);
  const cleanedLink = normalizeLink(patch.link);
  if (!cleanedLink.ok) return cleanedLink;

  const current = recurring[index];
  const next: RecurringTask = { ...current };

  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.paused !== undefined) next.paused = patch.paused;
  if (patch.recurrence !== undefined) next.recurrence = patch.recurrence;
  if (patch.link !== undefined) {
    if (cleanedLink.value === undefined) delete next.link;
    else next.link = cleanedLink.value;
  }
  if (patch.dueDate !== undefined) {
    next.dueDate = patch.dueDate;
  } else if (patch.recurrence !== undefined) {
    // A changed rhythm with no new date is re-anchored rather than left holding
    // a date the new rule would never produce. Today, not the old date, is the
    // floor when the old date is already behind: a new rhythm starts now.
    const floor = compareIso(current.dueDate, ctx.today) > 0 ? current.dueDate : ctx.today;
    next.dueDate = occurrenceOnOrAfter(patch.recurrence, floor);
  }

  const updated = recurring.slice();
  updated[index] = next;
  return ok({ ...state, recurring: updated });
}

export function deleteRecurring(state: StoreState, id: string): Result<StoreState> {
  const recurring = state.recurring ?? [];
  if (!recurring.some((item) => item.id === id)) {
    return fail("NOT_FOUND", "Recurring task not found.");
  }
  return ok({ ...state, recurring: recurring.filter((item) => item.id !== id) });
}

/**
 * Finish one occurrence.
 *
 * The next date is computed from the LATER of the occurrence and today. That is
 * the backlog rule: a weekly task finished three weeks late is next due next
 * week, not three weeks of past dates replayed one tick at a time. A future
 * date (finishing early) advances from that future occurrence instead, so early
 * completion skips the occurrence rather than shifting the rhythm.
 */
export function completeRecurring(
  state: StoreState,
  id: string,
  ctx: ApplyContext,
): Result<StoreState> {
  const recurring = state.recurring ?? [];
  const index = recurring.findIndex((item) => item.id === id);
  if (index < 0) return fail("NOT_FOUND", "Recurring task not found.");
  const current = recurring[index];
  if (current.paused) {
    return fail("MALFORMED", "A paused recurring task is not due.");
  }

  const occurrence = current.dueDate;
  const floor = compareIso(occurrence, ctx.today) > 0 ? occurrence : ctx.today;
  const next: RecurringTask = {
    ...current,
    dueDate: nextOccurrenceAfter(current.recurrence, floor),
    history: [
      { due: occurrence, completedOn: ctx.today },
      ...current.history,
    ].slice(0, RECURRING_HISTORY_LIMIT),
  };
  const updated = recurring.slice();
  updated[index] = next;
  return ok({ ...state, recurring: updated });
}
