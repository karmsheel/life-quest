import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { ensureCurrentYear } from "../../src/map/years.ts";
import type { ApplyContext } from "../../src/map/types.ts";

const ctx: ApplyContext = { actor: "user", today: "2026-08-18", id: () => "x" };

describe("months", () => {
  it("writes day text, objectives, and notes independently", () => {
    let s = ensureCurrentYear(emptyState(), ctx.today);
    const day = applyCommand(
      s,
      { type: "setMonthDay", year: 2026, month: 4, day: 29, text: "Birthday" },
      ctx,
    );
    assert.equal(day.ok, true);
    if (!day.ok) return;
    s = day.value;
    const obj = applyCommand(
      s,
      { type: "setMonthObjectives", year: 2026, month: 4, text: "Ship v1" },
      ctx,
    );
    assert.equal(obj.ok, true);
    if (!obj.ok) return;
    const notes = applyCommand(
      obj.value,
      { type: "setMonthNotes", year: 2026, month: 4, text: "Keep it light" },
      ctx,
    );
    assert.equal(notes.ok, true);
    if (!notes.ok) return;
    const m = notes.value.years[0].months[3];
    assert.equal(m.days["29"], "Birthday");
    assert.equal(m.objectives, "Ship v1");
    assert.equal(m.notes, "Keep it light");
  });

  it("rejects day 31 in April", () => {
    const s = ensureCurrentYear(emptyState(), ctx.today);
    const res = applyCommand(
      s,
      { type: "setMonthDay", year: 2026, month: 4, day: 31, text: "nope" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "INVALID_RANGE");
  });
});
