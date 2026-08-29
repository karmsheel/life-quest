import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { emptyYear } from "../../src/map/empty.ts";
import {
  dashboardDays,
  periodGoalsOnDate,
  periodGoalsOverlappingMonth,
} from "../../src/map/queries.ts";
import type { PeriodGoal } from "../../src/map/types.ts";

const goal: PeriodGoal = {
  id: "g1",
  name: "Airdrop Guide",
  color: "gold",
  start: "2026-04-01",
  end: "2026-05-15",
};

describe("queries", () => {
  it("lists goals that overlap a month without writing objectives", () => {
    const year = { ...emptyYear(2026), periodGoals: [goal] };
    assert.deepEqual(periodGoalsOverlappingMonth(year, 4).map((g) => g.id), ["g1"]);
    assert.deepEqual(periodGoalsOverlappingMonth(year, 5).map((g) => g.id), ["g1"]);
    assert.deepEqual(periodGoalsOverlappingMonth(year, 6), []);
    assert.equal(year.months[3].objectives, "");
  });

  it("stacks colors on overlapping days", () => {
    const year = {
      ...emptyYear(2026),
      periodGoals: [
        goal,
        {
          id: "g2",
          name: "Other",
          color: "red" as const,
          start: "2026-04-10",
          end: "2026-04-10",
        },
      ],
    };
    assert.deepEqual(periodGoalsOnDate(year, "2026-04-10").map((g) => g.color), [
      "gold",
      "red",
    ]);
    const days = dashboardDays(year, 4);
    assert.equal(days.length, 30);
    assert.deepEqual(days[9].colors, ["gold", "red"]);
  });
});
