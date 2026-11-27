/**
 * The Documents page is one index of every named markdown file.
 *
 * Notes, Ideal State, projects and doctrine stay in their own files. This
 * tree only decides which of them the open lens and the filter show, and in
 * which group. Daily notes and reviews are dated records and are not here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDocumentTree } from "../src/pages/document-tree.ts";

const notes = [
  { id: "n1", title: "Morning pages", domainSlugs: ["health"] },
  { id: "n2", title: "House rules", domainSlugs: [] },
];
const ideals = [{ id: "i1", title: "A quiet house" }];
const projects = [
  { id: "p1", title: "LifeQuest desktop", domainSlug: "health" },
  { id: "p2", title: "Tax folder", domainSlug: "financial" },
];
const areas = [
  {
    slug: "health",
    name: "Health",
    documents: [
      { kind: "premise" as const, title: "Beliefs & Premise" },
      { kind: "what" as const, title: "Vision & Desire" },
    ],
  },
  {
    slug: "financial",
    name: "Financial",
    documents: [{ kind: "how" as const, title: "Strategy (How)" }],
  },
];

describe("buildDocumentTree", () => {
  it("groups every named document on Overview, and keeps Ideal State", () => {
    const groups = buildDocumentTree({
      lens: { kind: "overview" },
      query: "",
      notes,
      ideals,
      projects,
      areas,
    });
    assert.deepEqual(
      groups.map((group) => group.id),
      ["notes", "ideal", "projects", "doctrine"],
    );
    assert.deepEqual(
      groups[0]!.files.map((file) => file.title),
      ["Morning pages", "House rules"],
    );
    assert.equal(groups[1]!.files[0]!.title, "A quiet house");
    assert.deepEqual(
      groups[2]!.files.map((file) => file.title),
      ["LifeQuest desktop", "Tax folder"],
    );
    assert.deepEqual(
      groups[3]!.areas.map((area) => area.name),
      ["Health", "Financial"],
    );
  });

  it("filters notes, projects and doctrine to the area, and still shows Ideal State", () => {
    const groups = buildDocumentTree({
      lens: { kind: "domain", slug: "health" },
      query: "",
      notes,
      ideals,
      projects,
      areas,
    });
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
    assert.deepEqual(
      byId.notes!.files.map((file) => file.ref),
      [{ kind: "library", id: "n1" }],
    );
    assert.equal(byId.ideal!.files.length, 1);
    assert.deepEqual(
      byId.projects!.files.map((file) => file.title),
      ["LifeQuest desktop"],
    );
    assert.deepEqual(
      byId.doctrine!.areas.map((area) => area.slug),
      ["health"],
    );
  });

  it("matches the filter against titles and drops empty groups", () => {
    const groups = buildDocumentTree({
      lens: { kind: "overview" },
      query: "quiet",
      notes,
      ideals,
      projects,
      areas,
    });
    assert.deepEqual(
      groups.map((group) => group.id),
      ["ideal"],
    );
    assert.equal(groups[0]!.files[0]!.key, "ideal:i1");
  });
});
