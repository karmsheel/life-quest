# Pi as a built-in companion — Decision Memo

**Date:** 2026-10-21
**Status:** Draft — decision memo for review. No implementation follows from this document.
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Local vault (Electron) design](./2026-07-19-local-vault-electron-design.md), [Hermes companion profile design](./2026-09-04-hermes-companion-profile-design.md), [MCP agent pairing design](./2026-10-03-mcp-agent-pairing-design.md), [Cold start does not wait on the companion](./2026-10-17-cold-start-does-not-wait-on-the-companion-design.md)
**Answers:** *Should LifeQuest ship a second, selectable agent harness — an in-built Pi companion — so an operator without Hermes can run a lighter app?*

**Companion design:** [Agent harness seam](./2026-10-21-agent-harness-seam-design.md). That document defines the interface; this one decides whether to build behind it.

---

## 1. Purpose

The operator is considering a second harness beside Hermes, on two beliefs: that the app is unreachable for someone who does not have Hermes installed, and that an embedded agent would be the lighter option. This memo answers both against the code as it exists, separates measured facts from estimates, and records the thresholds that would change the answer.

This document changes no code, adds no tests, and edits no locked doc.

### Success criteria

- The verdict is unambiguous and stated in section 2.
- Every claim about LifeQuest cites a file and line that resolves at the time of writing.
- Every claim about Pi cites a primary source: the npm registry, or the `earendil-works/pi` docs at `main`.
- The two motivations ("no Hermes install" and "lighter app") are answered separately, because they do not have the same answer.
- Measured numbers, primary-source facts, and proposals are labelled as such. No figure is presented as measured unless a command produced it.

---

## 2. Verdict

**Yes to a built-in agent. No to a symmetric "choose your agent" toggle.**

An embedded Pi companion is a defensible product: it removes the install gate, it keeps `LAWS/COMPANION.md` satisfied as written, and it is cheaper at the bundle than the vendor's own package layout suggests — 2.5 MB measured for a realistic embedding. But "let the operator pick between two harnesses" is the expensive shape, and it is the wrong first move. Ship one default companion behind a seam, and only then decide whether Hermes remains selectable.

### Locked decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Second harness as a peer toggle | **No** — parity debt is permanent and the operator gains a setting, not a product |
| 2 | Built-in companion | **Yes in principle** — subject to the VISION amendment in decision 3 |
| 3 | VISION 98–105 ("Hermes is required… does not bundle Hermes") | **Amendment required before any Pi code** — the seam may land first. Proposed text in section 7 |
| 4 | `LAWS/COMPANION.md` | **Unchanged.** The laws name a companion, never Hermes (verified section 6) |
| 5 | Package to embed, if built | `@earendil-works/pi-agent-core` — **not** `pi-coding-agent` |
| 6 | Tool transport for an embedded companion | **MCP client at the existing local door**, not a second in-process binding of the manifest |
| 7 | Transcript storage | Harness-owned, outside the vault. Pi sessions under app `userData` |
| 8 | Credentials | `safeStorage` only. Never Pi's `auth.json`, never the vault (`LAWS/SECRETS.md`) |
| 9 | Order of work | Seam first (its own change), VISION second, harness third |
| 10 | This document | **Changes no code and adds no tests** |

---

## 3. What Pi is, as of 2026-10-21

### 3.1 The coordinates

