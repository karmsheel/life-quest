export type CompanionInstructionsInput = {
  domainName: string | null;
  domainSlug: string | null;
  aboutMe: string;
  locked: boolean;
  vaultOpen: boolean;
  /** Which home Dashboard board the operator is looking at: null = Overview. */
  viewingBoard?: string | null;
  reviewContext?: string;
  /** Session pref: may this turn file an implied Decision? Omitted means on. */
  fileUnsolicited?: boolean;
};

export type ChatStreamEvent =
  | { type: "run.started"; runId: string }
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; name: string; target: string }
  | { type: "tool.completed"; name: string }
  | { type: "approval.request"; runId: string; requestId: string; summary: string }
  | { type: "run.stopped" }
  | { type: "run.incomplete"; reason: string }
  | { type: "run.completed" }
  | { type: "error"; message: string };

export type HermesSession = {
  id: string;
  title: string;
  /** First user message, already collapsed to one line. Null when the chat is empty. */
  preview: string | null;
  /** Unix seconds of last activity, or started_at when the chat has not been active yet. */
  lastActive: number | null;
  /** Durable sidebar flag: a pinned chat is never archived and never sinks out of the list. */
  pinned: boolean;
};

/** One session row as Hermes sends it (list rows and single-session replies). */
type SessionRow = {
  id?: unknown;
  session_id?: unknown;
  title?: unknown;
  name?: unknown;
  preview?: unknown;
  last_active?: unknown;
  last_activity_at?: unknown;
  started_at?: unknown;
  hidden?: unknown;
  archived?: unknown;
  pinned?: unknown;
};

const PLACEHOLDER_TITLE = /^LifeQuest(?: · .+)?$/;

function rowsOf(payload: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function flag(value: unknown): boolean {
  return value === true || value === 1;
}

function unixSeconds(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? n / 1000 : n;
}

function oneLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("");
}

/** One row mapped to the dock's shape, or null when it carries no id. */
function sessionFromRow(r: SessionRow): HermesSession | null {
  const id = String(r.id ?? r.session_id ?? "").trim();
  if (!id) return null;
  const title = oneLine(r.title ?? r.name);
  const preview = oneLine(r.preview);
  return {
    id,
    title,
    preview: preview || null,
    lastActive: unixSeconds(r.last_active ?? r.last_activity_at ?? r.started_at),
    pinned: flag(r.pinned),
  };
}

export function sessionsFromPayload(payload: unknown): HermesSession[] {
  const out: HermesSession[] = [];
  for (const row of rowsOf(payload, ["sessions", "data", "items"])) {
    if (!row || typeof row !== "object") continue;
    const r = row as SessionRow;
    // Archived and hidden rows belong to Hermes Desktop's recovery surface; the
    // dock lists live chats only.
    if (flag(r.hidden) || flag(r.archived)) continue;
    const session = sessionFromRow(r);
    if (session) out.push(session);
  }
  return out;
}

/**
 * One session from a create/update reply, which nests the row under `session`.
 * Never filtered: the reply to archiving a chat IS the archived row, and
 * dropping it would read as a failed archive.
 */
export function sessionFromPayload(payload: unknown): HermesSession | null {
  if (!payload || typeof payload !== "object") return null;
  const nested = (payload as { session?: unknown }).session;
  const source = nested && typeof nested === "object" ? nested : payload;
  return sessionFromRow(source as SessionRow);
}

export function createdSessionFromPayload(
  payload: unknown,
  fallbackTitle = "",
): HermesSession | null {
  const row = sessionFromPayload(payload);
  if (!row) return null;
  const fallback = oneLine(fallbackTitle);
  if (!row.title && fallback) return { ...row, title: fallback };
  return row;
}

/** Visible chat name: a set title, otherwise the first thing the user asked. */
export function sessionLabel(session: Pick<HermesSession, "title" | "preview">): string {
  const title = session.title.trim();
  const preview = oneLine(session.preview);
  if (title && !PLACEHOLDER_TITLE.test(title)) return title;
  if (preview) return preview;
  if (title) return title;
  return "New chat";
}

