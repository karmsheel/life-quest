import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  domainLens,
  lensSlug,
  overviewLens,
  recordVisible,
  recordVisibleMulti,
} from "../src/domain-lens.ts";

const overview = overviewLens();
const health = domainLens("health");
const financial = domainLens("financial");

describe("lens constructors", () => {
  it("builds overview and domain lenses", () => {
    assert.deepEqual(overview, { kind: "overview" });
    assert.deepEqual(health, { kind: "domain", slug: "health" });
    assert.equal(lensSlug(overview), null);
    assert.equal(lensSlug(health), "health");
  });
});

describe("recordVisible", () => {
  it("overview shows assigned and unassigned", () => {
    assert.equal(recordVisible(overview, "health"), true);
    assert.equal(recordVisible(overview, null), true);
  });

  it("domain tab hides unassigned and other domains", () => {
    assert.equal(recordVisible(health, "health"), true);
    assert.equal(recordVisible(health, null), false);
    assert.equal(recordVisible(health, "financial"), false);
  });
});

describe("recordVisibleMulti", () => {
  it("empty tags are unassigned: overview only", () => {
    assert.equal(recordVisibleMulti(overview, []), true);
    assert.equal(recordVisibleMulti(health, []), false);
  });

  it("multi-tag note is visible in each tagged domain and in overview", () => {
    const tags = ["health", "financial"];
    assert.equal(recordVisibleMulti(overview, tags), true);
    assert.equal(recordVisibleMulti(health, tags), true);
    assert.equal(recordVisibleMulti(financial, tags), true);
    assert.equal(recordVisibleMulti(domainLens("intellectual"), tags), false);
  });
});
