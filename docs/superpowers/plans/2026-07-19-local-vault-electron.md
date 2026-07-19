# LifeQuest Local Vault Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local-first Electron + Vite + React LifeQuest desktop app whose source of truth is a user-chosen git-friendly vault (domains as folders, Why/What/How as Markdown, structured state as JSON/JSONL), with no Prisma, no cloud accounts, and Hermes keys in OS secure storage.

**Architecture:** `packages/vault-core` owns pure vault schema and filesystem operations (unit-tested in Node). `apps/desktop` is Electron main + preload IPC + Vite React renderer. Main process serializes vault mutations, owns dialogs and `safeStorage`, and proxies Hermes. Renderer is UI only.

**Tech Stack:** Electron 35+, Vite 6, React 19, TypeScript 5, Node `fs/promises`, `node:test` + `--experimental-strip-types`, zod 3, lucide-react, CSS variables (salvaged tokens). No Prisma, no Next.js in the desktop app.

**Spec:** `docs/superpowers/specs/2026-07-19-local-vault-electron-design.md`

## Global Constraints

- Vault is identity — **no** email/password auth
- Doctrine only in `domains/<slug>/{why,what,how}.md` with YAML frontmatter
- Structured state only in `.lifequest/` as JSON / JSONL (git-native; **no** SQLite/Prisma)
- Hermes API key **never** written into the vault; use Electron `safeStorage` keyed by vault `id`
- `schemaVersion` must be `1`; refuse unknown versions
- Seed domains on create: Health, Intellectual, Emotional, Financial (slugs `health`, `intellectual`, `emotional`, `financial`)
- Room unlock: non-empty prior pillar **body** (trim); forge is not the unlock gate
- Forged docs are read-only in editor; changes via Decisions only
- Atomic writes: temp file in same dir → rename
- Security: `contextIsolation: true`, `nodeIntegration: false`, no raw `fs` in renderer
- Active domain slug stored in Electron **userData**, not in the vault
- External edits: mtime check on window focus + reload prompt (no CRDT)
- Archive Next web skeleton; do not keep it as product runtime
- App name in UI: **LifeQuest**
- Prefer small focused files; TDD for `vault-core` first
- Packaging (electron-builder) is **out of this plan’s required tasks**; dev run is enough for v1 DoD

---

## File Structure

```
life-quest/
├── package.json                          # workspaces root
├── package-lock.json
├── docs/superpowers/specs/2026-07-19-local-vault-electron-design.md
├── docs/superpowers/plans/2026-07-19-local-vault-electron.md
├── packages/
│   └── vault-core/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts                  # public exports
│       │   ├── types.ts                  # shared types + constants
│       │   ├── paths.ts                  # vault path builders + traversal guard
│       │   ├── atomic-write.ts
│       │   ├── frontmatter.ts            # parse/serialize md + yaml frontmatter
│       │   ├── documents.ts              # status transitions (ported)
│       │   ├── unlock.ts                 # room unlock (ported)
│       │   ├── log.ts                    # append/read jsonl
│       │   ├── create-vault.ts
│       │   ├── open-vault.ts
│       │   ├── domains.ts                # list/create/update/archive
│       │   ├── domain-documents.ts       # get/save/setStatus
│       │   ├── decisions.ts              # list/create/resolve
│       │   └── agents.ts                 # list/hire/dismiss
│       └── tests/
│           ├── frontmatter.test.ts
│           ├── documents.test.ts
│           ├── unlock.test.ts
│           ├── create-vault.test.ts
│           ├── domains.test.ts
│           ├── domain-documents.test.ts
│           ├── decisions.test.ts
│           └── agents.test.ts
└── apps/
    └── desktop/
        ├── package.json
        ├── tsconfig.json
        ├── tsconfig.node.json
        ├── electron.vite.config.ts       # or separate vite + electron-builder-free scripts
        ├── vite.config.ts
        ├── index.html
        ├── electron/
        │   ├── main.ts
        │   ├── preload.ts
        │   ├── vault-service.ts          # wraps vault-core + mutation queue
        │   ├── recent-vaults.ts          # userData recent list + active domain
        │   ├── secrets.ts                # safeStorage hermes key
        │   └── hermes-proxy.ts
        ├── src/
        │   ├── main.tsx
        │   ├── App.tsx
        │   ├── vite-env.d.ts
        │   ├── styles/
        │   │   ├── tokens.css
        │   │   └── global.css
        │   ├── lib/
        │   │   ├── ipc.ts                # typed window.lifequest client
        │   │   └── types.ts              # re-export shared view types
        │   ├── state/
        │   │   └── VaultProvider.tsx
        │   ├── pages/
        │   │   ├── WelcomePage.tsx
        │   │   ├── HomePage.tsx
        │   │   ├── DomainsPage.tsx
        │   │   ├── RoomPage.tsx          # dream/chart/track by kind
        │   │   ├── ActPage.tsx
        │   │   ├── DocumentsPage.tsx
        │   │   ├── DecisionsPage.tsx
        │   │   ├── LogPage.tsx
        │   │   ├── PersonnelPage.tsx
        │   │   └── SettingsPage.tsx
        │   └── components/
        │       ├── shell/
        │       │   ├── AppShell.tsx
        │       │   ├── NavRail.tsx
        │       │   ├── TopBar.tsx
        │       │   ├── DomainSwitcher.tsx
        │       │   └── RoomLockGate.tsx
        │       ├── documents/
        │       │   ├── DocumentEditor.tsx
        │       │   ├── DocumentStatusBadge.tsx
        │       │   └── ProposeChangeDialog.tsx
        │       ├── decisions/DecisionsInbox.tsx
        │       ├── log/LifeLogFeed.tsx
        │       ├── personnel/PersonnelStudio.tsx
        │       └── hermes/ChatPanel.tsx
        └── scripts/
            └── dev.mjs                   # start vite + electron
```

