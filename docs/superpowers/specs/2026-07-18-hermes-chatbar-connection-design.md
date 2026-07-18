# LifeQuest — Hermes Global Chatbar + Connection Flow

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Product:** LifeQuest — manage your life with Hermes agents  
**Reference:** [Hermes Forge](https://github.com/karmsheel/hermes-forge) (adapted port of chatbar shell + connection startup; not a full product fork)

---

## 1. Purpose

Port two Hermes Forge experiences into LifeQuest:

1. **Connection flow at app entry** — splash → connect or set up the local Hermes Agent API server before auth/shell.
2. **Global chatbar UX (adapted)** — Forge-style docked chat shell (residency, side, collapse tab, connection chrome, markdown messages) wired to LifeQuest’s simpler non-streaming chat — without workshop, process, or automation studio coupling.

This supersedes the skeleton’s “settings-only Hermes” entry path while keeping LifeQuest domain/document product scope unchanged.

### Success criteria

- Cold start at `/` shows LifeQuest splash, then connect/setup Hermes.
- After successful connection: signed-in users land in shell (`/home`); others go to sign-in with redirect.
- Shell shows Forge-like global chatbar (open/collapsed, left/right, edge tab, connection status).
- Signed-in user can send/receive Hermes chat when gateway is up.
- Config lives in browser `localStorage` (works before auth); Settings edits the same config.
- No Forge workshop/process/automation/studio chat infrastructure.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Chatbar depth | **Full Forge chatbar UX, adapted** — residency, side swap, collapse tab, connection badge, model switcher, markdown messages, composer polish. Strip workshop/process/automation/studio session wiring. |
| 2 | Entry order | **Forge order:** Hermes connect before auth. `/` is the startup screen. |
| 3 | Config storage | **Client-local** (`localStorage`) as source of truth for base URL, API key, and selected model. |
| 4 | Chat streaming | **Non-streaming** for v1 (keep “Thinking…” busy state). No tool SSE / stop-stream / message queue. |
| 5 | Context to Hermes | **Domain name chip only** (existing LifeQuest behavior). No document injection, no page-context snapshots. |
| 6 | DB `HermesSettings` | Optional fallback only; not required for connection flow. localStorage wins when present. Server chat proxy accepts credentials from the request body (signed-in only). |
| 7 | Public Hermes APIs | discover / test / setup / gateway restart / models are **public** (local gateway + host filesystem; no user data). Chat remains **auth-required**. |
| 8 | Branding | LifeQuest splash copy/logo (not “Hermes Forge”); connection UI still talks about Hermes Agent. |

### Explicitly out of scope

- Workshop ProcessChat, automation session, studio multi-conversation DB  
- Page-context registry / snapshots / agent-view receipts  
- Hermes tool-use UI, streaming tool activity strips, stop/queue  
- Electron desktop packaging  
- n8n connection  
- Changing Domain / document / Decisions product model  

---

## 3. Architecture approach

**Chosen: Port Forge modules + adapt (Approach A)**

| Layer | Choice |
|-------|--------|
| Entry | `app/page.tsx` → `HermesStartupScreen` (Suspense + connecting overlay fallback) |
| Connection state | `HermesConnectionProvider` (client context) |
| Config | `lib/hermes-storage.ts` → `localStorage` key (e.g. `lifequest.hermesConfig`) |
| Discovery / setup | Port Forge `lib/hermes-connection`, `lib/hermes-setup`, shared helpers |
| Chatbar shell | Adapted `ChatbarProvider` + `ChatbarPanel` + `ChatbarCollapsedTab` + residency helpers |
| Chat API | Existing `/api/hermes/chat` with body-supplied baseUrl/apiKey/model after auth |
| Styling | Port relevant Forge `.chatbar-panel*` and shell layout chat classes into LifeQuest CSS/tokens |

**Rejected**

- Thin reimplementation (misses setup/discover fidelity)  
- Literal full ChatbarPanel fork (dead studio/process code)

---

## 4. User flow

```
/  → Splash (LifeQuest, ~3s)
   → If localStorage has config: auto-connect (GatewayConnectingOverlay)
   → Else idle: primary “Connect” + “Setup API server” actions
   → On failure: HermesConnectionErrorModal
        → Enable API server / Restart gateway / retry
   → On success: leave overlay
        → GET /api/auth/me
           → user present → router.push(redirectTo || /home)
           → else → /sign-in?from=…
```

### Middleware

| Path | Access |
|------|--------|
| `/` | Public |
| `/sign-in`, `/sign-up` | Public (existing) |
| `/api/auth/*` | Public (existing) |
| `/api/hermes/discover`, `test`, `setup`, `gateway/restart`, `models` | Public |
| `/api/hermes/chat`, shell pages, other APIs | Require session |

Redirect after auth should honor `from` query (default `/home`).

Settings → Hermes continues to load/save the same localStorage config (and may still call status/test helpers). Prefer not to force a second source of truth in DB for this feature.

---

## 5. Connection system

### Client modules

| Module | Responsibility |
|--------|----------------|
| `lib/hermes-storage.ts` | `loadHermesConfig` / `saveHermesConfig` / `clearHermesConfig` / `defaultHermesConfig` / `connectionStatusFromProbe` |
| `lib/hermes-models.ts` | Model list resolution + default model pick (port from Forge as needed) |
| `lib/hermes-connection.ts` | Probe gateway health/models; discover candidates from `~/.hermes` env |
| `lib/hermes-setup.ts` + `hermes-setup-shared.ts` | Enable API server settings in Hermes env; summary/error copy |
| `components/hermes/HermesConnectionProvider.tsx` | Context: config, status, isConnected, isBusy, autoConnect, setupApiServer, restartGateway, testConnection, saveConnection, disconnect, models |
| `HermesStartupScreen` | Phase machine: splash → connecting → idle → leaving |
| `HermesSplashScreen` | Full-screen brand splash |
| `GatewayConnectingOverlay` | “CONNECTING” scramble animation + exit callback |
| `HermesConnectionErrorModal` | Error + setup/restart actions |
| `HermesConnectionPanel` / dialog (optional) | Reuse in Settings if it reduces duplication |

### Server routes (public unless noted)

| Route | Method | Behavior |
|-------|--------|----------|
| `/api/hermes/discover` | POST | Discover local Hermes env + probe candidates; return suggested baseUrl/apiKey when reachable |
| `/api/hermes/test` | POST | Body `{ baseUrl, apiKey }` → probe; return latency/model/features |
| `/api/hermes/setup` | POST | Enable API server in Hermes config; return needsGatewayRestart + message |
| `/api/hermes/gateway/restart` | POST | Best-effort restart helper (port Forge behavior; degrade gracefully if unsupported) |
| `/api/hermes/models` | POST | Body credentials → list models |
| `/api/hermes/chat` | POST | **Auth required.** Body messages + optional baseUrl/apiKey/model from client config; proxy OpenAI-compatible completions |
| `/api/hermes/status` | GET | Prefer client-driven status via ConnectionProvider; keep/adapt if Settings still uses it |

### Config shape

```ts
type HermesConfig = {
  baseUrl: string; // default http://localhost:8642 or 127.0.0.1:8642
  apiKey: string;
  model?: string;
};
```

### Chat proxy credential resolution

1. If request includes valid `baseUrl` + `apiKey`, use those for the upstream call.  
2. Else fall back to DB `HermesSettings` for the signed-in user (legacy).  
3. Never accept chat without a session cookie.

Do not log API keys.

---

## 6. Global chatbar (adapted)

### Layout / residency

- **Open:** docked panel (`--chatbar-width`, ~22.5rem), full height beside main content.  
- **Collapsed:** panel hidden; edge `ChatbarCollapsedTab` (“Ask Hermes”) restores open.  
- **Side:** right (default) or left of main content; nav rail stays outermost left.  
- Persist residency + side under LifeQuest keys, e.g. `lifequest.chatbar.residency`, `lifequest.chatbar.side`.  
- Shell classes: `app-shell--chat-open|collapsed`, `app-shell--chat-side-left|right` (or Forge-equivalent naming ported consistently).

### UI surfaces

| Surface | Contents |
|---------|----------|
| Header | Hermes brand, connection status, optional model switcher, side-swap, collapse |
| Body | Message list; empty-state copy; error with Settings / reconnect links |
| Messages | User / assistant roles; markdown for assistant (port or thin `ChatMarkdown`) |
| Composer | Text input + Send; disabled while sending or disconnected |
| Context | Active domain **name** chip only |

### Provider API (minimum)

```ts
// residency + side
isOpen, open, collapse, toggle, side, isLeft, swapSide, setSide, setResidency
// chat session (client-only transcript for v1)
messages, sending, error, clearError, clearMessages, sendMessage
// optional: expose connection via useHermesConnection separately
```

### Intentionally not ported into ChatbarPanel

- Process-scoped / automation-scoped session modes  
- Studio conversation list / agent hire gates  
- Page intro banners backed by page-registry snapshots  
- ToolActivityStrip / runtime SSE reducers  
- MessageQueue / stop generation (no stream)

### Shell integration

```
AppProviders (root or shell):
  ThemeProvider
  HermesConnectionProvider
  …auth-aware shell…

Shell layout:
  ShellProvider / TabProvider
  ChatbarProvider
  AppShell → NavRail + main + ChatbarPanel + ChatbarCollapsedTab
```

Replace LifeQuest’s minimal `.chatbar` collapsed strip + open card with Forge-style panel CSS.

---

## 7. Settings integration

- **Appearance** unchanged.  
- **Hermes section** reads/writes `localStorage` config via shared storage helpers (or ConnectionProvider).  
- Test connection uses the same probe path as startup (`/api/hermes/test` or provider `testConnection`).  
- Status badge can reflect `useHermesConnection().status`.  
- Avoid dual-write confusion: if DB upsert remains, treat it as optional sync after login — not required for chat once body credentials work.

---

## 8. Error handling

| Situation | Behavior |
|-----------|----------|
| Gateway not running | Error modal / chat error: start Hermes gateway; offer Setup API server when relevant |
| API key missing / rejected | Clear copy; discover may fill key from `~/.hermes/.env` when present |
| Setup needs restart | Message + Restart gateway action |
| Chat while disconnected | Composer disabled or send fails with not-connected + link to `/` or Settings |
| Network failure on proxy | 502-style message; do not clear transcript |

---

## 9. Testing and definition of done

### Automated

- Unit: residency/side load/save/toggle/normalize  
- Unit: `connectionStatusFromProbe` mapping  
- Unit/route: `/api/hermes/test` rejects missing baseUrl/apiKey  
- Unit: chat route requires auth; uses body credentials when provided  

### Manual DoD

1. Fresh browser: `/` splash → idle connect UI without saved config.  
2. With Hermes gateway + API key discoverable: Connect succeeds → sign-in → `/home`.  
3. Returning user with session + saved config: auto-connect → `/home`.  
4. Chatbar open by default first run; collapse shows edge tab; side swap works and persists.  
5. Send message succeeds when connected; markdown assistant text renders.  
6. Kill gateway: chat shows connection error; Settings/reconnect recoverable.  
7. Unauthenticated: shell routes still redirect to sign-in; public hermes setup routes work.

---

## 10. File plan (implementation guide)

**Add (port/adapt from Forge):**

- `components/hermes/*` (startup, splash, overlay, error modal, provider, status/model pieces as needed)  
- `lib/hermes-storage.ts`, `lib/hermes-connection.ts`, `lib/hermes-setup.ts`, `lib/hermes-setup-shared.ts`, `lib/hermes-models.ts`  
- `lib/chatbar/residency.ts` (+ thin helpers only if used)  
- `app/api/hermes/discover|test|setup|gateway/restart|models` routes  
- `components/chatbar/ChatbarCollapsedTab.tsx` (and any small chrome pieces kept)  
- Optional: `components/ui/ChatMarkdown.tsx`

**Modify:**

- `app/page.tsx` — startup screen instead of redirect to `/home`  
- `middleware.ts` — public paths for `/` and public hermes APIs  
- `app/layout.tsx` or shell layout — mount `HermesConnectionProvider`  
- `components/chatbar/ChatbarProvider.tsx`, `ChatbarPanel.tsx` — Forge UX  
- `components/shell/AppShell.tsx` — panel + collapsed tab + layout classes  
- `components/settings/SettingsContent.tsx` — localStorage-backed Hermes form  
- `app/api/hermes/chat/route.ts` — body credentials  
- `app/globals.css` / tokens — chatbar-panel + shell chat layout  
- Auth pages — honor `from` after sign-in if not already

**Remove / replace:**

- Minimal collapsed-only chat strip UX once panel port is live  
- Reliance on DB-only Hermes config for primary path

---

## 11. Relationship to skeleton spec

The 2026-07-17 skeleton locked “Hermes depth = connection settings + global chat shell (send/receive)” and “web only.” This spec **deepens the shell** to match Forge chatbar chrome and **moves connection to first-run entry**, without expanding product domains (no tools, no pillar injection, no Electron).

Where the two conflict:

| Skeleton | This spec |
|----------|-----------|
| Settings as primary Hermes config UI | Startup flow primary; Settings secondary |
| DB HermesSettings source of truth | localStorage source of truth |
| Simple right chat strip | Dock residency + side + edge tab |

Skeleton domain/document/decisions rules remain authoritative for non-Hermes product scope.
