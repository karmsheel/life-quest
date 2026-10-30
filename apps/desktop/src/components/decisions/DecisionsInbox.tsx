import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  actorDisplayName,
  DEFAULT_DECISION_INBOX_SETTINGS,
  DOCUMENT_KIND_LABELS,
} from "@lifequest/vault-core/pure";
import type {
  DecisionAmendment,
  DecisionRecord,
  ManualDecisionRecord,
} from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";
import { useLiveData } from "@/state/LiveDataProvider";
import { DecisionBody } from "./DecisionBody";
import { DecisionEditor } from "./DecisionEditor";
import { supportsAmendment } from "./decision-edit";
import { ManualDecisionCard, ManualDecisionsPanel } from "./ManualDecisions";

type Tab = "pending" | "history" | "manual";

/**
 * Which store History is drawing from.
 *
 * The Decisions inbox is the approval queue for proposed changes; a manual
 * decision is the operator's own record and never enters that queue. History is
 * the one place both are read, so it names the two sides the operator asked to
 * compare: their own `Manual` decisions and the `AI`-related ones filed through
 * the inbox. An operator-filed proposal lives in the inbox store too and wears
 * `You` on its chip; the filter still groups it with the proposals, which is the
 * axis that matters here (logged vs proposed).
 */
type HistoryFilter = "all" | "manual" | "ai";

const HISTORY_FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "manual", label: "Manual" },
  { id: "ai", label: "AI" },
];

/** One row of the list: a proposal Decision, or a logged manual decision. */
type InboxRow =
  | { kind: "ai"; decision: DecisionRecord }
  | { kind: "manual"; manual: ManualDecisionRecord };

/** When the row's decision was made — the sort key the two stores share. */
function rowAt(row: InboxRow): string {
  return row.kind === "ai" ? row.decision.createdAt : row.manual.createdAt;
}

