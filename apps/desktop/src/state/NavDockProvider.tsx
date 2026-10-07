import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * The left sidebar's dock state — the nav rail's twin of ChatDockProvider.
 *
 * `collapsed` is a shell-level fact, not a NavRail one: collapsing gives the
 * rail's grid column back to the workspace, so the shell owns it and the
 * titlebar reads it to place its own toggle. `present` marks whether the shell
 * (and therefore the rail) is mounted at all — the welcome flow has no rail, so
 * the titlebar must not reserve its column.
 */
type NavDockContextValue = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  present: boolean;
  setPresent: (present: boolean) => void;
};

const NavDockContext = createContext<NavDockContextValue | null>(null);

export function NavDockProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [present, setPresent] = useState(false);

  const toggle = useCallback(() => setCollapsed((current) => !current), []);

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggle, present, setPresent }),
    [collapsed, toggle, present],
  );

  return (
    <NavDockContext.Provider value={value}>{children}</NavDockContext.Provider>
  );
}

export function useNavDock(): NavDockContextValue {
  const ctx = useContext(NavDockContext);
  if (!ctx) {
    throw new Error("useNavDock must be used within NavDockProvider");
  }
  return ctx;
}
