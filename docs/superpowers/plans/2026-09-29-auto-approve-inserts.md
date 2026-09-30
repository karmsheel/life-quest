# Auto-approved inserts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator name databases whose new rows the assistant applies immediately, and let a mass insert land as one Decision.

**Architecture:** `autoApproveInserts` is a vault settings list. `insert_rows` files one `database-batch` Decision of minted row ids. A matching list entry calls the existing `resolveDecision(..., "approved")`. Apply inserts those ids in one SQLite transaction. A one-row `upsert_row` create uses the same match. Updates, deletes, and schema changes do not.

**Tech Stack:** TypeScript, Node 24 `node:sqlite` `DatabaseSync`, vault-core `node:test`, Electron settings and Decisions UI, existing MCP tool array `ALL_TOOL_DEFS`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-29-auto-approve-inserts-design.md`. Follow it when this plan and the spec disagree on behavior.
- `INSERT_ROWS_MAX` is 200. A call with 0 or more than 200 rows files nothing.
- The allowlist field is `autoApproveInserts`: `{ domainSlug: string; databaseId: string }[]` on `VaultSettings` in `.lifequest/settings.json`. A missing field reads as `[]`.
- Matching is an exact pair match. It applies to `insert_rows` and to an `upsert_row` whose `id` is omitted. An `upsert_row` with an id, `delete_row`, `create_database`, and `add_column` never match.
- `proposedTitle` is `Insert {N} rows into {databaseName}`. The stored `title` stays `Proposed change to ` plus that sentence.
- Checkbox accessible name: `Apply assistant inserts immediately: {domain name} / {database name}`. Section label: **Apply assistant inserts immediately**. Description: "New rows the assistant proposes in a checked database are applied immediately. Updates, deletes, and other databases still wait in Decisions."
- Tool success always includes `posted` and `rowCount`. `posted: true` only when the rows are in the database.
- The assistant cannot read or write the allowlist. No new IPC channel. `capture_transaction`, `undo_capture`, `correct_capture`, and `fileUnsolicited` stay as they are.
- Do not edit `LAWS`, `README`, `PRODUCT`, `VISION`, or this plan's spec. Do not stage them.
- Proof is a temporary-vault behavioral test plus desktop source shell tests. Do not add a separate unit-test framework.
- Windows commits use two `-m` flags. Stage explicit paths. Do not `git add -A`. Do not merge or push.
- Work in an isolated worktree. Do not `npm install` there. Do not delete the shared `node_modules/@lifequest/vault-core` junction.

---

### Task 1: Persist the allowlist

**Files:**
- Modify: `packages/vault-core/src/types.ts` (`VaultSettings`, around line 133)
- Modify: `packages/vault-core/src/agents.ts` (`updateSettings`)
- Modify: `packages/vault-core/src/index.ts` (export the reader)
- Test: `packages/vault-core/tests/agents.test.ts`

**Interfaces:**
- Consumes: `updateSettings(root, patch)`, `createVault`
- Produces:
  - `export type AutoApproveInsert = { domainSlug: string; databaseId: string }`
  - `VaultSettings.autoApproveInserts: AutoApproveInsert[]`
  - `export async function readAutoApproveInserts(rootPath: string): Promise<AutoApproveInsert[]>`

- [ ] **Step 1: Write the failing test**

Add this import to the existing import from `../src/index.ts` in `packages/vault-core/tests/agents.test.ts`: `readAutoApproveInserts`. Add this test inside the same `describe` as the other `updateSettings` tests:

```ts
it("updateSettings stores autoApproveInserts and a theme patch keeps it", async () => {
  const missing = await readAutoApproveInserts(root);
  assert.deepEqual(missing, []);

  const saved = await updateSettings(root, {
    autoApproveInserts: [
      { domainSlug: "health", databaseId: "db-1" },
      { domainSlug: "health", databaseId: "db-1" },
      { domainSlug: "financial", databaseId: "finance:transactions" },
    ],
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(saved.value.autoApproveInserts, [
    { domainSlug: "health", databaseId: "db-1" },
    { domainSlug: "financial", databaseId: "finance:transactions" },
  ]);

  const themed = await updateSettings(root, { theme: "light" });
  assert.equal(themed.ok, true);
  if (!themed.ok) return;
  assert.deepEqual(themed.value.autoApproveInserts, saved.value.autoApproveInserts);
  assert.deepEqual(await readAutoApproveInserts(root), saved.value.autoApproveInserts);

  const before = await fs.readFile(path.join(root, ".lifequest", "settings.json"), "utf8");
  const rejected = await updateSettings(root, {
    autoApproveInserts: [{ domainSlug: "", databaseId: "db-1" }],
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /autoApproveInserts/);
  const after = await fs.readFile(path.join(root, ".lifequest", "settings.json"), "utf8");
  assert.equal(after, before);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/vault-core`:

```powershell
node --experimental-strip-types --test tests/agents.test.ts
```

Expected: FAIL because `readAutoApproveInserts` is not exported and `autoApproveInserts` is not on the settings type.

- [ ] **Step 3: Write the minimal implementation**

In `packages/vault-core/src/types.ts`, add the type next to `VaultSettings` and the field on the interface:

```ts
export type AutoApproveInsert = {
  domainSlug: string;
  databaseId: string;
};

export type VaultSettings = {
  hermesBaseUrl: string;
  theme: "system" | "light" | "dark";
  weekStartDay: WeekStartDay;
  autoApproveInserts: AutoApproveInsert[];
};
```

`createVault` may keep writing settings without the key. Readers treat a missing key as `[]`.

In `packages/vault-core/src/agents.ts`, add this parser and use it inside `updateSettings`. On a read, drop malformed entries. On a write, reject the whole patch.

```ts
import type { AutoApproveInsert, VaultSettings, WeekStartDay } from "./types.ts";

export function autoApproveInsertsFromUnknown(value: unknown): AutoApproveInsert[] {
  if (!Array.isArray(value)) return [];
  const out: AutoApproveInsert[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const domainSlug = (entry as { domainSlug?: unknown }).domainSlug;
    const databaseId = (entry as { databaseId?: unknown }).databaseId;
    if (typeof domainSlug !== "string" || !domainSlug.trim()) continue;
    if (typeof databaseId !== "string" || !databaseId.trim()) continue;
    const key = `${domainSlug}\0${databaseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domainSlug, databaseId });
  }
  return out;
}

function parseAutoApprovePatch(value: unknown): Result<AutoApproveInsert[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "autoApproveInserts must be an array" };
  }
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "autoApproveInserts entry must have domainSlug and databaseId" };
    }
    const domainSlug = (entry as { domainSlug?: unknown }).domainSlug;
    const databaseId = (entry as { databaseId?: unknown }).databaseId;
    if (typeof domainSlug !== "string" || !domainSlug.trim()) {
      return { ok: false, error: "autoApproveInserts entry must have domainSlug and databaseId" };
    }
    if (typeof databaseId !== "string" || !databaseId.trim()) {
      return { ok: false, error: "autoApproveInserts entry must have domainSlug and databaseId" };
    }
  }
  return { ok: true, value: autoApproveInsertsFromUnknown(value) };
}

export async function readAutoApproveInserts(rootPath: string): Promise<AutoApproveInsert[]> {
  try {
    const raw = await fs.readFile(vaultPaths(rootPath).settingsJson, "utf8");
    const parsed = JSON.parse(raw) as { autoApproveInserts?: unknown };
    return autoApproveInsertsFromUnknown(parsed.autoApproveInserts);
  } catch {
    return [];
  }
}
```

Inside `updateSettings`, after `current` is parsed, set `const currentInserts = autoApproveInsertsFromUnknown(current.autoApproveInserts)`. Put `autoApproveInserts: currentInserts` on the `next` object. Before writing the file, when `patch.autoApproveInserts !== undefined`:

```ts
const parsedInserts = parseAutoApprovePatch(patch.autoApproveInserts);
if (!parsedInserts.ok) return parsedInserts;
next.autoApproveInserts = parsedInserts.value;
```

A theme-only patch must copy `currentInserts` and must not replace it. `Result` is already imported in `agents.ts`.

Export `readAutoApproveInserts` and `AutoApproveInsert` from `packages/vault-core/src/index.ts`. Export the type from the existing `export type` block that re-exports `VaultSettings`.

- [ ] **Step 4: Run the test to verify it passes**

```powershell
node --experimental-strip-types --test tests/agents.test.ts
```

Expected: PASS, including the existing theme and week-start tests.

- [ ] **Step 5: Commit**

```powershell
git add packages/vault-core/src/types.ts packages/vault-core/src/agents.ts packages/vault-core/src/index.ts packages/vault-core/tests/agents.test.ts
git commit -m "feat(settings): store databases whose inserts auto-approve" -m "A missing autoApproveInserts list reads as empty. A theme patch keeps the list. An invalid entry leaves settings.json unchanged."
```

---

### Task 2: Insert many rows in one transaction

**Files:**
- Modify: `packages/vault-core/src/domain-databases.ts` (after `upsertRow`)
- Modify: `packages/vault-core/src/index.ts` (export `insertRows`)
- Test: `packages/vault-core/tests/insert-rows.test.ts`

**Interfaces:**
- Consumes: `openSqlite`, `validateCells`, `readRegistry`, `vaultPaths`, `checkDatabaseCells`
- Produces:

```ts
export async function insertRows(
  root: string,
  slug: string,
  dbId: string,
  rows: Array<{ id: string; cells: Record<string, unknown> }>,
): Promise<Result<{ ids: string[] }>>
```

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/insert-rows.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addDatabaseColumn,
  createDatabase,
  createVault,
  getRow,
  insertRows,
  listRows,
} from "../src/index.ts";

describe("insertRows", () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-insert-rows-"));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function waterVault(): Promise<{ root: string; dbId: string; ml: string }> {
    const root = path.join(dir, `vault-${Math.random().toString(16).slice(2)}`);
    assert.equal((await createVault(root, "Insert")).ok, true);
    const db = await createDatabase(root, "health", { name: "Water" });
    assert.equal(db.ok, true);
    if (!db.ok) throw new Error(db.error);
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) throw new Error(col.error);
    const ml = col.value.columns.find((c) => c.name === "ml")!.id;
    return { root, dbId: db.value.id, ml };
  }

  it("rolls back every row when one id already exists", async () => {
    const { root, dbId, ml } = await waterVault();
    const planted = await insertRows(root, "health", dbId, [{ id: "row-b", cells: { [ml]: 1 } }]);
    assert.equal(planted.ok, true);

    const batch = await insertRows(root, "health", dbId, [
      { id: "row-a", cells: { [ml]: 2 } },
      { id: "row-b", cells: { [ml]: 3 } },
      { id: "row-c", cells: { [ml]: 4 } },
    ]);
    assert.equal(batch.ok, false);
    if (batch.ok) return;
    assert.match(batch.error, /Row id already exists: row-b/);

    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.deepEqual(rows.value.map((r) => r.id).sort(), ["row-b"]);
    const survivor = await getRow(root, "health", dbId, "row-b");
    assert.equal(survivor.ok, true);
    if (!survivor.ok) return;
    assert.equal(survivor.value.cells[ml], 1);
    assert.equal((await getRow(root, "health", dbId, "row-a")).ok, false);
    assert.equal((await getRow(root, "health", dbId, "row-c")).ok, false);
  });

  it("inserts every row when none of the ids exist", async () => {
    const { root, dbId, ml } = await waterVault();
    const batch = await insertRows(root, "health", dbId, [
      { id: "row-a", cells: { [ml]: 2 } },
      { id: "row-b", cells: { [ml]: 3 } },
    ]);
    assert.equal(batch.ok, true);
    if (!batch.ok) return;
    assert.deepEqual(batch.value.ids, ["row-a", "row-b"]);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
```

Expected: FAIL because `insertRows` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Add `insertRows` in `packages/vault-core/src/domain-databases.ts` after `upsertRow`. Use the private `openSqlite`, `readRegistry`, and `validateCells`. Do not call `upsertRow`. Use `INSERT`, not `INSERT OR REPLACE`.

```ts
export async function insertRows(
  root: string,
  slug: string,
  dbId: string,
  rows: Array<{ id: string; cells: Record<string, unknown> }>,
): Promise<Result<{ ids: string[] }>> {
  try {
    if (rows.length < 1) return { ok: false, error: "rows must not be empty" };
    const paths = vaultPaths(root);
    const registry = await readRegistry(paths.domainRegistry(slug));
    for (const row of rows) {
      if (!row.id.trim()) return { ok: false, error: "Row id is required" };
      const validation = validateCells(registry, dbId, slug, row.cells);
      if (!validation.ok) return validation;
    }

    const now = new Date().toISOString();
    const sqlite = openSqlite(paths.domainSqlite(slug));
    try {
      sqlite.exec("BEGIN");
      const existing = sqlite.prepare(
        "SELECT id FROM rows WHERE database_id = ? AND id = ?",
      );
      const insert = sqlite.prepare(
        "INSERT INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
      );
      for (const row of rows) {
        const found = existing.get(dbId, row.id) as { id: string } | undefined;
        if (found) {
          sqlite.exec("ROLLBACK");
          return { ok: false, error: `Row id already exists: ${row.id}` };
        }
        insert.run(dbId, row.id, now, now, JSON.stringify(row.cells));
      }
      sqlite.exec("COMMIT");
      return { ok: true, value: { ids: rows.map((row) => row.id) } };
    } catch (e) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // The transaction is already closed.
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      sqlite.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

Export `insertRows` from the `domain-databases.ts` export block in `packages/vault-core/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
```

Expected: PASS. The planted `row-b` still has `ml` 1. `row-a` and `row-c` are absent after the failed batch.

- [ ] **Step 5: Commit**

```powershell
git add packages/vault-core/src/domain-databases.ts packages/vault-core/src/index.ts packages/vault-core/tests/insert-rows.test.ts
git commit -m "feat(databases): insert a batch of rows in one transaction" -m "insertRows uses INSERT inside one transaction. An id that already exists rolls the whole batch back."
```

---

### Task 3: A database-batch Decision applies through insertRows

**Files:**
- Modify: `packages/vault-core/src/types.ts` (`DocumentTarget`, new `DatabaseBatchDecisionBody`)
- Modify: `packages/vault-core/src/decisions.ts` (normalize, create, domain slugs, apply)
- Modify: `packages/vault-core/src/documents.ts` (`documentTargetLabel`)
- Test: `packages/vault-core/tests/insert-rows.test.ts`

**Interfaces:**
- Consumes: `insertRows`, `createDecision`, `resolveDecision`, `checkDatabaseCells`, `isDomainLive`
- Produces:

```ts
| { type: "database-batch"; domainSlug: string; databaseId: string }

export type DatabaseBatchDecisionBody = {
  op: "insert-rows";
  databaseName: string;
  rows: Array<{
    id: string;
    cells: Record<string, unknown>;
    rowLabel: string | null;
  }>;
};
```

`createDecision` accepts that target. `resolveDecision(..., "approved")` calls `insertRows` with the minted ids. A collision or an archived domain rejects the Decision and writes no batch row.

- [ ] **Step 1: Write the failing test**

Append this `describe` to `packages/vault-core/tests/insert-rows.test.ts`. Add `createDecision`, `getDatabase`, `listDecisions`, `resolveDecision`, and `archiveDomain` to the imports. `archiveDomain` comes from `../src/domains.ts`. `Actor` comes from `../src/index.ts`.

```ts
const AGENT: Actor = { type: "agent", id: "companion", name: "Hermes" };

describe("database-batch Decisions", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-batch-decision-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function pendingBatch(): Promise<{ root: string; dbId: string; ml: string; decisionId: string; ids: string[] }> {
    const root = path.join(dir, `vault-${Math.random().toString(16).slice(2)}`);
    assert.equal((await createVault(root, "Batch")).ok, true);
    const db = await createDatabase(root, "health", { name: "Water" });
    assert.equal(db.ok, true);
    if (!db.ok) throw new Error(db.error);
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) throw new Error(col.error);
    const ml = col.value.columns.find((c) => c.name === "ml")!.id;
    const ids = ["batch-a", "batch-b"];
    const body = {
      op: "insert-rows",
      databaseName: "Water",
      rows: ids.map((id, i) => ({ id, cells: { [ml]: i + 1 }, rowLabel: null })),
    };
    const created = await createDecision(root, {
      target: { type: "database-batch", domainSlug: "health", databaseId: db.value.id },
      proposedTitle: "Insert 2 rows into Water",
      proposedBodyMarkdown: JSON.stringify(body),
      actor: AGENT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.error);
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.domainSlugs[0], "health");
    return { root, dbId: db.value.id, ml, decisionId: created.value.id, ids };
  }

  it("approval inserts every minted row", async () => {
    const { root, dbId, ml, decisionId } = await pendingBatch();
    const resolved = await resolveDecision(root, decisionId, "approved");
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.value.status, "approved");
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 2);
    const first = await getRow(root, "health", dbId, "batch-a");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.cells[ml], 1);
  });

  it("a planted minted id rejects the Decision and adds no batch row", async () => {
    const { root, dbId, ml, decisionId } = await pendingBatch();
    const planted = await insertRows(root, "health", dbId, [{ id: "batch-b", cells: { [ml]: 9 } }]);
    assert.equal(planted.ok, true);
    const resolved = await resolveDecision(root, decisionId, "approved");
    assert.equal(resolved.ok, false);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const record = listed.value.find((d) => d.id === decisionId);
    assert.equal(record?.status, "rejected");
    assert.match(record?.reason ?? "", /Row id already exists: batch-b/);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.deepEqual(rows.value.map((r) => r.id), ["batch-b"]);
    assert.equal((await getRow(root, "health", dbId, "batch-a")).ok, false);
  });

  it("an archived domain rejects the Decision and writes nothing", async () => {
    const { root, dbId, decisionId } = await pendingBatch();
    assert.equal((await archiveDomain(root, "health")).ok, true);
    const resolved = await resolveDecision(root, decisionId, "approved");
    assert.equal(resolved.ok, false);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const record = listed.value.find((d) => d.id === decisionId);
    assert.equal(record?.status, "rejected");
    assert.match(record?.reason ?? "", /archived/);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 0);
  });
});
```

`archiveDomain` in `packages/vault-core/src/domains.ts` returns `Promise<Result<DomainRecord>>`. Keep the `.ok` assertion. Import it from `../src/domains.ts`.

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
```

Expected: FAIL on `createDecision` because `database-batch` is not a `DocumentTarget`. The Task 2 tests still pass.

- [ ] **Step 3: Write the minimal implementation**

Add the target to `DocumentTarget` in `types.ts`, after the `database` member:

```ts
| { type: "database-batch"; domainSlug: string; databaseId: string }
```

Add `DatabaseBatchDecisionBody` next to `DatabaseDecisionBody`.

In `decisions.ts`:

1. Add `isDatabaseBatchExplicitTarget` beside `isDatabaseExplicitTarget`. It requires `type === "database-batch"` and non-empty `domainSlug` and `databaseId`.
2. Include it in the `normalizeDecision` explicit-target condition, and add a branch that sets `{ type: "database-batch", domainSlug, databaseId }`. Put it before the final library fallback.
3. In the `domainSlugs` fallback, treat `database-batch` like `database-row`: `[target.domainSlug]`.
4. In `createDecision`, accept the target the same way as `database`: non-empty slug and database id. In the live-domain block, handle `database-batch` with the `database-row` rules: domain must be live, `getDatabase` must succeed, `docLocked = false`, `domainSlugForLog = input.target.domainSlug`.
5. In the `domainSlugs` construction ternary, include `database-batch` in the same arm as `database-row`.

In `documents.ts`, `documentTargetLabel` for `database-batch` returns `fallbackTitle` when it is non-empty, otherwise `` `Insert into ${target.databaseId}` ``.

In `applyApprovedBody`, before the `decision.target.type === "database"` branch, handle `database-batch`:

```ts
if (decision.target.type === "database-batch") {
  const { insertRows } = await import("./domain-databases.ts");
  let body: DatabaseBatchDecisionBody;
  try {
    body = JSON.parse(decision.proposedBodyMarkdown) as DatabaseBatchDecisionBody;
  } catch {
    return { ok: false, error: "Database batch proposedBody must be valid JSON", terminal: false };
  }
  if (!body || body.op !== "insert-rows" || !Array.isArray(body.rows) || body.rows.length < 1) {
    return { ok: false, error: "Database batch proposedBody must be an insert-rows body", terminal: false };
  }
  const { domainSlug, databaseId } = decision.target;
  if (!(await isDomainLive(rootPath, domainSlug))) {
    return { ok: false, error: `Domain not found or archived: ${domainSlug}`, terminal: true };
  }
  for (const row of body.rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim()) {
      return { ok: false, error: "Database batch row is missing an id", terminal: false };
    }
    if (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells)) {
      return { ok: false, error: "Database batch row needs a cells object", terminal: false };
    }
    const referential = await checkDatabaseCells(rootPath, domainSlug, databaseId, row.cells);
    if (!referential.ok) return { ok: false, error: referential.error, terminal: true };
  }
  const written = await insertRows(
    rootPath,
    domainSlug,
    databaseId,
    body.rows.map((row) => ({ id: row.id, cells: row.cells })),
  );
  if (!written.ok) {
    const terminal =
      written.error.startsWith("Row id already exists") || isTerminalCellError(written.error);
    return { ok: false, error: written.error, terminal };
  }
  return { ok: true, value: undefined };
}
```

Import `DatabaseBatchDecisionBody` beside `DatabaseDecisionBody` in `decisions.ts`. `checkDatabaseCells` is already imported there if the database-row branch uses it; if it is a dynamic import today, import it the same way the database-row branch does. Read that branch and match its import style.

- [ ] **Step 4: Run the test to verify it passes**

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
```

Expected: PASS. Approval writes two rows. A planted id leaves only `batch-b` with value 9 and a rejected Decision. An archived domain leaves zero rows and a rejected Decision.

- [ ] **Step 5: Commit**

```powershell
git add packages/vault-core/src/types.ts packages/vault-core/src/decisions.ts packages/vault-core/src/documents.ts packages/vault-core/tests/insert-rows.test.ts
git commit -m "feat(decisions): apply a batch insert as one decision" -m "A database-batch Decision inserts its minted row ids together. A collision or an archived domain rejects the Decision and leaves the batch unwritten."
```

---

### Task 4: insert_rows and the allowlist match

**Files:**
- Modify: `packages/vault-core/src/database-tools.ts`
- Modify: `packages/vault-core/src/domain-databases.ts` (`validateRowCells`)
- Modify: `packages/vault-core/src/index.ts` (export `validateRowCells`)
- Test: `packages/vault-core/tests/insert-rows.test.ts`

**Interfaces:**
- Consumes: `readAutoApproveInserts`, `createDecision`, `resolveDecision`, `listDecisions`, `checkDatabaseCells`, `validateRowCells`, `checkConflicts`, `lookupExternalId`, `rowLabel`, `getDatabase`, `requireLiveDomain`, `randomUUID`
- Also produces: `export async function validateRowCells(root: string, slug: string, dbId: string, cells: Record<string, unknown>): Promise<Result<true>>`
- Produces: tool name `insert_rows` on `DATABASE_TOOL_DEFS`. Success shape:

```ts
{
  decisionId: string;
  status: "pending" | "approved" | "rejected";
  posted: boolean;
  rowCount: number;
  reason?: string;
}
```

`posted` is true only for `status: "approved"`. Unlisted creates stay `pending` and write nothing. Allowlisted creates and allowlisted batches resolve in the same call.

- [ ] **Step 1: Write the failing test**

Append this describe to `packages/vault-core/tests/insert-rows.test.ts`. Import `executeDatabaseTool`, `updateSettings`, `readLog`, and `DATABASE_TOOL_DEFS`.

```ts
function isOk(r: unknown): r is { decisionId: string; status: string; posted: boolean; rowCount: number; reason?: string } {
  return !!r && typeof r === "object" && !("error" in r);
}

describe("insert_rows tool", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-insert-tool-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function water(): Promise<{ root: string; dbId: string; ml: string }> {
    const root = path.join(dir, `vault-${Math.random().toString(16).slice(2)}`);
    assert.equal((await createVault(root, "Tool")).ok, true);
    const db = await createDatabase(root, "health", { name: "Water" });
    assert.equal(db.ok, true);
    if (!db.ok) throw new Error(db.error);
    const col = await addDatabaseColumn(root, "health", db.value.id, { name: "ml", type: "number" });
    assert.equal(col.ok, true);
    if (!col.ok) throw new Error(col.error);
    return { root, dbId: db.value.id, ml: col.value.columns.find((c) => c.name === "ml")!.id };
  }

  it("is registered and an unlisted batch files one pending Decision", async () => {
    assert.equal(DATABASE_TOOL_DEFS.some((t) => t.name === "insert_rows"), true);
    const { root, dbId, ml } = await water();
    const before = await listRows(root, "health", dbId);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 1 }, { [ml]: 2 }],
    });
    assert.equal(isOk(res), true);
    if (!isOk(res)) return;
    assert.equal(res.status, "pending");
    assert.equal(res.posted, false);
    assert.equal(res.rowCount, 2);
    const after = await listRows(root, "health", dbId);
    assert.equal(after.ok && before.ok && after.value.length === before.value.length, true);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.filter((d) => d.target.type === "database-batch").length, 1);
    const record = listed.value.find((d) => d.id === res.decisionId)!;
    assert.equal(record.proposedTitle, "Insert 2 rows into Water");
    assert.equal(record.title, "Proposed change to Insert 2 rows into Water");
    assert.equal(record.actor.type, "agent");
  });

  it("an allowlisted batch posts and writes one created and one resolved log line", async () => {
    const { root, dbId, ml } = await water();
    const saved = await updateSettings(root, {
      autoApproveInserts: [{ domainSlug: "health", databaseId: dbId }],
    });
    assert.equal(saved.ok, true);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 4 }, { [ml]: 5 }],
    });
    assert.equal(isOk(res), true);
    if (!isOk(res)) return;
    assert.equal(res.status, "approved");
    assert.equal(res.posted, true);
    assert.equal(res.rowCount, 2);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 2);
    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const created = log.value.filter((e) => e.type === "decision.created" && e.payload && (e.payload as { id?: string }).id === res.decisionId);
    const resolved = log.value.filter((e) => e.type === "decision.resolved" && e.payload && (e.payload as { id?: string }).id === res.decisionId);
    assert.equal(created.length, 1);
    assert.equal(resolved.length, 1);
  });

  it("a bad second row files nothing and names Row 2", async () => {
    const { root, dbId, ml } = await water();
    const before = await listDecisions(root);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 1 }, { [ml]: "nope" }],
    });
    assert.equal(isOk(res), false);
    if (isOk(res)) return;
    assert.match((res as { error: { message: string } }).error.message, /Row 2:/);
    const after = await listDecisions(root);
    assert.equal(after.ok && before.ok && after.value.length === before.value.length, true);
    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    assert.equal(rows.value.length, 0);
  });

  it("a repeated external_id inside the batch files nothing and names Row 2", async () => {
    const { root, dbId, ml } = await water();
    const ext = await addDatabaseColumn(root, "health", dbId, { name: "external_id", type: "text" });
    assert.equal(ext.ok, true);
    if (!ext.ok) return;
    const extId = ext.value.columns.find((c) => c.name === "external_id")!.id;
    const before = await listDecisions(root);
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [
        { [ml]: 1, [extId]: "same" },
        { [ml]: 2, [extId]: "same" },
      ],
    });
    assert.equal(isOk(res), false);
    if (isOk(res)) return;
    assert.match((res as { error: { message: string } }).error.message, /Row 2:/);
    const after = await listDecisions(root);
    assert.equal(after.ok && before.ok && after.value.length === before.value.length, true);
  });

  it("an allowlisted create posts and an allowlisted update stays pending", async () => {
    const { root, dbId, ml } = await water();
    await updateSettings(root, { autoApproveInserts: [{ domainSlug: "health", databaseId: dbId }] });
    const created = await executeDatabaseTool(root, AGENT, "upsert_row", {
      domainSlug: "health",
      databaseId: dbId,
      cells: { [ml]: 8 },
    });
    assert.equal(isOk(created), true);
    if (!isOk(created)) return;
    assert.equal(created.posted, true);
    assert.equal(created.status, "approved");
    assert.equal(created.rowCount, 1);

    const rows = await listRows(root, "health", dbId);
    assert.equal(rows.ok, true);
    if (!rows.ok) return;
    const id = rows.value[0]!.id;
    const edited = await executeDatabaseTool(root, AGENT, "upsert_row", {
      domainSlug: "health",
      databaseId: dbId,
      id,
      cells: { [ml]: 9 },
    });
    assert.equal(isOk(edited), true);
    if (!isOk(edited)) return;
    assert.equal(edited.status, "pending");
    assert.equal(edited.posted, false);
    const still = await getRow(root, "health", dbId, id);
    assert.equal(still.ok, true);
    if (!still.ok) return;
    assert.equal(still.value.cells[ml], 8);
  });

  it("a theme patch keeps the allowlist that insert_rows consults", async () => {
    const { root, dbId, ml } = await water();
    await updateSettings(root, { autoApproveInserts: [{ domainSlug: "health", databaseId: dbId }] });
    await updateSettings(root, { theme: "dark" });
    const res = await executeDatabaseTool(root, AGENT, "insert_rows", {
      domainSlug: "health",
      databaseId: dbId,
      rows: [{ [ml]: 3 }],
    });
    assert.equal(isOk(res) && res.posted, true);
  });
});
```

The number-column rejection text from `validateCells` is `Column ml expects finite number`. The tool must prefix it so the message contains `Row 2:`.

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
```

Expected: FAIL because `DATABASE_TOOL_DEFS` has no `insert_rows`.

- [ ] **Step 3: Write the minimal implementation**

Add the constant and the tool def in `database-tools.ts`. Put the def after `upsert_row` in `DATABASE_TOOL_DEFS`.

```ts
const INSERT_ROWS_MAX = 200;
```

Tool description, as one string:

```ts
"Insert many new rows into one database. rows is an array of cell objects, at most 200, and this call does not take row ids. One call files one Decision titled Insert N rows into the database. Use upsert_row for a single new row or any edit. The result includes posted and rowCount. Claim that rows landed only when posted is true. status pending means one Decision is waiting; name the database and the count. status rejected includes reason; do not send those same rows again."
```

Parameters: `domainSlug` string, `databaseId` string, `rows` array. Required: all three.

Add `finishWrite` in `database-tools.ts`:

```ts
async function finishWrite(
  root: string,
  decisionId: string,
  rowCount: number,
  allow: boolean,
): Promise<DatabaseToolResult> {
  if (!allow) return { decisionId, status: "pending", posted: false, rowCount };
  const resolved = await resolveDecision(root, decisionId, "approved");
  if (resolved.ok) return { decisionId, status: "approved", posted: true, rowCount };
  const listed = await listDecisions(root);
  const record = listed.ok ? listed.value.find((d) => d.id === decisionId) : undefined;
  if (record?.status === "rejected") {
    return {
      decisionId,
      status: "rejected",
      posted: false,
      rowCount,
      reason: record.reason ?? resolved.error,
    };
  }
  return { decisionId, status: "pending", posted: false, rowCount, reason: resolved.error };
}

async function allowInsert(
  root: string,
  domainSlug: string,
  databaseId: string,
): Promise<boolean> {
  const list = await readAutoApproveInserts(root);
  return list.some((entry) => entry.domainSlug === domainSlug && entry.databaseId === databaseId);
}
```

Import `readAutoApproveInserts` from `./agents.ts` and `resolveDecision` from `./decisions.ts`. `listDecisions` is already imported.

Widen `fileDecision`'s target union with `| { type: "database-batch"; domainSlug: string; databaseId: string }`. Its body parameter stays `DatabaseDecisionBody` for the old callers. Add a sibling `fileBatchDecision` that takes `DatabaseBatchDecisionBody` and the batch target, and calls `createDecision` the same way `fileDecision` does. `previousBodyMarkdown` is null. Actor is the function argument, never `args`.

`insert_rows` case, in order:

1. `requireLiveDomain`. On failure return that result.
2. `databaseId` must be a non-empty string. Otherwise `fail("VALIDATION", "databaseId is required")`.
3. `getDatabase`. On failure `engineError`.
4. `rows` must be an array of length 1 through `INSERT_ROWS_MAX`. Otherwise `fail("VALIDATION", "rows must be an array of 1 to 200 cell objects")`.
5. Call `checkConflicts(root, domainSlug, dbMeta, null, null)` once. A create's conflict check is database-scoped. If it returns an error, return it unchanged.
6. For each row, index starting at 1: the value must be a plain object, not an array, with at least one key. Otherwise `fail("VALIDATION", "Row N: cells must not be empty")` or `fail("VALIDATION", "Row N: cells must be a JSON object keyed by column id")`. Then call a new exported `validateRowCells(root, slug, dbId, cells)` from `domain-databases.ts`. It reads the registry and calls the private `validateCells`. `checkDatabaseCells` does not reject a number column that holds a string, and the proof requires that bad row to file nothing. Then `checkDatabaseCells`. Then the external-id lookup used by `upsert_row`. Track seen external ids in a `Set` and fail with `fail("VALIDATION", "Row N: An external_id of ${id} already exists in this database")` on a repeat inside the batch or a hit from `lookupExternalId`. Prefix engine errors with `Row N: `. Export `validateRowCells` from `index.ts`.
7. Mint `randomUUID()` per row. Build `DatabaseBatchDecisionBody` with `op: "insert-rows"`, `databaseName: dbMeta.name`, and rows of `{ id, cells, rowLabel: rowLabel(dbMeta, cells) || null }`.
8. `proposedTitle` is `` `Insert ${rows.length} rows into ${dbMeta.name}` ``.
9. `return finishWrite(root, created.id, rows.length, await allowInsert(...))`.

Change the `upsert_row` success return. It currently `return fileDecision(...)`. Keep the filing, then:

```ts
const filed = await fileDecision(...);
if ("error" in filed) return filed;
const decisionId = String((filed as { decisionId: string }).decisionId);
const allow = rowId === null && (await allowInsert(root, domainSlug, databaseId));
return finishWrite(root, decisionId, 1, allow);
```

Add one sentence to the `upsert_row` description: "A create in a database on the operator's insert allowlist can return posted: true. An update stays pending until the operator approves it."

Do not add a tool whose name or description contains `autoApproveInserts`.

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
node --experimental-strip-types --test tests/database-tools-writes.test.ts
```

Expected: both PASS. Existing write tests still see `status === "pending"` and an unchanged row, because those vaults have no allowlist.

- [ ] **Step 5: Commit**

```powershell
git add packages/vault-core/src/database-tools.ts packages/vault-core/src/domain-databases.ts packages/vault-core/src/index.ts packages/vault-core/tests/insert-rows.test.ts
git commit -m "feat(databases): file one decision for a batch insert" -m "insert_rows proposes up to 200 new rows as one Decision. A database on autoApproveInserts applies that Decision, and a one-row create, in the same step. Updates stay pending."
```

---

### Task 5: Settings, the Decisions card, and the assistant instruction

**Files:**
- Modify: `apps/desktop/src/components/settings/SettingsHermes.tsx`
- Modify: `apps/desktop/src/components/decisions/DecisionsInbox.tsx` (`kindLabel`)
- Modify: `apps/desktop/src/components/decisions/DecisionBody.tsx`
- Modify: `apps/desktop/electron/companion-client.ts` (`buildInstructions`)
- Test: `apps/desktop/tests/database-mcp-shell.test.ts`
- Test: `apps/desktop/tests/implied-filing-shell.test.ts`
- Test: `apps/desktop/tests/companion-client.test.ts`

**Interfaces:**
- Consumes: `dbList(null)`, `snapshot.domains`, `snapshot.settings.autoApproveInserts`, `settingsUpdate`, `DecisionBody`'s `ChangeTable` and `rowsFrom`, `buildInstructions`
- Produces: the Hermes checkbox section, kind label `Database rows`, a batch body renderer, and this instruction sentence immediately after the `capture_transaction` sentence:

```ts
"When adding many new rows to one database, call insert_rows once. Use upsert_row for a single new row or any edit. If the tool result has posted: true, name the database and the row count. If status is pending, say a decision is waiting and name the database and the count. If status is rejected, give the reason and do not send those rows again."
```

- [ ] **Step 1: Write the failing shell tests**

In `apps/desktop/tests/database-mcp-shell.test.ts`, inside the describe that already checks `ALL_TOOL_DEFS`, add:

```ts
it("insert_rows is on ALL_TOOL_DEFS and no tool edits the allowlist", () => {
  assert.equal(ALL_TOOL_DEFS.some((t) => t.name === "insert_rows"), true);
  for (const def of ALL_TOOL_DEFS) {
    assert.equal(def.name.includes("autoApproveInserts"), false);
    assert.equal((def.description ?? "").includes("autoApproveInserts"), false);
  }
});
```

In `apps/desktop/tests/implied-filing-shell.test.ts`, add:

```ts
it("Settings Hermes lists apply-assistant-inserts checkboxes and the decision card names a batch", () => {
  const hermes = read("src/components/settings/SettingsHermes.tsx");
  const inbox = read("src/components/decisions/DecisionsInbox.tsx");
  const body = read("src/components/decisions/DecisionBody.tsx");
  assert.match(hermes, /Apply assistant inserts immediately/);
  assert.match(hermes, /aria-label=\{`Apply assistant inserts immediately: /);
  assert.match(inbox, /database-batch/);
  assert.match(inbox, /Database rows/);
  assert.match(body, /database-batch/);
  assert.match(body, /insert-rows/);
});
```

In `apps/desktop/tests/companion-client.test.ts`, add:

```ts
it("tells the companion to batch new rows with insert_rows", () => {
  const text = buildInstructions({
    domainName: null,
    domainSlug: null,
    aboutMe: "",
    locked: false,
    vaultOpen: true,
  });
  const captureAt = text.indexOf("capture_transaction");
  const batchAt = text.indexOf("call insert_rows once");
  assert.ok(captureAt !== -1);
  assert.ok(batchAt > captureAt);
  assert.match(text, /posted: true/);
  assert.match(text, /do not send those rows again/);
});
```

- [ ] **Step 2: Run the shell tests to verify they fail**

From `apps/desktop`:

```powershell
node --experimental-strip-types --test tests/database-mcp-shell.test.ts tests/implied-filing-shell.test.ts tests/companion-client.test.ts
```

Expected: FAIL on the three new assertions. `insert_rows` is already on `ALL_TOOL_DEFS` after Task 4, so that half may pass. The checkbox, kind label, body, and instruction assertions fail.

- [ ] **Step 3: Write the minimal implementation**

`kindLabel` in `DecisionsInbox.tsx` gains:

```ts
case "database-batch":
  return "Database rows";
```

`DecisionBody.tsx`: import `DatabaseBatchDecisionBody` only if the file already imports vault-core types. Prefer parsing the body locally so the renderer stays on `@lifequest/vault-core/pure` for values and type-only imports from the package root. Add a `case "database-batch"` in the target switch that renders `BatchBody`.

```tsx
function BatchBody({ body }: { body: Record<string, unknown> }) {
  if (body.op !== "insert-rows" || !Array.isArray(body.rows)) {
    return <GenericBody body={body} previous={null} lookups={{ goalName: () => null, domainName: (slug) => slug }} />;
  }
  const databaseName = typeof body.databaseName === "string" && body.databaseName ? body.databaseName : "database";
  const rows = body.rows.filter(isRecord);
  return (
    <>
      <p className="decision-lead">Insert {rows.length} rows into {databaseName}.</p>
      {rows.map((row, index) => {
        const cells = isRecord(row.cells) ? row.cells : null;
        const label = typeof row.rowLabel === "string" && row.rowLabel ? row.rowLabel : `Row ${index + 1}`;
        return (
          <ChangeTable
            key={typeof row.id === "string" ? row.id : `row-${index}`}
            lead={label}
            rows={rowsFrom(null, cells, "after")}
            mode="after"
            lookups={{ goalName: () => null, domainName: (slug) => slug }}
          />
        );
      })}
    </>
  );
}
```

`BatchBody` must receive the same `lookups` the other bodies use. Thread the `lookups` argument from `DecisionBodyView` into `BatchBody` instead of the inline stubs above when `lookups` is already in scope. Use that in-scope value.

In `buildInstructions`, insert the constraint sentence as its own string in the `base` array immediately after the `capture_transaction` string.

In `SettingsHermes.tsx`, under the File implied changes `SettingsRow`, render a section titled "Apply assistant inserts immediately" with the description from Global Constraints. Load databases with `api().dbList(null)` when `snapshot` is set. Keep live domains: `snapshot.domains` entries whose `archivedAt` is null. Group `dbList` entries by `domainSlug` for those domains. Domain heading is the domain name from the snapshot.

Each database checkbox:

```tsx
<input
  type="checkbox"
  aria-label={`Apply assistant inserts immediately: ${domainName} / ${database.name}`}
  checked={listed}
  onChange={(e) => void onToggleInsert(domainSlug, database.id, e.target.checked)}
/>
```

`listed` is true when `snapshot.settings.autoApproveInserts` contains that pair. If the field is missing at runtime, treat it as `[]`.

`onToggleInsert` copies the current list, adds or removes the pair, and calls `api().settingsUpdate({ autoApproveInserts: next })`. On failure, set `error` to the message and do not leave local state ahead of `snapshot.settings`. The checkbox reads the snapshot, so a failed save leaves it where the saved list says it is.

After the live groups, render stored pairs that are not in the live list. Label them `{domainSlug} / {databaseId}`. The checkbox is checked. Unchecking removes that pair through the same `settingsUpdate`. The panel has no control that adds a pair absent from `dbList`.

- [ ] **Step 4: Run the shell tests to verify they pass**

```powershell
node --experimental-strip-types --test tests/database-mcp-shell.test.ts tests/implied-filing-shell.test.ts tests/companion-client.test.ts
```

Expected: PASS.

From `packages/vault-core`, re-run the behavioral file so the UI task did not disturb it:

```powershell
node --experimental-strip-types --test tests/insert-rows.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/components/settings/SettingsHermes.tsx apps/desktop/src/components/decisions/DecisionsInbox.tsx apps/desktop/src/components/decisions/DecisionBody.tsx apps/desktop/electron/companion-client.ts apps/desktop/tests/database-mcp-shell.test.ts apps/desktop/tests/implied-filing-shell.test.ts apps/desktop/tests/companion-client.test.ts
git commit -m "feat(desktop): choose which database inserts apply immediately" -m "Settings lists a checkbox per live database. A batch Decision renders as Database rows. The companion is told to call insert_rows once for many new rows."
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Empty allowlist, missing key reads as `[]`, invalid patch rejected, theme patch preserves the list | 1, 4 |
| `insertRows` transaction, `INSERT`, rollback on existing id | 2 |
| `database-batch` target, normalize, create, one file, domain lens slug | 3 |
| Apply re-checks cells, archived domain rejects, collision rejects, no partial rows | 3 |
| `insert_rows` cap, validation prefix `Row N:`, one Decision, minted ids, actor from the tool | 4 |
| Allowlist match for batch and for create; update stays pending | 4 |
| Tool result `posted` / `rowCount` / `reason`; log lines `decision.created` and `decision.resolved` | 4 |
| Settings checkboxes, stale pairs, no assistant writer | 4 (no tool), 5 (UI) |
| Kind label, batch body, companion sentence | 5 |
| `capture_transaction` and `fileUnsolicited` unchanged | 5 does not edit them |
| No `LAWS` / `README` / `PRODUCT` / `VISION` edits | Global Constraints |
