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
  the welcome and companion screens the tab is absent. The trailing cluster is
  the **layouts** control, the day/night control and the **Settings** gear;
  full-screen chat's door is the dock's bottom action bar, beside the Notebox,
  not the strip, and the layouts picker offers the same mode as its **Full
  agent** card.
- The **rail** is the leading column of the shell grid. Its header carries the
  lockup and the build number, its wing band and the active wing's pages sit
  under the title bar, and its foot holds the **Log**, the **vault chip** and the
  collapse toggle.
- The **main pane** begins directly under the title bar. It has no band of its
  own; the page is the column.
- The **chat dock** is the trailing column, or the middle column when you swap
  sides. **Full screen chat** in its bottom action bar, immediately after the
  **Notebox**, collapses the main page and gives the dock the workspace to the
  right of the rail; the rail and its chats list stay. The layouts picker can
  also give the page and the dock **half the window each**, in either order,
  without moving the rail.
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
   Data, Pages, Notebox and others). **←** and **→** move between lens
   options. The tab is centred on the strip and holds that centre when the rail
   collapses. With fewer than two unlocked areas it is a quiet **Life** label, not
   a control — see [Areas](./05-areas.md).
4. **Collapse and restore the rail.** Press the panel icon at the foot of the rail
   (**Collapse sidebar** / **Expand sidebar**), at the bottom trailing corner
   beside the vault chip — or press the centred **LifeQuest lockup** in the
   header, which is the same control. Collapsed, the rail narrows in place to a
   56px icon column (`3.5rem`) and the page widens; the panel icon moves up to
   the top of the thin column and turns around as the pure Q emblem, so the way
   back is the first thing in it. The five wings stack vertically, the pages keep
   their icons and accessible names, and the chats list and the vault chip's
   label leave the column.
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
8. **Go full screen with the chat.** Press **Full screen chat** in the dock's
   bottom action bar, next to the **Notebox** icon. The main page collapses, the
   chat takes the workspace right of the
   rail, and the rail with its **Chats** list stays; the control now reads **Exit
   full screen chat**. **Mod+Shift+F** toggles the same mode from anywhere. The
   mode is session state, not a preference: relaunching brings the two-pane
   window back, and collapsing the dock leaves the mode and returns the page and
   launcher. It also lies over whichever layout the window is wearing rather
   than replacing it: leaving the mode puts back the split, or the studio, you
   were in, on the same boxes.
