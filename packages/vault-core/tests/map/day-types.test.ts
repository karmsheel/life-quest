import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { ensureCurrentYear } from "../../src/map/years.ts";
import type { ApplyContext, DetachedWeek } from "../../src/map/types.ts";

let n = 0;
const ctx: ApplyContext = {
  actor: "user",
  today: "2026-08-18",
  id: () => `t${++n}`,
};

function fresh() {
  n = 0;
  return ensureCurrentYear(emptyState(), ctx.today);
}

describe("day types and default week", () => {
  it("creates a type and assigns it on the default week", () => {
    let s = fresh();
    const created = applyCommand(
      s,
      { type: "createDayType", name: "Client", color: "orange" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    s = created.value;
    const assigned = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 0, dayTypeId: "t1" },
      ctx,
    );
    assert.equal(assigned.ok, true);
    if (!assigned.ok) return;
    assert.equal(assigned.value.defaultWeek.dayTypeByWeekday[0], "t1");
  });

  it("blocks delete while the default week uses the type", () => {
    let s = fresh();
    const created = applyCommand(
      s,
      { type: "createDayType", name: "Client", color: "orange" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    s = created.value;
    const assigned = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 0, dayTypeId: "t1" },
      ctx,
    );
    assert.equal(assigned.ok, true);
    if (!assigned.ok) return;
    s = assigned.value;
    const del = applyCommand(s, { type: "deleteDayType", id: "t1" }, ctx);
    assert.equal(del.ok, false);
    if (del.ok) return;
    assert.equal(del.error.code, "DAY_TYPE_IN_USE");
  });

  it("blocks delete while a live detached week uses the type", () => {
    let s = fresh();
    const created = applyCommand(
      s,
      { type: "createDayType", name: "Client", color: "orange" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    s = created.value;
    const detached: DetachedWeek = {
      monday: "2026-08-17",
      dayTypeByWeekday: ["t1", null, null, null, null, null, null],
      days: [[], [], [], [], [], [], []],
      weeklyItems: [],
      grid: [],
    };
    s = {
      ...s,
      years: s.years.map((y) =>
        y.year === 2026
          ? { ...y, detachedWeeks: { "2026-08-17": detached } }
          : y,
      ),
    };
    const del = applyCommand(s, { type: "deleteDayType", id: "t1" }, ctx);
    assert.equal(del.ok, false);
    if (del.ok) return;
    assert.equal(del.error.code, "DAY_TYPE_IN_USE");
  });

  it("delete with replacement reassigns the default week then deletes", () => {
    let s = fresh();
    const created1 = applyCommand(
      s,
      { type: "createDayType", name: "Client", color: "orange" },
      ctx,
    );
    assert.equal(created1.ok, true);
    if (!created1.ok) return;
    s = created1.value;
    const created2 = applyCommand(
      s,
      { type: "createDayType", name: "Rest", color: "blue" },
      ctx,
    );
    assert.equal(created2.ok, true);
    if (!created2.ok) return;
    s = created2.value;
    const assigned = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 0, dayTypeId: "t1" },
      ctx,
    );
    assert.equal(assigned.ok, true);
    if (!assigned.ok) return;
    s = assigned.value;
    const del = applyCommand(
      s,
      { type: "deleteDayType", id: "t1", replacementId: "t2" },
      ctx,
    );
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.dayTypes.map((t) => t.id), ["t2"]);
    assert.equal(del.value.defaultWeek.dayTypeByWeekday[0], "t2");
  });

  it("stores default weekly-only items", () => {
    const s = fresh();
    const res = applyCommand(
      s,
      {
        type: "setDefaultWeeklyItems",
        items: [{ id: "w1", text: "Weekly review" }],
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.defaultWeek.weeklyItems[0].text, "Weekly review");
  });
});
