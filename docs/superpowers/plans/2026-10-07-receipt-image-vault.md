# Receipt Images in the Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator hand one receipt photo to the companion chat, keep the original in the finance file store, and have the logged transaction point at it.

**Architecture:** The Electron main process sniffs the bytes, writes the original through `saveDatabaseFile`, and holds a downscaled copy in a single-slot pending store. The turn posts that copy to Hermes as an `image_url` part and names the vault path in the turn's instructions. `capture_transaction` gains an optional `source_file` that is accepted only when it names an existing file inside the finance store.

**Tech Stack:** TypeScript, vault-core, Electron `nativeImage`, Electron IPC, `node:test` as the rig wrapper.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-07-receipt-image-vault-design.md`. When this plan and the spec disagree on behavior, follow the spec.
- The repo's standing rule is E2E as the sole testing mechanism. Do not add a unit test, a `node:test` file that calls modules directly, or a harness page. `d4ecbeb` deleted vault-core's tests and its `npm test` script for this reason; do not bring either back.
- Add one rig, `apps/desktop/e2e/receipt-attach.electron.mjs`, as a rig of the existing chat-panel harness page. Wrap it with a new `describe` inside the page's existing wrapper, `apps/desktop/tests/chat-panel-e2e.test.ts`. That is the only test file this feature touches.
- The rig writes `e2e/artifacts/receipt-attach.json` and its screenshots. `apps/desktop/e2e/artifacts/` is gitignored, so never `git add` the artifact.
- The rig's doc comment names the seam it cannot cross: a dev-server page has no preload, so the panel's `receiptAttach` call ends at the page's stub. Follow the existing drivers' convention of stating what the rig does not cover.
- Focused loop: with `npm run dev` up, run `node e2e/receipt-attach.electron.mjs` from `apps/desktop`. Full proof: `npm test` from the repo root. That script ignores extra argv and always runs every rig, so do not pass a file path to it.
- The rig follows the existing drivers: its own `userData` directory under `e2e/artifacts/userdata/receipt-attach`, `nativeTheme.themeSource = "dark"`, `show: false`, a 90s timeout that exits 1, and `app.exit(report.pass ? 0 : 1)`.
- The rig drives main-process TypeScript, which Electron cannot import directly. Bundle the modules under test in-rig with esbuild, exactly the way `scripts/dev.mjs` bundles main: `bundle: true`, `platform: "node"`, `format: "esm"`, `target: "node20"`, `external: ["electron"]`, from a `stdin` entry of `export *` lines with `resolveDir` at the repo root, out to `e2e/artifacts/.receipt-attach.bundle.mjs`, then `import()` that file. `esbuild` is already a devDependency of `apps/desktop`. Vault-core's `node:sqlite` is a builtin and stays external, as it is for the app.
- Accepted formats are JPEG and PNG, decided by magic bytes and never by the extension or the declared mime. JPEG is `FF D8 FF`. PNG is `89 50 4E 47 0D 0A 1A 0A`.
- The stored original is capped at 25 MB and the stored layout is `saveDatabaseFile`'s own: `domains/financial/data/files/{fileId}/{basename(name)}`.
- The model copy is a `nativeImage` re-encode down the ladder `1600/q80`, `1600/q60`, `1200/q55`, taking the first attempt at or under 2 MB. All three over 2 MB is a refusal.
- The app never assembles a request body over 6 MB. The gateway caps a body at `MAX_REQUEST_BYTES` of 10 MB.
- No new dependency. The re-encode uses Electron's `nativeImage`, `resize`, and `toJPEG`.
- One receipt image per turn. The vault keeps the original bytes unchanged.
- Exact refusal messages: "Receipts must be JPEG or PNG images." / "That receipt is larger than 25 MB." / "Install the Finance kit first" / "This receipt could not be prepared for the agent" / "Attach that receipt again."
- Exact tool refusal: `{ "error": { "code": "MALFORMED", "message": "source_file must name a stored receipt" } }`.
- `source_file` is accepted only when it is relative, free of `..` and `\`, prefixed `domains/financial/data/files/`, and stats as a file inside the open vault. A refusal posts no row.
- `correctCapture` preserves the row's existing `source_file`. `undoCapture` removes the row and leaves the file.
- Do not edit `LAWS`, `README`, `PRODUCT`, `VISION`, or the spec, and keep them out of the feature commits. The spec and this plan land as their own commit before Task 1.
- Windows commits use two `-m` flags. Stage explicit paths. Do not `git add -A`. Do not merge or push.
- Work in an isolated worktree. Do not `npm install` there. Do not delete the shared `node_modules/@lifequest/vault-core` junction.

---

### Task 1: `source_file` on the capture path

**Files:**
- Modify: `packages/vault-core/src/capture.ts` (`captureUtterance`, `correctCapture`, and a new exported path check)
- Modify: `packages/vault-core/src/capture-tools.ts` (`CAPTURE_TOOL_DEFS`, `executeCaptureTool`)
- Create: `apps/desktop/e2e/receipt-attach.electron.mjs`
- Modify: `apps/desktop/tests/chat-panel-e2e.test.ts`

**Interfaces:**
- Consumes: `FINANCE_DOMAIN_SLUG`, `FINANCE_DB_IDS`, `upsertRow`, `listRows`, `getRow`, `vaultPaths`
- Produces:
  - `export async function isStoredReceiptPath(root: string, relPath: string): Promise<boolean>` in `capture.ts`, used by `capture-tools.ts` through a direct module import
  - `captureUtterance(root, input: { text: string; today: string; threadId: string; actor: Actor; sourceFile?: string | null })`
  - `correctCapture` keeps its signature and preserves the existing cell
  - `CAPTURE_TOOL_DEFS[0].parameters.properties.source_file` as specified
  - `executeCaptureTool` reads `args.source_file` as a string and passes it as `sourceFile`

- [ ] **Step 1: Write the failing rig and its wrapper**

Create `apps/desktop/e2e/receipt-attach.electron.mjs` with the standard driver shape: `app.setPath("userData", ...)`, `nativeTheme.themeSource = "dark"`, a `failures`/`check` pair, a `main()` inside `app.whenReady()`, the report written to `artifacts/receipt-attach.json`, a printed table, and `app.exit(report.pass ? 0 : 1)`.

Give it a `loadModules()` helper that esbuild-bundles the modules under test per Global Constraints and `import()`s the result, so later tasks add their modules to that one entry's `export *` list.

In this task the rig's main leg needs no page. Create a temp vault with the Finance kit installed, using vault-core's `createVault` and the kit install call, under `artifacts/userdata/receipt-attach/vault`. Write a small real JPEG into `domains/financial/data/files/<id>/receipt.jpg` inside it, then drive `executeCaptureTool` against that vault through the path returned by the vault's own `saveDatabaseFile`.

The scenarios, each recorded as `{ name, pass, detail }` and each failing its own `check`:

- `capture_transaction` with `source_file` set to that stored path, a stated amount, and a selected account: one row exists and its `source_file` cell equals the path.
- `source_file: "domains/financial/data/files/../../secrets.txt"`: the result carries `error.code === "MALFORMED"`, and the transaction row count is unchanged.
- `source_file: "domains/health/data/files/x/y.jpg"`: refused the same way, row count unchanged.
- A well-shaped path under `domains/financial/data/files/` that is not on disk: refused the same way, row count unchanged.
- `source_file` containing a backslash: refused the same way.
- No `source_file`: posts one row whose `source_file` cell is `null`.
- Two captures in two threads citing the same stored path: both rows carry it, and the file store holds one file.
- `correct_capture` on the receipt-backed row with corrected text: the row's `source_file` still equals the path.
- `undo_capture` on that thread: the row is gone and the file is still on disk.

Then add a `describe("receipt attach", ...)` inside `describe("chat panel rigs", { concurrency: true }, ...)` in `apps/desktop/tests/chat-panel-e2e.test.ts`, mirroring the existing siblings: its own `RECEIPT_REPORT` path, the dev-server probe with the `npm run dev` skip message, `fs.rmSync` of the report before the run, `execFile(electron, [path.join(desktopRoot, "e2e/receipt-attach.electron.mjs")], { cwd: desktopRoot, timeout: 120_000 })`, then asserts that the report exists, that `report.pass` is true, and that this task's scenario names are all present with `pass: true`. Later tasks extend the same describe.

- [ ] **Step 2: Run the rig and confirm it fails**

Run, from `apps/desktop`: `node e2e/receipt-attach.electron.mjs`

Expected: FAIL, because `source_file` is ignored and every receipt-backed row comes out with `null`.

- [ ] **Step 3: Implement the check and thread the argument**

`isStoredReceiptPath` in `capture.ts` returns false for a non-string, an absolute path, a path containing `..`, a path containing `\`, and a path that does not start with `` `domains/${FINANCE_DOMAIN_SLUG}/data/files/` ``. It then `fs.stat`s `path.posix.join(root, relPath)` and returns true only for a file.

`captureUtterance` awaits `isStoredReceiptPath` when `sourceFile` is a non-empty string. A failure returns `{ ok: false, error: "source_file must name a stored receipt" }` before any row work happens. On success the row's `source_file` cell is that string. A missing, null, or empty `sourceFile` keeps `null`.

`correctCapture` reads the existing row with `getRow` before building cells and carries its `source_file` value into the new cells, so correction never clears it.

`executeCaptureTool` passes `typeof args.source_file === "string" ? args.source_file : null` as `sourceFile`.

The tool's `source_file` description is the string in the spec, verbatim.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run, from `apps/desktop`: `node e2e/receipt-attach.electron.mjs`

Expected: PASS on all nine scenarios with `receipt attach: PASS`.

Then, from the repo root: `npm test`

Expected: PASS, with the new describe green alongside the page's other rigs.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/vault-core/src/capture.ts packages/vault-core/src/capture-tools.ts apps/desktop/e2e/receipt-attach.electron.mjs apps/desktop/tests/chat-panel-e2e.test.ts
git commit -m "feat(vault-core): let a capture cite a stored receipt" -m "capture_transaction takes an optional source_file that must name a file inside the finance store. Correction preserves the cell and undo leaves the file."
```

