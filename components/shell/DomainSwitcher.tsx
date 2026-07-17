"use client";

import { useState } from "react";
import { useShell } from "./ShellProvider";

export function DomainSwitcher() {
  const { domains, activeDomainId, activeDomain, activateDomain, loading } =
    useShell();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(nextId: string) {
    if (!nextId || nextId === activeDomainId) return;
    setPending(true);
    setError(null);
    try {
      await activateDomain(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch domain");
    } finally {
      setPending(false);
    }
  }

  if (loading && domains.length === 0) {
    return (
      <div className="domain-switcher muted" aria-busy="true">
        Loading domains…
      </div>
    );
  }

  if (domains.length === 0) {
    return (
      <div className="domain-switcher muted">No domains</div>
    );
  }

  return (
    <div className="domain-switcher">
      <label className="domain-switcher__label" htmlFor="domain-switcher-select">
        Domain
      </label>
      <select
        id="domain-switcher-select"
        className="domain-switcher__select"
        value={activeDomainId ?? ""}
        disabled={pending}
        onChange={(e) => void onChange(e.target.value)}
        aria-label="Active domain"
        style={
          activeDomain?.color
            ? { borderColor: activeDomain.color }
            : undefined
        }
      >
        {domains.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {error ? (
        <span className="domain-switcher__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
