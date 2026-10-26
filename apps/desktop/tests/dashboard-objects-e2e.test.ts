import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  VIEW_SPEC_SCHEMA,
  VIEW_VOCABULARY,
  addDatabaseColumn,
  createDatabase,
  createVault,
  executeViewTool,
  getDatabase,
  getView,
  runViewBlocks,
  saveView,
  upsertRow,
} from "@lifequest/vault-core";

/**
 * A dashboard card as LIVE DATA OBJECTS, end to end on a real vault.
 *
 * The operator's report was specific: "when I click the table/bar/line tabs on
 * the spending-by-month card and come back, the data seems to be lost and it is
 * just plain transactions with no details". The cause was that a presentation
 * was implemented as a QUERY REWRITE: switching a one-number object to a bar
 * gave it the first date column as a groupBy and no timeBucket, so it became one
 * bar per transaction date; switching back to a table kept that grouping. The
 * card had not lost data — it had been asked a different question.
 *
 * This rig holds the new contract, which has four claims:
 *
 *  1. PRESENTATION IS A DRAWING. Moving an object table -> bar -> line -> metric
 *     -> table leaves its rows identical and its groupBy, timeBucket and measure
 *     untouched. The old bug is reproduced as a single-number object cycled
 *     through every drawing and required to stay one row of 900.
 *  2. A CARD IS OBJECTS. Several objects can read different databases, and an
 *     object with `from` folds an earlier object's rows — the average of the
 *     monthly totals — and recomputes when a row is written.
 *  3. A SPLIT IS ONE DATASET. `seriesBy` gives one colour series per category
 *     with per-label totals that still add up, and a table column per series.
 *  4. THE DOOR TEACHES IT. The advertised schema names the new fields, and a
 *     refused object answers with the working specs that would pass.
 *
 * The artifact is `e2e/artifacts/dashboard-objects.json`. Failures throw, so the
 * artifact only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/dashboard-objects.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** Local noon, so the injected day is the same local day in every timezone. */
