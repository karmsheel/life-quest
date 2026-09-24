import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addDatabaseColumn,
  archiveDomain,
  createDatabase,
  createVault,
  getDatabase,
  getFinanceKitSettings,
  installFinanceKit,
  listDecisions,
  listRows,
  resolveDecision,
  type AdapterKind,
  type AdapterSecretStore,
  type AdapterTransport,
  type RemotePull,
} from "../src/index.ts";
import {
  linkDatabaseAdapter,
  syncDatabase,
  syncLinkedDatabases,
  listSyncConflicts,
  resolveSyncConflict,
  unlinkDatabaseAdapter,
} from "../src/index.ts";

class MemorySecretStore implements AdapterSecretStore {
  private store = new Map<string, string>();
  async put(bindingId: string, secret: string): Promise<void> {
    this.store.set(bindingId, secret);
  }
  async get(bindingId: string): Promise<string | null> {
    return this.store.get(bindingId) ?? null;
  }
  async delete(bindingId: string): Promise<void> {
    this.store.delete(bindingId);
  }
}

class FakeTransport implements AdapterTransport {
  calls: Array<{ method: string; input: unknown }> = [];
  pulls: RemotePull[] = [];
  pushResults: Array<Result<true>> = [];
  deleteResults: Array<Result<true>> = [];
  pushCalls: Array<{ externalId: string; cells: Record<string, string> }> = [];

  async pull(input: { kind: AdapterKind; bindingId: string; secret: string }): Promise<Result<RemotePull>> {
    this.calls.push({ method: "pull", input });
    const next = this.pulls.shift();
    if (!next) return { ok: false, error: "No more pulls queued" };
    return { ok: true, value: next };
  }

  async pushRow(input: { kind: AdapterKind; bindingId: string; secret: string; externalId: string; cells: Record<string, string> }): Promise<Result<true>> {
    this.calls.push({ method: "pushRow", input });
    this.pushCalls.push({ externalId: input.externalId, cells: input.cells });
    const next = this.pushResults.shift() ?? { ok: true, value: true };
    return next;
  }

  async deleteRow(input: { kind: AdapterKind; bindingId: string; secret: string; externalId: string }): Promise<Result<true>> {
    this.calls.push({ method: "deleteRow", input });
    const next = this.deleteResults.shift() ?? { ok: true, value: true };
    return next;
  }
}

async function setupVault(dir: string, name = "vault") {
  const root = path.join(dir, name);
  const c = await createVault(root, name);
  assert.equal(c.ok, true, `createVault: ${c.ok ? "" : c.error}`);
  return root;
}

async function makeColumns(root: string, dbId: string, names: string[], types: string[] = []) {
  let meta: any = null;
  for (let i = 0; i < names.length; i++) {
    const res = await addDatabaseColumn(root, "health", dbId, {
      name: names[i],
      type: (types[i] || "text") as any,
    });
    assert.ok(res.ok, `add col ${names[i]}: ${res.ok ? "" : res.error}`);
    meta = res.value;
  }
  return meta;
}

function colId(meta: any, name: string): string {
  const col = meta.columns.find((c: any) => c.name === name);
  if (!col) throw new Error(`Column not found: ${name}`);
  return col.id;
}

async function approveMapping(root: string): Promise<void> {
  const decisions = await listDecisions(root);
  assert.ok(decisions.ok);
  const mappingDec = decisions.value.find((d) => d.target.type === "mapping");
  if (mappingDec) {
    const appr = await resolveDecision(root, mappingDec.id, "approved");
    assert.ok(appr.ok);
  }
}

