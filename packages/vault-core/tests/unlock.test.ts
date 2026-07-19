import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUnlockedRooms, isNonEmptyBody, isRoomUnlocked } from "../src/unlock.ts";

describe("isNonEmptyBody", () => {
  it("rejects empty and whitespace", () => {
    assert.equal(isNonEmptyBody(""), false);
    assert.equal(isNonEmptyBody("  \n\t"), false);
  });
  it("accepts content", () => {
    assert.equal(isNonEmptyBody("growth"), true);
  });
});

describe("getUnlockedRooms", () => {
  it("always unlocks dream when domain exists (caller passes docs list)", () => {
    const rooms = getUnlockedRooms([]);
    assert.ok(rooms.has("dream"));
    assert.equal(rooms.has("chart"), false);
  });
  it("unlocks chart when why has body", () => {
    const rooms = getUnlockedRooms([{ kind: "why", bodyMarkdown: "reason" }]);
    assert.ok(rooms.has("dream"));
    assert.ok(rooms.has("chart"));
    assert.equal(rooms.has("track"), false);
  });
  it("unlocks full chain", () => {
    const rooms = getUnlockedRooms([
      { kind: "why", bodyMarkdown: "w" },
      { kind: "what", bodyMarkdown: "g" },
      { kind: "how", bodyMarkdown: "h" },
    ]);
    assert.deepEqual([...rooms].sort(), ["act", "chart", "dream", "track"]);
  });
  it("empty why body does not unlock chart", () => {
    const rooms = getUnlockedRooms([{ kind: "why", bodyMarkdown: "   " }]);
    assert.equal(isRoomUnlocked("chart", [{ kind: "why", bodyMarkdown: "   " }]), false);
    assert.ok(rooms.has("dream"));
  });
});
