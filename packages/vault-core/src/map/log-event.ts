import type { Command } from "./types.ts";

export function mapLogEvent(command: Command): {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
} {
  switch (command.type) {
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
    case "createEvent":
      return {
        type: "map.event.created",
        summary: `Created event ${command.title}`,
        payload: { year: command.year, title: command.title, date: command.date },
      };
    case "updateEvent":
      return {
        type: "map.event.updated",
        summary: "Updated event",
        payload: { year: command.year, id: command.id },
      };
    case "deleteEvent":
      return {
        type: "map.event.deleted",
        summary: "Deleted event",
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
    case "ensureLiveDay":
      return {
        type: "map.liveDay.ensured",
        summary: "Ensured live day",
        payload: { date: command.date },
      };
    case "setLiveDayType":
      return {
        type: "map.liveDay.typeSet",
        summary: "Set live day type",
        payload: { date: command.date },
      };
    case "addLiveAdHoc":
      return {
        type: "map.liveDay.adHocAdded",
        summary: "Added schedule item",
        payload: { date: command.date },
      };
    case "placeLiveBlock":
      return {
        type: "map.liveDay.blockPlaced",
        summary: "Placed schedule block",
        payload: {
          date: command.date,
          leftoverId: command.leftoverId,
          taskId: command.taskId,
        },
      };
    case "updateLiveBlock":
      return {
        type: "map.liveDay.blockUpdated",
        summary: "Updated schedule block",
        payload: { date: command.date, blockId: command.blockId },
      };
    case "unplaceLiveBlock":
      return {
        type: "map.liveDay.blockUnplaced",
        summary: "Unplaced schedule block",
        payload: { date: command.date, blockId: command.blockId },
      };
    case "completeLiveLeftover":
      return {
        type: "map.liveDay.leftoverCompleted",
        summary: "Toggled leftover item",
        payload: { date: command.date, leftoverId: command.leftoverId },
      };
    case "completeLiveBlock":
      return {
        type: "map.liveDay.blockCompleted",
        summary: "Toggled schedule block",
        payload: { date: command.date, blockId: command.blockId },
      };
    case "deleteLiveAdHoc":
      return {
        type: "map.liveDay.adHocDeleted",
        summary: "Deleted schedule item",
        payload: { date: command.date, leftoverId: command.leftoverId },
      };
    default:
      return {
        type: `map.${command.type}`,
        summary: command.type,
        payload: {},
      };
  }
}
