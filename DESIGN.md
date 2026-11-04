# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--canvas-base` is the window mat, and the fill of the nav rail; the rail runs to the window's top edge, so the mat is the sidebar all the way up. `--titlebar-bg` is the window's top strip, from the rail's trailing edge to the window's trailing edge — and the dock's bottom action row wears the same fill, so the dock is capped by one material: by day it is the mat ink, so the chrome above and beside the sheet reads as one band; at night it is one step darker than the mat and still clear of the page, so the strip and the icon row read as chrome above and below the rail rather than another stretch of it. `--card` is the card step: cards, panels, menus, popovers and the composer, all lifted off the page. `--background` is the page canvas — the sheet, the dock and the titlebar's domain tab are painted with it — and it aliases `--bg` so outline controls blend. By day skins write `--canvas-base` from the palette background, or mix toward ink when background equals card; at night it is the palette's quiet band.

Day and night run the ladder in opposite directions. By day the mat and the panels sink below the paper, so the sheet reads as the lit surface. At night **every** dark palette inverts: the page canvas is the deepest surface in the window — the sheet, the dock, the boot pane and the titlebar's domain tab all paint `--background` — the cards and the panels take `--card` and step up off it, and the mat takes the palette's quiet band, the very ink `--muted-surface` is made of. So in every night skin the window's frame is one material, and nothing in the window paints below the page. The titlebar strip and the dock's bottom action row (`.chat-panel__actions`) are the surfaces that leave that band: both wear `--titlebar-bg`, the mat stepped halfway toward the page, so the strip above and the icon row below are darker than the rail they cap and never as dark as the page. By day the one-band rule stays — there strip, rail and action row are the mat. A palette earns all of it by keeping `background` its deepest ink and giving `muted` a step above it; the mat and the strip follow both without a per-skin value.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`. `--scrollbar-thumb` is the scrollbar's ink: an alias of `--muted-foreground`, so a skin repaints the bar with the rest of the chrome and the brand cannot reach it.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex. Titlebar overlay reads `--titlebar-bg` (falling back to `--canvas-base`) and `--foreground` hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Dark Ladder — at night the page canvas is the darkest surface: the sheet and the dock paint `--background`, the cards and the panels step up off it, and the mat wears the palette's `--muted-surface` ink. Never paint a card or the mat below the page. **Named exemption:** a skin that is a faithful copy of an upstream theme may declare `darkLadder: "inverted"` and keep that theme's own elevation direction. `nous` does, because GitHub Dark Default puts its cards below its page. The mat still lifts off the page either way; both rigs assert the *declared* direction rather than skipping the claim.
- Palette-Only Skin — a skin carries a palette and, optionally, font stacks. It does not ship layout, radii, motion, imagery or a `[data-skin]` CSS layer. The one exception this file ever granted — Nous's type treatment, orbit art and mat texture — was retired when Nous was replaced by the Hermes Desktop preset.
- Scrollbar Is Chrome — every native scroller wears the app's own bar rather than the platform's: `0.5rem`, a transparent track, and a pill thumb drawn **quietly at rest** and strengthened when its own region is hovered (then again under the pointer). The ink is `--scrollbar-thumb`, the palette's mid ink, so a skin repaints the bar and the accent never tints it. Geometry is fixed at rest and on hover, so strengthening the bar cannot reflow the content it belongs to. **Deliberate difference from Hermes:** Hermes draws no thumb at all until its region is hovered, which reads to an operator as "there is no scrollbar here"; this app keeps the shape and keeps the bar findable. A custom scrollbar follows its own region, never hover anywhere in the app.
- One Frame Per Card — a card draws its own shell, and its container adds none. A wrapper around a card carries layout markers only (`.view-card--span2`); giving it the card's own class nested two shells and put a frame inside a frame on every view pin.
- One Box — a markdown editor is `LiveMarkdownEditor`, one surface where the file renders and the paragraph under the caret does not. Never add a second pane beside it: two surfaces that show the same file can disagree about it, and the operator has to read both to know which one is right.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First — canvas vs sheet is the elevation ladder; do not add shadows beyond `--shadow-sm` on the sheet. **Named exemption:** the Decisions inbox cards (`.decision-card`) are the one surface that stands proud of the sheet — the operator answers them one at a time, so each wears a neutral grey step, `--shadow-card`, and the hover slash, and runs tighter than a page card (three-line rationale, an 8rem cap on proposal prose, compact field rows). **Named exemption:** the `raised` `Button` variant (`.btn-raised`) lifts the Daily Note's own act off the page — a face, a bevel and a lip rather than a flat fill — because that control is what commits the prose under it; every other control on the sheet stays on the flat ladder.
- Calm Scale — radii are `6 / 12 / 18 / 24 / --radius-pill`. Do not change the type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost` | `raised`, plus `destructive` (maps to `.btn-danger`). Pill radius via `.btn`. Links via `to`. No Radix.

