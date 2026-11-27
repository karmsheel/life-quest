import type {
  StoreState as MapStoreState,
  Task,
  LiveDay,
  MapEvent,
} from "./map/types.ts";

// The map's own record types are part of this module's surface: the consumers
// that read a period pack (pairing-grant, period-pack) name them here rather
// than reaching into `map/types.ts` for a shape this file already carries.
export type { Task, LiveDay, MapEvent };

export const SCHEMA_VERSION = 1 as const;
export const DOCUMENT_KINDS = ["why", "what", "how", "premise"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  premise: "Beliefs & Premise",
  what: "Vision & Desire",
  why: "Purpose",
  how: "Strategy (How)",
};

/**
 * Every doctrine document, in the order the app reads them: the four-part chain
 * a domain is defined by. The groups below are which wing page carries each one.
 */
export const DOCTRINE_ORDER: readonly DocumentKind[] = [
  "premise",
  "what",
  "why",
  "how",
];

/** The Dream page: everything a domain is defined by except its Vision. */
export const DREAM_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "premise",
  "why",
  "how",
];

/** The Vision page: the ideal state a domain is reaching for, on its own. */
export const VISION_DOCUMENT_KINDS: readonly DocumentKind[] = ["what"];

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

/**
 * When a cadence's next review becomes writable.
 *
 * A review looks back on a period that has not finished yet, so writing it the
 * instant the period starts would mean writing it from nothing. A window is
 * when the period is far enough along: `daysBeforeEnd` counts backwards from the
 * period's last calendar day (0 = the last day itself) and `timeOfDay` is the
 * local wall-clock moment it opens. Before that instant the app shows the
 * PREVIOUS period's review, which is the one whose window has opened.
 */
export type ReviewWindow = {
  /** Whole days before the period's last day on which the review opens. 0 = its last day. */
  daysBeforeEnd: number;
  /** Local wall-clock time, "HH:MM" 24h. */
  timeOfDay: string;
};

/** One window per cadence, the value of `settings.json`'s `reviewAvailability`. */
export type ReviewAvailability = Record<ReviewCadence, ReviewWindow>;

export type DocumentTarget =
  | { type: "doctrine"; domainSlug: string; kind: DocumentKind }
  | { type: "library"; id: string }
  | { type: "review"; cadence: ReviewCadence; period: string }
  // The notebook's page. `scope` is "overall" or a live area slug. A page
  // Decision carries the page `rev` it was proposed against in `rev`, so an
  // apply that finds a newer page refuses STALE instead of overwriting prose
  // the operator never saw. Legacy `{type:"review"}` Decisions read as the
  // overall page (one release).
  | { type: "review-page"; cadence: ReviewCadence; period: string; scope: string; rev?: number }
  | { type: "page"; domainSlug: string; pageId: string }
  | { type: "pins"; domainSlug: string | null }
  | { type: "mapping"; domainSlug: string; mappingId: string }
  | { type: "kit-install"; kit: "finance" }
  | { type: "assumption-set"; rowId: string }
  | { type: "goal" }
  | { type: "day-template" }
  // `id` is set by the propose path (update/close) and by the apply path
  // (create), so a project's Decisions can be collated back onto it. Decisions
  // filed before this field existed carry no id and still read.
  | { type: "project"; id?: string }
  // KAR-64: an agent row write, in any domain, under any sotMode. rowId is null
  // for a create; a `database` target names the database the proposal mutates
  // (for a create_database the id is minted at propose time).
  | { type: "database-row"; domainSlug: string; databaseId: string; rowId: string | null }
  | { type: "database"; domainSlug: string; databaseId: string }
  // One Decision for a whole batch of new rows in one database; the rows and
  // their minted ids live in proposedBodyMarkdown.
  | { type: "database-batch"; domainSlug: string; databaseId: string }
  // Agent-built dashboard views (plan.md design): one Decision proposes one
  // saved view in one live domain. viewId is EMPTY at propose time — the id is
  // minted when the operator approves and the spec is saved.
  | { type: "view"; domainSlug: string; viewId: string }
  // KAR-70: the pairing Decision a new MCP caller files on first contact. It
  // resolves the connected-agent roster row, not a document.
  | { type: "agent-pairing"; agentId: string };

/**
 * One column's identity, without its options or relation target.
 *
 * A merge plan matches columns by name, but the staleness guard is about the
 * schema as a whole: an id, a name or a type that moved is a schema the operator
 * never saw. `id` is what makes the signature order-insensitive — two reads of
 * the same schema join in the same order.
 */
export type DatabaseColumnSignature = {
  id: string;
  name: string;
  type: DatabaseColumnType;
};

/**
 * One source database of a merge proposal, frozen at propose time.
 *
 * The apply path re-reads the vault and compares both halves of this record:
 * `fingerprint`/`rowCount` catch moved rows, `columns` catches a schema that
 * changed while the Decision sat pending. `name` is here because the card names
 * the database, and a database can be gone by the time the card is redrawn.
 */
export type DatabaseMergeSource = {
  databaseId: string;
  name: string;
  rowCount: number;
  fingerprint: string;
  columns: DatabaseColumnSignature[];
};

/**
 * KAR-64: the payload a database Decision carries in its proposedBodyMarkdown.
 * DecisionRecord has no cells field, so cells are serialised as JSON into the
 * markdown fields — the same pattern the page, pins, and mapping branches use.
 *
 * `delete-database` and `merge-databases` (2026-11-15) are the destructive
 * database-level ops: both file ONE pending Decision and write nothing until the
 * operator approves it (LAWS/DATABASES.md: a change to, or deletion of, existing
 * data is gated). The target names the doomed database for a delete and the
 * surviving target for a merge.
 */
export type DatabaseDecisionBody = {
  op:
    | "upsert"
    | "delete"
    | "create-database"
    | "add-column"
    | "delete-database"
    | "merge-databases";
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
  /**
   * create-database only: the columns the new database is born with. One
   * Decision creates the database and every column here on approve, so opening
   * a table no longer costs one Decision per column.
   */
  columns?: DatabaseColumnSpec[];
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
  /**
   * Read-time column names for the field keys this body carries, keyed by
   * column id. A cell map is keyed by id, and an id minted by add_column is a
   * uuid: without this the card's "Field" column reads `8f3d2b41…` instead of
   * the column's name. Not a write payload, like the two above.
   */
  columnNames?: Record<string, string>;
  /** add-column only, resolved on read: the relation target's name. */
  relationDatabaseName?: string;
  /** delete-database only: the row count the operator is deleting. */
  rowCount?: number;
  /** delete-database and merge-databases: sha256 over the affected rows. */
  fingerprint?: string;
  /** merge-databases only. */
  sources?: DatabaseMergeSource[];
  /** merge-databases only: columns the merge will add to the target. */
  newColumns?: DatabaseColumnSpec[];
  /** merge-databases only: target select columns whose options widen. */
  widenedColumns?: Array<{ columnId: string; options: string[] }>;
  /** merge-databases only: target schema at propose time (staleness guard). */
  expectedColumns?: DatabaseColumnSignature[];
  /** merge-databases only. */
  dedupe?: boolean;
};

/** A batch insert Decision. Cells live in proposedBodyMarkdown, same as a row write. */
export type DatabaseBatchDecisionBody = {
  op: "insert-rows";
  databaseName: string;
  rows: Array<{
    id: string;
    cells: Record<string, unknown>;
    rowLabel: string | null;
    /** Read-time relation labels for `cells`, keyed by column id. Not a write payload. */
    cellLabels?: Record<string, string>;
  }>;
  /** Read-time column names for the field keys the rows carry, keyed by id. */
  columnNames?: Record<string, string>;
};

export const ROOM_IDS = ["dream", "chart", "track", "act"] as const;
export type RoomId = (typeof ROOM_IDS)[number];
/**
 * The vault's always-unlocked base area. It is the whole-life container that
 * owns records created before any area is unlocked, and it is never a chip of
 * its own: the "Life" lens is the union of every live area, and `life` is the
 * area the union falls back to for records with no narrower home.
 */
export const BASE_AREA_SLUG = "life";

/**
 * What a new vault seeds. A locked area exists on disk — identity and four
 * empty doctrine documents — but is invisible to the operator until the
 * onboarding interview or Settings unlocks it. Locked areas are deliberately
 * absent from the switcher, the doctrine index and every domain-scoped list.
 */
