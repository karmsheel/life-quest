// KAR-70: the two loopback pairing doors.
//
// 127.0.0.1:8643 is the local door — a bearer and a name are enough to open a
// pairing Decision. 127.0.0.1:8646 is the invite door — a bearer needs a
// one-time invite code as well. Both bind 127.0.0.1 only, both speak the
// existing Streamable HTTP MCP on POST /mcp, and any other method or path is
// a 404. Neither door listens on a public or private-network address and
// neither terminates TLS: the operator forwards 8646 through a tunnel they
// already trust.
//
// Auth runs before a McpServer is constructed. A caller whose Decision is
// still open, rejected, or revoked gets no vault tools at all; its tools/call
// answers with the matching tool error JSON.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server as HttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  ALL_TOOL_DEFS,
  effectiveGrant,
  fingerprintOf,
  getConnectedAgentByFingerprint,
  introduceConnectedAgent,
    listDomains,
  removeConnectedAgent,
  removeDecision,
  PENDING_PAIRING_CAP,
  toolAllowed,
  type Actor as VaultActor,
  type ConnectedAgent,
  type ConnectedGrant,
} from "@lifequest/vault-core";
import {
  checkInvite,
  companionBearer,
  resolveBearer,
  withSecretsLock,
} from "./pairing-secrets.ts";

export const LOCAL_MCP_PORT = 8643;
export const INVITE_MCP_PORT = 8646;

const MCP_HOST = "127.0.0.1";
const MCP_PATH = "/mcp";
const MIN_BEARER_LENGTH = 22;
const MAX_NAME_LENGTH = 80;
/**
 * How much of the companion credential a near-miss must repeat before it is read
 * as a transcription mistake rather than a stranger's key. Twelve characters is
 * the width of a bearer fingerprint, and no agent key shares that prefix with the
 * companion credential by chance.
 */
const NEAR_MISS_CHARS = 12;

/**
 * DOOR-03: the only names a request may address either door by. The listeners
 * bind 127.0.0.1 only, so a Host of anything else is a request that came through
 * a name resolver rather than from this machine — the DNS-rebinding shape — and
 * is refused before authentication or the MCP transport sees it.
 */
const LOOPBACK_HOST_NAMES = ["127.0.0.1", "localhost"] as const;

/**
 * DOOR-05: request limits on both doors. The MCP SDK reads the body as JSON with
 * no cap of its own (SUPP-04), so the door enforces one while streaming, and
 * bounds the time a request may take to arrive and the sockets that may exist at
 * once. The window limits below are per door and in-process; they are a speed
 * bump for floods, not an authorization decision.
 */
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
const MAX_BATCH_ITEMS = 32; // JSON-RPC batch length (larger is refused 413)
const BODY_READ_TIMEOUT_MS = 10_000; // headers arrived, body stalled
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const MAX_REQUESTS_PER_SOCKET = 1000;
const MAX_CONNECTIONS = 64;
const RATE_WINDOW_MS = 10_000;
/** Presented-but-wrong credentials: headroom for a client fixing a typo. */
const MAX_FAILED_AUTH_PER_WINDOW = 30;
/** Introductions cost a Decision each; the pending cap still sits under this. */
const MAX_INTRODUCTIONS_PER_WINDOW = 40;

type DoorKind = "local" | "invite";

/** KAR-70: the actor the live MCP door already acts as. Not a new one. */
const COMPANION_ACTOR: VaultActor = { type: "agent", id: "companion", name: "Hermes" };

type AuthCode =
  | "AUTH_REQUIRED"
  | "NAME_REQUIRED"
  | "INVITE_REQUIRED"
  | "INVITE_INVALID"
  | "PAIRING_LIMIT"
  | "RATE_LIMITED";

type ToolCode =
  | "PAIRING_PENDING"
  | "PAIRING_REJECTED"
  | "PAIRING_REVOKED"
  | "NO_GRANT";

/** The exact auth messages the spec fixes. */
const AUTH_MESSAGES: Record<AuthCode, string> = {
  AUTH_REQUIRED: "Authorization bearer is required",
  NAME_REQUIRED: "X-LifeQuest-Name is required",
  INVITE_REQUIRED: "Invite code is required",
  INVITE_INVALID: "Invite code is no longer valid",
  PAIRING_LIMIT: "Too many agents are waiting for approval",
  RATE_LIMITED: "Too many pairing attempts; try again shortly",
};

