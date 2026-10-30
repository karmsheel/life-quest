# System architecture

LifeQuest is one Electron app around one folder on disk. The window is React, the
privileged half is Node inside Electron, the file engine is a separate workspace
package, and the companion is Hermes running as a local host the app attaches to.
This page is the map: which process owns what, how the pieces talk, where a write
lands, and what a repaint waits for. It assumes you have read
[Wiki home](./index.md).

## Where it lives

Nothing in this page is a screen. The pieces live in the repository and in two
places on the machine.

| Path | What it is |
|---|---|
| `apps/desktop/electron/` | The Electron main process and the preload bridge |
| `apps/desktop/src/` | The React renderer (pages, components, state) |
| `packages/vault-core/` | The vault file engine, imported by main only |
| `apps/desktop/dist/` | Built renderer (`npm run build`) |
| `apps/desktop/dist-electron/` | Bundled `main.js` (ESM) and `preload.js` (CJS) |
| `apps/desktop/e2e/` and `apps/desktop/tests/` | E2E rigs and their test wrappers |
| `docs/superpowers/` | Design specs and implementation plans |
| `archive/web-skeleton/` | The frozen Next.js + Prisma web app; **not** the product runtime |

At runtime there are two directories, and keeping them apart is a product rule:

- **The vault** — the folder you picked. Your life data: doctrine, goals, map,
  notes, reviews, databases, pages, Decisions, log.
- **`userData`** — the app's own state, on Windows `%APPDATA%\LifeQuest`. Recent
  vaults, the active lens per vault, the companion profile choice, the OS-encrypted
  Hermes key, the pairing secrets, the filing preference.

Read this page top-down for the shape, then jump: a rendering question belongs to
the renderer, a vault question goes through the vault service into `vault-core`, a
channel question to the IPC table, an agent question to the MCP door.

## The shape of the system

```text
                    ┌─────────────────────────── Electron app ──────────────────────────┐
  operator clicks → │  Renderer (React, no Node)                                        │
                    │     window.lifequest  ←  preload bridge  (invoke + push)          │
                    └───────────────────────────────┬───────────────────────────────────┘
                                                    │ IPC
                    ┌───────────────────────────────▼───────────────────────────────────┐
                    │  Main process (Node)                                              │
                    │    vault-service.ts   one queue over the open vault               │
                    │    mcp-server.ts      owns the two loopback doors                 │
                    │    companion.ts       attach/start Hermes, chat turns, model probe│
                    │    updater.ts         GitHub release check and install            │
                    │    secrets.ts         OS secure storage                           │
                    └───────────────┬───────────────────────────────┬───────────────────┘
                                    │ imports                        │ HTTP on 127.0.0.1
                    ┌───────────────▼───────────────┐   ┌───────────▼───────────────────┐
                    │  packages/vault-core          │   │  Hermes host gateway          │
                    │    paths, create/open, docs,  │   │    profile `lifequest`        │
                    │    decisions, log, map, views,│   │    agent loop, memory,        │
                    │    databases (SQLite), tools  │   │    skills, transcripts        │
                    └───────────────┬───────────────┘   └───────────────────────────────┘
                                    │ fs read/write
                              the vault folder
```

## Process model

### Main process

`apps/desktop/electron/main.ts` is the entry point the packaged app loads
(`dist-electron/main.js`). It owns everything privileged:

- **The window.** One `BrowserWindow`, 1280×800, custom hidden title bar. It loads
  the Vite server in dev (`http://localhost:5173` by default) and
  `dist/index.html` in a packaged build. `contextIsolation: true`,
  `nodeIntegration: false`, and DevTools only while unpackaged.
- **The IPC registrar.** All 163 `invoke` handlers go through one `ipcMain` facade
  that checks the sender and, for channels that can change data, notes the change
  after the handler settles.
- **The vault service.** Every renderer call that touches the vault is forwarded to
  `vault-service.ts`.
- **The MCP doors.** Started when a vault opens, rebound when another opens.
- **The companion.** `companion.ts` attaches to or starts Hermes and runs chat
  turns.
- **The updater.** One release check per launch, and an install only on request.
- **The FX refresh loop.** An hourly timer that re-reads the USD→ZAR rate while a
  vault is open.

Main installs the content guards on the window it creates, denies permissions by
default, and shuts the companion down on quit.

### Preload

