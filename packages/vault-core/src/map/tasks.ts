import { fail, ok } from "./errors.ts";
import type {
  ApplyContext,
  Result,
  StoreState,
  Task,
  TaskColumn,
  TaskLinks,
} from "./types.ts";

const COLUMNS: TaskColumn[] = ["backlog", "this-week", "today", "done"];

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
  if (!COLUMNS.includes(column)) return fail("MALFORMED", "Invalid column");
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
  if (patch.column && !COLUMNS.includes(patch.column)) {
    return fail("MALFORMED", "Invalid column");
  }
  const tasks = state.tasks.slice();
  const next = { ...tasks[idx], ...patch };
  if (patch.title !== undefined) next.title = patch.title.trim();
  tasks[idx] = next;
  return ok({ ...state, tasks });
}

export function deleteTask(state: StoreState, id: string): Result<StoreState> {
  if (!state.tasks.some((t) => t.id === id)) {
    return fail("NOT_FOUND", "Task not found");
  }
  return ok({ ...state, tasks: state.tasks.filter((t) => t.id !== id) });
}
