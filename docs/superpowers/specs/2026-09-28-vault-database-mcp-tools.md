# Design Document: Generic Vault Database MCP Tools

**Title**: Expose Generic Domain Database Tools Through MCP  
**Author**: TBD (LifeQuest agent platform)  
**Reviewer**: grok design review, round 4 (all issues addressed)  
**Date**: 2026-09-27 (rev. 6)  
**Status**: Draft — product questions 4, 5, and 6 resolved; no open questions remain

---

## Overview

The LifeQuest in-app companion (Hermes) has no MCP surface for reading or writing the vault's domain
databases. Finance databases—accounts, categories, transactions, budgets, recurring, holdings,
assumption-sets—are reachable only through the operator or the finance kit itself. This forces the
agent to guess account names, blocks it from resolving `capture_transaction` posts intelligently, and
leaves no agent-visible way to *propose* a legitimate finance row write.

This design adds a small set of generic domain-database tools to the MCP server, keyed by
`(domainSlug, databaseId)`, that work on every database in every live domain including any a future
kit or the operator creates. Reads are direct. **All** agent-initiated row writes and all
`create_database` / `add_column` calls go through Decisions. `capture_transaction` stays the direct
conversational expense path. No product code, tests, LAWS, README, PRODUCT, or VISION files are
changed by this design; it is a proposal for a future implementation PR series.

The tool surface is **on by default**. There is no feature flag.

---

## Background & Motivation

**Current state.** `apps/desktop/electron/mcp-server.ts:85` registers seven `MapToolDef` arrays
(`MAP_TOOL_DEFS`, `GOALS_TOOL_DEFS`, `DOCUMENT_TOOL_DEFS`, `REVIEW_TOOL_DEFS`, `CAPTURE_TOOL_DEFS`,
`SCRIPT_TOOL_DEFS`, `PROJECT_TOOL_DEFS`) in one loop and compiles each def's `parameters` into a Zod
shape with the local `toZod` / `buildShape` helpers (`mcp-server.ts:28–82`). Every call is dispatched
by `executeTool` in `apps/desktop/electron/map-tools.ts:85`, which defaults its `actor` parameter to
`AGENT_ACTOR` (`map-tools.ts:33, 90`) and branches per def array. The domain-database engine in
`packages/vault-core/src/domain-databases.ts` already exports `createDatabase`, `listDatabases`,
`getDatabase`, `addDatabaseColumn`, `listRows`, `getRow`, `upsertRow`, `deleteRow`, `saveDatabaseFile`,
and `isDomainLive`. The operator IPC in `apps/desktop/electron/vault-service.ts` maps the same verbs
to the renderer.

**Correction to the round-1 document (important).** `SCRIPT_TOOL_DEFS` already exposes
`run_script_block` ("Run a script source against the domain's database without saving it"), which
executes a single read-only `SELECT`/`WITH` with a forbidden-word list
(`script-block.ts:19–70`), is scoped to one domain, is capped at `MAX_ROWS = 200`, and is covered by
`packages/vault-core/tests/script-block.test.ts`. The agent can therefore *already* run
`SELECT id, cells FROM rows WHERE database_id = 'finance:accounts'` today. The gap is **not** first-ever
read access. It is:

1. **Discoverability and typed safety.** `run_script_block` requires the model to know the `rows`
   table layout, to write SQL, and to hand-parse a `cells` JSON blob. There is no way to ask "what
   columns does this database have?" without SQL on the `registry.json`-shaped schema. The new tools
   answer that with `get_database` / `list_databases`.
2. **Bounded, ordered pagination** rather than a 200-row truncation of an unordered `SELECT *`.
3. **Typed cell maps** that go through `validateCells` instead of raw JSON in SQL.
4. **No way to propose a write.** There is no agent-visible surface to file a Decision for a finance
   row change; today every write that would be a post goes through the operator or a hand-run script.

**Approved decision table.** `docs/superpowers/specs/2026-09-23-domain-databases-finance-kit-prs.md`
§8 and `LAWS/DATABASES.md` state the invariants: posted row/transfer/category/account writes go
through Decisions; conversational expense/income uses `capture_transaction` (no Decision); ingest
mappings, kit installs, and page writes from Hermes go through Decisions; script blocks and
`capture_transaction` bypass Decisions; rejected Decisions do nothing and must not be retried as
silent upserts.

**Accepted extension.** The §8 table enumerates the write paths the agent may take, and it originally
contained no row for "agent writes arbitrary non-finance rows silently". That table now carries one
added row: *all* agent-initiated row writes, including non-finance, non-mirrored, operator-created
databases, are Decision-gated. The row is strictly more conservative than what §8 previously
required (it gates more), and it is what makes the ungated path in the round-1 draft safe to drop.
Product sign-off has been received and `spec §8` accepts the row. See "Decision Table Extension"
below.

---

## Goals & Non-Goals

**Goals**
- Give the agent schema discovery and bounded read access over every database in every **live** domain.
- Give the agent a typed, audited write path: every agent row write and every agent schema change
  becomes a Decision that the operator must approve, and approval must actually apply the row.
- Keep `capture_transaction` as the direct expense path, untouched.
- Never let the agent choose its own actor.
- Avoid per-database or per-kit tool registration, and avoid a second list of tool arrays that can
  drift out of sync.
- Ship default-on.

**Non-Goals**
- Replace or alter `capture_transaction`, `undo_capture`, `correct_capture`.
- A SQL passthrough, arbitrary eval, or a query language (`run_script_block` remains the read-only
  escape hatch; this design does not remove or restrict it).
- Exposing sync-conflict *resolution* to the agent (it is a write; see §4).
- Exposing Decision *resolution* (approve/reject) to the agent (that would defeat the design).
- `delete_database` and column removal. `add_column` is added; anything destructive on a schema
  stays operator-only in the studio.
- `saveDatabaseFile`. Consequently `file`-typed columns are **not writable** by the agent (see
  "Known Gaps").

---

## Proposed Design

### 1. Tool Set

One new `MapToolDef` array exported from vault-core, registered by the existing loop in
`mcp-server.ts`. Every tool is generic: it takes `domainSlug` + `databaseId`.

```ts
// packages/vault-core/src/database-tools.ts
export const DATABASE_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_databases",
    description:
      "List every database in every live domain, plus the kits installed in each domain. Kits are " +
      "recorded per domain, so the kit field is always keyed by domain. Use this to discover " +
      "databases (e.g. finance:accounts) and to check whether the finance kit is installed. Returns " +
      "{ kits: [{ domainSlug, kits }], databases: [{ domainSlug, database }] }.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "Optional domain slug to limit results, e.g. 'financial'.",
        },
      },
    },
  },
  {
    name: "get_database",
    description:
      "Return the schema (column ids, names, types, options, relation targets) for one database. " +
      "Use this to learn the exact column ids before building a cells map.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
      },
      required: ["domainSlug", "databaseId"],
    },
  },
  {
    name: "list_rows",
    description:
      "List rows in a database with optional pagination. Results are ordered by createdAt then id. " +
      "No filtering is applied. Returns row ids and cell values keyed by column id.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        limit: { type: "number", description: "Max rows to return (default 100, max 500)." },
        offset: { type: "number", description: "Row offset for pagination (default 0)." },
      },
      required: ["domainSlug", "databaseId"],
    },
  },
  {
    name: "get_row",
    description: "Return one row by id, including its full cells map and updatedAt.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        id: { type: "string" },
      },
      required: ["domainSlug", "databaseId", "id"],
    },
  },
  {
    name: "list_decisions",
    description:
      "List Decisions filed by the agent, newest first. Read-only: this tool cannot approve or " +
      "reject. Use it to check whether a proposed write was approved or rejected before proposing " +
      "a replacement.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional filter: 'pending' | 'approved' | 'rejected'." },
        limit: { type: "number", description: "Max rows (default 20, max 100)." },
      },
    },
  },
  {
    name: "upsert_row",
    description:
      "Propose creating or fully replacing a row in a database. Cells is a map of column id to " +
      "value and MUST contain the complete set of cells for an existing row (read the row with " +
      "get_row first); this is a replace, not a patch. Every call files a Decision; the operator " +
      "approves it in Decisions. A rejected Decision must not be retried as a silent write.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        id: {
          type: "string",
          description: "Row id for an update. Omit entirely to create a new row (a UUID is generated).",
        },
        cells: {
          type: "object",
          additionalProperties: true,
          description: "Map of column id to typed value. Free-form; must be a JSON object.",
        },
      },
      required: ["domainSlug", "databaseId", "cells"],
    },
  },
  {
    name: "delete_row",
    description:
      "Propose deleting a row by id. Files a Decision. The operator approves or rejects it in " +
      "Decisions; a rejected Decision must not be retried silently.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        id: { type: "string" },
      },
      required: ["domainSlug", "databaseId", "id"],
    },
  },
  {
    name: "create_database",
    description:
      "Propose creating a new empty database in a live domain. Files a Decision naming the database id " +
      "it proposes. Columns are added by a separate add_column call, one per column (also " +
      "Decision-gated).",
    parameters: {
      type: "object",
      properties: { domainSlug: { type: "string" }, name: { type: "string" } },
      required: ["domainSlug", "name"],
    },
  },
  {
    name: "add_column",
    description:
      "Propose adding one column to an existing database. Files a Decision. The relation target is " +
      "an existing databaseId, so a self-referential or newly created column cannot be added in the " +
      "same call.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          description: "One of: text, number, date, select, checkbox, relation, file.",
        },
        options: { type: "array", description: "Required for type 'select'." },
        relationDatabaseId: { type: "string", description: "Required for type 'relation'." },
      },
      required: ["domainSlug", "databaseId", "name", "type"],
    },
  },
];
```

**No `actor` parameter exists on any tool.** See §6.

**Free-form object parameters.** `cells` is declared with `additionalProperties: true`. This requires
a two-line change to `mcp-server.ts`, not one: the `p` cast at the top of `toZod`
(`mcp-server.ts:29-34`) does not declare `additionalProperties`, so the branch would not typecheck —
and `npm run typecheck` is a PR exit criterion.

```ts
// mcp-server.ts:29 — widen the cast
const p = prop as {
  type?: string | string[];
  enum?: unknown[];
  items?: unknown;
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;   // added
};

// mcp-server.ts:69 — and branch on it
case "object":
  // Free-form object: keep every key. z.object({}) would strip all of them.
  if (!p.properties && p.additionalProperties) {
    return z.record(z.string(), z.unknown());
  }
  return z.object(buildShape(p.properties ?? {}));
```

The `!p.properties` guard (not a `properties` emptiness check) is what keeps the existing arrays
unaffected: the only property-less object in the codebase is `list_documents`, which declares
`parameters: { type: "object", properties: {} }` (`document-tools.ts:24`) — `properties` is present,
so the branch is skipped and it still compiles to `z.object({})`, which is correct for a tool that
takes no arguments.

Without this, `buildShape` produces `z.object({})` and Zod strips every cell on the way in — a silent
data-loss bug that `validateCells` passes vacuously (it only rejects *unknown* keys). The `cells`
round-trip is covered by a test (§"Test Plan", case 1).

### 2. Dispatch

