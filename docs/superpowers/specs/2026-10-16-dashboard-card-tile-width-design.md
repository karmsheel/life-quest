# A dashboard card is as wide as the data it holds — and as wide as the operator says

**Status:** design
**Date:** 2026-10-16
**Touches:** `apps/desktop/src/components/home/tile-span.ts` (new),
`apps/desktop/src/components/home/useTileSpans.ts` (new),
`apps/desktop/src/components/home/useCardResize.ts` (new),
`apps/desktop/src/pages/HomePage.tsx`, `apps/desktop/src/styles/global.css`,
`apps/desktop/src/components/home/PinChrome.tsx`,
`apps/desktop/src/components/home/pin-order.ts`,
`apps/desktop/src/components/home/usePinArrange.ts`,
`apps/desktop/e2e/dashboard-tile.{html,tsx,electron.mjs}` (new),
`apps/desktop/tests/dashboard-tile-e2e.test.ts` (new),
`apps/desktop/e2e/dashboard-arrange.electron.mjs`, `apps/desktop/tests/dashboard-arrange-e2e.test.ts`,
`apps/desktop/e2e/dashboard-card-slot.electron.mjs`, `apps/desktop/tests/dashboard-card-slot-e2e.test.ts`,
`packages/vault-core/src/{views-tools,view-schema,pins,types}.ts`

## 1. The three reports, in the operator's words

> On the Dashboard the tables can change size but when made smaller, they often
> compress beyond the data they hold causing it to spill over. I want there to be
> more intelligent arrangement of cards and adjustment of sizes. Depending on the
> cards, we might only fit 2 on a certain line while on the next one fit 3. I want
> it to be like a Tile styled arrangement. Right now the Recent Transactions card
> is showing that spillover effect.

Fixed first — the spill. Then:

> Some tables are still showing lots of empty space — "Recent Transactions" as an
> example — the space between the Category and Amount columns are too much. Is
> there a way to give the user more control over the width of the tables/cards?

Fixed second — the empty space, and the control. Then, when asked what the control
should be, the operator chose **dragging a card's right edge** over a stepper, and
chose that a card's automatic width should **land close to its content**.

## 2. What was wrong — measured, in the operator's own vault

`domains/financial/pins.json` said the Recent-transactions pin was **one cell
wide** (17rem ≈ 272px) while the view file it pointed at said `span: 2`. The card's
content is a four-column listing — `date · payee · category · amount` — and every
listing cell is `white-space: nowrap`. A table does not shrink below its own
min-content width, and nothing in the sheet stopped it painting outside the frame.

**The spill, from the new rig on the pre-fix build:**

```
no-spill: FAIL — wide: view:financial:v-real ("Recent transactions") draws 29
element(s) outside its frame — worst td.view-card__cell--num by 15.6px
             wide: view:financial:v-listing draws 17 element(s) outside its frame
             — worst td.view-card__cell--num by 86px
```

Their own card, their own rows: 29 elements outside the frame, the money column
15.6px past the card's border. A controlled card with the same four columns and
payees that cannot wrap: 86px.

Once the sizing was in, the second report was measurable too, and it was the same
fault from the other side — the card was sized in WHOLE cells:

| | before | after |
|---|---|---|
| The operator's card | 605px | **398.9px** |
| What its table needs | 347.7px | 347.7px |
| The table as drawn | 573px (stretched to fill) | **347.7px** |
| Empty space spread between the columns | **225px** | **19px, as margin at the card's right** |

The 225px was not the card being wide: it was a table told to be `100%`, sharing
the difference between its columns. A table's own `auto` means "fill the
containing block" too, so "leave it alone" was not an option.

## 3. The rule, in three parts

### 3a. A card is as wide as its content, in fine steps

Three numbers, all measurements rather than policies:

- **need** — the width below which a card's own content would overflow it. It is
  the card's `min-content` width: the browser already knows it, and the app reads
  it off the real card instead of modelling the query behind it.
