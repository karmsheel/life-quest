import { fail, ok } from "./errors.ts";
import type {
  ApplyContext,
  Result,
  StoreState,
  Task,
  TaskColumn,
  TaskLinks,
} from "./types.ts";

/** Every task column, in board order. The one list validation reads. */
export const TASK_COLUMNS = [
  "done",
  "today",
  "this-week",
  "this-month",
  "this-quarter",
  "backlog",
] as const satisfies readonly TaskColumn[];

export function isTaskColumn(value: unknown): value is TaskColumn {
  return (
    typeof value === "string" &&
    (TASK_COLUMNS as readonly string[]).includes(value)
  );
}

export function createTask(
  state: StoreState,
  title: string,
  ctx: ApplyContext,
  notes = "",
  column: TaskColumn = "backlog",
  links: TaskLinks = {},
): Result<StoreState> {
  const trimmed = title.trim();
  if (!trimmed) return fail("MALFORMED", "Task title is required");
  if (!isTaskColumn(column)) return fail("MALFORMED", "Invalid column");
  const task: Task = {
    id: ctx.id(),
    title: trimmed,
    notes,
    column,
    links,
  };
  return ok({ ...state, tasks: [...state.tasks, task] });
}

export function updateTask(
  state: StoreState,
  id: string,
  patch: Partial<Pick<Task, "title" | "notes" | "column" | "links">>,
): Result<StoreState> {
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return fail("NOT_FOUND", "Task not found");
  if (patch.title !== undefined && !patch.title.trim()) {
    return fail("MALFORMED", "Task title is required");
  }
  if (patch.column && !isTaskColumn(patch.column)) {
    return fail("MALFORMED", "Invalid column");
  }
  const tasks = state.tasks.slice();
  const next = { ...tasks[idx], ...patch };
  if (patch.title !== undefined) next.title = patch.title.trim();
  tasks[idx] = next;
  return ok({ ...state, tasks });
}

/**
 * Move a task to another column, or to another position in its own.
 *
 * `beforeId` names the card the moved one should precede. It only counts when
 * that card is in the target column — a stale id from a board that changed under
 * a drag must not tear the task into a different column's run — and omitting it
 * appends after the target column's last card.
 *
 * The board draws each column in the order the task list already holds, so the
 * position is persisted as array order rather than as a second `order` field:
 * one list, one truth, and no migration for the boards that predate this.
 */
export function moveTask(
  state: StoreState,
  id: string,
  column: TaskColumn,
  beforeId?: string | null,
): Result<StoreState> {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return fail("NOT_FOUND", "Task not found");
  if (!isTaskColumn(column)) return fail("MALFORMED", "Invalid column");

  const without = state.tasks.filter((t) => t.id !== id);
  let insertAt = -1;
  if (beforeId && beforeId !== id) {
    insertAt = without.findIndex(
      (t) => t.id === beforeId && t.column === column,
    );
  }
  if (insertAt < 0) {
    // Append after the column's last card. A column with no cards takes the end
    // of the list: no other column can observe a position it does not draw.
    let last = -1;
    without.forEach((t, index) => {
      if (t.column === column) last = index;
    });
    insertAt = last >= 0 ? last + 1 : without.length;
  }

  const moved: Task = { ...task, column };
  const tasks = [
    ...without.slice(0, insertAt),
    moved,
    ...without.slice(insertAt),
  ];

  // A drop that changes nothing is not a write: the card is already where the
  // hand put it, and the board should not churn the vault for that.
  const unchanged =
    task.column === column &&
    tasks.every((t, index) => t.id === state.tasks[index]?.id);
  if (unchanged) return ok(state);

  return ok({ ...state, tasks });
}

export function deleteTask(state: StoreState, id: string): Result<StoreState> {
  if (!state.tasks.some((t) => t.id === id)) {
    return fail("NOT_FOUND", "Task not found");
  }
  return ok({ ...state, tasks: state.tasks.filter((t) => t.id !== id) });
}
