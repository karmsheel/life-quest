import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SEED_DOMAIN_NAMES, HOW_PLACEHOLDER } from "../../lib/constants.ts";
import { DOCUMENT_KINDS } from "../../lib/document-kinds.ts";

describe("seed catalog", () => {
  it("has four starter domains", () => {
    assert.equal(SEED_DOMAIN_NAMES.length, 4);
    assert.ok(SEED_DOMAIN_NAMES.includes("Health"));
  });
  it("has three document kinds", () => {
    assert.deepEqual([...DOCUMENT_KINDS], ["why", "what", "how"]);
  });
  it("how placeholder is non-empty markdown but is NOT used for unlock-on-create", () => {
    assert.ok(HOW_PLACEHOLDER.includes("Strategy"));
  });
});
