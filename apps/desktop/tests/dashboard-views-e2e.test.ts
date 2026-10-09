import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  addDatabaseColumn,
  createDatabase,
  createVault,
  executeViewTool,
  getDatabase,
  listPinBoard,
  listViews,
  runSavedView,
  runViewBlocks,
  setPins,
  upsertRow,
} from "@lifequest/vault-core";
import { ensureEagerToolSearch } from "../electron/companion-profile.ts";
import { writeCompanionMcpProfile } from "../electron/companion-lifecycle.ts";

/**
 * The dashboard-view chain, end to end, against a real vault on disk.
 *
 * This is one run of the whole product path: the companion's profile is written
 * eager, one composed view is saved through save_view, the saved view is pinned
 * to the Overview board in that same call, and the board reads it back — with
 * the numbers coming out of real rows in a real sqlite file.
 *
 * The LOCKED half of the same call is `dashboard-lock-e2e`'s: this rig holds the
 * unlocked path, where the write lands with no Decision at all.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), which is
 * why it does not need Electron: vault-core's `node:sqlite` is available to
 * Node 24, and the two electron/ modules it imports are pure Node. The render
 * half of the same feature — that ViewCard draws a composed card — is the
 * `view-card` rig, which needs a real layout engine and a dev server.
 *
 * The artifact is `e2e/artifacts/dashboard-views.json`: the same command, the
 * same numbers, no eyeballing. Failures throw, so the artifact only exists for
 * a run that held.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/dashboard-views.json");
const ACTOR = { type: "user", id: "operator", name: "Operator" } as const;

/** ISO date `days` before an ISO date, in UTC arithmetic on a plain date. */
function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of a Date's LOCAL calendar day — the same rule the view uses. */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A tiny YAML reader so a written config can be asserted without a dependency. */
function parseYaml(text: string): Record<string, Record<string, unknown>> {
  const root: Record<string, Record<string, unknown>> = {};
  const stack: { indent: number; node: Record<string, unknown> }[] = [{ indent: -1, node: root }];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = /^([ \t]*)/.exec(raw)![1]!.length;
    const body = raw.trim();
    const colon = body.indexOf(":");
    if (colon < 0) continue;
    const key = body.slice(0, colon);
    const value = body.slice(colon + 1).trim();
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]!.node;
    if (value === "") {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = value;
    }
  }
  return root;
}

