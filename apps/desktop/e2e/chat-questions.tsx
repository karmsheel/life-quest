/**
 * E2E harness for saved chat questions (driven by `chat-questions.electron.mjs`).
 *
 * This is a system-in-isolation rig: the real Settings page, the real ChatPanel,
 * the real CSS and the real layout engine run in an Electron window, while the
 * IPC bridge is stubbed. The ways it can fail are written down before the code:
 *
 *   1. **The section is not there.** Settings gains a nav row but no panel, or
 *      the panel is not the one the row opens.
 *   2. **A question cannot be saved.** The form does not call `settingsUpdate`,
 *      the patch is not the question that was typed, or the list never reflects
 *      the returned settings — so the operator writes into a void.
 *   3. **The scope is decoration.** The select exists but every question is
 *      stored as "everywhere", or the target is dropped from the saved patch.
 *   4. **The list is not editable.** Edit changes one thing on screen without
 *      writing it, or Delete removes a row locally while the stored list keeps it.
 *   5. **A new chat shows nothing.** The saved question never reaches the empty
 *      thread, or only reaches it after a reload.
 *   6. **The wrong questions are offered.** A Health prompt appears with the
 *      Financial lens, a Review prompt on the Dashboard, or a page prompt on
 *      another page. The rig checks both what appears and what does not.
 *   7. **Clicking is not sending.** The starter button focuses the composer or
 *      fills the draft instead of sending the question as the first turn, so
 *      the "one click" contract is not met.
 *   8. **The click sends something else.** The wire sees the typed prompt from
 *      another row, or a stale session id, or an empty input.
 *   9. **The prompt does not fit the window.** A long question widens the dock,
 *      clips the composer, or pushes the panel past the window edge.
 *  10. **The settings file is not the store.** The UI round-trips a stub but the
 *      vault's own `settings.json` cannot reopen what it wrote. The driver also
 *      runs the shipping create/update/open functions against a throwaway vault
 *      and records what came back.
 *
 * The driver reads only shipping UI (data-testid attributes are part of the
 * rendered surface) and writes its report to `e2e/artifacts/chat-questions.json`.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import SettingsPage from "@/pages/SettingsPage";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import type { ChatQuestion } from "@lifequest/vault-core/pure";
import "@/styles/global.css";

type HarnessWindow = Window & {
  __lqNavigate?: (path: string) => void;
  __lqSetDomain?: (slug: string | null) => void;
  __lqState?: () => unknown;
  __lqPatches?: unknown[];
  __lqStreamCalls?: unknown[];
  chatQuestionsHarnessReady?: Promise<void>;
};

const harness = window as unknown as HarnessWindow;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** Two live domains: the scopes the operator can choose between. */
const domains = [
  {
    slug: "financial",
    meta: {
      name: "Financial",
      description: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {},
  },
  {
    slug: "health",
    meta: {
      name: "Health",
      description: null,
      color: null,
      sortOrder: 1,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {},
  },
];

let activeDomain: string | null = "financial";
let settings: Record<string, unknown> = {
  hermesBaseUrl: "http://127.0.0.1:1",
  theme: "dark",
  weekStartDay: "monday",
  autoApproveInserts: [],
  chatQuestions: [] as ChatQuestion[],
};

const snapshot = {
  rootPath: "/harness/vault",
  lifequest: {
    schemaVersion: 1 as const,
    id: "harness-vault",
    name: "Questions Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings,
  domains,
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

type Session = {
  id: string;
  title: string;
  preview: string | null;
  lastActive: number;
  pinned: boolean;
};

const sessions: Session[] = [];
const messages: Record<string, { role: "user" | "assistant"; content: string; at?: number }[]> =
  {};
const patches: Record<string, unknown>[] = [];
const streamCalls: Record<string, unknown>[] = [];
let sessionCounter = 0;

harness.__lqPatches = patches;
harness.__lqStreamCalls = streamCalls;

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(snapshot),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainGetActive: () => Promise.resolve(activeDomain),
  domainSetActive: (slug: string | null) => {
    activeDomain = slug;
    return ok(null);
  },
  settingsUpdate: (patch: Record<string, unknown>) => {
    patches.push(JSON.parse(JSON.stringify(patch)));
    settings = { ...settings, ...patch };
    snapshot.settings = settings;
    return ok(settings);
  },
  companionSessionsList: () => ok(sessions.slice()),
  companionSessionCreate: (title: string) => {
    sessionCounter += 1;
    const row: Session = {
      id: `rig-session-${sessionCounter}`,
      title: title || "",
      preview: null,
      lastActive: Date.now() / 1000,
      pinned: false,
    };
    sessions.unshift(row);
    messages[row.id] = [];
    return ok({ ...row });
  },
  companionSessionMessages: (id: string) => ok(messages[id] ?? []),
  companionSessionPatch: (id: string, patch: Record<string, unknown>) => {
    const row = sessions.find((candidate) => candidate.id === id);
    if (!row) return Promise.resolve({ ok: false as const, error: "no such session" });
    Object.assign(row, patch);
    return ok({ ...row });
  },
  companionSessionDelete: (id: string) => {
    const index = sessions.findIndex((candidate) => candidate.id === id);
    if (index >= 0) sessions.splice(index, 1);
    delete messages[id];
    return ok({ id, deleted: true });
  },
  companionChatStream: (payload: Record<string, unknown>) => {
    streamCalls.push(JSON.parse(JSON.stringify(payload)));
    const id = String(payload.sessionId ?? "");
    const input = String(payload.input ?? "");
    messages[id] = [...(messages[id] ?? []), { role: "user", content: input, at: Date.now() }];
    // The gateway's list computes the row's preview from the first user message.
    // The stub has to do the same, or the next "New chat" would reuse this now
    // non-blank chat and the rig would test the wrong screen.
    const row = sessions.find((candidate) => candidate.id === id);
    if (row) {
      if (!row.preview?.trim()) row.preview = input;
      row.lastActive = Date.now() / 1000;
    }
    return ok(true);
  },
  onCompanionStream: () => () => {},
  signalChainList: () => ok({ records: [], skipped: 0 }),
  // The theme provider paints the window's titlebar through this bridge. A
  // dev-server page has no preload, so it has to be here or the provider throws
  // before any of the feature under test mounts.
  windowChrome: {
    get: () => Promise.resolve({ overlay: false, platform: "linux" }),
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
window.localStorage.removeItem("lifequest.companion.lastSessionId");

function Shell() {
  return (
    <div className="app-root">
      <div className="app-root__body">
        <div className="shell">
          <div className="nav-rail" />
          <div className="shell__main" />
          <ChatPanel open onOpenChange={() => {}} />
        </div>
      </div>
    </div>
  );
}

function Harness() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setActiveSlug } = useVault();

  useEffect(() => {
    harness.__lqNavigate = (path: string) => navigate(path);
    harness.__lqSetDomain = (slug: string | null) => {
      void setActiveSlug(slug);
    };
    harness.__lqState = () => ({
      route: location.pathname + location.search,
      activeDomain,
      settings,
    });
  }, [location.pathname, location.search, navigate, setActiveSlug]);

  useEffect(() => {
    document.body.dataset.rigRoute = `${location.pathname}${location.search}`;
  }, [location]);

  return (
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from chat-questions.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/settings?tab=questions"]}>
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <Harness />
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the questions page never painted".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForQuestions = () => {
  if (!document.querySelector('[data-settings-view="questions"]')) {
    requestAnimationFrame(waitForQuestions);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForQuestions);

harness.chatQuestionsHarnessReady = ready;
