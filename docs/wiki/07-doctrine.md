# Doctrine

Doctrine is the four-part definition of every area: its **Beliefs & Premise**,
its **Vision & Desire**, its **Purpose**, and its **Strategy (How)**. The Dream
page carries three of the four as cards, the Vision page carries the vision on
its own, and the Architecture page keeps a second door into the same Strategy
(How) document. Each document is plain markdown in the vault, edited in one
live-preview box, and locked when you are done with it. Agents never write
doctrine directly; their changes wait in Decisions.

This page covers the documents and their editor. For the pages that host them,
see [Architecture](./08-architecture.md) (Strategy (How) and the week),
[Goals](./10-goals.md) (outcomes), and [Ideal State](./09-ideal-state.md) (your
own future documents, which are not doctrine).

## Where it lives

- Define wing, rail label **Dream**, icon Sparkles, route `/dream`.
- Define wing, rail label **Vision**, icon Telescope, route `/vision`.
- The Strategy (How) document also opens from the Plan wing, rail label
  **Architecture**, icon Target, route `/track`.
- The editor for one document is a page at `/dream/:slug/:kind`,
  `/vision/:slug/:kind`, or `/track/:slug/:kind`. The index and editor are
  pages, not sheets.
- The **area lens** in the window title bar chooses which areas the indexes
  list. It is a quiet **Life** label while zero or one area is unlocked and
  becomes the segmented control, starting with **Life**, after a second one
  opens.

Return to [Wiki home](./index.md).

## What it is for

An area is more than a folder. Doctrine asks you to state what you believe about
that area of your life, what you want it to look like, why it matters, and how
you will get there. The four documents are read in that order, so the app keeps
them as four separate files rather than one long note. Writing them is a Define
activity; the app then uses the same documents elsewhere: the Life Map shows the
active area's Vision & Desire as a strip, and agents read all four with
`get_doctrine` when they need context.

The four kinds are fixed. Their on-disk names are shorter than their rail
labels:

| Kind | Label | File |
|---|---|---|
| `premise` | Beliefs & Premise | `domains/<slug>/premise.md` |
| `what` | Vision & Desire | `domains/<slug>/what.md` |
| `why` | Purpose | `domains/<slug>/why.md` |
| `how` | Strategy (How) | `domains/<slug>/how.md` |

Every area has all four files, including the five seeded areas while they are
still locked — you simply cannot see them until the area is unlocked. Life, the
base area, is a group like any other in the indexes.

## How to use it

1. Choose the **area lens** in the window title bar. **Life** groups the cards
   by every unlocked area, in area sort order; an area lens narrows the list to
   that area alone.
2. Open **Dream** from the rail. Each unlocked area shows three cards: **Beliefs
   & Premise**, **Purpose**, and **Strategy (How)**. A card shows the document
   label, its **Locked** or **Unlocked** badge, and either the rendered markdown
   or, while the body is empty, that kind's coaching paragraph.
3. Click a card to open its editor. The top line reads **Back** · area name ·
   document label; **Back** returns to the Dream index.
4. Write in the **Title** field and in the body box. The body box is one
   continuous page: everything except the paragraph under the caret is rendered
   as markdown, and the paragraph under the caret is its own raw markdown.
   Clicking a rendered paragraph opens it for editing.
5. Click **Save**. The button is disabled until something changed and reads
   **Saving…** while the write runs; a **Saved** line confirms it.
6. When the document says what you want, open the three-dot **Document actions**
   menu at the page's top-right corner and choose its first item, the **Lock**
   switch. The badge beside the document's name changes to **Locked**, the
   writing surface closes, and **Save** goes away.
7. To change a locked document: choose the same **Lock** switch to unlock it
   (only you may), or choose **Propose change**, now in the same menu, fill in
   **Title**, **Rationale (optional)**, and **Proposed body**, and press
   **Submit proposal**. The proposal goes to [Decisions](./23-decisions.md) and
   the document stays locked.
8. To write the Vision & Desire document, open **Vision**. It shows one card per
   unlocked area, labelled **Vision & Desire**, and its editor is the same
   editor at `/vision/:slug/what`. Below the doctrine card, the same page
   carries the **Vision board** — a block document of text, headings, bullets
   and pictures, edited in place — which is a vision document, not doctrine.
9. If a vault has no unlocked area at all, either index says **No live areas
   yet.**

## The screen

