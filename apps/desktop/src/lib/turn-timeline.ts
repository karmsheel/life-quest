/**
 * The dock's unit of conversation is a turn, not a message.
 *
 * A turn is one operator request and everything the agent did to answer it: the
 * thinking, the tool rows, the mid-turn narration, and the reply. The stream
 * delivers those facts out of order and in fragments; the transcript (on a
 * reload, or in a terminal snapshot) delivers the same facts durably. This
 * module is the one place both are reduced to the same record, so the panel can
 * render a live turn and a reloaded one with the same components.
 *
 * Two consequences shape everything here:
 *
 *  - It is pure. No React, no timers, no IPC. `buildTurnTimeline` turns a
 *    transcript into turns; `applyTurnEvent` folds one stream frame into a live
 *    turn. Ids are derived from the data (or minted by the caller), never from
 *    a counter that would make two runs of the same turn differ.
 *  - It never invents evidence. A duration is kept only when two real instants
 *    were observed; usage only when the harness accounted for it; a failed or
 *    interrupted turn is never reported as completed. The renderer's capability
 *    descriptor then hides whatever a harness cannot supply.
 */
import { summarizeToolRun, toolCategory, type ToolCategory } from "@/lib/tool-run";
import type {
  ChatStreamEvent,
  HarnessId,
  HarnessTurnCapabilities,
  TranscriptMessage,
  TurnUsage,
} from "@/vite-env";

export type TurnStatus = "running" | "completed" | "stopped" | "failed" | "incomplete";

/** The status of one tool call inside a turn. `unknown` is evidence of a call
 *  with no result and no failure: a floor harness, or a snapshot that lost the
 *  pairing. It is never counted as work that "did" something. */
export type ToolStatus = "running" | "completed" | "failed" | "unknown";

export type TurnBlock =
  | { kind: "reasoning"; id: string; text: string; at?: number }
  /** Assistant prose that arrived between tools. It is process, not the answer. */
  | { kind: "text"; id: string; text: string; at?: number }
  /** A harness-authored mid-turn update (Hermes `assistant.commentary`). */
  | { kind: "commentary"; id: string; text: string; at?: number }
  | { kind: "tools"; id: string; calls: ToolCallRecord[] };

export type ToolCallRecord = {
  /** Stable within the turn. Pi: native call id. Hermes: app-minted name+order. */
  id: string;
  name: string;
  /** One bounded line, derived at the wire boundary (or from transcript args). */
  target: string;
  category: ToolCategory;
  /** Raw or display arguments, bounded by main before they cross IPC. */
  args?: unknown;
  status: ToolStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** Where `durationMs` came from. The app's receipt clock is measured, not
   *  estimated, but it is not the harness's own measure and the row says so. */
  durationSource?: "harness" | "app";
  /** Bounded, redacted result text for the row disclosure. */
  resultPreview?: string;
  /** Last partial output the harness reported while the call ran. */
  progress?: string;
};

export type TurnUser = {
  text: string;
  at?: number;
  receipt?: { name: string; size: number };
  /** True when this text was steered into a turn already running. */
  steer?: boolean;
};

export type TurnNoteKind = "filed" | "stopped" | "incomplete" | "error" | "caveat";

export type TurnNote = { kind: TurnNoteKind; text: string };

export type TurnRecord = {
  /** Live turns: the harness run id when it named one. History: `session:id`. */
  turnId: string;
  /** The harness's own run id, once `run.started` named it. */
  runId?: string;
  sessionId: string;
  harness?: HarnessId;
  status: TurnStatus;
  startedAt: number;
  endedAt?: number;
  /** Ordered process blocks. The final answer is `answer`, never a block. */
  blocks: TurnBlock[];
  /** The authoritative final assistant text. Empty when the turn never replied. */
  answer: string;
  /** When the answer's first text arrived (the bubble's timestamp). */
  answerAt?: number;
  /** `assistant.final` arrived: the answer may not be replaced by a snapshot. */
  answerFinal?: boolean;
  /** The terminal frame (or the transcript) settled this turn. */
  settled: boolean;
  /**
   * The transport closed without a terminal frame, so the app closed the turn
   * on its own. It reads as completed (the operator is not left with a spinner)
   * but it stays unfolded until the next turn starts: the app's guess must not
   * hide a work log that may still be receiving frames, and a later terminal
   * frame still gets to say what actually happened.
   */
  provisional?: boolean;
  user?: TurnUser;
  /** Guidance steered into this turn while it ran, in arrival order. */
  steers?: TurnUser[];
  usage?: TurnUsage;
  stopReason?: string;
  /** App-generated notes: decisions filed, stop reason, capability caveats. */
  notes: TurnNote[];
  /** Operator disclosure override for this turn's process fold. */
  foldOpen?: boolean;
};

