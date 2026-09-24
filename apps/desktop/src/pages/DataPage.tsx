import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { DatabaseListEntry } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";

export default function DataPage() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<DatabaseListEntry[]>([]);
  const [name, setName] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const domainSlug = lens.kind === "domain" ? lens.slug : null;
  const showDomainSelect = lens.kind !== "domain";
  const liveDomains = (snapshot?.domains ?? []).filter((d) => !d.meta.archivedAt);

  const load = useCallback(async () => {
    const res = await api().dbList(domainSlug);
    if (res.ok) {
      setEntries(res.value as DatabaseListEntry[]);
    } else {
      setError(res.error);
    }
  }, [domainSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (showDomainSelect && !selectedDomain) {
      setError("Select a domain to create a database in.");
      return;
    }
    const target = showDomainSelect ? selectedDomain : domainSlug;
    if (!target) {
      setError("No domain available.");
      return;
    }
    setBusy(true);
    try {
      const res = await api().dbCreate(target, { name });
      if (!res.ok) {
        setError(res.error);
      } else {
        setName("");
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="page-content">
      <header className="stub-page__header">
        <p className="muted stub-page__eyebrow">Data</p>
        <h1 className="stub-page__title">Data</h1>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={onCreate} className="data-new-form">
        <input
          type="text"
          placeholder="New database name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="input-field"
        />
        {showDomainSelect ? (
          <select
            value={selectedDomain}
            onChange={(e) => setSelectedDomain(e.target.value)}
            className="input-field"
          >
            <option value="">Select domain…</option>
            {liveDomains.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.meta.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="submit" className="btn" disabled={busy || !name.trim()}>
          New database
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="muted">No databases yet.</p>
      ) : (
        <ul className="database-list">
          {entries.map((entry) => (
            <li key={`${entry.domainSlug}-${entry.database.id}`} className="database-list__item">
              <button
                className="database-list__open"
                onClick={() => navigate(`/data/${entry.domainSlug}/${entry.database.id}`)}
              >
                <span className="database-list__name">{entry.database.name}</span>
                {lens.kind !== "domain" ? (
                  <span className="muted database-list__domain">{entry.domainSlug}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
