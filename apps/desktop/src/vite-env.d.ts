/// <reference types="vite/client" />

import type {
  AgentHire,
  ConnectedAgent,
  DatabaseListEntry,
  DatabaseMeta,
  DatabaseRow,
  DecisionRecord,
  DocumentKind,
  DoctrineDocument,
  DocumentTarget,
  DomainBooksExport,
  DomainMeta,
  DomainRecord,
  GoalsCommand,
  LibraryCreateInput,
  LibraryDocument,
  LibraryListResult,
  LibraryUpdatePatch,
  Project,
  ProjectCreateInput,
  ProjectListResult,
  ProjectStatus,
  ProjectUpdatePatch,
  LifeEvent,
  MapCommand,
  MapStoreState,
  PageBlock,
  PageListEntry,
  PageRecord,
  PageWriteResult,
  PeriodPack,
  Pin,
  PinWriteResult,
  PlanningStub,
  Result,
  ReviewCadence,
  ReviewRecord,
  ScriptApplyResult,
  ScriptRunResult,
  SavedView,
  ViewRunResult,
  SignalChainListResult,
  SignalCreateInput,
  SignalRecord,
  SignalUpdatePatch,
  VaultSettings,
  VaultSnapshot,
} from "@lifequest/vault-core";
// The composer's model/thinking pick, declared once in the main-side module the
// renderer already imports its session helpers from — so the shape the pill
// sends and the shape main hands the gateway cannot drift apart.
import type {
  CompanionModelCatalog,
  CompanionModelChoice,
  CompanionModelProvider,
  CompanionRuntimeOverride,
} from "../electron/companion-client";

type RecentVaultEntry = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
};

type CompanionStatus =
  | {
      kind: "ready";
      port: number;
      baseUrl: string;
      startedByLifeQuest: boolean;
      profilePath: string;
      cliPath: string;
      childPid: number | null;
      /** Set when the startup probe found the pinned model retired. */
      modelWarning?: string;
    }
  | { kind: "needs_install" }
  | { kind: "profile_error"; message: string; path?: string }
  | { kind: "port_busy"; port: number }
  | { kind: "gateway_exited"; stderr: string }
  | { kind: "disconnected" }
  | { kind: "hermes_too_old"; version?: string }
  | { kind: "auth_error" };

type CompanionInstructionsContext = {
  domainName: string | null;
  domainSlug: string | null;
  /** Which home Dashboard board the operator is looking at: null = Overview. */
  viewingBoard?: string | null;
  aboutMe: string;
  locked: boolean;
  vaultOpen: boolean;
  reviewContext?: string;
  fileUnsolicited?: boolean;
};

type ChatStreamEvent =
  | { type: "run.started"; runId: string }
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; name: string; target: string }
  | { type: "tool.completed"; name: string }
  | { type: "approval.request"; runId: string; requestId: string; summary: string }
  | { type: "run.stopped" }
  | { type: "run.incomplete"; reason: string }
  | { type: "run.completed" }
  | { type: "error"; message: string };

type HermesSession = {
  id: string;
  title: string;
  preview: string | null;
  lastActive: number | null;
  /** Durable Hermes-side flag: pinned chats sort into their own section. */
  pinned: boolean;
};

/**
 * KAR-70: the two loopback doors and their own bind errors. A door that
 * failed to bind has an empty url and a non-null error of its own.
 */
export type McpDoors = {
  localUrl: string;
  inviteUrl: string;
  localError: string | null;
  inviteError: string | null;
};

