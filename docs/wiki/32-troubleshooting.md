# Troubleshooting

Every failure in LifeQuest has a surface that names it: the companion setup screen
carries the companion's own state, the welcome screen carries vault-open errors, a
banner carries external file changes, and Settings carries the update, door and
restore results. This page maps what you see to what it means and what to do about
it. It only describes controls and messages the app actually has. Start from
[Wiki home](./README.md).

## Where it lives

| Surface | When you see it | What it tells you |
|---|---|---|
| The splash (logo over the window) | For the first ~1.5–2 s of any launch | The app's own boot is still running |
| The **LifeQuest companion** setup card | Whenever the companion is not `ready` | Which companion failure it is, plus **Recheck** and the profile picker |
| The welcome page | No vault open | **Create vault**, **Open vault**, **Recent vaults**, and the open error |
| *Files changed on disk* banner | The vault changed outside the app's own writes | A **Reload** button |
| Settings → Hermes | Anytime | Companion status, **Recheck**, profile picker, **MCP doors** |
| Settings → Vault | Anytime | The open vault, **Change folder…**, **Books** export/restore |
| Settings → Updates | Anytime | What the release check got, and **Check now** |

## First: which screen are you on?

- **The logo stays up.** The app is still booting its own renderer and first vault
  read. See [Stuck at the splash](#stuck-at-the-splash).
- **A card headed "LifeQuest companion".** The studio is gated on the companion and
  it is not ready. See [The companion will not connect](#the-companion-will-not-connect).
- **The welcome page.** No vault is open. See [Vaults](#vaults).
- **The studio, but something is missing.** A Decision is waiting, a surface is
  locked, or the file on disk is newer than the screen. See the sections below.

## The companion will not connect

The studio does not open without the companion: while its status is not `ready`,
the app renders the setup card instead of the rail and pages. That is the product
working as designed, not a hang. The card shows one of these states.

| State | Title on the card | Body on the card |
|---|---|---|
| `needs_install` | **Install Hermes Agent** | "LifeQuest needs the Hermes CLI on your PATH. Install Hermes, then Recheck." |
| `profile_error` | **Could not write the `<profile>` profile** | The filesystem error and the path it happened on |
| `port_busy` | **Companion port is busy** | "Something else is on port `<port>`. Recheck after freeing the Hermes host gateway port." |
| `gateway_exited` | **Hermes gateway exited** | The Hermes CLI's own sentence about why |
| `hermes_too_old` | **Hermes is too old** | "This Hermes build does not expose the Sessions API (session list + chat/stream). Update Hermes, then Recheck." |
| `auth_error` | **Companion rejected the API key** | "The `<profile>` profile key was rejected. Recheck after fixing the profile .env." |
| `disconnected` | **Companion disconnected** | "Could not reach the `<profile>` profile on the Hermes host gateway." |

While a check is running the card reads **Connecting to your LifeQuest companion…**
with "Looking for the Hermes CLI and the `<profile>` profile."

Two controls are on the card:

1. **Recheck** — the primary button; its label becomes **Connecting…** while it
   runs. It re-runs the whole ensure: find the CLI, wire the profile, attach to a
   running host or start one, and publish the new status. The app serialises these
   runs, so clicking twice does not race the first.
2. **The profile picker** — every Hermes profile this install has, the active one
   marked **In use**, and **Create the lifequest profile** when the app's own
   profile does not exist yet. Choosing a row moves the companion onto that profile
   and re-runs the ensure against it. The choice is remembered across launches.

### Companion not installed

The card says **Install Hermes Agent** and offers a **Hermes install docs** link.
Install Hermes, make sure `hermes` is on `PATH` (the app also looks in the
installer's own shim directory, `<HERMES_HOME>/hermes-agent/.hermes/bin`, because a
GUI launch often carries a minimal `PATH`), then press **Recheck**.

### Companion port is busy

The card names the port, normally `8642` — the Hermes host gateway's API port. Some
other process (another Hermes gateway, a leftover host, another copy of the app)
owns it. Stop that process, then **Recheck**.

Separately, LifeQuest's own MCP doors can fail to bind without blocking the vault.
Settings → Hermes → **MCP doors** shows **Local** (`http://127.0.0.1:8643/mcp`) and
**Invite** (`http://127.0.0.1:8646/mcp`) with a per-door error underneath the one
that failed. A taken door means agents cannot reach the vault; the studio still
opens.

### Hermes gateway exited

The card says **Hermes gateway exited** and quotes what the CLI said. Hermes prints
its refusals on stdout and exits non-zero with an empty stderr, so that sentence is
the real failure — read it, fix what it names, then **Recheck**. If the host is
merely wedged, the profile picker's **Recheck** is still the first move; only
restart the app if the process itself is gone.

### Companion rejected the API key

The card says **Companion rejected the API key** and points at the profile's `.env`.
The host rejected the key LifeQuest presented for the profile. Use Settings →
Hermes → **Open profile folder** to inspect the profile, fix the `.env` (or re-create
the `lifequest` profile from the picker so the app writes a fresh one), then
**Recheck**. The renderer never sees a raw key: it can learn whether one is stored,
not what it is.

### Hermes is too old

The card says **Hermes is too old**: the installed build does not expose the
Sessions API the app needs for the chat pane. Update Hermes, then **Recheck**.

### Companion disconnected

The card says **Companion disconnected**: the app could not reach the profile on the
host gateway. Try **Recheck** once; if it persists, choose another installed profile
in the picker, or start the host yourself and **Recheck** again. A profile switch
also clears a status that belongs to a host the app is no longer talking to.

## Stuck at the splash

The splash is the lettered **LIFE QUEST** overlay declared in `index.html` and
removed by `SplashGate`. It covers the app's **own** boot — the renderer bundle and
the first vault read — with a floor of `SPLASH_FLOOR_MS = 1500`. It deliberately
does **not** wait on the companion: a slow or missing companion is reported on the
setup card, never by holding the logo up.

So:

1. **Up to about two seconds is normal.** The floor alone is 1.5 s.
2. **If the logo is still there after that**, the renderer never finished its first
   boot. Press `Ctrl+R` to reload the window (the app's own reload accelerator). A
   reload re-runs the renderer and the first vault read without rebuilding anything.
3. **If a reload does not clear it**, quit with `Ctrl+Q` and launch again. A
   pending file change or a vault read that cannot finish is the thing to suspect;
   move the vault question to one side by opening a different folder from Settings →
   Vault → **Change folder…** next launch.
4. **If the companion is the problem, you will not see the logo** — you will see the
   setup card. Treat a stuck splash as an app-process problem, not a Hermes one.

## Vaults

### It will not open

The welcome page prints the error under **Create vault** / **Open vault**. These are
the messages the vault layer produces, and what each one means:

| Message | Cause | Fix |
|---|---|---|
| `Not a folder: <path>` | You picked a file, not a folder | Pick the vault folder itself |
| `Vault already exists at <path>` | **Create vault** on a folder that already holds a vault | Use **Open vault** instead |
| `Choose a folder for the vault, not a filesystem root` | You picked a drive root | Pick a folder inside it |
| `Unsupported schemaVersion X; expected Y` | The vault was written by a different schema version | Open it with the build that wrote it, or move forward with a build that supports it |
| `Vault path is a symlink: <path>` | A file inside the vault is a symlink | Replace the link with the real file |
| `Vault path contains a symlink: <path>` | A directory inside the vault is a symlink | Replace the link with a real directory |
| An `ENOENT` about `lifequest.json` | The folder is not a LifeQuest vault | Pick the folder that contains `lifequest.json` |

The symlink refusals are deliberate: a vault can arrive through sync, git or shared
storage, and a link inside it can point anywhere on the machine. The **vault root
itself** may be a symlink (`~/vault` → `/data/vault`); nothing inside it may be.

### The wrong vault opened

The app reopens the last vault automatically. Two ways out:

- Settings → Vault → **Change folder…** — opens the folder picker and loads the new
  vault **in place**. Nothing is moved or deleted; the recent list is updated.
- The welcome page's **Recent vaults** list, when no vault is open.

Settings → Vault also shows the open vault's **Name**, **Id** and **Path**, so you
can confirm which one you are in before acting on it.

### Files changed on disk

When the vault changes outside the app's own writes — a sync client, another
editor, a second copy of the app — a banner appears above the app: **Files changed
on disk**, with a **Reload** button. Press it to re-read the vault. The banner is
informational: the app is not broken, only its in-memory snapshot is older than
the files.

### Agent changes are not showing up

Most agent writes do not apply directly. An agent's change to doctrine, the library,
reviews, projects, goal records, Architecture templates, non-script page blocks,
pins, ingest mappings, posted ledger edits, or a kit install **files a Decision** and
waits for you to **Approve** it in [Decisions](./23-decisions.md). If the change is
not on the page and not in Decisions, check:

- The **File implied changes** toggle in Settings → Hermes — when it is off, a chat
  turn that implies a document change does not file one.
- Whether the surface is **locked**: a locked board or document takes the change as
  a pending Decision instead of applying it.
- Whether the write was one of the kinds that apply directly and are named in chat:
  Daily Schedule tasks, a conversational capture whose amount and account are
  unambiguous, and a page's script block.

If it still is not there, look at the *Files changed on disk* banner: another
writer may have changed the file under a stale snapshot.

### A locked surface cannot be edited

Locks are per surface, and each names itself:

- **Dashboard** — the board header shows **Locked** or **Unlocked**. A locked board
  reads: "This dashboard is locked. Unlock to add, move, or remove cards; the
  companion's changes wait in Decisions." The button next to it is **Unlock** (and
  **Lock** when unlocked).
- **A doctrine or library document** — the editor's actions are **Unlock** and
  **Propose change** while locked; **Save** and **Lock** while unlocked.
- **A review** — a **Locked** badge and an **Unlock** button replace the editors; use
  **Mark done** on an open review to close it.

The operator owns the lock; agents cannot lock or unlock, and approving a Decision
does not unlock the document or board it touches.

## Databases and books

### Restoring a domain's database

Restore is explicit and confirmed, never automatic. In Settings → Vault, the
**Books** section holds, per live domain, **Export books** and:

1. Tick the checkbox *Restore replaces the live SQLite book for this domain from
   books.json*.
2. Press **Restore books**. It stays disabled until the box is ticked; pressing it
   without the box is refused with "Check the confirmation box before restoring."

A restore validates every database and row in `books.json` before writing anything,
then copies the current `domain.sqlite` to `domain.sqlite.bak` and rebuilds the book.
If it fails, the message is the diagnosis: `books.json not found for domain: <slug>`,
`books.json is not valid JSON`, `books.json is not a valid export payload`,
`Could not back up the current book, restore aborted: …`, or a named bad row. Every
one of those failures happens before the live book is replaced. If the write fails
after the backup was taken, `domain.sqlite.bak` beside the database is the copy of
what was there before.

## Updates

### The release check failed

The version number at the foot of the rail glows when a newer release exists;
clicking it opens the update dialog. Settings → Updates runs the same check by hand
(**Check now**). A check that did not happen is reported as a failure,
never as "up to date".

| Message | Meaning | What to do |
|---|---|---|
| `Could not reach GitHub: …` | Offline, DNS, proxy, or GitHub is down | **Try again** when the network is back |
| `GitHub has no release to compare against (HTTP 404) — nothing has been published for karmsheel/life-quest yet.` | The feed has no published release | Nothing to install; this is not an app fault |
| `GitHub answered HTTP <code>.` | Rate limiting or an outage | **Try again** later |
| `The release's tag (<tag>) is not a version number.` | The release is tagged something unreadable | Fail-closed: no offer, nothing downloaded |
| `The installer is <n> bytes but the release declares <m>; the file was discarded.` | The download was truncated | **Download and install** again |
| `Refusing to install an update this session did not offer.` | The dialog's offer is older than the session's answer | Close the dialog and **Check again** |
| `The update was not installed.` | You pressed **Cancel** in the native confirmation | Nothing happened; the app is still running |

The dialog's buttons are **Not now**, **Release page** and **Download and install**;
when there is no installer in the release it offers **Open release page** instead.
On a failure it offers **Close** and **Try again** (or **Check again** when you are
already up to date).

### A model warning in Settings → Hermes

After the companion reaches `ready`, it asks the host for its model catalog. If the
pinned model is gone, Settings → Hermes shows, in red:

> The companion's model "<model>" is not in this profile's model catalog any more —
> every chat will fail until you pick a live model in the chat composer.

Pick a live model in the chat composer's model menu. If the catalog is missing or
the pinned provider is not authenticated on the host, the app stays silent rather
than warning wrongly — silence is not a verdict.

## Data directories

| Location | What is in it |
|---|---|
| Your vault folder | Everything you own: `.lifequest/` (settings, log, Decisions, map, goals, automations, signals, about, reviews, cache), `domains/<slug>/` (doctrine, media, SQLite, pages, pins, views), `documents/`, `projects/`, `reviews/`, `planning/`, `notes/daily/`, `notes/ideal-state/` |
| `%APPDATA%\LifeQuest` (the app's `userData`) | `recent.json` (recent vaults, active lens per vault, companion profile choice), `secrets.json` (OS-encrypted API keys), `pairing-secrets/connected-agent-secrets.json` (the companion bearer and agent/invite hashes), `companion-filing.json` |
| The Hermes home (`%LOCALAPPDATA%\hermes` or `~/.hermes`) | Hermes' own install, profiles, `config.yaml`, `SOUL.md`, `.env`; the app's profile is `profiles/lifequest` (or the root home for `default`) |
| `%TEMP%\LifeQuest-update` | A downloaded installer, until launched or discarded |

The vault is yours to copy, back up and put in git. `userData` is app state and is
recreated empty if removed — which loses your recent list and stored keys, not your
life data.

## How to find logs

The app writes no log file of its own. The places output actually goes:

- **The terminal that started the app.** `npm run dev` prints the main process's
  console output — `[dev]` lines for bundling and relaunching, `[secrets]` for the
  keyring warning, and `[fx]` for the exchange-rate refresh.
  A packaged app launched from a shortcut has no console; that is expected, not a
  missing setting.
- **The renderer console, in development only.** `F12` or `Ctrl+Shift+I` opens
  DevTools in a dev build. A packaged build has no DevTools by design.
- **The Life log.** Rail → **Log** (`/log`) is the vault's own record of what
  changed and who changed it, read from `.lifequest/log.jsonl`. It is the closest
  thing to an audit trail the app has.
- **The Hermes profile.** Settings → Hermes → **Open profile folder** opens the
  profile directory so you can read `config.yaml`, `SOUL.md` and `.env` directly.
- **E2E artifacts, when you are running the bench.** A rig writes
  `apps/desktop/e2e/artifacts/<name>.json` and a screenshot beside it.

## When to restart the app

| Situation | What to do |
|---|---|
| A page looks stale after an external edit | Press **Reload** in the *Files changed on disk* banner, or `Ctrl+R` |
| A component or style change you made a moment ago is not visible | Renderer changes are hot-reloaded in dev; `Ctrl+R` if HMR missed one |
| A main-process or preload change in dev | Nothing — `npm run dev` rebundles and relaunches the app for you |
| The companion state is wrong but the app is alive | **Recheck** on the setup card or in Settings → Hermes, then the profile picker |
| The companion process itself is gone | **Recheck** starts it; relaunch the app only if Recheck cannot |
| An update was installed | The app quits itself after handing the installer over; launch the new build when the installer finishes |
| The window is blank, the splash never clears, and reload does not help | Quit with `Ctrl+Q` and launch again |

Nothing in the app repairs a vault behind your back. If a file on disk is wrong, the
app reports it and refuses the action; fix the file (or restore it from your backup)
with the app closed, then reopen the vault.

## Related

- [Getting started](./02-getting-started.md)
- [The vault](./04-the-vault.md)
- [Decisions](./23-decisions.md)
- [Companion](./24-companion.md)
- [Updates](./27-updates.md)
- [Settings](./28-settings.md)
- [Development](./31-development.md)
