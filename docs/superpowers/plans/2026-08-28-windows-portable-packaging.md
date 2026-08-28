# Windows Portable Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a private Windows x64 portable `LifeQuest.exe` via electron-builder so using the app is `npm run package` + double-click, while `npm run dev` stays the developer loop.

**Architecture:** electron-builder reads `apps/desktop/electron-builder.yml` and packs the already-bundled Vite renderer (`dist/`) plus esbuild main/preload (`dist-electron/`) into `apps/desktop/release/win-unpacked/`. No `node_modules` in the asar: every runtime library is bundled, so desktop `dependencies` move to `devDependencies`. Main calls `app.setName("LifeQuest")` so dev and the `.exe` share `%APPDATA%\LifeQuest`. `index.html` loads `theme-boot.js` with a relative path so it works under `file://`.

**Tech Stack:** Electron 35, electron-builder 26.15.x, existing Vite 6 + esbuild desktop build, Node `node:test` + `--experimental-strip-types`. No `electron-updater`, no NSIS, no code signing.

**Spec:** `docs/superpowers/specs/2026-08-28-windows-portable-packaging-design.md`

## Global Constraints

- `npm run dev` / `scripts/dev.mjs` stay the developer loop — do not replace them with Forge
- Root `npm run package` → desktop `build` then `electron-builder --win --dir`
- Artifact path is exactly `apps/desktop/release/win-unpacked/LifeQuest.exe`
- electron-builder output dir is `release`, never Vite `dist`
- Config file is `apps/desktop/electron-builder.yml` (not a `package.json` `"build"` key)
- `appId` `com.lifequest.desktop`; `productName` / executable name `LifeQuest`
- Windows x64 `dir` target only — no `nsis`, no mac, no linux
- `publish: null`; do not add `electron-updater`
- Signing off: `CSC_IDENTITY_AUTO_DISCOVERY=false` and `forceCodeSigning: false`
- asar on; pack `dist/**/*` and `dist-electron/**/*` only (plus the generated app `package.json`)
- No `node_modules` in the asar — move bundled desktop `dependencies` to `devDependencies`
- `app.setName("LifeQuest")` before any `userData` use; do not rename npm package `@lifequest/desktop`
- `index.html` must use `./theme-boot.js`, not `/theme-boot.js`
- `release/` is gitignored; do not commit artifacts
- Default Electron icon; no custom `.ico`
- Do not change vault layout, IPC, or product features
- Tests: `node --experimental-strip-types --test`

---

## File Structure

```
.gitignore                                          # add `release`
package.json                                        # scripts.package + run desktop tests
README.md                                           # package script + how to launch the .exe
apps/desktop/package.json                           # test + package scripts; electron-builder; deps → devDependencies
apps/desktop/electron-builder.yml                   # NEW
apps/desktop/scripts/package.mjs                    # NEW: env + spawn electron-builder --win --dir
apps/desktop/index.html                             # ./theme-boot.js
apps/desktop/electron/main.ts                       # app.setName("LifeQuest")
apps/desktop/tests/packaging-runtime.test.ts        # NEW
apps/desktop/tests/packaging-config.test.ts         # NEW
```

No changes to `scripts/dev.mjs`, `scripts/bundle-electron.mjs`, vault-core, renderer pages, or IPC.

---

### Task 1: Shared app name + relative theme-boot

**Files:**
- Create: `apps/desktop/tests/packaging-runtime.test.ts`
- Modify: `apps/desktop/index.html` (script src)
- Modify: `apps/desktop/electron/main.ts` (first statements after imports)
- Modify: `apps/desktop/package.json` (`scripts.test`)
- Modify: `package.json` (root `scripts.test` also runs desktop)

