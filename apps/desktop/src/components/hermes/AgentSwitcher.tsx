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
 *
 * The ring moves on the click, and a switch that is still coming up wears a
 * quiet pending mark on the target. Neither the strip nor the rest of the app is
 * taken away for it: an agent is a service the studio talks to, not a page it
 * navigates to, so changing one must not read as a reconnection.
 */
export function AgentSwitcher() {
  const agents = useOptionalAgents();
  const companion = useOptionalCompanion();
  const visibleAgents = agents?.visibleAgents ?? [];
  const harness = companion?.harness ?? null;
  const switchHarness = companion?.switchHarness;
  const switching = companion?.switching ?? null;
  const ensuring = companion?.ensuring ?? false;

  // A harness page mounts the dock with neither provider: nothing to switch.
  if (!companion || !switchHarness || visibleAgents.length === 0) return null;

  return (
    <div className="agent-switcher" role="radiogroup" aria-label="Agent">
      {visibleAgents.map((agent) => {
        const id = agent.id as HarnessId;
        const active = agent.active || id === harness;
        const pending = switching === id;
        const icon = agentIcon(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={agent.name}
            aria-busy={pending || undefined}
            title={
              pending
                ? `${agent.name} — coming up`
                : `${agent.name} — ${agent.blurb}`
            }
            className={[
              "agent-switcher__pill",
              active ? "agent-switcher__pill--active" : "",
              pending ? "agent-switcher__pill--pending" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            // Only the first connect disables the strip: a switch is the app
            // working, and a control that goes dead under the pointer is the
            // jitter this surface exists to avoid.
            disabled={ensuring && !active}
            onClick={() => {
              if (!active) void switchHarness(id);
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
