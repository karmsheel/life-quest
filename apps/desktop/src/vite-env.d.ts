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
  ManualDecisionRecord,
  Project,
  ProjectCreateInput,
  ProjectListResult,
  ProjectStatus,
  ProjectUpdatePatch,
  LifeEvent,
  MapCommand,
  MapStoreState,
  AutomationInput,
  AutomationRecord,
  AutomationRunPatch,
  PageBlock,
  PageListEntry,
  PageRecord,
  PageWriteResult,
  DailyNote,
  DailyNoteIndexEntry,
  IdealStateCreateInput,
  IdealStateDocument,
  IdealStateIndexEntry,
  IdealStateUpdatePatch,
  ImageMimeType,
  ImageSaveInput,
  ImageUpdatePatch,
  VaultImage,
  VisionBoard,
  VisionBoardBlock,
  PeriodPack,
  Pin,
  PinBoardRead,
  PinWriteResult,
  PlanningStub,
  Result,
  ReviewCadence,
  ReviewPrepopulateResult,
  ReviewRecord,
  ReviewSkill,
  ScriptApplyResult,
  ScriptRunResult,
  SavedView,
  ComposedViewRunResult,
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
  PageContextInput,
} from "../electron/companion-client";
// The update decision is declared once, in the main-side module that makes it:
// the shape main hands the renderer and the shape the badge renders cannot drift
// apart, and no second copy of the version rules is born here.
import type { UpdateAsset, UpdateDecision } from "../electron/updater";

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
      /**
       * Set when the model probe found the pinned model missing from this
       * profile's catalog. Arrives AFTER the first ready status, on
       * `onCompanionStatusChanged`, so the splash never waits for it.
       */
      modelWarning?: string;
    }
  | { kind: "needs_install" }
  | { kind: "profile_error"; message: string; path?: string }
  | { kind: "port_busy"; port: number }
  /**
   * What the Hermes CLI said when the gateway could not be brought up. Whichever
   * stream carried it — Hermes prints its refusals on stdout — plus the exit-code
   * fallback when it said nothing at all.
   */
  | { kind: "gateway_exited"; detail: string }
  | { kind: "disconnected" }
  | { kind: "hermes_too_old"; version?: string }
  | { kind: "auth_error" };

/** One installed Hermes profile, as the picker lists it. */
type CompanionProfileInfo = {
  name: string;
  path: string;
  /** The root home itself, which the multiplexer serves with no `/p/` prefix. */
  isDefault: boolean;
  hasConfig: boolean;
  hasSoul: boolean;
  hasEnv: boolean;
};

type CompanionProfilesResult = {
  /** The profile the companion runs on right now. */
  active: string;
  profiles: CompanionProfileInfo[];
};

type CompanionInstructionsContext = {
  domainName: string | null;
  domainSlug: string | null;
  /** Which home Dashboard board the operator is looking at: null = Overview. */
  viewingBoard?: string | null;
  /**
   * That board's page lock. Unlocked, the companion's dashboard writes land;
   * locked, the same calls file a pending Decision. Absent means no board is in
   * view, which gates nothing.
   */
  viewingBoardLocked?: boolean;
  /** The one dashboard card the operator put in front of this chat, if any. */
  focusedCard?: FocusedCardContext | null;
  /**
   * The page the operator has open, when the composer's page-context pill is
   * on. Absent means the pill is off, and the turn is the turn it always was.
   */
  pageContext?: PageContextInput | null;
  aboutMe: string;
  locked: boolean;
  vaultOpen: boolean;
  reviewContext?: string;
  /** The page material an automation opened this chat with, already fenced. */
  automationContext?: string;
  fileUnsolicited?: boolean;
};

/**
 * The dashboard card the chat is about, in the flat shape the per-turn
 * instructions are built from. Its ids are the ones the companion's card tools
 * address a view by, so the model is told how to change the card it was given.
 */
