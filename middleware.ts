import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants.ts";

const PUBLIC_PATHS = new Set(["/", "/sign-in", "/sign-up"]);

const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/hermes/discover",
  "/api/hermes/test",
  "/api/hermes/setup",
  "/api/hermes/models",
  "/api/hermes/gateway",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public APIs (handlers enforce their own rules / host checks).
  if (
    PUBLIC_API_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    )
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const isApi = pathname.startsWith("/api/");

  if (!session) {
    // Never redirect API clients to HTML sign-in (that freezes fetch/json flows).
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (PUBLIC_PATHS.has(pathname)) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Already signed in: keep auth pages available but don't block shell.
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
