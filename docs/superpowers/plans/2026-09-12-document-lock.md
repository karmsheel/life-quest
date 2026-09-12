# Document Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-way document forge with a user-owned `locked` toggle on doctrine and library notes; agent writes to locked docs become Decisions; the Log records who changed what.

**Architecture:** Drop `draft | refined | forged`. Every document has `locked: boolean`. vault-core write APIs take an `Actor`. Unlocked writes go to the file; locked in-place saves fail; locked agent updates create a pending Decision. Decisions target doctrine or library. Desktop IPC, editors, inbox, log, and agent tools follow that gate.

**Tech Stack:** vault-core (`node:test`), Electron IPC, React 19, existing CSS tokens. No new libraries. No `schemaVersion` bump.

**Spec:** `docs/superpowers/specs/2026-09-12-document-lock-design.md`

## Global Constraints

- Do **not** bump `schemaVersion` (stays `1`)
- Do **not** update `archive/web-skeleton`
- Do **not** rename the `forge-os` skin
- Do **not** change room-unlock or per-row sequence locks
- Only the user may lock/unlock; actor `agent` on a lock call is rejected
- New documents start unlocked; `status: forged` reads as locked; otherwise unlocked
- Persist new frontmatter on the next save or toggle — no vault-wide rewrite
- Propose while unlocked is rejected; last approve wins; unlocking does not dismiss proposals
- Agents cannot create a fifth doctrine kind; library create is always unlocked
- Library delete is user-only, allowed when locked, still unlogged
- After Tasks 1–4, `apps/desktop` typecheck will fail until Tasks 5–8 land. Run vault-core tests after each vault-core task; run desktop tests/typecheck after Task 8
- Commit only files from the current task
- Tests: `npm test -w @lifequest/vault-core -- tests/<file>` and `npm test -w @lifequest/desktop -- tests/<file>`

---

## File Structure

```
packages/vault-core/src/
  types.ts                 # Actor, DocumentTarget, locked docs, DecisionRecord, LifeEvent.actor
  documents.ts             # lockedFromFrontmatter, assertEditable(locked), actorDisplayName
  log.ts                   # persist + normalize actor
  domain-documents.ts      # read-migration, save, setDocumentLocked
  library-documents.ts     # locked, log, setLibraryLocked, actor on create/update
  decisions.ts             # target, actor, titles, lock gate, old-JSON normalize
  create-vault.ts          # seed locked: false
  domains.ts               # new domain files locked: false
  document-tools.ts        # NEW: DOCUMENT_TOOL_DEFS + executeDocumentTool
  index.ts                 # export document tools
packages/vault-core/tests/
  documents.test.ts
  domain-documents.test.ts
  library-documents.test.ts
  decisions.test.ts
  document-tools.test.ts   # NEW
  create-vault.test.ts / domains.test.ts / frontmatter.test.ts
  map-tools.test.ts        # still null for forge_document

apps/desktop/electron/
  vault-service.ts         # setLocked; decisionCreate target; USER_ACTOR
  preload.ts / main.ts     # document:setLocked, library:setLocked
  map-tools.ts / mcp-server.ts  # DOCUMENT_TOOL_DEFS; companion copy
apps/desktop/src/
  vite-env.d.ts
  components/documents/DocumentLockBadge.tsx   # rename from StatusBadge
  components/documents/DocumentStatusBadge.tsx # DELETE
  components/documents/DocumentEditor.tsx
  components/documents/ProposeChangeDialog.tsx
  pages/DocumentsPage.tsx
  components/decisions/DecisionsInbox.tsx
  components/log/LifeLogFeed.tsx
  pages/HomePage.tsx / ActPage.tsx
  components/doctrine/DoctrineIndex.tsx / DoctrineStrip.tsx
  components/settings/SettingsDomains.tsx
  styles/global.css
PRODUCT.md / README.md / LAWS/DOCTRINE.md
apps/desktop/tests/constitution.test.ts / dream-doctrine-shell.test.ts
```

---

### Task 1: Types, lock helpers, log actor, doctrine persist

**Files:**
- Modify: `packages/vault-core/src/types.ts`
- Modify: `packages/vault-core/src/documents.ts`
- Modify: `packages/vault-core/src/log.ts`
- Modify: `packages/vault-core/src/domain-documents.ts`
- Modify: `packages/vault-core/src/create-vault.ts`
- Modify: `packages/vault-core/src/domains.ts`
- Modify: `packages/vault-core/tests/documents.test.ts`
- Modify: `packages/vault-core/tests/domain-documents.test.ts`
- Modify: `packages/vault-core/tests/create-vault.test.ts`
- Modify: `packages/vault-core/tests/domains.test.ts`
- Modify: `packages/vault-core/tests/frontmatter.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter`, `serializeFrontmatter`, `appendLog`, `vaultPaths`, `DOCUMENT_KIND_LABELS`
- Produces: `Actor`, `USER_ACTOR`, `DocumentTarget`, `DoctrineDocument.locked`, `LifeEvent.actor`, `lockedFromFrontmatter`, `assertEditable(locked)`, `actorDisplayName`, `setDocumentLocked`, `saveDocument(..., actor?)`

- [ ] **Step 1: Write the failing tests**

Replace `packages/vault-core/tests/documents.test.ts` with:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actorDisplayName,
  assertEditable,
  lockedFromFrontmatter,
} from "../src/documents.ts";
import { USER_ACTOR } from "../src/types.ts";

describe("lockedFromFrontmatter", () => {
  it("prefers explicit locked boolean", () => {
    assert.equal(lockedFromFrontmatter({ locked: true, status: "draft" }), true);
    assert.equal(lockedFromFrontmatter({ locked: false, status: "forged" }), false);
  });
  it("migrates status forged to locked, else unlocked", () => {
    assert.equal(lockedFromFrontmatter({ status: "forged" }), true);
    assert.equal(lockedFromFrontmatter({ status: "draft" }), false);
    assert.equal(lockedFromFrontmatter({ status: "refined" }), false);
    assert.equal(lockedFromFrontmatter({}), false);
  });
});

describe("assertEditable", () => {
  it("blocks locked", () => {
    const r = assertEditable(true);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /locked/i);
  });
  it("allows unlocked", () => {
    assert.equal(assertEditable(false).ok, true);
  });
});

