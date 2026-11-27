# Architecture

Last verified: 2026-11-27 · LifeQuest 0.3.4 · master `5c6ee13`

How the studio is put together: the stack, where code lives, how a click becomes a file on
disk, and where each contract is defined. This is the agent-facing map. The operator-facing
deep dives live in [`docs/wiki/30-system-architecture.md`](docs/wiki/30-system-architecture.md)
and [`docs/wiki/31-development.md`](docs/wiki/31-development.md); if this file and the code
disagree, the code is right.

## Shape

One Electron app in a two-workspace npm monorepo. The **main process** owns the vault, the
companion process lifecycle and two loopback MCP doors. The **renderer** is a React SPA with no
Node access, speaking to main through a single typed preload bridge. **vault-core** is a plain
Node library (it imports `node:fs` and `node:sqlite`, never `electron`) that reads and writes
the vault folder; both the UI and the companion reach it through the same serialized service.

## Stack

| Layer | Choice | Pinned in |
|---|---|---|
| Runtime | Electron `^44.6.0` | `apps/desktop/package.json` |
| UI | React `^19.2.4`, react-router-dom `^7.6.0` (`HashRouter`) | `apps/desktop/src/App.tsx` |
| Renderer build | Vite `^6.3.0`, esbuild `^0.25.0` (main + preload bundles) | `apps/desktop/vite.config.ts`, `scripts/bundle-electron.mjs` |
| Language | TypeScript `^5.8.0`, `strict: true` in all three tsconfigs | `apps/desktop/tsconfig*.json`, `packages/vault-core/tsconfig.json` |
| Packaging | electron-builder `^26.15.7` — NSIS installer + portable zip, Windows x64 | `apps/desktop/electron-builder.yml` |
| Tests | `node:test` wrappers over Electron rigs (`*.electron.mjs`) | `apps/desktop/tests/`, `apps/desktop/e2e/` |
| Vault books | `node:sqlite` **DatabaseSync** (Node built-in), one file per domain | `packages/vault-core/src/domain-databases.ts` |
| Companion | `@earendil-works/pi-agent-core` `1.3.0` (built-in Pi); optional external Hermes gateway | `apps/desktop/package.json`, `electron/harness/` |
| MCP | `@modelcontextprotocol/sdk` `^1.30.0` | `electron/mcp-server.ts`, `electron/pairing-door.ts` |
| Icons | `lucide-react` | `apps/desktop/src/components/shell/nav-items.ts` |
| State | React context providers only — no Redux/Zustand/Jotai | `apps/desktop/src/state/` |

No Prisma, no Next.js, no hosted database at runtime. The Next.js + Prisma tree under
`archive/web-skeleton/` is frozen history and is not installed or run.

## Repo map

| Path | What it owns |
|---|---|
| `apps/desktop/electron/` | Main process: window, IPC handlers, vault service, companion lifecycle, MCP doors, updater, secrets |
| `apps/desktop/electron/harness/` | The companion seam: Pi and Hermes implementations behind one registry |
| `apps/desktop/src/` | Renderer: `App.tsx` routes, `components/` (22 feature dirs), `pages/`, `state/` (React context providers), `styles/`, `lib/` |
| `apps/desktop/shared/` | Isomorphic contracts: theme file v2, composition, agent picker (imported by both sides) |
| `apps/desktop/e2e/` | Rig drivers, harness pages, fixtures; `artifacts/` holds reports and pictures (gitignored) |
| `apps/desktop/tests/` | `node:test` wrappers over the rigs (they outnumber the rigs; not every test drives one); `scripts/test.mjs` runs them |
| `packages/vault-core/src/` | Vault filesystem library: create/open, paths, documents, decisions, databases, books |
| `docs/wiki/` | The operator's guide, 38 pages, gated by `npm run docs:check` |
| `docs/superpowers/` | Decision history: design specs (62) and implementation plans (29), one record per feature or decision |
| `LAWS/` | Observable product invariants (RFC 2119) |
| `scripts/` | Repo-level gates: `docs-check.mjs`, `build-docs.mjs` |
| `bin/` | `agent-cli` — repo facts and canonical commands for agents |
| `archive/` | Frozen web skeleton, not a runtime |
| `.github/workflows/` | `docs.yml` (publish), `docs-check.yml` (drift gate) |

## Three flows

### 1. A click becomes a file

```
renderer (React 19, no Node)
  → window.lifequest.<feature>.<method>()      // preload bridge, typed by LifequestApi
  → ipcRenderer.invoke / webContents.send      // 205 ipcMain.handle registrations on this revision
  → electron/vault-service.ts                  // ONE serialized queue: every vault write goes through it
  → packages/vault-core                        // paths, atomic writes, locks, decisions
  → vault folder on disk                       // markdown + JSON/JSONL + domains/{slug}/data/domain.sqlite
  → data-revision.ts                           // main tells the renderer what changed
  → providers in src/state/                    // re-render
```

The queue is the point: writes never race. Read paths also go through the service, so a read
sees every write queued before it (`electron/vault-service.ts`).

### 2. The companion becomes a writer

```
Pi (child process, OpenAI-compatible endpoint)  ─┐
Hermes (external gateway, default :8642)        ─┤
                                                ▼
                            MCP door on 127.0.0.1 (local + invite/pairing)
                            → the same vault-service tools the UI uses
                            → locks and Decisions enforced in main, not in the agent
```

