# Design: Auto-approved inserts and one decision per batch

**Date**: 2026-09-29
**Status**: Approved 2026-09-29. Implementation plan: `docs/superpowers/plans/2026-09-29-auto-approve-inserts.md`.

## Problem

Every assistant write through `upsert_row`, `delete_row`, `create_database`, and `add_column` files one pending Decision. A mass load of new rows therefore fills the pending inbox and the sidebar badge with one card per row. The operator wants two controls:

- A vault allowlist of databases whose **new rows** the assistant may apply immediately.
- One Decision for a batch of inserts into a single database, so a mass load is one card. A matching allowlist entry applies that one Decision immediately.

Conversational expense capture stays the direct path it is today. Updates, deletes, new databases, new columns, doctrine, pages, kit install, and restore stay pending.

## Operator behavior

The allowlist starts empty. An empty or missing list is today's behavior: a new row files a pending Decision and nothing is written until the operator approves it.

Settings → Hermes, under **File implied changes**, lists every database in every live domain. Each row is a checkbox:

- Section label: **Apply assistant inserts immediately**
- Description: "New rows the assistant proposes in a checked database are applied immediately. Updates, deletes, and other databases still wait in Decisions."
- Each checkbox's accessible name is `Apply assistant inserts immediately: {domain name} / {database name}`.

Checking a box stores that domain slug and database id. Unchecking removes that pair. Unchecking does not delete rows already written.

A stored pair whose database or domain is no longer available stays at the bottom of the list, labeled with the stored domain slug and database id, checkbox checked. Unchecking removes it. The panel cannot add a pair for a database that does not exist.

The assistant has no tool that reads or writes this list. `settingsUpdate` remains the only writer, and it is operator IPC.

## Allowlist record

`VaultSettings` in `packages/vault-core/src/types.ts` gains:

```ts
autoApproveInserts: Array<{ domainSlug: string; databaseId: string }>;
```

The field lives in `.lifequest/settings.json`. A missing field reads as `[]`. A new vault may omit the key. `updateSettings` in `packages/vault-core/src/agents.ts` preserves the list on every other patch, including theme and Hermes URL. When the patch includes `autoApproveInserts`:

- Each entry has a non-empty `domainSlug` and a non-empty `databaseId`. Anything else is rejected and the file is left unchanged.
- Exact duplicate pairs collapse to one. Order is the order of first occurrence in the patch.
- The database does not have to exist. That is what lets a deleted database stay listed until the operator unchecks it.

Matching is an exact string match on both ids. A renamed database keeps its id, so the rule still matches. There is no new IPC channel. `settingsUpdate` already takes `Partial<VaultSettings>`.

## The batch tool

`insert_rows` is added to `DATABASE_TOOL_DEFS` in `packages/vault-core/src/database-tools.ts`. Membership in that array puts it on `ALL_TOOL_DEFS`, so the MCP door and the in-app planner both expose it, and `executeTool` already routes every name in that array to `executeDatabaseTool`.

Arguments:

