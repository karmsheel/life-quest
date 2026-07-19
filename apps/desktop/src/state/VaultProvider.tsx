import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { VaultSnapshot } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import type { RecentVaultEntry } from "@/vite-env";

export type VaultContextValue = {
  /** Null when no vault is open (welcome flow). */
  snapshot: VaultSnapshot | null;
  /** Active domain slug from userData prefs (may be null). */
  activeSlug: string | null;
  /** True until first vaultGetSnapshot completes. */
  booting: boolean;
  recent: RecentVaultEntry[];
  error: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  setActiveSlug: (slug: string) => Promise<void>;
  clearVault: () => void;
  createVault: (name?: string) => Promise<boolean>;
  openVault: () => Promise<boolean>;
  openRecent: (path: string) => Promise<boolean>;
  clearError: () => void;
  reloadRecent: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

async function loadActiveSlug(): Promise<string | null> {
  try {
    return await api().domainGetActive();
  } catch {
    return null;
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [activeSlug, setActiveSlugState] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [recent, setRecent] = useState<RecentVaultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadRecent = useCallback(async () => {
    try {
      const list = await api().vaultListRecent();
      setRecent(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const applySnapshot = useCallback(async (next: VaultSnapshot | null) => {
    setSnapshot(next);
    if (next) {
      const slug = await loadActiveSlug();
      setActiveSlugState(slug);
    } else {
      setActiveSlugState(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await api().vaultGetSnapshot();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await applySnapshot(result.value);
      setError(null);
      await reloadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applySnapshot, reloadRecent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [snapResult, list] = await Promise.all([
          api().vaultGetSnapshot(),
          api().vaultListRecent(),
        ]);
        if (cancelled) return;
        if (!snapResult.ok) {
          setError(snapResult.error);
          setSnapshot(null);
        } else {
          await applySnapshot(snapResult.value);
        }
        setRecent(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  const setActiveSlug = useCallback(async (slug: string) => {
    const result = await api().domainSetActive(slug);
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    setActiveSlugState(result.value);
    setError(null);
  }, []);

  const clearVault = useCallback(() => {
    setSnapshot(null);
    setActiveSlugState(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const createVault = useCallback(
    async (name?: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const dir = await api().dialogOpenDirectory();
        if (!dir) return false;
        const result = await api().vaultCreate(dir, name);
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await applySnapshot(result.value);
        await reloadRecent();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, reloadRecent],
  );

  const openVault = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const dir = await api().dialogOpenDirectory();
      if (!dir) return false;
      const result = await api().vaultOpen(dir);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      await applySnapshot(result.value);
      await reloadRecent();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, reloadRecent]);

  const openRecent = useCallback(
    async (path: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const result = await api().vaultOpen(path);
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await applySnapshot(result.value);
        await reloadRecent();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, reloadRecent],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      snapshot,
      activeSlug,
      booting,
      recent,
      error,
      busy,
      refresh,
      setActiveSlug,
      clearVault,
      createVault,
      openVault,
      openRecent,
      clearError,
      reloadRecent,
    }),
    [
      snapshot,
      activeSlug,
      booting,
      recent,
      error,
      busy,
      refresh,
      setActiveSlug,
      clearVault,
      createVault,
      openVault,
      openRecent,
      clearError,
      reloadRecent,
    ],
  );

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error("useVault must be used within VaultProvider");
  }
  return ctx;
}