**Archive (final task):** move current Next app sources into `archive/web-skeleton/` (or leave at repo root only if move is too disruptive — prefer move; keep `docs/` at root).

---

## Frozen interfaces (`vault-core`)

These signatures are authoritative for later tasks.

```ts
// packages/vault-core/src/types.ts
export const SCHEMA_VERSION = 1 as const;
export const DOCUMENT_KINDS = ["why", "what", "how"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ["draft", "refined", "forged"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const ROOM_IDS = ["dream", "chart", "track", "act"] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export const SEED_DOMAINS = [
  { slug: "health", name: "Health" },
  { slug: "intellectual", name: "Intellectual" },
  { slug: "emotional", name: "Emotional" },
  { slug: "financial", name: "Financial" },
] as const;
export const DEFAULT_HERMES_URL = "http://localhost:8642";

export type LifequestJson = {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
};

export type DomainMeta = {
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DoctrineDocument = {
  kind: DocumentKind;
  title: string;
  status: DocumentStatus;
  forgedAt: string | null;
  updatedAt: string;
  bodyMarkdown: string;
  mtimeMs: number;
};

export type DomainRecord = {
  slug: string;
  meta: DomainMeta;
  documents: Record<DocumentKind, DoctrineDocument>;
};

export type VaultSettings = {
  hermesBaseUrl: string;
  theme: "system" | "light" | "dark";
};

export type AgentHire = {
  id: string;
  hermesAgentId: string;
  name: string;
  roleLabel: string | null;
  domainSlug: string | null;
  status: "active" | "dismissed";
  createdAt: string;
  dismissedAt: string | null;
};

export type LifeEvent = {
  id: string;
  domainSlug: string | null;
  type: string;
  summary: string;
  payload: unknown;
  createdAt: string;
};

export type DecisionRecord = {
  id: string;
  domainSlug: string;
  documentKind: DocumentKind;
  status: "pending" | "approved" | "rejected";
  title: string;
  rationale: string | null;
  proposedBodyMarkdown: string;
  previousBodyMarkdown: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type VaultSnapshot = {
  rootPath: string;
  lifequest: LifequestJson;
  settings: VaultSettings;
  domains: DomainRecord[];
  agents: AgentHire[];
  decisions: DecisionRecord[];
  log: LifeEvent[];
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
```

```ts
// Key functions
createVault(rootPath: string, name?: string): Promise<Result<VaultSnapshot>>
openVault(rootPath: string): Promise<Result<VaultSnapshot>>
listDomains(rootPath: string): Promise<Result<DomainRecord[]>>
createDomain(rootPath: string, input: { name: string; slug?: string }): Promise<Result<DomainRecord>>
updateDomain(rootPath: string, slug: string, patch: Partial<Pick<DomainMeta, "name" | "description" | "color" | "sortOrder">>): Promise<Result<DomainRecord>>
archiveDomain(rootPath: string, slug: string): Promise<Result<DomainRecord>>
getDocument(rootPath: string, slug: string, kind: DocumentKind): Promise<Result<DoctrineDocument>>
saveDocument(rootPath: string, slug: string, kind: DocumentKind, bodyMarkdown: string, title?: string): Promise<Result<DoctrineDocument>>
setDocumentStatus(rootPath: string, slug: string, kind: DocumentKind, status: DocumentStatus): Promise<Result<DoctrineDocument>>
listDecisions(rootPath: string): Promise<Result<DecisionRecord[]>>
createDecision(rootPath: string, input: Omit<DecisionRecord, "id" | "status" | "createdAt" | "resolvedAt"> & { id?: string }): Promise<Result<DecisionRecord>>
resolveDecision(rootPath: string, id: string, resolution: "approved" | "rejected"): Promise<Result<DecisionRecord>>
listAgents(rootPath: string): Promise<Result<AgentHire[]>>
hireAgent(rootPath: string, input: Omit<AgentHire, "id" | "status" | "createdAt" | "dismissedAt">): Promise<Result<AgentHire>>
dismissAgent(rootPath: string, id: string): Promise<Result<AgentHire>>
readLog(rootPath: string): Promise<Result<LifeEvent[]>>
appendLog(rootPath: string, event: Omit<LifeEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }): Promise<Result<LifeEvent>>
updateSettings(rootPath: string, patch: Partial<VaultSettings>): Promise<Result<VaultSettings>>
canTransitionStatus(from: DocumentStatus, to: DocumentStatus): boolean
assertEditable(status: DocumentStatus): { ok: true } | { ok: false; reason: string }
getUnlockedRooms(docs: { kind: DocumentKind; bodyMarkdown: string }[]): Set<RoomId>
parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string }
serializeFrontmatter(data: Record<string, unknown>, body: string): string
slugifyDomainName(name: string): string
```

