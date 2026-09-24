/// <reference types="vite/client" />

import type {
  AgentHire,
  DatabaseListEntry,
  DatabaseMeta,
  DatabaseRow,
  DecisionRecord,
  DocumentKind,
  DoctrineDocument,
  DocumentTarget,
  DomainMeta,
  DomainRecord,
  GoalsCommand,
  LibraryCreateInput,
  LibraryDocument,
  LibraryListResult,
  LibraryUpdatePatch,
  LifeEvent,
  MapCommand,
  MapStoreState,
  PeriodPack,
  PlanningStub,
  Result,
  ReviewCadence,
  ReviewRecord,
  SignalChainListResult,
  SignalCreateInput,
  SignalRecord,
  SignalUpdatePatch,
  VaultSettings,
  VaultSnapshot,
} from "@lifequest/vault-core";

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
  aboutMe: string;
  locked: boolean;
  vaultOpen: boolean;
  reviewContext?: string;
};

type ChatStreamEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; name: string }
  | { type: "tool.completed"; name: string; ok: boolean }
  | { type: "approval.request"; runId: string; requestId: string; summary: string }
  | { type: "run.completed" }
  | { type: "error"; message: string };

type HermesSession = { id: string; title: string };

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
  ) => Promise<Result<{ content: string }>>;
  hermesScanAgents: () => Promise<Result<{ id: string; name: string }[]>>;
  mcpGetUrl: () => Promise<string>;
  mcpGetError: () => Promise<string | null>;
  companionEnsure: () => Promise<CompanionStatus>;
  companionStatus: () => Promise<CompanionStatus>;
  companionSessionsList: () => Promise<Result<HermesSession[]>>;
  companionSessionCreate: (title: string) => Promise<Result<HermesSession>>;
  companionSessionMessages: (
    id: string,
  ) => Promise<Result<{ role: string; content: string }[]>>;
  companionChatStream: (payload: {
    sessionId: string;
    input: string;
    instructionsContext: CompanionInstructionsContext;
  }) => Promise<Result<true> | { ok: true } | { ok: false; error: string }>;
  companionApproval: (payload: {
    runId: string;
    requestId: string;
    allow: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  companionOpenProfileFolder: () => Promise<void>;
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
  CompanionStatus,
  HermesSession,
  LifequestApi,
  RecentVaultEntry,
  Result,
};
