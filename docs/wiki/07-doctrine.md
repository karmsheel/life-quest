# Doctrine

Doctrine is the four-part definition of every domain: its **Beliefs & Premise**, its **Vision & Desire**, its **Purpose**, and its **Strategy (How)**. The Dream page carries three of the four as cards, the Vision page carries the vision on its own, and the Architecture page keeps a second door into the same Strategy (How) document. Each document is plain markdown in the vault, edited in one live-preview box, and locked when you are done with it. Agents never write doctrine directly; their changes wait in Decisions.

This page covers the documents and their editor. For the pages that host them, see [Architecture](./08-architecture.md) (Strategy (How) and the week), [Goals](./10-goals.md) (outcomes), and [Ideal State](./09-ideal-state.md) (your own future documents, which are not doctrine).

## Where it lives

- Define wing, rail label **Dream**, icon Sparkles, route `/dream`.
- Define wing, rail label **Vision**, icon Telescope, route `/vision`.
- The Strategy (How) document also opens from the Plan wing, rail label **Architecture**, icon Target, route `/track`.
- The editor for one document is a page at `/dream/:slug/:kind`, `/vision/:slug/:kind`, or `/track/:slug/:kind`. The index and editor are pages, not sheets.

Return to [Wiki home](./README.md).

## What it is for

A domain is more than a folder. Doctrine asks you to state what you believe about that area of your life, what you want it to look like, why it matters, and how you will get there. The four documents are read in that order, so the app keeps them as four separate files rather than one long note. Writing them is a Define activity; the app then uses the same documents elsewhere: the Life Map shows the active domain's Vision & Desire as a strip, and agents read all four with `get_doctrine` when they need context.

The four kinds are fixed. Their on-disk names are shorter than their rail labels:

| Kind | Label | File |
|---|---|---|
| `premise` | Beliefs & Premise | `domains/<slug>/premise.md` |
| `what` | Vision & Desire | `domains/<slug>/what.md` |
| `why` | Purpose | `domains/<slug>/why.md` |
| `how` | Strategy (How) | `domains/<slug>/how.md` |

## How to use it

1. Pick a lens in the top bar: **Overview** or one domain. On Overview, Dream and Vision group their cards by every live domain, in domain sort order. With a domain lens, only that domain's group is shown.
2. Open **Dream** from the rail. Each live domain shows three cards: **Beliefs & Premise**, **Purpose**, and **Strategy (How)**. A card shows the document label, its **Locked** or **Unlocked** badge, and either the rendered markdown or, while the body is empty, that kind's coaching paragraph.
3. Click a card to open its editor. The top line reads **Back** · domain name · document label; **Back** returns to the Dream index.
4. Write in the **Title** field and in the body box. The body box is one continuous page: everything except the paragraph under the caret is rendered as markdown, and the paragraph under the caret is its own raw markdown. Clicking a rendered paragraph opens it for editing.
5. Click **Save**. The button is disabled until something changed and reads **Saving…** while the write runs; a **Saved** line confirms it.
6. When the document says what you want, click **Lock**. The badge changes to **Locked**, the writing surface closes, and the actions become **Unlock** and **Propose change**.
7. To change a locked document: **Unlock** it (only you may) and edit it, or click **Propose change**, fill in **Title**, **Rationale (optional)**, and **Proposed body**, and click **Submit proposal**. The proposal goes to [Decisions](./23-decisions.md) and the document stays locked.
8. To write the Vision & Desire document, open **Vision**. It shows one card per live domain, labelled **Vision & Desire**, and its editor is the same editor at `/vision/:slug/what`.

With no live domains, either index says **No live domains yet.**

## The screen

**Dream index.** One section per live domain, headed by the domain name. Inside it, three cards in the order Premise, Purpose, Strategy (How), each with a lock badge and a body that is either rendered markdown or the coaching copy for that kind. Empty is decided on trimmed whitespace, so a body of blank lines still reads as empty.

**Vision index.** One card per live domain, labelled **Vision & Desire**, same badge and body rules.

**Architecture index.** A list, not cards: one row per live domain with a **Strategy (How)** link and a lock badge. It opens the same `how.md` file as the Dream card.

**Editor.** A header with the document label, an optional " · domain name", and the lock badge; the coaching paragraph under the heading; a **Title** field; the body box; inline error and status lines; and the action row.

**Actions by lock state.**

| State | Buttons |
|---|---|
| Unlocked | **Save** (disabled until changed), **Lock** |
| Locked | **Unlock**, **Propose change** |

**Editor lines and controls.**

| Part | What it is |
|---|---|
| **Back** · domain · label | The way out of the editor; **Back** returns to the index that owns it |
| Document label and lock badge | What this file is, and whether it is **Locked** or **Unlocked** |
| Coaching paragraph | The kind's prompt, always visible, never saved |
| Lock hint | `Document is locked. Unlock to edit, or propose a change.` |
| **Title** | The document's frontmatter title, shown and edited separately from the body |
| Body box | One live-preview markdown page; placeholder `Write this document.` |
| Status line | **Saved**, **Locked**, **Unlocked**, or the vault's refusal |
| Action row | **Save** and **Lock** while unlocked; **Unlock** and **Propose change** while locked |
| Error line | The vault's reason when a read or write is refused, plus **Retry** after a failed load |