- `domainSlug` (string)
- `databaseId` (string)
- `rows` (array of cell objects, the same shape as `upsert_row`'s `cells`)

The tool does not accept row ids. A cell key is a column id. The cap is 200 rows (`INSERT_ROWS_MAX`). A larger load is a second call and a second Decision.

The tool description tells the model all of the following, because an external MCP client never sees the in-app instructions:

- Use this once when adding many new rows to one database.
- Use `upsert_row` for a single new row or any edit.
- The result includes `posted`. Claim that rows landed only when `posted` is true.
- A `pending` result is one Decision waiting for the operator. Name the database and the count.
- A `rejected` result includes `reason`. Do not send those same rows again.

`upsert_row`'s description gains one sentence: a create in an allowlisted database can return `posted: true`; an update always stays `pending` until the operator approves it.

`buildInstructions` in `apps/desktop/electron/companion-client.ts` repeats that rule in one sentence after the existing `capture_transaction` sentence. `fileUnsolicited` is unchanged. `capture_transaction`, `undo_capture`, and `correct_capture` are unchanged.

## Filing a batch

`executeDatabaseTool` handles `insert_rows` as follows. Any failure below returns `{ error: { code, message } }`, files no Decision, and writes no row.

1. The domain is live. Otherwise `NOT_FOUND`.
2. `databaseId` is a non-empty string and `getDatabase` finds it. Otherwise `NOT_FOUND` or `VALIDATION`.
3. `rows` is an array of 1 to 200 objects. Zero rows, more than 200, or a non-array is `VALIDATION`.
4. Each element is a plain non-empty cell object. A row that is not a plain object, or an empty map, is `VALIDATION`. The message names the row: `Row {n}: {reason}` with `n` starting at 1. An empty map uses the same rejection text `upsert_row` uses.
5. Each row runs the same propose-time checks as `upsert_row`: `checkDatabaseCells`, the external-id lookup, and `checkConflicts`. The first failure stops the call. Its message is prefixed with `Row {n}:`.
6. A repeated non-empty `external_id` inside the batch fails on the later row with `VALIDATION`, even when that id is not yet in the database.

When every row passes, the vault mints a `randomUUID()` for each row and files one Decision. The actor is the actor `executeDatabaseTool` received. Arguments cannot set it.

## Decision record

`DocumentTarget` gains:

```ts
{ type: "database-batch"; domainSlug: string; databaseId: string }
```

`normalizeDecision` recognizes that type. Without the branch, a saved batch falls through to a doctrine or library target. `domainSlugs` for the target is `[domainSlug]`, so the existing domain lens shows the card. `createDecision` requires a non-empty domain slug and database id, requires the domain to be live, and requires the database to exist. The target is not a lockable document. `documentTargetLabel` returns the proposed title when one was passed.

The body is JSON in `proposedBodyMarkdown`. `previousBodyMarkdown` is null.

```ts
type DatabaseBatchDecisionBody = {
  op: "insert-rows";
  databaseName: string;
  rows: Array<{
    id: string;
    cells: Record<string, unknown>;
    rowLabel: string | null;
  }>;
};
```

`rowLabel` uses the same label rule as a single-row Decision (payee, name, title, account, category, date). `proposedTitle` is `Insert {N} rows into {databaseName}`. `createDecision` keeps its existing wrapper, so the stored `title` is `Proposed change to Insert {N} rows into {databaseName}`. The pending inbox already prefers `proposedTitle`, so the card heading is the short sentence. The resolved tab shows the stored title, as it does for every other Decision.

Filing writes one file under `.lifequest/decisions/` and one `decision.created` life-log line. The log actor is the assistant who called the tool.

## Allowlist match

After a Decision is filed, the vault reads `autoApproveInserts`.

- `insert_rows` matches when the list contains that `domainSlug` and `databaseId`.
- `upsert_row` matches only when it is a create (`id` omitted) and the list contains that pair.
- An `upsert_row` that names an id is an update and does not match.
- `delete_row`, `create_database`, and `add_column` do not match.

A match calls the existing `resolveDecision(root, id, "approved")`. There is no second apply path. The life-log actor on `decision.resolved` stays the Decision's actor, the assistant who proposed it, which is what a manual approval already records.

Tool results:

| Outcome | Result |
| --- | --- |
| Not listed | `{ decisionId, status: "pending", posted: false, rowCount }` |
| Approved and applied | `{ decisionId, status: "approved", posted: true, rowCount }` |
| Apply rejected the Decision | `{ decisionId, status: "rejected", posted: false, rowCount, reason }` |
| Apply failed and left it pending | `{ decisionId, status: "pending", posted: false, rowCount, reason }` |

`rowCount` is the number of rows in the Decision. For a one-row create or update it is `1`. `posted: true` only appears when the rows are in the database. A propose-time validation error is still `{ error: { code, message } }` and has no `decisionId`.

A vault whose settings omit `autoApproveInserts` keeps today's `upsert_row` behavior: `status` is `pending`, `posted` is false, and the row is unchanged until approval. Existing write tests assert that pending status and the unchanged row.

## Apply

`applyApprovedBody` handles `database-batch` by parsing `DatabaseBatchDecisionBody`. A body that is not that operation returns a non-terminal failure so the operator can still reject the card. An archived domain is terminal, matching the single-row path.

Apply re-runs `checkDatabaseCells` and cell validation for every row. It then inserts in one database transaction inside a new `insertRows` function in `packages/vault-core/src/domain-databases.ts`:

- One connection.
- `BEGIN`, then one `INSERT` per row using the id minted at propose time, then `COMMIT`.
- `INSERT`, not `INSERT OR REPLACE`. An id that already exists rolls the transaction back.
- Any failure rolls the transaction back. No earlier row from the batch remains.

`insertRows` does not call `upsertRow`. `upsertRow` opens its own connection and replaces, so a loop would leave a partial batch and could overwrite an existing row.

A rolled-back batch follows the existing terminal rule. A permanent cell, relation, finance, missing-row, or id-collision failure is terminal: `resolveDecision` marks the Decision `rejected` and stores the reason. A transient I/O failure leaves the Decision `pending` so the operator can approve again. The Decisions card already labels a rejected Decision that carries `reason` as **Could not apply**.

## Decisions screen

`kindLabel` returns **Database rows** for `database-batch`. `DecisionBody` renders the operation as a lead, `Insert {N} rows into {databaseName}.`, then one after-only change table per row, the same table a single new row uses. A row with no label is titled `Row {n}` with `n` starting at 1. A body the renderer does not understand falls through to the existing generic body.

Pending cards keep Approve and Reject. An auto-approved card is on the Resolved tab because its status is `approved`. The sidebar pending count does not include it.

## Settings screen

`SettingsHermes` loads databases with the existing `dbList` call and the live domains from the vault snapshot. Databases are grouped under their domain name. The checkbox writes the full `autoApproveInserts` array through `settingsUpdate`. A failed save shows the error and leaves the checkbox where the saved list says it is.

## Proof

One temporary-vault behavioral test, in the same style as `packages/vault-core/tests/database-tools-writes.test.ts`, drives four endings. The artifact is the decision file plus the database rows:

1. An allowlisted `insert_rows` leaves every row in the database, exactly one Decision with status `approved`, a tool result with `posted: true`, and one `decision.created` plus one `decision.resolved` log line.
2. The same call with the database off the list leaves no new rows and exactly one `pending` Decision. The tool result has `posted: false`.
3. A batch whose second row fails validation leaves no Decision and no new rows, and the error names `Row 2`.
4. A pending batch is approved after the test inserts one of its minted ids, or after the domain is archived. The database gains no row from the batch, and the Decision is `rejected` with `reason` set.

The same file also asserts that an allowlisted `upsert_row` create posts and an allowlisted `upsert_row` update stays pending with the row unchanged, and that a theme settings patch does not drop `autoApproveInserts`.

Desktop shell tests assert that `insert_rows` is on `ALL_TOOL_DEFS`, that Settings → Hermes contains the checkbox name, that the inbox kind label and `DecisionBody` handle `database-batch`, and that companion instructions mention `insert_rows`. No tool definition's name or description offers a way to edit `autoApproveInserts`.

## Out of scope

- Auto-approving updates, deletes, new databases, new columns, doctrine, library notes, goals, day templates, projects, pages, pins, mappings, kit install, assumption sets, or restore.
- Changing `capture_transaction`.
- A batch that spans databases, or a batch that updates existing rows.
- Collapsing several `upsert_row` calls from one chat turn into one Decision.
- A bulk-session mode.
- More than 200 rows in one call.
- An undo tool for an applied batch. The operator removes rows in Data.
- Edits to `LAWS`, `README`, `PRODUCT`, or `VISION`. A matched insert still files a Decision and runs `resolveDecision`. The allowlist chooses that the approval happens in the same step.

## Files

- `packages/vault-core/src/types.ts` — target, batch body, settings field.
- `packages/vault-core/src/decisions.ts` — normalize, create, apply.
- `packages/vault-core/src/documents.ts` — target label.
- `packages/vault-core/src/database-tools.ts` — `insert_rows`, allowlist match on create.
- `packages/vault-core/src/domain-databases.ts` — transactional `insertRows`.
- `packages/vault-core/src/agents.ts` — read and write the list without dropping it.
- `apps/desktop/electron/companion-client.ts` — one instruction sentence.
- `apps/desktop/src/components/settings/SettingsHermes.tsx` — the checkboxes.
- `apps/desktop/src/components/decisions/DecisionsInbox.tsx` — kind label.
- `apps/desktop/src/components/decisions/DecisionBody.tsx` — batch body.
- `packages/vault-core/tests/insert-rows.test.ts` — the four endings and the allowlist settings cases.
- `apps/desktop/tests/database-mcp-shell.test.ts` — `insert_rows` is on `ALL_TOOL_DEFS` and no tool edits the allowlist.
- `apps/desktop/tests/implied-filing-shell.test.ts` — the Hermes checkbox and the `insert_rows` instruction.
