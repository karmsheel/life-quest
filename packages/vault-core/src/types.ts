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
  | { type: "pins"; domainSlug: string | null }
  | { type: "mapping"; domainSlug: string; mappingId: string }
  | { type: "kit-install"; kit: "finance" }
  | { type: "assumption-set"; rowId: string }
  | { type: "goal" }
  | { type: "day-template" }
  | { type: "project" }
  // KAR-64: an agent row write, in any domain, under any sotMode. rowId is null
  // for a create; a `database` target names the database the proposal mutates
  // (for a create_database the id is minted at propose time).
  | { type: "database-row"; domainSlug: string; databaseId: string; rowId: string | null }
  | { type: "database"; domainSlug: string; databaseId: string }
  // Agent-built dashboard views (plan.md design): one Decision proposes one
  // saved view in one live domain. viewId is EMPTY at propose time — the id is
  // minted when the operator approves and the spec is saved.
  | { type: "view"; domainSlug: string; viewId: string }
  // KAR-70: the pairing Decision a new MCP caller files on first contact. It
  // resolves the connected-agent roster row, not a document.
  | { type: "agent-pairing"; agentId: string };

/**
 * KAR-64: the payload a database Decision carries in its proposedBodyMarkdown.
 * DecisionRecord has no cells field, so cells are serialised as JSON into the
 * markdown fields — the same pattern the page, pins, and mapping branches use.
 */
export type DatabaseDecisionBody = {
  op: "upsert" | "delete" | "create-database" | "add-column";
  /** Resolved at propose time for the operator's benefit. */
  databaseName: string | null;
  /** Human label for the affected row, or null. */
  rowLabel: string | null;
  /** The row's cells at propose time, or null for a create. */
  previousCells: Record<string, unknown> | null;
  /** The proposed full cell set, or null for a delete / schema change. */
  cells: Record<string, unknown> | null;
  /** The row's updatedAt at propose time; the staleness guard. */
  expectedUpdatedAt: string | null;
  /** create-database only: the id minted at propose time. */
  databaseId?: string;
  /** create-database and add-column only. */
  name?: string;
  /** add-column only. */
  type?: DatabaseColumnType;
  /** add-column only, required for select. */
  options?: string[];
  /** add-column only, required for relation. */
  relationDatabaseId?: string;
  /** Read-time relation labels for `cells`, keyed by column id. Not a write payload. */
  cellLabels?: Record<string, string>;
  /** Same, for `previousCells`. */
  previousCellLabels?: Record<string, string>;
  /** add-column only, resolved on read: the relation target's name. */
  relationDatabaseName?: string;
};

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
  /** Use an explicit id (e.g. the id allocated for an approved Decision) instead of a fresh uuid. */
  id?: string;
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

// KAR-7: a Project is one markdown file on disk, linked to one Goal.
export type ProjectStatus = "open" | "closed";

export const PROJECT_STATUSES: ProjectStatus[] = ["open", "closed"];

export type Project = {
  id: string;
  title: string;
  bodyMarkdown: string;
  goalId: string;
  /** Frontmatter key is `domain`; the in-memory field mirrors library `domainSlugs`. */
  domainSlug: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCreateInput = {
  /** Use an explicit id (the id allocated for an approved Decision) instead of a fresh uuid. */
  id?: string;
  title: string;
  goalId: string;
  domainSlug?: string | null;
  bodyMarkdown?: string;
};

export type ProjectUpdatePatch = {
  title?: string;
  bodyMarkdown?: string;
  goalId?: string;
  domainSlug?: string | null;
  status?: ProjectStatus;
};

export type ProjectListResult = {
  records: Project[];
  skipped: number;
};

/** Commands an agent create/close Decision carries in its proposedBodyMarkdown. */
export type ProjectCommand =
  | {
      type: "createProject";
      id: string;
      title: string;
      goalId: string;
      domainSlug: string | null;
      bodyMarkdown?: string;
    }
  | { type: "closeProject"; id: string };

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
  /**
   * KAR-64: set when an approved apply failed terminally, so a Decision the
   * operator *did* approve is distinguishable from one they declined. Null in
   * every other case, including a transient apply failure that stays retryable.
   */
  reason: string | null;
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
  adapter: null | DatabaseAdapterBinding;
  columns: DatabaseColumn[];
  createdAt: string;
  updatedAt: string;
};

export type DomainDatabaseRegistry = {
  schemaVersion: 1;
  databases: DatabaseMeta[];
  installedKits: string[];
  finance?: FinanceKitSettings;
};

export type FinanceKitSettings = {
  homeCurrency: "ZAR";
  usdZarRate: number | null;
  usdZarAsOf: string | null; // YYYY-MM-DD or null
  defaultCaptureAccountId: string | null;
};

export type CaptureOutcome =
  | { posted: false; ask: string; rowId: null }
  | {
      posted: true;
      rowId: string;
      receipt: string;
      amount: number;
      currency: "ZAR" | "USD";
      date: string;
      accountName: string;
      categoryName: string;
      payee: string | null;
    };