const AUTH_STATUS: Record<AuthCode, number> = {
  AUTH_REQUIRED: 401,
  NAME_REQUIRED: 401,
  INVITE_REQUIRED: 401,
  INVITE_INVALID: 401,
  PAIRING_LIMIT: 429,
  RATE_LIMITED: 429,
};

/**
 * What a near-miss companion credential is told. The code stays AUTH_REQUIRED —
 * this is an authentication failure, and it files nothing — but the message says
 * which mistake it was, because the caller is usually an agent that copied the
 * token out of a listing and can fix it.
 */
const COMPANION_CREDENTIAL_HINT =
  "This bearer is a truncated or padded copy of the companion credential, so it was not accepted and nothing was registered. Use the full token from mcp_servers.lifequest.headers; an agent's own bearer is a different string.";

const TOOL_MESSAGES: Record<ToolCode, string> = {
  PAIRING_PENDING: "Waiting for approval",
  PAIRING_REJECTED: "This agent was rejected",
  PAIRING_REVOKED: "This agent was revoked",
  NO_GRANT: "No domain or schedule is assigned",
};

function errorBody(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

function writeAuthFailure(res: ServerResponse, code: AuthCode, message?: string): void {
  // The fixed strings are the contract. `message` only carries the underlying
  // reason for a failure that has no specified message of its own.
  if (res.headersSent) return;
  const body = errorBody(code, message ?? AUTH_MESSAGES[code]);
  res.writeHead(AUTH_STATUS[code], {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

/** A refusal that is not one of the fixed auth codes: 403/408/413/429/500. */
function sendRefusal(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  const body = errorBody(code, message);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/**
 * DOOR-03: is this `Host` one of the loopback names for this door's port?
 * A bare `127.0.0.1`/`localhost` (no port) is tolerated because some clients
 * omit a default port; an arbitrary name is not, even when a DNS answer points
 * it at the loopback address.
 */
function hostAllowed(rawHost: string | undefined, port: number): boolean {
  const value = (rawHost ?? "").trim().toLowerCase();
  if (!value) return false;
  const match = /^([^:]+)(?::(\d+))?$/.exec(value);
  if (!match) return false;
  const name = match[1] ?? "";
  if (!(LOOPBACK_HOST_NAMES as readonly string[]).includes(name)) return false;
  if (match[2] === undefined) return true;
  return Number.parseInt(match[2], 10) === port;
}

/** DOOR-03: an absent Origin is fine (CLI clients); a present one must be this door. */
function originAllowed(rawOrigin: string | undefined, port: number): boolean {
  const value = (rawOrigin ?? "").trim();
  if (!value) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (!(LOOPBACK_HOST_NAMES as readonly string[]).includes(url.hostname.toLowerCase())) return false;
  return Number.parseInt(url.port || "80", 10) === port;
}

/** What the SDK's own rebinding protection is told is allowed (defence in depth). */
function allowedHostHeaders(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, "127.0.0.1", "localhost"];
}

function allowedOriginHeaders(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

type RateWindow = { startedAt: number; count: number };

function newRateWindow(at: number): RateWindow {
  return { startedAt: at, count: 0 };
}

function rateWindowExpired(window: RateWindow, at: number): boolean {
  return at - window.startedAt >= RATE_WINDOW_MS;
}

/** Consume one unit; false when this window is used up. */
function rateTake(window: RateWindow, max: number, at: number): boolean {
  if (rateWindowExpired(window, at)) {
    window.startedAt = at;
    window.count = 0;
  }
  if (window.count >= max) return false;
  window.count += 1;
  return true;
}

function retryAfterSeconds(): string {
  return String(Math.ceil(RATE_WINDOW_MS / 1000));
}

type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "timeout" | "aborted" | "invalid" | "empty" };

/**
 * DOOR-05: read and parse the request body under a byte cap and a time cap, then
 * hand the parsed value to the MCP transport (`handleRequest(req, res, parsedBody)`)
 * so the SDK never gets an unbounded `req.json()`. Every failure writes its own
 * refusal; the caller only has to stop.
 */
function readCappedBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
  timeoutMs: number,
): Promise<BodyResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (value: BodyResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };
    const refuse = (status: number, code: string, message: string): void => {
      // The response goes out FIRST; the socket is torn down when it has been
      // written, so the client reliably sees 413/408 instead of a reset that
      // loses the status line.
      sendRefusal(res, status, code, message, { connection: "close" });
      res.once("finish", () => req.destroy());
      finish({ ok: false, reason: status === 413 ? "too_large" : status === 408 ? "timeout" : "invalid" });
    };

    const declared = Number.parseInt(header(req, "content-length"), 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      refuse(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
      return;
    }

    timer = setTimeout(() => {
      refuse(408, "REQUEST_TIMEOUT", "Request body was not received in time");
    }, timeoutMs);

    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      total += buf.length;
      if (total > maxBytes) {
        refuse(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
        return;
      }
      chunks.push(buf);
    });
    req.on("aborted", () => finish({ ok: false, reason: "aborted" }));
    req.on("error", () => finish({ ok: false, reason: "aborted" }));
    req.on("end", () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        sendRefusal(res, 400, "INVALID_REQUEST", "An MCP request body is required", {
          connection: "close",
        });
        finish({ ok: false, reason: "empty" });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error: Invalid JSON" },
          id: null,
        });
        finish({ ok: false, reason: "invalid" });
        return;
      }
      if (Array.isArray(parsed) && parsed.length > MAX_BATCH_ITEMS) {
        refuse(413, "PAYLOAD_TOO_LARGE", "JSON-RPC batch is too large");
        return;
      }
      finish({ ok: true, value: parsed });
    });
  });
}

