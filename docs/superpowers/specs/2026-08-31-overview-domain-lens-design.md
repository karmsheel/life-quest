# Overview Domain Lens — Design Spec

**Date:** 2026-08-31  
**Status:** Approved — awaiting implementation plan  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Life Signal Chain](./2026-08-27-life-signal-chain-design.md), [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md)

Supersedes: the “always a real domain” fallback (first live domain, usually Health); restoring `userData` `activeDomainByVaultId` on launch; seeding the first domain in `rememberOpen`; the Documents page as a Why / What / How index; Signal-Chain’s in-page domain dropdown as a second filter; opening **What** via Life Map (`/chart`).

The wings spec remains in force: wings filter the **rail**, not data. This spec is the data filter.

---

## 1. Purpose

The user should land in **Overview**: the full app and the union of all life data. Each domain tab is a **filter** on that view, not a separate tenancy. Unassigned Signal-Chain events and library notes exist only in Overview until the user files them.

Why / What / How stay per-domain doctrine files. Documents becomes a vault-level markdown library that can carry **many** domain tags, or none.

Plugins installed under a single domain, and file attachments on library notes, are **not** in this spec.

### Success criteria

- Cold start and vault open always select **Overview**. Last tab is session memory only.
- Top-bar switcher is **Overview |** live domains (sort order), same open-button control as the wing tabs.
- Overview shows every record plus unassigned. A domain tab shows only records assigned to that domain. Unassigned never appears in a domain tab.
- Documents is a tagged markdown library (`documents/{id}.md`). Why / What / How are not on that page.
- Dream lists Why and What; Architecture lists How. Opening a row edits that domain’s file and does **not** change the lens.
- `useActiveDomain()` no longer falls back to the first live domain.
- `npm test` in `packages/vault-core` and `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Overview identity | **Virtual lens.** Not a vault domain. Not in Settings → Domains. No folder, rename, or archive. |
| 2 | Switcher | **Overview** first, then live domains by `sortOrder`. Existing `.ui-segmented` radios (`role="radiogroup"`, `aria-label="Domain lens"`). |
| 3 | State | **In-memory session** in renderer and main. Dies on quit. Not written to the vault, `localStorage`, or `userData`. |
| 4 | Cold start | Always Overview. Ignore leftover `activeDomainByVaultId`. Do not seed the first live domain on vault open. |
| 5 | Session memory | Last lens (Overview or a slug) sticks until quit or vault close/open. |
| 6 | URL | **Lens is not in the URL.** Doctrine **file** identity is: `/dream/{slug}/why`, `/dream/{slug}/what`, `/track/{slug}/how`. |
| 7 | Filter | Overview = union of all domains **plus** unassigned. Domain tab = assigned to that domain only. |
| 8 | Unassigned | Visible **only** in Overview. |
| 9 | Signals | Single optional `domainSlug`. Composer defaults to the selected domain, or unassigned in Overview. User can clear before save. Later assignment is an edit. |
| 10 | Library notes | Many domain slugs, or none (`[]`). Same composer default as signals (one tag in a domain tab; none in Overview). Extra tags allowed. |
| 11 | Doctrine | Still exactly one Why, What, How per domain folder. Never unassigned. |
| 12 | Dream | Index of Why **and** What (filtered by lens), then drill-in editor. |
| 13 | Architecture | Index of How (filtered by lens), then drill-in editor. |
| 14 | What’s home | Dream, not Life Map. Home doctrine links: Why/What → Dream, How → Architecture. |
| 15 | Documents page | **Library only.** Replaces the three doctrine cards. |
| 16 | Life Map | **Unfiltered** this spec (map data has no domain tags). |
| 17 | Chain in-page domain dropdown | **Removed.** Type + search stay. Top-bar is the domain filter. |
| 18 | Archive selected domain | Lens returns to Overview. |
| 19 | Zero live domains | Switcher is Overview only. |
| 20 | Welcome | No shell, so no switcher. |
| 21 | Chat / MCP | Same lens. Overview = whole-life doctrine. Explicit `domainSlug` on a tool still wins. |
| 22 | Library storage | Vault-root `documents/{id}.md` with YAML frontmatter. Not in `VaultSnapshot`. No schema bump. Missing folder ⇒ empty list. |
| 23 | Library governance | No forge, no Decisions, no folders, no attachments. |
| 24 | Life log coupling | Library CRUD does **not** append Life log events (same as Signal-Chain). |
| 25 | Room nav locks | Unchanged vault-wide rule (any domain’s prior pillar can unlock the next room). |
| 26 | Per-row doctrine locks | Why always editable. What locked until **that** domain’s Why has a body. How locked until **that** domain’s What has a body. |

### Explicitly out of scope

- Plugin / page install per domain (future hook only)
- Attachments, PDFs, imported files on library notes
- Multi-tag on signals or personnel (those stay a single optional slug)
- Filtering Life Map by domain
- Persisting the lens across launches
- Overview as a real `domains/overview/` folder
- Forge / Decisions on library notes
- Wiki links or notebooks
- Changing vault-wide room-unlock math

---

## 3. Architecture

Chosen: **virtual session lens** (`overview` or a live slug) plus a vault-level notes library. Rejected a reserved Overview domain and a `?domain=` query.

```
┌──────────────────────────────────────────────────────────┬──────────┐
│ LifeQuest — Personal                          (drag)     │ [_] □ X  │
├──────┬───────────────────────────────────────────────────┼──────────┤
│ Nav  │ Vision | Plan | Execute    Overview | Health | … 🔒│  Chat    │
│ wing │ page content (filtered by lens)                   │          │
└──────┴───────────────────────────────────────────────────┴──────────┘
```

### 3.1 Pure lens module

`packages/vault-core/src/domain-lens.ts`, exported from `pure.ts` (no `node:fs`).

```ts
export type DomainLens =
  | { kind: "overview" }
  | { kind: "domain"; slug: string };

