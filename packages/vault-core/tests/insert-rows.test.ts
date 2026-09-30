import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addDatabaseColumn,
  createDatabase,
  createVault,
  getRow,
  insertRows,
  listRows,
} from "../src/index.ts";

describe("insertRows", () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-insert-rows-"));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function waterVault(): Promise<{ root: string; dbId: string; ml: string }> {
    const root = path.join(dir, `vault-${Math.random().toString(16).slice(2)}`);
    assert.equal((await createVault(root, "Insert")).ok, true);
    const db = await createDatabase(root, "health", { name: "Water" });
    assert.equal(db.ok, true);
    if (!db.ok) throw new Error(db.error);
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) throw new Error(col.error);
    const ml = col.value.columns.find((c) => c.name === "ml")!.id;
    return { root, dbId: db.value.id, ml };
  }

  it("rolls back every row when one id already exists", async () => {
    const { root, dbId, ml } = await waterVault();
    const planted = await insertRows(root, "health", dbId, [{ id: "row-b", cells: { [ml]: 1 } }]);
    assert.equal(planted.ok, true);

    const batch = await insertRows(root, "health", dbId, [
      { id: "row-a", cells: { [ml]: 2 } },
      { id: "row-b", cells: { [ml]: 3 } },
      { id: "row-c", cells: { [ml]: 4 } },
    ]);
    assert.equal(batch.ok, false);
    if (batch.ok) return;
    assert.match(batch.error, /Row id already exists: row-b/);

    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.deepEqual(rows.value.map((r) => r.id).sort(), ["row-b"]);
    const survivor = await getRow(root, "health", dbId, "row-b");
    assert.equal(survivor.ok, true);
    if (!survivor.ok) return;
    assert.equal(survivor.value.cells[ml], 1);
    assert.equal((await getRow(root, "health", dbId, "row-a")).ok, false);
    assert.equal((await getRow(root, "health", dbId, "row-c")).ok, false);
  });

  it("inserts every row when none of the ids exist", async () => {
    const { root, dbId, ml } = await waterVault();
    const batch = await insertRows(root, "health", dbId, [
      { id: "row-a", cells: { [ml]: 2 } },
      { id: "row-b", cells: { [ml]: 3 } },
    ]);
    assert.equal(batch.ok, true);
    if (!batch.ok) return;
    assert.deepEqual(batch.value.ids, ["row-a", "row-b"]);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 2);
  });
});
