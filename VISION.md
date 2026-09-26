# Vision

LifeQuest exists so that one person can hold their whole personal life in one organizing space, from the life they want down to what they do today.
It serves a single operator per vault, and it turns that vault into a space across domains such as health, intellectual, and finance.
Other operators may run their own local vault from a Windows download.
It owns exactly one thing: the life vault as the database of that life, shown through a desktop studio that keeps vision, goals, timeline, projects, daily work, and the operator's own tables and pages coherent.

## Vault is identity

Opening a vault is identity.
The product does not require an account or a hosted database to use a vault.
The vault is the operator's life database: doctrine, goals, projects, map, library, capture, decisions, log, domain databases, and pages live in that folder on disk.
Doctrine, library, reviews, and pages are prescribed files.
A domain database's rows live in a SQLite file inside that domain folder.
That file is the live book: copy the folder and the books come with it.
It is not a LifeQuest-hosted replica, and it is not merged as text in git.
A JSON export of those tables is welcome as the git-portable form of the books.
Restore from that JSON may rebuild the SQLite file as an explicit Settings action with confirmation.
Restore is not an automatic git hook.
A private Git remote the operator owns is a welcome backup.
A LifeQuest-hosted copy of the vault is not.
Whole-vault encryption is welcome, on by default for new vaults, and skippable.
Creating a vault does not require a passphrase.
API keys, calendar tokens, and Sheet or Notion tokens do not enter the vault; they stay in OS secure storage.
Chat transcripts stay with Hermes.
The product records who wrote each change, operator or agent, so the operator stays in the loop.
The last domain lens may live in app userData so the studio reopens where the operator left it.
The vault layout is LifeQuest's contract, including domain data and pages when those exist.
A domain may gain operator-created databases and pages.
Pages may include operator-authored script that queries that domain's databases and may call fetch.
That is customization of this vault, not a hosted LifeQuest app runtime, and not a promise that a foreign Notion or Obsidian workspace will open as a vault.
The product is not an Obsidian clone and not a Notion clone.
A database may be local-only, linked-canonical to a Google Sheet, a Notion database, or an operator-chosen URL, or local-canonical with a mirror.
An operator-chosen URL may refresh FX, marks, balances, and new transactions on vault open, without a Decision, the same family as a linked Sheet pull.
That URL is not an embedded bank-login screen and not a hosted LifeQuest feed.
Linked-canonical still works offline: writes queue in the vault and conflicts prompt on reconnect.
Conflicts on a linked database prompt in the studio, as calendar conflicts do.
Kits are optional schema, meaning, and starter pages installed into a domain.
Finance is the first kit; further kits, including business books, are welcome in the same vault.
A kit is installed, not silently seeded as a second ledger.
Kit install may pin starter pages on Overview as well as on the domain board.
Agents propose kit install through Decisions; they do not apply it overnight.
The operator has one organizing space, not a work vault and a life vault as the intended product.
The desktop source may be public; vaults stay private on each operator's disk.

## Doctrine, goals, and the day

