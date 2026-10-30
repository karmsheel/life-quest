/**
 * E2E harness page for Projects on the Execute wing (`pages/ProjectsPage`,
 * `pages/ProjectPage`) inside the real shell.
 *
 * The page under test is the real page, not a copy: `ProjectsPage` and
 * `ProjectPage` are mounted on their real routes under the real `AppShell` —
 * real `NavRail` with its wing switcher, real `TopBar`, real
 * `WingProvider`/`wingForPath`,
 * real CSS and real layout engine. The rail claim ("Projects is under Execute,
 * not Plan") is only meaningful in the shipped shell, so the harness renders the
 * shell the app renders.
 *
 * The vault behind it is a recording stub. Every write the page can make is
 * applied to the fixture and recorded (`window.projectsHarnessCalls`); a method
 * nothing models answers `ok(null)` and is named in
 * `window.projectsHarnessUnmodelled`. Nothing here writes a real vault.
 *
 * The fixture is deliberately uneven: four projects across the statuses (one
 * active with a two-entry timeline, one paused and unassigned, one closed, one
 * open), two linked tasks, two signals reached through those tasks, two
 * Decisions against the active project's id, and two life-log lines. A register
 * of identical rows would prove nothing about the row's own attributes, and a
 * detail page with no collated work would pass every "it rendered" check.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  DecisionRecord,
  DomainRecord,
  DocumentKind,
  Goal,
  LifeEvent,
  MapStoreState,
  Project,
  ProjectUpdate,
  SignalRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import ProjectPage from "@/pages/ProjectPage";
import ProjectsPage from "@/pages/ProjectsPage";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import "@/styles/global.css";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true as const, value });

const NOW = "2026-10-22T08:00:00.000Z";
const EARLIER = "2026-10-18T09:15:00.000Z";
const LATER = "2026-10-22T09:30:00.000Z";
const USER = { type: "user" as const };
const HERMES = { type: "agent" as const, id: "companion", name: "Hermes" };

// ── the fixture vault ────────────────────────────────────────────────────────

function doc(
  kind: DocumentKind,
  title: string,
  bodyMarkdown: string,
): DomainRecord["documents"][DocumentKind] {
  return { kind, title, locked: false, bodyMarkdown, updatedAt: NOW, mtimeMs: 0 };
}

const DOMAINS: DomainRecord[] = [
  {
    slug: "health",
    meta: {
      name: "Health",
      description: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: {
      premise: doc("premise", "Beliefs & Premise", "Slow is smooth; smooth is fast."),
      what: doc("what", "Vision & Desire", "A calm, strong body at 60."),
      why: doc("why", "Purpose", "Make the work that only I can make."),
      how: doc("how", "Strategy (How)", "Protect the mornings; batch the admin."),
    },
  },
  {
    slug: "financial",
    meta: {
      name: "Financial",
      description: null,
      color: null,
      sortOrder: 1,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: {
      premise: doc("premise", "Beliefs & Premise", "Spend on what compounds."),
      what: doc("what", "Vision & Desire", "Nine months of runway."),
      why: doc("why", "Purpose", "Buy back my own time."),
      how: doc("how", "Strategy (How)", "One spreadsheet, no surprises."),
    },
  },
];

const GOALS: Goal[] = [
  {
    id: "g-exec",
    name: "Ship a calmer operating system",
    notes: "",
    status: "open",
    domainSlug: "health",
    deadline: "2026-12-31",
    metric: null,
    target: null,
    definitionOfDone: null,
    current: null,
  },
  {
    id: "g-money",
    name: "Rebuild the runway",
    notes: "",
    status: "open",
    domainSlug: "financial",
    deadline: null,
    metric: "months",
    target: 9,
    definitionOfDone: null,
    current: 6,
  },
];

function update(
  id: string,
  at: string,
  note: string,
  progress: number | null,
  actorName: string | null,
): ProjectUpdate {
  return { id, at, note, progress, actorName };
}

const PROJECTS: Project[] = [
  {
    id: "p-exec",
    title: "Ship the Execute wing",
    summary: "Move Projects to Execute and make it agent-readable",
    stateNote: "Tools landed; the wing is in progress.",
    bodyMarkdown:
      "## Context\n\nThe project's own document. The companion reads it with `get_project`.",
    goalId: "g-exec",
    domainSlug: "health",
    status: "active",
    priority: "high",
    startDate: "2026-10-01",
    targetDate: "2026-12-31",
    progress: 60,
    nextAction: "Wire the rail and ship the rig",
    updates: [
      update("u-1", EARLIER, "Kickoff and the schema landed", 25, "Hermes"),
      update("u-2", NOW, "Companion tools landed", 60, "Hermes"),
    ],
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "p-paused",
    title: "Renew the studio lease",
    summary: "",
    stateNote: "Waiting on the landlord's counter-offer.",
    bodyMarkdown: "",
    goalId: null,
    domainSlug: null,
    status: "paused",
    priority: "normal",
    startDate: null,
    targetDate: null,
    progress: 20,
    nextAction: null,
    updates: [],
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "p-closed",
    title: "Retire the old CRM",
    summary: "",
    stateNote: "",
    bodyMarkdown: "",
    goalId: "g-money",
    domainSlug: "financial",
    status: "closed",
    priority: null,
    startDate: "2026-09-01",
    targetDate: null,
    progress: 100,
    nextAction: null,
    updates: [],
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "p-trip",
    title: "Plan the winter trip",
    summary: "",
    stateNote: "Shortlist three places by the end of the month.",
    bodyMarkdown: "",
    goalId: null,
    domainSlug: "health",
    status: "open",
    priority: "low",
    startDate: null,
    targetDate: "2027-01-15",
    progress: 0,
    nextAction: "Ask the others for dates",
    updates: [],
    createdAt: EARLIER,
    updatedAt: NOW,
  },
];

const SIGNALS: SignalRecord[] = [
  {
    id: "s-collate",
    createdAt: nowOffset(-2),
    updatedAt: nowOffset(-2),
    deletedAt: null,
    type: "idea",
    source: "manual",
    sourceRef: null,
    title: "Projects should collate",
    body: "A project page is where the work around it is read from.",
    domainSlug: "health",
  },
  {
    id: "s-rail",
    createdAt: nowOffset(-1),
    updatedAt: nowOffset(-1),
    deletedAt: null,
    type: "notice",
    source: "manual",
    sourceRef: null,
    title: null,
    body: "The rail reads Execute now.",
    domainSlug: null,
  },
];

function nowOffset(hours: number): string {
  return new Date(Date.parse(NOW) + hours * 60 * 60 * 1000).toISOString();
}

function decision(
  id: string,
  title: string,
  status: DecisionRecord["status"],
  targetId: string,
  rationale: string | null,
): DecisionRecord {
  return {
    id,
    target: { type: "project", id: targetId },
    domainSlugs: ["health"],
    status,
    title,
    rationale,
    proposedTitle: title,
    previousTitle: null,
    proposedBodyMarkdown: JSON.stringify({ type: "updateProject", id: targetId, patch: {} }),
    previousBodyMarkdown: null,
    actor: HERMES,
    createdAt: EARLIER,
    resolvedAt: status === "pending" ? null : NOW,
    reason: null,
  };
}

const DECISIONS: DecisionRecord[] = [
  decision("d-create", "Create project: Ship the Execute wing", "approved", "p-exec", null),
  decision("d-update", "Log 60% on Ship the Execute wing", "pending", "p-exec", "The tools landed."),
  // A Decision against another project must not be collated onto p-exec.
  decision("d-other", "Pause Renew the studio lease", "approved", "p-paused", null),
];

/** The tasks whose `links.projectId` is on the active project. */
function initialState(tasks: MapStoreState["tasks"]): MapStoreState {
  return {
    dayTypes: [],
    defaultWeek: {
      dayTypeByWeekday: [null, null, null, null, null, null, null],
      weeklyItems: [{ id: "w-review", text: "Weekly review" }],
    },
    years: [
      {
        year: 2026,
        status: "live",
        events: [],
        months: [],
        detachedWeeks: {},
      },
    ],
    tasks,
    liveDays: {},
    aboutMe: "",
  };
}

