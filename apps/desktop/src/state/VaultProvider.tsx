import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Result, VaultSettings, VaultSnapshot } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import type { RecentVaultEntry } from "@/vite-env";

export type VaultContextValue = {
  /** Null when no vault is open (welcome flow). */
  snapshot: VaultSnapshot | null;
  /** Active domain slug from userData prefs (may be null). */
  activeSlug: string | null;
  /** True until first vaultGetSnapshot completes. */
  booting: boolean;
  /** True when doctrine files changed on disk since last load. */
  stale: boolean;
  /**
   * Increments after a successful vault refresh / open / create so open
   * editors can re-fetch from disk and drop stale local drafts.
   */
  reloadGeneration: number;
  recent: RecentVaultEntry[];
  error: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  /** Patch vault settings without reloading doctrine editors. */
  updateSettings: (
    patch: Partial<VaultSettings>,
  ) => Promise<Result<VaultSettings>>;
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
  const [stale, setStale] = useState(false);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [recent, setRecent] = useState<RecentVaultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bumpReloadGeneration = useCallback(() => {
    setReloadGeneration((g) => g + 1);
  }, []);

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
      setStale(false);
      setError(null);
      bumpReloadGeneration();
      await reloadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applySnapshot, bumpReloadGeneration, reloadRecent]);

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

  // External file change events from main (window focus mtime check).
  useEffect(() => {
    try {
      return api().onVaultFileChanged(() => {
        setStale(true);
      });
    } catch {
      return undefined;
    }
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<VaultSettings>): Promise<Result<VaultSettings>> => {
      try {
        const result = await api().settingsUpdate(patch);
        if (!result.ok) {
          setError(result.error);
          return result;
        }
        setSnapshot((prev) =>
          prev ? { ...prev, settings: result.value } : prev,
        );
        setError(null);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        setError(error);
        return { ok: false, error };
      }
    },
    [],
  );

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
    setStale(false);
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
        setStale(false);
        bumpReloadGeneration();
        await reloadRecent();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, bumpReloadGeneration, reloadRecent],
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
      setStale(false);
      bumpReloadGeneration();
      await reloadRecent();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, bumpReloadGeneration, reloadRecent]);

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
        setStale(false);
        bumpReloadGeneration();
        await reloadRecent();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, bumpReloadGeneration, reloadRecent],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      snapshot,
      activeSlug,
      booting,
      stale,
      reloadGeneration,
      recent,
      error,
      busy,
      refresh,
      updateSettings,
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
      stale,
      reloadGeneration,
      recent,
      error,
      busy,
      refresh,
      updateSettings,
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
    <VaultContext.Provider value={value}>
      {stale && snapshot ? (
        <div className="vault-stale-banner" role="status">
          <p>Files changed on disk</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void refresh()}
            disabled={busy}
          >
            Reload
          </button>
        </div>
      ) : null}
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error("useVault must be used within VaultProvider");
  }
  return ctx;
}
