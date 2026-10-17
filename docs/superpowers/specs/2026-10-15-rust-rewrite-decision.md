# Rust Rewrite — Decision Memo

**Date:** 2026-10-15  
**Status:** Draft — decision memo for review (no implementation follows from this document)  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron) design](./2026-07-19-local-vault-electron-design.md), [Windows portable packaging design](./2026-08-28-windows-portable-packaging-design.md)  
**Answers:** *Would rewriting LifeQuest mainly in Rust improve performance and other capabilities?*

---

## 1. Purpose

The operator is considering rewriting the program mainly in Rust, on the theory that it would improve performance and add capabilities. This memo answers that question against the code as it exists, separates measured facts from estimates, and records the thresholds that would change the answer.

This document changes no code. Its fix list and capability roadmap are recommendations for future specs, not work this memo performs.

### Success criteria

- The verdict is unambiguous and stated in section 2.
- Every claim about the current code cites a file and line that resolves at the time of writing.
- The two selected pains — **vault open/refresh slowing as the vault grows**, and **native capabilities (signed installer, auto-update, whole-vault encryption)** — are each addressed with a costed recommendation.
- Proposed thresholds are labelled as proposals; no timing is presented as measured, because no baseline exists in the repository.

---

## 2. Verdict

**Do not rewrite LifeQuest mainly in Rust for performance.** There is no compute-bound workload to accelerate. The vault slowness the operator feels is an I/O-scheduling and over-fetch problem in `openVault`, and the four fixes are cheap in TypeScript.

**Do not rewrite for capability either, with one narrow exception.** The signed installer, auto-update, and whole-vault encryption are design and packaging problems that Rust does not solve more cheaply. The exception is SQLCipher-grade encryption of the live `domain.sqlite` book, where the Node SQLite path cannot go — and even there the case is a **single Rust component**, not the program.

### Locked decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Full Rust rewrite | **No** — not justified by performance or by the selected capabilities |
| 2 | Vault-growth slowness | **Fix in TypeScript** — four remediations in section 5 |
| 3 | Renderer (React) | **Stays TypeScript** in every option considered |
| 4 | Signed installer | **electron-builder `nsis` + Authenticode**; the gate is the certificate, not the language |
| 5 | Auto-update | **`electron-updater`**, after the installer; VISION requires it to ask before installing |
| 6 | Whole-vault encryption | **Node `crypto` envelope encryption**, key sealed by Electron `safeStorage` |
| 7 | Live SQLite book encryption | **App-level envelope encryption first**; a Rust `rusqlite` + SQLCipher N-API module is the fallback |
| 8 | When to reconsider a native core | **Only when the section 8 thresholds are met** with measured numbers |
| 9 | This document | **Changes no code and adds no tests** |

---

## 3. Evidence: where the time actually goes

All figures below are counts and line references from the repository, not benchmarks.

### 3.1 There is no compute-bound workload

`vault-core` imports only Node built-ins — `node:fs/promises` (28 import statements), `node:crypto` (22), `node:path` (9), `node:sqlite` (5). It carries no runtime dependency at all (`packages/vault-core/package.json` lists only `@types/node` and `typescript`).

- SQLite is already C; `node:sqlite` is a binding over it.
- The agent loop, memory, skills, and inference live in Hermes, an external process (`VISION.md:103-104`).
- Rendering is React and CSS, which no Rust option moves.
- What remains is JSON parse/stringify, frontmatter parsing, and file I/O — all I/O-bound.

Rust would reduce constant factors on syscall-bound work. It cannot parallelize work that the architecture serializes, and it has no arithmetic hotspot to vectorize here.

### 3.2 The architecture is sequential by design

Every vault operation funnels through one promise queue (`apps/desktop/electron/vault-service.ts:201`, `221-228`). The app is effectively single-threaded for vault work today, which is a deliberate correctness choice for file writes. A Rust core would inherit the same queue unless the concurrency model is redesigned — which is a separate, language-independent project.

### 3.3 Vault open is a full sequential re-read that grows forever

`openVault` (`packages/vault-core/src/open-vault.ts`) is the single read path behind `vault:getSnapshot`. It awaits, serially:

| Work | Location |
|---|---|
| Lifecycle + settings + agents JSON | `open-vault.ts:46,55,66` |
| Every decision file, one `readdir` + one `readFile` per file | `open-vault.ts:72-79` |
| The whole life log JSONL, every line parsed | `open-vault.ts:82-84` |
| Every domain × 4 doctrine files | `open-vault.ts:34-37,93-95` |
| Map, goals, reviews, planning, weekly file counts | `open-vault.ts:108,117,125,131,138` |

