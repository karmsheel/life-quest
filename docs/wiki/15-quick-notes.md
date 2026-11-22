# Notebox

**Notebox** is quick-fire capture *and* the vault's single Inbox. One box, one key, and
the thing is off your mind: it is a chain of signals — a thought, a picture, a file, a link —
kept as small JSON records in the vault. Then the chain is where you triage them: file a
capture under an area and a project, give it a status and a priority, and turn it into board
work.

Notebox is the one entry point for external information into the vault. A browser tab, a
line from Notion, a thought in the shower: it lands here as a signal, and nothing else has to
own it until you decide it is work.

## Where it lives

- Wing: none. Notebox sits on the bottom shelf of the rail, above **Decisions**.
- Rail: icon **Inbox**, label **Notebox**.
- Route: `/chain`. The route and file names did not change when the page was renamed from
  Quick Notes (earlier from Life-Chain).
- Surface: a full page in the centre pane. The chat dock also has a **Notebox** surface
  of the same chain (see below).

This page is part of the [Wiki home](./index.md).

## What it is for

Capture dies when it takes more than a keystroke, so the composer deliberately asks for little:
a description, one optional attachment, and an optional **Area**. An attachment arrives in one
of two gestures: the **plus** at the box's bottom left takes any file (a picture previews, any
other file becomes a name-and-size chip), and **pasting a URL** into the box turns it into a
link chip. Type, title, project, status and priority are not composer fields — a capture is a
capture, and the inbox is worked afterwards, on the row.

Each signal carries:

- an **Area** (`domainSlug`) or none;
- a **Project** or none, which must name a live project from `projects/`;
- a **Status** — where the capture stands as work;
- a **Priority** — your own ordering, or none;
- **Captured from** — free text naming where it came in from (`Chrome — AI tab group`,
  `Notion — Action Items`), when the capture came from outside the app.

The one box takes four kinds of capture:

- **Text** — the description is the capture, and logging it is one keystroke.
- **A picture** — picked with the plus, dragged or pasted, previewed before it is logged, with
  an optional description.
- **Any other file** — picked with the same plus (or dragged or pasted); a PDF, a document, a
  clip. It rides the capture and can be saved from its row.
- **A link** — an absolute web address pasted into the box, with an optional description.

A capture carries at most one attachment. Picking or pasting anything else replaces whatever
was attached, before the capture is logged.

## How to use it

1. Choose **Notebox** in the rail. The cursor is already in the capture box, whose
   placeholder is **What's on your mind?**.
2. Type the description. **Enter** logs it; **Shift+Enter** inserts a new line. The box is
   three rows tall and the operator drags its corner when a thought needs more room.
3. To attach something, choose the **plus** (**Attach a file**) at the box's bottom left, drag
   a file onto the composer, or paste a file into the box. A picture previews above the box
   with its file name and the line "It will be kept in the vault with this capture."; any
   other file shows a chip with its name and size. The X button takes the attachment off
   (**Remove the attached image** / **Remove the attached file**). The description may be
   left empty.
4. To capture a link, paste an absolute `http` or `https` address into the box on its own. It
   turns into a chip with its host and the full address and does not enter the description;
   the X button (**Remove the attached link**) takes it off. A URL pasted inside a sentence
   stays part of the description (text, not a link capture). The description may be left
   empty.
5. Optionally choose an **Area** before logging. The picker sits in the box's foot, beside
   the **Log** button; its first option is **- unassigned -**, and leaving it there files the
   signal with no area.
6. Press **Enter** or choose the primary **Log** button. The box clears, the area picker resets
   to **- unassigned -**, the preview drops, and the new signal appears at the top of the list
   with status **Inbox**.
7. Narrow the list with the filter chips above it: by **status**, by **area**, or by
   **project**. Filters combine with the area lens; a filter with no matches says
   "No signals match these filters."
8. Work a signal in the list:
   - Change its **Area**, **Project**, **Status** or **Priority** with the selects on the row.
     These are direct writes; nothing asks for approval.
   - Choose the pencil button (**Edit**) to change its **Description** and **Area** inline;
     **Save** or **Cancel**, and Escape cancels. A picture or link cannot be replaced from
     the edit form.
   - Choose **Make task** to create a backlog task from it. When the capture belongs to a
     project, the task is linked to that project too, and the capture moves to **Acting**.
   - Choose the bin button (**Delete**) to hide it from the chain.
