# Troubleshooting

Every failure in LifeQuest has a surface that names it: the companion setup screen
carries the companion's own state, the welcome screen carries vault-open errors, a
banner carries external file changes, and Settings carries the door, update and
restore results. This page maps what you see to what it means and what to do about
it. It only describes controls and messages the app actually has. Start from
[Wiki home](./index.md).

## Where it lives

| Surface | When you see it | What it tells you |
|---|---|---|
| The splash (logo over the window) | For the first ~1.5–2 s of any launch | The app's own boot is still running |
| The **LifeQuest companion** setup card | Whenever the companion is not `ready` | Which companion failure it is, **Recheck**, the boot companion picker, and the Pi endpoint form |
| The welcome page | No vault open | **Create vault**, **Open vault**, **Recent vaults**, and the open error |
| *Files changed on disk* banner | The vault changed outside the app's own writes | A **Reload** button |
| The chat dock | A new vault, or the companion's answers | The **Welcome to LifeQuest** onboarding card |
| Settings → Hermes | Anytime | Companion status, **Agents in this vault**, **MCP doors**, **Recheck** |
| Settings → Areas | Locked areas are missing | **Unlock another area**, **Your areas**, **Archived** |
| Settings → Vault | Anytime | The open vault, **Change folder…**, **Books** export/restore |
| Settings → Updates | Anytime | What the release check got, and **Check now** |

## First: which screen are you on?

