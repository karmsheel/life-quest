# Common workflows

Recipes for the things an operator actually does, in order, with the exact
controls. Each recipe links to the page that explains the feature in full.

Return to [Wiki home](./README.md).

## Set up LifeQuest from zero

1. Install the Hermes CLI (the companion). If it is missing, the launch screen
   says **Install Hermes Agent** and offers **Hermes install docs**.
2. Launch LifeQuest. The companion gate looks for the `lifequest` profile,
   creates and wires it if needed, and starts the gateway if it is not running.
   If it cannot connect, the screen names the reason and offers **Recheck**.
3. On the welcome screen choose **Create vault** and pick an empty folder. The
   vault seeds the four domains — Health, Intellectual, Emotional, Financial —
   with empty doctrine.
4. Open **Settings → Hermes** and confirm the probe line is **Ready**. Use
   **Companion profile** to switch profiles later, and **Recheck** after fixing
   anything the line reports.
5. Open **Settings → Appearance** to choose a theme (or leave the system one).
6. Choose the **Define** wing, open **Dream**, and write one domain's **Beliefs &
   Premise**. Press **Save**. That is the first useful thing in the vault.
7. Read [Getting started](./02-getting-started.md) for the full first-run walk,
   including where the vault and app data live.

## Define a domain

1. Select the domain in the top-bar lens.
2. **Define → Dream**: open **Beliefs & Premise**, **Purpose** and **Strategy
   (How)** one at a time. Write, then **Save**. **Lock** a document when it is
   settled; a locked document is read-only in place.
3. **Define → Vision**: open **Vision & Desire**, write the ideal state, **Save**,
   then **Lock**.
4. **Plan → Architecture** carries the same **Strategy (How)** document and adds
   the day types and weekly templates. See [Architecture](./08-architecture.md).
5. To change a locked document, unlock it first. The companion cannot lock or
   unlock; an agent's change to a locked document waits in **Decisions**.

Full detail: [Doctrine](./07-doctrine.md).

## Turn a vision into goals and projects

1. **Plan → Goals**. In the form, give the goal a **Name**, optionally a
   **Domain** and **Deadline**, and choose **Metric** or **Definition of done**.
   Fill the fields that choice asks for, then **Add**.
2. Click a goal row to edit it. Set **Status** to **Done** and **Save** to close
   it. **Plan this period** opens a planning session with the companion for the
   current period.
3. **Execute → Projects**, then **New project**. Fill **Title**, **Goal**,
   **Domain**, **Status**, dates, **Next action** and the **Context** body, then
   **Create project**.
4. On the project page, use **Where it stands**, **Progress**, **Context** and
   **Details** to keep it current. **Around this project** collates its tasks,
   signals, Decisions and activity.
