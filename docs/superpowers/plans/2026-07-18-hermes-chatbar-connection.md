# Hermes Global Chatbar + Connection Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hermes Forge–style connect-before-auth startup flow and an adapted global chatbar (dock residency, side swap, edge tab, connection chrome, markdown messages) to LifeQuest, with localStorage Hermes config.

**Architecture:** Port Forge connection modules (discover/setup/probe, localStorage config, startup screens) and adapted chatbar shell. Strip workshop/process/automation/studio. Chat remains non-streaming; credentials for chat come from client localStorage (body) after auth. Public Hermes setup APIs; shell and chat require session.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/SQLite (legacy HermesSettings fallback only), zod, lucide-react, sonner, Tailwind 4 + existing LifeQuest CSS tokens, Node native test runner (`npm test`)

**Spec:** `docs/superpowers/specs/2026-07-18-hermes-chatbar-connection-design.md`

**Forge reference (local clone):** `/root/projects/hermes-forge` — copy/adapt, rebrand to LifeQuest, do not import Forge packages.

## Global Constraints

- App name in UI: **LifeQuest** (splash/brand), connection copy still says **Hermes Agent**
- Config source of truth: **browser localStorage** (`lifequest.hermesConfig`)
- Chatbar keys: `lifequest.chatbar.residency`, `lifequest.chatbar.side`
- Entry order: `/` connect Hermes → sign-in if needed → shell
- Chat: **non-streaming** send/receive only; domain **name chip** only (no document injection)
- Out of scope: workshop, process/automation sessions, tool SSE, page snapshots, Electron, n8n
- Prefer pure helpers unit-tested first; port Forge logic over re-inventing discover/setup
- Use LifeQuest CSS tokens (`--bg`, `--fg`, `--muted`, `--border`, `--accent`, `--danger`) not Forge token names
- Do not log API keys
- Public: `/`, hermes discover/test/setup/gateway/restart/models; private: chat + shell

---

## File Structure

```
lib/
  hermes-types.ts              # HermesConfig, HermesConnectionStatus, probe types
  hermes-storage.ts            # localStorage load/save/clear + status mapping
  hermes-models.ts             # model resolve/parse/hermesApiBody
  hermes-connection.ts         # parse env/yaml, probe, discover (from Forge)
  hermes-setup.ts              # upsertEnvLines + setupHermesApiServer
  hermes-setup-shared.ts       # error/setup copy (LifeQuest wording)
  hermes-gateway.ts            # local-only gateway restart
  markdown-simple.ts           # safe markdown → HTML
  chatbar/residency.ts         # open/collapsed + left/right persistence
  hermes.ts                    # keep DB helpers; extend for body-cred hermesFetch if useful

app/
  page.tsx                     # HermesStartupScreen (not redirect /home)
  layout.tsx                   # Theme + HermesConnectionProvider + Toaster
  api/hermes/
    discover/route.ts          # POST public
    test/route.ts              # POST public
    setup/route.ts             # POST public
    models/route.ts            # POST public
    gateway/restart/route.ts   # POST public, localhost host only
    chat/route.ts              # POST auth; body baseUrl/apiKey/model
  (shell)/layout.tsx           # ChatbarProvider + shell (existing + updates)

components/
  hermes/
    HermesConnectionProvider.tsx
    HermesStartupScreen.tsx
    HermesSplashScreen.tsx
    GatewayConnectingOverlay.tsx
    HermesConnectionErrorModal.tsx
    HermesModelSwitcher.tsx    # optional thin; can inline in chatbar header
  chatbar/
    ChatbarProvider.tsx        # rewrite residency + chat
    ChatbarPanel.tsx           # Forge-style panel (adapted)
    ChatbarCollapsedTab.tsx
  shell/AppShell.tsx           # panel + tab + side layout classes
  settings/SettingsContent.tsx # localStorage Hermes form
  ui/ChatMarkdown.tsx
  providers/AppProviders.tsx   # optional thin wrapper

middleware.ts                  # public / + public hermes routes
app/globals.css                # replace bottom chat strip with dock panel CSS
components/auth/AuthForm.tsx   # honor ?from= redirect
```

---

### Task 1: Types, localStorage, residency helpers

