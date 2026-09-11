# Dream Doctrine Four Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each domain four doctrine files (Beliefs & Premise, Vision & Desire, Purpose, Strategy (How)), show them as preview cards on Dream with inline images, and keep How listed on Architecture.

**Architecture:** Keep `why.md` / `what.md` / `how.md` and add `premise.md`. Relabel in UI. Dream uses a four-card grid that renders markdown (including `media/` images). Architecture still lists How. Paste/drop copies bytes into `domains/<slug>/media/` and inserts `![](media/…)`. The editor is a markdown | live-preview split.

**Tech Stack:** vault-core (`node:test`, frontmatter markdown, `safeJoin`), Electron IPC, React 19, React Router 7 HashRouter, existing CSS tokens. No new markdown library.

**Spec:** `docs/superpowers/specs/2026-09-10-dream-doctrine-four-docs-design.md`

## Global Constraints

- Four files per domain: `why.md` (Purpose), `what.md` (Vision & Desire), `how.md` (Strategy (How)), `premise.md` (Beliefs & Premise)
- Do **not** rename existing `why.md` / `what.md` / `how.md`
- Strategy and How are **one** document (`kind: "how"`)
- Architecture **lists** How; Dream shows **cards** for all four
- Helper text is UI chrome only — never written into markdown files
- Remove the empty-How Strategy / Tactics / Habits template
- Images: paste/drop → `domains/<slug>/media/<id>.<ext>`; markdown `![](media/…)`; PNG/JPEG/GIF/WebP; max 8 MB; no remote fetch; no `..`
- Do **not** bump `schemaVersion` (stays `1`)
- Do **not** change room-unlock math or agent-dispatch (still non-empty How)
- Do **not** update `archive/web-skeleton`
- Do **not** garbage-collect unused `media/` files
- Shared labels come from `DOCUMENT_KIND_LABELS` in vault-core
- Commit only files from the current task; leave unrelated dirty files unstaged
- Tests: `node --experimental-strip-types --test` in `packages/vault-core/tests/` and `apps/desktop/tests/`

---

## File Structure

```
packages/vault-core/src/
  types.ts                 # DOCUMENT_KINDS + labels + DREAM_DOCUMENT_KINDS
  paths.ts                 # domainMediaDir, domainMediaFile
  atomic-write.ts          # atomicWriteBytes for images
  domain-documents.ts      # readOrCreateDoctrineFile; save/read media
  domains.ts               # use shared readOrCreate; labels
  open-vault.ts            # use shared readOrCreate
  create-vault.ts          # labels; four files via DOCUMENT_KINDS
packages/vault-core/tests/
  document-kinds.test.ts   # NEW
  create-vault.test.ts     # premise.md seeded
  domains.test.ts          # four files; open fills premise
  domain-documents.test.ts # media save/read/reject

apps/desktop/src/lib/
  doctrine-copy.ts         # NEW: DOCUMENT_KIND_COACHING
  doctrine-markdown.ts     # NEW: doctrineMarkdownToHtml
apps/desktop/src/components/documents/
  MarkdownView.tsx         # NEW
  DocumentEditor.tsx       # split, paste/drop, drop HOW_PLACEHOLDER
apps/desktop/src/components/doctrine/
  DoctrineIndex.tsx        # cards layout, howHref, labels
  DoctrineEditorPage.tsx   # breadcrumb label
  DoctrineStrip.tsx        # shared labels
apps/desktop/src/pages/
  DreamPage.tsx            # DREAM_DOCUMENT_KINDS, cards, howHref=dream
  HomePage.tsx / ActPage.tsx
  ArchitecturePage.tsx     # unchanged kinds (list)
apps/desktop/electron/
  vault-service.ts / preload.ts / main.ts
  map-tools.ts / companion-profile.ts
apps/desktop/tests/
  doctrine-markdown.test.ts
  dream-doctrine-shell.test.ts   # NEW source scans
```

---

### Task 1: Document kinds and labels

**Files:**
- Modify: `packages/vault-core/src/types.ts`
- Create: `packages/vault-core/tests/document-kinds.test.ts`

**Interfaces:**
- Consumes: existing `DOCUMENT_KINDS`
- Produces: `DOCUMENT_KINDS = ["why", "what", "how", "premise"]`; `DOCUMENT_KIND_LABELS`; `DREAM_DOCUMENT_KINDS`

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/document-kinds.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DREAM_DOCUMENT_KINDS,
} from "../src/types.ts";

