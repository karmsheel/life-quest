# LifeQuest — Fort-Knox security sweep

**Date:** 2026-10-28
**Scope:** the whole product codebase (`apps/desktop`, `packages/vault-core`, build/release
configuration, renderer, loopback doors, companion/Hermes integration, vault storage)
**Base revision:** `354c37b` (master; the audit ran at `47bd3ea` and the branch was rebased onto
current master before handover so the regression gate runs against the tree the operator has)
**Branch:** `security/fort-knox`
**Method:** six parallel read-only audits against a written threat model, each claim backed by
executed evidence (throwaway vaults, in-process doors, a throwaway Electron harness, a Chromium DOM
harness) and then remediation of the confirmed High/Critical paths, verified by a new end-to-end rig.

---

## 0. Verdict in one paragraph

The vault's **data layer** is stronger than its **trust boundaries**. The markdown renderer escapes
raw HTML, the preload bridge is curated, loopback binding and bearer lifecycles are sound, and the
agent grant gate default-denies. But the product had **no navigation guard on the one privileged
window**, no IPC sender identity check, an update-install IPC that lets the renderer choose *and
launch* an executable, a markdown splice that can navigate that window to an attacker origin, a
vault path layer that is lexical rather than physical (traversal and symlink escapes), an MCP door
without Host/Origin checks or body limits, a companion master token written in cleartext (and into a
profile that can point at a squatted port), and several agent-tool authorization gaps. On the fixed
branch the confirmed High/Critical chains are closed and covered by an E2E rig; the remaining items
are product-behaviour/architecture decisions and packaging work listed in §6.

**No unauthenticated remote code execution was found.** The worst confirmed chain is
**stored vault content → one operator click → the privileged window navigates to an attacker origin
and the full `window.lifequest` bridge runs there → vault read/write + host-level update install.**
Every link in that chain had a fix; all are applied on this branch.

---

## 1. What was audited, and how

| Slice | Owner | Report | Evidence |
|---|---|---|---|
| A — Electron shell, window, preload bridge, IPC authorization, e2e seam | shell-warden | `.scratch/security/shell.md` | 164-handler inventory; throwaway Electron 44.6.0 harness proving `window.open` children do **not** inherit the preload but in-place navigation **does**; production esbuild bundle |
| B — Vault filesystem, path/symlink containment, SQLite, script sandbox, SSRF, ingest/receipts | vault-warden | `.scratch/security/vault.md` | executed traversal/symlink/SSRF proofs against throwaway vaults (proofs 01–10) |
| C — Loopback MCP doors, pairing secrets/grants, Hermes proxy, companion spawn/profile | door-warden | `.scratch/security/doors.md` | in-process doors on ephemeral ports with real vaults; request-by-request auth matrix; port-squatting proof |
| D — Renderer XSS/sinks, links, storage, chat rendering | ui-warden | `.scratch/security/ui.md` | 71-payload corpus through the shipped markdown module + Chromium 148 DOM/CSP harness; live exploit reproduction |
| F — Agent/tool authorization, approvals, prompt injection, write paths | agent-warden | `.scratch/security/agents.md` | 68-tool × 6-grant matrix; real `executeTool` probes against seeded vaults |
| E — Supply chain, packaging, auto-update, secrets at rest, dependencies, CI | Lead | `.scratch/security/supply.md` | `npm audit`, lockfile/dep graph, updater code review, git secret/history scan |

Threat model (assets, trust boundaries, attacker models M1–M6, severity rubric) is in
`.scratch/security/THREAT-MODEL.md`. Raw reports and proofs are kept out of git (`.scratch/`), but
this document records every finding, its evidence, and its disposition.

Severity rubric: **Critical** = pre-auth RCE or unauthenticated vault/credential read/write;
**High** = authenticated over-privilege, stored-content → bridge, local credential exposure, update
tampering, path escape to write outside the vault; **Medium** = requires local access/operator action
or defence-in-depth with a plausible chain; **Low/Info** = hardening, limited disclosure, notes.

---

## 2. Findings — the confirmed attack paths

Seventy findings were recorded across the six slices (shell 11, vault 17, doors 14, renderer 6, agents
14, supply 10). Below are the ones that matter to the product's security posture, with disposition.
Full detail (attacker path, prerequisites, impact, evidence, proof test) is in each slice report.

### 2.1 The one Critical-impact chain (closed)