**Files:**
- Create: `lib/hermes-types.ts`
- Create: `lib/hermes-storage.ts`
- Create: `lib/chatbar/residency.ts`
- Create: `tests/unit/hermes-storage.test.ts`
- Create: `tests/unit/chatbar-residency.test.ts`

**Interfaces:**
- Produces: `HermesConfig`, `HermesConnectionStatus`, `HermesConnectionState`, `HermesConnectionKind`
- Produces: `loadHermesConfig()`, `saveHermesConfig(config)`, `clearHermesConfig()`, `defaultHermesConfig()`, `connectionStatusFromProbe(probe, source)`
- Produces: residency/side load/save/toggle/normalize; storage keys `lifequest.chatbar.residency` | `lifequest.chatbar.side`; default residency `open`, side `right`

- [ ] **Step 1: Write failing residency + storage tests**

```ts
// tests/unit/chatbar-residency.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeChatbarResidency,
  toggleChatbarResidency,
  normalizeChatbarSide,
  toggleChatbarSide,
  loadChatbarResidency,
  saveChatbarResidency,
  DEFAULT_CHATBAR_RESIDENCY,
  DEFAULT_CHATBAR_SIDE,
} from "../../lib/chatbar/residency.ts";

describe("chatbar residency", () => {
  it("normalizes unknown to default open", () => {
    assert.equal(normalizeChatbarResidency("nope"), DEFAULT_CHATBAR_RESIDENCY);
    assert.equal(normalizeChatbarResidency("collapsed"), "collapsed");
  });
  it("toggles open ↔ collapsed", () => {
    assert.equal(toggleChatbarResidency("open"), "collapsed");
    assert.equal(toggleChatbarResidency("collapsed"), "open");
  });
  it("loads/saves via storage mock", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    assert.equal(loadChatbarResidency(storage), DEFAULT_CHATBAR_RESIDENCY);
    saveChatbarResidency("collapsed", storage);
    assert.equal(loadChatbarResidency(storage), "collapsed");
  });
  it("toggles side", () => {
    assert.equal(toggleChatbarSide("right"), "left");
    assert.equal(normalizeChatbarSide("left"), "left");
    assert.equal(normalizeChatbarSide(null), DEFAULT_CHATBAR_SIDE);
  });
});
```

```ts
// tests/unit/hermes-storage.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { connectionStatusFromProbe, defaultHermesConfig } from "../../lib/hermes-storage.ts";

describe("hermes-storage", () => {
  it("defaultHermesConfig has localhost base and empty key", () => {
    const d = defaultHermesConfig();
    assert.ok(d.baseUrl.includes("8642"));
    assert.equal(d.apiKey, "");
  });
  it("maps successful probe to connected status", () => {
    const s = connectionStatusFromProbe(
      { ok: true, baseUrl: "http://127.0.0.1:8642", latencyMs: 12, model: "hermes-agent" },
      "auto",
    );
    assert.equal(s.state, "connected");
    assert.equal(s.latencyMs, 12);
    assert.equal(s.source, "auto");
  });
  it("maps failed probe to error", () => {
    const s = connectionStatusFromProbe(
      { ok: false, baseUrl: "http://127.0.0.1:8642", latencyMs: 3, error: "down", kind: "not_running" },
      "manual",
    );
    assert.equal(s.state, "error");
    assert.equal(s.kind, "not_running");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (modules missing)**

Run: `npm test -- tests/unit/chatbar-residency.test.ts tests/unit/hermes-storage.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: Implement types + storage + residency**

`lib/hermes-types.ts` — copy shapes from Forge `lib/types.ts` Hermes* section:

```ts
export type HermesConnectionKind =
  | "reachable"
  | "auth_failed"
  | "not_running"
  | "timeout"
  | "misconfigured";

export type HermesConnectionState =
  | "idle"
  | "discovering"
  | "testing"
  | "connected"
  | "error";

export type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

export type HermesConnectionStatus = {
  state: HermesConnectionState;
  baseUrl?: string;
  latencyMs?: number;
  model?: string;
  features?: string[];
  error?: string;
  kind?: HermesConnectionKind;
  source?: "auto" | "manual" | "saved";
  checkedAt?: string;
};
```

`lib/hermes-storage.ts` — port Forge `lib/hermes-storage.ts` with key `lifequest.hermesConfig` and default `http://127.0.0.1:8642`.

