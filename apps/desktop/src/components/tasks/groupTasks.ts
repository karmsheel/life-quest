import { TASK_COLUMNS } from "@lifequest/vault-core/map";
import type { Task, TaskColumn } from "@lifequest/vault-core/map";

/**
 * Group tasks into the board's columns, keeping the task list's order inside
 * each one. A column with no cards is still present, so the board can draw its
 * empty state rather than omitting the horizon.
 */
export function groupTasks(tasks: Task[]): Record<TaskColumn, Task[]> {
  const g = Object.fromEntries(
    TASK_COLUMNS.map((column) => [column, [] as Task[]]),
  ) as Record<TaskColumn, Task[]>;
  for (const task of tasks) g[task.column].push(task);
  return g;
}
