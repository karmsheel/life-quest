import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doctrineMarkdownToHtml } from "../src/lib/doctrine-markdown.ts";
import { createWikiResolver } from "../src/lib/wiki-links.ts";

const DOMAINS = [
  {
    slug: "health",
    meta: {
      name: "Health",
      description: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    documents: {} as never,
  },
];

const resolver = (notes: { id: string; title: string }[] = []) =>
  createWikiResolver({ domains: DOMAINS, notes });

describe("wiki links in library notes", () => {
  it("links a doctrine target by slug and kind", () => {
    const html = doctrineMarkdownToHtml(
      "See [[health/premise]] today.",
      resolver(),
    );
    assert.match(html, /<a [^>]*href="#\/dream\/health\/premise"/);
    assert.match(html, /health\/premise<\/a>/);
  });

  it("sends how to the track room", () => {
    const html = doctrineMarkdownToHtml("[[health/how]]", resolver());
    assert.match(html, /href="#\/track\/health\/how"/);
  });

  it("accepts the domain display name and the doctrine label", () => {
    const html = doctrineMarkdownToHtml(
      "[[Health/Beliefs & Premise]]",
      resolver(),
    );
    assert.match(html, /href="#\/dream\/health\/premise"/);
    assert.match(html, />Health\/Beliefs &amp; Premise<\/a>/);
  });

  it("links one note of the same title in the loaded library", () => {
    const html = doctrineMarkdownToHtml(
      "Read [[Ship the studio]] first.",
      resolver([{ id: "note-1", title: "Ship the studio" }]),
    );
    assert.match(html, /data-library-id="note-1"/);
    assert.match(html, /href="#\/documents"/);
    assert.match(html, />Ship the studio<\/a>/);
  });

  it("leaves ambiguous and missing targets as literal brackets", () => {
    const duplicate = doctrineMarkdownToHtml(
      "[[Ship the studio]]",
      resolver([
        { id: "note-1", title: "Ship the studio" },
        { id: "note-2", title: "ship the studio " },
      ]),
    );
    assert.equal(duplicate.includes("<a "), false);
    assert.match(duplicate, /\[\[Ship the studio\]\]/);

    const missing = doctrineMarkdownToHtml("[[Missing]]", resolver());
    assert.equal(missing.includes("<a "), false);
    assert.match(missing, /\[\[Missing\]\]/);
  });

  it("leaves an archived domain alone", () => {
    const archived = [
      {
        ...DOMAINS[0]!,
        meta: { ...DOMAINS[0]!.meta, archivedAt: "2026-02-01T00:00:00.000Z" },
      },
    ];
    const html = doctrineMarkdownToHtml(
      "[[health/premise]]",
      createWikiResolver({ domains: archived, notes: [] }),
    );
    assert.equal(html.includes("<a "), false);
    assert.match(html, /\[\[health\/premise\]\]/);
  });

  it("keeps a wiki token inside a fenced code block as text", () => {
    const html = doctrineMarkdownToHtml(
      "```\n[[health/premise]]\n```",
      resolver(),
    );
    assert.equal(html.includes("<a "), false);
    assert.match(html, /\[\[health\/premise\]\]/);
  });

  it("does not link anything when no resolver is supplied", () => {
    const html = doctrineMarkdownToHtml("See [[health/premise]]");
    assert.equal(html.includes("<a "), false);
    assert.match(html, /\[\[health\/premise\]\]/);
  });

  it("cannot inject HTML through a wiki target", () => {
    const html = doctrineMarkdownToHtml(
      "[[<script>]] and [[Ship the studio]]",
      resolver([{ id: "note-1", title: "Ship the studio" }]),
    );
    assert.equal(html.includes("<script"), false);
    assert.match(html, /\[\[&lt;script&gt;\]\]/);
  });

  it("does not link aliases, embeds, or heading anchors", () => {
    for (const target of [
      "[[health/premise|my belief]]",
      "![[health/premise]]",
      "[[health/premise#a-heading]]",
    ]) {
      const html = doctrineMarkdownToHtml(target, resolver());
      assert.equal(html.includes("<a "), false, target);
    }
  });

  it("keeps ordinary markdown rendering intact alongside wiki links", () => {
    const html = doctrineMarkdownToHtml(
      "**Bold** and [docs](https://example.com/a) and [[health/why]]",
      resolver(),
    );
    assert.match(html, /<strong>Bold<\/strong>/);
    assert.match(html, /href="https:\/\/example\.com\/a"/);
    assert.match(html, /href="#\/dream\/health\/why"/);
  });
});
