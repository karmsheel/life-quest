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

/**
 * A task's place on the Act board, in board order.
 *
 * `done` and `in-progress` close the row on the left, the working horizons
 * widen away from today through `next-30-days`, and `backlog` is the
 * unscheduled far end. The order is also the order the columns are drawn in.
 */
export type TaskColumn =
  | "done"
  | "in-progress"
  | "today"
  | "this-week"
  | "next-30-days"
  | "backlog";

export type TaskLinks = {
  goalId?: string;
  /** KAR-7: a task may point at a project. A dangling id is stored, not rejected. */
  projectId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
  signalId?: string;
};

/**
 * Who put a task on the board.
 *
 * Optional on purpose: map files written before provenance existed — and
 * hand-edited ones — carry no origin, and the loader fills them in as
 * `operator`. A freshly created task always gets one from the command's actor.
 */
export type TaskOrigin = "agent" | "operator";

export type Task = {
  id: string;
  title: string;
  notes: string;
  column: TaskColumn;
  links: TaskLinks;
  origin?: TaskOrigin;
};

/**
 * How a recurring task comes round.
 *
 * The unit IS the shape: a weekly task needs a weekday, a monthly one a day of
 * the month, a yearly one a month and a day. The UI and the companion tools
 * show exactly the fields the chosen unit reads, so there is no "every N
 * weeks" corner to explain — a cadence is one of four plain rhythms.
 */
export type Recurrence =
  | { unit: "day" }
  | { unit: "week"; weekday: Weekday }
  | { unit: "month"; dayOfMonth: number }
  | { unit: "year"; month: number; day: number };

/** One occurrence the operator finished, newest first. */
export type RecurringCompletion = {
  /** The occurrence that was due. */
  due: IsoDate;
  /** The local day the tick landed. */
  completedOn: IsoDate;
};

/**
 * A standing record that comes round again — not a board card.
 *
 * The Act board's columns are horizons of work; a recurrence is a schedule, so
 * it stays out of them. `dueDate` is the next occurrence and the only schedule
 * state: completion moves it forward, and whether a row is due is derived from
 * it and the local day, never materialised as a task or a file.
 */
export type RecurringTask = {
  id: string;
  title: string;
  notes: string;
  recurrence: Recurrence;
  /** The next occurrence. */
  dueDate: IsoDate;
  /** An internal route the row opens, e.g. "/review/weekly". */
  link?: string;
  /** A paused record keeps its date and does not surface as due. */
  paused: boolean;
  /** The most recent completions, newest first. */
  history: RecurringCompletion[];
  origin?: TaskOrigin;
};

export type StoreState = {
  dayTypes: DayType[];
  defaultWeek: DefaultWeek;
  years: YearRecord[];
  tasks: Task[];
  recurring: RecurringTask[];
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
  /**
   * Move a task to `column`, placing it immediately before `beforeId` when that
   * card is in the target column and omitting it to append. This is the board's
   * drag/drop write: unlike `updateTask` it also chooses the task's position in
   * its new column, and it is a no-op when the task is already there.
   */
  | {
      type: "moveTask";
      id: string;
      column: TaskColumn;
      beforeId?: string | null;
    }
  | { type: "deleteTask"; id: string }
  /**
   * A recurring task is a standing record beside the board, not a card on it.
   *
   * `dueDate` defaults to the next occurrence on or after today, so a caller
   * that knows the rhythm does not have to do the calendar arithmetic itself.
   */
  | {
      type: "createRecurring";
      title: string;
      notes?: string;
      recurrence: Recurrence;
      dueDate?: IsoDate;
      link?: string;
    }
  | {
      type: "updateRecurring";
      id: string;
      title?: string;
      notes?: string;
      recurrence?: Recurrence;
      dueDate?: IsoDate;
      link?: string;
      paused?: boolean;
    }
  | { type: "deleteRecurring"; id: string }
  /** Record the current occurrence done and advance to the next one. */
  | { type: "completeRecurring"; id: string }
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
