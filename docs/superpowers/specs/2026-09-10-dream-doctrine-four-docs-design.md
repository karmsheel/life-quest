# Dream Doctrine Four Documents — Design Spec

**Date:** 2026-09-10  
**Status:** Draft — awaiting user review  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Overview Domain Lens](./2026-08-31-overview-domain-lens-design.md), [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md)

Supersedes locked decision 11 of the Overview Domain Lens spec (*Still exactly one Why, What, How per domain folder*) and Dream/Architecture index copy in that spec (Dream = Why and What; Architecture = How only as the Vision-wing index). Architecture still lists How; Dream now shows four documents as cards, including How.

---

## 1. Purpose

Dream currently shows two doctrine files per domain (Why, What) as a stacked list. The Vision-wing work surface should show four documents as **rectangular cards in a row**: **Beliefs & Premise**, **Vision & Desire**, **Purpose**, and **Strategy (How)**. Cards render the document, including inline images. Empty cards show helper text. Clicking a card opens a split markdown / preview editor.

Strategy and How are the same file. Architecture keeps listing that same How document so Plan still has a door into it.

Existing `why.md` / `what.md` / `how.md` stay on disk. Purpose is the old Why; Vision & Desire is the old What; Strategy (How) is the old How. Beliefs & Premise is a new `premise.md`. Images live beside the doctrine files under `domains/<slug>/media/`.

### Success criteria

