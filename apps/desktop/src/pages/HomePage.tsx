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
      setPins(pinsRes.ok ? (pinsRes.value as Pin[]) : []);
      setPages(pagesRes.ok ? (pagesRes.value as PageListEntry[]) : []);
      setViews(viewsRes);
      const kitRes = await api().kitList("financial");
      setInstalledKits(kitRes.ok ? (kitRes.value as string[]) : []);
    } catch {
      setDecisions([]);
      setEvents([]);
      setPins([]);
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
    setMoveBusy(true);
    try {
      const res = await api().pinsSet(boardSlug, next);
      if (res.ok) setPins(next);
    } finally {
      setMoveBusy(false);
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
    // marks the wrapper so the grid gives the card the full row.
    if (pin.kind === "view") {
      return (
        <div className={pin.span === 2 ? "view-card view-card--span2" : "view-card"}>
          <ViewCard domainSlug={pin.domainSlug} viewId={pin.viewId} />
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
          <h1 className="home-dashboard__title">{title}</h1>
          <p className="home-dashboard__subtitle">
            Premise → Vision → Purpose → Strategy (How)
          </p>
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

      {availableKinds.length > 0 || addablePages.length > 0 || addableViews.length > 0 ? (
        <section className="home-card home-pin-add">
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
