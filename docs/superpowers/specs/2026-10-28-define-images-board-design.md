# Define → Images: a vault picture library and a Notion-shaped vision document

**Status:** implementation contract, 2026-10-28
**Branch:** `feat/define-images-board`

## Why

The Define wing holds the life the operator is reaching for — Dream, Vision, Ideal
State — and all of it is words. Doctrine documents accept pictures today, but only
by pasting one into a markdown box, and there is nowhere in the vault that holds
the pictures themselves: no library to look through, caption, or reuse.

The operator asked for two things that are one surface:

1. a picture library under **Define**, where pictures are uploaded into the vault
   and kept as files;
2. a document beside it where the vision is written Notion-style — text blocks,
   headings, lists and pictures — rather than as one long markdown box.

This page is that surface: one new Define row, **Images**, with the library on the
left and the vision document on the right.

## Data model — files for pictures, JSON for the index and the document

`images/` at the vault root, beside `notes/`, `projects/` and `domains/`:

| Path | What it is |
| --- | --- |
| `images/files/<uuid>.<ext>` | the original bytes the operator uploaded |
| `images/library.json` | the index: id, display name, caption, mime, bytes, canvas, createdAt |
| `images/board.json` | the vision document: ordered typed blocks, `updatedAt` |

The picture bytes are the source of truth; the index is a cache in JSON so the
vault stays readable and agent-readable without the app. An index row whose file
has gone is drawn as missing rather than silently dropped, so the operator can
see what happened.

`VaultImage` = `{ id, relPath, name, caption, mime, bytes, width, height, createdAt }`.
`relPath` is always `images/files/<id>.<ext>`; the renderer never names a path.

`VisionBoard` = `{ blocks, updatedAt }`, and a block is one of:

| Kind | Shape | Notes |
| --- | --- | --- |
| `text` | `{ id, kind, text }` | prose; Enter splits at the caret |
| `heading` | `{ id, kind, text }` | one line, larger type |
| `bullets` | `{ id, kind, items: string[] }` | Enter adds the next line |
| `image` | `{ id, kind, imageId, caption }` | draws from the library by id |

The small set is deliberate: it is what the operator asked for, and it keeps the
document a document rather than a rich-text engine.

## Security and limits

Pictures are attacker-influenced bytes: the page picks them from the filesystem,
and both file name and declared mime are operator strings.

- The kind is **sniffed from the leading bytes** (PNG, JPEG, GIF, WebP). SVG and
  anything else is refused before it becomes an `<img>`; the declared mime and
  the extension never decide.
- 8 MB per picture (`IMAGE_MAX_BYTES`).
- The display name is reduced to one label — last path segment, control characters
  stripped, 200 characters — and is never used as a path. The stored name is the
  vault's own `<uuid>.<ext>`.
- Every read and write goes through `assertPhysicalContainment` (a vault folder
  can arrive through sync/git with a symlink inside it) and reads also check the
  leaf is not a symlink.
- The renderer gets pictures back as bytes over the bridge and draws them from
  `blob:` URLs; the CSP already allows `blob:` and the filesystem is never
  exposed to the page.
- Blocks are validated on write: ≤ 1000 blocks, unique safe ids, known kinds,
  bounded text/heading/bullet/caption lengths, ≤ 2 MB serialized.
- Library mutations (upload, caption, delete) are serialized in-process so a
  concurrent upload and caption edit cannot drop each other.

## IPC

| Channel | Wrapper | Answer |
| --- | --- | --- |
| `images:list` | `imagesList()` | `VaultImage[]` |
| `images:save` | `imagesSave({bytes, mime, name, width?, height?})` | `VaultImage` |
| `images:read` | `imagesRead(relPath)` | `{ bytes, mime }` |
| `images:update` | `imagesUpdate(id, {name?, caption?})` | `VaultImage` |
| `images:delete` | `imagesDelete(id)` | `{ id }` |
| `images:boardGet` | `imagesBoardGet()` | `VisionBoard` |
| `images:boardSave` | `imagesBoardSave({blocks})` | `VisionBoard` |

A missing library or document reads as empty, not as an error. A corrupt one is
an error the page can report.

## UI

- **Nav:** a new row under Define after Ideal State — *Images*, `Image` icon,
  route `/images`, `wingForPath("/images") = "define"`.
- **One sheet, two surfaces** (`ImagesPage`): library on the leading edge,
  document on the right; stacked below 760 px of container width.
- **Library:** Upload (multi-file picker) plus drop anywhere on the page; a grid
  of picture cards with inline caption (debounced write), file name and size,
  *Add to document* (the preview click is the same verb), and *Remove* (asks
  first, in the app's own dialog).
- **Document:** the block stack. Add controls for Text, Heading, Bullets and
  Picture; Enter in text splits at the caret, Enter in a bullet adds a line,
  Backspace at the start of an empty block removes it, blocks move up/down and
  are removed with their own controls. A picture picker lists the library.
  Dropping or pasting a picture into the document uploads it and inserts the
  image block. Autosave is 700 ms after the last change; Ctrl/Cmd+S is the same
  write; the status pill says Saving… / Saved / Not saved, and a refusal names
  the vault's reason and stays put until it is retried.
- **Removing a picture does not rewrite the document.** The image block keeps
  its place and draws "This picture is no longer in the library.", so the
  sentence around it survives and the operator can replace the picture.

## Testing

- `apps/desktop/tests/images-board-e2e.test.ts` — the storage half against a real
  vault: layout, sniffing and refusals, captions, delete, block round trip,
  refusal leaving the old document intact, path-shaped ids, corrupt index.
- `apps/desktop/tests/images-board-ui-e2e.test.ts` — runs
  `e2e/images-board.electron.mjs`, which mounts the real shell and page with a
  recording IPC stub and drives drop-upload, insert, type/split, heading/bullets,
  reorder, Backspace, picker, caption, remove-with-confirm, refused autosave and
  Ctrl+S recovery, and the narrow layout. Artifacts: `e2e/artifacts/images-board.json`
  and four captures.

## Revision 2026-10-30 — the board moved to the Vision page

The first cut put the library and the board on one sheet at `/images`. The
operator reviewed it: the library belongs on Images, but the board is a vision
document and must sit under **Vision** in the Define wing. This revision moves
it.

- `ImagesPage` is now the library only: upload, drop, caption, remove, and a
  link to Vision. No board, no two-column layout.
- `VisionPage` keeps its doctrine card(s) and carries the board below them,
  through a self-contained `VisionBoardPanel` that owns the library read, the
  autosave, the picture picker/drop/paste uploads and the errors.
- Data is unchanged: the same `images/library.json` and `images/board.json`, the
  same IPC and the same block kinds. Nothing migrates.
- The rig now drives both pages in one run: the library on Images, navigation to
  Vision, the board written there, and a picture deleted on Images left drawing
  as missing on the board.

## Out of scope

Companion/MCP tools for the library and the document (a later pass), galleries on
other pages, thumbnails or re-encoding, HEIC/SVG, drag-reorder with a pointer,
and converting the existing doctrine/Ideal State editors to blocks. Define's
Dream, Vision and Ideal State surfaces are untouched.
