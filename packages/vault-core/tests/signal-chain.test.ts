import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { readLog } from "../src/log.ts";
import { vaultPaths } from "../src/paths.ts";
import {
  createSignal,
  deleteSignal,
  listSignals,
  updateSignal,
} from "../src/signal-chain.ts";
import type { SignalRecord } from "../src/types.ts";

async function writeSignalFile(
  root: string,
  record: SignalRecord,
): Promise<void> {
  const filePath = vaultPaths(root).signalChainJson(record.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

describe("signal-chain", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-signals-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "SignalTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing folder lists empty without error", async () => {
    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.value, { records: [], skipped: 0 });
  });

  it("create writes pretty JSON with manual source and matching timestamps", async () => {
    const logBefore = await readLog(root);
    assert.equal(logBefore.ok, true);
    if (!logBefore.ok) return;

    const created = await createSignal(root, {
      type: "thought",
      body: "  noticed the stall  ",
      title: "  ",
      domainSlug: "health",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.type, "thought");
    assert.equal(created.value.body, "noticed the stall");
    assert.equal(created.value.title, null);
    assert.equal(created.value.domainSlug, "health");
    assert.equal(created.value.source, "manual");
    assert.equal(created.value.sourceRef, null);
    assert.equal(created.value.deletedAt, null);
    assert.equal(created.value.createdAt, created.value.updatedAt);
    assert.ok(created.value.id);

    const filePath = vaultPaths(root).signalChainJson(created.value.id);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /\n  "type": "thought"/);
    assert.equal(raw.endsWith("\n"), true);

    const logAfter = await readLog(root);
    assert.equal(logAfter.ok, true);
    if (!logAfter.ok) return;
    assert.equal(logAfter.value.length, logBefore.value.length);
    assert.deepEqual(
      logAfter.value.map((e) => e.id),
      logBefore.value.map((e) => e.id),
    );
  });

  it("list returns newest createdAt first and omits soft-deleted rows", async () => {
    const older: SignalRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      type: "idea",
      source: "manual",
      sourceRef: null,
      title: "older",
      body: "older body",
      domainSlug: null,
    };
    const newer: SignalRecord = {
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      deletedAt: null,
      type: "notice",
      source: "manual",
      sourceRef: null,
      title: "newer",
      body: "newer body",
      domainSlug: "financial",
    };
    const gone: SignalRecord = {
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      deletedAt: "2026-07-02T00:00:00.000Z",
      type: "other",
      source: "manual",
      sourceRef: null,
      title: null,
      body: "deleted",
      domainSlug: null,
    };
    await writeSignalFile(root, older);
    await writeSignalFile(root, newer);
    await writeSignalFile(root, gone);

    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const ids = listed.value.records.map((r) => r.id);
    assert.equal(ids.includes(gone.id), false);
    const olderIdx = ids.indexOf(older.id);
    const newerIdx = ids.indexOf(newer.id);
    assert.ok(newerIdx >= 0 && olderIdx >= 0);
    assert.ok(newerIdx < olderIdx);
  });

  it("update changes fields, bumps updatedAt, leaves createdAt", async () => {
    const created = await createSignal(root, {
      type: "thought",
      body: "original",
      domainSlug: "health",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const before = created.value.createdAt;

    const updated = await updateSignal(root, created.value.id, {
      type: "idea",
      body: "edited",
      title: "Title",
      domainSlug: "intellectual",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.type, "idea");
    assert.equal(updated.value.body, "edited");
    assert.equal(updated.value.title, "Title");
    assert.equal(updated.value.domainSlug, "intellectual");
    assert.equal(updated.value.createdAt, before);
    assert.ok(updated.value.updatedAt >= before);
    assert.equal(updated.value.source, "manual");
  });

  it("delete sets deletedAt; list omits it; second delete is not found", async () => {
    const created = await createSignal(root, {
      type: "notice",
      body: "to delete",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const deleted = await deleteSignal(root, created.value.id);
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    assert.ok(deleted.value.deletedAt);

    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.id === created.value.id),
      false,
    );

    const again = await deleteSignal(root, created.value.id);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.error, "Signal not found");

    const filePath = vaultPaths(root).signalChainJson(created.value.id);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /"deletedAt": "/);
  });

  it("rejects empty body, unknown type, and unknown domain", async () => {
    const empty = await createSignal(root, { type: "thought", body: "   " });
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.error, "body is required");

    const badType = await createSignal(root, {
      type: "nope" as "thought",
      body: "x",
    });
    assert.equal(badType.ok, false);
    if (badType.ok) return;
    assert.match(badType.error, /Invalid signal type/);

    const badDomain = await createSignal(root, {
      type: "thought",
      body: "x",
      domainSlug: "not-a-domain",
    });
    assert.equal(badDomain.ok, false);
    if (badDomain.ok) return;
    assert.match(badDomain.error, /Unknown domain/);
  });

  it("rejects path traversal in id", async () => {
    const updated = await updateSignal(root, "../outside", { body: "nope" });
    assert.equal(updated.ok, false);

    const deleted = await deleteSignal(root, "..\\outside");
    assert.equal(deleted.ok, false);
  });

  it("skips malformed JSON without failing the list", async () => {
    const paths = vaultPaths(root);
    await fs.mkdir(paths.signalChainDir, { recursive: true });
    await fs.writeFile(
      path.join(paths.signalChainDir, "not-json.json"),
      "{nope",
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.signalChainDir, "bad-shape.json"),
      `${JSON.stringify({ id: "x" })}\n`,
      "utf8",
    );

    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.ok(listed.value.skipped >= 2);
    assert.equal(Array.isArray(listed.value.records), true);
  });
});
