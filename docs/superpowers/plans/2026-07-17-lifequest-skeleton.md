# LifeQuest Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a greenfield LifeQuest web skeleton: multi-user auth, Domain tenancy with Why/What/How documents, Dream/Chart/Track/Act rooms with draft unlock, Decisions HITL for forged docs, Life log, Personnel agent scan, shell chrome (nav, tabs, chatbar), and Hermes BYOK chat.

**Architecture:** Next.js App Router app with Prisma/SQLite, cookie JWT sessions, and a shell layout (left nav, top multi-tab + room picker, right chatbar). Domain is the tenancy unit; three canonical documents per Domain drive unlock and governance. Hermes is proxied server-side; no tool-use in skeleton.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Prisma 6 + SQLite, jose (JWT), bcryptjs, zod, lucide-react, Tailwind CSS 4, Node native test runner (`node --test` + strip-types)

**Spec:** `docs/superpowers/specs/2026-07-17-lifequest-skeleton-design.md`

## Global Constraints

- Greenfield only — do **not** fork Hermes Forge; use it as IA/pattern reference only
- Web only — no Electron
- Primary artifact: exactly three documents per Domain (`why` | `what` | `how`)
- Rooms: **Dream · Chart · Track · Act** (not Foundation/Map/Monitor/Automate)
- Unlock: non-empty `bodyMarkdown` on prior pillar (not forged); empty seed rows do not unlock
- How template is editor placeholder only — do not auto-persist on open
- Forged docs are read-only; changes only via Decisions approve
- Personnel: Hermes **agent scan** + hire/dismiss only (no humans)
- Home composer: UI stub (submit no-op)
- Hermes: connection + chat send/receive only — no pillar injection, no tools
- Life log: domain/document/decision/agent events only
- Seed Domains on signup: Health, Intellectual, Emotional, Financial
- Auth: multi-user sign-up / sign-in, cookie session
- App name in UI: **LifeQuest**
- Prefer small focused files; TDD for pure domain logic first

---

## File Structure

```
life-quest/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── prisma/
│   ├── schema.prisma
│   └── migrations/…
├── prisma.config.ts          # if required by Prisma 6
├── .env                      # DATABASE_URL, AUTH_SECRET
├── middleware.ts             # protect (shell) routes
├── app/
│   ├── globals.css
│   ├── tokens.css
│   ├── layout.tsx
│   ├── page.tsx              # redirect → /home or /sign-in
│   ├── sign-in/page.tsx
│   ├── sign-up/page.tsx
│   ├── (shell)/
│   │   ├── layout.tsx        # AppShell
│   │   ├── home/page.tsx
│   │   ├── domains/page.tsx
│   │   ├── dream/page.tsx
│   │   ├── chart/page.tsx
│   │   ├── track/page.tsx
│   │   ├── act/page.tsx
│   │   ├── documents/page.tsx
│   │   ├── personnel/page.tsx
│   │   ├── decisions/page.tsx
│   │   ├── log/page.tsx
│   │   ├── profile/page.tsx
│   │   └── settings/page.tsx
│   └── api/
│       ├── auth/{sign-up,sign-in,sign-out,me}/route.ts
│       ├── domains/route.ts
│       ├── domains/[id]/route.ts
│       ├── domains/[id]/activate/route.ts
│       ├── domains/[id]/documents/[kind]/route.ts
│       ├── domains/[id]/documents/[kind]/status/route.ts
│       ├── decisions/route.ts
│       ├── decisions/[id]/resolve/route.ts
│       ├── log/route.ts
│       ├── personnel/route.ts
│       ├── personnel/scan/route.ts
│       ├── personnel/[id]/route.ts
│       ├── settings/hermes/route.ts
│       └── hermes/{chat,status}/route.ts
├── components/
│   ├── auth/AuthForm.tsx
│   ├── shell/
│   │   ├── AppShell.tsx
│   │   ├── NavRail.tsx
│   │   ├── TopBar.tsx
│   │   ├── RoomSwitcher.tsx
│   │   ├── DomainSwitcher.tsx
│   │   ├── TabBar.tsx
│   │   ├── TabProvider.tsx
│   │   ├── ShellProvider.tsx
│   │   └── RoomLockGate.tsx
│   ├── documents/
│   │   ├── DocumentEditor.tsx
│   │   ├── DocumentStatusBadge.tsx
│   │   └── ProposeChangeDialog.tsx
│   ├── decisions/DecisionsInbox.tsx
│   ├── log/LifeLogFeed.tsx
│   ├── personnel/PersonnelStudio.tsx
│   ├── home/HomeComposerStub.tsx
│   ├── chatbar/
│   │   ├── ChatbarProvider.tsx
│   │   └── ChatbarPanel.tsx
│   ├── settings/SettingsContent.tsx
│   ├── profile/ProfileContent.tsx
│   └── theme/ThemeProvider.tsx
├── lib/
│   ├── prisma.ts
│   ├── auth.ts                 # hash, jwt, cookies, requireUser
│   ├── constants.ts            # SEED_DOMAINS, HOW_PLACEHOLDER, cookies
│   ├── document-kinds.ts       # types + parsers
│   ├── unlock.ts               # room unlock pure functions
│   ├── documents.ts            # status transitions, forge rules
│   ├── decisions.ts            # propose/approve/reject pure helpers
│   ├── life-log.ts             # event types + append helper
│   ├── domains.ts              # seed domains + ensure docs
│   ├── personnel.ts            # hire/dismiss helpers
│   ├── hermes.ts               # client config + fetch helpers
│   └── api.ts                  # json helpers, error responses
└── tests/
    └── unit/
        ├── unlock.test.ts
        ├── documents.test.ts
        ├── decisions.test.ts
        ├── life-log-types.test.ts
        └── domains-seed.test.ts
```

