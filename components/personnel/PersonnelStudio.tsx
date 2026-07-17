"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";

export type ScannedAgent = {
  id: string;
  name: string;
  description?: string;
};

export type Hire = {
  id: string;
  userId: string;
  domainId: string | null;
  hermesAgentId: string;
  name: string;
  roleLabel: string | null;
  status: string;
  createdAt: string;
  dismissedAt: string | null;
};

export function PersonnelStudio() {
  const { domains, activeDomainId } = useShell();
  const [hires, setHires] = useState<Hire[]>([]);
  const [scanned, setScanned] = useState<ScannedAgent[]>([]);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [hiresLoading, setHiresLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const domainName = useCallback(
    (domainId: string | null) => {
      if (!domainId) return null;
      return domains.find((d) => d.id === domainId)?.name ?? null;
    },
    [domains],
  );

  const loadHires = useCallback(async () => {
    setHiresLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/personnel", {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        personnel?: Hire[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load personnel");
        setHires([]);
        return;
      }
      setHires(Array.isArray(data.personnel) ? data.personnel : []);
    } catch {
      setError("Network error loading personnel");
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
    setScanWarning(null);
    setDisconnected(false);
    try {
      const res = await fetch("/api/personnel/scan", {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        agents?: ScannedAgent[];
        warning?: string;
        error?: string;
      };
      if (res.status === 502) {
        setDisconnected(true);
        setScanned([]);
        setError(
          data.error ??
            "Hermes gateway is unreachable. Check Settings → Hermes.",
        );
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Scan failed");
        setScanned([]);
        return;
      }
      setScanned(Array.isArray(data.agents) ? data.agents : []);
      if (data.warning) setScanWarning(data.warning);
      if (!data.agents?.length && !data.warning) {
        setMessage("Scan complete — no agents found.");
      }
    } catch {
      setError("Network error scanning Hermes");
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
      const res = await fetch("/api/personnel", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hermesAgentId: agent.id,
          name: agent.name,
          roleLabel: agent.description ?? undefined,
          domainId: activeDomainId ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        personnel?: Hire;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to hire agent");
        return;
      }
      setMessage(`Hired ${agent.name}.`);
      // Drop from scan list so hire is not repeated accidentally.
      setScanned((prev) => prev.filter((a) => a.id !== agent.id));
      await loadHires();
    } catch {
      setError("Network error hiring agent");
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(hireRow: Hire) {
    setBusyId(`dismiss:${hireRow.id}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/personnel/${hireRow.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to dismiss agent");
        return;
      }
      setMessage(`Dismissed ${hireRow.name}.`);
      await loadHires();
    } catch {
      setError("Network error dismissing agent");
    } finally {
      setBusyId(null);
    }
  }

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
        <p className="doc-editor__error" role="alert">
          {error}
          {disconnected ? (
            <>
              {" "}
              <Link href="/settings" className="personnel-studio__link">
                Open Settings →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {message ? (
        <p className="doc-editor__message" role="status">
          {message}
        </p>
      ) : null}
      {scanWarning ? (
        <p className="personnel-studio__warning" role="status">
          {scanWarning}
        </p>
      ) : null}

      {disconnected ? (
        <div className="personnel-studio__banner" role="status">
          <p className="muted">
            Hermes is disconnected. Configure the gateway base URL and API key
            in Settings, then try scanning again.
          </p>
          <Link href="/settings" className="doc-btn doc-btn--primary">
            Go to Settings
          </Link>
        </div>
      ) : null}

      <section className="personnel-studio__section">
        <div className="personnel-studio__section-head">
          <h2 className="personnel-studio__section-title">Scan</h2>
          <button
            type="button"
            className="doc-btn doc-btn--primary"
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
                    {agent.description ? (
                      <p className="personnel-card__desc muted">
                        {agent.description}
                      </p>
                    ) : null}
                    <p className="personnel-card__meta muted">{agent.id}</p>
                  </div>
                  <button
                    type="button"
                    className="doc-btn doc-btn--primary"
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
            className="doc-btn doc-btn--ghost"
            onClick={() => void loadHires()}
            disabled={hiresLoading}
          >
            Refresh
          </button>
        </div>

        {hiresLoading ? (
          <p className="muted">Loading hires…</p>
        ) : hires.length === 0 ? (
          <p className="muted personnel-studio__empty">
            No active agents. Scan Hermes and hire someone to get started.
          </p>
        ) : (
          <ul className="personnel-studio__list">
            {hires.map((h) => {
              const domain = domainName(h.domainId);
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
                    className="doc-btn doc-btn--danger"
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
