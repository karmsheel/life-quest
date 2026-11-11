# Security

LifeQuest is local-first, so its security model is not "trust the server". There is
no server. The model is one operator, one machine, one vault folder, and a small
set of doors the app opens on purpose: OS secure storage for the companion
credentials, two loopback MCP doors for agents, the GitHub release feed for
updates, and the one privileged Electron window. This page says where secrets
live, which boundaries the code enforces, and what the app refuses to do. Read
alongside [Wiki home](./index.md).

## Where it lives

There is no Security tab. The controls are spread across the surfaces that own the
boundary, and the enforcement is in the main process.

| What you control | Where you see it | Enforced in |
|---|---|---|
| The built-in companion's endpoint and key | The companion setup screen, and Settings → Hermes → **Companion** | `apps/desktop/electron/harness/pi-settings.ts` |
| The Hermes API key | The companion setup screen when it is rejected, and the Hermes profile | `apps/desktop/electron/secrets.ts` |
| Which companion runs | The setup screen's picker and Settings → Hermes → **Companion** | `apps/desktop/electron/harness/registry.ts` |
| MCP doors and their bind errors | Settings → Hermes → **MCP doors** (`Local`, `Invite`) | `apps/desktop/electron/mcp-server.ts`, `pairing-door.ts` |
| Agent pairing and grants | Agents, and the pairing Decision in Decisions | `apps/desktop/electron/pairing-secrets.ts`, `packages/vault-core/src/pairing-grant.ts` |
| Update download and install | The dock's build number and the in-app notice, Settings → Updates | `apps/desktop/electron/updater.ts`, `main.ts` |
| Database restore | Settings → Vault → **Books** | `packages/vault-core/src/books-export.ts` |
| Vault path containment | Any vault read or write | `packages/vault-core/src/paths.ts` |

The product invariant is one line: [LAWS/SECRETS.md](../../LAWS/SECRETS.md) —
API keys MUST NOT be stored in the vault.

## How to act on it

There is nothing to configure to "turn security on": the boundaries are always on.
What you do as the operator:

1. **Treat the vault as yours to protect.** It is plaintext on disk, so the OS
   account and your own backups are the confidentiality boundary.
2. **Point the companion at an endpoint you chose.** Its key is sealed by the OS
   and never enters the vault; with no keyring it lasts the session only.
3. **Read the doors.** Settings → Hermes → **MCP doors** says whether agents can
   reach the vault; Agents is where you approve or reject a pairing.
4. **Install updates and restores deliberately.** The native dialog names the
   installer before anything runs; **Books** needs **Allow restore** armed.

## Where secrets live

| File | Holds | Protection |
|---|---|---|
| `secrets.json` in the app's `userData` | The Hermes API key per vault, and adapter secrets | Encrypted with Electron `safeStorage`, stored base64; file `0600` in a `0700` directory |
| `pi-endpoint.json` and `pi-endpoint.key` in `userData` | The built-in companion's endpoint URL, model and provider name (no secret), and its API key | Endpoint is plain JSON; the key is sealed with `safeStorage`, or held in memory for the session on a machine with no OS keyring |
| `pairing-secrets/connected-agent-secrets.json` in `userData` | The companion bearer (256-bit), a SHA-256 hex of each connected agent's bearer (never the raw bearer), invite-code hashes with expiry and used-at stamps | `0600` in `0700`; repaired on read if an older build left looser modes |
| The Hermes profile's `config.yaml` | The companion's `Authorization` header for the `lifequest` MCP entry | Written `0600` by the app when a door binds |
| The Hermes profile's `.env` | The host's `API_SERVER_KEY` | Written `0600` by the app |
| `%TEMP%\LifeQuest-update` | The downloaded installer, until it is launched or discarded | Temporary; a failed or truncated download is deleted |

`pi-sessions/` in `userData` holds the built-in companion's transcripts — see
below. None of these files is in the vault. A vault can be copied, synced, put in
git, or handed to another machine; a copy must never carry a credential, which is
why the pairing secrets, the Pi endpoint and the Pi transcripts live in `userData`
beside `secrets.json` rather than under `domains/<slug>/data/`.

**Where the vault is not.** The vault itself is plaintext by design — files the
operator can read, diff, sync and back up. Its confidentiality is the OS account's.
[VISION.md](../../VISION.md) calls whole-vault encryption welcome; it is not
implemented today, and this page does not pretend it is.

### The renderer never holds the raw key

