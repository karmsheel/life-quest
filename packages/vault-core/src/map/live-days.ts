import { fail, ok } from "./errors.ts";
import { isIsoDate, weekdayOf } from "./dates.ts";
import { updateTask } from "./tasks.ts";
import type {
  ApplyContext,
  IsoDate,
  LiveBlock,
  LiveDay,
  LiveLeftoverItem,
  LiveSource,
  Result,
  StoreState,
} from "./types.ts";

export type LiveLeftoverView = {
  id: string;
  text: string;
  done: boolean;
  kind: "stored" | "task";
  source: LiveSource;
};

export function liveDayView(
  state: StoreState,
  date: IsoDate,
): { day: LiveDay | null; leftover: LiveLeftoverView[] } {
  const day = state.liveDays[date] ?? null;
  const taskIdsInBlocks = new Set(
    day?.blocks
      .filter((b) => b.source.type === "task")
      .map((b) => (b.source as { taskId: string }).taskId) ?? [],
  );

  const taskRows: LiveLeftoverView[] = state.tasks
    .filter((t) => t.column === "today" && !taskIdsInBlocks.has(t.id))
    .map((t) => ({
      id: t.id,
      text: t.title,
      done: false,
      kind: "task" as const,
      source: { type: "task", taskId: t.id } as LiveSource,
    }));

  if (!day) {
    return { day: null, leftover: taskRows };
  }

  const stored: LiveLeftoverView[] = day.leftover.map((r) => ({
    id: r.id,
    text: r.text,
    done: r.done,
    kind: "stored" as const,
    source: r.source,
  }));

  return { day, leftover: [...stored, ...taskRows] };
}

function putDay(state: StoreState, day: LiveDay): StoreState {
  return { ...state, liveDays: { ...state.liveDays, [day.date]: day } };
}

function requireDay(state: StoreState, date: IsoDate): Result<LiveDay> {
  if (!isIsoDate(date)) return fail("MALFORMED", `Invalid date: ${date}`);
  const day = state.liveDays[date];
  if (!day) return fail("NOT_FOUND", `No live day for ${date}`);
  return ok(day);
}

function copyTypeItems(
  state: StoreState,
  dayTypeId: string,
  ctx: ApplyContext,
): LiveLeftoverItem[] {
  const type = state.dayTypes.find((t) => t.id === dayTypeId);
  if (!type) return [];
  return type.items.map((item) => ({
    id: ctx.id(),
    text: item.text,
    done: false,
    source: { type: "template", dayTypeItemId: item.id },
  }));
}

function assertMinutes(start: number, duration: number): Result<true> {
  if (!Number.isInteger(start) || start < 0)
    return fail("MALFORMED", "startMinutes must be a non-negative integer");
  if (!Number.isInteger(duration) || duration < 1)
    return fail("MALFORMED", "durationMinutes must be a positive integer");
  return ok(true);
}

function cascadeFrom(blocks: LiveBlock[], editedId: string): LiveBlock[] {
  const sorted = [...blocks].sort(
    (a, b) => a.startMinutes - b.startMinutes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const idx = sorted.findIndex((b) => b.id === editedId);
  if (idx < 0) return sorted;

  let end = sorted[idx].startMinutes + sorted[idx].durationMinutes;
  for (let i = idx + 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < end) {
      sorted[i] = { ...sorted[i], startMinutes: end };
    }
    end = sorted[i].startMinutes + sorted[i].durationMinutes;
  }
  return sorted;
}

export function ensureLiveDay(
  state: StoreState,
  date: IsoDate,
  ctx: ApplyContext,
): Result<StoreState> {
  if (!isIsoDate(date)) return fail("MALFORMED", `Invalid date: ${date}`);
  const existing = state.liveDays[date];
  if (existing) return ok(state);

  const dayTypeId = state.defaultWeek.dayTypeByWeekday[weekdayOf(date)];
  const leftover = dayTypeId ? copyTypeItems(state, dayTypeId, ctx) : [];
  const day: LiveDay = {
    date,
    dayTypeId: dayTypeId ?? null,
    leftover,
    blocks: [],
  };
  return ok(putDay(state, day));
}

export function setLiveDayType(
  state: StoreState,
  date: IsoDate,
  dayTypeId: string | null,
  ctx: ApplyContext,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  if (day.dayTypeId === dayTypeId) return ok(state);

  if (dayTypeId !== null && !state.dayTypes.some((t) => t.id === dayTypeId)) {
    return fail("NOT_FOUND", `Day type not found: ${dayTypeId}`);
  }

  const templateLeftover = dayTypeId ? copyTypeItems(state, dayTypeId, ctx) : [];
  const keptLeftover = day.leftover.filter((r) => r.source.type !== "template");
  return ok(
    putDay(state, {
      ...day,
      dayTypeId,
      leftover: [...keptLeftover, ...templateLeftover],
    }),
  );
}

export function addLiveAdHoc(
  state: StoreState,
  date: IsoDate,
  text: string,
  ctx: ApplyContext,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  const trimmed = text.trim();
  if (!trimmed) return fail("MALFORMED", "Schedule item text is required");
  const item: LiveLeftoverItem = {
    id: ctx.id(),
    text: trimmed,
    done: false,
    source: { type: "ad-hoc" },
  };
  return ok(putDay(state, { ...day, leftover: [...day.leftover, item] }));
}

