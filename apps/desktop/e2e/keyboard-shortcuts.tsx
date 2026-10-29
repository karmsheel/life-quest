/**
 * E2E harness for the Keyboard shortcuts settings page and the global shortcut
 * runner (driven by `keyboard-shortcuts.electron.mjs`).
 *
 * This is a system-in-isolation rig: there is no Electron preload on the
 * dev-server page, so the IPC bridge is stubbed and everything else is shipping
 * code — the real `WindowTitleBar`, the real `AppShell` (and therefore the real
 * `ShortcutRunner`), the real `SettingsPage` sheet, the real `ShortcutsProvider`,
 * the real CSS.
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The page is not reachable from settings.** The Keyboard row is missing
 *     from the section list, or the search bar cannot find it by the words an
 *     operator would type.
 *  2. **The page is a mock.** The rows carry no keycaps, no groups, or fewer
 *     than the fourteen movements the action table declares.
 *  3. **A recorded key is only cosmetic.** The row says the new binding but the
 *     runner still moves on the old key — or the recorded key performs the
 *     movement while the sheet is still up.
 *  4. **A refusal is not a refusal.** A combination owned by another movement is
 *     accepted, the error does not name the other movement, the row stops
 *     recording, or the runner fires the conflicting movement anyway.
 *  5. **Reserved space is stealable.** Ctrl+W (or another app/OS key) becomes a
 *     movement.
 *  6. **Backspace is not a clear.** The row keeps its old binding, or storage
 *     does not record the deliberate `null`.
 *  7. **Reset is not a reset.** Per-row Reset leaves the override behind, or
 *     Restore all defaults does not empty the stored bindings.
 *  8. **Storage is session state.** A reload loses the custom binding, or the
 *     reloaded window stops moving on it.
 *  9. **The typing guard is inverted or absent.** A one-key binding fires while
 *     the operator is typing a character in a field (or fails to fire once the
 *     caret leaves it).
 * 10. **The shipped movements are gone.** The panel toggles, page steps, direct
 *     wing jump and settings-surface shortcut do not do what the table says.
 *
 * A recording row must keep the runner out of the way: the settings page is
 * presented over the page behind it, so every sample carries the shell's own
 * class list — a sidebar that collapsed during a refused conflict proves the
 * runner fired when it should not have.
 *
 * The harness is the page behind the sheet, not a page of its own: it mounts the
 * same `useSettingsBackground` + route shape `App.tsx` renders, and keeps the
 * `/home` stub (with `[data-rig-input]`) mounted under the sheet.
 */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { useSettingsBackground } from "@/components/settings/useSettingsBackground";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { ShortcutsProvider } from "@/state/ShortcutsProvider";
import { VaultProvider } from "@/state/VaultProvider";
import SettingsPage from "@/pages/SettingsPage";
import "@/styles/global.css";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const VAULT_NAME = "Keyboard Shortcuts Vault";

const SNAPSHOT = {
  rootPath: "C:/keyboard-shortcuts-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "keyboard-shortcuts-vault",
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
  id: "keyboard-shortcuts-session",
  title: "Shortcuts",
  preview: "Keyboard shortcuts harness",
  lastActive: 1_700_000_000,
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () =>
    ok([{ role: "assistant" as const, content: "Keyboard shortcuts harness turn" }]),
  onCompanionStream: () => () => {},
  // The shipped window: overlay caption buttons, so the titlebar shows its
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

/*
 * Dark, so the page the sheet is drawn over uses the palette the shipped app
 * defaults to. This rig never touches `lifequest-keyboard-shortcuts`: the driver
 * clears it before the first load, and the persistence step is what writes it.
 */
try {
  localStorage.setItem("lifequest-theme", "dark");
} catch {
  /* ignore */
}

/**
 * Every keydown the window sees, in order.
 *
 * The driver's assertions are about what a real keystroke does; this log is the
 * proof that the event came through Electron's input pipeline with the
 * modifiers the driver pressed, rather than from a synthetic DOM event the page
 * could not have told apart from a script.
 */
type KeyLogEntry = {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  target: string;
};

const keyLog: KeyLogEntry[] = [];
window.addEventListener(
  "keydown",
  (event) => {
    const target = event.target;
    const name =
      target instanceof HTMLElement
        ? target.id
          ? `#${target.id}`
          : target.tagName.toLowerCase()
        : "window";
    keyLog.push({
      key: event.key,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      target: name,
    });
    if (keyLog.length > 50) keyLog.shift();
  },
  true,
);
(window as unknown as { keyboardShortcutsKeyLog: KeyLogEntry[] }).keyboardShortcutsKeyLog =
  keyLog;

function RigPage({
  name,
  title,
  children,
}: {
  name: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rig-page" data-rig-page={name}>
      <h1>{title}</h1>
      <p>
        Harness page for <code>{name}</code>. The settings sheet is drawn over
        it, and the window's own shortcuts move between these pages.
      </p>
      {children}
    </div>
  );
}

function RigInput() {
  return (
    <label className="rig-field">
      Rig text field
      <input
        data-rig-input=""
        type="text"
        name="rig-input"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
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
       * The sheet pattern `App.tsx` renders: the routes resolve against the last
       * page that was not a sheet, so opening /settings keeps /home mounted and
       * the sheet is painted above it.
       */}
      <Routes location={background}>
        <Route element={<AppShell />}>
          <Route
            path="/home"
            element={
              <RigPage name="home" title="Dashboard">
                <RigInput />
              </RigPage>
            }
          />
          <Route path="/data" element={<RigPage name="data" title="Data" />} />
          <Route path="/pages" element={<RigPage name="pages" title="Pages" />} />
          <Route path="/dream" element={<RigPage name="dream" title="Dream" />} />
          <Route path="/goals" element={<RigPage name="goals" title="Goals" />} />
          <Route path="/daily" element={<RigPage name="daily" title="Daily Schedule" />} />
          <Route
            path="/review/daily"
            element={<RigPage name="review-daily" title="Daily review" />}
          />
          {/* Cold-start fallback, exactly as App.tsx nests it under the shell. */}
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      {sheetOverBackground ? <SettingsPage /> : null}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from keyboard-shortcuts.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <ShortcutsProvider>
                <div className="app-root">
                  <WindowTitleBar />
                  <div className="app-root__body">
                    <Harness />
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

// The driver waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the shell never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const shell = document.querySelector(".shell");
  const page = document.querySelector('[data-rig-page="home"]');
  const input = document.querySelector("[data-rig-input]");
  const wings = document.querySelector(".top-bar__wings");
  if (!shell || !page || !input || !wings) {
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

(window as unknown as { keyboardShortcutsReady: Promise<void> }).keyboardShortcutsReady =
  ready;

/** Paired with `keyboardShortcutsReady`: the name the titlebar chip wears. */
(window as unknown as { keyboardShortcutsVaultName: string }).keyboardShortcutsVaultName =
  VAULT_NAME;
