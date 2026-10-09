import { useCallback, useEffect, useState } from "react";
import type {
  ComposedViewRunResult,
  DatabaseMeta,
  SavedView,
  ViewBlock,
  ViewPresentation,
  ViewRunResult,
} from "@lifequest/vault-core";
import { api } from "@/lib/ipc";
import {
  applyPresentation,
  availablePresentations,
  presentationLabel,
} from "./view-block-edit";

/**
 * ViewCard — the one drawing path the design names (plan.md, slice 2): the
 * home pin board and a page's view-ref block both render this. Inline SVG in
 * current theme tokens, no chart library. The view is re-run on mount and when
 * reloadGeneration moves, so a card reflects new rows without a reload.
 *
 * Composed views (2026-10-07): one card may hold several blocks. The card draws
 * each in order under one title, so "the weekly summary" — a total, its week
 * table, and its trend — is a single pinnable thing rather than three pins the
 * operator has to keep together by hand.
 *
 * Design (2026-10-08): the card wears the home board's own card shell and draws
 * each presentation in the app's type and hairline scale, because a companion
 * can create a table but must never invent its look. Everything here comes from
 * tokens, so a skin repaint reaches a saved view automatically.
 *
 * Editing (2026-10-08, second pass): each block carries a quiet row of four
 * presentation controls, so "show me this as a bar chart instead" is a click
 * rather than a request to the companion. The switch retargets the block's query
 * through `view-block-edit.ts` — a metric drops its grouping, a line takes a date
 * and a bucket — and saves the same card in place, so the operator's edit and the
 * companion's edit go through one writer (`view:save` with the view's own id) and
 * cannot drift. `editable` is false on a locked dashboard: the board's page lock
 * governs the cards on it, for the operator as much as for the agent.
 */

type RunState =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "missing" }
  | { state: "run"; view: SavedView; result: ComposedViewRunResult; db: DatabaseMeta | null };

/** One block as it is drawn: the run's numbers plus the spec that shaped them. */
type DrawnBlock = {
  id: string;
  title: string;
  presentation: ViewPresentation;
  span?: 1 | 2;
  result: ViewRunResult;
  /** The block's spec, when the saved view carries one. */
  spec?: ViewBlock;
};

