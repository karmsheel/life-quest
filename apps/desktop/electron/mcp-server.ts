import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z, type ZodTypeAny } from "zod";
import {
  GOALS_TOOL_DEFS,
  MAP_TOOL_DEFS,
  DOCUMENT_TOOL_DEFS,
  REVIEW_TOOL_DEFS,
  CAPTURE_TOOL_DEFS,
  SCRIPT_TOOL_DEFS,
  type MapToolDef,
  type Result,
} from "@lifequest/vault-core";
import { executeTool } from "./map-tools.js";

const MCP_HOST = "127.0.0.1";
const MCP_PORT = 8643;
const MCP_PATH = "/mcp";

let server: Server | null = null;
let mcpRoot: string | null = null;
let mcpVaultId: string | null = null;
let getActiveSlug: () => string | null = () => null;

function toZod(prop: unknown): ZodTypeAny {
  const p = prop as {
    type?: string | string[];
    enum?: unknown[];
    items?: unknown;
    properties?: Record<string, unknown>;
  };
  if (Array.isArray(p.enum)) {
    const vals = p.enum;
    if (vals.length > 0 && vals.every((v) => typeof v === "string")) {
      return z.enum(vals as [string, ...string[]]);
    }
    const literals = vals.filter(
      (v): v is string | number | boolean | bigint | null =>
        v === null ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        typeof v === "bigint",
    );
    if (literals.length === 0) return z.unknown();
    if (literals.length === 1) return z.literal(literals[0]);
    const [first, second, ...rest] = literals.map((v) => z.literal(v));
    return z.union([first, second, ...rest]);
  }
  if (Array.isArray(p.type)) {
    const nonNull = p.type.filter((t) => t !== "null");
    if (nonNull.length === 1) {
      return z.nullable(toZod({ ...p, type: nonNull[0] }));
    }
    return z.nullable(z.unknown());
  }
  switch (p.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(p.items ? toZod(p.items) : z.unknown());
    case "object":
      return z.object(buildShape(p.properties ?? {}));
    default:
      return z.unknown();
  }
}

function buildShape(properties: Record<string, unknown>): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, value] of Object.entries(properties)) {
    shape[key] = toZod(value).optional();
  }
  return shape;
}

function registerTools(mcp: McpServer): void {
  for (const def of [...MAP_TOOL_DEFS, ...GOALS_TOOL_DEFS, ...DOCUMENT_TOOL_DEFS, ...REVIEW_TOOL_DEFS, ...CAPTURE_TOOL_DEFS, ...SCRIPT_TOOL_DEFS]) {
    const toolDef = def as MapToolDef;
    const inputSchema = buildShape(toolDef.parameters.properties ?? {});
    mcp.registerTool(
      toolDef.name,
      { description: toolDef.description, inputSchema },
      async (toolArgs) => {
        const activeSlug = getActiveSlug();
        const result = await executeTool(mcpRoot as string, activeSlug, toolDef.name, toolArgs as Record<string, unknown>);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const mcp = new McpServer({ name: "lifequest-map", version: "0.1.0" });
  registerTools(mcp);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  void mcp.connect(transport);
  void transport.handleRequest(req, res);
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
}

export async function startMcp(
  rootPath: string,
  vaultId: string,
  getLens: () => string | null = () => null,
): Promise<Result<{ url: string }>> {
  getActiveSlug = getLens;
  if (server) return { ok: true, value: { url: `http://${MCP_HOST}:${MCP_PORT}${MCP_PATH}` } };
  mcpRoot = rootPath;
  mcpVaultId = vaultId;
  const httpServer = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.split("?")[0].endsWith(MCP_PATH)) {
      handleRequest(req, res);
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  });
  return new Promise<Result<{ url: string }>>((resolve) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({
          ok: false,
          error: "MCP port 8643 is in use. Close the other process or quit LifeQuest.",
        });
        return;
      }
      resolve({ ok: false, error: `MCP server failed to start: ${err.message}` });
    });
    httpServer.listen(MCP_PORT, MCP_HOST, () => {
      server = httpServer;
      resolve({ ok: true, value: { url: `http://${MCP_HOST}:${MCP_PORT}${MCP_PATH}` } });
    });
  });
}

export async function stopMcp(): Promise<void> {
  if (!server) {
    mcpRoot = null;
    mcpVaultId = null;
    return;
  }
  const current = server;
  server = null;
  mcpRoot = null;
  mcpVaultId = null;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}
