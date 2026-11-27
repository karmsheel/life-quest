// One sentence for one companion's status.
//
// The status vocabulary belongs to the seam (`electron/harness/types.ts`), and
// the renderer may not format a port, a profile path or an exit code itself — so
// the sentence is made here, once, and every surface that has to say what an
// agent is doing reads the same words. Settings shows it under its status line;
// the chat rail shows it when the agent in front cannot answer at all.
import type { CompanionStatus } from "@/vite-env";

/**
 * What this status means, in the operator's terms.
 *
 * `ensuring` is the boot still resolving its first answer; anything else is a
 * verdict about the agent in front.
 */
export function companionStatusSummary(
  status: CompanionStatus | null,
  ensuring: boolean,
): string {
  if (ensuring || !status) return "Connecting…";
  switch (status.kind) {
    case "ready":
      return status.detail;
    case "switching":
      return status.harness === "pi"
        ? "Starting the built-in companion…"
        : "Starting Hermes…";
    case "needs_setup":
      return (
        status.message ?? "The built-in companion needs an endpoint and a model."
      );
    case "needs_install":
      return "Hermes CLI not found on PATH.";
    case "profile_error":
      return status.message;
    case "port_busy":
      return `Port ${status.port} is busy.`;
    case "gateway_exited":
      return status.detail || "Gateway exited.";
    case "hermes_too_old":
      return "Hermes is too old for the Sessions API.";
    case "auth_error":
      return "Companion API key was rejected.";
    default:
      return "Companion disconnected.";
  }
}
