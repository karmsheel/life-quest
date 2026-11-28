# Architecture progress

Internal record for the entropy-reduction workstream. Product history stays in
[`PROGRESS.md`](../../PROGRESS.md).

## State

| | |
|---|---|
| Branch | `room/goal-systematically-reduce-architectural-wcpv` |
| Round | 2 verified |
| Verified by | `node --experimental-strip-types --test apps/desktop/tests/ipc-channels.test.ts` |

## Rounds

### 1 — calendar date, one rule

Before: six copies of "is this a real `YYYY-MM-DD`". `goals.ts` used
`Date.parse`, which accepts `2026-02-31`. Projects, daily notes, the phone,
and the map already rejected that day.

After: `packages/vault-core/src/calendar-date.ts` owns the round-trip.
Published names (`isValidLocalIsoDate`, map `isIsoDate`, phone `isIsoDate`)
call it. Goal writes now refuse a day that does not exist. Stored files are
not rewritten; the read path never re-validated the deadline.

Check: `apps/desktop/tests/calendar-date.test.ts` fails if a second
implementation appears.

### 2 — IPC channels, one list each direction

The 223 invoke channels already matched their handlers, and the 10
main-to-renderer events already matched their preload listeners. Nothing
moved. `apps/desktop/tests/ipc-channels.test.ts` now fails if a channel is
added on only one side, or if a channel stops being a string literal.

