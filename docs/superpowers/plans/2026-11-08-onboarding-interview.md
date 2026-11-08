# Plan: P1 — the onboarding interview

**Branch**: `feat/onboarding-interview` (worktree `.worktrees/feat/onboarding-interview`)
**Base**: master `e5ceb32` (P0 one-Life surface is merged)
**Spec**: [2026-11-05-life-areas-and-onboarding-design.md](../specs/2026-11-05-life-areas-and-onboarding-design.md)
(P1 sections: "First run: the onboarding interview", "What the interview produces",
"Onboarding record", "Implementation notes").

This document is the build contract for three parallel workstreams. Read your own
section and the shared contract; do not edit files outside your scope.

## Decisions (closing the spec's open questions for P1)

1. **Top band when the switcher is hidden** — settled in P0: a quiet static
   "Life" label. No change.
2. **Base `life` area in Settings → Areas** — settled in P0: hidden. No change.
3. **Onboarding consent** — an *operator-confirmed batch*, not a Decision per
   write. The companion writes one proposal (`.lifequest/onboarding-proposal.json`)
   through a tool; the app renders it as one confirmation card; the operator's
   Confirm is the consent record. Doctrine is written with the companion as the
   `actor` (`{type:"agent", name:"LifeQuest companion"}`) and one
   `onboarding.completed` log event carries the whole batch. Nothing becomes an
   inbox Decision.
4. **Interview cap** — one to three areas (`1 <= areas.length <= 3`), enforced by
   the proposal validator, not the prompt.
5. **Re-running the interview** — not in P1. While the record is `in_progress`
   the dock offers **Continue the interview**; once `completed`, no card ever
   again. No Settings entry in P1.
6. **Adoption on unlock** — not in P1. Unlocking is a flag flip plus the
   interview's own drafts; the adoption list stays P4.
7. **Log event names** — keep P0's in-vault spelling `domain.unlocked` (the Log's
   renderer translates the prefix to `area.`); new events are
   `onboarding.started` and `onboarding.completed`. No `area.unlocked` string in
   the vault.

## Shared contract

### Engine types (`packages/vault-core/src/types.ts`)

```ts
export const ONBOARDING_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export type OnboardingRecord = {
  status: OnboardingStatus;
  startedAt: string | null;
  completedAt: string | null;
  unlockedAreas: string[];
};

export type OnboardingAreaProposal = {
  slug: string;   // seeded, currently-locked area slug, one of the five
  name: string;   // derived from AREA_SEEDS, not trusted from the model
  doctrine: { kind: DocumentKind; bodyMarkdown: string }[];
};

export type OnboardingTableProposal = {
  areaSlug: string;                 // one of this proposal's area slugs
  name: string;
  columns: { name: string; type: DatabaseColumnType; options?: string[] }[];
};

export type OnboardingNoteProposal = { title: string; bodyMarkdown: string };

export type OnboardingProposal = {
  areas: OnboardingAreaProposal[];  // 1..3
  table: OnboardingTableProposal | null;
  note: OnboardingNoteProposal;     // required: the interview's one note
  createdAt: string;
};

export type OnboardingConfirmOptions = {
  /** Doctrine kinds to leave unwritten (the card's unticked lines). */
  skipDoctrineKinds?: DocumentKind[];
  /** Include the proposal's table (default true). */
  includeTable?: boolean;
  /** Include the interview note (default true). */
  includeNote?: boolean;
};

export type OnboardingConfirmResult = {
  areas: string[];      // slugs unlocked
  table: boolean;       // created or not
  note: boolean;        // written or not
};
```

`VaultSnapshot` gains:

```ts
onboarding: OnboardingRecord;
/** The pending confirmation, or null. Drives the dock card. */
onboardingProposal: OnboardingProposal | null;
```

`openVault` always fills both. A vault with no `.lifequest/onboarding.json` reads
as `{status:"completed", startedAt:null, completedAt:null, unlockedAreas:[]}`
(synthetic — never written on open). New vaults get the file at creation with
`status:"not_started"`.

### File paths (`packages/vault-core/src/paths.ts`)

- `onboardingJson` → `.lifequest/onboarding.json`
- `onboardingProposalJson` → `.lifequest/onboarding-proposal.json`

### Engine module (`packages/vault-core/src/onboarding.ts`, exported from `index.ts`)

```ts
readOnboardingRecord(root): Promise<Result<OnboardingRecord>>        // legacy → completed
startOnboarding(root, actor?): Promise<Result<OnboardingRecord>>      // idempotent; logs onboarding.started once
readOnboardingProposal(root): Promise<Result<OnboardingProposal | null>>
writeOnboardingProposal(root, input: unknown): Promise<Result<OnboardingProposal>>
discardOnboardingProposal(root): Promise<Result<true>>
confirmOnboarding(root, options?): Promise<Result<OnboardingConfirmResult>>
```

