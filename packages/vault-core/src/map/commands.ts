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
import { fail, ok } from "./errors.ts";
import { guardAgentWrite } from "./lock.ts";
import {
  setMonthDay,
  setMonthNotes,
  setMonthObjectives,
} from "./months.ts";
import {
  createPeriodGoal,
  deletePeriodGoal,
  updatePeriodGoal,
} from "./period-goals.ts";
import { createTask, deleteTask, updateTask } from "./tasks.ts";
import type {
  ApplyContext,
  Command,
  DayType,
  PeriodGoal,
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
  const guard = guardAgentWrite(state, ctx, command);
  if (!guard.ok) return guard;

  switch (command.type) {
    case "setLock":
      return ok({ ...state, locked: command.locked });
    case "createYear":
      return createLiveYear(ensureCurrentYear(state, ctx.today), command.year, ctx.today);
    case "deleteYear":
      return deleteYear(state, command.year, ctx.today);
    case "createPeriodGoal":
      return createPeriodGoal(
        state,
        command.year,
        command.name,
        command.color,
        command.start,
        command.end,
        ctx,
      );
    case "updatePeriodGoal": {
      const patch: Partial<Pick<PeriodGoal, "name" | "color" | "start" | "end">> =
        {};
      if (command.name !== undefined) patch.name = command.name;
      if (command.color !== undefined) patch.color = command.color;
      if (command.start !== undefined) patch.start = command.start;
      if (command.end !== undefined) patch.end = command.end;
      return updatePeriodGoal(state, command.year, command.id, patch);
    }
    case "deletePeriodGoal":
      return deletePeriodGoal(state, command.year, command.id);
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
    default: {
      const _exhaustive: never = command;
      return fail("MALFORMED", `Unhandled command ${JSON.stringify(_exhaustive)}`);
    }
  }
}
