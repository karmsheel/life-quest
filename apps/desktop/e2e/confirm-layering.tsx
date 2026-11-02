/**
 * E2E harness for the app's own confirmation on the swapped studio — the dock on
 * the leading side, the sheet pushed out to the window's trailing edge (driven by
 * `confirm-layering.electron.mjs`).
 *
 * This is a system-in-isolation rig, so the ways it can fail are written down
 * before the assertions:
 *
 *  1. **The dock paints over the question.** The scrim and the card are rendered
 *     inside the sidebar, which is a positioned, z-indexed column of the shell.
 *     That makes the sidebar their stacking context, so the dock — painted later
 *     at the same level — covers the half of the card that hangs over it. The rig
 *     asks the window what is actually at points inside the card, rather than
 *     trusting its paint order on paper.
 *  2. **The question is centred on its column, not the window.** A platform
 *     `window.confirm` centres on the display; a dialog trapped inside a pane
 *     centres on that pane. This one has to centre on the window the app runs in,
 *     whichever pane asked.
 *  3. **The scrim stops short of the window.** A scrim that lives inside a pane
 *     only covers that pane: the dock and the sheet stay lit and undimmed while a
 *     question is up, which reads as one surface asking while the rest keeps
 *     working.
 *  4. **The scrim whites out the page instead of blurring it.** The old fill was
 *     `--fg` at 35%: a paper-white veil at night, a grey wash by day. It has to
 *     be the settings sheet's glass — `--canvas-base` at 38% with a 7px blur —
 *     because that is the effect the operator asked for.
 *  5. **The write runs before the question is answered**, or a cancelled answer
 *     still deletes. The ask has to guard the write, not decorate it.
 *
 * The IPC bridge is stubbed (there is no Electron preload on the dev-server
 * page): two live chats, and a delete that records its ids and drops the row.
 * Everything else — the real `AppShell`, the real `NavRail` and its `ChatsSidebar`,
 * the real `ChatPanel`, the real `ConfirmDialog`, the real CSS and the real layout
 * engine — is shipping code.
 *
 * The question's own scrim is compared against a hidden probe wearing the settings
 * sheet's class: the shipping `.sheet-overlay` rule is the reference the operator
 * named, so the assertion is "the two compute to the same glass", not a re-typed
 * blur string beside the CSS.
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
import { sessionsFromPayload } from "../electron/companion-client";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The vault the shell reads its name from. */
const VAULT_NAME = "Confirm Layering Vault";

const SNAPSHOT = {
  rootPath: "C:/confirm-layering-vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "confirm-layering-vault",
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

type SessionRow = {
  id: string;
  title: string | null;
  preview: string | null;
  last_active: number;
  started_at: number;
  message_count: number;
  pinned: number;
  archived: number;
  hidden: number;
};

/** Two live chats, so the row the question names is a choice. */
const rows: SessionRow[] = [
  {
    id: "confirm-alpha",
    title: "Alpha plan",
    preview: null,
    last_active: 1_700_000_000,
    started_at: 1_699_000_000,
    message_count: 3,
    pinned: 0,
    archived: 0,
    hidden: 0,
  },
  {
    id: "confirm-beta",
    title: "Beta review",
    preview: null,
    last_active: 1_690_000_000,
    started_at: 1_689_000_000,
    message_count: 1,
    pinned: 0,
    archived: 0,
    hidden: 0,
  },
];

type HarnessWindow = {
  confirmLayeringReady?: Promise<void>;
  /** Ids the dock's delete wrote, in order. */
  confirmDeleteCalls?: string[];
  /** The row labels in list order, so the driver names the row it clicks. */
  confirmHarnessRows?: { id: string; label: string }[];
  confirmHarnessVaultName?: string;
};

const harness = window as unknown as HarnessWindow;
harness.confirmDeleteCalls = [];
harness.confirmHarnessRows = rows.map((row) => ({
  id: row.id,
  label: (row.title ?? "").trim() || (row.preview ?? "").trim(),
}));

/**
 * Nothing here stubs `window.confirm`: the dock's destructive writes ask through
 * its own `ConfirmDialog`, so the question is real DOM the driver clicks. A
 * platform dialog would centre on the display and could not be clicked at all.
 */
window.confirm = () => {
  throw new Error("the dock asks through ConfirmDialog, never window.confirm");
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  companionSessionsList: () => ok(sessionsFromPayload({ data: rows })),
  companionSessionMessages: () =>
    ok([{ role: "assistant" as const, content: "Confirm layering harness turn" }]),
  companionSessionCreate: () => {
    const created = { ...rows[0]!, id: "confirm-created", title: "New chat" };
    rows.unshift(created);
    return ok(created);
  },
  companionSessionPatch: () => ok({}),
  companionSessionDelete: (id: string) => {
    harness.confirmDeleteCalls = [...(harness.confirmDeleteCalls ?? []), id];
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      return Promise.resolve({ ok: false as const, error: `no such session ${id}` });
    }
    rows.splice(index, 1);
    return ok({ id, deleted: true });
  },
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar draws
  // the trailing cluster the side switch lives in.
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

// A previous run's "last chat" would decide the landing view; clear it so the
// harness always starts from the same place.
window.localStorage.removeItem("lifequest.companion.lastSessionId");

/*
 * The reference glass: the settings sheet's own class, off screen and out of the
 * layout. Its computed `backdrop-filter` and fill are what the question's scrim
 * is compared against, so the rig measures the shipping rule instead of a second
 * copy of the numbers.
 */
const glassProbe = document.createElement("div");
glassProbe.className = "sheet-overlay";
glassProbe.setAttribute("data-rig-glass-probe", "");
glassProbe.setAttribute("aria-hidden", "true");
glassProbe.style.display = "none";
document.body.appendChild(glassProbe);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from confirm-layering.html");

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
                            {/* A page for the sheet to paint, so its box is the
                                pane's box and not an empty one. */}
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
// transform cannot be mistaken for "the sidebar never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const chat = document.querySelector(".chat-panel");
  const main = document.querySelector(".shell__main");
  const row = document.querySelector(".chats-rail__row");
  const sideSwitch = document.querySelector(".window-titlebar__side-switch");
  if (!chat || !main || !row || !sideSwitch) {
    requestAnimationFrame(waitForShell);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForShell);

harness.confirmLayeringReady = ready;
harness.confirmHarnessVaultName = VAULT_NAME;
