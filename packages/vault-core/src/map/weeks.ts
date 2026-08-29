import { isIsoDate, mondayOnOrBefore, mondaysInYear, yearOf } from "./dates.ts";
import { fail, ok } from "./errors.ts";
import type {
  DayType,
  DefaultWeek,
  DetachedWeek,
  GridBlock,
  IsoDate,
  ResolvedWeek,
  Result,
  StoreState,
  WeekItem,
  Weekday,
  YearRecord,
} from "./types.ts";
import { replaceYear, writableYear } from "./writable.ts";

const GRID_START = 360;
const GRID_END = 1320;
const SLOT = 30;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asOptionalItems(items: { id: string; text: string }[]): WeekItem[] {
  return items.map((i) => ({ id: i.id, text: i.text, priority: "optional" }));
}

function inheritedItemsFrom(
  dayTypes: DayType[],
  dayTypeId: string | null,
): WeekItem[] {
  if (!dayTypeId) return [];
  const dt = dayTypes.find((t) => t.id === dayTypeId);
  if (!dt) return [];
  return asOptionalItems(dt.items);
}

function inheritedWeekFrom(
  dayTypes: DayType[],
  defaultWeek: DefaultWeek,
  monday: IsoDate,
): DetachedWeek {
  return {
    monday,
    dayTypeByWeekday: defaultWeek.dayTypeByWeekday.slice(),
    days: defaultWeek.dayTypeByWeekday.map((id) =>
      inheritedItemsFrom(dayTypes, id),
    ),
    weeklyItems: asOptionalItems(defaultWeek.weeklyItems),
    grid: [],
  };
}

export function inheritedItems(
  state: StoreState,
  dayTypeId: string | null,
): WeekItem[] {
  return inheritedItemsFrom(state.dayTypes, dayTypeId);
}

export function inheritedWeek(state: StoreState, monday: IsoDate): DetachedWeek {
  return inheritedWeekFrom(state.dayTypes, state.defaultWeek, monday);
}

function toResolved(week: DetachedWeek, inheriting: boolean): ResolvedWeek {
  return {
    monday: week.monday,
    inheriting,
    prioritiesActive: !inheriting,
    dayTypeByWeekday: week.dayTypeByWeekday.slice(),
    days: week.days.map((d) => d.slice()),
    weeklyItems: week.weeklyItems.slice(),
    grid: week.grid.slice(),
  };
}

export function resolveWeek(
  state: StoreState,
  year: number,
  monday: IsoDate,
): ResolvedWeek {
  const rec = state.years.find((y) => y.year === year);
  if (!rec) throw new Error(`Year ${year} not found`);
  const detached = rec.detachedWeeks[monday];
  if (detached) return toResolved(detached, false);
  if (rec.status === "archive") {
    const frozen = rec.snapshot?.materializedWeeks[monday];
    if (frozen) return toResolved(frozen, true);
    if (rec.snapshot) {
      return toResolved(
        inheritedWeekFrom(rec.snapshot.dayTypes, rec.snapshot.defaultWeek, monday),
        true,
      );
    }
  }
  return toResolved(inheritedWeek(state, monday), true);
}

export function detachIfNeeded(
  rec: YearRecord,
  monday: IsoDate,
  state: StoreState,
): YearRecord {
  if (rec.detachedWeeks[monday]) return rec;
  return {
    ...rec,
    detachedWeeks: {
      ...rec.detachedWeeks,
      [monday]: inheritedWeek(state, monday),
    },
  };
}

function assertMonday(year: number, monday: IsoDate): Result<void> {
  if (
    !isIsoDate(monday) ||
    mondayOnOrBefore(monday) !== monday ||
    yearOf(monday) !== year
  ) {
    return fail("INVALID_RANGE", "Week id must be a Monday in that year");
  }
  return ok(undefined);
}

function assertWeekday(weekday: Weekday): Result<void> {
  if (weekday < 0 || weekday > 6) return fail("MALFORMED", "Invalid weekday");
  return ok(undefined);
}

function withDetachedWeek(
  state: StoreState,
  year: number,
  monday: IsoDate,
  fn: (week: DetachedWeek) => Result<DetachedWeek>,
): Result<StoreState> {
  const recRes = writableYear(state, year);
  if (!recRes.ok) return recRes;
  const mondayRes = assertMonday(year, monday);
  if (!mondayRes.ok) return mondayRes;
  const rec = detachIfNeeded(recRes.value, monday, state);
  const nextWeek = fn(clone(rec.detachedWeeks[monday]));
  if (!nextWeek.ok) return nextWeek;
  return ok(
    replaceYear(state, {
      ...rec,
      detachedWeeks: { ...rec.detachedWeeks, [monday]: nextWeek.value },
    }),
  );
}

export function setWeekDayType(
  state: StoreState,
  year: number,
  monday: IsoDate,
  weekday: Weekday,
  dayTypeId: string | null,
): Result<StoreState> {
  const weekdayRes = assertWeekday(weekday);
  if (!weekdayRes.ok) return weekdayRes;
  if (dayTypeId && !state.dayTypes.some((t) => t.id === dayTypeId)) {
    return fail("NOT_FOUND", "Day type not found");
  }
  return withDetachedWeek(state, year, monday, (week) => {
    const dayTypeByWeekday = week.dayTypeByWeekday.slice();
    dayTypeByWeekday[weekday] = dayTypeId;
    const days = week.days.map((d) => d.slice());
    days[weekday] = inheritedItems(state, dayTypeId);
    const next = { ...week, dayTypeByWeekday, days };
    return ok({ ...next, grid: pruneGrid(next) });
  });
}

