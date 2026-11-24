/**
 * E2E harness page for the recurring-tasks feature's SHIPPED UI.
 *
 * Two real pages are mounted here, in one MemoryRouter, so the Dashboard's
 * "Manage recurring →" link is a real navigation and not a stub:
 *
 *  - `pages/HomePage` at `/home`, drawing its real Today & this week card and
 *    its Recurring block: ONLY the overdue and due-today rows, never a record
 *    still waiting on a later day this week.
 *  - `pages/ActPage` at `/act`, drawing the real Task Manager with the real
 *    `RecurringTasksSection` and its inline editor.
 *
 * The bridge below is a recording stub in the style of `task-board.tsx`: every
 * method these pages can reach is listed; anything unmodelled is NAMED in
 * `recurringTasksUnexpectedCalls` and answered `{ ok: false }`. `mapApply`
 * really applies the recurring commands to this harness's own in-memory map
 * fixture (create/update/delete/complete), with the engine's own cadence
 * arithmetic, so "the row leaves the card", "the manager reads the advanced
 * date" and "the new row appears" are claims about the shipped read path — not
 * about a stub's bookkeeping.
 *
 * FIXTURE DATES ARE THE RUN'S OWN TODAY. The driver must hold on any day the
 * suite runs, so:
 *   - the overdue fixture is three days late,
 *   - the due-today fixture is today,
 *   - the tomorrow fixture is due tomorrow and its `recurringState()` is
 *     "this-week" on every day of the year (the vault's week start is chosen so
 *     tomorrow is always inside this week — see `weekStartDay` below). It is the
 *     card's NEGATIVE CONTROL: the card draws only overdue and due-today rows, so
 *     a record due on a later day — even tomorrow, inside this same week — is NOT
 *     owed today and must not be on the card; it appears on its own day. The
 *     Manage-recurring list still shows it, and it stays the pause/resume
 *     fixture,
 *   - the later fixture is twenty days out,
 *   - the paused fixture is due yesterday but paused,
 *   - the monthly fixture is later than this week.
 * The review fixture is computed the same way: every cadence's OPEN review
 * period (the one the app's own `openReviewPeriod` would pick) is marked done
 * EXCEPT the weekly one, so exactly one built-in review row is due. A second
 * mount with `?reviews=done` marks the weekly one done too.
 *
 * `?write=refuse` makes `mapApply` answer a refusal, for the card's own
 * "a failed write prints on the card" claim.
 *
 * Everything the driver compares against is published on
 * `window.recurringTasksExpectations`, computed from the same today — the driver
 * never hardcodes a date.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  DEFAULT_REVIEW_AVAILABILITY,
  REVIEW_CADENCES,
  formatLocalIsoDate,
  formatLocalIsoDayMonth,
  openReviewDate,
  type RecurringDueState,
  type ReviewIndexEntry,
  type VaultSnapshot,
  type WeekStartDay,
} from "@lifequest/vault-core/pure";
import {
  occurrenceOnOrAfter,
  nextOccurrenceAfter,
  recurringState,
  recurringWeekEnd,
  todayLocalIso,
  weekdayOf,
  type MapCommand,
  type Recurrence,
  type RecurringTask,
} from "@lifequest/vault-core/map";
import HomePage from "@/pages/HomePage";
import ActPage from "@/pages/ActPage";
import { VaultProvider } from "@/state/VaultProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

/** The refusal every failed write answers with under `?write=refuse`. */
const WRITE_ERROR = "The vault refused this write (harness).";

const params = new URLSearchParams(window.location.search);
const reviewsDone = params.get("reviews") === "done";
const refuseWrites = params.get("write") === "refuse";

const skinName = applyAppSkin("dark");

/** The run's local day: every fixture date is derived from this, never fixed. */
const TODAY = todayLocalIso();

/**
 * The vault's week start. The this-week fixture must exist on ANY day, and a
 * seven-day week always has a day after today EXCEPT when today is its last
 * day. So: Monday-start weeks keep Sunday as the last day, and a Sunday runs a
 * Sunday-start week (whose last day is Saturday). Tomorrow is then always in
 * the current week.
 */
