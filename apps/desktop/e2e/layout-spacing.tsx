/**
 * E2E harness for the layout-spacing rig — driven by
 * `layout-spacing.electron.mjs` and `tests/layout-spacing-e2e.test.ts`.
 *
 * The claims under test are numbers, so the rig mounts the shipping shell and
 * the shipping pages rather than a drawing of them: the real `AppShell` (rail,
 * sheet, chat dock, title bar), the real page components for all fifteen routed
 * boards, the real CSS, and the real layout engine. Only the IPC bridge is
 * stubbed, because a dev-server page has no preload.
 *
 * This is a system-in-isolation rig, so every way it can lie is written down
 * before the assertions:
 *
 *  1. The IPC stub answers a shape the real main process never returns, so a
 *     page throws, React 19 unmounts the tree, and every measurement comes back
 *     as zeros. A driver that only compared numbers would then read two absences
 *     as agreement. So every stub is a real shape, and the driver asserts the
 *     page's own root and its own cards exist before it measures anything.
 *  2. React Router commits inside a transition, so a route read during render
 *     runs ahead of the DOM: `window.layoutSpacingRoute` is written from an
 *     effect, and the driver waits for that committed word *and* for the page's
 *     own root, never for a fixed settle.
 *  3. A page's data arrives after mount, so the page root can exist while its
 *     list is still empty. The driver waits, per route, for the named amount of
 *     real content (a card count) before it samples; the harness only publishes
 *     "the shell and the routed page committed".
 *  4. `MemoryRouter` never touches the window URL, so the entry rides the query
 *     string: `?route=` is how the driver walks the fifteen boards, and
 *     `?chat=closed` is how it asks for the collapsed dock. If the flag were
 *     ignored the chat-open numbers would silently masquerade as chat-closed
 *     ones, so the driver asserts the shell's own `shell--chat-collapsed` class
 *     before it reports the closed state.
 *  5. A hidden Electron window throttles timers and stops painting, so the
 *     driver disables backgrounding, keeps `backgroundThrottling: false`, and
 *     shows the window inactive before it crops a screenshot.
 *  6. The chat dock is only measurable while it draws a panel: collapsed it is a
 *     launcher mark with no panel and no composer. The harness reports `null`
 *     for those rects, and the driver names that as a missing measurement rather
 *     than reading a zero.
 *  7. The vault snapshot is shared by every page, so a page that renders because
 *     a *different* page's data is in it would pass with its own reads
 *     unanswered. Every page's named bridge call is listed here with a real
 *     result; the Proxy fallback only keeps an unmodelled call from throwing.
 *  8. The theme is the app's own. A harness page that painted bare tokens would
 *     be measuring a skin the operator never runs, so the app's default skin is
 *     applied before the first render and its name is published for the driver.
 *  9. Anything the shell or the pages reach for that is not named here must not
 *     throw: `window.onerror` and `unhandledrejection` are collected into
 *     `layoutSpacingErrors`, and the driver asserts that array stays empty.
 */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  AgentHire,
  BriefItem,
  ComposedViewRunResult,
  ConnectedAgent,
  DatabaseMeta,
  DoctrineDocument,
  DocumentKind,
  Goal,
  ImageMimeType,
  LibraryDocument,
  LifeEvent,
  PageListEntry,
  Pin,
  PinBoardRead,
  Project,
  SavedView,
  VaultImage,
  VaultSnapshot,
  VisionBoard,
} from "@lifequest/vault-core";
import { todayLocalIso, yearOf } from "@lifequest/vault-core/map";
import type {
  LiveDay,
  RecurringTask,
  StoreState,
  Task,
} from "@lifequest/vault-core/map";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider, useChatDock } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import ActPage from "@/pages/ActPage";
import ArchitecturePage from "@/pages/ArchitecturePage";
import ChartPage from "@/pages/ChartPage";
import DailySchedulePage from "@/pages/DailySchedulePage";
import DataPage from "@/pages/DataPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DreamPage from "@/pages/DreamPage";
import GoalsPage from "@/pages/GoalsPage";
import HomePage from "@/pages/HomePage";
import IdealStatePage from "@/pages/IdealStatePage";
import ImagesPage from "@/pages/ImagesPage";
import PagesPage from "@/pages/PagesPage";
import PersonnelPage from "@/pages/PersonnelPage";
import ProjectsPage from "@/pages/ProjectsPage";
import VisionPage from "@/pages/VisionPage";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

/* ─────────────────────────────── the theme ─────────────────────────────── */

// The shipped screen is the operator's LIGHT day theme; `?mode=dark` is the
// other half of the Dark Ladder, kept for a rig that wants to compare them. The
// driver loads `?mode=light` so every handover screenshot is the shipped look.
const MODE =
  new URLSearchParams(window.location.search).get("mode") === "dark"
    ? "dark"
    : "light";

