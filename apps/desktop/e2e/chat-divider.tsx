/**
 * E2E harness for the divider between the page and the dock (driven by
 * `chat-divider.electron.mjs`).
 *
 * The rig is the REAL shell: the real `AppShell`, the real `ChatPanel`, the real
 * `useChatColumn`, the real stylesheet and the real layout engine, in a real
 * Electron window. The IPC bridge is stubbed, because a dev-server page has no
 * preload; everything the divider is made of is shipping code.
 *
 * The ways the feature under test can fail, written down before the assertions
 * (`e2e/chat-divider.electron.mjs` is where each one is checked):
 *
 *  1. No handle — the seam is not draggable at all.
 *  2. Handle off the seam — the strip the operator aims at is not the line the
 *     panes actually meet on.
 *  3. A dead drag — the pointer moves and the column does not.
 *  4. The seam lags or overshoots the pointer — the column is not 1:1 with the
 *     hand, so the divider feels like a slider with a rubber band.
 *  5. The wrong direction — dragging the seam towards the page widens the dock it
 *     was meant to narrow (or the arrangement's sign is hard-coded to one side).
 *  6. No floor — the dock can be dragged narrower than a dock, and no ceiling —
 *     it can be dragged over the page.
 *  7. The page is squeezed — the dock's ceiling is decided by a ratio alone, so a
 *     narrow window gives the page less room than it needs.
 *  8. The width is lost on the swap — moving the dock to the other side throws
 *     away a width the operator chose, or applies the other side's range.
 *  9. The width is lost on the collapse — the dock's own tab throws the width
 *     away, so reopening it starts from the token again.
 * 10. Commit drift — the number React holds and the column on screen disagree
 *     after the gesture, so the pane jumps on the next render.
 * 11. A cancelled gesture commits, or leaves the pane drawn at a width nobody
 *     chose.
 * 12. The keyboard is missing or moves the divider the wrong way, or pushes past
 *     the range the pointer is held to.
 * 13. A second line — the handle paints a border or a fill of its own, so the one
 *     hairline between the panes becomes two.
 * 14. The page or the dock spills sideways once the column is at either end.
 *
 * The width is session state on the dock provider, like the dock's side, so this
 * page reloads into the shipped arrangement every time: the rig never has to
 * clean up a stored preference, and it never touches one.
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

/** The vault name the titlebar chip wears — read off the page by the driver
 *  rather than hard-coded in two places. */
const VAULT_NAME = "Chat Divider Vault";

const SNAPSHOT = {
  rootPath: "C:/chat-divider-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "chat-divider-vault",
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
  id: "chat-divider-session",
  title: "Chat divider",
  preview: "Chat divider harness",
  lastActive: 1_700_000_000,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "assistant" as const, content: "Chat divider harness turn" }]),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (theme, settings, switch, collapse) and the driver can
  // reach the side switch and the collapse control.
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
if (!root) throw new Error("#root missing from chat-divider.html");

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
                            {/* Long enough to scroll, so the page's own scrollbar
                                is real and the handle has to leave it alone. */}
                            {Array.from({ length: 60 }, (_, i) => (
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
// transform cannot be mistaken for "the handle never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const chat = document.querySelector(".chat-panel");
  const main = document.querySelector(".shell__main");
  const divider = document.querySelector(".chat-divider");
  if (!chat || !main || !divider) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

(window as unknown as { chatDividerHarnessReady: Promise<void> }).chatDividerHarnessReady =
  ready;

// Paired with `chatDividerHarnessReady`: the assertions about the vault chip need
// the name the harness actually handed the shell.
(window as unknown as { chatDividerHarnessVaultName: string }).chatDividerHarnessVaultName =
  VAULT_NAME;