`apps/desktop/electron/preload.ts` is bundled to CommonJS (an ESM `.js` preload is
silently skipped, which would leave the bridge undefined). It exposes exactly one
object with `contextBridge.exposeInMainWorld("lifequest", …)`: 163
`ipcRenderer.invoke` calls grouped by feature, plus six push subscriptions
(`vault:dataChanged`, `vault:fileChanged`, `companion:stream`,
`companion:statusChanged`, `update:progress`, `window:maximizeChanged`). There is
no raw `ipcRenderer`, no filesystem, no child-process access on the object.

The renderer reaches it through `apps/desktop/src/lib/ipc.ts`, whose `api()` throws
a plain error when `window.lifequest` is missing — which is how a harness page or a
browser tab fails honestly instead of half-working.

### Renderer

React 19 + Vite. It is a single-page app with `HashRouter` (chosen so a
`file://` packaged load works with no history API). It has no Node access: it
imports runtime values from `@lifequest/vault-core/pure` only, and a test
(`src/lib/renderer-vault-imports.test.ts`) fails if a renderer module value-imports
the Node barrel. That rule is what keeps `node:fs` out of the
browser bundle.

The renderer is mounted by `App.tsx` through a fixed provider tree:

```text
HashRouter
  ThemeProvider
    UpdateProvider            ← the launch's one update check
      CompanionProvider       ← one ensure, status, profile picker
        VaultProvider         ← the open vault snapshot, files-changed banner
          LiveDataProvider    ← the revision a dashboard card re-runs on
            AutomationScheduler, SplashGate
            ChatDockProvider
              NavDockProvider
                WindowTitleBar + AppRoutes
```

## The vault engine: `packages/vault-core`

vault-core is a workspace library, not a service. It has no Electron imports and no
app state; it takes a root path and does the work. It is the only code that knows
the vault layout, and it owns:

- **Paths.** `paths.ts` builds every path in the vault, validates each segment, and
  enforces physical containment and symlink refusal (see
  [Security](./29-security.md)).
- **Create and open.** `create-vault.ts` seeds the folder — `lifequest.json`,
  `.lifequest/`, four domains with empty doctrine, `domains/<slug>/data/` — and
  `open-vault.ts` reads it back into the snapshot the UI renders. An unsupported
  `schemaVersion` is a refusal, not a best effort.
- **Documents and frontmatter.** Doctrine and library Markdown with `locked` and
  `updatedAt` in frontmatter; atomic writes.
- **Records.** Goals, the map, projects, reviews and planning stubs, daily notes,
  Ideal State, signal chain, pages, pins, boards, automations, Decisions.
- **Databases.** Domain SQLite under `domains/<slug>/data/domain.sqlite`, its JSON
  registry, the row engine with typed cells, saved views and their query specs, the
  Finance kit, books export/restore, ingest batches.
- **Log.** `.lifequest/log.jsonl`, appended with the actor on every governed write.
- **The MCP tool definitions and their execution** (`ALL_TOOL_DEFS` in
  `src/index.ts`, with one module per family). The same tool layer serves both the
  companion (as the operator) and connected agents (through their grant).

Main imports the Node barrel `@lifequest/vault-core`; the renderer imports
`@lifequest/vault-core/pure` for types and pure helpers.

## The vault service

`apps/desktop/electron/vault-service.ts` is the main process's façade over
vault-core, and it is deliberately boring: one open vault, one queue.

- It holds `currentRoot`, `currentVaultId` and `currentLens`.
- Every call is serialised through `enqueue`, so two writes can never interleave
  inside the engine. A call made with no vault open returns
  `{ ok: false, error: "No vault is open" }` rather than throwing.
- Opening a vault does more than read files. `rememberOpen` records the recent
  vault, restores the lens saved for that vault, starts (or rebinds) both MCP doors
  to the new root, and writes the companion bearer into the Hermes profile — only
  when the local door actually bound. It then kicks off linked-database sync in a
  try/catch, because a sync failure must not block the open.
- `vaultGetSnapshot` re-reads the vault from disk and captures doctrine file
  mtimes, which is how the *Files changed on disk* banner is decided.

Everything the renderer can do to the vault is a function on this module, and
`main.ts` is the only place that maps a channel onto it.

## IPC: two directions

**Invoke (renderer → main → answer).** 163 channels, named by feature area:

