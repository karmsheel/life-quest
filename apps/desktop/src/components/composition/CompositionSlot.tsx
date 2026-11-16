import type { VaultSnapshot } from "@lifequest/vault-core";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useVault } from "@/state/VaultProvider";
import type {
  CompositionDataSource,
  CompositionRegion,
  CompositionWidget,
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
}: {
  widget: CompositionWidget;
  value: number;
}) {
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
      title={`${widget.label}: ${value}`}
    >
      <span className="composition-widget__label">{widget.label}</span>
      <span className="composition-widget__value">{value}</span>
    </span>
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
  return (
    <div
      className={`composition-slot composition-slot--${slug}`}
      data-testid={`composition-slot-${slug}`}
      data-composition-region={region}
      data-composition-layout={composition?.layout ?? "stack"}
    >
      {widgets.map((widget, index) => (
        <Widget
          key={`${widget.type}-${widget.label}-${index}`}
          widget={widget}
          value={sourceValue(widget.data, snapshot)}
        />
      ))}
    </div>
  );
}
