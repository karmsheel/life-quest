/**
 * E2E harness page for the Act page's task board (`pages/ActPage`).
 *
 * The page under test is the real Act page, not a copy of its board: the board
 * sits where `ActPage` puts it, inside the same `.act-page` measure and the same
 * `.shell__content` padding the shell gives it. That matters because the two
 * visual claims are about the page as a whole — the header comes first, and the
 * board is allowed to use the sheet's width — and a board rendered in a fixture
 * wrapper would pass both while the page still failed them.
 *
 * The vault behind it is a recording stub. Every method the page can reach is
 * listed, `mapApply` really applies the board's own command to the fixture (add,
 * delete, move), and anything unmodelled is NAMED in
 * `taskBoardUnexpectedCalls` and answered `{ ok: false }`. Nothing here writes a
 * real vault.
 *
 * The fixture is deliberately uneven: four cards in Backlog, two in This week,
 * two in Today, one in Done, with links (goal, project, date, week item), one
 * dangling goal link, and notes long enough to need the card's line clamp. A
 * board of identical cards proves nothing about the card's own hierarchy.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  DomainRecord,
  DocumentKind,
  Goal,
  LifeEvent,
  Project,
  VaultSnapshot,
} from "@lifequest/vault-core";
import type {
  MapCommand,
  StoreState,
  Task,
} from "@lifequest/vault-core/map";
import ActPage from "@/pages/ActPage";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the board the operator sees, so it
// has to paint in the palette they run rather than in the base tokens. The
// driver asks for light with `?mode=light` so the same board is checked in both
// halves of the Dark Ladder.
const mode =
  new URLSearchParams(window.location.search).get("mode") === "light"
    ? "light"
    : "dark";
const skinName = applyAppSkin(mode);

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-22T08:00:00.000Z";

/** The seeded tasks: the operator's board, reduced to the shapes that matter. */
const SEED_TASKS: Task[] = [
  {
    id: "t-brief",
    title: "Draft the Q4 operating brief",
    notes:
      "Cover the runway, the hiring pause, and the two bets we can still afford to make this year.",
    column: "backlog",
    links: { goalId: "g-brief", projectId: "p-act", date: "2026-10-24" },
  },
  {
    id: "t-receipts",
    title: "Collect receipts from the accountant",
    notes: "",
    column: "backlog",
    links: {},
  },
  {
    id: "t-banking",
    title: "Research new banking options",
    notes: "Compare fees, transfer limits and how quickly each one clears.",
    column: "backlog",
    links: { goalId: "g-money" },
  },
  {
    id: "t-legacy",
    title: "Reconcile the legacy export",
    notes: "",
    column: "backlog",
    // A dangling goal: the card has to say so rather than painting an empty chip.
    links: { goalId: "g-retired" },
  },
  {
    id: "t-ship",
    title: "Ship the redesigned Act board",
    notes: "Menus, column rhythm, responsive widths.",
    column: "this-week",
    links: {
      goalId: "g-brief",
      projectId: "p-act",
      weekItem: { year: 2026, monday: "2026-10-19", itemId: "w-review" },
    },
  },
  {
    id: "t-landlord",
    title: "Call the landlord about the leak",
    notes: "",
    column: "this-week",
    links: { date: "2026-10-23" },
  },
  {
    id: "t-review",
    title: "Review last month's spending",
    notes: "Flag the subscriptions that crept up without a decision.",
    column: "today",
    links: { goalId: "g-money", projectId: "p-runway" },
  },
  {
    id: "t-tax",
    title: "Pay the quarterly tax estimate",
    notes: "",
    column: "today",
    links: { date: "2026-10-22", projectId: "p-runway" },
  },
  {
    id: "t-savings",
    title: "Close the old savings account",
    notes: "",
    column: "done",
    links: { date: "2026-10-18" },
  },
];

const GOALS: Goal[] = [
  {
    id: "g-brief",
    name: "Ship a calmer operating system",
    notes: "",
    status: "open",
    domainSlug: "life",
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
    domainSlug: "life",
    deadline: null,
    metric: "months",
    target: 9,
    definitionOfDone: null,
    current: 6,
  },
];

