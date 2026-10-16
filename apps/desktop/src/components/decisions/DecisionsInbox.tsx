import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  actorDisplayName,
  DOCUMENT_KIND_LABELS,
  recordVisibleMulti,
} from "@lifequest/vault-core/pure";
import type { DecisionRecord } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";
import { useLiveData } from "@/state/LiveDataProvider";
import { DecisionBody } from "./DecisionBody";

type Tab = "pending" | "history";

/**
 * A Decision this page had never drawn, and the moment it found it.
 *
 * `ids` is wider than the cards on screen on purpose: a proposal filed for another
 * lens is still one this page had never seen, and a tab switch must not turn a
 * whole inbox into "New" chips. `at` is a tick rather than a boolean so a second
 * filing restarts the mark instead of inheriting a class that was already there.
 */
type Arrival = { ids: string[]; actor: string; at: number };

/** How long a card that just arrived wears the mark. */
const ARRIVAL_MS = 6_000;

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
    // One card stands for a whole batch of new rows, so the kind says rows.
    case "database-batch":
      return "Database rows";
    // KAR-70: a pairing Decision, not a document. Falling through would leave
    // the card with no kind label at all.
    case "agent-pairing":
      return "Agent pairing";
    case "view":
      return "Dashboard view";
  }
}

/**
 * The inbox, live.
 *
 * THE FAULT THIS REPAIRS (reported, not imagined):
 *
 *   "When I'm already on the Decisions page and a new decision is filed, it does
 *    not pop up on the screen. I have to click elsewhere and then come back for
 *    it to show."
 *
 * The page read the list once, on mount, and on nothing else. Every other reader
 * of the same data had already been made live — the dashboard's own "Pending
 * decisions" card re-reads on the vault's revision — so this was the one surface
 * still asking nobody, and the only way to make it ask was to unmount and remount
 * it by navigating away.
 *
 * It listens to `useLiveData` now, which is the main process's own announcement
 * that something a card reads has been written: the companion filing a Decision,
 * an approve landing one, another window resolving one. The re-read is SILENT —
 * what is on screen stays on screen, and the new card is added to it. A spinner
 * where a list used to be is the same defect wearing a different hat: the
 * operator's place is a place, and a refresh is not a reason to take it.
 *
 * An arrival is then something the page says out loud: the card wears the app's
 * one "this changed" mark — the same accent aura a view card wears when the
 * companion edits it — a `New` chip, and one quiet line above the list naming who
 * filed it. The mark is a pulse rather than a flag that stays, because a badge
 * that never clears stops meaning "new" and starts meaning "some decision".
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not move the page. A prepend at the start of a list is where the
 * operator's eye already is, so with the list's beginning on screen the new card
 * takes the place the previous newest card held and is read where they are
 * looking — no scrolling, because none is needed. And an operator who has scrolled
 * INTO the list keeps their place exactly: the browser's own scroll anchoring
 * absorbs the prepend, which the rig measures to the pixel in both directions. A
 * page that threw itself to the top on every filing would be taking the operator's
 * place to show them something they did not ask for, and the card is marked either
 * way.
 */