/**
 * What a harness can put in a turn's work log, with the full (Pi-like) set as
 * the default. An old E2E stub, or a summary that predates the descriptor,
 * renders the whole experience rather than a degraded one: the dock must never
 * hide evidence it actually received because a field was absent.
 */
export const FULL_CAPABILITIES: HarnessTurnCapabilities = {
  toolRows: true,
  toolArgs: true,
  toolCallIds: true,
  toolResultsLive: true,
  toolResultsOnSettle: true,
  toolDurations: true,
  toolProgress: true,
  reasoning: "delta",
  commentary: true,
  steps: true,
  usage: true,
  history: true,
  approvals: true,
  steering: true,
};

export function normalizeCapabilities(
  caps: Partial<HarnessTurnCapabilities> | null | undefined,
): HarnessTurnCapabilities {
  if (!caps) return FULL_CAPABILITIES;
  // Field by field, so a descriptor from a version that only knew some of the
  // keys still yields a usable one instead of `undefined` for the rest.
  const merged = { ...FULL_CAPABILITIES, ...caps };
  const reasoning = merged.reasoning;
  return {
    ...merged,
    reasoning:
      reasoning === "none" || reasoning === "preview" || reasoning === "delta"
        ? reasoning
        : FULL_CAPABILITIES.reasoning,
  };
}

let turnSeq = 0;

/** A new live turn's id. Turn identity is the renderer's until a run names it. */
export function newTurnId(): string {
  turnSeq += 1;
  return `turn-${Date.now().toString(36)}-${turnSeq.toString(36)}`;
}

export function openTurn(input: {
  sessionId: string;
  turnId?: string;
  harness?: HarnessId;
  user?: TurnUser;
  at?: number;
  status?: TurnStatus;
}): TurnRecord {
  const at = input.at ?? Date.now();
  return {
    turnId: input.turnId ?? newTurnId(),
    sessionId: input.sessionId,
    ...(input.harness ? { harness: input.harness } : {}),
    status: input.status ?? "running",
    startedAt: at,
    blocks: [],
    answer: "",
    settled: false,
    ...(input.user ? { user: input.user } : {}),
    notes: [],
  };
}

/**
 * Close a turn whose transport ended without a terminal frame.
 *
 * The renderer cannot know why the stream stopped, and leaving the composer
 * stopped forever is worse than a guess — but the guess is labelled: the turn
 * reads completed and stays unfolded until the next turn starts, so a frame
 * that was still on the wire can still land in a visible work log.
 */
export function settleProvisionally(turn: TurnRecord, now: number = Date.now()): TurnRecord {
  if (turn.settled) return turn;
  return {
    ...turn,
    status: "completed",
    settled: true,
    endedAt: turn.endedAt ?? now,
    provisional: true,
  };
}

/** Every call in a turn, in the order the turns happened. */
export function turnCalls(turn: TurnRecord): ToolCallRecord[] {
  const calls: ToolCallRecord[] = [];
  for (const block of turn.blocks) {
    if (block.kind === "tools") calls.push(...block.calls);
  }
  return calls;
}

export function hasWorkLog(turn: TurnRecord): boolean {
  return turn.blocks.length > 0;
}

/** Both instants had to be observed for a turn duration to exist at all. */
export function turnDurationMs(turn: TurnRecord): number | undefined {
  if (turn.endedAt === undefined) return undefined;
  if (!Number.isFinite(turn.startedAt) || turn.startedAt <= 0) return undefined;
  const duration = turn.endedAt - turn.startedAt;
  return duration >= 0 ? duration : undefined;
}

/** `4s`, `1m 12s` — display only, rounded once. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * A tool call's duration is a shorter interval than a turn's, so it keeps a
 * decimal under ten seconds: "0.8s" says something "1s" does not.
 */
export function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return formatDuration(ms);
}

