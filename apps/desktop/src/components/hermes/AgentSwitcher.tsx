import { agentIcon } from "@/lib/agent-icons";
import { useOptionalAgents } from "@/state/AgentsProvider";
import { useOptionalCompanion } from "@/state/CompanionProvider";
import type { HarnessId } from "@/vite-env";

/**
 * Which agent answers, as a vertical strip of blocks.
 *
 * One block per agent offered in this domain — an agent scoped to other domains
 * is not drawn at all, rather than drawn greyed: it is not a choice here. The
 * active block wears the accent ring. More agents extend the strip downward.
 */
export function AgentSwitcher() {
  const agents = useOptionalAgents();
  const companion = useOptionalCompanion();
  const visibleAgents = agents?.visibleAgents ?? [];
  const harness = companion?.harness ?? null;
  const useHarness = companion?.useHarness;
  const ensuring = companion?.ensuring ?? false;

  // A harness page mounts the dock with neither provider: nothing to switch.
  if (!companion || !useHarness || visibleAgents.length === 0) return null;

  return (
    <div className="agent-switcher" role="radiogroup" aria-label="Agent">
      {visibleAgents.map((agent) => {
        const active = agent.active || agent.id === harness;
        const icon = agentIcon(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={agent.name}
            title={`${agent.name} — ${agent.blurb}`}
            className={
              active
                ? "agent-switcher__pill agent-switcher__pill--active"
                : "agent-switcher__pill"
            }
            disabled={ensuring && !active}
            onClick={() => {
              if (!active) void useHarness(agent.id as HarnessId);
            }}
          >
            {icon ? (
              <img
                className="agent-switcher__icon"
                src={icon}
                alt=""
                draggable={false}
              />
            ) : (
              <span className="agent-switcher__initial" aria-hidden>
                {agent.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
