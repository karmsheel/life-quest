# Common workflows

Recipes for the things an operator actually does, in order, with the controls
LifeQuest 0.2.8 shows. Each recipe links to the page that explains the feature in
full.

Return to [Wiki home](./index.md).

## Set up LifeQuest from zero

1. Launch LifeQuest. If no companion is configured, the **LifeQuest companion**
   screen opens. Pick **Pi** (its blurb reads **Built in**) to use the built-in companion, or
   **Hermes** (**External sidekick**), which needs the Hermes CLI on your PATH.
2. For Pi, fill in **Endpoint**, **Model**, **Name** and, if the server needs one,
   **API key**. A local server works without a key. Choose **Save and connect**.
3. Choose **Create vault** and pick an empty folder. The vault seeds the base area
   **Life** and five areas that exist on disk but stay locked: Health, Mind,
   Finance, Business and Relationships.
4. The chat dock shows **Welcome to LifeQuest.** Choose **Begin the interview**.
   Talk about what is going on and what you want to change; the companion opens
   one to three areas itself, drafts their doctrine, and may add one table and one
   `First conversation — <date>` note.
5. The card becomes a receipt — *"After analyzing our conversation, I've opened up
   the Health and Business areas for you."* — with one **Continue**. That is the
   acknowledgement; nothing else is asked.
6. Read [Getting started](./02-getting-started.md) for the setup screen's failure
   messages and where the vault and app data live.

## Unlock an area

1. Open **Settings** (the gear, or the **Open settings** route) and choose the
   **Areas** tab.
2. Under **Unlock another area**, find the locked area — Health, Mind, Finance,
   Business or Relationships — and choose **Unlock**. There is no confirmation:
   unlocking is a reveal, not an activation, and the lens stays where it was.
3. **Your areas** now lists it. The area lens becomes a segmented control once a
   second area is unlocked, with **Life** first and the unlocked areas after it.
4. A locked area is invisible everywhere until then: no doctrine, databases,
   pages, boards or goals, and the companion cannot leak one.
5. To remove an area from the switcher, use **Archive** under **Your areas**; the
   folder and its contents stay in the vault. **Life** cannot be archived.

Full detail: [Areas](./05-areas.md).

## Define what an area is for

1. Select the area in the window title bar's area lens (or **Life** for the whole
   vault).
2. **Define → Dream**: open **Beliefs & Premise**, **Purpose** and **Strategy
   (How)** one at a time. Write, then **Save**.
3. Open the three-dot page menu in the top-right corner and choose **Lock** when a
   document is settled. The lock is the menu's first item and is a switch; the
   page stays open and read-only behind it.
4. **Define → Vision**: open **Vision & Desire**, write, **Save**, then lock it the
   same way. The **Vision board** sits below the doctrine cards; see
   [Images](./35-images.md) for writing it.
5. To change a locked document, choose **Unlock** in the same menu and edit, or
   choose **Propose change** from the menu while it stays locked. The proposal
   waits in **Decisions**.
6. **Plan → Architecture** carries the same **Strategy (How)** document and adds
   the day types and weekly shapes. See [Architecture](./08-architecture.md).

Full detail: [Doctrine](./07-doctrine.md).

## Turn a vision into goals and projects

1. **Plan → Goals**. Choose the cadence for planning, then **Plan this period** to
   open a planning session with the companion for the current period.
2. In the goal form give it a **Name**, optionally an **Area** and **Deadline**,
   and choose **Metric** or **Definition of done**. Fill the fields that choice
   asks for, then **Add**.
3. Click a goal row to edit it; set **Status** to **Done** and **Save** to close it.
4. **Act → Projects**, then **New project**. Fill **Title**, **Goal**, **Area**,
   **Type**, **Source**, **Source link**, **Status**, dates, **Next action** and the
   **Context** body, then **Create project**.
5. On the project page, use **Where it stands**, **Progress**, **Context** and
   **Details** to keep it current. **Repositories** lists the project's repo links
   when it has any. **Around this project** collates its tasks, signals, Decisions
   and activity.
