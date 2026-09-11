import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import {
  DOCUMENT_MEDIA_MAX_BYTES,
  getDocument,
  readDocumentMedia,
  saveDocument,
  saveDocumentMedia,
  setDocumentStatus,
} from "../src/domain-documents.ts";

describe("domain documents get/save/status", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-docs-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "DocsTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("saveDocument why body x → file contains x", async () => {
    const saved = await saveDocument(root, "health", "why", "x");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.bodyMarkdown, "x\n");
    assert.equal(saved.value.kind, "why");

    const raw = await fs.readFile(path.join(root, "domains", "health", "why.md"), "utf8");
    assert.match(raw, /x/);
    assert.match(raw, /updatedAt:/);

    const got = await getDocument(root, "health", "why");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.bodyMarkdown, "x\n");
  });

  it("setDocumentStatus draft→refined ok", async () => {
    // ensure draft via intellectual what
    const refined = await setDocumentStatus(root, "intellectual", "what", "refined");
    assert.equal(refined.ok, true);
    if (!refined.ok) return;
    assert.equal(refined.value.status, "refined");
    assert.equal(refined.value.forgedAt, null);

    const raw = await fs.readFile(
      path.join(root, "domains", "intellectual", "what.md"),
      "utf8",
    );
    assert.match(raw, /status: refined/);
  });

  it("setDocumentStatus forged → saveDocument fails with editable reason", async () => {
    const forged = await setDocumentStatus(root, "emotional", "how", "forged");
    assert.equal(forged.ok, true);
    if (!forged.ok) return;
    assert.equal(forged.value.status, "forged");
    assert.notEqual(forged.value.forgedAt, null);
    assert.ok(typeof forged.value.forgedAt === "string");

    const raw = await fs.readFile(path.join(root, "domains", "emotional", "how.md"), "utf8");
    assert.match(raw, /status: forged/);
    assert.match(raw, /forgedAt:/);

    const save = await saveDocument(root, "emotional", "how", "should not write");
    assert.equal(save.ok, false);
    if (save.ok) return;
    assert.match(save.error, /read-only|Forged|Decisions/i);
  });

  it("rejects invalid status transitions", async () => {
    // financial why is draft; refined then try back to draft
    const toRefined = await setDocumentStatus(root, "financial", "why", "refined");
    assert.equal(toRefined.ok, true);

    const back = await setDocumentStatus(root, "financial", "why", "draft");
    assert.equal(back.ok, false);
    if (back.ok) return;
    assert.match(back.error, /transition|status/i);

    // forged cannot change further
    const toForged = await setDocumentStatus(root, "financial", "why", "forged");
    assert.equal(toForged.ok, true);
    const again = await setDocumentStatus(root, "financial", "why", "refined");
    assert.equal(again.ok, false);
  });

  it("saveDocument can update title when editable", async () => {
    const saved = await saveDocument(root, "health", "what", "body text", "Custom What");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.title, "Custom What");
    assert.match(saved.value.bodyMarkdown, /body text/);
  });
});

describe("document media", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-docs-media-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "DocsMediaTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("saves png bytes under domains/<slug>/media and reads them back", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const saved = await saveDocumentMedia(root, "health", {
      bytes: png,
      mime: "image/png",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.match(saved.value.relPath, /^media\/[0-9a-f-]+\.png$/i);
    const onDisk = await fs.readFile(
      path.join(root, "domains", "health", ...saved.value.relPath.split("/")),
    );
    assert.deepEqual(new Uint8Array(onDisk), png);

    const read = await readDocumentMedia(root, "health", saved.value.relPath);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.mime, "image/png");
    assert.deepEqual(read.value.bytes, png);
  });

  it("rejects unknown mime, oversize, and traversal relPath", async () => {
    const tiny = new Uint8Array([1, 2, 3]);
    const badMime = await saveDocumentMedia(root, "health", {
      bytes: tiny,
      mime: "application/pdf",
    });
    assert.equal(badMime.ok, false);

    const tooBig = await saveDocumentMedia(root, "health", {
      bytes: new Uint8Array(DOCUMENT_MEDIA_MAX_BYTES + 1),
      mime: "image/png",
    });
    assert.equal(tooBig.ok, false);

    const traversal = await readDocumentMedia(
      root,
      "health",
      "media/../domain.json",
    );
    assert.equal(traversal.ok, false);
    const absolute = await readDocumentMedia(root, "health", "/etc/passwd");
    assert.equal(absolute.ok, false);
  });

  it("saveDocumentMedia on a missing domain fails and does not mkdir", async () => {
    const slug = "no-such-domain";
    const saved = await saveDocumentMedia(root, slug, {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mime: "image/png",
    });
    assert.equal(saved.ok, false);
    if (!saved.ok) {
      assert.match(saved.error, /Domain not found/i);
    }
    const entries = await fs.readdir(path.join(root, "domains"));
    assert.equal(entries.includes(slug), false);
  });
});
