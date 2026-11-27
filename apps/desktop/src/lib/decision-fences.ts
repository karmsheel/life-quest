/**
 * A `lifequest-decision` fence is a WIRE FORMAT, not prose.
 *
 * The companion proposes a change main-process-side by ending a reply with one
 * fenced block whose body is one JSON object; the main process reads the stored
 * message text, parses every fence and files each as a pending Decision. So the
 * fence has to stay in `ChatMessage.content` — stripping it before it is stored
 * would file nothing — but it must never be read as a paragraph of JSON on the
 * operator's screen.
 *
 * This module does the split: what to read, and one card per proposal carrying a
 * one-line description. It is display only. The authoritative parse is
 * `implied-decision.ts` in vault-core, which also validates the body; a fence
 * this module cannot read is still shown (as an unreadable proposal) rather than
 * hidden, so nothing the operator must decide about disappears silently.
 */

export type DecisionFence = {
  /** What the card says after `DECISION:` — one line, never the JSON. */
  summary: string;
  /** The proposal's own text, for the card once it is opened. */
  body: string;
};

export type SplitMessage = {
  /** The reply with every fence removed, trimmed. Empty when the reply was only fences. */
  prose: string;
  fences: DecisionFence[];
};

const FENCE_RE = /```lifequest-decision[^\S\n]*\r?\n([\s\S]*?)```/g;
const SUMMARY_MAX = 96;

function oneLine(value: unknown, max = SUMMARY_MAX): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `label — detail`, dropping the dash when there is no detail. */
function named(label: string, detail: string | null): string {
  return detail ? `${label} — ${detail}` : label;
}

function commandOf(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const command = parsed.command;
  return command && typeof command === "object" ? (command as Record<string, unknown>) : null;
}

function summaryFor(parsed: Record<string, unknown>): string {
  const kind = typeof parsed.kind === "string" ? parsed.kind : null;

  if (kind === "library") {
    return named("Library note", oneLine(parsed.title));
  }

  if (kind === "doctrine") {
    const documentKind = oneLine(parsed.documentKind);
    const title = oneLine(parsed.title);
    return named("Doctrine", title ?? documentKind);
  }

  if (kind === "goal") {
    const command = commandOf(parsed);
    const type = typeof command?.type === "string" ? command.type : "";
    if (type === "createGoal") return named("New goal", oneLine(command?.name));
    if (type === "updateGoal") return named("Update goal", oneLine(command?.name));
    if (type === "deleteGoal") return "Delete a goal";
    return "Goal change";
  }

  if (kind === "day-template") {
    const command = commandOf(parsed);
    const type = typeof command?.type === "string" ? command.type : "";
    return named("Day template", oneLine(command?.name) ?? oneLine(type));
  }

  if (kind === "project") {
    const command = commandOf(parsed);
    const type = typeof command?.type === "string" ? command.type : "";
    if (type === "createProject") return named("New project", oneLine(command?.title));
    if (type === "closeProject") return "Close a project";
    return named("Project", oneLine(command?.title));
  }

  // An envelope of several proposals, which the app files one by one.
  if (Array.isArray(parsed.decisions)) {
    const count = parsed.decisions.length;
    return count === 1 ? "1 proposal" : `${count} proposals`;
  }

  // Unknown kind, or a schema this build predates: still name what it touches
  // rather than showing raw JSON in the summary line.
  if (kind) return named("Proposal", `${kind} change`);
  return "Proposal";
}

export function splitDecisionFences(content: string): SplitMessage {
  const fences: DecisionFence[] = [];
  let prose = "";
  let cursor = 0;

  FENCE_RE.lastIndex = 0;
  for (let match = FENCE_RE.exec(content); match; match = FENCE_RE.exec(content)) {
    prose += content.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    const raw = match[1]?.trim() ?? "";
    let summary = "Proposal";
    let body = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        summary = summaryFor(parsed as Record<string, unknown>);
        // The description under the line: the proposal's title, else its body.
        const record = parsed as Record<string, unknown>;
        const title = oneLine(record.title, 500);
        body = title && title !== summary ? `${title}\n\n${raw}` : raw;
      } else {
        summary = "Unreadable proposal";
      }
    } catch {
      summary = "Unreadable proposal";
    }
    fences.push({ summary, body });
  }
  prose += content.slice(cursor);

  return { prose: prose.trim(), fences };
}