describe("actorDisplayName", () => {
  it("labels user as You and agent by name", () => {
    assert.equal(actorDisplayName(USER_ACTOR), "You");
    assert.equal(
      actorDisplayName({ type: "agent", id: "a1", name: "Hermes" }),
      "Hermes",
    );
  });
});
```

In `packages/vault-core/tests/frontmatter.test.ts`, change the round-trip data to `{ title: "Why", locked: false, updatedAt: "2026-01-01T00:00:00.000Z" }` and assert `parsed.data.locked === false`. Rename the test to `round-trips title locked and body`.

Replace the status tests in `packages/vault-core/tests/domain-documents.test.ts` (keep the media describe block unchanged). Change the first describe to `"domain documents get/save/lock"` and replace the status cases with:

```ts
  it("setDocumentLocked true → saveDocument fails", async () => {
    const locked = await setDocumentLocked(root, "emotional", "how", true);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    assert.equal(locked.value.locked, true);
    const raw = await fs.readFile(path.join(root, "domains", "emotional", "how.md"), "utf8");
    assert.match(raw, /locked: true/);
    assert.equal(raw.includes("status:"), false);
    assert.equal(raw.includes("forgedAt:"), false);

    const save = await saveDocument(root, "emotional", "how", "should not write");
    assert.equal(save.ok, false);
    if (save.ok) return;
    assert.match(save.error, /locked/i);
  });

  it("setDocumentLocked false allows save again", async () => {
    const unlocked = await setDocumentLocked(root, "emotional", "how", false);
    assert.equal(unlocked.ok, true);
    if (!unlocked.ok) return;
    assert.equal(unlocked.value.locked, false);
    const save = await saveDocument(root, "emotional", "how", "after unlock");
    assert.equal(save.ok, true);
  });

  it("rejects agent lock toggle", async () => {
    const res = await setDocumentLocked(
      root,
      "financial",
      "why",
      true,
      { type: "agent", id: "a1", name: "Hermes" },
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /user/i);
    const doc = await getDocument(root, "financial", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.locked, false);
  });

  it("reads legacy status: forged as locked", async () => {
    const filePath = path.join(root, "domains", "health", "what.md");
    await fs.writeFile(
      filePath,
      "---\ntitle: Vision\nstatus: forged\nforgedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\nlegacy\n",
      "utf8",
    );
    const got = await getDocument(root, "health", "what");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.locked, true);
    assert.equal(got.value.bodyMarkdown.trim(), "legacy");
  });

  it("logs actor on save and lock", async () => {
    const saved = await saveDocument(root, "health", "why", "logged body");
    assert.equal(saved.ok, true);
    const locked = await setDocumentLocked(root, "health", "why", true);
    assert.equal(locked.ok, true);
    const { readLog } = await import("../src/log.ts");
    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const updated = log.value.find((e) => e.type === "document.updated");
    const lockEvt = log.value.find((e) => e.type === "document.lock_changed");
    assert.equal(updated?.actor?.type, "user");
    assert.equal(lockEvt?.actor?.type, "user");
    assert.equal((lockEvt?.payload as { locked?: boolean })?.locked, true);
  });
```

Keep `saveDocument why body x` and `saveDocument can update title when editable`. Change imports: drop `setDocumentStatus`, add `setDocumentLocked`.

In `create-vault.test.ts`, replace `/status: draft/` with `/locked: false/` (both why and premise). In `domains.test.ts`, replace `/status: draft/` with `/locked: false/`, and `domain.documents.premise.status === "draft"` with `domain.documents.premise.locked === false`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/vault-core -- tests/documents.test.ts tests/domain-documents.test.ts tests/create-vault.test.ts tests/domains.test.ts tests/frontmatter.test.ts`

Expected: FAIL — `lockedFromFrontmatter` / `setDocumentLocked` not exported, `status: draft` still in seed files.

- [ ] **Step 3: Implement types, helpers, log actor, doctrine persist**

In `packages/vault-core/src/types.ts`:

- Delete `DOCUMENT_STATUSES` and `DocumentStatus`.
- Add after `DREAM_DOCUMENT_KINDS`:

```ts
export type Actor =
  | { type: "user" }
  | { type: "agent"; id: string; name: string };

export const USER_ACTOR: Actor = { type: "user" };

export type DocumentTarget =
  | { type: "doctrine"; domainSlug: string; kind: DocumentKind }
  | { type: "library"; id: string };
```

- Change `DoctrineDocument` to replace `status` / `forgedAt` with `locked: boolean`.
- Add `actor: Actor | null` to `LifeEvent`.
- Change `LibraryDocument` to add `locked: boolean` (needed by later tasks; seed it in parse in Task 2 — for now add the field so types compile).
- Change `DecisionRecord` now (so later tasks do not fight types):

```ts
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
```

Replace `packages/vault-core/src/documents.ts` entirely:

```ts
import {
  DOCUMENT_KIND_LABELS,
  USER_ACTOR,
  type Actor,
  type DocumentKind,
  type DocumentTarget,
} from "./types.ts";

export function lockedFromFrontmatter(data: Record<string, unknown>): boolean {
  if (typeof data.locked === "boolean") return data.locked;
  return data.status === "forged";
}

export function assertEditable(
  locked: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (locked) {
    return {
      ok: false,
      reason: "Document is locked. Unlock to edit, or propose a change.",
    };
  }
  return { ok: true };
}

export function actorDisplayName(actor: Actor): string {
  return actor.type === "user" ? "You" : actor.name;
}

export function documentTargetLabel(
  target: DocumentTarget,
  fallbackTitle: string,
): string {
  if (target.type === "doctrine") return DOCUMENT_KIND_LABELS[target.kind];
  return fallbackTitle;
}

export { USER_ACTOR };
export type { Actor, DocumentKind, DocumentTarget };
```

In `packages/vault-core/src/log.ts`, persist `actor` and default missing to `null`:

```ts
function asActor(value: unknown): Actor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { type?: unknown; id?: unknown; name?: unknown };
  if (v.type === "user") return { type: "user" };
  if (v.type === "agent" && typeof v.id === "string" && typeof v.name === "string") {
    return { type: "agent", id: v.id, name: v.name };
  }
  return null;
}

// in readLog, after JSON.parse:
const parsed = JSON.parse(line) as LifeEvent & { actor?: unknown };
events.push({ ...parsed, actor: asActor(parsed.actor) });

// in appendLog full object:
actor: event.actor ?? null,
```

Add `import type { Actor, LifeEvent, Result }` and make `appendLog` input include optional `actor?: Actor | null`.

