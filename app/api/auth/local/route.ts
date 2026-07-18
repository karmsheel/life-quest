import { jsonOk } from "@/lib/api.ts";
import { enterLocalAccount } from "@/lib/local-account.ts";

/** Start or resume the Local account (no email/password). */
export async function POST() {
  const result = await enterLocalAccount();
  return jsonOk(result);
}
