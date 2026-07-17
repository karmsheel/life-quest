import { prisma } from "./prisma.ts";
import { DEFAULT_HERMES_URL } from "./constants.ts";

export async function getHermesConfig(userId: string) {
  const row = await prisma.hermesSettings.findUnique({ where: { userId } });
  return {
    baseUrl: row?.baseUrl || DEFAULT_HERMES_URL,
    apiKey: row?.apiKey || "",
  };
}

export async function upsertHermesConfig(
  userId: string,
  data: { baseUrl?: string; apiKey?: string },
) {
  return prisma.hermesSettings.upsert({
    where: { userId },
    create: {
      userId,
      baseUrl: data.baseUrl ?? DEFAULT_HERMES_URL,
      apiKey: data.apiKey ?? "",
    },
    update: {
      ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
      ...(data.apiKey !== undefined ? { apiKey: data.apiKey } : {}),
    },
  });
}

export async function hermesFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
) {
  const { baseUrl, apiKey } = await getHermesConfig(userId);
  const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  return fetch(url, { ...init, headers });
}

/** Probe Hermes gateway health. Used by settings test and scan reachability. */
export async function probeHermesHealth(
  userId: string,
  timeoutMs = 5000,
): Promise<{
  ok: boolean;
  baseUrl: string;
  latencyMs: number;
  error?: string;
  status?: number;
}> {
  const { baseUrl } = await getHermesConfig(userId);
  const normalized = baseUrl.replace(/\/$/, "") || DEFAULT_HERMES_URL;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await hermesFetch(userId, "/health", {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        baseUrl: normalized,
        latencyMs,
        status: res.status,
        error: `Hermes health returned ${res.status}. Is the gateway running?`,
      };
    }
    return { ok: true, baseUrl: normalized, latencyMs, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      baseUrl: normalized,
      latencyMs: Date.now() - start,
      error: aborted
        ? "Connection timed out. Is Hermes gateway running?"
        : err instanceof Error
          ? err.message
          : "Could not reach Hermes gateway.",
    };
  }
}

export function maskApiKey(apiKey: string): string {
  return apiKey ? "***" : "";
}