---

### Task 2: Receipt preparation in main

**Files:**
- Create: `apps/desktop/electron/receipt-image.ts`
- Create: `apps/desktop/electron/pending-receipt.ts`
- Modify: `apps/desktop/electron/vault-service.ts` (`receiptAttach`)
- Modify: `apps/desktop/electron/main.ts` (`receipt:attach`)
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/e2e/receipt-attach.electron.mjs`
- Modify: `apps/desktop/tests/chat-panel-e2e.test.ts`

**Interfaces:**
- Consumes: `saveDatabaseFile`, `vaultPaths`, `isDomainLive`, `readRegistry`, `FINANCE_DOMAIN_SLUG`, `FINANCE_KIT_ID`, `withVault`
- Produces:
  - `export type ReceiptKind = "image/jpeg" | "image/png"`
  - `export function sniffReceiptKind(bytes: Uint8Array): ReceiptKind | null`
  - `export async function prepareReceipt(root: string, input: { bytes: Uint8Array; mime: string; name: string }): Promise<Result<{ relPath: string; fileId: string; name: string; size: number; modelCopy: Uint8Array }>>`
  - `export const pendingReceipt: { set(v: PendingReceipt): void; take(relPath: string): PendingReceipt | null; clear(): void; peek(): PendingReceipt | null }` where `PendingReceipt = { relPath: string; name: string; dataUrl: string; bytes: number }`
  - `vault-service.ts`: `export async function receiptAttach(input: { bytes: Uint8Array; mime: string; name: string }): Promise<Result<{ relPath: string; fileId: string; name: string; size: number }>>`
  - IPC `receipt:attach` and `window.lifequest.receiptAttach(input)`

- [ ] **Step 1: Extend the failing rig**

Add these scenarios to the rig's main leg, calling the real `prepareReceipt` and `receiptAttach`:

- A JPEG fixture is stored at `domains/financial/data/files/<id>/<name>`; the file exists; its SHA-256 and size equal the fixture's.
- A PNG fixture is stored with its bytes unchanged, and the model copy's leading bytes are `FF D8 FF`.
- A JPEG fixture whose original bytes are above 2 MB produces a model copy at or under 2 MB.
- A text buffer named `receipt.jpg` is refused with "Receipts must be JPEG or PNG images." and nothing is written under `data/files/`.
- A 26 MB buffer carrying the JPEG signature is refused with "That receipt is larger than 25 MB." and nothing is written.
- With the Finance kit uninstalled in a second temp vault, the attach is refused with "Install the Finance kit first" and nothing is written.
- `receiptAttach` sets the pending slot: `pendingReceipt.peek()` names the returned `relPath`, and `take` with that path returns it and empties the slot.
- `take` with a different path returns `null` and leaves the slot holding the prepared receipt.

Build the fixtures in the rig: a small JPEG and a small PNG as embedded base64 byte strings, the over-2MB JPEG by resizing a fixture to a wide canvas with `nativeImage` and re-encoding at quality 100, and the 26 MB buffer as the JPEG signature followed by zero bytes.

Assert each scenario name in the wrapper's describe, as in Task 1.

- [ ] **Step 2: Run the rig and confirm the new scenarios fail**

Run, from `apps/desktop`: `node e2e/receipt-attach.electron.mjs`

Expected: FAIL, because `receipt-image.ts` does not exist.

- [ ] **Step 3: Implement the preparation and the slot**

`sniffReceiptKind` compares the leading bytes against the two signatures in Global Constraints and returns the matching mime, otherwise `null`.

`prepareReceipt` runs the checks in this order and stops at the first failure: sniff the kind, reject above 25 MB, read the domain registry and confirm `isDomainLive(root, FINANCE_DOMAIN_SLUG)` plus `installedKits.includes(FINANCE_KIT_ID)`, build the model copy down the ladder, then `saveDatabaseFile(root, FINANCE_DOMAIN_SLUG, { bytes, mime: kind, name })`. The model copy is built before the write so a copy that cannot be made leaves no orphan file. The refusal messages are the exact strings in Global Constraints.

The model copy is `nativeImage.createFromBuffer(Buffer.from(bytes))`, resized with `resize({ width, height, quality: "good" })` preserving the aspect ratio against the long edge, then `toJPEG(quality)`. A null image from `createFromBuffer` is the type refusal. The ladder stops at the first copy at or under 2 MB.

`pendingReceipt` holds one slot in module state. `set` replaces it. `take(relPath)` returns and clears the slot only when `relPath` matches, and returns `null` otherwise without clearing. `clear` empties it. The slot is cleared when the vault closes.

`receiptAttach` in `vault-service.ts` runs `prepareReceipt` inside `withVault`, and on success sets `pendingReceipt` with the model copy as a `data:image/jpeg;base64,` URL and returns the four display fields without the copy.

`main.ts` registers `ipcMain.handle("receipt:attach", (_e, input) => vault.receiptAttach(input))`. `preload.ts` exposes `receiptAttach: (input) => ipcRenderer.invoke("receipt:attach", input)`, and `vite-env.d.ts` types it as `Promise<Result<{ relPath: string; fileId: string; name: string; size: number }>>`.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run, from `apps/desktop`: `node e2e/receipt-attach.electron.mjs`

Expected: PASS, with no orphan file under `data/files/` for any refused scenario.

Then, from the repo root: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/electron/receipt-image.ts apps/desktop/electron/pending-receipt.ts apps/desktop/electron/vault-service.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/vite-env.d.ts apps/desktop/e2e/receipt-attach.electron.mjs apps/desktop/tests/chat-panel-e2e.test.ts
git commit -m "feat(desktop): store a receipt in the vault and hold its model copy" -m "Main sniffs the bytes, refuses anything that is not a JPEG or PNG, re-encodes under 2 MB, and keeps one pending receipt for the next turn."
```