## Frozen IPC API (preload → renderer)

```ts
// window.lifequest
type LifequestApi = {
  vaultCreate: (path: string, name?: string) => Promise<Result<VaultSnapshot>>;
  vaultOpen: (path: string) => Promise<Result<VaultSnapshot>>;
  vaultGetSnapshot: () => Promise<Result<VaultSnapshot | null>>;
  vaultListRecent: () => Promise<{ id: string; name: string; path: string; lastOpenedAt: string }[]>;
  dialogOpenDirectory: () => Promise<string | null>;
  domainCreate: (input: { name: string; slug?: string }) => Promise<Result<DomainRecord>>;
  domainUpdate: (slug: string, patch: Partial<Pick<DomainMeta, "name" | "description" | "color" | "sortOrder">>) => Promise<Result<DomainRecord>>;
  domainArchive: (slug: string) => Promise<Result<DomainRecord>>;
  domainSetActive: (slug: string) => Promise<Result<string>>;
  domainGetActive: () => Promise<string | null>;
  documentGet: (slug: string, kind: DocumentKind) => Promise<Result<DoctrineDocument>>;
  documentSave: (slug: string, kind: DocumentKind, bodyMarkdown: string, title?: string) => Promise<Result<DoctrineDocument>>;
  documentSetStatus: (slug: string, kind: DocumentKind, status: DocumentStatus) => Promise<Result<DoctrineDocument>>;
  decisionList: () => Promise<Result<DecisionRecord[]>>;
  decisionCreate: (input: { domainSlug: string; documentKind: DocumentKind; title: string; rationale?: string | null; proposedBodyMarkdown: string; previousBodyMarkdown?: string | null }) => Promise<Result<DecisionRecord>>;
  decisionResolve: (id: string, resolution: "approved" | "rejected") => Promise<Result<DecisionRecord>>;
  logList: () => Promise<Result<LifeEvent[]>>;
  agentsList: () => Promise<Result<AgentHire[]>>;
  agentsHire: (input: { hermesAgentId: string; name: string; roleLabel?: string | null; domainSlug?: string | null }) => Promise<Result<AgentHire>>;
  agentsDismiss: (id: string) => Promise<Result<AgentHire>>;
  settingsUpdate: (patch: Partial<VaultSettings>) => Promise<Result<VaultSettings>>;
  secretsHasHermesKey: () => Promise<boolean>;
  secretsSetHermesKey: (key: string) => Promise<Result<true>>;
  secretsClearHermesKey: () => Promise<Result<true>>;
  hermesTest: () => Promise<Result<{ latencyMs: number; baseUrl: string }>>;
  hermesChat: (messages: { role: string; content: string }[]) => Promise<Result<{ content: string }>>;
  hermesScanAgents: () => Promise<Result<{ id: string; name: string }[]>>;
  onVaultFileChanged: (cb: (payload: { path: string }) => void) => () => void;
};
```

---

### Task 1: Root workspaces + vault-core package skeleton

