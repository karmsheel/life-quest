# Keyboard shortcuts — design

**Date:** 2026-10-29
**Status:** implemented on `feat/keyboard-shortcuts`

## Problem

The studio has keyboard conventions (Escape unwinds a sheet, Ctrl/Cmd+S saves the
editor in front of you) but its movements are mouse-only. Changing wing, walking
the pages of a wing, collapsing the rail, opening or closing the chat dock, and
opening settings all require a pointer. The operator asked for a settings page
under Settings where those movements can be bound to keys, and for the bindings
to be theirs to define.

## Movement table

One table declares every bindable movement. Defaults are portable: `Mod` is Cmd
on macOS and Ctrl everywhere else.

| Group | Movement | Default | What it does |
| --- | --- | --- | --- |
| Wings | Go to Home | `Mod+1` | Jump to the Home wing's last page |
| Wings | Go to Define | `Mod+2` | Jump to Define's last page |
| Wings | Go to Plan | `Mod+3` | Jump to Plan's last page |
| Wings | Go to Execute | `Mod+4` | Jump to Execute's last page |
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

A wing jump uses `WingProvider.selectWing`, so it lands on that wing's last path
or its default, exactly as a tab click does. Page movement reads the same
`NAV_ITEMS` table the rail draws, so the order the keys walk is the order the
operator sees. A nested route (`/projects/42`) counts as its rail row (`Projects`)
for the purpose of stepping.

## The settings page

Settings → Keyboard (route `/settings?tab=shortcuts`) lists the movements in four
groups. Each row carries the movement, its description, the current keycaps and a
**Change** control; a row changed from its default also shows the default and a
**Reset** control. A footer says how many movements are changed and offers
**Restore all defaults**.

Recording happens in the row: selecting **Change** makes the row say "Press
keys…", and the next keydown that includes a real key becomes the binding.
**Escape** cancels; **Backspace** or **Delete** clears the binding, leaving the
movement unassigned. A changed row shows its effective keys and the default it
was taken from.

The page is searchable like every other settings page: "keyboard", "shortcut",
"hotkey", "binding" and "movement" all find it from the sheet's search bar.

## Refusals

A binding is refused, with the reason shown in the page's alert banner, when:

- the combination is owned by the app or the operating system — Escape, Tab,
  F5/F11/F12, Alt+F4, and the Mod combinations for close, quit, reload, print,
  devtools and browser zoom;
- another movement already answers to it; the refusal names that movement;
- the pressed key is not a bindable key (a modifier alone, a dead key, an
  unidentified key).

A conflict keeps the row recording, so the operator can press another combination
without walking back to the button. A cleared binding (`null`) is a deliberate
choice and survives reload.

## Keys the chat dock owns (added 2026-11-09)

Not every key is a movement. The composer already owns Ctrl/Cmd+Enter as the
send key without putting it in the table, and the dock's tabs now own the
browser's own close gesture the same way:

- **Ctrl/Cmd+W** closes the chat tab in front. It is handled by
  `ShortcutRunner`, not by a movement row, and it fires only while the strip the
  operator can see is drawn: the dock open on the thread surface, more than one
  open chat or a pinned band, a chat in front, and that chat not pinned (a pinned
  square leaves the band only through **Unpin**). With nothing to close the key
  is left to the platform — `defaultPrevented` is not set.
- **A middle click** on a tab closes that tab, the way a browser closes the tab
  under the pointer. A pinned square swallows the press and closes nothing.

Both gestures are deliberately outside the movement table. Browsers do not let
Ctrl/Cmd+W be rebound, `RESERVED_BINDINGS` keeps `Mod+W` out of every movement
row, and the gesture needs state the table does not have — which dock surface is
showing and which tab is in front — so it lives beside the runner's other guard
rails (recording, modal, repeat, `defaultPrevented`) instead. `ShortcutRunner`
therefore moved inside `ChatSessionsProvider` in `AppShell`: the key has to read
the strip it closes from.

## The dock's reference page

A titlebar control — the keyboard icon immediately before the settings gear —
opens the dock onto a Keyboard shortcuts page. It is the look-up surface: the
page the operator is working on stays where it is, and the keys are one click
away in the pane that already carries the chat list and the Life-Chain.