`lib/chatbar/residency.ts` — port Forge `lib/chatbar/residency.ts` with LifeQuest storage keys:

```ts
export const CHATBAR_RESIDENCY_STORAGE_KEY = "lifequest.chatbar.residency";
export const CHATBAR_SIDE_STORAGE_KEY = "lifequest.chatbar.side";
```

Include full load/save/normalize/toggle for residency and side (see Forge file ~100 lines).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/unit/chatbar-residency.test.ts tests/unit/hermes-storage.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/hermes-types.ts lib/hermes-storage.ts lib/chatbar/residency.ts tests/unit/chatbar-residency.test.ts tests/unit/hermes-storage.test.ts
git commit -m "feat: hermes storage and chatbar residency helpers"
```

---

### Task 2: Connection parse/setup pure helpers + unit tests

**Files:**
- Create: `lib/hermes-connection.ts` (port Forge; keep parse + buildCandidateUrls + probe + discover + readHermesEnvFile)
- Create: `lib/hermes-setup.ts` (upsertEnvLines + setupHermesApiServer)
- Create: `lib/hermes-setup-shared.ts` (LifeQuest-branded strings)
- Create: `lib/hermes-models.ts` (no zod required if simple; optional zod — package already has zod)
- Create: `tests/unit/hermes-setup.test.ts`
- Create: `tests/unit/hermes-env-parse.test.ts`

**Interfaces:**
- Produces: `parseHermesEnv(content)`, `parseHermesConfigYaml(content)`, `upsertEnvLines(content, updates)`, `probeHermesConnection(baseUrl, apiKey)`, `discoverHermes()`, `setupHermesApiServer()`, `connectionErrorExplanation(...)`, `setupSummaryMessage(...)`, `resolveHermesModel`, `hermesApiBody`, `parseHermesModelsResponse`

- [ ] **Step 1: Write failing tests for env parse and upsert**

```ts
// tests/unit/hermes-env-parse.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHermesEnv, buildCandidateUrls } from "../../lib/hermes-connection.ts";

describe("parseHermesEnv", () => {
  it("reads API_SERVER keys", () => {
    const env = parseHermesEnv(`
API_SERVER_ENABLED=true
API_SERVER_KEY=secret
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
`);
    assert.equal(env.apiServerEnabled, true);
    assert.equal(env.apiServerKey, "secret");
    assert.equal(env.apiServerPort, 8642);
  });
});

describe("buildCandidateUrls", () => {
  it("includes host and localhost variants", () => {
    const urls = buildCandidateUrls({ apiServerHost: "127.0.0.1", apiServerPort: 8642 });
    assert.ok(urls.some((u) => u.includes("8642")));
    assert.ok(urls.some((u) => u.includes("localhost")));
  });
});
```

```ts
// tests/unit/hermes-setup.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { upsertEnvLines } from "../../lib/hermes-setup.ts";
import {
  connectionErrorExplanation,
  setupSummaryMessage,
} from "../../lib/hermes-setup-shared.ts";

describe("upsertEnvLines", () => {
  it("updates existing and appends missing keys", () => {
    const { next, changes } = upsertEnvLines("FOO=1\nAPI_SERVER_ENABLED=false\n", {
      API_SERVER_ENABLED: "true",
      API_SERVER_KEY: "k",
    });
    assert.match(next, /API_SERVER_ENABLED=true/);
    assert.match(next, /API_SERVER_KEY=k/);
    assert.ok(changes.length >= 1);
  });
});

describe("connectionErrorExplanation", () => {
  it("mentions LifeQuest or Hermes Agent not Hermes Forge", () => {
    const text = connectionErrorExplanation("misconfigured", false);
    assert.equal(/Hermes Forge/i.test(text), false);
    assert.match(text, /Hermes/i);
  });
});

