import type { StoreState as MapStoreState } from "./map/types.ts";

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

export type DocumentTarget =
  | { type: "doctrine"; domainSlug: string; kind: DocumentKind }
  | { type: "library"; id: string };

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

export type VaultSettings = {
  hermesBaseUrl: string;
  theme: "system" | "light" | "dark";
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
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
