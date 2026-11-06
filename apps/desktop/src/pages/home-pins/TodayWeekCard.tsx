import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Task } from "@lifequest/vault-core/map";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { BuiltInBadge } from "@/components/home/BuiltInBadge";

/**
 * Today and this week, with the one action the card can take for you.
 *
 * The tasks here are the Act board's own cards in their two nearest columns. A
 * tick moves the task to Done — the same `moveTask` command the board's drag
 * writes — so the operator can finish the day without leaving the Dashboard.
 * The tick is disabled while its write is in flight, and a refused write says so
 * on the card rather than looking like it worked.
 */
export function TodayWeekCard() {
  const { snapshot, refresh } = useVault();
  const [doneBusyId, setDoneBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "today"),
    [snapshot?.map?.tasks],
  );
  const weekTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "this-week"),
    [snapshot?.map?.tasks],
  );

  async function markDone(task: Task) {
    if (doneBusyId) return;
    setDoneBusyId(task.id);
    setError(null);
    try {
      const result = await api().mapApply({
        type: "moveTask",
        id: task.id,
        column: "done",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    } finally {
      setDoneBusyId(null);
    }
  }

  function taskList(tasks: Task[], emptyText: string) {
    if (tasks.length === 0) {
      return <p className="muted home-card__empty">{emptyText}</p>;
    }
    return (
      <ul className="home-task-list">
        {tasks.map((task) => {
          const busy = doneBusyId === task.id;
          return (
            <li key={task.id} className="home-task-row">
              <input
                type="checkbox"
                className="home-task-row__check"
                checked={busy}
                disabled={doneBusyId !== null}
                onChange={() => void markDone(task)}
                aria-label={`Mark "${task.title}" done`}
                title="Mark done"
              />
              <span className="home-task-row__title">{task.title}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="home-card home-card--wide home-task-card">
      <h2 className="home-card__title">
        Today &amp; this week
        <BuiltInBadge />
      </h2>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="home-task-cols">
        <div>
          <h3 className="home-task-cols__head">
            Today <span className="home-task-cols__count">{todayTasks.length}</span>
          </h3>
          {taskList(todayTasks, "No tasks today.")}
        </div>
        <div>
          <h3 className="home-task-cols__head">
            This week <span className="home-task-cols__count">{weekTasks.length}</span>
          </h3>
          {taskList(weekTasks, "Nothing queued this week.")}
        </div>
      </div>
      <Link to="/act" className="home-card__more">
        Open Act →
      </Link>
    </section>
  );
}
