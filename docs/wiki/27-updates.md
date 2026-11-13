# Updates

LifeQuest tells you when a newer release exists, without installing anything you
did not ask for. The build number lives in the chat dock's bottom bar: quiet text
while you are current, a glowing chip with **Update available** beside it when
GitHub names something newer, and an in-app notice the app raises when a release
lands while you are working. Clicking either opens the one dialog that offers to
download the installer, hand it to Windows, and step aside so it can replace the
app. See also [Wiki home](./index.md).

## Where it lives

- The version badge (`v0.2.10`) sits at the trailing end of the chat dock's bottom
  action bar, after **Collapse chat**. The bar's accessible name is "Dock
  actions".
- When an update is available, a small **Update available** line appears beside
  the number and the number gains the accent glow.
- With the dock collapsed the number is not on screen. Reopen the dock from its
  launcher to see the version and ask for a check.
- The in-app notice is a card fixed at the foot of the window, portalled over the
  app. It is not a page and does not take focus.
- The dialog is an in-window modal portalled over the app, not a page and not an
  OS window.
- **Settings → Updates** repeats what the feed said and adds **Check now**.
- **Settings → Developer** has the one switch that fakes the affordance:
  **Preview the update badge**.
- The feed is the public GitHub Releases API for `karmsheel/life-quest`
  (`https://api.github.com/repos/karmsheel/life-quest/releases/latest`). The
  check is one anonymous read: the app stores no token for it.

## What it is for

A release can be published and then sit unnoticed for weeks, because a
local-first desktop app has no notification channel. The old behaviour read the
feed once at launch and glowed the build number — which you had no reason to
look at, because nothing said there was news. The app now reads the feed on an
hourly clock as well, raises an in-app notice, and raises a native notification
when the window is not focused. That closes the gap without turning the studio
into something that installs on its own.

The second rule is trust. The system reads a public feed and then runs a
downloaded executable, so every failure is made to fail closed — a check that
could not answer is reported as "could not check", never as "up to date", and a
download that does not come from this app's GitHub release is refused before a
byte moves.

## How to use it

### When a release lands while you are working

