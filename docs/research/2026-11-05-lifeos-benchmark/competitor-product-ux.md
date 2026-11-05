# Edi Life OS — product, UX, design-system and market analysis (T-UX)

Analyst: `lifeos-product-analyst` (task-3). Subject: **Edi Life OS** by edrisranjbar
(repo `edrisranjbar/lifeos`, local clone `/tmp/lifeos-bench` @ `25fe400`, 2026-11-04).
Scope: positioning, onboarding, IA, design system, i18n/locale, mobile, docs/community,
market signals, weaknesses. Deep PHP/API logic is task-1's `competitor-features.md`;
I only cite code where it contradicts or explains the UX surface.

Sections below follow the brief's heading numbering (1, 2, 8, 11, 12, 14, 15). Sections
3–7, 9, 10, 13 are intentionally absent here; they are covered by the code-level analyst.

## 0. Verification status

| Item | Method | Result |
| --- | --- | --- |
| Repo code, docs, CSS, i18n, HTML | `read`/`grep` on `/tmp/lifeos-bench` @ `25fe400` | Read directly; line numbers cited |
| Shipped UI look | `read_image` on `docs/media/{dashboard,dashboard-light,growth,focus}.webp` and 5 extracted frames of `docs/media/demo.gif` (PIL, 265 frames, 22.08 s, 960×600) | Observed; described below |
| Marketing site | `web_fetch` https://edrisranjbar.github.io/lifeos/ + local `site/` source | Both read; source line numbers used where possible |
| GitHub metadata | GitHub REST API (repo, releases, tags, contributors, issues, actions runs) on 2026-11-05 ≈13:15 UTC | Verified at that instant; counts drift |
| CI health | GitHub Actions API **plus** local `node --test tests/*.test.mjs` on the clone | Both agree: main is red |
| App at runtime | **Not booted.** No Docker/PHP+MySQL instance was started | All runtime behaviour is inferred from code/screenshots, marked "inferred" where it matters |
| Real phone / assistive tech | Not tested | Mobile + a11y claims are CSS/JS-derived |
| GitHub private-vulnerability-reporting toggle | Not readable unauthenticated | Unknown |
| Arabic-in-UI claim | Inferred from `LANGUAGES` array and settings select, not clicked | Documented in `docs/languages.md:11` as unfinished |

Status vocabulary used: `shipped` (page/route reachable, code present), `shipped-partial`
(present but broken/incomplete/limited), `dead-code` (present but unreachable), `market`
(claim without a matching implementation).

---

## 1. Positioning and delivery model

| ID | Capability | What the product does (concrete behavior) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T-UX-01-01 | One-line positioning | "Your habits, goals, focus, money and projects in one self-hosted dashboard that your AI assistant can use too." | `README.md:5`; https://edrisranjbar.github.io/lifeos/ | shipped | Four nouns + AI affordance; no "life OS" jargon in the tagline |
| T-UX-01-02 | Problem framing | "Five apps. None of them talk to each other." — to-do, habit tracker, budget spreadsheet, pomodoro, notes | `site/index.html` problem section; README.md:21 | shipped | Scatter-diagram on landing page makes the anti-suite pitch visual |
| T-UX-01-03 | Target user (explicit) | Someone who can run PHP+MySQL or `docker compose`, wants data on own server, no subscription; Persian/Iranian context baked into defaults | `README.md:117-173`; `.env.example:22-28` | shipped | Secondary audience: Claude/MCP users (`README.md:103-115`) |
| T-UX-01-04 | Anti-positioning | No subscription, no tracking, no vendor lock-in, no public sign-up, no frontend framework, no build step | `README.md:25`; `README.md:234`; `README.md:215` | shipped | Genuinely consistent: landing page has **no analytics** (grep for gtag/plausible/umami returns nothing) |
| T-UX-01-05 | Delivery model, 3 paths | (a) `docker compose up -d`; (b) published multi-arch image; (c) shared-hosting zip; (d) plain `php -S` | `README.md:119-159`; `.github/workflows/publish-image.yml` (`platforms: linux/amd64,linux/arm64`); `.github/workflows/release.yml` (`git archive` zip) | shipped | Same product, three audiences: homelab, cPanel, local dev |
| T-UX-01-06 | Business model | Free, MIT, donations only: Donatr page, Iranian Toman gateway, 3 crypto addresses (BTC/ETH/SOL) | `README.md:247-263`; `LICENSE` | shipped | No paid tier, no hosted option, no telemetry |
| T-UX-01-07 | Workspace count claim | README says "Ten workspaces" and "All ten workspaces" but the table lists **12**; Spanish README says ten; Persian README and site say **eleven** | `README.md:23` and `README.md:80` vs `README.md:84-97`; `README.es.md:22`; `README.fa.md:23`; `site/index.html:127` | market | Real route count is 12 (`public_html/index.html:21` (10 iframes) + `os.js:73`). Claim drift is a visible QC defect |
| T-UX-01-08 | "Email workspace" | Email is listed as a workspace row but has no page or route: it is an Overview card + Settings section | `README.md:87` vs route list in `public_html/assets/os.js:73` | market | 12 workspaces claimed; 11 real pages + Settings |
| T-UX-01-09 | Productized nouns | Workspaces are branded as **Growth, Habittify, Focus, EdiFinance** rather than "habits/goals" | `public_html/index.html:21` (iframe titles: "Personal Growth", "EdiFinance", "Habittify"); `base.css:28` ("EdiFinance design-system alignment"); `docs/growth.md:1` | shipped | "Habittify" is an invented product name; helps feature recall, hurts first-time comprehension |
| T-UX-01-10 | Editorial tone | Short declarative headlines with kickers: "A LITTLE PROGRESS, EVERY DAY / Make room for focus.", "A LIFE WITH INTENTION / Grow in every direction.", "MAKE IT YOURS / Settings" | `public_html/index.html:8`; `docs/media/focus.webp`; `public_html/settings/index.html:12` | shipped | Consistently calm/aspirational; no exclamation marks, no growth-hack language |
| T-UX-01-11 | Persian-first differentiation | The Persian README adds a 5th value bullet ("فارسیدوست": Tehran dates, Jalali in Habittify, Toman default, RTL notes) that the English README omits | `README.fa.md:27` vs `README.md:23-26` | shipped | Localisation is the moat, advertised only to the local audience |

### 1.1 Repo facts (snapshot 2026-11-05 ~13:15 UTC, GitHub API)