---

### Task 3: The multimodal turn

**Files:**
- Modify: `apps/desktop/electron/companion.ts` (`companionChatStream`)
- Modify: `apps/desktop/electron/companion-client.ts` (`buildInstructions`)
- Modify: `apps/desktop/electron/vault-service.ts` (`companionChatStreamWithPack`)
- Modify: `apps/desktop/electron/main.ts` (`companion:chatStream`)
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/e2e/receipt-attach.electron.mjs`
- Modify: `apps/desktop/tests/chat-panel-e2e.test.ts`

**Interfaces:**
- Consumes: `pendingReceipt`, `hermesFetch`, `buildInstructions`, `CompanionInstructionsInput`
- Produces:
  - `CompanionInstructionsInput` gains `attachedFile?: { relPath: string; name: string } | null`
  - `companionChatStream(sessionId: string, input: string, ctx: CompanionInstructionsInput, onEvent: (evt: ChatStreamEvent) => void, runtime?: CompanionRuntimeOverride | null, attachment?: { relPath: string; name: string; dataUrl: string } | null)`
  - `companionChatStreamWithPack` gains the same trailing `receiptRelPath?: string | null`
  - the `companion:chatStream` payload gains `receiptRelPath?: string | null`

- [ ] **Step 1: Extend the failing rig**

Add to the rig's main leg a local `http` recording server that captures each request body. Point the temp vault's `.lifequest/settings.json` at it by writing `hermesBaseUrl`, and set the app's Hermes key so `loadHermesCreds` resolves. Then call the real `companionChatStream` for these scenarios and assert on the recorded body:

- A send with a prepared receipt posts `input` as an array of exactly two parts: a `text` part equal to the draft, and an `image_url` part whose url begins `data:image/jpeg;base64,`.
- That same body's `instructions` contains the stored `relPath` and the spec's instruction line.
- The assembled body for the over-2MB fixture is under 6 MB.
- A send naming a `receiptRelPath` the slot does not hold posts nothing to the recording server and returns `{ ok: false, error: "Attach that receipt again." }`.
- A send with no receipt posts `input` as a plain string, so a text-only turn keeps today's shape.

Assert each scenario name in the wrapper's describe.

- [ ] **Step 2: Run the rig and confirm the new scenarios fail**

Run, from `apps/desktop`: `node e2e/receipt-attach.electron.mjs`

Expected: FAIL, because `companionChatStream` takes no attachment and posts a string only.

- [ ] **Step 3: Implement the wire**

`companionChatStream` takes the optional sixth argument. When it is present, `input` is posted as `[{ type: "text", text: input }, { type: "image_url", image_url: { url: attachment.dataUrl, detail: "high" } }]`. When it is absent, `input` stays the plain string. The call sets `attachedFile` on a copy of `ctx` before `buildInstructions` runs, so the path in the instructions and the path the app holds are the same value.

`buildInstructions` adds the spec's instruction line, with `<relPath>` replaced by the stored path and the file's name, immediately after the existing `capture_transaction` line. The line is absent for a turn with no receipt.

`companionChatStreamWithPack` takes the trailing `receiptRelPath`. A non-null value calls `pendingReceipt.take(relPath)`. A `null` take returns `{ ok: false, error: "Attach that receipt again." }` without calling Hermes. A successful take passes the attachment down and does not return it to the slot.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run, from `apps/desktop`: `node e2e/receipt-attach.electron.mjs`

Expected: PASS, with the text-only body shape unchanged and the receipt body under 6 MB.

Then, from the repo root: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/electron/companion.ts apps/desktop/electron/companion-client.ts apps/desktop/electron/vault-service.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/vite-env.d.ts apps/desktop/e2e/receipt-attach.electron.mjs apps/desktop/tests/chat-panel-e2e.test.ts
git commit -m "feat(desktop): send a receipt with the turn and name its vault path" -m "The turn posts the model copy as an image part and tells the agent the stored path to cite."
```

