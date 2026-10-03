import { useEffect, useState } from "react";
import type { SavedView, ViewRunResult } from "@lifequest/vault-core";
import { api } from "@/lib/ipc";

/**
 * ViewCard — the one drawing path the design names (plan.md, slice 2): the
 * home pin board and a page's view-ref block both render this. Inline SVG in
 * current theme tokens, no chart library. The view is re-run on mount and when
 * reloadGeneration moves, so a card reflects new rows without a reload.
 */

type RunState =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "missing" }
  | { state: "run"; view: SavedView; result: ViewRunResult };

export function ViewCard({ domainSlug, viewId }: { domainSlug: string; viewId: string }) {
  const [run, setRun] = useState<RunState>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const get = await api().viewGet(domainSlug, viewId);
      if (!alive) return;
      if (!get.ok) {
        // A deleted view file is not a crash: the card names it and can go.
        setRun({ state: "missing" });
        return;
      }
      const result = await api().viewRunSaved(domainSlug, viewId);
      if (!alive) return;
      if (!result.ok) {
        setRun({ state: "error", error: result.error });
        return;
      }
      setRun({ state: "run", view: get.value, result: result.value });
    })();
    return () => {
      alive = false;
    };
  }, [domainSlug, viewId]);

  if (run.state === "loading") {
    return (
      <section className="view-card">
        <p className="muted">Loading…</p>
      </section>
    );
  }
  if (run.state === "missing") {
    return (
      <section className="view-card">
        <p className="muted">This view is missing and can be unpinned.</p>
      </section>
    );
  }
  if (run.state === "error") {
    return (
      <section className="view-card">
        <p className="form-error" role="alert">{run.error}</p>
      </section>
    );
  }

  const { view, result } = run;
  return (
    <section className="view-card">
      <h2 className="view-card__title">{view.title}</h2>
      {result.warnings.length > 0 ? (
        <p className="muted view-card__warnings">{result.warnings.join("; ")}</p>
      ) : null}
      {result.rows.length === 0 ? (
        <p className="muted view-card__empty">No rows in this window.</p>
      ) : view.presentation === "metric" ? (
        <ViewMetric result={result} />
      ) : view.presentation === "table" ? (
        <ViewTable result={result} />
      ) : (
        <ViewChart result={result} presentation={view.presentation} />
      )}
    </section>
  );
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(n);
}

function ViewMetric({ result }: { result: ViewRunResult }) {
  const [label, value] = result.rows[0] ?? ["value", 0];
  return (
    <p className="view-card__metric">
      {fmtNumber(value)}
      {result.currency ? <span className="muted"> {result.currency === "mixed" ? "(mixed currencies)" : result.currency}</span> : null}
      <span className="muted view-card__metric-label">{label === "value" ? "" : ` · ${label}`}</span>
    </p>
  );
}

function ViewTable({ result }: { result: ViewRunResult }) {
  return (
    <table className="page-block__table view-card__table">
      <thead>
        <tr>
          <th>Group</th>
          <th>Value{result.currency && result.currency !== "mixed" ? ` (${result.currency})` : ""}</th>
        </tr>
      </thead>
      <tbody>
        {result.rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{fmtNumber(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Bar and line over the same aggregate. Theme colors through CSS variables so
 * a skin repaint is automatic; the SVG carries no palette of its own.
 */
function ViewChart({ result, presentation }: { result: ViewRunResult; presentation: "bar" | "line" }) {
  const W = 600;
  const H = 240;
  const pad = 36;
  const data = result.rows.map(([label, value]) => ({ label, value }));
  const maxY = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const bw = (W - pad * 2) / data.length;
  const pts = data.map((d, i) => {
    const x = pad + i * bw + bw / 2;
    const y = H - pad - (Math.abs(d.value) / maxY) * (H - pad * 2);
    return { x, y };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="page-chart view-card__chart" role="img" aria-label={presentation === "bar" ? "Bar chart" : "Line chart"}>
      {data.map((d, i) => (
        <text key={`l${i}`} x={pts[i].x} y={H - 10} textAnchor="middle" fontSize="10" className="view-card__tick">
          {d.label.length > 8 ? `${d.label.slice(0, 7)}…` : d.label}
        </text>
      ))}
      {presentation === "bar"
        ? data.map((d, i) => (
            <rect
              key={`b${i}`}
              className="view-card__bar"
              x={pts[i].x - bw * 0.35}
              y={pts[i].y}
              width={bw * 0.7}
              height={H - pad - pts[i].y}
            >
              <title>{`${d.label}: ${fmtNumber(d.value)}${result.currency && result.currency !== "mixed" ? ` ${result.currency}` : ""}`}</title>
            </rect>
          ))
        : data.map((d, i) =>
            i === 0 ? null : (
              <line
                key={`ln${i}`}
                className="view-card__line"
                x1={pts[i - 1].x}
                y1={pts[i - 1].y}
                x2={pts[i].x}
                y2={pts[i].y}
              />
            ),
          )}
      {presentation === "line"
        ? data.map((d, i) => <circle key={`c${i}`} className="view-card__dot" cx={pts[i].x} cy={pts[i].y} r="3">
            <title>{`${d.label}: ${fmtNumber(d.value)}`}</title>
          </circle>)
        : null}
    </svg>
  );
}
