import type { Task, TaskColumn } from "@lifequest/vault-core/map";

export function groupTasks(tasks: Task[]): Record<TaskColumn, Task[]> {
  const g: Record<TaskColumn, Task[]> = {
    backlog: [],
    "this-week": [],
    today: [],
    done: [],
  };
  for (const task of tasks) g[task.column].push(task);
  return g;
}