**Interfaces:**
- Consumes: existing `app` import in `electron/main.ts`; `public/theme-boot.js` (unchanged)
- Produces:
  - `app.setName("LifeQuest")` invoked synchronously at main-module load, before `app.whenReady()`
  - `index.html` script tag `src="./theme-boot.js"`
  - Desktop test script: `node --experimental-strip-types --test tests/**/*.test.ts`
  - Root `npm test` runs vault-core then `@lifequest/desktop`

- [ ] **Step 1: Write the failing runtime tests**

Create `apps/desktop/tests/packaging-runtime.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("packaged renderer boot", () => {
  it("loads theme-boot with a relative path", () => {
    const html = fs.readFileSync(
      path.join(desktopRoot, "index.html"),
      "utf8",
    );
    assert.match(html, /src="\.\/theme-boot\.js"/);
    assert.equal(html.includes('src="/theme-boot.js"'), false);
  });
});

describe("app identity", () => {
  it("sets the Electron name to LifeQuest before whenReady", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "electron", "main.ts"),
      "utf8",
    );
    const nameIdx = src.indexOf('app.setName("LifeQuest")');
    const readyIdx = src.indexOf("app.whenReady");
    assert.notEqual(nameIdx, -1);
    assert.notEqual(readyIdx, -1);
    assert.ok(nameIdx < readyIdx);
  });
});
```

- [ ] **Step 2: Add desktop + root test scripts and run to verify fail**

In `apps/desktop/package.json`, add a `test` script next to the existing ones (do not change `dev` / `build` / `typecheck`):

```json
"scripts": {
  "dev": "node ./scripts/dev.mjs",
  "build": "vite build && node ./scripts/bundle-electron.mjs",
  "package": "npm run build && node ./scripts/package.mjs",
  "test": "node --experimental-strip-types --test tests/**/*.test.ts",
  "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit"
}
```

**Do not add the `package` script in this task** — that line is shown only so the `scripts` object stays valid JSON in later tasks. In Task 1, the scripts object must be:

```json
"scripts": {
  "dev": "node ./scripts/dev.mjs",
  "build": "vite build && node ./scripts/bundle-electron.mjs",
  "test": "node --experimental-strip-types --test tests/**/*.test.ts",
  "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit"
}
```

In root `package.json`, change `test` to:

```json
"test": "npm run test -w @lifequest/vault-core && npm run test -w @lifequest/desktop"
```

Run:

```bash
node --experimental-strip-types --test apps/desktop/tests/packaging-runtime.test.ts
```

Expected: FAIL — `src="./theme-boot.js"` not found and/or `app.setName("LifeQuest")` not found.

- [ ] **Step 3: Relative theme-boot path**

In `apps/desktop/index.html`, change only the boot script src:

```html
<script src="./theme-boot.js"></script>
```

Full file after the change:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
    />
    <title>LifeQuest</title>
    <script src="./theme-boot.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Leave `src="/src/main.tsx"` as-is — Vite rewrites that module entry on build; it is not loaded as a raw `file://` path.

- [ ] **Step 4: `app.setName("LifeQuest")`**

In `apps/desktop/electron/main.ts`, call `setName` immediately after `__dirname` and **before** `isDev` / any IPC / `whenReady`. Do not move or rewrite other functions.

The top of the file becomes:

```ts
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as vault from "./vault-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.setName("LifeQuest");
const isDev = !app.isPackaged;
```

Everything from `function registerIpcHandlers()` onward stays unchanged.

- [ ] **Step 5: Re-run tests to verify they pass**

```bash
node --experimental-strip-types --test apps/desktop/tests/packaging-runtime.test.ts
```

Expected: PASS (2 tests).

Then:

```bash
npm test
```

Expected: vault-core tests pass, then the two desktop runtime tests pass.

Then:

```bash
npm run typecheck
```