```ts
// apps/desktop/electron/map-tools.ts
import { ALL_TOOL_DEFS, executeDatabaseTool } from "@lifequest/vault-core";

export async function executeTool(
  root, activeSlug, name, args, actor: VaultActor = AGENT_ACTOR,
): Promise<unknown> {
  // ...
  if (DATABASE_TOOL_DEFS.some((t) => t.name === name)) {
    return executeDatabaseTool(root, actor, name, rec);
  }
```

`executeDatabaseTool` mirrors `executeDocumentTool` and `executeCaptureTool`: it takes the actor from
its caller (never from args), validates, calls the engine or the decision path, and returns the
result shape in §"Tool Contracts".

#### 2.1 Validation performed in `executeDatabaseTool`

`mcp-server.ts`'s `buildShape` marks **every** property `.optional()` and never reads the `required`
array (`mcp-server.ts:76–82`). The `required` annotations in the defs are therefore **advisory
documentation for the model only**; the planner path (`runPlannerLoop`) passes raw model JSON with no
schema validation at all. All real validation happens in `executeDatabaseTool`:

| Check | Failure |
|---|---|
| `domainSlug` is a non-empty string | `VALIDATION` |
| `databaseId` is a non-empty string (except `list_databases`, `list_decisions`) | `VALIDATION` |
| `id` is a non-empty string when present; absent ⇒ create | `VALIDATION` |
| `cells` is a plain object (not array/null/scalar) | `VALIDATION` |
| `cells` is non-empty | `VALIDATION` |
| `isDomainLive(root, domainSlug)` is false | `NOT_FOUND` (archived *or* absent — indistinguishable to the agent by design; the message names the slug) |
| `getDatabase` returns `ok: false` | `NOT_FOUND` |
| `limit` is a finite integer in `[1, 500]`, default 100 | `VALIDATION` |
| `offset` is a finite integer `>= 0`, default 0 | `VALIDATION` |
| `status` in `list_decisions` is one of the three literals | `VALIDATION` |
| `type` in `add_column` is a `DatabaseColumnType`; `options` present iff `select`; `relationDatabaseId` present iff `relation` | `VALIDATION` |

`domainSlug`/`databaseId` presence is checked *before* the engine call so a missing arg yields
`VALIDATION` rather than a `NOT_FOUND` from a malformed lookup.

### 3. Decision Routing

`executeDatabaseTool` never calls `upsertRow`/`deleteRow`/`createDatabase`/`addDatabaseColumn` for an
agent-initiated write. Every such call files a Decision through **`createDecision`** in
`packages/vault-core/src/decisions.ts` — the exported proposal function. (There is no
`proposeDecision` in the codebase.)

| Tool | Routing |
|---|---|
| `list_databases`, `get_database`, `list_rows`, `get_row`, `list_decisions` | **Direct.** Reads never create Decisions. |
| `upsert_row`, `delete_row` | **Always a Decision**, for every database in every live domain. |
| `create_database`, `add_column` | **Always a Decision.** |

The gate is deliberately unconditional rather than keyed on a finance id list. See §3.2.

#### 3.1 Why unconditional (and what it costs)

The round-1 draft gated on `domainSlug === "financial"` ∧ id ∈ `FINANCE_DB_IDS` ∨
`sotMode === "local-canonical-mirror"`, and left everything else on a direct write. That is wrong on
three counts:

- An operator-created database inside the `financial` domain (a rent tracker, a debt plan) is
  `local-only` and not in `FINANCE_DB_IDS`; it would have taken the ungated path while holding money
  data. Any future kit installed under `financial` has the same problem.
- `linked-canonical` databases are excluded from the gate, but the spec §6 says for linked-canonical
  "remote is the book; LifeQuest edits write-through when online". A direct `upsertRow` writes the
  local replica, bypassing the write-through and offline queue in `adapters.ts`, so the next sync
  silently overwrites it.
- `upsertRow`/`deleteRow` call no `appendLog` at all. A direct write leaves **no trace** — not in the
  life log, not in the Decision inbox, not anywhere. An unaudited, unlogged write to the user's data
  store is not an acceptable default for any database, finance or not.

The cost is real and should be stated: a user asking the agent to add a row to a personal reading
list now gets a Decision instead of an instant write. The mitigation is that a Decision is one click
and the agent can report "proposed — approve it in Decisions". Auditability wins.

#### 3.2 Finance-specific identity

The gate is unconditional, so no finance id list is needed in the tool layer. The *title* and the
*extra validation* of a proposed finance write are still finance-aware, and they use the exported
constants rather than literals:

```ts
import { FINANCE_DOMAIN_SLUG, FINANCE_DB_IDS } from "./types.js";

const isFinanceDb = (domainSlug: string, databaseId: string) =>
  domainSlug === FINANCE_DOMAIN_SLUG &&
  (Object.values(FINANCE_DB_IDS) as string[]).includes(databaseId);
```

`isFinanceDb` is used only to (a) title the Decision, e.g. `Transaction in Ledger · 2026-09-27`, and
(b) enable the referential checks in §5. It is not used to decide whether to gate.

#### 3.3 What the Decision carries

`DecisionRecord` (`types.ts:282–290`) has **no** `proposed` cells field. It has `proposedTitle`,
`proposedBodyMarkdown`, and `previousBodyMarkdown`. Cells are therefore serialised as JSON into the
markdown fields, which is exactly the pattern the `page`, `pins`, and `mapping` branches of
`applyApprovedBody` already use:

```ts
// upsert_row / delete_row / create_database / add_column
const body = {
  op: "upsert" | "delete" | "create-database" | "add-column",
  databaseName,             // resolved at propose time for the operator's benefit
  rowLabel,                 // human label for the affected row, or null
  previousCells,            // get_row().cells at propose time, or null for create
  cells,                    // the proposed full cell set, or null for delete
  expectedUpdatedAt,        // staleness guard, see below
};
await createDecision(rootPath, {
  actor,                                    // from executeTool, never from args
  target: { type: "database-row", domainSlug, databaseId, rowId: id ?? null },
  proposedTitle: `Transaction in Ledger · 2026-09-27`,
  proposedBodyMarkdown: JSON.stringify(body, null, 2),
  previousBodyMarkdown: previousCells ? JSON.stringify(previousCells, null, 2) : null,
});
return { decisionId, status: "pending" };
```

**Schema-change targets allocate their id at propose time.** `create_database` cannot be given a
`databaseId` in its target the way a row write is: at propose time the database does not exist, and
`createDatabase` mints `id: randomUUID()` internally (`domain-databases.ts:141-149`) from an input
that is only `{ name }`. The only way to know the id beforehand would be to create the database
*before* filing the Decision — the ungated write this design exists to prevent, and it would leave an
un-approved database behind on rejection.

The id is therefore **minted by the tool layer at propose time and carried through the body**, exactly
as the existing `project` target does: `projectCreate` receives `String(command.id)` from the
Decision's proposed body (`decisions.ts:701-712`), so the id is known before the entity exists. The
same pattern:

```ts
// create_database — the tool mints the id
const newDatabaseId = randomUUID();
const body = {
  op: "create-database",
  databaseId: newDatabaseId,   // allocated now, written by createDatabase on apply
  name,
  previousCells: null,
  cells: null,
  expectedUpdatedAt: null,
};
await createDecision(rootPath, {
  actor,
  target: { type: "database", domainSlug, databaseId: newDatabaseId },
  proposedTitle: `New database "${name}" in ${domainSlug}`,
  proposedBodyMarkdown: JSON.stringify(body, null, 2),
  previousBodyMarkdown: null,
});
```

This requires `createDatabase` to accept an optional id, mirroring `projectCreate`'s `id`:

```ts
// domain-databases.ts — id becomes optional, generated when absent
export async function createDatabase(
  root: string,
  slug: string,
  input: { name: string; id?: string },
): Promise<Result<DatabaseMeta>>;
// dbMeta.id = input.id ?? randomUUID();
```

`input.id` stays optional, so the existing operator call site (`vault-service.ts` `dbCreate`, passing
`{ name }`) and `finance-kit.ts` are unaffected. The `createDecision` validation branch for
`{ type: "database" }` then checks a value the caller can actually supply.

`add_column` has the mirror problem: the target's `databaseId` is knowable (the database exists), but
the *proposed column's* `id` is not — `addDatabaseColumn` assigns `id: randomUUID()` (`:280`). So the
Decision target deliberately identifies only the **database**; the column spec — name, type, options,
`relationDatabaseId` — lives in the proposed body, which is what the operator reads. The target does
not claim to identify a column, and `documentTargetLabel` for `{ type: "database" }` renders as
`Add column to ${databaseName}`. `addDatabaseColumn` needs no id parameter: a Decision that names one
column is unambiguous, and the `name` in the body is what the operator approves.

**Staleness guard.** `expectedUpdatedAt` is the row's `updatedAt` at propose time. `applyApprovedBody`
re-reads the row and, if `updatedAt` differs, does **not** apply and returns a failure. Without this, a
Decision approved a week later silently clobbers a week of edits — and because `upsertRow` is a full
replace, "clobber" means total loss (§5).

The guard needs a control-flow change in `resolveDecision`, because as written today it would
reintroduce the exact "stuck `pending`" failure mode this design identified one layer up. The current
shape (`decisions.ts:849-859`) is:

```ts
if (resolution === "approved") {
  const applyRes = await applyApprovedBody(rootPath, decision);
  if (!applyRes.ok) return applyRes;   // ← returns before the status write
}
decision = { ...decision, status: resolution, resolvedAt: now };
await writeDecisionFile(filePath, decision);
```

The early return leaves the record `pending` on disk: `applyApprovedBody` returns `Result<void>` and
never touches the record, so nothing can flip the status. The operator clicks Approve, sees a failure,
and the Decision is neither approved nor rejected.

**Required change — a *terminal* apply failure resolves the Decision `rejected`; a transient one stays
retryable.** `Result<T>` (`types.ts:573`) is `{ ok: false; error: string }` and carries no room for a
terminal flag, so `applyApprovedBody` returns a wider outcome for this purpose:

```ts
// decisions.ts — new, internal. The success arm keeps `value?: undefined`
// so the thirteen existing `{ ok: true, value: undefined }` literals stay
// assignable and need no edit (see the note below).
type ApplyOutcome =
  | { ok: true; value?: undefined }
  | { ok: false; error: string; terminal: boolean };
```

`applyApprovedBody` changes its return type from `Result<void>` to `ApplyOutcome`. **The success
arm must be declared with `value?: undefined`, not as a bare `{ ok: true }`.** `applyApprovedBody`
returns `{ ok: true, value: undefined }` at **13** sites (`:549, 577, 594, 641, 648, 668, 683, 714,
719, 737, 771, 789, 810`), and each of those fresh object literals trips TypeScript's
excess-property check against a bare `{ ok: true }` — a compile error, and PR 1's exit criteria
require a clean typecheck. Declaring `value?: undefined` makes all thirteen assignable unchanged, so
only the **23 failure literals** (`:536-815`, every `return { ok: false, error }` in the function) need
`terminal: false` added. That is the same class of omission as the `toZod` cast gap in round 2: it
only surfaces at compile time.

**The eleven existing target types**
(`doctrine`, `library`, `review`, `page`, `pins`, `mapping`, `kit-install`, `assumption-set`, `goal`,
`project`, `day-template`) keep their behaviour exactly: every existing branch returns
`{ ok: false, error, terminal: false }` on failure — a mechanical widening with no semantic change.
The two **new** branches mark the failures that are permanent:

| Failure in a `database-row` / `database` apply | `terminal` | Why |
|---|---|---|
| `expectedUpdatedAt` mismatch | `true` | The row has moved on; re-applying the same cells would overwrite the newer state. The proposal can never become valid again. |
| `validateCells` rejection | `true` | The cells are wrong for the schema. Re-approving the same Decision re-validates the same cells and fails identically. |
| Referential check fails (missing `account`/`category` row) | `true` | The referenced row was deleted. Same cells, same result. |
| Domain archived since propose | `true` | Archived is terminal; `isDomainLive` will not un-archive on retry. |
| I/O error, `atomicWriteFile` failure, SQLite error, disk full | `false` | Transient. Retrying may well succeed. |
| Sync conflict present on the target row | `true` | A conflict is operator-resolved; until then the apply is not merely failing, it is wrong. |

`resolveDecision` then becomes:

```ts
if (resolution === "approved") {
  const applyRes = await applyApprovedBody(rootPath, decision);
  if (!applyRes.ok) {
    if (applyRes.terminal) {
      // Permanent: record the outcome instead of stranding the decision
      // pending forever with no way for anyone to act on it.
      decision = { ...decision, status: "rejected", reason: applyRes.error, resolvedAt: now };
      await writeDecisionFile(filePath, decision);
      await appendLog(paths.root, {
        domainSlug: decision.domainSlugs[0] ?? null,
        type: "decision.resolved",
        summary: `Decision rejected: proposal no longer applies (${decision.title})`,
        payload: { id: decision.id, resolution: "rejected", documentKind: decision.target.type },
        actor: decision.actor,
      });
    }
    return { ok: false, error: applyRes.error };   // transient: record untouched, retryable
  }
}
decision = { ...decision, status: resolution, resolvedAt: now };
await writeDecisionFile(filePath, decision);
```

**Answering the review's question directly: after this change, a failed apply is retryable if and only
if the failure is transient.** A transient failure leaves the record `pending` and the operator can
click Approve again — unchanged from today. A terminal failure resolves it `rejected`, and since
`resolveDecision` refuses any record whose `status !== "pending"` (`:840-845`), that Decision can never
be applied again. That is the intent: a proposal whose cells no longer match the row, or whose domain
was archived, is not a thing the operator can usefully approve later, and leaving it `pending` forever
is what makes an un-actionable record indistinguishable from a live one.

**This is scoped so the eleven existing target types are unaffected**, which the round-3 draft got
wrong by reasoning only about the two new types. `resolveDecision` is target-agnostic and its only
caller is `vault-service.ts:723` (`decisionResolve`), so a blanket change would have converted a
retryable locked-doctrine-file or full-disk error on an *existing* decision type into a permanent
rejection — with no risk assessment and no operator-visible distinction from a genuine rejection.
The `terminal` flag is what prevents that: every existing branch returns `false`.

**The renderer must show the reason, and must distinguish the two kinds of rejection.** `DecisionsInbox`
renders status plus two `<pre>` blocks today and has no `reason` line (verified: no `reason` reference
in the file), so a rejected-on-apply Decision would be visually indistinguishable from one the
operator rejected. The inbox change in PR 1 must therefore render `reason` when present, and
distinguish the two rejections — for example `Rejected · proposal no longer applies` against
`Rejected` — so an operator reading a rejected-on-apply record understands that they *did* approve it
and it failed, rather than believing they declined it.

**The agent-facing consequence, stated rather than hidden.** §3's standing rule is "do not retry a
rejected write". With this change that rule is correct: a terminal rejection means re-proposing without
re-reading the row would be wrong, and `list_decisions` shows the agent a `reason` telling it to re-read
and start over. A *transient* failure leaves the record `pending`, so the agent sees it still pending
and correctly does not re-propose — the operator can retry. Neither path strands a change the operator
approved.

**The UI trade-off applies to the terminal case only**, and should be visible in the inbox: a
rejected-on-apply Decision looks to the operator like a rejection, so the inbox renders `reason` and
labels it distinctly (see above). The early return is *not* rejected — it is retained, and is the
correct behaviour for a transient failure, where a `pending` record the operator can re-approve is
exactly right.

**Rejections must be surfaced.** The agent cannot resolve a Decision (`resolveDecision` takes a
resolution, so wiring it to MCP would hand the agent the approve button). `list_decisions` gives it
read-only visibility, which is what makes the rule "do not retry a rejected write silently"
enforceable: after filing, the agent checks `list_decisions` and reports the outcome. The tool
description on `upsert_row` states this contract explicitly.

### 4. Adapter Safety

Conflicts are **per row / external id**, not per database (`adapters.ts:527–570`). A single unrelated
conflict must not block every agent write to a database, so the check is row-scoped. The one exception
is a create, which has no row to match and is handled explicitly in step 3:

1. Before proposing an `upsert_row` / `delete_row`, `executeDatabaseTool` calls `getDatabase`; if
   `database.adapter` is `null`, skip entirely.
2. Otherwise call the **read-only** `listSyncConflicts(root, slug, databaseId)`
   (`adapters.ts:768`) and match the target row. `SyncConflict` (`types.ts:618-628`) carries both
   `externalId: string` and `rowId: string | null`, and **`rowId` is matched first** — it is the direct
   local row identifier, and the tool already has it in hand as its `id` argument:

   ```ts
   const conflicts = listSyncConflicts(root, slug, databaseId);
   const isTarget = (c: SyncConflict) =>
     rowId != null && c.rowId === rowId            // primary: direct local row id
     || (rowId == null && c.externalId != null && proposedExternalId != null
         && c.externalId === proposedExternalId); // fallback: remote-derived rows only
   ```

   Matching on `externalId` alone is wrong in practice: rows created by `capture_transaction` set
   `external_id: null` (`capture.ts:394, 636`) and a conflict's `externalId` is only populated for rows
   that came from a remote adapter. So for a chat-posted row — the design's primary motivating case —
   an `externalId` match compares `null` against a remote string and never fires, while the `rowId`
   field that *would* have matched is ignored.

3. A **create** (no `rowId`, and the row does not exist yet) is **unmatchable by construction** — there
   is no `external_id` cell to compare and no row to match. Such a proposal is **rejected outright
   while any conflict exists on the database**, returning `CONFLICT` with the conflicting rows listed
   and the message "resolve the outstanding sync conflicts on this database before proposing a new
   row". This is the one case where the block is database-scoped rather than row-scoped, and the
   reason is that a create genuinely cannot be attributed to a specific conflicting row. It is stated
   rather than left implicit because it is the only case where an unrelated conflict blocks a write.
4. Any match returns `{ error: { code: "CONFLICT", message, conflicts } }` and files nothing.
5. **Conflict resolution stays operator-only.** `resolveSyncConflict` is *not* exposed on MCP or in
   the tool set. It is a write: "keep remote" performs its own `upsertRow` and "keep local"
   re-queues (`adapters.ts:784`). Exposing it would be an ungated write path that bypasses the
   Decision gate this design exists to create. The agent tells the operator to resolve it in the
   studio and re-propose afterwards.

`listSyncConflicts` is currently exported from vault-core and wired only to the renderer via
`vault-service.ts:1211`; calling it from the tool layer is a new call site of an existing read
function, not a new capability.

### 5. Write Semantics, Validation, and the `cells` Replace

`upsertRow` executes `INSERT OR REPLACE INTO rows (..., cells) VALUES (...)` with
`JSON.stringify(input.cells)` (`domain-databases.ts:487–490`). **The entire cells object is
replaced.** This is not a patch, and the tool contract says so. A Decision proposing
`{ amount: -85 }` for an existing transaction, approved a week later, would erase `date`, `account`,
`category`, `payee`, `provenance`, and `external_id` — the loss happens on *approve*, where
"rejected Decisions do nothing" gives no protection.

Mitigations, all required:
- The `upsert_row` description states the complete-cell-set requirement and tells the model to
  `get_row` first.
- `previousCells` is captured at propose time and rendered in the inbox as a real before/after.
- `expectedUpdatedAt` (§3.3) rejects a stale apply outright.

**`validateCells` is weaker than the round-1 document claimed.** Read at
`domain-databases.ts:297–372`, it checks: unknown column ids are rejected; `text`/`number`/`date`/
`select`/`checkbox`/`file` values are type-checked (`select` against `col.options`, `file` against
`domains/{slug}/data/files/` path shape); and for `relation` it checks that the **relation database
exists in the registry** — *not* that the referenced **row** exists. There is no required-field
check, no uniqueness check, and no cross-field rule. So the Security section must not claim
"`validateCells` already enforces column type constraints" in full.

Additional validation for finance proposed writes, all inside `executeDatabaseTool` (no
`domain-databases.ts` change required), applied at **propose** time so a bad proposal is never
filed, and re-checked at **apply** time:

| Rule | Where |
|---|---|
| `relation` cells: referenced row exists in the relation database (`getRow`) | tool + apply |
| Posted transaction: `date` present and `YYYY-MM-DD`; `amount` a finite non-zero number; `provenance` defaults to `"agent"` when absent | tool + apply |
| `external_id` not already present in the target database (ingest dedup, spec §5) | tool, by reusing the ingest predicate — see below |
| `select` values within `col.options` (already covered by `validateCells`, re-asserted at apply) | engine |

These are deliberately narrow: they cover the posted-row invariants the spec names, and no attempt is
made to build a general constraint engine.