`readLog` reads and parses the entire file with no rotation, cap, or tail (`packages/vault-core/src/log.ts:16-30`). So the cost of every snapshot is linear in decisions + log lines + domains, and the log grows without bound as the operator uses the product.

### 3.4 The snapshot ships data the UI never reads

The returned snapshot includes the **entire** log array and **all** decisions (`open-vault.ts:143-161`). On the renderer side:

- `snapshot.log` is read by **no** code. The UI reads the log through the separate `log:list` channel (`apps/desktop/src/pages/ActPage.tsx:99`, `apps/desktop/src/pages/HomePage.tsx:41`, `apps/desktop/src/components/log/LifeLogFeed.tsx:35`).
- `snapshot.decisions` is read once, for the rail's pending count (`apps/desktop/src/components/shell/NavRail.tsx:17`).

So on every refresh the main process reads and parses the full log and every decision file, structured-clones both over IPC, and the renderer discards nearly all of it.

### 3.5 Refresh is frequent

`refresh()` in `VaultProvider` calls `api().vaultGetSnapshot()` and then `reloadRecent()` (`apps/desktop/src/state/VaultProvider.tsx:145-160`). There are **31** `refresh()` call sites across renderer pages and components, most of them immediately after a successful mutation. Each one re-runs the full read of section 3.3.

### 3.6 SQLite connections are opened and closed per operation

Nineteen places construct a connection per operation:

| Area | Sites |
|---|---|
| `packages/vault-core/src/domain-databases.ts` | 6, via `openSqlite` (`:189,519,570,598,713,755`) |
| `packages/vault-core/src/ingest.ts` | 7 (`:129,230,615,675,723,786,878`) |
| `packages/vault-core/src/views.ts` | 3 (`:366,413,472`) |
| `packages/vault-core/src/script-block.ts` | 1 (`:194`) |
| `packages/vault-core/src/finance-kit.ts` | 1 (`:421`) |
| `packages/vault-core/src/books-export.ts` | 1 (`:124`) |

`openSqlite` additionally runs `PRAGMA journal_mode=WAL` and `CREATE TABLE IF NOT EXISTS rows` on **every** call before the real statement (`domain-databases.ts:67-77`). Each operation also re-prepares its statements.

This is connection and schema churn, not query cost. It is trivially addressable in TypeScript and is exactly the kind of thing that looks like "the language is slow" when it is not.

---

## 4. What Rust would buy for performance

Honest accounting:

| Area | Rust effect |
|---|---|
| File reads in section 3.3 | Marginal — the same syscalls, the same sequential schedule |
| JSON parse/serialize | Real but small; V8's JSON is fast and the payloads are not large per file |
| SQLite | None — already C |
| Concurrency | None until the serial queue in 3.2 is redesigned |
| IPC serialization | None without an architecture change; a Rust core would still hand data to the Electron main process |
| Install size / memory / cold start | **Real** — a Tauri-style shell drops Chromium. But footprint was not a selected pain, and this is a host replacement, not a core rewrite |

The performance case for Rust rests on replacing Electron, not on rewriting `vault-core`. Those are different projects with different prices, and the selected pain is vault growth, which section 5 addresses without either.

---

## 5. The actual fix list (TypeScript)

Each item stays inside the existing vault contract and is verifiable through the existing E2E rigs.

| # | Fix | Where | Expected effect |
|---|-----|-------|-----------------|
| 1 | Remove `log` from `VaultSnapshot`; reduce `decisions` to what the rail needs (or an index + count). Keep `log:list` as the single log read path. | `open-vault.ts:143-161`, `types.ts` | Removes the unbounded term from every refresh |
| 2 | Parallelize the independent reads in `openVault`; replace per-decision `readFile` with a decisions index maintained on write. | `open-vault.ts:72-79,93-95` | Turns O(n) serial file reads into O(1) index reads |
| 3 | Hold one connection per open domain, ensure schema once per vault open, cache prepared statements. | `domain-databases.ts:67-77` and the 19 sites | Removes per-operation open/PRAGMA/CREATE churn |
| 4 | Cache snapshot sections by mtime so an unchanged section is not re-read. | `open-vault.ts` | Makes refresh proportional to what changed |

Order is priority order. Fix 1 alone removes the term that grows without bound.

---

