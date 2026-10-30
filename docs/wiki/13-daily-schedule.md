# Daily Schedule

**Daily Schedule** is the page for running today. It copies today's day template — the
Architecture **Day type** that the default week assigns to this weekday — into a live
record, and then lets you put those items, your own additions and today's Act tasks onto a
clock. You rearrange it as the day overruns or finishes early; living the day never
rewrites the plan in Architecture.

## Where it lives

- Wing: Execute. Daily Schedule is the wing's default page, so choosing **Execute**
  lands here.
- Rail: second row of the Execute wing, icon **Clock**, label **Daily Schedule**.
- Route: `/daily`.
- Surface: a full page in the centre pane. It always shows the local calendar date —
  there is no date switcher and no past-day browsing.

This page is part of the [Wiki home](./index.md).

## What it is for

The template tells you what a good Tuesday looks like; Tuesday itself never goes to plan.
Daily Schedule is the place where the plan and the day meet: untimed template items wait in
**Leftover**, you place them on the **Clock** when you know when they happen, and later
blocks move out of the way when something runs long. It also draws in the Act tasks sitting
in the **Today** column, so the board and the day are not two separate stories.

The live day is a record, not a plan: Architecture's day types and default week stay the
plan, and the live day is a copy that only exists for the date you open.

## How to use it

1. Choose **Execute**, then **Daily Schedule** in the rail. The page opens on today, as a
   date, and ensures a live day exists for it.
2. Use the template picker beside the date to choose a day type. On first open it already
   holds the type the default week gives this weekday; **None** clears the template items.
   Changing the type replaces only the untimed template rows — clock blocks, your own
   additions and task rows stay.
3. In **Leftover**, put something on the clock:
   - Choose **Place** on a leftover row or on a task row.
   - Set the start minute and duration in the two number fields, then choose **Place** to
     confirm (or **Cancel**). The defaults are the latest end on the clock — or `09:00` when
     the clock is empty — and 30 minutes.
4. Add your own untimed item at the bottom of **Leftover**: type into the field whose
   placeholder is **Add schedule item**, then choose **Add**. A row you added this way also
   has **Remove**.
5. Work the clock as the day goes:
   - Change a block's start or duration in its number fields and choose **Apply**. The
     block keeps the new time, and later blocks that would overlap are pushed forward.
   - Tick a block's **Done** checkbox when it finishes. A done block stays on the clock.
   - Choose **Unplace** to take a block off the clock. A template or added item returns to
     **Leftover** with its done state kept; a task block is removed and the task reappears
     in **Leftover** if it is still in the **Today** column.
6. Tick the checkbox on a leftover row when it is done without ever putting it on the clock.
   Done leftover rows stay where they are.

The page has no empty-state paragraph for an empty clock or an empty leftover list: an empty
day is an empty **Clock** and an empty **Leftover** list.

## The screen

| Part | What it does |
|---|---|
| **Daily Schedule** heading | The page title and today's date as text (not a control). |
| Template picker | A select with **None** and every Architecture day type by name; a dangling type id is shown as `"<id> (missing)"`. |
| **Clock** | Timed blocks, sorted by start time. Each row shows `HH:MM–HH:MM`, the text, a duration field, a start field, a **Done** checkbox, **Unplace** and **Apply**. |
| **Leftover** | Stored untimed rows (template copies and your additions) followed by today's unplaced Act tasks, which are prefixed **Task ·**. Each row has a done checkbox and **Place**; added rows also have **Remove**. |
| **Place** fields | Start minute and duration number fields with **Place** and **Cancel**, shown in the row you are placing. |
| Add row | A text field (placeholder **Add schedule item**) and **Add** at the bottom of **Leftover**. |

## Rules and behaviour

### What the day copies from Architecture

- Opening `/daily` ensures a live day for the local date. If none exists, it copies the
  items of the default week's day type for that weekday into **Leftover**, with no blocks on
  the clock. The operation is idempotent: opening the page twice does not duplicate items.