const TASKS: MapStoreState["tasks"] = [
  {
    id: "t-door",
    title: "Write the MCP door test",
    notes: "",
    column: "today",
    links: { projectId: "p-exec", signalId: "s-collate" },
  },
  {
    id: "t-rail",
    title: "Move Projects into the Execute rail",
    notes: "",
    column: "in-progress",
    links: { projectId: "p-exec", signalId: "s-rail" },
  },
  {
    id: "t-lease",
    title: "Chase the lease counter-offer",
    notes: "",
    column: "backlog",
    links: { projectId: "p-paused" },
  },
  {
    id: "t-unlinked",
    title: "Book the dentist",
    notes: "",
    column: "backlog",
    links: {},
  },
];

const LOG: LifeEvent[] = [
  {
    id: "e-created",
    domainSlug: "health",
    type: "project.created",
    summary: "Hermes created Ship the Execute wing",
    payload: { id: "p-exec", title: "Ship the Execute wing" },
    createdAt: EARLIER,
    actor: HERMES,
  },
  {
    id: "e-updated",
    domainSlug: "health",
    type: "project.updated",
    summary: "Hermes updated Ship the Execute wing",
    payload: { id: "p-exec", title: "Ship the Execute wing", status: "active" },
    createdAt: NOW,
    actor: HERMES,
  },
  {
    id: "e-other",
    domainSlug: null,
    type: "project.updated",
    summary: "Renew the studio lease was paused",
    payload: { id: "p-paused" },
    createdAt: NOW,
    actor: USER,
  },
];

