import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { resolveWeek } from "../../src/map/weeks.ts";
import { ensureCurrentYear, rollover } from "../../src/map/years.ts";
import type { ApplyContext, StoreState } from "../../src/map/types.ts";

let n = 0;
const ctx: ApplyContext = {
  actor: "user",
  today: "2026-08-18",
  id: () => `i${++n}`,
};

function setup(): StoreState {
  n = 0;
  let s = ensureCurrentYear(emptyState(), ctx.today);
  const t = applyCommand(
    s,
    { type: "createDayType", name: "Client", color: "orange" },
    ctx,
  );
  if (!t.ok) throw new Error("setup");
  s = t.value;
  s = {
    ...s,
    dayTypes: s.dayTypes.map((dt) =>
      dt.id === "i1"
        ? { ...dt, items: [{ id: "c1", text: "Outreach" }] }
        : dt,
    ),
  };
  const assigned = applyCommand(
    s,
    { type: "setDefaultWeekdayType", weekday: 0, dayTypeId: "i1" },
    ctx,
  );
  if (!assigned.ok) throw new Error("setup");
  const weekly = applyCommand(
    assigned.value,
    {
      type: "setDefaultWeeklyItems",
      items: [{ id: "w1", text: "Review" }],
    },
    ctx,
  );
  if (!weekly.ok) throw new Error("setup");
  return weekly.value;
}