/** Frozen IPC API exposed on window.lifequest via preload. */
type LifequestApi = {
  vaultCreate: (path: string, name?: string) => Promise<Result<VaultSnapshot>>;
  vaultOpen: (path: string) => Promise<Result<VaultSnapshot>>;
  vaultGetSnapshot: () => Promise<Result<VaultSnapshot | null>>;
  vaultListRecent: () => Promise<RecentVaultEntry[]>;
  dialogOpenDirectory: () => Promise<string | null>;
  domainCreate: (input: {
    name: string;
    slug?: string;
  }) => Promise<Result<DomainRecord>>;
  domainUpdate: (
    slug: string,
    patch: Partial<
      Pick<DomainMeta, "name" | "description" | "color" | "sortOrder">
    >,
  ) => Promise<Result<DomainRecord>>;
  domainArchive: (slug: string) => Promise<Result<DomainRecord>>;
  domainUnarchive: (slug: string) => Promise<Result<DomainRecord>>;
  domainDelete: (slug: string) => Promise<Result<{ slug: string }>>;
  domainSetActive: (slug: string | null) => Promise<Result<string | null>>;
  domainGetActive: () => Promise<string | null>;
  documentGet: (
    slug: string,
    kind: DocumentKind,
  ) => Promise<Result<DoctrineDocument>>;
  documentSave: (
    slug: string,
    kind: DocumentKind,
    bodyMarkdown: string,
    title?: string,
  ) => Promise<Result<DoctrineDocument>>;
  documentSetLocked: (
    slug: string,
    kind: DocumentKind,
    locked: boolean,
  ) => Promise<Result<DoctrineDocument>>;
  librarySetLocked: (id: string, locked: boolean) => Promise<Result<LibraryDocument>>;
  documentMediaSave: (
    slug: string,
    input: { bytes: Uint8Array; mime: string },
  ) => Promise<Result<{ relPath: string }>>;
  documentMediaRead: (
    slug: string,
    relPath: string,
  ) => Promise<Result<{ bytes: Uint8Array; mime: string }>>;
  decisionList: () => Promise<Result<DecisionRecord[]>>;
  decisionCreate: (input: {
    target: DocumentTarget;
    rationale?: string | null;
    proposedTitle?: string | null;
    previousTitle?: string | null;
    proposedBodyMarkdown: string;
    previousBodyMarkdown?: string | null;
  }) => Promise<Result<DecisionRecord>>;
  decisionResolve: (
    id: string,
    resolution: "approved" | "rejected",
  ) => Promise<Result<DecisionRecord>>;
  logList: () => Promise<Result<LifeEvent[]>>;
  signalChainList: () => Promise<Result<SignalChainListResult>>;
  signalChainCreate: (input: SignalCreateInput) => Promise<Result<SignalRecord>>;
  signalChainUpdate: (
    id: string,
    patch: SignalUpdatePatch,
  ) => Promise<Result<SignalRecord>>;
  signalChainDelete: (id: string) => Promise<Result<SignalRecord>>;
  libraryList: () => Promise<Result<LibraryListResult>>;
  libraryCreate: (input: LibraryCreateInput) => Promise<Result<LibraryDocument>>;
  libraryGet: (id: string) => Promise<Result<LibraryDocument>>;
  libraryUpdate: (
    id: string,
    patch: LibraryUpdatePatch,
  ) => Promise<Result<LibraryDocument>>;
  libraryDelete: (id: string) => Promise<Result<LibraryDocument>>;
  // KAR-7 projects: direct operator writes, no Decision.
  projectsList: () => Promise<Result<ProjectListResult>>;
  projectsGet: (id: string) => Promise<Result<Project>>;
  projectsCreate: (input: ProjectCreateInput) => Promise<Result<Project>>;
  projectsUpdate: (
    id: string,
    patch: ProjectUpdatePatch,
  ) => Promise<Result<Project>>;
  agentsList: () => Promise<Result<AgentHire[]>>;
  agentsHire: (input: {
    hermesAgentId: string;
    name: string;
    roleLabel?: string | null;
    domainSlug?: string | null;
  }) => Promise<Result<AgentHire>>;
  agentsDismiss: (id: string) => Promise<Result<AgentHire>>;
  settingsUpdate: (
    patch: Partial<VaultSettings>,
  ) => Promise<Result<VaultSettings>>;
  secretsHasHermesKey: () => Promise<boolean>;
  secretsSetHermesKey: (key: string) => Promise<Result<true>>;
  secretsClearHermesKey: () => Promise<Result<true>>;
  hermesTest: () => Promise<Result<{ latencyMs: number; baseUrl: string }>>;
  hermesChat: (
    messages: { role: string; content: string }[],
  ) => Promise<Result<{ content: string }>>;
  hermesChatTools: (
    messages: { role: string; content: string }[],
    hire?: { id: string; name: string },
  ) => Promise<Result<{ content: string }>>;
  hermesScanAgents: () => Promise<Result<{ id: string; name: string }[]>>;
  mcpGetUrl: () => Promise<string>;
  mcpGetError: () => Promise<string | null>;
  mcpGetDoors: () => Promise<McpDoors>;
  connectedAgentsList: () => Promise<Result<ConnectedAgent[]>>;
  connectedAgentsUpdate: (
    id: string,
    patch: { access?: "read" | "write"; domainSlugs?: string[]; schedule?: boolean },
  ) => Promise<Result<ConnectedAgent>>;
  connectedAgentsRevoke: (id: string) => Promise<Result<ConnectedAgent>>;
  connectedAgentsInvite: () =>
    Promise<Result<{ id: string; code: string; expiresAt: string }>>;
  connectedAgentsListInvites: () =>
    Promise<Result<{ id: string; expiresAt: string }[]>>;
  connectedAgentsDropInvite: (id: string) =>
    Promise<Result<{ dropped: true }>>;
  companionEnsure: () => Promise<CompanionStatus>;
  companionStatus: () => Promise<CompanionStatus>;
  companionSessionsList: () => Promise<Result<HermesSession[]>>;
  companionSessionCreate: (title: string) => Promise<Result<HermesSession>>;
  companionSessionMessages: (
    id: string,
  ) => Promise<Result<{ role: "user" | "assistant"; content: string }[]>>;
  companionSessionPatch: (
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) => Promise<Result<HermesSession>>;
  companionSessionDelete: (
    id: string,
  ) => Promise<Result<{ id: string; deleted: boolean }>>;
  /** The gateway's model inventory for this profile, for the composer's pills. */
  companionModelOptions: () => Promise<
    { ok: true; value: CompanionModelCatalog } | { ok: false; error: string }
  >;
  companionChatStream: (payload: {
    sessionId: string;
    input: string;
    instructionsContext: CompanionInstructionsContext;
    /** The composer's model / thinking-level pick for this turn. */
    runtime?: CompanionRuntimeOverride | null;
    /** The receipt waiting in main for this turn, by the path main minted. */
    receiptRelPath?: string | null;
  }) => Promise<Result<true> | { ok: true } | { ok: false; error: string }>;
  companionApproval: (payload: {
    runId: string;
    requestId: string;
    allow: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  companionRunStop: (
    runId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  companionOpenProfileFolder: () => Promise<void>;
  companionGetFiling: () => Promise<boolean>;
  companionSetFiling: (enabled: boolean) => Promise<void>;
  onCompanionStream: (cb: (evt: ChatStreamEvent) => void) => () => void;
  mapGetState: () => Promise<Result<MapStoreState>>;
  mapApply: (command: MapCommand) => Promise<Result<VaultSnapshot>>;
  goalsApply: (command: GoalsCommand) => Promise<Result<VaultSnapshot>>;
  reviewGet: (
    cadence: ReviewCadence,
    period: string,
  ) => Promise<Result<ReviewRecord>>;
  reviewEnsure: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<Result<ReviewRecord>>;
  reviewWrite: (
    cadence: ReviewCadence,
    period: string,
    body: string,
  ) => Promise<Result<ReviewRecord>>;
  reviewMarkDone: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<Result<ReviewRecord>>;
  reviewUnlock: (
    cadence: ReviewCadence,
    period: string,
  ) => Promise<Result<ReviewRecord>>;
  reviewPeriodPack: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<Result<PeriodPack>>;
  planningEnsure: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<Result<PlanningStub>>;
  reviewStartOrResume: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<
    Result<{ sessionId: string; created: boolean; kickoff: string }>
  >;
  planningStartOrResume: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<
    Result<{ sessionId: string; created: boolean; kickoff: string }>
  >;
  deadlineDismiss: () => Promise<Result<true>>;
  deadlineGetDismissed: () =>
    Promise<Result<{ ok: true; value: string | null }>>;
  deadlineMaybeNotify: () => Promise<
    Result<{ ok: true; notified: boolean; title: string; body: string }>
  >;
  // KAR-55 domain databases
  dbList: (domainSlug: string | null) => Promise<Result<DatabaseListEntry[]>>;
  dbGet: (slug: string, dbId: string) => Promise<Result<DatabaseMeta>>;
  dbCreate: (slug: string, input: { name: string }) => Promise<Result<DatabaseMeta>>;
  dbAddColumn: (slug: string, dbId: string, input: {
    name: string;
    type: string;
    options?: string[];
    relationDatabaseId?: string;
  }) => Promise<Result<DatabaseMeta>>;
  dbListRows: (slug: string, dbId: string) => Promise<Result<DatabaseRow[]>>;
  dbGetRow: (slug: string, dbId: string, rowId: string) => Promise<Result<DatabaseRow>>;
  dbUpsertRow: (slug: string, dbId: string, input: {
    id?: string;
    cells: Record<string, unknown>;
  }) => Promise<Result<DatabaseRow>>;
  dbDeleteRow: (slug: string, dbId: string, rowId: string) => Promise<Result<{ id: string }>>;
  dbFileSave: (slug: string, input: {
    bytes: Uint8Array;
    mime: string;
    name: string;
  }) => Promise<Result<{ relPath: string; fileId: string }>>;
  /**
   * Stores one receipt in the finance file store and leaves the copy for the
   * next turn waiting in main. The bytes never come back through this bridge.
   */
  receiptAttach: (input: {
    bytes: Uint8Array;
    mime: string;
    name: string;
  }) => Promise<Result<{ relPath: string; fileId: string; name: string; size: number }>>;
  // KAR-58 books export and restore
  dbExportBooks: (slug: string) => Promise<Result<DomainBooksExport>>;
  dbRestoreBooks: (
    slug: string,
    options: { confirm: boolean },
  ) => Promise<Result<{ databases: number; rows: number }>>;
  // KAR-59 adapter IPC
  dbLinkAdapter: (slug: string, dbId: string, input: {
    kind: "google-sheet" | "notion" | "url";
    bindingId?: string;
    secret: string;
    sotMode: "linked-canonical" | "local-canonical-mirror";
  }) => Promise<Result<unknown>>;
  dbUnlinkAdapter: (slug: string, dbId: string) => Promise<Result<unknown>>;
  dbSync: (slug: string, dbId?: string) => Promise<Result<unknown>>;
  dbListConflicts: (slug: string, dbId?: string) => Promise<Result<unknown>>;
  dbResolveConflict: (
    slug: string,
    conflictId: string,
    choice: "keep-local" | "keep-remote" | "skip",
  ) => Promise<Result<unknown>>;
  // KAR-60 pages and pins
  pageList: (domainSlug: string | null) => Promise<Result<PageListEntry[]>>;
  pageGet: (slug: string, pageId: string) => Promise<Result<PageRecord>>;
  pageCreate: (slug: string, input: { title: string }) => Promise<Result<PageRecord>>;
  pageUpdate: (slug: string, pageId: string, input: {
    title?: string;
    blocks?: PageBlock[];
  }) => Promise<Result<PageWriteResult>>;
  pageDelete: (slug: string, pageId: string) => Promise<Result<{ id: string }>>;
  // KAR-56 script blocks
  scriptApply: (input: {
    domainSlug: string;
    pageId: string;
    blockId?: string;
    name: string;
    source: string;
  }) => Promise<Result<ScriptApplyResult>>;
  scriptRun: (input: { domainSlug: string; source: string }) => Promise<Result<ScriptRunResult>>;
  pinsList: (domainSlug: string | null) => Promise<Result<Pin[]>>;
  pinsSet: (domainSlug: string | null, pins: Pin[]) => Promise<Result<PinWriteResult>>;
  // Agent-built dashboard views (plan.md design, slices 2/3)
  viewList: (slug: string) => Promise<Result<SavedView[]>>;
  viewGet: (slug: string, viewId: string) => Promise<Result<SavedView>>;
  viewSave: (slug: string, spec: Record<string, unknown>, viewId?: string) => Promise<Result<SavedView>>;
  viewDelete: (slug: string, viewId: string) => Promise<Result<{ id: string }>>;
  viewRun: (slug: string, spec: Record<string, unknown>) => Promise<Result<ViewRunResult>>;
  viewRunSaved: (slug: string, viewId: string) => Promise<Result<ViewRunResult>>;
  // KAR-61 finance kit
  kitInstallFinance: () => Promise<Result<unknown>>;
  kitList: (slug: string) => Promise<Result<unknown>>;
  kitFinanceSettings: () => Promise<Result<unknown>>;
  kitSetCaptureAccount: (accountRowId: string | null) => Promise<Result<unknown>>;
  // KAR-57 finance plan loop
  financeBudgetVsActual: (asOf: string) => Promise<Result<unknown>>;
  financeNetWorth: (asOf: string) => Promise<Result<unknown>>;
  financeScenarioCompare: (input: {
    asOf: string;
    assumptionSetId: string;
    compareSetId?: string | null;
  }) => Promise<Result<unknown>>;
  financeSaveAssumptionSet: (input: {
    rowId: string;
    name: string;
    horizonMonths: number;
    deltas: unknown[];
  }) => Promise<Result<unknown>>;
  // KAR-53 ingest
  ingestFile: (slug: string, input: {
    databaseId: string;
    bytes: Uint8Array;
    mime: string;
    name: string;
    extractedRows?: Record<string, string>[];
  }) => Promise<Result<unknown>>;
  ingestProposeMapping: (slug: string, input: {
    mappingId?: string;
    databaseId: string;
    fingerprint: string;
    sourceKind: string;
    columns: Array<{ source: string; columnId: string }>;
  }) => Promise<Result<unknown>>;
  ingestListMappings: (slug: string, databaseId?: string) => Promise<Result<unknown>>;
  ingestListBatches: (slug: string, databaseId?: string) => Promise<Result<unknown>>;
  ingestListRows: (slug: string, batchId: string) => Promise<Result<unknown>>;
  ingestEditRow: (slug: string, batchId: string, rowId: string, cells: Record<string, unknown>) => Promise<Result<unknown>>;
  ingestAccept: (slug: string, batchId: string, rowIds?: string[]) => Promise<Result<unknown>>;
  ingestReject: (slug: string, batchId: string, rowIds?: string[]) => Promise<Result<unknown>>;
  onVaultFileChanged: (cb: (payload: { path: string }) => void) => () => void;
  windowChrome: {
    get: () => Promise<{ overlay: boolean; platform: string }>;
    setTitleBarOverlay: (opts: {
      color: string;
      symbolColor: string;
    }) => Promise<void>;
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
  };
};

declare global {
  interface Window {
    lifequest?: LifequestApi;
    __LQ_SPLASH_T0?: number;
  }
}

export type {
  ChatStreamEvent,
  CompanionInstructionsContext,
  CompanionModelCatalog,
  CompanionModelChoice,
  CompanionModelProvider,
  CompanionRuntimeOverride,
  CompanionStatus,
  HermesSession,
  LifequestApi,
  RecentVaultEntry,
  Result,
};
