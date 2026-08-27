# Life Signal Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vault-native Life Signal Chain — sidebar page, manual dump composer, and day-grouped timeline — stored as one JSON file per signal, separate from Life log.

**Architecture:** `packages/vault-core` owns `SignalRecord` and CRUD under `.lifequest/signal-chain/<id>.json`. Electron main exposes four IPC methods; the renderer fetches its own list (not `VaultSnapshot`). Day grouping and filters are pure helpers in the desktop app.

**Tech Stack:** TypeScript, Node `fs/promises`, `atomicWriteFile`, Electron IPC, Vite + React 19, React Router HashRouter, lucide-react `Radio`, CSS variables. Tests: `node --experimental-strip-types --test`.

**Spec:** `docs/superpowers/specs/2026-08-27-life-signal-chain-design.md`

## Global Constraints

- Do **not** bump `SCHEMA_VERSION` (stays `1`); create `signal-chain/` on first write
- Do **not** load signals into `VaultSnapshot`
- Do **not** append Life log events for signal create/update/delete
- Do **not** unlink files on delete — set `deletedAt`
- v1 IPC always writes `source: "manual"` and `sourceRef: null`; no source picker in the UI
- Do **not** implement Notion, HTTP ingest, restore-deleted, or pagination
- Do **not** edit in-progress theme/skin files (`ThemeToggle.tsx`, `theme.ts`, `themes/**`, `tokens.css`, `NavThemeModeToggle.tsx`, `SkinPicker.tsx`, `SettingsAppearance.tsx`, `public/theme-boot.js`)
- Prefer `nav-items.ts` for the new nav entry; only touch `NavRail.tsx` if strictly required (it should not be)
- Nav: main section, **after Domains**, label **Chain**, href `/chain`, icon Lucide `Radio`, no room lock
- Page title **Life Signal Chain**; description **Dump thoughts, ideas, and things you notice.**
- Atomic writes only (`atomicWriteFile`)
- Path traversal: ids go through `safeJoin`
- List is skip-tolerant: bad files increment `skipped`, do not fail the list
- Existing vaults without the folder → empty chain, not an error
- Keep the diff off uncommitted theme work; if `App.tsx` / `nav-items.ts` are already dirty, only add Chain on top

---

## File Structure

```
packages/vault-core/
  src/types.ts                         # SIGNAL_TYPES, SIGNAL_SOURCES, SignalRecord, create/update/list types
  src/paths.ts                         # signalChainDir, signalChainJson(id)
  src/signal-chain.ts                  # NEW: list/create/update/delete + parse guard
  src/index.ts                         # re-export signal-chain
  tests/signal-chain.test.ts           # NEW

apps/desktop/
  electron/vault-service.ts            # signalChainList/Create/Update/Delete
  electron/main.ts                     # ipcMain.handle
  electron/preload.ts                  # contextBridge methods
  src/vite-env.d.ts                    # LifequestApi types
  src/lib/signal-chain.ts              # NEW: day grouping + filters (pure)
  src/lib/signal-chain.test.ts         # NEW
  src/components/shell/nav-items.ts    # Chain nav item
  src/App.tsx                          # /chain route
  src/pages/ChainPage.tsx              # NEW
  src/components/signal-chain/SignalChainFeed.tsx  # NEW
  src/styles/global.css                # chain styles only
```

No changes to `open-vault.ts`, `create-vault.ts`, `VaultProvider.tsx`, or `log.ts`.

---

### Task 1: vault-core signal chain

**Files:**
- Create: `packages/vault-core/src/signal-chain.ts`
- Create: `packages/vault-core/tests/signal-chain.test.ts`
- Modify: `packages/vault-core/src/types.ts` (append after `LifeEvent`)
- Modify: `packages/vault-core/src/paths.ts` (`vaultPaths` return object)
- Modify: `packages/vault-core/src/index.ts` (add export)

