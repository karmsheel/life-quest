import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { ensureCurrentYear } from "../../src/map/years.ts";
import type { ApplyContext } from "../../src/map/types.ts";

let n = 0;
const user: ApplyContext = {
  actor: "user",
  today: "2026-08-18",
  id: () => `x${++n}`,
};
function base() {
  n = 0;
  return ensureCurrentYear(emptyState(), user.today);
}

describe("tasks and about me", () => {
  it("creates a backlog task and moves it without touching years", () => {
    let s = base();
    const created = applyCommand(
      s,
      { type: "createTask", title: "Draft review", notes: "keep short" },
      user,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    s = created.value;
    assert.equal(s.tasks[0].id, "x1");
    assert.equal(s.tasks[0].title, "Draft review");
    assert.equal(s.tasks[0].notes, "keep short");
    assert.equal(s.tasks[0].column, "backlog");
    assert.deepEqual(s.tasks[0].links, {});
    const yearsBefore = JSON.stringify(s.years);
    const moved = applyCommand(
      s,
      { type: "updateTask", id: "x1", column: "today" },
      user,
    );
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    assert.equal(moved.value.tasks[0].column, "today");
    assert.equal(JSON.stringify(moved.value.years), yearsBefore);
  });

  it("rejects an empty title", () => {
    const res = applyCommand(base(), { type: "createTask", title: "   " }, user);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("keeps a dangling period-goal link when the goal is deleted", () => {
    let s = base();
    const goal = applyCommand(
      s,
      {
        type: "createPeriodGoal",
        year: 2026,
        name: "Airdrop",
        color: "gold",
        start: "2026-04-01",
        end: "2026-04-02",
      },
      user,
    );
    assert.equal(goal.ok, true);
    if (!goal.ok) return;
    s = goal.value;
    const task = applyCommand(
      s,
      {
        type: "createTask",
        title: "Write guide",
        links: { periodGoalId: "x1" },
      },
      user,
    );
    assert.equal(task.ok, true);
    if (!task.ok) return;
    const del = applyCommand(
      task.value,
      { type: "deletePeriodGoal", year: 2026, id: "x1" },
      user,
    );
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.equal(del.value.tasks[0].links.periodGoalId, "x1");
    assert.deepEqual(del.value.years[0].periodGoals, []);
  });
});
