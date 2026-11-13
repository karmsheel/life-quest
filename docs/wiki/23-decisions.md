# Decisions

Decisions is the approval queue for changes an agent proposes to the vault, plus
the log of decisions you make yourself. Every agent write that can change meaning
— doctrine, a library note, a review, a project, a goal, a template, an ingest
mapping, a row update, a dashboard view, an agent pairing — is frozen into a
proposal file and waits here. Approving it writes the change; rejecting it leaves
the vault exactly as it was. The shelf is global: a proposal is never hidden
because of the area lens you are standing in.

One family of agent writes no longer comes here at all: adding data. A new
database, a new row and a batch of new rows are written as soon as you agree to
them in the chat. See [What files a Decision](#what-files-a-decision) and
[Wiki home](./index.md).

## Where it lives

- Rail: the governed shelf above the Log, label **Decisions**, inbox icon. The
  route is `/decisions`.
- It is a sheet, not a page: it opens over whatever you were reading, dims the
  window, and closing returns you to that page with its route, scroll position
  and state intact. Same frame as [Settings](./28-settings.md).
- The rail row carries a badge with the count of **every** pending proposal in
  the vault. Its accessible label reads "Decisions, 3 pending"; at three digits it
  caps at `99+`.
- **Settings → Decisions** (`/settings?tab=decisions`) holds the two switches that
  let the inbox open and close itself.
- The one area-scoped reading of decisions is the Dashboard's **Pending
  decisions** card, not this sheet — see [Dashboard](./06-dashboard.md).

## What it is for

The app separates *proposing* a change from *making* it. An agent may read the
whole vault whenever it needs to, but a write that changes what a document, a
board or a ledger says must be reviewed by you first. Decisions is that review
surface: it shows the target, who proposed it, which areas it touches, what would
change field by field, and lets you approve, reject or correct it.

The second job is the opposite: recording a decision you already made yourself.
That is not a proposal and nothing is waiting on it, so it is logged rather than
filed — the **Manual** tab — and it lives in a separate store that the approval
path can never read.

## How to use it

### Answer the queue

1. Open **Decisions** on the rail. The sheet opens on the **Pending** tab, newest
   first. Every pending proposal is here, whatever area filed it.
2. Read a card. The kicker names the kind of target and the card stack draws it as
   one card on the sheet; each area the proposal touches is a badge beside the
   status pill; the title names the change; the line under it names the actor and
   when it was filed; the rationale sits under that.
3. Read the body. A structured proposal leads with a sentence such as
   "Update this project." or "Set 3 pins." and then a table under the headings
   **Field**, **Now** and **Proposed**. Prose proposals show **Current** and
   **Proposed text** side by side. A library note whose areas change shows a
   **Domains** row with the list before and after. Open **Exact proposal** to see
   the raw JSON that will be applied.
4. Choose **Approve** to write it, or **Reject** to discard it. The card reports
   "Decision approved." or "Decision rejected." and leaves the queue.
5. Choose **Approve all** on the bar to answer every pending proposal at once.
   The button says **Approving…** while the batch runs; a clean batch reports "All
   N decisions approved.", a partial one reports how many landed and repeats the
   first refusal, and every failure leaves its card pending.
6. Switch to **History** to read what was resolved. The filter row offers **All**,
   **Manual** and **AI**; every card wears a source chip — `AI` for an agent
   proposal, `You` for one you filed yourself, `Manual` for a logged decision —
   and a `Logged` pill where a proposal would say approved or rejected. A proposal
   you corrected before approving reads `approved · edited`.

Empty states: **Pending** says "No pending proposals." History says "No
decisions yet. Log one yourself on the Manual tab, or wait for a proposal."
(with the source filters narrowing that to "No resolved AI decisions yet." or
"No manual decisions logged yet."). The Manual tab's recent list says "No manual
decisions logged yet."

### Correct a proposal before answering it

1. On a pending card, choose **Edit**. The editor replaces the read-only body and
   the answer pair.
2. Change the **Title**, the typed scalar fields, and — under **Exact proposal** —
   the raw JSON for nested values and lists. A prose target gets a **Proposal
   (markdown)** box instead. An **Why the change? (optional)** line records what
   the agent should learn from the correction.
3. Choose **Save changes** to amend only: the card returns to the queue, still
   pending, carrying your correction. Choose **Approve with changes** to amend and
   approve in one move. **Cancel** leaves the agent's proposal as filed.
4. After a correction the card wears **Edited by you**, and **Revert to agent's
   version** is one click in the editor. The agent's original is kept beside your
   version from the first amendment on.
5. Some cards offer no **Edit**: an agent-pairing proposal and a Finance kit
   install are not correctable, and a project-close proposal has nothing to
   correct. The engine also refuses an edit that would rewrite what the proposal
   *is* — the command or target fields — and refuses a body that no longer parses,
   rather than sending it.

### Log a decision you made

1. Switch to **Manual**.
2. Fill in **What did you decide?**, optionally **Why? (optional)** and **Area
   (optional)** (the select starts on your current area; **No area** is a real
   choice).
3. Choose **Log decision**. The record appears immediately under **Your manual
   decisions** and in History with the `Manual` chip and a `Logged` pill.
4. A logged decision must have a title; an empty one is refused with "Say what you
   decided before logging it". A named area must be unlocked and live.

### Let the inbox open and close itself

**Settings → Decisions** carries two switches, both on by default:

- **Open for a new decision** — the inbox opens over the page the moment the
  companion files a proposal. Decisions already waiting when the app starts are a
  baseline, not arrivals, so a queue at launch does not pop the sheet. Only an id
  this window has never held opens it.
- **Close after the last decision** — answering the last pending proposal closes
  the inbox and hands the page back where you left it. It fires on a rejection as
  well as an approval; only your own answer closes the sheet, never a change made
  in another window, and a failed read leaves it up.

Both write to the vault's settings, so the preference follows the vault folder
rather than one window. Turning **Open for a new decision** off does not make the
inbox burst-open when it is turned back on: filings seen while it was off are
already known.

## The screen

| Part | What it does |
|---|---|
| The sheet frame | Title **Decisions**, subtitle "Approve a proposal to write it into the vault. Reject it to leave the vault as it is." Closes by the cross, a click on the scrim, or Escape. |
| Tabs | **Pending**, **History**, **Manual**. |
| Bar | The tab switcher, the page's own notice line (approval, refusal, "saved changes"), and **Approve all** at the trailing edge. |
| History filters | **All**, **Manual**, **AI** — which store the list is drawn from. |
| Arrival line | One quiet line above the list: "New decision filed by <name>." or "N new decisions filed." |
| Card kicker | Target kind, a `New` chip for a fresh arrival, `Edited by you` when corrected, the area badges, and the status pill: `pending`, `approved`, `rejected`, `approved · edited` — or `Could not apply`. |
| Card body | The diff or prose comparison, the area-change row when there is one, plus a collapsible **Exact proposal**. |
| Pending actions | **Reject** (danger), **Edit**, **Approve** (primary). Each card tracks its own answer, so two answers in flight read as two. |
| Manual form | **What did you decide?**, **Why? (optional)**, **Area (optional)** with a **No area** choice, and **Log decision**. |

The target kind on the kicker reads, depending on the proposal: a doctrine label
such as **Beliefs & Premise**, **Vision & Desire**, **Purpose**, **Strategy
(How)**; **Library note**; **Review**; **Page**; **Pins**; **Mapping**;
**Finance kit**; **Assumptions**; **Goal**; **Day template**; **Project**;
**Database**; **Database row**; **Database rows**; **Agent pairing**; **Dashboard
view**.

## Rules and behaviour

- **The shelf is global.** Pending, History and Manual read every Decision the
  vault holds, whatever area filed it, and the rail badge counts every pending
  one. The per-area reading lives on the Dashboard's **Pending decisions** card,
  which filters by the active lens and shows its own count.
- **A new filing can open the sheet by itself**, as above. A filing that arrives
  while the sheet is already open is added without a spinner or a reload; the card
  wears an accent pulse and a `New` chip for six seconds, and the arrival line
  names who filed it. The rail badge pulses for four seconds when the count grows
  — it does not pulse when the count shrinks, because approving is not news.
- **Only pending proposals can be answered.** Resolving a card that is already
  approved or rejected is refused with `Decision is already approved`. An approval
  that cannot be applied for a reason no retry can fix is recorded as rejected
  with a reason, and the card says "Rejected · proposal no longer applies." with
  that reason underneath, so it never reads as a decision you declined. An
  *amended* proposal that hits such a failure stays pending instead, because a
  proposal you can still correct is not permanently broken.
- **Approve writes; nothing else does.** The apply path writes the target file
  directly, preserving what the target had before. A transient failure (a locked
  file on disk, a disk error) leaves the record pending so you can approve again.
- **Editing amends the record, not the vault.** **Save changes** is a write to the
  pending Decision only; the target is untouched until an approval. The engine
  moves a body-carried title in step with the body, so a fixed title cannot be
  saved next to a file that keeps the typo, and it logs `decision.amended`.
- **Locked documents.** A locked doctrine document, library note or review is
  read-only in place: you cannot edit it, and you propose a change to it with
  **Propose change** instead. An agent change to a locked document appears here
  as a pending Decision; agents cannot lock or unlock anything, and a review must
  be locked before any change can be proposed. That is
  [LAWS/DOCTRINE.md](../../LAWS/DOCTRINE.md).
- **Locked Dashboard.** Approving a pins or dashboard-view decision that writes a
  locked board does **not** unlock it — the approval is the consent for that one
  write, and the lock stays exactly as you set it. A card that removes a pin never
  deletes what the card draws. That is
  [LAWS/DASHBOARD.md](../../LAWS/DASHBOARD.md).
- **Manual decisions never enter the queue.** `.lifequest/manual-decisions/` is a
  separate store; nothing in the approval path reads it, so a logged decision
  cannot become pending, cannot be approved into a document, and cannot be
  resolved twice.
- **Files on disk.** Proposals are `.lifequest/decisions/<id>.json`; manual
  decisions are `.lifequest/manual-decisions/<id>.json`. Both are plain JSON so
  the vault stays portable and diffable.
- **Refusals are per-card, not per-page.** One unreadable decision file is
  reported once in the Log as `decision.unreadable` and skipped; the rest of the
  inbox still draws, and the broken file is left on disk for repair.
- **Reading needs no approval.** The companion can list and read decisions at any
  time; proposing is the part that creates a card, and only approving makes it
  real.

### What files a Decision

Agent writes from chat, an automation, or a paired MCP agent go through the same
proposal path. The targets the shipped companion tools file are: doctrine
documents, library notes (title, body and areas), reviews, projects (create,
update, close), goals, Architecture templates (day types, default week, default
weekly items), dashboard pin boards, ingest mappings, assumption sets, row
updates and deletes, column additions, agent-built dashboard views, and the
agent-pairing request a new MCP caller files on first contact.

Adding data is the exception. `create_database`, `insert_rows`, and `upsert_row`
without an `id` write immediately after the confirmation in the chat — that
confirmation is the yes — and each logs `database.created`, `database.row.created`
or `database.rows.created`, because there is no card to show the write afterwards.
`upsert_row` with an `id` (an update), `delete_row` and `add_column` keep the full
gate and write nothing until you approve them. The old `autoApproveInserts`
allowlist is retired; Settings → Hermes describes the split in its **Database
writes** row instead. See [Data and databases](./19-data-and-databases.md).

Other direct writes — named in chat rather than filed — are Daily Schedule tasks,
a conversational transaction whose amount and account are unambiguous, page
script blocks, and the companion brief. Reads are always free.

The inbox and its card renderer also support **Page** and **Finance kit** cards,
but no shipped companion tool files them. The only agent page write is a script
block, which applies directly, and a Finance kit install is the operator's own
button in Data — not an agent proposal — in this build.

Two preferences shape what gets filed, both under **Settings → Hermes**:
**File implied changes** (file one pending Decision when a chat proposes a
doctrine, library, goal or day-template change; on by default) and the
**Database writes** explanation row. See [The Companion](./24-companion.md).

## Tips and edge cases

- **The badge is the vault's, not the lens's.** A zero under the Health lens means
  there is no pending work anywhere. If you want the area's own count, pin the
  Dashboard's **Pending decisions** card.
- **Do not expect the page to move under you.** New arrivals are prepended, not
  scrolled to; if you are reading mid-list, the browser's scroll anchoring keeps
  your place.
- **Approving a card you changed approves your version**, not the agent's. If the
  agent's wording matters, choose **Revert to agent's version** in the editor
  before you answer.
- **Decisions are records, not drafts.** An approved or rejected proposal is not
  editable; the remedy for a wrong approval is a new proposal (or the companion's
  undo tools for captures). The editor exists for pending cards only.
- **Manual decisions are append-only and displayed newest first.** They are not
  editable or deletable from the UI; be deliberate before you log one.
- **You can file a proposal yourself.** On a locked library document or doctrine
  document, **Propose change** in the page's three-dot menu files a Decision
  instead of editing in place. It appears in History with the `You` chip; the
  document stays locked.
- **A pairing Decision belongs to no area**, so it carries no area badge and still
  appears in the global queue. Approving it from this sheet is the whole flow.

## Related

- [Companion](./24-companion.md)
- [Agents](./25-agents.md)
- [Doctrine](./07-doctrine.md)
- [Documents](./22-documents.md)
- [Dashboard](./06-dashboard.md)
- [The Log](./26-log.md)
