# Design: Direct database creates and inserts; decisions only for changes and deletes

**Date**: 2026-10-28
**Status**: Approved by the operator in-session (2026-10-28).
**Amends**: [auto-approved inserts](./2026-09-29-auto-approve-inserts-design.md) (superseded),
[MCP agent pairing](./2026-10-03-mcp-agent-pairing-design.md) §Domain writes,
[projects / Execute wing](./2026-10-27-projects-execute-wing-design.md) §`create_database`,
[domain databases / Finance kit](./2026-09-23-domain-databases-finance-kit-prs.md) table row 6.

## Problem

The operator ran **Analyze note** on their Daily Note. The companion proposed three
databases the vault had no home for (*Injuries & recovery* and *Training log* in
`health`, *Devices & equipment* in `business-m3`). The operator agreed in the chat,
the companion answered that it had lodged them as decisions — and the Decisions tab
showed nothing, with no badge on the rail either.

The three Decisions **were** filed (three `create_database` Decisions on disk, status
`pending`). The tab looked empty for two independent reasons:

1. **A product-policy mismatch.** The operator does not want a Decision for adding
   data at all: a chat confirmation is the yes, and the agent should then write the
   new database or the new rows. Filing them was already the wrong behaviour, so
   "where are my decisions?" was the symptom of a gate the operator never wanted.
2. **A visibility defect.** The Decisions inbox and the rail badge filtered by the
   active domain lens. The proposals were filed under `health` and `business-m3`
   while the operator's lens sat on another domain, so even the gate they did not
   want was invisible. (Fixed separately: the Decisions surface is global.)

## Decision

**Split database writes by what they touch, not by tool or database.**

| Operation | Tool shape | Behaviour |
|---|---|---|
| New database (with its columns) | `create_database` | **Writes immediately.** No Decision. |
| New row | `upsert_row` with no `id` | **Writes immediately.** No Decision. |
| Batch of new rows | `insert_rows` | **Writes immediately.** No Decision, one transaction. |
| Update an existing row | `upsert_row` with an `id` | Pending Decision; writes only on approve. |
| Delete a row | `delete_row` | Pending Decision; writes only on approve. |
| Add a column to an existing database | `add_column` | Pending Decision; writes only on approve. |

Adding data is not a change to data the vault already holds, so it does not wait in
the approval queue: the chat confirmation is the operator's yes and the write is
expected to happen. Changing or removing data that already exists is the significant
modification the operator wants to see, so it keeps the full Decision gate and must
pop up in Decisions.

The confirmation is a **prompt-level obligation**, not a second gate: the tool writes
when called, and the companion's instructions and every tool description say to call
the direct-write tools only after the operator has agreed in the chat to that exact
database or those rows. The tools' replies (`applied: true`, `posted: true`) are what
the model may cite; it must not claim a database or row exists otherwise.

## What stays gated (not touched by this change)

- `upsert_row` **with an id**, `delete_row`, `add_column` — change/remove existing data.
- Doctrine, library notes, goals, projects, pages, pins, dashboard views, reviews.
- Ingest mappings and ingest batch rows (LAWS/DATABASES.md: a mapping change goes
  through Decisions and batch rows wait for the operator's acceptance). A file import
  is not a chat-confirmed row.
- Kit install and restore.

## Implementation

### `packages/vault-core/src/database-tools.ts`

- `create_database` validates the name and every column spec **before** writing (the
  same validation the old propose path used), then calls `createDatabase` and
  `addDatabaseColumn` for each column. It returns
  `{ applied: true, databaseId, name, columns }`. A column that fails after the
  database exists returns a `FAILED` error naming the database and the column, because
  silently pretending nothing happened would be worse; the rest can be added with
  `add_column` (which still files a Decision).
- `upsert_row` without an `id` writes through `upsertRow`, logs
  `database.row.created`, and returns `{ posted: true, applied: true, rowId, rowCount: 1 }`.
  With an `id` it is unchanged: conflict/staleness capture, then one pending Decision.
- `insert_rows` validates every row, then writes the batch in one
  `insertRows` transaction, logs `database.rows.created`, and returns
  `{ posted: true, applied: true, rowCount, rowIds }`.
- The allowlist machinery (`allowInsert`, `finishWrite`, `postedAllowlistResult`,
  `fileBatchDecision`) is removed. `autoApproveInserts` in `settings.json` is kept as
  a **legacy field**: parsing still tolerates it so existing vaults open, but nothing
  reads it for a decision. It is no longer offered in Settings → Hermes.
- The applied writes are logged because no Decision card will ever show them; the
  Life log (Recent Activity) is where the operator sees what the companion added.

### `packages/vault-core/src/pairing-grant.ts`

Connected (paired) agents follow the same write rules inside their assigned domains:
`create_database` and `insert_rows` move to the immediate set; `upsert_row` stays
classified as a Decision write because its update form is gated (the per-call domain
check runs for both forms either way).

### `apps/desktop/electron/companion-client.ts` and the tool descriptions

The companion is told the split in one paragraph, told to call a direct write only
after the chat agreement, and told never to claim a write that the result did not
confirm. The default Analyze-note prompt keeps "do not write anything until I
confirm", with the addition that creating now writes immediately.

### Artifacts

- `apps/desktop/tests/database-write-policy-e2e.test.ts` — every row of the table
  above, through the real tool against a temp vault; the "wrote" facts are read back
  with the engine, the "gated" facts are read back before and after `resolveDecision`.
  Artifact: `apps/desktop/e2e/artifacts/database-write-policy.json`.
- `apps/desktop/tests/projects-tools-e2e.test.ts` case 6 — `create_database` over the
  real pairing door now asserts the database exists immediately with its columns and
  files no Decision.
- The Decisions rigs cover the global visibility fix.

## Consequences

- A huge import no longer produces one pending card per row; it does not produce a
  card at all, and the Life log is the record.
- An external paired agent with Write on and a domain assigned can now create a
  database and add rows inside its assignment without approval. Its grant and its
  domain assignment are still the boundary; updates and deletes still gate.
- Existing pending `create-database` / `database-batch` Decisions in old vaults remain
  readable and approvable; the approve path is unchanged (`database-batch` label
  resolution is kept for History).
- Rejecting a new-database proposal is no longer possible, because there is no
  proposal. Undo is deleting the database / rows in the Data studio.
