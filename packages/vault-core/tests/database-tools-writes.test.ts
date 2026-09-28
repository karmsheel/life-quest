// KAR-65 — write tools, Decision-gated. Spec Test Plan cases 5 (write half: every
// write files a Decision and nothing is written), 6 (actor integrity), 7
// (conflict scoping and matching key), 9 (replace semantics), and 10 (referential
// validation and dedup).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DATABASE_TOOL_DEFS,
  addDatabaseColumn,
  createDatabase,
  createVault,
  executeDatabaseTool,
  getDatabase,
  getRow,
  linkDatabaseAdapter,
  listDatabases,
  listDecisions,
  listRows,
  resolveDecision,
  upsertRow,
} from "../src/index.ts";
import { archiveDomain } from "../src/domains.ts";
import { installFinanceKit } from "../src/finance-kit.ts";
import { vaultPaths } from "../src/paths.ts";
import type { Actor, SyncConflict } from "../src/index.ts";

const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };
const OPERATOR: Actor = { type: "user", id: "u1", name: "You" };

/** linkDatabaseAdapter needs a secret store; the value is irrelevant here. */
class MemorySecretStore {
  private store = new Map<string, string>();
  async put(bindingId: string, secret: string): Promise<void> {
    this.store.set(bindingId, secret);
  }
  async get(bindingId: string): Promise<string | null> {
    return this.store.get(bindingId) ?? null;
  }
  async delete(bindingId: string): Promise<void> {
    this.store.delete(bindingId);
  }
}

type Ok = Record<string, unknown> & { decisionId: string; status: string };
const isOk = (r: unknown): r is Ok => !("error" in (r as Record<string, unknown>));

/** Write a conflict fixture the way the adapter sync path would. */
async function writeConflicts(
  root: string,
  slug: string,
  conflicts: SyncConflict[],
): Promise<void> {
  const file = vaultPaths(root).domainConflicts(slug);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ conflicts }, null, 2));
}

