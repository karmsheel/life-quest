import type { Result } from "@lifequest/vault-core";

const DEFAULT_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 6_000;

const SCAN_PATHS = ["/v1/agents", "/agents", "/v1/profiles"] as const;

export async function hermesFetchWithConfig(
  baseUrl: string,
  apiKey: string,
  requestPath: string,
  init: RequestInit = {},
): Promise<Response> {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`;
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

export async function hermesTest(
  baseUrl: string,
  apiKey: string,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<Result<{ latencyMs: number; baseUrl: string }>> {
  const normalized = baseUrl.replace(/\/$/, "") || baseUrl;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Prefer /health; fall back to base URL if health is missing.
    let res: Response;
    try {
      res = await hermesFetchWithConfig(normalized, apiKey, "/health", {
        method: "GET",
        signal: controller.signal,
      });
    } catch {
      res = await fetch(normalized, {
        method: "GET",
        signal: controller.signal,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      });
    }
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        error: `Hermes health returned ${res.status}. Is the gateway running?`,
      };
    }
    return { ok: true, value: { latencyMs, baseUrl: normalized } };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "Connection timed out. Is Hermes gateway running?"
        : err instanceof Error
          ? err.message
          : "Could not reach Hermes gateway.",
    };
  }
}

export async function hermesChat(
  baseUrl: string,
  apiKey: string,
  messages: { role: string; content: string }[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Result<{ content: string }>> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      ok: false,
      error: "messages must be a non-empty array of { role, content }",
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await hermesFetchWithConfig(
      baseUrl,
      apiKey,
      "/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          model: "default",
          messages,
          stream: false,
        }),
      },
    );
    clearTimeout(timer);

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).trim();
      } catch {
        detail = "";
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: detail || "Hermes rejected the API key.",
        };
      }
      return {
        ok: false,
        error:
          detail ||
          `Hermes chat failed (${res.status}). Is the gateway running?`,
      };
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { ok: false, error: "Hermes returned non-JSON chat response" };
    }

    const content = extractChatContent(data);
    if (content === null) {
      return { ok: false, error: "Hermes chat response missing content" };
    }
    return { ok: true, value: { content } };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "Chat request timed out."
        : err instanceof Error
          ? err.message
          : "Could not reach Hermes gateway.",
    };
  }
}

function extractChatContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === "string" ? content : null;
}

export type HermesChatToolStep =
  | { type: "text"; content: string }
  | { type: "tool"; id: string; name: string; args: unknown; raw: unknown };

export async function hermesChatWithTools(
  baseUrl: string,
  apiKey: string,
  messages: unknown[],
  tools: unknown[],
  timeoutMs = 60_000,
): Promise<Result<HermesChatToolStep>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await hermesFetchWithConfig(baseUrl, apiKey, "/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        model: "default",
        messages,
        tools,
        stream: false,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).trim();
      return {
        ok: false,
        error: detail || `Hermes chat failed (${res.status}).`,
      };
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }[];
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall && toolCall.type === "function") {
      let args: unknown = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = {};
      }
      return {
        ok: true,
        value: {
          type: "tool",
          id: toolCall.id,
          name: toolCall.function.name,
          args,
          raw: message,
        },
      };
    }
    const content = extractChatContent(data);
    if (content === null) {
      return { ok: false, error: "Hermes chat response missing content" };
    }
    return { ok: true, value: { type: "text", content } };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Chat request timed out." : err instanceof Error ? err.message : "Could not reach Hermes.",
    };
  }
}

export async function hermesScanAgents(
  baseUrl: string,
  apiKey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Result<{ id: string; name: string }[]>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tried: string[] = [];

  try {
    for (const scanPath of SCAN_PATHS) {
      tried.push(scanPath);
      try {
        const res = await hermesFetchWithConfig(baseUrl, apiKey, scanPath, {
          method: "GET",
          signal: controller.signal,
        });
        if (!res.ok) continue;
        let payload: unknown;
        try {
          payload = await res.json();
        } catch {
          continue;
        }
        const agents = normalizeScannedAgents(payload);
        // Empty list on agent/profile endpoints still counts as success.
        clearTimeout(timer);
        return { ok: true, value: agents };
      } catch {
        continue;
      }
    }
    clearTimeout(timer);
    return {
      ok: false,
      error:
        "Hermes is reachable but no agent/profile list endpoint returned data. Tried: " +
        tried.join(", "),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeScannedAgents(
  payload: unknown,
): { id: string; name: string }[] {
  const items = extractList(payload);
  const agents: { id: string; name: string }[] = [];
  const seen = new Set<string>();

  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = firstString(row, [
      "id",
      "agent_id",
      "agentId",
      "profileKey",
      "profile_key",
      "name",
      "model",
    ]);
    if (!id || seen.has(id)) continue;
    const name =
      firstString(row, [
        "name",
        "displayName",
        "display_name",
        "label",
        "title",
        "id",
        "model",
      ]) ?? id;
    seen.add(id);
    agents.push({ id, name });
  }
  return agents;
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "agents", "profiles", "models", "items", "results"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

function firstString(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
