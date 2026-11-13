# Companion

The companion is the agent that lives in the chat dock and does the thinking for
the studio. LifeQuest ships two: the built-in **Pi**, which runs inside the app
and needs only an OpenAI-compatible endpoint, and **Hermes**, an optional external
companion that runs as a Hermes profile on a gateway. A vault runs on one of them
at a time, and every chat belongs to the vault and the agent that made it: Pi is
every vault's default, and a vault gains Hermes only when you add a Hermes agent
to that vault. What remains in the studio is what only the studio can own — the
vault, the tools that read and write it, the locks, and the
[Decisions](./23-decisions.md) queue that reviews agent writes. See also
[Wiki home](./index.md).

## Where it lives

- The **chat dock** is the right-hand pane of the three-pane studio; the side
  switch in its bottom bar swaps it to the left. It is present on every page,
  collapses to a launcher mark, and its width is dragged with the divider between
  it and the page.
- A vertical **agent switcher** strip sits at the dock's top-right edge: one block
  per agent this vault has, offered in the area you are looking at.
- The **Chats** list is the middle of the rail, under the wing's pages and above
  the governed shelf. It lists every conversation of the vault and agent you are
  using.
- **Settings → Hermes** is the companion page. It leads with the **MCP doors**,
  then **Connection**, then **Agents in this vault**, then **Agents by area**,
  then the **Built-in endpoint** (Pi) or the Hermes connection facts, and last the
  **Chat behaviour** rows.
- Before the app opens, a **LifeQuest companion** pane reports the boot: the
  setup form for Pi, or the Hermes profile picker, with **Recheck**.
- There is no page route for chat. The dock is chrome, like the rail; its state
  (which chats are open, the pending attachments, the cards in context) belongs
  to the session, not to a file in the vault.

## What it is for

The companion runs the turn: it plans, calls tools, remembers, and streams tokens
back. The studio's job is to be the thing those tools act on. So a question typed
into the dock can read the vault, propose a document change, log an expense, or
build a dashboard card, and the transcript of that work lives with the companion
that made it — in the Pi session store, or in the Hermes profile that Hermes
Desktop also reads.

**Pi** exists so the studio works on a fresh machine: no Hermes CLI, no gateway,
no profile — an endpoint and a model name. **Hermes** is for an operator who
already runs Hermes, wants their memory and skills, and wants the same chat from
Hermes Desktop and other channels. The vault is the profile that is loaded, so the
agent is scoped to the vault: a new vault starts on Pi with no chats, and a vault
gains a Hermes agent only when you add one there. A Hermes agent is a Hermes
profile, and a profile carries memory, skills and knowledge — which is why a
fresh profile for the vault is the default, and reusing one that already works on
another vault is a separate, explicit choice.

## How to use it

### First run with the built-in companion

1. On a fresh machine the **LifeQuest companion** pane is titled **Set up the
   built-in companion** and says "Point it at an OpenAI-compatible endpoint and
   name a model. A local server works without a key."
2. Fill in the form: **Endpoint** (default `https://api.openai.com/v1`), **Model**,
   **Name** (the provider label, default `OpenAI-compatible`) and **API key**.
   A local server (Ollama, LM Studio, llama.cpp) needs no key.
3. Choose **Save and connect**. The button reads **Saving…** while it works.
4. The endpoint and model are stored in `%APPDATA%\LifeQuest\pi-endpoint.json`; the
   key is sealed by the OS and never written into the vault. On a machine with no
   OS keyring the form says so and keeps the key for that session only.
5. Once Pi answers, the studio opens on the vault. If a vault is not open yet you
   land on the welcome page.

### Add a Hermes agent to this vault

Every vault starts on **Pi** and nothing else. A Hermes agent is added to the
vault, not to the app, so the next vault you open does not inherit it.

1. Open **Settings → Hermes → Agents in this vault**. The **Pi** card is always
   there, marked active while the vault runs on Pi. The **Hermes** card says
   **This vault has no Hermes agent** until one is added.
2. Choose **Create a new agent for this vault**. The app creates a Hermes profile
   named after the vault (for example `lifequest-personal-1a2b3c4d`) the first
   time it is used, seeds its SOUL and MCP entry, and binds it to this vault. The
   new profile starts with its own memory: nothing from another vault is in it.
