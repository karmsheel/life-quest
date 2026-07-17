"use client";

import { useCallback, useEffect, useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";

export type DecisionItem = {
  id: string;
  domainId: string;
  documentId: string;
  status: string;
  title: string;
  rationale: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type Tab = "pending" | "history";

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

export function DecisionsInbox() {
  const { domains, refresh: refreshShell } = useShell();
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const domainName = useCallback(
    (domainId: string) =>
      domains.find((d) => d.id === domainId)?.name ?? domainId.slice(0, 8),
    [domains],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = tab === "pending" ? "pending" : "all";
      const res = await fetch(`/api/decisions?status=${status}`, {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        decisions?: DecisionItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load decisions");
        setItems([]);
        return;
      }
      let list = Array.isArray(data.decisions) ? data.decisions : [];
      if (tab === "history") {
        list = list.filter((d) => d.status !== "pending");
      }
      setItems(list);
    } catch {
      setError("Network error loading decisions");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, action: "approve" | "reject") {
    setResolvingId(id);
    setActionMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/decisions/${id}/resolve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Failed to ${action}`);
        return;
      }
      setActionMessage(
        action === "approve" ? "Decision approved." : "Decision rejected.",
      );
      await load();
      await refreshShell();
    } catch {
      setError("Network error resolving decision");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="decisions-inbox">
      <header className="decisions-inbox__header">
        <h1 className="stub-page__title">Decisions</h1>
        <p className="stub-page__desc muted">
          Human-in-the-loop inbox for forged document changes. Propose → approve
          / reject.
        </p>
      </header>

      <div className="decisions-inbox__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pending"}
          className={[
            "decisions-inbox__tab",
            tab === "pending" ? "decisions-inbox__tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => {
            setTab("pending");
            setActionMessage(null);
          }}
        >
          Pending
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={[
            "decisions-inbox__tab",
            tab === "history" ? "decisions-inbox__tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => {
            setTab("history");
            setActionMessage(null);
          }}
        >
          History
        </button>
      </div>

      {error ? (
        <p className="doc-editor__error" role="alert">
          {error}
        </p>
      ) : null}
      {actionMessage ? (
        <p className="doc-editor__message" role="status">
          {actionMessage}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading decisions…</p>
      ) : items.length === 0 ? (
        <p className="muted decisions-inbox__empty">
          {tab === "pending"
            ? "No pending decisions. Propose a change on a forged document to see it here."
            : "No resolved decisions yet."}
        </p>
      ) : (
        <ul className="decisions-inbox__list">
          {items.map((d) => (
            <li key={d.id} className="decision-card">
              <div className="decision-card__top">
                <div>
                  <h2 className="decision-card__title">{d.title}</h2>
                  <p className="decision-card__meta muted">
                    {domainName(d.domainId)} · {formatWhen(d.createdAt)}
                    {d.status !== "pending" ? (
                      <>
                        {" "}
                        ·{" "}
                        <span
                          className={`decision-card__status decision-card__status--${d.status}`}
                        >
                          {d.status}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              {d.rationale ? (
                <p className="decision-card__rationale">
                  <span className="muted">Rationale:</span> {d.rationale}
                </p>
              ) : null}

              <div className="decision-card__bodies">
                {d.previousBodyMarkdown != null ? (
                  <label className="decision-card__body-block">
                    <span className="muted">Current body</span>
                    <pre className="decision-card__pre">
                      {d.previousBodyMarkdown || "(empty)"}
                    </pre>
                  </label>
                ) : null}
                <label className="decision-card__body-block">
                  <span className="muted">Proposed body</span>
                  <pre className="decision-card__pre">
                    {d.proposedBodyMarkdown || "(empty)"}
                  </pre>
                </label>
              </div>

              {tab === "pending" && d.status === "pending" ? (
                <div className="decision-card__actions">
                  <button
                    type="button"
                    className="doc-btn doc-btn--danger"
                    disabled={resolvingId === d.id}
                    onClick={() => void resolve(d.id, "reject")}
                  >
                    {resolvingId === d.id ? "…" : "Reject"}
                  </button>
                  <button
                    type="button"
                    className="doc-btn doc-btn--primary"
                    disabled={resolvingId === d.id}
                    onClick={() => void resolve(d.id, "approve")}
                  >
                    {resolvingId === d.id ? "…" : "Approve"}
                  </button>
                </div>
              ) : null}

              {d.resolvedAt ? (
                <p className="decision-card__resolved muted">
                  Resolved {formatWhen(d.resolvedAt)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