**Interfaces:**
- Consumes: `atomicWriteFile`, `vaultPaths`, `Result`, `createVault`, `readLog`
- Produces:
  - `SIGNAL_TYPES`, `SIGNAL_SOURCES`, `SignalType`, `SignalSource`, `SignalRecord`, `SignalCreateInput`, `SignalUpdatePatch`, `SignalChainListResult`
  - `listSignals(rootPath: string): Promise<Result<SignalChainListResult>>`
  - `createSignal(rootPath: string, input: SignalCreateInput): Promise<Result<SignalRecord>>`
  - `updateSignal(rootPath: string, id: string, patch: SignalUpdatePatch): Promise<Result<SignalRecord>>`
  - `deleteSignal(rootPath: string, id: string): Promise<Result<SignalRecord>>`
  - `vaultPaths(root).signalChainDir: string`
  - `vaultPaths(root).signalChainJson(id: string): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/vault-core/tests/signal-chain.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { readLog } from "../src/log.ts";
import { vaultPaths } from "../src/paths.ts";
import {
  createSignal,
  deleteSignal,
  listSignals,
  updateSignal,
} from "../src/signal-chain.ts";
import type { SignalRecord } from "../src/types.ts";

async function writeSignalFile(
  root: string,
  record: SignalRecord,
): Promise<void> {
  const filePath = vaultPaths(root).signalChainJson(record.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

describe("signal-chain", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-signals-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "SignalTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing folder lists empty without error", async () => {
    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.value, { records: [], skipped: 0 });
  });

  it("create writes pretty JSON with manual source and matching timestamps", async () => {
    const created = await createSignal(root, {
      type: "thought",
      body: "  noticed the stall  ",
      title: "  ",
      domainSlug: "health",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.type, "thought");
    assert.equal(created.value.body, "noticed the stall");
    assert.equal(created.value.title, null);
    assert.equal(created.value.domainSlug, "health");
    assert.equal(created.value.source, "manual");
    assert.equal(created.value.sourceRef, null);
    assert.equal(created.value.deletedAt, null);
    assert.equal(created.value.createdAt, created.value.updatedAt);
    assert.ok(created.value.id);

    const filePath = vaultPaths(root).signalChainJson(created.value.id);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /\n  "type": "thought"/);
    assert.equal(raw.endsWith("\n"), true);

    const log = await readLog(root);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    assert.equal(log.value.length, 0);
  });

  it("list returns newest createdAt first and omits soft-deleted rows", async () => {
    const older: SignalRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      type: "idea",
      source: "manual",
      sourceRef: null,
      title: "older",
      body: "older body",
      domainSlug: null,
    };
    const newer: SignalRecord = {
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      deletedAt: null,
      type: "notice",
      source: "manual",
      sourceRef: null,
      title: "newer",
      body: "newer body",
      domainSlug: "financial",
    };
    const gone: SignalRecord = {
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      deletedAt: "2026-07-02T00:00:00.000Z",
      type: "other",
      source: "manual",
      sourceRef: null,
      title: null,
      body: "deleted",
      domainSlug: null,
    };
    await writeSignalFile(root, older);
    await writeSignalFile(root, newer);
    await writeSignalFile(root, gone);

    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const ids = listed.value.records.map((r) => r.id);
    assert.equal(ids.includes(gone.id), false);
    const olderIdx = ids.indexOf(older.id);
    const newerIdx = ids.indexOf(newer.id);
    assert.ok(newerIdx >= 0 && olderIdx >= 0);
    assert.ok(newerIdx < olderIdx);
  });

  it("update changes fields, bumps updatedAt, leaves createdAt", async () => {
    const created = await createSignal(root, {
      type: "thought",
      body: "original",
      domainSlug: "health",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const before = created.value.createdAt;

    const updated = await updateSignal(root, created.value.id, {
      type: "idea",
      body: "edited",
      title: "Title",
      domainSlug: "intellectual",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.type, "idea");
    assert.equal(updated.value.body, "edited");
    assert.equal(updated.value.title, "Title");
    assert.equal(updated.value.domainSlug, "intellectual");
    assert.equal(updated.value.createdAt, before);
    assert.ok(updated.value.updatedAt >= before);
    assert.equal(updated.value.source, "manual");
  });

  it("delete sets deletedAt; list omits it; second delete is not found", async () => {
    const created = await createSignal(root, {
      type: "notice",
      body: "to delete",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const deleted = await deleteSignal(root, created.value.id);
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    assert.ok(deleted.value.deletedAt);

    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.id === created.value.id),
      false,
    );

    const again = await deleteSignal(root, created.value.id);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.error, "Signal not found");

    const filePath = vaultPaths(root).signalChainJson(created.value.id);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /"deletedAt": "/);
  });

  it("rejects empty body, unknown type, and unknown domain", async () => {
    const empty = await createSignal(root, { type: "thought", body: "   " });
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.error, "body is required");

    const badType = await createSignal(root, {
      type: "nope" as "thought",
      body: "x",
    });
    assert.equal(badType.ok, false);
    if (badType.ok) return;
    assert.match(badType.error, /Invalid signal type/);

    const badDomain = await createSignal(root, {
      type: "thought",
      body: "x",
      domainSlug: "not-a-domain",
    });
    assert.equal(badDomain.ok, false);
    if (badDomain.ok) return;
    assert.match(badDomain.error, /Unknown domain/);
  });

  it("rejects path traversal in id", async () => {
    const updated = await updateSignal(root, "../outside", { body: "nope" });
    assert.equal(updated.ok, false);

    const deleted = await deleteSignal(root, "..\\outside");
    assert.equal(deleted.ok, false);
  });

  it("skips malformed JSON without failing the list", async () => {
    const paths = vaultPaths(root);
    await fs.mkdir(paths.signalChainDir, { recursive: true });
    await fs.writeFile(
      path.join(paths.signalChainDir, "not-json.json"),
      "{nope",
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.signalChainDir, "bad-shape.json"),
      `${JSON.stringify({ id: "x" })}\n`,
      "utf8",
    );

    const listed = await listSignals(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.ok(listed.value.skipped >= 2);
    assert.equal(Array.isArray(listed.value.records), true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
npm test -w @lifequest/vault-core -- tests/signal-chain.test.ts
```

If workspace forwarding is picky, from repo root:

```
node --experimental-strip-types --test packages/vault-core/tests/signal-chain.test.ts
```

Expected: FAIL with `Cannot find module` / `signal-chain.ts` not found (or `listSignals` not exported).

- [ ] **Step 3: Add types**

In `packages/vault-core/src/types.ts`, insert **after** the `LifeEvent` type and **before** `DecisionRecord`:

```ts
export const SIGNAL_TYPES = ["thought", "idea", "notice", "other"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_SOURCES = ["manual", "automation", "notion"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export type SignalRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  type: SignalType;
  source: SignalSource;
  sourceRef: string | null;
  title: string | null;
  body: string;
  domainSlug: string | null;
};

export type SignalCreateInput = {
  type: SignalType;
  body: string;
  title?: string | null;
  domainSlug?: string | null;
};

export type SignalUpdatePatch = {
  type?: SignalType;
  body?: string;
  title?: string | null;
  domainSlug?: string | null;
};

export type SignalChainListResult = {
  records: SignalRecord[];
  skipped: number;
};
```

- [ ] **Step 4: Add paths**

