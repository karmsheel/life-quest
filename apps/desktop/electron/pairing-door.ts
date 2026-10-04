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

type DoorKind = "local" | "invite";

/** KAR-70: the actor the live MCP door already acts as. Not a new one. */
const COMPANION_ACTOR: VaultActor = { type: "agent", id: "companion", name: "Hermes" };

type AuthCode =
  | "AUTH_REQUIRED"
  | "NAME_REQUIRED"
  | "INVITE_REQUIRED"
  | "INVITE_INVALID"
  | "PAIRING_LIMIT";

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
};

const AUTH_STATUS: Record<AuthCode, number> = {
  AUTH_REQUIRED: 401,
  NAME_REQUIRED: 401,
  INVITE_REQUIRED: 401,
  INVITE_INVALID: 401,
  PAIRING_LIMIT: 429,
};

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
  const body = errorBody(code, message ?? AUTH_MESSAGES[code]);
  res.writeHead(AUTH_STATUS[code], {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
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
  if (companion && bearer === companion) {
    return { ok: true, kind: "companion" };
  }

  const known = await resolveBearer(ctx.secretsDir, ctx.vaultId, bearer);
  if (known) {
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

    const res = await introduceConnectedAgent(ctx.root, {
      name,
      fingerprint,
      door: ctx.door,
    });
    if (!res.ok) {
      // Only a blank name is the caller's to fix. Every other failure is ours,
      // so it is not reported as a name problem — that would send the client
      // away to "fix" a name that was fine.
      return res.error === "PAIRING_LIMIT"
        ? ({ ok: false, code: "PAIRING_LIMIT" as const })
        : res.error === "name is required"
          ? ({ ok: false, code: "NAME_REQUIRED" as const })
          : ({ ok: false, code: "AUTH_REQUIRED" as const, message: res.error });
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
}> {
  const now = opts.now ?? (() => new Date());
  // Mutable: rebind swaps these, so later requests serve the newly opened
  // vault's root, roster, and companion credential.
  let root = opts.root;
  let vaultId = opts.vaultId;
  const secretsDir = opts.secretsDir;

  function listen(port: number, kind: DoorKind): Promise<Binding> {
    const httpServer = createServer((req, res) => {
      void handle(req, res, kind);
    });
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
        resolve({ server: httpServer, port, error: null });
      });
    });
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    kind: DoorKind,
  ): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
    if (req.method !== "POST" || url !== MCP_PATH) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
      return;
    }

    const ctx: DoorContext = {
      root,
      vaultId,
      secretsDir,
      door: kind,
      now,
      lens: opts.lens ?? (() => null),
    };
    let auth: Awaited<ReturnType<typeof authorize>>;
    try {
      auth = await authorize(ctx, req);
    } catch (e) {
      // The secrets write at the end of the lock can fail. Answer rather than
      // leave the socket open, and do not claim the introduction succeeded.
      sendJson(res, 500, {
        error: {
          code: "INTERNAL",
          message: `Pairing failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      });
      return;
    }
    if (!auth.ok) {
      writeAuthFailure(res, auth.code, auth.message);
      return;
    }

    const mcp = await buildServer(ctx, auth);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    void mcp.connect(transport);
    void transport.handleRequest(req, res);
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
  }

  const [local, invite] = await Promise.all([
    listen(opts.localPort ?? LOCAL_MCP_PORT, "local"),
    listen(opts.invitePort ?? INVITE_MCP_PORT, "invite"),
  ]);

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
    },
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
      tools: ALL_TOOL_DEFS.filter((def) => allowed.has(def.name)).map((def) => ({
        name: def.name,
        description: def.description,
        inputSchema: def.parameters,
      })),
    }));
  }
  return mcp;
}

// Re-exported so a caller holding the door handle need not import vault-core
// for the cap the door enforces.
export { PENDING_PAIRING_CAP };