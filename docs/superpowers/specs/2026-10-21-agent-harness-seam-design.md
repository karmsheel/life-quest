# Design: the agent harness seam

**Date:** 2026-10-21
**Status:** Implemented 2026-11-01 in `feat/pi-companion` (see §8). The design below is what was built; §13 records where the landed code departs from it.
**Product:** LifeQuest — local-first life-management studio
**Answers:** *What is the smallest interface that lets LifeQuest host more than one companion, without the renderer learning which one it is talking to?*
**Decision context:** [Pi as a built-in companion — Decision Memo](./2026-10-21-pi-companion-decision.md). That document decides *whether* a second harness is built. This one defines *where the boundary is* if it is.
**Depends on:** [Hermes companion profile design](./2026-09-04-hermes-companion-profile-design.md), [Cold start does not wait on the companion](./2026-10-17-cold-start-does-not-wait-on-the-companion-design.md), [MCP agent pairing design](./2026-10-03-mcp-agent-pairing-design.md)

---

## 1. The problem

The companion is the studio's one required dependency (`LAWS/COMPANION.md:1`), and it is hard-wired from three directions at once:

1. **The renderer** calls 17 `companion:*` IPC channels (`apps/desktop/electron/main.ts:633-711`, `apps/desktop/electron/preload.ts:317-400`) and switches on nine stream events (`apps/desktop/src/components/hermes/ChatPanel.tsx:711-795`).
2. **The main process** owns a module that is both the transport and the lifecycle: `companion.ts` is 1,378 lines and does HTTP, SSE parsing, profile writing, spawn, status, and model probing in one place.
3. **The gate** refuses to open the studio unless `status.kind === "ready"` (`apps/desktop/src/App.tsx:70`), so every failure mode of the transport is a failure mode of the product.

That shape is fine while there is exactly one companion. It is not fine as soon as there might be two, because the cost of a second harness is not the adapter — it is the **surface that has to stay in parity** (2,231 lines of chat panel, 3,615 lines of companion modules, 4,795 lines of rigs).

The observation that makes this tractable: **the renderer's contract is already narrow.** It has one event union (`companion-client.ts:143-152`), one turn call (`ChatPanel.tsx:898`), one session CRUD, one model catalog, one approval, one stop. Everything Hermes-specific — polling a gateway, restarting a host, rewriting YAML, parsing SSE — lives between that contract and the network. The seam simply makes that boundary official.

## 2. Goals and non-goals

### Goals

- One interface behind which a companion lives, with **zero renderer changes** in the first change.
- `HermesHarness` behaves exactly as today: same events, same timings, same status kinds, same text.
- A second harness is an implementation of the interface, not a second copy of the panel.
- The interface names the differences honestly rather than papering over them (section 6).
- Each step is independently shippable and revertible, and the existing rigs prove it.

### Non-goals

- Choosing, installing, or shipping a second harness.
- Changing the IPC surface, the preload API, or the renderer's visual contract.
- Removing Hermes, or supporting two harnesses at once.
- A general plugin system. There is one seam and (at most) two implementations.

## 3. What exists today

### 3.1 Three callers, not one

This is the part most easily missed. "The companion" is not a single path through the app:

| Caller | Entry point | What it does | Seam covers it? |
|---|---|---|---|
| **Chat / sessions / models** | `companion.ts` (facade) → `hermesFetch` | The dock, sessions, approvals, model catalog | **Yes — v1** |
| **Settings test, Personnel scan** | `vault-service.ts` → `hermes-proxy.ts` (`hermesTest`, `hermesScanAgents`, `hermesChat`) | Settings "Test connection"; Personnel "Scan Hermes agents" (`PersonnelStudio.tsx:208`) | **No** — documented gap |
| **Act planner** | `vault-service.ts:1317` → `runPlannerLoop` (`map-tools.ts:62`) → `hermesChatWithTools` | An 8-round tool loop for Act | **No** — documented gap |

A Pi-only mode is **not honest** until all three are answered. The seam intentionally starts with the first, because it is the one the studio cannot open without; the other two must be listed in the plan, not forgotten.

### 3.2 The facade's exports

`companion.ts` today exports, in one module:

