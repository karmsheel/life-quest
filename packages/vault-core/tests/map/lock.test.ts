import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import type { ApplyContext } from "../../src/map/types.ts";

const user: ApplyContext = { actor: "user", today: "2026-08-18", id: () => "id-1" };
const agent: ApplyContext = { actor: "agent", today: "2026-08-18", id: () => "id-1" };

describe("lock", () => {
  it("defaults unlocked; user can lock and unlock", () => {
    const locked = applyCommand(emptyState(), { type: "setLock", locked: true }, user);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    assert.equal(locked.value.locked, true);
    const unlocked = applyCommand(locked.value, { type: "setLock", locked: false }, user);
    assert.equal(unlocked.ok, true);
    if (!unlocked.ok) return;
    assert.equal(unlocked.value.locked, false);
  });

  it("agent cannot flip the lock", () => {
    const res = applyCommand(emptyState(), { type: "setLock", locked: true }, agent);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "AGENT_CANNOT_LOCK");
  });

  it("agent writes fail when locked; user writes still work", () => {
    const locked = applyCommand(emptyState(), { type: "setLock", locked: true }, user);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    const agentWrite = applyCommand(
      locked.value,
      { type: "createYear", year: 2027 },
      agent,
    );
    assert.equal(agentWrite.ok, false);
    if (agentWrite.ok) return;
    assert.equal(agentWrite.error.code, "LOCKED");
    const userWrite = applyCommand(
      locked.value,
      { type: "createYear", year: 2027 },
      user,
    );
    assert.equal(userWrite.ok, true);
  });
});