| Prefix | Examples |
|---|---|
| `vault:` | `vault:create`, `vault:open`, `vault:getSnapshot`, `vault:listRecent` |
| `domain:` | `domain:create`, `domain:update`, `domain:archive`, `domain:setActive` |
| `db:` | `db:list`, `db:create`, `db:upsertRow`, `db:restoreBooks`, `db:fileSave` |
| `page:` / `script:` | `page:create`, `page:update`, `script:apply` |
| `document:` / `library:` | `document:save`, `document:setLocked`, `library:update` |
| `signalChain:` / `map:` / `goals:` | `signalChain:create`, `map:apply`, `goals:apply` |
| `review:` / `note:` / `planning:` | `review:write`, `review:markDone`, `note:write` |
| `companion:` | `companion:ensure`, `companion:chatStream`, `companion:profilesList` |
| `connectedAgents:` / `agents:` | `connectedAgents:list`, `connectedAgents:invite`, `agents:hire` |
| `settings:` / `update:` | `settings:update`, `update:check`, `update:install` |

**Push (main → renderer).** A small, fixed set. `vault:dataChanged` carries only a
revision number: something that a dashboard card reads has been written. The
renderer reads on mount and re-runs what is on screen when main announces a change;
it does not poll the vault on a timer.

## The MCP server and its tool families

Two loopback doors, both bind `127.0.0.1`, both speak Streamable HTTP MCP on
`POST /mcp`. `mcp-server.ts` is the app-level owner — the ports, the secrets
directory, which vault the doors serve, and what Settings sees when a door fails to
bind. `pairing-door.ts` owns the listeners, authentication, the per-door request
limits, the pairing Decision flow, and dispatch to `executeTool`.

The tool surface is one list, `ALL_TOOL_DEFS`, assembled from twelve modules:

| Family | Examples |
|---|---|
| map and goals | `get_state`, `get_week`, `get_doctrine`, `create_task`, `move_task`, `list_goals` |
| database | `list_databases`, `get_database`, `list_rows`, `upsert_row`, `insert_rows`, `delete_row` |
| views and dashboard | `get_dashboard`, `preview_view`, `save_view`, `get_view`, `arrange_dashboard`, `list_views` |
| documents | `list_documents`, `get_document`, `create_library_document`, `update_document` |
| reviews | `get_review`, `list_reviews`, `write_review`, `mark_review_done`, `get_period_pack` |
| pages | `list_pages`, `get_page` |
| signal chain | `list_signals`, `get_signal`, `create_signal` |
| daily notes | `list_daily_notes`, `get_daily_note` |
| capture | `capture_transaction`, `undo_capture`, `correct_capture` |
| script blocks | `run_script_block`, `apply_script_block` |
| projects | `list_projects`, `get_project` |

The same door serves two kinds of caller. The companion is authorised as the
operator with the whole vault. A connected agent is authorised by its grant — read
or write, which domains, schedule — and its writes to governed surfaces (doctrine,
library, reviews, projects, goal records, non-script page blocks, pins, ingest
mappings, posted ledger edits, kit install) file Decisions instead of applying.

## Companion lifecycle

Hermes is not bundled and not the product; it is a host the app uses.

1. **Ensure, once.** The renderer's `CompanionProvider` calls `companion:ensure` at
   mount. Main serialises ensures, so a Recheck, a second window, or React
   StrictMode cannot run two at once over the same `HERMES_HOME/.env`.
2. **Find the CLI.** Hermes is resolved by walking `PATH` for `hermes`
   (`hermes.cmd`/`hermes.exe`/`hermes` on Windows), then the install's own shim
   directory.
