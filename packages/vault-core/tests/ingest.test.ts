import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  addDatabaseColumn,
  archiveDomain,
  createDatabase,
  createVault,
  listDecisions,
  listRows,
  resolveDecision,
} from "../src/index.ts";
import {
  acceptIngestRows,
  editIngestRow,
  getMapping,
  ingestFile,
  listIngestBatches,
  proposeMapping,
  rejectIngestRows,
  type IngestFileResult,
  type IngestMapping,
} from "../src/index.ts";

function csvBytes(headers: string[], rows: string[][]): Uint8Array {
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(r.join(","));
  return new TextEncoder().encode(lines.join("\n"));
}

function fingerprintOf(columns: string[]): string {
  const normalized = columns
    .map((c) => c.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((c) => c.length > 0);
  const joined = normalized.join("\n");
  const hash = createHash("sha256").update(joined, "utf8").digest("hex");
  return `sha256:${hash}`;
}

async function setupVault(dir: string, name = "vault") {
  const root = path.join(dir, name);
  const c = await createVault(root, "Ingest");
  assert.equal(c.ok, true, `createVault: ${c.ok ? "" : c.error}`);
  return root;
}

async function makeColumns(root: string, dbId: string, names: string[]) {
  let meta: any = null;
  for (const n of names) {
    const res = await addDatabaseColumn(root, "health", dbId, { name: n, type: "text" });
    assert.ok(res.ok, `add col ${n}: ${res.ok ? "" : res.error}`);
    meta = res.value;
  }
  return meta;
}

async function approveMappingDecision(root: string, dbId: string, mappingId: string, columns: string[], sourceColumns: string[], colNames: string[]) {
  const meta = await makeColumns(root, dbId, colNames);
  const fingerprint = fingerprintOf(sourceColumns);
  const proposeRes = await proposeMapping(root, "health", {
    mappingId,
    databaseId: dbId,
    fingerprint,
    sourceKind: "csv",
    columns: sourceColumns.map((src, i) => ({ source: src, columnId: meta.columns[i]!.id })),
    actor: { type: "user" },
  });
  assert.ok(proposeRes.ok, `proposeMapping: ${proposeRes.ok ? "" : proposeRes.error}`);
  const decs = await listDecisions(root);
  assert.ok(decs.ok);
  if (!decs.ok) return meta;
  const dec = decs.value.find((d) => d.target.type === "mapping")!;
  const appr = await resolveDecision(root, dec.id, "approved");
  assert.ok(appr.ok, `approve: ${appr.ok ? "" : appr.error}`);
  return meta;
}

describe("ingest", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-ingest-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("CSV ingest with existing mapping: staged, rows empty", async () => {
    const root = await setupVault(dir, "t1-staged");
    const db = await createDatabase(root, "health", { name: "Food" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;
    const meta = await makeColumns(root, dbId, ["date", "amount", "payee"]);

    const mappingId = "map-1";
    const fingerprint = fingerprintOf(["Date", "Amount", "Payee"]);
    const proposeRes = await proposeMapping(root, "health", {
      mappingId,
      databaseId: dbId,
      fingerprint,
      sourceKind: "csv",
      columns: [
        { source: "Date", columnId: meta.columns[0]!.id },
        { source: "Amount", columnId: meta.columns[1]!.id },
        { source: "Payee", columnId: meta.columns[2]!.id },
      ],
      actor: { type: "user" },
    });
    assert.ok(proposeRes.ok, `proposeMapping: ${proposeRes.ok ? "" : proposeRes.error}`);
    if (!proposeRes.ok) return;
    assert.equal(proposeRes.value.applied, false);
    const decs = await listDecisions(root);
    assert.ok(decs.ok);
    if (!decs.ok) return;
    const dec = decs.value.find((d) => d.target.type === "mapping")!;
    const appr = await resolveDecision(root, dec.id, "approved");
    assert.ok(appr.ok, `approve: ${appr.ok ? "" : appr.error}`);

    const bytes = csvBytes(["Date", "Amount", "Payee"], [["2026-01-01", "85", "Shop"]]);
    const res = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(res.ok, `ingest: ${res.ok ? "" : res.error}`);
    if (!res.ok) return;
    const value = res.value as Extract<IngestFileResult, { kind: "staged" }>;
    assert.equal(value.kind, "staged");
    assert.equal(value.batch.status, "staged");
    assert.equal(value.rows.length, 1);
    assert.equal(value.rows[0]!.status, "proposed");

    const rows = await listRows(root, "health", dbId);
    assert.ok(rows.ok);
    if (rows.ok) assert.equal(rows.value.length, 0);
  });

  it("Accept posts; reject does not; file remains", async () => {
    const root = await setupVault(dir, "t2-accept");
    const db = await createDatabase(root, "health", { name: "Food2" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;

    await approveMappingDecision(root, dbId, "map-2", ["Date", "Amount", "Payee"], ["Date", "Amount", "Payee"], ["date", "amount", "payee"]);

    const bytes = csvBytes(
      ["Date", "Amount", "Payee"],
      [
        ["2026-01-01", "85", "Shop"],
        ["2026-01-02", "42", "Cafe"],
      ],
    );
    const ingest = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(ingest.ok);
    if (!ingest.ok) return;
    const staged = ingest.value as Extract<IngestFileResult, { kind: "staged" }>;
    const batchId = staged.batch.id;
    const [row1, row2] = staged.rows;

    const acc = await acceptIngestRows(root, "health", batchId, [row1!.id]);
    assert.ok(acc.ok, `accept: ${acc.ok ? "" : acc.error}`);
    if (acc.ok) assert.equal(acc.value.accepted, 1);

    const rej = await rejectIngestRows(root, "health", batchId, [row2!.id]);
    assert.ok(rej.ok);
    if (rej.ok) assert.equal(rej.value.rejected, 1);

    const rows = await listRows(root, "health", dbId);
    assert.ok(rows.ok);
    if (rows.ok) assert.equal(rows.value.length, 1);

    const relPath = staged.batch.fileRelPath ?? "";
    if (relPath) {
      const filePath = path.join(root, relPath);
      await fs.access(filePath);
    }
  });

  it("Bulk-accept remaining proposed rows; batch status accepted; log", async () => {
    const root = await setupVault(dir, "t3-bulk");
    const db = await createDatabase(root, "health", { name: "Food3" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;

    await approveMappingDecision(root, dbId, "map-3", ["Date", "Amount", "Payee"], ["Date", "Amount", "Payee"], ["date", "amount", "payee"]);

    const bytes = csvBytes(
      ["Date", "Amount", "Payee"],
      [
        ["2026-01-01", "85", "Shop"],
        ["2026-01-02", "42", "Cafe"],
      ],
    );
    const ingest = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(ingest.ok);
    if (!ingest.ok) return;
    const staged = ingest.value as Extract<IngestFileResult, { kind: "staged" }>;
    const batchId = staged.batch.id;

    const acc = await acceptIngestRows(root, "health", batchId);
    assert.ok(acc.ok, `bulk accept: ${acc.ok ? "" : acc.error}`);
    if (acc.ok) assert.equal(acc.value.accepted, 2);

    const batches = await listIngestBatches(root, "health", dbId);
    assert.ok(batches.ok);
    if (batches.ok) {
      const batch = batches.value.find((b) => b.id === batchId);
      assert.ok(batch);
      assert.equal(batch!.status, "accepted");
    }
  });

  it("No mapping -> Decision, no silent stage", async () => {
    const root = await setupVault(dir, "t4-nomap");
    const db = await createDatabase(root, "health", { name: "Food4" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;
    await makeColumns(root, dbId, ["date", "amount", "payee"]);

    const bytes = csvBytes(["Date", "Amount", "Payee"], [["2026-01-01", "85", "Shop"]]);
    const res = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(res.ok);
    if (!res.ok) return;
    const value = res.value as Extract<IngestFileResult, { kind: "needs-mapping" }>;
    assert.equal(value.kind, "needs-mapping");
    assert.ok(value.decision.id);
    assert.equal(value.decision.status, "pending");

    const rows = await listIngestBatches(root, "health", dbId);
    assert.ok(rows.ok);
    if (rows.ok) {
      const awaiting = rows.value.filter((b) => b.status === "awaiting-mapping");
      assert.equal(awaiting.length, 1);
    }

    const mappingPath = path.join(root, "domains/health/data/mappings");
    let mappingFiles: string[] = [];
    try { mappingFiles = await fs.readdir(mappingPath); } catch {}
    assert.equal(mappingFiles.length, 0);
  });

  it("Approve mapping writes JSON; second ingest same fingerprint stages with no new Decision", async () => {
    const root = await setupVault(dir, "t5-approve");
    const db = await createDatabase(root, "health", { name: "Food5" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;
    await makeColumns(root, dbId, ["date", "amount", "payee"]);

    const bytes = csvBytes(["Date", "Amount", "Payee"], [["2026-01-01", "85", "Shop"]]);
    const first = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(first.ok);
    if (!first.ok) return;
    const needsMap = first.value as Extract<IngestFileResult, { kind: "needs-mapping" }>;

    const appr = await resolveDecision(root, needsMap.decision.id, "approved");
    assert.ok(appr.ok, `approve: ${appr.ok ? "" : appr.error}`);

    const mappingPath = path.join(root, "domains/health/data/mappings");
    const mappingFiles = await fs.readdir(mappingPath);
    assert.ok(mappingFiles.length >= 1);
    const mappingFile = await fs.readFile(path.join(mappingPath, mappingFiles[0]!), "utf8");
    const mapping = JSON.parse(mappingFile) as IngestMapping;
    assert.ok(mapping.id);
    assert.equal(mapping.databaseId, dbId);

    const second = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx2.csv",
      actor: { type: "user" },
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    const staged = second.value as Extract<IngestFileResult, { kind: "staged" }>;
    assert.equal(staged.kind, "staged");

    const decs = await listDecisions(root);
    assert.ok(decs.ok);
    if (decs.ok) {
      const mappingDecs = decs.value.filter((d) => d.target.type === "mapping");
      assert.equal(mappingDecs.length, 1);
    }
  });

  it("Reject mapping: second ingest needs-mapping again, not staged", async () => {
    const root = await setupVault(dir, "t6-reject");
    const db = await createDatabase(root, "health", { name: "Food6" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;
    await makeColumns(root, dbId, ["date", "amount", "payee"]);

    const bytes = csvBytes(["Date", "Amount", "Payee"], [["2026-01-01", "85", "Shop"]]);
    const first = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(first.ok);
    if (!first.ok) return;
    const needsMap = first.value as Extract<IngestFileResult, { kind: "needs-mapping" }>;

    const rej = await resolveDecision(root, needsMap.decision.id, "rejected");
    assert.ok(rej.ok, `reject: ${rej.ok ? "" : rej.error}`);

    const second = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx2.csv",
      actor: { type: "user" },
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    const value = second.value as Extract<IngestFileResult, { kind: "needs-mapping" }>;
    assert.equal(value.kind, "needs-mapping");
    assert.notEqual(value.decision.id, needsMap.decision.id);
  });

  it("Fingerprint layout change: different headers -> new Decision", async () => {
    const root = await setupVault(dir, "t7-layout");
    const db = await createDatabase(root, "health", { name: "Food7" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;
    await makeColumns(root, dbId, ["date", "amount", "payee"]);

    const bytes1 = csvBytes(["Date", "Amount", "Payee"], [["2026-01-01", "85", "Shop"]]);
    const first = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes: bytes1,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(first.ok);

    const bytes2 = csvBytes(["Date", "Amount", "Category"], [["2026-01-01", "85", "Food"]]);
    const second = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes: bytes2,
      mime: "text/csv",
      name: "tx2.csv",
      actor: { type: "user" },
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    const value = second.value as Extract<IngestFileResult, { kind: "needs-mapping" }>;
    assert.equal(value.kind, "needs-mapping");

    const decs = await listDecisions(root);
    assert.ok(decs.ok);
    if (decs.ok) {
      const mappingDecs = decs.value.filter((d) => d.target.type === "mapping");
      assert.equal(mappingDecs.length, 2);
    }
  });

  it("Duplicate warning: duplicate=true still proposed; accept still posts", async () => {
    const root = await setupVault(dir, "t8-dup");
    const db = await createDatabase(root, "health", { name: "Food8" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;

    await approveMappingDecision(root, dbId, "map-dup", ["Date", "Amount", "Payee", "ExtId"], ["Date", "Amount", "Payee", "ExtId"], ["date", "amount", "payee", "external_id"]);

    const bytes1 = csvBytes(
      ["Date", "Amount", "Payee", "ExtId"],
      [["2026-01-01", "85", "Shop", "EXT-1"]],
    );
    const ingest1 = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes: bytes1,
      mime: "text/csv",
      name: "tx1.csv",
      actor: { type: "user" },
    });
    assert.ok(ingest1.ok);
    if (!ingest1.ok) return;
    const staged1 = ingest1.value as Extract<IngestFileResult, { kind: "staged" }>;
    const acc1 = await acceptIngestRows(root, "health", staged1.batch.id);
    assert.ok(acc1.ok, `accept1: ${acc1.ok ? "" : acc1.error}`);

    const bytes2 = csvBytes(
      ["Date", "Amount", "Payee", "ExtId"],
      [["2026-01-02", "90", "Shop", "EXT-1"]],
    );
    const ingest2 = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes: bytes2,
      mime: "text/csv",
      name: "tx2.csv",
      actor: { type: "user" },
    });
    assert.ok(ingest2.ok);
    if (!ingest2.ok) return;
    const staged2 = ingest2.value as Extract<IngestFileResult, { kind: "staged" }>;
    assert.equal(staged2.rows[0]!.duplicate, true);
    assert.equal(staged2.rows[0]!.status, "proposed");

    const acc2 = await acceptIngestRows(root, "health", staged2.batch.id);
    assert.ok(acc2.ok, `accept2: ${acc2.ok ? "" : acc2.error}`);
    if (acc2.ok) assert.equal(acc2.value.accepted, 1);
  });

  it("PDF fail closed: no extractedRows -> error; file remains", async () => {
    const root = await setupVault(dir, "t9-pdf");
    const db = await createDatabase(root, "health", { name: "Pdf1" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;
    await makeColumns(root, dbId, ["date", "amount", "payee"]);

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const res = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes: pdfBytes,
      mime: "application/pdf",
      name: "stmt.pdf",
      actor: { type: "user" },
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /pdf/i);

    const filesDir = path.join(root, "domains/health/data/files");
    let entries: string[] = [];
    try { entries = await fs.readdir(filesDir, { recursive: true }); } catch {}
    assert.ok(entries.some((e) => e.includes(".pdf")));
  });

  it("PDF with extractedRows + mapping stages", async () => {
    const root = await setupVault(dir, "t10-pdf");
    const db = await createDatabase(root, "health", { name: "Pdf2" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;

    const meta = await makeColumns(root, dbId, ["date", "amount", "payee"]);
    const mappingId = "map-pdf";
    const fingerprint = fingerprintOf(["Date", "Amount", "Payee"]);
    const proposeRes = await proposeMapping(root, "health", {
      mappingId,
      databaseId: dbId,
      fingerprint,
      sourceKind: "pdf",
      columns: [
        { source: "Date", columnId: meta.columns[0]!.id },
        { source: "Amount", columnId: meta.columns[1]!.id },
        { source: "Payee", columnId: meta.columns[2]!.id },
      ],
      actor: { type: "user" },
    });
    assert.ok(proposeRes.ok);
    if (!proposeRes.ok) return;
    const decs = await listDecisions(root);
    assert.ok(decs.ok);
    if (!decs.ok) return;
    const dec = decs.value.find((d) => d.target.type === "mapping")!;
    await resolveDecision(root, dec.id, "approved");

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const res = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes: pdfBytes,
      mime: "application/pdf",
      name: "stmt.pdf",
      extractedRows: [{ Date: "2026-01-01", Amount: "85", Payee: "Shop" }],
      actor: { type: "user" },
    });
    assert.ok(res.ok);
    if (!res.ok) return;
    const staged = res.value as Extract<IngestFileResult, { kind: "staged" }>;
    assert.equal(staged.kind, "staged");
    assert.equal(staged.rows.length, 1);
  });

  it("Path escape: evil slug fails; getMapping with ../ fails", async () => {
    const root = await setupVault(dir, "t11-path");
    const bytes = csvBytes(["A"], [["1"]]);

    const evil = await ingestFile(root, "../evil", {
      databaseId: "x",
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.equal(evil.ok, false);

    const gm = await getMapping(root, "health", "../escape");
    assert.equal(gm.ok, false);
  });

  it("Archived domain: ingestFile fails", async () => {
    const root = await setupVault(dir, "t13-archive");
    await archiveDomain(root, "health");

    const bytes = csvBytes(["A"], [["1"]]);
    const res = await ingestFile(root, "health", {
      databaseId: "x",
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.equal(res.ok, false);
  });

  it("editIngestRow changes proposed cells; cannot edit after accept", async () => {
    const root = await setupVault(dir, "t12-edit");
    const db = await createDatabase(root, "health", { name: "Edit1" });
    assert.ok(db.ok);
    if (!db.ok) return;
    const dbId = db.value.id;

    const meta = await approveMappingDecision(root, dbId, "map-edit", ["Date", "Amount", "Payee"], ["Date", "Amount", "Payee"], ["date", "amount", "payee"]);

    const bytes = csvBytes(["Date", "Amount", "Payee"], [["2026-01-01", "85", "Shop"]]);
    const ingest = await ingestFile(root, "health", {
      databaseId: dbId,
      bytes,
      mime: "text/csv",
      name: "tx.csv",
      actor: { type: "user" },
    });
    assert.ok(ingest.ok);
    if (!ingest.ok) return;
    const staged = ingest.value as Extract<IngestFileResult, { kind: "staged" }>;
    const rowId = staged.rows[0]!.id;

    const edit = await editIngestRow(root, "health", staged.batch.id, rowId, {
      [meta.columns[2]!.id]: "NewPayee",
    });
    assert.ok(edit.ok, `edit: ${edit.ok ? "" : edit.error}`);
    if (edit.ok) assert.equal((edit.value.cells as Record<string, string>)[meta.columns[2]!.id], "NewPayee");

    await acceptIngestRows(root, "health", staged.batch.id);
    const editAfter = await editIngestRow(root, "health", staged.batch.id, rowId, {
      [meta.columns[2]!.id]: "Nope",
    });
    assert.equal(editAfter.ok, false);
  });
});
