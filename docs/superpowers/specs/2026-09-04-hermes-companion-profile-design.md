# LifeQuest — Hermes Companion Profile — Design Spec

**Date:** 2026-09-04  
**Status:** Approved — awaiting implementation plan  
**Product:** LifeQuest — local-first life-management studio  
**Extends:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Life Map on Chart](./2026-08-27-life-map-chart-design.md)  
**Supersedes (desktop chat path):** in-process planner loop (`runPlannerLoop` / `hermes:chatTools`) as the Chat panel transport; vault `hermesBaseUrl` + `safeStorage` key as the companion connection  
**Does not supersede:** MCP tool bus, map command `actor: "agent"`, agent lock, Personnel hire roster (left as a stub)  
**Follow-up (out of this spec):** hire/import of the user’s other Hermes gateways

**Reference:** [Hermes programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration), [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles); Berd’s host/harness split ([block/berd](https://github.com/block/berd)) as product analogy, not a runtime.

---

## 1. Purpose

LifeQuest’s Chat panel is a thin OpenAI client. Electron runs an 8-round planner loop, executes map tools itself, and keeps transcripts in React state. Personnel “hire” is a roster label. That is not a Hermes Agent harness.

This spec makes **one required in-app companion**: a named Hermes **profile** (`lifequest`) that LifeQuest talks to through the **Sessions API**. Hermes owns the loop, memory, skills, and transcripts. LifeQuest owns the vault, MCP tools, lock, and UI. The same profile remains usable from Hermes Desktop and from that profile’s messaging gateway.

Hire/import of other gateways is a later spec. This spec is companion-only.

### Success thesis

A user who has Hermes installed can open LifeQuest, get a `lifequest` profile created and connected, and talk to that agent in the Chat panel. Turns persist in the profile so they also appear in Hermes Desktop. Map writes still go through LifeQuest MCP and the agent lock. If Hermes Desktop already holds the profile gateway, LifeQuest attaches and does not kill it on quit.

### Success criteria

- Cold start does not enter Welcome/shell until companion status is `ready` (or the user is on the first-run gate with a recoverable error).
- Missing `hermes` CLI → `needs_install` with official install instructions and Recheck. No bundled binary.
- Profile `~/.hermes/profiles/lifequest` exists after a successful first-run (Windows: `%USERPROFILE%\.hermes\profiles\lifequest` unless `HERMES_HOME` is set).
- That profile’s API listens on **8644** by default (never 8642 or 8643). MCP stays **8643**.
- Chat panel lists/resumes Hermes sessions, streams tokens and tool rows, and does not write transcript files into the vault.
- Gateway already up on the profile port → attach; LifeQuest quit leaves it running. Gateway down → LifeQuest starts `hermes -p lifequest gateway` and stops that child on quit only if we started it.
- Locked map: companion MCP writes fail with `LOCKED`; the stream shows the tool failure.
- `npm test` and `npm run typecheck` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Agent type in this spec | **Companion only.** One required in-app agent. |
| 2 | Companion identity | Hermes **profile** named `lifequest` (`HERMES_HOME` = `{hermesRoot}/profiles/lifequest`). Not a private sidecar home under LifeQuest `userData`. Not the default `~/.hermes` profile. |
| 3 | Transcript source of truth | **Hermes profile** (`state.db` / Sessions API). Vault stores map, doctrine, log, hire stubs — not chat JSON. |
| 4 | Host protocol | **Hermes Sessions API** over HTTP to the profile gateway: `/api/sessions`, `/messages`, `/chat/stream`. Not ACP. Not Chat Completions with LifeQuest-supplied tools. |
| 5 | Who runs the loop | **Hermes.** LifeQuest does not run `runPlannerLoop` for the Chat panel. Hermes calls LifeQuest MCP for vault/map tools. |
| 6 | Gateway lifecycle | **Attach if up, start if not.** Stop the child on quit only if `startedByLifeQuest` and the PID is still ours. |
| 7 | First-run | **Detect CLI → create profile → enable API → register MCP → probe/start gateway.** Do not bundle or silently install Hermes. |
| 8 | App gate | Companion must be `ready` **before** Welcome / open-vault / shell. The companion can help explain vault setup; vault MCP tools error until a vault is open. |
| 9 | Ports | Default Hermes **8642** (untouched). LifeQuest MCP **8643** (unchanged; if busy, fail as today). Companion API **8644**. If 8644 is another process, pick the next free port, persist it in the profile `.env`, never steal 8642/8643. |
| 10 | Auth | Profile `API_SERVER_KEY` in `profiles/lifequest/.env`. Main reads it. Renderer never receives it. Do not copy it into the vault or into `safeStorage`. |
| 11 | MCP | Register `http://127.0.0.1:8643/mcp` on **this profile only**. Merge into `config.yaml`; do not clobber other `mcp_servers`. |
| 12 | Seeded persona | On **create**, if `SOUL.md` is missing or empty, write a LifeQuest companion SOUL (help with LifeQuest, use MCP for map, do not flip lock, do not rewrite Why/What/How). Never overwrite a non-empty SOUL on later boots. |
| 13 | Per-turn context | `instructions` (or Sessions equivalent): active domain name/slug, About me, lock boolean, vault open or not. Do not send Why/What/How bodies; the model uses `get_doctrine`. |
| 14 | Memory scoping | Do **not** set a LifeQuest-only `X-Hermes-Session-Key` that fragments Honcho/memory from Desktop/channels. Same profile, one memory. |
| 15 | Chat UX | Docked Chat panel is a session client: list/create/resume, stream deltas, tool-activity rows, composer. Last session id stored in app `userData`. |
| 16 | Approvals | If the stream requests approval, the panel shows Allow once / Deny. No `allow_always` in this spec. If Hermes never emits approval events, no extra UI. |
| 17 | Settings → Hermes | Companion status and retry (CLI, profile path, port, attach vs started-by-us, last error, open profile folder, test). SOUL/model editors are a follow-up on this page. |
| 18 | Old vault Hermes URL/key | **Not** the companion path. Leave files/keys in place; Chat panel ignores them. |
| 19 | Act / Personnel | **Unchanged** in this spec. Hire roster stays a stub. `hermes:chatTools` may remain for Act until the hire spec. |
| 20 | Default user Hermes | Profile `default` on 8642 is not the companion. LifeQuest does not reconfigure it. |

### Explicitly out of this spec

- Hire/import of other Hermes gateways, profiles, or ACP commands  
- ACP sidecar (`hermes acp`) as the LifeQuest host protocol  
- Vault-side transcript database or dual-write of chats  
- Bundling or auto-installing the Hermes CLI  
- Stopping a gateway LifeQuest did not start  
- Writing into `~/.hermes/config.yaml` (default profile) for MCP or API  
- Companion SOUL/model GUI editors (status + retry only)  
- Act hire dispatch, Personnel scan/hire wiring to real connections  
- Falling back to `runPlannerLoop` when Sessions API is missing  
- Changing MCP bind address/port policy (still 127.0.0.1:8643, fail if in use)  
- Doctrine writes, forge, Decisions, or flipping the agent lock via the companion  

---

## 3. Architecture

LifeQuest is a **session client** of a dedicated Hermes profile. It does not store chat transcripts in the vault.

```text
┌─────────────────────────────────────────────────────────┐
│  LifeQuest (Electron)                                   │
│  • First-run gate until companion is ready              │
│  • Chat panel = Hermes Sessions API client              │
│  • MCP server :8643  (map/tasks, actor: agent, lock)    │
│  • Starts profile gateway only if nothing is listening  │
└────────────┬──────────────────────────┬─────────────────┘
             │ HTTP                     │ MCP (tools)
             ▼                          ▼
┌─────────────────────────────────────────────────────────┐
│  hermes -p lifequest gateway                            │
│  HERMES_HOME = {hermesRoot}/profiles/lifequest          │
│  API  :8644 (or next free, never 8642/8643)             │
│  sessions, memory, SOUL.md, skills live here            │
│  same process Desktop / Telegram can already own        │
└─────────────────────────────────────────────────────────┘
```

**Rejected**

- ACP subprocess: fights Hermes Desktop and the messaging gateway on the same profile; ACP sessions are process-local.  
- Chat Completions + LifeQuest tools: keeps the in-process planner; Hermes is not the harness.  
- Isolated `HERMES_HOME` under LifeQuest `userData`: blocks Desktop and other channels.  
- Using the default gateway on 8642: mixes the companion with the user’s other agent.

**Hermes root**

When the CLI is present, create and launch with `hermes profile create lifequest` and `hermes -p lifequest gateway` so Hermes resolves `HERMES_HOME` itself. For file reads/writes (`.env`, `config.yaml`, `SOUL.md`), the profile directory is `{hermesRoot}/profiles/lifequest` where `hermesRoot` is `process.env.HERMES_HOME` if it points at a Hermes root (contains `profiles/` or `config.yaml` at that path), otherwise `%USERPROFILE%\.hermes` (Windows) or `~/.hermes`. Do not treat an already-named profile path as the root (if `HERMES_HOME` ends with `profiles/<name>`, walk up to the Hermes root).

---

## 4. Components

### 4.1 Electron main — companion module

New module `apps/desktop/electron/companion.ts` (spawn/lifecycle may sit in a sibling `companion-process.ts` if the file splits). Responsibilities:

- Resolve `hermes` on PATH (`hermes` / `hermes.cmd` on Windows).  
- Ensure `{hermesRoot}/profiles/lifequest` exists.  
- Ensure profile `.env` contains `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT` (8644 or persisted override), `API_SERVER_KEY` (generate once, preserve).  
- Merge MCP server `lifequest` → `http://127.0.0.1:8643/mcp` into that profile’s `config.yaml` only.  
- Seed `SOUL.md` only when missing or empty.  
- `GET http://127.0.0.1:{port}/health` then `/v1/capabilities`.  
- If down: spawn `hermes -p lifequest gateway` (no extra console window on Windows; stderr tailed to app logs). Set `startedByLifeQuest = true`.  
- If up: attach; `startedByLifeQuest = false`.  
- On quit: stop the child only if the flag is set and the PID is still the one we spawned.  
- IPC for status, setup/retry, session list/create/resume, chat stream. Renderer never gets the API key.

MCP server start/stop stays as today (vault open / close). Companion setup does not require a vault.

### 4.2 Session client

Main-process HTTP client to the profile API:

| Method | Path | Use |
|--------|------|-----|
| GET | `/health` | Liveness |
| GET | `/v1/capabilities` | Require session list + `chat/stream` |
| GET | `/api/sessions` | Session switcher |
| POST | `/api/sessions` | Create (`title`: `LifeQuest` or `LifeQuest · {vault name}`) |
| GET | `/api/sessions/{id}/messages` | Hydrate panel |
| POST | `/api/sessions/{id}/chat/stream` | Turn + SSE |
| POST | `/v1/runs/{id}/approval` | Only if an approval event arrives |

Stream events forwarded over IPC: `assistant.delta`, `tool.started`, `tool.completed`, `run.completed`, approval request, errors.

Last session id: app `userData` key `companion.lastSessionId`. If that id 404s, create a new session and persist the id. Optional filter in the switcher: prefer titles starting with `LifeQuest`; still show other profile sessions so Desktop-created threads are reachable.

### 4.3 First-run gate

App-level, before Welcome:

1. Splash (existing LifeQuest splash is fine).  
2. Detect CLI → create/attach profile → probe/start gateway → capabilities check.  
3. On `ready`, continue to Welcome / recent vaults / shell.  
4. On error, stay on the gate with the status copy from §6. Recheck runs the same pipeline.

No shell, no Settings overlay, until `ready`. After `ready`, Settings → Hermes is the retry surface if the companion later drops.

### 4.4 Chat panel

Same docked panel. Replace `api().hermesChatTools` with companion session IPC.

- Hydrate from `GET .../messages`.  
- Composer sends `input` plus main-built `instructions`.  
- Render streaming text and tool rows.  
- On `run.completed`, `refresh()` vault snapshot so MCP map writes appear.  
- Session control in the header: current title, list, new session.  
- Approval: Allow once / Deny when requested.

Drop in-process planner use from this panel.

### 4.5 Settings → Hermes

Companion status: CLI found, profile path, port, gateway up, attached vs started-by-us, last error, Recheck, Open profile folder, Test connection. No URL/API-key form for an arbitrary gateway in this spec.

### 4.6 Unchanged

Vault MCP tools, `executeTool` / `actor: "agent"`, agent lock, Personnel hire roster, Act hire dispatch, default profile on 8642.

---

## 5. Data flow

### 5.1 First-run / app start

```text
App start
  → resolve `hermes` on PATH
  → ensure {hermesRoot}/profiles/lifequest
  → ensure profile .env (API on :8644 + key)
  → ensure profile config.yaml (mcp_servers.lifequest → :8643/mcp)
  → seed SOUL.md if empty
  → GET :{port}/health
       ├─ 200 → attach (startedByLifeQuest = false)
       └─ down → spawn `hermes -p lifequest gateway`
                 wait for health → startedByLifeQuest = true
  → GET /v1/capabilities  (session_* + chat/stream required)
  → renderer: companion ready → Welcome / shell
```

### 5.2 A chat turn

```text
User sends in ChatPanel
  → IPC companion:chat { sessionId, input }
  → main POST /api/sessions/{id}/chat/stream
       instructions: active domain, About me, lock, vault open/closed
  → SSE → IPC → panel (tokens + tool rows)
  → Hermes may call LifeQuest MCP
       → executeTool(..., actor: "agent")
       → lock still blocks writes
  → run.completed → renderer refresh()
```

Hermes stores the transcript. LifeQuest does not write chat files into the vault.

### 5.3 Quit

```text
App quit
  → if startedByLifeQuest and PID is ours → stop that child
  → else leave the listener
  → stop MCP as today
```

### 5.4 Settings retry

Same pipeline as first-run from “detect CLI” onward, without leaving the shell.

---

## 6. Error handling

| Status | Cause | User-facing behavior |
|--------|--------|----------------------|
| `needs_install` | `hermes` not on PATH | Official install instructions + Recheck. No spawn. Chat blocked. |
| `profile_error` | Cannot create/write profile dir, `.env`, or `config.yaml` | Path + OS error. Open folder if it exists. Retry. Never “fix” by writing the default profile. |
| `port_busy` | 8644 (or current port) is a different process / non-Hermes health | Do not kill it. Offer change-port: next free port, persist in `.env`, retry. Never 8642 or 8643. |
| `gateway_exited` | Child we started died | Last stderr tail. Composer disabled. Retry respawns (flag stays true). If Desktop came up healthy on the port, attach and clear the flag. |
| `disconnected` | Attached gateway dropped mid-session | Keep rendered messages. Reconnect: health, then `GET .../messages`. Do not auto-spawn if we did not start it; offer Retry (Retry may spawn and set the flag). |
| `hermes_too_old` | Missing session or `chat/stream` capabilities | Block chat. Show `hermes --version` if known. **No planner fallback.** |
| `auth_error` | 401 after one re-read of the profile key | Status + retry. Do not send the key to the renderer. |
| Busy / 409 / 429 | Hermes concurrent-run or conflict | Surface Hermes’s message. Leave the session in place. |
| Stream timeout | No terminal event | Mark the turn failed; user may resend. Do not delete the Hermes session. |

**MCP / lock**

- No vault open: MCP tools return a structured not-open / `NOT_FOUND`. Chat still works for non-vault Hermes tools.  
- Map locked: existing `LOCKED`; tool row fails; assistant can explain.  
- MCP crash: restart on next vault open; companion chat continues without vault tools.

**Quit**

Stop the child only if `startedByLifeQuest` and that PID still exists and still owns the listener. If the PID is gone or a different process is listening, leave it.

**Secrets**

Renderer never receives `API_SERVER_KEY`. Main reads profile `.env` only.

---

## 7. Seeded SOUL.md

Written only when the profile’s `SOUL.md` is missing or empty. Intent (exact copy may be tightened in the plan, not omitted):

You are the LifeQuest companion. Help the user set up and use LifeQuest: vaults, domains, Why → What → How, Life Map, Architecture, tasks, and the agent lock. Prefer LifeQuest MCP tools (`lifequest`) for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Why, What, or How; use `get_doctrine` to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.

---

## 8. Testing

### 8.1 Unit (no Hermes process)

- Profile bootstrap: create `lifequest` home, write `.env` (port 8644, key, API enabled), merge MCP URL into `config.yaml` without clobbering other keys.  
- Do not overwrite non-empty `SOUL.md`.  
- Port policy: never pick 8642 or 8643; `port_busy` chooses the next free port and persists it.  
- Attach vs start: health 200 → do not spawn; health down → spawn and set `startedByLifeQuest`.  
- Quit: stop child only when the flag is set and the PID is still ours.  
- Instruction builder: domain, About me, lock, vault-open; no doctrine bodies.  
- Stream event mapping: SSE → IPC shapes the panel uses.

### 8.2 Main-process integration (fake gateway)

- HTTP stub: `/health`, `/v1/capabilities`, `/api/sessions`, `/chat/stream`.  
- First-run: stub up → attach. Stub down → spawn helper invoked.  
- Chat turn: POST stream, forward deltas/tool events, refresh after `run.completed`.  
- 401 → re-read key, retry once. Missing session features → `hermes_too_old`, no planner fallback.  
- MCP lock: agent writes still return `LOCKED` when the map is locked.

### 8.3 Packaging / PATH

- Companion module does not assume `hermes` sits next to `LifeQuest.exe`. Missing CLI → `needs_install`, no crash.

### 8.4 Manual (before done)

- Hermes installed, profile missing → app creates it, gateway comes up, chat streams.  
- Hermes Desktop already on 8644 → LifeQuest attaches; quit LifeQuest, Desktop still up.  
- LifeQuest started the gateway → quit LifeQuest, 8644 goes down.  
- Map lock on → companion tool write fails in the stream; lock off → map updates after refresh.  
- A LifeQuest turn is visible in Hermes Desktop on the `lifequest` profile.

### 8.5 Out of this spec’s tests

Hire/import, ACP, vault transcript files, Act dispatch via hired agents.

---

## 9. Migration / compatibility

- Chat panel stops calling `hermesChatTools`. Leave `runPlannerLoop` in the tree for Act until the hire spec; do not use it as a companion fallback.  
- Vault `settings.hermesBaseUrl` and vault-scoped Hermes keys remain on disk; companion ignores them.  
- MCP port **8643** policy from the Life Map spec is unchanged.  
- `lifequest.json` `schemaVersion` stays **1**. No new vault files for chats.

---

## 10. Follow-up spec (not this plan)

- Import/hire existing Hermes gateways and profiles (URL, key, `/p/<profile>/`).  
- Personnel as real connections; Act dispatch to a hired agent.  
- Settings editors for companion SOUL and model.  
- Optional ACP later if a second harness is hosted.

---

## 11. Open questions

None. Locked in the brainstorming thread: profile (not sidecar home), Hermes as transcript source of truth, attach-or-start gateway, detect/create first-run, companion-only scope, Sessions API transport.
