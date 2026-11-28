# Architecture task pool

Workstream: reduce architectural entropy without changing product behavior,
except where a duplicate rule was already wrong. One closed loop per item:
baseline, migrate every caller, delete the old implementation, review, verify,
then an anti-regression check.

## Now

- None. The next candidates are in **Next**, and neither is a safe deletion yet.

## Next

1. **God files, only where a seam encapsulates complexity.** `electron/main.ts`,
   `electron/vault-service.ts`, `vault-core/src/types.ts`, and `ChatPanel.tsx`
   are large. Do not split them by moving lines. A split is worth it only when
   deleting the new module would push real complexity back onto callers.
2. **Instant parsing (`isIso`).** Five private copies. Three are identical;
   two also reject blank-after-trim. Extract only if one function can keep
   both policies without a flag that leaks the caller's rule. Otherwise leave
   them: a one-line helper fails the deletion test.

## Rejected

- **One `Result<T>`.** `types.ts` uses `error: string`. `map/types.ts` uses
  `error: DomainError`. Same word, different contract. Do not merge.
- **Shared `asError` / `message`.** One line. Deleting it spreads nothing
  worth encapsulating.
- **E2E harness `Result` copies.** Each harness stubs the bridge in isolation.
  A shared import would couple rigs to production modules they deliberately
  do not load. Leave them until a harness already shares a type module.
- **`DecisionBody` timestamp check.** It matches a date or an instant so the
  inbox can format either. That is not a calendar-date rule.

## Pending confirmation

- None for this workstream. Product decisions already in [`TASKS.md`](../../TASKS.md)
  stay there.
