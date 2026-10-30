# Decisions

Decisions is the approval queue for changes an agent proposes to the vault, plus
the log of decisions you make yourself. Every agent write that can change meaning
— doctrine, a library note, a review, a project, a goal, a template, a pin board,
an ingest mapping, a ledger row, a dashboard view, an agent pairing — is frozen
into a proposal file and waits here. Approving it writes the change; rejecting it
leaves the vault exactly as it was. Nothing else in the app can approve an
agent's write. See also [Wiki home](./index.md).

## Where it lives

- Rail: the governed shelf above the Log, label **Decisions**, clipboard icon.
  The route is `/decisions`.
- It is a sheet, not a page: it opens over whatever you were reading, dims the
  window, and closing returns you to that page with its route, scroll position
  and state intact. Same frame as [Settings](./28-settings.md).
- The rail row carries a badge with the number of pending proposals for the lens
  you are looking through. Hover or screen-read it and the label reads
  "Decisions, 3 pending"; at three digits it caps at `99+`.
- Most proposals are filed by the companion, so the authoring half of this page
  lives in [The Companion](./24-companion.md).

## What it is for

The app separates *proposing* a change from *making* it. An agent may read the
whole vault whenever it needs to, but a write that changes what a document, a
board or a ledger says must be reviewed by you first. Decisions is that review
surface: it shows the target, who proposed it, which domains it touches, what
would change field by field, and lets you approve or reject it in one click.

The second job is the opposite: recording a decision you already made yourself.
That is not a proposal and nothing is waiting on it, so it is logged rather than
filed — the **Manual** tab — and it lives in a separate store that the approval
path can never read.

## How to use it

1. Open **Decisions** on the rail. The sheet opens on the **Pending** tab.
2. Read a card: the kicker names the kind of target, the status pill says
   `pending`, the title names the change, and the line under it names the actor,
   the domain or domains, and when it was filed.
3. Read the body. A structured proposal leads with a sentence such as
   "Update this project." or "Set 3 pins." and then a table under the headings
   **Field**, **Now** and **Proposed**. Prose proposals show **Current** and
   **Proposed text** side by side. Open **Exact proposal** to see the raw JSON
   that will be applied.
4. Choose **Approve** to write it, or **Reject** to discard it. The card reports
   "Decision approved." or "Decision rejected." and moves to **History**.
5. Switch to **History** to read what was resolved. The filter row offers
   **All**, **Manual** and **AI**; every card wears a source chip — `AI` for an
   agent proposal, `You` for one you filed yourself, `Manual` for a logged
   decision — and a `Logged` pill where a proposal would say approved or rejected.
6. Switch to **Manual** to log a decision you made. Fill in **What did you
   decide?**, optionally **Why? (optional)** and **Domain (optional)**, then
   choose **Log decision**. The record appears immediately under **Your manual
   decisions** and in History.

Empty states: **Pending** says "No pending proposals." History says "No
decisions yet. Log one yourself on the Manual tab, or wait for a proposal."
(with the source filters narrowing that to "No resolved AI decisions yet." or
"No manual decisions logged yet."). The Manual tab's recent list says "No manual
decisions logged yet."

## The screen

| Part | What it does |
|---|---|
| The sheet frame | Title **Decisions**, subtitle "Approve a proposal to write it into the vault. Reject it to leave the vault as it is." Closes by the cross, a click on the scrim, or Escape. |
| Tabs | **Pending**, **History**, **Manual**. |
| History filters | **All**, **Manual**, **AI** — which store the list is drawn from. |
| Arrival line | One quiet line above the list: "New decision filed by <name>." or "N new decisions filed." |
| Card kicker | Target kind, a `New` chip for a fresh arrival, and the status pill: `pending`, `approved`, `rejected` — or `Could not apply`. |
| Card body | The diff or prose comparison, plus a collapsible **Exact proposal**. |
| Pending actions | **Reject** (danger) and **Approve** (primary). Both disable while the answer is in flight. |
| Manual form | **What did you decide?**, **Why? (optional)**, **Domain (optional)** with a **No domain** choice, and **Log decision**. |

