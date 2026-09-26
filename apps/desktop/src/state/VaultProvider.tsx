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
import { lastVaultToReopen } from "./lastVault.ts";
import {
  resolveRestoredLens,
  shouldClearLensForSnapshot,
  type RestoredLens,
} from "./lens-persistence.ts";

export type VaultContextValue = {
  /** Null when no vault is open (welcome flow). */
  snapshot: VaultSnapshot | null;
  /** Domain lens for the open vault. Overview when none is saved. */
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
  setLens: (next: DomainLens) => Promise<Result<string | null>>;
  setActiveSlug: (slug: string | null) => Promise<Result<string | null>>;
  clearVault: () => void;
  createVault: (name?: string) => Promise<boolean>;
  openVault: () => Promise<boolean>;
  openRecent: (path: string) => Promise<boolean>;
  clearError: () => void;
  reloadRecent: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [lens, setLensState] = useState<DomainLens>(overviewLens());
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const vaultIdRef = useRef<string | null>(null);
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
    return result;
  }, []);

  const setActiveSlug = useCallback(
    async (slug: string | null) => {
      return setLens(slug ? domainLens(slug) : overviewLens());
    },
    [setLens],
  );

  const applySnapshot = useCallback((next: VaultSnapshot | null, persistClear = true) => {
    setSnapshot(next);
    if (!next) {
      vaultIdRef.current = null;
      setLensState(overviewLens());
      return;
    }
    const previousVaultId = vaultIdRef.current;
    vaultIdRef.current = next.lifequest.id;
    // Same-vault refresh only. A vault switch must not write Overview
    // onto the destination; restoreLens applies that vault's own lens.
    if (shouldClearLensForSnapshot(previousVaultId, next, lensRef.current)) {
      setLensState(overviewLens());
      if (persistClear) void api().domainSetActive(null);
    }
  }, []);

  // Read the saved lens, then publish the snapshot and that lens together.
  const restoreLens = useCallback(async (next: VaultSnapshot) => {
    let resolved: RestoredLens;
    try {
      const persistedSlug = await api().domainGetActive();
      resolved = resolveRestoredLens(persistedSlug, next);
    } catch {
      resolved = { lens: overviewLens(), clearSaved: false };
    }
    applySnapshot(next, false);
    setLensState(resolved.lens);
    if (resolved.clearSaved) {
      try {
        await api().domainSetActive(null);
      } catch {
        // Screen is already Overview. A stale slug is cleared on the next open.
      }
    }
  }, [applySnapshot]);

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
        } else if (snapResult.value) {
          await restoreLens(snapResult.value);
          if (cancelled) return;
        } else {
          applySnapshot(null);
        }
        setRecent(list);
        const reopen = lastVaultToReopen(
          snapResult.ok ? snapResult.value : null,
          list,
        );
        if (reopen) {
          const opened = await api().vaultOpen(reopen);
          if (cancelled) return;
          if (opened.ok) {
            await restoreLens(opened.value);
            setError(null);
          }
        }
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
  }, [applySnapshot, restoreLens]);

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
    vaultIdRef.current = null;
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
      await restoreLens(result.value);
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
  }, [bumpReloadGeneration, reloadRecent, restoreLens]);

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
        await restoreLens(result.value);
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
    [bumpReloadGeneration, reloadRecent, restoreLens],
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
