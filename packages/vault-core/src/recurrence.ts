import { compareIso } from "./map/dates.ts";
import { recurringState } from "./map/recurring.ts";
import type { IsoDate, RecurringTask } from "./map/types.ts";
import { periodBounds } from "./period.ts";
import { openReviewPeriod, reviewOpensAt } from "./review-availability.ts";
import { REVIEW_CADENCES } from "./types.ts";
import type {
  ReviewAvailability,
  ReviewCadence,
  ReviewIndexEntry,
  WeekStartDay,
} from "./types.ts";

/**
 * What the Dashboard's recurring block draws, and why it is derived.
 *
 * Two very different things sit in one list because the operator's question is
 * one question — "what comes round that I owe today?":
 *
 *  1. The operator's own recurring tasks, when their next occurrence is owed
 *     TODAY: overdue or due today. A record dated later is not drawn yet, even
 *     when that date falls later in this same week — a scheduled task must not
 *     be dosed a day early, so a daily task due tomorrow belongs on tomorrow's
 *     board, not today's. `recurringState()` still answers "this-week" and
 *     "later" for such records, because the Manage-recurring editor names those
 *     states; only this card's derived list narrows.
 *  2. The five review cadences, which are recurring by nature but are not
 *     records the operator creates: a review is due once its review window has
 *     opened and its overall review is not done. Its truth is the review file,
 *     so its row links there and carries no tick. Review rows need no separate
 *     "due now" filter: `reviewRows()` only builds a row from a window
 *     `openReviewDate()` has already opened, so a later window produces no row
 *     at all — leave that function alone rather than "fixing" it to match the
 *     task side.
 *
 * Nothing here materialises anything. A row exists because a date says it is
 * due, which is why opening the app twice cannot create a card twice.
 *
 * This module is browser-safe (the renderer imports it through
 * `@lifequest/vault-core/pure`), so it may not touch `node:fs`.
 */

export type RecurringDueState = "overdue" | "today" | "this-week";

export type RecurringDueItem = {
  /**
   * A record id, or `review:<cadence>` for a built-in review row. The prefix
   * keeps the two namespaces from ever colliding on a React key.
   */
  id: string;
  kind: "task" | "review";
  title: string;
  /** The occurrence's date. For a review: the local day its window opened. */
  dueDate: IsoDate;
  state: RecurringDueState;
  /** Whole days past due. 0 unless `state` is "overdue". */
  daysLate: number;
  /** Only operator tasks can be ticked; a review clears on its own page. */
  completable: boolean;
  /** The route the row's title links to, or null. */
  link: string | null;
};

