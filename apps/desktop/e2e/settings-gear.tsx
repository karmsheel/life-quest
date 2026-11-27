/**
 * E2E harness for the titlebar's settings gear (driven by
 * `settings-gear.electron.mjs`).
 *
 * Everything here is shipping code: the real `WindowTitleBar`, the real
 * `SettingsMenu`, the real `SettingsPage`, the real `ThemeProvider` and the
 * real CSS. The only stand-in is the Electron preload, which does not exist on
 * a dev-server page.
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The gear opens a menu instead of the sheet.** The gear used to carry a
 *     quick popover — the colour-mode switcher and the starred themes. That
 *     menu now hangs off the day/night control, so a gear that still opens one
 *     offers the operator two ways into the same thing, and the popover's
 *     "All settings" footer is a dead end.
 *  2. **The gear does not navigate.** It has to be a real link, so the sheet
 *     opens over the page the operator was on and the route becomes
 *     `/settings`. A gear that only looks like a link (a button with an
 *     onClick) would open nothing at all.
 *  3. **The gear navigates somewhere else.** `/settings` and not `/settings?tab=…`
 *     or a page of its own: the sheet's own tab lives in the query string.
 *  4. **The sheet is not the full settings page.** The gear must open the whole
 *     sheet — every tab, the search field and all — not a slimmed-down popover.
 *  5. **The page behind the sheet is gone.** The settings sheet is a surface
 *     over the app: opening it must not unmount the page it was opened over,
 *     or the blurred backdrop blurs nothing and closing has nowhere to go back
 *     to.
 *  6. **The day/night control still owns the theme quick menu.** Moving the
 *     themes out of the gear must not take them out of the strip: hovering the
 *     day/night icon still opens the starred themes.
 *  7. **The gear is unlabelled.** It must still say what it is to a screen
 *     reader (*Open settings*) and to the pointer (*Settings*).
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { useSettingsBackground } from "@/components/settings/useSettingsBackground";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import SettingsPage from "@/pages/SettingsPage";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const VAULT_NAME = "Settings Gear Vault";

const SNAPSHOT = {
  rootPath: "C:/settings-gear-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "settings-gear-vault",
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
  onVaultDataChanged: () => () => {},
  onCompanionStream: () => () => {},
  onCompanionStatusChanged: () => () => {},
  onUpdateProgress: () => () => {},
  // The shell's chat sessions: an empty list, so the dock has nothing to
  // restore and nothing to ask the (absent) companion about.
  companionSessionsList: () => ok([]),
  companionEnsure: () => ok({ kind: "disconnected" }),
  companionProfilesList: () => ok({ profiles: [], active: null }),
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

try {
  localStorage.setItem("lifequest-theme", "dark");
} catch {
  /* ignore */
}

function RigPage() {
  return (
    <div className="rig-page" data-rig-page="home">
      <h1>The page behind the sheet</h1>
      <p>
        This page is what the scrim blurs. It stays mounted for as long as the
        settings sheet is open, and the sheet closes back onto it.
      </p>
    </div>
  );
}

function Harness() {
  const location = useLocation();
  const { background, sheetOverBackground } = useSettingsBackground();

  // The path a MemoryRouter never writes to the window; the driver reads it.
  useEffect(() => {
    document.body.dataset.rigPath = `${location.pathname}${location.search}`;
  }, [location]);

  return (
    <>
      {/*
        The sheet pattern `App.tsx` renders: the routes resolve against the last
        page that was not a sheet, so opening /settings keeps /home mounted and
        the sheet is painted above it.
      */}
      <Routes location={background}>
        <Route element={<AppShell />}>
          <Route path="/home" element={<RigPage />} />
          {/* Cold-start fallback, exactly as App.tsx nests it under the shell. */}
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      {sheetOverBackground ? <SettingsPage /> : null}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from settings-gear.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Harness />
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
// transform cannot be mistaken for "the titlebar never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const titlebar = document.querySelector(".window-titlebar");
  const gear = document.querySelector(".settings-menu__trigger");
  if (!titlebar || !gear) {
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

(window as unknown as { settingsGearReady: Promise<void> }).settingsGearReady = ready;

/** Paired with `settingsGearReady`: the vault the titlebar is naming. */
(window as unknown as { settingsGearVaultName: string }).settingsGearVaultName =
  VAULT_NAME;
