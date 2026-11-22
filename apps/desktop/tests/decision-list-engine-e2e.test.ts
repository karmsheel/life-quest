import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  addDatabaseColumn,
  createDatabase,
  createDecision,
  createVault,
  listDecisions,
  readLog,
  resolveDecision,
  unlockDomain,
  upsertRow,
  withDecisionDisplayLabels,
} from "@lifequest/vault-core";

/**
 * The Decisions inbox read path, end to end, against a real vault of 800 files.
 *
 * The operator's Decisions page is rendered from `decisionList()`, which is
 * `listDecisions` followed by `withDecisionDisplayLabels` over every Decision —
 * not just the pending ones. On a real vault of 819 decisions / 41 MB that cost
 * over two seconds, because the files were read strictly one at a time and every
 * file's ancestry was lstat'ed three times. The engine now reads with bounded
 * concurrency, validates the decisions directory once, refuses a symlinked leaf
 * from the `readdir` dirent, and labels with the same bound over shared caches.
 *
 * This rig fills a throwaway vault through the same engine calls the app uses —
 * `createDecision` to file, `resolveDecision` to answer most of the history,
 * `createDatabase` / `addDatabaseColumn` / `upsertRow` for a real domain database
 * so a database-row decision has labels to resolve — then measures one cold
 * `listDecisions` + `withDecisionDisplayLabels` pass over all 800 records. It
 * also plants what a real vault collects and a naive parallel read would choke
 * on: one unparseable JSON file and one symlinked decision file.
 *
 * It runs under plain Node (`node --experimental-strip-types --test`), so it
 * needs no Electron, no dev server, and no bench lock.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. A broken Decision file blanks the whole inbox: `listDecisions` answers an
 *     error or drops records instead of skipping that one file.
 *  2. The broken file is rewrote or deleted rather than left for repair, or it
 *     is reported on every read instead of once per process.
 *  3. A symlinked decision file is followed, so the linked record appears twice
 *     (or content from outside the vault is read).
 *  4. A hostile filename is accepted because the per-file path is no longer
 *     built through the segment fence.
 *  5. Parallel reads drop or duplicate a record, or change the record shape.
 *  6. Parallel label resolution drops a Decision or reorders the list the page
 *     draws.
 *  7. The label pass stops resolving a database row's relation cell / column
 *     names (the ids are still in the body, so only the names reveal this).
 *  8. The label pass rewrites the stored Decision file instead of only the
 *     in-memory copy.
 *  9. The pending count is wrong, so the rail badge would lie.
 * 10. The read path is still slow on a realistic list: the cold pass over 800
 *     records misses its budget.
 * 11. The artifact is written by a run that failed. Assertions throw, so the
 *     artifact only exists for a run that held.
 *
 * Artifact: `apps/desktop/e2e/artifacts/decision-list-engine.json` — the counts,
 * the cold-pass milliseconds, the label names it resolved, and the pass flag.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(
  desktopRoot,
  "e2e/artifacts/decision-list-engine.json",
);

/** The inbox this rig builds: 795 answered Decisions and 5 waiting on the operator. */
const RESOLVED_DECISIONS = 795;
const PENDING_DECISIONS = 5;
const SEEDED_DECISIONS = RESOLVED_DECISIONS + PENDING_DECISIONS;

/**
 * How many engine calls the seed keeps in flight. The seed is not what this rig
 * measures, and the write funnel fsyncs each Decision file, so seeding one at a
 * time would spend most of the run waiting on the disk. Distinct Decisions are
 * independent writes (nothing here shares an id), which is what lets the seed
 * overlap them.
 */
const SEED_CONCURRENCY = 8;

/**
 * Generous on purpose: the fixed read path measured well under this on a loaded
 * box, and a tighter number would flake on a slower disk for a reason that is
 * not this rig's subject. What it guards is the order-of-magnitude regression
 * (a serial read of a realistic inbox), not a benchmark score.
 */
const BUDGET_MS = 1200;

