import type {
  StoreState as MapStoreState,
  Task,
  LiveDay,
  MapEvent,
} from "./map/types.ts";

export const SCHEMA_VERSION = 1 as const;
export const DOCUMENT_KINDS = ["why", "what", "how", "premise"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  premise: "Beliefs & Premise",
  what: "Vision & Desire",
  why: "Purpose",
  how: "Strategy (How)",
};

export const DREAM_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "premise",
  "what",
  "why",
  "how",
];

export type Actor =
  | { type: "user" }
  | { type: "agent"; id: string; name: string };

export const USER_ACTOR: Actor = { type: "user" };

export const REVIEW_CADENCES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

export type DocumentTarget =
  | { type: "doctrine"; domainSlug: string; kind: DocumentKind }
  | { type: "library"; id: string }
  | { type: "review"; cadence: ReviewCadence; period: string }
  | { type: "page"; domainSlug: string; pageId: string }
  | { type: "pins"; domainSlug: string | null };

export const ROOM_IDS = ["dream", "chart", "track", "act"] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export const SEED_DOMAINS = [
  { slug: "health", name: "Health" },
  { slug: "intellectual", name: "Intellectual" },
  { slug: "emotional", name: "Emotional" },
  { slug: "financial", name: "Financial" },
] as const;
export const DEFAULT_HERMES_URL = "http://localhost:8642";

export type LifequestJson = {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
};

