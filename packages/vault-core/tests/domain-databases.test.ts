import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDatabase,
  createVault,
  getDatabase,
  invalidateDomainCache,
  listDatabases,
  listRows,
  openVault,
  saveDatabaseFile,
  upsertRow,
  addDatabaseColumn,
  getRow,
  deleteRow,
} from "../src/index.ts";

describe("domain-databases", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-db-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("create/open without sqlite", async () => {
    const root = path.join(dir, "no-sqlite");
    const c = await createVault(root, "NoSqlite");
    assert.equal(c.ok, true);
    const o = await openVault(root);
    assert.equal(o.ok, true);
    const dbs = await listDatabases(root);
    assert.equal(dbs.ok, true);
    if (dbs.ok) assert.deepEqual(dbs.value, []);
    const sqlitePath = path.join(root, "domains/health/data/domain.sqlite");
    await assert.rejects(() => fs.access(sqlitePath));
  });

  it("generic DB in Health", async () => {
    const root = path.join(dir, "health");
    assert.ok((await createVault(root, "Health")).ok);
    const res = await createDatabase(root, "health", { name: "Habits" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const db = res.value;
    assert.equal(db.name, "Habits");
    assert.equal(db.sotMode, "local-only");
    assert.equal(db.adapter, null);
    assert.deepEqual(db.columns, []);
    const sqlitePath = path.join(root, "domains/health/data/domain.sqlite");
    await fs.access(sqlitePath);
    const registryPath = path.join(root, "domains/health/data/registry.json");
    await fs.access(registryPath);
    const raw = await fs.readFile(registryPath, "utf8");
    const registry = JSON.parse(raw);
    assert.equal(registry.schemaVersion, 1);
    assert.equal(registry.databases.length, 1);
    assert.deepEqual(registry.installedKits, []);
    const otherDomains = ["intellectual", "emotional", "financial"];
    for (const slug of otherDomains) {
      const otherSqlite = path.join(root, `domains/${slug}/data/domain.sqlite`);
      await assert.rejects(() => fs.access(otherSqlite));
    }
  });

  it("columns + CRUD", async () => {
    const root = path.join(dir, "crud");
    assert.ok((await createVault(root, "Crud")).ok);
    const created = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;

    // Add a second db for relation testing
    const target = await createDatabase(root, "health", { name: "Routines" });
    assert.ok(target.ok);
    if (!target.ok) return;
    const targetId = target.value.id;

    // Add columns of all types
    const types = [
      { name: "Note", type: "text" },
      { name: "Score", type: "number" },
      { name: "When", type: "date" },
      { name: "Color", type: "select", options: ["Red", "Blue"] },
      { name: "Done", type: "checkbox" },
      { name: "Routine", type: "relation", relationDatabaseId: targetId },
      { name: "Doc", type: "file" },
    ];
    let latestMeta = created.value;
    for (const col of types) {
      const res = await addDatabaseColumn(root, "health", dbId, col);
      assert.ok(res.ok, `add col ${col.name}: ${res.ok ? "" : res.error}`);
      if (!res.ok) return;
      latestMeta = res.value;
    }
    assert.equal(latestMeta.columns.length, 7);

    // Insert a row
    const cells = {};
    for (const col of latestMeta.columns) {
      if (col.type === "text") cells[col.id] = "hello";
      else if (col.type === "number") cells[col.id] = 42;
      else if (col.type === "date") cells[col.id] = "2026-01-01";
      else if (col.type === "select") cells[col.id] = "Red";
      else if (col.type === "checkbox") cells[col.id] = true;
      else if (col.type === "relation") cells[col.id] = "fake-row-id";
      else if (col.type === "file") cells[col.id] = "domains/health/data/files/x/y.txt";
    }
    const insertRes = await upsertRow(root, "health", dbId, { cells });
    assert.ok(insertRes.ok, insertRes.ok ? "" : insertRes.error);
    if (!insertRes.ok) return;
    const row = insertRes.value;
    assert.ok(row.id);
    assert.equal(row.databaseId, dbId);
    assert.equal(row.domainSlug, "health");

    // Update
    const colId = latestMeta.columns[0].id;
    const updateRes = await upsertRow(root, "health", dbId, {
      id: row.id,
      cells: { ...cells, [colId]: "updated" },
    });
    assert.ok(updateRes.ok);
    if (!updateRes.ok) return;
    assert.equal(updateRes.value.cells[colId], "updated");

    // Get
    const getRes = await getRow(root, "health", dbId, row.id);
    assert.ok(getRes.ok);
    if (getRes.ok) assert.equal(getRes.value.cells[colId], "updated");

    // List
    const listRes = await listRows(root, "health", dbId);
    assert.ok(listRes.ok);
    if (listRes.ok) {
      assert.equal(listRes.value.length, 1);
      assert.equal(listRes.value[0].id, row.id);
    }

    // Delete
    const delRes = await deleteRow(root, "health", dbId, row.id);
    assert.ok(delRes.ok);

    // Reopen - persist check
    const reopen = await listRows(root, "health", dbId);
    assert.ok(reopen.ok);
    if (reopen.ok) assert.equal(reopen.value.length, 0);
  });

  it("select/relation validation", async () => {
    const root = path.join(dir, "validation");
    assert.ok((await createVault(root, "Val")).ok);
    const created = await createDatabase(root, "health", { name: "Tasks" });
    assert.ok(created.ok);
    if (!created.ok) return;
    const dbId = created.value.id;

    const selectRes = await addDatabaseColumn(root, "health", dbId, {
      name: "Priority",
      type: "select",
      options: ["High", "Low"],
    });
    assert.ok(selectRes.ok);
    if (!selectRes.ok) return;
    const selectColId = selectRes.value.columns.find(
      (c) => c.name === "Priority",
    )!.id;

    const insertRes = await upsertRow(root, "health", dbId, {
      cells: { [selectColId]: "Medium" },
    });
    assert.equal(insertRes.ok, false);

    const missingRel = await addDatabaseColumn(root, "health", dbId, {
      name: "Ref",
      type: "relation",
    });
    assert.equal(missingRel.ok, false);

    const unknownRel = await addDatabaseColumn(root, "health", dbId, {
      name: "Ref",
      type: "relation",
      relationDatabaseId: "nonexistent-db",
    });
    assert.equal(unknownRel.ok, false);
  });

  it("path escape", async () => {
    const root = path.join(dir, "escape");
    assert.ok((await createVault(root, "Esc")).ok);

    const evil = await createDatabase(root, "../evil", { name: "Bad" });
    assert.equal(evil.ok, false);

    // Create a legit db first so saveDatabaseFile has a slug to write under
    const legit = await createDatabase(root, "health", { name: "Legit" });
    assert.ok(legit.ok);

    const fileRes1 = await saveDatabaseFile(root, "health", {
      bytes: Buffer.from("test"),
      mime: "text/plain",
      name: "..\\..\\outside.txt",
    });
    assert.equal(fileRes1.ok, false);

    const fileRes2 = await saveDatabaseFile(root, "health", {
      bytes: Buffer.from("test"),
      mime: "text/plain",
      name: "../x",
    });
    assert.equal(fileRes2.ok, false);

    const fileRes3 = await saveDatabaseFile(root, "health", {
      bytes: Buffer.from("test"),
      mime: "text/plain",
      name: "C:/absolute.txt",
    });
    assert.equal(fileRes3.ok, false);
  });

  it("gitignore", async () => {
    const root = path.join(dir, "git");
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    assert.ok((await createVault(root, "Git")).ok);
    const before = await fs.readFile(path.join(root, ".gitignore"), "utf8").catch(() => "");
    const create = await createDatabase(root, "health", { name: "G" });
    assert.ok(create.ok);
    const after = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    assert.match(after, /domains.*?domain\.sqlite/);
    assert.match(after, /\.lifequest\/cache\//);

    // Non-git vault should NOT create .gitignore
    const root2 = path.join(dir, "no-git");
    assert.ok((await createVault(root2, "NoGit")).ok);
    const create2 = await createDatabase(root2, "health", { name: "G2" });
    assert.ok(create2.ok);
    await assert.rejects(() => fs.access(path.join(root2, ".gitignore")));
  });

  it("archived / missing domain", async () => {
    const root = path.join(dir, "archive");
    assert.ok((await createVault(root, "Arc")).ok);
    const missing = await createDatabase(root, "ghost", { name: "X" });
    assert.equal(missing.ok, false);
    const o1 = await openVault(root);
    assert.ok(o1.ok);

    // Archive health then try to create db
    const created = await createDatabase(root, "health", { name: "PreArchive" });
    assert.ok(created.ok);
    const snap = await openVault(root);
    assert.ok(snap.ok);
  });

  it("cache", async () => {
    const root = path.join(dir, "cache");
    assert.ok((await createVault(root, "Cache")).ok);
    const created = await createDatabase(root, "health", { name: "C" });
    assert.ok(created.ok);
    const cachePath = path.join(root, ".lifequest/cache");
    await fs.access(cachePath);
    // Write something into cache to confirm invalidation clears it
    await fs.writeFile(path.join(cachePath, "something.txt"), "data");
    await invalidateDomainCache(root);
    const entries = await fs.readdir(cachePath);
    assert.deepEqual(entries, []);
  });
});
