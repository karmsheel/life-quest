import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AgentHire } from "@lifequest/vault-core";
import { lensSlug, recordVisible } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

type ScannedAgent = {
  id: string;
  name: string;
};

export function PersonnelStudio() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const domains = snapshot?.domains ?? [];

  const [hires, setHires] = useState<AgentHire[]>([]);
  const [scanned, setScanned] = useState<ScannedAgent[]>([]);
  const [disconnected, setDisconnected] = useState(false);
  const [hiresLoading, setHiresLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  useEffect(() => {
    void loadHires();
  }, [loadHires]);

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
          Scan Hermes for agents, hire them onto your roster, and dismiss when
          done.
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