**Named exception — the journal's own page.** `Daily Note` (`.daily-note`) wears `.btn` at `--radius-xs` rather than the pill, the same way `.data-studio` and `.pages-studio` already square theirs. The day's page is a page of prose with a pager above it and a strip of days below, and a row of pills around a paragraph reads as chips rather than as the page's own controls. The step is the Calm Scale's own smallest, so the primitive is worn at a different step rather than restyled, and the override lives in `notes.css` with the page's other chrome.

**Named exception — settings rows.** A button in a `SettingsRow`'s control (`.settings-card__control .btn`) wears `--radius-sm`, the settings card's own corner step, rather than the pill. A settings row is a label on the leading edge and a control on the trailing one; a pill beside a line of text reads as a chip that has floated away from its row, and the operator asked for the pill to stop there. The override is scoped to the row control's box in `global.css`, so every other wing — including a settings page's actions outside a row — keeps the pill.

**Named exception — the journal's act.** The Daily Note's manual automations — the built-in `Analyze note` first among them — are `Button variant="raised"`: the skin's accent sunk into the page canvas (`--raised-fill-top` / `--raised-fill-bottom`), a lit top edge, a hard lip and the sheet's drop shadow, drawn at the page's `--radius-xs` step like every other control there and sitting on the box's trailing edge under the prose it commits. The day's page is the one surface whose action commits the writing above it, so it is the one control that stands proud; the look lives in the Button primitive (`.btn-raised`) and the token file, so a feature file still restyles no button, and any surface that later asks for the same act wears the same key.

`SettingsSection` / `SettingsRow` own settings heading and row chrome. Settings cards use `--radius-sm`.

**Named exception — the inbox's answers.** The Decisions card's `Approve` / `Reject` controls are `.btn` at `--radius-xs` and larger than the primitive's default padding: a card is one question with two answers, and a pill there reads as another badge beside the domain and status pills above it. The radius is the Calm Scale's own smallest, as with the journal.

The settings sheet is a workbench and stops at its own measure: `72rem`, centred in the scrim. On a window wider than that — an ultra-wide monitor — the extra width is mat on both sides, not more form: the nav keeps its column and the page keeps its line, and neither stretches because the display did. The decisions sheet does the same at its 56rem reading column. A narrow window still shrinks either panel to fit.

The settings search is Hermes Desktop's floating field: a short pill (`20rem`, not a full-width top strip) centred over the panel with the panel's top border running through its horizontal axis — half in the sheet, half over the scrim. It is the one control in the app whose shape is its own outline rather than a box, because it has no panel corner to agree with. There is no title band above the page: the cross is pinned over the page's own top-right padding and takes no layout height, so the section nav and the page start at the panel's top edge, immediately under the floating bar. Only the search crosses that edge; every other piece of chrome stays inside the frame.

A settings row is a flex pair: the label and its description on the leading edge, the control on the trailing edge, a real gap between them, and a hairline between one row and the next. Do not go back to stacking them: the copy and the control pressed against each other is the layout this rule exists to prevent.

`Toggle` (`.ui-toggle`) is the on/off bit whose change takes effect the moment it is flipped — arming a destructive restore, for instance. It is not a checkbox: a checkbox says "include this in the set" and is read on submit, a switch says "this is on now". It carries no caption by default because the row's own label names the setting; the Books rows pass one (`Allow restore`) because their row label is a domain name. The track stays `--radius-pill`, and the Books rows wear the larger `--toggle-*` step the operator asked for.