// A previous rig in the same partition could have left a look behind: the
// measurements are only the shipped app's if the palette is the shipped one.
try {
  window.localStorage.removeItem("lifequest-theme");
  window.localStorage.removeItem("lifequest-skin");
  window.localStorage.removeItem("lifequest.companion.openTabs");
  // `ThemeProvider` reads its preference from storage on first render; without
  // this it would repaint the default dark over the skin painted below.
  window.localStorage.setItem("lifequest-theme", MODE);
} catch {
  /* a locked-down storage is still a paintable page */
}
const skinName = applyAppSkin(MODE);

/* ─────────────────────────────── the fixture ────────────────────────────── */

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const NOW = "2026-11-01T08:00:00.000Z";
/** The local day the fixture lives on, so "today" is the day the run sees. */
const TODAY = todayLocalIso();
/** The map's live year: the one `MapYearProvider` resolves for a cold load. */
const YEAR = yearOf(TODAY);

type Docs = Record<DocumentKind, DoctrineDocument>;

function documentFor(
  slug: string,
  kind: DocumentKind,
  body: string,
  index: number,
): DoctrineDocument {
  return {
    kind,
    title: `${kind} — ${slug}`,
    locked: false,
    updatedAt: NOW,
    bodyMarkdown: body,
    mtimeMs: 1_760_000_000_000 + index,
  };
}

/** One domain's four doctrine documents, each with real prose in it. */
function docsFor(
  slug: string,
  bodies: Record<DocumentKind, string>,
): Docs {
  return {
    premise: documentFor(slug, "premise", bodies.premise, 0),
    what: documentFor(slug, "what", bodies.what, 1),
    why: documentFor(slug, "why", bodies.why, 2),
    how: documentFor(slug, "how", bodies.how, 3),
  };
}

const HEALTH_DOCS = docsFor("health", {
  premise: "The body compounds: three boring sessions beat one heroic week.",
  what: "A calm, strong body at sixty, able to carry a grandchild up the stairs.",
  why: "So the work I do outlives the noise of any single quarter.",
  how: "Three sessions a week, a walk every day, and lights out before eleven.",
});
const FINANCIAL_DOCS = docsFor("financial", {
  premise: "Money is stored optionality: the point is the choices it buys.",
  what: "Eighteen months of runway and no consumer debt.",
  why: "So a wrong quarter never becomes a wrong decade.",
  how: "One operating brief a month, one review a quarter, one budget line per project.",
});
const LIFE_DOCS = docsFor("life", {
  premise: "A life worth keeping is one a person would choose again tomorrow.",
  what: "A quiet studio, a strong body, work that outlives me.",
  why: "Because the alternative is drifting through someone else's week.",
  how: "One page a week about what mattered, and the calendar to back it up.",
});

