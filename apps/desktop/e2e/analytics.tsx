/**
 * E2E harness for the Analytics page, driven by `analytics.electron.mjs`.
 *
 * The real shell, the real page and the real stylesheet render here, so what the
 * driver reads is what the operator gets. Only the IPC bridge is stubbed, and it
 * is a *recording* stub: every method the page calls is modelled and anything
 * else answers `{ ok: false }` and is NAMED in `analyticsRigUnexpectedCalls`, so
 * a page that grows a dependency this rig does not model fails the run loudly.
 *
 * The stub is also the *vault*: `analyticsMatrix` answers from the fixture's
 * metric definitions and event rows, and `metricEvents` / `metricLogEvent` /
 * `metricDefine` / `dbUpsertRow` / `dbDeleteRow` mutate exactly those rows. So
 * "the matrix reloaded with the new number" is a claim about the data the page
 * re-read through the bridge, not about a call that happened.
 *
 * ── How this can fail (written before the assertions) ─────────────────────────
 *
 *  1. The route is not the literal `/review/analytics`: the dynamic
 *     `/review/:cadence` wins, and the page is a review of a cadence called
 *     "analytics".
 *  2. The rail row is not in the Review wing, is not after Yearly, or routes
 *     somewhere other than the matrix.
 *  3. The matrix is not 8 period columns labelled by the engine, or the labels
 *     are the page's own (a re-derived "Week 1" instead of the served label).
 *  4. The Life lens is not every area: only one area group draws, or an area the
 *     matrix did not name appears.
 *  5. The Finance lens leaks another area's rows in (a page that filters by
 *     `label` or keeps the old rows while refetching).
 *  6. A formatted value is re-formatted by the page: `1,234.56 (ZAR)` becomes a
 *     raw `-1234.56`, so Cash out (whose magnitude is display-only) prints the
 *     sign it spent.
 *  7. A no-data cell is drawn as a fabricated zero instead of the marker, or a
 *     delta appears beside it.
 *  8. A cadence switch reuses the old periods: the grid relabels nothing, or it
 *     asks the engine for weekly columns under a monthly heading.
 *  9. A period header link loses the `?period=` binding (or the area lens's
 *     `&scope=`), so the operator lands on the wrong review page.
 * 10. An events cell opens no panel, asks for the wrong period, lists rows from
 *     another window, or offers no way back to that period's review.
 * 11. Editing a row writes through the wrong path: no `dbUpsertRow`, the wrong
 *     area/database, no column ids from the events response, or the `metric`
 *     cell does not carry the event key — the row would vanish from its metric.
 * 12. Deleting a row calls the wrong path, or the list does not reload.
 * 13. Logging an event does not call `metricLogEvent`, or neither the panel nor
 *     the matrix picks the new row up.
 * 14. A derived cell does not open its source database at
 *     `/data/<area>/<databaseId>`.
 * 15. The New metric form does not call `metricDefine` with the fixed payload
 *     (id/eventKey slugged from the label), or the new row does not appear.
 * 16. Ask-companion invents a transport instead of the app's prepared-chat door
 *     (or sends no kickoff), so the operator's chat is empty.
 * 17. A lens with no definitions shows an empty grid instead of the empty state.
 * 18. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *
 * ── How to read this file ────────────────────────────────────────────────────
 *
 * `FIXTURE` is the data. `matrixFor()` projects it the way the engine does: an
 * `AnalyticsMatrix` whose periods end at the cadence's current period (the same
 * `currentPeriod` / `periodBounds` / `periodLabel` helpers the engine uses, so
 * the labels are genuinely the engine's), whose cells carry the displayed value
 * and the signed change from the column before, and whose rows are grouped by
 * area in vault order. `bridge` is the recording stub over it.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type {
  AnalyticsCell,
  AnalyticsMatrix,
  AnalyticsMetricRow,
  AnalyticsPeriod,
  MetricEventRow,
  MetricEvents,
  ReviewCadence,
  VaultSnapshot,
} from "@lifequest/vault-core/pure";
import {
  currentPeriod,
  DEFAULT_REVIEW_AVAILABILITY,
  periodBounds,
  periodLabel,
  previousPeriod,
  shiftLocalIsoDate,
} from "@lifequest/vault-core/pure";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import AnalyticsPage from "@/pages/AnalyticsPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import type { HermesSession } from "@/vite-env";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

const WEEK_START_DAY = "monday" as const;

/** The live areas this vault shows, in its own order. `spirit` is locked below. */
const AREAS = [
  { slug: "health", name: "Health", sortOrder: 1 },
  { slug: "mind", name: "Mind", sortOrder: 2 },
  { slug: "financial", name: "Finance", sortOrder: 3 },
  { slug: "business", name: "Business", sortOrder: 4 },
  { slug: "relationships", name: "Relationships", sortOrder: 5 },
] as const;
const LOCKED_AREA = { slug: "spirit", name: "Spirit", sortOrder: 6 } as const;
const AREA_NAME = new Map<string, string>(AREAS.map((area) => [area.slug, area.name]));

