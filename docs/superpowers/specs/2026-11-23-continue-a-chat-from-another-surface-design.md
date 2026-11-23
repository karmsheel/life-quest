# Continue a chat that started on another surface

Status: implementing (branch `feat/continue-channel-chats`).

## The fault

The Chats list already lists every conversation on the companion's Hermes profile,
whichever surface started it — a Telegram or Discord bot, Hermes Desktop, the CLI,
a Buzz room. The app reads those transcripts through `GET /api/sessions/{id}/messages`
and draws them. Sending into one does not work: `POST /api/sessions/{id}/chat[/stream]`
is the **API transport's** door, and Hermes deliberately refuses a turn aimed at a
session another surface owns ("API sessions are their own sessions", `api-server.md`;
the refusal is `RuntimeStoreError('permission_denied')` from
`gateway/session_api_turn.py:admit_api_steps`). On today's gateway that refusal
surfaces as HTTP 500 and the operator reads "Chat stream failed (500)".

Hermes' own answer to this is documented: "To work on a chat from another surface,
attach through the gateway WebSocket (a `prompt.submit` on the shared session)
instead of the OpenAI-compatible routes." That is what Hermes Desktop does. This
feature gives LifeQuest the same ability.

## What the operator gets

- Opening a Telegram/Discord/Desktop/CLI chat in LifeQuest keeps working as it does
  now: the transcript, rename/pin/archive, the model lock.
- Typing and sending **continues that same Hermes session** over the gateway's
  canonical JSON-RPC WebSocket. The reply lands in the same transcript, so the
  bot's next message on the platform and the next message here are the same
  conversation. Nothing is forked, copied, or ended.
- The chat carries the surface it came from ("Telegram", "Discord", "Hermes
  Desktop", "Hermes CLI", …) in the dock header and the composer says the
  conversation is shared. There is no "new chat" step.
- Composer controls the WS door cannot carry are disabled for these chats, with a
  reason in the tooltip: per-turn model/thinking pills, attachments, and steering.
  Page context is not attached either (the desktop has no such context); the
  profile's SOUL and MCP tools are, so the companion still sees the vault.
- A gateway too old to expose the canonical session WebSocket
  (`session-authority-v1` missing) is a named refusal, not a 500: "This Hermes
  build can't continue a chat from another surface. Update Hermes."

## Which chats are "another surface"

`HermesSession.source` is the surface, as the gateway recorded it. The API
transport's own surfaces are `api_server` and `bot_room`; every other label
(`telegram`, `discord`, `slack`, `whatsapp`, `desktop`, `cli`, `tui`, `local`,
`cron`, `acp`, `buzz`, …) is a chat the API door must not write. Those are the
ones this transport serves. An empty/unknown label stays on the API path, which is
what an old gateway row looks like.

## Wire protocol (verified against Hermes 0.22.5)

1. **Discover the owner.** `hermes gateway ensure --json --timeout 30` with
   `HERMES_HOME=<profile home>` answers the ready owner (it starts one only when
   none answers, and never replaces one):
   `{ state: "ready", endpoint: { api_origin, instance_id, profile_id,
   authority_epoch, runtime_protocol, capabilities, control_home, supervisor } }`.
   Require `capabilities` ⊇ `session-authority-v1`, a loopback `api_origin`, and
   `runtime_protocol === 1`.
2. **Mint a one-use ticket** over the gateway control socket — the same local
   socket `hermes-control.ts` already speaks — on the *control home*
   (`endpoint.control_home ?? endpoint.profile_id`):
   `{"protocol":1,"verb":"session-ticket","params":{"profile_id":<endpoint.profile_id>,
   "instance_id":<endpoint.instance_id>,"purpose":"interactive","scope":"host"}}`
   → `{ticket}`.
3. **Dial** `${api_origin→ws}/api/ws` with subprotocols
   `["hermes-gateway-v1", "hermes-gateway-ticket." + ticket]`. The server answers
   with `hermes-gateway-v1` and sends an `event` notification
   `{type:"gateway.ready", payload:{...}}` before any request is answered.
4. **Resume once per chat**:
   `session.resume { session_id, cols:96, source:"desktop", defer_history:true,
   omit_messages:true, profile?: "<profile name>" }`.
   `profile` is the *name* (basename of the profile home) and is required only when
   the endpoint's `profile_id` differs from its launch home (a served secondary
   profile; `control_home` names the multiplexer root). The answer carries
   `stored_session_id`, `subscription_id`, `pending`, `running`. A resumed chat is
   then subscribed for its event frames.
