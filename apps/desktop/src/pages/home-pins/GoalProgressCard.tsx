import type { Goal } from "@lifequest/vault-core";
import {
  filterByLens,
  formatGoalPace,
  goalPace,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { BuiltInBadge } from "@/components/home/BuiltInBadge";

/**
 * A goal's progress as a percentage of its target, clamped to the bar.
 *
 * The bar is a reading of the goal, not a score: it never exceeds its own width,
 * and a goal with no target gets no bar at all.
 */
function goalPercent(goal: Goal): number | null {
  if (goal.target === null || goal.target <= 0) return null;
  const current = goal.current ?? 0;
  return Math.max(0, Math.min(100, Math.round((current / goal.target) * 100)));
}

export function GoalProgressCard() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const [goalBusyId, setGoalBusyId] = useState<string | null>(null);
  const [pendingDoneId, setPendingDoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openGoals = useMemo(() => {
    const goals = snapshot?.goals ?? [];
    return filterByLens(goals, lens).filter((g) => g.status === "open");
  }, [snapshot?.goals, lens]);

  /** The domain a goal is filed under, if it still exists. */
  function domainOf(goal: Goal) {
    if (!goal.domainSlug) return null;
    return (
      (snapshot?.domains ?? []).find((d) => d.slug === goal.domainSlug) ?? null
    );
  }

  async function applyGoalUpdate(
    goalId: string,
    patch: { current?: number | null; status?: "done" },
  ) {
    setGoalBusyId(goalId);
    setError(null);
    try {
      const result = await api().goalsApply({
        type: "updateGoal",
        id: goalId,
        ...patch,
      });
      if (!result.ok) {
        setError(result.error);
        setPendingDoneId(null);
        return;
      }
      await refresh();
      setPendingDoneId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply goal");
      setPendingDoneId(null);
    } finally {
      setGoalBusyId(null);
    }
  }

  function onCurrentChange(goal: Goal, raw: string) {
    if (goalBusyId) return;
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    if (n === (goal.current ?? 0)) return;
    void applyGoalUpdate(goal.id, { current: n });
  }

  function onDefinitionDone(goal: Goal, checked: boolean) {
    if (!checked || goalBusyId) return;
    setPendingDoneId(goal.id);
    void applyGoalUpdate(goal.id, { status: "done" });
  }

  return (
    <section className="home-card home-goal-card">
      <h2 className="home-card__title">
        Goals
        <BuiltInBadge />
        {openGoals.length > 0 ? (
          <span className="home-card__count">{openGoals.length}</span>
        ) : null}
      </h2>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {openGoals.length === 0 ? (
        <p className="muted home-card__empty">No open goals in this lens.</p>
      ) : (
        <ul className="home-mini-list home-goal-list">
          {openGoals.map((goal) => {
            const numeric = goal.metric !== null && goal.target !== null;
            const paceText = numeric ? formatGoalPace(goalPace(goal)) : null;
            const percent = goalPercent(goal);
            const bus = goalBusyId === goal.id;
            const domain = domainOf(goal);
            return (
              <li key={goal.id} className="home-mini-list__item home-goal-row">
                <div className="home-goal-row__head">
                  <span className="home-goal-row__name">{goal.name}</span>
                  <span
                    className={
                      domain
                        ? "home-goal-row__domain"
                        : "home-goal-row__domain is-unassigned"
                    }
                    title={
                      domain
                        ? `Filed under ${domain.meta.name}`
                        : "Not filed under an area"
                    }
                  >
                    <span
                      className="home-goal-row__domain-dot"
                      style={
                        domain?.meta.color
                          ? { background: domain.meta.color }
                          : undefined
                      }
                      aria-hidden
                    />
                    {domain?.meta.name ?? "No area"}
                  </span>
                </div>
                {numeric ? (
                  <>
                    <div className="home-goal-row__measure muted">
                      <label className="home-goal-row__current">
                        <span className="visually-hidden">Current</span>
                        <input
                          type="number"
                          className="home-goal-current-input"
                          defaultValue={goal.current ?? 0}
                          key={`${goal.id}-${goal.current ?? 0}`}
                          disabled={bus}
                          onBlur={(e) => onCurrentChange(goal, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </label>
                      <span>
                        / {goal.target} {goal.metric}
                      </span>
                      {paceText ? (
                        <span className="home-goal-row__pace">{paceText}</span>
                      ) : null}
                    </div>
                    {percent !== null ? (
                      <div
                        className="home-goal-row__bar"
                        role="progressbar"
                        aria-label={`${goal.name} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <span
                          className="home-goal-row__bar-fill"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    ) : null}
                  </>
                ) : goal.definitionOfDone ? (
                  <label className="home-goal-row__dod">
                    <input
                      type="checkbox"
                      checked={pendingDoneId === goal.id}
                      disabled={bus}
                      onChange={(e) => onDefinitionDone(goal, e.target.checked)}
                    />
                    <span className="muted">{goal.definitionOfDone}</span>
                  </label>
                ) : (
                  <span className="muted home-mini-list__meta">Open</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/goals" className="home-card__more">
        Open Goals →
      </Link>
    </section>
  );
}
