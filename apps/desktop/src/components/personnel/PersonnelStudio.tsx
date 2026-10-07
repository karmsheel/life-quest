import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AgentHire, ConnectedAgent } from "@lifequest/vault-core";
import { lensSlug, recordVisible } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

type ScannedAgent = {
  id: string;
  name: string;
};

/**
 * KAR-70: an invite code, shown once at the mint that produced it. Only the
 * id and the expiry survive that panel — the vault keeps a hash, so the
 * code cannot be recovered afterwards.
 */
type MintedInvite = { id: string; code: string; expiresAt: string };

/** An invite still waiting to be used. Never carries its code. */
type UnusedInvite = { id: string; expiresAt: string };

export function PersonnelStudio() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const domains = snapshot?.domains ?? [];
  // Assignment takes a live domain only; an archived one is not offered.
  const liveDomains = domains.filter((d) => !d.meta.archivedAt);

  const [hires, setHires] = useState<AgentHire[]>([]);
  const [scanned, setScanned] = useState<ScannedAgent[]>([]);
  const [disconnected, setDisconnected] = useState(false);
  const [hiresLoading, setHiresLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // KAR-70: the roster of MCP callers. A different roster from the scanned
  // Hermes hires below, and not merged with them.
  const [agents, setAgents] = useState<ConnectedAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [invite, setInvite] = useState<MintedInvite | null>(null);
  const [unusedInvites, setUnusedInvites] = useState<UnusedInvite[]>([]);

  const domainName = useCallback(
    (slug: string | null) => {
      if (!slug) return null;
      return domains.find((d) => d.slug === slug)?.meta.name ?? slug;
    },
    [domains],
  );

  const loadHires = useCallback(async () => {
    setHiresLoading(true);
    setError(null);
    try {
      const result = await api().agentsList();
      if (!result.ok) {
        setError(result.error);
        setHires([]);
        return;
      }
      // Active roster only (dismissed stay in agents.json history).
      setHires(result.value.filter((h) => h.status === "active"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personnel");
      setHires([]);
    } finally {
      setHiresLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const result = await api().connectedAgentsList();
      setAgents(result.ok ? result.value : []);
    } catch {
      setAgents([]);
    }
    // The unused-invite list is separate: it lives in userData, not the vault.
    try {
      const invites = await api().connectedAgentsListInvites();
      setUnusedInvites(invites.ok ? invites.value : []);
    } catch {
      setUnusedInvites([]);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHires();
  }, [loadHires]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  async function grant(
    agent: ConnectedAgent,
    patch: {
      access?: "read" | "write";
      domainSlugs?: string[];
      schedule?: boolean;
    },
  ) {
    setBusyId(`agent:${agent.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await api().connectedAgentsUpdate(agent.id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Updated ${agent.name}.`);
      await loadAgents();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update agent access",
      );
    } finally {
      setBusyId(null);
    }
  }

  function toggleDomain(agent: ConnectedAgent, slug: string, on: boolean) {
    const next = on
      ? [...agent.domainSlugs, slug]
      : agent.domainSlugs.filter((s) => s !== slug);
    void grant(agent, { domainSlugs: next });
  }

  async function revoke(agent: ConnectedAgent) {
    setBusyId(`agent:${agent.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await api().connectedAgentsRevoke(agent.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Revoked ${agent.name}.`);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke agent");
    } finally {
      setBusyId(null);
    }
  }

  async function mint() {
    setBusyId("invite");
    setError(null);
    setMessage(null);
    try {
      const result = await api().connectedAgentsInvite();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Shown once. The vault keeps only the hash, so there is no second read.
      setInvite({
        id: result.value.id,
        code: result.value.code,
        expiresAt: result.value.expiresAt,
      });
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint an invite");
    } finally {
      setBusyId(null);
    }
  }

  async function dropInvite(id: string) {
    // Named by id. An invite that is already used, or unknown, comes back as
    // a failure rather than a silent success — the code is still there.
    setBusyId(`invite:${id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await api().connectedAgentsDropInvite(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setInvite((prev) => (prev && prev.id === id ? null : prev));
      setMessage("Dropped the unused invite.");
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to drop the invite");
    } finally {
      setBusyId(null);
    }
  }

  async function scan() {
    setScanning(true);
    setError(null);
    setMessage(null);
    setDisconnected(false);
    try {
      const result = await api().hermesScanAgents();
      if (!result.ok) {
        const err = result.error;
        const looksDisconnected =
          /not set|not configured|timed out|could not reach|unreachable|gateway/i.test(
            err,
          );
        setDisconnected(looksDisconnected);
        setError(err);
        setScanned([]);
        return;
      }
      setScanned(result.value);
      if (result.value.length === 0) {
        setMessage("Scan complete — no agents found.");
      } else {
        setMessage(`Found ${result.value.length} agent(s).`);
      }
    } catch (err) {
      setDisconnected(true);
      setError(err instanceof Error ? err.message : "Network error scanning Hermes");
      setScanned([]);
    } finally {
      setScanning(false);
    }
  }

  async function hire(agent: ScannedAgent) {
    setBusyId(`hire:${agent.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await api().agentsHire({
        hermesAgentId: agent.id,
        name: agent.name,
        domainSlug: lensSlug(lens),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Hired ${agent.name}.`);
      setScanned((prev) => prev.filter((a) => a.id !== agent.id));
      await loadHires();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to hire agent");
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(hireRow: AgentHire) {
    setBusyId(`dismiss:${hireRow.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await api().agentsDismiss(hireRow.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Dismissed ${hireRow.name}.`);
      await loadHires();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss agent");
    } finally {
      setBusyId(null);
    }
  }

  const visibleHires = hires.filter((h) =>
    recordVisible(lens, h.domainSlug),
  );
  const hiredAgentIds = new Set(hires.map((h) => h.hermesAgentId));

  return (
    <div className="personnel-studio">
      <header className="personnel-studio__header">
        <h1 className="stub-page__title">Personnel</h1>
        <p className="stub-page__desc muted">
          The companion, the agents connected over MCP, and the Hermes agents you
          have hired.
        </p>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
          {disconnected ? (
            <>
              {" "}
              <Link to="/settings" className="personnel-studio__link">
                Open Settings →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}

      {disconnected ? (
        <div className="personnel-studio__banner" role="status">
          <p className="muted">
            Hermes is unreachable. Configure the gateway base URL and API key in
            Settings, then try scanning again.
          </p>
          <Link to="/settings" className="btn btn-primary">
            Go to Settings
          </Link>
        </div>
      ) : null}

      {/* KAR-70: the companion is pre-paired and keeps the whole vault. It has
          no domain editor, no Write or Schedule switch, and no revoke — there is
          nothing to grant it that it does not already have. */}
      <section className="personnel-studio__section">
        <div className="personnel-studio__section-head">
          <h2 className="personnel-studio__section-title">Companion</h2>
        </div>
        <ul className="personnel-studio__list">
          <li className="personnel-card">
            <div className="personnel-card__body">
              <strong className="personnel-card__name">Hermes</strong>
              <p className="personnel-card__meta muted">
                Full access · this vault
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section className="personnel-studio__section">
        <div className="personnel-studio__section-head">
          <h2 className="personnel-studio__section-title">Connected agents</h2>
          <div className="personnel-studio__section-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void mint()}
              disabled={busyId === "invite"}
            >
              {busyId === "invite" ? "…" : "Invite an agent"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadAgents()}
              disabled={agentsLoading}
            >
              Refresh
            </button>
          </div>
        </div>

        {invite ? (
          <div className="personnel-studio__invite" role="status">
            <p className="muted">
              Send this code to the agent. It is shown once and expires{" "}
              {new Date(invite.expiresAt).toLocaleString()}.
            </p>
            <code className="personnel-studio__code">{invite.code}</code>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void dropInvite(invite.id)}
              disabled={busyId === `invite:${invite.id}`}
            >
              Drop
            </button>
          </div>
        ) : null}

{unusedInvites.length > 0 ? (
          <div className="personnel-studio__invites">
            <h3 className="personnel-studio__section-subtitle muted">
              Unused invites
            </h3>
            <ul className="personnel-studio__list">
              {unusedInvites.map((row) => (
                <li key={row.id} className="personnel-card">
                  <div className="personnel-card__body">
                    <p className="personnel-card__meta muted">
                      expires {new Date(row.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busyId === `invite:${row.id}`}
                    onClick={() => void dropInvite(row.id)}
                  >
                    {busyId === `invite:${row.id}` ? "…" : "Drop"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {agentsLoading ? (
          <p className="muted">Loading connected agents…</p>
        ) : agents.length === 0 ? (
          <p className="muted personnel-studio__empty">
            No connected agents. Invite one, or open the local door with a new
            bearer and a name to file a pairing Decision.
          </p>
        ) : (
          <ul className="personnel-studio__list">
            {agents.map((agent) => (
              <li key={agent.id} className="personnel-card">
                <div className="personnel-card__body">
                  <strong className="personnel-card__name">{agent.name}</strong>
                  <p className="personnel-card__meta muted">
                    {agent.fingerprint} · {agent.door} door
                  </p>

                  {agent.status === "pending" ? (
                    // The pairing Decision in Decisions is where a caller's
                    // approval happens. There is deliberately no approve
                    // control on this row.
                    <p className="personnel-card__meta">Waiting for approval</p>
                  ) : (
                    <>
                      <fieldset className="personnel-studio__domains">
                        <legend className="muted">Domains</legend>
                        {liveDomains.length === 0 ? (
                          <p className="muted">No live domains.</p>
                        ) : (
                          liveDomains.map((d) => (
                            <label
                              key={d.slug}
                              className="personnel-studio__check"
                            >
                              <input
                                type="checkbox"
                                checked={agent.domainSlugs.includes(d.slug)}
                                disabled={busyId === `agent:${agent.id}`}
                                onChange={(e) =>
                                  toggleDomain(agent, d.slug, e.target.checked)
                                }
                              />
                              <span>{d.meta.name}</span>
                            </label>
                          ))
                        )}
                      </fieldset>

                      <label className="personnel-studio__switch">
                        <input
                          type="checkbox"
                          checked={agent.access === "write"}
                          disabled={busyId === `agent:${agent.id}`}
                          onChange={(e) =>
                            void grant(agent, {
                              access: e.target.checked ? "write" : "read",
                            })
                          }
                        />
                        <span>Write</span>
                      </label>

                      <label className="personnel-studio__switch">
                        <input
                          type="checkbox"
                          checked={agent.schedule}
                          disabled={busyId === `agent:${agent.id}`}
                          onChange={(e) =>
                            void grant(agent, { schedule: e.target.checked })
                          }
                        />
                        <span>Schedule</span>
                      </label>
                    </>
                  )}
                </div>

                {agent.status === "active" ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busyId === `agent:${agent.id}`}
                    onClick={() => void revoke(agent)}
                  >
                    {busyId === `agent:${agent.id}` ? "…" : "Revoke"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="personnel-studio__section">
        <div className="personnel-studio__section-head">
          <h2 className="personnel-studio__section-title">Scan</h2>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void scan()}
            disabled={scanning}
          >
            {scanning ? "Scanning…" : "Scan Hermes agents"}
          </button>
        </div>

        {scanned.length === 0 ? (
          <p className="muted personnel-studio__empty">
            {scanning
              ? "Probing Hermes…"
              : "No scan results yet. Run a scan to list available agents."}
          </p>
        ) : (
          <ul className="personnel-studio__list">
            {scanned.map((agent) => {
              const alreadyHired = hiredAgentIds.has(agent.id);
              return (
                <li key={agent.id} className="personnel-card">
                  <div className="personnel-card__body">
                    <strong className="personnel-card__name">{agent.name}</strong>
                    <p className="personnel-card__meta muted">{agent.id}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={alreadyHired || busyId === `hire:${agent.id}`}
                    onClick={() => void hire(agent)}
                  >
                    {alreadyHired
                      ? "Hired"
                      : busyId === `hire:${agent.id}`
                        ? "…"
                        : "Hire"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="personnel-studio__section">
        <div className="personnel-studio__section-head">
          <h2 className="personnel-studio__section-title">Active hires</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void loadHires()}
            disabled={hiresLoading}
          >
            Refresh
          </button>
        </div>

        {hiresLoading ? (
          <p className="muted">Loading hires…</p>
        ) : visibleHires.length === 0 ? (
          <p className="muted personnel-studio__empty">
            No active agents. Scan Hermes and hire someone to get started.
          </p>
        ) : (
          <ul className="personnel-studio__list">
            {visibleHires.map((h) => {
              const domain = domainName(h.domainSlug);
              return (
                <li key={h.id} className="personnel-card">
                  <div className="personnel-card__body">
                    <strong className="personnel-card__name">{h.name}</strong>
                    {h.roleLabel ? (
                      <span className="personnel-card__role muted">
                        {" "}
                        · {h.roleLabel}
                      </span>
                    ) : null}
                    <p className="personnel-card__meta muted">
                      {h.hermesAgentId}
                      {domain ? ` · ${domain}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busyId === `dismiss:${h.id}`}
                    onClick={() => void dismiss(h)}
                  >
                    {busyId === `dismiss:${h.id}` ? "…" : "Dismiss"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}