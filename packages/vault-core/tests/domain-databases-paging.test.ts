// KAR-64 — spec Test Plan case 8: listRows pagination.
// Rows come back in created_at, id order; limit/offset page without gaps or
// duplicates; and a limit of 10 on a 1000-row database touches only 10 rows.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  addDatabaseColumn,
  countRows,
  createDatabase,
  createVault,
  listRows,
  upsertRow,
} from "../src/index.ts";

describe("KAR-64 listRows pagination", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-kar64-page-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Paging")).ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rows come back in created_at, id order", async () => {
    const db = await createDatabase(root, "health", { name: "Ordered" });
    assert.equal(db.ok, true);
    if (!db.ok) return;
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) return;
    const n = col.value.columns.find((c) => c.name === "n")!.id;

    // Written out of order, and "same" timestamps force the id tiebreak.
    for (const [id, value] of [["r3", 3], ["r1", 1], ["r2", 2]] as const) {
      const res = await upsertRow(root, "health", db.value.id, { id, cells: { [n]: value } });
      assert.equal(res.ok, true);
    }

    const all = await listRows(root, "health", db.value.id);
    assert.equal(all.ok, true);
    if (!all.ok) return;
    // Written r3, r1, r2 — so created_at ascending gives exactly that back, not id order.
    assert.deepEqual(all.value.map((r) => r.id), ["r3", "r1", "r2"]);
    const stamps = all.value.map((r) => r.createdAt);
    assert.deepEqual(stamps, [...stamps].sort());
  });

  it("ties on created_at break on id, deterministically", async () => {
    const root2 = path.join(dir, "ties");
    assert.equal((await createVault(root2, "Ties")).ok, true);
    const db = await createDatabase(root2, "health", { name: "Ties" });
    assert.equal(db.ok, true);
    if (!db.ok) return;
    const col = await addDatabaseColumn(root2, "health", db.value.id, { name: "n", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) return;
    const n = col.value.columns.find((c) => c.name === "n")!.id;
    assert.equal((await upsertRow(root2, "health", db.value.id, { id: "seed", cells: { [n]: 0 } })).ok, true);

    // Same created_at for three rows, inserted in a deliberately non-alphabetical order.
    const sqlitePath = path.join(root2, "domains", "health", "data", "domain.sqlite");
    const sqlite = new DatabaseSync(sqlitePath);
    const insert = sqlite.prepare(
      "INSERT INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
    );
    const stamp = "2026-01-01T00:00:00.000Z";
    for (const id of ["t-c", "t-a", "t-b"]) {
      insert.run(db.value.id, id, stamp, stamp, JSON.stringify({ n: 1 }));
    }
    sqlite.close();

    const all = await listRows(root2, "health", db.value.id);
    assert.equal(all.ok, true);
    if (!all.ok) return;
    // The tie rows carry a 2026-01-01 stamp, so they sort ahead of `seed` (written
    // "now"); among themselves, created_at ties break on id.
    assert.deepEqual(all.value.map((r) => r.id), ["t-a", "t-b", "t-c", "seed"]);

    // Paging the tie set agrees with the unpaged order.
    const paged = await listRows(root2, "health", db.value.id, { limit: 2, offset: 0 });
    assert.equal(paged.ok, true);
    if (!paged.ok) return;
    assert.deepEqual(paged.value.map((r) => r.id), ["t-a", "t-b"]);
  });

  it("limit and offset page without gaps or duplicates", async () => {
    const pagedRoot = path.join(dir, "paged");
    assert.equal((await createVault(pagedRoot, "Paged")).ok, true);
    const db = await createDatabase(pagedRoot, "health", { name: "Paged" });
    assert.equal(db.ok, true);
    if (!db.ok) return;
    const col = await addDatabaseColumn(pagedRoot, "health", db.value.id, { name: "n", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) return;
    const n = col.value.columns.find((c) => c.name === "n")!.id;

    const TOTAL = 25;
    for (let i = 0; i < TOTAL; i++) {
      const res = await upsertRow(pagedRoot, "health", db.value.id, {
        id: `row-${String(i).padStart(3, "0")}`,
        cells: { [n]: i },
      });
      assert.equal(res.ok, true);
    }

    const full = await listRows(pagedRoot, "health", db.value.id);
    assert.equal(full.ok, true);
    if (!full.ok) return;
    assert.equal(full.value.length, TOTAL);

    const seen: string[] = [];
    for (let offset = 0; offset < TOTAL; offset += 10) {
      const page = await listRows(pagedRoot, "health", db.value.id, { limit: 10, offset });
      assert.equal(page.ok, true);
      if (!page.ok) return;
      assert.ok(page.value.length <= 10);
      seen.push(...page.value.map((r) => r.id));
    }
    // Every row exactly once, and the same set the unpaged read returns.
    assert.equal(new Set(seen).size, TOTAL);
    assert.deepEqual(seen, full.value.map((r) => r.id));
  });

  it("a limit of 10 on a 1000-row database touches only 10 rows", async () => {
    const root3 = path.join(dir, "big");
    assert.equal((await createVault(root3, "Big")).ok, true);
    const db = await createDatabase(root3, "health", { name: "Big" });
    assert.equal(db.ok, true);
    if (!db.ok) return;

    // Seed straight into SQLite: 1000 engine round trips would dominate the run.
    const sqlitePath = path.join(root3, "domains", "health", "data", "domain.sqlite");
    const sqlite = new DatabaseSync(sqlitePath);
    const insert = sqlite.prepare(
      "INSERT INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < 1000; i++) {
      insert.run(
        db.value.id,
        `big-${String(i).padStart(4, "0")}`,
        new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        JSON.stringify({ n: i }),
      );
    }
    sqlite.close();

    const page = await listRows(root3, "health", db.value.id, { limit: 10 });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    assert.equal(page.value.length, 10);

    // Bounded follow-up: count what the database physically holds, and confirm
    // the page is the first 10 of the full ordered set rather than 10 arbitrary rows.
    const check = new DatabaseSync(sqlitePath);
    const total = check
      .prepare("SELECT COUNT(*) AS n FROM rows WHERE database_id = ?")
      .get(db.value.id) as { n: number };
    assert.equal(total.n, 1000);
    check.close();

    const first = await listRows(root3, "health", db.value.id, { limit: 1 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(page.value[0].id, first.value[0].id);
    assert.deepEqual(page.value[0].id, "big-0000");
    assert.equal(page.value[9].id, "big-0009");

    // The count the agent sees tells it this is a slice, not the whole ledger.
    const counted = await countRows(root3, "health", db.value.id);
    assert.equal(counted.ok, true);
    if (!counted.ok) return;
    assert.equal(counted.value, 1000);
  });

  it("the unpaged read is unchanged when opts is omitted", async () => {
    const root4 = path.join(dir, "unpaged");
    assert.equal((await createVault(root4, "Unpaged")).ok, true);
    const db = await createDatabase(root4, "health", { name: "Unpaged" });
    assert.equal(db.ok, true);
    if (!db.ok) return;
    for (let i = 0; i < 5; i++) {
      const res = await upsertRow(root4, "health", db.value.id, { id: `u-${i}`, cells: {} });
      assert.equal(res.ok, true);
    }
    const withOpts = await listRows(root4, "health", db.value.id, { limit: 500, offset: 0 });
    const without = await listRows(root4, "health", db.value.id);
    assert.equal(withOpts.ok, true);
    assert.equal(without.ok, true);
    if (!withOpts.ok || !without.ok) return;
    assert.deepEqual(
      withOpts.value.map((r) => r.id),
      without.value.map((r) => r.id),
    );
  });
});