Expected: PASS. `setName` is on Electron's `app` type already.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/tests/packaging-runtime.test.ts apps/desktop/index.html apps/desktop/electron/main.ts apps/desktop/package.json package.json
git commit -m "feat(desktop): share LifeQuest userData name and relative theme-boot"
```

---

### Task 2: electron-builder Windows unpacked folder

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/scripts/package.mjs`
- Create: `apps/desktop/tests/packaging-config.test.ts`
- Modify: `apps/desktop/package.json` (devDependency `electron-builder`, `scripts.package`, move `dependencies` into `devDependencies`)
- Modify: `package.json` (root `scripts.package`)
- Modify: `.gitignore` (add `release`)
- Modify: `README.md` (scripts table + packaged-app usage)

**Interfaces:**
- Consumes: Task 1 (`setName`, `./theme-boot.js`); existing `"build": "vite build && node ./scripts/bundle-electron.mjs"`
- Produces:
  - Root script `package` → `npm run package -w @lifequest/desktop`
  - Desktop script `package` → `npm run build && node ./scripts/package.mjs`
  - `package.mjs` sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and spawns `electron-builder --win --dir` with cwd `apps/desktop`
  - Artifact `apps/desktop/release/win-unpacked/LifeQuest.exe`

- [ ] **Step 1: Write the failing config tests**

Create `apps/desktop/tests/packaging-config.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(desktopRoot, "..", "..");

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("electron-builder.yml", () => {
  it("locks the private Windows dir target", () => {
    const yml = read("electron-builder.yml");
    assert.match(yml, /^appId:\s*com\.lifequest\.desktop\s*$/m);
    assert.match(yml, /^productName:\s*LifeQuest\s*$/m);
    assert.match(yml, /^executableName:\s*LifeQuest\s*$/m);
    assert.match(yml, /^ {2}output:\s*release\s*$/m);
    assert.match(yml, /^asar:\s*true\s*$/m);
    assert.match(yml, /^npmRebuild:\s*false\s*$/m);
    assert.match(yml, /^forceCodeSigning:\s*false\s*$/m);
    assert.match(yml, /^publish:\s*null\s*$/m);
    assert.match(yml, /^ {2}main:\s*dist-electron\/main\.js\s*$/m);
    assert.match(yml, /- dist\/\*\*\/\*/);
    assert.match(yml, /- dist-electron\/\*\*\/\*/);
    assert.match(yml, /target:\s*dir/);
    assert.match(yml, /- x64/);
    assert.equal(yml.includes("nsis"), false);
    assert.equal(yml.includes("electron-updater"), false);
  });
});

describe("package scripts and deps", () => {
  it("packages from a wrapper that disables cert discovery", () => {
    const wrapper = read("scripts/package.mjs");
    assert.match(wrapper, /CSC_IDENTITY_AUTO_DISCOVERY/);
    assert.match(wrapper, /--win/);
    assert.match(wrapper, /--dir/);
  });

  it("keeps bundled libraries out of production dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(pkg.scripts.package, "npm run build && node ./scripts/package.mjs");
    assert.equal(pkg.dependencies?.react, undefined);
    assert.equal(pkg.dependencies?.["@lifequest/vault-core"], undefined);
    assert.ok(pkg.devDependencies.react);
    assert.ok(pkg.devDependencies["react-dom"]);
    assert.ok(pkg.devDependencies["react-router-dom"]);
    assert.ok(pkg.devDependencies["lucide-react"]);
    assert.ok(pkg.devDependencies["@lifequest/vault-core"]);
    assert.ok(pkg.devDependencies["electron-builder"]);
  });

  it("exposes package at the repo root", () => {
    const root = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(root.scripts.package, "npm run package -w @lifequest/desktop");
  });
});

describe("gitignore", () => {
  it("ignores electron-builder output", () => {
    const gi = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    assert.match(gi, /^release$/m);
  });
});
```

- [ ] **Step 2: Run config tests to verify they fail**

```bash
node --experimental-strip-types --test apps/desktop/tests/packaging-config.test.ts
```

Expected: FAIL — `electron-builder.yml` ENOENT and/or missing `scripts/package.mjs`.

- [ ] **Step 3: electron-builder.yml**

