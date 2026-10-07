# Design: Receipt images in the vault

**Date**: 2026-10-07
**Status**: Draft for review. Implementation plan: `docs/superpowers/plans/2026-10-07-receipt-image-vault.md`.

## Problem

The operator wants to hand the agent a photo of a receipt, have the transaction logged, and keep the photo as the source of record.

The vault already has the slot. `Transactions` carries a `source_file` column of type `file`. A file cell holds a vault-relative path under `domains/financial/data/files/`, and the bytes live at that path. CSV and PDF import already work this way: the file is copied in first and stays even when no row is accepted.

Three gaps keep a receipt photo out of that slot today:

1. `captureUtterance` and `correctCapture` write `source_file: null`, so a transaction logged from chat has nothing to point at.
2. The companion composer sends text alone. `POST /api/sessions/{id}/chat/stream` accepts image parts, and the app never builds one.
3. Nothing copies the photo into the vault, so there is no path to point at.

## Settled choices

- The companion chat in the desktop app is the entry point. Phone agents and the Data page keep the paths they have.
- The app stores the original in the vault before the turn leaves the app. When the copy fails, the turn does not go.
- One receipt image per turn.
- JPEG and PNG are the accepted formats.
- The agent never writes bytes. `capture_transaction` may only cite a path that already exists in the finance file store.
- The vault keeps the original bytes exactly. Hermes sees a downscaled re-encode under a fixed ceiling.
- Deleting a row never deletes its file. Undo removes the transaction and leaves the receipt.
- One stored receipt may back several rows.

## Flow

| # | Where | Step |
|---|---|---|
| 1 | Renderer | The operator picks, drops, or pastes one image into the composer. |
| 2 | Renderer → main | `receipt:attach` carries the bytes, the declared mime, and the file name. |
| 3 | Main | Sniffs the magic bytes, checks the finance preconditions, builds the model copy, writes the original with `saveDatabaseFile`, and holds the pair in the pending-receipt slot. |
| 4 | Main → renderer | Returns `{ relPath, fileId, name, size }`. The renderer shows a chip above the field. |
| 5 | Renderer → main | The send carries `receiptRelPath` beside the text. |
| 6 | Main | Takes the slot, folds the receipt path into the turn's instructions, and posts `input` as a text part plus an `image_url` part. |
| 7 | Hermes | Reads the image, then calls `capture_transaction` with `source_file` set to the path from step 6. |
| 8 | Vault | The row lands with `source_file` pointing at the stored original. |

Steps 3 and 6 both live in main. The renderer never holds the model copy, so the path a row ends up citing and the image the model saw cannot drift apart.

## The stored file

`saveDatabaseFile` already owns the layout, the file-id mint, and the name sanitising: `domains/financial/data/files/{fileId}/{basename(name)}`. The receipt path adds the checks in front of it.

- **Format.** The app sniffs the leading bytes and ignores both the extension and the declared mime. JPEG is `FF D8 FF`. PNG is `89 50 4E 47 0D 0A 1A 0A`. Anything else is refused with "Receipts must be JPEG or PNG images."
- **Size.** The original is capped at 25 MB and refused above it with "That receipt is larger than 25 MB."
- **Preconditions.** The `financial` domain is live and the Finance kit is installed, both read from the domain registry. A missing kit is refused with "Install the Finance kit first", the message the capture tool already returns.
- **Vault.** A closed vault disables the attach control before any of this runs.
- **Name.** The operator's file name is kept, with `saveDatabaseFile`'s existing basename and escape checks applying unchanged.

## The model copy

The image Hermes reads is a re-encode, built in main with Electron's `nativeImage`: `createFromBuffer`, `resize`, `toJPEG`. No new dependency.

| Attempt | Long edge | JPEG quality |
|---|---|---|
| 1 | 1600 px | 80 |
| 2 | 1600 px | 60 |
| 3 | 1200 px | 55 |

The first attempt that lands at or under 2 MB is the copy. When all three stay over 2 MB, the attach is refused with "This receipt could not be prepared for the agent" and nothing is written.

The request body the app assembles is capped at 6 MB, which leaves 4 MB of headroom under the gateway's `MAX_REQUEST_BYTES` of 10 MB. Base64 inflates bytes by a third, so a 2 MB copy arrives as roughly 2.7 MB of body. The ladder above holds the body inside the cap for every accepted original.

A PNG is flattened to JPEG for the model copy. The original PNG stays in the vault, byte for byte.

## The composer