In `packages/vault-core/src/paths.ts`, inside the object returned by `vaultPaths`, after `decisionsDir` add:

```ts
    signalChainDir: path.join(rootPath, ".lifequest", "signal-chain"),
```

After `decisionJson` add:

```ts
    signalChainJson: (id: string) =>
      safeJoin(rootPath, ".lifequest", "signal-chain", `${id}.json`),
```

- [ ] **Step 5: Implement signal-chain.ts**

Create `packages/vault-core/src/signal-chain.ts`:

```ts
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { vaultPaths } from "./paths.ts";
import {
  SIGNAL_SOURCES,
  SIGNAL_TYPES,
  type Result,
  type SignalChainListResult,
  type SignalCreateInput,
  type SignalRecord,
  type SignalSource,
  type SignalType,
  type SignalUpdatePatch,
} from "./types.ts";

function isSignalType(value: unknown): value is SignalType {
  return (
    typeof value === "string" &&
    (SIGNAL_TYPES as readonly string[]).includes(value)
  );
}

function isSignalSource(value: unknown): value is SignalSource {
  return (
    typeof value === "string" &&
    (SIGNAL_SOURCES as readonly string[]).includes(value)
  );
}

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function asError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function parseSignalRecord(raw: unknown): SignalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (!isIso(o.createdAt) || !isIso(o.updatedAt)) return null;
  if (o.deletedAt !== null && !isIso(o.deletedAt)) return null;
  if (!isSignalType(o.type) || !isSignalSource(o.source)) return null;
  if (o.sourceRef !== null && typeof o.sourceRef !== "string") return null;
  if (o.title !== null && typeof o.title !== "string") return null;
  if (typeof o.body !== "string") return null;
  if (o.domainSlug !== null && typeof o.domainSlug !== "string") return null;
  return {
    id: o.id,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
    type: o.type,
    source: o.source,
    sourceRef: o.sourceRef,
    title: o.title,
    body: o.body,
    domainSlug: o.domainSlug,
  };
}

async function domainExists(rootPath: string, slug: string): Promise<boolean> {
  try {
    await fs.access(vaultPaths(rootPath).domainDir(slug));
    return true;
  } catch {
    return false;
  }
}

function normalizeTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const t = title.trim();
  return t ? t : null;
}

function normalizeDomain(
  domainSlug: string | null | undefined,
): string | null {
  if (domainSlug == null) return null;
  const s = domainSlug.trim();
  return s ? s : null;
}

async function validateBodyAndMeta(
  rootPath: string,
  type: unknown,
  body: string,
  domainSlug: string | null,
): Promise<Result<{ type: SignalType; body: string; domainSlug: string | null }>> {
  if (!isSignalType(type)) {
    return fail(`Invalid signal type: ${String(type)}`);
  }
  const trimmed = body.trim();
  if (!trimmed) return fail("body is required");
  if (domainSlug && !(await domainExists(rootPath, domainSlug))) {
    return fail(`Unknown domain: ${domainSlug}`);
  }
  return ok({ type, body: trimmed, domainSlug });
}

async function writeSignalFile(
  rootPath: string,
  record: SignalRecord,
): Promise<void> {
  const filePath = vaultPaths(rootPath).signalChainJson(record.id);
  await atomicWriteFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

async function readLiveSignal(
  rootPath: string,
  id: string,
): Promise<Result<SignalRecord>> {
  try {
    const filePath = vaultPaths(rootPath).signalChainJson(id);
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail("Signal not found");
    }
    const record = parseSignalRecord(parsed);
    if (!record || record.deletedAt) return fail("Signal not found");
    return ok(record);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fail("Signal not found");
    return fail(asError(e));
  }
}

export async function listSignals(
  rootPath: string,
): Promise<Result<SignalChainListResult>> {
  try {
    const paths = vaultPaths(rootPath);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.signalChainDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return ok({ records: [], skipped: 0 });
      }
      throw e;
    }

    const records: SignalRecord[] = [];
    let skipped = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -".json".length);
      let filePath: string;
      try {
        filePath = paths.signalChainJson(id);
      } catch {
        skipped += 1;
        continue;
      }
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const record = parseSignalRecord(JSON.parse(raw));
        if (!record) {
          skipped += 1;
          continue;
        }
        if (record.deletedAt) continue;
        records.push(record);
      } catch {
        skipped += 1;
      }
    }
    records.sort((a, b) => {
      const byCreated = b.createdAt.localeCompare(a.createdAt);
      if (byCreated !== 0) return byCreated;
      return b.id.localeCompare(a.id);
    });
    return ok({ records, skipped });
  } catch (e) {
    return fail(asError(e));
  }
}

export async function createSignal(
  rootPath: string,
  input: SignalCreateInput,
): Promise<Result<SignalRecord>> {
  try {
    const domainSlug = normalizeDomain(input.domainSlug);
    const checked = await validateBodyAndMeta(
      rootPath,
      input.type,
      input.body,
      domainSlug,
    );
    if (!checked.ok) return checked;
    const now = new Date().toISOString();
    const record: SignalRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      type: checked.value.type,
      source: "manual",
      sourceRef: null,
      title: normalizeTitle(input.title),
      body: checked.value.body,
      domainSlug: checked.value.domainSlug,
    };
    await writeSignalFile(rootPath, record);
    return ok(record);
  } catch (e) {
    return fail(asError(e));
  }
}

export async function updateSignal(
  rootPath: string,
  id: string,
  patch: SignalUpdatePatch,
): Promise<Result<SignalRecord>> {
  try {
    const loaded = await readLiveSignal(rootPath, id);
    if (!loaded.ok) return loaded;
    const nextType = patch.type ?? loaded.value.type;
    const nextBody = patch.body ?? loaded.value.body;
    const nextDomain =
      patch.domainSlug === undefined
        ? loaded.value.domainSlug
        : normalizeDomain(patch.domainSlug);
    const checked = await validateBodyAndMeta(
      rootPath,
      nextType,
      nextBody,
      nextDomain,
    );
    if (!checked.ok) return checked;
    const next: SignalRecord = {
      ...loaded.value,
      type: checked.value.type,
      body: checked.value.body,
      domainSlug: checked.value.domainSlug,
      title:
        patch.title === undefined
          ? loaded.value.title
          : normalizeTitle(patch.title),
      updatedAt: new Date().toISOString(),
    };
    await writeSignalFile(rootPath, next);
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}

export async function deleteSignal(
  rootPath: string,
  id: string,
): Promise<Result<SignalRecord>> {
  try {
    const loaded = await readLiveSignal(rootPath, id);
    if (!loaded.ok) return loaded;
    const now = new Date().toISOString();
    const next: SignalRecord = {
      ...loaded.value,
      deletedAt: now,
      updatedAt: now,
    };
    await writeSignalFile(rootPath, next);
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}
```