const WEEK_START: WeekStartDay = weekdayOf(TODAY) === 6 ? "sunday" : "monday";
const WEEK_END = recurringWeekEnd(TODAY, WEEK_START);
const NOW = new Date();

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const TOMORROW = addDays(TODAY, 1);
const LATER_DATE = addDays(TODAY, 20);
const MONTH_DATE = occurrenceOnOrAfter({ unit: "month", dayOfMonth: 12 }, addDays(TODAY, 7));

/** The monthly fixture's day-of-month follows its own date, so it is coherent. */
const MONTH_RECURRENCE: Recurrence = { unit: "month", dayOfMonth: Number(MONTH_DATE.slice(8, 10)) };
/** The later fixture's yearly cadence points at its own date. */
const LATER_RECURRENCE: Recurrence = {
  unit: "year",
  month: Number(LATER_DATE.slice(5, 7)),
  day: Number(LATER_DATE.slice(8, 10)),
};

/**
 * The operator's records.
 *
 * Deliberately uneven: one of each cadence form, one overdue, one due today (with
 * a page link, so the card's title route is exercised on a due row), one
 * due tomorrow (the card's negative control, still listed by the manager, and
 * the pause/resume fixture), one later, one paused with a completion in its
 * history, and a monthly one so the manager's cadence sentence is exercised in
 * its "on the Nth" form. The paused record is also the one with a `Last done`
 * line.
 */
const SEED: RecurringTask[] = [
  {
    id: "r-overdue",
    title: "Water the fig tree",
    notes: "",
    recurrence: { unit: "day" },
    dueDate: addDays(TODAY, -3),
    paused: false,
    history: [],
    origin: "operator",
  },
  {
    id: "r-today",
    title: "Take the recycling out",
    notes: "",
    recurrence: { unit: "week", weekday: weekdayOf(TODAY) },
    dueDate: TODAY,
    // A due-today row that has a page: the card must render the title as a
    // link to this route, not as plain text.
    link: "/act",
    paused: false,
    history: [],
    origin: "operator",
  },
  {
    id: "r-week",
    title: "Call the accountant",
    notes: "",
    recurrence: { unit: "week", weekday: weekdayOf(TOMORROW) },
    dueDate: TOMORROW,
    paused: false,
    history: [],
    origin: "operator",
  },
  {
    id: "r-later",
    title: "Renew the passport",
    notes: "",
    recurrence: LATER_RECURRENCE,
    dueDate: LATER_DATE,
    paused: false,
    history: [],
    origin: "operator",
  },
  {
    id: "r-paused",
    title: "Review the budget",
    notes: "",
    recurrence: { unit: "week", weekday: 0 },
    dueDate: addDays(TODAY, -1),
    paused: true,
    history: [{ due: addDays(TODAY, -8), completedOn: addDays(TODAY, -8) }],
    origin: "agent",
  },
  {
    id: "r-month",
    title: "Pay the water bill",
    notes: "",
    recurrence: MONTH_RECURRENCE,
    dueDate: MONTH_DATE,
    paused: false,
    history: [],
    origin: "operator",
  },
];

/** The cadence sentence the manager and the card print. */
function cadenceLabel(recurrence: Recurrence): string {
  const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const ordinal = (day: number): string => {
    const tens = day % 100;
    if (tens >= 11 && tens <= 13) return `${day}th`;
    switch (day % 10) {
      case 1:
        return `${day}st`;
      case 2:
        return `${day}nd`;
      case 3:
        return `${day}rd`;
      default:
        return `${day}th`;
    }
  };
  switch (recurrence.unit) {
    case "day":
      return "Every day";
    case "week":
      return `Every ${weekdays[recurrence.weekday]}`;
    case "month":
      return `Every month on the ${ordinal(recurrence.dayOfMonth)}`;
    case "year":
      // The sentence has no year: "Every year on 5 Nov", as the contract pins.
      return `Every year on ${formatLocalIsoDayMonth(
        `2000-${String(recurrence.month).padStart(2, "0")}-${String(recurrence.day).padStart(2, "0")}`,
      )}`;
  }
}

