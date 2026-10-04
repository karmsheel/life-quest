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
  DATABASE_TOOL_DEFS,
  executeDatabaseTool,
  getDatabase,
  getRow,
  insertRows,
  listDecisions,
  listRows,
  readLog,
  resolveDecision,
  updateSettings,
  type Actor,
} from "../src/index.ts";
import { postedAllowlistResult } from "../src/database-tools.ts";
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

function isOk(r: unknown): r is { decisionId: string; status: string; posted: boolean; rowCount: number; reason?: string } {
  return !!r && typeof r === "object" && !("error" in r);
}

describe("insert_rows tool", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-insert-tool-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function water(): Promise<{ root: string; dbId: string; ml: string }> {
    const root = path.join(dir, `vault-${Math.random().toString(16).slice(2)}`);
    assert.equal((await createVault(root, "Tool")).ok, true);
    const db = await createDatabase(root, "health", { name: "Water" });
    assert.equal(db.ok, true);
    if (!db.ok) throw new Error(db.error);
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) throw new Error(col.error);
    return { root, dbId: db.value.id, ml: col.value.columns.find((c) => c.name === "ml")!.id };
  }

  it("is registered and an unlisted batch files one pending Decision", async () => {
    assert.equal(DATABASE_TOOL_DEFS.some((t) => t.name === "insert_rows"), true);
    const { root, dbId, ml } = await water();
    const before = await listRows(root, "health", dbId);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 1 }, { [ml]: 2 }],
    });
    assert.equal(isOk(res), true);
    if (!isOk(res)) return;
    assert.equal(res.status, "pending");
    assert.equal(res.posted, false);
    assert.equal(res.rowCount, 2);
    const after = await listRows(root, "health", dbId);
    assert.equal(after.ok && before.ok && after.value.length === before.value.length, true);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.filter((d) => d.target.type === "database-batch").length, 1);
    const record = listed.value.find((d) => d.id === res.decisionId)!;
    assert.equal(record.proposedTitle, "Insert 2 rows into Water");
    assert.equal(record.title, "Proposed change to Insert 2 rows into Water");
    assert.equal(record.actor.type, "agent");
  });

  it("an allowlisted batch posts and writes one created and one resolved log line", async () => {
    const { root, dbId, ml } = await water();
    const saved = await updateSettings(root, {
      autoApproveInserts: [{ domainSlug: "health", databaseId: dbId }],
    });
    assert.equal(saved.ok, true);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 4 }, { [ml]: 5 }],
    });
    assert.equal(isOk(res), true);
    if (!isOk(res)) return;
    assert.equal(res.status, "approved");
    assert.equal(res.posted, true);
    assert.equal(res.rowCount, 2);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 2);
    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const created = log.value.filter((e) => e.type === "decision.created" && e.payload && (e.payload as { id?: string }).id === res.decisionId);
    const resolved = log.value.filter((e) => e.type === "decision.resolved" && e.payload && (e.payload as { id?: string }).id === res.decisionId);
    assert.equal(created.length, 1);
    assert.equal(resolved.length, 1);
  });

  it("a bad second row files nothing and names Row 2", async () => {
    const { root, dbId, ml } = await water();
    const before = await listDecisions(root);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 1 }, { [ml]: "nope" }],
    });
    assert.equal(isOk(res), false);
    if (isOk(res)) return;
    assert.match((res as { error: { message: string } }).error.message, /Row 2:/);
    const after = await listDecisions(root);
    assert.equal(after.ok && before.ok && after.value.length === before.value.length, true);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 0);
  });

  it("a repeated external_id inside the batch files nothing and names Row 2", async () => {
    const { root, dbId, ml } = await water();
    const ext = await addDatabaseColumn(root, "health", dbId, { name: "external_id", type: "text" });
    assert.equal(ext.ok, true);
    if (!ext.ok) return;
    const extId = ext.value.columns.find((c) => c.name === "external_id")!.id;
    const before = await listDecisions(root);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [
        { [ml]: 1, [extId]: "same" },
        { [ml]: 2, [extId]: "same" },
      ],
    });
    assert.equal(isOk(res), false);
    if (isOk(res)) return;
    assert.match((res as { error: { message: string } }).error.message, /Row 2:/);
    const after = await listDecisions(root);
    assert.equal(after.ok && before.ok && after.value.length === before.value.length, true);
  });

  it("an allowlisted create posts and an allowlisted update stays pending", async () => {
    const { root, dbId, ml } = await water();
    await updateSettings(root, { autoApproveInserts: [{ domainSlug: "health", databaseId: dbId }] });
    const created = await executeDatabaseTool(root, AGENT, "upsert_row", {
      domainSlug: "health",
      databaseId: dbId,
      cells: { [ml]: 8 },
    });
    assert.equal(isOk(created), true);
    if (!isOk(created)) return;
    assert.equal(created.posted, true);
    assert.equal(created.status, "approved");
    assert.equal(created.rowCount, 1);

    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    const id = rows.value[0]!.id;
    const edited = await executeDatabaseTool(root, AGENT, "upsert_row", {
      domainSlug: "health",
      databaseId: dbId,
      id,
      cells: { [ml]: 9 },
    });
    assert.equal(isOk(edited), true);
    if (!isOk(edited)) return;
    assert.equal(edited.status, "pending");
    assert.equal(edited.posted, false);
    const still = await getRow(root, "health", dbId, id);
    assert.equal(still.ok, true);
    if (!still.ok) return;
    assert.equal(still.value.cells[ml], 8);
  });

  it("a theme patch keeps the allowlist that insert_rows consults", async () => {
    const { root, dbId, ml } = await water();
    await updateSettings(root, { autoApproveInserts: [{ domainSlug: "health", databaseId: dbId }] });
    await updateSettings(root, { theme: "dark" });
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 3 }],
    });
    assert.equal(isOk(res) && res.posted, true);
  });
});

describe("postedAllowlistResult", () => {
  const id = "dec-1";

  it("reports an approved record as posted even when resolve failed", () => {
    const res = postedAllowlistResult(id, 2, "log append failed", { status: "approved" });
    assert.deepEqual(res, { decisionId: id, status: "approved", posted: true, rowCount: 2 });
  });

  it("reports a rejected record with its reason and posted false", () => {
    const res = postedAllowlistResult(id, 2, "resolve failed", {
      status: "rejected",
      reason: "Row id already exists: row-1",
    });
    assert.deepEqual(res, {
      decisionId: id,
      status: "rejected",
      posted: false,
      rowCount: 2,
      reason: "Row id already exists: row-1",
    });
  });

  it("uses the resolve error when a rejected record has no reason", () => {
    const res = postedAllowlistResult(id, 1, "resolve failed", { status: "rejected", reason: null });
    assert.equal(isOk(res), true);
    if (!isOk(res)) return;
    assert.equal(res.status, "rejected");
    assert.equal(res.posted, false);
    assert.equal(res.reason, "resolve failed");
  });

  it("leaves a pending or missing record pending", () => {
    const pending = postedAllowlistResult(id, 2, "disk busy", { status: "pending" });
    const missing = postedAllowlistResult(id, 2, "disk busy", undefined);
    assert.deepEqual(pending, {
      decisionId: id,
      status: "pending",
      posted: false,
      rowCount: 2,
      reason: "disk busy",
    });
    assert.deepEqual(missing, pending);
  });
});
