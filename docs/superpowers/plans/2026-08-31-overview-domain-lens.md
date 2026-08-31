# Overview Domain Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Overview the default virtual life view, with domain tabs as filters, a tagged markdown documents library, and Dream/Architecture doctrine indexes.

**Architecture:** A pure `DomainLens` (`overview` or `{ domain, slug }`) lives in renderer and main-process memory (never `userData`). Surfaces filter with `recordVisible` / `recordVisibleMulti`. Library notes are vault-root `documents/{id}.md`. Dream lists Why+What and Architecture lists How; editors take `{ slug, kind }` from the route and do not change the lens.

**Tech Stack:** vault-core (`node:test`, frontmatter markdown), Electron IPC, React 19, React Router 7 HashRouter, existing `.ui-segmented` CSS.

**Spec:** `docs/superpowers/specs/2026-08-31-overview-domain-lens-design.md`

## Global Constraints

- Overview is a **virtual lens**, not a vault domain (no folder, not in Settings → Domains)
- Do **not** persist the lens to the vault, `localStorage`, or `userData`
- Cold start and vault open/create always select Overview; ignore leftover `activeDomainByVaultId`
- Do **not** seed the first live domain (Health) on vault open
- Lens is **not** in the URL; doctrine file identity is `/dream/{slug}/why`, `/dream/{slug}/what`, `/track/{slug}/how`
- Unassigned signals/notes (`domainSlug === null` / `domainSlugs: []`) are visible **only** in Overview
- Signals and personnel stay a **single** optional slug; library notes are **many** tags
- Life Map stays unfiltered
- No forge/Decisions/attachments on library notes; library CRUD does not append Life log events
- Do **not** change vault-wide room-unlock math
- Do **not** bump vault `schemaVersion`
- Pre-existing failures (`packaging-config` production deps, `Dashboard.tsx` typecheck) are out of scope unless this work touches those files
- Commit only files from the current task; leave unrelated dirty files unstaged
- Tests: `node --experimental-strip-types --test` in `packages/vault-core/tests/` and `apps/desktop/tests/`

---

## File Structure

```
packages/vault-core/src/
  domain-lens.ts              # NEW: DomainLens, recordVisible, recordVisibleMulti
  library-documents.ts        # NEW: markdown notes CRUD
  types.ts                    # LibraryDocument types
  paths.ts                    # documentsDir, libraryDocumentMd
  pure.ts                     # export domain-lens
  index.ts                    # export library + lens
packages/vault-core/tests/
  domain-lens.test.ts         # NEW
  library-documents.test.ts   # NEW

apps/desktop/electron/
  vault-service.ts            # in-memory lens; library IPC; no pref seed
  mcp-server.ts               # read in-memory lens
  map-tools.ts                # get_doctrine Overview = all domains
  preload.ts / main.ts        # domainSetActive(null); library channels
apps/desktop/src/
  vite-env.d.ts               # IPC types
  state/VaultProvider.tsx     # lens / setLens; no first-domain fallback
  components/shell/
    useActiveDomain.ts        # null in Overview; useDomainLens()
    DomainSwitcher.tsx        # Overview radio first
    wing.ts                   # /dream/* and /track/* keep their wing
  components/doctrine/
    DoctrineIndex.tsx         # NEW: Why/What or How lists
    DoctrineEditorPage.tsx    # NEW: routed DocumentEditor
  components/documents/DocumentEditor.tsx  # required slug prop
  components/signal-chain/SignalChainFeed.tsx
  components/log/LifeLogFeed.tsx
  components/personnel/PersonnelStudio.tsx
  components/decisions/DecisionsInbox.tsx
  components/hermes/ChatPanel.tsx          # Overview label when no domain
  components/settings/SettingsDomains.tsx  # archive → Overview
  pages/DocumentsPage.tsx     # library UI
  pages/HomePage.tsx          # Overview amalgam; What → Dream
  pages/ActPage.tsx           # lens filter + Overview brief
  pages/ArchitecturePage.tsx  # How index
  pages/DreamPage.tsx         # NEW: Why+What index
  App.tsx                     # nested doctrine routes
apps/desktop/tests/
  domain-lens-shell.test.ts   # NEW: source-scan wiring
  wing.test.ts                # nested /dream /track paths
```

---

### Task 1: Pure domain lens

**Files:**
- Create: `packages/vault-core/src/domain-lens.ts`
- Modify: `packages/vault-core/src/pure.ts`
- Test: `packages/vault-core/tests/domain-lens.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type DomainLens = { kind: "overview" } | { kind: "domain"; slug: string }`
  - `export function overviewLens(): DomainLens`
  - `export function domainLens(slug: string): DomainLens`
  - `export function lensSlug(lens: DomainLens): string | null`
  - `export function recordVisible(lens: DomainLens, domainSlug: string | null): boolean`
  - `export function recordVisibleMulti(lens: DomainLens, domainSlugs: readonly string[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/domain-lens.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  domainLens,
  lensSlug,
  overviewLens,
  recordVisible,
  recordVisibleMulti,
} from "../src/domain-lens.ts";

const overview = overviewLens();
const health = domainLens("health");
const financial = domainLens("financial");

describe("lens constructors", () => {
  it("builds overview and domain lenses", () => {
    assert.deepEqual(overview, { kind: "overview" });
    assert.deepEqual(health, { kind: "domain", slug: "health" });
    assert.equal(lensSlug(overview), null);
    assert.equal(lensSlug(health), "health");
  });
});

describe("recordVisible", () => {
  it("overview shows assigned and unassigned", () => {
    assert.equal(recordVisible(overview, "health"), true);
    assert.equal(recordVisible(overview, null), true);
  });

  it("domain tab hides unassigned and other domains", () => {
    assert.equal(recordVisible(health, "health"), true);
    assert.equal(recordVisible(health, null), false);
    assert.equal(recordVisible(health, "financial"), false);
  });
});

describe("recordVisibleMulti", () => {
  it("empty tags are unassigned: overview only", () => {
    assert.equal(recordVisibleMulti(overview, []), true);
    assert.equal(recordVisibleMulti(health, []), false);
  });

  it("multi-tag note is visible in each tagged domain and in overview", () => {
    const tags = ["health", "financial"];
    assert.equal(recordVisibleMulti(overview, tags), true);
    assert.equal(recordVisibleMulti(health, tags), true);
    assert.equal(recordVisibleMulti(financial, tags), true);
    assert.equal(recordVisibleMulti(domainLens("intellectual"), tags), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/domain-lens.test.ts` from `packages/vault-core`

