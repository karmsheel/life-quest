# BERD Systems Phase 1 — Design Spec

**Date:** 2026-09-02  
**Status:** Draft — awaiting user review  
**Product:** LifeQuest — local-first life-management studio  
**Reference:** [block/berd](https://github.com/block/berd) design contract (systems only; not a visual fork)  
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Custom window chrome](./2026-08-28-custom-window-chrome-design.md)

Phase 2 (selected BERD visual elements: surface ladder, concentric radii, pill buttons, quieter chrome, composer) is **out of scope**. This spec is the contract that Phase 2 will restyle later.

---

## 1. Purpose

LifeQuest already has identity: vaults, domains, wings, Forge skins, and a warm-paper UI. What it lacks is BERD’s **design contract** — layered tokens, a closed primitive menu, agent-facing PRODUCT/DESIGN/LAWS, and enforcement — so every new surface does not invent colors and class names.

Phase 1 installs that contract **without changing how the app looks**. Skins, terracotta/Nous brand, window chrome, settings overlay, and `.btn` pages stay. New code authors against semantic tokens and primitives. Old CSS keeps working through aliases.

### Success criteria

- The running app looks the same at default skin, Nous, Midnight, light/dark/system.
- `tokens.css` has three layers: primitives (only hex) → semantic tokens → Life Quest extensions. Existing `--bg` / `--text` / `--accent` / `--muted` are aliases, not a second vocabulary.
- `apply-skin.ts` writes semantic + extension vars only. Aliases in `tokens.css` follow.
- `Button`, `SettingsSection`, and `SettingsRow` exist. Settings views (Appearance, Domains, Vault, Hermes, About) use the settings primitives. Hermes actions use `Button`. Other pages may keep `className="btn"` until touched.
- Root `PRODUCT.md`, `DESIGN.md`, and `LAWS/` exist. `components/ui/AGENTS.md` exists.
- A token/primitive audit runs as part of `npm test` in `@lifequest/desktop`.
- Titlebar overlay still tracks the skin: it reads hex from `--background` / `--foreground`.
- `npm test` and `npm run typecheck` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Visual identity | **Unchanged.** Skins, warm paper, Nous, orange/terracotta default stay. |
| 2 | Authoring API | **CSS-native.** No Tailwind, no CVA, no shadcn package. |
| 3 | Token layers | Primitives → semantic → Life Quest extensions. Hex only in primitives and skin palettes. |
| 4 | Semantic names | shadcn-style CSS variables (`--background`, `--foreground`, `--card`, `--primary`, `--destructive`, `--border`, `--input`, `--ring`, `--muted-foreground`, `--muted-surface`, `--accent-fill`). |
| 5 | Brand collision | Life Quest `--accent` **stays brand**. It aliases `--primary`. Hover fill is `--accent-fill` (today’s `--selected-soft`). Do not reclaim `--accent` as hover in Phase 1. |
| 6 | Muted collision | Life Quest `--muted` **stays text color**. It aliases `--muted-foreground`. Quiet fill is `--muted-surface` (today’s `--bg-muted`). |
| 7 | Skin writer | Named `ForgeSkin` fills the semantic contract. ThemeProvider does **not** synthesize a palette from one primary hex. |
| 8 | Skin inline vars | Write semantic + extension names only. Never inline `--bg`, `--bg-app`, `--text`, `--fg`, `--accent`, `--accent-fg`, `--accent-hover`, `--accent-strong`, `--muted`, `--danger`. |
| 9 | Titlebar overlay | Read `--background` and `--foreground` (hex). Do not read `--bg` / `--text` after they become `var(...)` aliases — `getPropertyValue` returns the alias text, which `overlayColor` rejects. |
| 10 | Primitives | `Button`, `SettingsSection`, `SettingsRow`. Keep `ListRow` and `SegmentedControl`; point their CSS at semantic tokens. |
| 11 | Button look | Current `.btn` metrics: 8px radius, current padding, primary fill, bordered secondary, danger as red text/border. **Not** `rounded-full`. |
| 12 | Button variants | `primary`, `outline`, `ghost`, plus `destructive` on `outline` (current `.btn-danger`). No filled red button — Life Quest does not have one. Settings use `primary` / `outline` / `destructive` only. `ghost` may exist unused. |
| 13 | `.btn` compatibility | `Button` applies the existing `.btn*` classes internally. Leftover `className="btn"` in feature files remains valid. No Radix Slot; in-app links use a `to` prop that renders `Link`. |
| 14 | Settings migration | Appearance, Domains, Vault, Hermes, About use `SettingsSection` / `SettingsRow` (or section + existing `dl` where a row does not fit). Same spacing, cards, and type as today. Not BERD’s 44px rhythm. |
| 15 | PageShell | **Deferred.** Full-bleed custom pages; a BERD `max-w-5xl` shell would be a visual change. |
| 16 | Constitution | Root `PRODUCT.md`, `DESIGN.md`, `LAWS/`. Primitive rules in `apps/desktop/src/components/ui/AGENTS.md`. |
| 17 | Laws vs tokens | Token naming is **not** a law. Laws are observable product behavior. |
| 18 | Enforcement | Node test + small scanner. No in-app design-system explorer. |
| 19 | Default skin | Still `forge-os`. Dual-palette vs dark-only listing unchanged. |
| 20 | Phase 2 | Separate spec. Do not start pill buttons, canvas/glass, radius scale, Inter/Geist, or `--accent` reclaim here. |

