/**
 * E2E harness for the left sidebar's docked layout (driven by
 * `shell-sidebar.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. Rail still framed — any top/left/bottom inset where the change asks for a
 *     panel flush with the window (the bug this rig was built for).
 *  2. Rail stops at the tray instead of the window — top edge level with the
 *     workspace sheet rather than with the window's own top.
 *  3. Rail painted *under* the titlebar — the rail's box overlaps the titlebar
 *     row, but the titlebar wins paint order, so the rail's topband and its one
 *     control are covered by the titlebar's background.
 *  4. Topband shows more than the collapse toggle (or nothing) — a second
 *     control crept into the header, or the toggle never rendered.
 *  5. Dead toggle — clicking it leaves the rail on screen.
 *  6. One-way door — collapsed with no control left anywhere to reopen.
 *  7. Column not returned — collapsing leaves the 4.25rem track (and its gap)
 *     behind, so the workspace sheet never reclaims the width.
 *  8. Titlebar text still in the rail's corner — the LQ badge and title not
 *     stepping aside by the track width, so they sit on top of the sidebar.
 *  9. Rail scrolls its own topband away, or spills past the window box.
 * 10. Bridge stubs masking real calls — anything the shell reaches for that is
 *     not named here must not throw.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page); everything else — the real AppShell, the real NavRail, the real
 * WindowTitleBar, the real CSS and the real layout engine — is shipping code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The vault name the titlebar chip must wear — the driver reads it off the page
 *  rather than hard-coding the same string twice. */
const VAULT_NAME = "Harness Vault";

const SNAPSHOT = {
  rootPath: "C:/harness-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "harness-vault",
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

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Shell sidebar harness",
  lastActive: 1_700_000_000,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "user" as const, content: "Shell sidebar harness" }]),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (theme, settings, chat) and not the fallback controls.
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

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from shell-sidebar.html");

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
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route
                        path="/home"
                        element={<div className="stub-page" />}
                      />
                    </Route>
                  </Routes>
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the rail never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const rail = document.querySelector(".nav-rail");
  const titlebar = document.querySelector(".window-titlebar");
  if (!rail || !titlebar) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

(window as unknown as { shellHarnessReady: Promise<void> }).shellHarnessReady =
  ready;

// Paired with `shellHarnessReady`: the assertions about the vault chip need the
// name the harness actually handed the shell.
(
  window as unknown as { shellHarnessVaultName: string }
).shellHarnessVaultName = VAULT_NAME;
