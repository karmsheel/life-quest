import { useCallback, useEffect, useState } from "react";
import type { LifeEvent } from "@lifequest/vault-core";
import {
  actorDisplayName,
  recordVisible,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import {
  useActiveDomain,
  useDomainLens,
} from "@/components/shell/useActiveDomain";

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

export function LifeLogFeed() {
  const lens = useDomainLens();
  const activeDomain = useActiveDomain();
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api().logList();
      if (!result.ok) {
        setError(result.error);
        setEvents([]);
        return;
      }
      const list = result.value
        .filter((e) => recordVisible(lens, e.domainSlug))
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setEvents(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load life log");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [lens]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="life-log-feed">
      <header className="life-log-feed__header">
        <h1 className="stub-page__title">Life log</h1>
        <p className="stub-page__desc muted">
          Append-only feed of domain, document, decision, and agent events.
        </p>
      </header>

      <div className="life-log-feed__toolbar">
        <span className="muted life-log-feed__scope">
          {lens.kind === "overview"
            ? "Overview"
            : `Scoped to: ${activeDomain?.meta.name ?? "domain"}`}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="muted life-log-feed__empty">No events yet.</p>
      ) : (
        <ul className="life-log-feed__list">
          {events.map((e) => (
            <li
              key={e.id}
              className="life-log-event"
              data-actor={e.actor ? actorDisplayName(e.actor) : undefined}
            >
              <time
                className="life-log-event__when muted"
                dateTime={e.createdAt}
              >
                {formatWhen(e.createdAt)}
              </time>
              <span className="life-log-event__type">{e.type}</span>
              <span className="life-log-event__summary">{e.summary}</span>
              {/* KAR-9: name the writer when the line has an actor. Old lines
                  with actor null render no name. */}
              {e.actor ? (
                <span className="life-log-event__actor muted">
                  {actorDisplayName(e.actor)}
                </span>
              ) : null}
              <span className="life-log-event__domain muted">
                {e.domainSlug ?? "unassigned"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
