import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyFinanceKitInstall,
  createVault,
  listViews,
  getView,
  runSavedView,
  runView,
  saveView,
  deleteView,
  upsertRow,
} from "../src/index.ts";
import type { ViewSpec } from "../src/index.ts";

// Agent-built dashboard views — plan.md design, slice 1: view file, validator,
// runView. Proven on a temp vault with finance-shaped rows (the plan.md
// failure-mode list).
describe("views (agent-built dashboard views, slice 1)", () => {
  let dir: string;
  let root: string;
  let txDb = "finance:transactions";
  let catColId = "category";
  let dateColId = "date";
  let amountColId = "amount";
  let acctColId = "account";
  // KAR-C: column ids are stable constants in the finance kit, but asserting
  // through lookups keeps these tests honest if the kit renumbers.
  let categoryId = "cat:groceries";
  let categoryId2 = "cat:transport";
  let acctZarId = "acct:zar";
  let acctUsdId = "acct:usd";

  function spec(partial: Partial<ViewSpec>): ViewSpec {
    return {
      schemaVersion: 1,
      databaseId: txDb,
      title: "Test view",
      presentation: "bar",
      groupBy: catColId,
      timeBucket: null,
      timeColumnId: dateColId,
      timeWindow: "all",
      filters: [],
      measure: "sum",
      measureColumnId: amountColId,
      sort: { by: "value", dir: "desc" },
      limit: 12,
      convertToZar: false,
      ...partial,
    };
  }

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-views-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "ViewTest")).ok, true);
    assert.equal((await applyFinanceKitInstall(root)).ok, true);

    // Categories
    await upsertRow(root, "financial", "finance:categories", {
      id: categoryId,
      cells: { name: "Groceries" },
    });
    await upsertRow(root, "financial", "finance:categories", {
      id: categoryId2,
      cells: { name: "Transport" },
    });
    // Accounts: one ZAR, one USD
    await upsertRow(root, "financial", "finance:accounts", {
      id: acctZarId,
      cells: { name: "Card", type: "checking", currency: "ZAR", opening_balance: 0, opening_as_of: "2026-01-01" },
    });
    await upsertRow(root, "financial", "finance:accounts", {
      id: acctUsdId,
      cells: { name: "US Card", type: "checking", currency: "USD", opening_balance: 0, opening_as_of: "2026-01-01" },
    });
    // Transactions: mixed months, a bad date, amounts both signs
    const rows: Array<[string, string, number, string | null, string]> = [
      ["tx1", "2026-08-03", -120, categoryId, acctZarId],
      ["tx2", "2026-08-11", -45.5, categoryId, acctZarId],
      ["tx3", "2026-09-01", -60, categoryId2, acctZarId],
      ["tx4", "2026-09-05", 1000, null, acctZarId], // income, no category
      ["tx5", "2026-09-06", -20, categoryId, acctZarId],
      ["tx6", "2026-09-07", -30, categoryId, acctUsdId], // USD account
      ["tx7", "not-a-date", -5, categoryId2, acctZarId], // unparseable date
    ];
    for (const [id, date, amount, cat, acct] of rows.slice(0, 6)) {
      const cells: Record<string, unknown> = { date, amount, account: acct };
      if (cat) cells[catColId] = cat;
      const res = await upsertRow(root, "financial", txDb, { id, cells });
      assert.equal(res.ok, true);
    }
    // The unparseable date arrives through a legacy/import path that bypasses
    // upsertRow's validateCells (writes reject it); the read path must still
    // survive one, so insert it straight into the rows table.
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(path.join(root, "domains", "financial", "data", "domain.sqlite"));
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
      )
      .run(txDb, "tx7", new Date().toISOString(), new Date().toISOString(), JSON.stringify({
        date: "not-a-date",
        amount: -5,
        [acctColId]: acctZarId,
        [catColId]: categoryId2,
      }));
    sqlite.close();
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("spend by category shows names, not ids", async () => {
    const res = await runView(root, "financial", spec({
      title: "Spend by category",
      filters: [{ columnId: amountColId, op: "lt", value: 0 }],
    }));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // Values: Groceries -(120+45.5+20+30) [tx6 rides the USD account],
    // Transport -(60+5) [tx7's undated row is still a Transport spend].
    assert.deepEqual(res.value.rows, [
      ["Transport", -65],
      ["Groceries", -215.5],
    ]);
    // tx6 is on a USD account and the kit has no rate set, so the card says mixed.
    assert.equal(res.value.currency, "mixed");
  });

  it("spend by month buckets dates and counts the unparseable one as Undated with a warning", async () => {
    const res = await runView(root, "financial", spec({
      title: "Spend by month",
      presentation: "line",
      timeBucket: "month",
      groupBy: dateColId,
      filters: [{ columnId: amountColId, op: "lt", value: 0 }],
      sort: { by: "label", dir: "asc" },
    }));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const labels = res.value.rows.map((r) => r[0]);
    assert.deepEqual(labels, ["2026-08", "2026-09", "Undated"]);
    assert.equal(
      res.value.warnings.some((w) => w.includes("1 row has an unparseable")),
      true,
    );
  });

  it("a single metric with no group returns one row", async () => {
    const res = await runView(root, "financial", spec({
      title: "Total spend",
      presentation: "metric",
      groupBy: null,
      filters: [{ columnId: amountColId, op: "lt", value: 0 }],
    }));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // tx1..tx7 sum of negatives: -(120 + 45.5 + 60 + 20 + 30 + 5)
    assert.deepEqual(res.value.rows, [["value", -280.5]]);
  });

  it("mixed currencies without conversion: the card says mixed and warns", async () => {
    const res = await runView(root, "financial", spec({
      title: "All spend",
      filters: [{ columnId: amountColId, op: "lt", value: 0 }],
    }));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // tx6 -30 is on the USD account; with convertToZar false and no rate it stays USD.
    assert.equal(res.value.currency, "mixed");
    assert.equal(
      res.value.warnings.some((w) => /currency/i.test(w)),
      true,
    );
  });

  it("a line chart with a category group is rejected", async () => {
    const res = await runView(root, "financial", spec({
      title: "Wrong line",
      presentation: "line",
      timeBucket: null,
      groupBy: catColId,
    }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /line view requires a date groupBy/i);

    const fromFile = await saveView(root, "financial", {
      schemaVersion: 1,
      databaseId: txDb,
      title: "Wrong line saved",
      presentation: "line",
      groupBy: catColId,
      timeBucket: null,
      timeColumnId: dateColId,
      timeWindow: "all",
      filters: [],
      measure: "sum",
      measureColumnId: amountColId,
      sort: { by: "label", dir: "asc" },
      limit: 12,
      convertToZar: false,
    });
    assert.equal(fromFile.ok, false);
    if (!fromFile.ok) assert.match(fromFile.error, /line view requires/i);
    const after = await listViews(root, "financial");
    assert.equal(after.ok && after.value.length, 0, "a rejected save writes nothing");
  });

  it("validator rejects an unknown column, a count with a column, a bad op, and a limit over 50", async () => {
    const unknown = await runView(root, "financial", spec({ groupBy: "nonexistent-col" }));
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /groupBy column does not exist/);

    const countWithCol = await runView(root, "financial", spec({
      presentation: "metric",
      groupBy: null,
      measure: "count",
      measureColumnId: amountColId,
    }));
    assert.equal(countWithCol.ok, false);
    if (!countWithCol.ok) assert.match(countWithCol.error, /count measure takes no measureColumnId/);

    const badOp = await runView(root, "financial", spec({
      filters: [{ columnId: amountColId, op: "like", value: 0 }],
    }));
    assert.equal(badOp.ok, false);
    if (!badOp.ok) assert.match(badOp.error, /Unknown filter op/);

    const bigLimit = await runView(root, "financial", spec({ limit: 51 }));
    assert.equal(bigLimit.ok, false);
    if (!bigLimit.ok) assert.match(bigLimit.error, /between 1 and 50/);
  });

  it("save, run from file, list, and delete round-trip; a second save with the same id updates", async () => {
    const saved = await saveView(root, "financial", {
      schemaVersion: 1,
      databaseId: txDb,
      title: "Spend by category, all time",
      presentation: "bar",
      groupBy: catColId,
      timeBucket: null,
      timeColumnId: dateColId,
      timeWindow: "all",
      filters: [{ columnId: amountColId, op: "lt", value: 0 }],
      measure: "sum",
      measureColumnId: amountColId,
      sort: { by: "value", dir: "desc" },
      limit: 12,
      convertToZar: false,
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const listed = await listViews(root, "financial");
    assert.equal(listed.ok && listed.value.length === 1, true);

    const run = await runSavedView(root, "financial", saved.value.id);
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.value.rows[0][0], "Transport");

    const edit = await saveView(root, "financial", {
      schemaVersion: 1,
      databaseId: txDb,
      title: "Spend by category, September",
      presentation: "bar",
      groupBy: catColId,
      timeBucket: null,
      timeColumnId: dateColId,
      timeWindow: { kind: "custom", start: "2026-09-01", end: "2026-09-30" },
      filters: [{ columnId: amountColId, op: "lt", value: 0 }],
      measure: "sum",
      measureColumnId: amountColId,
      sort: { by: "value", dir: "desc" },
      limit: 12,
      convertToZar: false,
    }, { id: saved.value.id });
    assert.equal(edit.ok, true);
    if (!edit.ok) return;
    assert.equal(edit.value.id, saved.value.id, "same id, updated file");
    assert.equal(edit.value.createdAt === saved.value.createdAt, true, "createdAt preserved");
    assert.equal(edit.value.title, "Spend by category, September");
    // September window: Groceries -50 (tx5 -20 + tx6 -30), Transport -60 (tx3).
    // The undated row is out — its date fails the window bounds even though the
    // parse would too; the window is a read-time SQL filter.
    const runEdited = await runSavedView(root, "financial", saved.value.id);
    assert.equal(runEdited.ok, true);
    if (runEdited.ok) {
      assert.deepEqual(runEdited.value.rows, [
        ["Groceries", -50],
        ["Transport", -60],
      ]);
      assert.equal(
        runEdited.value.warnings.some((w) => w.startsWith("Showing")),
        false,
      );
    }

    const byTitle = await getView(root, "financial", saved.value.id);
    assert.equal(byTitle.ok, true);

    const del = await deleteView(root, "financial", saved.value.id);
    assert.equal(del.ok, true);
    const gone = await getView(root, "financial", saved.value.id);
    assert.equal(gone.ok, false);
    const reread = await listViews(root, "financial");
    assert.equal(reread.ok && reread.value.length, 0);
  });

  it("an empty result reads as zero rows, not a crash; a missing view file errors cleanly", async () => {
    const res = await runView(root, "financial", spec({
      title: "Nothing",
      filters: [{ columnId: amountColId, op: "lt", value: -999999 }],
    }));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.rows, []);

    const missing = await runSavedView(root, "financial", "no-such-view");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /View not found/);
  });
});
