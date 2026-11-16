import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { VaultSnapshot } from "@lifequest/vault-core";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useVault } from "@/state/VaultProvider";
import {
  COMPOSITION_ROUTE_PATHS,
  type CompositionDataSource,
  type CompositionQuickAction,
  type CompositionRegion,
  type CompositionWidget,
} from "@/lib/themes/theme-file";

/**
 * Composition slots — where a theme's widgets stand.
 *
 * The renderer is deliberately dull: it asks the theme for the widgets whose
 * region matches, reads each widget's count from the vault snapshot the shell
 * already holds, and draws from tokens. It never fetches, never subscribes and
 * never computes new state — the closed data-source list in
 * `shared/composition.ts` is the whole channel.
 *
 * Accessibility is part of the drawing, not an addition: a badge is text, so it
 * is read in order; a meter is a `progressbar` with `aria-valuenow`/`max` and a
 * label that says the same numbers the bar fills from. The bar itself is
 * `aria-hidden`, so the count is never announced twice.
 */

/** Read a closed data source off the snapshot. Missing snapshot reads as zero. */
function sourceValue(
  source: CompositionDataSource,
  snapshot: VaultSnapshot | null,
): number {
  if (!snapshot) return 0;
  switch (source) {
    case "domains.count":
      return snapshot.domains.length;
    case "agents.count":
      return snapshot.agents.length;
    case "decisions.count":
      return snapshot.decisions.length;
    case "goals.count":
      return snapshot.goals.length;
    case "reviews.count":
      return snapshot.reviews.length;
    case "weekly.files":
      return snapshot.weeklyFileCount ?? 0;
  }
}

function toneClass(widget: CompositionWidget): string {
  return widget.tone
    ? `composition-widget--${widget.tone}`
    : "composition-widget--accent";
}

function Widget({
  widget,
  value,
  index,
  total,
}: {
  widget: CompositionWidget;
  value: number;
  /** Position on a polar ring: top first, clockwise. Ignored by other layouts. */
  index: number;
  total: number;
}) {
  const ringStyle = {
    "--composition-angle": `${Math.round((360 / Math.max(total, 1)) * index)}deg`,
  } as CSSProperties;

  if (widget.type === "quickAction") {
    return <QuickAction widget={widget} ringStyle={ringStyle} />;
  }

  if (widget.type === "meter") {
    const now = Math.max(0, Math.min(widget.max, value));
    const percent = Math.round((now / widget.max) * 100);
    return (
      <div
        className={[
          "composition-widget",
          "composition-widget--meter",
          toneClass(widget),
        ].join(" ")}
        data-testid="composition-widget"
        data-widget-type="meter"
        data-widget-region={widget.region}
        data-widget-data={widget.data}
        style={ringStyle}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={widget.max}
        aria-valuenow={now}
        aria-label={`${widget.label}: ${now} of ${widget.max}`}
      >
        <span className="composition-widget__label">{widget.label}</span>
        <span className="composition-widget__value">
          {now}
          <span className="composition-widget__denominator">
            /{widget.max}
          </span>
        </span>
        <span className="composition-widget__track" aria-hidden="true">
          <span
            className="composition-widget__fill"
            style={{ width: `${percent}%` }}
          />
        </span>
      </div>
    );
  }

  return (
    <span
      className={[
        "composition-widget",
        "composition-widget--badge",
        toneClass(widget),
      ].join(" ")}
      data-testid="composition-widget"
      data-widget-type="badge"
      data-widget-region={widget.region}
      data-widget-data={widget.data}
      style={ringStyle}
      title={`${widget.label}: ${value}`}
    >
      <span className="composition-widget__label">{widget.label}</span>
      <span className="composition-widget__value">{value}</span>
    </span>
  );
}

/** A link to one of the app's own routes — the only interactive widget. */
function QuickAction({
  widget,
  ringStyle,
}: {
  widget: CompositionQuickAction;
  ringStyle: CSSProperties;
}) {
  return (
    <Link
      to={COMPOSITION_ROUTE_PATHS[widget.route]}
      className={[
        "composition-widget",
        "composition-quick-action",
        widget.tone
          ? `composition-widget--${widget.tone}`
          : "composition-widget--accent",
      ].join(" ")}
      data-testid="composition-quick-action"
      data-widget-type="quickAction"
      data-widget-region={widget.region}
      data-widget-route={widget.route}
      style={ringStyle}
      aria-label={widget.label}
    >
      <span className="composition-quick-action__dot" aria-hidden="true" />
      <span className="composition-widget__label">{widget.label}</span>
    </Link>
  );
}

/** One named region. Renders nothing when the theme places no widget there. */
export function CompositionSlot({ region }: { region: CompositionRegion }) {
  const { composition } = useTheme();
  const { snapshot } = useVault();
  const widgets =
    composition?.widgets.filter((widget) => widget.region === region) ?? [];

  if (widgets.length === 0) return null;

  const slug = region.replaceAll(".", "-");
  const layout = composition?.layout ?? "stack";
  const isOrbit = region === "page.orbit";
  const gridStyle =
    layout === "grid"
      ? ({
          gridTemplateColumns: `repeat(${composition?.columns ?? 2}, minmax(0, 1fr))`,
        } as CSSProperties)
      : undefined;

  const children = widgets.map((widget, index) => (
    <Widget
      key={`${widget.type}-${widget.label}-${index}`}
      widget={widget}
      value={
        widget.type === "quickAction"
          ? 0
          : sourceValue(widget.data, snapshot)
      }
      index={index}
      total={widgets.length}
    />
  ));

  const className = [
    "composition-slot",
    `composition-slot--${slug}`,
    `composition-slot--layout-${layout}`,
    composition?.radius ? `composition-slot--radius-${composition.radius}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The orbit is navigation, not decoration: expose it as such, so a screen
  // reader finds the ring's links by name and the keyboard can tab through
  // them in the order they are drawn (top first, clockwise).
  if (isOrbit) {
    return (
      <nav
        className={className}
        data-testid={`composition-slot-${slug}`}
        data-composition-region={region}
        data-composition-layout={layout}
        style={gridStyle}
        aria-label="Quick actions"
      >
        {children}
      </nav>
    );
  }

  return (
    <div
      className={className}
      data-testid={`composition-slot-${slug}`}
      data-composition-region={region}
      data-composition-layout={layout}
      style={gridStyle}
    >
      {children}
    </div>
  );
}
