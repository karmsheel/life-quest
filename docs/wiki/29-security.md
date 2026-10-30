# Security

LifeQuest is local-first, so its security model is not "trust the server". There is
no server. The model is one operator, one machine, one vault folder, and a small
set of doors the app opens on purpose: the OS secure store for API keys, two
loopback MCP doors for agents, the GitHub release feed for updates, and the one
privileged Electron window. This page says where secrets live, which boundaries
the code enforces, and what the app refuses to do. Read alongside
[Wiki home](./index.md).

## Where it lives

There is no Security tab. The controls are spread across the surfaces that own the
boundary, and the enforcement is in the main process.

| What you control | Where you see it | Enforced in |
|---|---|---|
| Hermes API key | The companion setup screen when it is rejected; Settings → Hermes for the companion's status | `apps/desktop/electron/secrets.ts` |
| MCP doors and their bind errors | Settings → Hermes → **MCP doors** (`Local`, `Invite`) | `apps/desktop/electron/mcp-server.ts`, `pairing-door.ts` |
| Agent pairing and grants | Personnel, and the pairing Decision in Decisions | `apps/desktop/electron/pairing-secrets.ts`, `packages/vault-core/src/pairing-grant.ts` |
| Update download and install | The glowing version number, Settings → Updates | `apps/desktop/electron/updater.ts`, `main.ts` |
| Database restore | Settings → Vault → **Books** | `packages/vault-core/src/books-export.ts` |
| Vault path containment | Any vault read or write | `packages/vault-core/src/paths.ts` |

The product invariant is one line: [LAWS/SECRETS.md](../../LAWS/SECRETS.md) —
API keys MUST NOT be stored in the vault.

## How to act on it

There is nothing to configure to "turn security on": the boundaries are always on.
What you do as the operator:

1. **Treat the vault as yours to protect.** It is plaintext on disk, so the OS
   account and your own backups are the confidentiality boundary.
2. **Read the doors.** Settings → Hermes → **MCP doors** tells you whether agents
   can reach the vault, and Personnel is where you approve or reject a pairing.
3. **Only install an update you asked for.** The app offers, you press **Download
   and install**, and the native dialog names the file before anything runs.
4. **Restore deliberately.** Settings → Vault → **Books** needs the confirmation
   tick, and the app refuses the call without it.

## Where secrets live

| File | Holds | Protection |
|---|---|---|
| `secrets.json` in the app's `userData` | The Hermes API key per vault, and adapter secrets | Encrypted with Electron `safeStorage`, stored base64; file `0600` in a `0700` directory |
| `pairing-secrets/connected-agent-secrets.json` in `userData` | The companion bearer (256-bit), a SHA-256 hex of each connected agent's bearer (never the raw bearer), invite-code hashes with expiry and used-at stamps | `0600` in `0700`; repaired on read if an older build left looser modes |
| The Hermes profile's `config.yaml` | The companion's `Authorization` header for the `lifequest` MCP entry | Written `0600` by the app when a door binds |
| The Hermes profile's `.env` | The host's `API_SERVER_KEY` | Written `0600` by the app |
| `%TEMP%\LifeQuest-update` | The downloaded installer, until it is launched or discarded | Temporary; a failed or truncated download is deleted |

None of these is in the vault. A vault can be copied, synced, put in git, or handed
to another machine; a copy must never carry a credential. That is why the pairing
secrets live in `userData` beside `secrets.json` rather than under
`domains/<slug>/data/`.

**Where the vault is not.** The vault itself is plaintext by design — doctrine,
notes, decisions, JSON and SQLite files that the operator can read, diff, sync and
back up. Its confidentiality is the OS account's. Whole-vault encryption is
described in [VISION.md](../../VISION.md) as welcome; it is not implemented today,
and this page will not pretend it is.

### The renderer never holds the raw key

The preload bridge exposes `secrets:hasHermesKey` (a boolean) and
`secrets:setHermesKey` (a write). There is no channel that returns a stored key to
the renderer. Chat turns, the model probe and Personnel's Hermes scan all run in
the main process, which reads the key, builds the request, and returns only the
result. A renderer compromise therefore does not hand over the key.

`safeStorage` is used with no plaintext fallback *in the code*. On Linux without a
keyring Electron resolves it to the `basic_text` backend, where the bytes are
plain base64; the app detects that once per process and warns:

```
[secrets] OS keyring is unavailable; Electron safeStorage is using the plaintext
basic_text backend. Secrets in secrets.json are protected by file permissions only.
```

On Windows the per-user ACL on `%APPDATA%\LifeQuest` is the protection around the
`0600` file mode.

## The vault boundary

Every path that names something inside the vault goes through
`packages/vault-core/src/paths.ts`, and that module enforces two things.

**Segment grammar.** Every id or name that becomes one path segment — page id,
block id, database id, mapping id, project id, document id, view id, cadence,
period, date, domain slug, media name — goes through `assertSafeSegment`. It
refuses both separators, the Windows drive/stream colon, NUL and control
characters, the Windows reserved characters, `.` and `..` (including an embedded
`..`), leading spaces, trailing dots or spaces, and anything over 128 characters.
The point is not tidiness: a segment is untrusted content (an agent tool argument,
a JSON field) being turned into a filename.

**Physical containment.** Lexical `..` checks cannot see a symlink, so
`assertPhysicalContainment` resolves the real vault root once per process and
walks every component below it with `lstat`. A component that is a symlink is
refused with `VaultSymlinkError`, whatever it points at — a link that stays inside
the vault still lets one domain read another's directory. Reads and writes both go
through it, and the synchronous path builders used by destructive operations do
the same `lstat` walk so a recursive delete cannot follow a symlinked `domains/`.

Two deliberate allowances:

- **The vault root itself may be a symlink** (`~/vault -> /data/vault`). What is
  refused is anything *inside* the vault being one.
- **A missing component ends the walk.** It, and everything under it, does not
  exist yet, so a write creates real directories under verified-real parents.

A refused path is an error, never a silent clamp, so a caller cannot mistake a
refusal for a successful write. The operator sees the message where the action was
taken: the welcome screen for an open, the editor's error line for a save.

## The MCP door

The app exposes its vault tools to Hermes and to other agents through two loopback
HTTP doors that speak the Model Context Protocol on `POST /mcp`. They are described
from the operator's side in [Personnel and agents](./25-personnel-and-agents.md);
this is what they enforce.

| | Local door | Invite door |
|---|---|---|
| Address | `http://127.0.0.1:8643/mcp` | `http://127.0.0.1:8646/mcp` |
| Binds | `127.0.0.1` only; an off-loopback bind is refused | `127.0.0.1` only |
| To reach tools | Bearer plus a name, which files a pairing Decision | Bearer plus a one-time invite code, then a Decision |
| Other methods/paths | `404` | `404` |

Before authentication the door checks the `Host` header (a `127.0.0.1` or
`localhost` name for its own port; anything else is a DNS-rebinding shape and gets
`403`). A present `Origin` must be that same loopback door; an absent one is
allowed, because CLI clients do not send it. Auth runs before an MCP transport is
constructed: an unauthenticated request is answered from headers, with the body
never read.

- A bearer must be at least 22 characters and is compared in constant time.
- A bearer the machine-local secrets store does not resolve is a *pairing
  attempt*: it files one pending pairing Decision, and the caller appears in
  Personnel only once that is approved. Pending pairings are capped
  (`PENDING_PAIRING_CAP = 20`), so a flood files no roster rows.
- The companion's own bearer is a different, 256-bit credential, minted per vault.
  The companion never pairs: it is authorised directly on either door.
- A pending, rejected or revoked agent reaches zero tools. An approved agent's
  grant is resolved per call — read or write, which domains, schedule access — and
  archive/revocation closes it immediately. Every tool call is checked against the
  grant before it runs.
- Every unknown tool is default-denied; a read grant cannot write; an agent never
  controls the actor recorded on a write, and cannot approve Decisions or edit its
  own grant.

The doors also bound their own resources: a 1 MiB streamed body cap (`413`), at
most 32 JSON-RPC batch items, a 10 s body-read timeout, 30 s request timeout, 15 s
headers timeout, 64 connections, 1,000 requests per socket, and per-door rate
windows for failed auth (30 per 10 s) and introductions (40 per 10 s).

Opening a vault binds the doors to that vault; opening a second vault rebinds them
rather than serving the first. If the local door cannot bind — another process owns
port 8643 — the credential is *not* written into the Hermes profile, and the app
clears a stale entry instead of handing the token to whoever owns the port. Settings
→ Hermes shows each door's url or its bind error.