| ID | Finding | Disposition |
|---|---|---|
| UI-01 + SHELL-01 + SUPP-02 | **Wiki-placeholder splice → same-window navigation → preload bridge on an attacker origin → host RCE.** `doctrineMarkdownToHtml` stashed `[[wiki]]` tokens as sentinels *after* escaping but expanded them over the whole generated HTML, so a link destination containing a resolvable wiki token (`[Read](https://evil/[[Overview/What]])`) broke out of the generated `href`, destroyed `target=_blank`, and left a same-window link. Main had no `will-navigate` guard; the preload is attached to the `WebContents`, so the attacker origin got all 161 IPC methods. From there `update:install` accepted a renderer-chosen `*.githubusercontent.com` URL, downloaded it and `shell.openPath`-ed it with no hash/signature and no main-side confirmation. | **Fixed**: sentinel expansion is tag-state-aware and input is stripped of the sentinel range; link rendering can no longer splice generated HTML into an attribute; main now has `will-navigate`/`will-frame-navigate`/`will-redirect` allowlists, a deny-by-default `setWindowOpenHandler` (https externals go to the system browser via a parsed allowlist), and deny-by-default permission handlers; `update:install` is bound to main's own last `update:check` answer, requires the `-setup.exe` name and a release-download URL, verifies size, and asks the operator in a native dialog before launching. |

### 2.2 High

| ID | Finding | Disposition |
|---|---|---|
| SHELL-02 / SUPP-02 | `update:install` = renderer-reachable download-and-execute; trusted hosts included attacker-writable `*.githubusercontent.com`; no hash/signature/confirmation | **Fixed** (binding + name/path/size checks + native confirmation). **Residual:** installer is still unsigned — see §6. |
| SUPP-01 | Auto-update executes an unsigned installer; the only integrity check is the size the same feed declared; release hashes are computed but never verified | **Partially fixed**: binding + confirmation + attacker-host removal. **Recommended:** Authenticode signing and verifying the signer before launch (needs a certificate; the build deliberately has `CSC_IDENTITY_AUTO_DISCOVERY=false`). |
| SUPP-03 | Runtime dependencies declared as devDependencies → `npm audit --omit=dev` vacuously clean while shipped bundles carry vulnerable code | **Fixed in effect**: full-tree audit driven to **0 vulnerabilities** and recorded in §4; **recommended** a release gate on the full audit. |
| SUPP-04 | MCP SDK 1.30.0 on the shipped doors (missing body/batch limits, cross-origin redirect credential forwarding, service-confused bearer auth) | **Fixed**: SDK 1.32.2 + explicit door body/timeout/rate limits. |
| DOOR-01 | Port squatting hands the companion master bearer to a local attacker: the local door's `EADDRINUSE` is tolerated but the profile is still written with `127.0.0.1:8643` + full Bearer | **Fixed**: the token is written only when the local door actually bound; a `null` write clears the stale header/url. |
| DOOR-02 / SUPP-05 | Companion master bearer + Hermes key persist in plaintext with umask modes (0644 files, 0755 dirs); no `chmod` anywhere | **Fixed**: 0600 files in 0700 dirs, corrected on read; plaintext-at-rest documented for the Linux-no-keyring case. |
| DOOR-03 | No Host/Origin validation → DNS-rebinding CSRF on both loopback doors; unauthenticated pairing flood (20 Decisions / 429) | **Fixed**: Host/Origin validation before auth on both doors + SDK rebinding protection + failed-auth/intro rate limiting. |
| VAULT-01 / AGENT-03 | Unvalidated `pageId` walks out of its domain (cross-domain page read/write/delete); `apply_script_block` writes into another domain's page | **Fixed**: ids validated at the path layer and in the script tool; page paths are domain-scoped with realpath containment. |
| VAULT-02 / VAULT-03 | Containment is lexical only: a symlinked file inside the vault is read at open; a symlinked directory redirects writes outside the vault | **Fixed**: physical containment (realpath/lstat) on read and write paths. |
| VAULT-04 / AGENT-04 | Script-block `fetches` are SSRF (https prefix only, redirects followed to internal http, no egress allowlist); reachable from a read-only agent grant | **Fixed**: hostname/IP filtering (loopback/private/link-local/metadata rejected), manual redirects re-validated, streamed byte cap, fetch cap; connected agents cannot fetch at all. |
| AGENT-01 | Read-only single-domain agent reads any domain through `preview_view`/`list_views`/`get_dashboard` | **Fixed**: per-call domain grant enforced; Overview refused to connected agents. |
| AGENT-02 | `get_period_pack` hands a domain-scoped agent the entire daily-note journal | **Fixed**: `projectConnectedPack` returns no daily notes. |
| AGENT-05 | A vault file (`automations.json` + note) drives the full-power companion unattended; no instruction/data separation, no confirmation for destructive tools | **Documented, not changed**: this is a product-authority redesign (signed automation records, Decision-gating destructive tools). Recommended in §6. |
| SHELL-01 | No navigation guard; in-place navigation keeps the bridge (see §2.1) | **Fixed**. |