/** `YYYY-MM-DD` of a `Date`'s LOCAL calendar day — the day the operator sees. */
function localIso(date: Date): IsoDate {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** Whole days from `earlier` to `later`, both plain local dates. */
function daysBetween(earlier: IsoDate, later: IsoDate): number {
  const [ey, em, ed] = earlier.split("-").map(Number);
  const [ly, lm, ld] = later.split("-").map(Number);
  const a = Date.UTC(ey, em - 1, ed);
  const b = Date.UTC(ly, lm - 1, ld);
  return Math.round((b - a) / 86_400_000);
}

/** The title every built-in review row carries. */
const REVIEW_TITLES: Record<ReviewCadence, string> = {
  daily: "Daily review",
  weekly: "Weekly review",
  monthly: "Monthly review",
  quarterly: "Quarterly review",
  yearly: "Yearly review",
};

/**
 * The due date the vault's own review settings put each cadence on.
 *
 * Exported for the card's copy and for the engine rig: the dashboard row and
 * the Review page must agree about which period is open, and the only way to
 * guarantee that is one call.
 */
export function openReviewDate(
  cadence: ReviewCadence,
  weekStartDay: WeekStartDay,
  availability: ReviewAvailability,
  now: Date = new Date(),
): { period: string; opensAt: Date; day: IsoDate } | null {
  const period = openReviewPeriod(cadence, weekStartDay, availability, now);
  const opensAt = reviewOpensAt(cadence, period, weekStartDay, availability);
  if (!opensAt.ok) return null;
  if (opensAt.value.getTime() > now.getTime()) return null;
  return { period, opensAt: opensAt.value, day: localIso(opensAt.value) };
}

function reviewRows(
  reviews: ReviewIndexEntry[],
  settings: DueSettings,
  now: Date,
  today: IsoDate,
): RecurringDueItem[] {
  const rows: RecurringDueItem[] = [];
  for (const cadence of REVIEW_CADENCES) {
    const open = openReviewDate(cadence, settings.weekStartDay, settings.reviewAvailability, now);
    if (!open) continue;
    // A vault that did not exist yet cannot owe an older period's review. This
    // is what stops a brand-new vault from opening on five "overdue" rows: the
    // year before it existed has no review to write, and a first-week user
    // seeing "Yearly review overdue by 329 days" would rightly distrust the card.
    if (settings.since !== undefined) {
      const bounds = periodBounds(cadence, open.period, settings.weekStartDay);
      if (bounds.ok && bounds.value.end < settings.since) continue;
    }
    const entry = reviews.find(
      (review) => review.cadence === cadence && review.period === open.period,
    );
    // A locked review is a signed-off review: its overall scope cannot be
    // reopened, so it is done whatever a hand-edited index says.
    const done = entry?.locked === true || entry?.scopes?.overall?.status === "done";
    if (done) continue;
    const late = daysBetween(open.day, today);
    rows.push({
      id: `review:${cadence}`,
      kind: "review",
      title: REVIEW_TITLES[cadence],
      dueDate: open.day,
      state: late <= 0 ? "today" : "overdue",
      daysLate: Math.max(0, late),
      completable: false,
      link: `/review/${cadence}`,
    });
  }
  return rows;
}

/** What the due model needs from the vault's settings, plus its own start. */
export type DueSettings = {
  weekStartDay: WeekStartDay;
  reviewAvailability: ReviewAvailability;
  /**
   * The local day the vault was created. Review periods that ended before it
   * are not owed. Omit to ignore the floor.
   */
  since?: IsoDate;
};

/**
 * Merge the two sources into one sorted list.
 *
 * Order is the operator's attention order: what is late first (oldest first),
 * then what is due today; ties by date, then id so two rows on one day cannot
 * swap places between renders. A record due on a future day is not in the list
 * at all: it appears on its own day, never a day early.
 */
export function dueRecurringItems(
  items: RecurringTask[],
  reviews: ReviewIndexEntry[],
  settings: DueSettings,
  now: Date = new Date(),
): RecurringDueItem[] {
  const today = localIso(now);
  const rows: RecurringDueItem[] = [];

  for (const item of items) {
    const state = recurringState(item, today, settings.weekStartDay);
    // Only what is owed NOW is drawn: overdue and due today. "this-week" and
    // "later" records stay in the model (the Manage-recurring editor names those
    // states), and "paused" is not owed at all — none of them belongs on the
    // card before its day.
    if (state !== "overdue" && state !== "today") continue;
    rows.push({
      id: item.id,
      kind: "task",
      title: item.title,
      dueDate: item.dueDate,
      state,
      daysLate: state === "overdue" ? Math.max(0, daysBetween(item.dueDate, today)) : 0,
      completable: true,
      link: item.link ?? null,
    });
  }

  rows.push(...reviewRows(reviews, settings, now, today));

  const rank: Record<RecurringDueState, number> = {
    overdue: 0,
    today: 1,
    // Unreachable from this function now: the loop above drops every task row
    // whose state is not "overdue" or "today", and a review row is only ever
    // "overdue" or "today". The entry stays because `RecurringDueState` still
    // carries "this-week" for the manager, and the map must cover the type.
    "this-week": 2,
  };
  return rows.sort((a, b) => {
    const byState = rank[a.state] - rank[b.state];
    if (byState !== 0) return byState;
    return compareIso(a.dueDate, b.dueDate) || a.id.localeCompare(b.id);
  });
}

/**
 * The next occurrence the editor shows when a cadence is picked lives beside
 * the cadence helpers in `map/recurring.ts`; the renderer imports it from
 * `@lifequest/vault-core/map` so this module stays about "what is due", not
 * about dates in general.
 */
