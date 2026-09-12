import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actorDisplayName,
  assertEditable,
  lockedFromFrontmatter,
} from "../src/documents.ts";
import { USER_ACTOR } from "../src/types.ts";

describe("lockedFromFrontmatter", () => {
  it("prefers explicit locked boolean", () => {
    assert.equal(lockedFromFrontmatter({ locked: true, status: "draft" }), true);
    assert.equal(lockedFromFrontmatter({ locked: false, status: "forged" }), false);
  });
  it("migrates status forged to locked, else unlocked", () => {
    assert.equal(lockedFromFrontmatter({ status: "forged" }), true);
    assert.equal(lockedFromFrontmatter({ status: "draft" }), false);
    assert.equal(lockedFromFrontmatter({ status: "refined" }), false);
    assert.equal(lockedFromFrontmatter({}), false);
  });
});

describe("assertEditable", () => {
  it("blocks locked", () => {
    const r = assertEditable(true);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /locked/i);
  });
  it("allows unlocked", () => {
    assert.equal(assertEditable(false).ok, true);
  });
});

describe("actorDisplayName", () => {
  it("labels user as You and agent by name", () => {
    assert.equal(actorDisplayName(USER_ACTOR), "You");
    assert.equal(
      actorDisplayName({ type: "agent", id: "a1", name: "Hermes" }),
      "Hermes",
    );
  });
});