export type KitInstallResult =
  | { applied: true; alreadyInstalled: boolean }
  | { applied: false; decision: DecisionRecord };

// KAR-61 Finance kit constants
export const FINANCE_KIT_ID = "finance" as const;
export const FINANCE_DOMAIN_SLUG = "financial" as const;

export const FINANCE_DB_IDS = {
  accounts: "finance:accounts",
  categories: "finance:categories",
  transactions: "finance:transactions",
  budgets: "finance:budgets",
  recurring: "finance:recurring",
  holdings: "finance:holdings",
  assumptionSets: "finance:assumption-sets",
} as const;

export const FINANCE_PAGE_IDS = {
  ledger: "finance-page-ledger",
  spend: "finance-page-spend",
  budget: "finance-page-budget",
  netWorth: "finance-page-net-worth",
  scenario1: "finance-page-scenario-1",
  scenario2: "finance-page-scenario-2",
} as const;

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
  "budget-vs-actual",
  "net-worth",
  "scenario-compare",
  "script",
  "view-ref",
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
  | { id: string; kind: "deadline" }
  | { id: string; kind: "budget-vs-actual" }
  | { id: string; kind: "net-worth" }
  | {
      id: string;
      kind: "scenario-compare";
      assumptionSetId: string;
      compareSetId?: string | null;
    }
  | { id: string; kind: "script"; name: string; source: string }
  // Agent-built dashboard views (plan.md design): an embedded saved view. The
  // view belongs to the page's domain; the card resolves the spec on read.
  | { id: string; kind: "view-ref"; viewId: string };

// KAR-56 script block run types
export type ScriptQueryResult = { sql: string; columns: string[]; rows: unknown[][] };
export type ScriptFetchResult = { url: string; status: number; body: string };
export type ScriptRunResult = {
  queries: ScriptQueryResult[];
  fetches: ScriptFetchResult[];
  warnings: string[];
};
export type ScriptApplyResult = { applied: true; name: string; blockId: string; decision: null };

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
  | { id: string; kind: "page"; domainSlug: string; pageId: string }
  // Agent-built dashboard views (plan.md design, 2026-09-30): a saved view
  // pinned on a board. span 1 is one grid cell, span 2 the full row.
  | { id: string; kind: "view"; domainSlug: string; viewId: string; span: 1 | 2 };

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

