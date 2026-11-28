# Architecture progress

Internal record for the entropy-reduction workstream. Product history stays in
[`PROGRESS.md`](../../PROGRESS.md).

## State

| | |
|---|---|
| Branch | `room/goal-systematically-reduce-architectural-wcpv` |
| Round | 1 verified |
| Verified by | `node --experimental-strip-types --test apps/desktop/tests/calendar-date.test.ts` |

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
