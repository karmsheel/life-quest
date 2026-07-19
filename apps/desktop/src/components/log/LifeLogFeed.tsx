import { useCallback, useEffect, useState } from "react";
import type { LifeEvent } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

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
  const activeDomain = useActiveDomain();
  const [allDomains, setAllDomains] = useState(false);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeSlug = activeDomain?.slug ?? null;
  const activeName = activeDomain?.meta.name ?? null;

  const load = useCallback(async () => {
    if (!allDomains && !activeSlug) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api().logList();
      if (!result.ok) {
        setError(result.error);
        setEvents([]);
        return;
      }
      let list = result.value.slice();
      if (!allDomains && activeSlug) {
        list = list.filter((e) => e.domainSlug === activeSlug);
      }
      // Newest first
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setEvents(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load life log");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [allDomains, activeSlug]);

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
        <label className="life-log-feed__toggle">
          <input
            type="checkbox"
            checked={allDomains}
            onChange={(e) => setAllDomains(e.target.checked)}
          />
          <span>All domains</span>
        </label>
        {!allDomains ? (
          <span className="muted life-log-feed__scope">
            Scoped to: {activeName ?? "no active domain"}
          </span>
        ) : (
          <span className="muted life-log-feed__scope">Showing every domain</span>
        )}
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
      ) : !allDomains && !activeSlug ? (
        <p className="muted">Select or create a domain to view its log.</p>
      ) : events.length === 0 ? (
        <p className="muted life-log-feed__empty">No events yet.</p>
      ) : (
        <ul className="life-log-feed__list">
          {events.map((e) => (
            <li key={e.id} className="life-log-event">
              <time
                className="life-log-event__when muted"
                dateTime={e.createdAt}
              >
                {formatWhen(e.createdAt)}
              </time>
              <span className="life-log-event__type">{e.type}</span>
              <span className="life-log-event__summary">{e.summary}</span>
              <span className="life-log-event__domain muted">
                {e.domainSlug ?? "global"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
