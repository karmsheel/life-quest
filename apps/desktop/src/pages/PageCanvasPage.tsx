import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  PageBlock,
  PageRecord,
  DatabaseListEntry,
  DatabaseRow,
  BudgetVsActualReport,
  NetWorthReport,
  ScenarioCompareReport,
} from "@lifequest/vault-core";
import {
  PAGE_BLOCK_KINDS,
  METRIC_AGGS,
  CHART_TYPES,
} from "@lifequest/vault-core";
import {
  filterByLens,
  deadlinePressureGoals,
  daysUntilDeadline,
} from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { Button } from "@/components/ui/Button";

const BLOCK_LABELS: Record<string, string> = {
  markdown: "Markdown",
  "bound-table": "Bound table",
  metric: "Metric",
  "date-range": "Date range",
  chart: "Chart",
  "goal-progress": "Goal progress",
  deadline: "Deadline",
  "budget-vs-actual": "Budget vs actual",
  "net-worth": "Net worth",
  "scenario-compare": "Scenario compare",
};

function genId(): string {
  return `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function localIsoDate(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(cellText).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function rowDate(row: DatabaseRow, dateColumnIds: string[]): string | null {
  for (const id of dateColumnIds) {
    const v = row.cells?.[id];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return row.createdAt ? row.createdAt.slice(0, 10) : null;
}

function filterRowsByDate(
  rows: DatabaseRow[],
  start: string | null,
  end: string | null,
  dateColumnIds: string[] = [],
): DatabaseRow[] {
  if (!start && !end) return rows;
  return rows.filter((r) => {
    const dateStr = rowDate(r, dateColumnIds);
    if (!dateStr) return false;
    if (start && dateStr < start) return false;
    if (end && dateStr > end) return false;
    return true;
  });
}

function computeMetric(
  rows: DatabaseRow[],
  columnId: string,
  agg: string,
): number | null {
  if (agg === "count") {
    return rows.filter((r) => {
      const v = r.cells?.[columnId];
      return v !== null && v !== undefined && v !== "";
    }).length;
  }
  const vals = rows
    .map((r) => r.cells?.[columnId])
    .filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
  if (vals.length === 0) return null;
  if (agg === "sum") return vals.reduce((a, b) => a + b, 0);
  return vals[vals.length - 1];
}

function ChartSvg({
  rows,
  xCol,
  yCol,
  chartType,
}: {
  rows: DatabaseRow[];
  xCol: string;
  yCol: string;
  chartType: "bar" | "line";
}) {
  const W = 600;
  const H = 240;
  const pad = 32;
  const data = rows
    .map((r) => ({
      x: cellText(r.cells?.[xCol]),
      y: Number(r.cells?.[yCol]) || 0,
    }))
    .filter((d) => d.x !== "");
  if (data.length === 0) return <p className="muted">No data.</p>;
  const maxY = Math.max(...data.map((d) => d.y), 1);
  const bw = (W - pad * 2) / data.length;
  const pts = data.map((d, i) => {
    const x = pad + i * bw + bw / 2;
    const y = H - pad - (d.y / maxY) * (H - pad * 2);
    return { x, y };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="page-chart" role="img" aria-label="Chart">
      {data.map((d, i) => (
        <text key={`l${i}`} x={pts[i].x} y={H - 8} textAnchor="middle" fontSize="10">
          {d.x.length > 8 ? `${d.x.slice(0, 7)}…` : d.x}
        </text>
      ))}
      {chartType === "bar"
        ? data.map((d, i) => (
            <rect
              key={`b${i}`}
              x={pts[i].x - bw * 0.35}
              y={pts[i].y}
              width={bw * 0.7}
              height={H - pad - pts[i].y}
            />
          ))
        : data.map((d, i) =>
            i === 0 ? null : (
              <line
                key={`ln${i}`}
                x1={pts[i - 1].x}
                y1={pts[i - 1].y}
                x2={pts[i].x}
                y2={pts[i].y}
                strokeWidth="2"
              />
            ),
          )}
      {chartType === "line"
        ? data.map((d, i) => <circle key={`c${i}`} cx={pts[i].x} cy={pts[i].y} r="3" />)
        : null}
    </svg>
  );
}

export default function PageCanvasPage() {
  const { slug, pageId } = useParams<{ slug: string; pageId: string }>();
  const { snapshot } = useVault();
  const lens = useDomainLens();

  const [page, setPage] = useState<PageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [addKind, setAddKind] = useState<string>("markdown");
  const [installedKits, setInstalledKits] = useState<string[] | null>(null);
  const [assumptionSets, setAssumptionSets] = useState<Array<{ id: string; name: string }>>([]);
  const [budgetReport, setBudgetReport] = useState<BudgetVsActualReport | null>(null);
  const [netWorthReport, setNetWorthReport] = useState<NetWorthReport | null>(null);
  const [scenarioReport, setScenarioReport] = useState<ScenarioCompareReport | null>(null);

  const [dbs, setDbs] = useState<DatabaseListEntry[]>([]);
  const [rowsByDb, setRowsByDb] = useState<Record<string, DatabaseRow[]>>({});

  const load = useCallback(async () => {
    if (!slug || !pageId) return;
    const res = await api().pageGet(slug, pageId);
    if (res.ok) {
      const p = res.value as PageRecord;
      setPage(p);
      setTitle(p.title);
      setBlocks(p.blocks);
      setError(null);
      const dbIds = p.blocks
        .map((b) => ("databaseId" in b ? b.databaseId : null))
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      for (const dbId of [...new Set(dbIds)]) {
        void loadRows(dbId);
      }
    } else {
      setError(res.error);
      setPage(null);
    }
  }, [slug, pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      const res = await api().dbList(slug);
      if (res.ok) setDbs(res.value as DatabaseListEntry[]);
      const kitRes = await api().kitList(slug);
      if (kitRes.ok) {
        const kits = kitRes.value as string[];
        setInstalledKits(kits);
        if (kits.includes("finance")) {
          const rowsRes = await api().dbListRows("financial", "finance:assumption-sets");
          if (rowsRes.ok) {
            setAssumptionSets((rowsRes.value as Array<{ id: string; cells: Record<string, unknown> }>).map((r) => ({
              id: r.id,
              name: String(r.cells.name ?? r.id),
            })));
          }
          for (const dbId of ["finance:accounts", "finance:holdings", "finance:budgets"]) {
            const extra = await api().dbListRows("financial", dbId);
            if (extra.ok) {
              setRowsByDb((prev) => ({ ...prev, [dbId]: extra.value as DatabaseRow[] }));
            }
          }
        }
      } else {
        setInstalledKits([]);
      }
    })();
  }, [slug]);

  // KAR-57: Fetch finance reports when budget/net-worth/scenario blocks exist
  const hasBudgetBlock = blocks.some((b) => b.kind === "budget-vs-actual");
  const hasNetWorthBlock = blocks.some((b) => b.kind === "net-worth");
  const scenarioBlock = blocks.find((b) => b.kind === "scenario-compare") as
    | { assumptionSetId: string; compareSetId?: string | null }
    | undefined;

  useEffect(() => {
    if (!installedKits?.includes("finance")) return;
    if (!hasBudgetBlock && !hasNetWorthBlock && !scenarioBlock) return;
    const asOf = localIsoDate();

    if (hasBudgetBlock) {
      void (async () => {
        const res = await api().financeBudgetVsActual(asOf);
        if (res.ok) setBudgetReport(res.value as BudgetVsActualReport);
      })();
    }
    if (hasNetWorthBlock) {
      void (async () => {
        const res = await api().financeNetWorth(asOf);
        if (res.ok) setNetWorthReport(res.value as NetWorthReport);
      })();
    }
    if (scenarioBlock && scenarioBlock.assumptionSetId) {
      void (async () => {
        const res = await api().financeScenarioCompare({
          asOf,
          assumptionSetId: scenarioBlock.assumptionSetId,
          compareSetId: scenarioBlock.compareSetId ?? null,
        });
        if (res.ok) setScenarioReport(res.value as ScenarioCompareReport);
      })();
    }
  }, [installedKits, hasBudgetBlock, hasNetWorthBlock, scenarioBlock?.assumptionSetId, scenarioBlock?.compareSetId]);

  async function loadRows(dbId: string) {
    if (rowsByDb[dbId]) return;
    const res = await api().dbListRows(slug!, dbId);
    if (res.ok) {
      setRowsByDb((prev) => ({ ...prev, [dbId]: res.value as DatabaseRow[] }));
    }
  }

  function setBlock(id: string, patch: Partial<PageBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as PageBlock) : b)));
  }

  function addBlock() {
    const kind = addKind as PageBlock["kind"];
    const base: PageBlock = { id: genId(), kind } as PageBlock;
    if (kind === "markdown") (base as { markdown: string }).markdown = "";
    if (kind === "date-range") {
      (base as { start: string | null }).start = null;
      (base as { end: string | null }).end = null;
    }
    if (kind === "metric") {
      (base as { databaseId: string }).databaseId = "";
      (base as { columnId: string }).columnId = "";
      (base as { agg: "sum" }).agg = "sum";
    }
    if (kind === "chart") {
      (base as { chartType: "bar" }).chartType = "bar";
      (base as { databaseId: string }).databaseId = "";
      (base as { xColumnId: string }).xColumnId = "";
      (base as { yColumnId: string }).yColumnId = "";
    }
    if (kind === "scenario-compare") {
      (base as unknown as { assumptionSetId: string }).assumptionSetId = "";
      (base as unknown as { compareSetId?: string | null }).compareSetId = null;
    }
    setBlocks((prev) => [...prev, base]);
    if (kind === "bound-table" || kind === "metric" || kind === "chart") {
      const dbId = (base as { databaseId?: string }).databaseId;
      if (dbId) void loadRows(dbId);
    }
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  async function onSave() {
    if (!slug || !pageId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api().pageUpdate(slug, pageId, { title, blocks });
      if (!res.ok) {
        setError(res.error);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!slug || !pageId) {
    return <p className="form-error">Missing page parameters.</p>;
  }
  if (error && !page) {
    return (
      <div className="page-content">
        <p className="form-error" role="alert">{error}</p>
        <Link to="/pages">← Back to Pages</Link>
      </div>
    );
  }
  if (!page) {
    return <p className="muted">Loading…</p>;
  }

  const dateRange = blocks.find((b) => b.kind === "date-range") as
    | { start: string | null; end: string | null }
    | undefined;

  return (
    <div className="page-content">
      <header className="stub-page__header">
        <Link to="/pages" className="muted">← Pages</Link>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="page-canvas__title-input"
          aria-label="Page title"
        />
      </header>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="page-canvas__blocks">
        {blocks.map((block) => {
          if (block.kind === "markdown") {
            const b = block as Extract<PageBlock, { kind: "markdown" }>;
            return (
              <section key={b.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Markdown</span>
                  <button className="page-block__remove" onClick={() => removeBlock(b.id)}>Remove</button>
                </div>
                <textarea
                  className="page-block__markdown"
                  value={b.markdown}
                  onChange={(e) => setBlock(b.id, { markdown: e.target.value })}
                  rows={4}
                />
              </section>
            );
          }
          if (block.kind === "bound-table") {
            const b = block as Extract<PageBlock, { kind: "bound-table" }>;
            const dbMeta = dbs.find((d) => d.database.id === b.databaseId)?.database;
            const dateColIds = (dbMeta?.columns ?? []).filter((c) => c.type === "date").map((c) => c.id);
            const rows = filterRowsByDate(rowsByDb[b.databaseId] ?? [], dateRange?.start ?? null, dateRange?.end ?? null, dateColIds);
            return (
              <section key={b.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Bound table</span>
                  <button className="page-block__remove" onClick={() => removeBlock(b.id)}>Remove</button>
                </div>
                <select
                  className="input-field"
                  value={b.databaseId}
                  onChange={(e) => {
                    setBlock(b.id, { databaseId: e.target.value });
                    void loadRows(e.target.value);
                  }}
                >
                  <option value="">Select database…</option>
                  {dbs.map((d) => (
                    <option key={d.database.id} value={d.database.id}>{d.database.name}</option>
                  ))}
                </select>
                {dbMeta && rows.length > 0 ? (
                  <table className="page-block__table">
                    <thead>
                      <tr>
                        {dbMeta.columns.map((c) => <th key={c.id}>{c.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          {dbMeta.columns.map((c) => <td key={c.id}>{cellText(r.cells?.[c.id])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">No rows.</p>
                )}
              </section>
            );
          }
          if (block.kind === "metric") {
            const b = block as Extract<PageBlock, { kind: "metric" }>;
            const dbMeta = dbs.find((d) => d.database.id === b.databaseId)?.database;
            const dateColIds = (dbMeta?.columns ?? []).filter((c) => c.type === "date").map((c) => c.id);
            const rows = filterRowsByDate(rowsByDb[b.databaseId] ?? [], dateRange?.start ?? null, dateRange?.end ?? null, dateColIds);
            const val = dbMeta ? computeMetric(rows, b.columnId, b.agg) : null;
            return (
              <section key={b.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Metric</span>
                  <button className="page-block__remove" onClick={() => removeBlock(b.id)}>Remove</button>
                </div>
                <div className="page-block__metric-controls">
                  <select
                    className="input-field"
                    value={b.databaseId}
                    onChange={(e) => {
                      setBlock(b.id, { databaseId: e.target.value, columnId: "" });
                      void loadRows(e.target.value);
                    }}
                  >
                    <option value="">Database…</option>
                    {dbs.map((d) => <option key={d.database.id} value={d.database.id}>{d.database.name}</option>)}
                  </select>
                  <select
                    className="input-field"
                    value={b.columnId}
                    onChange={(e) => setBlock(b.id, { columnId: e.target.value })}
                  >
                    <option value="">Column…</option>
                    {dbMeta?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select
                    className="input-field"
                    value={b.agg}
                    onChange={(e) => setBlock(b.id, { agg: e.target.value as "sum" | "count" | "last" })}
                  >
                    {METRIC_AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <label className="page-block__zar">
                    <input
                      type="checkbox"
                      checked={b.convertToZar ?? false}
                      onChange={(e) => setBlock(b.id, { convertToZar: e.target.checked })}
                    />
                    <span>Convert to ZAR</span>
                  </label>
                </div>
                <p className="page-block__metric-value">
                  {val === null ? "—" : val}
                  {b.convertToZar ? <span className="muted"> (ZAR conversion requires Finance kit)</span> : null}
                </p>
              </section>
            );
          }
          if (block.kind === "date-range") {
            const b = block as Extract<PageBlock, { kind: "date-range" }>;
            return (
              <section key={b.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Date range</span>
                  <button className="page-block__remove" onClick={() => removeBlock(b.id)}>Remove</button>
                </div>
                <div className="page-block__date-range">
                  <label>Start
                    <input type="date" value={b.start ?? ""} onChange={(e) => setBlock(b.id, { start: e.target.value || null })} />
                  </label>
                  <label>End
                    <input type="date" value={b.end ?? ""} onChange={(e) => setBlock(b.id, { end: e.target.value || null })} />
                  </label>
                </div>
              </section>
            );
          }
          if (block.kind === "chart") {
            const b = block as Extract<PageBlock, { kind: "chart" }>;
            const dbMeta = dbs.find((d) => d.database.id === b.databaseId)?.database;
            const dateColIds = (dbMeta?.columns ?? []).filter((c) => c.type === "date").map((c) => c.id);
            const rows = filterRowsByDate(rowsByDb[b.databaseId] ?? [], dateRange?.start ?? null, dateRange?.end ?? null, dateColIds);
            return (
              <section key={b.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Chart</span>
                  <button className="page-block__remove" onClick={() => removeBlock(b.id)}>Remove</button>
                </div>
                <div className="page-block__chart-controls">
                  <select
                    className="input-field"
                    value={b.chartType}
                    onChange={(e) => setBlock(b.id, { chartType: e.target.value as "bar" | "line" })}
                  >
                    {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select
                    className="input-field"
                    value={b.databaseId}
                    onChange={(e) => {
                      setBlock(b.id, { databaseId: e.target.value, xColumnId: "", yColumnId: "" });
                      void loadRows(e.target.value);
                    }}
                  >
                    <option value="">Database…</option>
                    {dbs.map((d) => <option key={d.database.id} value={d.database.id}>{d.database.name}</option>)}
                  </select>
                  <select className="input-field" value={b.xColumnId} onChange={(e) => setBlock(b.id, { xColumnId: e.target.value })}>
                    <option value="">X column…</option>
                    {dbMeta?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select className="input-field" value={b.yColumnId} onChange={(e) => setBlock(b.id, { yColumnId: e.target.value })}>
                    <option value="">Y column…</option>
                    {dbMeta?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {dbMeta && b.xColumnId && b.yColumnId ? (
                  <ChartSvg rows={rows} xCol={b.xColumnId} yCol={b.yColumnId} chartType={b.chartType} />
                ) : (
                  <p className="muted">Pick a database and columns.</p>
                )}
              </section>
            );
          }
          if (block.kind === "goal-progress") {
            const goals = (snapshot?.goals ?? []).filter((g) => g.status === "open" && filterByLens([g], lens).length > 0);
            return (
              <section key={block.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Goal progress</span>
                  <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                </div>
                {goals.length === 0 ? (
                  <p className="muted">No open goals in this lens.</p>
                ) : (
                  <ul className="home-mini-list">
                    {goals.map((g) => (
                      <li key={g.id} className="home-mini-list__item">
                        <span className="home-mini-list__link">{g.name}</span>
                        {g.target !== null ? (
                          <span className="muted home-mini-list__meta">{g.current ?? 0} / {g.target} {g.metric}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          }
          if (block.kind === "budget-vs-actual") {
            if (!installedKits || !installedKits.includes("finance")) {
              return (
                <section key={block.id} className="page-block">
                  <div className="page-block__head">
                    <span className="muted">Budget vs actual</span>
                    <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                  </div>
                  <p className="muted">Install the Finance kit to use this block.</p>
                  <Button onClick={async () => {
                    const res = await api().kitInstallFinance();
                    if (!res.ok) setError(res.error);
                    else window.location.reload();
                  }}>Install Finance kit</Button>
                </section>
              );
            }
            const report = budgetReport;
            return (
              <section key={block.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Budget vs actual</span>
                  <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                </div>
                {!report ? (
                  <p className="muted">Loading…</p>
                ) : report.empty ? (
                  <p className="muted">No budgets yet.</p>
                ) : (
                  <>
                    {report.warnings.length > 0 && (
                      <p className="muted">{report.warnings.join("; ")}</p>
                    )}
                    <table className="page-block__table">
                      <thead>
                        <tr><th>Category</th><th>Period</th><th>Planned</th><th>Spent</th><th>Remaining</th></tr>
                      </thead>
                      <tbody>
                        {report.lines.map((l) => (
                          <tr key={l.budgetRowId}>
                            <td>{l.categoryName}</td>
                            <td>{l.period}</td>
                            <td>{l.planned}</td>
                            <td>{l.spent}</td>
                            <td>{l.remaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            );
          }
          if (block.kind === "net-worth") {
            if (!installedKits || !installedKits.includes("finance")) {
              return (
                <section key={block.id} className="page-block">
                  <div className="page-block__head">
                    <span className="muted">Net worth</span>
                    <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                  </div>
                  <p className="muted">Install the Finance kit to use this block.</p>
                  <Button onClick={async () => {
                    const res = await api().kitInstallFinance();
                    if (!res.ok) setError(res.error);
                    else window.location.reload();
                  }}>Install Finance kit</Button>
                </section>
              );
            }
            const report = netWorthReport;
            return (
              <section key={block.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Net worth</span>
                  <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                </div>
                {!report ? (
                  <p className="muted">Loading…</p>
                ) : report.empty ? (
                  <p className="muted">No accounts or holdings yet.</p>
                ) : (
                  <>
                    <p className="page-block__metric-value">
                      {report.zar !== null ? (
                        <>ZAR {report.zar}</>
                      ) : (
                        <span className="muted">ZAR conversion requires an FX rate</span>
                      )}
                    </p>
                    <p className="muted">ZAR: {report.byCurrency.ZAR} · USD: {report.byCurrency.USD}</p>
                  </>
                )}
              </section>
            );
          }
          if (block.kind === "scenario-compare") {
            const sc = block as Extract<PageBlock, { kind: "scenario-compare" }>;
            const scBlock = block as { kind: "scenario-compare"; assumptionSetId: string; compareSetId?: string | null };
            if (!installedKits || !installedKits.includes("finance")) {
              return (
                <section key={block.id} className="page-block">
                  <div className="page-block__head">
                    <span className="muted">Scenario compare</span>
                    <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                  </div>
                  <p className="muted">Install the Finance kit to use this block.</p>
                  <Button onClick={async () => {
                    const res = await api().kitInstallFinance();
                    if (!res.ok) setError(res.error);
                    else window.location.reload();
                  }}>Install Finance kit</Button>
                </section>
              );
            }
            const report = scenarioReport;
            return (
              <section key={block.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Scenario compare</span>
                  <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                </div>
                <select
                  className="input-field"
                  value={scBlock.assumptionSetId}
                  onChange={(e) => setBlock(block.id, { assumptionSetId: e.target.value, compareSetId: scBlock.compareSetId ?? null })}
                >
                  {assumptionSets.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <label className="muted" style={{ display: "block", marginTop: 8 }}>Compare with</label>
                <select
                  className="input-field"
                  value={scBlock.compareSetId ?? ""}
                  onChange={(e) => setBlock(block.id, { assumptionSetId: scBlock.assumptionSetId, compareSetId: e.target.value || null })}
                >
                  <option value="">Live only</option>
                  {assumptionSets.filter((a) => a.id !== scBlock.assumptionSetId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                {!report ? (
                  <p className="muted">Select an assumption set to compare.</p>
                ) : (
                  <table className="page-block__table">
                    <thead>
                      <tr><th>Month</th><th>Live ZAR</th>{report.primary ? <th>Primary ZAR</th> : null}{report.secondary ? <th>Secondary ZAR</th> : null}</tr>
                    </thead>
                    <tbody>
                      {report.live.months.map((m, i) => (
                        <tr key={m.month}>
                          <td>{m.month}</td>
                          <td>{m.zar !== null ? m.zar : <span className="muted">ZAR conversion requires an FX rate</span>}</td>
                          {report.primary ? (<td>{report.primary.months[i]?.zar !== null && report.primary.months[i]?.zar !== undefined ? report.primary.months[i].zar : <span className="muted">ZAR conversion requires an FX rate</span>}</td>) : null}
                          {report.secondary ? (<td>{report.secondary.months[i]?.zar !== null && report.secondary.months[i]?.zar !== undefined ? report.secondary.months[i].zar : <span className="muted">ZAR conversion requires an FX rate</span>}</td>) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          }
          if (block.kind === "deadline") {
            const today = localIsoDate();
            const pressured = deadlinePressureGoals(snapshot?.goals ?? [], today)
              .filter((g) => filterByLens([g], lens).length > 0)
              .sort((a, b) => daysUntilDeadline(a.deadline!, today) - daysUntilDeadline(b.deadline!, today));
            return (
              <section key={block.id} className="page-block">
                <div className="page-block__head">
                  <span className="muted">Deadline</span>
                  <button className="page-block__remove" onClick={() => removeBlock(block.id)}>Remove</button>
                </div>
                {pressured.length === 0 ? (
                  <p className="muted">No deadline pressure.</p>
                ) : (
                  <ul className="home-mini-list">
                    {pressured.map((g) => (
                      <li key={g.id} className="home-mini-list__item">
                        <span className="home-mini-list__link">{g.name}</span>
                        <span className="muted home-mini-list__meta">
                          {daysUntilDeadline(g.deadline!, today)} days
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          }
          return null;
        })}
      </div>

      <div className="page-canvas__add">
        <select className="input-field" value={addKind} onChange={(e) => setAddKind(e.target.value)}>
          {PAGE_BLOCK_KINDS.map((k) => <option key={k} value={k}>{BLOCK_LABELS[k] ?? k}</option>)}
        </select>
        <Button onClick={addBlock}>Add block</Button>
      </div>

      <div className="page-canvas__save">
        <Button onClick={onSave} disabled={busy}>Save</Button>
      </div>
    </div>
  );
}
