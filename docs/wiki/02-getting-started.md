# Getting started

LifeQuest is a desktop studio that opens a **vault**: a folder on your computer
that holds your life data as plain files. This page takes you from the download
to a working first vault. Since 0.2.8 the studio opens with a companion built in:
**Pi** runs inside the app, so a machine with no Hermes install still reaches
every surface. **Hermes** remains available as an optional external companion.
Read [the wiki home](./index.md) first if you want the shape of the product before
the install.

## Where it lives

- The **welcome screen** is its own route outside the studio shell: `#/welcome`.
  It has no rail, no lens tab and no chat dock — only the app's title bar above
  the card. The card holds **Create vault**, **Open vault** and **Recent vaults**.
- The **companion setup screen** is shown before that, on the same welcome card,
  whenever no companion can start. Its heading is **LifeQuest companion**; the
  companion picker at the top of the card chooses **Pi** or **Hermes**.
- The **studio** opens after a vault loads. Its settings are the **Settings**
  sheet, opened by the gear at the trailing end of the window title bar (a plain
  link to `/settings`). See [Settings](./28-settings.md).
- The **onboarding interview** lives in the chat dock of a new vault, above the
  composer. See [The studio](./03-the-studio.md).

## What it is for

This page gets one vault open with a companion answering, names the two things
that stop that happening — no usable companion configuration, and a folder that
is not a vault — and then walks the first five minutes of a 0.2.11 vault. The
feature pages teach the surfaces themselves.

## Before you start

| Requirement | What it means |
|---|---|
| **Windows** | The packaged desktop product is a Windows build. Source builds run elsewhere, but Windows is the product |
| **A folder** | A vault is a folder you choose; an empty one is ideal |
| **Node.js 20+ and npm** | Only to run or build from source. The packaged app needs neither |
| **An OpenAI-compatible endpoint** | For Pi. A hosted API needs an endpoint, a model name and usually an API key; a local server (Ollama, LM Studio, llama.cpp) needs no key |
| **Hermes (optional)** | The external companion. If it is already installed and working, LifeQuest keeps using it until you switch to Pi |

There is no account and no server to sign in to. API keys are never written into
the vault.

## Run it from source

1. Install the workspace dependencies once:

   ```bash
   npm install
   ```

2. Start the desktop app:

   ```bash
   npm run dev
   ```

   This bundles the Electron main process and preload, starts Vite on port
   `5173`, and launches the app against it. Re-running it rebundles and
   relaunches, which is how a main-process or preload change takes effect.

3. Quit with the window's close control, **Ctrl+Q**, or `Ctrl+C` in the
   terminal.

Development builds keep DevTools; packaged builds do not. Use **Ctrl+R** to
reload the window, **F11** for fullscreen, and **Ctrl+Shift+I** or **F12** for
DevTools in a development build only.

## Run the packaged app

To run without Node or a terminal, build the portable folder:

```bash
npm run package
```

The app lands at `apps/desktop/release/win-unpacked/LifeQuest.exe`. Double-click
it. To make the two files a release uploads:

```bash
npm run release
```

| Asset | What it is |
|---|---|
| `LifeQuest-0.2.11-setup.exe` | NSIS installer. Per-user, assisted, and it asks where to install; it creates desktop and Start menu shortcuts |
| `LifeQuest-0.2.11-win-x64.zip` | Portable build: extract it and run `LifeQuest.exe` |

The version comes from `apps/desktop/package.json` (`0.2.11`). The build prints
each file's size and SHA-256, and writes `release/release-manifest.json`.

On a private unsigned build, Windows SmartScreen may warn on first launch.
Choose **More info → Run anyway**. Quit LifeQuest before building again: a
running `.exe` can lock files under `release/`.

Uninstalling the app does not touch your vault, and it deletes neither your
recent-vault list nor your companion's app data. The studio is replaceable; the
folder is yours.

## First launch

1. A splash screen draws the LifeQuest wordmark over a brief loading bar. It
   covers the app's own boot — the renderer bundle and the first vault read —
   with a floor of 1.5 seconds. It deliberately does not wait for the companion.
2. If no companion can start, the **LifeQuest companion** screen appears (below).
3. With a companion ready and no vault open, you land on the welcome screen:
   the heading **LifeQuest**, the line *Your local vault is your identity. Create
   a new vault or open an existing one to continue.*, then **Create vault** and
   **Open vault**, then **Recent vaults**.
4. On later launches LifeQuest reopens the most recent vault automatically and
   goes straight to the Dashboard. The welcome screen appears when there is no
   recent vault, or when the last one can no longer be opened.

## The companion gate

**Pi** is built into the app and is the companion on a fresh machine. It runs
inside the Electron main process, reaches the vault only through the app's MCP
door, and needs no CLI on `PATH`, no gateway port and no profile directory. On a
machine that has never been set up it asks for an OpenAI-compatible **Endpoint**,
a **Model**, a provider **Name** and (optionally) an **API key**, then **Save and
connect**. A local server needs no key. The key is sealed by the OS and never
enters the vault; on a machine with no OS keyring the form says the key is kept
for this session only.