### 2.3 Medium (fixed or explicitly accepted)

| ID | Finding | Disposition |
|---|---|---|
| SHELL-03 / SUPP-07 | `LIFEQUEST_E2E` seam live in packaged builds; can redirect userData, MCP ports, update feed/trust (incl. plain http) and the installer launcher | **Fixed**: gated on `!app.isPackaged` and dead-code-eliminated from the production bundle by an esbuild define. |
| SHELL-04 | No window-open/permission handlers: attacker child windows get notifications/geolocation auto-granted | **Fixed** (deny by default). |
| SHELL-05 | 0/164 IPC handlers validate sender/frame/origin | **Fixed**: one guarded `ipcMain` facade; packaged builds only accept the product window, dev additionally accepts a frame whose configured preload is the product preload (keeps the two real-bridge harness rigs working). |
| SHELL-06 | DevTools enabled in the packaged build via F12 / Ctrl+Shift+I | **Fixed**: devTools only when unpackaged; accelerators gated. |
| SHELL-07 / VAULT-15 | `vault:create`/`vault:open` take arbitrary renderer absolute paths; directory picker is not a capability | **Accepted (documented)**: with the navigation guard and sender checks, this is one renderer compromise away from full vault access, and a capability token would require changing the product's open flow and every rig. Recommended in §6. |
| SHELL-08 / UI-02 | CSP missing `object-src`/`base-uri`/`form-action`/frame/worker directives; meta-only; `file:` origin | **Partially fixed**: directives added; custom `app://` protocol + header CSP recommended (packaging change, §6). |
| SHELL-09 / SUPP-06 | No Electron fuses, unsigned, asar without integrity, main/preload sourcemaps shipped | **Fixed**: fuses block added to `electron-builder.yml` (runAsNode/NODE_OPTIONS/inspector off, cookie encryption, onlyLoadAppFromAsar + asar integrity); production build no longer writes sourcemaps. **Must be re-exercised by `npm run release` on the Windows build machine.** |
| SHELL-10 | OS notification text built from vault goal names (phishing surface) | **Fixed**: bounded/sanitised with a fixed prefix. |
| DOOR-04 | Door trusts vault-resident approval state: a hostile/synced `connected-agents.json` pre-approves an active+write agent | **Fixed**: a bearer is only authorised when the machine-local secrets store resolves it. |
| DOOR-05 | No body/timeout/rate/concurrency limits on the doors | **Fixed**: 1 MiB streamed cap → 413, timeouts, connection cap, failed-auth/intro rate limit. |
| DOOR-08 | Legacy `hermes-proxy` posts the stored host API key to a `hermesBaseUrl` that vault content (or the renderer) can change | **Recommended**: bind the stored API key to the base URL it was saved for; treat a changed `hermesBaseUrl` as requiring re-entry. Documented in §6 because it touches the setup UX. |
| VAULT-05 / AGENT-08 | Script/SQL has no resource bound (recursive CTE hangs the main process; row cap applied after materialisation) | **Fixed** (queries/source caps, `WITH RECURSIVE` refused, iterate-to-cap). A worker/utility process for SQL remains recommended. |
| VAULT-06 | Unvalidated ids/cadences write any `.md` inside the vault (library/project/review-skill; Decision-apply target fields) | **Fixed**: ids validated through the same path helpers. |
| VAULT-07 | Vault content drives an outbound fetch on open (FX registry `fxSource.url`), and internal response text is written into the synced vault | **Fixed**: https + public-host validation, no internal body written back, byte cap. |
| VAULT-08 | `books.json` restore trusts vault bytes, bypasses cell validation, destructive with no backup | **Fixed**: validation through the same cell path + backup before restore. |
| VAULT-09 | `atomicWriteFile` temp-name collision across concurrent writers | **Fixed**: unique random temp suffix. |
| VAULT-10 | Vault is plaintext and world-readable (0644/0755); no encryption at rest | **Partially fixed** (0600/0700 for the secret store; vault files themselves are intentional plaintext for local-first portability). **Recommended** (product decision): OS-file-vault encryption / age-style envelope, or document that the vault's confidentiality is the OS account's. |
| VAULT-11 | Ingest has no byte/row/column caps, stores arbitrary bytes before type validation, trusts claimed mime/extension | **Fixed**: caps + mime allowlist. |
| VAULT-12 | Receipt decoding has no pixel-dimension cap (decompression bomb) | **Fixed**: input byte cap + dimension guard. |
| VAULT-14 | `archiveDomain`/`updateDomain` skip the slug validator | **Fixed**. |
| AGENT-06 | Persistent instruction poisoning: `set_about_me`, `write_review_skill` apply immediately and are injected at instruction level | **Recommended**: route operator-owned instruction surfaces through Decisions and fence them as data in the prompt. |
| AGENT-07 | Destructive map tools (`delete_year`, `reset_week`, …) apply immediately, no confirmation, no undo | **Recommended**: Decision/confirmation + trash for destructive commands. |
| AGENT-09 | Audit-trail gaps: several write modules log nothing; reads never logged; plain editable log | **Fixed for writes**: review/review-skill/pin/view writes now log with the actor. **Recommended**: hash-chained log + read logging for sensitive reads. |
| AGENT-14 | Review lock is advisory: `unlock_review` is itself a tool, so an injected companion unlocks a finished review and rewrites it with no log | **Fixed**: `unlock_review` is user-actor-only; review writes are logged. |
| AGENT-12 | Decision approval has no content binding/staleness guard for doctrine/library targets | **Recommended**: hash the approved body / re-check `updatedAt` at apply (DB rows already do this). |
| AGENT-13 | Hire dispatch is a second full-power agent path with a caller-supplied actor | **Recommended**: make hires a roster concept or derive the actor in main. |