function header(req: IncomingMessage, name: string): string {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return typeof raw === "string" ? raw : "";
}

function bearerOf(req: IncomingMessage): string {
  const match = /^Bearer\s+(.*)$/i.exec(header(req, "authorization").trim());
  return match ? (match[1] ?? "").trim() : "";
}

/** Constant-time comparison of two bearer strings (different lengths compare false). */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Whether a presented bearer is an attempt at the companion credential rather
 * than an agent's own key: one string is a prefix of the other, and at least
 * NEAR_MISS_CHARS characters of the companion credential are in it. A bearer
 * shorter than that shares too little to judge, and a real agent key — 43
 * random characters generated by `mintInvite`/`rememberBearer` — shares no such
 * prefix by accident.
 */
function looksLikeCompanion(bearer: string, companion: string): boolean {
  const a = bearer.trim();
  const b = companion.trim();
  if (a.length < NEAR_MISS_CHARS || b.length < NEAR_MISS_CHARS) return false;
  if (a === b) return false;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter);
}

/**
 * A caller the roster has not activated. Its tool list is empty and every
 * tools/call answers with the one tool error, as a successful MCP result.
 *
 * The handlers sit on the underlying Server rather than going through
 * registerTool: a registered tool would appear in tools/list, and this caller
 * must see none.
 */
function gatedServer(code: ToolCode): McpServer {
  const mcp = new McpServer({ name: "lifequest-map", version: "0.1.0" });
  mcp.server.registerCapabilities({ tools: { listChanged: true } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: "text" as const, text: errorBody(code, TOOL_MESSAGES[code]) }],
  }));
  return mcp;
}

function statusToolCode(status: ConnectedAgent["status"]): ToolCode | null {
  if (status === "pending") return "PAIRING_PENDING";
  if (status === "rejected") return "PAIRING_REJECTED";
  if (status === "revoked") return "PAIRING_REVOKED";
  return null;
}

// ── authorization ────────────────────────────────────────────────────────────

type DoorContext = {
  root: string;
  vaultId: string;
  secretsDir: string;
  door: DoorKind;
  now: () => Date;
  /**
   * KAR-70: the desktop's current lens, read per call. Only the
   * companion follows it — a connected agent's view is its grant.
   * The host supplies this in memory; the persisted lens is read on
   * vault open, not per request.
   */
  lens: () => string | null;
  /**
   * DOOR-05: consume one introduction from this door's pairing budget. Called
   * only when the request is about to introduce a new bearer, so a flood of
   * first contacts is answered 429 before it can file Decisions.
   */
  allowIntroduction: () => boolean;
};

type Authorized =
  | { ok: true; kind: "companion" }
  | { ok: true; kind: "agent"; agent: ConnectedAgent };

