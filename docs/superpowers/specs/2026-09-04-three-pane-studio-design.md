# Three-pane studio — Design Spec

**Date:** 2026-09-04  
**Status:** Approved — implementation plan at docs/superpowers/plans/2026-09-04-three-pane-studio.md  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [BERD Visuals Phase 2](./2026-09-03-berd-visuals-phase-2-design.md)

Phase 2 put nav, main, and chat on **one** 24px paper sheet with a 20px mat. That reads as a large inner rectangle and wastes edge space. This spec splits the studio into three cards on a tighter desk.

---

## 1. Purpose

The vault-open chrome should look like three paper cards on the canvas: rail, main app, Hermes chat. Corners are tighter. The mat is thinner. Identity stays Grounded life studio — not BERD glass panes.

### Success criteria

- Rail, `.shell__main`, and `.chat-panel` are three separate `--card` rectangles at **12px** radius.
- Outer mat and gutters between panes are **12px** (`--shell-frame`).
- Welcome stays one card at 12px on the same mat.
- Titlebar stays flush on `--canvas-base`.
- Life Map still bleeds only inside main (`/chart`).
- Settings cards use `--radius-sm` (12px).
- Pills, `--accent` brand alias, fonts, glass, and `PageShell` stay as Phase 2 left them.
- `npm test` and `npm run typecheck` in `@lifequest/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Structure | Three paper cards: **rail / main / chat**. Not one studio sheet. |
| 2 | Desk | **Tight.** `--shell-frame: 12px` is outer mat **and** column gap. |
| 3 | Pane radius | **12px** (`--radius-sm`) on all three. |
| 4 | Inner cards | Settings cards also `--radius-sm` (12). Not rounder than the pane. |
| 5 | Implementation | Paint existing columns. No `StudioPane` / `PageShell`. |
| 6 | Separators | Gap is the split. Drop rail `border-right` and chat `border-left`. Each card still has a 1px `--border` and `--shadow-sm`. |
| 7 | Collapsed chat | Still the third grid column (`2.75rem`), same card chrome, just narrow. |
| 8 | Welcome | One card (no three panes). Same 12px radius and 12px mat. |
| 9 | Titlebar | Unchanged: canvas fill, overlay `--canvas-base`. |
| 10 | Map | `shell__content--bleed` still only on `/chart`, inside main. |
| 11 | Token scale | Keep `6 / 12 / 18 / 24 / pill` in `tokens.css`. Stop using `--radius-lg` for the studio. Do not delete `--radius-lg`. |
| 12 | Out of scope | Glass, dots, fonts, `--accent` reclaim, pill composer, leftover `.btn` class-name migration. |

---

## 3. Architecture

Chosen: **CSS on the boxes we already have.** Rejected: new pane wrappers; fake inner panes inside one sheet.

```
.app-root                         → canvas
  WindowTitleBar                  → canvas (unchanged)
  .app-root__body                 → padding: var(--shell-frame)   /* 12px */
    .shell                        → transparent grid; gap: var(--shell-frame)
      .nav-rail                   → paper card, 12px
      .shell__main                → paper card, 12px (TopBar + content)
      .chat-panel                 → paper card, 12px
    .welcome                      → one paper card, 12px
```

### 3.1 Tokens

`--shell-frame: 12px` in `tokens.css` (`:root` only; dark blocks do not copy it).

`--radius-sm` stays 12px. `--radius-lg` stays 24px unused by the studio.

### 3.2 Shell CSS

**`.shell`**

- Keep grid columns and collapsed-chat template.
- Add `gap: var(--shell-frame)`.
- Remove `background`, `border-radius`, `border`, `box-shadow`. Tray is canvas showing through the gap.
- Do not set `overflow: hidden` on `.shell` (that would clip child radii). Children clip themselves.

**`.nav-rail` / `.shell__main` / `.chat-panel`**

```css
background: var(--card);
border-radius: var(--radius-sm);
overflow: hidden;
border: 1px solid var(--border);
box-shadow: var(--shadow-sm);
```

`.nav-rail`: remove `border-right`. Background was `--bg-panel`; use `--card` so all three rungs match.

`.chat-panel`: remove `border-left`. Background was `--bg`; use `--card`.

`.shell__main` currently has no card paint; it gains the block above.

**`.welcome`** — `border-radius: var(--radius-sm)`. Keep card fill, border, shadow, `overflow: auto`.

**`.settings-card`** — `border-radius: var(--radius-sm)` (was `--radius-md`).

**Map** — no change to bleed rules. Main pane `overflow: hidden` still clips Map to the 12px card.

### 3.3 Tests

Update `apps/desktop/tests/shell-visuals.test.ts` and `tokens.test.ts`:

- `--shell-frame: 12px`
- `.shell` has `gap: var(--shell-frame)` and does **not** use `--radius-lg` / `--card` fill
- `.nav-rail`, `.shell__main`, `.chat-panel` use `--radius-sm` and `--card`
- `.welcome` and `.settings-card` use `--radius-sm`

Keep titlebar, Map bleed, pill, and Welcome-scroll assertions.

### 3.4 Constitution

`DESIGN.md`: the studio is three 12px `--card` panes on a 12px `--canvas-base` mat. `.shell` is the grid tray, not a sheet.

`ui/AGENTS.md`: do not wrap a second frame around a pane.

### 3.5 Rejected alternatives

| Alternative | Why rejected |
|---|--------|
| Keep 20px outer mat | Extra space the user called out |
| Flush to the window | Loses the desk; fights titlebar-on-canvas |
| 18px or mixed radii | Nav is ~68px wide; 12px is one system |
| `StudioPane` wrappers | DOM already has the three columns |
| Inner dividers plus gap | Double separator |

---

## 4. Edge cases

- Collapsed chat remains a card, not a floating icon on the mat.
- Boot `.centered-status` stays on canvas (no card).
- Hash route `/chart` only for Map bleed.

---

## 5. Open questions

None. Three panes, tight 12px desk, 12px corners, paint-existing-columns were approved in design review.
