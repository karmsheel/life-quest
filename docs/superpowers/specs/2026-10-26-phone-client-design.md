# Phone Client — Design Spec

**Date:** 2026-10-26
**Status:** Approved and implemented — merged to `master` in `0335056`. Decisions A and B were confirmed by the operator on 2026-10-27; [Phone client plan](../plans/2026-10-27-phone-client.md) records the build. This document changes no code and adds no tests.
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md) (the vault is the only source of truth), [MCP agent pairing](./2026-10-03-mcp-agent-pairing-design.md) (the door and grant vocabulary this deliberately does *not* reuse), [Receipt images](./2026-10-07-receipt-image-vault-design.md) (the capture path it builds on), [Finance kit](./2026-09-23-domain-databases-finance-kit-prs.md) (the metric it reads)
**Answers:** What is the phone client, what may leave the vault for it, and how does a draft survive the studio being quit?

---

## 1. Purpose

[VISION.md](../../../VISION.md) already describes the phone in three sentences (lines 79–81) and fixes its standing in the product at line 115:

> The phone may queue a draft transaction while the studio is quit; it does not post until the companion confirms in chat.
> The phone may show a metric the operator pinned.
> It does not carry the Finance kit, edit doctrine, talk to Hermes, or open Architecture.

That is a capture surface and one number. It has never had a spec, and no line of it exists in the app. The finance work explicitly deferred it ([2026-09-23…:38](./2026-09-23-domain-databases-finance-kit-prs.md)), and the pairing work listed "A phone client" as out of scope ([2026-10-03…:228](./2026-10-03-mcp-agent-pairing-design.md)).

This spec defines the smallest client that satisfies those sentences and nothing else: a draft queue that survives the studio being closed, one cached metric, and a desktop chat that turns a confirmed draft into a real transaction.

### Success criteria

- The phone installs from the operator's own desktop over their tailnet, with no app store, no account, and no LifeQuest-hosted service.
- A draft typed with the studio quit is still there when the phone next opens, and reaches the vault when the studio is reachable again.
- A draft never becomes a transaction except through a companion chat turn the operator confirmed.
- The phone can display exactly one pinned metric and its age, and no ledger rows, documents, databases, pages, or chat.
- The phone door exposes one metric, a draft queue, and pairing — no vault browser, and no path to the companion's port or token.
- Posting a draft produces one transaction, one capture log entry naming the companion, and a resolved draft the phone can see.
- Two E2E rigs prove the chain end to end and write artifacts under `apps/desktop/e2e/artifacts/`.

---

## 2. Verdict

**A small installable PWA served by the desktop's own phone door, with an offline outbox on the phone and exactly one pinned metric. The companion posts from chat; the phone never posts.**

The load-bearing sentence is VISION:79 — *while the studio is quit*. On Windows, closing the window quits the process (`apps/desktop/electron/main.ts:1153`), and the vault host, the MCP doors, and the companion all die with it. There is no process to receive a phone write. So the draft must live on the phone until the studio returns, and the metric must be cached. Everything below follows from that one fact.

