"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useShell } from "@/components/shell/ShellProvider";

type Hire = {
  id: string;
  name: string;
  roleLabel: string | null;
  hermesAgentId: string;
  domainId: string | null;
  status: string;
};

function ActContent() {
  const { domains } = useShell();
  const [hires, setHires] = useState<Hire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const domainName = useCallback(
    (domainId: string | null) => {
      if (!domainId) return null;
      return domains.find((d) => d.id === domainId)?.name ?? null;
    },
    [domains],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/personnel", {
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => ({}))) as {
          personnel?: Hire[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load personnel");
          setHires([]);
          return;
        }
        setHires(Array.isArray(data.personnel) ? data.personnel : []);
      } catch {
        if (!cancelled) {
          setError("Network error loading personnel");
          setHires([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="act-page">
      <header className="act-page__header">
        <h1 className="stub-page__title">Act</h1>
        <p className="stub-page__desc muted">
          Agents run your How. Hire Hermes agents in Personnel and keep doctrine
          forged so execution stays aligned with Why → What → How.
        </p>
      </header>

      <section className="act-page__section">
        <div className="act-page__section-head">
          <h2 className="act-page__section-title">Active agents</h2>
          <Link href="/personnel" className="doc-btn doc-btn--primary act-page__cta">
            Open Personnel
          </Link>
        </div>

        {error ? (
          <p className="doc-editor__error" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="muted">Loading hires…</p>
        ) : hires.length === 0 ? (
          <div className="act-page__empty">
            <p className="muted">
              No active agents yet. Scan Hermes and hire agents from Personnel.
            </p>
            <Link href="/personnel" className="act-page__link">
              Go to Personnel →
            </Link>
          </div>
        ) : (
          <ul className="act-page__hire-list">
            {hires.map((h) => {
              const domain = domainName(h.domainId);
              return (
                <li key={h.id} className="act-hire">
                  <div>
                    <strong className="act-hire__name">{h.name}</strong>
                    {h.roleLabel ? (
                      <span className="act-hire__role muted"> · {h.roleLabel}</span>
                    ) : null}
                    <p className="act-hire__meta muted">
                      {h.hermesAgentId}
                      {domain ? ` · ${domain}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ActPage() {
  return (
    <RoomLockGate room="act">
      <ActContent />
    </RoomLockGate>
  );
}
