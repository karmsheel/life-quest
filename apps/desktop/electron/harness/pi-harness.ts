// The built-in companion.
//
// This is `@earendil-works/pi-agent-core` in the Electron main process: no CLI
// on PATH, no gateway port, no profile. It speaks to the vault through the same
// MCP door the external companion uses, so the write rules, the document lock
// and the Decision fence keep exactly one implementation.
//
// Deliberate limits, recorded here because they are easy to widen by accident:
//   * `pi-coding-agent` is not used. Its default loadout is read/bash/edit/write
//     against a working directory, which is a shell pointed at the operator's
//     machine and cannot be governed by the Decisions rules.
//   * The only tools registered are the ones the MCP door serves. There is no
//     filesystem tool to talk around them.
//   * Credentials come from app userData via `pi-settings`, never from the vault.
import { createHash, randomUUID } from "node:crypto";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  McpClient,
  StreamableHttpTransport,
  toLlmContent,
} from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import { getMcpUrl } from "../mcp-server.ts";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  ChatStreamEvent,
  CompanionModelCatalog,
  TranscriptMessage,
  TurnAttachment,
  TurnUsage,
} from "../companion-client.ts";
import { sanitizeTranscriptRows } from "../companion-client.ts";
import type { AgentHarness } from "./agent-harness.ts";
import {
  isLoopbackEndpoint,
  readPiKey,
  readPiSettings,
  type PiEndpointSettings,
} from "./pi-settings.ts";
import {
  createPiSession,
  deletePiSession,
  listPiSessions,
  piSessionLabel,
  readPiSession,
  writePiSession,
  type PiStoredSession,
} from "./pi-sessions.ts";
import { currentVaultBucket } from "../vault-scope.ts";
import { publishHarnessStatus } from "./status-bus.ts";
import type {
  ChatTurnRequest,
  HarnessAck,
  HarnessResult,
  HarnessSession,
  HarnessStatus,
  SessionPatch,
} from "./types.ts";

const PROVIDER_ID = "pi";
const RUN_TOKEN_HEADER = "authorization";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

let current: HarnessStatus = { kind: "needs_setup" };

function publish(status: HarnessStatus): HarnessStatus {
  current = status;
  // Tagged with this harness, so a late answer steered at the agent the
  // operator has since switched away from is dropped by the renderer rather
  // than shown over the agent now in front.
  return publishHarnessStatus("pi", status);
}

export function piStatus(): HarnessStatus {
  return current;
}

/**
 * The endpoint's own model list.
 *
 * The composer's pills are built from a catalog, so the built-in companion has
 * to answer one too. This is the same `GET /models` every OpenAI-compatible
 * server exposes (OpenAI, OpenRouter, Ollama, LM Studio, vLLM), so a local
 * server needs no configuration beyond its URL.
 */
type ModelProbe = { ok: true; ids: string[] } | { ok: false; auth: boolean; error: string };

async function probeModels(
  settings: PiEndpointSettings,
  key: string | null,
  timeoutMs = 8_000,
): Promise<ModelProbe> {
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers[RUN_TOKEN_HEADER] = `Bearer ${key}`;
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, auth: true, error: `The endpoint rejected the key (${res.status}).` };
    }
    if (!res.ok) return { ok: false, auth: false, error: `The endpoint answered ${res.status}.` };
    const body = (await res.json()) as { data?: unknown };
    const rows = Array.isArray(body.data) ? body.data : [];
    const ids = rows
      .map((row) =>
        row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
          ? (row as { id: string }).id
          : "",
      )
      .filter(Boolean);
    return { ok: true, ids };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, auth: false, error };
  } finally {
    clearTimeout(timer);
  }
}

export async function piEnsure(): Promise<HarnessStatus> {
  const settings = await readPiSettings();
  const key = await readPiKey();
  if (!settings.model) {
    return publish({
      kind: "needs_setup",
      message: "Choose a model for the built-in companion.",
    });
  }
  if (!key && !isLoopbackEndpoint(settings.baseUrl)) {
    return publish({
      kind: "needs_setup",
      message: "Add the API key for this endpoint.",
    });
  }
  const probe = await probeModels(settings, key);
  if (!probe.ok) {
    return publish(probe.auth ? { kind: "auth_error" } : { kind: "disconnected" });
  }
  const missing = probe.ids.length > 0 && !probe.ids.includes(settings.model);
  return publish({
    kind: "ready",
    harness: "pi",
    detail: `Ready · ${settings.providerName} · ${settings.model}`,
    ...(missing
      ? {
          modelWarning: `The companion's model "${settings.model}" is not in this endpoint's model list — every chat will fail until you pick a live model in the chat composer.`,
        }
      : {}),
  });
}

