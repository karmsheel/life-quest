# Windows Portable Packaging — Design Spec

**Date:** 2026-08-28  
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-08-28-windows-portable-packaging.md`)  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron) design](./2026-07-19-local-vault-electron-design.md)

Fulfills locked decision 13 from that spec: *Dogfood via dev first; electron-builder when features are usable.* Auto-update remains out of scope (decision 13’s companion exclusion).

---

## 1. Purpose

Split **using** LifeQuest from **developing** it.

Today the only launch path is `npm run dev` (Vite + unpackaged Electron). This spec adds a **Windows x64 portable folder**: a `LifeQuest.exe` produced by electron-builder that runs with no Node, no npm, and no Vite server.

The app stays private. There is no public release, no installer, and no auto-update.

### Success criteria

- `npm run dev` is unchanged: developer loop with Vite hot reload.
- `npm run package` (repo root) produces `apps/desktop/release/win-unpacked/LifeQuest.exe`.
- Double-clicking that `.exe` opens LifeQuest, loads the renderer from disk, and talks to vault IPC without a dev server.
- Vault files stay in the user-chosen folder; they are not copied into `release/`.
- Recent vaults and Hermes keys survive switching between `npm run dev` and the `.exe` (shared `userData` name **LifeQuest**).
- Existing tests and typecheck still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Tool | **electron-builder** (desktop workspace `devDependency`) |
| 2 | Artifact | Windows **unpacked directory** (`dir` target), arch **x64** |
| 3 | Launch (use) | Double-click `apps/desktop/release/win-unpacked/LifeQuest.exe` |
| 4 | Launch (dev) | `npm run dev` — unchanged |
| 5 | Script | Root `npm run package` → desktop `build` then `electron-builder --win --dir` |
| 6 | Output dir | `apps/desktop/release` — **not** Vite `dist` |
| 7 | App id | `com.lifequest.desktop` |
| 8 | Product name | `LifeQuest` |
| 9 | asar | **On** (electron-builder default) |
| 10 | Publish | **`null`** — no upload, no update feed |
| 11 | Auto-update | **Not included** |
| 12 | Signing | **Off** (`CSC_IDENTITY_AUTO_DISCOVERY=false`) |
| 13 | Platforms | **Windows x64 only** |
| 14 | Installer | **Not included** (NSIS is a later optional target in the same config) |
| 15 | Icon | Default Electron icon |
| 16 | Packaged files | `dist/**`, `dist-electron/**`, and the desktop `package.json` only — **no `node_modules`**. Renderer (Vite) and main (esbuild) are fully bundled. |
| 17 | Main entry in artifact | `dist-electron/main.js` via `extraMetadata.main` |
| 18 | Config file | `apps/desktop/electron-builder.yml` (not a `build` key on `package.json`) |
| 19 | App name / userData | `app.setName("LifeQuest")` early in main so dev and `.exe` share `%APPDATA%\LifeQuest` |
| 20 | Git | `release/` gitignored; artifacts not committed |

### Explicitly out of scope

- NSIS / Start Menu installer / uninstaller
- Auto-update (`electron-updater`, GitHub Releases, any publish provider)
- Code signing, SmartScreen reputation, notarization
- macOS and Linux targets
- Custom app icon
- Changing vault layout, IPC, or product features
- Store listing or public download page
- CI that uploads packaged builds

Follow-on (not this spec): add `nsis` beside `dir` when other users exist; add signing and auto-update only if distributing beyond this machine.

---

## 3. Architecture

```
npm run dev                         npm run package
     │                                    │
     ▼                                    ▼
esbuild main+preload              existing desktop `build`
Vite dev server                   (vite build + bundle-electron.mjs)
Electron unpackaged                      │
(load http://127.0.0.1:5173)             ▼
                                  electron-builder --win --dir
                                         │
                                         ▼
                                  release/win-unpacked/
                                    LifeQuest.exe
                                    (asar: dist + dist-electron)
                                         │
                                         ▼
                                  app.isPackaged === true
                                  loadFile(dist/index.html)
```

`vault-core` is already esbuild-bundled into `dist-electron/main.js`. The packaged tree does **not** include workspace `node_modules`.

Renderer Vite `base` is already `./`, which is required for `file://` loads inside asar.

### 3.1 Process model (unchanged)

Packaging does not add processes. Main, preload, renderer, and vault-on-disk stay as in the local-vault spec. The only new branch is *how* the renderer is loaded (`loadFile` vs Vite URL), which `app.isPackaged` already encodes in `electron/main.ts`.

### 3.2 Config location

electron-builder config lives at `apps/desktop/electron-builder.yml`. Root `package.json` only gains a `package` script that delegates with `npm run package -w @lifequest/desktop`.

---

## 4. Runtime details

### 4.1 Packaged load path

When `app.isPackaged` is true, main loads `path.join(__dirname, "../dist/index.html")` and preload from `path.join(__dirname, "preload.js")`. With asar layout:

```
app.asar/
  dist-electron/main.js
  dist-electron/preload.js
  dist/index.html
  dist/assets/…
  package.json
```

`__dirname` for main is `…/app.asar/dist-electron`, so `../dist/index.html` resolves inside the asar.

`npm run build` alone does **not** produce a double-clickable app. Only `npm run package` does. Running `electron .` against a Vite build is still unpackaged (`app.isPackaged === false`) and is not a supported “use” path.

### 4.2 `theme-boot.js`

`apps/desktop/index.html` currently has `src="/theme-boot.js"`. That works on the Vite origin; under `file://` it requests the drive root and the boot script never runs.

Change to `./theme-boot.js`. Vite still serves `public/theme-boot.js` in dev; the packaged `dist/` copy sits next to `index.html`.

### 4.3 App identity and userData

Recent vaults (`recent.json`) and Hermes keys (`secrets.json`) live under `app.getPath("userData")`, not in the vault.

Without a name override, unpackaged Electron uses the npm package name `@lifequest/desktop` and the packaged app uses product name `LifeQuest` — two folders, so recents and keys would not carry over.

Call `app.setName("LifeQuest")` at the top of main, **before** any `userData` read, so both modes use `%APPDATA%\LifeQuest`. Vault contents are already shared because they live in the folder the user picks.

Do **not** rename the npm workspace package `@lifequest/desktop`.

### 4.4 Data that is not in the artifact

- Vault directory (domains, markdown, `.lifequest/`)
- `%APPDATA%\LifeQuest\` (recents, secrets)
- Hermes gateway (still optional, still localhost-by-default)

Deleting `release/win-unpacked` removes that build only. It does not delete vaults or userData.

---

## 5. Error handling

- `npm run package` is fail-fast: Vite/esbuild failure skips electron-builder; electron-builder failure is a non-zero exit. No publish fallback.
- `publish: null` and `CSC_IDENTITY_AUTO_DISCOVERY=false` so a missing token or cert cannot stall or fail the build.
- If `LifeQuest.exe` is still running, overwriting `release/` can fail; the error is surfaced, not swallowed. Quit the app, then package again.
- **SmartScreen / “Windows protected your PC”** on first launch of an unsigned `.exe` is expected. *More info → Run anyway.* Not a product bug.
- No Start Menu entry and no uninstaller. Remove a build by deleting the `win-unpacked` folder (after quitting).
- If `userData` cannot be created, recents/secrets fail the same way as in dev; packaging does not add a new recovery path.

---

## 6. Testing

No new E2E framework.

| Check | Pass |
|-------|------|
| `npm run package` from repo root | Completes; `apps/desktop/release/win-unpacked/LifeQuest.exe` exists |
| Launch the `.exe` (not `npm run dev`) | Window opens; theme boot script loads (no unthemed flash from missing `theme-boot.js`) |
| Welcome → open or create vault | Snapshot loads; IPC works |
| Edit and save a domain document | File on disk updates |
| Settings → Hermes | Stored key visible if previously saved under LifeQuest userData |
| Quit and relaunch `.exe` | Recent vaults persist |
| `npm run dev` | Still starts Vite + Electron |
| `npm test` and `npm run typecheck` | Pass |

`release/` is gitignored. CI does not upload artifacts.

---

## 7. Implementation outline (not the plan)

Detailed steps belong in the implementation plan after this spec is user-reviewed.

1. electron-builder config + `package` scripts + `release` gitignore + README
2. `app.setName("LifeQuest")` before userData use
3. Relative `./theme-boot.js` in `index.html`
4. Run `npm run package` and smoke the `.exe`
5. Confirm `npm run dev`, `npm test`, and `npm run typecheck`

---

## 8. Spec self-review checklist

| Check | Result |
|-------|--------|
| Placeholders | None |
| Internal consistency | `dir` / no NSIS / no updater / shared userData name / no `node_modules` in asar all agree |
| Scope | One packaging pass; no product-feature changes |
| Ambiguity | Config file locked to `electron-builder.yml`; `package` vs `build` vs `dev` distinguished; artifact path is exact |
