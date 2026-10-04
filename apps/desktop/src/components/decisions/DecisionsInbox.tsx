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
import { DecisionBody } from "./DecisionBody";

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

function kindLabel(target: DecisionRecord["target"]): string {
  switch (target.type) {
    case "doctrine":
      return DOCUMENT_KIND_LABELS[target.kind];
    case "library":
      return "Library note";
    case "review":
      return "Review";
    case "page":
      return "Page";
    case "pins":
      return "Pins";
    case "mapping":
      return "Mapping";
    case "kit-install":
      return "Finance kit";
    case "assumption-set":
      return "Assumptions";
    case "goal":
      return "Goal";
    case "day-template":
      return "Day template";
    case "project":
      return "Project";
    case "database-row":
      return "Database row";
    case "database":
      return "Database";
    // KAR-70: a pairing Decision, not a document. Falling through would leave
    // the card with no kind label at all.
    case "agent-pairing":
      return "Agent pairing";
    case "view":
      return "Dashboard view";
  }
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
      // KAR-70: a pairing Decision belongs to no domain, so the lens
      // filter would hide the very card the operator has to act on. Every
      // pairing Decision stays visible under every lens.
      list = list.filter(
        (d) =>
          d.target.type === "agent-pairing" ||
          recordVisibleMulti(lens, d.domainSlugs),
      );
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
        resolution === "approved" ? "Decision approved." : "Decision rejected.",
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
        <p className="decisions-inbox__eyebrow">Inbox</p>
        <h1 className="stub-page__title">Decisions</h1>
        <p className="stub-page__desc muted">
          Approve a proposal to write it into the vault. Reject it to leave the vault as it is.
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
          {items.map((d) => {
            const title =
              tab === "pending" && d.proposedTitle ? d.proposedTitle : d.title;
            const domainsLabel = d.domainSlugs
              .map((slug) => domainLabel(slug, domains))
              .join(", ");
            const statusLabel = d.reason ? "Could not apply" : d.status;
            const statusClass = d.reason
              ? "decision-status--stale"
              : `decision-status--${d.status}`;
            return (
              <li key={d.id} className="decision-card">
                <div className="decision-card__kicker">
                  <span className="decision-kind">{kindLabel(d.target)}</span>
                  <span className={`decision-status ${statusClass}`}>{statusLabel}</span>
                </div>
                <div>
                  <h2 className="decision-card__title">{title}</h2>
                  <p className="decision-card__meta muted">
                    <span>{actorDisplayName(d.actor)}</span>
                    {domainsLabel ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{domainsLabel}</span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <time dateTime={d.createdAt}>{formatWhen(d.createdAt)}</time>
                  </p>
                </div>

                {d.rationale ? (
                  <p className="decision-card__rationale">{d.rationale}</p>
                ) : null}

                {/* KAR-64: a Decision the operator approved whose apply failed
                    terminally is rejected with a reason. It must not read like one
                    they declined, so it is labelled and explained distinctly. */}
                {d.reason ? (
                  <p className="decision-card__reason" role="note">
                    <span className="decision-card__reason-label">
                      Rejected · proposal no longer applies.
                    </span>
                    {d.reason}
                  </p>
                ) : null}

                {tab === "pending" &&
                d.status === "pending" &&
                d.previousTitle != null &&
                d.previousTitle !== (d.proposedTitle ?? "") ? (
                  <p className="decision-card__title-change">
                    <span className="muted">Title</span>
                    <span className="decision-value--was">{d.previousTitle}</span>
                    <span aria-hidden="true">→</span>
                    <span>{d.proposedTitle}</span>
                  </p>
                ) : null}

                <DecisionBody
                  target={d.target}
                  proposed={d.proposedBodyMarkdown}
                  previous={d.previousBodyMarkdown}
                  goalName={(id) => snapshot?.goals.find((goal) => goal.id === id)?.name ?? null}
                  domainName={(slug) => domainLabel(slug, domains)}
                />

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
            );
          })}
        </ul>
      )}
    </div>
  );
}
