# Ideal State

Ideal State holds your own titled documents about the life you are reaching for. It is not doctrine: there is no fixed set of kinds, no per-domain file, no lock, and no Decision. It is a small library of freeform markdown documents, as many as you think of, each with a title you choose. The Vision & Desire doctrine document is the domain's formal vision; an Ideal State document is any future you want to write down in your own words.

Each document is a plain markdown file in the vault with the title in its frontmatter. There is no save control: the page writes shortly after you stop typing, when you leave the editor, when you switch documents, and on Ctrl/Cmd+S.

## Where it lives

- Define wing, rail label **Ideal State**, icon Compass, route `/ideal-state`.
- Page, not a sheet. The rail keeps it beside Dream and Vision because it is also about the future being aimed at.
- Files live at `notes/ideal-state/<id>.md`; the id is the file's name (minus `.md`) and the title is stored inside the file.

Return to [Wiki home](./index.md).

## What it is for

Write down the future you are aiming at without fitting it into a domain or a doctrine slot. A document can be a paragraph, a page of bullet points, a picture of a house, a letter from five years from now. You may keep several: one for work, one for health, one for a place you want to live. The page opens on the most recently written readable document and lists the rest in a strip under the editor, so starting a new one is a title away.

Ideal State is not the same as the **Vision & Desire** doctrine. Doctrine is one document per domain, owned by the domain and gated by a lock and Decisions. Ideal State documents are vault-wide, unlocked, and yours to rewrite. If a thought belongs to a domain's formal vision, write it on the [Vision](./07-doctrine.md) page instead.

## How to use it

1. Open **Ideal State** from the Define rail. If the vault has documents, the newest readable one opens. If it has none, the page opens an empty editor and puts the caret in the title.
2. Give the document a title in the field at the top. A new document does not exist in the vault until it has a title; the status line says **Give this document a title** until it does.
3. Write the body below the title. It is the same live-preview markdown box used across the studio: everything except the paragraph under the caret is rendered, and the paragraph under the caret is its own raw markdown.
4. Stop typing, or click outside the editor, and watch the status line. It reads **Saving…** while a write is in flight and **Saved** when the file holds the current text. Ctrl/Cmd+S writes immediately.
5. To start another document, click **+ New document** beside the **Documents** heading. The title field takes the caret; once you give it a title, the first write creates the file.
6. To open another document, click its row in the **Documents** strip. The strip shows **Title** and **Last edited**, newest first.
7. To rename a document, edit its title and let it save. Renaming writes the frontmatter title; it never moves or renames the file.
8. To delete a document, click its **Document actions** button (the three-dot button at the end of its row), choose **Delete**, and confirm **Delete document**. The markdown file is removed from the vault; there is no undo.

With no documents at all, the strip says **No documents yet. Write the first one in the editor.**

## The screen

| Part | What it does |
|---|---|
| **Ideal State** heading | The page name |
| Title input | The document's title, editable at any time; aria label **Document title** |
| Body box | The live-preview markdown editor for this document |
| Status line | **Saved**, **Saving…**, **New document**, **Give this document a title**, **Add a title to save**, or **Not saved** |
| **Documents** strip | The library: **+ New document**, column headings **Title** and **Last edited**, and one row per document |
| Row menu | The three-dot **Document actions** menu, whose only item is **Delete** |
| Error line | The vault's reason when a write is refused, above the workspace |

The editor and the strip are one workspace; there is no separate preview pane and no full-width mode to switch on.

**A document's states.**

| State | Status line | What is on disk |
|---|---|---|
| New, untitled | **Give this document a title** | Nothing yet |
| New, titled | **New document**, then **Saving…** and **Saved** | The file appears on the first write |
| Writing | **Saving…** | The previous successful text, then the new text |
| Settled | **Saved** | Exactly what the editor shows |
| Title cleared on an existing document | **Add a title to save** | The body saves under the old title |
| Refused | **Not saved** | The last text the vault accepted; the refusal is explained above |

## Rules and behaviour

**Files at a glance.**

| Fact | Value |
|---|---|
| Directory | `notes/ideal-state/` |
| File | `<id>.md`, where the id is generated and is not the title |
| Frontmatter | `title`, `createdAt`, `updatedAt` |
| Body | The markdown you wrote, normalised to `\n` line endings and one closing newline (an empty body stays empty) |
| Order in the strip | Newest `updatedAt` first, with the id as a stable tie-break |
| Missing directory | Treated as an empty page, not an error |

**Files and frontmatter.** A document is one markdown file at `notes/ideal-state/<id>.md`. The id is a generated name, never a path, and the file name does not follow the title, which is why renaming a document never moves it. The body below the frontmatter is the markdown you wrote. The vault normalises it: line endings become `\n`, trailing whitespace is trimmed, and a non-empty body ends with exactly one newline. Writes are atomic.