6. Break the project into tasks on **Task Manager** (set a task's **Project**
   field), or capture a thought in **Quick Notes** and choose **Make task**.

Full detail: [Goals](./10-goals.md), [Projects](./12-projects.md),
[Task Manager](./14-task-manager.md).

## Design a week and plan today

1. **Plan → Architecture**, pick the **Year**.
2. Under **Day types**, choose **New type**, name it, and build its checklist (and
   clock items). Every change applies immediately.
3. Under **Default week**, give each weekday the day type it normally inherits.
   **Weekly-only items** are the checklist items that repeat every week.
4. A particular week can be adjusted under **Real week** without changing the
   default. A week detaches when you edit it; **Reset to default** puts it back.
5. **Act → Daily Schedule**. The day opens with the day type the default week
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
   period in one centred reading column. Move with **‹ Prev** and **Next ›**.
2. With no file for the period, choose **Start the interview** (companion
   session) or **Write it myself** (editor only).
3. Write in **Document** mode; it saves itself, and Ctrl/Cmd+S saves now. Switch
   to **Preview** to read the rendered file. **Areas** shows each area as
   **Missing**, **Draft** or **Done**.
4. For one area's section, select that area in the lens and start its interview;
   it is added to the same file.
5. **Mark done** finishes the active scope. On **Life** it marks the overall
   review done and locks the file; an area's done does not lock the file.
   **Unlock** a locked review to edit it.
6. **Plan next period** starts the next period's planning session and opens
   **Goals**. **Review rules** edits the standing rules every session of this
   cadence receives.
7. **Daily notes in this period** lists the journal days in the window.

Full detail: [Reviews](./18-reviews.md), [Daily Journal](./16-daily-journal.md).

## Capture a thought, a picture or a link

1. **Quick Notes** on the governance shelf. The box has focus; its placeholder is
   **What's on your mind?**.
2. Type a capture. **Enter** logs; **Shift+Enter** starts a new line. Or choose
   **Image** to attach one picture (or drag or paste one onto the box), or
   **Link** and type an absolute `http`/`https` address, then **Add link**. A
   capture may have no description when it has an attachment.
3. Pick an **Area** if you want one (the default is **- unassigned -**), then
   choose **Log**. The capture appears at the top of the list with its picture or
   link chip.
4. Change its **Area**, choose **Edit** to rewrite the description, or **Delete**
   to hide it. **Make task** creates a backlog task from it — an attachment-only
   capture is named from its picture or link — and the button then reads **Open
   task** and opens **Task Manager**.
5. The dock's Quick Notes surface is text-only: its field says **Log a signal…**
   and has no attachment controls.

Full detail: [Quick Notes](./15-quick-notes.md).

## Write the day in focus mode

1. Open **Daily Journal** on the shelf. The page is headed by the day, with the
   day's acts on its title row: **Today** (only on a day that is not today), the
   manual jobs such as **Analyze note**, and **Focus mode**.
2. Step a day at a time with the chevron keys, or open the calendar beside the
   date and choose a past day. Future days are closed.
3. Choose **Focus mode** to open the day alone on a page of paper. Write; the
   note saves itself, and the status band under the prose shows **Saving…** or
   **Not saved** only while it has something to say.
4. Press the day's act inside the sheet — **Analyze note** — to hand that chat to
   the dock when the sheet closes, or close the sheet with its cross, the scrim
   or Escape to come back to the page where you left it.

Full detail: [Daily Journal](./16-daily-journal.md),
[Automations](./17-automations.md).

## Log a purchase from chat

1. Unlock the **Finance** area first if it is not open yet (Settings → Areas →
   **Unlock**), because the kit can only install into a live area.
2. On **Life** or the Finance lens, choose **Install Finance kit** on the
   Dashboard's Finance card or the Data rail. This adds the ledger databases,
   starter pages and **Scenario 1** / **Scenario 2** assumption sets.