export function DecisionsInbox() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const domains = snapshot?.domains ?? [];
  /** The vault's revision: it moves on any write, in this window or the agent's. */
  const live = useLiveData();

  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);

  /**
   * Every decision id this page has drawn, so "just arrived" is decidable.
   *
   * A set that only grows, and never "what is on screen": switching to History
   * takes every pending card off the screen, and a page that compared against the
   * screen would greet the operator's return to Pending with a whole inbox of
   * "New" chips. Only a decision this page has never held is new.
   */
  const drawnRef = useRef<Set<string>>(new Set());
  /** False until something has been drawn: a first load has no arrivals. */
  const seededRef = useRef(false);
  /** The revision this page has already answered, so a re-render is not a write. */
  const revisionRef = useRef(live);
  /**
   * The newest read, so a slower earlier one cannot land on top of it.
   *
   * A read takes a round trip, and the tab or the lens can move inside it — a
   * live refresh started on Pending, then History clicked, would otherwise draw
   * the pending list under the History tab until something asked again. Only the
   * last read owns the screen; a discarded one changes nothing, not even the ids
   * this page counts as drawn.
   */
  const readSeqRef = useRef(0);

  /**
   * Read the inbox.
   *
   *  - `view` — a first load, a tab switch, a lens change. These are answers to
   *    something the operator did, so they may replace what is on screen.
   *  - `live` — a vault revision moved. Nobody asked; a card that arrived has to
   *    be added to what the operator is already reading, not swapped in for it.
   *
   * Arrival is judged against every decision the vault holds rather than against
   * this tab's filtered list, because a filing is a filing whatever is on screen.
   */
  const load = useCallback(
    async (mode: "view" | "live" = "view") => {
      const seq = readSeqRef.current + 1;
      readSeqRef.current = seq;
      if (mode === "view" && !seededRef.current) setLoading(true);
      setError(null);
      try {
        const result = await api().decisionList();
        if (readSeqRef.current !== seq) return;
        if (!result.ok) {
          setError(result.error);
          // A live read that failed leaves what is already on screen alone: those
          // cards are still what the vault held a moment ago, and a transient
          // error is not news worth clearing the page for.
          if (mode === "view") setItems([]);
          return;
        }
        const fresh = seededRef.current
          ? result.value.filter(
              (d) => d.status === "pending" && !drawnRef.current.has(d.id),
            )
          : [];
        for (const d of result.value) drawnRef.current.add(d.id);
        seededRef.current = true;

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
        if (fresh.length > 0) {
          const newest = fresh
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
          setArrival({
            ids: fresh.map((d) => d.id),
            actor: actorDisplayName(newest.actor),
            at: Date.now(),
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load decisions");
        if (mode === "view") setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [tab, lens],
  );

  // The operator's own moves: the first paint, a tab, the domain lens.
  useEffect(() => {
    void load("view");
  }, [load]);

  // A write. The revision is monotonic, so a re-run of this effect for any other
  // reason — `load` changing identity when the tab moves — is not a write.
  useEffect(() => {
    if (revisionRef.current === live) return;
    revisionRef.current = live;
    void load("live");
  }, [live, load]);

  /**
   * The mark is one animation long, cleared on a timer rather than left on the
   * card: a `New` chip that outlives the moment reads as part of the card.
   */
  useEffect(() => {
    if (!arrival) return;
    const timer = window.setTimeout(() => setArrival(null), ARRIVAL_MS);
    return () => window.clearTimeout(timer);
  }, [arrival]);

  async function resolve(id: string, resolution: "approved" | "rejected") {
    setResolvingId(id);
    setActionMessage(null);
    setError(null);
    // The arrival mark is about a card the operator is being asked to act on, and
    // the answer they just gave is the end of that moment.
    setArrival(null);
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

  /**
   * The arrivals this tab is actually showing.
   *
   * The mark is worn by the cards on screen, and the line above the list counts
   * those same cards: a proposal filed under another lens is not something this
   * page can point at, and a count the operator cannot reach is a worse lie than
   * silence.
   */
  const arrivedIds = new Set(arrival?.ids ?? []);
  const arrivedOnScreen = items.filter((d) => arrivedIds.has(d.id));
  const newMark = arrival ? `is-new decision-card--new-${arrival.at}` : "";

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
      {/* One line, above the list, for as long as the mark is on a card: the
          operator looking at the page is told what happened to it, and a screen
          reader is told the same thing in the same order. */}
      {arrivedOnScreen.length > 0 ? (
        <p
          className="decisions-inbox__arrival"
          role="status"
          data-testid="decisions-arrival"
        >
          <span className="decisions-inbox__arrival-dot" aria-hidden="true" />
          {arrivedOnScreen.length === 1
            ? `New decision filed by ${arrival?.actor ?? "the agent"}.`
            : `${arrivedOnScreen.length} new decisions filed.`}
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
            const isNew = arrivedIds.has(d.id);
            return (
              <li
                key={d.id}
                // Named for the page's own reveal, which finds the card the
                // arrival line is about by this id.
                data-decision-id={d.id}
                data-arrived={isNew ? "true" : undefined}
                className={["decision-card", isNew ? newMark : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="decision-card__kicker">
                  <span className="decision-card__kicker-left">
                    <span className="decision-kind">{kindLabel(d.target)}</span>
                    {isNew ? <span className="decision-new">New</span> : null}
                  </span>
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
