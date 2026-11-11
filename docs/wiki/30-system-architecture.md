# System architecture

LifeQuest is one Electron app around one folder on disk. The window is React, the
privileged half is Node inside Electron, the file engine is a separate workspace
package, and "the companion" is one of two agents behind a single seam: **Pi**, which
runs inside the main process, or **Hermes**, an external gateway. This page maps
which process owns what, how the pieces talk, where a write lands, and what a
repaint waits for. It assumes you have read [Wiki home](./index.md).

## Where it lives

Nothing in this page is a screen. The pieces live in the repository and in two
places on the machine.

| Path | What it is |
|---|---|
| `apps/desktop/electron/` | The main process and the preload bridge |
| `apps/desktop/electron/harness/` | The `AgentHarness` seam: registry, Pi, Hermes, Pi sessions |
| `apps/desktop/src/` | The React renderer (pages, components, state) |
| `packages/vault-core/` | The vault file engine, imported by main only |
| `apps/desktop/dist/`, `dist-electron/` | Built renderer; bundled `main.js` (ESM) and `preload.js` (CJS) |
| `apps/desktop/e2e/`, `apps/desktop/tests/` | E2E rigs and their test wrappers |
| `bin/agent-cli`, `scripts/`, `docs/wiki/` | Repo lookup CLI, docs check/build, this wiki |
| `docs/superpowers/`, `archive/web-skeleton/` | Design archive; frozen web app (not runtime) |

At runtime there are two directories, and keeping them apart is a product rule:

- **The vault** — the folder you picked: doctrine, goals, map, notes, reviews,
  databases, pages, images, attachments, Decisions, log.
- **`userData`** — the app's state, on Windows `%APPDATA%\LifeQuest`: recent vaults,
  the lens per vault, the harness choice, the Pi endpoint and sealed key, Pi
  transcripts, the Hermes key, pairing secrets, chat-tab memory.

## The shape of the system

```text
 operator → Renderer (React, no Node) ─ window.lifequest ← preload ─┐
                                                                   │ IPC
 ┌─────────────────────────── Main process (Node) ──────────────────▼─┐
 │ vault-service.ts  one queue over the open vault                    │
 │ harness/          AgentHarness: Pi (in main) | Hermes (external)   │
 │ mcp-server.ts     the two loopback vault doors, grants, bearer     │
 │ onboarding / images / attachments stores; updater; FX loop        │
 └──────┬───────────────────────────────────────────┬─────────────────┘
        │ imports                                   │ MCP tools over 127.0.0.1
 ┌──────▼─────────────────┐              ┌──────────▼─────────────────┐
 │ packages/vault-core    │              │ Pi agent loop, or Hermes   │
 │ paths, areas, docs,    │              │ host gateway: loop, memory,│
 │ databases, decisions,  │              │ skills, transcripts        │
 │ log, onboarding, tools │              └────────────────────────────┘
 └──────┬─────────────────┘
        │ fs read/write → the vault folder
```

## Process model

### Main process

`apps/desktop/electron/main.ts` is the entry point the packaged app loads
(`dist-electron/main.js`). It owns everything privileged:

- **The window.** One `BrowserWindow`, 1280×800, custom hidden title bar. It loads
  the Vite server in dev (`http://localhost:5173` by default) and
  `dist/index.html` in a packaged build. `contextIsolation: true`,
  `nodeIntegration: false`, DevTools only while unpackaged.
- **The IPC registrar.** All 185 handlers go through one `ipcMain` facade that
  checks the sender and notes a data change after a mutating handler settles.
- **The vault service.** Every renderer call that touches the vault is forwarded to
  `vault-service.ts`.
- **The harness registry**, which decides which companion is active, keeps both
  implementations and publishes status changes; and **the MCP doors**, started when
  a vault opens and rebound when another opens.
- **The stores** — images, chat attachments, onboarding, the companion brief — each
  an engine in vault-core with a thin main-side path.
- **The updater** (launch check, hourly watch, install on request) and **the FX
  refresh loop** (an hourly USD→ZAR read while a vault is open).

Main installs the content guards on the window it creates, denies permissions by
default, and shuts both harnesses down on quit.

### Preload

`apps/desktop/electron/preload.ts` is bundled to CommonJS (an ESM `.js` preload is
silently skipped, leaving the bridge undefined). It exposes one object through
`contextBridge.exposeInMainWorld("lifequest", …)`: 185 `ipcRenderer.invoke` calls
grouped by feature, plus seven push subscriptions (`vault:dataChanged`,
`vault:fileChanged`, `companion:stream`, `companion:statusChanged`,
`update:progress`, `update:decision`, `window:maximizeChanged`). There is no raw
`ipcRenderer`, filesystem or child-process access on it.

