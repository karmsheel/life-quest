# Reviews — Design Spec

**Date:** 2026-09-21  
**Status:** Approved — implemented  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Review wing placeholders](./2026-09-12-review-wing-design.md), [Hermes companion](./2026-09-04-hermes-companion-profile-design.md), [Overview / domain lens](./2026-08-31-overview-domain-lens-design.md), [Document lock](./2026-09-12-document-lock-design.md)  
**Supersedes:** the Review page body in `2026-09-12-review-wing-design.md` (stubs / “Coming soon”). Wing tabs, rails, routes, and session rules from that spec stay in force.

Fills the Review wing with period reports as vault markdown, companion interviews that assemble them, domain-scoped sections, and a thin Plan hook that seeds the next period’s planning session. Chosen approach: **first-class review engine in vault-core** (not Library notes, not prompt-only files).

---

## 1. Purpose

The operator needs a place to look back over a lived period and write **next-period intent**, with the companion pulling vault data and asking questions. Those reports must be durable markdown so later planning can read them. Domain-specific reviews are optional; an overall review for the same period is the lockable whole.

### Success criteria

- Each cadence page (Daily / Weekly / Monthly / Quarterly / Yearly) shows the **current** period, with a pager over **past + current** only.
- One vault file per cadence × period at `reviews/{cadence}/{period}.md`. Domain work is sections in that file, each with its own companion session.
- Preview by default; optional Edit (split markdown editor). Start/resume conversation opens the dedicated session for the active lens.
- Enforced skeleton: Look-back, Keep, Change, Next-period intent (overall and per started domain).
- Overall **done** locks the file. Domain **done** is a section status only. After lock, agent writes go through Decisions; Unlock restores in-place edit.
- Session start loads a prescribed period pack (lens-filtered).
- Goals and Review pages can start/resume a lens-matched planning session for period P, seeded with review P−1. Planning stubs live at `planning/{cadence}/{period}.md` (frontmatter / session ids; no plan body yet).
- `weekStartDay` is a vault setting (default Monday). It cannot change while any weekly review or planning file exists.
- `npm test` and `npm run typecheck` pass in `packages/vault-core` and `apps/desktop`.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Job of a finished review | Look-back **plus** next-period intent (Keep / Change included). Planning later reads intent as the main payload. |
| 2 | Conversation | One companion session per review scope. Resume if it exists. Never a second thread for the same `(cadence, period, scope)`. |
| 3 | Done | File **locks when overall is marked done**. Usual path: agent proposes complete, operator confirms. Page also has Mark done / Unlock. After lock, agent edits → Decisions. Unlock to edit in place. |
| 4 | Domain done vs lock | Domain `done` is a section status (planning may already use it). The file stays editable until overall is done. |
| 5 | Files | **One markdown file per cadence × period.** Domains are sections, not separate files. |
| 6 | Creation | File created on first Start conversation **or** first Edit-save for any scope. Always plants the overall skeleton, so overall becomes `draft` even if Health was started first. Missing = that domain section was never started. |
| 7 | UI | Preview first, optional Edit (doctrine-style split editor + Save). After overall lock, editor read-only until Unlock. |
| 8 | Periods | Calendar buckets in **local** time. Daily = date. Weekly = week-start through +6 days. Monthly = calendar month. Quarterly = Jan–Mar / Apr–Jun / Jul–Sep / Oct–Dec. Yearly = calendar year. |
| 9 | Week start | Vault setting `monday` \| `sunday`, default `monday`. **Blocked** while any `reviews/weekly/` or `planning/weekly/` file exists. |
| 10 | Default period | Land on **current** in-progress period. You may review it before it ends. |
| 11 | Review pager | **Past + current only.** No future review files. Planning **may** create the next period’s stub. |
| 12 | Domain switcher | Picks the review you are doing. Page shows **only the active scope**. Overview = overall + domain status list + jump (switches lens). Unassigned ≡ Overview. |
| 13 | Period pack | Prescribed: log, tasks, goals, Daily Schedule actuals (`liveDays`), previous review for this cadence, and on Overview any domain sections already drafted/done. Doctrine and older history only on request. Domain session: same pack, filtered to that domain. |
| 14 | Skeleton | Enforced. Extra headings allowed **after** required ones. Writes that drop required headings are rejected. |
| 15 | Planning | Thin hook only. No plan body. Stub file stores session ids per scope. |
| 16 | Plan pairing | Plan period **P**, seeded with review **P−1**. Goals: plan **current** period (cadence picker, default Weekly; not Daily). Review: “Plan next period” from period N → plan **N+1**, then navigate to Goals. |
| 17 | Plan lens | Lens-matched planning sessions (Overview / Health / …), same resume rule as reviews. |
| 18 | Storage | Vault-root `reviews/` and `planning/`. Not under `.lifequest/`. Not Library `documents/`. |
| 19 | Weekly filename | **Week-start date** `YYYY-MM-DD`, not ISO `YYYY-Www`. |
| 20 | Approach | First-class review engine in vault-core. Reuse split editor and Decisions machinery; new `DocumentTarget` for reviews. |

