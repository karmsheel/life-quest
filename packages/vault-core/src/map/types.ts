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

export type MapEvent = {
  id: string;
  title: string;
  date: IsoDate;
  notes: string;
  domainSlug: string | null;
  goalId: string | null;
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
  events: MapEvent[];
  months: MonthData[];
  detachedWeeks: Record<string, DetachedWeek>;
  snapshot?: YearSnapshot;
};

export type TaskColumn = "backlog" | "this-week" | "today" | "done";

export type TaskLinks = {
  goalId?: string;
  /** KAR-7: a task may point at a project. A dangling id is stored, not rejected. */
  projectId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
  signalId?: string;
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
  liveDays: Record<IsoDate, LiveDay>;
  aboutMe: string;
};

export type LiveSource =
  | { type: "template"; dayTypeItemId: string }
  | { type: "ad-hoc" }
  | { type: "task"; taskId: string };

export type LiveLeftoverItem = {
  id: string;
  text: string;
  done: boolean;
  source: Exclude<LiveSource, { type: "task" }>;
};

export type LiveBlock = {
  id: string;
  text: string;
  startMinutes: number;
  durationMinutes: number;
  done: boolean;
  source: LiveSource;
};

export type LiveDay = {
  date: IsoDate;
  dayTypeId: string | null;
  leftover: LiveLeftoverItem[];
  blocks: LiveBlock[];
};

export type ApplyContext = {
  actor: Actor;
  today: IsoDate;
  id: () => string;
  liveDomainSlugs?: readonly string[];
  goalIds?: readonly string[];
};

export type Command =
  | { type: "createYear"; year: number }
  | { type: "deleteYear"; year: number }
  | {
      type: "createEvent";
      year: number;
      title: string;
      date: IsoDate;
      notes?: string;
      domainSlug?: string | null;
      goalId?: string | null;
    }
  | {
      type: "updateEvent";
      year: number;
      id: string;
      title?: string;
      date?: IsoDate;
      notes?: string;
      domainSlug?: string | null;
      goalId?: string | null;
    }
  | { type: "deleteEvent"; year: number; id: string }
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
  | { type: "setAboutMe"; text: string }
  | { type: "ensureLiveDay"; date: IsoDate }
  | { type: "setLiveDayType"; date: IsoDate; dayTypeId: string | null }
  | { type: "addLiveAdHoc"; date: IsoDate; text: string }
  | {
      type: "placeLiveBlock";
      date: IsoDate;
      leftoverId?: string;
      taskId?: string;
      startMinutes: number;
      durationMinutes: number;
    }
  | {
      type: "updateLiveBlock";
      date: IsoDate;
      blockId: string;
      startMinutes?: number;
      durationMinutes?: number;
    }
  | { type: "unplaceLiveBlock"; date: IsoDate; blockId: string }
  | { type: "completeLiveLeftover"; date: IsoDate; leftoverId: string }
  | { type: "completeLiveBlock"; date: IsoDate; blockId: string }
  | { type: "deleteLiveAdHoc"; date: IsoDate; leftoverId: string };