/** Live state the bridge mutates, so a page write is observable on the next read. */
let projectsState: Project[] = structuredClone(PROJECTS);
let updateNumber = 100;

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:/projects-harness-vault",
  lifequest: {
    schemaVersion: 1,
    id: "projects-harness-vault",
    name: "Projects Harness",
    createdAt: NOW,
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
    chatQuestions: [],
  },
  domains: DOMAINS,
  agents: [],
  decisions: DECISIONS,
  log: LOG,
  map: initialState(TASKS),
  mapError: null,
  goals: GOALS,
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const SESSION = {
  id: "projects-harness-session",
  title: "Projects harness",
  preview: "Projects on the Execute wing",
  lastActive: 1_700_000_000,
};

// ── the recording bridge ─────────────────────────────────────────────────────

type Call = { method: string; args: unknown[] };

const calls: Call[] = [];
const unmodelled: string[] = [];

/**
 * Search args are JSON-cloned on the way into the transcript: some bridge
 * methods take callbacks (`onVaultDataChanged(fn)`), and a live function in the
 * transcript cannot cross `executeJavaScript` back to the driver.
 */
const jsonSafe = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return String(value);
  }
};

const record = (method: string, args: unknown[]): void => {
  calls.push({ method, args: args.map(jsonSafe) });
};

const clone = <T,>(value: T): T => structuredClone(value);

/** Apply the page's own `projectsUpdate` patch to the fixture, as the vault would. */
function applyPatch(id: string, patch: Record<string, unknown>): Project | null {
  const project = projectsState.find((entry) => entry.id === id);
  if (!project) return null;
  const fields = [
    "title",
    "summary",
    "stateNote",
    "bodyMarkdown",
    "goalId",
    "domainSlug",
    "status",
    "priority",
    "startDate",
    "targetDate",
    "progress",
    "nextAction",
  ] as const;
  for (const field of fields) {
    if (patch[field] !== undefined) {
      (project as unknown as Record<string, unknown>)[field] = patch[field];
    }
  }
  const addUpdate = patch.addUpdate as { note?: string; progress?: number | null } | undefined;
  if (addUpdate && typeof addUpdate.note === "string") {
    project.updates.push({
      id: `u-${updateNumber++}`,
      at: LATER,
      note: addUpdate.note,
      progress: addUpdate.progress ?? null,
      actorName: null,
    });
  }
  project.updatedAt = LATER;
  return project;
}

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(clone(SNAPSHOT)),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => undefined,
  onVaultDataChanged: () => () => undefined,
  domainGetActive: () => Promise.resolve(null),
  domainSetActive: (slug: unknown) => ok(slug ?? null),
  projectsList: () => ok({ records: clone(projectsState), skipped: 0 }),
  projectsGet: (id: unknown) => {
    const project = projectsState.find((entry) => entry.id === id);
    return project
      ? ok(clone(project))
      : Promise.resolve({ ok: false as const, error: `Project not found: ${String(id)}` });
  },
  projectsCreate: (input: unknown) => {
    const typed = input as Partial<Project>;
    const created: Project = {
      id: `p-new-${projectsState.length + 1}`,
      title: String(typed.title ?? ""),
      summary: String(typed.summary ?? ""),
      stateNote: String(typed.stateNote ?? ""),
      bodyMarkdown: String(typed.bodyMarkdown ?? ""),
      goalId: (typed.goalId as string | null) ?? null,
      domainSlug: (typed.domainSlug as string | null) ?? null,
      status: typed.status ?? "open",
      priority: (typed.priority as Project["priority"]) ?? null,
      startDate: (typed.startDate as string | null) ?? null,
      targetDate: (typed.targetDate as string | null) ?? null,
      progress: 0,
      nextAction: (typed.nextAction as string | null) ?? null,
      updates: [],
      createdAt: LATER,
      updatedAt: LATER,
    };
    projectsState = [created, ...projectsState];
    return ok(clone(created));
  },
  projectsUpdate: (id: unknown, patch: unknown) => {
    record("projectsUpdate", [id, patch]);
    const updated = applyPatch(String(id), (patch ?? {}) as Record<string, unknown>);
    return updated
      ? ok(clone(updated))
      : Promise.resolve({ ok: false as const, error: `Project not found: ${String(id)}` });
  },
  signalChainList: () => ok({ records: clone(SIGNALS), skipped: 0 }),
  // The shell's own reads: the rail's Decisions badge, the chat dock's
  // page-context board lock, and the model inventory its control row would show.
  // All are unrelated to Projects; they are modelled so a clean run really means
  // "nothing unexpected".
  decisionList: () => ok(clone(DECISIONS)),
  pinsList: () => ok({ pins: [], locked: false }),
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok([]),
  onCompanionStream: () => () => undefined,
  onCompanionStatusChanged: () => () => undefined,
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => undefined,
    toggleMaximize: () => undefined,
    close: () => undefined,
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => undefined,
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found === undefined) {
      return (...args: unknown[]) => {
        unmodelled.push(prop);
        record(prop, args);
        return ok(null);
      };
    }
    // Only functions are wrapped for the transcript; a nested object (the
    // window-chrome bridge) has to reach the shell whole, or its methods are
    // unreachable.
    if (typeof found !== "function") return found;
    return (...args: unknown[]) => {
      record(prop, args);
      return (found as (...inner: unknown[]) => unknown)(...args);
    };
  },
  has: () => true,
});

