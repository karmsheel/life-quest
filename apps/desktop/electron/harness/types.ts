// The wire shapes the harness seam speaks.
//
// These are the app's own types, not a vendor's: `CompanionStatus` used to be
// defined by what Hermes could say, and a built-in companion has a different
// vocabulary. Everything the renderer reads is here so that adding a harness
// does not mean teaching the renderer a second dialect.
import type {
  ChatStreamEvent,
  CompanionInstructionsInput,
  CompanionModelCatalog,
  CompanionRuntimeOverride,
  HermesSession,
  TranscriptMessage,
  TurnAttachment,
} from "../companion-client.ts";

/** Which companion the studio is talking to. */
export type HarnessId = "hermes" | "pi";

/** A companion that is up and can take a turn. */
export type HarnessReady = {
  kind: "ready";
  /** Which harness answered — the renderer shows this, it never infers it. */
  harness: HarnessId;
  /**
   * One sentence for Settings and the setup screen. The renderer must never
   * format transport fields itself: a port and a profile path are Hermes facts,
   * and a built-in companion has neither.
   */
  detail: string;
  /** The pinned model is not in the catalog any more; every chat will fail. */
  modelWarning?: string;
  // Hermes-only facts. Present only when `harness` is "hermes", because only a
  // profile-on-a-gateway has a port, a base url, or a child process.
  port?: number;
  baseUrl?: string;
  startedByLifeQuest?: boolean;
  profilePath?: string;
  cliPath?: string;
  childPid?: number | null;
};

/** A companion that is not up, and why. The kinds are additive. */
export type HarnessUnavailable =
  | { kind: "needs_install" }
  /** Built in, but no endpoint/model/key configured yet. */
  | { kind: "needs_setup"; message?: string }
  | { kind: "profile_error"; message: string; path?: string }
  | { kind: "port_busy"; port: number }
  | { kind: "gateway_exited"; detail: string }
  | { kind: "disconnected" }
  | { kind: "hermes_too_old"; version?: string }
  | { kind: "auth_error" };

export type HarnessStatus = HarnessReady | HarnessUnavailable;

/** The result shape every harness method uses; errors are sentences, not throws. */
export type HarnessResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** The same shape for a method that returns nothing on success. */
export type HarnessAck =
  | { ok: true }
  | { ok: false; error: string };

/** One turn, as the harness receives it. */
export type ChatTurnRequest = {
  sessionId: string;
  input: string;
  instructionsContext: CompanionInstructionsInput;
  /** The composer's per-turn model and thinking pick, if any. */
  runtime?: CompanionRuntimeOverride | null;
  /** A receipt already taken from the pending slot by main. */
  attachment?: TurnAttachment | null;
};

/** Rename, pin or archive one chat. */
export type SessionPatch = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

/** What a harness picker shows. */
export type HarnessSummary = {
  id: HarnessId;
  name: string;
  /** "Built in" or "External sidekick", for the picker's second line. */
  blurb: string;
  kind: "external" | "embedded";
  active: boolean;
};

// The dock's shapes are harness-neutral already; these aliases let the seam
// name them without forcing a rename through 2,500 lines of panel.
export type HarnessSession = HermesSession;
export type HarnessTranscriptMessage = TranscriptMessage;
export type HarnessModelCatalog = CompanionModelCatalog;
export type HarnessStreamEvent = ChatStreamEvent;
