import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Pin as PinIcon } from "lucide-react";
import type { DecisionRecord, LifeEvent, PageListEntry, Pin } from "@lifequest/vault-core";
import { SYSTEM_PIN_KINDS, type SystemPinKind } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import { useVault } from "@/state/VaultProvider";
import { useLiveData } from "@/state/LiveDataProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { GoalProgressCard } from "@/pages/home-pins/GoalProgressCard";
import { DeadlineBanner } from "@/pages/home-pins/DeadlineBanner";
import { DoctrineProgressCard } from "@/pages/home-pins/DoctrineProgressCard";
import { PendingDecisionsCard } from "@/pages/home-pins/PendingDecisionsCard";
import { TodayWeekCard } from "@/pages/home-pins/TodayWeekCard";
import { RecentLogCard } from "@/pages/home-pins/RecentLogCard";
import { ActiveAgentsCard } from "@/pages/home-pins/ActiveAgentsCard";
import { PinChrome } from "@/components/home/PinChrome";
import { cardNameIn } from "@/components/home/card-name";
import {
  anchorOf,
  boardFrame,
  boardScrolls,
  restoreBoardHold,
  watchBoardHold,
  type BoardHold,
} from "@/components/home/board-hold";
import { usePinArrange, type CommitOutcome } from "@/components/home/usePinArrange";
import { useTileSpans } from "@/components/home/useTileSpans";
import { useCardResize } from "@/components/home/useCardResize";
import { useDeveloperFlag } from "@/state/developer-flags";
import { ViewCard } from "@/components/ui/ViewCard";
import type { SavedView } from "@lifequest/vault-core";

/**
 * A view plus the domain that owns it. `SavedView` is the file's contents and
 * carries no domain — the domain is which directory it was read from — and the
 * Overview board shows views from every domain, so the pair has to travel
 * together or a pin cannot be addressed.
 */
type BoardView = SavedView & { domainSlug: string };

/**
 * What a card's chat control says it does, in its two states.
 *
 * The control is a toggle: unpressed it hands the card to the chat, pressed it
 * takes that card back off. The board draws the same fact as a ring around the
 * card, so these words say again what the picture already says — which is what
 * an accessible name is for, and why the pressed state is not left to the ring
 * alone.
 */
const CHAT_ASK = "Ask the companion about this card";
const CHAT_TAKE_OFF = "Take this card out of the chat";