/** The words a due state prints with, on the card and in the manager. */
function dueLabel(state: RecurringDueState): string {
  switch (state) {
    case "overdue":
      return "Overdue";
    case "today":
      return "Due today";
    case "this-week":
      return "This week";
  }
}

/** The live record list; `mapApply` mutates this one array. */
const mapState: { recurring: RecurringTask[] } = { recurring: structuredClone(SEED) };
let nextNewNumber = 1;

/**
 * The review index for this mount.
 *
 * Every cadence's OPEN period gets an entry. All of them are done except the
 * weekly one — the contract's "the weekly review pops up while it is unfinished"
 * case — unless `?reviews=done` asks for the "review finished, row gone" mount.
 */
function reviewIndex(): ReviewIndexEntry[] {
  return REVIEW_CADENCES.map((cadence) => {
    const open = openReviewDate(cadence, WEEK_START, DEFAULT_REVIEW_AVAILABILITY, NOW);
    const done = reviewsDone || cadence !== "weekly";
    return {
      cadence,
      period: open?.period ?? "",
      locked: false,
      scopes: { overall: { status: done ? "done" : "draft", sessionId: null } },
    };
  });
}

const REVIEW_INDEX = reviewIndex();
const WEEKLY_REVIEW_OPEN = openReviewDate("weekly", WEEK_START, DEFAULT_REVIEW_AVAILABILITY, NOW);

/**
 * The expected shipped screen, computed once from the fixture and today.
 * The driver reads this instead of re-deriving dates in its own process.
 */
const EXPECTATIONS = (() => {
  // The card draws only what is owed NOW: overdue and due today. A "this-week"
  // record (r-week, due tomorrow) is deliberately excluded — it is not drawn a
  // day early, and appears on the card only on its own day. The model still
  // answers "this-week"/"later" for the Manage-recurring editor, and
  // `dueLabel`'s exhaustive switch must keep naming that state even though this
  // card never prints it.
  const operatorDue = SEED.filter((item) => {
    const state = recurringState(item, TODAY, WEEK_START);
    return state === "overdue" || state === "today";
  }).map((item) => {
    const state = recurringState(item, TODAY, WEEK_START) as RecurringDueState;
    return {
      id: item.id,
      title: item.title,
      state,
      label: dueLabel(state),
      link: item.link ?? null,
      checkbox: true,
    };
  });

  const weeklyState: RecurringDueState =
    WEEKLY_REVIEW_OPEN && WEEKLY_REVIEW_OPEN.day === TODAY ? "today" : "overdue";
  const reviewRows = reviewsDone
    ? []
    : [
        {
          id: "review:weekly",
          title: "Weekly review",
          state: weeklyState,
          label: dueLabel(weeklyState),
          link: "/review/weekly",
          checkbox: false,
        },
      ];

  const cardRows = [...operatorDue, ...reviewRows];

  return {
    today: TODAY,
    weekStartDay: WEEK_START,
    weekEnd: WEEK_END,
    now: NOW.toISOString(),
    reviewsDone,
    refuseWrites,
    writeError: WRITE_ERROR,
    card: {
      count: cardRows.length,
      rows: cardRows,
      // The negative control, published so the driver can query its row by id:
      // due tomorrow ("this-week"), so the card must NOT draw it, even though
      // the manager still lists it. Exactly id/title/dueDate.
      tomorrow: {
        id: "r-week",
        title: (SEED.find((item) => item.id === "r-week") as RecurringTask).title,
        dueDate: TOMORROW,
      },
      absentIds: SEED.filter((item) => !operatorDue.some((row) => row.id === item.id)).map(
        (item) => item.id,
      ),
      manage: { testId: "today-week-recurring-manage", text: "Manage recurring →", href: "/act?manage=recurring" },
    },
    review: {
      id: "review:weekly",
      title: "Weekly review",
      link: "/review/weekly",
      expected: !reviewsDone,
    },
    manager: {
      count: SEED.length,
      rows: SEED.map((item) => {
        const state = recurringState(item, TODAY, WEEK_START);
        const last = item.history[0];
        return {
          id: item.id,
          title: item.title,
          cadence: cadenceLabel(item.recurrence),
          dueIso: item.dueDate,
          dueLabel: `Next due ${formatLocalIsoDate(item.dueDate)}`,
          paused: item.paused,
          dueState: state === "overdue" || state === "today" ? dueLabel(state) : null,
          lastDone: last ? `Last done ${formatLocalIsoDate(last.completedOn)}` : null,
        };
      }),
    },
    tick: {
      id: "r-today",
      // A weekly record due today, completed today: next due is one week on.
      afterDueIso: nextOccurrenceAfter({ unit: "week", weekday: weekdayOf(TODAY) }, TODAY),
      afterDueLabel: `Next due ${formatLocalIsoDate(
        nextOccurrenceAfter({ unit: "week", weekday: weekdayOf(TODAY) }, TODAY),
      )}`,
    },
    create: {
      title: "Water the herb garden",
      cadenceLabel: "Weekly",
      weekdayLabel: "Monday",
      recurrence: { unit: "week", weekday: 0 } as Recurrence,
      dueIso: occurrenceOnOrAfter({ unit: "week", weekday: 0 }, TODAY),
      dueLabel: `Next due ${formatLocalIsoDate(occurrenceOnOrAfter({ unit: "week", weekday: 0 }, TODAY))}`,
    },
    pause: { id: "r-week" },
    delete: { id: "r-later", title: "Renew the passport" },
  };
})();

