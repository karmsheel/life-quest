import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  CompanionProfileInfo,
  CompanionStatus,
  HarnessId,
  HarnessSummary,
} from "@/vite-env";
import { api } from "@/lib/ipc";

type CompanionContextValue = {
  status: CompanionStatus | null;
  ensuring: boolean;
  retry: () => Promise<void>;
  /**
   * Every companion the studio can talk to. Two entries: the external sidekick
   * and the built-in one. Null until the first read.
   */
  harnesses: HarnessSummary[] | null;
  /** Which companion is answering now; null until the first read. */
  harness: HarnessId | null;
  /** Switch companion and bring the new one up. */
  useHarness: (id: HarnessId) => Promise<void>;
  /**
   * Every Hermes profile this install has, null until the first read. The
   * setup screen and Settings both render the picker off this, so a stuck
   * connect has a way out: pick an installed profile, or create the app's
   * own `lifequest` one. Empty for a built-in companion, which has no profiles.
   */
  profiles: CompanionProfileInfo[] | null;
  /** The profile the companion runs on; null until the first read. */
  profile: string | null;
  /** Move the companion onto one profile and bring it up. */
  useProfile: (name: string) => Promise<void>;
};

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function CompanionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [ensuring, setEnsuring] = useState(true);
  const [harnesses, setHarnesses] = useState<HarnessSummary[] | null>(null);
  const [harness, setHarness] = useState<HarnessId | null>(null);
  const [profiles, setProfiles] = useState<CompanionProfileInfo[] | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  const retry = useCallback(async () => {
    setEnsuring(true);
    try {
      const next = await api().companionEnsure();
      setStatus(next);
    } catch {
      setStatus({ kind: "disconnected" });
    } finally {
      setEnsuring(false);
    }
  }, []);

  /** The two companions, and which one is answering. Read once. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await api().companionHarnesses();
        if (cancelled) return;
        // A harness page's bridge is partial; anything that is not the list this
        // method promises leaves the picker absent rather than taking the screen
        // down with it.
        const rows = Array.isArray(listed) ? listed : [];
        setHarnesses(rows.length > 0 ? rows : null);
        setHarness(rows.find((entry) => entry.active)?.id ?? null);
      } catch {
        // No bridge: the setup screen keeps its Recheck.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Switch companion. The chat sessions belong to the harness that made them,
   * so the dock must reload its list after this settles — the status change is
   * what the dock already watches.
   */
  const useHarness = useCallback(
    async (id: HarnessId) => {
      setEnsuring(true);
      try {
        const next = await api().companionUseHarness(id);
        setStatus(next);
        setHarness(id);
        setHarnesses((prev) =>
          prev ? prev.map((h) => ({ ...h, active: h.id === id })) : prev,
        );
        // The Hermes profile list is empty for the built-in companion.
        void api()
          .companionProfilesList()
          .then((listed) => {
            setProfiles(listed.profiles);
            setProfile(listed.active);
          })
          .catch(() => {});
      } catch {
        setStatus({ kind: "disconnected" });
      } finally {
        setEnsuring(false);
      }
    },
    [],
  );

  /**
   * The profile list, read once. A failure is silence, not a banner: the
   * picker is a way out of a stuck connect, and an unreadable profiles
   * directory leaves the operator with Recheck exactly as before.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await api().companionProfilesList();
        if (cancelled) return;
        setProfiles(listed.profiles);
        setProfile(listed.active);
      } catch {
        // No list, no picker: the screen keeps its Recheck and docs.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const useProfile = useCallback(
    async (name: string) => {
      setEnsuring(true);
      try {
        const next = await api().companionUseProfile(name);
        setStatus(next);
        setProfile(name);
      } catch {
        setStatus({ kind: "disconnected" });
      } finally {
        setEnsuring(false);
      }
    },
    [],
  );

  useEffect(() => {
    void retry();
  }, [retry]);

  /**
   * The status can move after it was first reported: the model probe answers a
   * round-trip after the ready status, so a retired model's warning lands here
   * rather than being lost. Subscribing for the life of the app is enough —
   * `setStatus` is the same value every consumer reads.
   */
  useEffect(() => {
    try {
      return api().onCompanionStatusChanged((next) => setStatus(next));
    } catch {
      // No bridge (a harness page): nothing to subscribe to.
      return undefined;
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      ensuring,
      retry,
      harnesses,
      harness,
      useHarness,
      profiles,
      profile,
      useProfile,
    }),
    [status, ensuring, retry, harnesses, harness, useHarness, profiles, profile, useProfile],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue {
  const ctx = useContext(CompanionContext);
  if (!ctx) {
    throw new Error("useCompanion must be used within CompanionProvider");
  }
  return ctx;
}

/**
 * The same context, for a component that can render without it.
 *
 * The chat dock is mounted by the app inside the provider AND by the e2e
 * harness pages directly, with only the IPC bridge stubbed. The dock's own job
 * does not depend on knowing which companion is up, so it reads the context
 * this way and the picker simply does not render on a page that has no
 * provider.
 */
export function useOptionalCompanion(): CompanionContextValue | null {
  return useContext(CompanionContext);
}
