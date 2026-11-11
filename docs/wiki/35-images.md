# Images

Images is the vault's picture library: the photographs, reference shots and
mood-board pictures you want to keep, stored as real files in the vault with a
JSON index beside them. It is the place pictures live; the **vision board** on
the Vision page is the document that writes with them. The single idea: a picture
is a file in your vault, not an attachment inside a note, and the library can be
browsed and pruned without touching the document that cites it.

## Where it lives

- **Home** wing → **Images**, rail label **Images**, icon Image, route `/images`.
  It opens in the centre pane as a page, and the area lens does not filter it —
  the library belongs to the whole vault, not one area.
- **Define** wing → **Vision** (`/vision`) carries the **Vision board** below its
  doctrine cards. That is where pictures are composed into a vision document.
- The files live at the vault root: `images/files/`, `images/library.json` and
  `images/board.json`.

Back to [Wiki home](./index.md).

## What it is for

A vision is often a picture before it is a sentence, and doctrine documents only
accept pictures by pasting one into a markdown box. The library gives those
pictures a home: upload once, caption them, keep them across documents, and
delete the ones you no longer want. The Vision board is the one document that
reads the library; keeping the gallery and the document on separate pages means
you can prune pictures without scrolling past a vision, and write the vision
without the gallery taking half the screen.

## How to use it

### Upload pictures

1. Open **Images**. Choose **Upload pictures** in the **Library** header, or drop
   pictures anywhere on the page. The picker accepts several files at once, and
   the drop overlay says **Drop pictures to upload them** while a drag is over
   the page.
2. The vault sniffs each file's leading bytes and stores only PNG, JPEG, GIF or
   WebP, up to 8 MB. A refused file is named in the banner: **Images must be PNG,
   JPEG, GIF or WebP.** or **That image is larger than 8 MB.**
3. A successful upload adds the picture to the grid and reports it:
   `"<name>" added to the library.` for one, `N pictures added to the library.`
   for several. While the upload is running the button reads **Uploading…**.
4. The library header shows the count and, once there are pictures, the same
   number as `N pictures` / `1 picture`.

### Caption and remove pictures

1. Each card shows the picture, a caption field (placeholder **Add a caption**),
   the file's display name and size, and **Remove**.
2. Type a caption. It saves about a second after you stop typing, and when the
   field loses focus, so you do not have to press anything.
3. Choose **Remove** to take the bytes out of the vault. It asks first:
   **Remove this picture?** — `"<name>" will be removed from the vault. The vision
   board keeps its block, and the picture shows as missing there.` — with the
   confirm labelled **Remove picture**.
4. A removed picture leaves the library; a vision-board block that cites it stays
   where it was and draws **This picture is no longer in the library.**

### Write the vision board

1. Open **Vision** from the Define wing. Below the doctrine cards is the **Vision
   board** panel: *Write the vision as blocks. Pictures come from the Images
   library — add one with Picture, or drop one straight into the document.*
2. Use the **Add** toolbar at the foot of the document: **Text**, **Heading**,
   **Bullets** or **Picture**.
3. Type in a text block: **Enter** splits the block at the caret and starts the
   next one; **Backspace** at the start of an empty block removes it. In a
   **Bullets** block, **Enter** adds the next line. Each block has **Move block
   up**, **Move block down** and **Remove block** controls.
4. Choose **Picture** to open **Add a picture**, the library picker, and choose a
   picture; **Close** dismisses it. With no pictures yet it says **Upload a
   picture from the library first.**
5. Or drop or paste a picture straight into the document: it is uploaded to the
   library and inserted as an image block in one step. Each picture block has its
   own caption field.
6. The document autosaves about a second after the last change; Ctrl/Cmd+S saves
   now. The status beside the heading reads **Saved**, **Saving…** or **Not
   saved**, and a refusal names the vault's reason.
7. With no blocks the document says **The document is empty. Start with a text
   block, or add a picture.**

### Open the document from the library

The Images header carries one cross-link: **Open the Vision page**, so the
library and the document it feeds are one click apart in either direction.

## The screen

**Images** (`/images`)

| Part | What it does |
|---|---|
| Header | Eyebrow **Images**, title **Images**, the library's purpose, and **Open the Vision page**. |
| **Library** | Count, `N pictures` summary, and **Upload pictures**. |
| Library hint | *Drag pictures anywhere on this page, or use Upload. Caption them here; the Vision board reads this library.* |
| Grid | One card per picture: preview, caption field, name and size, **Remove**. |
| Empty / loading | **No pictures yet.** with the upload hint, or **Loading the library…** |
| Banners | Upload and removal notices, or the vault's refusal. |
| Drop overlay | **Drop pictures to upload them**. |

**Vision board** (on `/vision`)