`LiveMarkdownEditor` (`.note-live`) is the studio's one markdown surface. Every editor that writes markdown — a daily note, a doctrine document, a review — is this box: the file reads as prose and the paragraph under the caret is its raw markdown, in place. A locked document renders the same box read-only, with no writing line at all. There is no split editor and no preview pane beside it.

The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) on a `--shell-frame` (12px) canvas mat. The rail wears the mat itself (`--canvas-base`) and runs to the window's top edge in its own column, so the sidebar is the mat all the way up; the strip above the sheet and the dock wears `--titlebar-bg` — the same mat ink by day, one step darker at night — and therefore begins where the rail ends, at the sheet's leading edge. The sheet, the dock and Welcome wear the page canvas, `--background`. `.shell` carries no gap — the panes abut, and there is no mat under the titlebar: the sheet and the dock meet the strip directly, and the frame survives only as the right and bottom slack the panes carry into their own boxes. The sheet's leading edge meets the rail, its trailing edge the dock's leading edge, its bottom edge the window's bottom, exactly as the dock is flush to the window's right and bottom. Between panes each pane paints its own trailing hairline: the rail's trailing hairline is the seam with the sheet, and the sheet's trailing hairline is the seam with the dock. The sheet's top, leading and bottom edges paint nothing else — the strip meets it as a change of tone and no line crosses there — and the rail paints no top, leading or bottom edge either. The sheet's top bar is gone: no line runs under the strip across the sheet, and the page begins directly at the strip's bottom edge, reclaiming the 44px band the top bar held. The domain lens moved up into the strip as the page's own tab — it starts 12px past the rail's trailing hairline, flush with the window's top edge at the strip's full height, painted on the page canvas (`--background`) so it reads as the sheet raised through the chrome. Its top corners are rounded by the same 8px step, and its two bottom corners flare into the page with small concave fillets of that same step rather than meeting the sheet on square inside corners — the rounded top and flared base together are what make it a tab attached to the page. It draws no frame or outline of its own, the segmented control inside it (Overview, then every live domain in sort order, arrow keys included) compacts to fit the strip, and it is `no-drag` — the empty leading half of the strip remains the window's drag handle. The rail's wing-switcher band and the dock's header keep that 44px band (`--shell-topbar-height`); the dock's header paints its own bottom hairline, no longer a line running on from a sheet band, and the rail's band under the wing switcher still paints no line of its own. The boot surfaces — the vault picker and the companion setup screen, both `.welcome` — are that same pane with no rail or dock beside them: flush to the window's other three edges and meeting the strip directly, and the one place the pane still draws a full box, because no neighbour's line can be the seam there. The sheet is square on every corner, like the rail and the dock: it is a pane, not a card, so no corner of it is notched out of the mat. Only the sheet keeps `--shadow-sm` (Flat First). `.shell` is the grid tray, not a sheet. Feature files must not add a second frame or extra glass.

The tray's last two panes trade places — the dock's bottom action bar carries the switch-position control, immediately left of its collapse control, and it swaps the dock's column for the sheet's (`.shell--chat-left`, one click and one click back). The rail never moves: it is the window's chrome, not a pane of this tray, so it holds the leading edge and the dock sits just past it, with the sheet taking the trailing column and the `--shell-frame` slack out to the window's own right edge, exactly as the dock does from the other side. Everything the two panes own travels with them: the sheet paints the seam on whichever edge faces the dock and never on both, and stays square on every edge and corner in both arrangements. It is session state like the rail's own collapse — a way of looking at the workspace for a moment, not a stored preference.

The rail's collapse narrows it to an icon column (`--shell-sidebar-width-collapsed`) instead of taking it away. The pane stays where it is, at the window's leading edge and running to the window's top; the same toggle stays in its header and turns around, the page rows keep their icons, counts and names, and the governed shelf and the foot stay put. The chats list leaves the column while it is thin — it cannot be said in one icon — but the five-wing switcher turns vertical and keeps the first level of navigation reachable, stacked above the active wing's page rows. The rail's foot is the Log and the vault chip on one row in the wide rail, half each; thin, the Log's icon keeps its place and the chip becomes the vault's initials directly underneath it. The titlebar carries no vault chip: the strip's leading half is the window's drag handle, broken once by the domain tab just past the rail, and the rail's trailing hairline is the seam in both widths. The tab moves with the rail — 12px past the 16rem rail, and 12px past the 3.5rem icon rail once collapsed — and it exists only while the shell is mounted, so the welcome and companion screens get a strip with no tab. The wing switcher is a square block in both layouts — no corner radius, its frame set inside the rail's own padding, so the columns on either side of it are one thin, equal margin. The sheet keeps its own trailing hairline for the dock.

