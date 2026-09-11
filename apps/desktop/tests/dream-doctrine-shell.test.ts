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

describe("doctrine media IPC", () => {
  it("exposes documentMediaSave and documentMediaRead", () => {
    const service = read("electron/vault-service.ts");
    assert.match(service, /export async function documentMediaSave/);
    assert.match(service, /export async function documentMediaRead/);
    const main = read("electron/main.ts");
    assert.match(main, /document:mediaSave/);
    assert.match(main, /document:mediaRead/);
    const preload = read("electron/preload.ts");
    assert.match(preload, /documentMediaSave/);
    assert.match(preload, /documentMediaRead/);
  });
});

describe("MarkdownView", () => {
  it("loads media via documentMediaRead and uses doctrineMarkdownToHtml", () => {
    const src = read("src/components/documents/MarkdownView.tsx");
    assert.match(src, /doctrineMarkdownToHtml/);
    assert.match(src, /documentMediaRead/);
    assert.match(src, /data-media/);
  });
});

describe("doctrine coaching", () => {
  it("keeps helper text out of vault files and matches the four paragraphs", () => {
    const copy = read("src/lib/doctrine-copy.ts");
    assert.match(copy, /foundational beliefs you hold about this category/);
    assert.match(copy, /ideal state you would like to achieve/);
    assert.match(copy, /compelling reasons behind what you want/);
    assert.match(copy, /RECIPE for the Vision you want to create/);
  });
});

describe("DocumentEditor", () => {
  it("is a split editor with coaching and no How template", () => {
    const src = read("src/components/documents/DocumentEditor.tsx");
    assert.equal(src.includes("HOW_PLACEHOLDER"), false);
    assert.equal(src.includes("# Tactics"), false);
    assert.match(src, /DOCUMENT_KIND_COACHING/);
    assert.match(src, /DOCUMENT_KIND_LABELS/);
    assert.match(src, /doc-editor__split/);
    assert.match(src, /MarkdownView/);
    assert.match(src, /onPaste/);
    assert.match(src, /onDrop/);
    assert.match(src, /documentMediaSave/);
  });
});

describe("Dream cards", () => {
  it("lists four kinds as cards and sends How to /dream/:slug/how", () => {
    const dream = read("src/pages/DreamPage.tsx");
    assert.match(dream, /DREAM_DOCUMENT_KINDS/);
    assert.match(dream, /howHref=["']dream["']/);
    assert.match(dream, /layout=["']cards["']/);
    const arch = read("src/pages/ArchitecturePage.tsx");
    assert.match(arch, /kinds=\{\["how"\]\}/);
    assert.equal(arch.includes('layout="cards"'), false);
    const index = read("src/components/doctrine/DoctrineIndex.tsx");
    assert.match(index, /DOCUMENT_KIND_LABELS/);
    assert.match(index, /DOCUMENT_KIND_COACHING/);
    assert.match(index, /MarkdownView/);
    assert.match(index, /howHref/);
    assert.match(index, /layout/);
    assert.match(index, /\/dream\/\$\{slug\}\/how|\/dream\/\$\{.*\}\/how/);
  });
});
