import { fail, ok } from "./errors.ts";
import { isColorId } from "./palette.ts";
import type {
  ApplyContext,
  ChecklistItem,
  ColorId,
  Result,
  StoreState,
} from "./types.ts";

export function dayTypeInUse(state: StoreState, id: string): boolean {
  if (state.defaultWeek.dayTypeByWeekday.includes(id)) return true;
  for (const year of state.years) {
    if (year.status !== "live") continue;
    for (const week of Object.values(year.detachedWeeks)) {
      if (week.dayTypeByWeekday.includes(id)) return true;
    }
  }
  return false;
}

export function createDayType(
  state: StoreState,
  name: string,
  color: ColorId,
  ctx: ApplyContext,
): Result<StoreState> {
  if (!isColorId(color)) return fail("MALFORMED", "Unknown color");
  return ok({
    ...state,
    dayTypes: [...state.dayTypes, { id: ctx.id(), name, color, items: [] }],
  });
}

export function updateDayType(
  state: StoreState,
  id: string,
  patch: { name?: string; color?: ColorId; items?: ChecklistItem[] },
): Result<StoreState> {
  const idx = state.dayTypes.findIndex((t) => t.id === id);
  if (idx < 0) return fail("NOT_FOUND", "Day type not found");
  if (patch.color && !isColorId(patch.color)) {
    return fail("MALFORMED", "Unknown color");
  }
  const dayTypes = state.dayTypes.slice();
  dayTypes[idx] = { ...dayTypes[idx], ...patch };
  return ok({ ...state, dayTypes });
}

function reassign(state: StoreState, from: string, to: string | null): StoreState {
  const defaultWeek = {
    ...state.defaultWeek,
    dayTypeByWeekday: state.defaultWeek.dayTypeByWeekday.map((id) =>
      id === from ? to : id,
    ),
  };
  const years = state.years.map((y) => {
    if (y.status !== "live") return y;
    const detachedWeeks = { ...y.detachedWeeks };
    for (const [k, w] of Object.entries(detachedWeeks)) {
      detachedWeeks[k] = {
        ...w,
        dayTypeByWeekday: w.dayTypeByWeekday.map((id) => (id === from ? to : id)),
      };
    }
    return { ...y, detachedWeeks };
  });
  return { ...state, defaultWeek, years };
}

export function deleteDayType(
  state: StoreState,
  id: string,
  replacementId?: string,
): Result<StoreState> {
  if (!state.dayTypes.some((t) => t.id === id)) {
    return fail("NOT_FOUND", "Day type not found");
  }
  if (replacementId) {
    if (!state.dayTypes.some((t) => t.id === replacementId)) {
      return fail("NOT_FOUND", "Replacement day type not found");
    }
    state = reassign(state, id, replacementId);
  }
  if (dayTypeInUse(state, id)) {
    return fail(
      "DAY_TYPE_IN_USE",
      "Reassign the default week and live detached weeks first",
    );
  }
  return ok({
    ...state,
    dayTypes: state.dayTypes.filter((t) => t.id !== id),
  });
}