**Writing the body.** The body box is the studio's live markdown editor, so the file and the box agree by construction: the markdown is the source, and only the paragraph under the caret is shown as raw source while it is being edited. Enter ends the paragraph and opens a new one; Backspace at the very start of a paragraph joins it to the one above; a blank line is kept. Lists continue on Enter, and inside a fenced code block Enter is a newline. The formatting keys are Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+U, and Ctrl/Cmd+1 through Ctrl/Cmd+6 for headings, with Ctrl/Cmd+0 returning the line to prose. Image paste and drop are not wired on this page, so an image gesture does nothing here; these documents hold text and markdown links.

**Titles.** A title is required, must be one line, and may be at most 200 characters. The vault refuses a missing title with `A title is required`, a line break with `A title is one line`, and a long one with `A title is at most 200 characters`. A new document cannot be created without a title. An existing document whose title you clear still saves its body under the title the file already has; the status line reads **Add a title to save** until you type one.

**Bodies.** A body may be empty. A titled document with no words is a legitimate starting point, so the vault stores it. The page does not invent placeholder text in the file.

**Saving.** There is no Save button. A draft is written 700 milliseconds after the last keystroke, when focus leaves the editor area, when you switch to another document, when the page unmounts, and on Ctrl/Cmd+S. Writes are queued one at a time in order, so a fast typist's last words are the last thing written. If the vault refuses a draft, the status says **Not saved** and the error line explains why; the text stays on screen, but the page does not retry that same refused draft by itself.

**The status line is the contract.** **Saved** means the file holds what you see. **Saving…** means a write is in flight. **Not saved** means the vault refused and the file does not hold the newest draft. The page flushes a pending draft when it unmounts, though a window that closes immediately is the one exit the write is not gated on.

**No lock, no Decisions.** Ideal State documents have no `locked` flag. There is no Lock button, no lock badge, and no proposal path: an edit you make is written directly. The companion has no tool path to these files — it cannot create, open, or edit them through its tools — but the page you have open is still in its context by default, as every page is; that law is [LAWS/COMPANION.md](../../LAWS/COMPANION.md).

**A file that cannot be read stays visible.** If a file in the directory is malformed or unreadable, the strip lists it as `<id>.md` with **unreadable** and does not overwrite it. The other documents keep working.

**No automatic summarising or analysis.** Nothing in the page parses the body beyond markdown rendering; no recap, scoring, or review reads these files.

**Keyboard in the page.**

| Keys | What they do |
|---|---|
| Ctrl/Cmd+S | Write the current draft now |
| Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+U | Bold, italic, underline the selection (or insert the marks) |
| Ctrl/Cmd+1 through Ctrl/Cmd+6 | Make the caret's line a heading of that level |
| Ctrl/Cmd+0 | Return the caret's line to prose |
| Enter | End the paragraph and open the next; continue a list; newline inside a code fence |
| Backspace at the start of a paragraph | Join it to the paragraph above |
| Arrow Up / Arrow Down on a paragraph's edge | Move the writing line to the previous or next paragraph |
| Escape | Close the open row menu |

## Tips and edge cases

- **A title is enough to create.** For a new document, the first successful write happens as soon as a title and the queued body exist; you do not need to click anything.
- **Switching documents saves the last one.** The page flushes the open draft before it loads the next document, so you do not lose a paragraph by clicking a row.
- **The list is ordered by last write, not by creation.** The document you touched most recently leads the **Documents** strip.
- **Deleting the open document moves you.** If you delete the document in the editor, the page opens the next readable one, or a fresh empty editor if none are left.
- **There is no rename command.** The title field is the rename: change it and the frontmatter changes; the file keeps its id.
- **There is no lock and no approve step.** If you want a document that agents must propose changes to, that is doctrine or the Documents library, not Ideal State.
- **The full-width question.** This page has one layout; there is no editor/preview mode switch and no full-width toggle.
- **The strip is not a search.** With many documents, the list is ordered by last write; there is no title search or tag filter on this page.
- **A title can be changed without touching the body.** The title is frontmatter, so renaming is cheap and safe; the file id and history stay put.
- **An unreadable file is not deleted for you.** The row stays in the strip so you can inspect it outside the app; the page will not overwrite it.
- **The page is local only.** There is no cloud copy and no export control; the files are in the vault and move with it.

## Related

- [Wiki home](./index.md)
- [Doctrine](./07-doctrine.md)
- [The vault](./04-the-vault.md)
- [Documents](./22-documents.md)
- [The companion](./24-companion.md)