9. If a signal already has a task, its **Make task** button reads **Open task** and leads to
   the Task Manager board with that card expanded.

With nothing captured yet, the page shows: "Nothing on the chain yet. Write something above."

## The screen

| Part | What it does |
|---|---|
| **Notebox** heading | The title and the line "A database of what you notice. Log now; assign later." The page reads as one centred column — capture, filters and chain down the middle of the pane. |
| Capture box | One bordered surface, the page's one input: a three-row text area labelled **Log a signal** (placeholder **What's on your mind?**, autofocused, corner draggable for more room) and, inside the same box's foot, the **Plus** control, the **Area** picker and the **Log** button. The text field has no frame of its own — the box is the field — and the whole box takes the accent ring when the caret or any of its controls is in it. It is the description: a text capture needs text, and an attachment may be logged without it. |
| **Plus** control | The single attachment control at the box's bottom left (test name **Attach a file**, plus glyph). Opens a file picker with no type restriction — any picture or file — and dragging a file onto the composer or pasting a file into the box does the same. |
| Picture preview | Inside the box, above the field, until the signal is logged: the chosen picture, its file name, the line "It will be kept in the vault with this capture.", and the X button **Remove the attached image**. |
| File chip | Inside the box, above the field, until the signal is logged: a non-picture attachment's name and human size, with the X button **Remove the attached file**. |
| Link chip | Inside the box, under the field, until the signal is logged, after a URL is pasted: the link's host and the full address, with the X button **Remove the attached link**. |
| **Area** picker | **- unassigned -** plus every unlocked area (never the base **Life**). Sits inside the capture box's foot, beside the **Log** button, which is the box's one primary action and is disabled until there is a description or an attachment. |
| **Log** button | The primary button inside the capture box's trailing corner (arrow-up glyph and **Log**). Pressing it, or **Enter** in the box, logs the capture. |
| Divider | A hairline with a breath of space on either side separates the capture box from the filters below it. |
| Filter chips | Three chip rows above the list: **status** (All, Inbox, Triaged, Acting, Done, Dropped), **area** (All, Unassigned, each live area) and **project** (All, each live project). The active chip is pressed; filters combine. |
| Chain list | Newest first. Each row shows its attachment, the signal's title and body when it has one, the area, the project, the status, the priority, where it came from, when it was captured, and the row actions. |
| Row meta | The area cell says **Unassigned** when the signal has none and never paints blank; the project cell says **No project** (or the stored id if the project was deleted); the status cell reads Inbox, Triaged, Acting, Done or Dropped; the priority cell reads High, Normal, Low or None. |
| Triage selects | The row's **Status**, **Priority** and **Project** selects write the change at once. Status is the five states; priority adds **None** for unset; project adds **No project** to unfile it. |
| Attachment | An image draws at the top of the row with its file name beneath it; a link draws a card at the top of the row with its host and address. The link card opens `https` addresses in the browser. Any other file draws a card with its name and size and a **Save** control (accessible name **Save the attached file**) that writes a copy of the vault's bytes to disk. |
| Timestamp | "Today, 14:32" / "Yesterday, 09:05" for recent days; an older signal shows a medium date and time. |
| Row actions | **Make task** (or **Open task**), pencil **Edit**, bin **Delete**, plus the inline **Area** select. |
| Edit form | **Description** textarea, **Area** select, **Save**, **Cancel**. Editing changes the description and area only; a picture, file or link stays as captured. |
| Confirm dialog | Deleting asks first: title **Delete signal**, message "The signal is hidden from the chain. Its record and messages stay in the vault.", confirm **Delete signal**. |
| Empty chain | "Nothing on the chain yet. Write something above." |
| Empty filter | "No signals match these filters." |
| Unreadable files | If any signal file cannot be parsed: "N signal file(s) could not be read." |
| Missing file | A picture or file whose bytes have gone still holds its row: "That picture is missing from the vault." / "That file is missing from the vault." |

The lens filters the *view*, not the capture: **Life** shows every signal, and an area lens
shows the signals tagged to that area plus every unassigned one, because an unassigned
capture has not been filed anywhere yet and must not disappear. The page has no search field
and no paging; the whole chain is the list.

## Rules and behaviour

### Capture keystrokes

Enter submits only when it is not composing text and not a held-down repeat:

- **Enter** submits the form.
- **Shift+Enter** inserts a newline instead.
- A keystroke that is part of an IME composition (`isComposing`, or the `229` key code)
  never submits, so confirming a candidate in a composition does not log a half-written
  signal.
- A key repeat from holding Enter down is ignored, so one thought cannot fire several writes.

The page's own composer is the Notebox gesture, and it is not the chat composer: Notebox
keeps **Enter** to log and **Shift+Enter** for a new line, whatever the chat is set
to. The chat box defaults to **Enter** breaking the line and **Ctrl/Cmd+Enter** sending,
though Settings → **Composer** can hand that send to plain Enter.

### What a signal is

A signal is a vault file at `.lifequest/signal-chain/<id>.json`, one JSON object per file:

```json
{
  "id": "uuid",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "deletedAt": null,
  "type": "thought",
  "source": "manual",
  "sourceRef": null,
  "title": null,
  "body": "the capture",
  "domainSlug": null,
  "projectId": null,
  "status": "inbox",
  "priority": null,
  "capturedFrom": null,
  "attachment": null
}
```

- `attachment` is `null` for a text capture. A picture stores
  `{ "kind": "image", "relPath": ".lifequest/signal-chain/files/<uuid>.<ext>", "name": "desk-lamp.png", "mime": "image/png", "width": 640, "height": 480 }`
  (width and height may be `null` when the machine could not decode the canvas); a link
  stores `{ "kind": "link", "url": "https://…" }`; any other file stores
  `{ "kind": "file", "relPath": ".lifequest/signal-chain/files/<uuid>[.<ext>]", "name": "brief.pdf", "mime": "application/pdf", "size": 20480 }`.
- The description is the body. A text-only capture needs a non-empty body; a capture with a
  picture, file or link may store an empty one, because the attachment says what was
  captured. The vault's refusal for neither is "A capture needs text, a file, an image or a link".
- The area is stored as `domainSlug` (the field kept its old name); `null` is unassigned.
- `projectId` is a live project id from `projects/`; a write naming an id no project file
  backs is refused with "Unknown project: <id>" and nothing is written. `null` is unfiled.
- `status` is one of `inbox`, `triaged`, `acting`, `done`, `dropped`. A signal is created
  `inbox`; the five are the only values the store writes, and any other value is refused.
- `priority` is one of `high`, `normal`, `low`, or `null` for unset. Nothing else is
  accepted; "normal" is a real choice, not the default.
- `capturedFrom` is free text naming where the capture came from, trimmed; empty is `null`.
- A signal written before the inbox existed carries none of these keys. It reads back as
  `status: "inbox"` with the project, priority and origin unset — no migration step is
  needed, and the next direct write stores the defaults explicitly.
- The page files every capture as type `thought`, with no title and no source reference.
- The list is sorted newest first by `createdAt`, with the id as a tie-breaker.
- Deleted records are soft-deleted: `deletedAt` is stamped, the file stays, and the chain
  stops listing it. Nothing is erased from disk by the page.
- A signal whose area is later archived stays writable: its stored slug is shown even when
  the live area list no longer offers it.
- A signal whose project was deleted keeps the stored id and shows it; the project picker
  does not offer it, and **No project** unfiles the capture.
- The textarea is trimmed on write; a whitespace-only capture is refused when there is no
  attachment.

### Triaging a capture

Triage is a direct write, like capture: no Decision, no approval queue.

- The row's **Status**, **Priority** and **Project** selects, the **Area** select and the
  inline **Edit** form all write the signal file immediately and stamp `updatedAt`.
- The five statuses mean: **Inbox** (untriaged), **Triaged** (looked at, filed), **Acting**
  (there is work in flight), **Done** (no longer needing attention), **Dropped** (decided
  against). The page does not enforce transitions; the status is your statement about the
  capture.
- A status outside the five and a priority outside the three are refused by value; an
  unknown project id is refused by id. Nothing is written by a refusal.
- Filters are only a view: they do not change a signal, and they reset with the page.

### A picture

- Pick it with the **plus**, drag a file onto the composer, or paste a picture into the box.
  PNG, JPEG, GIF and WebP are accepted up to 8 MB. The bytes decide the format and the
  extension, while the uploaded name stays a label; a file that is not one of those types,
  an empty file, or one over 8 MB is refused with a message before anything is written.
