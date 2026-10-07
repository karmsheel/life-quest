import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  addDatabaseColumn,
  createDatabase,
  createVault,
  getDatabase,
  resolveViewBlocks,
  runViewBlocks,
  saveView,
  upsertRow,
} from "@lifequest/vault-core";

/**
 * The single-aggregate shape still works, byte for byte.
 *
 * Composed views replaced `validateViewSpec(spec)` with a block path, so every
 * view that existed before now runs through `resolveViewBlocks` first. That is
 * a change to the reading of files already on disk, which is exactly the kind
 * of change that silently breaks old data — so it gets its own fixture: the
 * original shape, saved through `saveView`, run and asserted.
 */
describe("views: the original single-aggregate shape", () => {
  it("saves, resolves to one block and runs unchanged", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lq-single-view-"));
    const created = await createVault(root, "T");
    assert.equal(created.ok, true);

    const db = await createDatabase(root, "financial", { name: "Transactions" });
    assert.equal(db.ok, true, db.ok ? "" : db.error);
    const dbId = (db as { ok: true; value: { id: string } }).value.id;
    for (const col of [
      { name: "date", type: "date" as const },
      { name: "amount", type: "number" as const },
      { name: "category", type: "select" as const, options: ["Groceries", "Transport"] },
    ]) {
      const added = await addDatabaseColumn(root, "financial", dbId, col);
      assert.equal(added.ok, true, added.ok ? "" : added.error);
    }
    const live = await getDatabase(root, "financial", dbId);
    assert.equal(live.ok, true);
    const cols = (live as { ok: true; value: { columns: { id: string; name: string }[] } }).value.columns;
    const col = (n: string) => cols.find((c) => c.name === n)!.id;

    for (const [date, amount, category] of [
      ["2026-03-02", 60, "Transport"],
      ["2026-03-03", 215.5, "Groceries"],
      ["2026-03-04", 24.5, "Groceries"],
    ] as const) {
      const row = await upsertRow(root, "financial", dbId, {
        cells: { [col("date")]: date, [col("amount")]: amount, [col("category")]: category },
      });
      assert.equal(row.ok, true, row.ok ? "" : row.error);
    }

    // The pre-composed shape: query fields at the root, no `blocks` key at all.
    const legacy = {
      databaseId: dbId,
      title: "Spend by category",
      presentation: "bar" as const,
      groupBy: col("category"),
      timeBucket: null,
      timeColumnId: null,
      timeWindow: "all" as const,
      filters: [],
      measure: "sum" as const,
      measureColumnId: col("amount"),
      sort: { by: "value" as const, dir: "desc" as const },
      limit: 12,
      convertToZar: false,
    };

    const saved = await saveView(root, "financial", legacy);
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
    const file = (saved as { ok: true; value: Record<string, unknown> }).value;
    assert.equal(file.blocks, undefined, "a single-aggregate save must not grow a blocks key");

    // It resolves to exactly one implicit block, complete, with the query intact.
    const blocks = resolveViewBlocks(file as never);
    assert.equal(blocks.length, 1, `resolved ${blocks.length} blocks, expected 1`);
    assert.equal(blocks[0]!.groupBy, col("category"));
    assert.equal(blocks[0]!.measure, "sum");
    assert.equal(blocks[0]!.measureColumnId, col("amount"));
    assert.deepEqual(blocks[0]!.sort, { by: "value", dir: "desc" });

    // And it runs to the same two rows, richest first.
    const run = await runViewBlocks(root, "financial", file as never);
    assert.equal(run.ok, true, run.ok ? "" : run.error);
    const panels = (run as { ok: true; value: { blocks: { id: string; result: { rows: [string, number][] } }[] } }).value.blocks;
    assert.equal(panels.length, 1);
    assert.deepEqual(panels[0]!.result.rows, [["Groceries", 240], ["Transport", 60]]);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