**Dream index.** One section per unlocked area, headed by the area name. Inside
it, three cards in the order Premise, Purpose, Strategy (How), each with a lock
badge and a body that is either rendered markdown or the coaching copy for that
kind. Empty is decided on trimmed whitespace, so a body of blank lines still
reads as empty.

**Vision index.** One card per unlocked area, labelled **Vision & Desire**, same
badge and body rules. The **Vision board** panel follows it on the page.

**Architecture index.** A list, not cards: one row per unlocked area with a
**Strategy (How)** link and a lock badge. It opens the same `how.md` file as the
Dream card.

**Editor.** A header with the document label, an optional " · area name", its
lock badge and the coaching paragraph; the page's top-right corner holds the
three-dot **Document actions** menu; a **Title** field; the body box; inline
error and status lines; and the action row.

**Actions by lock state.**

| State | What the page offers |
|---|---|
| Unlocked | **Save** (disabled until changed), and the **Lock** switch first in **Document actions** |
| Locked | The **Lock** switch (now set across) and **Propose change**, both in **Document actions**; no writing surface, no **Save** |

**Editor lines and controls.**

| Part | What it is |
|---|---|
| **Back** · area · label | The way out of the editor; **Back** returns to the index that owns it |
| Document label and lock badge | What this file is, and whether it is **Locked** or **Unlocked** |
| Coaching paragraph | The kind's prompt, always visible, never saved |
| Lock hint | `Document is locked. Unlock to edit, or propose a change.` |
| **Title** | The document's frontmatter title, shown and edited separately from the body |
| Body box | One live-preview markdown page; placeholder `Write this document.` |
| Status line | **Saved**, **Locked**, **Unlocked**, or the vault's refusal |
| **Document actions** menu | The page's one control: the **Lock** switch first, then **Propose change** while locked |
| Error line | The vault's reason when a read or write is refused, plus **Retry** after a failed load |

**Propose change dialog.** It opens from the locked document's menu only. The
hint reads `This proposal goes to Decisions. The document stays locked.` It has
a **Title** field (required), a **Rationale (optional)** field, and a **Proposed
body** field prefilled with the current body. **Cancel** closes it; **Submit
proposal** files the Decision and the editor reports `Proposal submitted —
review it under Decisions.`

**Coaching copy.** The editor always shows it under the heading, and an empty
card shows it in place of a body. It is UI copy and is never written into the
file.

> **Beliefs & Premise** — Your Premise refers to the foundational beliefs you hold about this category. What do you believe? What deeply held beliefs are shaping your life? Are your beliefs empowering? Do they move you at a deep level or are they holding you back? What is your Premise for this area of your life, or what would you like it to be?

> **Vision & Desire** — Your Vision refers to the ideal state you would like to achieve in this important category. Ask yourself: How do you want this area of your life to feel? What do you want it to look like? What do you want to be doing on a consistent basis? Clearly describe your ideal Vision.

> **Purpose** — Your Purpose refers to the compelling reasons behind what you want in this category. What energizes you? What empowers you to take action? What motivates you to achieve your Vision? Describe WHY you want to make the most out of this area of your life.

> **Strategy (How)** — Your Strategy refers to the specific actions that will get you from where you are now to where you want to be. How will you bring your vision into reality? Ask yourself what kind of positive habits, attitudes and action steps you can implement. What’s the RECIPE for the Vision you want to create?

## Rules and behaviour

**Files and frontmatter.** Each document is one markdown file under its area
folder, named after its kind. The frontmatter holds `title`, `locked`, and
`updatedAt`; the body below it is exactly the markdown you wrote. A missing
doctrine file is created empty with the default label as its title when the area
is loaded, so an older vault gains `premise.md` without failing to open.

**Editing.** The editor keeps a draft in memory and writes only on **Save**. A
changed title is saved only when it is non-empty; clearing the title keeps the
file's existing title. Unsaved edits are lost when you leave the page or reload
the vault, because a reload re-reads the file and resets the draft.

**Locking.** The lock is per document, and each of the four locks independently.
It lives in the document's **Document actions** menu, as the menu's first item —
the same three-dot control and the same leading switch on every lockable page,
with the Dashboard's **Pin board** and a library note's **Propose change** and
**Delete note** following it. The item is a switch, not a button that names an
action: choosing it flips the state and leaves the menu open while the track and
the page behind it change together; the row reads **Saving…** while the write is
in flight, and its accessible name is **Lock this document** or **Unlock this
document** in the state it will move to. A locked document cannot be edited in
place: the body box becomes read-only, the title field is read-only, and
**Save** is not offered. Its text can still be selected and copied. Only the
operator can lock or unlock; the vault rejects a lock change requested by an
agent with `Only the user can lock or unlock documents`.

