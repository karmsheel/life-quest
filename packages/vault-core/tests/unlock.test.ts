import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canDispatchAgent,
  getUnlockedRooms,
  isNonEmptyBody,
  isRoomUnlocked,
  type UnlockDomain,
} from "../src/unlock.ts";

const whyLive = (body: string): UnlockDomain => ({
  archivedAt: null,
  documents: [{ kind: "why", bodyMarkdown: body }],
});

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
  it("unlocks every room with no domains", () => {
    assert.deepEqual(
      [...getUnlockedRooms([])].sort(),
      ["act", "chart", "dream", "track"],
    );
  });

  it("unlocks every room even without a live Why", () => {
    const rooms = getUnlockedRooms([whyLive("  ")]);
    assert.deepEqual([...rooms].sort(), ["act", "chart", "dream", "track"]);
  });

  it("unlocks every room when a live Why exists", () => {
    const rooms = getUnlockedRooms([whyLive("reason")]);
    assert.deepEqual([...rooms].sort(), ["act", "chart", "dream", "track"]);
  });

  it("unlocks operational rooms even if the only Why is archived", () => {
    const rooms = getUnlockedRooms([
      {
        archivedAt: "2026-01-01T00:00:00.000Z",
        documents: [{ kind: "why", bodyMarkdown: "old" }],
      },
    ]);
    assert.ok(rooms.has("chart"));
    assert.ok(rooms.has("track"));
    assert.ok(rooms.has("act"));
  });
});

describe("canDispatchAgent", () => {
  it("is false until How has a body", () => {
    assert.equal(canDispatchAgent([{ kind: "how", bodyMarkdown: "" }]), false);
    assert.equal(canDispatchAgent([{ kind: "how", bodyMarkdown: "habit" }]), true);
  });
});

describe("isRoomUnlocked", () => {
  it("is true for every room regardless of Why", () => {
    assert.equal(isRoomUnlocked("chart", [whyLive("x")]), true);
    assert.equal(isRoomUnlocked("chart", [whyLive("  ")]), true);
    assert.equal(isRoomUnlocked("act", []), true);
  });
});
