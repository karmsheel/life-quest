# Architecture

Architecture is the page that defines how a year's weeks are shaped. It holds the Strategy (How) document for each domain and three planning surfaces: **Day types** (named templates with a colour and a checklist), the **Default week** (which day type each weekday inherits), and **Real week** (a chosen week of the selected year, inherited from the default or detached and edited). It is the Plan wing's template editor, and its Default week is what the Daily Schedule copies into today.

Architecture plans the week; it does not record the day. The live day belongs to [Daily Schedule](./13-daily-schedule.md). The year's events and months belong to the [Life Map](./11-life-map.md). Both pages share one selected year and one map file.

## Where it lives

- Plan wing, rail label **Architecture**, icon Target, route `/track`.
- The Strategy (How) editor opens at `/track/:slug/how`; the index lists every live domain and links there.
- Page, not a sheet. It is the only place day types, the default week, and real weeks are edited.
- A **Year** selector sits in the page header, next to the heading **Architecture**. It shares its selection with the [Life Map](./11-life-map.md): picking a year on one page opens the other on the same year.

Return to [Wiki home](./README.md).

## What it is for

A weekday is not one thing. Monday may be a deep-work day with a long checklist, Saturday a recovery day with almost nothing on it. Architecture lets you name those day types once, decide which type each weekday normally inherits, and then adjust a particular week without changing the default. The plan is deliberately separate from the execution: editing a template never rewires a day you have already lived, and the Life Map's archive keeps the plan a year actually ran on.

## How to use it

1. Open **Architecture** from the Plan rail. The page loads the selected year and, if that year is archived, shows **Read-only archive** and disables the editing controls.
2. Use the **Year** selector to change the year. Years are labelled `YYYY`; archived years carry `(archive)` after the year. Creating or deleting a year is done on the **Life Map**, not here.
3. To edit a domain's Strategy (How), click it in the list under the header. The list has one row per live domain labelled **Strategy (How)** with a **Locked** or **Unlocked** badge. The editor is the doctrine editor described in [Doctrine](./07-doctrine.md).
4. To create a day type, go to **Day types**, type a name under **New type**, choose one of the eight colour swatches, and click **Create**.
5. To change a day type, edit its **Name** (it commits when the field loses focus), click a colour swatch, or use its **Checklist**: type in the field at the bottom, click **Add**, reorder with **Up** and **Down**, and remove a row with **Remove**.
6. To delete a day type, click **Delete** on its card. If no week uses it, it goes immediately. If the default week or a live detached week still uses it, the card asks you to pick a **Replacement** and then click **Replace and delete**.
7. To set the normal week, go to **Default week** and choose a day type (or **None**) for each of **Monday** through **Sunday**. Add recurring untimed items under **Weekly-only items**.
8. To plan one specific week, go to **Real week**, choose a week in the **Week** selector (options read `YYYY-MM-DD – YYYY-MM-DD`), and change a day's type or its items. The first change detaches the week: the badge turns from **Inheriting** to **Detached**, and priority tags become editable.
9. To put an item on a clock, use **Place item** above the **Hourly grid**, choose an item, then click a slot. Click an occupied block to clear it; clearing removes the block, not the item.
10. To undo all changes to one week, click **Reset to default** while the week is detached. The week reattaches to the default and the button disappears.

Empty states: **No day types yet.** under Day types, **No items.** in a checklist with no rows, and **No weekly items.** under Weekly-only items.

## The screen

