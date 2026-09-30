export type CompanionInstructionsInput = {
  domainName: string | null;
  domainSlug: string | null;
  aboutMe: string;
  locked: boolean;
  vaultOpen: boolean;
  reviewContext?: string;
  /** Session pref: may this turn file an implied Decision? Omitted means on. */
  fileUnsolicited?: boolean;
};

export type ChatStreamEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; name: string }
  | { type: "tool.completed"; name: string; ok: boolean }
  | { type: "approval.request"; runId: string; requestId: string; summary: string }
  | { type: "run.completed" }
  | { type: "error"; message: string };

export type HermesSession = {
  id: string;
  title: string;
  /** First user message, already collapsed to one line. Null when the chat is empty. */
  preview: string | null;
  /** Unix seconds of last activity, or started_at when the chat has not been active yet. */
  lastActive: number | null;
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

export function sessionsFromPayload(payload: unknown): HermesSession[] {
  const out: HermesSession[] = [];
  for (const row of rowsOf(payload, ["sessions", "data", "items"])) {
    if (!row || typeof row !== "object") continue;
    const r = row as {
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
    };
    if (flag(r.hidden) || flag(r.archived)) continue;
    const id = String(r.id ?? r.session_id ?? "").trim();
    if (!id) continue;
    const title = oneLine(r.title ?? r.name);
    const preview = oneLine(r.preview);
    out.push({
      id,
      title,
      preview: preview || null,
      lastActive: unixSeconds(r.last_active ?? r.last_activity_at ?? r.started_at),
    });
  }
  return out;
}

export function createdSessionFromPayload(
  payload: unknown,
  fallbackTitle = "",
): HermesSession | null {
  if (!payload || typeof payload !== "object") return null;
  const nested = (payload as { session?: unknown }).session;
  const source = nested && typeof nested === "object" ? nested : payload;
  const [row] = sessionsFromPayload([source]);
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
    ...fenceRule,
  ].join("\n");
  const reviewContext = input.reviewContext?.trim();
  if (!reviewContext) return base;
  return `${base}\n\n${reviewContext}`;
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
    case "assistant.delta": {
      const text =
        typeof data.text === "string"
          ? data.text
          : typeof data.delta === "string"
            ? data.delta
            : "";
      return { type: "assistant.delta", text };
    }
    case "tool.started": {
      const name = typeof data.name === "string" ? data.name : "tool";
      return { type: "tool.started", name };
    }
    case "tool.completed": {
      const name = typeof data.name === "string" ? data.name : "tool";
      const ok = data.ok !== false;
      return { type: "tool.completed", name, ok };
    }
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