| Fact | Value | Evidence |
| --- | --- | --- |
| License | MIT, © 2026 Edris Ranjbar | `repos/edrisranjbar/lifeos` → `license.spdx_id=MIT` |
| Created / last push | 2026-09-05 → 2026-11-03 (touched 2026-11-04) | API `created_at`, `pushed_at` |
| Stars / forks / watchers / subscribers | 114 / 14 / 114 / 3 | API |
| Issues / PRs | 27 issues (25 closed, 2 open), 44 PRs | API search + issues list |
| Contributors | 6: edrisranjbar 156, Fire162 12, NicoCodesCode 2, AnushreeKasturi 2, ChirayuPoddar 1, aryann2611 1 | API contributors |
| Commits / span | 173 commits, 2026-09-22 → 2026-11-04 (≈6.5 weeks) | `git rev-list --count HEAD` |
| Releases | 3 tags: v1.0.0 (2026-10-08), v1.1.0 (10-10), v1.2.0 (10-19); zip asset 50,629,264 B; downloads 10 / 7 / 4 | `git for-each-ref refs/tags`; API releases |
| Languages (GitHub) | JavaScript 648 KB, CSS 315 KB, PHP 295 KB, HTML 164 KB | API languages |
| Repo size | 60.6 MB, of which `public_html/assets/music` = 53 MB and `docs/media` = 4.2 MB | API `size`; `du -sh` |
| Tests | 39 Node subtests (`tests/*.test.mjs`) + ~15 PHP scripts + 1 PHPUnit file; no browser/E2E framework | `tests/` listing; local run |
| Docs | 11 files in `docs/`, `mcp/README.md`, 3 README translations, no CHANGELOG | `docs/*.md`; no `CHANGELOG*` |
| Topics | self-hosted, life-os, habit-tracker, kanban, personal-finance, productivity, mcp, php | API `topics` |
| Community surface | Discussions disabled (`has_discussions=false`), wiki enabled-but-empty (302), no SECURITY.md / CODE_OF_CONDUCT / FUNDING.yml | API + `.github/` tree |

---

## 2. Onboarding and shell

| ID | Capability | What the product does (concrete behavior) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T-UX-02-01 | Zero-signup first run | No registration, no setup wizard, no email verification. Create DB creds in `config.php`/`.env`, then the tables are created on first page load | `README.md:143-159`; `docs/deployment.md:95-105` | shipped | Onboarding is an operator task, not an end-user flow |
| T-UX-02-02 | Bootstrap credentials | `LIFEOS_USERNAME`/`LIFEOS_PASSWORD` are required only to create the first `app_credentials` row; can be removed afterwards; missing values fail with an explicit setup error | `.env.example:2-4`; `docs/deployment.md:86-92` | shipped | Nice failure message hook at `login.php:31` ("Database setup … Check config.php and your MySQL access") |
| T-UX-02-03 | Shared-hosting onboarding | Extract zip into the hosting **home** dir so `public_html/` is the web root; copy `config.example.php`; open the site | `docs/deployment.md:95-105`; `README.md:139-141` | shipped | `.gitattributes` strips `docs/`, `tests/`, `mcp/`, Docker files from the zip — so a zip user gets **no docs and no MCP server** |
| T-UX-02-04 | Sign-in screen | Standalone `login.php` with an inline stylesheet: purple `#8b5cf6`, 22 px card radius, "Welcome / Sign in", English-only, no theme toggle, no i18n script loaded | `login.php:39-43` | shipped-partial | **Breaks the design system on the very first screen a user sees** (app accent is mint `#39e6ad`, radius 4 px) and is not Persian-translatable |
| T-UX-02-05 | First-run defaults | Language `en`, currency `IRT` (Toman), calendar Gregorian, timezone Asia/Tehran, weather Qeshm Island, theme dark | `public_html/assets/currency.js:6`; `public_html/settings/app.js:104-110`; `.env.example:25-28`; `os.js:70` | shipped | All defaults are env- or Settings-only; a non-Iranian user must change 4 places |
| T-UX-02-06 | Shell architecture | One SPA shell (`public_html/index.html`) = hash router over 12 routes; 10 workspaces are lazy `<iframe data-src>` frames, Focus is inline, Overview is a module | `public_html/index.html:21`; `os.js:73` (`route()`) | shipped | Deep idea: each workspace is its own app on its own URL; cost: no shared router, no shared state, no URL for sub-views |
| T-UX-02-07 | Navigation assembly | Nav is authored incomplete in HTML and completed at runtime: 3 × `insertAdjacentHTML` (Growth, Calendar, Notepad) plus a block that reorders Growth→Goals→Habittify | `os.js:10, 27, 28, 38` | shipped-partial | With JS disabled or failing, the nav silently lacks 3 workspaces and is mis-ordered. Also 3 separate string-injection points to maintain |
| T-UX-02-08 | Overview as hub | Overview aggregates: daily score, six dimensions, 4 KPI cards, focus/habit trend charts, 16×7 heatmap, goals, workflow, finance, weather, email summary, app-launch chips | `public_html/assets/dashboard.js:77-145`; `docs/media/dashboard.webp`; `docs/email.md:5-8` | shipped | The hub is an analytics wall. Screenshot shows ≈10 cards before the first fold-and-a-half |
| T-UX-02-09 | Theme initialisation | Shell hard-defaults to **dark** and ignores OS preference; some children (`notes`, `finance`, `goals`) *do* honour `prefers-color-scheme` when nothing is saved; saved theme is broadcast into every iframe via a `MutationObserver` and 6 storage keys | `os.js:69-70`; `notes/index.html:19`; `finance/index.html:19`; `goals/index.html:13` | shipped-partial | Mixed initialisation → possible first-paint mismatch between shell and child app; 6 duplicated localStorage keys are a maintenance trap |
| T-UX-02-10 | Identity on shared devices | On load the shell fetches `/credentials.php` and injects an avatar chip with initials and an aria-label; comment says "Several people can share one device, so always show whose workspace is open" | `os.js:51-61`; `os.css:101` | shipped | Good multi-account affordance with a two-line implementation |
| T-UX-02-11 | Due-date bell | Sticky bell with count badge, popover grouped Overdue/Today/Coming up, deep links into Kanban/Goals/Finance; optional browser `Notification` permission requested from the panel | `os.css:110-148`; `due-alerts.js:124-134, 153` | shipped | Notifications only fire "while LifeOS is open" (`settings/index.html:19`) — no push, no service worker |
| T-UX-02-12 | Mobile navigation | Below 900 px the nav moves into a native `<dialog>` drawer: 44 px targets, `aria-expanded`, focus moves to current link, Esc/backdrop close, body scroll lock, safe-area insets, page-name label in the bar | `mobile-nav.js:1-40`; `os.css:72-99` | shipped | Best-engineered mobile piece in the repo; uses platform dialog + focus semantics rather than a bespoke overlay |
| T-UX-02-13 | Help / tour / onboarding | None. No tour, tooltip coach marks, sample data, or in-app docs; Settings → About only links to GitHub "Star" and "Share an idea" | grep for tour/onboard/help in shell → no hits; `settings/index.html:48` | absent | The landing page does the teaching; the app assumes you already know the model |
| T-UX-02-14 | Loading states | Cards ship with real skeleton copy: "Loading forecast…", "Fetching current conditions…", "Loading your board tasks…", `aria-busy` on the weather card | `dashboard.js:118-126`; `fa.json` keys | shipped-partial | Skeletons are text, not shapes; no global first-paint skeleton |

