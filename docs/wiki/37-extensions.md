# Extensions

**Extensions** is where the app's customisation files live as objects you can act on:
select one, switch it on or off, edit it, or create a new one — without opening a folder or
asking the companion to write anything.

The name is deliberate. What the app ships today is **data**, not code: a theme file names
colours, material steps, chrome placements, a scene and, at the top of the ladder, a
composition of page widgets. Nothing in it can run, request, import or draw arbitrary
markup. Calling that a *plugin* would promise an execution model and a trust story the app
deliberately refuses (no package code, a strict content policy, one privileged window, an
unsigned installer). **Extensions** is the umbrella for the things that extend the
experience — today themes, later the same page grows a second kind without changing what the
first one is. A single theme file is still a *theme* everywhere it matters: the companion
tools are `get_theme`, `validate_theme` and `write_theme`, and the folder is `themes/`.

## Where it lives

- Wing: none. Extensions sits on the bottom shelf of the rail, below **Automations**.
- Rail: icon **Puzzle**, label **Extensions**.
- Route: `/extensions`.
- Surface: a full page in the centre pane — a count line, a list of extension cards, an
  inline create panel and an inline text editor.

This page is part of the [Wiki home](./index.md).

## What a card shows

Each card is one file in the app profile's `themes/` folder (never the vault — a look is this
installation's, not the folder's). A card names the file's **label** and **file name**, its
own description if it has one, and a row of chips summarising what it changes: **Palette**
(or *Inherits palette*), `wings …` and `domains …` placements, **Material**, `sky …`, and
`composition · N widgets`. An **Active** pill marks the one file the window is wearing; a
**Previewing** pill marks the ten-second preview currently on screen.

## The four verbs

- **Active switch** — the toggle on the card. On keeps that file as the window's theme; off
  hands the window back its default look. A window wears exactly one theme file, so
  switching a second card on replaces the first: this is an on/off switch over *the window's
  look*, not a per-card parallel enable. The switch is a real `role="switch"` control with
  `aria-checked`, so it reads correctly to a screen reader and to a keyboard.
- **Try** — wear the file for ten seconds, with **Keep** and **Revert** on the preview bar,
  exactly as a companion write does. Trying never changes what is kept.
- **Edit** — open the file as text. The editor validates as you type against the same shared
  rules the companion's `validate_theme` uses, and the verdict under the textarea names the
  failing field. **Save** sends the text to the main process, which re-parses it and only then
  writes it (atomically); a refusal is shown without touching the file. A save that lands
  previews through the same ten-second gate as any other changed file, so you see it before
  you keep it.
- **Remove** — two presses (**Remove** → **Remove?**) delete the file from the profile. A file
  the window is wearing is also unkept, so the next paint is the default look.

## Creating one

**New extension** opens a small panel: a name, and whether to start **Blank** or **Copy the
active look**.

- **Blank** writes a minimal, valid file — name, label, description and the material
  baseline — ready for colours and placements to be added in the editor.
- **Copy the active look** clones the file currently worn (or the first file, when nothing is
  kept) under the new name and label, so a variation starts from something you can see.

The file name is derived from the name as a slug (`Night Runway` → `night-runway.json`), with
`-2`, `-3` … appended when that name is taken. A fresh file previews immediately; the status
line names it and says so. Main validates the starter object before writing, so a new
extension can never be a file the shell cannot draw.

## What it cannot do

- It cannot run code, make a request or draw markup — the file schema is the closed vocabulary
  described in [Settings](./28-settings.md), and main re-validates every save.
- It cannot draw over the way out: window controls, the Settings entry and the preview bar are
  outside every theme.
- It cannot change the vault. Extensions live in the app profile; the folder is untouched.

## Related

- [Settings](./28-settings.md) — Appearance, the theme layers a file may set, and the same
  file list inside Settings.
- [Automations](./17-automations.md) — the neighbouring shelf page that manages a different
  saved object.
- [Companion](./24-companion.md) — the theme tools the companion uses to author files.
- [Security](./29-security.md) — why a look is data, never code.
