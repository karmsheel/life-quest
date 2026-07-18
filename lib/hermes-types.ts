export type HermesConnectionKind =
  | "reachable"
  | "auth_failed"
  | "not_running"
  | "timeout"
  | "misconfigured";

export type HermesConnectionState =
  | "idle"
  | "discovering"
  | "testing"
  | "connected"
  | "error";

export type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

export type HermesConnectionStatus = {
  state: HermesConnectionState;
  baseUrl?: string;
  latencyMs?: number;
  model?: string;
  features?: string[];
  error?: string;
  kind?: HermesConnectionKind;
  source?: "auto" | "manual" | "saved";
  checkedAt?: string;
};
