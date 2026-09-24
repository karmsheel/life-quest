import { useCallback, useEffect, useMemo, useState } from "react";
import type { DecisionRecord, LifeEvent, Pin } from "@lifequest/vault-core";
import { DOCUMENT_KIND_LABELS, SYSTEM_PIN_KINDS } from "@lifequest/vault-core";
import type { SystemPinKind } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { GoalProgressCard } from "@/pages/home-pins/GoalProgressCard";
import { DeadlineBanner } from "@/pages/home-pins/DeadlineBanner";
import { DoctrineCard } from "@/pages/home-pins/DoctrineCard";
import { DoctrineProgressCard } from "@/pages/home-pins/DoctrineProgressCard";
import { PendingDecisionsCard } from "@/pages/home-pins/PendingDecisionsCard";
import { TodayWeekCard } from "@/pages/home-pins/TodayWeekCard";
import { RecentLogCard } from "@/pages/home-pins/RecentLogCard";
import { ActiveAgentsCard } from "@/pages/home-pins/ActiveAgentsCard";

function localIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function HomePage() {
  const { snapshot, reloadGeneration, refresh } = useVault();
  const lens = useDomainLens();

  const title = lens.kind === "domain" ? (snapshot?.domains.find((d) => d.slug === lens.slug)?.meta.name ?? "Overview") : "Overview";

  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinError, setPinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [decResult, logResult, pinsRes] = await Promise.all([
        api().decisionList(),
        api().logList(),
        api().pinsList(lens.kind === "domain" ? lens.slug : null),
      ]);
      const allDecisions = decResult.ok ? decResult.value : [];
      const allEvents = logResult.ok ? logResult.value : [];

      setDecisions(
        allDecisions
          .filter((d) => d.status === "pending")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );

      setEvents(
        allEvents
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 5),
      );

      if (pinsRes.ok) {
        setPins(pinsRes.value as Pin[]);
        setPinError(null);
      } else {
        setPins([]);
        setPinError(pinsRes.error);
      }
    } catch {
      setDecisions([]);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [lens]);

  useEffect(() => {
    void load();
  }, [load, reloadGeneration]);

  const domainSlug = lens.kind === "domain" ? lens.slug : null;
  const [moveBusy, setMoveBusy] = useState(false);

  function systemPinKindsOnBoard(): Set<SystemPinKind> {
    return new Set(
      pins.filter((p) => p.kind === "system").map((p) => (p as { system: SystemPinKind }).system),
    );
  }

  function availableSystemKinds(): SystemPinKind[] {
    const onBoard = systemPinKindsOnBoard();
    return SYSTEM_PIN_KINDS.filter((k) => !onBoard.has(k));
  }

  function availablePagePins(): Array<{ domainSlug: string; pageId: string; title: string }> {
    const onBoardPageIds = new Set(
      pins
        .filter((p) => p.kind === "page")
        .map((p) => `${(p as { domainSlug: string }).domainSlug}:${(p as { pageId: string }).pageId}`),
    );
    // We don't have page titles in pins, so we show pages from the domain lens or all live domains
    // This is a simplified view — in practice you'd want to resolve titles
    return [];
  }

  async function onUnpin(pinId: string) {
    setMoveBusy(true);
    try {
      const remaining = pins.filter((p) => p.id !== pinId);
      const res = await api().pinsSet(domainSlug, remaining);
      if (res.ok) {
        setPins(remaining);
      }
    } finally {
      setMoveBusy(false);
    }
  }

  async function onAddSystemPin(kind: SystemPinKind) {
    setMoveBusy(true);
    try {
      const newPin: Pin = { id: `sys:${kind}`, kind: "system", system: kind };
      const updated = [...pins, newPin];
      const res = await api().pinsSet(domainSlug, updated);
      if (res.ok) {
        setPins(updated);
      }
    } finally {
      setMoveBusy(false);
    }
  }

  async function onAddPagePin(domainSlug: string, pageId: string) {
    setMoveBusy(true);
    try {
      const newPin: Pin = { id: `page:${domainSlug}:${pageId}`, kind: "page", domainSlug, pageId };
      const updated = [...pins, newPin];
      const res = await api().pinsSet(domainSlug, updated);
      if (res.ok) {
        setPins(updated);
      }
    } finally {
      setMoveBusy(false);
    }
  }

  async function onMoveUp(index: number) {
    if (index === 0 || moveBusy) return;
    setMoveBusy(true);
    try {
      const next = [...pins];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      const res = await api().pinsSet(domainSlug, next);
      if (res.ok) setPins(next);
    } finally {
      setMoveBusy(false);
    }
  }

  async function onMoveDown(index: number) {
    if (index === pins.length - 1 || moveBusy) return;
    setMoveBusy(true);
    try {
      const next = [...pins];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      const res = await api().pinsSet(domainSlug, next);
      if (res.ok) setPins(next);
    } finally {
      setMoveBusy(false);
    }
  }

  const renderPin = (pin: Pin, index: number) => {
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
    // Page pin — link to the page
    return (
      <section key={pin.id} className="home-card">
        <h2 className="home-card__title">Page</h2>
        <p className="muted">
          Page in {pin.domainSlug}: {pin.pageId}
        </p>
        <a href={`#/pages/${pin.domainSlug}/${pin.pageId}`}>Open page</a>
      </section>
    );
  };

  const availableKinds = availableSystemKinds();
  const pagePins = availablePagePins();

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
            {renderPin(pin, index)}
          </div>
        ))}

        {/* Always-on: Active agents card */}
        <div className="home-pin">
          <div className="home-pin__chrome">
            <span className="home-pin__btn home-pin__btn--static" title="Always on">●</span>
          </div>
          <ActiveAgentsCard />
        </div>
      </div>

      {/* Pin chrome: add system pins */}
      {availableKinds.length > 0 ? (
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
        </div>
      ) : null}
    </div>
  );
}