/**
 * A Decision this page had never drawn, and the moment it found it.
 *
 * `ids` is wider than the cards on screen on purpose: a filing can land while
 * History owns the screen, where no pending card is drawn, and a tab switch must
 * not turn that filing into a whole inbox of "New" chips when the operator comes
 * back to Pending. `at` is a tick rather than a boolean so a second filing
 * restarts the mark instead of inheriting a class that was already there.
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
 * THE THIRD TAB: MANUAL DECISIONS
 *
 * The operator also makes decisions the vault never sees. Those are not
 * proposals — nothing is waiting for an answer — so they are logged rather than
 * filed, in their own store (`manual-decisions.ts`), and they never appear in
 * the approval queue. The `Manual` tab is that capture surface, and History reads
 * both stores with a source chip on every card and a filter to compare the
 * operator's own decisions against the AI's.
 *
 * WHY THE DOMAIN LENS IS NOT PART OF THIS PAGE
 *
 * This surface is the governed shelf at the foot of the rail: a global queue of
 * things waiting for the operator's answer, not one domain's view. It used to
 * filter by the active domain lens, and the operator reported what that costs:
 * the companion filed three pending create-database Decisions and said so, but
 * with the lens on another domain the page said "No pending proposals." and the
 * rail's badge — filtered the same way — was silent too. A filing must never be
 * invisible because of where the operator happens to be looking: Pending,
 * History and Manual all show every Decision the vault holds, whatever domain
 * filed it. The lens-scoped reading of decisions is the dashboard's own "Pending
 * decisions" pin (`PendingDecisionsCard`), which is the per-domain view and
 * stays scoped by design.
 *
 * CORRECTING A PROPOSAL INSTEAD OF REFUSING IT
 *
 * Until this card could be edited, the only answers were approve and reject. A
 * proposal with one misspelt project name or one missing detail therefore cost
 * the operator either the whole thing (reject, wait for the agent to file it
 * again) or the correction (approve, then fix the file by hand — if the target
 * is even editable there). So a pending proposal is now a staging surface: the
 * operator can edit it in place, and the amend keeps the agent's original
 * beside the correction so `Revert to agent's version` stays one click. The
 * edit does not answer the Decision — saving leaves it pending, which is the
 * whole point of editing before approving — and "Approve with changes" is the
 * two calls in order, amend then the existing approve. The chip on the card and
 * the `approved · edited` status in History are how the record admits whose
 * words were approved.
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
export function DecisionsInbox({
  showHeader = true,
  onClose,
  arrivalIds,
}: {
  showHeader?: boolean;
  /**
   * The sheet's own close, supplied when the inbox is worn as a surface (see
   * `DecisionsOverlay`). The standalone shape the rigs draw has none, and then
   * the auto-close switch has nothing to close.
   */
  onClose?: () => void;
  /**
   * Pending Decision ids whose filing opened this sheet, when the watcher opened
   * it (see `DecisionInboxAutoOpen`). They are the arrival the live mark cannot
   * know about, because this page was not on screen when they were written.
   */
  arrivalIds?: readonly string[];
}) {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const domains = snapshot?.domains ?? [];
  /** The vault's revision: it moves on any write, in this window or the agent's. */
  const live = useLiveData();
  /**
   * Settings › Decisions › auto-close, defaulted for a snapshot from a rig or a
   * vault written before the switch existed.
   */
  const autoClose =
    snapshot?.settings.decisionInbox?.autoClose ??
    DEFAULT_DECISION_INBOX_SETTINGS.autoClose;

  const [tab, setTab] = useState<Tab>("pending");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [items, setItems] = useState<DecisionRecord[]>([]);
  /**
   * The other store, kept whole. This page is global, so the lens is not
   * consulted here either: a record logged under any domain is the operator's
   * own and is theirs to read on this shelf.
   */
  const [manualItems, setManualItems] = useState<ManualDecisionRecord[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  /**
   * The card whose proposal is open in the editor, if any.
   *
   * Editing is a mode of this page rather than a separate screen: the operator
   * is correcting a card they are already reading, and a modal over the inbox
   * would hide the queue they are deciding against. Only one card can be open
   * at a time — two half-edited proposals on screen is two questions.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The card currently talking to the vault, so its controls stay quiet. */
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  /**
   * The filing this sheet was opened FOR, if the watcher opened it.
   *
   * A ref, not state: it is input to the first paint only, and the mark must not
   * come back when the operator switches tabs. The first successful read is the
   * one that draws the list the filing is in, so it consumes this.
   */
  const arrivalSeedRef = useRef<readonly string[] | null>(arrivalIds ?? null);

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
   * A read takes a round trip, and the tab can move inside it — a live refresh
   * started on Pending, then History clicked, would otherwise draw the pending
   * list under the History tab until something asked again. Only the last read
   * owns the screen; a discarded one changes nothing, not even the ids this page
   * counts as drawn.
   */
  const readSeqRef = useRef(0);

  /**
   * Read the inbox.
   *
   *  - `view` — a first load, a tab switch. These are answers to something the
   *    operator did, so they may replace what is on screen.
   *  - `live` — a vault revision moved. Nobody asked; a card that arrived has to
   *    be added to what the operator is already reading, not swapped in for it.
   *
   * Arrival is judged against every decision the vault holds rather than against
   * this tab's filtered list, because a filing is a filing whatever is on screen.
   *
   * There is no domain lens in this read: the surface is global, so moving the
   * lens is not a reason to ask the vault again and cannot change the answer.
   */
  const load = useCallback(
    async (mode: "view" | "live" = "view") => {
      const seq = readSeqRef.current + 1;
      readSeqRef.current = seq;
      if (mode === "view" && !seededRef.current) setLoading(true);
      if (mode === "view" && tab !== "pending") setManualLoading(true);
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
        /** The paint that draws the list for the first time, not a live update. */
        const firstLoad = !seededRef.current;
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
        // No domain filter: this shelf is global, and the active lens must never
        // be able to hide a proposal waiting for an answer. The dashboard's own
        // "Pending decisions" card is where the lens-scoped reading lives.
        // Newest first
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        setItems(list);

        // A filing that OPENED this sheet. The page was not on screen when it
        // was written, so the live-arrival path below never saw it; the watcher
        // carried the ids in the navigation. The first paint marks those cards,
        // so the sheet opens with the new one already wearing the aura and the
        // line above the list naming who filed it — the eye lands on the thing
        // it is meant to answer, not on a list where one more card appeared.
        const seed = arrivalSeedRef.current;
        if (firstLoad && seed && seed.length > 0) {
          arrivalSeedRef.current = null;
          const arrived = result.value.filter(
            (d) => d.status === "pending" && seed.includes(d.id),
          );
          if (arrived.length > 0) {
            const newest = arrived
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
            setArrival({
              ids: arrived.map((d) => d.id),
              actor: actorDisplayName(newest.actor),
              at: Date.now(),
            });
          }
        }

        // The second store is read only by the tabs that show it. A failure to
        // read it must not read as "you have logged nothing": an empty history
        // and a broken one are different facts, so the error is said out loud.
        if (tab !== "pending") {
          try {
            const manualResult = await api().manualDecisionList();
            if (readSeqRef.current !== seq) return;
            if (manualResult.ok) {
              setManualItems(manualResult.value);
            } else {
              setManualItems([]);
              setError(`Could not load manual decisions: ${manualResult.error}`);
            }
          } catch (err) {
            if (readSeqRef.current !== seq) return;
            setManualItems([]);
            setError(
              `Could not load manual decisions: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        } else {
          setManualItems([]);
        }

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
        setManualLoading(false);
      }
    },
    [tab],
  );

  // The operator's own moves: the first paint and a tab. The lens is not one of
  // them — the page reads the same list under every lens.
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

  /**
   * Hand the page back when the queue has been answered.
   *
   * Settings › Decisions › auto-close. The check is on the whole store rather
   * than on this tab's list: the queue is empty when no Decision anywhere is
   * still pending, which is exactly the moment the operator has nothing left to
   * answer here and the sheet is only in their way. It fires on a rejection as
   * well as an approval — the operator's answer is what empties the queue, not
   * the verdict.
   *
   * Only the operator's own answer closes the sheet. A Decision resolved in
   * another window arrives through the live revision, and a sheet that vanished
   * under an operator who was reading History would be the app taking their
   * place rather than handing it back.
   *
   * The read is its own, rather than the list `load()` just drew: the approve
   * write announces a vault revision, and the live re-read that announcement
   * starts can supersede the answer path's read (`readSeqRef`) and hand it back
   * `null`. Asking the vault once more is a cheap local call, and it makes "is
   * the queue empty" a fact of the vault rather than a race between two reads.
   * A read that fails leaves the sheet up: closing on a guess is worse than one
   * extra click.
   */
  async function closeIfAnswered(): Promise<void> {
    if (!onClose) return;
    if (!autoClose) return;
    let remaining: DecisionRecord[];
    try {
      const result = await api().decisionList();
      if (!result.ok) return;
      remaining = result.value;
    } catch {
      return;
    }
    if (remaining.some((decision) => decision.status === "pending")) return;
    onClose();
  }

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
      await closeIfAnswered();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to resolve decision",
      );
    } finally {
      setResolvingId(null);
    }
  }

  function selectTab(next: Tab) {
    setTab(next);
    setEditingId(null);
    setActionMessage(null);
    setError(null);
  }

  function beginEdit(id: string) {
    setEditingId(id);
    setActionMessage(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  /**
   * Amend only — the Decision stays in the queue.
   *
   * The list is re-read rather than patched in place because the engine owns
   * what the amended record looks like (it keeps the agent's original on the
   * first amendment, re-derives the title for body-carried titles); reading it
   * back is what makes the chip and the title on the card the record's own
   * facts rather than this page's guess. `refresh()` is not needed here: no
   * document changed, only a proposal waiting for an answer.
   */
  async function saveAmendment(id: string, amendment: DecisionAmendment) {
    setSavingId(id);
    setError(null);
    setActionMessage(null);
    try {
      const result = await api().decisionAmend(id, amendment);
      if (!result.ok) {
        // The editor stays open: a refusal (a structural field edited through
        // the exact proposal, say) must not throw away the operator's work.
        setError(result.error);
        return;
      }
      setEditingId(null);
      setActionMessage("Changes saved.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save the changes",
      );
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Amend, then approve — one operator intent, two vault writes.
   *
   * The amend has to land first: approval applies whatever the record holds, so
   * approving first and editing after would be editing a proposal that already
   * became a file. If the amend succeeds and the approve does not, the edited
   * proposal is kept on screen (the list is re-read) and the resolve error is
   * said above it — the operator's correction is not lost because the apply
   * was refused, and the record is still pending for them to fix.
   */
  async function approveWithChanges(id: string, amendment: DecisionAmendment) {
    setSavingId(id);
    setError(null);
    setActionMessage(null);
    setArrival(null);
    let amended = false;
    try {
      const amendResult = await api().decisionAmend(id, amendment);
      if (!amendResult.ok) {
        setError(amendResult.error);
        return;
      }
      amended = true;
      setEditingId(null);
      const resolveResult = await api().decisionResolve(id, "approved");
      if (!resolveResult.ok) {
        // Reload BEFORE saying why: the read clears the page's error line, so
        // an error set first would be wiped by the refresh that keeps the
        // operator's corrected proposal on screen.
        await load();
        setError(resolveResult.error);
        return;
      }
      setActionMessage("Decision approved with your changes.");
      await load();
      // Refresh vault snapshot so document editors pick up approved body.
      await refresh();
      await closeIfAnswered();
    } catch (err) {
      if (amended) await load();
      setError(
        err instanceof Error ? err.message : "Failed to approve the decision",
      );
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Put the agent's proposal back, in one click.
   *
   * It is an amendment with `revert: true` because the undo has to be recorded
   * like every other touch: the log line names the restoration, and a later
   * reading of the record can tell that the operator once corrected it and
   * changed their mind.
   */
  async function revertToOriginal(id: string) {
    setSavingId(id);
    setError(null);
    setActionMessage(null);
    try {
      const result = await api().decisionAmend(id, { revert: true });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      setActionMessage("Reverted to the agent's version.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to revert the proposal",
      );
    } finally {
      setSavingId(null);
    }
  }

  /**
   * The record the form just logged.
   *
   * It is added to the store the page already holds — not re-read — so it is on
   * screen the moment the form hands it over. The live revision will ask for a
   * fresh read too, which is what makes a decision logged in another window
   * arrive here later.
   */
  function manualLogged(decision: ManualDecisionRecord) {
    setManualItems((previous) =>
      [decision, ...previous.filter((m) => m.id !== decision.id)],
    );
    setActionMessage("Decision logged.");
    setError(null);
  }

  /**
   * The arrivals this tab is actually showing.
   *
   * The mark is worn by the cards on screen, and the line above the list counts
   * those same cards. A filing can land while History owns the screen, where no
   * pending card is drawn; the line must then wait for the operator to come back
   * to Pending rather than count a card they cannot see.
   */
  const arrivedIds = new Set(arrival?.ids ?? []);
  const arrivedOnScreen = items.filter((d) => arrivedIds.has(d.id));
  const livedDomains = domains.filter((d) => !d.meta.archivedAt);

  // The manual store is global on this surface too: a decision the operator
  // logged under one domain is still theirs to read on the governance shelf, and
  // one logged with no domain is the Overview's own. Newest first, like the
  // proposals; the tab and the history filter are the only things that narrow it.
  const manualDecisions = manualItems
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // The list this tab draws. Pending is one store; History merges the resolved
  // proposals with the operator's own decisions, and the filter decides which
  // side of that comparison is on screen.
  let rows: InboxRow[];
  if (tab === "history") {
    const aiRows: InboxRow[] = items.map((decision) => ({ kind: "ai", decision }));
    const manualRows: InboxRow[] = manualDecisions.map((manual) => ({
      kind: "manual",
      manual,
    }));
    if (historyFilter === "ai") rows = aiRows;
    else if (historyFilter === "manual") rows = manualRows;
    else rows = [...aiRows, ...manualRows];
    rows.sort((a, b) => rowAt(b).localeCompare(rowAt(a)));
  } else {
    rows = items.map((decision) => ({ kind: "ai", decision }));
  }

  const emptyText =
    tab === "pending"
      ? "No pending proposals."
      : historyFilter === "manual"
        ? "No manual decisions logged yet."
        : historyFilter === "ai"
          ? "No resolved AI decisions yet."
          : "No decisions yet. Log one yourself on the Manual tab, or wait for a proposal.";

  const newMark = arrival ? `is-new decision-card--new-${arrival.at}` : "";

  return (
    <div className="decisions-inbox">
      {/* The sheet's chrome already says "Decisions" and what the page is for,
          so the inbox drops its own title when it is worn as a surface. The
          standalone shape stays for the rigs that draw the component alone. */}
      {showHeader ? (
        <header className="decisions-inbox__header">
          <p className="decisions-inbox__eyebrow">Inbox</p>
          <h1 className="stub-page__title">Decisions</h1>
          <p className="stub-page__desc muted">
            Approve a proposal to write it into the vault. Reject it to leave the
            vault as it is. Log your own decisions on the Manual tab.
          </p>
        </header>
      ) : null}

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
          onClick={() => selectTab("pending")}
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
          onClick={() => selectTab("history")}
        >
          History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manual"}
          className={[
            "decisions-inbox__tab",
            tab === "manual" ? "decisions-inbox__tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => selectTab("manual")}
        >
          Manual
        </button>
      </div>

      {/* The comparison the operator asked for, on the tab where both stores are
          read: their own decisions against the ones filed through the inbox. */}
      {tab === "history" ? (
        <div
          className="decisions-inbox__filters"
          role="group"
          aria-label="Filter decisions by source"
        >
          {HISTORY_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={historyFilter === filter.id}
              className={[
                "decisions-inbox__filter",
                historyFilter === filter.id
                  ? "decisions-inbox__filter--active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setHistoryFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}

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

      {tab === "manual" ? (
        <ManualDecisionsPanel
          domains={livedDomains}
          // The lens is only a convenient default for the DOMAIN FIELD here, not
          // a filter: the panel and History draw every logged decision.
          defaultDomainSlug={lens.kind === "domain" ? lens.slug : null}
          items={manualDecisions}
          loading={manualLoading}
          onLogged={manualLogged}
        />
      ) : loading ? (
        <p className="muted">Loading decisions…</p>
      ) : rows.length === 0 ? (
        <p className="muted decisions-inbox__empty">{emptyText}</p>
      ) : (
        <ul className="decisions-inbox__list">
          {rows.map((row) => {
            if (row.kind === "manual") {
              return (
                <ManualDecisionCard
                  key={`manual:${row.manual.id}`}
                  decision={row.manual}
                  domains={domains}
                />
              );
            }
            const d = row.decision;
            const title =
              tab === "pending" && d.proposedTitle ? d.proposedTitle : d.title;
            // The domain reads as a badge beside the status pill, where the eye
            // scans before it reads the card, rather than as a word buried in the
            // meta line that repeats it. KAR-70 pairing Decisions belong to no
            // domain, so they simply have no badge.
            const domainChips = d.domainSlugs.map((slug) => ({
              slug,
              name: domainLabel(slug, domains),
            }));
            const statusLabel = d.reason
              ? "Could not apply"
              : d.status === "approved" && d.amendedAt != null
                ? // The operator's correction is what got approved, so History
                  // names it. A terminal apply failure above keeps its own
                  // label: "could not apply" is a different fact from "edited".
                  "approved · edited"
                : d.status;
            const statusClass = d.reason
              ? "decision-status--stale"
              : `decision-status--${d.status}`;
            const isNew = arrivedIds.has(d.id);
            const isEditing = editingId === d.id;
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
                    {/* History reads two stores, so it names the side each card
                        came from. Pending is the inbox itself and needs no chip. */}
                    {tab === "history" ? (
                      <span
                        className="decision-source decision-source--ai"
                        data-source={d.actor.type === "agent" ? "ai" : "you"}
                      >
                        {d.actor.type === "agent" ? "AI" : "You"}
                      </span>
                    ) : null}
                    <span className="decision-kind">{kindLabel(d.target)}</span>
                    {isNew ? <span className="decision-new">New</span> : null}
                    {/* Provenance on the queue itself: this proposal is no
                        longer the agent's words, and the operator answering it
                        should know before they answer. */}
                    {tab === "pending" && d.amendedAt != null ? (
                      <span
                        className="decision-edited"
                        data-testid="decision-edited-chip"
                      >
                        Edited by you
                      </span>
                    ) : null}
                  </span>
                  <span className="decision-card__kicker-right">
                    {domainChips.map((chip) => (
                      <span
                        key={chip.slug}
                        className="decision-domain"
                        data-domain-slug={chip.slug}
                        title={`Domain: ${chip.name}`}
                      >
                        {chip.name}
                      </span>
                    ))}
                    <span className={`decision-status ${statusClass}`}>
                      {statusLabel}
                    </span>
                  </span>
                </div>
                <div>
                  <h2 className="decision-card__title">{title}</h2>
                  <p className="decision-card__meta muted">
                    <span>{actorDisplayName(d.actor)}</span>
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
                !isEditing &&
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

                {isEditing ? (
                  // The editor takes the place of both the read-only body and
                  // the answer pair: a card being corrected is not being
                  // answered, and its own Save/Approve-with-changes are the
                  // answers it offers.
                  <DecisionEditor
                    decision={d}
                    busy={savingId === d.id}
                    onCancel={cancelEdit}
                    onSave={(amendment) => saveAmendment(d.id, amendment)}
                    onApproveChanges={(amendment) =>
                      approveWithChanges(d.id, amendment)
                    }
                    onRevert={() => revertToOriginal(d.id)}
                  />
                ) : (
                  <>
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
                          data-testid="btn-decision-reject"
                          disabled={resolvingId === d.id || savingId === d.id}
                          onClick={() => void resolve(d.id, "rejected")}
                        >
                          {resolvingId === d.id ? "…" : "Reject"}
                        </button>
                        {supportsAmendment(d) ? (
                          <button
                            type="button"
                            className="btn"
                            data-testid="btn-decision-edit"
                            disabled={resolvingId === d.id || savingId === d.id}
                            onClick={() => beginEdit(d.id)}
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-primary"
                          data-testid="btn-decision-approve"
                          disabled={resolvingId === d.id || savingId === d.id}
                          onClick={() => void resolve(d.id, "approved")}
                        >
                          {resolvingId === d.id ? "…" : "Approve"}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}

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
