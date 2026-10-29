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

The listener is mounted once, inside `AppShell`. It stands down while:

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
| `apps/desktop/src/state/ShortcutsProvider.tsx` | Bindings, overrides, recording, refusals |
| `apps/desktop/src/components/shell/ShortcutRunner.tsx` | The listener and what each movement does |
| `apps/desktop/src/components/settings/SettingsShortcuts.tsx` | The page |
| `apps/desktop/src/lib/settings-views.ts` | The Keyboard section and its search keywords |
| `apps/desktop/src/styles/global.css` | Keycaps, groups and the recording row |

## Verification

`tests/keyboard-shortcuts-e2e.test.ts` drives a real Electron window running the
real shell and the real settings sheet: defaults and search, recording a
binding, the rebound key moving the app after the sheet closes, conflict and
reserved refusals (including the runner standing down while recording),
Backspace clearing, per-row and all-defaults reset, persistence across a reload,
the typing guard, and the default panel/page/wing/surface movements. Its report
and screenshots land in `apps/desktop/e2e/artifacts/keyboard-shortcuts.*`.