### Explicitly out of scope

- Tailwind 4, CVA, shadcn components, in-app explorer
- `PageShell` / `PageHeader`, Dialog rewrite, `GlassButton`, composer wrappers
- Migrating every `.btn` (Documents, Personnel, Act, Welcome, …)
- Dot-grid canvas, `card-glass`, 6px concentric radii, `rounded-full` buttons
- Reclaiming `--accent` as hover fill
- New product features, i18n, assistive-ux, BERD chat-queue laws
- Changing skin marketplace behavior (which skins appear for light/dark/system)

---

## 3. Architecture

Chosen: **alias-first CSS contract**. Rejected: Tailwind authoring API; big-bang `--bg` deletion; docs-only constitution.

```
primitives (hex in tokens.css + themes/presets.ts)
  → semantic tokens (:root / [data-theme="dark"] / skin inline)
    → compatibility aliases (--bg, --text, --accent, --muted, …)
      → existing CSS (.btn, .settings-card, map.css, …)
    → new primitives (Button, SettingsSection, SettingsRow)
```

### 3.1 Token layers (`apps/desktop/src/styles/tokens.css`)

**Layer 1 — primitives.** The only literal colors in `tokens.css`: current light paper (`#faf9f7`, `#1a1916`, terracotta, borders, state greens/reds/blues) and the matching dark block + `prefers-color-scheme` fallback. Keep `[data-theme="dark"]` and the system media query. Do not add a `.dark` class.

**Layer 2 — semantic tokens.** Values are the current look, renamed.

| Semantic token | Phase 1 value (current look) |
|---|---|
| `--background` | current `--bg` |
| `--foreground` | current `--text` |
| `--card` / `--card-foreground` | current `--bg-elevated` / `--text` |
| `--popover` / `--popover-foreground` | current `--bg-elevated` / `--text` |
| `--muted-surface` / `--muted-foreground` | current `--bg-muted` / `--text-muted` |
| `--primary` / `--primary-foreground` | current `--accent` / `--accent-fg` |
| `--secondary` / `--secondary-foreground` | current `--accent-soft` / `--text` |
| `--accent-fill` / `--accent-fill-foreground` | current `--selected-soft` / `--text` |
| `--destructive` / `--destructive-foreground` | current `--red` / readable-on-red (`--accent-fg` / white) |
| `--border` | current `--border` |
| `--input` | current `--border-strong` |
| `--ring` | current `--selected` |

**Layer 3 — Life Quest extensions.** Named product jobs, not aliases of layer 2: `--composer-*`, `--bg-panel`, `--bg-subtle`, `--border-soft`, `--line`, `--sidebar-border`, `--text-strong` / `--text-soft` / `--text-faint`, `--primary-hover` (today’s `--accent-hover` math), `--selected` / `--selected-soft` if kept as aliases, `--green` / `--blue` / `--amber` (+ bg/border), `--shadow-*`, `--stroke-nous`, `--shell-*`, `--window-titlebar-height`, map tokens. Do not add BERD `canvas-base`, `card-glass`, or dot-grid variables.