3. Or choose **Use an existing agent…** to bind a profile that already exists.
   Every installed profile is listed with the vaults it already works on, and a
   warning says that memory, skills and knowledge will be shared with them. This
   is the only way two vaults share one agent, and it is never the default.
4. The **Hermes** pill appears in the dock's agent switcher. Choose **Use Hermes**
   to make it the vault's answering agent; **Use Pi** goes back. A switch is
   instant: the studio is not taken away while the target boots, and the target's
   block wears a pending mark until it answers.
5. With Hermes selected, **Connection** shows the probe line and the read-only
   **CLI**, **Profile** and **API** facts, **Recheck** (it reads **Checking…**
   while it works) and **Open profile folder**.
6. There is nowhere in the app to type a Hermes gateway URL or API key. That
   profile's own `.env` holds the key, the app reads it in the main process, and
   the renderer never receives it.
7. **Remove from this vault** unbinds the agent and the vault falls back to Pi.
   The profile and its memory stay on disk, so you can add it back — to this
   vault or, explicitly, to another one.

The **Companion profile** picker still exists on the setup screen, before a vault
is open: that is the boot choice for the machine, and opening a vault applies the
vault's own binding.

### Choose which agent answers where

1. **Settings → Hermes → Agents by area** lists each agent with **Shown in** and
   **Default in** chips.
2. **Shown in** is the visibility rule: **All areas**, or a set of unlocked areas.
   An agent scoped to other areas is simply absent from the dock's switcher in this
   one, not greyed out.
3. **Default in** is a subset of what it is shown in: entering an area with a
   default selects that agent for the dock.
4. The dock's **agent switcher** offers what is visible now; the active block wears
   the accent ring, and a switch still coming up wears a quiet pending mark.

### Open, start and close chats

1. The dock is open on launch. If it is collapsed, click the launcher mark on the
   edge of the page (its label is **Open Hermes chat** in every build).
2. Choose **New chat** in the Chats list, or the **New chat** button in the dock's
   bottom bar. A live blank chat is reused rather than piling up empty ones; an
   archived blank stays in the archived view and is not reopened.
3. Click a row in **Chats** to load that conversation. A middle-click on the row —
   or **Chat actions** then **Open in new tab** — opens a second tab beside the
   current one.
4. The **tab strip** leads the dock, above the name of the chat in front, and is
   drawn whenever the thread has a tab, even a single one. The **+** at its
   trailing edge (**New chat tab**) opens a fresh chat in a tab of its own. Tabs
   are remembered per vault and agent: quit and reopen and every tab returns in
   the same order, with the chat that was in front still in front. A remembered
   chat that was archived or deleted in the meantime loses its tab.
5. **Pinned chats are permanent tabs.** A pinned chat is drawn as a small square
   with the label's first letter and a pin, at the head of the strip, with no close
   control. Right-click an ordinary tab for **Pin**, **Rename**, **Archive** and
   **Delete**; a pinned tab's **Tab actions** menu offers **Unpin** alone. Close
   an ordinary tab with its **×**, a middle click, or **Ctrl+W** (**Cmd+W** on
   macOS).
6. Archiving the chat in front closes its tab and brings its neighbour forward. If
   it was the last open chat, the dock stays on the thread and opens a blank
   **New chat**, so an archive never throws you out of the dock.
7. **Delete** asks first: "Delete "<name>"? Its messages leave Hermes everywhere,
   and this cannot be undone." Renaming, pinning and archiving are durable flags on
   that companion, so its other surfaces see them too.

### Search and the archive

1. The **Chats** header carries **Search chats** and **View options** beside the
   title. Search replaces the header with a field; the cross, a press outside it,
   or Escape (**Close search**) hands the header back.
2. **View options** chooses how archived rows appear: **Hide archived** (the
   default working list), **Show archived** (live chats, then a greyed band tagged
   **Archived**), or **Only archived** (the archive alone).
3. An archived row cannot be opened while it is archived. Its row menu offers
   **Unarchive**, which writes the durable flag back.
4. Pin and archive also appear on the row itself on hover (or keyboard focus):
   archive first, pin rightmost. A pinned row shows a filled pin at rest, and has no
   archive control — unpin first.

### Talk to it