---

### Task 1: Project scaffold + domain pure logic (unlock, docs, seed constants)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.env`, `.env.example`, `.gitignore`
- Create: `app/globals.css`, `app/tokens.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `lib/constants.ts`, `lib/document-kinds.ts`, `lib/unlock.ts`, `lib/documents.ts`, `lib/life-log.ts`
- Create: `tests/unit/unlock.test.ts`, `tests/unit/documents.test.ts`, `tests/unit/life-log-types.test.ts`
- Create: `scripts/test-register.mjs` (optional path alias) or use relative imports in tests

**Interfaces:**
- Produces:
  - `DocumentKind = "why" | "what" | "how"`
  - `DocumentStatus = "draft" | "refined" | "forged"`
  - `RoomId = "dream" | "chart" | "track" | "act"`
  - `isNonEmptyBody(body: string): boolean`
  - `getUnlockedRooms(docs: { kind: DocumentKind; bodyMarkdown: string }[]): Set<RoomId>`
  - `isRoomUnlocked(room: RoomId, docs: …): boolean`
  - `canTransitionStatus(from: DocumentStatus, to: DocumentStatus): boolean`
  - `assertEditable(status: DocumentStatus): { ok: true } | { ok: false; reason: string }`
  - `LIFE_EVENT_TYPES` readonly list + `isLifeEventType(s: string): boolean`
  - `SEED_DOMAIN_NAMES = ["Health","Intellectual","Emotional","Financial"]`
  - `HOW_PLACEHOLDER` markdown string (not auto-saved)
  - `ACTIVE_DOMAIN_COOKIE = "lq_active_domain"`
  - `SESSION_COOKIE = "lq_session"`

- [ ] **Step 1: Scaffold Next app files**

Create `package.json`:

```json
{
  "name": "life-quest",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "test": "node --experimental-strip-types --test tests/unit/*.test.ts",
    "lint": "eslint",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "@prisma/client": "6.19.3",
    "bcryptjs": "^3.0.3",
    "jose": "^6.2.3",
    "lucide-react": "^0.511.0",
    "next": "16.2.9",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sonner": "^2.0.7",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.19.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "eslint": "^9",
    "eslint-config-next": "16.2.9",
    "prisma": "6.19.3",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.8.0"
  }
}
```

Create `tsconfig.json` with `"paths": { "@/*": ["./*"] }`, `strict: true`.  
Create `next.config.ts` exporting default `{}`.  
Create `postcss.config.mjs` with `@tailwindcss/postcss`.  
Create `.env` and `.env.example`:

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="dev-secret-change-me-min-32-chars-long!!"
```

Create `.gitignore`: `node_modules`, `.next`, `.env`, `prisma/*.db`, `*.db`.

`app/tokens.css` — CSS variables for light/dark (`--bg`, `--fg`, `--accent`, `--border`, `--muted`, `--selected`, `--success`, `--danger`, shell widths).  
`app/globals.css` — `@import "tailwindcss"; @import "./tokens.css";` plus minimal shell layout classes (`.app-shell`, `.nav-rail`, `.chatbar`, etc.).  
`app/layout.tsx` — root html/body, import globals, `{children}`.  
`app/page.tsx` — `redirect("/home")` (middleware will send unauthenticated users to sign-in later).

- [ ] **Step 2: Write failing unlock + document tests**

`lib/document-kinds.ts`:

```ts
export const DOCUMENT_KINDS = ["why", "what", "how"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ["draft", "refined", "forged"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const ROOM_IDS = ["dream", "chart", "track", "act"] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export function parseDocumentKind(s: string): DocumentKind | null {
  return (DOCUMENT_KINDS as readonly string[]).includes(s) ? (s as DocumentKind) : null;
}
```

`tests/unit/unlock.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUnlockedRooms, isNonEmptyBody, isRoomUnlocked } from "../../lib/unlock.ts";

describe("isNonEmptyBody", () => {
  it("rejects empty and whitespace", () => {
    assert.equal(isNonEmptyBody(""), false);
    assert.equal(isNonEmptyBody("  \n\t"), false);
  });
  it("accepts content", () => {
    assert.equal(isNonEmptyBody("growth"), true);
  });
});

describe("getUnlockedRooms", () => {
  it("always unlocks dream when domain exists (caller passes docs list)", () => {
    const rooms = getUnlockedRooms([]);
    assert.ok(rooms.has("dream"));
    assert.equal(rooms.has("chart"), false);
  });
  it("unlocks chart when why has body", () => {
    const rooms = getUnlockedRooms([{ kind: "why", bodyMarkdown: "reason" }]);
    assert.ok(rooms.has("dream"));
    assert.ok(rooms.has("chart"));
    assert.equal(rooms.has("track"), false);
  });
  it("unlocks full chain", () => {
    const rooms = getUnlockedRooms([
      { kind: "why", bodyMarkdown: "w" },
      { kind: "what", bodyMarkdown: "g" },
      { kind: "how", bodyMarkdown: "h" },
    ]);
    assert.deepEqual([...rooms].sort(), ["act", "chart", "dream", "track"]);
  });
  it("empty why body does not unlock chart", () => {
    const rooms = getUnlockedRooms([{ kind: "why", bodyMarkdown: "   " }]);
    assert.equal(isRoomUnlocked("chart", [{ kind: "why", bodyMarkdown: "   " }]), false);
    assert.ok(rooms.has("dream"));
  });
});
```