---

## 8. Reflection and insight

| ID | Capability | What the product does (concrete behavior) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T-UX-08-01 | Daily productivity score | Composite = unweighted mean of four parts (Focus, Habits, Goals, Work), 0–100, plus delta vs last week and a baseline message | `dashboard.js:304-313`; `dashboard.css:39-60` | shipped | The single strongest "life OS" artefact: one number, one grade, four receipts |
| T-UX-08-02 | Grade bands | 6 textual grades: Warming up / Starting / Building / Steady / Strong / Exceptional (≥90, ≥75, ≥60, ≥40, ≥20) | `dashboard.js:309` | shipped | Copy gives the number meaning without charts |
| T-UX-08-03 | Score visuals | 132 px SVG ring, gradient stroke, 900 ms `cubic-bezier(.22,1,.36,1)` dashoffset animation, mono 34 px number, 4 colour-coded part bars (violet/mint/gold/blue) | `dashboard.css:39-47, 60`; `docs/media/dashboard.webp` | shipped | Same animation language reused for every bar (800 ms) |
| T-UX-08-04 | Score narrative | Score text changes with the value: "Strong output today — the compound is working…", "…establishing baseline" when no prior week | `dashboard.js:348-356, 367-373` | shipped | Turns a metric into a sentence; cheap and effective |
| T-UX-08-05 | Six life dimensions | Fixed model (Religion & Spirituality, Health, Relationships & Family, Finance, Self Growth, Fun & Rest) each with glyph, colour, hint, and custom 24 px line icon | `growth-model.js:6-27` | shipped | Users cannot add/rename dimensions — it is a values statement, not a configurable taxonomy |
| T-UX-08-06 | Dimension visuals | Overview: 3×2 grid, one card per dimension = icon + name + big mono % + 4 px tone bar, tinted with `color-mix` at 4 %, lifts 1 px on hover, deep-links to `#growth` | `growth-overview.js:4-23`; `dashboard.css:330-353`; `docs/media/dashboard.webp` | shipped | Restrained and legible; the "tone" palette is the only place colour varies per entity |
| T-UX-08-07 | Growth progress model | SMART % = average of measure ratios and checklist completion; habit consistency = completions ÷ eligible days over last 7 Tehran days; unmeasured ≠ 0 | `docs/growth.md:27-38`; `growth-model.js:goalProgress/summary` | shipped | Documented with unusual precision |
| T-UX-08-08 | Life Review | 8-step modal flow: cadence → 6 dimension reflections → editable summary; previous "next step" shown; draft lost on reload; snapshot stored per review | `docs/growth.md:27-40`; `growth/review-stepper.css` | shipped | Weekly/monthly/quarterly due dates roll 7/30/90 days from last review |
| T-UX-08-09 | Anti-vanity honesty | "These indicators are not a wellbeing score. No composite life percentage is invented." A dimension with no measured goals shows an empty state | `docs/growth.md:41-42` | shipped | Rare product discipline; the Overview still averages four parts, so the honesty is per-feature |
| T-UX-08-10 | Insight strips | Heatmap (16 cols × 7 rows, 4 intensity levels + today outline), "insights" list, workflow flow-bar with 5-colour stack and legend, finance category bars | `dashboard.css:144-200`; `docs/media/dashboard.webp` | shipped | Charts are hand-rolled SVG with dashed gridlines; no chart library |
| T-UX-08-11 | Weather card | Full-width "Local forecast": hero temperature, feels-like/wind/humidity, modelled tide, 7-day forecast, Open-Meteo/DWD attribution, env-configurable lat/long/name | `dashboard.js:118-126`; `weather.js`; `.env.example:26-28` | shipped | Homepage real estate spent on Qeshm Island weather by default — charming for the author, odd for everyone else |
| T-UX-08-12 | Email morning summary | First Overview visit of the day sends last-24 h mail to the user's own AI key, sorted Needs reply / Deadlines / Worth knowing / Can skip; cached per day, refresh ≥2 min | `docs/email.md:5-10, 44-48`; `mail-card.js` | shipped | "Each morning" is visit-triggered unless the operator adds cron — README phrasing overstates it |
| T-UX-08-13 | Reflection absence | No journaling, no daily note, no mood/energy capture, no weekly narrative outside the 8-step review | workspace inventory; `docs/growth.md` | absent | Contrast with LifeQuest's daily note + review packs: their "reflection" is quarterly-ish and structured |

---

## 11. Operations, quality and community

