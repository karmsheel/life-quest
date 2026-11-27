# Customizations

**Customizations** is where the shell's data files live as objects you can act on: select one,
switch it on or off, edit it, or create a new one — without opening a folder or asking the
companion to write anything.

The page shipped as **Extensions** until that name stopped being honest. What the app ships is
**data**, not code: a theme file names colours, material steps, chrome placements, a scene, a
composition of page widgets and — inside its chrome — the agent picker's own mode. Nothing in
it can run, request, import or draw arbitrary markup. Calling any of it a *plugin* would
promise an execution model and a trust story the app deliberately refuses (no package code, a
strict content policy, one privileged window, an unsigned installer). **Customizations** is
the umbrella for the shell's own layer — the parts of LifeQuest the operator is allowed to
disagree with: themes today, and the components a theme may shape (the agent picker among
them), with room for the next kind without changing what the first one is. The page was
formerly Extensions; its old address `/extensions` redirects to `/customizations`, so pins and
bookmarks still land here.

A single theme file is still a *theme* everywhere it matters: the companion tools are
`get_theme` (the files, the kept theme, each theme's resolved scene and the pictures stored in
the profile's `backgrounds/`), `validate_theme`, `write_theme` and `store_background_picture`
(a vault image copied into that folder so a theme can name it), and the folder is `themes/`.

## Where it lives

- Wing: none. Customizations sits on the bottom shelf of the rail, below **Automations**.
- Rail: icon **Puzzle**, label **Customizations**. The row's stable id in saved preferences
  and pinned shelves is still `extensions`: those stores resolve a row by id, so the label and
  address moved while every operator's saved arrangement stayed put.
- Route: `/customizations`; the page's former address `/extensions` redirects here, so old
  bookmarks and pins keep working.
- Surface: a full page in the centre pane — a count line, a list of customization cards, an
  inline create panel, an **Import from file** action in the page header, and an inline
  editor with a visual **Fields** tab (whose **Components** section picks the agent picker's
  mode, below) and a **JSON** tab, whose panel also keeps the file's saved versions.

This page is part of the [Wiki home](./index.md).

## What a card shows

Each card is one file in the app profile's `themes/` folder (never the vault — a look is this
installation's, not the folder's). A card names the file's **label** and **file name**, its
own description if it has one, and a row of chips summarising what it changes: **Palette**
(or *Inherits palette*), `wings …` and `domains …` placements, **Material**, `sky …`,
`picture`, and `composition · N widgets`. An **Active** pill marks the one file the window is
wearing; a **Previewing** pill marks the ten-second preview currently on screen. A bundled
example's card also carries a **Gallery** chip (see below).

## The gallery of bundled examples

A fresh profile starts with **five** example themes already in its `themes/` folder, so the
possibility space is visible before asking an agent for anything: *Solar System* (the
dark-orbit sky with a haloed page and raised cards), *Helios* (the warm solar HUD whose page
stands on a golden ring of quick actions), *Paper Trail*, *Night Shift* and *Control Room*.

- **What the newer three are for** — each is a complete, valid theme file that shows a
  different corner of the contract, not a reskin of the same look:
  - **Paper Trail** — daylight, editorial: a light palette, sharp radius, compact density, a
    wash backdrop, the wing switcher at the titlebar's left and the area lens centred in it,
    and a stack composition of a brief and a list.
  - **Night Shift** — night, calm: a dark palette, round radius and calm motion, a starfield
    backdrop, a floating rail, and a polar ring of quick actions with a meter.
  - **Control Room** — instrument panel: a grid backdrop, a hairline edge on the page, a tall
    titlebar, and a grid composition of a badge, a meter and a quick action.
- **How they are marked** — every bundled card carries a small **Gallery** chip and the line
  *Bundled example — remove it and it stays gone.* They are ordinary files in every other
  way: try one, keep it, edit it, remove it; they count in the list like anything you wrote.
- **How they arrive** — a fresh profile gets all five on first run. A profile that already
  existed gets the three new ones added to the folder, without being handed back a Solar
  System or Helios it had removed: the app records the bundled theme names it has already
  offered in the profile's `theme-state.json` (`seededShowcase`), writes only names it has
  not offered before, and never overwrites a file. A gallery file the operator already has
  under one of those names is left alone (the name is recorded and the file is not touched).
  A recorded name is never re-added, so Remove is final.
- The older `showcaseSeeded: true` flag from previous versions is read as "these two were
  offered", so updating does not undo a removal made under the old scheme.
- Nothing here is code or a second page: the gallery is the normal list with five seeded data
  files and a chip, nothing more.

## The four verbs

