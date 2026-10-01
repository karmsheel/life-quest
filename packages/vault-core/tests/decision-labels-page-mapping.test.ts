// A page Decision body is `{ title, blocks }` and a mapping Decision body is an
// `IngestMapping`: both name their data by id, so the read-time resolution the
// row card uses has to cover them too. A block is bound to a database and to
// columns; every column added through add_column mints a uuid, so the card used
// to read "Sum · 8f3d2b41…" and the database read "Finance · transactions".
//
// Ways this can fail, and what is asserted for each:
//  1. a block keeps its raw ids   -> a bound-table names its database, a metric
//                                    and a chart name the column they read
//  2. an assumption set is missed -> a scenario-compare names the set it compares
//  3. a mapping keeps column ids  -> each mapped column names its column
//  4. an id is replaced           -> every id stays where it was, so the apply
//                                    path writes the payload that was filed
//  5. a clean body is rewritten   -> a page whose blocks name nothing (markdown,
//                                    a value-only block) returns the same record
//  6. an id the vault cannot      -> nothing is invented: an unknown column or
//     answer for                     database adds no name, and the id stays
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addDatabaseColumn, createVault, withDecisionDisplayLabels } from "../src/index.ts";
import { installFinanceKit } from "../src/finance-kit.ts";
import { createDecision, listDecisions } from "../src/decisions.ts";
import { updatePage } from "../src/pages.ts";
import { proposeMapping } from "../src/ingest.ts";
import { FINANCE_DB_IDS, FINANCE_PAGE_IDS } from "../src/types.ts";
import type { Actor, DatabaseMeta, DecisionRecord } from "../src/index.ts";

const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };

const blocks = (body: string): Record<string, unknown>[] => {
  const parsed = JSON.parse(body) as { blocks?: Record<string, unknown>[] };
  return parsed.blocks ?? [];
};

/** A financial vault whose Transactions database has an agent-added column. */
async function vault(name: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `lq-labels-${name}-`));
  const root = path.join(dir, "vault");
  assert.equal((await createVault(root, "Labels")).ok, true);
  assert.equal((await installFinanceKit(root, { type: "user", id: "u1", name: "You" })).ok, true);

  // A column the kit did not ship: id is a uuid, name is what a person reads.
  const added = await addDatabaseColumn(root, "financial", FINANCE_DB_IDS.transactions, {
    name: "Mileage",
    type: "number",
  });
  assert.equal(added.ok, true);
  if (!added.ok) throw new Error("could not add the Mileage column");
  const mileage = added.value.columns.find((c) => c.name === "Mileage");
  assert.ok(mileage, "the added column is not in the database metadata");
  return { root, mileageId: mileage.id, meta: added.value as DatabaseMeta };
}

/** The last Decision filed, i.e. what the inbox would read. */
async function lastDecision(root: string): Promise<DecisionRecord> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true);
  if (!listed.ok) throw new Error("no decisions");
  const decision = listed.value.at(-1);
  assert.ok(decision, "no decision was filed");
  return decision;
}

