import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compareIso,
  daysInMonth,
  isDateInYear,
  isIsoDate,
  mondayOnOrBefore,
  mondaysInYear,
  weekdayOf,
  yearOf,
} from "../../src/map/dates.ts";

describe("dates", () => {
  it("mondayOnOrBefore returns the Monday of that week", () => {
    assert.equal(mondayOnOrBefore("2026-01-01"), "2025-12-29");
    assert.equal(mondayOnOrBefore("2026-08-17"), "2026-08-17");
    assert.equal(mondayOnOrBefore("2026-08-19"), "2026-08-17");
  });

  it("mondaysInYear lists only Mondays whose date falls in that year", () => {
    const ms = mondaysInYear(2026);
    assert.equal(ms[0], "2026-01-05");
    assert.equal(ms.at(-1), "2026-12-28");
    assert.equal(ms.every((d) => d.startsWith("2026-")), true);
  });

  it("daysInMonth handles leap years", () => {
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2026, 1), 31);
  });

  it("isDateInYear and yearOf", () => {
    assert.equal(isDateInYear("2026-12-31", 2026), true);
    assert.equal(isDateInYear("2027-01-01", 2026), false);
    assert.equal(yearOf("2026-08-17"), 2026);
  });

  it("rejects bad iso and orders dates", () => {
    assert.equal(isIsoDate("2026-13-01"), false);
    assert.equal(isIsoDate("2026-08-17"), true);
    assert.ok(compareIso("2026-01-02", "2026-01-01") > 0);
  });

  it("weekdayOf is Monday = 0", () => {
    assert.equal(weekdayOf("2026-09-14"), 0);
    assert.equal(weekdayOf("2026-09-15"), 1);
    assert.equal(weekdayOf("2026-09-20"), 6);
  });
});
