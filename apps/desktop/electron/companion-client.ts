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
};

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