Both companions are behind `electron/harness/` (`registry.ts`, `pi-harness.ts`,
`hermes-harness.ts`); the app attaches to a Hermes profile or starts it, and never kills a
gateway it did not start. The two doors bind loopback only; ports are overridable for rigs via
`LIFEQUEST_E2E`. A page can be taken out of the companion's context, but every page is in
context by default ([`LAWS/COMPANION.md`](LAWS/COMPANION.md)).

### 3. Boot

```
electron/main.ts
  → single-instance / window chrome / userData
  → vault from recent.json (or the welcome flow)
  → companion gate: the studio does not open without one
  → renderer loads (Vite dev server, or dist/ inside app.asar)
  → splash yields; update check runs at launch and hourly
```

The splash does not wait on the companion's first token (cold start is its own decision), and
`__LIFEQUEST_E2E_SEAM__` is compiled out of packaged builds, so a shipped app cannot be
redirected by environment variables.

## Where contracts live

| Contract | Source of truth |
|---|---|
| IPC surface (renderer → main) | `apps/desktop/src/vite-env.d.ts` (`LifequestApi`), mirrored by `electron/preload.ts` |
| IPC result envelope | `{ ok: true; value } \| { ok: false; error }` — `Result<T>` in `packages/vault-core/src/types.ts`, repeated in `electron/preload.ts` |
| Channel names | Feature-prefixed (`vault:`, `chat:`, `theme:`, `agents:`…), registered in `electron/main.ts` and feature modules |
| Vault layout | `packages/vault-core/src/paths.ts`; documented in [`docs/wiki/04-the-vault.md`](docs/wiki/04-the-vault.md) |
| Vault schema | `SCHEMA_VERSION = 1` in `packages/vault-core/src/types.ts`; a higher version is refused by `open-vault.ts`, never migrated |
| Theme file (v2) | `apps/desktop/shared/theme-file.ts` + [`DESIGN.md`](DESIGN.md) appendix |
| MCP tools | `electron/*-tools.ts` (`map-tools`, `theme-tools`, `vault-agents`…) |
| Routes and rail | `apps/desktop/src/App.tsx`, `components/shell/nav-items.ts`, `wing.ts` |
| Product invariants | [`LAWS/`](LAWS/README.md) |
| Build/release runbook | [`docs/wiki/31-development.md`](docs/wiki/31-development.md) |

Counts drift. The only reliable numbers are the commands that produce them — for example
`grep -rho 'ipcMain.handle' apps/desktop/electron | wc -l`, or
`git ls-tree -r --name-only HEAD -- apps/desktop/e2e | grep -c '\.electron\.mjs$'`.

## Build and artifacts

| Command | What it produces |
|---|---|
| `npm run dev` | Vite server on 5173 (strict port) + esbuild main/preload bundle + Electron relaunch on change |
| `npm run build` | `dist/` (renderer) + `dist-electron/` (main + preload); no installer |
| `npm run package` | `apps/desktop/release/win-unpacked/` — a runnable folder |
| `npm run release` | `LifeQuest-<version>-setup.exe`, `LifeQuest-<version>-win-x64.zip`, `release-manifest.json` |
| `npm run typecheck` | Renderer + main typecheck, no emit |
| `npm test` | E2E wrappers; each rig skips unless a dev server is listening (cold-start rig builds its own `dist/`) |
| `npm run docs:check` | Wiki vs app drift gate; runs in CI and before `release` |

Packaged content that must hold: the asar contains main, preload and renderer — that is what the
packaged smoke test proves, because it is the only place the three actually meet.

## Where to add a feature

1. **Law first** — if the feature changes observable product behavior, add or amend a file in
   [`LAWS/`](LAWS/README.md). If it changes the model, update [`PRD.md`](PRD.md).
2. **Route + rail** — add the route in `src/App.tsx`; add the row in
   `components/shell/nav-items.ts` under the right wing (`wing.ts`).
3. **Page** — `src/pages/` for a route-level screen, `src/components/<feature>/` for the parts.
4. **State** — a provider in `src/state/` only if it must survive navigation; persist profile
   state to `userData`, never the vault.
5. **IPC** — add the method to `LifequestApi` in `src/vite-env.d.ts`, implement it in
   `electron/preload.ts` and a handler in main; return the `Result` envelope.
6. **Vault** — put file logic in `packages/vault-core` (paths in `paths.ts`, atomic writes via
   `atomic-write.ts`); never write the vault from the renderer.
7. **Companion** — if an agent may use it, add an MCP tool, and route sensitive writes through
   Decisions rather than direct commits.
8. **Wiki + gate** — update the operator page; `npm run docs:check` must stay green.
9. **Rig** — add `e2e/<feature>.electron.mjs` + `tests/<feature>-e2e.test.ts` and produce an
   artifact; no unit test after the fact.

## Invariants that shape the code

- The renderer has no Node access; every privileged action crosses the bridge.
- Vault writes are serialized in one queue; no handler writes around it.
- Locks and Decisions are enforced in main/vault-core, never trusted to an agent.
- The renderer never holds a raw API key; secrets live in OS secure storage.
- A vault schema bump is a decision, not a side effect of a feature.
- The E2E seam is compiled out of packaged builds.
- One dev server per machine: Vite runs `strictPort`, and the MCP doors are single-instance.

## Source-of-truth hierarchy

Code and tests beat `docs/wiki/`, which beats `docs/superpowers/` specs, which beat this file.
This file beats nothing; it is a map. When you change one of the sources above, update the map
only if the shape changed — not to restate a detail that already has a home.
