# Design: pictures in the chat, both directions

**Date:** 2026-11-19
**Status:** Implemented on `feat/chat-images` — see §9 for the rig that proves it
**Product:** LifeQuest — local-first life-management studio
**Answers:** *The chat bar cannot show a picture. Why — and what does it take for an image the agent shares or creates to appear in its reply, and for an image the operator sends to appear as a small thumbnail in their own bubble?*

---

## 0. The short answer

Two independent gaps, one shared renderer:

1. **The agent's reply is plain text.** `TurnBubble` prints `{content}` with
   `white-space: pre-wrap`; a `![caption](path)` an agent writes is shown
   literally. The renderer never looked for picture references, and nothing
   in the app ever told the agent that the chat can draw one.
2. **The operator's own bubble remembers a name, not pixels.** The live turn
   keeps `receipt: {name, size}` and drops the general attachments entirely;
   a reloaded turn rebuilds itself from the gateway transcript, which stores
   the sent pictures as a `[screenshot]` marker plus an
   `[Image attached at: /…/native-inputs/…]` hint — evidence the renderer
   currently prints as raw text.

The fix is a small picture path with one well-guarded read, used by three
sources of references:

- an **agent reply** naming a picture that lives in the vault,
- a **live turn** naming the attachment/receipt the operator just sent,
- a **reloaded transcript** naming the gateway's retained copy.

Everything renders through one `ChatImage` control: a thumbnail that opens,
has a quiet missing state, and never makes the app fetch the network.

---

## 1. What counts as a picture

A chat picture is a **file in the vault**, never a URL:

| Source | Reference | Where the bytes come from |
| --- | --- | --- |
| Agent reply | markdown `![caption](vault-relative-path)` (or an absolute path inside the vault) | `chat:imageRead` → bytes |
| Live send | the attachment/receipt `relPath` main minted | `chat:imageRead` → bytes |
| Hermes reload | `[Image attached at: <abs path>]` hint paired with a `[screenshot]` marker | `chat:imageRead` → bytes (path under the profile's `native-inputs/`) |
| Pi reload | an `image` part in the stored user row | the part's own data URL (CSP already allows `data:`) |

Only `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`. A remote `https://` URL is
**not** drawn: the CSP is `img-src 'self' data: blob:` and loosening it would
let model output make the app fetch arbitrary hosts. The companion is told to
save a picture into the vault first (see §4).

## 2. The read: `chat:imageRead`

`preload.chatImageRead(ref)` → `Result<{ bytes: Uint8Array; mime }>`.

`apps/desktop/electron/chat-image.ts` resolves and guards `ref`:

- trim; refuse empty, NUL, and any scheme (`http:`, `data:`, `file:` …);
- a relative ref resolves against the **vault root**; an absolute ref is kept;
- the resolved file must sit inside the vault root **or** inside the active
  companion profile's `native-inputs/` tree (the gateway's retained copy of a
  picture the operator sent). Anything else is refused — a transcript hint is
  not a capability to read the disk;
- `assertPhysicalContainment(container, target)` refuses `..`, absolute
  escapes and any symlinked component;
- the extension decides the mime; the first bytes must carry that format's
  magic (`\x89PNG`, `\xFF\xD8\xFF`, `GIF8`, `RIFF….WEBP`), so a renamed text
  file is refused rather than half-read;
- a regular file only, at most `CHAT_IMAGE_MAX_BYTES` (24 MB, the face of a
  4K photo at full size; the vault is a folder the operator syncs).

The error text is the operator's: *That picture could not be read.*

## 3. The render

One component, `ChatImage`, owns resolution and presentation:

- `source = { name, src? , ref? }`; `src` (blob/data URL) paints directly,
  `ref` is read once through the IPC and turned into a blob URL that is
  revoked on unmount/ref change (same pattern as `useImageUrls`);
