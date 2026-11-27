import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import type { DecisionRecord } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useLiveData } from "@/state/LiveDataProvider";
import { useVault } from "@/state/VaultProvider";
import { ChatsSidebar } from "@/components/hermes/ChatsSidebar";
import { NavBrandButton, NavCollapseButton } from "./NavCollapseButton";
import { UpdateBadge } from "./UpdateBadge";
import { VaultChip } from "./VaultChip";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { useWing } from "./WingProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { DomainSwitcher } from "./DomainSwitcher";
import { WingTabs } from "./WingTabs";
import { useTheme } from "@/components/theme/ThemeProvider";
import { CompositionSlot } from "@/components/composition/CompositionSlot";

/** How long the badge wears the arrival mark. */
const BADGE_ARRIVAL_MS = 4_000;

/**
 * The pending Decisions this rail is counting — every one of them.
 *
 * The rail's Decisions shelf is global governance, so its badge counts what the
 * operator has to answer, whichever domain filed it. Filtering this count by the
 * active domain lens is how a cross-domain filing once went unnoticed: the
 * companion filed three pending Decisions, the lens was on another domain, and
 * both the page and this badge said there was nothing waiting. The lens-scoped
 * view is the dashboard's "Pending decisions" pin, not this badge.
 */
function countPending(decisions: readonly DecisionRecord[]): number {
  return decisions.filter((decision) => decision.status === "pending").length;
}

export function NavRail() {
  const { active } = useWing();
  const { collapsed } = useNavDock();
  const { chrome } = useTheme();
  const { snapshot } = useVault();
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
    countPending(snapshot?.decisions ?? []),
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
        setPendingCount(countPending(result.value));
      } catch {
        // Keep what is drawn: a transient read failure is not "no decisions".
      }
    })();
  }, [live]);

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
      {/*
        The top line of the rail, in the window strip: the studio's lockup,
        centred on the column, and it is a control now as well as a mark — a press
        on it collapses the rail, the same way the foot's square control does (see
        `NavBrandButton`). The lockup is the operator's pick of the four shipped
        logos (Settings → Developer, default Minimal), drawn inline so the theme's
        three inks — LIFE, the Q emblem, UEST — reach it. The air around the mark
        is still the window's drag handle.

        Under the lockup, centred on the column, sits the build number: the rail's
        small print at the top rather than on the column's floor (see
        `UpdateBadge`). The square collapse toggle does not close this row: it lives
        in the rail's foot beside the vault chip, so the header is the mark and the
        version it belongs to. The thin rail cannot hold a word: the lockup and the
        version leave, the square control moves up here as the pure Q emblem, and
        this row stays as the window's drag handle and the column's top air (see
        "The thin rail").
      */}
      <div className="nav-rail__header">
        <NavBrandButton />
        <div className="nav-rail__version">
          <UpdateBadge />
        </div>
        {/*
          The square control lives in the foot while the rail is wide, but the
          thin column is too short to bury the way back under a stack of rows:
          collapsed, the same button moves up here and centres in the topband as
          the pure Q emblem (see `NavCollapseButton`). One control, two places.
        */}
        {collapsed ? <NavCollapseButton /> : null}
      </div>
      {/* The theme's composition widgets for the rail: a count under the
          header, and the foot's own band. Rail furniture, not commands. */}
      <CompositionSlot region="rail.top" />
      {/*
        The sidebar's own band: the five wings, and under them the active wing's
        pages. The rail is the first level of navigation, so the switcher belongs
        here rather than in the sheet, where it also crowded the domain lens off
        the band's centre.

        Wide, it is one horizontal segmented control. Thin, it turns vertical and
        keeps all five wings reachable in the icon column — the rail cannot swap
        wings out of the operator's reach just because it narrowed.
      */}
      {chrome.wingSwitcher.place === "rail-top" ? (
        <div className="nav-rail__wings-band" data-nav-group="wings">
          <WingTabs variant={chrome.wingSwitcher.variant} />
        </div>
      ) : null}
      {/*
        The area lens can live in the rail's own column: under the wings, above
        the pages. It is the rail's second level of navigation when the operator
        (or a theme) asks for it, and it keeps the same radio group and arrow
        keys it has in the strip — only the frame changes.
      */}
      {chrome.domainSwitcher.place === "left-rail" ? (
        <div
          className="nav-rail__lens"
          data-chrome-slot="domain"
          data-chrome-place="left-rail"
          data-chrome-frame={chrome.domainSwitcher.frame}
        >
          <DomainSwitcher variant={chrome.domainSwitcher.variant} />
        </div>
      ) : null}
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

        The divider above them is its own class because the thin rail hides the
        list: the swimlane between the wing's pages and the shelf would otherwise
        be two hairlines with nothing between them.
      */}
      <div
        className="nav-rail__divider nav-rail__divider--chats"
        role="separator"
      />
      <ChatsSidebar />
      {/*
        The governed shelf and the foot are two groups, not one list. The rail
        draws a divider above the shelf and another between the shelf and the
        foot, so the four pages that belong to no wing read as their own cordoned
        section at the foot of the sidebar.

        The foot is one row of three: the Log closes the rail's navigation, the
        chip names the open vault, and the collapse toggle holds the row's
        trailing end — the sidebar's bottom corner. The toggle sits beside the
        picker rather than under it, so the column ends on the navigation it
        belongs to and the version that used to share a caption row lives up under
        the lockup instead. The Log and the chip split what the toggle leaves. In
        the thin rail the two stack — the Log's icon with the vault's initials
        under it — and the pure emblem that reopens the rail moves up to the
        topband, where the way back belongs.
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
            <div className="nav-rail__foot" data-nav-group="footer">
              <div className="nav-rail__foot-row">
                {footerPinned.map(renderItem)}
                <VaultChip />
                {collapsed ? null : (
                  <NavCollapseButton className="nav-rail__collapse" />
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <CompositionSlot region="rail.footer" />
    </nav>
  );
}
