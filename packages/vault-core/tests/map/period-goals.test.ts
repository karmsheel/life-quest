import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { ensureCurrentYear } from "../../src/map/years.ts";
import type { ApplyContext } from "../../src/map/types.ts";

const ctx: ApplyContext = {
  actor: "user",
  today: "2026-08-18",
  id: () => "g1",
};

function base() {
  return ensureCurrentYear(emptyState(), ctx.today);
}

describe("period goals", () => {
  it("creates a goal inside the year", () => {
    const res = applyCommand(
      base(),
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "Airdrop Guide",
        color: "gold",
        start: "2026-04-01",
        end: "2026-05-15",
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.years[0].periodGoals, [
      {
        id: "g1",
        name: "Airdrop Guide",
        color: "gold",
        start: "2026-04-01",
        end: "2026-05-15",
      },
    ]);
  });

  it("rejects a range that leaves the year or is inverted", () => {
    const cross = applyCommand(
      base(),
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "X",
        color: "red",
        start: "2026-12-20",
        end: "2027-01-05",
      },
      ctx,
    );
    assert.equal(cross.ok, false);
    if (cross.ok) return;
    assert.equal(cross.error.code, "INVALID_RANGE");
    const inv = applyCommand(
      base(),
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "X",
        color: "red",
        start: "2026-05-15",
        end: "2026-04-01",
      },
      ctx,
    );
    assert.equal(inv.ok, false);
  });

  it("allows overlap; delete removes only that goal", () => {
    let ids = 0;
    const c: ApplyContext = { ...ctx, id: () => `g${++ids}` };
    let s = base();
    const a = applyCommand(
      s,
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "A",
        color: "gold",
        start: "2026-04-01",
        end: "2026-04-10",
      },
      c,
    );
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = applyCommand(
      a.value,
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "B",
        color: "red",
        start: "2026-04-05",
        end: "2026-04-20",
      },
      c,
    );
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.equal(b.value.years[0].periodGoals.length, 2);
    const del = applyCommand(
      b.value,
      { type: "deletePeriodGoal", year: 2026, id: "g1" },
      c,
    );
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.years[0].periodGoals.map((g) => g.id), ["g2"]);
  });

  it("update with only name leaves color/start/end unchanged", () => {
    const created = applyCommand(
      base(),
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "Airdrop Guide",
        color: "gold",
        start: "2026-04-01",
        end: "2026-05-15",
      },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyCommand(
      created.value,
      { type: "updatePeriodGoal", year: 2026, id: "g1", name: "Renamed" },
      ctx,
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.deepEqual(updated.value.years[0].periodGoals, [
      {
        id: "g1",
        name: "Renamed",
        color: "gold",
        start: "2026-04-01",
        end: "2026-05-15",
      },
    ]);
  });

  it("refuses writes to an archive", () => {
    let s = base();
    s = {
      ...s,
      years: s.years.map((y) => ({ ...y, status: "archive" as const })),
    };
    const res = applyCommand(
      s,
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "A",
        color: "gold",
        start: "2026-01-01",
        end: "2026-01-02",
      },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "ARCHIVE_READ_ONLY");
  });
});
