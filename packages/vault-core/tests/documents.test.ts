import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertEditable, canTransitionStatus } from "../src/documents.ts";

describe("canTransitionStatus", () => {
  it("allows draft→refined, refined→forged, draft→forged", () => {
    assert.equal(canTransitionStatus("draft", "refined"), true);
    assert.equal(canTransitionStatus("refined", "forged"), true);
    assert.equal(canTransitionStatus("draft", "forged"), true);
  });
  it("rejects forged→anything and refined→draft", () => {
    assert.equal(canTransitionStatus("forged", "draft"), false);
    assert.equal(canTransitionStatus("forged", "refined"), false);
    assert.equal(canTransitionStatus("refined", "draft"), false);
  });
});

describe("assertEditable", () => {
  it("blocks forged", () => {
    const r = assertEditable("forged");
    assert.equal(r.ok, false);
  });
  it("allows draft and refined", () => {
    assert.equal(assertEditable("draft").ok, true);
    assert.equal(assertEditable("refined").ok, true);
  });
});
