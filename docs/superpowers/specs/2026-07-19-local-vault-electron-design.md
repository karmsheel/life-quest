# LifeQuest Local Vault (Electron) — Design Spec

**Date:** 2026-07-19  
**Status:** Approved in design session; awaiting user review of this written spec before implementation planning  
**Product:** LifeQuest — local-first life-management studio with Hermes agents  
**Supersedes (runtime):** Web multi-user Next.js + Prisma + SQLite as the product host  
**Preserves (product IA):** Skeleton Domains / Why→What→How / rooms / Decisions / Life log / Personnel / Hermes chat from [2026-07-17 skeleton design](./2026-07-17-lifequest-skeleton-design.md)

---

## 1. Purpose

LifeQuest becomes a **desktop app** whose source of truth is a **user-chosen vault directory**: human-readable folders and Markdown for doctrine, plus small git-friendly JSON/JSONL files for structured app state. There are **no cloud accounts**. Opening a vault is identity.

### Why pivot

The Vercel deploy failed with Prisma `DATABASE_URL` missing. That is not a one-line env fix for the intended product:

| Constraint | Web on Vercel | Desired knowledge base |
|------------|---------------|------------------------|
| Durable local SQLite | Poor fit (ephemeral FS) | Not needed if vault is files |
| User’s local folder | Server cannot see it | **Is** the product |
| Multi-user email auth | Fits SaaS | Fights personal vault |

**Success thesis (updated):** Users pick a folder. LifeQuest seeds Domains as directories with Why / What / How Markdown files. Governance (forge + Decisions), Life log, and agent roster live beside those files in a prescribed, git-native layout. Hermes remains a local BYOK gateway; API keys never enter the vault.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Runtime | **Electron** desktop (local-first) |
| 2 | UI stack | **Electron + Vite + React** greenfield |
| 3 | Prior web app | **Archive**; not the product runtime |
| 4 | Identity | **Vault is identity** — no sign-up / sign-in |
| 5 | Doctrine storage | **Folders + `.md`** per domain pillars |
| 6 | Structured storage | **Git-native JSON / JSONL** (no Prisma/SQLite in v1) |
| 7 | Secrets | **Electron `safeStorage` / OS keychain**, keyed by vault id |
| 8 | Vault schema | **Prescribed LifeQuest layout**; Obsidian-style looseness is **not** a v1 promise |
| 9 | Vercel | Not app host; optional static marketing later |
| 10 | Seed domains | Health, Intellectual, Emotional, Financial |
| 11 | External file edits | On window focus: mtime check + reload prompt (no CRDT) |
| 12 | Legacy DB import | **Not** required for v1 |
| 13 | Packaging | Dogfood via dev first; electron-builder when features are usable |
| 14 | Room unlock | Unchanged: non-empty prior pillar body unlocks next room |
| 15 | Docs per domain | Exactly one Why, What, How |
| 16 | Hermes | Main-process proxy to user gateway; key in secure storage |

### Explicitly out of scope (v1)

- Multi-user / email auth / cookie sessions  
- Prisma, SQLite, `DATABASE_URL`, Vercel-hosted live app  
- Full Obsidian interop / wiki-link graph as a guarantee  
- Whole-vault encryption  
- Automatic migration from `prisma/dev.db`  
- Cloud sync / multi-device  
- Shared multiplayer Domains  
- Electron auto-update infrastructure (can add later)

---

## 3. Architecture

### 3.1 Process model

