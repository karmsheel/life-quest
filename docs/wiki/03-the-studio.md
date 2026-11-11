# The studio

The studio is the desktop app: one window made of three paper panes on a canvas —
the rail, the main pane and the chat dock — with the app's own title bar above
them. The title bar carries the window controls and the **domain tab**: the
domain lens, raised out of the old top bar into the strip and painted in the
page's own colour, so it reads as part of the page below it. The rail navigates
and switches wings, and the chat pane keeps the companion beside whatever you are
doing. Settings and Decisions are not pages in this layout; they are sheets drawn
over it. This page explains that layout; [the wiki
home](./index.md) has the full page index.

## Where it lives

Every page after the companion gate is inside the shell: Dashboard through
Reviews, plus the governance pages. The shell is not a route — it wraps the
routes:

- The **window title bar** spans the top of the whole window, including the
  welcome and companion screens. Inside the shell it carries the **domain tab**
  centred on the strip, between the rail and the trailing controls; on the
  welcome and companion screens the tab is absent.
- The **rail** is the left column of the shell grid; its wing switcher band and
  the active wing's pages sit under the title bar.
- The **main pane** begins directly under the title bar. It has no band of its
  own — the sheet's top bar is gone, and the page gains that height back.
- The **chat dock** is the trailing column, or the middle column when you swap
  sides.
- **Settings** (`/settings?tab=<view>`) and **Decisions** (`/decisions`) are
  sheets over the page, not pages of their own.

The window opens at 1280 × 800 by default. The app uses a hidden title bar with a
native overlay on Windows, so the title bar you see is LifeQuest's own.

## What it is for

The studio is the work surface, not a chat window with pages bolted on. The three
panes have separate jobs: the rail says where you can go, the main pane holds the
page you are on, and the dock holds the companion that can read that page. Wings
keep the rail short without hiding features, and the domain lens narrows the data
in place without changing the page. Sheets let you change settings or clear
Decisions without losing the page you were reading.

## How to use it

1. **Switch wings.** Click a wing in the rail's wing switcher, the square block
   directly under the title bar: **Home**, **Define**, **Plan**, **Execute**,
   **Review**. The rail's page list changes and the app takes you to that wing's
   last page — or to the wing's default page the first time. Each wing remembers
   its last page, so returning to a wing returns you to where you were. **←** and
   **→** move between wings.
2. **Change the lens.** Choose **Overview** or a domain name in the **domain
   tab**, centred in the window title bar. This is the data filter for
   domain-scoped lists (Dashboard boards, Data, Pages, Life-Chain and others).
   **←** and **→** move between lens options as well. The tab is centred on the
   strip, so it holds its place when the rail collapses.
3. **Navigate the rail.** Click a page under the active wing. The rail's middle
   section lists your **Chats** with **New chat** and the recent threads.
   Life-Chain, Decisions, Daily Note and Automations sit on a shelf near the foot;
   the **Log** closes the rail; the version number sits at the very bottom.
4. **Collapse and restore the rail.** Press the panel icon at the top of the rail
   (**Collapse sidebar** / **Expand sidebar**). Collapsed, the rail narrows to its
   icon column and the page widens; the same toggle stays at the top of the thin
   rail and turns around. The title bar's domain tab holds its centre line; only
   the empty drag room beside it grows.
5. **Collapse and restore the chat.** Press the panel icon at the trailing end of
   the dock's bottom action bar (**Collapse chat**). A collapsed dock is not a
   narrow pane: it becomes one floating mark, **Open Hermes chat**, at the page's
   trailing corner (bottom-right in the shipped right-hand arrangement), and the
   thread, draft and pending receipt are kept while it is hidden.
6. **Resize the chat dock.** Drag the seam between page and dock
   (*Drag to resize the chat dock*). With the divider focused, **←** and **→**
   move it 16px per press. **Escape** during a drag cancels it and restores the
   width you had.