describe("weeks", () => {
  it("inherits default types and checklists", () => {
    const s = setup();
    const week = resolveWeek(s, 2026, "2026-08-17");
    assert.equal(week.inheriting, true);
    assert.equal(week.prioritiesActive, false);
    assert.equal(week.dayTypeByWeekday[0], "i1");
    assert.equal(week.days[0][0].id, "c1");
    assert.equal(week.days[0][0].text, "Outreach");
    assert.equal(week.weeklyItems[0].text, "Review");
    assert.deepEqual(week.grid, []);
  });

  it("first item edit detaches; later default changes do not apply", () => {
    let s = setup();
    const edit = applyCommand(
      s,
      {
        type: "setWeekDayItems",
        year: 2026,
        monday: "2026-08-17",
        weekday: 0,
        items: [{ id: "c1", text: "Outreach", priority: "required" }],
      },
      ctx,
    );
    assert.equal(edit.ok, true);
    if (!edit.ok) return;
    s = edit.value;
    assert.equal(resolveWeek(s, 2026, "2026-08-17").inheriting, false);
    const def = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 0, dayTypeId: null },
      ctx,
    );
    assert.equal(def.ok, true);
    if (!def.ok) return;
    assert.equal(resolveWeek(def.value, 2026, "2026-08-17").dayTypeByWeekday[0], "i1");
  });

  it("reset re-attaches", () => {
    let s = setup();
    const edit = applyCommand(
      s,
      {
        type: "setWeekDayItems",
        year: 2026,
        monday: "2026-08-17",
        weekday: 0,
        items: [{ id: "c1", text: "Outreach", priority: "required" }],
      },
      ctx,
    );
    assert.equal(edit.ok, true);
    if (!edit.ok) return;
    const reset = applyCommand(
      edit.value,
      { type: "resetWeek", year: 2026, monday: "2026-08-17" },
      ctx,
    );
    assert.equal(reset.ok, true);
    if (!reset.ok) return;
    assert.equal(resolveWeek(reset.value, 2026, "2026-08-17").inheriting, true);
  });

  it("reset of an inheriting week is a no-op", () => {
    const s = setup();
    const reset = applyCommand(
      s,
      { type: "resetWeek", year: 2026, monday: "2026-08-17" },
      ctx,
    );
    assert.equal(reset.ok, true);
    if (!reset.ok) return;
    assert.deepEqual(reset.value.years[0].detachedWeeks, {});
  });

  it("changing type on a detached day replaces that day's checklist", () => {
    let s = setup();
    const rest = applyCommand(
      s,
      { type: "createDayType", name: "Rest", color: "blue" },
      ctx,
    );
    assert.equal(rest.ok, true);
    if (!rest.ok) return;
    s = {
      ...rest.value,
      dayTypes: rest.value.dayTypes.map((dt) =>
        dt.name === "Rest" ? { ...dt, items: [{ id: "r1", text: "Walk" }] } : dt,
      ),
    };
    const detached = applyCommand(
      s,
      {
        type: "setWeekDayItems",
        year: 2026,
        monday: "2026-08-17",
        weekday: 0,
        items: [{ id: "c1", text: "Outreach", priority: "required" }],
      },
      ctx,
    );
    assert.equal(detached.ok, true);
    if (!detached.ok) return;
    const restId = s.dayTypes.find((t) => t.name === "Rest")!.id;
    const changed = applyCommand(
      detached.value,
      {
        type: "setWeekDayType",
        year: 2026,
        monday: "2026-08-17",
        weekday: 0,
        dayTypeId: restId,
      },
      ctx,
    );
    assert.equal(changed.ok, true);
    if (!changed.ok) return;
    const week = resolveWeek(changed.value, 2026, "2026-08-17");
    assert.deepEqual(week.days[0].map((i) => i.text), ["Walk"]);
  });

  it("placing a grid block detaches and does not create items; clear does not delete items", () => {
    let s = setup();
    const place = applyCommand(
      s,
      {
        type: "placeGridBlock",
        year: 2026,
        monday: "2026-08-17",
        block: {
          itemId: "c1",
          weekday: 0,
          startMinutes: 600,
          durationMinutes: 60,
        },
      },
      ctx,
    );
    assert.equal(place.ok, true);
    if (!place.ok) return;
    s = place.value;
    let week = resolveWeek(s, 2026, "2026-08-17");
    assert.equal(week.inheriting, false);
    assert.equal(week.grid.length, 1);
    assert.equal(week.days[0].some((i) => i.id === "c1"), true);
    const clear = applyCommand(
      s,
      {
        type: "clearGridBlock",
        year: 2026,
        monday: "2026-08-17",
        itemId: "c1",
        weekday: 0,
      },
      ctx,
    );
    assert.equal(clear.ok, true);
    if (!clear.ok) return;
    week = resolveWeek(clear.value, 2026, "2026-08-17");
    assert.deepEqual(week.grid, []);
    assert.equal(week.days[0].some((i) => i.id === "c1"), true);
  });

  it("clearGridBlock on an inheriting week does not detach", () => {
    const s = setup();
    const clear = applyCommand(
      s,
      {
        type: "clearGridBlock",
        year: 2026,
        monday: "2026-08-17",
        itemId: "c1",
        weekday: 0,
      },
      ctx,
    );
    assert.equal(clear.ok, true);
    if (!clear.ok) return;
    assert.equal(clear.value, s);
    assert.deepEqual(clear.value.years[0].detachedWeeks, {});
    assert.equal(resolveWeek(clear.value, 2026, "2026-08-17").inheriting, true);
  });

  it("placeGridBlock rejects an item that is not on the week", () => {
    const s = setup();
    const place = applyCommand(
      s,
      {
        type: "placeGridBlock",
        year: 2026,
        monday: "2026-08-17",
        block: {
          itemId: "missing",
          weekday: 0,
          startMinutes: 600,
          durationMinutes: 60,
        },
      },
      ctx,
    );
    assert.equal(place.ok, false);
    if (place.ok) return;
    assert.equal(place.error.code, "NOT_FOUND");
    assert.deepEqual(s.years[0].detachedWeeks, {});
    assert.equal(resolveWeek(s, 2026, "2026-08-17").inheriting, true);
  });

  it("changing a day's type or items prunes stale grid blocks", () => {
    let s = setup();
    const rest = applyCommand(
      s,
      { type: "createDayType", name: "Rest", color: "blue" },
      ctx,
    );
    assert.equal(rest.ok, true);
    if (!rest.ok) return;
    s = {
      ...rest.value,
      dayTypes: rest.value.dayTypes.map((dt) =>
        dt.name === "Rest" ? { ...dt, items: [{ id: "r1", text: "Walk" }] } : dt,
      ),
    };
    const placed = applyCommand(
      s,
      {
        type: "placeGridBlock",
        year: 2026,
        monday: "2026-08-17",
        block: {
          itemId: "c1",
          weekday: 0,
          startMinutes: 600,
          durationMinutes: 60,
        },
      },
      ctx,
    );
    assert.equal(placed.ok, true);
    if (!placed.ok) return;
    s = placed.value;
    const weeklyBlock = applyCommand(
      s,
      {
        type: "placeGridBlock",
        year: 2026,
        monday: "2026-08-17",
        block: {
          itemId: "w1",
          weekday: 1,
          startMinutes: 630,
          durationMinutes: 30,
        },
      },
      ctx,
    );
    assert.equal(weeklyBlock.ok, true);
    if (!weeklyBlock.ok) return;
    s = weeklyBlock.value;
    const restId = s.dayTypes.find((t) => t.name === "Rest")!.id;
    const typed = applyCommand(
      s,
      {
        type: "setWeekDayType",
        year: 2026,
        monday: "2026-08-17",
        weekday: 0,
        dayTypeId: restId,
      },
      ctx,
    );
    assert.equal(typed.ok, true);
    if (!typed.ok) return;
    s = typed.value;
    let week = resolveWeek(s, 2026, "2026-08-17");
    assert.deepEqual(week.grid.map((b) => b.itemId), ["w1"]);
    const replacedDay = applyCommand(
      s,
      {
        type: "setWeekDayItems",
        year: 2026,
        monday: "2026-08-17",
        weekday: 0,
        items: [{ id: "r1", text: "Walk", priority: "optional" }],
      },
      ctx,
    );
    assert.equal(replacedDay.ok, true);
    if (!replacedDay.ok) return;
    s = replacedDay.value;
    const weeklyOnly = applyCommand(
      s,
      {
        type: "setWeekWeeklyItems",
        year: 2026,
        monday: "2026-08-17",
        items: [{ id: "w2", text: "Plan", priority: "optional" }],
      },
      ctx,
    );
    assert.equal(weeklyOnly.ok, true);
    if (!weeklyOnly.ok) return;
    week = resolveWeek(weeklyOnly.value, 2026, "2026-08-17");
    assert.deepEqual(week.grid, []);
  });

  it("rollover materializes inheriting weeks into the archive snapshot", () => {
    const s = setup();
    const next = rollover(s, "2027-01-01");
    const arch = next.years.find((y) => y.year === 2026);
    assert.equal(arch?.status, "archive");
    const frozen = arch?.snapshot?.materializedWeeks["2026-08-17"];
    assert.equal(frozen?.days[0][0].text, "Outreach");
    next.dayTypes = [];
    next.defaultWeek.dayTypeByWeekday = [
      null, null, null, null, null, null, null,
    ];
    assert.equal(
      arch?.snapshot?.materializedWeeks["2026-08-17"].days[0][0].text,
      "Outreach",
    );
  });
});