`tests/unit/documents.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertEditable, canTransitionStatus } from "../../lib/documents.ts";

describe("canTransitionStatus", () => {
  it("allows draft→refined, refined→forged, draft→forged", () => {
    assert.equal(canTransitionStatus("draft", "refined"), true);
    assert.equal(canTransitionStatus("refined", "forged"), true);
    assert.equal(canTransitionStatus("draft", "forged"), true);
  });
  it("rejects forged→anything and refined→draft", () => {
    assert.equal(canTransitionStatus("forged", "draft"), false);
    assert.equal(canTransitionStatus("forged", "refined"), false);
    assert.equal(canTransitionStatus("refined", "draft"), false);
  });
});

describe("assertEditable", () => {
  it("blocks forged", () => {
    const r = assertEditable("forged");
    assert.equal(r.ok, false);
  });
  it("allows draft and refined", () => {
    assert.equal(assertEditable("draft").ok, true);
    assert.equal(assertEditable("refined").ok, true);
  });
});
```

`tests/unit/life-log-types.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLifeEventType, LIFE_EVENT_TYPES } from "../../lib/life-log.ts";

describe("LIFE_EVENT_TYPES", () => {
  it("includes governance and domain events", () => {
    for (const t of [
      "domain.created",
      "document.status_changed",
      "decision.approved",
      "agent.hired",
    ]) {
      assert.ok(LIFE_EVENT_TYPES.includes(t as never));
      assert.equal(isLifeEventType(t), true);
    }
  });
  it("rejects nav noise", () => {
    assert.equal(isLifeEventType("room.switched"), false);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npm install
npm test
```

Expected: FAIL (modules not found / exports missing).

- [ ] **Step 4: Implement pure libs**

`lib/constants.ts`:

```ts
export const SEED_DOMAIN_NAMES = [
  "Health",
  "Intellectual",
  "Emotional",
  "Financial",
] as const;

export const HOW_PLACEHOLDER = `# Strategy

# Tactics

# Habits
`;

export const SESSION_COOKIE = "lq_session";
export const ACTIVE_DOMAIN_COOKIE = "lq_active_domain";
export const DEFAULT_HERMES_URL = "http://localhost:8642";
```

`lib/unlock.ts`:

```ts
import type { DocumentKind, RoomId } from "./document-kinds.ts";

export type UnlockDoc = { kind: DocumentKind; bodyMarkdown: string };

export function isNonEmptyBody(body: string): boolean {
  return body.trim().length > 0;
}

function bodyOf(docs: UnlockDoc[], kind: DocumentKind): string {
  return docs.find((d) => d.kind === kind)?.bodyMarkdown ?? "";
}

export function getUnlockedRooms(docs: UnlockDoc[]): Set<RoomId> {
  const rooms = new Set<RoomId>(["dream"]);
  if (isNonEmptyBody(bodyOf(docs, "why"))) rooms.add("chart");
  if (isNonEmptyBody(bodyOf(docs, "what"))) rooms.add("track");
  if (isNonEmptyBody(bodyOf(docs, "how"))) rooms.add("act");
  return rooms;
}

export function isRoomUnlocked(room: RoomId, docs: UnlockDoc[]): boolean {
  return getUnlockedRooms(docs).has(room);
}
```

`lib/documents.ts`:

```ts
import type { DocumentStatus } from "./document-kinds.ts";

export function canTransitionStatus(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  if (from === to) return false;
  if (from === "forged") return false;
  if (to === "draft") return false;
  if (from === "draft" && (to === "refined" || to === "forged")) return true;
  if (from === "refined" && to === "forged") return true;
  return false;
}

export function assertEditable(
  status: DocumentStatus,
): { ok: true } | { ok: false; reason: string } {
  if (status === "forged") {
    return { ok: false, reason: "Forged documents are read-only; propose a change via Decisions." };
  }
  return { ok: true };
}
```

`lib/life-log.ts`:

```ts
export const LIFE_EVENT_TYPES = [
  "domain.created",
  "domain.renamed",
  "domain.archived",
  "domain.restored",
  "document.created",
  "document.updated",
  "document.status_changed",
  "decision.created",
  "decision.approved",
  "decision.rejected",
  "agent.hired",
  "agent.dismissed",
] as const;

export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number];

export function isLifeEventType(s: string): s is LifeEventType {
  return (LIFE_EVENT_TYPES as readonly string[]).includes(s);
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs \
  .env.example .gitignore app lib tests
git commit -m "feat: scaffold LifeQuest app and domain pure logic"
```

Do **not** commit `.env`.

---

### Task 2: Prisma schema + domain seed helpers

**Files:**
- Create: `prisma/schema.prisma`, `lib/prisma.ts`, `lib/domains.ts`, `lib/api.ts`
- Create: `tests/unit/domains-seed.test.ts`
- Modify: `.env` (already has DATABASE_URL)

**Interfaces:**
- Produces:
  - `prisma` singleton from `lib/prisma.ts`
  - `seedDomainsForUser(userId: string): Promise<Domain[]>` — creates 4 domains × 3 docs, returns domains
  - `ensureCanonicalDocuments(domainId: string): Promise<void>`
  - `jsonOk(data, status?)`, `jsonError(message, status)`

