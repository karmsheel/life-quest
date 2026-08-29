import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  DecisionRecord,
  DocumentKind,
  LifeEvent,
  RoomId,
} from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useActiveDomain, useUnlockedRooms } from "@/components/shell/useActiveDomain";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";

type DoctrineRow = {
  kind: DocumentKind;
  label: string;
  room: Exclude<RoomId, "act">;
  href: string;
};

const DOCTRINE_ROWS: DoctrineRow[] = [
  { kind: "why", label: "Why", room: "dream", href: "/dream" },
  { kind: "what", label: "What", room: "chart", href: "/chart" },
  { kind: "how", label: "How", room: "track", href: "/track" },
];

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
  const { snapshot, reloadGeneration } = useVault();
  const activeDomain = useActiveDomain();
  const unlocked = useUnlockedRooms();

  const activeSlug = activeDomain?.slug ?? null;
  const domainName = activeDomain?.meta.name ?? "No domain";

  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [decResult, logResult] = await Promise.all([
        api().decisionList(),
        api().logList(),
      ]);
      const allDecisions =
        decResult.ok ? decResult.value : [];
      const allEvents = logResult.ok ? logResult.value : [];

      setDecisions(
        allDecisions
          .filter((d) => d.status === "pending")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );

      const scoped = activeSlug
        ? allEvents.filter((e) => e.domainSlug === activeSlug)
        : allEvents;
      setEvents(
        scoped
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 5),
      );
    } catch {
      setDecisions([]);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [activeSlug]);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration]);

  const activeAgents = useMemo(
    () => (snapshot?.agents ?? []).filter((a) => a.status === "active"),
    [snapshot],
  );

  const forgedCount = useMemo(() => {
    if (!activeDomain) return 0;
    return DOCTRINE_ROWS.filter(
      (r) => activeDomain.documents[r.kind]?.status === "forged",
    ).length;
  }, [activeDomain]);

  const pendingForDomain = useMemo(
    () =>
      activeSlug
        ? decisions.filter((d) => d.domainSlug === activeSlug)
        : decisions,
    [decisions, activeSlug],
  );

  const todayTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "today"),
    [snapshot?.map?.tasks],
  );
  const weekTasks = useMemo(
    () => (snapshot?.map?.tasks ?? []).filter((t) => t.column === "this-week"),
    [snapshot?.map?.tasks],
  );

  if (!activeDomain) {
    return (
      <div className="home-dashboard">
        <header className="home-dashboard__header">
          <div>
            <p className="home-dashboard__eyebrow muted">Home</p>
            <h1 className="home-dashboard__title">Welcome to LifeQuest</h1>
          </div>
        </header>
        <p className="muted">
          Select or create a domain to see your dashboard. Use{" "}
          <Link to="/domains" className="home-dashboard__inline-link">
            Domains
          </Link>{" "}
          to get started.
        </p>
      </div>
    );
  }

  const progressPct = Math.round((forgedCount / DOCTRINE_ROWS.length) * 100);

  return (
    <div className="home-dashboard">
      <header className="home-dashboard__header">
        <div>
          <p className="home-dashboard__eyebrow muted">Home</p>
          <h1 className="home-dashboard__title">
            {domainName}
            <span className="home-dashboard__subtitle muted">
              {" "}
              Why → What → How
            </span>
          </h1>
        </div>
        <div className="home-dashboard__progress" title={`${forgedCount} of 3 pillars forged`}>
          <span className="muted home-dashboard__progress-label">
            {forgedCount}/{DOCTRINE_ROWS.length} forged
          </span>
          <div className="home-progress-bar">
            <div
              className="home-progress-bar__fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      <div className="home-dashboard__grid">
        <section className="home-card home-card--doctrine">
          <h2 className="home-card__title">Doctrine</h2>
          <ul className="home-doctrine-list">
            {DOCTRINE_ROWS.map((row) => {
              const doc = activeDomain.documents[row.kind];
              const status = doc?.status ?? "draft";
              const chars = doc?.bodyMarkdown.trim().length ?? 0;
              const isUnlocked = unlocked.has(row.room);
              return (
                <li key={row.kind} className="home-doctrine-row">
                  <Link to={row.href} className="home-doctrine-row__main">
                    <span className="home-doctrine-row__label">
                      {row.label}
                      {!isUnlocked ? (
                        <span
                          className="home-doctrine-row__lock muted"
                          title="Locked — complete the prior pillar first"
                          aria-label="locked"
                        >
                          {" "}🔒
                        </span>
                      ) : null}
                    </span>
                    <span className="home-doctrine-row__meta muted">
                      {chars > 0 ? `${chars} chars` : "empty body"}
                    </span>
                  </Link>
                  <DocumentStatusBadge status={status} />
                </li>
              );
            })}
          </ul>
          <Link to="/documents" className="home-card__more">
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
              No pending decisions. Forge a document and propose a change to see
              it here.
            </p>
          ) : (
            <ul className="home-mini-list">
              {pendingForDomain.slice(0, 4).map((d) => (
                <li key={d.id} className="home-mini-list__item">
                  <Link to="/decisions" className="home-mini-list__link">
                    {d.title}
                  </Link>
                  <span className="muted home-mini-list__meta">
                    {d.documentKind}
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
            <p className="muted home-card__empty">
              No activity yet for this domain.
            </p>
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
