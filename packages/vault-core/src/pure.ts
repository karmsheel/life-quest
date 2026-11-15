/** Browser-safe pure helpers (no node:fs / node:crypto). */
export * from "./types.ts";
export * from "./chat-questions.ts";
export * from "./decision-inbox.ts";
// Browser-safe: imports only `period.ts`/`types.ts`, so the renderer can answer
// "which review is open" with the same rules the engine gates writes with.
export * from "./review-availability.ts";
export * from "./frontmatter.ts";
export * from "./documents.ts";
export * from "./unlock.ts";
export * from "./domain-lens.ts";
export * from "./automation-core.ts";
export { formatGoalPace, goalPace, daysUntilDeadline, deadlinePressureGoals } from "./goal-progress.ts";
export type { GoalPace } from "./goal-progress.ts";
export {
  isReviewCadence,
  isWeekStartDay,
  todayLocalIso as periodTodayLocalIso,
  weekStartOnOrBefore,
  currentPeriod,
  periodBounds,
  previousPeriod,
  nextPeriod,
  isFuturePeriod,
  isCurrentPeriod,
  periodTitle,
  isValidLocalIsoDate,
  shiftLocalIsoDate,
  formatLocalIsoDate,
  formatLocalIsoDayMonth,
  isoWeekOf,
  type IsoWeek,
} from "./period.ts";