describe("KAR-65 Decision-gated database writes", () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-kar65-"));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function freshVault(name: string): Promise<string> {
    const root = path.join(dir, name);
    assert.equal((await createVault(root, name)).ok, true);
    return root;
  }

  // ─── Test 5 (write half): nothing is written, a Decision is filed ───────────
  describe("test 5 (write half): writes file Decisions and change nothing", () => {
    it("upsert_row files a pending Decision and leaves the row untouched", async () => {
      const root = await freshVault("write-upsert");
      const db = await createDatabase(root, "health", { name: "Water" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const ml = col.value.columns.find((c) => c.name === "ml")!.id;
      const seeded = await upsertRow(root, "health", db.value.id, { id: "w-1", cells: { [ml]: 500 } });
      assert.equal(seeded.ok, true);

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "w-1",
        cells: { [ml]: 900 },
      });
      assert.ok(isOk(res), JSON.stringify(res));
      assert.equal(res.status, "pending");

      // Nothing was written: the row is exactly as it was.
      const after = await getRow(root, "health", db.value.id, "w-1");
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.cells[ml], 500);

      // And the proposal is on disk, pending.
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === res.decisionId);
      assert.ok(record);
      assert.equal(record!.status, "pending");
      assert.equal(record!.actor.type, "agent");

      // Approving is what writes.
      const resolved = await resolveDecision(root, res.decisionId, "approved");
      assert.equal(resolved.ok, true);
      const written = await getRow(root, "health", db.value.id, "w-1");
      assert.equal(written.ok, true);
      if (!written.ok) return;
      assert.equal(written.value.cells[ml], 900);
    });

    it("delete_row files a Decision and leaves the row in place", async () => {
      const root = await freshVault("write-delete");
      const db = await createDatabase(root, "health", { name: "Tasks" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "text", type: "text" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const textCol = col.value.columns.find((c) => c.name === "text")!.id;
      assert.equal(
        (await upsertRow(root, "health", db.value.id, { id: "t-1", cells: { [textCol]: "buy milk" } })).ok,
        true,
      );

      const res = await executeDatabaseTool(root, AGENT, "delete_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "t-1",
      });
      assert.ok(isOk(res), JSON.stringify(res));
      assert.equal((await getRow(root, "health", db.value.id, "t-1")).ok, true);

      assert.equal((await resolveDecision(root, res.decisionId, "approved")).ok, true);
      assert.equal((await getRow(root, "health", db.value.id, "t-1")).ok, false);
    });

    it("create_database files a Decision; the database appears only on approve", async () => {
      const root = await freshVault("write-create");
      const res = await executeDatabaseTool(root, AGENT, "create_database", {
        domainSlug: "intellectual",
        name: "Reading list",
      });
      assert.ok(isOk(res), JSON.stringify(res));
      assert.equal(res.status, "pending");

      const before = await listDatabases(root, "intellectual");
      assert.equal(before.ok, true);
      if (!before.ok) return;
      assert.equal(before.value.length, 0, "nothing is created at propose time");

      assert.equal((await resolveDecision(root, res.decisionId, "approved")).ok, true);
      const after = await listDatabases(root, "intellectual");
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.length, 1);
      assert.equal(after.value[0].database.name, "Reading list");
    });

    it("add_column files a Decision; the column appears only on approve", async () => {
      const root = await freshVault("write-column");
      const db = await createDatabase(root, "health", { name: "Habits" });
      assert.equal(db.ok, true);
      if (!db.ok) return;

      const res = await executeDatabaseTool(root, AGENT, "add_column", {
        domainSlug: "health",
        databaseId: db.value.id,
        name: "Streak",
        type: "number",
      });
      assert.ok(isOk(res), JSON.stringify(res));

      const before = await getDatabase(root, "health", db.value.id);
      assert.equal(before.ok, true);
      if (!before.ok) return;
      assert.equal(before.value.columns.length, 0);

      assert.equal((await resolveDecision(root, res.decisionId, "approved")).ok, true);
      const after = await getDatabase(root, "health", db.value.id);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.columns.length, 1);
      assert.equal(after.value.columns[0].name, "Streak");
    });

    it("the gating matrix: every database in every live domain files a Decision", async () => {
      // Finance kit db, operator-created db in financial, and a non-finance
      // domain, across all four write tools. No case writes directly.
      const root = await freshVault("write-matrix");
      assert.equal((await installFinanceKit(root, { type: "user", id: "u", name: "You" })).ok, true);

      const accounts = await getDatabase(root, "financial", "finance:accounts");
      assert.equal(accounts.ok, true);
      if (!accounts.ok) return;
      const accName = accounts.value.columns.find((c) => c.name === "name")!.id;

      // An operator-created database inside the financial domain: local-only,
      // not in the kit's id list. It must still be gated.
      const operatorDb = await createDatabase(root, "financial", { name: "Rent tracker" });
      assert.equal(operatorDb.ok, true);
      if (!operatorDb.ok) return;
      const rentCol = await addDatabaseColumn(root, "financial", operatorDb.value.id, {
        name: "amount",
        type: "number",
      });
      assert.equal(rentCol.ok, true);
      if (!rentCol.ok) return;
      const rentAmount = rentCol.value.columns.find((c) => c.name === "amount")!.id;

      // A local-only database in a non-finance domain.
      const local = await createDatabase(root, "health", { name: "Local only" });
      assert.equal(local.ok, true);
      if (!local.ok) return;
      const localCol = await addDatabaseColumn(root, "health", local.value.id, {
        name: "n",
        type: "number",
      });
      assert.equal(localCol.ok, true);
      if (!localCol.ok) return;
      const localN = localCol.value.columns.find((c) => c.name === "n")!.id;

      const cases: Array<{ label: string; tool: string; args: Record<string, unknown> }> = [
        { label: "finance kit db upsert", tool: "upsert_row", args: { domainSlug: "financial", databaseId: "finance:accounts", cells: { [accName]: "Cheque" } } },
        { label: "operator db in financial upsert", tool: "upsert_row", args: { domainSlug: "financial", databaseId: operatorDb.value.id, cells: { [rentAmount]: 8000 } } },
        { label: "local-only upsert", tool: "upsert_row", args: { domainSlug: "health", databaseId: local.value.id, cells: { [localN]: 3 } } },
        { label: "finance create_database", tool: "create_database", args: { domainSlug: "financial", name: "New finance db" } },
        { label: "local-only create_database", tool: "create_database", args: { domainSlug: "health", name: "New health db" } },
        { label: "local-only add_column", tool: "add_column", args: { domainSlug: "health", databaseId: local.value.id, name: "Extra", type: "text" } },
        { label: "operator db add_column", tool: "add_column", args: { domainSlug: "financial", databaseId: operatorDb.value.id, name: "Extra", type: "text" } },
      ];

      for (const c of cases) {
        const res = await executeDatabaseTool(root, AGENT, c.tool, c.args);
        assert.ok(isOk(res), `${c.label} must file a Decision, got ${JSON.stringify(res)}`);
        assert.equal(res.status, "pending", c.label);
      }

      // No write leaked: only the rows the tests seeded directly exist.
      const localRows = await listRows(root, "health", local.value.id);
      assert.equal(localRows.ok, true);
      if (localRows.ok) assert.equal(localRows.value.length, 0, "no row was written directly");
      const rentRows = await listRows(root, "financial", operatorDb.value.id);
      assert.equal(rentRows.ok, true);
      if (rentRows.ok) assert.equal(rentRows.value.length, 0);

      // And every one filed a pending Decision.
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      assert.equal(listed.value.length, cases.length);
      assert.equal(listed.value.every((d) => d.status === "pending"), true);
    });

    it("delete_row is gated too, on a finance database", async () => {
      const root = await freshVault("write-delete-finance");
      assert.equal((await installFinanceKit(root, { type: "user", id: "u", name: "You" })).ok, true);
      const accCol = await addDatabaseColumn(root, "financial", "finance:accounts", {
        name: "name",
        type: "text",
      });
      assert.equal(accCol.ok, true);
      if (!accCol.ok) return;
      const nameCol = accCol.value.columns.find((c) => c.name === "name")!.id;
      assert.equal(
        (await upsertRow(root, "financial", "finance:accounts", { id: "acc-1", cells: { [nameCol]: "Cheque" } })).ok,
        true,
      );

      const res = await executeDatabaseTool(root, AGENT, "delete_row", {
        domainSlug: "financial",
        databaseId: "finance:accounts",
        id: "acc-1",
      });
      assert.ok(isOk(res), JSON.stringify(res));
      // The row survives until the operator approves.
      assert.equal((await getRow(root, "financial", "finance:accounts", "acc-1")).ok, true);
    });

    it("an archived domain is NOT_FOUND on every write tool and files nothing", async () => {
      const root = await freshVault("write-archived");
      const db = await createDatabase(root, "emotional", { name: "Feelings" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "emotional", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns.find((c) => c.name === "n")!.id;
      assert.equal((await archiveDomain(root, "emotional")).ok, true);

      const calls: Array<{ tool: string; args: Record<string, unknown> }> = [
        { tool: "upsert_row", args: { domainSlug: "emotional", databaseId: db.value.id, cells: { [n]: 1 } } },
        { tool: "delete_row", args: { domainSlug: "emotional", databaseId: db.value.id, id: "x" } },
        { tool: "add_column", args: { domainSlug: "emotional", databaseId: db.value.id, name: "x", type: "text" } },
        { tool: "create_database", args: { domainSlug: "emotional", name: "x" } },
      ];
      for (const c of calls) {
        const res = await executeDatabaseTool(root, AGENT, c.tool, c.args);
        assert.ok(!isOk(res), `${c.tool} on an archived domain must not file anything`);
        assert.equal(res.error.code, "NOT_FOUND", c.tool);
      }
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (listed.ok) assert.equal(listed.value.length, 0);
    });
  });

  // ─── Test 6: actor integrity ────────────────────────────────────────────────
  describe("test 6: actor integrity", () => {
    it("an actor key in args is ignored; the record carries the executeTool actor", async () => {
      const root = await freshVault("actor");
      const db = await createDatabase(root, "health", { name: "Journal" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "text", type: "text" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const textCol = col.value.columns.find((c) => c.name === "text")!.id;

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { [textCol]: "today" },
        // A model trying to pass itself off as the operator.
        actor: { type: "user", id: "u1", name: "You" },
      });
      assert.ok(isOk(res), JSON.stringify(res));

      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === res.decisionId);
      assert.ok(record);
      // The companion, from the actor argument — never the one in args.
      assert.deepEqual(record!.actor, { type: "agent", id: "companion", name: "Hermes" });
    });

    it("no write tool declares an actor parameter", () => {
      for (const name of ["upsert_row", "delete_row", "create_database", "add_column"]) {
        const def = DATABASE_TOOL_DEFS.find((t) => t.name === name)!;
        const props = Object.keys(
          (def.parameters as { properties?: Record<string, unknown> }).properties ?? {},
        );
        assert.equal(props.includes("actor"), false, `${name} must not accept an actor`);
      }
    });

    it("the agent cannot approve or reject a Decision through the tool surface", async () => {
      const root = await freshVault("no-resolve");
      const db = await createDatabase(root, "health", { name: "Notes" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "text", type: "text" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const textCol = col.value.columns.find((c) => c.name === "text")!.id;
      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { [textCol]: "x" },
      });
      assert.ok(isOk(res));

      // There is no resolve tool at all, and list_decisions cannot resolve.
      assert.equal(DATABASE_TOOL_DEFS.some((t) => t.name.includes("resolve")), false);
      const listed = await executeDatabaseTool(root, AGENT, "list_decisions", {
        resolution: "approved",
        decisionId: res.decisionId,
      });
      assert.ok(isOk(listed));
      // Still pending: reading it did not approve it.
      const after = await listDecisions(root);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.find((d) => d.id === res.decisionId)!.status, "pending");
    });
  });

  // ─── Test 7: conflict scoping and matching key ──────────────────────────────
  describe("test 7: conflict scoping and matching key", () => {
    async function linkedVault(name: string): Promise<{ root: string; databaseId: string; n: string }> {
      const root = await freshVault(name);
      const db = await createDatabase(root, "health", { name: "Mirrored" });
      assert.equal(db.ok, true);
      if (!db.ok) return { root, databaseId: "", n: "" };
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return { root, databaseId: "", n: "" };
      // An adapter binding is what makes the conflict check run at all.
      const linked = await linkDatabaseAdapter(
        root,
        "health",
        db.value.id,
        {
          kind: "google-sheet",
          bindingId: "sheet-1",
          secret: "token",
          sotMode: "linked-canonical",
          // Operator-only: the agent may not link an adapter itself.
          actor: OPERATOR,
        },
        { secrets: new MemorySecretStore() },
      );
      assert.equal(linked.ok, true, JSON.stringify(linked));
      assert.equal(
        (await upsertRow(root, "health", db.value.id, { id: "row-a", cells: { [col.value.columns[0].id]: 1 } })).ok,
        true,
      );
      return { root, databaseId: db.value.id, n: col.value.columns[0].id };
    }

    const conflict = (over: Partial<SyncConflict>): SyncConflict => ({
      id: "c1",
      databaseId: "",
      externalId: "ext-1",
      rowId: null,
      localCells: {},
      remoteCells: {},
      fields: [],
      defaultChoice: "keep-local",
      ...over,
    });

    it("(a) a conflict whose rowId is the target row blocks the write and files nothing", async () => {
      const { root, databaseId, n } = await linkedVault("conflict-target");
      await writeConflicts(root, "health", [
        conflict({ databaseId, rowId: "row-a", externalId: "ext-a" }),
      ]);

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId,
        id: "row-a",
        cells: { [n]: 2 },
      });
      assert.ok(!isOk(res), "a conflict on the target row must block the write");
      assert.equal(res.error.code, "CONFLICT");

      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (listed.ok) assert.equal(listed.value.length, 0, "a blocked write files nothing");
    });

    it("(b) a conflict on an unrelated row does not block the write", async () => {
      const { root, databaseId, n } = await linkedVault("conflict-unrelated");
      assert.equal((await upsertRow(root, "health", databaseId, { id: "row-b", cells: { [n]: 1 } })).ok, true);
      await writeConflicts(root, "health", [
        conflict({ databaseId, rowId: "row-a", externalId: "ext-a" }),
      ]);

      // row-b is not the conflicting row, so this proposal goes through.
      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId,
        id: "row-b",
        cells: { [n]: 2 },
      });
      assert.ok(isOk(res), JSON.stringify(res));
    });

    it("(c) a create while any conflict exists on the database is CONFLICT, with the rows listed", async () => {
      const { root, databaseId, n } = await linkedVault("conflict-create");
      await writeConflicts(root, "health", [
        conflict({ databaseId, rowId: "row-a", externalId: "ext-a" }),
        conflict({ id: "c2", databaseId, rowId: "row-c", externalId: "ext-c" }),
      ]);

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId,
        // no id: a create, which cannot be attributed to a specific row
        cells: { [n]: 9 },
      });
      assert.ok(!isOk(res));
      assert.equal(res.error.code, "CONFLICT");
      assert.match(res.error.message, /row-a/);
      assert.match(res.error.message, /row-c/);
      assert.match(res.error.message, /resolve the outstanding sync conflicts/i);
    });

    it("a rowId:null conflict is still caught by the externalId fallback", async () => {
      const root = await freshVault("conflict-fallback");
      const db = await createDatabase(root, "health", { name: "Ext" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "external_id", type: "text" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const extCol = col.value.columns[0].id;
      const linked = await linkDatabaseAdapter(
        root,
        "health",
        db.value.id,
        {
          kind: "google-sheet",
          bindingId: "sheet-1",
          secret: "token",
          sotMode: "linked-canonical",
          actor: OPERATOR,
        },
        { secrets: new MemorySecretStore() },
      );
      assert.equal(linked.ok, true, JSON.stringify(linked));
      assert.equal(
        (await upsertRow(root, "health", db.value.id, { id: "row-x", cells: { [extCol]: "ext-1" } })).ok,
        true,
      );
      // A conflict with no local row id, only a remote external id.
      await writeConflicts(root, "health", [
        conflict({ databaseId: db.value.id, rowId: null, externalId: "ext-1" }),
      ]);

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "row-x",
        cells: { [extCol]: "ext-1" },
      });
      assert.ok(!isOk(res), "the externalId fallback must catch a rowId:null conflict");
      assert.equal(res.error.code, "CONFLICT");
    });

    it("a database with no adapter is never conflict-checked", async () => {
      const root = await freshVault("conflict-no-adapter");
      const db = await createDatabase(root, "health", { name: "Plain" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns[0].id;
      // A conflict file exists, but adapter is null so the check is skipped.
      await writeConflicts(root, "health", [conflict({ databaseId: db.value.id, rowId: "row-a" })]);

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { [n]: 1 },
      });
      assert.ok(isOk(res), JSON.stringify(res));
    });
  });

  // ─── Test 9: replace semantics ──────────────────────────────────────────────
  describe("test 9: replace semantics", () => {
    it("an upsert omitting an existing column produces a row without it", async () => {
      const root = await freshVault("replace");
      const db = await createDatabase(root, "health", { name: "Profile" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const a = await addDatabaseColumn(root, "health", db.value.id, { name: "name", type: "text" });
      assert.equal(a.ok, true);
      if (!a.ok) return;
      const b = await addDatabaseColumn(root, "health", db.value.id, { name: "age", type: "number" });
      assert.equal(b.ok, true);
      if (!b.ok) return;
      const nameCol = a.value.columns[0].id;
      const ageCol = b.value.columns[b.value.columns.length - 1].id;

      const seeded = await upsertRow(root, "health", db.value.id, {
        id: "p-1",
        cells: { [nameCol]: "Ada", [ageCol]: 36 },
      });
      assert.equal(seeded.ok, true);

      // The proposal deliberately carries only one of the two cells.
      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "p-1",
        cells: { [nameCol]: "Ada Lovelace" },
      });
      assert.ok(isOk(res), JSON.stringify(res));

      // previousBodyMarkdown holds the pre-propose cells: a real before/after.
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === res.decisionId)!;
      assert.ok(record.previousBodyMarkdown, "the inbox needs the pre-propose cells");
      const previous = JSON.parse(record.previousBodyMarkdown!) as Record<string, unknown>;
      assert.equal(previous[nameCol], "Ada");
      assert.equal(previous[ageCol], 36);

      // On approve the cell map is replaced wholesale, so age is gone. This is
      // documented behaviour, guarded by the description, the before/after, and
      // the staleness guard — not prevented by merging.
      assert.equal((await resolveDecision(root, res.decisionId, "approved")).ok, true);
      const after = await getRow(root, "health", db.value.id, "p-1");
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.cells[nameCol], "Ada Lovelace");
      assert.equal(ageCol in after.value.cells, false, "upsertRow is a full replace");
    });

    it("a create records null previousCells and no expectedUpdatedAt", async () => {
      const root = await freshVault("replace-create");
      const db = await createDatabase(root, "health", { name: "New" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns[0].id;

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { [n]: 1 },
      });
      assert.ok(isOk(res), JSON.stringify(res));
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === res.decisionId)!;
      assert.equal(record.previousBodyMarkdown, null);
      const body = JSON.parse(record.proposedBodyMarkdown) as Record<string, unknown>;
      assert.equal(body.expectedUpdatedAt, null);
      assert.equal(body.previousCells, null);
      // A create carries rowId: null on the target.
      assert.equal(record.target.type, "database-row");
      if (record.target.type === "database-row") assert.equal(record.target.rowId, null);
    });
  });

  // ─── Test 10: referential validation and dedup ──────────────────────────────
  describe("test 10: referential validation and dedup", () => {
    async function financeLedger(name: string) {
      const root = await freshVault(name);
      assert.equal((await installFinanceKit(root, { type: "user", id: "u", name: "You" })).ok, true);
      const accounts = await getDatabase(root, "financial", "finance:accounts");
      assert.equal(accounts.ok, true);
      if (!accounts.ok) return null;
      const accName = accounts.value.columns.find((c) => c.name === "name")!.id;
      assert.equal(
        (await upsertRow(root, "financial", "finance:accounts", { id: "acc-cheque", cells: { [accName]: "Cheque" } })).ok,
        true,
      );
      const tx = await getDatabase(root, "financial", "finance:transactions");
      assert.equal(tx.ok, true);
      if (!tx.ok) return null;
      const colId = (n: string) => tx.value.columns.find((c) => c.name.toLowerCase() === n)!.id;
      return { root, accountsId: accounts.value.id, accName, txId: tx.value.id, colId };
    }

    it("a transaction naming a non-existent account row is VALIDATION and files nothing", async () => {
      const f = await financeLedger("ref-account");
      if (!f) return;
      const res = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: {
          [f.colId("date")]: "2026-09-27",
          [f.colId("amount")]: -85,
          [f.colId("account")]: "acc-does-not-exist",
        },
      });
      assert.ok(!isOk(res), JSON.stringify(res));
      assert.equal(res.error.code, "VALIDATION");
      const listed = await listDecisions(f.root);
      assert.equal(listed.ok, true);
      if (listed.ok) assert.equal(listed.value.length, 0, "a rejected proposal files nothing");
    });

    it("a transaction naming an existing account row is accepted", async () => {
      const f = await financeLedger("ref-account-ok");
      if (!f) return;
      const res = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: {
          [f.colId("date")]: "2026-09-27",
          [f.colId("amount")]: -85,
          [f.colId("account")]: "acc-cheque",
        },
      });
      assert.ok(isOk(res), JSON.stringify(res));
    });

    it("a posted transaction needs a valid date and a non-zero amount", async () => {
      const f = await financeLedger("ref-posted");
      if (!f) return;
      const noDate = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: { [f.colId("amount")]: -85, [f.colId("account")]: "acc-cheque" },
      });
      assert.ok(!isOk(noDate));
      assert.equal(noDate.error.code, "VALIDATION");

      const badDate = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: {
          [f.colId("date")]: "27/09/2026",
          [f.colId("amount")]: -85,
          [f.colId("account")]: "acc-cheque",
        },
      });
      assert.ok(!isOk(badDate));
      assert.equal(badDate.error.code, "VALIDATION");

      const zero = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: {
          [f.colId("date")]: "2026-09-27",
          [f.colId("amount")]: 0,
          [f.colId("account")]: "acc-cheque",
        },
      });
      assert.ok(!isOk(zero));
      assert.equal(zero.error.code, "VALIDATION");
    });

    it("a duplicate external_id is VALIDATION, including against a recent row past the first 500", async () => {
      // This is the failure mode of the paged-scan approach the design replaced:
      // a bounded scan sees only the oldest 500 rows and misses exactly the
      // recent duplicate that matters. lookupExternalId does a full read.
      const f = await financeLedger("dedup");
      if (!f) return;
      const extCol = f.colId("external_id");
      const base = {
        [f.colId("date")]: "2026-09-01",
        [f.colId("amount")]: -10,
        [f.colId("account")]: "acc-cheque",
      };

      // 600 rows, none carrying the id we will then propose.
      const sqlitePath = path.join(f.root, "domains", "financial", "data", "domain.sqlite");
      const sqlite = new DatabaseSync(sqlitePath);
      const insert = sqlite.prepare(
        "INSERT INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
      );
      for (let i = 0; i < 600; i++) {
        const cells = { ...base, [extCol]: `batch-${i}` };
        insert.run(
          f.txId,
          `tx-${String(i).padStart(4, "0")}`,
          new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          JSON.stringify(cells),
        );
      }
      // The duplicate lives at the very end: row 600 of 600, well past any
      // oldest-500 window.
      insert.run(
        f.txId,
        "tx-9999",
        "2026-09-27T00:00:00.000Z",
        "2026-09-27T00:00:00.000Z",
        JSON.stringify({ ...base, [extCol]: "recent-dupe" }),
      );
      sqlite.close();

      const dupe = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: { ...base, [extCol]: "recent-dupe" },
      });
      assert.ok(!isOk(dupe), "a recent duplicate must still be caught");
      assert.equal(dupe.error.code, "VALIDATION");
      assert.match(dupe.error.message, /recent-dupe/);

      // A genuinely new external id is fine.
      const fresh = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: { ...base, [extCol]: "brand-new" },
      });
      assert.ok(isOk(fresh), JSON.stringify(fresh));
    });

    it("external_id: null, the capture_transaction shape, is not rejected by dedup", async () => {
      const f = await financeLedger("dedup-null");
      if (!f) return;
      const base = {
        [f.colId("date")]: "2026-09-27",
        [f.colId("amount")]: -85,
        [f.colId("account")]: "acc-cheque",
        [f.colId("external_id")]: null,
      };
      // Two chat-posted rows both carrying a null external id: neither collides.
      const first = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: base,
      });
      assert.ok(isOk(first), JSON.stringify(first));
      const second = await executeDatabaseTool(f.root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId: f.txId,
        cells: { ...base, [f.colId("amount")]: -90 },
      });
      assert.ok(isOk(second), JSON.stringify(second));
    });

    it("a relation cell pointing at a missing row is VALIDATION", async () => {
      const root = await freshVault("ref-relation");
      const accounts = await createDatabase(root, "health", { name: "People" });
      assert.equal(accounts.ok, true);
      if (!accounts.ok) return;
      const aCol = await addDatabaseColumn(root, "health", accounts.value.id, { name: "name", type: "text" });
      assert.equal(aCol.ok, true);
      if (!aCol.ok) return;
      assert.equal(
        (await upsertRow(root, "health", accounts.value.id, { id: "p-1", cells: { [aCol.value.columns[0].id]: "Ada" } })).ok,
        true,
      );

      const notes = await createDatabase(root, "health", { name: "Notes" });
      assert.equal(notes.ok, true);
      if (!notes.ok) return;
      const relCol = await addDatabaseColumn(root, "health", notes.value.id, {
        name: "about",
        type: "relation",
        relationDatabaseId: accounts.value.id,
      });
      assert.equal(relCol.ok, true);
      if (!relCol.ok) return;
      const about = relCol.value.columns[0].id;

      const missing = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: notes.value.id,
        cells: { [about]: "p-nope" },
      });
      assert.ok(!isOk(missing), JSON.stringify(missing));
      assert.equal(missing.error.code, "VALIDATION");

      const present = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: notes.value.id,
        cells: { [about]: "p-1" },
      });
      assert.ok(isOk(present), JSON.stringify(present));
    });

    it("an unknown column id in cells is VALIDATION", async () => {
      const root = await freshVault("ref-unknown-col");
      const db = await createDatabase(root, "health", { name: "Thing" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { "not-a-column": 1 },
      });
      assert.ok(!isOk(res));
      assert.equal(res.error.code, "VALIDATION");
    });

    it("an empty or non-object cells is VALIDATION", async () => {
      const root = await freshVault("ref-bad-cells");
      const db = await createDatabase(root, "health", { name: "Thing" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      for (const cells of [{}, [], null, "x", 5]) {
        const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
          domainSlug: "health",
          databaseId: db.value.id,
          cells,
        });
        assert.ok(!isOk(res), `cells ${JSON.stringify(cells)} must be rejected`);
        assert.equal(res.error.code, "VALIDATION");
      }
    });
  });

  // ─── list_decisions and end-to-end ──────────────────────────────────────────
  describe("list_decisions and end-to-end", () => {
    it("list_decisions shows proposals newest first, with an optional status filter", async () => {
      const root = await freshVault("list-decisions");
      const db = await createDatabase(root, "health", { name: "L" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns[0].id;

      const a = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health", databaseId: db.value.id, cells: { [n]: 1 },
      });
      assert.ok(isOk(a));
      const b = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health", databaseId: db.value.id, cells: { [n]: 2 },
      });
      assert.ok(isOk(b));
      assert.equal((await resolveDecision(root, a.decisionId, "rejected")).ok, true);

      const all = await executeDatabaseTool(root, AGENT, "list_decisions", {});
      assert.ok(isOk(all));
      const items = (all as unknown as { decisions: Array<{ id: string; status: string }> }).decisions;
      assert.equal(items.length, 2);
      // Newest first.
      const stamps = items.map((d) => d.id);
      assert.equal(stamps[0], b.decisionId);

      const pending = await executeDatabaseTool(root, AGENT, "list_decisions", { status: "pending" });
      assert.ok(isOk(pending));
      assert.deepEqual(
        (pending as unknown as { decisions: Array<{ id: string }> }).decisions.map((d) => d.id),
        [b.decisionId],
      );

      const rejected = await executeDatabaseTool(root, AGENT, "list_decisions", { status: "rejected" });
      assert.ok(isOk(rejected));
      assert.equal(
        (rejected as unknown as { decisions: Array<{ id: string }> }).decisions.length,
        1,
      );

      const bad = await executeDatabaseTool(root, AGENT, "list_decisions", { status: "nope" });
      assert.ok(!isOk(bad));
      assert.equal(bad.error.code, "VALIDATION");
    });

    it("propose then approve actually changes the row end-to-end", async () => {
      const root = await freshVault("e2e");
      const db = await createDatabase(root, "health", { name: "E2E" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns[0].id;

      const proposed = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { [n]: 42 },
      });
      assert.ok(isOk(proposed), JSON.stringify(proposed));
      // Nothing yet.
      assert.equal((await listRows(root, "health", db.value.id)).ok, true);
      const none = await listRows(root, "health", db.value.id);
      if (none.ok) assert.equal(none.value.length, 0);

      assert.equal((await resolveDecision(root, proposed.decisionId, "approved")).ok, true);
      const after = await listRows(root, "health", db.value.id);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.length, 1);
      assert.equal(after.value[0].cells[n], 42);
    });

    it("a rejected Decision does nothing and must not be retryable as a silent write", async () => {
      const root = await freshVault("rejected");
      const db = await createDatabase(root, "health", { name: "R" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns[0].id;

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        cells: { [n]: 7 },
      });
      assert.ok(isOk(res));
      assert.equal((await resolveDecision(root, res.decisionId, "rejected")).ok, true);

      const rows = await listRows(root, "health", db.value.id);
      assert.equal(rows.ok, true);
      if (rows.ok) assert.equal(rows.value.length, 0, "a rejected Decision does nothing");
    });

    it("a stale proposal rejects on apply with a reason instead of stranding", async () => {
      const root = await freshVault("stale");
      const db = await createDatabase(root, "health", { name: "S" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns[0].id;
      const seeded = await upsertRow(root, "health", db.value.id, { id: "s-1", cells: { [n]: 1 } });
      assert.equal(seeded.ok, true);
      if (!seeded.ok) return;

      const res = await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "s-1",
        cells: { [n]: 2 },
      });
      assert.ok(isOk(res));
      // The row moves on before the operator gets to it.
      assert.equal((await upsertRow(root, "health", db.value.id, { id: "s-1", cells: { [n]: 99 } })).ok, true);

      assert.equal((await resolveDecision(root, res.decisionId, "approved")).ok, false);
      const listed = await listDecisions(root);
      assert.equal(listed.ok, true);
      if (!listed.ok) return;
      const record = listed.value.find((d) => d.id === res.decisionId)!;
      assert.equal(record.status, "rejected", "terminal, not stranded pending");
      assert.ok(record.reason);
      assert.match(record.reason!, /Row changed/);

      // The newer value was not clobbered.
      const after = await getRow(root, "health", db.value.id, "s-1");
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.cells[n], 99);
    });

    it("duplicate database names both get approved and coexist", async () => {
      const root = await freshVault("dup-names");
      for (const name of ["Journal", "Journal"]) {
        const res = await executeDatabaseTool(root, AGENT, "create_database", {
          domainSlug: "emotional",
          name,
        });
        assert.ok(isOk(res), JSON.stringify(res));
        assert.equal((await resolveDecision(root, res.decisionId, "approved")).ok, true);
      }
      const dbs = await listDatabases(root, "emotional");
      assert.equal(dbs.ok, true);
      if (!dbs.ok) return;
      assert.equal(dbs.value.filter((e) => e.database.name === "Journal").length, 2);
    });
  });
});