/* ── the periods, computed with the engine's own rules ──────────────────────── */

/**
 * The last `count` periods of a cadence, oldest first, ending at the cadence's
 * CURRENT period — the engine's own rule. Using `periodLabel` keeps the header
 * text the engine's (`12-18 Oct '26 (W42)` for a week), so the rig cannot pass
 * while drawing a label the real matrix would not serve.
 */
function periodsFor(cadence: ReviewCadence, count = 8): AnalyticsPeriod[] {
  const periods: AnalyticsPeriod[] = [];
  let cursor = currentPeriod(cadence, WEEK_START_DAY);
  for (let index = 0; index < count; index += 1) {
    const bounds = periodBounds(cadence, cursor, WEEK_START_DAY);
    if (!bounds.ok) throw new Error(bounds.error);
    periods.push({
      period: cursor,
      label: periodLabel(cadence, cursor, WEEK_START_DAY),
      start: bounds.value.start,
      end: bounds.value.end,
    });
    const previous = previousPeriod(cadence, cursor, WEEK_START_DAY);
    if (!previous.ok) throw new Error(previous.error);
    cursor = previous.value;
  }
  return periods.reverse();
}

const WEEKLY_PERIODS = periodsFor("weekly");
const MONTHLY_PERIODS = periodsFor("monthly");
const QUARTERLY_PERIODS = periodsFor("quarterly");
const YEARLY_PERIODS = periodsFor("yearly");
const LAST_WEEK = WEEKLY_PERIODS[WEEKLY_PERIODS.length - 1]!;

/* ── number formatting, the engine's rules ──────────────────────────────────── */

/**
 * `formatMetricNumber` from `review-figures.ts`, re-stated here because that
 * module is engine-side (it imports the vault's node modules) and this page only
 * has the browser-safe entry. The rules that matter to the rig: group thousands,
 * round to `decimals`, trim trailing zeros, and never print `-0`.
 */
function metricNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0";
  const max = Math.min(Math.max(Math.trunc(decimals), 0), 6);
  const rounded = Number(Math.abs(value).toFixed(max));
  const [whole, fraction] = rounded.toFixed(max).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed =
    fraction && /[1-9]/.test(fraction)
      ? `${grouped}.${fraction.replace(/0+$/, "")}`
      : grouped;
  return `${value < 0 && rounded !== 0 ? "-" : ""}${trimmed}`;
}

/** The unit suffix the engine prints: ` (ZAR)` for a currency code, ` minutes` else. */
function unitSuffix(unit: string): string {
  const trimmed = unit.trim();
  if (!trimmed) return "";
  if (/^[A-Z]{3}$/.test(trimmed)) return ` (${trimmed})`;
  return ` ${trimmed}`;
}

function valueTextOf(value: number, unit: string, decimals = 2): string {
  // `magnitude: abs` is applied by the engine before this; the fixture stores
  // the DISPLAYED number (Cash out is positive though the ledger is negative).
  return `${metricNumber(value, decimals)}${unitSuffix(unit)}`;
}

