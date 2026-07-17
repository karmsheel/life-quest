import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLifeEventType, LIFE_EVENT_TYPES } from "../../lib/life-log.ts";

describe("LIFE_EVENT_TYPES", () => {
  it("includes governance and domain events", () => {
    for (const t of [
      "domain.created",
      "document.status_changed",
      "decision.approved",
      "agent.hired",
    ]) {
      assert.ok(LIFE_EVENT_TYPES.includes(t as never));
      assert.equal(isLifeEventType(t), true);
    }
  });
  it("rejects nav noise", () => {
    assert.equal(isLifeEventType("room.switched"), false);
  });
});