- **The logo stays up.** The app is still booting its own renderer and first vault
  read. See [Stuck at the splash](#stuck-at-the-splash).
- **A card headed "LifeQuest companion".** The studio is gated on the companion and
  it is not ready. See [The companion will not connect](#the-companion-will-not-connect).
- **The welcome page.** No vault is open. See [Vaults](#vaults).
- **The studio, but something is missing.** A Decision is waiting, an area is still
  locked, a surface is locked, or the file on disk is newer than the screen.

## The companion will not connect

The studio does not open without a companion: until one has answered `ready` once,
the app renders the setup card instead of the rail and pages. That is the product
working as designed, not a hang. The card carries a picker at the top — **Pi**
(built in) and **Hermes** (external) — so the first fix is to check which one you
are on.

**Recheck** is the primary button, and its label becomes **Connecting…** while it
runs. It re-runs the whole ensure for the selected companion; the app serialises
these runs, so clicking twice does not race the first.

### Pi's states

| State | Title on the card | Body on the card |
|---|---|---|
| `needs_setup` | **Set up the built-in companion** | "Point it at an OpenAI-compatible endpoint and name a model. A local server works without a key." — or the specific reason, "Choose a model for the built-in companion." / "Add the API key for this endpoint." |
| `auth_error` | **The endpoint rejected the key** | "Update the API key below, then save." |
| `disconnected` | **Companion disconnected** | "The model endpoint did not answer. Check the URL and that the server is running, then Recheck." |

On `needs_setup` the card shows the endpoint form: **Endpoint**, **Model**, **Name**
and **API key**, then **Save and connect** (disabled until there is an endpoint and
a model). A local server (Ollama, LM Studio, llama.cpp) needs no key. The form says
the key is sealed by the OS and never written into the vault; on a machine with no
OS keyring it adds that the key is kept for this session only.

Check the endpoint's own model list: the app asks `GET /models`, so a URL that
answers a chat but not a model list, or a model name the endpoint does not list,
fails here rather than mid-conversation.

### Hermes's states

| State | Title on the card | Body on the card |
|---|---|---|
| `needs_install` | **Install Hermes Agent** | "The external sidekick needs the Hermes CLI on your PATH. Install Hermes, then Recheck — or switch to the built-in companion above." |
| `profile_error` | **Could not write the `<profile>` profile** | The filesystem error and the path it happened on |
| `port_busy` | **Companion port is busy** | "Something else is on port `<port>`. Recheck after freeing the Hermes host gateway port." |
| `gateway_exited` | **Hermes gateway exited** | The Hermes CLI's own sentence about why |
| `hermes_too_old` | **Hermes is too old** | "This Hermes build does not expose the Sessions API (session list + chat/stream). Update Hermes, then Recheck." |
| `auth_error` | **Companion rejected the API key** | "The `<profile>` profile key was rejected. Recheck after fixing the profile .env." |
| `disconnected` | **Companion disconnected** | "Could not reach the `<profile>` profile on the Hermes host gateway." |

The Hermes card also offers the profile picker — every profile this install has,
the active one marked **In use**, and **Create the lifequest profile** when it does
not exist yet — plus a **Hermes install docs** link on `needs_install`.

Common fixes: install Hermes and make sure `hermes` is on `PATH` (the app also looks
in the installer's shim directory `<HERMES_HOME>/hermes-agent/.hermes/bin`); stop
whatever owns port `8642` and **Recheck**; read the CLI's own sentence on
`gateway_exited`; fix the profile `.env` (or re-create the profile so the app writes
a fresh one) on `auth_error`.

### The companion switched but the studio came back

It should not. After the first `ready`, the studio stays put: switching agents (or
vaults) is a status and data change on the surface, not a teardown. If you do see
the connect card after switching, **Recheck** once — a switch deliberately does
not wait for the new agent to boot, so its first status may be `switching` for a
moment.

### A vault shows another vault's chats

It should not, and it no longer does: chats are stored per vault. If you are on an
older build, update; the vault that was open at the upgrade keeps the old chats,
and every other vault starts clean. A chat cannot be moved between vaults by the
app — use the vault that owns it.

### A model warning in Settings → Hermes

After `ready`, the companion's model is checked against its catalog. A retired
model shows in red:

> The companion's model "<model>" is not in this profile's model catalog any more —
> every chat will fail until you pick a live model in the chat composer.

(Pi's wording names "this endpoint's model list".) Pick a live model in the chat
composer's model menu. If the catalog is missing, or the provider is not
authenticated, the app stays silent rather than warning wrongly.

## Stuck at the splash

The splash is the lettered **LIFE QUEST** overlay declared in `index.html` and
removed by `SplashGate`. It covers the app's **own** boot — the renderer bundle and
the first vault read — with a floor of `SPLASH_FLOOR_MS = 1500`. It deliberately
does **not** wait on the companion: a slow or missing companion is reported on the
setup card, never by holding the logo up.

1. **Up to about two seconds is normal.**
2. **If the logo is still there after that**, press `Ctrl+R` to reload the window. A
   reload re-runs the renderer and the first vault read without rebuilding anything.
3. **If a reload does not clear it**, quit with `Ctrl+Q` and launch again. A vault
   read that cannot finish is the thing to suspect; change the folder from Settings →
   Vault → **Change folder…** on the next launch.
4. **If the companion is the problem, you will not see the logo** — you will see the
   setup card.

## Onboarding

A new vault's chat dock shows a **Welcome to LifeQuest** card: ten minutes on what is
going on, or start talking whenever you like. **Begin the interview** starts the record and sends
your turn through the composer; a first turn typed before pressing Begin starts the
record silently. While the interview is open the card shrinks to one line with
**Continue the interview**.

- **No card on an existing vault.** A vault with no `.lifequest/onboarding.json`
  reads as completed, and so does a corrupt one — that is the migration rule that
  keeps old vaults quiet. If the card never appears on a *new* vault, check that the
  vault was created by this build.
- **The card disappeared mid-interview.** It is drawn from vault truth and listens
  to the data revision, so it returns on the next turn. **Continue the interview**
  re-opens it.
- **The card became a receipt.** That is the design: the companion opens the areas
  with `propose_onboarding_unlock` before the card paints, then the card announces
  what was opened — "After analyzing our conversation, I've opened up the Health and
  Business areas for you." — and **Continue** acknowledges it.
- **The batch failed.** The tool returns the error instead of writing, the record
  stays in progress, and no receipt is shown. **Continue the interview** to retry.

## An area is missing or invisible

Locked areas are absent from everything that reads the vault, not only the switcher:
no list, no doctrine, no board, no goal, and the companion cannot leak one. That is
expected until an area is opened.

- A new vault opens on **Life** with Health, Mind, Finance, Business and
  Relationships on disk but locked.
- Settings → **Areas** is the one screen that names them: **Unlock another area**
  with a plain **Unlock** on each row (no confirmation — unlocking is a reveal, not
  an activation), then **Your areas**, **Archived**, **Create area**.
- The lens strip is a quiet **Life** label until a second area is unlocked; then it
  becomes the area band with **Life** first.
- A saved lens that names a locked or archived area resolves to **Life** and the
  preference is cleared. The main process refuses to activate a locked area.
- **Life** itself can never be archived or deleted.

## Chat tabs and the dock

- **A new chat opens its own tab** beside the one in front; **New chat** never
  replaces the conversation on screen.
- **Pinned chats are permanent tabs** (small squares). While a chat is pinned the
  sidebar hides its archive control and the row menu loses **Archive** and
  **Delete**; **Unpin** first.
- **Archived chats** live behind the chats header's view options: **Hide archived**
  (the default working list), **Show archived** (a greyed band tagged **Archived**),
  **Only archived**. An archived row is restorable from its menu (**Unarchive**) but
  never openable; **Only archived** with nothing archived says **No archived chats**.
- **Tabs come back after a restart.** The strip is remembered in the profile; a chat
  archived or deleted while the app was shut loses its tab, and a deliberately
  emptied strip stays empty.
- **A page-started chat** (Analyze note, Send to agent, a review) opens in its own
  tab under its own name rather than taking over the current one.
- **A chat that will not stop saying it is running.** A live turn is closed by the
  companion's own final frame, and normally that is the only thing that clears the
  rail's dot. If the companion's stream dies without that frame, the app waits 45
  seconds of complete silence (a healthy gateway writes a keepalive every ten) and
  then closes the turn itself: the dot clears, the composer unlocks, the chat says
  "The companion stopped sending while this turn was running…", and the transcript
  is re-read from the companion. If the reply is still missing after that, send
  again — the companion may have lost the turn entirely. A running dot that clears
  by itself five to forty-five seconds after the reply stops is this bound doing its
  job, not a new fault.

## Vaults

### It will not open

The welcome page prints the error under **Create vault** / **Open vault**:

| Message | Cause | Fix |
|---|---|---|
| `Not a folder: <path>` | You picked a file, not a folder | Pick the vault folder itself |
| `Vault already exists at <path>` | **Create vault** on a folder that already holds a vault | Use **Open vault** instead |
| `Choose a folder for the vault, not a filesystem root` | You picked a drive root | Pick a folder inside it |
| `Unsupported schemaVersion X; expected Y` | Written by a different schema version | Open it with the build that wrote it, or one that supports it |
| `Vault path is a symlink: <path>` | A file inside the vault is a symlink | Replace the link with the real file |
| `Vault path contains a symlink: <path>` | A directory inside the vault is a symlink | Replace the link with a real directory |
| An `ENOENT` about `lifequest.json` | The folder is not a LifeQuest vault | Pick the folder that contains `lifequest.json` |

The symlink refusals are deliberate. The **vault root itself** may be a symlink
(`~/vault` → `/data/vault`); nothing inside it may be.

### The wrong vault opened

The app reopens the last vault automatically. Settings → Vault → **Change folder…**
opens the picker and loads the new vault **in place** — nothing is moved or deleted.
The welcome page's **Recent vaults** list works when no vault is open. Settings →
Vault shows the open vault's **Name**, **Id** and **Path** so you can confirm first.

### Files changed on disk

When the vault changes outside the app's own writes — a sync client, another editor,
a second copy — a **Files changed on disk** banner appears with a **Reload** button.
Press it to re-read the vault. The app is not broken; its snapshot is older than the
files.

### Agent changes are not showing up

Most agent writes file a Decision and wait for **Approve** in
[Decisions](./23-decisions.md). Two kinds apply directly after the chat's
confirmation and are named there: new databases and new rows
(`database.created`, `database.row.created`, `database.rows.created`), plus Daily
Schedule tasks, unambiguous conversational captures and page script blocks. If a
change is missing everywhere:

- Check Decisions — the inbox is one global shelf now, not filtered by the lens.
- Check the area: a write cannot land in a locked area.
- Check **File implied changes** in Settings → Hermes; off means a chat turn that
  implies a document change files nothing.
- Check whether the surface is locked: a locked board or document takes the change
  as a pending Decision.

### A locked surface cannot be edited

The lock leads a page's three-dot menu on every lockable page, as a
`menuitemcheckbox` reading **Lock** / **Saving…**; the page's own actions follow it
(**Pin board** on the Dashboard, **Propose change** on a locked document, **Delete
note** in the library). The state badge returns to the page's heading. A review
shows a **Locked** badge with an **Unlock** button, and **Mark done** closes an open
one. The operator owns the lock: agents cannot lock or unlock, and approving a
Decision does not unlock the surface it touches.

## Books

Settings → Vault → **Books** lists each live area with **Export books**, an **Allow
restore** toggle and **Restore books** (disabled until the toggle is on). Arming the
toggle is the confirmation; the row disarms itself after a restore, so the next one
is a new deliberate act. A restore validates every row in `books.json` before writing
anything, copies the current `domain.sqlite` to `domain.sqlite.bak`, and rebuilds the
book. A failure names the diagnosis (`books.json not found for domain: <slug>`,
`books.json is not valid JSON`, a named bad row); if the write fails after the
backup, `domain.sqlite.bak` beside the database is the copy of what was there.

## Updates

### The release check failed

The build number in the chat dock's bottom bar glows when a newer release exists;
clicking it opens the dialog. Settings → Updates runs the same check by hand
(**Check now**). A check that did not happen is reported as a failure, never as
"up to date".

| Message | Meaning | What to do |
|---|---|---|
| `Could not reach GitHub: …` | Offline, DNS, proxy, or GitHub is down | **Try again** when the network is back |
| `GitHub has no release to compare against (HTTP 404) — nothing has been published for karmsheel/life-quest yet.` | The feed has no published release | Nothing to install; not an app fault |
| `GitHub answered HTTP <code>.` | Rate limiting or an outage | **Try again** later |
| `The release's tag (<tag>) is not a version number.` | The release is tagged something unreadable | Fail-closed: no offer, nothing downloaded |
| `The installer is <n> bytes but the release declares <m>; the file was discarded.` | The download was truncated | **Download and install** again |
| `Refusing to install an update this session did not offer.` | The dialog's offer is older than the session's answer | Close it and **Check again** |
| `The update was not installed.` | You pressed **Cancel** in the native confirmation | Nothing happened; the app is still running |

The dialog's buttons are **Not now**, **Release page** and **Download and install**;
without an installer it offers **Open release page**. On failure it offers **Close**
and **Try again** (or **Check again** when you are up to date).

### The update notice appears while you work

That is the hourly watch finding a release: **LifeQuest 0.3.0 is available**, with
**View update** and a dismissal. It is announced once per release per session, a
dismissal is final for that release, and a release the feed stops offering clears the
notice. If the window is not focused you also get a native notification. A collapsed
dock hides the build number; reopen the dock from its launcher. Nothing installs
without your **Download and install** and the native confirmation.

## Images

**Images** (`/images`) is the vault picture library: **Upload pictures** or drop
files anywhere on the page, caption each one, and **Remove** behind a confirm. PNG,
JPEG, GIF and WebP up to 8 MB are accepted — the bytes decide the kind, not the file
name. An index row whose file has gone draws as missing rather than disappearing.
The vision board is on the **Vision** page, not here.

## The wiki check fails

Working on the repository rather than the app: `npm run docs:check` must pass, and
`npm run release` runs it before anything is built. It names the failing page in the
report — the version line in `docs/wiki/index.md`, a route or rail label no page
mentions, a dead internal link, a page missing from the MkDocs nav, or a page
without `## Related` / its home link. Fix the named page; do not edit the nav to
hide a missing page.

## Data directories

| Location | What is in it |
|---|---|
| Your vault folder | `.lifequest/` (settings, log, Decisions, map, goals, automations, signals, brief, onboarding record, reviews, cache), `domains/<slug>/`, `images/`, `attachments/`, `documents/`, `projects/`, `reviews/`, `planning/`, `notes/` |
| `%APPDATA%\LifeQuest` (`userData`) | `recent.json` (recent vaults, lens and agent binding per vault), `secrets.json` (OS-encrypted Hermes keys), `pi-endpoint.json` and `pi-endpoint.key`, `pi-sessions/<vault id>/`, `pairing-secrets/`, `companion-filing.json` |
| The Hermes home (`%LOCALAPPDATA%\hermes` or `~/.hermes`) | Hermes' own install, profiles, `config.yaml`, `SOUL.md`, `.env` |
| `%TEMP%\LifeQuest-update` | A downloaded installer, until launched or discarded |

The vault is yours to copy, back up and put in git. `userData` is app state;
removing it loses your recent list, the per-vault agent bindings and stored keys,
not your life data.

## How to find logs

The app writes no log file of its own. Output goes to:

- **The terminal that started the app** — `[dev]` lines for bundling and
  relaunching, `[secrets]` for the keyring warning, `[fx]` for the exchange-rate
  refresh.
- **The renderer console, in development only** — `F12` or `Ctrl+Shift+I`. A
  packaged build has no DevTools by design.
- **The Log page** — Rail → **Log** (`/log`) is the vault's own record of what
  changed and who changed it, read from `.lifequest/log.jsonl`.
- **The Hermes profile** — Settings → Hermes → **Open profile folder** opens
  `config.yaml`, `SOUL.md` and `.env`.
- **E2E artifacts** — a rig writes `apps/desktop/e2e/artifacts/<name>.json` and a
  screenshot beside it.

## When to restart the app

| Situation | What to do |
|---|---|
| A page looks stale after an external edit | **Reload** in the *Files changed on disk* banner, or `Ctrl+R` |
| A renderer change you made is not visible | HMR normally handles it; `Ctrl+R` if it missed one |
| A main-process or preload change in dev | Nothing — `npm run dev` rebundles and relaunches |
| The companion state is wrong but the app is alive | **Recheck** on the setup card or in Settings → Hermes |
| The companion process itself is gone | **Recheck** starts it; relaunch the app only if it cannot |
| An update was installed | The app quits itself after handing the installer over |
| The window is blank, the splash never clears, reload does not help | Quit with `Ctrl+Q` and launch again |

Nothing in the app repairs a vault behind your back. If a file on disk is wrong, the
app reports it and refuses the action; fix the file (or restore your backup) with the
app closed, then reopen the vault.

## Related

- [Getting started](./02-getting-started.md)
- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Decisions](./23-decisions.md)
- [The Companion](./24-companion.md)
- [Updates](./27-updates.md)
- [Development](./31-development.md)