async function authorize(
  ctx: DoorContext,
  req: IncomingMessage,
): Promise<Authorized | { ok: false; code: AuthCode; message?: string }> {
  const bearer = bearerOf(req);
  if (bearer.length < MIN_BEARER_LENGTH) {
    return { ok: false, code: "AUTH_REQUIRED" };
  }

  // The companion token takes the companion path on either door. A bearer that
  // is merely long enough is never treated as the companion.
  const companion = await companionBearer(ctx.secretsDir, ctx.vaultId);
  if (companion && secretEquals(bearer, companion)) {
    return { ok: true, kind: "companion" };
  }

  // A truncated or padded copy of the companion credential is a transcription
  // mistake, not a new agent, and must not introduce itself. Left alone it files
  // a pairing Decision and parks a roster row that the operator then has to
  // clean up — which is exactly how an agent calling itself "financial" appeared
  // in Personnel on 2026-10-08: the first 24 characters of this vault's own
  // companion token, copied out of a listing that masks the middle, presented
  // with an X-LifeQuest-Name. The full credential works, an agent's own bearer
  // is a different string, and neither of those is refused here.
  if (companion && looksLikeCompanion(bearer, companion)) {
    return { ok: false, code: "AUTH_REQUIRED", message: COMPANION_CREDENTIAL_HINT };
  }

  const known = await resolveBearer(ctx.secretsDir, ctx.vaultId, bearer);
  if (known) {
    // DOOR-11: the secrets map is keyed by a fingerprint derived from the bearer
    // itself. A key that does not derive from this bearer is a corrupt (or
    // collision-forged) entry and must not authorise anything.
    if (fingerprintOf(bearer).slice(0, 12) !== known) {
      console.error("[pairing-door] refused a bearer whose secrets key does not match its own fingerprint");
      return { ok: false, code: "AUTH_REQUIRED" };
    }
    const row = await getConnectedAgentByFingerprint(ctx.root, known);
    if (row.ok && row.value) {
      // A known bearer is never a pairing attempt: no new Decision, and an
      // invite code presented alongside it stays unused.
      return { ok: true, kind: "agent", agent: row.value };
    }
  }

  // A new introduction. On the invite door the code is checked before the
  // name, so an unknown code is reported even when the name is also missing.
  // This check is only a cheap pre-filter; the decision is made again under
  // the secrets lock, which is the one that has to hold.
  let inviteCode: string | null = null;
  if (ctx.door === "invite") {
    const code = header(req, "x-lifequest-invite").trim();
    if (!code) return { ok: false, code: "INVITE_REQUIRED" };
    if (!(await checkInvite(ctx.secretsDir, ctx.vaultId, code, ctx.now))) {
      return { ok: false, code: "INVITE_INVALID" };
    }
    inviteCode = code;
  }

  const name = header(req, "x-lifequest-name").trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    // Nothing is filed, and the code above stays unused: it is only consumed
    // once a new agent actually exists.
    return { ok: false, code: "NAME_REQUIRED" };
  }

  const fingerprint = fingerprintOf(bearer).slice(0, 12);

  // KAR-70: the whole introduction runs inside one secrets lock. Inside it the
  // bearer is re-resolved and the code re-checked, because an overlapping first
  // contact may have introduced this bearer or spent this code while this
  // request was queued. Deciding either outside the lock is what let one code
  // file two agents.
  return withSecretsLock(ctx.secretsDir, ctx.vaultId, async (s) => {
    const at = ctx.now().getTime();

    // Someone else may have introduced this same bearer while we waited. Then it
    // is not a pairing attempt, and the code it presented stays unspent.
    const nowKnown = s.resolveBearer(bearer);
    if (nowKnown) {
      if (fingerprintOf(bearer).slice(0, 12) !== nowKnown) {
        console.error("[pairing-door] refused a bearer whose secrets key does not match its own fingerprint");
        return { ok: false, code: "AUTH_REQUIRED" as const };
      }
      const row = await getConnectedAgentByFingerprint(ctx.root, nowKnown);
      if (row.ok && row.value) {
        return { ok: true, kind: "agent" as const, agent: row.value };
      }
    }

    // The code may have been spent by the other first contact. Nothing is
    // filed, and this caller is told the code is dead rather than that it
    // succeeded.
    if (ctx.door === "invite" && inviteCode && !s.hasInvite(inviteCode, at)) {
      return { ok: false, code: "INVITE_INVALID" as const };
    }

    // DOOR-04: a roster row is vault data, and the vault is not trusted to
    // authorise a caller. This machine's secrets store is the only thing that
    // can say a bearer was accepted here (it is written when an introduction
    // succeeds), and this branch is reached precisely because it did NOT
    // resolve — so a row that already exists at this fingerprint (active,
    // rejected, or revoked) must not hand its grant to this caller. A pending
    // row is fine: it is the normal repeated first contact and authorises
    // nothing. Without this, a crafted/synced `connected-agents.json` could
    // mark an attacker-chosen bearer active+write and the first contact would
    // be served with no operator approval.
    const existing = await getConnectedAgentByFingerprint(ctx.root, fingerprint);
    if (!existing.ok) {
      console.error("[pairing-door] roster could not be read during introduction:", existing.error);
      return { ok: false, code: "AUTH_REQUIRED" as const, message: "Pairing is temporarily unavailable" };
    }
    if (existing.value && existing.value.status !== "pending") {
      console.error(
        `[pairing-door] refused an unbounded introduction: fingerprint ${fingerprint} matches a ${existing.value.status} roster row ${existing.value.id} this machine never paired`,
      );
      return {
        ok: false,
        code: "AUTH_REQUIRED" as const,
        message:
          "This bearer is not paired on this machine; ask the operator to approve a new pairing.",
      };
    }

    // DOOR-05: budget the introduction itself. Checked here, before anything
    // is written, so a flood files no roster rows and spends no invite codes.
    if (!ctx.allowIntroduction()) {
      return { ok: false, code: "RATE_LIMITED" as const };
    }

    const res = await introduceConnectedAgent(ctx.root, {
      name,
      fingerprint,
      door: ctx.door,
    });
    if (!res.ok) {
      // Only a blank name is the caller's to fix. Every other failure is ours,
      // so it is not reported as a name problem — that would send the client
      // away to "fix" a name that was fine — and its detail never reaches the
      // wire, where it could name a filesystem path (DOOR-10).
      if (res.error !== "PAIRING_LIMIT" && res.error !== "name is required") {
        console.error("[pairing-door] introduction failed:", res.error);
      }
      return res.error === "PAIRING_LIMIT"
        ? ({ ok: false, code: "PAIRING_LIMIT" as const })
        : res.error === "name is required"
          ? ({ ok: false, code: "NAME_REQUIRED" as const })
          : ({ ok: false, code: "AUTH_REQUIRED" as const, message: "Pairing is temporarily unavailable" });
    }

    const agent = res.value.agent;

    // From here the introduction exists, so it has to be finished. A failure
    // takes the row and its Decision back out rather than leaving the caller
    // with a 200 over a half-written introduction.
    s.rememberBearer(agent.fingerprint, bearer);
    if (inviteCode && !s.takeInvite(inviteCode, at)) {
      // The code was spendable a moment ago and this lock is the only writer,
      // so a refusal here means the file changed underneath us.
      await rollbackIntroduction(ctx.root, agent.id, res.value.decisionId);
      return {
        ok: false,
        code: "INVITE_INVALID" as const,
        message: "Invite code could not be consumed",
      };
    }

    return { ok: true, kind: "agent" as const, agent };
  });
}