Each domain holds four sections: beliefs and premise, vision and desire, purpose, and strategy.
Goals are their own vault records: deadline, domain, and either a metric and target or a written definition of done.
From vision the operator extracts those goals, maps them onto a timeline, and breaks them into projects and then into tasks.
A Project is a vault document linked to a goal.
Home is a pin board per domain lens.
Goal progress and deadline pressure remain available as pins.
Live goal progress on Home is not a scoreboard, and gauges are refused.
Data and Pages sit on the Home wing; they are domain-owned and lens-filtered.
Overview is a virtual lens, not a vault folder, and shows the union of databases and pages.
The week may sync with the operator's existing calendar; both sides may write, and conflicts prompt in the studio.
A calendar event that did not start in LifeQuest does not become a Map task.
A task may be completed by the operator or handed to an agent.
Hired agents may advise, or own a domain; when they act, the vault records which agent.
Agents may complete tasks and rearrange the live Daily Schedule without a Decision.
Agents may log a conversational transaction without a Decision when amount and account are unambiguous; the chat names what was logged.
If amount or account is missing, the companion asks in chat and does not post until the operator answers.
Agents may apply a page script block the same way: write, then the chat names what changed, without a Decision.
A domain-owning agent may prepare tomorrow's Daily Schedule overnight; the operator can discard it in the morning.
Agent writes to doctrine, library, reviews, projects, goal records, Architecture templates, pages other than script blocks, pins, ingest mappings, posted ledger edits, and kit install go through Decisions.
The companion may file those Decisions whenever a chat turn implies a document change; the operator can disable that.
Reads do not need approval.
The operator writes directly.
The studio does not use an agent lock.
Life Map is the timeline and calendar of this vault, not a second app.
Architecture is where the operator designs day templates: habits, schedule, and the ideal day, as many as they need.
Execute includes a Daily Schedule: pick a template, then record the actual day as it unfolds, rearranging when things run over or finish early.
A habit tracker is welcome as its own Execute page and may show consecutive-day streaks there.
Consecutive-day streaks do not live on Daily Schedule.
Life-Chain is a capture surface for thoughts before they evaporate.
A capture may become a task without turning the chain into an inbox.
Conversational money capture on the desktop is the same family as Life-Chain.
The phone may queue a draft transaction while the studio is quit; it does not post until the companion confirms in chat.
The phone may show a metric the operator pinned.
It does not carry the Finance kit, edit doctrine, talk to Hermes, or open Architecture.
Capture may write into the vault while the studio is quit.
Dream, Life Map, Architecture, Daily Schedule, and Act stay reachable.
The studio is not a sequential unlock quest.

## The studio is the work surface

The daily surface is three paper panes on a canvas: rail, main, and chat.
Wings filter the rail, not page data.
The domain switcher is the data filter for domain-scoped lists.
Overview is a virtual lens, not a vault folder.
Chrome is useful, dense, and calm, except for the deadline pressure the operator asked the timeline to apply.
LifeQuest does not look like a generic chatbot wrapper, a dark terminal, a habit-tracker scoreboard on Daily Schedule, or a game HUD.
A pin board of spend and net worth is welcome, including on Overview after kit install.
A Home that feels like a metrics terminal is not.
It does not restyle toward BERD glass, dot-grid, or novelty-first AI visuals.

## Hermes is required for the studio, and is not the product

The studio does not open without the companion.
Capture is not the studio.
LifeQuest owns the vault, the MCP door, and the UI.
Hermes owns the agent loop, memory, skills, and transcripts, through one named lifequest profile in the chat pane.
The desktop attaches to that profile if it is up and starts it if it is not.
It does not bundle Hermes, and it does not kill a gateway it did not start.
The renderer never holds the raw API key.
Personnel hires other agents as advisors or domain owners, not as a human CRM.
Agentic intelligence exists to keep the operator coherent across vision, goals, strategy, tasks, and the numbers that sit in their vault.

## Scope

LifeQuest is not a SaaS, not a hosted web app, not an Obsidian clone, not a Notion clone, not a household calendar, not a shared household budget, not an embedded bank-login product, not a second work vault, and not a Hermes GUI that happens to have files.
The archived Next.js and Prisma tree is not the product runtime.
The desktop studio is Windows; other desktop OS builds are not the product.
The phone client does not change that.
Windows packaging includes a signed installer and auto-update so other operators can run and stay current without Node.
Auto-update asks before it installs.
The repo may be public.
There is no multi-user tenancy and no shared domain.
Personal material stays in the operator's vault folder and in OS secure storage.
Laws name observable product invariants; token naming is not a law.

A change aligns when it deepens a local vault's hold on vision, goals, projects, timeline, daily doing, or operator-owned domain data, for this operator or another, with Hermes in the studio loop, Decisions on document and kit-install writes, in-chat naming of conversational capture and script-block writes, and the live ledger remaining inside the vault folder.
A change should be resisted when it lets the studio open without the companion, requires a passphrase to create a vault, silently replaces the app binary, turns a foreign calendar event into a Map task, adds a LifeQuest-hosted copy of the vault, puts the live ledger outside the vault folder, opens an embedded bank-login screen as the product, shares a vault across people, splits life into work and personal vaults as the product, restores sequential room locks, ships another desktop OS as the product, puts streaks on Daily Schedule, lets Hermes post money when amount or account is still missing, lets the phone post money without companion confirmation, lets an agent install a kit without a Decision, restores JSON as a silent git hook, or turns the shell into a chatbot, scoreboard, or hosted service.
