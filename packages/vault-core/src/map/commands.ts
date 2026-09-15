import { setAboutMe } from "./about.ts";
import {
  createDayType,
  deleteDayType,
  updateDayType,
} from "./day-types.ts";
import {
  setDefaultWeekdayType,
  setDefaultWeeklyItems,
} from "./default-week.ts";
import { fail } from "./errors.ts";
import { createEvent, deleteEvent, updateEvent } from "./events.ts";
import {
  setMonthDay,
  setMonthNotes,
  setMonthObjectives,
} from "./months.ts";
import {
  addLiveAdHoc,
  completeLiveBlock,
  completeLiveLeftover,
  deleteLiveAdHoc,
  ensureLiveDay,
  placeLiveBlock,
  setLiveDayType,
  unplaceLiveBlock,
  updateLiveBlock,
} from "./live-days.ts";
import { createTask, deleteTask, updateTask } from "./tasks.ts";
import type {
  ApplyContext,
  Command,
  DayType,
  MapEvent,
  Result,
  StoreState,
  Task,
} from "./types.ts";
import {
  clearGridBlock,
  placeGridBlock,
  resetWeek,
  setWeekDayItems,
  setWeekDayType,
  setWeekWeeklyItems,
} from "./weeks.ts";
import { createLiveYear, deleteYear, ensureCurrentYear } from "./years.ts";

export function applyCommand(
  state: StoreState,
  command: Command,
  ctx: ApplyContext,
): Result<StoreState> {
  switch (command.type) {
    case "createYear":
      return createLiveYear(ensureCurrentYear(state, ctx.today), command.year, ctx.today);
    case "deleteYear":
      return deleteYear(state, command.year, ctx.today);
    case "createEvent":
      return createEvent(
        state,
        command.year,
        command.title,
        command.date,
        ctx,
        command.notes,
        command.domainSlug,
        command.goalId,
      );
    case "updateEvent": {
      const patch: Partial<
        Pick<MapEvent, "title" | "date" | "notes" | "domainSlug" | "goalId">
      > = {};
      if (command.title !== undefined) patch.title = command.title;
      if (command.date !== undefined) patch.date = command.date;
      if (command.notes !== undefined) patch.notes = command.notes;
      if (command.domainSlug !== undefined) patch.domainSlug = command.domainSlug;
      if (command.goalId !== undefined) patch.goalId = command.goalId;
      return updateEvent(state, command.year, command.id, patch, ctx);
    }
    case "deleteEvent":
      return deleteEvent(state, command.year, command.id);
    case "setMonthDay":
      return setMonthDay(
        state,
        command.year,
        command.month,
        command.day,
        command.text,
      );
    case "setMonthObjectives":
      return setMonthObjectives(state, command.year, command.month, command.text);
    case "setMonthNotes":
      return setMonthNotes(state, command.year, command.month, command.text);
    case "createDayType":
      return createDayType(state, command.name, command.color, ctx);
    case "updateDayType": {
      const patch: Partial<Pick<DayType, "name" | "color" | "items">> = {};
      if (command.name !== undefined) patch.name = command.name;
      if (command.color !== undefined) patch.color = command.color;
      if (command.items !== undefined) patch.items = command.items;
      return updateDayType(state, command.id, patch);
    }
    case "deleteDayType":
      return deleteDayType(state, command.id, command.replacementId);
    case "setDefaultWeekdayType":
      return setDefaultWeekdayType(state, command.weekday, command.dayTypeId);
    case "setDefaultWeeklyItems":
      return setDefaultWeeklyItems(state, command.items);
    case "setWeekDayType":
      return setWeekDayType(
        state,
        command.year,
        command.monday,
        command.weekday,
        command.dayTypeId,
      );
    case "setWeekDayItems":
      return setWeekDayItems(
        state,
        command.year,
        command.monday,
        command.weekday,
        command.items,
      );
    case "setWeekWeeklyItems":
      return setWeekWeeklyItems(
        state,
        command.year,
        command.monday,
        command.items,
      );
    case "placeGridBlock":
      return placeGridBlock(state, command.year, command.monday, command.block);
    case "clearGridBlock":
      return clearGridBlock(
        state,
        command.year,
        command.monday,
        command.itemId,
        command.weekday,
      );
    case "resetWeek":
      return resetWeek(state, command.year, command.monday);
    case "createTask":
      return createTask(
        state,
        command.title,
        ctx,
        command.notes,
        command.column,
        command.links,
      );
    case "updateTask": {
      const patch: Partial<Pick<Task, "title" | "notes" | "column" | "links">> =
        {};
      if (command.title !== undefined) patch.title = command.title;
      if (command.notes !== undefined) patch.notes = command.notes;
      if (command.column !== undefined) patch.column = command.column;
      if (command.links !== undefined) patch.links = command.links;
      return updateTask(state, command.id, patch);
    }
    case "deleteTask":
      return deleteTask(state, command.id);
    case "setAboutMe":
      return setAboutMe(state, command.text);
    case "ensureLiveDay":
      return ensureLiveDay(state, command.date, ctx);
    case "setLiveDayType":
      return setLiveDayType(state, command.date, command.dayTypeId, ctx);
    case "addLiveAdHoc":
      return addLiveAdHoc(state, command.date, command.text, ctx);
    case "placeLiveBlock":
      return placeLiveBlock(
        state,
        command.date,
        {
          leftoverId: command.leftoverId,
          taskId: command.taskId,
          startMinutes: command.startMinutes,
          durationMinutes: command.durationMinutes,
        },
        ctx,
      );
    case "updateLiveBlock":
      return updateLiveBlock(state, command.date, command.blockId, {
        startMinutes: command.startMinutes,
        durationMinutes: command.durationMinutes,
      });
    case "unplaceLiveBlock":
      return unplaceLiveBlock(state, command.date, command.blockId);
    case "completeLiveLeftover":
      return completeLiveLeftover(state, command.date, command.leftoverId);
    case "completeLiveBlock":
      return completeLiveBlock(state, command.date, command.blockId);
    case "deleteLiveAdHoc":
      return deleteLiveAdHoc(state, command.date, command.leftoverId);
    default: {
      const _exhaustive: never = command;
      return fail("MALFORMED", `Unhandled command ${JSON.stringify(_exhaustive)}`);
    }
  }
}