### 2.4 Low / Info (summary)

- **SHELL-11** no single-instance lock; quit can hang on companion shutdown — recommended.
- **VAULT-13** "read" operations open SQLite in WAL mode and create a table on first read — info.
- **VAULT-16** life-log is world-readable and grows without bound — recommended cap/rotation.
- **VAULT-17** vault "lock/unlock" is a no-op (document locks are the only lock) — recommended:
  remove the misleading control or implement it.
- **DOOR-06** invite door is plaintext loopback+ssh tunnel by design; document the tunnel requirement.
- **DOOR-07** no companion-token rotation/revocation path — recommended.
- **DOOR-09** auth error oracles (near-miss bearer prefix, invite validity) — accepted (128/256-bit secrets, no amplification).
- **DOOR-10** internal fs path leaked in a 500 — fixed.
- **DOOR-11/12/13/14** 48-bit fingerprint identity invariant, adapter URL SSRF/response size, cross-process secrets race, PATH-resolved hermes binary without integrity — documented.
- **UI-03** `img-src` blocked `blob:` so vault media/receipt images were broken — fixed by adding `blob:`.
- **UI-04/UI-05** vault `domain.color` and installed-theme typography reach CSS unvalidated — fixed (hex/font-grammar validation).
- **UI-06** page-context capture could ship a one-time invite code to the model — fixed with `data-page-context="ignore"`.
- **AGENT-10** grant/tool-list mismatches (`mark_review_done` classified decision-gated but applies; two tools advertised then always refused) — fixed to a truthful surface.
- **AGENT-11** the "agent lock" the model is told about does not exist in code — wording removed.
- **SUPP-08** no signed/reproducible release chain, no CI, no `SECURITY.md` — recommended.
- **SUPP-09** archived Next/Prisma app and a placeholder `.env` sit next to the live vault; not shipped — recommended removal.
- **SUPP-10** 510-package tree, 3 install scripts; consider `npm ci --ignore-scripts` in CI.

---

## 3. What was verified secure (so this is a sweep, not a list of fears)

These controls were exercised and held; the negative results are as important as the findings:

- **Markdown renderer**: escapes all HTML; a 71-payload corpus through the shipped function produced
  only whitelisted elements, zero event handlers, zero script/iframe/object/meta. `javascript:`,
  `data:`, `vbscript:`, `file:` and protocol-relative links never become hrefs. Raw-HTML XSS does not
  exist; UI-01 was a *splice*, not a missing escape.
- **CSP**: inline handlers/scripts, `javascript:` navigations and `data:image/svg+xml` are inert under
  the shipped policy (Chromium). It was never a navigation control — hence SHELL-01.
