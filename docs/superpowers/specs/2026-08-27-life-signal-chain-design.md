# Life Signal Chain — Design Spec

**Date:** 2026-08-27  
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-08-27-life-signal-chain.md`)  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron) design](./2026-07-19-local-vault-electron-design.md)

---

## 1. Purpose

Add **Life Signal Chain**: a personal, vault-native dump for thoughts, ideas, and things the user notices. It is a **separate** destination from the existing **Life log**.

| Surface | Role |
|---------|------|
| Life log | Append-only audit of app events (domains, documents, decisions, agents) |
| Life Signal Chain | Human (and later automated) life data — a raw timeline the user owns |

v1 is **manual capture + a day-grouped timeline**. The record shape includes `source` / `sourceRef` so Notion sync and other ingest can land later **without rewriting storage**. Those integrations are not in this spec.

### Success criteria

- Sidebar shows **Chain** (always available once a vault is open).
- User can add a signal with type, optional domain, optional title, and required body.
- Timeline shows non-deleted signals, newest day first, grouped by local calendar day.
- User can edit and soft-delete items; `createdAt` never changes.
- Existing vaults without a `signal-chain/` folder open as an empty chain.
- Life log is unchanged. Signals are **not** copied into `log.jsonl`.
- Uncommitted theme work in the working tree is **not** part of this change.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Relation to Life log | **New nav item.** Log stays the app audit trail. |
| 2 | Record shape | `createdAt` + `type` + `body` + optional `title` + optional `domainSlug`. |
| 3 | Types | Closed enum: `thought` \| `idea` \| `notice` \| `other`. |
| 4 | Mutability | **Soft-mutable.** Edit text/type/title/domain. Soft-delete via `deletedAt`. Original `createdAt` is immutable. `updatedAt` on every write. |
| 5 | v1 scope | Manual capture + timeline only. `source` is always `manual` in the UI. |
| 6 | Timeline | Newest day at top; items within a day newest first; sticky local-timezone day headers (`Today`, `Yesterday`, then a formatted date). Composer at the top. |
| 7 | Storage | **One JSON file per signal:** `.lifequest/signal-chain/<id>.json` (same pattern as Decisions). |
| 8 | Snapshot | **Not** loaded into `VaultSnapshot`. The Chain page fetches its own list. |
| 9 | Schema version | **No bump.** Folder is created on first write; missing folder ⇒ empty list. |
| 10 | Nav | Main section, after **Domains**. Label **Chain**. Page title **Life Signal Chain**. Icon Lucide `Radio`. No room lock. |
| 11 | Default domain in composer | Active domain, with an explicit **none** choice. |
| 12 | Filters | Type, domain, text search over title + body. Default: all / all / empty. |
| 13 | Deleted items | Hidden from list. No restore UI in v1. Files stay on disk. |
| 14 | Life log coupling | **None.** Creating/editing/deleting a signal does not append a Life log event. |

### Explicitly out of scope (v1)

- Notion (or any) sync, mirroring, or OAuth
- HTTP ingest, file-drop watchers, or automation runners
- UI for `source` other than `manual`
- Restoring or listing deleted signals
- Pagination / virtualized list (load the full non-deleted folder)
- Encryption, multi-device sync, sharing
- Writing signals into Life log
- Changing `SCHEMA_VERSION`
- Touching in-progress theme/skin files in the working tree

Follow-on specs (not this one): local ingest surface; Notion mirror/link.

---

## 3. Architecture

```
Renderer (Chain page)
  composer + filters + day-grouped timeline
        │ IPC (signalChain:list|create|update|delete)
        ▼
Electron main (vault-service)
        │
        ▼