/** A small, well-commented bounded-concurrency map for the seed. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await run(items[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

function parsedBody(record: { proposedBodyMarkdown: string }): Record<string, unknown> {
  return JSON.parse(record.proposedBodyMarkdown) as Record<string, unknown>;
}

const AGENT = { type: "agent" as const, id: "e2e", name: "E2E" };

describe("decision list engine", () => {
  it("reads 800 Decisions with display labels inside the budget, skipping broken and symlinked files", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "lifequest-decision-list-"),
    );
    try {
      // ── a real vault, and the domain database a row Decision points at ──
      const created = await createVault(root, "Decision list E2E");
      assert.equal(
        created.ok,
        true,
        created.ok ? "" : `createVault failed: ${created.error}`,
      );
      const unlocked = await unlockDomain(root, "financial");
      assert.equal(
        unlocked.ok,
        true,
        `unlockDomain(financial) failed: ${unlocked.ok ? "" : unlocked.error}`,
      );

      // A relation column needs a real target database with real rows: a label
      // the operator should read ("Brand 3") instead of a uuid. The rows are
      // created through the engine, because `getRow` is what resolves them.
      const brands = await createDatabase(root, "financial", { name: "Brands" });
      assert.equal(brands.ok, true, brands.ok ? "" : brands.error);
      if (!brands.ok) return;
      const brandName = await addDatabaseColumn(root, "financial", brands.value.id, {
        name: "Name",
        type: "text",
      });
      assert.equal(brandName.ok, true, brandName.ok ? "" : brandName.error);
      if (!brandName.ok) return;
      const brandNameId = brandName.value.columns.find((c) => c.name === "Name")!.id;

      const BRAND_ROWS = 24;
      const brandRowIds: string[] = [];
      for (let index = 0; index < BRAND_ROWS; index++) {
        const row = await upsertRow(root, "financial", brands.value.id, {
          cells: { [brandNameId]: `Brand ${index}` },
        });
        assert.equal(row.ok, true, row.ok ? "" : row.error);
        if (!row.ok) return;
        brandRowIds.push(row.value.id);
      }

      const bottles = await createDatabase(root, "financial", { name: "Bottles" });
      assert.equal(bottles.ok, true, bottles.ok ? "" : bottles.error);
      if (!bottles.ok) return;
      const bottleName = await addDatabaseColumn(root, "financial", bottles.value.id, {
        name: "Name",
        type: "text",
      });
      assert.equal(bottleName.ok, true, bottleName.ok ? "" : bottleName.error);
      if (!bottleName.ok) return;
      const bottleBrand = await addDatabaseColumn(root, "financial", bottles.value.id, {
        name: "Brand",
        type: "relation",
        relationDatabaseId: brands.value.id,
      });
      assert.equal(bottleBrand.ok, true, bottleBrand.ok ? "" : bottleBrand.error);
      if (!bottleBrand.ok) return;
      const bottleNameId = bottleName.value.columns.find((c) => c.name === "Name")!.id;
      const bottleBrandId = bottleBrand.value.columns.find((c) => c.name === "Brand")!.id;

      // ── the history: 795 Decisions filed and answered through the engine ──
      // Half are database-row proposals (the expensive ones: each carries a cell
      // map whose relation cell the read path resolves), half are goal proposals
      // (no labels to resolve). Answers are rejections, which is a real resolved
      // state and skips the apply path — this rig is about the read.
      const resolvedDatabaseRows = Math.floor(RESOLVED_DECISIONS / 2);
      const seededIds = await mapLimit(
        Array.from({ length: RESOLVED_DECISIONS }, (_, index) => index),
        SEED_CONCURRENCY,
        async (index) => {
          const isDatabaseRow = index % 2 === 1;
          const filed = isDatabaseRow
            ? await createDecision(root, {
                target: {
                  type: "database-row",
                  domainSlug: "financial",
                  databaseId: bottles.value.id,
                  rowId: null,
                },
                proposedTitle: `Bottle ${index}`,
                proposedBodyMarkdown: JSON.stringify({
                  op: "upsert",
                  cells: {
                    [bottleNameId]: `Bottle ${index}`,
                    [bottleBrandId]: brandRowIds[index % BRAND_ROWS],
                  },
                }),
                actor: AGENT,
              })
            : await createDecision(root, {
                target: { type: "goal" },
                proposedTitle: `Goal ${index}`,
                proposedBodyMarkdown: JSON.stringify({
                  type: "createGoal",
                  name: `Goal ${index}`,
                }),
                actor: AGENT,
              });
          assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
          const answered = await resolveDecision(root, filed.value.id, "rejected");
          assert.equal(answered.ok, true, answered.ok ? "" : answered.error);
          return filed.value.id;
        },
      );

      // ── the waiting ones: three goals, one labelled row write, one note ──
      const pendingIds: string[] = [];
      for (let index = 0; index < PENDING_DECISIONS - 2; index++) {
        const filed = await createDecision(root, {
          target: { type: "goal" },
          proposedTitle: `Pending goal ${index}`,
          proposedBodyMarkdown: JSON.stringify({
            type: "createGoal",
            name: `Pending goal ${index}`,
          }),
          actor: AGENT,
        });
        assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
        if (!filed.ok) return;
        pendingIds.push(filed.value.id);
      }

      // The assertion target for labels: a pending row write whose body names a
      // real relation target, so the read path must add the brand's name beside
      // the id and the column names beside the cell map's keys.
      const pendingRow = await createDecision(root, {
        target: {
          type: "database-row",
          domainSlug: "financial",
          databaseId: bottles.value.id,
          rowId: null,
        },
        proposedTitle: "Bottle waiting for the operator",
        proposedBodyMarkdown: JSON.stringify({
          op: "upsert",
          cells: {
            [bottleNameId]: "Waiting",
            [bottleBrandId]: brandRowIds[3],
          },
        }),
        actor: AGENT,
      });
      assert.equal(pendingRow.ok, true, pendingRow.ok ? "" : pendingRow.error);
      if (!pendingRow.ok) return;
      pendingIds.push(pendingRow.value.id);

      // An agent may file a note that does not exist yet; approve creates it.
      const pendingNote = await createDecision(root, {
        target: { type: "library", id: "pending-note" },
        proposedTitle: "Pending note",
        proposedBodyMarkdown: "A pending note proposal the operator has not answered.",
        actor: AGENT,
      });
      assert.equal(pendingNote.ok, true, pendingNote.ok ? "" : pendingNote.error);
      if (!pendingNote.ok) return;
      pendingIds.push(pendingNote.value.id);

      // ── what a real vault collects: one broken file, one symlinked file ──
      const decisionsDir = path.join(root, ".lifequest", "decisions");
      const brokenPath = path.join(decisionsDir, "broken.json");
      const brokenText = "{ this is not json at all";
      await fs.writeFile(brokenPath, brokenText);
      // The link points at a Decision the seed wrote, so a read that followed it
      // would produce a duplicate record (or, pointed outside, content the vault
      // never held). Both are caught by the count and the id set below.
      const symlinkedPath = path.join(decisionsDir, "symlinked.json");
      await fs.symlink(path.join(decisionsDir, `${seededIds[0]}.json`), symlinkedPath);

      // The stored bytes of the pending row Decision, to prove the display pass
      // does not rewrite the file the approve path reads.
      const pendingRowPath = path.join(decisionsDir, `${pendingRow.value.id}.json`);
      const storedPendingRow = await fs.readFile(pendingRowPath, "utf8");

      // ── the cold pass this rig exists to measure ──────────────────────────
      const listStart = performance.now();
      const listed = await listDecisions(root);
      const listMs = performance.now() - listStart;
      assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
      if (!listed.ok) return;

      const labelStart = performance.now();
      const labelled = await withDecisionDisplayLabels(root, listed.value);
      const labelMs = performance.now() - labelStart;
      const totalMs = listMs + labelMs;

      // ── correctness: every good record, and only the good records ────────
      assert.equal(
        listed.value.length,
        SEEDED_DECISIONS,
        `the inbox read ${listed.value.length} of ${SEEDED_DECISIONS} Decisions — ` +
          "the broken and symlinked files must be skipped, not blank the list",
      );
      const ids = new Set(listed.value.map((decision) => decision.id));
      assert.equal(
        ids.size,
        listed.value.length,
        "a Decision was read twice (a symlinked file was followed)",
      );
      for (const id of [...seededIds, ...pendingIds]) {
        assert.ok(ids.has(id), `the inbox dropped a seeded Decision: ${id}`);
      }
      assert.ok(!ids.has("broken"), "the unparseable file leaked into the list");
      assert.ok(!ids.has("symlinked"), "the symlinked file leaked into the list");

      const pending = listed.value.filter((decision) => decision.status === "pending");
      assert.equal(
        pending.length,
        PENDING_DECISIONS,
        `pending count is ${pending.length}, expected ${PENDING_DECISIONS}`,
      );

      // ── labels: the row Decision wears names, and the list keeps its order ──
      assert.equal(
        labelled.length,
        listed.value.length,
        "the label pass dropped Decisions",
      );
      assert.deepEqual(
        labelled.map((decision) => decision.id),
        listed.value.map((decision) => decision.id),
        "the label pass reordered the inbox",
      );
      const labelledRow = labelled.find((decision) => decision.id === pendingRow.value.id);
      assert.ok(labelledRow, "the pending row Decision is missing from the labelled list");
      if (!labelledRow) return;
      const rowBody = parsedBody(labelledRow);
      assert.deepEqual(
        rowBody.cellLabels,
        { [bottleBrandId]: `Brand ${3}` },
        "the row Decision did not resolve its relation cell to the brand's name",
      );
      assert.deepEqual(
        rowBody.columnNames,
        { [bottleNameId]: "Name", [bottleBrandId]: "Brand" },
        "the row Decision did not resolve its cell-map keys to column names",
      );
      // The ids stay in the body the approve path reads: the names are siblings.
      const rowCells = rowBody.cells as Record<string, unknown>;
      assert.equal(rowCells[bottleNameId], "Waiting");
      assert.equal(rowCells[bottleBrandId], brandRowIds[3]);
      // The label pass is a read: the stored Decision must be untouched.
      assert.equal(
        await fs.readFile(pendingRowPath, "utf8"),
        storedPendingRow,
        "the display-label pass rewrote the stored Decision file",
      );

      // ── the broken file is left alone and reported once per process ──────
      assert.equal(
        await fs.readFile(brokenPath, "utf8"),
        brokenText,
        "the unparseable file was rewritten instead of left for repair",
      );
      const logAfterFirstRead = await readLog(root);
      assert.equal(logAfterFirstRead.ok, true);
      if (!logAfterFirstRead.ok) return;
      const unreadable = (events: typeof logAfterFirstRead.value) =>
        events.filter((event) => event.type === "decision.unreadable");
      assert.equal(
        unreadable(logAfterFirstRead.value).length,
        1,
        "the unparseable Decision was reported more than once in one read",
      );
      // A second read says nothing new: the report is once per process.
      await listDecisions(root);
      const logAfterSecondRead = await readLog(root);
      assert.equal(logAfterSecondRead.ok, true);
      if (!logAfterSecondRead.ok) return;
      assert.equal(
        unreadable(logAfterSecondRead.value).length,
        1,
        "the unparseable Decision was reported again on the next read",
      );

      // ── the budget, then the artifact only a held run writes ─────────────
      assert.ok(
        totalMs < BUDGET_MS,
        `a cold list+labels pass over ${SEEDED_DECISIONS} Decisions took ` +
          `${Math.round(totalMs)} ms (budget ${BUDGET_MS} ms): ` +
          "the read path has regressed to a serial walk",
      );

      const report = {
        pass: true,
        engine: "vault-core (plain Node, no Electron)",
        command:
          "cd apps/desktop && node --experimental-strip-types --test tests/decision-list-engine-e2e.test.ts",
        budgetMs: BUDGET_MS,
        timings: {
          listMs: Math.round(listMs),
          labelsMs: Math.round(labelMs),
          totalMs: Math.round(totalMs),
        },
        counts: {
          seededDecisions: SEEDED_DECISIONS,
          resolvedDecisions: RESOLVED_DECISIONS,
          resolvedDatabaseRows,
          pendingDecisions: PENDING_DECISIONS,
          listedDecisions: listed.value.length,
          labelledDecisions: labelled.length,
          skippedFiles: 2,
        },
        labels: {
          decisionId: pendingRow.value.id,
          databaseId: bottles.value.id,
          relationDatabaseId: brands.value.id,
          cellLabels: rowBody.cellLabels,
          columnNames: rowBody.columnNames,
        },
        files: {
          decisionsDir: ".lifequest/decisions/<id>.json",
          broken: "decisions/broken.json (unparseable, left untouched)",
          symlinked: "decisions/symlinked.json (link to a seeded Decision, skipped)",
        },
        vaultRoot: "<temporary, removed after the run>",
      };
      await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
      await fs.writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