- If the weekday has no default day type, the live day starts with an empty leftover list
  and no type.
- Architecture keeps **Day types**, **Default week** and **Real week**; this page never mutates
  them. See [Architecture](./08-architecture.md).
- The live day is not drawn on [Life Map](./11-life-map.md). Life Map holds years, months
  and dated events; weeks belong to Architecture. The live day is a separate record that
  happens to live in the same map store.

### Timing and rearrangement

- Start times and durations are whole minutes, not snapped to half hours. A start must be
  zero or more; a duration must be at least one minute.
- After a place or an edit, blocks are re-sorted by start time and any later block that
  overlaps the edited one is pushed forward so it starts at the previous block's end. This
  is the "running late" behaviour: the rest of the day cascades.
- Finishing a block early does not pull the next block forward — shortening a duration only
  affects blocks that would overlap.
- An overlap with an *earlier* block is left for you to resolve.
- The cascade can push a start past midnight; the record still holds it.

### Done, tasks and the Act column

- A block sourced from a task, and a task row in **Leftover**, are the same Act task. Ticking
  one done sets that task's column to **Done**. Unticking a block does not reopen the task.
  An unplaced task row is moved to **Done** directly.
- A task that is no longer in the **Today** column disappears from the **Leftover** union.
- Tasks already placed on the clock are omitted from the **Leftover** union until unplaced.
- **Leftover** is built at read time: stored rows first, then today's unplaced tasks. The
  task rows are not written onto the live day until you place them.

### Where the state is stored, and who may write it

- The live days are stored as `liveDays`, keyed by local `YYYY-MM-DD`, inside the map store
  at `.lifequest/map.json` — next to `tasks`, not in a separate file and not in a year record.
  Past days stay on disk; the page only shows today.
- Every action writes a life-log line of type `map.liveDay.*` (`ensured`, `typeSet`,
  `adHocAdded`, `blockPlaced`, `blockUpdated`, `blockUnplaced`, `leftoverCompleted`,
  `blockCompleted`, `adHocDeleted`). See [Log](./26-log.md).
- The page is vault-global: the domain lens does not filter it, and wing tabs never filter
  page data. This is the wings law — wings switch the rail, not the data — see
  [`LAWS/WINGS.md`](../../LAWS/WINGS.md).
- Do not expect drag-and-drop or a keyboard rearrangement path here: a block's time is
  changed by typing its start and duration and choosing **Apply**. The page has no drag
  handles and no arrow-key movement between clock slots.

## Tips and edge cases

- Placing an item uses the start field as minutes from midnight, so `540` means `09:00`. The
  block's time range is shown in 24-hour `HH:MM` beside it.
- The template picker is about template rows only. If you switch types after placing blocks,
  the blocks and your added rows survive; only the copied template rows are replaced.
- If a day type was deleted, the picker shows the stored id as "(missing)" and the copied
  template rows stay until you pick another type or **None**.
- **Unplace** keeps the done state of a template or added item; a placed-and-done block
  returns to **Leftover** still done.
- Completing a task-linked row whose task has since been deleted still marks the live item
  done; the page does not throw.
- If the map cannot be read at all, the page shows the map's error instead of an empty fake
  clock. If a single command fails, the previous view stays and the error is shown beneath
  the heading.
- An agent cannot prepare tomorrow's schedule for you: there is no live-day tool on the
  companion's tool surface, and overnight fill is out of scope for the feature. Tomorrow
  becomes a live day when you open `/daily` on that date.

## Related

- [Architecture](./08-architecture.md) — the day types and default week the live day copies
  from, and the real week it leaves alone.
- [Act](./14-act.md) — the **Today** column that appears in **Leftover**.
- [Life Map](./11-life-map.md) — the calendar the live day is deliberately not drawn on.
- [Log](./26-log.md) — the `map.liveDay.*` entries each action writes.
- [The studio](./03-the-studio.md) — wings, the rail and the three panes.
