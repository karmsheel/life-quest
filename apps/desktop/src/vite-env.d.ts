/// <reference types="vite/client" />

import type {
  AgentHire,
  DecisionRecord,
  DocumentKind,
  DocumentStatus,
  DoctrineDocument,
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
  Result,
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
  documentSetStatus: (
    slug: string,
    kind: DocumentKind,
    status: DocumentStatus,
  ) => Promise<Result<DoctrineDocument>>;
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
    domainSlug: string;
    documentKind: DocumentKind;
    title: string;
    rationale?: string | null;
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