function deltaTextOf(delta: number, decimals = 2): string {
  const text = metricNumber(Math.abs(delta), decimals);
  if (delta > 0) return `+${text}`;
  if (delta < 0) return `-${text}`;
  return text;
}

/**
 * One row's cells: a null value is the no-data cell, and a delta exists only
 * when BOTH this column and the column before it have a value.
 */
function cellsFor(
  periods: AnalyticsPeriod[],
  values: Array<number | null>,
  unit: string,
  decimals = 2,
): AnalyticsCell[] {
  return periods.map((period, index) => {
    const shown = values[index] ?? null;
    const previous = index > 0 ? (values[index - 1] ?? null) : null;
    return {
      period: period.period,
      start: period.start,
      end: period.end,
      valueText: shown === null ? null : valueTextOf(shown, unit, decimals),
      deltaText:
        shown !== null && previous !== null
          ? deltaTextOf(shown - previous, decimals)
          : null,
    };
  });
}

/* ── the events a panel lists and edits ─────────────────────────────────────── */

/**
 * The events behind the Training sessions metric. Two rows in the CURRENT week
 * (they sum to its matrix cell), so the panel has something to list, edit and
 * delete; logging one more is what the reload leg watches for.
 */
type StoredEvent = MetricEventRow;

/** The minted column ids the real metrics database would hand the panel. */
const EVENT_COLUMNS = {
  date: "8f2c1a40-3b91-4d0e-9a77-0c5e6d7f8a01",
  metric: "8f2c1a40-3b91-4d0e-9a77-0c5e6d7f8a02",
  value: "8f2c1a40-3b91-4d0e-9a77-0c5e6d7f8a03",
  note: "8f2c1a40-3b91-4d0e-9a77-0c5e6d7f8a04",
} as const;

let events: StoredEvent[] = [
  {
    rowId: "event-1",
    date: shiftLocalIsoDate(LAST_WEEK.start, 1) ?? LAST_WEEK.start,
    value: 2,
    note: "Morning run",
  },
  {
    rowId: "event-2",
    date: shiftLocalIsoDate(LAST_WEEK.start, 4) ?? LAST_WEEK.start,
    value: 1,
    note: "Gym session",
  },
];
let nextEventNumber = 3;

/** The definition each events metric compiles to: the `metric` cell's value. */
const EVENT_KEYS: Record<string, string> = {
  "training-sessions": "training-sessions",
  "prayer-minutes": "prayer-minutes",
};

/* ── the fixture's definitions ──────────────────────────────────────────────── */

type FixtureRow = {
  areaSlug: string;
  metricId: string;
  label: string;
  unit: string;
  source: "derived" | "events";
  aggregation: "sum" | "count" | "last" | "avg";
  direction: "higher-is-better" | "lower-is-better" | "neutral" | null;
  target: number | null;
  databaseId: string | null;
  cells: AnalyticsCell[];
};

/** The week's training sessions: six weeks of history, then this week's events. */
function trainingWeeklyValues(): Array<number | null> {
  const inThisWeek = events.filter(
    (row) => row.date >= LAST_WEEK.start && row.date <= LAST_WEEK.end,
  );
  const thisWeek = inThisWeek.length
    ? inThisWeek.reduce((sum, row) => sum + row.value, 0)
    : null;
  return [3, null, 4, 2, null, 3, 5, thisWeek];
}

const CASH_IN_WEEKLY = [3200, 4100, 5000, 4800, 3900, 4500, 5000, 4600];
/** Displayed magnitudes: the ledger's negatives with `magnitude: abs` applied. */
const CASH_OUT_WEEKLY = [980.1, 1234.56, 1120, 1500, 990, 1350, 1280, 1234.56];
const NET_WEEKLY = CASH_IN_WEEKLY.map((value, index) => value - CASH_OUT_WEEKLY[index]!);

