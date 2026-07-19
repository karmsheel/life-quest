import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/api.ts";
import { enterLocalAccount } from "@/lib/local-account.ts";
import { safeInternalPath } from "@/lib/safe-redirect.ts";

/**
 * Local account entry.
 * - Browser form POST (no JS) → 303 redirect to safe `from` (default /home) with Set-Cookie
 * - fetch() with JSON Accept → JSON body
 */
export async function POST(request: Request) {
  try {
    const result = await enterLocalAccount();

    const accept = request.headers.get("accept") ?? "";
    const contentType = request.headers.get("content-type") ?? "";
    const wantsJson =
      accept.includes("application/json") ||
      contentType.includes("application/json");

    if (!wantsJson) {
      let fromRaw: string | null = null;
      try {
        const formData = await request.formData();
        const field = formData.get("from");
        fromRaw = typeof field === "string" ? field : null;
      } catch {
        /* no body or not form data — use default */
      }
      // Also accept ?from= on the action URL as a fallback
      if (!fromRaw) {
        fromRaw = new URL(request.url).searchParams.get("from");
      }
      const dest = safeInternalPath(fromRaw);
      return NextResponse.redirect(new URL(dest, request.url), 303);
    }

    return jsonOk(result);
  } catch (err) {
    console.error("[POST /api/auth/local]", err);
    const message =
      err instanceof Error ? err.message : "Could not start local account";
    return jsonError(message, 500);
  }
}