- A picture is a real file: its bytes are written atomically to
  `.lifequest/signal-chain/files/<uuid>.<ext>` and the record names it by the vault-relative
  `relPath`. If the record write fails, the stored file is removed again.
- The row reads the bytes back and draws the picture at the top of the row, with the file
  name beneath it and the description below. An image capture can have no description at
  all.
- The attachment is set at capture time; **Edit** changes the description and the area only,
  and does not offer to replace or remove the picture.
- Deleting a signal is still a soft delete: the row leaves the chain and the picture file
  stays in the vault. A row whose file has gone says "That picture is missing from the
  vault."; a row still loading its bytes says "Loading picture…".

### Any other file

- The same **plus** takes anything else — a PDF, a document, a clip, an archive: the picker
  has no type restriction, and dragging or pasting a file does the same. One file rides a
  capture.
- The file is capped at 25 MB and its bytes are written atomically to
  `.lifequest/signal-chain/files/<uuid>[.<ext>]`; the extension comes from the uploaded name
  when it is a short safe one, and is omitted otherwise. The record stores the name, the
  mime type (sanitized; unknown becomes `application/octet-stream`), the byte size and the
  vault-relative path. If the record write fails the stored file is removed again.
- ACTIVE content is refused by name before anything is written — HTML, SVG, scripts,
  executables and the like — because a vault is synced and shared and those formats render
  or run. The refusal is "That file type cannot be kept in the vault: <type>".
- The row draws a file card: an icon, the stored name, the human size, and a **Save** control
  that reads the bytes back through the vault and writes a copy to disk. A missing file says
  "That file is missing from the vault."; a row fetching it says "Loading file…".
- **Edit** changes the description and the area only; the file stays as captured. Delete is a
  soft delete and leaves the bytes in the vault, like a picture.

### A link

- A link is made by **pasting** an absolute `http` or `https` address into the box on its
  own. It becomes a chip with the host (a leading `www.` is dropped) and the full address,
  with the X button (**Remove the attached link**), and the address is stored normalized to
  what the browser would open. The field is not filled with the URL — the chip is the
  attachment, and the box stays free for the description.
- Only an address up to 2048 characters is accepted; a relative path, a `file:` address or
  plain prose pasted on its own is not a link and pastes as text. A URL pasted inside a
  sentence stays part of the description; a URL typed by hand is description text too. Paste
  the address on its own to keep it as a link card.
- The row draws it as a card at the top of the row, with the host and the address. Following
  the card hands the address to the operator's browser, not to a page inside the app. The
  app only opens `https` addresses externally, so an `http` card is kept but does nothing —
  the same policy project pages follow.
- A link capture can have no description at all. The attachment is set at capture time and
  is not edited or replaced from the edit form.

### Make task

**Make task** is the way a capture becomes board work:

- It creates a task in the Task Manager board's **Backlog** column, with `links.signalId`
  set to the signal's id, and `links.projectId` set from the capture's project when it has
  one — so a triaged capture lands in the project's collated work as well as the board.
- On success the signal moves to `status: "acting"`, because there is now work in flight
  for it. That status write is the same direct write the row's **Status** select makes.
- For a text capture the title is the first non-empty line of the body, trimmed, and cut to
  80 characters plus `...` when longer. The notes are the full body.
- When the body is empty — a picture, file or link capture logged without a description — the
  title comes from the attachment: `Link: <host>` for a link, `Image: <file name>` for a
  picture, `File: <file name>` for any other file, under the same 80-character cap plus `...`
  when longer. The notes are the URL or the file name, so the task still says what was
  captured.
- A signal has at most one live task: the row looks for a task anywhere on the board with its
  `signalId` (including **Done**), so a second click cannot create a duplicate. Deleting the
  task restores **Make task**.
- The button is disabled until the map is readable and the signal has a body or an
  attachment to name the task from.
- The new task is not placed on Daily Schedule; that remains the **Today** column's move.

See [Task Manager](./14-task-manager.md) for the board and [Projects](./12-projects.md) for
the project the task is linked to.

### The companion and the chain

The companion has the chain on its own tool surface, as the single Inbox door:

- **list_signals** (newest first, optional area, type, status and project filters) and
  **get_signal** are direct reads. The status filter is what reads the inbox: `status:
  "inbox"` is untriaged work.
- **create_signal** applies immediately, like a task write: a capture stops being a capture
  if the agent has to queue it for approval. It accepts the same triage fields the page
  writes — `projectId`, `status`, `priority`, `capturedFrom` — and the write is logged as
  `signal.created` with the actor's name.