5. **Submit a turn**:
   `prompt.submit { session_id, text, submission_id: <uuid>, title_preview? }`
   → `{admission_id, status:"queued"|"started", ...}`. Frames arrive as `event`
   notifications tagged with `session_id`, and turn terminality is
   `message.complete { outcome, text, usage, error }` (plus `error` / `notice`).
   Deltas: `message.delta {text}`, `reasoning.delta {text}`, tools:
   `tool.start {tool_id,name,args,preview}`, `tool.progress`, `tool.complete
   {tool_id,name,result_text,summary,duration_s,error?}`.
6. **Stop** `session.interrupt { session_id }`; **approval** arrives as a
   server→client request `{"jsonrpc":"2.0","id":N,"method":"approval",
   "params":{request_id, command, description, choices, …}}` and is answered with a
   response frame `{"jsonrpc":"2.0","id":N,"result":{"choice":"once"|"deny"}}`.
   `clarify` is answered `{outcome:"cancelled"}` for now (the dock has no clarify
   card for a continued chat).

## Where it lives

- `apps/desktop/electron/hermes-gateway-ws.ts` — discovery, ticket, WebSocket
  JSON-RPC client, resume cache, per-turn event mapping. One gateway connection per
  profile, opened on the first continued send and reused.
- `apps/desktop/electron/companion.ts` — `companionChatStream` picks the transport
  from the session's source; `companionRunStop` / `companionApproval` route a
  turn's run id to the WS client when that turn is one of its own; the turn's
  events are emitted on the same `companion:stream` channel with the same
  `ChatStreamEvent` shape the renderer already consumes.
- `apps/desktop/electron/companion-client.ts` — `isContinuableSession(source)` and
  `sessionSourceLabel(source)` shared by the renderer.
- Renderer (`ChatPanel`, `ChatSessionsProvider`, `ChatsSidebar`) — source chip,
  composer note, disabled controls. No new send API: the existing
  `companionChatStream` call keeps working.
- **One turn, not two.** The call's reply and the streamed event frames travel
  different IPC channels and can arrive in either order. The continuation result
  therefore carries `settlesOnStream: true` (`ChatStreamOutcome`), and the
  renderer skips its safety-net settle for that turn: the transport guarantees a
  terminal frame (it emits one on completion, failure AND socket close), so the
  frames settle the turn exactly once. Likewise the turn's usage rides the
  terminal frame rather than a standalone `usage` frame — a lone non-terminal
  frame arriving after the reply would otherwise open an empty phantom turn.

## Failure modes and what the operator sees

| Condition | What happens |
| --- | --- |
| No gateway WS capability (old Hermes) | Named sentence on a failed turn (the dock's usual failure shape: the words stay in that turn, which carries Copy message); no transcript row is written. |
| Gateway down / ensure fails | The existing "agent unreachable" sentence. |
| Resume refuses (`not_found`, `profile_mismatch`, `permission_denied`) | Named sentence naming the refusal; no partial turn. |
| WS drops mid-turn | The turn ends `run.incomplete` with the transport sentence; the app re-reads the transcript as it already does after a failed turn. |
| Approval needed | The dock's approval card, answered over the WS response frame. |
| Clarify asked | Auto-cancelled with `outcome:"cancelled"`; the turn continues. |
| Attachments / model pill / steer attempted | Controls are disabled for these chats, so they cannot be attempted. |

## Ways this could look green while proving nothing (E2E)

1. The rig talks HTTP only and the "continue" call never reaches the WS: the fake
   gateway records every `session.resume` / `prompt.submit` frame and the artifact
   fails if they are absent.
2. The app falls back to the API transport and the fake API answers a chat anyway:
   the fake API's session-chat route is the rigorous refusal the real gateway gives
   (500 `permission_denied`), and the test asserts the turn still streamed.
3. The transcript is painted from the fake's REST list rather than from streamed
   frames: the deltas in the artifact's live DOM must contain the WS-only text.
4. The chat is continued into a different session: the fake answers
   `session.resume` only for the Telegram row, and `prompt.submit` names that id.
5. The stop/approval paths are never exercised: the rig stops the turn from the
   dock and asserts `session.interrupt` did reach the socket.
6. The screenshot is stale or blank: `capturePage` after the reply paints, >10 KB,
   and the reported DOM sample names the source chip and the reply.
7. The turn is split in two (the IPC race above): the rig counts the dock's turns
   before and after the send and requires exactly one added turn that contains
   both the operator's words and the reply, with no footer-only turn.

The rig is `apps/desktop/tests/foreign-chat-e2e.test.ts` +
`apps/desktop/e2e/foreign-chat.electron.mjs`; artifacts are
`apps/desktop/e2e/artifacts/foreign-chat.{json,png}`.
