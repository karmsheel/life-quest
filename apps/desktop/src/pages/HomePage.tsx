import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  DecisionRecord,
  Goal,
  LifeEvent,
} from "@lifequest/vault-core";
import {
  DOCUMENT_KIND_LABELS,
  DREAM_DOCUMENT_KINDS,
  filterByLens,
  formatGoalPace,
  goalPace,
  recordVisible,
  recordVisibleMulti,
  type DocumentKind,
  deadlinePressureGoals,
  daysUntilDeadline,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import {
  useActiveDomain,
  useDomainLens,
} from "@/components/shell/useActiveDomain";
import { DocumentLockBadge } from "@/components/documents/DocumentLockBadge";

const DOCTRINE_ROWS = DREAM_DOCUMENT_KINDS.map((kind) => ({
  kind,
  label: DOCUMENT_KIND_LABELS[kind],
}));

function doctrineHref(kind: DocumentKind, slug: string): string {
  if (kind === "how") return `/track/${slug}/how`;
  return `/dream/${slug}/${kind}`;
}

function localIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function HomePage() {
  const { snapshot, reloadGeneration, refresh } = useVault();
  const lens = useDomainLens();
  const activeDomain = useActiveDomain();

  const title = activeDomain?.meta.name ?? "Overview";

  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [goalBusyId, setGoalBusyId] = useState<string | null>(null);
  const [pendingDoneId, setPendingDoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedToday, setDismissedToday] = useState(false);
  const [notifyInFlight, setNotifyInFlight] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotifyInFlight(true);
    try {
      const [decResult, logResult, dismissedRes] = await Promise.all([
        api().decisionList(),
        api().logList(),
        api().deadlineGetDismissed(),
      ]);
      const allDecisions = decResult.ok ? decResult.value : [];
      const allEvents = logResult.ok ? logResult.value : [];

      // Check if this vault dismissed today
      if (dismissedRes.ok && dismissedRes.value) {
        const today = localIsoDate();
        setDismissedToday(dismissedRes.value === today);
      } else {
        setDismissedToday(false);
      }

      setDecisions(
        allDecisions
          .filter((d) => d.status === "pending")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );

      const scoped = allEvents.filter((e) =>
        recordVisible(lens, e.domainSlug),
      );
      setEvents(
        scoped
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 5),
      );

      // Trigger Windows notification if appropriate (main process).
      void api().deadlineMaybeNotify();
    } catch {
      setDecisions([]);
      setEvents([]);
    } finally {
      setLoading(false);
      setNotifyInFlight(false);
    }
  }, [lens]);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration]);

  const activeAgents = useMemo(
    () => (snapshot?.agents ?? []).filter((a) => a.status === "active"),
    [snapshot],
  );

  const visibleDomains = useMemo(() => {
    return (snapshot?.domains ?? [])
      .filter((d) => !d.meta.archivedAt && recordVisible(lens, d.slug))
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot, lens]);

  const openGoals = useMemo(() => {
    const goals = snapshot?.goals ?? [];
    return filterByLens(goals, lens).filter((g) => g.status === "open");
  }, [snapshot?.goals, lens]);

  const pressureGoals = useMemo(() => {
    const goals = snapshot?.goals ?? [];
    const today = localIsoDate();
    return deadlinePressureGoals(goals, today)
      .filter((g) =>
        filterByLens([g], lens).length > 0
      )
      .sort((a, b) => daysUntilDeadline(a.deadline!, today) - daysUntilDeadline(b.deadline!, today));
  }, [snapshot?.goals, lens]);

  const doctrineTotal = visibleDomains.length * DOCTRINE_ROWS.length;

  const lockedCount = useMemo(() => {
    return visibleDomains.reduce((n, domain) => {
      return (
        n + DOCTRINE_ROWS.filter((r) => domain.documents[r.kind]?.locked).length
      );
    }, 0);
  }, [visibleDomains]);

  const pendingForDomain = useMemo(
    () => decisions.filter((d) => recordVisibleMulti(lens, d.domainSlugs)),
    [decisions, lens],
  );

  const todayTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "today"),
    [snapshot?.map?.tasks],
  );
  const weekTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "this-week"),
    [snapshot?.map?.tasks],
  );

  const progressPct =
    doctrineTotal === 0 ? 0 : Math.round((lockedCount / doctrineTotal) * 100);

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

  async function dismissDeadline() {
    const ok = await api().deadlineDismiss();
    if (ok?.ok) {
      setDismissed(true);
    }
  }

  return (
    <div className="home-dashboard">
      <header className="home-dashboard__header">
        <div>
          <p className="home-dashboard__eyebrow muted">Dashboard</p>
          <h1 className="home-dashboard__title">
            {title}
            <span className="home-dashboard__subtitle muted">
              {" "}
              Premise → Vision → Purpose → Strategy (How)
            </span>
          </h1>
        </div>
        <div
          className="home-dashboard__progress"
          title={`${lockedCount} of ${doctrineTotal} locked`}
        >
          <span className="muted home-dashboard__progress-label">
            {lockedCount}/{doctrineTotal} locked
          </span>
          <div className="home-progress-bar">
            <div
              className="home-progress-bar__fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      {pressureGoals.length > 0 && !dismissed && !dismissedToday && (
        <div role="status" className="deadline-banner" aria-live="polite">
          <div className="deadline-banner__content">
            <span className="deadline-banner__label muted">Deadline pressure</span>
            <span className="deadline-banner__text">
              {pressureGoals.length === 1 ? (
                pressureGoals[0].name
              ) : (
                <>
                  {pressureGoals[0].name} and {pressureGoals.length - 1} other{pressureGoals.length > 2 ? "s" : ""}
                </>
              )}
            </span>
          </div>
          <button
            className="deadline-banner__dismiss"
            onClick={dismissDeadline}
            disabled={notifyInFlight}
            title="Dismiss until tomorrow"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="home-dashboard__grid">
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
                const numeric =
                  goal.metric !== null && goal.target !== null;
                const paceText = numeric
                  ? formatGoalPace(goalPace(goal))
                  : null;
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
                          <span>
                            / {goal.target} {goal.metric}
                          </span>
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
                            onChange={(e) =>
                              onDefinitionDone(goal, e.target.checked)
                            }
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

        <section className="home-card home-card--doctrine">
          <h2 className="home-card__title">Doctrine</h2>
          {visibleDomains.length === 0 ? (
            <p className="muted home-card__empty">No live domains yet.</p>
          ) : (
            <ul className="home-doctrine-list">
              {visibleDomains.flatMap((domain) =>
                DOCTRINE_ROWS.map((row) => {
                  const doc = domain.documents[row.kind];
                  const chars = doc?.bodyMarkdown.trim().length ?? 0;
                  const label =
                    visibleDomains.length > 1
                      ? `${domain.meta.name} · ${row.label}`
                      : row.label;
                  return (
                    <li
                      key={`${domain.slug}-${row.kind}`}
                      className="home-doctrine-row"
                    >
                      <Link
                        to={doctrineHref(row.kind, domain.slug)}
                        className="home-doctrine-row__main"
                      >
                        <span className="home-doctrine-row__label">{label}</span>
                        <span className="home-doctrine-row__meta muted">
                          {chars > 0 ? `${chars} chars` : "empty body"}
                        </span>
                      </Link>
                      <DocumentLockBadge locked={doc?.locked ?? false} />
                    </li>
                  );
                }),
              )}
            </ul>
          )}
          <Link to="/dream" className="home-card__more">
            View documents →
          </Link>
        </section>

        <section className="home-card">
          <h2 className="home-card__title">
            Pending decisions
            {pendingForDomain.length > 0 ? (
              <span className="home-card__count">{pendingForDomain.length}</span>
            ) : null}
          </h2>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : pendingForDomain.length === 0 ? (
            <p className="muted home-card__empty">
              No pending proposals.
            </p>
          ) : (
            <ul className="home-mini-list">
              {pendingForDomain.slice(0, 4).map((d) => (
                <li key={d.id} className="home-mini-list__item">
                  <Link to="/decisions" className="home-mini-list__link">
                    {d.title}
                  </Link>
                  <span className="muted home-mini-list__meta">
                    {d.target.type === "doctrine"
                      ? DOCUMENT_KIND_LABELS[d.target.kind]
                      : d.proposedTitle ?? d.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/decisions" className="home-card__more">
            Open inbox →
          </Link>
        </section>

        <section className="home-card">
          <h2 className="home-card__title">
            Active agents
            {activeAgents.length > 0 ? (
              <span className="home-card__count">{activeAgents.length}</span>
            ) : null}
          </h2>
          {activeAgents.length === 0 ? (
            <p className="muted home-card__empty">
              No active agents. Scan Hermes and hire agents in Personnel.
            </p>
          ) : (
            <ul className="home-mini-list">
              {activeAgents.slice(0, 4).map((a) => (
                <li key={a.id} className="home-mini-list__item">
                  <span className="home-mini-list__link">{a.name}</span>
                  {a.roleLabel ? (
                    <span className="muted home-mini-list__meta">
                      {a.roleLabel}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Link to="/personnel" className="home-card__more">
            Open Personnel →
          </Link>
        </section>

        <section className="home-card home-card--wide">
          <h2 className="home-card__title">Today &amp; this week</h2>
          <div className="home-task-cols">
            <div>
              <h3 className="home-task-cols__head">Today</h3>
              {todayTasks.length === 0 ? (
                <p className="muted home-card__empty">No tasks today.</p>
              ) : (
                <ul className="home-mini-list">
                  {todayTasks.map((t) => (
                    <li key={t.id} className="home-mini-list__item">
                      <span className="home-mini-list__link">{t.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="home-task-cols__head">This week</h3>
              {weekTasks.length === 0 ? (
                <p className="muted home-card__empty">Nothing queued this week.</p>
              ) : (
                <ul className="home-mini-list">
                  {weekTasks.map((t) => (
                    <li key={t.id} className="home-mini-list__item">
                      <span className="home-mini-list__link">{t.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <Link to="/act" className="home-card__more">
            Open Act →
          </Link>
        </section>

        <section className="home-card home-card--wide">
          <h2 className="home-card__title">Recent activity</h2>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : events.length === 0 ? (
            <p className="muted home-card__empty">No activity yet.</p>
          ) : (
            <ul className="home-activity-list">
              {events.map((e) => (
                <li key={e.id} className="home-activity-row">
                  <time
                    className="home-activity-row__when muted"
                    dateTime={e.createdAt}
                  >
                    {formatWhen(e.createdAt)}
                  </time>
                  <span className="home-activity-row__type">{e.type}</span>
                  <span className="home-activity-row__summary">
                    {e.summary}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/log" className="home-card__more">
            View full log →
          </Link>
        </section>
      </div>
    </div>
  );
}
