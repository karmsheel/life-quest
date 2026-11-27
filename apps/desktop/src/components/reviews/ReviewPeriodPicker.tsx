import {
  periodBounds,
  periodForDate,
  type ReviewCadence,
  type WeekStartDay,
} from "@lifequest/vault-core/pure";
import { DayPicker } from "@/components/notes/DayPicker";

/**
 * The review header's calendar key: the month, and the period its chosen day
 * belongs to.
 *
 * The Review page walks its periods a step at a time with the arrow keys, which
 * is the right gesture for the next week or the previous month and the wrong one
 * for a period the operator half remembers. The calendar key opens the shared
 * day picker; this wrapper answers the one question the picker does not know —
 * what a chosen day MEANS on this page. A weekly review folds the day into its
 * week, a monthly one into its month, and so on, with the same fold the engine
 * uses for "now".
 *
 * The open period is the wall, not today: a week whose window has not opened
 * cannot be written, so the picker's ceiling is the last day of the latest
 * period the page may open. Days between today and the end of the open period
 * are choosable and land on the period already on screen (a no-op), while the
 * next period is inert.
 */
const PERIOD_NOUN: Record<ReviewCadence, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

export type ReviewPeriodPickerProps = {
  cadence: ReviewCadence;
  /** The period the page is on. */
  period: string;
  weekStartDay: WeekStartDay;
  /** The latest period whose window has opened — the page's own wall. */
  latestPeriod: string;
  /** Today, in the operator's own time zone, for the calendar's ring. */
  today: string;
  /** Called with the period that contains the chosen day. */
  onSelect: (period: string) => void;
};

export function ReviewPeriodPicker({
  cadence,
  period,
  weekStartDay,
  latestPeriod,
  today,
  onSelect,
}: ReviewPeriodPickerProps) {
  const shown = periodBounds(cadence, period, weekStartDay);
  const latest = periodBounds(cadence, latestPeriod, weekStartDay);
  if (!shown.ok || !latest.ok) return null;
  const noun = PERIOD_NOUN[cadence];
  return (
    <DayPicker
      // The period's first day is what the calendar opens on and marks as
      // chosen; for a month, quarter or year it is the day the period starts.
      date={shown.value.start}
      today={today}
      latest={latest.value.end}
      label={`Choose another ${noun}`}
      title={`Choose another ${noun} — opened periods only`}
      testId="review-calendar"
      slotClassName="review-page__calendar-slot"
      keyClassName="review-page__calendar"
      onSelect={(day) => {
        const next = periodForDate(cadence, day, weekStartDay);
        if (next !== period) onSelect(next);
      }}
    />
  );
}
