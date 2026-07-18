import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/api.ts";
import { enterLocalAccount } from "@/lib/local-account.ts";

/**
 * Local account entry.
 * - Browser form POST (no JS) → 303 redirect to /home with Set-Cookie
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
      return NextResponse.redirect(new URL("/home", request.url), 303);
    }

    return jsonOk(result);
  } catch (err) {
    console.error("[POST /api/auth/local]", err);
    const message =
      err instanceof Error ? err.message : "Could not start local account";
    return jsonError(message, 500);
  }
}
