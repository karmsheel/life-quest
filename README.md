# LifeQuest

**Local-first life-management studio** for the desktop. Open or create a **vault folder** on your machine; Domains, doctrine (Premise → Vision → Purpose → Strategy), Decisions, Life log, and agent roster live as plain files beside each other. The studio does not open without the companion. Capture is not the studio.

The product runtime is **Electron + Vite + React**. There is no cloud account and no Prisma. Domain database rows live in a SQLite file inside the vault folder: that SQLite is the domain book, not the archived Prisma app, and it is not hosted.

## Design

| Doc | Description |
|-----|-------------|
| [Project wiki](docs/wiki/README.md) | The operator's guide: every feature, how to use it, and how the system works |
| [VISION.md](VISION.md) | Acceptance policy for future change |
| [PRODUCT.md](PRODUCT.md) | Users, purpose, anti-references |
| [DESIGN.md](DESIGN.md) | Token contract and primitives |
| [LAWS/](LAWS/) | Observable product invariants |
| [BERD systems phase 1](docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md) | CSS-native design contract |
| [BERD visuals phase 2](docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md) | Canvas/sheet, concentric radii, pill buttons |
| [Three-pane studio](docs/superpowers/specs/2026-09-04-three-pane-studio-design.md) | Rail, main, and chat as separate 12px cards |
| [Glass chrome](docs/superpowers/specs/2026-09-12-glass-chrome-design.md) | Quiet frost on rail and chat; main stays paper |
| [Local vault (Electron) design](docs/superpowers/specs/2026-07-19-local-vault-electron-design.md) | Current product host & vault layout |
| [Local vault plan](docs/superpowers/plans/2026-07-19-local-vault-electron.md) | Implementation plan |
| [Skeleton design](docs/superpowers/specs/2026-07-17-lifequest-skeleton-design.md) | Product IA (Domains / rooms / forge / log) |
| [Hermes chatbar design](docs/superpowers/specs/2026-07-18-hermes-chatbar-connection-design.md) | Hermes connection UX |
| [Domain databases & Finance kit](docs/superpowers/specs/2026-09-23-domain-databases-finance-kit-prs.md) | Domain-owned databases, pages, and the Finance kit |
| [Dashboard page lock](docs/superpowers/specs/2026-10-08-dashboard-page-lock-design.md) | The home pin board's lock, and one call that saves and pins a card |
| [Daily Note](docs/superpowers/specs/2026-10-14-daily-note-design.md) | One journal note per day, and the review pack that reads it |
| [Auto-update](docs/superpowers/specs/2026-10-12-auto-update-design.md) | The glowing build number, and the upgrade it offers |
| [Rust rewrite decision](docs/superpowers/specs/2026-10-15-rust-rewrite-decision.md) | Decision memo: stay TypeScript; where native Rust is defensible |
| [Cold start](docs/superpowers/specs/2026-10-17-cold-start-does-not-wait-on-the-companion-design.md) | What held the splash for 57s, and what the splash is allowed to wait on |
| [Model probe](docs/superpowers/specs/2026-10-20-model-probe-asks-the-host-design.md) | The retired-model warning: asked of the host, answered after the boot |
| [Projects on the Execute wing](docs/superpowers/specs/2026-10-27-projects-execute-wing-design.md) | A built-in project page with real attributes, collated context, and companion tools |
| [Walrus integration report](docs/research/2026-10-19-walrus-integration-report.md) | What Walrus does and does not buy a vault, and the four integrations worth the work |

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | Developed on Node 22; 20 LTS minimum target |
| **npm** | Workspaces monorepo |
| **Hermes gateway** | Required for the studio. Default `http://localhost:8642`. Capture is not the studio. |

## Quick start

```bash
# 1. Install workspace dependencies
npm install

# 2. Run the desktop app
npm run dev
# same as: npm run dev:desktop
```

On launch:

1. **Create vault** — pick an empty folder; LifeQuest seeds four Domains (Health, Intellectual, Emotional, Financial) with empty Premise / Vision / Purpose / Strategy Markdown.
2. **Open vault** — pick an existing LifeQuest vault directory (or a recent path).
3. Work offline against files on disk. API keys never enter the vault (OS secure storage via Electron `safeStorage`).

### Build and ship (Windows)

```bash
npm run package   # dev build: a folder you can run
npm run release   # shippable build: the installer and the portable zip
```

`npm run package` writes `apps/desktop/release/win-unpacked/` — double-click `LifeQuest.exe`. No Node or `npm run dev` is required to *use* that build.

`npm run release` writes the two files a release uploads, both named from `version` in `apps/desktop/package.json`:

| Asset | What it is |
|-------|------------|
| `LifeQuest-<version>-setup.exe` | NSIS installer; assisted, per-user, asks where to install |
| `LifeQuest-<version>-win-x64.zip` | Portable build — extract and run `LifeQuest.exe` |

It prints the size and SHA-256 of each, and writes `release/release-manifest.json`. It exits non-zero rather than reporting success when an asset is missing. Uploading is deliberately not part of the build: `gh release create` attaches the files, and nothing half-publishes on its own.

### Who hears about a release

The app asks GitHub Releases **once per launch** for the newest release of `karmsheel/life-quest`. If it names something newer than this build, the version number at the foot of the left rail starts to glow; clicking it opens a popup that names both versions, the release's notes, and the installer — and offers to download it and run it. After the installer is up, the app quits so it can be replaced.

The release repository is public, so the check is one anonymous read and the app holds no token for it. With nothing to read, it reports that it could not check — it never claims to be up to date.

