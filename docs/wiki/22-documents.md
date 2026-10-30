# Documents

Documents is the vault's library: free-form markdown notes, each tagged with zero
or more domains, created and edited on one page. A note is a plain `.md` file
under `documents/`, so it is yours in any editor; the app adds a lock and a
propose-change path so a note you have finished can be defended from quiet
rewrites — by you or by the companion.

## Where it lives

**Home** wing → **Documents** (route `/documents`). It opens in the centre pane
as a page with the composer at the top and the library below it.

- The top-bar lens filters the list: **Overview** shows every note; a domain lens
  shows the notes tagged with that domain. A note with no tags appears only on
  **Overview**.
- There is no per-note route. Clicking a note opens it in the composer on the
  same page.

Back to [Wiki home](./index.md).

## What it is for

Most of the vault's writing has a prescribed home — doctrine, reviews, projects,
daily notes. The library is for everything else: a reference note, a decision
write-up, a plan you are thinking through, something you want beside a domain but
not inside one. Tagging a note with domains is what makes the domain lens useful;
leaving it unassigned keeps it in Overview, which is the right place for
vault-wide material.

## How to use it

### Create a note

1. Open **Documents**. The top panel is the composer: **Title**, **Body**,
   **Domains**, and the actions.
2. Type a title and a body. The **Note preview** under the body renders the
   markdown as you type.
3. Tick one or more **Domains**, or tick none to keep the note in **Overview**
   only. The picker is pre-set to the active domain when a domain lens is on.
4. Choose **Create**. The note is written to `documents/<id>.md` and appears in
   the list.
5. In the list, click a note to open it in the composer; edit it and choose
   **Save**. **Cancel** clears the composer without writing.

The list is ordered most recently updated first. Each card shows the title, its
domain tags (or **Unassigned**) and the update time. Empty states: **No notes
yet. Create one above.**, **No notes in this domain. Unassigned notes stay in
Overview.**, and `<N> note file(s) could not be read.` for files the reader had to skip.

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

- `[[<domain>/<kind>]]` or `[[<Domain name>/<Doctrine label>]]` — a doctrine
  document. `kind` is `premise`, `what`, `why` or `how`, and the label form accepts
  **Beliefs & Premise**, **Vision & Desire**, **Purpose** and **Strategy (How)**.
  Clicking it opens the doctrine page.
- `[[<note title>]]` — a library note, matched case-insensitively against the
  titles. It resolves only when exactly one note has that title; clicking it opens
  that note in the composer.

A `[[target]]` that resolves to nothing stays literal text. External links in the
preview are contained: they open in a new window, and the current window never
navigates to a foreign page.

### Lock a note

1. Open a note and choose **Lock**. Locking is the operator's mark that the note
   is finished.
2. A locked note is read-only in place: the title and body are not editable, the
   domains are disabled, and **Save** is unavailable. The composer says **Unlock
   to edit, or propose a change.**
3. Choose **Unlock** to edit in place again, or **Propose change** to send a
   proposed revision to [Decisions](./23-decisions.md) while the note stays
   locked.

### Propose a change

1. Open a locked note and choose **Propose change**.
2. The dialog **Propose change** pre-fills the note's title and body. A **Title**
   field, an optional **Rationale**, and a **Proposed body** are what you send.
3. Choose **Submit proposal**. A Decision is filed; the note does not change
   until it is approved. The dialog says it: **This proposal goes to Decisions.
   The document stays locked.**
4. Approve the Decision in **Decisions** to write the proposed title and body
   into the note. The note's lock state is unchanged by an approval.

### Delete a note

**Delete** asks first: **Delete note** — *The note is hidden from the library. Its
file stays in the vault.* Confirming hides the note from the list; the markdown
file is not erased.

## The screen

| Part | What it does |
|---|---|
| Header | Title **Documents**, one line: *Markdown notes. Tag a domain, or leave unassigned to keep them in Overview only.* |
| **Title** / **Body** | The note's fields. Read-only while locked. |
| **Note preview** | The rendered markdown, updated as the body changes. |
| **Domains** | Checkboxes for each live domain; none means Overview-only. Disabled while locked. |
| Actions | **Create** for a new note; **Save**, **Cancel**, **Delete** when one is open; **Lock** when unlocked; **Unlock** and **Propose change** when locked. |
| Library list | Note cards with title, domain tags or **Unassigned**, and update time. Click to open. |

