/**
 * E2E harness for the switch-position control and the two arrangements it trades
 * between (driven by `chat-side.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. No control — the titlebar's trailing cluster carries no switch, so the
 *     operator has nothing to click.
 *  2. Control in the wrong place — the switch is not beside the settings it was
 *     asked to sit by (or it lands outside the trailing cluster entirely).
 *  3. Dead click — the panes do not move when the switch is clicked.
 *  4. Only the dock moves — the sheet keeps the middle track, so the two panes
 *     overlap, or a column of mat opens between them.
 *  5. The rail moves too — the rail is the window's chrome, not a pane of the
 *     tray: it holds the window's leading edge in both arrangements.
 *  6. The sheet stops short of the window — with the dock out of the trailing
 *     column nothing holds the sheet's right edge, so it has to carry the pane
 *     gap itself and land on the window's own trailing edge.
 *  7. The dock overruns its column — the swapped dock must ask for its track and
 *     no more; a dock still carrying the frame's slack runs over the sheet.
 *  8. The seam is lost or doubled — exactly one hairline may run between the two
 *     panes, on the sheet's edge facing the dock. Two lines, or none.
 *  9. A notch on the window's edge — the sheet's radius must stay on its leading
 *     top corner; a radius on the trailing one would cut a hole into the pane
 *     gap at the window's edge.
 * 10. One-way door — the control does not come back, or a second click does not
 *     land on the geometry the first one started from.
 * 11. Icons that do not follow the side — the collapse and expand arrows must
 *     point into the pane they open, on whichever side the dock is standing.
 * 12. The collapsed dock breaks the swap — a collapsed dock still has to sit in
 *     the column its side asks for, with the sheet flush to the window.
 * 13. The swap fights the collapsed rail — with no rail the dock takes the
 *     window's leading edge and the sheet still reaches the trailing one.
 * 14. The collapsed mark stays on the trailing corner — swapping the dock's side
 *     (even while it is collapsed, where the mark is the only control on screen)
 *     or collapsing the rail has to carry the floating launcher with it, or it
 *     points at a corner the dock no longer holds.
 * 15. Bridge stubs masking real calls — anything the shell reaches for that is
 *     not named here must not throw.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page); everything else — the real `WindowTitleBar`, the real `AppShell`, the
 * real `ChatPanel`, the real CSS and the real layout engine — is shipping code.
 *
 * The side is session state on the dock provider (like the rail's own collapse),
 * so this page reloads into the shipped arrangement every time: the rig never has
 * to clean up a stored preference, and it never touches one.
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

/** The vault name the titlebar chip wears — the driver reads it off the page
 *  rather than hard-coding the same string twice. */
const VAULT_NAME = "Chat Side Vault";

const SNAPSHOT = {
  rootPath: "C:/chat-side-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "chat-side-vault",
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
  id: "chat-side-session",
  title: "Chat side",
  preview: "Chat side harness",
  lastActive: 1_700_000_000,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "assistant" as const, content: "Chat side harness turn" }]),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (theme, settings, switch, collapse) and not the
  // fallback window controls.
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
if (!root) throw new Error("#root missing from chat-side.html");

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
                        element={
                          <div className="stub-page">
                            {/* Something for the sheet to paint, so its box is
                                the pane's box rather than an empty one. */}
                            {Array.from({ length: 30 }, (_, i) => (
                              <p key={i} className="muted">
                                Sheet filler line {i + 1}
                              </p>
                            ))}
                          </div>
                        }
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
// transform cannot be mistaken for "the switch never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const chat = document.querySelector(".chat-panel");
  const main = document.querySelector(".shell__main");
  const sideSwitch = document.querySelector(".window-titlebar__side-switch");
  if (!chat || !main || !sideSwitch) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

(window as unknown as { chatSideHarnessReady: Promise<void> }).chatSideHarnessReady =
  ready;

// Paired with `chatSideHarnessReady`: the assertions about the vault chip need
// the name the harness actually handed the shell.
(window as unknown as { chatSideHarnessVaultName: string }).chatSideHarnessVaultName =
  VAULT_NAME;