describe("document kinds", () => {
  it("appends premise and exposes Dream display order plus labels", () => {
    assert.deepEqual([...DOCUMENT_KINDS], ["why", "what", "how", "premise"]);
    assert.deepEqual([...DREAM_DOCUMENT_KINDS], [
      "premise",
      "what",
      "why",
      "how",
    ]);
    assert.equal(DOCUMENT_KIND_LABELS.premise, "Beliefs & Premise");
    assert.equal(DOCUMENT_KIND_LABELS.what, "Vision & Desire");
    assert.equal(DOCUMENT_KIND_LABELS.why, "Purpose");
    assert.equal(DOCUMENT_KIND_LABELS.how, "Strategy (How)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/document-kinds.test.ts`

Expected: FAIL (`DREAM_DOCUMENT_KINDS` / `DOCUMENT_KIND_LABELS` not exported, or `DOCUMENT_KINDS` still three items).

- [ ] **Step 3: Write minimal implementation**

In `packages/vault-core/src/types.ts` replace:

```ts
export const DOCUMENT_KINDS = ["why", "what", "how"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
```

with:

```ts
export const DOCUMENT_KINDS = ["why", "what", "how", "premise"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  premise: "Beliefs & Premise",
  what: "Vision & Desire",
  why: "Purpose",
  how: "Strategy (How)",
};

export const DREAM_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "premise",
  "what",
  "why",
  "how",
];
```

`pure.ts` already `export * from "./types.ts"` — no change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @lifequest/vault-core -- tests/document-kinds.test.ts`

Expected: PASS. Other vault-core tests may fail until Task 2 (missing `premise.md` on open) — that is expected; do not “fix” them by skipping `premise` in `DOCUMENT_KINDS`.

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/types.ts packages/vault-core/tests/document-kinds.test.ts
git commit -m "feat(vault-core): add premise doctrine kind and labels"
```

---

### Task 2: Seed four files and create missing ones on open

**Files:**
- Modify: `packages/vault-core/src/domain-documents.ts`
- Modify: `packages/vault-core/src/domains.ts`
- Modify: `packages/vault-core/src/open-vault.ts`
- Modify: `packages/vault-core/src/create-vault.ts`
- Modify: `packages/vault-core/tests/create-vault.test.ts`
- Modify: `packages/vault-core/tests/domains.test.ts`

**Interfaces:**
- Consumes: `DOCUMENT_KINDS`, `DOCUMENT_KIND_LABELS` from Task 1
- Produces: `readOrCreateDoctrineFile(filePath, kind): Promise<DoctrineDocument>` — existing file parsed; `ENOENT` writes an empty draft titled `DOCUMENT_KIND_LABELS[kind]`

- [ ] **Step 1: Write the failing tests**

In `packages/vault-core/tests/create-vault.test.ts`, inside `"seeds four domains and lifequest.json"`, after the `why.md` asserts add:

```ts
    const premise = await fs.readFile(
      path.join(root, "domains/health/premise.md"),
      "utf8",
    );
    assert.match(premise, /^---\n/);
    assert.match(premise, /title: Beliefs & Premise/);
    assert.match(premise, /status: draft/);
    const health = res.value.domains.find((d) => d.slug === "health");
    assert.ok(health);
    assert.equal(health.documents.premise.title, "Beliefs & Premise");
    assert.equal(health.documents.why.title, "Purpose");
    assert.equal(health.documents.what.title, "Vision & Desire");
    assert.equal(health.documents.how.title, "Strategy (How)");
```

In `packages/vault-core/tests/domains.test.ts` rename the Career test to `"createDomain Career → slug career and four md files"` and replace the three-kind loop with:

```ts
    assert.ok(res.value.documents.premise);
    assert.ok(res.value.documents.why);
    assert.ok(res.value.documents.what);
    assert.ok(res.value.documents.how);
    assert.equal(res.value.documents.premise.title, "Beliefs & Premise");

    for (const kind of ["why", "what", "how", "premise"] as const) {
      const md = await fs.readFile(
        path.join(root, "domains", "career", `${kind}.md`),
        "utf8",
      );
      assert.match(md, /^---\n/);
      assert.match(md, /status: draft/);
    }
```

Add a new test in the same describe:

```ts
  it("openVault creates missing premise.md as an empty draft", async () => {
    const created = await createDomain(root, { name: "Legacy Three" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const premisePath = path.join(
      root,
      "domains",
      created.value.slug,
      "premise.md",
    );
    await fs.rm(premisePath, { force: true });
    const { openVault } = await import("../src/open-vault.ts");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const domain = opened.value.domains.find(
      (d) => d.slug === created.value.slug,
    );
    assert.ok(domain);
    assert.equal(domain.documents.premise.bodyMarkdown.trim(), "");
    assert.equal(domain.documents.premise.status, "draft");
    assert.equal(domain.documents.premise.title, "Beliefs & Premise");
    const raw = await fs.readFile(premisePath, "utf8");
    assert.match(raw, /title: Beliefs & Premise/);
  });
```

Prefer a static import of `openVault` at the top of `domains.test.ts` instead of the dynamic import if the file does not already import it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/vault-core -- tests/create-vault.test.ts tests/domains.test.ts`

Expected: FAIL (no `premise.md`, titles still Why/What/How, open throws on missing file).

- [ ] **Step 3: Write minimal implementation**

In `packages/vault-core/src/domain-documents.ts` replace local `KIND_TITLES` with `DOCUMENT_KIND_LABELS` and export a shared loader:

```ts
import { DOCUMENT_KIND_LABELS, DOCUMENT_KINDS, ... } from "./types.ts";

export async function readOrCreateDoctrineFile(
  filePath: string,
  kind: DocumentKind,
): Promise<DoctrineDocument> {
  try {
    return await readDoctrineFile(filePath, kind);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const now = new Date().toISOString();
  const title = DOCUMENT_KIND_LABELS[kind];
  const md = serializeFrontmatter(
    { title, status: "draft", forgedAt: null, updatedAt: now },
    "",
  );
  await atomicWriteFile(filePath, md);
  return readDoctrineFile(filePath, kind);
}
```

`readDoctrineFile` fallback title becomes `DOCUMENT_KIND_LABELS[kind]` (not `"Why"`).

In `packages/vault-core/src/domains.ts` delete local `KIND_TITLES` and `readDoctrineFile`. `loadDomainRecord` loops:

```ts
for (const kind of DOCUMENT_KINDS) {
  documents[kind] = await readOrCreateDoctrineFile(
    paths.documentMd(slug, kind),
    kind,
  );
}
```

`createDomain` frontmatter title: `DOCUMENT_KIND_LABELS[kind]`.

In `packages/vault-core/src/open-vault.ts` delete local `readDoctrineFile`. `loadDomain` uses `readOrCreateDoctrineFile` the same way as `loadDomainRecord`. Fallback title is no longer `kind[0].toUpperCase()`.

In `packages/vault-core/src/create-vault.ts` replace `KIND_TITLES` with `DOCUMENT_KIND_LABELS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core`

Expected: PASS (including previously broken tests that loaded domains).

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/domain-documents.ts packages/vault-core/src/domains.ts packages/vault-core/src/open-vault.ts packages/vault-core/src/create-vault.ts packages/vault-core/tests/create-vault.test.ts packages/vault-core/tests/domains.test.ts
git commit -m "feat(vault-core): seed premise.md and backfill on open"
```

---

### Task 3: Domain media save and read

**Files:**
- Modify: `packages/vault-core/src/paths.ts`
- Modify: `packages/vault-core/src/atomic-write.ts`
- Modify: `packages/vault-core/src/domain-documents.ts`
- Modify: `packages/vault-core/src/types.ts` (export media constants if used by desktop)
- Modify: `packages/vault-core/tests/domain-documents.test.ts`
- Modify: `packages/vault-core/tests/create-vault.test.ts` (safeJoin media path if adding a helper test)

**Interfaces:**
- Consumes: `vaultPaths`, `safeJoin`, `atomicWriteBytes`
- Produces:

```ts
export const DOCUMENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_MEDIA_REL = /^media\/[A-Za-z0-9._-]+$/;

export async function saveDocumentMedia(
  rootPath: string,
  slug: string,
  input: { bytes: Uint8Array; mime: string },
): Promise<Result<{ relPath: string }>>;

export async function readDocumentMedia(
  rootPath: string,
  slug: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>>;
```

- [ ] **Step 1: Write the failing tests**

Append to `packages/vault-core/tests/domain-documents.test.ts`:

```ts
import {
  DOCUMENT_MEDIA_MAX_BYTES,
  readDocumentMedia,
  saveDocumentMedia,
} from "../src/domain-documents.ts";

describe("document media", () => {
  it("saves png bytes under domains/<slug>/media and reads them back", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const saved = await saveDocumentMedia(root, "health", {
      bytes: png,
      mime: "image/png",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.match(saved.value.relPath, /^media\/[0-9a-f-]+\.png$/i);
    const onDisk = await fs.readFile(
      path.join(root, "domains", "health", ...saved.value.relPath.split("/")),
    );
    assert.deepEqual(new Uint8Array(onDisk), png);

    const read = await readDocumentMedia(root, "health", saved.value.relPath);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.mime, "image/png");
    assert.deepEqual(read.value.bytes, png);
  });

  it("rejects unknown mime, oversize, and traversal relPath", async () => {
    const tiny = new Uint8Array([1, 2, 3]);
    const badMime = await saveDocumentMedia(root, "health", {
      bytes: tiny,
      mime: "application/pdf",
    });
    assert.equal(badMime.ok, false);

    const tooBig = await saveDocumentMedia(root, "health", {
      bytes: new Uint8Array(DOCUMENT_MEDIA_MAX_BYTES + 1),
      mime: "image/png",
    });
    assert.equal(tooBig.ok, false);

    const traversal = await readDocumentMedia(
      root,
      "health",
      "media/../domain.json",
    );
    assert.equal(traversal.ok, false);
    const absolute = await readDocumentMedia(root, "health", "/etc/passwd");
    assert.equal(absolute.ok, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/domain-documents.test.ts`

Expected: FAIL (`saveDocumentMedia` not exported).

- [ ] **Step 3: Write minimal implementation**

`packages/vault-core/src/paths.ts` — add to the object returned by `vaultPaths`:

```ts
domainMediaDir: (slug: string) => safeJoin(rootPath, "domains", slug, "media"),
domainMediaFile: (slug: string, name: string) =>
  safeJoin(rootPath, "domains", slug, "media", name),
```

`packages/vault-core/src/atomic-write.ts`:

```ts
export async function atomicWriteBytes(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, filePath);
}
```

`packages/vault-core/src/types.ts` (or domain-documents — export from types if desktop needs the regex): keep the max and regex next to the functions in `domain-documents.ts` and re-export via `index.ts` (already `export * from "./domain-documents.ts"`).

In `domain-documents.ts`:

```ts
import { randomUUID } from "node:crypto";
import { atomicWriteBytes } from "./atomic-write.ts";

export const DOCUMENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_MEDIA_REL = /^media\/[A-Za-z0-9._-]+$/;

const MEDIA_EXT: Record<string, { ext: string; mime: string }> = {
  "image/png": { ext: "png", mime: "image/png" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/gif": { ext: "gif", mime: "image/gif" },
  "image/webp": { ext: "webp", mime: "image/webp" },
};

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function saveDocumentMedia(
  rootPath: string,
  slug: string,
  input: { bytes: Uint8Array; mime: string },
): Promise<Result<{ relPath: string }>> {
  try {
    const kind = MEDIA_EXT[input.mime];
    if (!kind) return { ok: false, error: `Unsupported image type: ${input.mime}` };
    if (input.bytes.byteLength === 0) {
      return { ok: false, error: "Image is empty" };
    }
    if (input.bytes.byteLength > DOCUMENT_MEDIA_MAX_BYTES) {
      return { ok: false, error: "Image is larger than 8 MB" };
    }
    const paths = vaultPaths(rootPath);
    const name = `${randomUUID()}.${kind.ext}`;
    const filePath = paths.domainMediaFile(slug, name);
    await atomicWriteBytes(filePath, input.bytes);
    return { ok: true, value: { relPath: `media/${name}` } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readDocumentMedia(
  rootPath: string,
  slug: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  try {
    if (!DOCUMENT_MEDIA_REL.test(relPath)) {
      return { ok: false, error: `Invalid media path: ${relPath}` };
    }
    const name = relPath.slice("media/".length);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const mime = EXT_MIME[ext];
    if (!mime) return { ok: false, error: `Unsupported image type: ${ext}` };
    const filePath = vaultPaths(rootPath).domainMediaFile(slug, name);
    const buf = await fs.readFile(filePath);
    return { ok: true, value: { bytes: new Uint8Array(buf), mime } };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: `Media not found: ${slug}/${relPath}` };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

`domainMediaFile` uses `safeJoin(..., name)` so `name` containing `..` throws — catch that as `{ ok: false }`. Prefer relying on `DOCUMENT_MEDIA_REL` so `media/../x` never reaches `safeJoin`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/paths.ts packages/vault-core/src/atomic-write.ts packages/vault-core/src/domain-documents.ts packages/vault-core/tests/domain-documents.test.ts
git commit -m "feat(vault-core): save and read domain doctrine images"
```

---

### Task 4: Doctrine markdown helper

**Files:**
- Create: `apps/desktop/src/lib/doctrine-markdown.ts`
- Create: `apps/desktop/tests/doctrine-markdown.test.ts`

**Interfaces:**
- Consumes: none from vault-core besides the `media/` path rule
- Produces: `doctrineMarkdownToHtml(markdown: string): string` — escaped HTML; `![](media/x.png)` becomes `<img data-media="media/x.png" alt="…">`; `http` / `javascript:` / `file:` image srcs omitted; headings/lists/paragraphs/bold/italic/inline code supported

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/doctrine-markdown.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doctrineMarkdownToHtml } from "../src/lib/doctrine-markdown.ts";

describe("doctrineMarkdownToHtml", () => {
  it("renders media images and ignores unsafe image srcs", () => {
    const html = doctrineMarkdownToHtml(
      "Hello **world**\n\n![strength](media/abc.png)\n\n![x](javascript:alert(1))\n\n![y](https://evil.example/x.png)\n\n![z](file:///etc/passwd)",
    );
    assert.match(html, /Hello <strong>world<\/strong>/);
    assert.match(
      html,
      /<img data-media="media\/abc\.png" alt="strength">/,
    );
    assert.equal(html.includes("javascript:"), false);
    assert.equal(html.includes("https://evil.example"), false);
    assert.equal(html.includes("file:"), false);
  });

  it("escapes raw HTML", () => {
    const html = doctrineMarkdownToHtml("<script>alert(1)</script>");
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/doctrine-markdown.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/lib/doctrine-markdown.ts`:

```ts
const MEDIA_SRC = /^media\/[A-Za-z0-9._-]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, src: string) => {
      if (!MEDIA_SRC.test(src)) return "";
      return `<img data-media="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    },
  );
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return s;
}

export function doctrineMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let inCode = false;
  const codeBuf: string[] = [];
  const para: string[] = [];

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inlineFormat(para.join(" "))}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim().startsWith("```")) {
      flushPara();
      closeLists();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeLists();
      i += 1;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushPara();
      closeLists();
      const level = h[1]!.length;
      out.push(`<h${level}>${inlineFormat(h[2]!)}</h${level}>`);
      i += 1;
      continue;
    }
    const ul = line.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(ul[1]!)}</li>`);
      i += 1;
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inlineFormat(ol[1]!)}</li>`);
      i += 1;
      continue;
    }
    closeLists();
    para.push(line);
    i += 1;
  }
  flushPara();
  closeLists();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("");
}
```

Image regex must run **before** link regex so `![alt](url)` is not treated as a link. Order in `inlineFormat` above is correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @lifequest/desktop -- tests/doctrine-markdown.test.ts`

Expected: PASS. If the exact HTML of the first assertion differs (paragraph wrapping), adjust the test to `assert.match(html, /<strong>world<\/strong>/)` and `assert.match(html, /data-media="media\/abc\.png"/)` rather than loosening safety assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/doctrine-markdown.ts apps/desktop/tests/doctrine-markdown.test.ts
git commit -m "feat(desktop): add safe doctrine markdown with media images"
```

---

### Task 5: Coaching copy, IPC, and MarkdownView

**Files:**
- Create: `apps/desktop/src/lib/doctrine-copy.ts`
- Create: `apps/desktop/src/components/documents/MarkdownView.tsx`
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Create: `apps/desktop/tests/dream-doctrine-shell.test.ts` (start here; later tasks append)

**Interfaces:**
- Consumes: `saveDocumentMedia` / `readDocumentMedia` (Task 3), `doctrineMarkdownToHtml` (Task 4), `DOCUMENT_KIND_LABELS` (Task 1)
- Produces:

```ts
export const DOCUMENT_KIND_COACHING: Record<DocumentKind, string>;

// IPC
documentMediaSave(slug: string, input: { bytes: Uint8Array; mime: string }): Promise<Result<{ relPath: string }>>
documentMediaRead(slug: string, relPath: string): Promise<Result<{ bytes: Uint8Array; mime: string }>>

export function MarkdownView({ markdown, slug }: { markdown: string; slug: string }): JSX.Element
```

Coaching strings (verbatim from the spec):

```ts
import type { DocumentKind } from "@lifequest/vault-core/pure";

export const DOCUMENT_KIND_COACHING: Record<DocumentKind, string> = {
  premise:
    "Your Premise refers to the foundational beliefs you hold about this category. What do you believe? What deeply held beliefs are shaping your life? Are your beliefs empowering? Do they move you at a deep level or are they holding you back? What is your Premise for this area of your life, or what would you like it to be?",
  what:
    "Your Vision refers to the ideal state you would like to achieve in this important category. Ask yourself: How do you want this area of your life to feel? What do you want it to look like? What do you want to be doing on a consistent basis? Clearly describe your ideal Vision.",
  why:
    "Your Purpose refers to the compelling reasons behind what you want in this category. What energizes you? What empowers you to take action? What motivates you to achieve your Vision? Describe WHY you want to make the most out of this area of your life.",
  how:
    "Your Strategy refers to the specific actions that will get you from where you are now to where you want to be. How will you bring your vision into reality? Ask yourself what kind of positive habits, attitudes and action steps you can implement. What’s the RECIPE for the Vision you want to create?",
};
```

Use the spec’s curly apostrophe in `What’s` on the How string.

- [ ] **Step 1: Write the failing shell test**

Create `apps/desktop/tests/dream-doctrine-shell.test.ts`:

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

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

describe("doctrine media IPC", () => {
  it("exposes documentMediaSave and documentMediaRead", () => {
    const service = read("electron/vault-service.ts");
    assert.match(service, /export async function documentMediaSave/);
    assert.match(service, /export async function documentMediaRead/);
    const main = read("electron/main.ts");
    assert.match(main, /document:mediaSave/);
    assert.match(main, /document:mediaRead/);
    const preload = read("electron/preload.ts");
    assert.match(preload, /documentMediaSave/);
    assert.match(preload, /documentMediaRead/);
  });
});

describe("MarkdownView", () => {
  it("loads media via documentMediaRead and uses doctrineMarkdownToHtml", () => {
    const src = read("src/components/documents/MarkdownView.tsx");
    assert.match(src, /doctrineMarkdownToHtml/);
    assert.match(src, /documentMediaRead/);
    assert.match(src, /data-media/);
  });
});

describe("doctrine coaching", () => {
  it("keeps helper text out of vault files and matches the four paragraphs", () => {
    const copy = read("src/lib/doctrine-copy.ts");
    assert.match(copy, /foundational beliefs you hold about this category/);
    assert.match(copy, /ideal state you would like to achieve/);
    assert.match(copy, /compelling reasons behind what you want/);
    assert.match(copy, /RECIPE for the Vision you want to create/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: FAIL (files/IPC missing).

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/lib/doctrine-copy.ts` with `DOCUMENT_KIND_COACHING` as above.

`vault-service.ts` — import `saveDocumentMedia` / `readDocumentMedia` from `@lifequest/vault-core` and add:

```ts
export async function documentMediaSave(
  slug: string,
  input: { bytes: Uint8Array; mime: string },
): Promise<Result<{ relPath: string }>> {
  return withVault((root) => saveDocumentMedia(root, slug, input));
}

export async function documentMediaRead(
  slug: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  return withVault((root) => readDocumentMedia(root, slug, relPath));
}
```

`main.ts` next to other `document:` handlers:

```ts
ipcMain.handle(
  "document:mediaSave",
  (
    _e,
    slug: string,
    input: { bytes: Uint8Array; mime: string },
  ) => vault.documentMediaSave(slug, input),
);
ipcMain.handle(
  "document:mediaRead",
  (_e, slug: string, relPath: string) =>
    vault.documentMediaRead(slug, relPath),
);
```

`preload.ts`:

```ts
documentMediaSave: (
  slug: string,
  input: { bytes: Uint8Array; mime: string },
) =>
  ipcRenderer.invoke("document:mediaSave", slug, input) as Promise<
    Result<{ relPath: string }>
  >,
documentMediaRead: (slug: string, relPath: string) =>
  ipcRenderer.invoke("document:mediaRead", slug, relPath) as Promise<
    Result<{ bytes: Uint8Array; mime: string }>
  >,
```

`vite-env.d.ts` — add the same two methods on `LifequestApi`.

Create `apps/desktop/src/components/documents/MarkdownView.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react";
import { doctrineMarkdownToHtml } from "@/lib/doctrine-markdown";
import { api } from "@/lib/ipc";

export function MarkdownView({
  markdown,
  slug,
}: {
  markdown: string;
  slug: string;
}) {
  const html = useMemo(() => doctrineMarkdownToHtml(markdown), [markdown]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const imgs = [...root.querySelectorAll<HTMLImageElement>("img[data-media]")];
    const urls: string[] = [];
    let cancelled = false;
    void (async () => {
      for (const img of imgs) {
        const rel = img.getAttribute("data-media");
        if (!rel) continue;
        const res = await api().documentMediaRead(slug, rel);
        if (cancelled) return;
        if (!res.ok) {
          img.replaceWith(
            Object.assign(document.createElement("span"), {
              className: "md-image-missing muted",
              textContent: img.alt || "image missing",
            }),
          );
          continue;
        }
        const blob = new Blob([res.value.bytes], { type: res.value.mime });
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [html, slug]);

  return (
    <div
      ref={ref}
      className="md-view"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

HTML is produced only by `doctrineMarkdownToHtml` (escaped). Do not pass raw user HTML.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts tests/doctrine-markdown.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/doctrine-copy.ts apps/desktop/src/components/documents/MarkdownView.tsx apps/desktop/electron/vault-service.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/vite-env.d.ts apps/desktop/tests/dream-doctrine-shell.test.ts
git commit -m "feat(desktop): add doctrine image IPC and MarkdownView"
```

---

### Task 6: Split editor, coaching, paste/drop

**Files:**
- Modify: `apps/desktop/src/components/documents/DocumentEditor.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/tests/dream-doctrine-shell.test.ts`

**Interfaces:**
- Consumes: `DOCUMENT_KIND_LABELS`, `DOCUMENT_KIND_COACHING`, `MarkdownView`, `documentMediaSave`
- Produces: split markdown | preview; paste/drop inserts `![](relPath)`; no `HOW_PLACEHOLDER`

- [ ] **Step 1: Extend the shell test**

Append to `dream-doctrine-shell.test.ts`:

```ts
describe("DocumentEditor", () => {
  it("is a split editor with coaching and no How template", () => {
    const src = read("src/components/documents/DocumentEditor.tsx");
    assert.equal(src.includes("HOW_PLACEHOLDER"), false);
    assert.equal(src.includes("# Tactics"), false);
    assert.match(src, /DOCUMENT_KIND_COACHING/);
    assert.match(src, /DOCUMENT_KIND_LABELS/);
    assert.match(src, /doc-editor__split/);
    assert.match(src, /MarkdownView/);
    assert.match(src, /onPaste/);
    assert.match(src, /onDrop/);
    assert.match(src, /documentMediaSave/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: FAIL (`HOW_PLACEHOLDER` still present).

- [ ] **Step 3: Write minimal implementation**

In `DocumentEditor.tsx`:

- Delete `HOW_PLACEHOLDER`, `COACHING`, `KIND_LABELS`, and `initialEditorBody`. Load body as `doc.bodyMarkdown` always.
- Import `DOCUMENT_KIND_LABELS` from `@lifequest/vault-core/pure`, `DOCUMENT_KIND_COACHING` from `@/lib/doctrine-copy`, `MarkdownView`.
- Heading uses `DOCUMENT_KIND_LABELS[kind]`. Coaching line uses `DOCUMENT_KIND_COACHING[kind]`.
- Replace the single textarea field with:

```tsx
<div className="doc-editor__split">
  <label className="field doc-editor__body-field">
    <span>Markdown</span>
    <textarea
      className="doc-editor__textarea"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onPaste={(e) => void onPaste(e)}
      onDrop={(e) => void onDrop(e)}
      onDragOver={(e) => {
        if (!isForged) e.preventDefault();
      }}
      readOnly={isForged}
      disabled={busy}
      rows={18}
      spellCheck
    />
  </label>
  <div className="doc-editor__preview">
    <span className="doc-editor__preview-label">Preview</span>
    <MarkdownView markdown={draft} slug={slug} />
  </div>
</div>
```

Add helpers in the same file:

```ts
function insertAtCaret(
  value: string,
  start: number,
  end: number,
  insert: string,
): { next: string; caret: number } {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return { next, caret: start + insert.length };
}

async function saveImageFile(
  slug: string,
  file: File,
): Promise<Result<{ relPath: string }>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return api().documentMediaSave(slug, { bytes: buf, mime: file.type });
}
```

`onPaste` / `onDrop` (skip when `isForged`): take the first `image/*` item from `clipboardData` / `dataTransfer`, `preventDefault`, `saveImageFile`, then insert `\n![](${relPath})\n` at `textarea.selectionStart` (use a ref on the textarea). On `{ ok: false }` set `actionError`. On success set `draft` so the preview updates (dirty).

Remove the “Template is local only until you Save.” hint.

CSS in `apps/desktop/src/styles/global.css` near `.doc-editor`:

```css
.doc-editor__split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  align-items: stretch;
}
.doc-editor__preview {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.55rem 0.65rem;
  min-height: 12rem;
  overflow: auto;
}
.doc-editor__preview-label {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 0.4rem;
}
.md-view img {
  max-width: 100%;
  height: auto;
  border-radius: 0.35rem;
}
```

If `.doc-editor` already exists, append these rules; do not restyle the rest of the editor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/documents/DocumentEditor.tsx apps/desktop/src/styles/global.css apps/desktop/tests/dream-doctrine-shell.test.ts
git commit -m "feat(desktop): split doctrine editor with paste images"
```

---

### Task 7: Dream preview cards

**Files:**
- Modify: `apps/desktop/src/components/doctrine/DoctrineIndex.tsx`
- Modify: `apps/desktop/src/pages/DreamPage.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/tests/dream-doctrine-shell.test.ts`
- Modify: `apps/desktop/tests/domain-lens-shell.test.ts` if it still assumes Why/What list only (keep `/dream/` match; do not require the old two-kind array)

**Interfaces:**
- Consumes: `DREAM_DOCUMENT_KINDS`, `DOCUMENT_KIND_LABELS`, `DOCUMENT_KIND_COACHING`, `MarkdownView`
- Produces: `DoctrineIndex({ kinds, howHref?: "dream" | "track", layout?: "list" | "cards" })`

- [ ] **Step 1: Extend the shell test**

```ts
describe("Dream cards", () => {
  it("lists four kinds as cards and sends How to /dream/:slug/how", () => {
    const dream = read("src/pages/DreamPage.tsx");
    assert.match(dream, /DREAM_DOCUMENT_KINDS/);
    assert.match(dream, /howHref=["']dream["']/);
    assert.match(dream, /layout=["']cards["']/);
    const arch = read("src/pages/ArchitecturePage.tsx");
    assert.match(arch, /kinds=\{\["how"\]\}/);
    assert.equal(arch.includes('layout="cards"'), false);
    const index = read("src/components/doctrine/DoctrineIndex.tsx");
    assert.match(index, /DOCUMENT_KIND_LABELS/);
    assert.match(index, /DOCUMENT_KIND_COACHING/);
    assert.match(index, /MarkdownView/);
    assert.match(index, /howHref/);
    assert.match(index, /layout/);
    assert.match(index, /\/dream\/\$\{slug\}\/how|\/dream\/\$\{.*\}\/how/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts`

Expected: FAIL (`DreamPage` still `kinds={["why", "what"]}`).

- [ ] **Step 3: Write minimal implementation**

`DreamPage.tsx`:

```tsx
import { DREAM_DOCUMENT_KINDS } from "@lifequest/vault-core/pure";
import { DoctrineIndex } from "@/components/doctrine/DoctrineIndex";

export default function DreamPage() {
  return (
    <div className="dream-page">
      <h1>Dream</h1>
      <DoctrineIndex
        kinds={[...DREAM_DOCUMENT_KINDS]}
        howHref="dream"
        layout="cards"
      />
    </div>
  );
}
```

Rewrite `DoctrineIndex.tsx`:

```tsx
import { Link } from "react-router-dom";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@lifequest/vault-core/pure";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { DOCUMENT_KIND_COACHING } from "@/lib/doctrine-copy";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

function rowHref(
  kind: DocumentKind,
  slug: string,
  howHref: "dream" | "track",
): string {
  if (kind === "how") {
    return howHref === "dream"
      ? `/dream/${slug}/how`
      : `/track/${slug}/how`;
  }
  return `/dream/${slug}/${kind}`;
}

export function DoctrineIndex({
  kinds,
  howHref = "track",
  layout = "list",
}: {
  kinds: DocumentKind[];
  howHref?: "dream" | "track";
  layout?: "list" | "cards";
}) {
  const { snapshot } = useVault();
  const lens = useDomainLens();

  const domains = (snapshot?.domains ?? [])
    .filter((d) => !d.meta.archivedAt)
    .filter((d) => (lens.kind === "domain" ? d.slug === lens.slug : true))
    .slice()
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);

  if (domains.length === 0) {
    return <p className="muted">No live domains yet.</p>;
  }

  return (
    <div className="doctrine-index">
      {domains.map((domain) => (
        <section key={domain.slug} className="doctrine-index__group">
          <h2 className="doctrine-index__heading">{domain.meta.name}</h2>
          {layout === "cards" ? (
            <div className="doctrine-index__cards">
              {kinds.map((kind) => {
                const doc = domain.documents[kind];
                const body = doc?.bodyMarkdown ?? "";
                const empty = body.trim().length === 0;
                return (
                  <Link
                    key={kind}
                    to={rowHref(kind, domain.slug, howHref)}
                    className="doctrine-index__card"
                  >
                    <div className="doctrine-index__card-head">
                      <span className="doctrine-index__card-title">
                        {DOCUMENT_KIND_LABELS[kind]}
                      </span>
                      <DocumentStatusBadge status={doc?.status ?? "draft"} />
                    </div>
                    <div className="doctrine-index__card-body">
                      {empty ? (
                        <p className="doctrine-index__help muted">
                          {DOCUMENT_KIND_COACHING[kind]}
                        </p>
                      ) : (
                        <MarkdownView markdown={body} slug={domain.slug} />
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <ul className="doctrine-index__list">
              {kinds.map((kind) => {
                const doc = domain.documents[kind];
                return (
                  <li key={kind} className="doctrine-index__row">
                    <Link
                      to={rowHref(kind, domain.slug, howHref)}
                      className="doctrine-index__label"
                    >
                      {DOCUMENT_KIND_LABELS[kind]}
                    </Link>
                    <DocumentStatusBadge status={doc?.status ?? "draft"} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
```

CSS (append after existing `.doctrine-index` rules):

```css
.doctrine-index__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.doctrine-index__card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
}
.doctrine-index__card:hover {
  border-color: var(--accent);
}
.doctrine-index__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--border);
}
.doctrine-index__card-title {
  font-weight: 700;
  font-size: 0.9rem;
}
.doctrine-index__card-body {
  padding: 0.55rem 0.65rem 0.7rem;
  max-height: 12rem;
  overflow: auto;
}
.doctrine-index__help {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
}
@media (max-width: 1100px) {
  .doctrine-index__cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .doctrine-index__cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

If `--surface` is not defined, use `var(--bg, transparent)` or the same background as `.doctrine-index__row`.

Architecture page stays `<DoctrineIndex kinds={["how"]} />` (list + default `howHref="track"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts tests/domain-lens-shell.test.ts tests/wing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/doctrine/DoctrineIndex.tsx apps/desktop/src/pages/DreamPage.tsx apps/desktop/src/styles/global.css apps/desktop/tests/dream-doctrine-shell.test.ts
git commit -m "feat(desktop): show Dream doctrine as four preview cards"
```

---

### Task 8: Relabel remaining surfaces and companion

**Files:**
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`
- Modify: `apps/desktop/src/components/doctrine/DoctrineEditorPage.tsx`
- Modify: `apps/desktop/src/components/doctrine/DoctrineStrip.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsDomains.tsx`
- Modify: `apps/desktop/electron/map-tools.ts`
- Modify: `apps/desktop/electron/companion-profile.ts`
- Modify: `apps/desktop/tests/companion-profile.test.ts`
- Modify: `apps/desktop/tests/dream-doctrine-shell.test.ts`
- Modify: `PRODUCT.md`

**Interfaces:**
- Consumes: `DOCUMENT_KIND_LABELS`, `DREAM_DOCUMENT_KINDS`
- Produces: every user-visible doctrine name uses the new labels; `get_doctrine` includes `premise`; companion must not rewrite the four docs

- [ ] **Step 1: Extend tests**

In `dream-doctrine-shell.test.ts`:

```ts
describe("doctrine labels on other surfaces", () => {
  it("Home How still goes to Architecture; other kinds to Dream", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /DOCUMENT_KIND_LABELS|DREAM_DOCUMENT_KINDS/);
    assert.match(home, /\/track\/\$\{slug\}\/how|\/track\/\$\{.*\}\/how/);
    assert.match(home, /\/dream\/\$\{slug\}\/\$\{kind\}|\/dream\/\$\{.*\}\/\$\{kind\}|\/dream\/\$\{slug\}\/\$\{row\.kind\}/);
    const act = read("src/pages/ActPage.tsx");
    assert.match(act, /DOCUMENT_KIND_LABELS/);
    const strip = read("src/components/doctrine/DoctrineStrip.tsx");
    assert.match(strip, /DOCUMENT_KIND_LABELS/);
    assert.equal(strip.includes("North Star"), false);
    const editorPage = read("src/components/doctrine/DoctrineEditorPage.tsx");
    assert.match(editorPage, /DOCUMENT_KIND_LABELS/);
    const tools = read("electron/map-tools.ts");
    assert.match(tools, /premise: domain\.documents\.premise/);
  });
});
```

In `apps/desktop/tests/companion-profile.test.ts` add:

```ts
    assert.match(COMPANION_SOUL, /Premise/);
    assert.match(COMPANION_SOUL, /Strategy \(How\)/);
    assert.match(COMPANION_SOUL, /Do not rewrite/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/desktop -- tests/dream-doctrine-shell.test.ts tests/companion-profile.test.ts`

Expected: FAIL (old Why/What/How copy).

- [ ] **Step 3: Write minimal implementation**

`HomePage.tsx` — replace `DOCTRINE_ROWS` / `doctrineHref`:

```ts
import {
  DOCUMENT_KIND_LABELS,
  DREAM_DOCUMENT_KINDS,
  type DocumentKind,
} from "@lifequest/vault-core/pure";

function doctrineHref(kind: DocumentKind, slug: string): string {
  if (kind === "how") return `/track/${slug}/how`;
  return `/dream/${slug}/${kind}`;
}
```

Render `DREAM_DOCUMENT_KINDS` (or `[...DREAM_DOCUMENT_KINDS]`) with `DOCUMENT_KIND_LABELS[kind]` as `row.label`.

`ActPage.tsx` — `BRIEF_KINDS` from `DREAM_DOCUMENT_KINDS`:

```ts
const BRIEF_KINDS = DREAM_DOCUMENT_KINDS.map((kind) => ({
  kind,
  label: DOCUMENT_KIND_LABELS[kind],
  room: kind === "how" ? "Track" : "Dream",
}));
```

`DoctrineEditorPage.tsx` breadcrumb: `{DOCUMENT_KIND_LABELS[kind]}` instead of `{kind}`.

`DoctrineStrip.tsx`:

```tsx
const label = DOCUMENT_KIND_LABELS[kind];
const preview = body ? body.slice(0, 180) : `No ${label} yet.`;
```

Keep What → `/dream/${slug}/what`, How → `/track/${slug}/how`.

`SettingsDomains.tsx` — iterate `DOCUMENT_KINDS` or `DREAM_DOCUMENT_KINDS` and display `DOCUMENT_KIND_LABELS[kind]` instead of the raw kind id.

`map-tools.ts` `SYSTEM`:

```
Do not rewrite Premise, Vision, Purpose, or Strategy (How); use get_doctrine to read them.
```

`get_doctrine` payloads add `premise: domain.documents.premise` in all three return shapes. Tool description in `packages/vault-core/src/map/tools.ts`:

```
Read Premise / Vision / Purpose / Strategy (How) for a domain (default: active domain)
```

`companion-profile.ts` `COMPANION_SOUL` — replace `Why → What → How` and `Do not rewrite Why, What, or How` with Premise, Vision, Purpose, and Strategy (How). Keep `get_doctrine`, LOCKED, and agent-lock sentences.

`PRODUCT.md` users line:

```
organizing life into Domains, forging Premise → Vision → Purpose → Strategy (How), reviewing Decisions, keeping a Life log, and optionally talking to Hermes agents.
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```
npm test -w @lifequest/vault-core
npm test -w @lifequest/desktop
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/HomePage.tsx apps/desktop/src/pages/ActPage.tsx apps/desktop/src/components/doctrine/DoctrineEditorPage.tsx apps/desktop/src/components/doctrine/DoctrineStrip.tsx apps/desktop/src/components/settings/SettingsDomains.tsx apps/desktop/electron/map-tools.ts apps/desktop/electron/companion-profile.ts packages/vault-core/src/map/tools.ts apps/desktop/tests/companion-profile.test.ts apps/desktop/tests/dream-doctrine-shell.test.ts PRODUCT.md
git commit -m "feat(desktop): relabel doctrine to Premise Vision Purpose Strategy"
```

---

## Self-review

**Spec coverage**

| Spec decision | Task |
|---|---|
| Four kinds + labels + mapping | 1, 2, 8 |
| Seed + backfill `premise.md` | 2 |
| Dream cards, empty helper, How → `/dream/:slug/how` | 7 |
| Architecture list How | 7 (unchanged call) |
| Home/Act How → `/track` | 8 |
| Split editor, drop How template | 6 |
| Paste/drop images, media dir, 8 MB, types | 3, 5, 6 |
| Safe markdown, no remote images | 4, 5 |
| `get_doctrine` + companion | 8 |
| Shared labels / Chart strip | 8 |
| No schema bump, no archive/web-skeleton, no unlock change | all (omitted) |

**Placeholders:** none.

**Types:** `documentMediaSave` / `documentMediaRead` signatures match vault-core → vault-service → preload → `LifequestApi` → `MarkdownView` / `DocumentEditor`. `DOCUMENT_KIND_LABELS` / `DREAM_DOCUMENT_KINDS` / `DOCUMENT_KIND_COACHING` used consistently. `howHref` `"dream" \| "track"` and `layout` `"list" \| "cards"` match Dream vs Architecture.
