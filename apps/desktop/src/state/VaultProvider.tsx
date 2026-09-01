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
import type { Result, VaultSettings, VaultSnapshot } from "@lifequest/vault-core";
import {
  domainLens,
  lensSlug,
  overviewLens,
  type DomainLens,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import type { RecentVaultEntry } from "@/vite-env";

export type VaultContextValue = {
  /** Null when no vault is open (welcome flow). */
  snapshot: VaultSnapshot | null;
  /** Session domain lens; Overview is the default. */
  lens: DomainLens;
  /** Active domain slug derived from the lens; null in Overview. */
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
  setLens: (next: DomainLens) => Promise<void>;
  setActiveSlug: (slug: string | null) => Promise<void>;
  clearVault: () => void;
  createVault: (name?: string) => Promise<boolean>;
  openVault: () => Promise<boolean>;
  openRecent: (path: string) => Promise<boolean>;
  clearError: () => void;
  reloadRecent: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

function domainStillLive(snapshot: VaultSnapshot, slug: string): boolean {
  return snapshot.domains.some((d) => d.slug === slug && !d.meta.archivedAt);
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [lens, setLensState] = useState<DomainLens>(overviewLens());
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const activeSlug = lensSlug(lens);
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

  const setLens = useCallback(async (next: DomainLens) => {
    setLensState(next);
    const result = await api().domainSetActive(lensSlug(next));
    if (!result.ok) {
      setError(result.error);
    } else {
      setError(null);
    }
  }, []);

  const setActiveSlug = useCallback(
    async (slug: string | null) => {
      await setLens(slug ? domainLens(slug) : overviewLens());
    },
    [setLens],
  );

  const applySnapshot = useCallback((next: VaultSnapshot | null) => {
    setSnapshot(next);
    if (!next) {
      setLensState(overviewLens());
      return;
    }
    const current = lensRef.current;
    if (current.kind === "domain" && !domainStillLive(next, current.slug)) {
      setLensState(overviewLens());
      void api().domainSetActive(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await api().vaultGetSnapshot();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applySnapshot(result.value);
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
          applySnapshot(snapResult.value);
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

  const clearVault = useCallback(() => {
    setSnapshot(null);
    setLensState(overviewLens());
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
        applySnapshot(result.value);
        void setLens(overviewLens());
        void api().domainSetActive(null);
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
    [applySnapshot, bumpReloadGeneration, reloadRecent, setLens],
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
      applySnapshot(result.value);
      void setLens(overviewLens());
      void api().domainSetActive(null);
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
  }, [applySnapshot, bumpReloadGeneration, reloadRecent, setLens]);

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
        applySnapshot(result.value);
        void setLens(overviewLens());
        void api().domainSetActive(null);
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
    [applySnapshot, bumpReloadGeneration, reloadRecent, setLens],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      snapshot,
      lens,
      activeSlug,
      booting,
      stale,
      reloadGeneration,
      recent,
      error,
      busy,
      refresh,
      updateSettings,
      setLens,
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
      lens,
      activeSlug,
      booting,
      stale,
      reloadGeneration,
      recent,
      error,
      busy,
      refresh,
      updateSettings,
      setLens,
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