- **Electron isolation**: `contextIsolation: true`, `nodeIntegration: false`, runtime-effective
  `sandbox: true`, `webSecurity: true`; curated bridge, no raw `ipcRenderer`; **child windows from
  `window.open`/`target=_blank` do not inherit the preload** (proved on the exact Electron version, so
  the originally suspected link-click bridge leak is falsified); no `<webview>`/`BrowserView`; no
  protocol handlers, deep links, argv parsing or file associations.
- **Updater mechanics**: version parsing fails closed on unreadable tags, numeric compare, prerelease
  ranking; asset host matching is dot-boundary exact; redirects are re-checked against the resolved
  URL; the feed name is basenamed before use; size mismatch deletes the partial; failure never quits
  the app.
- **Doors**: bind `127.0.0.1` only (off-loopback refused), only `POST /mcp`; auth strictly before MCP
  (401 from headers, body unread); stateless transport, no session fixation; 256-bit companion token,
  128-bit single-use 24 h invites with race/replay/expiry/cap all holding; pending/rejected/no-grant
  agents reach zero tools; revocation is immediate; cross-vault rebind isolates tokens; no secrets in
  vault logs, Decisions, argv or environment.
- **Agent grant gate**: default-deny for unclassified tools; a read grant cannot write; null/empty
  domain writes refused; agents cannot approve Decisions or edit roster/grant/auto-approve state; the
  actor is never model-controlled; archived domains drop out of the grant; review section redaction
  holds.
- **Secrets**: Hermes API keys are never returned to the renderer (boolean-only read); `safeStorage`
  used with no plaintext fallback in code; no secret in the vault; no tracked secret in git history
  (the only match is the archived `.env.example` placeholder).
- **SQL**: no SQL injection found in the vault slice (all value binding is parameterised); the
  script-block keyword allowlist blocks writes/ATTACH/PRAGMA/load_extension (the residual issue was
  resource bounds, fixed).

---

## 4. Dependency and supply-chain result

