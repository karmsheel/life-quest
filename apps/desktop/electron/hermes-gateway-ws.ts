/**
 * Continue a chat that another surface owns, over the Hermes gateway's own
 * canonical JSON-RPC WebSocket.
 *
 * WHY THIS EXISTS
 *
 * The app's chat transport is the gateway's OpenAI-compatible API
 * (`POST /api/sessions/{id}/chat/stream`). That API deliberately refuses a turn
 * aimed at a session another surface owns — a Telegram or Discord lane, Hermes
 * Desktop, the CLI, an ACP client — because running an API agent beside the
 * live owner would write the same transcript twice. The refusal is
 * `permission_denied` from `gateway/session_api_turn.py`, and on today's gateway
 * it reaches the dock as `Chat stream failed (500)`.
 *
 * Hermes documents the door that IS for this: "To work on a chat from another
 * surface, attach through the gateway WebSocket (a `prompt.submit` on the
 * shared session)" (`docs/user-guide/features/api-server.md`). Hermes Desktop
 * uses exactly that door. This module speaks it for the app:
 *
 *   1. `hermes gateway ensure --json` names the ready owner's internal session
 *      API (`endpoint.api_origin`, `instance_id`, `profile_id`, `capabilities`).
 *   2. A one-use ticket is minted over the gateway's local control socket
 *      (`session-ticket`), the same socket `hermes-control.ts` already speaks.
 *   3. `/api/ws` is dialled with subprotocols `hermes-gateway-v1` and the ticket
 *      (`hermes-gateway-ticket.<ticket>`). The gateway answers `gateway.ready`
 *      before any request is served.
 *   4. `session.resume` attaches one stored chat to this connection (once; the
 *      gateway then streams that session's frames to us). A chat started on a
 *      platform is mounted from its persisted lane — the same mount Hermes
 *      Desktop performs — and is NOT copied, forked or ended.
 *   5. `prompt.submit` admits one turn on that stored session.
 *
 * The frames are translated back into this app's own `ChatStreamEvent` shapes,
 * so the renderer's turn timeline, approval card, Stop and error surfaces are
 * the same ones every other chat already uses. Nothing downstream learns that
 * the turn travelled a different wire.
 *
 * There is deliberately no second implementation of chat here: discovery,
 * ticket minting and the "is this chat continuable" decision stay in
 * `companion.ts`; this file is the wire.
 */

import type { ChatStreamEvent, TurnUsage } from "./companion-client.ts";

/** The owner endpoint `hermes gateway ensure --json` answers. */
export type GatewayEndpoint = {
  /** Loopback origin of the gateway's internal session API, e.g. `http://127.0.0.1:39399`. */
  apiOrigin: string;
  /** The running owner's instance id; the ticket is bound to it. */
  instanceId: string;
  /** The profile home the endpoint serves. */
  profileId: string;
  /** Profile name to name on `session.resume` when this profile is a served secondary. */
  profileName: string | null;
  capabilities: string[];
  /** Home whose control socket mints the ticket (the multiplexer root for a served profile). */
  controlHome: string;
};

/** One turn to admit on a stored chat. */
export type ContinuationTurn = {
  sessionId: string;
  text: string;
  /** The run id this app uses for the turn (stop/approve route by it). */
  runId: string;
  /** The gateway's admission identity; distinct from the run id, which is the client's. */
  submissionId: string;
  onEvent: (event: ChatStreamEvent) => void;
};

type PendingRpc = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveTurn = ContinuationTurn & {
  /** True once a delta arrived; the gateway's whole reply is the authoritative one. */
  sawDelta: boolean;
  finished: boolean;
  /** Resolved when the turn reaches its terminal frame. */
  done: Promise<void>;
  markDone: () => void;
};

type ServerRequest = {
  id: unknown;
  method: string;
  params: Record<string, unknown>;
  runId: string;
};

const WS_PROTOCOL = "hermes-gateway-v1";
const WS_TICKET_PREFIX = "hermes-gateway-ticket.";
const OPEN_TIMEOUT_MS = 12_000;
const RPC_TIMEOUT_MS = 120_000;
const HEARTBEAT_MS = 20_000;
/** How long a socket may stay open with no chat resumed before it is closed. */
const IDLE_CLOSE_MS = 90_000;

