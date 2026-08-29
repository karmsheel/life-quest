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
  it("unlocks only dream when no live Why exists", () => {
    const rooms = getUnlockedRooms([]);
    assert.ok(rooms.has("dream"));
    assert.equal(rooms.has("chart"), false);
    assert.equal(rooms.has("track"), false);
    assert.equal(rooms.has("act"), false);
  });

  it("unlocks chart, track, and act when any live Why has a body", () => {
    const rooms = getUnlockedRooms([whyLive("reason")]);
    assert.deepEqual([...rooms].sort(), ["act", "chart", "dream", "track"]);
  });

  it("ignores archived domains with a Why", () => {
    const rooms = getUnlockedRooms([
      {
        archivedAt: "2026-01-01T00:00:00.000Z",
        documents: [{ kind: "why", bodyMarkdown: "old" }],
      },
    ]);
    assert.equal(rooms.has("chart"), false);
  });

  it("does not require What or How to unlock operational rooms", () => {
    const rooms = getUnlockedRooms([whyLive("w")]);
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
  it("uses the domain list, not a single doc array", () => {
    assert.equal(isRoomUnlocked("chart", [whyLive("x")]), true);
    assert.equal(isRoomUnlocked("chart", [whyLive("  ")]), false);
  });
});