`npm audit` before remediation: **20 advisories (1 critical, 14 high, 5 moderate)**. The critical was
`proxy-addr` (transitive through the MCP SDK's express server); the high set included the MCP SDK
(server transports without body/batch limits), Electron 44.6.0, zod, react-router-dom, vite, undici,
fast-uri and others.

After `npm audit fix` (all within the declared semver ranges) and a clean `npm run typecheck` +
`npm run build`:

```
electron 44.10.0 · @modelcontextprotocol/sdk 1.32.2 · zod 4.6.7 ·
react-router-dom 7.18.5 · vite 6.4.5 · undici 6.29.1 · hono 4.13.14
npm audit: 0 vulnerabilities (critical 0, high 0, moderate 0, low 0)
```

The lockfile stayed `lockfileVersion 3` with sha512 integrity; the workspace code builds unchanged.
Residual supply-chain risk is the unsigned update path (§2.2 SUPP-01) and the absence of a
signed/reproducible release process (§6).

---

## 5. Verification

The fixes are covered by one end-to-end acceptance rig, **`e2e/security-fort-knox.electron.mjs`** +
**`tests/security-fort-knox-e2e.test.ts`**, run the project's way (`lifequest-e2e`) against the real
main process, real preload and real renderer. It boots with a throwaway profile, rig-owned doors and
a rig-owned update feed, then asserts:

1. the shipped CSP carries `object-src`/`base-uri`/`form-action`/`frame-src` hardening and `blob:`
   images;
2. `[Read](https://evil.example/[[Overview/What]])` renders exactly one external anchor, plain URL in
   `href`, `target=_blank`, no generated tag in the attribute, and clicking it never navigates the
   window (the real renderer module is imported from the live dev server);
3. `location.href` to a foreign origin is refused (no request leaves, the document stays) and
   `window.open` creates no window;
4. a cross-domain `pageId` is refused while the same id in its own domain still reads;
5. the loopback door rejects a foreign Host (403), still answers same-host MCP auth (401
   `AUTH_REQUIRED`), and answers an oversized body promptly without wedging;
6. the pairing-secrets file is `0600` in a `0700` directory;
7. a forged `update:install` is refused **before any byte is fetched**, while the legitimate asset from
   main's own `update:check` answer downloads, is handed to the launcher, and its SHA-256 matches the
   feed's bytes.

Evidence artifact: `apps/desktop/e2e/artifacts/security-fort-knox.json` (machine-checkable report) and
`apps/desktop/e2e/artifacts/security-fort-knox.png` (the shipped welcome screen, captured from the
real window). The rig ran green on the fixed tree: **32/32 checks**, pass, zero failures.

The full existing suite was run against this branch (rebased onto master `354c37b`) as the
regression gate: **74 tests, 69 pass, 5 fail**. The five failures are exactly the pre-existing
stub-bridge test debt proven below; the security rig, the new manual-decision tests, and everything
else pass.

Two temporary failures were found while getting there and were resolved as follows:

| test | cause | disposition |
|---|---|---|
| `dashboard page lock` | **Branch regression**: a Decision that saves a new dashboard view carries `viewId: ""` at propose time (the id is minted on approval); the new segment validator rejected the empty string. | **Fixed** in `decisions.ts` (an empty `viewId` is "new card", not a path segment). Verified by running the test directly against `vault-core` (`pass 1, fail 0`) and by the final suite. |
| `decisions nav badge live` | **Stale base**: the branch was cut from `47bd3ea`; master's next commit (`df14f59`) mounts the chats column in that harness, so the older harness crashed on the newer rail. | Resolved by rebasing onto `354c37b`; the test passes in the final suite. |

The five remaining failures (`automations`, `daily-note-ui`, `ideal-state-ui`, `live-editor-ui`,
`review-ui`) were verified **pre-existing** by running the same five tests on master `354c37b`: they
fail there with the identical unmodelled-`decisionList` message. The harness stubs predate the rail's
`decisionList` polling; this is test debt, not a security defect and not a branch regression.

The security rig, a targeted 18-test regression set (update install/badge, companion doors, MCP
pairing, live dashboard, cold start, finance FX, page context, settings agent, welcome pane), the
master baseline above, and the final full suite were all run through `lifequest-e2e` against this
branch.

The new guards also forced one **manual** rig update: `e2e/packaged-smoke.mjs` used `LIFEQUEST_E2E` to
isolate the packaged app, and the seam is now compiled out of the packaging build, so it isolates with
`--user-data-dir` and expects the product door ports instead. That rig needs a packaging run
(`npm run release`) and is not part of `npm test`.


---

## 6. What remains — the honest list

These are deliberately **not** silently "fixed"; they are product or infrastructure decisions that a
security sweep should not make unilaterally.

1. **Code-sign the app and the installer, and verify the signature before launching an update.** The
   binding/confirmation fix stops a compromised renderer from choosing the executable, but it cannot
   stop a compromised release pipeline. Authenticode on Windows + a pinned publisher check in
   `updater.ts` is the missing anchor. `electron-builder.yml` still has `forceCodeSigning: false` and
   `scripts/electron-builder.mjs` disables identity discovery — a certificate and a release-time
   signing pass are needed.
2. **Re-run `npm run release` on the Windows build machine** and verify the new Electron fuses and
   asar-integrity setting produce a launching app; a dev checkout cannot prove packaging config.
3. **Vault confidentiality at rest.** Vault content is plaintext files by design (local-first,
   portable). If the threat model includes another user on the machine or a stolen disk, the vault
   needs an encryption envelope (or at least documented OS-account boundaries). The secret store is
   now 0600; the vault itself is not encrypted.
4. **`vault:open`/`vault:create` capability binding** (picker-minted one-shot path tokens) — the last
   renderer→filesystem authority still broader than necessary.
5. **Agent authority redesign**: automation records should be operator-signed, destructive tools
   (`delete_year`, `reset_week`, `write_review(unlocked)`, `undo_capture`) should be Decision-gated or
   undoable, `set_about_me`/`write_review_skill` should be Decisions, Decisions should bind to the body
   the operator saw, and hires should be roster subjects.
6. **Hermes key ↔ base URL binding** so a synced `settings.json` cannot redirect the stored API key.
7. **Custom `app://` protocol + header-delivered CSP** instead of `file://` + meta CSP.
8. **Log integrity**: hash-chain the life log, log sensitive reads, cap/rotate the file.
9. **Release hygiene**: `SECURITY.md`, a dependency-audit gate, `npm ci --ignore-scripts` in CI, and
   removal of the archived Next/Prisma app and placeholder `.env`.
10. **Single-instance lock and time-boxed shutdown** (two instances can race the same profile/vault
    and the MCP ports).
11. **Rotate/revoke the companion bearer** on demand (currently minted per vault and stable).
12. **Token-at-rest on Linux without a keyring**: `safeStorage` falls back to plaintext
    (`basic_text`); the app now warns, but a keyring should be a documented requirement.
