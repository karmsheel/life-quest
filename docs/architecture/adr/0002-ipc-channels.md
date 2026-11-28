# ADR 0002 — IPC channels are a checked pair

## Status

Accepted

## Context

A renderer call is a string channel in `preload.ts` and the same string in
`ipcMain.handle`. Those lists were kept by hand. They matched on this
revision: 223 invokes, 3 renderer sends, 10 main-to-renderer events. A
future channel added on only one side would fail at runtime, not at typecheck,
because the channel is a string rather than a shared constant.

## Decision

`apps/desktop/tests/ipc-channels.test.ts` is the check. Each direction must
be the same set of string literals. A template-literal channel fails the
test, so a dynamic name cannot slip past the comparison.

The method names on `LifequestApi` and the preload object are not part of
this check. A key parser that walks both objects still mis-reads nested
types. That comparison waits until it can be exact.

## Consequences

Adding an IPC method means adding the channel in both places in the same
change. The test does not rename channels or move handlers.