**Hermes** stays a first-class option, added per vault. The setup screen (before a
vault is open) still offers the companion picker and the profile picker: every
installed profile is listed, the one in use is marked **In use**, a **default** tag
marks your main Hermes profile, and **Create profile** creates and wires the app's
own `lifequest` profile. The picker is offered only while Hermes is selected. Once
a vault is open, **Settings → Hermes → Agents in this vault** is where a Hermes
agent is added to that vault — see [Companion](./24-companion.md).

What the screen can say, and what to do:

| Status | Meaning and next step |
|---|---|
| *Connecting to your LifeQuest companion…* | It is bringing the companion up. Wait, or press **Recheck** |
| **Set up the built-in companion** | Pi needs an endpoint and a model. Fill the form and press **Save and connect** |
| **Install Hermes Agent** | Hermes is selected and its CLI is not on your `PATH`. Install Hermes, then **Recheck** — or switch to **Pi** |
| **Companion port is busy** | Something else holds the Hermes gateway port. Free it, then **Recheck** |
| **Hermes gateway exited** | Hermes refused to start; the screen shows the CLI's own message |
| **Hermes is too old** | The build lacks the Sessions API. Update Hermes, then **Recheck** |
| **Companion rejected the API key** | The profile's key was refused. Fix the profile `.env`, then **Recheck** |
| **The endpoint rejected the key** | Pi's key was refused. Update the key in the form and save |
| **Companion disconnected** | The endpoint or gateway did not answer. Check the URL/server, then **Recheck** |

The companion choice is per vault: a new vault starts on **Pi** with no chats, and
it gains Hermes only when you add a Hermes agent to that vault. The setup screen's
pick is the boot choice for a machine with no vault open yet; opening a vault
applies that vault's own binding. See [Companion](./24-companion.md) for the chat
dock and [Troubleshooting](./32-troubleshooting.md) for deeper failures.

## How to use it

### Create your first vault

1. On the welcome screen, choose **Create vault**.
2. A folder picker opens. Choose a folder for this vault — ideally an empty one,
   or a new folder you make for the purpose. The vault is exactly that folder;
   there is no separate database directory.
3. LifeQuest writes the vault and opens it on the Dashboard. A new vault is named
   `Personal`; you are not asked for a name at creation.

A new vault is seeded with:

- the base area **Life**, always unlocked and never a chip of its own;
- five further areas on disk but locked — **Health**, **Mind**, **Finance**,
  **Business**, **Relationships** — each with its four empty doctrine documents;
- vault settings with Monday as the week start and both decision-inbox switches
  on;
- one Life log line recording the creation of the base area. A locked area
  writes no log line, because the Log is operator-visible.

If the folder already contains a vault (a `lifequest.json` marker), creation is
refused with *Vault already exists at …* instead of overwriting anything.

### Let the interview open your areas

A new vault's chat dock shows a quiet **Welcome to LifeQuest** card with the
ten-minute offer and one button, **Begin the interview**.

1. Press **Begin the interview**. It sends your own turn through the composer's
   send path, so the transcript holds your bubble and the companion answers it
   like any other turn. A first message typed before pressing Begin starts the
   record silently instead.
2. Answer the companion's questions. It asks four to six open questions with
   follow-ups, never a form, and reflects back what it heard before opening
   anything.
3. When it has heard enough it calls one tool that opens one to three areas,
   writes their doctrine drafts, at most one table, and one note of the
   conversation in the Life area.
4. The card becomes a receipt: *After analyzing our conversation, I've opened up
   the Health and Business areas for you.* Press **Continue** to acknowledge it.
   Nothing is left to decide — the areas, doctrine, table and note are already on
   disk.

While the record is open and no receipt is waiting, the card shrinks to one quiet
line with **Continue the interview**. It is never a modal. A vault with no
onboarding file — or a corrupt one — reads as completed, so an existing vault is
never shown a first-run card.

### Unlock an area yourself

1. Open **Settings** (the gear in the title bar) and choose **Areas**.
2. Under **Unlock another area**, find the area by name and press **Unlock**. It
   is a plain reveal with no confirmation: unlocking creates nothing, moves
   nothing, and does not change the lens.
3. The area joins **Your areas** and the title bar's lens. Once a second area is
   open, the quiet **Life** label becomes a segmented control — **Life**, then
   each unlocked area.

The full flow, archive and delete are on [Areas](./05-areas.md).

### Open an existing vault

1. Choose **Open vault** and pick the folder that contains `lifequest.json`.
2. The vault loads and the app goes to the Dashboard.

The faster path is **Recent vaults** on the welcome screen: each row shows the
vault's name and its path, and a click opens it. With no history the list says
*No recent vaults yet.* The list is kept outside the vault, so it survives
switching vaults, and the app reopens the top entry on the next launch. The
title bar's vault chip at the foot of the rail raises a **Switch vault** dialog
for the same job while the studio is open.

If the folder is not a vault, or its `lifequest.json` is unreadable or from
another schema version, the picker returns and the welcome screen shows the error
under the buttons. Nothing is modified.

### The first five minutes