Create `apps/desktop/electron-builder.yml` with this exact content:

```yaml
appId: com.lifequest.desktop
productName: LifeQuest
executableName: LifeQuest
directories:
  output: release
files:
  - dist/**/*
  - dist-electron/**/*
asar: true
npmRebuild: false
forceCodeSigning: false
extraMetadata:
  main: dist-electron/main.js
win:
  target:
    - target: dir
      arch:
        - x64
publish: null
```

No `icon` key. No `nsis` block. No `publish` provider other than `null`.

- [ ] **Step 4: `scripts/package.mjs`**

Create `apps/desktop/scripts/package.mjs`:

```js
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const builderPkgPath = require.resolve("electron-builder/package.json");
const builderPkg = require(builderPkgPath);
const binField = builderPkg.bin;
const binRel =
  typeof binField === "string" ? binField : binField["electron-builder"];
if (!binRel) {
  throw new Error("electron-builder package.json is missing bin");
}
const builderBin = path.join(path.dirname(builderPkgPath), binRel);

const child = spawn(process.execPath, [builderBin, "--win", "--dir"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
```

- [ ] **Step 5: Desktop package.json — scripts, electron-builder, move dependencies**

Replace the `scripts`, `dependencies`, and `devDependencies` blocks of `apps/desktop/package.json` so the file is:

```json
{
  "name": "@lifequest/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "node ./scripts/dev.mjs",
    "build": "vite build && node ./scripts/bundle-electron.mjs",
    "package": "npm run build && node ./scripts/package.mjs",
    "test": "node --experimental-strip-types --test tests/**/*.test.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit"
  },
  "devDependencies": {
    "@lifequest/vault-core": "*",
    "@types/node": "^20.19.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.5.0",
    "electron": "^35.0.0",
    "electron-builder": "^26.15.7",
    "esbuild": "^0.25.0",
    "lucide-react": "^0.511.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.6.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0"
  }
}
```

There must be **no** top-level `"dependencies"` key. Vite and esbuild still resolve these packages from `devDependencies` during `npm run build`. electron-builder 26 always copies production `node_modules`; an empty production graph is how this spec gets a node_modules-free asar.

- [ ] **Step 6: Root script, gitignore, README**

In root `package.json`, add `"package"` next to the existing scripts:

```json
"scripts": {
  "dev": "npm run dev -w @lifequest/desktop",
  "dev:desktop": "npm run dev -w @lifequest/desktop",
  "test": "npm run test -w @lifequest/vault-core && npm run test -w @lifequest/desktop",
  "build": "npm run build -w @lifequest/desktop",
  "package": "npm run package -w @lifequest/desktop",
  "typecheck": "npm run typecheck -w @lifequest/desktop"
}
```

Append to `.gitignore` (keep existing entries):

```
node_modules
.next
.env
prisma/*.db
*.db
.worktrees/
dist
dist-electron
release
```

In `README.md`, after the existing “Quick start” `npm run dev` block, add:

```markdown
### Use the packaged app (Windows)

```bash
npm run package
```

Then double-click `apps/desktop/release/win-unpacked/LifeQuest.exe`. No Node or `npm run dev` is required to *use* that build.

Windows SmartScreen may warn on first launch (unsigned private build). Choose **More info → Run anyway**. Quit LifeQuest before running `npm run package` again — an running `.exe` can lock files under `release/`. Deleting `win-unpacked` removes that build only; vault folders and `%APPDATA%\LifeQuest` stay.

`release/` is gitignored.
```

And extend the Scripts table:

```markdown
| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm run dev:desktop` | Electron + Vite desktop app (develop) |
| `npm run package` | Windows portable folder at `apps/desktop/release/win-unpacked/LifeQuest.exe` (use) |
| `npm test` | `@lifequest/vault-core` unit tests + desktop packaging tests |
| `npm run build` | Production Vite build + Electron main bundle (does not produce an `.exe`) |
| `npm run typecheck` | Typecheck desktop renderer + main |
```

- [ ] **Step 7: Install electron-builder**

From the repo root:

```bash
npm install
```

Expected: `electron-builder` appears under `apps/desktop` / root lockfile at `^26.15.7` (exact resolved version may be `26.15.7` or a later 26.15.x). `package-lock.json` changes are part of this task.

- [ ] **Step 8: Re-run config tests**

```bash
node --experimental-strip-types --test apps/desktop/tests/packaging-config.test.ts
```

Expected: PASS.

Then:

```bash
npm test
```

Expected: vault-core tests + packaging-runtime + packaging-config all PASS.

- [ ] **Step 9: Produce the `.exe`**

Quit any running LifeQuest / Electron window first.

```bash
npm run package
```

Expected:
- Vite build + `bundle-electron` succeed
- electron-builder runs with `--win --dir`
- It does **not** ask for GitHub tokens or a code-signing certificate
- Process exits 0
- File exists: `apps/desktop/release/win-unpacked/LifeQuest.exe`

On PowerShell, confirm:

```powershell
Test-Path apps/desktop/release/win-unpacked/LifeQuest.exe
```

Expected: `True`.

Confirm the asar does not ship `node_modules` (optional but matches the spec). After a successful pack, `win-unpacked/resources/app.asar` exists. Listing asar contents:

```powershell
npx --yes asar list apps/desktop/release/win-unpacked/resources/app.asar | Select-String node_modules
```

Expected: no `node_modules` paths (empty Select-String output). If `npx asar` is unavailable, skip this listing; the empty production `dependencies` plus `files` globs are the guarantee. Do **not** add `asar` as a repo dependency just for this check.

- [ ] **Step 10: Manual smoke of the `.exe` (not `npm run dev`)**

Launch `apps/desktop/release/win-unpacked/LifeQuest.exe`.

Pass:
- Window opens titled LifeQuest
- Theme is applied on first paint (boot script loaded; not stuck unthemed because `/theme-boot.js` 404'd)
- Welcome → open an existing vault **or** create one
- Open a domain document, change text, save, confirm the `.md` file on disk updated
- Settings → Hermes: if a key was stored while using `npm run dev` **after** Task 1’s `setName`, it is still present
- Quit and double-click the `.exe` again: recent vaults persist

If SmartScreen appears: **More info → Run anyway**. That is expected, not a failure.

Then confirm dev still works:

```bash
npm run dev
```

Expected: Vite + Electron start as before.

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

Do **not** `git add` `apps/desktop/release`, `dist`, or `dist-electron`.

```bash
git add apps/desktop/electron-builder.yml apps/desktop/scripts/package.mjs apps/desktop/tests/packaging-config.test.ts apps/desktop/package.json package.json package-lock.json .gitignore README.md
git commit -m "feat(desktop): package a Windows portable LifeQuest.exe"
```

---

## Self-review

**Spec coverage:**
- Dev vs package split, artifact path, electron-builder.yml, appId/productName, asar, publish null, no updater, no NSIS, Windows x64 dir, no signing, default icon, files whitelist, extraMetadata.main, setName, theme-boot, gitignore, README, tests — Task 1 + Task 2.
- `ignoredProductionDependencies` is electron-builder 27-only; Task 2 uses empty production `dependencies` on v26.15.x instead, which is the spec’s “no node_modules” outcome.

**Placeholder scan:** No TBD steps; yml, wrapper, tests, and package.json are inlined.

**Type consistency:** Script names `package` / `build` / `dev` / `test` match across root and desktop; `app.setName("LifeQuest")` string matches tests and spec.

---

## Execution notes

- Implement on the current branch unless the user asks for a feature branch.
- `npm run package` downloads Electron/winCodeSign binaries on first run; needs network.
- Do not add auto-update, NSIS, icons, or mac/linux targets “while you’re here.”