type FocusedCardContext = {
  /** What the board calls the card, read off its own heading. */
  label: string;
  pinId: string;
  kind: "system" | "view" | "page";
  /** The board it sits on: null is the Overview board. */
  boardSlug: string | null;
  domainSlug: string | null;
  viewId?: string;
  pageId?: string;
  system?: string;
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
  | { type: "error"; message: string }
  /** Pending Decisions this turn's fenced proposals became (app-sent). */
  | { type: "decisions.filed"; ids: string[]; titles: string[] }
  /** Proposals in this turn's reply that could not be filed, and why (app-sent). */
  | { type: "decisions.problem"; message: string };

/**
 * One frame of the companion's stream. The session id sits on the envelope
 * rather than on each event: several turns can be in the air at once, and the
 * renderer routes a delta by the chat that owns it — never by whichever thread
 * happens to be on screen.
 */
type CompanionStreamFrame = {
  sessionId: string;
  event: ChatStreamEvent;
};

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

/** One skill in the companion's library, as Settings lists it. */
export type CompanionSkill = {
  name: string;
  description: string;
  category: string;
  relPath: string;
  /** True for the skills this app's own domain owns — skills/lifequest/*. */
  lifequest: boolean;
  bundled: boolean;
  pinned: boolean;
  useCount: number;
  viewCount: number;
  lastUsedAt: string | null;
  version: string | null;
  tags: string[];
};

/** What the companion is told, and what it has been given to read. */
export type CompanionPrompts = {
  profilePath: string;
  soul: { path: string; text: string; seeded: boolean; edited: boolean };
  instructions: { text: string; context: CompanionInstructionsContext };
  skills: CompanionSkill[];
  soulSeedPath: string;
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
  manualDecisionList: () => Promise<Result<ManualDecisionRecord[]>>;
  manualDecisionCreate: (input: {
    title: string;
    rationale?: string | null;
    domainSlug?: string | null;
  }) => Promise<Result<ManualDecisionRecord>>;
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
  /**
   * Every Hermes profile this install has, plus the one the companion runs on
   * — the setup screen's way out of a stuck connect, and Settings' way to
   * switch later.
   */
  companionProfilesList: () => Promise<CompanionProfilesResult>;
  /**
   * Move the companion onto one profile (an installed one, or the app's own
   * `lifequest`, which is created on the spot) and bring it up. Answers with
   * the new status, so the caller re-renders from one call.
   */
  companionUseProfile: (name: string) => Promise<CompanionStatus>;
  companionSessionsList: () => Promise<Result<HermesSession[]>>;
  companionSessionCreate: (title: string) => Promise<Result<HermesSession>>;
  companionSessionMessages: (
    id: string,
  ) => Promise<
    Result<{ role: "user" | "assistant"; content: string; at?: number }[]>
  >;
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
  /** The system prompts and skill library the companion is actually given. */
  companionPrompts: () => Promise<
    { ok: true; value: CompanionPrompts } | { ok: false; error: string }
  >;
  onCompanionStream: (cb: (frame: CompanionStreamFrame) => void) => () => void;
  mapGetState: () => Promise<Result<MapStoreState>>;
  mapApply: (command: MapCommand) => Promise<Result<VaultSnapshot>>;
  goalsApply: (command: GoalsCommand) => Promise<Result<VaultSnapshot>>;
  automationList: () => Promise<Result<AutomationRecord[]>>;
  automationCreate: (input: AutomationInput) => Promise<Result<AutomationRecord[]>>;
  automationUpdate: (
    id: string,
    input: AutomationInput,
  ) => Promise<Result<AutomationRecord[]>>;
  automationDelete: (id: string) => Promise<Result<AutomationRecord[]>>;
  automationMarkRun: (
    id: string,
    patch: AutomationRunPatch,
  ) => Promise<Result<AutomationRecord[]>>;
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
  /** The cadence's standing rules; the shipped default when no file exists. */
  reviewSkillGet: (cadence: ReviewCadence) => Promise<Result<ReviewSkill>>;
  reviewSkillWrite: (
    cadence: ReviewCadence,
    markdown: string,
  ) => Promise<Result<ReviewSkill>>;
  /**
   * Fill a review from its cadence's skill. Runs before the agent is asked for
   * anything, so the figures are there whether or not a gateway is up.
   */
  reviewPrepopulate: (
    cadence: ReviewCadence,
    period: string,
    scope: "overall" | string,
  ) => Promise<Result<ReviewPrepopulateResult>>;
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
  /** The one note a day has. Missing is `Daily note not found`, not an error. */
  dailyNoteGet: (date: string) => Promise<Result<DailyNote>>;
  dailyNoteWrite: (date: string, body: string) => Promise<Result<DailyNote>>;
  dailyNoteList: () => Promise<Result<DailyNoteIndexEntry[]>>;
  dailyNoteWindow: (start: string, end: string) => Promise<Result<DailyNote[]>>;
  /**
   * Ideal State: any number of titled, freeform markdown documents in the
   * Define wing. The operator is the only author.
   */
  idealStateList: () => Promise<Result<IdealStateIndexEntry[]>>;
  idealStateGet: (id: string) => Promise<Result<IdealStateDocument>>;
  idealStateCreate: (
    input: IdealStateCreateInput,
  ) => Promise<Result<IdealStateDocument>>;
  idealStateUpdate: (
    id: string,
    patch: IdealStateUpdatePatch,
  ) => Promise<Result<IdealStateDocument>>;
  idealStateDelete: (id: string) => Promise<Result<IdealStateDocument>>;
  /**
   * Define → Images: the vault-level picture library and the one vision
   * document written beside it. The renderer hands over bytes and asks for
   * bytes back; it never names a vault path.
   */
  imagesList: () => Promise<Result<VaultImage[]>>;
  imagesSave: (input: ImageSaveInput) => Promise<Result<VaultImage>>;
  imagesRead: (
    relPath: string,
  ) => Promise<Result<{ bytes: Uint8Array; mime: ImageMimeType }>>;
  imagesUpdate: (
    id: string,
    patch: ImageUpdatePatch,
  ) => Promise<Result<VaultImage>>;
  imagesDelete: (id: string) => Promise<Result<{ id: string }>>;
  imagesBoardGet: () => Promise<Result<VisionBoard>>;
  imagesBoardSave: (input: {
    blocks: VisionBoardBlock[];
  }) => Promise<Result<VisionBoard>>;
  deadlineDismiss: () => Promise<Result<true>>;
  deadlineGetDismissed: () => Promise<Result<string | null>>;
  deadlineMaybeNotify: () => Promise<
    Result<{ ok: true; notified: boolean; title: string; body: string }>
  >;
  /**
   * Auto-update. `updateCheck` without `force` answers with the session's one
   * answer — the launch's check; `force` re-reads the feed, which is what the
   * rail's build number and Settings do when the operator asks by hand.
   * `updateInstall` downloads the release's installer, hands it to Windows, and
   * quits the app so the installer can replace it.
   */
  updateCheck: (
    options?: { force?: boolean },
  ) => Promise<
    { ok: true; decision: UpdateDecision } | { ok: false; error: string }
  >;
  updateInstall: (
    asset: UpdateAsset,
  ) => Promise<
    | { ok: true; launched: true; installer: string; bytes: number }
    | { ok: false; error: string }
  >;
  updateOpenReleasePage: (url: string) => Promise<Result<true>>;
  onUpdateProgress: (
    cb: (progress: { downloaded: number; total: number }) => void,
  ) => () => void;
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
  pinsList: (domainSlug: string | null) => Promise<Result<PinBoardRead>>;
  pinsSet: (domainSlug: string | null, pins: Pin[]) => Promise<Result<PinWriteResult>>;
  /** The Dashboard page lock. User-only; the board read reports the state. */
  pinsSetLocked: (domainSlug: string | null, locked: boolean) => Promise<Result<PinBoardRead>>;
  // Agent-built dashboard views (plan.md design, slices 2/3)
  viewList: (slug: string) => Promise<Result<SavedView[]>>;
  viewGet: (slug: string, viewId: string) => Promise<Result<SavedView>>;
  viewSave: (slug: string, spec: Record<string, unknown>, viewId?: string) => Promise<Result<SavedView>>;
  viewDelete: (slug: string, viewId: string) => Promise<Result<{ id: string }>>;
  viewRun: (slug: string, spec: Record<string, unknown>) => Promise<Result<ComposedViewRunResult>>;
  viewRunSaved: (slug: string, viewId: string) => Promise<Result<ComposedViewRunResult>>;
  // KAR-61 finance kit
  kitInstallFinance: () => Promise<Result<unknown>>;
  kitList: (slug: string) => Promise<Result<unknown>>;
  kitFinanceSettings: () => Promise<Result<unknown>>;
  kitSetCaptureAccount: (accountRowId: string | null) => Promise<Result<unknown>>;
  /**
   * Read the USD→ZAR rate from the configured source and store it. The fetch
   * happens in the main process, so this is the renderer's only way to ask for
   * one and never a URL the renderer itself opens.
   */
  fxRefresh: () => Promise<Result<unknown>>;
  /** Point the vault at another rate source; null url restores the default. */
  fxSetSource: (input: {
    url?: string | null;
    path?: string | null;
    asOfPath?: string | null;
  }) => Promise<Result<unknown>>;
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
  /**
   * The vault changed: re-read whatever the page draws. `revision` only ever
   * moves forward, so a listener can ignore a value it has already seen.
   */
  onVaultDataChanged: (cb: (revision: number) => void) => () => void;
  /**
   * The companion's status moved after it was first reported — the model probe
   * answers after the ready status, so a late verdict reaches the screen here.
   */
  onCompanionStatusChanged: (cb: (status: CompanionStatus) => void) => () => void;
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
  CompanionProfileInfo,
  CompanionProfilesResult,
  CompanionPrompts,
  CompanionRuntimeOverride,
  CompanionStreamFrame,
  CompanionSkill,
  CompanionStatus,
  FocusedCardContext,
  HermesSession,
  LifequestApi,
  PageContextInput,
  RecentVaultEntry,
  Result,
  UpdateAsset,
  UpdateDecision,
};