The control opens the dock if it is collapsed and puts the reference on it
without a chat resuming over the top. The page lists the same movements and
effective bindings as Settings → Keyboard, grouped the same way. Each row carries
a small pencil: the row then waits for the next key exactly as a Settings row
does, with the same refusals, Escape-to-cancel, Backspace-to-clear and immediate
persistence. The header pencil still opens the full Settings page over the app,
where the whole table can be read and restored wholesale. The dock's back
control returns to the thread it left (or the list when no chat is open), and any
other dock action — history, Life-Chain, or opening a chat — replaces the
reference as usual.

Both editors share one recorder: the capture listener lives on
`ShortcutsProvider`, not on either page. A modal settings sheet does not unmount
the dock beneath it, so two page-local listeners could both claim the same key;
one provider recorder means one Escape, one refusal and one saved binding no
matter which page started the edit.

For this, `surface` moved from the chat store to `ChatDockProvider`: the titlebar
stands above the chat store, and "what is this pane showing" is dock state.

## Storage

Overrides live in `localStorage` under `lifequest-keyboard-shortcuts`:

```json
{ "version": 1, "bindings": { "wing.next": "Ctrl+Alt+N", "history.back": null } }
```

Only changes are stored. A movement set back to its default removes its entry, so
a later release can still improve a default for an operator who never touched it.
A corrupt or unknown entry is ignored, and an unparseable override falls back to
the default rather than leaving a movement dead.

## The runner's guard rails

The listener is mounted once, inside `AppShell` (inside `ChatSessionsProvider`,
because the dock's tab key reads the strip). It stands down while:

- a settings row is recording (the keys belong to the page);
- a modal sheet or dialog is up (`aria-modal`, the sheet frame, confirm and update
  dialogs) — navigating the page behind a modal would close the surface from
  under the key;
- the key is typing: a binding with no Ctrl/Meta does not fire while the target
  is a text field, textarea or contenteditable. Alt+Arrow is exempt too, because
  Option+Arrow is a word-wise caret move on a Mac. A Ctrl/Cmd combination still
  does, which is what keeps navigation usable from a composer;
- the event was already handled (`defaultPrevented`, key repeat, IME composition).

## Files

| File | Role |
| --- | --- |
| `apps/desktop/src/lib/shortcuts.ts` | Movement table, parser, keycap formatter, reserved space, storage, matching |
| `apps/desktop/src/state/ShortcutsProvider.tsx` | Bindings, overrides, the one recorder, refusals |
| `apps/desktop/src/components/shell/ShortcutRunner.tsx` | The listener and what each movement does, plus the dock's Mod+W tab close |
| `apps/desktop/src/components/settings/SettingsShortcuts.tsx` | The page |
| `apps/desktop/src/components/hermes/ChatShortcutsPage.tsx` | The dock's reference page, with per-row editing |
| `apps/desktop/src/state/ChatDockProvider.tsx` | The dock's surface, including the reference page |
| `apps/desktop/src/components/shell/WindowTitleBar.tsx` | The keyboard icon that opens the dock page |
| `apps/desktop/src/lib/settings-views.ts` | The Keyboard section and its search keywords |
| `apps/desktop/src/styles/global.css` | Keycaps, groups, the recording row and the dock reference |

## Verification

`tests/keyboard-shortcuts-e2e.test.ts` drives a real Electron window running the
real shell and the real settings sheet: defaults and search, recording a
binding, the rebound key moving the app after the sheet closes, conflict and
reserved refusals (including the runner standing down while recording),
Backspace clearing, per-row and all-defaults reset, persistence across a reload,
the typing guard, the default panel/page/wing/surface movements, and the
titlebar control opening the dock's reference page (including from a collapsed
dock and after a binding changed), and editing a binding from a dock row
(recording, conflict, reserved, clear and the new key actually moving the app).
Its report and screenshots land in
`apps/desktop/e2e/artifacts/keyboard-shortcuts.*`.

The dock's tab gestures are driven by `tests/chat-tabs-e2e.test.ts` in the
chat-tabs harness: a middle click closes the tab under the pointer and is
swallowed, a middle press on a pinned square closes and unpins nothing, and
Ctrl+W (a real key press through the window's input pipeline) closes the tab in
front while being left alone when no strip is drawn.