export function ViewCard({
  domainSlug,
  viewId,
  editable = true,
}: {
  domainSlug: string;
  viewId: string;
  /** False on a locked dashboard: the board is read-only, cards included. */
  editable?: boolean;
}) {
  const [run, setRun] = useState<RunState>({ state: "loading" });
  const [generation, setGeneration] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

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
      const [result, dbRes] = await Promise.all([
        api().viewRunSaved(domainSlug, viewId),
        api().dbGet(domainSlug, get.value.databaseId),
      ]);
      if (!alive) return;
      if (!result.ok) {
        setRun({ state: "error", error: result.error });
        return;
      }
      setRun({
        state: "run",
        view: get.value,
        result: result.value,
        db: dbRes.ok ? dbRes.value : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [domainSlug, viewId, generation]);

  /**
   * One block's presentation, changed and saved in place.
   *
   * The write is the app's own `view:save` with this view's id, so the file keeps
   * its identity and the pin keeps its position. The card re-reads afterwards
   * rather than trusting the local edit: what is drawn has to be what is on disk.
   */
  async function onPresentation(block: DrawnBlock, target: ViewPresentation) {
    if (run.state !== "run" || saving) return;
    const built = applyPresentation(run.view, block.id, target, run.db);
    if (!built.ok) {
      setEditError(built.error);
      return;
    }
    setSaving(block.id);
    setEditError(null);
    try {
      const res = await api().viewSave(domainSlug, built.spec, run.view.id);
      if (!res.ok) {
        setEditError(res.error);
        return;
      }
      reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save this change");
    } finally {
      setSaving(null);
    }
  }

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

  const { view, result, db } = run;
  // The view's own title is the card's heading, so a one-block view does not
  // print its title twice; a composed card labels each panel.
  const showBlockTitles = result.blocks.length > 1;
  // A one-aggregate view has no `blocks` in its file: the run's single block IS
  // the view, so the root query fields are its spec.
  const specOf = (blockId: string): ViewBlock | undefined => {
    const blocks = view.blocks;
    if (blocks && blocks.length > 0) return blocks.find((b) => b.id === blockId);
    return { id: blockId, ...view } as ViewBlock;
  };
  const blocks: DrawnBlock[] = result.blocks.map((b) => ({
    ...b,
    spec: specOf(b.id),
  }));

  return (
    <section className="view-card">
      <h2 className="view-card__title">{view.title}</h2>
      <div className="view-card__blocks">
        {blocks.map((block) => (
          <div
            key={block.id}
            className={[
              "view-card__block",
              `view-card__block--${block.presentation}`,
              block.span === 2 ? "view-card__block--span2" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="view-card__block-head">
              {showBlockTitles ? (
                <h3 className="view-card__block-title">{block.title}</h3>
              ) : null}
              {editable && block.spec ? (
                <BlockPresentationControls
                  block={block}
                  db={db}
                  busy={saving === block.id}
                  onPick={(target) => void onPresentation(block, target)}
                />
              ) : null}
            </div>
            <ViewBlockBody block={block} />
          </div>
        ))}
      </div>
      {editError ? (
        <p className="form-error view-card__edit-error" role="alert">
          {editError}
        </p>
      ) : null}
      {/* Last, and quiet: the run's caveat is a footnote to the numbers above
          it, not a preamble that pushes them off the card. */}
      {result.warnings.length > 0 ? (
        <p className="view-card__warnings">{result.warnings.join("; ")}</p>
      ) : null}
    </section>
  );
}

/**
 * The four ways a block can be displayed, as one quiet row.
 *
 * A switch that cannot be expressed against this database — a line with no date
 * column to group by — is drawn disabled rather than hidden: the operator should
 * be able to see that the option exists and is not available here, and a control
 * that disappears is a control they will report as a bug.
 */
function BlockPresentationControls({
  block,
  db,
  busy,
  onPick,
}: {
  block: DrawnBlock;
  db: DatabaseMeta | null;
  busy: boolean;
  onPick: (target: ViewPresentation) => void;
}) {
  const available = availablePresentations(block.spec as ViewBlock, db);
  return (
    <div
      className="view-card__tools"
      role="group"
      aria-label={`How ${block.title} is displayed`}
    >
      {(["metric", "table", "bar", "line"] as ViewPresentation[]).map((p) => {
        const active = block.presentation === p;
        const enabled = available.includes(p);
        return (
          <button
            key={p}
            type="button"
            className={`view-card__tool${active ? " is-active" : ""}`}
            aria-pressed={active}
            data-testid="view-block-tool"
            data-presentation={p}
            disabled={busy || !enabled || active}
            title={
              enabled
                ? `Show ${block.title} as a ${presentationLabel(p).toLowerCase()}`
                : `This database cannot draw a ${presentationLabel(p).toLowerCase()} here`
            }
            onClick={() => onPick(p)}
          >
            {presentationLabel(p)}
          </button>
        );
      })}
    </div>
  );
}

/** One block's drawing: the single place a presentation maps to markup. */
function ViewBlockBody({ block }: { block: DrawnBlock }) {
  const { result, presentation } = block;
  if (result.rows.length === 0) {
    return <p className="muted view-card__empty">No rows in this window.</p>;
  }
  if (presentation === "metric") return <ViewMetric result={result} />;
  if (presentation === "table") return <ViewTable result={result} spec={block.spec} />;
  return <ViewChart result={result} presentation={presentation} spec={block.spec} />;
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(n);
}

function ViewMetric({ result }: { result: ViewRunResult }) {
  const [label, value] = result.rows[0] ?? ["value", 0];
  return (
    <p className="view-card__metric">
      {fmtNumber(value)}
      {result.currency ? (
        <span className="view-card__metric-unit">
          {" "}
          {result.currency === "mixed" ? "(mixed currencies)" : result.currency}
        </span>
      ) : null}
      <span className="view-card__metric-unit view-card__metric-label">
        {label === "value" ? "" : ` · ${label}`}
      </span>
    </p>
  );
}

/** Capitalise an id into a heading: `next_date` → `Next date`. */
function humanizeId(id: string): string {
  const spaced = id.replace(/[_-]+/g, " ").trim();
  if (!spaced) return id;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * What the two columns actually hold.
 *
 * The run returns `[label, value]` and nothing else, so a header can only be as
 * honest as the spec behind it: a bucketed block is a period, a grouped block is
 * the column it grouped by, and an aggregate over everything is just a total.
 * Guessing "Group" is what made a month-by-month table read as a spreadsheet.
 */
function tableHeaders(spec?: ViewBlock): { label: string; value: string } {
  if (spec?.timeBucket) {
    const bucket = spec.timeBucket === "day" ? "Day" : spec.timeBucket === "week" ? "Week" : "Month";
    return { label: bucket, value: "Total" };
  }
  if (spec?.groupBy) return { label: humanizeId(spec.groupBy), value: "Total" };
  return { label: "Total", value: "Value" };
}

function ViewTable({ result, spec }: { result: ViewRunResult; spec?: ViewBlock }) {
  const headers = tableHeaders(spec);
  const unit =
    result.currency && result.currency !== "mixed" ? ` (${result.currency})` : "";
  return (
    <table className="view-card__table">
      <thead>
        <tr>
          <th scope="col">{headers.label}</th>
          <th scope="col">
            {headers.value}
            {unit}
          </th>
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
 *
 * The drawing is deliberately plain: one baseline, area bars or a line with
 * dots, and a tick per row. Bars are scaled from a zero baseline on a fixed
 * canvas so a two-row card and a twelve-row card look like the same object, and
 * every label is truncated to the tick pitch rather than to a character guess.
 */
function ViewChart({
  result,
  presentation,
  spec,
}: {
  result: ViewRunResult;
  presentation: "bar" | "line";
  spec?: ViewBlock;
}) {
  // A fixed canvas with its aspect preserved: the card scales the whole drawing,
  // so a tick stays the size it was designed at instead of stretching with the
  // card's width. `preserveAspectRatio="none"` letterboxes text; this does not.
  const W = 480;
  const H = 180;
  const padX = 6;
  const padTop = 12;
  const axisY = H - 22;
  const data = result.rows.map(([label, value]) => ({ label, value }));
  const maxY = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const bw = (W - padX * 2) / data.length;
  // A tick may be as wide as its slot minus a hair, so labels fill the axis
  // instead of colliding; ~5.5 viewBox units per character at this font size.
  const maxTickChars = Math.max(4, Math.floor((bw - 4) / 5.5));
  const tick = (label: string) =>
    label.length > maxTickChars ? `${label.slice(0, Math.max(1, maxTickChars - 1))}…` : label;
  const pts = data.map((d, i) => {
    const x = padX + i * bw + bw / 2;
    const y = axisY - (Math.abs(d.value) / maxY) * (axisY - padTop);
    return { x, y };
  });
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="view-card__chart"
      role="img"
      aria-label={`${spec?.title ?? ""} ${presentation === "bar" ? "bar chart" : "line chart"}`.trim()}
    >
      <line className="view-card__axis" x1={padX} y1={axisY} x2={W - padX} y2={axisY} />
      {data.map((d, i) => (
        <text key={`l${i}`} x={pts[i].x} y={H - 6} textAnchor="middle" fontSize="11" className="view-card__tick">
          {tick(d.label)}
        </text>
      ))}
      {presentation === "bar"
        ? data.map((d, i) => (
            <rect
              key={`b${i}`}
              className="view-card__bar"
              x={pts[i].x - bw * 0.32}
              y={pts[i].y}
              width={bw * 0.64}
              height={axisY - pts[i].y}
              rx="1.5"
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
        ? data.map((d, i) => (
            <circle key={`c${i}`} className="view-card__dot" cx={pts[i].x} cy={pts[i].y} r="3">
              <title>{`${d.label}: ${fmtNumber(d.value)}`}</title>
            </circle>
          ))
        : null}
    </svg>
  );
}