function noonOn(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

type Block = {
  id: string;
  presentation: string;
  result: {
    rows: [string, number][];
    listRows?: Array<Array<string | number>>;
    columns: string[];
    summary?: { label: string; value: number } | null;
    series?: string[];
    seriesRows?: [string, string, number][];
    warnings: string[];
  };
};

describe("dashboard data objects e2e", () => {
  it("keeps the data through every drawing, derives an average, and splits by category", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-objects-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};
    try {
      const created = await createVault(vaultRoot, "E2E Objects");
      assert.equal(created.ok, true, created.ok ? "" : created.error);

      const transactions = await createDatabase(vaultRoot, "financial", { name: "Transactions" });
      assert.equal(transactions.ok, true, transactions.ok ? "" : transactions.error);
      const txId = (transactions as { ok: true; value: { id: string } }).value.id;
      for (const column of [
        { name: "date", type: "date" as const },
        { name: "amount", type: "number" as const },
        { name: "category", type: "select" as const, options: ["Food", "Travel", "Rent"] },
        { name: "payee", type: "text" as const },
      ]) {
        const added = await addDatabaseColumn(vaultRoot, "financial", txId, column);
        assert.equal(added.ok, true, added.ok ? "" : added.error);
      }
      const txCols = (
        (await getDatabase(vaultRoot, "financial", txId)) as {
          ok: true;
          value: { columns: { id: string; name: string }[] };
        }
      ).value.columns;
      const tx = (name: string): string => {
        const found = txCols.find((c) => c.name === name);
        assert.ok(found, `column ${name} is missing`);
        return found.id;
      };

      const accounts = await createDatabase(vaultRoot, "financial", { name: "Accounts" });
      assert.equal(accounts.ok, true, accounts.ok ? "" : accounts.error);
      const acctId = (accounts as { ok: true; value: { id: string } }).value.id;
      await addDatabaseColumn(vaultRoot, "financial", acctId, { name: "name", type: "text" });
      const acctCol = (
        (await getDatabase(vaultRoot, "financial", acctId)) as {
          ok: true;
          value: { columns: { id: string }[] };
        }
      ).value.columns[0]!.id;
      for (const name of ["Cheque", "Savings"]) {
        const row = await upsertRow(vaultRoot, "financial", acctId, {
          cells: { [acctCol]: name },
        });
        assert.equal(row.ok, true, row.ok ? "" : row.error);
      }

      /**
       * Four whole months before October, plus one October row that every
       * window in the card must exclude:
       *   June  200, July 300, August 300, September 100  → total 900, average 225.
       * Categories over the same four months: Food 600, Travel 200, Rent 100.
       */
      const ledger: Array<[date: string, amount: number, category: string, payee: string]> = [
        ["2026-06-05", 100, "Food", "June food"],
        ["2026-06-20", 100, "Travel", "June travel"],
        ["2026-07-05", 200, "Food", "July food"],
        ["2026-07-20", 100, "Rent", "July rent"],
        ["2026-08-05", 300, "Food", "August food"],
        ["2026-09-05", 100, "Travel", "September travel"],
        ["2026-10-05", 500, "Food", "October — outside every window"],
      ];
      for (const [date, amount, category, payee] of ledger) {
        const row = await upsertRow(vaultRoot, "financial", txId, {
          cells: {
            [tx("date")]: date,
            [tx("amount")]: amount,
            [tx("category")]: category,
            [tx("payee")]: payee,
          },
        });
        assert.equal(row.ok, true, row.ok ? "" : row.error);
      }

      const window = { kind: "previous-months" as const, months: 4 };
      const spec = {
        databaseId: txId,
        title: "Spending, object by object",
        presentation: "table" as const,
        groupBy: tx("date"),
        timeBucket: "month" as const,
        timeColumnId: tx("date"),
        timeWindow: window,
        measure: "sum" as const,
        measureColumnId: tx("amount"),
        filters: [],
        blocks: [
          {
            id: "months",
            title: "Month by month",
            presentation: "table" as const,
            groupBy: tx("date"),
            timeBucket: "month" as const,
            timeColumnId: tx("date"),
            timeWindow: window,
            measure: "sum" as const,
            measureColumnId: tx("amount"),
          },
          {
            id: "average",
            title: "Average month",
            presentation: "metric" as const,
            from: "months",
            measure: "avg" as const,
          },
          {
            id: "trend",
            title: "By category",
            presentation: "line" as const,
            groupBy: tx("date"),
            timeBucket: "month" as const,
            timeColumnId: tx("date"),
            timeWindow: window,
            measure: "sum" as const,
            measureColumnId: tx("amount"),
            seriesBy: tx("category"),
            display: {
              palette: "cool" as const,
              legend: true,
              xLabel: "Month",
              yLabel: "Spend",
              valueLabels: true,
            },
          },
          {
            id: "accounts",
            title: "Accounts",
            presentation: "metric" as const,
            databaseId: acctId,
            measure: "count" as const,
          },
          {
            id: "rows",
            title: "The rows themselves",
            presentation: "list" as const,
            columns: [tx("date"), tx("payee"), tx("amount")],
            timeColumnId: tx("date"),
            timeWindow: window,
          },
        ],
      };

      const saved = await saveView(vaultRoot, "financial", spec);
      assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
      const viewId = (saved as { ok: true; value: { id: string } }).value.id;

      const at = noonOn("2026-10-28");
      const run = await runViewBlocks(vaultRoot, "financial", spec, at);
      assert.equal(run.ok, true, run.ok ? "" : run.error);
      const blocks = (run as { ok: true; value: { blocks: Block[]; warnings: string[] } }).value;
      const block = (id: string): Block => {
        const found = blocks.blocks.find((b) => b.id === id);
        assert.ok(found, `the card has no object ${id}`);
        return found;
      };
      checks.initial = {
        months: block("months").result.rows,
        average: block("average").result.summary,
        trend: {
          series: block("trend").result.series,
          rows: block("trend").result.seriesRows,
        },
        accounts: block("accounts").result.summary,
        rows: block("rows").result.listRows,
        warnings: blocks.warnings,
      };

      // ── 1. the objects are the ones asked for ─────────────────────────────
      assert.deepEqual(block("months").result.rows, [
        ["2026-06", 200],
        ["2026-07", 300],
        ["2026-08", 300],
        ["2026-09", 100],
      ]);
      assert.deepEqual(block("months").result.summary, { label: "total", value: 900 });
      assert.deepEqual(
        block("average").result.summary,
        { label: "average", value: 225 },
        "the average of the monthly totals is not 900 / 4",
      );
      assert.equal(
        block("accounts").result.summary?.value,
        2,
        "the object reading the second database did not count its rows",
      );
      assert.equal(
        block("rows").result.listRows?.length,
        6,
        "the row object did not print one line per matched row",
      );

      // ── 2. a split is one dataset ─────────────────────────────────────────
      assert.deepEqual(block("trend").result.series, ["Food", "Travel", "Rent"]);
      assert.deepEqual(block("trend").result.seriesRows, [
        ["2026-06", "Food", 100],
        ["2026-06", "Travel", 100],
        ["2026-07", "Food", 200],
        ["2026-07", "Rent", 100],
        ["2026-08", "Food", 300],
        ["2026-09", "Travel", 100],
      ]);
      assert.deepEqual(
        block("trend").result.rows,
        block("months").result.rows,
        "a series split changed the per-label totals",
      );

      // ── 3. presentation is only a drawing ────────────────────────────────
      const { applyPresentation } = await import("../src/components/ui/view-block-edit.ts");
      const dbMeta = (await getDatabase(vaultRoot, "financial", txId)) as {
        ok: true;
        value: never;
      };
      const baseline = block("months").result.rows;
      const drawings: Array<Record<string, unknown>> = [];
      for (const target of ["bar", "line", "metric", "table"] as const) {
        const current = await getView(vaultRoot, "financial", viewId);
        assert.equal(current.ok, true);
        const built = applyPresentation(
          (current as { ok: true; value: never }).value,
          "months",
          target,
          (dbMeta as { ok: true; value: never }).value,
        );
        assert.equal(built.ok, true, built.ok ? "" : built.error);
        const resaved = await saveView(
          vaultRoot,
          "financial",
          built.spec as never,
          { id: viewId },
        );
        assert.equal(resaved.ok, true, resaved.ok ? "" : resaved.error);
        const drawn = await runViewBlocks(
          vaultRoot,
          "financial",
          (resaved as { ok: true; value: Record<string, unknown> }).value as never,
          at,
        );
        assert.equal(drawn.ok, true, drawn.ok ? "" : drawn.error);
        const months = (drawn as { ok: true; value: { blocks: Block[] } }).value.blocks.find(
          (b) => b.id === "months",
        )!;
        assert.deepEqual(
          months.result.rows,
          baseline,
          `switching to ${target} rewrote the object's data`,
        );
        assert.deepEqual(
          months.result.summary,
          { label: "total", value: 900 },
          `switching to ${target} lost the total`,
        );
        const file = (resaved as { ok: true; value: { blocks: Record<string, unknown>[] } }).value;
        const savedMonths = file.blocks.find((b) => b.id === "months")!;
        drawings.push({
          target,
          rows: months.result.rows,
          groupBy: savedMonths.groupBy,
          timeBucket: savedMonths.timeBucket,
          measure: savedMonths.measure,
          measureColumnId: savedMonths.measureColumnId,
          timeWindow: savedMonths.timeWindow,
        });
      }
      checks.drawings = drawings;
      for (const drawing of drawings) {
        assert.equal(drawing.groupBy, tx("date"), "a drawing changed the groupBy");
        assert.equal(drawing.timeBucket, "month", "a drawing changed the timeBucket");
        assert.equal(drawing.measure, "sum", "a drawing changed the measure");
        assert.deepEqual(drawing.timeWindow, window, "a drawing changed the time window");
      }

      // The exact reported regression: one-number object, cycle every drawing.
      const bugSpec = {
        databaseId: txId,
        title: "Spending by month (one number)",
        presentation: "metric" as const,
        groupBy: null,
        timeBucket: null,
        timeColumnId: tx("date"),
        timeWindow: window,
        measure: "sum" as const,
        measureColumnId: tx("amount"),
        filters: [],
      };
      const bugSaved = await saveView(vaultRoot, "financial", bugSpec);
      assert.equal(bugSaved.ok, true, bugSaved.ok ? "" : bugSaved.error);
      const bugId = (bugSaved as { ok: true; value: { id: string } }).value.id;
      const bugDrawings: Array<{ target: string; rows: [string, number][] }> = [];
      for (const target of ["bar", "table", "line", "metric"] as const) {
        const current = await getView(vaultRoot, "financial", bugId);
        assert.equal(current.ok, true);
        const built = applyPresentation(
          (current as { ok: true; value: never }).value,
          "block-1",
          target,
          (dbMeta as { ok: true; value: never }).value,
        );
        assert.equal(built.ok, true, built.ok ? "" : built.error);
        const resaved = await saveView(vaultRoot, "financial", built.spec as never, { id: bugId });
        assert.equal(resaved.ok, true, resaved.ok ? "" : resaved.error);
        const drawn = await runViewBlocks(
          vaultRoot,
          "financial",
          (resaved as { ok: true; value: Record<string, unknown> }).value as never,
          at,
        );
        assert.equal(drawn.ok, true, drawn.ok ? "" : drawn.error);
        const rows = (drawn as { ok: true; value: { blocks: Block[] } }).value.blocks[0]!.result
          .rows;
        assert.deepEqual(
          rows,
          [["value", 900]],
          `the one-number object became ${rows.length} rows when drawn as ${target}`,
        );
        bugDrawings.push({ target, rows });
      }
      checks.oneNumber = bugDrawings;

      // ── 4. live, with no write to the card ───────────────────────────────
      const extra = await upsertRow(vaultRoot, "financial", txId, {
        cells: {
          [tx("date")]: "2026-07-25",
          [tx("amount")]: 100,
          [tx("category")]: "Food",
          [tx("payee")]: "July extra",
        },
      });
      assert.equal(extra.ok, true, extra.ok ? "" : extra.error);
      const after = await runViewBlocks(
        vaultRoot,
        "financial",
        (await getView(vaultRoot, "financial", viewId) as { ok: true; value: never }).value,
        at,
      );
      assert.equal(after.ok, true, after.ok ? "" : after.error);
      const afterBlocks = (after as { ok: true; value: { blocks: Block[] } }).value.blocks;
      const afterMonths = afterBlocks.find((b) => b.id === "months")!;
      const afterAverage = afterBlocks.find((b) => b.id === "average")!;
      assert.deepEqual(afterMonths.result.rows, [
        ["2026-06", 200],
        ["2026-07", 400],
        ["2026-08", 300],
        ["2026-09", 100],
      ]);
      assert.deepEqual(
        afterAverage.result.summary,
        { label: "average", value: 250 },
        "the derived average did not follow the new row",
      );
      checks.live = {
        months: afterMonths.result.rows,
        average: afterAverage.result.summary,
      };

      // ── 5. the door advertises and returns the new vocabulary ────────────
      const blockProps = (
        VIEW_SPEC_SCHEMA.properties.blocks.items as {
          properties: Record<string, unknown>;
        }
      ).properties;
      assert.ok(blockProps.from, "the door's schema does not advertise `from`");
      assert.ok(blockProps.seriesBy, "the door's schema does not advertise `seriesBy`");
      assert.ok(blockProps.display, "the door's schema does not advertise `display`");
      assert.ok(blockProps.databaseId, "the door's schema does not advertise a per-object database");
      assert.deepEqual(VIEW_VOCABULARY.palette, ["accent", "warm", "cool", "mono"]);

      const preview = (await executeViewTool(vaultRoot, ACTOR, "preview_view", {
        domainSlug: "financial",
        spec,
      })) as {
        error?: { message: string };
        blocks: Array<{
          id: string;
          summary: { label: string; value: number } | null;
          series: string[] | null;
          rows: unknown[];
        }>;
      };
      checks.preview = preview;
      assert.equal(preview.error, undefined);
      const previewAverage = preview.blocks.find((b) => b.id === "average")!;
      // The preview runs AFTER the extra row, so it must see the 250 the live
      // object saw — a preview that answered 225 would be reading a stale file.
      assert.deepEqual(previewAverage.summary, { label: "average", value: 250 });
      const previewTrend = preview.blocks.find((b) => b.id === "trend")!;
      assert.deepEqual(previewTrend.series, ["Food", "Travel", "Rent"]);

      // ── 6. the refusals name the fix ─────────────────────────────────────
      async function refused(label: string, bad: Record<string, unknown>): Promise<string> {
        const reply = (await executeViewTool(vaultRoot, ACTOR, "preview_view", {
          domainSlug: "financial",
          spec: { ...spec, ...bad },
        })) as { error?: { message: string; fix?: unknown } };
        assert.ok(reply.error, `"${label}" was accepted but should have been refused`);
        assert.ok(reply.error?.fix, `"${label}" was refused without a fix`);
        return reply.error!.message;
      }
      const refusals = {
        unknownSource: await refused("unknown from", { blocks: [
          { id: "x", title: "X", presentation: "metric", from: "nope", measure: "sum" },
        ] }),
        groupedRows: await refused("rows that group", { blocks: [
          {
            id: "x",
            title: "X",
            presentation: "table",
            columns: [tx("date")],
            groupBy: tx("date"),
          },
        ] }),
        averageSplit: await refused("avg split into series", { blocks: [
          {
            id: "x",
            title: "X",
            presentation: "bar",
            groupBy: tx("date"),
            timeBucket: "month",
            timeColumnId: tx("date"),
            timeWindow: window,
            measure: "avg",
            measureColumnId: tx("amount"),
            seriesBy: tx("category"),
          },
        ] }),
        derivedGrouped: await refused("derived object that groups", { blocks: [
          { id: "months", title: "Months", presentation: "table", groupBy: tx("date"), timeBucket: "month", timeColumnId: tx("date"), timeWindow: window, measure: "sum", measureColumnId: tx("amount") },
          { id: "x", title: "X", presentation: "table", from: "months", groupBy: tx("date"), measure: "avg" },
        ] }),
        badPalette: await refused("a palette no stylesheet knows", { blocks: [
          {
            id: "x",
            title: "X",
            presentation: "bar",
            groupBy: tx("date"),
            timeBucket: "month",
            timeColumnId: tx("date"),
            timeWindow: window,
            measure: "sum",
            measureColumnId: tx("amount"),
            display: { palette: "neon" },
          },
        ] }),
      };
      checks.refusals = refusals;
      assert.match(refusals.unknownSource, /EARLIER object/);
      assert.match(refusals.groupedRows, /must not group/);
      assert.match(refusals.averageSplit, /series split needs measure/);
      assert.match(refusals.derivedGrouped, /cannot group or window again/);
      assert.match(refusals.badPalette, /display\.palette must be one of/);

      // A one-number card written before presentations were separated may carry
      // the group's bucket with no group. Reading it must not fail a new rule.
      const legacy = {
        databaseId: txId,
        title: "Legacy one number",
        presentation: "metric" as const,
        groupBy: null,
        timeBucket: "week" as const,
        timeColumnId: tx("date"),
        timeWindow: window,
        filters: [],
        measure: "sum" as const,
        measureColumnId: tx("amount"),
      };
      const legacySaved = await saveView(vaultRoot, "financial", legacy);
      assert.equal(legacySaved.ok, true, legacySaved.ok ? "" : legacySaved.error);
      const legacyRun = await runViewBlocks(
        vaultRoot,
        "financial",
        (legacySaved as { ok: true; value: Record<string, unknown> }).value as never,
        at,
      );
      assert.equal(legacyRun.ok, true, legacyRun.ok ? "" : legacyRun.error);
      const legacyRows = (legacyRun as { ok: true; value: { blocks: Block[] } }).value.blocks[0]!
        .result.rows;
      assert.deepEqual(legacyRows, [["value", 1000]], "an old metric with a stale bucket stopped drawing");
      checks.legacy = legacyRows;

      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(
        ARTIFACT,
        `${JSON.stringify(
          {
            pass: true,
            what: "a dashboard card of live data objects: several databases, a derived average, a series split, and nothing lost when the drawing changes",
            command: "npm test  (this file: tests/dashboard-objects-e2e.test.ts)",
            savedView: (await getView(vaultRoot, "financial", viewId)) as unknown,
            checks,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
