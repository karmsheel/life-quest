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
  /**
   * A receipt already taken from the pending slot by main.
   *
   * The receipt is the one image the finance flow cites; it has its own
   * instruction wording and rides the turn as a picture.
   */
  attachment?: TurnAttachment | null;
  /**
   * The general attachments this turn carries, already resolved by main.
   *
   * A LIST, and not the receipt above: an attachment is anything the operator
   * attached for the agent to read, and there may be several. The receipt is
   * one of them when it is an image, but it arrives on its own argument and
   * keeps its own wording. Both ride the turn.
   */
  attachments?: TurnAttachment[] | null;
};

/** Rename, pin or archive one chat. */
export type SessionPatch = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

/**
 * What one harness can actually put in a turn's work log.
 *
 * The renderer reads this instead of branching on the harness id: a capability
 * that is false is OMITTED from the UI, never shown as an empty placeholder.
 * `reasoning` distinguishes streams of real thinking from the lossy preview the
 * Hermes session route exposes, because the row labels the two differently.
 */
export type HarnessTurnCapabilities = {
  toolRows: boolean;
  toolArgs: boolean;
  toolCallIds: boolean;
  /** Result text arrives during the turn, not only when it settles. */
  toolResultsLive: boolean;
  /** Result text can be recovered from the terminal snapshot / transcript. */
  toolResultsOnSettle: boolean;
  /** The harness measured each call; false means the app clock is the only one. */
  toolDurations: boolean;
  toolProgress: boolean;
  reasoning: "delta" | "preview" | "none";
  commentary: boolean;
  steps: boolean;
  usage: boolean;
  history: boolean;
  approvals: boolean;
  steering: boolean;
};

/** What a harness picker shows. */
export type HarnessSummary = {
  id: HarnessId;
  name: string;
  /** "Built in" or "External sidekick", for the picker's second line. */
  blurb: string;
  kind: "external" | "embedded";
  active: boolean;
  /** Which mark the switcher draws; unknown ids fall back to their initial. */
  icon: string;
  /** What the dock may render for this harness (see HarnessTurnCapabilities). */
  capabilities: HarnessTurnCapabilities;
};

// The dock's shapes are harness-neutral already; these aliases let the seam
// name them without forcing a rename through 2,500 lines of panel.
export type HarnessSession = HermesSession;
export type HarnessTranscriptMessage = TranscriptMessage;
export type HarnessModelCatalog = CompanionModelCatalog;
export type HarnessStreamEvent = ChatStreamEvent;
