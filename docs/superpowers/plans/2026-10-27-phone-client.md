# Phone Client Implementation Plan

**Date:** 2026-10-27
**Spec:** [Phone client design](../specs/2026-10-26-phone-client-design.md). Decisions A and B were confirmed by the operator on 2026-10-27. When this plan and the spec disagree on behavior, follow the spec.
**Status:** Done. All seven tasks landed on `feat/phone-client` and merged to `master` in `0335056`; `phone-engine` and `phone-ui` are green (see `apps/desktop/e2e/artifacts/`).

**Goal:** Ship the phone client VISION describes: a draft transaction queued on the phone while the studio is quit, posted only by the companion after a chat confirmation, and one pinned metric shown with its age.

**Architecture:** A fourth loopback door (`127.0.0.1:8647`) serves an installable PWA and six JSON routes over the operator's own tailnet HTTPS. Drafts live in one JSON file each under `.lifequest/phone/`, devices as token hashes, and the pinned metric as one vault setting. The phone holds an IndexedDB outbox and the last state snapshot. The companion learns about drafts from its per-turn instructions and posts them through `post_phone_draft`, a `COMPANION_ONLY_TOOLS` member that wraps the existing `captureUtterance`; the phone has no route that creates a transaction and never speaks to Hermes.

**Tech Stack:** TypeScript, `packages/vault-core`, Electron main + preload, `node:http`, React 19 + Vite (phone app), `qrcode` (new, dev-only, bundled), Electron `BrowserWindow` + `session.enableNetworkEmulation` for the rigs, `node:test` as the rig wrapper.

## Global Constraints

- **E2E is the only test.** Do not add a unit test, a `node:test` file that calls modules directly, or a new test framework. The two rigs below are the entire proof; they drive real modules against a real vault and the real phone shell, and each writes an artifact.
- **The engine rig is a rig, not a unit test.** It bundles the modules under test with the same esbuild call `dev.mjs` uses for main, drives them through their real entry points against a real temporary vault, and records named scenarios in `e2e/artifacts/phone-engine.json`. The receipt rig (`e2e/receipt-attach.electron.mjs`) is the template.
- **The UI rig drives real windows**, as the other rigs do: the harness pages for Settings and the chat strip, and a real `BrowserWindow` at the phone door for the PWA. No Playwright, no jsdom.
- **Artifacts are evidence.** `apps/desktop/e2e/artifacts/` is gitignored; never `git add` an artifact, and never delete one before the handover.
- **Work in the worktree, not the primary checkout.** For implementation, create `feat/phone-client` in a new worktree from the tip of this branch (or from `master` if the docs branch is merged first). Run `npm ci` once inside that worktree; do not symlink the primary checkout's `node_modules`. Do not run `npm ci` in `.worktrees/docs/phone-client-spec`.
- **One bench.** Never start a second `npm run dev` or bind 5173 by hand. Full proof runs through `/root/.local/bin/lifequest-e2e <worktree>`; it holds the lock, puts the checkout on 5173, runs the suite, restores the previous bench, and the rigs' screenshots come from their own `capturePage`. A bare `npm test` can test another branch's code.
- **Restart before checking.** A change to the phone door, main, or preload only takes effect after `npm run dev` rebundles and relaunches. `lifequest-e2e` starts its own server; a manual look needs the bench restarted, and the branch is only put on the bench by `lifequest-dev` when the operator asks.
- **A skipped rig is evidence of nothing.** The UI rig skips when no dev server is up; count only a run whose `phone-engine.json` and `phone-ui.json` exist and whose PNGs show the shipped screens.
- **New dependency:** `qrcode` plus `@types/qrcode`, dev-only, added to `@lifequest/desktop`. It is bundled into main; the phone app gets no new dependency. Nothing else is added.
- **Commit style:** stage explicit paths, never `git add -A`; two `-m` flags on every commit. Do not merge or push; the operator does that after their own review.
- **Docs:** do not edit `VISION.md`, `PRODUCT.md`, or `LAWS/COMPANION.md`. `LAWS/PHONE.md` is added in Task 6, with the text the spec proposes. The README's Design table gains the plan row in Task 6.
- **Handover:** when Task 7 passes, declare READY FOR TESTING in the repo's shape and stop. Do not move the bench or push.

---

### Task 1: Wire contract and vault engine

**Files:**
- Create: `packages/vault-core/src/phone.ts`
- Create: `packages/vault-core/src/phone-queue.ts`
- Create: `packages/vault-core/src/phone-metric.ts`
- Modify: `packages/vault-core/src/index.ts`
- Modify: `packages/vault-core/package.json` (add `"./phone"` to `exports`)
- Create: `apps/desktop/e2e/phone-engine.electron.mjs`
- Create: `apps/desktop/tests/phone-engine-e2e.test.ts`

