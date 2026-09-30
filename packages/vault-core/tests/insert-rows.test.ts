import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addDatabaseColumn,
  createDatabase,
  createDecision,
  createVault,
  getDatabase,
  getRow,
  insertRows,
  listDecisions,
  listRows,
  resolveDecision,
  type Actor,
} from "../src/index.ts";
import { archiveDomain } from "../src/domains.ts";

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

const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };

describe("database-batch Decisions", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-batch-decision-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function pendingBatch(): Promise<{ root: string; dbId: string; ml: string; decisionId: string; ids: string[] }> {
    const root = path.join(dir, `vault-${Math.random().toString(16).slice(2)}`);
    assert.equal((await createVault(root, "Batch")).ok, true);
    const db = await createDatabase(root, "health", { name: "Water" });
    assert.equal(db.ok, true);
    if (!db.ok) throw new Error(db.error);
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) throw new Error(col.error);
    const ml = col.value.columns.find((c) => c.name === "ml")!.id;
    const ids = ["batch-a", "batch-b"];
    const body = {
      op: "insert-rows",
      databaseName: "Water",
      rows: ids.map((id, i) => ({ id, cells: { [ml]: i + 1 }, rowLabel: null })),
    };
    const created = await createDecision(root, {
      target: { type: "database-batch", domainSlug: "health", databaseId: db.value.id },
      proposedTitle: "Insert 2 rows into Water",
      proposedBodyMarkdown: JSON.stringify(body),
      actor: AGENT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.error);
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.domainSlugs[0], "health");
    return { root, dbId: db.value.id, ml, decisionId: created.value.id, ids };
  }

  it("approval inserts every minted row", async () => {
    const { root, dbId, ml, decisionId } = await pendingBatch();
    const resolved = await resolveDecision(root, decisionId, "approved");
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.value.status, "approved");
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 2);
    const first = await getRow(root, "health", dbId, "batch-a");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.cells[ml], 1);
  });

  it("a planted minted id rejects the Decision and adds no batch row", async () => {
    const { root, dbId, ml, decisionId } = await pendingBatch();
    const planted = await insertRows(root, "health", dbId, [{ id: "batch-b", cells: { [ml]: 9 } }]);
    assert.equal(planted.ok, true);
    const resolved = await resolveDecision(root, decisionId, "approved");
    assert.equal(resolved.ok, false);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const record = listed.value.find((d) => d.id === decisionId);
    assert.equal(record?.status, "rejected");
    assert.match(record?.reason ?? "", /Row id already exists: batch-b/);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.deepEqual(rows.value.map((r) => r.id), ["batch-b"]);
    assert.equal((await getRow(root, "health", dbId, "batch-a")).ok, false);
  });

  it("an archived domain rejects the Decision and writes nothing", async () => {
    const { root, dbId, decisionId } = await pendingBatch();
    assert.equal((await archiveDomain(root, "health")).ok, true);
    const resolved = await resolveDecision(root, decisionId, "approved");
    assert.equal(resolved.ok, false);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const record = listed.value.find((d) => d.id === decisionId);
    assert.equal(record?.status, "rejected");
    assert.match(record?.reason ?? "", /archived/);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 0);
  });
});
