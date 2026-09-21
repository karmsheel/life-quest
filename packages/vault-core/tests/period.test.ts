import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  currentPeriod,
  isCurrentPeriod,
  isFuturePeriod,
  nextPeriod,
  periodBounds,
  periodTitle,
  previousPeriod,
  weekStartOnOrBefore,
} from "../src/period.ts";

describe("period math", () => {
  const mondayNow = new Date(2026, 8, 23, 15, 0, 0); // Wed 23 Sep 2026 local

  it("weekStartOnOrBefore monday lands on Monday", () => {
    assert.equal(weekStartOnOrBefore("2026-09-23", "monday"), "2026-09-21");
    assert.equal(weekStartOnOrBefore("2026-09-21", "monday"), "2026-09-21");
    assert.equal(weekStartOnOrBefore("2026-09-27", "monday"), "2026-09-21");
  });

  it("weekStartOnOrBefore sunday lands on Sunday", () => {
    assert.equal(weekStartOnOrBefore("2026-09-23", "sunday"), "2026-09-20");
    assert.equal(weekStartOnOrBefore("2026-09-20", "sunday"), "2026-09-20");
    assert.equal(weekStartOnOrBefore("2026-09-26", "sunday"), "2026-09-20");
  });

  it("current daily/weekly/monthly/quarterly/yearly", () => {
    assert.equal(currentPeriod("daily", "monday", mondayNow), "2026-09-23");
    assert.equal(currentPeriod("weekly", "monday", mondayNow), "2026-09-21");
    assert.equal(currentPeriod("weekly", "sunday", mondayNow), "2026-09-20");
    assert.equal(currentPeriod("monthly", "monday", mondayNow), "2026-09");
    assert.equal(currentPeriod("quarterly", "monday", mondayNow), "2026-Q3");
    assert.equal(currentPeriod("yearly", "monday", mondayNow), "2026");
  });

  it("weekly bounds are start through +6 days", () => {
    const b = periodBounds("weekly", "2026-09-21", "monday");
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.deepEqual(b.value, { start: "2026-09-21", end: "2026-09-27" });
  });

  it("daily/monthly/quarterly/yearly bounds", () => {
    const d = periodBounds("daily", "2026-09-23", "monday");
    assert.equal(d.ok, true);
    if (d.ok) assert.deepEqual(d.value, { start: "2026-09-23", end: "2026-09-23" });
    const m = periodBounds("monthly", "2026-09", "monday");
    assert.equal(m.ok, true);
    if (m.ok) assert.deepEqual(m.value, { start: "2026-09-01", end: "2026-09-30" });
    const q = periodBounds("quarterly", "2026-Q3", "monday");
    assert.equal(q.ok, true);
    if (q.ok) assert.deepEqual(q.value, { start: "2026-07-01", end: "2026-09-30" });
    const y = periodBounds("yearly", "2026", "monday");
    assert.equal(y.ok, true);
    if (y.ok) assert.deepEqual(y.value, { start: "2026-01-01", end: "2026-12-31" });
  });

  it("previous and next weekly", () => {
    const prev = previousPeriod("weekly", "2026-09-21", "monday");
    const next = nextPeriod("weekly", "2026-09-21", "monday");
    assert.equal(prev.ok, true);
    assert.equal(next.ok, true);
    if (prev.ok) assert.equal(prev.value, "2026-09-14");
    if (next.ok) assert.equal(next.value, "2026-09-28");
  });

  it("future vs current", () => {
    assert.equal(isCurrentPeriod("weekly", "2026-09-21", "monday", mondayNow), true);
    assert.equal(isFuturePeriod("weekly", "2026-09-21", "monday", mondayNow), false);
    assert.equal(isFuturePeriod("weekly", "2026-09-28", "monday", mondayNow), true);
    assert.equal(isFuturePeriod("daily", "2026-09-24", "monday", mondayNow), true);
    assert.equal(isFuturePeriod("daily", "2026-09-23", "monday", mondayNow), false);
  });

  it("periodTitle", () => {
    assert.equal(
      periodTitle("weekly", "2026-09-21", "monday"),
      "Weekly review · Week of 21 Sep 2026",
    );
    assert.equal(periodTitle("daily", "2026-09-23", "monday"), "Daily review · 23 Sep 2026");
    assert.equal(periodTitle("monthly", "2026-09", "monday"), "Monthly review · Sep 2026");
    assert.equal(periodTitle("quarterly", "2026-Q3", "monday"), "Quarterly review · 2026 Q3");
    assert.equal(periodTitle("yearly", "2026", "monday"), "Yearly review · 2026");
  });

  it("rejects malformed period ids", () => {
    assert.equal(periodBounds("weekly", "2026-W38", "monday").ok, false);
    assert.equal(periodBounds("monthly", "2026-9", "monday").ok, false);
    assert.equal(periodBounds("quarterly", "2026-Q5", "monday").ok, false);
  });
});