```
┌──────────────────────────────────────────────────────────┐
│ Electron main                                            │
│  • Native open/create directory dialogs                  │
│  • Vault FS (read, atomic write, seed, validate)         │
│  • Recent vault list in app userData                     │
│  • safeStorage for Hermes API key (by vault id)          │
│  • HTTP proxy to Hermes gateway (OpenAI-compatible)      │
└────────────────────────┬─────────────────────────────────┘
                         │ contextIsolation + preload IPC
┌────────────────────────▼─────────────────────────────────┐
│ Renderer (Vite + React)                                  │
│  • Shell IA: domains, rooms, documents, decisions,       │
│    life log, personnel, settings, theme                  │
│  • No direct Node FS; no Prisma; no Next API routes      │
└────────────────────────┬─────────────────────────────────┘
                         │ files on disk
┌────────────────────────▼─────────────────────────────────┐
│ User vault directory (git-friendly source of truth)      │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Security baseline

- `contextIsolation: true`, `nodeIntegration: false`  
- Preload exposes a **typed, minimal** API (vault, secrets, hermes, dialogs)  
- Renderer never receives raw Node `fs`  
- Reject path traversal: all vault operations resolve under the opened vault root  

### 3.3 Repository layout (target)

```
life-quest/
  apps/desktop/              # Electron main, preload, Vite React renderer
  packages/vault-core/       # Pure TypeScript vault schema + FS helpers (Node tests)
  archive/web-skeleton/      # Relocated Next+Prisma app (or documented historical)
  docs/superpowers/specs/
  docs/superpowers/plans/
```

Implementation may introduce workspace tooling (`package.json` workspaces) when the second package lands. **Salvage** pure logic and CSS tokens from the current tree; do not keep Prisma/auth as dependencies of the desktop app.

### 3.4 Rejected alternatives

| Alternative | Why rejected for v1 |
|-------------|---------------------|
| Stay on Vercel + “folder metaphor” only | User asked for real local directory as main folder |
| Browser File System Access API only | Weak multi-browser support; permissions fragile; no solid main-process Hermes proxy |
| Electron + Next server | Heavier; unnecessary for local FS UI |
| SQLite sidecar in vault | Fights git-native preference |
| Pure Obsidian freeform vault | Weak invariants for rooms, forge, decisions |

---

## 4. Vault layout

### 4.1 Tree

```
<vault-root>/
  lifequest.json
  README.md                          # optional template on create
  domains/
    <slug>/
      domain.json
      why.md
      what.md
      how.md
  .lifequest/
    settings.json                    # non-secret
    agents.json
    log.jsonl
    decisions/
      <decision-id>.json
```

### 4.2 `lifequest.json`

```json
{
  "schemaVersion": 1,
  "id": "<uuid>",
  "name": "Personal",
  "createdAt": "<ISO-8601>"
}
```

- `schemaVersion` must be `1` for this spec. Unknown versions → refuse open with a clear error.  
- `id` is stable for keychain keying and recent-vault entries.  

### 4.3 `domains/<slug>/domain.json`

```json
{
  "name": "Health",
  "description": null,
  "color": null,
  "sortOrder": 0,
  "archivedAt": null,
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>"
}
```

- **Slug** is the directory name: lowercase kebab-case (`health`, `intellectual`).  
- Rename display name updates `domain.json` only; renaming the folder/slug is a separate operation (update path + any references by slug).  
- Active domain is **not** stored in the vault; it is app userData keyed by vault `id` (last-used slug).  

### 4.4 Doctrine files (`why.md` / `what.md` / `how.md`)

YAML frontmatter + Markdown body:

```markdown
---
title: Why
status: draft
forgedAt: null
updatedAt: 2026-07-19T12:00:00.000Z
---

