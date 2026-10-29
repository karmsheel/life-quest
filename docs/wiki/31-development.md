# Development

LifeQuest is a two-workspace npm monorepo: the Electron + Vite + React studio in
`apps/desktop`, and the vault file engine in `packages/vault-core`. This page is the
maintainer's path — how to run it, how the dev loop reloads main-process changes,
what `npm test` actually runs, and how a build becomes a Windows release. If you
only want to *use* the app, read [Getting started](./02-getting-started.md)
instead. Start from [Wiki home](./README.md).

## Where it lives

Everything is driven from the repository root. The scripts live in
`apps/desktop/package.json`; the helper scripts they call live in
`apps/desktop/scripts/`.

| Path | What it is |
|---|---|
| `package.json` (root) | Workspace scripts that proxy to `@lifequest/desktop` |
| `apps/desktop/scripts/dev.mjs` | The dev loop: bundle, Vite, Electron, watch, relaunch |
| `apps/desktop/scripts/bundle-electron.mjs` | Production esbuild bundle of main + preload |
| `apps/desktop/scripts/test.mjs` | Runs the E2E test wrappers |
| `apps/desktop/scripts/package.mjs` / `release.mjs` | electron-builder invocations |
| `apps/desktop/electron-builder.yml` | The packaging contract |
| `apps/desktop/e2e/` | Rig drivers and the harness pages they load |
| `apps/desktop/tests/` | `node:test` wrappers, one per rig |
| `apps/desktop/e2e/artifacts/` | Reports and screenshots; gitignored |
| `apps/desktop/dist/` and `dist-electron/` | Build outputs; gitignored |
| `apps/desktop/release/` | Packaged builds; gitignored |

## Prerequisites

| Tool | Notes |
|---|---|
| Node.js 20+ | Developed on Node 22; the E2E runner uses `--experimental-strip-types` |
| npm | Workspaces monorepo; install once at the root |
| Hermes | Needed to *run* the studio, not to build or typecheck it |
| Windows x64 | Needed for `npm run package` / `npm run release`; the product is Windows |

Install with `npm install` at the repo root. In a worktree of your own, run
`npm ci` **in that worktree**: symlinking the primary checkout's `node_modules`
makes the workspace links resolve `@lifequest/vault-core` to the other tree, and
you silently develop against the wrong engine.

## The dev loop

```bash
npm run dev            # same as npm run dev:desktop
```

That runs `node apps/desktop/scripts/dev.mjs`, which:

1. **Bundles Electron with esbuild** — `electron/main.ts` to
   `dist-electron/main.js` (ESM, loaded natively by Electron main) and
   `electron/preload.ts` to `dist-electron/preload.js` (CommonJS, because an ESM
   `.js` preload is silently skipped and would leave `window.lifequest` undefined).
   The dev bundle keeps sourcemaps and defines `__LIFEQUEST_E2E_SEAM__` true.
2. **Starts Vite** on `127.0.0.1:5173`. `vite.config.ts` sets `strictPort: true`,
   so a second checkout cannot silently take the port — it exits. Set
   `LIFEQUEST_DEV_PORT` to run on another port.
3. **Waits for the port**, then launches Electron with `VITE_DEV_SERVER_URL` set,
   so the window loads the dev server rather than `dist/index.html`.
4. **Watches the main process's own sources.** `apps/desktop/electron/**` and
   `packages/*/src/**` are watched with a 120 ms debounce. A change rebundles first
   and only then replaces the running app; if esbuild throws, the running app is
   left alone and the error is printed. A change that lands mid-rebundle is queued.
   The renderer is **not** watched here — Vite already hot-replaces `src/**`, and
   relaunching the app on every component edit would be worse than doing nothing.
5. **Ends when you close the app.** An Electron exit the script did not cause is
   "the developer closed the window", and that shuts the dev session down. It
   strips `ELECTRON_RUN_AS_NODE` from the child environment, because an Electron
   host that exports it would make every `electron` command run as plain Node.

`npm run dev` rebundles main and preload and relaunches the app, so that restart is
the whole restart after a main-process or preload change. Nothing else does it.

If Electron dies before a window opens with exit code `0x80000003`, `dev.mjs`
prints the diagnosis rather than exiting silently: this machine's Windows refused
Chromium's sandbox version. Updating `electron` is the fix.

### Why the main process needs that watcher

The main process is an esbuild bundle, built once and loaded once. A change to
`electron/**`, or to `packages/vault-core/src/**` that main imports, is invisible
until the bundle is rewritten *and* Electron is relaunched. The renderer, by
contrast, hot-reloads on save — which is how a stale main process can look like a
working app while the feature you are editing is not in the process you are
watching.

