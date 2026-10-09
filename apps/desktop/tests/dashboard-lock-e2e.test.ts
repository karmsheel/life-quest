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
  isPinBoardLocked,
  listDecisions,
  listPinBoard,
  listViews,
  resolveDecision,
  runSavedView,
  setPinBoardLocked,
  upsertRow,
} from "@lifequest/vault-core";

/**
 * The Dashboard PAGE LOCK, end to end, against a real vault on disk.
 *
 * This is the whole product rule in one run, with the companion's own tool
 * calls as the actor:
 *
 *   1. UNLOCKED — one save_view call puts a composed weekly summary on the
 *      Overview board. Nothing is queued, no approval is needed, and the card
 *      is on the board when the call returns.
 *   2. The companion cannot lock or unlock anything (user-only toggle), so an
 *      agent can never open the gate it is supposed to be stopped by.
 *   3. LOCKED — the SAME write files exactly one pending Decision: the board is
 *      byte-for-byte unchanged until the operator approves.
 *   4. Approval saves the view AND pins it, and leaves the board locked. An
 *      approved change is the consent the lock was waiting for; it must not be
 *      a back door that silently unlocks the page.
 *   5. The lock is per board. A locked Overview does not freeze a domain's own
 *      dashboard, because the operator locked the page they were looking at.
 *
 * The artifact is `e2e/artifacts/dashboard-lock.json`: the same vault, the same
 * rows, and the summary table the run actually produced — including the
 * before/after board state for each step, so the lock's effect is a fact in the
 * file rather than something a reader has to trust.
 *
 * Runs under `npm test` (`node --experimental-strip-types --test`), which needs
 * no Electron: vault-core's `node:sqlite` is available to Node, and the render
 * half of the same feature is the `dashboard-lock-ui` Electron rig.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/dashboard-lock.json");

/** The companion's actor, exactly as the MCP door passes it. */
const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;
const USER = { type: "user" } as const;

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

