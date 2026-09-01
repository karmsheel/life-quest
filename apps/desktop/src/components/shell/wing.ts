export type WingId = "vision" | "plan" | "execute";

export const WING_IDS: WingId[] = ["vision", "plan", "execute"];

export const WING_LABELS: Record<WingId, string> = {
  vision: "Vision",
  plan: "Plan",
  execute: "Execute",
};

export const WING_DEFAULTS: Record<WingId, string> = {
  vision: "/home",
  plan: "/chart",
  execute: "/act",
};

const PINNED_PATHS = new Set(["/log", "/decisions", "/settings"]);

const PATH_WING: Record<string, WingId> = {
  "/home": "vision",
  "/dream": "vision",
  "/chain": "vision",
  "/documents": "vision",
  "/personnel": "vision",
  "/chart": "plan",
  "/track": "plan",
  "/act": "execute",
};

export type WingSession = {
  active: WingId;
  lastPath: Record<WingId, string>;
};

export function initialWingSession(): WingSession {
  return {
    active: "vision",
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
