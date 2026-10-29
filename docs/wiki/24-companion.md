# Companion

The companion is Hermes, the agent that lives in the chat dock and does the
thinking for the studio. It is not an optional assistant: LifeQuest hands the
agent loop, memory, skills and transcripts to a Hermes profile, and the studio
shell will not open until that companion is ready. What remains in the studio is
what only the studio can own — the vault, the tools that read and write it, the
locks, and the [Decisions](./23-decisions.md) queue that reviews agent writes.
See also [Wiki home](./README.md).

## Where it lives

- The **chat dock** is the right-hand pane of the three-pane studio; the titlebar
  can swap it to the left. It is present on every page, collapses to a launcher
  button, and its width is dragged with the divider between it and the page.
- The **Chats** list is the middle of the rail, under the wing's pages and above
  the governed shelf. It lists every conversation on the companion profile.
- **Settings → Hermes** is the connection and health page: status, profile
  picker, **Recheck**, **Open profile folder**, filing preferences, and the two
  MCP doors.
- Before the app opens, the same `.welcome` pane that hosts the vault welcome
  screen reports the companion's boot: title **LifeQuest companion**, what it is
  looking for, a profile picker and **Recheck**.
- There is no page route for chat. The dock is chrome, like the rail; its state
  (which chats are open, the pending receipt, the card in context) belongs to the
  session, not to a file in the vault.

## What it is for

Hermes runs the turn: it plans, calls tools, remembers, and streams tokens back.
The studio's job is to be the thing those tools act on. So a question typed into
the dock can read the vault, propose a document change, log an expense, or build
a dashboard card, and the transcript of that work lives in the Hermes profile —
the same place Hermes Desktop reads it, on the same memory and the same skills.

The companion is required because there is no fallback loop in the studio. The
app does not run the agent itself, does not keep its own chat database, and does
not send an API key to the renderer.

## How to use it

### Connect it for the first time

1. Install the Hermes CLI. LifeQuest does not bundle or auto-install it. If the
   CLI is missing the welcome pane is titled **Install Hermes Agent** and says
   "LifeQuest needs the Hermes CLI on your PATH. Install Hermes, then Recheck."
   Use **Hermes install docs** for the official instructions.
2. Choose a profile in the **Companion profile** picker. It lists every Hermes
   profile on the machine, marks the one the app is on with **In use**, tags the
   main profile **default**, and offers **Create the lifequest profile** when
   that profile does not exist yet. Picking a row re-runs the connection against
   it; picking `lifequest` creates and wires it.
3. Choose **Recheck** once Hermes is installed, or after fixing whatever the
   pane reported. On the setup pane it reads **Connecting…** while it works; on
   the Settings page it reads **Checking…**.
4. When the companion answers, the studio opens on the vault. If a vault is not
   open yet you land on the welcome page and can create or open one.
5. Later, **Settings → Hermes** shows the same health as a probe line, for
   example "Ready · http://127.0.0.1:8644 · attached" (a retired-model warning
   would follow it in red). `attached` means a gateway was already up and the
   app joined it; "started by LifeQuest" means the app started it.
6. Under the probe line: read-only **CLI**, **Profile** and **API** values, the
   **Companion profile** picker, **File implied changes**, **Recheck** and
   **Open profile folder**, then **Apply assistant inserts immediately** and
   **MCP doors**.
7. There is nowhere in the app to type a gateway URL or an API key, and no
   connection-test form for an arbitrary remote gateway. The profile's own
   `.env` holds the key, the app reads it in the main process, and the renderer
   never receives it. The **API** value shown is the one the app actually
   attached to, not a setting you edit here.

### Open, start and close chats

1. The dock is open on launch. If it is collapsed, click the launcher mark on the
   edge of the page (**Open Hermes chat**).
2. Choose **New chat** in the Chats list (or the **New chat** button at the foot
   of the dock). A blank chat is reused rather than piling up empty ones.
3. Click any row in **Chats** to load that conversation into the dock. A
   middle-click on the row — or **Chat actions** then **Open in new tab** — keeps
   the current chat on screen and opens a second tab. The tab strip appears when
   more than one chat is open.
4. Hover a chat for its own controls: the row menu has **Open in new tab**,
   **Pin** / **Unpin**, **Rename**, **Archive**, and **Delete**. Pinned chats sit
   in their own **Pinned** group above **Recent**. A chat streaming a turn shows a
   dot on its row; the header counts how many are running.
5. **Delete** asks first: "Delete "<name>"? Its messages leave Hermes everywhere,
   and this cannot be undone." Renaming, pinning and archiving are durable Hermes
   flags, so Hermes Desktop and other channels see them too.
6. Choose **Collapse chat** at the foot of the dock to put it away, and the same
   control in the titlebar to move it to the other side of the page.

### Talk to it

1. Type in the field placeholdered **Message Hermes…**. **Enter** sends and
   **Shift+Enter** starts a new line.
2. While a turn runs the send control becomes **Stop this run**; the transcript
   shows **Thinking…** until the first text arrives.
3. Read the bubbles: your messages are labelled **You**, the companion's
   **Hermes**. Each bubble has a time and a copy control (**Copy message**, then
   **Copied**). A turn that called tools draws one grey activity line such as
   "Explored 2 files" or "Used 4 tools"; when more than one call ran, click the
   line to expand the calls. A failure to read the chat list or attach a receipt
   is shown as a red banner, not as a silent empty state.
4. If the gateway asks for approval mid-turn, the transcript shows the request
   with **Allow once** and **Deny**. Nothing else in the app can approve it.
5. The empty chat shows **Ask Hermes** and the active domain. Under it,
   **Start with a question** offers your saved questions that fit the screen, each
   with its scope; clicking one sends it as the first turn. With no saved
   question for this screen the dock says **No questions set** and links to
   **Settings → Questions** to write some.