**Interfaces:**
- `phone.ts` is browser-safe: types, constants, and pure validators only, no `node:` import. It carries `PHONE_METRIC_IDS`, `PhoneMetricId`, `PhoneDraftStatus`, `PhoneDraft`, `PhoneSettings`, `PhoneDevice`, `PhoneMetricSnapshot`, `PhoneState`, `PHONE_DRAFT_MAX_TEXT = 500`, `PHONE_PENDING_CAP = 100`, `PHONE_MAX_DEVICES = 4`, `PHONE_RESOLVED_RETENTION_DAYS = 365`, `PHONE_CAPTURE_CLAMP_DAYS = 7`, `PHONE_COOKIE_NAME = "lq_phone"`, `PHONE_PORT = 8647`, `PHONE_HOST = "127.0.0.1"`, `isPhoneMetricId`, `normalizeDraftText`, `isClientId`, `isIsoDate`, `clampCaptureDate(phoneDate, serverToday)`.
- `phone-queue.ts` produces `phonePaths(root)` (`{dir, settingsJson, devicesJson, draftsDir, draftJson(clientId)}`), `readPhoneSettings`, `writePhoneMetric`, `readPhoneDevices`, `addPhoneDevice({name, tokenHash})`, `removePhoneDevice(id)`, `touchPhoneDevice(id)`, `readPhoneDraft(root, clientId)`, `listPhoneDrafts(root, {deviceId?, status?})`, `queuePhoneDraft(root, input, receivedAt)`, `withdrawPhoneDraft(root, clientId, deviceId)`, `resolvePhoneDraft(root, clientId, {status, rowId, receipt, resolvedAt})`, `pruneResolvedPhoneDrafts(root, now)`, `pendingPhoneDraftCount(root)`.
- `queuePhoneDraft` input: `{clientId, deviceId, deviceName, text, captureDate, capturedAt}`. It validates, clamps the date, writes `drafts/<clientId>.json` atomically with `status: "pending"`, and returns `{draft, created}`; a repeated `clientId` returns the existing draft with `created: false`, and a resolved one returns its status so the route can answer 409.
- `phone-metric.ts` produces `phoneMetric(root, id, now): Promise<Result<PhoneMetricSnapshot | null>>`. `net_worth` calls `netWorth(root, {asOf: todayLocalIso(now)})`; `month_spend` and `month_income` sum transactions dated in the current desktop-local month with `transfer_id == null`, grouped by the transaction's **account** currency; the registry's `homeCurrency` and `usdZarRate` decide the single number. Mixed currencies with no rate return `value: null` and a warning. A missing kit or financial domain returns an error the caller turns into `PhoneState.metricUnavailable`.
- The engine rig's `MODULES` entry includes `packages/vault-core/src/index.ts`; the wrapper is a standalone `describe` that runs the driver with the Electron binary and asserts the report's scenario names.

- [ ] **Step 1: Write the failing engine rig and its wrapper**

Create `apps/desktop/e2e/phone-engine.electron.mjs` with the standard driver shape from the receipt rig: its own `userData` under `artifacts/userdata/phone-engine`, `nativeTheme.themeSource = "dark"`, a fresh `vault-<pid>-<base36>` path per run, `loadModules()` with the esbuild call from Global Constraints, a `check`/`failures` pair, and `app.exit(report.pass ? 0 : 1)`.

Create the temp vault with `createVault`, install the Finance kit with `installFinanceKit(root, USER_ACTOR)`, and record these scenarios:

- `queue writes one pending file and no transaction`: `queuePhoneDraft` writes `.lifequest/phone/drafts/<clientId>.json`, the file's `status` is `pending`, and `listRows(root, "financial", "finance:transactions")` is empty.
- `queue is idempotent by clientId`: the second call returns the same `clientId`, `created: false`, and the drafts directory still holds one file.
- `queue refuses bad input`: empty text, 501 characters, and a non-UUID `clientId` each return `ok: false`, and no file is written.
- `queue cap is 100`: the 101st pending draft returns `ok: false` with `queue is full`; the first 100 are untouched.
- `captureDate clamps to a week`: a draft dated 30 days ago comes back with `captureDate` equal to the server today and `captureDateClamped: true`.
- `corrupt draft is skipped, not deleted`: write `{not json` at `drafts/00000000-0000-4000-8000-000000000000.json`, then `listPhoneDrafts` returns `skipped: 1` and the file is still on disk.
- `withdraw is pending-only`: withdrawing a pending draft makes its status `dismissed`; withdrawing it again is a no-op; a posted draft cannot be withdrawn.
- `devices cap and hashes`: four devices are added; the fifth is refused with `too_many_devices`; `devices.json` contains `tokenHash` and does not contain the plaintext token; removing one frees a slot.
- `metric month_spend and month_income`: seed ZAR and USD accounts, a ZAR expense, a ZAR income, a USD expense, and a transfer; spend counts the ZAR and USD expenses at the registry rate (or `null` + warning with no rate), income counts only the income, and the transfer is counted by neither.
- `metric net_worth`: matches `netWorth(root, {asOf: today})`'s `zar` when a rate exists, and reports `secondary` USD when it does not.
- `metric with no kit`: a vault without the kit returns `metricUnavailable` and no value.
- `settings default and write`: a fresh vault reads `metric: null`; `writePhoneMetric(root, "month_spend")` reads back the id; an unknown id is refused.

Then create `apps/desktop/tests/phone-engine-e2e.test.ts` with a `describe("phone engine", ...)` that runs `execFile(electron, ["e2e/phone-engine.electron.mjs"], {cwd: desktopRoot, timeout: 120_000})`, asserts exit 0 and the report, and asserts every scenario name above is present with `pass: true`. It needs no dev server.

- [ ] **Step 2: Run the rig and confirm it fails**

From `apps/desktop`: `node_modules/.bin/electron e2e/phone-engine.electron.mjs`

Expected: FAIL — the modules do not exist, so the bundle cannot resolve them and the driver exits 1 with the failure named.

- [ ] **Step 3: Implement the wire contract, queue, and metric**