9. **Arrange the window.** Press the **layouts** control in the title bar, just
   before the day/night control: a small picker opens over the workspace with
   four thumbnails, and the one in force is ticked.
   - **Studio** — the shipped studio, with the dock back at its own width.
   - **Page · Agent** — an even split: the page on the left, the agent on the
     right, half the window each.
   - **Agent · Page** — the same even split with the panes swapped.
   - **Full agent** — the agent alone, exactly as **Full screen chat** does; the
     card and the dock's own control are one state, so pressing either moves the
     tick in the picker.

   Picking a card applies it and closes the picker. The split is real geometry,
   not a remembered width: it stays a half each when the window is resized or the
   rail collapsed, and the seam's drag handle is withdrawn while it is on (the
   **Studio** card brings it back, with the width you had). While split, the
   dock's own swap control trades the two split cards; collapsing the dock
   returns the studio arrangement. **Full agent** is the dock's own full-screen
   mode, not a lookalike: picked from a split it lies over the split, and leaving
   the mode (the dock's control or **Mod+Shift+F**) returns you to the split on
   the same boxes. The picker closes on a press outside it, on **Escape**, and on
   a second press of the control.
10. **Open a sheet and leave it.** Press the gear in the title bar (a link to
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
- The trailing controls, for a vault window: the **layouts** control
  (*Layouts*), which opens the four-arrangement picker — **Studio**,
  **Page · Agent**, **Agent · Page** and **Full agent** — with a thumbnail of
  each and a tick on the one in force; then the day/night control (*Switch to
  day mode* / *Switch to night mode*), which switches the palette on a click and
  opens the starred-theme quick menu on hover or keyboard focus; then the
  **Settings** gear, which is a plain link to the settings sheet. The gear has no
  popover and no expanded state — one press opens the whole sheet over the page
  you were on. The strip's layouts picker and the dock's **Full screen chat**
  control are one state, not two: either door moves the picker's tick and the
  other control's pressed state, and **Mod+Shift+F** toggles it from anywhere.
  The full-screen door itself lives in the dock's bottom action bar.
- When the platform overlay is unavailable, the same strip carries **Minimize**,
  **Maximize** / **Restore** and **Close** instead of drawing over the native
  frame.

The rail:

- The **LifeQuest lockup**, centred in the rail's header row and held one
  rail-content inset below the window's top edge, with the same measure again
  below the build number before the wing band. The active logo is **Minimal** by
  default, and any of **Modern**, **Athletic**, **Classic** or **Minimal** from
  Settings → Developer. It is drawn from the shipped art, with the art's two
  short flanking rules left unpainted — the lockup reads LIFE · Q · UEST, no
  dashes; its three inks (LIFE, the Q emblem, UEST) are theme colours, so the
  lockup follows the active theme and the day/night palette instead of carrying
  one fixed picture. The mark is a control as well: a press on it collapses the
  rail, exactly as the foot's panel icon does (**Collapse sidebar** / **Expand
  sidebar**). The pointer is its only hover cue — no fill behind it and no
  tooltip. The air around the mark — and the rest of the strip beside it — stays
  the window's drag handle.
- The **build number** (`v0.3.4`), centred directly under the lockup in the
  header: the app's one manual update door. It glows when a newer release exists,
  with **Update available** beside it while the rail is wide enough for the
  words; clicking it opens the update dialog. The thin rail retires the number
  with the words — expand the sidebar to read it.
- A collapse toggle (**Collapse sidebar** / **Expand sidebar**), with
  `aria-expanded` and `aria-controls="nav-rail"`. Wide, it is the square at the
  trailing end of the foot's one row, immediately right of the vault chip;
  collapsed, it moves to the top of the 56px column, because the way back
  belongs where the column starts rather than under its rows. It and the centred
  lockup share one collapsed state, so the two doors can never disagree.
  Collapsed, the column has no room for a word: the lockup leaves with its button
  and the control becomes the pure Q emblem (**Expand sidebar**), which reopens
  the rail on a press.
- The five-wing band, a square block under the header row. It keeps its 44px but
  follows the lockup's inset down the rail, so it is no longer level with the
  title bar; its frame is the block's one outline, and the selected wing is
  marked by its raised fill, not by a second line inside the frame. Collapsed,
  the band turns vertical and all five wings stay reachable.
- The active wing's pages, each with an icon and its label.
- A divider, then the **Chats** section. Its header carries the title **Chats**
  plus a search icon (**Search chats**) and a view-options icon
  (**View options** → **Hide archived**, **Show archived**, **Only archived**).
  **New chat** sits under the search header, then pinned chats lead one flat
  list, then recent ones. Each row starts with its chat's mark — the quiet status
  mark, or the icon of what started the chat — before the name and time.
  Archiving and pinning are row gestures as well as menu commands.
- A divider, then the governance shelf: **Notebox**, **Decisions**, **Daily
  Journal**, **Automations**. **Decisions** wears a count of every pending
  Decision in the vault — the shelf is global governance, not lens-filtered — and
  pulses when the count grows.
- A divider, then the foot, in one row: **Log** on the left, the **vault chip**
  naming the workspace, and the sidebar's collapse toggle at the trailing corner
  immediately right of the chip. Wide, the chip shows the vault's name and a
  caret; thin, the row stacks — the Log's icon and the vault's initials — and the
  expand emblem moves up to the topband, where the way back belongs. Clicking the
  chip raises the **Switch vault** dialog: every recent vault with the open one
  marked **Open now**, a note that switching loads that folder's files in place,
  and **Open another folder…** for a folder this computer has never seen.

The rail's three dividers — above **Chats**, above the governance shelf, and above
the foot — are the app's own line rather than a theme ink: each is a crisp 1px of
neutral gray, light by day (`#c8c8c8`) and darker at night (`#3a3a3a`), and the
pair is identical in every theme, so the sidebar's groups are separated the same
way whichever palette you wear. The line is drawn as a hairline border rather than
a filled block, so it stays a single device pixel on a scaled display: at 125% or
150% Windows scaling a fill could cover two rows on some lines and one on others,
which is what made the three look uneven. A theme's palette colours surfaces and
its own borders; it cannot tint these.

The main pane is the page's own column, beginning directly under the title bar.
It is the element the chat reads as the current page (`data-page-context-root`),
so what the companion is told about the screen is exactly the page — never the
rail, the title bar or the chat panel. The `/chart` route opts into a full-bleed
variant for the Life Map.

The chat dock:

- The **agent switcher**, a vertical strip of agent blocks in the composer's
  trailing margin: in the empty gutter beside the composer when the dock is wide,
  and just above the composer box when the dock is too narrow to hold that
  gutter. Pi and Hermes each wear their own mark; the active one wears the accent
  ring; an agent scoped away from the current area is absent rather than greyed.
- The **chat tabs**, drawn whenever the thread has a tab. Open chats sit in the
  strip above the chat's name; the name in front hangs under them as plain
  neutral-gray text with no box and no pencil, and the whole name is the **Rename
  chat** target — a click opens the rename field in place, a click anywhere
  outside it or **Enter** saves, and **Escape** cancels and keeps the old name. A
  tab leads with a small mark: a status mark that is invisible at rest and shows
  as a pulsing dot while the chat works or an accent ring while it waits on an
  approval, or — for a chat the app started rather than the operator — a small
  icon for what started it, chosen from a task handed over with **Send to
  agent**, a review interview, a planning session or an automation run, and
  remembered with the chat. Each tab takes the width of its chat's name — up to
  about three or four words — rather than stretching or being cut short while the
  strip has room; only when the strip fills do the tabs compress, labels
  truncating toward a floor of about three characters of the name and an
  ellipsis beside that mark and its close control. Once they are all at the floor
  the strip stops squeezing and scrolls sideways, moved by the wheel or its own
  thin scrollbar, and the tab that comes in front is scrolled into view. A **+** immediately after the last tab is **New chat tab** —
  the plus sits where the next tab will appear, not on the strip's trailing edge.
  A middle click closes a tab and **Ctrl/Cmd+W** closes the tab in front.
  **Ctrl+Tab** steps to the next tab and **Ctrl+Shift+Tab** to the previous one,
  in the order the strip draws them and wrapping at both ends; the keys work with
  the caret in the composer, the way a browser's tab keys work wherever you are.
  They are Ctrl on every platform, Cmd+Tab being the macOS app switcher. Right-clicking a tab opens **Pin**, **Rename**, **Archive**
  and **Delete**.
- **Pinned chats** lead the strip: a pinned tab leads with the pin in the slot a
  plain tab spends on its status mark, then wears the chat's name like any other
  tab, with no close control. A pinned chat is durable state, so it has a tab on
  every launch; right-click offers **Unpin** only, and archive and delete wait
  until it is unpinned.
- **Archived chats** are not in the working list by default. **View options** →
  **Show archived** draws them in a greyed band tagged **Archived** below the
  live rows; **Only archived** shows the archive alone. An archived row is
  restorable from its own menu but never openable, and the dock's own tab strip
  stays live-only.
- The dock's **bottom action bar** leads with **New chat**, the **Notebox** and
  **Full screen chat** / **Exit full screen chat**. Choosing the last collapses
  the main page and gives the dock the workspace right of the rail;
  **Mod+Shift+F** does the same from anywhere. It is the window's only
  full-screen control; while the mode is on its glyph turns around to the
  minimize pair, but the slot keeps the bar's resting look rather than lighting
  up as a selected surface. The bar is a card at its own fixed width, centred on
  the composer box — a wider field does not stretch it, and it never reaches past
  the field it belongs to — floating with a margin on every side and softly
  rounded, in the split dock and in full screen alike.
- The thread, a **Notebox** view, and the **Keyboard shortcuts** reference.
  The history is not a dock surface: the whole chat list lives in the rail's
  **Chats** section.
- The composer: one bordered box at the foot of the dock, the field
  (*Message Pi…* or *Message Hermes…*, depending on which companion answers) and
  a control row inside its edges — attachments and the page pill at the leading
  end, model and thinking pills and send/stop at the trailing end. Enter breaks
  the line; **Ctrl/Cmd+Enter** sends, and Settings → **Composer** can hand the
  send to plain Enter instead. The box keeps a margin on each side of the
  dock, and that margin grows as the dock is dragged wider — at the dock's
  narrowest the composer fills it edge to edge, and on a wide dock each side is
  about an eighth of the width — so the composer never stretches the whole bar.
  The message text keeps the same margins: the transcript's content box is the
  composer box's width, with its scrollbar at the dock's own edge, so on a wide
  dock the conversation and the field read as one column.
- The dock's bottom action bar under the composer: a card centred on the composer
  at its own fixed width — a wider field for reading does not stretch the dock's
  chrome — floating with a margin on every side and softly rounded, and never
  wider than the field it belongs to, in the split dock and in full screen alike.
  In order: **New chat**, **Notebox**, **Full screen chat** / **Exit full screen
  chat**, **Keyboard shortcuts** (opens the reference as a dock surface), **Chat
  display settings** (opens Settings → **Chat display**), the two-panes side
  switch, and **Collapse chat**. The build number is not here: it lives at the
  top of the rail, under the lockup.
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
  away from what you were reading. Notebox' composer behaves the same way with
  the signals above it.
- The dock's side and width are not preferences. They reset when the app
  launches: it opens right, `22.5rem` wide. The rail starts wide too; collapsing
  it is session state, not a stored preference. Full-screen chat is session state
  as well: it is not stored, so a relaunch returns to the split.
- Full-screen chat is a shell mode, not a dock surface. On, the main page is not
  painted at all, the dock takes its column and the seam, and the rail keeps the
  window's leading edge; the chat's own column stays a readable measure while the
  strip, header and action bar hold the full width. Collapsing the chat leaves
  the mode and brings the page and launcher back, and entering it from a
  collapsed dock reopens the dock. The dock's side does not matter: the dock is
  always immediately right of the rail, with no divider.
- The open chat tabs are remembered per vault and agent, and reconciled against
  the chat list on landing, so a restart brings the strip back. A chat's kickoff
  mark — the icon in its tab and its **Chats** row — is remembered with it.
  Archived or deleted chats lose their tabs; a deliberately closed strip stays
  closed.
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
  draws the active LifeQuest lockup (the same pick the rail wears) over its bar,
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
bar; it draws the same fifteen rows with a pencil on each that records a new key
in place, the same refusals as the settings page, **Unassigned** for a cleared
row, and **Back to chat** to return. The bindings and their refusals are
catalogued in [Settings](./28-settings.md).

## Tips and edge cases

- Collapsing the rail never takes it away: it narrows to its icon column, so the
  collapse control moves from the sidebar's bottom trailing corner up to the top
  of the column as the Q emblem — the way back is the first thing in the thin
  rail — and while the rail is wide the centred lockup collapses it too. The lens
  tab
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
- The layouts picker is session state, not a stored preference: relaunching
  returns the studio arrangement, exactly as full-screen chat does. The split
  halves follow the window, the rail's collapse and a theme's rail placement, so
  they stay halves rather than a width remembered from the press; a theme that
  floats the rail splits the window itself, with the rail's card riding over the
  page. Pressing the layouts control again, **Escape**, or a press anywhere
  outside the picker closes it without changing the arrangement.
- A pinned chat cannot be archived or deleted until it is unpinned: while pinned,
  its sidebar row hides the hover archive control and its row menu loses
  **Archive** and **Delete**. The tab's own menu offers **Unpin**.
- A tab is as wide as its chat's name up to a few words; when the strip fills,
  it keeps at least about three characters of its chat's name and an ellipsis
  beside its leading mark and close control. When the strip runs out of room it
  scrolls sideways rather than squeezing the tabs further, and the tab that comes
  in front is scrolled into view.
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