/** Undo a partially completed introduction. */
async function rollbackIntroduction(
  root: string,
  agentId: string,
  decisionId: string,
): Promise<void> {
  await removeConnectedAgent(root, agentId);
  await removeDecision(root, decisionId);
}

// ── the door ─────────────────────────────────────────────────────────────────

type Binding = { server: HttpServer; port: number; error: string | null };

export async function startPairingDoors(opts: {
  root: string;
  vaultId: string;
  secretsDir: string;
  localPort?: number;
  invitePort?: number;
  now?: () => Date;
  /** The desktop's current lens, in memory. Optional: null means overview. */
  lens?: () => string | null;
}): Promise<{
  localPort: number;
  invitePort: number;
  localError: string | null;
  inviteError: string | null;
  close: () => Promise<void>;
  rebind: (root: string, vaultId: string) => void;
  /**
   * When these doors bound, and when the companion last used them. The host
   * gateway connects to the door when IT starts, so a host that started before
   * the door did has already given up and parked; without this the app cannot
   * tell "the host is fine" from "the host never reached us", and an agent
   * session is left with no lifequest tools. `companionSeenAt` is null until the
   * companion authorises once, and both reset on rebind.
   */
  doorsState: () => { boundAt: number; companionSeenAt: number | null };
}> {
  const now = opts.now ?? (() => new Date());
  // Mutable: rebind swaps these, so later requests serve the newly opened
  // vault's root, roster, and companion credential.
  let root = opts.root;
  let vaultId = opts.vaultId;
  const secretsDir = opts.secretsDir;
  let boundAt = now().getTime();
  let companionSeenAt: number | null = null;

  function listen(port: number, kind: DoorKind): Promise<Binding> {
    // Requests only arrive once listen succeeded, so this is the port the Host
    // check must accept; port 0 (a rig's ephemeral bind) is only knowable here.
    let listeningPort = port;
    const failedAuth = newRateWindow(now().getTime());
    const introductions = newRateWindow(now().getTime());
    const httpServer = createServer((req, res) => {
      void handle(req, res, kind, () => listeningPort, failedAuth, introductions);
    });
    // DOOR-05: bound the connection and the time a request may take. The
    // response side is deliberately untouched: a legitimate tools/call may run
    // long, and cutting the stream off would look like a door failure.
    httpServer.headersTimeout = HEADERS_TIMEOUT_MS;
    httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
    httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    httpServer.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
    httpServer.maxConnections = MAX_CONNECTIONS;
    return new Promise<Binding>((resolve) => {
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        // A door that cannot bind keeps its own error and leaves the other
        // listening: the vault still opens and the other door still serves.
        resolve({
          server: httpServer,
          port,
          error:
            err.code === "EADDRINUSE"
              ? portInUseMessage(kind, port)
              : `MCP ${kind} door failed to start: ${err.message}`,
        });
      });
      httpServer.listen(port, MCP_HOST, () => {
        const address = httpServer.address();
        if (address && typeof address === "object") listeningPort = address.port;
        resolve({ server: httpServer, port: listeningPort, error: null });
      });
    });
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    kind: DoorKind,
    portOf: () => number,
    failedAuth: RateWindow,
    introductions: RateWindow,
  ): Promise<void> {
    const port = portOf();
    // DOOR-03: before auth, before the transport. A request addressed to a name
    // that is not this loopback door is the DNS-rebinding shape and gets 403,
    // not an auth error it could use as an oracle.
    if (
      !hostAllowed(header(req, "host"), port) ||
      !originAllowed(header(req, "origin"), port)
    ) {
      sendRefusal(res, 403, "FORBIDDEN", "This door is local to 127.0.0.1");
      return;
    }

    const url = (req.url ?? "").split("?")[0];
    if (req.method !== "POST" || url !== MCP_PATH) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
      return;
    }

    // DOOR-05: presented-but-wrong credentials are budgeted per door, but a
    // *correct* credential is never blocked by other people's failures — the
    // budget is charged on the failure path below, not before authentication, so
    // a flood of guesses cannot lock the companion out of its own door. A
    // request with no Authorization header at all is a health probe/observer (the
    // app's own rigs poll exactly that way) and is not part of a guessing attack.
    const presented = header(req, "authorization").trim() !== "";

    const ctx: DoorContext = {
      root,
      vaultId,
      secretsDir,
      door: kind,
      now,
      lens: opts.lens ?? (() => null),
      allowIntroduction: () =>
        rateTake(introductions, MAX_INTRODUCTIONS_PER_WINDOW, now().getTime()),
    };
    let auth: Awaited<ReturnType<typeof authorize>>;
    try {
      auth = await authorize(ctx, req);
    } catch (e) {
      // The secrets write at the end of the lock can fail. Answer rather than
      // leave the socket open, do not claim the introduction succeeded, and do
      // not put the internal message (which can name a filesystem path) on the
      // wire (DOOR-10).
      console.error("[pairing-door] pairing failed:", e);
      sendRefusal(res, 500, "INTERNAL", "Pairing is temporarily unavailable");
      return;
    }
    if (!auth.ok) {
      // Charge the failure. Over budget, every further failure answers 429 (and
      // is charged no more) until the window rolls over.
      if (presented && !rateTake(failedAuth, MAX_FAILED_AUTH_PER_WINDOW, now().getTime())) {
        sendRefusal(res, 429, "RATE_LIMITED", AUTH_MESSAGES.RATE_LIMITED, {
          "retry-after": retryAfterSeconds(),
        });
        return;
      }
      if (auth.code === "RATE_LIMITED") {
        sendRefusal(res, 429, "RATE_LIMITED", AUTH_MESSAGES.RATE_LIMITED, {
          "retry-after": retryAfterSeconds(),
        });
        return;
      }
      writeAuthFailure(res, auth.code, auth.message);
      return;
    }
    // The door's answer to "has the host actually reached us since we bound".
    if (auth.kind === "companion") companionSeenAt = now().getTime();

    // DOOR-05/SUPP-04: read the body ourselves, capped, and hand the parsed
    // value to the transport so the SDK never reads an unbounded stream.
    const body = await readCappedBody(req, res, MAX_BODY_BYTES, BODY_READ_TIMEOUT_MS);
    if (!body.ok) return;

    const mcp = await buildServer(ctx, auth);
    // DOOR-03 (second layer): the SDK's own rebinding protection, now configured
    // with exactly the loopback names for the port this process bound.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      allowedHosts: allowedHostHeaders(port),
      allowedOrigins: allowedOriginHeaders(port),
      enableDnsRebindingProtection: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    void mcp.connect(transport);
    void transport.handleRequest(req, res, body.value).catch((e) => {
      // An abort mid-stream is a client that left; anything else must not take
      // the main process down as an unhandled rejection.
      console.error("[pairing-door] MCP request failed:", e);
      if (!res.headersSent) sendRefusal(res, 500, "INTERNAL", "The request could not be served");
      else res.end();
    });
  }

  const [local, invite] = await Promise.all([
    listen(opts.localPort ?? LOCAL_MCP_PORT, "local"),
    listen(opts.invitePort ?? INVITE_MCP_PORT, "invite"),
  ]);
  boundAt = now().getTime();

  return {
    localPort: local.port,
    invitePort: invite.port,
    localError: local.error,
    inviteError: invite.error,
    close: async () => {
      await Promise.all([closeServer(local.server), closeServer(invite.server)]);
    },
    rebind: (nextRoot: string, nextVaultId: string) => {
      root = nextRoot;
      vaultId = nextVaultId;
      // A new vault is a new credential and a new question: nothing the previous
      // vault's companion did says anything about this one.
      boundAt = now().getTime();
      companionSeenAt = null;
    },
    doorsState: () => ({ boundAt, companionSeenAt }),
  };
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function portInUseMessage(kind: DoorKind, port: number): string {
  if (kind === "invite") return "MCP invite port is in use.";
  if (port === LOCAL_MCP_PORT) {
    return `MCP port ${LOCAL_MCP_PORT} is in use. Close the other process or quit LifeQuest.`;
  }
  return "MCP local port is in use.";
}

