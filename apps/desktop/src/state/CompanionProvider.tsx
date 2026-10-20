import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CompanionProfileInfo, CompanionStatus } from "@/vite-env";
import { api } from "@/lib/ipc";

type CompanionContextValue = {
  status: CompanionStatus | null;
  ensuring: boolean;
  retry: () => Promise<void>;
  /**
   * Every Hermes profile this install has, null until the first read. The
   * setup screen and Settings both render the picker off this, so a stuck
   * connect has a way out: pick an installed profile, or create the app's
   * own `lifequest` one.
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
    () => ({ status, ensuring, retry, profiles, profile, useProfile }),
    [status, ensuring, retry, profiles, profile, useProfile],
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