## Remaining visual do-not-do

Do not add dot-grid, Inter/Geist as default UI fonts, a pill composer, `PageShell`, or reclaim `--accent` as hover.

## Nous and Nous Classic

Both are **copies of Hermes Desktop's bundled presets**, taken from
`apps/shared/src/theme-presets.ts` in the Hermes install. Hermes ships them as its
product identity — `nous` is its `DEFAULT_SKIN_NAME` — so LifeQuest carries the
same two names and the same palettes rather than a re-derivation of them, and a
user moving between the two apps sees one look. Re-import from Hermes rather than
hand-editing hexes here.

Neither is a special skin. Both are **palettes and nothing else**: Hermes's theme
model keeps layout, sizing, radius and typography out of the palette, and both
themes declare only the system font stacks, no imagery and no second accent. So
neither has a `[data-skin]` CSS layer, and the type treatment, orbit art and mat
texture that this file once specified for Nous are retired.

| | **Nous** | **Nous Classic** |
| --- | --- | --- |
| Hermes id | `nous` | `nous-alt` |
| Idea | "GitHub chrome, Nous blue accent" | "Glass neutrals, cream on mission-blue" |
| Light | GitHub Light Default + `#0053fd` | `#f8faff` glass + `#0053fd` |
| Dark | GitHub Dark Default + `#4a84fe` | `#ffe6cb` cream on `#0d2f86` |
| Brand blue | the accent only | the surface itself |

Two mapping notes, both deliberate:

- **`background` and `card` are swapped in the light palettes.** LifeQuest's light
  ladder sinks the mat below the sheet: `background` becomes `--canvas-base` (the
  rail, and the titlebar by day) and `card` becomes `--background` (the sheet).
  Hermes has no such ladder. Read straight across, Nous would paint a white rail
  around a grey sheet — GitHub's layout inverted — so Hermes's page white goes in
  `card` and its grey sidebar in `background`.
- **`nous` declares `darkLadder: "inverted"`.** GitHub Dark Default puts its cards
  (`#010409`) below its page (`#0d1117`). See the exemption under Dark Ladder
  above.

Classic's declared `color-mix(in srgb, …)` values are resolved to hex **in sRGB**,
faithfully, so the violet cast Hermes's own preset carries is preserved rather
than corrected. Fixing it would be a re-derivation, not a copy.

### Blending: OKLab, not sRGB

The one piece of Hermes's design style that is not a palette entry, and the piece
that matters most here.

`mix()` lerps gamma-encoded sRGB channels, which bends hue on the way: a saturated
blue mixed 88% toward white lands **~21° violet** of where it started
(`#0000f2` → `#e0e0fd`, measured). That is how a clean blue accent produced a
lavender selected row, a lilac chip border and a periwinkle mat — and it is a
property of the blend, not of the palette, so **no palette hex can fix it**. The
drift happens after the palette.

`mixOklab()` in `src/lib/themes/color.ts` (ported from Hermes's
`apps/desktop/src/themes/color.ts`) walks chroma and lightness instead and holds
the hue: the same blend lands **0.3°** off. `apply-skin.ts` uses it for the blends
whose ink is the brand — `--accent-tint`, the input edge and `--line`. Everything
else there blends neutrals, where `mix` is correct and there is no hue to
preserve.

Two things worth remembering when reading those numbers:

- Hermes's comment says 7.6°; that is for a different reference blue. The figure to
  trust is the one the rig measures, and it measures both mixers every run.
- Near white the metric stops meaning anything: OKLCH chroma collapses, so the hue
  angle of `#0053fd` at 88% is numerically unstable in either direction. The rig
  therefore asserts on a saturated seed (`#0000f2`) where the two mixers visibly
  part company, and only reports the near-white case.