A launch is not a write: the ten-second preview answers changes that land while the window is
open — a companion write, a save, a Try. Theme files that were already in the folder when the
window opened are listed, never worn, because the session's first read of `themes/` is its
baseline. Restarting the app therefore cannot hand you a theme you did not ask for, even when
the file's metadata moves while the window is still opening.

- **Active switch** — the toggle on the card. On keeps that file as the window's theme; off
  hands the window back its default look. A window wears exactly one theme file, so
  switching a second card on replaces the first: this is an on/off switch over *the window's
  look*, not a per-card parallel enable. The switch is a real `role="switch"` control with
  `aria-checked`, so it reads correctly to a screen reader and to a keyboard.
- **Try** — wear the file for ten seconds, with **Keep** and **Revert** on the preview bar,
  exactly as a companion write does. Trying never changes what is kept.
- **Edit** — open the file in the editor. A file that parses opens on **Fields**, where the
  look is built from controls; **JSON** is always one press away with the same file as text.
  The JSON editor validates as you type against the same shared rules the companion's
  `validate_theme` uses, and the verdict under the textarea names the failing field. **Save**
  sends the file to the main process, which re-parses it and only then writes it (atomically);
  a refusal is shown without touching the file. A save that lands previews through the same
  ten-second gate as any other changed file, so you see it before you keep it.
- **Remove** — two presses (**Remove** → **Remove?**) delete the file from the profile. A file
  the window is wearing is also unkept, so the next paint is the default look.

## Edit without JSON (Fields)

**Edit** opens the file in an editor with two tabs. A file that parses opens on **Fields** —
the studio where the look is built from controls rather than typed — and **JSON** is always
one press away with the same file as text. A file the parser refuses opens on JSON, because
the studio has nothing valid to paint. Switching tabs keeps the draft: Fields → JSON writes
the draft into the textarea, and JSON → Fields takes the text back only when it parses
(otherwise the parse error is shown and you stay on JSON).

The composition is authored first, in three parts:

- **The schematic** — the shell drawn as its five widget regions: the page's masthead, footer
  and orbit, and the rail's top and foot. Each region holds a chip for every widget placed
  there, and pressing a chip selects that widget for the form. The drawing is a map, not a
  canvas: it is decorative to a screen reader (the form is the source of truth), nothing is
  dragged or placed by pointer, and a live summary reads the surface back — *3 widgets: 1
  badge, 1 quick action, 1 brief.*
- **The widget form** — the selected widget's **type** (`badge`, `meter`, `quickAction`,
  `avatar`, `list`, `clock`, `calendar` or `brief`), its **region**, its **label**
  (≤ 32 characters) and the fields that type needs. A badge, meter or brief reads one of the
  counts the shell already holds; a quick action points at one of the app's own routes; an
  avatar reads the vault's initials; a list reads area or goal names, with a caption of at
  most 48 characters and 1–5 items; a clock picks 24h or 12h; a calendar draws this week; a
  meter also names its maximum. Every control offers legal values only, and a new widget
  starts with a sensible default for its required field, so the studio cannot assemble a
  widget the parser would call incomplete. Tones are named families, never colours.
- **The layout** — **stack** (a wrapped row in reading order), **grid** (2 or 3 columns) or
  **polar** (a ring on the page orbit, with a **tight**, **default** or **wide** radius). The
  region rules are said inline rather than enforced by silence: the orbit is only drawn in
  polar, and a quick action needs a route.

**Add** takes a type and a region and appends a widget to that region; it stops at **eight**
widgets and says why. Each widget can be **removed**, or moved **up** and **down** — the order
inside a region is the order stack and polar draw. The studio writes the same closed
vocabulary as the JSON tab: eight widget types, five regions, one of three layouts, and no
field the parser does not already know.

**The draft is temporary.** Every change repaints the window with the draft at once, so the
edit is seen on the app rather than imagined — and nothing is written, kept or previewed while
you edit: the file on disk does not change and no preview bar appears. **Cancel** (or closing
the editor) is a true undo: the draft is dropped and the window goes back to the look it was
wearing. **Save** validates the assembled file with the same parser and writes it through the
same gate as any save, so the new file previews for ten seconds with **Keep** and **Revert**.
If the file changes on disk while the studio is open — the companion writes it, or another
save lands — the draft is abandoned with a visible notice (*the file changed on disk — your
draft was discarded*) rather than fighting the newer file.

The composition has those three parts; the rest of the look — chrome, material, scene and
palette — sits below them in the same tab, described next. The **JSON** tab remains the whole
file as text.

## Look, without JSON

Below the composition, the same studio authors the rest of the theme file, so a whole look can
be built without opening the JSON tab.