const harness = window as unknown as {
  lifequest: unknown;
  projectsHarnessRoute?: string;
  projectsHarnessCalls?: Call[];
  projectsHarnessUnmodelled?: string[];
  projectsHarnessReady?: Promise<void>;
};
harness.lifequest = stubbed;
harness.projectsHarnessCalls = calls;
harness.projectsHarnessUnmodelled = unmodelled;

/** The page the router is on, published from an effect so it never runs ahead of the commit. */
function RouteProbe() {
  const { pathname } = useLocation();
  useEffect(() => {
    harness.projectsHarnessRoute = pathname;
  }, [pathname]);
  return null;
}

// The rig must judge the app's own palette, not a preference another harness
// left in this origin's storage: a stored light theme would repaint the page
// under the dark capture this rig is judged by.
window.localStorage.removeItem("lifequest-theme");
window.localStorage.removeItem("lifequest-skin");

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from projects.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/projects"]}>
      <RouteProbe />
      <ThemeProvider>
        <VaultProvider>
          <LiveDataProvider>
            <ChatDockProvider>
              <NavDockProvider>
                <div className="app-root">
                  <WindowTitleBar />
                  <div className="app-root__body">
                    <Routes>
                      <Route element={<AppShell />}>
                        <Route path="/projects" element={<ProjectsPage />} />
                        <Route path="/projects/:id" element={<ProjectPage />} />
                        <Route
                          path="/goals"
                          element={
                            <div className="stub-page">
                              <h1 className="stub-page__title">Goals</h1>
                            </div>
                          }
                        />
                      </Route>
                    </Routes>
                  </div>
                </div>
              </NavDockProvider>
            </ChatDockProvider>
          </LiveDataProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

/**
 * Ready means the shell AND the entry page committed: a rail that rendered
 * before the router had a page would let the first sample read an empty sheet.
 */
let settle: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = (): void => {
  const rail = document.querySelector(".nav-rail");
  const tabs = document.querySelector(".nav-rail__wings");
  const page = document.querySelector("[data-page-context-root] > *");
  if (!rail || !tabs || !page) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

window.addEventListener("error", (event) => {
  unmodelled.push(`window error: ${String(event.message)}`);
});
window.addEventListener("unhandledrejection", (event) => {
  unmodelled.push(`unhandled rejection: ${String(event.reason)}`);
});

harness.projectsHarnessReady = ready;
