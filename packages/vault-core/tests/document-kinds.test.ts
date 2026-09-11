import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DREAM_DOCUMENT_KINDS,
} from "../src/types.ts";

describe("document kinds", () => {
  it("appends premise and exposes Dream display order plus labels", () => {
    assert.deepEqual([...DOCUMENT_KINDS], ["why", "what", "how", "premise"]);
    assert.deepEqual([...DREAM_DOCUMENT_KINDS], [
      "premise",
      "what",
      "why",
      "how",
    ]);
    assert.equal(DOCUMENT_KIND_LABELS.premise, "Beliefs & Premise");
    assert.equal(DOCUMENT_KIND_LABELS.what, "Vision & Desire");
    assert.equal(DOCUMENT_KIND_LABELS.why, "Purpose");
    assert.equal(DOCUMENT_KIND_LABELS.how, "Strategy (How)");
  });
});
