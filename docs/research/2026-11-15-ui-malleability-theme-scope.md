# UI malleability — theme scope, chrome components, and the ladder to game-like interfaces

**Date:** 2026-11-15
**Status:** Analysis + recommendation. Supersedes the v1 scope of
[the personal agent experience spec](../superpowers/specs/2026-11-11-personal-agent-experience-packs-design.md) —
the pack machinery there is reused for distribution, but the first slice is UI, not persona.
**Decision it serves:** "a more customizable studio" → the operator's *interface* becomes theirs, and the built-in Pi companion is the thing that writes it.

---

## 0. The correction this doc makes

The earlier spec optimised for the agent layer: persona, skills, routines. The actual request is
the other way round — **the interface is the product, and the agent is the author**. Concretely:

1. Users can create custom **themes** — starting from colour, growing in scope.
2. Themes can change **the shell's own components**: the wing switcher (left rail), the domain
   switcher (centre of the titlebar), and by extension the rail, titlebar, chat dock.
3. The far end of the ladder is a **different kind of interface**: a gamified, game-like HUD, or a
   space-age solar-system shell.
4. All of it authored by the user *and* the companion, the way Hermes Desktop and DSH let an agent
   drop in a plugin.

This doc separates those into four problems, states which are cheap, which are a UI framework in
disguise, and where I would stop.

---

## 1. Today's contract, precisely

