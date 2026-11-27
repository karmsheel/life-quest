# Documents

Documents is the vault's library: free-form markdown notes, each tagged with zero
or more areas, created and edited on one page. A note is a plain `.md` file under
`documents/`, so it is yours in any editor; the app adds a lock and a
propose-change path so a note you have finished can be defended from quiet
rewrites — by you or by the companion.

## Where it lives

**Home** wing → **Documents** (route `/documents`). The page is a file tree on
the left and one editor on the right.

- The tree groups **Notes**, **Ideal State**, **Projects**, and **Doctrine**.
  Doctrine is nested by area, and each file keeps the kind name (Beliefs &
  Premise, Vision & Desire, Purpose, Strategy (How)).
- The **area lens** filters notes, projects, and doctrine. Ideal State stays on
  every lens. A note with no tags appears only on **Life**.
- **+** creates a library note titled **Untitled**. Ideal State, projects, and
  doctrine appear here when they are created on their own pages. Opening one
  edits that same file.
- There is no per-note route. Daily Journal and review periods are not in the tree.
- When a note or a doctrine file is open, its actions live in one three-dot menu
  at the page's top right, with the lock badge beside it. A note's menu is
  labelled **Note actions**.

Back to [Wiki home](./index.md).

## What it is for

Most of the vault's writing has a prescribed home — doctrine, reviews, projects,
the Daily Journal. The library is for everything else: a reference note, a
decision write-up, a plan you are thinking through, something you want beside an
area but not inside one. Tagging a note with areas is what makes the area lens
useful; leaving it unassigned keeps it in **Life**, which is the right place for
vault-wide material.

## How to use it

### Create a note

1. Open **Documents**. The tree is on the left. **Filter** narrows it by title.
2. Choose **+**. A note titled **Untitled** opens in the editor, tagged with the
   area lens when one is on.
3. Edit the title and the body in the one editor. The markdown renders as you
   leave a paragraph. There is no second preview and no **Save** button: the
   file writes itself shortly after you stop typing. An empty title is not written.
4. Tick **Areas** under the title, or tick none to keep the note in **Life**
   only. If no area is unlocked the picker says **No live areas. Leave unassigned
   to keep this note in Life**.
5. Click any other file in the tree to open it in the same editor.

Empty states: **No notes yet. Create one with +.**, **No notes in this area.
Unassigned notes stay in Life.**, and `<N> note file(s) could not be read.` for
files the reader had to skip.

### Render markdown and link notes

The preview and the note body use one constrained markdown renderer:

| You write | You get |
|---|---|
| `# Heading` … `###### Heading` | Headings |
| `- item` / `1. item` | Bullet and numbered lists |
| `**bold**`, `*italic*`, `~~strike~~` | Inline emphasis |
| `` `code` `` and fenced code blocks | Code |
| `\| a \| b \|` pipe rows | Tables |
| `[text](https://…)` | An external link, opened in a new window |
| `![alt](media/<name>)` | A vault image, in surfaces that resolve media |
| `[[target]]` | A wiki link |

A wiki link resolves two ways:

- `[[<area>/<kind>]]` or `[[<Area name>/<Doctrine label>]]` — a doctrine
  document. `kind` is `premise`, `what`, `why` or `how`, and the label form accepts
  **Beliefs & Premise**, **Vision & Desire**, **Purpose** and **Strategy (How)**.
  Clicking it opens that file in this page's editor.
- `[[<note title>]]` — a library note, matched case-insensitively against the
  titles. It resolves only when exactly one note has that title; clicking it opens
  that note in the editor.

A doctrine link resolves only for an unlocked, unarchived area. A `[[target]]`
that resolves to nothing stays literal text. External links in the preview are
contained: they open in a new window, and the current window never navigates to a
foreign page.

### Lock a note

1. Open a note. The lock badge beside its name shows the state, and the three-dot
   **Note actions** menu leads with **Lock** — a switch whose label is **Lock
   this note** / **Unlock this note**.
2. Turn the switch on. Locking is the operator's mark that the note is finished;
   the badge turns amber and the editor becomes read-only. Edits already typed
   are written first.
3. A locked note is read-only in place: the title and body are not editable and
   the areas are disabled. The editor says **Unlock to edit, or propose a change.**
4. Turn the switch back off to edit in place again, or choose **Propose change**
   from the same menu to send a proposed revision to
   [Decisions](./23-decisions.md) while the note stays locked.

### Propose a change

1. Open a locked note and open its **Note actions** menu. **Propose change**
   appears only while the note is locked.
2. The dialog **Propose change** pre-fills the note's title and body. A **Title**
   field, an optional **Rationale (optional)**, and a **Proposed body** are what
   you send.
3. Choose **Submit proposal**. A Decision is filed; the note does not change
   until it is approved. The dialog says it: **This proposal goes to Decisions.
   The document stays locked.**
4. Approve the Decision in **Decisions** to write the proposed title and body
   into the note. The note's lock state is unchanged by an approval.

### Delete a note

**Delete note** is the last item in the note's menu, drawn in the destructive ink.
It asks first: **Delete note** — *The note is hidden from the library. Its file
stays in the vault.* Confirming hides the note from the list; the markdown file
is not erased.

## The screen

| Part | What it does |
|---|---|
| Header | Title **Documents**, one line: *Notes, Ideal State, projects, and doctrine. One file, edited here.* |
| Tree | **Filter**, **+** for a new library note, then Notes, Ideal State, Projects, and Doctrine. |
| Editor | The open file's title and body. The body renders as you leave a paragraph. Edits save themselves. Read-only while locked. |
| **Areas** | On a library note: checkboxes for each unlocked area; none means Life-only. Disabled while locked. |
| **Note actions** | Three-dot menu at the top right while a note is open: the **Lock** switch first, then **Propose change** while locked, then **Delete note**. Doctrine uses **Document actions** and has no delete. |