export default function HomePage() {
  const { snapshot, reloadGeneration, refresh } = useVault();
  /**
   * The board's own liveness. A view pin re-runs itself off this (see
   * `ViewCard`), and the built-in cards — the life log, pending Decisions, the
   * week, goal progress — read data this page owns, so the page re-reads that
   * data too. Both halves are needed: a write that lands while the operator
   * watches must move the ledger table AND the log line that says it happened.
   */
  const live = useLiveData();
  const { contextCard, setContextCard, setOpen: setChatOpen, livePinId } =
    useChatDock();
  const lens = useDomainLens();
  /**
   * The operator's width handle, which ships gated.
   *
   * Settings → Developer turns it on, and the flag is read here rather than only
   * inside the gesture: with it off the board must not draw the edge, offer the
   * tab stop, or answer a press on it. The hook refuses to start a gesture as
   * well — an edge that is gone from the eye but still listening would be a
   * feature nobody could switch off.
   */
  const cardWidthHandle = useDeveloperFlag("cardWidthHandle");
  const title =
    lens.kind === "domain"
      ? (snapshot?.domains.find((d) => d.slug === lens.slug)?.meta.name ?? "Overview")
      : "Overview";
  /**
   * The app's own yes/no question, for the one thing on this page that cannot be
   * undone. It is asked in the window rather than by the platform, so it lands
   * over the board that asked it and a rig can answer it.
   */
  const { ask, dialog } = useConfirm();

  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  /**
   * The operator's page lock on THIS board. Unlocked, the board is edited in
   * place by the pin chrome and by the companion; locked, the board is read-only
   * here and every agent change lands in Decisions instead. The lock itself is
   * read from the board file, so the state and the pins always agree.
   */
  const [locked, setLocked] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  /**
   * Whether the pin board is showing.
   *
   * The row is furniture for a control used once in a while, and below a board of
   * seven cards it sat off the bottom of the window — so the operator had to
   * scroll past everything they own to add anything. It is a header control now,
   * closed on landing, and the board is the page. Live state, not a preference:
   * there is no file that says how somebody left a row, and this adds none.
   */
  const [addOpen, setAddOpen] = useState(false);
  /**
   * Which card's 3-dot menu is open, if any.
   *
   * One at a time, the same rule the chat list and the chain follow: two open
   * menus on one board is not a state worth supporting. It closes when the
   * trigger is pressed again, when another card's is, on Escape, on any press
   * outside the menu, and when either item is chosen.
   */
  const [menuPinId, setMenuPinId] = useState<string | null>(null);
  const [pages, setPages] = useState<PageListEntry[]>([]);
  const [views, setViews] = useState<BoardView[]>([]);
  /**
   * A board write in flight — a pin write, an arrange, or a delete.
   *
   * One flag for all of them, because they are one thing to the operator: while
   * any of them is running the board must not be picked up, dropped, or written
   * again. `usePinArrange` takes it as its `busy`, so a card being written cannot
   * be lifted mid-flight.
   */
  const [boardBusy, setBoardBusy] = useState(false);
  const [installedKits, setInstalledKits] = useState<string[] | null>(null);
  /**
   * Whether a gesture owns the board's geometry right now — a card in the air, or
   * a width being dragged.
   *
   * One flag for both, because they are one thing to the measurement pass that
   * reads it: while either is running, the card under the hand is the truth about
   * its own width, and a pass that measured and re-wrote every card's span would
   * be the page arguing with the pointer.
   */
  const [resizing, setResizing] = useState(false);

  /** A page pin's card names the page the board lists. */
  const pageTitleOf = useCallback(
    (pin: Extract<Pin, { kind: "page" }>) =>
      pages.find((entry) => entry.domainSlug === pin.domainSlug && entry.page.id === pin.pageId)
        ?.page.title ?? pin.pageId,
    [pages],
  );

  /**
   * A view pin's card names the view it draws — read off the saved views the page
   * already has, rather than off the DOM, because this names the card for a screen
   * reader at render time and the card may not have drawn its heading yet.
   */
  const viewTitleOf = useCallback(
    (pin: Extract<Pin, { kind: "view" }>) =>
      views.find((view) => view.domainSlug === pin.domainSlug && view.id === pin.viewId)?.title ??
      pin.viewId,
    [views],
  );

  /**
   * The board's own gesture: hold a card to lift it, drag it, drop it. The hook
   * needs the lock and the write guard because a locked board has no gesture at
   * all, and a card being written must not be picked up mid-flight.
   */
  const arrange = usePinArrange({
    pins,
    locked,
    busy: boardBusy,
    onCommit: (next) => persistPins(next),
  });

  /**
   * The board's tiles: every card as wide as its content needs, and the board
   * never narrower than its widest card.
   *
   * A card is a live query, and the reported fault was the one thing a grid of
   * fixed cells cannot know: the "Recent transactions" pin is stored one cell
   * wide while its table is four nowrap columns, so the table painted over the
   * card's own frame. The rule and its arithmetic are in `useTileSpans` and
   * `tile-span.ts`; what this page contributes is the two facts the hook cannot
   * read for itself — the board's order, and the vault revision that redraws
   * every card on it.
   *
   * It runs before the hold below, because the hold's whole job is to keep the
   * operator's place while the board reflows, and a span decided after the
   * correction would be a reflow the operator sees.
   */
  const tiles = useTileSpans({
    gridRef: arrange.gridRef,
    pins,
    live,
    // A width being dragged owns the geometry of the card under it, exactly as a
    // card in the air does: the measurement pass writes `width` on every card, and
    // a pass landing mid-drag would fight the hand. The board is re-measured the
    // moment either gesture ends.
    arranging: arrange.isArranging || resizing,
  });

  /**
   * The operator's own hand on a card's width: drag a card's right edge.
   *
   * The range is [what the card's content needs, the whole row] — never narrower,
   * because that is the spill this board was reported for — and the far end of it
   * means "fill the row", which is the same state the chrome's width control
   * names. One drop is one write, and a drag that ends where it started writes
   * nothing at all.
   */
  const resize = useCardResize({
    gridRef: arrange.gridRef,
    tiles,
    locked,
    busy: boardBusy,
    // Gated: with the developer switch off, the gesture does not exist even if a
    // press somehow reaches where the edge would have been.
    enabled: cardWidthHandle,
    onGesture: setResizing,
    onCommit: (pinId, units, maxUnits) => onResizeCommit(pinId, units, maxUnits),
  });

  /**
   * The place the board is in, held across whatever the vault does to it.
   *
   * A card is a live query: the companion saves a view, the card redraws with
   * different content, its box changes height, and the grid below it reflows —
   * which moves every card after it. The operator did not scroll, and their
   * `scrollTop` did not change, but everything they were reading moved. That is the
   * reported bug, and `board-hold.ts` is the whole of the repair.
   *
   * WHY THE CORRECTION IS UNCONDITIONAL, AND WHY THAT IS NOT RECKLESS
   *
   * The hold is a description of where the operator was looking when it was taken,
   * so restoring it IS enforcing that description — and enforcing a description the
   * operator has left is the failure mode worth fearing. The answer is not to make
   * the correction conditional on some reading of the board; two such readings were
   * tried and measured, and both are wrong in the same direction (see the listener
   * below). The answer is that the hold is kept current by the one signal that
   * genuinely means "the operator moved": a scroll event.
   *
   * THE BROWSER'S OWN ANCHORING RUNS TOO, deliberately. Chromium frequently absorbs
   * a reflow before a layout pass of ours can, and when it has, the hold already
   * agrees with the board and our correction is a no-op. The two are not in conflict:
   * the browser reacts within the frame, and this is the exact, named correction that
   * always runs — the rig is what says that between them no frame is wrong.
   *
   * Written in a layout effect so the correction lands before the frame is painted —
   * a `useEffect` would let the browser draw the reflowed board once and then snap it
   * back, which is the jump the operator reported, only faster. Skipped entirely
   * while the operator is arranging: a drag moves the anchor card as the whole point
   * of the gesture, and holding it then would be the page overruling the hand.
   */
  const holdRef = useRef<BoardHold | null>(null);
  const arrangingRef = useRef(arrange.isArranging);
  arrangingRef.current = arrange.isArranging;
  useLayoutEffect(() => {
    const frame = boardFrame(arrange.gridRef.current);
    if (!frame || !boardScrolls(frame) || arrange.isArranging) return;
    restoreBoardHold(frame, holdRef.current);
    holdRef.current = anchorOf(frame);
    // `pins` and the live revision are the two things that can change the board's
    // layout — one reorders it, the other redraws every card on it.
  }, [arrange.gridRef, arrange.isArranging, pins, live]);

  /**
   * The other half of the hold: the operator's own scrolling.
   *
   * A manual scroll changes no React state, so the layout effect above would never
   * hear about it — and a hold taken at the top of the board would still be on the
   * books after the operator had scrolled six screens down, dragging them back the
   * next time the companion wrote anything. A scroll EVENT is the honest signal for
   * that and the only one.
   *
   * Two plausible alternatives were tried and are both wrong in the same direction.
   * "The offset is not the one I last wrote" and "the anchor is not where the hold
   * says it is" are each a comparison of a remembered board against the live one —
   * and a card re-running displaces the board inside React's own commit, before any
   * layout pass of ours runs, so each of them reads a reflow as the operator moving
   * and drops the hold at exactly the moment the hold is needed. Measured, with the
   * browser's own anchoring switched off: both slid the anchor 64px on the rig's
   * above-the-eye leg, where this passes it.
   *
   * The page's own correction fires this listener too, and that is harmless: at that
   * instant the hold and the board agree, so re-taking it is a no-op.
   */
  useEffect(() => {
    const frame = boardFrame(arrange.gridRef.current);
    if (!frame) return;
    return watchBoardHold(frame, (hold) => {
      if (arrangingRef.current) return;
      holdRef.current = hold;
    });
  }, [arrange.gridRef, pins, live]);

  const load = useCallback(async () => {
    const boardSlug = lens.kind === "domain" ? lens.slug : null;
    try {
      const [decResult, logResult, pinsRes, pagesRes, viewsRes] = await Promise.all([
        api().decisionList(),
        api().logList(),
        api().pinsList(boardSlug),
        api().pageList(boardSlug),
        // Views exist per domain; Overview lists all domains' views so a card
        // can be pinned there from any lens. Each one is tagged with the domain
        // it came from, because that is what its pin has to name.
        lens.kind === "domain"
          ? api()
              .viewList(lens.slug)
              .then((r) => (r.ok ? (r.value as SavedView[]).map((v) => ({ ...v, domainSlug: lens.slug })) : []))
          : (async () => {
              const slugs = (snapshot?.domains ?? [])
                .filter((d) => !d.meta.archivedAt)
                .map((d) => d.slug);
              const all: BoardView[] = [];
              for (const s of slugs) {
                const res = await api().viewList(s);
                if (res.ok) all.push(...(res.value as SavedView[]).map((v) => ({ ...v, domainSlug: s })));
              }
              return all;
            })(),
      ]);
      const allDecisions = decResult.ok ? decResult.value : [];
      const allEvents = logResult.ok ? logResult.value : [];

      setDecisions(
        allDecisions
          .filter((d) => d.status === "pending")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      setEvents(allEvents);
      setPins(pinsRes.ok ? pinsRes.value.pins : []);
      setLocked(pinsRes.ok ? pinsRes.value.locked : false);
      setPages(pagesRes.ok ? (pagesRes.value as PageListEntry[]) : []);
      setViews(viewsRes);
      const kitRes = await api().kitList("financial");
      setInstalledKits(kitRes.ok ? (kitRes.value as string[]) : []);
    } catch {
      setDecisions([]);
      setEvents([]);
      setPins([]);
      setLocked(false);
      setPages([]);
      setViews([]);
      setInstalledKits([]);
    }
  }, [lens]);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration, live]);

  /**
   * A menu closes on anything that is not it.
   *
   * Escape, and any press that is not on the open menu or on a trigger: the
   * second half is what keeps a menu from outliving the gesture that started
   * elsewhere — a press on the board is the beginning of an arrange, a press on
   * another card is the beginning of that card's menu, and neither should leave
   * a popup floating over a board that has moved on.
   *
   * Presses *on a trigger* are exempt rather than closed: the trigger's own click
   * decides, which is what makes pressing it again close the menu instead of
   * closing and immediately reopening it.
   */
  useEffect(() => {
    if (!menuPinId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".home-pin__menu, [data-testid='pin-menu-toggle']")) return;
      setMenuPinId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPinId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuPinId]);

  const boardSlug = lens.kind === "domain" ? lens.slug : null;
  const financialLive = (snapshot?.domains ?? []).some(
    (d) => d.slug === "financial" && !d.meta.archivedAt,
  );
  const showFinanceInstall =
    financialLive &&
    installedKits !== null &&
    !installedKits.includes("finance") &&
    (lens.kind !== "domain" || lens.slug === "financial");

  function availableSystemKinds(): SystemPinKind[] {
    const onBoard = new Set(
      pins.filter((p) => p.kind === "system").map((p) => p.system),
    );
    return SYSTEM_PIN_KINDS.filter((k) => !onBoard.has(k));
  }

  function availablePagePins(): PageListEntry[] {
    const onBoard = new Set(
      pins
        .filter((p) => p.kind === "page")
        .map((p) => (p.kind === "page" ? `${p.domainSlug}:${p.pageId}` : "")),
    );
    return pages.filter((e) => !onBoard.has(`${e.domainSlug}:${e.page.id}`));
  }

  /**
   * Views not yet on this board.
   *
   * A view belongs to the domain that owns its database, and the board may be
   * that domain or Overview. A view pin carries its OWN domainSlug — including
   * on Overview, which is the board that aggregates them — so the identity of a
   * pin is domain + view, never the board plus view. Keying on the board would
   * silently drop every cross-domain view from the Overview board's add list.
   */
  function availableViewPins(): BoardView[] {
    const onBoard = new Set(
      pins.filter((p) => p.kind === "view").map((p) => (p.kind === "view" ? `${p.domainSlug}:${p.viewId}` : "")),
    );
    return views.filter((v) => !onBoard.has(`${v.domainSlug}:${v.id}`));
  }

  async function onAddViewPin(view: BoardView) {
    const newPin: Pin = {
      id: `view:${view.domainSlug}:${view.id}`,
      kind: "view",
      domainSlug: view.domainSlug,
      viewId: view.id,
      span: 1,
    };
    await persistPins([...pins, newPin]);
  }

  async function onCycleSpan(pinId: string) {
    const target = pins.find((p) => p.id === pinId);
    if (!target || target.kind !== "view" || boardBusy) return;
    const next = pins.map((p) =>
      p.id === pinId && p.kind === "view"
        ? ({ ...p, span: p.span === 2 ? 1 : 2 } as Pin)
        : p,
    );
    await persistPins(next);
  }

  /**
   * The board's one write path, and the only thing that reaches the vault for a
   * pin change.
   *
   * The new order goes on screen first — a dropped card that springs back to
   * where it came from while the write is in flight would undo the gesture the
   * operator just made — and comes back down if the vault did not take it. The
   * rollback is a re-read rather than a restored copy of the old array: the
   * vault is the truth, and a board that changed while the write was in flight
   * must not be overwritten with a stale list.
   */
  async function persistPins(next: Pin[]): Promise<CommitOutcome> {
    // The locked board has no chrome to click, but a keyboard path or a stale
    // render could still reach here: refuse locally rather than filing a
    // Decision the operator did not ask for by clicking.
    if (locked) return "locked";
    setBoardBusy(true);
    setPins(next);
    try {
      const res = await api().pinsSet(boardSlug, next);
      if (!res.ok) {
        await load();
        return "refused";
      }
      if (!res.value.applied) {
        await load();
        return "locked";
      }
      setPins(res.value.pins);
      return "applied";
    } finally {
      setBoardBusy(false);
    }
  }

  /** Flip this board's page lock. Read-only boards can only be unlocked. */
  async function onToggleLock() {
    if (lockBusy) return;
    const next = !locked;
    setLockBusy(true);
    try {
      const res = await api().pinsSetLocked(boardSlug, next);
      if (res.ok) {
        setLocked(res.value.locked);
        setPins(res.value.pins);
      }
    } finally {
      setLockBusy(false);
    }
  }

  /**
   * Take one card off this board.
   *
   * This is the whole of "remove the card": the pin goes, the thing it draws
   * stays. It is reversible — the Add-pin row offers the card again — which is
   * why it asks nothing, and why Delete, which is not reversible, does.
   */
  async function onArchive(pinId: string) {
    setMenuPinId(null);
    await persistPins(pins.filter((p) => p.id !== pinId));
  }

  /**
   * Delete what a card draws — the saved view, or the page and its blocks.
   *
   * Asked for by name first, because this is the only thing the board can do
   * that the vault cannot bring back. Nothing here re-pins by hand: `listPinBoard`
   * already drops a pin whose view or page is gone, and `deletePage` strips its
   * own page pins, so one `load()` is what makes the card leave every board that
   * showed it — including the ones the operator is not looking at.
   */
  function onDeleteRequest(pin: Pin, control: HTMLElement) {
    setMenuPinId(null);
    const label = cardNameIn(control.closest(".home-pin")) || pin.id;
    const view = pin.kind === "view";
    ask({
      title: `Delete “${label}”?`,
      message: view
        ? "The saved view is deleted from the vault, and the card leaves every dashboard that shows it. This cannot be undone."
        : "The page and its blocks are deleted from the vault, and the card leaves every dashboard that shows it. This cannot be undone.",
      confirmLabel: view ? "Delete view" : "Delete page",
      destructive: true,
      run: () => void runDelete(pin),
    });
  }

  async function runDelete(pin: Pin) {
    if (pin.kind === "system" || boardBusy) return;
    setBoardBusy(true);
    try {
      const res =
        pin.kind === "view"
          ? await api().viewDelete(pin.domainSlug, pin.viewId)
          : await api().pageDelete(pin.domainSlug, pin.pageId);
      if (!res.ok) return;
      // The board is re-read rather than patched: the vault is the truth about
      // which cards survive a delete, and it is the read path that decides.
      await load();
      void refresh();
    } finally {
      setBoardBusy(false);
    }
  }

  /**
   * Hand one card to the chat — or take back the one this control already handed
   * over.
   *
   * The name travels with the pin, and it is read off the card the control sits
   * in rather than rebuilt from the pin: the heading is what the operator is
   * looking at, and the companion has to be told about the card in front of
   * them. The dock opens on the way — a card in context that the operator cannot
   * see the pill for is a click that appears to do nothing.
   *
   * The press is a toggle, and only on this card's own door: pressing the
   * control of the card the chat is already holding takes that card off it —
   * that is the same operator changing their mind, from the card rather than
   * from the pill — while pressing any other card's control puts THAT card in
   * context. Nothing else is undone on the way out: the chat stays open, on the
   * same conversation, minus one card.
   */
  function onChatAbout(pin: Pin, control: HTMLElement) {
    if (contextCard?.pin.id === pin.id) {
      setContextCard(null);
      return;
    }
    setContextCard({
      pin,
      label: cardNameIn(control.closest(".home-pin")) || pin.id,
      boardSlug,
    });
    setChatOpen(true);
  }

  async function onAddSystemPin(kind: SystemPinKind) {
    const newPin: Pin = { id: `sys:${kind}`, kind: "system", system: kind };
    await persistPins([...pins, newPin]);
  }

  async function onAddPagePin(entry: PageListEntry) {
    const newPin: Pin = {
      id: `page:${entry.domainSlug}:${entry.page.id}`,
      kind: "page",
      domainSlug: entry.domainSlug,
      pageId: entry.page.id,
    };
    await persistPins([...pins, newPin]);
  }

  /**
   * Save the width a drag chose.
   *
   * The far end of the handle's range is the row itself, and it is stored as the
   * row — `span: 2` — rather than as a very wide card, so a drag to the edge and a
   * press of the chrome's "Fill the row" leave the board in one state instead of
   * two that look alike and behave differently when the window moves.
   *
   * Everything else is stored as the width the operator saw, in rem: a card is
   * 398.9px wide and stays 398.9px wide whatever the window, which is what picking
   * a width by hand means. The board is never narrower than its content, so a save
   * that arrives after the content grew is still drawn at the content's floor.
   */
  async function onResizeCommit(
    pinId: string,
    units: number,
    maxUnits: number,
  ): Promise<CommitOutcome> {
    const next = pins.map((pin) => {
      if (pin.id !== pinId || pin.kind !== "view") return pin;
      const base = {
        id: pin.id,
        kind: "view" as const,
        domainSlug: pin.domainSlug,
        viewId: pin.viewId,
      };
      if (units >= maxUnits) return { ...base, span: 2 as const };
      const width = Math.round((tiles.widthOf(units) / tiles.rootFontSize()) * 100) / 100;
      return { ...base, span: 1 as const, width };
    });
    return persistPins(next);
  }

  const renderPin = (pin: Pin) => {
    if (pin.kind === "system") {
      switch (pin.system) {
        case "goal-progress":
          return <GoalProgressCard key={pin.id} />;
        case "deadline":
          return <DeadlineBanner key={pin.id} />;
        case "doctrine-progress":
          return <DoctrineProgressCard key={pin.id} />;
        case "pending-decisions":
          return <PendingDecisionsCard key={pin.id} decisions={decisions} />;
        case "today-week":
          return <TodayWeekCard key={pin.id} />;
        case "recent-log":
          return <RecentLogCard key={pin.id} events={events} />;
        default:
          return null;
      }
    }
    // A view pin renders ViewCard, the design's single drawing path. A locked
    // board hands the card `editable: false`: the board's page lock governs the
    // cards on it, for the operator as much as for the companion.
    //
    // The card is the pin's own child, with no wrapper of ours around it. There
    // used to be one, carrying a span marker, and it earned its removal twice
    // over: `ViewCard` already draws `section.view-card`, so a wrapper wearing
    // that class nested two card shells and the pin showed a frame inside its
    // frame — two borders, two radii, two shadows, and the card's own padding
    // twice over — and the width it marked is no longer a class's business at
    // all. `useTileSpans` measures the card and writes its span; the operator's
    // own "fill the row" is carried on the pin below, where the sheet paints it.
    if (pin.kind === "view") {
      return <ViewCard domainSlug={pin.domainSlug} viewId={pin.viewId} editable={!locked} />;
    }
    const domainName =
      snapshot?.domains.find((d) => d.slug === pin.domainSlug)?.meta.name ??
      pin.domainSlug;
    return (
      <section key={pin.id} className="home-card">
        <h2 className="home-card__title">{pageTitleOf(pin)}</h2>
        <p className="muted home-mini-list__meta">{domainName}</p>
        <Link to={`/pages/${pin.domainSlug}/${pin.pageId}`} className="home-card__more">
          Open page →
        </Link>
      </section>
    );
  };

  const availableKinds = availableSystemKinds();
  const addablePages = availablePagePins();
  const addableViews = availableViewPins();

  /**
   * Whether the chat is holding this card.
   *
   * It is asked of the dock's own context card rather than kept in a second piece
   * of board state: the card is ringed while it is the one the chat is about, and
   * the ring goes the moment it is not — whether the operator took it off with
   * this control or with the pill's own ✕. There is nothing to keep in step, and
   * so nothing that can disagree with the chat.
   */
  const chatHolds = (pinId: string) => contextCard?.pin.id === pinId;
  /**
   * Whether there is an add path at all.
   *
   * A locked board has none: the board is read-only, and an "Add pin" that
   * silently filed a Decision would be a second, hidden way to propose what the
   * Lock button already says is not editable. A board with everything already
   * pinned has none either — there is nothing to offer.
   */
  const canAdd =
    !locked &&
    (availableKinds.length > 0 || addablePages.length > 0 || addableViews.length > 0);

  return (
    <div className="home-dashboard">
      <header className="home-dashboard__header">
        <div>
          <p className="home-dashboard__eyebrow">Dashboard</p>
          <h1 className="home-dashboard__title">
            {title}
            <span
              className={`doc-status-badge doc-status-badge--${locked ? "locked" : "unlocked"}`}
              data-locked={locked ? "true" : "false"}
              data-testid="board-lock-badge"
            >
              {locked ? "Locked" : "Unlocked"}
            </span>
          </h1>
          <p className="home-dashboard__lock-hint muted" data-testid="board-lock-hint">
            {locked
              ? "This dashboard is locked. Unlock to add, move, or remove cards; the companion's changes wait in Decisions."
              : "This dashboard is unlocked. You and the companion change it in place."}
          </p>
        </div>
        <div className="home-dashboard__controls">
          {/* The pin board's own control, at the top of the page with the page's
              other controls. It is absent exactly when the row would be empty:
              a locked board is not editable here, and a board with everything
              pinned has nothing left to offer. */}
          {canAdd ? (
            <Button
              variant="outline"
              aria-expanded={addOpen}
              data-testid="board-add-toggle"
              onClick={() => setAddOpen((wasOpen) => !wasOpen)}
            >
              <PinIcon size={13} aria-hidden />
              {addOpen ? "Hide pin board" : "Pin board"}
            </Button>
          ) : null}
          <Button
            variant={locked ? "primary" : "outline"}
            onClick={() => void onToggleLock()}
            disabled={lockBusy}
            data-testid="board-lock-toggle"
          >
            {lockBusy ? "Saving…" : locked ? "Unlock" : "Lock"}
          </Button>
        </div>
      </header>

      {/* The pin board, above the board it adds to. */}
      {canAdd && addOpen ? (
        <section className="home-card home-pin-add" data-testid="board-add-pin">
          {/* One pin vocabulary: the row that puts a card on wears the same
              pin the chrome takes it off with. */}
          <h2 className="home-card__title">
            <PinIcon size={12} aria-hidden />
            Add pin
          </h2>
          <div className="home-pin-add__row">
          {availableKinds.map((kind) => (
            <button
              key={kind}
              className="home-pin-add__btn"
              onClick={() => onAddSystemPin(kind)}
              disabled={boardBusy}
            >
              {kind}
            </button>
          ))}
          {addablePages.map((entry) => (
            <button
              key={`${entry.domainSlug}:${entry.page.id}`}
              className="home-pin-add__btn"
              onClick={() => onAddPagePin(entry)}
              disabled={boardBusy}
            >
              {entry.page.title}
            </button>
          ))}
          {addableViews.map((view) => (
            <button
              key={`view:${boardSlug}:${view.id}`}
              className="home-pin-add__btn home-pin-add__btn--view"
              onClick={() => onAddViewPin(view)}
              disabled={boardBusy}
              title="Pin this saved view to the dashboard"
            >
              {view.title}
            </button>
          ))}
          </div>
        </section>
      ) : null}

      <div
        className={arrange.isArranging ? "home-dashboard__grid is-arranging" : "home-dashboard__grid"}
        ref={arrange.gridRef}
        {...arrange.gridHandlers}
      >
        {arrange.order.map((pin) => (
          <div
            key={pin.id}
            data-pin-id={pin.id}
            /*
              The card is its own arrange handle.

              The grip that used to sit in the chrome is gone: holding a card
              already picks it up, so a second control for the same gesture was
              chrome for chrome's sake — and a small one the operator had to find
              before the board would move. What the grip alone could do is keep
              the gesture reachable without a pointer, and that is what this
              `tabIndex` carries: an unlocked card is a tab stop, Enter lifts it,
              the arrows place it, and Enter drops it. A locked card is not a tab
              stop, because there is nothing to be done to it.
            */
            tabIndex={locked ? undefined : 0}
            aria-describedby={locked ? undefined : "pin-arrange-hint"}
            className={[
              "home-pin",
              /*
                The operator's own width choice, carried as a class because it is
                the sheet's business rather than the hook's: `home-pin--span2` is
                painted `1 / -1` — the whole row — and it is also what tells
                `useTileSpans` to leave this card's width alone. A card stored one
                cell wide is measured and sized from what it holds; a card stored
                two cells wide is drawn exactly as wide as the operator asked.
              */
              pin.kind === "view" && pin.span === 2 ? "home-pin--span2" : "",
              arrange.isLifted(pin.id) ? "is-lifted" : "",
              livePinId === pin.id ? "is-live" : "",
              chatHolds(pin.id) ? "is-in-context" : "",
              resize.resizingPinId === pin.id ? "is-resizing" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {/*
              The card's own controls, in one row in the corner.

              The chat control is NOT part of `.home-pin__chrome`: that is the
              board-editing chrome, and the lock takes it away. Asking the
              companion about a card is not changing it, so the chat control
              survives the lock — which is exactly why it is a sibling of the
              chrome rather than a button inside it.

              It stays a toggle on a locked board too: taking a card back out of
              the chat is not an edit of the board either. `aria-pressed` carries
              the state, and the card's ring draws it.
            */}
            <div className="home-pin__tools">
              <button
                type="button"
                className="home-pin__btn home-pin__chat"
                data-testid="pin-chat"
                aria-pressed={chatHolds(pin.id)}
                aria-label={chatHolds(pin.id) ? CHAT_TAKE_OFF : CHAT_ASK}
                title={chatHolds(pin.id) ? CHAT_TAKE_OFF : CHAT_ASK}
                onClick={(e) => onChatAbout(pin, e.currentTarget)}
              >
                <MessageSquare size={14} aria-hidden />
              </button>
              {locked ? null : (
                <PinChrome
                  pin={pin}
                  busy={boardBusy}
                  menuOpen={menuPinId === pin.id}
                  onToggleMenu={() =>
                    setMenuPinId((openId) => (openId === pin.id ? null : pin.id))
                  }
                  onArchive={() => void onArchive(pin.id)}
                  onDelete={
                    // A built-in card is app furniture, not a record: there is
                    // nothing behind it to delete, so the menu does not offer it.
                    pin.kind === "system"
                      ? undefined
                      : (control) => onDeleteRequest(pin, control)
                  }
                  onCycleSpan={() => void onCycleSpan(pin.id)}
                />
              )}
            </div>
            {renderPin(pin)}
            {/*
              The operator's own hand on the width, on the card's right edge.

              A VIEW pin only, and only on an unlocked board: the width lives on
              the pin, so a locked board — which files every change as a Decision
              instead of making it — has no business offering a drag that writes
              straight through. (The chrome's width button is gone there too, for
              the same reason.)

              It is a `separator` rather than a button, because that is what a
              resizable edge is: a value between a minimum and a maximum, which is
              what a screen reader reads out — and the arrows step it, one unit per
              press.

              It names the card it belongs to in its own attribute rather than in
              `data-pin-id`: every card lookup on this board — the drag geometry,
              the scroll hold, the arrange gesture — is a `[data-pin-id]` query, and
              a handle wearing that attribute would be read as a card.
            */}
            {!cardWidthHandle || locked || pin.kind !== "view" ? null : (
              <div
                className="home-pin__resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Width of ${viewTitleOf(pin)}`}
                tabIndex={0}
                title="Drag to set this card's width — the arrow keys step it"
                {...resize.handleProps(pin.id)}
              />
            )}
          </div>
        ))}

        <div className="home-pin">
          <ActiveAgentsCard />
        </div>
        </div>

        {showFinanceInstall ? (
        <section className="home-card home-rail__finance-cta">
          <h2 className="home-card__title">Finance</h2>
          <p className="home-card__empty">
            Install the kit into the Financial domain. It adds the ledger databases and starter pages.
          </p>
          <Button
            variant="primary"
            className="home-dashboard__submit"
            onClick={async () => {
              const res = await api().kitInstallFinance();
              if (res.ok) await load();
            }}
          >
            Install Finance kit
          </Button>
        </section>
        ) : null}

      {/* How a keyboard operator learns that the card they landed on can be
          moved at all. The grip used to say so by existing; with it gone, the
          card names its own keys. It is a description rather than a label,
          because a card's name is its own heading and a label here would
          replace it. */}
      {locked ? null : (
        <p className="visually-hidden" id="pin-arrange-hint">
          Press Enter to move this card: the arrow keys place it, Enter drops it, Escape cancels.
        </p>
      )}

      {/* Arranging is a gesture, so its outcome is not visible in the chrome the
          way a button's is: this line is how a keyboard or screen-reader
          operator learns that the card moved, that the order was saved, or that
          the vault refused it. Polite, not assertive — an arrangement is not an
          emergency, and the operator is mid-gesture. */}
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        data-testid="pin-arrange-status"
      >
        {arrange.announce}
      </p>

      {/* The same for a width: a drag has no button to come back to, and the
          handle's own value is only read when it has focus. */}
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        data-testid="pin-resize-status"
      >
        {resize.announce}
      </p>

      {/* The board's own yes/no question, drawn over the window it was asked
          from. Delete is the one thing here the vault cannot bring back, so it
          is the one thing that asks. */}
      {dialog}
    </div>
  );
}
