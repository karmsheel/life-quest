# ADR 0001 — One calendar-date rule

## Status

Accepted

## Context

"Is this a real calendar day?" was implemented in `map/dates.ts`, `period.ts`,
`phone.ts`, `projects.ts`, `DatabasePage.tsx`, and, differently, in `goals.ts`
and `capture.ts`. `Date.parse("2026-02-31")` succeeds because it rolls into
March. The other copies already rejected that day. A deadline and a daily-note
filename must not disagree about what a date is.

## Decision

`calendar-date.ts` is the only implementation. It rejects a day that does not
exist, including 31 February and 29 February outside a leap year, and it does
not trim. Callers that accept free text trim before calling it.

Published names stay. `isValidLocalIsoDate`, the map's `isIsoDate`, and the
phone's `isIsoDate` are aliases so existing imports do not move. New code
calls `isCalendarDate` or `calendarDateFromParts`.

Goal writes now use the same rule. That refuses a deadline the old parser
accepted. It does not migrate stored files: the read path does not re-check
the string.

A display check that formats either a date or an instant stays separate. It
is not this rule.

## Consequences

A second UTC round-trip fails `apps/desktop/tests/calendar-date.test.ts`.
Adding a date field means calling this module, not copying the regex.