Then add to `packages/vault-core/src/index.ts`:

```ts
export * from "./signal-chain.ts";
```

- [ ] **Step 6: Run tests to verify they pass**

```
node --experimental-strip-types --test packages/vault-core/tests/signal-chain.test.ts
```

Expected: all tests PASS.

Then the full suite:

```
npm test
```

Expected: all vault-core tests PASS (existing suites still green).

- [ ] **Step 7: Commit**

```
git add packages/vault-core/src/types.ts packages/vault-core/src/paths.ts packages/vault-core/src/signal-chain.ts packages/vault-core/src/index.ts packages/vault-core/tests/signal-chain.test.ts
git commit -m "feat(vault-core): add Life Signal Chain storage"
```

---

### Task 2: Electron IPC

**Files:**
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`

**Interfaces:**
- Consumes: `listSignals`, `createSignal`, `updateSignal`, `deleteSignal`, `SignalCreateInput`, `SignalUpdatePatch`, `SignalChainListResult`, `SignalRecord`
- Produces (on `window.lifequest`):
  - `signalChainList(): Promise<Result<SignalChainListResult>>`
  - `signalChainCreate(input: SignalCreateInput): Promise<Result<SignalRecord>>`
  - `signalChainUpdate(id: string, patch: SignalUpdatePatch): Promise<Result<SignalRecord>>`
  - `signalChainDelete(id: string): Promise<Result<SignalRecord>>`

- [ ] **Step 1: Add vault-service wrappers**

In `apps/desktop/electron/vault-service.ts`, extend the `@lifequest/vault-core` import with:

```ts
  createSignal,
  deleteSignal,
  listSignals,
  updateSignal,
  type SignalChainListResult,
  type SignalCreateInput,
  type SignalRecord,
  type SignalUpdatePatch,
```

After `logList`, add:

```ts
export async function signalChainList(): Promise<Result<SignalChainListResult>> {
  return withVault((root) => listSignals(root));
}

export async function signalChainCreate(
  input: SignalCreateInput,
): Promise<Result<SignalRecord>> {
  return withVault((root) => createSignal(root, input));
}

export async function signalChainUpdate(
  id: string,
  patch: SignalUpdatePatch,
): Promise<Result<SignalRecord>> {
  return withVault((root) => updateSignal(root, id, patch));
}

export async function signalChainDelete(
  id: string,
): Promise<Result<SignalRecord>> {
  return withVault((root) => deleteSignal(root, id));
}
```

Do **not** add signals to snapshot builders.

- [ ] **Step 2: Register IPC in main.ts**

In `apps/desktop/electron/main.ts`, after `ipcMain.handle("log:list", ...)`, add:

```ts
  ipcMain.handle("signalChain:list", () => vault.signalChainList());
  ipcMain.handle(
    "signalChain:create",
    (_e, input: Parameters<typeof vault.signalChainCreate>[0]) =>
      vault.signalChainCreate(input),
  );
  ipcMain.handle(
    "signalChain:update",
    (
      _e,
      id: string,
      patch: Parameters<typeof vault.signalChainUpdate>[1],
    ) => vault.signalChainUpdate(id, patch),
  );
  ipcMain.handle("signalChain:delete", (_e, id: string) =>
    vault.signalChainDelete(id),
  );
```

- [ ] **Step 3: Expose preload methods**

In `apps/desktop/electron/preload.ts`, after `logList`, add:

```ts
  signalChainList: () =>
    ipcRenderer.invoke("signalChain:list") as Promise<Result<unknown>>,
  signalChainCreate: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("signalChain:create", input) as Promise<Result<unknown>>,
  signalChainUpdate: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke("signalChain:update", id, patch) as Promise<
      Result<unknown>
    >,
  signalChainDelete: (id: string) =>
    ipcRenderer.invoke("signalChain:delete", id) as Promise<Result<unknown>>,
```

- [ ] **Step 4: Type the renderer API**

In `apps/desktop/src/vite-env.d.ts`, add to the vault-core type import:

```ts
  SignalChainListResult,
  SignalCreateInput,
  SignalRecord,
  SignalUpdatePatch,
