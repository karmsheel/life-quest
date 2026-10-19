/**
 * The page the settings sheet is drawn over.
 *
 * Settings is a sheet, not a route in the sense every other route is: opening it
 * must not unmount the page behind it, or the blurred backdrop would be an empty
 * canvas and the operator would have lost their place on the way in. So while
 * `/settings` is in the address bar the router keeps rendering the last page
 * that was not settings, and the sheet sits above it.
 *
 * Remembered here rather than carried in `location.state`, because every link
 * into settings is a plain `<Link to="/settings">` and the sheet's tab changes
 * rewrite the query string — a tab press must not re-enter the sheet as a fresh
 * background.
 *
 * A cold start that opens `/settings` first has nothing remembered: `background`
 * falls back to the request itself, so the settings route renders inside the
 * shell, over the pane it is drawn from, instead of a backdrop of nothing.
 */
import { useEffect, useRef } from "react";
import { useLocation, type Location } from "react-router-dom";

/**
 * Paths that are not pages of their own. `/settings` is the sheet itself, and
 * `/domains` is the legacy alias that redirects straight into it — remembering
 * either as "the page behind the sheet" would blur an empty pane.
 */
const NON_PAGE_PATHS = new Set(["/settings", "/domains"]);

export function useSettingsBackground(): {
  background: Location;
  sheetOverBackground: boolean;
} {
  const location = useLocation();
  const backgroundRef = useRef<Location>(location);

  useEffect(() => {
    if (!NON_PAGE_PATHS.has(location.pathname)) backgroundRef.current = location;
  }, [location]);

  const background = backgroundRef.current;
  return {
    background,
    sheetOverBackground:
      location.pathname === "/settings" && background.pathname !== "/settings",
  };
}
