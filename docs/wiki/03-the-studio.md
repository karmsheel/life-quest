# The studio

The studio is the desktop app: one window made of three paper panes on a canvas —
the rail, the main pane and the chat dock — with the app's own title bar above
them. The title bar carries the window controls and the **area lens**, raised
into the strip as a tab painted in the page's own colour, so it reads as part of
the page below it. The rail switches wings and pages, and the chat dock keeps the
companion beside whatever you are doing. Settings and Decisions are not pages in
this layout; they are sheets drawn over it. This page explains that layout;
[the wiki home](./index.md) has the full page index.

## Where it lives

Every page after the companion gate is inside the shell: Dashboard through
Reviews, plus the governance pages. The shell is not a route — it wraps the
routes:

- The **window title bar** spans the top of the whole window, including the
  welcome and companion screens. Inside the shell it carries the **area lens tab**
  centred on the strip, between the rail's column and the trailing controls; on
  the welcome and companion screens the tab is absent.
- The **rail** is the leading column of the shell grid. Its wing band and the
  active wing's pages sit under the title bar, and its foot holds the **Log** and
  the **vault chip**.
- The **main pane** begins directly under the title bar. It has no band of its
  own; the page is the column.
- The **chat dock** is the trailing column, or the middle column when you swap
  sides.
- **Settings** (`/settings?tab=<id>`) and **Decisions** (`/decisions`) are sheets
  over the page, not pages of their own.

The window opens at 1280 × 800 by default. The app uses a hidden title bar with a
native overlay on Windows, so the title bar you see is LifeQuest's own.

## What it is for

The studio is the work surface, not a chat window with pages bolted on. The three
panes have separate jobs: the rail says where you can go, the main pane holds the
page you are on, and the dock holds the companion that can read that page. Wings
keep the rail short without hiding features, and the area lens narrows the data
in place without changing the page. Sheets let you change settings or clear
Decisions without losing the page you were reading.

The 0.2.8 shell moved three things for that reason: the wings band lives in the
rail, the lens tab holds the title bar's centre line, and the gear opens the whole
settings sheet instead of a smaller menu.

## How to use it

1. **Switch wings.** Click a wing in the rail's **wing band**, the square block
   directly under the title bar: **Home**, **Define**, **Plan**, **Act**,
   **Review**. The rail's page list changes and the app takes you to that wing's
   last page — or to the wing's default page the first time. Each wing remembers
   its last page, so returning to a wing returns you to where you were. **←** and
   **→** move between wings while the band has focus. The wing whose id is
   `execute` reads **Act**; its routes and stored question scopes are unchanged.
2. **Walk the rail.** Click a page under the active wing. **Home** holds
   Dashboard, Data, Pages, Documents, **Agents** and **Images**; **Define** holds
   Dream, Vision and Ideal State; **Plan** holds Goals, Life Map and Architecture;
   **Act** holds Projects, Daily Schedule and **Task Manager**; **Review** holds
   Daily, Weekly, Monthly, Quarterly and Yearly.
3. **Change the lens.** Choose **Life** or an unlocked area in the title bar's
   lens tab. This is the data filter for area-scoped lists (Dashboard boards,
   Data, Pages, Quick Notes and others). **←** and **→** move between lens
   options. The tab is centred on the strip and holds that centre when the rail
   collapses. With fewer than two unlocked areas it is a quiet **Life** label, not
   a control — see [Areas](./05-areas.md).
4. **Collapse and restore the rail.** Press the panel icon at the top of the rail
   (**Collapse sidebar** / **Expand sidebar**). Collapsed, the rail narrows in
   place to a 56px icon column (`3.5rem`) and the page widens; the same toggle
   stays at the top of the thin rail and turns around. The five wings stack
   vertically, the pages keep their icons and accessible names, and the chats
   list and the vault chip's label leave the column.
5. **Collapse and restore the chat.** Press the panel icon at the trailing end of
   the dock's bottom action bar (**Collapse chat**). A collapsed dock is not a
   narrow pane: it becomes one floating mark at the page's trailing corner, and
   the thread, draft and pending receipt are kept while it is hidden. Its
   accessible name is still **Open Hermes chat**.
6. **Resize the chat dock.** Drag the seam between page and dock
   (*Drag to resize the chat dock*). With the divider focused, **←** and **→**
   move it 16px per press. **Escape** during a drag cancels it and restores the
   width you had.
7. **Swap the chat's side.** Press the two-panes icon in the dock's bottom action
   bar, immediately left of the collapse control (*Move chat to the left of the
   page* / *Move chat to the right of the page*). The rail never moves; the dock
   and the page trade columns. The switch carries no pressed state — it names the
   move, not a mode.
8. **Open a sheet and leave it.** Press the gear in the title bar (a link to
   `/settings`), or open **Decisions** from the rail. Close with the cross
   (**Close settings** / **Close decisions**), a click on the dimmed background,
   or **Escape**. You return to the page, scroll position and state you left.

## The screen

The window title bar:

- The **lens tab**, centred on the strip. It is painted on the page canvas,
  flush with the window's top edge and the full height of the strip; its top
  corners are rounded and its two bottom corners flare into the page with small
  concave fillets — the rounded ends make it read as the page's own tab rather
  than a control floating in the chrome. Inside it is the area lens: a quiet
  **Life** label until a second area opens, then a segmented control with
  **Life** first. The window title is `LifeQuest — <vault name>`.
- The open room on either side of the tab is the window's drag handle — empty
  apart from the tab itself, which stays clickable — with the window controls on
  the trailing edge.
- The tab exists only while the shell is mounted: on the welcome and companion
  screens there is none. There the strip is the window's drag area, with its
  window controls when the overlay is unavailable, and with no vault the window
  title is `LifeQuest`.
- The trailing controls, for a vault window: the day/night control (*Switch to
  day mode* / *Switch to night mode*), which switches the palette on a click and
  opens the starred-theme quick menu on hover or keyboard focus; and the
  **Settings** gear, which is a plain link to the settings sheet. The gear has no
  popover and no expanded state — one press opens the whole sheet over the page
  you were on.
- When the platform overlay is unavailable, the same strip carries **Minimize**,
  **Maximize** / **Restore** and **Close** instead of drawing over the native
  frame.

The rail:

- A collapse toggle at the top (**Collapse sidebar** / **Expand sidebar**), with
  `aria-expanded` and `aria-controls="nav-rail"`.
- The five-wing band, a square block directly under the title bar. Collapsed, it
  turns vertical and all five wings stay reachable.
- The active wing's pages, each with an icon and its label.
- A divider, then the **Chats** section. Its header carries the title **Chats**
  plus a search icon (**Search chats**) and a view-options icon
  (**View options** → **Hide archived**, **Show archived**, **Only archived**).
  **New chat** sits under the search header, then pinned chats lead one flat
  list, then recent ones. Archiving and pinning are row gestures as well as menu
  commands.
- A divider, then the governance shelf: **Quick Notes**, **Decisions**, **Daily
  Journal**, **Automations**. **Decisions** wears a count of every pending
  Decision in the vault — the shelf is global governance, not lens-filtered — and
  pulses when the count grows.
- A divider, then the foot: **Log** closes the rail's navigation, and the **vault
  chip** takes the row's other half. Wide, the chip shows the vault's name and a
  caret; thin, it becomes the vault's initials under the Log icon. Clicking it
  raises the **Switch vault** dialog: every recent vault with the open one marked
  **Open now**, a note that switching loads that folder's files in place, and
  **Open another folder…** for a folder this computer has never seen. The
  version badge is not here — it lives in the dock's bottom bar.

The main pane is the page's own column, beginning directly under the title bar.
It is the element the chat reads as the current page (`data-page-context-root`),
so what the companion is told about the screen is exactly the page — never the
rail, the title bar or the chat panel. The `/chart` route opts into a full-bleed
variant for the Life Map.

The chat dock:

- The **agent switcher**, a vertical strip of agent blocks at the dock's corner.
  Pi and Hermes each wear their own mark; the active one wears the accent ring;
  an agent scoped away from the current area is absent rather than greyed.
- The **chat tabs**, drawn whenever the thread has a tab. Open chats sit in the
  strip above the thread's header, the tab in front owns the name row under them,
  and a **+** at the trailing edge is **New chat tab**. A middle click closes a
  tab and **Ctrl/Cmd+W** closes the tab in front. Right-clicking a tab opens
  **Pin**, **Rename**, **Archive** and **Delete**.
- **Pinned chats** lead the strip as squares: the label's first letter and a
  small pin, no close control. A pinned chat is durable state, so it has a tab on
  every launch; right-click offers **Unpin** only, and archive and delete wait
  until it is unpinned.
- **Archived chats** are not in the working list by default. **View options** →
  **Show archived** draws them in a greyed band tagged **Archived** below the
  live rows; **Only archived** shows the archive alone. An archived row is
  restorable from its own menu but never openable, and the dock's own tab strip
  stays live-only.
- The thread, a **Quick Notes** view, and the **Keyboard shortcuts** reference.
  The history is not a dock surface: the whole chat list lives in the rail's
  **Chats** section.
- The composer: one bordered box at the foot of the dock, the field
  (*Message Pi…* or *Message Hermes…*, depending on which companion answers) and
  a control row inside its edges — attachments and the page pill at the leading
  end, model and thinking pills and send/stop at the trailing end. Enter breaks
  the line; **Ctrl/Cmd+Enter** sends.
- The dock's bottom action bar under the composer, in order: **New chat**,
  **Quick Notes**, **Keyboard shortcuts** (opens the reference as a dock
  surface), the two-panes side switch, **Collapse chat**, and the version badge
  (**Check for updates**), which glows and gains **Update available** when a
  release is offered.
- The divider between page and dock: an invisible strip at rest, an accent bar
  under the hand or focus.

## Rules and behaviour

- The three panes abut with no gap; only the seam's hairline separates them. The
  rail's shipped width is `16rem`, its collapsed width `3.5rem` (56px at the
  default 16px root), and the dock's is `22.5rem` until you drag it.