**Compatibility aliases** (defined in `tokens.css` only; skins must not override them as inline hex):

| Alias | Resolves to |
|---|---|
| `--bg`, `--bg-app` | `--background` |
| `--bg-elevated` | `--card` |
| `--bg-muted` | `--muted-surface` |
| `--text`, `--fg` | `--foreground` |
| `--text-muted` | `--muted-foreground` |
| `--muted` | `--muted-foreground` (text, not surface) |
| `--accent` | `--primary` (brand, not hover) |
| `--accent-fg` | `--primary-foreground` |
| `--danger` | `--destructive` |
| `--success` | `--green` |
| `--selected` | `--ring` |
| `--selected-soft` | `--accent-fill` |
| `--accent-hover`, `--accent-strong` | `--primary-hover` |
| `--accent-hover-fg` | readable-on `--primary-hover` (same as today) |
| `--color-bg` / `--color-text` / `--color-muted` / `--color-focus` | existing mappings, via semantic names |

`--accent-soft` and `--accent-tint` stay **extensions** (current CSS uses them). Skins still write those two plus `--primary-hover`. They are not the semantic `--accent-fill` hover token.

**Authoring rule.** New primitives and new CSS use `var(--foreground)`, `var(--primary)`, `var(--accent-fill)`, `var(--muted-foreground)`, `var(--muted-surface)`. Hex in a component file is a defect. Hex in `tokens.css` primitives or `themes/presets.ts` is allowed.

### 3.2 Skins (`apply-skin.ts`)

`SkinColors` already uses shadcn-like fields (`background`, `foreground`, `card`, `primary`, `accent`, `destructive`, `ring`, …). Keep that TypeScript shape (Hermes Desktop share). Change the **CSS write**.

`forgeVarsFromColors`:

- Sets `--background` from `c.background`, `--foreground` from `c.foreground`, `--card` from today’s elevated/card pick, `--primary` from `c.primary`, `--primary-foreground` from `c.primaryForeground`, `--destructive` from `c.destructive`, `--border` / `--input` / `--ring` as today, `--muted-surface` / `--muted-foreground` from today’s muted math, `--accent-fill` from today’s `--selected-soft` math.
- Forge field `accent` stays a soft fill / secondary (current `accentSoft` mix). It must **not** become `--primary`.
- Still computes extensions: `--bg-panel`, `--bg-subtle`, `--border-strong` / `--border-soft`, `--line`, `--sidebar-border`, `--text-strong` / `--text-soft` / `--text-faint`, `--primary-hover` (same hex as today’s `--accent-hover`), `--accent-soft`, `--accent-tint`, composer vars, Nous `composerRing` shadows/fills, `--green` / `--blue` / `--amber`.
- Does **not** inline `--accent-hover` / `--accent-strong`; those alias `--primary-hover` in `tokens.css`.
- Same mix/dark-detection math as today so palettes do not shift.

`clearSkinVars` removes only semantic + extension names. After clear, `tokens.css` aliases restore the default paper theme.

`ThemeProvider.syncTitleBarOverlay` reads `--background` and `--foreground`. Keep `overlayColor`’s `#` / `rgb` guard. Update `apps/desktop/tests/window-chrome.test.ts` to expect those property names.

### 3.3 Primitives (`apps/desktop/src/components/ui/`)

Visual treatment lives in shared UI. Feature files compose.

**`Button`**

```ts
type ButtonVariant = "primary" | "outline" | "ghost";
type ButtonProps = {
  variant?: ButtonVariant; // default outline
  destructive?: boolean;
  to?: string; // react-router Link; no Radix Slot, no new dependency
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "href">;
```

- Default `type="button"` unless submitting.
- Internally applies `.btn` plus `.btn-primary` / `.btn-secondary` / `.btn-danger` so the look cannot drift from leftover class usage.
- `ghost`: same metrics, transparent fill, hover uses `--accent-fill`. May ship unused in Phase 1.
- `destructive` applies `.btn-danger` (red text/border). Combining `primary` + `destructive` is invalid — stay on the danger outline look; do not invent a filled red button.
- Feature code must not pass color / hover / background classes. Layout classes (`w-full`, `ml-auto`) are fine.
- Prefer `Button` for new clickable controls in migrated settings. Do not ban leftover `.btn` elsewhere.

