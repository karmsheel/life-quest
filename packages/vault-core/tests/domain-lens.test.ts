import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  domainLens,
  effectiveDomainSlug,
  filterByLens,
  lensSlug,
  liveDomainSlugs,
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

describe("filterByLens", () => {
  const items = [
    { id: "1", domainSlug: "health" },
    { id: "2", domainSlug: null },
    { id: "3", domainSlug: "gone" },
  ];
  it("overview includes assigned, unassigned, and unknown", () => {
    assert.deepEqual(
      filterByLens(items, overview).map((i) => i.id),
      ["1", "2", "3"],
    );
  });
  it("domain tab hides unassigned and unknown", () => {
    assert.deepEqual(
      filterByLens(items, health).map((i) => i.id),
      ["1"],
    );
  });
});

describe("effectiveDomainSlug", () => {
  it("unknown or archived slug becomes unassigned", () => {
    assert.equal(effectiveDomainSlug("health", ["health"]), "health");
    assert.equal(effectiveDomainSlug("gone", ["health"]), null);
    assert.equal(effectiveDomainSlug(null, ["health"]), null);
  });
});

describe("liveDomainSlugs", () => {
  it("drops archived domains", () => {
    assert.deepEqual(
      liveDomainSlugs([
        { slug: "health", meta: { archivedAt: null } },
        { slug: "old", meta: { archivedAt: "2026-01-01T00:00:00.000Z" } },
      ]),
      ["health"],
    );
  });
});
