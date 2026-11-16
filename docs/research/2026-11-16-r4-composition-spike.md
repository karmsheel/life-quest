# R4 composition — spike contract (R4.0)

- **Date:** 2026-11-16
- **Branch:** `feat/r4-composition-spike` (off master `6a08030`)
- **Decision it serves:** "the operator's interface becomes theirs" — after R0–R3 restyle the shell *around* the pages, R4 lets a theme place things *on* them. The ladder's own words: a gamified HUD or an orbital menu is an R4 theme file, not an R3 look.
- **Why a spike:** R4 is the rung the analysis calls "this is a framework" (8–12+ weeks: DSL, renderer, pack design system, authoring UX). This spike buys evidence for a Go/No-Go before that money is spent. Its question is not "can it look nice" but **"can a closed, data-only vocabulary express a gamified interface without giving a theme a way to imitate chrome, hide the way out, or read anything it was not given?"**

## What R4.0 ships

1. The **contract** in `apps/desktop/shared/composition.ts`: three closed sets (regions, widget types, data sources), one layout enum, and a total field-named parser.
2. `composition` is an **optional** section of the v2 theme file — every R0–R3 theme parses exactly as before, and a theme with no composition draws nothing.
3. The companion's authoring loop learns it for free: `validate_theme` returns the parsed composition, `get_theme` reports which kept theme carries one, and `THEME_VOCABULARY` gains the composition lines (kept in `composition.ts` so enums and words cannot drift).
4. **No renderer in R4.0.** The gate is validation-only: a companion can author a composition and be told exactly what is wrong, before anything is drawn.

## The closed sets

| Set | Values | Why closed |
|---|---|---|
| `composition.layout` | `stack` | Grid/polar land in R4.2 with their own a11y story; today's parser refuses what it cannot draw. |
| `composition.widgets[].type` | `badge`, `meter` | Two primitives prove data binding and formatting (text count; count against a denominator). |
| `composition.widgets[].region` | `page.masthead`, `page.footer`, `rail.top`, `rail.footer` | Named mount points in the shell; a theme names a region, never a selector. |
| `composition.widgets[].data` | `domains.count`, `agents.count`, `decisions.count`, `goals.count`, `reviews.count`, `weekly.files` | Counts the shell already holds in the vault snapshot. A widget never fetches, subscribes or computes new state. |
| `composition.widgets[].tone` | `accent`, `muted`, `success`, `warning` | Token families, never colours — palette and contrast stay the skin's business. |
| `composition.widgets[].label` | ≤ 32 chars | A widget, not a page: the one place an author writes words, and it cannot carry markup. |
| `composition.widgets[].max` | integer 1–1000 (meter only) | The denominator is data, not CSS. |
| widget count | 1–6 | A region stops being a row and becomes a wall past six. |

## Shape

```jsonc
{
  "name": "helios",
  "label": "Helios",
  "composition": {
    "layout": "stack",
    "widgets": [
      { "type": "badge", "region": "page.masthead", "data": "goals.count", "label": "Goals", "tone": "accent" },
      { "type": "meter", "region": "rail.footer", "data": "weekly.files", "label": "This week", "max": 7 }
    ]
  }
}
```

The badge draws `label value`; the meter draws `label value/max` as a bar (`role="progressbar"` at render time). Both are drawn by the shell from tokens — the theme supplies numbers, names and a tone, never pixels.

## Validation rules (the R4.0 gate)

Every failure names the field: `composition.widgets[1].region must be one of page.masthead, page.footer, rail.top, rail.footer`. In particular:

- `composition` must be an object; `layout` must be `stack`; `widgets` must be an array of 1–6.
- Each widget: known `type`, known `region`, known `data`, non-empty `label` ≤ 32, known `tone` when present; a `meter` also needs integer `max` 1–1000.
- Unknown widget fields are ignored (the parser's existing posture); unknown enum values are refused.
- A theme with no `composition` is valid and unchanged.

## Operator semantics (R4.1, not this slice)

- Composition is **theme data**, so preview / Keep / Revert applies unchanged.
- The operator has one axis: wear the theme's widgets, or hide them; **Reset** hands the composition back to the theme. Reset lives in Settings, outside every theme's reach.
- A theme still cannot draw shell chrome, a Decision, or a control that removes the way out: widgets render inside named regions, and the Settings entry, window controls and preview bar are hard-coded.

## Non-goals (deliberately not in the spike)

- No arbitrary CSS, HTML, SVG, images, scripts, URLs or vault paths in a composition — data-only stays the format.
- No widget that acts (quick actions are R4.3, and even then they are a closed enum of routes, never a URL).
- No page-content placement (a widget cannot take over the page body), no theme-defined regions, no theme-defined data sources.
- No drag-and-drop authoring UI; the companion writes JSON, the operator previews it.

## Gates and Go/No-Go

| Slice | Gate | Evidence |
|---|---|---|
| **R4.0** (this far) | Companion authoring: `validate_theme` accepts a valid composition (layout + two widgets parsed back field-for-field) and refuses unknown type / region / data / layout, missing meter `max`, and a seven-widget list — each with the failing field named | rig report `r4Gate` checks + `themes-v2-r4-validation.json` |
| **R4.1** | Walking skeleton: the same file is worn; badge and meter paint in `page.masthead` and `rail.footer`; the operator toggle hides them; Reset restores; preview/keep/revert applies; no theme can remove Settings/controls | rig with screenshot artifact |
| **R4.2** | Grid + polar layouts, keyboard-complete orbital navigation, reduced-motion still, aria labels | rig with gamified HUD artifact |
| **R4.3** | Full vocabulary with closed data bindings; spoof audit; perf budget (node count, no layout thrash) | rig + audit notes |

**Go/No-Go questions the spike answers:**
1. Does a two-widget stack read as "the interface is mine" without touching page content? (If the answer needs arbitrary placement, that is a different, riskier product decision.)
2. Can the closed data bindings express what a gamified HUD needs without a fetch channel? (If not, the binding set grows — still closed, still listed.)
3. Does the operator's one-axis override (wear/hide + Reset) survive preview/keep/revert without new state? (It does if composition rides the theme file, as scene does.)

**Estimate for the rest:** R4.2 ~2–3 weeks, R4.3 ~3–4 weeks, showcase + gate ~1 week — matching the analysis' 8–12+ weeks; the spike is the part that tells us whether that budget buys a framework or a dead end.

## R4.1 result (2026-11-16)

The walking skeleton is worn, measured and taken back by the same rig:

- A companion-authored `composition-lab` theme (two widgets in the page masthead, one on the rail's foot) enters the normal preview gate; the masthead badge reads the seeded `weekly.files` count as `2`, the meter renders `2/5` with `aria-valuenow=2` / `aria-valuemax=5`, and the rail foot wears its own badge.
- The operator's one axis works from Settings › Appearance › Composition: **Hide widgets** removes every slot and marks the pick *yours*; **Reset to theme** puts them back; the Settings entry, preview bar and window strip stay painted throughout.
- Keep makes the composition durable; a newer composition file replaces it as a preview; Revert hands the kept widgets back — the composition rides the theme file's preview/keep/revert gate with no new state, as the spike predicted.
- Rig: **81 checks, 0 failures**; artifacts `themes-v2-composition.png` and `themes-v2-composition-settings.png` (1280x800, captured from the real window).

**Preliminary Go/No-Go:** the closed vocabulary, closed data bindings and one-axis operator override are sufficient for a walking skeleton and do not need a fetch channel, a DSL compiler or a new persistence store. The remaining rungs' risk is in R4.2's layout/a11y (grid, polar/orbital navigation), not in the data model — the spike answers its three questions: composition reads as the operator's interface, the bindings suffice for a HUD-like band, and the override survives the theme gate unchanged. The renderer currently draws all four regions; the rig exercises the two the ladder needs first (page masthead, rail foot).

## R4.2 result (2026-11-16)

Grid and polar are drawn, measured and reached:

- Contract: `COMPOSITION_LAYOUTS` is now `stack | grid | polar`; `grid` names `columns: 2|3`, `polar` names `radius: tight|default|wide`; the new `page.orbit` region is refused unless the layout is polar; the new `quickAction` widget points only at the six routes `COMPOSITION_ROUTES` admits. Widget ceiling raised 6 → 8 for a HUD-like band.
- Renderer: `grid` is a real CSS grid with the theme's column count; `polar` places widgets on a deterministic ring (top first, clockwise) using a single `--composition-angle`, with each action a plain `<Link>` inside a `nav aria-label="Quick actions"`. The orbit layer takes no pointer events itself (page stays usable) and is hidden at phone width. Nothing animates, so reduced motion is still by construction.
- Gate: the rig writes a polar theme, measures the four ring links' positions and DOM/href order, then focuses the first and sends three real `Tab` keystrokes (`webContents.sendInputEvent`) — the active element visits `goals, projects, notes`, i.e. the ring is keyboard-complete in drawn order. It emulates `prefers-reduced-motion: reduce` over CDP and asserts the widget's `animation-name: none`, then writes a 2-column grid theme and measures two columns × two rows. Revert returns the kept composition (no new state).
- Rig: **92 checks, 0 failures**; artifacts `themes-v2-composition-orbit.png`, `themes-v2-composition-grid.png`.
- **Go/No-Go after R4.2:** the remaining risk is vocabulary breadth (R4.3), not layout or navigation. The ring needed no runtime, no gesture model and no new persistence — a paper plan of positions and ordinary links. Keep grid/polar closed; do not add a drag/orbit control surface.

## R4.3 result (2026-11-16)

The rest of the vocabulary is bound, bounded and audited:

- Five widgets join badge/meter/quickAction: `avatar` (initials from `vault.name`), `list` (`domains.names` / `goals.titles`, limit 1–5), `clock` (24h/12h, a 30-second tick), `calendar` (this week, Monday-first, today marked `aria-current="date"`), `brief` (a closed count plus an authored caption ≤ 48 plain-text chars). Counts stay the six snapshot numbers; text stays the three closed name sources.
- Spoof audit is measured, not promised: the rig asserts zero `img` / `iframe` / `script` / `video` / `object` / `embed` / `button` / `form` / `input` nodes inside every composition region, every anchor is an in-app `#/` route (one, `/home`), and no widget paints a `url(...)` background. The eight-widget surface is **39 DOM nodes** against a 120-node budget, so a theme cannot turn the page into a painting.
- Gate refusals added for the new fields: avatar bound to anything but `vault.name`, list bound to non-name sources, a limit outside 1–5, a clock format outside 24h/12h, and a caption over 48 chars. Rig: **101 checks, 0 failures**; artifact `themes-v2-composition-vocabulary.png`.
- **Defect found and fixed while gating this slice:** the theme watcher could silently swallow a companion write. `ThemeProvider`'s subscription effect depended on `loadThemeFiles`, whose identity changes with theme state; every re-run did a *preview-disabled* read, and such a read records file mtimes without previewing. A write landing between a state change (e.g. a Revert) and that read was consumed — no preview, no error. The subscription is now stable (`loadThemeFilesRef`, mounted once) and a preview-disabled read surfaces the refusal it found instead of returning before `setThemeError`. Both fixes are in this slice because the gate itself smoked the bug: a vocabulary preview raced a Revert and silently vanished.

## R4.4 result (2026-11-16) — the gate

Helios lands as the showcase and as the gate. The bundled themes now include `showcase-helios`: a warm solar palette, the `orbit` backdrop, a haloed page, raised cards, and a six-widget `polar` composition — four quick actions, a Decisions badge and a week meter standing on the page in a deterministic ring. It seeds alongside Solar System into a fresh profile and is never worn implicitly. That is the "space-age solar-system-styled interface" the request named, expressed as one data file.

The gate itself is a companion story, not a rig-only story:

1. `write_theme` through the MCP door writes `helios-authored.json`; the real window previews it, and the probe finds the ring: `layout polar`, four links to `#/home`, `#/goals`, `#/projects`, `#/notes`, `aria-label "Quick actions"`.
2. The operator hides the ring from Settings → Appearance (one axis), the widgets disappear while the rest of the theme stays worn, and **Reset** brings the four actions back.
3. **Keep** persists the file name in main; a full `webContents.reload()` comes back with `kept: helios-authored.json` and the ring drawn again — a reload cannot lose it.
4. A spoofed Helios (`type: "image"`, `data: "vault.secrets"`) is refused at the door with `composition.widgets[0].type must be one of badge, meter, quickAction, avatar, list, clock, calendar, brief`, and no file appears on disk.

Rig: **106 checks, 0 failures**; artifact `themes-v2-helios.png` captured after the restart, showing the kept Helios composition. The same run keeps R4.0–R4.3's assertions green, so the ladder's top rung is verified by one continuous piece of evidence.

### Final Go / No-Go

**Go for the composition rung, with the scope boundaries already drawn (and still true):** 1–8 widgets, closed regions, closed data and text sources, three layouts, polar reserved for `page.orbit` actions, one badge/metric per ring widget, no drag/authoring canvas, no orbit control beyond Show/Hide/Reset. The vocabulary now covers the visible surfaces the product analysis asked for (counts, name/list, clock, week calendar, quick actions, avatar) while every value remains a number or a name the shell already holds. The audit is machine-checked: zero `img`/`iframe`/`script`/`video`/`object`/`embed`/`button`/`form`/`input` nodes in composition regions, anchors only in-app `#/` routes, no `url()` backgrounds, and the eight-widget surface at 39 DOM nodes against a 120-node budget (the same bounded-node discipline as the scene layer). Grid and polar ship with a keyboard-complete ring (Tab visits the actions in drawn order) and hold dead still under `prefers-reduced-motion`.

What still is **not** in R4, and would be the next decision rather than a defect: authoring by direct manipulation (drag on a canvas, orbit editor), free-form animation, sub-page composition, and code-bearing packs — the last is R5 and was never planned; it needs a sandbox, signing identity, publisher identity and a review flow before it can even be scoped.

The estimate held in shape: R4.0/R4.1 in days, R4.2 and R4.3 in weeks, R4.4 a day's gate once the vocabulary existed; the whole ladder remains inside the 8–12+ week product-analysis envelope for a personal, data-only theming studio.

## After the gate — R4.5: the Extensions page (2026-11-16)

The rung needed a place to live, and the naming question had a product answer. **Extensions** is the umbrella and the page; a single file stays a **theme**. Reasons sketched in the wiki page: the shipped model is data, not code, and calling it a *plugin* would promise an execution and trust model the app refuses (no pack code, strict CSP, one privileged window). Extensions leaves room for a second kind of extension later while the theme tools keep their names.

`/extensions` (rail row under Automations) is the operator's workshop over the profile's `themes/` files: list with labels, descriptions and feature chips; **Active** switch (a real `role="switch"`, on = keep, off = default look); **Try** (same ten-second preview gate as a companion write); **Edit** (raw JSON in a textarea, live validation using the shared parser, Save sent to main which re-parses and writes atomically; an invalid file disables Save); **Remove** (two presses); and **New extension** (blank material baseline, or a copy of the active look, slugged and uniquified). Nothing here is a second write path: the IPC handlers are `theme:read` / `theme:write`, `theme:write` validates with the same `parseThemeFile` the companion's tools use and only then touches disk.

Rig: **109 checks, 0 failures**, including the new page's three claims — the list shows the profile's files, a file can be created and edited in the app (with invalid JSON refused before disk and Save disabled), and it can be switched on/off and removed. Artifact `themes-v2-extensions.png` shows the page with the created extension active. The existing R4.0–R4.4 assertions stayed green in the same run.

What this slice does **not** claim: a third-party distribution channel, signing/publisher identity, or any executable code. Those remain the R5 conversation that was never planned; the Extensions page is where such packs would appear, not evidence that they exist.