describe("decision display labels for pages and mappings", () => {
  let dir = "";
  let root = "";
  let mileageId = "";

  before(async () => {
    const created = await vault("page-mapping");
    dir = path.dirname(created.root);
    root = created.root;
    mileageId = created.mileageId;
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("names the database, the columns and the assumption set of a page block", async () => {
    const proposed = await updatePage(
      root,
      "financial",
      FINANCE_PAGE_IDS.spend,
      {
        title: "Spend",
        blocks: [
          { id: "blk-table", kind: "bound-table", databaseId: FINANCE_DB_IDS.transactions },
          {
            id: "blk-metric",
            kind: "metric",
            databaseId: FINANCE_DB_IDS.transactions,
            columnId: mileageId,
            agg: "sum",
          },
          {
            id: "blk-chart",
            kind: "chart",
            chartType: "line",
            databaseId: FINANCE_DB_IDS.transactions,
            xColumnId: "date",
            yColumnId: mileageId,
          },
          {
            id: "blk-scenario",
            kind: "scenario-compare",
            assumptionSetId: "finance-assumption-scenario-1",
          },
          { id: "blk-note", kind: "markdown", markdown: "Top spend this month.\n" },
        ],
      },
      AGENT,
    );
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;
    assert.equal(proposed.value.applied, false, "an agent proposal must not write the page");

    const filed = await lastDecision(root);
    const [enriched] = await withDecisionDisplayLabels(root, [filed]);
    assert.ok(enriched);
    const page = blocks(enriched.proposedBodyMarkdown);
    const raw = blocks(filed.proposedBodyMarkdown);

    // 1 + 2: every reference is named, and each block is otherwise untouched.
    assert.equal(page[0]?.databaseName, "Transactions");
    assert.deepEqual(page[0], { ...raw[0], databaseName: "Transactions" });
    assert.equal(page[1]?.columnName, "Mileage");
    assert.equal(page[1]?.databaseName, "Transactions");
    assert.deepEqual(page[1], {
      ...raw[1],
      databaseName: "Transactions",
      columnName: "Mileage",
    });
    assert.equal(page[2]?.yColumnName, "Mileage");
    assert.equal(page[2]?.xColumnName, "date");
    assert.equal(page[3]?.assumptionSetName, "Scenario 1");
    // A block that names nothing gains nothing.
    assert.deepEqual(page[4], raw[4]);

    // 4: the ids are all still there, so approving writes what was filed.
    assert.equal(page[0]?.databaseId, FINANCE_DB_IDS.transactions);
    assert.equal(page[1]?.columnId, mileageId);
    assert.equal(page[2]?.yColumnId, mileageId);
    assert.equal(page[3]?.assumptionSetId, "finance-assumption-scenario-1");
    const filedBody = filed.proposedBodyMarkdown;
    assert.equal(filedBody.includes("databaseName"), false, "the stored body gained a name");
    assert.notEqual(enriched.proposedBodyMarkdown, filedBody, "nothing was enriched");
  });

  it("names each column a mapping maps onto", async () => {
    const proposed = await proposeMapping(root, "financial", {
      databaseId: FINANCE_DB_IDS.transactions,
      fingerprint: "sha256:9f2c41ab7d0e5c68",
      sourceKind: "csv",
      columns: [
        { source: "Date", columnId: "date" },
        { source: "Odometer", columnId: mileageId },
        { source: "Unmapped column", columnId: "" },
      ],
      actor: AGENT,
    });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;

    const filed = await lastDecision(root);
    assert.equal(filed.target.type, "mapping");
    const [enriched] = await withDecisionDisplayLabels(root, [filed]);
    assert.ok(enriched);
    const body = JSON.parse(enriched.proposedBodyMarkdown) as {
      databaseName?: string;
      columns: { source: string; columnId: string; columnName?: string }[];
    };
    const rawBody = JSON.parse(filed.proposedBodyMarkdown) as {
      columns: { source: string; columnId: string }[];
    };

    assert.equal(body.databaseName, "Transactions");
    assert.equal(body.columns[0]?.columnName, "date");
    assert.equal(body.columns[1]?.columnName, "Mileage");
    // 3: a source column the operator left unmapped stays unmapped.
    assert.equal("columnName" in (body.columns[2] ?? {}), false);
    // 4: the ids the mapping is written from are untouched.
    assert.deepEqual(
      body.columns.map((c) => c.columnId),
      rawBody.columns.map((c) => c.columnId),
    );
    assert.equal(filed.proposedBodyMarkdown.includes("columnName"), false);
  });

  it("leaves a page that names nothing alone", async () => {
    const proposed = await updatePage(
      root,
      "financial",
      FINANCE_PAGE_IDS.ledger,
      { title: "Ledger", blocks: [{ id: "blk-note", kind: "markdown", markdown: "Ledger.\n" }] },
      AGENT,
    );
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;

    const filed = await lastDecision(root);
    const [same] = await withDecisionDisplayLabels(root, [filed]);
    // 5: identity, not just equality — the inbox renders the stored text.
    assert.equal(same, filed);
  });

  it("invents nothing for an id the vault cannot answer for", async () => {
    // A proposal filed straight through createDecision skips block validation,
    // which is how a stale column id reaches the inbox in the first place.
    const created = await createDecision(root, {
      target: { type: "page", domainSlug: "financial", pageId: FINANCE_PAGE_IDS.spend },
      proposedBodyMarkdown: JSON.stringify(
        {
          title: "Spend",
          blocks: [
            {
              id: "blk-metric",
              kind: "metric",
              databaseId: FINANCE_DB_IDS.transactions,
              columnId: "column-that-is-gone",
              agg: "sum",
            },
            {
              id: "blk-table",
              kind: "bound-table",
              databaseId: "finance:database-that-is-gone",
            },
          ],
        },
        null,
        2,
      ),
      actor: AGENT,
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;

    const [enriched] = await withDecisionDisplayLabels(root, [created.value]);
    assert.ok(enriched);
    const page = blocks(enriched.proposedBodyMarkdown);
    // 6: the database that does exist is still named; the one that does not is
    // not guessed at, and the unknown column keeps its id and gains no name.
    assert.equal(page[0]?.databaseName, "Transactions");
    assert.equal("columnName" in (page[0] ?? {}), false);
    assert.equal(JSON.stringify(page[1]), JSON.stringify({ id: "blk-table", kind: "bound-table", databaseId: "finance:database-that-is-gone" }));
  });
});
