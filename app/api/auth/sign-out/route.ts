import { jsonOk } from "@/lib/api.ts";
import { clearSessionCookie } from "@/lib/auth.ts";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ ok: true });
}