- The dock's column is bounded: at least `300px`, at most the smaller of 70% of
  the frame and the width that leaves the page `400px`. A narrow window keeps the
  dock's floor and gives the page the squeeze. A dragged width is session state,
  re-clamped whenever the window or the rail changes.
- The composer grows with a long draft up to half the dock's height, then scrolls
  in place. The height comes out of the thread above it: the border between them
  moves up rather than the composer covering the chat. A thread read to its newest
  message keeps that message just above the composer as it grows; scrollback you
  have scrolled up to is left where it is, so growing the composer never pulls you
  away from what you were reading. Quick Notes' composer behaves the same way with
  the signals above it.
- The dock's side and width are not preferences. They reset when the app
  launches: it opens right, `22.5rem` wide. The rail starts wide too; collapsing
  it is session state, not a stored preference.
- The open chat tabs are remembered per installation (`lifequest.companion.openTabs`)
  and reconciled against the chat list on landing, so a restart brings the strip
  back. Archived or deleted chats lose their tabs; a deliberately closed strip
  stays closed.
- Wings filter the rail, never a page's data
  ([LAWS/WINGS.md](../../LAWS/WINGS.md)). Each wing's memory defaults to Home
  `/home`, Define `/dream`, Plan `/goals`, Act `/daily`, Review `/review/daily`
  until you visit a page in it.
- The area lens is the data filter for area-scoped lists; **Life** is the union
  lens, not a folder ([LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md)). The
  chosen lens is remembered per vault and restored on the next open; a saved lens
  naming a locked or archived area resolves to Life.
- Settings and Decisions are sheets because a page is not a place you should lose
  by checking a setting. Their paths keep rendering the page behind them; the
  sheet is portalled over `body`, dims and blurs the app, locks the page's scroll,
  and puts focus back on the control that opened it when it closes. A cold start
  that opens `/settings` directly has no page behind it and falls back to the
  Dashboard when closed.
- `/settings?tab=<id>` selects a tab; `/domains` redirects to
  `/settings?tab=domains`, the **Areas** tab. Tabs and labels are catalogued in
  [Settings](./28-settings.md).
- A sheet's **Escape** unwinds one step: it clears a settings search before it
  closes the sheet.
- The splash is markup painted before React and is dismissed by the shell: it
  holds for a floor of 1.5 seconds and until the first vault read finishes, then
  fades for 200ms. It does not wait for the companion.

Window-level keys:

| Key | Action |
|---|---|
| **Ctrl+R** | Reload the window |
| **F11** | Toggle fullscreen |
| **Ctrl+Q** | Quit the app |
| **Ctrl+Shift+I**, **F12** | Toggle DevTools in a development build only |

The studio's own movements — wing jumps, page walking, back/forward, the rail,
the dock and settings — are rebindable on Settings → Keyboard and listed in the
dock's **Keyboard shortcuts** reference. That reference sits in the dock's bottom
bar; it draws the same fourteen rows with a pencil on each that records a new key
in place, the same refusals as the settings page, **Unassigned** for a cleared
row, and **Back to chat** to return. The bindings and their refusals are
catalogued in [Settings](./28-settings.md).

## Tips and edge cases

- Collapsing the rail never takes it away: it narrows to its icon column, so the
  one collapse toggle stays at the top of the rail at either width. The lens tab
  holds the strip's centre line, so the room beside it grows rather than the tab
  sliding along with the rail.
- The chat's collapsed state keeps the component mounted: a streaming turn keeps
  streaming, and a draft survives a collapse. It is a hide, not a reset.
- Dragging the divider towards the page widens a left-hand dock and narrows a
  right-hand one; the pointer direction is read from the seam, so the gesture
  means "make this pane bigger" on both sides. Arrow keys follow the same rule.
- The sheet scrim closes on a press that starts on the scrim, so a drag that
  begins inside the panel and ends outside does not dismiss it.
- The day/night control is always in the strip. A theme with only one palette is
  wearable in the palette it has; when the switch asks for the other one, the
  window hands itself to the fallback theme, **Nous**, in the requested mode.
- Clicking the day/night control switches the palette immediately; hovering or
  focusing it opens the quick menu. The menu's starred grid is the same list the
  Appearance page curates, and the gear beside it only opens the sheet.
- A pinned chat cannot be archived or deleted until it is unpinned: while pinned,
  its sidebar row hides the hover archive control and its row menu loses
  **Archive** and **Delete**. The tab's own menu offers **Unpin**.
- A page-started chat — **Analyze note**, **Send to agent**, a review interview —
  opens in its own tab beside the conversation on screen rather than replacing it.
- If the window falls back to LifeQuest's own minimize/maximize/close buttons, the
  native overlay was unavailable; everything else in the title bar behaves the
  same.
- The Decisions count on the rail counts the whole vault, whichever lens you are
  standing in; the Dashboard's **Pending decisions** card is the lens-scoped view.
- The vault chip is the one control that changes vault while the studio is open.
  The Settings → Vault **Change folder…** button does the same thing from inside
  the sheet.

## Related

- [Getting started](./02-getting-started.md)
- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Companion](./24-companion.md)
- [Settings](./28-settings.md)
- [System architecture](./30-system-architecture.md)
