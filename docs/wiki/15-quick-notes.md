# Quick Notes

**Quick Notes** is quick-fire capture: one box, one key, and the thing is off your mind. It
is a chain of signals — a thought, a picture, a link — kept as small JSON records in the
vault, newest at the top. You assign and edit later; the page is for getting the thing down
while you still have it.

## Where it lives

- Wing: none. Quick Notes sits on the bottom shelf of the rail, above **Decisions**.
- Rail: icon **Radio**, label **Quick Notes**.
- Route: `/chain`. The route and file names did not change when the page was renamed from
  Life-Chain.
- Surface: a full page in the centre pane. The chat dock also has a **Quick Notes** surface
  of the same chain (see below).

This page is part of the [Wiki home](./index.md).

## What it is for

Capture dies when it takes more than a keystroke. Quick Notes deliberately asks for little
more than the capture: a description, an optional **Image** or **Link**, and an optional
**Area**. There is no type picker, no title, no project, no status. A capture is not an
inbox and is never "processed"; it stays on the chain, and the one thing you can do with it
later is make a task from it.

The one box takes three kinds of capture:

- **Text** — the description is the capture, and logging it is one keystroke.
- **A picture** — picked, dragged or pasted, previewed before it is logged, with an optional
  description.
- **A link** — an absolute web address with an optional description.

A capture carries at most one attachment: choosing a link while a picture is attached
replaces the picture, and choosing a picture while a link is attached replaces the link,
before the capture is logged.

## How to use it

1. Choose **Quick Notes** in the rail. The cursor is already in the capture box, whose
   placeholder is **What's on your mind?**.
2. Type the description. **Enter** logs it; **Shift+Enter** inserts a new line. The hint
   under the box says: `Enter to log · Shift+Enter for a new line · drop or paste a picture`.
3. To log a picture, choose **Image**, drag a file onto the composer, or paste a picture into
   the box. The picture previews above the box with its file name and the line "It will be
   kept in the vault with this capture."; the X button (**Remove the attached image**) takes
   it off. The description may be left empty.
4. To log a link, choose **Link**; a URL field opens under the box. Type or paste an absolute
   `http` or `https` address and choose **Add link** — **Enter** in the field does the same.
   The address previews as a chip with its host and the full address; the X button
   (**Remove the attached link**) takes it off. The description may be left empty.
5. Optionally choose an **Area** before logging. The picker's first option is
   **- unassigned -**; leaving it there files the signal with no area.
6. Press **Enter** or choose **Log**. The box clears, the area picker resets to
   **- unassigned -**, the preview drops, and the new signal appears at the top of the list.
7. Work a signal in the list:
   - Change its **Area** with the select on the row.
   - Choose the pencil button (**Edit**) to change its **Description** and **Area** inline;
     **Save** or **Cancel**, and Escape cancels. A picture or link cannot be replaced from
     the edit form.
   - Choose **Make task** to create a backlog task from it.
   - Choose the bin button (**Delete**) to hide it from the chain.
8. If a signal already has a task, its **Make task** button reads **Open task** and leads to
   the Task Manager board with that card expanded.

With nothing captured yet, the page shows: "Nothing on the chain yet. Write something
above."

## The screen

