# Document Lock — Design Spec

**Date:** 2026-09-12  
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-09-12-document-lock.md`)  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Overview Domain Lens](./2026-08-31-overview-domain-lens-design.md), [Dream doctrine four docs](./2026-09-10-dream-doctrine-four-docs-design.md), [Hermes companion profile](./2026-09-04-hermes-companion-profile-design.md)

Supersedes:

- Skeleton / local-vault: `draft | refined | forged` status, one-way Forge, forged docs read-only, Decisions only against forged doctrine.
- Domain lens locked decisions 23–24: library notes have no Decisions and do not append Life log.
- Dream doctrine locked decisions 27–28: Refine / Forge chrome; forged paste/drop disabled as the only change path.
- Companion profile / Life Map: agents must not rewrite Premise / Vision / Purpose / Strategy (How).
- `LAWS/DOCTRINE.md` as a forge-only in-place edit ban.
- Home “N/N forged” and Act “How is forged” copy.

Forge as a **one-way quality bar** is gone. The mechanic stays as a **user-owned lock toggle**. Theme name `forge-os` is unrelated and stays.

---

## 1. Purpose

Documents are created and edited by the user or by agents. When the user is happy with a document, they lock it. Locked documents are not edited in place: the user may unlock and edit, or propose a change; an agent may only propose. Proposals land in Decisions. Every create, edit, lock, and decision is logged with **who** did it.

This applies to **doctrine** (Premise, Vision, Purpose, Strategy) and **library notes** (Documents page). Same lock, same Decisions, same Log.

### Success criteria

- `status` / `forgedAt` / Refine / Forge are gone. Every doctrine file and library note has `locked: boolean` (default `false`).
- Existing `status: forged` reads as locked; everything else reads as unlocked. Persist the new shape on the next save or lock toggle. No vault-wide rewrite. `schemaVersion` stays `1`.
- User-only lock toggle. Agents have no lock tool; actor `agent` on a lock call is rejected.
- Unlocked: user and agent create/edit title and body in place.
- Locked: in-place save fails. User can unlock-and-edit or Propose. Agent `update_document` on a locked doc creates a pending Decision and does not write the file.
- Decisions target doctrine **or** library. Approve writes proposed title/body and leaves `locked` as-is. Reject leaves the file.
- Log events for document create/update/lock and decisions include actor (`user` or `agent` with id and name).
- Agents can create library notes (always unlocked) and update doctrine or library via tools. They cannot add a fifth doctrine kind.
- Home / Act / doctrine index say **locked**, not forged.
- `LAWS/DOCTRINE.md` and `PRODUCT.md` match the lock model.
- `archive/web-skeleton` is not updated.
- `npm test` in `packages/vault-core` and `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Mechanic | Keep governance. Rename Forge → **Lock**. Two-way toggle, not a one-way status. |
| 2 | Scope | **Both** doctrine and library notes. |
| 3 | Flag | Boolean `locked`. Drop `draft` / `refined` / `forged` and `forgedAt`. |
| 4 | Default | New documents (seeded doctrine, new library notes) start **unlocked**. |
| 5 | Migration | On read: `locked` boolean wins; else `status === "forged"` → locked; else unlocked. Unknown/missing status → unlocked. Do not fail vault open. Write new frontmatter on next save or toggle. |
| 6 | Schema | **No bump.** `schemaVersion` stays `1`. |
| 7 | Who toggles | **Only the user.** Agents never lock or unlock. |
| 8 | Unlocked writes | User and agent edit title/body in place. Logged with actor. |
| 9 | Locked writes | No in-place save. User: unlock-and-edit **or** Propose. Agent: Propose only (via `update_document` → Decision). |
| 10 | Propose while unlocked | **Rejected.** Edit in place. |
| 11 | Approve | Writes proposed body. Writes proposed title when `proposedTitle` is non-null; otherwise keeps the file title. Does **not** change `locked`. |
| 12 | Stale proposals | Later approve still writes that proposal (last approve wins). No auto-dismiss. |
| 13 | Unlock vs pending | Unlocking does not apply or dismiss pending proposals. |
| 14 | Doctrine files | Still exactly four per domain. Agents cannot create a fifth kind. |
| 15 | Library create | User and agent. Always unlocked. Unknown domain tag → fail, no file. |
| 16 | Library delete | User-only, allowed even when locked (not an in-place edit). No agent delete tool. Still unlogged. |
| 17 | Actor | `user` has no id. Agent: `{ type: "agent", id, name }` (`id` = Hermes agent id if known, else `"companion"`; `name` = hire/display name, else `"Hermes"`). |
| 18 | Log | Document create/update/lock and decision events include actor. Drop new `document.status_changed`. Do not rewrite old log lines. Missing actor on old lines: omit who in the UI. |
| 19 | Library log | **Supersedes** domain-lens “library CRUD does not log.” Create/update/lock/decision on library notes **do** append Life log. |
| 20 | Decision target | Discriminated: doctrine `{ type: "doctrine", domainSlug, kind }` or library `{ type: "library", id }`. |
| 21 | Old decisions | Files with `domainSlug` + `documentKind` and no `target` read as doctrine. Missing actor → `user`. Missing proposed title → keep current title on approve (body-only, today’s behavior). |
| 22 | Inbox filter | Doctrine: that domain. Library: the note’s domain tags **at propose time** (`domainSlugs` on the decision). Empty tags → Overview only. |
| 23 | Propose dialog | Prefills document title and body. Optional rationale. No separate inbox-headline field; `DecisionRecord.title` is derived (`Proposed change to {label}`). New proposals always store `proposedTitle` as that dialog string (never null). |
| 24 | Room sequence | Unchanged. Per-row “What until Why has a body” is **not** this lock. |
| 25 | Theme | `forge-os` name and skin stay. |
| 26 | Archive | `archive/web-skeleton` is **not** updated. |
| 27 | Presence | Unlocked agent writes apply even if the user is away. Lock is the gate, not session presence. |

