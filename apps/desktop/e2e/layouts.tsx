/**
 * E2E harness for the layouts picker and the four arrangements it writes
 * (driven by `layouts.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. **No door.** The window strip's trailing cluster carries no layouts
 *     control, so the operator has no way to change the shape of the window.
 *  2. **A door in the wrong place.** The control is not the leading item of the
 *     strip's cluster (layouts, then day/night, then gear), or it is not the
 *     same 2.75rem button as the pair beside it, so it reads as a stray mark
 *     rather than part of the window's chrome.
 *  3. **A dead or sticky click.** The popover never opens; or the second press,
 *     an outside press, or Escape does not close it; or the trigger's
 *     `aria-expanded` stops following it. Escape has to hand focus back to the
 *     trigger, or the keyboard operator lands on the body.
 *  4. **A card is missing, mislabelled, or more than one card is active.** The
 *     popover has to hold exactly four `menuitemradio` cards — Studio, Page ·
 *     Agent, Agent · Page, Full agent — with exactly one `aria-checked` and
 *     `is-active`, and each has to draw its own three-pane thumbnail (the rail
 *     always, the page hidden in Full agent).
 *  5. **The popover is not a portal.** Drawn inside the strip or the shell it
 *     would be clipped by the tray it opens over.
 *  6. **The even split is not even.** A split that skips the rail, leaves a
 *     gutter at the window's trailing glass, or gives one pane more than half
 *     of the frame beside the rail is not the arrangement the card promises.
 *  7. **The divider survives the split.** The preset is fixed, so the seam's
 *     drag handle has nothing to drag and must be gone.
 *  8. **Page · Agent and Agent · Page are the same arrangement.** The two cards
 *     have to put the page and the agent on opposite sides of the seam, and the
 *     boxes and screenshots have to differ.
 *  9. **Full agent is a second mode.** The Full agent card has to write the
 *     dock's own full-screen state — same shell class, same boxes — not a
 *     lookalike beside it; and the dock's own full-screen control and
 *     Mod+Shift+F have to leave the picker reading `agent`.
 * 10. **The picker keeps its own copy of the arrangement.** A swap, a collapse,
 *     a round trip to Studio and the dock's own doors have to move the active
 *     card with them, because the card is derived from the dock, not stored
 *     beside it. A split with the dock collapsed leaves no split at all.
 * 11. **The split breaks with the rail collapsed.** With the rail at its icon
 *     column the split is the frame that remains (from 56px to the glass), and
 *     still even.
 * 12. **The Studio round trip is not exact.** Closing a layout has to put the
 *     shell, the page and the dock back on the very boxes the run started from,
 *     with the divider and the active card back on Studio.
 * 13. **Bridge stubs masking real calls.** Anything the shell reaches for that
 *     is not named here must not throw — the generic proxy's fallback must stay
 *     safe for every channel it does not name.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page); everything else — the real `WindowTitleBar`, the real `LayoutsMenu`,
 * the real `AppShell`, the real `ChatPanel`, the real providers, the real CSS
 * and the real layout engine — is shipping code.
 *
 * The dock seeds one **pinned** stub chat. A pinned chat is a tab on every
 * launch, so the strip is drawn without opening anything and the dock has a
 * real chat to lay out. The theme and the shortcut table are read off clean
 * localStorage: a skin or a rebinding left behind by a neighbouring rig would
 * decide the colours and whether Mod+Shift+F still toggles full-screen chat.
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
 * the preference keys `ThemeProvider` reads, makes the run self-contained.
 */
applyAppSkin("dark", "forge");
try {
  localStorage.setItem("lifequest-theme", "dark");
  // Mod+Shift+F is a movement in the shipped shortcut table. A binding
  // recorded by another rig (`Ctrl+Shift+F` rebound or cleared) would decide
  // whether the dock's full-screen mode answers to the key this rig presses, so
  // the table starts from its defaults.
  localStorage.removeItem("lifequest-keyboard-shortcuts");
} catch {
  /* ignore */
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The vault name the titlebar chip wears — the driver reads it off the page
 *  rather than hard-coding the same string twice. */
const VAULT_NAME = "Layouts Vault";

const SNAPSHOT = {
  rootPath: "C:/layouts-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "layouts-vault",
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
 * strip — and the dock's own bottom action bar — on screen, so the split has
 * real dock content to measure.
 */
const SESSION = {
  id: "layouts-session",
  title: "Layouts session",
  preview: "Layouts harness",
  lastActive: 1_700_000_000,
  pinned: true,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  // ThemeProvider reads the profile's theme files at mount and subscribes for
  // writes from the companion. The generic `ok(null)` fallback below is wrong
  // for all three: `themesList` is iterated, and `onThemesChanged` hands back an
  // unsubscribe the effect calls on cleanup — a Promise there throws in the
  // StrictMode cleanup and React unmounts the page, leaving the driver waiting
  // on a ready flag that never comes.
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  onThemesChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "assistant" as const, content: "Layouts harness turn" }]),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (layouts, day/night, gear) and not the fallback window
  // controls.
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
    // Every `on*` channel is a subscription: main answers with an unsubscribe
    // function and the caller runs it from an effect cleanup. A Promise here
    // throws on cleanup and takes the tree with it.
    if (typeof prop === "string" && prop.startsWith("on")) return () => () => {};
    return () => ok(null);
  },
  has: () => true,
});

interface HarnessWindow extends Window {
  lifequest: unknown;
  __layoutsHarnessReady: Promise<void>;
  __layoutsHarnessVaultName: string;
  __layoutsHarnessRoute: string;
  __layoutsHarnessKeys: {
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
 * The shortcut assertion is not "the layout changed after a key was sent": it is
 * "the browser's input pipeline delivered a trusted Ctrl+Shift+F keydown to the
 * window". A synthetic `KeyboardEvent` would log `trusted: false` here, and a
 * keydown eaten by a drag region or a different target would not be logged with
 * both modifiers. The rig also presses Escape to close the popover, so the log
 * is filtered to the Mod+Shift+F presses by the driver rather than assumed to
 * hold only those.
 */
harnessWindow.__layoutsHarnessRoute = "/home";
harnessWindow.__layoutsHarnessKeys = [];
window.addEventListener(
  "keydown",
  (event) => {
    harnessWindow.__layoutsHarnessKeys.push({
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
    harnessWindow.__layoutsHarnessRoute = pathname;
  }, [pathname]);
  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from layouts.html");

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
// "the layouts control never rendered". The trigger is deliberately NOT part of
// the wait: a missing layouts door must fail the run's assertions with a report,
// not hang it on a ready flag that can never resolve.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const shell = document.querySelector(".shell");
  const strip = document.querySelector(".window-titlebar__trailing");
  const chat = document.querySelector(".chat-panel");
  if (!shell || !strip || !chat) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

harnessWindow.__layoutsHarnessReady = ready;
harnessWindow.__layoutsHarnessVaultName = VAULT_NAME;