export function placeLiveBlock(
  state: StoreState,
  date: IsoDate,
  spec: { leftoverId?: string; taskId?: string; startMinutes: number; durationMinutes: number },
  ctx: ApplyContext,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;

  const minCheck = assertMinutes(spec.startMinutes, spec.durationMinutes);
  if (!minCheck.ok) return minCheck;

  const hasLeftover = spec.leftoverId !== undefined;
  const hasTask = spec.taskId !== undefined;
  if (hasLeftover === hasTask) {
    return fail("MALFORMED", "Exactly one of leftoverId or taskId is required");
  }

  if (hasLeftover) {
    const idx = day.leftover.findIndex((r) => r.id === spec.leftoverId);
    if (idx < 0) return fail("NOT_FOUND", `Leftover not found: ${spec.leftoverId}`);
    const item = day.leftover[idx];
    const block: LiveBlock = {
      id: item.id,
      text: item.text,
      startMinutes: spec.startMinutes,
      durationMinutes: spec.durationMinutes,
      done: item.done,
      source: item.source,
    };
    const newLeftover = day.leftover.filter((r) => r.id !== spec.leftoverId);
    const newBlocks = cascadeFrom([...day.blocks, block], block.id);
    return ok(putDay(state, { ...day, leftover: newLeftover, blocks: newBlocks }));
  }

  // Task placement
  const taskId = spec.taskId!;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return fail("NOT_FOUND", `Task not found: ${taskId}`);
  if (task.column !== "today") {
    return fail("MALFORMED", "Only today tasks can be placed");
  }
  const alreadyPlaced = day.blocks.some(
    (b) => b.source.type === "task" && (b.source as { taskId: string }).taskId === taskId,
  );
  if (alreadyPlaced) {
    return fail("MALFORMED", "Task is already placed on this day");
  }

  const block: LiveBlock = {
    id: ctx.id(),
    text: task.title,
    startMinutes: spec.startMinutes,
    durationMinutes: spec.durationMinutes,
    done: false,
    source: { type: "task", taskId },
  };
  const newBlocks = cascadeFrom([...day.blocks, block], block.id);
  return ok(putDay(state, { ...day, blocks: newBlocks }));
}

export function updateLiveBlock(
  state: StoreState,
  date: IsoDate,
  blockId: string,
  patch: { startMinutes?: number; durationMinutes?: number },
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  const idx = day.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return fail("NOT_FOUND", `Block not found: ${blockId}`);

  const block = day.blocks[idx];
  const start = patch.startMinutes ?? block.startMinutes;
  const duration = patch.durationMinutes ?? block.durationMinutes;
  const minCheck = assertMinutes(start, duration);
  if (!minCheck.ok) return minCheck;

  const newBlocks = day.blocks.slice();
  newBlocks[idx] = { ...block, startMinutes: start, durationMinutes: duration };
  const cascaded = cascadeFrom(newBlocks, blockId);
  return ok(putDay(state, { ...day, blocks: cascaded }));
}

export function unplaceLiveBlock(
  state: StoreState,
  date: IsoDate,
  blockId: string,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  const idx = day.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return fail("NOT_FOUND", `Block not found: ${blockId}`);

  const block = day.blocks[idx];
  const newBlocks = day.blocks.filter((b) => b.id !== blockId);

  if (block.source.type === "task") {
    return ok(putDay(state, { ...day, blocks: newBlocks }));
  }

  const leftoverItem: LiveLeftoverItem = {
    id: block.id,
    text: block.text,
    done: block.done,
    source: block.source,
  };
  return ok(
    putDay(state, {
      ...day,
      blocks: newBlocks,
      leftover: [...day.leftover, leftoverItem],
    }),
  );
}

export function completeLiveLeftover(
  state: StoreState,
  date: IsoDate,
  leftoverId: string,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  const idx = day.leftover.findIndex((r) => r.id === leftoverId);
  if (idx < 0) return fail("NOT_FOUND", `Leftover not found: ${leftoverId}`);
  const newLeftover = day.leftover.slice();
  newLeftover[idx] = { ...newLeftover[idx], done: !newLeftover[idx].done };
  return ok(putDay(state, { ...day, leftover: newLeftover }));
}

export function completeLiveBlock(
  state: StoreState,
  date: IsoDate,
  blockId: string,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  const idx = day.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return fail("NOT_FOUND", `Block not found: ${blockId}`);

  const block = day.blocks[idx];
  const newDone = !block.done;
  const newBlocks = day.blocks.slice();
  newBlocks[idx] = { ...block, done: newDone };

  let next = putDay(state, { ...day, blocks: newBlocks });

  if (newDone && block.source.type === "task") {
    const taskId = (block.source as { taskId: string }).taskId;
    const taskRes = updateTask(next, taskId, { column: "done" });
    if (taskRes.ok) next = taskRes.value;
  }

  return ok(next);
}

export function deleteLiveAdHoc(
  state: StoreState,
  date: IsoDate,
  leftoverId: string,
): Result<StoreState> {
  const dr = requireDay(state, date);
  if (!dr.ok) return dr;
  const day = dr.value;
  const item = day.leftover.find((r) => r.id === leftoverId);
  if (!item) return fail("NOT_FOUND", `Leftover not found: ${leftoverId}`);
  if (item.source.type !== "ad-hoc") {
    return fail("MALFORMED", "Only ad-hoc items can be deleted");
  }
  return ok(
    putDay(state, { ...day, leftover: day.leftover.filter((r) => r.id !== leftoverId) }),
  );
}