In `packages/vault-core/src/domain-documents.ts`:

- Drop `canTransitionStatus`, `DocumentStatus`, `setDocumentStatus`.
- Import `Actor`, `USER_ACTOR`, `actorDisplayName`, `assertEditable`, `lockedFromFrontmatter` from `./documents.ts` and `./types.ts`.
- `readDoctrineFile`: `locked: lockedFromFrontmatter(data)` — do not set status/forgedAt.
- `readOrCreateDoctrineFile` empty file: `{ title, locked: false, updatedAt: now }`.
- Helper:

```ts
function doctrineMatter(title: string, locked: boolean, updatedAt: string) {
  return { title, locked, updatedAt };
}
```

- `saveDocument(..., title?: string, actor: Actor = USER_ACTOR)`: `assertEditable(existing.locked)`; on fail return `{ ok: false, error: editable.reason }`; write `doctrineMatter(nextTitle, existing.locked, now)`; log `type: "document.updated"`, `summary: `${actorDisplayName(actor)} updated ${DOCUMENT_KIND_LABELS[kind]}``, `payload: { kind, title: nextTitle }`, `actor`.
- Add:

```ts
export async function setDocumentLocked(
  rootPath: string,
  slug: string,
  kind: DocumentKind,
  locked: boolean,
  actor: Actor = USER_ACTOR,
): Promise<Result<DoctrineDocument>> {
  // same file load as saveDocument
  if (actor.type !== "user") {
    return { ok: false, error: "Only the user can lock or unlock documents" };
  }
  if (existing.locked === locked) {
    return { ok: true, value: existing };
  }
  const now = new Date().toISOString();
  const md = serializeFrontmatter(
    doctrineMatter(existing.title, locked, now),
    existing.bodyMarkdown,
  );
  await atomicWriteFile(filePath, md);
  const logRes = await appendLog(paths.root, {
    domainSlug: slug,
    type: "document.lock_changed",
    summary: `${actorDisplayName(actor)} ${locked ? "locked" : "unlocked"} ${DOCUMENT_KIND_LABELS[kind]}`,
    payload: { kind, locked },
    actor,
  });
  if (!logRes.ok) return logRes;
  return { ok: true, value: await readDoctrineFile(filePath, kind) };
}
```

In `create-vault.ts` and `domains.ts`, seed frontmatter `{ title: DOCUMENT_KIND_LABELS[kind], locked: false, updatedAt: now }` (no status/forgedAt).

