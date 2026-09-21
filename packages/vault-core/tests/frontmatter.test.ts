import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter.ts";

describe("frontmatter", () => {
  it("round-trips title locked and body", () => {
    const raw = serializeFrontmatter(
      { title: "Why", locked: false, updatedAt: "2026-01-01T00:00:00.000Z" },
      "Hello\n\nWorld\n",
    );
    const parsed = parseFrontmatter(raw);
    assert.equal(parsed.data.title, "Why");
    assert.equal(parsed.data.locked, false);
    assert.equal(parsed.body, "Hello\n\nWorld\n");
  });

  it("treats missing frontmatter as empty data", () => {
    const parsed = parseFrontmatter("just body\n");
    assert.deepEqual(parsed.data, {});
    assert.equal(parsed.body, "just body\n");
  });

  it("round-trips object values as JSON", () => {
    const raw = serializeFrontmatter(
      { scopes: { overall: { status: "draft", sessionId: null } } },
      "body\n",
    );
    const parsed = parseFrontmatter(raw);
    assert.deepEqual(parsed.data.scopes, { overall: { status: "draft", sessionId: null } });
  });

  it("round-trips array values as JSON", () => {
    const raw = serializeFrontmatter(
      { tags: ["a", "b"] },
      "body\n",
    );
    const parsed = parseFrontmatter(raw);
    assert.deepEqual(parsed.data.tags, ["a", "b"]);
  });
});