export function overviewLens(): DomainLens {
  return { kind: "overview" };
}

export function domainLens(slug: string): DomainLens {
  return { kind: "domain", slug };
}

/** Single optional slug (signals, log, personnel). */
export function recordVisible(
  lens: DomainLens,
  domainSlug: string | null,
): boolean;

/** Many tags (library notes). Empty array is unassigned. */
export function recordVisibleMulti(
  lens: DomainLens,
  domainSlugs: readonly string[],
): boolean;
```

Rules:

- Overview → always `true`.
- Domain tab + `null` or `[]` → `false`.
- Domain tab + single slug → slug equals lens slug.
- Domain tab + array → array includes lens slug.

### 3.2 Session wiring

**Renderer** (`VaultProvider`):

- Holds `lens: DomainLens`, default `overviewLens()`.
- `setLens(next)` updates React state and calls `api().domainSetActive(slug | null)`.
- Vault open / create / `clearVault` / boot with a vault → `overviewLens()`.
- Archiving the selected domain → `overviewLens()`.

**`useActiveDomain()`:** returns the live `DomainRecord` for `lens.kind === "domain"`, else `null`. **No fallback to `live[0]`.**

**Main** (`vault-service`):

- In-memory `currentLens: string | null` (`null` = Overview).
- `domainSetActive(slug: string | null)`: `null` sets Overview; a slug must exist and be non-archived.
- `domainGetActive()`: returns that memory, not `userData`.
- `rememberOpen`: **do not** seed the first domain; **do not** read/write `activeDomainByVaultId`.
- MCP and map tools use `currentLens` the same way.

Leftover prefs may remain on disk; they are never consulted.

### 3.3 Filter contract (renderer)

List APIs still return the full set. Each surface filters with `recordVisible` / `recordVisibleMulti`.

| Surface | Field | Overview | Domain tab |
|---------|--------|----------|------------|
| Signal-Chain | `domainSlug` | all, including unassigned | match slug |
| Library notes | `domainSlugs` | all, including untagged | includes slug |
| Doctrine indexes | domain folder | all live domains | that domain |
| Life log | `domainSlug` | all, including unassigned | match slug |
| Act events | `domainSlug` | all, including unassigned | match slug |
| Personnel | `domainSlug` | all, including unassigned | match slug |
| Decisions | `domainSlug` | all | match slug |
| Home events / pending decisions | same fields | all, including unassigned | match |
| Life Map | — | unfiltered | unfiltered |

Unassigned (`null` / `[]`) is included only in Overview.

**Act brief:** domain tab = that domain’s Why/What/How. Overview = every live domain’s doctrine, each headed by the domain name.

**Chat / `get_doctrine`:** explicit `domainSlug` argument wins. If omitted: domain tab → that domain; Overview → array of `{ slug, name, documents }` for every live domain.

### 3.4 Composers

Signal-Chain composer keeps a domain `<select>` including a none/unassigned choice. It does **not** filter the timeline.

- Mount / lens change: if the user has not dirty-edited the picker, set default to lens slug or `""` for Overview.
- Save: empty → `domainSlug: null`.

Library create/edit: tag picker (multi). Default tags: `[slug]` in a domain tab, `[]` in Overview. User may add, remove, or clear before save.

### 3.5 Library documents

Vault-core module `packages/vault-core/src/library-documents.ts`. Paths: `vaultPaths.documentsDir` = `{root}/documents`, `libraryDocumentMd(id)` = `{root}/documents/{id}.md`.

Record:

```ts
export type LibraryDocument = {
  id: string;
  title: string;
  bodyMarkdown: string;
  domainSlugs: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
```

File: UUID filename + YAML frontmatter (`title`, `domains` as a string array, timestamps, `deletedAt`) and markdown body via existing `parseFrontmatter` / `serializeFrontmatter`. `id` is the filename stem.

API (all `Result<T>`):

- `libraryList(root)` → live (non-deleted) notes, newest `updatedAt` first; `skipped` count for unreadable files (same idea as Signal-Chain).
- `libraryCreate(root, { title, bodyMarkdown, domainSlugs })`
- `libraryGet(root, id)`
- `libraryUpdate(root, id, patch)` — title, body, `domainSlugs`; bumps `updatedAt`; `createdAt` unchanged.
- `libraryDelete(root, id)` — sets `deletedAt` (soft). Hidden from list. No restore UI.

Validation:

- Title required (trimmed, non-empty). Body may be empty.
- Each slug in `domainSlugs` must be an existing domain directory. Archived slugs allowed if that domain dir still exists (same as signals). Unknown slug → `Unknown domain: …`.
- Duplicate slugs in the array are collapsed, order preserved.

IPC names (distinct from doctrine `documentGet` / `documentSave`): `libraryList`, `libraryCreate`, `libraryGet`, `libraryUpdate`, `libraryDelete`.

Existing vaults without `documents/` open as an empty library. Create the folder on first write.

### 3.6 Doctrine indexes

**Dream (`/dream`)** — list Why and What for domains visible under the lens, grouped by domain (sortOrder), Why then What. Each row: kind, domain name, status badge. What is locked when that domain’s Why body is empty: the row shows a lock and does not navigate. Unlocked rows go to `/dream/{slug}/why` or `/dream/{slug}/what`.

**Architecture (`/track`)** — list How the same way. How is locked when that domain’s What body is empty (lock, no navigate). Unlocked rows go to `/track/{slug}/how`.

**Editors** reuse `DocumentEditor` with `{ slug, kind }` from the route. They must **not** call `setActiveSlug` / `setLens`. Missing or archived slug → not-found copy + link to `/dream` or `/track`.

Back from the editor is the index route. Refresh keeps the file route; lens stays whatever the session is (Overview after a cold start even if the hash is `/dream/health/why`).

`DocumentEditor` / `DoctrineStrip` / Home doctrine rows must not assume `useActiveDomain()` is non-null.

### 3.7 Error handling

- `domainSetActive` unknown or archived slug: `{ ok: false, error }`; lens unchanged.
- Main IPC set fails: renderer still updates local lens; chat/MCP may lag until a later successful set. Show the existing vault error string.
- Library unknown id: `{ ok: false, error: "Document not found: …" }`.
- Empty title / unknown domain slug: reject the write.
- Doctrine route for unknown slug: not-found UI, no throw.
- Soft-deleted library files: omitted from list.

---

## 4. Components

| Unit | Responsibility |
|------|----------------|
| `domain-lens.ts` | `DomainLens`, `recordVisible`, `recordVisibleMulti` |
| `library-documents.ts` | CRUD + frontmatter files under `documents/` |
| `paths.ts` | `documentsDir`, `libraryDocumentMd(id)` |
| `VaultProvider` | Session `lens` / `setLens`; stop first-domain fallback |
| `useActiveDomain` | Domain record or `null`; no `live[0]` fallback |
| `DomainSwitcher` | Overview radio first, then live domains |
| `vault-service` | In-memory lens; `domainSetActive(null)`; no pref seed |
| `mcp-server` / map tools | Read in-memory lens |
| `DocumentsPage` | Library list + create/edit |
| Dream / Architecture pages | Indexes + routed editors |
| `DocumentEditor` | Explicit `{ slug, kind }` |
| Signal-Chain, Log, Act, Home, Personnel, Decisions | Filter via `recordVisible` |
| `ChatPanel` | Doctrine context from lens |

Each unit is understandable from its exports. Filtering is a pure function. Library IO does not belong in the snapshot loader.

---

## 5. Testing

**Vault-core** (`packages/vault-core/tests/domain-lens.test.ts`, `library-documents.test.ts`):

- Overview shows assigned and unassigned; domain tab hides unassigned; multi-tag note visible in each tagged domain and in Overview, not in an untagged domain.
- Library create/list/update/soft-delete; empty title rejected; unknown slug rejected; archived existing slug allowed; empty `domainSlugs` stored; missing `documents/` lists empty.

**Desktop** (`apps/desktop/tests/domain-lens-shell.test.ts` source-scan, plus extend `wing-shell.test.ts` / settings tests as needed):

- Switcher source includes Overview before domain map.
- `useActiveDomain` has no `live[0]` fallback.
- `rememberOpen` / `domainSetActive` do not seed or persist prefs.
- Documents page does not render Why/What/How cards; it calls `libraryList`.
- App routes include `/dream/:slug/:kind` and `/track/:slug/how`.
- Signal-Chain feed has no in-page domain filter control.

No new Electron E2E. Manual check: launch is Overview; Health hides unassigned chain events; Dream in Overview lists every domain’s Why/What; editing Health Why does not select Health in the switcher; quit/reopen is Overview again.

`npm test` at repo root (vault-core + desktop) must pass. Pre-existing failures (`packaging-config` production deps, `Dashboard.tsx` typecheck) are **not** in scope to fix here unless this work touches those files.

---

## 6. Files to touch

| File | Change |
|------|--------|
| `packages/vault-core/src/domain-lens.ts` | **Create** — pure lens helpers |
| `packages/vault-core/src/library-documents.ts` | **Create** — notes CRUD |
| `packages/vault-core/src/pure.ts` | Export `domain-lens` |
| `packages/vault-core/src/index.ts` | Export library + lens |
| `packages/vault-core/src/paths.ts` | `documentsDir`, `libraryDocumentMd` |
| `packages/vault-core/src/types.ts` | `LibraryDocument` types |
| `packages/vault-core/tests/domain-lens.test.ts` | **Create** |
| `packages/vault-core/tests/library-documents.test.ts` | **Create** |
| `apps/desktop/electron/vault-service.ts` | In-memory lens; library IPC; stop pref seed |
| `apps/desktop/electron/recent-vaults.ts` | Stop using active-domain prefs for launch |
| `apps/desktop/electron/preload.ts` / `vite-env.d.ts` | `domainSetActive(null)`; library methods |
| `apps/desktop/electron/mcp-server.ts` / `map-tools.ts` | In-memory lens |
| `apps/desktop/src/state/VaultProvider.tsx` | `lens` / `setLens` |
| `apps/desktop/src/components/shell/useActiveDomain.ts` | Drop first-domain fallback |
| `apps/desktop/src/components/shell/DomainSwitcher.tsx` | Overview button |
| `apps/desktop/src/App.tsx` | Dream/Architecture nested routes |
| `apps/desktop/src/pages/DocumentsPage.tsx` | Library UI |
| Dream / Architecture pages | Indexes + editors |
| `DocumentEditor`, `DoctrineStrip`, `HomePage` | Explicit slug; What → Dream |
| Signal-Chain, Log, Act, Personnel, Decisions, Chat | Lens filter / context |
| `apps/desktop/tests/domain-lens-shell.test.ts` | **Create** — wiring scans |

Renderer-only consumers of `useActiveDomain()` must tolerate `null` (Overview).

---

## 7. Follow-ons (not this spec)

- Attachments and imported files on library notes (eventual Documents “C”).
- Installing plugins/pages under a specific domain (nav subset in a domain tab; Overview still shows the full app).
- Optional domain tags on Life Map tasks.
- Multi-domain tags on Signal-Chain events.
