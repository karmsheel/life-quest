import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  DecisionRecord,
  DocumentKind,
  LifeEvent,
} from "@lifequest/vault-core";
import { recordVisible } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import {
  useActiveDomain,
  useDomainLens,
} from "@/components/shell/useActiveDomain";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";

type DoctrineRow = {
  kind: DocumentKind;
  label: string;
};

const DOCTRINE_ROWS: DoctrineRow[] = [
  { kind: "why", label: "Why" },
  { kind: "what", label: "What" },
  { kind: "how", label: "How" },
];

function doctrineHref(kind: DocumentKind, slug: string): string {
  if (kind === "how") return `/track/${slug}/how`;
  if (kind === "what") return `/dream/${slug}/what`;
  return `/dream/${slug}/why`;
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
  const { snapshot, reloadGeneration } = useVault();
  const lens = useDomainLens();
  const activeDomain = useActiveDomain();

  const title = activeDomain?.meta.name ?? "Overview";

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
      const allDecisions = decResult.ok ? decResult.value : [];
      const allEvents = logResult.ok ? logResult.value : [];

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
    } catch {
      setDecisions([]);
      setEvents([]);
    } finally {
      setLoading(false);
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

  const doctrineTotal = visibleDomains.length * DOCTRINE_ROWS.length;

  const forgedCount = useMemo(() => {
    return visibleDomains.reduce((n, domain) => {
      return (
        n +
        DOCTRINE_ROWS.filter(
          (r) => domain.documents[r.kind]?.status === "forged",
        ).length
      );
    }, 0);
  }, [visibleDomains]);

  const pendingForDomain = useMemo(
    () => decisions.filter((d) => recordVisible(lens, d.domainSlug)),
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
    doctrineTotal === 0 ? 0 : Math.round((forgedCount / doctrineTotal) * 100);

  return (
    <div className="home-dashboard">
      <header className="home-dashboard__header">
        <div>
          <p className="home-dashboard__eyebrow muted">Dashboard</p>
          <h1 className="home-dashboard__title">
            {title}
            <span className="home-dashboard__subtitle muted">
              {" "}
              Why → What → How
            </span>
          </h1>
        </div>
        <div
          className="home-dashboard__progress"
          title={`${forgedCount} of ${doctrineTotal} pillars forged`}
        >
          <span className="muted home-dashboard__progress-label">
            {forgedCount}/{doctrineTotal} forged
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
          {visibleDomains.length === 0 ? (
            <p className="muted home-card__empty">No live domains yet.</p>
          ) : (
            <ul className="home-doctrine-list">
              {visibleDomains.flatMap((domain) =>
                DOCTRINE_ROWS.map((row) => {
                  const doc = domain.documents[row.kind];
                  const status = doc?.status ?? "draft";
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
                      <DocumentStatusBadge status={status} />
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