**Propose change dialog.** It opens from the locked editor only. The hint reads `This proposal goes to Decisions. The document stays locked.` It has a **Title** field (required), a **Rationale (optional)** field, and a **Proposed body** field prefilled with the current body. **Cancel** closes it; **Submit proposal** files the Decision and the editor reports `Proposal submitted — review it under Decisions.`

**Coaching copy.** The editor always shows it under the heading, and an empty card shows it in place of a body. It is UI copy and is never written into the file.

> **Beliefs & Premise** — Your Premise refers to the foundational beliefs you hold about this category. What do you believe? What deeply held beliefs are shaping your life? Are your beliefs empowering? Do they move you at a deep level or are they holding you back? What is your Premise for this area of your life, or what would you like it to be?

> **Vision & Desire** — Your Vision refers to the ideal state you would like to achieve in this important category. Ask yourself: How do you want this area of your life to feel? What do you want it to look like? What do you want to be doing on a consistent basis? Clearly describe your ideal Vision.

> **Purpose** — Your Purpose refers to the compelling reasons behind what you want in this category. What energizes you? What empowers you to take action? What motivates you to achieve your Vision? Describe WHY you want to make the most out of this area of your life.

> **Strategy (How)** — Your Strategy refers to the specific actions that will get you from where you are now to where you want to be. How will you bring your vision into reality? Ask yourself what kind of positive habits, attitudes and action steps you can implement. What’s the RECIPE for the Vision you want to create?

## Rules and behaviour

**Files and frontmatter.** Each document is one markdown file under its domain folder, named after its kind. The frontmatter holds `title`, `locked`, and `updatedAt`; the body below it is exactly the markdown you wrote. A missing doctrine file is created empty with the default label as its title when the domain is loaded, so an older vault gains `premise.md` without failing to open.

**Editing.** The editor keeps a draft in memory and writes only on **Save**. A changed title is saved only when it is non-empty; clearing the title keeps the file's existing title. Unsaved edits are lost when you leave the page or reload the vault, because a reload re-reads the file and resets the draft.

**Locking.** The lock is per document, and each of the four locks independently. A locked document cannot be edited in place: the body box becomes read-only, the title field is read-only, and **Save** is not offered. Its text can still be selected and copied. Only the operator can lock or unlock; the vault rejects a lock change requested by an agent with `Only the user can lock or unlock documents`.

**Proposals.** The operator can propose only while the document is locked; the vault answers `Document must be locked before proposing a change` otherwise. An agent's change to a doctrine document is always filed as a pending Decision, and does not touch the file. **Approve** writes the proposed body, and the proposed title when the proposal carries one, and leaves the lock exactly as it was. **Reject** leaves the file untouched. Unlocking does not apply or dismiss a pending proposal.

**Undo is not an unlock.** Approving a Decision about a locked document does not unlock it. If you want the approved text to be editable in place afterwards, you still have to **Unlock** it.

**Lens.** The domain lens filters the indexes only: Overview groups every live domain, and a domain lens narrows the list to that domain. Doctrine is stored per domain, so there is no unassigned doctrine.

**Live markdown.** The editor splits the note at blank lines into blocks and joins them back losslessly. Enter ends the current block and opens the next; Backspace at the very start of a block joins it to the one above; a blank line you type stays a blank line in the file. Inside a fenced code block, Enter is a newline, not a paragraph break, and a list item continues the list when you press Enter on a non-empty item. The formatting keys are Ctrl/Cmd+B for bold, Ctrl/Cmd+I for italic, Ctrl/Cmd+U for underline (`<u>` in the file), and Ctrl/Cmd+1 through Ctrl/Cmd+6 for a heading on the caret's line, with Ctrl/Cmd+0 returning that line to prose.

**Images.** Paste or drop an image into the body box. PNG, JPEG, GIF, and WebP are accepted up to 8 MB. The file is copied to `domains/<slug>/media/<id>.<ext>`, and markdown pointing at it (`![](media/<id>.<ext>)`) is inserted where the caret was. Other image types and larger files are refused. Media is per domain, so the same image is not shared between domains.

**The law.** The doctrine law is short and the app follows it: each domain must hold the four sections; a locked document must not be edited in place; agents must not lock or unlock; and an agent change to a locked document must appear as a pending Decision. Read it in [LAWS/DOCTRINE.md](../../LAWS/DOCTRINE.md).

**History.** A save appends `document.updated` to the Life log, and a lock change appends `document.lock_changed`, both naming the document and who did it. They appear on the [Log](./26-log.md) page.

## Tips and edge cases

- **Save is not automatic here.** Unlike the Daily Note, Review, and Ideal State editors, the doctrine editor has no autosave. If you close it with unsaved text, that text is gone.
- **The Dream page does not show Vision & Desire.** That document has its own page and its own card there. The Dream cards are exactly three: Premise, Purpose, Strategy (How).
- **Strategy (How) has two doors but one file.** Editing it from Dream and from Architecture edits `domains/<slug>/how.md`; there is no second Strategy document.
- **A locked document does not freeze the companion's view.** Agents can still read it with `get_doctrine`; only writing is gated.
- **Proposals are compared, not merged.** The Decisions card shows the current and proposed body, so read the diff before approving.
- **Empty is empty.** An all-whitespace body shows the coaching copy on the card, even if you once typed spaces into it.

## Related

- [Wiki home](./README.md)
- [Domains](./05-domains.md)
- [Architecture](./08-architecture.md)
- [Ideal State](./09-ideal-state.md)
- [Decisions](./23-decisions.md)
- [The Log](./26-log.md)
