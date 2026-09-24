import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  DatabaseColumn,
  DatabaseListEntry,
  DatabaseMeta,
  DatabaseRow,
} from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { Button } from "@/components/ui/Button";

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
      <div className="page-content">
        <p className="form-error">{loadError}</p>
        <Button onClick={() => navigate("/data")}>Back to Data</Button>
      </div>
    );
  }

  if (!meta) {
    return <p className="muted">Loading…</p>;
  }

  const domainName = snapshot?.domains.find((d) => d.slug === slug)?.meta.name ?? slug;

  return (
    <div className="page-content database-page">
      <header className="stub-page__header">
        <Button variant="ghost" onClick={() => navigate("/data")}>← Back to Data</Button>
        <h1 className="stub-page__title">{meta.name}</h1>
        <p className="muted">{domainName} · {slug}</p>
      </header>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {colError ? <p className="form-error" role="alert">{colError}</p> : null}

      <form onSubmit={onAddColumn} className="data-add-column">
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
        <Button type="submit">Add column</Button>
      </form>

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

      <Button onClick={onAddRow}>Add row</Button>
    </div>
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
