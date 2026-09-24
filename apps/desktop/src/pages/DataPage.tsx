import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type {
  DatabaseListEntry,
  IngestFileResult,
  IngestSourceKind,
} from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { Button } from "@/components/ui/Button";

export default function DataPage() {
  const { snapshot } = useVault();
  const lens = useDomainLens();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<DatabaseListEntry[]>([]);
  const [name, setName] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [selectedDbId, setSelectedDbId] = useState<string>("");
  const [pendingMap, setPendingMap] = useState<{
    fingerprint: string;
    sourceKind: IngestSourceKind;
    sourceColumns: string[];
    mappingId: string;
    columnIds: Record<string, string>;
  } | null>(null);

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

  const targetDomain = showDomainSelect ? selectedDomain : domainSlug;
  const domainEntries = entries.filter((e) => e.domainSlug === targetDomain);

  async function onIngestFile(file: File) {
    setError(null);
    setIngestStatus(null);
    if (!targetDomain) {
      setError("Select a domain first.");
      return;
    }
    if (!selectedDbId) {
      setError("Select a database to ingest into.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await api().ingestFile(targetDomain, {
      databaseId: selectedDbId,
      bytes,
      mime: file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "text/csv"),
      name: file.name,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const value = res.value as IngestFileResult;
    if (value.kind === "needs-mapping") {
      const db = domainEntries.find((e) => e.database.id === selectedDbId)?.database;
      const columnIds: Record<string, string> = {};
      for (const src of value.sourceColumns) {
        const match = db?.columns.find(
          (c) => c.name.toLowerCase() === src.trim().toLowerCase(),
        );
        columnIds[src] = match?.id ?? "";
      }
      const mappingId =
        value.decision.target.type === "mapping"
          ? value.decision.target.mappingId
          : "";
      setPendingMap({
        fingerprint: value.fingerprint,
        sourceKind: value.sourceKind,
        sourceColumns: value.sourceColumns,
        mappingId,
        columnIds,
      });
      setIngestStatus(
        "Map source columns, then submit. The mapping is a Decision; rows are not posted yet.",
      );
    } else if (value.kind === "staged") {
      setPendingMap(null);
      setIngestStatus(`Staged ${value.rows.length} rows.`);
      navigate(`/data/${targetDomain}/${selectedDbId}`);
    }
  }

  async function onProposeMapping(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pendingMap || !targetDomain || !selectedDbId) {
      setError("Select a domain and database to propose a mapping.");
      return;
    }
    const res = await api().ingestProposeMapping(targetDomain, {
      mappingId: pendingMap.mappingId || undefined,
      databaseId: selectedDbId,
      fingerprint: pendingMap.fingerprint,
      sourceKind: pendingMap.sourceKind,
      columns: pendingMap.sourceColumns.map((source) => ({
        source,
        columnId: pendingMap.columnIds[source] ?? "",
      })),
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPendingMap(null);
    setIngestStatus(
      "Mapping proposed as a Decision. Approve it, then drop the file again to stage rows.",
    );
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void onIngestFile(file);
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
        <p className="form-error" role="alert">{error}</p>
      ) : null}
      {ingestStatus ? (
        <p className="form-info" role="status">{ingestStatus}</p>
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
              <option key={d.slug} value={d.slug}>{d.meta.name}</option>
            ))}
          </select>
        ) : null}
        <Button type="submit" disabled={busy || !name.trim()}>New database</Button>
      </form>

      <section className="ingest-drop-zone">
        <p className="muted">Drop a .csv or .pdf file here to ingest rows.</p>
        <select
          value={selectedDbId}
          onChange={(e) => setSelectedDbId(e.target.value)}
          className="input-field"
        >
          <option value="">Select target database…</option>
          {domainEntries.map((entry) => (
            <option key={entry.database.id} value={entry.database.id}>
              {entry.database.name}
            </option>
          ))}
        </select>
        <div
          className="drop-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          Drop .csv or .pdf file here
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onIngestFile(f);
          }}
        />
        {pendingMap ? (
          <form onSubmit={onProposeMapping} className="ingest-mapping-form">
            <p className="muted">Map each source column to a database column.</p>
            {pendingMap.sourceColumns.map((src) => (
              <label key={src}>
                {src}
                <select
                  className="input-field"
                  value={pendingMap.columnIds[src] ?? ""}
                  onChange={(e) =>
                    setPendingMap((prev) =>
                      prev
                        ? {
                            ...prev,
                            columnIds: { ...prev.columnIds, [src]: e.target.value },
                          }
                        : prev,
                    )
                  }
                >
                  <option value="">—</option>
                  {(domainEntries.find((en) => en.database.id === selectedDbId)?.database
                    .columns ?? []).map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Button type="submit">Propose mapping</Button>
          </form>
        ) : null}
      </section>

      {entries.length === 0 ? (
        <p className="muted">No databases yet.</p>
      ) : (
        <ul className="database-list">
          {entries.map((entry) => {
            const domainName =
              liveDomains.find((d) => d.slug === entry.domainSlug)?.meta.name ??
              entry.domainSlug;
            return (
            <li key={`${entry.domainSlug}-${entry.database.id}`} className="database-list__item">
              <button
                type="button"
                className="database-list__open"
                onClick={() => navigate(`/data/${entry.domainSlug}/${entry.database.id}`)}
              >
                <span className="database-list__name">{entry.database.name}</span>
                {lens.kind !== "domain" ? (
                  <span className="muted database-list__domain">{domainName}</span>
                ) : null}
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