- An attach control sits on the composer row beside the send button: an `ImagePlus` icon button wrapping an `<input type="file" accept="image/png,image/jpeg">`. It is disabled while a turn is sending, while no session is selected, and while the vault is closed.
- The composer form accepts a drop, and the textarea accepts a paste carrying an image.
- The chip above the field shows a thumbnail, the file name, the size, and a remove control.
- A pending receipt is cleared on send, on session switch, on a new session, and on unmount. One receipt at a time: a second attach replaces the first.
- The operator's own turn renders in the thread with the chip. After a thread reload the app shows the transcript's text stand-in, which does not carry the file name; the file identity then lives on the transaction row's `source_file` cell, which is the source of record.

## The instruction line

`buildInstructions` gains one line when the turn carries a receipt, naming the stored path:

> One receipt image is attached to this turn. Its original is stored in the vault at `<relPath>`. When you log a transaction from that image, pass that exact string as `source_file`. Pass `source_file` only for a path the app gave you. If the image does not give you an amount or an account, ask and post no row; the stored file stays.

The path arrives on the send payload. `companionChatStream` folds it into the instruction context itself, so the renderer is never the source of the path.

## capture_transaction

The tool gains one optional parameter:

```ts
source_file: {
  type: "string",
  description:
    "Vault-relative path of the original receipt, exactly as the app reported it " +
    "(domains/financial/data/files/<id>/<name>). Omit it when the row came from stated text with no stored original.",
}
```

`sourceFile` threads from `executeCaptureTool` into `captureUtterance`, which sets `source_file` to it and keeps `null` as the default. A row posted without the argument is unchanged from today.

The argument is accepted only when it passes both checks:

1. **Shape.** Relative, no `..`, no backslash, and prefixed `domains/financial/data/files/` — the same rule the file column already enforces for every file cell.
2. **Existence.** The path stats as a file inside the open vault.

A path that fails either check refuses the whole capture with `{ error: { code: "MALFORMED", message: "source_file must name a stored receipt" } }` and posts no row. A row that cites a missing file is the defect this feature exists to prevent, so the refusal is the whole turn's outcome rather than a silent drop of the column.

## correct_capture and undo_capture

`correctCapture` overwrites the row's cells, so today it would wipe `source_file` to `null` on a receipt-backed row. It reads the existing row's `source_file` first and preserves it.

`undo_capture` keeps its current behaviour: the row goes, the file stays.

## Failure catalogue

| Condition | Where it is caught | Outcome |
|---|---|---|
| Bytes are not JPEG or PNG | Sniff in main | Refused. Nothing written. No turn sent. |
| Original over 25 MB | Size check in main | Refused. Nothing written. No turn sent. |
| Finance kit missing or `financial` archived | Precondition in main | Refused with the capture tool's own message. Nothing written. |
| Vault closed | Header, in the renderer | Attach control disabled. |
| Write to the vault fails | `saveDatabaseFile` result | The error surfaces on the composer. No turn sent. |
| Model copy stays over 2 MB after the ladder | Re-encode in main | Refused. The stored original stays. No turn sent. |
| Assembled body would pass 6 MB | Body check in main | Refused. No turn sent. |
| Renderer sends a path the slot does not hold | Slot take in main | Refused with "Attach that receipt again." No turn sent. |
| The app is backgrounded mid-turn | Slot lifecycle | The body is already built, so the turn completes. |
| Agent passes a path outside the store | `captureUtterance` shape check | Tool refusal. No row. |
| Agent passes a well-shaped path that is not on disk | `captureUtterance` existence check | Tool refusal. No row. |
| Agent invents a path it was never given | Both checks together | Tool refusal. No row. |
| Agent posts no row because the image was unclear | Model behaviour | The stored file stays, as an import's file does. |
| Agent cites one file on two rows | No constraint | Both rows carry it. One file on disk. |
| Undo after a capture | `undoCapture` | Row deleted. File stays. |
| Correct after a capture | `correctCapture` | Row updated. `source_file` preserved. |

## Verification

The repo's standing rule is E2E as the sole testing mechanism, and `d4ecbeb` left one wrapper per harness page with every other suite deleted. This feature adds a rig, not a suite: `apps/desktop/e2e/receipt-attach.electron.mjs`, a rig of the existing chat-panel harness page, wrapped by that page's existing wrapper, `apps/desktop/tests/chat-panel-e2e.test.ts`. No new harness page and no new test file.

The rig writes `e2e/artifacts/receipt-attach.json` and screenshots, prints its table, and exits non-zero on any failed check. That JSON is the repeatable artifact: same command, same numbers, no eyeballing the app. The artifacts directory is ignored by git, so the artifact is a product of the run.

The rig runs two legs in one Electron process.