The preload bridge exposes `secrets:hasHermesKey` (a boolean) and
`secrets:setHermesKey` (a write). There is no channel that returns a stored key to
the renderer. The Pi form is the same shape: the key field lives in the renderer
only long enough to be sent to main once; the form reads back whether a key is
stored, never the key itself. Chat turns, the model probe, the endpoint probe and
the Agents scan all run in the main process, which reads the key, builds the
request, and returns only the result. A renderer compromise therefore does not hand
over a key.

The built-in companion is not a second privilege boundary to cross: Pi runs *in*
the Electron main process and reaches the vault only through the MCP door with the
vault's companion token. It gets no shell, read or write tool of its own, and
`pi-coding-agent` — whose default loadout is exactly those tools pointed at a
working directory — is deliberately not a dependency.

`safeStorage` is used with no plaintext fallback *in the code*. On Linux without a
keyring Electron resolves it to the `basic_text` backend, where the bytes are
plain base64; the app detects that once per process and warns:

```
[secrets] OS keyring is unavailable; Electron safeStorage is using the plaintext
basic_text backend. Secrets in secrets.json are protected by file permissions only.
```

For Pi the same condition is handled without a warning: when encryption is not
available the key is kept in memory for the session, and the setup form says
"This machine has no OS keyring, so the key is kept for this session only." On
Windows the per-user ACL on `%APPDATA%\LifeQuest` is the protection around the
`0600` file mode.

### Pi transcripts

The built-in companion owns its own sessions. One JSON file per chat lives in
`%APPDATA%\LifeQuest\pi-sessions\<id>.json`, written atomically, and an id that is
not a plain `[A-Za-z0-9_-]` segment is refused as a file name rather than sanitised
silently. Transcripts never enter the vault: VISION keeps transcripts with the
companion. Hermes transcripts stay with Hermes, in whatever store its profile
uses.

## The vault boundary

Every path that names something inside the vault goes through
`packages/vault-core/src/paths.ts`, which enforces two things.

**Segment grammar.** Every id or name that becomes one path segment — page id,
database id, project id, document id, view id, cadence, period, date, area slug,
media name, image id, attachment name — goes through `assertSafeSegment`. It
refuses both separators, the Windows drive/stream colon, NUL and control
characters, reserved characters, `.` and `..` (including an embedded `..`),
leading spaces, trailing dots or spaces, and anything over 128 characters. A
segment is untrusted content (an agent argument, a JSON field) turned into a
filename.

**Physical containment.** Lexical `..` checks cannot see a symlink, so
`assertPhysicalContainment` resolves the real vault root once per process and
walks every component below it with `lstat`. A component that is a symlink is
refused with `VaultSymlinkError`, whatever it points at — an in-vault link still
lets one area read another's directory. Reads and writes both go through it, and
the synchronous path builders destructive operations use do the same walk so a
recursive delete cannot follow a symlinked `domains/`.

Two deliberate allowances: the **vault root itself may be a symlink**
(`~/vault -> /data/vault`) — what is refused is anything *inside* it being one —
and **a missing component ends the walk**, because it and everything under it does
not exist yet, so a write creates real directories under verified-real parents.

A refused path is an error, never a silent clamp, so a caller cannot mistake a
refusal for a successful write. The operator sees the message where the action was
taken: the welcome screen for an open, the editor's error line for a save.

### Files the vault stores besides documents

| Store | Path | Rules |
|---|---|---|
| General chat attachments | `attachments/files/<uuid>/<name>` | 25 MB; one safe segment; active content (HTML, XHTML, SVG, JS, shell scripts, executables, portables) refused; containment and symlink checks |
| Images library | `images/files/<uuid>.<ext>`, indexed by `images/library.json` | PNG, JPEG, GIF or WebP sniffed from the bytes; 8 MB; the display name is a label, never a path |
| Vision board | `images/board.json` | Typed blocks; 1,000 blocks, 2 MB document cap |
| Quick Notes attachments | `.lifequest/signal-chain/files/<uuid>.<ext>` | One image per capture, same sniff-and-bound rules |
| Finance receipts | the finance area's `data/files/<uuid>/<name>` | Format sniff, 25 MB original, dimension cap, re-encoded model copy |

The attachment store is deliberately vault-level, not an area's: a voice memo
dropped in a chat belongs to no area, and filing it under one would invent a lens
the operator never chose. It is still inside the vault, behind the same guard.

## The MCP door

The app exposes its vault tools to the companion and to connected agents through
two loopback HTTP doors that speak MCP on `POST /mcp` — described from the
operator's side in [Agents](./25-agents.md). This is what they enforce.

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

- A bearer is at least 22 characters and compared in constant time.
- An unknown bearer is a *pairing attempt*: it files one pending pairing Decision,
  and the caller appears in Agents only once approved. Pending pairings are capped
  (`PENDING_PAIRING_CAP = 20`), so a flood files no roster rows.
