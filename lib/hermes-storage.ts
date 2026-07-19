import type { HermesConfig, HermesConnectionStatus } from "./hermes-types.ts";

const STORAGE_KEY = "lifequest.hermesConfig";

export function loadHermesConfig(): HermesConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HermesConfig;
    if (!parsed.baseUrl || !parsed.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveHermesConfig(config: HermesConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function clearHermesConfig(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode — ignore */
  }
}

export function defaultHermesConfig(): HermesConfig {
  return {
    baseUrl: "http://127.0.0.1:8642",
    apiKey: "",
  };
}

export function connectionStatusFromProbe(
  probe: {
    ok: boolean;
    baseUrl: string;
    latencyMs: number;
    model?: string;
    features?: string[];
    error?: string;
    kind?: HermesConnectionStatus["kind"];
  },
  source: HermesConnectionStatus["source"],
): HermesConnectionStatus {
  return {
    state: probe.ok ? "connected" : "error",
    baseUrl: probe.baseUrl,
    latencyMs: probe.latencyMs,
    model: probe.model,
    features: probe.features,
    error: probe.error,
    kind: probe.kind,
    source,
    checkedAt: new Date().toISOString(),
  };
}
