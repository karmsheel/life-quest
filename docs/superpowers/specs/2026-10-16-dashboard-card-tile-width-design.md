# A dashboard card is as wide as the data it holds

**Status:** design
**Date:** 2026-10-16
**Touches:** `apps/desktop/src/components/home/tile-span.ts` (new),
`apps/desktop/src/components/home/useTileSpans.ts` (new),
`apps/desktop/src/pages/HomePage.tsx`, `apps/desktop/src/styles/global.css`,
`apps/desktop/src/components/home/PinChrome.tsx`,
`apps/desktop/e2e/dashboard-tile.{html,tsx,electron.mjs}` (new),
`apps/desktop/tests/dashboard-tile-e2e.test.ts` (new),
`packages/vault-core/src/{views-tools,view-schema,pins,types}.ts` (wording only)

## 1. The problem, as reported

> On the Dashboard the tables can change size but when made smaller, they often
> compress beyond the data they hold causing it to spill over. I want there to be
> more intelligent arrangement of cards and adjustment of sizes. Depending on the
> cards, we might only fit 2 on a certain line while on the next one fit 3. I want
> it to be like a Tile styled arrangement. Right now the Recent Transactions card
> is showing that spillover effect.

## 2. What was actually wrong — measured in the operator's own vault

Two files in `C:\Users\karms\Downloads\Life-Quest-Vault` disagree about how wide
that card is, and the disagreement is the whole bug:

| Read from | Value |
|---|---|
| `domains/financial/pins.json` → the Recent-transactions pin | **`span: 1`** |
| `domains/financial/views/4e864d44-….json` → the view itself | **`span: 2`** |
| Its content | a four-column listing: `date · payee · category · amount` |
| The sheet | `grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr))`, every listing cell `white-space: nowrap` |

The pin wins, so the card was given ONE cell of 17rem (272px) and asked to draw a
table that cannot shrink below its own min-content width. A table does not shrink
below min-content, and a `width: 100%` table keeps its *box* where it was told —
what leaves the frame is its cells. Nothing in the sheet said they could not.

**The number, from the new rig on the pre-fix build.** The rig pins both the
operator's card and a controlled one — the same four columns with payees that are
single long words, so the fault does not depend on their data being wide — and
walks every descendant of every card at four window widths:

```
no-spill: FAIL — wide: view:financial:v-real ("Recent transactions") draws 29
element(s) outside its frame — worst td.view-card__cell--num by 15.6px; …
       wide: view:financial:v-listing ("Last two weeks") draws 17 element(s)
outside its frame — worst td.view-card__cell--num by 86px
operator-card: FAIL — wide: the operator's four-column card was drawn in 1 track
(295.8px) — the reported fault
board-floors: FAIL — at 520px wide: board 464px in a 512px scrollport, tracks
[464] against a 272px cell
```

Their own card, with their own rows, hangs **29 elements** outside its frame and
pushes the amount column past the card's edge by 15.6px; the controlled card,
chosen to be wide in any font, by 86px. The subtle number is the operator's
report exactly — a money column bleeding a few pixels over the border rather than
a table falling off the card — which is why the claim is counted in elements
outside the frame and not in "does this look wrong".

## 3. The rule

**A card is as wide as the data it holds, and the board is as wide as its widest
card.**

Three numbers, each a measurement rather than a policy:

- **need** — the width below which a card's own content would overflow it. It is
  the card's `min-content` width: the browser already knows it, and the app reads
  it off the real card instead of modelling the query behind it.
- **cell** — the design's one-cell floor, `--home-tile-rem: 17` on the board.
- **gap** — the board's own gutter, from the same computed style.

```
cells  = ceil((need + gap) / (cell + gap))            // how many cells this card needs
board  = max(2, every card's cells)                   // how narrow the board may be
width  = board * (cell + gap) - gap                   // …in pixels, as the board's min-width
```

- `HomePage` renders the cards; `useTileSpans` measures them and writes each auto
  card's `grid-column: span N` and the board's `min-width`, straight to the DOM,
  in a layout effect — the same way the arrange gesture writes its own geometry,
  and for the same reason: a width is geometry, and a re-render between the
  measurement and the write is a frame drawn at the wrong size.
- The operator's own `span: 2` is untouched: it is painted `1 / -1` by the sheet,
  as it always was, and the hook deliberately skips it. `span: 1` is what changed
  meaning — it is no longer "exactly one cell" but "the board's choice", which is
  the half that was broken.
- A window too small for the board's cells gets a board that is wider than it is:
  `.shell__content` is already `overflow: auto`, so the sheet scrolls sideways.
  No card scrolls internally, nothing is clipped, and no column is dropped. This
  is the operator's own answer to the question, chosen over a per-card scrollbar.

