"use client";

import { useCallback, useEffect, useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";

export type LifeLogEvent = {
  id: string;
  userId: string;
  domainId: string | null;
  type: string;
  summary: string;
  payload: unknown;
  createdAt: string;
};

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
  const { activeDomainId, activeDomain, domains, loading: shellLoading } =
    useShell();
  const [allDomains, setAllDomains] = useState(false);
  const [events, setEvents] = useState<LifeLogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const domainName = useCallback(
    (domainId: string | null) => {
      if (!domainId) return "Global";
      return domains.find((d) => d.id === domainId)?.name ?? domainId.slice(0, 8);
    },
    [domains],
  );

  const load = useCallback(async () => {
    if (shellLoading) return;

    if (!allDomains && !activeDomainId) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const qs =
        !allDomains && activeDomainId
          ? `?domainId=${encodeURIComponent(activeDomainId)}`
          : "";
      const res = await fetch(`/api/log${qs}`, {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        events?: LifeLogEvent[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load life log");
        setEvents([]);
        return;
      }
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setError("Network error loading life log");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [allDomains, activeDomainId, shellLoading]);

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
            Scoped to: {activeDomain?.name ?? "no active domain"}
          </span>
        ) : (
          <span className="muted life-log-feed__scope">Showing every domain</span>
        )}
        <button
          type="button"
          className="doc-btn doc-btn--ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="doc-editor__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading || shellLoading ? (
        <p className="muted">Loading events…</p>
      ) : !allDomains && !activeDomainId ? (
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
              {allDomains ? (
                <span className="life-log-event__domain muted">
                  {domainName(e.domainId)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