```

On `LifequestApi`, after `logList`, add:

```ts
  signalChainList: () => Promise<Result<SignalChainListResult>>;
  signalChainCreate: (input: SignalCreateInput) => Promise<Result<SignalRecord>>;
  signalChainUpdate: (
    id: string,
    patch: SignalUpdatePatch,
  ) => Promise<Result<SignalRecord>>;
  signalChainDelete: (id: string) => Promise<Result<SignalRecord>>;
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck
```

Expected: exit 0. If preload/main lag behind renderer types, fix the signatures above — do not `as any`.

- [ ] **Step 6: Commit**

```
git add apps/desktop/electron/vault-service.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/vite-env.d.ts
git commit -m "feat(desktop): expose signal chain IPC"
```

---

### Task 3: Day grouping and filter helpers

**Files:**
- Create: `apps/desktop/src/lib/signal-chain.ts`
- Create: `apps/desktop/src/lib/signal-chain.test.ts`

**Interfaces:**
- Consumes: `SignalRecord`, `SignalType` from `@lifequest/vault-core`
- Produces:
  - `localDayKey(iso: string): string` — `YYYY-MM-DD` in **local** timezone
  - `dayLabel(dayKey: string, now?: Date): string` — `Today` / `Yesterday` / `toLocaleDateString(undefined, { dateStyle: "medium" })`
  - `formatSignalTime(iso: string): string` — `toLocaleTimeString(undefined, { timeStyle: "short" })`
  - `SignalFilters = { type: SignalType | "all"; domainSlug: string | "all" | "none"; query: string }`
  - `filterSignals(records: SignalRecord[], filters: SignalFilters): SignalRecord[]`
  - `SignalDayGroup = { dayKey: string; label: string; items: SignalRecord[] }`
  - `groupSignalsByDay(records: SignalRecord[], now?: Date): SignalDayGroup[]` — assumes records already newest-first; keeps that order within a day

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/lib/signal-chain.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SignalRecord } from "@lifequest/vault-core";
import {
  dayLabel,
  filterSignals,
  groupSignalsByDay,
  localDayKey,
} from "./signal-chain.ts";

function signal(
  partial: Pick<SignalRecord, "id" | "createdAt" | "type" | "body"> &
    Partial<SignalRecord>,
): SignalRecord {
  return {
    updatedAt: partial.createdAt,
    deletedAt: null,
    source: "manual",
    sourceRef: null,
    title: null,
    domainSlug: null,
    ...partial,
  };
}

describe("localDayKey", () => {
  it("uses the local calendar date, not UTC", () => {
    const local = new Date(2026, 0, 15, 21, 0, 0);
    assert.equal(localDayKey(local.toISOString()), "2026-01-15");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 5, 10, 12, 0, 0);

  it("labels today and yesterday", () => {
    assert.equal(dayLabel("2026-06-10", now), "Today");
    assert.equal(dayLabel("2026-06-09", now), "Yesterday");
  });

  it("formats older days with medium date style", () => {
    const expected = new Date(2026, 0, 2).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    assert.equal(dayLabel("2026-01-02", now), expected);
  });
});

describe("filterSignals", () => {
  const records: SignalRecord[] = [
    signal({
      id: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "thought",
      title: "Alpha",
      body: "Hello world",
      domainSlug: "health",
    }),
    signal({
      id: "b",
      createdAt: "2026-01-02T00:00:00.000Z",
      type: "idea",
      body: "Other note",
      domainSlug: null,
    }),
  ];

  it("filters by type, none-domain, and case-insensitive search", () => {
    assert.equal(
      filterSignals(records, { type: "idea", domainSlug: "all", query: "" })
        .map((r) => r.id)
        .join(),
      "b",
    );
    assert.equal(
      filterSignals(records, { type: "all", domainSlug: "none", query: "" })
        .map((r) => r.id)
        .join(),
      "b",
    );
    assert.equal(
      filterSignals(records, {
        type: "all",
        domainSlug: "health",
        query: "HELLO",
      })
        .map((r) => r.id)
        .join(),
      "a",
    );
  });
});

describe("groupSignalsByDay", () => {
  it("groups newest day first and keeps newest-first within a day", () => {
    const now = new Date(2026, 5, 10, 18, 0, 0);
    const todayMorning = new Date(2026, 5, 10, 8, 0, 0).toISOString();
    const todayEvening = new Date(2026, 5, 10, 17, 0, 0).toISOString();
    const yesterday = new Date(2026, 5, 9, 12, 0, 0).toISOString();
    const records = [
      signal({ id: "eve", createdAt: todayEvening, type: "thought", body: "e" }),
      signal({ id: "morn", createdAt: todayMorning, type: "thought", body: "m" }),
      signal({ id: "y", createdAt: yesterday, type: "idea", body: "y" }),
    ];
    const groups = groupSignalsByDay(records, now);
    assert.equal(groups[0]?.label, "Today");
    assert.deepEqual(
      groups[0]?.items.map((i) => i.id),
      ["eve", "morn"],
    );
    assert.equal(groups[1]?.label, "Yesterday");
    assert.equal(groups[1]?.items[0]?.id, "y");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

From repo root:

```
node --experimental-strip-types --test apps/desktop/src/lib/signal-chain.test.ts
```

Expected: FAIL, module `./signal-chain.ts` not found.

If `@lifequest/vault-core` cannot resolve from that cwd, run from `apps/desktop`:

```
node --experimental-strip-types --test src/lib/signal-chain.test.ts
```

- [ ] **Step 3: Implement helpers**

Create `apps/desktop/src/lib/signal-chain.ts`:

```ts
import type { SignalRecord, SignalType } from "@lifequest/vault-core";

export type SignalFilters = {
  type: SignalType | "all";
  domainSlug: string | "all" | "none";
  query: string;
};

export type SignalDayGroup = {
  dayKey: string;
  label: string;
  items: SignalRecord[];
};