- [ ] **Step 1: Write schema**

`prisma/schema.prisma`:

```prisma
generator client {
  provider   = "prisma-client-js"
  engineType = "binary"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  domains        Domain[]
  lifeEvents     LifeEvent[]
  agentHires     AgentHire[]
  hermesSettings HermesSettings?
  decisionsResolved Decision[] @relation("DecisionResolver")
}

model Domain {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  description String?
  color       String?
  sortOrder   Int       @default(0)
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  documents DomainDocument[]
  decisions Decision[]
  events    LifeEvent[]
  agents    AgentHire[]

  @@index([userId])
}

model DomainDocument {
  id           String   @id @default(cuid())
  domainId     String
  domain       Domain   @relation(fields: [domainId], references: [id], onDelete: Cascade)
  kind         String   // why | what | how
  title        String
  bodyMarkdown String   @default("")
  status       String   @default("draft") // draft | refined | forged
  forgedAt     DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  decisions Decision[]

  @@unique([domainId, kind])
  @@index([domainId])
}

model Decision {
  id                    String    @id @default(cuid())
  domainId              String
  domain                Domain    @relation(fields: [domainId], references: [id], onDelete: Cascade)
  documentId            String
  document              DomainDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  status                String    @default("pending") // pending | approved | rejected
  title                 String
  rationale             String?
  proposedBodyMarkdown  String
  previousBodyMarkdown  String?
  createdAt             DateTime  @default(now())
  resolvedAt            DateTime?
  resolvedByUserId      String?
  resolvedBy            User?     @relation("DecisionResolver", fields: [resolvedByUserId], references: [id])

  @@index([domainId, status])
}

model LifeEvent {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  domainId   String?
  domain     Domain?  @relation(fields: [domainId], references: [id], onDelete: SetNull)
  type       String
  summary    String
  payloadJson String?
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
  @@index([domainId, createdAt])
}

model AgentHire {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  domainId      String?
  domain        Domain?   @relation(fields: [domainId], references: [id], onDelete: SetNull)
  hermesAgentId String
  name          String
  roleLabel     String?
  status        String    @default("active") // active | dismissed
  createdAt     DateTime  @default(now())
  dismissedAt   DateTime?

  @@index([userId, status])
}

model HermesSettings {
  userId    String  @id
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  baseUrl   String  @default("http://localhost:8642")
  apiKey    String  @default("")
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: prisma generate + migrate**

```bash
npx prisma migrate dev --name init
```

Expected: migration applied, client generated.

- [ ] **Step 3: Implement prisma client, api helpers, seed**

`lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

`lib/api.ts`:

```ts
import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
```

`lib/domains.ts`:

```ts
import { prisma } from "./prisma.ts";
import { SEED_DOMAIN_NAMES } from "./constants.ts";
import { DOCUMENT_KINDS } from "./document-kinds.ts";

const TITLES: Record<string, string> = {
  why: "Why",
  what: "What",
  how: "How",
};

export async function ensureCanonicalDocuments(domainId: string) {
  for (const kind of DOCUMENT_KINDS) {
    await prisma.domainDocument.upsert({
      where: { domainId_kind: { domainId, kind } },
      create: {
        domainId,
        kind,
        title: TITLES[kind] ?? kind,
        bodyMarkdown: "",
        status: "draft",
      },
      update: {},
    });
  }
}

export async function seedDomainsForUser(userId: string) {
  const domains = [];
  for (let i = 0; i < SEED_DOMAIN_NAMES.length; i++) {
    const name = SEED_DOMAIN_NAMES[i]!;
    const domain = await prisma.domain.create({
      data: { userId, name, sortOrder: i },
    });
    await ensureCanonicalDocuments(domain.id);
    domains.push(domain);
  }
  return domains;
}
```

- [ ] **Step 4: Unit test seed constants (no DB required)**

`tests/unit/domains-seed.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SEED_DOMAIN_NAMES, HOW_PLACEHOLDER } from "../../lib/constants.ts";
import { DOCUMENT_KINDS } from "../../lib/document-kinds.ts";

describe("seed catalog", () => {
  it("has four starter domains", () => {
    assert.equal(SEED_DOMAIN_NAMES.length, 4);
    assert.ok(SEED_DOMAIN_NAMES.includes("Health"));
  });
  it("has three document kinds", () => {
    assert.deepEqual([...DOCUMENT_KINDS], ["why", "what", "how"]);
  });
  it("how placeholder is non-empty markdown but is NOT used for unlock-on-create", () => {
    assert.ok(HOW_PLACEHOLDER.includes("Strategy"));
  });
});
```

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma lib/prisma.ts lib/domains.ts lib/api.ts tests/unit/domains-seed.test.ts
git commit -m "feat: add Prisma schema and domain seed helpers"
```

---

### Task 3: Auth (sign-up with seed, sign-in, me, sign-out, middleware)

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/auth/sign-up/route.ts`, `sign-in/route.ts`, `sign-out/route.ts`, `me/route.ts`
- Create: `app/sign-in/page.tsx`, `app/sign-up/page.tsx`, `components/auth/AuthForm.tsx`
- Create: `middleware.ts`
- Modify: `app/page.tsx` if needed

