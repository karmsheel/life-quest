/**
 * E2E harness page for the live dashboard: the REAL `ViewCard` and the REAL
 * `LiveDataProvider`, over the REAL IPC bridge, in a REAL window.
 *
 * This page stubs NOTHING. Every other view-card rig feeds `ViewCard` a fixture
 * registry, which is the right instrument for "does the card draw a table" — and
 * the wrong one for the question this rig asks, which is "does a card that is
 * already on screen re-run by itself when the vault changes". A stub cannot
 * answer that: the stub IS the answer. So the page is loaded in a window created
 * with the product's own preload, pointing at the product's own main process,
 * with a throwaway vault behind it.
 *
 * What the page therefore proves, together with the rig:
 *
 *  1. A write made through the app's own agent door — a real MCP `tools/call`
 *     over loopback, the same HTTP path Hermes takes — reaches this card.
 *  2. The card re-runs because it was TOLD to, not because anything re-rendered
 *     its parent: the rig sends no input, navigates nowhere, and reloads nothing
 *     (`liveDashboardLoads` counts module evaluations and must stay at 1).
 *  3. A card whose window is live and a card whose date is written into a filter
 *     behave differently, which is the whole point of the fix: the first moves
 *     with the day, the second cannot move at all.
 *
 * The only thing this page owns is which cards to draw and a pair of counters a
 * driver can wait on, in the shape the other rigs here use.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import { ViewCard } from "@/components/ui/ViewCard";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

type CardSpec = {
  /** Names the card in the DOM, so a driver can sample one of several. */
  key: string;
  domainSlug: string;
  viewId: string;
  title: string;
};

type HarnessWindow = Window & {
  liveDashboardReady?: boolean;
  /** Bumped from an effect, so a driver waits on a commit and not on a frame. */
  liveDashboardCommits?: number;
  /**
   * Every DOM mutation under the cards since the page mounted.
   *
   * This is the instrument for the claim the rig actually makes. A driver cannot
   * ask "did the card re-run?" directly — the card's re-run is an IPC call, and
   * the bridge is the product's, not ours to wrap. What it CAN ask is whether the
   * picture changed after the write, which is the same fact one layer up and the
   * one the operator cares about: the table on their screen grew a row.
   */
  liveDashboardMutations?: number;
  /** Module evaluations. 1 always: a reload would show up here as 2. */
  liveDashboardLoads?: number;
  liveDashboardRender?: (cards: CardSpec[]) => boolean;
  liveDashboardCards?: CardSpec[];
};

const harness = window as HarnessWindow;

// A reload re-runs this module, and this counter is how the rig refuses to be
// fooled by a card that "updated" because the whole page was thrown away.
harness.liveDashboardLoads = (harness.liveDashboardLoads ?? 0) + 1;
harness.liveDashboardCards = [];

// The app's own skin: a harness on base tokens would paint a palette the
// operator never runs, and the card's numbers are what this rig judges.
applyAppSkin("dark");

const WRAP: CSSProperties = {
  padding: 16,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(20rem, 1fr))",
  gap: "0.85rem",
  alignItems: "start",
};

function Harness() {
  const [cards, setCards] = useState<CardSpec[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  // One observer over the whole grid, installed on mount and before any card is
  // asked for: a card's own repaint is what it counts.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new MutationObserver((records) => {
      harness.liveDashboardMutations = (harness.liveDashboardMutations ?? 0) + records.length;
    });
    observer.observe(grid, { childList: true, subtree: true, characterData: true });
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => {
    harness.liveDashboardRender = (next) => {
      harness.liveDashboardCards = next;
      setCards(next);
      return true;
    };
    harness.liveDashboardReady = true;
    return () => {
      harness.liveDashboardReady = false;
    };
  }, []);

  useEffect(() => {
    harness.liveDashboardCommits = (harness.liveDashboardCommits ?? 0) + 1;
  });

  return (
    <LiveDataProvider>
      <div style={WRAP} ref={gridRef}>
        {cards.map((card) => (
          <div key={card.key} data-testid={card.key} data-card-title={card.title}>
            <ViewCard domainSlug={card.domainSlug} viewId={card.viewId} />
          </div>
        ))}
      </div>
    </LiveDataProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
