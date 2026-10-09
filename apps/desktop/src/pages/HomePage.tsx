import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Pin as PinIcon } from "lucide-react";
import type { DecisionRecord, LifeEvent, PageListEntry, Pin } from "@lifequest/vault-core";
import { SYSTEM_PIN_KINDS, type SystemPinKind } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import { useVault } from "@/state/VaultProvider";
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
import { usePinArrange, type CommitOutcome } from "@/components/home/usePinArrange";
import { ViewCard } from "@/components/ui/ViewCard";
import type { SavedView } from "@lifequest/vault-core";

/**
 * A view plus the domain that owns it. `SavedView` is the file's contents and
 * carries no domain — the domain is which directory it was read from — and the
 * Overview board shows views from every domain, so the pair has to travel
 * together or a pin cannot be addressed.
 */
type BoardView = SavedView & { domainSlug: string };

export default function HomePage() {
  const { snapshot, reloadGeneration, refresh } = useVault();
  const { setContextCard, setOpen: setChatOpen } = useChatDock();
  const lens = useDomainLens();
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

  /** A page pin's card names the page the board lists. */
  const pageTitleOf = useCallback(
    (pin: Extract<Pin, { kind: "page" }>) =>
      pages.find((entry) => entry.domainSlug === pin.domainSlug && entry.page.id === pin.pageId)
        ?.page.title ?? pin.pageId,
    [pages],
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
  }, [load, reloadGeneration]);

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
   * Hand one card to the chat.
   *
   * The name travels with the pin, and it is read off the card the control sits
   * in rather than rebuilt from the pin: the heading is what the operator is
   * looking at, and the companion has to be told about the card in front of
   * them. The dock opens on the way — a card in context that the operator cannot
   * see the pill for is a click that appears to do nothing.
   */
  function onChatAbout(pin: Pin, control: HTMLElement) {
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
    // A view pin renders ViewCard, the design's single drawing path. Span 2
    // marks the wrapper so the grid gives the card the full row. A locked board
    // hands the card `editable: false`: the board's page lock governs the cards
    // on it, for the operator as much as for the companion.
    if (pin.kind === "view") {
      return (
        <div className={pin.span === 2 ? "view-card view-card--span2" : "view-card"}>
          <ViewCard domainSlug={pin.domainSlug} viewId={pin.viewId} editable={!locked} />
        </div>
      );
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
          <p className="home-dashboard__subtitle">
            Premise → Vision → Purpose → Strategy (How)
          </p>
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
            className={[
              "home-pin",
              pin.kind === "view" && pin.span === 2 ? "home-pin--span2" : "",
              arrange.isLifted(pin.id) ? "is-lifted" : "",
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
              chrome rather than the fourth button inside it.
            */}
            <div className="home-pin__tools">
              <button
                type="button"
                className="home-pin__btn home-pin__chat"
                data-testid="pin-chat"
                aria-label="Ask the companion about this card"
                title="Ask the companion about this card"
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

      {/* The board's own yes/no question, drawn over the window it was asked
          from. Delete is the one thing here the vault cannot bring back, so it
          is the one thing that asks. */}
      {dialog}
    </div>
  );
}
