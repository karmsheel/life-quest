/**
 * How a run of tool calls reads in the transcript.
 *
 * A tool-heavy turn used to push one bubble per tool event — two per call,
 * `tool: <name>` then `tool done: <name>` — which buried the conversation under
 * its own plumbing. Hermes Desktop answers this by summarizing a whole run of
 * consecutive calls into ONE grey line ("Explored 3 files, ran 5 commands") that
 * opens on click; this mirrors that, in LifeQuest's plain-text rendering.
 *
 * Pure and display-only: it takes the calls the panel already has and returns
 * the line to draw. Nothing here talks to the wire or the vault.
 *
 * Two deliberate departures from the reference implementation, both because the
 * LifeQuest panel has less chrome than Hermes Desktop's transcript:
 *
 *  - Only a call that is still running narrates in the present tense. Hermes
 *    Desktop shows a live ticker beside the summary, so it can keep the newest
 *    call in the present tense even when nothing is pending; with no ticker,
 *    "Editing 2 files" for finished work would just be wrong.
 *  - Success and failure are not distinguished. The session stream carries no
 *    per-call status (see `toolTargetLine` in `electron/companion-client.ts`),
 *    so a failed call is one of the counted calls and nothing here claims
 *    otherwise.
 */

export type ToolCall = {
  id: string;
  name: string;
  /** What the call acted on, one line, derived at the wire boundary. */
  target: string;
  /** False until its `tool.completed` frame lands. */
  done: boolean;
};

export type ToolCategory = "delegate" | "edit" | "explore" | "other" | "run";

/** Fixed so one run always reads the same way, whichever category is live. */
const CATEGORY_ORDER: readonly ToolCategory[] = [
  "edit",
  "explore",
  "run",
  "delegate",
  "other",
];

const CATEGORY_COPY: Record<
  ToolCategory,
  { noun: [string, string]; past: string; present: string }
> = {
  delegate: { noun: ["task", "tasks"], past: "Delegated", present: "Delegating" },
  edit: { noun: ["file", "files"], past: "Edited", present: "Editing" },
  explore: { noun: ["file", "files"], past: "Explored", present: "Exploring" },
  other: { noun: ["tool", "tools"], past: "Used", present: "Using" },
  run: { noun: ["command", "commands"], past: "Ran", present: "Running" },
};

const EDIT_TOOLS = new Set(["write_file", "patch", "remove_file", "memory", "skill_manage"]);
const RUN_TOOLS = new Set(["terminal", "execute_code", "process_manage"]);
const EXPLORE_TOOLS = new Set([
  "read_file",
  "search_files",
  "list_files",
  "web_extract",
  "web_search",
  "x_search",
  "vision_analyze",
  "session_search",
  "skill_view",
  "tool_search",
  "tool_describe",
]);

export function toolCategory(name: string): ToolCategory {
  const tool = name.trim().toLowerCase();

  if (EDIT_TOOLS.has(tool)) return "edit";
  if (RUN_TOOLS.has(tool)) return "run";
  if (EXPLORE_TOOLS.has(tool) || tool.startsWith("browser_")) return "explore";
  if (tool.startsWith("delegate") || tool.startsWith("kanban")) return "delegate";

  return "other";
}

/**
 * One clause per category. A single call that named its target says what it was
 * ("Explored AGENTS.md"); anything else counts ("explored 3 files"). A finished
 * command is the exception — "ran 5 commands" is the useful reading, and a
 * command line only earns its space while it is the thing being waited on.
 */
function clause(
  category: ToolCategory,
  calls: readonly ToolCall[],
  live: boolean,
): string {
  const copy = CATEGORY_COPY[category];
  const verb = live ? copy.present : copy.past;
  const only = calls.length === 1 ? calls[0] : undefined;
  const target = only?.target ?? "";

  if (target && (live || category !== "run")) {
    return `${verb} ${target}`;
  }

  return `${verb} ${calls.length} ${copy.noun[calls.length === 1 ? 0 : 1]}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The single grey line that stands in for a run of tool calls.
 *
 * `live` is the caller's to say, not something readable off the calls: a call
 * can be left unfinished by a turn that ended, and a run like that has to read
 * as finished rather than narrate work that stopped happening.
 */
export function summarizeToolRun(
  calls: readonly ToolCall[],
  live: boolean,
): string {
  if (calls.length === 0) return "";

  const narrating = live ? calls.find((call) => !call.done) : undefined;
  const liveCategory = narrating ? toolCategory(narrating.name) : null;

  const byCategory = new Map<ToolCategory, ToolCall[]>();
  for (const call of calls) {
    const category = toolCategory(call.name);
    const group = byCategory.get(category);
    if (group) group.push(call);
    else byCategory.set(category, [call]);
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const group = byCategory.get(category);
    return group ? [clause(category, group, category === liveCategory)] : [];
  })
    .map((text, index) => (index === 0 ? text : lowerFirst(text)))
    .join(", ");
}

/** What one expanded row says: the call, then what it acted on. */
export function toolRowLabel(call: ToolCall): string {
  return call.target ? `${call.name} · ${call.target}` : call.name;
}