const PROJECTS: Project[] = [
  {
    id: "p-act",
    title: "Act board redesign",
    bodyMarkdown: "",
    goalId: "g-brief",
    domainSlug: "life",
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "p-runway",
    title: "Quarterly finances",
    bodyMarkdown: "",
    goalId: "g-money",
    domainSlug: "life",
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

function doc(
  kind: DocumentKind,
  title: string,
  bodyMarkdown: string,
  locked: boolean,
): DomainRecord["documents"][DocumentKind] {
  return { kind, title, locked, bodyMarkdown, updatedAt: NOW, mtimeMs: 0 };
}

const DOMAIN: DomainRecord = {
  slug: "life",
  meta: {
    name: "Life",
    description: null,
    color: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  documents: {
    premise: doc("premise", "Beliefs & Premise", "Slow is smooth; smooth is fast.", true),
    what: doc("what", "Vision & Desire", "A calm, well-run life with room to think.", true),
    why: doc("why", "Purpose", "Make the work that only I can make.", true),
    how: doc("how", "Strategy (How)", "Protect the mornings; batch the admin.", true),
  },
};

const LOG: LifeEvent[] = [
  {
    id: "e-1",
    domainSlug: "life",
    type: "task.completed",
    summary: "Closed the old savings account",
    payload: {},
    createdAt: "2026-10-18T15:12:00.000Z",
    actor: "user",
  },
  {
    id: "e-2",
    domainSlug: "life",
    type: "task.created",
    summary: "Draft the Q4 operating brief",
    payload: {},
    createdAt: "2026-10-20T09:04:00.000Z",
    actor: "user",
  },
];

/** The map the board reads: one live year and a weekly item its cards link to. */
function initialState(tasks: Task[]): StoreState {
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

let mapState = initialState(structuredClone(SEED_TASKS));
let nextTaskNumber = 1;

/** The one writer: the same commands the board sends, applied for real. */
function applyMapCommand(state: StoreState, command: MapCommand): StoreState {
  switch (command.type) {
    case "createTask":
      return {
        ...state,
        tasks: [
          ...state.tasks,
          {
            id: `t-new-${nextTaskNumber++}`,
            title: command.title,
            notes: command.notes ?? "",
            column: command.column ?? "backlog",
            links: command.links ?? {},
          },
        ],
      };
    case "deleteTask":
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== command.id),
      };
    case "updateTask":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === command.id
            ? {
                ...task,
                ...(command.title !== undefined ? { title: command.title } : {}),
                ...(command.notes !== undefined ? { notes: command.notes } : {}),
                ...(command.column !== undefined ? { column: command.column } : {}),
                ...(command.links !== undefined ? { links: command.links } : {}),
              }
            : task,
        ),
      };
    default:
      return state;
  }
}

/** A fresh snapshot each read, so `refresh` cannot be a stale object identity. */
function snapshot(): VaultSnapshot {
  return {
    rootPath: "/harness/lifequest",
    lifequest: {
      schemaVersion: 1,
      id: "harness-board",
      name: "Harness",
      createdAt: NOW,
    },
    settings: {
      hermesBaseUrl: "http://localhost:8642",
      theme: "dark",
      weekStartDay: "monday",
      autoApproveInserts: [],
    },
    domains: [DOMAIN],
    agents: [],
    decisions: [],
    log: LOG,
    map: structuredClone(mapState),
    mapError: null,
    goals: structuredClone(GOALS),
    goalsError: null,
    reviews: [],
    planning: [],
    weeklyFileCount: 0,
  };
}

type HarnessWindow = Window & {
  taskBoardReady?: boolean;
  taskBoardSkin?: string;
  taskBoardCalls?: string[];
  taskBoardUnexpectedCalls?: string[];
  taskBoardCommands?: MapCommand[];
  taskBoardTasks?: () => Task[];
};

const harness = window as HarnessWindow;
harness.taskBoardCalls = [];
harness.taskBoardUnexpectedCalls = [];
harness.taskBoardCommands = [];
harness.taskBoardTasks = () => structuredClone(mapState.tasks);

const stubs: Record<string, (...args: unknown[]) => unknown> = {
  vaultGetSnapshot: async () => ok(snapshot()),
  vaultListRecent: async () => [],
  domainGetActive: async () => "life",
  domainSetActive: async () => ok("life"),
  onVaultFileChanged: () => () => undefined,
  logList: async () => ok(LOG),
  projectsList: async () => ok({ records: PROJECTS }),
  mapApply: async (command: unknown) => {
    const typed = command as MapCommand;
    harness.taskBoardCommands!.push(typed);
    mapState = applyMapCommand(mapState, typed);
    return ok(snapshot());
  },
  // The agent composer is not exercised by this rig; it is modelled anyway so a
  // stray call is a wrong answer rather than an unmodelled bridge method.
  hermesChatTools: async () => ok({ content: "", toolCalls: [] }),
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.taskBoardCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.taskBoardUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

function Harness() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* The shell's own page scroller and padding, so the board is measured at
          the width (and with the edges) the operator's sheet actually gives it. */}
      <div className="shell__content">
        <MemoryRouter initialEntries={["/act"]}>
          <VaultProvider>
            <ActPage />
          </VaultProvider>
        </MemoryRouter>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

harness.taskBoardReady = true;
harness.taskBoardSkin = skinName;
