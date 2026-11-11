# Keyboard shortcuts

The studio's movements — changing wing, stepping the rail, toggling a panel,
opening settings — are bindable to keys you choose. Settings → **Keyboard** lists
every movement, its current keys and one **Change** control; the dock's
keyboard-shortcuts reference is the same table, one click away while you work.
The single idea: the keyboard belongs to the operator, so a movement's keys can be
changed, cleared or put back, and only your changes are stored.

## Where it lives

- **Settings → Keyboard** — the Settings sheet, tab **Keyboard**, route
  `/settings?tab=shortcuts`. The section is titled **Keyboard shortcuts**, with
  the subtitle **Keys for moving around the studio**. It is a settings section,
  not a page.
- The dock's reference — the keyboard icon in the dock's bottom action bar,
  labelled **Keyboard shortcuts**. With the dock open, it puts the reference on
  the pane; the page you are working on stays where it is. A collapsed dock is
  brought back by its launcher first, which restores the bar.
- The bindings live in this installation's `localStorage`, not in the vault.

Back to [Wiki home](./index.md).

## What it is for

Every navigation movement used to need a pointer. This page lets you put the ones
you use on keys you can reach: jump straight to a wing, walk the rail of the wing
you are in, go back a page, collapse the rail, open or close the dock, open
settings. The defaults are portable and sensible; the page exists because the
operator's hands are not the default operator's hands.

## How to use it

### Change a movement

1. Open **Settings → Keyboard**. The movements are listed in four groups —
   **Wings**, **Pages**, **Panels** and **Surfaces**.
2. Find the movement. Its row shows the movement's name, a sentence on what it
   does, its current keys, and **Change**.
3. Choose **Change**. The row says **Press keys…** and waits. Press the
   combination you want, including at least one real key. A combination that is
   accepted saves at once: the row shows its keys again and the page reports
   **Shortcut saved.**
4. **Escape** cancels the recording (**Shortcut change cancelled.**); **Backspace**
   or **Delete** clears the movement to **Unassigned** (**Shortcut cleared.**). An
   unassigned movement does nothing.
5. A row that is changed from its default shows the default underneath and a
   **Reset** control. The footer says how many movements are changed, and
   **Restore all defaults** puts every one back (disabled when nothing is
   changed).
6. The page is searchable like the rest of Settings: "keyboard", "shortcut",
   "hotkey", "binding" and "movement" all find it from the sheet's search bar.

### Look a key up in the dock

1. With the dock open, choose **Keyboard shortcuts** in its bottom action bar.
   The reference takes the pane; no chat resumes over it and the composer is not
   drawn.
2. The reference lists the same movements and effective keys as Settings. Each
   row has a pencil: choose it and the row waits for keys exactly as the Settings
   row does, with the same refusals, **Escape** to cancel and **Backspace** to
   clear, saving at once.
