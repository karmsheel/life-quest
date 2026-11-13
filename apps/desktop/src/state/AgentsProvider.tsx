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
import type { AgentScope } from "@lifequest/vault-core/pure";
import { useCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import type { HarnessId, HarnessSummary } from "@/vite-env";

/**
 * One agent, as the switcher and Settings see it.
 *
 * \`visible\` is computed for the domain the operator is looking at: an agent
 * scoped to other domains is not offered in this one. \`defaultFor\` is the set
 * of domains that auto-select it.
 */
export type AgentEntry = HarnessSummary & {
  visible: boolean;
  /** Domains this agent is offered in; empty means every domain. */
  domains: string[];
  defaultFor: string[];
};

type AgentsContextValue = {
  /** Every known agent, with its visibility and domain defaults. */
  agents: AgentEntry[];
  /** The agents offered in the domain the operator is looking at. */
  visibleAgents: AgentEntry[];
  activeDomainSlug: string | null;
  /** The agent this domain auto-selects, if any. */
  domainDefault: HarnessId | null;
  /** Save the whole scope list. */
  setScopes: (scopes: AgentScope[]) => Promise<void>;
  saving: boolean;
  error: string | null;
};

const AgentsContext = createContext<AgentsContextValue | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
  // The fast switch, not the boot one: a domain default moves the dock's agent
  // while the studio is already open, so it must not hold the app still for
  // another agent to come up.
  const {
    harnesses,
    harness,
    switching,
    switchHarness: useHarness,
  } = useCompanion();
  const { snapshot, updateSettings } = useVault();
  const activeDomain = useActiveDomain();
  const slug = activeDomain?.slug ?? null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopes = useMemo<AgentScope[]>(() => {
    const stored = (snapshot?.settings as { agentScopes?: AgentScope[] } | undefined)
      ?.agentScopes;
    return Array.isArray(stored) ? stored : [];
  }, [snapshot]);

  const agents = useMemo<AgentEntry[]>(() => {
    const known = Array.isArray(harnesses) ? harnesses : [];
    return known.map((entry) => {
      const scope = scopes.find((row) => row.agentId === entry.id);
      const domains = scope?.domains ?? [];
      const visible =
        slug === null
          ? domains.length === 0
          : domains.length === 0 || domains.includes(slug);
      return {
        ...entry,
        visible,
        domains,
        defaultFor: scope?.defaultFor ?? [],
      };
    });
  }, [harnesses, scopes, slug]);

  const visibleAgents = useMemo(
    () => agents.filter((agent) => agent.visible),
    [agents],
  );

  const domainDefault = useMemo<HarnessId | null>(() => {
    if (!slug) return null;
    return agents.find((agent) => agent.defaultFor.includes(slug))?.id ?? null;
  }, [agents, slug]);

  /**
   * Entering a domain selects its default agent.
   *
   * The first observation only records the domain: the app boots on whatever
   * companion was chosen globally, and switching away from it on mount would
   * fight that choice. Every later domain change is the operator's move, and a
   * domain that names a default takes it.
   */
  const lastDomain = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!harness || !Array.isArray(harnesses)) return;
    // A switch is in flight: the list and the harness flag are mid-flight facts,
    // and a choice persisted from them would land on whichever vault is open
    // when the call goes out. The move can wait for the switch to settle.
    if (switching) return;
    if (lastDomain.current === undefined) {
      lastDomain.current = slug;
      return;
    }
    const changed = lastDomain.current !== slug;
    lastDomain.current = slug;
    if (!changed) return;
    if (!domainDefault || domainDefault === harness) return;
    if (!visibleAgents.some((agent) => agent.id === domainDefault)) return;
    void useHarness(domainDefault);
  }, [slug, harness, harnesses, domainDefault, visibleAgents, useHarness, switching]);

  /**
   * An agent scoped away from the current domain is not left answering in it:
   * the switcher would show nothing active while its replies kept arriving.
   * The domain default wins, then the main agent (Pi), then whatever is offered.
   */
  useEffect(() => {
    if (!harness || visibleAgents.length === 0) return;
    // The "nothing active" fact this effect repairs is only trustworthy when no
    // switch is in flight. During a vault open the list can trail the harness
    // push by a frame (the old vault's shorter list, the new agent not yet in
    // it), and switching from that transient would persist a different agent
    // onto the vault that was just opened — which is exactly how a Pi-only
    // Alpha switch used to rewrite Beta's Hermes binding to Pi.
    if (switching) return;
    if (visibleAgents.some((agent) => agent.active)) return;
    const next =
      (domainDefault && visibleAgents.find((agent) => agent.id === domainDefault)?.id) ||
      visibleAgents.find((agent) => agent.id === "pi")?.id ||
      visibleAgents[0]!.id;
    if (next !== harness) void useHarness(next);
  }, [harness, visibleAgents, domainDefault, useHarness, switching]);

  const setScopes = useCallback(
    async (next: AgentScope[]) => {
      setSaving(true);
      setError(null);
      try {
        const result = await updateSettings({ agentScopes: next });
        if (!result.ok) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save agent scopes.");
      } finally {
        setSaving(false);
      }
    },
    [updateSettings],
  );

  const value = useMemo<AgentsContextValue>(
    () => ({
      agents,
      visibleAgents,
      activeDomainSlug: slug,
      domainDefault,
      setScopes,
      saving,
      error,
    }),
    [agents, visibleAgents, slug, domainDefault, setScopes, saving, error],
  );

  return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
}

export function useAgents(): AgentsContextValue {
  const ctx = useContext(AgentsContext);
  if (!ctx) throw new Error("useAgents must be used within AgentsProvider");
  return ctx;
}

/**
 * The same context, for a surface that also renders on the e2e harness pages
 * (which mount the dock with only the IPC bridge stubbed). The switcher simply
 * does not draw there.
 */
export function useOptionalAgents(): AgentsContextValue | null {
  return useContext(AgentsContext);
}

/** The agents that are offered right now, for a surface outside the provider. */
export function visibleAgentsOf(agents: AgentEntry[]): AgentEntry[] {
  return agents.filter((agent) => agent.visible);
}
