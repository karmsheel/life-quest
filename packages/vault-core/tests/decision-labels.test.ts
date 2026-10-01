// The inbox is read by a person, and a database row body carries the write
// payload verbatim: for a relation column that is the target row's id, so the
// card asks the operator to approve "47083ecb-..." instead of "Groceries".
//
// Ways the read-time resolution can fail, and what is asserted for each:
//  1. nothing is resolved        -> cellDisplayLabels still names the relation row
//  2. the wrong row is read      -> labels come from the id in the body, not a guess
//  3. a dangling id is prettified-> a missing row adds no label; nothing is invented
//  4. labels leak into the write -> cells / previousCells / expectedUpdatedAt are
//                                   byte-identical to what was filed, and the file
//                                   on disk is never rewritten by a read
//  5. a clean body is rewritten  -> a body with nothing to resolve returns the same
//                                   record, so "Exact proposal" stays verbatim
//  6. a non-database target      -> goal / doctrine decisions pass through untouched
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addDatabaseColumn,
  createDatabase,
  createVault,
  executeDatabaseTool,
  getDatabase,
  listDecisions,
  rowDisplayLabel,
  cellDisplayLabels,
  upsertRow,
  withDecisionDisplayLabels,
} from "../src/index.ts";
import { installFinanceKit } from "../src/finance-kit.ts";
import { createDecision } from "../src/decisions.ts";
import { vaultPaths } from "../src/paths.ts";
import type { Actor, DatabaseMeta, DecisionRecord } from "../src/index.ts";

const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };
const USER: Actor = { type: "user", id: "u1", name: "You" };

const isOk = (r: unknown): r is Record<string, unknown> =>
  !("error" in (r as Record<string, unknown>));

const colId = (db: DatabaseMeta, name: string): string => {
  const col = db.columns.find((c) => c.name.toLowerCase() === name);
  assert.ok(col, `no column named ${name}`);
  return col.id;
};

/** A finance vault with a Categories pair and one account, so relations resolve. */
async function ledger(name: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `lq-labels-${name}-`));
  const root = path.join(dir, "vault");
  assert.equal((await createVault(root, "Labels")).ok, true);
  assert.equal((await installFinanceKit(root, USER)).ok, true);

  const cats = await getDatabase(root, "financial", "finance:categories");
  const accounts = await getDatabase(root, "financial", "finance:accounts");
  const tx = await getDatabase(root, "financial", "finance:transactions");
  assert.ok(cats.ok && accounts.ok && tx.ok);
  if (!cats.ok || !accounts.ok || !tx.ok) throw new Error("finance kit incomplete");

  const catName = colId(cats.value, "name");
  assert.equal(
    (await upsertRow(root, "financial", cats.value.id, {
      id: "cat-uncategorized",
      cells: { [catName]: "Uncategorized" },
    })).ok,
    true,
  );
  assert.equal(
    (await upsertRow(root, "financial", cats.value.id, {
      id: "cat-groceries",
      cells: { [catName]: "Groceries" },
    })).ok,
    true,
  );
  assert.equal(
    (await upsertRow(root, "financial", accounts.value.id, {
      id: "acc-capitec",
      cells: { [colId(accounts.value, "name")]: "Capitec" },
    })).ok,
    true,
  );
  assert.equal(
    (await upsertRow(root, "financial", tx.value.id, {
      id: "tx-coffee",
      cells: {
        [colId(tx.value, "date")]: "2026-09-27",
        [colId(tx.value, "amount")]: -95,
        [colId(tx.value, "account")]: "acc-capitec",
        [colId(tx.value, "category")]: "cat-uncategorized",
        [colId(tx.value, "payee")]: "Coffee",
      },
    })).ok,
    true,
  );

  return { dir, root, cats: cats.value, accounts: accounts.value, tx: tx.value };
}

/** Refile the row for one category, and return the pending Decision. */
async function propose(
  root: string,
  tx: DatabaseMeta,
  categoryId: string,
): Promise<DecisionRecord> {
  const filed = await executeDatabaseTool(root, AGENT, "upsert_row", {
    domainSlug: "financial",
    databaseId: tx.id,
    id: "tx-coffee",
    cells: {
      [colId(tx, "date")]: "2026-09-27",
      [colId(tx, "amount")]: -95,
      [colId(tx, "account")]: "acc-capitec",
      [colId(tx, "category")]: categoryId,
      [colId(tx, "payee")]: "Coffee",
    },
  });
  assert.ok(isOk(filed), JSON.stringify(filed));
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true);
  if (!listed.ok) throw new Error("no decisions");
  const decision = listed.value.at(-1);
  assert.ok(decision, "proposal not filed");
  return decision;
}

