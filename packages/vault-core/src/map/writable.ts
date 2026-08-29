import { fail, ok } from "./errors.ts";
import type { Result, StoreState, YearRecord } from "./types.ts";
import { findYear } from "./years.ts";

export function writableYear(state: StoreState, year: number): Result<YearRecord> {
  const rec = findYear(state, year);
  if (!rec) return fail("NOT_FOUND", `Year ${year} not found`);
  if (rec.status === "archive") {
    return fail("ARCHIVE_READ_ONLY", "Archive is read-only");
  }
  return ok(rec);
}

export function replaceYear(state: StoreState, rec: YearRecord): StoreState {
  return {
    ...state,
    years: state.years.map((y) => (y.year === rec.year ? rec : y)),
  };
}
