import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  DatabaseColumn,
  DatabaseListEntry,
  DatabaseMeta,
  DatabaseRow,
  IngestBatch,
  IngestRow,
  SyncConflict,
} from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { Button } from "@/components/ui/Button";

async function loadBatches(slug: string, id: string, setBatches: (b: IngestBatch[]) => void, setErr: (e: string | null) => void) {
  const res = await api().ingestListBatches(slug, id);
  if (res.ok) {
    setBatches((res.value as IngestBatch[]).filter((b) => b.status !== "accepted"));
  } else {
    setErr(res.error);
  }
}

export default function DatabasePage() {
  const { slug = "", dbId = "" } = useParams<{ slug: string; dbId: string }>();
  const navigate = useNavigate();
  const { snapshot } = useVault();

  const [meta, setMeta] = useState<DatabaseMeta | null>(null);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState("text");
  const [newColOptions, setNewColOptions] = useState("");
  const [newColRelation, setNewColRelation] = useState("");
  const [colError, setColError] = useState<string | null>(null);
  const [domainDbs, setDomainDbs] = useState<DatabaseListEntry[]>([]);
  const [ingestBatches, setIngestBatches] = useState<IngestBatch[]>([]);

  // KAR-59 adapter state
  const [adapterKind, setAdapterKind] = useState<"google-sheet" | "notion" | "url">("google-sheet");
  const [adapterBindingId, setAdapterBindingId] = useState("");
  const [adapterSecret, setAdapterSecret] = useState("");
  const [adapterSotMode, setAdapterSotMode] = useState<"linked-canonical" | "local-canonical-mirror">("linked-canonical");
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  const load = useCallback(async () => {
    const metaRes = await api().dbGet(slug, dbId);
    if (!metaRes.ok) {
      setLoadError(metaRes.error);
      return;
    }
    setLoadError(null);
    setMeta(metaRes.value as DatabaseMeta);
    const [rowsRes, listRes] = await Promise.all([
      api().dbListRows(slug, dbId),
      api().dbList(slug),
    ]);
    if (rowsRes.ok) {
      setRows(rowsRes.value as DatabaseRow[]);
    }
    if (listRes.ok) {
      setDomainDbs(listRes.value as DatabaseListEntry[]);
    }
    await loadBatches(slug, dbId, setIngestBatches, setError);
  }, [slug, dbId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columnTypeOptions = ["text", "number", "date", "select", "checkbox", "relation", "file"];

  async function onAddColumn(e: React.FormEvent) {
    e.preventDefault();
    setColError(null);
    if (!newColName.trim()) {
      setColError("Column name is required");
      return;
    }
    const input: {
      name: string;
      type: string;
      options?: string[];
      relationDatabaseId?: string;
    } = {
      name: newColName.trim(),
      type: newColType,
    };
    if (newColType === "select") {
      const opts = newColOptions.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.length < 1) {
        setColError("Enter at least one comma-separated option");
        return;
      }
      input.options = opts;
    }
    if (newColType === "relation") {
      input.relationDatabaseId = newColRelation;
    }
    const res = await api().dbAddColumn(slug, dbId, input);
    if (!res.ok) {
      setColError(res.error);
    } else {
      setNewColName("");
      setNewColOptions("");
      setNewColRelation("");
      await load();
    }
  }

  async function onAddRow() {
    const res = await api().dbUpsertRow(slug, dbId, { cells: {} });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await load();
  }

  async function onCellChange(
    row: DatabaseRow,
    col: DatabaseColumn,
    value: string | boolean,
  ) {
    const newCells = { ...row.cells };
    if (typeof value === "boolean") {
      newCells[col.id] = value;
    } else if (value === "") {
      delete newCells[col.id];
    } else if (col.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        setError(`Column ${col.name} expects a number`);
        return;
      }
      newCells[col.id] = n;
    } else {
      newCells[col.id] = value;
    }
    const res = await api().dbUpsertRow(slug, dbId, {
      id: row.id,
      cells: newCells,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    await load();
  }

  async function onDeleteRow(rowId: string) {
    const res = await api().dbDeleteRow(slug, dbId, rowId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await load();
  }

  async function onFileUpload(row: DatabaseRow, colId: string, file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await api().dbFileSave(slug, { bytes, mime: file.type || "application/octet-stream", name: file.name });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const upsert = await api().dbUpsertRow(slug, dbId, {
      id: row.id,
      cells: { ...row.cells, [colId]: res.value.relPath },
    });
    if (!upsert.ok) {
      setError(upsert.error);
      return;
    }
    setError(null);
    await load();
  }

  if (loadError) {
    return (
      <div className="page-content data-studio">
        <p className="data-studio__banner data-studio__banner--error">{loadError}</p>
        <Button onClick={() => navigate("/data")}>Back to Data</Button>
      </div>
    );
  }

  if (!meta) {
    return <p className="muted">Loading…</p>;
  }

  const domainName = snapshot?.domains.find((d) => d.slug === slug)?.meta.name ?? slug;

  return (
    <div className="page-content data-studio database-page">
      <header className="data-studio__header">
        <Button variant="ghost" className="data-studio__back" onClick={() => navigate("/data")}>← Back to Data</Button>
        <h1 className="data-studio__title">{meta.name}</h1>
        <p className="data-studio__lead">{domainName} · {slug}</p>
      </header>

      {error ? <p className="data-studio__banner data-studio__banner--error" role="alert">{error}</p> : null}
      {colError ? <p className="data-studio__banner data-studio__banner--error" role="alert">{colError}</p> : null}

      <div className="database-page__grid">
      {/* KAR-59 Adapter section */}
      <section className="data-studio__panel adapter-section">
        <div className="data-studio__panel-head">
          <h2>Adapter</h2>
        </div>
        {meta.adapter ? (
          <div className="adapter-linked">
            <p className="muted">
              Linked: {meta.adapter.kind} · {meta.sotMode} · last synced: {meta.adapter.lastSyncedAt ?? "never"}
            </p>
            <Button onClick={async () => {
              const res = await api().dbSync(slug, dbId);
              if (res.ok) {
                await load();
                // Refresh conflicts
                const cRes = await api().dbListConflicts(slug, dbId);
                if (cRes.ok) setConflicts(cRes.value as SyncConflict[]);
              }
            }}>Refresh</Button>
            <Button destructive onClick={async () => {
              const res = await api().dbUnlinkAdapter(slug, dbId);
              if (res.ok) await load();
            }}>Unlink</Button>
          </div>
        ) : (
          <form onSubmit={async (e) => {
            e.preventDefault();
            const res = await api().dbLinkAdapter(slug, dbId, {
              kind: adapterKind,
              bindingId: adapterBindingId || undefined,
              secret: adapterSecret,
              sotMode: adapterSotMode,
            });
            if (res.ok) {
              await load();
            } else {
              setError(res.error);
            }
          }} className="adapter-form data-new-form">
            <select value={adapterKind} onChange={(e) => setAdapterKind(e.target.value as "google-sheet" | "notion" | "url")} className="input-field">
              <option value="google-sheet">Google Sheet</option>
              <option value="notion">Notion</option>
              <option value="url">Operator URL</option>
            </select>
            {adapterKind !== "url" ? (
              <input
                type="text"
                placeholder={adapterKind === "google-sheet" ? "Spreadsheet ID" : "Notion Database ID"}
                value={adapterBindingId}
                onChange={(e) => setAdapterBindingId(e.target.value)}
                className="input-field"
              />
            ) : null}
            <input
              type="password"
              placeholder={adapterKind === "url" ? "URL" : "Token"}
              value={adapterSecret}
              onChange={(e) => setAdapterSecret(e.target.value)}
              className="input-field"
            />
            <select value={adapterSotMode} onChange={(e) => setAdapterSotMode(e.target.value as "linked-canonical" | "local-canonical-mirror")} className="input-field">
              <option value="linked-canonical">Linked canonical</option>
              <option value="local-canonical-mirror">Local canonical (mirror)</option>
            </select>
            <Button type="submit" variant="primary" className="data-studio__submit">Link</Button>
          </form>
        )}

        {/* KAR-59 Conflicts */}
        {conflicts.length > 0 ? (
          <div className="conflicts-list">
            <h3>Conflicts</h3>
            {conflicts.map((c) => (
              <div key={c.id} className="conflict-item">
                <p className="muted">Row {c.externalId} · default: {c.defaultChoice}</p>
                <Button onClick={async () => {
                  const res = await api().dbResolveConflict(slug, c.id, "keep-local");
                  if (res.ok) {
                    setConflicts((prev) => prev.filter((x) => x.id !== c.id));
                    await load();
                  }
                }}>Keep local</Button>
                <Button onClick={async () => {
                  const res = await api().dbResolveConflict(slug, c.id, "keep-remote");
                  if (res.ok) {
                    setConflicts((prev) => prev.filter((x) => x.id !== c.id));
                    await load();
                  }
                }}>Keep remote</Button>
                <Button onClick={async () => {
                  const res = await api().dbResolveConflict(slug, c.id, "skip");
                  if (res.ok) {
                    setConflicts((prev) => prev.filter((x) => x.id !== c.id));
                    await load();
                  }
                }}>Skip</Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="data-studio__panel">
        <div className="data-studio__panel-head">
          <h2>Columns</h2>
        </div>
      <form onSubmit={onAddColumn} className="data-add-column data-new-form">
        <input
          type="text"
          placeholder="New column name"
          value={newColName}
          onChange={(e) => setNewColName(e.target.value)}
          className="input-field"
        />
        <select value={newColType} onChange={(e) => setNewColType(e.target.value)} className="input-field">
          {columnTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {newColType === "select" ? (
          <input
            type="text"
            placeholder="Options (comma-separated)"
            value={newColOptions}
            onChange={(e) => setNewColOptions(e.target.value)}
            className="input-field"
          />
        ) : null}
        {newColType === "relation" ? (
          <select
            value={newColRelation}
            onChange={(e) => setNewColRelation(e.target.value)}
            className="input-field"
          >
            <option value="">Select database…</option>
            {domainDbs.map((entry) => (
              <option key={entry.database.id} value={entry.database.id}>
                {entry.database.name}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="submit" variant="primary" className="data-studio__submit">Add column</Button>
      </form>
      </section>
      </div>

      <section className="data-studio__panel">
        <div className="data-studio__panel-head">
          <h2>Rows</h2>
          <Button onClick={onAddRow}>Add row</Button>
        </div>
      <div className="data-studio__table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {meta.columns.map((col) => (
              <th key={col.id}>{col.name}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {meta.columns.map((col) => (
                <td key={col.id}>
                  <CellEditor column={col} value={row.cells[col.id]} onChange={(val) => onCellChange(row, col, val)} onFile={(file) => onFileUpload(row, col.id, file)} />
                </td>
              ))}
              <td>
                <Button destructive onClick={() => onDeleteRow(row.id)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </section>

      {/* Ingest section */}
      <IngestSection slug={slug} dbId={dbId} meta={meta} ingestBatches={ingestBatches} onReload={() => { void load(); }} />
    </div>
  );
}

function IngestSection({ slug, dbId, meta, ingestBatches, onReload }: {
  slug: string;
  dbId: string;
  meta: DatabaseMeta;
  ingestBatches: IngestBatch[];
  onReload: () => void;
}) {
  const [rows, setRows] = useState<Record<string, IngestRow[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const next: Record<string, IngestRow[]> = {};
      for (const batch of ingestBatches) {
        const res = await api().ingestListRows(slug, batch.id);
        if (res.ok) {
          next[batch.id] = res.value as IngestRow[];
        }
      }
      setRows(next);
    })();
  }, [ingestBatches, slug]);

  async function onAccept(batchId: string, rowIds?: string[]) {
    const res = await api().ingestAccept(slug, batchId, rowIds);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onReload();
  }

  async function onReject(batchId: string, rowIds?: string[]) {
    const res = await api().ingestReject(slug, batchId, rowIds);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onReload();
  }

  if (ingestBatches.length === 0) {
    return <p className="data-studio__empty">No ingest rows.</p>;
  }

  return (
    <section className="data-studio__panel ingest-section">
      <div className="data-studio__panel-head">
        <h2>Ingest</h2>
      </div>
      {error ? <p className="data-studio__banner data-studio__banner--error" role="alert">{error}</p> : null}
      {ingestBatches.map((batch) => (
        <div key={batch.id} className="ingest-batch">
          <p className="muted">{batch.fingerprint.slice(0, 16)}… ({batch.sourceKind})</p>
          <div className="data-studio__table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {meta.columns.map((col) => (
                  <th key={col.id}>{col.name}</th>
                ))}
                <th>Duplicate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(rows[batch.id] ?? []).filter((r) => r.status === "proposed").map((row) => (
                <tr key={row.id}>
                  {meta.columns.map((col) => (
                    <td key={col.id}>
                      <input
                        className="data-cell-input"
                        value={String(row.cells[col.id] ?? "")}
                        onChange={(e) => {
                          const next = { ...row, cells: { ...row.cells, [col.id]: e.target.value } };
                          setRows((prev) => ({
                            ...prev,
                            [batch.id]: (prev[batch.id] ?? []).map((r) =>
                              r.id === row.id ? next : r,
                            ),
                          }));
                        }}
                        onBlur={(e) => {
                          void api().ingestEditRow(slug, batch.id, row.id, {
                            ...row.cells,
                            [col.id]: e.target.value,
                          });
                        }}
                      />
                    </td>
                  ))}
                  <td>{row.duplicate ? "Yes" : ""}</td>
                  <td>
                    <Button onClick={() => onAccept(batch.id, [row.id])}>Accept</Button>
                    <Button destructive onClick={() => onReject(batch.id, [row.id])}>Reject</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="ingest-batch__actions">
            <Button onClick={() => onAccept(batch.id)}>Accept all</Button>
            <Button destructive onClick={() => onReject(batch.id)}>Reject all</Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function CellEditor({
  column,
  value,
  onChange,
  onFile,
}: {
  column: DatabaseColumn;
  value: unknown;
  onChange: (val: string | boolean) => void;
  onFile?: (file: File) => void;
}) {
  if (column.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (column.type === "file") {
    return (
      <div>
        {value ? <span className="muted">{String(value)}</span> : null}
        <input type="file" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && onFile) onFile(f);
        }} />
      </div>
    );
  }
  return (
    <input
      type={column.type === "number" ? "number" : column.type === "date" ? "date" : "text"}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      className="data-cell-input"
    />
  );
}