| Part | What it does |
|---|---|
| **Quick Notes** heading | The title and the line "A database of what you notice. Log now; assign later." |
| Capture box | A six-row text area labelled **Log a signal**, placeholder **What's on your mind?**, autofocused. It is the description: a text capture needs text, and a picture or link may be logged without it. |
| **Image** control | A control labelled **Image** (accessible name **Attach an image**, title "Attach an image — or drop or paste one"). Opens a file picker for PNG, JPEG, GIF or WebP up to 8 MB; dragging a file onto the composer and pasting a picture into the box do the same. Disabled while a link is attached. |
| Picture preview | Above the box until the signal is logged: the chosen picture, its file name, the line "It will be kept in the vault with this capture.", and the X button **Remove the attached image**. |
| **Link** control | A control labelled **Link** (accessible name **Attach a link**, title "Keep a link with a description"). Opens a one-line URL field labelled **Link URL**, placeholder `https://…`, with **Add link** and **Cancel**; **Enter** in the field adds the address too. Disabled while a link or picture is attached. |
| Link chip | Under the box until the signal is logged: the link's host and the full address, with the X button **Remove the attached link**. |
| **Area** picker | **- unassigned -** plus every unlocked area (never the base **Life**). Sits under the box with the **Log** button, which is disabled until there is a description or an attachment. |
| Key hint | `Enter to log · Shift+Enter for a new line · drop or paste a picture`. |
| Chain list | Newest first. Each row shows its attachment, the signal's title and body when it has one, when it was captured, an area select, and the row actions. |
| Attachment | An image draws at the top of the row with its file name beneath it; a link draws a card at the top of the row with its host and address. The link card opens `https` addresses in the browser. |
| Timestamp | "Today, 14:32" / "Yesterday, 09:05" for recent days; an older signal shows a medium date and time. |
| Row actions | **Make task** (or **Open task**), pencil **Edit**, bin **Delete**, plus the inline **Area** select. |
| Edit form | **Description** textarea, **Area** select, **Save**, **Cancel**. Editing changes the description and area only; a picture or link stays as captured. |
| Confirm dialog | Deleting asks first: title **Delete signal**, message "The signal is hidden from the chain. Its record and messages stay in the vault.", confirm **Delete signal**. |
| Unreadable files | If any signal file cannot be parsed: "N signal file(s) could not be read." |
| Missing picture | A picture whose file has gone still holds its row: "That picture is missing from the vault." |

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

