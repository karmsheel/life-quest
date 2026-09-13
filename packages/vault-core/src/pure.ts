/** Browser-safe pure helpers (no node:fs / node:crypto). */
export * from "./types.ts";
export * from "./frontmatter.ts";
export * from "./documents.ts";
export * from "./unlock.ts";
export * from "./domain-lens.ts";
export { formatGoalPace, goalPace, daysUntilDeadline, deadlinePressureGoals } from "./goal-progress.ts";
export type { GoalPace } from "./goal-progress.ts";
