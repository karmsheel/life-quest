import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DecisionRecord, LifeEvent, PageListEntry, Pin } from "@lifequest/vault-core";
import { SYSTEM_PIN_KINDS, type SystemPinKind } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { GoalProgressCard } from "@/pages/home-pins/GoalProgressCard";
import { DeadlineBanner } from "@/pages/home-pins/DeadlineBanner";
import { DoctrineProgressCard } from "@/pages/home-pins/DoctrineProgressCard";
import { PendingDecisionsCard } from "@/pages/home-pins/PendingDecisionsCard";
import { TodayWeekCard } from "@/pages/home-pins/TodayWeekCard";
import { RecentLogCard } from "@/pages/home-pins/RecentLogCard";
import { ActiveAgentsCard } from "@/pages/home-pins/ActiveAgentsCard";

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
  const [moveBusy, setMoveBusy] = useState(false);

  const load = useCallback(async () => {
    const boardSlug = lens.kind === "domain" ? lens.slug : null;
    try {
      const [decResult, logResult, pinsRes, pagesRes] = await Promise.all([
        api().decisionList(),
        api().logList(),
        api().pinsList(boardSlug),
        api().pageList(boardSlug),
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
    } catch {
      setDecisions([]);
      setEvents([]);
      setPins([]);
      setPages([]);
    }
  }, [lens]);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration]);

  const boardSlug = lens.kind === "domain" ? lens.slug : null;

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
        .map((p) => `${p.domainSlug}:${p.pageId}`),
    );
    return pages.filter((e) => !onBoard.has(`${e.domainSlug}:${e.page.id}`));
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

  return (
    <div className="home-dashboard">
      <header className="home-dashboard__header">
        <div>
          <p className="home-dashboard__eyebrow muted">Dashboard</p>
          <h1 className="home-dashboard__title">
            {title}
            <span className="home-dashboard__subtitle muted">
              {" "}
              Premise → Vision → Purpose → Strategy (How)
            </span>
          </h1>
        </div>
      </header>

      <div className="home-dashboard__grid">
        {pins.map((pin, index) => (
          <div key={pin.id} className="home-pin">
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
            </div>
            {renderPin(pin)}
          </div>
        ))}

        <div className="home-pin">
          <ActiveAgentsCard />
        </div>
      </div>

      {availableKinds.length > 0 || addablePages.length > 0 ? (
        <div className="home-pin-add">
          <span className="muted">Add pin:</span>
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
        </div>
      ) : null}
    </div>
  );
}