| Part | What it does |
|---|---|
| Heading | **Vision board**, with **Saved** / **Saving…** / **Not saved**. |
| Blocks | Text, heading, bullets and picture blocks, each with move-up, move-down and remove controls. |
| Picture block | The picture, its caption field, and **This picture is no longer in the library.** when it is gone. |
| **Add** toolbar | **Text**, **Heading**, **Bullets**, **Picture**. |
| **Add a picture** | The library picker, with **Close**. |

## Rules and behaviour

Files are the pictures; JSON is the index and the document.

| Path | What it is |
|---|---|
| `images/files/<uuid>.<ext>` | The original bytes, kept exactly as uploaded |
| `images/library.json` | The index: id, display name, caption, mime, bytes, canvas, createdAt |
| `images/board.json` | The vision document: ordered typed blocks and its update time |

The index is a cache beside the source of truth: an index row whose file has
gone is still listed and drawn as missing rather than silently dropped, so you
can see what happened.

Format and size are decided by the bytes. The kind is sniffed from the
leading bytes (PNG, JPEG, GIF, WebP); the file name and the declared type never
decide. An SVG or anything else is refused before it can become an image. The
original may be up to 8 MB (`IMAGE_MAX_BYTES`). The display name is reduced to
one label — last path segment, control characters stripped, 200 characters — and
is never used as a path; the stored name is the vault's own `<uuid>.<ext>`.

Every read and write is guarded. Reads and writes go through the vault's
physical-containment check, and reads also refuse a symlinked leaf. The page never
receives a filesystem path: pictures come back as bytes over the bridge and are
drawn from `blob:` URLs, which keeps the CSP's `file:` door shut.

Library edits are serialized. Upload, caption and delete are read-modify-write
over one JSON file, so a concurrent upload and caption edit cannot drop each
other; the engine holds one chain per library.

The board is a document, not rich text. Its block kinds are `text`,
`heading`, `bullets` and `image`. Validation on write bounds it: at most 1,000
blocks, unique safe ids, known kinds, 20,000 characters of text, 500 for a
heading, 200 bullet lines of 2,000 characters, 2,000 for a caption, and 2 MB
serialized for the whole document. A block that names a picture no longer in the
library is kept — the operator may mean to replace it, and a document that
refused to save because one picture went away would be worse than a gap to fix.

Images is deliberately separate from the other ways pictures move through the app:

- Not Finance receipts. A receipt attached to a chat turn is stored by the
  Finance kit under `domains/financial/data/files/` and cited by the transaction's
  `source_file` cell. Receipts are evidence attached to a ledger row; Images is a
  library you browse.
- Not doctrine media. A picture pasted into a doctrine document is stored
  under that area's `domains/<slug>/media/` and referenced as `media/<name>` in
  the markdown. That path resolves inside the doctrine editor, not here.
- Not Quick Notes attachments. A picture logged with a Quick Notes capture is
  written under `.lifequest/signal-chain/files/` and belongs to that capture.
- Not the companion's. There is no MCP tool for the Images library or the
  vision board in this build: the companion can read and change documents, but
  it cannot upload, caption or remove a picture, and it cannot write the board.

## Tips and edge cases

- Images belongs to the vault, not an area. Switching the area lens changes
  nothing here, and moving a picture between areas is not a concept: it is one
  library, and a vision board that uses a picture can cite it whichever area's
  Vision page it is on.
- A deletion is permanent — the bytes are removed from `images/files/` — but a
  vision board that cited the picture still holds its block and its place, so the
  sentence around it survives. Replace it from the picker.
- A library row that has lost its file draws **Missing from the vault** on the
  card. You can still caption it or remove the row; the bytes are already gone.
- Captions save on their own. There is no Save button on Images, and typing a
  caption and immediately closing the app is the one way to lose the last edit.
- Uploading the same picture twice creates two rows. The library does not
  de-duplicate and does not re-encode; the two files are separate.
- The vision board is autosaved but has no draft state outside the vault. Ctrl/Cmd+S
  is the same write, and a refusal stays on screen until it is retried.
- Pasting a picture into a text block uploads and inserts it; it does not embed
  the bytes in the block. Every picture on the board is a library row, which is
  why removing it from Images marks the block missing.
- The board's files are unchanged from the first cut of the feature: same
  `images/board.json`, same block kinds. Nothing migrates when the board moves
  between pages.

## Related

- [Doctrine](./07-doctrine.md) — the Vision page the board sits under
- [The vault](./04-the-vault.md) — where `images/` sits in the folder layout
- [Pages](./21-pages.md) — the other block canvas, built from live queries
- [Quick Notes](./15-quick-notes.md) — picture captures, kept with the capture
- [Finance kit](./20-finance-kit.md) — receipt images, attached to ledger rows
- [Security](./29-security.md) — the containment and sniffing behind every read