1. **Read the Dashboard.** The companion's brief is seeded as the first card on
   every board, with its kind, its reason and a **Dismiss** for each item. The
   card itself is the handle into the chat's context: click a card to put it in
   the conversation. See [Dashboard](./06-dashboard.md).
2. **Finish or continue the interview.** The **Welcome to LifeQuest** card sits
   above the composer. If you skipped it, **Settings → Areas** reveals the same
   five areas by name.
3. **Write one doctrine page.** Choose the **Define** wing, open **Dream**, and
   pick the **Beliefs & Premise** card for an open area. Type in the editor and
   press **Save**. The other documents are on **Dream**, **Vision** and
   **Architecture**; see [Doctrine](./07-doctrine.md).
4. **Put one thing on the board.** Choose the **Act** wing and open **Task
   Manager** (`/act`), then add a card under **Today** — or capture a thought,
   picture or link on **Quick Notes** (`/chain`).
5. **Say hello.** In the chat dock, type in the composer (*Message Pi…* when Pi
   answers) and press **Ctrl+Enter** to send. Enter breaks the line; the modified
   key sends, and the **Steer** and **Queue** controls work while a turn runs.
   The companion can read the page you are on and answer from the vault.

## Where the vault and companion data go

You choose the vault folder whenever you create or open a vault: LifeQuest has no
default vault location and never picks one for you. The folder is self-describing
because of `lifequest.json` at its root, so you can move it anywhere the app can
read.

Two kinds of data are easy to confuse:

- **The vault** is your data. It holds no API keys and no companion transcripts.
  The exact layout is on [The vault](./04-the-vault.md).
- **App user data** is the app's own state, in Electron's per-user data folder —
  `%APPDATA%\LifeQuest` on Windows. It holds the recent-vault list, the last area
  lens and the agent binding per vault, the OS-encrypted secret store, and Pi's
  own files: `pi-endpoint.json` (endpoint, model, provider name),
  `pi-endpoint.key` (sealed by the OS), and `pi-sessions\<vault id>\` (Pi's chat
  transcripts, grouped by vault). Removing this folder resets the app's memory of
  your vaults and their agents; it does not delete a vault.

**Hermes data** stays with Hermes: its profile folder owns the gateway
configuration, the model and the profile's `.env` (where its key lives). The
app's Settings → Hermes shows the profile path and offers **Open profile folder**.
Nothing from Hermes is copied into the vault.

## Quit and back up

- Quit with the window's close control, the title bar's own close control when
  the app falls back to its own window controls, or **Ctrl+Q**.
- There is no document to save at quit: edits are saved by the editor you used
  (**Save**, or **Ctrl+S** in the Daily Journal and other Live editor surfaces).
- To back up, quit the app and copy the vault folder anywhere. To put it in
  version control, make the vault folder a Git repository of its own — see
  [The vault](./04-the-vault.md) for what Git handles well and what it does not.
- Deleting the app, or its user data, does not delete a vault. Deleting the vault
  folder does.

## Rules and behaviour

- Opening a vault is identity. No account, sign-in or hosted database is required
  ([LAWS/IDENTITY.md](../../LAWS/IDENTITY.md)).
- The studio does not open without a companion
  ([LAWS/COMPANION.md](../../LAWS/COMPANION.md)). Pi is built in; Hermes is
  installed separately and a gateway LifeQuest did not start is not stopped by
  it.
- API keys never enter the vault ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)).
  Pi's key is sealed by the OS; Hermes' credential belongs to its profile.
- A new vault seeds **Life** plus five locked areas. A locked area is invisible
  to every read, list and write until it is unlocked; the interview opens at most
  three, and **Settings → Areas** can open any of them.
- The app works offline against the files on disk. Features that need the
  companion say so; nothing silently writes your data to a server.
- Starting the app with no vault open shows the welcome screen. A cold start with
  a recent vault goes directly to that vault.

## Tips and edge cases

- Choose an empty folder for a new vault, not your Documents folder. The folders
  the vault owns (`domains/`, `documents/`, `notes/` and the rest) live at its top
  level.
- **Create vault** and **Open vault** both open a folder picker. If you cancel the
  picker, nothing happens and you stay on the welcome screen.
- A moved vault leaves a stale recent entry. Open it once from its new path; the
  new path becomes the entry the app reopens.
- The recent list keeps at most 20 vaults, most recent first.
- On a machine with no OS keyring, a Pi API key is kept for the session only;
  the setup form says so. A local endpoint that needs no key is unaffected.
- Switching vaults changes the chats you see and the agent that answers: a vault
  owns its chats and its agents, and none of them cross over. Switch with the
  rail-foot vault chip's **Switch vault** dialog; a vault's agents are managed in
  Settings → Hermes → **Agents in this vault**.
- If `npm run dev` exits at once, another process may already hold port `5173`;
  Vite runs with `strictPort` and refuses to move.
- Windows SmartScreen on a private build is expected. The app is unsigned here;
  **More info → Run anyway** is the intended path.

## Related

- [Overview](./01-overview.md)
- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Companion](./24-companion.md)
- [Settings](./28-settings.md)
- [Troubleshooting](./32-troubleshooting.md)