### The composer's controls

| Control | What it does |
|---|---|
| **Message Hermes…** field | Sends on Enter, newline on Shift+Enter. Grows with the text up to a cap. |
| Send / **Stop this run** | Sends the turn, or stops the live run cooperatively. |
| Page pill (**in context** / **off**) | Whether the screen in front of you rides the next turn. On by default; click to take the page out of context. |
| Card pill (**in context**) | The dashboard card this chat is about, added from the card's chat control. The `x` is **Remove card from context**. |
| **Attach a receipt** | Attach one JPEG or PNG, up to 25 MB, by picker, drag-and-drop, or a pasted screenshot. One at a time; a second attach replaces the first. **Remove receipt** drops it. |
| Model pill | Which model the next turn runs on, chosen from the profile's own catalog with its provider names, or **Automatic** for the profile default. Absent when the gateway serves no catalog. |
| Thinking-level pill | How hard the model should think, from **Default** (gateway default) through the ladder to **Off** where the model allows it. Appears only for a model whose catalog entry supports reasoning. |

The receipt bytes never come back to the renderer: main stores the original for
the vault, builds a smaller copy for the model, and the turn cites the stored
path. Attaching a receipt to a vault without the Finance kit is refused with
"Install the Finance kit first" — see [Finance Kit](./20-finance-kit.md).

## The screen

| Part | What it does |
|---|---|
| Chats list (rail) | **New chat**; rows for **Pinned** and **Recent**; per-row **Chat actions** menu; a running dot; a **Dismiss** for a failed list read. |
| Dock header | The active chat's name and **Pin chat** / **Rename chat** / **Archive chat**; **All chats** steps back to the list. |
| Tab strip | One tab per open chat, each closable, with a live dot while it streams and an amber dot while it waits on an approval. |
| Transcript | Bubbles with **You** / **Hermes** labels, times, copy controls; the tool activity line; approval and error panels. |
| Composer | The field, send/stop, the page pill, the card pill, the receipt controls, the model and thinking pills. |
| Dock actions | **Chat history**, **New chat**, **Life-Chain**, **Collapse chat**. |

## Rules and behaviour

- **The studio does not open without the companion.**
  [LAWS/COMPANION.md](../../LAWS/COMPANION.md) says so twice: the studio must not
  open without it, and the companion must know what page the operator is looking
  at. The app enforces the first by rendering the companion pane instead of the
  studio shell until the status is `ready`; every route, including Welcome, is
  inside that gate.
- **The splash does not wait for it.** Cold start covers the app's own boot (the
  renderer and the first vault read) with a 1.5 second floor. The companion's own
  pane reports the wait, with a profile picker and **Recheck**, so a slow gateway
  never holds a painted app hostage.
- **Every page is in context by default.** The operator can take the page in
  front of them out of context, and a page taken out comes back into context on
  the next page they open — the pill re-arms on every navigation. The page is
  quoted as the operator's own data, fenced as untrusted, with a budget of 4,000
  characters and table/list caps.
- **The companion can read anything in the vault and most writes wait.** Reads
  need no approval. Writes to doctrine, library notes, reviews, projects, goal
  records, Architecture templates, pins, ingest mappings, posted ledger edits and
  dashboard views go through [Decisions](./23-decisions.md). Direct writes are
  limited to Daily Schedule tasks, a conversational transaction whose amount and
  account are unambiguous, and page script blocks — and each of those is named in
  chat afterwards. If an amount or an account is missing, the companion asks and
  does not post. Pages other than script blocks and Finance kit installs are not
  agent-writable surfaces in this build: the shipped tools have no page-write or
  kit-install call.
- **Transcripts live with Hermes, not in the vault.** The profile's state
  database is the source of truth; deleting a chat deletes it there. Nothing
  writes a chat transcript into the vault folder.
- **Secrets stay out of the renderer.** The API key of the profile is read in the
  main process. The vault's own secrets live in OS secure storage, never in the
  vault file — see [Security](./29-security.md).
- **Refusals have names.** The pane distinguishes a missing CLI
  (**Install Hermes Agent**), an unwritable profile, a busy port, a gateway that
  exited (the CLI's own sentence is shown), a Hermes build too old for the
  Sessions API, and a rejected API key. Fix the named cause and choose
  **Recheck**; the companion does not silently fall back to anything.
- **The app does not kill a gateway it did not start.** A gateway it started is
  stopped on quit; an attached one is left running.

## Tips and edge cases

- **Nothing is wrong when chat stalls before the gateway is ready.** The welcome
  pane is the boot surface, not an error. **Recheck** is always safe to press.
- **The page pill is about the screen, not the chat.** Turning it off lasts until
  you navigate; the next page you open is in context again.
- **A card in context is named before the turn is sent**, and the board marks the
  card as in-context. Taking the card off the composer is the same control as
  pressing the card's chat control a second time.
- **Receipts are for the ledger.** Attach a photo of a purchase only when the
  Finance kit exists and you want a transaction logged; the companion will ask
  about anything it cannot read as an amount and an account.
- **The dock's Life-Chain surface is the second way into capture.** It hosts the
  same records as the Life-Chain page, with its own composer; see
  [Life-Chain](./15-life-chain.md).
- **A chat you open in Hermes Desktop is the same chat.** Renames, pins and
  archives are Hermes-side; do not expect a LifeQuest-only copy.

## Related

- [Decisions](./23-decisions.md)
- [Personnel and Agents](./25-personnel-and-agents.md)
- [The Studio](./03-the-studio.md)
- [Settings](./28-settings.md)
- [Security](./29-security.md)
- [Life-Chain](./15-life-chain.md)
