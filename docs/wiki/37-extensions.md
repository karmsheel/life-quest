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
  inline create panel, an **Import from file** action in the page header, and an inline text
  editor whose panel also keeps the file's saved versions.

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

## History

Every save over a file that already exists keeps the bytes it replaced, so a bad edit is one
press from undone.

- **What a version is** — one snapshot the app takes of the file immediately before it writes
  over it, with the time it was taken, the label the file carried then, and its size in bytes.
  A file keeps its newest **ten** versions; the next save lets the oldest go. A file that has
  never been overwritten has no versions yet, and the panel says so: *No saved versions yet —
  the first save starts history.*
- **Where it lives** — in the app profile beside the `themes/` folder, under
  `theme-history/<file-stem>/`, and never inside it. A version is therefore not a theme: it is
  not listed, not worn and not previewed.
- **Restoring one** — open the file's **Edit** panel: **History** lists that file's versions,
  newest first, each with its time, label and size. **Restore** re-reads the stored version
  through the same shared rules as any save, writes it back through the same gate, and puts
  it into the editor's textarea so you can see what came back. The restored file then
  previews for ten seconds with **Keep** and **Revert**, exactly like a save.
- A restore is itself a save, so it keeps a version of the bytes it replaced: history can
  always undo history.
- Only the app's own writes make versions. Editing the JSON by hand outside the app does not
  add one; the next save the app makes does.

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

## Import from a file

**Import from file** on the page header opens a file picker for one theme JSON, so a look can
move between profiles without anyone finding a folder.

- The chosen file is read (up to 256 KB), parsed with the same shared rules every save uses,
  and only then copied into the profile's `themes/` folder. It is not switched on by the
  import: the copy previews for ten seconds with **Keep** and **Revert**, like any new file.
- Its file name is the theme's own `name` — the file must already carry a lowercase slug
  (`night-runway` → `night-runway.json`), because that is the rule every theme name follows.
  An import never overwrites a file: when that name is taken, the copy becomes
  `night-runway-imported.json`, then `-imported-2`, `-imported-3`, and so on.
- A file that is not JSON, not a valid theme, or larger than 256 KB is refused with the reason
  it failed — the failing field (or colour pair) when the file parses, the parse error when it
  is not JSON — and nothing is written. The page's error banner carries the reason. Closing
  the picker without choosing a file does nothing.
- Like everything else on this page, an import is **data, not code**, and it lands in the app
  profile — never in the vault.
- Import and History are page gestures, not companion tools. The companion keeps
  `get_theme`, `validate_theme` and `write_theme`; these two are not exposed to it.

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