The renderer reaches it through `apps/desktop/src/lib/ipc.ts`, whose `api()` throws
a plain error when `window.lifequest` is missing — how a harness page or a browser
tab fails honestly instead of half-working.

### Renderer

React 19 + Vite. It is a single-page app with `HashRouter` (so a `file://` packaged
load works with no history API). It has no Node access: it imports runtime values
from `@lifequest/vault-core/pure` only, and a test
(`src/lib/renderer-vault-imports.test.ts`) fails if a renderer module value-imports
the Node barrel. That rule keeps `node:fs` out of the browser bundle.

`App.tsx` mounts the renderer through a fixed provider tree:

```text
HashRouter
  ThemeProvider
    UpdateProvider            ← the launch's check and the watch's pushes
      UpdateNotice            ← the in-app release notice, above the routes
      CompanionProvider       ← harness status, the ensure, the switcher
        VaultProvider         ← the open vault snapshot, files-changed banner
          LiveDataProvider    ← the revision a dashboard card re-runs on
            AgentsProvider
              AutomationScheduler, SplashGate
              ChatDockProvider
                NavDockProvider
                  ShortcutsProvider
                    WindowTitleBar + AppRoutes
```

## The vault engine: `packages/vault-core`

vault-core is a workspace library, not a service. It has no Electron imports and no
app state; it takes a root path and does the work. It is the only code that knows
the vault layout, and it owns:

- **Paths.** `paths.ts` builds every path in the vault, validates each segment, and
  enforces physical containment and symlink refusal (see
  [Security](./29-security.md)).
- **Create and open.** `create-vault.ts` seeds the base area **Life** plus the five
  locked areas, the doctrine files, `.lifequest/` and the onboarding record;
  `open-vault.ts` reads it back into the UI's snapshot.
- **Areas and liveness.** `domains.ts` owns create/update/archive/delete and the
  `unlockedAt` lock; locked areas are filtered out of every read and write by the
  liveness hinge rather than by each caller remembering.
- **Documents, records and databases.** Doctrine and library Markdown with
  frontmatter and atomic writes; goals, map, projects, reviews, daily notes, Ideal
  State, Quick Notes, pages, pins, boards, automations, Decisions, the companion
  brief; area SQLite, saved views, the Finance kit, books export/restore, ingest.
- **Onboarding and images.** `onboarding.ts` owns the record, validator, confirm
  batch and log event; `images.ts` owns `images/files/`, the library index and the
  Vision board document.
- **Log.** `.lifequest/log.jsonl`, appended with the actor on every governed write.
- **The MCP tool definitions and their execution** (`ALL_TOOL_DEFS` in
  `src/index.ts`, with one module per family). The same layer serves both the
  companion (as the operator) and connected agents (through their grant).

Main imports the Node barrel `@lifequest/vault-core`; the renderer imports
`@lifequest/vault-core/pure`.

## The vault service

`apps/desktop/electron/vault-service.ts` is main's façade over vault-core:
deliberately boring, one open vault and one queue.

- It holds `currentRoot`, `currentVaultId` and `currentLens`, and every call is
  serialised through `enqueue`, so two writes never interleave inside the engine. A
  call with no vault open returns `{ ok: false, error: "No vault is open" }`.
- Opening a vault does more than read files. `rememberOpen` records the recent
  vault, restores its saved lens, starts (or rebinds) both MCP doors, and writes the
  companion bearer into the Hermes profile — only when the local door actually
  bound. Linked databases then sync in a try/catch, because a sync failure must not
  block the open.
- It is the only caller of the onboarding batch and the images/attachment stores,
  so those writes sit on the same queue as every other write.
- `vaultGetSnapshot` re-reads the vault and captures doctrine mtimes, which decides
  the *Files changed on disk* banner.

Everything the renderer can do to the vault is a function on this module; `main.ts`
is the only place that maps a channel onto it.

## IPC: two directions

**Invoke (renderer → main → answer).** 185 channels, named by feature area:

| Prefix | Examples |
|---|---|
| `vault:` / `domain:` | `vault:open`, `vault:getSnapshot`, `domain:create`, `domain:unlock` |
| `db:` | `db:list`, `db:create`, `db:upsertRow`, `db:restoreBooks` |
| `page:` / `script:` / `document:` / `library:` | `page:update`, `script:apply`, `document:save`, `library:update` |
| `signalChain:` / `map:` / `goals:` | `signalChain:create`, `map:apply`, `goals:apply` |
| `review:` / `note:` / `planning:` | `review:write`, `review:markDone`, `note:write` |
| `images:` / `attachment:` / `brief:` | `images:save`, `attachment:attach`, `brief:dismiss` |
| `onboarding:` / `companion:` | `onboarding:start`, `onboarding:confirm`, `companion:useHarness` |
| `connectedAgents:` / `agents:` / `settings:` / `update:` / `log:` | `connectedAgents:invite`, `agents:hire`, `settings:update`, `update:check`, `log:list` |