/** The immutable shell of the snapshot; only `map.recurring` moves. */
function snapshot(): VaultSnapshot {
  return {
    rootPath: "/harness/lifequest",
    lifequest: {
      schemaVersion: 1,
      id: "harness-recurring",
      name: "Harness",
      createdAt: "2020-06-15T12:00:00.000Z",
    },
    settings: {
      hermesBaseUrl: "http://localhost:8642",
      theme: "dark",
      weekStartDay: WEEK_START,
      autoApproveInserts: [],
      chatQuestions: [],
      decisionInbox: { autoOpen: false, autoClose: false },
      reviewAvailability: DEFAULT_REVIEW_AVAILABILITY,
      agentScopes: [],
    },
    domains: [],
    agents: [],
    decisions: [],
    log: [],
    map: {
      dayTypes: [],
      defaultWeek: {
        dayTypeByWeekday: [null, null, null, null, null, null, null],
        weeklyItems: [],
      },
      years: [],
      tasks: [],
      recurring: structuredClone(mapState.recurring),
      liveDays: {},
      aboutMe: "",
    },
    mapError: null,
    goals: [],
    goalsError: null,
    reviews: REVIEW_INDEX,
    planning: [],
    weeklyFileCount: 0,
    onboarding: {
      status: "completed",
      startedAt: "2020-06-15T12:00:00.000Z",
      completedAt: "2020-06-15T12:00:00.000Z",
      unlockedAreas: [],
    },
    onboardingProposal: null,
  } as unknown as VaultSnapshot;
}

type ApplyResult = Result<VaultSnapshot>;

/** The engine's own rules, applied to this harness's in-memory record list. */
function applyRecurring(command: MapCommand): ApplyResult {
  switch (command.type) {
    case "createRecurring": {
      const item: RecurringTask = {
        id: `r-new-${nextNewNumber++}`,
        title: command.title.trim(),
        notes: command.notes ?? "",
        recurrence: command.recurrence,
        dueDate: command.dueDate ?? occurrenceOnOrAfter(command.recurrence, TODAY),
        paused: false,
        history: [],
        origin: "operator",
      };
      if (command.link) item.link = command.link;
      mapState.recurring.push(item);
      return ok(snapshot());
    }
    case "updateRecurring": {
      const item = mapState.recurring.find((entry) => entry.id === command.id);
      if (!item) return { ok: false, error: "Recurring task not found." };
      if (command.title !== undefined) item.title = command.title.trim();
      if (command.notes !== undefined) item.notes = command.notes;
      if (command.paused !== undefined) item.paused = command.paused;
      if (command.link !== undefined) {
        if (command.link === "") delete item.link;
        else item.link = command.link;
      }
      if (command.recurrence !== undefined) item.recurrence = command.recurrence;
      if (command.dueDate !== undefined) {
        item.dueDate = command.dueDate;
      } else if (command.recurrence !== undefined) {
        const floor = item.dueDate > TODAY ? item.dueDate : TODAY;
        item.dueDate = occurrenceOnOrAfter(command.recurrence, floor);
      }
      return ok(snapshot());
    }
    case "deleteRecurring": {
      const index = mapState.recurring.findIndex((entry) => entry.id === command.id);
      if (index < 0) return { ok: false, error: "Recurring task not found." };
      mapState.recurring.splice(index, 1);
      return ok(snapshot());
    }
    case "completeRecurring": {
      const item = mapState.recurring.find((entry) => entry.id === command.id);
      if (!item) return { ok: false, error: "Recurring task not found." };
      if (item.paused) return { ok: false, error: "A paused recurring task is not due." };
      const floor = item.dueDate > TODAY ? item.dueDate : TODAY;
      item.history = [
        { due: item.dueDate, completedOn: TODAY },
        ...item.history,
      ].slice(0, 12);
      item.dueDate = nextOccurrenceAfter(item.recurrence, floor);
      return ok(snapshot());
    }
    default:
      return { ok: false, error: `unsupported map command: ${String(command.type)}` };
  }
}

