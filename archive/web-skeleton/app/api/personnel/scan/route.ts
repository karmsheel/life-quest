import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { hermesFetch, probeHermesHealth } from "@/lib/hermes.ts";
import {
  HERMES_SCAN_PATHS,
  normalizeScannedAgents,
  type ScannedAgent,
} from "@/lib/personnel.ts";

/**
 * Scan Hermes for available agents/profiles.
 *
 * Forge's personnel scan reads local ~/.hermes profiles from disk. LifeQuest
 * is multi-user and BYOK, so we probe the configured OpenAI-compatible gateway
 * instead: try agent/profile list paths, then /v1/models as a soft fallback.
 * Gateway unreachable → 502.
 */
export async function GET() {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const health = await probeHermesHealth(user.id);
  if (!health.ok) {
    return jsonError(
      health.error ??
        "Hermes gateway is unreachable. Check Settings → Hermes base URL and that the gateway is running.",
      502,
    );
  }

  const tried: string[] = [];
  let lastStatus: number | undefined;
  let agents: ScannedAgent[] = [];
  let sourcePath: string | null = null;
  let warning: string | undefined;

  for (const path of HERMES_SCAN_PATHS) {
    tried.push(path);
    try {
      const res = await hermesFetch(user.id, path, { method: "GET" });
      lastStatus = res.status;
      if (!res.ok) continue;

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        continue;
      }

      const normalized = normalizeScannedAgents(payload);
      if (normalized.length === 0 && path !== "/v1/models") {
        // Empty agent list is still a successful response for agents paths.
        agents = normalized;
        sourcePath = path;
        break;
      }
      if (normalized.length > 0) {
        agents = normalized;
        sourcePath = path;
        if (path === "/v1/models") {
          warning =
            "Hermes has no agent list API; models from /v1/models are shown as scan candidates.";
        }
        break;
      }
    } catch {
      // Individual path failed after health succeeded — try next path.
      continue;
    }
  }

  if (!sourcePath) {
    const authHint =
      lastStatus === 401 || lastStatus === 403
        ? " Hermes rejected the API key — update Settings → Hermes."
        : "";
    return jsonOk({
      agents: [],
      warning:
        "Hermes is reachable but no agent/profile list endpoint returned data. Tried: " +
        tried.join(", ") +
        (lastStatus !== undefined ? ` (last status ${lastStatus})` : "") +
        authHint,
      source: null,
      gateway: { baseUrl: health.baseUrl, latencyMs: health.latencyMs },
    });
  }

  return jsonOk({
    agents,
    ...(warning ? { warning } : {}),
    source: sourcePath,
    gateway: { baseUrl: health.baseUrl, latencyMs: health.latencyMs },
  });
}