1. Main reads the feed on its hourly clock. A release it has not announced before
   raises a notice: **LifeQuest 0.3.0 is available** (the release's version),
   with "You are running v0.2.10. The new release is ready to download."
2. Choose **View update** to open the same dialog the build number opens, on the
   offer already in hand.
3. Or dismiss the notice with its cross (**Dismiss**). A dismissal is final for
   that release in this session: the notice does not come back, though the dock's
   chip still glows until you install or dismiss the dialog.
4. If the window is not focused, main also raises a native notification —
   **LifeQuest 0.3.0 is available**, "Open LifeQuest to download and install it."
   Clicking it restores and focuses the window. A focused window gets the in-app
   notice alone.

The notice is announced once per release per session. If the feed stops offering
a release it already announced (withdrawn, unpublished, downgraded), the glow and
the notice clear together and the news is forgotten — a release that comes back
is news again.

### When you ask for a check

1. Click the version number in the dock bar in any state. If an offer is already
   known, the dialog opens on it; if not, it opens on **Checking for updates** and
   reads the feed.
2. Read the offer: "You are running **v0.2.10**. Version **0.3.0** is ready to
   download." Choose **What changed** to unfold the release notes, shown as plain
   text exactly as written on GitHub. The installer's file name and size sit under
   the notes.
3. Choose **Download and install**. A progress bar reports the download:
   "Downloading 42% of 12.3 MB… LifeQuest will close so the installer can replace
   it." The dialog cannot be dismissed while the download runs.
4. A native confirmation asks once: "Install this LifeQuest update?" with
   **Install update** and **Cancel**. Cancel is the default; read the detail,
   which names the file and says LifeQuest will close so the installer can
   replace its files.
5. Confirm. The app launches the installer and quits about a second later, so
   nothing holds the files the installer has to replace. The installer's own
   wizard takes it from there.

**Not now** closes the dialog without touching anything. **Release page** opens
the release's GitHub page in your browser instead — the same offer the dialog
makes when a release carries no Windows installer.

### When there is nothing new

1. When the feed says this build is current, the dialog is titled **LifeQuest
   v0.2.10**, the kicker is **Up to date**, and the body reads "That is the newest
   release — there is nothing to download." **Check again** repeats the read
   (forcing the network); **Close** dismisses.
2. If the check could not answer, the kicker reads **Update check failed**, the
   title **Could not check for updates**, and the body names the reason.
   **Try again** retries. The dock bar stays quiet — it never glows on a failed
   check.

### Check and preview from Settings

- **Settings → Updates** is titled **Updates** with the subtitle "LifeQuest
  v0.2.10 · checked from GitHub Releases". Its status line summarises the last
  answer: "Checking GitHub for a newer release…", "LifeQuest 0.3.0 is available
  (you are on v0.2.10).", "Up to date — v0.2.10 is the newest release.", "No answer
  from the update feed yet.", or the failure. **Check now** reads the feed again
  (it reads **Checking…** while it works), and **Release page** appears when a
  release is being offered.
- **Settings → Developer** carries one switch, **Preview the update badge**. Turn
  it on and the dock's build number glows as if a release had been published, and
  the dialog offers `v9.9.9` — a version that does not exist — under the kicker
  **Preview — not a real release**. The preview carries no installer, so nothing
  can be downloaded from it; Settings → Updates keeps reporting what GitHub really
  said; and a real release always outranks the preview. The switch is remembered
  across launches until you turn it off.

## The screen

| Part | What it does |
|---|---|
| **Update available** | Quiet label beside the build number, shown only while an offer (or the preview) is up. |
| Version number | `v0.2.10`. Always a button, with a title of "Check for updates" or "LifeQuest 0.3.0 is available". Glows only when there is something to install. |
| In-app notice | **LifeQuest 0.3.0 is available**, the build you are running, **View update**, and a dismissal. A polite status region: no focus, no blocking. |
| Native notification | Title **LifeQuest 0.3.0 is available**, body "Open LifeQuest to download and install it."; only when the window is unfocused. |
| Dialog kicker | **Upgrade available**, **Preview — not a real release**, **Checking for updates**, **Up to date**, or **Update check failed**. |
| Dialog title | The offered version, this build's version, or "Could not check for updates". |
| **What changed** / **Hide what changed** | Folds the release notes open and closed. Notes are plain text, never parsed. |
| File line | The installer's name and size, when the release carries one. |
| Progress bar | Live download progress, labelled "Downloading the installer" for a screen reader. |
| Actions | **Not now**, **Release page**, **Download and install** / **Installing…**; **Close**, **Check again**, **Try again**. Cancel takes the focus. |

## Rules and behaviour

- **The launch's check, then the watch.** The app asks once at launch and main
  keeps that answer for the session; Settings → Updates and the dock's build
  number pass `force` because the operator asked by hand. The watch also passes
  `force`, with `background: true`, because its job is to reach the network again
  and notice a release published after the launch.
- **Once an hour, one anonymous GET.** `UPDATE_POLL_MS` is one hour. A tick that
  is still in flight is skipped, so reads cannot queue and two answers cannot land
  out of order. A failed background read is silent and leaves the session's answer
  and offered installer alone: an offer you can still install is not made stale by
  a check that did not happen.
- **One answer reaches the UI.** Main pushes every watch answer over
  `update:decision`; the dock's badge, the dialog and the notice all draw the
  feed's latest answer instead of two views that can disagree.
- **Only a strictly newer version is offered.** Versions are compared as numbers
  per component, so `0.10.0` beats `0.9.0`; a prerelease is older than the release
  it precedes; an equal, older or unparseable version produces no offer. An
  unreadable tag fails closed: no glow, no download.
- **A check that did not answer is not an answer.** A missing release, a draft, an
  HTTP failure or an unreadable payload is reported as "could not check", and the
  dock bar never glows. A failed manual check is not cached, so the next attempt
  reaches the network.
- **The app runs one installer, and only the one it offered.** The renderer cannot
  name a URL: it can only agree to the installer main itself selected. Before a
  byte moves, main re-checks that the name is a LifeQuest `-setup.exe`, that the
  release declared a size, that the URL is on a GitHub host, and — under the
  product's policy — that it is an asset of this repository's release
  (`https://github.com/karmsheel/life-quest/releases/download/…`). A trusted host
  alone is not enough, because `raw.githubusercontent.com` is writable by any
  account.
- **Redirects are re-checked.** The bytes must still come from a trusted host
  after the redirect chain; anything else is refused before writing.
- **A partial file is never launched.** If the body is truncated or the downloaded
  size does not match what the release declared, the file is deleted and the
  failure reported. Two install requests share one flight, so a double click
  cannot put two installers on the machine.
- **A failed launch does not quit the app.** If Windows will not start the
  installer, the error is shown in the dialog and LifeQuest keeps running — a
  failed upgrade never leaves you with no app.
- **The feed is anonymous.** The repository is public, so the check holds no token
  and stores nothing for it. Nothing about your vault leaves the machine; the only
  request is the public release read.
- **Version is the packaged one.** Both halves read `version` from
  `apps/desktop/package.json`, not `app.getVersion()`, so the number on screen and
  the number the feed is compared against cannot disagree.

### The release build

The update path downloads the installer a release carries. That build is cut from
the repository, not from the app:

| Asset | What it is |
|---|---|
| `LifeQuest-<version>-setup.exe` | NSIS installer; assisted, per-user, asks where to install. This is the file the updater downloads and runs. |
| `LifeQuest-<version>-win-x64.zip` | Portable build — extract and run `LifeQuest.exe`. Not used by the updater. |
| `release/release-manifest.json` | Written by the build: the assets, their sizes and SHA-256 hashes. |

`npm run release` first runs the wiki's docs check (a release whose docs describe
the previous version is refused), then writes the installer, the portable zip and
the manifest, and exits non-zero rather than reporting success when an asset is
missing. It does not upload: `gh release create` attaches the files to a GitHub
release, and nothing half-publishes on its own. `npm run package` is the developer
build (an unpacked folder) and is not part of the update path.

