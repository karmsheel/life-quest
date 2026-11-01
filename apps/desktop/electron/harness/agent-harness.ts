// The one contract a companion implements.
//
// Everything here has a caller today: the 17 `companion:*` channels, the
// review dock, and the chat panel. Anything Hermes-specific (profiles, doors,
// the MCP profile writer) is deliberately *not* on this interface — it lives on
// `ProfiledHarness`, so an embedded companion is not asked to pretend it has a
// profile.
import type {
  ChatStreamEvent,
  CompanionModelCatalog,
  TranscriptMessage,
} from "../companion-client.ts";
import type {
  ChatTurnRequest,
  HarnessAck,
  HarnessId,
  HarnessResult,
  HarnessSession,
  HarnessStatus,
  SessionPatch,
} from "./types.ts";

export interface AgentHarness {
  readonly id: HarnessId;
  /**
   * What the vault log calls this agent when it writes.
   *
   * The MCP door used to hard-code `name: "Hermes"` on the companion actor. With
   * two companions, that would record a lie about who changed a document, so the
   * name travels with the harness instead.
   */
  readonly displayName: string;
  readonly kind: "external" | "embedded";

  // Lifecycle
  ensure(): Promise<HarnessStatus>;
  status(): HarnessStatus;
  /** A sentence for the setup screen and Settings, in this harness's vocabulary. */
  statusMessage(status: HarnessStatus): string;
  shutdown(): Promise<void>;

  // Sessions
  listSessions(options?: { includeArchived?: boolean }): Promise<HarnessResult<HarnessSession[]>>;
  createSession(title: string): Promise<HarnessResult<HarnessSession>>;
  sessionMessages(id: string): Promise<HarnessResult<TranscriptMessage[]>>;
  patchSession(id: string, patch: SessionPatch): Promise<HarnessResult<HarnessSession>>;
  deleteSession(
    id: string,
    options?: { revision?: number | null },
  ): Promise<HarnessResult<{ id: string; deleted: boolean }>>;
  /** Re-establish the companion before a page (a review) promises a chat. */
  openSession(): Promise<HarnessAck>;

  // Models
  modelCatalog(): Promise<HarnessResult<CompanionModelCatalog>>;

  // One turn
  chatStream(
    request: ChatTurnRequest,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<HarnessAck>;
  approve(runId: string, requestId: string, allow: boolean): Promise<HarnessAck>;
  stopRun(runId: string): Promise<HarnessAck>;
}

/**
 * A harness whose companion lives on a named profile the operator can switch.
 *
 * Only Hermes has this. The seam keeps it a separate interface so the picker
 * can render for Hermes and simply not exist for a built-in companion, rather
 * than showing an empty list that means "your agent has no profiles".
 */
export interface ProfiledHarness extends AgentHarness {
  listProfiles(): Promise<{ active: string; profiles: CompanionProfileInfo[] }>;
  useProfile(name: string): Promise<HarnessStatus>;
  openProfileFolder(): Promise<void>;
}

/** One installed profile, as the Hermes picker lists it. */
export type CompanionProfileInfo = {
  name: string;
  path: string;
  isDefault: boolean;
  hasConfig: boolean;
  hasSoul: boolean;
  hasEnv: boolean;
};

export function hasProfiles(harness: AgentHarness): harness is ProfiledHarness {
  return "listProfiles" in harness;
}