describe("dashboard page lock e2e", () => {
  it("applies a summary table when unlocked and files one Decision when locked", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-dashboard-lock-"));
    const vaultRoot = path.join(workDir, "vault");
    const checks: Record<string, unknown> = {};
    /** Every step, in order, with the board as it stood on either side. */
    const transcript: Array<Record<string, unknown>> = [];

    // ── a real vault, one row per week for five weeks ───────────────────────
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
    const columns = (live as { ok: true; value: { id: string; name: string }[] }).value.columns;
    const col = (name: string): string => {
      const found = columns.find((c) => c.name === name);
      assert.ok(found, `column ${name} is missing`);
      return found.id;
    };

    const today = localIso(new Date());
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

    // ── the composed "weekly summary" spec the operator asked for ───────────
    // A metric headline and the week-by-week table in one card: the shape the
    // companion is told to reach for when a "summary" needs more than one
    // figure. `presentation: table` is what makes the card a TABLE.
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
      blocks: [
        { id: "total", title: "Last 5 weeks", presentation: "metric" as const, groupBy: null, ...sumAmount },
        { id: "weeks", title: "Week by week", presentation: "table" as const, ...sumAmount },
      ],
    };
    checks.spec = { title: spec.title, presentation: spec.presentation, blocks: spec.blocks.length };

    const boardOf = async (slug: string | null) => {
      const res = await listPinBoard(vaultRoot, slug);
      assert.equal(res.ok, true, `listPinBoard failed: ${res.ok ? "" : res.error}`);
      return (res as { ok: true; value: { pins: { id: string }[]; locked: boolean } }).value;
    };

    // ── 1. the board starts unlocked ────────────────────────────────────────
    const start = await boardOf(null);
    checks.startsUnlocked = start.locked === false;
    checks.startPins = start.pins.map((p) => p.id);
    transcript.push({ step: "start", board: { locked: start.locked, pins: checks.startPins } });
    assert.equal(start.locked, false, "a board with no lock file must read as unlocked");

    // ── 2. UNLOCKED: one save_view call puts the table on the board ─────────
    const preview = (await executeViewTool(vaultRoot, COMPANION, "preview_view", {
      domainSlug: "financial",
      spec,
      boardSlug: null,
    })) as { blocks?: unknown[]; board?: { locked?: boolean } };
    assert.equal(
      (preview as { error?: unknown }).error,
      undefined,
      `preview_view failed: ${JSON.stringify((preview as { error?: unknown }).error)}`,
    );
    checks.previewBlocks = preview.blocks?.length ?? 0;
    checks.previewSaysUnlocked = preview.board?.locked === false;

    const applied = (await executeViewTool(vaultRoot, COMPANION, "save_view", {
      domainSlug: "financial",
      boardSlug: null,
      spec,
      span: 2,
    })) as {
      applied?: boolean;
      proposed?: boolean;
      locked?: boolean;
      viewId?: string;
      note?: string;
    };
    checks.unlockedCall = applied;
    assert.equal(applied.applied, true, `save_view on an unlocked board did not apply: ${JSON.stringify(applied)}`);
    assert.equal(applied.proposed, undefined, "an unlocked save must not file a Decision");
    assert.ok(applied.viewId, "save_view returned no view id");

    const afterApply = await boardOf(null);
    transcript.push({ step: "save_view while unlocked", board: { locked: afterApply.locked, pins: afterApply.pins.map((p) => p.id) } });
    const pinned = afterApply.pins.find(
      (p) => (p as { viewId?: string }).viewId === applied.viewId,
    ) as { domainSlug?: string; span?: number } | undefined;
    assert.ok(pinned, "the saved card is not on the Overview board");
    assert.equal(pinned.domainSlug, "financial", "the Overview pin lost the domain that owns the view");
    assert.equal(pinned.span, 2, "the pinned card lost its span");

    // Nothing was queued: the change really did land.
    const pendingAfterApply = await listDecisions(vaultRoot);
    const pendingUnlocked = ((pendingAfterApply as { ok: true; value: { status: string }[] }).value ?? [])
      .filter((d) => d.status === "pending").length;
    checks.pendingAfterUnlockedWrite = pendingUnlocked;
    assert.equal(pendingUnlocked, 0, "an unlocked write filed a Decision anyway");

    // And the card draws the summary TABLE the artifact names.
    const savedRun = await runSavedView(vaultRoot, "financial", applied.viewId!, new Date());
    assert.equal(savedRun.ok, true, `runSavedView failed: ${savedRun.ok ? "" : savedRun.error}`);
    const blocks = (savedRun as {
      ok: true;
      value: { blocks: { title: string; presentation: string; result: { rows: [string, number][]; currency: string | null } }[] };
    }).value.blocks;
    const table = blocks.find((b) => b.presentation === "table");
    assert.ok(table, "the saved card has no table panel");
    checks.summaryTable = {
      title: spec.title,
      panel: table.title,
      columns: ["label", "value"],
      rows: table.result.rows,
      currency: table.result.currency,
    };
    checks.summaryTotal = blocks.find((b) => b.presentation === "metric")?.result.rows[0]?.[1] ?? null;
    assert.equal(table.result.rows.length, 5, `the summary table drew ${table.result.rows.length} weeks`);
    assert.ok(
      Math.abs(
        (checks.summaryTotal as number) - amounts.reduce((a, b) => a + b, 0),
      ) < 0.001,
      `the metric panel read ${checks.summaryTotal}`,
    );

    // ── 3. the companion cannot lock or unlock any board ────────────────────
    const agentLock = await setPinBoardLocked(vaultRoot, null, true, COMPANION);
    checks.agentLockRefused = agentLock.ok ? "accepted" : agentLock.error;
    assert.equal(agentLock.ok, false, "a companion was allowed to lock a dashboard");
    assert.equal(await isPinBoardLocked(vaultRoot, null), false, "the refused lock still changed the file");

    // ── 4. the operator locks the board ─────────────────────────────────────
    const locked = await setPinBoardLocked(vaultRoot, null, true, USER);
    assert.equal(locked.ok, true, `locking failed: ${locked.ok ? "" : locked.error}`);
    checks.userHideLock = { ok: true, locked: (locked as { ok: true; value: { locked: boolean } }).value.locked };
    const boardWhenLocked = await boardOf(null);
    transcript.push({ step: "operator locks Overview", board: { locked: boardWhenLocked.locked, pins: boardWhenLocked.pins.map((p) => p.id) } });
    assert.equal(boardWhenLocked.locked, true, "the lock did not persist");

    // ── 5. LOCKED: the same save_view call files ONE Decision ───────────────
    const lockedSpec = { ...spec, title: "Weekly expenses (locked board)" };
    const beforeLockedWrite = await boardOf(null);
    const proposed = (await executeViewTool(vaultRoot, COMPANION, "save_view", {
      domainSlug: "financial",
      boardSlug: null,
      spec: lockedSpec,
      span: 2,
    })) as { proposed?: boolean; applied?: boolean; decisionId?: string; locked?: boolean };
    checks.lockedCall = proposed;
    assert.equal(proposed.proposed, true, `save_view on a locked board did not propose: ${JSON.stringify(proposed)}`);
    assert.equal(proposed.applied, undefined, "a locked save applied a write");
    assert.ok(proposed.decisionId, "the locked save filed no Decision");

    const afterLockedWrite = await boardOf(null);
    transcript.push({ step: "save_view while locked", board: { locked: afterLockedWrite.locked, pins: afterLockedWrite.pins.map((p) => p.id) } });
    assert.deepEqual(
      afterLockedWrite.pins.map((p) => p.id),
      beforeLockedWrite.pins.map((p) => p.id),
      "a locked board changed before the Decision was approved",
    );
    const viewsBeforeApprove = await listViews(vaultRoot, "financial");
    const lockedTitleSaved = ((viewsBeforeApprove as { ok: true; value: { title: string }[] }).value ?? [])
      .some((v) => v.title === lockedSpec.title);
    checks.lockedSpecSavedBeforeApprove = lockedTitleSaved;
    assert.equal(lockedTitleSaved, false, "a locked save wrote the view file before approval");

    // The Decision names the board and carries the pin, so approval completes
    // the whole request instead of leaving a saved-but-invisible card.
    const decisions = await listDecisions(vaultRoot);
    const decision = ((decisions as { ok: true; value: { id: string; target: unknown; proposedBodyMarkdown: string }[] }).value ?? [])
      .find((d) => d.id === proposed.decisionId);
    assert.ok(decision, "the filed Decision could not be read back");
    const body = JSON.parse(decision.proposedBodyMarkdown) as {
      op?: string;
      boardSlug?: string | null;
      span?: number;
      spec?: { title?: string };
    };
    checks.decisionBody = { op: body.op, boardSlug: body.boardSlug, span: body.span, title: body.spec?.title };
    assert.equal(body.op, "save-view", "the Decision body is not a save-view op");
    assert.equal(body.boardSlug, null, "the Decision lost the board it pins to");
    assert.equal(body.span, 2, "the Decision lost the card's span");

    // ── 6. an arrange on a locked board is gated too ────────────────────────
    const pinIds = (await boardOf(null)).pins.map((p) => p.id);
    const rearranged = (await executeViewTool(vaultRoot, COMPANION, "arrange_dashboard", {
      domainSlug: null,
      // Reverse the board: a change that is visible if it lands.
      pins: [...(await boardOf(null)).pins].reverse(),
    })) as { proposed?: boolean; applied?: boolean; decisionId?: string };
    checks.lockedArrange = rearranged;
    assert.equal(rearranged.proposed, true, "arrange_dashboard wrote a locked board");
    assert.deepEqual(
      (await boardOf(null)).pins.map((p) => p.id),
      pinIds,
      "the locked board moved before the arrange Decision was approved",
    );

    // ── 7. approval saves the view AND pins it, and keeps the lock ──────────
    const approved = await resolveDecision(vaultRoot, proposed.decisionId!, "approved");
    assert.equal(approved.ok, true, `approving failed: ${approved.ok ? "" : approved.error}`);
    const finalBoard = await boardOf(null);
    transcript.push({ step: "operator approves the save", board: { locked: finalBoard.locked, pins: finalBoard.pins.map((p) => p.id) } });
    checks.approvedKeepsLock = finalBoard.locked;
    assert.equal(finalBoard.locked, true, "approving a change unlocked the page");
    const savedByApproval = ((await listViews(vaultRoot, "financial")) as { ok: true; value: { id: string; title: string }[] }).value
      .find((v) => v.title === lockedSpec.title);
    assert.ok(savedByApproval, "approving the Decision did not save the view");
    const approvalPin = finalBoard.pins.find(
      (p) => (p as { viewId?: string }).viewId === savedByApproval.id,
    ) as { span?: number } | undefined;
    assert.ok(approvalPin, "approving the Decision did not pin the view");
    assert.equal(approvalPin.span, 2, "the approved pin lost its span");
    checks.approved = { viewId: savedByApproval.id, pinned: true, span: approvalPin.span };

    // ── 8. the lock is per board, not vault-wide ────────────────────────────
    const domainBoardLocked = await isPinBoardLocked(vaultRoot, "financial");
    checks.domainBoardStillUnlocked = domainBoardLocked === false;
    assert.equal(domainBoardLocked, false, "locking Overview locked the financial board too");
    const domainWrite = (await executeViewTool(vaultRoot, COMPANION, "save_view", {
      domainSlug: "financial",
      boardSlug: "financial",
      spec: { ...spec, title: "Financial board card" },
    })) as { applied?: boolean; proposed?: boolean };
    checks.domainWrite = domainWrite;
    assert.equal(
      domainWrite.applied,
      true,
      `a locked Overview blocked an unlocked domain board: ${JSON.stringify(domainWrite)}`,
    );

    // ── the artifact ────────────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: true,
      what: "the Dashboard page lock: save_view applies on an unlocked board and files one Decision on a locked one",
      command: "npm test  (this file: tests/dashboard-lock-e2e.test.ts)",
      checks,
      transcript,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
