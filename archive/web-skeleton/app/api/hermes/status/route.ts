import { jsonError, jsonOk } from "@/lib/api.ts";
import { requireUser } from "@/lib/auth.ts";
import { probeHermesHealth } from "@/lib/hermes.ts";

/**
 * Thin Hermes health probe for Settings → Test connection.
 * Uses probeHermesHealth (GET /health with timeout) via hermesFetch.
 */
export async function GET() {
  const user = await requireUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const probe = await probeHermesHealth(user.id);
  return jsonOk(probe);
}
