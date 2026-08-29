import type { IsoDate } from "./types.ts";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isDateInYear(date: IsoDate, year: number): boolean {
  return isIsoDate(date) && yearOf(date) === year;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utc(date: IsoDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(dt: Date): IsoDate {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function mondayOnOrBefore(date: IsoDate): IsoDate {
  const dt = utc(date);
  const day = dt.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  dt.setUTCDate(dt.getUTCDate() - back);
  return toIso(dt);
}

export function mondaysInYear(year: number): IsoDate[] {
  const first = mondayOnOrBefore(`${year}-01-01`);
  const start = yearOf(first) === year ? first : addDays(first, 7);
  const out: IsoDate[] = [];
  let cur = start;
  while (yearOf(cur) === year) {
    out.push(cur);
    cur = addDays(cur, 7);
  }
  return out;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const dt = utc(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIso(dt);
}

export function todayLocalIso(now = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
