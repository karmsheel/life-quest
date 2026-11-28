# ADR 0003 — One local-today formatter

## Status

Accepted

## Context

"What is today's `YYYY-MM-DD` in local time?" was copied in the map, the
period helpers, goal pace, the main process, recent vaults, the deadline
banner, and the page canvas. The bodies matched. `toISOString().slice(0, 10)`
is a different rule: it names the UTC day. That one stays where it is.

## Decision

`todayLocalIso` in `calendar-date.ts` is the implementation. The map and
period exports keep their names and call it. Renderer and main import it
from `@lifequest/vault-core/pure`. A private `function localIsoDate` fails
`calendar-date.test.ts`.

## Consequences

A new "today" string calls this function. A UTC day stamp does not.