Write `phone.ts` with the constants and pure validators. `normalizeDraftText` trims, strips control characters other than `\n`, and returns null outside 1–500. `isClientId` accepts UUID v4 only (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`). `clampCaptureDate` keeps a date within `[today - 7, today]` and reports `clamped`.

Write `phone-queue.ts` on `atomicWriteFile`, one file per draft, with the resolutions and prunes in the spec. Resolutions rewrite the same file; pruning deletes only resolved drafts older than 365 days. An unreadable draft is counted in `skipped` and left alone. The queue cap counts only `pending`. `addPhoneDevice` refuses at four and stores only the hash it is handed.

Write `phone-metric.ts` per the interface, reusing `netWorth`, `listRows`, `readRegistry`, and `todayLocalIso`; money is rounded to two decimals, and the snapshot's `label` and `periodLabel` are human strings (`"Spent in October 2026"`, `"Net worth"`).

Export the new modules from `index.ts`, and add `"./phone": "./src/phone.ts"` to `packages/vault-core/package.json`'s `exports`.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

From `apps/desktop`: `node_modules/.bin/electron e2e/phone-engine.electron.mjs`

Expected: `phone engine: PASS` on every scenario, with `e2e/artifacts/phone-engine.json` written.

Then from the repo root: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- packages/vault-core/src/phone.ts packages/vault-core/src/phone-queue.ts packages/vault-core/src/phone-metric.ts packages/vault-core/src/index.ts packages/vault-core/package.json apps/desktop/e2e/phone-engine.electron.mjs apps/desktop/tests/phone-engine-e2e.test.ts
git commit -m "feat(vault-core): the phone draft queue, devices, and pinned metric" -m "One JSON file per draft under .lifequest/phone, token hashes only, a 500-character draft, a 100-item cap, a 7-day date clamp, and the FX-aware metric the phone may show."
```

---

### Task 2: Companion tools, the capture log, and the gate

**Files:**
- Create: `packages/vault-core/src/phone-tools.ts`
- Modify: `packages/vault-core/src/capture.ts` (`captureUtterance` input and log payload)
- Modify: `packages/vault-core/src/pairing-grant.ts` (`COMPANION_ONLY_TOOLS`)
- Modify: `packages/vault-core/src/index.ts` (`PHONE_TOOL_DEFS`, `executePhoneTool`)
- Modify: `apps/desktop/electron/map-tools.ts` (dispatch)
- Modify: `apps/desktop/e2e/phone-engine.electron.mjs`
- Modify: `apps/desktop/tests/phone-engine-e2e.test.ts`

**Interfaces:**
- `PHONE_TOOL_DEFS` has exactly three tools:
  - `list_phone_drafts` — no arguments; returns `{drafts: [{clientId, text, captureDate, capturedAt, deviceName}], count}`.
  - `post_phone_draft` — `{clientId: string, text?: string}`; returns the capture result plus `resolved` or `alreadyResolved`.
  - `dismiss_phone_draft` — `{clientId: string}`; returns `{clientId, status: "dismissed"}` or `{clientId, alreadyResolved}`.
- `executePhoneTool(root, actor, name, args)`.
- `captureUtterance` gains `phoneDraftId?: string | null`; when present, the `capture.posted` log payload carries it and nothing else changes. `correctCapture` does not take it.
- The three names join `COMPANION_ONLY_TOOLS`, so `toolAllowed` answers `FORBIDDEN` for a connected agent and the door's filtered manifest omits them.
- `map-tools.ts` dispatches `PHONE_TOOL_DEFS` before the capture branch, with the same `actor` it already passes.

- [ ] **Step 1: Extend the engine rig with the tool scenarios**

Add these scenarios to `phone-engine.electron.mjs`:

- `post posts one row and resolves the draft`: queue a draft saying `R85 Pick n Pay food`, call `executePhoneTool(root, COMPANION_ACTOR, "post_phone_draft", {clientId})`; the result has `posted: true`, the transactions table has one row for `-85`, the draft file has `status: "posted"`, `rowId`, `receipt`, and the last log line is `capture.posted` with `payload.phoneDraftId === clientId` and `actor.name === "Hermes"`.
- `ambiguous draft stays pending`: queue `food`, post it; the result has `posted: false` and `ask: "What amount?"`; the draft is still `pending` and no row exists; post again with `{clientId, text: "R85 Pick n Pay food"}`; one row exists and the draft is `posted`.
- `posting a resolved draft posts nothing`: post the resolved draft again; the answer is `{alreadyResolved: "posted"}` and the row count is unchanged.
- `dismiss writes no row`: a pending draft dismissed returns `status: "dismissed"`, and no row exists.
- `unknown clientId is NOT_FOUND`: `post_phone_draft` with a random UUID returns `{error: {code: "NOT_FOUND"}}` and writes nothing.
- `connected agents are refused`: `toolAllowed("post_phone_draft", grant)` is `FORBIDDEN`, and the filtered set from the same predicate the door uses omits all three names.
- `double post is one row`: fire two `post_phone_draft` calls for the same pending draft without awaiting the first; exactly one row exists and one answer is `alreadyResolved`.

- [ ] **Step 2: Run the rig and confirm the new scenarios fail**

From `apps/desktop`: `node_modules/.bin/electron e2e/phone-engine.electron.mjs`

Expected: FAIL on the tool scenarios, because `post_phone_draft` is unknown to the dispatcher and `captureUtterance` does not carry the id.

- [ ] **Step 3: Implement the tools and the log field**

`postPhoneDraft` reads the draft, refuses a resolved one, applies an optional `text` before capturing (so a failed attempt keeps the operator's correction), and calls:

```ts
captureUtterance(root, {
  text,
  today: draft.captureDate,
  threadId: `phone:${draft.clientId}`,
  actor,
  phoneDraftId: draft.clientId,
});
```

On `posted: true` it resolves the draft with `rowId` and `receipt`; on `posted: false` it leaves it pending and returns the parser's `ask`. A module-level `Map<clientId, Promise<...>>` serialises posts per draft; a second concurrent call awaits the first and then reports its outcome. `dismissPhoneDraft` resolves only a pending draft and is idempotent. `listPhoneDrafts` returns pending drafts only.

Tool descriptions say plainly that a draft is not a transaction, that the companion must have the operator's confirmation in this chat, and that `text` is the operator's correction. Register the defs in `ALL_TOOL_DEFS` and add the names to `COMPANION_ONLY_TOOLS`.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

From `apps/desktop`: `node_modules/.bin/electron e2e/phone-engine.electron.mjs`

Expected: PASS on all Task 1 and Task 2 scenarios.

From the repo root: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- packages/vault-core/src/phone-tools.ts packages/vault-core/src/capture.ts packages/vault-core/src/pairing-grant.ts packages/vault-core/src/index.ts apps/desktop/electron/map-tools.ts apps/desktop/e2e/phone-engine.electron.mjs apps/desktop/tests/phone-engine-e2e.test.ts
git commit -m "feat(vault-core): let the companion post a phone draft" -m "Three companion-only tools wrap the one capture path: list, post with an optional correction, dismiss. A connected agent is refused and never sees them; the log names the companion."
```

---

### Task 3: The phone door

**Files:**
- Create: `apps/desktop/electron/phone-pairing.ts`
- Create: `apps/desktop/electron/phone-door.ts`
- Modify: `apps/desktop/e2e/phone-engine.electron.mjs`
- Modify: `apps/desktop/tests/phone-engine-e2e.test.ts`

**Interfaces:**
- `phone-pairing.ts` produces `createPairingCodes({ttlMs})` with `mint(): {code, expiresAt}`, `verify(code): "ok" | "bad" | "expired" | "locked"`, and `cancel()`; the code is 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, one active code, 10 failed attempts in 5 minutes locks minting for 5 minutes. It also produces `newDeviceToken(deviceId): {cookieValue, tokenHash}` and `tokenHash(cookieValue)`; the cookie is `<deviceId>.<32-byte base64url secret>`, and the hash is SHA-256 hex compared with `timingSafeEqual`.
- `phone-door.ts` produces `createPhoneDoor(options): Promise<Result<PhoneDoor>>` where options are `{root, vaultName, staticDir, port?, host?, publicOrigin, pairingTtlMs?, onQueueChanged?}` and `PhoneDoor` is `{port, url, mintPairingCode, cancelPairingCode, revokeDevice, close}`.
- The API is exactly the spec's six routes, on `/api/phone`, and the PWA on `/phone/` with `/` redirecting there.
- Auth: the cookie is `lq_phone`; a missing, malformed, unknown, or revoked device is 401. Mutating requests require `Content-Type: application/json` and `Origin === publicOrigin`; failures are 403 or 415. `OPTIONS` is 405, unknown paths 404. API responses are `Cache-Control: no-store`; the shell carries the spec's CSP.

- [ ] **Step 1: Extend the engine rig with the door scenarios**

The rig reserves a free port first (`net.createServer().listen(0)`, read the port, close), then starts the door on that port with `publicOrigin: "http://127.0.0.1:<port>"` — the origin is fixed at creation because it is what the CSRF check compares against. The door gets a temp `staticDir` holding `index.html`, `sw.js`, and `manifest.webmanifest`. Record:

- `static shell is served`: `GET /phone/` is 200 `text/html` with the CSP header and `Cache-Control: no-store`; `GET /` is a 302 to `/phone/`; `GET /phone/%2e%2e/secret` through a raw `http.request` (not `fetch`, which normalises the path) is 404.
- `pairing sets one device`: mint a code, `POST /api/phone/pair` with `{code, deviceName: "iPhone"}`, assert 200, a `Set-Cookie` whose value starts with the device id and has `HttpOnly`, `Secure`, `SameSite=Strict`; `.lifequest/phone/devices.json` holds one row with a 64-character `tokenHash` and no plaintext secret.
- `pairing rejects bad codes`: a wrong code is 401; a code minted with `pairingTtlMs: 10` is 401 after 50 ms; the same code used twice is 401 the second time; eleven wrong attempts return 429 on the eleventh.
- `auth is required`: `GET /api/phone/state` with no cookie is 401; a tampered secret is 401; a revoked device's cookie is 401.
- `drafts arrive without a transaction`: `POST /api/phone/drafts` returns 201, the file exists, and the transactions table is empty; the same body again returns 200 with `created: false`; a body with 501 characters is 400; a draft resolved by the tool then re-POSTed is 409 with `already_resolved`.
- `queue_full is a 409`: with 100 pending drafts, the next POST is 409 `queue_full`.
- `state carries only the surface`: `GET /api/phone/state`'s top-level keys are exactly `apiVersion, vaultName, serverTime, device, metric, metricUnavailable, pending, resolved, limits`; the JSON contains none of `amount`, `payee`, `rowId`, `doctrine`, `documents`, `databases`; `pending` is this device's drafts only.
- `csrf is refused`: a POST with `Origin: http://evil.example` is 403; one without `Origin` is 403; `OPTIONS` is 405; `POST` without a JSON content type is 415.
- `unpair revokes`: `POST /api/phone/unpair` clears the cookie in the response and the device row is gone from `devices.json`.

- [ ] **Step 2: Run the rig and confirm the door scenarios fail**

From `apps/desktop`: `node_modules/.bin/electron e2e/phone-engine.electron.mjs`

Expected: FAIL on every door scenario, because `phone-door.ts` does not exist.

- [ ] **Step 3: Implement the pairing store and the door**

`phone-pairing.ts` is pure and unit-sized logic driven by the rig; no timers other than `Date.now()`. `phone-door.ts` is `node:http` only, no Electron import, so the engine rig can start it. It serves `dist-phone` with a MIME map and a resolved-path prefix guard, resolves the six routes, and calls the vault-core queue functions. The door has no route to the tools, the MCP doors, the companion, or any file outside `staticDir` and the phone folder. Pairing success calls `addPhoneDevice` and sets the cookie; `unpair` removes the device. Each successful draft queue calls `onQueueChanged`.

Write the `Set-Cookie` value exactly once: `lq_phone=<deviceId>.<secret>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=15552000`.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

From `apps/desktop`: `node_modules/.bin/electron e2e/phone-engine.electron.mjs`

Expected: PASS on Tasks 1–3.

From the repo root: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- apps/desktop/electron/phone-pairing.ts apps/desktop/electron/phone-door.ts apps/desktop/e2e/phone-engine.electron.mjs apps/desktop/tests/phone-engine-e2e.test.ts
git commit -m "feat(desktop): the loopback phone door and its pairing" -m "Six JSON routes on 127.0.0.1:8647, a one-time code exchanged for a device cookie, and a surface that carries one metric and the draft queue and nothing else."
```

---

### Task 4: Desktop wiring and Settings → Phone

**Files:**
- Create: `apps/desktop/electron/phone-service.ts`
- Create: `apps/desktop/src/components/settings/SettingsPhone.tsx`
- Create: `apps/desktop/e2e/phone-settings.html`
- Create: `apps/desktop/e2e/phone-settings.tsx`
- Create: `apps/desktop/e2e/phone-ui.electron.mjs`
- Create: `apps/desktop/tests/phone-ui-e2e.test.ts`
- Modify: `apps/desktop/electron/main.ts` (E2E phone config, IPC, lifecycle)
- Modify: `apps/desktop/electron/preload.ts`, `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/electron/vault-service.ts` (start/rebind with the vault)
- Modify: `apps/desktop/src/lib/settings-views.ts`, `apps/desktop/src/components/settings/SettingsContent.tsx`
- Modify: `apps/desktop/package.json` (`qrcode`, `@types/qrcode`)
- Modify: `apps/desktop/e2e/phone-engine.electron.mjs` (service lifecycle legs)
- Modify: `apps/desktop/tests/phone-engine-e2e.test.ts`

**Interfaces:**
- `phone-service.ts` owns the app singleton and the machine config in `userData/phone.json` (`{schemaVersion: 1, enabled, publicOrigin}`), while devices and the metric stay in the vault. It produces `configurePhoneFromE2e(config)`, `startPhoneForVault(root, vaultId)`, `stopPhone()`, `getPhoneState()`, `setPhoneEnabled(enabled)`, `setPhonePublicOrigin(origin)`, `setPhoneMetric(metric)`, `pairingStart()`, `pairingCancel()`, `revokePhoneDevice(id)`, `phoneQueue()`.
- `phone:state` returns `{enabled, doorUrl, publicOrigin, error, devices, metric, pendingDrafts}`; `phone:queue` returns the pending drafts with `deviceName`. `phone:pairingStart` returns `{code, link, qrDataUrl, expiresAt}` where `qrDataUrl` is `qrcode.toDataURL(link, {width: 240, margin: 1})`.
- `main.ts`'s `LIFEQUEST_E2E` object gains `phone?: {enabled?: boolean; port?: number; publicOrigin?: string; staticDir?: string}`; it is passed to `configurePhoneFromE2e` before `app.whenReady`. IPC channels: `phone:state`, `phone:setEnabled`, `phone:setPublicOrigin`, `phone:setMetric`, `phone:pairingStart`, `phone:pairingCancel`, `phone:revokeDevice`, `phone:queue`; event `phone:changed` is sent to all windows when the queue changes.
- `vault-service.ts` calls `startPhoneForVault(root, vaultId)` after `startMcp`; a failed bind is recorded for Settings and does not fail the open. `main.ts` stops the phone door in the `before-quit` chain and on `window-all-closed` (including macOS, where the app stays alive).
- `SettingsPhone.tsx` renders the toggle, door status/error, the loopback URL, the address field (`https` only, Pair disabled with the reason otherwise), the pair panel (code, QR `<img src={qrDataUrl}>`, countdown, cancel), the device list with Forget, and the metric select. It uses the existing settings sheet's section conventions.

- [ ] **Step 1: Add the dependency and write the failing UI rig**

From the repo root: `npm install --save-dev --workspace @lifequest/desktop qrcode @types/qrcode`

Create `e2e/phone-settings.html` + `phone-settings.tsx`: the page stubs `window.lifequest.phone` from a `rig` query parameter (base64url JSON of `{state, pairing}`), renders `SettingsPhone`, and exposes the same `data-settings-view="phone"` hook the other settings harness pages use. The stub's `phoneState` resolves the injected state; `phonePairingStart` resolves the injected pairing; `phoneSetMetric`, `phoneSetEnabled`, and `phoneSetPublicOrigin` update the page's local state and record the call on `window.__lqPhoneCalls`.

Create `e2e/phone-ui.electron.mjs`, which starts the real door in-process against a temp vault (as the engine rig does), mints the code, builds the `rig` payload, and drives the Settings page in a `BrowserWindow`:

- toggle on: the panel shows the loopback URL and no error;
- address `http://example.test` is refused with the https reason; address `https://studio.example.ts.net` is accepted and the Pair button enables;
- Pair shows the 8-character code, a `data:image/png` QR, and a countdown; Cancel clears them;
- the device list shows `iPhone` after the phone pairs through the door in Task 6 (this leg lands with Task 6; in this task assert the empty list);
- selecting `month_spend` writes `.lifequest/phone/settings.json` and re-renders the selection;
- `capturePage()` to `e2e/artifacts/phone-settings.png` and a JSON report `e2e/artifacts/phone-ui.json`.

Create `tests/phone-ui-e2e.test.ts` with the receipt wrapper's shape: dev-server probe with the `npm run dev` skip, `execFile(electron, ["e2e/phone-ui.electron.mjs"], {cwd: desktopRoot, timeout: 120_000})`, report assertions, and artifact-existence assertions. Later tasks extend the same describe.

Add the service lifecycle legs to the engine rig: in the rig's own `userData`, `startPhoneForVault` binds and `stopPhone()` closes; `enabled: false` leaves no listener; a second start on the same port records `EADDRINUSE`; switching vault roots rebinds and the new vault's devices file is the one read.

- [ ] **Step 2: Run the UI rig and confirm it fails**

From `apps/desktop`, with the dev server up: `node_modules/.bin/electron e2e/phone-ui.electron.mjs`

Expected: FAIL — `SettingsPhone` does not exist, and the panel renders nothing.

- [ ] **Step 3: Implement the service, the wiring, and the panel**

`phone-service.ts` reads `userData/phone.json`, merges the E2E override, and starts the door only when a vault is open and the toggle is on. The address is stored exactly as entered after validation, and the pairing link is `${publicOrigin}/phone/#pair=${code}`. The service subscribes to the door's queue change and sends `phone:changed`. `stopPhone` is idempotent. A vault switch stops the old door and starts the new one.

Add the IPC handlers beside the other `settings:`/`companion:` handlers, the preload bridge, and the `vite-env.d.ts` types. Add `phone` to `SETTINGS_SECTIONS` with the `Smartphone` icon and the keywords from the spec, and the `case "phone"` to `SettingsContent`. Add `startPhoneForVault`/`stopPhone` to `vault-service.ts` and `main.ts` per the interfaces.

- [ ] **Step 4: Run the UI rig, the engine rig, and the suite, and confirm all pass**

From `apps/desktop`:
- `node_modules/.bin/electron e2e/phone-ui.electron.mjs` → PASS, `phone-settings.png` written.
- `node_modules/.bin/electron e2e/phone-engine.electron.mjs` → PASS including the lifecycle legs.

From the repo root: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- apps/desktop/electron/phone-service.ts apps/desktop/src/components/settings/SettingsPhone.tsx apps/desktop/e2e/phone-settings.html apps/desktop/e2e/phone-settings.tsx apps/desktop/e2e/phone-ui.electron.mjs apps/desktop/tests/phone-ui-e2e.test.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/vite-env.d.ts apps/desktop/electron/vault-service.ts apps/desktop/src/lib/settings-views.ts apps/desktop/src/components/settings/SettingsContent.tsx apps/desktop/package.json package-lock.json apps/desktop/e2e/phone-engine.electron.mjs apps/desktop/tests/phone-engine-e2e.test.ts
git commit -m "feat(desktop): phone access, pairing, and the Settings panel" -m "The door lives with the vault and dies with the window. Settings mints a one-time code, shows its QR, lists paired devices, and pins one metric."
```

---

### Task 5: The chat strip and the companion's instructions

**Files:**
- Create: `apps/desktop/src/components/hermes/PhoneDraftStrip.tsx`
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/electron/companion-client.ts`
- Modify: `apps/desktop/e2e/chat-panel.html`, `apps/desktop/e2e/chat-panel.tsx` (phone stub)
- Modify: `apps/desktop/tests/chat-panel-e2e.test.ts` (the strip leg)
- Modify: `apps/desktop/e2e/phone-ui.electron.mjs`
- Modify: `apps/desktop/e2e/phone-engine.electron.mjs`
- Modify: `apps/desktop/tests/phone-ui-e2e.test.ts`, `apps/desktop/tests/phone-engine-e2e.test.ts`

**Interfaces:**
- `PhoneDraftStrip` props: `{drafts: Array<{clientId, text, captureDate, deviceName}>, onPrefill(draft)}`. It shows the count, up to three rows, and "N more"; a row's action fills the composer.
- `CompanionInstructionsInput` gains `phoneDrafts?: Array<{clientId, text, captureDate}>`; `buildInstructions` appends one block, only when the list is non-empty, capped at 10 with "and N more". The block is the text in the spec, with `clientId=` lines and the rules: a draft is not a transaction, do not post without confirmation, use `text` for the correction, never invent an id.
- `ChatPanel` loads `phoneQueue()` when the dock opens and on `vault:dataChanged`/`phone:changed`; sends the same pending drafts as `phoneDrafts` on every turn; the strip's action writes `Post the phone draft: “<text>” (<captureDate>)?` into the composer and focuses it. It never posts.

- [ ] **Step 1: Extend the rigs with the strip and instruction scenarios**

Engine rig — a pure-function leg using the bundled `companion-client.ts`:

- no drafts: the returned string has no `## Phone drafts` block;
- one draft: the block contains its `clientId`, text, and capture date, and the confirmation rule;
- eleven drafts: ten are listed and the block says "and 1 more";
- a draft whose text contains `"` or `\n` is rendered as data, not as a broken fence.

Chat-panel harness — add `phoneQueue()` returning `[]` by default and one draft when the page is loaded with `?phone=1`; `phoneOnChanged`/`dataChanged` are no-ops. Then a leg in the existing wrapper page: the strip appears with the draft, clicking it puts the confirmation text in the composer, and the recorded `companionChatStream` payload's `instructionsContext.phoneDrafts` contains the same id. `capturePage()` to `phone-chat-strip.png`.

- [ ] **Step 2: Run both rigs and confirm the new legs fail**

Expected: FAIL — `PhoneDraftStrip` does not exist and the instruction block is absent.

- [ ] **Step 3: Implement the strip, the context field, and the block**

Build the strip with the app's existing card/pill primitives. `ChatPanel` reads the queue through the preload bridge, subscribes to both change signals, and includes the drafts in the turn context. Append the block in `buildInstructions` after the page context and before the filing block, with the exact rules. A failed `phoneQueue()` renders no strip and no error.

- [ ] **Step 4: Run both rigs and the suite, and confirm all pass**

From `apps/desktop`:
- `node_modules/.bin/electron e2e/phone-ui.electron.mjs` → PASS, `phone-chat-strip.png` written.
- `node_modules/.bin/electron e2e/phone-engine.electron.mjs` → PASS including the instruction legs.

From the repo root: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- apps/desktop/src/components/hermes/PhoneDraftStrip.tsx apps/desktop/src/components/hermes/ChatPanel.tsx apps/desktop/electron/companion-client.ts apps/desktop/e2e/chat-panel.html apps/desktop/e2e/chat-panel.tsx apps/desktop/tests/chat-panel-e2e.test.ts apps/desktop/e2e/phone-ui.electron.mjs apps/desktop/e2e/phone-engine.electron.mjs apps/desktop/tests/phone-ui-e2e.test.ts apps/desktop/tests/phone-engine-e2e.test.ts
git commit -m "feat(desktop): show phone drafts in the chat and tell the companion" -m "The dock shows what the phone queued and offers a confirmation that only prefills; the turn carries the drafts so the companion can post one after the operator says so."
```

---

### Task 6: The phone app, its build, and the packaged shell

**Files:**
- Create: `apps/desktop/phone/index.html`, `apps/desktop/phone/vite.config.ts`, `apps/desktop/phone/tsconfig.json`
- Create: `apps/desktop/phone/src/main.tsx`, `App.tsx`, `api.ts`, `db.ts`, `PairScreen.tsx`, `HomeScreen.tsx`, `Composer.tsx`, `styles.css`, `sw-register.ts`
- Create: `apps/desktop/phone/public/manifest.webmanifest`, `sw.js`, `icons/icon.svg`
- Create: `apps/desktop/scripts/make-phone-icons.mjs` (writes the PNGs)
- Modify: `apps/desktop/package.json` (`build:phone`, `build`, `typecheck`)
- Modify: `apps/desktop/scripts/dev.mjs` (build once, then watch)
- Modify: `apps/desktop/electron-builder.yml` (`dist-phone/**/*`)
- Modify: `apps/desktop/e2e/phone-ui.electron.mjs`, `apps/desktop/tests/phone-ui-e2e.test.ts`

**Interfaces:**
- `package.json`: `"build:phone": "vite build --config phone/vite.config.ts"`; `"build": "npm run build:phone && vite build && node ./scripts/bundle-electron.mjs"`; `typecheck` adds `tsc -p phone/tsconfig.json --noEmit`.
- `dev.mjs`: after `bundleElectron()`, run the phone build once and start `vite build --watch --config phone/vite.config.ts` as a child registered with `children` so cleanup kills it. There is no second dev server.
- `vite.config.ts`: `root` is `phone/`, `base: "/phone/"`, `outDir: "../dist-phone"`, `emptyOutDir: true`, `publicDir: "public"`, and a small plugin that rewrites `__PRECACHE__` and `__VERSION__` in `dist-phone/sw.js` with the emitted asset paths and the desktop version.
- `sw.js`: cache-first for the shell, network-only for `/api/`, versioned cache, `skipWaiting` off, "Reload to update" when a new worker waits. `manifest.webmanifest` has `start_url` and `scope` `/phone/`, `display: standalone`, the three icons. `scripts/make-phone-icons.mjs` writes `icon-180.png`, `icon-192.png`, `icon-512.png` from the SVG with `node:zlib` (no dependency), and the PNGs are committed.
- The app's `api.ts` uses relative `/api/phone` URLs with `credentials: "same-origin"`; `db.ts` is IndexedDB (`device`, `outbox`, `snapshot`); `App.tsx` is the pair/home switch. The pair screen reads `#pair=<code>`, clears the fragment, and posts; the home screen shows the metric with `asOf`, the outbox, and the composer. The app registers the worker, shows install guidance in `display-mode: browser`, and shows "Waiting for your studio" when offline.

- [ ] **Step 1: Extend the UI rig with the phone legs**

In `phone-ui.electron.mjs`, after the Settings legs:

1. Pin `month_spend` in the injected state; pair the phone by loading a `BrowserWindow` at `http://127.0.0.1:<doorPort>/phone/#pair=<code>` with `{width: 390, height: 844, show: false, webPreferences: {partition: "persist:phone-rig"}}`.
2. The home screen shows the metric value, its label, and "as of"; `capturePage()` to `phone-home.png`.
3. Type `R85 Pick n Pay food` and queue it; the outbox shows it and IndexedDB holds it; `capturePage()` to `phone-draft.png`.
4. `session.fromPartition("persist:phone-rig").enableNetworkEmulation({offline: true})`, reload: the shell, the draft, and the cached metric with its age still render.
5. Back online, wait for sync: the draft becomes `queued`; post it through the real `executePhoneTool`; the phone's next state shows `Posted` and the outbox clears.
6. Reload the Settings page with the door's current device list: the device row appears, Forget removes it and the phone's next call is 401.

- [ ] **Step 2: Run the UI rig and confirm it fails**

From `apps/desktop`, with the dev server up: `node_modules/.bin/electron e2e/phone-ui.electron.mjs`

Expected: FAIL — `dist-phone` does not exist and the door has nothing to serve.

- [ ] **Step 3: Implement the phone app and its build**

Write the PWA per the interfaces, with the text-only composer, the outbox merge rules, and the cached metric. Wire the build into `package.json` and `dev.mjs`, and add `dist-phone/**/*` to `electron-builder.yml` so the packaged app carries the shell. The packaged-asar check belongs to `packaged-smoke.mjs`, which is Windows-only; this Linux bench cannot run it, so the asar path stays on the spec's "not covered" list and the handover must not claim it.

Generate the icons once with `node scripts/make-phone-icons.mjs` and commit them.

- [ ] **Step 4: Run the UI rig, the full suite, and the packaged smoke, and confirm all pass**

From `apps/desktop`:
- `node_modules/.bin/electron e2e/phone-ui.electron.mjs` → PASS, all four PNGs written.
- `node_modules/.bin/electron e2e/phone-engine.electron.mjs` → PASS.

From the repo root: `npm run typecheck` and `npm run build`

Expected: PASS; `apps/desktop/dist-phone/index.html` exists; `npm run build` completes.

- [ ] **Step 5: Add the law and the README row, then commit**

Create `LAWS/PHONE.md` with the five laws the spec proposes (one requirement each, RFC 2119 keywords). Add the plan row to the README's Design table beside the spec row.

```bash
git add -- apps/desktop/phone apps/desktop/scripts/make-phone-icons.mjs apps/desktop/package.json apps/desktop/scripts/dev.mjs apps/desktop/electron-builder.yml apps/desktop/e2e/phone-ui.electron.mjs apps/desktop/tests/phone-ui-e2e.test.ts LAWS/PHONE.md README.md
git commit -m "feat(phone): the installable phone client" -m "A cache-first shell with an IndexedDB outbox, a pair screen and a metric card, built with the desktop and served by its door. The laws it satisfies ship beside it."
```

---

### Task 7: Full proof and handover

**Files:** none new. This task exists so the claim at the end is a measured one.

- [ ] **Step 1: Run the whole suite on the bench rig**

From the repo root: `/root/.local/bin/lifequest-e2e <implementation-worktree>`

Expected: PASS. Both new test files run, no rig skips, and `e2e/artifacts/phone-engine.json` and `phone-ui.json` exist. If the run skipped a rig, the run is not evidence; fix the environment and run it again.

- [ ] **Step 2: Inspect the artifacts against the spec**

- `phone-engine.json`: every scenario `pass: true`, including the auth, CSRF, gate, double-post, and metric cases.
- `phone-ui.json`: the Settings, strip, phone-home, phone-draft, offline, sync, and post legs.
- `phone-settings.png`: the shipped Settings panel with the QR and code.
- `phone-chat-strip.png`: the shipped strip above the composer.
- `phone-home.png` and `phone-draft.png`: the PWA at phone size, with the metric's age and the queued draft.
- The phone window's page must be the built `dist-phone`, not a mock or an unstyled page.

- [ ] **Step 3: Check the restart-sensitive surfaces**

The door, the IPC, and the preload are rebuilt by `npm run dev`; `lifequest-e2e` starts its own. Confirm the phone door is reachable after the suite's app launch and that Settings still reads it after a restart. `lifequest-dev <worktree>` is the only way the branch goes on the bench, and only when the operator names it.

- [ ] **Step 4: Declare READY FOR TESTING and stop**

Reply in the repo's shape:

```
READY FOR TESTING — phone client: draft queue, one pinned metric, companion posts from chat
branch: feat/phone-client at <short sha>
artifact: <worktree>/apps/desktop/e2e/artifacts/phone-ui.json — the four screens and the offline/sync legs
          <worktree>/apps/desktop/e2e/artifacts/phone-home.png — the PWA with the metric and the outbox
try: pair a phone from Settings → Phone, queue a draft in the phone, close the studio's window, reopen it, and say yes to the draft in chat
```

Then wait. Do not move the bench, merge, or push. The operator will name the branch when they want it on the bench; then run `lifequest-dev <worktree>`, reply with the VNC URL, and leave the app alone.

---

## Definition of done

- [ ] The engine rig and the UI rig pass on this checkout, through `lifequest-e2e`.
- [ ] `phone-engine.json` exists with every scenario green; `phone-ui.json` exists with every leg green; the four PNGs show the shipped Settings panel, the strip, and the phone app.
- [ ] `npm run typecheck` passes and `npm run build` produces `dist-phone`; the packaged asar is not verified on this Linux bench (Windows-only `packaged-smoke.mjs`) and the handover says so.
- [ ] No transaction can be created by an HTTP request; a connected agent is refused the three tools; the phone's state response carries no ledger, document, database, page, or chat data.
- [ ] `LAWS/PHONE.md` exists with one requirement per law, and the README lists the spec and the plan.
- [ ] The READY FOR TESTING message names the branch, the artifacts, and the interaction that proves the feature.
