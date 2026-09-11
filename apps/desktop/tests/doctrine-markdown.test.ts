import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doctrineMarkdownToHtml } from "../src/lib/doctrine-markdown.ts";

describe("doctrineMarkdownToHtml", () => {
  it("renders media images and ignores unsafe image srcs", () => {
    const html = doctrineMarkdownToHtml(
      "Hello **world**\n\n![strength](media/abc.png)\n\n![x](javascript:alert(1))\n\n![y](https://evil.example/x.png)\n\n![z](file:///etc/passwd)",
    );
    assert.match(html, /Hello <strong>world<\/strong>/);
    assert.match(
      html,
      /<img data-media="media\/abc\.png" alt="strength">/,
    );
    assert.equal(html.includes("javascript:"), false);
    assert.equal(html.includes("https://evil.example"), false);
    assert.equal(html.includes("file:"), false);
  });

  it("escapes raw HTML", () => {
    const html = doctrineMarkdownToHtml("<script>alert(1)</script>");
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
  });

  it("opens http(s) links in a new window", () => {
    const html = doctrineMarkdownToHtml(
      "See [docs](https://example.com/a) and [more](http://example.com/b).",
    );
    assert.match(
      html,
      /<a href="https:\/\/example\.com\/a" target="_blank" rel="noopener noreferrer">docs<\/a>/,
    );
    assert.match(
      html,
      /<a href="http:\/\/example\.com\/b" target="_blank" rel="noopener noreferrer">more<\/a>/,
    );
  });
});