The scope moved. `@mariozechner/*` is deprecated and frozen at **0.73.1** (published 2026-05-07); every version carries *"please use @earendil-works/pi-… instead going forward"*. The live packages are **`@earendil-works/*`**, at **1.3.0** (published 2026-10-15). Repository: [`earendil-works/pi`](https://github.com/earendil-works/pi). Note also that `@mariozechner/pi` is `pi-pods`, a vLLM GPU-pod manager — not the agent.

| Package | Version | Role |
|---|---|---|
| `@earendil-works/pi-agent-core` | 1.3.0 | `Agent` runtime: tool calling, event stream, state |
| `@earendil-works/pi-ai` | 1.3.0 | Unified multi-provider LLM API, credential store, model catalog |
| `@earendil-works/pi-coding-agent` | 1.3.0 | The `pi` CLI **and** `createAgentSession` — ships read/bash/edit/write |
| `@earendil-works/pi-mcp` | 1.3.0 | Standalone MCP client |
| `@earendil-works/pi-web-ui` | 0.75.3 | Lit chat components. Off the 1.x line, absent from the monorepo |

### 3.2 Licence and embedding terms

MIT across the scope; repository `LICENSE` reads "Copyright (c) 2025 Mario Zechner". One transitive exception: `@silvia-odwyer/photon-node` is Apache-2.0. No commercial-use or embedding restriction appears in the docs, READMEs, `CONTRIBUTING.md`, `AGENTS.md`, or `SECURITY.md`. MIT already permits both.

Embedding is documented, not incidental: *"`@earendil-works/pi-coding-agent` embeds Pi in a Node.js or Bun process"* ([sdk.md](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sdk.md)), with `createAgentSession()`, injectable `sessionManager`, `resourceLoader`, `customTools`, and `agentDir`. Nothing in the repository mentions Electron; that absence is real and is addressed by the probe in section 4, not by the docs.

### 3.3 Stability, stated plainly

Pi 1.0 shipped **2026-10-01**; 1.3.0 shipped **2026-10-15**. The release policy in `.pi/skills/release.md` is verbatim:

> **Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

So breaking changes arrive in **minor** bumps by design, and the 1.0.0 changelog already carries a `### Breaking Changes` section that removed the earlier harness API. Pin exact versions. This is a fast project, not a slow one, and the scope rename is the evidence.

### 3.4 The security posture the app has to supply

From the Pi README, verbatim:

> Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

For a coding agent in a terminal that is a design position. For an app whose companion writes to an operator's life vault under a Decisions regime, it is a gap the app must close itself. `pi-agent-core` provides the seam for that (`beforeToolCall`, `afterToolCall`, `customTools`, `noTools`), but the policy is LifeQuest's to write.

---

## 4. Measured feasibility inside *this* app

The desktop app has an unusual packaging shape, and it decides most of the cost: **it has no runtime dependencies.** Every package is a `devDependency`; esbuild bundles `electron/main.ts` into one ESM file with only `electron` external and `target: "node20"` (`apps/desktop/scripts/bundle-electron.mjs:12-17`); electron-builder ships only `dist/` and `dist-electron/` (`apps/desktop/electron-builder.yml:6-8`), with `npmRebuild: false`.

I installed the published packages in a scratch directory and bundled them with the repository's own esbuild, then ran the bundles under the repository's own Electron binary. Method and results:

| Route | Install footprint | Bundled output | Runs in Electron 35 main? |
|---|---|---|---|
| Full `pi-coding-agent` SDK | **155 MB**, 118 packages | **13.5 MB** | Yes, **after** a 1-line banner fix |
| `pi-agent-core` + 3 providers | same tree | **2.5 MB** | **Yes** — providers register, tools bind |
| `pi-agent-core` alone, no providers | — | **512 KB** | Yes |

What each number means:

- **The banner is required.** The straightforward bundle built clean and then failed at runtime with `Dynamic require of "child_process" is not supported`. Adding `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);` as an esbuild `--banner:js` fixed it; `createAgentSession({ sessionManager: SessionManager.inMemory() })` then booted with no `pi` CLI on PATH, no `~/.pi`, and no credentials.
- **`pi-agent-core` is the cheap route.** A realistic embedding — `Agent`, a TypeBox tool, and the `anthropic`, `openai`, and `openrouter` providers registered through `@earendil-works/pi-ai/models` + `providers/*` — is **2.5 MB** and registers all three. `pi-coding-agent` is 11 MB heavier because it drags `pi-tui` (with six native `.node` prebuilds), the TUI, `photon-node` WASM, `quickjs-wasi`, and the CLI surface.
- **Proportion matters.** The main bundle is currently 2.3 MB (measured in the cold-start spec, `2026-10-17…md:34-35`), and the renderer is 654 kB. A `pi-agent-core` + 3-provider companion roughly doubles the main bundle. That is a real, bounded cost — not the 155 MB the install tree suggests, and not the 13.5 MB the coding agent suggests.
- **The Node floor is a genuine gap.** Pi 1.3.0 declares `engines: node >=22.19.0`. The host the repository installs today — Electron 35.7.5, under `^35.0.0` — bundles **Node 22.16.0** (`process.versions.node`, read from the binary). Imports, `Agent` construction, `SessionManager.inMemory()`, `createModels()`, provider registration, and tool binding all worked on 22.16.0. That is an **unsupported configuration**: it works today by surface, and any 1.3.x minor is free to use a 22.19+ API. Shipping Pi means shipping a newer Electron.
- **No native binaries on the recommended route.** Native `.node` files exist only in `pi-tui`, which the recommended route does not use. All WASM is in the coding agent's extras. `asarUnpack` is therefore not needed for `pi-agent-core`.

### 4.1 How to reproduce

The probe is not committed, because it is a scratch measurement rather than a product test. It is four steps:

```bash
mkdir -p /tmp/pi-probe && cd /tmp/pi-probe
npm init -y >/dev/null && npm pkg set type=module
npm install --ignore-scripts --no-audit --no-fund \
  @earendil-works/pi-agent-core @earendil-works/pi-coding-agent
# bundle, with the repository's esbuild
node_modules/.bin/esbuild entry.ts --bundle --platform=node --format=esm \
  --target=node20 --outfile=bundle.mjs
# run, with the repository's Electron
ELECTRON_RUN_AS_NODE=1 <repo>/node_modules/electron/dist/electron run-bundle.mjs
```

`du -sh node_modules` gives the install footprint; the esbuild banner line reports the bundle size; `process.versions.node` under `ELECTRON_RUN_AS_NODE=1` gives the host's Node.

---

## 5. What the app is today, and what a second harness must satisfy

### 5.1 The gate is one line

The studio does not open without a `ready` companion (`apps/desktop/src/App.tsx:70`), and that is the law (`LAWS/COMPANION.md:1`). A bundled companion satisfies this trivially; an external Hermes does not, on a machine that has never installed one.

### 5.2 The harness surface is large, and already narrow at the renderer

| Piece | Size at this commit |
|---|---|
| `apps/desktop/src/components/hermes/ChatPanel.tsx` | 2,231 lines |
| `apps/desktop/electron/companion.ts` | 1,378 lines |
| `apps/desktop/electron/companion-client.ts` | 847 lines |
| `apps/desktop/electron/companion-lifecycle.ts` | 693 lines |
| `apps/desktop/electron/companion-profile.ts` | 697 lines |
| 17 `companion:*` IPC channels (`apps/desktop/electron/main.ts:633-711`) | — |
| E2E rigs: chat-chain, chat-sessions, composer-model-pills, tool-run, startup-boot | 4,795 lines |

The renderer's contract is much smaller than that, and it is already almost harness-neutral:

- **One event union.** `ChatStreamEvent` has nine members (`apps/desktop/electron/companion-client.ts:143-152`), and the panel switches on exactly those (`ChatPanel.tsx:711-795`).
- **One turn call.** `companionChatStream(sessionId, input, instructionsContext, runtime, receiptRelPath)` (`ChatPanel.tsx:898`), which becomes `buildTurnInput` + `buildInstructions` + `runtimeRequestBody` + an SSE read (`companion.ts:1189`).
- **Session CRUD, a model catalog, approval, stop, and a filing pref.** That is the whole surface (`apps/desktop/electron/preload.ts:317-400`).

The unavoidable differences are not in the event stream; they are in **semantics**: approval, session flags, transcript ownership, the instruction block, and who the log says acted. The seam design covers each one.

### 5.3 The install gate is the operator's actual pain, and it has been measured

The cold-start work recorded `companion:ensure` at **56,549 ms** in a 57,674 ms boot, dominated by restarting a healthy Hermes host ([cold start spec](2026-10-17-cold-start-does-not-wait-on-the-companion-design.md), lines 21–22). That defect is fixed; the splash no longer waits, and a healthy companion answers in about 100 ms. What the fix did **not** remove:

- The `hermes` CLI must be on `PATH` (`companion-lifecycle.ts:488-489` returns `needs_install` when it is not).
- A gateway process must exist, on a port, with a profile directory, an `.env`, and a config the app rewrites.
- Every one of the status kinds the operator can land on (`needs_install`, `profile_error`, `port_busy`, `gateway_exited`, `hermes_too_old`, `auth_error` — `companion-lifecycle.ts:47-61`) is a way to not use the studio.

An embedded agent deletes that whole class. That is the strongest argument in this memo, and it has nothing to do with binary size.

### 5.4 A "choose your agent" UI already exists — for Hermes profiles

`CompanionProfilePicker` and `companion:useProfile` (`apps/desktop/src/components/hermes/CompanionProfilePicker.tsx`, `apps/desktop/electron/main.ts:638`) already let the operator choose which Hermes profile hosts the companion. The operator is not short of agency over *which* agent; what they lack is a path that does not require Hermes at all. That distinction should shape the UI: the seam sits **above** the profile picker (harness → then profile), and only the Hermes harness has a profile to pick.

---

## 6. Contract check

| Doc | Text | Under a bundled Pi companion |
|---|---|---|
| `LAWS/COMPANION.md:1` | "The studio MUST NOT open without the companion." | **Survives.** Names no vendor. |
| `LAWS/COMPANION.md:3-9` | The companion must know what the page shows; page context on by default; navigable out and back | **Survives**, but binds the Pi harness: `buildInstructions`'s page-context block is not optional (`companion-client.ts:559-579`). |
| `LAWS/SECRETS.md` | "API keys MUST NOT be stored in the vault." | Survives **only if** keys go through `safeStorage`. Pi's default is a plaintext `auth.json`. |
| `LAWS/DOCTRINE.md` | Agents must not lock docs; a change to a locked doc is a pending Decision | Survives only if the tool surface is the MCP door's, not Pi's file tools. |
| `VISION.md:25` | "Chat transcripts stay with Hermes." | **Breaks.** Pi sessions are JSONL under `~/.pi/agent` by default, or wherever the host puts them. |
| `VISION.md:98` | "Hermes is required for the studio, and is not the product" | **Breaks** as a heading and as a claim. |
| `VISION.md:105` | "It does not bundle Hermes, and it does not kill a gateway it did not start." | **Survives literally; its intent is the question.** The app would still not bundle Hermes — but the agent would no longer be external, which is the property that sentence was protecting. |
| `VISION.md:124` | Resist a change that "lets the studio open without the companion" | Arguably satisfied — a built-in companion is always present — but the sentence was written against this move. Amend, do not reinterpret. |
| `PRODUCT.md:5` | "working with a Hermes companion… does not open without the companion" | **Breaks** in the same two clauses as VISION. |

**The finding that matters:** the *law* survives and the *vision* does not. That inverts the usual order of work. The cheapest contract-correct path to "no Hermes install" is a bundled companion, because every alternative violates something stronger: opening a degraded studio breaks `LAWS/COMPANION.md:1`, and auto-installing Hermes breaks `VISION.md:105`. But it cannot ship before the vision is edited, and editing the vision is a product decision, not an engineering one.

---

## 7. Options

| # | Option | What it buys | What it costs | Verdict |
|---|---|---|---|---|
| **A** | Do nothing; keep Hermes-only | Zero cost, zero risk | The install gate stays; the operator's stated motivation is unmet | **Rejected** if the motivation is real |
| **B** | Second harness, operator chooses | Both worlds | Two engines, two behaviours; permanent parity work across 2,231 panel lines and 3,615 companion-module lines, plus 4,795 rig lines; the operator must understand a setting that changes how the vault is written | **Rejected** as first shape |
| **C** | Seam now, no second harness | 17 IPC channels behind one interface; testable in isolation; any future harness is cheap | One refactor, no user-visible change | **Recommended first step** |
| **D** | Built-in Pi as *the* companion; Hermes stays as an optional external harness | No install gate, one default, one behaviour | VISION amendment; `pi-agent-core` in the main bundle; an Electron upgrade; a second tool transport to prove | **Recommended if 3 is approved** |
| **E** | Pi CLI as a *connected agent* through the invite door | "Works with Pi" today, zero new harness | Not the no-Hermes path — the studio still needs Hermes to open | **Complementary, not a substitute** |

Option E deserves a sentence of its own because it is already built: the invite door on `8646` accepts an unknown agent, files one pairing Decision, and grants read-only after approval. Anyone who wants *a* Pi in the loop can have one today, under the operator's grant. It answers "Pi should feel first-class", not "I cannot run LifeQuest".

### Proposed VISION amendment (for decision 3)

Replace the heading and lines 103–104; keep 100–102 and 105 as they stand:

> ## (98) The companion is required for the studio, and is not the product
>
> (100) The studio does not open without the companion.
> (101) Capture is not the studio.
> (102) LifeQuest owns the vault, the MCP door, and the UI.
> (103) **The companion owns the agent loop, memory, skills, and transcripts, wherever it runs.**
> (104) **The built-in companion is Pi; a Hermes gateway on the operator's machine is an optional external companion.**
> (105) *unchanged.* It does not bundle Hermes, and it does not kill a gateway it did not start.

Line 105 needs no edit and that is worth noticing: it stays true, because the app would still not bundle Hermes. What changes is 103 — who owns the loop and the transcripts. If the operator wants the older rule to mean "the agent is never part of the app", that is a *new* sentence to write, not an existing one to reinterpret.

Line 105 ("It does not bundle Hermes, and it does not kill a gateway it did not start") should keep its second half — that rule survives intact and is the reason `shutdownCompanion` checks `startedByLifeQuest` (`companion-lifecycle.ts:314-321`).

---

## 8. Recommendation

**Do C, then decide 3, then possibly D. Never B.**

1. **Land the seam first** (its own change, no product change). `companion.ts` becomes a facade over one `AgentHarness` interface, with `HermesHarness` delegating to today's code. IPC, preload, and the renderer stay byte-identical, and every existing E2E rig must pass unchanged. That is the proof the seam is real and not a rename. Worth doing even if Pi is never built: it makes the Hermes path testable in isolation for the first time.
2. **Decide the vision question explicitly**, using the proposed text in section 7. This is an afternoon and it gates everything below. If the answer is no, close this memo and stop — the engineering case does not override a written product decision.
3. **If approved, build `PiHarness` behind the seam**, with the constraints in decisions 5–8:
   - `@earendil-works/pi-agent-core`, pinned exactly, plus explicit `pi-ai` providers — never `pi-coding-agent`, because its default loadout is a shell with filesystem access against the operator's machine, which no Decisions regime can govern.
   - Tools through the existing local door with the companion token, so the write rules, the lock, and the Decision fence keep one implementation.
   - `beforeToolCall` wired to the same rule set, so an embedded companion cannot route around governance.
   - `safeStorage` keys via `ModelRuntime.setRuntimeApiKey`; `agentDir` under `%APPDATA%\LifeQuest`.
   - Pi sessions under app `userData`, never the vault.
   - The `createRequire` banner in `bundle-electron.mjs`, and an Electron bump to a Node ≥22.19 host.
4. **Do not build on `pi-web-ui`.** It is on the abandoned 0.75 line, has no source repository, and would fight the three-pane design contract.

### Go/no-go thresholds

Ship D only if all five hold. Thresholds 1–4 are pass/fail facts. Threshold 5's budget and the "one rig-week" limit below are proposals, not measurements:

| # | Threshold | Why |
|---|---|---|
| 1 | Seam merged, all existing rigs green, renderer diff empty | Otherwise "second harness" is a rewrite, not a plugin |
| 2 | VISION amended (decision 3) | Engineering cannot overrule the written product |
| 3 | Tool parity on the full manifest, the Decision fence, and the agent lock, proven by a rig that runs the same legs against both harnesses | Parity is the product, not a test |
| 4 | Electron on Node ≥22.19 | 22.16 is unsupported by Pi's own `engines` |
| 5 | Main-bundle growth inside a stated budget (measured 2.5 MB for 3 providers; expect more per provider) | Keeps "lighter" honest |

**Kill it** if the model catalog cannot feed the existing composer pills (`ChatPanel.tsx:817`, `companionModelOptions` at `companion.ts:1243`), or if parity costs more than one rig-week.

### On "lighter", precisely

The two motivations do not share an answer.

- **Lighter to start:** yes, decisively. No Python, no `hermes` on `PATH`, no gateway port, no profile directory, no `needs_install`, no 45-second gateway restart path. The embedded companion cannot have the failure mode that produced the 57-second boot.
- **Lighter to download:** no. The app currently ships a 2.3 MB main bundle and a 654 kB renderer, with Hermes costing the binary nothing because it is a separate process. A `pi-agent-core` companion roughly doubles the main bundle before any provider is added, and requires a newer Electron.
- **Lighter to maintain:** no, if both harnesses ship. Yes, if Pi replaces the external default.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pi minor bumps break the integration | High — the policy makes minors breaking | Rework on every upgrade | Pin exactly; a rig that boots the embedded harness; upgrade in a dedicated change |
| Scope/config churn upstream (the `@mariozechner` → `@earendil-works` move already happened once) | Medium | Import-only, if imports are centralised in one adapter file | One adapter module owns every Pi import |
| Electron Node floor lags Pi's `engines` | Certain today | Unsupported runtime | Bump Electron before shipping, not after |
| Embedded agent bypasses Decisions or the lock | Medium without care | Operator trust, `LAWS/DOCTRINE.md` | `customTools` only, `noTools` for the rest, `beforeToolCall` policy, MCP door for writes |
| Keys end up in plaintext or in the vault | Medium — Pi's default is `auth.json` | `LAWS/SECRETS.md` | `safeStorage` + `agentDir` in userData; the seam refuses a plaintext path |
| Two answer engines write one vault | High under option B | Inconsistent behaviour, duplicated bugs | Option D (one default), not B |
| The log names the wrong agent | High if the door keeps `name: "Hermes"` (`pairing-door.ts:63`) | The vault records a lie about who wrote | Carry the harness display name into the actor |

---

## 10. Not verified

Stated so a reader can tell the difference between measured and assumed:

- **No Electron integration is documented by Pi.** Nothing in the repository mentions Electron, `asar`, or electron-builder. The probe in section 4 is the only evidence, and it covers imports, construction, provider registration, tool binding, and `createAgentSession` — not a full chat turn against a real provider.
- **No real model call was made.** Every probe ran offline against fakes. Token streaming, tool-call round-trips, and error mapping for a live provider are unproven.
- **The 2.5 MB figure is one provider set.** It will grow with each provider added and shrinks when providers are imported individually. It is not a worst case.
- **Pi's offline model catalog behaviour was not tested.** The docs describe a bundled catalog overlaid from `pi.dev`, with cached data usable offline. Whether a first run with no network shows an empty picker is unknown, and it matters for a local-first product.
- **Session listing and flags were not tested.** `SessionManager` documents listing and forking; the mapping to the dock's `pinned` / `archived` / `preview` fields is designed, not proven.
- **`pi-web-ui` compatibility with 1.3.0 is unverified** and assumed broken, because the package is on 0.75.

---

## 11. Out of scope

- Implementing the seam or the Pi harness; each needs its own plan.
- Editing `VISION.md`, `PRODUCT.md`, `LAWS/`, or `README.md`.
- The Electron upgrade, the signing work, or auto-update.
- Any change to the vault layout, the MCP doors, or the IPC surface.
- Removing Hermes.

---

## 12. Assumptions

- "Lighter app" means fewer install steps for the operator; section 8 answers the download-size reading separately.
- The operator's motivation is the first-run gate, not dissatisfaction with Hermes as an agent.
- Hermes remains supported and selectable even if Pi becomes the built-in default.
- The companion is one agent per vault, not a roster of companions.

---

## 13. Self-review checklist

| Check | Result |
|---|---|
| Verdict unambiguous | Section 2: yes to built-in, no to peer toggle |
| Placeholders | None |
| Measured vs proposed | Section 4 figures are command-produced; bundle budgets and the one-rig-week limit are labelled proposed |
| Citations resolve | Every `file:line` re-verified against commit `833f971` at write time |
| Internal consistency | Decisions 2–3 (amend, then build) match section 8's order; option B is rejected in both places |
| Scope | Documentation only; no code, tests, or locked docs touched |
| Ambiguity | The one place the answer flips (a bundled agent vs a second harness) is named explicitly in section 2 |
