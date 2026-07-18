# LifeQuest

Life management studio powered by Hermes agents. This repository ships the **skeleton frame**: multi-user auth, Domain tenancy (Why → What → How), Dream / Chart / Track / Act rooms, forged-document Decisions, Life log, Personnel agent scan, shell chrome, and Hermes BYOK chat.

Design and implementation plan:

- [Design spec](docs/superpowers/specs/2026-07-17-lifequest-skeleton-design.md)
- [Implementation plan](docs/superpowers/plans/2026-07-17-lifequest-skeleton.md)

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | Developed on Node 22; 20 LTS is the minimum target |
| **npm** | Comes with Node |
| **Hermes gateway** (optional) | Default `http://localhost:8642` for chat, connection test, and Personnel scan |

No Docker required. SQLite is used via Prisma (`prisma/dev.db`).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Environment
cp .env.example .env
# Edit .env — set AUTH_SECRET to a long random string (16+ chars; 32+ recommended)

# 3. Database
npx prisma migrate dev
# (or: npm run db:migrate)

# 4. Dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Continue with local account** — no email/password; one local profile on this machine (recommended for personal use). Seeds four Domains on first use.
- **Sign up / Sign in** — optional email accounts for multi-user.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` | `prisma generate` + production build |
| `npm start` | Run production server |
| `npm test` | Unit tests (pure helpers) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:push` | `prisma db push` (schema push without migration history) |

## Environment variables

Copy `.env.example` to `.env`:

```env
DATABASE_URL="file:./dev.db"
AUTH_SECRET="dev-secret-change-me-min-32-chars-long!!"
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Prisma SQLite URL. Relative paths resolve from the `prisma/` directory (`file:./dev.db` → `prisma/dev.db`). |
| `AUTH_SECRET` | Yes | JWT signing secret for session cookies. Must be set and at least 16 characters. **Change this** before any shared or production deploy. |

Hermes base URL and API key are **per-user** (Settings → Hermes), not env vars.

## Hermes (optional)

LifeQuest proxies Hermes from the **Next.js server** (BYOK). The browser never talks to the gateway directly for chat or scan.

1. Run a Hermes / OpenAI-compatible gateway (default **`http://localhost:8642`**).
2. In the app: **Settings → Hermes** — set base URL, paste API key if required, **Save**, then **Test connection**.
3. Use the right **Chat** panel for send/receive (non-streaming skeleton).
4. **Personnel → Scan Hermes agents** lists agents/profiles when the gateway exposes them.

### CORS / localhost notes

- Chat, health, and agent scan call Hermes from the **server**, so browser CORS does **not** apply to those paths.
- Prefer `http://localhost:8642` (or `127.0.0.1`) on the same machine as Next. Docker/WSL: use a host URL the Next process can reach, not only the browser.
- `/health` may succeed while chat/models return **401 Invalid API key** — configure the key in Settings. The UI surfaces gateway errors with a link back to Settings.
- Personnel scan tries several list paths (`/v1/agents`, `/agents`, `/v1/profiles`, `/v1/models`) and returns a warning if the gateway is up but no list is available.

Skeleton Hermes scope: connection + chat + agent scan only — **no** tool-use, **no** pillar injection into system prompts.

## App map

| Area | Route | Notes |
|------|-------|--------|
| Home | `/home` | Composer **stub** (not wired to the journey yet) |
| Dream / Chart / Track / Act | `/dream` … `/act` | Rooms; unlock when prior pillar body is non-empty |
| Documents | `/documents` | Why / What / How editor |
| Domains | `/domains` | List, create, rename, archive, activate |
| Decisions | `/decisions` | HITL approve/reject for forged docs |
| Life log | `/log` | Append-only domain / document / decision / agent events |
| Personnel | `/personnel` | Scan, hire, dismiss Hermes agents |
| Profile / Settings | `/profile`, `/settings` | Account + theme + Hermes |

**Unlock chain:** Dream always open → non-empty **Why** unlocks Chart → non-empty **What** unlocks Track → non-empty **How** unlocks Act. Draft is enough; **forge** is the quality bar (read-only body; changes go through Decisions).

## Definition of done (skeleton)

From the [design spec §12](docs/superpowers/specs/2026-07-17-lifequest-skeleton-design.md):

1. Sign up → four seed Domains  
2. Dream: write Why, save → Chart unlocks  
3. Chart What → Track unlocks; Track How → Act unlocks  
4. Forge a doc → in-place edit blocked → Decision propose → approve updates body + log  
5. Life log shows domain / document / decision / agent events  
6. Personnel: scan Hermes agents, hire, dismiss (with connection)  
7. Settings Hermes + chatbar round-trip when gateway is up (and key configured)  
8. Multi-tab, Domain picker, profile, themes/settings reachable  
9. Home composer visible as stub  

## Stack

- **Next.js** (App Router) + React + TypeScript  
- **Prisma** + SQLite  
- **jose** + **bcryptjs** for cookie sessions  
- **Tailwind CSS** v4 + design tokens in `app/tokens.css`  

## Out of scope (skeleton)

Electron, process maps / plant PFD, human CRM in Personnel, Hermes tools / auto-decisions, freeform docs beyond Why/What/How, Act job runners, Home composer → journey wiring. See the design spec for the full deferral list.

## License

Private / unpublished unless otherwise noted.
