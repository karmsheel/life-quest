import type {
  ChecklistItem,
  ColorId,
  Command,
  GridBlock,
  TaskColumn,
  TaskLinks,
  Weekday,
  WeekItem,
} from "./types.ts";

export type MapToolDef = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const COLORS = ["gold", "red", "blue", "green", "orange", "purple", "teal", "pink"];

const STRING = { type: "string" };
const NUMBER = { type: "number" };

const WEEKDAY_ENUM = { type: "number", enum: [0, 1, 2, 3, 4, 5, 6] };
const TASK_COLUMN_ENUM = {
  type: "string",
  enum: ["backlog", "this-week", "today", "done"],
};
const PRIORITY_ENUM = {
  type: "string",
  enum: ["required", "semi-optional", "optional"],
};
const COLOR_ENUM = { type: "string", enum: COLORS };

const CHECKLIST_ITEM = {
  type: "object",
  properties: {
    id: STRING,
    text: STRING,
  },
};

const WEEK_ITEM = {
  type: "object",
  properties: {
    id: STRING,
    text: STRING,
    priority: PRIORITY_ENUM,
  },
};

const GRID_BLOCK = {
  type: "object",
  properties: {
    itemId: STRING,
    weekday: WEEKDAY_ENUM,
    startMinutes: NUMBER,
    durationMinutes: NUMBER,
  },
};

const TASK_LINKS = {
  type: "object",
  properties: {
    goalId: STRING,
    date: STRING,
    weekItem: {
      type: "object",
      properties: {
        year: NUMBER,
        monday: STRING,
        itemId: STRING,
      },
    },
  },
};

