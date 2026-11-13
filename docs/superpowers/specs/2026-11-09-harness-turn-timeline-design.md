# Design: a harness-neutral turn timeline (the dock's work log)

**Date:** 2026-11-09
**Status:** Implemented — Phases 1–4 and the E2E rigs are built on `feat/turn-timeline`; see §12.1 for what the rigs proved. Phase 5 remains optional.
**Product:** LifeQuest — local-first life-management studio
**Answers:** *Can the dock give the same "agent visibly working — tool calls across lines, updates along the way, a recap at the end" experience for Pi and Hermes? Where do the two genuinely differ, and how much of the experience can live on our side so future harnesses degrade instead of fork?*
**Depends on:** [The agent harness seam](./2026-10-21-agent-harness-seam-design.md), [Pi as a built-in companion](./2026-10-21-pi-companion-decision.md)
**Audited:** Pi packages `1.3.0` (`@earendil-works/pi-agent-core`, `pi-ai`, `pi-mcp`); Hermes Agent `0.22.5` (`/usr/local/lib/hermes-agent`, commit `bf0203a794a0`); DSH `0.2.1-rc.2` shipped client packages. Capability claims below are verified against those installs, not against vendor docs.

---

## 0. The short answer

**Yes, both harnesses can deliver the experience — but not at equal fidelity, and the gap is narrower than it looks.**