function statusMessage(status: HarnessStatus): string {
  switch (status.kind) {
    case "ready":
      return status.detail;
    case "needs_setup":
      return status.message ?? "The built-in companion needs an endpoint and a model.";
    case "auth_error":
      return "The model endpoint rejected the API key. Update it in Settings › Companion.";
    case "disconnected":
      return "Could not reach the model endpoint. Check the URL and that the server is running.";
    case "needs_install":
      return "The built-in companion is unavailable in this build.";
    default:
      return "The built-in companion is not ready.";
  }
}

// ---------------------------------------------------------------------------
// Model + provider
// ---------------------------------------------------------------------------

function modelFor(
  settings: PiEndpointSettings,
  modelId: string,
): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: settings.baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
  };
}

type Built = {
  models: ReturnType<typeof createModels>;
  model: Model<"openai-completions">;
  key: string | null;
};

async function buildModels(
  settings: PiEndpointSettings,
  modelId: string,
): Promise<Built> {
  const key = await readPiKey();
  const provider = createProvider({
    id: PROVIDER_ID,
    name: settings.providerName,
    baseUrl: settings.baseUrl,
    // Every provider declares auth, even a keyless local one: `resolve` is what
    // tells the library whether this provider is configured at all.
    auth: {
      apiKey: {
        name: `${settings.providerName} key`,
        resolve: async () => {
          if (key) return { auth: { apiKey: key } };
          // A local server ignores the value, but the library refuses to
          // dispatch a request with no key at all. "local" is the placeholder
          // pi's own Ollama example uses.
          return isLoopbackEndpoint(settings.baseUrl)
            ? { auth: { apiKey: "local" } }
            : undefined;
        },
      },
    },
    models: [modelFor(settings, modelId)],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model: modelFor(settings, modelId), key };
}

// ---------------------------------------------------------------------------
// Vault tools, through the MCP door
// ---------------------------------------------------------------------------

type McpBundle = {
  key: string;
  client: McpClient;
  tools: AgentTool<any>[];
};

let mcp: McpBundle | null = null;

async function openVaultToken(): Promise<string | null> {
  try {
    const vault = await import("../vault-service.ts");
    const res = await vault.ensureCurrentCompanionToken();
    return res.ok ? res.value : null;
  } catch {
    return null;
  }
}

function toolSchema(schema: { properties?: Record<string, unknown> }) {
  return Type.Unsafe<Record<string, unknown>>({
    ...(schema as Record<string, unknown>),
    type: "object",
    properties: schema.properties ?? {},
  });
}

/**
 * The door's tools as agent tools.
 *
 * The token is the vault's companion credential, so every write lands in the
 * vault as the companion actor and goes through the same lock and Decision
 * rules as an external companion's write. Nothing here can widen that: a tool
 * the door does not serve is a tool this agent does not have.
 */
async function vaultTools(): Promise<AgentTool<any>[]> {
  const url = getMcpUrl();
  if (!url) return [];
  const token = await openVaultToken();
  if (!token) return [];
  const cacheKey = `${url}|${token}`;
  if (mcp && mcp.key === cacheKey) return mcp.tools;

  const client = new McpClient({ name: "lifequest-companion", version: "0.1.0" });
  const transport = new StreamableHttpTransport({
    url,
    headers: { Authorization: `Bearer ${token}` },
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("MCP connect timed out")), 5_000).unref?.();
  });
  try {
    await Promise.race([client.connect(transport), timeout]);
    const listed = await client.listTools();
    const tools: AgentTool<any>[] = listed.map((tool) => ({
      name: tool.name,
      label: tool.title ?? tool.name,
      description: tool.description ?? tool.name,
      parameters: toolSchema(tool.inputSchema),
      execute: async (_toolCallId, params, signal) => {
        const result = await client.callTool(
          tool.name,
          (params ?? {}) as Record<string, unknown>,
          { signal },
        );
        return {
          content: toLlmContent(result),
          details: undefined,
          isError: result.isError === true,
        };
      },
    }));
    if (mcp) {
      void mcp.client.close().catch(() => {});
    }
    mcp = { key: cacheKey, client, tools };
    return tools;
  } catch {
    void client.close().catch(() => {});
    return [];
  }
}