export function setWeekDayItems(
  state: StoreState,
  year: number,
  monday: IsoDate,
  weekday: Weekday,
  items: WeekItem[],
): Result<StoreState> {
  const weekdayRes = assertWeekday(weekday);
  if (!weekdayRes.ok) return weekdayRes;
  return withDetachedWeek(state, year, monday, (week) => {
    const days = week.days.map((d) => d.slice());
    days[weekday] = items;
    const next = { ...week, days };
    return ok({ ...next, grid: pruneGrid(next) });
  });
}

export function setWeekWeeklyItems(
  state: StoreState,
  year: number,
  monday: IsoDate,
  items: WeekItem[],
): Result<StoreState> {
  return withDetachedWeek(state, year, monday, (week) => {
    const next = { ...week, weeklyItems: items };
    return ok({ ...next, grid: pruneGrid(next) });
  });
}

function weekHasItem(
  week: Pick<DetachedWeek, "days" | "weeklyItems">,
  itemId: string,
): boolean {
  return (
    week.days.some((day) => day.some((i) => i.id === itemId)) ||
    week.weeklyItems.some((i) => i.id === itemId)
  );
}

function pruneGrid(week: DetachedWeek): GridBlock[] {
  return week.grid.filter((b) => weekHasItem(week, b.itemId));
}

function assertGridBlock(block: GridBlock): Result<void> {
  if (block.weekday < 0 || block.weekday > 6) {
    return fail("MALFORMED", "Invalid weekday");
  }
  if (
    !Number.isInteger(block.startMinutes) ||
    block.startMinutes < GRID_START ||
    block.startMinutes >= GRID_END ||
    block.startMinutes % SLOT !== 0
  ) {
    return fail(
      "INVALID_RANGE",
      "Grid start must be a 30-minute slot from 06:00 to 21:30",
    );
  }
  if (
    !Number.isInteger(block.durationMinutes) ||
    block.durationMinutes < SLOT ||
    block.durationMinutes % SLOT !== 0
  ) {
    return fail(
      "INVALID_RANGE",
      "Grid duration must be a positive multiple of 30 minutes",
    );
  }
  if (block.startMinutes + block.durationMinutes > GRID_END) {
    return fail("INVALID_RANGE", "Grid block must end by 22:00");
  }
  return ok(undefined);
}

export function placeGridBlock(
  state: StoreState,
  year: number,
  monday: IsoDate,
  block: GridBlock,
): Result<StoreState> {
  const slot = assertGridBlock(block);
  if (!slot.ok) return slot;
  const recRes = writableYear(state, year);
  if (!recRes.ok) return recRes;
  const mondayRes = assertMonday(year, monday);
  if (!mondayRes.ok) return mondayRes;
  if (!weekHasItem(resolveWeek(state, year, monday), block.itemId)) {
    return fail("NOT_FOUND", "Week item not found");
  }
  return withDetachedWeek(state, year, monday, (week) => {
    const grid = week.grid.filter(
      (b) => !(b.itemId === block.itemId && b.weekday === block.weekday),
    );
    grid.push(block);
    return ok({ ...week, grid });
  });
}

export function clearGridBlock(
  state: StoreState,
  year: number,
  monday: IsoDate,
  itemId: string,
  weekday: Weekday,
): Result<StoreState> {
  const weekdayRes = assertWeekday(weekday);
  if (!weekdayRes.ok) return weekdayRes;
  const recRes = writableYear(state, year);
  if (!recRes.ok) return recRes;
  const mondayRes = assertMonday(year, monday);
  if (!mondayRes.ok) return mondayRes;
  const week = recRes.value.detachedWeeks[monday];
  if (!week) return ok(state);
  const grid = week.grid.filter(
    (b) => !(b.itemId === itemId && b.weekday === weekday),
  );
  if (grid.length === week.grid.length) return ok(state);
  return ok(
    replaceYear(state, {
      ...recRes.value,
      detachedWeeks: {
        ...recRes.value.detachedWeeks,
        [monday]: { ...week, grid },
      },
    }),
  );
}

export function resetWeek(
  state: StoreState,
  year: number,
  monday: IsoDate,
): Result<StoreState> {
  const recRes = writableYear(state, year);
  if (!recRes.ok) return recRes;
  const mondayRes = assertMonday(year, monday);
  if (!mondayRes.ok) return mondayRes;
  if (!recRes.value.detachedWeeks[monday]) return ok(state);
  const detachedWeeks = { ...recRes.value.detachedWeeks };
  delete detachedWeeks[monday];
  return ok(replaceYear(state, { ...recRes.value, detachedWeeks }));
}

export function materializeYearWeeks(
  state: StoreState,
  rec: YearRecord,
): Record<string, DetachedWeek> {
  const out: Record<string, DetachedWeek> = {};
  for (const monday of mondaysInYear(rec.year)) {
    const detached = rec.detachedWeeks[monday];
    out[monday] = detached ? clone(detached) : inheritedWeek(state, monday);
  }
  return out;
}