describe("adapters (KAR-59)", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-adapter-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("Link stores no secret", async () => {
    const root = await setupVault(dir, "link-secret");
    const db = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const secrets = new MemorySecretStore();
    const token = "ya29.a0AfH6SMBx-token-string";

    const res = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "spreadsheet-123",
      secret: token,
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });

    assert.ok(res.ok, `linkDatabaseAdapter: ${res.ok ? "" : res.error}`);
    if (!res.ok) return;

    const meta = await getDatabase(root, "health", db.value.id);
    assert.ok(meta.ok);
    if (!meta.ok) return;

    assert.equal(meta.value.adapter?.kind, "google-sheet");
    assert.equal(meta.value.adapter?.bindingId, "spreadsheet-123");
    assert.equal(meta.value.sotMode, "linked-canonical");
    assert.equal((meta.value.adapter as any)?.mappingId, null);
    assert.equal((meta.value.adapter as any)?.lastSyncedAt, null);

    const registryPath = path.join(root, "domains/health/data/registry.json");
    const registryRaw = await fs.readFile(registryPath, "utf8");
    assert.ok(!registryRaw.includes(token), "registry must not contain token");

    const stored = await secrets.get("spreadsheet-123");
    assert.equal(stored, token);
  });

  it("One remote per database", async () => {
    const root = await setupVault(dir, "one-remote");
    const db = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const secrets = new MemorySecretStore();

    // First link: google-sheet
    const res1 = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "sheet-token-1",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(res1.ok);

    // Second link: notion — replaces
    const res2 = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "notion",
      bindingId: "notion-db-1",
      secret: "notion-token-1",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(res2.ok);

    const meta = await getDatabase(root, "health", db.value.id);
    assert.ok(meta.ok);
    if (!meta.ok) return;

    assert.equal(meta.value.adapter?.kind, "notion");
    assert.equal(meta.value.adapter?.bindingId, "notion-db-1");

    // Old secret deleted
    const oldSecret = await secrets.get("sheet-1");
    assert.equal(oldSecret, null);

    // New secret present
    const newSecret = await secrets.get("notion-db-1");
    assert.equal(newSecret, "notion-token-1");
  });

  it("URL binding id is not the URL", async () => {
    const root = await setupVault(dir, "url-binding");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const secrets = new MemorySecretStore();
    const url = "https://example.test/feed?token=sekrit";

    const res = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "url",
      secret: url,
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });

    assert.ok(res.ok);
    if (!res.ok) return;

    const meta = await getDatabase(root, "health", db.value.id);
    assert.ok(meta.ok);
    if (!meta.ok) return;

    // bindingId is a uuid, not the URL
    const bindingId = meta.value.adapter?.bindingId;
    assert.ok(bindingId);
    assert.ok(!bindingId.includes("example.test"));
    assert.ok(!bindingId.includes("sekrit"));

    // Registry file must not contain the URL
    const registryPath = path.join(root, "domains/health/data/registry.json");
    const registryRaw = await fs.readFile(registryPath, "utf8");
    assert.ok(!registryRaw.includes("sekrit"));
    assert.ok(!registryRaw.includes("example.test"));

    // Secret store has the URL keyed by the uuid bindingId
    const stored = await secrets.get(bindingId);
    assert.equal(stored, url);
  });

  it("Agent actor link writes nothing and returns operator-only error", async () => {
    const root = await setupVault(dir, "agent-link");
    const db = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const secrets = new MemorySecretStore();

    const res = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "agent", id: "agent-1", name: "TestAgent" },
    }, { secrets });

    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /operator-only|operator only/i);

    // Registry unchanged
    const meta = await getDatabase(root, "health", db.value.id);
    assert.ok(meta.ok);
    if (!meta.ok) return;
    assert.equal(meta.value.adapter, null);

    // No secret stored
    const stored = await secrets.get("sheet-1");
    assert.equal(stored, null);
  });

  it("Unlink", async () => {
    const root = await setupVault(dir, "unlink");
    const db = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const colMeta = await makeColumns(root, db.value.id, ["name"]);
    const nameColId = colId(colMeta, "name");

    const secrets = new MemorySecretStore();

    // Link
    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Add a row
    const row = await (await import("../src/index.ts")).upsertRow(root, "health", db.value.id, {
      cells: { [nameColId]: "test" },
    });
    assert.ok(row.ok);

    // Unlink
    const unlinkRes = await unlinkDatabaseAdapter(root, "health", db.value.id, { secrets }, { type: "user" });
    assert.ok(unlinkRes.ok);
    if (!unlinkRes.ok) return;

    const unlinkMeta = await getDatabase(root, "health", db.value.id);
    assert.ok(unlinkMeta.ok);
    if (!unlinkMeta.ok) return;

    assert.equal(unlinkMeta.value.adapter, null);
    assert.equal(unlinkMeta.value.sotMode, "local-only");

    // Secret deleted
    const stored = await secrets.get("sheet-1");
    assert.equal(stored, null);

    // Row still there
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 1);
  });

  it("Unknown shape files a mapping Decision and does not post", async () => {
    const root = await setupVault(dir, "unknown-shape");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["amount", "date"], ["number", "date"]);

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    // Link
    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Pull with unmapped columns
    transport.pulls.push({
      columns: ["amount", "date", "extra"],
      rows: [{ externalId: "row:1", cells: { amount: "10", date: "2026-09-01", extra: "x" } }],
    });

    const syncRes = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(syncRes.ok);
    if (!syncRes.ok) return;

    assert.equal(syncRes.value.needsMapping, true);
    assert.equal(syncRes.value.pulled, 0);

    // A pending mapping Decision exists
    const decisions = await listDecisions(root);
    assert.ok(decisions.ok);
    if (!decisions.ok) return;

    const mappingDec = decisions.value.find((d) => d.target.type === "mapping");
    assert.ok(mappingDec, "expected a mapping Decision");

    // Approve it
    const appr = await resolveDecision(root, mappingDec!.id, "approved");
    assert.ok(appr.ok);

    // Second sync posts mapped columns only
    transport.pulls.push({
      columns: ["amount", "date", "extra"],
      rows: [{ externalId: "row:1", cells: { amount: "10", date: "2026-09-01", extra: "x" } }],
    });

    const syncRes2 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(syncRes2.ok);
    if (!syncRes2.ok) return;

    assert.equal(syncRes2.value.pulled, 1);

    // Row in sqlite has mapped columns only
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 1);

    const cells = rows.value[0].cells as Record<string, unknown>;
    assert.equal(cells[colId(meta, "amount")], 10);
    assert.equal(cells[colId(meta, "date")], "2026-09-01");
    // "extra" is not mapped, so not in the row
    assert.equal((cells as any).extra, undefined);
  });

  it("Linked-canonical remote-only update applies with no Decision", async () => {
    const root = await setupVault(dir, "remote-only");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Seed a row via upsert
    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 5 },
    });
    assert.ok(seed.ok);

    // First sync: pull initial row
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });

    const sync1 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync1.ok);
    await approveMapping(root);

    const decisionsBefore = await listDecisions(root);
    assert.ok(decisionsBefore.ok);
    const countBefore = decisionsBefore.value.length;

    // Change only remote amount
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "20" } }],
    });

    const sync2 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync2.ok);

    // Sqlite has the new amount
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 1);
    assert.equal(rows.value[0].cells[amountColId], 20);

    // No new Decision
    const decisionsAfter = await listDecisions(root);
    assert.ok(decisionsAfter.ok);
    assert.equal(decisionsAfter.value.length, countBefore);
  });

  it("Linked-canonical local edit write-through pushes", async () => {
    const root = await setupVault(dir, "write-through");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 5 },
    });
    assert.ok(seed.ok);

    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });

    await upsertRow(root, "health", db.value.id, {
      id: seed.ok ? seed.value.id : undefined,
      cells: { [eidColId]: "row:1", [amountColId]: 8 },
    });
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    const syncRes = await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    assert.ok(syncRes.ok);
    assert.equal(transport.pushCalls.length, 1);
  });

  it("Mirror remote-only update is a conflict defaulting to keep local", async () => {
    const root = await setupVault(dir, "mirror-conflict");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "local-canonical-mirror",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Seed local row
    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 10 },
    });
    assert.ok(seed.ok);

    // First sync: establish baseline
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
    });

    const sync1 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync1.ok);
    await approveMapping(root);

    // Remote-only change. Local amount stays 10.
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "99" } }],
    });

    const sync2 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync2.ok);
    if (!sync2.ok) return;

    // Sqlite keeps local amount
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 1);
    assert.equal(rows.value[0].cells[amountColId], 10);

    // Conflict listed
    const conflicts = await listSyncConflicts(root, "health");
    assert.ok(conflicts.ok);
    if (!conflicts.ok) return;
    assert.equal(conflicts.value.length, 1);
    assert.equal(conflicts.value[0].defaultChoice, "keep-local");
    assert.ok(conflicts.value[0].fields.includes(amountColId));
  });

  it("Both sides changed amount → conflict, no merge (linked-canonical)", async () => {
    const root = await setupVault(dir, "both-changed");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Seed row with amount 5
    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 5 },
    });
    assert.ok(seed.ok);

    // First sync: baseline amount 5
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });

    const sync1 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync1.ok);
    await approveMapping(root);

    // Local edit: amount 10
    const localEdit = await upsertRow(root, "health", db.value.id, {
      id: seed.ok ? seed.value.id : undefined,
      cells: { [eidColId]: "row:1", [amountColId]: 10 },
    });
    assert.ok(localEdit.ok);

    // Remote edit: amount 99
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "99" } }],
    });

    const sync2 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync2.ok);

    // Sqlite still 10 (no merge)
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value[0].cells[amountColId], 10);

    // Conflict
    const conflicts = await listSyncConflicts(root, "health");
    assert.ok(conflicts.ok);
    if (!conflicts.ok) return;
    assert.equal(conflicts.value.length, 1);
    assert.equal(conflicts.value[0].defaultChoice, "keep-remote");
    assert.ok(conflicts.value[0].fields.includes(amountColId));
  });

  it("Resolve keep-remote / keep-local / skip", async () => {
    const root = await setupVault(dir, "resolve-conflict");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Seed row amount 5, sync baseline
    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 5 },
    });
    assert.ok(seed.ok);

    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);

    // Local 10, remote 99
    await upsertRow(root, "health", db.value.id, {
      id: seed.ok ? seed.value.id : undefined,
      cells: { [eidColId]: "row:1", [amountColId]: 10 },
    });

    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "99" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });

    // Get conflict
    const conflicts = await listSyncConflicts(root, "health");
    assert.ok(conflicts.ok);
    if (!conflicts.ok) return;
    assert.equal(conflicts.value.length, 1);
    const conflictId = conflicts.value[0].id;

    // keep-remote: write remote cells into sqlite
    const res1 = await resolveSyncConflict(root, "health", conflictId, "keep-remote", {
      secrets,
      transport,
      online: true,
    });
    assert.ok(res1.ok);
    if (!res1.ok) return;

    let rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value[0].cells[amountColId], 99);

    // skip: drop the conflict, sqlite unchanged
    // Re-create conflict by changing both local and remote
    await upsertRow(root, "health", db.value.id, {
      id: seed.ok ? seed.value.id : undefined,
      cells: { [eidColId]: "row:1", [amountColId]: 50 },
    });
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "100" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });

    const conflicts2 = await listSyncConflicts(root, "health");
    assert.ok(conflicts2.ok);
    if (!conflicts2.ok) return;
    assert.equal(conflicts2.value.length, 1);

    const res2 = await resolveSyncConflict(root, "health", conflicts2.value[0].id, "skip", {
      secrets,
      transport,
      online: true,
    });
    assert.ok(res2.ok);

    // sqlite unchanged (still 50)
    rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value[0].cells[amountColId], 50);
  });

  it("Offline queue", async () => {
    const root = await setupVault(dir, "offline-queue");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Seed and baseline sync
    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 5 },
    });
    assert.ok(seed.ok);

    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);

    // Second sync (baseline after mapping approval)
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });

    // Local edit
    await upsertRow(root, "health", db.value.id, {
      id: seed.ok ? seed.value.id : undefined,
      cells: { [eidColId]: "row:1", [amountColId]: 42 },
    });

    // Offline sync
    const syncRes = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: false,
    });
    assert.ok(syncRes.ok);
    if (!syncRes.ok) return;

    assert.equal(syncRes.value.offline, true);
    assert.ok(syncRes.value.queued >= 1);

    // Row still local
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value[0].cells[amountColId], 42);

    // No push calls
    assert.equal(transport.pushCalls.length, 0);

    // Online sync flushes queue
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "42" } }],
    });
    const sync2 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync2.ok);

    // pushRow called once
    assert.equal(transport.pushCalls.length, 1);
  });

  it("Offline then conflicting remote", async () => {
    const root = await setupVault(dir, "offline-conflict");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    const meta = await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);
    const eidColId = colId(meta, "external_id");
    const amountColId = colId(meta, "amount");

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // Seed and baseline
    const { upsertRow } = await import("../src/index.ts");
    const seed = await upsertRow(root, "health", db.value.id, {
      cells: { [eidColId]: "row:1", [amountColId]: 5 },
    });
    assert.ok(seed.ok);

    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "5" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);

    // Local edit
    await upsertRow(root, "health", db.value.id, {
      id: seed.ok ? seed.value.id : undefined,
      cells: { [eidColId]: "row:1", [amountColId]: 10 },
    });

    // Offline sync — queues
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: false });

    // Remote also changed
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "99" } }],
    });

    // Online sync — should record conflict, not push
    const sync2 = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(sync2.ok);

    // Conflict recorded
    const conflicts = await listSyncConflicts(root, "health");
    assert.ok(conflicts.ok);
    if (!conflicts.ok) return;
    assert.equal(conflicts.value.length, 1);

    // pushRow NOT called for the conflicting row
    assert.equal(transport.pushCalls.length, 0);
  });

  it("Duplicate external id warns and does not double-insert", async () => {
    const root = await setupVault(dir, "duplicate-eid");
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // First sync to establish mapping
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);

    // Pull with duplicate external ids
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [
        { externalId: "row:1", cells: { external_id: "row:1", amount: "10" } },
        { externalId: "row:1", cells: { external_id: "row:1", amount: "20" } },
      ],
    });

    const syncRes = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(syncRes.ok);
    if (!syncRes.ok) return;

    // Warning
    assert.ok(syncRes.value.warnings.some((w) => w.includes("row:1")));

    // Only one row inserted
    const rows = await listRows(root, "health", db.value.id);
    assert.ok(rows.ok);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 1);
  });

  it("URL FX updates finance kit settings with no Decision", async () => {
    const root = await setupVault(dir, "url-fx");

    // Install finance kit first
    const kitRes = await installFinanceKit(root, { type: "user" });
    assert.ok(kitRes.ok);

    // Create a url-linked database in health
    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "url",
      secret: "https://example.test/feed",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // First sync to establish mapping
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);

    // Pull with fx
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
      fx: { usdZarRate: 18.5, asOf: "2026-09-24" },
    });

    const syncRes = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(syncRes.ok);

    // Finance settings updated
    const settings = await getFinanceKitSettings(root);
    assert.ok(settings.ok);
    if (!settings.ok) return;
    assert.equal(settings.value?.usdZarRate, 18.5);
    assert.equal(settings.value?.usdZarAsOf, "2026-09-24");

    // No new pending Decision (mapping was already approved)
    const decisions = await listDecisions(root);
    assert.ok(decisions.ok);
    const pendingDecisions = decisions.value.filter(d => d.status === "pending");
    assert.equal(pendingDecisions.length, 0);
  });

  it("Missing fx leaves rate null", async () => {
    const root = await setupVault(dir, "no-fx");

    // Install finance kit first
    const kitRes = await installFinanceKit(root, { type: "user" });
    assert.ok(kitRes.ok);

    const db = await createDatabase(root, "health", { name: "Feed" });
    assert.ok(db.ok);
    if (!db.ok) return;

    await makeColumns(root, db.value.id, ["external_id", "amount"], ["text", "number"]);

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "url",
      secret: "https://example.test/feed",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(linkRes.ok);

    // First sync to establish mapping
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
    });
    await syncDatabase(root, "health", db.value.id, { secrets, transport, online: true });
    await approveMapping(root);

    // Pull without fx
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
    });

    const syncRes = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.ok(syncRes.ok);

    // Rate still null
    const settings = await getFinanceKitSettings(root);
    assert.ok(settings.ok);
    if (!settings.ok) return;
    assert.equal(settings.value?.usdZarRate, null);
  });

  it("Path escape fails", async () => {
    const root = await setupVault(dir, "path-escape");
    const secrets = new MemorySecretStore();

    const res = await linkDatabaseAdapter(root, "../evil", "db-id", {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });

    assert.equal(res.ok, false);
  });

  it("Archived domain fails", async () => {
    const root = await setupVault(dir, "archived");
    const db = await createDatabase(root, "health", { name: "Habits" });
    assert.ok(db.ok);
    if (!db.ok) return;

    // Archive the domain
    const arch = await archiveDomain(root, "health");
    assert.ok(arch.ok);

    const secrets = new MemorySecretStore();

    // Link fails
    const linkRes = await linkDatabaseAdapter(root, "health", db.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.equal(linkRes.ok, false);

    // Sync fails
    const transport = new FakeTransport();
    const syncRes = await syncDatabase(root, "health", db.value.id, {
      secrets,
      transport,
      online: true,
    });
    assert.equal(syncRes.ok, false);
  });

  it("syncLinkedDatabases continues on error", async () => {
    const root = await setupVault(dir, "multi-db");

    // Create two databases
    const db1 = await createDatabase(root, "health", { name: "DB1" });
    assert.ok(db1.ok);
    const db2 = await createDatabase(root, "health", { name: "DB2" });
    assert.ok(db2.ok);

    await makeColumns(root, db1.value.id, ["external_id", "amount"], ["text", "number"]);
    await makeColumns(root, db2.value.id, ["external_id", "amount"], ["text", "number"]);

    const secrets = new MemorySecretStore();
    const transport = new FakeTransport();

    // Link both
    const link1 = await linkDatabaseAdapter(root, "health", db1.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-1",
      secret: "token-1",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(link1.ok);

    const link2 = await linkDatabaseAdapter(root, "health", db2.value.id, {
      kind: "google-sheet",
      bindingId: "sheet-2",
      secret: "token-2",
      sotMode: "linked-canonical",
      actor: { type: "user" },
    }, { secrets });
    assert.ok(link2.ok);

    // First pull succeeds, second fails
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [{ externalId: "row:1", cells: { external_id: "row:1", amount: "10" } }],
    });
    transport.pulls.push({
      columns: ["external_id", "amount"],
      rows: [],
    });
    // Make second pull throw
    const origPull = transport.pull.bind(transport);
    transport.pull = async (input: any) => {
      if (input.bindingId === "sheet-2") {
        return { ok: false, error: "Network error" };
      }
      return origPull(input);
    };

    const results = await syncLinkedDatabases(root, "health", {
      secrets,
      transport,
      online: true,
    });

    assert.ok(results.ok);
    if (!results.ok) return;

    assert.equal(results.value.length, 2);

    // First succeeded
    assert.equal(results.value[0].databaseId, db1.value.id);
    assert.equal(results.value[0].error, undefined);

    // Second failed
    assert.equal(results.value[1].databaseId, db2.value.id);
    assert.ok(results.value[1].error !== undefined);
  });
});