The page's own composer is the Quick Notes gesture. The chat composer is different now: in
chat, **Enter** breaks the line and **Ctrl/Cmd+Enter** sends, so Quick Notes is the one place
where the plain key logs.

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
  "attachment": null
}
```

- `attachment` is `null` for a text capture. A picture stores
  `{ "kind": "image", "relPath": ".lifequest/signal-chain/files/<uuid>.<ext>", "name": "desk-lamp.png", "mime": "image/png", "width": 640, "height": 480 }`
  (width and height may be `null` when the machine could not decode the canvas); a link
  stores `{ "kind": "link", "url": "https://…" }`.
- The description is the body. A text-only capture needs a non-empty body; a picture or
  link capture may store an empty one, because the attachment says what was captured. The
  vault's refusal for neither is "A capture needs text, an image or a link".
- The area is stored as `domainSlug` (the field kept its old name); `null` is unassigned.
- The page files every capture as type `thought`, with no title and no source reference.
- The list is sorted newest first by `createdAt`, with the id as a tie-breaker.
- Deleted records are soft-deleted: `deletedAt` is stamped, the file stays, and the chain
  stops listing it. Nothing is erased from disk by the page.
- A signal whose area is later archived stays writable: its stored slug is shown even when
  the live area list no longer offers it.
- The textarea is trimmed on write; a whitespace-only capture is refused when there is no
  attachment.

### A picture

- Pick it with **Image**, drag a file onto the composer, or paste a picture into the box.
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

### A link

- **Link** opens a one-line URL field with **Add link**; **Enter** in the field adds the
  address too, and **Cancel** closes the field. Only an absolute `http` or `https` address up
  to 2048 characters is accepted; a relative path, a `file:` address or plain prose is
  refused under the field with "Links must be an absolute http or https URL." and an address
  over 2048 characters with "That link is too long to keep." — and no signal is written.
- A valid address previews as a chip under the box: the host (a leading `www.` is dropped)
  and the full address, with the X button (**Remove the attached link**). The address is
  stored normalized to what the browser would open.
- The row draws it as a card at the top of the row, with the host and the address. Following
  the card hands the address to the operator's browser, not to a page inside the app. The
  app only opens `https` addresses externally, so an `http` card is kept but does nothing —
  the same policy project pages follow.
- A link capture can have no description at all. The attachment is set at capture time and
  is not edited or replaced from the edit form.

### Make task

**Make task** is the one way off the chain:

- It creates a task in the Task Manager board's **Backlog** column, with `links.signalId`
  set to the signal's id.
- For a text capture the title is the first non-empty line of the body, trimmed, and cut to
  80 characters plus `...` when longer. The notes are the full body.
- When the body is empty — a picture or link capture logged without a description — the
  title comes from the attachment: `Link: <host>` for a link, `Image: <file name>` for a
  picture, under the same 80-character cap plus `...` when longer. The notes are the URL or
  the file name, so the task still says what was captured.
- The signal file is not written; the task points at the signal, not the other way round.
  There is no status field on the chain.
- A signal has at most one live task: the row looks for a task anywhere on the board with its
  `signalId` (including **Done**), so a second click cannot create a duplicate. Deleting the
  task restores **Make task**.
- The button is disabled until the map is readable and the signal has a body or an
  attachment to name the task from.
- The new task is not placed on Daily Schedule; that remains the **Today** column's move.

See [Task Manager](./14-task-manager.md) for the board.

### The companion and the chain

The companion has the chain on its own tool surface:

- **list_signals** (newest first, optional area and type filters) and **get_signal** are
  direct reads.
- **create_signal** applies immediately, like a task write: a capture stops being a capture
  if the agent has to queue it for approval. The write is logged as `signal.created` with the
  actor's name, so what the agent captured is visible in [Log](./26-log.md).
- The signal types `thought`, `idea`, `notice` and `other` exist in the data model; the
  composer only creates `thought`, while the companion may choose another type.
- The companion writes text signals only: `create_signal` takes a body and no attachment, so
  a picture or link is captured on the page, not by the agent.

The chat dock's own **Quick Notes** surface reads and writes the same chain: it shows the
signals oldest-first above its composer, and its composer's placeholder is **Log a signal…**
with a **Log signal** button. It draws the same records, a picture and a link card included,
but its composer is text-only: a picture or link is captured on this page, not in the dock.
Its delete asks the same question. It is a convenience mirror of this page, not a second
store.

### The lens

The area lens carves the chain up without hiding unfiled captures: **Life** shows all, an
area shows unassigned + that area. This is the data-filter law — see
[`LAWS/DOMAIN-FILTER.md`](../../LAWS/DOMAIN-FILTER.md) and [Areas](./05-areas.md). Wing tabs
never filter the chain ([`LAWS/WINGS.md`](../../LAWS/WINGS.md)).

## Tips and edge cases

- There is no visible type or title field on the page. If you need a type or a title, that is
  the companion's `create_signal` surface, not the quick-fire box.
- Editing a signal does not touch a task made from it: the task copied the text at the time
  it was made.
- Deleting a signal does not delete its tasks. They keep the dangling `signalId`. Nor does it
  delete the picture file: a soft-deleted signal leaves its bytes under
  `.lifequest/signal-chain/files/`.
- **Open task** follows the first task on the board with that signal id; if a task was
  deleted and the row shows **Make task** again, that is the expected state.
- A text capture is a single body, so a multi-line thought is fine — the first line only
  becomes a title when you make it a task. A picture or link capture may carry no
  description; **Make task** then names itself from the attachment.
- The composer lights up while a file is dragged over it; the whole composer is the drop
  target, not only the box.
- A dropped file that is not PNG, JPEG, GIF or WebP, an empty file, or one over 8 MB is
  refused with a message, and the composer keeps what it had.
- Pasting a picture into the box attaches it; pasting text still goes into the description.
- A signal written before pictures and links existed still reads as a plain text capture: a
  missing `attachment` key means the same as `null`.
- The area picker offers unlocked areas only, never the base **Life**; a capture that belongs
  to no narrower area stays unassigned and remains visible under every lens.
- The chain is not area-filtered at the file level: every signal carries one optional area,
  and the lens decides what you see.

## Related

- [Task Manager](./14-task-manager.md) — the board where **Make task** lands.
- [Areas](./05-areas.md) — area tags and the lens that filters the chain.
- [Decisions](./23-decisions.md) — why task and signal writes do not appear here.
- [The vault](./04-the-vault.md) — where `.lifequest/signal-chain/` sits on disk.
- [Log](./26-log.md) — the `signal.created` lines a capture writes.
