import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  VIEW_VOCABULARY,
  addDatabaseColumn,
  createDatabase,
  createVault,
  getDatabase,
  getView,
  runSavedView,
  runViewBlocks,
  saveView,
  upsertRow,
} from "@lifequest/vault-core";

/**
 * The dashboard as a spreadsheet: a card's numbers are a FUNCTION of the vault
 * and the clock, and both move.
 *
 * Two failures are reproduced here against a real vault on disk, because both
 * were reported by the operator and neither is theoretical:
 *
 *  1. "the Today's Expense value hasn't changed in days." A card that spells a
 *     literal date in a `filters` entry is frozen: it recomputes nothing,
 *     however often it is drawn, because the date it asks for never moves. The
 *     vocabulary had no way to say "today", so an agent asked for today's
 *     spending had to freeze one. This rig runs one such card at two different
 *     instants and asserts it does NOT move — that is the bug, held still.
 *
 *  2. "I just told the agent to log an expense, but it didn't show up on the
 *     recent transactions table." The engine was always live; nothing re-ran it.
 *     The engine half is what this file can hold: the same spec, run again after
 *     a row is written, must return the new row.
 *
 * The renderer half — that a drawn card re-runs itself when a write lands — is
 * `live-dashboard-ui-e2e`, which needs a real window and a real IPC bridge.
 *
 * The artifact is `e2e/artifacts/live-dashboard.json`: the same instants, the
 * same specs, the same numbers, no eyeballing. Failures throw, so the artifact
 * only exists for a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/live-dashboard.json");

/**
 * Local noon on an ISO day.
 *
 * Noon, not midnight, because the app's own rule is the LOCAL calendar day
 * (`todayLocalIso`), and a fixture built at midnight local is a different UTC
 * day in every positive-offset timezone — the exact shift that once dropped the
 * newest week from a trailing window.
 */
