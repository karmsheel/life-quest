export function isSetupCandidate(
  kind?: string,
  hasApiKey?: boolean | null,
): boolean {
  if (kind === "misconfigured") return true;
  if (kind === "auth_failed" && hasApiKey === false) return true;
  if (!hasApiKey) return true;
  return false;
}

export function needsGatewayRestart(
  kind?: string,
  hasApiKey?: boolean | null,
): boolean {
  return kind === "not_running" && hasApiKey !== false;
}

export function connectionErrorExplanation(
  kind?: string,
  hasApiKey?: boolean | null,
  detail?: string,
): string {
  const needsSetup = isSetupCandidate(kind, hasApiKey);
  const needsRestart = needsGatewayRestart(kind, hasApiKey);

  if (needsSetup && needsRestart) {
    return "LifeQuest could not connect. Enable the API server in your local Hermes Agent, then restart the gateway so the new settings take effect.";
  }

  if (needsSetup) {
    return "The Hermes API server is not enabled yet. Enable it in ~/.hermes/.env, then restart the gateway and connect again.";
  }

  if (needsRestart) {
    return "Your API server settings look configured, but the Hermes gateway has not been restarted since the last change. Restart the gateway, then connect again.";
  }

  return (
    detail ||
    "LifeQuest could not connect to your local Hermes Agent. Enable the API server or restart the gateway, then try again."
  );
}

export function setupSummaryMessage(result: {
  ok: boolean;
  gatewayReachable?: boolean;
  error?: string;
}): string {
  if (!result.ok) {
    return result.error || "Could not configure the Hermes API server.";
  }

  if (result.gatewayReachable) {
    return "Hermes API server is configured and reachable.";
  }

  return "API server settings were written to ~/.hermes/.env. Restart the gateway with `hermes gateway restart`, then connect again.";
}