const NOT_AVAILABLE =
  "This Hermes build can't continue a chat from another surface. Update Hermes, then try again.";
const TRANSPORT_LOST =
  "The connection to the Hermes gateway closed before the turn finished. The chat is unchanged; try again.";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One socket's JSON-RPC bookkeeping: request ids, replies, notifications.
 *
 * The transport is deliberately dumb about chats — it answers "the socket
 * opened", "the socket closed", "this frame arrived" — so the session and turn
 * semantics live where they can be tested without a socket.
 */
class GatewaySocket {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private opened = false;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly subprotocols: string[],
    private readonly onFrame: (frame: Record<string, unknown>) => void,
    private readonly onClosed: (detail: string) => void,
  ) {}

  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        finish();
      };
      const timer = setTimeout(
        () =>
          settle(() =>
            reject(new Error("The Hermes gateway did not answer its WebSocket.")),
          ),
        OPEN_TIMEOUT_MS,
      );
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url, this.subprotocols);
      } catch (error) {
        settle(() => reject(new Error(messageOf(error))));
        return;
      }
      this.socket = socket;
      socket.addEventListener("open", () => {
        // The owner answers with the canonical protocol only; a socket that
        // negotiated something else is not the door this app may write through.
        if (this.socket?.protocol !== this.subprotocols[0]) {
          settle(() =>
            reject(new Error("The Hermes gateway answered with another protocol.")),
          );
          this.finish("The Hermes gateway answered with another protocol.");
          return;
        }
        this.opened = true;
        this.startHeartbeat();
        settle(resolve);
      });
      socket.addEventListener("message", (event: MessageEvent) => {
        const text =
          typeof event.data === "string" ? event.data : String(event.data ?? "");
        if (!text) return;
        let frame: unknown;
        try {
          frame = JSON.parse(text);
        } catch {
          return; // a frame that is not JSON is not a frame this client can act on
        }
        if (frame && typeof frame === "object") {
          this.receive(frame as Record<string, unknown>);
        }
      });
      socket.addEventListener("error", () => {
        // The close event carries the verdict; an error alone is not one.
      });
      socket.addEventListener("close", (event: CloseEvent) => {
        // A refusal during the handshake (the gateway closes 4403 when this
        // client may not attach) is a failed open, not a turn that ended.
        settle(() =>
          reject(
            new Error(`The Hermes gateway refused the connection (${event.code}).`),
          ),
        );
        this.finish(`The Hermes gateway WebSocket closed (${event.code}).`);
      });
    });
  }

  request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (!this.socket || !this.isOpen) {
      return Promise.reject(new Error(TRANSPORT_LOST));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`The Hermes gateway did not answer ${method}.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.socket?.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(messageOf(error)));
      }
    });
  }

  /** Answer a server→client request (an approval, a question) on this socket. */
  respond(id: unknown, result: unknown): void {
    if (!this.socket || !this.isOpen) return;
    try {
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch {
      // A reply on a dead socket is not worth reporting: the turn will end.
    }
  }

  respondError(id: unknown, message: string): void {
    if (!this.socket || !this.isOpen) return;
    try {
      this.socket.send(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } }),
      );
    } catch {
      // Same: the awaiting handler times out or the turn ends with the socket.
    }
  }

  close(): void {
    this.finish("The connection to the Hermes gateway was closed.");
  }

  private finish(detail: string): void {
    if (this.closed) return;
    this.closed = true;
    this.opened = false;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(detail));
      this.pending.delete(id);
    }
    try {
      this.socket?.close();
    } catch {
      // already gone
    }
    this.socket = null;
    this.onClosed(detail);
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) return;
    let misses = 0;
    this.heartbeat = setInterval(() => {
      this.request("ping", {}, 10_000).then(
        () => {
          misses = 0;
        },
        () => {
          // The owner answers ping on its read loop even while a turn runs, so a
          // miss is a transport symptom. Two in a row is a socket this client can
          // no longer hear; closing it settles the turn rather than leaving the
          // dock writing into a dead wire.
          misses += 1;
          if (misses >= 2) this.finish("The Hermes gateway stopped answering.");
        },
      );
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private receive(frame: Record<string, unknown>): void {
    if (typeof frame.method === "string" && frame.id === undefined) {
      // A notification (an event, in tui_gateway's vocabulary).
      this.onFrame(frame);
      return;
    }
    if (typeof frame.method === "string") {
      // A server→client request: it wants an answer, and the gateway waits.
      this.onFrame(frame);
      return;
    }
    const id = typeof frame.id === "number" ? frame.id : null;
    if (id === null) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (frame.error) {
      const error = frame.error as { message?: unknown };
      pending.reject(
        new Error(
          typeof error.message === "string" && error.message
            ? error.message
            : `The Hermes gateway refused ${pending.method}.`,
        ),
      );
      return;
    }
    const result = frame.result;
    pending.resolve(
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {},
    );
  }
}

/**
 * The continuation transport for one profile.
 *
 * One socket serves every continued chat on that profile; the gateway tags its
 * event frames with the session, and this class routes them to the turn that is
 * waiting on that session. A chat is resumed once per socket; a socket that
 * closes forgets its resumes, and the next turn dials again.
 */
export class GatewayContinuation {
  private socket: GatewaySocket | null = null;
  private connecting: Promise<void> | null = null;
  private readonly resumed = new Set<string>();
  private readonly turnsBySession = new Map<string, ActiveTurn>();
  private readonly turnsByRun = new Map<string, ActiveTurn>();
  /** Server-request ids the dock may answer, keyed by the run and request identity. */
  private readonly approvals = new Map<string, ServerRequest>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly endpoint: GatewayEndpoint,
    private readonly mintTicket: () => Promise<string>,
  ) {}

  /** Connect if this transport has no live socket. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error(TRANSPORT_LOST);
    if (this.socket?.isOpen) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.dial().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async dial(): Promise<void> {
    const ticket = await this.mintTicket();
    if (!ticket) throw new Error(NOT_AVAILABLE);
    const url = `${this.endpoint.apiOrigin.replace(/^http/, "ws")}/api/ws`;
    const socket = new GatewaySocket(
      url,
      [WS_PROTOCOL, `${WS_TICKET_PREFIX}${ticket}`],
      (frame) => this.receive(frame),
      (detail) => this.socketClosed(detail),
    );
    await socket.open();
    if (!socket.isOpen) throw new Error(NOT_AVAILABLE);
    this.socket = socket;
    this.resumed.clear();
    this.touchIdle();
  }

  /**
   * Attach one stored chat to this connection, once.
   *
   * `defer_history`/`omit_messages` are what the desktop asks for when it paints
   * the transcript from REST: the dock already has the history, so resume only
   * has to bind the runtime and the event subscription.
   */
  async resume(sessionId: string): Promise<void> {
    await this.connect();
    if (this.resumed.has(sessionId)) return;
    const params: Record<string, unknown> = {
      session_id: sessionId,
      cols: 96,
      source: "desktop",
      defer_history: true,
      omit_messages: true,
    };
    if (this.endpoint.profileName) params.profile = this.endpoint.profileName;
    await this.socket!.request("session.resume", params);
    this.resumed.add(sessionId);
  }

  /**
   * Admit one turn and stream its frames into `onEvent`.
   *
   * Resolves when the gateway has admitted the turn AND the turn reached its
   * terminal frame — the same contract the API stream has, because the caller
   * does its after-turn work (filing the Decisions a reply proposed, settling
   * the transcript) on that resolution. A refusal before admission throws and
   * no turn exists; a turn that ends badly resolves after its terminal frame has
   * been delivered.
   */
  async submit(turn: ContinuationTurn): Promise<void> {
    await this.resume(turn.sessionId);
    if (this.turnsBySession.has(turn.sessionId)) {
      throw new Error("This chat is still answering the previous message.");
    }
    let markDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });
    const active: ActiveTurn = {
      ...turn,
      sawDelta: false,
      finished: false,
      done,
      markDone,
    };
    this.turnsBySession.set(turn.sessionId, active);
    this.turnsByRun.set(turn.runId, active);
    try {
      const receipt = await this.socket!.request("prompt.submit", {
        session_id: turn.sessionId,
        text: turn.text,
        submission_id: turn.submissionId,
      });
      // The receipt names the admission; a queued turn has not started yet, so
      // the dock is told the run exists now and the frames settle it later.
      const status = typeof receipt.status === "string" ? receipt.status : "";
      if (status !== "queued" && status !== "started" && status !== "") {
        this.finishTurn(turn.runId, {
          type: "run.incomplete",
          reason: `The gateway did not accept the turn (${status}).`,
        });
        return;
      }
      turn.onEvent({ type: "run.started", runId: turn.runId });
    } catch (error) {
      this.dropTurn(turn.runId);
      throw error;
    }
    await done;
  }

  /** Stop the live turn on a chat (the dock's Stop). */
  async interrupt(sessionId: string): Promise<void> {
    await this.connect();
    await this.socket!.request("session.interrupt", { session_id: sessionId });
  }

  /**
   * Stop the live turn by its run id (the dock names the turn, not the chat).
   *
   * The gateway's interrupt is cooperative: it answers the RPC and ends the run
   * with its own terminal frame (`message.complete` outcome `interrupted`), so
   * this returns without settling the turn — the frame does that, the same way a
   * REST stop does.
   */
  async interruptRun(runId: string): Promise<boolean> {
    const turn = this.turnsByRun.get(runId);
    if (!turn) return false;
    await this.interrupt(turn.sessionId);
    return true;
  }

  /** Answer an approval card. True when this run had such a request open. */
  answerApproval(runId: string, requestId: string, allow: boolean): boolean {
    const key = `${runId}\u0000${requestId}`;
    const request = this.approvals.get(key);
    if (!request || !this.socket) return false;
    this.approvals.delete(key);
    this.socket.respond(request.id, { choice: allow ? "once" : "deny" });
    return true;
  }

  /** Whether a run id belongs to this transport (the dock's Stop/Approve routing). */
  ownsRun(runId: string): boolean {
    return this.turnsByRun.has(runId);
  }

  close(): void {
    this.closed = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    this.resumed.clear();
    for (const runId of [...this.turnsByRun.keys()]) {
      this.finishTurn(runId, { type: "run.incomplete", reason: TRANSPORT_LOST });
    }
    socket?.close();
  }

  // ── frames ────────────────────────────────────────────────────────────────

  private receive(frame: Record<string, unknown>): void {
    const method = typeof frame.method === "string" ? frame.method : "";
    if (method === "event") {
      const params =
        frame.params && typeof frame.params === "object"
          ? (frame.params as Record<string, unknown>)
          : {};
      this.event(params);
      return;
    }
    if (method) {
      this.serverRequest(method, frame);
    }
  }

  private event(params: Record<string, unknown>): void {
    const type = typeof params.type === "string" ? params.type : "";
    const payload =
      params.payload && typeof params.payload === "object"
        ? (params.payload as Record<string, unknown>)
        : {};
    const sessionId = typeof params.session_id === "string" ? params.session_id : "";
    if (type === "gateway.ready") {
      this.touchIdle();
      return;
    }
    if (type === "session.info") {
      this.touchIdle();
      return;
    }
    if (!sessionId) return; // global broadcasts (skins, platforms) are not a turn's
    const turn = this.turnsBySession.get(sessionId);
    if (!turn) return; // a frame from another writer: the transcript carries it
    this.touchIdle();
    switch (type) {
      case "message.delta": {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (!text) return;
        turn.sawDelta = true;
        turn.onEvent({ type: "assistant.delta", text });
        return;
      }
      case "reasoning.delta":
      case "thinking.delta": {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (text) turn.onEvent({ type: "reasoning.delta", text });
        return;
      }
      case "message.interim": {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (text) {
          turn.onEvent({
            type: "assistant.commentary",
            text,
            alreadyStreamed: false,
          });
        }
        return;
      }
      case "tool.start": {
        const name = typeof payload.name === "string" ? payload.name : "tool";
        const callId =
          typeof payload.tool_id === "string" ? payload.tool_id : undefined;
        turn.onEvent({
          type: "tool.started",
          name,
          target: toolTarget(payload),
          ...(callId ? { callId } : {}),
        });
        return;
      }
      case "tool.progress": {
        const callId =
          typeof payload.tool_id === "string" ? payload.tool_id : undefined;
        const text =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.percent === "number"
              ? `${Math.round(payload.percent)}%`
              : "";
        if (callId && text) {
          turn.onEvent({ type: "tool.progress", callId, text });
        }
        return;
      }
      case "tool.complete": {
        const callId =
          typeof payload.tool_id === "string" ? payload.tool_id : undefined;
        const duration =
          typeof payload.duration_s === "number"
            ? Math.round(payload.duration_s * 1000)
            : undefined;
        const preview =
          typeof payload.result_text === "string" && payload.result_text
            ? payload.result_text
            : typeof payload.summary === "string"
              ? payload.summary
              : undefined;
        turn.onEvent({
          type: "tool.completed",
          name: typeof payload.name === "string" ? payload.name : "tool",
          ...(callId ? { callId } : {}),
          isError: Boolean(payload.error),
          ...(duration !== undefined ? { durationMs: duration } : {}),
          ...(preview ? { resultPreview: preview } : {}),
        });
        return;
      }
      case "error": {
        const message =
          typeof payload.message === "string" && payload.message
            ? payload.message
            : "The companion reported an error.";
        turn.onEvent({ type: "error", message });
        this.finishTurn(turn.runId, null);
        return;
      }
      case "message.complete":
        this.completeTurn(turn, payload);
        return;
      default:
        // status/notice/todo/session.title frames are not part of a turn's
        // timeline; the transcript and the existing list refresh carry them.
        return;
    }
  }

  private completeTurn(turn: ActiveTurn, payload: Record<string, unknown>): void {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (text.trim()) {
      // The gateway's whole reply is authoritative: deltas may have assembled a
      // partial answer while the same words were in the frame.
      turn.onEvent({ type: "assistant.final", text });
    }
    // The usage rides the TERMINAL frame, never a standalone `usage` frame.
    // A terminal event settles whichever turn is newest, so it is safe however
    // the IPC frames interleave with the invoke's reply; a standalone `usage`
    // frame arriving after that reply would have no live turn and the renderer
    // would open a phantom, empty turn for it. The API stream shapes its
    // terminal the same way (`run.completed` carries usage).
    const usage = usageOf(payload.usage);
    const withUsage = usage ? { usage } : {};
    const status = typeof payload.status === "string" ? payload.status : "";
    const outcome = typeof payload.outcome === "string" ? payload.outcome : "";
    const error = typeof payload.error === "string" ? payload.error : "";
    if (outcome === "interrupted" || status === "interrupted") {
      this.finishTurn(turn.runId, { type: "run.stopped", ...withUsage });
      return;
    }
    if (outcome === "completed" || status === "complete") {
      this.finishTurn(turn.runId, { type: "run.completed", ...withUsage });
      return;
    }
    const reason =
      error ||
      (typeof payload.warning === "string" && payload.warning
        ? payload.warning
        : "the turn ended without a clean completion");
    this.finishTurn(turn.runId, { type: "run.incomplete", reason, ...withUsage });
  }

  private serverRequest(method: string, frame: Record<string, unknown>): void {
    const id = frame.id;
    const params =
      frame.params && typeof frame.params === "object"
        ? (frame.params as Record<string, unknown>)
        : {};
    const sessionId =
      typeof params.session_id === "string" ? params.session_id : "";
    const turn = sessionId ? this.turnsBySession.get(sessionId) : undefined;
    if (method === "approval") {
      if (!turn) {
        // Nothing in the dock is waiting for this decision; refusing is the
        // fail-closed answer, and the turn reports its own failure.
        this.socket?.respondError(id, "No LifeQuest turn is waiting for this decision.");
        return;
      }
      const requestId =
        typeof params.request_id === "string" && params.request_id
          ? params.request_id
          : String(id);
      const summary = approvalSummary(params);
      this.approvals.set(`${turn.runId}\u0000${requestId}`, {
        id,
        method,
        params,
        runId: turn.runId,
      });
      turn.onEvent({
        type: "approval.request",
        runId: turn.runId,
        requestId,
        summary,
      });
      return;
    }
    if (method === "clarify") {
      // The dock has no clarify card for a continued chat. Answering "cancelled"
      // lets the turn finish instead of parking the gateway for the timeout.
      this.socket?.respond(id, { outcome: "cancelled", answers: {} });
      if (turn) {
        turn.onEvent({
          type: "assistant.commentary",
          text: "The companion asked a question that a continued chat can't answer here; it was cancelled.",
          alreadyStreamed: false,
        });
      }
      return;
    }
    // Every other server request (a masked secret, a preview action, terminal
    // read) is a Hermes Desktop-only bridge. Failing it fast is kinder than the
    // gateway's timeout, and the agent reports the refusal itself.
    this.socket?.respondError(
      id,
      "This request can only be answered in Hermes Desktop or the Hermes CLI.",
    );
  }

  private finishTurn(
    runId: string,
    terminal: ChatStreamEvent | null,
  ): void {
    const turn = this.turnsByRun.get(runId);
    if (!turn || turn.finished) return;
    turn.finished = true;
    this.turnsByRun.delete(runId);
    this.turnsBySession.delete(turn.sessionId);
    for (const [key, request] of this.approvals) {
      if (request.runId === runId) this.approvals.delete(key);
    }
    if (terminal) turn.onEvent(terminal);
    turn.markDone();
    this.touchIdle();
  }

  private dropTurn(runId: string): void {
    const turn = this.turnsByRun.get(runId);
    if (!turn) return;
    this.turnsByRun.delete(runId);
    this.turnsBySession.delete(turn.sessionId);
  }

  private socketClosed(detail: string): void {
    this.socket = null;
    this.resumed.clear();
    for (const runId of [...this.turnsByRun.keys()]) {
      this.finishTurn(runId, {
        type: "run.incomplete",
        reason: `${TRANSPORT_LOST} ${detail}`.trim(),
      });
    }
  }

  /**
   * Close a socket nobody is using after a while.
   *
   * A continued chat is an occasional act, not a subscription the app should
   * hold open forever; the next send reconnects and re-resumes, which is cheap.
   */
  private touchIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.turnsByRun.size === 0) this.closeSocketOnly();
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private closeSocketOnly(): void {
    const socket = this.socket;
    this.socket = null;
    this.resumed.clear();
    socket?.close();
  }
}

function toolTarget(payload: Record<string, unknown>): string {
  for (const key of ["preview", "context", "args_text", "summary"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const args = payload.args;
  if (args && typeof args === "object") {
    const first = Object.entries(args as Record<string, unknown>).find(
      ([, value]) => typeof value === "string" && value.trim(),
    );
    if (first) return String(first[1]).trim();
  }
  return typeof payload.name === "string" ? payload.name : "";
}

function approvalSummary(params: Record<string, unknown>): string {
  for (const key of ["description", "command", "summary"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "The companion needs your approval to run a command.";
}

function usageOf(raw: unknown): TurnUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const number = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
        ? Math.round(Number(value))
        : undefined;
  const input = number(usage.input ?? usage.prompt ?? usage.input_tokens);
  const output = number(usage.output ?? usage.completion ?? usage.output_tokens);
  const total = number(usage.total ?? usage.total_tokens);
  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(total !== undefined ? { total } : {}),
  };
}

/** Whether a discovered endpoint can carry a continued chat at all. */
export function endpointSupportsContinuation(
  endpoint: Pick<GatewayEndpoint, "capabilities">,
): boolean {
  return endpoint.capabilities.includes("session-authority-v1");
}

export { NOT_AVAILABLE as CONTINUATION_UNAVAILABLE, TRANSPORT_LOST as CONTINUATION_LOST };