**Push (main → renderer).** A small, fixed set. `vault:dataChanged` carries only a
revision number: something a dashboard card reads has been written.
`update:decision` carries the watch's latest answer. The renderer reads on mount and
re-runs what is on screen when main announces a change; it does not poll on a timer.

## The agent harness seam

One companion contract, two implementations, and the rest of the app calls it.

- `harness/agent-harness.ts` defines `AgentHarness`: `id` (`hermes` | `pi`), a
  `displayName`, `kind` (`external` | `embedded`), ensure/status/shutdown, sessions,
  `modelCatalog`, `chatStream`, `approve`, `stopRun` and `steerRun`. Hermes-only
  profile facts live on a separate `ProfiledHarness`, so Pi is not asked to pretend
  it has a profile.
- `harness/types.ts` owns the wire shapes the renderer reads (`HarnessStatus`,
  `HarnessSummary`, `ChatTurnRequest`), so a new companion does not teach the
  renderer a second dialect. A `ready` status carries its `harness` id and a human
  sentence in `detail`.
- `harness/registry.ts` holds the active choice (one per app, stored in prefs). A
  stored choice wins; with none, a machine whose Hermes works and has no Pi
  endpoint keeps Hermes, and everything else lands on Pi. `switchHarness` flips the
  choice at once and lets the new agent's `ensure` land on the status bus — the
  studio is never thrown back to the connect screen by a switch.
- `harness/status-bus.ts` tags each status with its harness, so a late answer from
  the agent you left cannot overwrite the one you are on.

**PiHarness** runs `@earendil-works/pi-agent-core` in main with no CLI, gateway port
or profile. Its endpoint/model/provider come from `pi-endpoint.json`, its key from
`pi-endpoint.key`, and its catalog from the endpoint's own `GET /models`. Its only
tools are the MCP door's — there is no filesystem tool to talk around them — and its
transcripts are one JSON file per chat under `pi-sessions/`.

**HermesHarness** keeps the external gateway: CLI discovery, the `lifequest`
profile, `SOUL.md`, the `mcp_servers.lifequest` entry with the vault bearer, the
gateway on `8642`, and `/p/lifequest`.

## Companion lifecycle

1. **Hydrate the choice, then ensure.** Boot reads the stored harness before the
   first window asks for a status. The renderer's `CompanionProvider` calls
   `companion:ensure` at mount; main serialises ensures so a Recheck, a second
   window or React StrictMode cannot run two at once.
2. **Pi's ensure** reads the endpoint and key. No model, or no key on a non-loopback
   endpoint, is `needs_setup` with the reason; then it probes `GET /models`. A
   401/403 is `auth_error`, an unreachable endpoint is `disconnected`, and a model
   missing from the catalog raises the model warning after `ready`.
3. **Hermes's ensure** finds the CLI, owns the profile, attaches if the host serves
   it, hot-serves the profile if the host is up but not serving it, and starts a
   gateway only when there is none (`needs_install`, `profile_error`, `port_busy`,
   `gateway_exited`, `hermes_too_old`, `auth_error`, `disconnected` otherwise).
4. **The boot gate.** Until a companion has answered `ready` once, anything else
   replaces the studio with the setup surface; after that a switch is a status on
   the surface, not a teardown.
5. **One turn.** The composer calls `companion:chatStream`; main builds the turn
   (instructions and page context, focused cards, attachments, the receipt, runtime
   model pick) and streams events on `companion:stream`. `steerRun` and queue hand
   guidance to a live turn; tool calls run in main against the vault service.
6. **Shutdown.** On quit both harnesses are asked to shut down; a Hermes gateway the
   app did not start is not killed.

## The MCP server and its tool families

Two loopback doors, both bind `127.0.0.1` and speak Streamable HTTP MCP on
`POST /mcp`. `mcp-server.ts` owns the app-level state — ports, secrets directory,
which vault is served, what Settings sees on a bind failure. `pairing-door.ts` owns
the listeners, auth, request limits, the pairing Decision flow and tool dispatch.

The tool surface is one list, `ALL_TOOL_DEFS`, assembled from fourteen families:

| Family | Examples |
|---|---|
| map and goals | `get_state`, `get_week`, `get_doctrine`, `create_task`, `move_task`, `list_goals` |
| database | `list_databases`, `list_rows`, `upsert_row`, `insert_rows`, `delete_row`, `add_column` |
| views and dashboard | `get_dashboard`, `preview_view`, `save_view`, `arrange_dashboard` |
| documents / reviews | `get_document`, `update_document`, `write_review`, `mark_review_done` |
| pages / signal / notes / capture / script / projects | `list_pages`, `create_signal`, `get_daily_note`, `capture_transaction`, `run_script_block`, `get_project` |
| brief / onboarding | `get_companion_brief`, `set_companion_brief`, `propose_onboarding_unlock` |

The same door serves two kinds of caller. The companion is authorised as the
operator with the whole vault — Pi connects from inside main with the vault's
companion token, Hermes through its profile header. A connected agent is authorised
by its grant (read or write, which areas, schedule) and its writes to governed
surfaces file Decisions instead of applying.

## The onboarding engine

A new vault gets `.lifequest/onboarding.json` with `status: "not_started"`; a vault
with no file reads as completed, so existing vaults never see a first-run card. The
dock's **Welcome to LifeQuest** card offers **Begin the interview**; the companion's
`propose_onboarding_unlock` validates a proposal (1–3 seeded, still-locked areas,
four non-empty doctrine bodies, at most one table of 1–8 typed columns, one note),
writes it to `.lifequest/onboarding-proposal.json`, and applies it: unlock, doctrine
drafts, table, `First conversation — <date>` note, `onboarding.completed` with the
manifest, and the proposal kept as the receipt the card announces. Every step is
idempotent, a rejected proposal writes nothing, and a mid-batch failure leaves the
record in progress for a retry.

## Data revision: why a card repaints

The reported bug this exists for: "I told the agent to log an expense and the card
did not show it." The spec was a live query and the query was right; nothing asked
it to run again.

`apps/desktop/electron/data-revision.ts` is a counter and two lists.

- There are exactly two write doors: the IPC channels in main, and the MCP door's
  tool calls. Both are classified **by name**.
- The IPC list is the explicit set of channels that can change what a card reads
  (`MUTATING_CHANNELS`, including `settings:update` for currency and FX rate, and
  the images/onboarding/brief writes). An unlisted channel is assumed to read only
  — the safe direction, because reads re-enter the same registrar.
- The MCP list is inverted: `READ_ONLY_TOOLS` names the discovery tools and
  **anything else is treated as a write**, so a wrong guess costs one repaint.
- Once a handler settles — even one that threw after writing — main bumps the
  revision and broadcasts one coalesced `vault:dataChanged` per frame.

`LiveDataProvider` turns that into a number a card depends on, and also bumps on two
non-write events: the local date changing (so "today" means today) and the window
regaining focus (edits by another program, a sync client, or a second copy).

## Routing and sheets

`App.tsx` declares the routes. Everything below is a hash route.

| Route | Page |
|---|---|
| `/welcome` | Welcome (no vault open) |
| `/home`, `/data`, `/pages`, `/images` | Dashboard, Data, Pages, Images |
| `/chain`, `/notes`, `/automations` | Quick Notes, Daily Journal, Automations |
| `/dream`, `/vision`, `/ideal-state` | Define pages and their editors |
| `/goals`, `/projects`, `/chart` | Goals, Projects, Life Map |
| `/track`, `/act`, `/daily` | Architecture, Task Manager, Daily Schedule |
| `/review/:cadence`, `/documents`, `/log`, `/personnel` | Review, Documents, Log, Agents |
| `/decisions`, `/settings` | Sheets over the page you were on |
| `/` and `*` | Redirect to `/home` with a vault, `/welcome` without |

`/domains` redirects to `/settings?tab=domains`. Settings and Decisions are not
pages: the route stays mounted and the sheet paints above it, so closing one returns
you to the page and state you left. The companion gate lives in `AppRoutes`; until a
companion answers `ready` once, the setup surface renders instead of the studio.

## Rules and behaviour

- **One vault at a time.** Opening another rebinds the doors and swaps the root; there is no multi-vault window and no tenancy.
- **One write queue**, serialised in the vault service, so two writes never race.
- **Two write doors, one signal.** IPC and MCP are the only ways in, which is what
  makes the revision counter trustworthy.
- **One companion contract, two implementations.** The renderer reads a status and
  calls the same channels; it never learns which transport is underneath.
- **The renderer cannot reach the disk, the engine cannot reach Electron**: bridge
  calls on one side, plain Node on the other.
- **The packaged app is a bundle**, not a source tree: `app.asar` holds `dist/`,
  `dist-electron/` and the desktop `package.json`, and no `node_modules`.

## Related

- [Overview](./01-overview.md)
- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [The Companion](./24-companion.md)
- [Security](./29-security.md)
- [Development](./31-development.md)
