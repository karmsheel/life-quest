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
    assert.match(index, /\/(?:dream|track)\/\$\{slug\}\/how/);
  });
});

describe("doctrine labels on other surfaces", () => {
  it("Home How still goes to Architecture; other kinds to Dream", () => {
    const home = read("src/pages/HomePage.tsx");
    const doctrine = read("src/pages/home-pins/DoctrineCard.tsx");
    assert.match(home, /DoctrineProgressCard/);
    assert.match(doctrine, /DOCUMENT_KIND_LABELS|DREAM_DOCUMENT_KINDS/);
    assert.match(doctrine, /doctrineHref/);
    assert.match(doctrine, /track.*how/);
    assert.match(doctrine, /dream.*kind/);
    const act = read("src/pages/ActPage.tsx");
    assert.match(act, /DOCUMENT_KIND_LABELS/);
    const strip = read("src/components/doctrine/DoctrineStrip.tsx");
    assert.match(strip, /DOCUMENT_KIND_LABELS/);
    assert.equal(strip.includes("North Star"), false);
    const editorPage = read("src/components/doctrine/DoctrineEditorPage.tsx");
    assert.match(editorPage, /DOCUMENT_KIND_LABELS/);
    const tools = read("electron/map-tools.ts");
    assert.match(tools, /premise: domain\.documents\.premise/);
  });
});

describe("document lock IPC", () => {
  it("exposes documentSetLocked and librarySetLocked, not documentSetStatus", () => {
    const service = read("electron/vault-service.ts");
    assert.match(service, /export async function documentSetLocked/);
    assert.match(service, /export async function librarySetLocked/);
    assert.equal(service.includes("documentSetStatus"), false);
    const main = read("electron/main.ts");
    assert.match(main, /document:setLocked/);
    assert.match(main, /library:setLocked/);
    assert.equal(main.includes("document:setStatus"), false);
    const preload = read("electron/preload.ts");
    assert.match(preload, /documentSetLocked/);
    assert.match(preload, /librarySetLocked/);
  });
});

describe("document tools wiring", () => {
  it("registers DOCUMENT_TOOL_DEFS and executeDocumentTool", () => {
    const mapTools = read("electron/map-tools.ts");
    assert.match(mapTools, /DOCUMENT_TOOL_DEFS/);
    assert.match(mapTools, /executeDocumentTool/);
    assert.match(mapTools, /update_document/);
    const mcp = read("electron/mcp-server.ts");
    assert.match(mcp, /DOCUMENT_TOOL_DEFS/);
  });
});

describe("DocumentEditor lock", () => {
  it("uses lock toggle and Propose, not Refine/Forge", () => {
    const src = read("src/components/documents/DocumentEditor.tsx");
    assert.match(src, /documentSetLocked/);
    assert.match(src, /Unlock to edit, or propose a change/);
    assert.match(src, /Propose change/);
    assert.equal(src.includes("Mark refined"), false);
    assert.equal(src.includes(">Forge<") || src.includes("Forge\n"), false);
    assert.equal(src.includes("canForge"), false);
    assert.equal(src.includes("documentSetStatus"), false);
  });
});