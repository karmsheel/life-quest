import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { todayLocalIso, type Task } from "@lifequest/vault-core/map";
import {
  dueRecurringItems,
  type RecurringDueItem,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { dueStateLabel } from "@/lib/recurring-copy";
import { useVault } from "@/state/VaultProvider";
import { BuiltInBadge } from "@/components/home/BuiltInBadge";

/**
 * The local calendar day a vault was created on.
 *
 * The review rows are floored at it: a vault that did not exist yet cannot owe
 * an older period's review, so a brand-new vault does not open on a stack of
 * "overdue" rows for weeks before it existed. `undefined` lets the engine skip
 * the floor when the timestamp is unreadable rather than hiding reviews.
 */
function localDayOf(timestamp: string): string | undefined {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return undefined;
  return todayLocalIso(at);
}

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
  const [recurringBusyId, setRecurringBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "today"),
    [snapshot?.map?.tasks],
  );
  const weekTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "this-week"),
    [snapshot?.map?.tasks],
  );

  /**
   * What comes round and is due now — the operator's own records plus the
   * built-in review cadences, derived on this render rather than stored.
   * `new Date()` is the local clock, so a card left open overnight re-asks when
   * the vault refreshes.
   */
  const recurring = useMemo<RecurringDueItem[]>(() => {
    if (!snapshot?.map) return [];
    const since = localDayOf(snapshot.lifequest.createdAt);
    return dueRecurringItems(
      snapshot.map.recurring ?? [],
      snapshot.reviews,
      {
        weekStartDay: snapshot.settings.weekStartDay,
        reviewAvailability: snapshot.settings.reviewAvailability,
        ...(since ? { since } : {}),
      },
      new Date(),
    );
  }, [snapshot]);

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

  /**
   * Tick one occurrence. The record advances its own due date, which is why the
   * row leaves this card rather than moving to a Done column — a recurring task
   * is a schedule, not a card on the board.
   */
  async function markRecurringDone(item: RecurringDueItem) {
    if (recurringBusyId) return;
    setRecurringBusyId(item.id);
    setError(null);
    try {
      const result = await api().mapApply({
        type: "completeRecurring",
        id: item.id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to complete recurring task",
      );
    } finally {
      setRecurringBusyId(null);
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
    <section className="home-card home-task-card">
      <h2 className="home-card__title">
        Today &amp; this week
        <BuiltInBadge />
      </h2>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {/* The card's schedule half: what comes round, ABOVE the board's own two
          horizons, because a due or overdue occurrence is the one thing the card
          can lose by being scrolled past. A review row carries no tick — its
          page is the truth, so the row clears when the review is done there. */}
      <div className="home-recurring">
        <h3 className="home-task-cols__head">
          Recurring
          <span className="home-task-cols__count">{recurring.length}</span>
        </h3>
        {recurring.length === 0 ? (
          <p className="muted home-card__empty">Nothing recurring due.</p>
        ) : (
          <ul className="home-recurring-list">
            {recurring.map((item) => {
              const busy = recurringBusyId === item.id;
              return (
                <li
                  key={item.id}
                  className="home-task-row home-recurring-row"
                  data-testid={`recurring-row-${item.id}`}
                  data-state={item.state}
                >
                  {item.completable ? (
                    <input
                      type="checkbox"
                      className="home-task-row__check"
                      checked={busy}
                      disabled={recurringBusyId !== null}
                      onChange={() => void markRecurringDone(item)}
                      aria-label={`Mark "${item.title}" done`}
                      data-testid={`recurring-done-${item.id}`}
                      title="Mark done"
                    />
                  ) : null}
                  <span className="home-task-row__title home-recurring-row__title">
                    {item.link ? (
                      <Link
                        to={item.link}
                        className="home-recurring-row__link"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </span>
                  <span
                    className={`home-recurring-row__state home-recurring-row__state--${item.state}`}
                  >
                    {dueStateLabel(item.state)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          to="/act?manage=recurring"
          className="home-card__more home-recurring__manage"
          data-testid="today-week-recurring-manage"
        >
          Manage recurring →
        </Link>
      </div>

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