describe("dashboard views e2e", () => {
  it("saves and pins a composed weekly summary on the Overview board in one call", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-dashboard-views-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};

    // ── 1. the companion's tool surface is written eager ────────────────────
    // Hermes' progressive tool disclosure defers EVERY MCP tool behind the
    // tool_search bridge, so without this line the companion cannot see
    // preview_view, propose_view, get_dashboard or arrange_dashboard at all.
    const profileDir = path.join(workDir, "hermes", "profiles", "lifequest");
    fs.mkdirSync(profileDir, { recursive: true });
    const configPath = path.join(profileDir, "config.yaml");
    // The operator's own profile: an unrelated top-level key, and a sibling
    // under the same `tools:` block that must not be swallowed or reparented.
    const original = [
      "mcp_servers:",
      "  lifequest:",
      "    url: http://127.0.0.1:8643/mcp",
      "    headers:",
      "      Authorization: Bearer TESTTOKEN",
      "model:",
      "  default: some-model",
      "tools:",
      "  connectors:",
      "    enabled: true",
      "agent:",
      "  reasoning_effort: medium",
      "",
    ].join("\n");
    fs.writeFileSync(configPath, original);

    const io = {
      readFile: async (p: string) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw e;
        }
      },
      writeFile: async (p: string, body: string) => {
        fs.writeFileSync(p, body, "utf8");
      },
    };

    // Written BEFORE a vault token exists: the tool-surface line must not wait
    // on a credential, or a companion opened before its vault stays blind.
    await writeCompanionMcpProfile(io, configPath, null, null);
    const afterEager = parseYaml(fs.readFileSync(configPath, "utf8"));
    checks.profileEagerWithoutToken = (afterEager.tools?.tool_search as Record<string, unknown> | undefined)?.enabled ?? null;
    assert.equal(
      checks.profileEagerWithoutToken,
      "off",
      "the profile must be written with tools.tool_search.enabled: off, or Hermes hides every LifeQuest tool",
    );

    const once = fs.readFileSync(configPath, "utf8");
    await writeCompanionMcpProfile(io, configPath, "TESTTOKEN", null);
    const twice = fs.readFileSync(configPath, "utf8");
    const parsed = parseYaml(twice);
    assert.equal(once, twice, "re-running the profile writer must not change the file");
    assert.equal((parsed.model as Record<string, unknown>).default, "some-model");
    assert.equal(
      (parsed.tools?.connectors as Record<string, unknown> | undefined)?.enabled,
      "true",
      "the operator's sibling tools.connectors block was reparented",
    );
    assert.equal((parsed.agent as Record<string, unknown>).reasoning_effort, "medium");
    assert.equal(
      ((parsed.mcp_servers?.lifequest as Record<string, unknown>)?.headers as Record<string, unknown>)?.Authorization,
      "Bearer TESTTOKEN",
    );
    checks.profileAfter = twice;
    checks.eagerWriterDirect = ensureEagerToolSearch(original);

    // ── 2. a real vault with one row per week for five weeks ────────────────
    // The run instant is 22:30 LOCAL. In a positive UTC offset that is already
    // the next day in UTC, which is exactly where a UTC "today" shifts the
    // trailing window and drops the newest week.
    const runAt = new Date();
    runAt.setHours(22, 30, 0, 0);
    const today = localIso(runAt);
    const utcToday = runAt.toISOString().slice(0, 10);
    checks.clock = { localToday: today, utcToday, exposesUtcBug: today !== utcToday };

    const created = await createVault(vaultRoot, "E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);

    const db = await createDatabase(vaultRoot, "financial", { name: "Transactions" });
    assert.equal(db.ok, true, `createDatabase failed: ${db.ok ? "" : db.error}`);
    const dbId = (db as { ok: true; value: { id: string } }).value.id;
    for (const col of [
      { name: "date", type: "date" as const },
      { name: "amount", type: "number" as const },
      { name: "category", type: "select" as const, options: ["Groceries", "Transport", "Home"] },
    ]) {
      const added = await addDatabaseColumn(vaultRoot, "financial", dbId, col);
      assert.equal(added.ok, true, `addDatabaseColumn(${col.name}) failed: ${added.ok ? "" : added.error}`);
    }
    const live = await getDatabase(vaultRoot, "financial", dbId);
    assert.equal(live.ok, true, `getDatabase failed: ${live.ok ? "" : live.error}`);
    const columns = (live as { ok: true; value: { columns: { id: string; name: string }[] } }).value.columns;
    const col = (name: string): string => {
      const found = columns.find((c) => c.name === name);
      assert.ok(found, `column ${name} is missing`);
      return found.id;
    };

    // One row per week, each week's total a distinct literal, so a bucketing
    // slip moves a number between weeks instead of landing on the same total.
    const amounts = [1111, 1114, 1148, 1265, 2390.34];
    const dates = [28, 21, 14, 7, 0].map((back) => daysBefore(today, back));
    const categories = ["Groceries", "Transport", "Home", "Groceries", "Home"];
    for (let i = 0; i < amounts.length; i += 1) {
      const row = await upsertRow(vaultRoot, "financial", dbId, {
        cells: {
          [col("date")]: dates[i],
          [col("amount")]: amounts[i],
          [col("category")]: categories[i],
        },
      });
      assert.equal(row.ok, true, `upsertRow ${i} failed: ${row.ok ? "" : row.error}`);
    }
    checks.rowsSeeded = amounts.length;

    // ── 3. the composed spec the companion is asked for ─────────────────────
    // The root query fields are the defaults every block inherits: the database
    // column, the week bucket, the trailing window, the sort. Each block then
    // states what it measures and how it draws — a panel always names its own
    // measure, because a metric panel that inherited the root's measure column
    // would be a number column on a one-number card.
    const shared = {
      groupBy: col("date"),
      timeBucket: "week" as const,
      timeColumnId: col("date"),
      timeWindow: { kind: "last-weeks" as const, weeks: 5 },
      filters: [],
      sort: { by: "label" as const, dir: "asc" as const },
      limit: 12,
      convertToZar: false,
    };
    const sumAmount = { measure: "sum" as const, measureColumnId: col("amount") };
    const spec = {
      schemaVersion: 1 as const,
      databaseId: dbId,
      title: "Weekly expenses",
      presentation: "table" as const,
      ...shared,
      ...sumAmount,
      // Root query fields are the first block's defaults. The metric panel
      // overrides groupBy to null so it collapses to a single number.
      blocks: [
        { id: "total", title: "Last 5 weeks", presentation: "metric" as const, groupBy: null, ...sumAmount },
        { id: "weeks", title: "Week by week", presentation: "table" as const, ...sumAmount },
        { id: "trend", title: "Trend", presentation: "bar" as const, span: 2 as const, ...sumAmount },
      ],
    };
    checks.spec = spec;

    // ── 4. it runs: three panels, week buckets, on the LOCAL day ────────────
    const run = await runViewBlocks(vaultRoot, "financial", spec as never, runAt);
    assert.equal(run.ok, true, `runViewBlocks failed: ${run.ok ? "" : run.error}`);
    const panels = (run as { ok: true; value: { blocks: { id: string; title: string; presentation: string; span?: number; result: { rows: [string, number][]; currency: string | null } }[] } }).value.blocks;
    checks.panels = panels.map((p) => ({
      id: p.id,
      title: p.title,
      presentation: p.presentation,
      span: p.span ?? null,
      rows: p.result.rows,
      currency: p.result.currency,
    }));

    assert.equal(panels.length, 3, `the composed view ran ${panels.length} panels, expected 3`);
    assert.deepEqual(
      panels.map((p) => p.title),
      ["Last 5 weeks", "Week by week", "Trend"],
      "panels must keep block order",
    );
    const [total, weeks, trend] = panels;
    assert.equal(total!.result.rows.length, 1, "a metric panel is one number");
    const expectedTotal = amounts.reduce((a, b) => a + b, 0);
    assert.ok(
      Math.abs(total!.result.rows[0]![1] - expectedTotal) < 0.001,
      `the metric panel totalled ${total!.result.rows[0]![1]}, expected ${expectedTotal}`,
    );
    // The window is "the last 5 Monday-start weeks", so all five rows are in it.
    // Under a UTC `today` this is 4 — the newest week falls outside the window.
    assert.equal(
      weeks!.result.rows.length,
      5,
      `the table panel returned ${weeks!.result.rows.length} weeks, expected 5` +
        (checks.clock.exposesUtcBug ? " (a UTC `today` drops the newest week at this instant)" : ""),
    );
    const weekLabels = weeks!.result.rows.map(([label]) => label);
    checks.weekLabels = weekLabels;
    for (const label of weekLabels) {
      assert.match(label, /^\d{4}-W\d{2}$/, `week label ${label} is not an ISO week`);
    }
    for (let i = 1; i < weekLabels.length; i += 1) {
      assert.ok(weekLabels[i - 1]! < weekLabels[i]!, `week labels are not ascending: ${weekLabels.join(", ")}`);
    }
    const weekValues = weeks!.result.rows.map(([, v]) => v).sort((a, b) => a - b);
    checks.weekValues = weekValues;
    assert.deepEqual(
      weekValues,
      [...amounts].sort((a, b) => a - b),
      "each week's bucket must hold exactly one week's amount",
    );
    assert.equal(trend!.result.rows.length, 5, `the trend panel returned ${trend!.result.rows.length} points`);
    assert.equal(trend!.span, 2, `the trend panel span read ${trend!.span}, expected 2`);

    // KAR-71: a windowed block with no timeColumnId is refused rather than
    // silently ignored — otherwise a "last 5 weeks" card quietly shows all time.
    const noTimeColumn = await runViewBlocks(
      vaultRoot,
      "financial",
      { ...spec, blocks: undefined, timeColumnId: null } as never,
      runAt,
    );
    checks.windowWithoutTimeColumn = noTimeColumn.ok ? "ran" : noTimeColumn.error;
    assert.equal(noTimeColumn.ok, false, "a timeWindow without a timeColumnId must be refused");

    // ── 5. one save_view call: the card is saved AND on the board ───────────
    const before = await listViews(vaultRoot, "financial");
    assert.equal(before.ok, true, `listViews failed: ${before.ok ? "" : before.error}`);
    checks.viewsBefore = (before as { ok: true; value: unknown[] }).value.length;
    const boardBefore = await listPinBoard(vaultRoot, null);
    assert.equal(boardBefore.ok, true, `listPinBoard failed: ${boardBefore.ok ? "" : boardBefore.error}`);
    checks.overviewLocked = (boardBefore as { ok: true; value: { locked: boolean } }).value.locked;
    assert.equal(checks.overviewLocked, false, "a fresh Overview board must start unlocked");

    const preview = (await executeViewTool(vaultRoot, ACTOR, "preview_view", {
      domainSlug: "financial",
      spec,
    })) as { blocks?: unknown[]; error?: { message: string } };
    checks.previewPanelCount = preview.blocks?.length ?? 0;
    assert.equal(preview.error, undefined, `preview_view failed: ${preview.error?.message}`);
    assert.equal(preview.blocks?.length, 3, `preview_view returned ${preview.blocks?.length} panels`);

    // One call, one card. This replaced propose -> approve -> arrange, a chain
    // that could strand a saved-but-unpinned view and that made the companion
    // wait on an approval it could not see.
    const saved = (await executeViewTool(vaultRoot, ACTOR, "save_view", {
      domainSlug: "financial",
      boardSlug: null,
      spec,
      span: 2,
    })) as {
      applied?: boolean;
      proposed?: boolean;
      viewId?: string;
      boardSlug?: string | null;
      error?: { message: string };
    };
    checks.saveView = saved;
    assert.equal(saved.error, undefined, `save_view failed: ${saved.error?.message}`);
    assert.equal(saved.applied, true, `save_view did not apply on an unlocked board: ${JSON.stringify(saved)}`);
    assert.equal(saved.proposed, undefined, "save_view filed a Decision on an unlocked board");
    assert.ok(saved.viewId, "save_view returned no view id");

    const after = await listViews(vaultRoot, "financial");
    assert.equal(after.ok, true);
    const savedView = (after as { ok: true; value: { id: string; title: string; blocks?: unknown[] }[] }).value.find(
      (v) => v.id === saved.viewId,
    );
    assert.ok(savedView, "save_view did not write the view file");
    assert.equal(savedView.blocks?.length, 3, `the saved view carries ${savedView.blocks?.length} blocks, expected 3`);
    checks.savedView = { id: savedView.id, title: savedView.title, blocks: savedView.blocks?.length ?? 0 };

    // The saved file must run exactly as the preview did: same path, same rows.
    const savedRun = await runSavedView(vaultRoot, "financial", savedView.id, runAt);
    assert.equal(savedRun.ok, true, `runSavedView failed: ${savedRun.ok ? "" : savedRun.error}`);
    const savedCounts = (savedRun as { ok: true; value: { blocks: { result: { rows: unknown[] } }[] } }).value.blocks.map(
      (b) => b.result.rows.length,
    );
    checks.savedRunPanelRows = savedCounts;
    assert.deepEqual(savedCounts, [1, 5, 5], `the saved view ran as ${JSON.stringify(savedCounts)}`);

    // ── 6. a financial view pins onto the OVERVIEW board ────────────────────
    // This is the write/read agreement that made "a weekly summary on the
    // Dashboard" impossible: the read path always allowed a cross-domain view
    // on Overview, and the write path refused it. save_view pins as part of the
    // same call, so this is checked against the board the call reported.
    const readBack = await listPinBoard(vaultRoot, null);
    assert.equal(readBack.ok, true);
    const back = (readBack as { ok: true; value: { pins: { kind: string; viewId?: string; domainSlug?: string; span?: number }[] } }).value.pins.find(
      (p) => p.kind === "view" && p.viewId === savedView.id,
    );
    assert.ok(back, "the saved view was not pinned to the Overview board");
    assert.equal(back.domainSlug, "financial", "the Overview pin lost the domain that owns the view");
    assert.equal(back.span, 2, `the Overview pin lost its span: ${back.span}`);
    checks.overviewPin = back;

    // The rule stayed narrow: a domain board still refuses another's view.
    const pin = { id: `view:financial:${savedView.id}`, kind: "view" as const, domainSlug: "financial", viewId: savedView.id, span: 2 as const };
    const foreign = await setPins(vaultRoot, "health", [pin], ACTOR);
    checks.foreignViewOnDomainBoard = foreign.ok ? "accepted" : foreign.error;
    assert.equal(foreign.ok, false, "a financial view was accepted onto the health board");

    // ── the artifact ────────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what: "one save_view call saves a composed weekly summary and pins it on the Overview board",
      command: "npm test  (this file: tests/dashboard-views-e2e.test.ts)",
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
