/**
 * E2E harness for Automations and the Daily Note's "Analyze note" trigger.
 *
 * The real shell, the real rail, the real pages and the real stylesheet render
 * here; only the IPC bridge is stubbed, and it is a recording stub: an
 * unmodelled call is named in `automationUnexpectedCalls` so a page that grows a
 * dependency this rig does not model fails loudly.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The governed shelf is not at the foot of the rail, or the two dividers do
 *     not cordon it: Life-Chain, Decisions, Daily Note and Automations are not
 *     one group above the Log.
 *  2. Automations is not directly under Daily Note, or its route is not mounted.
 *  3. The Automations page lists no row, more than one row, or a row that does
 *     not name the Daily Note trigger and its own way back.
 *  4. The Daily Note draws no Analyze note control, or it is disabled while a
 *     note is on screen.
 *  5. Clicking it does not start a fresh chat: no session is created, the dock
 *     does not open on it, or the visible prompt is not the automation's prompt.
 *  6. The note is not fed whole: a note longer than the page-context budget must
 *     appear in `instructionsContext.automationContext` from its first word to
 *     its last, and the prompt must name tasks, goals and details.
 *  7. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *
 * The driver waits on `automationReady`, set after the rail and the Automations
 * page have painted, so it never samples a half-rendered page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type {
  DailyNote,
  DailyNoteIndexEntry,
  VaultSnapshot,
} from "@lifequest/vault-core";
import {
  DEFAULT_ANALYZE_AUTOMATION,
  type AutomationInput,
  type AutomationRecord,
} from "@lifequest/vault-core/pure";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import AutomationsPage from "@/pages/AutomationsPage";
import DailyNotePage from "@/pages/DailyNotePage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { AutomationScheduler } from "@/state/AutomationScheduler";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

type SessionCall = { id: string; title: string };
type ChatCall = {
  sessionId: string;
  input: string;
  instructionsContext: {
    pageContext?: { route: string; label: string; body: string } | null;
    automationContext?: string;
    aboutMe: string;
    [key: string]: unknown;
  };
};

type HarnessWindow = Window & {
  automationReady?: boolean;
  automationSkin?: string;
  automationRoute?: string;
  automationGoto?: (path: string) => void;
  automationToday?: string;
  automationNote?: string;
  automationJournal?: Map<string, DailyNote>;
  automationSessionCalls?: SessionCall[];
  automationChatCalls?: ChatCall[];
  automationUnexpectedCalls?: string[];
  /** What the page sent to the automation store. */
  automationCreateCalls?: AutomationInput[];
  automationUpdateCalls?: { id: string; input: AutomationInput }[];
  automationDeleteCalls?: string[];
  automationMarkCalls?: { id: string; patch: Record<string, unknown> }[];
  /** Add a scheduled record that is already due, then let the scheduler see it. */
  automationSeedScheduled?: () => void;
};

const harness = window as HarnessWindow;
harness.automationSessionCalls = [];
harness.automationChatCalls = [];
harness.automationUnexpectedCalls = [];
harness.automationCreateCalls = [];
harness.automationUpdateCalls = [];
harness.automationDeleteCalls = [];
harness.automationMarkCalls = [];

/** The shelf the bridge serves. The built-in is the one every vault starts with. */
let automations: AutomationRecord[] = [{ ...DEFAULT_ANALYZE_AUTOMATION }];
let automationCounter = 0;

