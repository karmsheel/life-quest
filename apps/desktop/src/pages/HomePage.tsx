import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DecisionRecord, LifeEvent, PageListEntry, Pin } from "@lifequest/vault-core";
import { SYSTEM_PIN_KINDS, type SystemPinKind } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui/Button";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { GoalProgressCard } from "@/pages/home-pins/GoalProgressCard";
import { DeadlineBanner } from "@/pages/home-pins/DeadlineBanner";
import { DoctrineProgressCard } from "@/pages/home-pins/DoctrineProgressCard";
import { PendingDecisionsCard } from "@/pages/home-pins/PendingDecisionsCard";
import { TodayWeekCard } from "@/pages/home-pins/TodayWeekCard";
import { RecentLogCard } from "@/pages/home-pins/RecentLogCard";
import { ActiveAgentsCard } from "@/pages/home-pins/ActiveAgentsCard";
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
  const { snapshot, reloadGeneration } = useVault();
  const lens = useDomainLens();

  const title =
    lens.kind === "domain"
      ? (snapshot?.domains.find((d) => d.slug === lens.slug)?.meta.name ?? "Overview")
      : "Overview";

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
  const [pages, setPages] = useState<PageListEntry[]>([]);
  const [views, setViews] = useState<BoardView[]>([]);
  const [moveBusy, setMoveBusy] = useState(false);
  const [installedKits, setInstalledKits] = useState<string[] | null>(null);

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
    if (!target || target.kind !== "view" || moveBusy) return;
    const next = pins.map((p) =>
      p.id === pinId && p.kind === "view"
        ? ({ ...p, span: p.span === 2 ? 1 : 2 } as Pin)
        : p,
    );
    await persistPins(next);
  }

  async function persistPins(next: Pin[]) {
    // The locked board has no chrome to click, but a keyboard path or a stale
    // render could still reach here: refuse locally rather than filing a
    // Decision the operator did not ask for by clicking.
    if (locked) return;
    setMoveBusy(true);
    try {
      const res = await api().pinsSet(boardSlug, next);
      if (res.ok && res.value.applied) setPins(res.value.pins);
    } finally {
      setMoveBusy(false);
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

  async function onUnpin(pinId: string) {
    await persistPins(pins.filter((p) => p.id !== pinId));
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

  async function onMoveUp(index: number) {
    if (index === 0 || moveBusy) return;
    const next = [...pins];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    await persistPins(next);
  }

  async function onMoveDown(index: number) {
    if (index === pins.length - 1 || moveBusy) return;
    const next = [...pins];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    await persistPins(next);
  }

  const pageTitle = (pin: Extract<Pin, { kind: "page" }>) => {
    const entry = pages.find(
      (e) => e.domainSlug === pin.domainSlug && e.page.id === pin.pageId,
    );
    return entry?.page.title ?? pin.pageId;
  };

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
        <h2 className="home-card__title">{pageTitle(pin)}</h2>
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
        <div className="home-dashboard__lock">
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

      <div className="home-dashboard__grid">
        {pins.map((pin, index) => (
          <div
            key={pin.id}
            className={
              pin.kind === "view" && pin.span === 2 ? "home-pin home-pin--span2" : "home-pin"
            }
          >
            {locked ? null : (
              <div className="home-pin__chrome">
                <button
                  className="home-pin__btn"
                  onClick={() => onUnpin(pin.id)}
                  disabled={moveBusy}
                  title="Unpin"
                >
                  ✕
                </button>
                <button
                  className="home-pin__btn"
                  onClick={() => onMoveUp(index)}
                  disabled={moveBusy || index === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="home-pin__btn"
                  onClick={() => onMoveDown(index)}
                  disabled={moveBusy || index === pins.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                {pin.kind === "view" ? (
                  <button
                    className="home-pin__btn"
                    onClick={() => onCycleSpan(pin.id)}
                    disabled={moveBusy}
                    title={pin.span === 2 ? "Shrink to one cell" : "Widen to full row"}
                  >
                    {pin.span === 2 ? "◧" : "♭"}
                  </button>
                ) : null}
              </div>
            )}
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

      {/* A locked board has no Add-pin row at all: the board is read-only, and
          an "Add pin" that silently filed a Decision would be a second, hidden
          way to propose what the Lock button already says is not editable. */}
      {!locked &&
      (availableKinds.length > 0 || addablePages.length > 0 || addableViews.length > 0) ? (
        <section className="home-card home-pin-add" data-testid="board-add-pin">
          <h2 className="home-card__title">Add pin</h2>
          <div className="home-pin-add__row">
          {availableKinds.map((kind) => (
            <button
              key={kind}
              className="home-pin-add__btn"
              onClick={() => onAddSystemPin(kind)}
              disabled={moveBusy}
            >
              {kind}
            </button>
          ))}
          {addablePages.map((entry) => (
            <button
              key={`${entry.domainSlug}:${entry.page.id}`}
              className="home-pin-add__btn"
              onClick={() => onAddPagePin(entry)}
              disabled={moveBusy}
            >
              {entry.page.title}
            </button>
          ))}
          {addableViews.map((view) => (
            <button
              key={`view:${boardSlug}:${view.id}`}
              className="home-pin-add__btn home-pin-add__btn--view"
              onClick={() => onAddViewPin(view)}
              disabled={moveBusy}
              title="Pin this saved view to the dashboard"
            >
              {view.title}
            </button>
          ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