| Surface | What it is today | Evidence |
|---|---|---|
| **Theme = skin** | A `ForgeSkin` JSON: a palette (`colors`, optional `darkColors`, `darkLadder`) plus optional typography stacks. Shared shape with Hermes Desktop. | `apps/desktop/src/lib/themes/types.ts:1-74` |
| **Contract** | "A skin carries a palette and, optionally, font stacks. It does **not** ship layout, radii, motion, imagery or a `[data-skin]` CSS layer." | `DESIGN.md:28` |
| **Install** | From disk, hex-only validation, 24 installed max, curated in Settings, stored in `localStorage`. | `user-themes.ts:29-32`, `SkinPicker.tsx` |
| **Apply** | Writes ~50 CSS custom properties onto `<html>` and a `data-skin` attribute; shadows are *derived* from the palette, not authored. | `apply-skin.ts:82-126, :374` |
| **Restart bug** | The stored skin is only accepted if it is a built-in (`isBuiltinSkinName`), so the operator's choice of an *installed* skin is discarded on restart. | `storage.ts:8-19` |
| **Wing switcher** | `WingTabs`: five wings as a segmented control, hardcoded in the nav rail's top band. | `components/shell/WingTabs.tsx:8-11`, `NavRail.tsx` |
| **Domain switcher** | `DomainSwitcher`: Life + unlocked areas, rendered into `.window-titlebar__lens` (centre of the custom titlebar). | `WindowTitleBar.tsx:61`, `DomainSwitcher.tsx:13-19` |
| **Shell layout** | CSS grid driven by `--shell-nav-width`, `--window-titlebar-height`, `--shell-*` tokens; radius/type/shadow/shared tokens are global, not theme-settable. | `tokens.css:11-28,128-133`, `global.css:435-507` |
| **CSP** | `script-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; no `font-src` (falls back to `'self'`). No remote loads, no injected stylesheet file, no code path for UI. | `apps/desktop/index.html:7-8` |

The important consequence: **today a theme cannot move a single pixel of layout.** Radius, spacing,
motion, imagery and placement live in bundled CSS, and the only writable surface is colour + font
family stacks. Everything the user named beyond "custom colours" is therefore a contract change,
not a theme file feature.

### What the precedents actually do

Both cited harnesses give the *agent writes a file → app picks it up live* loop. Neither of them
solves it declaratively:

- **Hermes Desktop.** *Skins* are YAML palettes applied to CLI, TUI and GUI
  (`~/.hermes/skins/`, `hermes config set display.skin`, live repaint on every surface). *Structural*
  UI — panes, statusbar chips, palette commands, keybinds, routes, sidebar rows, transcript
  directives, and even theme *registration* — is a **plain-JavaScript ESM plugin** loaded at runtime
  from `$HERMES_HOME/desktop-plugins/<id>/plugin.js`, with a curated `@hermes/plugin-sdk`, hot
  reload on save, and per-plugin enable/disable in Settings. Panes declare `placement`/`dock` and are
  draggable afterwards. (Installed skill reference: `references/desktop-plugins.md`, `themes.md`.)
- **DSH.** Client UI plugins are bundled JS contributions to named slots; the config tree is data,
  the UI is code. (See [the analysis](../research/2026-11-09-plugin-system-analysis.md) §2.)

So "gamified solar-system theme" in Hermes is a **code plugin** rendering panes and overlays — not a
skin. LifeQuest's answer can be data-only only if the app ships a *vocabulary* rich enough that a
theme file can express the look. That vocabulary is the real design work, and it is why the ladder
below has a rung where "theme" becomes a small UI framework.

---

## 2. The ladder

Each rung is shippable alone and backward compatible: a plain `ForgeSkin` keeps working forever.

| Rung | What a theme can do | What it still can't | Contract change | Effort | Risk |
|---|---|---|---|---|---|
| **R0 — Palette** (shipped) | Colours, light/dark ladder, font family stacks | Anything layout, radius, motion, imagery | none | — | — |
| **R1 — Material** | Radius scale, borders, shadow depth, density, motion preset (bundled animations), type scale, procedural backgrounds (gradients/patterns), bundled icon set choice | Reposition anything; custom graphics | Extend the theme schema; make every component consume the token families; update DESIGN.md | 2–3 wks | Medium: component audit |
| **R2 — Chrome layout** | Declare where the shell's own components live and which variant they wear: wing switcher, domain switcher, nav rail, titlebar, chat dock; theme-scoped defaults + operator override | Move *pages* content; add new components; arbitrary DOM | Render the four shell components from a layout config; CSS per placement/variant; update DESIGN.md ("palette-only" becomes "data-only") | 3–5 wks | Medium-high: titlebar drag region, chat dock, aria/keyboard |
| **R3 — Scene** | Decoration layers: starfield/orbit/grid backgrounds (procedural + bundled raster images via `data:`), frames, card-chrome variants, animation presets | Place widgets; express a HUD; new interaction | Scene section + asset validation + CSP review for imagery | 3–5 wks | Medium: performance, spoofing, contrast |
| **R4 — Composition** | A widget vocabulary (meter, badge, avatar, quick action, list, timer, calendar, brief card) placed on named regions with stack/grid/polar layout — a gamified HUD or an orbital menu is a theme file | Genuinely new visuals/interactions outside the vocabulary | A UI DSL + renderer; a design system for packs; authoring UX | 8–12+ wks | High: this is a framework |
| **R5 — Code UI packs** | DSH/Hermes parity: real components | — | Sandbox, signing, publisher identity, review capacity | deferred | High: second code channel |

Two things this ladder makes explicit:

1. **The user's two named components are R2.** Wing switcher placement/variant and domain switcher
   placement/variant are cheap-ish, bounded renderer work — the most understandable ROI in the whole
   program.
2. **"Gamified" and "solar system" are R3 at best, R4 in full.** A solar-system *look* (background,
   icon set, floating chrome, motion) is R3. A solar-system *interface* (orbiting page nodes as
   navigation) is R4. A truly different interaction model is R5. Shipping R1–R3 and calling it
   "themes" is honest; promising R4 as a theme is not.

### Considered and deferred: raw CSS theme packs

Obsidian's model — a theme is a CSS file — is the obvious alternative, and the CSP actually contains
most of its egress risk (`style-src 'self'` blocks `@import`, `img-src` blocks remote `url()`).
I still would not do it in v1: CSS can spoof the Decisions UI, hide the reset path, and has no
semantic or contrast guarantees; the "palette-only" rule exists because the design system is a
contract, not a canvas. If R1–R3 prove too rigid, revisit CSS as R2.5 with a selector allow-list,
not as the primary format.

---

## 3. What a theme file becomes (draft v2)

Backward compatible: every section except `colors` is optional, and a plain `ForgeSkin` is a valid
theme.

```jsonc
{
  "name": "solar-system",                    // slug, same rules as today
  "label": "Solar system",
  "description": "…",
  "colors": { /* ForgeSkin colors + darkColors + darkLadder, unchanged */ },
  "typography": { "fontSans": "…", "fontMono": "…", "fontDisplay": "…" },

  "material": {
    "radius": "sharp",                       // sharp | soft | round
    "density": "airy",                       // airy | compact
    "shadow": "deep",                        // flat | soft | deep
    "motion": "lively",                      // none | calm | lively  (bundled keyframes only)
    "icons": "line"                          // bundled icon set id
  },

  "chrome": {
    "wingSwitcher":   { "place": "rail-top", "variant": "labels" },
    "domainSwitcher": { "place": "titlebar-center", "variant": "segmented" },
    "navRail":        { "place": "left", "width": "default" }
  },

  "scene": {
    "background": { "preset": "starfield", "intensity": "calm" }   // R3
  }
}
```

Placement/variant enums are closed and validated (a typo is a field-named error, not a broken app):

| Component | `place` | `variant` |
|---|---|---|
| `wingSwitcher` | `rail-top` (today), `titlebar-left`, `floating-left`, `hidden` | `labels` (today), `icons`, `compact` |
| `domainSwitcher` | `titlebar-center` (today), `below-titlebar`, `bottom-center`, `left-rail`, `floating-bottom-right`, `hidden` | `segmented` (today), `pill`, `icons`, `list` |
| `navRail` | `left` (today), `right`, `floating` | width `default` / `narrow` / `wide` |

Operators can override any of it in Settings; "Reset to default theme" is always one click away, and
a boot flag plus a shortcut restore the default if a theme hides its own controls.

---

## 4. The authoring loop (the actual "agentic" unlock)

This is what makes the feature feel like Hermes/DSH without their trust model:

1. The companion **writes a theme file** to a watched directory, exactly the Hermes
   `desktop-plugins` gesture: `userData/themes/<id>/theme.json` (app-level; a theme is about the
   window, not the life — see open questions).
2. The app **watches and hot-reloads** it — no restart, no rebuild.
3. Preview is **time-boxed**: the theme applies for ~10 seconds, then reverts unless the operator
   presses *Keep*. (The macOS display-settings gesture: try it, keep it, or it goes away.)
4. A **Log** line records the theme change; themes need **no Decision** — they are presentation-only
   and always reversible, which is exactly the class of change the app already applies immediately.
5. The companion gets two read tools: `get_theme` (the current theme + resolved layout, so it can
   iterate) and `validate_theme` (field errors + contrast report). It cannot see pixels; it composes
   from the vocabulary and the operator previews. Honest limitation, not a bug.

Two guardrails that matter more than they sound:

- **Contrast is enforced, not suggested.** The validator checks text-on-surface pairs against WCAG AA
  and refuses a theme that makes the app unreadable, naming the pair.
- **A theme can never hide the way out.** Window controls, the Settings entry and the reset shortcut
  are hard-coded, not theme-controlled. (This is also why R2 is safe: it moves chrome, it does not
  remove the escape hatch.)

Export: "Export current theme" writes the full JSON (palette + material + chrome + scene), which is
also the starting point for the agent — and the file you share with someone else. Sharing is a file
drop in v1; the pack registry from the earlier spec can carry themes later as `kind: "theme"`.

---

## 5. Recommended sequence

| Phase | Rungs | What the user gets | Effort |
|---|---|---|---|
| **1** | R1 + R2 | Theme v2: material tokens, movable wing/domain switcher (4 placements each), hot-reload + keep/revert, export, restart-bug fix | **6–8 wks** |
| **2** | R3 | Scenes: starfield/orbital backgrounds, frames, motion, bundled imagery; ship one showcase "solar system" theme authored through the agent | 4–6 wks |
| **3** | R4 | Widget vocabulary + regions; the first genuinely gamified HUD theme | 8–12 wks |
| **4** | R5 | Never planned. Revisit only under the condition set in the 2026-11-09 analysis (§7). | — |

Phase 1 is the "at the very least" the user described: themes that do more than colour, and the two
components they named become theme-controlled. It is also the cheapest rung where the answer
"your agent can restyle the app" is true.

---

## 6. Spike before Phase 1 (5–7 days, smaller than the pack spike)

| Day | Work | Exit |
|---|---|---|
| 1 | Theme v2 schema + loader from `userData/themes/` + watcher + export current | Round-trip a built-in skin to v2 and back with zero lost fields |
| 2 | Render `WingTabs` and `DomainSwitcher` from `chrome` config: 4 placements × 2 variants each | Both components move without breaking drag, chat dock, keyboard nav or aria |
| 3 | Agent loop: write theme → hot reload → 10s preview → Keep/Revert; contrast validator | Bad contrast refused with the pair named; timeout reverts reliably |
| 4 | Author a "solar system" theme *through the companion* on the bench; screenshot | A visibly different app, operated entirely through the agent, with the default one click away |
| 5 | E2E rig + artifact + report | `themes-v2.json` + `.png`; what moved, what didn't |

**Gate questions:**

1. Did a theme change the *shape* of the app convincingly, or only its colours?
2. Did moving the wing/domain switcher stay correct — drag, chat dock, keyboard, aria, focus?
3. Could a theme lock the operator out? Can they always reset without a working UI?
4. Did the agent compose a usable theme from the vocabulary without seeing pixels?
5. What did the component audit cost in CSS files touched, and does that scale to R3?

**Tooling note:** Day 2 can be built on UI SDK behaviors/primitives instead of hand-rolled roving focus; that option, its trade-offs and the principles worth borrowing are analysed in [the UI SDK incorporation note](2026-11-15-ui-sdk-incorporation.md).

**Kill signals:** R2 needs more than four shell components refactored; the titlebar drag region
cannot be preserved with a moved domain switcher; the component audit exceeds the spike; a theme can
strand the operator; the showcase theme still looks like a recolour.

---

## 7. Risks and kill criteria (Phase 1)

- **Component audit is the real cost.** 17.8k lines of CSS; shell/components assume fixed geometry.
  If R1's token families require touching more than ~20 files, cut R1 to type + radius + shadow only.
- **The titlebar is a drag region.** Moving the domain switcher out of it changes `-webkit-app-region`
  behaviour; test on Windows (the shipped target), not only the bench.
- **Two dock interactions.** Chat side/dock and nav collapse already solve layout; theme placement
  must compose with them rather than fight them.
- **Accessibility.** A theme that fails contrast, or moves focus order, fails review even if pretty.
- **Performance.** Animated backgrounds + backdrop blur on Electron; cap fps and offer `motion: none`.
- **Theme sprawl.** 24-install cap stays for v1; raising it needs a curation story.
- **Kill criterion:** if Phase 1 takes more than ~8 weeks, stop at "themes that also set material and
  move the two named components", ship it, and do not start R3 until a theme from outside exists.

---

## 8. Terminology

- **"Theme"** is the user-facing unit — it grows in scope, but stays one word and one file.
- **"Skin"** stays the internal name for the palette layer (the ForgeSkin shape shared with Hermes),
  not a separate product concept.
- **"Theme pack"** only when distribution/install matters, matching the earlier pack format.
- **Not "plugin"** for v1. In this product's security story a plugin means code; using it for JSON
  would teach the wrong expectation. Hermes makes the same split (skin = palette, plugin = code).

---

## 9. Open questions

Defaults I would take unless you object:

1. **Phase 1 includes R1 (material) as well as R2 (chrome), not just chrome.** Default: yes — moving
   controls without material tokens makes a theme feel incomplete.
2. **Storage: app-level `userData/themes/`, not the vault.** Default: yes — themes are about the
   window; the vault keeps life data. (Portability comes from export/import files.)
3. **v1 chrome scope: wing switcher + domain switcher only.** Nav rail position, titlebar style and
   chat-dock defaults are v1.1. Default: yes.
4. **Conditional themes** (a specific theme only while the Act wing is open — the gamified HUD case):
   default later, R3; it needs the layout config to be per-wing anyway.
5. **Ship one showcase theme** (solar system) authored through the agent, as the proof and the
   template. Default: yes.
6. **Keep "theme" as the word, drop "plugin".** Default: yes.

---

## 10. Relationship to the 2026-11-11 spec and the UI SDK note

The pack format, registry, install/Decision rules and draft-inert rule from the personal agent
experience spec are **reused**: a theme is a pack with `kind: "theme"` and no guidance. What moves is
the first slice — UI, not persona. Persona/skills/routines return later as a pack *kind*, after the
theme ladder has shipped, and the "extensions" settings section can be built once for themes and
reused then. Kits stay out.