export type DomainMeta = {
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DoctrineDocument = {
  kind: DocumentKind;
  title: string;
  locked: boolean;
  updatedAt: string;
  bodyMarkdown: string;
  mtimeMs: number;
};

export type DomainRecord = {
  slug: string;
  meta: DomainMeta;
  documents: Record<DocumentKind, DoctrineDocument>;
};

export const WEEK_START_DAYS = ["monday", "sunday"] as const;
export type WeekStartDay = (typeof WEEK_START_DAYS)[number];

export type VaultSettings = {
  hermesBaseUrl: string;
  theme: "system" | "light" | "dark";
  weekStartDay: WeekStartDay;
};

export type ReviewScopeStatus = "missing" | "draft" | "done";
export type ReviewScopeState = {
  status: "draft" | "done";
  sessionId: string | null;
};
export type ReviewRecord = {
  cadence: ReviewCadence;
  period: string;
  weekStartDay: WeekStartDay;
  locked: boolean;
  updatedAt: string;
  title: string;
  scopes: Record<string, ReviewScopeState>;
  bodyMarkdown: string;
};
export type ReviewIndexEntry = {
  cadence: ReviewCadence;
  period: string;
  locked: boolean;
  scopes: Record<string, { status: "draft" | "done"; sessionId: string | null }>;
  error?: string;
};

export type PlanningStub = {
  cadence: ReviewCadence;
  period: string;
  updatedAt: string;
  scopes: Record<string, { sessionId: string | null }>;
  bodyMarkdown: string; // empty string this spec
};

export type PlanningIndexEntry = {
  cadence: ReviewCadence;
  period: string;
  scopes: Record<string, { sessionId: string | null }>;
};

export type AgentHire = {
  id: string;
  hermesAgentId: string;
  name: string;
  roleLabel: string | null;
  domainSlug: string | null;
  status: "active" | "dismissed";
  createdAt: string;
  dismissedAt: string | null;
};

export type LifeEvent = {
  id: string;
  domainSlug: string | null;
  type: string;
  summary: string;
  payload: unknown;
  createdAt: string;
  actor: Actor | null;
};

export const SIGNAL_TYPES = ["thought", "idea", "notice", "other"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_SOURCES = ["manual", "automation", "notion"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export type SignalRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  type: SignalType;
  source: SignalSource;
  sourceRef: string | null;
  title: string | null;
  body: string;
  domainSlug: string | null;
};

export type SignalCreateInput = {
  type: SignalType;
  body: string;
  title?: string | null;
  domainSlug?: string | null;
};

export type SignalUpdatePatch = {
  type?: SignalType;
  body?: string;
  title?: string | null;
  domainSlug?: string | null;
};

export type SignalChainListResult = {
  records: SignalRecord[];
  skipped: number;
};

export type LibraryDocument = {
  id: string;
  title: string;
  bodyMarkdown: string;
  domainSlugs: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  locked: boolean;
};

export type LibraryCreateInput = {
  title: string;
  bodyMarkdown?: string;
  domainSlugs?: string[];
};

export type LibraryUpdatePatch = {
  title?: string;
  bodyMarkdown?: string;
  domainSlugs?: string[];
};

export type LibraryListResult = {
  records: LibraryDocument[];
  skipped: number;
};

export type DecisionRecord = {
  id: string;
  target: DocumentTarget;
  domainSlugs: string[];
  status: "pending" | "approved" | "rejected";
  title: string;
  rationale: string | null;
  proposedTitle: string | null;
  previousTitle: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown: string | null;
  actor: Actor;
  createdAt: string;
  resolvedAt: string | null;
};

export type GoalStatus = "open" | "done";

export type Goal = {
  id: string;
  name: string;
  notes: string;
  status: GoalStatus;
  domainSlug: string | null;
  deadline: string | null;
  metric: string | null;
  target: number | null;
  definitionOfDone: string | null;
  /** Progress toward target; null when the goal is not numeric. */
  current: number | null;
};

export type GoalsCommand =
  | {
      type: "createGoal";
      name: string;
      notes?: string;
      domainSlug?: string | null;
      deadline?: string | null;
      metric?: string | null;
      target?: number | null;
      definitionOfDone?: string | null;
      current?: number | null;
    }
  | {
      type: "updateGoal";
      id: string;
      name?: string;
      notes?: string;
      status?: GoalStatus;
      domainSlug?: string | null;
      deadline?: string | null;
      metric?: string | null;
      target?: number | null;
      definitionOfDone?: string | null;
      current?: number | null;
    }
  | { type: "deleteGoal"; id: string };

export type GoalsApplyContext = {
  id: () => string;
  liveDomainSlugs: readonly string[];
};

export type VaultSnapshot = {
  rootPath: string;
  lifequest: LifequestJson;
  settings: VaultSettings;
  domains: DomainRecord[];
  agents: AgentHire[];
  decisions: DecisionRecord[];
  log: LifeEvent[];
  map: MapStoreState | null;
  mapError: string | null;
  goals: Goal[];
  goalsError: string | null;
  reviews: ReviewIndexEntry[];
  planning: PlanningIndexEntry[];
  weeklyFileCount: number;
};

export const DATABASE_COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "relation",
  "file",
] as const;
export type DatabaseColumnType = (typeof DATABASE_COLUMN_TYPES)[number];

export const DATABASE_SOT_MODES = [
  "local-only",
  "linked-canonical",
  "local-canonical-mirror",
] as const;
export type DatabaseSotMode = (typeof DATABASE_SOT_MODES)[number];

export type DatabaseColumn = {
  id: string;
  name: string;
  type: DatabaseColumnType;
  options?: string[];
  relationDatabaseId?: string;
};

export type DatabaseMeta = {
  id: string;
  name: string;
  sotMode: DatabaseSotMode;
  adapter: null | { kind: string; bindingId: string };
  columns: DatabaseColumn[];
  createdAt: string;
  updatedAt: string;
};

export type DomainDatabaseRegistry = {
  schemaVersion: 1;
  databases: DatabaseMeta[];
  installedKits: string[];
};

export type DatabaseRow = {
  id: string;
  databaseId: string;
  domainSlug: string;
  createdAt: string;
  updatedAt: string;
  cells: Record<string, unknown>;
};

export type DatabaseListEntry = {
  domainSlug: string;
  database: DatabaseMeta;
};

// KAR-60 pages and pins
export const PAGE_BLOCK_KINDS = [
  "markdown",
  "bound-table",
  "metric",
  "date-range",
  "chart",
  "goal-progress",
  "deadline",
] as const;
export type PageBlockKind = (typeof PAGE_BLOCK_KINDS)[number];

export const METRIC_AGGS = ["sum", "count", "last"] as const;
export type MetricAgg = (typeof METRIC_AGGS)[number];

export const CHART_TYPES = ["bar", "line"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type PageBlock =
  | { id: string; kind: "markdown"; markdown: string }
  | { id: string; kind: "bound-table"; databaseId: string }
  | {
      id: string;
      kind: "metric";
      databaseId: string;
      columnId: string;
      agg: MetricAgg;
      convertToZar?: boolean;
    }
  | { id: string; kind: "date-range"; start: string | null; end: string | null }
  | {
      id: string;
      kind: "chart";
      chartType: ChartType;
      databaseId: string;
      xColumnId: string;
      yColumnId: string;
    }
  | { id: string; kind: "goal-progress" }
  | { id: string; kind: "deadline" };

export type PageRecord = {
  id: string;
  domainSlug: string;
  title: string;
  blocks: PageBlock[];
  createdAt: string;
  updatedAt: string;
};

export type PageListEntry = {
  domainSlug: string;
  page: PageRecord;
};

export const SYSTEM_PIN_KINDS = [
  "goal-progress",
  "deadline",
  "today-week",
  "pending-decisions",
  "recent-log",
  "doctrine-progress",
] as const;
export type SystemPinKind = (typeof SYSTEM_PIN_KINDS)[number];

export type Pin =
  | { id: string; kind: "system"; system: SystemPinKind }
  | { id: string; kind: "page"; domainSlug: string; pageId: string };

export type PinBoard = {
  schemaVersion: 1;
  pins: Pin[];
};

export type PageWriteResult =
  | { applied: true; page: PageRecord }
  | { applied: false; decision: DecisionRecord };

export type PinWriteResult =
  | { applied: true; pins: Pin[] }
  | { applied: false; decision: DecisionRecord };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type PeriodPack = {
  cadence: ReviewCadence;
  period: string;
  scope: "overall" | string;
  bounds: { start: string; end: string };
  log: LifeEvent[];
  tasks: Task[];
  goals: Goal[];
  liveDays: LiveDay[];
  events: MapEvent[];
  previousReview: ReviewRecord | null;
  domainSections: Array<{ slug: string; name: string; status: "draft" | "done"; body: string }>;
  missingSources: string[];
  truncated: boolean;
};
