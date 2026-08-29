import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { emptyState, emptyYear } from "../../src/map/empty.ts";
import {
  createLiveYear,
  deleteYear,
  ensureCurrentYear,
  rollover,
} from "../../src/map/years.ts";

const today = "2026-08-18";

describe("years", () => {
  it("first launch creates the current year live", () => {
    const next = ensureCurrentYear(emptyState(), today);
    assert.equal(next.years.length, 1);
    assert.equal(next.years[0].year, 2026);
    assert.equal(next.years[0].status, "live");
  });

  it("createLiveYear allows current+2 and rejects a fourth", () => {
    let s = ensureCurrentYear(emptyState(), today);
    const y27 = createLiveYear(s, 2027, today);
    assert.equal(y27.ok, true);
    if (!y27.ok) return;
    s = y27.value;
    const y28 = createLiveYear(s, 2028, today);
    assert.equal(y28.ok, true);
    if (!y28.ok) return;
    s = y28.value;
    const y29 = createLiveYear(s, 2029, today);
    assert.equal(y29.ok, false);
    if (y29.ok) return;
    assert.equal(y29.error.code, "YEAR_CAP");
  });

  it("rejects creating a past year or a duplicate", () => {
    const s = ensureCurrentYear(emptyState(), today);
    const past = createLiveYear(s, 2025, today);
    assert.equal(past.ok, false);
    const dup = createLiveYear(s, 2026, today);
    assert.equal(dup.ok, false);
  });

  it("cannot delete the current year; can delete a future live year", () => {
    let s = ensureCurrentYear(emptyState(), today);
    const added = createLiveYear(s, 2027, today);
    assert.equal(added.ok, true);
    if (!added.ok) return;
    s = added.value;
    const cur = deleteYear(s, 2026, today);
    assert.equal(cur.ok, false);
    if (cur.ok) return;
    assert.equal(cur.error.code, "CANNOT_DELETE_CURRENT_YEAR");
    const fut = deleteYear(s, 2027, today);
    assert.equal(fut.ok, true);
    if (!fut.ok) return;
    assert.deepEqual(fut.value.years.map((y) => y.year), [2026]);
  });

  it("can delete an archive", () => {
    const s = emptyState();
    s.years.push({ ...emptyYear(2024), status: "archive", snapshot: {
      dayTypes: [],
      defaultWeek: s.defaultWeek,
      materializedWeeks: {},
    }});
    s.years.push(emptyYear(2026));
    const del = deleteYear(s, 2024, today);
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.years.map((y) => y.year), [2026]);
  });

  it("rollover archives last year and creates the new current year", () => {
    let s = ensureCurrentYear(emptyState(), "2026-12-31");
    s = rollover(s, "2027-01-01");
    const y26 = s.years.find((y) => y.year === 2026);
    const y27 = s.years.find((y) => y.year === 2027);
    assert.equal(y26?.status, "archive");
    assert.notEqual(y26?.snapshot, undefined);
    assert.notEqual(y26?.snapshot?.materializedWeeks["2026-01-05"], undefined);
    assert.equal(y27?.status, "live");
  });

  it("later library edits do not mutate an archive snapshot", () => {
    let s = ensureCurrentYear(emptyState(), "2026-12-31");
    s.dayTypes.push({
      id: "t1",
      name: "Client",
      color: "gold",
      items: [],
    });
    s = rollover(s, "2027-01-01");
    s.dayTypes[0] = { ...s.dayTypes[0], name: "Changed" };
    const snap = s.years.find((y) => y.year === 2026)?.snapshot;
    assert.equal(snap?.dayTypes[0].name, "Client");
  });
});
