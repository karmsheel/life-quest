/**
 * E2E harness for the titlebar's day/night control and its quick menu (driven
 * by `theme-quick-menu.electron.mjs`).
 *
 * Everything here is shipping code: the real `WindowTitleBar`, the real
 * `ThemeQuickMenu`, the real `ThemeProvider` and the real CSS. The only stand-in
 * is the Electron preload, which does not exist on a dev-server page.
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The click stopped being a switch.** Clicking the icon must flip the
 *     palette now, not merely open a menu. A control that only opens a popover
 *     reads as broken to an operator who presses it the way the old toggle was
 *     pressed.
 *  2. **The menu never appears on hover.** The pointer arriving at the control
 *     is the gesture that opens the quick menu; it must open without a click,
 *     after a short rest rather than on the first stray crossing.
 *  3. **The menu cannot be reached by pointer.** A menu that closes as the hand
 *     travels from the control to the popover is worse than no menu: the gap has
 *     to be bridged by the close delay.
 *  4. **The menu lists the wrong palettes.** The mode switcher (System, Light,
 *     Dark) must come first and the starred themes underneath it; the starred
 *     grid is the favourites, not the whole registry.
 *  5. **The mode switcher and the click disagree.** Clicking toggles between the
 *     two explicit palettes; choosing System must clear the attribute and let the
 *     platform decide, and the hint must say which case is in front.
 *  6. **Picking a theme does nothing.** The tile's press must apply the skin and
 *     persist it, and the tile must report itself active afterwards.
 *  7. **The star is cosmetic.** The localStorage list the Appearance page writes
 *     must be the list the quick menu reads; an uncurated install opens on the
 *     full set and an empty curation shows the empty state.
 *  8. **The menu never dismisses.** A press outside it, Escape, and the pointer
 *     leaving both its parts must all close it.
 *  9. **A one-palette theme strands the switch.** The control must stay in the
 *     strip, and a day/night press must hand the window to the fallback theme
 *     (Nous) for the palette the worn theme cannot paint, rather than leaving a
 *     light palette at night.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider, useChatDock } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const VAULT_NAME = "Theme Quick Menu Vault";

const SNAPSHOT = {
  rootPath: "C:/theme-quick-menu-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "theme-quick-menu-vault",
    name: VAULT_NAME,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark" as const,
    weekStartDay: "monday" as const,
  },
  domains: [],
  agents: [],
  decisions: [],
  log: [],
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainSetActive: () => ok(null),
  // The shipped window: overlay caption buttons, so the titlebar draws its
  // trailing cluster and not the fallback window controls.
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

/**
 * The dock's "present" flag, which the real shell sets while `AppShell` is
 * mounted: without it the titlebar draws the empty strip and the day/night
 * control is not there to test.
 */
function PresentDock() {
  const { setPresent } = useChatDock();
  useEffect(() => {
    setPresent(true);
    return () => setPresent(false);
  }, [setPresent]);
  return null;
}

function RigPage() {
  return (
    <div className="rig-page" data-rig-page="theme">
      <h1>Theme quick menu</h1>
      <p>
        Harness page for the titlebar&apos;s day/night control. The quick menu is
        the shipping one; this page exists to give the pointer somewhere outside
        it to click.
      </p>
      <button
        type="button"
        className="rig-outside"
        data-rig-outside=""
        id="rig-outside"
      >
        Outside the menu
      </button>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from theme-quick-menu.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <PresentDock />
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <RigPage />
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The driver waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the titlebar never rendered". The settings
// gear stands in for the strip having painted in either theme: it is present
// even when a single-palette skin removes the day/night control.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const titlebar = document.querySelector(".window-titlebar");
  const settings = document.querySelector(".settings-menu__trigger");
  if (!titlebar || !settings) {
    requestAnimationFrame(waitForShell);
    return;
  }
  void Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForShell);

(window as unknown as { themeQuickMenuReady: Promise<void> }).themeQuickMenuReady =
  ready;

/** Paired with `themeQuickMenuReady`: the vault the titlebar is naming. */
(window as unknown as { themeQuickMenuVaultName: string }).themeQuickMenuVaultName =
  VAULT_NAME;