describe("setupSummaryMessage", () => {
  it("explains restart when not reachable", () => {
    const msg = setupSummaryMessage({ ok: true, gatewayReachable: false });
    assert.match(msg, /restart/i);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/unit/hermes-env-parse.test.ts tests/unit/hermes-setup.test.ts`  
Expected: FAIL

- [ ] **Step 3: Port implementation from Forge**

Copy nearly verbatim from:

- `/root/projects/hermes-forge/lib/hermes-connection.ts` → `lib/hermes-connection.ts`
- `/root/projects/hermes-forge/lib/hermes-setup.ts` → `lib/hermes-setup.ts` (change key prefix `forge-` → `lifequest-` in `generateApiServerKey`)
- `/root/projects/hermes-forge/lib/hermes-setup-shared.ts` → replace "Hermes Forge" with "LifeQuest" in user-facing strings
- `/root/projects/hermes-forge/lib/hermes-models.ts` → `lib/hermes-models.ts` (import `HermesConfig` from `./hermes-types.ts`)

Use LifeQuest import style with `.ts` extensions where the rest of the repo does (`@/lib/....ts`).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`  
Expected: all unit tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/hermes-connection.ts lib/hermes-setup.ts lib/hermes-setup-shared.ts lib/hermes-models.ts tests/unit/hermes-env-parse.test.ts tests/unit/hermes-setup.test.ts
git commit -m "feat: hermes discover, setup, and model helpers"
```

---

### Task 3: Public Hermes API routes + gateway restart

**Files:**
- Create: `lib/hermes-gateway.ts` (port Forge; `FORGE_DESKTOP` → also allow `LIFEQUEST_DESKTOP=1` or same env check)
- Create: `app/api/hermes/discover/route.ts`
- Create: `app/api/hermes/test/route.ts`
- Create: `app/api/hermes/setup/route.ts`
- Create: `app/api/hermes/models/route.ts`
- Create: `app/api/hermes/gateway/restart/route.ts`
- Modify: `middleware.ts` — public paths for these APIs and `/`
- Create: `tests/unit/hermes-gateway-host.test.ts` for `isLocalGatewayControlAllowed`

**Interfaces:**
- Consumes: `discoverHermes`, `probeHermesConnection`, `setupHermesApiServer`, `setupSummaryMessage`, `fetchHermesModels`, `restartHermesGateway`, `isLocalGatewayControlAllowed`
- Produces: public POST endpoints matching Forge response shapes

- [ ] **Step 1: Write host-allow test**

```ts
// tests/unit/hermes-gateway-host.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLocalGatewayControlAllowed } from "../../lib/hermes-gateway.ts";

describe("isLocalGatewayControlAllowed", () => {
  it("allows localhost hosts", () => {
    assert.equal(isLocalGatewayControlAllowed("localhost:3000"), true);
    assert.equal(isLocalGatewayControlAllowed("127.0.0.1:3000"), true);
  });
  it("denies remote hosts", () => {
    assert.equal(isLocalGatewayControlAllowed("example.com"), false);
  });
});
```

- [ ] **Step 2: Implement gateway helper + routes**

Port route bodies from Forge:

```ts
// app/api/hermes/test/route.ts (pattern)
import { NextResponse } from "next/server";
import { probeHermesConnection } from "@/lib/hermes-connection.ts";

export async function POST(request: Request) {
  try {
    const { baseUrl, apiKey } = await request.json();
    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: "Missing baseUrl or apiKey" },
        { status: 400 },
      );
    }
    const probe = await probeHermesConnection(baseUrl, apiKey);
    return NextResponse.json({ probe });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Test failed" },
      { status: 500 },
    );
  }
}
```

Mirror discover/setup/models/gateway/restart from Forge (`/root/projects/hermes-forge/app/api/hermes/...`).

- [ ] **Step 3: Update middleware**

```ts
// middleware.ts — extend public handling
const PUBLIC_PATHS = new Set(["/", "/sign-in", "/sign-up"]);

const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/hermes/discover",
  "/api/hermes/test",
  "/api/hermes/setup",
  "/api/hermes/models",
  "/api/hermes/gateway",
];

