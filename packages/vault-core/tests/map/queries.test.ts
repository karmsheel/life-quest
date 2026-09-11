import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyYear } from "../../src/map/empty.ts";
import {
  dashboardDays,
  eventsInMonth,
  eventsOnDate,
} from "../../src/map/queries.ts";
import type { MapEvent } from "../../src/map/types.ts";

const ev: MapEvent = {
  id: "e1",
  title: "File taxes",
  date: "2026-04-15",
  notes: "",
  domainSlug: "health",
  goalId: null,
};

describe("event queries", () => {
  it("lists events in a month", () => {
    const year = { ...emptyYear(2026), events: [ev] };
    assert.deepEqual(eventsInMonth(year, 4).map((e) => e.id), ["e1"]);
    assert.deepEqual(eventsInMonth(year, 5), []);
  });

  it("stacks events on one day in dashboardDays", () => {
    const year = {
      ...emptyYear(2026),
      events: [
        ev,
        { ...ev, id: "e2", title: "Other", date: "2026-04-15", domainSlug: null },
      ],
    };
    assert.deepEqual(eventsOnDate(year, "2026-04-15").map((e) => e.id), ["e1", "e2"]);
    const days = dashboardDays(year, 4);
    assert.equal(days.length, 30);
    assert.deepEqual(days[14].events.map((e) => e.id), ["e1", "e2"]);
  });
});
