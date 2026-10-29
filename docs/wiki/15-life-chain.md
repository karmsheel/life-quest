# Life-Chain

**Life-Chain** is quick-fire capture: one box, one key, and the thought is off your mind. It
is a chain of signals — thoughts, ideas, notices — kept as small JSON records in the vault,
newest at the top. You assign and edit later; the page is for getting the thing down while
you still have it.

## Where it lives

- Wing: none. Life-Chain sits on the bottom shelf of the rail, above **Decisions**.
- Rail: icon **Radio**, label **Life-Chain**.
- Route: `/chain`.
- Surface: a full page in the centre pane. The chat dock also has a Life-Chain view of
  the same chain (see below).

This page is part of the [Wiki home](./README.md).

## What it is for

Capture dies when it takes more than a keystroke. Life-Chain deliberately asks for nothing
but the text: no type picker, no title, no project, no status. A capture is not an inbox and
is never "processed"; it stays on the chain, and the one thing you can do with it later is
make a task from it. Noticing something should cost one key, not a form.

## How to use it

1. Choose **Life-Chain** in the rail. The cursor is already in the capture box, whose
   placeholder is **What's on your mind?**.
2. Type the thought. **Enter** logs it; **Shift+Enter** inserts a new line. The hint under
   the box says: `Enter to log · Shift+Enter for a new line`. Ctrl+Enter also submits.
3. Optionally choose a **Domain** before logging. The picker's first option is
   **- unassigned -**; leaving it there files the signal with no domain.
4. Press **Enter** or choose **Log**. The box clears, the domain picker resets to
   **- unassigned -**, and the new signal appears at the top of the list.
5. Work a signal in the list:
   - Change its **Domain** with the select on the row.
   - Choose the pencil button (**Edit**) to change the text and domain inline; **Save** or
     **Cancel**, and Escape cancels.
   - Choose **Make task** to create a backlog task from it.
   - Choose the bin button (**Delete**) to hide it from the chain.
6. If a signal already has a task, its **Make task** button reads **Open task** and leads to
   the Act board with that card expanded.

With nothing captured yet, the page shows: "Nothing on the chain yet. Write something
above."

## The screen

| Part | What it does |
|---|---|
| **Life-Chain** heading | The title and the line "A database of what you notice. Log now; assign later." |
| Capture box | A six-row text area labelled **Log a signal**, placeholder **What's on your mind?**, autofocused. |
| **Domain** picker | **- unassigned -** plus every live domain. Sits under the box with the **Log** button. |
| Key hint | `Enter to log · Shift+Enter for a new line`. |
| Chain list | Newest first. Each row shows the signal's body, an optional title, when it was captured, a domain select, and the row actions. |
| Timestamp | "Today, 14:32" / "Yesterday, 09:05" for recent days; an older signal shows a medium date and time. |
| Row actions | **Make task** (or **Open task**), pencil **Edit**, bin **Delete**, plus the inline **Domain** select. |
| Edit form | **Signal** textarea, **Domain** select, **Save**, **Cancel**. |
| Confirm dialog | Deleting asks first: title **Delete signal**, message "The signal is hidden from the chain. Its record and messages stay in the vault.", confirm **Delete signal**. |
| Unreadable files | If any signal file cannot be parsed: "N signal file(s) could not be read." |

The lens filters the *view*, not the capture: Overview shows every signal, and a domain lens
shows the signals tagged to that domain plus every unassigned one, because an unassigned
capture has not been filed anywhere yet and must not disappear.

## Rules and behaviour

### Capture keystrokes

Enter submits only when it is not composing text and not a held-down repeat:

- **Enter** submits the form.
- **Shift+Enter** inserts a newline instead.
- A keystroke that is part of an IME composition (`isComposing`, or the `229` key code)
  never submits, so confirming a candidate in a composition does not log a half-written
  signal.
- A key repeat from holding Enter down is ignored, so one thought cannot fire several writes.

The same composer behaviour is reused by the chat pane's own composer, so Enter sends a chat
message and Shift+Enter starts a new line there too.

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
  "domainSlug": null
}
```

- The page files every capture as type `thought`, with no title and no source reference.
- The list is sorted newest first by `createdAt`, with the id as a tie-breaker.
- Deleted records are soft-deleted: `deletedAt` is stamped, the file stays, and the chain
  stops listing it. Nothing is erased from disk by the page.
- A signal whose domain is later archived stays writable: its stored slug is shown even when
  the live domain list no longer offers it.
- The textarea is required and the body is trimmed on write; a whitespace-only capture is
  refused.

### Make task

**Make task** is the one way off the chain:

- It creates a task in the Act board's **Backlog** column, with `links.signalId` set to the
  signal's id.
- The title is the first non-empty line of the body, trimmed, and cut to 80 characters plus
  `...` when longer. The notes are the full body.
- The signal file is not written; the task points at the signal, not the other way round.
  There is no status field on the chain.
- A signal has at most one live task: the row looks for a task anywhere on the board with its
  `signalId` (including **Done**), so a second click cannot create a duplicate. Deleting the
  task restores **Make task**.
- The button is disabled until the map is readable and the body is non-empty.
- The new task is not placed on Daily Schedule; that remains the **Today** column's move.

See [Act](./14-act.md) for the board.

### The companion and the chain

The companion has the chain on its own tool surface:

- **list_signals** (newest first, optional domain and type filters) and **get_signal** are
  direct reads.
- **create_signal** applies immediately, like a task write: a capture stops being a capture
  if the agent has to queue it for approval. The write is logged as `signal.created` with the
  actor's name, so what the agent captured is visible in [Log](./26-log.md).
- The signal types `thought`, `idea`, `notice` and `other` exist in the data model; the
  composer only creates `thought`, while the companion may choose another type.

The chat dock's own Life-Chain view reads and writes the same chain: it shows the signals
oldest-first above its composer, and its capture box files an unassigned `thought`. It is a
convenience mirror of this page, not a second store.

### The lens

The domain lens carves the chain up without hiding unfiled captures: Overview shows all, a
domain shows unassigned + that domain. This is the domain-filter law — see
[`LAWS/DOMAIN-FILTER.md`](../../LAWS/DOMAIN-FILTER.md) and [Domains](./05-domains.md). Wing
tabs never filter the chain ([`LAWS/WINGS.md`](../../LAWS/WINGS.md)).

## Tips and edge cases

- There is no visible type or title field on the page. If you need a type or a title, that is
  the companion's `create_signal` surface, not the quick-fire box.
- The list is not paged and has no search. Overview is every live signal.
- Editing a signal does not touch a task made from it: the task copied the text at the time
  it was made.
- Deleting a signal does not delete its tasks. They keep the dangling `signalId`.
- **Open task** follows the first task on the board with that signal id; if a task was
  deleted and the row shows **Make task** again, that is the expected state.
- A capture is a single body, so a multi-line thought is fine — the first line only becomes a
  title when you make it a task.
- The chain is not domain-filtered at the file level: every signal carries one optional
  domain, and the lens decides what you see.

## Related

- [Act](./14-act.md) — the board where **Make task** lands.
- [Domains](./05-domains.md) — domain tags and the lens that filters the chain.
- [Decisions](./23-decisions.md) — why task and signal writes do not appear here.
- [The vault](./04-the-vault.md) — where `.lifequest/signal-chain/` sits on disk.
- [Log](./26-log.md) — the `signal.created` lines a capture writes.