**Interfaces:**
- Produces:
  - `hashPassword(pw: string): Promise<string>`
  - `verifyPassword(pw: string, hash: string): Promise<boolean>`
  - `createSessionToken(userId: string): Promise<string>`
  - `verifySessionToken(token: string): Promise<{ userId: string } | null>`
  - `setSessionCookie(token: string): void` via `cookies()` from `next/headers`
  - `requireUser(): Promise<User>` throws/returns 401 pattern for routes
  - `getSessionUser(): Promise<User | null>`

- [ ] **Step 1: Implement `lib/auth.ts`**

```ts
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma.ts";
import { SESSION_COOKIE } from "./constants.ts";

function secretKey() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET missing or too short");
  return new TextEncoder().encode(s);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(userId: string) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) return null;
  return user;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
```

- [ ] **Step 2: Auth API routes**

`app/api/auth/sign-up/route.ts` — parse JSON `{ email, password, name? }`, validate email/password length ≥ 8, reject duplicate email, `hashPassword`, create user, `seedDomainsForUser`, create `domain.created` LifeEvents for each (inline prisma.lifeEvent.create), set active domain cookie to first domain, `createSessionToken` + `setSessionCookie`, return `{ user: { id, email, name } }`.

`app/api/auth/sign-in/route.ts` — verify credentials, set session cookie, return user.

`app/api/auth/sign-out/route.ts` — clear cookie, `{ ok: true }`.

`app/api/auth/me/route.ts` — `getSessionUser`, 401 if null; also read `ACTIVE_DOMAIN_COOKIE`, validate domain belongs to user, return `{ user, activeDomainId, domains: slim list }`.

Use `jsonOk` / `jsonError` throughout.

- [ ] **Step 3: Auth UI pages**

`components/auth/AuthForm.tsx` — client form mode `sign-in` | `sign-up`, posts to API, on success `router.push("/home")`, shows error string.

`app/sign-in/page.tsx` / `app/sign-up/page.tsx` — render `AuthForm` + LifeQuest title.

- [ ] **Step 4: Middleware**

`middleware.ts` — if path starts with `/api/auth` allow; if path is `/sign-in` or `/sign-up` allow; if no `lq_session` cookie and path is not public, redirect to `/sign-in`. Matcher: all routes except `_next/static`, images, favicon.

- [ ] **Step 5: Manual smoke**

```bash
npx prisma migrate dev
npm run dev
```

- Sign up `test@example.com` / `password123`
- `GET /api/auth/me` returns user + 4 domains
- Sign out → redirect to sign-in on `/home`

- [ ] **Step 6: Commit**

```bash
git add lib/auth.ts app/api/auth app/sign-in app/sign-up components/auth middleware.ts
git commit -m "feat: add auth with domain seeding on sign-up"
```

---

### Task 4: Domains API + active Domain cookie

**Files:**
- Create: `app/api/domains/route.ts`, `app/api/domains/[id]/route.ts`, `app/api/domains/[id]/activate/route.ts`
- Create: `lib/life-log-write.ts` — `appendLifeEvent({ userId, domainId?, type, summary, payload? })`

**Interfaces:**
- Consumes: `requireUser`, `seed` patterns, `ACTIVE_DOMAIN_COOKIE`
- Produces: REST for list/create/patch/archive/activate; always writes life events on create/rename/archive

- [ ] **Step 1: `appendLifeEvent`**

```ts
// lib/life-log-write.ts
import { prisma } from "./prisma.ts";
import type { LifeEventType } from "./life-log.ts";

export async function appendLifeEvent(input: {
  userId: string;
  domainId?: string | null;
  type: LifeEventType;
  summary: string;
  payload?: unknown;
}) {
  return prisma.lifeEvent.create({
    data: {
      userId: input.userId,
      domainId: input.domainId ?? null,
      type: input.type,
      summary: input.summary,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
}
```

Refactor sign-up seed to use `appendLifeEvent` for `domain.created` (optional cleanup in this task).

- [ ] **Step 2: GET/POST `/api/domains`**

- GET: list non-archived domains for user (include documents summary: kind, status, bodyLength).
- POST: `{ name, description? }` → create domain, `ensureCanonicalDocuments`, `domain.created` event, return domain.

- [ ] **Step 3: PATCH/DELETE `/api/domains/[id]`**

- PATCH: name/description; if name changes → `domain.renamed`.
- DELETE: soft-archive (`archivedAt = now()`) → `domain.archived`. Optional POST restore later via PATCH `{ archived: false }` → `domain.restored`.

Ownership: `domain.userId === user.id` or 404.

- [ ] **Step 4: POST activate**

Sets `ACTIVE_DOMAIN_COOKIE` httpOnly cookie to domain id after ownership check. Return `{ activeDomainId }`.

- [ ] **Step 5: Smoke with curl**

```bash
# after sign-in cookie jar
curl -b cookies.txt http://localhost:3000/api/domains
curl -b cookies.txt -X POST http://localhost:3000/api/domains \
  -H 'content-type: application/json' -d '{"name":"Spiritual"}'
```

Expected: JSON list includes seeds + Spiritual; Spiritual has 3 docs.

- [ ] **Step 6: Commit**

```bash
git add app/api/domains lib/life-log-write.ts
git commit -m "feat: domains CRUD and active domain cookie"
```

---

### Task 5: Documents API + status + forged lock

**Files:**
- Create: `app/api/domains/[id]/documents/[kind]/route.ts`
- Create: `app/api/domains/[id]/documents/[kind]/status/route.ts`
- Create: `lib/active-domain.ts` — resolve domain for user