```
companionStatus / companionEnsure / onCompanionStatusChanged
companionProfilesList / companionUseProfile
companionSessionsList / companionSessionCreate / companionSessionMessages
companionSessionPatch / companionSessionDelete / companionSessionsOpen
companionModelOptions / companionChatStream / companionApproval
companionRunStop / companionOpenProfileFolder / companionPrompts
companionConfirmDoors / companionAttachToGateway / companionWriteMcpProfile
companionShutdown / companionStatusMessage / agentUnreachableMessage
```

Three groups hide in that list:

- **The harness contract** — status, ensure, sessions, models, chat, approval, stop, shutdown.
- **Hermes profile management** — `ProfilesList`, `UseProfile`, `OpenProfileFolder`, `Prompts`, `WriteMcpProfile`, `AttachToGateway`, `ConfirmDoors`. None of these has a meaning for an embedded agent.
- **Hermes plumbing** — `hermesFetch`, `ensureHostGateway`, `dropCachedToolManifest`, `HERMES_TIMEOUT_MS`.

The seam splits the first from the second. The third stays private to `HermesHarness`.

### 3.3 The renderer's actual contract

What the panel consumes, and nothing more:

| Need | Shape | Site |
|---|---|---|
| Turn events | `ChatStreamEvent`, 9 members | `companion-client.ts:143-152` |
| Turn submission | `{ sessionId, input, instructionsContext, runtime, receiptRelPath }` | `ChatPanel.tsx:898-927` |
| Sessions | `HermesSession { id, title, preview, lastActive, pinned }` | `companion-client.ts:154-163` |
| Transcript | `TranscriptMessage { role, content, at? }` | `companion-client.ts:433-439` |
| Model catalog | `CompanionModelCatalog` | `companion-client.ts:198-202` |
| Status | `CompanionStatus` union, 8 kinds (ready + 7 unavailable) | `vite-env.d.ts:79-106` |
| Approval | `{ runId, requestId, summary }` → allow/deny | `ChatPanel.tsx:760-766, 1720-1740` |

## 4. The interface

New folder: `apps/desktop/electron/harness/`.

```ts
// harness/types.ts — the wire shapes, re-exported under harness-neutral names
export type HarnessId = "hermes" | "pi";
export type HarnessResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type HarnessStatus = PublicCompanionStatus;        // v1 alias, see §5.1
export type HarnessSession = HermesSession;               // v1 alias, renamed in a later pass
export type ModelCatalog = CompanionModelCatalog;

export type ChatTurnRequest = {
  sessionId: string;
  input: string;
  instructionsContext: CompanionInstructionsInput;
  runtime?: CompanionRuntimeOverride | null;
  /** A receipt already taken from the pending slot by main. */
  receiptRelPath?: string | null;
};

export type SessionPatch = { title?: string; pinned?: boolean; archived?: boolean };
```

```ts
// harness/agent-harness.ts
export interface AgentHarness {
  readonly id: HarnessId;
  /** What the vault log calls this agent when it writes. Never a constant in the door. */
  readonly displayName: string;
  readonly kind: "external" | "embedded";

  // Lifecycle
  ensure(): Promise<HarnessStatus>;
  status(): HarnessStatus;
  statusMessage(status: HarnessStatus): string;
  /** One sentence for Settings, without the renderer knowing what a port is. */
  describeReady(status: HarnessStatus): string;
  shutdown(): Promise<void>;

  // Sessions
  listSessions(): Promise<HarnessResult<HarnessSession[]>>;
  createSession(title: string): Promise<HarnessResult<HarnessSession>>;
  sessionMessages(id: string): Promise<HarnessResult<TranscriptMessage[]>>;
  patchSession(id: string, patch: SessionPatch): Promise<HarnessResult<HarnessSession>>;
  deleteSession(id: string): Promise<HarnessResult<{ id: string; deleted: boolean }>>;
  /** Re-establish the companion before a page promises a chat. */
  openSession(): Promise<HarnessResult<void>>;

  // Models
  modelCatalog(): Promise<HarnessResult<ModelCatalog>>;

  // One turn
  chatStream(
    request: ChatTurnRequest,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<HarnessResult<void>>;
  approve(runId: string, requestId: string, allow: boolean): Promise<HarnessResult<void>>;
  stopRun(runId: string): Promise<HarnessResult<void>>;
}
```