**Files:**
- Create: `package.json` (root workspaces; replace Next scripts as primary later — for this task, add workspaces **without deleting** existing Next app yet)
- Create: `packages/vault-core/package.json`
- Create: `packages/vault-core/tsconfig.json`
- Create: `packages/vault-core/src/index.ts`
- Create: `packages/vault-core/src/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: package `@lifequest/vault-core` with types exported from `src/index.ts`

- [ ] **Step 1: Write root `package.json` workspaces**

If a root `package.json` already exists for Next, **merge** workspaces and add a vault-core test script without removing Next scripts yet:

```json
{
  "name": "life-quest",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "test": "npm run test -w @lifequest/vault-core",
    "test:web": "node --experimental-strip-types --test tests/unit/*.test.ts",
    "test:vault": "npm run test -w @lifequest/vault-core",
    "dev:desktop": "npm run dev -w @lifequest/desktop",
    "lint": "eslint",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push"
  }
}
```

Keep existing `dependencies` / `devDependencies` for the web app until the archive task.

- [ ] **Step 2: Create vault-core package.json**

```json
{
  "name": "@lifequest/vault-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "node --experimental-strip-types --test tests/**/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.19.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 3: Create `packages/vault-core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Create `types.ts` with the frozen types block from this plan (copy verbatim from “Frozen interfaces”)**

- [ ] **Step 5: Create `src/index.ts`**

```ts
export * from "./types.ts";
```

- [ ] **Step 6: Install workspaces**

Run: `npm install`  
Expected: exit 0; `@lifequest/vault-core` linked

- [ ] **Step 7: Commit**

```bash
git add package.json packages/vault-core package-lock.json
git commit -m "chore: scaffold vault-core workspace package"
```

---

### Task 2: Frontmatter parse/serialize + document status + unlock (pure)

**Files:**
- Create: `packages/vault-core/src/frontmatter.ts`
- Create: `packages/vault-core/src/documents.ts`
- Create: `packages/vault-core/src/unlock.ts`
- Create: `packages/vault-core/tests/frontmatter.test.ts`
- Create: `packages/vault-core/tests/documents.test.ts`
- Create: `packages/vault-core/tests/unlock.test.ts`
- Modify: `packages/vault-core/src/index.ts`

**Interfaces:**
- Consumes: types from Task 1
- Produces: `parseFrontmatter`, `serializeFrontmatter`, `canTransitionStatus`, `assertEditable`, `getUnlockedRooms`, `isRoomUnlocked`, `isNonEmptyBody`

- [ ] **Step 1: Write failing frontmatter test**

```ts
// packages/vault-core/tests/frontmatter.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter.ts";

describe("frontmatter", () => {
  it("round-trips title status and body", () => {
    const raw = serializeFrontmatter(
      { title: "Why", status: "draft", forgedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      "Hello\n\nWorld\n",
    );
    const parsed = parseFrontmatter(raw);
    assert.equal(parsed.data.title, "Why");
    assert.equal(parsed.data.status, "draft");
    assert.equal(parsed.body, "Hello\n\nWorld\n");
  });

  it("treats missing frontmatter as empty data", () => {
    const parsed = parseFrontmatter("just body\n");
    assert.deepEqual(parsed.data, {});
    assert.equal(parsed.body, "just body\n");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -w @lifequest/vault-core`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement frontmatter (minimal YAML subset — no external dep)**

```ts
// packages/vault-core/src/frontmatter.ts
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: raw };
  const yamlBlock = raw.slice(4, end).replace(/\r/g, "");
  const after = raw.slice(end + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after.startsWith("\r\n") ? after.slice(2) : after;
  const data: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value === "null") data[key] = null;
    else if (value === "true") data[key] = true;
    else if (value === "false") data[key] = false;
    else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      data[key] = value.slice(1, -1);
    } else data[key] = value;
  }
  return { data, body };
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (s === "" || /[:#\n]/.test(s) || s.includes(" ")) return JSON.stringify(s);
  return s;
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data);
  const lines = keys.map((k) => `${k}: ${formatValue(data[k])}`);
  const bodyOut = body.startsWith("\n") ? body : body.length ? `\n${body}` : "\n";
  // Prefer body without forcing extra leading blank if body already has content convention:
  const normalizedBody = body.endsWith("\n") || body === "" ? body : `${body}\n`;
  return `---\n${lines.join("\n")}\n---\n${normalizedBody}`;
}
```

Fix test expectation if serialize adds trailing newline — keep round-trip strict.

- [ ] **Step 4: Port documents + unlock tests and implementations**

`documents.ts` — copy logic from current `lib/documents.ts`:

```ts
import type { DocumentStatus } from "./types.ts";

export function canTransitionStatus(from: DocumentStatus, to: DocumentStatus): boolean {
  if (from === to) return false;
  if (from === "forged") return false;
  if (to === "draft") return false;
  if (from === "draft" && (to === "refined" || to === "forged")) return true;
  if (from === "refined" && to === "forged") return true;
  return false;
}

export function assertEditable(
  status: DocumentStatus,
): { ok: true } | { ok: false; reason: string } {
  if (status === "forged") {
    return {
      ok: false,
      reason: "Forged documents are read-only; propose a change via Decisions.",
    };
  }
  return { ok: true };
}
```

`unlock.ts` — copy from current `lib/unlock.ts` using `DocumentKind` / `RoomId` from `./types.ts`.

Tests:

```ts
// tests/documents.test.ts — assert draft→forged ok, forged→draft false, assertEditable forged
// tests/unlock.test.ts — empty docs only dream; why body unlocks chart; full chain unlocks act
```

- [ ] **Step 5: Export from index and run all vault-core tests**

```ts
export * from "./types.ts";
export * from "./frontmatter.ts";
export * from "./documents.ts";
export * from "./unlock.ts";
```

Run: `npm run test -w @lifequest/vault-core`  
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/vault-core
git commit -m "feat(vault-core): frontmatter, document status, room unlock"
```

---

### Task 3: Paths, atomic write, createVault, openVault

**Files:**
- Create: `packages/vault-core/src/paths.ts`
- Create: `packages/vault-core/src/atomic-write.ts`
- Create: `packages/vault-core/src/log.ts`
- Create: `packages/vault-core/src/create-vault.ts`
- Create: `packages/vault-core/src/open-vault.ts`
- Create: `packages/vault-core/tests/create-vault.test.ts`
- Modify: `packages/vault-core/src/index.ts`

**Interfaces:**
- Consumes: types, frontmatter, SEED_DOMAINS
- Produces: `createVault`, `openVault`, `appendLog`, `readLog`, `safeJoin`, `atomicWriteFile`

- [ ] **Step 1: Write failing create-vault test**

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault, openVault } from "../src/create-vault.ts";
// re-export openVault from open-vault; test may import from index later

describe("createVault", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-vault-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("seeds four domains and lifequest.json", async () => {
    const root = path.join(dir, "my-vault");
    const res = await createVault(root, "Personal");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.lifequest.schemaVersion, 1);
    assert.equal(res.value.domains.length, 4);
    const why = await fs.readFile(path.join(root, "domains/health/why.md"), "utf8");
    assert.match(why, /^---\n/);
    assert.match(why, /status: draft/);
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement paths + atomic write**

```ts
// paths.ts
import path from "node:path";

export function vaultPaths(root: string) {
  const rootPath = path.resolve(root);
  return {
    root: rootPath,
    lifequestJson: path.join(rootPath, "lifequest.json"),
    domainsDir: path.join(rootPath, "domains"),
    lifequestDir: path.join(rootPath, ".lifequest"),
    settingsJson: path.join(rootPath, ".lifequest", "settings.json"),
    agentsJson: path.join(rootPath, ".lifequest", "agents.json"),
    logJsonl: path.join(rootPath, ".lifequest", "log.jsonl"),
    decisionsDir: path.join(rootPath, ".lifequest", "decisions"),
    domainDir: (slug: string) => path.join(rootPath, "domains", slug),
    domainJson: (slug: string) => path.join(rootPath, "domains", slug, "domain.json"),
    documentMd: (slug: string, kind: string) =>
      path.join(rootPath, "domains", slug, `${kind}.md`),
    decisionJson: (id: string) =>
      path.join(rootPath, ".lifequest", "decisions", `${id}.json`),
  };
}

/** Ensure target stays under rootPath. */
export function assertUnderRoot(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes vault root: ${targetPath}`);
  }
}
```

```ts
// atomic-write.ts
import fs from "node:fs/promises";
import path from "node:path";

export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}
```

```ts
// log.ts
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { LifeEvent, Result } from "./types.ts";
import { vaultPaths } from "./paths.ts";
import { atomicWriteFile } from "./atomic-write.ts";

