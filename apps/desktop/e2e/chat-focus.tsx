/**
 * E2E harness for the full-screen chat mode (driven by
 * `chat-focus.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. **No doors.** The dock's top row carries no full-screen control, or the
 *     window strip carries no main-page control, so the operator has no way in.
 *  2. **A door in the wrong place.** The dock control is not the trailing item
 *     of the top row after the new-chat plus, or the titlebar control does not
 *     sit immediately before the theme control — a control that merely exists
 *     is not a control an operator finds.
 *  3. **A dead click.** Pressing either door changes nothing on screen.
 *  4. **The main pane is still painted.** The shell class flips but the page is
 *     still there, behind the chat, at its old width.
 *  5. **The dock stops short.** It does not reach the rail's trailing edge, the
 *     window's trailing edge, or the window's bottom: a mode called full-screen
 *     that leaves a gutter, a strip of page, or a band of mat on screen.
 *  6. **The divider is still drawn.** The seam's handle has nothing to divide
 *     in the mode and must be gone; a drag target over nothing is a trap.
 *  7. **The rail leaves.** The rail is the window's chrome, not a pane of the
 *     tray: it holds the window's leading edge in the mode.
 *  8. **The dock's own content is stretched edge to edge.** The transcript and
 *     the composer band have to keep a readable measure — `max-width: 56rem`,
 *     centred — while the tab strip, header and bottom bar stay full width.
 *  9. **The way out is not exact.** Closing the mode has to put the shell, the
 *     page and the dock back on the very boxes the run started from.
 * 10. **Collapsing the dock while in the mode leaves the mode stuck.** The
 *     collapse is the dock's own door: `setOpen(false)` has to clear the mode
 *     and give the page and the launcher back.
 * 11. **Entering from a collapsed dock does not reopen it.** The mode with no
 *     dock on screen is a blank page: `setFocus(true)` implies `open`.
 * 12. **The rail-collapsed arrangement breaks.** With the rail at its icon
 *     column the dock starts at 56px — the rail's own track — not at zero.
 * 13. **The dock-side-left arrangement breaks.** The mode ignores the side: the
 *     dock is immediately right of the rail, reaches the window's trailing edge
 *     and draws no divider, with the page gone.
 * 14. **The shortcut is only cosmetic.** `Ctrl+Shift+F` does not toggle the
 *     mode through the shipped keyboard runner.
 * 15. **Bridge stubs masking real calls.** Anything the shell reaches for that
 *     is not named here must not throw.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page); everything else — the real `WindowTitleBar`, the real `AppShell`, the
 * real `ChatPanel`, the real providers, the real CSS and the real layout engine
 * — is shipping code.
 *
 * The dock seeds one **pinned** stub chat. A pinned chat is a tab on every
 * launch, so the strip is drawn without opening anything and the dock's
 * top-row control has a row to live in. The shortcut table is read off clean
 * localStorage: a binding left behind by a neighbouring rig would decide which
 * key the mode answers to.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { ShortcutsProvider } from "@/state/ShortcutsProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

/*
 * The palette this rig measures: Forge in its night palette. Rigs share the
 * dev-server origin's localStorage, so a skin left by a concurrent rig would
 * otherwise decide the colours. Painting the shipped default here, and writing
 * the preference key `ThemeProvider` reads, makes the run self-contained.
 */
applyAppSkin("dark", "forge");
try {
  localStorage.setItem("lifequest-theme", "dark");
  // The mode's key is a movement in the shipped shortcut table. A binding
  // recorded by another rig (`Ctrl+Shift+F` rebound or cleared) would decide
  // whether the mode answers to the key this rig presses, so the table starts
  // from its defaults.
  localStorage.removeItem("lifequest-keyboard-shortcuts");
} catch {
  /* ignore */
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The vault name the titlebar chip wears — the driver reads it off the page
 *  rather than hard-coding the same string twice. */
const VAULT_NAME = "Chat Focus Vault";

const SNAPSHOT = {
  rootPath: "C:/chat-focus-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "chat-focus-vault",
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

/**
 * One pinned chat: a pin is durable Hermes state, so the dock draws its square
 * on launch even though this run opened nothing. That is what puts the tab
 * strip — and the top-row control inside it — on screen.
 */
const SESSION = {
  id: "chat-focus-session",
  title: "Focus session",
  preview: "Full-screen chat harness",
  lastActive: 1_700_000_000,
  pinned: true,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "assistant" as const, content: "Full-screen chat harness turn" }]),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (the main-page control, theme and settings) and not the
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

interface HarnessWindow extends Window {
  lifequest: unknown;
  chatFocusHarnessReady: Promise<void>;
  chatFocusHarnessVaultName: string;
  chatFocusHarnessRoute: string;
  chatFocusHarnessKeys: {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    trusted: boolean;
  }[];
}

const harnessWindow = window as unknown as HarnessWindow;
harnessWindow.lifequest = stubbed;

/*
 * Every keydown the page sees, in the window's capture phase.
 *
 * The shortcut assertion is not "the mode toggled after a key was sent": it is
 * "the browser's input pipeline delivered a trusted Ctrl+Shift+F keydown to the
 * window". A synthetic `KeyboardEvent` would log `trusted: false` here, and a
 * keydown eaten by a drag region or a different target would not be logged with
 * both modifiers.
 */
harnessWindow.chatFocusHarnessRoute = "/home";
harnessWindow.chatFocusHarnessKeys = [];
window.addEventListener(
  "keydown",
  (event) => {
    harnessWindow.chatFocusHarnessKeys.push({
      key: event.key,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
      trusted: event.isTrusted,
    });
  },
  true,
);

/** The route the shell is painting, sampled rather than assumed. */
function RouteTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    harnessWindow.chatFocusHarnessRoute = pathname;
  }, [pathname]);
  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-focus.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <RouteTracker />
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <ShortcutsProvider>
                <div className="app-root">
                  <WindowTitleBar />
                  <div className="app-root__body">
                    <Routes>
                      <Route element={<AppShell />}>
                        <Route
                          path="/home"
                          element={
                            <div className="stub-page">
                              {/* Something for the sheet to paint, so its box
                                  is the pane's box rather than an empty one. */}
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
              </ShortcutsProvider>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform — or a pinned-session read still in flight — cannot be mistaken for
// "the control never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const shell = document.querySelector(".shell");
  const chat = document.querySelector(".chat-panel");
  const tabs = document.querySelector(".chat-panel__tabs");
  const dockControl = document.querySelector('[data-testid="chat-fullscreen"]');
  const titleControl = document.querySelector(
    '[data-testid="titlebar-main-page"]',
  );
  if (!shell || !chat || !tabs || !dockControl || !titleControl) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

harnessWindow.chatFocusHarnessReady = ready;
harnessWindow.chatFocusHarnessVaultName = VAULT_NAME;
