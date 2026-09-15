import type { DefaultWeek, MonthData, StoreState, YearRecord } from "./types.ts";

export function emptyMonth(): MonthData {
  return { objectives: "", notes: "", days: {} };
}

export function emptyDefaultWeek(): DefaultWeek {
  return {
    dayTypeByWeekday: [null, null, null, null, null, null, null],
    weeklyItems: [],
  };
}

export function emptyYear(year: number): YearRecord {
  return {
    year,
    status: "live",
    events: [],
    months: Array.from({ length: 12 }, () => emptyMonth()),
    detachedWeeks: {},
  };
}

export function emptyState(): StoreState {
  return {
    dayTypes: [],
    defaultWeek: emptyDefaultWeek(),
    years: [],
    tasks: [],
    liveDays: {},
    aboutMe: "",
  };
}