### Locked decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Delivery form | Installable PWA, served by the desktop over the operator's tailnet HTTPS. No app store, no native build in v1 |
| 2 | Vault host | The desktop process. The phone never holds a copy of the vault |
| 3 | Draft queue while quit | Phone-local outbox (IndexedDB), synced on the next reachable moment. No daemon, no listener that outlives the studio |
| 4 | Who posts | The companion, from a chat turn, through a companion-only tool. There is no HTTP route that creates a transaction |
| 5 | Transport | New loopback door on `127.0.0.1:8647`, JSON over HTTP, exposed only by the operator's own tunnel. Not MCP, not a connected agent |
| 6 | Auth | One-time pairing code → `HttpOnly; Secure; SameSite=Strict` device cookie. Token hashes only in the vault |
| 7 | Vault content the phone may see | The draft queue (its own device's items), one pinned metric, the vault's name, and the time |
| 8 | Pinned metric | Exactly one of `net_worth`, `month_spend`, `month_income`, or none. Chosen in Settings → Phone, stored in the vault. Not per device |
| 9 | Metric freshness | Computed on request when reachable; cached with `computedAt` when not. The phone always shows the age |
| 10 | Queue storage | One JSON file per draft under `.lifequest/phone/drafts/<clientId>.json`; resolution rewrites the file. No single queue file to corrupt |
| 11 | Confirmation | A draft appears in the chat's instructions; the tool refuses a resolved draft and posts at most one transaction per draft |
| 12 | Connected agents | `list_phone_drafts`, `post_phone_draft`, `dismiss_phone_draft` are in `COMPANION_ONLY_TOOLS`; a paired agent is refused and never sees them |
| 13 | Lifetime | The door starts with a window and stops when the last window closes, even on macOS where the app stays alive |
| 14 | Version 1 scope | Text drafts only. No receipt photos, no chat, no history, no notifications, no second metric |

### Decision A — delivery form (PWA; confirmed 2026-10-27)

| | PWA (recommended) | Native shell (Capacitor/React Native) |
|---|---|---|
| Distribution | Install from the desktop's URL; no store, no signing | Store or side-load; signing, review, two release trains |
| Offline queue | Service worker shell + IndexedDB | Native SQLite, more reliable under iOS storage pressure |
| Code | One small React app, shipped inside the desktop build | New toolchain and a second product to keep in step |
| Test | Electron `BrowserWindow` + `enableNetworkEmulation` — same rigs, no new dependency | New device/emulator rigs |
| Failure mode | iOS may evict a not-yet-synced local draft under storage pressure | None of that |

The PWA wins because the phone surface is four screens, the desktop already controls distribution, and the alternative is a second product before the first one exists. The threshold for revisiting: if the operator loses a queued draft to iOS storage eviction once, wrap the same PWA in a Capacitor shell with SQLite — do not rewrite the UI in React Native.

### Decision B — where a draft lives while the studio is quit (phone-local; confirmed 2026-10-27)

The alternative is a vault service that outlives the window — a tray app or daemon owning the vault and the phone door. It is rejected:

- It breaks the sentence at VISION:79 in the other direction: the studio would no longer be quit, so the phrase loses its meaning.
- The desktop's model is one window owning one vault. A daemon would put two writers — the app and the daemon — in the same folder with no lock between them, and the companion's file access adds a third.
- It would keep a listener, a companion, or both alive without the operator seeing them.
- It adds no capability the local outbox lacks: the operator's draft is captured either way; only the moment it lands differs.

So: **the phone captures, the studio applies.** The operator should confirm this reading — line 79 can be read as "the draft queues in the vault while the studio is quit", which is impossible on the current architecture without a daemon.

### What the phone may display, against VISION

| VISION clause | Implementation |
|---|---|
| queue a draft transaction while the studio is quit | Local outbox; syncs when the door answers |
| does not post until the companion confirms in chat | No HTTP post path; `post_phone_draft` is companion-only and instructed to require confirmation |
| show a metric the operator pinned | One `GET /api/phone/state` snapshot, chosen in Settings → Phone |
| does not carry the Finance kit | No ledger, accounts, budgets, categories, or drill-down; one number and a label |
| does not edit doctrine | No document routes; the phone has no write path to the vault except the draft queue |
| does not talk to Hermes | The phone never contacts 8642/8643, never holds a companion token, and has no chat |
| does not open Architecture | No template, page, or schedule routes |
| the phone client does not change that (desktop is Windows) | The phone is served by the Windows desktop; no other desktop OS build is implied |

---

## 3. What exists today

### 3.1 There is no phone code

Verified at `80b37cc`: `apps/` contains only `desktop`; no Expo, React Native, Capacitor, or PWA dependency appears in any `package.json`; no branch, plan, or stash implements or designs a phone client. The only traces are the VISION sentences and a handful of "out of scope" lines in older specs ([daily note](./2026-10-14-daily-note-design.md), [finance](./2026-09-23-domain-databases-finance-kit-prs.md), [pairing](./2026-10-03-mcp-agent-pairing-design.md), [Life-Chain](./2026-09-15-life-chain-make-task-design.md)).

### 3.2 The vault has no host while the studio is quit

- `window-all-closed` quits the app on every platform except macOS (`main.ts:1153-1156`), and there is no tray icon.
- `before-quit` stops the companion and the MCP doors before exiting (`main.ts:1157-1162`).
- Both MCP doors bind loopback and serve only while a vault is open (`apps/desktop/electron/mcp-server.ts:35-45`; `pairing-door.ts:1-13`).

So a phone request has nowhere to land once the window is gone. This is the constraint that makes the outbox mandatory rather than a nicety.

### 3.3 VISION:82 is also unimplemented

"Capture may write into the vault while the studio is quit" has no implementation either; it appears only in VISION and in the out-of-scope list of the Life-Chain spec. The phone does not depend on it and does not implement it. If the operator wants true desktop capture-while-quit, that is a separate decision about a background writer, not a prerequisite for this client. `LAWS/COMPANION.md` is untouched by both.

### 3.4 The pieces this builds on

| Piece | What the phone reuses |
|---|---|
| `captureUtterance` (`packages/vault-core/src/capture.ts:319-500`) | The only transaction parser and poster. Returns `posted: false` with a question when amount or account is ambiguous (`types.ts:693-705`) |
| `netWorth()` (`finance-plan.ts:265`) | The FX-aware net-worth report: per-currency books, `usdZarRate`, warnings |
| `.lifequest/` (`paths.ts:9-16`) | The app-state directory: decisions, log, signal chain all use one file per record |
| `appendLog` (`log.ts:32-56`) | The life log entry naming the actor that wrote |
| `COMPANION_ONLY_TOOLS` (`pairing-grant.ts:77-84`) | The existing gate that refuses a connected agent by tool name |
| `buildInstructions` (`companion-client.ts:587`) | The per-turn context the companion already reads |

### 3.5 The word "companion" is already taken

In this product "the companion" is the agent. The phone is **the phone client** — never "the companion app". Code, routes, settings, and laws use `phone` for the client and keep `companion` for the agent.

---

## 4. Architecture

```
phone (PWA)                        Windows desktop
┌──────────────────┐   tailnet   ┌──────────────────────────────────────┐
│ shell (SW cache) │  HTTPS      │ Electron main                         │
│ outbox (IndexedDB)│ ──────────▶ │  phone door 127.0.0.1:8647            │
│ metric cache      │   JSON      │    /phone/*  → dist-phone             │
│ device cookie     │ ◀────────── │    /api/phone/*                       │
└──────────────────┘             │       │                               │
                                 │       ├─ .lifequest/phone/drafts/*.json│
                                 │       ├─ .lifequest/phone/devices.json │
                                 │       └─ .lifequest/phone/settings.json│
                                 │  chat: instructions + strip            │
                                 │  companion (Hermes) ── MCP 8643 ──┐    │
                                 │       post_phone_draft ───────────┘    │
                                 └──────────────────────────────────────┘
```

The phone and the companion never meet. A draft travels phone → vault → chat instructions → companion → `post_phone_draft` → the existing capture path.

### 4.1 The phone door

New module `apps/desktop/electron/phone-door.ts`, shaped like `mcp-server.ts`:

- Binds `127.0.0.1:8647` only. Never a LAN or public address; TLS is the operator's tunnel's job.
- Starts when a vault opens **and** Settings → Phone → "Phone access" is on. Stops on vault close, on last window close, and on quit.
- Rebinds on vault switch; devices belong to the vault, so the new vault starts with none.
- Reports bind errors (`EADDRINUSE`, etc.) to Settings the way the MCP doors do.
- E2E override: `LIFEQUEST_E2E_PHONE_PORT`, following the `setMcpPorts` pattern (`mcp-server.ts:35-45`).
- Serves the built phone app from `dist-phone` (`LIFEQUEST_PHONE_DIR` overrides for rigs) with a path-traversal guard and a fixed MIME map. No framework, no static middleware. `/` redirects to `/phone/`.

"Phone access" and the public address are properties of this machine, so they live in app `userData` (`phone.json`). The pinned metric and the paired devices belong to the vault, so they live in the vault. This split matters when the operator switches vaults: the door rebinds, the phones must pair again.

### 4.2 The API

All responses are JSON with `Cache-Control: no-store` except the static shell. The API version rides in `hello` and `state` as `apiVersion: 1`; the paths are unversioned because the shell and the door ship together.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/phone/hello` | none | `{apiVersion, vaultName, serverTime}` — what the pair screen needs and nothing about the vault's contents. Pairing is decided by `GET /state` answering 401, not by this |
| POST | `/api/phone/pair` | code | Exchange a one-time code for a device cookie |
| GET | `/api/phone/state` | cookie | The whole phone surface: metric snapshot, this device's pending drafts, recent resolutions, limits |
| POST | `/api/phone/drafts` | cookie | Queue a draft (idempotent by `clientId`) |
| POST | `/api/phone/drafts/:clientId/withdraw` | cookie | Withdraw a still-pending draft before the companion posts it |
| POST | `/api/phone/unpair` | cookie | Revoke this device and clear its cookie |

Rules that make the surface a surface rather than an API:

- No route takes a vault path, a file name, a domain, a tool name, or a query.
- No route returns a ledger row, an account, a balance, a document, a database, a page, a task, or a chat message. There is no "read anything" route.
- No route allows CORS. `OPTIONS` answers 405. Mutating requests require `Content-Type: application/json` and an `Origin` matching the configured phone origin (the address in Settings), and the cookie is `SameSite=Strict`.
- Unknown paths are 404. Unknown methods on a known path are 405.
- Errors are `{error: "code", message?: string}` with codes `unauthorized`, `bad_code`, `rate_limited`, `queue_full`, `too_many_devices`, `not_found`, `already_resolved`, `malformed`.

### 4.3 Pairing

1. Settings → Phone → "Pair a phone". Main mints a code: 8 characters from an unambiguous alphabet (40 bits), single-use, 5-minute TTL, held in main memory only. The panel shows the code and a QR of `${publicOrigin}/phone/#pair=${code}`. The QR is scanned by the phone's **camera app**, not by an in-app scanner — no camera permission, no QR library on the phone.
2. The phone POSTs `{code, deviceName}`. Main verifies the code, expiry, and attempt counter, then creates the device row and sets the cookie.
3. The fragment is cleared with `history.replaceState` before the first API call, so the code never appears in a request URL or a server log.
4. Failures: 10 failed attempts in 5 minutes locks pairing for 5 minutes (all requests arrive from 127.0.0.1 through the tunnel, so the limiter is global, not per-IP). Each failure is counted; the code is destroyed after one success.
5. Settings lists devices (name, paired date, last seen) with Forget. Forget deletes the row; the cookie is invalid on the next request. Pending drafts are vault data and stay for the companion.

Cookie: `<deviceId>.<32-byte base64url secret>`, `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=15552000`. The vault stores only `sha256(secret)` in `.lifequest/phone/devices.json` — the same "no secrets here" posture as `connected-agents.json` (`paths.ts:12-13`).

### 4.4 The phone's own store

IndexedDB, four stores:

- `device` — `{id, name, vaultName, pairedAt}` for the UI. The cookie itself is invisible to JS.
- `outbox` — `{clientId, text, capturedAt, captureDate, state}` where state is `local | queued | resolved`, plus `lastError`.
- `snapshot` — the last `PhoneState` body, so the card and the queue render offline.

`capturedAt` is an ISO timestamp with the phone's offset; `captureDate` is the phone's local calendar date at the moment of capture. Both are sent because the server's date may differ by a timezone and a draft must not move to the wrong day.

### 4.5 Sync, offline, and what the phone shows

- **On open, on `visibilitychange`, and every 60 seconds while visible:** `GET /state`. On success, merge: pending drafts the server has are marked `queued`; resolutions clear local items; the snapshot is replaced.
- **Queue:** send local drafts oldest first. A draft that 409s `already_resolved` clears with that status. A draft that fails network keeps `local` and retries later. No background sync — iOS does not honour it, and the app does not pretend otherwise.
- **Offline or studio quit:** the cached shell renders; the metric shows with "as of <time>"; the queue shows local drafts and "Waiting for your studio". The app cannot distinguish "quit" from "offline" and does not claim to.
- **Install:** the first load must be online and over HTTPS (service workers need a secure context). The home screen prompt is shown when `display-mode: browser`; after install, the shell opens offline.
- **Update:** `sw.js` caches the shell under a versioned cache; a new build shows "Reload to update", never a silent swap under an open draft.

### 4.6 The pinned metric

Stored in `.lifequest/phone/settings.json` as `{"schemaVersion":1,"metric":"month_spend"}` (or `net_worth`, `month_income`, `null`). The desktop sets it; the phone only displays it. One pin per vault, not per device — a second phone shows the same number.

| Id | Label | Computation |
|---|---|---|
| `net_worth` | "Net worth" | `netWorth(root, {asOf: todayLocalIso()})`; `zar` when the rate exists, otherwise ZAR and USD as two numbers, warnings surfaced |
| `month_spend` | "Spent in <month>" | Sum of negative amounts dated in the current desktop-local month, `transfer_id` null, grouped by the transaction's **account** currency, converted with the registry's `usdZarRate` when needed |
| `month_income` | "Received in <month>" | The same, positive amounts |
| `null` | "No metric pinned" | The phone says to choose one in Settings → Phone |

Two rules the computation must keep:

- **Never sum across currencies.** Transactions carry no currency of their own; it comes from the account (`finance-kit.ts:41-72`). A ZAR and a USD account summed as one number is a lie.
- **Transfers are not spend.** `transfer_id` non-null is money moving between the operator's own accounts.

When the month holds more than one currency and the registry has no `usdZarRate`, a spend or income total is `value: null` with a warning naming the missing rate. The phone shows "—" and the reason, never a partial sum presented as the total. Net worth already reports both currencies in that case, and its snapshot carries both.

The snapshot is `{id, label, value, currency, secondary, periodLabel, asOf, computedAt, warnings}`. `asOf` is the vault's date, `computedAt` is the moment of reading. No history, no delta, no chart, no drill-down. If the Finance kit or the financial domain is missing, `metricUnavailable` carries the reason and the phone offers nothing else.

### 4.7 A draft's route into the vault

1. The phone stores the draft locally (no vault contact required).
2. When reachable, `POST /api/phone/drafts` writes `.lifequest/phone/drafts/<clientId>.json` with `status: "pending"` and `deviceId`, `deviceName`, `text`, `captureDate`, `capturedAt`, `receivedAt`. A retry with the same `clientId` returns the existing draft (200) or its resolution (409). **No transaction row is created here.**
3. The desktop reads pending drafts for the chat strip and for the companion's instructions. The strip's action **prefills** a confirmation message; it never posts.
4. The companion, instructed and after the operator confirms in chat, calls `post_phone_draft({clientId, text?})`:
   - reads the draft; a resolved draft returns `{alreadyResolved: "posted" | "dismissed"}` and writes nothing;
   - an optional `text` replaces the draft text while pending (the operator's correction, e.g. "R85" for "food");
   - calls `captureUtterance(root, {text, today: draft.captureDate, threadId: "phone:<clientId>", actor: companion, phoneDraftId: clientId})`;
   - on `posted: false` returns the parser's question and leaves the draft pending;
   - on `posted: true` rewrites the draft to `posted` with `rowId`, `receipt`, `resolvedAt`, logs `capture.posted` with `phoneDraftId`, and notifies the renderer.
5. `dismiss_phone_draft({clientId})` rewrites the draft to `dismissed`. It is idempotent.
6. The phone's next `GET /state` sees the resolution, clears the local copy, and shows "Posted" briefly.

The tool is the only posting path, and it is available only to the app's own companion. There is no server-side proof that the operator said yes — the same trust the existing `capture_transaction` already runs on. What is enforced is the shape: one transaction per draft, no draft invented by the model, no posting of a resolved draft, and the actor in the log is the companion, not the phone.

### 4.8 Desktop surfaces

**Settings → Phone** (`SettingsPhone.tsx`, new section id `"phone"` in `settings-views.ts:13-23`, `Smartphone` icon, keywords `phone, mobile, pair, qr, device, metric, tailscale`):

- "Phone access" toggle (off by default), door status and error, the loopback URL.
- Exposure instructions: `tailscale serve --bg http://127.0.0.1:8647`, and an explicit **never `tailscale funnel`** — Funnel publishes to the public internet, which this door is not designed for.
- "Phone address" (https origin, validated; the Pair button is disabled with the reason when it is missing or not https).
- "Pair a phone": code, QR, countdown, cancel.
- Devices: name, paired, last seen, Forget.
- Pinned metric: none / net worth / spend / income, with the explanation that the phone shows one number and cannot open the ledger.

**Chat dock** (`ChatPanel.tsx` + new `PhoneDraftStrip.tsx` above the composer):

- Visible only when pending drafts exist. "2 phone drafts" expands to rows with device name, text, and captured date.
- Row action: prefill the composer with "Post the phone draft: “R85 Pick n Pay” (25 Oct)?" The operator sends; the companion posts after that confirmation.
- After posting, the strip updates via a `phone:changed` event.

**Instructions** (`CompanionInstructionsInput.phoneDrafts`, filled by the renderer from `phone:queue`, emitted by `buildInstructions` only when non-empty, capped at 10 with "and N more"):

```
## Phone drafts
These were queued on the operator's phone. A draft is not a transaction.
1. clientId=…, captured 2026-10-25: "R85 Pick n Pay food"
2. clientId=…, captured 2026-10-26: "coffee"

Do not post a draft unless the operator confirms it in this chat. When they do,
call post_phone_draft with its clientId, and with the corrected text if they gave
one. If they dismiss it, call dismiss_phone_draft. Never invent a clientId or a
draft that is not in this list. After posting, report the receipt and the date.
```

**Tools** (`packages/vault-core/src/phone-tools.ts`, added to `ALL_TOOL_DEFS` and to `COMPANION_ONLY_TOOLS`):

| Tool | Kind | Arguments | Notes |
|---|---|---|---|
| `list_phone_drafts` | read | none | The same list the instructions carry, for "what's queued?" turns |
| `post_phone_draft` | write | `{clientId, text?}` | Wraps `captureUtterance`; resolves the draft only on `posted: true` |
| `dismiss_phone_draft` | write | `{clientId}` | Idempotent; no transaction |

All three are FORBIDDEN for a connected agent (`pairing-grant.ts:218`) and filtered out of its `tools/list` (`pairing-door.ts:584-595`), so a paired agent never sees a phone draft and cannot post one.

### 4.9 The phone app, built and shipped

- Source: `apps/desktop/phone/` — React + TypeScript + Vite, its own `phone/vite.config.ts` with `base: "/phone/"`, `outDir: ../dist-phone`, `emptyOutDir: true`. No router, no state library, no UI kit.
- Shared wire types: `packages/vault-core/src/phone.ts`, browser-safe (types, constants, validators only, no `node:` imports), exported as `@lifequest/vault-core/phone`. The phone app imports that subpath only, so it never pulls the `pure` barrel into a mobile bundle.
- Build: `npm run build:phone` runs before the renderer build; `build` becomes `build:phone && vite build && node ./scripts/bundle-electron.mjs`. `dist-phone` is added to `electron-builder.yml`'s `files` list (currently only `dist/**` and `dist-electron/**`, `electron-builder.yml:6-8`).
- Dev: `scripts/dev.mjs` builds the phone app once before launching Electron and keeps `vite build --watch` running. There is no HMR and no second dev server: a phone reload picks up the new shell once the new service worker activates, which can take a second reload. The alternative — a second Vite origin — buys HMR with the CORS and cookie complexity this design avoids.
- Static assets: `index.html` and `sw.js` no-store; hashed assets immutable. `manifest.webmanifest`, `sw.js`, and icons live in `phone/public/`. The service worker is cache-first for the shell, network-only for `/api/`.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. No CDN, no font fetch, no analytics.
- Size: an estimate, not measured — roughly 60–80 kB gzipped for React plus the app, cached after first load; the desktop main bundle grows by the door (small). The phone app is not in the desktop renderer bundle.

---

## 5. Data

### 5.1 Vault files

```
.lifequest/phone/
  settings.json          {schemaVersion:1, metric:"month_spend"|"month_income"|"net_worth"|null}
  devices.json           {schemaVersion:1, devices:[{id,name,tokenHash,createdAt,lastSeenAt}]}
  drafts/
    <clientId>.json      one file per draft, status pending|posted|dismissed
```

Draft file:

```json
{
  "schemaVersion": 1,
  "clientId": "…uuid…",
  "deviceId": "…uuid…",
  "deviceName": "iPhone",
  "text": "R85 Pick n Pay food",
  "captureDate": "2026-10-25",
  "captureDateClamped": false,
  "capturedAt": "2026-10-25T19:04:00.000Z",
  "receivedAt": "2026-10-26T07:00:00.000Z",
  "status": "pending",
  "rowId": null,
  "receipt": null,
  "resolvedAt": null
}
```

One file per draft is deliberate: `.lifequest/decisions/` and `.lifequest/signal-chain/` use the same shape, and a corrupt file costs one draft rather than the queue. A file that does not parse is skipped with a warning in `state`, never deleted.

### 5.2 Wire types (browser-safe)

```ts
export const PHONE_METRIC_IDS = ["net_worth", "month_spend", "month_income"] as const;
export type PhoneMetricId = (typeof PHONE_METRIC_IDS)[number];
export const PHONE_DRAFT_MAX_TEXT = 500;
export const PHONE_PENDING_CAP = 100;
export const PHONE_RESOLVED_RETENTION_DAYS = 365;
export const PHONE_MAX_DEVICES = 4;

export type PhoneMetricSnapshot = {
  id: PhoneMetricId;
  label: string;
  value: number | null;
  currency: "ZAR" | "USD";
  secondary: { currency: "ZAR" | "USD"; value: number } | null;
  periodLabel: string;
  asOf: string;
  computedAt: string;
  warnings: string[];
};

export type PhoneState = {
  apiVersion: 1;
  vaultName: string;
  serverTime: string;
  device: { id: string; name: string };
  metric: PhoneMetricSnapshot | null;
  metricUnavailable: string | null;
  pending: Array<{ clientId: string; text: string; captureDate: string; capturedAt: string; receivedAt: string }>;
  resolved: Array<{ clientId: string; status: "posted" | "dismissed"; resolvedAt: string; receipt: string | null }>;
  limits: { pending: number; text: number };
};
```

### 5.3 Caps and ids

- `clientId`: UUID v4, generated on the phone. It is the vault file name and the idempotency key.
- Pending cap: 100 per vault. A full queue answers 409 `queue_full`; the phone keeps the draft locally and shows "Waiting for your studio".
- Text: 1–500 characters after trim. Control characters stripped; newlines allowed.
- `captureDate`: must be a real `YYYY-MM-DD` within `[serverToday - 7, serverToday]`; anything else is clamped to `serverToday` and the draft records `captureDateClamped: true`. A phone clock can be wrong; a transaction must not land in 2019.
- Resolved drafts: kept 365 days, pruned on write. The long tail is deliberate: a phone that was offline when its draft posted must find the resolution when it returns, or it will re-send the same `clientId` and risk a second transaction. A year of resolved drafts is a few tens of kilobytes.
- Devices: 4. A fifth pairing answers 409 `too_many_devices` and Settings offers Forget.

---

## 6. Security

| Threat | Control |
|---|---|
| Someone on the tailnet finds the door | Pairing code (40 bits, 5 min, single use, 10 attempts / 5 min), then a device cookie. The shell is not secret; the API is |
| The operator publishes the door to the internet (`tailscale funnel`) | The app never configures it; Settings names `serve` and warns against `funnel`. Even then, an attacker needs a code or a device token, and the cookie is `Secure` |
| CSRF from another site | `SameSite=Strict`, `Origin` check on every mutating request, JSON-only, no CORS, `OPTIONS` 405 |
| Cookie theft from the phone | `HttpOnly` (JS cannot read it), `Secure`, scoped to the origin; token hashes only in the vault; revoke from Settings |
| XSS in the phone app | No user HTML anywhere (`textContent` only), strict CSP, no third-party scripts |
| The phone becomes a second vault browser | Fixed response shapes; no path/domain/tool parameters; no route returns rows or documents. The API cannot express "read the ledger" |
| A connected agent posts a phone draft | Tools are in `COMPANION_ONLY_TOOLS`; `toolAllowed` returns FORBIDDEN and the manifest hides them |
| The phone reaches the companion | No token, no route, no proxy. The door never speaks to 8642/8643 |
| Secrets in the vault | `devices.json` holds hashes; no model key, no companion bearer, no pairing code (memory only) |
| Log leakage | Pairing logs the device name and time, never the code or token; draft text is operator data and remains in the vault, as any capture would |
| A stale door after the window closes | The door stops on `window-all-closed`, including macOS where the app itself stays alive |

---

## 7. Failure catalogue

| Situation | Behaviour |
|---|---|
| Studio quit or phone offline | Shell renders from cache; metric shows with its age; drafts queue locally; "Waiting for your studio". No data loss |
| Phone access off | The door is not listening; the phone sees a network error and its cached shell. Settings says why |
| Door bound by another process | Settings shows `EADDRINUSE`; the rest of the app is unaffected |
| Queue full | 409 `queue_full`; the draft stays local and retries |
| Draft file unreadable | Skipped, warning in `state`; other drafts unaffected; file never deleted |
| Ambiguous draft ("food", "the usual") | `post_phone_draft` returns the parser's question, draft stays pending, companion asks and retries with the correction |
| Operator says no | `dismiss_phone_draft`; no transaction |
| Double post (two turns, one draft) | In-process per-draft mutex; the second answer is `alreadyResolved`, one row exists |
| Phone clock wrong or timezone behind | `captureDate` clamped to the last 7 days; the date is shown in chat |
| Cookie expired / phone re-paired | 401 → "Pair again"; local drafts survive and sync to the new device |
| Vault switched while paired | New vault has no devices → 401; re-pair |
| Service worker serves a stale shell | Versioned cache + "Reload to update"; API is never cached |
| iOS evicts storage | Unsynced local drafts can be lost. Documented; the install prompt and frequent sync reduce the window; the escape hatch is Decision A's Capacitor shell |
| Phone returns after its draft was posted | The resolved file is kept for a year; the re-send gets 409 `already_resolved`, the phone clears it, and no second transaction exists |
| Companion not ready | Drafts sync and the strip shows them; posting waits for a chat turn, which waits for the companion |
| Metric read fails (no kit, no FX rate) | `metricUnavailable` or a warning; the phone shows the reason, never a zero presented as a balance |

---

## 8. Laws

Proposed `LAWS/PHONE.md` (not edited by this document):

```
The phone MUST NOT post a transaction; the companion posts it from chat.

A phone draft MUST survive the studio being quit, and MUST reach the vault when
the studio is reachable again.

The phone door MUST expose no vault content beyond the draft queue and one
pinned metric.

The phone MUST NOT talk to the companion.

A metric shown from the phone's cache MUST carry the time it was read.
```

Each is observable from outside: quit the studio with a draft on the phone, reopen, see it; inspect the door's responses; unplug the tunnel and read the age. They name no implementation.

---

## 9. Out of scope

- Receipt photos, voice notes, or attachments on a draft.
- Chat on the phone, including "ask the companion" buttons that call a model.
- Push notifications and background sync.
- Editing or deleting a posted transaction from the phone.
- A ledger, budgets, accounts, categories, charts, or any second metric.
- Multiple vaults on one phone; per-device metric pins.
- Native iOS/Android builds, app-store distribution, and Capacitor (only the fallback in Decision A).
- Implementing desktop capture-while-quit (VISION:82).
- Configuring TLS, certificates, Tailscale, or any tunnel. The app documents `serve`; it does not run it.
- A hosted relay, a public URL, or any LifeQuest-run service.
- Reading or writing Daily Notes, doctrines, pages, or schedules from the phone.

---

## 10. Testing

Two E2E rigs, both in `npm test`, both writing artifacts. Per repo convention: E2E is the only test; no unit tests.

| Rig | What it proves | Artifact |
|---|---|---|
| `tests/phone-engine-e2e.test.ts` | The queue, the metric, the tool, the gate, and the auth against a real vault on disk | `e2e/artifacts/phone-engine.json` |
| `tests/phone-ui-e2e.test.ts` → `e2e/phone-ui.electron.mjs` | The settings panel, the phone shell offline/online, the strip, and the shipped screens | `e2e/artifacts/phone-ui.json`, `phone-home.png`, `phone-draft.png`, `phone-settings.png`, `phone-chat-strip.png` |

**Engine legs**

1. Pair through the real door: mint a code, POST it, receive a cookie; wrong code 401; 11th attempt 429; expired code 401.
2. POST a draft; assert the file, the `pending` status, the idempotent retry, and that no transaction row exists.
3. A second device sees only its own pending drafts; the desktop sees both.
4. Queue cap, text cap, bad `clientId`, and a `captureDate` 30 days old clamps to today.
5. Withdraw a pending draft; re-POST returns the resolution; a resolved draft cannot be re-posted.
6. Metric: each id against a seeded kit (ZAR + USD accounts, a transfer, a refund), the no-kit case, and the no-FX case.
7. `post_phone_draft` through the real executor: one row, draft resolved with `rowId` and receipt, `capture.posted` carries `phoneDraftId`, actor is the companion.
8. Ambiguous draft: `posted: false`, draft still pending, no row; retry with `text` posts once.
9. Two concurrent posts → one row, one `alreadyResolved`.
10. Connected agent: `toolAllowed("post_phone_draft", grant)` is `FORBIDDEN`; the filtered manifest omits all three tools.
11. Revoke: the cookie 401s; the devices file loses the row.

**UI legs**

The rig launches a window per surface with Electron, as the other rigs do; no Playwright.

1. Settings → Phone: toggle on, door binds, address validation (http is refused with a reason), QR/code shown, countdown, cancel.
2. A second `BrowserWindow` at the door URL, 390×844, loads the phone shell; pair; the home screen shows the pinned metric (from a throwaway vault with the kit installed).
3. Queue a draft; `session.enableNetworkEmulation({offline: true})`; reload; the shell and the draft are still there and the metric shows its age.
4. Back online: the draft syncs; Settings lists the device; the chat strip shows it.
5. Drive the strip's prefill, then the real `post_phone_draft` executor; the row appears in the vault, the strip clears, the phone's next `state` shows "Posted".
6. `capturePage()` each screen from the rig.

Both rigs run under `/root/.local/bin/lifequest-e2e <worktree>` so they test this checkout, not whatever is on 5173.

---

## 11. Assumptions, estimates, and not verified

- **Estimates:** the phone bundle size (60–80 kB gzipped) and the desktop main-bundle growth are estimates, not measurements. The queue and metric read costs are unmeasured.
- **Not verified:** iOS storage eviction under a real installed PWA; service-worker behaviour in Electron's `BrowserWindow` on Windows; `Secure` cookies on `http://127.0.0.1` in the rig (Chromium treats loopback as trustworthy; if a host disagrees, the rig uses `http://localhost`).
- **Assumed:** the operator has Tailscale (or equivalent) and can run `tailscale serve`; there is no built-in tunnel. Without HTTPS the phone works online-only and cannot install.
- **Assumed:** one operator, one vault at a time, one phone in practice (the code allows four devices).
- **Assumed:** the companion is ready when the operator confirms; a draft can wait indefinitely without one.
- **Not covered:** the packaged build serving `dist-phone` from asar (`packaged-smoke.mjs` should gain one leg).
- **Not covered:** the phone's behaviour against a real Hermes gateway; the tools are exercised through the real executor and the manifest, not through a live model turn.

---

## 12. Primary code

**New**

- `apps/desktop/electron/phone-door.ts` — listener, static serving, pairing, API.
- `apps/desktop/electron/phone-service.ts` — vault reads/writes for devices, queue, settings, metric, and the pairing code; the IPC surface lives here or in `vault-service`.
- `apps/desktop/src/components/settings/SettingsPhone.tsx`
- `apps/desktop/src/components/hermes/PhoneDraftStrip.tsx`
- `apps/desktop/phone/` — `index.html`, `src/*`, `public/{manifest.webmanifest,sw.js,icons/*}`, `vite.config.ts`, `tsconfig.json`
- `packages/vault-core/src/phone.ts` — browser-safe types, constants, validators.
- `packages/vault-core/src/phone-queue.ts` — draft files, devices, settings, metric, `postPhoneDraft`.
- `packages/vault-core/src/phone-tools.ts` — the three tool defs and executors.
- `LAWS/PHONE.md` (on implementation, not in this document).
- `apps/desktop/tests/phone-engine-e2e.test.ts`, `apps/desktop/tests/phone-ui-e2e.test.ts`, `apps/desktop/e2e/phone-ui.electron.mjs`.

**Changed**

- `apps/desktop/electron/main.ts` — start/stop the door, IPC, `phone:changed`, stop on last window close.
- `apps/desktop/electron/preload.ts`, `apps/desktop/src/vite-env.d.ts` — `phone:*` bridge.
- `apps/desktop/electron/companion-client.ts` — `phoneDrafts` on the instructions input and the block in `buildInstructions`.
- `apps/desktop/src/components/hermes/ChatPanel.tsx` — the strip, the queue read, the context field.
- `apps/desktop/src/lib/settings-views.ts`, `apps/desktop/src/components/settings/SettingsContent.tsx` — the section.
- `apps/desktop/electron/map-tools.ts` — dispatch for the three tools (the door registers `ALL_TOOL_DEFS` already; the gate is the name set).
- `packages/vault-core/src/pairing-grant.ts` — three names in `COMPANION_ONLY_TOOLS`.
- `packages/vault-core/src/capture.ts` — optional `phoneDraftId` on `captureUtterance`, carried into the log payload.
- `packages/vault-core/src/index.ts` — exports.
- `apps/desktop/package.json`, `apps/desktop/scripts/dev.mjs`, `apps/desktop/electron-builder.yml` — build, watch, ship.
- `apps/desktop/scripts/test.mjs` — nothing; the runner discovers `tests/**/*.test.ts`.

**Not touched**

- `VISION.md`, `PRODUCT.md`, `LAWS/COMPANION.md`, `LAWS/SECRETS.md`.
- The MCP doors, their grants, and the connected-agent roster.
- The vault layout outside `.lifequest/phone/`.