// early in middleware, after pathname:
if (PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
  return NextResponse.next();
}
// keep existing session logic; PUBLIC_PATHS includes "/"
```

Important: `/api/hermes/chat` and `/api/hermes/status` stay auth-protected (do not add them to public list).

- [ ] **Step 4: Run unit tests**

Run: `npm test`  
Expected: PASS including host test

- [ ] **Step 5: Commit**

```bash
git add lib/hermes-gateway.ts app/api/hermes middleware.ts tests/unit/hermes-gateway-host.test.ts
git commit -m "feat: public hermes discover, setup, and test APIs"
```

---

### Task 4: Chat proxy accepts client credentials

**Files:**
- Modify: `app/api/hermes/chat/route.ts`
- Modify: `lib/hermes.ts` — add `hermesFetchWithConfig(baseUrl, apiKey, path, init)` used by chat
- Create: `tests/unit/hermes-chat-body.test.ts` — pure helper for credential resolution if extracted

**Interfaces:**
- Consumes: session `requireUser`
- Produces: POST body `{ messages, model?, baseUrl?, apiKey? }`; prefer body credentials over DB

- [ ] **Step 1: Extract pure resolver + test**

```ts
// in lib/hermes.ts or lib/hermes-models.ts
export function resolveChatCredentials(input: {
  bodyBaseUrl?: string;
  bodyApiKey?: string;
  stored?: { baseUrl: string; apiKey: string };
}): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (input.bodyBaseUrl || input.stored?.baseUrl || "").trim().replace(/\/$/, "");
  const apiKey = (input.bodyApiKey ?? input.stored?.apiKey ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}
```

```ts
// tests/unit/hermes-chat-body.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChatCredentials } from "../../lib/hermes.ts";

