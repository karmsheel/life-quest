import type { Recurrence, Weekday } from "@lifequest/vault-core/map";
import {
  formatLocalIsoDayMonth,
  type RecurringDueState,
} from "@lifequest/vault-core/pure";

/**
 * The words a recurring task is drawn with.
 *
 * Three surfaces print the same schedule — the Dashboard card, the Task
 * Manager's list and its editor — so the cadence labels live here rather than
 * in one of them. The editor's option lists are here too: the unit's own label
 * and its fields must agree with the sentence the list prints beside it.
 */

/** 0 = Monday … 6 = Sunday, the order the vault's map already uses. */
export const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

export const MONTH_OPTIONS: { value: number; label: string }[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((label, index) => ({ value: index + 1, label }));

export const CADENCE_OPTIONS: { value: Recurrence["unit"]; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

/** `0` → "Monday". */
export function weekdayName(weekday: Weekday): string {
  return WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label ?? "";
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd". */
function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * The cadence in one sentence: "Every day", "Every Monday",
 * "Every month on the 12th", "Every year on 5 Nov".
 *
 * The list prints this in place of the stored shape, which is why the manager
 * never shows `{unit:"week",weekday:0}` to the operator.
 */
export function recurrenceLabel(recurrence: Recurrence): string {
  switch (recurrence.unit) {
    case "day":
      return "Every day";
    case "week":
      return `Every ${weekdayName(recurrence.weekday)}`;
    case "month":
      return `Every month on the ${ordinal(recurrence.dayOfMonth)}`;
    case "year": {
      // A leap-day rule is drawn from a leap year so 29 Feb keeps its name
      // instead of reading as a malformed date.
      const month = String(recurrence.month).padStart(2, "0");
      const day = String(recurrence.day).padStart(2, "0");
      return `Every year on ${formatLocalIsoDayMonth(`2000-${month}-${day}`)}`;
    }
  }
}

/**
 * How a due row says where it stands. The Dashboard and the manager both use
 * these words, so "Overdue" means the same colour and word on both.
 */
export function dueStateLabel(state: RecurringDueState): string {
  switch (state) {
    case "overdue":
      return "Overdue";
    case "today":
      return "Due today";
    case "this-week":
      return "This week";
  }
}
