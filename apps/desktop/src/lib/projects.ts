import type { ProjectPriority, ProjectStatus } from "@lifequest/vault-core/pure";
import type { TaskColumn } from "@lifequest/vault-core/map";

/**
 * The readable faces of a project's fixed vocabulary, shared by the register
 * (`ProjectsPage`) and the project's own page so the two cannot drift apart.
 */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  open: "Open",
  active: "Active",
  paused: "Paused",
  blocked: "Blocked",
  done: "Done",
  closed: "Closed",
};

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: "Low priority",
  normal: "Normal priority",
  high: "High priority",
};

/** A collated task says which board column it sits in. */
export const TASK_COLUMN_LABELS: Record<TaskColumn, string> = {
  done: "Done",
  "in-progress": "In progress",
  today: "Today",
  "this-week": "This week",
  "next-30-days": "Next 30 days",
  backlog: "Backlog",
};

/** A calendar date (`YYYY-MM-DD`) read as the operator's own local day. */
export function formatProjectDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** A stamped instant (an update, a log line) read in the operator's locale. */
export function formatProjectWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
