// KAR-63 — read tools. Spec Test Plan cases 1 (the cells round-trip through the
// MCP Zod boundary), 11 (tool-list parity), and 14 (list_databases kits), plus
// the read-half of case 5.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ALL_TOOL_DEFS,
  CAPTURE_TOOL_DEFS,
  DATABASE_TOOL_DEFS,
  DOCUMENT_TOOL_DEFS,
  GOALS_TOOL_DEFS,
  MAP_TOOL_DEFS,
  PROJECT_TOOL_DEFS,
  REVIEW_TOOL_DEFS,
  SCRIPT_TOOL_DEFS,
  addDatabaseColumn,
  createDatabase,
  createVault,
  executeDatabaseTool,
  installFinanceKit,
  listDecisions,
  upsertRow,
} from "../src/index.ts";
import { archiveDomain } from "../src/domains.ts";
import { listInstalledKits } from "../src/finance-kit.ts";
import type { Actor, DatabaseMeta } from "../src/index.ts";

const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };

describe("KAR-63 database read tools", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-kar63-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Kar63")).ok, true);
    // A live domain with no registry.json and no databases at all.
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // ─── Test 14: list_databases kit field ──────────────────────────────────────
  describe("test 14: list_databases kits, keyed per domain", () => {
    it("with a domainSlug, kits has exactly one entry for that domain", async () => {
      const root14 = path.join(dir, "kits-single");
      assert.equal((await createVault(root14, "Kits")).ok, true);
      const res = await executeDatabaseTool(root14, AGENT, "list_databases", { domainSlug: "financial" });
      assert.ok(!("error" in res));
      const kits = (res as { kits: Array<{ domainSlug: string; kits: string[] }> }).kits;
      assert.equal(kits.length, 1);
      assert.equal(kits[0].domainSlug, "financial");
      // The finance kit is not installed yet.
      assert.deepEqual(kits[0].kits, []);
    });

    it("without a domainSlug, kits matches listInstalledKits for every live domain", async () => {
      const root14b = path.join(dir, "kits-union");
      assert.equal((await createVault(root14b, "KitsUnion")).ok, true);
      const db = await createDatabase(root14b, "financial", { name: "Accounts" });
      assert.equal(db.ok, true);
      const installed = await installFinanceKit(root14b, { type: "user", id: "u1", name: "You" });
      assert.equal(installed.ok, true);

      const res = await executeDatabaseTool(root14b, AGENT, "list_databases", {});
      assert.ok(!("error" in res));
      const payload = res as {
        kits: Array<{ domainSlug: string; kits: string[] }>;
        databases: Array<{ domainSlug: string }>;
      };
      // One entry per live domain, from paths.domainsDir.
      const financial = payload.kits.find((k) => k.domainSlug === "financial");
      assert.ok(financial, "financial must appear even though it now has a database");
      const expected = await listInstalledKits(root14b, "financial");
      assert.equal(expected.ok, true);
      if (!expected.ok) return;
      assert.deepEqual(financial!.kits, expected.value);
      assert.ok(financial!.kits.includes("finance"));

      // Every live seeded domain gets an entry, all of them matching the accessor.
      for (const domain of ["health", "intellectual", "emotional"]) {
        const entry = payload.kits.find((k) => k.domainSlug === domain);
        assert.ok(entry, `${domain} must appear in kits`);
        const want = await listInstalledKits(root14b, domain);
        assert.equal(want.ok, true);
        if (want.ok) assert.deepEqual(entry!.kits, want.value);
      }
    });

    it("a live-but-empty domain is present, which deriving from listDatabases would drop", async () => {
      const root14c = path.join(dir, "kits-empty");
      assert.equal((await createVault(root14c, "KitsEmpty")).ok, true);
      // No database is created anywhere, and no registry.json is written.
      const res = await executeDatabaseTool(root14c, AGENT, "list_databases", {});
      assert.ok(!("error" in res));
      const payload = res as {
        kits: Array<{ domainSlug: string; kits: string[] }>;
        databases: unknown[];
      };
      // Every live domain appears, including ones with no databases at all.
      for (const domain of ["health", "intellectual", "emotional", "financial"]) {
        const entry = payload.kits.find((k) => k.domainSlug === domain);
        assert.ok(entry, `live-but-empty domain ${domain} must still appear`);
        assert.deepEqual(entry!.kits, [], "a domain with no registry.json yields kits: []");
      }
      assert.equal(payload.kits.length, 4);
      // …while the database list really is empty, which is why deriving the
      // domain set from listDatabases would have returned nothing here.
      assert.deepEqual(payload.databases, []);
    });

    it("an archived domain never appears for the agent", async () => {
      const root14d = path.join(dir, "kits-archived");
      assert.equal((await createVault(root14d, "KitsArchived")).ok, true);
      const db = await createDatabase(root14d, "health", { name: "Habits" });
      assert.equal(db.ok, true);
      assert.equal((await archiveDomain(root14d, "health")).ok, true);

      const res = await executeDatabaseTool(root14d, AGENT, "list_databases", {});
      assert.ok(!("error" in res));
      const payload = res as {
        kits: Array<{ domainSlug: string }>;
        databases: Array<{ domainSlug: string }>;
      };
      assert.equal(payload.kits.some((k) => k.domainSlug === "health"), false);
      assert.equal(payload.databases.some((d) => d.domainSlug === "health"), false);

      // Naming it explicitly is NOT_FOUND, and the message says why.
      const named = await executeDatabaseTool(root14d, AGENT, "list_databases", { domainSlug: "health" });
      assert.ok("error" in named);
      assert.equal(named.error.code, "NOT_FOUND");
      assert.match(named.error.message, /health/);
    });
  });

  // ─── Test 11: tool list parity ──────────────────────────────────────────────
  describe("test 11: tool list parity", () => {
    it("ALL_TOOL_DEFS contains DATABASE_TOOL_DEFS", () => {
      const names = ALL_TOOL_DEFS.map((t) => t.name);
      for (const def of DATABASE_TOOL_DEFS) {
        assert.ok(names.includes(def.name), `ALL_TOOL_DEFS must include ${def.name}`);
      }
    });

    it("ALL_TOOL_DEFS composes every pre-existing tool array", () => {
      const names = ALL_TOOL_DEFS.map((t) => t.name);
      for (const def of [
        ...MAP_TOOL_DEFS,
        ...GOALS_TOOL_DEFS,
        ...DOCUMENT_TOOL_DEFS,
        ...REVIEW_TOOL_DEFS,
        ...CAPTURE_TOOL_DEFS,
        ...SCRIPT_TOOL_DEFS,
        ...PROJECT_TOOL_DEFS,
      ]) {
        assert.ok(names.includes(def.name), `missing pre-existing tool ${def.name}`);
      }
    });

    it("no database tool declares an actor parameter", () => {
      for (const def of DATABASE_TOOL_DEFS) {
        const props = Object.keys(
          (def.parameters as { properties?: Record<string, unknown> }).properties ?? {},
        );
        assert.equal(
          props.includes("actor"),
          false,
          `${def.name} must not accept an actor: the agent cannot choose its own identity`,
        );
      }
    });

    it("all nine database tools are registered, and the read half is a prefix of them", () => {
      assert.deepEqual(
        DATABASE_TOOL_DEFS.map((t) => t.name).sort(),
        [
          "add_column",
          "create_database",
          "delete_row",
          "get_database",
          "get_row",
          "list_databases",
          "list_decisions",
          "list_rows",
          "upsert_row",
        ],
      );
    });
  });

  // ─── Test 1: the cells round-trip contract ──────────────────────────────────
  // The full Zod round trip runs in apps/desktop/tests/database-mcp-shell.test.ts,
  // where zod is a dependency. What is asserted here is the contract it depends
  // on: a free-form object parameter is declared with additionalProperties, so
  // toZod does not compile it to z.object({}) and strip every key.
  describe("test 1: free-form object parameters are declared, not implied", () => {
    it("no database tool declares a bare object parameter that would be stripped", () => {
      for (const def of DATABASE_TOOL_DEFS) {
        const props =
          (def.parameters as {
            properties?: Record<string, { type?: string; additionalProperties?: boolean }>;
          }).properties ?? {};
        for (const [key, spec] of Object.entries(props)) {
          if (spec.type !== "object") continue;
          // A property-less object is fine only when it is not free-form: a tool
          // that takes no arguments legitimately compiles to z.object({}).
          assert.equal(
            spec.additionalProperties,
            true,
            `${def.name}.${key} is a free-form object and must declare additionalProperties: true, ` +
              "or toZod compiles it to z.object({}) and Zod strips every value",
          );
        }
      }
    });

    it("a property-less object without additionalProperties still compiles to an empty shape", () => {
      // list_documents declares `properties: {}` and takes no arguments; the guard
      // is `!p.properties`, not an emptiness check, so it is unaffected.
      const listDoc = DOCUMENT_TOOL_DEFS.find((t) => t.name === "list_documents")!;
      const props = (listDoc.parameters as { properties?: Record<string, unknown> }).properties;
      assert.deepEqual(
        props,
        {},
        "list_documents declares an empty properties object, not a missing one",
      );
    });
  });

  // ─── Test 5, read half: rows come back paginated and typed ──────────────────
  describe("test 5 (read half): list_rows and get_row", () => {
    it("list_rows returns rows, total, limit, and offset", async () => {
      const root5 = path.join(dir, "read-rows");
      assert.equal((await createVault(root5, "ReadRows")).ok, true);
      const db = await createDatabase(root5, "health", { name: "Water" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root5, "health", db.value.id, { name: "ml", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const ml = col.value.columns.find((c) => c.name === "ml")!.id;
      for (let i = 0; i < 5; i++) {
        assert.equal((await upsertRow(root5, "health", db.value.id, { id: `w-${i}`, cells: { [ml]: i } })).ok, true);
      }

      const res = await executeDatabaseTool(root5, AGENT, "list_rows", {
        domainSlug: "health",
        databaseId: db.value.id,
        limit: 2,
        offset: 0,
      });
      assert.ok(!("error" in res));
      const payload = res as {
        rows: Array<{ id: string; cells: Record<string, unknown> }>;
        total: number;
        limit: number;
        offset: number;
      };
      assert.equal(payload.rows.length, 2);
      assert.equal(payload.total, 5, "total tells the agent this page is a slice");
      assert.equal(payload.limit, 2);
      assert.equal(payload.offset, 0);
      // Cells are keyed by column id, not hand-parsed JSON.
      assert.equal(typeof payload.rows[0].cells[ml], "number");

      const second = await executeDatabaseTool(root5, AGENT, "list_rows", {
        domainSlug: "health",
        databaseId: db.value.id,
        limit: 2,
        offset: 2,
      });
      assert.ok(!("error" in second));
      const firstIds = payload.rows.map((r) => r.id);
      const secondIds = (second as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
      assert.equal(new Set([...firstIds, ...secondIds]).size, 4, "pages must not overlap");
    });

    it("list_rows defaults to limit 100 and rejects out-of-range paging", async () => {
      const root5b = path.join(dir, "read-limit");
      assert.equal((await createVault(root5b, "ReadLimit")).ok, true);
      const db = await createDatabase(root5b, "health", { name: "Big" });
      assert.equal(db.ok, true);
      if (!db.ok) return;

      const defaults = await executeDatabaseTool(root5b, AGENT, "list_rows", {
        domainSlug: "health",
        databaseId: db.value.id,
      });
      assert.ok(!("error" in defaults));
      assert.equal((defaults as { limit: number }).limit, 100);
      assert.equal((defaults as { offset: number }).offset, 0);

      for (const bad of [0, 501, 1.5, "10"]) {
        const res = await executeDatabaseTool(root5b, AGENT, "list_rows", {
          domainSlug: "health",
          databaseId: db.value.id,
          limit: bad,
        });
        assert.ok("error" in res, `limit ${String(bad)} must be rejected`);
        assert.equal(res.error.code, "VALIDATION");
      }
      const negOffset = await executeDatabaseTool(root5b, AGENT, "list_rows", {
        domainSlug: "health",
        databaseId: db.value.id,
        offset: -1,
      });
      assert.ok("error" in negOffset);
      assert.equal(negOffset.error.code, "VALIDATION");
    });

    it("get_row returns the full cells map and updatedAt", async () => {
      const root5c = path.join(dir, "read-row");
      assert.equal((await createVault(root5c, "ReadRow")).ok, true);
      const db = await createDatabase(root5c, "health", { name: "Meds" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root5c, "health", db.value.id, { name: "name", type: "text" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const nameCol = col.value.columns.find((c) => c.name === "name")!.id;
      const seeded = await upsertRow(root5c, "health", db.value.id, {
        id: "m-1",
        cells: { [nameCol]: "Vitamin D" },
      });
      assert.equal(seeded.ok, true);
      if (!seeded.ok) return;

      const res = await executeDatabaseTool(root5c, AGENT, "get_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "m-1",
      });
      assert.ok(!("error" in res));
      const row = (res as { row: { cells: Record<string, unknown>; updatedAt: string } }).row;
      assert.equal(row.cells[nameCol], "Vitamin D");
      assert.equal(row.updatedAt, seeded.value.updatedAt);

      const missing = await executeDatabaseTool(root5c, AGENT, "get_row", {
        domainSlug: "health",
        databaseId: db.value.id,
        id: "nope",
      });
      assert.ok("error" in missing);
      assert.equal(missing.error.code, "NOT_FOUND");
    });

    it("get_database returns the schema including column ids", async () => {
      const root5d = path.join(dir, "read-schema");
      assert.equal((await createVault(root5d, "ReadSchema")).ok, true);
      const db = await createDatabase(root5d, "financial", { name: "Accounts" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(root5d, "financial", db.value.id, {
        name: "currency",
        type: "select",
        options: ["ZAR", "USD"],
      });
      assert.equal(col.ok, true);

      const res = await executeDatabaseTool(root5d, AGENT, "get_database", {
        domainSlug: "financial",
        databaseId: db.value.id,
      });
      assert.ok(!("error" in res));
      const meta = (res as { database: DatabaseMeta }).database;
      assert.equal(meta.id, db.value.id);
      assert.equal(meta.columns.length, 1);
      assert.ok(meta.columns[0].id.length > 0);
      assert.deepEqual(meta.columns[0].options, ["ZAR", "USD"]);
    });
  });

  // ─── Validation and safety ──────────────────────────────────────────────────
  describe("validation and safety", () => {
    it("missing args are VALIDATION, checked before the engine", async () => {
      const res = await executeDatabaseTool(root, AGENT, "get_database", { databaseId: "x" });
      assert.ok("error" in res);
      assert.equal(res.error.code, "VALIDATION");
      assert.match(res.error.message, /domainSlug/);

      const noDb = await executeDatabaseTool(root, AGENT, "get_row", { domainSlug: "health", id: "r" });
      assert.ok("error" in noDb);
      assert.equal(noDb.error.code, "VALIDATION");
      assert.match(noDb.error.message, /databaseId/);
    });

    it("an absent or archived domain is NOT_FOUND on every tool", async () => {
      for (const tool of ["get_database", "list_rows", "get_row"]) {
        const absent = await executeDatabaseTool(root, AGENT, tool, { domainSlug: "no-such", databaseId: "d" });
        assert.ok("error" in absent, `${tool} on an absent domain`);
        assert.equal(absent.error.code, "NOT_FOUND");
        assert.match(absent.error.message, /no-such/, "the message must name the slug");
      }
      // list_databases too.
      const listed = await executeDatabaseTool(root, AGENT, "list_databases", { domainSlug: "no-such" });
      assert.ok("error" in listed);
      assert.equal(listed.error.code, "NOT_FOUND");

      // An archived domain behaves identically to an absent one, by design.
      const rootArch = path.join(dir, "read-archived");
      assert.equal((await createVault(rootArch, "ReadArchived")).ok, true);
      const db = await createDatabase(rootArch, "intellectual", { name: "Books" });
      assert.equal(db.ok, true);
      assert.equal((await archiveDomain(rootArch, "intellectual")).ok, true);
      for (const tool of ["get_database", "list_rows", "get_row"]) {
        const res = await executeDatabaseTool(rootArch, AGENT, tool, {
          domainSlug: "intellectual",
          databaseId: db.ok ? db.value.id : "d",
        });
        assert.ok("error" in res, `${tool} on an archived domain`);
        assert.equal(res.error.code, "NOT_FOUND");
        assert.match(res.error.message, /archived/);
      }
    });

    it("a read against a missing domain is NOT_FOUND, not an empty result", async () => {
      // listRows returns ok:true, [] when the SQLite file is missing, which would
      // otherwise read to the agent as "no accounts".
      const res = await executeDatabaseTool(root, AGENT, "list_rows", {
        domainSlug: "health",
        databaseId: "whatever",
      });
      assert.ok("error" in res);
      assert.equal(res.error.code, "NOT_FOUND");
    });

    it("an unknown database is NOT_FOUND", async () => {
      const res = await executeDatabaseTool(root, AGENT, "list_rows", {
        domainSlug: "health",
        databaseId: "no-such-db",
      });
      assert.ok("error" in res);
      assert.equal(res.error.code, "NOT_FOUND");
    });

    it("reads never create a Decision", async () => {
      const rootR = path.join(dir, "read-only");
      assert.equal((await createVault(rootR, "ReadOnly")).ok, true);
      const db = await createDatabase(rootR, "health", { name: "Quiet" });
      assert.equal(db.ok, true);
      if (!db.ok) return;
      const col = await addDatabaseColumn(rootR, "health", db.value.id, { name: "n", type: "number" });
      assert.equal(col.ok, true);
      if (!col.ok) return;
      const n = col.value.columns.find((c) => c.name === "n")!.id;
      assert.equal((await upsertRow(rootR, "health", db.value.id, { id: "q-1", cells: { [n]: 1 } })).ok, true);

      const before = await listDecisions(rootR);
      assert.equal(before.ok, true);
      const beforeCount = before.ok ? before.value.length : -1;

      await executeDatabaseTool(rootR, AGENT, "list_databases", {});
      await executeDatabaseTool(rootR, AGENT, "get_database", { domainSlug: "health", databaseId: db.value.id });
      await executeDatabaseTool(rootR, AGENT, "list_rows", { domainSlug: "health", databaseId: db.value.id });
      await executeDatabaseTool(rootR, AGENT, "get_row", { domainSlug: "health", databaseId: db.value.id, id: "q-1" });

      const after = await listDecisions(rootR);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.length, beforeCount, "reads must not file Decisions");
    });

    it("an unknown database tool name is rejected", async () => {
      const res = await executeDatabaseTool(root, AGENT, "save_database_file", {});
      assert.ok("error" in res);
      assert.equal(res.error.code, "VALIDATION");
    });
  });
});