Rules the engine enforces (not the prompt):

- `writeOnboardingProposal` validates against the live vault: 1–3 areas, each a
  *seeded* area that is currently **locked** (`unlockedAt === null`), no
  duplicates; exactly the four doctrine kinds `premise, what, why, how` per area,
  each body non-empty (the card shows what it will draft, and an unlocked area
  must never be blank); at most one table, whose `areaSlug` is one of the
  proposal's areas, 1–8 columns, each a `DatabaseColumnType` (no `relation`
  columns in P1), non-empty names; `note` required with title and body.
  Rejecting writes nothing. If a proposal already exists it is replaced (the
  operator asked the companion to change something).
- `confirmOnboarding` refuses unless the record is `in_progress` or
  `not_started` **and** a proposal exists. It applies, in order: unlock each area
  through `unlockDomain` (keeps the P0 `domain.unlocked` event), `saveDocument`
  each non-skipped doctrine body with the companion actor, create the table
  (`createDatabase` + `addDatabaseColumn` per column on the now-unlocked area),
  create the note page in the base `life` area (`createPage` + one markdown
  block), then write the completed record
  (`status:"completed"`, `completedAt`, `unlockedAreas` = the proposal's slugs),
  delete the proposal file, and append `onboarding.completed` with the manifest
  (`{areas, table, note, doctrineCount}`). Partial failure returns an error and
  leaves the proposal in place; a retry is safe because every step is idempotent
  (unlock is, doctrine overwrite is, table creation is guarded by name check).
- The note's title defaults to `First conversation — <YYYY-MM-DD>`. Reuse
  `COMPANION_ACTOR` (implied-decision.ts:21, exported from index.ts:85) for the
  doctrine writes so the Log names the companion.
- **Read tolerance** (build decision): a malformed `.lifequest/onboarding.json`
  reads as `completed`, exactly like a missing one — an existing operator must
  never be shown a first-run card because of a corrupt file. Reading never
  creates the file.
- **Ordering** (build decision): write the completed record and delete the
  proposal last, after every applied step; a mid-batch failure returns an error
  with the proposal intact, and the retry is idempotent (unlock is, doctrine
  overwrite is; guard the table by name so a retry does not duplicate it).

### IPC surface (`apps/desktop/electron/preload.ts`, `vault-service.ts`, `vite-env.d.ts`)

Three new methods on `window.lifequest`:

```ts
onboardingStart(): Promise<Result<OnboardingRecord>>;
onboardingConfirm(options?: OnboardingConfirmOptions): Promise<Result<OnboardingConfirmResult>>;
onboardingDiscard(): Promise<Result<OnboardingRecord>>;   // clears the proposal, stays in_progress
```

All three re-open/refresh the snapshot and emit the data revision the renderer
already listens to, so the dock's cards disappear/appear without a reload.

### Companion prompt (`apps/desktop/electron/companion-client.ts`)

`CompanionInstructionsInput` gains:

```ts
/** Present unless the vault's onboarding is complete. Computed by the caller. */
onboarding?: {
  status: "not_started" | "in_progress";
  proposalPending: boolean;
} | null;
```

`buildInstructions` appends one onboarding paragraph block when the field is
present. It must contain (all of it, since the areas are absent from every tool
result by design):

- the five-area private rubric — Health `health`, Mind `mind`, Finance
  `financial`, Business `business`, Relationships `relationships` — never
  enumerated to the operator;
- the interview shape: 4–6 open questions with follow-ups, never a form; unlock
  on one clear signal in the operator's own words; **cap 1–3 areas**; reflect
  back what was heard in their words before proposing;
- `propose_onboarding_unlock` is the one way to propose: draft premise ("Beliefs
  & Premise"), what ("Vision & Desire"), why ("Purpose") and how ("Strategy")
  for each area, at most one table, and one short note; call it once, then let
  the card do the talking; nothing is written until the operator confirms;
- `proposalPending` → the card is in front of the operator; changes are made by
  calling the tool again with the revised proposal; decline is fine;
- `not_started` → if the operator types before pressing Begin, offer the
  interview in one sentence and continue with their request; never block;
- never write anything the operator did not say; on real distress step out of
  interview mode and point at real help instead of filing it into an area;
- once complete, never bring the interview up again.

Where the context is assembled (main-process `readCompanionPrompts` path and the
renderer's `instructionsContext` sent with `companionChatStream`), fill
`onboarding` from the open vault's record + proposal. Both transports share the
block (it is vault truth, not transport).

### Companion tool

`propose_onboarding_unlock` (read/write tool, in the module where the other
vault tools live; register where the app registers its tools for both transports):

- module `packages/vault-core/src/onboarding-tools.ts` (`ONBOARDING_TOOL_DEFS` +
  `executeOnboardingTool`, modeled on companion-brief-tools.ts); defs join
  `ALL_TOOL_DEFS` (index.ts:383), the electron dispatch branch goes in
  `apps/desktop/electron/map-tools.ts:206`, and the name goes in
  `COMPANION_ONLY_TOOLS` (pairing-grant.ts:104) but **not** in `READ_ONLY_TOOLS`
  (that is what repaints the dock when the proposal lands);
- input: `{ areas: [{ slug, doctrine: { premise, what, why, how } }], table: { areaSlug, name, columns } | null, note: { title, body } }`
  (the four doctrine strings are frontmatter bodies; the tool composes them into
  `{kind, bodyMarkdown}`);
- handler: `writeOnboardingProposal` → on success trigger the data revision so
  the dock card appears; return the proposal (or the validator's `error` with the
  rule it broke so the companion can retry once).
- Refuse when onboarding is complete; allowed while `not_started`/`in_progress`.

### Renderer (`apps/desktop/src/components/hermes/`)

New `OnboardingCards.tsx` + ChatPanel wiring. Cards render **above the composer**
(app-rendered, not chat messages), gated on the snapshot:

| snapshot state | card |
|---|---|
| `onboarding.status === "not_started"` | **Welcome** card: spec copy, button *Begin the interview* |
| `in_progress` and no proposal | quiet **Continue the interview** button/line |
| `onboardingProposal !== null` | **Confirmation** card: "Here's what I heard." + the areas to unlock, per-area doctrine lines, optional table line, note line, all tickable; buttons *Unlock …* and *Not now* |
| `completed` | nothing, ever |

- *Begin* → `onboardingStart()`, then send the operator turn "I'm ready to begin
  the interview." through the normal composer send path (their click is them
  speaking). *Continue* → same with "Let's continue the interview." The existing
  `ChatSessionRequest.kickoff` machinery (ChatDockProvider.tsx:25-35, consumed in
  ChatPanel.tsx:881-900) is the natural trigger if it fits.
- Typing first while `not_started` → `onboardingStart()` silently before the
  send (the welcome card must not fight the operator).
- *Confirm* → `onboardingConfirm({skipDoctrineKinds, includeTable, includeNote})`,
  then refresh the snapshot. *Not now* → `onboardingDiscard()` → Continue card.
- Copy rules from the spec: never "domain", never "locked area", never name a
  locked area before the confirmation card lists what the interview heard.
- Styles: quiet glass card consistent with the dock, in `global.css`.
- `log-event-copy.ts`: the Log prints onboarding events as "Onboarding started"
  / "Onboarding complete" (the `domain.` prefix translation already covers the
  unlocks).

## Workstreams and write scopes

| # | Task | Owner | Write scope |
|---|---|---|---|
| 1 | Engine: record, proposal validator/writer, confirm, seed + snapshot, paths, types, tool module | teammate `engine-onboarding` | `packages/vault-core/src/**` |
| 2 | Main process: IPC + preload + typings, prompt block + context, tool registration, data revision | teammate `companion-plumbing` | `apps/desktop/electron/**`, `apps/desktop/src/vite-env.d.ts` |
| 3 | Renderer: cards, ChatPanel wiring, styles, log copy, snapshot refresh | teammate `renderer-onboarding` | `apps/desktop/src/**` except `vite-env.d.ts` |
| 4 | E2E: real-app onboarding rig + engine rig + artifacts | Lead | `apps/desktop/e2e/onboarding*`, `apps/desktop/tests/onboarding*` |
| 5 | Spec decisions + this plan | Lead | `docs/superpowers/**` |

Ordering: 1 → 2 → 3 for compile-clean integration, but 2 and 3 may write their
own files immediately against this contract (the imported names are fixed here).
Message the Lead when your scope typechecks; the Lead merges nothing — all
work stays on the branch.

## E2E (Lead)

- `tests/onboarding-engine-e2e.test.ts` — record legacy rule, start idempotency,
  proposal validation (cap 3, locked-only, duplicate, table area, note required),
  discard, confirm (unlocks + doctrine bodies + table columns + note page + log
  events + completed record), confirm refused twice.
- `e2e/onboarding.electron.mjs` + `tests/onboarding-e2e.test.ts` — real app and
  real window: new vault shows the welcome card and no switcher; a proposal is
  produced through the same tool path the companion uses; the confirmation card
  lists the heard areas and nothing is unlocked yet; Confirm unlocks both, writes
  doctrine, table and note, completes the record, and the band becomes
  `Life · Health · Business`; a reload shows no card; a legacy vault (no
  onboarding file) shows no card.
  - The rig keeps the P0 world (temp HERMES_HOME, `createVault`, stub `hermes`,
    free MCP ports `mcpPorts` in `LIFEQUEST_E2E`, `bootForE2e()`) and adds the
    fake OpenAI endpoint from pi-companion.electron.mjs:43-101, scripted off the
    request body: answer `/v1/models`; stream `delta.tool_calls` with
    `finish_reason:"tool_calls"` for the interview turn; answer the follow-up
    POST that carries the tool result with the reflection text. Log every
    request body in the report and assert the app sent
    `propose_onboarding_unlock` with only the heard areas. `vaultTools()` is
    empty when the MCP door is down, so the door must be up (mcpPorts) or the
    tool call starves. Probe the dock's real DOM (`data-testid="onboarding-card"`,
    button labels) and `capturePage` each state.
  - Prompt-cache trap: Pi caches the agent per session and only refreshes tools
    on a hit (pi-harness.ts:467-572) — use a fresh session per turn or assert
    the prompt hash is in the signature.
- Artifact: `e2e/artifacts/onboarding.json` + `onboarding-welcome.png`,
  `onboarding-confirm.png`, `onboarding-unlocked.png`.

## Acceptance

- `npm run typecheck` green.
- Both new rigs pass through `/root/.local/bin/lifequest-e2e` against this
  worktree; no skipped rig; artifacts exist.
- The existing P0 rigs (`life-areas`, `life-areas-engine`) and
  `settings-domains`, `shell-sidebar`, `pi-companion` still pass.
- Spec updated: P1 marked implemented (only after the Lead's final run), open
  questions 3–6 closed with the decisions above.
- Handover per AGENTS.md; nothing merged or pushed.

## Built (2026-11-08)

All five workstreams landed on `feat/onboarding-interview` as separate commits:
types `35f2c71`, engine `a856ae8`, main process `1e2f2fd`, renderer
`325ced6` + `70ea156`, rigs `0a475bd`. Nothing is merged or pushed.

Build decisions taken during implementation, on top of the decisions above:

- **First chat:** the composer's send path did not create a session on a
  brand-new vault (it silently dropped the turn), so Begin/Continue and
  typing-first now fall back to `chat.newChat()` exactly as the saved-question
  starter does. Without this the first-run card would be a dead button.
- **Bundle boundary:** renderer *value* imports from `@lifequest/vault-core`
  must come from `/pure`; importing the root index pulls `node:crypto`/`node:fs`
  into the browser bundle and leaves the app on its splash. `OnboardingCards.tsx`
  hit this; the split is now a comment in the file so it cannot regress silently.
- **Engine tolerance:** `validateOnboardingProposal` accepts both the tool-arg
  shape (`doctrine` object, `note.body`) and the stored shape (`doctrine` array,
  `note.bodyMarkdown`) in one enforcement point; `note.title` defaults to
  `First conversation — <local date>` while the body stays required;
  `writeOnboardingProposal` auto-starts a `not_started` vault first.
- **Confirm retries:** an area unlocked mid-flight (Settings) is tolerated, the
  table is found-or-created by name with columns added only when missing, the
  note page is found-or-created by title, and the completed record + proposal
  removal come last — a mid-batch failure leaves the proposal intact.
- **Card ticks** are bound per doctrine *kind* (the engine's consent is
  `skipDoctrineKinds`, not a per-area matrix), so the card displays exactly what
  Confirm will apply.
- **Prompt cache:** the Pi session signature now includes a sha1 fingerprint of
  the assembled system prompt; a changed prompt rebuilds the agent (the
  library's `systemPrompt` is read-only), so the rubric reaches an already-open
  chat, not just a fresh session.

### Verification (all green, run by the Lead against this checkout)

- `npx tsc -p apps/desktop/tsconfig.json --noEmit` and
  `npx tsc -p apps/desktop/tsconfig.node.json --noEmit`.
- `tests/onboarding-engine-e2e.test.ts` — 4/4 subtests, 54/54 checks
  (`e2e/artifacts/onboarding-engine.json`).
- `tests/onboarding-e2e.test.ts` — passes; artifact `e2e/artifacts/onboarding.json`
  plus `onboarding-welcome.png`, `onboarding-confirm.png`,
  `onboarding-unlocked.png`. The report records the instructions the app really
  sent (the five-area rubric and `propose_onboarding_unlock`) before the
  scripted tool call, then the unlocked band and the vault files on disk.
- Regression rigs still pass through `lifequest-e2e` on this checkout:
  `life-areas`, `life-areas-engine`, `pi-companion`, `settings-domains`,
  `shell-sidebar`, `chat-panel`, `chat-sessions`, `agent-prompts`.
- Handover per AGENTS.md; the branch stays off the bench until the operator asks
  for it.