Expected: FAIL (cannot find module `../src/domain-lens.ts`)

- [ ] **Step 3: Write minimal implementation**

Create `packages/vault-core/src/domain-lens.ts`:

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

export function lensSlug(lens: DomainLens): string | null {
  return lens.kind === "domain" ? lens.slug : null;
}

export function recordVisible(
  lens: DomainLens,
  domainSlug: string | null,
): boolean {
  if (lens.kind === "overview") return true;
  return domainSlug === lens.slug;
}

export function recordVisibleMulti(
  lens: DomainLens,
  domainSlugs: readonly string[],
): boolean {
  if (lens.kind === "overview") return true;
  return domainSlugs.includes(lens.slug);
}
```

Append to `packages/vault-core/src/pure.ts`:

```ts
export * from "./domain-lens.ts";
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/domain-lens.test.ts` from `packages/vault-core`

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/domain-lens.ts packages/vault-core/src/pure.ts packages/vault-core/tests/domain-lens.test.ts
git commit -m "feat(vault-core): add DomainLens visibility helpers"
```

---

### Task 2: Library documents CRUD

**Files:**
- Create: `packages/vault-core/src/library-documents.ts`
- Modify: `packages/vault-core/src/types.ts` (append library types after `SignalChainListResult`)
- Modify: `packages/vault-core/src/paths.ts` (`vaultPaths` return object)
- Modify: `packages/vault-core/src/index.ts`
- Test: `packages/vault-core/tests/library-documents.test.ts`

**Interfaces:**
- Consumes: `DomainLens` not required here; uses `vaultPaths`, `parseFrontmatter`, `serializeFrontmatter`, `atomicWriteFile`
- Produces:
  - `export type LibraryDocument = { id: string; title: string; bodyMarkdown: string; domainSlugs: string[]; createdAt: string; updatedAt: string; deletedAt: string | null }`
  - `export type LibraryCreateInput = { title: string; bodyMarkdown?: string; domainSlugs?: string[] }`
  - `export type LibraryUpdatePatch = { title?: string; bodyMarkdown?: string; domainSlugs?: string[] }`
  - `export type LibraryListResult = { records: LibraryDocument[]; skipped: number }`
  - `export async function libraryList(rootPath: string): Promise<Result<LibraryListResult>>`
  - `export async function libraryCreate(rootPath: string, input: LibraryCreateInput): Promise<Result<LibraryDocument>>`
  - `export async function libraryGet(rootPath: string, id: string): Promise<Result<LibraryDocument>>`
  - `export async function libraryUpdate(rootPath: string, id: string, patch: LibraryUpdatePatch): Promise<Result<LibraryDocument>>`
  - `export async function libraryDelete(rootPath: string, id: string): Promise<Result<LibraryDocument>>`
  - `vaultPaths(root).documentsDir` = `{root}/documents`
  - `vaultPaths(root).libraryDocumentMd(id)` = `{root}/documents/{id}.md`

Frontmatter key is `domains`. Store `JSON.stringify(domainSlugs)` so the existing scalar parser round-trips arrays (`domains: []` and `domains: ["health","financial"]`). Parse with `JSON.parse`. Collapse duplicate slugs, preserve order. Title trimmed non-empty. Body may be empty. Unknown domain dir → `Unknown domain: ${slug}`. Archived domains whose dir still exists are allowed. Missing `documents/` lists `{ records: [], skipped: 0 }`. Soft-delete sets `deletedAt`. Sort list by `updatedAt` descending, then `id`. Do **not** append Life log events. Create the folder on first write.

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/library-documents.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { archiveDomain } from "../src/domains.ts";
import { readLog } from "../src/log.ts";
import { vaultPaths } from "../src/paths.ts";
import {
  libraryCreate,
  libraryDelete,
  libraryGet,
  libraryList,
  libraryUpdate,
} from "../src/library-documents.ts";