const CASH_IN_MONTHLY = [15000, 18000, 21000, 19500, 16000, 20500, 22000, 24000];
const CASH_OUT_MONTHLY = [4200.1, 5100.5, 4800, 6000, 3900, 5500, 4900, 6100.25];
const NET_MONTHLY = CASH_IN_MONTHLY.map(
  (value, index) => value - CASH_OUT_MONTHLY[index]!,
);

/** Rows the New metric form adds when it calls `metricDefine`. */
type DefinedMetric = {
  areaSlug: string;
  metricId: string;
  label: string;
  unit: string;
  aggregation: "sum" | "count" | "last" | "avg";
  target: number | null;
};
let definedMetrics: DefinedMetric[] = [];

function trainingRow(periods: AnalyticsPeriod[], values: Array<number | null>): FixtureRow {
  return {
    areaSlug: "health",
    metricId: "training-sessions",
    label: "Training sessions",
    unit: "sessions",
    source: "events",
    aggregation: "count",
    direction: "higher-is-better",
    target: 4,
    databaseId: null,
    cells: cellsFor(periods, values, "sessions", 0),
  };
}

function financeRows(periods: AnalyticsPeriod[]): FixtureRow[] {
  const monthly = periods === MONTHLY_PERIODS;
  const cashIn = monthly ? CASH_IN_MONTHLY : CASH_IN_WEEKLY;
  const cashOut = monthly ? CASH_OUT_MONTHLY : CASH_OUT_WEEKLY;
  const net = monthly ? NET_MONTHLY : NET_WEEKLY;
  const row = (
    metricId: string,
    label: string,
    values: number[],
  ): FixtureRow => ({
    areaSlug: "financial",
    metricId,
    label,
    unit: "ZAR",
    source: "derived",
    aggregation: "sum",
    direction: "neutral",
    target: null,
    databaseId: "finance:transactions",
    cells: cellsFor(periods, values, "ZAR", 2),
  });
  return [
    row("cash-in", "Cash in", cashIn),
    row("cash-out", "Cash out", cashOut),
    row("net-cash-flow", "Net cash flow (transfers included)", net),
  ];
}

/** The rows for one cadence + lens, in vault order: Health first, then Finance. */
function rowsFor(cadence: ReviewCadence, lens: string | null): AnalyticsMetricRow[] {
  const periods =
    cadence === "weekly"
      ? WEEKLY_PERIODS
      : cadence === "monthly"
        ? MONTHLY_PERIODS
        : cadence === "quarterly"
          ? QUARTERLY_PERIODS
          : YEARLY_PERIODS;
  // Every cadence answers here; the empty read is the MIND lens, an area with no
  // definitions, which is the real empty case §10.5 describes (a lens whose
  // areas have nothing to show), not a cadence the fixture happens to skip.
  const fixtureRows: FixtureRow[] = [
    trainingRow(
      periods,
      cadence === "weekly" ? trainingWeeklyValues() : MONTHLY_TRAINING,
    ),
    ...financeRows(periods),
  ];
  for (const defined of definedMetrics) {
    fixtureRows.push({
      areaSlug: defined.areaSlug,
      metricId: defined.metricId,
      label: defined.label,
      unit: defined.unit,
      source: "events",
      aggregation: defined.aggregation,
      direction: null,
      target: defined.target,
      databaseId: null,
      cells: cellsFor(periods, periods.map(() => null), defined.unit, 2),
    });
  }
  const visible = lens === null ? fixtureRows : fixtureRows.filter((row) => row.areaSlug === lens);
  return visible.map((row) => ({
    areaSlug: row.areaSlug,
    areaName: AREA_NAME.get(row.areaSlug) ?? row.areaSlug,
    metricId: row.metricId,
    label: row.label,
    unit: row.unit,
    source: row.source,
    aggregation: row.aggregation,
    direction: row.direction,
    target: row.target,
    databaseId: row.databaseId,
    cells: row.cells.map((cell) => ({ ...cell })),
  }));
}

const MONTHLY_TRAINING: Array<number | null> = [12, 15, 11, 14, 13, 16, 15, 18];

