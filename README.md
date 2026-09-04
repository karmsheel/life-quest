# LifeQuest

**Local-first life-management studio** for the desktop. Open or create a **vault folder** on your machine; Domains, doctrine (Why → What → How), Decisions, Life log, and agent roster live as plain files beside each other. Hermes remains an optional local BYOK gateway.

The product runtime is **Electron + Vite + React**. There is no cloud account and no Prisma/SQLite in the desktop path.

## Design

| Doc | Description |
|-----|-------------|
| [PRODUCT.md](PRODUCT.md) | Users, purpose, anti-references |
| [DESIGN.md](DESIGN.md) | Token contract and primitives |
| [LAWS/](LAWS/) | Observable product invariants |
| [BERD systems phase 1](docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md) | CSS-native design contract |
| [BERD visuals phase 2](docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md) | Canvas/sheet, concentric radii, pill buttons |
| [Three-pane studio](docs/superpowers/specs/2026-09-04-three-pane-studio-design.md) | Rail, main, and chat as separate 12px cards |
| [Local vault (Electron) design](docs/superpowers/specs/2026-07-19-local-vault-electron-design.md) | Current product host & vault layout |
| [Local vault plan](docs/superpowers/plans/2026-07-19-local-vault-electron.md) | Implementation plan |
| [Skeleton design](docs/superpowers/specs/2026-07-17-lifequest-skeleton-design.md) | Product IA (Domains / rooms / forge / log) |
| [Hermes chatbar design](docs/superpowers/specs/2026-07-18-hermes-chatbar-connection-design.md) | Hermes connection UX |

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | Developed on Node 22; 20 LTS minimum target |
| **npm** | Workspaces monorepo |
| **Hermes gateway** (optional) | Default `http://localhost:8642` for chat / test / Personnel scan |

## Quick start

```bash
# 1. Install workspace dependencies
npm install

# 2. Run the desktop app
npm run dev
# same as: npm run dev:desktop
```

On launch:

1. **Create vault** — pick an empty folder; LifeQuest seeds four Domains (Health, Intellectual, Emotional, Financial) with empty Why / What / How Markdown.
2. **Open vault** — pick an existing LifeQuest vault directory (or a recent path).
3. Work offline against files on disk. API keys never enter the vault (OS secure storage via Electron `safeStorage`).

### Use the packaged app (Windows)

```bash
npm run package
```

Then double-click `apps/desktop/release/win-unpacked/LifeQuest.exe`. No Node or `npm run dev` is required to *use* that build.

Windows SmartScreen may warn on first launch (unsigned private build). Choose **More info → Run anyway**. Quit LifeQuest before running `npm run package` again — a running `.exe` can lock files under `release/`. Deleting `win-unpacked` removes that build only; vault folders and `%APPDATA%\LifeQuest` stay.

`release/` is gitignored.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm run dev:desktop` | Electron + Vite desktop app (develop) |
| `npm run package` | Windows portable folder at `apps/desktop/release/win-unpacked/LifeQuest.exe` (use) |
| `npm test` | `@lifequest/vault-core` unit tests + desktop packaging tests |
| `npm run build` | Production Vite build + Electron main bundle (does not produce an `.exe`) |
| `npm run typecheck` | Typecheck desktop renderer + main |

## Repository layout

```text
apps/desktop/          Electron main + Vite React UI (@lifequest/desktop)
packages/vault-core/   Vault FS library — create/open, domains, docs, decisions, log, agents
docs/superpowers/      Design specs and implementation plans
archive/web-skeleton/  Frozen Next.js + Prisma multi-user web app (not product runtime)
```

## Hermes (optional)

1. Run a Hermes / OpenAI-compatible gateway (default **`http://localhost:8642`**).
2. In the app: **Settings → Hermes** — base URL, API key if required, **Test connection**.
3. Chat and Personnel scan go through the **Electron main process** proxy; the renderer never holds the raw key.

Skeleton Hermes scope: connection + chat + agent scan — no tool-use auto-decisions in v1.

## Vault identity

- Opening a vault **is** identity — no sign-up / sign-in.
- Doctrine is Markdown with frontmatter (`status: draft | refined | forged`).
- Structured state is git-friendly JSON / JSONL under the vault’s prescribed layout.
- Active domain and recent vaults live in app `userData`, not inside the vault.

## Archived web skeleton

The earlier multi-user **Next.js + Prisma + SQLite** host lives under [`archive/web-skeleton/`](archive/web-skeleton/). It is a frozen reference tree and is **not** installed or run by root scripts. See that folder’s README if you need history.

## License

Private / unpublished unless otherwise noted.