### Explicitly out of scope

- Writing a plan markdown body (later spec fills `planning/` stubs).
- Changing Life Map week keys (map weeks stay Monday-based even if reviews use Sunday).
- Review files as Library notes; wiki-link graph for reviews.
- In-app delete/archive UI (deleting the file on disk returns the period to empty).
- Future review periods; rolling windows; operator-configurable cadences.
- Daily cadence in the Goals picker (Daily “Plan next period” exists only on Daily Review).
- Auto-update of an overall report when a domain section is finished later (operator/agent rewrite if they want).
- Encoding wing in the URL; persisting last-used wing to disk (unchanged).
- Filtering Home, Map, Log, or tasks by wing (`LAWS/WINGS.md` unchanged).
- Agent writes to reviews **before** overall lock going through Decisions.

---

## 3. Current state

- Review wing exists: routes `/review/daily` … `/review/yearly`, rail order locked, pages are `StubPage` (“Coming soon”).
- Companion is required. Chat lives in Hermes sessions (`companionSessionCreate({ title })`). Chat pane owns the active session; nothing yet binds a session to a vault document.
- Decisions targets are `{ type: "doctrine", ... }` and `{ type: "library", id }`. Lock/unlock exists for those documents.
- Vault settings are `{ hermesBaseUrl, theme }` in `.lifequest/settings.json`.
- Domain switcher is the data filter (Overview / Unassigned / domain).
- Plan wing is Goals, Life Map, Architecture. No planning session.
- Map `liveDays` are Daily Schedule actuals. Map detached weeks are always Monday-keyed.
- Library documents live in `documents/`. Doctrine lives in `domains/{slug}/{kind}.md`.

---

## 4. Architecture

`vault-core` owns period math, paths, skeleton parse/canonicalize, per-scope status, lock, period pack, and planning stubs. Desktop UI, IPC, MCP, companion session start/resume, and Decisions all call that module. Review structure is never “whatever the model wrote.”

```
Review / Goals UI  →  IPC  →  vault-core reviews + planning-stubs + period-pack
                         ↘  companion start/resume (Hermes session id stored in frontmatter)
MCP write_review / mark_review_done  →  same vault-core (Decisions if locked)
```

### 4.1 Paths and period ids

`vaultPaths` gains:

- `reviewsDir`, `reviewsCadenceDir(cadence)`, `reviewMd(cadence, period)`
- `planningDir`, `planningCadenceDir(cadence)`, `planningMd(cadence, period)`

Cadences: `daily` | `weekly` | `monthly` | `quarterly` | `yearly`.

| Cadence | Period id | Example (local) |
|---------|-----------|-----------------|
| daily | `YYYY-MM-DD` | `reviews/daily/2026-09-21.md` |
| weekly | week-start `YYYY-MM-DD` | `reviews/weekly/2026-09-21.md` (that Monday or Sunday) |
| monthly | `YYYY-MM` | `reviews/monthly/2026-09.md` |
| quarterly | `YYYY-Qn` | `reviews/quarterly/2026-Q3.md` |
| yearly | `YYYY` | `reviews/yearly/2026.md` |

UI labels may say “Week of 21 Sep 2026”; filenames stay the week-start date.

Period math uses **local** calendar dates (`todayLocalIso` style), inclusive start and end. `nextReviewPeriod` after current is not creatable as a review (API rejects). `nextPlanningPeriod` may be current+1.

Life Map weeks remain Monday-based. A Sunday-start review week can overlap two map weeks; the pack filters by **date in the review window**, not by map week object.

### 4.2 Settings

```ts
weekStartDay: "monday" | "sunday"  // default "monday"
```

- New vaults write it. Open of an older vault coalesces missing → `monday` (no schemaVersion bump).
- `updateSettings` rejects a `weekStartDay` change when any file exists under `reviews/weekly/` or `planning/weekly/`, with a counted reason.
- Corrupt `weekStartDay` fails closed in Settings (do not silently treat as Monday on save). Period math that sees an invalid value treats it as Monday for reads and still surfaces the Settings error.