/** One matrix answer, freshly built so the page can never alias the fixture. */
function matrixFor(cadence: ReviewCadence, lens: string | null): AnalyticsMatrix {
  const periods =
    cadence === "weekly"
      ? WEEKLY_PERIODS
      : cadence === "monthly"
        ? MONTHLY_PERIODS
        : cadence === "quarterly"
          ? QUARTERLY_PERIODS
          : YEARLY_PERIODS;
  return {
    cadence,
    lens,
    periods: periods.map((period) => ({ ...period })),
    rows: rowsFor(cadence, lens),
    problems: [],
    asOf: "2026-11-27T15:00:00.000Z",
  };
}

/** One events answer for a period window, from the mutated row store. */
function eventsFor(
  area: string,
  metricId: string,
  start: string,
  end: string,
): MetricEvents {
  const defined = definedMetrics.find(
    (row) => row.areaSlug === area && row.metricId === metricId,
  );
  const eventKey = EVENT_KEYS[metricId] ?? defined?.metricId;
  if (!eventKey) {
    throw new Error(`not an events metric: ${metricId}`);
  }
  return {
    areaSlug: area,
    metricId,
    eventKey,
    databaseId: "metrics",
    columns: { ...EVENT_COLUMNS },
    rows: events
      .filter((row) => row.date >= start && row.date <= end)
      .map((row) => ({ ...row })),
  };
}

/* ── the vault's change signal, played by the rig ────────────────────────────── */

/**
 * The page cannot see a mutation that happens behind `dbUpsertRow` etc. except
 * through main's `vault:dataChanged`. This is that announcement: the stub
 * registers the listeners, and every modelled write fires them after it has
 * landed, exactly as main does once the IPC call has settled.
 */
const dataChangeListeners = new Set<(revision: number) => void>();
let dataRevision = 0;

function announceDataChanged(): number {
  dataRevision += 1;
  for (const listener of [...dataChangeListeners]) {
    try {
      listener(dataRevision);
    } catch {
      // A listener's failure is its own; the change it heard about still landed.
    }
  }
  return dataRevision;
}

/* ── the shell's vault snapshot ─────────────────────────────────────────────── */

const UNLOCKED_AT = "2026-02-01T00:00:00.000Z";

function domainRecord(
  slug: string,
  name: string,
  sortOrder: number,
  unlockedAt: string | null,
): VaultSnapshot["domains"][number] {
  return {
    slug,
    meta: {
      name,
      description: null,
      color: null,
      sortOrder,
      archivedAt: null,
      unlockedAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {} as VaultSnapshot["domains"][number]["documents"],
  };
}

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "analytics-rig-vault",
    name: "Analytics Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
    reviewAvailability: DEFAULT_REVIEW_AVAILABILITY,
  },
  domains: [
    domainRecord("life", "Life", 0, UNLOCKED_AT),
    ...AREAS.map((area) => domainRecord(area.slug, area.name, area.sortOrder, UNLOCKED_AT)),
    // On disk and deliberately locked: the matrix must never name an area the
    // operator cannot see, and the lens cannot move to it.
    domainRecord(LOCKED_AREA.slug, LOCKED_AREA.name, LOCKED_AREA.sortOrder, null),
  ],
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

/* ── the chat gateway, as the dock reads it ─────────────────────────────────── */

function chatRow(id: string, title: string, lastActive: number): HermesSession {
  return {
    id,
    title,
    preview: null,
    lastActive,
    pinned: false,
    archived: false,
    model: null,
    source: "desktop",
  };
}

const SESSION = chatRow("analytics-rig-session", "Weekly spending check", 1_700_000_000);
const gatewaySessions: HermesSession[] = [SESSION];
let sessionsMade = 0;

function madeSession(title: string): HermesSession {
  sessionsMade += 1;
  const row = chatRow(
    `analytics-rig-session-${sessionsMade}`,
    title,
    1_700_000_000 + sessionsMade,
  );
  gatewaySessions.push(row);
  return row;
}

/* ── the harness surface the driver reads ───────────────────────────────────── */