3. In **Data**, set the **Capture** account behaviour (**Ask each time** or a
   default transactional account) and set the **Exchange rate** source if you use
   USD amounts.
4. In the chat dock, type the purchase — for example "Bought food for R85 today"
   — or use the composer's attach control for one receipt image, then send.
5. The companion posts the row and names what it logged, for example
   `-85 ZAR on 2026-10-29 • Cheque • Food • Woolies`. The row appears in the
   **Transactions** database with `provenance` set to the chat thread.
6. If the amount or account is unclear, nothing posts: answer the companion's
   question in the thread, then the capture posts.

Full detail: [Finance kit](./20-finance-kit.md),
[Data and databases](./19-data-and-databases.md).

## Build a database and put it on the Dashboard

1. **Home → Data**. Choose the area in the lens — **Life** for a vault-wide table,
   or an unlocked area to own it — type a **Name**, then **New database**. With
   **Life** selected the table lands in the Life area; a legacy vault with no
   base area shows an **Area** selector instead.
2. Open the database. In **Columns**, name a column, choose its type, and **Add
   column** (`text`, `number`, `date`, `checkbox`, `file`, `select`, `relation`).
   In **Rows**, choose **Add row** and fill the cells.
3. A new database, a new row or a batch of rows written by the companion now
   applies directly after the confirmation in chat. Changing or deleting existing
   rows, and adding a column, still file a Decision.
4. Import a spreadsheet with **Import**: choose a **Target database**, drop a
   `.csv`, map the source columns, **Propose mapping**, approve the mapping in
   **Decisions**, then drop the file again and **Accept** the staged rows.