- **Pi** can supply everything the experience needs: per-call ids, raw args at dispatch, live partial tool results, result content, error, duration, real reasoning deltas, per-step boundaries, usage, stop reason. Today `chatStream()` throws almost all of it away (`pi-harness.ts:561-656`).
- **Hermes 0.22.5** already puts most of what we need on the wire for dock turns — tool args, tool completion/failure, mid-turn commentary, lossy thinking, terminal usage, and the full per-turn transcript including tool calls and results. LifeQuest's SSE mapper currently discards it (`companion-client.ts:1140-1232`).
- **What Hermes cannot give today** (dock's route): a tool-call id, a live result preview, a live duration, true reasoning deltas, live step boundaries, live plans, and stream resumability. Each is either a one-function gateway projection change (the core already produces the data) or genuinely upstream.
- Therefore: **Pi = "Full" tier; Hermes = "Standard+" tier.** The core experience — multi-line tool rows, a live status line, interleaved commentary, folded process, authoritative final answer, a synthesized recap/footer, tool rows in history — is achievable for both **with app-side work only**. Hermes' deltas are fidelity details that the UI hides honestly rather than fakes.
- **The version of the experience is ours, not the harness's.** Everything visual, every summary sentence, every fold rule, every tool vocabulary entry, the live clock, the recap and the history replay are app-owned. A harness supplies raw facts plus a capability descriptor; it never supplies markup, titles, counts, summaries, durations or usage it does not have. New harnesses are required to meet a small floor, and the floor still renders a coherent work log.

The rest of this document is the how.

---

## 1. The problem

The dock currently renders a turn as:

1. a stream of assistant text collapsed into **one bubble per run** (`ChatSessionsProvider.tsx:1390-1410`);
2. one flat, per-chat list of tool calls (`SessionRun.tools`, `:84-99`) accumulated by name only (`:1412-1432`);
3. drawn as **one grey summary line** plus an optional list, **after all bubbles** (`ChatPanel.tsx:2060-2091`, `tool-run.ts:118-146`);
4. with no per-call outcome, timing, args or result (`tool-run.ts:19-23`);
5. and **nothing survives a reload** — both harness projections keep only `{role, content, at}` (`companion-client.ts:643-682`, `pi-harness.ts:344-356`), though both harnesses store the tool evidence in full.

So the dock shows *that* the agent used tools, but not *what it did, in what order, how each step went, or what it concluded*. The PO's reference experience — DSH — is the opposite: every turn is a readable work log that folds into a recap when it finishes.

The seam makes this fixable once, not twice: the renderer already speaks one harness-neutral event union, and one main-process choke point sees every turn of every harness (`vault-service.ts:1940-2026`).

---

## 2. The reference experience (what DSH actually does)

From the shipped DSH client packages (see appendix for paths). The anatomy that matters:

1. **Event-sourced, client-presented.** The host writes durable session events (`turn/start`, `step/start`, `assistant/message`, `tool/call{callId,name,arguments}`, `tool/result{message,error?,meta?}`, `turn/end`); the client renders from that log. Tool titles, summaries, paths, sizes, diff totals and counts are **100 % client-derived** from raw args + result; the web client explicitly ignores tool-authored presentation (`dsh-tools/README.md` "Host presentation descriptors").
2. **Turn = a work log with a conclusion.** While running: a shimmering status line ("Deep diving for 1.2s"), then a process group of reasoning rows, tool rows and intermediate assistant prose. The final assistant message is the answer and is **never folded**. When the turn closes, the process folds to a header such as "Completed in 12s" plus a synthesized group title ("Read files and searched code, etc."); the footer carries copy/usage actions, and a token-usage row appears when accounting is exact.
3. **Tool rows have three stages under one id:** preparing (name known, args streaming) → dispatched (args complete) → result (content, error, meta, duration). Row = icon + client-mapped title + " · " + bounded summary derived from a variant-specific args key; expanded shows IN (args) and OUT (result, bounded, type-specific).
4. **Groups, not a flat list.** Contiguous process nodes form groups; a reply-bearing assistant message splits the group and is emitted as a response outside it. The closed group title is a ranked activity summary (edit/read/search/run/delegate), first-letter-lowercased continuations joined with commas, ", etc." when there are more.
5. **The recap is synthesized, never model-written.** There is no recap event/string anywhere in the shipped packages: recap = closed-group title + "Completed in …" header + footer actions/usage, and the answer is the last assistant message. This is the most important thing to copy: **we do not need another LLM call to recap.**
6. **Live vs durable are two paths, one renderer.** Transient deltas drive the live view; durable events settle it. History is rebuilt from the durable log, so a reloaded turn looks like the settled turn, not like a replay of typing.

Two DSH quirks **not** worth copying: its slot/plugin registry, and the four display modes. LifeQuest's dock is one narrow column with one operator; a single honest fold behavior is better than a settings matrix. (We keep the door open for a "keep work visible" switch later — §12, phase 5.)

---

## 3. The design in one picture

```
harness adapter (Pi / Hermes / future)
   │  raw facts only: name, args, result, status, reasoning, commentary, usage, transcript
   ▼
HarnessEvent stream  ──►  main choke point (vault-service.ts)
   │                         ├─ coalesces deltas (~50 ms)
   │                         ├─ app-derived fields: timestamps, wall-clock durations,
   │                         │  category, bounded target, redaction
   │                         └─ app frames after the turn: decisions.filed / .problem
   ▼
ChatSessionsProvider reducer
   └─ per-session TurnRecord (live) + settled turns
        ▼
TurnTimeline components (ChatPanel)
   ├─ TurnStatusLine      live: "Working… 4s · reading Daily note" (shimmer)
   ├─ TurnProcess         foldable group: reasoning rows, tool rows, commentary
   ├─ TurnAnswer          final assistant text, never folded
   └─ TurnFooter          "Completed · 1m 12s · 14.2k tokens"; notes; actions
```

History uses the same record shape built from the harness transcript by the same pure builder, so live and reloaded turns render through one component.

---

## 4. The record

The renderer's unit is a **turn**, not a message.

```ts
// src/lib/turn-timeline.ts — pure, shared by live reducer and history builder.
export type TurnStatus = "running" | "completed" | "stopped" | "failed" | "incomplete";

export type TurnBlock =
  | { kind: "reasoning"; id: string; text: string; at?: number }
  | { kind: "text"; id: string; text: string; at?: number }        // intermediate narration
  | { kind: "commentary"; id: string; text: string; at?: number }  // harness commentary event
  | { kind: "tools"; id: string; calls: ToolCallRecord[] };

export type ToolCallRecord = {
  /** Stable within the turn. Pi: native toolCallId. Hermes: app-minted, name+order. */
  id: string;
  name: string;
  /** One bounded line, app-derived (companion-client.ts:1082-1138 rules). */
  target: string;
  /** App-derived from the tool vocabulary (tool-run.ts), for the row icon/verb. */
  category: ToolCategory;
  /** Raw or display args, bounded; optional because a floor harness has none. */
  args?: unknown;
  status: "running" | "completed" | "failed" | "unknown";
  startedAt: number;                 // app receipt time, always available
  endedAt?: number;
  durationMs?: number;               // harness value when supplied, else endedAt-startedAt
  /** Bounded, redacted result text for the row disclosure; absent when the harness has none. */
  resultPreview?: string;
};

export type TurnRecord = {
  turnId: string;                    // run id for live turns; `${sessionId}:${index}` for history
  sessionId: string;
  harness: HarnessId;
  status: TurnStatus;
  startedAt: number;
  endedAt?: number;
  /** Ordered process blocks; the final answer is TurnRecord.answer, not a block. */
  blocks: TurnBlock[];
  /** The authoritative final assistant text. Never empty for a completed turn that replied. */
  answer: string;
  /** "assistant.final" arrived or the transcript snapshot settled this turn. */
  settled: boolean;
  usage?: { input?: number; output?: number; total?: number };
  stopReason?: string;
  /** App-generated notes: decisions filed, stop reason, capability caveats. */
  notes: TurnNote[];
};

export type TurnNote = {
  kind: "filed" | "stopped" | "incomplete" | "error" | "caveat";
  text: string;
};
```

`buildTurnTimeline(entries: TranscriptEntry[]): TurnRecord[]` is the single pure function that turns a harness transcript into turns. It is used by:

- **live settlement** (terminal frame's optional snapshot), and
- **history load** (`companionSessionMessages`).

One builder means a reloaded turn and a just-finished turn are the same component fed by the same data. That is DSH's live-vs-durable split without a second store.

### 4.1 Transcript entries (history source)

Extend the transcript projection — not the persistence. Both harnesses already store everything needed:

```ts
export type TranscriptEntry = {
  role: "user" | "assistant" | "tool";
  content: string;
  at?: number;
  /** Assistant rows: the calls this message requested. */
  toolCalls?: { id: string; name: string; args?: unknown }[];
  /** Tool rows: which call this answers. */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  reasoning?: string;
  usage?: { input?: number; output?: number; total?: number };
};
```

| | Pi | Hermes 0.22.5 |
|---|---|---|
| source | `pi-sessions` JSON (`pi-sessions.ts:13-29`) stores full `AgentMessage[]`: assistant blocks `text|thinking|toolCall`, `toolResult` messages, usage, timestamps, durations | `GET /api/sessions/{id}/messages` returns assistant rows with `tool_calls[]` and `role:"tool"` rows (`api_server.py:2969-2977,3224-3255`) |
| app work | extend `projectTranscript()` (`pi-harness.ts:344-356`) to map blocks and results instead of text only | extend `messagesFromPayload()` (`companion-client.ts:669-682`) to keep tool rows and tool_calls instead of dropping them |
| fidelity | full: ids, args, results, isError, per-message usage, durations | high: ids, args, results, error flag from row shape; no per-call duration column (app derives from row timestamps or omits) |
| cost | zero new persistence | zero new persistence |

**Rejected alternative:** an app-side append-only turn ledger in `userData`. It would duplicate harness-owned transcripts, add a staleness/migration surface, and buy nothing the projections above cannot give. If replay ever gets slow, a cache can be added behind the same builder; it is not the design.

---

## 5. The wire

Extend the harness stream union (`companion-client.ts:296-309`, mirrored in `vite-env.d.ts:239-253`) **additively**. Nothing existing changes meaning; old frames still work.

```ts
type ChatStreamEvent =
  // …existing members unchanged…
  | { type: "reasoning.delta"; text: string }
  | { type: "assistant.commentary"; text: string; alreadyStreamed?: boolean }
  | { type: "assistant.final"; text: string }
  | { type: "tool.started"; name: string; target: string; callId?: string; args?: unknown }
  | { type: "tool.progress"; callId: string; text: string }
  | { type: "tool.completed"; name: string; callId?: string; isError?: boolean;
      durationMs?: number; resultPreview?: string }
  | { type: "usage"; usage: TurnUsage }
  /** Terminal frames stay the existing run.* names, extended additively:
      turn identity is the run id, so no separate turn.end is introduced. */
  | { type: "run.stopped"; usage?: TurnUsage; snapshot?: TranscriptEntry[] }
  | { type: "run.incomplete"; reason: string; usage?: TurnUsage; snapshot?: TranscriptEntry[] }
  | { type: "run.completed"; usage?: TurnUsage; stopReason?: string; snapshot?: TranscriptEntry[] };
```

Rules:

1. **`tool.completed` may arrive with only `name`.** The app mints/keeps an id, pairs FIFO per name when the harness has no id, and marks the row complete. This is today's behavior, kept as the floor.
2. **`tool.progress` is optional and bounded**; it only changes a row's secondary text. Unknown progress must never block the row.
3. **`assistant.final` is the answer of record.** If absent, the last text block is the answer; if a snapshot is present, its last assistant text wins. This kills the Hermes "no deltas ⇒ empty bubble" case (`assistant.completed.content` is on the wire today).
4. **A terminal frame is final, once.** The app must not synthesize `run.completed` on socket close after a terminal frame — today it always does (`companion.ts:1390-1392`), so a dead stream reads as a finished turn. `done`/close without a terminal frame ⇒ `run.incomplete{reason}`.
5. **Deltas are coalesced in main** before crossing IPC. Pi emits a delta per token; one IPC frame per token is waste. Batch to one frame per ~50 ms or 4 KB, flush before every tool/turn event.
6. **Nothing unbounded crosses the wire.** Args and result previews are bounded (target ≤ 48 chars as today; args ≤ 2 KB; result preview ≤ 500 chars) and secret-redacted before bounding. Hermes already redacts display args; Pi args are raw and must be treated as untrusted.
7. **App frames keep their own vocabulary.** `decisions.filed` / `decisions.problem` become `TurnNote`s on the current turn, not the single contested `turnNote` string.

*Implemented:* the wire in `companion-client.ts` keeps the existing `run.*` terminal names and adds `usage`/`snapshot`/`stopReason` to them, so no consumer that predates this design breaks; the record's `TurnStatus` is derived from which terminal frame arrived. `TranscriptEntry` ships as the structured form of the existing `TranscriptMessage` type (same name, extra optional fields), so history projections and E2E stubs that know only `{role, content, at}` keep compiling and parsing.

### 5.1 Pi adapter mapping

| Pi source (`AgentEvent` / `AssistantMessageEvent`) | Emitted |
|---|---|
| before `prompt()` | `run.started{runId}` (turn opens) |
| `message_update → thinking_delta` | `reasoning.delta` |
| `message_update → text_delta` | `assistant.delta` |
| `turn_start` / `message_start` | step boundary (renderer closes the open text block) |
| `tool_execution_start{callId,name,args}` | `tool.started{callId,name,target,args}` |
| `tool_execution_update{partialResult}` | `tool.progress{callId,text}` (when the wrapper forwards it) |
| `tool_execution_end{callId,name,result,isError,durationMs}` | `tool.completed{…,resultPreview}` |
| final assistant message text | `assistant.final` |
| terminal usage from assistant messages | `usage` |
| `agent_end` + `stopReason` | `turn.end{status,stopReason,usage,snapshot}`; `error|length` ⇒ `failed`/`incomplete`, **not** `run.completed` |
| `abort` | `turn.end{status:"stopped"}` |

The Pi harness must also stop emitting `run.completed` for `stopReason:"error"|"length"` (`pi-harness.ts:652-654` — an existing honesty bug).

### 5.2 Hermes adapter mapping (session chat stream — the dock's actual route)

The dock uses `POST /api/sessions/{id}/chat/stream`, **not** `/v1/runs/{id}/events` (`companion.ts:1366`). Its frames and what we do with them:

| SSE event | Payload we use | Emitted |
|---|---|---|
| `run.started` | `run_id`, `runtime` | `run.started` |
| `message.started` | — | turn already open |
| `assistant.delta` | `delta` | `assistant.delta` (coalesced) |
| `tool.progress` | `tool_name:"_thinking"`, `delta` | `reasoning.delta` (labelled lossy in the descriptor) |
| `tool.started` | `tool_name`, `preview`, `args` | `tool.started{name,target,args}`, app mints id |
| `tool.completed` | `tool_name` | `tool.completed{name}` |
| `tool.failed` | `tool_name` | `tool.completed{name,isError:true}` (currently **dropped** — a failed row never closes) |
| `assistant.commentary` | `text`, `already_streamed` | `assistant.commentary` (currently **dropped**) |
| `approval.request` | existing | unchanged mapping; the approval POST body is broken app-side (§10) |
| `assistant.completed` | `content`, `completed`, `partial`, `interrupted` | `assistant.final` (currently **dropped**) |
| `run.completed|failed|cancelled` | `messages` (full assistant/tool rows), `usage`, `runtime`, flags | `turn.end{status,usage,snapshot}` (currently **dropped**) |
| `error` | `message` | `error` |
| `done` | — | terminal barrier; no synthetic completion after it |

App-side rules for Hermes:

- **No call id on this route.** Mint one at `tool.started`; pair completions FIFO per name. Ambiguity is possible only for concurrent same-name calls; the row still closes, and the terminal snapshot repairs pairing.
- **No live duration/result.** Start the app clock at `tool.started`; on completion show the app-measured duration (labelled "approx" only in settings/docs, not UI). Results appear when the terminal snapshot lands, because `run.<status>.messages` carries them — so a finished Hermes turn shows result disclosures; live it shows args + status.
- **No live step boundaries.** Split assistant text at tool boundaries app-side; the snapshot gives the true segments after the turn.
- **Terminal snapshot is the ground truth.** Reconcile, do not replace: pair snapshot calls to live rows by (id where available, else name+order), fill args/results/isError, set the final answer, keep live commentary blocks.

### 5.3 What the snapshot does on settle

At `turn.end` with `snapshot`:

1. `answer` := last assistant text in snapshot (or `assistant.final`);
2. each live tool row gets the matching snapshot tool row's `args`/result/error;
3. snapshot tool rows with no live counterpart are appended in order (missed events, reconnects);
4. live commentary blocks are retained (they are not in the durable transcript);
5. `status`/`usage` := terminal payload;
6. `settled := true`.

If no snapshot (floor harness), the live record is settled as-is; unavailable fields remain absent rather than guessed.

---

## 6. The renderer

New components under `src/components/hermes/` (or a new `turn/` folder):

- **`TurnTimeline`** — renders the session as user bubbles and `TurnRecord`s in order.
- **`TurnProcess`** — the foldable work log; header + body.
- **`ToolRunGroup`** — contiguous calls collapsed into one header ("Read 3 files, ran 1 command"), rows beneath.
- **`ToolRow`** — icon, verb + target, spinner/✓/!, duration, disclosure (IN args / OUT result).
- **`TurnStatusLine`** — live only: shimmer text + elapsed + current activity.
- **`TurnFooter`** — status, duration, usage (only if exact), notes, copy action.

### 6.1 While the turn runs

- Status line at the bottom of the flow: `Working… 4s · reading Daily note` — the app copy, not DSH's "Deep diving"; one shimmer, reduced-motion aware.
- The process body is open. Reasoning row collapsed to one line (`Thought for 6s · first line preview`) once reasoning ends; streaming preview shimmers.
- Tool rows appear at `tool.started` with a spinner and the app-derived verb/target; `tool.completed` flips to a check or error mark and shows duration.
- Assistant text that arrives between tools is a **narration block inside the process**, not part of the final answer. The renderer closes the open text block on the next tool/step event; the next text delta opens a new one.
- The composer stays as it is; stop/steer/approval behavior is unchanged.

### 6.2 When the turn closes

- The final text block becomes `answer`, rendered outside the process and **never folded**.
- Mood/action rows: the process folds to a single header:
  `Worked for 1m 12s · Read 3 files, ran 2 commands, edited 1 file` with a chevron.
  Duration comes from `startedAt|endedAt` (app clock if the harness has no duration). Activity summary is synthesized from completed calls by category, using the existing `toolCategory`/`summarizeToolRun` vocabulary extended with the vault door's tool names; failed calls are excluded from "did" claims and counted separately ("1 failed").
- Fold rules: fold on completion by default; **never fold** a stopped, failed, incomplete, or still-running turn; never fold the answer. The fold is a disclosure the operator can reopen; state is per turn, per session (not one global `toolsOpen`).
- Footer: `Completed · 1m 12s · 14.2k tokens` (usage only when present and exact; otherwise omit — never estimate), plus notes:
  - `Filed 2 proposals — review them in Decisions.` (from the app's own `decisions.filed`, the only side-effect claim we make);
  - `Stopped after 42s — the reply above is only what arrived before the interrupt.`;
  - `Ended before finishing — <reason>.` / `Failed — <reason>.`
- The answer's copy/timestamp actions stay.

### 6.3 Recap: what it is and is not

The recap is **app-synthesized**: fold header (duration + activity) + footer (status, usage, notes) + the final answer. No extra model call, no invented prose. This is precisely DSH's construction (§2.5 above: a recap is not model-generated). If the product later wants a prose summary of *what changed*, that must be a deliberate second model call with its own cost/latency and is out of scope here.

### 6.4 Scroll/accessibility

Keep the existing stick-to-bottom effect (`ChatPanel.tsx:731-738`), extended to follow an open process group's own capped scrollport; opening a group does not yank the outer transcript. Rows are in a `role="log"`/`aria-live="polite"` region (one announcement per settled turn, not per token). Reduced motion: no shimmer sweep, no fold animation.

---

## 7. Capability descriptors and the degradation ladder

The renderer never branches on `harness === "pi"`. Each harness publishes a descriptor with its picker summary:

```ts
// electron/harness/types.ts — on HarnessSummary (types.ts:109-118; registry.ts:130-154)
export type TurnCapabilities = {
  toolRows: boolean;          // floor: tool.started/tool.completed events exist
  toolArgs: boolean;
  toolCallIds: boolean;
  toolResultsLive: boolean;   // result text available during the turn
  toolResultsOnSettle: boolean; // via terminal snapshot
  toolDurations: boolean;     // harness-measured; otherwise app clock
  toolProgress: boolean;      // partial updates
  reasoning: boolean;         // true deltas (Hermes: lossy preview; descriptor says "preview")
  reasoningFidelity: "delta" | "preview" | "none";
  commentary: boolean;
  steps: boolean;
  usage: boolean;
  history: boolean;           // transcript can rebuild tool rows
  approvals: boolean;
  steering: boolean;
};
```

| | Pi | Hermes 0.22.5 | Floor harness |
|---|---|---|---|
| toolRows | ✅ | ✅ | must ✅ |
| toolArgs | ✅ raw | ✅ display args | — |
| toolCallIds | ✅ | ❌ app-minted | — |
| toolResultsLive | ✅ | ❌ | ❌ |
| toolResultsOnSettle | ✅ | ✅ (`run.*.messages`) | — |
| toolDurations | ✅ native | ❌ app clock | app clock |
| toolProgress | ✅ (`onUpdate`) | ❌ | ❌ |
| reasoning | ✅ deltas | ⚠️ lossy preview (`tool.progress/_thinking`) | ❌ |
| commentary | ✅ (message segments) | ⚠️ only when runtime emits (`assistant.commentary`) | ❌ |
| steps | ✅ `turn_*` | ⚠️ inferred from tools | — |
| usage | ✅ per message | ⚠️ terminal only (input/output/total, cache when counted) | — |
| history tool rows | ✅ | ✅ | optional |
| approvals | ✅ buildable (`beforeToolCall`; stub today) | ✅ (fix request body, below) | optional |
| steering | ✅ queue API | ✅ endpoint | optional |

The ladder:

1. **Full (Pi):** everything above.
2. **Standard+ (Hermes):** identical layout; live rows have args+direction, no live result/duration; reasoning shown as a short "thinking preview" row labelled as such; results/disclosures appear when the turn settles; usage only at the end.
3. **Standard (floor):** `run.started`, `assistant.delta`, `tool.started{name,target?}`, `tool.completed{name}`, terminal. Rows still appear at the right times, get app durations and the app activity summary; no args/result/reasoning/usage; history renders bubbles only. **This is today's contract plus turn grouping — every existing harness already meets it.**
4. **Minimal:** text deltas and a terminal only. One answer bubble + "Completed in 12s". No tool section, no dead affordances.

Degradation is by **omission**, never by placeholder: no empty "0 tokens", no "unknown" result disclosure, no shimmer for a harness that emits step-sized bursts (the status line shows received activity instead).

---

## 8. Can both harnesses deliver it? (direct answer, with the precise differences)

**The experience: yes. The fidelity: Pi wins, Hermes is close, and the difference is contained to five facts.**

| Experience element | Pi | Hermes 0.22.5 | Difference the operator would notice |
|---|---|---|---|
| Multi-line tool rows, live, with verb+target | ✅ | ✅ | none (both name a target; Hermes args are display-redacted) |
| Rows flip to done / failed | ✅ exact id | ✅ by name/order; `tool.failed` currently dropped ⇒ must map | concurrent same-name calls can mispair live; fixed on settle |
| Per-call duration | ✅ native | ⚠️ app-measured | Hermes durations are receipt-to-receipt, not dispatch |
| Live result preview in the row | ✅ | ❌ | Hermes disclosure appears when the turn settles |
| Reasoning / thinking row | ✅ true deltas (if endpoint streams) | ⚠️ ≤500-char preview derived from model text | Hermes "thought" is a preview, labelled as such |
| Mid-turn updates / narration | ✅ text between steps | ⚠️ commentary only when the runtime emits it; otherwise only tool boundaries | Hermes may show fewer narration lines |
| Real step boundaries | ✅ | ⚠️ inferred | step separators cosmetic; not shown as authoritative |
| Token usage | ✅ per message | ⚠️ terminal only | Hermes usage appears only on the settled footer |
| Final answer authority | ✅ final message | ✅ `assistant.completed.content` / terminal snapshot | none |
| Folded recap + footer | ✅ app-synthesized | ✅ app-synthesized | none |
| Tool rows in history | ✅ | ✅ via messages API (app projection) | none, once projection lands |
| Approvals | buildable, not wired | on wire, app posts wrong body today | Hermes approval is currently broken app-side (fix) |
| Stream resumability | n/a in-process | ❌ a dropped socket interrupts the turn | Hermes turns can be lost on network blips |

**What Hermes would need to close the gap** (each verified as "inputs already produced, discarded at one projection function"):

1. `tool_call_id`, `duration`, `is_error`, bounded redacted `result` preview on `tool.completed`, and `tool_call_id` on `tool.started` (`api_server.py:3612-3620` discards kwargs the executor passes at `tool_executor.py:1180-1182`).
2. Forward the assistant-segment boundary the core already emits (`None` sentinel, documented in `acp_adapter/events.py:224-234`) instead of dropping falsy deltas.
3. Pass `reasoning_callback` and `status_callback` (as the OpenAI-compatible routes already do) for real reasoning deltas and provider-wait status.
4. Add `error` to `run.failed` and forward subagent progress.
5. Live steps/plans and stream resumability genuinely need upstream work (WS-viewer already has `agent.step`/`todo.updated`; the HTTP session route does not).

None of these are required for the design to ship; they are fidelity upgrades we can request upstream with evidence, and the descriptor makes each one a one-line UI upgrade when it lands. **This is the answer to "what are the different experiences": Hermes gets the same script with the last 10 % of the evidence missing, and the UI says so by omission instead of inventing it.**

---

## 9. Future harnesses: the floor contract and the integration checklist

Because the experience is app-owned, adding a harness is mostly a projection job. The integration contract:

**Mandatory (the floor):**

1. `run.started` before the first assistant text; a stable run id.
2. `assistant.delta` for assistant text (chunked or whole, in order).
3. `tool.started {name, target?}` and `tool.completed {name, isError?}` **if the harness has tools**; if it cannot say, the adapter says `toolRows:false` and the UI shows no tool section.
4. One terminal event with a status (`completed|stopped|failed|incomplete`).
5. Monotone timestamps (or the adapter stamps receipt times).

**Optional, in value order:** call ids → args → results → durations → reasoning → commentary → steps → usage → transcript replay → approvals/steering/plans.

**Checklist for a new adapter:**

- [ ] Implement `chatStream` → emit the floor frames in order; never emit `run.completed` for a failed/partial turn.
- [ ] Implement transcript projection to `TranscriptEntry[]`; run `buildTurnTimeline` against it and compare with a live turn of the same script (goal: live-settled == history).
- [ ] Declare `TurnCapabilities` honestly; the UI must never show an affordance it cannot honour.
- [ ] Bound and redact args/results before emitting; cap frames.
- [ ] Add one column to the `turn-timeline` rig (same script, same assertions, expected capability row) — adding a harness is adding a column, not a rig.
- [ ] Name it in the picker; the switcher already renders unknown icons by initial.

**ACP watch item.** Hermes 0.22.5 ships `hermes acp` (Agent Client Protocol, stdio), and DSH runs on ACP; ACP has a richer tool lifecycle (call ids, titles, kinds, statuses, diffs, locations, raw output, plan updates). It is *not* a shortcut for the dock: it is stdio with one client per child process, needs its own ACP client in Electron main, has no pin/archive/profile surface, and LifeQuest's existing gateway-attach model is HTTP. Adopting it would be a transport decision, not a rendering one. Recommendation: **keep the internal `TurnRecord` shaped so an ACP bridge is a mapper, not a rewrite** (the §4 record already is), and revisit ACP only if we want Hermes-managed editor-style sessions or a second harness that speaks only ACP. Pi has no ACP adapter (native events are richer anyway).

---

## 10. Honesty and safety rules (non-negotiable)

1. **No invented evidence.** No estimated token counts, no synthesized durations for a harness that did not time the call (app clock is measured, not estimated, and is only used when start and end were both observed), no "read 3 files" from a call that failed, no model-authored recap presented as system truth.
2. **Side effects are stated only by the app.** `decisions.filed` is the app's own receipt and can be shown as fact; the model saying "I filed it" is not.
3. **Failed turns must not read as complete.** `stopReason:error|length` (Pi) and `run.failed`/`run.cancelled`/error frames (Hermes) map to failed/stopped/incomplete; socket close without a terminal frame is incomplete, never completed.
4. **Bounded and redacted.** Args ≤ 2 KB, result preview ≤ 500 chars, target ≤ 48 chars, all redacted before truncation; nothing unbounded is persisted or logged. Pi tool args are raw model output and untrusted.
5. **No new storage of secrets.** The timeline is display state; transcripts remain the harness's. History is a projection, not a copy.
6. **The UI never guesses a capability.** Missing descriptor field ⇒ feature hidden.

Adjacent defects found by the audit, fixed in the same workstream because the timeline surfaces them:

- Hermes approval posts `{request_id, allow}` (`companion.ts:1432-1434`) while 0.22.5 requires `choice ∈ once|session|always|deny` — the dock's approvals 400 today.
- `companionChatStream` emits synthetic `run.completed` on every socket close (`companion.ts:1390-1392`).
- Pi emits `run.completed` for `stopReason:"error"|"length"` (`pi-harness.ts:652-654`).
- `run.tools` never resets on `run.started` (`ChatSessionsProvider.tsx:1373-1389`) and survives `run.completed` and history load.

---

## 11. Migration plan

Each phase is shippable, reversible, and verified by E2E with an artifact. No phase changes the model context, prompts, or vault writes.

### Phase 1 — wire (no visible change)

- Extend `ChatStreamEvent` additively (§5) + renderer mirror (`vite-env.d.ts`).
- Pi adapter: forward ids/args/results/status/durations/reasoning; emit final/usage/turn.end + snapshot; fix stop-reason mapping; coalesce deltas.
- Hermes `mapStreamEvent`: map `tool.failed`, `tool.progress`, `assistant.commentary`, `assistant.completed`, terminal `messages`/`usage`; mint ids; stop synthesizing completion after a terminal frame; fix approval body.
- Main choke point: delta coalescing, app timestamps, bounding/redaction.
- Proof: extend the existing chat/fake-harness rigs to assert the new frames; no renderer change.

### Phase 2 — live turn renderer

- `turn-timeline.ts` pure builder + reducer in `ChatSessionsProvider` (`SessionRun` gains `timeline: TurnRecord[]`, `liveTurnId`; `tools` retired).
- New components + CSS; replace the activity block (`ChatPanel.tsx:2049-2097`, CSS `global.css:7755-7845`).
- Fold rules, status line, footer, notes; per-turn disclosure state.
- Proof: new `turn-timeline` E2E rig (see §12).

### Phase 3 — history replay

- `TranscriptEntry` projection in both adapters; IPC returns entries; `buildTurnTimeline` on load.
- Rendering unchanged (same components); old chats without tool rows render as Standard/floor turns.
- Proof: rig gains a reload leg: reload the page, assert the settled turn looks identical (same rows, same fold, same footer), and that a transcript with no tool evidence degrades to bubbles.

### Phase 4 — capabilities and the floor

- `TurnCapabilities` on `HarnessSummary`; registry literals for Pi/Hermes; renderer omissions.
- A fake "floor" harness in the rig proving the minimal contract renders coherently.
- Docs: integration checklist (§9) in the harness seam spec.

### Phase 5 — optional

- "Keep work visible" setting (DSH's verbose, one switch — not four modes).
- Pi: wrap vault tools to emit bounded `details` + heartbeat `onUpdate` (door has no MCP progress); wire `beforeToolCall` approvals.
- Hermes upstream ask: the five fidelity items in §8.
- Plan/todos pane if a harness ever exposes one (`todo.updated` on the WS path could be projected later).

Rough shape: Phase 1 ≈ 250–350 lines across 6 files; Phase 2 ≈ 500–700 lines across 8 files (mostly new); Phase 3 ≈ 150–250 lines; Phase 4 ≈ 100–150 lines; each phase one worktree.

---

## 12. Verification

Repo rule: E2E only, and every run leaves an artifact. Nothing in this design is verified by unit tests.

1. **`turn-timeline` rig (built).** `e2e/turn-timeline.electron.mjs` drives the real ChatPanel over `e2e/chat-panel.html`, feeding **raw Hermes 0.22.5 SSE blocks** through the app's own `parseSseBlock` via the page's `__lqEmitSseFor` handle. Six scripted turns, 37 frames, four page loads (default, `?caps=hermes`, `?caps=floor`, `?history=timeline&caps=full`), 46 named checks covering live rows/status/elaboration, settled folding and footer/usage, per-turn fold independence, stream death (`run.failed`), stopped turns, history rebuild from a structured transcript with no stream frames, capability omission for Hermes and floor descriptors, and the no-invented-evidence rules. Artifact: `e2e/artifacts/turn-timeline.json` plus six 1280×900 PNGs. Registered in `tests/chat-panel-e2e.test.ts` like `tool-run`: asserts artifact exists, `pass`, `failures === []`, exit 0, and restates the counts.
2. **Real Pi leg (built).** `e2e/pi-companion.electron.mjs` gained a second scripted turn whose fake OpenAI endpoint inspects the advertised tools and calls a real read-only vault tool (`get_database` with a uuid produced by a real `dbCreate`), then answers with a second completion. 27 named checks assert genuine `pi-harness` frames produce the row (name, target, native duration, done state), the fold header, the answer outside the process, the footer's summed usage, and the same row/fold/answer after a reload; `report.tool.reloadParity.usageVsLive.totalsMatch` is true. Artifacts: `e2e/artifacts/pi-companion.json`, `pi-companion-turn.png`, `pi-companion-turn-history.png`.
3. **Hermes mapping leg (frame-level).** The rig above is the Hermes leg: it exercises the real wire names and the real mapper (`tool.progress/_thinking` → reasoning preview, `tool.failed` → failed row, `assistant.completed` → answer of record, terminal `messages` → snapshot, `run.cancelled`/`run.failed` → non-complete terminals). A separate fake-gateway driver through the real `companion.ts` HTTP loop is **not** included; the loop's terminal synthesis (`run.incomplete` on a close with no terminal frame) and the approval `choice` fix are covered by code review only. Adding that driver remains an optional extension.
4. **Capability matrix (built).** The same script replays under `?caps=hermes` and `?caps=floor`; the rig asserts the UI omits exactly the unavailable affordances (no live result for Hermes, results only after settle, "Thinking preview" label, no harness-measured duration claim; no reasoning/usage/args/results for floor).
5. **Restart discipline.** Main/preload change ⇒ `npm run dev` (rebundle + relaunch) before verifying; a rig against a stale main bundle proves nothing.

Run with `/root/.local/bin/lifequest-e2e <worktree> tests/chat-panel-e2e.test.ts` (the wrapper cds into `apps/desktop`; build `apps/desktop` first for the Pi rig because it serves its own `dist`). Count only a run whose report artifact exists and whose picture shows the dock.

### 12.1 What the rigs proved (final green runs)

- `tests/chat-panel-e2e.test.ts`: **7/7 suites pass, 0 fail, 0 skipped**. Turn-timeline suite: **46/46 checks**, `pass: true`, `failures: []`; observed live rows `read_file · AGENTS.md` / `search_files · composer` (done) and `terminal · npm test` (failed), folded header `Worked for 1s · Explored 2 files, 1 failed`, footer `Completed · 1s · 1.4k tokens`, incomplete footer `Ended before finishing — iteration budget` with the process open, history rebuilding the same rows from transcript only, Hermes live result `[]` → settled `['Read 42 lines.']`, floor usage absent.
- `tests/pi-companion-e2e.test.ts`: **pass 1 / fail 0**, 27/27 tool-turn checks, `report.ok: true`; real `get_database` row while running and after reload, native 87 ms duration, summed usage 800/30/830 live **and** in history.
- Known limit: the Pi "row seen while running" check is timing-sensitive by construction (12 ms sampler + MutationObserver); it passed with margin but is the most race-prone assertion in the suite.

---

## 13. Open questions

1. **Fold default for the first turn after completion** — fold immediately (DSH "completion") or keep the newest turn open until the next input ("next-input")? Proposal: fold immediately; the answer stays, and the header is one click away. Revisit after the operator uses it.
2. **Does the dock show step separators?** Pi has real steps, Hermes infers them; showing separators only for Pi would fork the visual. Proposal: never show step separators in v1; the blocks already convey order. Keep `step` in the record for later.
3. **Usage row placement** — footer (DSH turn-tail) vs composer stats strip. Proposal: footer only; the dock is narrow.
4. **Hermes result reconciliation timing** — fill result disclosures on settle only, or fetch the session transcript mid-turn? Proposal: settle only; mid-turn fetches add a second reader over a stream we already consume.
5. **A "recap" beyond the synthesized footer** — out of scope; if wanted, it is a product decision with a model call and a cost, not a rendering default.
6. **Approvals during a turn** — where the approval card sits relative to the process group (proposal: above the composer, not inside the folded process, because it requires action).

---

## 14. Out of scope

- Changing prompts, `buildInstructions`, model context, or vault writes.
- Persisting a second transcript copy (rejected in §4.1).
- Plans/todos UI, subagent trees, retry rows, turn rail/previews (DSH features with no LifeQuest counterpart yet).
- Adopting ACP as a transport (evaluated in §9; not now).
- Any Hermes gateway change in this repo (the §8 list is an upstream ask, not a dependency).
- A prose recap model call.

---

## Appendix A — evidence map

| Claim | Verified in |
|---|---|
| Pi event/stream payloads, tool lifecycle, persistence, discarded fields | `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:445-493`, `pi-ai/dist/types.d.ts:553-622`, `pi-harness.ts:344-363,561-656`, `pi-sessions.ts:13-29` |
| Hermes session-stream contract, dropped frames, history rows, approval body | `/usr/local/lib/hermes-agent/gateway/platforms/api_server.py:1032-1042,3580-3708,2969-2977,3224-3255`; `api_server_openai_routes.py:1528-1555`; `agent/tool_executor.py:1020-1039,1160-1182`; `companion.ts:1366-1434`; `companion-client.ts:1140-1232,643-682` |
| Hermes ACP surface | `acp_adapter/events.py`, `tools.py`, `server.py`, `permissions.py`; `hermes acp --check` passes on this host |
| DSH turn/process/tool anatomy, fold defaults, synthesized recap | DSH shipped packages: `dsh-client-ui-chat/README.md` (§Turn Process Folding, Grouped rendering), `lib/types/client/contract/{records,turn-process,snapshot}.d.ts`, `dsh-session/lib/types/types.d.ts:253-389`, `dsh-tools/README.md`, `lib/client.js` (unminified bundles with sourcemap comments) |
| Current dock pipeline, state, render, E2E patterns | `ChatSessionsProvider.tsx:84-115,1050-1130,1359-1524`; `ChatPanel.tsx:1978-2097`; `tool-run.ts`; `vault-service.ts:1940-2026`; `e2e/tool-run.electron.mjs`; `e2e/chat-panel.tsx:167-283`; `tests/chat-panel-e2e.test.ts:689-830` |

## Appendix B — glossary

- **Turn** — one operator request and everything the agent did to answer it (one run id).
- **Step** — one model call plus the tools it requested (Pi `turn_*`, DSH `step/*`). Hermes does not expose it live.
- **Process** — the work the agent did before the answer: reasoning, tool calls, narration.
- **Settle** — replace the live approximation with the authoritative transcript for that turn.
- **Floor** — the minimum event contract every harness must meet (§9).
- **Tier** — Full / Standard+ / Standard / Minimal, a function of the capability descriptor, never of the harness id.
