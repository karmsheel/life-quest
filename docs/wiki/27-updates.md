# Updates

LifeQuest tells you when a newer release exists, without a background poller and
without installing anything you did not ask for. The version number at the foot
of the rail is the whole affordance: quiet text while you are current, a glowing
button when GitHub names something newer, and one dialog that offers to download
the installer, hand it to Windows, and step aside so it can replace the app. See
also [Wiki home](./index.md).

## Where it lives

- Rail: the very foot of the left column, below the Log, rendering `v0.2.0` from
  `apps/desktop/package.json`. It is a button in every state — its accessible
  name is "Version 0.2.0. Check for updates." when nothing is offered.
- When an update is available, a small **Update available** line appears above
  the number and the number gains the accent glow.
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
local-first desktop app has no notification channel. The update badge closes that
gap without turning the studio into something that phones home on a schedule: it
asks once per launch, says nothing when there is nothing to say, and never
installs on its own.

The second rule is trust. The system reads a public feed and then runs a
downloaded executable, so every failure is made to fail closed — a check that
could not answer is reported as "could not check", never as "up to date", and a
download that does not come from this app's GitHub release is refused before a
byte moves.

## How to use it

### When a newer release is published

1. The launch's check reads the feed and finds a newer version. The rail shows
   **Update available** above a glowing `v0.2.0`.
2. Click the version number. The dialog opens with the kicker **Upgrade
   available** and the title **LifeQuest 0.2.1** (the release's version).
3. Read the offer: "You are running **v0.2.0**. Version **0.2.1** is ready to
   download." Choose **What changed** to unfold the release notes, which are shown
   as plain text exactly as written on GitHub. The installer's file name and size
   sit under the notes.
4. Choose **Download and install**. A progress bar reports the download:
   "Downloading 42% of 12.3 MB… LifeQuest will close so the installer can replace
   it." The dialog cannot be dismissed while the download runs.
5. A native confirmation asks once: "Install this LifeQuest update?" with
   **Install update** and **Cancel**. Cancel is the default; read the detail,
   which names the file and says LifeQuest will close so the installer can
   replace its files.
6. Confirm. The app launches the installer and quits about a second later, so
   nothing holds the files the installer has to replace. The installer's own
   wizard takes it from there.

**Not now** closes the dialog without touching anything. **Release page** opens
the release's GitHub page in your browser instead — the same offer the dialog
makes when a release carries no Windows installer.

### When there is nothing new

1. Click the version number in any state. If the launch's answer is already in
   hand, the dialog opens on the answer rather than asking again.
2. During a read the kicker reads **Checking for updates** and the body "Asking
   GitHub for the newest release…".
3. When the feed says this build is current, the dialog is titled **LifeQuest
   v0.2.0**, the kicker is **Up to date**, and the body reads "That is the newest
   release — there is nothing to download." **Check again** repeats the read
   (forcing the network); **Close** dismisses.
4. If the check could not answer, the kicker reads **Update check failed**, the
   title **Could not check for updates**, and the body names the reason.
   **Try again** retries. The rail stays quiet — it never glows on a failed
   check.

### Check and preview from Settings

- **Settings → Updates** is titled **Updates** with the subtitle "LifeQuest
  v0.2.0 · checked from GitHub Releases". Its status line summarises the last
  answer: "Checking GitHub for a newer release…", "LifeQuest 0.2.1 is available
  (you are on v0.2.0).", "Up to date — v0.2.0 is the newest release.", "No answer
  from the update feed yet.", or the failure. **Check now** reads the feed again
  (it reads **Checking…** while it works), and **Release page** appears when a
  release is being offered.
- **Settings → Developer** carries one switch, **Preview the update badge**. Turn
  it on and the rail glows as if a release had been published, and the dialog
  offers `v9.9.9` — a version that does not exist — under the kicker **Preview —
  not a real release**. The preview carries no installer, so nothing can be
  downloaded from it; Settings → Updates keeps reporting what GitHub really said;
  and a real release always outranks the preview. The switch is remembered across
  launches until you turn it off.

## The screen

| Part | What it does |
|---|---|
| **Update available** | Quiet label above the number, shown only while an offer (or the preview) is up. |
| Version number | `v0.2.0`. Always a button, with a title of "Check for updates" or "LifeQuest 0.2.1 is available". Glows only when there is something to install. |
| Dialog kicker | **Upgrade available**, **Preview — not a real release**, **Checking for updates**, **Up to date**, or **Update check failed**. |
| Dialog title | The offered version, this build's version, or "Could not check for updates". |
| **What changed** / **Hide what changed** | Folds the release notes open and closed. Notes are plain text, never parsed. |
| File line | The installer's name and size, when the release carries one. |
| Progress bar | Live download progress, labelled "Downloading the installer" for a screen reader. |
| Actions | **Not now**, **Release page**, **Download and install** / **Installing…**; **Close**, **Check again**, **Try again**. Cancel takes the focus. |

## Rules and behaviour

- **Once per launch.** The renderer asks on mount and main keeps that answer for
  the session. Only a manual check — the rail's version number or **Check now** —
  passes `force` and reaches the network again. A manual check that arrives while
  a read is in flight joins it instead of starting a second one.
- **Only a strictly newer version is offered.** Versions are compared as numbers
  per component, so `0.10.0` beats `0.9.0`; a prerelease is older than the release
  it precedes; an equal, older or unparseable version produces no offer. An
  unreadable tag fails closed: no glow, no download.
- **A check that did not answer is not an answer.** A missing release, a draft,
  an HTTP failure or an unreadable payload is reported as "could not check", and
  the rail never glows. A failed check is not cached, so the next attempt reaches
  the network.
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
- **A release without an installer is still an upgrade.** The dialog says so and
  offers **Open release page** instead of a download.
- **The feed is anonymous.** The repository is public, so the check holds no
  token and stores nothing for it. Nothing about your vault leaves the machine;
  the only request is the public release read.
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

`npm run release` writes the installer, the portable zip and the manifest, and
exits non-zero rather than reporting success when an asset is missing. It does
not upload: `gh release create` attaches the files to a GitHub release, and
nothing half-publishes on its own. `npm run package` is the developer build (an
unpacked folder) and is not part of the update path.

## Tips and edge cases

- **The version number is always clickable**, even with no update. Clicking when
  current is a legitimate manual check, and it opens the dialog on the answer
  instead of doing nothing.
- **The glow is a state, not a style.** A quiet rail means no offer, not a broken
  update system. The dialog always reports what actually happened.
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
- **Where the installer lands.** It downloads into `LifeQuest-update` under the
  OS temp folder, is launched from there, and the app quits so the installer can
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