**Interfaces:**
- Consumes: `assertEditable`, `canTransitionStatus`, `parseDocumentKind`, `appendLifeEvent`
- Produces:
  - GET document by kind
  - PATCH body (blocked if forged)
  - POST status `{ status: "refined" | "forged" }`

- [ ] **Step 1: GET + PATCH document**

- Validate kind via `parseDocumentKind`.
- GET returns full document + unlock snapshot for domain.
- PATCH `{ bodyMarkdown?, title? }`:
  - load doc; `assertEditable(status)`; if not ok → 409
  - update; `document.updated` event
  - return doc

- [ ] **Step 2: POST status**

- Body `{ status: "refined" | "forged" }`
- `canTransitionStatus` or 400
- If forging: set `forgedAt = now()`
- `document.status_changed` event with `{ from, to }`
- return doc

- [ ] **Step 3: Smoke unlock path**

```bash
# patch why with body
curl -b cookies.txt -X PATCH .../documents/why -d '{"bodyMarkdown":"I want vitality"}'
# chart should unlock client-side once GET domains shows non-empty why
curl -b cookies.txt -X POST .../documents/why/status -d '{"status":"forged"}'
# patch why body now → 409
```

- [ ] **Step 4: Commit**

```bash
git add app/api/domains lib/active-domain.ts
git commit -m "feat: document get/update/status with forged lock"
```

---

### Task 6: Decisions API

**Files:**
- Create: `app/api/decisions/route.ts`, `app/api/decisions/[id]/resolve/route.ts`
- Create: `lib/decisions.ts` pure helpers if useful

**Interfaces:**
- Produces:
  - GET list (`?status=pending|all`, optional domainId)
  - POST create proposal `{ documentId, title, rationale?, proposedBodyMarkdown }` — doc must be forged
  - POST resolve `{ action: "approve" | "reject" }`

- [ ] **Step 1: POST create**

- Load document; must be `forged` else 400
- Create Decision with `previousBodyMarkdown = document.bodyMarkdown`, status pending
- `decision.created` event
- return decision

- [ ] **Step 2: POST resolve**

- Pending only
- reject: set rejected + resolvedAt + `decision.rejected`
- approve: transaction — update document body to proposed, keep status forged, decision approved, events `decision.approved` (+ optional `document.updated`)

- [ ] **Step 3: GET list**

- Filter by user via domain ownership

- [ ] **Step 4: Smoke approve path**

Forge why → propose change → approve → GET why shows new body, still forged.

- [ ] **Step 5: Commit**

```bash
git add app/api/decisions lib/decisions.ts
git commit -m "feat: decisions propose and resolve for forged docs"
```

---

### Task 7: Life log + Personnel APIs

**Files:**
- Create: `app/api/log/route.ts`
- Create: `app/api/personnel/route.ts`, `scan/route.ts`, `[id]/route.ts`
- Create: `lib/hermes.ts`, `lib/personnel.ts`

**Interfaces:**
- `getHermesConfig(userId): Promise<{ baseUrl, apiKey }>`
- `hermesFetch(userId, path, init?): Promise<Response>`
- Scan: GET Hermes profiles/agents list — implement against common Hermes gateway paths; try `/v1/agents` or Forge-compatible path; normalize to `{ id, name, description? }[]`. If unreachable, return 502 with clear error.
- Hire POST `{ hermesAgentId, name, roleLabel? }` → AgentHire + `agent.hired`
- DELETE personnel id → dismiss + `agent.dismissed`
- GET log `?domainId=` reverse chron

- [ ] **Step 1: Hermes settings storage helpers in `lib/hermes.ts`**

```ts
import { prisma } from "./prisma.ts";
import { DEFAULT_HERMES_URL } from "./constants.ts";

export async function getHermesConfig(userId: string) {
  const row = await prisma.hermesSettings.findUnique({ where: { userId } });
  return {
    baseUrl: row?.baseUrl || DEFAULT_HERMES_URL,
    apiKey: row?.apiKey || "",
  };
}

export async function upsertHermesConfig(
  userId: string,
  data: { baseUrl?: string; apiKey?: string },
) {
  return prisma.hermesSettings.upsert({
    where: { userId },
    create: {
      userId,
      baseUrl: data.baseUrl ?? DEFAULT_HERMES_URL,
      apiKey: data.apiKey ?? "",
    },
    update: {
      ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
      ...(data.apiKey !== undefined ? { apiKey: data.apiKey } : {}),
    },
  });
}

export async function hermesFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
) {
  const { baseUrl, apiKey } = await getHermesConfig(userId);
  const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  return fetch(url, { ...init, headers });
}
```

- [ ] **Step 2: Log + personnel routes**

Implement as specified. Scan route:

```ts
// Pseudocode structure — implement real normalization
const res = await hermesFetch(user.id, "/v1/models"); // or agents endpoint documented for local Hermes
// Map to agents; if Hermes has no agent list API yet, return [] with warning field
// Prefer matching hermes-forge personnel scan path if discoverable from Forge source
```

Look up Forge `app/api/personnel` scan implementation during coding and mirror the path **only** for the HTTP call shape.

- [ ] **Step 3: Settings hermes GET/PUT**

`app/api/settings/hermes/route.ts` — get config (mask apiKey as `***` if set when reading optional), put updates, optional `?test=1` or POST test that hits hermes health.

- [ ] **Step 4: Smoke log**

After prior actions, GET `/api/log` returns events newest first.

- [ ] **Step 5: Commit**

