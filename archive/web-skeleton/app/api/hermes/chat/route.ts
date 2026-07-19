import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import {
  getHermesConfig,
  hermesFetchWithConfig,
  resolveChatCredentials,
} from "@/lib/hermes.ts";

type ChatMessage = {
  role: string;
  content: string;
};

type ChatBody = {
  messages?: unknown;
  model?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
};

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.role !== "string" || !rec.role.trim()) return null;
    if (typeof rec.content !== "string") return null;
    out.push({ role: rec.role.trim(), content: rec.content });
  }
  return out;
}

/**
 * Proxy OpenAI-compatible chat completions to the user's Hermes gateway.
 * Skeleton: non-streaming only; no tools / no pillar injection.
 * Prefers body baseUrl/apiKey over DB-stored credentials.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const messages = parseMessages(body.messages);
  if (!messages) {
    return jsonError(
      "messages must be a non-empty array of { role, content }",
      400,
    );
  }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "default";

  const stored = await getHermesConfig(user.id);
  const creds = resolveChatCredentials({
    bodyBaseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    bodyApiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    stored,
  });
  if (!creds) {
    return jsonError(
      "Hermes is not configured. Connect on the startup screen or Settings → Hermes.",
      400,
    );
  }

  let res: Response;
  try {
    res = await hermesFetchWithConfig(
      creds.baseUrl,
      creds.apiKey,
      "/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
      },
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not reach Hermes gateway.";
    return jsonError(
      message.includes("fetch") || message.includes("ECONNREFUSED")
        ? "Hermes gateway is unreachable. Check Settings → Hermes and that the gateway is running."
        : message,
      502,
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const raw = (await res.text()).trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as {
            error?: string | { message?: string };
            message?: string;
          };
          if (typeof parsed.error === "string") {
            detail = parsed.error;
          } else if (
            parsed.error &&
            typeof parsed.error === "object" &&
            typeof parsed.error.message === "string"
          ) {
            detail = parsed.error.message;
          } else if (typeof parsed.message === "string") {
            detail = parsed.message;
          } else {
            detail = raw;
          }
        } catch {
          detail = raw;
        }
      }
    } catch {
      detail = "";
    }
    if (res.status === 401 || res.status === 403) {
      return jsonError(
        detail ||
          "Hermes rejected the API key. Update Settings → Hermes.",
        502,
      );
    }
    // Auth-ish failures sometimes arrive as 400/502 with invalid_api_key text.
    if (/api key|unauthorized|authentication/i.test(detail)) {
      return jsonError(
        detail || "Hermes rejected the API key. Update Settings → Hermes.",
        502,
      );
    }
    return jsonError(
      detail ||
        `Hermes chat failed (${res.status}). Is the gateway running?`,
      502,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return jsonError("Hermes returned non-JSON chat response", 502);
  }

  return jsonOk(data);
}
