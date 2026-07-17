# LifeQuest Skeleton — Design Spec

**Date:** 2026-07-17  
**Status:** Approved for implementation planning  
**Product:** LifeQuest — manage your life with Hermes agents  
**Reference architecture:** [Hermes Forge](https://github.com/karmsheel/hermes-forge) (patterns only; greenfield code)

---

## 1. Purpose

LifeQuest is a **life-management studio** powered by Hermes agents. The first deliverable is a **skeleton frame**: shell chrome, multi-domain tenancy, document-centric Why → What → How journey, governance (forged docs + Decisions), Life log, Personnel (agent scan), and Hermes connection + chat — without porting Forge product features that were not explicitly requested.

### Success thesis

Users organize life into **Domains**. In each Domain they forge three canonical documents — **Why**, **What**, **How** — through rooms **Dream → Chart → Track**, with **Act** reserved for agents. Changes to forged doctrine go through human-in-the-loop **Decisions**. An append-only **Life log** records meaningful events.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Switchable unit | **Domain** (e.g. Health, Intellectual, Emotional, Financial) |
| 2 | Rooms | **Dream · Chart · Track · Act** (quest pipeline) |
| 3 | Primary artifact | **Documents only** (no systems/quests model in skeleton) |
| 4 | Journey pillars | **Why** (reasons) → **What** (North Star) → **How** (strategy, tactics, habits) |
| 5 | Room ownership | Dream=Why, Chart=What, Track=How, Act=agents running How (thin) |
| 6 | Room unlock | **Non-empty body** on prior pillar unlocks next room (draft is enough; forge is quality bar) |
| 7 | Docs per Domain | Exactly one **Why**, **What**, **How** |
| 8 | Domain catalog | Seed four Domains; rename / archive / add custom |
| 9 | Home composer | **UI stub** only (no journey wiring) |
| 10 | Personnel | **Hermes agents only** via **agent scan** + hire/dismiss |
| 11 | Auth | Multi-user (sign-up / sign-in, cookie session) |
| 12 | Runtime | **Web only** (no Electron) |
| 13 | Hermes depth | Connection settings + global chat shell (send/receive); no tools / no pillar injection |
| 14 | Doc governance | User-driven status; forged read-only; Decisions propose → approve/reject |
| 15 | Life log | Domain + document + decision + agent events only |
| 16 | Build method | **Greenfield** Next app; Forge as IA/pattern reference, not a fork |
| 17 | Skeleton done bar | Clickable IA + real persistence + Hermes chat when gateway up |

### Explicitly out of scope (skeleton)

- Electron / desktop packaging  
- Process maps, workshop, plant PFD, functions, metrics, content studio, n8n/automations, cronalytics  
- Human contacts / CRM in Personnel  
- Hermes tool-use, auto-decisions, pillar-aware system prompts  
- Freeform documents beyond Why / What / How  
- Real Act job scheduling / runners  
- Home composer → journey wiring  
- Shared/multiplayer Domains  
- Full Forge theme marketplace (light/dark + simple tokens is enough)

---

## 3. Architecture approach

**Chosen: Forge-shaped greenfield**

| Layer | Choice |
|-------|--------|
| Framework | Next.js App Router + TypeScript |
| Data | Prisma + SQLite |
| Auth | Cookie session (JWT or iron-session style; Forge-like) |
| UI shell | Left nav rail, top multi-tab, room switcher, right global chatbar |
| Agent runtime | User BYOK Hermes OpenAI-compatible API via server proxy |
| Desktop | Not in skeleton |

**Rejected alternatives**

- Chrome-first mocks then DB later (fails persistence done-bar)  
- Early multi-package monorepo (overhead before product exists)  
- Fork Hermes Forge and delete (explicitly rejected)

---

## 4. Information architecture

### Shell layout

```
┌──────────┬──────────────────────────────┬─────────────┐
│ Nav rail │ Top: multi-tab + room picker │ Global      │
│          │                              │ chatbar     │
│ Domain   │ Main outlet                  │ (Hermes)    │
│ mark →   │                              │             │
│ manager  │                              │             │
│ Home     │                              │             │
│ Dream*   │                              │             │
│ Chart*   │                              │             │
│ Track*   │                              │             │
│ Act*     │                              │             │
│ Documents│                              │             │
│ Personnel│                              │             │
│ ─────    │                              │             │
│ Decisions│                              │             │
│ Life log │                              │             │
│ ─────    │                              │             │
│ Profile  │                              │             │
│ Settings │                              │             │
└──────────┴──────────────────────────────┴─────────────┘
* Rooms show locked affordance until unlock rules pass
```

### Routes

| Route | Role |
|-------|------|
| `/sign-in`, `/sign-up` | Auth |
| `/home` | Composer stub |
| `/domains` | Domain manager / picker (Forge business-manager analog) |
| `/dream` | Why document surface |
| `/chart` | What document surface |
| `/track` | How document surface |
| `/act` | Thin agents surface + link to Personnel |
| `/documents` | List/edit three canonical docs for active Domain |
| `/personnel` | Hermes agent scan + hire/dismiss roster |
| `/decisions` | Pending + history HITL inbox |
| `/log` | Life log feed |
| `/profile` | Profile |
| `/settings` | Appearance, Hermes connection, about |

### Active Domain

- Session-scoped **active Domain** (cookie), analogous to Forge active business.  
- Rooms, documents, decisions filter, log filter, and chat context **label** (display only) scope to it.  
- **Global** Domain switcher for all tabs in skeleton (not per-tab Domain).

### Multi-tab

- Notion-style shell tabs over routes (Forge multi-tab pattern).  
- Persist tab set in `sessionStorage` or user preference JSON.  
- New tab defaults to `/home` or current route.

### Room unlock rules

| Condition | Unlocks |
|-----------|---------|
| Domain exists | **Dream** |
| Why has non-empty `bodyMarkdown` (any status) | **Chart** |
| What has non-empty body | **Track** |
| How has non-empty body | **Act** |

Notes:

- Creating a Domain seeds three document rows with empty bodies; empty does **not** unlock later rooms.  
- Forging is a quality/governance bar, not a room gate.  
- Sidebar holistic items (Documents, Personnel, Decisions, Life log) stay available regardless of room lock.

---

## 5. Data model

### Entities

**User**  
`id`, `email`, `passwordHash`, `name`, `createdAt`

**Domain**  
`id`, `userId`, `name`, `description?`, `avatarKey?` / `color?`, `sortOrder`, `archivedAt?`, `createdAt`, `updatedAt`

**DomainDocument**  
`id`, `domainId`, `kind` (`why` \| `what` \| `how`), `title`, `bodyMarkdown`, `status` (`draft` \| `refined` \| `forged`), `createdAt`, `updatedAt`, `forgedAt?`  
**Unique:** `(domainId, kind)`

**Decision**  
`id`, `domainId`, `documentId`, `status` (`pending` \| `approved` \| `rejected`), `title`, `rationale?`, `proposedBodyMarkdown`, `previousBodyMarkdown?`, `createdAt`, `resolvedAt?`, `resolvedByUserId?`

**LifeEvent**  
`id`, `userId`, `domainId?`, `type`, `summary`, `payloadJson?`, `createdAt`  
Append-only (no product update/delete).

**AgentHire**  
`id`, `userId`, `domainId?` (optional; skeleton may keep global roster), `hermesAgentId`, `name`, `roleLabel?`, `status` (`active` \| `dismissed`), `createdAt`, `dismissedAt?`

**HermesSettings** (per user)  
`userId`, `baseUrl`, `apiKey` (local-dev may store plaintext; harden later), `updatedAt`

**ChatThread / ChatMessage**  
Skeleton may keep chat history **in client session state** (or DB if cheap). Persistence across devices is not required for DoD; live send/receive is.

### Seed on first signup

Create four Domains for the new user:

1. Health  
2. Intellectual  
3. Emotional  
4. Financial  

Each gets Why / What / How rows with empty bodies and `status = draft`. Activate first Domain (e.g. Health) by default.

---

## 6. Document governance

### Status transitions (user-driven)

```
draft ──► refined ──► forged
  │                     ▲
  └─────────────────────┘  (refined is optional; draft may forge directly)
```

| Status | In-place edit | Content change path |
|--------|---------------|---------------------|
| `draft` | Yes | Save |
| `refined` | Yes | Save |
| `forged` | **No** | Propose Decision → approve applies new body |

### Decision flow

1. User opens forged doc → **Propose change**.  
2. Proposed markdown + optional rationale → `Decision` `pending`; snapshot current body to `previousBodyMarkdown`.  
3. Decisions page: **Approve** → replace doc body, keep `forged`, write life events; **Reject** → close decision, doc unchanged.  
4. Skeleton UI: current body read-only + proposed textarea (full diff UI optional later).

### How document template

Default How structure is an **editor placeholder**, not auto-persisted on open (so merely opening Track does not unlock Act):

```markdown
# Strategy

# Tactics

# Habits
```

- Placeholder appears when `bodyMarkdown` is empty.  
- Persist only on explicit **Save**.  
- After save, non-empty body (including template-only headings if the user saved them) unlocks **Act**.  
- Why / What: coaching questions as UI chrome above the editor, not file content.

---

## 7. Room & page surfaces

| Surface | Behavior |
|---------|----------|
| **Dream** | Why coaching copy + markdown editor + status actions |
| **Chart** | What surface; locked until Why non-empty |
| **Track** | How surface (placeholder template until save); locked until What non-empty |
| **Act** | Empty-state explaining agents run How; list active hires; CTA to Personnel; locked until How non-empty |
| **Home** | Composer UI; submit no-op / “coming soon” toast |
| **Documents** | Cards/list of three canonical docs; no “new freeform doc” |
| **Personnel** | **Scan** Hermes for available agents when connected; hire / dismiss; disconnected empty state points to Settings |
| **Decisions** | Pending \| History; approve / reject |
| **Life log** | Reverse-chronological; filter active Domain or all |
| **Settings** | Hermes URL/key + connection test; appearance light/dark + tokens |
| **Profile** | Name, email |

### Shared document chrome

Title, status badge, Save, Mark refined, Forge, Propose change (if forged). Reuse one editor component in rooms and Documents.

---

## 8. Life log

### Event types (skeleton)

| Type | When |
|------|------|
| `domain.created` | Domain created |
| `domain.renamed` | Name changed |
| `domain.archived` / `domain.restored` | Archive toggle |
| `document.created` | Doc row first created |
| `document.updated` | Body saved (non-decision path) |
| `document.status_changed` | draft / refined / forged |
| `decision.created` | Proposal opened |
| `decision.approved` / `decision.rejected` | Resolution |
| `agent.hired` / `agent.dismissed` | Personnel |

**Not logged:** room navigation, tab switches, raw chat tokens/transcripts.

---

## 9. Hermes integration (skeleton)

- Settings: base URL (default `http://localhost:8642`), API key, **Test connection**.  
- Server proxy: `POST /api/hermes/chat` (and health/status as needed).  
- Global right **chatbar**: collapsed tab + panel; send/receive when connected.  
- **No** tool calling, **no** automatic injection of Why/What/How into system prompts (label/context chip may show active Domain name only).  
- Personnel **scan** uses Hermes agent/profile listing endpoints (mirror Forge personnel scan pattern).

---

## 10. API surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/sign-up` | Register + seed Domains |
| POST | `/api/auth/sign-in` | Login |
| POST | `/api/auth/sign-out` | Logout |
| GET | `/api/auth/me` | Current user + active Domain |
| GET, POST | `/api/domains` | List / create |
| PATCH, DELETE | `/api/domains/[id]` | Update / archive |
| POST | `/api/domains/[id]/activate` | Set active Domain cookie |
| GET, PATCH | `/api/domains/[id]/documents/[kind]` | Get / update Why\|What\|How |
| POST | `/api/domains/[id]/documents/[kind]/status` | refined / forge |
| GET, POST | `/api/decisions` | List / create proposal |
| POST | `/api/decisions/[id]/resolve` | approve \| reject |
| GET | `/api/log` | Life events (`domainId?`) |
| GET | `/api/personnel/scan` | Hermes agent scan |
| GET, POST | `/api/personnel` | List hires / hire |
| DELETE | `/api/personnel/[id]` | Dismiss |
| GET, PUT | `/api/settings/hermes` | Connection config |
| POST | `/api/hermes/chat` | Chat proxy |
| GET, POST | `/api/chat/threads`… | Optional; omit if chat is session-only |

**Server rules:** ownership checks on every Domain-scoped resource; reject in-place PATCH body when `status === forged`; unlock helpers pure functions of document bodies.

---

## 11. UI / brand (skeleton)

- App name: **LifeQuest**.  
- Visual language: neutral chrome, token CSS variables (Forge-inspired structure, LifeQuest naming).  
- Appearance: light / dark minimum.  
- Accent discipline: primary CTA vs selection vs success (same idea as Forge; exact palette free).  
- Room picker labels: Dream, Chart, Track, Act (not Foundation/Map/Monitor/Automate).

---

## 12. Definition of done (skeleton)

1. Sign up → four seed Domains.  
2. Dream: write Why, save → Chart unlocks.  
3. Chart What → Track unlocks; Track How → Act unlocks.  
4. Forge a doc → in-place edit blocked → Decision propose → approve updates body + log.  
5. Life log shows domain / document / decision / agent events.  
6. Personnel: scan Hermes agents, hire, dismiss (with connection).  
7. Settings Hermes + chatbar round-trip when gateway is up.  
8. Multi-tab, Domain picker, profile, themes/settings reachable.  
9. Home composer visible as stub.

---

## 13. Suggested implementation sequence

1. App scaffold (Next, Prisma, tokens, auth).  
2. Shell chrome (nav, tabs, Domain picker, room switcher, chatbar shell).  
3. Domain + documents + unlock helpers.  
4. Room pages + Documents editor.  
5. Decisions + forged immutability.  
6. Life log writers on mutations.  
7. Personnel scan / hire / dismiss.  
8. Hermes settings + chat proxy.  
9. Empty states, seed polish, DoD walkthrough.

---

## 14. Design process notes

- Product grilled via Matt Pocock **grill-me** / **grilling** (one decision at a time).  
- Process skills: Superpowers **brainstorming** (no implementation before approved design).  
- Hermes Forge used as shell/IA reference only; features not named by the product owner were not ported.

---

## 15. Open items deferred (intentionally)

| Item | When |
|------|------|
| Pillar-aware Hermes system prompts | After skeleton |
| Home composer → open Dream with brief | After skeleton |
| Per-tab Domain scoping | If multi-Domain parallel work hurts |
| Encrypt Hermes API keys at rest | Before any shared deploy |
| Act job runner / schedules | Post-skeleton Act depth |
| Freeform docs / systems model | New product phase |
| Electron desktop | Explicit later phase |

---

## 16. Approval

| Section | Status |
|---------|--------|
| §1 IA & navigation | Approved |
| §2 Data model & governance | Approved |
| §3 Surfaces, APIs, out-of-scope | Approved (Personnel = agent scan) |
| Full ledger | Shared understanding locked |

**Next step after user reviews this file:** Superpowers **writing-plans** → implementation plan; then build.