- Dream shows four **cards** per live domain, in order: Beliefs & Premise, Vision & Desire, Purpose, Strategy (How).
- Written cards render markdown, including inline images. Empty cards show that kind’s helper text.
- Architecture still lists Strategy (How) for the same `how.md` (list, not cards).
- New vaults and new domains write all four markdown files.
- Opening an older vault creates any missing kind file as an empty draft (so `premise.md` appears without failing the open).
- Editor is split: markdown left, live preview right. Helper text is coaching chrome under the heading, never written into the file.
- Paste or drop an image copies it into `domains/<slug>/media/` and inserts `![](media/…)` at the cursor.
- Empty How no longer pre-fills the Strategy / Tactics / Habits template.
- `get_doctrine` includes `premise` next to why / what / how.
- `npm test` in `packages/vault-core` and `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Count | **Four** doctrine files per domain. |
| 2 | Labels | **Beliefs & Premise**, **Vision & Desire**, **Purpose**, **Strategy (How)**. |
| 3 | On-disk kinds | Keep `why.md`, `what.md`, `how.md`. Add `premise.md`. No file renames. |
| 4 | Mapping | `premise` = Beliefs & Premise (new). `what` = Vision & Desire (was What). `why` = Purpose (was Why). `how` = Strategy (How) (was How). |
| 5 | Strategy vs How | **One document.** Kind remains `"how"`. Label is **Strategy (How)**. |
| 6 | Dream | Four **preview cards** per domain, order: premise, what, why, how. |
| 7 | Architecture | Still **lists** How only. Same `how.md`. Not cards. |
| 8 | Dream How route | `/dream/:slug/how`. Back → `/dream`. |
| 9 | Architecture How route | `/track/:slug/how`. Back → `/track`. |
| 10 | Home / Act How links | Still `/track/:slug/how` (Architecture). Premise / Vision / Purpose → `/dream/:slug/{kind}`. |
| 11 | Helper text | Editor: coaching chrome under the heading, always visible, never saved. Empty Dream cards show the same paragraph. Written cards do not. |
| 12 | How template | **Removed.** Empty How is an empty textarea, same as the other three. |
| 13 | Default titles | New files use the labels in (2) as frontmatter `title`. Existing files keep their stored title. |
| 14 | Missing files | On domain load, create any missing `DOCUMENT_KINDS` file as an empty draft with the default title. Do not fail the vault open. |
| 15 | Schema | **No bump.** `schemaVersion` stays `1`. |
| 16 | Unlock / dispatch | Unchanged. Rooms stay unlocked. Agent dispatch still requires a non-empty How body. |
| 17 | Decisions | Unchanged flow. `documentKind` may be `"premise"`. |
| 18 | Companion | Must not rewrite Premise, Vision, Purpose, or Strategy (How); `get_doctrine` is still the read path. |
| 19 | Shared labels | UI that names a doctrine kind (indexes, editor, Home, Act, Life Map strip, companion) uses `DOCUMENT_KIND_LABELS`. Chart’s What strip is **Vision & Desire**, not “North Star”. |
| 20 | Archive | `archive/web-skeleton` is **not** updated. |
| 21 | Card click | Opens the existing editor route. Cards are not inline editors. |
| 22 | Card body | Rendered markdown + images when the body is non-empty. Whitespace-only counts as empty. |
| 23 | Card layout | Four equal columns when space allows. Wrap to two, then one. Card body has a max height and scrolls. |
| 24 | Images in | **Paste or drop** onto the editor. Copy into `domains/<slug>/media/<id>.<ext>`. Insert `![](media/<id>.<ext>)` at the cursor. |
| 25 | Image formats | PNG, JPEG, GIF, WebP. Reject other types. Max **8 MB** per file. |
| 26 | Image paths | Relative `media/…` under that domain only. No `..`, no absolute paths, no remote `http(s)` fetch. |
| 27 | Editor chrome | **Split:** markdown left, live preview right (images included). Same Save / Refine / Forge. |
| 28 | Forged | Read-only. Paste/drop disabled. Changes still go through Decisions. |
| 29 | Orphan media | Leaving unused files in `media/` is fine. No garbage collection in this spec. |

### Helper text (verbatim)

**Beliefs & Premise**

> Your Premise refers to the foundational beliefs you hold about this category. What do you believe? What deeply held beliefs are shaping your life? Are your beliefs empowering? Do they move you at a deep level or are they holding you back? What is your Premise for this area of your life, or what would you like it to be?

**Vision & Desire**

> Your Vision refers to the ideal state you would like to achieve in this important category. Ask yourself: How do you want this area of your life to feel? What do you want it to look like? What do you want to be doing on a consistent basis? Clearly describe your ideal Vision.

**Purpose**

> Your Purpose refers to the compelling reasons behind what you want in this category. What energizes you? What empowers you to take action? What motivates you to achieve your Vision? Describe WHY you want to make the most out of this area of your life.

**Strategy (How)**

> Your Strategy refers to the specific actions that will get you from where you are now to where you want to be. How will you bring your vision into reality? Ask yourself what kind of positive habits, attitudes and action steps you can implement. What’s the RECIPE for the Vision you want to create?

### Explicitly out of scope

- Renaming `why.md` / `what.md` / `how.md` on disk
- A fifth How document, or removing How from Architecture
- Cards on Architecture (it stays a list)
- Inline editing on the Dream cards
- Changing room-unlock math or per-row lock UI
- Forge / Decisions behavior beyond accepting `premise` as a kind
- Updating `archive/web-skeleton`
- Persisting helper text into markdown files
- Fetching remote images
- Deleting unused files in `media/`
- A WYSIWYG / contenteditable editor

---

## 3. Architecture

Chosen: **add `premise` to `DOCUMENT_KINDS`, relabel in the UI, keep How on both Dream and Architecture, show Dream as preview cards, store pasted images in the domain folder.** Rejected renaming files, dropping How from Architecture, compact title-only cards, write-on-card editors, and Write/Preview tabs.

```
Dream (Vision)                              Architecture (Plan)
┌────────┬────────┬────────┬────────┐       ┌─────────────────────────┐
│Premise │ Vision │Purpose │Strategy│       │ Strategy (How)   draft  │──┐
│ (card) │ (card) │ (card) │ (card) │───────┤                         │  │
└────────┴────────┴────────┴────────┘       └─────────────────────────┘  │
        same domains/<slug>/{premise,what,why,how}.md                    │
        images: domains/<slug>/media/<id>.<ext>                          │
                                                                         │
                              both How doors edit how.md ────────────────┘