Temporarily, `decisions.ts` will not typecheck. Leave it until Task 3; vault-core tests use strip-types so Task 1 tests still run. Do **not** change `decisions.ts` in this task except if a test import breaks — they should not.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core -- tests/documents.test.ts tests/domain-documents.test.ts tests/create-vault.test.ts tests/domains.test.ts tests/frontmatter.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/types.ts packages/vault-core/src/documents.ts packages/vault-core/src/log.ts packages/vault-core/src/domain-documents.ts packages/vault-core/src/create-vault.ts packages/vault-core/src/domains.ts packages/vault-core/tests/documents.test.ts packages/vault-core/tests/domain-documents.test.ts packages/vault-core/tests/create-vault.test.ts packages/vault-core/tests/domains.test.ts packages/vault-core/tests/frontmatter.test.ts
git commit -m "feat(vault-core): replace document status with locked flag"
```

---

### Task 2: Library lock, actor, and log

**Files:**
- Modify: `packages/vault-core/src/library-documents.ts`
- Modify: `packages/vault-core/tests/library-documents.test.ts`

**Interfaces:**
- Consumes: `Actor`, `USER_ACTOR`, `assertEditable`, `actorDisplayName`, `appendLog`, `lockedFromFrontmatter`
- Produces: `libraryCreate(..., actor?)`, `libraryUpdate(..., actor?)`, `setLibraryLocked(root, id, locked, actor?)` — create always `locked: false`

- [ ] **Step 1: Write the failing tests**

In `packages/vault-core/tests/library-documents.test.ts`:

- Rename `create writes markdown with empty tags and does not append the life log` to `create writes markdown unlocked and appends document.created`. After create, assert `created.value.locked === false`, raw matches `/locked: false/`, and `logAfter.value.length === logBefore.value.length + 1` with type `document.created` and `actor.type === "user"`.
- Add:

```ts
  it("libraryUpdate while locked fails; setLibraryLocked agent rejected", async () => {
    const created = await libraryCreate(root, { title: "Lock me" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const locked = await setLibraryLocked(root, created.value.id, true);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    assert.equal(locked.value.locked, true);

    const update = await libraryUpdate(root, created.value.id, { bodyMarkdown: "nope" });
    assert.equal(update.ok, false);
    if (update.ok) return;
    assert.match(update.error, /locked/i);

    const agentLock = await setLibraryLocked(
      root,
      created.value.id,
      false,
      { type: "agent", id: "a1", name: "Hermes" },
    );
    assert.equal(agentLock.ok, false);

    const del = await libraryDelete(root, created.value.id);
    assert.equal(del.ok, true);
  });

  it("create by agent logs agent actor and starts unlocked", async () => {
    const created = await libraryCreate(
      root,
      { title: "Agent note" },
      { type: "agent", id: "a1", name: "Hermes" },
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.locked, false);
    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    const evt = [...log.value].reverse().find((e) => e.type === "document.created");
    assert.equal(evt?.actor?.type, "agent");
    if (evt?.actor?.type === "agent") assert.equal(evt.actor.name, "Hermes");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/library-documents.test.ts`

Expected: FAIL — `setLibraryLocked` not exported; create still does not log.

- [ ] **Step 3: Implement library lock + log**

In `parseLibraryFile`, set `locked: lockedFromFrontmatter(data)` (import from `./documents.ts`). Do **not** skip the file if `locked` is missing.

In `writeLibraryFile`, add `locked: record.locked` to frontmatter.

`libraryCreate(root, input, actor: Actor = USER_ACTOR)`: set `locked: false`; after write, `appendLog` with `domainSlug: record.domainSlugs[0] ?? null`, `type: "document.created"`, `summary: `${actorDisplayName(actor)} created ${record.title}``, `payload: { id: record.id, title: record.title }`, `actor`. If log fails, return that error.

`libraryUpdate(root, id, patch, actor: Actor = USER_ACTOR)`: after load, `assertEditable(loaded.value.locked)`; on fail `{ ok: false, error: editable.reason }`; write; log `document.updated` with actor.

Add `setLibraryLocked(root, id, locked, actor: Actor = USER_ACTOR)` mirroring doctrine: reject `actor.type !== "user"`; no-op if already that value; write flag; log `document.lock_changed` with `payload: { id, locked }`.

`libraryDelete` stays unlogged and does **not** check `locked`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core -- tests/library-documents.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/library-documents.ts packages/vault-core/tests/library-documents.test.ts
git commit -m "feat(vault-core): lock and log library notes"
```

---

### Task 3: Decisions for locked doctrine and library

**Files:**
- Modify: `packages/vault-core/src/decisions.ts`
- Modify: `packages/vault-core/tests/decisions.test.ts`

**Interfaces:**
- Consumes: `getDocument`, `saveDocument` is **not** used on approve (write frontmatter directly, keep `locked`), `libraryGet`, `write` via library update path that **bypasses** the lock check on approve
- Produces: `createDecision(root, { target, rationale, proposedTitle, previousTitle, proposedBodyMarkdown, previousBodyMarkdown, actor })`, `normalizeDecision` on list/read, `resolveDecision` applies title/body and leaves `locked`

Approve must write the target file even when locked. Add `applyApprovedBody` inside `decisions.ts` (doctrine: serialize frontmatter with existing `locked`; library: write record with new title/body, keep `locked`). Do not call `saveDocument` / `libraryUpdate` (those reject locked).

- [ ] **Step 1: Write the failing tests**

Replace `packages/vault-core/tests/decisions.test.ts` with a full rewrite that uses lock + the new input shape. Include:

```ts
import { USER_ACTOR } from "../src/types.ts";
import { setDocumentLocked, getDocument, saveDocument } from "../src/domain-documents.ts";
import { libraryCreate, libraryGet, setLibraryLocked } from "../src/library-documents.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

it("approve locked doctrine: body and title apply, locked stays true", async () => {
  assert.equal((await saveDocument(root, "health", "why", "original")).ok, true);
  assert.equal((await setDocumentLocked(root, "health", "why", true)).ok, true);
  const created = await createDecision(root, {
    target: { type: "doctrine", domainSlug: "health", kind: "why" },
    rationale: "Better framing",
    proposedTitle: "Purpose v2",
    previousTitle: "Purpose",
    proposedBodyMarkdown: "proposed why body from decision",
    previousBodyMarkdown: "original\n",
    actor: USER_ACTOR,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.status, "pending");
  assert.equal(created.value.target.type, "doctrine");
  assert.equal(created.value.actor.type, "user");
  assert.match(created.value.title, /Purpose/);

  const resolved = await resolveDecision(root, created.value.id, "approved");
  assert.equal(resolved.ok, true);
  const doc = await getDocument(root, "health", "why");
  assert.equal(doc.ok, true);
  if (!doc.ok) return;
  assert.equal(doc.value.locked, true);
  assert.equal(doc.value.title, "Purpose v2");
  assert.match(doc.value.bodyMarkdown, /proposed why body from decision/);
});

it("createDecision rejects unlocked documents", async () => {
  const created = await createDecision(root, {
    target: { type: "doctrine", domainSlug: "health", kind: "what" },
    proposedTitle: "Vision",
    proposedBodyMarkdown: "nope",
    actor: USER_ACTOR,
  });
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.match(created.error, /locked/i);
});

it("reject leaves library body unchanged; approve writes through lock", async () => {
  const note = await libraryCreate(root, { title: "Budget", bodyMarkdown: "keep" });
  assert.equal(note.ok, true);
  if (!note.ok) return;
  assert.equal((await setLibraryLocked(root, note.value.id, true)).ok, true);
  const created = await createDecision(root, {
    target: { type: "library", id: note.value.id },
    proposedTitle: "Budget",
    previousTitle: "Budget",
    proposedBodyMarkdown: "should never land",
    previousBodyMarkdown: "keep",
    actor: agent,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.actor.type, "agent");
  assert.equal((await resolveDecision(root, created.value.id, "rejected")).ok, true);
  const after = await libraryGet(root, note.value.id);
  assert.equal(after.ok, true);
  if (!after.ok) return;
  assert.equal(after.value.bodyMarkdown, "keep");
  assert.equal(after.value.locked, true);
});

it("reads legacy decision JSON without target as doctrine", async () => {
  const { vaultPaths } = await import("../src/paths.ts");
  const paths = vaultPaths(root);
  await fs.mkdir(paths.decisionsDir, { recursive: true });
  const id = "legacy-decision-id";
  await fs.writeFile(
    paths.decisionJson(id),
    JSON.stringify({
      id,
      domainSlug: "health",
      documentKind: "how",
      status: "pending",
      title: "Old forge proposal",
      rationale: null,
      proposedBodyMarkdown: "legacy body",
      previousBodyMarkdown: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: null,
    }) + "\n",
    "utf8",
  );
  assert.equal((await setDocumentLocked(root, "health", "how", true)).ok, true);
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  const legacy = listed.value.find((d) => d.id === id);
  assert.ok(legacy);
  assert.equal(legacy.target.type, "doctrine");
  if (legacy.target.type === "doctrine") {
    assert.equal(legacy.target.kind, "how");
    assert.equal(legacy.target.domainSlug, "health");
  }
  assert.equal(legacy.actor.type, "user");
  assert.equal(legacy.proposedTitle, null);
  const resolved = await resolveDecision(root, id, "approved");
  assert.equal(resolved.ok, true);
  const doc = await getDocument(root, "health", "how");
  assert.equal(doc.ok, true);
  if (!doc.ok) return;
  assert.match(doc.value.bodyMarkdown, /legacy body/);
  assert.equal(doc.value.title, "Strategy (How)");
});
```

Also keep: cannot resolve already-resolved; createDecision missing document; reject path for doctrine (lock first). Double-resolve: lock how, create, reject, approve fails.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/decisions.test.ts`

Expected: FAIL — `createDecision` still wants `documentKind` / forged.

- [ ] **Step 3: Implement decisions.ts**

Rewrite `createDecision` / `listDecisions` / `resolveDecision`:

`normalizeDecision(raw: Record<string, unknown>): DecisionRecord`:

- If `raw.target` is `{ type: "doctrine", domainSlug, kind }` or `{ type: "library", id }`, use it.
- Else if `raw.documentKind` is a valid kind and `raw.domainSlug` is a string, `target = { type: "doctrine", domainSlug: raw.domainSlug, kind: raw.documentKind }`.
- `domainSlugs`: if array of strings, use it; else if doctrine, `[domainSlug]`; else `[]`.
- `actor`: user if missing (same shape as log `asActor`, default `{ type: "user" }`).
- `proposedTitle` / `previousTitle`: string or `null`.

`createDecision`:

1. Validate `target`, `proposedTitle` (non-empty string), `proposedBodyMarkdown` (string), `actor`.
2. Load target: doctrine `getDocument`; library `libraryGet`. Fail if missing.
3. If doctrine `!doc.locked` or library `!note.locked` → `{ ok: false, error: "Document must be locked before proposing a change" }`.
4. `domainSlugs` = doctrine `[slug]` or library `note.domainSlugs`.
5. `title` = `Proposed change to ${documentTargetLabel(target, proposedTitle)}`.
6. Write JSON; log `decision.created` with `actor`, `domainSlug: domainSlugs[0] ?? null`.

`resolveDecision` approve:

- Doctrine: read file, `lockedFromFrontmatter`, write `{ title: decision.proposedTitle ?? existingTitle, locked, updatedAt: now }` + `proposedBodyMarkdown`.
- Library: load record (including locked); if missing `{ ok: false, error: "Document not found" }` and do **not** mark resolved; else write title (`proposedTitle ?? existing`), body, keep `locked`.
- Then set decision status/resolvedAt; log `decision.resolved` with actor from the decision (the proposer) plus `payload.resolution`. Spec: log who — include `actor: decision.actor` and resolution in payload.

Reject: no file write; same decision/log update.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core -- tests/decisions.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/decisions.ts packages/vault-core/tests/decisions.test.ts
git commit -m "feat(vault-core): decisions target locked doctrine and library"
```

---

### Task 4: Agent document tools

**Files:**
- Create: `packages/vault-core/src/document-tools.ts`
- Create: `packages/vault-core/tests/document-tools.test.ts`
- Modify: `packages/vault-core/src/index.ts`
- Modify: `packages/vault-core/src/map/tools.ts` (do **not** add lock/forge tools; `forge_document` stays unknown)
- Modify: `packages/vault-core/tests/map-tools.test.ts` only if needed to keep `forge_document` → null

**Interfaces:**
- Consumes: `libraryCreate`, `libraryUpdate`, `libraryList`, `libraryGet`, `getDocument`, `saveDocument`, `listDomains` (or `openVault` domains via `listDomains`), `createDecision`
- Produces: `DOCUMENT_TOOL_DEFS`, `executeDocumentTool(root, actor, name, args)`

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/document-tools.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { setDocumentLocked, getDocument } from "../src/domain-documents.ts";
import { DOCUMENT_TOOL_DEFS, executeDocumentTool } from "../src/document-tools.ts";
import { listDecisions } from "../src/decisions.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

describe("document tools", () => {
  let dir: string;
  let root: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-doc-tools-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Tools")).ok, true);
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exports list_documents get_document create_library_document update_document and no lock tool", () => {
    const names = DOCUMENT_TOOL_DEFS.map((t) => t.name);
    assert.deepEqual(
      names.sort(),
      ["create_library_document", "get_document", "list_documents", "update_document"].sort(),
    );
    assert.equal(names.includes("lock_document"), false);
    assert.equal(names.includes("set_document_locked"), false);
  });

  it("create_library_document then update unlocked writes", async () => {
    const created = await executeDocumentTool(root, agent, "create_library_document", {
      title: "From agent",
      body: "v1",
      domainSlugs: ["health"],
    });
    const rec = created as { record?: { id: string; locked: boolean } };
    assert.equal(rec.record?.locked, false);
    const updated = await executeDocumentTool(root, agent, "update_document", {
      id: rec.record!.id,
      body: "v2",
    });
    assert.equal((updated as { record?: { bodyMarkdown: string } }).record?.bodyMarkdown, "v2");
  });

  it("update_document on locked doctrine creates a pending decision", async () => {
    assert.equal((await setDocumentLocked(root, "health", "why", true)).ok, true);
    const result = await executeDocumentTool(root, agent, "update_document", {
      domainSlug: "health",
      kind: "why",
      title: "Purpose",
      body: "agent proposal",
    });
    const pending = result as { decisionId?: string; status?: string };
    assert.equal(pending.status, "pending");
    assert.ok(pending.decisionId);
    const doc = await getDocument(root, "health", "why");
    assert.equal(doc.ok, true);
    if (!doc.ok) return;
    assert.equal(doc.value.bodyMarkdown.includes("agent proposal"), false);
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.ok(listed.value.some((d) => d.id === pending.decisionId && d.actor.type === "agent"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/document-tools.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement document-tools.ts and export it**

Create `packages/vault-core/src/document-tools.ts`:

- Reuse the `MapToolDef` shape (import type from `./map/tools.ts`) so MCP registration stays one loop.
- `DOCUMENT_TOOL_DEFS` with:
  - `list_documents` — no required args
  - `get_document` — `id?`, `domainSlug?`, `kind?`
  - `create_library_document` — required `title`; `body?`, `domainSlugs?`
  - `update_document` — `id?`, `domainSlug?`, `kind?`, `title?`, `body?`
- `executeDocumentTool`:
  - `list_documents`: live domains’ four docs + `libraryList` records. Each item `{ type, id?, domainSlug?, kind?, title, locked, domainSlugs }`.
  - `get_document`: if `id` string → `libraryGet` (full record); else `getDocument(domainSlug, kind)`.
  - `create_library_document`: `libraryCreate(root, { title, bodyMarkdown: body ?? "", domainSlugs }, actor)` → `{ record }`.
  - `update_document`: resolve target; if unlocked, `saveDocument` or `libraryUpdate` with actor → `{ record }`; if locked, `createDecision` with `proposedTitle: title ?? currentTitle`, `proposedBodyMarkdown: body ?? currentBody` → `{ decisionId, status: "pending" }`.
  - unknown name → `{ error: { code: "MALFORMED", message: "Unknown tool" } }`.

Export `DOCUMENT_TOOL_DEFS` and `executeDocumentTool` from `packages/vault-core/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core -- tests/document-tools.test.ts tests/map-tools.test.ts`

Expected: PASS (`forge_document` still null)

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/document-tools.ts packages/vault-core/src/index.ts packages/vault-core/tests/document-tools.test.ts
git commit -m "feat(vault-core): add document agent tools"
```

---

### Task 5: Electron IPC and companion/MCP wiring

**Files:**
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/electron/map-tools.ts`
- Modify: `apps/desktop/electron/mcp-server.ts`
- Modify: `apps/desktop/tests/dream-doctrine-shell.test.ts` (IPC names if it mentions `setStatus`)

**Interfaces:**
- Consumes: `setDocumentLocked`, `setLibraryLocked`, `createDecision` new input, `USER_ACTOR`, `DOCUMENT_TOOL_DEFS`, `executeDocumentTool`
- Produces: `documentSetLocked`, `librarySetLocked`, `decisionCreate({ target, proposedTitle, previousTitle, proposedBodyMarkdown, previousBodyMarkdown, rationale })`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/dream-doctrine-shell.test.ts`, add:

```ts
describe("document lock IPC", () => {
  it("exposes documentSetLocked and librarySetLocked, not documentSetStatus", () => {
    const service = read("electron/vault-service.ts");
    assert.match(service, /export async function documentSetLocked/);
    assert.match(service, /export async function librarySetLocked/);
    assert.equal(service.includes("documentSetStatus"), false);
    const main = read("electron/main.ts");
    assert.match(main, /document:setLocked/);
    assert.match(main, /library:setLocked/);
    assert.equal(main.includes("document:setStatus"), false);
    const preload = read("electron/preload.ts");
    assert.match(preload, /documentSetLocked/);
    assert.match(preload, /librarySetLocked/);
  });
});

describe("document tools wiring", () => {
  it("registers DOCUMENT_TOOL_DEFS and executeDocumentTool", () => {
    const mapTools = read("electron/map-tools.ts");
    assert.match(mapTools, /DOCUMENT_TOOL_DEFS/);
    assert.match(mapTools, /executeDocumentTool/);
    assert.match(mapTools, /update_document/);
    const mcp = read("electron/mcp-server.ts");
    assert.match(mcp, /DOCUMENT_TOOL_DEFS/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: FAIL — `documentSetLocked` missing.

- [ ] **Step 3: Wire IPC and tools**

`vault-service.ts`:

- Import `setDocumentLocked`, `setLibraryLocked`, `USER_ACTOR`, drop `setDocumentStatus` / `DocumentStatus`.
- `documentSave` / `libraryCreateCall` / `libraryUpdateCall` pass `USER_ACTOR`.
- Replace `documentSetStatus` with:

```ts
export async function documentSetLocked(
  slug: string,
  kind: DocumentKind,
  locked: boolean,
): Promise<Result<DoctrineDocument>> {
  return withVault(async (root) => {
    const res = await setDocumentLocked(root, slug, kind, locked, USER_ACTOR);
    if (res.ok) {
      const filePath = vaultPaths(root).documentMd(slug, kind);
      doctrineMtimes.set(filePath, res.value.mtimeMs);
    }
    return res;
  });
}

export async function librarySetLocked(
  id: string,
  locked: boolean,
): Promise<Result<LibraryDocument>> {
  return withVault((root) => setLibraryLocked(root, id, locked, USER_ACTOR));
}
```

- `decisionCreate(input: { target: DocumentTarget; rationale?: string | null; proposedTitle: string; previousTitle?: string | null; proposedBodyMarkdown: string; previousBodyMarkdown?: string | null })` passes `actor: USER_ACTOR`.
- `decisionResolve` on approve: also refresh if library (no mtime map required).

`preload.ts`: replace `documentSetStatus` with `documentSetLocked(slug, kind, locked)` → `document:setLocked`; add `librarySetLocked(id, locked)` → `library:setLocked`.

`main.ts`: same channel swap; `library:setLocked` handler.

`vite-env.d.ts`: drop `DocumentStatus`; `documentSetLocked(slug, kind, locked: boolean)`; `librarySetLocked(id, locked: boolean)`; `decisionCreate` input uses `target: DocumentTarget` and proposed/previous titles.

`map-tools.ts`:

- Import `DOCUMENT_TOOL_DEFS` and `executeDocumentTool`. Agent actor is always `{ type: "agent", id: "companion", name: "Hermes" }`.
- `openaiTools = [...MAP_TOOL_DEFS, ...GOALS_TOOL_DEFS, ...DOCUMENT_TOOL_DEFS]`
- In `executeTool`, before map command: if `DOCUMENT_TOOL_DEFS.some(t => t.name === name)` return `executeDocumentTool(root, agentActor, name, rec)`. Keep `get_doctrine` as today.
- Change SYSTEM from “Do not rewrite Premise…” to: `You may update Premise, Vision, Purpose, Strategy (How), and library notes with update_document / create_library_document. If a document is locked, your update becomes a pending Decision. You cannot lock or unlock documents.`

`mcp-server.ts`: register `[...MAP_TOOL_DEFS, ...GOALS_TOOL_DEFS, ...DOCUMENT_TOOL_DEFS]`. `executeTool` already routes by name once map-tools handles document tools.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/vault-service.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/src/vite-env.d.ts apps/desktop/electron/map-tools.ts apps/desktop/electron/mcp-server.ts apps/desktop/tests/dream-doctrine-shell.test.ts
git commit -m "feat(desktop): IPC and agent tools for document lock"
```

---

### Task 6: Doctrine editor lock chrome

**Files:**
- Create: `apps/desktop/src/components/documents/DocumentLockBadge.tsx`
- Delete: `apps/desktop/src/components/documents/DocumentStatusBadge.tsx`
- Modify: `apps/desktop/src/components/documents/DocumentEditor.tsx`
- Modify: `apps/desktop/src/components/documents/ProposeChangeDialog.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/src/components/doctrine/DoctrineIndex.tsx`
- Modify: `apps/desktop/src/components/doctrine/DoctrineStrip.tsx`
- Modify: `apps/desktop/tests/dream-doctrine-shell.test.ts`

**Interfaces:**
- Consumes: `assertEditable(doc.locked)`, `api().documentSetLocked`, `api().decisionCreate({ target, ... })`
- Produces: lock badge; editor Save vs Unlock + Propose; propose dialog edits title + body

- [ ] **Step 1: Write the failing test**

Add to `dream-doctrine-shell.test.ts`:

```ts
describe("DocumentEditor lock", () => {
  it("uses lock toggle and Propose, not Refine/Forge", () => {
    const src = read("src/components/documents/DocumentEditor.tsx");
    assert.match(src, /documentSetLocked/);
    assert.match(src, /Unlock to edit, or propose a change/);
    assert.match(src, /Propose change/);
    assert.equal(src.includes("Mark refined"), false);
    assert.equal(src.includes(">Forge<") || src.includes("Forge\n"), false);
    assert.equal(src.includes("canForge"), false);
    assert.equal(src.includes("documentSetStatus"), false);
  });
});
```

Also change any `DocumentStatusBadge` / `doc?.status` assertions in this file to `DocumentLockBadge` / `locked`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: FAIL — Forge still in editor.

- [ ] **Step 3: Implement editor + badge + dialog**

`DocumentLockBadge.tsx`:

```tsx
export function DocumentLockBadge({ locked }: { locked: boolean }) {
  const label = locked ? "Locked" : "Unlocked";
  return (
    <span
      className={`doc-status-badge doc-status-badge--${locked ? "locked" : "unlocked"}`}
      data-locked={locked ? "true" : "false"}
    >
      {label}
    </span>
  );
}
```

Delete `DocumentStatusBadge.tsx`. Switch every import (`DoctrineIndex`, `DoctrineStrip`, `HomePage`, `ActPage`) to `DocumentLockBadge locked={doc?.locked ?? false}`. Home/Act *copy* still says forged until Task 8.

CSS: replace `--draft/--refined/--forged` with:

```css
.doc-status-badge--unlocked { color: var(--muted); }
.doc-status-badge--locked {
  color: var(--success);
  border-color: var(--success);
}
```

Rename `.doc-editor__forged-hint` to `.doc-editor__lock-hint` (or keep the class and change copy only).

`DocumentEditor.tsx`:

- Drop `DocumentStatus`, `canTransitionStatus`, `onStatus`.
- `const locked = document.locked;` `const editable = assertEditable(locked);`
- Replace `isForged` with `locked`.
- Header badge: `<DocumentLockBadge locked={locked} />`
- Hint when locked: `Unlock to edit, or propose a change.`
- Actions unlocked: Save + button `Lock` calling `api().documentSetLocked(slug, kind, true)` then `refresh` + `load({ quiet: true })`.
- Actions locked: `Unlock` → `documentSetLocked(slug, kind, false)`; `Propose change` opens dialog.
- Disable lock toggle while `busy`.
- Paste/drop only when `!locked`.

`ProposeChangeDialog.tsx` props:

```ts
{
  open: boolean;
  target: DocumentTarget;
  currentTitle: string;
  currentBody: string;
  onClose: () => void;
  onSubmitted?: () => void;
}
```

Fields: title (prefilled `currentTitle`), body (prefilled `currentBody`), optional rationale. Submit:

```ts
await api().decisionCreate({
  target,
  proposedTitle: title.trim(),
  previousTitle: currentTitle,
  proposedBodyMarkdown: proposedBody,
  previousBodyMarkdown: currentBody,
  rationale: rationale.trim() || null,
});
```

Copy: drop “Forged documents stay read-only…”. Use “This proposal goes to Decisions. The document stays locked.”

Editor passes `target={{ type: "doctrine", domainSlug: slug, kind }}` and `currentTitle={document.title}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/documents apps/desktop/src/components/doctrine apps/desktop/src/styles/global.css apps/desktop/tests/dream-doctrine-shell.test.ts
git commit -m "feat(desktop): lock toggle on doctrine editor"
```

---

### Task 7: Library page, Decisions inbox, Log who

**Files:**
- Modify: `apps/desktop/src/pages/DocumentsPage.tsx`
- Modify: `apps/desktop/src/components/decisions/DecisionsInbox.tsx`
- Modify: `apps/desktop/src/components/log/LifeLogFeed.tsx`
- Create: `apps/desktop/tests/document-lock-shell.test.ts`

**Interfaces:**
- Consumes: `librarySetLocked`, `decisionCreate` library target, `recordVisibleMulti`, `actorDisplayName` from `@lifequest/vault-core/pure`, `DOCUMENT_KIND_LABELS`
- Produces: library lock/propose UX; inbox actor + multi-domain filter; log who

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/document-lock-shell.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

describe("library lock UI", () => {
  it("DocumentsPage can lock, unlock, and propose", () => {
    const src = read("src/pages/DocumentsPage.tsx");
    assert.match(src, /librarySetLocked/);
    assert.match(src, /Propose change/);
    assert.match(src, /type: "library"/);
  });
});

describe("Decisions inbox", () => {
  it("drops forged copy and shows who proposed", () => {
    const src = read("src/components/decisions/DecisionsInbox.tsx");
    assert.equal(/forged/i.test(src), false);
    assert.match(src, /No pending proposals/);
    assert.match(src, /actorDisplayName|You/);
    assert.match(src, /recordVisibleMulti/);
    assert.match(src, /domainSlugs/);
  });
});

describe("Life log actor", () => {
  it("renders who on document and decision events", () => {
    const src = read("src/components/log/LifeLogFeed.tsx");
    assert.match(src, /actorDisplayName/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/document-lock-shell.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement library page, inbox, log**

**DocumentsPage:** when `editingId` is set, track `editingLocked` from the loaded note. Composer:

- New note: current fields; no lock control.
- Existing unlocked: Save, Delete, **Lock** (`librarySetLocked(id, true)` then reload).
- Existing locked: title/body/tags `readOnly`; helper “Unlock to edit, or propose a change.”; **Unlock**; **Propose change** opening `ProposeChangeDialog` with `target: { type: "library", id: editingId }`; Delete still enabled.

**DecisionsInbox:**

- Filter: `recordVisibleMulti(lens, d.domainSlugs)`.
- Header: “Proposals to locked documents. Approve or reject.”
- Empty pending: “No pending proposals.”
- Meta line: `{actorDisplayName(d.actor)} · {domain labels from d.domainSlugs} · {target label} · {when}`
  - doctrine target label = `DOCUMENT_KIND_LABELS[kind]`
  - library = `d.proposedTitle ?? d.title`
- Show proposed vs previous **title** when they differ; keep body blocks.

**LifeLogFeed:** next to `e.summary`, if `e.actor` show `actorDisplayName(e.actor)` (summaries already include who from vault-core; still render a muted actor chip so legacy lines without actor stay summary-only). Prefer: if `e.actor`, prefix or suffix is optional because summary already has “You updated…”. Spec: “Each document/decision line includes who.” Summaries from Tasks 1–3 already do. For legacy, omit. Implement: `{e.actor ? <span className="muted">{actorDisplayName(e.actor)}</span> : null}` beside the summary so new events show it twice unless you **stop duplicating** — then either:

- Keep vault-core summaries as today (`Updated why for health`) and let the UI add who, **or**
- Keep the new summaries that include who and skip the extra chip.

**Use the UI chip and keep vault-core summaries including who** is redundant. **Decision: UI chip from `e.actor`; vault-core summaries already include who (Task 1). Show summary only; chip only when you want a structured label.** Spec UI: “You updated Purpose”. Task 1 summaries already match. **Inbox/Log: render `e.summary` as-is.** Test should then assert `actorDisplayName` is imported **or** that summaries are displayed (`e.summary`). Change the test to `assert.match(src, /e\.summary/)` AND `assert.match(src, /e\.actor/)` so the feed does not drop actor data from the DOM — render actor when present as a `data-actor` attribute on the row:

```tsx
<li data-actor={e.actor ? actorDisplayName(e.actor) : undefined}>{e.summary}</li>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/desktop -- tests/document-lock-shell.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/DocumentsPage.tsx apps/desktop/src/components/decisions/DecisionsInbox.tsx apps/desktop/src/components/log/LifeLogFeed.tsx apps/desktop/tests/document-lock-shell.test.ts
git commit -m "feat(desktop): library lock, decisions actor, log who"
```

---

### Task 8: Home, Act, settings, laws, copy

**Files:**
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsDomains.tsx`
- Modify: `PRODUCT.md`
- Modify: `README.md`
- Modify: `LAWS/DOCTRINE.md`
- Modify: `apps/desktop/tests/constitution.test.ts`
- Modify: `docs/superpowers/specs/2026-09-12-document-lock-design.md` (status line only)

**Interfaces:**
- Consumes: `doc.locked`, `DocumentLockBadge`, `d.domainSlugs` on decisions
- Produces: locked counts/copy; RFC laws; constitution assertions

- [ ] **Step 1: Write the failing tests**

In `constitution.test.ts`, keep `MUST NOT be edited in place` and add:

```ts
assert.match(read("LAWS/DOCTRINE.md"), /Agents MUST NOT lock or unlock/);
assert.match(read("LAWS/DOCTRINE.md"), /pending Decision/);
```

Add to `document-lock-shell.test.ts` (or this file):

```ts
it("Home and Act say locked not forged", () => {
  const home = read("src/pages/HomePage.tsx");
  assert.match(home, /locked/);
  assert.equal(/forged/i.test(home), false);
  const act = read("src/pages/ActPage.tsx");
  assert.match(act, /not locked/);
  assert.equal(/forged/i.test(act), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/desktop -- tests/constitution.test.ts tests/document-lock-shell.test.ts`

Expected: FAIL — Home still says forged.

- [ ] **Step 3: Update copy and remaining UI**

HomePage: `lockedCount` via `doc?.locked`; progress `{lockedCount}/{doctrineTotal} locked`; `DocumentLockBadge locked={doc?.locked ?? false}`; pending empty “No pending proposals.”; filter pending decisions with `recordVisibleMulti(lens, d.domainSlugs)`.

ActPage: `howLocked = ...documents.how?.locked`; badge “Aligned” / “Strategy (How) not locked”; drop Forge sentences; `DocumentLockBadge`.

SettingsDomains: `${DOCUMENT_KIND_LABELS[kind]}: ${doc?.locked ? "locked" : "unlocked"}`.

`PRODUCT.md` users line: “locking Premise → Vision → Purpose → Strategy (How)”.

`README.md` vault-identity: “Doctrine is Markdown with frontmatter (`locked: true | false`).”

`LAWS/DOCTRINE.md`:

```
Locked documents MUST NOT be edited in place.
Agents MUST NOT lock or unlock documents.
An agent change to a locked document MUST appear as a pending Decision.
```

Spec header status: `Approved — implementation plan ready (\`docs/superpowers/plans/2026-09-12-document-lock.md\`)`.

Grep remaining `DocumentStatus`, `documentSetStatus`, `status === "forged"`, `canTransitionStatus` under `apps/desktop` and `packages/vault-core` (except `archive/` and historical specs/plans) and fix stragglers.

- [ ] **Step 4: Run full tests + typecheck**

Run:

```
npm test -w @lifequest/vault-core
npm test -w @lifequest/desktop
npm run typecheck -w @lifequest/desktop
```

Expected: all PASS, typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/HomePage.tsx apps/desktop/src/pages/ActPage.tsx apps/desktop/src/components/settings/SettingsDomains.tsx PRODUCT.md README.md LAWS/DOCTRINE.md apps/desktop/tests/constitution.test.ts apps/desktop/tests/document-lock-shell.test.ts docs/superpowers/specs/2026-09-12-document-lock-design.md
git commit -m "feat: lock copy, laws, and remaining document chrome"
```

---

## Self-review (planner)

**Spec coverage**

| Spec | Task |
|------|------|
| `locked` flag, drop status/forgedAt/Refine/Forge | 1, 6 |
| Read-migration forged → locked | 1 |
| Seed unlocked, no schema bump | 1 |
| User-only toggle; agent lock rejected | 1, 2 |
| Unlocked in-place writes + log actor | 1, 2 |
| Locked save fails; user unlock or propose | 1, 3, 6, 7 |
| Agent update locked → Decision | 4 |
| Approve title/body, keep locked; reject no write | 3 |
| Last approve wins; unlock does not dismiss | 3 (no auto-dismiss code) |
| Library create always unlocked; unknown domain fail | 2, 4 |
| Library delete allowed when locked, unlogged | 2 |
| Decision target + old JSON normalize | 3 |
| Inbox filter `domainSlugs` | 7 |
| Propose dialog title+body, derived headline | 3, 6 |
| Document tools, no lock tool, `get_doctrine` stays | 4, 5 |
| Companion/MCP copy | 5 |
| Home/Act/index locked labels | 6, 8 |
| PRODUCT/README/LAWS | 8 |
| archive/web-skeleton untouched | global |
| Presence out of scope | no task |

**Type names used throughout:** `Actor`, `USER_ACTOR`, `DocumentTarget`, `setDocumentLocked`, `setLibraryLocked`, `lockedFromFrontmatter`, `assertEditable(locked)`, `actorDisplayName`, `createDecision({ target, proposedTitle, ... })`, `DOCUMENT_TOOL_DEFS`, `executeDocumentTool`.
