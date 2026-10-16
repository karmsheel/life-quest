# `npm run dev` rebuilds the main process

**Status:** design
**Date:** 2026-10-16
**Touches:** `apps/desktop/scripts/dev.mjs`,
`apps/desktop/e2e/dev-watch.mjs` (new),
`apps/desktop/tests/dev-watch-e2e.test.ts` (new)

## 1. The problem

`AGENTS.md` states a rule and a fact, and the fact was false:

> In `apps/desktop`, `npm run dev` rebundles main and preload and relaunches the
> app, so that is the whole restart.

`dev.mjs` bundled once, started Vite, launched Electron, and returned. There was no
watcher of any kind. So the restart the rule promises never happened on a file
change, and an operator working on the main process — the MCP door, the vault
service, the pairing, the IPC handlers — was running whatever was bundled the
moment they typed `npm run dev`.

**Measured, not guessed.** While merging the previous change, the running app and
its bundle shared one timestamp to the second:

```
electron.exe (pid 1324)     2026/10/15 15:19:47
dist-electron/main.js       2026/10/15 15:19:47
```

The app had been running a day-old main process. The renderer hot-reloaded the
whole time, so the window painted current components over stale main-process code:
the most expensive shape this failure can take, because everything looks like it is
working. The fix that was being merged could not be checked against that process at
all — it did not contain it — and nothing on screen said so.

## 2. What is watched, and what deliberately is not

| Path | Watched | Why |
|---|---|---|
| `apps/desktop/electron/**` | yes | main and preload, and the ~24 modules they bundle |
| `packages/*/src/**` | yes | the workspace packages main imports — `@lifequest/vault-core`, which is most of the engine |
| `apps/desktop/src/**` | **no** | the renderer is Vite's; it hot-replaces on save, and relaunching the app per keystroke would be worse than doing nothing |
| `dist-electron/**` | **no** | esbuild writes there; watching our own output is a feedback loop that restarts the app forever |

The watch set is derived from the imports rather than from a guess: `main.ts`
imports `./*.js` and `@lifequest/vault-core` (`/pure`), and imports nothing from
`src/`. `preload.ts` imports only `electron` and local files. So there is exactly
one workspace package in play, and the renderer is genuinely out of scope.

## 3. The rule: bundle first, and only replace what builds

A change debounces for 120 ms, then:

1. **Rebundle.** If esbuild throws, the running app is left alone, the error is
   printed, and nothing is relaunched. A typo must not cost you the dev session you
   are working in — and the natural next move after a build error is to fix it and
   save again, which is exactly what the watcher is for.
2. **Then stop the old app.** SIGTERM, and SIGKILL three seconds later if it is
   still there: Electron on Windows does not always honour a soft kill, and an
   overlapping relaunch would leave two apps holding one profile and the same two
   MCP ports.
3. **Then launch.** A change that lands mid-rebundle is queued and applied next,
   never dropped and never run concurrently.

The exit of an app we replaced is ours, not the operator's: `startElectron` marks
the child it is replacing, and the exit handler ignores a marked child. An exit
nobody asked for is still "the operator closed the app", which ends `npm run dev`
exactly as it did before.

**One new seam, because the rig needs it.** `LIFEQUEST_DEV_PORT` (default 5173) is
passed to Vite as `--port`. `vite.config.ts` sets `strictPort: true`, so a second
checkout cannot start at all while the operator's is up — and a rig that edits
source files and rebuilds bundles has to run in a checkout of its own. Everything
else it needs already existed: `LIFEQUEST_E2E` isolates `userData`, hides the
window, and moves both MCP doors.

## 4. What this is NOT

- **Not a renderer watcher.** Vite already has that, and duplicating it would
  restart the app on every component edit.
- **Not a test runner.** Nothing here runs tests on save.
- **Not a change to what a restart means.** If the app exits on its own, dev still
  ends. Nothing here keeps a dead session open.
- **Not a patch to `AGENTS.md`.** The sentence about `npm run dev` was already
  there and already correct in intent; this is the script becoming what the rule
  says it is.

## 5. How it is falsified

`tests/dev-watch-e2e.test.ts` reads `e2e/artifacts/dev-watch.json`, and
`e2e/dev-watch.mjs` writes it. The rig starts a REAL `npm run dev` on its own port
and profile and edits REAL source files.

The instrument is one line the rig appends to a module the main process bundles:

```js
console.log("[dev-watch-probe] <token> pid=" + process.pid);
```

It is deliberately the crudest probe available, because it can only pass if the
bundle was **rewritten** (the token was in no earlier bundle) and a process
**evaluated** it (it is in the log) — and the pid separates the two, so a rebundle
without a relaunch and a relaunch of an old bundle both fail.

| Leg | Claim |
|---|---|
| `boot` | No probe before the edit, and no relaunch before the edit: the marker is the rig's. |
| `change` | A one-line main-process edit rewrites `dist-electron/main.js`, announces a relaunch, and the token appears with a **new pid**. |
| `renderer` | A change under `src/` relaunches nothing and rebundles nothing. The control that stops "restart on every save" from passing. |
| `broken` | A source file that cannot build is reported, is not launched, and the app that was already up is **still alive** on the pid it had. |
| `recover` | The next good save relaunches again, from the broken state, with a new pid and no manual restart. |
| `restore` | The rig's own edits are put back, and the checkout is left as it was found. |

Measured on the un-watched `dev.mjs`, the rig fails in the operator's own words:

> the edit never reached the running app: the new code was bundled but not launched

The artifact is `e2e/artifacts/dev-watch.json`: same command, same numbers, no
eyeballing the app.