## Tips and edge cases

- **The version number is always clickable**, even with no update. Clicking when
  current is a legitimate manual check, and it opens the dialog on the answer
  instead of doing nothing.
- **The glow is a state, not a style.** A quiet dock bar means no offer, not a
  broken update system. The dialog always reports what actually happened.
- **A collapsed dock hides the number.** The launcher brings the dock back; the
  hourly watch keeps running either way.
- **SmartScreen may warn on first launch** of an unsigned private build. The
  README's instruction is **More info → Run anyway**; the updater itself does not
  change that.
- **A portable zip is not updated by the updater.** Auto-update runs the setup
  `.exe`; if you use the zip, download the new zip yourself. **Release page** is
  the way there.
- **The preview persists.** **Preview the update badge** is stored in the
  renderer's local storage and stays on across launches until you switch it off.
  While it is on, Settings → Updates still reports the real feed.
- **Quit the app before building a release yourself.** A running `LifeQuest.exe`
  can lock files under `release/`; that is a build concern, not an update one.
- **Where the installer lands.** It downloads into `LifeQuest-update` under the OS
  temp folder, is launched from there, and the app quits so the installer can
  replace its files.
- **No silent install, no delta updates and no stored credential.** These are
  deliberate exclusions: every install is a click, the download is the whole
  installer, and the check is anonymous.

## Related

- [The Studio](./03-the-studio.md)
- [The Companion](./24-companion.md)
- [Settings](./28-settings.md)
- [Security](./29-security.md)
- [Development](./31-development.md)
