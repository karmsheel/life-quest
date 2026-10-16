/**
 * E2E harness page for the claim that is the operator's own report:
 *
 *   "I edited a card on the dashboard. After the change, the card moved to the
 *    bottom of the dashboard — though it told me it had stayed in place. I want
 *    the card to not leave the dashboard and the elements to change within it."
 *
 * This renders the REAL `pages/HomePage` — the real pin board, the real grid, the
 * real `ViewCard`, the real `LiveDataProvider` — over the REAL IPC bridge, to the
 * REAL main process, over a throwaway vault. Nothing here is stubbed. Every other
 * dashboard rig in this directory feeds `HomePage` a stub bridge, and a stub is
 * the one instrument that cannot answer this question: the fault being measured
 * is a WRITE, and a rig that writes its own pins list is asserting its own idea of
 * where the card goes.
 *
 * So this page owns almost nothing. It mounts the board, opens the vault through
 * the app's own `openRecent`, and publishes two hooks a driver needs — the board
 * itself is measured from the DOM by the rig, because the board is what the
 * operator complained about.
 *
 * The window is a fixed-height column that scrolls, exactly as `AppShell` gives
 * the page. That is the instrument: a board that fits on screen has no place to
 * lose, and "the card went to the bottom" is only a different place on a board
 * that is taller than the glass.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import HomePage from "@/pages/HomePage";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type HarnessWindow = Window & {
  dashboardCardSlotReady?: boolean;
  dashboardCardSlotSkin?: string;
  /** Module evaluations. 1 always: a reload would show up here as 2. */
  dashboardCardSlotLoads?: number;
  /** Commits under the providers, so a driver can wait on a commit not a frame. */
  dashboardCardSlotCommits?: number;
  /** Open the throwaway vault through the app's own recent-vault path. */
  dashboardCardSlotOpenVault?: (path: string) => Promise<boolean>;
  /** Re-read the vault snapshot, for a driver that wrote behind the page's back. */
  dashboardCardSlotRefresh?: () => Promise<boolean>;
};

const harness = window as HarnessWindow;

// A reload re-runs this module, and this counter is how the rig refuses to be
// fooled by a board that "held still" because the whole page was thrown away.
harness.dashboardCardSlotLoads = (harness.dashboardCardSlotLoads ?? 0) + 1;

/**
 * The vault, handed to the driver.
 *
 * `openRecent` is the app's own path for "open this vault directory" — the one
 * the vault switcher uses — rather than a rig-only channel the product does not
 * have. It is published from inside the provider because that is where the
 * context lives, and it is the only thing this page adds to the product.
 */
function VaultHandle() {
  const { openRecent, refresh } = useVault();
  useEffect(() => {
    harness.dashboardCardSlotOpenVault = (path) => openRecent(path);
    harness.dashboardCardSlotRefresh = () => refresh().then(() => true);
    return () => {
      harness.dashboardCardSlotOpenVault = undefined;
      harness.dashboardCardSlotRefresh = undefined;
    };
  }, [openRecent, refresh]);
  return null;
}

function Harness() {
  useEffect(() => {
    harness.dashboardCardSlotReady = true;
    return () => {
      harness.dashboardCardSlotReady = false;
    };
  }, []);

  useEffect(() => {
    harness.dashboardCardSlotCommits = (harness.dashboardCardSlotCommits ?? 0) + 1;
  });

  /**
   * The app's own frame for the page: `AppShell` gives the routed page a
   * `.shell__content` that is the thing that scrolls. `board-hold.ts` and
   * `usePinArrange` both resolve the scrollport by walking up from the grid, so
   * the board has to sit inside a real one — a harness that let the window scroll
   * instead would leave the hold correcting an element that cannot move.
   */
  return (
    <div
      className="shell__content"
      style={{ height: "100%", width: 1100, margin: "0 auto", overflowY: "auto" }}
    >
      <MemoryRouter initialEntries={["/home"]}>
        <VaultProvider>
          <LiveDataProvider>
            <ChatDockProvider>
              <VaultHandle />
              <HomePage />
            </ChatDockProvider>
          </LiveDataProvider>
        </VaultProvider>
      </MemoryRouter>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

harness.dashboardCardSlotSkin = skinName;