**`SettingsSection`**

Owns the current heading: icon well, title, subtitle, then the card. Class names stay the current `settings-panel__*` / `settings-card` so CSS does not move. Props: `icon`, `title`, `subtitle`, `children`.

**`SettingsRow`**

Owns `settings-card__row` (label, description, action slot). The row is not a button. Interactive controls live in `action`. Appearance’s theme segmented control is the proof row.

Vault’s `dl` can sit inside `SettingsSection` without being forced into rows. Hermes fields stay `.settings-field`; submit/test actions become `Button`.

**`ListRow` / `SegmentedControl`**

No API change. Their CSS uses semantic tokens (via aliases this is already true if aliases sit under the old names; still replace direct `--text` / `--muted` in those rules when touching them).

### 3.4 Constitution (repo root)

**`PRODUCT.md`** must include: users (person running a local vault), purpose (life-management studio: domains, doctrine, decisions, log, optional Hermes), personality (focused, capable, companionable), anti-references (generic chatbot wrapper, dark terminal skin, metric dashboard, marketing chrome, novelty AI, habit-tracker scoreboard, game HUD), principles (context legible: domain / wing / room / vault; quiet chrome; settings/skins/Hermes are workflow; operational truth; continuity is files on disk).

**`DESIGN.md`** must include: Creative North Star “Grounded life studio” (not BERD’s workbench copy), token layers and both collisions, skin write-path, primitive menu, named rules, Phase 2 do-not-do list.

Named rules to document:

- **Token Contract** — semantic names in new UI; aliases only for old CSS.
- **State Color** — red/green/blue/amber mean state, not decoration.
- **Theme Provider** — named skins fill the contract; do not generate a palette from one hex.
- **Raw Color** — hex only in primitives and skin palettes.
- **Closed Primitive** — extend `Button` / settings primitives instead of restyling in features.
- **Flat First / Calm Scale** — record now; Phase 2 restyle uses them. Phase 1 does not change elevation or type scale.

**`LAWS/README.md`** — BERD’s rules-for-laws: observable product behavior, not implementation; one requirement per law; `MUST` / `MUST NOT`; code and tests conform.

**Laws (one file or one heading per law):**

1. Opening a vault **MUST** be identity. The product **MUST NOT** require an account to use a vault.
2. API keys **MUST NOT** be stored in the vault.
3. The domain switcher **MUST** be the data filter for domain-scoped lists.
4. Wings **MUST NOT** filter Home, Life Map, Log, tasks, or any page’s data.
5. Forged doctrine **MUST NOT** be edited in place. Changes **MUST** go through Decisions.

Do not add token-layer laws. Existing Superpowers specs remain the feature source of truth; laws do not replace them.

**`apps/desktop/src/components/ui/AGENTS.md`** — prefer primitives; closed Button menu; no hex; no color classes on `Button`.

### 3.5 Enforcement

`apps/desktop/scripts/design-system-tokens.mjs` (or a `tests/design-system-tokens.test.ts` that inlines the scan). Wired into `@lifequest/desktop` `npm test`.

Must fail when:

- `apply-skin.ts` assigns `--bg`, `--bg-app`, `--text`, `--fg`, `--accent`, `--accent-fg`, `--accent-hover`, `--accent-strong`, `--muted`, or `--danger` as inline keys.
- `apps/desktop/src/components/ui/*.{ts,tsx,css}` contains raw `#` hex or `rgb(`/`hsl(` (comments allowed).
- `forgeVarsFromColors` does not emit `--background` and `--primary`.

Must pass today’s presets (hex in `presets.ts` is allowed).

Unit tests in `apps/desktop/tests/` (desktop `npm test` only globs `tests/**/*.test.ts`):

