import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { resolveWeek } from "../../src/map/weeks.ts";
import { ensureCurrentYear, rollover } from "../../src/map/years.ts";
import type { ApplyContext } from "../../src/map/types.ts";

describe("archive resolve", () => {
  it("archive resolveWeek uses the snapshot after the live library is cleared", () => {
    const ctx: ApplyContext = { actor: "user", today: "2026-12-31", id: () => "t1" };
    let s = ensureCurrentYear(emptyState(), ctx.today);
    const created = applyCommand(
      s,
      { type: "createDayType", name: "Client", color: "orange" },
      ctx,
    );
    if (!created.ok) throw new Error("setup");
    s = created.value;
    s = {
      ...s,
      dayTypes: s.dayTypes.map((t) => ({
        ...t,
        items: [{ id: "c1", text: "Outreach" }],
      })),
    };
    const assigned = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 0, dayTypeId: "t1" },
      ctx,
    );
    if (!assigned.ok) throw new Error("setup");
    s = rollover(assigned.value, "2027-01-01");
    s = {
      ...s,
      dayTypes: [],
      defaultWeek: {
        ...s.defaultWeek,
        dayTypeByWeekday: [null, null, null, null, null, null, null],
      },
    };
    const week = resolveWeek(s, 2026, "2026-12-28");
    assert.equal(week.days[0][0].text, "Outreach");
  });
});