type HarnessWindow = Window & {
  recurringTasksReady?: boolean;
  recurringTasksSkin?: string;
  recurringTasksCalls?: string[];
  recurringTasksUnexpectedCalls?: string[];
  recurringTasksCommands?: MapCommand[];
  recurringTasksExpectations?: typeof EXPECTATIONS;
  recurringTasksState?: () => { recurring: RecurringTask[] };
};

const harness = window as HarnessWindow;
harness.recurringTasksCalls = [];
harness.recurringTasksUnexpectedCalls = [];
harness.recurringTasksCommands = [];
harness.recurringTasksExpectations = EXPECTATIONS;
harness.recurringTasksState = () => structuredClone(mapState);

const stubs: Record<string, (...args: unknown[]) => unknown> = {
  // Every read answer below is a FRESH object, like the real IPC bridge: the
  // page compares snapshots by identity, so a stable object would make a refresh
  // that changed the store look like a no-op.
  vaultGetSnapshot: async () => ok(snapshot()),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  domainSetActive: async () => ok(null),
  onVaultFileChanged: () => () => undefined,
  onVaultDataChanged: () => () => undefined,
  decisionList: async () => ok([]),
  logList: async () => ok([]),
  // The one pinned card this rig judges: Today & this week, which carries the
  // Recurring block.
  pinsList: async () =>
    ok({
      pins: [{ id: "sys:today-week", kind: "system", system: "today-week" }],
      locked: false,
    }),
  pageList: async () => ok([]),
  viewList: async () => ok([]),
  kitList: async () => ok([]),
  projectsList: async () => ok({ records: [] }),
  deadlineGetDismissed: async () => ok(false),
  deadlineMaybeNotify: async () => ok(null),
  deadlineDismiss: async () => ok(true),
  goalsApply: async () => ok({}),
  briefGet: async () => ({ ok: false, error: "no companion brief in this harness" }),
  briefDismiss: async () => ok(true),
  companionSessionCreate: async () => ({ ok: false, error: "no chats in this harness" }),
  hermesChatTools: async () => ok({ content: "", toolCalls: [] }),
  mapApply: async (command: unknown) => {
    const typed = command as MapCommand;
    harness.recurringTasksCommands!.push(typed);
    if (refuseWrites) return { ok: false, error: WRITE_ERROR };
    return applyRecurring(typed);
  },
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.recurringTasksCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.recurringTasksUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

function Harness() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* The shell's own page scroller and padding: the Act page's
          `?manage=recurring` scroll lands inside the same scrollport the
          operator's sheet gives it, not a bare window. */}
      <div className="shell__content">
        <MemoryRouter initialEntries={["/home"]}>
          <VaultProvider>
            <ChatDockProvider>
              <Routes>
                <Route path="/home" element={<HomePage />} />
                <Route path="/act" element={<ActPage />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </ChatDockProvider>
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

harness.recurringTasksReady = true;
harness.recurringTasksSkin = skinName;