// KAR-59 adapter types
export const ADAPTER_KINDS = ["google-sheet", "notion", "url"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export type DatabaseAdapterBinding = {
  kind: AdapterKind;
  bindingId: string;
  mappingId: string | null;
  lastSyncedAt: string | null;
};

export type AdapterSecretStore = {
  put(bindingId: string, secret: string): Promise<void>;
  get(bindingId: string): Promise<string | null>;
  delete(bindingId: string): Promise<void>;
};

export type RemotePull = {
  columns: string[];
  rows: { externalId: string; cells: Record<string, string> }[];
  fx?: { usdZarRate: number; asOf: string } | null;
};

export type AdapterTransport = {
  pull(input: {
    kind: AdapterKind;
    bindingId: string;
    secret: string;
  }): Promise<Result<RemotePull>>;
  pushRow(input: {
    kind: AdapterKind;
    bindingId: string;
    secret: string;
    externalId: string;
    cells: Record<string, string>;
  }): Promise<Result<true>>;
  deleteRow(input: {
    kind: AdapterKind;
    bindingId: string;
    secret: string;
    externalId: string;
  }): Promise<Result<true>>;
};

export type SyncConflict = {
  id: string;
  databaseId: string;
  externalId: string;
  rowId: string | null;
  localCells: Record<string, unknown>;
  remoteCells: Record<string, unknown>;
  fields: string[];
  defaultChoice: "keep-local" | "keep-remote";
};

export type SyncResult = {
  databaseId: string;
  offline?: boolean;
  error?: string;
  pulled: number;
  pushed: number;
  queued: number;
  conflicts: SyncConflict[];
  warnings: string[];
  needsMapping: boolean;
};

// KAR-58 JSON export/restore
export type DomainBooksExport = {
  schemaVersion: 1;
  domainSlug: string;
  exportedAt: string;
  databases: DomainBooksDatabase[];
};

export type DomainBooksDatabase = {
  id: string;
  name: string;
  sotMode: DatabaseSotMode;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
};

// KAR-53 ingest types
export const INGEST_SOURCE_KINDS = ["csv", "pdf", "google-sheet", "notion", "url"] as const;
export type IngestSourceKind = (typeof INGEST_SOURCE_KINDS)[number];

export const INGEST_BATCH_STATUSES = ["awaiting-mapping", "staged", "accepted", "rejected"] as const;
export type IngestBatchStatus = (typeof INGEST_BATCH_STATUSES)[number];

export const INGEST_ROW_STATUSES = ["proposed", "accepted", "rejected"] as const;
export type IngestRowStatus = (typeof INGEST_ROW_STATUSES)[number];

export type IngestColumnMapping = {
  source: string;
  columnId: string;
};

export type IngestMapping = {
  id: string;
  databaseId: string;
  fingerprint: string;
  sourceKind: IngestSourceKind;
  columns: IngestColumnMapping[];
  createdAt: string;
  updatedAt: string;
};

export type IngestProvenance = {
  fileId: string;
  relPath: string;
  sourceKind: IngestSourceKind;
  mappingId: string | null;
};

export type IngestBatch = {
  id: string;
  domainSlug: string;
  databaseId: string;
  mappingId: string | null;
  fileId: string;
  relPath: string;
  sourceKind: IngestSourceKind;
  fingerprint: string;
  status: IngestBatchStatus;
  createdAt: string;
};

export type IngestRow = {
  id: string;
  batchId: string;
  cells: Record<string, unknown>;
  sourceCells: Record<string, string>;
  externalId: string | null;
  provenance: IngestProvenance;
  duplicate: boolean;
  status: IngestRowStatus;
  createdAt: string;
  updatedAt: string;
};

export type IngestFileResult =
  | {
      kind: "staged";
      batch: IngestBatch;
      rows: IngestRow[];
    }
  | {
      kind: "needs-mapping";
      fingerprint: string;
      sourceKind: IngestSourceKind;
      sourceColumns: string[];
      fileId: string;
      relPath: string;
      sampleRows: Record<string, string>[];
      decision: DecisionRecord;
    };

export type MappingWriteResult =
  | { applied: true; mapping: IngestMapping }
  | { applied: false; decision: DecisionRecord };

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

export type FinanceCurrency = "ZAR" | "USD";

export type AssumptionDelta =
  | { kind: "income"; amount: number; currency: FinanceCurrency; categoryId?: string }
  | { kind: "extra-payment"; amount: number; currency: FinanceCurrency; accountId?: string }
  | { kind: "contribution"; amount: number; currency: FinanceCurrency; accountId?: string }
  | { kind: "one-time"; amount: number; currency: FinanceCurrency; date: string }
  | { kind: "spending-change"; amount: number; currency: FinanceCurrency; categoryId?: string };

export type BudgetVsActualLine = {
  budgetRowId: string;
  period: string;
  categoryId: string;
  categoryName: string;
  currency: FinanceCurrency;
  planned: number;
  spent: number;
  remaining: number;
};

export type BudgetVsActualReport = {
  empty: boolean;
  lines: BudgetVsActualLine[];
  warnings: string[];
};

export type NetWorthReport = {
  empty: boolean;
  asOf: string;
  byCurrency: { ZAR: number; USD: number };
  zar: number | null;
  warnings: string[];
};

export type FinanceMonthPoint = {
  month: string;
  byCurrency: { ZAR: number; USD: number };
  zar: number | null;
  warnings: string[];
};

export type FinanceProjection = {
  months: FinanceMonthPoint[];
  warnings: string[];
};

export type ScenarioCompareReport = {
  assumptionSetId: string;
  assumptionSetName: string;
  compareSetId: string | null;
  compareSetName: string | null;
  live: FinanceProjection;
  primary: FinanceProjection;
  secondary: FinanceProjection | null;
};

export type AssumptionSetSaveResult = {
  rowId: string;
  decision: DecisionRecord | null;
};

// KAR-57 finance plan round2

// ---------------------------------------------------------------------------
// Agent-built dashboard views (plan.md design, 2026-09-30). A view is a saved,
// validated spec over one database; the SQL is built in vault-core, the
// companion never emits it.
// ---------------------------------------------------------------------------

export const VIEW_PRESENTATIONS = ["table", "bar", "line", "metric"] as const;
export type ViewPresentation = (typeof VIEW_PRESENTATIONS)[number];

export const VIEW_MEASURES = ["sum", "count", "last"] as const;

export type ViewFilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

export type ViewFilter = {
  columnId: string;
  op: ViewFilterOp;
  value: unknown;
};

export type ViewTimeWindow =
  | "all"
  | "this-month"
  | "last-30-days"
  | "this-year"
  | { kind: "custom"; start: string; end: string };

export type ViewSort = { by: "label" | "value"; dir: "asc" | "desc" };

export type ViewSpec = {
  schemaVersion: 1;
  databaseId: string;
  title: string;
  presentation: ViewPresentation;
  /** null for a metric (one number for the whole database). */
  groupBy: string | null;
  /** day | week | month; required when a line groups on a date column. */
  timeBucket: "day" | "week" | "month" | null;
  /** The date column a timeWindow acts on; null means no window. */
  timeColumnId: string | null;
  timeWindow: ViewTimeWindow;
  filters: ViewFilter[];
  measure: "sum" | "count" | "last";
  /** null for a count measure. */
  measureColumnId: string | null;
  sort: ViewSort;
  /** 1..50; default 12. */
  limit: number;
  /** finance:transactions amount measures only. */
  convertToZar: boolean;
};

export type ViewRunResult = {
  columns: string[];
  rows: Array<[label: string, value: number]>;
  warnings: string[];
  /** The single currency when every row shares one; "mixed" or null otherwise. */
  currency: "ZAR" | "USD" | "mixed" | null;
};