Settings UI: Vault tab, “Week starts on” Monday/Sunday. Disabled with helper text while weekly files exist.

### 4.3 Review file shape

Frontmatter (illustrative):

```yaml
cadence: weekly
period: "2026-09-21"
weekStartDay: monday   # copied at file creation; display/honesty only
locked: false
updatedAt: "2026-09-21T18:00:00.000Z"
scopes:
  overall:
    status: draft      # missing | draft | done
    sessionId: "…"     # Hermes id or null
  health:
    status: draft
    sessionId: "…"
```

- `overall` is always present once the file exists.
- A domain appears in `scopes` when that section is first started (or when Edit-save first writes that heading block). Absent domain = `missing`.
- `sessionId` is the resume handle. If Hermes no longer has it, start a new session and overwrite the id. Do not create a second session while the stored id still exists in Hermes.

**Required body** after canonicalize:

```markdown
# Weekly review · Week of 21 Sep 2026

## Look-back

## Keep

## Change

## Next-period intent
```

Each started domain, in vault domain `sortOrder`, then:

```markdown
## Health

### Look-back

### Keep

### Change

### Next-period intent
```

Rules:

- H1 is the period title (cadence label + human period). Canonicalize may rewrite H1 to the canonical title; it is required.
- Overall H2 names are exact: `Look-back`, `Keep`, `Change`, `Next-period intent`.
- Domain H2 is the **current** `DomainMeta.name`. Section identity is the slug in frontmatter. Rename retitles the H2 on canonicalize.
- Domain subsections are exact `###` names as above.
- Empty subsections allowed.
- Extra headings allowed only **after** all required blocks (overall + started domains).
- Archived domain: if a section exists, keep it; do not list archived domains as Missing on Overview.

**Statuses**

| Status | Meaning |
|--------|---------|
| missing | Domain section never started (not in `scopes`). Overall is never missing once a file exists. |
| draft | Section exists (overall always after create). |
| done | Marked done. Domain done does not lock. Overall done locks `locked: true`. |

First create (any scope) → overall `draft` + overall skeleton. If the creating scope is a domain, also append that domain block as `draft`.

### 4.4 Planning stub

`planning/{cadence}/{period}.md` — frontmatter only for this spec:

```yaml
cadence: weekly
period: "2026-09-28"
updatedAt: "…"
scopes:
  overall:
    sessionId: "…"
  health:
    sessionId: "…"
```

No skeleton, no lock, no Mark done. Body may be empty. A later spec writes the plan body into this file.

### 4.5 Lock and Decisions

`DocumentTarget` gains `{ type: "review"; cadence: ReviewCadence; period: string }`.

- Draft `write_review`: atomic write, canonicalize, no Decision.
- Locked `write_review`: **never** writes through; `createDecision` with the proposed **full** body (same as doctrine). Approve applies canonicalize + write.
- Operator Edit-save while locked: rejected (editor is read-only). Unlock then edit is direct.
- Unlock: `locked: false`. Overall status stays `done` unless the operator/agent marks it draft again (not required this spec; Unlock alone is enough to edit).
- After lock, a still-`missing` domain may be started; agent writes to the locked file go through Decisions unless Unlock first. Operator can Unlock and Edit.

`documentTargetLabel` for reviews: period title (e.g. “Weekly review · Week of 21 Sep 2026”).

### 4.6 Period pack

Built by `period-pack.ts` for `(cadence, period, scope)` where scope is `overall` or a domain slug.

Window = period start/end as local dates.

Always included (partial failure → include the rest + `missingSources: string[]`):

1. Life log events with `createdAt` in the window.
2. Tasks: `links.date` in the window, **or** `column` is `today` / `this-week` / `done` and the task is otherwise in play for that window (include open `today`/`this-week` always for current period; for past periods prefer dated links + `done` with date in window). Cap lists reasonably; do not dump the whole backlog for a yearly review without a cap (implementation: yearly/quarterly cap with a `truncated` flag).
3. Goals: all open goals + goals with `deadline` in the window; include `current` / target / definition of done.
4. Daily Schedule actuals: `liveDays` whose `date` is in the window (leftover + blocks + done flags).
5. Map events whose `date` is in the window.
6. Previous period’s review for the **same cadence** (full file if readable), if it exists.
7. Overview only: current file’s domain sections that are `draft` or `done`.

Domain scope: filter 1–5 to that `domainSlug` (log/tasks/goals/events with matching slug; unassigned records omitted unless scope is overall). Include previous review’s matching domain section plus previous overall if present. Doctrine is **not** in the pack; agent may `get_doctrine` on request.

