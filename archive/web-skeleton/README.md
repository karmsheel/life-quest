# Archived: Next.js + Prisma web skeleton

This directory is a **frozen historical snapshot** of the multi-user LifeQuest web app (Next.js App Router, Prisma, SQLite, cookie auth).

It is **not** the product runtime.

## Why it is here

LifeQuest pivoted to a **local-first Electron desktop** app with a user-chosen vault folder (Markdown + git-native JSON/JSONL). The web multi-user host was archived so product IA (Domains, rooms, Decisions, Life log, Personnel, Hermes chat) can still be referenced without shipping Next/Prisma as the primary path.

## Product runtime (current)

- Desktop app: `apps/desktop` (`@lifequest/desktop`)
- Vault FS library: `packages/vault-core` (`@lifequest/vault-core`)
- Specs/plans: `docs/superpowers/`

From the repo root:

```bash
npm install
npm run dev          # Electron desktop
npm test             # vault-core unit tests
```

## Contents of this archive

| Path | Role |
|------|------|
| `app/` | Next.js App Router pages + API routes |
| `components/` | React UI for the web shell |
| `lib/` | Auth, Prisma helpers, Hermes proxy helpers, domain logic |
| `prisma/` | Schema + migrations (SQLite) |
| `tests/unit/` | Pure-helper unit tests for the web stack |
| `middleware.ts`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json` | Next/web tooling |
| `.env.example` | Web env (`DATABASE_URL`, `AUTH_SECRET`) |

## Restoring / running (historical only)

This tree is **not** an npm workspace package and is not installed from the root monorepo. To experiment with it as of the archive commit:

1. Check out this tree (or copy it) into a standalone project.
2. Restore a historical root `package.json` that lists Next/Prisma deps (see git history before the archive commit).
3. `npm install`, copy `.env.example` → `.env`, `npx prisma migrate dev`, `npx next dev`.

No support guarantee; prefer the Electron vault path for all new work.