---

### Task 4: The composer control and the artifact

**Files:**
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/e2e/chat-panel.tsx`
- Modify: `apps/desktop/e2e/receipt-attach.electron.mjs`
- Modify: `apps/desktop/tests/chat-panel-e2e.test.ts`

**Interfaces:**
- Consumes: the chat-panel harness page, `window.lifequest.receiptAttach`, `window.lifequest.companionChatStream`
- Produces:
  - `ChatPanel` state: `receipt: { relPath: string; name: string; size: number; previewUrl: string } | null`
  - the page's `ChatCall` type gains `receiptRelPath?: string | null`
  - the page's bridge gains `receiptAttach`, answering `{ relPath, fileId, name, size }` and honouring a `?attachfail=1` flag with a failure result
  - the page's `harness` gains `__lqAttachCalls?: unknown[]` recording every `receiptAttach` argument

- [ ] **Step 1: Extend the failing rig with the composer leg**

Load the chat-panel harness page in the window, wait on `window.chatPanelHarnessReady`, and set a fixed content size as the other chat-panel rigs do. Then, from the page, build a real `File` from the JPEG fixture's bytes, wrap it in a `DataTransfer`, and drive each entry path on the real control:

- A pick, a drop, and a paste each show a chip carrying the file name.
- A send after an attach posts a `receiptRelPath` equal to the bridge's `relPath`.
- A second attach replaces the first, leaving one chip.
- The chip's remove control clears it, and the next send carries no `receiptRelPath`.
- With the page loaded as `?attachfail=1`, the attach error shows and no chip appears.
- Switching sessions clears the chip.

Take screenshots of the chip and of a thread carrying the operator's own turn, and write them beside the artifact. Assert each scenario name in the wrapper's describe, and assert `pass` on the whole report.

- [ ] **Step 2: Run the rig and confirm the composer leg fails**

Run, from `apps/desktop` with `npm run dev` up: `node e2e/receipt-attach.electron.mjs`

Expected: FAIL, because the composer has no attach control.

- [ ] **Step 3: Implement the composer**

`ChatPanel` adds the attach control, the drop handler on the composer form, the paste handler on the textarea, the chip, and the payload field. The control is an `ImagePlus` icon button wrapping an `<input type="file" accept="image/png,image/jpeg">`, disabled while sending, with no session, and with the vault closed. The chip's `previewUrl` is an object URL built from the picked `File`, revoked when the receipt is replaced, cleared, or the panel unmounts. A second attach replaces the first; a pending receipt is cleared on send, on session switch, on a new session, and on unmount. The optimistic user turn renders the chip.

The page's bridge answers `receiptAttach` as the interface above and records its arguments, so the composer leg can assert what the panel passed to main.

- [ ] **Step 4: Run the whole suite**

Run, from `apps/desktop` with `npm run dev` up: `node e2e/receipt-attach.electron.mjs`

Expected: PASS on both legs, with every scenario name from the spec's Verification section present in `e2e/artifacts/receipt-attach.json`.

Then, from the repo root: `npm test`

Expected: PASS on every rig.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/src/components/hermes/ChatPanel.tsx apps/desktop/src/vite-env.d.ts apps/desktop/e2e/chat-panel.tsx apps/desktop/e2e/receipt-attach.electron.mjs apps/desktop/tests/chat-panel-e2e.test.ts
git commit -m "feat(desktop): attach a receipt from the composer" -m "The composer takes one image by pick, drop, or paste and carries the vault path on the turn. The rig proves both legs and writes the artifact."
```
