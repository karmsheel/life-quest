/**
 * The one calendar-date rule.
 *
 * A date is a real day in `YYYY-MM-DD`, not a string that merely looks like
 * one. `Date.parse` rolls `2026-02-31` into March, so the round-trip through
 * UTC is what rejects a day that does not exist. Callers that accept free
 * text trim first; this function does not.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day, or null when the parts do not name one. */
export function calendarDateFromParts(
  year: number,
  month: number,
  day: number,
): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < 0 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when `value` is a real local calendar date in `YYYY-MM-DD` form. */
export function isCalendarDate(value: string): boolean {
  const match = ISO.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return calendarDateFromParts(year, month, day) === value;
}