**Why the arithmetic never oscillates.** A span decided from the width the card
happens to have would grow the tracks, which would shrink the span, which would
shrink the tracks — for ever, on some windows. Every input above is either a
measurement of CONTENT or a constant of the design, so a card's width never
depends on its neighbours or on the window, and a second measurement is the first
one again.

**Why it re-runs.** A card is a live query: it draws "Loading…" and then a table,
so the span cannot be decided once at mount. Three signals bring the hook back —
the page's own commit (order, vault revision), a card's box changing
(`ResizeObserver` on the cards), and a card's insides being replaced *inside a box
that does not change* (`MutationObserver`) — which is the case that matters most,
because a card stretched by a taller neighbour in its row can receive twelve new
rows without its own box moving a pixel. Both observers are coalesced to one
measurement per frame, and every pass is idempotent: a board that is already right
writes nothing and produces no further callbacks.

**What this gives the operator, in their own words.** On the rig's board, which is
their own card among cards of known width, the lines at 1280px hold **3 · 2 · 2**
cards and at 700px **2**, with each two-cell card taking a line of its own on the
narrow board. The number of cards on a line is an answer about the cards, not a
constant — which is what they asked for.

## 4. What this is NOT

- **Not a change to what `span` means in the vault.** The schema, the pin file and
  the tool arguments are untouched; `span: 2` still means the full row, and an
  edit that names no span still leaves a card's width alone. Only three
  *descriptions* changed, to say what the board now does with `span: 1`.
- **Not a masonry layout.** Cards still sit on one track grid with equal-height
  rows; what varies is how many tracks a card holds. Column-major packing
  (`columns: 3`) and dense back-filling were both rejected: the board's order is
  its layout — a drop resolves against the cards' own rects — and a visual order
  that disagreed with the array would make arranging lie.
- **Not a per-card scroller and not a clip.** The operator chose the board
  scrolling sideways over a scrollbar inside a table, and hiding a column would be
  hiding data.
- **Not a change to the arrange gesture.** The drag still reads rects and the
  grid's track count; nothing in `usePinArrange` moved.
- **Not a rewrite of `ViewCard`.** A card does not report its own width; it is
  measured, so a card the app has never seen — a companion-composed one, a page
  card, the Active-agents card — is sized by the same rule.

## 5. How it is falsified

`tests/dashboard-tile-e2e.test.ts` reads `e2e/artifacts/dashboard-tile.json`, and
`e2e/dashboard-tile.electron.mjs` writes it by driving the real `HomePage` in a real
window at four widths (1280, 700, 520, and 1280 again). The harness reproduces the
operator's card exactly: the view file says `span: 2`, the pin says `span: 1`.

| Leg | Claim |
|---|---|
| `no-spill` | No descendant of any card is drawn outside that card's frame, at every width — the reported fault as a measurement. **Red on the pre-fix build: the operator's own card, 29 elements, worst 15.6px; the controlled listing, 86px.** |
| `operator-card` | The operator's real card — their twelve rows, their four columns, their view file's `span: 2` on a pin that says `span: 1` — is two tracks wide and holds its cells. **Red pre-fix: one track, 295.8px, 29 elements outside the frame.** |
| `card-asks-for-its-cells` | The controlled four-column listing occupies two tracks and the one-number metric exactly one, at every width. **Red pre-fix: both one track, both 297.8px.** |
| `rows-mix` | Across the widths some line holds three cards and some line holds two, and no width draws every card alone on its own line. **Red pre-fix** (at 520px every card is alone). |
| `row-card` | The card the operator stored two cells wide is drawn across the whole row, at every width. Green pre-fix — the control that stops "everything is now content-sized" from passing. |
| `board-floors` | At 520px the board is wider than its scroller, the scroller can move sideways, and every track is at least the cell floor. **Red pre-fix: 464px board in a 512px scrollport, one 464px track.** |
| `stable` | A content-sized card holds the same number of cells at every width, and the round trip back to 1280px reproduces the board exactly. Green pre-fix, and the claim that says the fix did not introduce an oscillation. |
| `no-write` | Sizing the board never asks the vault for anything. |
| `width-control` | The width control names the two widths it offers ("Fill the row" / "Size to the content"). **Red pre-fix**, which is how the copy change is covered. |

Six of the rig's twelve legs are red on the pre-fix build and green after it. The
other six are green on both, deliberately, because they are the controls: a board
that never had to choose, a metric that must not be widened along with its
neighbour, a row card that must keep its row, a card that must not oscillate, the
absence of a vault write, and the page's cleanliness.

The artifact is `e2e/artifacts/dashboard-tile.json`, with
`e2e/artifacts/dashboard-tile.png` beside it: the reported case at 520px, where the
listing keeps all four columns and the sheet scrolls sideways.