- Default skin name remains `forge-os`.
- Dual-palette vs dark-only listing unchanged (existing `src/lib/theme.test.ts` coverage can move or be duplicated into `tests/` so `npm test` actually runs it — `src/lib/theme.test.ts` is **not** in the desktop test glob today; Phase 1 must put skin/token tests under `apps/desktop/tests/`).
- `forgeVarsFromColors` sets `--primary` to `c.primary` and `--background` to `c.background`.
- Result keys do not include `--bg`, `--accent`, `--accent-hover`, or `--muted`.
- `tokens.css` defines `--accent: var(--primary)` and `--muted: var(--muted-foreground)` (or equivalent alias).
- Window chrome test expects `--background` / `--foreground`.

### 3.6 Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Tailwind 4 + shadcn utilities | User chose CSS-native; visual lock is easier without a utility migration |
| Delete `--bg` / `--accent` in one pass | High restyle risk; fights “systems only” |
| Docs-only PRODUCT/DESIGN | Agents would still restyle in `global.css` |
| PageShell in Phase 1 | Would impose BERD page width on full-bleed pages |
| ThemeProvider generates tokens from primary hex | BERD anti-pattern; Life Quest skins are named palettes |
| `--accent` means hover in Phase 1 | Breaks every `.btn-primary` |

---

## 4. Components and files

| File | Change |
|---|---|
| `apps/desktop/src/styles/tokens.css` | Three layers + aliases |
| `apps/desktop/src/lib/themes/apply-skin.ts` | Write semantic + extensions; update `clearSkinVars` |
| `apps/desktop/src/lib/themes/types.ts` | Document semantic keys if `ForgeSkinVars` is narrowed |
| `apps/desktop/src/components/theme/ThemeProvider.tsx` | Overlay reads `--background` / `--foreground` |
| `apps/desktop/src/components/ui/Button.tsx` | New |
| `apps/desktop/src/components/ui/SettingsSection.tsx` | New |
| `apps/desktop/src/components/ui/SettingsRow.tsx` | New |
| `apps/desktop/src/components/ui/AGENTS.md` | New |
| `apps/desktop/src/components/ui/ListRow.tsx` | Token-bind only if CSS is inline; else CSS in `global.css` |
| `apps/desktop/src/styles/global.css` | `.btn` / settings classes stay; `ghost` if needed; semantic vars in rules we touch |
| `apps/desktop/src/components/settings/*.tsx` | Use section/row/Button |
| `apps/desktop/scripts/design-system-tokens.mjs` | Scanner |
| `apps/desktop/tests/apply-skin.test.ts` | Writer contract |
| `apps/desktop/tests/design-system-tokens.test.ts` | Scanner runner or inline |
| `apps/desktop/tests/window-chrome.test.ts` | Overlay token names |
| `apps/desktop/package.json` | Include scanner in `test` if it is a separate script |
| `PRODUCT.md`, `DESIGN.md`, `LAWS/*` | New at repo root |
| `README.md` | Link the constitution next to existing design table |

No vault-core changes. No Electron main-process changes except none expected (overlay IPC already exists).

---

## 5. Error handling

- Invalid stored skin name still falls back to `forge-os`.
- `setTitleBarOverlay` failures stay swallowed.
- If `--background` / `--foreground` are missing or not hex/rgb, skip overlay update (same as today’s `overlayColor` null path).
- Scanner failures fail `npm test`; they do not affect runtime.

---

## 6. Testing

- `node --experimental-strip-types --test` under `apps/desktop/tests/`.
- Scanner as a test or `node scripts/design-system-tokens.mjs` invoked from the desktop test script.
- `npm run typecheck` in `@lifequest/desktop`.
- Manual look lock: Welcome, Settings (all five sections), Home, Life Map, one skin switch (Nous), light/dark. No intended pixel change.

---

## 7. Phase 2 boundary (do not implement)

Recorded so agents do not “complete” Phase 1 by restyling:

- Surface ladder (`canvas` / `card-glass`), dot-grid
- 6px radius scale, `rounded-full` buttons, badge vs button shape split
- Pill composer, glass top bar / nav
- Inter / Geist Mono as default UI fonts
- `--accent` reclaimed as hover; drop brand alias
- `PageShell`, migrating remaining `.btn` as a visual pass

Phase 2 gets its own spec after Phase 1 ships.

---

## 8. Open questions

None. Identity (B, systems first), authoring (CSS-native), approach (alias-first), token layers, skins, primitives, and constitution were approved in design review.