## 6. Capability matrix

| Capability | Rust advantage | Recommendation |
|---|---|---|
| **Signed installer** | None. The gate is an Authenticode certificate and SmartScreen reputation, identical under Tauri. | Add `nsis` beside the current `dir` target in `apps/desktop/electron-builder.yml`; then signing. This realises `VISION.md:116` ("signed installer and auto-update") and follows the follow-on noted in the packaging spec. |
| **Auto-update** | None material. `electron-updater` and `tauri-plugin-updater` are peers; both need a feed the operator hosts. | `electron-updater` after the installer. VISION forbids silent replacement, so an update must ask before installing (`VISION.md:123`). Deferred today by the packaging spec (decision 11). |
| **Whole-vault encryption** | None. This is a design and key-management problem. | Node `crypto` envelope encryption for vault files, with the key sealed by Electron `safeStorage` — the same mechanism already used for Hermes keys (`apps/desktop/electron/secrets.ts`). Satisfies `VISION.md:22-23` (on by default for new vaults, skippable, no passphrase required at creation). |
| **Live SQLite book encryption** | **Yes, narrowly** — see section 7. | App-level envelope encryption first; a Rust component only if that is rejected. |

### Threat model (must be stated in the eventual encryption spec)

A key sealed by the OS protects against disk theft, backup leakage, and other user accounts on the machine. It does **not** protect against someone already logged in as the operator. `VISION.md:23` — creating a vault requires no passphrase — implies exactly this model, so the spec must not claim more.

---

## 7. The one native seam

The domain book is `domains/{slug}/data/domain.sqlite` (`VISION.md:15-18`, `README.md:5`). Its rows are plaintext, and Node's built-in SQLite exposes **no SQLCipher and no custom VFS**. If whole-vault encryption includes the live book, the Node path cannot deliver it. Options:

| Option | Cost | Notes |
|---|---|---|
| **(a) App-level envelope encryption of the sqlite file at rest** (recommended first) | Low, all TypeScript | Key from `safeStorage`; encrypt on close, decrypt on open, or work on a decrypted temp file. Interacts with the "copy the folder and the books come with it" promise (`VISION.md:16-17`) and with git; needs its own spec. |
| **(b) SQLCipher-capable Node addon** (e.g. `better-sqlite3-multiple-ciphers`) | Medium | Forces native rebuild: `apps/desktop/electron-builder.yml` currently sets `npmRebuild: false`, and per-ABI prebuilds must be managed for packaging. |
| **(c) Narrow Rust `rusqlite` + SQLCipher N-API module** | Medium-high, one toolchain added | The only defensible "write some Rust" here. It is a component behind the existing `vault-core` SQLite surface — **not** a rewrite of `vault-core`, and never of the renderer. |

Note also that `node:sqlite` became available in Node **22.5**; this is relevant to section 11.

---

## 8. Go/no-go thresholds that would flip the verdict

Reconsider a native core only if a measured case meets one of these. All thresholds are **proposals**, not measurements.

1. **Performance:** after the section 5 fixes, vault snapshot p95 on a realistic five-year vault (order 5,000 decisions, 50,000 log lines, 200,000 database rows) stays above ~150 ms, **and** profiling attributes more than half of wall time to JS/GC rather than to I/O. If time is in I/O, Rust loses the argument by construction.
2. **Live-book encryption:** SQLCipher-grade guarantees are required for `domain.sqlite`, and options (a) and (b) are both rejected. Then build the narrow Rust module (c).
3. **Host replacement:** the product goal changes to dropping Chromium for footprint, memory, or cold start. That is a separate product decision priced as a host rewrite — not a performance fix for the selected pain, and it would put `README.md:5` and the packaging spec in conflict until they are updated.

If none of these is met, the correct answer remains TypeScript.

---

## 9. Cost of a full rewrite

For completeness, if the decision were nonetheless to rewrite mainly in Rust:

| Item | Size / cost |
|---|---|
| `vault-core` re-implemented | 19,458 lines across 40+ modules |
| Electron main + preload | 7,716 lines, 134 `ipcMain.handle` channels, companion spawn, MCP server, `safeStorage`, dialogs |
| React renderer | 27,261 lines — **stays TypeScript** in every option, so this cost is avoided only by keeping Electron/Vite |
| E2E rigs | 8,870 lines driving real Electron windows and DOM/CSS; rigs import `electron` directly (`apps/desktop/e2e/shell-sidebar.electron.mjs:21`), so a host swap invalidates the harness |
| Tests | 2,938 lines |
| Renderer purity contract | `vault-core/pure` is value-imported in the renderer 41 times and enforced by `apps/desktop/src/lib/renderer-vault-imports.test.ts`; a Rust core needs WASM or a permanent dual implementation |
| Documentation | `README.md:5` and the product-runtime statements assume Electron + Vite + React. No law forbids Rust (`LAWS/` contains no runtime law), but VISION and the packaging spec would need updating. |

