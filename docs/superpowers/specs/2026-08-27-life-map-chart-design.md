# LifeQuest — Life Map on Chart — Design Spec

**Date:** 2026-08-27  
**Status:** Approved — implementation plan at `docs/superpowers/plans/2026-08-27-life-map-chart.md`  
**Product:** LifeQuest — local-first life-management studio  
**Extends:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Skeleton IA](./2026-07-17-lifequest-skeleton-design.md)  
**Ports domain rules from:** [Life Map](https://github.com/karmsheel/life-map) (`docs/superpowers/specs/2026-08-18-life-map-design.md` in that repo)

---

## 1. Purpose

LifeQuest gains Life Map’s **year-to-day operational layer** without becoming a second app. The desktop vault remains the host. Chart becomes the year canvas. Track becomes week architecture. Act gains a task board. Agents (Hermes chat, Act dispatch, MCP) share one Map command bus and one lock.

Doctrine (Why → What → How, forge, Decisions, Domains, Personnel, Life log) stays Quest’s. Calendar, week rhythm, and tasks stay Map’s. They meet in one vault.

### Success thesis

A user opens a LifeQuest vault, writes a Why, then paints the year, shapes a default week, and runs a task board — all in the same shell. An unlocked Hermes agent can change the map and tasks through tools; it cannot forge doctrine or flip the lock.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Host | **LifeQuest** Electron + vault. Life Map is a module, not a peer app. |
| 2 | Year canvas route | **`/chart`** (room id stays `chart`) |
| 3 | Year canvas nav label | **Life Map** |
| 4 | Calendar scope | **One global calendar** per vault. Not per domain. |
| 5 | What document | Remains one `what.md` per domain. **Not** the Chart page. Compact **North Star** strip on Life Map for the active domain; full edit on Documents. |
| 6 | Track route | **`/track`** (room id stays `track`) |
| 7 | Track nav label | **Architecture** |
| 8 | Track content | Day types, default week, real weeks (inherit / detach / priorities / optional grid). Compact **How** strip for the active domain. |
| 9 | Act | Task board **plus** existing execution brief and agent dispatch |
| 10 | Tasks | Global. Columns `backlog` \| `this-week` \| `today` \| `done`. Optional links to a Key, a date, or a week item. |
| 11 | About me | One note, edited in **Settings**, stored as `about.md`. Not a primary nav item. |
| 12 | Year switcher | Life Map and Architecture only |
| 13 | Map unlock | Life Map, Architecture, and the Act **task board** unlock when **any live domain** has a non-empty Why |
| 14 | Act dispatch gate | **Run an agent** stays disabled until the **active** domain’s How has a non-empty body |
| 15 | Persistence | `.lifequest/map.json` (one blob) + `.lifequest/about.md`. No split of years/tasks files in this merge. |
| 16 | Schema | `lifequest.json` `schemaVersion` stays **1**. Missing map files seed empty Map state. |
| 17 | Command bus | Port Life Map `applyCommand`. Renderer always `actor: "user"`. Chat / Act dispatch / MCP use `actor: "agent"`. |
| 18 | Doctrine writes | **Not** through `applyCommand`. Agents **cannot** write Why / What / How, forge, or create Decisions in this merge. |
| 19 | Package | Map domain lives in **`packages/vault-core`** (not a new package). |
| 20 | Model door | **Hermes only**. No OpenRouter. Keys stay in `safeStorage`. |
| 21 | Agent lock | Field on Map state. Top bar, every shell screen. Agents cannot flip it. |
| 22 | MCP | Same tools as chat, from Electron main, only while a vault is open. Last implementation slice of this merge. |
| 23 | Importer | **Out of this merge.** No `life-map.json` import. |
| 24 | Home | Keep doctrine dashboard. Add **Today** and **This week** task cards only. No quarter grids on Home. |

### Explicitly out of this merge

- Import from standalone Life Map `data/life-map.json`
- Review cycles, historical import, learned rules engine, ACP, plugin pages
- Per-domain calendars or domain-tagged Keys
- Agent writes to doctrine / Decisions
- OpenRouter; Life Map’s `data/settings.json`
- Splitting `map.json` into multiple files
- Renaming routes away from `/chart` and `/track`
- Hono / Vite API plugin as a LifeQuest server
- Porting Life Map’s standalone chrome as a second shell

---

## 3. Information architecture

### 3.1 Nav (main)

Home → Dream → **Life Map** → **Architecture** → Act → Documents → Domains → (governance) Decisions, Log → Personnel → Settings

| Nav label | Route | Room id | Page job |
|-----------|-------|---------|----------|
| Home | `/home` | — | Doctrine progress + Today / This week tasks |
| Dream | `/dream` | `dream` | Why editor (unchanged) |
| Life Map | `/chart` | `chart` | Year dashboard, Key, month pages, North Star strip |
| Architecture | `/track` | `track` | Day types, default week, real weeks, How strip |
| Act | `/act` | `act` | Task board + brief + run agent |
| Documents | `/documents` | — | Full Why / What / How editors |
| Settings | `/settings` | — | Hermes, theme, **About me** |

Domains, Decisions, Log, Personnel: unchanged jobs.

### 3.2 Domain switcher

Still global chrome. On Life Map and Architecture it is **context** (which North Star / How strip, which domain chat is holding). It does **not** swap the calendar, week library, or task board.

### 3.3 Unlock

Replace per-active-domain Chart/Track/Act gates for these operational rooms.

| Surface | Unlocks when |
|---------|----------------|
| Dream | Live domain exists (unchanged) |
| Life Map (`chart`) | Any **live** (non-archived) domain has non-empty Why body |
| Architecture (`track`) | Same as Life Map |
| Act room / task board (`act`) | Same as Life Map |
| Act **Run an agent** | Active domain’s How body is non-empty |

Until any Why exists, Life Map / Architecture / Act show the existing lock gate (“write a Why first”).

`getUnlockedRooms` must see **all live domains’** documents, not only the active domain. Keep room ids `chart` / `track` / `act`.

Dream remains per-domain as today (always on if a live domain exists).

### 3.4 Journey meaning (updated)

| Room | Doctrine | Operational canvas |
|------|----------|--------------------|
| Dream | Why | — |
| Life Map | What (strip) | Year, Keys, months |
| Architecture | How (strip) | Day types, default week, real weeks |
| Act | Why→What→How brief | Tasks; agents execute |

Documents remains the place to fully write and forge pillars.

---

## 4. Page surfaces

### 4.1 Life Map (`/chart`)

**Dashboard (no month selected)**

- Year switcher: live years, then archives labeled “(archive)”. Default selection: current calendar year if present.
- Add / delete year controls live **only on this dashboard** (not on Architecture). Same rules as Life Map (cap current + 2 live; cannot delete current calendar year; confirm delete of a future year that has content; delete archive allowed).
- Four quarter blocks with compact day-number grids.
- Click-drag across days (may cross months inside the year) → name + color → period goal (Key).
- **Key** panel on the canvas: list, rename, recolor, retarget range, delete.
- Click a month name → month page.

**Month page**

- Monday–Sunday calendar for that year/month.
- In-month days: number + multiline text.
- Period-goal colors on overlapping days; list of overlapping Keys below (never written into Main Objectives).
- Main Objectives and Notes: independent free text.
- Back control returns to the dashboard.

**North Star strip (always on `/chart`)**

- Active domain name + What title + status badge + truncated body.
- Link to Documents (What). Empty What is valid; strip says so.
- Not a full markdown editor.

**Not on this page:** full What editor, year-unrelated task board, day-type editors.

Archives: dashboard and month are view-only. User can still use Documents / tasks / About.

### 4.2 Architecture (`/track`)

- Same year **switcher** as Life Map (shared selected year in renderer session state — **not** written into the vault). If the user picks 2027 on Life Map, Architecture opens on 2027. Architecture does not add or delete years.
- Day types: create, rename, recolor (fixed palette), edit checklist, delete with in-use rules.
- Default week: weekday → day type or unassigned; weekly-only items.
- Real week picker for the selected year (weeks whose Monday falls in that year). Inheriting vs detached is obvious. Detached: per-day checklists with priority tags, weekly-only items, optional 06:00–22:00 30-minute grid, reset to default.
- Archive year: view-only from that year’s snapshot.

**How strip:** active domain How title, status, truncated body, link to Documents. Not a full editor.

### 4.3 Act (`/act`)

- Four-column task board (create, notes, column move, delete, optional links).
- Links: period goal in a live year, calendar date, or week item on a resolved week. Dangling links render as missing; they do not crash or delete the task.
- No year switcher.
- Existing execution brief (read-only Why → What → How for the active domain).
- Existing agent picker + task prompt + Run. Disabled when How is empty **or** no active hire **or** Hermes is down. When run, uses the **tool loop** (not chat-only completion).
- Recent activity (existing log slice) can stay.

### 4.4 Home

Unchanged doctrine / decisions / agents / activity cards, plus:

- **Today** — tasks in column `today`
- **This week** — tasks in column `this-week`

Empty states are valid. No Map dashboard here.

### 4.5 Settings — About me

A textarea, saved through `applyCommand` `{ type: "setAboutMe", text }` as `actor: "user"`. Copy explains that agents treat it as lifestyle context and cannot edit it while locked.

Hermes and theme settings stay as they are.

### 4.6 Chrome — agent lock

Top bar, every shell route including Home. Label **Agent locked**. Bound to `map.locked`. Changing it is `setLock` as `actor: "user"`. Disabled only when no vault is open.

---

## 5. Map domain (ported rules)

Port Life Map `src/domain` into `packages/vault-core` (e.g. `packages/vault-core/src/map/`). **Rules are not redesigned.** Preserve:

- Live years: current calendar year + at most two future years; archives unlimited and read-only
- Rollover on vault open (local date): freeze ended live year to archive, materialize inheriting weeks, ensure current year exists
- Period goals: named colored inclusive range inside one year; overlap allowed; no year-boundary span
- Month cells vs architecture vs tasks do not write to each other
- Day types: shared library; delete blocked if default week or a **live** detached week still uses the type
- Default week inherit until first real-week edit; reset reattaches
- Detached priorities: required / semi-optional / optional; untagged items default optional
- Grid: place/clear does not create/delete checklist items; place on inheriting week detaches
- Tasks global; deleting a Key or week item leaves dangling links
- Fixed color palette (no arbitrary hex)
- Week id is Monday `YYYY-MM-DD`

Authoritative object shapes: Life Map `src/domain/types.ts` `StoreState` / `Command` union.

**In-memory** state matches Life Map `StoreState` (including `aboutMe: string`).

**On disk**, `aboutMe` is **not** stored inside `map.json` (see §6).

---

## 6. Vault layout and persistence

### 6.1 Tree additions

```
<vault-root>/
  lifequest.json
  domains/<slug>/{domain.json,why.md,what.md,how.md}
  .lifequest/
    settings.json
    agents.json
    log.jsonl
    decisions/*.json
    map.json
    about.md
```

Existing files unchanged. `schemaVersion` remains `1`.

### 6.2 `map.json`

JSON object: `locked`, `dayTypes`, `defaultWeek`, `years`, `tasks`. Pretty-printed, atomic write (existing vault helper).

No `aboutMe` key. If an older experimental file contains it, ignore that key on read.

### 6.3 `about.md`

UTF-8 markdown/plain body. Empty file is valid. Missing file ≡ empty About me.

### 6.4 Seed

On **create vault** and on **open vault** if `map.json` is missing: write empty Map state (`locked: false`, empty libraries, `tasks: []`) then run `ensureCurrentYear` / rollover and persist. Write empty `about.md` if missing.

Malformed `map.json` (unreadable JSON or invalid shape): **do not overwrite**. Surface an error on Map/Architecture/Act/Home task cards. Doctrine rooms still work.

### 6.5 Load / apply / save

Electron main, serialized on the existing vault queue:

1. Load `map.json` + `about.md` → in-memory `StoreState`.
2. `applyCommand(state, command, { actor, today, id })`.
3. If ok: atomic write `map.json` (without `aboutMe`); write `about.md` from `state.aboutMe`; append Life log event(s); refresh snapshot.
4. If persist fails: keep previous in-memory Map state; no log line; return error to UI/agent.

`map:getState` / `map:apply` IPC. `VaultSnapshot` gains `map` (on-disk Map fields + `aboutMe`) so the renderer can show lock and pages after the same refresh as domains.

### 6.6 Life log types (Map)

Append only after a successful persist. `domainSlug` is `null` (Map is global). Examples:

| Type | When |
|------|------|
| `map.lock.set` | User flips lock |
| `map.year.created` / `map.year.deleted` | Year CRUD |
| `map.period_goal.created` / `updated` / `deleted` | Keys |
| `map.month.updated` | Day cell, objectives, or notes |
| `map.day_type.*` / `map.week.*` | Architecture |
| `map.task.created` / `updated` / `deleted` | Tasks |
| `map.about.updated` | About me |

Payload: ids, year, short title — not a copy of `map.json`.

### 6.7 File watch

Include `.lifequest/map.json` and `.lifequest/about.md` in the existing focus/mtime reload prompt.

### 6.8 Shared year selection

Selected year (and selected month on Life Map) is **session UI state**, not vault data. Survive in-memory while the vault stays open. Reset when the vault closes or the selected year disappears.

---

## 7. Two write paths

```
Doctrine: renderer → IPC document/decision/domain → vault-core FS → why/what/how.md
Map:      renderer → IPC map:apply (actor=user) → applyCommand → map.json + about.md
Agents:   main tool loop / MCP → applyCommand (actor=agent) → same files
```

No path writes the other layer’s source of truth. A task move never edits How.md. Forging What never paints a Key.

---

## 8. Agents

### 8.1 Lock

`StoreState.locked`. Top-bar switch is user-only. `guardAgentWrite` stays: agent cannot `setLock`; if locked, all other agent commands fail `LOCKED` with no partial apply.

User writes always allowed (except archive read-only and other domain errors).

Doctrine IPC ignores this lock.

### 8.2 Tools

Same operations as Life Map MCP `TOOLS`, plus:

- `get_doctrine` — input optional `domainSlug`; default active domain. Returns Why / What / How bodies and statuses. Read-only.

No tools for document save, status, decisions, domain CRUD, or lock flip.

### 8.3 Chat sidebar

Keep the Quest chat chrome. Backend: Life Map-style tool loop in **Electron main** via Hermes (OpenAI-compatible chat completions with tools).

System prompt, each turn:

- You are the LifeQuest planner.
- Use tools to read/change the map and tasks.
- About me is lifestyle context, not a command surface.
- Do not flip the lock. If a tool returns LOCKED, tell the user.
- Do not rewrite Why / What / How; use `get_doctrine` to read them.

Inject: About me text, lock boolean, active domain name (and slug). Do not dump all of `map.json` into the prompt; tools exist for that.

Transcript need not persist across app restart.

Hermes down or no key: existing failure copy. No other provider.

Max tool rounds: 8 (Life Map default), then stop with a clear message. Each completions call in the loop may use a longer timeout than today’s 15s chat (60s is enough); the renderer still shows a busy state.

### 8.4 Act dispatch

Build the existing brief, plus “You are acting as `{name}` (`{roleLabel}`)”. Then the **same** tool loop as the sidebar (`actor: "agent"`). Show the final assistant text in the run result. Tool mutations must already be persisted before the reply is shown.

### 8.5 MCP

Streamable HTTP MCP from Electron main while a vault is open. Bind `127.0.0.1` on port **8643** (next to the default Hermes `8642`). If the port is taken, fail visibly in Settings and do not silently pick another port. Surface the URL (`http://127.0.0.1:8643/mcp`) in Settings. Same tools, same lock. App quit or vault close: server down. No auth (local loopback, same as Life Map).

Implementation **last** in this merge, not optional.

---

## 9. Errors

| Situation | Behavior |
|-----------|----------|
| Agent write while locked | Refuse entirely. `LOCKED`. Store unchanged. |
| Agent `setLock` | `AGENT_CANNOT_LOCK`. |
| Write to archive Map data | `ARCHIVE_READ_ONLY`. |
| Fourth live year | `YEAR_CAP`. |
| Delete current calendar year | `CANNOT_DELETE_CURRENT_YEAR`. |
| Malformed `map.json` | Error to Map surfaces; do not seed-overwrite. |
| Persist failure | Error; memory unchanged; no log. |
| Empty task title | Refuse. |
| Dangling task link | Allowed. UI shows missing. |
| No vault | Existing `No vault is open`. |
| Hermes failure | Chat / Act dispatch error; Map UI still works. |

Map error messages shown in page/chrome alert, not only console.

---

## 10. Testing

Browser-free Vitest in vault-core:

- Port Life Map domain tests (years, rollover, lock, period goals, months, day types, weeks, tasks, about, queries).
- Seed on create/open; missing files; reject malformed map without clobber.
- `about.md` round-trip via apply `setAboutMe`.
- Unlock: any live Why unlocks `chart` / `track` / `act`; archived-only Why does not; Act run-agent helper still needs active How.
- Log append on successful Map apply only.
- Agent vs user lock behavior through the vault Map helper, not only pure `guardAgentWrite`.

No Playwright requirement. Manual UI: paint Key, month text vs architecture independence, inherit/detach, task columns, About me, lock in top bar, chat tool write, lock blocks chat write, Home Today/This week.

---

## 11. Implementation order

Each slice is usable in the desktop app without the next.

1. Port Map domain + tests into vault-core; `map.json` / `about.md` load-save; seed; rollover on open; `VaultSnapshot.map`.
2. IPC `map:getState` / `map:apply`; lock switch in top bar.
3. Life Map page on `/chart` (dashboard, Key, month) + North Star strip + nav label + new unlock.
4. Architecture page on `/track` + How strip + shared year selection.
5. Act task board; keep brief; Home Today / This week; Settings About me.
6. Chat tool loop on Hermes + `get_doctrine`; Act dispatch uses it.
7. MCP from Electron main; Settings URL.

---

## 12. Key decisions (rationale)

| Decision | Why |
|----------|-----|
| Quest host, not Map host | Vault, Electron, doctrine, secrets, Personnel already match the long-term product. Map’s portable asset is the domain module. |
| Global calendar on Chart | One Tuesday; four domain calendars would lie. Chart is the “what the year is for” slot. |
| What as strip, not page | Year canvas needs the whole page. What.md still exists for forge/Decisions. |
| Operational rooms unlock on any Why | A global calendar cannot follow per-domain Chart lock. Requiring What/How before weeks/tasks would hide Map’s core loop. |
| Act board unlocked, dispatch How-gated | Tasks are how you live the week. Dispatch still needs a How to execute against. |
| One `map.json` | Faithful port of `applyCommand`. Split files are a later git-hygiene change. |
| About me as `about.md` | Human-editable; Settings is the editor; agents read it as context. |
| Hermes-only tools | One secret store, one gateway, no silent cloud fallback. |
| Doctrine read-only for agents | Forge/Decisions stay HITL. Map lock is the agent brake for calendar/tasks. |
| MCP in this merge | It is a done Life Map feature; dropping it would shrink the combined agent contract. |
| No importer | Separate, testable slice after the vault Map is real. |

### Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Keep two apps | Duplicate chat, settings, and identity. |
| Map as host (single JSON) | Loses Markdown doctrine, git-diffable pillars, Electron vault identity. |
| Per-domain year maps | Conflicts with one default week and one “today” board. |
| Chart stays What editor; Map as extra nav | User locked Chart → Life Map. |
| Track stays How editor only | Week architecture would have no room. How remains via strip + Documents. |
| Agent-writable doctrine | Conflicts with forged HITL. |
| OpenRouter alongside Hermes | Two keys, two failure modes. |
| Hono inside Electron | Extra HTTP stack; IPC already serializes vault work. |

---

## 13. Open questions

None. Product questions from the design dialogue are resolved in §2.

---

## 14. Relationship to prior specs

- [2026-07-17 skeleton](./2026-07-17-lifequest-skeleton-design.md): Chart = What editor and per-domain What→Track / How→Act unlock are **superseded** by this spec for those rooms. Dream, Documents, forge, Decisions, Personnel remain.
- [2026-07-19 vault](./2026-07-19-local-vault-electron-design.md): vault tree **extended** with `map.json` and `about.md`. Runtime, secrets, Hermes proxy, doctrine files unchanged.
- [2026-07-18 Hermes chatbar](./2026-07-18-hermes-chatbar-connection-design.md): chat **gains tool-use** in main. Still Hermes, still non-streaming v1, still no doctrine auto-write.
