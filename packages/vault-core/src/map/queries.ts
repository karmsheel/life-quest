import { daysInMonth } from "./dates.ts";
import type { IsoDate, MapEvent, YearRecord } from "./types.ts";

export function eventsInMonth(year: YearRecord, month: number): MapEvent[] {
  const prefix = `${year.year}-${String(month).padStart(2, "0")}-`;
  return year.events.filter((e) => e.date.startsWith(prefix));
}

export function eventsOnDate(year: YearRecord, date: IsoDate): MapEvent[] {
  return year.events.filter((e) => e.date === date);
}

export function dashboardDays(
  year: YearRecord,
  month: number,
): { day: number; events: MapEvent[] }[] {
  const n = daysInMonth(year.year, month);
  const out: { day: number; events: MapEvent[] }[] = [];
  for (let day = 1; day <= n; day++) {
    const date = `${year.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push({ day, events: eventsOnDate(year, date) });
  }
  return out;
}
