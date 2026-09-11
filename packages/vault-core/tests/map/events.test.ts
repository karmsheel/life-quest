import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { ensureCurrentYear } from "../../src/map/years.ts";
import type { ApplyContext } from "../../src/map/types.ts";

const ctx: ApplyContext = {
  actor: "user",
  today: "2026-08-18",
  id: () => "e1",
  liveDomainSlugs: ["health"],
  goalIds: ["goal-1"],
};

function base() {
  return ensureCurrentYear(emptyState(), ctx.today);
}

describe("map events", () => {
  it("creates a single-date event", () => {
    const res = applyCommand(
      base(),
      {
        type: "createEvent",
        year: 2026,
        title: "File taxes",
        date: "2026-04-15",
        domainSlug: "health",
        goalId: "goal-1",
        notes: "bring PDF",
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.years[0].events, [
      {
        id: "e1",
        title: "File taxes",
        date: "2026-04-15",
        notes: "bring PDF",
        domainSlug: "health",
        goalId: "goal-1",
      },
    ]);
  });

  it("rejects a date outside the year", () => {
    const res = applyCommand(
      base(),
      { type: "createEvent", year: 2026, title: "X", date: "2027-01-01" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "INVALID_RANGE");
  });

  it("rejects empty title", () => {
    const res = applyCommand(
      base(),
      { type: "createEvent", year: 2026, title: "  ", date: "2026-01-01" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("rejects a new goalId that is missing", () => {
    const res = applyCommand(
      base(),
      {
        type: "createEvent",
        year: 2026,
        title: "X",
        date: "2026-01-01",
        goalId: "nope",
      },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "NOT_FOUND");
  });

  it("update that omits goalId keeps a dangling link", () => {
    const created = applyCommand(
      base(),
      {
        type: "createEvent",
        year: 2026,
        title: "X",
        date: "2026-01-01",
        goalId: "goal-1",
      },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyCommand(
      created.value,
      { type: "updateEvent", year: 2026, id: "e1", title: "Y" },
      { ...ctx, goalIds: [] },
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.years[0].events[0].title, "Y");
    assert.equal(updated.value.years[0].events[0].goalId, "goal-1");
  });

  it("allows two events on the same day; delete removes one", () => {
    let n = 0;
    const c: ApplyContext = { ...ctx, id: () => `e${++n}` };
    const a = applyCommand(
      base(),
      { type: "createEvent", year: 2026, title: "A", date: "2026-04-10" },
      c,
    );
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = applyCommand(
      a.value,
      { type: "createEvent", year: 2026, title: "B", date: "2026-04-10" },
      c,
    );
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.equal(b.value.years[0].events.length, 2);
    const del = applyCommand(
      b.value,
      { type: "deleteEvent", year: 2026, id: "e1" },
      c,
    );
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.years[0].events.map((e) => e.id), ["e2"]);
  });

  it("refuses writes to an archive", () => {
    const s = {
      ...base(),
      years: base().years.map((y) => ({ ...y, status: "archive" as const })),
    };
    const res = applyCommand(
      s,
      { type: "createEvent", year: 2026, title: "A", date: "2026-01-01" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "ARCHIVE_READ_ONLY");
  });
});