| Part | What it is |
|---|---|
| Heading and **Year** selector | The page name and the year every panel below reads |
| **Read-only archive** banner | Shown for an archived year; every edit control is disabled and the panels read that year's frozen snapshot |
| Strategy (How) list | One row per live domain, filtered by the domain lens, linking to the doctrine editor |
| **Day types** | The shared library: name, colour, checklist, delete |
| **Default week** | Seven weekday selects plus the weekly-only item list |
| **Real week** | Week picker, **Inheriting**/**Detached** badge, **Reset to default**, **Events this week**, seven day columns, weekly-only items, and the hourly grid |

Loading shows **Loading map…**; a map that cannot be read shows the vault's error instead of the panels.

**Day types panel.** A new type is made in the **New type** form: a name field, a swatch row (aria labels `gold`, `red`, `blue`, `green`, `orange`, `purple`, `teal`, `pink`), and **Create**. Each existing type is a card with a colour swatch, a **Name** field, a swatch row for its own colour, a **Delete** button, and a **Checklist**. The checklist has an **Add** row at the bottom, and every item has **Up**, **Down**, and **Remove** buttons. The whole library is shared by every live year.

**Default week panel.** Seven labelled selects, **Monday** through **Sunday**, each holding **None** plus the current day types. Beneath them, **Weekly-only items** is a checklist that repeats every week without belonging to a particular weekday.

**Real week panel.** The toolbar has a **Week** select whose options are the Mondays of the selected year, each labelled with its Monday–Sunday range, a state badge, and the **Reset to default** button when detached. **Events this week** lists the events that fall inside the chosen week, each with a domain colour mark. The seven day columns each show a day-type select and that day's item list. The **Hourly grid** is a seven-column, 06:00–22:00 slot grid with a **Place item** select above it.

## Rules and behaviour

**Where it is stored.** All of this lives in `.lifequest/map.json`, beside the tasks, live days, and years. The file carries the template data and the year records together:

| Field | Holds |
|---|---|
| `dayTypes` | Every day type: id, name, colour, checklist items |
| `defaultWeek` | The seven weekday assignments and the weekly-only items |
| `years[].detachedWeeks` | Every week that has been detached, keyed by its Monday date |
| `years[].snapshot` | An archived year's frozen day types, default week, and materialised weeks |

`dayTypes` and `defaultWeek` are vault-wide, not year-scoped; each year record holds its own `detachedWeeks`. There is no save button: every control applies its change immediately as a map command and the page refreshes from the vault.

**Inheriting versus detached.** A week you have never edited is inherited: it is drawn from the default week plus each day type's checklist, and its priority tags are fixed. Editing any part of a week copies the inherited week into that year's `detachedWeeks` first; from then on it is a full week of its own. **Reset to default** deletes that copy, so the week inherits again. The badge reads **Inheriting** or **Detached** and says which state you are in.

| Week state | What it shows | What you can do |
|---|---|---|
| **Inheriting** | The default week's types and each type's checklist, with no priority tags | Change a type or an item; the first edit detaches it |
| **Detached** | The week's own copy of types, items, tags, and grid | Edit freely, or **Reset to default** |
| Archived year | The year's frozen snapshot of both | Read only; no controls |

**What the vault refuses.** The page surfaces these errors inline rather than silently changing a week:

- Writing to an archived year fails with `Archive is read-only`.
- A grid start must be a 30-minute slot from 06:00 to 21:30, and a block must end by 22:00.
- A day type that is still in use cannot be deleted; the replacement is required first.
- An unknown day type id, weekday, or week Monday is rejected rather than stored.
- The archive banner is not a lock and cannot be turned off; only the Life Map can delete an archive.

**Priority tags.** A detached week can tag each item **required**, **semi-optional**, or **optional**. New items entered in a real week start **optional**. Inherited weeks do not show the tags because inheritance fixes them as optional until you detach.

**Day type deletion.** A type that the default week or any live detached week still uses cannot be deleted without a replacement. The replacement is written into both the default week and every live detached week before the type is removed. Archived years are frozen and do not block deletion. If there is no other type to replace it with, the card says `Reassign the default week and live detached weeks first.`

**The hourly grid.** The grid covers **06:00–22:00** in 30-minute slots. An item may be placed once per weekday; placing it again moves it. Blocks must start on a slot and end by 22:00, and clearing a block does not delete the item it came from. An inherited week shows an empty grid; placing the first block detaches the week.

**Archived years.** An archived year is read-only everywhere: day types, default week, day columns, priority tags, and the grid all come from the year's snapshot, frozen the first time the vault is opened in a later calendar year. Nothing on this page can change an archive.

**The domain lens.** Architecture's templates are vault-global. The lens filters only the Strategy (How) list and the **Events this week** list; it never hides a day type or a weekday. That matches the filter law: the domain switcher filters domain-scoped lists, not a page's own furniture. See [LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md) and [LAWS/WINGS.md](../../LAWS/WINGS.md).

**How this feeds the Daily Schedule.** When you open [Daily Schedule](./13-daily-schedule.md) for the first time on a date, the vault copies the weekday's **Default week** day type into that day's leftover list, with one row per checklist item, and records the type on the live day. Changing the type in Daily Schedule re-copies template items only; the clock, ad-hoc rows, and task blocks stay. **Weekly-only items are never copied.** The **Real week** is a plan, not the source of the live day: editing a real week does not rewrite a day you have already opened.

**The law.** Two laws apply here. The wings are a navigation grouping and must not filter a page's data (the templates are not domain data), and the domain switcher is the filter for domain-scoped lists. Read [LAWS/WINGS.md](../../LAWS/WINGS.md) and [LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md).

**Agents.** An agent's change to a day type or the default week is filed as a pending Decision with the kind chip **Day template** and does not touch the map file until you **Approve**. An agent's edit to a real week or the live week applies directly as a map write, like other week data. Reads need no approval.

## Tips and edge cases

- **A year must exist before it shows here.** Architecture cannot create one. Add the current year and up to two future years on the Life Map; the vault also ensures the current calendar year exists when it opens.
- **Renaming a day type does not move history.** The stored week references the type by id, so renaming is safe; changing its checklist only affects weeks that inherit it, not weeks already detached.
- **Deleting a used type can silently reshape weeks.** The replacement flow rewrites every live detached week that referenced the old type, so check the replacement before confirming.
- **The weekly-only items do not reach the day.** They are a weekly checklist, not a source of daily rows; the Daily Schedule deliberately copies only the day type's checklist.
- **The page and the Life Map agree on the year.** Pick 2027 here, open the Life Map, and it is on 2027; the choice is session state, not a vault setting.
- **There is no copy-week control.** Weeks cannot be duplicated; repeat a plan by editing each week, or change the default week so untouched weeks inherit it.
- **The hourly grid is a plan sketch, not a schedule.** It never writes to the Daily Schedule or the Act board; the live day is built separately.
- **Checklist edits reach inherited weeks, not detached ones.** A detached week keeps the copy it took, so changing the type later does not rewrite it.
- **Every week detaches on its own.** Editing one week does not detach the others, and each week carries its own items, tags, and grid.
- **Week items are text, not tasks.** A checklist row here is a plan line with a priority, not an Act task; a task can link to a week item from the Act board, but the row itself is not a task.
- **Archive read-only is not a lock.** There is no unlock: archived years are historical and only **Delete archive** on the Life Map removes one.

## Related

- [Wiki home](./README.md)
- [Doctrine](./07-doctrine.md)
- [Goals](./10-goals.md)
- [Life Map](./11-life-map.md)
- [Daily Schedule](./13-daily-schedule.md)
- [Decisions](./23-decisions.md)