export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayLabel(dayKey: string, now: Date = new Date()): string {
  const todayKey = localDayKey(now.toISOString());
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestKey = localDayKey(yest.toISOString());
  if (dayKey === todayKey) return "Today";
  if (dayKey === yestKey) return "Yesterday";
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

export function formatSignalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function filterSignals(
  records: SignalRecord[],
  filters: SignalFilters,
): SignalRecord[] {
  const q = filters.query.trim().toLowerCase();
  return records.filter((r) => {
    if (filters.type !== "all" && r.type !== filters.type) return false;
    if (filters.domainSlug === "none" && r.domainSlug !== null) return false;
    if (
      filters.domainSlug !== "all" &&
      filters.domainSlug !== "none" &&
      r.domainSlug !== filters.domainSlug
    ) {
      return false;
    }
    if (!q) return true;
    const title = (r.title ?? "").toLowerCase();
    return title.includes(q) || r.body.toLowerCase().includes(q);
  });
}

export function groupSignalsByDay(
  records: SignalRecord[],
  now: Date = new Date(),
): SignalDayGroup[] {
  const groups: SignalDayGroup[] = [];
  const index = new Map<string, SignalDayGroup>();
  for (const record of records) {
    const key = localDayKey(record.createdAt);
    let group = index.get(key);
    if (!group) {
      group = { dayKey: key, label: dayLabel(key, now), items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(record);
  }
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test apps/desktop/src/lib/signal-chain.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/lib/signal-chain.ts apps/desktop/src/lib/signal-chain.test.ts
git commit -m "feat(desktop): add signal chain grouping helpers"
```

---

### Task 4: Nav, route, page, styles

**Files:**
- Modify: `apps/desktop/src/components/shell/nav-items.ts`
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/pages/ChainPage.tsx`
- Create: `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx`
- Modify: `apps/desktop/src/styles/global.css` (append chain section after Life log styles; do not edit `tokens.css`)

**Interfaces:**
- Consumes: `api().signalChainList/Create/Update/Delete`, `useActiveDomain`, `useVault`, helpers from `@/lib/signal-chain`, `SIGNAL_TYPES`, `SignalRecord`
- Produces: hash route `/chain`, nav item `Chain`, working composer + timeline

- [ ] **Step 1: Add the nav item**

In `apps/desktop/src/components/shell/nav-items.ts`:

1. Import `Radio` from `lucide-react`.
2. Update the brief-order comment to include Chain after Domains.
3. Insert this item **immediately after** the `domains` item (before `decisions`):

```ts
  {
    id: "chain",
    href: "/chain",
    label: "Chain",
    icon: Radio,
    section: "main",
  },
```

Do not change `NavRail.tsx`. Main-section filter will render Chain after Domains and before Personnel.

- [ ] **Step 2: Add the route**

In `apps/desktop/src/App.tsx`:

- Import `import ChainPage from "@/pages/ChainPage";`
- Add this route next to the other shell routes (after `/domains` is fine):

```ts
      <Route
        path="/chain"
        element={
          <ShellRoute>
            <ChainPage />
          </ShellRoute>
        }
      />
```

- [ ] **Step 3: Create ChainPage**

Create `apps/desktop/src/pages/ChainPage.tsx`:

```tsx
import { SignalChainFeed } from "@/components/signal-chain/SignalChainFeed";

export default function ChainPage() {
  return <SignalChainFeed />;
}
```

- [ ] **Step 4: Create SignalChainFeed**

Create `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx`. Behavior must match the spec:

- Load via `api().signalChainList()` on mount; re-list after every successful create/update/delete.
- Composer at top: type default `thought`; domain default = active domain slug, plus a **None** option (`value=""`); optional title; required body; Add disabled when body is whitespace or `busy`.
- On successful add: clear title + body; keep type and domain.
- Filters: type All + enum; domain All + None + each **non-archived** domain by `meta.name`; search input.
- Timeline: `filterSignals` then `groupSignalsByDay`. Sticky day headers. Row shows `formatSignalTime(createdAt)`, type, domain name if set, title if set, body with `white-space: pre-wrap`. No Markdown.
- Empty vault: `Nothing on the chain yet. Add a signal above.`
- Filters match none (but `all.length > 0`): `No signals match these filters.`
- Banner if `skipped > 0`: `{n} signal file(s) could not be read.`
- Edit: row becomes inline form (type, domain, title, body). Domain picker = non-archived domains + current slug if archived. Save → `signalChainUpdate`. Cancel restores view. `createdAt` shown, not editable.
- Delete: `window.confirm("Delete this signal? It will be hidden from the chain.")` then `signalChainDelete`.
- Errors from IPC shown with `className="form-error"` `role="alert"`.

Use this implementation:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SIGNAL_TYPES,
  type SignalRecord,
  type SignalType,
  type SignalUpdatePatch,
} from "@lifequest/vault-core";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { api } from "@/lib/ipc";
import {
  filterSignals,
  formatSignalTime,
  groupSignalsByDay,
  type SignalFilters,
} from "@/lib/signal-chain";
import { useVault } from "@/state/VaultProvider";

const TYPE_LABEL: Record<SignalType, string> = {
  thought: "Thought",
  idea: "Idea",
  notice: "Notice",
  other: "Other",
};

export function SignalChainFeed() {
  const { snapshot } = useVault();
  const activeDomain = useActiveDomain();
  const liveDomains = (snapshot?.domains ?? []).filter((d) => !d.meta.archivedAt);

  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<SignalType>("thought");
  const [domainSlug, setDomainSlug] = useState<string>(
    activeDomain?.slug ?? "",
  );
  const domainDefaulted = useRef(Boolean(activeDomain?.slug));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [filterType, setFilterType] = useState<SignalFilters["type"]>("all");
  const [filterDomain, setFilterDomain] =
    useState<SignalFilters["domainSlug"]>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (domainDefaulted.current || !activeDomain?.slug) return;
    setDomainSlug(activeDomain.slug);
    domainDefaulted.current = true;
  }, [activeDomain?.slug]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api().signalChainList();
      if (!result.ok) {
        setError(result.error);
        setRecords([]);
        setSkipped(0);
        return;
      }
      setRecords(result.value.records);
      setSkipped(result.value.skipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chain");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      filterSignals(records, {
        type: filterType,
        domainSlug: filterDomain,
        query,
      }),
    [records, filterType, filterDomain, query],
  );
  const groups = useMemo(() => groupSignalsByDay(visible), [visible]);

  function domainName(slug: string | null): string | null {
    if (!slug) return null;
    const match = snapshot?.domains.find((d) => d.slug === slug);
    return match?.meta.name ?? slug;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainCreate({
        type,
        body,
        title: title.trim() ? title : null,
        domainSlug: domainSlug.trim() ? domainSlug : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add signal");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(id: string, patch: SignalUpdatePatch) {
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update signal");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (
      !window.confirm("Delete this signal? It will be hidden from the chain.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainDelete(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (editingId === id) setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete signal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signal-chain">
      <header className="signal-chain__header">
        <h1 className="stub-page__title">Life Signal Chain</h1>
        <p className="stub-page__desc muted">
          Dump thoughts, ideas, and things you notice.
        </p>
      </header>

      <form className="signal-chain__composer" onSubmit={onAdd}>
        <label className="field">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SignalType)}
          >
            {SIGNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Domain
          <select
            value={domainSlug}
            onChange={(e) => setDomainSlug(e.target.value)}
          >
            <option value="">None</option>
            {liveDomains.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.meta.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field signal-chain__title-field">
          Title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="field signal-chain__body-field">
          Signal
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            required
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !body.trim()}
        >
          Add
        </button>
      </form>

      <div className="signal-chain__filters">
        <label className="field">
          Type
          <select
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value as SignalFilters["type"])
            }
          >
            <option value="all">All</option>
            {SIGNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Domain
          <select
            value={filterDomain}
            onChange={(e) =>
              setFilterDomain(e.target.value as SignalFilters["domainSlug"])
            }
          >
            <option value="all">All</option>
            <option value="none">None</option>
            {liveDomains.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.meta.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field signal-chain__search">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or text"
          />
        </label>
      </div>

      {skipped > 0 ? (
        <p className="form-error" role="status">
          {skipped} signal file(s) could not be read.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading chain…</p>
      ) : records.length === 0 ? (
        <p className="muted signal-chain__empty">
          Nothing on the chain yet. Add a signal above.
        </p>
      ) : visible.length === 0 ? (
        <p className="muted signal-chain__empty">
          No signals match these filters.
        </p>
      ) : (
        <div className="signal-chain__timeline">
          {groups.map((group) => (
            <section key={group.dayKey} className="signal-chain__day">
              <h2 className="signal-chain__day-header">{group.label}</h2>
              <ul className="signal-chain__list">
                {group.items.map((item) => (
                  <SignalRow
                    key={item.id}
                    signal={item}
                    domainName={domainName(item.domainSlug)}
                    liveDomains={liveDomains.map((d) => ({
                      slug: d.slug,
                      name: d.meta.name,
                    }))}
                    allDomains={(snapshot?.domains ?? []).map((d) => ({
                      slug: d.slug,
                      name: d.meta.name,
                    }))}
                    editing={editingId === item.id}
                    busy={busy}
                    onEdit={() => setEditingId(item.id)}
                    onCancel={() => setEditingId(null)}
                    onSave={onSave}
                    onDelete={() => void onDelete(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalRow(props: {
  signal: SignalRecord;
  domainName: string | null;
  liveDomains: { slug: string; name: string }[];
  allDomains: { slug: string; name: string }[];
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (id: string, patch: SignalUpdatePatch) => Promise<void>;
  onDelete: () => void;
}) {
  const s = props.signal;
  const [type, setType] = useState<SignalType>(s.type);
  const [domainSlug, setDomainSlug] = useState(s.domainSlug ?? "");
  const [title, setTitle] = useState(s.title ?? "");
  const [body, setBody] = useState(s.body);

  useEffect(() => {
    if (!props.editing) return;
    setType(s.type);
    setDomainSlug(s.domainSlug ?? "");
    setTitle(s.title ?? "");
    setBody(s.body);
  }, [props.editing, s]);

  const domainOptions = props.liveDomains.slice();
  if (
    s.domainSlug &&
    !domainOptions.some((d) => d.slug === s.domainSlug)
  ) {
    const archived = props.allDomains.find((d) => d.slug === s.domainSlug);
    domainOptions.push({
      slug: s.domainSlug,
      name: archived?.name ?? s.domainSlug,
    });
  }

  if (props.editing) {
    return (
      <li className="signal-row signal-row--editing">
        <form
          className="signal-row__form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSave(s.id, {
              type,
              body,
              title: title.trim() ? title : null,
              domainSlug: domainSlug.trim() ? domainSlug : null,
            });
          }}
        >
          <span className="muted signal-row__when">
            {formatSignalTime(s.createdAt)}
          </span>
          <label className="field">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as SignalType)}
            >
              {SIGNAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Domain
            <select
              value={domainSlug}
              onChange={(e) => setDomainSlug(e.target.value)}
            >
              <option value="">None</option>
              {domainOptions.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Signal
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              required
            />
          </label>
          <div className="signal-row__actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={props.busy || !body.trim()}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={props.onCancel}
              disabled={props.busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="signal-row">
      <time
        className="signal-row__when muted"
        dateTime={s.createdAt}
      >
        {formatSignalTime(s.createdAt)}
      </time>
      <span className="signal-row__type">{TYPE_LABEL[s.type]}</span>
      {props.domainName ? (
        <span className="signal-row__domain muted">{props.domainName}</span>
      ) : (
        <span className="signal-row__domain muted">No domain</span>
      )}
      <div className="signal-row__content">
        {s.title ? <h3 className="signal-row__title">{s.title}</h3> : null}
        <p className="signal-row__body">{s.body}</p>
      </div>
      <div className="signal-row__actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={props.onEdit}
          disabled={props.busy}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={props.onDelete}
          disabled={props.busy}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Append CSS**

At the **end** of `apps/desktop/src/styles/global.css` (do not modify `tokens.css` or existing theme rules), append:

```css
/* —— Life Signal Chain —— */
.signal-chain {
  max-width: 48rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.signal-chain__header {
  margin-bottom: 0.15rem;
}

.signal-chain__composer,
.signal-chain__filters,
.signal-row__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 0.75rem;
  align-items: end;
}

.signal-chain__title-field,
.signal-chain__body-field,
.signal-chain__search {
  grid-column: 1 / -1;
}

.signal-chain .field select,
.signal-chain .field input,
.signal-chain .field textarea {
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  padding: 0.45rem 0.55rem;
  background: var(--bg);
  width: 100%;
}

.signal-chain .field textarea {
  min-height: 5.5rem;
  resize: vertical;
}

.signal-chain__composer .btn {
  justify-self: start;
}

.signal-chain__empty {
  margin: 0.25rem 0 0;
}

.signal-chain__timeline {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.signal-chain__day-header {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0 0 0.45rem;
  padding: 0.35rem 0;
  background: var(--bg);
  font-size: 0.8rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--muted);
}

.signal-chain__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.signal-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  grid-template-areas:
    "when type domain actions"
    "content content content content";
  gap: 0.25rem 0.7rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  font-size: 0.875rem;
}

.signal-row__when {
  grid-area: when;
  font-size: 0.78rem;
  white-space: nowrap;
}

.signal-row__type {
  grid-area: type;
  font-size: 0.75rem;
  font-weight: 650;
  color: var(--accent);
}

.signal-row__domain {
  grid-area: domain;
  font-size: 0.78rem;
}

.signal-row__actions {
  grid-area: actions;
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
}

.signal-row__content {
  grid-area: content;
}

.signal-row__title {
  margin: 0.15rem 0 0.2rem;
  font-size: 0.95rem;
}

.signal-row__body {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.45;
}

.signal-row--editing {
  grid-template-columns: 1fr;
}

.signal-row__form {
  grid-column: 1 / -1;
}

@media (max-width: 36rem) {
  .signal-chain__composer,
  .signal-chain__filters,
  .signal-row__form {
    grid-template-columns: 1fr;
  }

  .signal-row {
    grid-template-columns: 1fr;
    grid-template-areas:
      "when"
      "type"
      "domain"
      "content"
      "actions";
  }
}
```

- [ ] **Step 6: Typecheck and unit tests**

```
npm test
node --experimental-strip-types --test apps/desktop/src/lib/signal-chain.test.ts
npm run typecheck
```

Expected: all pass, exit 0.

- [ ] **Step 7: Manual verification (Electron)**

```
npm run dev
```

With a vault open:

1. **Chain** appears in the left rail after **Domains**, icon present, not locked.
2. Click it: title **Life Signal Chain**, composer at top, empty copy.
3. Add a thought with body only (active domain preselected) → row appears under **Today**.
4. Add an idea, domain **None**, with a title → both items on the timeline, newest first.
5. Filter by type Idea → only the idea. Clear filters.
6. Search a unique word from the first body → only that row.
7. Edit the first item’s body and save → `createdAt` time unchanged, text updates.
8. Delete the second item → confirm dialog → row gone. Log page still shows only app events (no new signal rows).
9. Resize to a narrow viewport (~360px): composer stacks, rows stack.
10. Light and dark (whatever theme is already in the app): text remains readable, no unstyled native controls only on this page.

If the app cannot be launched in this environment, say so and rely on typecheck + unit tests.

- [ ] **Step 8: Commit**

```
git add apps/desktop/src/components/shell/nav-items.ts apps/desktop/src/App.tsx apps/desktop/src/pages/ChainPage.tsx apps/desktop/src/components/signal-chain/SignalChainFeed.tsx apps/desktop/src/styles/global.css
git commit -m "feat(desktop): add Life Signal Chain page"
```

Do not `git add` theme files.

---

## Spec coverage (self-review)

| Spec section | Task |
|--------------|------|
| New nav, separate from Log | 4 |
| Record shape / enums / source fields | 1 |
| Soft-mutable edit + `deletedAt` | 1, 4 |
| Per-file JSON + lazy dir | 1 |
| Not in `VaultSnapshot` | 2 (explicit non-change) |
| No schema bump | 1 / constraints |
| Newest-first day groups, composer on top | 3, 4 |
| Filters type/domain/search | 3, 4 |
| IPC list/create/update/delete | 2 |
| Skip-tolerant list + banner | 1, 4 |
| Empty body / unknown type / unknown domain | 1, 4 |
| Traversal via `safeJoin` | 1 |
| No Life log coupling | 1 |
| Out of scope (Notion, ingest, theme files) | Global constraints |

No open spec requirements without a task.