## Rules and behaviour

A note is a markdown file. `documents/<id>.md`, where `<id>` is generated and
stays the filename for the life of the note — renaming a note changes its title,
never its path. Frontmatter carries `title`, `domains` (a JSON array of area
slugs), `createdAt`, `updatedAt`, `deletedAt` and `locked`. A note is hidden when
`deletedAt` is set; the file stays. `documents/` sits at the vault root, not under
an area.

Areas are tags, not a folder. A note may carry several area slugs or none. The
area lens is a filter over the tags: **Life** shows everything, an area lens
shows the notes that name it. A note with an empty tag list appears only on
**Life**. Area tags must name an existing area; an unknown tag is refused by the
engine with `Unknown domain: <slug>`, not silently stored.

Lock is operator-only. The engine refuses a lock or unlock from an agent with
**Only the user may lock or unlock library notes.** Locking is not a Decision for
the operator — it applies at once. Unlocking does not apply, dismiss or change a
pending proposal.

The law behind the lock. The doctrine law applies to library notes too: locked
documents must not be edited in place, agents must not lock or unlock, and an
agent change to a locked document must appear as a pending Decision. A library
note's areas are part of the note the operator reads, so they follow the same
rule. The full statement is in [LAWS/DOCTRINE.md](../../LAWS/DOCTRINE.md).

The three-dot menu is the studio's one page-action pattern. Its first item is
always the page's **Lock** switch, and the rest are that page's acts — here
**Propose change** and **Delete note** — so a lockable surface never spreads its
settings and its actions across two corners. The same menu sits on the Dashboard
board (**Dashboard actions**) and on a doctrine document (**Document actions**);
a [Pages](./21-pages.md) canvas has no menu, because a page has no lock.

What the companion can do.

| Tool | Behaviour |
|---|---|
| `list_documents` | Reads every library note plus one record per doctrine document per unlocked area. No approval. |
| `get_document` | Reads a library note by id, or a doctrine document by `domainSlug` + `kind`. |
| `create_library_document` | An agent's create files a pending **Library note** Decision; the file appears when the operator approves it. The proposal carries the note's `domainSlugs`. |
| `update_document` | An agent's change to a library note files a **Library note** Decision with the proposed title, body and areas. `domainSlugs` is the note's area list: omit it and the tags stand, send `[]` to propose untagging, send a list to re-tag. On a doctrine document an agent always proposes, locked or not; `domainSlugs` is refused there with "domainSlugs only applies to a library note; a doctrine document's area comes from domainSlug". |

So a companion write to any document waits in [Decisions](./23-decisions.md); the
operator's own edit to an unlocked note is direct. Reads need no approval. Every
create, update and lock change appends a life-log entry naming the actor.

**A proposed area change has its own row on the card.** When an agent's
`update_document` changes a library note's tags, the Decision card shows a
**Domains** row (the card's label is still spelled that way) naming the note's
areas before and after — for example "Health" → "Health, Mind". Approving it
writes the new area list into the note's frontmatter; unlocking the note does not
settle it, and an approval does not unlock the note.

Media. This page has no image insert control. A doctrine file opened here uses
that area's media, the same way its own page does. A library note stores an
`![alt](media/<name>)` reference as written. Receipt photos are a Finance-kit
feature, not a library-note feature — see [Finance kit](./20-finance-kit.md).

External links are contained. A markdown link to an `https://` page opens in a
new window, and the main process decides whether that window opens. Any other
non-hash link in the preview is a dead click rather than a navigation of the
window that carries the app bridge.

## Tips and edge cases

- Edits save themselves about a second after you stop typing, including when you
  open another file or leave the page. An empty title is not written.
- Locking writes the edits already typed, then the editor becomes read-only.
- A **Title** is required. **+** starts from **Untitled**, and the engine refuses
  an empty title.
- Renaming a note does not break `[[old title]]` links in other notes: a link
  resolves only on an exact current title, so a rename turns older links into
  literal text.
- Two notes with the same title make `[[that title]]` ambiguous, and an ambiguous
  link stays literal text rather than guessing.
- **Delete note** is soft: the note leaves the list and the lens, and the file
  remains in the vault. There is no restore control in the studio; the file is
  still readable and can be edited by hand.
- A note tagged with an archived area keeps the tag. The note is visible on
  **Life**, and the picker shows the archived tag only while that note is open.
- A locked note can still be deleted; deletion is not an in-place edit.
- A proposal approved later still writes that proposal's body — the last
  approval wins. Unlocking does not settle a pending proposal.
- Projects and doctrine also open from their own pages. Documents edits the same
  files. Goals, tasks, the Daily Journal, and review periods stay on their own
  pages. If a note starts wanting structure, a database or a page is usually the
  better surface.

## Related

- [Doctrine](./07-doctrine.md) — the prescribed documents that share the same lock and proposal model
- [Decisions](./23-decisions.md) — where a companion or locked-note change waits
- [Data and databases](./19-data-and-databases.md) — when a note wants structured rows instead of prose
- [Pages](./21-pages.md) — the other freeform knowledge surface, built from blocks
- [The Vault](./04-the-vault.md) — where `documents/` sits in the folder layout
- [Companion](./24-companion.md) — the tools the companion reads and proposes with
