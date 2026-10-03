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
import {
  ALL_TOOL_DEFS,
  fingerprintOf,
  getConnectedAgentByFingerprint,
  introduceConnectedAgent,
  PENDING_PAIRING_CAP,
  type Actor as VaultActor,
  type ConnectedAgent,
} from "@lifequest/vault-core";
import {
  checkInvite,
  companionTokenOf,
  rememberBearer,
  resolveBearer,
  takeInvite,
} from "./pairing-secrets.ts";

export const LOCAL_MCP_PORT = 8643;
export const INVITE_MCP_PORT = 8646;

const MCP_HOST = "127.0.0.1";
const MCP_PATH = "/mcp";
const MIN_BEARER_LENGTH = 22;
const MAX_NAME_LENGTH = 80;

type DoorKind = "local" | "invite";

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

function writeAuthFailure(res: ServerResponse, code: AuthCode): void {
  const body = errorBody(code, AUTH_MESSAGES[code]);
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
};

type Authorized =
  | { ok: true; kind: "companion" }
  | { ok: true; kind: "agent"; agent: ConnectedAgent };

async function authorize(
  ctx: DoorContext,
  req: IncomingMessage,
): Promise<Authorized | { ok: false; code: AuthCode }> {
  const bearer = bearerOf(req);
  if (bearer.length < MIN_BEARER_LENGTH) {
    return { ok: false, code: "AUTH_REQUIRED" };
  }

  // The companion token takes the companion path on either door. A bearer that
  // is merely long enough is never treated as the companion.
  const companion = await companionTokenOf(ctx.secretsDir, ctx.vaultId);
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

  // KAR-70: introductions serialize per secretsDir so two simultaneous first
  // contacts with one bearer create one row and one Decision.
  return serialize(`${ctx.secretsDir}:${ctx.vaultId}`, async () => {
    const fingerprint = fingerprintOf(bearer).slice(0, 12);
    const res = await introduceConnectedAgent(ctx.root, {
      name,
      fingerprint,
      door: ctx.door,
    });
    if (!res.ok) {
      return res.error === "PAIRING_LIMIT"
        ? ({ ok: false, code: "PAIRING_LIMIT" } as const)
        : ({ ok: false, code: "NAME_REQUIRED" } as const);
    }
    const agent = res.value.agent;
    await rememberBearer(ctx.secretsDir, ctx.vaultId, agent.fingerprint, bearer);
    if (inviteCode) {
      await takeInvite(ctx.secretsDir, ctx.vaultId, inviteCode, ctx.now);
    }
    return { ok: true, kind: "agent", agent } as const;
  });
}

/** A promise chain per secretsDir; one introduction at a time. */
const introductionQueues = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = introductionQueues.get(key) ?? Promise.resolve();
  const next = prior.then(work, work);
  introductionQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
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

    const ctx: DoorContext = { root, vaultId, secretsDir, door: kind, now };
    const auth = await authorize(ctx, req);
    if (!auth.ok) {
      writeAuthFailure(res, auth.code);
      return;
    }

    const mcp = buildServer(ctx, auth);
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

function buildServer(ctx: DoorContext, auth: Authorized): McpServer {
  if (auth.kind === "companion") {
    return fullServer(ctx, { type: "user" });
  }
  const gated = statusToolCode(auth.agent.status);
  if (gated) return gatedServer(gated);
  // The connected-agent grant check in front of executeTool lands with the
  // domain-grant task. Until then an active caller gets the vault tool set,
  // acting as its own roster row so the life log names it correctly.
  return fullServer(ctx, {
    type: "agent",
    id: auth.agent.id,
    name: auth.agent.name,
  });
}

function fullServer(ctx: DoorContext, actor: VaultActor): McpServer {
  const mcp = new McpServer({ name: "lifequest-map", version: "0.1.0" });
  for (const def of ALL_TOOL_DEFS) {
    mcp.registerTool(
      def.name,
      { description: def.description, inputSchema: {} },
      async (args) => {
        // Imported here, not at module scope: map-tools reaches Electron's
        // safeStorage through secrets, so a static import would make this file
        // unloadable outside a running app.
        const { executeTool } = await import("./map-tools.ts");
        const result = await executeTool(
          ctx.root,
          null,
          def.name,
          (args ?? {}) as Record<string, unknown>,
          actor,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
  return mcp;
}

// Re-exported so a caller holding the door handle need not import vault-core
// for the cap the door enforces.
export { PENDING_PAIRING_CAP };