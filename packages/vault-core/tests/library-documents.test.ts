import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { archiveDomain } from "../src/domains.ts";
import { readLog } from "../src/log.ts";
import { vaultPaths } from "../src/paths.ts";
import {
  libraryCreate,
  libraryDelete,
  libraryGet,
  libraryList,
  libraryUpdate,
  setLibraryLocked,
} from "../src/library-documents.ts";

describe("library-documents", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-library-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "LibraryTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing folder lists empty without error", async () => {
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.value, { records: [], skipped: 0 });
  });

  it("create writes markdown unlocked and appends document.created", async () => {
    const logBefore = await readLog(root);
    assert.equal(logBefore.ok, true);
    if (!logBefore.ok) return;

    const created = await libraryCreate(root, {
      title: "  Inbox note  ",
      bodyMarkdown: "hello",
      domainSlugs: [],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.title, "Inbox note");
    assert.equal(created.value.bodyMarkdown, "hello");
    assert.deepEqual(created.value.domainSlugs, []);
    assert.equal(created.value.deletedAt, null);
    assert.equal(created.value.locked, false);

    const filePath = vaultPaths(root).libraryDocumentMd(created.value.id);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /^---\n/);
    assert.match(raw, /title: Inbox note/);
    assert.match(raw, /domains: \[\]/);
    assert.match(raw, /locked: false/);

    const logAfter = await readLog(root);
    assert.equal(logAfter.ok, true);
    if (!logAfter.ok) return;
    assert.equal(logAfter.value.length, logBefore.value.length + 1);
    const evt = logAfter.value[logAfter.value.length - 1];
    assert.equal(evt.type, "document.created");
    assert.equal(evt.actor?.type, "user");
  });

  it("rejects empty title and unknown domain", async () => {
    const empty = await libraryCreate(root, { title: "   " });
    assert.equal(empty.ok, false);
    const unknown = await libraryCreate(root, {
      title: "Nope",
      domainSlugs: ["not-a-domain"],
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /Unknown domain: not-a-domain/);
  });

  it("stores multi-tags, collapses duplicates, and get/update/delete work", async () => {
    const created = await libraryCreate(root, {
      title: "Shared",
      domainSlugs: ["health", "financial", "health"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.deepEqual(created.value.domainSlugs, ["health", "financial"]);

    const got = await libraryGet(root, created.value.id);
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.title, "Shared");

    const updated = await libraryUpdate(root, created.value.id, {
      title: "Shared v2",
      bodyMarkdown: "body",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.title, "Shared v2");
    assert.equal(updated.value.createdAt, created.value.createdAt);

    const deleted = await libraryDelete(root, created.value.id);
    assert.equal(deleted.ok, true);
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.id === created.value.id),
      false,
    );
    const missing = await libraryGet(root, created.value.id);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /Document not found/);
  });

  it("allows an archived domain slug whose directory still exists", async () => {
    const archived = await archiveDomain(root, "emotional");
    assert.equal(archived.ok, true);
    const created = await libraryCreate(root, {
      title: "Old emotional note",
      domainSlugs: ["emotional"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.deepEqual(created.value.domainSlugs, ["emotional"]);
  });

  it("libraryUpdate while locked fails; setLibraryLocked agent rejected", async () => {
    const created = await libraryCreate(root, { title: "Lock me" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const locked = await setLibraryLocked(root, created.value.id, true);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    assert.equal(locked.value.locked, true);

    const update = await libraryUpdate(root, created.value.id, { bodyMarkdown: "nope" });
    assert.equal(update.ok, false);
    if (update.ok) return;
    assert.match(update.error, /locked/i);

    const agentLock = await setLibraryLocked(
      root,
      created.value.id,
      false,
      { type: "agent", id: "a1", name: "Hermes" },
    );
    assert.equal(agentLock.ok, false);

    const del = await libraryDelete(root, created.value.id);
    assert.equal(del.ok, true);
  });

  it("create by agent logs agent actor and starts unlocked", async () => {
    const created = await libraryCreate(
      root,
      { title: "Agent note" },
      { type: "agent", id: "a1", name: "Hermes" },
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.locked, false);
    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const evt = [...log.value].reverse().find((e) => e.type === "document.created");
    assert.equal(evt?.actor?.type, "agent");
    if (evt?.actor?.type === "agent") assert.equal(evt.actor.name, "Hermes");
  });
});