- **step** — the track the board is actually drawing, `minmax(unit, 1fr)` resolved.
  The unit is `--home-tile-unit-rem: 4.25` — **a quarter of the 17rem cell this
  board used to be built from**, so every width the old grid could draw is still
  drawable, and a card that needs 398px asks for five tracks of 68.9px instead of
  six of a coarser grid.
- **floor** — `--home-tile-min-units: 4`: the narrowest a card may be, so a metric
  does not collapse to a sliver.

```
units = max(floor, ceil((need + gap) / (step + gap)))     // how many tracks this card needs
board = max(2 × floor, every card's units)                // how narrow the board may be
```

`HomePage` renders the cards; `useTileSpans` measures them and writes each card's
`grid-column` and the board's `min-width`, straight to the DOM, in a layout
effect — the same way the arrange gesture writes its own geometry, and for the
same reason: a width is geometry, and a re-render between the measurement and the
write is a frame drawn at the wrong size. A window too small for the board's units
gets a board that is wider than it is: `.shell__content` is already `overflow:
auto`, so the sheet scrolls sideways.

**Why it does not oscillate.** A span decided from the width the card happens to
have would grow the tracks, which would shrink the span, for ever. A track's width
does not depend on any one card: it is chosen by the window and the board's floor,
and its count is chosen to fit as many whole units as the width allows, so a track
lands in `[unit, unit + (unit + gap) / count]` — feeding that back reproduces the
same count. `boardWidth` is written as the exact inverse of the layout, and the
rig's `stable` claim holds the two together at four widths.

**Why it re-runs.** A card is a live query: it draws "Loading…" and then a table.
Three signals bring the hook back — the page's own commit (order, vault revision),
a card's box changing (`ResizeObserver`), and a card's insides being replaced
*inside a box that does not change* (`MutationObserver`: a card stretched by a
taller neighbour can receive twelve rows without its own box moving a pixel). Both
observers coalesce to one measurement per frame, and every pass is idempotent.

### 3b. A listing keeps its own width; an aggregate still fills its card

```css
.view-card__table--list { width: max-content; max-width: 100%; }
```

`max-content` is the table's own answer: the width at which every column is drawn
at the size its content wants, none stretched and none squeezed. `max-width:
100%` is the floor under it — a table is never wider than the card that holds it,
and because the card is never narrower than the table's min-content, that clamp
never has to squeeze a nowrap cell out of the frame. The leftover, when there is
any, stays at the card's right edge as ordinary margin.

The **aggregate** table (label + total) deliberately keeps filling its card: its
second column is a total, and a total belongs against the right edge the way a
statement reads.

### 3c. The operator's own hand: drag a card's right edge

The board sizes a card from what it holds; the operator asked for more control, and
the right edge of every view card on an unlocked board is now a handle.

- **The range is `[what the card's content needs, the whole row]`.** A drag can
  make a card wider than its table needs and can never make it narrower — because
  a card narrower than its table is the spill this board was reported for, and
  rebuilding that fault as a gesture would be absurd.
- **The far end of the range is the row**, stored as `span: 2` rather than as a
  very wide card, so a drag to the edge and a press of the chrome's "Fill the row"
  leave the board in one state instead of two that look alike and behave
  differently when the window moves.
- **Everything else is stored as the width in rem** (`Pin.width`), the number the
  operator saw: 35.01rem stays 35.01rem whatever the window or the layout unit
  does. The renderer draws `max(content, that width)` in units, so a stored width
  can never be honoured into a spill.
- **The preview is geometry, the drop is the write.** While the pointer is down the
  card's `grid-column` is written straight onto the element; nothing reaches the
  vault until the pointer comes up, and a drag that ends where it started writes
  nothing at all.
- **The keyboard's half.** The handle is a `separator` and a tab stop: the arrows
  step one unit per press and each press is saved, and the live region says what
  the width now is. A screen reader's owner resizes a column the same way.
- **`aria-valuenow` is written by the measurement pass, not rendered.** The
  measurement happens after React has rendered, so attributes rendered from it
  would be a value behind — and a separator saying zero is worse than saying
  nothing. This is the same reason the span is written straight to the element.