```

### 3.1 Kinds and labels (vault-core)

In `packages/vault-core/src/types.ts` (exported from `pure.ts`):

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

`DOCUMENT_KINDS` order is load/create order (append `premise` so existing why/what/how tests stay close). `DREAM_DOCUMENT_KINDS` is display order on Dream.

Replace duplicated `KIND_TITLES` in `create-vault.ts`, `domains.ts`, and `domain-documents.ts` with `DOCUMENT_KIND_LABELS`. Desktop `KIND_LABELS` maps import the same constant so file titles and UI labels cannot drift.

### 3.2 Ensure missing files

`open-vault.ts` and `domains.ts` both load doctrine files today. Extract one helper used by both:

```ts
async function readOrCreateDoctrineFile(
  filePath: string,
  kind: DocumentKind,
): Promise<DoctrineDocument>
```

If the file exists, parse it as today. If `ENOENT`, write an empty draft (`title: DOCUMENT_KIND_LABELS[kind]`, `status: "draft"`, `forgedAt: null`, `updatedAt: now`, empty body) and return that document. Other I/O errors still fail the load.

`createVault` and `createDomain` already write every kind; they pick up `premise` by iterating `DOCUMENT_KINDS`. Do not pre-create `media/`; create it on first image write.

### 3.3 Dream cards and Architecture list

`DoctrineIndex` takes the kinds to list, where How should go, and layout:

```ts
howHref?: "dream" | "track"; // default "track"
layout?: "list" | "cards";   // default "list"
```

- Dream: `<DoctrineIndex kinds={[...DREAM_DOCUMENT_KINDS]} howHref="dream" layout="cards" />`
- Architecture: `<DoctrineIndex kinds={["how"]} />` (list + track)

Card hrefs match today’s row hrefs:

- `how` + `howHref === "dream"` → `/dream/${slug}/how`
- `how` + `howHref === "track"` → `/track/${slug}/how`
- any other kind → `/dream/${slug}/${kind}`

Each card: kind label, status badge, then either rendered markdown (images included) or the helper paragraph when `bodyMarkdown.trim()` is empty. The whole card is the link. Card body max-height ~12rem, overflow auto.

CSS: `.doctrine-index__cards` is `grid-template-columns: repeat(4, 1fr)` with wrap at two mid-width breakpoints (two columns, then one). Architecture keeps the existing stacked list styles.

`App.tsx` already mounts `/dream/:slug/:kind` and `/track/:slug/:kind` on `DoctrineEditorPage`. `premise` becomes a valid kind via `DOCUMENT_KINDS`. No new routes.

Home `DOCTRINE_ROWS` / `doctrineHref`: four rows using `DOCUMENT_KIND_LABELS`; How still `/track/${slug}/how`.

Act `BRIEF_KINDS`: four entries with the new labels. How’s room label stays Track / Architecture; the other three stay Dream.

### 3.4 Split editor

`DocumentEditor` heading uses `DOCUMENT_KIND_LABELS[kind]`. Coaching copy is a `Record<DocumentKind, string>` with the four paragraphs in §2.

Layout: two columns. Left is the markdown textarea (unchanged save/dirty rules). Right is a live preview of `draft` using the same markdown renderer as Dream cards. Forged: both panes read-only; paste/drop no-ops.

Delete `HOW_PLACEHOLDER` and the empty-How template branch (`initialEditorBody` special case, “Template is local only until you Save.”). Empty body is empty for every kind.

`DoctrineEditorPage` breadcrumb uses `DOCUMENT_KIND_LABELS[kind]`, not the raw kind id (`Purpose`, not `why`).

`DoctrineStrip` (Life Map) uses the same labels and still links What → `/dream/${slug}/what`, How → `/track/${slug}/how`. Empty preview is `No ${label} yet.` Strip stays a text snippet, not a full card.

### 3.5 Inline images

Vault paths: `vaultPaths.domainMediaDir(slug)` → `domains/<slug>/media`, `domainMediaFile(slug, name)` → `domains/<slug>/media/<name>`. `safeJoin` still rejects traversal.

Write (main, via IPC `documentMediaSave`):

```ts
documentMediaSave(slug: string, input: { bytes: Uint8Array; mime: string }):
  Result<{ relPath: string }>
