import type { Goal } from "./types.ts";

export type GoalPace = {
  daysLeft: number;
  remaining: number;
  metric: string;
  current: number;
  target: number;
};

type PaceInput = Pick<Goal, "metric" | "target" | "current" | "deadline">;

function daysBetweenUtc(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Quiet remaining-days / remaining-units pace for numeric goals with a deadline.
 * Does not invent a start date or expected linear track.
 */
export function goalPace(
  goal: PaceInput,
  todayIso?: string,
): GoalPace | null {
  if (
    goal.metric === null ||
    goal.target === null ||
    goal.deadline === null ||
    goal.deadline === ""
  ) {
    return null;
  }
  const today =
    todayIso ??
    (() => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();
  const current = goal.current ?? 0;
  const remaining = Math.max(0, goal.target - current);
  const daysLeft = daysBetweenUtc(today, goal.deadline);
  return {
    daysLeft,
    remaining,
    metric: goal.metric,
    current,
    target: goal.target,
  };
}

export function formatGoalPace(pace: GoalPace | null): string | null {
  if (!pace) return null;
  const dayLabel =
    pace.daysLeft === 1
      ? "1 day left"
      : pace.daysLeft < 0
        ? `${Math.abs(pace.daysLeft)} days overdue`
        : `${pace.daysLeft} days left`;
  return `${dayLabel} · ${pace.remaining} ${pace.metric} remaining`;
}
