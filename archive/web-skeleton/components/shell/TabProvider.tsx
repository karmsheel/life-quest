"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

export type ShellTab = {
  id: string;
  title: string;
  route: string;
};

type TabContextValue = {
  tabs: ShellTab[];
  activeId: string | null;
  openTab: (route: string, opts?: { title?: string; background?: boolean }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  navigateInActive: (route: string, title?: string) => void;
};

const STORAGE_KEY = "lq_tabs";

const ROUTE_TITLES: Record<string, string> = {
  "/home": "Home",
  "/domains": "Domains",
  "/dream": "Dream",
  "/chart": "Chart",
  "/track": "Track",
  "/act": "Act",
  "/documents": "Documents",
  "/personnel": "Personnel",
  "/decisions": "Decisions",
  "/log": "Life log",
  "/profile": "Profile",
  "/settings": "Settings",
};

export function titleForRoute(route: string): string {
  const base = route.split("?")[0] ?? route;
  return ROUTE_TITLES[base] ?? (base.replace(/^\//, "") || "Home");
}

function normalizeRoute(route: string): string {
  if (!route) return "/home";
  const path = route.split("?")[0] ?? route;
  if (!path.startsWith("/")) return `/${path}`;
  return path === "/" ? "/home" : path;
}

function newTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type StoredTabs = {
  tabs: ShellTab[];
  activeId: string | null;
};

function readStored(): StoredTabs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabs;
    if (!Array.isArray(parsed.tabs)) return null;
    return {
      tabs: parsed.tabs.filter(
        (t) =>
          t &&
          typeof t.id === "string" &&
          typeof t.title === "string" &&
          typeof t.route === "string",
      ),
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return null;
  }
}

function writeStored(tabs: ShellTab[], activeId: string | null) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
  } catch {
    /* ignore */
  }
}

const TabContext = createContext<TabContextValue | null>(null);

export function TabProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tabs, setTabs] = useState<ShellTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Hydrate from sessionStorage once
  useEffect(() => {
    const stored = readStored();
    const route = normalizeRoute(pathname || "/home");
    if (stored && stored.tabs.length > 0) {
      setTabs(stored.tabs);
      const match = stored.tabs.find((t) => t.route === route);
      const nextActive =
        match?.id ??
        (stored.activeId && stored.tabs.some((t) => t.id === stored.activeId)
          ? stored.activeId
          : stored.tabs[0]!.id);
      setActiveId(nextActive);
    } else {
      const id = newTabId();
      setTabs([{ id, title: titleForRoute(route), route }]);
      setActiveId(id);
    }
    setHydrated(true);
    // pathname captured at first mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist
  useEffect(() => {
    if (!hydrated) return;
    writeStored(tabs, activeId);
  }, [tabs, activeId, hydrated]);

  // Keep active tab route in sync with pathname when navigating
  useEffect(() => {
    if (!hydrated) return;
    const route = normalizeRoute(pathname || "/home");
    const currentActiveId = activeIdRef.current;
    const prev = tabsRef.current;

    if (!currentActiveId) {
      const existing = prev.find((t) => t.route === route);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const id = newTabId();
      setTabs([...prev, { id, title: titleForRoute(route), route }]);
      setActiveId(id);
      return;
    }

    const active = prev.find((t) => t.id === currentActiveId);
    if (!active) return;
    if (active.route === route) return;

    setTabs(
      prev.map((t) =>
        t.id === currentActiveId
          ? { ...t, route, title: titleForRoute(route) }
          : t,
      ),
    );
  }, [pathname, hydrated]);

  const openTab = useCallback(
    (route: string, opts?: { title?: string; background?: boolean }) => {
      const normalized = normalizeRoute(route);
      const title = opts?.title ?? titleForRoute(normalized);
      const prev = tabsRef.current;
      const existing = prev.find((t) => t.route === normalized);

      if (existing) {
        if (!opts?.background) {
          setActiveId(existing.id);
          router.push(normalized);
        }
        return;
      }

      const id = newTabId();
      setTabs([...prev, { id, title, route: normalized }]);
      if (!opts?.background) {
        setActiveId(id);
        router.push(normalized);
      }
    },
    [router],
  );

  const closeTab = useCallback(
    (id: string) => {
      const prev = tabsRef.current;
      if (prev.length <= 1) return;
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const next = prev.filter((t) => t.id !== id);
      setTabs(next);
      if (activeIdRef.current === id) {
        const fallback = next[Math.max(0, idx - 1)] ?? next[0]!;
        setActiveId(fallback.id);
        router.push(fallback.route);
      }
    },
    [router],
  );

  const activateTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      setActiveId(id);
      if (normalizeRoute(pathname || "") !== tab.route) {
        router.push(tab.route);
      }
    },
    [pathname, router],
  );

  const navigateInActive = useCallback(
    (route: string, title?: string) => {
      const normalized = normalizeRoute(route);
      const nextTitle = title ?? titleForRoute(normalized);
      const currentActiveId = activeIdRef.current;
      const prev = tabsRef.current;

      if (!currentActiveId) {
        const id = newTabId();
        setTabs([{ id, title: nextTitle, route: normalized }]);
        setActiveId(id);
      } else {
        setTabs(
          prev.map((t) =>
            t.id === currentActiveId
              ? { ...t, route: normalized, title: nextTitle }
              : t,
          ),
        );
      }
      router.push(normalized);
    },
    [router],
  );

  const value = useMemo(
    () => ({
      tabs,
      activeId,
      openTab,
      closeTab,
      activateTab,
      navigateInActive,
    }),
    [tabs, activeId, openTab, closeTab, activateTab, navigateInActive],
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

export function useTabs(): TabContextValue {
  const ctx = useContext(TabContext);
  if (!ctx) {
    throw new Error("useTabs must be used within TabProvider");
  }
  return ctx;
}