export function formatSessionWhen(lastActive: number | null, nowMs = Date.now()): string {
  if (lastActive == null || !Number.isFinite(lastActive)) return "";
  const date = new Date(lastActive * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date(nowMs);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function messagesFromPayload(
  payload: unknown,
): { role: "user" | "assistant"; content: string }[] {
  const value: { role: "user" | "assistant"; content: string }[] = [];
  for (const row of rowsOf(payload, ["data", "messages", "items"])) {
    if (!row || typeof row !== "object") continue;
    const r = row as { role?: unknown; content?: unknown };
    if (r.role !== "user" && r.role !== "assistant") continue;
    const content = messageText(r.content);
    if (!content.trim()) continue;
    value.push({ role: r.role, content });
  }
  return value;
}

export function buildInstructions(input: CompanionInstructionsInput): string {
  const domain =
    input.domainName || input.domainSlug
      ? `${input.domainName ?? "unnamed"}${input.domainSlug ? ` (${input.domainSlug})` : ""}`
      : "none";
  const about = input.aboutMe.trim() ? input.aboutMe.trim() : "(empty)";
  // The lens the operator is actually looking at: an explicit board line beats
  // guessing "the Dashboard" from the active domain, which is null on Overview.
  const board =
    input.viewingBoard === undefined
      ? null // caller did not say; fall back to the domain line only
      : input.viewingBoard === null
        ? "the Overview dashboard (domainSlug: null)"
        : `the ${input.viewingBoard} dashboard (domainSlug: "${input.viewingBoard}")`;
  const boardLine = board
    ? `The operator is looking at ${board} right now — when they say "the Dashboard", they mean that board, and arrange_dashboard targets that domainSlug.`
    : "";
  // A missing pref means filing is on, so omit the field and get the on wording.
  const fileUnsolicited = input.fileUnsolicited ?? true;
  const fenceRule = fileUnsolicited
    ? [
        "When you propose a doctrine, library, goal, or day-template change and you did not call a write tool for it, end the turn with one fenced block whose info string is exactly lifequest-decision and whose body is one JSON object, for example:",
        "```lifequest-decision",
        '{"kind":"doctrine","domainSlug":"health","documentKind":"why","title":"Purpose","body":"new body"}',
        "```",
        "One block per turn, and only the last valid one counts. Prose outside the block is not a change. A project kind is not a document and files nothing, so do not use it.",
        "That block becomes one pending Decision; it never edits a file. Silence does not apply a proposal: only the operator approving it does.",
        "Omit the block entirely when a write tool already ran in this turn.",
      ]
    : [
        "Filing implied changes is off for this session. Do not emit a lifequest-decision fence; just describe the change in prose and let the operator ask for it.",
      ];
  const base = [
    "You are chatting inside the LifeQuest app.",
    `Active domain: ${domain}`,
    `About me: ${about}`,
    `Agent lock: ${input.locked}`,
    `Vault: ${input.vaultOpen ? "open" : "closed"}`,
    "LifeQuest MCP server name is lifequest. Use it for map and task changes. If a tool returns LOCKED, tell the user the map is locked.",
    "Money the operator states must be logged with capture_transaction (or undo_capture / correct_capture in that thread). Do not claim a row was posted unless the tool result says posted: true. If the tool returns ask, ask that and do not invent an account.",
    "A page script block is the one page change you apply yourself: use apply_script_block, then name the script you applied in your reply, and do not file a Decision for it. Every other page edit still goes through a Decision. Do not claim a script ran unless run_script_block returned queries or fetches.",
    "The Dashboard is the app's home screen — the pin board the operator sees first, one per domain plus one Overview. It is NOT a page; never ask for a page id for it and never create a 'Dashboard page'. To put a table, chart, or metric there: preview_view to check the numbers (at most three previews, then prose), propose_view to file the one Decision that saves it, and arrange_dashboard (with the full pin list from get_dashboard) to pin it.",
    boardLine,
    ...fenceRule,
  ].filter(Boolean).join("\n");
  const reviewContext = input.reviewContext?.trim();
  if (!reviewContext) return base;
  return `${base}\n\n${reviewContext}`;
}

/**
 * What a tool frame actually says. `api_server._tool_progress` enqueues
 * `{message_id, tool_name, preview, args}` — `tool_name`, not `name`, and
 * there is no result or status field at all. Reading `name` is why every tool
 * row used to render as the literal word "tool"; reading `ok` is why a row
 * used to claim success for a key the wire never sends.
 */
function toolName(data: Record<string, unknown>): string {
  const name = data.tool_name ?? data.name;
  return typeof name === "string" && name.trim() ? name.trim() : "tool";
}

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
];
const TARGET_MAX_CHARS = 48;

function parseArgs(args: unknown): Record<string, unknown> | null {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === "string" && args.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(args) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * One line naming what a call acted on, for the activity line and its rows.
 *
 * Derived here rather than in the renderer because `args` is as large as the
 * biggest tool argument — a whole file body, in the case of `write_file` —
 * and a bounded string is the only shape the display should ever receive.
 */
function toolTargetLine(args: unknown): string {
  const bag = parseArgs(args);
  if (!bag) return "";
  for (const key of TARGET_KEYS) {
    const value = bag[key];
    if (typeof value !== "string") continue;
    const line = value.split("\n")[0]!.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const named = TARGET_PATH_KEYS.has(key)
      ? (line.replace(/[\/]+$/, "").split(/[\/]/).pop() ?? line)
      : line;
    return named.length > TARGET_MAX_CHARS
      ? `${named.slice(0, TARGET_MAX_CHARS - 1)}…`
      : named;
  }
  return "";
}

export function parseSseBlock(raw: string): ChatStreamEvent | null {
  const lines = raw.replace(/\r\n/g, "\n").trim().split("\n");
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  const dataRaw = dataLines.join("\n");
  let data: Record<string, unknown> = {};
  if (dataRaw) {
    try {
      const parsed = JSON.parse(dataRaw) as unknown;
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      if (eventName === "error" || dataRaw) {
        return { type: "error", message: dataRaw || "Invalid stream payload" };
      }
      return null;
    }
  }
  const type = (typeof data.type === "string" ? data.type : eventName) || "";
  return mapStreamEvent(type, data);
}

export function mapStreamEvent(
  type: string,
  data: Record<string, unknown>,
): ChatStreamEvent | null {
  switch (type) {
    case "run.started": {
      // Every frame of a session stream carries run_id (stamped by the
      // gateway's event queue); this is the one the stop control names.
      return {
        type: "run.started",
        runId: String(data.run_id ?? data.runId ?? ""),
      };
    }
    case "run.cancelled":
      // The turn was interrupted: the deltas already delivered are a PARTIAL
      // reply, and nothing else on the wire says so. The panel needs this to
      // keep a stopped turn from reading like a finished one.
      return { type: "run.stopped" };
    case "run.failed":
      // Same family, no interrupt: the turn ended without finishing (failure,
      // iteration budget, partial). ``turn_exit_reason`` names it when present.
      return {
        type: "run.incomplete",
        reason: typeof data.turn_exit_reason === "string" ? data.turn_exit_reason : "",
      };
    case "assistant.delta": {
      const text =
        typeof data.text === "string"
          ? data.text
          : typeof data.delta === "string"
            ? data.delta
            : "";
      return { type: "assistant.delta", text };
    }
    case "tool.started":
      return {
        type: "tool.started",
        name: toolName(data),
        target: toolTargetLine(data.args),
      };
    case "tool.completed":
      // Nothing to add to the row: the frame carries no outcome, so this is
      // only the panel's signal that the call named here is no longer running.
      return { type: "tool.completed", name: toolName(data) };
    case "approval.request": {
      return {
        type: "approval.request",
        runId: String(data.runId ?? data.run_id ?? ""),
        requestId: String(data.requestId ?? data.request_id ?? ""),
        summary: String(data.summary ?? data.message ?? "Approval required"),
      };
    }
    case "run.completed":
      return { type: "run.completed" };
    case "error":
      return {
        type: "error",
        message: String(data.message ?? data.error ?? "Stream error"),
      };
    default:
      return null;
  }
}

export function splitSse(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: ChatStreamEvent[] = [];
  for (const part of parts) {
    const evt = parseSseBlock(part);
    if (evt) events.push(evt);
  }
  return { events, rest };
}
