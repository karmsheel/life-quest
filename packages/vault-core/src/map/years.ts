import { yearOf } from "./dates.ts";
import { emptyYear } from "./empty.ts";
import { fail, ok } from "./errors.ts";
import type { Result, StoreState, YearRecord } from "./types.ts";
import { materializeYearWeeks } from "./weeks.ts";

export function currentYearOf(today: string): number {
  return yearOf(today);
}

export function liveYears(state: StoreState): YearRecord[] {
  return state.years.filter((y) => y.status === "live");
}

export function findYear(state: StoreState, year: number): YearRecord | undefined {
  return state.years.find((y) => y.year === year);
}

export function ensureCurrentYear(state: StoreState, today: string): StoreState {
  const y = currentYearOf(today);
  if (findYear(state, y)) return state;
  return { ...state, years: [...state.years, emptyYear(y)] };
}

export function createLiveYear(
  state: StoreState,
  year: number,
  today: string,
): Result<StoreState> {
  const current = currentYearOf(today);
  if (year < current || year > current + 2) {
    return fail("YEAR_CAP", "Year must be the current year or up to two future years");
  }
  if (findYear(state, year)) {
    return fail("MALFORMED", `Year ${year} already exists`);
  }
  if (liveYears(state).length >= 3) {
    return fail("YEAR_CAP", "At most three live years");
  }
  return ok({ ...state, years: [...state.years, emptyYear(year)] });
}

export function deleteYear(
  state: StoreState,
  year: number,
  today: string,
): Result<StoreState> {
  const rec = findYear(state, year);
  if (!rec) return fail("NOT_FOUND", `Year ${year} not found`);
  if (rec.status === "live" && year === currentYearOf(today)) {
    return fail("CANNOT_DELETE_CURRENT_YEAR", "Cannot delete the current calendar year");
  }
  return ok({ ...state, years: state.years.filter((y) => y.year !== year) });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function rollover(state: StoreState, today: string): StoreState {
  const current = currentYearOf(today);
  const years = state.years.map((rec) => {
    if (rec.status !== "live" || rec.year >= current) return rec;
    return {
      ...rec,
      status: "archive" as const,
      snapshot: {
        dayTypes: clone(state.dayTypes),
        defaultWeek: clone(state.defaultWeek),
        materializedWeeks: materializeYearWeeks(state, rec),
      },
    };
  });
  let next: StoreState = { ...state, years };
  next = ensureCurrentYear(next, today);
  return next;
}