- **Chrome** — where the wing switcher and the area lens sit and how they look, the sidebar's
  place and width, the chat dock's side, the height of the window strip and the agent picker's
  mode (its own section below): the same placements and variants Settings offers, written into
  the file's `chrome` block instead of stored as your overrides.
- **Material** — the six axes: radius, elevation, type scale, density, motion and backdrop.
  They are named steps, not free values, and the shell reads them as its own tokens.
- **Scene** — the **Sky** row (`plain`, `starfield`, `orbit`, `aurora`, `horizon` or `mesh`),
  **Intensity**, the picture layer and the two panel shades beneath those rows, plus the page's
  decorative edge and how its cards are drawn. The drawn presets are the app's own drawing: the
  file names one of them and supplies no image file, shader or stylesheet. The picture is a
  separate, declared field — `scene.background.image: { file, fit, position, dim, blur }` —
  where `file` names a picture already stored in the app profile's `backgrounds/` folder (never
  a path, a URL or the vault), `fit` is `cover`, `contain` or `tile`, `position` is `center`,
  `top` or `bottom`, `dim` is `none`, `soft` or `strong`, and `blur` is `none`, `soft` or
  `deep`. The file names the picture and never carries its bytes, so exporting a theme does not
  copy the picture: another machine falls back to the drawn preset until the same picture is
  chosen there. The same layer says how much of the backdrop shows through the shell's two
  panels — `scene.background.panels: { navRail, chat }`, each `solid`, `heavy`, `medium`,
  `light` or `clear` (`solid` paints the panel fully, `clear` lets the whole background
  through, the steps between shade it) — and either axis may be named alone, the other staying
  `solid`. The parser checks each field and names the one that failed
  (`scene.background.image.fit must be one of cover, contain, tile`;
  `scene.background.panels.navRail must be one of solid, heavy, medium, light, clear`), and a
  picture the profile no longer holds falls back to the drawn sky when the theme is worn. The
  studio's Scene section shows the picture rows and the **Sidebar** and **Chat bar** rows and
  writes them into the file like any other field.
- **Palette** — the light (`colors`) and dark (`darkColors`) palettes. Each is optional, but a
  palette that is present is **complete**: the editor writes the full set of colours the shell
  paints with — surfaces, text, borders and accents, each with the text colour it is paired
  with (19 colours). For each colour there is a colour picker and a hex field; **Copy current
  palette** seeds both groups from what the window is wearing now, so you edit deltas rather
  than type nineteen hex values. Each palette has its own on/off switch: turning one off
  removes that palette from the file and hands that half back to the skin, so a theme can set
  a day palette and inherit its night one, or the other way round.

**Contrast is checked before the file is saved.** Every text-on-surface pair the shell draws
runs through the same WCAG AA check the parser uses — 4.5:1 for normal text — and the verdict
under the palette lists each failing pair with its measured ratio and the minimum it needs.
While a pair fails, **Save** stays disabled; a save attempted through the JSON tab with an
unsafe palette is refused by main with the same sentence, naming the pair and both ratios.

**The draft rule is the same as for the composition.** Every chrome, material, scene or
palette change repaints the window at once; nothing is written, kept or previewed while you
edit, and no preview bar appears. **Cancel** drops the draft and hands the kept look back.
**Save** validates the whole file with the shared parser and writes it through the same gate
as any save, so it previews for ten seconds with **Keep** and **Revert**. The studio writes
only declared fields: no free CSS, no colour outside the palette set, no new key, and no image
bytes of its own — the picture layer names a file the profile already stores.

**This is not the same layer as Settings.** Settings → Appearance is *your* override layer: a
pick made there outranks the theme, is marked as yours, and survives the file being kept,
swapped or removed. The studio writes the file itself. The two stack — build a baseline in
the studio, tune it in Settings — and they are deliberately not unified.

## The agent picker as a component

The chat dock's who-answers control is a component too, and the operator is allowed to
disagree with its shape. A dense two-mark strip is right for someone who switches agents ten
times an hour and wrong for someone who has picked one agent and wants the composer quiet, so
the picker's form is data like everything else on this page.

Three modes ship:

- **One mark** — the default. Only the answering agent's mark, in the composer's trailing
  gutter on a wide dock (and just above the composer when the dock is too narrow to hold a
  gutter), with a chevron; the roster (every visible agent, with its name and blurb) opens from
  a menu. A menu costs one click, which is why this is the quiet default.
- **Named chip** — the same menu trigger, with the answering agent's name beside the mark: the
  picker says who answers instead of making you recognise the mark.
- **Quiet stack** — both marks on their own row under the composer, no capsule: one hairline
  each, the active one marked, one click to switch. The roster is always in sight, paid for
  with one line under the field rather than with the composer's own control row.

**Custom** is your own combination of four closed axes, each a named step rather than a free
value:

| Axis | Values | What it decides |
|---|---|---|
| **Roster** | `Menu` / `Inline` | Whether the agents are folded into one floating trigger or laid out in the open on a row under the composer. The only axis that changes behaviour, not just pixels. |
| **Labels** | `None` / `Agent` / `All` | How much of the agent is named: a mark, the answering agent, or every row. |
| **Ring** | `Accent` / `Hairline` | How the active choice is marked — the brand ring, or a hairline that defers to the composer's own outline. |
| **Size** | `Compact` / `Default` / `Large` | The mark's optical size, for a dense or an airy dock. |

A custom mode is **data in the theme file, never code**: it is written as
`chrome.agentPicker` — a `mode` name (a shipped mode or `custom`) plus, for `custom` or for a
tweak on top of a shipped mode, `recipe: { roster, labels, ring, size }`. The vocabulary is
closed on purpose: a theme can recombine what the renderer already draws, and nothing it names
can add a component, a stylesheet or a script. The parser refuses an unknown mode or axis
value by field name (`chrome.agentPicker.mode must be one of one-mark, named-chip,
quiet-stack, custom`; `chrome.agentPicker.recipe.size must be one of compact, default,
large`), so a bad theme is a named error in the editor rather than a dock that silently wears
something else — and a broken third-party theme can never make the dock unopenable.

There are two places to change it, and they stack the way the rest of the look does:

- **Customizations studio → Components** — open a theme's **Edit** panel and pick the mode (or
  the four axes) in **Components**. It writes the draft theme's `chrome.agentPicker`, and
  because the studio paints the draft, the dock behind the page shows the change live.
  **Save** writes it through the same parser gate as any other field, then previews for ten
  seconds with **Keep** and **Revert**.
- **Settings → Appearance** — the same control as *your* override. A pick made there outranks
  the theme, is marked as yours, and survives the file being kept, swapped or removed;
  **Reset to theme** hands the picker back to the theme's choice, exactly like the other rows
  in that section.

Both edit the same choice, and a theme's mode and your axis can layer: a theme that ships
**Named chip** still lets you set just **Size → Large** without flattening the mode into four
axes.

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

**New customization** opens a small panel: a name, and whether to start **Blank** or **Copy the
active look**.

- **Blank** writes a minimal, valid file — name, label, description and the material
  baseline — ready for colours and placements to be added in the editor.
- **Copy the active look** clones the file currently worn (or the first file, when nothing is
  kept) under the new name and label, so a variation starts from something you can see.

The file name is derived from the name as a slug (`Night Runway` → `night-runway.json`), with
`-2`, `-3` … appended when that name is taken. A fresh file previews immediately; the status
line names it and says so. Main validates the starter object before writing, so a new
customization can never be a file the shell cannot draw.

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
- Import and History are page gestures, not companion tools; the companion's four are
  `get_theme`, `validate_theme`, `write_theme` and `store_background_picture`. `get_theme`
  reports the kept theme, each theme's resolved scene — sky, intensity, frames, picture and
  panel shades — and the pictures stored in the profile's `backgrounds/`; `validate_theme` and
  `write_theme` take `scene.background.image` and `scene.background.panels` like any other
  field, so the agent can author them in the same closed vocabulary; `store_background_picture`
  copies a picture from the open vault into that folder and returns the file name, reading the
  vault and writing only the profile. A stored picture changes nothing until `write_theme`
  names it, and even then the window previews it for ten seconds with **Keep** and **Revert** —
  Keep is the consent. The operator's Settings override still outranks a theme.

## What it cannot do

- It cannot run code, make a request or draw markup — the file schema is the closed vocabulary
  described in [Settings](./28-settings.md), and main re-validates every save.
- It cannot carry a partial palette, or a colour outside the declared set: a palette is the
  complete required colour set when present, or absent so the skin shows through, and every
  text pair it paints must pass WCAG AA or the file is refused with the failing pair named.
- It cannot be arranged by dragging or given a new region: the schematic is a map of the
  regions a theme may use, and the form is the control. Placement is the closed vocabulary,
  never free positioning or CSS.
- It cannot draw over the way out: window controls, the Settings entry and the preview bar are
  outside every theme.
- It cannot change the vault. Customizations live in the app profile; the folder is untouched.

## Related

- [Settings](./28-settings.md) — Appearance, the theme layers a file may set, and the same
  file list inside Settings; its picks are your overrides and outrank the file the studio
  writes.
- [Automations](./17-automations.md) — the neighbouring shelf page that manages a different
  saved object.
- [Companion](./24-companion.md) — the theme tools the companion uses to author files.
- [Security](./29-security.md) — why a look is data, never code.
