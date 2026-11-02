import type { Goal, Project } from "@lifequest/vault-core/pure";
import {
  resolveWeek,
  type StoreState,
  type Task,
  type TaskLinks,
} from "@lifequest/vault-core/map";
import { COLUMN_LABELS } from "@/components/tasks/TaskBoard";

/**
 * What the Act board knows about a task that the companion does not.
 *
 * The kickoff is composed here rather than inside the page so the prompt has one
 * shape no matter who hands a task over: the labels are the board's own words
 * ("In-progress", the goal's name, the week item's text), which is what the
 * agent needs to find the same card again, and the ids stay out of the prose
 * except where a tool call needs one.
 */
export type HandoverContext = {
  columnLabel: string;
  goalName: string | null;
  projectName: string | null;
  weekItemLabel: string | null;
};

/** The new companion session's name: the task's title, marked as a task. */
export function handoverTitle(task: Task): string {
  return `Task · ${task.title}`;
}

/**
 * The week item a task points at, by its own text.
 *
 * Deliberately the same resolution TaskBoard's card uses: a day item is known by
 * its text, and a weekly item is marked with " (weekly)" while the picker offers
 * it and then stripped again for display. A link whose week or item is gone has
 * no text to show, so it resolves to null rather than a fabricated label.
 */
function weekItemLabel(
  state: StoreState,
  link: NonNullable<TaskLinks["weekItem"]>,
): string | null {
  if (!link.monday || !state.years.some((y) => y.year === link.year)) {
    return null;
  }
  const week = resolveWeek(state, link.year, link.monday);
  const dayItem = week.days.flat().find((item) => item.id === link.itemId);
  const weeklyItem = week.weeklyItems.find((item) => item.id === link.itemId);
  const label = dayItem
    ? dayItem.text
    : weeklyItem
      ? `${weeklyItem.text} (weekly)`
      : null;
  return label?.replace(/\s*\(weekly\)$/, "") ?? null;
}

/**
 * Resolve a task's links against the board's live data.
 *
 * A dangling goal keeps the "(missing)" mark the board's pickers use, so the
 * agent is told the link is broken instead of being handed a bare id that looks
 * like a name. A dangling project falls back to its id, matching the contract
 * the project picker already states.
 */
export function handoverContext(
  state: StoreState,
  task: Task,
  goals: Goal[],
  projects: Project[],
): HandoverContext {
  const goalId = task.links.goalId;
  const goal = goalId ? goals.find((g) => g.id === goalId) : undefined;
  const projectId = task.links.projectId;
  const project = projectId
    ? projects.find((p) => p.id === projectId)
    : undefined;

  return {
    // A column can only be a known one through the app's own writes, but a
    // hand-edited vault may hold anything; fall back to the raw id rather than
    // printing "undefined" at the agent.
    columnLabel: COLUMN_LABELS[task.column] ?? task.column,
    goalName: goalId ? (goal?.name ?? `${goalId} (missing)`) : null,
    projectName: projectId ? (project?.title ?? projectId) : null,
    weekItemLabel: task.links.weekItem
      ? weekItemLabel(state, task.links.weekItem)
      : null,
  };
}

/**
 * The prompt the new chat opens with.
 *
 * It carries the four things the agent cannot read off the board from its own
 * side — the id its tool calls need, the title, the notes and the column — then
 * the identity of the links, so the card it moves is the one the operator
 * pressed. The last paragraph is the completion gate: the board is the
 * operator's picture of what is actually finished, so `move_task` is written as
 * a reward for genuine completion rather than a step in the workflow, and a
 * blocked agent is told to leave the card where it is.
 */
export function handoverKickoff(task: Task, ctx: HandoverContext): string {
  const notes = task.notes.trim();
  const linkLines = [
    ctx.goalName ? `Goal: ${ctx.goalName}` : null,
    ctx.projectName ? `Project: ${ctx.projectName}` : null,
    ctx.weekItemLabel ? `Week item: ${ctx.weekItemLabel}` : null,
  ].filter((line): line is string => line !== null);

  const lines = [
    "The operator handed this task over to you from the Act board. Work it as your own.",
    "",
    `Task id: ${task.id}`,
    `Title: ${task.title}`,
    `Notes: ${notes || "(none)"}`,
    `Column: ${ctx.columnLabel}`,
    ...linkLines,
    "",
    "Do the work the task describes, in the vault as well as in your reply. If the task is vague, make the smallest sensible version of it real rather than asking what it means.",
    "",
    `When — and only when — the task is genuinely complete, call the map tool \`move_task\` with \`id: "${task.id}"\` and \`column: "done"\` so the card moves to Done. Do not call it before the work is actually finished: the board is the operator's view of reality, and an early move misreports it. If you are blocked, leave the task where it is and say what blocked you.`,
  ];
  return lines.join("\n");
}