**Proposals.** The operator can propose only while the document is locked; the
vault answers `Document must be locked before proposing a change` otherwise. An
agent's change to a doctrine document is always filed as a pending Decision, and
does not touch the file. **Approve** writes the proposed body, and the proposed
title when the proposal carries one, and leaves the lock exactly as it was.
**Reject** leaves the file untouched. Unlocking does not apply or dismiss a
pending proposal.

**Undo is not an unlock.** Approving a Decision about a locked document does not
unlock it. If you want the approved text to be editable in place afterwards, you
still have to choose the **Lock** switch to unlock it.

**The area lens.** The lens filters the indexes only: the **Life** lens groups
every unlocked area, and an area lens narrows the list to that area. Doctrine is
stored per area, so there is no unassigned doctrine. A locked area's doctrine
does not exist for the app: no card, no editor, no Decision, and the companion's
`get_document` answers not found. See
[LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md).

**Live markdown.** The editor splits the note at blank lines into blocks and
joins them back losslessly. Enter ends the current block and opens the next;
Backspace at the very start of a block joins it to the one above; a blank line
you type stays a blank line in the file. Inside a fenced code block, Enter is a
newline, not a paragraph break, and a list item continues the list when you
press Enter on a non-empty item. The formatting keys are Ctrl/Cmd+B for bold,
Ctrl/Cmd+I for italic, Ctrl/Cmd+U for underline (`<u>` in the file), and
Ctrl/Cmd+1 through Ctrl/Cmd+6 for a heading on the caret's line, with Ctrl/Cmd+0
returning that line to prose.

**Images.** Paste or drop an image into the body box. PNG, JPEG, GIF, and WebP
are accepted up to 8 MB. The file is copied to
`domains/<slug>/media/<id>.<ext>`, and markdown pointing at it
(`![](media/<id>.<ext>)`) is inserted where the caret was. Other image types and
larger files are refused. Media is per area, so the same image is not shared
between areas. The Images page is a separate vault-level library; the two stores
do not mix.

**The law.** The doctrine law is short and the app follows it: each area must
hold the four sections; a locked document must not be edited in place; agents
must not lock or unlock; and an agent change to a locked document must appear as
a pending Decision. Read it in [LAWS/DOCTRINE.md](../../LAWS/DOCTRINE.md).

**History.** A save appends `document.updated` to the Life log, and a lock
change appends `document.lock_changed`, both naming the document and who did it.
They appear on the [Log](./26-log.md) page.

## Tips and edge cases

- **Save is not automatic here.** Unlike the Daily Journal, Review, and Ideal
  State editors, the doctrine editor has no autosave. If you close it with
  unsaved text, that text is gone.
- **The Dream page does not show Vision & Desire.** That document has its own
  page and its own card there. The Dream cards are exactly three: Premise,
  Purpose, Strategy (How).
- **Strategy (How) has two doors but one file.** Editing it from Dream and from
  Architecture edits `domains/<slug>/how.md`; there is no second Strategy
  document.
- **The Vision board is not doctrine.** It is a block document at
  `images/board.json`, drawn below the doctrine card on the Vision page, with
  its own picture blocks and autosave; the doctrine document beside it is still
  the area's formal vision.
- **A locked document does not freeze the companion's view.** Agents can still
  read it with `get_doctrine`; only writing is gated.
- **Proposals are compared, not merged.** The Decisions card shows the current
  and proposed body, so read the diff before approving.
- **Empty is empty.** An all-whitespace body shows the coaching copy on the
  card, even if you once typed spaces into it.
- **The lock is one click deeper than it used to be.** It is the first item of
  the **Document actions** menu rather than a control beside the title; the
  badge beside the title is the state, and the menu is the switch.
- **A locked area shows nothing, not a locked card.** You cannot see, propose
  against, or approve a Decision into an area that is still locked; unlock it in
  Settings → Areas first. See [Areas](./05-areas.md).

## Related

- [Wiki home](./index.md)
- [Areas](./05-areas.md)
- [Architecture](./08-architecture.md)
- [Ideal State](./09-ideal-state.md)
- [Decisions](./23-decisions.md)
- [The Log](./26-log.md)
