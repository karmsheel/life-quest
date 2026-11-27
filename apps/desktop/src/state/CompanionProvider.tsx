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
import type {
  CompanionHarnessChanged,
  CompanionProfileInfo,
  CompanionStatus,
  HarnessId,
  HarnessSummary,
} from "@/vite-env";
import { api } from "@/lib/ipc";

type CompanionContextValue = {
  status: CompanionStatus | null;
  /** The BOOT is still resolving its first answer. Never true for a switch. */
  ensuring: boolean;
  /**
   * The agent a switch is moving to, or null. A switch is not a boot: the
   * studio stays on screen and only the chat column follows the new agent, so
   * this is what the switcher uses to show a pending mark instead of taking
   * the app down to the connect screen.
   */
  switching: HarnessId | null;
  /**
   * A companion has answered `ready` at least once in this session.
   *
   * This is the studio's gate, not `status.kind`. The studio may only open with
   * a companion (LAWS/COMPANION.md), but once it IS open, a switch or a late
   * status must never take it away: that teardown is what made changing agents
   * feel like a reconnection and reloaded the dashboard under the operator.
   */
  readyOnce: boolean;
  retry: () => Promise<void>;
  /**
   * Every companion the studio can talk to. Two entries: the external sidekick
   * and the built-in one. Null until the first read.
   */
  harnesses: HarnessSummary[] | null;
  /** Which companion is answering now; null until the first read. */
  harness: HarnessId | null;
  /**
   * Boot/setup pick: switch companion, persist it, and wait for it to come up.
   * The setup screen uses this because a failure belongs on that screen.
   */
  useHarness: (id: HarnessId) => Promise<void>;
  /**
   * Switch from the open studio: flip the choice at once, let the target's
   * ensure finish in the background. The studio does not wait and is not
   * replaced while another agent boots.
   */
  switchHarness: (id: HarnessId) => Promise<void>;
  /**
   * Re-read the agent list, the Hermes profiles and the current status.
   *
   * Settings → Agents in this vault calls it after it adds or removes the
   * vault's Hermes agent: the vault's binding changed but the active harness
   * did not, so no status or harness push is coming and the dock's pill list
   * would stay stale.
   */
  refreshHarnesses: () => Promise<void>;
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
  const [switching, setSwitching] = useState<HarnessId | null>(null);
  const [readyOnce, setReadyOnce] = useState(false);
  const [harnesses, setHarnesses] = useState<HarnessSummary[] | null>(null);
  const [harness, setHarness] = useState<HarnessId | null>(null);
  const [profiles, setProfiles] = useState<CompanionProfileInfo[] | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  /** The agent the app is on, readable from effects that must not re-bind. */
  const harnessRef = useRef<HarnessId | null>(null);
  harnessRef.current = harness;
  /** How many switches have been asked for: a stale answer must not land. */
  const switchSeq = useRef(0);

  /**
   * A status is only the app's when it comes from the agent the app is on.
   *
   * The bus tags every status with its agent. A gateway restart from the agent
   * the operator left keeps running after the click, and its answer used to be
   * painted over the new agent — the switch then looked like it was
   * reconnecting, twice.
   */
  const acceptStatus = useCallback((next: CompanionStatus): boolean => {
    const current = harnessRef.current;
    if (!current) return true;
    if (next.harness && next.harness !== current) return false;
    return true;
  }, []);

  const applyStatus = useCallback(
    (next: CompanionStatus) => {
      if (!acceptStatus(next)) return;
      setStatus(next);
      if (next.kind === "ready") setReadyOnce(true);
      // A `switching` status is the answer a switch gives while its ensure is
      // still running; the ensure's own verdict clears the pending mark.
      if (next.kind !== "switching") setSwitching(null);
    },
    [acceptStatus],
  );

  const retry = useCallback(async () => {
    setEnsuring(true);
    try {
      const next = await api().companionEnsure();
      applyStatus(next);
    } catch {
      applyStatus({ kind: "disconnected" });
    } finally {
      setEnsuring(false);
    }
  }, [applyStatus]);

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
   * Mark the agent the provider just moved to as active in the picker list.
   *
   * Only when the list already carries that agent. The list is main's
   * synchronous view of "which agents this vault can talk to", and it is
   * replaced wholesale by every re-read; a mark for an agent the current list
   * does not have — the harness-changed push for a vault whose Hermes agent was
   * just added, or a switch racing that read — must not demote the only agent
   * the stale list can show. Demoting it would leave the switcher with no active
   * agent for a frame, and `AgentsProvider`'s "an agent scoped away is not left
   * answering" fallback reads that as "nothing is active" and switches back to
   * Pi, overwriting the vault's binding in main. The ring itself still moves:
   * the switcher draws `harness` as active whether or not the row says so, and
   * the re-read below settles the flags.
   */
  const markActive = useCallback((id: HarnessId) => {
    setHarnesses((prev) => {
      if (!prev) return prev;
      if (!prev.some((entry) => entry.id === id)) return prev;
      return prev.map((entry) => ({ ...entry, active: entry.id === id }));
    });
  }, []);

  /**
   * Re-read the agent list, the profiles and the status.
   *
   * The list is main's synchronous answer to "which agents can this vault talk
   * to", so it is re-read whenever the vault's binding changes — a fresh Hermes
   * agent makes the pill appear, a removed one makes it disappear. A failure is
   * silence, not a banner: the pickers keep what they already show.
   */
  const refreshHarnesses = useCallback(async () => {
    try {
      const [listed, profiles, status] = await Promise.all([
        api().companionHarnesses(),
        api().companionProfilesList(),
        api().companionStatus(),
      ]);
      if (Array.isArray(listed)) {
        setHarnesses(listed.length > 0 ? listed : null);
      }
      setProfiles(profiles.profiles);
      setProfile(profiles.active);
      if (status) applyStatus(status);
    } catch {
      // No bridge, or a read that failed: the page keeps what it knows.
    }
  }, [applyStatus]);

  /**
   * Switch companion — the BOOT/setup path, which waits.
   *
   * Used by the setup screen's picker: there the operator is on a connect
   * screen already, and the honest thing is to wait and report the new agent's
   * own failure in its own words.
   */
  const useHarness = useCallback(
    async (id: HarnessId) => {
      setEnsuring(true);
      try {
        const next = await api().companionUseHarness(id);
        // The ref is assigned during render, so it still names the agent being
        // left here. Point it at the new one BEFORE the answer is applied, or
        // the boot path's own status is dropped as a stale answer from another
        // agent — which left a fresh install on the wrong copy (Hermes's failure
        // where Pi's setup form belongs).
        harnessRef.current = id;
        setHarness(id);
        markActive(id);
        applyStatus(next);
        // The Hermes profile list is empty for the built-in companion.
        void api()
          .companionProfilesList()
          .then((listed) => {
            setProfiles(listed.profiles);
            setProfile(listed.active);
          })
          .catch(() => {});
      } catch {
        applyStatus({ kind: "disconnected", harness: id });
      } finally {
        setEnsuring(false);
      }
    },
    [applyStatus, markActive],
  );

  /**
   * Switch companion from the open studio — the fast path.
   *
   * The choice flips in the same commit as the click: the switcher's ring, the
   * chat rail and the tab strip move to the new agent at once, and the agent's
   * own boot finishes in the main process. `ensuring` is deliberately NOT set:
   * it is the boot flag, and the whole app's first-connect gate reads it.
   */
  const switchHarness = useCallback(
    async (id: HarnessId) => {
      // Already there, or already on its way there: a second click is not a
      // second switch, and the agent's ensure must not be asked twice.
      if (harnessRef.current === id) return;
      const seq = ++switchSeq.current;
      setHarness(id);
      harnessRef.current = id;
      markActive(id);
      setSwitching(id);
      setStatus((prev) => {
        // Keep what is known only when it is already this agent's answer;
        // anything else becomes the honest "coming up" status.
        if (prev && prev.harness === id && prev.kind !== "switching") return prev;
        return { kind: "switching", harness: id };
      });
      try {
        // The e2e harness pages mount this provider over a PARTIAL bridge stub.
        // A stub from before the fast switch still has the boot call, so the
        // switcher keeps working there instead of throwing into a disconnect.
        const bridge = api();
        const next =
          typeof bridge.companionSwitchHarness === "function"
            ? await bridge.companionSwitchHarness(id)
            : await bridge.companionUseHarness(id);
        if (switchSeq.current !== seq) return;
        // The invoke answers at once; when it answers `switching` that is only
        // the ack of the flip this provider already painted. Applying it back
        // after the background ensure has settled would re-open the pending mark
        // with nothing left to clear it.
        if (next.kind !== "switching") applyStatus(next);
        void api()
          .companionProfilesList()
          .then((listed) => {
            if (switchSeq.current !== seq) return;
            setProfiles(listed.profiles);
            setProfile(listed.active);
          })
          .catch(() => {});
      } catch {
        if (switchSeq.current !== seq) return;
        applyStatus({ kind: "disconnected", harness: id });
      }
    },
    [applyStatus, markActive],
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
        applyStatus(next);
        setProfile(name);
      } catch {
        applyStatus({ kind: "disconnected" });
      } finally {
        setEnsuring(false);
      }
    },
    [applyStatus],
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
      return api().onCompanionStatusChanged((next) => applyStatus(next));
    } catch {
      // No bridge (a harness page): nothing to subscribe to.
      return undefined;
    }
  }, [applyStatus]);

  /**
   * The vault that just opened applied its own agent binding.
   *
   * A vault switch can change which companion is in front without this provider
   * ever being asked to switch — the main process applied the vault's binding and
   * pushed the result. So the provider follows the push: the harness state, the
   * picker's active mark, and a re-read of the harness list and the Hermes
   * profiles (the profile list is per agent, so it moved too). It has to happen
   * even when the harness id did not change: a Pi-to-Pi vault switch keeps the
   * id but not necessarily the profile or the active flags.
   *
   * The push is part of the main-process contract; a harness page's partial
   * bridge may not have it, and then this provider behaves exactly as before.
   */
  useEffect(() => {
    const bridge = api();
    // The bridge type promises the method, but a harness page mounts this
    // provider over a partial stub, so the runtime check is the real guard.
    if (typeof bridge.onCompanionHarnessChanged !== "function") return undefined;
    const apply = (payload: CompanionHarnessChanged) => {
      const next = payload?.harness;
      if (next !== "pi" && next !== "hermes") return;
      // The ref first: any status the new agent is publishing right now must be
      // accepted as its own, not dropped as a stale answer from the agent left.
      harnessRef.current = next;
      setHarness(next);
      markActive(next);
      // The vault open applied the binding but the agent's ensure is still
      // running in the background, and the status bus will only say so when it
      // gets there. Marking the switch here is what keeps the chat store from
      // painting a failed list read as an error: it sees `switching` and waits
      // for the ready status, which clears the mark (applyStatus does that for
      // any non-switching answer from this agent).
      setSwitching(next);
      // The harness list itself can change on a vault open (Hermes is offered
      // only when the vault has a Hermes agent), and the status read is the
      // verdict at the moment the push arrived.
      void refreshHarnesses();
    };
    try {
      const off = bridge.onCompanionHarnessChanged(apply);
      // The preload returns the unsubscribe. A harness page's proxy stub answers
      // every unknown method with a function that resolves a Promise, so a
      // subscription it does not know about comes back as a Promise — and React
      // would call that Promise as this effect's cleanup ("destroy is not a
      // function"), taking the whole page down. Only a real unsubscribe is
      // returned; anything else means this bridge has no such push.
      return typeof off === "function" ? off : undefined;
    } catch {
      // No bridge (a harness page): nothing to subscribe to.
      return undefined;
    }
  }, [markActive, refreshHarnesses]);

  const value = useMemo(
    () => ({
      status,
      ensuring,
      switching,
      readyOnce,
      retry,
      harnesses,
      harness,
      useHarness,
      switchHarness,
      refreshHarnesses,
      profiles,
      profile,
      useProfile,
    }),
    [
      status,
      ensuring,
      switching,
      readyOnce,
      retry,
      harnesses,
      harness,
      useHarness,
      switchHarness,
      refreshHarnesses,
      profiles,
      profile,
      useProfile,
    ],
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
