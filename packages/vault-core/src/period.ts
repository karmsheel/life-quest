import {
  REVIEW_CADENCES,
  type Result,
  type ReviewCadence,
  type WeekStartDay,
} from "./types.ts";

export { REVIEW_CADENCES, type ReviewCadence };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;
const YEAR = /^(\d{4})$/;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function isReviewCadence(value: string): value is ReviewCadence {
  return (REVIEW_CADENCES as readonly string[]).includes(value);
}

export function isWeekStartDay(value: string): value is WeekStartDay {
  return value === "monday" || value === "sunday";
}

export function todayLocalIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utc(date: string): Date | null {
  const m = ISO.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function toIso(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: string, days: number): string | null {
  const dt = utc(date);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIso(dt);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDay(date: string): string {
  const dt = utc(date);
  if (!dt) return date;
  const day = dt.getUTCDate();
  const month = MONTH_SHORT[dt.getUTCMonth()];
  return `${day} ${month} ${dt.getUTCFullYear()}`;
}

export function weekStartOnOrBefore(
  date: string,
  weekStartDay: WeekStartDay,
): string {
  const dt = utc(date);
  if (!dt) return date;
  const dow = dt.getUTCDay();
  const back = weekStartDay === "monday" ? (dow === 0 ? 6 : dow - 1) : dow;
  dt.setUTCDate(dt.getUTCDate() - back);
  return toIso(dt);
}

export function currentPeriod(
  cadence: ReviewCadence,
  weekStartDay: WeekStartDay,
  now?: Date,
): string {
  const today = todayLocalIso(now);
  if (cadence === "daily") return today;
  if (cadence === "weekly") return weekStartOnOrBefore(today, weekStartDay);
  if (cadence === "monthly") return today.slice(0, 7);
  if (cadence === "quarterly") {
    const month = Number(today.slice(5, 7));
    const q = Math.ceil(month / 3);
    return `${today.slice(0, 4)}-Q${q}`;
  }
  return today.slice(0, 4);
}

export function periodBounds(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
): Result<{ start: string; end: string }> {
  if (cadence === "daily") {
    if (!utc(period)) return { ok: false, error: `Invalid daily period: ${period}` };
    return { ok: true, value: { start: period, end: period } };
  }
  if (cadence === "weekly") {
    if (!utc(period) || weekStartOnOrBefore(period, weekStartDay) !== period) {
      return { ok: false, error: `Invalid weekly period: ${period}` };
    }
    const end = addDays(period, 6);
    if (!end) return { ok: false, error: `Invalid weekly period: ${period}` };
    return { ok: true, value: { start: period, end } };
  }
  if (cadence === "monthly") {
    const m = MONTH.exec(period);
    if (!m) return { ok: false, error: `Invalid monthly period: ${period}` };
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) {
      return { ok: false, error: `Invalid monthly period: ${period}` };
    }
    const start = `${period}-01`;
    const endDay = String(daysInMonth(year, month)).padStart(2, "0");
    return { ok: true, value: { start, end: `${period}-${endDay}` } };
  }
  if (cadence === "quarterly") {
    const q = QUARTER.exec(period);
    if (!q) return { ok: false, error: `Invalid quarterly period: ${period}` };
    const year = q[1];
    const n = Number(q[2]);
    const startMonth = (n - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    const endDay = String(daysInMonth(Number(year), endMonth)).padStart(2, "0");
    return {
      ok: true,
      value: {
        start,
        end: `${year}-${String(endMonth).padStart(2, "0")}-${endDay}`,
      },
    };
  }
  const y = YEAR.exec(period);
  if (!y) return { ok: false, error: `Invalid yearly period: ${period}` };
  return { ok: true, value: { start: `${period}-01-01`, end: `${period}-12-31` } };
}

function shiftMonthly(period: string, delta: number): Result<string> {
  const m = MONTH.exec(period);
  if (!m) return { ok: false, error: `Invalid monthly period: ${period}` };
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  if (month < 1) {
    return {
      ok: true,
      value: `${year - 1}-12`,
    };
  }
  return { ok: true, value: `${year}-${String(month).padStart(2, "0")}` };
}

function shiftQuarterly(period: string, delta: number): Result<string> {
  const q = QUARTER.exec(period);
  if (!q) return { ok: false, error: `Invalid quarterly period: ${period}` };
  const idx = Number(q[1]) * 4 + (Number(q[2]) - 1) + delta;
  const year = Math.floor(idx / 4);
  let n = (idx % 4) + 1;
  if (n <= 0) {
    return { ok: true, value: `${year - 1}-Q${n + 4}` };
  }
  return { ok: true, value: `${year}-Q${n}` };
}

export function previousPeriod(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
): Result<string> {
  const bounds = periodBounds(cadence, period, weekStartDay);
  if (!bounds.ok) return bounds;
  if (cadence === "daily" || cadence === "weekly") {
    const next = addDays(period, cadence === "daily" ? -1 : -7);
    if (!next) return { ok: false, error: `Invalid ${cadence} period: ${period}` };
    return { ok: true, value: next };
  }
  if (cadence === "monthly") return shiftMonthly(period, -1);
  if (cadence === "quarterly") return shiftQuarterly(period, -1);
  const y = YEAR.exec(period);
  if (!y) return { ok: false, error: `Invalid yearly period: ${period}` };
  return { ok: true, value: String(Number(period) - 1) };
}

export function nextPeriod(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
): Result<string> {
  const bounds = periodBounds(cadence, period, weekStartDay);
  if (!bounds.ok) return bounds;
  if (cadence === "daily" || cadence === "weekly") {
    const next = addDays(period, cadence === "daily" ? 1 : 7);
    if (!next) return { ok: false, error: `Invalid ${cadence} period: ${period}` };
    return { ok: true, value: next };
  }
  if (cadence === "monthly") return shiftMonthly(period, 1);
  if (cadence === "quarterly") return shiftQuarterly(period, 1);
  const y = YEAR.exec(period);
  if (!y) return { ok: false, error: `Invalid yearly period: ${period}` };
  return { ok: true, value: String(Number(period) + 1) };
}

export function isCurrentPeriod(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
  now?: Date,
): boolean {
  return period === currentPeriod(cadence, weekStartDay, now);
}

export function isFuturePeriod(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
  now?: Date,
): boolean {
  const bounds = periodBounds(cadence, period, weekStartDay);
  if (!bounds.ok) return false;
  return period > currentPeriod(cadence, weekStartDay, now);
}

export function periodTitle(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
): string {
  if (cadence === "daily") return `Daily review · ${formatDay(period)}`;
  if (cadence === "weekly") {
    void weekStartDay;
    return `Weekly review · Week of ${formatDay(period)}`;
  }
  if (cadence === "monthly") {
    const m = MONTH.exec(period);
    if (!m) return `Monthly review · ${period}`;
    return `Monthly review · ${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}`;
  }
  if (cadence === "quarterly") {
    const q = QUARTER.exec(period);
    if (!q) return `Quarterly review · ${period}`;
    return `Quarterly review · ${q[1]} Q${q[2]}`;
  }
  return `Yearly review · ${period}`;
}