function noonOn(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

type Panel = {
  id: string;
  title: string;
  presentation: string;
  result: { rows: [string, number][]; listRows?: unknown[][]; warnings: string[] };
};

/** Every panel a spec draws, at one instant. */
async function runAt(
  root: string,
  spec: unknown,
  now: Date,
): Promise<Panel[]> {
  const run = await runViewBlocks(root, "financial", spec as never, now);
  assert.equal(run.ok, true, run.ok ? "" : run.error);
  return (run as { ok: true; value: { blocks: Panel[] } }).value.blocks;
}

/** One panel's single number, or null when the panel drew no row. */
async function metricAt(root: string, spec: unknown, now: Date): Promise<number | null> {
  const [panel] = await runAt(root, spec, now);
  const row = panel?.result.rows[0];
  return row ? row[1] : null;
}

describe("live dashboard queries e2e", () => {
  it("moves a date window with the clock and with the rows, and holds a frozen one still", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-live-dashboard-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "E2E Live");
    assert.equal(created.ok, true, created.ok ? "" : created.error);

    const db = await createDatabase(vaultRoot, "financial", { name: "Transactions" });
    assert.equal(db.ok, true, db.ok ? "" : db.error);
    const dbId = (db as { ok: true; value: { id: string } }).value.id;
    for (const column of [
      { name: "date", type: "date" as const },
      { name: "amount", type: "number" as const },
      { name: "payee", type: "text" as const },
    ]) {
      const added = await addDatabaseColumn(vaultRoot, "financial", dbId, column);
      assert.equal(added.ok, true, added.ok ? "" : added.error);
    }
    const live = await getDatabase(vaultRoot, "financial", dbId);
    assert.equal(live.ok, true, live.ok ? "" : live.error);
    const columns = (live as { ok: true; value: { columns: { id: string; name: string }[] } }).value.columns;
    const col = (name: string): string => {
      const found = columns.find((c) => c.name === name);
      assert.ok(found, `column ${name} is missing`);
      return found.id;
    };

    /**
     * Five days of spending. 2026-05-11 is a Monday and 2026-05-17 the Sunday
     * that closes that week, so the `this-week` leg crosses a real boundary
     * rather than landing in the middle of one; 2026-05-13 is the Wednesday the
     * first "today" is taken on. Each amount is a distinct literal, so a window
     * that slipped by a day, or a fold that pooled two days, changes the total
     * instead of landing on the same number.
     */
    const seed = [
      { date: "2026-05-10", amount: 70, payee: "Last Sunday" },
      { date: "2026-05-11", amount: 11, payee: "Monday lunch" },
      { date: "2026-05-13", amount: 13, payee: "Wednesday coffee" },
      { date: "2026-05-14", amount: 14, payee: "Thursday market" },
      { date: "2026-05-18", amount: 18, payee: "Next Monday" },
      { date: "2026-04-20", amount: 20, payee: "Last month" },
    ];
    for (const row of seed) {
      const written = await upsertRow(vaultRoot, "financial", dbId, {
        cells: { [col("date")]: row.date, [col("amount")]: row.amount, [col("payee")]: row.payee },
      });
      assert.equal(written.ok, true, written.ok ? "" : written.error);
    }
    checks.seededRows = seed;

    // ── 1. the vocabulary can say "today" and "this week" ───────────────────
    // This is the teaching surface the model is shown, so a window it cannot
    // name is a window it will freeze by hand instead.
    const windows = VIEW_VOCABULARY.timeWindow as readonly unknown[];
    checks.vocabularyWindows = windows;
    for (const name of ["today", "this-week"]) {
      assert.ok(
        windows.includes(name),
        `the view vocabulary does not offer ${name}: ${JSON.stringify(windows)}`,
      );
    }

    const todaySpec = {
      schemaVersion: 1 as const,
      databaseId: dbId,
      title: "Today's expenses",
      presentation: "metric" as const,
      measure: "sum" as const,
      measureColumnId: col("amount"),
      groupBy: null,
      timeBucket: null,
      timeColumnId: col("date"),
      timeWindow: "today" as const,
      filters: [],
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
    };

    // ── 2. ONE spec, two instants, two answers ──────────────────────────────
    // 2026-05-13 is a Wednesday and 2026-05-14 the Thursday after it, so this
    // is "the same card, the next day" — the movement the operator was missing.
    const wednesday = await metricAt(vaultRoot, todaySpec, noonOn("2026-05-13"));
    const thursday = await metricAt(vaultRoot, todaySpec, noonOn("2026-05-14"));
    checks.todayWindow = { on: "2026-05-13", wednesday, thursday };
    assert.equal(wednesday, 13, `today's total on the Wednesday read ${wednesday}`);
    assert.equal(thursday, 14, `the same card on the Thursday read ${thursday}`);
    assert.notEqual(
      wednesday,
      thursday,
      "a `today` window returned the same number on two different days",
    );

    const weekSpec = { ...todaySpec, title: "This week", timeWindow: "this-week" as const };
    const sunday = await metricAt(vaultRoot, weekSpec, noonOn("2026-05-17"));
    const nextMonday = await metricAt(vaultRoot, weekSpec, noonOn("2026-05-18"));
    checks.thisWeekWindow = { sunday, nextMonday };
    assert.equal(sunday, 38, `the week ending 2026-05-17 totalled ${sunday}, expected 11 + 13 + 14`);
    assert.equal(nextMonday, 18, `the week starting 2026-05-18 totalled ${nextMonday}`);

    // A metric over an empty window is a real zero, not a blank. A day with no
    // spending is the normal case for a "today" card — under the old rule the
    // morning after would have read "No rows in this window." instead of R0.
    const emptyDay = await metricAt(vaultRoot, todaySpec, noonOn("2026-05-20"));
    checks.metricOnEmptyDay = emptyDay;
    assert.equal(emptyDay, 0, `a sum over an empty window read ${JSON.stringify(emptyDay)}, expected 0`);

    // ── 3. the frozen card, held still ──────────────────────────────────────
    // Exactly what the operator's own board was carrying: a literal date in a
    // filter, and an `all` window. It is not broken code — it is a card that
    // cannot move, which is what it looked like from the outside.
    const frozenSpec = {
      ...todaySpec,
      title: "Today's expenses (frozen)",
      timeWindow: "all" as const,
      filters: [{ columnId: col("date"), op: "eq" as const, value: "2026-05-13" }],
    };
    const frozenWednesday = await metricAt(vaultRoot, frozenSpec, noonOn("2026-05-13"));
    const frozenThursday = await metricAt(vaultRoot, frozenSpec, noonOn("2026-05-14"));
    checks.frozenCard = { wednesday: frozenWednesday, thursday: frozenThursday };
    assert.equal(frozenWednesday, 13);
    assert.equal(
      frozenThursday,
      frozenWednesday,
      "the frozen card moved on its own, so this rig is not reproducing the reported bug",
    );

    // ── 4. the same spec, run again after a row is written ──────────────────
    // The "recent transactions" leg: a listing over the ledger, run, then run
    // again once the agent posts an expense. The engine was always live — this
    // is the row the operator never saw because nothing asked it again.
    const listSpec = {
      schemaVersion: 1 as const,
      databaseId: dbId,
      title: "Recent transactions",
      presentation: "list" as const,
      columns: [col("date"), col("payee"), col("amount")],
      timeColumnId: col("date"),
      timeWindow: "all" as const,
      filters: [],
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
    };
    const before = await runAt(vaultRoot, listSpec, noonOn("2026-05-13"));
    const rowsBefore = before[0]!.result.listRows ?? [];
    checks.listRowsBefore = rowsBefore.length;

    const posted = await upsertRow(vaultRoot, "financial", dbId, {
      cells: { [col("date")]: "2026-05-13", [col("amount")]: 25, [col("payee")]: "Weed" },
    });
    assert.equal(posted.ok, true, posted.ok ? "" : posted.error);

    const after = await runAt(vaultRoot, listSpec, noonOn("2026-05-13"));
    const rowsAfter = after[0]!.result.listRows ?? [];
    checks.listRowsAfter = rowsAfter.length;
    checks.listRows = rowsAfter;
    assert.equal(
      rowsAfter.length,
      rowsBefore.length + 1,
      "the listing did not gain the row that was just written",
    );
    // Newest first, by the block's own time column — not by when the row was
    // entered. The row dated furthest ahead leads whatever order it arrived in.
    assert.equal(rowsAfter[0]?.[0], "2026-05-18", `the listing did not lead with the newest date: ${JSON.stringify(rowsAfter[0])}`);
    // And the row the operator just logged is ON the card, with its own figures.
    const logged = rowsAfter.find((row) => row[1] === "Weed");
    checks.listLoggedRow = logged ?? null;
    assert.ok(logged, `the written row is not on the listing: ${JSON.stringify(rowsAfter)}`);
    assert.equal(logged?.[0], "2026-05-13", `the written row's date read ${JSON.stringify(logged?.[0])}`);
    assert.equal(logged?.[2], 25, `the written row's amount read ${JSON.stringify(logged?.[2])}`);

    // ── 5. the repaired card, saved through the real writer ─────────────────
    // What the operator's frozen card is rewritten to: one composed spec whose
    // every panel reads the live window, with no literal date anywhere in it.
    // Each panel states its own measure pair, because a block's measure is
    // deliberately its own rather than inherited from the root.
    const sumAmount = { measure: "sum" as const, measureColumnId: col("amount") };
    const repaired = {
      ...todaySpec,
      presentation: "table" as const,
      groupBy: col("date"),
      blocks: [
        {
          id: "today",
          title: "Today",
          presentation: "metric" as const,
          groupBy: null,
          ...sumAmount,
        },
        {
          id: "by-day",
          title: "By day",
          presentation: "table" as const,
          groupBy: col("date"),
          timeBucket: null,
          ...sumAmount,
        },
      ],
    };
    const saved = await saveView(vaultRoot, "financial", repaired as never);
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
    const savedId = (saved as { ok: true; value: { id: string } }).value.id;
    const file = await getView(vaultRoot, "financial", savedId);
    assert.equal(file.ok, true, file.ok ? "" : file.error);
    const onDisk = (file as { ok: true; value: Record<string, unknown> }).value;
    checks.repairedSpec = {
      timeWindow: onDisk.timeWindow,
      filters: onDisk.filters,
      blocks: Array.isArray(onDisk.blocks)
        ? (onDisk.blocks as Record<string, unknown>[]).map((b) => ({
            id: b.id,
            timeWindow: b.timeWindow,
            filters: b.filters,
          }))
        : null,
    };
    assert.equal(onDisk.timeWindow, "today", "the repaired card did not store a live window");
    const stored = JSON.stringify(onDisk);
    assert.equal(
      /"value":"\d{4}-\d{2}-\d{2}"/.test(stored),
      false,
      `the repaired card still spells a literal date: ${stored}`,
    );

    const savedWednesday = await runSavedView(vaultRoot, "financial", savedId, noonOn("2026-05-13"));
    const savedThursday = await runSavedView(vaultRoot, "financial", savedId, noonOn("2026-05-14"));
    assert.equal(savedWednesday.ok, true, savedWednesday.ok ? "" : savedWednesday.error);
    assert.equal(savedThursday.ok, true, savedThursday.ok ? "" : savedThursday.error);
    const totalsOf = (run: { ok: true; value: { blocks: Panel[] } }): (number | null)[] =>
      run.value.blocks.map((b) => b.result.rows[0]?.[1] ?? null);
    const savedTotals = {
      wednesday: totalsOf(savedWednesday as never),
      thursday: totalsOf(savedThursday as never),
    };
    checks.repairedTotals = savedTotals;
    // The metric and its by-day table agree, and both move with the day: the
    // metric panel is one number, so it says the same thing the table's own
    // total says — and neither is the number it said yesterday.
    assert.deepEqual(savedTotals.wednesday, [38, 38], "the Wednesday draw disagreed with itself");
    assert.deepEqual(savedTotals.thursday, [14, 14], "the Thursday draw disagreed with itself");

    // ── the artifact ────────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what: "a view's date window moves with the clock and with the rows; a literal date does not",
      command: "npm test  (this file: tests/live-dashboard-e2e.test.ts)",
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