- The companion's own bearer is a different, 256-bit credential minted per vault.
  Both companions use it — Hermes via the profile's `Authorization` header, Pi via
  the same door from inside main. Neither pairs.
- A pending, rejected or revoked agent reaches zero tools. An approved agent's
  grant is resolved per call (read or write, areas, schedule) and revocation closes
  it immediately; every tool call is checked against the grant first.
- Every unknown tool is default-denied; a read grant cannot write; an agent never
  controls the recorded actor and cannot approve Decisions or edit its own grant.

The doors also bound their own resources: a 1 MiB streamed body cap (`413`), at
most 32 JSON-RPC batch items, a 10 s body-read timeout, 30 s request timeout, 15 s
headers timeout, 64 connections, 1,000 requests per socket, and per-door rate
windows for failed auth (30 per 10 s) and introductions (40 per 10 s).

Opening a vault binds the doors to it; opening a second rebinds them. If the local
door cannot bind — another process owns port 8643 — the credential is *not* written
into the Hermes profile, and the app clears a stale entry instead of handing the
token to whoever owns the port. Settings → Hermes shows each door's url or error.

## The update trust chain

The one executable this app runs on your behalf is a downloaded installer, so the
chain from "the feed said so" to "the installer started" is short and checked at
every step.

1. **The feed.** One anonymous read of
   `https://api.github.com/repos/karmsheel/life-quest/releases/latest` at launch,
   and again hourly. An unreachable feed, or a `404`, reports that it could not
   check — never "up to date". An unreadable tag (`nightly`) fails closed.
2. **The version.** Compared numerically (`0.10.0` beats `0.9.0`), with a
   prerelease below the release it precedes. Only a strictly newer version is
   offered; an older or equal one is not a downgrade prompt.
3. **The asset.** It must be named for the Windows setup (`setup*.exe`), be
   `https`, be on `github.com` (or `githubusercontent.com` under the host policy),
   and be an asset of *this* release:
   `https://github.com/karmsheel/life-quest/releases/download/…`. The last check
   matters: `githubusercontent.com` accepts files from any GitHub account, so a
   host allowlist alone would let a compromised renderer hand the OS an attacker's
   bytes.
4. **The request.** The renderer cannot name a URL. `update:install` is accepted
   only for the exact name, url and size main last offered; a size-less asset is
   refused, because it cannot be verified.
5. **The download.** The file lands in `%TEMP%\LifeQuest-update\<basename>` — the
   name reduced to a basename so a release cannot choose the path. The host is
   checked **again after redirects**, against the URL the bytes really came from.
   The byte count must equal the declared size; a truncated download is deleted,
   and a half-written `.exe` is never launched.
6. **The human.** Main shows a native dialog — **Install update** / **Cancel**,
   Cancel by default — naming the file and saying the app will close. A
   compromised renderer cannot skip this; the confirmation is in main.
7. **The hand-over.** Only then is the installer handed to Windows and the app
   quit, a second later, so it can replace locked files. If the launch fails, the
   app keeps running.

A watch read that cannot answer is silent and restores the previous answer, so a
release the operator can still install is not made stale by a failed check. The
release build prints each asset's SHA-256 and writes
`release/release-manifest.json`, so an upload can be checked against it. The app
does not yet verify a signature or that hash before launching; the installer is
unsigned today, and the security sweep lists code-signing as the missing anchor.

## The window and the renderer

One privileged `BrowserWindow`, and everything that keeps it the app's own
document:

- `contextIsolation: true`, `nodeIntegration: false`, and a curated
  `window.lifequest` bridge — no raw `ipcRenderer`, no `fs`, no `child_process`.
- Navigation guards on every window main creates: `will-navigate` allows only the
  app document (the Vite origin in dev, exactly `dist/index.html` packaged);
  `will-frame-navigate` and `will-redirect` deny anything else; `window.open`/
  `target=_blank` never creates a child window. An https link the operator clicks
  goes to the system browser; an http link is refused.
- Every IPC handler goes through one facade that checks the sender: packaged, only
  the product window loading the app document; in dev, the Vite origin, which keeps
  the e2e rigs on the real bridge.
- Permissions are denied by default; the single exception is sanitized clipboard
  *write*, because the Copy buttons use it. Nothing can read the clipboard, camera,
  microphone, geolocation or notifications.