describe("resolveChatCredentials", () => {
  it("prefers body over stored", () => {
    const r = resolveChatCredentials({
      bodyBaseUrl: "http://127.0.0.1:8642",
      bodyApiKey: "body",
      stored: { baseUrl: "http://x", apiKey: "db" },
    });
    assert.equal(r?.apiKey, "body");
  });
  it("falls back to stored", () => {
    const r = resolveChatCredentials({
      stored: { baseUrl: "http://127.0.0.1:8642/", apiKey: "db" },
    });
    assert.equal(r?.baseUrl, "http://127.0.0.1:8642");
    assert.equal(r?.apiKey, "db");
  });
  it("returns null when incomplete", () => {
    assert.equal(resolveChatCredentials({ bodyBaseUrl: "http://x" }), null);
  });
});
```

- [ ] **Step 2: Run test — FAIL then implement resolver**

- [ ] **Step 3: Update chat route**

After `requireUser` and parsing messages:

```ts
const stored = await getHermesConfig(user.id);
const creds = resolveChatCredentials({
  bodyBaseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
  bodyApiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
  stored,
});
if (!creds) {
  return jsonError(
    "Hermes is not configured. Connect on the startup screen or Settings → Hermes.",
    400,
  );
}
// fetch `${creds.baseUrl}/v1/chat/completions` with Bearer creds.apiKey
// same response handling as today
```

- [ ] **Step 4: `npm test` PASS + commit**

```bash
git add lib/hermes.ts app/api/hermes/chat/route.ts tests/unit/hermes-chat-body.test.ts
git commit -m "feat: hermes chat proxy accepts client credentials"
```

---

### Task 5: HermesConnectionProvider + root providers

**Files:**
- Create: `components/hermes/HermesConnectionProvider.tsx` (port Forge; drop heavy toast spam if desired — use sonner)
- Create: `components/providers/AppProviders.tsx`
- Modify: `app/layout.tsx` — wrap children with AppProviders
- Ensure sonner Toaster mounts (package already has `sonner`)

**Interfaces:**
- Produces context: `config`, `status`, `isConnected`, `isBusy`, `availableModels`, `modelsLoading`, `selectedModel`, `autoConnect`, `setupApiServer`, `restartGateway`, `testConnection`, `saveConnection`, `disconnect`, `refresh`, `setModel`, `refreshModels`
- Consumes: `/api/hermes/*` public routes + localStorage

- [ ] **Step 1: Port provider from Forge**

Copy `/root/projects/hermes-forge/components/hermes/HermesConnectionProvider.tsx` and fix imports to LifeQuest modules. Remove dependency on `@/lib/types` → `@/lib/hermes-types.ts`.

- [ ] **Step 2: AppProviders**

```tsx
"use client";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { HermesConnectionProvider } from "@/components/hermes/HermesConnectionProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <HermesConnectionProvider>
        {children}
        <Toaster richColors position="top-center" />
      </HermesConnectionProvider>
    </ThemeProvider>
  );
}
```

Note: shell layout currently also mounts `ThemeProvider`. Remove the **duplicate** ThemeProvider from `app/(shell)/layout.tsx` when root provides it, or omit Theme from AppProviders and only put HermesConnectionProvider at root — **prefer single ThemeProvider at root** and strip from shell layout.

- [ ] **Step 3: Update `app/layout.tsx`**

```tsx
import { AppProviders } from "@/components/providers/AppProviders";
// ...
<body>
  <AppProviders>{children}</AppProviders>
</body>
```

- [ ] **Step 4: Manual smoke** — `npm run dev`, load any page, no provider errors in console

- [ ] **Step 5: Commit**

```bash
git add components/hermes/HermesConnectionProvider.tsx components/providers/AppProviders.tsx app/layout.tsx app/\(shell\)/layout.tsx
git commit -m "feat: hermes connection provider at app root"
```

---

### Task 6: Startup connection screens + `/` entry

**Files:**
- Create: `components/hermes/HermesSplashScreen.tsx`
- Create: `components/hermes/GatewayConnectingOverlay.tsx`
- Create: `components/hermes/HermesConnectionErrorModal.tsx`
- Create: `components/hermes/HermesStartupScreen.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css` — splash/overlay/error styles using LifeQuest tokens (Forge uses Tailwind utility classes; LifeQuest may need class equivalents or keep Tailwind utilities — Tailwind 4 is already imported)
- Optional: add simple `public/icon.png` or text logo if no image asset — use text/CSS mark “LQ” if no image

**Interfaces:**
- Consumes: `useHermesConnection()` 
- Flow: splash 3s → connecting if saved config else idle → on success leave → `/api/auth/me` → `/home` or `/sign-in?from=`

- [ ] **Step 1: Port UI components from Forge**

Adapt:

- Splash: title **LifeQuest**, version `0.1.0` hardcode or from package
- Startup idle copy: “Connect to Hermes” / LifeQuest runs with local Hermes gateway
- Error modal: LifeQuest strings via `connectionErrorExplanation`
- Overlay: keep CONNECTING scramble animation (port as-is)

Startup exit:

```ts
const redirectTo = searchParams.get("from") || "/home";
// after connect:
const res = await fetch("/api/auth/me", { credentials: "same-origin" });
const data = await res.json().catch(() => ({}));
if (data?.user) router.push(redirectTo);
else router.push(`/sign-in?from=${encodeURIComponent(redirectTo)}`);
```

- [ ] **Step 2: Replace root page**

```tsx
// app/page.tsx
import { Suspense } from "react";
import { GatewayConnectingOverlay } from "@/components/hermes/GatewayConnectingOverlay";
import { HermesStartupScreen } from "@/components/hermes/HermesStartupScreen";

export default function WelcomePage() {
  return (
    <Suspense fallback={<GatewayConnectingOverlay />}>
      <HermesStartupScreen />
    </Suspense>
  );
}
```

- [ ] **Step 3: Manual check**

1. Open `/` logged out → splash → connect UI  
2. Without gateway → error modal with setup actions  
3. With gateway + API key → success → sign-in  

- [ ] **Step 4: Commit**

```bash
git add components/hermes app/page.tsx app/globals.css
git commit -m "feat: hermes startup splash and connection flow"
```

---

### Task 7: Auth redirect honors `from`

**Files:**
- Modify: `components/auth/AuthForm.tsx`
- Modify: `app/sign-in/page.tsx` and `app/sign-up/page.tsx` if they need to pass `from` into form
- Modify: `app/api/auth/local/route.ts` if it hardcodes redirect to `/home` — accept `from` form field or query when safe

**Interfaces:**
- Produces: after successful sign-in/sign-up/local, navigate to safe internal path from `from` (default `/home`)

- [ ] **Step 1: Safe redirect helper**

```ts
// lib/safe-redirect.ts
export function safeInternalPath(raw: string | null | undefined, fallback = "/home"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.startsWith("/sign-in") || raw.startsWith("/sign-up")) return fallback;
  return raw;
}
```

Unit test: rejects `//evil.com`, accepts `/home`, `/dream`.

- [ ] **Step 2: AuthForm reads `window.location.search` or prop `from`**

```ts
const from = safeInternalPath(new URLSearchParams(window.location.search).get("from"));
// on success:
window.location.assign(from);
```

Local form: add hidden input `<input type="hidden" name="from" value={from} />` and local route uses it for 303 Location.

- [ ] **Step 3: Manual: `/sign-in?from=/domains` → after local continue lands on domains**

- [ ] **Step 4: Commit**

```bash
git add lib/safe-redirect.ts components/auth/AuthForm.tsx app/api/auth/local/route.ts app/sign-in/page.tsx app/sign-up/page.tsx tests/unit/safe-redirect.test.ts
git commit -m "feat: auth redirects honor from query after hermes connect"
```

---

### Task 8: Adapted global chatbar (provider + panel + collapsed tab)

**Files:**
- Rewrite: `components/chatbar/ChatbarProvider.tsx`
- Rewrite: `components/chatbar/ChatbarPanel.tsx`
- Create: `components/chatbar/ChatbarCollapsedTab.tsx`
- Create: `components/ui/ChatMarkdown.tsx`
- Create: `lib/markdown-simple.ts` (port Forge)
- Modify: `components/shell/AppShell.tsx`
- Modify: `app/(shell)/layout.tsx` if needed
- Modify: `app/globals.css` — remove bottom strip chat styles; add dock panel + collapsed tab + shell layout side classes

**Interfaces:**
- ChatbarProvider: residency (`isOpen`, `open`, `collapse`, `toggle`), side (`side`, `isLeft`, `swapSide`), messages API (`messages`, `sending`, `error`, `clearError`, `clearMessages`, `sendMessage`)
- `sendMessage` POSTs to `/api/hermes/chat` with `{ messages, ...hermesApiBody(config) }` from `useHermesConnection().config`
- If not connected: set error “Not connected to Hermes” without calling API
- Panel: header with connection badge, side swap, collapse, domain chip from `useShell().activeDomain?.name`, markdown assistant bubbles, composer

- [ ] **Step 1: Port markdown helper + ChatMarkdown**

Copy `lib/markdown-simple.ts` and `components/ui/ChatMarkdown.tsx` from Forge; adjust class names if needed.

- [ ] **Step 2: Rewrite ChatbarProvider**

Keep LifeQuest’s non-streaming message loop; add residency from `lib/chatbar/residency.ts`; hydrate residency/side from localStorage on mount; persist on change.

```ts
// sendMessage sketch
const { config, isConnected } = useHermesConnection(); // cannot call if provider not parent — ensure shell under HermesConnectionProvider
if (!isConnected || !config?.apiKey) {
  setError("Not connected to Hermes. Open Settings or reconnect from the home screen.");
  return;
}
const res = await fetch("/api/hermes/chat", {
  method: "POST",
  credentials: "same-origin",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    messages: payload,
    ...hermesApiBody(config),
  }),
});
```

Problem: `ChatbarProvider` cannot call `useHermesConnection` if it wraps outside — both are under AppProviders, so OK. Alternatively pass credentials only inside `sendMessage` via `loadHermesConfig()` from storage without hook dependency.

Prefer **`loadHermesConfig()` inside sendMessage** to avoid circular provider issues and keep ChatbarProvider independent of connection context for tests.

- [ ] **Step 3: ChatbarPanel adapted UI (not full 1600-line Forge file)**

Implement a focused panel (~200–350 lines) with Forge CSS class names where possible:

- `.chatbar-panel`, `.chatbar-panel--side-right|left`, `.is-collapsed` / `.is-open`
- Header: Hermes, connection pill (use `useHermesConnection` optional), domain chip, swap side button, collapse
- Messages + ChatMarkdown for assistant
- Composer Send
- Empty state when disconnected

Port `ChatbarCollapsedTab` from Forge as-is with LifeQuest classes.

- [ ] **Step 4: AppShell layout**

```tsx
export function AppShell({ children }: { children: ReactNode }) {
  const { isOpen, isLeft, side } = useChatbar();
  const layoutClass = [
    "app-shell",
    isOpen ? "app-shell--chat-open" : "app-shell--chat-collapsed",
    `app-shell--chat-side-${side}`,
  ].join(" ");

  return (
    <div className={layoutClass}>
      <NavRail />
      {isLeft ? <ChatbarPanel /> : null}
      <div className="app-shell__main">
        <TopBar />
        <div className="app-shell__content">{/* loading/error + children */}</div>
      </div>
      {!isLeft ? <ChatbarPanel /> : null}
      <ChatbarCollapsedTab />
    </div>
  );
}
```

Update grid CSS:

- Open: columns `nav | main | chat` (or `nav | chat | main` when left)
- Collapsed: no chat column; edge tab fixed

Port essential rules from Forge `globals.css` sections `.chatbar-panel`, `.chatbar-collapsed-tab`, `.app-shell-layout--chat-*` and map to `.app-shell` naming.

- [ ] **Step 5: Manual DoD for chatbar**

1. Open/collapse persists across refresh  
2. Side swap persists  
3. Connected + signed in → send/receive  
4. Disconnected → clear error + no hang  

- [ ] **Step 6: Commit**

```bash
git add components/chatbar components/ui/ChatMarkdown.tsx lib/markdown-simple.ts components/shell/AppShell.tsx app/globals.css
git commit -m "feat: forge-style global chatbar dock and edge tab"
```

---

### Task 9: Settings + status use localStorage config

**Files:**
- Modify: `components/settings/SettingsContent.tsx`
- Optionally keep `/api/settings/hermes` for DB sync — **prefer Settings read/write localStorage + test via `/api/hermes/test`**
- Wire model list optional in Settings or chat header via `useHermesConnection`

- [ ] **Step 1: Settings Hermes section**

On mount: `const saved = loadHermesConfig() ?? defaultHermesConfig()`  
Save: `saveHermesConfig` + optional `saveConnection` from provider  
Test: `testConnection` or POST `/api/hermes/test`  

Show connection status from provider if available.

Remove required dependency on GET `/api/settings/hermes` for primary path (can leave route for legacy).

- [ ] **Step 2: Manual: change URL in Settings → Test → chat uses new config**

- [ ] **Step 3: Commit**

```bash
git add components/settings/SettingsContent.tsx
git commit -m "feat: settings hermes form uses localStorage config"
```

---

### Task 10: End-to-end verification + polish

**Files:**
- Fix any CSS/layout regressions
- Ensure middleware does not block public hermes routes
- Ensure signed-out users hitting `/home` still redirect to sign-in
- Ensure `/` never requires session

- [ ] **Step 1: Run full unit suite**

Run: `npm test`  
Expected: all PASS

- [ ] **Step 2: Run production build**

Run: `npm run build`  
Expected: compile success

- [ ] **Step 3: Manual checklist from spec §9**

1. Fresh browser: `/` splash → idle connect  
2. Connect with live gateway → sign-in → home  
3. Returning session + saved config: auto-connect → home  
4. Chatbar residency + side persist  
5. Send chat succeeds; markdown renders  
6. Kill gateway: chat error recoverable  
7. Shell routes still auth-gated  

- [ ] **Step 4: Final commit if polish needed**

```bash
git add -A
git commit -m "fix: polish hermes connection flow and chatbar integration"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Connect-before-auth at `/` | 6, 3 (middleware) |
| Splash + connecting overlay + error modal | 6 |
| Setup API server / restart gateway | 2, 3, 5, 6 |
| localStorage config | 1, 5, 9 |
| Public discover/test/setup/models/restart | 3 |
| Chat auth + body credentials | 4, 8 |
| Chatbar residency/side/edge tab | 1, 8 |
| Markdown messages | 8 |
| Domain name chip only | 8 |
| Settings secondary | 9 |
| No workshop/studio/tools | enforced by adapted panel task |
| Auth `from` redirect | 7 |
| DoD tests/manual | 1–4 unit, 10 manual |

No TBD placeholders. Types consistent: `HermesConfig` / `HermesConnectionStatus` from Task 1 used everywhere.

---

## Execution notes for agents

- Prefer **copy-from-Forge then rebrand** for connection libs (large pure files already proven).
- Prefer **slim rewrite** for ChatbarPanel (do not paste 1668-line Forge panel).
- LifeQuest path aliases: follow existing `@/lib/foo.ts` import style.
- If `useHermesConnection` is used outside provider (e.g. tests), guard or use storage helpers.
- When dual ThemeProviders conflict, keep **one** at root only.