export const AREA_SEEDS = [
  { slug: BASE_AREA_SLUG, name: "Life", sortOrder: 0, locked: false },
  { slug: "health", name: "Health", sortOrder: 1, locked: true },
  { slug: "mind", name: "Mind", sortOrder: 2, locked: true },
  { slug: "financial", name: "Finance", sortOrder: 3, locked: true },
  { slug: "business", name: "Business", sortOrder: 4, locked: true },
  { slug: "relationships", name: "Relationships", sortOrder: 5, locked: true },
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
  /**
   * When the operator unlocked this area. `null` means locked: seeded on disk
   * but hidden from the switcher, the doctrine index and every domain-scoped
   * list until the onboarding interview or Settings unlocks it. An absent field
   * means unlocked, so a vault written before areas had a lock state reads
   * exactly as it always did.
   */
  unlockedAt?: string | null;
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

export type AutoApproveInsert = {
  domainSlug: string;
  databaseId: string;
};

/**
 * Where a saved chat question is offered.
 *
 * One scope per question, because the operator writes a question for one place:
 * a prompt that only makes sense on the Review board should not clutter the
 * composer on the Dashboard. `value` carries the target for everything except
 * `everywhere` — a wing id, a domain slug, or a page route.
 */
export type ChatQuestionScope = "everywhere" | "wing" | "domain" | "page";

export type ChatQuestion = {
  id: string;
  text: string;
  scope: ChatQuestionScope;
  value: string | null;
  createdAt: string;
};

/**
 * How the Decisions inbox interrupts whatever the operator is doing.
 *
 * The inbox is a sheet the operator opens to approve the proposals the companion
 * files. Both switches are about the sheet moving on its own: `autoOpen` raises
 * it when a new proposal arrives, and `autoClose` puts it away once the last
 * pending one is answered. They are separate because the operator may want the
 * inbox to announce itself without it also deciding when the interruption ends
 * — or the reverse, closing quietly while only ever opening it by hand.
 */
export type DecisionInboxSettings = {
  /** Open the inbox when the companion files a decision. */
  autoOpen: boolean;
  /** Close the inbox when the last pending decision is answered. */
  autoClose: boolean;
};

/**
 * One agent's domain rules.
 *
 * `domains` empty means "every domain": the agent is offered everywhere. A
 * non-empty list narrows it to those slugs. `defaultFor` is a subset of the
 * operator's domains where entering the domain also selects this agent.
 */
export type AgentScope = {
  /** The harness/agent id, e.g. "pi" or "hermes". */
  agentId: string;
  domains: string[];
  defaultFor: string[];
};

export type VaultSettings = {
  hermesBaseUrl: string;
  theme: "system" | "light" | "dark";
  weekStartDay: WeekStartDay;
  /**
   * LEGACY, read for compatibility and ignored for behaviour. Adding data is no
   * longer gated at all (2026-10-28), so an insert allowlist has nothing left to
   * decide; old vaults keep the key so opening them does not rewrite settings and
   * so `updateSettings` preserves it. See
   * `docs/superpowers/specs/2026-10-28-direct-database-writes-design.md`.
   */
  autoApproveInserts: AutoApproveInsert[];
  /** Saved questions the chat composer offers, in the operator's own order. */
  chatQuestions: ChatQuestion[];
  /** Whether the Decisions inbox opens and closes itself. */
  decisionInbox: DecisionInboxSettings;
  /**
   * When each cadence's new review becomes writable. Before a period's window
   * opens the app keeps showing the previous period's review, so a review is
   * never written against a period that has barely begun.
   */
  reviewAvailability: ReviewAvailability;
  /**
   * Which domains each agent is offered in, and where it is the domain's
   * default. Absent/empty means every agent is offered everywhere and none is a
   * domain default; Pi remains the app's main agent.
   */
  agentScopes: AgentScope[];
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
  /**
   * The review's content version for compare-and-swap, in the compatibility
   * projection. A notebook has one rev per page, so this is a monotonic
   * composite: the manifest rev plus every page rev. Any structural change or
   * real body write moves it, so a page editor that read it still conflicts
   * when another writer lands between its read and its save.
   *
   * A legacy single-file review reads its own `rev` (0 for files written before
   * the field existed), which is a version no write produces.
   */
  rev: number;
  /** The notebook's page summaries, when the record is the compatibility projection. */
  pages?: ReviewPageSummary[];
  /** The compatibility content rev (the same number as `rev`), named for the notebook. */
  notebookRev?: number;
};

/**
 * One scope's page as the companion reads and writes it.
 *
 * A page is the operator's unit of work: the overall review, or one area's
 * report. In today's single-file storage it is a projection of the file — the
 * `overall` H2s for the overall page, one area's `###` headings for an area
 * page — and the writer merges a page back into the file by scope, so two area
 * sessions no longer replace each other's prose.
 */
export type ReviewPageBody = {
  scope: string;
  /** The page's display title: the notebook title for `overall`, the area name otherwise. */
  title: string;
  /** `missing` when the page does not exist yet (never started). */
  status: "missing" | "draft" | "done";
  sessionId: string | null;
  /** The page's own rev at read time; pass it back to detect a stale write. */
  rev: number;
  updatedAt: string | null;
  locked: boolean;
  bodyMarkdown: string;
};

/** One page with the notebook identity it belongs to. */
export type ReviewPage = ReviewPageBody & {
  cadence: ReviewCadence;
  period: string;
};

/**
 * One notebook page as stored: the markdown file's parsed contents.
 *
 * Page files are the unit of concurrent work: they own their prose, status,
 * session id and rev, and no other page's write touches them. The manifest owns
 * identity, order and lock.
 */
export type ReviewPageFile = {
  schemaVersion: 1;
  scope: string;
  title: string;
  status: "draft" | "done";
  sessionId: string | null;
  rev: number;
  updatedAt: string;
  bodyMarkdown: string;
};

/** The notebook manifest (`review.json`): identity, order and lock. */
export type ReviewManifest = {
  schemaVersion: 1;
  cadence: ReviewCadence;
  period: string;
  weekStartDay: WeekStartDay;
  title: string;
  locked: boolean;
  order: string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
};

/** The read-only notebook a period presents to the app. */
export type ReviewPageSummary = {
  scope: string;
  title: string;
  status: "draft" | "done";
  sessionId: string | null;
  rev: number;
  updatedAt: string;
  chars: number;
};

export type ReviewNotebook = {
  cadence: ReviewCadence;
  period: string;
  title: string;
  weekStartDay: WeekStartDay;
  locked: boolean;
  order: string[];
  rev: number;
  pages: ReviewPageSummary[];
  /** Absolute path of the notebook directory (or the legacy file it projects). */
  path: string;
  /** True when the period is still a single legacy file the migration has not split. */
  legacy: boolean;
};

/** Why a page write was refused. `LEGACY_LAYOUT` asks the caller to retry after migration. */
export type ReviewPageWriteCode =
  | "CONFLICT"
  | "LOCKED"
  | "GATED"
  | "NOT_OPEN"
  | "NOT_FOUND"
  | "MALFORMED"
  | "LEGACY_LAYOUT";

/** A page write's answer: the page as written, or a refusal with the page as it stands. */
export type ReviewPageWriteOutcome =
  | { ok: true; page: ReviewPageBody; notebookRev: number }
  | {
      ok: false;
      code: ReviewPageWriteCode;
      error: string;
      /** The same sentence as `error`, under the name the engine API documents. */
      message: string;
      current?: ReviewPageBody;
    };

/** One period's outcome in the legacy→notebook migration. */
export type ReviewMigrationPeriod = {
  cadence: ReviewCadence;
  period: string;
  status: "migrated" | "skipped" | "failed";
  reason?: string;
};

/** What the one-release migration did, stored in its marker file. */
export type ReviewMigrationReport = {
  schemaVersion: 1;
  migratedAt: string;
  alreadyDone: boolean;
  periods: ReviewMigrationPeriod[];
};

/**
 * Why a review write was refused. `CONFLICT` is the one a caller must handle
 * rather than retry blindly: the page it read is no longer the page on disk.
 */
export type ReviewWriteCode =
  | "CONFLICT"
  | "LOCKED"
  | "GATED"
  | "NOT_OPEN"
  | "MALFORMED"
  | "NOT_FOUND"
  | "LEGACY_LAYOUT";

/**
 * A review write's answer. A refusal carries the current file for `CONFLICT`,
 * so the caller can show "this changed on disk" without a second read.
 */
export type ReviewWriteOutcome =
  | { ok: true; value: ReviewRecord }
  | {
      ok: false;
      error: string;
      code: ReviewWriteCode;
      current?: ReviewRecord;
    };
export type ReviewIndexEntry = {
  cadence: ReviewCadence;
  period: string;
  locked: boolean;
  scopes: Record<string, { status: "draft" | "done"; sessionId: string | null }>;
  /** Latest write across the manifest and its pages. */
  updatedAt?: string;
  /** How many pages the notebook holds (overall included). */
  pageCount?: number;
  /** How many pages are `done`. */
  doneCount?: number;
  error?: string;
};

/**
 * One standing rule that fills part of a review before the interview starts.
 *
 * A directive is the machine half of a review skill: the operator's prose in
 * `.lifequest/reviews/<cadence>.md` says what the session should do, and a
 * `lifequest-snapshot` fence in that same file says what the app should go and
 * read. It names a domain and one of its four sub-headings, and carries an
 * ordinary view spec — the same vocabulary the dashboard cards use — so a
 * snapshot is never a second query language to keep in step.
 */
export type ReviewSnapshotDirective = {
  /** Stable across rewrite: this is what the written block is found by. */
  id: string;
  /** The domain slug whose section the block belongs in, e.g. "financial". */
  domain: string;
  /** The `###` heading inside that domain, e.g. "Look-back". */
  section: string;
  /** The block's own caption, printed bold above its table. */
  title: string;
  /**
   * `period` rewrites the spec's window to the exact bounds of the review
   * being read, which is what makes a weekly snapshot the week's own numbers.
   * `all` leaves the spec's window as it was written.
   */
  window: "period" | "all";
  /**
   * Display-only sign handling, mirroring a metric definition's
   * `formatting.magnitude`: `abs` prints a negative total as its gross size
   * (Cash out), `negate` flips the sign. It is applied where the value is
   * PRINTED and never to the query or the stored number, so a review can read
   * "Cash out 3,000" while the ledger keeps -3,000.
   */
  magnitude?: "abs" | "negate" | null;
  spec: Omit<ViewSpec, "schemaVersion">;
};

/** How one directive ended up, named so the operator is told what happened. */
export type ReviewSnapshotOutcome = {
  id: string;
  domain: string;
  section: string;
  title: string;
  status: "written" | "unchanged" | "skipped" | "failed";
  /** Why it was skipped or how it failed. Absent on `written`/`unchanged`. */
  reason?: string;
  /** How many groups the block drew. Absent when nothing ran. */
  groups?: number;
};

/**
 * A cadence's review skill: the operator's standing rules for that cadence,
 * plus the snapshot directives the app executes on their behalf.
 *
 * Stored at `.lifequest/reviews/<cadence>.md`. `exists` is false when the file
 * has never been written and the value is the shipped default — reading a
 * skill never creates a file, so the default can be improved by a release.
 */
export type ReviewSkill = {
  cadence: ReviewCadence;
  markdown: string;
  snapshots: ReviewSnapshotDirective[];
  /** Directives a fence failed to yield, each with the reason it did not. */
  problems: string[];
  exists: boolean;
};

/**
 * One app-written metric figure, as the pass plans it.
 *
 * A figure is NOT a snapshot directive: an operator's fence carries a view spec
 * the app executes, while a figure is written from the area's metric definition
 * (Phase 4) through `getMetricsSummary`. The two share the marker-placement
 * machinery and the outcome vocabulary, not the query source — a snapshot is a
 * rule the operator wrote, a figure is a number the app already knows how to
 * read. `kind` is what tells the two apart in a pass's outcomes.
 */
export type ReviewMetricFigureDirective = {
  kind: "metric";
  /** The stable marker id, `metric:<definitionId>`. */
  id: string;
  /** The metric definition the figure reads, without the marker prefix. */
  definitionId: string;
  /** The area whose page the figure lands on. */
  domain: string;
  /** Figures live under the area page's own Look-back. */
  section: "Look-back";
  /** The definition's label, printed bold above the value. */
  title: string;
  /** The definition's unit, display only: `ZAR` prints in parentheses. */
  unit: string;
  /** The definition's display formatting; the figure never changes the query. */
  formatting: MetricFormatting | null;
};

/**
 * The overall page's cross-domain block. It is one app-rendered table over one
 * run per definition — a `ViewSpec` answers one domain per call, so this cannot
 * be a directive, and a fake "overall domain" spec would be a second engine.
 */
export type ReviewMetricsOverallDirective = {
  kind: "overall";
  id: "metrics:overall";
  domain: "";
  section: "Look-back";
  title: "Metrics this period";
};

export type ReviewFigureDirective =
  | ReviewMetricFigureDirective
  | ReviewMetricsOverallDirective;

/** How one app-written figure ended up, in the same words a snapshot outcome uses. */
export type ReviewFigureOutcome = {
  kind: "metric" | "overall";
  id: string;
  /** The definition behind a metric figure (absent for the overall block). */
  definitionId?: string;
  domain: string;
  section: string;
  title: string;
  status: "written" | "unchanged" | "failed";
  /** Why it failed, or why a stale figure was removed. */
  reason?: string;
};

/** One pass's outcome: an operator fence's snapshot, or an app-written figure. */
export type ReviewPrepopulateOutcome = ReviewSnapshotOutcome | ReviewFigureOutcome;

/** What one pre-population pass did to a review, and why for each part. */
export type ReviewPrepopulateResult = {
  cadence: ReviewCadence;
  period: string;
  scope: string;
  outcomes: ReviewPrepopulateOutcome[];
  /** How many directives ended up written or refreshed. */
  applied: number;
  /**
   * Domain sections the pass had to plant because a rule named them and the
   * review had none. Named so the operator is told the review grew a section
   * rather than finding one they did not expect.
   */
  planted: string[];
  /** True when the review is locked, so nothing was touched. */
  locked: boolean;
  /** The review body after the pass — the file's own, unchanged when locked. */
  bodyMarkdown: string;
};

// ---------------------------------------------------------------------------
// Metrics (2026-11-26 metrics design, §10). A metric definition is the
// operator's named measurement, stored as one git-portable JSON per metric
// under `domains/<slug>/metrics/<id>.json`. The rows it reads are ordinary
// rows in the area's own database (the `metrics` events table for a manually
// logged metric, or whatever database a derived spec names), so figures run
// through the one view engine rather than a second aggregation path.
// ---------------------------------------------------------------------------

/** Where a metric's rows come from. */
export const METRIC_SOURCES = ["derived", "events"] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

/** The measures a metric may fold its rows with. `avg-per` stays a view-only measure. */
export const METRIC_AGGREGATIONS = ["sum", "count", "last", "avg"] as const;
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

export const METRIC_DIRECTIONS = ["higher-is-better", "lower-is-better", "neutral"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

/** Display-only sign handling; never applied to the query or the stored number. */
export const METRIC_MAGNITUDES = ["abs", "negate"] as const;
export type MetricMagnitude = (typeof METRIC_MAGNITUDES)[number];

/**
 * How a metric's value is printed. All of it is display-only: a `prefix` never
 * enters the SQL, and `magnitude` never changes what the query returned.
 */
export type MetricFormatting = {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  magnitude?: MetricMagnitude | null;
};

/**
 * One operator-owned metric definition, exactly the object spec §10.1 names.
 *
 * `derived` carries a spec — validated against the area's own databases at
 * definition time — and `events` carries the `metric` cell value its rows
 * carry. `aggregation` is the fold for an events metric and display metadata
 * for a derived one, whose query stays in `spec` (the same split a saved view
 * makes between its data and its drawing).
 */
export type MetricDefinition = {
  schemaVersion: 1;
  /** Stable id; a review figure is found by `metric:<id>`. */
  id: string;
  domainSlug: string;
  /** "Training minutes" */
  label: string;
  /** "minutes" | "sessions" | "pages" | "ZAR" | free text, display only. */
  unit: string;
  source: MetricSource;
  /** derived: the one query that answers the metric. Validated on write. */
  spec?: Omit<ViewSpec, "schemaVersion">;
  /** events: the `metric` cell value the logged rows carry. */
  eventKey?: string;
  aggregation: MetricAggregation;
  direction?: MetricDirection;
  target?: number | null;
  formatting?: MetricFormatting;
  createdBy: "user" | "agent";
  createdAt: string;
  updatedAt: string;
};

/**
 * One metric's answered value for a review period and the one before it.
 *
 * `value`/`previousValue`/`delta` are null when the window held no rows at all
 * — never a fabricated zero, because a metric that was not tracked and a metric
 * that was genuinely zero are different statements, and only one of them is
 * true. `formatting` is carried so Phase 5/6 render from the definition rather
 * than from a second copy of it.
 */
export type MetricSummary = {
  id: string;
  label: string;
  unit: string;
  source: MetricSource;
  value: number | null;
  previousValue: number | null;
  delta: number | null;
  direction: MetricDirection | null;
  target: number | null;
  formatting: MetricFormatting | null;
  window: { start: string; end: string };
  previousWindow: { start: string; end: string };
  /** The instant the read ran, ISO — a review window opens before the period ends. */
  asOf: string;
  /** Where the number came from, for the figure's provenance line. */
  provenance: { databaseId: string; eventKey?: string };
};

/**
 * One definition the metrics layer could not use, reported rather than thrown.
 *
 * Two failures look the same to a caller: a file that is malformed on disk and a
 * well-formed definition that cannot ANSWER (a derived metric whose source
 * database was deleted, a spec that is no longer runnable). Both are reported
 * here; the second carries `metricId`, and its summary answers null rather than a
 * fabricated value.
 */
export type MetricDefinitionProblem = {
  /** Vault-relative file, so the operator can open the one that is wrong. */
  file: string;
  /** The definition that could not answer, for a run failure (absent for a file read failure). */
  metricId?: string;
  reason: string;
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

/**
 * The operator's journal entry for one local calendar date. One note per day:
 * the date *is* the identity, and `notes/daily/{date}.md` is the only file that
 * can hold it.
 */
export type DailyNote = {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  createdAt: string;
  updatedAt: string;
  bodyMarkdown: string;
};

/** An index row: the date a note exists for, and when it was last written. */
export type DailyNoteIndexEntry = {
  date: string;
  updatedAt: string | null;
  error?: string;
};

/**
 * One title-bearing freeform document in the Ideal State page.
 *
 * Unlike a daily note, the date is not the identity — the operator may write as
 * many as they think of. The id is the filename and the title is the operator's
 * own, stored in the frontmatter so renaming never moves a file.
 */
export type IdealStateDocument = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bodyMarkdown: string;
};

/** An index row: one titled document and when it was last written. */
export type IdealStateIndexEntry = {
  id: string;
  title: string | null;
  updatedAt: string | null;
  error?: string;
};

export type IdealStateCreateInput = {
  title: string;
  bodyMarkdown?: string;
};

export type IdealStateUpdatePatch = {
  title?: string;
  bodyMarkdown?: string;
};

// Define → Images (2026-10-28). A vault-level picture library and the one
// written vision board beside it. Pictures are stored as files, so the vault
// keeps what the operator uploaded; the two JSON files are the library's index
// and the board's blocks.
export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** The extension a sniffed kind is stored under. The bytes decide, never the name. */
export const IMAGE_MIME_EXT: Record<ImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** One picture in the operator's library, as the page draws it. */
export type VaultImage = {
  id: string;
  /** Vault-relative path, `images/files/<id>.<ext>`; never absolute. */
  relPath: string;
  /** The name the operator's file had, kept for display only. */
  name: string;
  caption: string;
  mime: ImageMimeType;
  bytes: number;
  /** The canvas the uploader reported, or null when it did not say. */
  width: number | null;
  height: number | null;
  createdAt: string;
};

/**
 * One block of the vision document. Deliberately the small, stable set the
 * operator asked for — text, heading, bullets and a picture with its caption —
 * rather than a general rich-text document.
 */
export type VisionBoardBlock =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "heading"; text: string }
  | { id: string; kind: "bullets"; items: string[] }
  | { id: string; kind: "image"; imageId: string; caption: string };

export type VisionBoardBlockKind = VisionBoardBlock["kind"];

/** The one long document beside the library. */
export type VisionBoard = {
  blocks: VisionBoardBlock[];
  updatedAt: string;
};

export type ImageSaveInput = {
  bytes: Uint8Array;
  /** Declared by the renderer; the sniffed bytes are authoritative. */
  mime: string;
  name: string;
  width?: number | null;
  height?: number | null;
};

export type ImageUpdatePatch = {
  name?: string;
  caption?: string;
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

/**
 * Where a capture stands as work: captured into the `inbox`, then moved on by
 * the operator's triage. These are the five and only five states the store
 * writes; a record written before the inbox existed reads as `"inbox"`.
 */
export const SIGNAL_STATUSES = [
  "inbox",
  "triaged",
  "acting",
  "done",
  "dropped",
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/** The operator's own ordering. `null` is "not set", not "normal". */
export const SIGNAL_PRIORITIES = ["high", "normal", "low"] as const;
export type SignalPriority = (typeof SIGNAL_PRIORITIES)[number];

/**
 * A picture a signal carries, stored as a file under `signal-chain/files/` and
 * referenced from the signal's JSON by its vault-relative path. The bytes decide
 * the kind and the extension, never the uploaded name; the name is a label.
 */
export type SignalImageAttachment = {
  kind: "image";
  /** Vault-relative, `.lifequest/signal-chain/files/<uuid>.<ext>`; never absolute. */
  relPath: string;
  name: string;
  mime: ImageMimeType;
  width: number | null;
  height: number | null;
};

/** A web link a signal carries. Absolute http(s) only, as the page validates. */
export type SignalLinkAttachment = {
  kind: "link";
  url: string;
};

/**
 * Any other file a signal carries, stored beside the pictures under
 * `signal-chain/files/` and named by its vault-relative path. Unlike a picture,
 * the extension comes from the name the operator attached; active content
 * (a page, a script, an app) is refused at write time, because the vault must
 * never hand the renderer something a click could run.
 */
export type SignalFileAttachment = {
  kind: "file";
  /** Vault-relative, `.lifequest/signal-chain/files/<uuid>[.<ext>]`; never absolute. */
  relPath: string;
  name: string;
  mime: string;
  size: number;
};

export type SignalAttachment =
  | SignalImageAttachment
  | SignalLinkAttachment
  | SignalFileAttachment;

export type SignalRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  type: SignalType;
  source: SignalSource;
  sourceRef: string | null;
  title: string | null;
  /** The description. Empty is allowed only when an attachment says why. */
  body: string;
  domainSlug: string | null;
  /**
   * The project this capture belongs to, a live id from `projects/`. Optional
   * on disk: a signal written before the inbox existed has no key and reads
   * back as null.
   */
  projectId?: string | null;
  /**
   * Where the capture stands as work. Optional on disk for the same reason; an
   * absent key reads as `"inbox"`, never as undefined.
   */
  status?: SignalStatus;
  /** The operator's own ordering, or null (absent on old records). */
  priority?: SignalPriority | null;
  /** Where it came in from, free text, e.g. "Chrome — AI tab group". */
  capturedFrom?: string | null;
  /** A picture, a link or a file, or null for a plain text capture. */
  attachment: SignalAttachment | null;
};

/**
 * An attachment on its way in. The renderer hands over bytes for a picture or a
 * file — it never names a vault path — and the URL for a link; the vault mints
 * the path.
 */
export type SignalImageInput = {
  kind: "image";
  bytes: Uint8Array;
  name: string;
  width?: number | null;
  height?: number | null;
};

export type SignalLinkInput = {
  kind: "link";
  url: string;
};

/**
 * A file on its way in. The renderer hands over the bytes and the name it saw;
 * the vault mints the stored path and derives a safe extension from the name.
 * `mime` is a hint: an unrecognised one is stored as `application/octet-stream`.
 */
export type SignalFileInput = {
  kind: "file";
  bytes: Uint8Array;
  name: string;
  mime?: string;
};

export type SignalCreateInput = {
  type: SignalType;
  /** May be empty only when `attachment` is present. */
  body: string;
  title?: string | null;
  domainSlug?: string | null;
  /** A live project id from `projects/`; omitted or null is unfiled. */
  projectId?: string | null;
  /** Where the capture lands as work; omitted reads as `"inbox"`. */
  status?: SignalStatus;
  /** The operator's ordering; omitted or null is unset. */
  priority?: SignalPriority | null;
  /** Where it came in from, free text; omitted or null is unknown. */
  capturedFrom?: string | null;
  attachment?: SignalImageInput | SignalLinkInput | SignalFileInput | null;
};

export type SignalUpdatePatch = {
  type?: SignalType;
  body?: string;
  title?: string | null;
  domainSlug?: string | null;
  projectId?: string | null;
  status?: SignalStatus;
  priority?: SignalPriority | null;
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

// A Project is one markdown file on disk — the operator's own project page.
//
// It ships with the app: the schema below is fixed and every vault gets it,
// rather than the operator having to build a database before they can track a
// project. `goalId` is optional so a project can start before it is filed under
// a goal; a set value is still checked against the live goals on every write.
export const PROJECT_STATUSES = [
  "open",
  "active",
  "paused",
  "blocked",
  "done",
  "closed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PRIORITIES = ["low", "normal", "high"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

/**
 * One entry in a project's progress timeline. `progress` is the percent at the
 * moment the update was logged, or null when only a note was written.
 */
export type ProjectUpdate = {
  id: string;
  at: string;
  note: string;
  progress: number | null;
  actorName: string | null;
};

export type Project = {
  id: string;
  title: string;
  /** One line: what this is. */
  summary: string;
  /**
   * Free text: what kind of thing this is — "Mobile App", "Desktop/web",
   * "YouTube", "Physical product", "Service". Null when the project does not
   * say. Captured with an idea so the register knows what was written down.
   */
  projectType: string | null;
  /** Free text: the person or place the idea came from, or null. */
  source: string | null;
  /** An absolute http(s) URL the idea came from, or null. Never any other scheme. */
  sourceUrl: string | null;
  /**
   * Absolute http(s) URLs of the project's repositories, in the order the
   * operator or companion named them. Empty when the project has none; stored
   * as a YAML block sequence in the frontmatter.
   */
  repoUrls: string[];
  /** The context document (the markdown body of the file). */
  bodyMarkdown: string;
  /** Where it stands right now, in the operator's own words. */
  stateNote: string;
  goalId: string | null;
  /** Frontmatter key is `domain`; the in-memory field mirrors library `domainSlugs`. */
  domainSlug: string | null;
  status: ProjectStatus;
  priority: ProjectPriority | null;
  /** `YYYY-MM-DD`. */
  startDate: string | null;
  /** `YYYY-MM-DD`. */
  targetDate: string | null;
  /** 0–100, integer. */
  progress: number;
  nextAction: string | null;
  updates: ProjectUpdate[];
  createdAt: string;
  updatedAt: string;
};

/** The fields a project write may carry. Shared by create, update, and the agent command. */
export type ProjectFields = {
  title?: string;
  summary?: string;
  projectType?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  repoUrls?: string[] | null;
  bodyMarkdown?: string;
  stateNote?: string;
  goalId?: string | null;
  domainSlug?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority | null;
  startDate?: string | null;
  targetDate?: string | null;
  progress?: number;
  nextAction?: string | null;
};

export type ProjectCreateInput = ProjectFields & {
  /** Use an explicit id (the id allocated for an approved Decision) instead of a fresh uuid. */
  id?: string;
  title: string;
};

export type ProjectUpdatePatch = ProjectFields & {
  /** Append one progress-timeline entry; sets `progress` too when given. */
  addUpdate?: { note: string; progress?: number | null };
};

export type ProjectListResult = {
  records: Project[];
  skipped: number;
};

/** The compact shape list_projects answers with (no body, no timeline). */
export type ProjectListEntry = {
  id: string;
  title: string;
  summary: string;
  projectType: string | null;
  source: string | null;
  sourceUrl: string | null;
  repoUrls: string[];
  stateNote: string;
  goalId: string | null;
  domainSlug: string | null;
  status: ProjectStatus;
  priority: ProjectPriority | null;
  startDate: string | null;
  targetDate: string | null;
  progress: number;
  nextAction: string | null;
  updatedAt: string;
};

/** Commands a project Decision carries in its proposedBodyMarkdown. */
export type ProjectCommand =
  | {
      type: "createProject";
      id: string;
      title: string;
      goalId: string | null;
      domainSlug: string | null;
      bodyMarkdown?: string;
      summary?: string;
      projectType?: string | null;
      source?: string | null;
      sourceUrl?: string | null;
      repoUrls?: string[] | null;
      stateNote?: string;
      status?: ProjectStatus;
      priority?: ProjectPriority | null;
      startDate?: string | null;
      targetDate?: string | null;
      progress?: number;
      nextAction?: string | null;
    }
  | { type: "updateProject"; id: string; patch: ProjectUpdatePatch }
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
  /**
   * The library note's domain list as the proposal would leave it, or null when
   * the proposal does not touch the tags.
   *
   * A plain `.md` note's domains live in its frontmatter, and until this field a
   * proposal could only carry a title and a body — so an agent asked to re-tag a
   * note had no Decision to file and no tool to call. Null is "no change", []
   * is the real proposal to untag, which is why this is not simply optional.
   */
  proposedDomainSlugs: string[] | null;
  /** The note's tags when the proposal was filed; null when domains do not change. */
  previousDomainSlugs: string[] | null;
  actor: Actor;
  createdAt: string;
  resolvedAt: string | null;
  /**
   * KAR-64: set when an approved apply failed terminally, so a Decision the
   * operator *did* approve is distinguishable from one they declined. Null in
   * every other case, including a transient apply failure that stays retryable.
   */
  reason: string | null;
  /**
   * When the operator last edited the proposal before answering it, or null.
   *
   * A Decision is the agent's proposal, and approval applies whatever the record
   * holds. The operator can correct a proposal in the inbox — a misspelt project
   * name, a detail worth adding — and these fields are how the record admits that
   * what was approved is theirs, not the proposer's. They are also what the
   * resolve path reads to decide whether a terminal apply failure is fixable.
   */
  amendedAt: string | null;
  /** Who made the last amendment. Always the operator today. */
  amendedBy: Actor | null;
  /** The operator's reason for the edit, in their own words, or null. */
  amendmentNote: string | null;
  /**
   * The proposal exactly as it was filed, kept from the first amendment so the
   * inbox can show (and restore) what the agent actually asked for.
   */
  originalProposedTitle: string | null;
  originalProposedBodyMarkdown: string | null;
};

/**
 * The operator's edit to a pending Decision's proposal.
 *
 * Every field is optional because an amendment may touch only the title, only
 * the body, or only the note. `revert` is the one exception: it restores the
 * proposal as filed and clears the amendment, ignoring the other fields.
 */
export type DecisionAmendment = {
  proposedTitle?: string | null;
  proposedBodyMarkdown?: string;
  note?: string | null;
  revert?: boolean;
};

/**
 * A decision the operator logged themselves — "manual" in the everyday sense,
 * including decisions made only in their head.
 *
 * The Decisions inbox is for changes proposed against the vault: every one of
 * those waits for an answer, and answering it writes something. A manual
 * decision is not a proposal. Nothing is going to be written, so there is
 * nothing to approve, and it must never appear as a pending card or be resolved.
 * It lives in its own store for exactly that reason; History reads both stores
 * and names which one a row came from.
 */
export type ManualDecisionRecord = {
  id: string;
  /** What was decided, in the operator's own words. */
  title: string;
  /** Why — optional; null when the operator left it blank. */
  rationale: string | null;
  /** The domain it belongs to, or null when it belongs to no domain. */
  domainSlug: string | null;
  /** Always the operator: a manual decision has no proposer. */
  actor: Actor;
  createdAt: string;
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

// ---------------------------------------------------------------------------
// The onboarding interview (P1, 2026-11-08). The record is the vault's memory
// that the first-run interview happened; the proposal is the companion's single
// confirmation card, written once and applied only when the operator confirms.
// Both live under `.lifequest/` and both are read on every `openVault`, because
// the dock's cards are gated on them.
// ---------------------------------------------------------------------------

export const ONBOARDING_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/**
 * The onboarding interview's record, `.lifequest/onboarding.json`.
 *
 * A vault with no file reads as `completed`: that is how every vault written
 * before the interview existed avoids being shown a first-run card. A new vault
 * gets the file at creation with `not_started`. Reading never creates the file.
 */
export type OnboardingRecord = {
  status: OnboardingStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** The seeded areas the interview unlocked, in the order they were confirmed. */
  unlockedAreas: string[];
};

/** One seeded area the interview heard, with the four doctrine drafts. */
export type OnboardingAreaProposal = {
  slug: string; // seeded, currently-locked area slug, one of the five
  name: string; // derived from AREA_SEEDS, not trusted from the model
  doctrine: { kind: DocumentKind; bodyMarkdown: string }[];
};

/** The one table the interview's clearest ask produced, if it produced one. */
export type OnboardingTableProposal = {
  areaSlug: string; // one of this proposal's area slugs
  name: string;
  columns: { name: string; type: DatabaseColumnType; options?: string[] }[];
};

/** The interview's one note — the first "life picture", written to the base area. */
export type OnboardingNoteProposal = { title: string; bodyMarkdown: string };

/**
 * The onboard proposal as stored, `.lifequest/onboarding-proposal.json`.
 *
 * The companion writes it through `propose_onboarding_unlock`, and that call now
 * APPLIES it: the areas are opened and the doctrine, table and note are written
 * in the same request (P1 Amendment 2, 2026-11-09). The file is then kept as the
 * announcement card's RECEIPT — the dock reads it to say what was opened, and it
 * survives a reload until the operator acknowledges it. A legacy/first-run
 * proposal is one written but not yet applied; the apply path treats both alike.
 */
export type OnboardingProposal = {
  areas: OnboardingAreaProposal[]; // 1..3
  table: OnboardingTableProposal | null;
  note: OnboardingNoteProposal; // required: the interview's one note
  createdAt: string;
};

/** What the confirmation/announcement card's unticked lines mean to the apply path. */
export type OnboardingConfirmOptions = {
  /** Doctrine kinds to leave unwritten (the card's unticked lines). */
  skipDoctrineKinds?: DocumentKind[];
  /** Include the proposal's table (default true). */
  includeTable?: boolean;
  /** Include the interview note (default true). */
  includeNote?: boolean;
  /**
   * Keep `.lifequest/onboarding-proposal.json` after the batch applies (default
   * false). The passive-open path sets this: the companion opens the areas itself,
   * and the kept proposal is the announcement card's RECEIPT — it is what the dock
   * reads to say what was opened, and it survives a reload until the operator
   * acknowledges it (`discardOnboardingProposal`). A kept receipt never changes
   * the record: that is already `completed`.
   */
  keepProposal?: boolean;
};

/** What one confirmed batch actually did. */
export type OnboardingConfirmResult = {
  areas: string[]; // slugs unlocked
  table: boolean; // created or not
  note: boolean; // written or not
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
  /** The onboarding record; a vault with no file reads as `completed`. */
  onboarding: OnboardingRecord;
  /** The pending confirmation, or null. Drives the dock card. */
  onboardingProposal: OnboardingProposal | null;
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

/**
 * A column spec carried by a create_database Decision. The id is not here: the
 * engine mints it, exactly as add_column does, so a Decision cannot choose one.
 */
export type DatabaseColumnSpec = {
  name: string;
  type: DatabaseColumnType;
  options?: string[];
  relationDatabaseId?: string;
};

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

/**
 * Where the USD→ZAR rate is read from, and how that read last went.
 *
 * `path` is the operator's because "a different source" means a different shape:
 * the common providers all nest the rate under `rates` keyed by currency code,
 * which is why that is the default, but the field is what makes any other JSON
 * endpoint usable rather than a source this app happens to know.
 */
export type FxRateSource = {
  /** The JSON endpoint the rate is read from. */
  url: string;
  /** Dot path to the rate inside that JSON, e.g. "rates.ZAR". */
  path: string;
  /**
   * Dot path to the source's own date, when it publishes one. Null means the
   * source does not say, and the read is dated today.
   */
  asOfPath: string | null;
  /** When the source was last read, successfully or not. */
  lastFetchedAt: string | null;
  /** Why the last read failed; null after a read that worked. */
  lastError: string | null;
};

export type FinanceKitSettings = {
  homeCurrency: "ZAR";
  usdZarRate: number | null;
  usdZarAsOf: string | null; // YYYY-MM-DD or null
  defaultCaptureAccountId: string | null;
  /** Null until the operator changes it; the default source is used instead. */
  fxSource?: FxRateSource | null;
  /**
   * The last payee-sanitiser migration this vault has run. Absent means the
   * one-time history repair has not run yet; the app runs it on vault open.
   */
  payeeSanitiserVersion?: number;
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
  | {
      applied: true;
      alreadyInstalled: boolean;
      /**
       * Shipped metric definitions that could not be written during the install.
       * The kit itself still installed (a ledger must not fail because one
       * definition file is unwritable), so these are reported, not thrown — the
       * same shape the metrics summary uses for a definition that cannot answer.
       */
      metricProblems?: string[];
    }
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
  /**
   * What the write path had to change to make the row honest — the payee
   * sanitiser reports here rather than storing a polluted field silently.
   */
  warnings?: string[];
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

/**
 * The built-in cards a board can carry.
 *
 * The order is the order the pin row offers them in, so a kind added later sits
 * at the end of that row rather than pushing the ones the operator already knows
 * down. Where a card is SEEDED is a different question, answered in `pins.ts`:
 * the companion brief is first on a new board even though it is last here,
 * because it is the card the operator is meant to read before the others.
 */
export const SYSTEM_PIN_KINDS = [
  "goal-progress",
  "deadline",
  "today-week",
  "pending-decisions",
  "recent-log",
  "companion-brief",
] as const;
export type SystemPinKind = (typeof SYSTEM_PIN_KINDS)[number];

/**
 * The companion's brief: the answer to "what would you tell me if you had thirty
 * seconds with me this morning".
 *
 * It exists because the durable things in a daily note — a decision, a watch, a
 * commitment, a pattern — have nowhere to live: every other surface is either a
 * task (which is action) or a signal (a write-only capture list). The brief is
 * the companion's reading of the day, re-derived each day rather than appended
 * to, and the operator is the one who dismisses what it got right or wrong.
 *
 * An ITEM is typed, sourced and expiring. Free text is deliberately not allowed:
 * a line with no kind cannot be measured, a line with no source cannot be
 * checked, and a line with no expiry becomes furniture.
 *
 * A DISMISSAL is the operator's answer to one item — or, for `expired-unseen`,
 * the reader's own record that nobody acted on it. The log is how the companion
 * learns what it got wrong; it is not a second list of items.
 */
export const BRIEF_KINDS = ["watch", "prompt", "ahead", "commitment", "pattern"] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

/** How each kind is named on the card. */
export const BRIEF_KIND_LABELS: Record<BriefKind, string> = {
  watch: "Watch",
  prompt: "Prompt",
  ahead: "Ahead",
  commitment: "Commitment",
  pattern: "Pattern",
};

/** One way the operator answered an item. */
export const BRIEF_DISMISSAL_REASONS = [
  "done",
  "not-useful",
  "wrong",
  "later",
  "expired-unseen",
] as const;
export type BriefDismissalReason = (typeof BRIEF_DISMISSAL_REASONS)[number];

/**
 * The reasons the operator can choose. `expired-unseen` is absent on purpose:
 * it is not clicked by anyone, it is recorded by the reader when an item passes
 * its expiry with no answer.
 */
export const BRIEF_OPERATOR_REASONS = ["done", "not-useful", "wrong", "later"] as const;
export type BriefOperatorReason = (typeof BRIEF_OPERATOR_REASONS)[number];

export const BRIEF_REASON_LABELS: Record<BriefDismissalReason, string> = {
  done: "Done",
  "not-useful": "Not useful",
  wrong: "Wrong",
  later: "Later",
  "expired-unseen": "Expired unseen",
};

/** The most items one brief may carry. A brief is a glance, not a report. */
export const BRIEF_ITEMS_MAX = 5;
/** The item's line, as the operator reads it. */
export const BRIEF_TEXT_MAX = 120;
/** The justification beneath the line. */
export const BRIEF_WHY_MAX = 160;
/** The card's quiet "not refreshed since <date>" line after this long. */
export const BRIEF_STALE_MS = 48 * 60 * 60 * 1000;

export type BriefItem = {
  id: string;
  kind: BriefKind;
  /** The line the operator reads. */
  text: string;
  /** The justification: why this line is on the brief. */
  why: string;
  /** Where it came from: "note 2026-11-05", "signal:<id>", "task:<id>",
   * "conversation 2026-11-04". Free-form on purpose — the brief cites a place
   * in the operator's own record, and those places do not share an id space. */
  sourceRef: string;
  /** null = vault-wide; a slug filters the item to that board's lens. */
  domainSlug: string | null;
  /** 1 is read first, 5 last. */
  priority: number;
  createdAt: string;
  expiresAt: string;
};

export type BriefDismissal = {
  itemId: string;
  dismissedAt: string;
  reason: BriefDismissalReason;
};

/**
 * The brief as stored in `.lifequest/companion-brief.json`, rewritten wholesale
 * on every write.
 *
 * `dismissalLog` is the only part that survives a replacement: a new brief
 * replaces the items, but the record of what the operator did with yesterday's
 * items is the companion's feedback and must not be erased by its next write.
 */
export type CompanionBrief = {
  /** When the companion last wrote the brief; null while nothing is stored. */
  writtenAt: string | null;
  writtenBy: "companion" | null;
  items: BriefItem[];
  dismissalLog: BriefDismissal[];
};

/** One item as the writer sends it. The server mints `id` and `createdAt`, and
 * fills `expiresAt` from the kind when the writer omits it. */
export type BriefItemInput = {
  id?: string;
  kind: BriefKind;
  text: string;
  why: string;
  sourceRef?: string;
  domainSlug?: string | null;
  priority: number;
  expiresAt?: string;
};

/**
 * The brief as the card and the tool read it.
 *
 * `items` is the ACTIVE set: current, not dismissed, sorted by priority. An item
 * whose expiry has passed is not active — it appears in `recentlyExpired` for
 * one day, so the card can draw it faded with the word expired before it
 * disappears, and in `dismissalLog` as `expired-unseen` forever after (inside
 * the log's retention).
 */
export type CompanionBriefRead = {
  writtenAt: string | null;
  writtenBy: "companion" | null;
  items: BriefItem[];
  recentlyExpired: BriefItem[];
  /** The newest twenty, newest first, as the companion tool reports them. */
  dismissals: BriefDismissal[];
  /** Files that could not be trusted (a corrupt record), never a throw. */
  problems: string[];
};

/**
 * The size the operator gave a card by hand, if any.
 *
 * A board card is measured from what it holds unless the operator says
 * otherwise, and Edit card is how they say it: drag the right border to set the
 * width, the bottom border to set the height. Both are stored in rem so the card
 * keeps the size the operator saw whatever the window or the layout unit does.
 *
 * `span` is the board's own coarse answer and the one the companion speaks: 1 is
 * "measure the card's content", 2 is "the whole row". `width` is the fine answer
 * a hand-drag produces; a card whose drag reached the row is stored as `span: 2`
 * and has no `width`, because a span IS a width. `height` is a floor rather than
 * a fixed box: a card is never drawn shorter than its own content, so a stored
 * height that content has outgrown simply stops growing the card — it can never
 * make the card spill.
 *
 * These are optional on every kind of card. A built-in card is app furniture, but
 * it is still a card on the operator's board, and Edit card is offered on it
 * exactly as it is on a view or a page.
 */
export type PinSize = {
  span?: 1 | 2;
  width?: number;
  height?: number;
};

export type Pin =
  | ({ id: string; kind: "system"; system: SystemPinKind } & PinSize)
  | ({ id: string; kind: "page"; domainSlug: string; pageId: string } & PinSize)
  // Agent-built dashboard views (plan.md design, 2026-09-30): a saved view
  // pinned on a board. span 2 is the full row; span 1 is the board's own choice
  // — it measures the card and gives it as many units as its content needs —
  // unless `width` says otherwise.
  //
  // A view pin requires a span because every view card has always had one, and
  // the companion's tools speak that shape. The operator's Edit card gesture is
  // the same for every kind of card: it writes the span/width/height described
  // by `PinSize` above.
  | {
      id: string;
      kind: "view";
      domainSlug: string;
      viewId: string;
      span: 1 | 2;
      width?: number;
      height?: number;
    };

/**
 * A dashboard: the home pin board for one lens, plus the operator's page lock.
 *
 * The lock is the same mechanic a doctrine document carries, on the board
 * instead of a markdown file: unlocked, the operator and the companion change
 * the board in place; locked, the board is read-only and every change becomes a
 * pending Decision. It is stored in the board file so it travels with the board
 * it governs and needs no second registry to stay in step.
 *
 * `locked` is optional on read: a board file written before the lock existed has
 * no field and reads as unlocked, and the flag is persisted on the next write.
 * That is the read-migration the document lock already uses, and it keeps
 * `schemaVersion: 1`.
 *
 * `companionBriefSeeded` is the same kind of read-migration for the companion
 * brief card (2026-11-05). A board written before that card existed has no
 * marker, so the read path puts the brief first, exactly as a new board starts;
 * the marker is written on the board's next write. `true` means the seed has
 * happened, so a brief the operator archives stays archived instead of
 * returning on every read. A board that never carried the card and is never
 * written still gets it, which is the half that makes the feature arrive
 * without a migration step.
 */
export type PinBoard = {
  schemaVersion: 1;
  pins: Pin[];
  locked?: boolean;
  companionBriefSeeded?: boolean;
};

/** One board as a reader sees it: the pins, and whether the page is locked. */
export type PinBoardRead = {
  pins: Pin[];
  locked: boolean;
};

export type PageWriteResult =
  | { applied: true; page: PageRecord }
  | { applied: false; decision: DecisionRecord };

export type PinWriteResult =
  | { applied: true; pins: Pin[]; locked: boolean }
  | { applied: false; decision: DecisionRecord; locked: boolean };

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
  /**
   * The current period's notebook pages (summary only, no bodies), so a review
   * session can see which pages exist and their status without reading each one.
   * Bodies live in `domainSections` (overall) and the compatibility record.
   */
  reviewPages?: ReviewPageSummary[];
  /** Daily notes whose date falls inside the period window, oldest first. */
  dailyNotes: DailyNote[];
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

/**
 * How a card draws. `table`, `bar`, `line` and `metric` are AGGREGATES over the
 * rows the query matches: they fold many rows into label/value groups. `list` is
 * not an aggregate at all — it keeps the rows, one line each, in the card's own
 * columns — which is why it takes no measure and no grouping, and why its result
 * rides in `ViewRunResult.listRows` rather than in `rows`.
 */
export const VIEW_PRESENTATIONS = ["table", "bar", "line", "metric", "list"] as const;
export type ViewPresentation = (typeof VIEW_PRESENTATIONS)[number];

export const VIEW_MEASURES = ["sum", "count", "last"] as const;

export type ViewFilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  /**
   * Presence tests, not comparisons: `is-set` matches a cell that holds
   * something (non-null and not the empty string), `is-not-set` matches a cell
   * that holds nothing (null, absent or empty). They take no value.
   *
   * They exist because SQL NULL comparisons are false, so `neq ""` silently
   * drops rows whose cell was never filled — which is exactly the finance
   * ledger's transfer legs (`transfer_id` is empty) and the one filter gross
   * spend needs. Their meaning is stated once, here and in the SQL builder.
   */
  | "is-set"
  | "is-not-set";

export type ViewFilter = {
  columnId: string;
  op: ViewFilterOp;
  /**
   * The value to compare against. Absent for the presence ops (`is-set`,
   * `is-not-set`), which ask about the cell rather than compare it — the
   * validator refuses a supplied value there instead of silently ignoring it.
   */
  value?: unknown;
};

export type ViewTimeWindow =
  | "all"
  // Anchored on the day the card is drawn, so the query moves with the clock.
  // `today` is one day and `this-week` runs from that day's Monday to the day
  // itself; both exist because a card asked for "today's spending" had no way to
  // say so and an agent froze a literal date in a filter instead.
  | "today"
  | "this-week"
  | "this-month"
  | "last-30-days"
  | "this-year"
  // The trailing window the weekly tables ask for: count back from today's
  // week (Monday start), inclusive. weeks: 1..260.
  | { kind: "last-weeks"; weeks: number }
  // Trailing CALENDAR months, the month today is in among them and partial:
  // `{ months: 4 }` on 14 October spans 1 July .. 14 October. months: 1..120.
  | { kind: "last-months"; months: number }
  // The whole calendar months BEFORE the month today is in — the current month
  // is never one of them. `{ months: 4 }` on 14 October spans 1 June .. 30
  // September, and on 1 November it spans 1 July .. 31 October with no write
  // and nothing to remember. This is the shape "the previous 4 months, not
  // including the current one" asks for, and it is why it exists: `last-weeks`
  // can only approximate a month, and a `custom` window would freeze.
  | { kind: "previous-months"; months: number }
  | { kind: "custom"; start: string; end: string };

/** The period an `avg-per` measure divides a window's total by. */
export type ViewPeriod = "day" | "week" | "month";

/**
 * How a measure folds the rows it matched.
 *
 * `avg` is the average ROW (add every amount, divide by how many there were) and
 * `avg-per` is the average PERIOD (add every amount in the window, divide by how
 * many days, weeks or months that window spans). They are different numbers, and
 * conflating them is exactly what left "the average spend per week across the
 * last 4 weeks" unanswerable: `avg` divides by the number of transactions.
 */
export type ViewMeasure = "sum" | "count" | "last" | "avg" | "avg-per";

export type ViewSort = { by: "label" | "value"; dir: "asc" | "desc" };

/**
 * How a chart's series are coloured.
 *
 * A palette is a NAME, not a list of hex values, because a card is drawn in the
 * app's design system and a saved card must not carry a colour scheme that a
 * skin repaint cannot reach. The names map to theme tokens in CSS, so the same
 * card is legible in every skin.
 */
export const VIEW_PALETTES = ["accent", "warm", "cool", "mono"] as const;
export type ViewPalette = (typeof VIEW_PALETTES)[number];

/**
 * The drawing details a card's author can name — everything that changes how a
 * dataset LOOKS without changing what it holds.
 *
 * These are deliberately separate from the query fields. "Make the bars blue"
 * and "show me the same totals by month instead of by week" are different
 * requests, and a format that mixed them is a format where changing one loses
 * the other.
 */
export type ViewDisplay = {
  /** Which theme palette the series use. Omit for the app's default accent. */
  palette?: ViewPalette | null;
  /** Draw a colour key under the chart. Omitted means "yes when there are series". */
  legend?: boolean | null;
  /** The x-axis caption, e.g. "Month". Never a substitute for the card's title. */
  xLabel?: string | null;
  /** The y-axis caption, e.g. "Spend (ZAR)". */
  yLabel?: string | null;
  /** Print each value on the bar or beside the point. */
  valueLabels?: boolean | null;
};

/**
 * One object in a card: a dataset plus the way it is drawn.
 *
 * There are two kinds, and `from` is what tells them apart:
 *
 *  - a DATABASE object reads rows from a database (the card's, or its own
 *    `databaseId`) and either prints them (`columns`) or folds them into
 *    label/value groups (`groupBy` + `measure`);
 *  - a DERIVED object names an earlier object in `from` and folds THAT object's
 *    rows — the average of a table of monthly totals, for instance.
 *
 * `presentation` is now only how the dataset is drawn. Switching a card from a
 * table to a bar or a line keeps every query field, because the data was never
 * the presentation's business.
 */
export type ViewBlock = {
  id: string;
  title: string;
  presentation: ViewPresentation;
  /**
   * The database this object reads, when it is not the card's. A card may put a
   * transactions table and an accounts count side by side, one object each.
   */
  databaseId?: string | null;
  /**
   * The id of an earlier object in this card whose rows this object folds.
   *
   * This is the transformation that cannot be expressed against a database
   * column: "the average of these monthly totals" is a fold over another
   * object's output, and with no word for it the only answer was a number
   * computed by hand — a picture that never updates.
   */
  from?: string | null;
  /**
   * Split each group into series by this column, e.g. group by month and split
   * by category. A chart with several series gets a legend and one colour per
   * series; a table gets one column per series.
   */
  seriesBy?: string | null;
  /** Drawing details: palette, legend, axis captions, value labels. */
  display?: ViewDisplay | null;
  groupBy: string | null;
  timeBucket: "day" | "week" | "month" | null;
  timeColumnId: string | null;
  timeWindow: ViewTimeWindow;
  filters: ViewFilter[];
  measure: ViewMeasure;
  measureColumnId: string | null;
  /**
   * The period an `avg-per` measure divides by: "day" | "week" | "month".
   *
   * Required exactly when `measure` is "avg-per", and refused on any other
   * measure rather than ignored — a spec that says `per` and gets a plain sum
   * back would be a card quietly showing a different number than the one asked
   * for. It is the block's own field, like the measure pair: a composed card's
   * table panel does not inherit its metric panel's period.
   */
  per: ViewPeriod | null;
  sort: ViewSort;
  limit: number;
  convertToZar: boolean;
  /**
   * The columns a ROW object prints, in order: which database columns the rows
   * show, and in what order, each headed by the column's own name. A row object
   * can draw as `list` (the ledger view) or `table` (the same rows with a table
   * caption); both are the same data. Empty for an aggregate object, whose two
   * columns come from the fold. Naming columns is what makes an object raw.
   */
  columns: string[];
  /** 1 = one grid cell, 2 = the card's full width. */
  span?: 1 | 2;
};

/**
 * A dashboard view (plan.md design, 2026-09-30; composed views 2026-10-07).
 *
 * Two shapes, one file: the ORIGINAL single-aggregate view, whose query fields
 * live at the root, and a COMPOSED view, which carries `blocks` and repeats
 * those same fields at the root as the first block's defaults. `blocks` is
 * present and non-empty exactly when the view is composed, so
 * `effectiveViewBlocks()` — not either shape — is what a reader should use.
 *
 * A budget table plus its trend chart is one card the operator can pin, reorder,
 * and widen; without this it was two views that could only sit apart.
 */
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
  measure: ViewMeasure;
  /** null for a count measure, and for an `avg-per` that counts rows per period. */
  measureColumnId: string | null;
  /** The period an `avg-per` measure divides by; null on every other measure. */
  per: ViewPeriod | null;
  sort: ViewSort;
  /** 1..50; default 12. */
  limit: number;
  /** finance:transactions amount measures only. */
  convertToZar: boolean;
  /** A row object's columns, in order; empty for an aggregate. */
  columns: string[];
  /** Split each group into series by this column; see ViewBlock.seriesBy. */
  seriesBy?: string | null;
  /** Drawing details for the root/one-object shape; see ViewBlock.display. */
  display?: ViewDisplay | null;
  /** Present and non-empty only on a composed view. */
  blocks?: ViewBlock[];
};

/** One block of a composed view resolved against its spec: always complete. */
export type ViewBlockSpec = {
  id: string;
  title: string;
  presentation: ViewPresentation;
  /** The database this object reads; resolved from the block or the card. */
  databaseId?: string | null;
  /** The earlier object whose rows this one folds; null for a database object. */
  from?: string | null;
  /** The column that splits each group into series; null for one series. */
  seriesBy?: string | null;
  /** Drawing details: palette, legend, axis captions, value labels. */
  display?: ViewDisplay | null;
  groupBy: string | null;
  timeBucket: "day" | "week" | "month" | null;
  timeColumnId: string | null;
  timeWindow: ViewTimeWindow;
  filters: ViewFilter[];
  measure: ViewMeasure;
  measureColumnId: string | null;
  /** The period an `avg-per` measure divides by; null on every other measure. */
  per: ViewPeriod | null;
  sort: ViewSort;
  limit: number;
  convertToZar: boolean;
  /** A row object's columns, in order; empty for an aggregate. */
  columns: string[];
  /** 1 = one grid cell, 2 = the card's full width. */
  span?: 1 | 2;
};

/**
 * Exactly what one parameterized read needs: which database, and which rows of
 * it. A block and a whole one-aggregate view both satisfy this, which is how
 * the same SQL builder serves both without either having to fake the other's
 * shape (a block has no `schemaVersion`; a view has no block `id`).
 */
export type ViewQuerySpec = {
  databaseId: string;
  filters: ViewFilter[];
};

/** One cell of a listing row, as the row stores it and never formatted. */
export type ViewListCell = string | number;

/**
 * What one block returned.
 *
 * Two shapes, and the presentation decides which one is filled. An aggregate
 * (`table`, `bar`, `line`, `metric`) folds the matched rows into label/value
 * groups, and they ride in `rows`. A listing (`list`) keeps the rows, and they
 * ride in `listRows`, one entry per row with its cells in `columns` order.
 * Exactly one of the two is ever non-empty — `rows` is empty for a listing and
 * `listRows` is absent for an aggregate — so no reader has to guess which shape
 * it is holding, and a listing can never be mistaken for a two-column fold.
 */
export type ViewRunResult = {
  /** The card's column headings, in order: `["label","value"]`, or a row object's own. */
  columns: string[];
  /** An aggregate's two columns, one row per group. Empty for a row object. */
  rows: Array<[label: string, value: number]>;
  /**
   * The one headline number this dataset can be folded to, when it has one.
   *
   * A metric draws this instead of guessing which row is "the" number. It is
   * present for every aggregate: an ungrouped aggregate's only row, or a fold
   * over the groups (a total across months, the average of monthly totals, the
   * newest month). It is how one object can be drawn as a table AND as the
   * single figure beside it without either shape changing the query.
   */
  summary?: { label: string; value: number } | null;
  /**
   * Series names in draw order, when `seriesBy` split each group. A chart draws
   * one bar cluster or one line per entry, and a table draws one column each.
   */
  series?: string[];
  /**
   * The per-series detail behind `rows`: one entry per (label, series) pair.
   * `rows` remains the per-label total so a metric or a summary still has one
   * number per label, whatever the series are.
   */
  seriesRows?: Array<[label: string, series: string, value: number]>;
  /**
   * A listing's rows: one entry per database row, cells in `columns` order.
   * Absent unless the block's presentation is `list`.
   */
  listRows?: ViewListCell[][];
  warnings: string[];
  /** The single currency when every row shares one; "mixed" or null otherwise. */
  currency: "ZAR" | "USD" | "mixed" | null;
  /**
   * Which of `columns` the `currency` above describes, for a listing — the money
   * column, so a card puts the unit on the column it belongs to rather than on
   * whichever one happens to be last. Absent for an aggregate, whose single
   * value column is the only candidate there is.
   */
  currencyColumn?: string;
};

/**
 * A composed view's run: one result per block, in block order, each carrying
 * the block it came from so a card can title and draw it without re-reading the
 * file. A single-aggregate view also runs through this shape, as one block.
 */
export type ComposedViewRunResult = {
  title: string;
  blocks: Array<{ id: string; title: string; presentation: ViewPresentation; span?: 1 | 2; result: ViewRunResult }>;
  /** Warnings from every block, prefixed with the block that raised them. */
  warnings: string[];
};