describe("library-documents", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-library-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "LibraryTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing folder lists empty without error", async () => {
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.value, { records: [], skipped: 0 });
  });

  it("create writes markdown with empty tags and does not append the life log", async () => {
    const logBefore = await readLog(root);
    assert.equal(logBefore.ok, true);
    if (!logBefore.ok) return;

    const created = await libraryCreate(root, {
      title: "  Inbox note  ",
      bodyMarkdown: "hello",
      domainSlugs: [],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.title, "Inbox note");
    assert.equal(created.value.bodyMarkdown, "hello");
    assert.deepEqual(created.value.domainSlugs, []);
    assert.equal(created.value.deletedAt, null);

    const filePath = vaultPaths(root).libraryDocumentMd(created.value.id);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /^---\n/);
    assert.match(raw, /title: Inbox note/);
    assert.match(raw, /domains: \[\]/);

    const logAfter = await readLog(root);
    assert.equal(logAfter.ok, true);
    if (!logAfter.ok) return;
    assert.equal(logAfter.value.length, logBefore.value.length);
  });

  it("rejects empty title and unknown domain", async () => {
    const empty = await libraryCreate(root, { title: "   " });
    assert.equal(empty.ok, false);
    const unknown = await libraryCreate(root, {
      title: "Nope",
      domainSlugs: ["not-a-domain"],
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /Unknown domain: not-a-domain/);
  });

  it("stores multi-tags, collapses duplicates, and get/update/delete work", async () => {
    const created = await libraryCreate(root, {
      title: "Shared",
      domainSlugs: ["health", "financial", "health"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.deepEqual(created.value.domainSlugs, ["health", "financial"]);

    const got = await libraryGet(root, created.value.id);
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.title, "Shared");

    const updated = await libraryUpdate(root, created.value.id, {
      title: "Shared v2",
      bodyMarkdown: "body",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.title, "Shared v2");
    assert.equal(updated.value.createdAt, created.value.createdAt);

    const deleted = await libraryDelete(root, created.value.id);
    assert.equal(deleted.ok, true);
    const listed = await libraryList(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.records.some((r) => r.id === created.value.id),
      false,
    );
    const missing = await libraryGet(root, created.value.id);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /Document not found/);
  });

  it("allows an archived domain slug whose directory still exists", async () => {
    const archived = await archiveDomain(root, "emotional");
    assert.equal(archived.ok, true);
    const created = await libraryCreate(root, {
      title: "Old emotional note",
      domainSlugs: ["emotional"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.deepEqual(created.value.domainSlugs, ["emotional"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/library-documents.test.ts` from `packages/vault-core`

Expected: FAIL (cannot find module `../src/library-documents.ts`)

- [ ] **Step 3: Write minimal implementation**

Add to the object returned by `vaultPaths` in `packages/vault-core/src/paths.ts`:

```ts
documentsDir: path.join(rootPath, "documents"),
libraryDocumentMd: (id: string) =>
  safeJoin(rootPath, "documents", `${id}.md`),
```

Append to `packages/vault-core/src/types.ts` after `SignalChainListResult`:

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

export type LibraryCreateInput = {
  title: string;
  bodyMarkdown?: string;
  domainSlugs?: string[];
};

export type LibraryUpdatePatch = {
  title?: string;
  bodyMarkdown?: string;
  domainSlugs?: string[];
};

export type LibraryListResult = {
  records: LibraryDocument[];
  skipped: number;
};
```

Create `packages/vault-core/src/library-documents.ts` modeled on `signal-chain.ts`:

- `fail` / `ok` / `asError` helpers
- `async function domainDirExists(rootPath, slug)` via `fs.access(vaultPaths(rootPath).domainDir(slug))`
- `function uniqueSlugs(slugs: string[]): string[]` — trim, drop empties, collapse dupes, preserve order
- `async function normalizeDomains(rootPath, slugs: string[] | undefined): Promise<Result<string[]>>` — for each unique slug, `domainDirExists`; else `Unknown domain: ${slug}`
- `function parseLibraryFile(id: string, raw: string): LibraryDocument | null` — require title string, iso timestamps, `deletedAt` null or iso, `domains` JSON array of strings
- `async function writeLibraryFile(root, record)` — mkdir `documentsDir` recursive, `serializeFrontmatter({ title, domains: JSON.stringify(record.domainSlugs), createdAt, updatedAt, deletedAt }, bodyMarkdown)` via `atomicWriteFile`
- `libraryList` — ENOENT → empty; skip non-`.md`; skip parse failures (`skipped++`); skip `deletedAt`; sort `b.updatedAt.localeCompare(a.updatedAt)` then id
- `libraryCreate` — title required; `normalizeDomains`; `randomUUID`; timestamps equal
- `libraryGet` / `libraryUpdate` / `libraryDelete` — live only (`deletedAt` set → not found). Update bumps `updatedAt` only.

Export from `packages/vault-core/src/index.ts`:

```ts
export * from "./domain-lens.ts";
export * from "./library-documents.ts";
```

(`domain-lens` is already on `pure.ts`; re-export from index so Electron can import from `@lifequest/vault-core`.)

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/library-documents.test.ts tests/domain-lens.test.ts` from `packages/vault-core`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/library-documents.ts packages/vault-core/src/types.ts packages/vault-core/src/paths.ts packages/vault-core/src/index.ts packages/vault-core/tests/library-documents.test.ts
git commit -m "feat(vault-core): add tagged markdown library documents"
```

---

### Task 3: Main-process in-memory lens

**Files:**
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/mcp-server.ts`
- Modify: `apps/desktop/electron/map-tools.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Test: `apps/desktop/tests/domain-lens-shell.test.ts` (create; this task adds the main-process asserts only)

**Interfaces:**
- Consumes: `libraryList` / `Create` / `Get` / `Update` / `Delete` from vault-core (wire IPC here so later UI can call them)
- Produces:
  - Module-level `currentLens: string | null` (`null` = Overview), reset to `null` in `rememberOpen` and whenever the vault is cleared
  - `domainSetActive(slug: string | null): Promise<Result<string | null>>`
  - `domainGetActive(): Promise<string | null>` reads `currentLens`, **not** `userData`
  - `startMcp(root, vaultId, getActiveSlug: () => string | null)`
  - `get_doctrine`: explicit `domainSlug` wins; else if `activeSlug` is a string, that domain; else `{ domains: [...] }` for every **live** domain
  - IPC `library:list|create|get|update|delete`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/domain-lens-shell.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("main-process domain lens", () => {
  it("does not seed or persist the active domain pref on vault open", () => {
    const src = read("electron/vault-service.ts");
    assert.equal(src.includes("Seed active domain"), false);
    assert.match(src, /currentLens/);
    assert.match(src, /domainSetActive\(slug: string \| null\)/);
    assert.equal(
      /await setActiveDomain\(snapshot\.lifequest\.id/.test(src),
      false,
    );
    assert.match(src, /libraryList/);
    assert.match(src, /libraryCreate/);
  });

  it("MCP and get_doctrine use the in-memory lens", () => {
    const mcp = read("electron/mcp-server.ts");
    assert.match(mcp, /getActiveSlug/);
    assert.equal(mcp.includes("getActiveDomain(mcpVaultId)"), false);

    const tools = read("electron/map-tools.ts");
    assert.match(tools, /domains:/);
    assert.match(tools, /activeSlug/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts` from `apps/desktop`

Expected: FAIL (file missing or assertions fail on current source)

- [ ] **Step 3: Write minimal implementation**

In `vault-service.ts`:

1. Import `libraryList`, `libraryCreate`, `libraryGet`, `libraryUpdate`, `libraryDelete` and library types from `@lifequest/vault-core`.
2. Add `let currentLens: string | null = null;` next to `currentRoot`.
3. In `rememberOpen`, **delete** the block that reads `getActiveDomain` and seeds the first domain. Set `currentLens = null`. Change `startMcp(...)` to `startMcp(snapshot.rootPath, snapshot.lifequest.id, () => currentLens)`.
4. Wherever the vault is cleared (`currentRoot = null`), set `currentLens = null`.
5. Replace `domainSetActive` / `domainGetActive`:

```ts
export async function domainSetActive(
  slug: string | null,
): Promise<Result<string | null>> {
  return enqueue(async () => {
    if (!currentRoot || !currentVaultId) return noVaultError<string | null>();
    if (slug === null) {
      currentLens = null;
      return { ok: true, value: null };
    }
    const snap = await openVault(currentRoot);
    if (!snap.ok) return snap;
    const domain = snap.value.domains.find((d) => d.slug === slug);
    if (!domain) {
      return { ok: false, error: `Domain not found: ${slug}` };
    }
    if (domain.meta.archivedAt) {
      return { ok: false, error: `Domain is archived: ${slug}` };
    }
    currentLens = slug;
    return { ok: true, value: slug };
  });
}

export async function domainGetActive(): Promise<string | null> {
  if (!currentVaultId) return null;
  return currentLens;
}
```

Do **not** call `setActiveDomain` / `getActiveDomain` from `recent-vaults.ts` in these functions. Leave the pref helpers in `recent-vaults.ts` unused.

6. `hermesChatToolsCall`: `const activeSlug = currentLens;` (remove `getActiveDomain(currentVaultId)`). Extra system line: `` `Active domain: ${activeSlug ?? "overview"}` ``.
7. Add library wrappers `libraryListCall` etc. using `withVault`, same pattern as `signalChainList`.

In `mcp-server.ts` `startMcp`:

```ts
let getActiveSlug: () => string | null = () => null;

export async function startMcp(
  rootPath: string,
  vaultId: string,
  getLens: () => string | null = () => null,
): Promise<Result<string>> {
  getActiveSlug = getLens;
  // existing body; keep mcpVaultId if still needed for other reasons
}
```

In `registerTools`, replace `await getActiveDomain(mcpVaultId)` with `getActiveSlug()`. Remove the `getActiveDomain` import if unused.

In `map-tools.ts` `get_doctrine` branch, replace the first-live-domain fallback:

```ts
if (name === "get_doctrine") {
  const requested = rec.domainSlug as string | undefined;
  const live = snap.value.domains.filter((d) => !d.meta.archivedAt);
  if (requested) {
    const domain = snap.value.domains.find((d) => d.slug === requested);
    if (!domain) return { error: { code: "NOT_FOUND", message: "Domain not found" } };
    return {
      slug: domain.slug,
      name: domain.meta.name,
      why: domain.documents.why,
      what: domain.documents.what,
      how: domain.documents.how,
    };
  }
  if (activeSlug) {
    const domain = live.find((d) => d.slug === activeSlug);
    if (!domain) return { error: { code: "NOT_FOUND", message: "Domain not found" } };
    return {
      slug: domain.slug,
      name: domain.meta.name,
      why: domain.documents.why,
      what: domain.documents.what,
      how: domain.documents.how,
    };
  }
  return {
    domains: live.map((domain) => ({
      slug: domain.slug,
      name: domain.meta.name,
      why: domain.documents.why,
      what: domain.documents.what,
      how: domain.documents.how,
    })),
  };
}
```

`preload.ts`: `domainSetActive: (slug: string | null) => ipcRenderer.invoke("domain:setActive", slug)` and add:

```ts
libraryList: () => ipcRenderer.invoke("library:list"),
libraryCreate: (input: Record<string, unknown>) =>
  ipcRenderer.invoke("library:create", input),
libraryGet: (id: string) => ipcRenderer.invoke("library:get", id),
libraryUpdate: (id: string, patch: Record<string, unknown>) =>
  ipcRenderer.invoke("library:update", id, patch),
libraryDelete: (id: string) => ipcRenderer.invoke("library:delete", id),
```

`main.ts`: `ipcMain.handle("domain:setActive", (_e, slug: string | null) => vault.domainSetActive(slug));` plus `library:*` handlers matching signal-chain.

`vite-env.d.ts`: `domainSetActive: (slug: string | null) => Promise<Result<string | null>>` and library methods using `LibraryCreateInput`, `LibraryDocument`, `LibraryListResult`, `LibraryUpdatePatch` imported from `@lifequest/vault-core`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts` from `apps/desktop`

Expected: PASS for the two tests in this file (later tasks add more `it` blocks to the same file)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/vault-service.ts apps/desktop/electron/mcp-server.ts apps/desktop/electron/map-tools.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/src/vite-env.d.ts apps/desktop/tests/domain-lens-shell.test.ts
git commit -m "feat(desktop): keep domain lens in memory and stop seeding Health"
```

---

### Task 4: Renderer lens and Overview switcher

**Files:**
- Modify: `apps/desktop/src/state/VaultProvider.tsx`
- Modify: `apps/desktop/src/components/shell/useActiveDomain.ts`
- Modify: `apps/desktop/src/components/shell/DomainSwitcher.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsDomains.tsx`
- Modify: `apps/desktop/tests/domain-lens-shell.test.ts` (add renderer asserts)
- Modify: `apps/desktop/tests/wing-shell.test.ts` only if the existing switcher test needs Overview (prefer putting Overview asserts in `domain-lens-shell.test.ts`)

**Interfaces:**
- Consumes: `overviewLens`, `domainLens`, `lensSlug`, `DomainLens` from `@lifequest/vault-core/pure`; `domainSetActive(null)`
- Produces:
  - `VaultContextValue.lens: DomainLens`
  - `VaultContextValue.setLens(next: DomainLens): Promise<void>`
  - `VaultContextValue.activeSlug: string | null` derived via `lensSlug(lens)` (keep the field)
  - `setActiveSlug(slug: string | null)` wraps `setLens`
  - `useDomainLens(): DomainLens`
  - `useActiveDomain(): DomainRecord | null` — **no** `live[0]` fallback
  - Switcher first radio labeled `Overview`

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/tests/domain-lens-shell.test.ts`:

```ts
describe("renderer domain lens", () => {
  it("drops the first-live-domain fallback and exposes Overview", () => {
    const hook = read("src/components/shell/useActiveDomain.ts");
    assert.equal(hook.includes("live[0]"), false);
    assert.match(hook, /useDomainLens/);
    assert.match(hook, /overviewLens|kind === "overview"|kind === 'overview'/);

    const provider = read("src/state/VaultProvider.tsx");
    assert.match(provider, /setLens/);
    assert.match(provider, /overviewLens/);
    assert.equal(provider.includes("domainGetActive"), false);

    const switcher = read("src/components/shell/DomainSwitcher.tsx");
    assert.match(switcher, /Overview/);
    assert.match(switcher, /aria-label="Domain lens"/);
    assert.match(switcher, /overviewLens/);

    const settings = read("src/components/settings/SettingsDomains.tsx");
    assert.match(settings, /setActiveSlug\(null\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts` from `apps/desktop`

Expected: FAIL on renderer assertions

- [ ] **Step 3: Write minimal implementation**

`VaultProvider.tsx`:

- Import `overviewLens`, `domainLens`, `lensSlug`, type `DomainLens`.
- Replace `activeSlug` state with `lens` state initialized to `overviewLens()`.
- Derived `activeSlug = lensSlug(lens)`.
- `applySnapshot`: if `next` is null, `setLens(overviewLens())`. If `next` is a vault and current lens is a domain that is missing or archived, `setLens(overviewLens())`. Do **not** call `domainGetActive`. Do **not** reset a valid domain lens on refresh.
- `createVault` / `openVault` / `openRecent`: after a successful snapshot, `setLens(overviewLens())` and `void api().domainSetActive(null)`.
- `clearVault`: `setLens(overviewLens())`.
- Remove `loadActiveSlug`.
- `setLens`:

```ts
const setLens = useCallback(async (next: DomainLens) => {
  setLensState(next);
  const result = await api().domainSetActive(lensSlug(next));
  if (!result.ok) {
    setError(result.error);
  } else {
    setError(null);
  }
}, []);

const setActiveSlug = useCallback(
  async (slug: string | null) => {
    await setLens(slug ? domainLens(slug) : overviewLens());
  },
  [setLens],
);
```

Export `lens` and `setLens` on the context value.

`useActiveDomain.ts` — replace `useActiveDomain` and add `useDomainLens`:

```ts
export function useDomainLens(): DomainLens {
  const { lens } = useVault();
  return lens;
}

export function useActiveDomain(): DomainRecord | null {
  const { snapshot, lens } = useVault();
  return useMemo(() => {
    if (!snapshot || lens.kind !== "domain") return null;
    return (
      snapshot.domains.find(
        (d) => d.slug === lens.slug && !d.meta.archivedAt,
      ) ?? null
    );
  }, [snapshot, lens]);
}
```

Keep `documentsToUnlockDocs` / `useUnlockedRooms` / `useUnlockDomains` unchanged.

`DomainSwitcher.tsx`:

- Use `useDomainLens` + `setLens`.
- `selected` for Overview is `lens.kind === "overview"`; for a domain, `lens.kind === "domain" && lens.slug === d.slug`.
- Render Overview as the first `ui-segmented__option` (`role="radio"`, label `Overview`), then live domains.
- `aria-label="Domain lens"`.
- Arrow-key order is `[overview, ...domains]`. Overview slug sentinel: treat as `null` and call `setLens(overviewLens())`.
- Empty live domains: still show the Overview button (not “No domains” as the only chrome). Loading copy can remain if `booting && snapshot` is null.

`SettingsDomains.tsx` archive branch: if `activeSlug === slug`, `await setActiveSlug(null)` — **do not** activate `remaining[0]`. Subtitle copy: “Activate a domain to filter the app. Overview shows everything.”

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts tests/wing-shell.test.ts` from `apps/desktop`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/state/VaultProvider.tsx apps/desktop/src/components/shell/useActiveDomain.ts apps/desktop/src/components/shell/DomainSwitcher.tsx apps/desktop/src/components/settings/SettingsDomains.tsx apps/desktop/tests/domain-lens-shell.test.ts
git commit -m "feat(desktop): default the domain switcher to Overview"
```

---

### Task 5: Filter existing surfaces

**Files:**
- Modify: `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx`
- Modify: `apps/desktop/src/components/log/LifeLogFeed.tsx`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`
- Modify: `apps/desktop/src/components/personnel/PersonnelStudio.tsx`
- Modify: `apps/desktop/src/components/decisions/DecisionsInbox.tsx`
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/tests/domain-lens-shell.test.ts`

**Interfaces:**
- Consumes: `useDomainLens`, `recordVisible` from `@lifequest/vault-core/pure`
- Produces: every listed surface filters with `recordVisible(lens, record.domainSlug)`. Signal-Chain in-page domain **dropdown removed**. Composer still has a domain `<select>` including unassigned (`""`), defaulting to `lensSlug(lens) ?? ""`, dirty-flag so a lens change does not overwrite an in-progress pick. Home in Overview is a full dashboard (not the “select a domain” empty state). What links go to `/dream/{slug}/what`. Act Overview brief concatenates every live domain headed by name. Life Map is not filtered.

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("lens filtering", () => {
  it("Signal-Chain timeline has no in-page domain filter", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, /recordVisible/);
    assert.equal(src.includes("filterDomain"), false);
    assert.match(src, /lensSlug|useDomainLens/);
  });

  it("Home, Log, Act, Personnel, and Decisions use recordVisible", () => {
    for (const file of [
      "src/pages/HomePage.tsx",
      "src/pages/ActPage.tsx",
      "src/components/log/LifeLogFeed.tsx",
      "src/components/personnel/PersonnelStudio.tsx",
      "src/components/decisions/DecisionsInbox.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /recordVisible/, file);
    }
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /\/dream\/\$\{.*\}\/what|\/dream\/.+\/what/);
    assert.equal(home.includes('href: "/chart"'), false);

    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /Overview/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts` from `apps/desktop`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

**SignalChainFeed:** import `recordVisible`, `lensSlug`, `useDomainLens`. Remove `filterDomain` state and the domain filter `<select>` in the **timeline** toolbar. Keep the composer domain `<select>` (live domains + empty “Unassigned”).

```ts
const lens = useDomainLens();
const [domainSlug, setDomainSlug] = useState(lensSlug(lens) ?? "");
const domainDirty = useRef(false);

useEffect(() => {
  if (domainDirty.current) return;
  setDomainSlug(lensSlug(lens) ?? "");
}, [lens]);

const visible = useMemo(() => {
  const scoped = records.filter((r) => recordVisible(lens, r.domainSlug));
  return filterSignals(scoped, { type: filterType, domainSlug: "all", query });
}, [records, filterType, query, lens]);
```

On composer domain change, set `domainDirty.current = true`. After successful add, `domainDirty.current = false` and reset picker to `lensSlug(lens) ?? ""`.

Leave `filterSignals`’s `domainSlug` parameter in `src/lib/signal-chain.ts` so `signal-chain.test.ts` stays valid.

**LifeLogFeed:** drop `allDomains` toggle and the empty-state that requires `activeSlug`. Always `logList()`, then `events.filter((e) => recordVisible(lens, e.domainSlug))`. Unassigned label can stay `"global"` or become `"unassigned"`.

**HomePage:** import `useDomainLens`, `recordVisible`. Never return the “Select or create a domain” block when a vault is open.

- Title: Overview → `"Overview"`; domain tab → domain name.
- Events: `allEvents.filter((e) => recordVisible(lens, e.domainSlug))`.
- Pending decisions: `decisions.filter((d) => recordVisible(lens, d.domainSlug))`.
- Doctrine rows: live domains matching the lens (`overview` = all live; domain tab = that domain). Each Why/What/How links to `/dream/{slug}/why`, `/dream/{slug}/what`, `/track/{slug}/how`. Remove `href: "/chart"` for What.
- Forged count: over the visible doctrine set (Overview: all live domains × 3; domain tab: 3).
- Keep map tasks unfiltered.

**ActPage:** filter log events with `recordVisible`. `buildBrief`: if `useActiveDomain()` is a record, current single-domain brief; if Overview, map live domains to `## ${name}\n` + why/what/how. `BRIEF_KINDS` What room label: `"Dream"` not `"Chart"`. `canDispatchAgent` in Overview: true if **any** live domain’s How is non-empty (import `canDispatchAgent` + `documentsToUnlockDocs` per domain).

**PersonnelStudio:** after loading hires, `hires.filter((h) => recordVisible(lens, h.domainSlug))`. Hire composer: default `domainSlug` to `lensSlug(lens)` like signals (empty in Overview).

**DecisionsInbox:** `items.filter((d) => recordVisible(lens, d.domainSlug))`.

**ChatPanel:** where it displays or sends the active domain name, use `activeDomain?.meta.name ?? "Overview"`. Do not block sending when `useActiveDomain()` is null.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts src/lib/signal-chain.test.ts` from `apps/desktop`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/signal-chain/SignalChainFeed.tsx apps/desktop/src/components/log/LifeLogFeed.tsx apps/desktop/src/pages/HomePage.tsx apps/desktop/src/pages/ActPage.tsx apps/desktop/src/components/personnel/PersonnelStudio.tsx apps/desktop/src/components/decisions/DecisionsInbox.tsx apps/desktop/src/components/hermes/ChatPanel.tsx apps/desktop/tests/domain-lens-shell.test.ts
git commit -m "feat(desktop): filter lists by Overview domain lens"
```

---

### Task 6: Dream and Architecture doctrine indexes

**Files:**
- Create: `apps/desktop/src/components/doctrine/DoctrineIndex.tsx`
- Create: `apps/desktop/src/components/doctrine/DoctrineEditorPage.tsx`
- Create: `apps/desktop/src/pages/DreamPage.tsx`
- Modify: `apps/desktop/src/pages/ArchitecturePage.tsx`
- Modify: `apps/desktop/src/components/documents/DocumentEditor.tsx`
- Modify: `apps/desktop/src/components/doctrine/DoctrineStrip.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/shell/wing.ts`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/tests/wing.test.ts`
- Modify: `apps/desktop/tests/domain-lens-shell.test.ts`

**Interfaces:**
- Consumes: `useDomainLens`, `isNonEmptyBody` from vault-core/pure; `DocumentEditor`
- Produces:
  - `DoctrineIndex({ kinds: DocumentKind[] })` lists live domains visible under the lens, grouped by `sortOrder`, rows Why then What (Dream) or How (Architecture)
  - Locked row: What if that domain’s Why body is empty; How if What body is empty — lock icon, **no** `Link`
  - Unlocked row → `/dream/{slug}/why`, `/dream/{slug}/what`, `/track/{slug}/how`
  - `DocumentEditor({ kind, slug: string })` — required slug, **never** calls `setLens` / `setActiveSlug`
  - `DoctrineEditorPage` reads `:slug` and `:kind`, 404 + back link if domain missing/archived or kind invalid
  - `wingForPath("/dream/health/why") === "vision"`; `wingForPath("/track/health/how") === "plan"`

- [ ] **Step 1: Write the failing test**

Append to `domain-lens-shell.test.ts`:

```ts
describe("doctrine indexes", () => {
  it("routes Dream/Architecture editors by slug and kind", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="\/dream\/:slug\/:kind"/);
    assert.match(app, /path="\/track\/:slug\/:kind"/);
    assert.match(app, /DreamPage/);
    assert.equal(app.includes('RoomPage room="dream"'), false);

    const editor = read("src/components/documents/DocumentEditor.tsx");
    assert.match(editor, /slug: string/);
    assert.equal(editor.includes("useActiveDomain"), false);

    const index = read("src/components/doctrine/DoctrineIndex.tsx");
    assert.match(index, /isNonEmptyBody/);
    assert.match(index, /\/dream\//);
  });
});
```

In `apps/desktop/tests/wing.test.ts` `wingForPath` maps test, add:

```ts
assert.equal(wingForPath("/dream/health/why"), "vision");
assert.equal(wingForPath("/dream/health/what"), "vision");
assert.equal(wingForPath("/track/health/how"), "plan");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts tests/wing.test.ts` from `apps/desktop`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`wing.ts` `wingForPath`:

```ts
export function wingForPath(pathname: string): WingId | null {
  if (PATH_WING[pathname]) return PATH_WING[pathname];
  if (pathname.startsWith("/dream/")) return "vision";
  if (pathname.startsWith("/track/")) return "plan";
  return null;
}
```

`DocumentEditor`: change props to `{ kind: DocumentKind; slug: string }`. Use `slug` directly (remove `useActiveDomain`). If load 404s, show the error (caller also guards).

`DoctrineEditorPage.tsx`:

```tsx
import { Link, useParams } from "react-router-dom";
import { DOCUMENT_KINDS, type DocumentKind } from "@lifequest/vault-core/pure";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useVault } from "@/state/VaultProvider";

function isKind(value: string | undefined): value is DocumentKind {
  return DOCUMENT_KINDS.includes(value as DocumentKind);
}

export function DoctrineEditorPage({ backTo }: { backTo: string }) {
  const { slug, kind } = useParams();
  const { snapshot } = useVault();
  const domain = snapshot?.domains.find(
    (d) => d.slug === slug && !d.meta.archivedAt,
  );
  if (!slug || !isKind(kind) || !domain) {
    return (
      <p className="muted">
        Document not found. <Link to={backTo}>Back</Link>
      </p>
    );
  }
  return (
    <div>
      <p>
        <Link to={backTo}>Back</Link>
        {" · "}
        {domain.meta.name} · {kind}
      </p>
      <DocumentEditor kind={kind} slug={slug} />
    </div>
  );
}
```

`DoctrineIndex.tsx`: take `kinds: DocumentKind[]`. Filter live domains: if `lens.kind === "domain"`, only that slug; else all live. Group header = domain name. For each kind, compute lock:

- `why` → never locked
- `what` → locked unless `isNonEmptyBody(domain.documents.why.bodyMarkdown)`
- `how` → locked unless `isNonEmptyBody(domain.documents.what.bodyMarkdown)`

Href: why/what → `/dream/${slug}/${kind}`; how → `/track/${slug}/how`.

`DreamPage.tsx`: heading “Dream”, `<DoctrineIndex kinds={["why", "what"]} />`. No `RoomLockGate` on the index (Dream is always unlocked).

`ArchitecturePage.tsx`: keep `RoomLockGate room="track"` around the page. Replace `<DoctrineStrip kind="how" />` with `<DoctrineIndex kinds={["how"]} />`. Map widgets stay.

`DoctrineStrip.tsx`: if still used, link Edit to `/dream/${domain.slug}/what` when `kind === "what"` else `/track/${domain.slug}/how`, and if `!domain` return null. Chart/Life Map may still import it — grep and update links; do not send What to `/chart` or `/documents`.

`App.tsx`:

```tsx
<Route path="/dream" element={<DreamPage />} />
<Route
  path="/dream/:slug/:kind"
  element={<DoctrineEditorPage backTo="/dream" />}
/>
<Route path="/track" element={<ArchitecturePage />} />
<Route
  path="/track/:slug/:kind"
  element={<DoctrineEditorPage backTo="/track" />}
/>
```

Stop importing `RoomPage` if unused.

CSS (append to `global.css`): `.doctrine-index`, `.doctrine-index__group`, `.doctrine-index__row`, `.doctrine-index__row.is-locked { pointer-events: none; opacity: 0.65; }` matching existing card spacing.

Any other `DocumentEditor kind=` call site must pass `slug`. Grep `DocumentEditor` and fix.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts tests/wing.test.ts` from `apps/desktop`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/doctrine/DoctrineIndex.tsx apps/desktop/src/components/doctrine/DoctrineEditorPage.tsx apps/desktop/src/pages/DreamPage.tsx apps/desktop/src/pages/ArchitecturePage.tsx apps/desktop/src/components/documents/DocumentEditor.tsx apps/desktop/src/components/doctrine/DoctrineStrip.tsx apps/desktop/src/App.tsx apps/desktop/src/components/shell/wing.ts apps/desktop/src/styles/global.css apps/desktop/tests/wing.test.ts apps/desktop/tests/domain-lens-shell.test.ts
git commit -m "feat(desktop): list Why/What/How by domain without changing the lens"
```

If `RoomPage.tsx` is unused, leave it unstaged unless you also stop all imports (do not delete unless grep shows zero references).

---

### Task 7: Documents library page

**Files:**
- Modify: `apps/desktop/src/pages/DocumentsPage.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/tests/domain-lens-shell.test.ts`

**Interfaces:**
- Consumes: `api().libraryList/Create/Get/Update/Delete`, `useDomainLens`, `recordVisibleMulti`, `lensSlug`
- Produces: Documents page lists non-deleted notes visible under the lens; create/edit title, body, multi-tag picker; Overview default tags `[]`; domain tab default `[slug]`; chips for tags; no Why/What/How cards

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("documents library page", () => {
  it("is a library, not doctrine cards", () => {
    const src = read("src/pages/DocumentsPage.tsx");
    assert.match(src, /libraryList/);
    assert.match(src, /recordVisibleMulti/);
    assert.equal(src.includes("DOC_CARDS"), false);
    assert.equal(src.includes('href: "/dream"'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts` from `apps/desktop`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Replace `DocumentsPage.tsx` with a page that:

1. `libraryList()` on mount and `reloadGeneration`.
2. Filters `recordVisibleMulti(lens, note.domainSlugs)`.
3. List: title, tag chips (map slugs → domain names; empty → “Unassigned”), updated time. Click row to edit.
4. Create form: title input, textarea body, checkbox/toggle list of live domains (plus any archived tags already on the note when editing). New-note default: `lens.kind === "domain" ? [lens.slug] : []`.
5. Save → `libraryCreate` or `libraryUpdate`. Delete → confirm then `libraryDelete`.
6. Header: “Documents” / “Markdown notes. Tag a domain, or leave unassigned to keep them in Overview only.”

Use existing `.field`, `.btn`, `.doc-card` or new `.library-list` / `.library-tags` in `global.css` (flex wrap chips, 0.75rem).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --experimental-strip-types --test tests/domain-lens-shell.test.ts` from `apps/desktop`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/DocumentsPage.tsx apps/desktop/src/styles/global.css apps/desktop/tests/domain-lens-shell.test.ts
git commit -m "feat(desktop): replace Documents doctrine cards with a tagged library"
```

---

### Task 8: Spec status and full test run

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-overview-domain-lens-design.md` (status line only)

**Interfaces:**
- Consumes: all previous tasks
- Produces: spec status pointing at this plan

- [ ] **Step 1: Point the spec at this plan**

If the spec status line does not already mention this plan, change it to:

```
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-08-31-overview-domain-lens.md`)
```

If it already does, skip to Step 2.

- [ ] **Step 2: Run the full test suite**

Run from repo root: `npm test`

Expected: vault-core all pass. Desktop: `domain-lens-shell`, `wing`, `wing-shell`, `settings-shell`, and `src/lib/signal-chain.test.ts` pass. Ignore a pre-existing `packaging-config` failure if it still fails for production `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-31-overview-domain-lens-design.md
git commit -m "docs: point Overview spec at the implementation plan"
```

---

## Manual check (after all tasks)

Launch the desktop app:

1. Cold start is Overview selected in the top bar.
2. Signal-Chain shows unassigned events; Health hides them.
3. Dream in Overview lists every domain’s Why and What; opening Health Why does not select Health.
4. Documents is a note list, not three doctrine cards.
5. Quit and reopen: Overview again.
