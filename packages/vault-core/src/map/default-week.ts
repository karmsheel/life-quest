import { fail, ok } from "./errors.ts";
import type { ChecklistItem, Result, StoreState, Weekday } from "./types.ts";

export function setDefaultWeekdayType(
  state: StoreState,
  weekday: Weekday,
  dayTypeId: string | null,
): Result<StoreState> {
  if (weekday < 0 || weekday > 6) return fail("MALFORMED", "Invalid weekday");
  if (dayTypeId && !state.dayTypes.some((t) => t.id === dayTypeId)) {
    return fail("NOT_FOUND", "Day type not found");
  }
  const dayTypeByWeekday = state.defaultWeek.dayTypeByWeekday.slice();
  dayTypeByWeekday[weekday] = dayTypeId;
  return ok({
    ...state,
    defaultWeek: { ...state.defaultWeek, dayTypeByWeekday },
  });
}

export function setDefaultWeeklyItems(
  state: StoreState,
  items: ChecklistItem[],
): Result<StoreState> {
  return ok({
    ...state,
    defaultWeek: { ...state.defaultWeek, weeklyItems: items },
  });
}