5. Break the project into tasks on **Act** (set a task's **Project** field), or
   capture a thought on **Life-Chain** and choose **Make task**.

Full detail: [Goals](./10-goals.md), [Projects](./12-projects.md),
[Act](./14-act.md).

## Design a week and plan today

1. **Plan → Architecture**, pick the **Year**.
2. Under **Day types**, choose **New type**, name it, and build its **Checklist**
   (and clock items). Every change applies immediately.
3. Under **Default week**, give each weekday the day type it normally inherits.
   **Default weekly items** are the checklist items that repeat every week.
4. A particular week can be adjusted under **Real week** without changing the
   default. A week detaches when you edit it; **Reset to default** puts it back.
5. **Execute → Daily Schedule**. The day opens with the day type the default week
   gives this weekday; change it with the template picker (**None** clears the
   template rows).
6. Put items on the clock: **Place** on a leftover or task row, set start minute
   and duration, then **Place** again. As the day runs, change times and
   **Apply**, tick **Done**, or **Unplace** a block.
7. The live day is not drawn on the Life Map. The map is the calendar; the
   schedule is the day. Full detail: [Architecture](./08-architecture.md),
   [Daily Schedule](./13-daily-schedule.md).

## Run a weekly review

1. Choose **Review → Weekly**. The page opens on the current, still-in-progress
   period. Move with **‹ Prev** and **Next ›**.
2. With no file for the period, choose **Start the interview** (companion
   session) or **Write it myself** (editor only).
3. Write in **Document** mode; it saves itself, and Ctrl/Cmd+S saves now. Switch
   to **Preview** to read the rendered file. **Domains** shows each domain as
   **Missing**, **Draft** or **Done**.
4. For a domain section, select that domain in the lens and start its interview;
   it is added to the same file.
5. **Mark done** finishes the active scope. On **Overview** it marks the overall
   review done and locks the file; a domain's done does not lock the file.
   **Unlock** a locked review to edit it.
6. **Plan next period** starts the next period's planning session and opens
   **Goals**. **Review rules** edits the standing rules every session of this
   cadence receives.
7. **Daily notes in this period** lists the journal days in the window.

Full detail: [Reviews](./18-reviews.md), [Daily Note](./16-daily-note.md).

## Capture a thought and turn it into a task

1. **Life-Chain** on the governed shelf. The capture box has focus; its
   placeholder is **What's on your mind?**.
2. Type. **Enter** logs, **Shift+Enter** starts a new line. Optionally pick a
   **Domain** first (the default is **- unassigned -**), then **Log**.
3. The signal appears at the top of the list. Change its **Domain**, choose
   **Edit** to rewrite it, or **Delete** to remove it.
4. Choose **Make task** to create a backlog task from it; the button then reads
   **Open task** and takes you to **Act** with the card expanded.

Full detail: [Life-Chain](./15-life-chain.md).

## Log a purchase from chat

1. Install the Finance kit: on **Overview** or the Financial lens, choose
   **Install Finance kit** on the Dashboard card. This adds the ledger databases,
   starter pages, and **Scenario 1** / **Scenario 2** assumption sets.
2. In **Data**, set the **Capture** account behaviour (**Ask each time** or a
   default transactional account) and set up the **Exchange rate** source if you
   use USD amounts.
3. In the chat dock, type the purchase — for example "Bought food for R85 today"
   — or press **Attach a receipt** and add one image, then send.
4. The companion posts the row and names what it logged, for example
   `-85 ZAR on 2026-10-29 • Cheque • Food • Woolies`. The row appears in the
   **Transactions** database with `provenance` set to the chat thread.
5. If the amount or account is unclear, nothing posts: answer the companion's
   question in the thread, then the capture posts.
6. To undo the last capture in the thread, ask the companion to undo it.

Full detail: [Finance kit](./20-finance-kit.md),
[Data and databases](./19-data-and-databases.md).

## Build a database and put it on the Dashboard

1. **Home → Data**. With **Overview** selected, choose a **Domain** and type a
   **Name**, then **New database**.
2. Open the database. In **Columns**, name a column, choose its type, and
   **Add column** (`text`, `number`, `date`, `checkbox`, `file`, `select`,
   `relation`). In **Rows**, choose **Add row** and fill the cells.
3. Import a spreadsheet with **Import**: choose a **Target database**, drop a
   `.csv`, map the source columns, **Propose mapping**, approve the mapping in
   **Decisions**, then drop the file again and **Accept** the staged rows.
4. To turn the table into a card, ask the companion to build a view ("make me a
   card of spending by month"). Its `save_view` call saves the view and pins it
   to a board; on a locked board the change waits in Decisions.
5. Open the **Dashboard** for that lens, press **Pin board**, and pin any saved
   view or page. Arrange cards by dragging (or Enter and the arrow keys), and
   resize with **Edit card**.

Full detail: [Data and databases](./19-data-and-databases.md),
[Dashboard](./06-dashboard.md).

## Build a page with a script block

1. **Home → Pages**. Choose a **Domain** (or use the lens), type a **Title**, and
   choose **New page**.
2. On the page, pick **Script** from the block picker and choose **Add block**.
3. Give the script a name and write a read-only SQL `SELECT` against the domain's
   databases (or a small JSON object of queries and https fetches).
4. **Run** reads without saving; **Save** writes the page to
   `domains/<slug>/pages/<pageId>.json`.
5. To show the page on a board, open the Dashboard, **Pin board**, and choose the
   page's title. The card offers **Open page →**.

Full detail: [Pages](./21-pages.md).

## Hire an agent and pair an external one

1. **Home → Personnel**, choose **Scan Hermes agents**. The roster lists what the
   companion reports; a pending hire waits for approval.
2. Hire an agent with a role: an advisor, or the owner of a domain. **Active
   hires** lists the roster. A hire is not an MCP connection.
3. To let an external MCP client in, choose **Invite an agent**. The invite is a
   pairing request that becomes a pending Decision; approve it to issue a bearer
   for the loopback MCP door.
4. Grants start empty: each connected agent gets a domain and tool scope, and an
   unclassified tool is refused. **Unused invites** and **Active hires** manage
   the roster; revoking does not free a bearer already issued.
5. The companion's own write rules are unchanged: document changes go through
   Decisions, schedule and clear captures apply directly.

Full detail: [Personnel and agents](./25-personnel-and-agents.md).

## Ask the companion to change a document

1. Make sure **Settings → Hermes → File implied changes** is on (the default).
2. Ask in chat: "rewrite my Health purpose to focus on sleep."
3. The companion files a pending **Decision**; the rail's **Decisions** badge
   shows the count, and the card names the target and the change.
4. Open **Decisions**, read the proposal, and choose **Approve** or **Reject**.
   Nothing is written until you approve.
5. If the document is locked, approving the Decision does not unlock it. Locked
   documents stay read-only in place.

Full detail: [Decisions](./23-decisions.md), [Companion](./24-companion.md).

## Back up, move, or restore a vault

1. Quit LifeQuest first: Ctrl/Cmd+Q, or the window's close control. The vault is
   a folder; a clean quit means no half-written file.
2. Copy the whole vault folder to its new home. `domains/<slug>/data/domain.sqlite`
   is the live book and travels with the folder.
3. Reopen it with **Open vault** on the welcome screen, or **Settings → Vault →
   Change folder…**. Recent vaults live only on the welcome screen.
4. For a Git backup, export the domain books to JSON first: **Settings → Vault →
   Books → Export books**. The SQLite file is not merged as text.
5. To restore a book, tick the confirmation and choose **Restore books**. The app
   validates the JSON, backs up the current SQLite to `domain.sqlite.bak`, and
   then replaces the live book.
6. The vault is not encrypted at rest in this build: its confidentiality is the
   operating system account's. API keys never enter the vault.

Full detail: [The vault](./04-the-vault.md),
[Security](./29-security.md).

## Related

- [Getting started](./02-getting-started.md)
- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Glossary](./33-glossary.md)
