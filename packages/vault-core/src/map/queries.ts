import { compareIso, daysInMonth } from "./dates.ts";
import type { ColorId, IsoDate, PeriodGoal, YearRecord } from "./types.ts";

export function periodGoalsOverlappingMonth(
  year: YearRecord,
  month: number,
): PeriodGoal[] {
  const start = `${year.year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year.year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year.year, month)).padStart(2, "0")}`;
  return year.periodGoals.filter(
    (g) => compareIso(g.start, end) <= 0 && compareIso(g.end, start) >= 0,
  );
}

export function periodGoalsOnDate(year: YearRecord, date: IsoDate): PeriodGoal[] {
  return year.periodGoals.filter(
    (g) => compareIso(g.start, date) <= 0 && compareIso(g.end, date) >= 0,
  );
}

export function dashboardDays(
  year: YearRecord,
  month: number,
): { day: number; colors: ColorId[] }[] {
  const n = daysInMonth(year.year, month);
  const out: { day: number; colors: ColorId[] }[] = [];
  for (let day = 1; day <= n; day++) {
    const date = `${year.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push({ day, colors: periodGoalsOnDate(year, date).map((g) => g.color) });
  }
  return out;
}