**The composer leg** loads the real `ChatPanel` on the harness page, where the IPC bridge is the page's stub. It drives the real control down each entry path — a pick through the file input, a drop on the composer, a paste into the field — and records the payload the panel sends. It covers the chip, the replace, the remove, the session switch, and the `receiptRelPath` the panel puts on the wire.

**The main leg** creates a temporary vault with the Finance kit installed, then calls the real main-process modules: `prepareReceipt`, `receiptAttach`, `companionChatStream` pointed at a local recording server standing in for Hermes, and `capture_transaction` through the real tool executor.

One seam stays open, and the rig's doc comment names it: a dev-server page has no preload, so the panel's `receiptAttach` call ends at the page's stub rather than at main's real handler. The composer leg proves the payload's shape; the main leg proves what main does with that shape.

The main leg covers these scenarios:

- A JPEG attach stores the original at `domains/financial/data/files/<id>/<name>`, and the stored SHA-256 equals the fixture's.
- The recorded body carries exactly two parts — a text part and an `image_url` part — and the instructions name the stored path.
- A PNG attach stores the original PNG unchanged, and the model copy arrives as JPEG.
- A JPEG whose original bytes sit above the 2 MB copy ceiling yields a model copy at or under 2 MB and a body under 6 MB.
- Bytes that are not an image, with a `.jpg` name, are refused and nothing is written.
- A 26 MB buffer carrying the JPEG signature is refused by the size check before any decode, and nothing is written.
- With the Finance kit absent, the attach is refused with "Install the Finance kit first" and nothing is written.
- `capture_transaction` with the handed-over path posts one row whose `source_file` equals that path.
- `capture_transaction` with `domains/financial/data/files/../../secrets.txt`, with a `domains/health/...` path, with a well-shaped path that is not on disk, and with a backslash in the path each refuse and post no row.
- `capture_transaction` with no `source_file` posts a row with `source_file: null`, so stated-text capture still works.
- Two rows citing the same stored receipt both carry it, and the file store holds one file.
- `correct_capture` on a receipt-backed row leaves `source_file` intact.
- `undo_capture` removes the row and leaves the file on disk.
- A send naming a path the slot does not hold is refused and no request reaches the recording server.

The composer leg covers these scenarios:

- A pick, a drop, and a paste each put a chip carrying the file name on screen.
- A send after an attach carries a `receiptRelPath` equal to the path the bridge returned.
- A second attach replaces the first, leaving one chip.
- The chip's remove control clears it, and the next send carries no `receiptRelPath`.
- A bridge that refuses the attach shows that error and leaves no chip.
- Switching sessions clears the chip.

The composer leg also writes screenshots of the chip and of a thread carrying the operator's own turn.

## Out of scope

A vault file-write MCP tool, and with it the phone-chat path: an agent that receives a receipt in WhatsApp or Telegram still cannot store bytes. The Data page accepting images in Import. More than one image per turn. HEIC, WebP, GIF, and PDF receipts. Attaching a receipt to a transaction that already exists. Sweeping or deleting orphaned receipts. Serving receipt bytes over HTTP to give Hermes a URL instead of a data URL. Per-domain receipt stores beyond `financial`.

## Primary code

- `packages/vault-core/src/capture.ts` — `source_file` on the capture row, the shape check, the existence check, and the preserved value on correct.
- `packages/vault-core/src/capture-tools.ts` — the `source_file` parameter and its refusal.
- `apps/desktop/electron/receipt-image.ts` (new) — magic-byte sniff, preconditions, re-encode ladder, model copy size.
- `apps/desktop/electron/pending-receipt.ts` (new) — the single-slot pending receipt, its take, and its clear.
- `apps/desktop/electron/vault-service.ts` — `receiptAttach`, and the receipt threading through `companionChatStreamWithPack`.
- `apps/desktop/electron/companion.ts` — the multimodal `input` and the instruction context.
- `apps/desktop/electron/companion-client.ts` — the instruction line.
- `apps/desktop/electron/main.ts`, `preload.ts`, `src/vite-env.d.ts` — the `receipt:attach` channel and the send payload.
- `apps/desktop/src/components/hermes/ChatPanel.tsx` — the attach control, the chip, the drop and paste, and the payload.
- `apps/desktop/e2e/receipt-attach.electron.mjs` (new) — the rig, its two legs, and the artifact.
- `apps/desktop/e2e/chat-panel.tsx` — the bridge stub for `receiptAttach`, and the recorded payload type.
- `apps/desktop/tests/chat-panel-e2e.test.ts` — the rig's wrapper describe, on the page's existing wrapper.