Two things it will not do. It never offers a version that is not strictly newer, so an older or unreadable tag is reported rather than installed. And it only ever downloads an installer from a GitHub host, checked again after redirects; anything else is refused before a byte moves.

**Settings → Developer** carries one switch, *Preview the update badge*, which makes the rail glow and opens the popup as if a release had been published. The preview carries no installer, so nothing can be downloaded from it; Settings → Updates still reports what the feed really said; and a real release outranks the preview. It is the only way to look at the upgrade affordance without cutting a release.

`node apps/desktop/e2e/update-live-feed.mjs` reads the real feed, through the real main process and the real network, and prints what the app would decide — *up to date*, or what it would offer. It is deliberately not in `npm test`, because it needs GitHub to answer; run it before cutting a release, and again after publishing one.

Windows SmartScreen may warn on first launch (unsigned private build). Choose **More info → Run anyway**. Quit LifeQuest before building again — a running `.exe` can lock files under `release/`. Deleting `win-unpacked` removes that build only; vault folders and `%APPDATA%\LifeQuest` stay.

`release/` is gitignored.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm run dev:desktop` | Electron + Vite desktop app (develop) |
| `npm run package` | Windows portable folder at `apps/desktop/release/win-unpacked/LifeQuest.exe` (dev build) |
| `npm run release` | Windows installer `.exe` + portable `.zip` under `apps/desktop/release/` (ship) |
| `npm test` | The desktop E2E rigs — each skips unless `npm run dev` is listening on 5173, except the cold-start rig, which serves the built `dist/` itself and skips unless `npm run build` has run |
| `npm run build` | Production Vite build + Electron main bundle (produces no artifact by itself) |
| `npm run typecheck` | Typecheck desktop renderer + main |

### Acceptance against a real vault

Three scripts under `apps/desktop/e2e/` are deliberately **not** in `npm test`, because they write to the operator's own vault rather than a fixture. Run them in order with `npm run dev` up:

```bash
node apps/desktop/e2e/dashboard-live-summary.mts   # pin a real summary table, via the companion's own tools
node apps/desktop/e2e/dashboard-live-app.mjs       # boot the built app and assert it renders + the lock toggles
node apps/desktop/e2e/dashboard-live-card.electron.mjs   # screenshot that exact card
```

Artifacts land in `apps/desktop/e2e/artifacts/dashboard-live-*.{json,png}`. The app is launched with `LIFEQUEST_E2E` (a throwaway profile and a hidden window), so `%APPDATA%\LifeQuest` is untouched.

### Acceptance of the packaged build

`npm test` proves the app works when Electron loads it off the disk, and `npm run release` proves files were written. Neither proves those files *run* — everything that breaks between them breaks only once the app is packed into `app.asar`. So a release is not a release until this passes against the built `.exe`:

```bash
npm run release
node apps/desktop/e2e/packaged-smoke.mjs
```

It checks the asar really holds the main, the preload and the renderer; then launches `release/win-unpacked/LifeQuest.exe` with a throwaway profile and a vault it creates in `%TEMP%`, and requires the window to reach the title `dist/index.html` declares, the app's own MCP door to bind, and the vault to come back rewritten into that throwaway `recent.json` — which between them can only happen if the preload shipped, React mounted, IPC round-tripped, and the vault opened from inside the asar. It exits non-zero with the app's own transcript when any of that fails, and writes `e2e/artifacts/packaged-smoke.json`. Your vault and `%APPDATA%\LifeQuest` are never opened. It is not part of `npm test`, because it needs that packaged build to exist first.

## Repository layout

```text
apps/desktop/          Electron main + Vite React UI (@lifequest/desktop)
packages/vault-core/   Vault FS library — create/open, domains, docs, decisions, log, agents
docs/superpowers/      Design specs and implementation plans
archive/web-skeleton/  Frozen Next.js + Prisma multi-user web app (not product runtime)
```

## Hermes (required for the studio)

The studio does not open without the companion. Capture is not the studio.

1. Run a Hermes / OpenAI-compatible gateway (default **`http://localhost:8642`**).
2. In the app: **Settings → Hermes** — base URL, API key if required, **Test connection**.
3. Chat and Personnel scan go through the **Electron main process** proxy; the renderer never holds the raw key.

LifeQuest owns the vault, the MCP door, and the UI. Hermes owns the agent loop, memory, skills, and transcripts.

## Vault identity

- Opening a vault **is** identity — no sign-up / sign-in.
- Doctrine is Markdown with frontmatter (`locked: true | false`).
- **Daily Note** is one markdown file per local date at `notes/daily/{YYYY-MM-DD}.md`: the operator's own account of the day, written from the rail entry under Decisions, and read back by any Review whose period covers it. The companion may read it and cannot write it.
- The Dashboard is the home pin board, one per lens, and it carries the same page lock: unlocked, the operator and the companion arrange it in place; locked, it is read-only and the companion's changes wait in Decisions. Type **Lock** / **Unlock** in the board header.
- Structured state is git-friendly JSON / JSONL under the vault’s prescribed layout.
- Active domain and recent vaults live in app `userData`, not inside the vault.
- Home includes **Data** and **Pages**.
- A domain database is `domains/{slug}/data/domain.sqlite` in the vault folder.
- Pages are `domains/{slug}/pages/{id}.json`.
- Conversational capture posts only when the amount and the account are clear, and the receipt names what was logged.

## Archived web skeleton

The earlier multi-user **Next.js + Prisma + SQLite** host lives under [`archive/web-skeleton/`](archive/web-skeleton/). It is a frozen reference tree and is **not** installed or run by root scripts. See that folder’s README if you need history.

## License

Private / unpublished unless otherwise noted.