**The dedup rule reuses the ingest predicate; it is not a `listRows` scan.** An earlier draft proposed a
"bounded `listRows` scan" keyed on the `provenance`/`external_id` *pair*. That was wrong twice over.
The mechanism cannot work: `listRows` is paged 500 rows at a time in `ORDER BY created_at ASC` (this
design's own pagination decision), so a bounded scan sees only the *oldest* 500 transactions and a
duplicate against a recent row — the only case that matters for a chat-proposed write — is invisible.
A dedup check that silently misses is worse than one that is absent, because it reads as protection.
And the rule duplicated existing code: `ingest.ts:197-221` already implements this as
`lookupExternalId`, whose predicate is on `external_id` **alone** (it resolves the column by name or
id, then compares `cells[externalIdColId] === externalId`, with literal-key fallbacks). A
`provenance`/`external_id` pair corresponds to nothing in the ingest path.

So:

- `lookupExternalId` is **exported** from `packages/vault-core/src/ingest.ts` (it is currently
  module-private) and called by `executeDatabaseTool` for any `external_id` in the proposed cells.
  One predicate, one place, no drift from the ingest path.
- The rule keys on `external_id` alone, matching ingest.
- It is a **no-op for chat-posted rows**, and that is correct rather than a gap: `capture.ts:394, 636`
  sets `external_id: null` on every transaction it posts, so a row the agent proposes from chat
  carries no external id and has nothing to collide with. The check protects the case where the agent
  *does* supply an `external_id` (forwarding a bank or ingest reference), which is exactly the case
  where a duplicate is possible and exactly the case the spec's dedup rule is about.
- Because `lookupExternalId` itself calls `listRows` internally, it is a full read of the target
  database. For a `finance:transactions` ledger that is a real cost — but it is the same cost ingest
  already pays on every accepted file, so this design does not make it worse, and reusing the function
  keeps the dedup semantics identical to the path it mirrors. Optimising `lookupExternalId` to a
  targeted SQL `WHERE cells->>'external_id' = ?` is listed in PR 4.

#### 5.1 `create_database` and `add_column` are multi-call

`createDatabase(root, slug, { name })` takes **only a name** and always returns `columns: []`
(`domain-databases.ts:120–178`). Columns are added separately by `addDatabaseColumn`
(`:236–295`), one call per column, each of which re-reads and rewrites `registry.json`. There is no
`columns` argument and never was.

- The `create_database` tool therefore declares only `domainSlug` and `name`. The agent follows up
  with N × `add_column`, each its own Decision.
- `relationDatabaseId` is not expressible for a brand-new database at create time (there is no id
  yet); such a column must be added in a second pass after the create is approved.
- **Partial failure is possible and is not rolled back.** If two of four column Decisions are
  approved, the database exists with two columns. This is surfaced, not hidden: each Decision is
  independently reviewable in the inbox and names its database, and the tool responses carry the
  database id so the agent can report "created with 2 of 4 columns". Rolling back an approved schema
  change would itself need a Decision; we do not attempt it.
- `delete_database` and column removal are **Non-Goals** (see Goals & Non-Goals). A database the
  agent creates is operator-deletable only.

#### 5.2 Concurrency on `registry.json`

`createDatabase` and `addDatabaseColumn` are read-modify-write cycles on `registry.json` with no
locking, and `addDatabaseColumn` rewrites once per column. This design adds a new concurrent writer
(the agent) alongside the operator in the renderer, and both are live simultaneously.

Required: a single-writer lock around the registry read-modify-write in `createDatabase` and
`addDatabaseColumn` (an in-process async mutex keyed by registry path is sufficient — the engine runs
in one Electron main process), **plus** a re-read-and-merge inside the critical section so a lock
taken after a stale read cannot still lose an update. `upsertRow`/`deleteRow` are keyed on
`(database_id, id)` via `INSERT OR REPLACE` and need no lock, but they are last-writer-wins, which is
what `expectedUpdatedAt` addresses.

### 6. Agent Identity

The agent **cannot** choose its actor. There is no `actor` parameter on any tool. The actor comes
solely from `executeTool`'s `actor` parameter (`map-tools.ts:90`), which defaults to
`AGENT_ACTOR = { type: "agent", id: "companion", name: "Hermes" }` (`map-tools.ts:33`) — the same
pattern `executeDocumentTool` and `executeCaptureTool` follow. `executeDatabaseTool` takes it as its
second argument and passes it to `createDecision`; it never reads it from `args`.

The round-1 draft declared an `actor: { type: "object" }` parameter on `upsert_row` and `delete_row`
while simultaneously claiming every Decision carries the companion actor. A model-controlled parameter
is not an identity source: any caller could pass `{ type: "user" }` and misattribute a proposal to
the operator in `DecisionRecord.actor` and in the life log. It is removed.

The map command actor string stays `"user" | "agent"` and is a different type. If a human-authored
path ever needs a different actor, that belongs on the operator IPC side, not in an MCP schema.

### 7. Planner Tool List — One Source of Truth

There are exactly two spread sites today, and both name the seven arrays literally
(`mcp-server.ts:85`, `map-tools.ts:48`). Adding an eighth literal to both is *two edits that can
drift*, not a single source of truth. So vault-core exports one composed array and both sites spread
it:

```ts
// packages/vault-core/src/index.ts
export const ALL_TOOL_DEFS: MapToolDef[] = [
  ...MAP_TOOL_DEFS, ...GOALS_TOOL_DEFS, ...DOCUMENT_TOOL_DEFS, ...REVIEW_TOOL_DEFS,
  ...CAPTURE_TOOL_DEFS, ...SCRIPT_TOOL_DEFS, ...PROJECT_TOOL_DEFS, ...DATABASE_TOOL_DEFS,
];
```

```ts
// mcp-server.ts:85
for (const def of ALL_TOOL_DEFS) { /* unchanged body */ }

// map-tools.ts:48 (runPlannerLoop)
const openaiTools = ALL_TOOL_DEFS.map(/* unchanged mapper */);
```

The guarantee is now "one array constant, two spread sites that cannot disagree about membership",
which is the actual failure mode worth preventing.

### 8. Finance Kit Not Installed

**Kits are per-domain, so the response is keyed by domain.** `installedKits` lives on
`DomainDatabaseRegistry` (`types.ts:399-403`), and every domain has its own registry
(`paths.ts:49`, `domainRegistry: (slug) => domains/{slug}/data/registry.json`) — so the accessor is
inherently per-slug, and `listInstalledKits(root, slug)` (`finance-kit.ts:499`) takes exactly that.
`list_databases` has an **optional** `domainSlug`, so a single flat array would be ambiguous in the
union case: nothing would say *which* domain's kits it held, and the field's entire purpose is to let
the agent "distinguish 'kit absent' from 'no databases yet'". A union-scoped flat array cannot answer
that per domain.

Both cases are therefore specified, and the shape is uniform:

```ts
// with domainSlug: one entry
{ kits: [{ domainSlug: "financial", kits: ["finance"] }], databases: [...] }

// without domainSlug (the discovery entry point): one entry per live domain scanned
{ kits: [{ domainSlug: "financial", kits: [] },
         { domainSlug: "engineering", kits: [] }], databases: [...] }
```

**The domain set comes from `paths.domainsDir`, not from `listDatabases`.** Deriving it from
`listDatabases` would be a subtle trap: that function builds its entries from each registry's
`databases` list (`domain-databases.ts:180-217`), so a **live domain that has no databases yet**
contributes no entry and would never enter the scanned set — and "this domain exists but the finance
kit is not installed" is precisely the question §8 exists to answer. A missing `registry.json` and an
empty one would both silently vanish.

So `executeDatabaseTool` enumerates domains itself, with `isDomainLive` as the filter, and calls the
existing `listInstalledKits(root, slug)` once per live domain:

```ts
// enumerate live domains the same way listDatabases' union branch does
// (paths.domainsDir + paths.domainJson, archivedAt == null), then:
for (const slug of liveSlugs) {
  const kits = await listInstalledKits(root, slug);   // finance-kit.ts:499
  kitEntries.push({ domainSlug: slug, kits: kits.ok ? kits.value : [] });
}
```

A domain with no `registry.json` yields `kits: []` — the accessor already catches and returns `[]`
rather than failing — so **every live domain appears, including ones with no databases at all**. The
agent reads `kits.find(k => k.domainSlug === "financial")` to answer "is the finance kit installed",
and a missing or empty entry means absent. This is the ground truth `listDatabases` cannot give it
today, because `listDatabases` returns only `DatabaseListEntry[]` and the kit list is never on that
path. Test 14 covers the live-but-empty case explicitly.

**The archived-domain filter lives in the tool layer, not the engine.** `listDatabases` does not
filter archived domains on the explicit-`domainSlug` path (it only filters in the union branch,
`domain-databases.ts:199`), and that is left as-is: fixing it in the engine would change what `dbList`
returns to the Data rail, so an archived domain's databases would silently disappear from the
operator's own Data UI as a side effect of an agent-facing fix. The operator still needs to reach
archived data (direct URL, `getDatabase`), and the existing `isDomainLive` semantics are what the
operator UI is built around.

So `executeDatabaseTool` applies `isDomainLive` itself, on both the explicit-slug and union paths,
before returning. Archived and absent domains never appear in `list_databases` for the agent, and the
operator's Data rail is unchanged. This is the one place the design deliberately does not fix an engine
bug, and the reason is blast radius, not effort.

### 9. Archived and Non-Existent Domains

`isDomainLive` exists (`domain-databases.ts:79–88`) and `createDatabase` calls it (line 128), but
`listRows`, `getRow`, `upsertRow`, and `deleteRow` do not. Since the design's claim is "every database
in every **live** domain", `executeDatabaseTool` calls `isDomainLive` on **every** tool invocation,
before the engine:

- An archived or absent domain returns `NOT_FOUND` with a message naming the slug. The agent cannot
  distinguish "archived" from "never existed" from the code alone; that is intentional, and the
  message says so, so the agent does not guess at resurrecting history.
- This also fixes the silent-empty-result trap: `listRows` returns `ok: true, []` when the SQLite file
  is missing (`domain-databases.ts:381–384`), so a read against a missing domain would otherwise
  read as "no accounts" — a statement the agent would report to the user as fact.

---

## API / Interface Changes

### Before
- MCP tools: map, goals, documents, reviews, capture, script, project (7 arrays, 2 literal spread sites).
- No domain-database tools. `DocumentTarget` has no database variants. `applyApprovedBody` has no
  database branch.

### After
- `ALL_TOOL_DEFS` composed in vault-core; both spread sites use it.
- Nine new tools: `list_databases`, `get_database`, `list_rows`, `get_row`, `list_decisions`,
  `upsert_row`, `delete_row`, `create_database`, `add_column`.
- `executeTool` gains one branch. `toZod` gains a cast widening plus an `additionalProperties` case.
- `listDatabases` is **unchanged**. The kit list comes from the **existing** `listInstalledKits`
  (`finance-kit.ts:499`, already exported from `index.ts:153`), which this design calls but does not
  add.
- `DocumentTarget` gains two variants and `DecisionRecord` gains `reason`, threaded through
  `createDecision`, `normalizeDecision`, `resolveDecision`, `applyApprovedBody`,
  `documentTargetLabel`, and the inbox renderer.

**Changed signatures** (this is an API change, not a pure addition):

```ts
// domain-databases.ts — push limit/offset/ORDER BY into SQL
export async function listRows(
  root: string,
  slug: string,
  dbId: string,
  opts?: { limit?: number; offset?: number },
): Promise<Result<DatabaseRow[]>>;
// SQL: SELECT id, database_id, created_at, updated_at, cells FROM rows
//      WHERE database_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?

// domain-databases.ts — registry lock + read-modify-write critical section
export async function createDatabase(root, slug, input: { name: string }): Promise<Result<DatabaseMeta>>;
export async function addDatabaseColumn(root, slug, dbId, input): Promise<Result<DatabaseMeta>>;

```

**`listInstalledKits` already exists; this design only calls it.** Verified: `finance-kit.ts:499-506`
exports exactly the accessor this design needs —

```ts
export async function listInstalledKits(root: string, slug: string): Promise<Result<string[]>> {
  try {
    const registry = await readRegistry(vaultPaths(root).domainRegistry(slug));
    return { ok: true, value: registry.installedKits };
  } catch {
    return { ok: true, value: [] };
  }
}
```

— and it is already re-exported from `index.ts:153` and already wired to the renderer
(`vault-service.ts:661`, `kitList`). So there is **no new engine function** here: `executeDatabaseTool`
imports the existing export and calls it. No `domain-databases.ts` change is required for
`installedKits`, and none is listed in PR 1. Its home in a finance-specific module is an odd place
for a generic registry accessor, but that is a pre-existing wart and not this design's problem.

**`listDatabases` does not change shape.** An earlier draft of this section changed it to return
`{ installedKits, entries }`, which is a breaking change to a function with four live consumers, none
of which was in the PR plan:

| Call site | Consequence of the shape change |
|---|---|
| `adapters.ts:735-739` — `for (const entry of dbs.value)` | `TypeError: dbs.value is not iterable` on **every** `syncLinkedDatabases` call, i.e. every adapter sync |
| `vault-service.ts:480` — `Result<DatabaseListEntry[]>` | type error on the IPC handler |
| `DataPage.tsx:50`, `DatabasePage.tsx:65`, `PageCanvasPage.tsx:293` — `res.value as DatabaseListEntry[]` then `.map`/`.filter` | the Data rail renders **nothing** — a silent blank UI, not a crash |
| `vite-env.d.ts:278` / `preload.ts:33` — `dbList: (domainSlug) => Promise<Result<DatabaseListEntry[]>>` | the IPC contract type |

So the kit list is surfaced through the **existing** `listInstalledKits` (`finance-kit.ts:499`), a
small purely additive *call* rather than a shape change, and `listDatabases` keeps returning
`Result<DatabaseListEntry[]>`. The archived-domain fix is likewise
applied in the tool layer, not here (see §8). `listDatabases` is therefore **not** in PR 1's file list,
and none of the five consumers above are touched.

`opts` on `listRows` is optional and defaults to the current full-read behaviour, so all **24**
existing call sites across seven files are unaffected: `capture.ts` (8), `finance-plan.ts` (8),
`adapters.ts` (3), `finance-kit.ts` (2), and one each in `books-export.ts`, `ingest.ts`, and
`apps/desktop/electron/vault-service.ts`. `createDatabase`'s new optional `id` likewise defaults to `randomUUID()`.

### Tool Contracts (Result Shapes)

The codebase convention is followed, not replaced: tools return **bare values** on success (e.g.
`{ state }`, `{ goals }`) and `{ error: { code, message } }` on failure
(`map-tools.ts:92`). The `{ ok, value }` envelope exists only inside vault-core's `Result<T>` and is
unwrapped before the tool boundary. Decision-filing tools return `{ decisionId, status }`
(`map-tools.ts:224, 277, 293`; `document-tools.ts:173`).

```ts
// Success (reads) — kits are per-domain, so the field is always keyed by domain
{ kits: Array<{ domainSlug: string; kits: string[] }>; databases: Array<{ domainSlug: string; database: DatabaseMeta }> }
{ database: DatabaseMeta }
{ rows: DatabaseRow[]; total: number; limit: number; offset: number }
{ row: DatabaseRow }
{ decisions: Array<{ id: string; status: string; proposedTitle: string | null; createdAt: string }> }

// Success (writes — a Decision was filed, nothing was written)
{ decisionId: string; status: "pending" }

// Failure
{ error: { code: "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "FAILED", message: string } }
```

`Result<T>` failures carry a **bare string** (`{ ok: false, error: string }`), so
`executeDatabaseTool` maps them to codes with this table:

| Engine error matches | Code |
|---|---|
| `Database not found: `, `Domain not found or archived: `, `Row not found` | `NOT_FOUND` |
| `Unknown column id in cells: `, `Column ` … `expects`, `value not in options`, `relation target missing`, `invalid file path`, `Database name is required` | `VALIDATION` |
| any `Result` from `listSyncConflicts` on a match | `CONFLICT` |
| anything else (I/O, SQLite) | `FAILED` |

`total` in `list_rows` is a `COUNT(*)` for the database so the agent can tell "50 of 12,000 rows"
from "the last 50 rows"; without it, truncation is indistinguishable from a complete answer.

---

## Data Model Changes

No SQLite schema change. `DomainDatabaseRegistry` in `packages/vault-core/src/types.ts` already holds
`DatabaseMeta` with `id`, `name`, `sotMode`, `adapter`, and `columns`; rows live in
`domains/{slug}/data/domain.sqlite`; Decisions in `.lifequest/decisions/`.

`DocumentTarget` gains two variants:

```ts
// types.ts
| { type: "database-row"; domainSlug: string; databaseId: string; rowId: string | null }
| { type: "database"; domainSlug: string; databaseId: string }
```

`rowId` is `null` for a create. A `{ type: "database" }` target carries a `databaseId` the tool minted
at propose time (§3.3), not one read back from a created database.

`DecisionRecord` also gains one field, required by the staleness guard's rejection path:

```ts
// types.ts — DecisionRecord
reason: string | null;   // set when an approved apply fails; null otherwise
```

This is a third shape change beyond the two target variants, and it must be threaded through
`normalizeDecision`, which rebuilds a **fixed field set** (`:141-148`) — a field it does not list is
dropped on every subsequent read, not merely on write.

The change is additive to the union but **not** a one-line change — every dispatcher over
`DocumentTarget` must learn the variants, or a filed Decision is silently mangled:

| Site | Required change |
|---|---|
| `createDecision` validation chain (`decisions.ts:302–343`) | The chain is `if/else if` and its terminal `else` is `return { ok: false, error: "Invalid target type" }`. Without a branch, **every** gated `upsert_row`/`delete_row`/`create_database`/`add_column` fails at propose time. Add two branches: `database-row` requires non-empty `domainSlug` + `databaseId` (and `rowId` non-empty if not null); `database` requires non-empty `domainSlug` + `databaseId`. |
| `normalizeDecision` accepted-type chain (`decisions.ts:46–59`) | Add `isDatabaseRowExplicitTarget` **and** `isDatabaseExplicitTarget` to the disjunction. Without them the target falls through to the legacy `documentKind` path. |
| `normalizeDecision` reconstruction chain (`decisions.ts:60–99`) | Add a reconstruction branch for each new type. The terminal `else` is `target = { type: "library", id: String(t.id) }` — a `database-row` target persisted to disk has no `id`, so it would rehydrate as `{ type: "library", id: "undefined" }` and the Decisions inbox, `listDecisions`, and `resolveDecision` would all see a library target pointing at a nonexistent note. |
| `normalizeDecision` `domainSlugs` derivation | `normalizeDecision` defaults unknown targets to `[]`, and `resolveDecision`'s log line reads `domainSlugs[0]`. Both new variants must set `domainSlugs: [target.domainSlug]`. |
| `applyApprovedBody` (`decisions.ts:536–815`) | Add a `database-row` branch and a `database` branch. Its terminal `else` is the library path (`libraryGet(rootPath, decision.target.id)`), so an unpatched Decision lands there with `target.id === undefined` and stays `pending` forever. The branch must run the `expectedUpdatedAt` staleness check, the finance referential checks, then call `upsertRow` / `deleteRow` / `createDatabase` + `addDatabaseColumn`. |
| `applyApprovedBody` return type (`decisions.ts:536-815`) | Widen `Result<void>` to a new internal `ApplyOutcome = { ok: true; value?: undefined } \| { ok: false; error: string; terminal: boolean }` (`Result<T>` at `types.ts:573` has no room for the flag). The success arm carries `value?: undefined` specifically so the **13** existing `{ ok: true, value: undefined }` returns stay assignable — a bare `{ ok: true }` would fail the excess-property check at each. The **23** existing failure returns gain `terminal: false` — mechanical, no semantic change. Only the two new branches set `terminal: true`, and only for permanent failures (staleness, `validateCells`, referential, archived domain, unresolved conflict). Table in §3.3. |
| `resolveDecision` (`decisions.ts:849-859`) | A **terminal** apply failure must write `status: "rejected"`, `reason`, and `resolvedAt`, plus a `decision.resolved` log line, instead of returning early and leaving the record `pending`. A **transient** failure keeps today's early return, leaving the record `pending` and retryable. Full code in §3.3. Without this, the staleness guard is unreachable and every terminal apply failure strands the Decision. |
| `normalizeDecision` `reason` field | Add `reason` to the reconstructed field set alongside `rationale`/`resolvedAt` (`:141-148`). |
- `createDatabase` (`domain-databases.ts:120-178`) | Accept an optional `input.id`, defaulting to `randomUUID()`, so a Decision can name the database it proposes. Existing `{ name }` callers unaffected. **No name-uniqueness check is added** — by decision (Open Question 6), duplicate names remain legal for the agent and the operator alike. |
| `ingest.ts` `lookupExternalId` (`:197`) | Export the function so the tool layer reuses the ingest dedup predicate instead of re-implementing it (§5). |
| `documentTargetLabel` (`documents.ts:31–46`) | Add a case; today it falls through to `return fallbackTitle`, rendering the title as `"Proposed change to "` with an empty subject. |
| `DecisionsInbox.tsx:183` and `apps/desktop/src/vite-env.d.ts` | Both discriminate on `target.type`; add the variants. |

`applyApprovedBody` must import the domain-database functions dynamically, matching the existing
pattern in the `page` branch (`const { getPage, updatePage } = await import("./pages.ts")`).

## Decision Table Extension (accepted)

The approved table in `spec §8` has no row for agent row writes outside finance/mirrored databases.
This design adds:

> **Agent row writes (all databases).** `upsert_row`, `delete_row`, `create_database`, and
> `add_column` invoked by the agent always create a Decision. No direct agent write path exists for
> any database, in any domain, under any `sotMode`.

This is a superset of the existing requirements (it gates strictly more than §8 mandates) and it is
what removes the unaudited-write hazard.

**Accepted.** Product sign-off received: `spec §8` accepts the added row. The extension is now part
of the decision table, not a proposal awaiting approval, and **PR 3 is no longer blocked** — it merges
on its own exit criteria. The status is recorded in the document header and in Open Question 4.

---

## Alternatives Considered

**A. One tool per finance database.** Rejected. Each kit install or hand-made database requires a new
tool definition and registration, drifting toward a closed enum of finance ids the agent must
memorize. Directly violates the requirement that future kits need no new MCP code.

**B. Dynamic per-database tool registration at startup.** Rejected. The server would enumerate every
database and register N tools: discovery and permission complexity, an inflated tool list on every
vault open, and conflict with the planner's composed array. It also conflicts with the requirement
that the agent learns columns by *reading* the database.

**C. SQL passthrough / query language.** Rejected for writes: arbitrary SQL from an agent bypasses
cell validation, adapter conflict checks, and the decision table. For **reads** the objection is
weaker than the round-1 draft claimed, because `run_script_block` already accepts a constrained
read-only `SELECT` and is tested. Typed read tools are preferred on ergonomics — column-id
discovery without SQL, deterministic ordering, real pagination, no `cells`-JSON hand-parsing — not
because read access is missing.

**D. Generic tools (chosen).** Five reads plus four Decision-gated write tools, one composed
`MapToolDef` array, one `executeTool` branch.

**E. Reuse and extend `run_script_block` for all reads; add only write tools.** Genuinely viable and
rejected, but it is the strongest alternative: it is zero new read code, and the read capability is
already constrained and tested. It is rejected because (i) the model must know the `rows` table
layout and hand-write SQL to answer "what columns exist?", (ii) there is no deterministic ordering or
real pagination, so paging through a ledger is guesswork, and (iii) `cells` comes back as a raw JSON
string with no `validateCells` pass. If the read tools turn out to be under-used, D's read half is
the part to cut; the write half is unaffected either way.

**F. Keep the ungated direct-write path for non-finance databases.** Rejected — see §3.1. It is
unlogged, unreviewed, and for `linked-canonical` databases it bypasses write-through in a way the
next sync silently undoes.

---

## Security & Privacy Considerations

- **Renderer isolation.** The renderer never holds API keys. The MCP server and vault service run in
  Electron main. Domain databases are on disk only (`node:sqlite`).
- **Threat model: unauthenticated loopback.** The MCP endpoint is plain HTTP on `127.0.0.1:8643` with
  no token, origin check, or auth of any kind (`mcp-server.ts:19–20, 116–149`). This design
  **increases the read surface of that endpoint** from "one domain, one read-only `SELECT`, 200 rows"
  to "every database in every live domain, up to 500 rows per page, including all finance history".
  On a shared or multi-user machine, any local process that can reach loopback can now read the
  user's complete financial record. This is a real, accepted-by-inheritance risk, not a solved one.
  Mitigations: (i) the endpoint is bound to `127.0.0.1` only, never `0.0.0.0`; (ii) reads are
  bounded to 500 rows/page and 100 decisions/page; (iii) the mitigation this design actually adds is
  that **writes** are impossible without the operator's click, so a hostile local reader can exfiltrate
  but cannot mutate. A follow-up should add a bearer token or an origin check to the MCP endpoint;
  that is deliberately out of scope here, and the risk is recorded in the Risks table.
- **Actor integrity.** The agent cannot set its own actor (§6). A local caller can, in principle,
  reach the engine through the operator IPC — that is pre-existing and is why the Decision record is
  the audit artefact, not the actor string.
- **Decision gating.** No agent write is ever silent. Posted rows, transfers, categories, accounts,
  budgets, holdings, assumption-sets, and every other database are covered.
- **Input validation.** `validateCells` type-checks values but does **not** verify that relation
  targets are existing rows, does not check required fields, and enforces no cross-field rules. The
  extra finance rules in §5 close the specific gaps the spec names; they are not a general constraint
  system.
- **No eval/SQL.** The write tools accept typed cell maps, not expressions. `run_script_block` remains
  read-only and unchanged.
- **Stale-apply protection.** `expectedUpdatedAt` prevents a long-pending Decision from overwriting
  intervening edits on approve.

---

## Observability

There is **no metrics or alerting infrastructure in this repo** — `grep -rn "prometheus\|metrics\|counter("`
over `apps/desktop/electron` and `packages/vault-core/src` returns nothing. The round-1 draft's
`db_tool_calls_total` and "alert if rejection rate exceeds 20% over 1 hour" had no home and are
withdrawn.

- **Life log.** Decision filing already appends a line with `type: "decision.created"` and the actor
  (`decisions.ts:521`); resolution appends `type: "decision.resolved"` (`:863`). This design adds no
  new log type. The operator's audit trail is the life log plus the Decision file; the design does not
  need a parallel mechanism.
- **Domain writes are attributed.** Every agent write goes through a Decision, so every write to a
  row is attributable to a `DecisionRecord` with an actor and a timestamp. The unaudited-write gap
  that existed in the round-1 direct path is closed by §3.1, not by a new log line.
- **Reads are unlogged.** Reads are idempotent, leave no trace, and are already reachable via
  `run_script_block`; logging them would add noise without adding audit value.
- **Deferred to a named follow-up (with a real sink).** Only once a metrics sink exists: counters for
  tool calls by name and Decision outcomes. The round-1 "rejection rate" alert is also dropped on
  its merits — rejection rate is a function of operator taste, not a signal of schema guessing. The
  follow-up ticket is listed in the PR plan.

---

## Rollout Plan

**No feature flag.** The motivating problem is that Hermes cannot see accounts, categories, or any
other database row; a flag defaulting off leaves the user in exactly that state after merge, and
there is no feature-flag mechanism in this repo to hang it on (`grep -rn "featureFlag\|enable[A-Z]"`
over `apps/desktop/electron` and `packages/vault-core/src` returns nothing). The Decision gate is the
safety mechanism, and it is unconditional. The tools ship **on by default**.

- **Staged rollout** tracks the PR series, not a runtime switch: PR 1 (Decision plumbing) and PR 2
  (read tools) are inert on their own — no tool is registered until PR 2 completes, and reads cannot
  mutate anything. PR 3 adds writes, gated per-decision by the operator. PR 4 is follow-up work.
- **Rollback.** Revert the PR that introduced the surface. Reads leave no data behind. Writes that
  were approved by the operator are legitimate mutations and are not reverted; what is reverted is the
  *proposal path*. Because every write is a Decision in `.lifequest/decisions/`, the full history of
  what the agent proposed and what the operator decided is on disk and auditable. The only
  irreversible-by-revert residue is an approved row write, which is by definition an operator-approved
  change.

---

## Risks

| Risk | Severity | Mitigation | Detection |
|---|---|---|---|
| Stale Decision approved after intervening edits; `upsertRow` full-replace erases the intervening cells | **High** | `expectedUpdatedAt` guard rejects the apply; complete-cell-set contract in the tool description; before/after diff in the inbox | Decision resolves `rejected` with a "row changed" reason; visible in the inbox |
| The staleness guard is unreachable — `resolveDecision` returns before the status write, so a failed apply leaves the record `pending` | **High** | A **terminal** failure writes `status: "rejected"` + `reason` + `resolvedAt` + a `decision.resolved` line; a **transient** failure keeps today's retryable early return (§3.3); `DecisionRecord.reason` added | Test 4(b)/(d); a Decision stuck `pending` with no error is the visible symptom |
| A blanket rejected-on-apply change would make transient failures (locked file, full disk, I/O) permanent rejections across all eleven existing target types | **High** | The `terminal` flag: every existing branch returns `terminal: false`, so their behaviour is byte-for-byte unchanged. `resolveDecision` is target-agnostic and its only caller is `decisionResolve` (`vault-service.ts:723`), so this was a live risk, not a hypothetical | Test 4 asserts a transient I/O failure leaves a `page` (existing type) Decision `pending` and retryable |
| A rejected-on-apply Decision is visually indistinguishable from one the operator rejected | **Medium** | The inbox renders `reason` and labels the two rejections differently ("proposal no longer applies" vs "Rejected") — an explicit PR 1 renderer requirement | Operator confusion visible in the inbox; no automated signal |
| `createDatabase` mints its own id, so the `database` Decision target has no `databaseId` to carry | **High** | Tool mints the UUID at propose time and threads it through the body; `createDatabase` accepts an optional `id`; mirrors the `project` target's allocate-at-propose pattern | Test 2, 4(c) |
| `listDatabases` shape change breaks four live consumers — `syncLinkedDatabases` throws, Data rail goes blank | **High** | `listDatabases` signature is **unchanged**; the kit list comes from the existing `listInstalledKits` (`finance-kit.ts:499`) | Typecheck plus `adapters-shell.test.ts`; a blank Data rail is the visible symptom |
| A second `listInstalledKits` is added to `domain-databases.ts`, colliding with the existing export | **High** | PR 1 specifies no new kit accessor; the tool layer imports the existing export. Named here because the same wrong claim previously appeared in four other places | Typecheck — a duplicate export is a compile error |
| Dedup check silently misses a recent duplicate (a paged scan sees only the oldest 500 rows) | **Medium** | Reuses `ingest.ts`'s `lookupExternalId` (exported), keyed on `external_id` alone; SQL-side optimisation in PR 4 | Test 10 |
| `toZod` strips `cells` to `{}` and `upsertRow` writes an empty cell map over an existing row | **High** | `additionalProperties` case in `toZod`; `cells` non-empty validation; round-trip test at the MCP boundary | Test 1; `validateCells` passes vacuously on `{}` so this needs the test, not a runtime check |
| Ungated direct write to a `linked-canonical` database is silently overwritten by the next sync | **High** | Direct path removed entirely (§3.1) | No direct path exists to regress |
| Unauthenticated loopback MCP exposes all finance data to any local process | **Medium** | Bound to `127.0.0.1`; reads bounded to 500 rows/page; writes require an operator click; endpoint auth is a named follow-up | Out of scope for detection; recorded here |
| `normalizeDecision` re-parses a new target as `library`, so a filed Decision is unreadable | **Medium** | Both guards wired into *both* chains plus the `domainSlugs` branch; round-trip test | Test 3 |
| Decision `applyApprovedBody` missing → Decisions stay `pending` forever | **Medium** | Explicit `database-row` / `database` branches; test 4 asserts a row actually changes on approve | Test 4 |
| Operator-created database inside the `financial` domain takes an ungated path | **Medium** | Gate is unconditional; no id list in the tool layer | N/A — the path does not exist |
| Unbounded read: `listRows` loads every row and `JSON.parse`s every `cells` blob | **Medium** | `limit`/`offset`/`ORDER BY` pushed into SQL; 500-row cap; `total` count so truncation is visible | Memory growth on large databases; mitigated by SQL-side limiting |
| Agent cannot observe a Decision's outcome, so §3's "surface the rejection" is unenforceable | **Medium** | Read-only `list_decisions`; the `upsert_row` description states the contract | Agent re-proposes a rejected write → visible in the inbox as duplicate pending Decisions |
| Conflict check keyed on `externalId` never fires for chat-posted rows (`external_id: null`), so a mirrored write proceeds during a conflict | **Medium** | Match `rowId` first with an `externalId` fallback; creates are rejected outright while any conflict exists on the database (§4) | Test 7 |
| Concurrent `registry.json` read-modify-write loses a database | **Low** | Per-path async mutex + re-read-and-merge inside the critical section | Missing database in `list_databases` |
| Half-built database from a partially approved column sequence | **Low** | Each column is an independent, named Decision; surfaced to the agent in the tool response | Operator sees a database with fewer columns than proposed |
| `file`-typed columns are unwritable (`saveDatabaseFile` is not surfaced) | **Low** | Stated as a known gap; no tool claims to write them | `VALIDATION` error on a `file` cell with an out-of-prefix path |
| Decision inbox renders a raw JSON `<pre>` blob, so the safety mechanism is not reviewable | **Medium** | `proposedTitle` set to a meaningful subject; `documentTargetLabel` case; a `database-row` renderer with cell-level before/after; renderer in PR 1 | Manual review in the studio |

### Known Gaps (explicitly out of scope)

- `file` columns: `validateCells` accepts paths under `domains/{slug}/data/files/`, but no tool calls
  `saveDatabaseFile`, so a `source_file` cell is unwritable. Noted rather than half-solved.
- Delete a database, remove a column, edit a column's options: operator-only.
- `list_rows` filtering by cell value: not supported; the description says so.
- `listDatabases` still lists archived domains' databases when an explicit slug is passed. Left
  unfixed on purpose: the fix changes the operator's Data rail, and that is a product call (PR 4).
- Duplicate database names within a domain are still allowed, for the agent and the operator alike.
  This is a decision, not a gap: Open Question 6 resolved **no**, and no uniqueness check is added.
  It is listed here only so the behaviour is not mistaken for an oversight.

---

## Open Questions

1. ~~Should agents be allowed to create ordinary non-finance databases at all?~~
   **Resolved**: yes, always a Decision. It is a schema change the operator should name and approve.
2. ~~Should `list_rows` support server-side filtering?~~ **Resolved**: no, in this PR. The description
   says "no filtering is applied" so the model cannot pass a filter and report results it did not
   receive. Filtering by typed cells needs a defined operator set (`eq`/`contains`/`between`) and a
   bound on result count; it is a follow-up.
3. ~~What is the max page size?~~ **Resolved**: 500. The round-1 rationale ("finance transaction
   history is bounded") was wrong — a ledger grows every time the user chats. The real bound is the
   500-row cap plus the SQL-side `LIMIT`; `total` tells the agent when it is looking at a slice.
4. ~~Does `spec §8` accept the added "all agent row writes are Decision-gated" row?~~
   **Resolved: yes — accepted.** Product sign-off received. All agent row writes, deletes,
   `create_database`, and `add_column` are Decision-gated, and `spec §8` takes the new row. The
   extension is folded into the decision table (§"Decision Table Extension (accepted)") and **PR 3 is
   unblocked** — it now merges on its own exit criteria.
5. ~~Should `list_rows` filtering, the MCP endpoint auth check, and the metrics sink land together?~~
   **Resolved: separate tickets.** They are unrelated concerns with different risk profiles — a
   security boundary, an ergonomics feature, and an observability sink — and bundling them would mean
   one ticket cannot ship without dragging the other two along. Each is now its own item in PR 4's
   follow-up list rather than one bundled bullet.
6. ~~Should `createDatabase` reject a duplicate database name within a domain?~~
   **Resolved: no.** Duplicate names remain legal, for the agent and the operator alike, exactly as
   they are today. No uniqueness check is added in the engine or in the tool layer, and no check is
   added agent-only either — the asymmetry that made the question hard is moot once the answer is no.
   The operator's behaviour is unchanged, which is the point: this design changes nothing about what
   the operator may create. Test 4(d) continues to assert the archived-domain rejection, a failure that
   genuinely exists and is genuinely specified.

---

## Test Plan

`npm test` in `packages/vault-core` and `apps/desktop`, plus `npm run typecheck`, per `spec §11`.
Existing suites that must stay green: `tests/domain-databases.test.ts`, `decisions.test.ts`,
`capture.test.ts`, `script-block.test.ts`, `apps/desktop/tests/agent-decisions-shell.test.ts`,
`adapters-shell.test.ts`, `script-block-shell.test.ts`.

New coverage, mapped to the defects above:

1. **MCP boundary round trip.** A two-cell `upsert_row` argument survives `buildShape`/`toZod` with
   both cells intact. (Guards Issue 4 — the silent `{}` strip.)
2. **`createDecision` target validation.** Four explicit cases: a `database-row` with
   `rowId: null` is **accepted** (it is a create); a `database-row` with `rowId: ""` is **rejected**; a
   `database-row` with an empty `domainSlug` or `databaseId` is **rejected**; a `database` target with
   a non-empty `databaseId` is **accepted**, and one with `databaseId: ""` is **rejected**.
   (Round-1 Issue 1; rev-2 Issue B — the id is minted at propose time so the branch tests a value the
   caller can supply.)
3. **`normalizeDecision` round trip.** Write a decision file for each new target, normalise, assert
   the target survives and `domainSlugs` is `[slug]`. (Issue 2.)
4. **`applyApprovedBody` applies, and a failed apply resolves rather than strands.** Four assertions:
   (a) approve a `database-row` upsert → the row's cells changed on disk, `status === "approved"`;
   (b) approve with a stale `expectedUpdatedAt` → `status === "rejected"`, `reason` names the staleness,
   and the row is **untouched**; (c) approve a `database` create → the database exists in the registry
   under the id minted at propose time; (d) approve a `database` create in a domain that has been
   **archived since the proposal was filed** → `status === "rejected"` with a `reason`, not `pending`
   (this is a real, specified failure: the apply branch re-checks `isDomainLive`, and `createDatabase`
   returns `Domain not found or archived: {slug}` — `domain-databases.ts:128-130`).
   (b) and (d) fail against the current `resolveDecision` control flow, which is the point: they guard
   rev-2 Issue A. (Round-1 Issue 3; rev-2 Issues A and B.)

   **There is deliberately no name-uniqueness assertion here, by decision.** An earlier draft of this
   case tested "reject when a database of the same name already exists". `createDatabase` has no such
   check today — it trims the name, checks `isDomainLive`, mints the id, and unconditionally pushes
   onto `registry.databases` (`domain-databases.ts:120-178`) — and the operator path can already
   create duplicates (`DataPage.tsx:97` → `dbCreate`, no uniqueness check on the way down). Product
   has resolved this **no** (Open Question 6): duplicate database names stay legal, for the agent and
   the operator alike, and no check is added in the engine or the tool layer. Case 4(d) therefore
   asserts the archived-domain rejection, which genuinely exists. A companion assertion worth having
   in the test suite — though it is *not* a rejection — is that two databases with the same name can
   both be approved and coexist, which is now specified behaviour rather than an accident.
5. **Gating matrix.** For a matrix of `{finance kit db, operator db in financial, local-only,
   local-canonical-mirror, linked-canonical, archived domain}` × `{upsert_row, delete_row,
   create_database, add_column}`: every case either files a Decision or returns a documented code;
   no case writes directly. Archived domain ⇒ `NOT_FOUND` on every tool. (Issues 8, 9, 16.)
6. **Actor integrity.** `upsert_row` with an `actor` key in args is ignored, and the resulting
   `DecisionRecord.actor` is `{ type: "agent", id: "companion", name: "Hermes" }` from the
   `executeTool` parameter. (Issue 7.)
7. **Conflict scoping and matching key.** Three assertions: (a) a conflict whose `rowId` equals the
   target row's id returns `CONFLICT` and files nothing — matched on `rowId`, the direct local
   identifier; (b) a conflict on an *unrelated* row of the same database does **not** block the write;
   (c) a create (`id` absent) while any conflict exists on the database returns `CONFLICT` with the
   conflicting rows listed. A conflict fixture with `rowId: null` and a `externalId` set must still be
   caught by the fallback when the proposed row carries that `external_id`. (Round-1 Issue 21;
   rev-2 Issue F.)
8. **Pagination.** `listRows` returns rows in `created_at, id` order; `limit`/`offset` page without
   gaps or duplicates; a `limit` of 10 on a 1000-row database touches 10 rows, asserted by counting
   rows via a bounded follow-up query. (Issue 10.)
9. **Replace semantics.** An `upsert_row` whose `cells` omit an existing column produces a row
   without that column (documented behaviour), and the Decision's `previousBodyMarkdown` contains the
   pre-propose cells. (Issue 11.)
10. **Referential validation and dedup.** A finance `upsert_row` naming a non-existent `account` row
    returns `VALIDATION` and files nothing. An `upsert_row` whose `external_id` already exists in the
    target database returns `VALIDATION` and files nothing — including when the existing row is
    *recent* (beyond the first 500), which is the failure mode of the paged-scan approach this
    replaced. An `upsert_row` with `external_id: null` (the `capture_transaction` shape) is not
    rejected by the dedup rule. (Round-1 Issue 17; rev-2 Issue D.)
11. **Tool list parity.** `ALL_TOOL_DEFS` contains `DATABASE_TOOL_DEFS`, and both spread sites
    (`mcp-server.ts`, `map-tools.ts`) iterate the same constant. (Issue 20.)
12. **Label and rendering.** `documentTargetLabel` returns a non-empty subject for both new targets;
    the inbox snapshot test renders a `database-row` target. The inbox renders `reason` for a
    rejected-on-apply Decision and labels it distinctly from an operator rejection.
    (Round-1 Issues 3, 19; rev-3 Issue D.)
13. **Existing target types are unaffected by the `resolveDecision` change.** Force a transient failure
    during the apply of a `page` Decision (an existing type) — an unwritable target path or a
    stubbed `atomicWriteFile` error — and assert the record stays `status: "pending"` and can be
    approved again. This fails if the `terminal` flag is defaulted to `true` anywhere in the existing
    branches, and it is the regression guard for the eleven types this design must not change.
    (rev-3 Issue D.)
14. **`list_databases` kit field.** With a `domainSlug`, `kits` has exactly one entry for that domain.
    Without one, it has one entry per **live domain** — enumerated from `paths.domainsDir`, not from
    `listDatabases`, so a live domain with an empty `databases` list still appears. Both forms match
    `listInstalledKits`. A domain with no `registry.json` yields `kits: []`. Assert specifically that a
    live-but-empty domain is present, since deriving the set from `listDatabases` would drop it.
    (rev-3 Issue B; rev-4 Issue 6.)

---

## PR Plan

Four PRs. The round-1 plan was one oversized PR whose file list could not produce a working feature:
it omitted `applyApprovedBody`, `documentTargetLabel`, and the renderer entirely, so approving a
database Decision would have failed. Every file the apply path needs is listed below.

### PR 1 — Decision plumbing for database targets (pure plumbing, no new tools)

Nothing in this PR is agent-reachable, so it is inert on merge.

**Files**
- `packages/vault-core/src/types.ts` — two `DocumentTarget` variants
- `packages/vault-core/src/types.ts` — two `DocumentTarget` variants **and** `DecisionRecord.reason`
- `packages/vault-core/src/decisions.ts` — `createDecision` validation branches; `normalizeDecision`
  accepted-type chain, reconstruction branches, `domainSlugs`, and `reason`; `applyApprovedBody`
  `database-row` and `database` branches **plus its widened `ApplyOutcome` return** (existing branches
  `terminal: false`); **`resolveDecision` terminal-failure → `rejected` + `reason`, transient keeps
  the early return**
- `packages/vault-core/src/domain-databases.ts` — `listRows` `opts: { limit, offset }` + SQL
  `ORDER BY created_at, id`; **optional `input.id` on `createDatabase`**; registry mutex +
  re-read-and-merge in `createDatabase` / `addDatabaseColumn`
  (**no `listInstalledKits`** — it already exists at `finance-kit.ts:499` and is already exported from
  `index.ts:153`; defining a second one in `domain-databases.ts` would be a duplicate-export
  collision and fail typecheck)
- `packages/vault-core/src/ingest.ts` — **export `lookupExternalId`** so the dedup predicate is reusable
- `packages/vault-core/src/index.ts` — export the above
- `packages/vault-core/src/documents.ts` — `documentTargetLabel` cases
- `apps/desktop/src/components/decisions/DecisionsInbox.tsx` — `database-row` / `database` rendering,
  **the `reason` line, and a distinct label for a rejected-on-apply Decision** so it is not
  indistinguishable from one the operator rejected
- `apps/desktop/src/vite-env.d.ts` — target-type union
- `packages/vault-core/tests/decisions.test.ts` — cases 2, 3, 4, **and the transient-failure case for
  an existing target type** (`page`) proving its behaviour is unchanged
- `packages/vault-core/tests/domain-databases.test.ts` — case 8 (pagination)
- `apps/desktop/tests/agent-decisions-shell.test.ts` — the rejected-on-apply path renders `reason`

**Deliberately NOT in this PR**, and the reason: `listDatabases` keeps its signature and its
archived-domain behaviour (rev-2 Issues C and G). `adapters.ts`, `vault-service.ts`, `preload.ts`, and
the three renderer pages that consume `dbList` are therefore untouched, and `list_databases` reads the
kit list through the **existing** `listInstalledKits` (`finance-kit.ts:499`) plus its own
`isDomainLive` filter and its own `paths.domainsDir` enumeration. Fixing the
archived-domain leak in the engine would change what the operator's Data rail lists, and that is a
product decision, not a side effect of an agent-facing fix.

**Exit criteria:** tests 2, 3, 4, 8, **12, and 13** green; `npm run typecheck` clean. Tests 12 and
13 are not optional extras: 13 is the regression guard on the eleven existing target types — the
widest blast radius in the whole design — and 12 is the only automated check that the two rejection
kinds are distinguishable in the UI, which this PR is required to deliver. A PR that widens a shared
code path without them is not reviewable.

### PR 2 — Read tools on MCP

**Files**
- `packages/vault-core/src/database-tools.ts` (new) — `DATABASE_TOOL_DEFS` (read half only) and
  `executeDatabaseTool` with the full §2.1 validation table
- `packages/vault-core/src/index.ts` — export `DATABASE_TOOL_DEFS`, `executeDatabaseTool`, `ALL_TOOL_DEFS`
- `apps/desktop/electron/mcp-server.ts` — `toZod` **cast widened to include `additionalProperties`**
  (`:29-34`) plus the `z.record` branch; spread `ALL_TOOL_DEFS`
- `apps/desktop/electron/map-tools.ts` — `executeTool` branch; planner list spreads `ALL_TOOL_DEFS`
- `packages/vault-core/tests/database-tools.test.ts` (new) — cases 1, 5 (read rows), 11
- `apps/desktop/tests/database-mcp-shell.test.ts` (new) — case 1 at the MCP boundary

**Exit criteria:** tests 1, 11, **and 14** green; `run_script_block` untouched and still green. Test
14 is this PR's `list_databases` contract check, including the live-but-empty domain case.

### PR 3 — Write tools, Decision-gated

**Files**
- `packages/vault-core/src/database-tools.ts` — add `list_decisions`, `upsert_row`, `delete_row`,
  `create_database`, `add_column`; the `createDecision` call sites; the §3.3 body/title/staleness
  payload **with the propose-time `randomUUID()` for `create_database`**; the §4 `rowId`-keyed conflict
  check with the create-rejection rule; the §5 finance referential validations and the
  `lookupExternalId` dedup call
- `packages/vault-core/tests/database-tools.test.ts` — cases 5 (write rows), 6, 7, 9, 10
- `apps/desktop/tests/agent-decisions-shell.test.ts` — end-to-end: propose → approve → row changes

**Blocked on:** nothing. Product sign-off for the Decision Table Extension was received and `spec §8`
accepts the added row (Open Question 4), so this PR merges on its exit criteria alone. The gating it
implements is now part of the approved decision table rather than an extension of it.

**Exit criteria:** tests 4, 5, 6, 7, 9, 10 green, plus 2, 3, 12, 13 re-run from PR 1; `npm test` in
both packages; `npm run typecheck`.

### PR 4 — Follow-up tickets (not blocking)

Open Questions 5 and 6 are resolved, so this is a list of **independent tickets, not a bundle**. Each
tracks and ships on its own; none gates another, and none blocks the PRs above.

| Ticket | Scope | Why separate |
|---|---|---|
| **Observability sink** | Metrics infrastructure plus counters (`db_tool_calls_total`, Decision outcomes by outcome). The round-1 rejection-rate alert is **not** revived; it is not a signal. | Needs a metrics backend chosen first; nothing in this design depends on it. |
| **MCP endpoint auth** | Bearer token or origin check on the `127.0.0.1:8643` endpoint. | A security boundary. It should ship on its own urgency, not wait on, or be delayed by, an observability or ergonomics change. It is the highest-severity item on this list. |
| **`list_rows` cell filtering** | A defined operator set (`eq`/`contains`/`between`) with a bound on result count. | An ergonomics feature with no correctness or security dimension. |
| **`lookupExternalId` targeted SQL** | `WHERE cells->>'external_id' = ?` so the dedup check stops full-reading the target database, as it does today on every ingest. | A performance fix with a correctness-neutral outcome; its own benchmark story. |
| **`listDatabases` archived filtering** | Whether the engine itself should stop listing archived domains' databases. Left unfixed in the engine on purpose (rev-2 Issue G) because it changes the operator's Data rail — a product question, not a bug fix. | Changes operator-visible behaviour, so it needs its own discussion. |
| **Expose `saveDatabaseFile`** | Only if `file` columns are ever needed by an agent. Currently a Known Gap. | Contingent on a real need; nothing today depends on it. |

**Closed, not deferred:** the duplicate-database-name question is resolved **no** (Open Question 6).
Duplicate names stay legal for the agent and the operator alike, so there is no ticket and no engine
change.

---

## References

- `apps/desktop/electron/mcp-server.ts` — `toZod` / `buildShape` (:28–82), `registerTools` (:85), loopback listener (:19–20, 116–149)
- `apps/desktop/electron/map-tools.ts` — `AGENT_ACTOR` (:33), planner tool list (:48), `executeTool` (:85–99)
- `packages/vault-core/src/domain-databases.ts` — `isDomainLive` (:79), `createDatabase` (:120), `listDatabases` (:180), `addDatabaseColumn` (:236), `validateCells` (:297), `listRows` (:374), `getRow`, `upsertRow` (:457, replace at :487), `deleteRow` (:511)
- `packages/vault-core/src/adapters.ts` — `listSyncConflicts` (:768), `resolveSyncConflict` (:784), conflict granularity (:527–570)
- `packages/vault-core/src/decisions.ts` — `normalizeDecision` (:40–100), `listDecisions` (:250), `createDecision` validation chain (:302–343), log types (:521, :863), `applyApprovedBody` (:536–815)
- `packages/vault-core/src/documents.ts` — `documentTargetLabel` (:31–46)
- `packages/vault-core/src/types.ts` — `Actor`, `DecisionRecord` (:282–290), `DomainDatabaseRegistry.installedKits` (:402), `FINANCE_DOMAIN_SLUG` / `FINANCE_DB_IDS` (:433–443), `DocumentTarget`
- `packages/vault-core/src/finance-kit.ts` — kit install, `sotMode: "local-canonical-mirror"` (:163), `installedKits` (:403)
- `packages/vault-core/src/ingest.ts` — `lookupExternalId` (:197-221), the dedup predicate this design reuses
- `packages/vault-core/src/adapters.ts:725-760` — `syncLinkedDatabases`, a `listDatabases` consumer whose signature this design does not change
- `apps/desktop/electron/vault-service.ts:480` / `preload.ts:33` / `vite-env.d.ts:278` — the `dbList` IPC chain, likewise unchanged
- `packages/vault-core/src/script-block.ts` — `run_script_block`, `MAX_ROWS = 200`, read-only guard (:19–70)
- `packages/vault-core/src/capture-tools.ts` — `capture_transaction`, `undo_capture`, `correct_capture`
- `apps/desktop/src/components/decisions/DecisionsInbox.tsx` — target discrimination (:183)
- `docs/superpowers/specs/2026-09-23-domain-databases-finance-kit-prs.md` — approved decision table §8, linked-canonical §6, dedup §5, test bar §11
- `LAWS/DATABASES.md` — invariants for database writes

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Generic tools keyed by `domainSlug` + `databaseId` | Avoids per-database or per-kit registration. One set covers finance today and any future kit. |
| Reads are direct, no Decisions | Reads are idempotent and leave no trace. Gating them would block the agent from discovering the schemas it needs to resolve `capture_transaction`. |
| **All** agent row writes route through Decisions, unconditionally | Closes the unaudited-write gap for every `sotMode`, including `linked-canonical` (where a direct write is silently overwritten by the next sync) and operator-created databases inside `financial`. Strictly more conservative than the previous §8 table, and **accepted by product** — `spec §8` now carries the row, so this is the approved table rather than an extension of it. |
| Duplicate database names stay legal, for agent and operator alike | Resolved **no** (Open Question 6). `createDatabase` has never checked uniqueness, the operator path shares the gap, and a check enforced for only one of two writers would be worse than none. This design changes nothing about what the operator may create. |
| No `actor` parameter on any tool; the actor comes from `executeTool` | A model-controlled parameter is not an identity source. Matches `executeCaptureTool` / `executeDocumentTool`. |
| No feature flag; tools on by default | The motivating problem survives a default-off merge, the repo has no flag mechanism, and the Decision gate — not a switch — is the safety mechanism. |
| `cells` is a free-form object via `additionalProperties: true` in `toZod` | The local `toZod` compiles a property-less object to `z.object({})`, which strips every cell. A JSON-string cells parameter would be a worse agent ergonomics for no gain. |
| `upsert_row` is a full-cell replace, with `expectedUpdatedAt` staleness guard | `upsertRow` is `INSERT OR REPLACE`. The guard is the only thing preventing a week-old approved Decision from erasing a week of edits. |
| `listRows` gains SQL-side `limit`/`offset`/`ORDER BY` | The existing signature loads and `JSON.parse`s every row; a tool-level slice of an unordered result set skips and duplicates rows. |
| `list_decisions` is read-only, never `resolve_decision` | The agent needs to see rejections to obey "do not retry a rejected write"; giving it resolution would hand it the approve button. |
| A **terminal** apply failure resolves the Decision `rejected` with a `reason`; a transient one stays `pending` and retryable | An unconditional rejected-on-apply change would strand a stale-proposal guard behind unreachable code, while applying it to all eleven existing target types would turn a locked file or full disk into a permanent rejection. The `terminal` flag on a widened `ApplyOutcome` gives both: new targets get honest terminal outcomes, existing types keep today's exact behaviour. After the change a failed apply is retryable **iff** the failure is transient. |
| `create_database` mints its `databaseId` at propose time | `createDatabase` generates the id internally, so the only way to know it earlier is to create the database before filing — an ungated write. Mirrors how the `project` target allocates its id at propose time (`decisions.ts:701-712`). |
| `listDatabases` keeps its signature; the kit list comes from the **existing** `listInstalledKits` (`finance-kit.ts:499`) | Four live consumers, including `syncLinkedDatabases` (`adapters.ts:735-739`) and three renderer pages that would render a blank Data rail. A shape change for an agent-facing need is not a trade worth making — and the accessor this design needs already exists, so the additive route costs one import. |
| The archived-domain filter lives in the tool layer, not in `listDatabases` | Fixing it in the engine would remove an archived domain's databases from the **operator's** Data rail as a side effect of an agent-facing change. Blast radius, not effort. |
| Dedup reuses `ingest.ts`'s `lookupExternalId`, keyed on `external_id` alone | The paged-scan alternative sees only the oldest 500 rows, so it misses exactly the recent duplicates that matter. Reuse also keeps the agent's dedup identical to the ingest path it mirrors. |
| Conflict detection matches `rowId` first, `externalId` as fallback | `capture_transaction` rows carry `external_id: null`, so an `externalId`-only match never fires for the design's primary case. Creates are unmatchable by construction and are rejected while any conflict exists. |
| Follow-up work ships as separate tickets, not one bundle (Open Question 5) | Metrics, MCP endpoint auth, and `list_rows` filtering are unrelated concerns with different risk profiles — a security boundary, an observability sink, and an ergonomics feature. Bundling them means none can ship without the others, and the auth work in particular should move on its own urgency. |
| Conflict *detection* via `listSyncConflicts`, resolution stays operator-only | `resolveSyncConflict` is a write and would be an ungated mutation path. Detection is row-scoped because conflicts are per `externalId`. |
| `list_databases` returns per-domain `kits` (`{ domainSlug, kits }[]`), never a flat list | `installedKits` lives on each domain's own registry, so a flat array is ambiguous for the union call — the very case the field exists to answer ("is the finance kit installed in *this* domain"). Lets the agent distinguish "kit absent" from "no databases". |
| `ALL_TOOL_DEFS` composed in vault-core, spread at two sites | There are exactly two spread sites; a composed constant removes the membership-drift failure mode. |
| `create_database` and `add_column` are separate Decision-gated calls | `createDatabase` takes only a name and returns `columns: []`; a `columns` argument would be a fiction. Partial application is surfaced, not rolled back. |
| Tool list is one array constant, two spread sites | Prevents the two literal lists from drifting apart in membership. |
