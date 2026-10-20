/**
 * The page a sheet is drawn over.
 *
 * A sheet is not a route in the sense every other route is: opening one must not
 * unmount the page behind it, or the blurred backdrop would be an empty canvas
 * and the operator would have lost their place on the way in. So while a sheet
 * path is in the address bar the router keeps rendering the last page that was
 * not a sheet, and the sheet sits above it.
 *
 * Remembered here rather than carried in `location.state`, because every link
 * into a sheet is a plain `<Link to="/settings">` or `<Link to="/decisions">`,
 * and the sheet's own controls rewrite the query string — a tab press must not
 * re-enter the sheet as a fresh background.
 *
 * A cold start that opens a sheet path first has nothing remembered: `background`
 * falls back to the request itself, so the sheet route renders inside the shell,
 * over the pane it is drawn from, instead of a backdrop of nothing.
 */
import { useCallback, useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";

export type SheetKind = "settings" | "decisions";

/**
 * Paths that are not pages of their own.
 *
 * `/domains` is the legacy settings alias that redirects straight into the
 * sheet — remembering it as "the page behind the sheet" would blur an empty
 * pane. `/decisions` is the inbox sheet, opened over whatever page the operator
 * was reading so approving a proposal never costs them their place.
 */
const SHEET_PATHS = new Map<string, SheetKind>([
  ["/settings", "settings"],
  ["/domains", "settings"],
  ["/decisions", "decisions"],
]);

export function isSheetPath(pathname: string): boolean {
  return SHEET_PATHS.has(pathname);
}

export function useSheetBackground(): {
  background: Location;
  sheet: SheetKind | null;
  sheetOverBackground: boolean;
} {
  const location = useLocation();
  // State, not a ref: the background IS what the routes render against, so a
  // new one has to paint. As a ref the update was invisible to React, and a
  // cold start kept rendering `<Routes location="/">` — whose only match is the
  // redirect to `/welcome` — so the window opened with a titlebar and an empty
  // body until some unrelated state change happened to re-render.
  const [background, setBackground] = useState<Location>(location);

  useEffect(() => {
    if (!SHEET_PATHS.has(location.pathname)) setBackground(location);
  }, [location]);

  const sheet = SHEET_PATHS.get(location.pathname) ?? null;
  return {
    background,
    sheet,
    sheetOverBackground:
      sheet !== null && !SHEET_PATHS.has(background.pathname),
  };
}

/**
 * Closing a sheet goes *back* to the page it was opened over rather than to a
 * fixed route: the sheet is a surface on top of the app, so leaving it should
 * put the operator back where they were.
 *
 * `location.key` is the tell. The router gives its first location the key
 * `"default"`; every push — which is what a link into a sheet is — gets a fresh
 * one. A cold start that opens a sheet directly therefore has nowhere to go
 * back to and falls through to the dashboard, while an opened sheet unwinds
 * exactly one history entry instead of guessing.
 */
export function useSheetClose(fallback = "/home"): () => void {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    navigate(fallback, { replace: true });
  }, [fallback, location.key, navigate]);
}
