import { daysInMonth } from "./dates.ts";
import { fail, ok } from "./errors.ts";
import type { Result, StoreState } from "./types.ts";
import { replaceYear, writableYear } from "./writable.ts";

function monthRec(state: StoreState, year: number, month: number) {
  if (month < 1 || month > 12) return fail("INVALID_RANGE", "Month must be 1-12");
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  return ok({ rec: rec.value, month });
}

export function setMonthDay(
  state: StoreState,
  year: number,
  month: number,
  day: number,
  text: string,
): Result<StoreState> {
  const got = monthRec(state, year, month);
  if (!got.ok) return got;
  if (day < 1 || day > daysInMonth(year, month)) {
    return fail("INVALID_RANGE", "Day is not in this month");
  }
  const months = got.value.rec.months.map((m, i) => {
    if (i !== month - 1) return m;
    return { ...m, days: { ...m.days, [String(day)]: text } };
  });
  return ok(replaceYear(state, { ...got.value.rec, months }));
}

export function setMonthObjectives(
  state: StoreState,
  year: number,
  month: number,
  text: string,
): Result<StoreState> {
  const got = monthRec(state, year, month);
  if (!got.ok) return got;
  const months = got.value.rec.months.map((m, i) =>
    i === month - 1 ? { ...m, objectives: text } : m,
  );
  return ok(replaceYear(state, { ...got.value.rec, months }));
}

export function setMonthNotes(
  state: StoreState,
  year: number,
  month: number,
  text: string,
): Result<StoreState> {
  const got = monthRec(state, year, month);
  if (!got.ok) return got;
  const months = got.value.rec.months.map((m, i) =>
    i === month - 1 ? { ...m, notes: text } : m,
  );
  return ok(replaceYear(state, { ...got.value.rec, months }));
}