```ts
// harness/profiled-harness.ts — only a harness with profiles implements this
export interface ProfiledHarness extends AgentHarness {
  listProfiles(): Promise<{ active: string; profiles: CompanionProfileInfo[] }>;
  useProfile(name: string): Promise<HarnessStatus>;
  openProfileFolder(): Promise<void>;
}

export function hasProfiles(harness: AgentHarness): harness is ProfiledHarness {
  return "listProfiles" in harness;
}
```

The facade keeps its name and its imports. `companion.ts` becomes:

```ts
const harness = activeHarness();                 // registry, §7
export const companionEnsure = () => harness.ensure();
export const companionChatStream = (...args) => harness.chatStream(...args);
// …one delegating line per public function
```

That is the whole point: **the seam is invisible in v1.** The 17 IPC channels, the preload file, and every renderer selector stay byte-identical, and the rigs are the proof.

## 5. What each harness must produce

### 5.1 Status

The current union is Hermes vocabulary: `needs_install`, `profile_error`, `port_busy`, `gateway_exited`, `disconnected`, `hermes_too_old`, `auth_error` (`companion-lifecycle.ts:47-61`). A Pi companion has none of those and two of its own: *no key configured* and *this host is too old for the SDK*.

**v1 (Hermes only):** no change. The union stays and `statusMessage` moves behind the harness.

**When a second harness lands:** `ready` gains `harness: HarnessId` and `detail: string`, and the Hermes-only fields (`port`, `baseUrl`, `profilePath`, `cliPath`, `childPid`, `startedByLifeQuest`) become optional. The renderer's two readers change (three lines total):

| Reader | Today | After |
|---|---|---|
| `SettingsHermes.tsx:16-17` | `` `Ready · ${status.baseUrl} · ${how}` `` | `status.detail ?? …` |
| `CompanionSetupScreen.tsx:30` | `"port" in status ? status.port : ""` | unchanged — the guard already exists |

New kinds, if a second harness needs them, are additive: `unsupported_host`. Every existing switch has a default (`CompanionSetupScreen.tsx:20-57`), so an unknown kind degrades to the generic "connecting" copy rather than a blank screen.

### 5.2 Stream events

The union is already harness-neutral; only the translation differs. For Pi, from the `pi-agent-core` event table in the Pi repository (`packages/agent/README.md`):

| Pi source | `ChatStreamEvent` | Notes |
|---|---|---|
| immediately before `session.prompt()` | `run.started { runId }` | Pi has no run id; generate one and register the `AbortController` against it |
| `message_update` where `assistantMessageEvent.type === "text_delta"` | `assistant.delta { text: delta }` | Pi sends deltas, not growing snapshots |
| `tool_execution_start` | `tool.started { name: toolName, target }` | Reuse `toolTargetLine(args)` (`companion-client.ts:725`) so the row is bounded the same way |
| `tool_execution_end` | `tool.completed { name }` | Pi carries no outcome field either |
| approval bridge (§5.6) | `approval.request { runId, requestId, summary }` | Same shape the panel already handles |
| abort → `agent_end` with `stopReason === "aborted"` | `run.stopped` | Matches the current `run.cancelled` mapping (`companion-client.ts:784-788`) |
| `stopReason === "error"` or output-limit `length` | `run.incomplete { reason }` | Mirrors `run.failed` (`companion-client.ts:789-795`) |
| `agent_settled` | `run.completed` | **Not `agent_end`** — the SDK docs are explicit that recovery or queued work can follow `agent_end` |

The Hermes path emits `run.completed` unconditionally when the SSE stream closes (`companion.ts:1228`). That shortcut must not be copied: for Pi, completing on stream end would tell the panel a turn is over while the agent is still recovering.

### 5.3 Sessions

| Dock operation | Hermes | Pi |
|---|---|---|
| list | `GET /api/sessions?limit=200` | Enumerate the session dir; read each JSONL header and first user entry |
| create | `POST /api/sessions` | Create a `SessionManager` file; write the sidecar row |
| messages | `GET /api/sessions/{id}/messages` | Walk the entry tree, keep only `user` / `assistant` text |
| rename / pin / archive | `PATCH` — durable on the gateway | **Sidecar index only** — Pi has no such flags |
| delete | `DELETE` | Remove the JSONL and the sidecar row |

Two consequences worth stating before anyone writes code:

- **A sidecar is required.** Pi's session file carries `id`, `timestamp`, `cwd`, and the entry tree; it does not carry `pinned`, `archived`, or an operator title. `sessionLabel` already copes with an empty title by falling back to the first user message (`companion-client.ts:409-416`), so the sidecar only has to store explicit overrides — a small JSON file in `userData`, written through the existing queue discipline, never in the vault.
- **Transcripts move.** `VISION.md:25` says transcripts stay with Hermes. Under Pi they stay with the harness, which is still "outside the vault" — but the sentence has to change, and the decision memo says so (decision 3).

### 5.4 Model catalog

The composer's pills are fed by `companionModelOptions()` (`companion.ts:1243`) and reduced by `modelCatalogFromPayload` (`companion-client.ts:271`). A Pi harness builds the same shape from `createModels()`:

| Catalog field | Hermes | Pi |
|---|---|---|
| `providers[].slug` / `name` | gateway's provider rows | provider id / display name |
| `authenticated` | gateway's own flag | `checkProviderAuth` / `getAuthenticatedProviders` |
| `models[].id` | model ids | model ids from the registry |
| `reasoning`, `canDisableReasoning` | capability map | model metadata; default false when unknown |
| `fast` | capability map | false when unknown — never guessed |
| `current` | the profile's default | the operator's stored pick (the renderer already persists per-session picks) |

The rule to keep: **a field the harness cannot answer reads as "no control"**, because the composer hides a control it cannot honour. `modelChoiceFrom` already encodes that (`companion-client.ts:251-263`).

### 5.5 Instructions

`buildInstructions` (`companion-client.ts:581`) is one 90-line string built from a dozen branches, and every branch exists because of a reported failure: the receipt path rule, the `lifequest-decision` fence, the two averages, the live time window, the locked board. It is the most expensive thing in the app to regress.

It is also the only place that names the transport:

> "LifeQuest MCP server name is lifequest. Use it for map and task changes…" (`companion-client.ts:649-650`)

and it warns the agent never to re-pair itself through the doors.

**Plan:** split into a shared block plus a one-paragraph transport note per harness. The split is a **move, not a rewrite**:

```
harness/instructions/shared.ts   ← every line that is about the vault, the rules, the fence, the board
harness/instructions/hermes.ts   ← the MCP server name + "do not curl 127.0.0.1:8643/8646" paragraph
harness/instructions/pi.ts       ← "your tools are built in; there is no server name to pass"
```

Acceptance is not "it looks the same": the Hermes output must be **character-identical** before and after, and the existing rigs must pass unchanged. If they do not assert the instruction text, the assertion belongs in a rig, not in a unit test.

### 5.6 Approvals — the one genuine semantic mismatch

Hermes owns approval as a gateway concept: `POST /v1/runs/{id}/approval` (`companion.ts:1259`), a run id that survives across the wait, and a stream that ends on its own after a stop.

Pi has no approval concept at all. Its hooks are `beforeToolCall` (can block a call with a reason) and `execute` (can await). Blocking is not pausing: a blocked call is reported to the model as a denial and the turn continues. To reproduce "the operator decides, then the call happens", the pause has to live **inside the tool**:

```ts
// harness/approvals.ts
// `emit` is the ChatStreamEvent sink this run's chatStream() was given.
const pending = new Map<string, { resolve: (allow: boolean) => void; reject: (e: Error) => void }>();

export function askOperator(runId: string, summary: string, signal: AbortSignal): Promise<boolean> {
  const requestId = randomUUID();
  emit({ type: "approval.request", runId, requestId, summary });
  return new Promise<boolean>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    signal.addEventListener("abort", () => {
      pending.delete(requestId);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
```

Rules the implementation must hold:

- **Abort rejects every pending approval for that run.** A leaked promise is a turn that never settles and a dock stuck on "Approval required".
- **The renderer's deny path must always resolve.** `ChatPanel.tsx:1720-1740` already posts both allow and deny; the Pi harness must treat a dock unmount as a deny (the Hermes gateway does this on its own; an in-process promise does not).
- **A cap exists.** Hermes has no client-side timeout because the gateway owns the run; an embedded harness does. Propose 10 minutes, then `run.incomplete`.

### 5.7 Stop