## Typecheck and build

```bash
npm run typecheck      # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit
npm run build          # vite build && node scripts/bundle-electron.mjs
```

`typecheck` checks the renderer and the Electron main/preload separately (two
tsconfigs), and both must pass.

`build` produces the two artifacts a packaged app needs, and nothing else:

- `apps/desktop/dist/` — the production renderer, `base: "./"` so a `file://` load
  works.
- `apps/desktop/dist-electron/` — the production main and preload. This bundle
  defines `__LIFEQUEST_E2E_SEAM__` false, so the E2E seam is dead code and cannot be
  reached from a packaged app by setting an environment variable; it also ships no
  sourcemaps, because a `.map` in `app.asar` would hand out the main-process source.

`npm run build` on its own produces no installer and no release; it is a build.

## Tests

```bash
npm test               # from the repo root → apps/desktop/scripts/test.mjs
```

That runs `node --experimental-strip-types --test "tests/**/*.test.ts"` in
`apps/desktop`, with `ELECTRON_RUN_AS_NODE` stripped from the environment.

The testing discipline in this repository is E2E, and the layout enforces it:

| Piece | What it is |
|---|---|
| `e2e/<name>.electron.mjs` | A rig **driver** — launches a real Electron process, loads real pages, drives real IPC |
| `e2e/<name>.html`, `e2e/<name>.tsx` | Harness pages the driver loads from the dev server |
| `tests/<name>-e2e.test.ts` | A thin `node:test` wrapper that runs the driver and reads its report |
| `e2e/artifacts/` | `<name>.json` report plus `<name>.png` screenshot from `capturePage`; gitignored |

Two rules matter when you run them:

- **Most rigs need the dev server on 5173.** The wrapper probes the port and calls
  `t.skip` when nothing is listening (`run \`npm run dev\` to include this e2e`). A
  skipped rig is evidence of nothing.
- **The cold-start rig is the exception.** `startup-boot.electron.mjs` serves the
  built `dist/` itself and skips unless `dist/index.html` and
  `dist-electron/main.js` exist, with the message `run \`npm run build\` to include
  this e2e`. Run `npm run build` first if you want it.

To run one rig, from `apps/desktop` with the dev server up:

```bash
node --experimental-strip-types --test tests/card-context-e2e.test.ts
node --experimental-strip-types --test tests/startup-boot-e2e.test.ts   # after npm run build
```

Four scripts under `apps/desktop/e2e/` are deliberately **not** in `npm test`,
because they touch the operator's own vault or the real network:

```bash
node apps/desktop/e2e/dashboard-live-summary.mts       # pin a real summary card through the companion's tools
node apps/desktop/e2e/dashboard-live-app.mjs           # boot the built app, assert it renders, toggle the lock
node apps/desktop/e2e/dashboard-live-card.electron.mjs # screenshot that card
node apps/desktop/e2e/update-live-feed.mjs             # read the real GitHub feed, print the app's decision
```

`update-live-feed.mjs` runs the real updater logic against the real network. Run it
before cutting a release and again after publishing one.

## Packaging and release

Both go through electron-builder on Windows x64, configured by
`apps/desktop/electron-builder.yml`. The version both read is `version` in
`apps/desktop/package.json` (currently `0.2.0`).

```bash
npm run package   # a dev build you can run: apps/desktop/release/win-unpacked/LifeQuest.exe
npm run release   # the shippable build: installer + portable zip + manifest
```

**`package`** runs `npm run build` and then electron-builder with `--dir`, which
pins the output to the unpacked folder and builds nothing else. It is the fast way
to run the app without Node, npm or Vite.

**`release`** runs `npm run build` and then electron-builder on all three Windows
targets: the unpacked folder, an NSIS installer, and a portable zip. It is invoked
with `--publish never`, so a build can never half-publish. The two uploadable
files, named from the version, are:

| Asset | What it is |
|---|---|
| `LifeQuest-<version>-setup.exe` | Assisted, per-user NSIS installer; asks where to install |
| `LifeQuest-<version>-win-x64.zip` | Portable build; extract and run `LifeQuest.exe` |

The script prints each file's size and SHA-256, writes
`apps/desktop/release/release-manifest.json` with the same numbers, and exits
non-zero if either asset is missing instead of reporting success. Uploading is not
part of the build: `gh release create` attaches the files.