- The CSP is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; media-src 'none';`.
- Markdown escapes text first and generates only fixed elements: raw HTML never
  survives, `javascript:`/`data:`/`vbscript:`/`file:` never become hrefs, and
  external links carry `target="_blank" rel="noopener noreferrer"`.
- DevTools and F12 are development-only; a packaged build has none, because it
  would be the whole preload bridge in a REPL.

## Images and remote content

- **Vault media** is the only image a document can show. `![](media/<name>.png)`
  becomes an element with a `data-media` attribute; the renderer fetches those
  bytes over the bridge and paints them from a `blob:` url. A source that is not
  `media/<file>` renders nothing, so a document cannot load a remote image.
- **Remote images are not fetched at all.** The renderer never requests an image
  url from the network; the CSP allows images only from the app, `data:` and `blob:`.
- **Receipts** are attacker-supplied bytes. Before `nativeImage` sees the buffer,
  `apps/desktop/electron/image-headers.ts` sniffs the format from the magic bytes
  (JPEG or PNG only) and reads the declared canvas from the header: over 12,000 px
  on a side or 40,000,000 pixels is refused before decoding, and the original is
  capped at 25 MB. The model's copy is re-encoded down a ladder to at most 2 MB;
  the vault keeps the original, named through `path.basename`, inside the area's
  contained `data/files/` directory.

## Egress controls

Stored content can ask the network out in exactly two places: a page script block's
`fetches` (run by the operator from the page's own **Run** button) and the finance
FX refresh (whose URL comes from the vault's `registry.json`). Both go through
`packages/vault-core/src/egress.ts`, which enforces:

- `https` only, no credentials in the url, no private hostname suffixes;
- the host is resolved and **every** answer must be public — loopback, RFC1918,
  link-local, CGNAT, multicast, unspecified, ULA, IPv4-mapped, 6to4, NAT64 and the
  cloud metadata range are refused;
- redirects are followed manually (at most 3) and re-checked on each hop, so an
  https url cannot bounce to `http://127.0.0.1`;
- a 5 s budget for the whole chain and a 64 KiB streamed body cap.

A connected agent cannot fetch at all: `run_script_block` refuses fetches from an
agent caller, and a script an agent writes with `apply_script_block` only fetches
when the operator runs it from the page. The URL is the operator's.

## What the app refuses to do

- **No hosted copy of the vault, and no account.** Opening a vault is identity. No
  LifeQuest-hosted replica, no multi-user tenancy, no cloud sync of your files.
- **No key in the vault.** Both companion keys live in OS-sealed storage under
  `%APPDATA%\LifeQuest`; a key typed into a form goes to main, not the renderer.
- **No executable content in the vault through the chat.** An attachment of an
  active-content type (HTML, XHTML, SVG, JavaScript, shell scripts, executables,
  portables) is refused, not renamed or stripped.
- **No silent restore.** Restoring from `books.json` is Settings → Vault →
  **Books**: arm **Allow restore** for that area and press the destructive
  **Restore books**; the row disarms itself after a restore. The engine validates
  every row before writing and copies the current `domain.sqlite` to
  `domain.sqlite.bak` first; a failed backup aborts. No git hook restores.
- **No silent replacement of the app binary.** Updates are offered, never applied
  in the background: you press **Download and install**, confirm in a native dialog
  whose default is **Cancel**, and only then does the app hand over and quit.
- **No killing a gateway it did not start.** The app attaches to a Hermes host it
  did not launch; it shuts down only what it started.
- **No agent write to a locked document or board without a Decision.** Agents
  cannot lock/unlock, approve a Decision, or edit their own grant.
- **No navigation and no remote code in the privileged window.** A page cannot
  leave the app document, open a child window, or register a permission.
- **No installer from a url the renderer chose.** It can only agree to the asset
  main already picked.

## Limits you should know

The same code has limits, and hiding them would be worse than stating them:

- The installer is **unsigned**: SmartScreen may warn on first launch and a
  compromised release pipeline is not detectable by the app.
- The vault is **not encrypted at rest**. Anyone with your OS account can read it.
- There is no **single-instance lock**: two copies can race the profile and ports.
- The companion bearer is minted per vault and stable; there is no rotate/revoke
  control for it yet.
- On a machine with **no OS keyring**, a Pi API key lasts for the session only —
  the honest alternative to plaintext, but it must be re-entered after a restart.
- The egress check resolves DNS twice, so a rebinding name can still point at an
  address the check did not see. Redirects and address checks stop the ordinary
  forms.
- `vault:open` and `vault:create` accept the absolute path the renderer supplies
  rather than a one-shot capability minted by the folder picker.

## Related

- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Decisions](./23-decisions.md)
- [The Companion](./24-companion.md)
- [Agents](./25-agents.md)
- [Updates](./27-updates.md)
- [Settings](./28-settings.md)
- [System architecture](./30-system-architecture.md)