export async function readLog(rootPath: string): Promise<Result<LifeEvent[]>> {
  try {
    const p = vaultPaths(rootPath).logJsonl;
    const raw = await fs.readFile(p, "utf8").catch(() => "");
    const events: LifeEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line) as LifeEvent);
    }
    return { ok: true, value: events };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function appendLog(
  rootPath: string,
  event: Omit<LifeEvent, "id" | "createdAt"> & { id?: string; createdAt?: string },
): Promise<Result<LifeEvent>> {
  try {
    const full: LifeEvent = {
      id: event.id ?? randomUUID(),
      domainSlug: event.domainSlug,
      type: event.type,
      summary: event.summary,
      payload: event.payload ?? null,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    const p = vaultPaths(rootPath).logJsonl;
    await fs.mkdir(vaultPaths(rootPath).lifequestDir, { recursive: true });
    await fs.appendFile(p, `${JSON.stringify(full)}\n`, "utf8");
    return { ok: true, value: full };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Implement create-vault and open-vault**

`createVault`:
1. `fs.mkdir(root, { recursive: true })`
2. Refuse if `lifequest.json` already exists
3. Write `lifequest.json` (`schemaVersion: 1`, `randomUUID()`, name, createdAt)
4. Create `.lifequest/` with `settings.json` (`hermesBaseUrl` default, `theme: "system"`), `agents.json` `{ "hires": [] }`, empty `log.jsonl`, empty `decisions/`
5. For each `SEED_DOMAINS`, create domain folder, `domain.json`, three pillar md files via `serializeFrontmatter`
6. Append log events `domain.created`
7. Return `openVault(root)` snapshot

`openVault`:
1. Read + parse `lifequest.json`; if `schemaVersion !== 1` return error
2. Read settings, agents, decisions dir, log
3. Scan `domains/*` directories; load `domain.json` + each kind md (parse frontmatter; `mtimeMs` from `stat`)
4. Return `VaultSnapshot`

Helper to parse doctrine file:

```ts
async function readDoctrineFile(filePath: string, kind: DocumentKind): Promise<DoctrineDocument> {
  const raw = await fs.readFile(filePath, "utf8");
  const st = await fs.stat(filePath);
  const { data, body } = parseFrontmatter(raw);
  return {
    kind,
    title: typeof data.title === "string" ? data.title : kind[0]!.toUpperCase() + kind.slice(1),
    status: (data.status as DocumentStatus) || "draft",
    forgedAt: (data.forgedAt as string | null) ?? null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : st.mtime.toISOString(),
    bodyMarkdown: body,
    mtimeMs: st.mtimeMs,
  };
}
```

- [ ] **Step 5: Export functions; run tests — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/vault-core
git commit -m "feat(vault-core): create and open vault with seed domains"
```

---

### Task 4: Domain CRUD + document get/save/status

**Files:**
- Create: `packages/vault-core/src/domains.ts`
- Create: `packages/vault-core/src/domain-documents.ts`
- Create: `packages/vault-core/tests/domains.test.ts`
- Create: `packages/vault-core/tests/domain-documents.test.ts`
- Modify: `packages/vault-core/src/index.ts`

**Interfaces:**
- Consumes: createVault, frontmatter, documents helpers, appendLog
- Produces: `slugifyDomainName`, `createDomain`, `updateDomain`, `archiveDomain`, `getDocument`, `saveDocument`, `setDocumentStatus`

- [ ] **Step 1: Failing tests**

```ts
// domains.test.ts
// createVault in tmp → createDomain({ name: "Career" }) → slug career, three md files
// archiveDomain → meta.archivedAt non-null

// domain-documents.test.ts
// saveDocument why body "x" → file contains x
// setDocumentStatus forged → saveDocument fails with editable reason
// setDocumentStatus draft→refined ok
```

- [ ] **Step 2: Implement `slugifyDomainName`**

```ts
export function slugifyDomainName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "domain";
}
```

If slug exists, append `-2`, `-3`, …

- [ ] **Step 3: Implement domain + document modules**

`saveDocument`:
- `assertEditable` unless only updating allowed fields — body save requires editable
- Write frontmatter with new `updatedAt`
- Append log `document.updated`

`setDocumentStatus`:
- `canTransitionStatus` or return error
- If `forged`, set `forgedAt` to now
- Append log `document.status_changed`

- [ ] **Step 4: Tests PASS + commit**

```bash
git add packages/vault-core
git commit -m "feat(vault-core): domain CRUD and document save/status"
```

---

### Task 5: Decisions + agents

**Files:**
- Create: `packages/vault-core/src/decisions.ts`
- Create: `packages/vault-core/src/agents.ts`
- Create: `packages/vault-core/tests/decisions.test.ts`
- Create: `packages/vault-core/tests/agents.test.ts`
- Modify: `packages/vault-core/src/index.ts`

**Interfaces:**
- Produces: `listDecisions`, `createDecision`, `resolveDecision`, `listAgents`, `hireAgent`, `dismissAgent`, `updateSettings`

- [ ] **Step 1: Failing decision test**

```ts
// forge why, createDecision with proposed body, resolve approved
// → why.md body equals proposed; decision status approved
// reject path leaves body unchanged
```

- [ ] **Step 2: Implement decisions**

`resolveDecision` when `approved`:
1. Load decision file
2. Read current doctrine; write body = `proposedBodyMarkdown` via serialize (keep status `forged`, update `updatedAt`)
3. Set decision `status: "approved"`, `resolvedAt`
4. Append log `decision.resolved`

When `rejected`: update decision only + log.

- [ ] **Step 3: Implement agents + updateSettings**

`agents.json` shape `{ hires: AgentHire[] }`.  
`hireAgent` pushes active hire; `dismissAgent` sets status dismissed + dismissedAt.

- [ ] **Step 4: Tests PASS + commit**

```bash
git add packages/vault-core
git commit -m "feat(vault-core): decisions, agents, settings"
```

---

### Task 6: Electron + Vite + React desktop scaffold

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`, `tsconfig.node.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/electron/main.ts`
- Create: `apps/desktop/electron/preload.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/styles/tokens.css` (copy from `app/tokens.css`)
- Create: `apps/desktop/src/styles/global.css`
- Create: `apps/desktop/src/vite-env.d.ts`
- Create: `apps/desktop/scripts/dev.mjs`

**Interfaces:**
- Consumes: nothing from vault-core yet (wire in Task 7)
- Produces: runnable Electron window loading Vite dev server

- [ ] **Step 1: desktop package.json**

```json
{
  "name": "@lifequest/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "node ./scripts/dev.mjs",
    "build": "vite build && tsc -p tsconfig.node.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@lifequest/vault-core": "*",
    "lucide-react": "^0.511.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.5.0",
    "electron": "^35.0.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0",
    "esbuild": "^0.25.0"
  }
}
```

- [ ] **Step 2: Vite config + index.html + Hello App**

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

`App.tsx` renders `<h1>LifeQuest</h1>` and `Welcome` placeholder text.

- [ ] **Step 3: Electron main + preload stubs**

```ts
// electron/main.ts
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDev) await win.loadURL("http://localhost:5173");
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

```ts
// electron/preload.ts
import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("lifequest", {
  ping: () => "pong",
});
```

- [ ] **Step 4: dev.mjs**

Start Vite, wait for port 5173, bundle electron main/preload with esbuild to `dist-electron/`, spawn `electron .` with `ELECTRON_RUN_AS_NODE` unset. On exit, kill vite.

Minimal approach:

```js
import { spawn } from "node:child_process";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url), ".."); // fix: join ..
// 1) esbuild electron/main.ts + preload.ts → dist-electron/
// 2) spawn npx vite
// 3) spawn npx electron with cwd apps/desktop, env VITE_DEV_SERVER_URL
```

Set `"main": "dist-electron/main.js"` and ensure package type module works with electron.

- [ ] **Step 5: `npm install` from repo root; run `npm run dev -w @lifequest/desktop`**

Expected: Electron window shows LifeQuest heading (manual smoke). If headless CI, at least `esbuild` + `vite build` succeed:

Run: `npm run build -w @lifequest/desktop`  
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/desktop package-lock.json package.json
git commit -m "feat(desktop): scaffold Electron + Vite + React app"
```