export const MAP_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_state",
    description: "Read the full Life Map store",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_year",
    description: "Create a live year",
    parameters: {
      type: "object",
      properties: { year: NUMBER },
      required: ["year"],
    },
  },
  {
    name: "delete_year",
    description: "Delete a year",
    parameters: {
      type: "object",
      properties: { year: NUMBER },
      required: ["year"],
    },
  },
  {
    name: "create_event",
    description: "Create a map event",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        title: STRING,
        date: STRING,
        notes: STRING,
        domainSlug: { type: ["string", "null"] },
        goalId: { type: ["string", "null"] },
      },
      required: ["year", "title", "date"],
    },
  },
  {
    name: "update_event",
    description: "Update a map event",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        id: STRING,
        title: STRING,
        date: STRING,
        notes: STRING,
        domainSlug: { type: ["string", "null"] },
        goalId: { type: ["string", "null"] },
      },
      required: ["year", "id"],
    },
  },
  {
    name: "delete_event",
    description: "Delete a map event",
    parameters: {
      type: "object",
      properties: { year: NUMBER, id: STRING },
      required: ["year", "id"],
    },
  },
  {
    name: "set_month_day",
    description: "Set a month day cell",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        month: NUMBER,
        day: NUMBER,
        text: STRING,
      },
      required: ["year", "month", "day", "text"],
    },
  },
  {
    name: "set_month_objectives",
    description: "Set month Main Objectives",
    parameters: {
      type: "object",
      properties: { year: NUMBER, month: NUMBER, text: STRING },
      required: ["year", "month", "text"],
    },
  },
  {
    name: "set_month_notes",
    description: "Set month Notes",
    parameters: {
      type: "object",
      properties: { year: NUMBER, month: NUMBER, text: STRING },
      required: ["year", "month", "text"],
    },
  },
  {
    name: "create_day_type",
    description: "Create a day type",
    parameters: {
      type: "object",
      properties: { name: STRING, color: COLOR_ENUM },
      required: ["name", "color"],
    },
  },
  {
    name: "update_day_type",
    description: "Update a day type",
    parameters: {
      type: "object",
      properties: {
        id: STRING,
        name: STRING,
        color: COLOR_ENUM,
        items: { type: "array", items: CHECKLIST_ITEM },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_day_type",
    description: "Delete a day type",
    parameters: {
      type: "object",
      properties: { id: STRING, replacementId: STRING },
      required: ["id"],
    },
  },
  {
    name: "set_default_weekday_type",
    description: "Assign a day type on the default week",
    parameters: {
      type: "object",
      properties: {
        weekday: WEEKDAY_ENUM,
        dayTypeId: { type: ["string", "null"] },
      },
      required: ["weekday", "dayTypeId"],
    },
  },
  {
    name: "set_default_weekly_items",
    description: "Set default weekly-only items",
    parameters: {
      type: "object",
      properties: { items: { type: "array", items: CHECKLIST_ITEM } },
      required: ["items"],
    },
  },
  {
    name: "get_week",
    description: "Resolve a real week",
    parameters: {
      type: "object",
      properties: { year: NUMBER, monday: STRING },
      required: ["year", "monday"],
    },
  },
  {
    name: "set_week_day_type",
    description: "Set a real week's day type",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        monday: STRING,
        weekday: WEEKDAY_ENUM,
        dayTypeId: { type: ["string", "null"] },
      },
      required: ["year", "monday", "weekday", "dayTypeId"],
    },
  },
  {
    name: "set_week_day_items",
    description: "Set a real week's day items",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        monday: STRING,
        weekday: WEEKDAY_ENUM,
        items: { type: "array", items: WEEK_ITEM },
      },
      required: ["year", "monday", "weekday", "items"],
    },
  },
  {
    name: "set_week_weekly_items",
    description: "Set a real week's weekly-only items",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        monday: STRING,
        items: { type: "array", items: WEEK_ITEM },
      },
      required: ["year", "monday", "items"],
    },
  },
  {
    name: "place_grid_block",
    description: "Place a grid block on a real week",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        monday: STRING,
        block: GRID_BLOCK,
      },
      required: ["year", "monday", "block"],
    },
  },
  {
    name: "clear_grid_block",
    description: "Clear a grid block from a real week",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        monday: STRING,
        itemId: STRING,
        weekday: WEEKDAY_ENUM,
      },
      required: ["year", "monday", "itemId", "weekday"],
    },
  },
  {
    name: "reset_week",
    description: "Reset a real week to the default",
    parameters: {
      type: "object",
      properties: { year: NUMBER, monday: STRING },
      required: ["year", "monday"],
    },
  },
  {
    name: "create_task",
    description: "Create a task",
    parameters: {
      type: "object",
      properties: {
        title: STRING,
        notes: STRING,
        column: TASK_COLUMN_ENUM,
        links: TASK_LINKS,
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update a task",
    parameters: {
      type: "object",
      properties: {
        id: STRING,
        title: STRING,
        notes: STRING,
        column: TASK_COLUMN_ENUM,
        links: TASK_LINKS,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task",
    parameters: {
      type: "object",
      properties: { id: STRING },
      required: ["id"],
    },
  },
  {
    name: "set_about_me",
    description: "Set the About me note",
    parameters: {
      type: "object",
      properties: { text: STRING },
      required: ["text"],
    },
  },
  {
    name: "get_doctrine",
    description: "Read Premise / Vision / Purpose / Strategy (How) for a domain (default: active domain)",
    parameters: {
      type: "object",
      properties: { domainSlug: STRING },
    },
  },
];

/**
 * Map a tool name + args to a Map command. Read-only tools (get_state,
 * get_week, get_doctrine) and unknown tools return null — the Electron
 * planner loop handles reads directly and rejects unknown tools.
 */
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

export function commandForTool(
  name: string,
  args: Record<string, unknown>,
): Command | null {
  let command: Command | null = null;
  switch (name) {
    case "create_year":
      command = { type: "createYear", year: args.year as number };
      break;
    case "delete_year":
      command = { type: "deleteYear", year: args.year as number };
      break;
    case "create_event":
      command = {
        type: "createEvent",
        year: args.year as number,
        title: args.title as string,
        date: args.date as string,
        notes: args.notes as string | undefined,
        domainSlug: args.domainSlug as string | null | undefined,
        goalId: args.goalId as string | null | undefined,
      };
      break;
    case "update_event":
      command = {
        type: "updateEvent",
        year: args.year as number,
        id: args.id as string,
        title: args.title as string | undefined,
        date: args.date as string | undefined,
        notes: args.notes as string | undefined,
        domainSlug: args.domainSlug as string | null | undefined,
        goalId: args.goalId as string | null | undefined,
      };
      break;
    case "delete_event":
      command = { type: "deleteEvent", year: args.year as number, id: args.id as string };
      break;
    case "set_month_day":
      command = {
        type: "setMonthDay",
        year: args.year as number,
        month: args.month as number,
        day: args.day as number,
        text: args.text as string,
      };
      break;
    case "set_month_objectives":
      command = {
        type: "setMonthObjectives",
        year: args.year as number,
        month: args.month as number,
        text: args.text as string,
      };
      break;
    case "set_month_notes":
      command = {
        type: "setMonthNotes",
        year: args.year as number,
        month: args.month as number,
        text: args.text as string,
      };
      break;
    case "create_day_type":
      command = {
        type: "createDayType",
        name: args.name as string,
        color: args.color as ColorId,
      };
      break;
    case "update_day_type":
      command = {
        type: "updateDayType",
        id: args.id as string,
        name: args.name as string | undefined,
        color: args.color as ColorId | undefined,
        items: args.items as ChecklistItem[] | undefined,
      };
      break;
    case "delete_day_type":
      command = {
        type: "deleteDayType",
        id: args.id as string,
        replacementId: args.replacementId as string | undefined,
      };
      break;
    case "set_default_weekday_type":
      command = {
        type: "setDefaultWeekdayType",
        weekday: args.weekday as Weekday,
        dayTypeId: args.dayTypeId as string | null,
      };
      break;
    case "set_default_weekly_items":
      command = {
        type: "setDefaultWeeklyItems",
        items: args.items as ChecklistItem[],
      };
      break;
    case "set_week_day_type":
      command = {
        type: "setWeekDayType",
        year: args.year as number,
        monday: args.monday as string,
        weekday: args.weekday as Weekday,
        dayTypeId: args.dayTypeId as string | null,
      };
      break;
    case "set_week_day_items":
      command = {
        type: "setWeekDayItems",
        year: args.year as number,
        monday: args.monday as string,
        weekday: args.weekday as Weekday,
        items: args.items as WeekItem[],
      };
      break;
    case "set_week_weekly_items":
      command = {
        type: "setWeekWeeklyItems",
        year: args.year as number,
        monday: args.monday as string,
        items: args.items as WeekItem[],
      };
      break;
    case "place_grid_block":
      command = {
        type: "placeGridBlock",
        year: args.year as number,
        monday: args.monday as string,
        block: args.block as GridBlock,
      };
      break;
    case "clear_grid_block":
      command = {
        type: "clearGridBlock",
        year: args.year as number,
        monday: args.monday as string,
        itemId: args.itemId as string,
        weekday: args.weekday as Weekday,
      };
      break;
    case "reset_week":
      command = { type: "resetWeek", year: args.year as number, monday: args.monday as string };
      break;
    case "create_task":
      command = {
        type: "createTask",
        title: args.title as string,
        notes: args.notes as string | undefined,
        column: args.column as TaskColumn | undefined,
        links: args.links as TaskLinks | undefined,
      };
      break;
    case "update_task":
      command = {
        type: "updateTask",
        id: args.id as string,
        title: args.title as string | undefined,
        notes: args.notes as string | undefined,
        column: args.column as TaskColumn | undefined,
        links: args.links as TaskLinks | undefined,
      };
      break;
    case "delete_task":
      command = { type: "deleteTask", id: args.id as string };
      break;
    case "set_about_me":
      command = { type: "setAboutMe", text: args.text as string };
      break;
    default:
      command = null;
  }
  return command === null ? null : omitUndefined(command);
}