harness.automationSeedScheduled = () => {
  const now = Date.now();
  const createdAt = new Date(now - 7 * 86_400_000).toISOString();
  automations = [
    ...automations,
    {
      ...DEFAULT_ANALYZE_AUTOMATION,
      id: "scheduled-sweep",
      name: "Scheduled sweep",
      description: "Reads today's note when the day starts.",
      prompt: "Sweep {{dateLabel}} and name the three things I should do next.",
      trigger: {
        type: "schedule",
        frequency: "daily",
        time: "00:01",
        weekday: null,
      },
      createdAt,
      updatedAt: createdAt,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSessionId: null,
      lastError: null,
    },
  ];
  window.dispatchEvent(new Event("lifequest:automations-changed"));
};

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The same normalization the vault applies: prose, then exactly one newline. */
function canonical(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

const today = localToday();

/**
 * One long day, deliberately past the page-context budget (4000 characters).
 * A note this size is the whole reason the automation exists: the page outline
 * would cut it, while the automation's own context must carry it entire.
 */
const NOTE_BODY = [
  "Friday: a long day, and a lot of it belongs somewhere else in LifeQuest.",
  "",
  "Morning: walked 5 km before the sun. Slept badly because the neighbour's dog kept me up, so I moved the long run to Sunday.",
  "",
  "Work: the Atlas migration is two days behind. Priya is blocked on the API schema and I promised her the shape by lunch. The client call at 15:00 is the one that decides whether we ship on the 30th.",
  "",
  "Home: Mom's birthday is on 4 November — book the table at the Italian place and find the photo from the coast trip. The kitchen tap still drips; call the plumber on Monday morning.",
  "",
  "Projects: Atlas should become a real project in the app, with the migration as its first task and the client launch as the deadline. The garden rebuild is waiting on the fence quote.",
  "",
  "Goals this quarter: finish the Atlas migration, run 20 km a week without missing a Sunday, and read four books. This month: get the API schema signed off. This week: send Priya the shape, book Mom's table, chase the fence quote.",
  "",
  "People: Priya is the backend lead and prefers written specs to calls. Sam is the client sponsor and wants a weekly status note on Fridays. The new neighbour, Ada, offered to water the plants when we travel.",
  "",
  "Open questions: do we need a second staging environment for the migration? Is the fence quote still valid after the storm? Should the garden project start before or after Atlas ships?",
  "",
  ...Array.from(
    { length: 55 },
    (_, i) =>
      `Context note ${i + 1}: this paragraph is here to make the day longer than the page outline can carry, so the automation can prove it fed the whole note rather than the truncated copy.`,
  ),
  "",
  "Last line: the tail of the note must reach the agent's context, or this automation only read the top of the day.",
].join("\n");

harness.automationToday = today;
harness.automationNote = NOTE_BODY;

const journal = new Map<string, DailyNote>();
harness.automationJournal = journal;

function seed(date: string, body: string): void {
  const stamp = new Date().toISOString();
  journal.set(date, {
    date,
    createdAt: stamp,
    updatedAt: stamp,
    bodyMarkdown: canonical(body),
  });
}

seed(today, NOTE_BODY);

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Automation Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
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

/** The sessions the dock lists; the automation creates its own. */
const sessions: Array<{
  id: string;
  title: string;
  preview: string | null;
  lastActive: number;
  pinned: boolean;
}> = [];

/**
 * What the gateway has stored per chat. The real companion writes the user's
 * turn before answering, and the dock can re-read a chat when it lands back on
 * it; a harness that always answered an empty transcript would wipe the prompt
 * bubble the moment the request cleared, which is not what the shipped app does.
 */
const storedMessages = new Map<
  string,
  { role: "user" | "assistant"; content: string; at?: number }[]
>();

let sessionCounter = 0;

/** Every bridge method the pages may reach. Anything else is named. */
const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },
  pinsList: () => ok({ pins: [], locked: false }),
  companionStatus: () => Promise.resolve({ kind: "ready" }),
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  automationList: () => ok(automations),
  automationCreate: (input: AutomationInput) => {
    harness.automationCreateCalls?.push(input);
    const now = new Date().toISOString();
    const record: AutomationRecord = {
      id: `automation-created-${++automationCounter}`,
      ...input,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSessionId: null,
      lastError: null,
    };
    automations = [...automations, record];
    return ok(automations);
  },
  automationUpdate: (id: string, input: AutomationInput) => {
    harness.automationUpdateCalls?.push({ id, input });
    automations = automations.map((record) =>
      record.id === id
        ? { ...record, ...input, updatedAt: new Date().toISOString() }
        : record,
    );
    return ok(automations);
  },
  automationDelete: (id: string) => {
    harness.automationDeleteCalls?.push(id);
    automations = automations.filter((record) => record.id !== id);
    return ok(automations);
  },
  automationMarkRun: (id: string, patch: Record<string, unknown>) => {
    harness.automationMarkCalls?.push({ id, patch });
    automations = automations.map((record) =>
      record.id === id
        ? {
            ...record,
            lastRunAt:
              typeof patch.at === "string" ? patch.at : new Date().toISOString(),
            lastRunStatus:
              (patch.status as AutomationRecord["lastRunStatus"]) ?? null,
            lastRunSessionId:
              typeof patch.sessionId === "string" ? patch.sessionId : null,
            lastError: typeof patch.error === "string" ? patch.error : null,
            updatedAt: new Date().toISOString(),
          }
        : record,
    );
    return ok(automations);
  },
  companionSessionsList: () => ok(sessions),
  companionSessionCreate: (title: string) => {
    sessionCounter += 1;
    const session = {
      id: `automation-session-${sessionCounter}`,
      title,
      preview: null,
      lastActive: Date.now() / 1000,
      pinned: false,
    };
    sessions.unshift(session);
    storedMessages.set(session.id, []);
    harness.automationSessionCalls?.push({ id: session.id, title });
    return ok(session);
  },
  companionSessionMessages: (id: string) =>
    ok(
      (storedMessages.get(id) ?? []).map((message) => ({
        role: message.role,
        content: message.content,
        at: message.at,
      })),
    ),
  onCompanionStream: () => () => {},
  // The rail reads the pending-Decision list on mount and on the vault's change
  // signal; the snapshot above carries none, so the live read answers the same.
  decisionList: () => Promise.resolve(ok([])),
  companionChatStream: (payload: ChatCall) => {
    harness.automationChatCalls?.push(payload);
    const messages = storedMessages.get(payload.sessionId) ?? [];
    messages.push({ role: "user", content: payload.input, at: Date.now() });
    storedMessages.set(payload.sessionId, messages);
    return Promise.resolve(ok(true));
  },
  dailyNoteGet: (date: string) => {
    const note = journal.get(date);
    return Promise.resolve(note ? ok(note) : fail("Daily note not found"));
  },
  dailyNoteWrite: (date: string, body: string) => {
    const canonicalBody = canonical(body);
    if (canonicalBody.trim() === "") {
      return Promise.resolve(fail("A daily note needs something written in it"));
    }
    const existing = journal.get(date);
    const stamp = new Date().toISOString();
    const note: DailyNote = {
      date,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
      bodyMarkdown: canonicalBody,
    };
    journal.set(date, note);
    return Promise.resolve(ok(note));
  },
  dailyNoteList: () => {
    const rows: DailyNoteIndexEntry[] = [...journal.values()]
      .map((note) => ({ date: note.date, updatedAt: note.updatedAt }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return Promise.resolve(ok(rows));
  },
  dailyNoteWindow: () => Promise.resolve(ok([])),
  reviewGet: () => Promise.resolve(fail("Review file not found")),
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.automationUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from automation.html");

function RouterControl() {
  const navigate = useNavigate();
  const location = useLocation();
  harness.automationGoto = (path: string) => navigate(path);
  harness.automationRoute = location.pathname;
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/automations"]}>
      <RouterControl />
      <ThemeProvider>
        <VaultProvider>
          <AutomationScheduler />
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/notes" element={<DailyNotePage />} />
                      <Route path="/automations" element={<AutomationsPage />} />
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

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForPage = () => {
  const rail = document.querySelector(".nav-rail");
  const row = document.querySelector('[data-testid="automation-daily-note-analyze"]');
  if (!rail || !row) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

harness.automationReady = false;
void ready.then(() => {
  harness.automationReady = true;
});
harness.automationSkin = skinName;
