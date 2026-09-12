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
  setDocumentLocked,
} from "../src/domain-documents.ts";

describe("domain documents get/save/lock", () => {
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

  it("setDocumentLocked true → saveDocument fails", async () => {
    const locked = await setDocumentLocked(root, "emotional", "how", true);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    assert.equal(locked.value.locked, true);
    const raw = await fs.readFile(path.join(root, "domains", "emotional", "how.md"), "utf8");
    assert.match(raw, /locked: true/);
    assert.equal(raw.includes("status:"), false);
    assert.equal(raw.includes("forgedAt:"), false);

    const save = await saveDocument(root, "emotional", "how", "should not write");
    assert.equal(save.ok, false);
    if (save.ok) return;
    assert.match(save.error, /locked/i);
  });

  it("setDocumentLocked false allows save again", async () => {
    const unlocked = await setDocumentLocked(root, "emotional", "how", false);
    assert.equal(unlocked.ok, true);
    if (!unlocked.ok) return;
    assert.equal(unlocked.value.locked, false);
    const save = await saveDocument(root, "emotional", "how", "after unlock");
    assert.equal(save.ok, true);
  });

  it("rejects agent lock toggle", async () => {
    const res = await setDocumentLocked(
      root,
      "financial",
      "why",
      true,
      { type: "agent", id: "a1", name: "Hermes" },
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /user/i);
    const doc = await getDocument(root, "financial", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.locked, false);
  });

  it("reads legacy status: forged as locked", async () => {
    const filePath = path.join(root, "domains", "health", "what.md");
    await fs.writeFile(
      filePath,
      "---\ntitle: Vision\nstatus: forged\nforgedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\nlegacy\n",
      "utf8",
    );
    const got = await getDocument(root, "health", "what");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.locked, true);
    assert.equal(got.value.bodyMarkdown.trim(), "legacy");
  });

  it("logs actor on save and lock", async () => {
    const saved = await saveDocument(root, "health", "why", "logged body");
    assert.equal(saved.ok, true);
    const locked = await setDocumentLocked(root, "health", "why", true);
    assert.equal(locked.ok, true);
    const { readLog } = await import("../src/log.ts");
    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const updated = log.value.find((e) => e.type === "document.updated");
    const lockEvt = log.value.find((e) => e.type === "document.lock_changed");
    assert.equal(updated?.actor?.type, "user");
    assert.equal(lockEvt?.actor?.type, "user");
    assert.equal((lockEvt?.payload as { locked?: boolean })?.locked, true);
  });

  it("saveDocument can update title when editable", async () => {
    const saved = await saveDocument(root, "intellectual", "why", "body text", "Custom What");
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
