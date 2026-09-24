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
    <section className="home-card home-card--wide">
      <h2 className="home-card__title">
        Goals
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
            const busy = goalBusyId === goal.id;
            return (
              <li key={goal.id} className="home-mini-list__item home-goal-row">
                <div className="home-goal-row__main">
                  <span className="home-mini-list__link">{goal.name}</span>
                  {numeric ? (
                    <div className="home-goal-row__measure muted">
                      <label className="home-goal-row__current">
                        <span className="visually-hidden">Current</span>
                        <input
                          type="number"
                          className="home-goal-current-input"
                          defaultValue={goal.current ?? 0}
                          key={`${goal.id}-${goal.current ?? 0}`}
                          disabled={busy}
                          onBlur={(e) => onCurrentChange(goal, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </label>
                      <span>/ {goal.target} {goal.metric}</span>
                      {paceText ? (
                        <span className="home-goal-row__pace">{paceText}</span>
                      ) : null}
                    </div>
                  ) : goal.definitionOfDone ? (
                    <label className="home-goal-row__dod">
                      <input
                        type="checkbox"
                        checked={pendingDoneId === goal.id}
                        disabled={busy}
                        onChange={(e) => onDefinitionDone(goal, e.target.checked)}
                      />
                      <span className="muted">{goal.definitionOfDone}</span>
                    </label>
                  ) : (
                    <span className="muted home-mini-list__meta">Open</span>
                  )}
                </div>
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
