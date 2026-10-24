import { isTaskColumn, TASK_COLUMNS } from "@lifequest/vault-core/map";
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
  for (const task of tasks) {
    // The main process owns the migration of retired column ids; this guard
    // keeps a renderer that reloads a beat earlier from dropping a card.
    const column = isTaskColumn(task.column) ? task.column : "backlog";
    g[column].push(task);
  }
  return g;
}
