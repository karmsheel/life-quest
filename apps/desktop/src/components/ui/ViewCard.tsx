import { useCallback, useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import type {
  ComposedViewRunResult,
  DatabaseMeta,
  SavedView,
  ViewBlock,
  ViewPresentation,
  ViewRunResult,
} from "@lifequest/vault-core";import { api } from "@/lib/ipc";
import { useLiveData } from "@/state/LiveDataProvider";
import {
  applyPresentation,
  availablePresentations,
  presentationLabel,
} from "./view-block-edit";

/**
 * ViewCard — the one drawing path the design names (plan.md, slice 2): the
 * home pin board and a page's view-ref block both render this. Inline SVG in
 * current theme tokens, no chart library. The view is re-run on mount, when
 * `reloadGeneration` moves, and — since 2026-10-14 — whenever the vault's live
 * revision moves, so a card reflects new rows without a reload.
 *
 * "Whenever the vault changes" is the part that was missing, and it is the whole
 * of the reported bug: the operator told the companion to log an expense, the
 * row was written at 19:59:33, and the pinned "Recent transactions" card had last
 * read the ledger at 19:54:42 — because a card only ever ran on mount. The spec
 * was a live query and the engine re-ran it correctly; nothing asked it to. Every
 * read a card makes is now a dependency of the effect that makes it, so a write
 * anywhere in the app, a Decision being approved, or the local day turning over
 * re-runs the card the same way opening the page does.
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
 * Editing (2026-10-08, second pass; a hidden menu 2026-10-28): each object
 * carries one small control that opens the drawings it can take. The object is
 * already the drawing the operator asked for — they should not be invited to
 * turn their table into a chart unless they ask — so the alternatives live
 * behind that control and the companion remains the normal way to change one.
 * The switch changes ONLY `presentation` through `view-block-edit.ts` and saves
 * the same card in place, so the operator's edit and the companion's edit go
 * through one writer (`view:save` with the view's own id) and cannot drift. It
 * must not retarget the query: doing that is how a one-number "Spending by
 * month" object became one bar per transaction date and then a table of plain
 * transactions. `editable` is false on a locked dashboard: the board's page lock
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
  /**
   * The card the operator is watching is the one the companion is editing, and a
   * card that redrew with new content should say so — once, quietly, where it
   * stands.
   *
   * Nothing tells this card that it was the one touched, and it does not need to
   * be told: it compares what it just drew against what it was already drawing, and
   * it is the only component that knows both. A revision that leaves the numbers
   * alone — and "every write anywhere in the vault" is a revision this card hears
   * about whether or not it concerns this card — is not a change, and pulsing for
   * it would make the board flicker every time anything was written.
   *
   * `changedAt` is a tick rather than a boolean so that two edits in a row are two
   * animations: the class is keyed on the tick, so React replaces the node's class
   * instead of leaving an already-playing animation alone.
   */
  const [changedAt, setChangedAt] = useState(0);
  /**
   * What is on screen, for the comparison above.
   *
   * Serialized rather than held as objects, because what is being asked is
   * "does this draw differently", and object identity answers the wrong question:
   * every revision parses a fresh copy of the same view. A card's spec and result
   * are plain JSON out of the vault, so the encoding is stable; the SIZE cap is a
   * guard against a listing with hundreds of rows turning every revision into a
   * megabyte of string work, and a change beyond it simply skips the pulse.
   */
  const drawnRef = useRef<string | null>(null);
  /** The vault's live revision: it moves on any write, and on the day turning. */
  const live = useLiveData();
  const armChanged = useCallback((signature: string) => {
    if (drawnRef.current === null || drawnRef.current === signature) {
      drawnRef.current = signature;
      return;
    }
    drawnRef.current = signature;
    if (signature.length > 20_000) return;
    setChangedAt(Date.now());
  }, []);

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
      // The comparison is made against the spec AND the run together: a card whose
      // blocks were reordered draws the same numbers in a different order, and a
      // card whose rows changed draws different numbers in the same order. One
      // signature covers both, which is why it is not a hash of the result alone.
      armChanged(JSON.stringify({ view: get.value, result: result.value }));
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
  }, [armChanged, domainSlug, viewId, generation, live]);

  /**
   * The pulse is one animation long. It is cleared on a timer rather than left on
   * the card, so a later `is-changed` is a new animation rather than a class that
   * was already there; `animationend` would be the tidier signal and is the wrong
   * one here, because a card whose whole subtree redrew can swallow the event.
   */
  useEffect(() => {
    if (!changedAt) return;
    const timer = window.setTimeout(() => setChangedAt(0), 900);
    return () => window.clearTimeout(timer);
  }, [changedAt]);

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

  /**
   * The card's shell, plus the one thing that is about THIS turn: whether the card
   * just redrew with different content. The key is the tick, so a second edit
   * restarts the animation instead of inheriting a class that was already there.
   */
  const cardClass = changedAt
    ? `view-card is-changed view-card--changed-${changedAt}`
    : "view-card";

  if (run.state === "loading") {
    return (
      <section className={cardClass}>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  if (run.state === "missing") {
    return (
      <section className={cardClass}>
        <p className="muted">This view is missing and can be unpinned.</p>
      </section>
    );
  }
  if (run.state === "error") {
    return (
      <section className={cardClass}>
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
    // The block's own id wins over the view's: a one-aggregate view's file has
    // no `id` for its block, and `save_view` addresses the block by this one.
    return { ...view, id: blockId } as ViewBlock;
  };
  const blocks: DrawnBlock[] = result.blocks.map((b) => ({
    ...b,
    spec: specOf(b.id),
  }));

  return (
    <section className={cardClass}>
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
            // The drawing is this object's own fact, and it stays readable from
            // the DOM even while the menu that can change it is closed.
            data-presentation={block.presentation}
          >
            <div className="view-card__block-head">
              {showBlockTitles ? (
                <h3 className="view-card__block-title">{block.title}</h3>
              ) : null}
              {editable && block.spec ? (
                <BlockDisplayMenu
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
 * How an object is drawn, hidden behind one small control.
 *
 * The object IS its drawing: an operator who asked for "a bar chart of spending
 * by month" has a bar chart, not a tab row inviting them to turn it into four
 * other things. The four drawings are the same dataset, so the switch is safe —
 * it changes nothing but the drawing — but it is a behind-the-scenes option,
 * not furniture on the card. The companion is the normal way to change it;
 * this menu is for the operator who wants it now.
 *
 * A row object offers only list and table, because those are its two captions;
 * an aggregate offers all four. An object with nothing to switch between draws
 * no control at all.
 */
function BlockDisplayMenu({
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const available = availablePresentations(block.spec as ViewBlock, db);

  // Escape closes and returns the operator to the control they opened; a click
  // anywhere else closes without stealing focus. Both listeners are on the
  // document because the menu is a popover over the card, not a page of its own.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // The current drawing is the item the operator wants to see first.
    const current =
      menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menuRef.current?.querySelector<HTMLElement>("[role=menuitemradio]");
    current?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (available.length <= 1) return null;

  return (
    <div className="view-card__display" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="view-card__display-trigger"
        data-testid="view-block-display-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Change how ${block.title} is displayed`}
        title="Change how this is displayed"
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="view-card__display-menu"
          role="menu"
          aria-label={`How ${block.title} is displayed`}
        >
          <p className="view-card__display-menu-title">Show as</p>
          {available.map((presentation) => {
            const active = block.presentation === presentation;
            return (
              <button
                key={presentation}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`view-card__display-item${active ? " is-active" : ""}`}
                data-testid="view-block-tool"
                data-presentation={presentation}
                disabled={busy}
                title={
                  active
                    ? `${block.title} is drawn as a ${presentationLabel(presentation).toLowerCase()}`
                    : `Show ${block.title} as a ${presentationLabel(presentation).toLowerCase()} — the data does not change`
                }
                onClick={() => {
                  setOpen(false);
                  if (!active) onPick(presentation);
                }}
              >
                <Check
                  size={11}
                  strokeWidth={2.5}
                  className="view-card__display-check"
                  aria-hidden="true"
                />
                {presentationLabel(presentation)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** One object's drawing: the single place a presentation maps to markup. */
function ViewBlockBody({ block }: { block: DrawnBlock }) {
  const { result, presentation } = block;
  // A row object carries its rows in `listRows`; an aggregate in `rows`. Asking
  // the wrong one is how a card with twelve lines of ledger drew "No rows".
  if (result.listRows !== undefined) {
    const rows = result.listRows;
    if (rows.length === 0) {
      return <p className="muted view-card__empty">No rows in this window.</p>;
    }
    return <ViewList result={result} rows={rows} />;
  }
  const summary = summaryOf(result);
  if (presentation === "metric") {
    if (!summary) return <p className="muted view-card__empty">No rows in this window.</p>;
    return <ViewMetric result={result} summary={summary} />;
  }
  if (result.rows.length === 0) {
    return <p className="muted view-card__empty">No rows in this window.</p>;
  }
  if (presentation === "table") return <ViewTable result={result} spec={block.spec} />;
  if (presentation === "bar" || presentation === "line") {
    return <ViewChart result={result} presentation={presentation} spec={block.spec} />;
  }
  // A `list` with no rows in `listRows` cannot happen through validation; the
  // guard keeps the renderer honest rather than drawing a chart from nothing.
  return <p className="muted view-card__empty">No rows in this window.</p>;
}

/**
 * The number a metric draws.
 *
 * The engine computes it from the whole dataset, so a metric never has to
 * choose a row itself: an object grouped by month can be shown as a table and
 * as its total without either shape changing the query.
 */
function summaryOf(result: ViewRunResult): { label: string; value: number } | null {
  if (result.summary) return result.summary;
  const first = result.rows[0];
  return first ? { label: first[0], value: first[1] } : null;
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(n);
}

/** A compact number for an axis tick, where a full amount would collide. */
function fmtAxis(n: number): string {
  return new Intl.NumberFormat("en-ZA", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function ViewMetric({
  result,
  summary,
}: {
  result: ViewRunResult;
  summary: { label: string; value: number };
}) {
  const [label, value] = [summary.label, summary.value];
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
 * What the columns actually hold.
 *
 * The run returns `[label, value]` and nothing else, so a header can only be as
 * honest as the spec behind it: a bucketed object is a period, a grouped object
 * is the column it grouped by, and an ungrouped total is just a total.
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
  const series = result.series ?? [];
  // A series table is one column per series plus the row total, so the reader can
  // compare both the split and the whole. A missing pair is an em dash, not a
  // zero: "this category has no spend here" is not the same as "spend of 0".
  if (series.length > 0 && result.seriesRows) {
    const cells = new Map<string, number>();
    for (const [label, name, value] of result.seriesRows) {
      cells.set(`${label}\u0000${name}`, value);
    }
    return (
      <table className="view-card__table view-card__table--series">
        <thead>
          <tr>
            <th scope="col">{headers.label}</th>
            {series.map((name) => (
              <th key={name} scope="col" className="view-card__cell--num">
                {name}
                {series.length === 1 ? unit : ""}
              </th>
            ))}
            {series.length > 1 ? (
              <th scope="col" className="view-card__cell--num">
                {headers.value}
                {unit}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {result.rows.map(([label, total]) => (
            <tr key={label}>
              <td>{label}</td>
              {series.map((name) => {
                const value = cells.get(`${label}\u0000${name}`);
                return (
                  <td key={name} className="view-card__cell--num">
                    {value === undefined ? "—" : fmtNumber(value)}
                  </td>
                );
              })}
              {series.length > 1 ? (
                <td className="view-card__cell--num">{fmtNumber(total)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
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
 * A row object: the database's own rows, one line each, under the same chrome an
 * aggregate table wears — because it is a table, and a card that changed its
 * hairlines when its shape changed would read as a different object.
 *
 * One thing does differ. An aggregate has exactly one number in it, so the
 * table's CSS can right-align everything after the first cell and be right every
 * time. A row object holds whatever columns the operator asked for, so each cell
 * is aligned by what it holds: text keeps the left edge, a number takes the right
 * one in tabular figures, and the money column carries the currency unit when
 * every row shares one.
 */
function ViewList({
  result,
  rows,
}: {
  result: ViewRunResult;
  rows: NonNullable<ViewRunResult["listRows"]>;
}) {
  const unit = result.currency && result.currency !== "mixed" ? ` (${result.currency})` : "";
  // A column is a number column when its own cells are numbers. The engine hands
  // back each value as the row stores it — a number stays a number — so the
  // heading can be aligned from the data rather than from a guess at what the
  // column is called, and a heading and its cells cannot disagree about it.
  const numeric = result.columns.map((_, index) =>
    rows.some((row) => typeof row[index] === "number"),
  );
  return (
    <table className="view-card__table view-card__table--list">
      <thead>
        <tr>
          {result.columns.map((name, index) => (
            <th
              key={name}
              scope="col"
              className={numeric[index] ? "view-card__cell--num" : undefined}
            >
              {humanizeId(name)}
              {result.currencyColumn === name ? unit : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className={numeric[cellIndex] ? "view-card__cell--num" : undefined}
              >
                {typeof cell === "number" ? fmtNumber(cell) : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The six colour slots a series maps to, in theme tokens (see global.css). */
function seriesColor(index: number): string {
  return `var(--chart-${(index % 6) + 1})`;
}

/** Chart geometry, in viewBox units. */
const CHART = {
  width: 480,
  height: 220,
  left: 48,
  right: 10,
  /** Room above the plot for a value label on the tallest mark. */
  top: 24,
  axisBottom: 184,
  tickY: 200,
  xLabelY: 215,
};

/**
 * Bar and line over the same aggregate.
 *
 * The drawing answers the questions a spreadsheet chart answers and a bare
 * sparkline does not: a zero baseline with negative values below it, a y-axis
 * with readable ticks, optional axis captions, an optional value on each mark,
 * and one colour per series with a legend. Colours come from theme tokens, so a
 * skin repaint recolours a saved chart without touching its file.
 *
 * The canvas is fixed and its aspect preserved: the card scales the whole
 * drawing, so a tick stays the size it was designed at instead of stretching
 * with the card's width and letterboxing its text.
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
  const display = spec?.display ?? {};
  const labels = result.rows.map(([label]) => label);
  const seriesNames = result.series && result.series.length > 0 ? result.series : ["Value"];
  const multi = seriesNames.length > 1;
  const values = result.rows.map(([, value]) => value);
  const seriesValues = new Map<string, number>();
  for (const [label, name, value] of result.seriesRows ?? []) {
    seriesValues.set(`${label}\u0000${name}`, value);
  }
  const allValues = result.seriesRows
    ? [...seriesValues.values(), ...values]
    : values;
  const rawMax = Math.max(0, ...allValues);
  const rawMin = Math.min(0, ...allValues);
  const maxY = rawMin === 0 ? rawMax || 1 : rawMax;
  const minY = rawMin === 0 ? 0 : rawMin;
  const plotH = CHART.axisBottom - CHART.top;
  const plotW = CHART.width - CHART.left - CHART.right;
  const yOf = (value: number): number =>
    CHART.axisBottom - ((value - minY) / (maxY - minY || 1)) * plotH;
  const zeroY = yOf(0);
  const slot = plotW / Math.max(1, labels.length);
  const cluster = multi ? slot * 0.8 : slot * 0.62;
  const barW = cluster / seriesNames.length;
  const maxTickChars = Math.max(4, Math.floor((slot - 4) / 5.5));
  const tick = (label: string) =>
    label.length > maxTickChars ? `${label.slice(0, Math.max(1, maxTickChars - 1))}…` : label;
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => minY + ((maxY - minY) * i) / tickCount);
  const showLegend = display.legend ?? multi;
  const unit =
    result.currency && result.currency !== "mixed" ? ` ${result.currency}` : "";
  const palette = display.palette ?? "accent";

  return (
    <div className={`view-card__chart-wrap view-card__chart-wrap--${palette}`}>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className={`view-card__chart view-card__chart--${presentation} view-card__chart--palette-${palette}`}
        role="img"
        aria-label={`${spec?.title ?? ""} ${presentation === "bar" ? "bar chart" : "line chart"}`.trim()}
      >
        {yTicks.map((value, index) => (
          <g key={`grid${index}`}>
            <line
              className="view-card__grid"
              x1={CHART.left}
              y1={yOf(value)}
              x2={CHART.width - CHART.right}
              y2={yOf(value)}
            />
            <text
              x={CHART.left - 6}
              y={yOf(value) + 4}
              textAnchor="end"
              fontSize="10"
              className="view-card__axis-label"
            >
              {fmtAxis(value)}
            </text>
          </g>
        ))}
        <line
          className="view-card__axis"
          x1={CHART.left}
          y1={CHART.axisBottom}
          x2={CHART.width - CHART.right}
          y2={CHART.axisBottom}
        />
        {minY < 0 && maxY > 0 ? (
          <line
            className="view-card__zero"
            x1={CHART.left}
            y1={zeroY}
            x2={CHART.width - CHART.right}
            y2={zeroY}
          />
        ) : null}

        {labels.map((label, index) => (
          <text
            key={`label${index}`}
            x={CHART.left + slot * (index + 0.5)}
            y={CHART.tickY}
            textAnchor="middle"
            fontSize="10"
            className="view-card__tick"
          >
            {tick(label)}
          </text>
        ))}

        {presentation === "bar"
          ? labels.flatMap((label, index) =>
              seriesNames.map((name, sIndex) => {
                const value = multi
                  ? (seriesValues.get(`${label}\u0000${name}`) ?? 0)
                  : (result.rows[index]?.[1] ?? 0);
                const center = CHART.left + slot * (index + 0.5);
                const x = center - cluster / 2 + sIndex * barW;
                const y = yOf(Math.max(0, value));
                const height = Math.abs(yOf(value) - zeroY);
                return (
                  <g key={`bar${index}-${sIndex}`}>
                    <rect
                      className="view-card__bar"
                      x={x}
                      y={value >= 0 ? y : zeroY}
                      width={Math.max(1, barW - 1)}
                      height={Math.max(1, height)}
                      rx="1.5"
                      style={{ fill: seriesColor(sIndex) }}
                    >
                      <title>{`${label}${multi ? ` · ${name}` : ""}: ${fmtNumber(value)}${unit}`}</title>
                    </rect>
                    {display.valueLabels ? (
                      <text
                        x={x + Math.max(1, barW - 1) / 2}
                        y={value >= 0 ? y - 3 : zeroY + height + 10}
                        textAnchor="middle"
                        fontSize="9"
                        className="view-card__value-label"
                      >
                        {fmtNumber(value)}
                      </text>
                    ) : null}
                  </g>
                );
              }),
            )
          : seriesNames.map((name, sIndex) => {
              const points = labels
                .map((label, index) => {
                  const value = multi
                    ? seriesValues.get(`${label}\u0000${name}`)
                    : result.rows[index]?.[1];
                  if (value === undefined) return null;
                  return {
                    x: CHART.left + slot * (index + 0.5),
                    y: yOf(value),
                    value,
                    label,
                  };
                })
                .filter((p): p is { x: number; y: number; value: number; label: string } => p !== null);
              if (points.length === 0) return null;
              return (
                <g key={`series${sIndex}`}>
                  <polyline
                    className="view-card__line"
                    points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    style={{ stroke: seriesColor(sIndex) }}
                  />
                  {points.map((p, i) => (
                    <g key={`dot${sIndex}-${i}`}>
                      <circle
                        className="view-card__dot"
                        cx={p.x}
                        cy={p.y}
                        r="3"
                        style={{ fill: seriesColor(sIndex) }}
                      >
                        <title>{`${p.label}${multi ? ` · ${name}` : ""}: ${fmtNumber(p.value)}${unit}`}</title>
                      </circle>
                      {display.valueLabels ? (
                        <text
                          x={p.x}
                          y={p.y - 7}
                          textAnchor="middle"
                          fontSize="9"
                          className="view-card__value-label"
                        >
                          {fmtNumber(p.value)}
                        </text>
                      ) : null}
                    </g>
                  ))}
                </g>
              );
            })}

        {display.xLabel ? (
          <text
            x={CHART.left + plotW / 2}
            y={CHART.xLabelY}
            textAnchor="middle"
            fontSize="10"
            className="view-card__axis-caption"
          >
            {display.xLabel}
          </text>
        ) : null}
        {display.yLabel ? (
          <text
            transform={`translate(12 ${CHART.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="10"
            className="view-card__axis-caption"
          >
            {display.yLabel}
          </text>
        ) : null}
      </svg>
      {showLegend ? (
        <ul className="view-card__legend" aria-label="Legend">
          {seriesNames.map((name, index) => (
            <li key={name} className="view-card__legend-item">
              <span
                className="view-card__legend-swatch"
                style={{ background: seriesColor(index) }}
                aria-hidden="true"
              />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