### Explicitly out of scope

- Presence-aware HITL (agent writes → Decisions because the user is AFK)
- Auto-dismiss of stale proposals
- Creating extra doctrine files / kinds
- Schema version bump
- Vault-wide rewrite on open
- Rewriting historical log lines
- Changing room-unlock or per-row sequence locks
- Renaming the `forge-os` skin
- Updating `archive/web-skeleton`
- User accounts or a user id on actor
- Agent lock/unlock (even as a Decision)
- WYSIWYG editor

---

## 3. Architecture

Chosen: **replace status with `locked` on both document kinds; route agent writes through the same lock gate; generalize Decisions to a document target; stamp actor on log events.** Rejected keeping `refined`, presence gating, and unifying doctrine into library files.

```
                    ┌──────────── user IPC ────────────┐
                    │ actor: user                      │
 create/save/lock ──┤                                  │
 propose            │         vault-core               │
                    │  locked? ──no──► write file      │
                    │     │            + log(actor)    │
                    │    yes                           │
                    │     ├─ save ──► error            │
                    │     ├─ user propose ──► Decision │
                    │     └─ setLocked ──► write flag  │
                    └──────────────────────────────────┘

                    ┌──────── agent tools ─────────────┐
 create_library ───► always unlocked write + log
 update_document ──► unlocked: write + log
                     locked: Decision (no file write)
 (no lock tool)
```

### 3.1 Types (vault-core)

Remove `DOCUMENT_STATUSES`, `DocumentStatus`, `canTransitionStatus`. Replace `assertEditable(status)` with `assertEditable(locked: boolean)`.

```ts
export type Actor =
  | { type: "user" }
  | { type: "agent"; id: string; name: string };

export type DocumentTarget =
  | { type: "doctrine"; domainSlug: string; kind: DocumentKind }
  | { type: "library"; id: string };

export type DoctrineDocument = {
  kind: DocumentKind;
  title: string;
  locked: boolean;
  updatedAt: string;
  bodyMarkdown: string;
  mtimeMs: number;
};

export type LibraryDocument = {
  /* existing fields */
  locked: boolean;
};

export type DecisionRecord = {
  id: string;
  target: DocumentTarget;
  domainSlugs: string[];
  status: "pending" | "approved" | "rejected";
  title: string;
  rationale: string | null;
  proposedTitle: string | null;
  previousTitle: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown: string | null;
  actor: Actor;
  createdAt: string;
  resolvedAt: string | null;
};

export type LifeEvent = {
  id: string;
  domainSlug: string | null;
  type: string;
  summary: string;
  payload: unknown;
  actor: Actor | null;
  createdAt: string;
};
```

`DecisionRecord` no longer requires `domainSlug` + `documentKind` as top-level fields. Read-normalize old JSON:

- `target` missing + `documentKind` present → `{ type: "doctrine", domainSlug, kind: documentKind }`
- `domainSlugs` missing → `[domainSlug]` if that string is non-empty, else `[]`
- `actor` missing → `{ type: "user" }`
- `proposedTitle` / `previousTitle` missing → `null`

`LifeEvent.actor` missing → `null` (legacy).

Doctrine log `domainSlug` is the domain. Library log `domainSlug` is the first tag or `null`.

### 3.2 Frontmatter

**Doctrine** (new writes):

```yaml
---
title: Purpose
locked: false
updatedAt: 2026-09-12T00:00:00.000Z
---
```

**Library** (new writes): existing fields plus `locked: false`. Missing `locked` on read → `false`. Do not skip a parseable note solely because `locked` is absent.

Seeded vaults / new domains write `locked: false` and must not write `status` or `forgedAt`.

### 3.3 Write APIs

Create/update/lock take `actor: Actor`. Other log writers (domains, map, goals) may omit actor (`null`).

| Call | Unlocked | Locked | Agent lock |
|------|----------|--------|------------|
| `saveDocument` / `libraryUpdate` | write + `document.updated` | error, no write | n/a |
| `libraryCreate` | write unlocked + `document.created` | n/a (always unlocked) | n/a |
| `setDocumentLocked` / `librarySetLocked` | persist flag + `document.lock_changed` | same | **reject** |
| `createDecision` | **reject** (edit in place) | pending Decision + `decision.created` | n/a |
| Agent `update_document` | same as save | `createDecision`, no file write | n/a |

User IPC always passes `{ type: "user" }`. Agent tools always pass the agent actor. There is no lock IPC for agents.

`documentSetStatus` IPC is replaced by `documentSetLocked(slug, kind, locked)` and `librarySetLocked(id, locked)`.

`decisionCreate` IPC takes `target`, proposed/previous title and body, optional rationale. Headline is derived. Actor is user for renderer IPC.

Approve: load target file; if gone, fail and leave Decision pending; else write proposed title (if `proposedTitle` is non-null) and proposed body; keep `locked`; set Decision approved; `decision.resolved`. Reject: no file write; `decision.resolved`.

Paste/drop images on doctrine remain allowed when **unlocked**; disabled when locked (same as today’s forged editor).

### 3.4 Agent tools

Registered next to map/goals tools (MCP + companion). No lock tool.

| Tool | Behavior |
|------|----------|
| `list_documents` | Live-domain doctrine (four kinds) + live library notes: identity, title, `locked`, domain(s). |
| `get_document` | One doctrine (`domainSlug` + `kind`) or one library `id`. Full body. |
| `create_library_document` | `title`, `body`, optional `domainSlugs`. Unlocked. Fail unknown domain. |
| `update_document` | Same identity as `get_document` + optional `title` / `body`. Unlocked → write. Locked → pending Decision, return `{ decisionId, status: "pending" }`. Never flips `locked`. Domain tags are not in this tool. |

`get_doctrine` stays a convenience read of the four pillars. Companion/MCP system text that forbids rewriting doctrine is updated: agents **may** call `update_document` on those files; lock still applies.

Map/goals tools unchanged.

### 3.5 UI

**Doctrine editor and library note editor**

- Status badge + Refine + Forge → **Locked / Unlocked** control (user only).
- Unlocked: title and body editable; Save; no Propose.
- Locked: fields read-only; helper “Unlock to edit, or propose a change.” Buttons: **Unlock** and **Propose change**.
- Toggle disabled while Save is in flight.
- Propose dialog: document title, body, optional rationale.

**Decisions**

- Copy drops “forged.” Empty: “No pending proposals.”
- Item: document label, domain(s), **who proposed** (You vs agent name), title/body diff. Approve / Reject unchanged.

**Log**

- Document/decision lines include who: “You updated Purpose,” “Hermes updated Budget notes,” “You locked Strategy (How).”
- Legacy events without actor keep today’s summary-only rendering.

**Elsewhere**

- Home progress: `{lockedCount}/{doctrineTotal} locked`.
- Act badge: “Aligned” when How is locked; else “Strategy (How) not locked.”
- Doctrine cards/index: Locked/Unlocked badge, not draft/refined/forged.

### 3.6 Product copy and laws

`PRODUCT.md`: locking Premise → Vision → Purpose → Strategy (How), not forging.

`LAWS/DOCTRINE.md` (one requirement per line, RFC 2119):

1. Locked documents MUST NOT be edited in place.
2. Agents MUST NOT lock or unlock documents.
3. An agent change to a locked document MUST appear as a pending Decision.