/** `842`, `14.2k` — token counts, when the harness accounted for them exactly. */
export function formatTokens(usage: TurnUsage | undefined): string | null {
  const total =
    usage?.total ??
    (usage?.input !== undefined || usage?.output !== undefined
      ? (usage.input ?? 0) + (usage.output ?? 0)
      : undefined);
  if (total === undefined || !Number.isFinite(total) || total < 0) return null;
  if (total < 1000) return String(Math.round(total));
  return `${(total / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * What the live status line is doing right now: the newest call still running,
 * present tense. The design's copy is the app's ("reading Daily note"), not the
 * harness's tool name, because a harness's identifiers are not sentences.
 */
export function currentActivity(turn: TurnRecord): string | null {
  const calls = turnCalls(turn);
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i]!;
    if (call.status !== "running") continue;
    return activityPhrase(call);
  }
  return null;
}

const PRESENT_VERB: Record<ToolCategory, string> = {
  delegate: "delegating",
  edit: "editing",
  explore: "reading",
  other: "using",
  run: "running",
};

function activityPhrase(call: ToolCallRecord): string {
  const verb = PRESENT_VERB[call.category];
  return call.target ? `${verb} ${call.target}` : verb;
}

/**
 * The folded header's activity clause: what the turn did, by category, using
 * the same vocabulary as the transcript's tool line. Failed calls are NOT part
 * of a "did" claim — a failed edit did not edit anything — and they are counted
 * separately so the header still admits them.
 */
export function foldSummary(turn: TurnRecord): string {
  const calls = turnCalls(turn);
  const completed = calls.filter((call) => call.status === "completed");
  const failed = calls.filter((call) => call.status === "failed").length;
  const line = summarize(completed);
  if (failed === 0) return line;
  return line ? `${line}, ${failed} failed` : `${failed} failed`;
}

/** Reuse the existing tool-run vocabulary for the closed header's clause. */
function summarize(calls: readonly ToolCallRecord[]): string {
  if (calls.length === 0) return "";
  return summarizeToolRun(
    calls.map((call) => ({
      id: call.id,
      name: call.name,
      target: call.target,
      done: true,
    })),
    false,
  );
}

/* ——— history: the transcript becomes turns ————————————————————————————— */

/**
 * One bounded target line from raw args.
 *
 * The live wire bounds this in main (`toolTargetLine`). A transcript row has
 * only raw args, so the same rule is applied here: first string-valued target
 * key wins, paths reduce to their basename, the result is capped at 48 chars.
 * The duplication is deliberate — the renderer must be able to rebuild history
 * without importing main's stream mapper, and the rule is display-only.
 */
const TARGET_PATH_KEYS = new Set(["path", "file", "filepath", "file_path"]);
const TARGET_KEYS = [
  "path",
  "file",
  "filepath",
  "file_path",
  "query",
  "url",
  "command",
  "code",
  "goal",
  "skill",
  "name",
  // Pi's vault tools name their object by id, not by path (see pi-harness's
  // own `targetLine`); a durable row must reduce to the same line the live row
  // showed, or a reloaded turn disagrees with the turn that produced it.
  "databaseId",
  "viewId",
];
const TARGET_MAX_CHARS = 48;

/** The key order pi-harness's own `targetLine` uses: no `file`/`code`/`command`,
 *  and no basename reduction, because Pi showed the live row that way. */
const PI_TARGET_KEYS = ["path", "query", "url", "name", "goal", "databaseId", "viewId"];

function targetFromArgs(args: unknown): string {
  return deriveTarget(args, TARGET_KEYS, true);
}

function targetFromPiArgs(args: unknown): string {
  return deriveTarget(args, PI_TARGET_KEYS, false);
}

function deriveTarget(args: unknown, keys: readonly string[], basenames: boolean): string {
  if (args === null || args === undefined) return "";
  let bag: unknown = args;
  if (typeof args === "string" && args.trim().startsWith("{")) {
    try {
      bag = JSON.parse(args) as unknown;
    } catch {
      return "";
    }
  }
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return "";
  const record = bag as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const line = value.split("\n")[0]!.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const named =
      basenames && TARGET_PATH_KEYS.has(key)
        ? (line.replace(/[\/]+$/, "").split(/[\/]/).pop() ?? line)
        : line;
    return named.length > TARGET_MAX_CHARS
      ? `${named.slice(0, TARGET_MAX_CHARS - 1)}…`
      : named;
  }
  return "";
}

/**
 * One row's accounting added to the turn's. A row without `total` contributes
 * its input+output, which is the same total the harness would have reported.
 */
function addUsage(
  base: TurnUsage | undefined,
  step: TurnUsage,
): TurnUsage {
  const total =
    (base?.total ?? 0) +
    (step.total ?? (step.input ?? 0) + (step.output ?? 0));
  return {
    ...(base?.input === undefined && step.input === undefined
      ? {}
      : { input: (base?.input ?? 0) + (step.input ?? 0) }),
    ...(base?.output === undefined && step.output === undefined
      ? {}
      : { output: (base?.output ?? 0) + (step.output ?? 0) }),
    ...(total === 0 && base?.total === undefined && step.total === undefined
      ? {}
      : { total }),
  };
}

/** An assistant row's calls, as rows of the record before results arrive. */
function callsFromTranscript(
  calls: { id: string; name: string; args?: unknown }[],
  at: number,
  deriveTargetLine: (args: unknown) => string,
): ToolCallRecord[] {
  return calls.map((call) => ({
    id: call.id,
    name: call.name,
    target: deriveTargetLine(call.args),
    category: toolCategory(call.name),
    ...(call.args === undefined ? {} : { args: call.args }),
    status: "unknown",
    startedAt: at,
  }));
}

/**
 * Read a harness transcript as turns.
 *
 * The rules that keep live and reloaded turns looking alike:
 *
 *  - A user row closes the previous turn and opens the next one.
 *  - An assistant row with calls describes prose that came BEFORE those calls,
 *    so its text is narration; the answer is the last assistant text with no
 *    calls after it.
 *  - A tool row fills the call it answers (by id, else oldest same-name still
 *    unresolved). A failed result is a failed call, never a "did".
 *  - A turn that ends with no reply is incomplete, not completed: an old chat
 *    whose last turn was interrupted must not read as answered.
 */
export function buildTurnTimeline(
  entries: readonly TranscriptMessage[],
  options: { sessionId?: string; harness?: HarnessId } = {},
): TurnRecord[] {
  const sessionId = options.sessionId ?? "";
  const turns: TurnRecord[] = [];
  let historyIndex = 0;
  let blockSeq = 0;
  let lastAt = 0;

  const at = (value: number | undefined): number => value ?? 0;
  // Each harness derived its live target with its own rule; history has to use
  // the same one or a reloaded row disagrees with the turn that produced it.
  const deriveTargetLine = options.harness === "pi" ? targetFromPiArgs : targetFromArgs;

  /** Start a turn and make it the one rows land in until the next user row. */
  const startTurn = (user: TurnUser | undefined, startedAt: number): TurnRecord => {
    const opened = openTurn({
      sessionId,
      turnId: `${sessionId}:${historyIndex}`,
      ...(options.harness ? { harness: options.harness } : {}),
      status: "completed",
      at: startedAt,
      ...(user ? { user } : {}),
    });
    historyIndex += 1;
    blockSeq = 0;
    turns.push(opened);
    return opened;
  };

  const nextBlockId = (): string => {
    blockSeq += 1;
    return `b${blockSeq}`;
  };

  const pushBlock = (turn: TurnRecord, block: TurnBlock) => {
    turn.blocks = [...turn.blocks, block];
  };

  const closeAnswerIntoNarration = (turn: TurnRecord) => {
    if (!turn.answer.trim()) return;
    pushBlock(turn, {
      kind: "text",
      id: nextBlockId(),
      text: turn.answer,
      ...(turn.answerAt === undefined ? {} : { at: turn.answerAt }),
    });
    turn.answer = "";
    turn.answerAt = undefined;
  };

  const appendReasoning = (turn: TurnRecord, text: string, when: number) => {
    const last = turn.blocks[turn.blocks.length - 1];
    if (last?.kind === "reasoning") {
      last.text += text;
      return;
    }
    pushBlock(turn, { kind: "reasoning", id: nextBlockId(), text, at: when });
  };

  let current: TurnRecord | null = null;

  for (const entry of entries) {
    if (entry.role === "user") {
      const when = at(entry.at);
      current = startTurn(
        {
          text: entry.content,
          ...(entry.at === undefined ? {} : { at: entry.at }),
        },
        when,
      );
      lastAt = when;
      continue;
    }

    if (entry.role === "assistant") {
      const turn: TurnRecord = current ?? startTurn(undefined, at(entry.at));
      current = turn;
      const when = at(entry.at);
      lastAt = Math.max(lastAt, when);
      const calls = entry.toolCalls ?? [];
      if (entry.reasoning?.trim()) appendReasoning(turn, entry.reasoning, when);
      if (entry.content.trim()) {
        if (calls.length > 0) {
          // Prose that requested tools is process narration; the reply is a
          // later assistant row with no calls after it.
          pushBlock(turn, {
            kind: "text",
            id: nextBlockId(),
            text: entry.content,
            ...(entry.at === undefined ? {} : { at: entry.at }),
          });
        } else {
          closeAnswerIntoNarration(turn);
          turn.answer = entry.content;
          turn.answerAt = entry.at;
        }
      }
      if (calls.length > 0) {
        pushBlock(turn, {
          kind: "tools",
          id: nextBlockId(),
          calls: callsFromTranscript(calls, when, deriveTargetLine),
        });
      }
      // A turn's usage is the SUM of its steps' usage: pi-harness reports the
      // running total for the turn, so merging rows would make a reloaded
      // two-step turn show only its last model call's tokens while the live
      // footer showed the whole turn.
      if (entry.usage) turn.usage = addUsage(turn.usage, entry.usage);
      turn.endedAt = when;
      continue;
    }

    // A tool row: fill the call it answers.
    const turn: TurnRecord = current ?? startTurn(undefined, at(entry.at));
    current = turn;
    const when = at(entry.at);
    lastAt = Math.max(lastAt, when);
    const calls = turnCalls(turn);
    const byId =
      entry.toolCallId === undefined
        ? undefined
        : calls.find((call) => call.id === entry.toolCallId);
    const match =
      byId ??
      calls.find(
        (call) => call.status === "unknown" && call.name === (entry.toolName ?? ""),
      );
    if (match) {
      match.status = entry.isError ? "failed" : "completed";
      if (entry.at !== undefined) match.endedAt = entry.at;
      if (entry.content) match.resultPreview = entry.content;
    } else if (entry.toolName) {
      // A result row whose call the transcript did not describe is still
      // evidence the call happened, so it earns a row rather than disappearing.
      pushBlock(turn, {
        kind: "tools",
        id: nextBlockId(),
        calls: [
          {
            id: entry.toolCallId ?? `t${blockSeq}`,
            name: entry.toolName,
            target: "",
            category: toolCategory(entry.toolName),
            status: entry.isError ? "failed" : "completed",
            startedAt: when,
            ...(entry.at === undefined ? {} : { endedAt: entry.at }),
            ...(entry.content ? { resultPreview: entry.content } : {}),
          },
        ],
      });
    }
    turn.endedAt = when;
  }

  const finished = turns[turns.length - 1];
  if (finished) {
    finished.settled = true;
    finished.endedAt = finished.endedAt ?? (lastAt > 0 ? lastAt : undefined);
    const replied = finished.answer.trim().length > 0;
    finished.status = replied || finished.blocks.length > 0 ? "completed" : "incomplete";
    if (finished.status === "incomplete") {
      finished.notes = [
        ...finished.notes,
        { kind: "incomplete", text: "Ended before finishing" },
      ];
    }
  }

  return turns;
}

/* ——— the live reducer ——————————————————————————————————————————————— */

/**
 * Fold one stream frame into a live turn.
 *
 * The terminal events settle the turn; `run.started` is the provider's to
 * create or rename a turn because it owns the pending-turn bookkeeping. A
 * content event that arrives after settlement still lands (a frame can trail
 * the terminal through IPC) but never reopens the turn or rewrites its status.
 */
export function applyTurnEvent(
  turn: TurnRecord,
  evt: ChatStreamEvent,
  capabilities: HarnessTurnCapabilities = FULL_CAPABILITIES,
  now: number = Date.now(),
): TurnRecord {
  const caps = capabilities;
  switch (evt.type) {
    case "assistant.delta":
      if (!evt.text) return turn;
      return appendAnswer(turn, evt.text, now);

    case "reasoning.delta":
      // A harness whose descriptor says it has no reasoning may still send the
      // frame; the data is kept, the renderer is what omits it.
      if (!evt.text) return turn;
      return appendReasoning(turn, evt.text, now);

    case "assistant.commentary":
      return appendCommentary(turn, evt.text, evt.alreadyStreamed === true, now);

    case "assistant.final": {
      if (!evt.text.trim()) return turn;
      // The authoritative whole reply. Deltas may have already assembled a
      // partial (or duplicated) answer; the final text wins outright.
      return {
        ...turn,
        answer: evt.text,
        answerAt: turn.answerAt ?? now,
        answerFinal: true,
      };
    }

    case "tool.started": {
      const withNarration = closeOpenAnswer(turn, now);
      return startTool(withNarration, evt, now);
    }

    case "tool.progress": {
      let found = false;
      const blocks = turn.blocks.map((block) => {
        if (block.kind !== "tools") return block;
        const index = block.calls.findIndex((call) => call.id === evt.callId);
        if (index === -1) return block;
        found = true;
        const calls = block.calls.slice();
        calls[index] = { ...calls[index]!, progress: evt.text };
        return { ...block, calls };
      });
      return found ? { ...turn, blocks } : turn;
    }

    case "tool.completed":
      return completeTool(turn, evt, now);

    case "usage":
      return turn.usage ? { ...turn, usage: { ...turn.usage, ...evt.usage } } : { ...turn, usage: { ...evt.usage } };

    case "run.completed":
      return settle(turn, "completed", evt, now);

    case "run.stopped":
      return settle(turn, "stopped", evt, now);

    case "run.incomplete":
      return settle(turn, "incomplete", evt, now);

    case "error":
      return fail(turn, evt.message, now);

    case "decisions.filed": {
      const count = evt.ids.length;
      const named = evt.titles
        .slice(0, 2)
        .map((title) => (title.length > 64 ? `${title.slice(0, 63)}…` : title));
      const more =
        evt.titles.length > named.length ? ` and ${evt.titles.length - named.length} more` : "";
      const text = `Filed ${count} ${count === 1 ? "proposal" : "proposals"} — review ${
        count === 1 ? "it" : "them"
      } in Decisions${named.length > 0 ? `: ${named.join(", ")}${more}` : ""}.`;
      return withNote(turn, { kind: "filed", text });
    }

    case "decisions.problem":
      return withNote(turn, { kind: "caveat", text: evt.message });

    default:
      // run.started and approval.request belong to the provider, not the turn.
      return turn;
  }
}

function appendAnswer(turn: TurnRecord, text: string, now: number): TurnRecord {
  return {
    ...turn,
    answer: turn.answer + text,
    answerAt: turn.answerAt ?? now,
  };
}

function appendReasoning(turn: TurnRecord, text: string, now: number): TurnRecord {
  const base = closeOpenAnswer(turn, now);
  const last = base.blocks[base.blocks.length - 1];
  if (last?.kind === "reasoning") {
    const blocks = base.blocks.slice();
    blocks[blocks.length - 1] = { ...last, text: last.text + text };
    return { ...base, blocks };
  }
  return { ...base, blocks: [...base.blocks, { kind: "reasoning", id: blockId(base), text, at: now }] };
}

/**
 * Hermes' commentary rides the same channel as the deltas it was streamed from.
 * When it was already streamed, the words are in `answer`; moving them into the
 * commentary block keeps the bubble from saying the same sentence twice.
 */
function appendCommentary(
  turn: TurnRecord,
  text: string,
  alreadyStreamed: boolean,
  now: number,
): TurnRecord {
  if (!text.trim()) return turn;
  let answer = turn.answer;
  if (alreadyStreamed && answer.endsWith(text)) {
    answer = answer.slice(0, answer.length - text.length);
  }
  return {
    ...turn,
    answer,
    answerAt: answer ? turn.answerAt : undefined,
    blocks: [...turn.blocks, { kind: "commentary", id: blockId(turn), text, at: now }],
  };
}

/** A tool call (or a reasoning/commentary beat) ends the open answer segment:
 *  from here on the assistant is narrating process, not replying. */
function closeOpenAnswer(turn: TurnRecord, now: number): TurnRecord {
  if (!turn.answer.trim()) return turn;
  return {
    ...turn,
    answer: "",
    answerAt: undefined,
    blocks: [
      ...turn.blocks,
      {
        kind: "text",
        id: blockId(turn),
        text: turn.answer,
        ...(turn.answerAt === undefined ? {} : { at: turn.answerAt }),
      },
    ],
  };
}

let blockCounter = 0;

/** Block ids only need to be unique inside one turn and stable across renders. */
function blockId(turn: TurnRecord): string {
  blockCounter += 1;
  return `${turn.turnId}:b${blockCounter.toString(36)}`;
}

function startTool(
  turn: TurnRecord,
  evt: Extract<ChatStreamEvent, { type: "tool.started" }>,
  now: number,
): TurnRecord {
  const calls = turnCalls(turn);
  // Pi names calls; Hermes does not, so the app mints an id here and pairs the
  // completion by name, oldest-first (see `completeTool`).
  const id = evt.callId ?? `${evt.name}:${calls.filter((call) => call.name === evt.name).length}`;
  const record: ToolCallRecord = {
    id,
    name: evt.name,
    target: evt.target,
    category: toolCategory(evt.name),
    ...(evt.args === undefined ? {} : { args: evt.args }),
    status: "running",
    startedAt: now,
  };
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.kind === "tools") {
    const blocks = turn.blocks.slice();
    blocks[blocks.length - 1] = { ...last, calls: [...last.calls, record] };
    return { ...turn, blocks };
  }
  return {
    ...turn,
    blocks: [...turn.blocks, { kind: "tools", id: blockId(turn), calls: [record] }],
  };
}

function completeTool(
  turn: TurnRecord,
  evt: Extract<ChatStreamEvent, { type: "tool.completed" }>,
  now: number,
): TurnRecord {
  let target: { block: number; call: number } | null = null;
  turn.blocks.forEach((block, blockIndex) => {
    if (target || block.kind !== "tools") return;
    if (evt.callId !== undefined) {
      const callIndex = block.calls.findIndex((call) => call.id === evt.callId);
      if (callIndex !== -1) target = { block: blockIndex, call: callIndex };
      return;
    }
    // No id on the wire (Hermes): oldest running call with that name. Concurrent
    // same-name calls can mispair live; the terminal snapshot repairs pairing.
    const callIndex = block.calls.findIndex(
      (call) => call.status === "running" && call.name === evt.name,
    );
    if (callIndex !== -1) target = { block: blockIndex, call: callIndex };
  });
  if (!target) return turn;
  const { block, call } = target as { block: number; call: number };
  const blocks = turn.blocks.slice();
  const toolsBlock = blocks[block];
  if (toolsBlock?.kind !== "tools") return turn;
  const calls = toolsBlock.calls.slice();
  const current = calls[call]!;
  const measured = current.startedAt > 0 ? Math.max(0, now - current.startedAt) : undefined;
  const durationMs = evt.durationMs ?? measured;
  calls[call] = {
    ...current,
    status: evt.isError ? "failed" : "completed",
    endedAt: now,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(durationMs === undefined
      ? {}
      : { durationSource: evt.durationMs === undefined ? "app" : "harness" }),
    ...(evt.resultPreview === undefined ? {} : { resultPreview: evt.resultPreview }),
  };
  blocks[block] = { ...toolsBlock, calls };
  return { ...turn, blocks };
}

function settle(
  turn: TurnRecord,
  eventStatus: Extract<TurnStatus, "completed" | "stopped" | "incomplete">,
  evt: Extract<
    ChatStreamEvent,
    { type: "run.completed" | "run.stopped" | "run.incomplete" }
  >,
  now: number,
): TurnRecord {
  const reason =
    evt.type === "run.completed"
      ? (evt.stopReason ?? "")
      : evt.type === "run.incomplete"
        ? evt.reason
        : "";
  // A harness that names a stop reason in the terminal frame still has to be
  // read honestly: "error" is a failure, "length" is an unfinished turn.
  const status: TurnStatus =
    eventStatus === "completed" && reason === "error"
      ? "failed"
      : eventStatus === "completed" && reason === "length"
        ? "incomplete"
        : eventStatus;

  let next: TurnRecord = {
    ...turn,
    status,
    settled: true,
    provisional: undefined,
    endedAt: now,
    ...(reason ? { stopReason: reason } : {}),
    ...(evt.usage ? { usage: { ...(turn.usage ?? {}), ...evt.usage } } : {}),
  };
  if (evt.snapshot && evt.snapshot.length > 0) {
    next = reconcileSnapshot(next, evt.snapshot);
  }
  if (status === "stopped") {
    next = withNote(next, {
      kind: "stopped",
      text: "Stopped — the reply above is only what arrived before the interrupt",
    });
  } else if (status === "incomplete") {
    next = withNote(next, {
      kind: "incomplete",
      text: reason ? `Ended before finishing — ${reason}` : "Ended before finishing",
    });
  } else if (status === "failed") {
    next = withNote(next, {
      kind: "error",
      text: reason && reason !== "error" ? `Failed — ${reason}` : "Failed",
    });
  }
  return next;
}

function fail(turn: TurnRecord, message: string, now: number): TurnRecord {
  return withNote(
    {
      ...turn,
      status: "failed",
      settled: true,
      provisional: undefined,
      endedAt: now,
    },
    { kind: "error", text: message ? `Failed — ${message}` : "Failed" },
  );
}

/** Notes are receipts, not a log: the newest statement of a kind replaces it. */
function withNote(turn: TurnRecord, note: TurnNote): TurnRecord {
  const notes = turn.notes.filter((existing) => existing.kind !== note.kind);
  return { ...turn, notes: [...notes, note] };
}

/**
 * The terminal snapshot is the durable truth for this turn's tool evidence.
 *
 * The snapshot covers the whole session, so only its last turn can be the live
 * one. Reconcile rather than replace: live commentary blocks and the live user
 * text are not in the durable transcript at all, and a live row carries the
 * app's receipt times. What the snapshot knows better — args, results, error
 * flags, and the final answer — fills in over the live record.
 */
function reconcileSnapshot(turn: TurnRecord, snapshot: readonly TranscriptMessage[]): TurnRecord {
  const built = buildTurnTimeline(snapshot, {
    sessionId: turn.sessionId,
    ...(turn.harness ? { harness: turn.harness } : {}),
  });
  const durable = built[built.length - 1];
  if (!durable) return turn;

  const durableCalls = turnCalls(durable);
  const liveCalls = turnCalls(turn);
  const paired = pairCalls(liveCalls, durableCalls);

  const blocks = turn.blocks.map((block) => {
    if (block.kind !== "tools") return block;
    const calls = block.calls.map((call) => {
      const index = liveCalls.indexOf(call);
      const durableCall = paired.paired.get(index);
      return durableCall ? fillFromDurable(call, durableCall) : call;
    });
    return { ...block, calls };
  });

  const extras = paired.extras;
  if (extras.length > 0) {
    const lastTools = blocks.reduce<number | null>(
      (found, block, index) => (block.kind === "tools" ? index : found),
      null,
    );
    if (lastTools === null) {
      blocks.push({ kind: "tools", id: blockId(turn), calls: extras });
    } else {
      const block = blocks[lastTools];
      if (block?.kind === "tools") {
        blocks[lastTools] = { ...block, calls: [...block.calls, ...extras] };
      }
    }
  }

  const answer =
    turn.answerFinal || turn.answer.trim() ? turn.answer : durable.answer || turn.answer;
  return {
    ...turn,
    blocks,
    answer,
    answerAt: turn.answerAt ?? durable.answerAt,
    usage:
      turn.usage && Object.keys(turn.usage).length > 0
        ? { ...(durable.usage ?? {}), ...turn.usage }
        : (turn.usage ?? durable.usage),
  };
}

type PairedCalls = {
  paired: Map<number, ToolCallRecord>;
  extras: ToolCallRecord[];
};

/**
 * Pair live calls to durable ones by id where both carry one, else by name in
 * order. Order is the only honest signal left when a harness has no call ids
 * (Hermes), and it is the same FIFO rule the live rows close under.
 */
function pairCalls(
  live: readonly ToolCallRecord[],
  durable: readonly ToolCallRecord[],
): PairedCalls {
  const paired = new Map<number, ToolCallRecord>();
  const used = new Set<number>();
  live.forEach((call, index) => {
    let match = -1;
    if (call.id) {
      match = durable.findIndex(
        (candidate, candidateIndex) =>
          !used.has(candidateIndex) && candidate.id === call.id,
      );
    }
    if (match === -1) {
      match = durable.findIndex(
        (candidate, candidateIndex) =>
          !used.has(candidateIndex) && candidate.name === call.name,
      );
    }
    if (match !== -1) {
      used.add(match);
      paired.set(index, durable[match]!);
    }
  });
  return {
    paired,
    extras: durable.filter((_, index) => !used.has(index)),
  };
}

function fillFromDurable(live: ToolCallRecord, durable: ToolCallRecord): ToolCallRecord {
  return {
    ...live,
    ...(durable.args === undefined ? {} : { args: durable.args }),
    ...(durable.target ? { target: durable.target } : {}),
    status:
      durable.status === "failed"
        ? "failed"
        : durable.status === "completed"
          ? "completed"
          : live.status,
    ...(durable.resultPreview === undefined ? {} : { resultPreview: durable.resultPreview }),
  };
}
