# Auto-update — Design Spec

**Date:** 2026-10-12  
**Status:** Approved — implemented  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Windows packaging](./2026-08-28-windows-portable-packaging-design.md), [Glass chrome](./2026-09-12-glass-chrome-design.md), [Shell sidebar](../e2e/shell-sidebar.tsx)

The studio ships as a Windows installer and a portable zip. Nothing told the operator when a newer one existed. This spec makes the build number at the foot of the rail say so, by glowing, and makes clicking it offer the upgrade.

---

## 1. Purpose

A release is cut with `npm run release` and attached with `gh release create`. From that moment the newer build exists and nobody knows. The operator should learn it without leaving the app, without a poller, and without the studio ever installing something they did not ask for.

### Success criteria

- With a newer release published, `v<version>` in the rail wears a halo, becomes a button, and opens a popup naming both versions, the release notes, and the installer.
- With no newer release, the rail is exactly what it was: one line of muted text, not a control, no glow.
- The popup can download the installer, verify it, hand it to Windows, and step aside so it can replace the app.
- The app asks the feed **once per launch**. `npm test` covers every refusal path.
- `npm run typecheck` introduces no new errors.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Feed | **GitHub Releases API** for `karmsheel/life-quest`, `releases/latest`. |
| 2 | Auth | The repository is public, so the check reads its releases **unauthenticated**. A fine-grained token with read access can be stored — encrypted with `safeStorage`, one per installation, not per vault — for the case where the repository goes private. Either way, a check that fails is reported as "could not check", never as "up to date". |
| 3 | Cadence | **Once, at launch.** The renderer's `UpdateProvider` asks on mount and main keeps that answer for the session. Settings → *Check now* is the operator asking by hand, and is the only caller that forces a re-read. |
| 4 | Glow | `--accent` hairline + `--accent-fill` bloom on the chip's **own `::after` layer**, whose `opacity` breathes over 4s. Not a shadow on the chip: the breath then never repaints a blur, and the shadow stays readable at the value it was written as. |
| 5 | Popup | An in-window modal, portalled to `body` so the rail's scroll box cannot clip it. Names current → latest, the release notes behind a disclosure, the installer's name and size. Not dismissible mid-download. |
| 6 | Install | Download the release's `-setup.exe` to `%TEMP%\LifeQuest-update\`, check its size against the feed's, `shell.openPath` it, and quit **after** the launch is confirmed. |
| 7 | Trust | An installer is downloaded only from `https://github.com` / `*.githubusercontent.com`, checked at selection **and** on the resolved url after redirects. The release *page* is a separate, fixed GitHub check — a link is not an executable. |
| 8 | Version source | `package.json`, baked where each half is bundled. `app.getVersion()` answers with Electron's own version whenever the entry point is a script rather than an app folder. |
| 9 | Failure | Every path fails closed and reports: an unparseable tag, a 404, an untrusted url, a short body. The app never quits on a failed launch, so a failed upgrade never leaves the operator with no app. |
| 10 | Out of scope | Silent/background install, delta updates, code signing, mac/linux targets, an in-app release-notes reader. |

---

## 3. Version rules

`v` prefix optional; 1–3 numeric components; prerelease suffix compared per semver.

| Current | Tag | Answer |
|---------|-----|--------|
| `0.1.0` | `v0.9.0` | available |
| `0.1.0` | `v0.1.0` | current |
| `0.1.0` | `v0.0.9` | current — a downgrade is not an upgrade |
| `0.1.0` | `v0.10.0` | available — compared as numbers, not as text |
| `0.1.0` | `v0.1.0-beta.1` | current |
| `0.1.0` | `nightly` | error — an unreadable tag fails closed |

---

## 4. Files

| File | Role |
|------|------|
| `electron/updater.ts` | The feed, the version rules, the asset choice, the download, the hand-over. |
| `electron/secrets.ts` | The token, encrypted like the Hermes key. |
| `electron/main.ts` | The `update:*` channels; the E2E seam's feed, launcher and trust-policy overrides. |
| `electron/preload.ts` | The bridge. The token is never read back into the renderer. |
| `src/state/UpdateProvider.tsx` | The app's view of the feed: one launch check, and the install. |
| `src/components/shell/UpdateBadge.tsx` | The build number: quiet text, or the glow. |
| `src/components/shell/UpdateDialog.tsx` | The popup. |
| `src/components/settings/SettingsUpdates.tsx` | The token, and *Check now*. |
| `src/styles/global.css` | The halo, and the popup's chrome. |

---

## 5. Acceptance

`npm test`, four rigs and two harnesses:

| Rig | Proves |
|-----|--------|
| `e2e/shell-sidebar.electron.mjs` | The glow did not disturb the rail's own geometry. |
| `e2e/update-badge.electron.mjs` (rail) | The glow's own numbers: two layers, the accent's inks, a bloom that fits the 14px the rail gives it, on a layer whose opacity animates. Clicking opens the popup; the popup names both versions, the file and the notes; the install reports progress and cannot be dismissed mid-flight; a failed install is reported and escapable; an up-to-date build has no control and no glow. |
| `e2e/update-badge.electron.mjs` (settings) | The token's round trip — not-set → stored → not-set — the field cleared after a save, and *Check now* forcing the feed. |
| `e2e/update-install.electron.mjs` | The REAL main process and preload against a feed the rig owns: the version table, the session's one answer, a 404, an untrusted url, a refused redirect, a short body, a real download landing byte-for-byte, two requests sharing one flight, the progress the renderer really receives, and the launcher being handed exactly that file before the app quits itself. |

Artifacts: `e2e/artifacts/update-{badge,install}.json` and five PNGs.

The one thing no rig covers: Windows' own hit test for the click, and whether the real NSIS installer runs to completion. Both are outside a hidden window's reach.

---

## 6. What is not here

The release flow itself is unchanged: `npm run release` writes the two assets, `gh release create` uploads them. There is deliberately no publish step in the build, so nothing half-publishes on its own.