```bash
git add app/api/log app/api/personnel app/api/settings lib/hermes.ts lib/personnel.ts
git commit -m "feat: life log, personnel scan/hire, hermes settings API"
```

---

### Task 8: Shell chrome (providers, nav, tabs, room switcher, layout)

**Files:**
- Create: all `components/shell/*`, `components/theme/ThemeProvider.tsx`, `components/chatbar/*` (shell only, no network yet)
- Create: `app/(shell)/layout.tsx`
- Create stub pages under `app/(shell)/*/page.tsx` with title headings so nav works

**Interfaces:**
- `ShellProvider`: `{ user, domains, activeDomainId, setActiveDomainId, documents, refresh }`
- `TabProvider`: tabs `{ id, title, route }[]`, activeId, open/close/navigate (sessionStorage key `lq_tabs`)
- `RoomSwitcher`: Dream/Chart/Track/Act; disabled style when `!isRoomUnlocked`
- `NavRail`: links per spec; Domain logo → `/domains`

- [ ] **Step 1: ThemeProvider**

`data-theme="light"|"dark"` on `<html>`, toggle persisted in localStorage `lq_theme`.

- [ ] **Step 2: ShellProvider**

Client provider: fetch `/api/auth/me` and `/api/domains` on mount; `activateDomain(id)` POSTs activate + sets state.

- [ ] **Step 3: TabProvider + TabBar**

Implement open tab on nav click; Ctrl/Cmd+click opens new tab (match Forge behavior lightly).

- [ ] **Step 4: NavRail + RoomSwitcher + TopBar + AppShell**

Layout structure:

```tsx
<div className="app-shell">
  <NavRail />
  <div className="app-shell__main">
    <TopBar /> {/* tabs + domain switcher + room switcher */}
    <div className="app-shell__content">{children}</div>
  </div>
  <ChatbarPanel /> {/* collapsed by default */}
</div>
```

- [ ] **Step 5: Wire `(shell)/layout.tsx`**

Wrap children with ThemeProvider → ShellProvider → TabProvider → ChatbarProvider → AppShell.

- [ ] **Step 6: Stub pages**

Each page exports simple heading + short description (full editors in Task 9).

- [ ] **Step 7: Visual smoke**

`npm run dev` — login, see seed domains, switch domain, open tabs, locked rooms disabled until docs filled (may still need docs API from client — wire unlock from shell documents payload).

- [ ] **Step 8: Commit**

```bash
git add app/\(shell\) components/shell components/theme components/chatbar
git commit -m "feat: app shell with nav, tabs, rooms, domain switcher"
```

---

### Task 9: Document editor + room pages + Documents page

**Files:**
- Create: `components/documents/DocumentEditor.tsx`, `DocumentStatusBadge.tsx`, `ProposeChangeDialog.tsx`
- Modify: `app/(shell)/dream/page.tsx`, `chart/page.tsx`, `track/page.tsx`, `documents/page.tsx`
- Create: `components/shell/RoomLockGate.tsx`

**Interfaces:**
- `DocumentEditor({ kind: DocumentKind })` loads active domain doc, save, status buttons, propose change
- Track page: if body empty, show editor value initialized to `HOW_PLACEHOLDER` locally without auto-save
- `RoomLockGate` redirects or shows lock message if room not unlocked

- [ ] **Step 1: DocumentEditor**

Client component:

- Load GET `/api/domains/${activeDomainId}/documents/${kind}`
- Textarea for markdown
- Save → PATCH
- Mark refined / Forge → POST status
- If forged: textarea readOnly; button opens ProposeChangeDialog → POST `/api/decisions`

Coaching copy:

- Why: “Why pursue growth in this domain?”
- What: “What is your North Star for this domain?”
- How: “Strategy, tactics, and habits.”

- [ ] **Step 2: Room pages**

```tsx
// dream/page.tsx
export default function DreamPage() {
  return (
    <RoomLockGate room="dream">
      <DocumentEditor kind="why" />
    </RoomLockGate>
  );
}
```

Same for chart/what, track/how.

- [ ] **Step 3: Documents page**

List three cards with status badges; click opens editor for kind (inline or navigate to room).

- [ ] **Step 4: Unlock E2E manual**

Empty Chart locked → save Why → Chart enabled → fill What/How → Act unlocks. Opening Track shows placeholder; Act still locked until Save.

- [ ] **Step 5: Commit**

```bash
git add components/documents app/\(shell\)/dream app/\(shell\)/chart app/\(shell\)/track app/\(shell\)/documents
git commit -m "feat: document editor and Why/What/How room surfaces"
```

---

### Task 10: Decisions, Life log, Act, Home stub, Domains manager UI

**Files:**
- Create: `components/decisions/DecisionsInbox.tsx`, `components/log/LifeLogFeed.tsx`, `components/home/HomeComposerStub.tsx`
- Modify: corresponding pages + `act/page.tsx`, `domains/page.tsx`

- [ ] **Step 1: DecisionsInbox**

Fetch GET `/api/decisions?status=pending` and history; Approve/Reject buttons call resolve; refresh.

- [ ] **Step 2: LifeLogFeed**

Fetch `/api/log?domainId=`; toggle all domains; render `createdAt`, `type`, `summary`.

- [ ] **Step 3: Domains manager**

Grid of domain cards; create form; activate; rename; archive.

- [ ] **Step 4: Act page**

`RoomLockGate room="act"`; copy about agents; list active hires from GET `/api/personnel`; link to `/personnel`.

- [ ] **Step 5: HomeComposerStub**