Body text here…
```

| Field | Rules |
|-------|--------|
| `title` | string; default kind label |
| `status` | `draft` \| `refined` \| `forged` |
| `forgedAt` | ISO string or `null` |
| `updatedAt` | ISO string; set on every successful write |

**Status transitions** (unchanged from skeleton):

- `draft` → `refined` or `forged`  
- `refined` → `forged`  
- `forged` is read-only in the editor; changes go through Decisions  

**Room unlock** (unchanged):

| Condition | Unlocks |
|-----------|---------|
| Domain exists | Dream |
| Why body non-empty (trim) | Chart |
| What body non-empty | Track |
| How body non-empty | Act |

### 4.5 `.lifequest/settings.json`

Non-secret only, for example:

```json
{
  "hermesBaseUrl": "http://localhost:8642",
  "theme": "system"
}
```

Hermes **API key is never written here**.

### 4.6 `.lifequest/agents.json`

```json
{
  "hires": [
    {
      "id": "<uuid>",
      "hermesAgentId": "...",
      "name": "...",
      "roleLabel": null,
      "domainSlug": null,
      "status": "active",
      "createdAt": "<ISO-8601>",
      "dismissedAt": null
    }
  ]
}
```

### 4.7 `.lifequest/log.jsonl`

One JSON object per line, append-only. Example line:

```json
{"id":"<uuid>","domainSlug":"health","type":"domain.created","summary":"Created domain Health","payload":{"name":"Health"},"createdAt":"<ISO-8601>"}
```

No product update/delete of prior lines in v1.

### 4.8 `.lifequest/decisions/<id>.json`

```json
{
  "id": "<uuid>",
  "domainSlug": "health",
  "documentKind": "why",
  "status": "pending",
  "title": "...",
  "rationale": null,
  "proposedBodyMarkdown": "...",
  "previousBodyMarkdown": "...",
  "createdAt": "<ISO-8601>",
  "resolvedAt": null
}
```

- **Approve:** write `proposedBodyMarkdown` into the target pillar file (preserving/updating frontmatter; status stays `forged` unless product rules say otherwise — forged docs remain forged after accepted revision), set decision `status` to `approved`, set `resolvedAt`.  
- **Reject:** set `status` to `rejected`, set `resolvedAt`; do not change doctrine file.  

### 4.9 New vault seed

On create:

1. Write `lifequest.json` with new uuid and `schemaVersion: 1`.  
2. Create `.lifequest/` with empty `agents.json`, empty `log.jsonl`, empty `decisions/`, default `settings.json`.  
3. Create four domains (slugs `health`, `intellectual`, `emotional`, `financial`) with empty-bodied pillar files `status: draft`.  
4. Optionally write a short root `README.md` explaining the tree.  
5. Append life-log events for domain creation.  
6. Set active domain to `health` in userData.  

### 4.10 Open existing vault

1. Require `lifequest.json` with `schemaVersion === 1`.  
2. Scan `domains/*/domain.json` + pillar files; tolerate missing optional fields with defaults.  
3. Repair is **not** aggressive in v1: missing pillar file may be recreated empty on explicit “repair” or domain open — prefer clear errors over silent rewrite of user content.  
4. Load last active domain slug from userData if still present and not archived.  

---

## 5. App data outside the vault

Stored under Electron `app.getPath('userData')`:

| Data | Purpose |
|------|---------|
| Recent vaults | `{ id, name, path, lastOpenedAt }[]` |
| Active domain slug per vault id | Session continuity |
| Window bounds / UI chrome prefs (optional) | UX |
| Encrypted Hermes API key per vault id | `safeStorage.encryptString` |

If `safeStorage` is unavailable, show a clear Settings error and allow paste-per-session fallback only if implemented; default path is refuse to persist insecurely.

---

## 6. IPC surface (conceptual)

Names are indicative; implementation plan will freeze exact channels.

| Channel group | Examples |
|---------------|----------|
| Vault | `vault:create`, `vault:open`, `vault:getState`, `vault:listRecent` |
| Domains | `domain:list`, `domain:create`, `domain:update`, `domain:archive`, `domain:setActive` |
| Documents | `document:get`, `document:save`, `document:setStatus` |
| Decisions | `decision:list`, `decision:create`, `decision:resolve` |
| Log | `log:list` (read tail / all), writes only via domain operations |
| Agents | `agents:list`, `agents:hire`, `agents:dismiss` |
| Secrets | `secrets:setHermesKey`, `secrets:hasHermesKey`, `secrets:clearHermesKey` |
| Hermes | `hermes:test`, `hermes:chat`, `hermes:scanAgents` |
| Dialog | `dialog:openDirectory` |

All mutating calls return `{ ok: true, ... } | { ok: false, error: string }`.

---

## 7. Integrity and concurrency

1. **Atomic write:** write to `*.tmp` in the same directory → `rename` over target.  
2. **Serialize mutations** per vault in main process (queue) to avoid interleaved writes.  
3. **External edits:** on focus, compare mtimes for loaded files; if changed, prompt “Reload from disk?”  
4. **No multi-window vault writers** required in v1; single window is enough.  
5. **Git:** users may commit the vault; document that `.lifequest/log.jsonl` and decision files can conflict on merge — prefer single-writer workflow.

---

## 8. UI / information architecture

Preserve skeleton shell intent:

- Nav: Domain switcher, Home, Dream / Chart / Track / Act, Documents, Personnel, Decisions, Life log, Settings  
- Room lock affordances from unlock helpers  
- Document editor with status badge; forged → propose change  
- Decisions inbox  
- Life log feed  
- Personnel scan + hire/dismiss  
- Settings: theme, Hermes base URL, API key (secure), vault path display  

**Entry flow (replaces sign-in):**

1. Welcome: **Create vault** / **Open vault** / recent list  
2. After open → Home (or last route) with active domain  

No `/sign-in` or `/sign-up`.

---

## 9. Hermes

- Base URL from `.lifequest/settings.json` (default `http://localhost:8642`).  
- API key from secure storage.  
- Main process performs fetch to gateway (chat, health/test, agent list paths as in skeleton).  
- Renderer never holds the key in long-lived global state after send (may keep “has key” boolean).  
- Skeleton depth: connection + chat + scan; no tool-use / pillar injection required for v1 parity.

---

## 10. Testing strategy

| Layer | What |
|-------|------|
| `vault-core` unit | Seed vault, frontmatter round-trip, status transitions, unlock, decision apply, domain scan, atomic write |
| Renderer unit | Pure UI helpers if any |
| Manual / smoke | Create vault, edit Why, forge, propose decision, approve, confirm file on disk; Hermes test if gateway up |

CI should run `vault-core` tests without Electron if possible.

---

## 11. Archive and communication

- Relocate or clearly mark the Next+Prisma app as **archived web skeleton**.  
- Root README: LifeQuest is a **desktop** app; clone, install, run Electron; vault is the data.  
- GitHub / Vercel: stop presenting the Vercel URL as the product (or replace with a static landing that points to desktop instructions).  

---

## 12. Implementation phases (outline only)

Detailed steps belong in the implementation plan after this spec is user-approved.

1. Scaffold monorepo pieces: `packages/vault-core`, `apps/desktop` (Electron + Vite + React)  
2. Vault create/open/seed + unit tests  
3. Domain + document IPC + editor UI  
4. Room unlock + shell navigation  
5. Decisions + life log  
6. Personnel + Hermes proxy + secure key  
7. Archive web skeleton + README  
8. Optional packaging  

---

## 13. Spec self-review checklist

| Check | Result |
|-------|--------|
| Placeholders | None intentional; IPC names marked conceptual until plan freezes them |
| Consistency | Vault layout, identity, secrets, and Electron architecture agree |
| Scope | Single product pivot; phased but one design |
| Ambiguity | Active domain in userData (not vault); approve keeps forged status; schemaVersion hard-fail |

---

## 14. Success criteria (DoD for pivot v1)

1. Create a vault in a chosen folder; four domain folders and empty pillar `.md` files appear on disk.  
2. Edit and save Why/What/How; content matches files opened in an external editor.  
3. Room unlock follows non-empty body rules.  
4. Forge + Decision approve updates the doctrine file on disk.  
5. Life log appends JSONL lines for meaningful events.  
6. Hermes key is not present in any vault file; chat works when gateway is up.  
7. No Prisma / `DATABASE_URL` in the desktop dependency path.  
8. README documents desktop workflow; web skeleton is archived or clearly historical.
