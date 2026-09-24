import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DatabaseColumn, DatabaseMeta, DatabaseRow, Result } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

export default function DatabasePage() {
  const { slug = "", dbId = "" } = useParams<{ slug: string; dbId: string }>();
  const navigate = useNavigate();
  const { snapshot } = useVault();

  const [meta, setMeta] = useState<DatabaseMeta | null>(null);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState("text");
  const [newColOptions, setNewColOptions] = useState("");
  const [newColRelation, setNewColRelation] = useState("");
  const [colError, setColError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const metaRes = await api().dbGet(slug, dbId);
    if (!metaRes.ok) {
      setError(metaRes.error);
      return;
    }
    setMeta(metaRes.value as DatabaseMeta);
    const rowsRes = await api().dbListRows(slug, dbId);
    if (rowsRes.ok) {
      setRows(rowsRes.value as DatabaseRow[]);
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
    if (res.ok) {
      await load();
    }
  }

  async function onCellChange(row: DatabaseRow, colId: string, value: string | boolean) {
    const newCells = { ...row.cells };
    if (typeof value === "boolean") {
      newCells[colId] = value;
    } else if (value === "") {
      delete newCells[colId];
    } else {
      newCells[colId] = value;
    }
    await api().dbUpsertRow(slug, dbId, { id: row.id, cells: newCells });
    await load();
  }

  async function onDeleteRow(rowId: string) {
    await api().dbDeleteRow(slug, dbId, rowId);
    await load();
  }

  async function onFileUpload(row: DatabaseRow, colId: string, file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await api().dbFileSave(slug, { bytes, mime: file.type || "application/octet-stream", name: file.name });
    if (res.ok) {
      const newCells = { ...row.cells, [colId]: res.value.relPath };
      await api().dbUpsertRow(slug, dbId, { id: row.id, cells: newCells });
      await load();
    }
  }

  if (error) {
    return (
      <div className="page-content">
        <p className="form-error">{error}</p>
        <button className="btn" onClick={() => navigate("/data")}>Back to Data</button>
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
        <button className="btn btn--ghost" onClick={() => navigate("/data")}>← Back to Data</button>
        <h1 className="stub-page__title">{meta.name}</h1>
        <p className="muted">{domainName} · {slug}</p>
      </header>

      {colError ? <p className="form-error">{colError}</p> : null}

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
          <input
            type="text"
            placeholder="Target database id"
            value={newColRelation}
            onChange={(e) => setNewColRelation(e.target.value)}
            className="input-field"
          />
        ) : null}
        <button type="submit" className="btn">Add column</button>
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
                  <CellEditor column={col} value={row.cells[col.id]} onChange={(val) => onCellChange(row, col.id, val)} onFile={(file) => onFileUpload(row, col.id, file)} />
                </td>
              ))}
              <td>
                <button className="btn btn--danger" onClick={() => onDeleteRow(row.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="btn" onClick={onAddRow}>Add row</button>
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
