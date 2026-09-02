export type ColorId =
  | "gold"
  | "red"
  | "blue"
  | "green"
  | "orange"
  | "purple"
  | "teal"
  | "pink";

export type IsoDate = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Actor = "user" | "agent";
export type Priority = "required" | "semi-optional" | "optional";
export type YearStatus = "live" | "archive";

export type DomainErrorCode =
  | "ARCHIVE_READ_ONLY"
  | "YEAR_CAP"
  | "CANNOT_DELETE_CURRENT_YEAR"
  | "INVALID_RANGE"
  | "DAY_TYPE_IN_USE"
  | "NOT_FOUND"
  | "MALFORMED"
  | "STORE_WRITE_FAILED";

export type DomainError = { code: DomainErrorCode; message: string };

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export type PeriodGoal = {
  id: string;
  name: string;
  color: ColorId;
  start: IsoDate;
  end: IsoDate;
};

export type MonthData = {
  objectives: string;
  notes: string;
  days: Record<string, string>;
};

export type ChecklistItem = { id: string; text: string };

export type DayType = {
  id: string;
  name: string;
  color: ColorId;
  items: ChecklistItem[];
};

export type DefaultWeek = {
  dayTypeByWeekday: (string | null)[];
  weeklyItems: ChecklistItem[];
};

export type WeekItem = {
  id: string;
  text: string;
  priority: Priority;
};

export type GridBlock = {
  itemId: string;
  weekday: Weekday;
  startMinutes: number;
  durationMinutes: number;
};

export type DetachedWeek = {
  monday: IsoDate;
  dayTypeByWeekday: (string | null)[];
  days: WeekItem[][];
  weeklyItems: WeekItem[];
  grid: GridBlock[];
};

export type ResolvedWeek = {
  monday: IsoDate;
  inheriting: boolean;
  prioritiesActive: boolean;
  dayTypeByWeekday: (string | null)[];
  days: WeekItem[][];
  weeklyItems: WeekItem[];
  grid: GridBlock[];
};

export type YearSnapshot = {
  dayTypes: DayType[];
  defaultWeek: DefaultWeek;
  materializedWeeks: Record<string, DetachedWeek>;
};

export type YearRecord = {
  year: number;
  status: YearStatus;
  periodGoals: PeriodGoal[];
  months: MonthData[];
  detachedWeeks: Record<string, DetachedWeek>;
  snapshot?: YearSnapshot;
};

export type TaskColumn = "backlog" | "this-week" | "today" | "done";

export type TaskLinks = {
  periodGoalId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  column: TaskColumn;
  links: TaskLinks;
};

export type StoreState = {
  dayTypes: DayType[];
  defaultWeek: DefaultWeek;
  years: YearRecord[];
  tasks: Task[];
  aboutMe: string;
};

export type ApplyContext = {
  actor: Actor;
  today: IsoDate;
  id: () => string;
};

export type Command =
  | { type: "createYear"; year: number }
  | { type: "deleteYear"; year: number }
  | {
      type: "createPeriodGoal";
      year: number;
      name: string;
      color: ColorId;
      start: IsoDate;
      end: IsoDate;
    }
  | {
      type: "updatePeriodGoal";
      year: number;
      id: string;
      name?: string;
      color?: ColorId;
      start?: IsoDate;
      end?: IsoDate;
    }
  | { type: "deletePeriodGoal"; year: number; id: string }
  | {
      type: "setMonthDay";
      year: number;
      month: number;
      day: number;
      text: string;
    }
  | { type: "setMonthObjectives"; year: number; month: number; text: string }
  | { type: "setMonthNotes"; year: number; month: number; text: string }
  | { type: "createDayType"; name: string; color: ColorId }
  | {
      type: "updateDayType";
      id: string;
      name?: string;
      color?: ColorId;
      items?: ChecklistItem[];
    }
  | { type: "deleteDayType"; id: string; replacementId?: string }
  | { type: "setDefaultWeekdayType"; weekday: Weekday; dayTypeId: string | null }
  | { type: "setDefaultWeeklyItems"; items: ChecklistItem[] }
  | {
      type: "setWeekDayType";
      year: number;
      monday: IsoDate;
      weekday: Weekday;
      dayTypeId: string | null;
    }
  | {
      type: "setWeekDayItems";
      year: number;
      monday: IsoDate;
      weekday: Weekday;
      items: WeekItem[];
    }
  | {
      type: "setWeekWeeklyItems";
      year: number;
      monday: IsoDate;
      items: WeekItem[];
    }
  | {
      type: "placeGridBlock";
      year: number;
      monday: IsoDate;
      block: GridBlock;
    }
  | {
      type: "clearGridBlock";
      year: number;
      monday: IsoDate;
      itemId: string;
      weekday: Weekday;
    }
  | { type: "resetWeek"; year: number; monday: IsoDate }
  | {
      type: "createTask";
      title: string;
      notes?: string;
      column?: TaskColumn;
      links?: TaskLinks;
    }
  | {
      type: "updateTask";
      id: string;
      title?: string;
      notes?: string;
      column?: TaskColumn;
      links?: TaskLinks;
    }
  | { type: "deleteTask"; id: string }
  | { type: "setAboutMe"; text: string };
