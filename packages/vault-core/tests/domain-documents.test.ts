import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import {
  getDocument,
  saveDocument,
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