## The update trust chain

The one executable this app runs on your behalf is a downloaded installer, so the
chain from "the feed said so" to "the installer started" is short and checked at
every step.

1. **The feed.** `update:check` reads
   `https://api.github.com/repos/karmsheel/life-quest/releases/latest` once per
   launch. An unreachable feed, or a `404`, reports that it could not check — never
   "up to date". An unreadable tag (`nightly`, `release-2`) fails closed: no offer
   and no download.
2. **The version.** Versions are compared numerically, so `0.10.0` is newer than
   `0.9.0`, and a prerelease ranks below the release it precedes. Only a strictly
   newer version is offered; an older or equal one is not a downgrade prompt.
3. **The asset.** The installer must be named for the Windows setup (`setup*.exe`),
   be `https`, be on `github.com` (or a `githubusercontent.com` file under the host
   policy), and be an asset of *this* repository's release:
   `https://github.com/karmsheel/life-quest/releases/download/…`. The last check is
   the one that matters: `githubusercontent.com` accepts files from any GitHub
   account, so a host allowlist alone would let a compromised renderer hand the OS
   an attacker's bytes.
4. **The request.** The renderer cannot name a URL. `update:install` is accepted
   only for the exact name, url and declared size that main itself last offered.
   A size-less asset is refused, because it cannot be verified.
5. **The download.** The file lands in `%TEMP%\LifeQuest-update\<basename>`, with
   the name reduced to a basename first so a release cannot choose the path. The
   host is checked **again after redirects**, against the URL the bytes really came
   from. The byte count must equal the declared size; a truncated download is
   deleted and the failure reported. A half-written `.exe` is never launched, and a
   second install request joins the flight already in progress.
6. **The human.** Main shows a native dialog — **Install update** / **Cancel**,
   with Cancel as the default — naming the file and saying the app will close. Even
   a compromised renderer cannot skip this; the confirmation is in main.
7. **The hand-over.** Only then is the installer handed to Windows and the app
   quit, a second later, so the installer can replace locked files. If the launch
   fails, the app keeps running.

The release build prints each asset's SHA-256 and writes
`release/release-manifest.json` so an upload can be checked against it. The app
does not yet verify a signature or that hash before launching; the installer is
unsigned today, and the security sweep lists code-signing as the missing anchor.

## The window and the renderer

One privileged `BrowserWindow`, and everything that keeps it the app's own
document:

- `contextIsolation: true`, `nodeIntegration: false`. The preload exposes a
  curated `window.lifequest` object — no raw `ipcRenderer`, no `fs`, no `child_process`.
- Navigation guards on every window main creates: `will-navigate` allows only the
  app document (the Vite origin in dev, exactly `dist/index.html` in a packaged
  build); `will-frame-navigate` and `will-redirect` deny anything else;
  `window.open`/`target=_blank` never creates a child window. An https link the
  operator clicks is handed to the system browser instead; an http link is refused.
- Every IPC handler goes through one facade that checks the sender. In a packaged
  build only the product window loading the app document may call; in dev the Vite
  origin may, which is what keeps the e2e rigs on the real bridge.
- Permissions are denied by default. The single exception is sanitized clipboard
  *write*, because the Copy buttons use it; nothing can read the clipboard, camera,
  microphone, geolocation or notifications.