```

- Allowed MIME: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- Max 8 × 1024 × 1024 bytes.
- Filename: `{id}.{ext}` where `id` is a UUID and `ext` is `png` / `jpg` / `gif` / `webp`.
- Creates `media/` if missing. Returns `relPath` like `media/a1b2….png`.
- Does not mutate the markdown file; the renderer inserts the tag.

Read (main, via IPC `documentMediaRead`):

```ts
documentMediaRead(slug: string, relPath: string): Result<{ bytes: Uint8Array; mime: string }>
```

- `relPath` must match `^media/[A-Za-z0-9._-]+$` (single segment after `media/`).
- File must exist under that domain’s media dir. Else `Not found`.

Renderer paste/drop on the markdown textarea (not forged):

1. Accept `image/*` from `clipboardData` / `dataTransfer`.
2. Call `documentMediaSave`.
3. Insert `![](${relPath})` at the caret, with surrounding newlines if the caret is mid-line.
4. Mark dirty. Preview resolves `media/…` through `documentMediaRead` (blob URLs, revoked on unmount / body change).

Markdown renderer: a small safe helper in the desktop app (no new heavy dependency). Escape HTML; support headings, lists, paragraphs, bold/italic, inline code, and images whose `src` is a `media/…` relative path. Ignore `javascript:`, `file:`, and `http(s)` image srcs. Links stay http(s) only if present.

Broken image: alt text / a muted “image missing” placeholder, not a crash.

### 3.6 MCP / companion

`get_doctrine` payloads add `premise: domain.documents.premise` beside `why` / `what` / `how`. Tool description: “Read Premise / Vision / Purpose / Strategy (How) for a domain”. Bodies may contain `![](media/…)` tags; the companion still must not rewrite doctrine.

Companion soul and the planner `SYSTEM` string: talk about Premise, Vision, Purpose, and Strategy (How); still “do not rewrite” them; still `get_doctrine` to read.

Vault-service doctrine mtime watch already loops `DOCUMENT_KINDS`, so `premise.md` is watched once the kind exists. Media files do not need their own watch; they appear after save via the markdown body.

### 3.7 Data flow

```
createVault / createDomain
  → write why.md, what.md, how.md, premise.md (empty drafts)

openVault / loadDomainRecord
  → for each DOCUMENT_KINDS: readOrCreateDoctrineFile
  → DomainRecord.documents: Record<DocumentKind, DoctrineDocument>

Dream index
  → DREAM_DOCUMENT_KINDS, layout=cards, howHref=dream
  → empty body → helper text; else MarkdownView (images via documentMediaRead)

Architecture index
  → ["how"], layout=list, howHref=track

DocumentEditor
  → split markdown | MarkdownView(draft)
  → paste/drop → documentMediaSave → insert ![](media/…)
  → documentGet / documentSave / setDocumentStatus (kind includes "premise")
```

Error handling: invalid kind still `Invalid document kind`. Missing doctrine file on save/status still `Document not found`. Missing doctrine file on **load** is created, not an error. Rejected image (type/size) surfaces as an action error, no file written. Missing media on read → placeholder in the preview/card. Forged-in-place still goes through Decisions.

---

## 4. Testing

Vault-core:

- `createVault` / `createDomain` seed four markdown files; `documents.premise` exists; default titles match `DOCUMENT_KIND_LABELS`.
- `openVault` on a three-file domain writes `premise.md` and returns it as an empty draft.
- `DOCUMENT_KINDS` is `["why", "what", "how", "premise"]`.
- Existing why/what/how get/save/status tests keep passing (kind strings unchanged).
- Media save writes under `domains/<slug>/media/` and returns `media/<id>.<ext>`.
- Media save rejects oversize, unknown MIME, and path traversal on read.

Desktop (source scans / unit, same style as `domain-lens-shell.test.ts` / `wing.test.ts`):

- Dream index kinds are premise, what, why, how with `howHref="dream"` and `layout="cards"`.
- Architecture index kinds are `["how"]` and list layout.
- Editor coaching strings match the four paragraphs; `HOW_PLACEHOLDER` is gone.
- Editor is a split (markdown + preview).
- Home How link still `/track/.../how`; premise/what/why go to `/dream/...`.
- `get_doctrine` return shape includes `premise`.
- Companion soul mentions the four labels and still forbids rewriting them.
- Markdown helper renders `![](media/x.png)` and does not render `http` / `javascript:` image srcs.

`npm test` in `packages/vault-core` and `apps/desktop` must pass. No new Electron E2E.

Manual check: open an existing vault, confirm `premise.md` appears, Dream shows four cards, an empty card shows helper text, Architecture still lists Strategy (How), both How links edit the same file, paste an image into Premise, see it in the preview and on the Dream card after Save, helper text is not in the saved markdown.

---

## 5. Files to touch

| File | Change |
|------|--------|
| `packages/vault-core/src/types.ts` | Add `premise`; `DOCUMENT_KIND_LABELS`; `DREAM_DOCUMENT_KINDS` |
| `packages/vault-core/src/paths.ts` | `domainMediaDir`, `domainMediaFile` |
| `packages/vault-core/src/create-vault.ts` | Use `DOCUMENT_KIND_LABELS`; iterate new kinds |
| `packages/vault-core/src/domains.ts` | `readOrCreateDoctrineFile`; labels |
| `packages/vault-core/src/domain-documents.ts` | Labels; `premise` valid; media save/read |
| `packages/vault-core/src/open-vault.ts` | Same ensure-on-load helper |
| `packages/vault-core/src/pure.ts` | Export new constants if not already via types |
| `packages/vault-core/tests/create-vault.test.ts` | Four files; premise present |
| `packages/vault-core/tests/domains.test.ts` | Four files on create; open fills premise |
| `packages/vault-core/tests/domain-documents.test.ts` | Premise get/save; media save/read/reject |
| `apps/desktop/electron/vault-service.ts` / `preload.ts` / `vite-env.d.ts` | `documentMediaSave` / `documentMediaRead` IPC |
| `apps/desktop/src/pages/DreamPage.tsx` | Cards layout, `DREAM_DOCUMENT_KINDS`, `howHref="dream"` |
| `apps/desktop/src/pages/ArchitecturePage.tsx` | Unchanged kinds; label comes from shared map |
| `apps/desktop/src/components/doctrine/DoctrineIndex.tsx` | Shared labels; `howHref`; `layout="cards"` |
| `apps/desktop/src/components/documents/DocumentEditor.tsx` | Labels, coaching, drop How template, split, paste/drop |
| `apps/desktop/src/components/documents/MarkdownView.tsx` | **Create** — safe markdown + media images |
| `apps/desktop/src/pages/HomePage.tsx` | Four rows; How → track |
| `apps/desktop/src/pages/ActPage.tsx` | Four brief kinds |
| `apps/desktop/electron/map-tools.ts` | `premise` on `get_doctrine`; SYSTEM copy |
| `apps/desktop/electron/companion-profile.ts` | Soul copy |
| `apps/desktop/src/components/doctrine/DoctrineEditorPage.tsx` | Valid kinds via `DOCUMENT_KINDS`; breadcrumb label |
| `apps/desktop/src/components/doctrine/DoctrineStrip.tsx` | Shared labels (Vision & Desire, Strategy (How)) |
| `apps/desktop/src/styles/global.css` | Card grid, split editor, markdown/image styles |
| `apps/desktop/tests/*` | Index order, coaching, get_doctrine, soul, markdown helper |
| `PRODUCT.md` | Doctrine line: four docs, Strategy (How) |

---

## 6. Follow-ons (not this spec)

- Renaming on-disk files to `premise.md` / `vision.md` / `purpose.md` / `strategy.md`.
- Dropping the Architecture How index if Dream becomes the only door.
- Per-row lock UI (Premise first, then Vision, then Purpose, then Strategy).
- Garbage-collecting unused `media/` files.
- Remote images or a WYSIWYG editor.