describe("Decision cell labels", () => {
  let dir: string;
  let root: string;
  let cats: DatabaseMeta;
  let tx: DatabaseMeta;

  before(async () => {
    const ledgered = await ledger("main");
    dir = ledgered.dir;
    root = ledgered.root;
    cats = ledgered.cats;
    tx = ledgered.tx;
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rowDisplayLabel prefers the row's own name over its id", () => {
    assert.equal(rowDisplayLabel(cats, { [colId(cats, "name")]: "Groceries" }), "Groceries");
    assert.equal(rowDisplayLabel(cats, {}), "");
    assert.equal(rowDisplayLabel(tx, { [colId(tx, "payee")]: "Coffee" }), "Coffee");
  });

  it("cellDisplayLabels resolves a relation cell and ignores a text cell", async () => {
    const labels = await cellDisplayLabels(root, "financial", tx, {
      [colId(tx, "category")]: "cat-groceries",
      [colId(tx, "account")]: "acc-capitec",
      [colId(tx, "payee")]: "Coffee",
    });
    assert.deepEqual(labels, {
      [colId(tx, "category")]: "Groceries",
      [colId(tx, "account")]: "Capitec",
    });
    assert.deepEqual(await cellDisplayLabels(root, "financial", tx, null), {});
  });

  it("resolves the ids in a filed proposal for the read path only", async () => {
    const decision = await propose(root, tx, "cat-groceries");

    // What was filed holds the write payload and nothing else: the apply path
    // must keep reading the same cells the agent proposed.
    const stored = JSON.parse(decision.proposedBodyMarkdown) as Record<string, unknown>;
    assert.equal("cellLabels" in stored, false, "the filed body must stay raw");
    assert.equal("previousCellLabels" in stored, false);
    assert.equal((stored.previousCells as Record<string, unknown>)[colId(tx, "category")], "cat-uncategorized");

    const file = vaultPaths(root).decisionJson(decision.id);
    const before = await fs.readFile(file, "utf8");
    const [enriched] = await withDecisionDisplayLabels(root, [decision]);
    assert.ok(enriched);
    const body = JSON.parse(enriched.proposedBodyMarkdown) as Record<string, unknown>;
    assert.deepEqual(body.cellLabels, {
      [colId(tx, "category")]: "Groceries",
      [colId(tx, "account")]: "Capitec",
    });
    assert.deepEqual(body.previousCellLabels, {
      [colId(tx, "category")]: "Uncategorized",
      [colId(tx, "account")]: "Capitec",
    });

    // The cells the operator approves are untouched by the display fields.
    assert.deepEqual(body.cells, stored.cells);
    assert.deepEqual(body.previousCells, stored.previousCells);
    assert.equal(body.op, stored.op);
    assert.equal(body.expectedUpdatedAt, stored.expectedUpdatedAt);

    // Read-only: the file on disk still holds the raw payload.
    assert.equal(await fs.readFile(file, "utf8"), before, "the read path wrote to the Decision");
  });

  it("leaves a body with nothing to resolve exactly as it was filed", async () => {
    // A database with no relation columns: nothing resolves, so the read path
    // hands back the very same record and the card's "Exact proposal" view stays
    // byte-identical to the file the agent filed.
    const db = await createDatabase(root, "health", { name: "Notes" });
    assert.equal(db.ok, true);
    if (!db.ok) return;
    const added = await addDatabaseColumn(root, "health", db.value.id, {
      name: "note",
      type: "text",
    });
    assert.equal(added.ok, true);
    const meta = await getDatabase(root, "health", db.value.id);
    assert.equal(meta.ok, true);
    if (!meta.ok) return;

    const filed = await executeDatabaseTool(root, AGENT, "upsert_row", {
      domainSlug: "health",
      databaseId: db.value.id,
      cells: { [colId(meta.value, "note")]: "milk" },
    });
    assert.ok(isOk(filed), JSON.stringify(filed));
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const decision = listed.value.at(-1)!;

    const [same] = await withDecisionDisplayLabels(root, [decision]);
    assert.equal(same, decision);
    assert.equal(same?.proposedBodyMarkdown, decision.proposedBodyMarkdown);
  });

  it("adds no label for a relation row the vault cannot answer for", async () => {
    const decision = await propose(root, tx, "cat-groceries");
    await fs.rm(vaultPaths(root).domainSqlite("financial"), { force: true });

    const [enriched] = await withDecisionDisplayLabels(root, [decision]);
    const body = JSON.parse(enriched!.proposedBodyMarkdown) as Record<string, unknown>;
    assert.equal("cellLabels" in body, false, "no labels without a readable database");
    assert.equal(enriched!.proposedBodyMarkdown, decision.proposedBodyMarkdown);
  });

  it("does not touch a Decision target that is not a database", async () => {
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedBodyMarkdown: "{\n  \"type\": \"createGoal\",\n  \"name\": \"Run 5k\"\n}",
      actor: AGENT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const [same] = await withDecisionDisplayLabels(root, [created.value]);
    assert.equal(same, created.value);
  });

  it("names the relation target of an add-column proposal", async () => {
    const db = await createDatabase(root, "health", { name: "Habits" });
    assert.equal(db.ok, true);
    if (!db.ok) return;

    const filed = await executeDatabaseTool(root, AGENT, "add_column", {
      domainSlug: "health",
      databaseId: db.value.id,
      name: "Goal",
      type: "relation",
      relationDatabaseId: db.value.id,
    });
    assert.ok(isOk(filed), JSON.stringify(filed));
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const decision = listed.value.at(-1)!;
    const [enriched] = await withDecisionDisplayLabels(root, [decision]);
    const body = JSON.parse(enriched!.proposedBodyMarkdown) as Record<string, unknown>;
    assert.equal(body.relationDatabaseName, "Habits");
  });
});
