import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  applyFinanceKitInstall,
  createVault,
  getDatabase,
  getView,
  listPinBoard,
  listViews,
  runSavedView,
  upsertRow,
} from "@lifequest/vault-core";
import { startPairingDoors } from "../electron/pairing-door.ts";
import { ensureCompanionToken } from "../electron/pairing-secrets.ts";

/**
 * "A summary table on the Financial Dashboard for the recent transactions" —
 * end to end, over the REAL MCP door, and then drawn by the real ViewCard.
 *
 * WHY THIS FILE EXISTS
 *
 * A card could only ever show a FOLD of the rows: `table`, `bar`, `line` and
 * `metric` all collapse whatever the query matched into label/value groups, so
 * "the recent transactions" had no expression in the spec language at all. The
 * companion asked for a table of rows, got a table of totals, and there was no
 * field it could have sent to say otherwise — the vocabulary itself was short.
 * The `list` presentation is that missing word, and this rig is the claim that
 * it works: a real finance kit, a real vault, the real tool, and the real card.
 *
 * THE WAYS THIS PATH COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 *   1. Rows come back folded — one line per day or per category instead of one
 *      per transaction — which is the whole bug the feature exists to fix.
 *   2. The order is not "recent": the oldest transaction leads, so the card is a
 *      history rather than a summary of what just happened.
 *   3. The window is ignored, so a transaction from last year sits on a card
 *      that claims to show the last eight weeks.
 *   4. The block inherits an aggregate's `groupBy` from the card's root fields
 *      (the shape the operator's own "Spending by month" card uses) and is then
 *      refused, so the one card they can already see cannot host a listing.
 *   5. A relation prints the uuid of the row it points at instead of its name,
 *      so the operator reads a ledger of hex.
 *   6. Money is misreported: a USD row is shown as bare ZAR, or the currency
 *      unit lands on the wrong column, or the card claims a single currency for
 *      rows that do not share one.
 *   7. `columns` is inert on an aggregate, so a spec that meant "list" and said
 *      "table" saves a card that silently draws totals.
 *   8. A refusal names the rule but not the fix, so the companion spends the
 *      turn discovering the vocabulary — the failure the tool replies exist for.
 *   9. The card is saved but not pinned, or pinned to a board the read path will
 *      not show it on.
 *  10. The engine returns the rows and the renderer draws something else: a
 *      different order, a lost column, or the aggregate table's "everything
 *      after the first cell is money" alignment applied to a payee.
 *  11. A refused spec still leaves a file behind, so the operator's board
 *      collects cards nobody asked for.
 *
 * It runs under `npm test` (`node --experimental-strip-types --test`), which
 * needs no Electron: `pairing-door.ts` imports no Electron module. The door
 * binds test ports (18_753 / 18_756) so the operator's running LifeQuest, which
 * holds 8643 and 8646, is neither disturbed nor consulted.
 *
 * The artifacts are `e2e/artifacts/view-list.json` — the card the vault saved,
 * the run the engine gave back, and the board it landed on — and, from the
 * second case below, `e2e/artifacts/view-list.png`: the card as ViewCard draws
 * it, at 1:1 in a real layout engine.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/view-list.json");
const RIG_REPORT = path.join(desktopRoot, "e2e/artifacts/view-list-rig.json");
const RIG_SHOT = path.join(desktopRoot, "e2e/artifacts/view-list.png");

/** Test ports. The card rig holds 18_743 / 18_746; the app holds 8643 / 8646. */
const LOCAL_PORT = 18_753;
const INVITE_PORT = 18_756;
const DEV_PORT = 5173;

/** The finance kit's own ids, as `applyFinanceKitInstall` creates them. */
const TRANSACTIONS = "finance:transactions";

const require = createRequire(import.meta.url);
const electron = require("electron") as string;

type Auth = { bearer?: string };
type Reply = { status: number; json: unknown; raw: string };