3. **Own a profile.** The app runs on one named profile, `lifequest` by default.
   Creating it seeds `SOUL.md`, writes the `mcp_servers.lifequest` entry into
   `config.yaml` (url plus the vault's bearer), turns off Hermes' progressive tool
   search for this profile so the LifeQuest tools stay visible, and copies the root
   `model:` block when the profile has none.
4. **Attach or start.** If the host gateway is up and already serving the profile,
   the app attaches and does nothing else. If the host is up but not serving it,
   the app asks the host to serve that profile without restarting the whole
   gateway. Only when there is no host does it ensure a gateway runtime and start
   one. The host API is on `8642` by default, with discovery on 8642/8644/8645/8650
   and the profile served at `/p/lifequest`.
5. **Status.** Main publishes a status the renderer gates on: `ready` (with
   `baseUrl` and whether LifeQuest started it), or one of `needs_install`,
   `profile_error`, `port_busy`, `gateway_exited`, `hermes_too_old`, `auth_error`,
   `disconnected`. Anything other than `ready` replaces the studio with the
   companion setup surface.
6. **Model probe.** After `ready` is published — never before, never awaited — main
   asks the host for its own model catalog and pushes a `companion:statusChanged`
   if the pinned model is no longer in it.
7. **Shutdown.** On quit, the app shuts down the gateway only if it started it, then
   closes the MCP doors. Attaching to a host the app did not start never gives it
   the right to kill that host.

Chat is the same path in reverse: the composer calls `companion:chatStream`; main
builds the turn (instructions context, page context, receipts, runtime overrides)
and streams events back on `companion:stream`. Tool calls inside a turn run in
main, against the same vault service the UI uses.

## Data revision: why a card repaints

The reported bug this exists for: "I told the agent to log an expense and the card
did not show it." The spec was a live query and the query was right; nothing asked
it to run again.

`apps/desktop/electron/data-revision.ts` is a counter and two lists.

- There are exactly two write doors: the IPC channels in main, and the MCP door's
  tool calls. Both are classified **by name**.
- The IPC list is the explicit set of channels that can change what a card reads
  (`MUTATING_CHANNELS`, including `settings:update` for the currency and the FX
  rate). A channel not named is assumed to read only — the safe direction, because
  reads re-enter the same registrar and a read that announced a change would loop.
- The MCP list is inverted: `READ_ONLY_TOOLS` names the discovery tools
  (`list_rows`, `preview_view`, `get_dashboard`, …) and **anything else is treated
  as a write**. A tool call is never caused by a repaint, so the only cost of a
  wrong guess is one repaint.
- Once a handler settles — including one that threw after writing — main bumps the
  revision and broadcasts one coalesced `vault:dataChanged` per frame, not one per
  write.

The renderer's `LiveDataProvider` turns that into a number a card depends on, and
also bumps on two non-write events: the local date changing (so "today" means
today, not the day the card was built) and the window regaining focus (the
catch-all for edits made by another program, a sync client, or a second copy).

## Routing and sheets

`App.tsx` declares the routes. Everything below is a hash route.

| Route | Page |
|---|---|
| `/welcome` | Welcome (no vault open) |
| `/home` | Dashboard, the pin board per lens |
| `/data`, `/data/:slug/:dbId` | Data wing and one database |
| `/pages`, `/pages/:slug/:pageId` | Pages and the page canvas |
| `/chain` | Life-Chain |
| `/dream`, `/dream/:slug/:kind` | Dream and the doctrine editor |
| `/vision`, `/vision/:slug/:kind` | Vision and the doctrine editor |
| `/ideal-state` | Ideal State |
| `/goals` | Goals |
| `/projects`, `/projects/:id` | Projects and one project |
| `/chart` | Life Map |
| `/track`, `/track/:slug/:kind` | Architecture and the day-template editor |
| `/act` | Act |
| `/notes` | Daily Note |
| `/automations` | Automations |
| `/daily` | Daily Schedule |
| `/review/:cadence` | Review |
| `/documents` | Library documents |
| `/decisions`, `/settings` | Sheets over the page you were on |
| `/log` | Life log |
| `/personnel` | Personnel |
| `/` and `*` | Redirect to `/home` with a vault, `/welcome` without |

`/domains` redirects to `/settings?tab=domains`. Settings and Decisions are not
pages: the route stays mounted and the sheet is painted above it, so closing one
returns you to the page, scroll position and state you left. The companion gate is
in `AppRoutes`; while `ensuring` is true or the status is not `ready`, the setup
surface renders instead of the studio.

## Rules and behaviour

- **One vault at a time.** Opening another rebinds the doors and swaps the root; there is no multi-vault window and no tenancy.
- **One write queue.** Serialised in the vault service, so two writes never race.
- **Two write doors, one signal.** IPC and MCP are the only ways in, which is what
  makes the revision counter trustworthy.
- **The renderer cannot reach the disk.** No `fs`, no Node: every read and write is a curated bridge call.
- **The engine cannot reach Electron.** vault-core runs in plain Node, so the rigs can drive it.
- **The companion is a host, not a library.** The app never bundles Hermes and only
  writes the files a profile owns.
- **The packaged app is a bundle, not a source tree.** `app.asar` holds `dist/`,
  `dist-electron/` and the desktop `package.json`; no `node_modules`.

## Related

- [Overview](./01-overview.md)
- [The vault](./04-the-vault.md)
- [Decisions](./23-decisions.md)
- [Companion](./24-companion.md)
- [Personnel and agents](./25-personnel-and-agents.md)
- [Security](./29-security.md)
- [Development](./31-development.md)
