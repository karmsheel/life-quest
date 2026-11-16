import {
  currentPeriod,
  periodBounds,
  previousPeriod,
  shiftLocalIsoDate,
} from "./period.ts";
import {
  REVIEW_CADENCES,
  type Result,
  type ReviewAvailability,
  type ReviewCadence,
  type ReviewWindow,
  type WeekStartDay,
} from "./types.ts";

/**
 * When a cadence's new review becomes writable.
 *
 * A review is written about a period, and a period that has only just started
 * has nothing to reflect on: a Monday weekly review is meant to be written on
 * the Sunday, a monthly review near the end of the month. Each cadence therefore
 * has a WINDOW, expressed as "N days before the period's last day, at a local
 * wall-clock time". Before that instant the app shows the PREVIOUS period's
 * review — the newest one whose window has opened.
 *
 * Why this is a pure module of its own, and not logic inside `reviews.ts`:
 *
 * - The renderer's Review page has to ask "which review is open?" before it can
 *   draw anything, and it must answer exactly the way the engine does when it
 *   gates a write. Two implementations would drift, and the operator would see
 *   the board say "today's review" over a write the engine refuses.
 * - The Settings page validates its own edits before saving, and the same rules
 *   have to apply on the read side of a hand-edited `settings.json`, so both the
 *   tolerant read (`reviewAvailabilityFromUnknown`) and the strict write
 *   (`parseReviewAvailabilityPatch`) live here rather than in a page.
 *
 * The module is deliberately dependency-free apart from `period.ts` and
 * `types.ts` (no `node:fs`, no `node:crypto`) so it is browser-safe and can be
 * bundled into the renderer.
 */

/** The longest lead time a window may carry. A year is not a review window. */
export const REVIEW_WINDOW_MAX_DAYS = 60;

/**
 * The defaults, in the operator's words:
 *
 * - daily opens on its own day at 18:00 (before 18:00 yesterday's review is the
 *   current one)
 * - weekly opens on the week's last day at 08:00 — the last day follows the
 *   vault's `weekStartDay`, so a Monday-start week closes on Sunday
 * - monthly opens on the second-last day at 00:00
 * - quarterly opens on the third-last day of the quarter at 00:00
 * - yearly opens in the last week of the year: 6 days before 31 December, so
 *   25 December, at 00:00
 *
 * The full week/six-days lead times are why `REVIEW_WINDOW_MAX_DAYS` is a guard
 * on hand-edited settings rather than a real limit: 60 days comfortably covers
 * every cadence and still refuses a mistyped "180".
 */
export const DEFAULT_REVIEW_AVAILABILITY: ReviewAvailability = {
  daily: { daysBeforeEnd: 0, timeOfDay: "18:00" },
  weekly: { daysBeforeEnd: 0, timeOfDay: "08:00" },
  monthly: { daysBeforeEnd: 1, timeOfDay: "00:00" },
  quarterly: { daysBeforeEnd: 2, timeOfDay: "00:00" },
  yearly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
};

/** The month labels used by `formatReviewOpening`; fixed so output has no locale. */
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

/** A 24-hour local wall-clock time, `HH:MM`, hours 00–23 and minutes 00–59. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The zero-lead sentence for each cadence: a window that opens on the period's
 * last day names that day because "the last day" means a different calendar day
 * per cadence (a daily one is today, a weekly one the week's last day).
 */
const OPENS_ON_LAST_DAY: Record<ReviewCadence, string> = {
  daily: "Opens each day at",
  weekly: "Opens on the week's last day at",
  monthly: "Opens on the month's last day at",
  quarterly: "Opens on the quarter's last day at",
  yearly: "Opens on the year's last day at",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The narrowing form of `isReviewTimeOfDay`.
 *
 * The exported predicate answers a plain boolean (that is the shape callers
 * read), but the parsers below need the compiler to know the string survives
 * the check before they store it, so the guard itself carries the type.
 */
function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY.test(value);
}

/** True for a well-formed `HH:MM` 24-hour time. */
export function isReviewTimeOfDay(value: unknown): boolean {
  return isTimeOfDay(value);
}

/**
 * A fresh copy of the defaults.
 *
 * Settings ownership: a new vault seeds these, and an old vault whose
 * `settings.json` predates the key reads them. Both get their own object so a
 * settings write can never mutate the exported constant and change what the
 * next vault is born with.
 */