type MatrixInput = { cadence: string; lens: string | null; count?: number };
type EventsInput = { area: string; metricId: string; start: string; end: string };
type LogInput = {
  area: string;
  metricId: string;
  date?: string;
  value?: number;
  note?: string;
};
type DefineInput = {
  area: string;
  definition: {
    id: string;
    label: string;
    unit: string;
    source: "events";
    aggregation: "sum" | "count" | "last" | "avg";
    eventKey: string;
    target?: number | null;
    direction?: string | null;
  };
};
type DbCall =
  | {
      kind: "upsert";
      slug: string;
      dbId: string;
      input: { id?: string; cells: Record<string, unknown> };
    }
  | { kind: "delete"; slug: string; dbId: string; rowId: string };

type HarnessWindow = Window & {
  analyticsRigReady?: boolean;
  analyticsRigSkin?: string;
  analyticsRigGoto?: (path: string) => void;
  /** The MemoryRouter location as one string, e.g. `/review/analytics`. */
  analyticsRigLocation?: string;
  /** The last destination the derived-cell leg navigated to, with route params. */
  analyticsRigRoute?: { pathname: string; slug: string; dbId: string } | null;
  analyticsRigCalls?: string[];
  analyticsRigUnexpectedCalls?: string[];
  analyticsRigMatrixInputs?: MatrixInput[];
  analyticsRigEventsInputs?: EventsInput[];
  analyticsRigLogInputs?: LogInput[];
  analyticsRigDefineInputs?: DefineInput[];
  analyticsRigDbCalls?: DbCall[];
  /** Every kickoff turn the dock sent (the ask-companion prompt). */
  analyticsRigKickoffs?: string[];
  analyticsRigSessions?: () => HermesSession[];
  /** The fixture the page should be drawing, for the driver to compare with. */
  analyticsRigExpected?: {
    weekly: AnalyticsPeriod[];
    monthly: AnalyticsPeriod[];
    eventColumns: typeof EVENT_COLUMNS;
  };
  analyticsRigEventColumns?: () => typeof EVENT_COLUMNS;
  analyticsRigEvents?: () => StoredEvent[];
  analyticsRigDefinedMetrics?: () => DefinedMetric[];
  analyticsRigDataListenerCount?: () => number;
  analyticsRigAnnounceDataChange?: () => number;
};

const harness = window as HarnessWindow;
harness.analyticsRigCalls = [];
harness.analyticsRigUnexpectedCalls = [];
harness.analyticsRigMatrixInputs = [];
harness.analyticsRigEventsInputs = [];
harness.analyticsRigLogInputs = [];
harness.analyticsRigDefineInputs = [];
harness.analyticsRigDbCalls = [];
harness.analyticsRigKickoffs = [];
harness.analyticsRigLocation = "/review/analytics";
harness.analyticsRigRoute = null;
harness.analyticsRigSessions = () => gatewaySessions.map((row) => ({ ...row }));
harness.analyticsRigExpected = {
  weekly: WEEKLY_PERIODS.map((period) => ({ ...period })),
  monthly: MONTHLY_PERIODS.map((period) => ({ ...period })),
  eventColumns: { ...EVENT_COLUMNS },
};
harness.analyticsRigEventColumns = () => ({ ...EVENT_COLUMNS });
harness.analyticsRigEvents = () => events.map((row) => ({ ...row }));
harness.analyticsRigDefinedMetrics = () => definedMetrics.map((row) => ({ ...row }));
harness.analyticsRigDataListenerCount = () => dataChangeListeners.size;
harness.analyticsRigAnnounceDataChange = () => announceDataChanged();

