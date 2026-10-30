# Getting started

LifeQuest is a desktop studio that opens a **vault**: a folder on your computer
that holds your life data as plain files. This page takes you from the
prerequisites to a working first vault, and explains the one thing that can stop
the app from opening at all — the companion. Read
[the wiki home](./index.md) first if you want the shape of the product before
the install.

## Where it lives

The welcome screen is its own route outside the studio shell: `#/welcome`. It has
no rail, no top bar and no chat pane — only the custom window title bar above it.
Inside its card you find the app name, the two vault buttons and the recent-vault
list.

The **companion setup screen** is shown before that, on the same `.welcome` card,
whenever the Hermes companion is not connected. You cannot reach the welcome
screen, and therefore cannot reach any vault, until it is satisfied.

Later, settings live in the **Settings** sheet: press the gear at the top right
of the title bar, then **All settings** (or use the sheet from the chat pane's
error banner). See [Settings](./28-settings.md) for every tab.

## What it is for

This page exists to get one vault open, with the companion connected, and to name
the two things that stop that from happening: a missing Hermes install, and a
folder that is not a vault. Everything after that is the studio teaching you its
own surfaces, and the wiki's feature pages are the place to learn them.

## Before you start

| Requirement | What it means |
|---|---|
| **Node.js 20+** | Developed on Node 22; 20 LTS is the minimum supported target |
| **npm** | The repository is an npm-workspaces monorepo |
| **Hermes CLI** | The companion. It must be on your `PATH`; LifeQuest does not bundle it |
| **Hermes gateway** | The profile's host gateway, served on the Hermes API port (default `http://localhost:8642`). You do not configure it in the app; the companion profile owns it |
| **Windows** | The packaged desktop product is Windows; other desktop builds are not the product |

The companion is not optional decoration. The studio **does not open without
it** ([LAWS/COMPANION.md](../../LAWS/COMPANION.md)): the app looks for the Hermes
CLI and the Hermes profile it is set to use (`lifequest` by default), attaches to
that profile's gateway if it is already serving, and starts it if it is not. It
never kills a gateway it did not start.

## Run it from source

1. Install the workspace dependencies once:

   ```bash
   npm install
   ```

2. Start the desktop app:

   ```bash
   npm run dev
   ```

   This is the same as `npm run dev:desktop`. The script bundles the Electron main
   process and preload, starts Vite on port `5173`, and launches the app against
   it. Re-running it rebundles and relaunches, which is how a change to the main
   process or preload takes effect.

3. Quit with the window's close button, **Ctrl+Q**, or `Ctrl+C` in the terminal.

Development builds keep DevTools; packaged builds do not. Use **Ctrl+R** to
reload the window, **F11** for fullscreen, and **Ctrl+Shift+I** or **F12** for
DevTools in a development build only.

## Run the packaged app

To run without Node or a terminal, build the portable folder:

```bash
npm run package
```

The app lands at `apps/desktop/release/win-unpacked/LifeQuest.exe`. Double-click
it. This is a development build in a packaged shape.

To make the two files a release uploads:

```bash
npm run release
```

| Asset | What it is |
|---|---|
| `LifeQuest-0.2.0-setup.exe` | NSIS installer. Per-user, assisted, and it asks where to install; it creates desktop and Start menu shortcuts |
| `LifeQuest-0.2.0-win-x64.zip` | Portable build: extract it and run `LifeQuest.exe` |

The version comes from `apps/desktop/package.json` (`0.2.0`). The build prints
each file's size and SHA-256, and writes `release/release-manifest.json`.

On a private unsigned build, Windows SmartScreen may warn on first launch.
Choose **More info → Run anyway**. Quit LifeQuest before building again: a
running `.exe` can lock files under `release/`.

Uninstalling the app does not touch your vault, and it does not delete the
recent-vault list. The studio is replaceable; the folder is yours.

## First launch

1. A splash screen draws the LifeQuest wordmark over a brief loading bar. It
   covers only the app's own boot — the renderer bundle and the first vault read
   — and has a floor of 1.5 seconds. It deliberately does not wait for the
   companion, so a slow Hermes start never leaves you staring at a logo.
2. If the companion is not ready, the companion setup screen appears (below).
3. With the companion ready and no vault open, you land on the welcome screen:
   the heading **LifeQuest**, the line *Your local vault is your identity. Create
   a new vault or open an existing one to continue.*, then **Create vault** and
   **Open vault**, then **Recent vaults**.
4. On later launches LifeQuest reopens the most recent vault automatically and
   goes straight to the Dashboard. The welcome screen appears when there is no
   recent vault, or when the last one can no longer be opened.

## The companion gate

The setup screen's heading is **LifeQuest companion**. It names the profile it is
working on, shows what it is doing, and offers **Recheck** (shown as
**Connecting…** while it works). Its profile picker reads *LifeQuest runs on
one Hermes profile. Pick an installed one, or create the app's own `lifequest`
profile.* Every installed profile is listed, the one in use is marked **In use**,
and a **default** tag marks your main Hermes profile. If `lifequest` does not
exist yet, the row **Create the lifequest profile** creates and wires it. With no
profiles at all the list says *No Hermes profiles found on this machine.*

What the screen can say, and what to do:

| Status | Meaning and next step |
|---|---|
| *Connecting to your LifeQuest companion…* | It is looking for the Hermes CLI and the profile. Wait, or press **Recheck** |
| **Install Hermes Agent** | The CLI is not on your `PATH`. Install Hermes, then **Recheck**. The **Hermes install docs** button opens the Hermes documentation |
| **Companion port is busy** | Something else holds the gateway port. Free it, then **Recheck** |
| **Hermes gateway exited** | Hermes refused to start; the screen shows its own message. Fix it, then **Recheck** |
| **Hermes is too old** | The build lacks the Sessions API. Update Hermes, then **Recheck** |
| **Companion rejected the API key** | The profile's key was refused. Fix the profile `.env`, then **Recheck** |
| **Companion disconnected** | The profile's gateway could not be reached. Start Hermes or pick another profile |

If you are stuck, choose another installed profile from the picker — switching
profiles re-runs the connection against it. See
[Companion](./24-companion.md) for the chat pane and
[Troubleshooting](./32-troubleshooting.md) for deeper failures.

## How to use it

This section is the run-through: create a vault, open an existing one, and then the
first things to do inside it.

### Create your first vault

1. On the welcome screen, choose **Create vault**.
2. A folder picker opens. Choose a folder for this vault — ideally an empty one,
   or a new folder you make for the purpose. The vault is exactly that folder;
   there is no separate database directory.
3. LifeQuest writes the vault and opens it. A new vault is named `Personal`; you
   are not asked for a name at creation.

A new vault is seeded with:

- four domains — **Health**, **Intellectual**, **Emotional**, **Financial** — in
  that order;
- for each domain, four empty, unlocked doctrine documents:
  **Beliefs & Premise**, **Vision & Desire**, **Purpose**, **Strategy (How)**;
- vault settings with Monday as the week start;
- a Life log line recording each domain's creation.

If the folder already contains a vault (a `lifequest.json` marker), creation is
refused with *Vault already exists at …* instead of overwriting anything.

### Open an existing vault

1. Choose **Open vault** and pick the folder that contains `lifequest.json`.
2. The vault loads and the app goes to the Dashboard.

The faster path is **Recent vaults** on the welcome screen: each row shows the
vault's name and its path, and a click opens it. With no history the list says
*No recent vaults yet.* The list is kept outside the vault, so it survives
switching vaults, and the app reopens the top entry on the next launch.

If the folder is not a vault, or its `lifequest.json` is unreadable or from another
schema version, the picker returns and the welcome screen shows the error under
the buttons. Nothing is modified.

### The first five minutes

1. **Confirm the companion.** Press the gear at the top right, then **All
   settings**, and open **Hermes**. The status line should begin *Ready ·* and
   name the API URL. If it does not, use **Recheck**, or pick a profile under
   **Companion profile**.
2. **Add a domain.** Still in Settings, open **Domains**, type a name in
   **Create domain** (for example `Career`) and press **Create**. The four seeded
   domains are already there; this is for the life area they do not cover. See
   [Domains](./05-domains.md).
3. **Write doctrine.** At the top of the window, choose the **Define** wing, open
   **Dream**, and pick a card for one domain — **Beliefs & Premise** is the place
   to start. Type in the editor and press **Save**. The other doctrine documents
   live on **Dream**, **Vision** and **Architecture**; see
   [Doctrine](./07-doctrine.md).
4. **Pin a card.** On the **Home** wing, open **Pages**, type a **Title** in the
   **New page** panel (choosing a **Domain** on Overview), and press **New page**.
   Then open **Dashboard**, press **Pin board** (it appears once there is
   something not already pinned), and click the page's title under **Add pin**.
   The card joins the board for the current lens; see
   [The studio](./03-the-studio.md) for the lens and
   [Pages](./21-pages.md) for the page itself.
5. **Say hello.** In the chat pane on the right, type in the composer (*Message
   Hermes…*) and press **Enter**. The companion can read the page you are on and
   answer from the vault.

## Where the vault goes

You choose the folder whenever you create or open a vault: LifeQuest has no default
vault location and never picks one for you. The folder is self-describing because of
`lifequest.json` at its root, so you can move it anywhere the app can read.

Two kinds of files are easy to confuse:

- **The vault** is your data. It holds no API keys.
- App user data is the app's own state, kept in Electron's per-user data folder
  (`%APPDATA%\LifeQuest` on Windows). It holds the recent-vault list, the last
  domain lens per vault, and the OS-encrypted secret store. Removing it resets the
  app's memory of your vaults; it does not delete a vault.

The exact on-disk layout is on [The vault](./04-the-vault.md).

## Quit and back up

- Quit with the window's close button, the title bar's close control when the app
  falls back to its own window controls, or **Ctrl+Q**.
- There is no document to save at quit: edits are saved by the editor you used
  (**Save**, or **Ctrl+S** in the Daily Note, Review and Ideal State editors).
- To back up, quit the app and copy the vault folder anywhere. To put it in
  version control, make the vault folder a Git repository of its own — see
  [The vault](./04-the-vault.md) for what Git handles well and what it does not.
- Deleting the app, or its user data, does not delete a vault. Deleting the vault
  folder does.

## Rules and behaviour

- Opening a vault is identity. No account, sign-in or hosted database is required
  ([LAWS/IDENTITY.md](../../LAWS/IDENTITY.md)).
- The studio does not open without the companion
  ([LAWS/COMPANION.md](../../LAWS/COMPANION.md)). Hermes is not bundled, and a
  gateway LifeQuest did not start is not stopped by it.
- API keys never enter the vault. They live in OS secure storage
  ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)).
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
- If `npm run dev` exits at once, another process may already hold port `5173`;
  Vite runs with `strictPort` and refuses to move.
- Windows SmartScreen on a private build is expected. The app is unsigned here;
  **More info → Run anyway** is the intended path.

## Related

- [Overview](./01-overview.md)
- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Domains](./05-domains.md)
- [Settings](./28-settings.md)
- [Troubleshooting](./32-troubleshooting.md)