- states: loading (reserved box, no layout jump), ready, missing (small chip
  with the picture's name and an `ImageOff` icon, `title` saying why);
- variants: `answer` (in the companion's prose: max 18 rem tall, full column
  wide, left aligned) and `sent` (in the operator's bubble: 3.5 rem square
  mini thumbnail, wrapped in a row above the words);
- a thumbnail is a button: clicking opens a fixed overlay with the picture at
  its own size, Esc/backdrop closes. Copy `alt` from the markdown caption.

`parseChatImages(text)` (`apps/desktop/src/lib/chat-images.ts`) splits an
answer into text runs and picture references:

- only markdown image syntax matches; the ref must end in a picture
  extension and carry no scheme;
- an incomplete or invalid tag stays literal text (a streaming reply ends
  with a half-written tag for one frame; it flips to the picture when the
  tag completes);
- text runs are rendered untouched, so the bubble's spacing does not change
  for a reply with no pictures.

## 4. What the agent is told

`buildInstructions` gains one short block (shared by Hermes and Pi):

> **Showing a picture in the chat.** The chat draws a picture only when it is
> a file in the vault. Save it inside the vault first, then write
> `![short caption](vault-relative-path)` in your reply — for example
> `![floor plan](attachments/chat/floor-plan.png)`. A remote URL or a data
> URL is never drawn; download a generated picture into the vault before you
> reference it.

The block is always present: it is a capability of the app, not of a turn.

## 5. The model changes

`TranscriptMessage` gains `images?: { name; ref?; src? }[]`:

- `messagesFromPayload` (Hermes) pairs `[screenshot]` markers with
  `[Image attached at: …]` hints inside a user row, strips those lines from
  the displayed text, and exposes the absolute refs. A row that held only a
  picture now survives (`content` empty, `images` non-empty) instead of being
  dropped.
- `projectTranscript` (Pi) turns an `image` part into a `src` data URL
  (bounded: at most 4 pictures, each source string under 8 M characters);
- `sanitizeTranscriptRows` bounds the list (at most 8) and keeps only string
  fields.

`TurnUser` gains `images?: { name; src?; ref? }[]`; `buildTurnTimeline` maps
history rows and `openTurn` carries the live turn's. A live send names the
stored paths main minted (`receipt.relPath`, `ChatAttachment.relPath`), so the
bubble reads the bytes back instead of borrowing the composer's preview URL —
the preview keeps its one owner and is revoked exactly as before.

## 6. Failure modes (the E2E rig's list)

1. An agent reply's picture never appears, or its caption/alt is lost.
2. A reply with no pictures looks different (extra gaps, lost text runs).
3. A picture that cannot be read shows a broken-image icon or raw markdown
   instead of the quiet missing chip.
4. A streamed half-written `![…](` paints as a picture before it is complete,
   or disappears entirely when it is.
5. The operator's sent picture does not appear in their own bubble, shows
   only the name, or appears in the composer after sending.
6. A reloaded chat loses the sent picture (Hermes marker/hint pairing broken,
   or the image-only user row dropped).
7. The read door is loose: a `..` path, an absolute path outside the vault,
   a symlinked leaf, a non-picture extension or a renamed text file returns
   bytes; or a picture larger than the ceiling is read anyway.
8. A remote URL is fetched instead of refused.
9. The overlay opens but Esc/backdrop does not close it, or it traps the page.

## 7. Files

- new `apps/desktop/electron/chat-image.ts`; `main.ts`, `preload.ts`,
  `vault-service.ts` (read entry point), `companion.ts` (profile home for the
  native-inputs allowlist), `companion-client.ts` (transcript markers +
  instruction block), `harness/pi-harness.ts` (image parts);
- `apps/desktop/src/vite-env.d.ts`, `src/lib/chat-images.ts` (new),
  `src/lib/turn-timeline.ts`, `src/state/ChatSessionsProvider.tsx`,
  `src/components/hermes/ChatImage.tsx` (new),
  `src/components/hermes/turn/TurnTimeline.tsx`,
  `src/components/hermes/ChatPanel.tsx`, `src/styles/global.css`;
- `apps/desktop/e2e/chat-panel.{html,tsx}`, new
  `apps/desktop/e2e/chat-images.electron.mjs`, new
  `apps/desktop/tests/chat-images-e2e.test.ts`;
- `docs/wiki/24-companion.md` (the operator-facing page).

## 8. Non-goals

- Remote pictures as an `<img>` source; no network fetch on the renderer's
  behalf.
- Video, audio, or PDF previews in the thread.
- Pasting pictures into a *steer* (a steer is a sentence; its pictures are not
  implemented).
- A gallery of chat pictures; the Images wing stays the library.

## 9. Verification

`apps/desktop/e2e/chat-images.electron.mjs` (wrapped by
`apps/desktop/tests/chat-images-e2e.test.ts`) runs two legs against a real
Electron window, the real `ChatPanel`/`ChatImage`/CSS, and the real
`electron/chat-image.ts` bundled the way the app's main is bundled:

- **renderer** — `chat-panel.html?images=1`: the gateway's persisted
  `[screenshot]` / `[Image attached at: …]` pairing (through the shipping
  `messagesFromPayload`) paints the sent picture in the operator's bubble, the
  answer's markdown pictures paint with their captions, an unreadable picture is
  the quiet chip, a picture-free chat draws none, the overlay opens and closes
  on Escape and a backdrop click, a live reply's picture paints, and a picture
  attached through the composer becomes a mini thumbnail in the sent bubble (and
  survives a reload).
- **main** — every allowed ref reads (vault-relative, absolute-in-vault,
  `native-inputs` absolute); every refused one is refused (`..`, outside-both,
  `https:`, `data:`, wrong extension, lying bytes, symlinked leaf, over the
  ceiling, missing, empty, NUL). Relative and absolute refs are byte-identical.
- **instruction** — the shipping `buildInstructions` carries the picture rule on
  every turn, names the vault root when one is open, names none when it is
  closed, refuses remote/data URLs in words, and is identical for Pi and Hermes.

A second rig proves the seam the harness cannot: `chat-image-ipc.electron.mjs`
boots the **real product** (`bootForE2e` against this checkout's built `dist/`,
so the rebuilt main and preload are the ones under test) with a throwaway
profile, Hermes home and MCP ports, creates and opens a throwaway vault through
the real IPC, writes a real picture into it, and reads it back through
`window.lifequest.chatImageRead`: the vault-relative and absolute refs return
the bytes (a real `Uint8Array` across IPC), and `../`, `https:`, an empty ref and
a `.txt` are refused by the live door with the operator's sentence.

Run on this checkout: `/root/.local/bin/lifequest-e2e <worktree>
tests/chat-images-e2e.test.ts tests/chat-image-ipc-e2e.test.ts` — 2/2 suites
green; artifacts `apps/desktop/e2e/artifacts/chat-images.{json,png}` (66/66
checks; the picture shows both directions, the missing chip and a live answer)
and `chat-image-ipc.{json,png}` (16/16 checks; the picture is the shipped shell
with the rig's vault open). The chat-panel, chat-bubble-meta and chat-display
rigs were re-run against the same checkout and stayed green (9/9).

One honest limit, repeated from §1: a Hermes reload can only draw a sent picture
while the gateway still holds its copy under the profile's `native-inputs/`
(Hermes sweeps those on its own schedule). After a sweep the row falls back to
the quiet missing chip with the picture's name.