export function defaultReviewAvailability(): ReviewAvailability {
  const out = {} as ReviewAvailability;
  for (const cadence of REVIEW_CADENCES) {
    out[cadence] = { ...DEFAULT_REVIEW_AVAILABILITY[cadence] };
  }
  return out;
}

/**
 * Tolerant read for a settings file: a missing, legacy, or hand-edited value
 * falls back per cadence and per field, so one bad `timeOfDay` never resets a
 * cadence's `daysBeforeEnd` as well. This is the shape `openVault` hands the
 * renderer and the value `updateSettings` merges patches over — not the shape a
 * write accepts.
 */
export function reviewAvailabilityFromUnknown(value: unknown): ReviewAvailability {
  const source = isRecord(value) ? value : {};
  const out = {} as ReviewAvailability;
  for (const cadence of REVIEW_CADENCES) {
    const raw = source[cadence];
    const win = isRecord(raw) ? raw : {};
    const days = win.daysBeforeEnd;
    const time = win.timeOfDay;
    out[cadence] = {
      daysBeforeEnd:
        typeof days === "number" &&
        Number.isInteger(days) &&
        days >= 0 &&
        days <= REVIEW_WINDOW_MAX_DAYS
          ? days
          : DEFAULT_REVIEW_AVAILABILITY[cadence].daysBeforeEnd,
      timeOfDay: isTimeOfDay(time)
        ? time
        : DEFAULT_REVIEW_AVAILABILITY[cadence].timeOfDay,
    };
  }
  return out;
}

/**
 * Strict read for a write: every field a patch carries has to be a real value,
 * because silently coercing `"18"` or `-1` would save a window the operator did
 * not choose. The patch is merged per cadence over `base` (what is stored), so
 * editing the daily window never rewrites the other four, and the merged object
 * is returned whole.
 *
 * Unknown extra keys are ignored, like the rest of the settings write path: a
 * later build may add one, and refusing the whole save over an unrecognized key
 * would make the settings page unable to save at all on an older vault.
 */
export function parseReviewAvailabilityPatch(
  value: unknown,
  base: ReviewAvailability,
): Result<ReviewAvailability> {
  if (!isRecord(value)) {
    return { ok: false, error: "reviewAvailability must be an object" };
  }
  // The stored value is normalized first, so `base` may itself be a legacy or
  // hand-edited object without polluting the merged result.
  const merged = reviewAvailabilityFromUnknown(base);
  for (const cadence of REVIEW_CADENCES) {
    const raw = value[cadence];
    if (raw === undefined) continue;
    if (!isRecord(raw)) {
      return { ok: false, error: `reviewAvailability.${cadence} must be an object` };
    }
    const win: ReviewWindow = { ...merged[cadence] };

    if (raw.daysBeforeEnd !== undefined) {
      const days = raw.daysBeforeEnd;
      if (typeof days !== "number" || !Number.isInteger(days)) {
        return {
          ok: false,
          error: `reviewAvailability.${cadence}.daysBeforeEnd must be a whole number`,
        };
      }
      if (days < 0) {
        return {
          ok: false,
          error: `reviewAvailability.${cadence}.daysBeforeEnd must not be negative`,
        };
      }
      if (days > REVIEW_WINDOW_MAX_DAYS) {
        return {
          ok: false,
          error: `reviewAvailability.${cadence}.daysBeforeEnd must be at most ${REVIEW_WINDOW_MAX_DAYS}`,
        };
      }
      win.daysBeforeEnd = days;
    }

    if (raw.timeOfDay !== undefined) {
      const time = raw.timeOfDay;
      if (!isTimeOfDay(time)) {
        return {
          ok: false,
          error: `reviewAvailability.${cadence}.timeOfDay must be a 24-hour time like 18:00`,
        };
      }
      win.timeOfDay = time;
    }

    merged[cadence] = win;
  }
  return { ok: true, value: merged };
}

/**
 * The window one cadence is using, read tolerantly.
 *
 * The helpers below are public pure API and get handed whatever the settings
 * JSON held, so they normalize here instead of trusting the caller. A
 * hand-written `"25:00"` must not produce a Date that silently rolls into the
 * next day.
 */
function windowOf(
  cadence: ReviewCadence,
  availability: ReviewAvailability,
): ReviewWindow {
  return reviewAvailabilityFromUnknown(availability)[cadence];
}

