import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeChatbarResidency,
  toggleChatbarResidency,
  normalizeChatbarSide,
  toggleChatbarSide,
  loadChatbarResidency,
  saveChatbarResidency,
  DEFAULT_CHATBAR_RESIDENCY,
  DEFAULT_CHATBAR_SIDE,
} from "../../lib/chatbar/residency.ts";

describe("chatbar residency", () => {
  it("normalizes unknown to default open", () => {
    assert.equal(normalizeChatbarResidency("nope"), DEFAULT_CHATBAR_RESIDENCY);
    assert.equal(normalizeChatbarResidency("collapsed"), "collapsed");
  });
  it("toggles open ↔ collapsed", () => {
    assert.equal(toggleChatbarResidency("open"), "collapsed");
    assert.equal(toggleChatbarResidency("collapsed"), "open");
  });
  it("loads/saves via storage mock", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    assert.equal(loadChatbarResidency(storage), DEFAULT_CHATBAR_RESIDENCY);
    saveChatbarResidency("collapsed", storage);
    assert.equal(loadChatbarResidency(storage), "collapsed");
  });
  it("toggles side", () => {
    assert.equal(toggleChatbarSide("right"), "left");
    assert.equal(normalizeChatbarSide("left"), "left");
    assert.equal(normalizeChatbarSide(null), DEFAULT_CHATBAR_SIDE);
  });
});