- The CSP is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; media-src 'none';`.
- Markdown is rendered by escaping text first and generating only a fixed set of
  elements. Raw HTML never survives; `javascript:`, `data:`, `vbscript:` and
  `file:` links never become hrefs; external links carry `target="_blank"` and
  `rel="noopener noreferrer"`.
- DevTools and F12 are development-only; a packaged build has no DevTools, because
  it would be the whole preload bridge in a REPL.

## Images: receipts, vault media, remote images

- **Vault media** is the only image a document can show. `![](media/<name>.png)` is
  turned into an element with a `data-media` attribute, and the renderer asks the
  vault for those bytes over the bridge, then paints them from a `blob:` url. A
  source that is not `media/<file>` renders nothing, so a document cannot make the
  window load a remote image.
- **Remote images are not fetched at all.** The renderer never requests an image
  url from the network, and the CSP allows images only from the app itself, `data:`
  and `blob:`.
- **Receipts** are attacker-supplied bytes. Before `nativeImage` ever sees the
  buffer, `apps/desktop/electron/image-headers.ts` sniffs the format from the magic
  bytes (JPEG or PNG only, `Receipts must be JPEG or PNG images.`) and reads the
  declared canvas from the header. A declared size over 12,000 px on a side or
  40,000,000 pixels is refused before decoding, and the original is capped at
  25 MB (`That receipt is larger than 25 MB.`). The copy handed to the model is
  re-encoded down a ladder to at most 2 MB; the vault keeps the original. The
  stored file name goes through `path.basename`, and the file store write is inside
  the domain's contained `data/files/` directory.

## Egress controls

Stored content can ask the network out in exactly two places: a page script block's
`fetches` (run by the operator from the page's own **Run** button) and the finance
FX refresh (whose URL comes from the vault's `registry.json`). Both go through
`packages/vault-core/src/egress.ts`, which enforces:

- `https` only, no credentials in the url, no private hostname suffixes;
- the host is resolved and **every** answer must be public — loopback, RFC1918,
  link-local, CGNAT, multicast, unspecified, ULA, IPv4-mapped, 6to4, NAT64 and the
  cloud metadata range are all refused;
- redirects are followed manually (at most 3) and the whole check re-runs on each
  hop, so an https url cannot bounce to `http://127.0.0.1`;
- a 5 s wall-clock budget for the whole chain and a 64 KiB streamed body cap.

A connected agent cannot fetch at all: `run_script_block` refuses fetches from an
agent caller and keeps only read-only queries, and a script an agent writes with
`apply_script_block` only fetches when the operator runs it from the page. The URL
is the operator's.

## What the app refuses to do

- **No hosted copy of the vault, and no account.** Opening a vault is identity. No
  LifeQuest-hosted replica, no multi-user tenancy, no cloud sync of your files.
- **No silent restore.** Restoring a domain's database from `books.json` is
  Settings → Vault → **Books**: you tick *Restore replaces the live SQLite book for
  this domain from books.json* and press the destructive **Restore books**. Without
  the confirmation the call is refused (`Restore requires confirmation`). The
  restore validates every row before writing anything, and copies the current
  `domain.sqlite` to `domain.sqlite.bak` first; a failed backup aborts the restore.
  There is no git hook that restores by itself.
- **No silent replacement of the app binary.** Updates are offered, never applied
  in the background: you press **Download and install**, confirm in a native dialog
  whose default is **Cancel**, and only then does the app hand over and quit.
- **No key to the renderer.** The UI can learn whether a key is stored, not what
  it is.
- **No silent plaintext key store.** On a Linux machine with no keyring the app
  warns rather than pretending the file is encrypted.
- **No killing a gateway it did not start.** The app attaches to a running Hermes
  host; it shuts down only what it started.
- **No agent write to a locked document or board without a Decision.** Agents
  cannot lock or unlock, cannot approve a Decision, and cannot change their own
  grant.
- **No navigation and no remote code in the privileged window.** A page cannot
  leave the app document, cannot open a child window, and cannot register a
  permission.
- **No installer from a url the renderer chose.** The renderer can only agree to
  the asset main already picked.

## Limits you should know

The same code has limits, and hiding them would be worse than stating them:

- The installer is **unsigned**, so Windows SmartScreen may warn on first launch
  and a compromised release pipeline is not detectable by the app.
- The vault is **not encrypted at rest**. Anyone with your OS account can read it.
- There is no **single-instance lock**: two copies of the app can race the same
  profile and the MCP ports.
- The companion bearer is minted per vault and stable; there is no rotate/revoke
  control for it in the UI yet.
- The egress check resolves DNS twice (once itself, once inside `fetch`), so a name
  whose answer changes between the two lookups can still rebind. Redirects and
  address checks stop the ordinary forms.
- `vault:open` and `vault:create` accept the absolute path the renderer supplies
  rather than a one-shot capability minted by the folder picker.

## Related

- [The vault](./04-the-vault.md)
- [Decisions](./23-decisions.md)
- [Companion](./24-companion.md)
- [Personnel and agents](./25-personnel-and-agents.md)
- [Updates](./27-updates.md)
- [Settings](./28-settings.md)
- [System architecture](./30-system-architecture.md)