## Rules and behaviour

A note is a markdown file. `documents/<id>.md`, where `<id>` is generated and
stays the filename for the life of the note — renaming a note changes its title,
never its path. Frontmatter carries `title`, `domains` (a JSON array),
`createdAt`, `updatedAt`, `deletedAt` and `locked`. A note is hidden when
`deletedAt` is set; the file stays. `documents/` sits at the vault root, not under
a domain.

Domains are tags, not a folder. A note may carry several domain slugs or none.
The domain lens is a filter over the tags: Overview shows everything, a domain
lens shows the notes that name it. A note with an empty tag list appears only on
Overview. Domain tags must name an existing domain; an unknown tag is refused by
the engine, not silently stored.

Lock is operator-only. The engine refuses a lock or unlock from an agent with
**Only the user may lock or unlock library notes.** Locking is not a Decision for
the operator — it applies at once. Unlocking does not apply, dismiss or change a
pending proposal.

The law behind the lock. The doctrine law applies to library notes too:
locked documents must not be edited in place, agents must not lock or unlock, and
an agent change to a locked document must appear as a pending Decision. The full
statement is in [LAWS/DOCTRINE.md](../../LAWS/DOCTRINE.md).

What the companion can do.

| Tool | Behaviour |
|---|---|
| `list_documents` | Reads every library note plus one record per doctrine document per live domain. No approval. |
| `get_document` | Reads a library note by id, or a doctrine document by `domainSlug` + `kind`. |
| `create_library_document` | An agent's create files a pending **Library note** Decision; the file appears when the operator approves it. |
| `update_document` | An agent's change to a library note files a **Library note** Decision with the proposed title and body. On a doctrine document an agent always proposes, locked or not. |

So a companion write to any document waits in [Decisions](./23-decisions.md); the
operator's own edit to an unlocked note is direct. Reads need no approval. Every
create, update and lock change appends a life-log entry naming the actor.

Media. The library composer has no image insert control, and the **Note
preview** does not resolve vault media: an `![alt](media/<name>)` reference is
stored as written but has no image behind it on this page. Vault media
(`domains/<slug>/media/`, PNG/JPEG/GIF/WebP up to 8 MB) is inserted by the
doctrine document editor and resolved by the shared markdown view there. Receipt
photos are a Finance-kit feature, not a library-note feature — see
[Finance kit](./20-finance-kit.md).

External links are contained. A markdown link to an `https://` page opens in a
new window, and the main process decides whether that window opens. Any other
non-hash link in the preview is a dead click rather than a navigation of the
window that carries the app bridge.

## Tips and edge cases

- There is no autosave. A body typed into the composer is lost if you click
  another note or leave the page without **Save** or **Create**.
- You can lock a note with unsaved edits: locking the stored file does not save
  your draft, and the composer becomes read-only. Save first, then lock.
- A **Title** is required. **Create** and **Save** are disabled until it is
  non-empty, and the engine refuses an empty title.
- Renaming a note does not break `[[old title]]` links in other notes: a link
  resolves only on an exact current title, so a rename turns older links into
  literal text.
- Two notes with the same title make `[[that title]]` ambiguous, and an ambiguous
  link stays literal text rather than guessing.
- **Delete** is soft: the note leaves the list and the lens, and the file remains
  in the vault. There is no restore control in the studio; the file is still
  readable and can be edited by hand.
- A note tagged with an archived domain keeps the tag. The note is visible on
  **Overview**, and the picker shows the archived tag only while that note is
  open.
- A locked note can still be deleted; deletion is not an in-place edit.
- A proposal approved later still writes that proposal's body — the last
  approval wins. Unlocking does not settle a pending proposal.
- The library is not the place for goals, tasks, projects or doctrine; those have
  their own files and pages. If a note starts wanting structure, a database or a
  page is usually the better surface.

## Related

- [Doctrine](./07-doctrine.md) — the prescribed documents that share the same lock
  and proposal model
- [Decisions](./23-decisions.md) — where a companion or locked-note change waits
- [Data and databases](./19-data-and-databases.md) — when a note wants structured
  rows instead of prose
- [Pages](./21-pages.md) — the other freeform knowledge surface, built from blocks
- [The Vault](./04-the-vault.md) — where `documents/` sits in the folder layout
- [The Companion](./24-companion.md) — the tools the companion reads and proposes
  with