1. Type in the field placeholdered **Message Pi…** or **Message Hermes…**.
   **Enter** starts a new line; **Ctrl+Enter** (**Cmd+Enter** on macOS) sends.
2. While a turn runs the send control becomes **Stop this run** and the transcript
   shows a live status line such as **Working… 6s · reading the note**. The field's
   placeholder becomes **Steer the turn that is running…**.
3. To add to a live turn, type and choose **Steer** — the words go into the run that
   is already working. To line a message up behind it, choose **Queue**; queued
   rows appear under the composer labelled **Queued**, each with **Remove queued
   message**. Ctrl/Cmd+Enter steers while a turn is running.
4. Read the turn as a work log. Your messages are labelled **You**, the
   companion's **Pi** or **Hermes**; a steered message wears a `steered` mark, and
   each bubble has a time and a copy control (**Copy message**, then **Copied**).
   Between the question and the answer sits the turn's process: its reasoning (a
   **Thought** row, or **Thinking preview** when the agent only samples it), any
   commentary or narration, and one row per tool call such as
   "get_database · 4e89…" with its state, its duration and, on click, its
   arguments and result. While the turn runs the process stays open; when it
   settles it folds to one header such as "Worked for 1s · Used 4e89…", and
   clicking the header reopens it.
5. Below the process is the answer, never inside it, and a footer with the
   outcome: **Completed · 1s · 1.4k tokens**, or **Stopped**, **Failed** or
   **Ended before finishing** with the reason. A failed, stopped or incomplete
   turn keeps its process open so the cut-short work stays visible. Reloading the
   chat rebuilds the same rows, fold, footer and token count from the companion's
   own transcript.
6. The same work log is drawn for both agents, but only from what the agent can
   honestly report: Pi streams results, real reasoning and its own tool timings as
   they happen; Hermes' session stream delivers results with the turn's final
   snapshot, shows thinking only as a preview, and the row's duration is the app's
   own clock, labelled as such. Nothing is timed, counted or worded on the agent's
   behalf when it did not say so.
7. If the companion asks for approval mid-turn, the transcript shows the request
   with **Allow once** and **Deny**. Nothing else in the app can approve it.
8. The empty chat shows **Ask Pi** or **Ask Hermes** and the active area. Under it,
   **Start with a question** offers your saved questions that fit the screen, each
   with its scope; clicking one sends it as the first turn. With no saved question
   for this screen the dock says **No questions set** and links to
   **Settings → Questions**; when starters are shown, **Edit questions** is the way
   back to the same page.
9. A turn is live while the companion is still sending. If its stream goes quiet
   for 45 seconds — a gateway that wedged, or a connection that was cut without
   saying so — the app closes the turn itself rather than leaving it running: the
   rail's dot clears, the composer unlocks, and the turn's footer reads **Ended
   before finishing**. A stream that closes without a final frame is treated the
   same way rather than passed off as complete. The transcript is re-read from the
   companion at the same moment, so an answer it had already stored is not lost.
   Send again if the reply is not there.
10. A chat keeps its own model. Hermes runs every turn of an existing chat on the
   model that chat's session was created with — a pick only rode the turn, so a
   retired model used to strand old chats while a new chat answered. The model
   pill now writes the chat's model on its Hermes session, and a chat the provider
   no longer serves says so above the composer: **This chat is set to … which this
   profile no longer offers**, with **Use <model>** moving it onto the model the
   profile uses now. The pill names the chat's own model when you have not picked
   one, so it always names the model the next turn actually runs on.

### The composer's controls

| Control | What it does |
|---|---|
| Field | **Message Pi…** / **Message Hermes…**. Enter is a newline; Ctrl/Cmd+Enter sends (or steers a live turn). Grows with the text up to a cap. |
| Send / **Stop this run** | Sends the turn, or stops the live run cooperatively. |
| **Steer** / **Queue** | Appear while a turn is running and the field has text: put the words into the live turn, or line them up to run next. |
| **Attach a file** | The plus at the bottom left. Attaches any media or file as a general attachment, several per pick; chips wait above the field, each removable with **Remove "<name>"**. |
| **Attach a receipt** | The picture-plus beside it. One JPEG or PNG, up to 25 MB, by picker, drag-and-drop or a pasted screenshot; **Remove receipt** drops it. A receipt is what the ledger cites as a transaction's source. |
| Page pill (**in context** / **off**) | Whether the screen in front of you rides the next turn. On by default; click to take the page out of context. |
| Card pills (**in context**) | One pill per dashboard card in context, in the order added, up to three. The `x` is **Remove "<card name>" from context**. |
| Model pill / thinking pill | The chat's model and how hard it thinks. Choosing a model saves it on the chat's Hermes session, so it governs every later turn; with no pick the pill names the model the chat already runs on. Hermes serves a catalog; Pi's menu follows its endpoint. Absent when the companion offers no catalog. |

