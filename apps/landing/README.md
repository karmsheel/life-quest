# LifeQuest — landing page

The one-page site for LifeQuest: the first fully private personal agentic
harness and the life operating system for one person.

Concept: **own the axis of your life.** A compass rose, a vertical stack with
you at the top, a white product sheet in a night sky, and a close that asks you
to become the sovereign individual.

No build step, no framework, no npm dependencies. The page is `index.html`,
`styles.css` and `main.js`; open it in a browser or serve the folder.

```bash
node apps/landing/scripts/serve.mjs
# http://127.0.0.1:4319/
```

## What is here

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: hero, ticker, premise, harness, alignment, sovereignty, system, access, footer |
| `styles.css` | Tokens, layout, the day-skin product window, motion, responsive states |
| `main.js` | Reveals, tabs, the alignment stack, counters, form, cursor, parallax, menu |
| `brand/` | The generated LifeQuest mark and lockups (copied unchanged from `feat/lifequest-brand`; see `BRAND.md`) |
| `fonts/` | Instrument Serif, Instrument Sans and JetBrains Mono (OFL, self-hosted woff2) |
| `og.html` / `og.png` | The 1200 × 630 social card and its source |
| `scripts/serve.mjs` | Dependency-free static server |
| `scripts/shot.mjs` | Desktop/mobile screenshot loop used while designing |
| `scripts/e2e.mjs` | The E2E rig and artifact producer |
| `e2e/report.json` | Last E2E result |
| `e2e/artifacts/` | Captures from the E2E rig (regenerated; the PNGs are gitignored) |

## The design

- **Brand.** The mark is the compass rose/pinwheel from the LifeQuest brand
  guide; the palette is the `lifequest` night skin (`#0A0920`, aqua `#4ADEFC`,
  periwinkle `#6E69F4`, violet `#A264FA`, lilac `#D19DFC`). The harness window
  is the same brand's **day** skin, so the product surface is the sheet on the
  night page rather than a second, invented theme. The wordmark is live text in
  Instrument Sans, the mark is never baked into type.
- **Type.** Instrument Serif for the editorial headlines, Instrument Sans for
  the working text, JetBrains Mono for the instrument labels. All self-hosted;
  no network request at runtime.
- **The stack.** Section 03 is the page's argument in one component: six layers
  from *You* down to *Device*, each serving the one above it. Hover or focus a
  row and the preview card and its spine follow. The page's section rail is the
  same vertical axis at the window edge.
- **The window.** Section 02 shows the harness in its day skin. The Today,
  Decisions and Context tabs are real buttons with roving tabindex; the content
  is illustrative, the interaction is not.
- **Truth constraints.** The page says what is true today: the vault is a folder
  on disk, keys stay in OS secure storage, no LifeQuest-hosted copy exists, the
  companion is required, and only the Windows build ships. It does not claim
  whole-vault encryption, macOS/Linux builds, testimonials or user counts.
- **Motion.** Entrance masks, a scroll-linked reveal system, pointer parallax on
  the axis, a trailing cursor, slow orbital rings, a marquee, counters and a
  magnetic primary button. Everything collapses under
  `prefers-reduced-motion: reduce`, and the page is fully readable with
  JavaScript off.
- **Accessibility.** Skip link, one `h1`, landmarks, labelled tabs, focus
  visibility, keyboard roving tabs, an inline form error with `role="status"`, a
  44 px menu target, and contrast lifted above AA for the small instrument
  labels. The mock window is `aria-hidden` in its decorative parts but its tabs
  remain operable.
- **Performance.** One HTML request, one CSS, one JS, five self-hosted woff2
  files and three PNG sizes of the mark (512 used once). No third-party scripts,
  no trackers, no network fonts. The hero mark and fonts are preloaded.

The landing form is a front-end demo: on a valid address it shows the success
state and stores nothing. Wire `form[data-testid="access-form"]` to a real
endpoint before publishing.

## Test and artifacts

```bash
# from the repo root
node apps/landing/scripts/e2e.mjs
```

The rig starts its own static server, launches the system Chromium headless
over the DevTools protocol with a throwaway profile, and checks structure,
assets, fonts, navigation, tabs, the alignment stack, the form, reduced motion,
the mobile menu and horizontal overflow. It writes `e2e/report.json` and the
named captures under `e2e/artifacts/`. It exits non-zero if anything fails.

```bash
# design loop: fast captures at 1440 and 390
node apps/landing/scripts/shot.mjs
```

To rebuild the social card:

```bash
node apps/landing/scripts/serve.mjs
chromium --headless=new --no-sandbox --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot=apps/landing/og.png http://127.0.0.1:4319/og.html
```

## Deploy

Copy the contents of this folder (or serve it directly) as a static site.
`index.html`, `styles.css`, `main.js`, `brand/`, `fonts/`, `favicon*`, `og.png`,
`site.webmanifest` and `robots.txt` are the whole runtime. `og.html` and
`scripts/` are only needed for rebuilds. If the site moves to a real domain,
make `og:image` and `twitter:image` absolute URLs in `index.html`.