/* ── the bridge: every method the page is allowed to reach ──────────────────── */

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  /**
   * The vault's change signal, as preload exposes it. The page subscribes here
   * to hear about a write it did not make through its own bridge call (the
   * companion logging an event, say); every modelled write fires it after the
   * data has moved, as main does.
   */
  onVaultDataChanged: (cb: (revision: number) => void) => {
    dataChangeListeners.add(cb);
    return () => {
      dataChangeListeners.delete(cb);
    };
  },
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  companionSessionsList: () => ok(gatewaySessions.map((row) => ({ ...row }))),
  companionSessionCreate: (title: string) => ok(madeSession(title)),
  companionSessionMessages: () => ok([]),
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  /**
   * The dock sends a prepared chat's kickoff as its first turn. The turn is
   * accepted and recorded; no stream events are emitted (this rig is about the
   * page that asked for the chat, not about the chat's every frame).
   */
  companionChatStream: (payload: { sessionId: string; input: string }) => {
    harness.analyticsRigCalls?.push(`companionChatStream:${payload.sessionId}`);
    harness.analyticsRigKickoffs?.push(payload.input);
    return Promise.resolve({ ok: true } as const);
  },
  pinsList: () => ok({ pins: [], locked: false }),
  decisionList: () => ok([]),
  onCompanionStream: () => () => {},
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  onThemesChanged: () => () => {},
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },

  /* ── the Analytics page's own reads and writes ──────────────────────────── */

  analyticsMatrix: (input: MatrixInput) => {
    const name = `analyticsMatrix:${input.cadence}:${input.lens ?? "life"}`;
    harness.analyticsRigCalls?.push(name);
    harness.analyticsRigMatrixInputs?.push({ ...input });
    const cadence = input.cadence as ReviewCadence;
    return Promise.resolve(ok(matrixFor(cadence, input.lens)));
  },
  metricEvents: (input: EventsInput) => {
    harness.analyticsRigCalls?.push(
      `metricEvents:${input.area}:${input.metricId}:${input.start}:${input.end}`,
    );
    harness.analyticsRigEventsInputs?.push({ ...input });
    let matrix: MetricEvents;
    try {
      matrix = eventsFor(input.area, input.metricId, input.start, input.end);
    } catch (error) {
      return Promise.resolve(fail(error instanceof Error ? error.message : String(error)));
    }
    return Promise.resolve(ok(matrix));
  },
  metricLogEvent: (input: LogInput) => {
    harness.analyticsRigCalls?.push(
      `metricLogEvent:${input.area}:${input.metricId}:${input.date ?? "today"}`,
    );
    harness.analyticsRigLogInputs?.push({ ...input });
    if (!EVENT_KEYS[input.metricId] && !definedMetrics.some((row) => `${row.areaSlug}:${row.metricId}` === `${input.area}:${input.metricId}`)) {
      return Promise.resolve(fail(`Unknown events metric: ${input.metricId}`));
    }
    const row: StoredEvent = {
      rowId: `event-${nextEventNumber}`,
      date: input.date ?? (WEEKLY_PERIODS[WEEKLY_PERIODS.length - 1]!.start),
      value: typeof input.value === "number" && Number.isFinite(input.value) ? input.value : 1,
      note: input.note ?? "",
    };
    nextEventNumber += 1;
    events = [...events, row];
    announceDataChanged();
    return Promise.resolve(ok({ ...row }));
  },
  metricDefine: (input: DefineInput) => {
    harness.analyticsRigCalls?.push(`metricDefine:${input.area}:${input.definition.id}`);
    harness.analyticsRigDefineInputs?.push({
      area: input.area,
      definition: { ...input.definition },
    });
    if (definedMetrics.some((row) => row.metricId === input.definition.id)) {
      return Promise.resolve(fail(`A metric with id ${input.definition.id} already exists`));
    }
    const definition = {
      ...input.definition,
      schemaVersion: 1 as const,
      domainSlug: input.area,
      direction: input.definition.direction ?? null,
      target: input.definition.target ?? null,
      formatting: null,
      createdBy: "user" as const,
      createdAt: "2026-11-27T15:00:00.000Z",
      updatedAt: "2026-11-27T15:00:00.000Z",
    };
    definedMetrics = [
      ...definedMetrics,
      {
        areaSlug: input.area,
        metricId: definition.id,
        label: definition.label,
        unit: definition.unit,
        aggregation: definition.aggregation,
        target: definition.target,
      },
    ];
    announceDataChanged();
    return Promise.resolve(ok(definition));
  },
  dbUpsertRow: (
    slug: string,
    dbId: string,
    input: { id?: string; cells: Record<string, unknown> },
  ) => {
    harness.analyticsRigCalls?.push(`dbUpsertRow:${slug}:${dbId}:${input.id ?? "new"}`);
    harness.analyticsRigDbCalls?.push({ kind: "upsert", slug, dbId, input });
    if (dbId !== "metrics") {
      return Promise.resolve(fail(`Unknown database: ${dbId}`));
    }
    const target = events.find((row) => row.rowId === input.id);
    if (!target) return Promise.resolve(fail(`Row not found: ${input.id ?? "(new)"}`));
    const cells = input.cells;
    const date = cells[EVENT_COLUMNS.date];
    const metric = cells[EVENT_COLUMNS.metric];
    const value = cells[EVENT_COLUMNS.value];
    const note = cells[EVENT_COLUMNS.note];
    if (typeof date === "string") target.date = date;
    // The metric cell must keep carrying the event key; the panel sends it so a
    // standard row edit cannot move the row out of its metric. The rig records
    // it (the driver asserts it) and leaves the row where it is.
    void metric;
    if (typeof value === "number") target.value = value;
    else if (typeof value === "string" && value.trim() !== "") target.value = Number(value);
    if (typeof note === "string") target.note = note;
    announceDataChanged();
    return Promise.resolve(ok({ id: target.rowId, cells: { ...cells } }));
  },
  dbDeleteRow: (slug: string, dbId: string, rowId: string) => {
    harness.analyticsRigCalls?.push(`dbDeleteRow:${slug}:${dbId}:${rowId}`);
    harness.analyticsRigDbCalls?.push({ kind: "delete", slug, dbId, rowId });
    if (dbId !== "metrics") {
      return Promise.resolve(fail(`Unknown database: ${dbId}`));
    }
    if (!events.some((row) => row.rowId === rowId)) {
      return Promise.resolve(fail(`Row not found: ${rowId}`));
    }
    events = events.filter((row) => row.rowId !== rowId);
    announceDataChanged();
    return Promise.resolve(ok({ id: rowId }));
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.analyticsRigUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

/* ── routing: the real page, plus two probes for the legs around it ─────────── */

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from analytics.html");

/** Records the MemoryRouter's location, and lets the driver navigate. */
function RouterControl() {
  const navigate = useNavigate();
  const location = useLocation();
  harness.analyticsRigGoto = (path: string) => navigate(path);
  harness.analyticsRigLocation = `${location.pathname}${location.search}`;
  return null;
}

/** The page an earlier cadence row lands on; not under test, just a place to be. */
function CadenceProbe() {
  const { cadence } = useParams();
  return (
    <div data-testid="analytics-rig-cadence-probe" data-cadence={cadence}>
      {cadence} review (probe)
    </div>
  );
}

/** The database a derived cell opens, as the route resolves it. */
function DestinationProbe() {
  const { slug, dbId } = useParams();
  const location = useLocation();
  harness.analyticsRigRoute = {
    pathname: location.pathname,
    slug: slug ?? "",
    dbId: dbId ?? "",
  };
  return (
    <div data-testid="analytics-rig-destination" data-db={dbId}>
      {slug} / {dbId}
    </div>
  );
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/review/analytics"]}>
      <RouterControl />
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
                        <Route path="/review/analytics" element={<AnalyticsPage />} />
                        <Route path="/review/:cadence" element={<CadenceProbe />} />
                        <Route path="/data/:slug/:dbId" element={<DestinationProbe />} />
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

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
void ready.then(() => {
  harness.analyticsRigReady = true;
});
harness.analyticsRigSkin = skinName;

const waitForPage = () => {
  const rail = document.querySelector(".nav-rail");
  const page = document.querySelector('[data-testid="analytics-page"]');
  const matrix = document.querySelector('[data-testid="analytics-matrix"]');
  const empty = document.querySelector('[data-testid="analytics-empty"]');
  if (!rail || !page || (!matrix && !empty)) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);