---

### Task 7: Main-process vault service + full IPC + secrets + recent vaults

**Files:**
- Create: `apps/desktop/electron/vault-service.ts`
- Create: `apps/desktop/electron/recent-vaults.ts`
- Create: `apps/desktop/electron/secrets.ts`
- Create: `apps/desktop/electron/hermes-proxy.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Create: `apps/desktop/src/lib/ipc.ts`
- Create: `apps/desktop/src/vite-env.d.ts` (Window.lifequest typing)

**Interfaces:**
- Consumes: all vault-core exports
- Produces: `window.lifequest` matching frozen IPC API

- [ ] **Step 1: vault-service with serial queue**

```ts
let currentRoot: string | null = null;
const queue: Promise<unknown> = Promise.resolve();

function withVault<T>(fn: (root: string) => Promise<T>): Promise<Result<T>> {
  // chain on queue; if !currentRoot return error
}
```

Implement methods that call vault-core and set `currentRoot` on create/open.

- [ ] **Step 2: recent-vaults.ts**

Store `recent.json` under `app.getPath("userData")`:

```ts
type RecentEntry = { id: string; name: string; path: string; lastOpenedAt: string };
type UserPrefs = {
  recent: RecentEntry[];
  activeDomainByVaultId: Record<string, string>;
};
```

- [ ] **Step 3: secrets.ts**

```ts
import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