// ── the MCP server for an accepted caller ────────────────────────────────────

async function buildServer(ctx: DoorContext, auth: Authorized): Promise<McpServer> {
  if (auth.kind === "companion") {
    // The same actor executeTool already defaults to. A user actor would drop
    // the companion's document-lock exemption and stop naming Hermes in the
    // life log — a change to today's write rules, which the spec keeps. The
    // companion is pre-paired, so it is never gated and never files a Decision.
    return fullServer(ctx, COMPANION_ACTOR);
  }
  const gated = statusToolCode(auth.agent.status);
  if (gated) return gatedServer(gated);
  // KAR-70: approval grants nothing by itself. The effective grant is the row
  // with any archived domain dropped, read per request so a Personnel edit lands
  // on the next call and an archive closes the grant rather than leaving a
  // dangling assignment. An active agent whose grant is still empty — no
  // assigned domain that is live, and Schedule off — sees an empty tool list and
  // NO_GRANT on every call. It is active, not broken: the operator assigns a
  // domain in Personnel and the next call goes through.
  const grant = await effectiveGrant(ctx.root, auth.agent);
  if (!(await hasLiveGrant(grant))) return gatedServer("NO_GRANT");
  return fullServer(ctx, { type: "agent", id: grant.agentId, name: grant.name }, grant);
}