Hermes: `POST /v1/runs/{id}/stop`, and the caller learns the turn is over from the stream (`companion.ts:1281-1293`). Pi: `agent.abort()`, then `run.stopped` from the aborted `agent_end`. The harness keeps `runId → AbortController`; an unknown run id is a no-op success, exactly as today.

## 6. What the seam must not pretend

| Difference | Why it cannot be hidden | What the seam does |
|---|---|---|
| **Cold start** | Hermes may spawn a host; Pi cannot | `ensure()` is async in both; the splash floor already covers it ([2026-10-17 spec](2026-10-17-cold-start-does-not-wait-on-the-companion-design.md), lines 96–107) |
| **Profiles** | Pi has no profile concept | `ProfiledHarness`; the picker renders only when `hasProfiles()` |
| **Status vocabulary** | The causes genuinely differ | Additive kinds; the harness supplies `statusMessage` and `describeReady` |
| **Approval timing** | Gateway round-trip vs in-process promise | §5.6, with an explicit cap |
| **Transcript ownership** | Hermes writes its own; Pi's host does | Both stay outside the vault; VISION changes, code does not |
| **Who acted** | The door hard-codes `name: "Hermes"` (`pairing-door.ts:63`) | The harness carries `displayName`; the door takes it as an argument |
| **Tool transport** | Hermes is an MCP client; Pi can be one or in-process | Both should use the existing door, so the write rules keep one home |
| **Personnel scan / Act planner** | They are Hermes-specific features, not harness contract | Out of v1; named here so a Pi-only mode is not declared early |

The **actor name** deserves emphasis because it is a truthfulness issue, not a plumbing one. Today every companion write is logged as `{ type: "agent", id: "companion", name: "Hermes" }` (`pairing-door.ts:63`, `map-tools.ts:58`). If Pi writes through the same door and the name stays, the vault's log answers "who changed this?" with the wrong agent. `VISION.md:26` says the product records who wrote each change, operator or agent; the seam should carry the name, and the door should stop hard-coding it.

## 7. Module layout

```
apps/desktop/electron/harness/
  types.ts             # ChatTurnRequest, SessionPatch, aliases
  agent-harness.ts     # AgentHarness, ProfiledHarness, hasProfiles
  registry.ts          # activeHarness(), selectHarness(), onChange
  hermes-harness.ts    # delegates to today's companion.ts internals
  instructions/
    shared.ts
    hermes.ts
  (later) pi-harness.ts
  (later) approvals.ts
```

`registry.ts` answers one harness for the process:

```ts
let active: AgentHarness | null = null;
export function activeHarness(): AgentHarness { /* HermesHarness by default */ }
export function selectHarness(id: HarnessId): void { /* future */ }
```

Selection is stored in `userData` beside the other app state, never in the vault. In v1 it always resolves to Hermes and the setting does not exist.

## 8. Migration

Five changes, each shippable on its own, each verified by the rigs already in the tree.

| # | Change | Touches | Proof |
|---|---|---|---|
| 1 | Move the wire types into `harness/types.ts`; add aliases | types only | `npm run typecheck`; no runtime diff |
| 2 | `AgentHarness` + `HermesHarness` + `registry`; `companion.ts` becomes a facade of delegating one-liners | `companion.ts`, new harness files | chat-chain, chat-sessions, composer-model-pills, tool-run, startup-boot pass unchanged |
| 3 | Move instruction building behind the harness (shared + transport paragraph) | `companion-client.ts`, `harness/instructions/*` | the same five rigs; instruction text asserted in a rig |
| 4 | Move `statusMessage`, `describeReady`, and `displayName` behind the harness; `pairing-door.ts` takes the name | `companion.ts`, `pairing-door.ts`, `map-tools.ts` | the same rigs, plus a vault-log assertion naming the agent |
| 5 | *(only if the decision memo says yes)* `PiHarness`, selection, Electron bump | new harness, packaging | a `harness-contract` rig with two columns (§9) |

Changes 1–4 change no behaviour. That is the acceptance criterion for the seam, and it is also why the seam is worth doing even if Pi is never built: today the Hermes path cannot be exercised without a spawn, a profile, and a port, and after change 2 it can be exercised through a fake harness.

## 9. Verification

Per `AGENTS.md`, E2E is the only testing mechanism, and the run must leave an artifact.

**Existing rigs (changes 1–4):** `chat-chain`, `chat-sessions`, `composer-model-pills`, `tool-run`, `startup-boot` must pass **unchanged**. A rig edited to accommodate the seam is a seam that changed behaviour.

