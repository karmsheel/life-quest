import { useCallback, useEffect, useState } from "react";
import {
  actorDisplayName,
  DOCUMENT_KIND_LABELS,
  recordVisibleMulti,
} from "@lifequest/vault-core/pure";
import type { DecisionRecord } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

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

function domainLabel(
  domainSlug: string,
  domains: { slug: string; meta: { name: string } }[],
): string {
  return domains.find((d) => d.slug === domainSlug)?.meta.name ?? domainSlug;
}

export function DecisionsInbox() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const domains = snapshot?.domains ?? [];

  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api().decisionList();
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        return;
      }
      let list = result.value.slice();
      if (tab === "pending") {
        list = list.filter((d) => d.status === "pending");
      } else {
        list = list.filter((d) => d.status !== "pending");
      }
      list = list.filter((d) => recordVisibleMulti(lens, d.domainSlugs));
      // Newest first
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decisions");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, lens]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, resolution: "approved" | "rejected") {
    setResolvingId(id);
    setActionMessage(null);
    setError(null);
    try {
      const result = await api().decisionResolve(id, resolution);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setActionMessage(
        resolution === "approved"
          ? "Decision approved. Document body updated."
          : "Decision rejected.",
      );
      await load();
      // Refresh vault snapshot so document editors pick up approved body.
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to resolve decision",
      );
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="decisions-inbox">
      <header className="decisions-inbox__header">
        <h1 className="stub-page__title">Decisions</h1>
        <p className="stub-page__desc muted">
          Proposals to locked documents. Approve or reject.
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
        <p className="form-error" role="alert">
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
            ? "No pending proposals."
            : "No resolved decisions yet."}
        </p>
      ) : (
        <ul className="decisions-inbox__list">
          {items.map((d) => (
            <li key={d.id} className="decision-card">
              <div className="decision-card__top">
                <div>
                  <h2 className="decision-card__title">
                    {tab === "pending" && d.proposedTitle
                      ? d.proposedTitle
                      : d.title}
                  </h2>
                  <p className="decision-card__meta muted">
                    {actorDisplayName(d.actor)} ·{" "}
                    {d.domainSlugs.map((slug) => domainLabel(slug, domains)).join(", ")}
                    ·{" "}
                    {d.target.type === "doctrine"
                      ? DOCUMENT_KIND_LABELS[d.target.kind]
                      : d.target.type === "database-row"
                        ? d.target.rowId
                          ? `Row in ${d.target.databaseId}`
                          : `New row in ${d.target.databaseId}`
                        : d.target.type === "database"
                          ? `Database in ${d.target.domainSlug}`
                          : d.proposedTitle ?? d.title}
                    ·{" "}
                    {formatWhen(d.createdAt)}
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

              {/* KAR-64: a Decision the operator approved whose apply failed
                  terminally is rejected with a reason. It must not read like one
                  they declined, so it is labelled and explained distinctly. */}
              {d.reason ? (
                <p className="decision-card__reason" role="note">
                  <span className="muted">Rejected · proposal no longer applies.</span>{" "}
                  {d.reason}
                </p>
              ) : null}

              {tab === "pending" && d.status === "pending" &&
                d.previousTitle != null &&
                d.previousTitle !== (d.proposedTitle ?? "") ? (
                <p className="decision-card__title-change muted">
                  Title: {d.previousTitle} → {d.proposedTitle}
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
                    className="btn btn-danger"
                    disabled={resolvingId === d.id}
                    onClick={() => void resolve(d.id, "rejected")}
                  >
                    {resolvingId === d.id ? "…" : "Reject"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={resolvingId === d.id}
                    onClick={() => void resolve(d.id, "approved")}
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