const DOMAINS = [
  {
    slug: "life",
    meta: {
      name: "Life",
      description: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      unlockedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: LIFE_DOCS,
  },
  {
    slug: "health",
    meta: {
      name: "Health",
      description: null,
      color: "green",
      sortOrder: 1,
      archivedAt: null,
      unlockedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: HEALTH_DOCS,
  },
  {
    slug: "financial",
    meta: {
      name: "Finance",
      description: null,
      color: "gold",
      sortOrder: 2,
      archivedAt: null,
      unlockedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: FINANCIAL_DOCS,
  },
];

const GOALS: Goal[] = [
  {
    id: "g-spacing",
    name: "Make every board breathe",
    notes: "The operator asked for one rhythm across all fifteen boards.",
    status: "open",
    domainSlug: "health",
    deadline: `${YEAR}-12-15`,
    metric: null,
    target: null,
    definitionOfDone: "Every board shares the chat gutter and a wider card gap.",
    current: null,
  },
  {
    id: "g-run",
    name: "Run a sub-50 10k",
    notes: "Build the long run first; speed is the by-product.",
    status: "open",
    domainSlug: "health",
    deadline: null,
    metric: "minutes",
    target: 50,
    definitionOfDone: null,
    current: 54,
  },
  {
    id: "g-launch",
    name: "Launch the Q4 operating brief",
    notes: "Shipped to the team in October.",
    status: "done",
    domainSlug: "financial",
    deadline: null,
    metric: null,
    target: null,
    definitionOfDone: "Brief shipped and read by the team.",
    current: null,
  },
];

const PAGES: PageListEntry[] = [
  {
    domainSlug: "health",
    page: {
      id: "pg-health",
      domainSlug: "health",
      title: "Health operating page",
      blocks: [
        {
          id: "blk-health-1",
          kind: "markdown",
          markdown: "## Weekly rhythm\n\nThree sessions, one long walk, one rest day.",
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  },
  {
    domainSlug: "financial",
    page: {
      id: "pg-money",
      domainSlug: "financial",
      title: "Money operating page",
      blocks: [
        {
          id: "blk-money-1",
          kind: "markdown",
          markdown: "## This quarter\n\nRunway, the hiring pause, two bets.",
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  },
];

const TX_DATABASE: DatabaseMeta = {
  id: "finance:transactions",
  name: "Transactions",
  sotMode: "local-only",
  adapter: null,
  columns: [
    { id: "occurred_on", name: "Occurred on", type: "date" },
    { id: "amount", name: "Amount", type: "number" },
    { id: "week", name: "Week", type: "text" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const WORKOUT_DATABASE: DatabaseMeta = {
  id: "health:workouts",
  name: "Workouts",
  sotMode: "local-only",
  adapter: null,
  columns: [
    { id: "day", name: "Day", type: "date" },
    { id: "kind", name: "Kind", type: "select", options: ["run", "lift"] },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const VIEW_WEEKLY: SavedView = {
  schemaVersion: 1,
  id: "v-weekly",
  title: "Weekly expenses",
  presentation: "table",
  databaseId: "finance:transactions",
  groupBy: "week",
  timeBucket: "week",
  timeColumnId: "occurred_on",
  timeWindow: { kind: "last-weeks", weeks: 5 },
  filters: [],
  measure: "sum",
  measureColumnId: "amount",
  sort: { by: "label", dir: "asc" },
  limit: 12,
  convertToZar: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const VIEW_RUN: ComposedViewRunResult = {
  title: VIEW_WEEKLY.title,
  blocks: [
    {
      id: "week-by-week",
      title: "Week by week",
      presentation: "table",
      result: {
        columns: ["label", "value"],
        rows: [
          ["2026-W40", 1111],
          ["2026-W41", 1148],
          ["2026-W42", 1180],
          ["2026-W43", 1265],
        ],
        warnings: [],
        currency: "ZAR",
      },
    },
  ],
  warnings: [],
};

/**
 * The Dashboard board: every built-in card the operator asked the harness to
 * draw, plus one saved view and one page so the grid has more than one shape.
 */
const PINS: Pin[] = [
  { id: "sys:companion-brief", kind: "system", system: "companion-brief" },
  { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
  { id: "sys:deadline", kind: "system", system: "deadline" },
  { id: "sys:today-week", kind: "system", system: "today-week" },
  { id: "sys:pending-decisions", kind: "system", system: "pending-decisions" },
  { id: "sys:recent-log", kind: "system", system: "recent-log" },
  {
    id: "view:financial:v-weekly",
    kind: "view",
    domainSlug: "financial",
    viewId: "v-weekly",
    span: 1,
  },
  {
    id: "page:health:pg-health",
    kind: "page",
    domainSlug: "health",
    pageId: "pg-health",
  },
];

const LIBRARY: LibraryDocument[] = [
  {
    id: "lib-1",
    title: "Q4 operating notes",
    bodyMarkdown: "Runway is eighteen months. The hiring pause holds.",
    domainSlugs: ["financial"],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    locked: false,
  },
  {
    id: "lib-2",
    title: "Training log",
    bodyMarkdown: "Three sessions a week, one long walk on Sunday.",
    domainSlugs: ["health"],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    locked: false,
  },
];

const IMAGES: VaultImage[] = [
  {
    id: "img-1",
    relPath: "images/files/img-1.png",
    name: "studio-morning.png",
    caption: "The studio in morning light",
    mime: "image/png" as ImageMimeType,
    bytes: 128_000,
    width: 1600,
    height: 1000,
    createdAt: NOW,
  },
  {
    id: "img-2",
    relPath: "images/files/img-2.png",
    name: "trail-run.png",
    caption: "The trail the long run follows",
    mime: "image/png" as ImageMimeType,
    bytes: 96_000,
    width: 1400,
    height: 900,
    createdAt: NOW,
  },
];

const VISION_BOARD: VisionBoard = {
  blocks: [
    { id: "vb-1", kind: "heading", text: "The life I am reaching for" },
    {
      id: "vb-2",
      kind: "text",
      text: "A quiet studio, a strong body, and work that outlives the quarter.",
    },
    {
      id: "vb-3",
      kind: "bullets",
      items: [
        "Mornings with the door open",
        "One long walk a day",
        "A brief the team actually reads",
      ],
    },
  ],
  updatedAt: NOW,
};

const IDEAL_STATE: {
  entries: { id: string; title: string; updatedAt: string }[];
  documents: Record<
    string,
    { id: string; title: string; createdAt: string; updatedAt: string; bodyMarkdown: string }
  >;
} = {
  entries: [
    { id: "ideal-1", title: "The quiet studio", updatedAt: NOW },
    { id: "ideal-2", title: "A strong sixty", updatedAt: NOW },
  ],
  documents: {
    "ideal-1": {
      id: "ideal-1",
      title: "The quiet studio",
      createdAt: NOW,
      updatedAt: NOW,
      bodyMarkdown:
        "# The quiet studio\n\nA room with one window, one desk, and nothing on the walls that does not earn its place.",
    },
    "ideal-2": {
      id: "ideal-2",
      title: "A strong sixty",
      createdAt: NOW,
      updatedAt: NOW,
      bodyMarkdown:
        "# A strong sixty\n\nStill carrying my own bags, still walking the long way home.",
    },
  },
};

const AGENTS: AgentHire[] = [
  {
    id: "hire-1",
    hermesAgentId: "hermes-ops",
    name: "Ops",
    roleLabel: "Operating partner",
    domainSlug: "financial",
    status: "active",
    createdAt: NOW,
    dismissedAt: null,
  },
  {
    id: "hire-2",
    hermesAgentId: "hermes-coach",
    name: "Coach",
    roleLabel: "Training planner",
    domainSlug: "health",
    status: "active",
    createdAt: NOW,
    dismissedAt: null,
  },
];

const CONNECTED_AGENTS: ConnectedAgent[] = [
  {
    id: "conn-1",
    name: "Claude Desktop",
    fingerprint: "sha256:harness-one",
    status: "active",
    access: "write",
    domainSlugs: ["health", "financial"],
    schedule: true,
    door: "local",
    createdAt: NOW,
    decidedAt: NOW,
  },
  {
    id: "conn-2",
    name: "Field notes",
    fingerprint: "sha256:harness-two",
    status: "active",
    access: "read",
    domainSlugs: [],
    schedule: false,
    door: "invite",
    createdAt: NOW,
    decidedAt: NOW,
  },
];

const PROJECTS: Project[] = [
  {
    id: "p-rig",
    title: "Layout spacing pass",
    summary: "One gutter and one card rhythm across all fifteen boards.",
    projectType: "Design system",
    source: "Operator review",
    sourceUrl: null,
    repoUrls: ["https://github.com/karmsheel/life-quest"],
    bodyMarkdown:
      "# Layout spacing pass\n\nThe page gutter follows the chat bar; the cards get room to breathe.",
    stateNote: "Measuring the baseline on every board.",
    goalId: "g-spacing",
    domainSlug: "health",
    status: "active",
    priority: "high",
    startDate: "2026-11-01",
    targetDate: "2026-12-15",
    progress: 35,
    nextAction: "Write the harness for all fifteen boards.",
    updates: [
      {
        id: "pu-1",
        at: NOW,
        note: "Baseline fixtures assembled.",
        progress: 35,
        actorName: "Operator",
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "p-brief",
    title: "Q4 operating brief",
    summary: "The one-page brief the whole quarter runs on.",
    projectType: "Document",
    source: null,
    sourceUrl: null,
    repoUrls: [],
    bodyMarkdown: "# Q4 operating brief\n\nRunway, hiring pause, two bets.",
    stateNote: "Shipped.",
    goalId: "g-launch",
    domainSlug: "financial",
    status: "done",
    priority: "normal",
    startDate: "2026-10-01",
    targetDate: "2026-10-31",
    progress: 100,
    nextAction: null,
    updates: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "p-run",
    title: "Sub-50 10k",
    summary: "A training block with one long run a week.",
    projectType: "Training",
    source: null,
    sourceUrl: null,
    repoUrls: [],
    bodyMarkdown: "# Sub-50 10k\n\nBuild the long run first.",
    stateNote: "Week two of twelve.",
    goalId: "g-run",
    domainSlug: "health",
    status: "open",
    priority: "normal",
    startDate: "2026-11-02",
    targetDate: null,
    progress: 15,
    nextAction: "Book the Saturday long run.",
    updates: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const LOG: LifeEvent[] = [
  {
    id: "evt-1",
    domainSlug: "health",
    type: "update",
    summary: "Logged the morning training block.",
    payload: null,
    createdAt: "2026-11-01T06:10:00.000Z",
    actor: "user",
  },
  {
    id: "evt-2",
    domainSlug: "financial",
    type: "decision",
    summary: "Approved the Q4 operating brief.",
    payload: null,
    createdAt: NOW,
    actor: "user",
  },
  {
    id: "evt-3",
    domainSlug: null,
    type: "note",
    summary: "Wrote the weekly page.",
    payload: null,
    createdAt: "2026-10-31T18:05:00.000Z",
    actor: "user",
  },
  {
    id: "evt-4",
    domainSlug: "health",
    type: "task",
    summary: "Finished the long walk.",
    payload: null,
    createdAt: "2026-10-30T17:40:00.000Z",
    actor: "user",
  },
  {
    id: "evt-5",
    domainSlug: null,
    type: "capture",
    summary: "Captured an idea about the spacing pass.",
    payload: null,
    createdAt: "2026-10-29T09:30:00.000Z",
    actor: "user",
  },
];

const BRIEF_ITEMS: BriefItem[] = [
  {
    id: "brief-1",
    kind: "watch",
    text: "The training block has skipped its long run twice this month.",
    why: "Two misses is the pattern, not the exception.",
    sourceRef: "note 2026-11-01",
    domainSlug: "health",
    priority: 1,
    createdAt: NOW,
    expiresAt: `${YEAR}-12-31`,
  },
  {
    id: "brief-2",
    kind: "prompt",
    text: "The spacing pass has no target numbers yet.",
    why: "The Lead's CSS fix cannot be checked against a guess.",
    sourceRef: "conversation 2026-11-01",
    domainSlug: null,
    priority: 2,
    createdAt: NOW,
    expiresAt: `${YEAR}-12-31`,
  },
];

/* ──────────────────────────────── the map ───────────────────────────────── */

const TASKS: Task[] = [
  {
    id: "t-1",
    title: "Draft the Q4 operating brief",
    notes: "Cover the runway, the hiring pause, and the two bets.",
    column: "backlog",
    links: { goalId: "g-launch" },
  },
  {
    id: "t-2",
    title: "Collect receipts from the accountant",
    notes: "",
    column: "backlog",
    links: {},
  },
  {
    id: "t-3",
    title: "Book the dentist",
    notes: "",
    column: "next-30-days",
    links: { date: TODAY },
  },
  {
    id: "t-4",
    title: "Review the spacing pass",
    notes: "",
    column: "this-week",
    links: { projectId: "p-rig", goalId: "g-spacing" },
  },
  {
    id: "t-5",
    title: "Write the week's page",
    notes: "",
    column: "this-week",
    links: {},
  },
  {
    id: "t-6",
    title: "Tick the morning block",
    notes: "",
    column: "today",
    links: {},
  },
  {
    id: "t-7",
    title: "Call the bank",
    notes: "",
    column: "today",
    links: {},
  },
  {
    id: "t-8",
    title: "Compare two layouts",
    notes: "",
    column: "in-progress",
    links: { goalId: "g-spacing" },
  },
  {
    id: "t-9",
    title: "Ship the previous release",
    notes: "",
    column: "done",
    links: {},
  },
];

const RECURRING: RecurringTask[] = [
  {
    id: "rt-1",
    title: "Weekly review",
    notes: "Look back before looking forward.",
    recurrence: { unit: "week", weekday: 4 },
    dueDate: TODAY,
    link: "/review/weekly",
    paused: false,
    history: [],
    origin: "operator",
  },
  {
    id: "rt-2",
    title: "Pay the studio rent",
    notes: "",
    recurrence: { unit: "month", dayOfMonth: 1 },
    dueDate: `${YEAR}-12-01`,
    paused: true,
    history: [],
    origin: "operator",
  },
];

const LIVE_DAY: LiveDay = {
  date: TODAY,
  dayTypeId: "dt-deep",
  leftover: [
    {
      id: "lo-1",
      text: "Ad-hoc: call the bank",
      done: false,
      source: { type: "ad-hoc" },
    },
  ],
  blocks: [
    {
      id: "lb-1",
      text: "Morning block",
      startMinutes: 540,
      durationMinutes: 90,
      done: false,
      source: { type: "template", dayTypeItemId: "ct-1" },
    },
    {
      id: "lb-2",
      text: "Walk",
      startMinutes: 900,
      durationMinutes: 30,
      done: true,
      source: { type: "ad-hoc" },
    },
  ],
};

const MAP: StoreState = {
  dayTypes: [
    {
      id: "dt-deep",
      name: "Deep work",
      color: "blue",
      items: [
        { id: "ct-1", text: "Morning block" },
        { id: "ct-2", text: "Long walk" },
      ],
    },
    {
      id: "dt-admin",
      name: "Admin",
      color: "orange",
      items: [{ id: "ct-3", text: "Inbox" }],
    },
  ],
  defaultWeek: {
    dayTypeByWeekday: [
      "dt-deep",
      "dt-admin",
      "dt-deep",
      "dt-admin",
      "dt-deep",
      null,
      null,
    ],
    weeklyItems: [
      { id: "wi-1", text: "Weekly review" },
      { id: "wi-2", text: "Training x3" },
    ],
  },
  years: [
    {
      year: YEAR,
      status: "live",
      events: [
        {
          id: "me-1",
          title: "Spacing pass ships",
          date: `${YEAR}-11-18`,
          notes: "",
          domainSlug: "health",
          goalId: "g-spacing",
        },
        {
          id: "me-2",
          title: "Q4 brief approved",
          date: `${YEAR}-10-31`,
          notes: "",
          domainSlug: "financial",
          goalId: "g-launch",
        },
        {
          id: "me-3",
          title: "Ten-week training block starts",
          date: `${YEAR}-11-02`,
          notes: "",
          domainSlug: "health",
          goalId: "g-run",
        },
      ],
      months: Array.from({ length: 12 }, (_, index) => ({
        objectives:
          index === 10
            ? "Close the spacing pass and write the numbers down."
            : index === 9
              ? "Ship the operating brief."
              : "",
        notes: index === 10 ? "One pass, every board, one rhythm." : "",
        days:
          index === 10
            ? { [TODAY]: "Spacing review" }
            : index === 9
              ? { [`${YEAR}-10-31`]: "Brief approved" }
              : {},
      })),
      detachedWeeks: {},
    },
  ],
  tasks: TASKS,
  recurring: RECURRING,
  liveDays: { [TODAY]: LIVE_DAY },
  aboutMe: "A quiet studio, a strong body, and work that outlives the quarter.",
};

const SESSION = {
  id: "layout-spacing-session",
  title: "Layout review",
  preview: "Layout spacing harness",
  lastActive: 1_700_000_000,
  pinned: false,
};

const TRANSCRIPT = [
  { role: "user" as const, content: "How much padding do the boards carry?" },
  {
    role: "assistant" as const,
    content:
      "The page gutter and the dock's composer gutter are two different measures today. The rig reports both as pixels.",
  },
];

/**
 * The composer's model catalog: the pill row branches on these shapes, and a
 * missing catalog would change the composer's own height — which is part of the
 * box this rig measures.
 */
const MODEL_CATALOG = {
  providers: [
    {
      slug: "nous",
      name: "Nous Portal",
      authenticated: true,
      models: [
        {
          id: "stealth/space-bunny-alpha",
          reasoning: true,
          canDisableReasoning: true,
          fast: false,
        },
        {
          id: "openai/gpt-6-sol",
          reasoning: true,
          canDisableReasoning: true,
          fast: true,
        },
      ],
    },
  ],
  current: { model: "stealth/space-bunny-alpha", provider: "nous" },
};

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\layout-spacing-vault",
  lifequest: {
    schemaVersion: 1,
    id: "layout-spacing-vault",
    name: "Layout Spacing Vault",
    createdAt: NOW,
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
    chatQuestions: [],
    decisionInbox: { autoOpen: false, autoClose: true },
    reviewAvailability: {
      daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
      weekly: { daysBeforeEnd: 2, timeOfDay: "18:00" },
      monthly: { daysBeforeEnd: 3, timeOfDay: "18:00" },
      quarterly: { daysBeforeEnd: 7, timeOfDay: "18:00" },
      yearly: { daysBeforeEnd: 14, timeOfDay: "18:00" },
    },
    agentScopes: [],
  },
  domains: DOMAINS,
  agents: AGENTS,
  decisions: [],
  log: LOG,
  map: MAP,
  mapError: null,
  goals: GOALS,
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 3,
  onboarding: {
    status: "completed",
    startedAt: NOW,
    completedAt: NOW,
    unlockedAreas: ["health", "financial"],
  },
  onboardingProposal: null,
};

/* ─────────────────────────────── the bridge ─────────────────────────────── */

const errors: string[] = [];
const calls: string[] = [];

/** Record one IPC name, so the report can show which reads the page made. */
function mark(name: string) {
  calls.push(name);
}

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => {
    mark("vaultGetSnapshot");
    return ok(SNAPSHOT);
  },
  vaultListRecent: () => {
    mark("vaultListRecent");
    return Promise.resolve([]);
  },
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: () => () => {},
  settingsUpdate: () => ok(SNAPSHOT.settings),

  // ── Dashboard ────────────────────────────────────────────────────────────
  pinsList: () => {
    mark("pinsList");
    return ok({ pins: PINS, locked: false } satisfies PinBoardRead);
  },
  pinsSet: () => ok({ applied: true, pins: PINS, locked: false }),
  pinsSetLocked: () =>
    ok({ pins: PINS, locked: false } satisfies PinBoardRead),
  pageList: () => {
    mark("pageList");
    return ok(PAGES);
  },
  viewList: () => {
    mark("viewList");
    return ok([VIEW_WEEKLY]);
  },
  viewGet: () => ok(VIEW_WEEKLY),
  viewRunSaved: () => ok(VIEW_RUN),
  dbGet: (_slug: unknown, dbId: unknown) =>
    ok(dbId === WORKOUT_DATABASE.id ? WORKOUT_DATABASE : TX_DATABASE),
  kitList: () => {
    mark("kitList");
    return ok([]);
  },
  deadlineGetDismissed: () => ok(null),
  deadlineMaybeNotify: () =>
    ok({ ok: true, notified: false, title: "", body: "" }),
  deadlineDismiss: () => ok(true),
  briefGet: () => {
    mark("briefGet");
    return ok({
      writtenAt: NOW,
      writtenBy: "companion" as const,
      items: BRIEF_ITEMS,
      recentlyExpired: [],
      dismissals: [],
      problems: [],
    });
  },
  briefDismiss: () =>
    ok({
      writtenAt: NOW,
      writtenBy: "companion" as const,
      items: BRIEF_ITEMS,
      recentlyExpired: [],
      dismissals: [],
      problems: [],
    }),

  // ── Data ─────────────────────────────────────────────────────────────────
  dbList: () => {
    mark("dbList");
    return ok([
      { domainSlug: "financial", database: TX_DATABASE },
      { domainSlug: "health", database: WORKOUT_DATABASE },
    ]);
  },
  dbListRows: () => ok([]),
  kitFinanceSettings: () =>
    ok({
      homeCurrency: "ZAR" as const,
      usdZarRate: null,
      usdZarAsOf: null,
      defaultCaptureAccountId: null,
    }),

  // ── Documents ────────────────────────────────────────────────────────────
  libraryList: () => {
    mark("libraryList");
    return ok({ records: LIBRARY, skipped: 0 });
  },

  // ── Images / Vision board ────────────────────────────────────────────────
  imagesList: () => {
    mark("imagesList");
    return ok(IMAGES);
  },
  // The fixture files do not exist on this disk, and the page's own missing
  // branch is the honest answer — it still draws one card per picture.
  imagesRead: () => Promise.resolve({ ok: false as const, error: "NOT_FOUND" }),
  imagesBoardGet: () => {
    mark("imagesBoardGet");
    return ok(VISION_BOARD);
  },
  imagesBoardSave: () => ok(VISION_BOARD),

  // ── Ideal State ──────────────────────────────────────────────────────────
  idealStateList: () => {
    mark("idealStateList");
    return ok(IDEAL_STATE.entries);
  },
  idealStateGet: (id: string) => {
    const document = IDEAL_STATE.documents[id];
    return document
      ? ok(document)
      : Promise.resolve({ ok: false as const, error: "NOT_FOUND" });
  },

  // ── Personnel ────────────────────────────────────────────────────────────
  agentsList: () => {
    mark("agentsList");
    return ok(AGENTS);
  },
  connectedAgentsList: () => {
    mark("connectedAgentsList");
    return ok(CONNECTED_AGENTS);
  },
  connectedAgentsListInvites: () => ok([]),
  hermesScanAgents: () => ok([]),

  // ── Goals / Projects ─────────────────────────────────────────────────────
  goalsApply: () => ok(SNAPSHOT),
  projectsList: () => {
    mark("projectsList");
    return ok({ records: PROJECTS, skipped: 0 });
  },
  planningStartOrResume: () =>
    ok({
      sessionId: SESSION.id,
      created: false,
      kickoff: "",
      session: SESSION,
    }),

  // ── Map (Chart, Track, Daily, Act) ───────────────────────────────────────
  mapApply: () => ok(SNAPSHOT),

  // ── Chat dock ────────────────────────────────────────────────────────────
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok(TRANSCRIPT),
  companionModelOptions: () => ok(MODEL_CATALOG),
  companionChatStream: () => ok(true),
  companionRunStop: () => ok(true),
  onCompanionStream: () => () => {},
  signalChainList: () => ok({ records: [], skipped: 0 }),
  logList: () => {
    mark("logList");
    return ok(LOG);
  },
  decisionList: () => {
    mark("decisionList");
    return ok([]);
  },

  // ── Theme files (ThemeProvider's mount reads these) ──────────────────────
  // `ThemeProvider` iterates the list and registers a change subscription, so a
  // bare Proxy answer (`ok(null)` / a promise) would either throw on spread or
  // crash the tree when the "unsubscribe" is called. These are the real shapes.
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  themeSetKept: () => ok({ keptFile: null }),
  themeDelete: () => ok({ deleted: true }),
  themeRead: () => Promise.resolve({ ok: false as const, error: "NOT_FOUND" }),
  themeWrite: () => Promise.resolve({ ok: false as const, error: "NOT_FOUND" }),
  themeOpenFolder: () => ok(false),
  themeExport: () => ok(null),
  themeHistory: () => ok({ file: "", versions: [] }),
  themeRestore: () => Promise.resolve({ ok: false as const, error: "NOT_FOUND" }),
  themeImport: () => ok(null),
  onThemesChanged: () => () => {},

  // Mirrors the shipped window: overlay caption buttons, so the title bar draws
  // its trailing cluster exactly as the operator sees it.
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
    const name = String(prop);
    // An `on*` channel hands back its own unsubscribe function; answering it
    // with `ok(null)` makes the caller call a Promise as a function and takes
    // the whole React tree down with it.
    if (/^on[A-Z]/.test(name)) return () => () => {};
    // A list/options/status/array-shaped read must resolve to something
    // iterable, or a page that spreads the value throws on `null`.
    if (/(List|Recent|Options|Status|History|Invites|Sessions|Tools)$/.test(name)) {
      return () => ok([]);
    }
    return () => ok(null);
  },
  has: () => true,
});

type HarnessWindow = Window & {
  lifequest: unknown;
  layoutSpacingRoute?: string;
  layoutSpacingReady?: Promise<void>;
  layoutSpacingErrors?: string[];
  layoutSpacingCalls?: string[];
  layoutSpacingSkin?: string;
  layoutSpacingChatStartClosed?: boolean;
  layoutSpacingMode?: string;
};

const harness = window as unknown as HarnessWindow;
harness.lifequest = stubbed;
harness.layoutSpacingErrors = errors;
harness.layoutSpacingCalls = calls;
harness.layoutSpacingSkin = skinName;
harness.layoutSpacingMode = MODE;

window.addEventListener("error", (event) => {
  errors.push(String(event.error?.stack ?? event.message));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as { stack?: string } | undefined;
  errors.push(`unhandled rejection: ${String(reason?.stack ?? event.reason)}`);
});

/* ─────────────────────────────── the routes ─────────────────────────────── */

/**
 * The fifteen boards the operator asked about, by route. `App.tsx` owns the
 * real table; this is the same fifteen, mounted directly so a driver can walk
 * them without the companion gate or the splash.
 */
const ROUTES: { path: string; element: ReactNode }[] = [
  { path: "/home", element: <HomePage /> },
  { path: "/data", element: <DataPage /> },
  { path: "/pages", element: <PagesPage /> },
  { path: "/documents", element: <DocumentsPage /> },
  { path: "/personnel", element: <PersonnelPage /> },
  { path: "/images", element: <ImagesPage /> },
  { path: "/dream", element: <DreamPage /> },
  { path: "/vision", element: <VisionPage /> },
  { path: "/ideal-state", element: <IdealStatePage /> },
  { path: "/goals", element: <GoalsPage /> },
  { path: "/chart", element: <ChartPage /> },
  { path: "/track", element: <ArchitecturePage /> },
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/daily", element: <DailySchedulePage /> },
  { path: "/act", element: <ActPage /> },
];

/**
 * The page the router is on, published for the driver.
 *
 * Written from an effect, not from render: `MemoryRouter` commits inside a
 * transition, so a render-phase write publishes the new pathname *before* the
 * commit that draws it — and a driver waiting on the route would then sample
 * the page it just left.
 */
function RouteProbe() {
  const { pathname } = useLocation();
  useEffect(() => {
    harness.layoutSpacingRoute = pathname;
  }, [pathname]);
  return null;
}

/**
 * `?chat=closed` starts the dock collapsed, the state the operator sees after
 * pressing the panel's own collapse control. It runs in an effect so the
 * provider's first commit is the shipping default (open) and the driver's
 * collapsed sample is a real state change, not a fiction baked into a prop.
 */
function DockStart({ closed }: { closed: boolean }) {
  const { setOpen } = useChatDock();
  useEffect(() => {
    if (closed) setOpen(false);
  }, [closed, setOpen]);
  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from layout-spacing.html");

// The entry rides the query string because `MemoryRouter` owns the URL in here.
const params = new URLSearchParams(window.location.search);
const entry = params.get("route") ?? "/home";
const startChatClosed = params.get("chat") === "closed";
harness.layoutSpacingChatStartClosed = startChatClosed;

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[entry]}>
      <RouteProbe />
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <DockStart closed={startChatClosed} />
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      {ROUTES.map((route) => (
                        <Route
                          key={route.path}
                          path={route.path}
                          element={route.element}
                        />
                      ))}
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

/**
 * Ready means the shell AND the routed page committed: a rail that rendered
 * before the router had a page would let the first sample read an empty sheet.
 * The dock is either a panel or its collapsed launcher, so both are accepted;
 * the composer rects are the driver's to treat as `null` when collapsed.
 */
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const shell = document.querySelector(".shell");
  const rail = document.querySelector(".nav-rail");
  const page = document.querySelector("[data-page-context-root] > *");
  const dock =
    document.querySelector(".chat-panel") ??
    document.querySelector(".chat-launcher");
  if (!shell || !rail || !page || !dock) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

harness.layoutSpacingReady = ready;