The page context is quoted as the operator's own data, fenced as untrusted, with a
budget of 4,000 characters and table/list caps. The card context is made on the
Dashboard: click a card to put it in the chat's context, click it again to take it
out, up to three — see [Dashboard](./06-dashboard.md).

The receipt bytes never come back to the renderer: main stores the original for
the vault, builds a smaller copy for the model, and the turn cites the stored
path. Attaching a receipt to a vault without the Finance kit is refused with
"Install the Finance kit first" — see [Finance kit](./20-finance-kit.md).

### Look up a shortcut without leaving the page

1. Choose **Keyboard shortcuts** in the dock's bottom bar. The panel becomes a
   reference: every movement in four groups — **Wings**, **Pages**, **Panels**,
   **Surfaces** — with the keys it answers to.
2. Each row has a pencil (**Change shortcut for <name>**). Choose it and the row
   waits for keys (**Press keys…**); the next combination with a real key saves.
   A cleared movement reads **Unassigned**.
3. The header's pencil (**Change in Settings**) opens the full **Settings →
   Keyboard** page, and **Back to chat** returns to the thread.
4. The reference also names the dock's browser keys: **Ctrl+W** closes the tab in
   front and a middle click closes the tab under the pointer. Bindings live in the
   browser's local storage, not in the vault.

### Focus mode and the dock

The Daily Journal's **Focus mode** is a sheet of paper over the whole workspace,
the dock included. Running one of the day's acts from it closes the sheet first and
then opens the chat tab in the dock behind, so the result is never started where
you cannot see it. See [Daily Journal](./16-daily-journal.md).

## The screen

| Part | What it does |
|---|---|
| Agent switcher (dock top-right) | A vertical strip of the agents this vault has, offered in this area; the active one is ringed, a switch in flight is marked pending. |
| Chats list (rail) | **New chat**; search; **View options**; one list with pinned chats first and archived rows under **Show archived**/ **Only archived**; hover archive and pin; **Chat actions** menu; a running dot. |
| Tab strip | One tab per open chat, pinned chats as squares at the head, a live dot while streaming, an approval ring while waiting, and **+** at the trailing edge. |
| Dock header | The active chat's name with **Pin chat** / **Rename chat** / **Archive chat** (the archive control steps away while pinned). |
| Transcript | Bubbles with **You** / **Pi** or **Hermes**, times, copy controls, the `steered` mark; the tool activity line; approval and error panels. |
| Composer | One box: attachments and card pills above the field, the field, then a control row — add, receipt, page pill at the left; model, thinking and send/stop at the right. |
| Dock actions | **New chat**, **Quick Notes**, **Keyboard shortcuts**, the side switch, **Collapse chat**, and the version badge (**Check for updates**). |

## Rules and behaviour

- **The studio does not open without a companion.**
  [LAWS/COMPANION.md](../../LAWS/COMPANION.md) says so twice: the studio must not
  open without it, and the companion must know what page the operator is looking
  at. The app enforces the first by rendering the companion pane instead of the
  studio shell until a companion is `ready` — Pi's endpoint configured, or Hermes's
  gateway serving the profile. Every route, including Welcome, is inside that gate.
- **The splash does not wait for it.** Cold start covers the app's own boot with a
  1.5 second floor. The companion's own pane reports the wait, so a slow endpoint or
  gateway never holds a painted app hostage.
- **The companion is the agent loop, not a chat page.** Pi runs inside Electron and
  reaches the vault only through the MCP door; Hermes runs the loop itself and
  calls the same door. Neither writes a transcript into the vault.