The target kind on the kicker reads, depending on the proposal: a doctrine label
such as **Beliefs & Premise**, **Vision & Desire**, **Purpose**, **Strategy
(How)**; **Library note**; **Review**; **Page**; **Pins**; **Mapping**;
**Finance kit**; **Assumptions**; **Goal**; **Day template**; **Project**;
**Database**; **Database row**; **Database rows** (one card for a batch);
**Agent pairing**; **Dashboard view**.

## Rules and behaviour

- **Only pending proposals can be answered.** Resolving a card that is already
  approved or rejected is refused with `Decision is already approved`. An approval
  that cannot be applied for a reason no retry can fix is recorded as rejected
  with a reason, and the card says "Rejected · proposal no longer applies." with
  that reason underneath, so it never reads as a decision you declined.
- **Approve writes; nothing else does.** The apply path writes the target file
  directly, preserving what the target had before. A transient failure (a locked
  file on disk, a disk error) leaves the record pending so you can approve again.
- **The inbox is live and quiet.** A decision filed while the sheet is open is
  added to the list without a spinner or a reload; the card wears an accent pulse
  and a `New` chip for six seconds, and the arrival line names who filed it. The
  rail badge pulses for four seconds when the count grows — it does not pulse
  when the count shrinks, because approving is not news.
- **The lens filters the inbox.** You see proposals for the domains in your
  current lens; a proposal filed for another lens still exists and still counts
  on the rail only when the lens matches. Agent pairing proposals belong to no
  domain and stay visible under every lens.
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
  resolved twice. A logged decision must have a title; an empty one is refused
  with "Say what you decided before logging it". A named domain must be live.
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
documents, library notes, reviews, projects (create, update, close), goals,
Architecture templates (day types, default week, default weekly items), dashboard
pin boards, ingest mappings, database and ledger work (a row write, a batch insert,
a new database, a new column), assumption sets, agent-built dashboard views, and
the agent-pairing request a new MCP caller files on first contact.

The inbox and its card renderer also support **Page** and **Finance kit** cards,
but no shipped companion tool files them. The only agent page write is a script
block, which applies directly, and a Finance kit install is the operator's own
button in Data — not an agent proposal — in this build.

The exceptions — writes that apply directly and are named in chat — are schedule
tasks, a conversational capture of an amount plus an account, and page script
blocks. Reads are always free. See [The Companion](./24-companion.md) for how to
watch those direct writes land.

Two settings shape what gets filed, both under **Settings → Hermes**:

- **File implied changes** — when a chat proposes a doctrine, library, goal, or
  day-template change, file one pending Decision. On by default; turn it off and
  the chat describes the change without filing it.
- **Apply assistant inserts immediately** — a per-database allowlist under that
  heading. New rows the assistant proposes in a checked database are applied
  immediately; updates, deletes, and other databases still wait in Decisions. A
  bulk load is one card for the batch (up to 200 rows per card), and a matching
  allowlist entry applies that one card straight away. The allowlist lives in
  `autoApproveInserts` in `.lifequest/settings.json` and starts empty. Unchecking
  a database does not undo rows already written.

## Tips and edge cases

- **You can file a proposal yourself.** On a locked library document or doctrine
  document, **Propose change** opens a dialog that files a Decision instead of
  editing in place. It appears in History with the `You` chip; the document stays
  locked.
- **Do not expect the page to move under you.** New arrivals are prepended, not
  scrolled to; if you are reading mid-list, the browser's scroll anchoring keeps
  your place.
- **The count is lens-relative.** A zero badge under the Health lens does not mean
  the vault has no pending work — switch to **Overview** to see everything.
- **Decisions are records, not drafts.** An approved or rejected proposal is not
  editable; the remedy for a wrong approval is a new proposal (or the companion's
  undo tools for captures).
- **Manual decisions are append-only and displayed newest first.** They are not
  editable or deletable from the UI; be deliberate before you log one.

## Related

- [The Companion](./24-companion.md)
- [Personnel and Agents](./25-personnel-and-agents.md)
- [Doctrine](./07-doctrine.md)
- [Documents](./22-documents.md)
- [Reviews](./18-reviews.md)
- [The Log](./26-log.md)