Product code (core + host + renderer) is **54,435** lines; with rigs and tests, **66,243**. The rewrite pays that cost for bounded I/O constant factors it does not need.

---

## 10. How to measure before acting (proposed, not run)

No timing baseline exists in the repository, so any of the following would be the first measurement. Commands are illustrative.

```bash
# 1. Confirm the runtime can even run the current code (node:sqlite needs >= 22.5)
node --version

# 2. Size the growth term on a real or synthetic vault
ls <vault>/decisions | wc -l
wc -l <vault>/log.jsonl

# 3. Time the read path directly, outside Electron
cat > /tmp/measure-open-vault.mjs <<'EOF'
import { openVault } from "/root/projects/life-quest/packages/vault-core/src/index.ts";
const root = process.argv[2];
const t0 = performance.now();
const res = await openVault(root);
console.log(JSON.stringify({ ok: res.ok, ms: +(performance.now() - t0).toFixed(1) }));
EOF
node --experimental-strip-types /tmp/measure-open-vault.mjs <vault>

# 4. Confirm the payload the renderer discards
#    Log the byte size of the snapshot's `log` and `decisions` fields at vault:getSnapshot.

# 5. Time one SQLite read as it is called today (open + PRAGMA + CREATE + prepare + query + close)
#    versus the same query on a retained connection.
```

The E2E rigs are the right home for a repeatable artifact once a fix lands: extend an existing rig so the same command yields before/after numbers.

---

## 11. Side findings (recorded, not fixed here)

- **`README.md:29` claims Node 20+**, with "20 LTS minimum target". `vault-core` imports `node:sqlite` in five places, and that module arrived in Node **22.5**. The current code cannot run on the stated minimum. The prerequisite table needs correcting in a separate change.
- **`npm run typecheck` does not pass on a clean tree.** It reports 48 errors, and the tree is otherwise unmodified — the count is identical with and without this memo. At least two classes trace to the same drift: `Cannot find module 'node:sqlite'` (the pinned `@types/node` is 20.19.43, which ships no SQLite declarations) and cascading `unknown` types in `review-tools.ts`. This was confirmed by stashing this memo and re-running. It is recorded because it is evidence of declared-runtime drift, and because a Rust rewrite would otherwise be judged against a tree whose type gate is already red.
- **Experimental status.** `node:sqlite` is young relative to SQLCipher-backed native bindings. This is a stability consideration for the encryption work in section 7, not a reason to rewrite.
- **`reloadRecent()` runs on every refresh** (`VaultProvider.tsx:156`), adding a second disk read to each of the 31 refresh sites; it belongs with fix 4 in section 5.

---

## 12. Out of scope

- Implementing any item in section 5; each needs its own spec and plan.
- Implementing the installer, auto-update, or encryption; each needs its own spec.
- Editing `VISION.md`, `PRODUCT.md`, `LAWS/`, or the runtime statement at `README.md:5`.
- Changing the vault layout, IPC surface, or vault contract.
- Any benchmark harness or E2E rig changes.
- A Tauri/Electron host replacement, which is a separate product decision.

---

## 13. Assumptions

- "Mainly in Rust" means the vault core and/or the app host; the React renderer stays TypeScript under every option.
- The operator's selected pains are the two named in section 1; install size and memory are acknowledged (section 4) but are not goals.
- Hermes remains an external process that owns the agent loop and inference (`VISION.md:103-104`).

---

## 14. Spec self-review checklist

| Check | Result |
|-------|--------|
| Placeholders | None |
| Measured vs proposed | Counts and line references are measured; the ~150 ms threshold and footprint claims are labelled proposed |
| Internal consistency | Verdict (sections 2), fix list (5), capability matrix (6), and thresholds (8) agree: TypeScript first, Rust only as a narrow SQLite component |
| Citations | Every `file:line` re-verified at write time |
| Scope | Documentation only; no code, tests, or locked docs touched |
| Ambiguity | The one place Rust is defensible (section 7) is named explicitly rather than left implicit |