// ---------------------------------------------------------------------------
// Transcript projection
// ---------------------------------------------------------------------------

type StoredMessage = {
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  usage?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("");
}

function usageOfPi(raw: unknown): TurnUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.round(value)
      : undefined;
  const input = number(u.input);
  const output = number(u.output);
  const total = number(u.totalTokens);
  if (input == null && output == null && total == null) return undefined;
  return {
    ...(input == null ? {} : { input }),
    ...(output == null ? {} : { output }),
    ...(total == null ? {} : { total }),
  };
}

/**
 * The turn's rows, in order, with everything Pi kept: assistant text, thinking,
 * the calls the assistant requested, and the tool results that answered them.
 *
 * This is the same projection both for history and for the live turn's settle
 * snapshot, so a reloaded turn and a just-finished one are built from the same
 * facts. The old version kept text only, which is why tool rows vanished on
 * reload even though `pi-sessions` had stored them all along.
 */
function projectTranscript(messages: unknown[]): TranscriptMessage[] {
  const rows: TranscriptMessage[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as StoredMessage;
    const at = typeof m.timestamp === "number" ? m.timestamp : undefined;
    if (m.role === "user") {
      const content = textOf(m.content);
      if (!content.trim()) continue;
      rows.push({ role: "user", content, ...(at == null ? {} : { at }) });
      continue;
    }
    if (m.role === "assistant") {
      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      const toolCalls: { id: string; name: string; args?: unknown }[] = [];
      for (const rawPart of Array.isArray(m.content) ? m.content : []) {
        if (!rawPart || typeof rawPart !== "object") continue;
        const part = rawPart as {
          type?: unknown;
          text?: unknown;
          thinking?: unknown;
          id?: unknown;
          name?: unknown;
          arguments?: unknown;
        };
        if (part.type === "text" && typeof part.text === "string") textParts.push(part.text);
        else if (part.type === "thinking" && typeof part.thinking === "string") {
          reasoningParts.push(part.thinking);
        } else if (part.type === "toolCall" && typeof part.name === "string") {
          toolCalls.push({
            id: typeof part.id === "string" ? part.id : `call_${toolCalls.length}`,
            name: part.name,
            ...(part.arguments == null ? {} : { args: part.arguments }),
          });
        }
      }
      const content = textParts.join("");
      const reasoning = reasoningParts.join("");
      if (!content.trim() && !reasoning.trim() && toolCalls.length === 0) continue;
      const usage = usageOfPi(m.usage);
      rows.push({
        role: "assistant",
        content,
        ...(at == null ? {} : { at }),
        ...(reasoning.trim() ? { reasoning } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(usage ? { usage } : {}),
      });
      continue;
    }
    if (m.role === "toolResult") {
      const callId = typeof m.toolCallId === "string" ? m.toolCallId : undefined;
      const name = typeof m.toolName === "string" ? m.toolName : undefined;
      rows.push({
        role: "tool",
        content: textOf(m.content),
        ...(at == null ? {} : { at }),
        ...(callId ? { toolCallId: callId } : {}),
        ...(name ? { toolName: name } : {}),
        ...(m.isError === true ? { isError: true } : {}),
      });
    }
  }
  return rows;
}

/** Drop the leading system message: the next turn re-injects a fresh one. */
function persistable(messages: unknown[]): unknown[] {
  return messages.filter(
    (m) => m && typeof m === "object" && (m as { role?: unknown }).role !== "system",
  );
}

function firstUserText(messages: unknown[]): string | null {
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as StoredMessage;
    if (m.role !== "user") continue;
    const line = textOf(m.content).replace(/\s+/g, " ").trim();
    if (line) return line.slice(0, 120);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function toHarnessSession(session: {
  id: string;
  title: string;
  preview: string | null;
  lastActive: number;
  pinned: boolean;
  archived?: boolean;
}): HarnessSession {
  return {
    id: session.id,
    title: session.title,
    preview: session.preview,
    // The dock reads unix seconds.
    lastActive: Math.round(session.lastActive / 1000),
    pinned: session.pinned,
    archived: session.archived === true,
  };
}

async function listSessions(): Promise<HarnessResult<HarnessSession[]>> {
  try {
    const rows = await listPiSessions();
    return { ok: true, value: rows.map(toHarnessSession) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function createSession(title: string): Promise<HarnessResult<HarnessSession>> {
  try {
    // Pinned to the vault that is open now: the chat belongs to it from the
    // first write, whatever the operator does next.
    const session = await createPiSession(title, currentVaultBucket());
    return {
      ok: true,
      value: toHarnessSession({ ...session, preview: null }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sessionMessages(
  id: string,
): Promise<HarnessResult<TranscriptMessage[]>> {
  const session = await readPiSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  return { ok: true, value: sanitizeTranscriptRows(projectTranscript(session.messages)) };
}

async function patchSession(
  id: string,
  patch: SessionPatch,
): Promise<HarnessResult<HarnessSession>> {
  const session = await readPiSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  if (typeof patch.title === "string") session.title = patch.title.trim();
  if (typeof patch.pinned === "boolean") session.pinned = patch.pinned;
  if (typeof patch.archived === "boolean") session.archived = patch.archived;
  await writePiSession(session);
  return {
    ok: true,
    value: toHarnessSession({
      ...session,
      preview: session.preview,
    }),
  };
}

async function deleteSession(
  id: string,
): Promise<HarnessResult<{ id: string; deleted: boolean }>> {
  try {
    const deleted = await deletePiSession(id);
    agents.delete(id);
    return { ok: true, value: { id, deleted } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

type LiveAgent = { agent: Agent; signature: string };
const agents = new Map<string, LiveAgent>();

/**
 * One turn in flight, with the vault bucket it belongs to.
 *
 * The bucket is captured when the turn starts. A vault switch moves the open
 * vault while this run may still be finishing, and the transcript must land in
 * the vault that started the turn — reading the current bucket at write time
 * would file vault A's answer under vault B.
 */
type LiveRun = {
  runId: string;
  sessionId: string;
  agent: Agent;
  aborted: boolean;
  bucket: string;
};
const runs = new Map<string, LiveRun>();

const approvals = new Map<string, (allow: boolean) => void>();

/**
 * One attachment as an inline image part, or null when it cannot be inlined.
 *
 * Only an image with a data URL travels in the content array. A video, an
 * audio file or a plain document has no inline form the providers decode, so
 * it travels as a named path in the instructions instead - `buildInstructions`
 * writes that line from the same attachment list.
 */
function imageOf(attachment?: TurnAttachment | null): ImageContent | null {
  if (!attachment?.dataUrl) return null;
  const match = /^data:([^;]+);base64,(.*)$/.exec(attachment.dataUrl);
  if (!match) return null;
  return { type: "image", mimeType: match[1]!, data: match[2]! };
}

/**
 * Every image this turn carries, receipt first.
 *
 * The library's `prompt(input, images)` takes a LIST of images and sends them
 * as one content array, so several pictures ride one turn. The receipt is an
 * image like any other and comes first, the way the wire puts it first.
 */
function imagesOf(
  receipt?: TurnAttachment | null,
  attachments?: TurnAttachment[] | null,
): ImageContent[] {
  const images: ImageContent[] = [];
  const receiptImage = imageOf(receipt);
  if (receiptImage) images.push(receiptImage);
  for (const attachment of attachments ?? []) {
    const image = imageOf(attachment);
    if (image) images.push(image);
  }
  return images;
}

/**
 * A short fingerprint of the assembled system prompt, for the session cache key.
 *
 * WHY IT IS PART OF THE KEY (reported, not imagined): the cache below used to be
 * keyed on endpoint, model and tool names alone, and a hit only refreshed
 * `agent.state.tools`. The `systemPrompt` state field is read-only — the pi
 * library replays it from the transcript's leading system message — so a prompt
 * that changed between two turns (the active area, the board lock, the
 * onboarding rubric) was silently dropped for any chat that had already run
 * once. The operator's first-run interview paragraph is exactly that kind of
 * prompt change: it appears when the record moves to `not_started`, and it must
 * reach a chat that is already open, not only a fresh one.
 *
 * Hashing rather than embedding the prompt keeps the key small; a hash collision
 * would only mean one stale prompt, which is shorter-lived than the session and
 * disappears on the next prompt change.
 */
function promptFingerprint(prompt: string): string {
  return createHash("sha1").update(prompt).digest("base64url").slice(0, 22);
}

async function agentFor(
  session: PiStoredSession,
  settings: PiEndpointSettings,
  modelId: string,
  signature: string,
  tools: AgentTool<any>[],
  systemPrompt: string,
): Promise<{ agent: Agent; built: Built }> {
  const cached = agents.get(session.id);
  if (cached && cached.signature === signature) {
    cached.agent.state.tools = tools;
    return { agent: cached.agent, built: await buildModels(settings, modelId) };
  }
  const built = await buildModels(settings, modelId);
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: built.model,
      tools,
      messages: session.messages as never[],
    },
    streamFn: built.models.streamSimple.bind(built.models),
    sessionId: session.id,
    getApiKey: () => built.key ?? undefined,
  });
  agents.set(session.id, { agent, signature });
  return { agent, built };
}

async function chatStream(
  request: ChatTurnRequest,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<HarnessAck> {
  // The turn belongs to the vault that is open when it starts, and it keeps
  // that vault even if the operator switches away before the answer settles.
  const bucket = currentVaultBucket();
  const settings = await readPiSettings();
  const modelId = request.runtime?.model?.trim() || settings.model;
  if (!modelId) {
    return { ok: false, error: statusMessage(await piEnsure()) };
  }
  let session = await readPiSession(request.sessionId);
  if (!session) session = await createPiSession("", bucket);

  const tools = await vaultTools();
  // The attachments have to reach the PROMPT, not only the content array: an
  // image the model can see and a file the agent must read with its own tools
  // are described by the same instruction block, and only the image is
  // inlined. The receipt keeps its own wording on its own field.
  const instructionsContext = request.instructionsContext
    ? {
        ...request.instructionsContext,
        ...(request.attachments && request.attachments.length > 0
          ? { attachments: request.attachments }
          : {}),
      }
    : null;
  const systemPrompt = instructionsContext
    ? (await import("../companion-client.ts")).buildInstructions(
        instructionsContext,
        "pi",
      )
    : "";
  // The prompt is part of the signature, not just the tool list: a changed
  // prompt has to rebuild the agent, because `state.systemPrompt` is read-only
  // and a cache hit would otherwise keep replaying the old one (see
  // `promptFingerprint`).
  const signature = `${settings.baseUrl}|${modelId}|${tools.length}|${tools.map((t) => t.name).join(",")}|${promptFingerprint(systemPrompt)}`;
  const { agent } = await agentFor(session, settings, modelId, signature, tools, systemPrompt);

  const runId = randomUUID();
  const live: LiveRun = { runId, sessionId: session.id, agent, aborted: false, bucket };
  runs.set(runId, live);
  onEvent({ type: "run.started", runId });
  // Everything appended from here on is this turn's own transcript, which is
  // the authoritative snapshot the renderer settles against.
  const turnStartIndex = agent.state.messages.length;

  let failure: string | null = null;
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "message_update") {
      const delta = event.assistantMessageEvent;
      if (delta?.type === "text_delta" && typeof delta.delta === "string") {
        onEvent({ type: "assistant.delta", text: delta.delta });
      } else if (delta?.type === "thinking_delta" && typeof delta.delta === "string") {
        // Real reasoning deltas, not a preview: Pi streams the model's thinking
        // when the provider exposes it and reports nothing when it does not.
        onEvent({ type: "reasoning.delta", text: delta.delta });
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      const args = boundedArgs(event.args);
      onEvent({
        type: "tool.started",
        name: event.toolName,
        target: targetLine(event.args),
        callId: event.toolCallId,
        ...(args === undefined ? {} : { args }),
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      // The vault tools do not stream partial output today, but a tool that
      // does (or a future one) gets its progress shown without another mapping.
      const text = resultText(event.partialResult);
      if (event.toolCallId && text.trim()) {
        onEvent({ type: "tool.progress", callId: event.toolCallId, text: clipText(text, RESULT_PREVIEW_MAX) });
      }
      return;
    }
    if (event.type === "tool_execution_end") {
      onEvent({
        type: "tool.completed",
        name: event.toolName,
        callId: event.toolCallId,
        isError: event.isError,
        ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
        ...(resultText(event.result).trim()
          ? { resultPreview: clipText(resultText(event.result), RESULT_PREVIEW_MAX) }
          : {}),
      });
    }
  });

  // Every picture this turn carries rides ONE content array: the receipt
  // first, then the general attachments. The library takes a list of images
  // and sends them alongside the text, so several pictures ride one turn.
  const images = imagesOf(request.attachment, request.attachments);
  try {
    await agent.prompt(request.input, images.length > 0 ? images : undefined);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  } finally {
    unsubscribe();
    runs.delete(runId);
  }

  const messages = persistable(agent.state.messages);
  const preview = firstUserText(messages) ?? session.preview;
  try {
    await writePiSession(
      {
        ...session,
        messages,
        preview,
        lastActive: Date.now(),
      },
      // The run's own bucket, not whatever is open now: a turn that outlives a
      // vault switch still settles into the vault it started in. This is also
      // the settle write for a stopped or failed run.
      live.bucket,
    );
  } catch {
    // A transcript we cannot persist is a lost resume, not a failed turn.
  }

  // The turn's authoritative facts, from the transcript the agent just wrote.
  const turnMessages = agent.state.messages.slice(turnStartIndex);
  const snapshot = projectTranscript(turnMessages);
  const lastAssistant = [...turnMessages]
    .reverse()
    .find((message) => (message as { role?: unknown } | null)?.role === "assistant") as
    | StoredMessage
    | undefined;
  const finalText = finalTextOf(lastAssistant);
  // A turn can span several model calls (one per step). The footer is the
  // TURN's accounting, so sum every assistant message's usage rather than
  // reporting only the last step's.
  const usage = sumUsage(turnMessages);
  const stopReason = typeof lastAssistant?.stopReason === "string" ? lastAssistant.stopReason : undefined;
  if (finalText.trim()) onEvent({ type: "assistant.final", text: finalText });
  if (usage) onEvent({ type: "usage", usage });

  if (failure) {
    onEvent({ type: "error", message: failure });
    onEvent({ type: "run.incomplete", reason: failure, ...(usage ? { usage } : {}), ...(snapshot.length > 0 ? { snapshot } : {}) });
  } else if (live.aborted) {
    onEvent({ type: "run.stopped", ...(usage ? { usage } : {}), ...(snapshot.length > 0 ? { snapshot } : {}) });
  } else if (stopReason === "length") {
    // The model ran out of output budget: the reply is a prefix, not an answer.
    onEvent({
      type: "run.incomplete",
      reason: "the model reached its output limit before finishing",
      ...(usage ? { usage } : {}),
      ...(snapshot.length > 0 ? { snapshot } : {}),
    });
  } else if (stopReason === "error") {
    onEvent({
      type: "run.incomplete",
      reason: typeof lastAssistant?.errorMessage === "string" && lastAssistant.errorMessage.trim()
        ? lastAssistant.errorMessage
        : "the model ended the turn with an error",
      ...(usage ? { usage } : {}),
      ...(snapshot.length > 0 ? { snapshot } : {}),
    });
  } else {
    onEvent({
      type: "run.completed",
      ...(usage ? { usage } : {}),
      ...(stopReason ? { stopReason } : {}),
      ...(snapshot.length > 0 ? { snapshot } : {}),
    });
  }
  return failure ? { ok: false, error: failure } : { ok: true };
}

function sumUsage(messages: unknown[]): TurnUsage | undefined {
  let input = 0;
  let output = 0;
  let total = 0;
  let seen = false;
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as StoredMessage;
    if (m.role !== "assistant") continue;
    const usage = usageOfPi(m.usage);
    if (!usage) continue;
    seen = true;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    total += usage.total ?? (usage.input ?? 0) + (usage.output ?? 0);
  }
  return seen ? { input, output, total } : undefined;
}

/** The visible answer: assistant text blocks only, never the thinking blocks. */
function finalTextOf(m: StoredMessage | undefined): string {
  const parts: string[] = [];
  for (const rawPart of Array.isArray(m?.content) ? m.content : []) {
    if (!rawPart || typeof rawPart !== "object") continue;
    const part = rawPart as { type?: unknown; text?: unknown };
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("");
}

const ARGS_MAX_BYTES = 2048;
const RESULT_PREVIEW_MAX = 500;

/**
 * Arguments as the row may show them: bounded before they cross IPC. A raw Pi
 * call can carry a whole file; the panel needs enough to name the call, not a
 * copy of the vault. Over-long args degrade to a clipped string.
 */
function boundedArgs(args: unknown): unknown {
  if (args == null) return undefined;
  try {
    const raw = JSON.stringify(args);
    if (!raw) return undefined;
    return raw.length <= ARGS_MAX_BYTES ? (JSON.parse(raw) as unknown) : `${raw.slice(0, ARGS_MAX_BYTES)}…`;
  } catch {
    return undefined;
  }
}

/** Tool result text, whichever shape the tool returned it in. */
function resultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  return textOf((result as { content?: unknown }).content);
}

function clipText(text: string, max: number): string {
  const flat = text.replace(/\r\n/g, "\n").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One bounded line naming what a call acted on, the same shape the Hermes row uses. */
function targetLine(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const bag = args as Record<string, unknown>;
  for (const key of ["path", "query", "url", "name", "goal", "databaseId", "viewId"]) {
    const value = bag[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const line = value.split("\n")[0]!.replace(/\s+/g, " ").trim();
    return line.length > 48 ? `${line.slice(0, 47)}…` : line;
  }
  return "";
}

async function stopRun(runId: string): Promise<HarnessAck> {
  const run = runs.get(runId);
  if (!run) return { ok: true };
  run.aborted = true;
  run.agent.abort();
  return { ok: true };
}

/**
 * Steer the turn that is already running.
 *
 * The agent loop takes the guidance through `Agent.steer`, which queues a
 * message for the loop to pick up at its next drain point - the same moment
 * the tool calls of the current assistant turn have finished. Nothing is
 * cancelled, so the work already done is kept and the agent simply changes
 * course.
 *
 * The queued message is the library's own user message shape: `steer` takes
 * an `AgentMessage`, and the library builds one from a plain string exactly
 * this way (`normalizePromptInput`), so this is the same message a normal
 * turn sends - the operator's words as the user, with a timestamp.
 *
 * A run that is gone is the same dead end the gateway reports as 404: the
 * operator's words went nowhere, and they are told so in the same sentence
 * they would have seen from Hermes.
 */
async function steerRun(runId: string, text: string): Promise<HarnessAck> {
  const run = runs.get(runId);
  if (!run) {
    return {
      ok: false,
      error: "That turn is no longer running, so the message could not be steered into it.",
    };
  }
  const steerText = typeof text === "string" ? text.trim() : "";
  if (!steerText) {
    return { ok: false, error: "Type what you want the agent to do instead." };
  }
  run.agent.steer({
    role: "user",
    content: [{ type: "text", text: steerText }],
    timestamp: Date.now(),
  });
  return { ok: true };
}

async function approve(
  _runId: string,
  requestId: string,
  allow: boolean,
): Promise<HarnessAck> {
  const resolve = approvals.get(requestId);
  if (resolve) {
    approvals.delete(requestId);
    resolve(allow);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

async function modelCatalog(): Promise<HarnessResult<CompanionModelCatalog>> {
  const settings = await readPiSettings();
  const key = await readPiKey();
  const probe = await probeModels(settings, key, 4_000);
  const ids = probe.ok && probe.ids.length > 0 ? probe.ids : settings.model ? [settings.model] : [];
  if (ids.length === 0) {
    return { ok: false, error: "The endpoint listed no models" };
  }
  return {
    ok: true,
    value: {
      providers: [
        {
          slug: PROVIDER_ID,
          name: settings.providerName,
          authenticated: Boolean(key) || isLoopbackEndpoint(settings.baseUrl),
          models: ids.map((id) => ({
            id,
            // No thinking-level mapping yet: a control that lies is worse than
            // no control.
            reasoning: false,
            canDisableReasoning: false,
            fast: false,
          })),
        },
      ],
      current: { model: settings.model || ids[0]!, provider: PROVIDER_ID },
    },
  };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

export const piHarness: AgentHarness = {
  id: "pi",
  displayName: "Pi",
  kind: "embedded",
  ensure: piEnsure,
  status: piStatus,
  statusMessage,
  async shutdown() {
    for (const run of runs.values()) run.agent.abort();
    runs.clear();
    agents.clear();
    if (mcp) {
      const client = mcp.client;
      mcp = null;
      await client.close().catch(() => {});
    }
  },
  listSessions,
  createSession,
  sessionMessages,
  patchSession,
  deleteSession,
  async openSession() {
    const status = await piEnsure();
    return status.kind === "ready"
      ? { ok: true }
      : { ok: false, error: statusMessage(status) };
  },
  modelCatalog,
  chatStream,
  approve,
  stopRun,
  steerRun,
};

// Re-exported for the Settings surface, which needs to write an endpoint without
// knowing how the harness stores it.
export { piSessionLabel };