/**
 * The instant a period's review opens.
 *
 * `daysBeforeEnd` is counted back from the period's last calendar day, and the
 * result is built as a LOCAL `Date` from the calendar components — never by
 * adding milliseconds to an epoch — so the wall-clock time is the one the
 * operator set even across a daylight-saving change.
 */
export function reviewOpensAt(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
  availability: ReviewAvailability,
): Result<Date> {
  const bounds = periodBounds(cadence, period, weekStartDay);
  if (!bounds.ok) return bounds;

  const win = windowOf(cadence, availability);
  const openingDay = shiftLocalIsoDate(
    bounds.value.end,
    -win.daysBeforeEnd,
  );
  if (!openingDay) {
    return { ok: false, error: `Invalid ${cadence} period: ${period}` };
  }
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(openingDay);
  if (!parts) {
    return { ok: false, error: `Invalid ${cadence} period: ${period}` };
  }
  const hour = Number(win.timeOfDay.slice(0, 2));
  const minute = Number(win.timeOfDay.slice(3, 5));
  return {
    ok: true,
    value: new Date(
      Number(parts[1]),
      Number(parts[2]) - 1,
      Number(parts[3]),
      hour,
      minute,
      0,
      0,
    ),
  };
}

/** True when `period`'s review may be written at `now`. */
export function isReviewWindowOpen(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
  availability: ReviewAvailability,
  now: Date = new Date(),
): boolean {
  const opensAt = reviewOpensAt(cadence, period, weekStartDay, availability);
  return opensAt.ok && opensAt.value.getTime() <= now.getTime();
}

/**
 * The period whose review is the current one at `now`: the latest period whose
 * window has opened.
 *
 * This is "which review does the board show", not "which period is this
 * calendar period": before a daily review's 18:00, today's review does not
 * exist yet and yesterday's is the one that opened, so yesterday's is answered.
 * The walk starts from the calendar's current period and moves backwards, which
 * is why a six-day yearly lead works without any cadence-specific date math.
 */
export function openReviewPeriod(
  cadence: ReviewCadence,
  weekStartDay: WeekStartDay,
  availability: ReviewAvailability,
  now: Date = new Date(),
): string {
  const moment = now.getTime();
  let candidate = currentPeriod(cadence, weekStartDay, now);
  // The bound is a guard, not an expectation: the widest default leads by six
  // days and a week-long window still only steps back twice. A candidate that
  // cannot be dated is returned as-is rather than walked past, because there is
  // no earlier period to prefer when the current key is malformed.
  for (let step = 0; step < 400; step += 1) {
    const opensAt = reviewOpensAt(cadence, candidate, weekStartDay, availability);
    if (!opensAt.ok) return candidate;
    if (opensAt.value.getTime() <= moment) return candidate;
    const previous = previousPeriod(cadence, candidate, weekStartDay);
    if (!previous.ok) return candidate;
    candidate = previous.value;
  }
  return candidate;
}

/**
 * The operator-facing label for an opening instant, e.g. `20 Sep 2026 at 08:00`.
 *
 * Deterministic and locale-free on purpose: this string is read back by tests
 * and by the "it opens …" refusal, so the same instant must always spell the
 * same way whatever the machine's locale is.
 */
export function formatReviewOpening(openedAt: Date): string {
  const day = openedAt.getDate();
  const month = MONTH_SHORT[openedAt.getMonth()];
  const hours = String(openedAt.getHours()).padStart(2, "0");
  const minutes = String(openedAt.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${openedAt.getFullYear()} at ${hours}:${minutes}`;
}

/**
 * The one-line description of a window the Settings page prints under it.
 *
 * A zero-day window is cadence-specific ("the week's last day") because that is
 * what it means; a lead time is the same sentence for every cadence.
 */
export function reviewWindowSummary(
  window: ReviewWindow,
  cadence: ReviewCadence,
): string {
  const time = isTimeOfDay(window.timeOfDay)
    ? window.timeOfDay
    : DEFAULT_REVIEW_AVAILABILITY[cadence].timeOfDay;
  const days =
    typeof window.daysBeforeEnd === "number" &&
    Number.isInteger(window.daysBeforeEnd) &&
    window.daysBeforeEnd > 0
      ? window.daysBeforeEnd
      : 0;
  if (days > 0) {
    // Singular at 1: "1 day", not "1 days".
    return `Opens ${days} day${days === 1 ? "" : "s"} before the period ends, at ${time}.`;
  }
  return `${OPENS_ON_LAST_DAY[cadence]} ${time}.`;
}
