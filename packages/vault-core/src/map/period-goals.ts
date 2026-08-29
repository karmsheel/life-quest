import { compareIso, isDateInYear, isIsoDate } from "./dates.ts";
import { fail, ok } from "./errors.ts";
import { isColorId } from "./palette.ts";
import type { ApplyContext, PeriodGoal, Result, StoreState } from "./types.ts";
import { replaceYear, writableYear } from "./writable.ts";

function assertRange(
  year: number,
  start: string,
  end: string,
): Result<void> {
  if (!isIsoDate(start) || !isIsoDate(end)) {
    return fail("INVALID_RANGE", "Dates must be YYYY-MM-DD");
  }
  if (!isDateInYear(start, year) || !isDateInYear(end, year)) {
    return fail("INVALID_RANGE", "Period goal cannot leave its year");
  }
  if (compareIso(start, end) > 0) {
    return fail("INVALID_RANGE", "Start must be on or before end");
  }
  return ok(undefined);
}

export function createPeriodGoal(
  state: StoreState,
  year: number,
  name: string,
  color: PeriodGoal["color"],
  start: string,
  end: string,
  ctx: ApplyContext,
): Result<StoreState> {
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  if (!isColorId(color)) return fail("MALFORMED", "Unknown color");
  const range = assertRange(year, start, end);
  if (!range.ok) return range;
  const goal: PeriodGoal = { id: ctx.id(), name, color, start, end };
  return ok(
    replaceYear(state, {
      ...rec.value,
      periodGoals: [...rec.value.periodGoals, goal],
    }),
  );
}

export function updatePeriodGoal(
  state: StoreState,
  year: number,
  id: string,
  patch: Partial<Pick<PeriodGoal, "name" | "color" | "start" | "end">>,
): Result<StoreState> {
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  const idx = rec.value.periodGoals.findIndex((g) => g.id === id);
  if (idx < 0) return fail("NOT_FOUND", "Period goal not found");
  const cur = rec.value.periodGoals[idx];
  const next = { ...cur, ...patch };
  if (patch.color && !isColorId(patch.color)) {
    return fail("MALFORMED", "Unknown color");
  }
  const range = assertRange(year, next.start, next.end);
  if (!range.ok) return range;
  const periodGoals = rec.value.periodGoals.slice();
  periodGoals[idx] = next;
  return ok(replaceYear(state, { ...rec.value, periodGoals }));
}

export function deletePeriodGoal(
  state: StoreState,
  year: number,
  id: string,
): Result<StoreState> {
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  if (!rec.value.periodGoals.some((g) => g.id === id)) {
    return fail("NOT_FOUND", "Period goal not found");
  }
  return ok(
    replaceYear(state, {
      ...rec.value,
      periodGoals: rec.value.periodGoals.filter((g) => g.id !== id),
    }),
  );
}
