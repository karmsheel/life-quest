/// <reference types="vite/client" />

import type {
  AgentHire,
  DecisionRecord,
  DocumentKind,
  DocumentStatus,
  DoctrineDocument,
  DomainMeta,
  DomainRecord,
  LifeEvent,
  Result,
  VaultSettings,
  VaultSnapshot,
} from "@lifequest/vault-core";

type RecentVaultEntry = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
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
  domainSetActive: (slug: string) => Promise<Result<string>>;
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
  hermesScanAgents: () => Promise<Result<{ id: string; name: string }[]>>;
  onVaultFileChanged: (cb: (payload: { path: string }) => void) => () => void;
};

declare global {
  interface Window {
    lifequest?: LifequestApi;
  }
}

export type { LifequestApi, RecentVaultEntry, Result };
