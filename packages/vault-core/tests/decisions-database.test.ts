// KAR-64 — Decision plumbing for database targets.
// Spec Test Plan cases 2 (createDecision target validation), 3 (normalizeDecision
// round trip), 4 (applyApprovedBody applies, and a failed apply resolves rather
// than strands), and 13 (existing target types are unaffected by the
// resolveDecision change).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { archiveDomain } from "../src/domains.ts";
import { createDecision, normalizeDecision, resolveDecision } from "../src/index.ts";
import {
  addDatabaseColumn,
  createDatabase,
  getDatabase,
  getRow,
  listDatabases,
  listDecisions,
  upsertRow,
} from "../src/index.ts";
import type { DatabaseDecisionBody, DocumentTarget } from "../src/index.ts";
import { createPage, getPage } from "../src/pages.ts";
import { USER_ACTOR } from "../src/types.ts";

const agent = { type: "agent" as const, id: "companion", name: "Hermes" };

const rowBody = (over: Partial<DatabaseDecisionBody> = {}): string =>
  JSON.stringify({
    op: "upsert",
    databaseName: "Ledger",
    rowLabel: "Coffee",
    previousCells: null,
    cells: {},
    expectedUpdatedAt: null,
    ...over,
  });

describe("KAR-64 database Decisions", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-kar64-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Kar64")).ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // ─── Test 2: createDecision target validation ────────────────────────────────
  describe("test 2: createDecision target validation", () => {
    it("accepts a database-row with rowId null (a create)", async () => {
      const db = await createDatabase(root, "health", { name: "Habits" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const created = await createDecision(root, {
        target: { type: "database-row", domainSlug: "health", databaseId: db.value.id, rowId: null },
        proposedTitle: "New habit row",
        proposedBodyMarkdown: rowBody(),
        actor: agent,
      });
      assert.equal(created.ok, true);
    });

    it("rejects a database-row with an empty rowId", async () => {
      const db = await createDatabase(root, "health", { name: "Habits2" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const created = await createDecision(root, {
        target: { type: "database-row", domainSlug: "health", databaseId: db.value.id, rowId: "" },
        proposedTitle: "Empty row id",
        proposedBodyMarkdown: rowBody(),
        actor: agent,
      });
      assert.equal(created.ok, false);
      if (created.ok) return;
      assert.match(created.error, /rowId/);
    });

    it("rejects a database-row with an empty domainSlug or databaseId", async () => {
      const db = await createDatabase(root, "health", { name: "Habits3" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const noDomain = await createDecision(root, {
        target: { type: "database-row", domainSlug: "", databaseId: db.value.id, rowId: null },
        proposedTitle: "No domain",
        proposedBodyMarkdown: rowBody(),
        actor: agent,
      });
      assert.equal(noDomain.ok, false);
      if (!noDomain.ok) assert.match(noDomain.error, /domainSlug/);

      const noDatabase = await createDecision(root, {
        target: { type: "database-row", domainSlug: "health", databaseId: "", rowId: null },
        proposedTitle: "No database",
        proposedBodyMarkdown: rowBody(),
        actor: agent,
      });
      assert.equal(noDatabase.ok, false);
      if (!noDatabase.ok) assert.match(noDatabase.error, /databaseId/);
    });

    it("accepts a database target with a non-empty id, rejects an empty one", async () => {
      // A create_database mints its id at propose time, so the branch tests a
      // value the caller can actually supply.
      const ok = await createDecision(root, {
        target: { type: "database", domainSlug: "intellectual", databaseId: "minted-uuid" },
        proposedTitle: 'New database "Reading" in intellectual',
        proposedBodyMarkdown: JSON.stringify({
          op: "create-database",
          databaseId: "minted-uuid",
          name: "Reading",
          databaseName: null,
          rowLabel: null,
          previousCells: null,
          cells: null,
          expectedUpdatedAt: null,
        }),
        actor: agent,
      });
      assert.equal(ok.ok, true);

      const empty = await createDecision(root, {
        target: { type: "database", domainSlug: "intellectual", databaseId: "" },
        proposedTitle: "Empty database id",
        proposedBodyMarkdown: "{}",
        actor: agent,
      });
      assert.equal(empty.ok, false);
      if (!empty.ok) assert.match(empty.error, /databaseId/);
    });
  });

  // ─── Test 3: normalizeDecision round trip ────────────────────────────────────
  describe("test 3: normalizeDecision round trip", () => {
    it("a persisted database-row target survives and derives domainSlugs", () => {
      const raw = {
        id: "d1",
        target: { type: "database-row", domainSlug: "financial", databaseId: "finance:accounts", rowId: "r1" },
        status: "pending",
        createdAt: "2026-09-27T00:00:00.000Z",
        actor: { type: "agent", id: "companion", name: "Hermes" },
        proposedBodyMarkdown: "{}",
      };
      const n = normalizeDecision(raw);
      assert.deepEqual(n.target, raw.target);
      assert.deepEqual(n.domainSlugs, ["financial"]);
      // reason must be in the rebuilt field set, not dropped on read.
      assert.equal(n.reason, null);
    });

    it("a database-row create round trips rowId null", () => {
      const n = normalizeDecision({
        id: "d2",
        target: { type: "database-row", domainSlug: "health", databaseId: "db1", rowId: null },
        status: "pending",
        createdAt: "2026-09-27T00:00:00.000Z",
        proposedBodyMarkdown: "{}",
      });
      assert.equal(n.target.type, "database-row");
      if (n.target.type !== "database-row") return;
      assert.equal(n.target.rowId, null);
      assert.deepEqual(n.domainSlugs, ["health"]);
    });

    it("a database target round trips and derives domainSlugs", () => {
      const n = normalizeDecision({
        id: "d3",
        target: { type: "database", domainSlug: "emotional", databaseId: "minted" },
        status: "pending",
        createdAt: "2026-09-27T00:00:00.000Z",
        proposedBodyMarkdown: "{}",
      });
      assert.deepEqual(n.target, { type: "database", domainSlug: "emotional", databaseId: "minted" });
      assert.deepEqual(n.domainSlugs, ["emotional"]);
    });

    it("neither new target rehydrates as a library target", () => {
      const row = normalizeDecision({
        id: "d4",
        target: { type: "database-row", domainSlug: "health", databaseId: "db1", rowId: "r1" },
        status: "pending",
        createdAt: "2026-09-27T00:00:00.000Z",
        proposedBodyMarkdown: "{}",
      });
      assert.notEqual(row.target.type, "library");
      const db = normalizeDecision({
        id: "d5",
        target: { type: "database", domainSlug: "health", databaseId: "db1" },
        status: "pending",
        createdAt: "2026-09-27T00:00:00.000Z",
        proposedBodyMarkdown: "{}",
      });
      assert.notEqual(db.target.type, "library");
    });

    it("a reason written to disk survives a re-read", async () => {
      const db = await createDatabase(root, "health", { name: "Reason" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const created = await createDecision(root, {
        target: { type: "database-row", domainSlug: "health", databaseId: db.value.id, rowId: null },
        proposedTitle: "Reason row",
        proposedBodyMarkdown: rowBody(),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const file = path.join(root, ".lifequest", "decisions", `${created.value.id}.json`);
      const onDisk = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      assert.equal("reason" in onDisk, true);
    });
  });

  // ─── Test 4: applyApprovedBody ───────────────────────────────────────────────
  describe("test 4: applyApprovedBody applies, and a failed apply resolves", () => {
    it("(a) approving a database-row upsert changes the row on disk", async () => {
      const db = await createDatabase(root, "health", { name: "Sleep" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "hours", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const hoursCol = col.value.columns.find((c) => c.name === "hours");
      assert.ok(hoursCol);

      const seeded = await upsertRow(root, "health", db.value.id, {
        id: "sleep-1",
        cells: { [hoursCol!.id]: 7 },
      });
      assert.equal(seeded.ok, true);

      const created = await createDecision(root, {
        target: { type: "database-row", domainSlug: "health", databaseId: db.value.id, rowId: "sleep-1" },
        proposedTitle: "Sleep row · 8 hours",
        proposedBodyMarkdown: rowBody({
          cells: { [hoursCol!.id]: 8 },
          previousCells: { [hoursCol!.id]: 7 },
          expectedUpdatedAt: seeded.ok ? seeded.value.updatedAt : null,
        }),
        previousBodyMarkdown: JSON.stringify({ [hoursCol!.id]: 7 }, null, 2),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      const resolved = await resolveDecision(root, created.value.id, "approved");
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.value.status, "approved");
      assert.equal(resolved.value.reason, null);

      const row = await getRow(root, "health", db.value.id, "sleep-1");
      assert.equal(row.ok, true);
      if (!row.ok) return;
      assert.equal(row.value.cells[hoursCol!.id], 8);
    });

    it("(b) a stale expectedUpdatedAt rejects with a reason and leaves the row untouched", async () => {
      const db = await createDatabase(root, "health", { name: "Steps" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "count", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const countCol = col.value.columns.find((c) => c.name === "count");
      assert.ok(countCol);

      const seeded = await upsertRow(root, "health", db.value.id, {
        id: "steps-1",
        cells: { [countCol!.id]: 1000 },
      });
      assert.equal(seeded.ok, true);
      if (!seeded.ok) return;

      // Propose against the state above, then move the row on before approval.
      const created = await createDecision(root, {
        target: { type: "database-row", domainSlug: "health", databaseId: db.value.id, rowId: "steps-1" },
        proposedTitle: "Steps row · 2000",
        proposedBodyMarkdown: rowBody({
          cells: { [countCol!.id]: 2000 },
          previousCells: { [countCol!.id]: 1000 },
          expectedUpdatedAt: seeded.value.updatedAt,
        }),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      // A week of intervening edits.
      const moved = await upsertRow(root, "health", db.value.id, {
        id: "steps-1",
        cells: { [countCol!.id]: 5555 },
      });
      assert.equal(moved.ok, true);

      const resolved = await resolveDecision(root, created.value.id, "approved");
      assert.equal(resolved.ok, false);

      const after = await listDecisions(root);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      const record = after.value.find((d) => d.id === created.value.id);
      assert.ok(record);
      // Terminal: rejected, not stranded pending.
      assert.equal(record!.status, "rejected");
      assert.ok(record!.reason);
      assert.match(record!.reason!, /Row changed/);

      // And the newer state was not clobbered.
      const row = await getRow(root, "health", db.value.id, "steps-1");
      assert.equal(row.ok, true);
      if (!row.ok) return;
      assert.equal(row.value.cells[countCol!.id], 5555);
    });

    it("(c) approving a database create registers the id minted at propose time", async () => {
      const minted = "minted-database-id-4c";
      const created = await createDecision(root, {
        target: { type: "database", domainSlug: "intellectual", databaseId: minted },
        proposedTitle: 'New database "Essays" in intellectual',
        proposedBodyMarkdown: JSON.stringify({
          op: "create-database",
          databaseId: minted,
          name: "Essays",
          databaseName: null,
          rowLabel: null,
          previousCells: null,
          cells: null,
          expectedUpdatedAt: null,
        }),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      const before = await listDatabases(root, "intellectual");
      assert.equal(before.ok, true);
      if (!before.ok) return;
      assert.equal(before.value.some((e) => e.database.id === minted), false);

      const resolved = await resolveDecision(root, created.value.id, "approved");
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.value.status, "approved");

      const db = await getDatabase(root, "intellectual", minted);
      assert.equal(db.ok, true);
      if (!db.ok) return;
      assert.equal(db.value.name, "Essays");
    });

    it("(c2) two approved creates with the same name both coexist (no uniqueness check)", async () => {
      for (const id of ["dup-a", "dup-b"]) {
        const created = await createDecision(root, {
          target: { type: "database", domainSlug: "emotional", databaseId: id },
          proposedTitle: 'New database "Journal" in emotional',
          proposedBodyMarkdown: JSON.stringify({
            op: "create-database",
            databaseId: id,
            name: "Journal",
            databaseName: null,
            rowLabel: null,
            previousCells: null,
            cells: null,
            expectedUpdatedAt: null,
          }),
          actor: agent,
        });
        assert.equal(created.ok, true);
        if (!created.ok) return;
        const resolved = await resolveDecision(root, created.value.id, "approved");
        assert.equal(resolved.ok, true);
      }
      const dbs = await listDatabases(root, "emotional");
      assert.equal(dbs.ok, true);
      if (!dbs.ok) return;
      const journals = dbs.value.filter((e) => e.database.name === "Journal");
      assert.equal(journals.length, 2);
    });

    it("(d) approving a database create in a domain archived since filing rejects with a reason", async () => {
      const minted = "minted-archived-id";
      const created = await createDecision(root, {
        target: { type: "database", domainSlug: "health", databaseId: minted },
        proposedTitle: 'New database "Archived plan" in health',
        proposedBodyMarkdown: JSON.stringify({
          op: "create-database",
          databaseId: minted,
          name: "Archived plan",
          databaseName: null,
          rowLabel: null,
          previousCells: null,
          cells: null,
          expectedUpdatedAt: null,
        }),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      assert.equal((await archiveDomain(root, "health")).ok, true);

      const resolved = await resolveDecision(root, created.value.id, "approved");
      assert.equal(resolved.ok, false);

      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === created.value.id);
      assert.ok(record);
      assert.equal(record!.status, "rejected");
      assert.ok(record!.reason);
      assert.match(record!.reason!, /archived/i);
      // Not stranded pending.
      assert.notEqual(record!.status, "pending");
    });

    it("an approved database-row delete removes the row", async () => {
      // health is archived by the previous case, so use a fresh domain.
      const domain = "emotional";
      const db = await createDatabase(root, domain, { name: "Reminders" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, domain, db.value.id, { name: "text", type: "text" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const textCol = col.value.columns.find((c) => c.name === "text");
      assert.ok(textCol);
      const seeded = await upsertRow(root, domain, db.value.id, {
        id: "rem-1",
        cells: { [textCol!.id]: "call mum" },
      });
      assert.equal(seeded.ok, true);

      const created = await createDecision(root, {
        target: { type: "database-row", domainSlug: domain, databaseId: db.value.id, rowId: "rem-1" },
        proposedTitle: "Delete reminder",
        proposedBodyMarkdown: rowBody({
          op: "delete",
          cells: null,
          previousCells: { [textCol!.id]: "call mum" },
          expectedUpdatedAt: seeded.ok ? seeded.value.updatedAt : null,
        }),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const resolved = await resolveDecision(root, created.value.id, "approved");
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.value.status, "approved");
      const gone = await getRow(root, domain, db.value.id, "rem-1");
      assert.equal(gone.ok, false);
    });

    it("an approved add-column adds the column named in the body", async () => {
      const domain = "intellectual";
      const db = await createDatabase(root, domain, { name: "Papers" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const created = await createDecision(root, {
        target: { type: "database", domainSlug: domain, databaseId: db.value.id },
        proposedTitle: 'Add column "Status" to Papers',
        proposedBodyMarkdown: JSON.stringify({
          op: "add-column",
          name: "Status",
          type: "select",
          options: ["to-read", "done"],
          databaseName: "Papers",
          rowLabel: null,
          previousCells: null,
          cells: null,
          expectedUpdatedAt: null,
        }),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const resolved = await resolveDecision(root, created.value.id, "approved");
      assert.equal(resolved.ok, true);
      const after = await getDatabase(root, domain, db.value.id);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      const added = after.value.columns.find((c) => c.name === "Status");
      assert.ok(added);
      assert.deepEqual(added!.options, ["to-read", "done"]);
    });
  });

  // ─── Test 13: existing target types keep today's behaviour ───────────────────
  describe("test 13: existing target types stay retryable on a transient failure", () => {
    it("a page Decision whose apply fails transiently stays pending and can be approved again", async () => {
      const page = await createPage(root, "intellectual", { title: "Transient" });
      assert.equal(page.ok, true);
      if (!page.ok) return;

      const created = await createDecision(root, {
        target: { type: "page", domainSlug: "intellectual", pageId: page.value.id },
        proposedTitle: "Transient page body",
        proposedBodyMarkdown: JSON.stringify({ title: "Transient", blocks: [] }),
        actor: agent,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      // Make the apply fail transiently: the pages directory is the write target,
      // so replacing it with a file makes the write fail with I/O, not validation.
      const pagesDir = path.join(root, "domains", "intellectual", "pages");
      const backup = path.join(dir, "pages-backup");
      await fs.rename(pagesDir, backup);
      await fs.writeFile(pagesDir, "not a directory");

      const failed = await resolveDecision(root, created.value.id, "approved");
      assert.equal(failed.ok, false);

      await fs.rm(pagesDir, { force: true });
      await fs.rename(backup, pagesDir);

      // Transient, so the record is still pending — not rejected, not stranded.
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === created.value.id);
      assert.ok(record);
      assert.equal(record!.status, "pending");
      assert.equal(record!.reason, null);

      // And it can be approved on a second attempt.
      const retried = await resolveDecision(root, created.value.id, "approved");
      assert.equal(retried.ok, true);
      if (!retried.ok) return;
      assert.equal(retried.value.status, "approved");
    });
  });
});

// Keep the type import used: the target union must carry both new variants.
const _targetTypeCheck: DocumentTarget[] = [
  { type: "database-row", domainSlug: "health", databaseId: "db", rowId: null },
  { type: "database", domainSlug: "health", databaseId: "db" },
];
void _targetTypeCheck;