7. **Swap the chat's side.** Press the two-panes icon in the dock's bottom action
   bar, immediately left of the collapse control (*Move chat to the left of the
   page* / *Move chat to the right of the page*). The rail never moves; the dock
   and the page trade columns.
8. **Open a sheet and leave it.** Press the gear in the title bar, then **All
   settings**, or open **Decisions** from the rail. Close with the cross
   (**Close settings** / **Close decisions**), a click on the dimmed background, or
   **Escape**. You return to the page, scroll position and state you left.

## The screen

The window title bar:

- The **domain tab** centred on the strip, between the rail and the trailing
  controls. It is painted on the page canvas, flush with the window's top edge
  and the full height of the strip; its top corners are rounded and its two
  bottom corners flare into the page with small concave fillets of the same step
  — the rounded ends make it read as the page's own tab rather than a control
  floating in the chrome. It carries the domain lens: **Overview** followed by
  every live domain, in sort order, as a compact segmented control that moves
  with **←** and **→**. The tab keeps the strip's centre line when the rail
  collapses. The window title is `LifeQuest — <vault name>`.
- The open room on either side of the tab is the window's drag handle — empty
  apart from the tab itself, which stays clickable — with the window controls on
  the trailing edge.
- The tab exists only while the shell is mounted: on the welcome and companion
  screens there is none. There the strip is the window's drag area, with its window
  controls when the overlay is unavailable, and with no vault the window title is
  `LifeQuest`.
- The trailing controls, for a vault window: the day/night control (*Switch to
  day mode* / *Switch to night mode*), and the **Settings** gear (*Open
  settings*). The day/night control is two controls on one
  icon: a click switches the palette between day and night, and hovering it opens a
  quick menu with the **System** / **Light** / **Dark** switcher first and the
  starred themes underneath for quick selection. The dock's own controls are not
  here: its side switch, collapse control and the **Keyboard shortcuts** control
  live in its bottom action bar.
- When the platform overlay is unavailable, the same strip carries **Minimize**,
  **Maximize** / **Restore** and **Close** instead of drawing over the native
  frame.

The rail:

- A collapse toggle at the top.
- The five-wing switcher — **Home**, **Define**, **Plan**, **Execute**,
  **Review** — a square block directly under the title bar.
- The active wing's pages, each with an icon and its label.
- A divider, then the **Chats** section: **New chat**, then pinned and recent
  chats. With none it says *No chats yet*.
- A divider, then the governance shelf: **Life-Chain**, **Decisions**,
  **Daily Note**, **Automations**. **Decisions** wears a count of pending
  Decisions visible in the current lens, pulses when the count grows, and caps at
  `99+`.
- A divider, then **Log**.
- The version line at the foot — `v0.2.0` — which is also the manual update
  control (*Check for updates*). When a release is offered it gains an
  **Update available** line and a glow. See [Updates](./27-updates.md).

The main pane is the page's own column, beginning directly under the title bar:
there is no band between the strip and the page, so the page gains the 44px the
old top bar held. It is the element the chat reads as the current page
(`data-page-context-root`), so what the companion is told about the screen is
exactly the page — never the rail, the title bar or the chat panel. The `/chart`
route opts into a full-bleed variant for the Life Map.

The chat dock:

- The thread, a Life-Chain view, and the keyboard-shortcuts reference. The history
  is not a dock surface: the whole chat list lives in the rail's **Chats** section.
- The composer: one bordered box at the foot of the dock, the field
  (*Message Hermes…*) at the top and a control row inside its bottom edge — the
  add and receipt controls and the page pill at the bottom left, the model and
  thinking pills and send/stop at the bottom right.
- The dock's bottom action row under the composer: **New chat**, **Life-Chain**,
  **Keyboard shortcuts** (opens the reference as a dock surface), the two-panes
  side switch (*Move chat to the left of the page* /
  *Move chat to the right of the page*), **Collapse chat**, and the version badge
  (*Check for updates*).
- The divider between page and dock: an invisible strip at rest, an accent bar
  under the hand or focus.