The packaging config is part of the security posture: `asar: true`, only `dist/`,
`dist-electron/` and the desktop `package.json` are packed (no `node_modules`),
`extraMetadata.main` points at `dist-electron/main.js`, `publish: null`,
`forceCodeSigning: false` with identity discovery disabled, and the Electron fuses
block turns off `runAsNode`, `NODE_OPTIONS` and inspector flags, turns on cookie
encryption, and requires asar integrity plus `onlyLoadAppFromAsar`. Uninstalling
does not delete app data, so the recent-vault list survives.

### The packaged smoke test

`npm test` proves the app works when Electron loads it from disk, and
`npm run release` proves files were written. Neither proves the packed `.exe` runs.
A release is not a release until this passes against the built app:

```bash
npm run release
node apps/desktop/e2e/packaged-smoke.mjs
```

It checks that the asar really holds main, preload and renderer, then launches
`release/win-unpacked/LifeQuest.exe` with a throwaway profile and a vault it creates
in the temp directory. It requires the window to reach the title `dist/index.html`
declares, the app's own MCP door to bind, and the vault to come back in that
throwaway `recent.json`. It writes `e2e/artifacts/packaged-smoke.json`, exits
non-zero with the app's transcript on failure, and never opens your vault or
`%APPDATA%\LifeQuest`. It is not in `npm test` because it needs a packaged build
first, and it isolates itself with `--user-data-dir` rather than the E2E seam (which
is compiled out of a packaged build).

## The test bench on this machine

`AGENTS.md` describes the bench this project runs on. It is headless: the app lives
on a virtual X display (Xvfb `:99`, x11vnc on loopback, noVNC in a browser), and
exactly one app sits on it at a time.

| Command | What it does |
|---|---|
| `/root/.local/bin/lifequest-dev [checkout]` | Starts `npm run dev` for a checkout on the bench, replacing what was there |
| `lifequest-dev --status` | Says which checkout is being served |
| `lifequest-dev --stop` | Stops it |
| `/root/.local/bin/lifequest-shot [out.png]` | Captures the display, for an artifact |
| `/root/.local/bin/lifequest-e2e <worktree> [tests/…]` | Locked E2E run: puts that checkout on 5173 under a throwaway profile, runs the tests, restores the bench even on failure |

Bench discipline:

- **One dev server.** Never start a second `npm run dev` or bind 5173 by hand:
  Vite uses `strictPort`, and a second app would also fight the profile and the MCP
  doors.
- **E2E against your checkout, through `lifequest-e2e`.** A bare `npm test` loads
  whatever is on 5173, which may be another branch's code, or skips every rig when
  nothing is up.
- **A skipped rig is evidence of nothing.** Count only a run whose report artifact
  exists and whose picture shows the shipped screen.
- **Restore the bench** to `lifequest-dev /root/projects/life-quest` when you are
  done unless you were asked to leave a branch on it.

## Working rules

- Never write unit tests after writing code. Prefer E2E as the sole testing
  mechanism, and have the rig produce a verifiable, repeatable artifact.
- If you must test a system in isolation, write down all the ways it can fail first,
  then write the code.
- If a change only takes effect after a restart — a rebuilt main process, a changed
  preload or IPC channel, a dev server serving stale bundles — do the restart
  yourself and verify against the restarted process. Alerting the operator is not
  doing it.
- Restart only what the change needs, and ask before stopping a process that is the
  operator's rather than one you started.

## Tips and gotchas

- **A running `LifeQuest.exe` locks files under `release/`.** Quit the app before
  building again. Deleting `win-unpacked` removes that build only; vault folders and
  `%APPDATA%\LifeQuest` stay.
- **`release/`, `dist/`, `dist-electron/` and `e2e/artifacts/` are gitignored.** E2E
  reports and screenshots are evidence for a hand-over, not repository content.
- **Environment overrides exist for rigs, not for the product.** `LIFEQUEST_E2E` can
  redirect `userData`, hide the window, move both MCP ports, point the updater at a
  rig-owned feed and trust policy, and override the installer launcher. It is gated
  by `__LIFEQUEST_E2E_SEAM__ && !app.isPackaged` and compiled out of the shipped
  bundle; a packaged app cannot be redirected this way.
- **First launch of an unsigned build** may raise a Windows SmartScreen warning;
  `More info → Run anyway` gets past it.
- **The main process is a bundle, not a watched file.** If a main-process change
  seems not to apply, check the `[dev]` lines: a failed rebundle leaves the old app
  running on purpose.

## Related

- [Overview](./01-overview.md)
- [The vault](./04-the-vault.md)
- [Companion](./24-companion.md)
- [Updates](./27-updates.md)
- [System architecture](./30-system-architecture.md)
- [Troubleshooting](./32-troubleshooting.md)
