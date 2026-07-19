import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { DEFAULT_HERMES_URL } from "@/lib/constants.ts";
import {
  getHermesConfig,
  maskApiKey,
  probeHermesHealth,
  upsertHermesConfig,
} from "@/lib/hermes.ts";

function publicConfig(cfg: { baseUrl: string; apiKey: string }) {
  return {
    baseUrl: cfg.baseUrl || DEFAULT_HERMES_URL,
    apiKey: maskApiKey(cfg.apiKey),
    hasApiKey: Boolean(cfg.apiKey),
  };
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const cfg = await getHermesConfig(user.id);
  const url = new URL(request.url);
  const test = url.searchParams.get("test") === "1";

  if (test) {
    const probe = await probeHermesHealth(user.id);
    return jsonOk({
      ...publicConfig(cfg),
      probe,
    });
  }

  return jsonOk(publicConfig(cfg));
}

type PutBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
};

export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const data: { baseUrl?: string; apiKey?: string } = {};

  if (body.baseUrl !== undefined) {
    if (typeof body.baseUrl !== "string" || !body.baseUrl.trim()) {
      return jsonError("baseUrl must be a non-empty string", 400);
    }
    const baseUrl = body.baseUrl.trim().replace(/\/$/, "");
    try {
      const parsed = new URL(baseUrl);
      if (!parsed.protocol.startsWith("http")) {
        return jsonError("baseUrl must be an http(s) URL", 400);
      }
    } catch {
      return jsonError("baseUrl must be a valid URL", 400);
    }
    data.baseUrl = baseUrl;
  }

  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== "string") {
      return jsonError("apiKey must be a string", 400);
    }
    // Allow empty string to clear; ignore masked placeholder from clients.
    if (body.apiKey === "***") {
      // no-op for apiKey
    } else {
      data.apiKey = body.apiKey;
    }
  }

  if (data.baseUrl === undefined && data.apiKey === undefined) {
    return jsonError("No settings to update", 400);
  }

  await upsertHermesConfig(user.id, data);
  const cfg = await getHermesConfig(user.id);

  const url = new URL(request.url);
  const test = url.searchParams.get("test") === "1";
  if (test) {
    const probe = await probeHermesHealth(user.id);
    return jsonOk({
      ...publicConfig(cfg),
      probe,
    });
  }

  return jsonOk(publicConfig(cfg));
}

/** Optional POST body { test: true } or empty — runs connection probe with saved config. */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  // Allow optional body updates then test, or pure test.
  let body: PutBody & { test?: unknown } = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as PutBody & { test?: unknown };
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
  }

  const data: { baseUrl?: string; apiKey?: string } = {};
  if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
    const baseUrl = body.baseUrl.trim().replace(/\/$/, "");
    try {
      const parsed = new URL(baseUrl);
      if (!parsed.protocol.startsWith("http")) {
        return jsonError("baseUrl must be an http(s) URL", 400);
      }
      data.baseUrl = baseUrl;
    } catch {
      return jsonError("baseUrl must be a valid URL", 400);
    }
  }
  if (typeof body.apiKey === "string" && body.apiKey !== "***") {
    data.apiKey = body.apiKey;
  }

  if (data.baseUrl !== undefined || data.apiKey !== undefined) {
    await upsertHermesConfig(user.id, data);
  }

  const cfg = await getHermesConfig(user.id);
  const probe = await probeHermesHealth(user.id);

  return jsonOk({
    ...publicConfig(cfg),
    probe,
  });
}