5. To turn the table into a card, ask the companion to build a view ("make me a
   card of spending by month"). Its `save_view` call saves the view and pins it
   to a board; on a locked board the change waits in Decisions.
6. Open the **Dashboard**, use the three-dot **Dashboard actions** menu, choose
   **Pin board**, and pin any saved view or page. Arrange cards by dragging (or
   Enter and the arrow keys), and resize with **Edit card**.

Full detail: [Data and databases](./19-data-and-databases.md),
[Dashboard](./06-dashboard.md).

## Build a page with a script block

1. **Home → Pages**. Choose the area in the lens (**Life** or an unlocked area),
   type a **Title**, and choose **New page**. A page created on **Life** belongs
   to the Life area; a legacy vault with no base area shows an **Area** selector.
2. On the page, pick **Script** from the block picker and choose **Add block**.
3. Give the script a name and write a read-only SQL `SELECT` against the area's
   databases (or a small JSON object of queries and https fetches).
4. **Run** reads without saving; **Save** writes the page to
   `domains/<slug>/pages/<pageId>.json`.
5. To show the page on a board, open the Dashboard's **Dashboard actions** menu,
   choose **Pin board**, and choose the page's title. The card offers **Open
   page →**.

Full detail: [Pages](./21-pages.md).

## Hire an agent and pair an external one

1. **Home → Agents**. The page lists the companion, the agents connected over MCP,
   and the Hermes agents you have hired.
2. With the Hermes companion active, choose **Scan Hermes agents**. The roster
   lists what the companion reports; hire one with **Hire**, or **Dismiss** a
   result you do not want.
3. To let an external MCP client in, choose **Invite an agent**. The page shows a
   one-time code and when it expires; send it to the agent. Its first contact
   files a pairing Decision — approve it in **Decisions** to activate the row and
   issue the connection.
4. Grants start empty: set the agent's areas and tools, and an unclassified tool
   is refused. **Unused invites** can be **Drop**ped; **Revoke** removes an active
   connection.
5. To narrow where an agent appears, use Settings → Hermes → **Agents by area**:
   **Shown in** sets its areas (none means all), **Default in** makes it the
   agent selected when you enter one.

Full detail: [Agents](./25-agents.md), [Decisions](./23-decisions.md).

## Set up or switch the built-in Pi companion

1. With a vault open, go to **Settings → Hermes**. Under **Companion**, choose **Pi**
   (blurb **Built in**).
2. The **Built-in endpoint** section appears: **Endpoint** (an OpenAI-compatible
   base URL), **Model**, **Name** and **API key**. A local server works without a
   key. Choose **Save and connect**.
3. Pi stores its endpoint and model in `%APPDATA%\LifeQuest\pi-endpoint.json`, its
   key is sealed by the OS, and its transcripts live in
   `%APPDATA%\LifeQuest\pi-sessions\`. None of it is in the vault.
4. Switch back to **Hermes** (**External sidekick**) at any time from the same picker;
   the **Companion profile** section appears only while Hermes is selected. Each
   companion keeps its own chats.
5. On a fresh machine the same setup is offered before the vault opens, under the
   **LifeQuest companion** heading, with **Recheck** as the retry.

Full detail: [Companion](./24-companion.md), [Settings](./28-settings.md).

## Ask the companion to change a document

1. Make sure **Settings → Hermes → File implied changes** is on (the default).
2. Ask in chat: "rewrite my Health purpose to focus on sleep."
3. The companion files a pending **Decision**; the rail's **Decisions** badge shows
   the count, and the card names the target and the change. The inbox is one
   global shelf, so the Decision is visible whatever lens you are on.
4. Open **Decisions**, read the proposal, and choose **Approve** or **Reject**.
   **Edit** lets you correct a pending proposal first (**Save changes**,
   **Approve with changes**, **Revert to agent's version**), and **Approve all**
   answers the queue.
5. If the document is locked, approving the Decision does not unlock it. Locked
   documents stay read-only in place; the composer's page menu carries **Propose
   change** and **Unlock**.

Full detail: [Decisions](./23-decisions.md), [Companion](./24-companion.md).

## Pin, archive and restore a chat

1. In the rail's **Chats** list, hover a chat row. **Pin chat** and **Archive
   chat** appear on the hover, and the row's three-dot menu carries **Pin** /
   **Unpin**, **Rename**, **Archive** and **Delete**.
2. A pinned chat leads the list and becomes a permanent square tab in the dock's
   tab strip. Right-click the square for **Unpin**; archive and delete are hidden
   until a chat is unpinned.
3. Choose **Archive chat** (hover control or the row menu) to take the chat out of
   the working list and out of the strip. Archived chats can be restored but not
   opened.
4. Use the **View options** icon in the **Chats** header: **Hide archived** (the
   default working list), **Show archived** (live rows, then a greyed band tagged
   **Archived**) or **Only archived** (the archive alone; empty says **No archived
   chats**).
5. Restore an archived row with **Unarchive**. New chat opens its own tab beside
   the chat you were in, and the tab strip is remembered across an app restart.

Full detail: [Companion](./24-companion.md).

## Back up, move, or restore a vault

1. Quit LifeQuest first: Ctrl/Cmd+Q, or the window's close control. The vault is a
   folder; a clean quit means no half-written file.
2. Copy the whole vault folder to its new home. `domains/<slug>/data/domain.sqlite`
   is the live book and travels with the folder; the JSON indexes travel beside
   it.
3. Reopen it from the rail-foot vault chip's **Switch vault** dialog (recent
   vaults, with the open one marked **Open now**, and **Open another folder…**), or
   from the welcome screen's **Open vault**. **Settings → Vault → Vault folder →
   Change folder…** does the same.
4. For a Git backup, export each area's tables to JSON first: **Settings → Vault →
   Books → Export books**. The SQLite file is not merged as text.
5. To restore a book, arm that area's **Allow restore** switch, then choose
   **Restore books**. The app validates the JSON, backs up the current SQLite to
   `domain.sqlite.bak`, and then replaces the live book.
6. The vault is not encrypted at rest in this build: its confidentiality is the
   operating system account's. API keys never enter the vault.

Full detail: [The vault](./04-the-vault.md),
[Security](./29-security.md).

## Related

- [Getting started](./02-getting-started.md)
- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Glossary](./33-glossary.md)
