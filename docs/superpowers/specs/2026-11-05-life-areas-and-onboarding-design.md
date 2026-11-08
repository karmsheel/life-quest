# Design: one life, five areas, and the onboarding interview

**Date**: 2026-11-05
**Status**: Draft — structure and vocabulary agreed in session. P0 (the one-Life
surface: six-area seed, locked/unlocked hinge, hidden switcher, Settings → Areas
unlock) is implemented on `feat/life-areas`; the onboarding interview (P1) and the
suggestion rules (P2) are not.
**Product**: LifeQuest — local-first life-management studio.
**Depends on**: [Overview domain lens](./2026-08-31-overview-domain-lens-design.md)
(superseded in naming only: "Overview" becomes **Life**), [local vault](./2026-07-19-local-vault-electron-design.md),
[direct database writes](./2026-10-28-direct-database-writes-design.md),
[domain databases / Finance kit](./2026-09-23-domain-databases-finance-kit-prs.md).

## The one idea

**One life. Areas are zooms you unlock.**

A new vault opens on one surface — **Life** — with five areas seeded but **locked**:
Health, Mind, Finance, Business, Relationships. The operator talks to the companion,
and the onboarding interview unlocks only the areas the conversation actually points
to. Nothing about the structure is presented as a choice up front. Later, when the
data shows a case for a new area, the companion may *suggest* it; the operator
unlocks it or says "not now", and "not now" is remembered.

Structure is proposed from evidence, unlocked by the operator, never required.

### Success criteria

- A new vault's first run shows no area name, no area picker, and no empty area
  cards. The screen says Life, not Overview.
- The onboarding interview can unlock 1–3 areas; nothing else unlocks by default.
  Unlocking creates no data and moves no data.
- The area switcher appears only once a second area is unlocked.
- Existing vaults open exactly as they are: no hidden areas, no onboarding card, no
  migration that touches their data.

## Vocabulary

| Term | Meaning | Seen by the operator |
|---|---|---|
| **Life** | The whole vault: the union of every unlocked area plus unassigned records. Always present, never locked, never archived. | Yes — the only surface until a second area unlocks |
| **Area** | A scope of life with its own four doctrine documents, databases, pages, board and views | Yes — as a chip, once unlocked |
| **Locked** | Seeded on disk, known to the companion, invisible to the operator | No — never shown anywhere |
| **Unlocked** | The area exists for the operator: doctrine, data, a lens | Yes |
| **Archived** | Off the switcher, files kept. What "lock it again" produces | Yes, in Settings → Areas |
| **Onboarding interview** | The first-run conversation that unlocks areas from the operator's own words | Yes, once |
| **Structure suggestion** | The companion's post-onboarding proposal to unlock an area | Yes, at most occasionally |

Copy rules:

- Never say "domain" to the operator. The code keeps `domain` internally; the UI,
  wiki and companion say **area**.
- Never show a locked area, not even as a greyed card. A visible locked area is the
  empty room this design exists to prevent.
- "Locked" and "unlocked" stay for **areas**; doctrine documents and the dashboard
  board keep **Lock / Unlock** as document actions. Do not put a Lock badge on an
  area.
- "Intellectual" never appears. It is the **Mind** area, slug `mind`.
- Finance's display name is **Finance**; its slug stays `financial` because the
  Finance kit and a dozen engine and renderer sites are hardcoded to it.

## The five seeded areas

Seeded **locked** (`unlockedAt: null`), in this order:

| # | Name | Slug | What it owns |
|---|---|---|---|
| 0 | Health | `health` | The body: sleep, training, nutrition, medical |
| 1 | Mind | `mind` | Inner life: mood, attention, learning, study (absorbs Emotional) |
| 2 | Finance | `financial` | Money: accounts, transactions, budgets (the kit's home) |
| 3 | Business | `business` | Work, ventures, clients, offers |
| 4 | Relationships | `relationships` | People, interactions, cadences |

Emotional folds into Mind. The current four-part seed (Health, Intellectual,
Emotional, Financial) is retired for **new vaults only**; existing vaults keep their
folders and their data exactly as they are.

There is also a base area, `life`: the vault's own container, always unlocked, never
a chip. It carries the whole-life doctrine and holds records created on the Life
surface before any area is unlocked. It is not one of the five and is not presented
as an area.

## States and transitions

```
        (seeded)
  locked ──────────► unlocked ──────────► archived
     ▲                   │  ▲                  │
     │                   │  └──── unarchive ───┘
     │                   │
     └──── never ────────┘   (no path back to locked)
```

- **unlock**: interview, suggestion accepted, or the operator's manual **Unlock
  another area** in Settings. Flips `unlockedAt`. Creates nothing, moves nothing.
  It may *offer* to adopt tables that plainly belong (operator ticks them); it never
  adopts silently.
- **lock it again** = **archive**. One mechanism, no third state. Files stay on disk;
  the area leaves the switcher, the doctrine index and every domain-scoped list.
- **unarchive** brings it back. Nothing is rewritten.
- An area that is unlocked but empty is still shown: the interview gives each
  unlocked area doctrine drafts, so unlocked areas are never blank.

### Life is a lens, not an area

Life is the union: every database, page, board and view in every unlocked area, plus
the base area's own records. It is not an area folder and has no doctrine of its own —
the base area's four documents are what Dream/Vision/Architecture show on Life. Once
the switcher exists, Life is its first chip, never a sibling of its own parts.

## First run: the onboarding interview

### The welcome

The chat dock's first-run card, quiet and not modal:

> **Welcome to LifeQuest.** To start, I'd like to spend ten minutes on what's
> actually going on in your life — what's worrying you, what you want to change,
> what you're working toward. Or just start talking; you can do this anytime.

Button: **Begin the interview**. The button is optional: if the operator types
first, the companion offers the interview without blocking the request.

### The interview

Four to six open questions with follow-ups, never a form:

- what's on your mind right now;
- what's bothering you or worrying you;
- who matters to you at the moment;
- what you're working on;
- what you'd like to be different in a year;
- anything you're proud of or want more of.

The five areas are the **companion's private rubric**. The questions never enumerate
them, and the welcome copy never names them. Each answer may map to zero or more
areas; an area unlocks on one clear signal in the operator's own voice ("I'm
exhausted, I never sleep" → Health), not on a keyword.

**Cap**: one to three areas unlock in the first interview. A first session that
opens all five is a taxonomy delivery in disguise.

The interview closes by reflecting back what was heard, in the operator's words, and
then showing **one** confirmation card:

> Here's what I heard. **Unlock Health and Business?** I'll draft their premise,
> vision, purpose and strategy from your answers, and add the one table the
> conversation asked for.

The card lists exactly what will be unlocked, what doctrine will be drafted, and
what (at most one) table will be created. It is amendable line by line. Nothing is
written before the operator confirms.

### What the interview produces

1. The unlocked areas (flag flip).
2. Doctrine drafts in those areas, written from the operator's words — by Decision,
   because the companion is the author. The confirmation card is the consent; it
   must not become five separate Decisions in the inbox.
3. At most one database, from the conversation's clearest ask. Databases created
   after chat agreement write immediately (the direct-writes policy); the card makes
   the agreement explicit. The verified template library is a later spec; until it
   exists the companion hands-writes the one table's columns.
4. One short note of the interview in the vault (the first "life picture"), so the
   session has a record outside the chat transcript.

### Rules

- Nothing blocks on the interview. If the operator declines, asks for something
  else, or quits, the vault keeps working; the card returns as **Continue the
  interview** on the next open until the onboarding record is complete.
- Do not write anything the operator did not say.
- Not therapy: if the answers surface real distress, the companion steps out of
  interview mode and points at real help instead of filing it into an area.
- The interview is not a prerequisite for the first database. If the operator asks
  for a table, the companion may create it in the base area and offer the relevant
  area later.

### Onboarding record

`.lifequest/onboarding.json`:

```json
{
  "status": "not_started | in_progress | completed",
  "startedAt": "ISO-8601 | null",
  "completedAt": "ISO-8601 | null",
  "unlockedAreas": ["health", "business"]
}
```

A vault with **no** onboarding file is treated as **completed** — that is how
existing vaults avoid being shown a first-run card. New vaults write the file at
creation.

## Unlocking after onboarding

Three triggers:

1. **Manual**: Settings → Areas → **Unlock another area**, which lists the five by
   name. The taxonomy is revealed when the operator asks for it, never before.
2. **Suggestion** (below).
3. **Interview** (above).

An unlock may offer an **adoption list**: tables and pages already in the base area
that plainly belong to the area being unlocked. Adoption is offered, never automatic,
and the card says what moves.

## Structure suggestions (after onboarding)

The companion may suggest unlocking an area — seeded or custom — when the data shows
a case for it. The failure mode is nagging, so the bar is high and the memory is
explicit.

### Gates

| Gate | Default |
|---|---|
| Evidence | ≥3 items in one family — databases or pages the operator built — or the operator names the area themselves in two separate conversations. Never one table. |
| Vault maturity | ≥7 days old **and** ≥3 chat sessions since onboarding. |
| Context | Only in a turn already about that family. Never an unprompted interruption. |
| Frequency | ≤1 suggestion per vault per 14 days, ≤1 per family ever. |
| Open asks | Never while a Decision is pending. |

### Answer handling

| Response | Effect |
|---|---|
| Accept | Card becomes the unlock confirmation (manifest of what unlocks, what is adopted). Nothing moves until confirmed. |
| **Not now** | Family muted 30 days. |
| Ignored | Soft mute 7 days. |
| Second **Not now**, same family | Permanent mute. The companion answers if asked, never volunteers again. |
| New evidence during a mute | ≥2 more items in that family may reopen it — after the mute expires, never before. |
| **Stop suggesting structure** (Settings) | Never again, regardless of evidence. |

### Ownership of the rules

- The **companion** judges evidence and context; only it can read the conversation
  and the tables.
- The **app** enforces maturity, frequency, mute and permanence against a ledger at
  `.lifequest/area-suggestions.json`, and refuses to render the card when a limit is
  hit. If the policy lived only in the prompt it would drift.
- The ledger keys mutes by a canonical family id, or by a normalized name when the
  proposed area is custom, so "Relationships" one week and "People & Family" the next
  cannot reset a mute.
- Every show / accept / decline / ignore is a log event, so the five numbers can be
  tuned from real counts.
- Global switch: `VaultSettings.structureSuggestions` (absent = on), worded
  **Structure suggestions** — never "Area suggestions", which would leak the concept.

### Card requirements

Name, one line of why, and the exact manifest — *"You have three tables about
people. Unlock a Relationships area? It would adopt People, Interactions and
Cadence and nothing else."* — with **Not now** beside it. A suggestion that cannot
name what it would move is not a suggestion.

### Never

No automatic unlock, no automatic move, no merge or archive suggestions (v1), no
"domain", no re-showing inside a mute, no counting one table as evidence.

## What the operator sees

| Surface | Before two areas unlock | After |
|---|---|---|
| Top band | **Life** label, no switcher | `Life · Health · Finance` chips |
| Dashboard | The Life board (the existing Overview board file, relabelled) | Life board or the area's board |
| Data / Pages | One list; new records land in the base area | Filtered by lens; the domain select disappears |
| Dream / Vision / Architecture | The base area's four documents | Every unlocked area's documents; locked areas absent |
| Settings → Areas | Unlocked cards, archived section, **Unlock another area** | Same |
| Chat | "Active area: Life" | "Active area: Health" |

Rules:

- The switcher appears at **two or more unlocked areas**. A persisted lens that now
  points at a locked or archived area falls back to Life.
- Page titles say **Life**, never Overview. The route, files and code may keep the
  word `overview`; the operator does not see it.
- Wings still filter navigation, never data. The lens is still the data filter
  ([LAWS/DOMAIN-FILTER.md](../../../LAWS/DOMAIN-FILTER.md),
  [LAWS/WINGS.md](../../../LAWS/WINGS.md)).
- The companion never says "domain". It uses "area" only once an area is unlocked,
  and then it names the act rather than the taxonomy ("I've unlocked a Health area").

## Implementation notes

- **Seed**: `SEED_DOMAINS` becomes the five locked areas plus the base `life` area.
  `createVault` writes `domain.json` with `unlockedAt: null` for the five and
  `unlockedAt` set for `life`, and writes `.lifequest/onboarding.json`.
- **`DomainMeta`** gains `unlockedAt: string | null`. **Absence of the field means
  unlocked** — legacy vaults must not lose their areas. This is the whole migration.
- **The hinge**: `isDomainLive` (42 call sites) becomes "archived is not enough;
  the area must also be unlocked". Locked means exactly `unlockedAt === null`; an
  absent field is unlocked, for both `life` and every legacy vault. Every engine
  read, agent tool and renderer filter that already asks "is this domain live" then
  treats locked areas as invisible for free. Settings, onboarding and the unlock path
  read the directory directly, deliberately bypassing the hinge.
- **Lens persistence**: `domainSetActive` / `rememberOpen` must refuse a locked or
  archived slug and fall back to Life.
- **Snapshot**: `openVault` still includes every area; the renderer filters locked
  ones. Do not filter in the snapshot, or Settings cannot list them.
- **The rubric is prompt-side**: the five area names and slugs live in the onboarding
  and suggestion skills, not in a tool result. Locked areas are deliberately absent
  from `list_databases`, `list_documents` and every other agent read, so the companion
  cannot leak them by accident; it learns them from its rubric, exactly as the
  operator's copy never names them.
- **Onboarding consent**: the confirmation card is the write's consent record. It
  should be attributable to the companion (a Decision), not silently to the
  operator; today's Decision targets do not fit a batch of unlocks and doctrine
  writes, so the build needs either a small `onboarding` Decision target or an
  explicitly operator-confirmed batch with the agent recorded as author. Decide at
  build time; do not let it become five inbox items.
- **Log events**: `onboarding.started`, `onboarding.completed`, `area.unlocked`,
  `area.archived`, `structure.suggested`, `structure.declined`, `structure.ignored`.
- **Docs to update when this ships**: `docs/wiki/01-overview.md`,
  `docs/wiki/04-the-vault.md`, `docs/wiki/05-domains.md`, `docs/wiki/19-data-and-databases.md`,
  `docs/wiki/28-settings.md`, `VISION.md` (the four-domain sentence),
  `LAWS/DOMAIN-FILTER.md` (lens scope now "unlocked areas").
- **Tests to move**: `decision-intake-e2e` and `connected-harness-tools-e2e` name
  `intellectual`; the seed list changes. No test asserts four seeds by count, so the
  blast radius is small. New rigs: first-run shows no switcher; interview unlock;
  switcher appears at two; persisted lens falls back from a locked area.

## Build order

1. **P0 — one life**: five locked seeds + base area, `unlockedAt`, the `isDomainLive`
   hinge, switcher hidden below two, Life labelling, Settings → Areas with
   **Unlock another area** and no interview yet. This is the shell the rest hangs on.
2. **P1 — onboarding**: welcome card, interview skill, onboarding record, one
   confirmation card, doctrine drafts, one-table cap.
3. **P2 — suggestions**: ledger, suggestion tool/card, settings switch, log events.
4. **P3 — template library and presets** (separate spec): the verified database
   catalog, and the five areas' starter content.
5. **P4 — custom areas**: unlock an operator-named area, adoption of matching tables,
   cross-area relations for shared records such as People.

## Out of scope

- The template library and area presets (P3).
- Custom areas and the move/adopt primitive (P4).
- Cross-area relations (P4). People is cross-cutting: it belongs to the base area or
  to Relationships, and the Business area's tables will not be able to link to it
  until relations are area-aware. Do not promise the Relationships preset before
  this is decided.
- Merging or archiving suggestions; a second base area; multi-user anything.
- Migrating existing vaults to the five-area seed. They keep their areas.

## Open questions for the build

1. What fills the top band when the switcher is hidden — a static "Life" label, the
   vault name, or nothing?
2. Is the base area listed in Settings → Areas (as a non-removable row), or hidden
   entirely?
3. The onboarding consent mechanism: a new Decision target, or an explicit
   operator-confirmed batch recorded as the companion's write?
4. The interview cap: one to three areas, or exactly two?
5. Does a re-run of the interview exist after onboarding (and where is it offered)?
6. Does unlocking a seeded area offer adoption of matching base-area tables, or is
   adoption reserved for custom areas?
