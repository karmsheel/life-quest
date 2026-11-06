import type { AgentScope } from "@lifequest/vault-core/pure";
import { agentIcon } from "@/lib/agent-icons";
import { useAgents, type AgentEntry } from "@/state/AgentsProvider";
import { useVault } from "@/state/VaultProvider";

/**
 * Which domains each agent is offered in, and where entering a domain selects
 * it.
 *
 * "Shown in" is the visibility rule: no chips selected means every domain. A
 * narrowed agent is simply absent from the switcher outside its domains, not
 * greyed out. "Default in" is a subset of that list, so an agent cannot be the
 * default for a domain it is hidden in.
 */
export function SettingsAgents() {
  const { agents, setScopes, saving, error } = useAgents();
  const { snapshot } = useVault();
  const domains = (snapshot?.domains ?? []).filter((domain) => !domain.meta.archivedAt);

  function save(next: AgentEntry[]) {
    const scopes: AgentScope[] = next.map((agent) => ({
      agentId: agent.id,
      domains: agent.domains,
      defaultFor: agent.defaultFor,
    }));
    void setScopes(scopes);
  }

  function setDomains(agent: AgentEntry, domainsFor: string[]) {
    // A default that is no longer shown is not a default: prune it with the
    // visibility change rather than leaving a rule that can never fire.
    const defaultFor = agent.defaultFor.filter((slug) => domainsFor.includes(slug));
    save(agents.map((row) => (row.id === agent.id ? { ...row, domains: domainsFor, defaultFor } : row)));
  }

  function toggleVisible(agent: AgentEntry, slug: string) {
    if (agent.domains.length === 0) {
      // From "every domain" into a narrow list: start at this domain.
      setDomains(agent, [slug]);
      return;
    }
    const next = agent.domains.includes(slug)
      ? agent.domains.filter((entry) => entry !== slug)
      : [...agent.domains, slug];
    setDomains(agent, next);
  }

  function toggleDefault(agent: AgentEntry, slug: string) {
    const defaultFor = agent.defaultFor.includes(slug)
      ? agent.defaultFor.filter((entry) => entry !== slug)
      : [...agent.defaultFor, slug];
    save(agents.map((row) => (row.id === agent.id ? { ...row, defaultFor } : row)));
  }

  return (
    <section className="settings-agents" data-testid="settings-agents">
      <h3 className="settings-hermes__heading">Agents by domain</h3>
      <p className="settings-card__desc">
        An agent with no domains selected is offered everywhere. An agent set as
        the default for a domain is selected when you enter it.
      </p>
      {agents.map((agent) => {
        const icon = agentIcon(agent.id);
        const shownDomains = domains.filter(
          (domain) => agent.domains.length === 0 || agent.domains.includes(domain.slug),
        );
        return (
          <div className="settings-agent" key={agent.id}>
            <div className="settings-agent__head">
              <span className="settings-agent__mark">
                {icon ? (
                  <img src={icon} alt="" draggable={false} />
                ) : (
                  <span aria-hidden>{agent.name.charAt(0)}</span>
                )}
              </span>
              <div className="settings-agent__name">
                <strong>{agent.name}</strong>
                <span className="muted">{agent.blurb}</span>
              </div>
            </div>

            <div className="settings-agent__group">
              <span className="settings-agent__label">Shown in</span>
              <div className="settings-agent__chips">
                <button
                  type="button"
                  className={
                    agent.domains.length === 0
                      ? "settings-chip settings-chip--on"
                      : "settings-chip"
                  }
                  aria-pressed={agent.domains.length === 0}
                  aria-label={`${agent.name}: all domains`}
                  disabled={saving}
                  onClick={() => setDomains(agent, [])}
                >
                  All domains
                </button>
                {domains.map((domain) => (
                  <button
                    key={domain.slug}
                    type="button"
                    className={
                      agent.domains.includes(domain.slug)
                        ? "settings-chip settings-chip--on"
                        : "settings-chip"
                    }
                    aria-pressed={agent.domains.includes(domain.slug)}
                    aria-label={`${agent.name}: ${domain.meta.name}`}
                    disabled={saving}
                    onClick={() => toggleVisible(agent, domain.slug)}
                  >
                    {domain.meta.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-agent__group">
              <span className="settings-agent__label">Default in</span>
              <div className="settings-agent__chips">
                {shownDomains.map((domain) => (
                    <button
                      key={domain.slug}
                      type="button"
                      className={
                        agent.defaultFor.includes(domain.slug)
                          ? "settings-chip settings-chip--on"
                          : "settings-chip"
                      }
                      aria-pressed={agent.defaultFor.includes(domain.slug)}
                      aria-label={`${agent.name}: default in ${domain.meta.name}`}
                      disabled={saving}
                      onClick={() => toggleDefault(agent, domain.slug)}
                    >
                      {domain.meta.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      {error ? (
        <p className="settings-hermes__probe settings-hermes__probe--fail" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
