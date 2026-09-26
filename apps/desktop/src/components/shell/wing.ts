export type WingId = "home" | "vision" | "plan" | "execute" | "review";

export const WING_IDS: WingId[] = [
  "home",
  "vision",
  "plan",
  "execute",
  "review",
];

export const WING_LABELS: Record<WingId, string> = {
  home: "Home",
  vision: "Vision",
  plan: "Plan",
  execute: "Execute",
  review: "Review",
};

export const WING_DEFAULTS: Record<WingId, string> = {
  home: "/home",
  vision: "/dream",
  plan: "/goals",
  execute: "/daily",
  review: "/review/daily",
};

const PINNED_PATHS = new Set(["/chain", "/log", "/decisions", "/settings"]);

const PATH_WING: Record<string, WingId> = {
  "/home": "home",
  "/data": "home",
  "/pages": "home",
  "/personnel": "home",
  "/dream": "vision",
  "/documents": "vision",
  "/goals": "plan",
  "/projects": "plan",
  "/chart": "plan",
  "/track": "plan",
  "/act": "execute",
  "/daily": "execute",
  "/review/daily": "review",
  "/review/weekly": "review",
  "/review/monthly": "review",
  "/review/quarterly": "review",
  "/review/yearly": "review",
};

export type WingSession = {
  active: WingId;
  lastPath: Record<WingId, string>;
};

export function initialWingSession(): WingSession {
  return {
    active: "home",
    lastPath: { ...WING_DEFAULTS },
  };
}

export function isPinnedPath(pathname: string): boolean {
  return PINNED_PATHS.has(pathname);
}

export function wingForPath(pathname: string): WingId | null {
  if (PATH_WING[pathname]) return PATH_WING[pathname];
  if (pathname.startsWith("/dream/")) return "vision";
  if (pathname.startsWith("/track/")) return "plan";
  if (pathname.startsWith("/data/")) return "home";
  if (pathname.startsWith("/pages/")) return "home";
  return null;
}

function isUsableLastPath(pathname: string, wing: WingId): boolean {
  if (isPinnedPath(pathname)) return true;
  return wingForPath(pathname) === wing;
}

export function applyPath(
  session: WingSession,
  pathname: string,
): WingSession {
  const wing = wingForPath(pathname);
  if (wing) {
    return {
      active: wing,
      lastPath: { ...session.lastPath, [wing]: pathname },
    };
  }
  if (isPinnedPath(pathname)) {
    return {
      ...session,
      lastPath: { ...session.lastPath, [session.active]: pathname },
    };
  }
  return session;
}

export function selectWing(
  session: WingSession,
  wing: WingId,
): { session: WingSession; pathname: string } {
  const candidate = session.lastPath[wing];
  const pathname = isUsableLastPath(candidate, wing)
    ? candidate
    : WING_DEFAULTS[wing];
  return {
    session: { ...session, active: wing },
    pathname,
  };
}