/**
 * One JSON-RPC call to the door. `Accept` asks for both shapes the Streamable
 * HTTP transport may answer with; a served call comes back as one `data:` frame.
 */
async function mcp(auth: Auth, method: string, params: unknown = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (auth.bearer !== undefined) headers.authorization = `Bearer ${auth.bearer}`;
  const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await res.text();
  const frame = raw.split("\n").find((line) => line.startsWith("data: "));
  let json: unknown;
  try {
    json = JSON.parse(frame ? frame.slice(6) : raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

/** One tool call, with the tool's own JSON answer unwrapped. */
async function callTool(
  auth: Auth,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const reply = await mcp(auth, "tools/call", { name, arguments: args });
  const text = (reply.json as { result?: { content?: { text?: string }[] } } | undefined)?.result
    ?.content?.[0]?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

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

type ListBlock = {
  id: string;
  presentation: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  rowCount: number;
  currency: string | null;
};

/**
 * One block as `runViewBlocks` returns it: the ident, and the run ITSELF under
 * `result`. The tool reply flattens these onto the block, so a reader that
 * learned the shape from `preview_view` looks for `rows` in the wrong place —
 * which is exactly the mistake this type exists to stop.
 */
type RunBlock = {
  id: string;
  presentation: string;
  result: {
    columns: string[];
    rows: Array<[string, number]>;
    listRows?: Array<Array<string | number>>;
    warnings: string[];
    currency: string | null;
  };
};

type SavedCard = {
  applied?: boolean;
  updated?: boolean;
  viewId?: string;
  boardSlug?: string | null;
  span?: number;
  card?: { blocks: ListBlock[] };
  error?: { message?: string; fix?: { workingSpecs?: { list?: { columns?: string[] } } } };
};

/**
 * One panel of a saved card's run, the panel's own warnings, and the run.
 *
 * `blockId` picks a panel of a composed card; without it the card must be a
 * single panel, because "the rows" is then unambiguous and a card that quietly
 * grew a second panel should fail rather than be averaged over.
 */
async function runCard(
  root: string,
  viewId: string,
  blockId?: string,
): Promise<{ block: ListBlock; warnings: string[]; raw: unknown }> {
  const run = await runSavedView(root, "financial", viewId);
  assert.equal(run.ok, true, `runSavedView failed: ${run.ok ? "" : run.error}`);
  const value = (run as { ok: true; value: { blocks: RunBlock[]; warnings: string[] } }).value;
  const panel = blockId
    ? value.blocks.find((b) => b.id === blockId)
    : value.blocks.length === 1
      ? value.blocks[0]
      : undefined;
  assert.ok(
    panel,
    blockId
      ? `the card has no panel "${blockId}"`
      : `the card drew ${value.blocks.length} panels, expected one`,
  );
  const run1 = panel.result;
  // A listing's lines are in `listRows`; an aggregate's groups are in `rows`, and
  // exactly one of the two is ever filled. Taking whichever is there serves both
  // shapes — and reading only the first is how a card with nine lines of ledger
  // looks empty.
  const rows = (run1.listRows ?? run1.rows) as Array<Array<string | number>>;
  return {
    block: {
      id: panel.id,
      presentation: panel.presentation,
      columns: run1.columns,
      rows,
      rowCount: rows.length,
      currency: run1.currency,
    },
    warnings: run1.warnings,
    raw: value,
  };
}

describe("recent transactions listing e2e", () => {
  it("puts one line per transaction on the financial dashboard, newest first", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-view-list-"));
    const vaultRoot = path.join(workDir, "vault");
    const secretsDir = path.join(workDir, "userData", "pairing-secrets");
    fs.mkdirSync(secretsDir, { recursive: true });

    const checks: Record<string, unknown> = {};

    const created = await createVault(vaultRoot, "E2E");
    assert.equal(created.ok, true, `createVault failed: ${created.ok ? "" : created.error}`);
    const vaultId = (created as { ok: true; value: { lifequest: { id: string } } }).value.lifequest.id;

    // ── a real finance kit, with a ledger in it ──────────────────────────────
    const kit = await applyFinanceKitInstall(vaultRoot);
    assert.equal(kit.ok, true, `applyFinanceKitInstall failed: ${kit.ok ? "" : kit.error}`);

    const runAt = new Date();
    runAt.setHours(22, 30, 0, 0);
    const today = localIso(runAt);

    async function seed(dbId: string, cells: Record<string, unknown>): Promise<string> {
      const row = await upsertRow(vaultRoot, "financial", dbId, { cells });
      assert.equal(row.ok, true, `upsert into ${dbId} failed: ${row.ok ? "" : row.error}`);
      return (row as { ok: true; value: { id: string } }).value.id;
    }

    const groceries = await seed("finance:categories", { name: "Groceries" });
    const transport = await seed("finance:categories", { name: "Transport" });
    const cheque = await seed("finance:accounts", {
      name: "Cheque",
      type: "checking",
      currency: "ZAR",
      opening_balance: 0,
      opening_as_of: daysBefore(today, 120),
    });
    const travelCard = await seed("finance:accounts", {
      name: "Travel card",
      type: "credit",
      currency: "USD",
      opening_balance: 0,
      opening_as_of: daysBefore(today, 120),
    });

    // Nine recent transactions, one per day, each a distinct literal: a row that
    // is dropped, doubled, or folded into a neighbour moves a number that is
    // visible in the card rather than a total that could still look right.
    const RECENT = 9;
    for (let i = 1; i <= RECENT; i += 1) {
      await seed(TRANSACTIONS, {
        date: daysBefore(today, i),
        amount: -(100 + i),
        account: cheque,
        category: i % 2 === 0 ? groceries : transport,
        payee: `Payee ${i}`,
      });
    }
    // And one from long before the window, which the window must exclude.
    await seed(TRANSACTIONS, {
      date: daysBefore(today, 200),
      amount: -9999,
      account: cheque,
      category: groceries,
      payee: "Ancient",
    });
    checks.rowsSeeded = { recent: RECENT, old: 1 };

    const window = { kind: "last-weeks", weeks: 8 };
    const listSpec = {
      databaseId: TRANSACTIONS,
      title: "Recent transactions",
      presentation: "list",
      columns: ["date", "payee", "category", "amount"],
      timeColumnId: "date",
      timeWindow: window,
      limit: 10,
      filters: [],
    };

    const doors = await startPairingDoors({
      root: vaultRoot,
      vaultId,
      secretsDir,
      localPort: LOCAL_PORT,
      invitePort: INVITE_PORT,
    });
    try {
      assert.equal(doors.localError, null, `the door did not bind: ${doors.localError}`);
      const auth: Auth = { bearer: await ensureCompanionToken(secretsDir, vaultId) };

      // ── 1. the one call the companion makes ───────────────────────────────
      const saved = (await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        span: 2,
        spec: listSpec,
      })) as SavedCard;
      checks.saveView = saved;
      assert.equal(saved.error, undefined, `save_view refused a listing: ${JSON.stringify(saved.error)}`);
      assert.equal(saved.applied, true, "the card was not written to an unlocked board");
      assert.equal(saved.boardSlug, "financial", "the card landed on a different board");
      const viewId = saved.viewId as string;
      assert.ok(viewId, "save_view returned no viewId");

      // The reply carries the rows, which is what lets the companion talk about
      // the card without a second read. A listing's rows are its own.
      const replyBlock = saved.card?.blocks[0];
      assert.equal(replyBlock?.presentation, "list", "save_view answered with a different shape");
      assert.deepEqual(replyBlock?.columns, ["date", "payee", "category", "amount"]);
      assert.equal(replyBlock?.rowCount, RECENT, "save_view's reply did not carry the rows");

      // ── 2. it is on the board, under the operator's own lens ──────────────
      const boardRead = (await callTool(auth, "get_dashboard", { domainSlug: "financial" })) as {
        locked?: boolean;
        pins?: { kind: string; viewId?: string; label?: string; span?: number }[];
      };
      checks.board = boardRead;
      assert.equal(boardRead.locked, false, "the fixture board came up locked");
      const pin = (boardRead.pins ?? []).find((p) => p.viewId === viewId);
      assert.ok(pin, "the card is not pinned on the financial dashboard");
      assert.equal(pin?.label, "Recent transactions", "the pin does not carry the card's title");
      assert.equal(pin?.span, 2, "the card is not the full row");
      // And the read path agrees with the write path: listPinBoard drops a pin
      // the board would not actually show.
      const tier = await listPinBoard(vaultRoot, "financial");
      assert.equal(tier.ok, true);
      assert.ok(
        (tier as { ok: true; value: { pins: { id: string }[] } }).value.pins.some((p) =>
          p.id.includes(viewId),
        ),
        "the pin does not survive the board's own read path",
      );

      // ── 3. the rows: one per transaction, newest first, window honoured ───
      // `zarRun` is kept whole: this is the run the renderer leg pictures, taken
      // while the ledger is still single-currency, which is the card the
      // operator gets on a normal ledger.
      const { block, raw: zarRun } = await runCard(vaultRoot, viewId);
      assert.equal(block.presentation, "list");
      assert.equal(
        block.rows.length,
        RECENT,
        `the card drew ${block.rows.length} lines, expected ${RECENT}`,
      );
      assert.equal(
        block.rows.some((row) => row.includes("Ancient")),
        false,
        "the eight-week window let a 200-day-old transaction onto the card",
      );
      const payees = block.rows.map((row) => row[1]);
      assert.deepEqual(
        payees,
        Array.from({ length: RECENT }, (_, i) => `Payee ${i + 1}`),
        "the card is not newest-first",
      );
      const dates = block.rows.map((row) => String(row[0]));
      assert.deepEqual(dates, [...dates].sort().reverse(), "the date column is not in descending order");
      // A relation prints its target's name, not the uuid it stores.
      assert.deepEqual(
        [...new Set(block.rows.map((row) => row[2]))].sort(),
        ["Groceries", "Transport"],
        "a relation cell printed the row id instead of its name",
      );
      assert.equal(block.currency, "ZAR", `a ZAR ledger reported ${JSON.stringify(block.currency)}`);
      checks.run = {
        columns: block.columns,
        rowCount: block.rowCount,
        payees,
        dates,
        categories: block.rows.map((r) => r[2]),
        amounts: block.rows.map((r) => r[3]),
        currency: block.currency,
      };

      // ── 4. money it cannot convert, it does not pretend about ─────────────
      // The vault's own rate is unset, which is the state the operator's real
      // registry is in. A USD row must be reported as unreconciled rather than
      // printed as though the number were rands.
      await seed(TRANSACTIONS, {
        date: daysBefore(today, 2),
        amount: -50,
        account: travelCard,
        category: groceries,
        payee: "Dollar",
      });
      const mixed = await runCard(vaultRoot, viewId);
      checks.mixedCurrencies = {
        currency: mixed.block.currency,
        warnings: mixed.warnings,
        rows: mixed.block.rows.length,
      };
      assert.equal(mixed.block.currency, "mixed", "a ledger spanning two currencies reported one");
      assert.equal(mixed.block.rows.length, RECENT + 1, "the USD row did not reach the listing");
      assert.equal(
        mixed.block.rows.find((row) => row[1] === "Dollar")?.[3],
        -50,
        "the USD amount was converted at a rate the vault does not have",
      );
      assert.match(
        mixed.warnings.join("; "),
        /Rows span more than one currency \(USD, ZAR\)/,
        "the card reported mixed currencies without naming them",
      );

      // ── 5. the refusals teach, rather than only refusing ──────────────────
      // A listing with no columns cannot draw, and the reply must show the shape
      // that would: this is the difference between one retry and a discovery
      // tour, which is why the tool replies carry a `fix` at all.
      async function refused(title: string, spec: Record<string, unknown>): Promise<SavedCard> {
        const reply = (await callTool(auth, "save_view", {
          domainSlug: "financial",
          boardSlug: "financial",
          spec: { ...listSpec, ...spec, title },
        })) as SavedCard;
        assert.ok(reply.error, `"${title}" was accepted but should have been refused`);
        return reply;
      }

      const refusals: Record<string, SavedCard> = {};
      refusals.noColumns = await refused("No columns", { columns: [] });
      refusals.groupedList = await refused("Grouped list", { groupBy: "category" });
      refusals.bogusColumn = await refused("Bogus column", { columns: ["date", "nope"] });
      refusals.bucketedList = await refused("Bucketed list", { timeBucket: "week" });
      checks.refusals = refusals;
      assert.match(refusals.noColumns.error?.message ?? "", /non-empty columns array/);
      assert.match(refusals.groupedList.error?.message ?? "", /must not group/);
      assert.match(refusals.bogusColumn.error?.message ?? "", /must name existing columns/);
      assert.match(refusals.bucketedList.error?.message ?? "", /shows rows, not periods/);
      assert.ok(
        (refusals.noColumns.error?.fix?.workingSpecs?.list?.columns ?? []).length > 0,
        "the refusal offered no listing that would pass",
      );

      // `columns` is what makes an object a ROW object now, so the same rows can
      // be drawn as a list OR a table without rewriting the query. What is still
      // refused is a row object that also groups: that is a spec meaning two
      // different things, and the refusal names both ways out.
      const groupedRows = (await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        spec: {
          databaseId: TRANSACTIONS,
          title: "Totals",
          presentation: "table",
          measure: "sum",
          measureColumnId: "amount",
          groupBy: "date",
          timeBucket: "week",
          timeColumnId: "date",
          timeWindow: window,
          columns: ["date", "amount"],
        },
      })) as SavedCard;
      checks.groupedRows = groupedRows;
      assert.match(
        groupedRows.error?.message ?? "",
        /must not group/,
        "a row object that also grouped was accepted",
      );

      // The other drawing of the same rows — a table caption on a raw object —
      // is accepted by the engine and draws the rows, not a fold of them.
      const rowTable = (await callTool(auth, "preview_view", {
        domainSlug: "financial",
        spec: { ...listSpec, title: "Recent rows (table)", presentation: "table" },
      })) as {
        error?: { message: string };
        blocks?: Array<{ columns: string[]; rows: unknown[]; presentation: string }>;
      };
      checks.rowTable = rowTable;
      assert.equal(
        rowTable.error,
        undefined,
        `a row object drawn as a table was refused: ${JSON.stringify(rowTable.error)}`,
      );
      assert.equal(rowTable.blocks?.[0]?.presentation, "table");
      assert.ok(
        (rowTable.blocks?.[0]?.rows.length ?? 0) > 0,
        "the row table drew no rows",
      );

      // Five refusals, and still exactly one card: a refused spec must not leave
      // a file behind for the operator to find on their board.
      const views = await listViews(vaultRoot, "financial");
      assert.equal(views.ok, true);
      const total = (views as { ok: true; value: unknown[] }).value.length;
      checks.viewsOnDisk = total;
      assert.equal(total, 1, `five refusals and one save left ${total} cards in the domain`);

      // ── 6. a listing layered on an aggregate's root fields ────────────────
      // A composed card's root query fields are the defaults its blocks inherit,
      // and they are an AGGREGATE's — the operator's own "Spending by month" card
      // roots a `groupBy: "date"`. A list block that inherits that grouping is a
      // list that cannot be drawn, so the inheritance has to be dropped or the
      // one card the operator can already see cannot host a listing. This is the
      // shape a companion reaches for when it adds a panel to an existing card.
      const composed = (await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        span: 2,
        spec: {
          databaseId: TRANSACTIONS,
          title: "Spending by month, with the rows",
          presentation: "table",
          measure: "sum",
          measureColumnId: "amount",
          groupBy: "date",
          timeBucket: "month",
          timeColumnId: "date",
          timeWindow: window,
          blocks: [
            {
              id: "total",
              title: "Last 8 weeks",
              presentation: "metric",
              groupBy: null,
              measure: "sum",
              measureColumnId: "amount",
            },
            {
              id: "rows",
              title: "Recent transactions",
              presentation: "list",
              columns: ["date", "payee", "amount"],
            },
          ],
        },
      })) as SavedCard;
      checks.composed = composed;
      assert.equal(
        composed.error,
        undefined,
        `a list block under an aggregate root was refused: ${JSON.stringify(composed.error)}`,
      );
      assert.equal(composed.applied, true);
      const composedRows = (await runCard(vaultRoot, composed.viewId as string, "rows")).block;
      assert.equal(composedRows.presentation, "list", "the panel did not stay a listing");
      assert.equal(
        composedRows.rows.length,
        RECENT + 1,
        "the composed card's listing panel did not draw the rows",
      );
      assert.equal(
        composedRows.rows[0]?.[1],
        "Payee 1",
        "the composed card's listing panel is not newest-first",
      );

      // ── the artifact the renderer leg draws from ──────────────────────────
      // The run captured at step 3, BEFORE the USD row existed: the card the
      // renderer leg pictures is the one-currency card.
      const readBack = await getView(vaultRoot, "financial", viewId);
      assert.equal(readBack.ok, true, "the saved card could not be read back");

      fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
      fs.writeFileSync(
        ARTIFACT,
        `${JSON.stringify(
          {
            pass: true,
            what: "a recent-transactions listing put on the financial dashboard through the companion's own tools",
            command: "npm test  (this file: tests/view-list-e2e.test.ts)",
            door: { local: LOCAL_PORT, invite: INVITE_PORT, livePorts: [8643, 8646] },
            savedView: (readBack as { ok: true; value: { id: string } }).value,
            run: zarRun,
            board: boardRead,
            checks,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      assert.equal(fs.existsSync(ARTIFACT), true, "the run wrote no artifact");

      // ── 7. the operator's own switch, on a listing ───────────────────────
      // The card carries a row of presentation controls, and the operator will
      // press one. A listing has no measure and no grouping, so the retarget has
      // to supply both — otherwise the click saves `measure: "sum"` with no
      // column and comes back as a validation error on the operator's own board.
      // `applyPresentation` is the app's own writer for that click, driven here
      // and then sent through the door, so what is asserted is the whole path.
      const { applyPresentation } = await import("../src/components/ui/view-block-edit.ts");
      const cardView = await getView(vaultRoot, "financial", viewId);
      assert.equal(cardView.ok, true);
      const meta = await getDatabase(vaultRoot, "financial", TRANSACTIONS);
      assert.equal(meta.ok, true);
      const switched = applyPresentation(
        (cardView as { ok: true; value: never }).value,
        "block-1",
        "table",
        (meta as { ok: true; value: never }).value,
      );
      assert.equal(switched.ok, true, `the switch refused to retarget a listing: ${switched.ok ? "" : switched.error}`);
      checks.switchToList = switched.ok ? switched.spec : switched;

      const switchedSave = (await callTool(auth, "save_view", {
        domainSlug: "financial",
        boardSlug: "financial",
        viewId,
        spec: (switched as { ok: true; spec: Record<string, unknown> }).spec,
      })) as SavedCard;
      checks.switchedSave = switchedSave;
      assert.equal(
        switchedSave.error,
        undefined,
        `the operator's switch was refused by the vault: ${JSON.stringify(switchedSave.error)}`,
      );
      assert.equal(switchedSave.applied, true, "the switch did not land");
      assert.equal(switchedSave.updated, true, "the switch made a second card instead of changing this one");
      const asTable = await runCard(vaultRoot, viewId);
      assert.equal(
        asTable.block.presentation,
        "table",
        "the card did not become the table the operator asked for",
      );
      assert.equal(
        asTable.block.columns.length,
        4,
        "switching a listing to a table changed its data instead of only its drawing",
      );
      assert.ok(
        asTable.block.rowCount > 0,
        "the table the switch produced drew no rows, so it is not showing the ledger",
      );
      // The switch is a DRAWING change: the saved spec still names its columns
      // and still has no measure, groupBy or bucket. That is the regression the
      // operator's "the data is lost when I change tabs" report was about.
      const switchedFile = await getView(vaultRoot, "financial", viewId);
      assert.equal(switchedFile.ok, true);
      const switchedValue = (switchedFile as { ok: true; value: Record<string, unknown> }).value;
      // A card saved before composed views has no `blocks`: its root fields are
      // its one object, and the switch must preserve them there too.
      const switchedBlock = Array.isArray(switchedValue.blocks)
        ? (switchedValue.blocks[0] as Record<string, unknown>)
        : switchedValue;
      assert.deepEqual(
        switchedBlock?.columns,
        ["date", "payee", "category", "amount"],
        "the switch dropped the row object's columns",
      );
      assert.equal(switchedBlock?.groupBy, null, "the switch invented a grouping");
      assert.equal(switchedBlock?.timeBucket, null, "the switch invented a period");
    } finally {
      await doors.close();
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("draws the listing: one line per row, newest first, money right-aligned", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }
    assert.equal(
      fs.existsSync(ARTIFACT),
      true,
      "no view-list artifact — the first case in this file did not run",
    );

    /**
     * The engine's own answer for the same card. The fixture seeds its rows
     * relative to today (`daysBefore(today, i)`), so the dates a card must lead
     * with are read from the run the first case recorded rather than written out
     * here: a literal date in this file is a claim that was true on the day it was
     * typed and rots the next morning.
     */
    const engine = (
      JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as {
        checks: {
          run: {
            dates: string[];
            payees: string[];
            categories: string[];
            amounts: number[];
          };
        };
      }
    ).checks.run;

    fs.rmSync(RIG_REPORT, { force: true });
    fs.rmSync(RIG_SHOT, { force: true });
    const exitCode = await runRig();
    assert.equal(fs.existsSync(RIG_REPORT), true, "the rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(RIG_REPORT, "utf8")) as {
      pass: boolean;
      failures: string[];
      headers: string[];
      rows: number;
      firstRow: string[] | null;
      lastRow: string[] | null;
      moneyHeader: string;
      screenshot: string;
    };
    assert.deepEqual(report.failures, [], "the rig's own claims failed");
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the rig exited non-zero");

    // The card the operator sees, held to the engine's own answer.
    assert.deepEqual(report.headers, ["Date", "Payee", "Category", "Amount (ZAR)"]);
    assert.equal(report.rows, 9, `the card drew ${report.rows} lines`);
    // Newest first, all the way down to the oldest row the window keeps. The
    // first line is held to the engine's own first row — date and all — and the
    // last to the oldest payee the fixture seeded, which no calendar can move.
    assert.deepEqual(
      report.firstRow,
      [
        engine.dates[0],
        engine.payees[0],
        engine.categories[0],
        String(engine.amounts[0]),
      ],
      "the card does not lead with the engine's newest transaction",
    );
    assert.equal(
      report.lastRow?.[1],
      engine.payees[engine.payees.length - 1],
      "the card does not end with the oldest in the window",
    );
    assert.match(report.moneyHeader, /ZAR/);
    // The picture is the artifact, and it is there to be looked at.
    assert.equal(fs.existsSync(RIG_SHOT), true, "the rig captured no screenshot");
  });
});

/**
 * The rig renders the real ViewCard in a real layout engine, so it needs the
 * Vite dev server. With the server down the case skips; `npm run dev` in another
 * terminal brings it up.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runRig(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/view-list.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}