3. The header pencil — **Change in Settings** — opens the full Settings page over
   the app. **Back to chat** returns the dock to the thread it left (or the
   thread's blank state when no chat is open).
4. Any other dock action replaces the reference as usual. The dock's own browser
   gestures are listed at the foot of the reference rather than as rows, because
   they cannot be rebound.

## The screen

**Settings → Keyboard**

| Part | What it does |
|---|---|
| Section header | **Keyboard shortcuts**, subtitle **Keys for moving around the studio**. |
| Hint | *Select **Change**, then press the keys you want. The new shortcut works everywhere in the app and is saved on this computer.* |
| Group headings | **Wings**, **Pages**, **Panels**, **Surfaces**. |
| Movement row | Name, description, current keycaps, **Change**. A changed row adds `Default: …` and **Reset**. |
| Recording row | Replaces the keycaps with **Press keys…**; the button becomes **Cancel**. |
| Footer | How many movements are changed, or *Every movement is on its default key.*, plus **Restore all defaults**. |
| Quiet hint | *Escape cancels a change. Backspace or Delete clears a shortcut, leaving the movement with no key at all.* |
| Alert banner | A refusal, printed above the groups, while the row keeps recording. |

The dock's reference

| Part | What it does |
|---|---|
| Dock bar | The **Keyboard shortcuts** button, pressed while the reference is the surface. |
| Header | **Back to chat**, the heading **Keyboard shortcuts**, and the **Change in Settings** pencil. |
| Hint | *Every movement and the keys it answers to.* plus the changed count and **Change in Settings**. |
| Groups | The same four groups, in the same order. |
| Rows | Movement, current keys, and a pencil (`Change shortcut for …`). |
| Foot | *Pick a pencil, then press the keys you want. Escape cancels; Backspace clears a shortcut.* and the dock's browser-key note. |

## The fourteen movements

`Mod` is Ctrl on Windows and Cmd on a Mac. The keycaps print the platform's own
name, so the same default reads Ctrl+1 on Windows and Cmd+1 on a Mac.

| Group | Movement | Default | What it does |
|---|---|---|---|
| Wings | Go to Home | `Mod+1` | Jump to the Home wing's last page |
| Wings | Go to Define | `Mod+2` | Jump to Define's last page |
| Wings | Go to Plan | `Mod+3` | Jump to Plan's last page |
| Wings | Go to Execute | `Mod+4` | Jump to the Act wing's last page |
| Wings | Go to Review | `Mod+5` | Jump to Review's last page, or Daily on a fresh session |
| Wings | Next wing | `Mod+PageDown` | Step forward through the five wings, wrapping |
| Wings | Previous wing | `Mod+PageUp` | Step backward through the five wings, wrapping |
| Pages | Next page | `Mod+Shift+PageDown` | Next rail row in the current wing, wrapping; from off-rail, the first |
| Pages | Previous page | `Mod+Shift+PageUp` | Previous rail row in the current wing, wrapping; from off-rail, the last |
| Pages | Back | `Alt+ArrowLeft` | Router back |
| Pages | Forward | `Alt+ArrowRight` | Router forward |
| Panels | Toggle sidebar | `Mod+B` | Collapse or expand the nav rail |
| Panels | Toggle chat | `Mod+J` | Open or close the chat dock |
| Surfaces | Open settings | `Mod+,` | Open the settings sheet over the page |

A wing jump lands on that wing's last page or its default, exactly as a tab click
does. The movement's own name still reads **Go to Execute** even though the wing
it lands on is labelled **Act**; the wing id is unchanged. Page movement reads the same rail table the rail draws, so the order the
keys walk is the order you see, and a nested route (`/projects/42`) counts as its
rail row for stepping.

## Rules and behaviour

Bindings are portable by default and deliberate when changed. Defaults are
written with `Mod`, which resolves to Cmd on macOS and Ctrl everywhere else. A
combination you record is stored with the modifiers you actually pressed, so a
deliberate Ctrl on a Mac stays Ctrl. Both editors share one recorder: a modal
settings sheet over the dock cannot claim the same key twice.

A refused combination keeps the row recording. The reason prints in the
page's alert banner, and the row stays open so you can press another combination
without walking back to the button:

- Reserved by the app or the OS. Escape, Tab, Enter, F5, F11, F12, Alt+F4,
  and the Ctrl/Cmd combinations for close, quit, reload, print, devtools and
  browser zoom are not bindable. The message reads **That combination is reserved
  by the app or the operating system. Pick another one.**
- Already used by another movement. The refusal names it: **Already used by
  “Next wing”. Pick another combination.**
- Not a key the app can bind. A modifier pressed alone, a dead key or an
  unidentified key is refused with **That is not a key this app can bind.**

When the keys fire. One listener runs the movements, mounted once in the app
shell. It stands down in four cases:

- a settings or dock row is recording — the keys belong to the page until it has
  one, or the shortcut being typed would fire the movement it is being bound to;
- a modal sheet or dialog is up (`aria-modal`, the sheet frame and the confirm
  and update dialogs) — navigating the page behind a modal would close the
  operator's surface from under the key;
- the key is typing: a binding without Ctrl or Cmd does not fire while the target
  is a text field, textarea or contenteditable, so Alt+Arrow there is the caret
  key rather than the router. A Ctrl/Cmd combination still fires, which keeps
  navigation usable from a composer;
- the event is already spoken for (`defaultPrevented`, key repeat, IME
  composition).

The dock owns its own tab keys. These are not movement rows and cannot be
rebound:

- **Ctrl/Cmd+W** closes the chat tab in front, but only while the strip the
  operator can see is drawn: the dock open on the thread surface, at least one tab
  (a pinned band counts), a chat in front, and that chat not pinned. With nothing
  to close the key is left to the platform.
- **Ctrl/Cmd+Enter** is the composer's send key (Enter breaks the line).
- **Middle click** closes the tab under the pointer. A pinned square swallows the
  press and closes nothing; **Unpin** is a pinned tab's way out.

**Storage.** Overrides live in `localStorage` under
`lifequest-keyboard-shortcuts`, as
`{ "version": 1, "bindings": { "wing.next": "Ctrl+Alt+N", "history.back": null } }`.
Only changes are stored: a movement set back to its default removes its entry, so
a later release can still improve a default you never touched. A `null` binding is
a deliberate **Unassigned** and survives reload. A corrupt or unknown entry is
ignored, and an unparseable override falls back to the default rather than leaving
a movement dead. Bindings are per installation, not inside the vault, so they do
not travel with a copied vault folder.

## Tips and edge cases

- Nothing is written to storage until you change something. Every movement starts
  on its default, and **Restore all defaults** empties the override set.
- Changing a binding here changes both editors at once: the dock's reference reads
  the same table, so a key rebound in Settings shows its new keys there too.
- Escape is the recordings' way out but also a reserved key: you cannot bind a
  movement to Escape, Tab, Enter or a browser-owned combination.
- Backspace or Delete clears rather than cancels — the movement is left with no
  key at all, not with its old one. Use **Reset** to get the default back.
- A binding with no Ctrl or Cmd does not fire while the caret is in a note, a
  chat composer or a form field. If a bare-key shortcut seems dead, check where
  focus is; a Ctrl/Cmd combination works from a composer.
- The dock's reference is a lookup surface, not a second settings page: the header
  pencil is the way to the full page where the whole table can be restored at
  once.
- A pinned chat has no close control and Ctrl/Cmd+W will not close its tab. Unpin
  it first (the tab's right-click menu offers **Unpin**).
- Settings search matches "keyboard", "shortcut", "hotkey", "binding" and
  "movement", so a half-remembered word still finds the page.

## Related

- [The studio](./03-the-studio.md) — the rail, dock and sheets the movements drive
- [Settings](./28-settings.md) — the sheet's tabs, including **Keyboard**
- [Companion](./24-companion.md) — the dock, its tabs and its reference surface
- [Glossary](./33-glossary.md) — movement, harness and the rest of the vocabulary