/**
 * KAR-70: whether this effective grant reaches anything today. Schedule counts
 * on its own. The grant has already had archived domains dropped by
 * effectiveGrant, so this needs no domain read and cannot be answered from a
 * stale registry.
 */
function hasLiveGrant(grant: ConnectedGrant): boolean {
  if (grant.schedule) return true;
  return grant.domainSlugs.length > 0;
}

/**
 * KAR-70: `tools/list` for a connected agent carries only the tools its grant
 * allows, so an agent is never told a tool exists that it may not call. A
 * companion gets the whole list, unchanged.
 *
 * Every tool stays registered, and the list handler filters. That matters: a
 * call to a hidden tool still reaches `executeTool`, which answers it with the
 * grant's own `FORBIDDEN` and writes nothing. Unregistering it instead would
 * hand back a protocol-level "tool not found", which tells the agent the tool
 * does not exist rather than that it may not call it, and is not a code in the
 * grant's vocabulary.
 */
function fullServer(
  ctx: DoorContext,
  actor: VaultActor,
  grant?: ConnectedGrant,
): McpServer {
  const mcp = new McpServer({ name: "lifequest-map", version: "0.1.0" });
  for (const def of ALL_TOOL_DEFS) {
    mcp.registerTool(
      def.name,
      // A loose object, not `{}`. The SDK validates arguments against this
      // schema before the handler sees them, and a plain empty object compiles
      // to a Zod object that strips every key — so a call carrying `year` or
      // `title` would reach executeTool with nothing at all. Looseness keeps
      // the arguments whole; executeTool still validates their shapes and
      // answers MALFORMED itself, which is the vocabulary this door already
      // speaks.
      { description: def.description, inputSchema: z.looseObject({}) },
      async (args) => {
        // Imported here, not at module scope: map-tools reaches Electron's
        // safeStorage through secrets, so a static import would make this file
        // unloadable outside a running app.
        const { executeTool } = await import("./map-tools.ts");
        const result = await executeTool(
          ctx.root,
          // The companion keeps the desktop's lens, as it always has.
          // Passing null here would make `get_doctrine` with no domain
          // return every live domain, which is not the companion's view.
          // A connected agent's lens is its grant, so it stays null.
          grant ? null : ctx.lens(),
          def.name,
          (args ?? {}) as Record<string, unknown>,
          actor,
          grant,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
  if (grant) {
    const allowed = new Set(
      ALL_TOOL_DEFS.filter((def) => toolAllowed(def.name, grant) === "allow").map(
        (def) => def.name,
      ),
    );
    // `parameters` is the vault's own name for the schema; an MCP tool list
    // needs it as `inputSchema`, or a client rejects the whole list. Rebuilding
    // the entry here rather than filtering the registered definitions keeps the
    // two shapes from being confused: the registration stays loose on purpose
    // (see above), and only the advertised schema is strict.
    mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: ALL_TOOL_DEFS.filter((def) => allowed.has(def.name)).map(advertisedTool),
      // SEP-2549: tell caching clients this manifest expires, so a tool set
      // that grew after their first connect is re-probed instead of frozen.
      // The pin/view tools shipped days after local clients cached the list
      // and the companion then swore the tools did not exist. One hour is
      // cheap — listing costs the door nothing — and bounds any future gap.
      ttlMs: TOOL_MANIFEST_TTL_MS,
    }));
    return mcp;
  }
  // The companion sees the whole list, and it sees the REAL argument schemas.
  //
  // This handler used to be installed only for a connected agent, which left
  // the companion reading `inputSchema: { type: "object", properties: {} }` for
  // all 62 tools: the door registered every one of them with `z.looseObject({})`
  // so that arguments would reach `executeTool` whole, and the SDK then
  // advertised that same empty schema. With no property names in front of it,
  // the companion had to invent the shape of every argument — and it invented
  // the same wrong one every time. Six recorded sessions asking for "a weekly
  // summary of expenses on the Dashboard" produced 40+ `preview_view` calls that
  // all passed `spec` as a JSON string and died on `spec must be an object`,
  // because nothing told the model that `spec` was an object with a `groupBy`, a
  // `timeBucket`, and a `timeWindow`. Two of those sessions ended in a runaway
  // repetition loop.
  //
  // So the advertised list is now unconditional. The registration stays loose
  // (arguments still reach `executeTool` whole, which is what the comment above
  // is about); only what the client READS is strict. `ttlMs` rides along for the
  // same reason it does for an agent: the companion's host caches this manifest,
  // and a tool set that grows must be able to reach it.
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: ALL_TOOL_DEFS.map(advertisedTool),
    ttlMs: TOOL_MANIFEST_TTL_MS,
  }));
  return mcp;
}

/**
 * SEP-2549: how long a client may cache the tool manifest. One hour is cheap —
 * listing costs the door nothing — and it bounds the gap between a tool set that
 * grew and a client that connected before it did.
 */
const TOOL_MANIFEST_TTL_MS = 3_600_000;

/**
 * One tool as `tools/list` reports it: the vault's own `parameters` as
 * `inputSchema`, so a client sees the real property names, enums, and required
 * fields instead of an empty object.
 */
function advertisedTool(def: (typeof ALL_TOOL_DEFS)[number]): {
  name: string;
  description: string;
  inputSchema: unknown;
} {
  return { name: def.name, description: def.description, inputSchema: def.parameters };
}

// Re-exported so a caller holding the door handle need not import vault-core
// for the cap the door enforces.
export { PENDING_PAIRING_CAP };