- **Every page is in context by default.** The operator can take the page in front
  of them out of context, and a page taken out comes back into context on the next
  page they open — the pill re-arms on every navigation.
- **The companion can read anything in the vault and most writes wait.** Reads
  need no approval. Writes to doctrine, library notes, reviews, projects, goal
  records, Architecture templates, pins, ingest mappings, posted ledger edits and
  dashboard views go through [Decisions](./23-decisions.md). Direct writes are
  adding data (a new database, a new row, a batch of rows — after the confirmation
  in chat), Daily Schedule tasks, a conversational transaction whose amount and
  account are unambiguous, page script blocks, and the companion brief — and each
  is named in chat afterwards. If an amount or an account is missing, the companion
  asks and does not post. Pages other than script blocks and Finance kit installs
  are not agent-writable surfaces: the shipped tools have no page-write or
  kit-install call.
- **The companion brief is the one card the companion owns.** It is written with
  `set_companion_brief` — a replacement of at most five typed, sourced, expiring
  items (watch, prompt, ahead, commitment, pattern) — read with
  `get_companion_brief` at the start of a session, seeded first on every Dashboard
  board, and dismissed only by the operator (**Done**, **Not useful**, **Wrong**,
  **Later**). The companion cannot dismiss an item or mark it done.
- **Transcripts live with the harness, grouped by vault.** Pi's sessions are in
  `%APPDATA%\LifeQuest\pi-sessions\<vault id>\`; Hermes's are in the bound
  profile's own store. Deleting a chat deletes it there, and a chat's tabs and
  archive state follow that harness and vault, not the app. Switching vaults
  swaps the chat rail, the tab strip and the agent; no chat or agent crosses
  over.
- **Secrets stay out of the renderer.** Pi's endpoint key and Hermes's profile key
  are read in the main process. The vault's own secrets live in OS secure storage,
  never in the vault file — see [Security](./29-security.md).
- **Refusals have names.** The pane distinguishes a missing Hermes CLI
  (**Install Hermes Agent**), a Pi that needs an endpoint (**Set up the built-in
  companion**), an unwritable profile, a busy port, a gateway that exited (the CLI's
  own sentence is shown), a Hermes build too old for the Sessions API, and a
  rejected key. Fix the named cause and choose **Recheck**; the companion does not
  silently fall back to anything.
- **The app does not kill a Hermes gateway it did not start.** A gateway it started
  is stopped on quit; an attached one is left running. Pi stops with the app.

## Tips and edge cases

- **Nothing is wrong when the dock stalls before the companion is ready.** The
  companion pane is the boot surface, not an error. **Recheck** is always safe.
- **Switching agents is not a reconnection.** The studio stays up, the target
  boots behind it, and the chat list changes because it belongs to the other
  agent. The dock's tab strip is remembered per vault and agent.
- **Switching vaults is a profile change, not a relaunch.** The vault's own chats,
  tabs and agent come back and the other vault's do not. A vault that has no
  Hermes agent shows only the Pi pill.
- **The page pill is about the screen, not the chat.** Turning it off lasts until
  you navigate; the next page you open is in context again.
- **A missing agent from the switcher is a scope or a vault, not a bug.** If an
  agent is not shown in this area, **Shown in** in Settings → Hermes → Agents by
  area is where to widen it; if Hermes is not shown at all, this vault has no
  Hermes agent yet — **Agents in this vault** is where to add one.
- **Receipts are for the ledger.** Attach a photo of a purchase only when the
  Finance kit exists and you want a transaction logged.
- **The dock's Quick Notes surface is text-only.** It hosts the same records as the
  Quick Notes page, with its own composer; see [Quick Notes](./15-quick-notes.md).
- **A pinned chat leaves the strip only through Unpin.** The square has no close
  control and the row hides archive and delete while pinned.
- **A chat you open in Hermes Desktop is the same chat, when Hermes is the
  companion.** Renames, pins and archives are Hermes-side; do not expect a
  LifeQuest-only copy. Pi's chats exist only in this app's session store.

## Related

- [Decisions](./23-decisions.md)
- [Agents](./25-agents.md)
- [The Studio](./03-the-studio.md)
- [Settings](./28-settings.md)
- [Security](./29-security.md)
- [Daily Journal](./16-daily-journal.md)