### 4.7 Companion sessions

Identity: `(kind: "review" | "plan", cadence, period, scope)` where `scope` is `"overall"` or a domain slug.

- Title examples: `Review · Weekly · Week of 21 Sep 2026`, `Review · Weekly · Health · Week of 21 Sep 2026`, `Plan · Weekly · Week of 28 Sep 2026`.
- Kickoff (new session only): app sends one user-visible message naming the review/plan identity and asking the agent to begin the interview. Pack is **not** pasted into the transcript.
- Every chat turn in a bound session: main process appends review/plan instructions + **current** pack to Hermes `instructions` (extend `buildInstructions`). Resume therefore sees a fresh pack on the next send.
- Chat dock: `openSession(id)` so Review/Goals can select that Hermes session and open the pane. If Hermes is down, no session start; Edit-save may still create the file.

---

## 5. Components and data flow

### 5.1 Review period shell

One page component parameterized by cadence; five routes stay as they are.

Chrome (all lenses): period pager (prev / label / next), lock badge, Unlock when locked, “Plan next period”. Next disabled on the current period. Stale/future period ids snap to current with an error.

**Overview:** rendered overall four subsections; domain status list (live non-archived domains + any extra sections already in the file) with Missing / Draft / Done and jump (sets lens). Start/resume overall session. Mark done (overall → lock). Edit toggles split editor on the **full** file (Edit is the exception to “show only active scope”: the editor is the whole document so skeleton stays intact). Preview mode still shows only overall + status list.

**Domain lens:** preview of that domain’s four subsections, or empty state if Missing. Start/resume that domain session. Mark done (section status only). Edit still opens the full file.

Empty period (no file): preview empty state + Start conversation + Edit (first Save creates the file).

### 5.2 Start / resume review

1. Resolve `(cadence, period, scope)` from route + lens (Unassigned → overall).
2. Create file if needed; append domain section if needed.
3. If `sessionId` exists in Hermes → open it. Else create session, persist id (if persist fails after create, keep showing that session and retry id write on next resume; do not create another).
4. Load pack (best-effort). Open chat dock on that session. New session: send kickoff message.

### 5.3 Writes

- Agent `write_review`: full body. Canonicalize; reject if required headings missing (error names them). Set written scopes to `draft` unless already `done`. If locked → Decision only.
- Operator Save: same canonicalize path.
- `mark_review_done`: domain → that scope `done`; overall → overall `done` + `locked: true`. Reject if no file, or domain still `missing`.
- Mark overall done from the page is allowed even if some domains are missing or draft.

### 5.4 Plan hook

- **Goals:** cadence picker default Weekly (Monthly / Quarterly / Yearly). Button: plan **current** period for active lens, seed with review **P−1**.
- **Review:** “Plan next period” → plan **N+1** for active lens, seed with review **N**, `navigate("/goals")`.
- Get-or-create planning stub; resume/create scope `sessionId`; inject previous review (or “missing/draft” note); open session. Failure to create stub aborts (no session). Missing previous review is context, not an error.

Daily: Review page hook only (plan tomorrow).

### 5.5 Snapshot and IPC

Vault snapshot gains a compact `reviews: ReviewIndexEntry[]` (cadence, period, locked, scopes statuses, `error?: string` for unreadable files) and `planning: PlanningIndexEntry[]` (cadence, period, scopes with session ids). Bodies are **not** in the snapshot; `reviewGet` / `planningGet` load on demand.

Missing `reviews/` or `planning/` directories are empty, not an open-vault failure. One corrupt file is an index error row, not a vault-open failure, and must not be overwritten on read.

IPC (names indicative): `reviewGet`, `reviewWrite`, `reviewEnsure` (create skeleton), `reviewMarkDone`, `reviewUnlock`, `reviewPeriodPack`, `planningEnsure`, plus companion `startOrResumeReviewSession` / `startOrResumePlanSession` that compose ensure + Hermes + kickoff.

MCP: `get_review`, `list_reviews`, `write_review`, `mark_review_done`, `unlock_review`, `get_period_pack`. Existing `list_*` tools remain. Pack is the prescribed bundle.

---

## 6. Error handling