- **update_signal** is the triage write: the id plus any of `domainSlug`, `projectId`,
  `status`, `priority`, `title` and `body`. It applies immediately, like `create_signal`,
  and is logged as `signal.updated` naming the fields changed. `null` clears an area, a
  project, a priority or a title.
- The signal types `thought`, `idea`, `notice` and `other` exist in the data model; the
  composer only creates `thought`, while the companion may choose another type.
- The companion writes text signals only: `create_signal` takes a body and no attachment, so
  a picture, file or link is captured on the page, not by the agent.

The chat dock's own **Notebox** surface reads and writes the same chain: it shows the
signals oldest-first above its composer, and its composer's placeholder is **Log a signal…**
with a **Log signal** button. It draws the same records, including the picture and link
cards, but its composer is text-only: a picture, file or link is captured on this page, not
in the dock, and a non-picture file attachment is drawn on the page's row rather than in the
dock. Its delete asks the same question. It is a convenience mirror of this page, not a
second store.

### The lens

The area lens carves the chain up without hiding unfiled captures: **Life** shows all, an
area shows unassigned + that area. This is the data-filter law — see
[`LAWS/DOMAIN-FILTER.md`](../../LAWS/DOMAIN-FILTER.md) and [Areas](./05-areas.md). Wing tabs
never filter the chain ([`LAWS/WINGS.md`](../../LAWS/WINGS.md)).

## Tips and edge cases

- The composer still has no type, title, project, status or priority field: capture first,
  triage on the row. A type or a title beyond `thought` is the companion's `create_signal`
  surface, not the quick-fire box.
- A signal with no area shows **Unassigned** on its row; that is a label, not a stored area
  slug — the file keeps `domainSlug: null`.
- "No project" and "None" are the row labels for an unfiled project and an unset priority;
  neither is a stored value. `priority: "normal"` is a real choice and shows **Normal**.
- The filter chips are a view: switching area lens or filter never rewrites a signal. A
  capture you cannot see under a filter is still on the chain.
- Editing a signal does not touch a task made from it: the task copied the text at the time
  it was made. Changing the signal's project later does not move the task.
- Deleting a signal does not delete its tasks. They keep the dangling `signalId`. Nor does it
  delete the picture or file: a soft-deleted signal leaves its bytes under
  `.lifequest/signal-chain/files/`.
- **Open task** follows the first task on the board with that signal id; if a task was
  deleted and the row shows **Make task** again, that is the expected state.
- A text capture is a single body, so a multi-line thought is fine — the first line only
  becomes a title when you make it a task. A capture with an attachment may carry no
  description; **Make task** then names itself from the attachment.
- The composer lights up while a file is dragged over it; the whole composer is the drop
  target, not only the box.
- The **plus** takes any file, but the vault keeps only some of them: pictures up to 8 MB
  (PNG, JPEG, GIF, WebP), any other file up to 25 MB, and never active content (HTML, SVG,
  scripts, executables). A refusal leaves the composer exactly as it was.
- Pasting a file or a picture into the box attaches it; pasting text still goes into the
  description; pasting one URL on its own turns it into a link chip, while a URL inside a
  sentence stays text.
- A signal written before pictures and links existed still reads as a plain text capture: a
  missing `attachment` key means the same as `null`. A signal written before the inbox
  existed still reads as `status: "inbox"` with no project, priority or origin.
- The area picker offers unlocked areas only, never the base **Life**; a capture that belongs
  to no narrower area stays unassigned and remains visible under every lens.
- The project picker offers live projects only; a capture filed under a project that was
  later deleted keeps its id, is shown by id, and can be unfiled with **No project**.
- The chain is not area-filtered at the file level: every signal carries one optional area,
  and the lens decides what you see.

## Related

- [Task Manager](./14-task-manager.md) — the board where **Make task** lands.
- [Projects](./12-projects.md) — the projects a capture can be filed under.
- [Areas](./05-areas.md) — area tags and the lens that filters the chain.
- [Decisions](./23-decisions.md) — why task, signal and triage writes do not appear here.
- [The vault](./04-the-vault.md) — where `.lifequest/signal-chain/` sits on disk.
- [Log](./26-log.md) — the `signal.created` and `signal.updated` lines a write leaves.