Large textarea + submit → `toast("Journey wiring coming soon")` via sonner; optional progress chips for Why/What/How status.

- [ ] **Step 6: Commit**

```bash
git add components/decisions components/log components/home app/\(shell\)
git commit -m "feat: decisions, life log, domains manager, home stub, act room"
```

---

### Task 11: Personnel scan UI + Settings/Profile

**Files:**
- Create: `components/personnel/PersonnelStudio.tsx`, `components/settings/SettingsContent.tsx`, `components/profile/ProfileContent.tsx`
- Modify: personnel/settings/profile pages

- [ ] **Step 1: PersonnelStudio**

- Button “Scan Hermes agents” → GET `/api/personnel/scan`
- List results with Hire
- List active hires with Dismiss
- If hermes disconnected, show message linking to Settings

- [ ] **Step 2: Settings**

Sections: Appearance (theme toggle), Hermes (baseUrl, apiKey, Save, Test connection), About (LifeQuest 0.1.0).

Test connection: call `/api/hermes/status` (implement thin route using `hermesFetch` to `/health` or `/v1/models`).

- [ ] **Step 3: Profile**

Show name/email from shell user; optional PATCH later — read-only OK for skeleton.

- [ ] **Step 4: Commit**

```bash
git add components/personnel components/settings components/profile app/\(shell\)/personnel app/\(shell\)/settings app/\(shell\)/profile app/api/hermes
git commit -m "feat: personnel scan UI, settings, profile"
```

---

### Task 12: Hermes chat proxy + Chatbar wiring

**Files:**
- Create: `app/api/hermes/chat/route.ts`, `app/api/hermes/status/route.ts`
- Modify: `components/chatbar/ChatbarProvider.tsx`, `ChatbarPanel.tsx`

**Interfaces:**
- Chat API accepts `{ messages: { role, content }[] }` and streams or returns Hermes OpenAI-compatible completion
- Chatbar: message list (session state), input, send, error if disconnected
- Context chip: show active Domain **name** only (no doc injection)

- [ ] **Step 1: Status + chat routes**

```ts
// chat route sketch
const user = await requireUser();
if (!user) return jsonError("Unauthorized", 401);
const body = await request.json();
const res = await hermesFetch(user.id, "/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({
    model: body.model ?? "default",
    messages: body.messages,
    stream: false,
  }),
});
if (!res.ok) return jsonError(await res.text(), 502);
const data = await res.json();
return jsonOk(data);
```

- [ ] **Step 2: ChatbarPanel**

- Collapsed vertical tab “Chat”
- Expanded: messages + input
- Send appends user message, POSTs full messages to `/api/hermes/chat`, appends assistant content
- Loading + error states

- [ ] **Step 3: Manual test with Hermes gateway** (if available)

If gateway down, UI shows connection error — acceptable for DoD item 7 “when gateway up”.

- [ ] **Step 4: Commit**

```bash
git add app/api/hermes components/chatbar
git commit -m "feat: hermes chat proxy and global chatbar"
```

---

### Task 13: Polish, README, DoD walkthrough

**Files:**
- Create: `README.md`
- Modify: empty states, nav labels, any missing life-event hooks from Task 3 sign-up
- Create: `docs/superpowers/specs` already exists — link from README

- [ ] **Step 1: README**

Document: prerequisites (Node 20+, Hermes optional), `npm install`, `npx prisma migrate dev`, `npm run dev`, AUTH_SECRET, Hermes CORS/localhost notes.

- [ ] **Step 2: DoD checklist (manual)**

Walk the spec §12 checklist; fix any gaps found (missing event on hire, unlock bug, etc.).

Checklist:

1. Sign up → four seed Domains  
2. Why save → Chart unlocks  
3. What → Track; How save → Act  
4. Forge → Decision approve  
5. Life log entries visible  
6. Personnel scan/hire/dismiss  
7. Chat when gateway up  
8. Tabs, domain picker, profile, settings  
9. Home stub  

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: README and skeleton polish for DoD"
```

---

## Plan Self-Review

### Spec coverage

| Spec area | Task(s) |
|-----------|---------|
| Domain tenancy + seeds | 2, 3, 4 |
| Why/What/How docs | 1, 5, 9 |
| Rooms Dream/Chart/Track/Act | 8, 9, 10 |
| Unlock non-empty body | 1, 5, 9 |
| Forged + Decisions | 5, 6, 9, 10 |
| Life log events | 4–7, 10 |
| Personnel agent scan | 7, 11 |
| Shell nav/tabs/chatbar | 8, 12 |
| Home stub | 10 |
| Auth multi-user | 3 |
| Hermes connection + chat | 7, 11, 12 |
| Themes/settings/profile | 8, 11 |
| Web only greenfield | Global + Task 1 |
| Out of scope (Electron, plant, etc.) | Not scheduled |

### Placeholder scan

- Personnel scan path: implementer must mirror Forge’s live scan URL during Task 7 (intentional discovery step; not a product TBD).
- No “implement later” feature tasks inside skeleton scope.

### Type consistency

- `DocumentKind`, `DocumentStatus`, `RoomId`, `LifeEventType` defined in Task 1; reused throughout.
- Cookies: `SESSION_COOKIE`, `ACTIVE_DOMAIN_COOKIE` from `lib/constants.ts`.
- API error shape: `{ error: string }`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-lifequest-skeleton.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — execute tasks in this session with executing-plans and checkpoints  

Which approach?
