import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

describe("Documents page preview", () => {
  it("renders a note preview and handles data-library-id", () => {
    const src = read("src/pages/DocumentsPage.tsx");
    assert.match(src, /aria-label="Note preview"/);
    assert.match(src, /doctrineMarkdownToHtml/);
    assert.match(src, /createWikiResolver/);
    assert.match(src, /data-library-id/);
    assert.match(src, /openEdit/);
  });

  it("adds no graph, backlink, or Obsidian surface", () => {
    const files = ["src/pages/DocumentsPage.tsx", "src/lib/wiki-links.ts"];
    for (const file of files) {
      const src = read(file).toLowerCase();
      assert.equal(src.includes("backlink"), false, file);
      assert.equal(src.includes("graph"), false, file);
      assert.equal(src.includes("obsidian"), false, file);
    }
  });
});

describe("other markdown surfaces", () => {
  it("leaves MarkdownView calling doctrineMarkdownToHtml with one argument", () => {
    const src = read("src/components/documents/MarkdownView.tsx");
    assert.match(src, /doctrineMarkdownToHtml\(markdown\)/);
    assert.equal(src.includes("createWikiResolver"), false);
  });

  it("does not add wiki handling to Life-Chain surfaces", () => {
    for (const file of [
      "src/pages/ChainPage.tsx",
      "src/components/signal-chain/SignalChainFeed.tsx",
    ]) {
      const src = read(file);
      assert.equal(src.includes("createWikiResolver"), false, file);
      assert.equal(src.includes("data-library-id"), false, file);
    }
  });
});
