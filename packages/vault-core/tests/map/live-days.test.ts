import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { liveDayView } from "../../src/map/live-days.ts";
import type { ApplyContext, Result, StoreState } from "../../src/map/types.ts";

let n = 0;
const ctx: ApplyContext = {
  actor: "user",
  today: "2026-09-15",
  id: () => `x${++n}`,
};

function base() {
  n = 0;
  return emptyState();
}

function must(res: Result<StoreState>): StoreState {
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

describe("ensureLiveDay", () => {
  it("copies the weekday default type into leftover and is idempotent", () => {
    let s = base();
    const created = applyCommand(
      s,
      { type: "createDayType", name: "Deep work", color: "blue" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    s = created.value;
    const typed = applyCommand(
      s,
      {
        type: "updateDayType",
        id: "x1",
        items: [{ id: "i1", text: "Write" }],
      },
      ctx,
    );
    assert.equal(typed.ok, true);
    if (!typed.ok) return;
    s = typed.value;
    const week = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 1, dayTypeId: "x1" },
      ctx,
    );
    assert.equal(week.ok, true);
    if (!week.ok) return;
    s = week.value;
    const first = applyCommand(
      s,
      { type: "ensureLiveDay", date: "2026-09-15" },
      ctx,
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    s = first.value;
    const day = s.liveDays["2026-09-15"];
    assert.equal(day.dayTypeId, "x1");
    assert.equal(day.leftover.length, 1);
    assert.equal(day.leftover[0].text, "Write");
    assert.equal(day.leftover[0].source.type, "template");
    if (day.leftover[0].source.type === "template") {
      assert.equal(day.leftover[0].source.dayTypeItemId, "i1");
    }
    assert.deepEqual(day.blocks, []);
    const leftoverId = day.leftover[0].id;
    const second = applyCommand(
      s,
      { type: "ensureLiveDay", date: "2026-09-15" },
      ctx,
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.liveDays["2026-09-15"].leftover[0].id, leftoverId);
  });

  it("seeds empty leftover when the weekday has no type", () => {
    const res = applyCommand(
      base(),
      { type: "ensureLiveDay", date: "2026-09-15" },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const day = res.value.liveDays["2026-09-15"];
    assert.equal(day.dayTypeId, null);
    assert.deepEqual(day.leftover, []);
  });
});

describe("setLiveDayType", () => {
  it("replaces leftover template rows only", () => {
    let s = base();
    s = must(
      applyCommand(s, { type: "createDayType", name: "A", color: "blue" }, ctx),
    );
    s = must(
      applyCommand(s, { type: "createDayType", name: "B", color: "blue" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "updateDayType", id: "x1", items: [{ id: "i1", text: "Old" }] },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        { type: "updateDayType", id: "x2", items: [{ id: "i2", text: "New" }] },
        ctx,
      ),
    );
    s = must(applyCommand(s, { type: "ensureLiveDay", date: "2026-09-15" }, ctx));
    s = must(
      applyCommand(
        s,
        { type: "setLiveDayType", date: "2026-09-15", dayTypeId: "x1" },
        ctx,
      ),
    );
    s = must(
      applyCommand(s, { type: "addLiveAdHoc", date: "2026-09-15", text: "Call" }, ctx),
    );
    const leftoverId = s.liveDays["2026-09-15"].leftover.find(
      (r) => r.source.type === "template",
    )!.id;
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId,
          startMinutes: 540,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        { type: "setLiveDayType", date: "2026-09-15", dayTypeId: "x2" },
        ctx,
      ),
    );
    const day = s.liveDays["2026-09-15"];
    assert.equal(day.dayTypeId, "x2");
    assert.equal(day.blocks.length, 1);
    assert.equal(day.blocks[0].text, "Old");
    assert.equal(day.leftover.some((r) => r.text === "Call"), true);
    assert.equal(day.leftover.some((r) => r.text === "New"), true);
    assert.equal(day.leftover.some((r) => r.text === "Old"), false);
  });
});

describe("place, cascade, unplace", () => {
  it("pushes later overlaps and does not pull forward", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(s, { type: "addLiveAdHoc", date: "2026-09-15", text: "A" }, ctx),
    );
    s = must(
      applyCommand(s, { type: "addLiveAdHoc", date: "2026-09-15", text: "B" }, ctx),
    );
    const [a, b] = s.liveDays["2026-09-15"].leftover;
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId: a.id,
          startMinutes: 540,
          durationMinutes: 60,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId: b.id,
          startMinutes: 600,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        {
          type: "updateLiveBlock",
          date: "2026-09-15",
          blockId: a.id,
          durationMinutes: 90,
        },
        ctx,
      ),
    );
    const pushed = s.liveDays["2026-09-15"].blocks.find((x) => x.id === b.id);
    assert.equal(pushed?.startMinutes, 630);
    s = must(
      applyCommand(
        s,
        {
          type: "updateLiveBlock",
          date: "2026-09-15",
          blockId: a.id,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    const stayed = s.liveDays["2026-09-15"].blocks.find((x) => x.id === b.id);
    assert.equal(stayed?.startMinutes, 630);
  });

  it("unplaces ad-hoc leftover back onto the list", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "addLiveAdHoc", date: "2026-09-15", text: "Stretch" },
        ctx,
      ),
    );
    const leftoverId = s.liveDays["2026-09-15"].leftover[0].id;
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId,
          startMinutes: 540,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        { type: "unplaceLiveBlock", date: "2026-09-15", blockId: leftoverId },
        ctx,
      ),
    );
    assert.equal(s.liveDays["2026-09-15"].blocks.length, 0);
    assert.equal(s.liveDays["2026-09-15"].leftover[0].text, "Stretch");
  });
});

describe("tasks on the live day", () => {
  it("unions today tasks into leftover and completes the Act task from a block", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "createTask", title: "Inbox zero", column: "today" },
        ctx,
      ),
    );
    const taskId = s.tasks[0].id;
    const view = liveDayView(s, "2026-09-15");
    assert.equal(view.leftover.some((r) => r.id === taskId && r.kind === "task"), true);
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          taskId,
          startMinutes: 540,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    assert.equal(
      liveDayView(s, "2026-09-15").leftover.some((r) => r.id === taskId),
      false,
    );
    const blockId = s.liveDays["2026-09-15"].blocks[0].id;
    s = must(
      applyCommand(s, { type: "completeLiveBlock", date: "2026-09-15", blockId }, ctx),
    );
    assert.equal(s.tasks[0].column, "done");
    assert.equal(s.liveDays["2026-09-15"].blocks[0].done, true);
    s = must(
      applyCommand(s, { type: "completeLiveBlock", date: "2026-09-15", blockId }, ctx),
    );
    assert.equal(s.liveDays["2026-09-15"].blocks[0].done, false);
    assert.equal(s.tasks[0].column, "done");
  });

  it("omits non-today tasks from leftover", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "createTask", title: "Later", column: "this-week" },
        ctx,
      ),
    );
    assert.equal(liveDayView(s, "2026-09-15").leftover.length, 0);
  });
});