| ID | Capability | What the product does (concrete behavior) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T-UX-11-01 | Release cadence | 3 releases in 11 days (10-08, 10-10, 10-19), then no tag for 16 days while `main` kept moving (last commit 11-04) | `git for-each-ref refs/tags`; API releases | shipped | Versioning started late: the repo's first commit is titled "v3.0.0" (`git log --reverse`) |
| T-UX-11-02 | Release engineering | Tag push → `git archive` shared-host zip + `gh release create --generate-notes`; separate workflow pushes multi-arch image to `ghcr.io/edrisranjbar/lifeos` with semver + `edge` + `sha` tags | `.github/workflows/release.yml`; `publish-image.yml:1-59` | shipped | Solid, conventional pipeline; auto-generated notes (no CHANGELOG file) |
| T-UX-11-03 | CI: tests are **red on main** | `Tests` workflow failed on 4 consecutive `main` pushes (10-30 6d3bb52, 10-30 5dc08c2, 11-02 a260a1b, 11-03 25fe400); last green `cdf7a6f` 2026-10-26 | Actions API `workflows/tests.yml/runs?branch=main` | shipped-partial | Reproduced locally: **33 pass, 6 fail of 39 subtests** at `25fe400` |
| T-UX-11-04 | What is broken locally | (a) money label lost thousands separators: expected `1,500,000 Toman`, got `1500000 Toman` (`due-alerts.test.mjs:40`); (b) Persian coverage failure: dictionary has `جست‌وجوی` where the test expects `جستجوی` (ZWNJ drift); (c) 3 Arabic-related failures (no `ar.json`); (d) the Persian dictionary load test (`tests/i18n.test.mjs:76`) | local `node --test tests/*.test.mjs`; `tests/i18n.test.mjs:52-76` | shipped-partial | Root cause is the 10-26→11-03 localisation pass, which changed number/locale formatting and dictionary strings without updating fixtures — a classic "demo outran tests" regression |
| T-UX-11-05 | Docker is green and is the real E2E | `Docker` workflow boots compose, signs in with curl, asserts `state.php` contains `"csrf"` and `/` contains `Edi Life OS`, then repeats the README's image instructions | `.github/workflows/docker.yml:1-40` | shipped | Tests the **documented onboarding path** — the single best quality idea in the repo; it stays green while unit CI is red |
| T-UX-11-06 | Test shape | 39 Node subtests (dates, growth math, calendar, escaping, notifications, i18n) + custom PHP scripts for auth/API/obligations/mail/Habittify + `php -l` + MySQL migration fixture. No Playwright/Cypress, no visual regression, no axe | `.github/workflows/tests.yml`; `tests/` | shipped-partial | No browser-level test of the iframe shell, nav injection, mobile drawer, or RTL rendering |
| T-UX-11-07 | Docs shape | 11 `docs/*.md` (api 60 L, accounts 47 L, deployment 244 L, development 142 L, email 55 L, growth 60 L, financial-commitments 86 L, languages 11 L, ownership 22 L, troubleshooting 78 L, finance-periods 7 L) + `mcp/README.md` (119 L) | `wc -l docs/*.md` | shipped | No index page in `docs/`; README is the hub. **No docs for Todo, Notepad, Notes, Kanban, Calendar, Habittify or Focus** beyond README table rows |
| T-UX-11-08 | Docs quality (high) | Docs carry concrete defaults, edge cases and non-goals, e.g. `docs/growth.md` defines smart/habit math and says what it refuses to invent; `docs/accounts.md` states admin-reset risk in plain language | `docs/growth.md:27-45`; `docs/accounts.md:13-17` | shipped | Reads like an engineering decision log, not marketing copy |
| T-UX-11-09 | Troubleshooting | Six numbered first-run failures with cause + fix: 429 lockout, proxy-wide lockout, port 8080, healthcheck, DB refused, insecure cookie | `docs/troubleshooting.md:9-78` | shipped | Directly serves the "cheap shared host" audience |
| T-UX-11-10 | Contributor surface | `CONTRIBUTING.md` with local run, exact test commands, code map, conventions (bump `?v=` cache keys, keep revision checks, never commit secrets), PR checklist; issue templates with area dropdown (13 areas + Other) + install-method dropdown + version field; PR template | `CONTRIBUTING.md:1-79`; `.github/ISSUE_TEMPLATE/bug_report.yml`; `.github/pull_request_template.md` | shipped | Explicitly says "AI-assisted contributions are welcome. This project is built with a lot of help from Claude Code" — unusual transparency |
| T-UX-11-11 | Community gaps | No `SECURITY.md`, `CODE_OF_CONDUCT.md`, `FUNDING.yml`, `CHANGELOG.md`; Discussions off; wiki empty; 6 contributors of whom 1 authored 156/173 commits | `.github/` tree; API `has_discussions=false`; contributors | shipped-partial | Bus factor ≈1; README tells people to use GitHub's private vulnerability form, but the repo has no policy file |
| T-UX-11-12 | Issue trail as roadmap | 27 issues: 25 closed, 2 open (#12 Gmail inbox, #69 negative habits). Many self-filed `good first issue` chores: light-theme screenshots, a11y labels, reduced motion, currencies, 404 page, manifest, troubleshooting, reverse-proxy tests | issues list (GitHub API) | shipped | Deliberately seeded newcomer work — strong contributor-funnel practice |
| T-UX-11-13 | Repo weight shipped to users | 53 MB of Kevin MacLeod MP3s in `public_html/assets/music` are included in the 50.6 MB shared-hosting zip; attribution exists only as an HTML comment | `du -sh public_html/assets/music`; `public_html/index.html:6-7`; release asset size | shipped-partial | A focus-timer side feature dominates download size; CC BY attribution is arguably not "in the manner specified" when hidden in a comment |
| T-UX-11-14 | Language coverage ops | Persian dictionary covers the app (`fa.json`, 1,664 keys); Arabic is selectable but has no dictionary; `README.es.md` exists but no Spanish landing page and no Spanish UI | `i18n.js:9-13`; no `assets/i18n/ar.json`; `docs/languages.md:11`; `site/` (en+fa only) | shipped-partial | Translation effort went: Persian UI > marketing pages > Spanish README > Arabic (abandoned mid-flight) |

---

## 12. UX and design-system patterns

| ID | Capability | What the product does (concrete behavior) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T-UX-12-01 | Colour system (app) | Near-black `--bg #05070a`, layered navy surfaces `#111825`/`#0b1017`, hairline borders `#232e40`, warm off-white text `#fffaf0`, **mint accent `#39e6ad`**, brass warn `#f3c969`, coral danger `#ff8060` | `base.css:27-53` | shipped | Distinct from generic SaaS blue; gold+mint reads "finance/calm" not "productivity hustle" |
| T-UX-12-02 | Colour system (light) | Cream paper `#f1eee6`, warm white surface `#fcfaf4`, olive-gold borders, deep green accent `#0f9068`, sepia-tinted shadows | `base.css:56-74` | shipped | Light theme is a re-tint, not an inversion — noticeably warmer than the dark theme |
| T-UX-12-03 | Dead first palette | Two `:root` blocks: the first defines blue `#5b7cfa` + radii 12/10/7 px, the second immediately overrides it with mint + radii 4/4/3 px | `base.css:3-22` vs `base.css:27-53` | dead-code | Also duplicated hover rules (`.icon-btn:hover` twice, `.primary-btn:hover` twice at `base.css:219-234, 449-450`) — evidence of accretion without cleanup |
| T-UX-12-04 | Type system | Body = Inter 14 px / 1.5-ish; numerics = JetBrains Mono with `tabular-nums`; display headings = **Georgia, serif, weight 400** with tight negative tracking | `base.css:1, 87-94`; `dashboard.css:32, 49, 130` | shipped | Serif-on-mono-on-sans is a strong, fashionable combo — but see 12-05 |
| T-UX-12-05 | Type-system drift | Display scale differs per workspace: Overview `clamp(32px,4.4vw,52px)`, Focus `clamp(28px,4vw,42px)`, Growth hero `clamp(28px,3.2vw,40px)` and **sans** (no Georgia), base.css `h1` `clamp(30px,4vw,46px)` | `dashboard.css:32`; `os.css:1` (`h1` Georgia); `growth/style.css:23`; `base.css:185-192` | shipped-partial | Growth/Goals read as a different product from Overview/Focus (visible comparing `growth.webp` vs `dashboard.webp`) |
| T-UX-12-06 | Radii | Token contract says 4/4/3 px (dashboard bento uses 14–16 px cards, 99 px pills, 12 px chips); marketing site uses 20 px | `base.css:49-53`; `dashboard.css:39`; `site/assets/site.css:18` | shipped-partial | Radius is effectively per-component, not systematic; "4 px" token is not honoured by the Overview |
| T-UX-12-07 | Spacing & density | 14 px base, 10–14 px grid gaps inside a 1320–1360 px shell, card padding 18–24 px, control heights 32 px icon / 36 px input / 44 px primary; stat grid 4→2→1 responsive | `base.css:87-94, 150-180`; `dashboard.css:39-90`; media queries `base.css:814`, `dashboard.css:266-300` | shipped | Dense for a "calm" product; ≈9 px x-height labels at 10–11 px are used a lot |
| T-UX-12-08 | Motion | 120 ms border/background hovers, 800–900 ms bar/ring fills on `cubic-bezier(.22,1,.36,1)`, 32–44 s aurora blob drift, 30 s day/night scene blends; `prefers-reduced-motion` kills animation globally | `base.css:766-769`; `base.css:108-115`; `os.css` scene rules; `dashboard.css:315` | shipped | Tasteful and slow; the only "dopamine" is the ring fill, no confetti/gamification |
| T-UX-12-09 | Dark/light mechanics | Manual toggle only (sun/moon icon, 32–44 px), persisted to 6 storage keys, pushed into all iframes; no `prefers-color-scheme` in the shell | `os.js:69-73` | shipped-partial | No "follow system" option in a product that otherwise cares about device context |
| T-UX-12-10 | Iconography | Inline 18–24 px stroke SVGs (1.8–2.2 stroke, round caps); inactive nav icons at 0.7 opacity; 6 bespoke 1-em dimension glyphs | `os.css:1`; `growth-model.js:19-26`; `public_html/index.html:4` | shipped | No icon font, no sprite, no third-party pack — consistent and dependency-free |
| T-UX-12-11 | Empty states | At least **6 different patterns**: `.empty-state` text block (`base.css:741`), `.empty-board` h3+p, Habittify symbol+title+copy, Todo icon+title+text, `.chart-empty` dashed box, `.due-empty` column with icon | `base.css:741`; `dashboard.css:144`; `kanban/assets/scripts/board-view.js:18`; `habittify/static/app.js:485`; `todo/index.html:86-90`; `os.css` `due-empty` | shipped-partial | Copy is warm and specific ("Begin with something small", "Nothing due today", "All clear") but the containers look unrelated |
| T-UX-12-12 | Focus scene (signature moment) | Full-bleed generative landscape: sun/moon positions computed from local clock via sine arcs, sky/warm overlays, 8 twinkling stars, 6 fireflies, drifting clouds, SVG grass swaying at 3 speeds, flowers, shade band; 30 s transitions | `os.js:87-110` (`updateScene`); `os.css` `.focus-scene` block; `docs/media/focus.webp` | shipped | This is the emotional centre of the product and cannot be expressed in a list of features |
| T-UX-12-13 | Cassette/"one design" reality | `base.css` is shared by only 4 of the 11 page documents (12 routes); per-workspace CSS totals 6,766 lines: kanban 1,437, finance 1,780 (+obligations 195), goals 858, notepad 295, notes 264, todo 251, growth 170 (+stepper 115), habittify 14, settings 14, calendar 7 | `find public_html -name '*.css' -exec wc -l {} +`; per-page grep for `base.css` | shipped-partial | Each workspace grew its own token set; "one design" is maintained by copy-paste and is drifting |
| T-UX-12-14 | Accessibility wins | Skip link ("Skip to main content") injected into Overview; `aria-current="page"`, `aria-pressed`, `role="status"`/`aria-live`, `aria-busy`; 2 px `:focus-visible` outline; native `<dialog>` modals; 44 px mobile targets; `sr-only` labels; reduced-motion support | `dashboard.js:77-79`; `mobile-nav.js`; `os.css:1` `:focus-visible`; `settings/index.html:15-18` | shipped | Above average for a solo PHP project; the a11y issues in the tracker (#24, #25) were fixed |
| T-UX-12-15 | Accessibility gaps | Skip link exists only on Overview; `aria-current` set to string `"false"` rather than removed; login screen has no language switch; several icon-only buttons rely on `title`; charts encode magnitude by colour only; iframe title attributes exist but nested headings start at `h3` in cards | `os.js:73`; `dashboard.js:77`; `login.php:39-43`; `dashboard.css:4-10` | shipped-partial | Not audited with a screen reader (unverified); document order of the iframe shell may confuse AT |
| T-UX-12-16 | RTL / i18n mechanics | `<html dir>` flipped at load; dictionary keyed by **English source text** (no message IDs); digit translation `0-9` → `۰-۹`; `Intl` locale `fa-IR-u-ca-gregory`; runtime `fetch('/assets/i18n/fa.json')`; static text translated by walking the DOM, dynamic text must call `t()` | `i18n.js:1-110` | shipped | Clever low-ceremony approach; cost: every new string must be added to a JSON the test script harvests, and coverage breaks silently (see T-UX-11-04) |
| T-UX-12-17 | RTL typography | In RTL the whole app is force-switched to Vazirmatn with `!important` and `letter-spacing: normal`, loaded from **fonts.googleapis.com** at runtime; bundled `Vazirmatn-Variable.woff2` is used only by Notepad | `i18n.js:79-91`; `public_html/assets/fonts/`; `notepad/static/style.css:5-6` | shipped-partial | Contradicts the bundled-font claim in `README.md:96` and adds a third-party request to a "your own server" product |
| T-UX-12-18 | Jalali handling | A Settings preference switches **Habittify month/day labels only**; stored dates stay ISO; finance periods are Persian months; Intl is pinned to `-u-ca-gregory` so other dates stay Gregorian | `settings/index.html:18`; `docs/accounts.md:9`; `i18n.js:9`; `docs/finance-periods.md:1-7` | shipped-partial | Demo GIF shows `18 Mehr 1405` (`docs/media/demo.gif` frame 66) while the default is Gregorian — mixed calendar surfaces (Finance=Jalali always, Habittify=optional, everything else=Gregorian) |
| T-UX-12-19 | Mobile / PWA | Responsive breakpoints at 1180/1080/900/760/650/520/420 px; mobile nav drawer; horizontal-scroll habit table with `min-width:190-230px` sticky first column; 7-day forecast becomes a scroll-snap rail. **No manifest, no service worker, no offline, no install prompt** in the app | `base.css:808, 814`; `dashboard.css:266-300`; grep for `manifest`/`serviceWorker` in `public_html/` → none; `site/index.html:27` has a manifest for the *marketing site* only | shipped-partial | The site promises "layouts that work on a phone"; it does **not** promise an app — but a self-hosted "life OS" with no offline story is a real gap |
| T-UX-12-20 | Account/due chrome | Beyond the nav, only two global elements: account avatar chip and due-date bell; no global search, no command palette, no notifications inbox page, no settings gear in the shell (Settings is a nav link) | `os.js:51-61`; `due-alerts.js:153`; `os.css:101-148` | shipped | Search exists per-workspace only (Todo, Notes, Notepad); nothing searches across goals+cards+notes |

### 12.1 What the shipped screens actually look like (image evidence)

| Screen | File | What is visible |
| --- | --- | --- |
| Overview, dark | `docs/media/dashboard.webp` (1600×1000) | Mint logo chip + 11 nav items (no Todo, no Email — pre-10-22 build); "LIFE & WORK OS · TEHRAN" kicker; huge Georgia "Good morning."; date chip; productivity ring "49 / Building / 1 pts vs last week" with 4 part bars; "Six dimensions. One direction." 3×2 tinted cards; 4 KPI cards peeking below |
| Overview, light | `docs/media/dashboard-light.webp` | Same layout on cream; **nav order differs** (Overview, Growth, Goals, Habittify, Focus, Finance, Kanban, Calendar, Notepad, Notes, Settings) — screenshots were captured on different builds |
| Growth | `docs/media/growth.webp` | Sans headline "Grow in every direction."; 3 cadence pills "Weekly · Due now"; 6 dimension cards with icon tile, % and "Habits 71% · Tasks 2/5 · Plans 1"; "New long-term goal" CTA; no Todo/Email in nav |
| Focus | `docs/media/focus.webp` | Dark UI over a light daytime painted landscape; "Start focus" mint button; 25:00 mono clock; soundtrack panel with Play/Next, volume, native file input; "Timer settings" disclosure; session stats 2/50 min |
| Demo GIF | `docs/media/demo.gif` (265 frames, 22.08 s) | Frame 66: Habittify with **Jalali date "18 Mehr 1405"**, serif "Habits", 3/5 progress, weekday bars, "86% of possible check-ins"; frame 198: Finance with "LOG EXPENSE" CTA, recent entries table (USD), income streams 5,200/980, budget tracker; cursor moves through the flow narrated in README:13-15 |
| Marketing site | https://edrisranjbar.github.io/lifeos/ | Dark hero with tilted screenshot, floating habit/focus/AI cards, 11 workspace chips, "Five apps" problem block, feature cards, a simulated Claude tool-call transcript, copy-to-clipboard install block, principles grid, CTA |

---

## 14. Limitations, rough edges and missing pieces

| ID | Capability | What the product does (concrete behavior) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T-UX-14-01 | No PWA / offline | No manifest, service worker, offline cache or install prompt anywhere in `public_html/`; the only manifest/webmanifest is on the GitHub Pages marketing site | grep `manifest` / `serviceWorker` in `public_html` → none; `site/index.html:27` | absent | A self-hosted tool you cannot install to a home screen or use on a plane |
| T-UX-14-02 | Data portability | Backup = "back up the database, attachment files and configuration together"; restore = MySQL dump + attachments; no in-app export (no JSON/CSV/zip of your life) | `README.md:204-211`; `docs/deployment.md:147-211` | shipped-partial | Users are told to own their data but given no one-click way to take it |
| T-UX-14-03 | Account lifecycle gaps | No self-service password reset (admin resets), no 2FA anywhere in docs or code (absence, inferred), **no permanent account deletion**; every account is an admin who can reset the others | `docs/accounts.md:7, 14, 17`; `README.md:215` | shipped-partial | Honest in docs, still a trust ceiling for family/friends use |
| T-UX-14-04 | API token model | One operator token bound to `api_user_id` (default 1); no per-user tokens, no scopes, no rate limiting (delegate to hosting) | `README.md:217`; `docs/accounts.md:29` | shipped-partial | Blocks the "each person connects their own Claude" story that the marketing implies |
| T-UX-14-05 | Notification limits | Browser `Notification` only while a tab is open; no push, no email reminders, no background scheduler | `settings/index.html:19`; `docs/growth.md:36` ("There are no background notifications or email reminders") | shipped-partial | Contradicts the "morning summary each morning" phrasing unless the operator reads `docs/email.md:44` |
| T-UX-14-06 | Arabic is offered but empty | Language select lists "العربية"; choosing it flips `dir=rtl` and Arabic-Indic digits but the dictionary fetch fails → English text in RTL | `i18n.js:9-13` (LANGUAGES), `i18n.js:98-108` (fetch fail → `{}`); `settings/app.js:104`; no `assets/i18n/ar.json`; `docs/languages.md:11` | shipped-partial | Worst kind of i18n bug: a visible option that half-works |
| T-UX-14-07 | Marketing numbers drift | 10 vs 11 vs 12 workspaces; Email counted as a workspace yet has no page; screenshots from ≥3 builds with different nav orders and no Todo entry | `README.md:23,80,84-97`; `README.es.md:22`; `README.fa.md:23`; `site/index.html:127`; `docs/media/dashboard.webp` vs `dashboard-light.webp` | market | A single "workspace list" constant in the build would fix all of it |
| T-UX-14-08 | First screen off-brand | Login is a purple standalone page with its own CSS, English-only, no logo, no theme, no language choice — the only page that does not use `base.css` | `login.php:39-43` | shipped-partial | Also the only screen a new self-hoster sees before "Welcome" |
| T-UX-14-09 | Third-party calls in a "yours" product | Google Fonts `@import` (Inter, JetBrains Mono) on every page, plus a runtime Vazirmatn stylesheet for RTL, plus Open-Meteo weather, plus the user's AI provider | `base.css:1`; `i18n.js:83`; `weather.js`; `docs/email.md:38-42` | shipped-partial | No analytics, good — but "no tracking" readers will still see Google connections and offline RTL degrades to Tahoma |
| T-UX-14-10 | Touch Kanban | Cards and columns are `draggable=true` and use HTML5 `dragstart`/`DataTransfer`; no `pointerdown`/`touchstart` fallback found | `kanban/assets/scripts/board-view.js:34, 197, 261`; grep touch/pointer in kanban scripts → none | shipped-partial (inferred) | HTML5 DnD does not fire reliably on mobile browsers; the flagship Kanban interaction is desktop-only in practice (not tested on a device) |
| T-UX-14-11 | No global search | Search exists per workspace (Todo search, Notes/Notepad search); nothing searches across goals, cards, habits, notes, finance | grep for global search/command palette → none; `todo/static/app.js` search only | absent | With 12 workspaces, retrieval depends on remembering which app holds the record |
| T-UX-14-12 | CI is red on main | 4 consecutive failing `main` pushes; failure is visible on the repo's Actions tab and the Tests badge would be red if used | Actions API; local repro (6/39 failing) | shipped-partial | The README has no CI badge for Tests (only release/stars/license/docker/MCP), which hides it |
| T-UX-14-13 | Release-zip content gap | Shared-host zip strips `docs/`, `tests/`, `mcp/`, Docker files, `composer.*` — so the audience most likely to need instructions gets none, and no MCP server | `.gitattributes:1-21`; `docs/deployment.md:95-105` | shipped-partial | Docs live on GitHub instead; acceptable for devs, bad for cPanel users |
| T-UX-14-14 | Zip size | 50.6 MB release asset, dominated by 53 MB of focus music shipped inside `public_html/assets/music` | API release asset `size`; `du -sh` | shipped-partial | Slow first download on the shared-host path the project optimises for |
| T-UX-14-15 | Small-screen density | The habit matrix keeps a 190–230 px sticky label column and scrolls horizontally; 7-day forecast becomes a horizontal rail; Overview stacks ~10 cards vertically | `base.css:825`; `dashboard.css:320`; `docs/media/dashboard.webp` | shipped-partial | "Works on a phone" is true for reading, not for the habit grid or Kanban |
| T-UX-14-16 | Single-owner precedent | `docs/ownership.md` declares a single-owner installation; the multi-account schema (v3) exists, but API/MCP remain owner-scoped | `docs/ownership.md:3-22` | shipped | Multi-account was added as schemas+Settings UI after the fact; the product's mental model is still one owner |

---

## 15. Top 15 takeaways for LifeQuest (adopt / adapt / defend / ignore)

Ranked by what would move LifeQuest's presentation and adoption most, given ours is a
local-first Electron studio with a vault, a companion requirement, and a wiki instead of
a marketing site.

| # | Takeaway | Verdict | Why (with their evidence) | What I would do for LifeQuest |
| --- | --- | --- | --- | --- |
| 1 | **A public landing surface, not just a wiki** | ADOPT | `site/index.html` + `site/fa/` do the work a README cannot: hero, problem framing, feature cards, one install block, FAQ (`site/fa/index.html:56` has FAQPage JSON-LD that the English page lacks) | Publish one static page (can live in the existing `site/` output): VISION-grade one-liner, 3 screenshots light/dark, "what it is not", download path. Keep the wiki for operators |
| 2 | **Screenshot discipline: light/dark pairs via `<picture>`** | ADOPT | README uses `<picture><source media="(prefers-color-scheme: dark)">` so the README itself respects the reader's theme (`README.md:33-37`) | Same trick in our README and site; but generate both from one commit so nav/state cannot disagree (their pairs were captured on different builds — see T-UX-14-07) |
| 3 | **One daily score with grades and a sentence** | ADAPT | Ring + 6 grade bands + delta vs last week + narrative copy (`dashboard.js:304-313, 348-373`) gives the whole product a spine; it is also the thing the README leads with | LifeQuest has Reviews/Log; a single "today" artefact (score or 3-line status) on the home pin board would make the product describable in one sentence. Do **not** copy the four-part average; our doctrine is qualitative |
| 4 | **Six fixed life dimensions as a values statement** | ADAPT | Fixed taxonomy, tinted cards, one number each, "not a wellbeing score" disclaimer (`growth-model.js:6-27`; `docs/growth.md:41-42`) | Ours has Domains + doctrine (Premise→Vision→Purpose→Strategy) — richer, but invisible in a screenshot. Add a 6-ish-card "life map" view that is derivable from vault data and reads at a glance |
| 5 | **A demo GIF that tells one micro-story** | ADOPT | `docs/media/demo.gif` (22 s, 265 frames): tick habit → ask Claude to log $46 lunch → watch it land in Finance; README caption states the sample-data caveat (`README.md:13-15`) | Record one 20-second vault story (capture → Decision → page update) with the real UI and caption the caveat. This is the cheapest credibility we can buy |
| 6 | **Editorial microcopy with kickers** | ADOPT | "A LITTLE PROGRESS, EVERY DAY / Make room for focus."; "MAKE IT YOURS"; empty states like "Begin with something small" | Our screens are functional; a one-line kicker + one warm sentence per page costs nothing and raises perceived craft. Keep our literal voice, not their aspirational one |
| 7 | **Docs that state non-goals and edge cases** | DEFEND + ADOPT | `docs/growth.md` documents math, defaults, and what it refuses to claim; `docs/troubleshooting.md` lists 6 real first-run failures | We already do this in `docs/superpowers/specs`. Add the missing outward-facing pieces: a troubleshooting page and one "how progress is computed" page per computed surface |
| 8 | **Onboarding as a documented path, tested in CI** | ADOPT | `.github/workflows/docker.yml` boots compose, signs in, asserts `"csrf"` and the app title — it tests the README's own instructions | Ours has a companion + vault step. Add one E2E that follows the README install path on a clean profile and fails loudly; that is the single highest-value QA idea here |
| 9 | **Empty states as invitations, one component** | ADAPT | Their copy is good ("Nothing due today", "All clear", "Begin with something small") but there are 6 containers; ours should standardise one primitive with icon/title/body/CTA | Standardise a single `EmptyState` primitive and write per-surface copy. This is a 1-day win in perceived quality |
| 10 | **Mobile drawer done with platform semantics** | ADOPT (pattern only) | `mobile-nav.js` uses native `<dialog>`, `aria-expanded`, scroll lock, safe-area insets, 44 px targets — 40 lines, no library | If/when LifeQuest gets a narrow layout, copy this pattern rather than a bespoke overlay |
| 11 | **Persian/RTL as a first-class locale** | DEFEND (for them) / IGNORE for us | `fa.json` 1,664 keys, digit mapping, RTL force-font, Jalali in Habittify, Toman default, `README.fa.md` with an extra value bullet | Not our market. Do not spend effort here; do note that their localisation is their moat and our equivalent moat is the vault/companion contract |
| 12 | **Public roadmap via seeded `good first issue` work** | ADOPT | 27 issues, many self-filed chores (`good first issue`): a11y labels, reduced motion, screenshots, currencies, 404, manifest — a visible contributor funnel (`CONTRIBUTING.md:1-79`) | File our own bounded chores as issues with acceptance criteria; it converts our spec warehouse into an onboarding path |
| 13 | **MIT + a donation line, no telemetry** | DEFEND | `LICENSE`, `README.md:247-263`; landing page has no analytics | Our licensing/business posture should stay explicit on the public page; a "no account, no cloud" line is the same anti-positioning move |
| 14 | **Don't ship marketing claims without a check** | ADOPT (as a rule) | 10/11/12 workspaces, Email-as-workspace, stale screenshots, "morning summary each morning" vs cron — all avoidable with one generated list | Add a `docs/check` step that regenerates the feature list/count and fails if README/site disagree with code. Cheapest possible guard against their most visible defect |
| 15 | **Do not adopt the iframe shell, parallel CSS, or red CI** | IGNORE (anti-patterns) | 12 routes via hash + 10 iframes + nav injected by 3 DOM inserts (`os.js`), 6,766 lines of per-workspace CSS, 2 competing `:root` palettes, CI red 4 pushes running | Keep our single React shell and token contract; enforce `DESIGN.md` tokens in review; never let a demo/marketing push land while the suite is red |

### 15.1 What they do better than us on presentation (be honest)

1. **There is a front door.** A landing page, a 404, OG images, a sitemap, hreflang, JSON-LD
   (SoftwareApplication + FAQPage on the Persian page), and a live star count. LifeQuest
   currently points at a wiki. A newcomer can evaluate LifeOS without cloning anything.
2. **The README is a sales page with receipts.** Hero GIF, light/dark screenshots, a
   12-row capability table, three install paths with copy-paste blocks, honest limits
   ("per-user token issuance … not implemented"), donations, contact. Ours reads like an
   engineering index.
3. **Visual assets exist and are curated.** 10 light/dark `.webp`s + a 22-second GIF,
   embedded with `prefers-color-scheme` sources. We have artifacts in `.scratch/` but no
   curated, versioned media set.
4. **The product has a signature moment.** The Focus landscape that follows the clock
   (`os.js:updateScene`, `docs/media/focus.webp`) is memorable and photographable. Our
   signature (the vault + Decision approval loop) is powerful but currently hard to *show*.
5. **Numbers are given meaning.** "Building · 49 · 1 pt vs last week" plus a sentence
   (`dashboard.js:309, 348`) is more legible than a raw metric, and it survives a screenshot.
6. **Naming.** "Habittify", "Growth", "Focus", "EdiFinance" give each area a handle for
   docs, issues and conversation. Our Domains/Decisions vocabulary is precise but abstract.
7. **The onboarding path is tested and short:** 3 shell commands or a 50 MB zip, then a
   browser. Whatever its faults, a stranger can be inside the product in minutes.

### 15.2 What we should not copy

1. **The iframe-per-workspace shell with a JS-assembled nav** (`public_html/index.html:21`;
   `os.js:10,27,28,38`; `mobile-nav.js`). No shared routing/state, no-JS degradation,
   three separate nav-injection points, theme broadcast hacks. Our single React shell is
   structurally better — keep it.
2. **Per-workspace parallel CSS.** 6,766 lines across 15 stylesheets, `base.css` on 4 of 11
   page documents, two competing `:root` palettes and duplicated hover rules. Our `DESIGN.md` token
   contract exists precisely to prevent this; enforce it in review, don't let "one design"
   become a README sentence.
3. **A marketing claim that isn't generated from code.** 10 vs 11 vs 12 workspaces, an
   "Email workspace" with no route, screenshots from three builds. Generate the list.
4. **An untranslated, off-brand auth screen.** `login.php` is a purple island with its own
   CSS. Our lock/unlock and companion-connection screens deserve the same care as the app.
5. **Shipping a visible language option with no dictionary.** Arabic in the select, no
   `ar.json`, English text in RTL. Ship only what is tested, or label it "preview".
6. **Runtime Google Fonts in a "your own server, no tracking" product**
   (`base.css:1`; `i18n.js:83`) when a bundled Vazirmatn already exists and is used
   elsewhere. Self-host the fonts; keep offline RTL working.
7. **A red test suite behind a demo.** `Tests` failed on 4 straight `main` pushes while
   release notes were written. Do not let any public artefact outrun a green suite.
8. **Bundling 53 MB of side-feature media into the download.** If LifeQuest ever ships a
   media pack, make it optional.
9. **Dense analytics under a "calm" banner.** Their Overview stacks score, 4 KPIs, 2 charts,
   a heatmap, 3 lists, weather and email. Pick one narrative for the home surface; ours is
   already at risk of pin-board sprawl.
10. **Hardcoded single-user geography/preferences** (Qeshm weather, Asia/Tehran, Toman,
    Gregorian) as product defaults in a multi-account app. Make locale/region first-class or
    keep it presentation-neutral.

---

### Appendix: exact commands used (reproducible)

```sh
git clone --depth 50 https://github.com/edrisranjbar/lifeos.git /tmp/lifeos-bench   # present
cd /tmp/lifeos-bench && git log --oneline -5 && git tag -l && git rev-list --count HEAD
node --test tests/*.test.mjs                     # 39 subtests: 33 pass, 6 fail at 25fe400
curl -s https://api.github.com/repos/edrisranjbar/lifeos            # stars/forks/issues
curl -s "https://api.github.com/repos/edrisranjbar/lifeos/actions/workflows/tests.yml/runs?branch=main"
python3 - <<'PY'  # demo.gif frames
from PIL import Image, ImageSequence
im=Image.open('/tmp/lifeos-bench/docs/media/demo.gif'); f=[x.convert('RGB') for x in ImageSequence.Iterator(im)]
PY
```