// store map vaultId → base64(encrypted) in userData/secrets.json
// encryptString / decryptString when safeStorage.isEncryptionAvailable()
```

- [ ] **Step 4: hermes-proxy.ts**

Port `hermesFetchWithConfig` patterns from `lib/hermes.ts`:

- `test`: GET `/health` or GET base with timeout  
- `chat`: POST `/v1/chat/completions` with messages  
- `scanAgents`: try `/v1/agents`, `/agents`, `/v1/profiles`  

Return `Result<…>`.

- [ ] **Step 5: Register ipcMain.handle for every LifequestApi method**

Use channel names equal to method names: `vault:create`, etc., or a single `lifequest:invoke` with `{ method, args }` — prefer **explicit channels** matching preload.

- [ ] **Step 6: preload bridges all methods via `ipcRenderer.invoke`**

- [ ] **Step 7: Renderer `ipc.ts`**

```ts
export function api(): LifequestApi {
  if (!window.lifequest) throw new Error("LifeQuest API missing — not running in Electron");
  return window.lifequest;
}
```

- [ ] **Step 8: Manual smoke — create vault via temporary call from Welcome (next task wires UI). Typecheck:**

Run: `npm run typecheck -w @lifequest/desktop`  
Expected: PASS (or fix until pass)

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): vault IPC, recent vaults, secrets, hermes proxy"
```

---

### Task 8: Welcome flow + VaultProvider

**Files:**
- Create: `apps/desktop/src/state/VaultProvider.tsx`
- Create: `apps/desktop/src/pages/WelcomePage.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `api().vaultCreate|vaultOpen|vaultListRecent|dialogOpenDirectory|domainGetActive`
- Produces: React context `{ snapshot, activeSlug, refresh, setActiveSlug, clearVault }`

- [ ] **Step 1: VaultProvider**

On mount: `vaultGetSnapshot`; if null show welcome routes.

Methods:
- `createVault()` → dialog directory → `vaultCreate` → set state  
- `openVault()` → dialog → `vaultOpen`  
- `openRecent(path)` → `vaultOpen`  
- `refresh()` → re-open current path via `vaultGetSnapshot` or re-read  

- [ ] **Step 2: WelcomePage UI**

Buttons: **Create vault**, **Open vault**, list recent (name + path). Show errors from `Result`.

- [ ] **Step 3: App routing**

```tsx
// react-router: /welcome, /home, /domains, /dream, /chart, /track, /act,
// /documents, /decisions, /log, /personnel, /settings
// If !snapshot && path !== /welcome → Navigate to /welcome
```

- [ ] **Step 4: Manual smoke + commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): welcome vault create/open and provider"
```

---

### Task 9: App shell + domain switcher + room unlock gates

**Files:**
- Create: shell components under `apps/desktop/src/components/shell/`
- Create: `apps/desktop/src/pages/HomePage.tsx`, `DomainsPage.tsx`, `RoomPage.tsx`, `ActPage.tsx`
- Salvage nav structure from `components/shell/nav-items.ts` conceptually

**Interfaces:**
- Consumes: `getUnlockedRooms` from vault-core (import in renderer — pure, OK), snapshot domains/docs
- Produces: navigable shell with locked rooms

- [ ] **Step 1: NavRail + AppShell layout**

CSS grid: nav rail | main column; use tokens from `tokens.css`.

Nav items: Home, Dream, Chart, Track, Act, Documents, Domains, Decisions, Log, Personnel, Settings.

- [ ] **Step 2: DomainSwitcher**

Select active domain among non-archived; call `domainSetActive`; `refresh`.

- [ ] **Step 3: RoomLockGate**

```tsx
// if !isRoomUnlocked(room, docs) show lock message; else children
```

Map routes: dream→why, chart→what, track→how.

- [ ] **Step 4: DomainsPage**

List domains; create (name input); rename; archive. Use IPC.

- [ ] **Step 5: HomePage stub** (“Composer coming soon”)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): app shell, domains, room unlock"
```

---

### Task 10: Document editor + status + propose change

**Files:**
- Create: `apps/desktop/src/components/documents/DocumentEditor.tsx`
- Create: `DocumentStatusBadge.tsx`, `ProposeChangeDialog.tsx`
- Create: `apps/desktop/src/pages/DocumentsPage.tsx`
- Wire `RoomPage` to editor for kind

**Interfaces:**
- Consumes: `documentGet|Save|SetStatus`, `decisionCreate`, `assertEditable` / status rules

- [ ] **Step 1: DocumentEditor**

- Load doc for `slug` + `kind`  
- Textarea body; title field  
- Save button → `documentSave`  
- Status controls: transitions via `documentSetStatus`  
- If forged: read-only + “Propose change” opens dialog  

- [ ] **Step 2: ProposeChangeDialog**

Title, rationale, proposed body (prefill current) → `decisionCreate` → toast/message success

- [ ] **Step 3: DocumentsPage** lists three pillars with status badges; links to editors

- [ ] **Step 4: Manual: edit why on disk appears after save; forge then save blocked**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): document editor, forge, propose change"
```

---

### Task 11: Decisions inbox + life log pages

