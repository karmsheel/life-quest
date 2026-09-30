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
  const [dragOver, setDragOver] = useState(false);
  const [selectedDbId, setSelectedDbId] = useState<string>("");
  const [installedKits, setInstalledKits] = useState<string[] | null>(null);
  const [defaultCaptureAccount, setDefaultCaptureAccount] = useState<string | null>(null);
  const [transactionalAccounts, setTransactionalAccounts] = useState<Array<{ id: string; name: string }>>([]);
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
  const financialLive = liveDomains.some((d) => d.slug === "financial");
  const showFinanceInstall =
    financialLive &&
    installedKits !== null &&
    !installedKits.includes("finance") &&
    (lens.kind !== "domain" || lens.slug === "financial");

  const load = useCallback(async () => {
    const res = await api().dbList(domainSlug);
    if (res.ok) {
      setEntries(res.value as DatabaseListEntry[]);
    } else {
      setError(res.error);
    }
    const kitRes = await api().kitList("financial");
    setInstalledKits(kitRes.ok ? (kitRes.value as string[]) : []);

    // Load financial capture settings if financial domain is live and kit installed
    const finLive = snapshot?.domains.some((d) => d.slug === "financial" && !d.meta.archivedAt);
    const kitInstalled = kitRes.ok && (kitRes.value as string[]).includes("finance");
    if (finLive && kitInstalled) {
      const settingsRes = await api().kitFinanceSettings();
      if (settingsRes.ok && settingsRes.value) {
        const settings = settingsRes.value as { defaultCaptureAccountId?: string | null; homeCurrency?: string };
        setDefaultCaptureAccount(settings.defaultCaptureAccountId ?? null);
      }
      // Load accounts
      const accountsRes = await api().dbListRows("financial", "finance:accounts");
      if (accountsRes.ok && Array.isArray(accountsRes.value)) {
        const accounts = accountsRes.value as Array<{ id: string; cells: Record<string, unknown> }>;
        const transactional = accounts.filter((a) => {
          const type = a.cells.type as string;
          return ["checking", "credit", "cash", "other"].includes(type);
        });
        setTransactionalAccounts(transactional.map((a) => ({ id: a.id, name: a.cells.name as string })));
      }
    }
  }, [domainSlug, snapshot?.domains]);

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
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void onIngestFile(file);
  }

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  return (
    <div className="page-content data-studio">
      <header className="data-studio__header">
        <p className="data-studio__eyebrow">Data</p>
        <h1 className="data-studio__title">Databases</h1>
        <p className="data-studio__lead">
          Domain books in this vault. Create one here, or import rows from a file.
        </p>
      </header>

      {error ? (
        <p className="data-studio__banner data-studio__banner--error" role="alert">{error}</p>
      ) : null}
      {ingestStatus ? (
        <p className="data-studio__banner" role="status">{ingestStatus}</p>
      ) : null}

      <div className="data-studio__layout">
        <section className="data-studio__panel" aria-labelledby="data-databases-heading">
          <div className="data-studio__panel-head">
            <h2 id="data-databases-heading">Databases</h2>
            <span className="data-studio__count">{entries.length}</span>
          </div>
          {entries.length === 0 ? (
            <p className="data-studio__empty">No databases yet.</p>
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
                      <span className="database-list__copy">
                        <span className="database-list__name">{entry.database.name}</span>
                        <span className="database-list__sub">
                          {columnCountLabel(entry.database.columns.length)}
                          {" · "}
                          {sourceLabel(entry.database.sotMode)}
                          {" · "}
                          {entry.database.updatedAt.slice(0, 10)}
                        </span>
                      </span>
                      {lens.kind !== "domain" ? (
                        <span className="database-list__domain">{domainName}</span>
                      ) : null}
                      <svg className="database-list__chevron" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="data-studio__panel-foot">
            <Button onClick={async () => {
              const res = await api().dbSync(domainSlug ?? "");
              if (!res.ok) {
                setError(res.error);
              } else {
                await load();
              }
            }}>Refresh linked</Button>
          </div>
        </section>

        <div className="data-studio__rail">
          <section className="data-studio__panel" aria-labelledby="data-create-heading">
            <div className="data-studio__panel-head">
              <h2 id="data-create-heading">New database</h2>
            </div>
            <form onSubmit={onCreate} className="data-new-form">
              <label className="data-field">
                <span className="data-field__label">Name</span>
                <input
                  type="text"
                  placeholder="New database name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  className="input-field"
                />
              </label>
              {showDomainSelect ? (
                <label className="data-field">
                  <span className="data-field__label">Domain</span>
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
                </label>
              ) : null}
              <Button type="submit" variant="primary" className="data-studio__submit" disabled={busy || !name.trim()}>
                New database
              </Button>
            </form>
          </section>

          <section className="data-studio__panel ingest-drop-zone" aria-labelledby="data-import-heading">
            <div className="data-studio__panel-head">
              <h2 id="data-import-heading">Import</h2>
            </div>
            <p className="data-studio__hint">Drop a .csv or .pdf file to ingest rows into one database.</p>
            <label className="data-field">
              <span className="data-field__label">Target database</span>
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
            </label>
            <button
              type="button"
              className={dragOver ? "drop-zone is-hot" : "drop-zone"}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="drop-zone__title">Drop a .csv or .pdf file</span>
              <span className="drop-zone__hint">or click to choose one</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.pdf,text/csv,application/pdf"
              className="data-studio__file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onIngestFile(f);
                e.target.value = "";
              }}
            />
            {pendingMap ? (
              <form onSubmit={onProposeMapping} className="ingest-mapping-form">
                <p className="data-studio__hint">Map each source column to a database column.</p>
                {pendingMap.sourceColumns.map((src) => (
                  <label key={src} className="data-field data-field--map">
                    <span className="data-field__label">{src}</span>
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
                <Button type="submit" variant="primary" className="data-studio__submit">Propose mapping</Button>
              </form>
            ) : null}
          </section>

          {showFinanceInstall ? (
            <section className="data-studio__panel data-rail__finance-cta">
              <div className="data-studio__panel-head">
                <h2>Finance</h2>
              </div>
              <p className="data-studio__hint">
                Install the kit into the Financial domain. It adds the ledger databases and starter pages.
              </p>
              <Button
                variant="primary"
                className="data-studio__submit"
                onClick={async () => {
                  const res = await api().kitInstallFinance();
                  if (!res.ok) {
                    setError(res.error);
                  } else {
                    setInstalledKits(["finance"]);
                    await load();
                  }
                }}
              >
                Install Finance kit
              </Button>
            </section>
          ) : null}

          {installedKits?.includes("finance") ? (
            <section className="data-studio__panel data-rail__capture-account">
              <div className="data-studio__panel-head">
                <h2>Capture</h2>
              </div>
              <label className="data-field">
                <span className="data-field__label">Default capture account</span>
                <select
                  value={defaultCaptureAccount ?? ""}
                  onChange={async (e) => {
                    const value = e.target.value || null;
                    const res = await api().kitSetCaptureAccount(value);
                    if (!res.ok) {
                      setError(res.error);
                    } else {
                      setDefaultCaptureAccount(value);
                    }
                  }}
                  className="input-field"
                >
                  <option value="">Ask each time</option>
                  {transactionalAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function columnCountLabel(count: number): string {
  return count === 1 ? "1 column" : `${count} columns`;
}

function sourceLabel(mode: string): string {
  if (mode === "linked-canonical") return "Linked";
  if (mode === "local-canonical-mirror") return "Mirror";
  return "Local";
}