Two mechanics are worth naming because they were measured, not chosen:

- **The drag's moves and its drop are on the window, not on the handle.** The
  handle is six pixels wide and the pointer leaves it on the first move; a drag
  that only heard the pointer while it was over the handle would stop the moment it
  began. `setPointerCapture` is asked for as well, but capture is a convenience
  here and never the mechanism — the rig proved that the hard way, when injected
  input retargeted every move to the card behind the handle.
- **The gesture is not the arrange gesture.** A press on a handle is skipped by
  `usePinArrange` (`[data-pin-handle]` joins the buttons and links it already
  ignores), and the handle carries its pin in its own attribute rather than in
  `data-pin-id`: every card lookup on this board — the drop geometry, the scroll
  hold, the arrange gesture — is a `[data-pin-id]` query, and a handle wearing it
  would be read as a card.

### 3d. Naming a span replaces the width

`Pin.width` is the operator's; `span` is how wide a card is. A caller that names a
span has said what the width is, so the dragged width goes — two answers to one
question is how a board ends up disagreeing with itself. A caller that names
nothing is editing the card's contents and must not lose it: `placeViewPin` keeps
it, `get_dashboard` returns it, and `arrange_dashboard` carries it through, because
the companion's own instructions are to copy each pin back exactly as it came.

### 3e. The gesture ships gated, behind Settings → Developer

The operator asked for the resize gesture to be gated, and it is: **off by
default**, switched on in Settings → Developer → *Card width handle*.

Off means the board does not draw the edge, does not offer its tab stop, and does
not answer a press where it would have been. On means the same element, the same
gesture, and the same stored width as everything above describes — the gate is a
gate, not a second implementation.

Three decisions inside that are worth naming:

- **It is a store, not a context provider.** The first cut was a provider, and it
  was wrong in a way only a rig caught: a mount that forgot the provider fell back
  to the default value, whose `setFlag` still wrote storage but had no state to
  re-render — so the Developer switch wrote the flag and the page kept drawing
  itself off. `developer-flags.ts` is a `useSyncExternalStore` store instead: the
  switch, the board, and a harness that mounts one page on its own all read one key
  and all hear one change, and there is no tree to be missing from. It also listens
  for the DOM's own `storage` event, so a flag changed in another window is a flag
  this one follows.
- **It lives in `localStorage`, not in the vault.** A developer flag is a fact
  about this install and this person, not about the vault: two people opening the
  same vault are not agreeing to run an unfinished gesture, and `settings.json` is
  a file the vault's own tools describe as the operator's settings.
- **The gesture refuses to start when the flag is off**, and not only because the
  handle is absent. A tab stop left behind, a stale render, or a rig reaching for
  `[data-pin-handle]` all have to find a hook that will not begin — an edge that is
  gone from the eye but still listening is a feature nobody can switch off.

The update preview's switch is deliberately not part of this store even though it
is drawn on the same page: it is not a preference about the app, it is a stand-in
for a feed, and it belongs to the provider that owns the feed.

## 4. What this is NOT

- **Not a masonry layout.** Cards still sit on one track grid with equal-height
  rows; what varies is how many tracks a card holds. Column-major packing and
  dense back-filling were both rejected: the board's order is its layout — a drop
  resolves against the cards' own rects — and a visual order that disagreed with
  the array would make arranging lie.
- **Not a per-card scroller and not a clip.** The operator chose the board
  scrolling sideways over a scrollbar inside a table, and hiding a column would be
  hiding data.
- **Not a rewrite of `ViewCard`.** A card does not report its own width; it is
  measured, so a card the app has never seen — a companion-composed one, a page
  card, the Active-agents card — is sized by the same rule.
- **Not a change to what `span` means.** `span: 2` still means the full row and an
  edit that names no span still leaves a card's width alone. `width` is additive
  and absent on every pin that existed before this change.
- **Not a wider arrange gesture.** The drag still reads rects; the only thing the
  finer grid broke was the keyboard's "one row", which used to be the grid's track
  count.

## 5. How it is falsified

