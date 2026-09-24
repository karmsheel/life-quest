import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  archiveDomain,
  createDatabase,
  createVault,
  listRows,
  openVault,
  upsertRow,
  addDatabaseColumn,
  exportDomainBooks,
  restoreDomainBooks,
} from "../src/index.ts";

describe("books-export", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-be-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("export writes books.json", async () => {
    const root = path.join(dir, "write");
    assert.ok((await createVault(root, "Write")).ok);
    const created = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;
    const col = await addDatabaseColumn(root, "health", dbId, {
      name: "Note",
      type: "text",
    });
    assert.ok(col.ok);
    if (!col.ok) return;
    const colId = col.value.columns[0].id;
    const upserted = await upsertRow(root, "health", dbId, {
      cells: { [colId]: "hello" },
    });
    assert.ok(upserted.ok);

    const res = await exportDomainBooks(root, "health");
    assert.ok(res.ok, res.ok ? "" : res.error);
    if (!res.ok) return;
    assert.equal(res.value.domainSlug, "health");
    assert.equal(res.value.schemaVersion, 1);
    assert.equal(res.value.databases.length, 1);
    const db = res.value.databases[0];
    assert.equal(db.id, dbId);
    assert.equal(db.name, "Habits");
    assert.equal(db.rows.length, 1);
    assert.deepEqual(db.rows[0].cells, { [colId]: "hello" });
    assert.equal(db.rows[0].id, upserted.value.id);

    const filePath = path.join(root, "domains/health/data/books.json");
    await fs.access(filePath);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.domainSlug, "health");
  });

  it("restore with confirm rebuilds sqlite", async () => {
    const root = path.join(dir, "rebuild");
    assert.ok((await createVault(root, "Rebuild")).ok);
    const created = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;
    const col = await addDatabaseColumn(root, "health", dbId, {
      name: "Note",
      type: "text",
    });
    assert.ok(col.ok);
    if (!col.ok) return;
    const colId = col.value.columns[0].id;
    const upserted = await upsertRow(root, "health", dbId, {
      cells: { [colId]: "hello" },
    });
    assert.ok(upserted.ok);

    const exported = await exportDomainBooks(root, "health");
    assert.ok(exported.ok);

    // Delete sqlite (and wal/shm)
    const sqlitePath = path.join(root, "domains/health/data/domain.sqlite");
    await fs.rm(sqlitePath, { force: true });
    await fs.rm(`${sqlitePath}-wal`, { force: true });
    await fs.rm(`${sqlitePath}-shm`, { force: true });

    const restored = await restoreDomainBooks(root, "health", { confirm: true });
    assert.ok(restored.ok, restored.ok ? "" : restored.error);
    if (!restored.ok) return;
    assert.equal(restored.value.databases, 1);
    assert.equal(restored.value.rows, 1);

    const after = await listRows(root, "health", dbId);
    assert.ok(after.ok);
    if (!after.ok) return;
    assert.equal(after.value.length, 1);
    assert.equal(after.value[0].id, upserted.value.id);
    assert.deepEqual(after.value[0].cells, { [colId]: "hello" });
  });

  it("restore without confirm does not overwrite", async () => {
    const root = path.join(dir, "noconfirm");
    assert.ok((await createVault(root, "NoConfirm")).ok);
    const created = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;
    const col = await addDatabaseColumn(root, "health", dbId, {
      name: "Note",
      type: "text",
    });
    assert.ok(col.ok);
    if (!col.ok) return;
    const colId = col.value.columns[0].id;
    await upsertRow(root, "health", dbId, { cells: { [colId]: "first" } });

    const exported = await exportDomainBooks(root, "health");
    assert.ok(exported.ok);

    // Add a second row after export
    const second = await upsertRow(root, "health", dbId, {
      cells: { [colId]: "second" },
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    const secondId = second.value.id;

    // Attempt restore without confirm
    const res = await restoreDomainBooks(root, "health", { confirm: false });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /confirmation/i);

    // Second row still present
    const after = await listRows(root, "health", dbId);
    assert.ok(after.ok);
    if (!after.ok) return;
    const ids = after.value.map((r) => r.id);
    assert.ok(ids.includes(secondId));
    const secondAfter = after.value.find((r) => r.id === secondId);
    assert.equal(secondAfter?.cells[colId], "second");
  });

  it("restore with confirm replaces live book", async () => {
    const root = path.join(dir, "replace");
    assert.ok((await createVault(root, "Replace")).ok);
    const created = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;
    const col = await addDatabaseColumn(root, "health", dbId, {
      name: "Note",
      type: "text",
    });
    assert.ok(col.ok);
    if (!col.ok) return;
    const colId = col.value.columns[0].id;
    await upsertRow(root, "health", dbId, { cells: { [colId]: "kept" } });

    const exported = await exportDomainBooks(root, "health");
    assert.ok(exported.ok);

    // Add second row
    const second = await upsertRow(root, "health", dbId, {
      cells: { [colId]: "gone-after-restore" },
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    const secondId = second.value.id;

    // Restore with confirm
    const restored = await restoreDomainBooks(root, "health", { confirm: true });
    assert.ok(restored.ok);

    // Second row gone, only exported rows remain
    const after = await listRows(root, "health", dbId);
    assert.ok(after.ok);
    if (!after.ok) return;
    assert.equal(after.value.length, 1);
    assert.equal(after.value[0].cells[colId], "kept");
    assert.ok(!after.value.some((r) => r.id === secondId));
  });

  it("path escape", async () => {
    const root = path.join(dir, "escape");
    assert.ok((await createVault(root, "Esc")).ok);

    const badExport = await exportDomainBooks(root, "../evil");
    assert.equal(badExport.ok, false);
    if (badExport.ok) return;

    const badRestore = await restoreDomainBooks(root, "../evil", {
      confirm: true,
    });
    assert.equal(badRestore.ok, false);
    if (badRestore.ok) return;

    // No files written outside vault
    const parent = path.dirname(root);
    const evilPath = path.join(parent, "evil", "data", "books.json");
    await assert.rejects(() => fs.access(evilPath));
  });

  it("archived / missing domain", async () => {
    const root = path.join(dir, "archive");
    assert.ok((await createVault(root, "Arc")).ok);

    // Missing domain
    const missing = await exportDomainBooks(root, "ghost");
    assert.equal(missing.ok, false);
    const missRestore = await restoreDomainBooks(root, "ghost", {
      confirm: true,
    });
    assert.equal(missRestore.ok, false);

    // Actually archive
    const archived = await archiveDomain(root, "health");
    assert.ok(archived.ok);
    const afterArchive = await exportDomainBooks(root, "health");
    assert.equal(afterArchive.ok, false);
    const afterRestore = await restoreDomainBooks(root, "health", {
      confirm: true,
    });
    assert.equal(afterRestore.ok, false);

    // openVault still works
    const o = await openVault(root);
    assert.ok(o.ok);
  });

  it("missing books.json", async () => {
    const root = path.join(dir, "missing");
    assert.ok((await createVault(root, "Missing")).ok);
    const created = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;
    const col = await addDatabaseColumn(root, "health", dbId, {
      name: "Note",
      type: "text",
    });
    assert.ok(col.ok);
    if (!col.ok) return;
    const colId = col.value.columns[0].id;
    await upsertRow(root, "health", dbId, { cells: { [colId]: "data" } });

    // No books.json exists yet
    const res = await restoreDomainBooks(root, "health", { confirm: true });
    assert.equal(res.ok, false);
    if (res.ok) return;

    // Sqlite still has the row (not destroyed)
    const after = await listRows(root, "health", dbId);
    assert.ok(after.ok);
    if (!after.ok) return;
    assert.equal(after.value.length, 1);

    // No fake sqlite created in a wrong location
    await assert.rejects(() =>
      fs.access(path.join(root, "domains/health/data/books.json")),
    );
  });

  it("gitignore still ignores sqlite but not books.json", async () => {
    const root = path.join(dir, "git");
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    assert.ok((await createVault(root, "Git")).ok);
    const created = await createDatabase(root, "health", { name: "G" });
    assert.ok(created.ok);
    const ignorePath = path.join(root, ".gitignore");
    const ignore = await fs.readFile(ignorePath, "utf8");
    assert.match(ignore, /domains.*?domain\.sqlite/);
    assert.match(ignore, /\.lifequest\/cache\//);
    assert.ok(!ignore.includes("books.json"));

    // After export, books.json still not gitignored
    await exportDomainBooks(root, "health");
    const after = await fs.readFile(ignorePath, "utf8");
    assert.ok(!after.includes("books.json"));
  });

  it("no git hook created by export/restore", async () => {
    const root = path.join(dir, "nohook");
    assert.ok((await createVault(root, "NoHook")).ok);
    const created = await createDatabase(root, "health", { name: "H" });
    assert.ok(created.ok);
    const col = await addDatabaseColumn(root, "health", created.value.id, {
      name: "Note",
      type: "text",
    });
    assert.ok(col.ok);
    await upsertRow(root, "health", created.value.id, { cells: {} });

    await exportDomainBooks(root, "health");
    await restoreDomainBooks(root, "health", { confirm: true });

    // No .git/hooks under the vault
    const hooksDir = path.join(root, ".git", "hooks");
    await assert.rejects(() => fs.access(hooksDir));
  });
});
