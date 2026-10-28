import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  recordVisibleMulti,
  type DomainLens,
} from "@lifequest/vault-core/pure";
import type { DecisionRecord } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useLiveData } from "@/state/LiveDataProvider";
import { useVault } from "@/state/VaultProvider";
import { ChatsSidebar } from "@/components/hermes/ChatsSidebar";
import { NavCollapseButton } from "./NavCollapseButton";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { UpdateBadge } from "./UpdateBadge";
import { useDomainLens } from "./useActiveDomain";
import { useWing } from "./WingProvider";

/** How long the badge wears the arrival mark. */
const BADGE_ARRIVAL_MS = 4_000;

/** The pending Decisions this rail is counting for the lens it is showing. */
function pendingCountFor(
  decisions: readonly DecisionRecord[],
  lens: DomainLens,
): number {
  return decisions.filter((decision) => {
    if (decision.status !== "pending") return false;
    const slugs = Array.isArray(decision.domainSlugs) ? decision.domainSlugs : [];
    return recordVisibleMulti(lens, slugs);
  }).length;
}

export function NavRail() {
  const { active } = useWing();
  const { snapshot } = useVault();
  const lens = useDomainLens();
  /**
   * The vault's own change signal, which is how a Decision filed by the agent
   * reaches this rail while it sits at the edge of every page.
   *
   * THE FAULT THIS REPAIRS (reported, not imagined): the agent filed Decisions,
   * said so, and the rail's Decisions badge never moved. The count used to be
   * read from the vault SNAPSHOT, which only changes when something explicitly
   * refreshes it — a chat turn that happened to refresh after the filing, a
   * vault action, a window focus. A Decision filed by a scheduled automation, by
   * a paired agent on the MCP door, or by a turn whose refresh landed before the
   * filing did was invisible on the rail until some later refresh, and the
   * operator's report was "neither did any notifications icon".
   *
   * The inbox already reads the Decision list on this signal, and the rail now
   * reads the same list the same way. The snapshot is still the first paint, so
   * the rail has a count before the first read answers; `revision` moving is
   * what makes it live. Nothing else about the vault is re-read here — the rail
   * must not turn every write into a full snapshot refresh.
   */
  const live = useLiveData();
  const [pendingCount, setPendingCount] = useState(() =>
    pendingCountFor(snapshot?.decisions ?? [], lens),
  );
  /** The newest read, so a slower earlier answer cannot replace it. */
  const readSeq = useRef(0);
  useEffect(() => {
    const seq = readSeq.current + 1;
    readSeq.current = seq;
    void (async () => {
      try {
        const result = await api().decisionList();
        if (!result.ok || readSeq.current !== seq) return;
        setPendingCount(pendingCountFor(result.value, lens));
      } catch {
        // Keep what is drawn: a transient read failure is not "no decisions".
      }
    })();
  }, [live, lens]);

  /**
   * The moment the count last grew, so the badge can say "this is new" rather
   * than just "there are some".
   *
   * THE FAULT THIS REPAIRS: a Decision filed by the agent appeared on the
   * Decisions page, but the rail gave no sign at all. The count alone is easy to
   * miss on a rail of icons — four is as quiet as zero — and the operator's
   * report was "neither did any notifications icon". So an arrival pulses.
   *
   * A DECREASE (approving or rejecting) deliberately does not: the mark belongs
   * to new work waiting, not to the list shrinking under the operator's own hand.
   * It is stamped rather than a boolean so a second filing restarts the pulse
   * instead of inheriting an animation that had already finished.
   */
  const previousCount = useRef(pendingCount);
  const [arrivalAt, setArrivalAt] = useState<number | null>(null);
  useEffect(() => {
    const before = previousCount.current;
    previousCount.current = pendingCount;
    if (pendingCount > before) setArrivalAt(Date.now());
  }, [pendingCount]);
  useEffect(() => {
    if (arrivalAt === null) return;
    const timer = window.setTimeout(() => setArrivalAt(null), BADGE_ARRIVAL_MS);
    return () => window.clearTimeout(timer);
  }, [arrivalAt]);

  const topPinned = NAV_ITEMS.filter((item) => item.pin === "top");
  const wingItems = NAV_ITEMS.filter((item) => item.wing === active);
  const bottomPinned = NAV_ITEMS.filter((item) => item.pin === "bottom");
  const footerPinned = NAV_ITEMS.filter((item) => item.pin === "footer");

  function renderItem(item: NavItem) {
    const Icon = item.icon;
    const count = item.id === "decisions" ? pendingCount : 0;
    const name = count > 0 ? `${item.label}, ${count} pending` : item.label;

    return (
      <NavLink
        key={item.id}
        to={item.href}
        className={({ isActive }) =>
          ["nav-rail__link", isActive ? "nav-rail__link--active" : ""]
            .filter(Boolean)
            .join(" ")
        }
        title={name}
        aria-label={name}
      >
        <span className="nav-rail__icon-wrap">
          <Icon size={18} aria-hidden />
          {count > 0 ? (
            <span
              className={[
                "nav-rail__badge",
                item.id === "decisions" && arrivalAt !== null
                  ? "nav-rail__badge--arrived"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-arrived={
                item.id === "decisions" && arrivalAt !== null ? "true" : undefined
              }
              aria-hidden="true"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </span>
        <span className="nav-rail__label">{item.label}</span>
      </NavLink>
    );
  }

  return (
    <nav className="nav-rail" id="nav-rail" aria-label="Main">
      <div className="nav-rail__header">
        <NavCollapseButton />
      </div>
      {topPinned.length > 0 ? (
        <>
          <div className="nav-rail__section">{topPinned.map(renderItem)}</div>
          <div className="nav-rail__divider" role="separator" />
        </>
      ) : null}
      <div className="nav-rail__section nav-rail__section--wing" data-nav-group="wing">
        {wingItems.map(renderItem)}
      </div>
      {/*
        The chats are the sidebar's middle: under the pages of the wing the
        operator is in, above the governed shelf and the Log. The section takes
        whatever height those two fixed groups leave and scrolls inside it, so a
        long history never pushes the icons at the foot off the column.
      */}
      <div className="nav-rail__divider" role="separator" />
      <ChatsSidebar />
      {/*
        The governed shelf and the Log are two groups, not one list. The rail
        draws a divider above the shelf and another between the shelf and the
        Log, so the four pages that belong to no wing read as their own cordoned
        section at the foot of the sidebar — with the Log closing the rail just
        below them.
      */}
      <div className="nav-rail__section nav-rail__section--bottom">
        {bottomPinned.length > 0 ? (
          <>
            <div className="nav-rail__divider" role="separator" />
            <div className="nav-rail__section" data-nav-group="governance">
              {bottomPinned.map(renderItem)}
            </div>
          </>
        ) : null}
        {footerPinned.length > 0 ? (
          <>
            <div className="nav-rail__divider" role="separator" />
            <div className="nav-rail__section" data-nav-group="footer">
              {footerPinned.map(renderItem)}
            </div>
          </>
        ) : null}
        {/* The build number, and the app's manual update check. Quiet text until
            the feed names something newer, when it also carries the glow; a
            click always opens the update panel. */}
        <UpdateBadge />
      </div>
    </nav>
  );
}
