import type { Command } from "./types.ts";

export function mapLogEvent(command: Command): {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
} {
  switch (command.type) {
    case "setLock":
      return {
        type: "map.lock.set",
        summary: command.locked ? "Agents locked" : "Agents unlocked",
        payload: { locked: command.locked },
      };
    case "setAboutMe":
      return { type: "map.about.updated", summary: "Updated About me", payload: {} };
    case "createYear":
      return {
        type: "map.year.created",
        summary: `Created year ${command.year}`,
        payload: { year: command.year },
      };
    case "deleteYear":
      return {
        type: "map.year.deleted",
        summary: `Deleted year ${command.year}`,
        payload: { year: command.year },
      };
    case "createPeriodGoal":
      return {
        type: "map.period_goal.created",
        summary: `Created period goal ${command.name}`,
        payload: { year: command.year, name: command.name },
      };
    case "updatePeriodGoal":
      return {
        type: "map.period_goal.updated",
        summary: "Updated period goal",
        payload: { year: command.year, id: command.id },
      };
    case "deletePeriodGoal":
      return {
        type: "map.period_goal.deleted",
        summary: "Deleted period goal",
        payload: { year: command.year, id: command.id },
      };
    case "setMonthDay":
    case "setMonthObjectives":
    case "setMonthNotes":
      return {
        type: "map.month.updated",
        summary: `Updated month ${command.month} ${command.year}`,
        payload: { year: command.year, month: command.month },
      };
    case "createTask":
      return {
        type: "map.task.created",
        summary: `Created task ${command.title}`,
        payload: { title: command.title },
      };
    case "updateTask":
      return {
        type: "map.task.updated",
        summary: "Updated task",
        payload: { id: command.id },
      };
    case "deleteTask":
      return {
        type: "map.task.deleted",
        summary: "Deleted task",
        payload: { id: command.id },
      };
    default:
      return {
        type: `map.${command.type}`,
        summary: command.type,
        payload: {},
      };
  }
}