**Files:**
- Create: `DecisionsInbox.tsx`, `DecisionsPage.tsx`
- Create: `LifeLogFeed.tsx`, `LogPage.tsx`

**Interfaces:**
- Consumes: `decisionList|Resolve`, `logList`

- [ ] **Step 1: DecisionsInbox**

Pending list with Approve / Reject; history section for resolved. On approve, `refresh()` so editor sees new body.

- [ ] **Step 2: LifeLogFeed**

Newest first; show `createdAt`, `type`, `summary`, domain slug.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): decisions inbox and life log"
```

---

### Task 12: Personnel + Hermes chat + Settings

**Files:**
- Create: `PersonnelStudio.tsx`, `PersonnelPage.tsx`
- Create: `ChatPanel.tsx` (right dock or bottom)
- Create: `SettingsPage.tsx`
- Modify: `AppShell` to include chat panel

**Interfaces:**
- Consumes: agents*, hermes*, secrets*, settingsUpdate

- [ ] **Step 1: SettingsPage**

- Display vault path + vault id/name  
- Theme select → `settingsUpdate`  
- Hermes base URL → `settingsUpdate`  
- API key input → `secretsSetHermesKey` (never echo back full key; show has/doesn’t have)  
- Test connection button → `hermesTest`  

- [ ] **Step 2: PersonnelStudio**

Scan → list → Hire → appears in roster; Dismiss.

- [ ] **Step 3: ChatPanel**

Local message state; send → `hermesChat`; show errors with link to Settings.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): settings, hermes chat, personnel"
```

---

### Task 13: External file change detection on focus

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `VaultProvider.tsx`

**Interfaces:**
- Produces: `onVaultFileChanged` event; UI reload prompt

- [ ] **Step 1: On BrowserWindow `focus`, re-stat loaded doctrine files for active vault**

If any `mtimeMs` differs from last snapshot, `webContents.send("vault:file-changed", { path })`.

- [ ] **Step 2: Preload subscribe helper already in API**

- [ ] **Step 3: VaultProvider listens; set `stale=true`; banner “Files changed on disk” + Reload button calling `refresh()`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): reload prompt when vault files change on disk"
```

---

### Task 14: Archive web skeleton + root README

**Files:**
- Move: Next app paths → `archive/web-skeleton/` (app, components, lib, prisma, middleware, next.config, tests/unit that are web-specific, etc.)
- Keep: `docs/`, `packages/`, `apps/`, root workspace `package.json`
- Create/Modify: root `README.md`
- Modify: root `package.json` scripts — primary `dev` → desktop; remove prisma scripts or point to archive note
- Update: design spec status line to **Approved**

**Move strategy (explicit):**

```bash
mkdir -p archive/web-skeleton
git mv app components lib prisma middleware.ts next.config.ts next-env.d.ts postcss.config.mjs \
  tests archive/web-skeleton/ 2>/dev/null || true
# also move web-only config; leave docs at root
```

If `git mv` conflicts with workspaces, do logical archive: add `archive/web-skeleton/README.md` stating the commit hash where Next was primary, and strip root Next deps in a follow-up — **prefer actual move**.

Root README content requirements:

- LifeQuest is an **Electron desktop** app  
- Quick start: `npm install`, `npm run dev:desktop`  
- Create/open a vault folder; data is plain files  
- Hermes optional at localhost:8642  
- Link design specs  
- Note: archived web skeleton under `archive/web-skeleton`  

- [ ] **Step 1: Perform archive move + fix workspace package.json**

Root scripts:

```json
{
  "scripts": {
    "dev": "npm run dev -w @lifequest/desktop",
    "dev:desktop": "npm run dev -w @lifequest/desktop",
    "test": "npm run test -w @lifequest/vault-core",
    "build": "npm run build -w @lifequest/desktop"
  }
}
```

Remove Prisma/Next dependencies from **root** if no longer used (they may live only under archive if archive has its own package.json — simplest: leave archive as frozen tree without installing it).

- [ ] **Step 2: `npm install` + `npm test` PASS + desktop build PASS**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: archive Next web skeleton; desktop is primary runtime"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| Electron + Vite + React | 6 |
| vault-core FS + git-native layout | 3–5 |
| Vault identity / welcome | 8 |
| Seed 4 domains | 3 |
| Doctrine md + frontmatter status | 2–4, 10 |
| Domain CRUD | 4, 9 |
| Room unlock | 2, 9 |
| Decisions | 5, 11 |
| Life log JSONL | 3, 5, 11 |
| Agents | 5, 12 |
| safeStorage secrets | 7, 12 |
| Hermes proxy chat/scan/test | 7, 12 |
| Active domain in userData | 7–9 |
| External mtime reload | 13 |
| No Prisma in desktop path | 6–14 |
| Archive web skeleton | 14 |
| schemaVersion refuse | 3 |
| Atomic writes | 3 |
| contextIsolation | 6–7 |

**Placeholder scan:** No TBD steps; IPC and vault-core signatures frozen above.  
**Type consistency:** `Result<T>`, `VaultSnapshot`, `DocumentKind`, decision fields aligned across tasks.

---

## Execution notes

- Implement on a feature branch (`feature/local-vault-electron`).  
- Prefer worktree isolation if parallel work continues on master.  
- Do **not** require electron-builder for DoD.  
- Dogfood DoD from design §14 after Task 14.