Constitution test still matches `MUST NOT be edited in place` on `LAWS/DOCTRINE.md`. Extend it to the new agent lines.

`README.md` vault-identity bullet: frontmatter `locked`, not `status: draft | refined | forged`.

---

## 4. Error handling

- Save while locked → `{ ok: false, error: "Document is locked" }` (or equivalent). File unchanged. User UI: unlock or propose. Agent `update_document` does not take this path.
- Lock toggle with actor `agent` → rejected. No flag change.
- Propose while unlocked, or propose against a missing/deleted library note → fail.
- Approve/reject already-resolved → fail.
- Approve when target file is gone → fail; Decision stays pending.
- Approve after the file changed (user unlocked and edited, or another approve) → still write this proposal’s title/body.
- Agent create with unknown domain tag → fail; no file.
- Read migration never fails vault open for missing `locked` / old `status`.
- If `appendLog` fails after a successful file write, return that error (same as today’s document save). Do not drop actor.

---

## 5. Testing

**vault-core**

- Read-migration: `status: forged` → locked; draft/refined/missing → unlocked; explicit `locked` wins.
- New writes omit `status` / `forgedAt`.
- Save allowed iff unlocked; save-while-locked does not write.
- User lock/unlock persists and logs actor `user`.
- Agent cannot lock/unlock.
- Agent update unlocked writes; locked creates pending Decision and does not write.
- Approve applies title/body, leaves `locked`; reject leaves the file.
- Library create by user and by agent starts unlocked; both log actor.
- Old decision JSON without `target` still lists and resolves as doctrine.
- Log payload includes actor on create/update/lock/decision.

**desktop**

- Editor: unlocked Save; locked read-only + Unlock + Propose; no Refine/Forge.
- Library editor has the same lock/propose behavior.
- Decisions copy, actor label; doctrine and library proposals both resolve.
- Home/Act/index badges say locked, not forged.
- Companion/MCP: `update_document` / `create_library_document` / list/get wired; no lock tool.
- Constitution: `LAWS/DOCTRINE.md` still has in-place edit ban; agent lock ban present.

`npm test` in `packages/vault-core` and `apps/desktop` must pass.

---

## 6. Files (expected)

| Area | Touch |
|------|--------|
| `packages/vault-core/src/types.ts` | Actor, locked docs, Decision target, LifeEvent.actor |
| `packages/vault-core/src/documents.ts` | `assertEditable(locked)`; drop status transitions |
| `packages/vault-core/src/domain-documents.ts` | Read-migration, save, `setDocumentLocked` |
| `packages/vault-core/src/library-documents.ts` | `locked`, log, setLocked, actor |
| `packages/vault-core/src/decisions.ts` | Target, actor, titles, lock gate |
| `packages/vault-core/src/log.ts` | Persist `actor` |
| `packages/vault-core/src/create-vault.ts` / `domains.ts` | Seed `locked: false` |
| `packages/vault-core/src/map/tools.ts` + desktop `map-tools.ts` / `mcp-server.ts` | Document tools |
| `apps/desktop/electron/vault-service.ts` + preload + `ipc.ts` | Replace setStatus; setLocked; generalized decisionCreate |
| `apps/desktop/src/components/documents/*` | Lock chrome, propose dialog |
| `apps/desktop/src/pages/DocumentsPage.tsx` | Lock + propose on library notes |
| `apps/desktop/src/components/decisions/DecisionsInbox.tsx` | Copy + actor |
| `apps/desktop/src/components/log/LifeLogFeed.tsx` | Who |
| `apps/desktop/src/pages/HomePage.tsx` / `ActPage.tsx` / doctrine index | Locked labels |
| `PRODUCT.md`, `README.md`, `LAWS/DOCTRINE.md` | Copy / laws |
| Tests matching §5 | vault-core + desktop |

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Old vaults still have `status`/`forgedAt` | Read-migration; rewrite on next save/toggle only |
| Old pending Decisions lack `target` | Normalize on read as doctrine |
| Two “lock” concepts (document vs room sequence) | UI copy is Locked/Unlocked on the document; do not rename room unlock in this spec |
| Agent writes unlocked docs while user is away | Accepted; user locks when happy; Log shows who |
| Last-approve-wins on stale proposals | Accepted; no auto-dismiss |
| Constitution test tied to DOCTRINE.md wording | Keep `MUST NOT be edited in place`; add agent lines |