vault-core  (.lifequest/signal-chain/<id>.json, atomic writes)
```

- **vault-core** owns paths, validation, list/create/update/delete, and JSON (de)serialization.
- **Electron main / preload** expose four IPC methods in the existing `Result<T>` style.
- **Renderer** does not touch Node `fs`. It does not put the chain on `VaultSnapshot`.
- Malformed files are skipped at list time (see §7); they are not deleted.

Rejected alternatives (storage):

| Alternative | Why rejected |
|-------------|--------------|
| Single JSONL (like Life log) | Soft-mutable edits rewrite the whole file; git diffs go noisy; crash mid-rewrite is worse than one bad file. |
| Markdown + frontmatter | Doctrine already owns Markdown; a high-volume dump does not need that ceremony. |
| SQLite sidecar | Conflicts with git-native vault layout. |

---

## 4. Vault layout and data model

### 4.1 Path

```
<vault-root>/.lifequest/signal-chain/<id>.json
```

- `<id>` is a UUID (same generator as decisions / log).
- Directory is created on first successful create (`mkdir` recursive via atomic write).
- `open-vault` / `create-vault` do **not** seed an empty directory.
- `vaultPaths` adds `signalChainDir` and `signalChainJson(id)`. Ids pass through `safeJoin` so `../` cannot escape the vault.

### 4.2 `SignalRecord`

```ts
export const SIGNAL_TYPES = ["thought", "idea", "notice", "other"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_SOURCES = ["manual", "automation", "notion"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export type SignalRecord = {
  id: string;
  createdAt: string;       // ISO-8601, immutable after create
  updatedAt: string;       // ISO-8601
  deletedAt: string | null;
  type: SignalType;
  source: SignalSource;    // v1 writes always "manual"
  sourceRef: string | null; // URL or external id; v1 UI always null
  title: string | null;
  body: string;
  domainSlug: string | null;
};
```

Example file:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "createdAt": "2026-08-27T14:02:11.000Z",
  "updatedAt": "2026-08-27T14:02:11.000Z",
  "deletedAt": null,
  "type": "thought",
  "source": "manual",
  "sourceRef": null,
  "title": null,
  "body": "Noticed I stall on How docs when the Why is still vague.",
  "domainSlug": "intellectual"
}
```

Pretty-printed JSON + trailing newline, same as decision files (`JSON.stringify(record, null, 2)`).

### 4.3 Field rules

| Field | Create | Update | Delete |
|-------|--------|--------|--------|
| `id` | Server-generated UUID (optional client id ignored unless we later need ingest idempotency; v1 always generates) | Reject if caller sends a different id | — |
| `createdAt` | Server `now` | Immutable. If present in a patch, ignore it. | — |
| `updatedAt` | Same as `createdAt` | Server `now` | Server `now` |
| `deletedAt` | `null` | Must stay `null` (delete is the only way to set it) | Set to server `now` |
| `type` | Required, enum | Optional patch, enum | Unchanged |
| `source` | Forced `manual` in v1 IPC | Unchanged in v1 | Unchanged |
| `sourceRef` | Forced `null` in v1 IPC | Unchanged in v1 | Unchanged |
| `title` | Optional; empty/whitespace → `null` | Same | Unchanged |
| `body` | Required; trim; non-empty | Required if present; trim; non-empty | Unchanged |
| `domainSlug` | Optional; `null` or an existing (including archived) domain slug | Same | Unchanged |

**Domain existence:** if `domainSlug` is non-null, a `domains/<slug>/` directory must exist. Archived domains remain valid on existing signals so history does not break; the composer domain picker lists **non-archived** domains plus the current value if it is archived.

**v1 id generation:** vault-core always assigns `randomUUID()`. Do not accept a client-supplied id in v1 (closes a trivial overwrite). Ingest idempotency is a later spec.

---

## 5. UI

### 5.1 Navigation and routing

- `NAV_ITEMS` entry: `id: "chain"`, `href: "/chain"`, `label: "Chain"`, `icon: Radio`, `section: "main"`.
- Insert after **Domains** (before **Personnel** in the main-section order).
- Hash route `/chain` inside `App.tsx`, wrapped in `ShellRoute` like Log/Decisions.
- Page component: `apps/desktop/src/pages/ChainPage.tsx`.
- Feed component: `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx` (and small children if needed: composer, row, filters).
- Day-grouping helpers: `apps/desktop/src/lib/signal-chain.ts` (pure; unit-tested).

### 5.2 Page structure (top → bottom)

1. **Header** — title “Life Signal Chain”; description “Dump thoughts, ideas, and things you notice.”
2. **Composer** (always visible)
   - Type `<select>` — default `thought`
   - Domain `<select>` — default **active domain**, plus a **None** option
   - Optional title `<input>`
   - Body `<textarea>`
   - **Add** button — disabled when body is empty/whitespace or a write is in flight
   - On success: clear title + body; keep type and domain; refresh/prepend into the timeline
3. **Filters**
   - Type: All + each enum value
   - Domain: All + None + each non-archived domain (label by `meta.name`)
   - Search: case-insensitive substring on `title` and `body`
   - Defaults: All / All / empty
4. **Timeline**
   - Filter in the renderer from the full non-deleted list
   - Group by local calendar day of `createdAt`
   - Day order: newest first
   - Within a day: newest `createdAt` first; tie-break by `id`
   - Sticky day header: `Today`, `Yesterday`, else `toLocaleDateString` with `dateStyle: "medium"`
   - Row: time (`timeStyle: "short"`), type badge, domain name if set, title if set, body (preserve newlines, no Markdown rendering in v1)
   - Row actions: Edit, Delete
5. **Empty states**
   - No signals in vault: “Nothing on the chain yet. Add a signal above.”
   - Signals exist but filters match none: “No signals match these filters.”
   - Loading / error banners as on Life log

### 5.3 Edit and delete

- **Edit:** the row becomes an inline form with the same fields as the composer (type, domain, title, body). Save calls `signalChainUpdate`. Cancel restores the row. `createdAt` is displayed but not editable.
- **Delete:** `window.confirm` (same pattern as domain archive). On confirm, `signalChainDelete`; row disappears.

### 5.4 Not in the UI (v1)

Source picker, `sourceRef`, restore deleted, markdown preview, infinite scroll.

---

## 6. IPC and data flow

Preload + `vite-env.d.ts` + `vault-service.ts` + `main.ts` handlers. Require an open vault (same guard as `decisionList`).

| Channel | Renderer method | Result |
|---------|-----------------|--------|
| `signalChain:list` | `signalChainList()` | `Result<SignalChainListResult>` |
| `signalChain:create` | `signalChainCreate(input)` | `Result<SignalRecord>` |
| `signalChain:update` | `signalChainUpdate(id, patch)` | `Result<SignalRecord>` |
| `signalChain:delete` | `signalChainDelete(id)` | `Result<SignalRecord>` |

```ts
type SignalChainListResult = {
  records: SignalRecord[]; // newest createdAt first, deletedAt == null
  skipped: number;         // unreadable or invalid files in the folder
};
```

### 6.1 Create input

```ts
{
  type: SignalType;
  body: string;
  title?: string | null;
  domainSlug?: string | null;
}
```

Server sets `id`, timestamps, `deletedAt: null`, `source: "manual"`, `sourceRef: null`.

### 6.2 Update patch

```ts
{
  type?: SignalType;
  body?: string;
  title?: string | null;
  domainSlug?: string | null;
}
```

Unknown keys ignored. Empty patch is allowed and still bumps `updatedAt` (not required by the UI). Updating a missing or already-deleted id fails.

### 6.3 List behavior

1. If `signal-chain/` is missing → `ok: true, value: { records: [], skipped: 0 }`.
2. Read `*.json` files in that directory (skip non-files, skip names that fail `safeJoin`).
3. Parse JSON; skip files that throw or fail a structural guard (see §7).
4. Drop records with non-null `deletedAt`.
5. Sort by `createdAt` descending, then `id` descending.
6. Unreadable or structurally invalid files increment `skipped` and are omitted from `records`. The overall Result stays `ok: true` unless the directory itself cannot be read (other than `ENOENT`).

This is an intentional deviation from `decisionList` (which fails the whole list on a bad file). A growing dump must not go blank because one file is junk. The renderer shows a banner when `skipped > 0`: “N signal file(s) could not be read.” A full list failure (`ok: false`) uses the same error treatment as Life log.

### 6.4 Create / update / delete flow (renderer)

After a successful write, either:
- merge the returned record into local state, or
- call `signalChainList` again.

v1 **re-lists** after every successful mutation (simplest consistency). Composer success also re-lists.

---

## 7. Error handling

| Case | Behavior |
|------|----------|
| No vault open | IPC returns error; shell already sends user to `/welcome`. |
| Empty / whitespace `body` | `ok: false, error: "body is required"` — composer/row shows the string. |
| Invalid `type` | `ok: false, error: "Invalid signal type: …"` |
| `domainSlug` set but no such domain dir | `ok: false, error: "Unknown domain: …"` |
| Update/delete unknown id | `ok: false, error: "Signal not found"` |
| Update/delete already-deleted | `ok: false, error: "Signal not found"` (do not leak deleted ids as a distinct state) |
| Id with path traversal | `safeJoin` throws → `ok: false` with the existing escape error |
| Unreadable / invalid JSON file on list | Counted in `skipped`; other records still returned |
| Record missing required fields or wrong types | Counted in `skipped` |
| Disk write failure | `ok: false` with `Error.message` |

Writes use `atomicWriteFile` (temp + rename). Soft-delete **overwrites** the same file with `deletedAt` set; it does not unlink.

---

## 8. Testing

### 8.1 vault-core (`packages/vault-core/tests/signal-chain.test.ts`)

Operate on a temp directory (same pattern as `decisions.test.ts`).

- Missing folder → list `{ records: [], skipped: 0 }`.
- Create writes `<id>.json` under `signal-chain/`, `source: "manual"`, `sourceRef: null`, `deletedAt: null`, `createdAt === updatedAt`, pretty JSON.
- List returns newest `createdAt` first and omits soft-deleted rows.
- Update changes `body` / `type` / `domainSlug` / `title`, bumps `updatedAt`, leaves `createdAt` and `id` unchanged.
- Delete sets `deletedAt`; list omits it; second delete → not found.
- Reject empty body, unknown type, unknown domain slug.
- `../` in id does not write outside the vault.
- One malformed JSON file increments `skipped` and does not fail the list.
- Create does not append to `log.jsonl`.

### 8.2 Renderer helpers (`apps/desktop/src/lib/signal-chain.test.ts`)

- Group records into local-day buckets, newest day first, newest item first.
- Label: today → `Today`; yesterday → `Yesterday`; else medium date.
- Filter by type, domain (`null` vs slug), and case-insensitive search on title+body.

No Electron e2e required for v1.

---

## 9. Implementation sketch (for the plan, not extra product)

Likely files (do not treat as exhaustive):

| Area | Files |
|------|--------|
| Types / paths | `packages/vault-core/src/types.ts`, `paths.ts`, `index.ts` |
| Core | `packages/vault-core/src/signal-chain.ts` (new) |
| Tests | `packages/vault-core/tests/signal-chain.test.ts` (new) |
| IPC | `apps/desktop/electron/vault-service.ts`, `main.ts`, `preload.ts` |
| Renderer types | `apps/desktop/src/vite-env.d.ts`, `lib/ipc.ts` if it re-exports |
| Nav / routes | `nav-items.ts`, `App.tsx` |
| UI | `pages/ChainPage.tsx`, `components/signal-chain/*`, `styles/global.css` |
| Helpers | `src/lib/signal-chain.ts` + `.test.ts` |

Keep the diff away from `ThemeToggle.tsx`, `theme.ts`, and other in-progress theme files unless a nav insert truly requires touching `NavRail.tsx` (prefer `nav-items.ts` only).

---

## 10. Key decisions

1. **Separate from Life log** — audit vs personal dump; mixing them would drown both.
2. **Per-file JSON** — matches Decisions; isolated edits; future ingest can drop a file without rewriting a JSONL.
3. **Soft-mutable** — a dump you type by hand needs typo/domain fixes; correction-event protocol is overkill.
4. **Not in VaultSnapshot** — a growing dump should not tax every page.
5. **Skip-tolerant list** — one bad file must not blank the timeline.
6. **`source` / `sourceRef` now, unused in UI** — avoids a storage migration for Notion/automations.
7. **No schema bump** — additive directory, lazy create.
8. **No Life log events** — keep the two chains independent.
9. **Full-folder load in v1** — pagination only when volume hurts; personal manual dumps will not.

---

## 11. Open questions

None remaining. Product choices were locked in the brainstorming thread (new nav; typed+domain records; soft-mutable; manual v1; day-grouped newest-first feed; per-file JSON).

---

## 12. Follow-on (explicitly not this spec)

1. **Local ingest** — trusted way for automations to append (`source: "automation"`), possibly accepting client ids for idempotency.
2. **Notion** — mirror/link pages into the chain with `source: "notion"` and `sourceRef` as the Notion URL/id.