| Case | Behavior |
|------|----------|
| No vault | Review/Plan hooks inert; same open-a-vault empty state. |
| Next on current review period | Control disabled. |
| Future review id | Error, snap to current. Do not create the file. |
| Week start change with weekly files | Reject with count; control disabled beforehand. |
| Create/write I/O | Atomic write; on create failure do not start a session. |
| Hermes down | Existing companion error; no session. File may already exist from Edit. |
| Stale `sessionId` | New session + persist new id. Not an error. |
| Partial pack | Session starts; `missingSources` listed in instructions. |
| Dropped required headings | Save/write rejected; names listed. Extra headings kept. |
| Malformed frontmatter | Unreadable index row; do not overwrite. |
| Locked write | Decision only; if Decisions IPC fails, agent is told it was not applied. |
| Unlock when unlocked | No-op. |
| Mark done, no file / domain missing | Reject. |
| Plan stub create fails | Abort hook. |

---

## 7. Implementation units

Work packages for a later plan (not a build order DAG):

1. **Period math + `weekStartDay`** — `period.ts`, settings field, create-vault/open-vault coalesce, `updateSettings` block, Vault Settings UI.
2. **Review files** — paths, frontmatter, skeleton canonicalize, ensure/get/write, status, lock/unlock, mark done, index loader.
3. **Planning stubs** — get-or-create, session ids, index.
4. **Period pack** — sources, lens filter, previous review, truncation flags.
5. **Decisions target** — `review` target, create/approve/reject apply, labels, document-lock tests extended.
6. **IPC + snapshot** — load index on open/refresh; renderer APIs.
7. **MCP tools** — register, execute via vault-core.
8. **Companion bind** — start/resume helpers, instructions+pack, kickoff message, ChatDock `openSession`.
9. **Review UI** — replace stubs with period shell (pager, preview, Edit, Start, Mark done, Plan next).
10. **Goals Plan hook** — cadence picker + button; navigate from Review.
11. **Laws / product docs** — `LAWS/REVIEWS.md`; VISION Decisions sentence includes reviews; short note on the 2026-09-12 wing spec; `WINGS.md` unchanged as a filter law.
12. **Tests** — vault-core behavioral + desktop shell tests (see §8).

---

## 8. Testing

### vault-core (temp vaults)

- Period math for all five cadences; Monday vs Sunday weekly bounds; weekly filename = week-start date; review create of future period rejected; planning stub for N+1 allowed.
- Skeleton plant; Health append; reject writes that drop required headings; extra headings preserved; domain rename retitles H2; frontmatter round-trip.
- Status: create → overall `draft`; unstarted domain `missing`; domain done does not lock; overall done locks; mark domain done while missing fails; mark overall done with no file fails.
- `weekStartDay` change with weekly files fails; without files succeeds.
- Pack window filters; domain filter; previous review attached; partial source → `missingSources`.
- Planning stub has no lock/skeleton.
- Locked `write_review` files a Decision and does not mutate until approve.

### desktop shell (source assertions)

- Review routes no longer mount `StubPage`.
- Pager / Start / Edit / Plan-next / Mark done present.
- Unassigned treated as Overview.
- Goals has cadence picker + Plan hook, not Daily.
- Settings week-start control + blocked copy.
- MCP names registered; companion start/resume exists; Decisions `review` target wired; snapshot index fields present.

### companion helper

- Stale `sessionId` → new session, id persisted; valid id → no second create.

Out of scope: full Hermes click-through; later plan-body spec.

---

## 9. Risks

- **Map weeks vs review weeks.** Map is Monday-keyed. Sunday-start reviews overlap two map weeks. Mitigate by packing **dates in the review window**, not whole map-week records. Do not retcon Map.
- **Pack size** on yearly/quarterly. Mitigate with caps + `truncated`.
- **Hermes session deleted** under the operator. Resume creates a new session; interview history is gone (transcripts stay with Hermes, per companion law).
- **Domain rename** vs headings. Canonicalize retitles from slug.
- **Chat pane session ownership.** Today ChatPanel holds `sessionId` locally. Must lift a request API or Start/resume cannot show the bound thread.
- **Instruction payload size.** Pack on every turn may be large; keep pack compact (summaries, not full log dump) and let the agent `get_review` / `list_log` for more.
- **Overall draft after Health-only start.** Overview will show overall as Draft with empty skeleton. That is the locked product (decision A on creation). Empty-state copy should say overall headings are planted and still need an overall interview.

---

## 10. Rollout

Single feature cut on `master` (no flag). Existing vaults: empty `reviews/` / `planning/` on first ensure; `weekStartDay` defaults to Monday. No migration of stub pages. No change to wing routes. Operator sees real Review pages instead of “Coming soon.”

---

## 11. Open questions

None that block implementation. Left to the implementation plan:

- Compact vs verbose pack field list (stay under a size budget).
- Exact kickoff sentence copy.
- Whether Unlock clears overall `done` or only `locked` (spec: Unlock only clears `locked`).