`tests/dashboard-tile-e2e.test.ts` reads `e2e/artifacts/dashboard-tile.json`, which
`e2e/dashboard-tile.electron.mjs` writes by driving the real `HomePage` in a real
window at four widths (1280, 700, 520, and 1280 again), on a board that pins the
operator's own card — their rows, their columns, their view file's `span: 2` on a
pin that says `span: 1` — among cards of known width.

| Leg | Claim |
|---|---|
| `no-spill` | No descendant of any card is drawn outside that card's frame, at every width. **Red pre-fix: their card, 29 elements, worst 15.6px; a controlled listing, 86px.** |
| `card-fits-its-table` | A listing draws at the width its columns need and the card around it is within one step of that width; the one-number metric stays at the minimum card. **Red pre-fix: both cards one cell, 297.8px, with 84px spread between the columns.** |
| `operator-card` | Their real card holds its cells and is wider than the metric beside it. **Red pre-fix: one cell, 29 elements outside the frame.** |
| `rows-mix` | Across the widths some line holds three cards and some line holds two, and no width draws every card alone on its own line. **Red pre-fix** (at 520px every card is alone). |
| `row-card` | A card the operator stored across the row is drawn across the whole row, at every width. Green pre-fix — the control that stops "everything is content-sized" from passing. |
| `board-floors` | At 520px the board is wider than its scroller, the scroller can move sideways, no track is below one unit and no card below one minimum card. **Red pre-fix: a 464px board in a 512px scrollport, one 464px track.** |
| `stable` | A content-sized card draws in the same number of units at every width, and the round trip back to 1280px reproduces the board exactly. Green pre-fix, and the claim that says the finer grid did not introduce an oscillation. |
| `no-write` | Sizing the board never asks the vault for anything. |
| `width-control` | The width control names the two widths it offers. **Red pre-fix**, which is how the copy change is covered. |
| `resize-gated-off` | With the Developer flag off the board draws no width handle, a press where the edge would have been starts no resize and writes nothing, and the card keeps the span its content asked for; with the flag on the same board draws one handle per view pin. **Red against the code before this change** (no gate existed) and red against a build that drew the edge while gated, which is what the first cut of the provider did. |
| `resize-handles` | Every view pin draws a well-formed width handle, and a locked board draws none. **Red against the code before this change: the handle does not exist.** |
| `resize-drag-widens` | A drag aimed two units wider leaves the card exactly two units wider, in one write whose stored rem width is the width on screen. |
| `resize-survives-a-reload` | A fresh render of the same board draws the card at the width the drag chose — the difference between "the card is wide" and "the card is that wide". |
| `resize-drag-floor-is-the-content` | Widened first and then dragged hard in, the card stops at what its content needs, writes that width, and holds every cell. |
| `resize-drag-row` | A drag to the board's right edge stores `span: 2` with no width — the row, not a very wide card. |
| `resize-keys-step` | One ArrowRight steps exactly one unit, writes once, and says so in the live region. |
| `resize-is-not-arrange` | A 420 ms press on the handle starts a resize, lifts nothing, and writes nothing. |

And `tests/dashboard-card-slot-e2e.test.ts`, through the app's own MCP door: a
`width` on a pin **survives** `arrange_dashboard` (twice, the second time with the
pins exactly as the board returned them) and **survives** a `save_view` edit that
names no span, and is **replaced** when a span is named — span 2, no width.

The gate has a second rig, because the switch lives on a different surface:
`tests/update-badge-e2e.test.ts` already drives Settings → Developer, and it now
holds the card width handle to its contract there — the row exists, it comes up off
with nothing stored, and turning it on writes the key the board reads. That rig's
harness mounts the settings page **without** any developer provider, which is not a
coincidence: the store is what makes that mount work, and it is the failure the
first cut shipped.

The artifacts are `e2e/artifacts/dashboard-tile.json` with
`dashboard-tile-wide.png` (the board the operator works on) and
`dashboard-tile.png` (the narrow window, where the sheet scrolls sideways rather
than a listing pouring over its own frame): same command, same numbers, no
eyeballing the app.