## Rules and behaviour

- The three panes abut with no gap; only the seam's hairline separates them. The
  rail's shipped width is `16rem`, the dock's is `22.5rem` until you drag it.
- The dock's column is bounded: at least `300px`, at most the smaller of 70% of
  the frame and the width that leaves the page `400px`. A narrow window keeps the
  dock's floor and gives the page the squeeze. A dragged width is session state,
  re-clamped whenever the window or the rail changes.
- The dock's side and width are not preferences. They reset when the app
  launches: it opens right, `22.5rem` wide.
- Wings filter the rail, never a page's data
  ([LAWS/WINGS.md](../../LAWS/WINGS.md)). Each wing's memory defaults to Home
  `/home`, Define `/dream`, Plan `/goals`, Execute `/daily`, Review
  `/review/daily` until you visit a page in it.
- The domain lens is the data filter for domain-scoped lists; **Overview** is a
  virtual lens, not a vault folder ([LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md)).
  The chosen lens is remembered per vault and restored on the next open.
- Settings and Decisions are sheets because a page is not a place you should lose
  by checking a setting. Their paths keep rendering the page behind them; the
  sheet is portalled over `body`, dims and blurs the app, locks the page's scroll,
  and puts focus back on the control that opened it when it closes. A cold start
  that opens `/settings` directly has no page behind it and falls back to the
  Dashboard when closed.
- `/settings?tab=<view>` selects a tab; `/domains` redirects to
  `/settings?tab=domains`. Tabs and labels are catalogued in
  [Settings](./28-settings.md).
- A sheet's **Escape** unwinds one step: it clears a settings search before it
  closes the sheet.
- The splash is markup painted before React and is dismissed by the shell: it
  holds for a floor of 1.5 seconds and until the first vault read finishes, then
  fades for 200ms. It does not wait for the companion; the companion's own
  connect surface reports that wait. On a normal launch the companion answers well
  under the floor and that surface is never seen.

Window-level keys:

| Key | Action |
|---|---|
| **Ctrl+R** | Reload the window |
| **F11** | Toggle fullscreen |
| **Ctrl+Q** | Quit the app |
| **Ctrl+Shift+I**, **F12** | Toggle DevTools in a development build only |

## Tips and edge cases

- Collapsing the rail never takes it away: it narrows to its icon column, so the
  one collapse toggle stays at the top of the rail at either width. The title
  bar's domain tab holds the strip's centre line, so the room beside it grows
  rather than the tab sliding along with the rail.
- The chat's collapsed state keeps the component mounted: a streaming turn keeps
  streaming, and a draft survives a collapse. It is a hide, not a reset.
- Dragging the divider towards the page widens a left-hand dock and narrows a
  right-hand one; the pointer direction is read from the seam, so the gesture
  means "make this pane bigger" on both sides. Arrow keys follow the same rule.
- The sheet scrim closes on a press that starts on the scrim, so a drag that
  begins inside the panel and ends outside does not dismiss it.
- The day/night control is always in the strip. A theme with only one palette is
  wearable in the palette it has; when the switch asks for the other one, the
  window hands itself to the fallback theme, **Nous**, in the requested mode, so
  the switch never leaves a light palette at night or a night palette by day.
- Clicking the day/night control switches the palette immediately; hovering it
  opens the quick menu. The menu's starred grid is the same list the Settings
  popover shows, and stars are set on the Appearance page.
- If the window falls back to LifeQuest's own minimize/maximize/close buttons, the
  native overlay was unavailable; everything else in the title bar behaves the
  same.
- The Decisions count on the rail follows the lens: a Decision tagged to another
  domain is not counted while you are filtered to this one.

## Related

- [Getting started](./02-getting-started.md)
- [The vault](./04-the-vault.md)
- [Domains](./05-areas.md)
- [Companion](./24-companion.md)
- [Settings](./28-settings.md)
- [System architecture](./30-system-architecture.md)