**New: `e2e/harness-contract.electron.mjs`** — the same shape as `startup-boot` (throwaway world, stub CLI, fake host on a free port), driving the facade through one capability set:

| Leg | Asserts |
|---|---|
| `status` | one ready shape; `statusMessage` for every unavailable kind |
| `sessions` | list → create → messages → patch → delete, in order |
| `catalog` | providers and models reduce to a catalog the pills accept |
| `turn` | a streamed turn produces `run.started` → `assistant.delta` → `run.completed` |
| `approval` | request → allow, and request → deny |
| `stop` | stop mid-turn produces `run.stopped` and no `run.completed` |

It writes `e2e/artifacts/harness-contract-<id>.json`. `tests/harness-contract-e2e.test.ts` merges the legs and fails if any harness misses a capability. In v1 that is one column (Hermes against the fake host); adding Pi is adding a column, not a new rig.

**Restart discipline.** Changes 1–4 alter the Electron main process and nothing in the renderer. `npm run dev` rebundles main and preload and relaunches the app, so the verification runs against the restarted process — a rig pointed at a stale main bundle proves nothing.

## 10. Open questions

1. **Does the seam own `companionPrompts`?** Settings shows the assembled prompt. For Hermes it reads `SOUL.md` + instructions; for Pi there is no `SOUL.md`, only the harness's system prompt. Proposal: `prompts()` returns the harness's own three sections, and Settings renders whatever it gets.
2. **Does Personnel scan survive a second harness?** "Scan Hermes agents" has no Pi meaning. Either Personnel hides the scan when the harness is embedded, or it scans a Pi-side roster. Not decided; out of v1.
3. **Does the Act planner go through the seam?** It is an 8-round tool loop with its own system prompt (`map-tools.ts:60`). Either it becomes `harness.plan()`, or Act is Hermes-only. Not decided; out of v1.
4. **One seam or two?** `hermesChatWithTools` speaks OpenAI tool-calling directly. A second harness would want the same capability. Proposal: keep the planner's interface (`runPlannerLoop`) and give it a harness-supplied completion function, rather than a second seam.

## 11. Out of scope

- Implementing any step in §8.
- A second harness, selection UI, or packaged Pi.
- Changes to the IPC surface, preload, or renderer visuals.
- The Electron upgrade, the installer, or auto-update.
- Changes to the MCP doors or the vault layout.

## 12. Self-review checklist

| Check | Result |
|---|---|
| One contract | §4 is the whole interface; every method has a caller in §3.2 or is marked new (`describeReady`) |
| Renderer diff in v1 | None — §4's facade keeps the exports and §5.1 defers the status change |
| Differences named, not hidden | §6, including the actor-name truthfulness issue and the two uncovered callers |
| Each step reversible | §8; changes 1–4 change no behaviour |
| Verification is E2E and repeatable | §9, with an artifact path and an explicit restart rule |
| Citations resolve | Every `file:line` re-verified against commit `833f971` at write time |
| Ambiguity | The uncovered callers (Personnel scan, Act planner) are called out rather than assumed |

## 13. As implemented

Departures from the design above, and why:

| Design said | Landed | Why |
|---|---|---|
| Session reset effect in `ChatPanel` | Reset in `ChatSessionsProvider` | Master moved the dock's chats into that store before this branch merged; the panel no longer owns them. |
| Picker in the dock list header | The dock's **thread header**, after a hairline, plus a `Companion` section in Settings | The chat list moved to the sidebar after this design was written; the thread header is the surface that is always on screen while chatting. The three chat controls that used to sit there (pin, rename, archive) moved to the tab and row menus. |
| Move types into `harness/types.ts` | Types re-exported; `CompanionStatus` aliases to `HarnessStatus` | Zero churn in 17 channels and the panel; a rename can follow when nothing else is moving. |
| `statusMessage` per harness | Same, plus `detail` on the ready status | The renderer formats no transport field; a built-in companion has no port to print. |
| Unhydrated default "pi" | **"hermes"** | Direct callers that never boot main (rigs, harness pages) were written against the external companion; the boot path is what decides. |
| `beforeToolCall` policy | Not used yet | The only tools registered are the MCP door's, so there is nothing to block that the door would not block itself. |
