import { isDateInYear, isIsoDate } from "./dates.ts";
import { fail, ok } from "./errors.ts";
import type { ApplyContext, MapEvent, Result, StoreState } from "./types.ts";
import { replaceYear, writableYear } from "./writable.ts";

export function isMapEvent(value: unknown): value is MapEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<MapEvent>;
  return (
    typeof e.id === "string" &&
    typeof e.title === "string" &&
    typeof e.date === "string" &&
    typeof e.notes === "string" &&
    (e.domainSlug === null || typeof e.domainSlug === "string") &&
    (e.goalId === null || typeof e.goalId === "string")
  );
}

function assertTitle(title: string): Result<string> {
  const trimmed = title.trim();
  if (!trimmed) return fail("MALFORMED", "Event title is required");
  return ok(trimmed);
}

function assertDate(year: number, date: string): Result<void> {
  if (!isIsoDate(date) || !isDateInYear(date, year)) {
    return fail("INVALID_RANGE", "Event date must fall in its year");
  }
  return ok(undefined);
}

function assertDomain(slug: string | null, ctx: ApplyContext): Result<void> {
  if (slug === null) return ok(undefined);
  if (!(ctx.liveDomainSlugs ?? []).includes(slug)) {
    return fail("MALFORMED", "Domain is not a live domain");
  }
  return ok(undefined);
}

function assertGoalId(goalId: string | null, ctx: ApplyContext): Result<void> {
  if (goalId === null) return ok(undefined);
  if (!(ctx.goalIds ?? []).includes(goalId)) {
    return fail("NOT_FOUND", "Goal not found");
  }
  return ok(undefined);
}

export function createEvent(
  state: StoreState,
  year: number,
  title: string,
  date: string,
  ctx: ApplyContext,
  notes?: string,
  domainSlug?: string | null,
  goalId?: string | null,
): Result<StoreState> {
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  const t = assertTitle(title);
  if (!t.ok) return t;
  const d = assertDate(year, date);
  if (!d.ok) return d;
  const slug = domainSlug ?? null;
  const domain = assertDomain(slug, ctx);
  if (!domain.ok) return domain;
  const gid = goalId ?? null;
  const goal = assertGoalId(gid, ctx);
  if (!goal.ok) return goal;
  const event: MapEvent = {
    id: ctx.id(),
    title: t.value,
    date,
    notes: notes ?? "",
    domainSlug: slug,
    goalId: gid,
  };
  return ok(
    replaceYear(state, {
      ...rec.value,
      events: [...rec.value.events, event],
    }),
  );
}

export function updateEvent(
  state: StoreState,
  year: number,
  id: string,
  patch: Partial<Pick<MapEvent, "title" | "date" | "notes" | "domainSlug" | "goalId">>,
  ctx: ApplyContext,
): Result<StoreState> {
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  const idx = rec.value.events.findIndex((e) => e.id === id);
  if (idx < 0) return fail("NOT_FOUND", "Event not found");
  const cur = rec.value.events[idx];
  const next: MapEvent = { ...cur };
  if (patch.title !== undefined) {
    const t = assertTitle(patch.title);
    if (!t.ok) return t;
    next.title = t.value;
  }
  if (patch.date !== undefined) {
    const d = assertDate(year, patch.date);
    if (!d.ok) return d;
    next.date = patch.date;
  }
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.domainSlug !== undefined) {
    const domain = assertDomain(patch.domainSlug, ctx);
    if (!domain.ok) return domain;
    next.domainSlug = patch.domainSlug;
  }
  if (patch.goalId !== undefined) {
    const goal = assertGoalId(patch.goalId, ctx);
    if (!goal.ok) return goal;
    next.goalId = patch.goalId;
  }
  const events = rec.value.events.slice();
  events[idx] = next;
  return ok(replaceYear(state, { ...rec.value, events }));
}

export function deleteEvent(
  state: StoreState,
  year: number,
  id: string,
): Result<StoreState> {
  const rec = writableYear(state, year);
  if (!rec.ok) return rec;
  if (!rec.value.events.some((e) => e.id === id)) {
    return fail("NOT_FOUND", "Event not found");
  }
  return ok(
    replaceYear(state, {
      ...rec.value,
      events: rec.value.events.filter((e) => e.id !== id),
    }),
  );
}
