import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { VaultSnapshot } from "@lifequest/vault-core";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useVault } from "@/state/VaultProvider";
import {
  COMPOSITION_ROUTE_PATHS,
  type CompositionAvatar,
  type CompositionBrief,
  type CompositionCalendar,
  type CompositionClock,
  type CompositionDataSource,
  type CompositionList,
  type CompositionQuickAction,
  type CompositionRegion,
  type CompositionWidget,
} from "@/lib/themes/theme-file";

/**
 * Composition slots — where a theme's widgets stand.
 *
 * The renderer is deliberately dull: it asks the theme for the widgets whose
 * region matches, reads each widget's bound value from the vault snapshot the
 * shell already holds, and draws from tokens. It never fetches, never
 * subscribes and never computes new state — the closed source lists in
 * `shared/composition.ts` are the whole channel. A widget cannot be an image, a
 * link to anything but an app route, or a piece of markup; the parser has
 * already refused everything else, so this file only has to be boring.
 *
 * Accessibility is part of the drawing, not an addition: a badge is text, so it
 * is read in order; a meter is a `progressbar` with `aria-valuenow`/`max` and a
 * label that says the same numbers the bar fills from (the bar is
 * `aria-hidden`, so the count is never announced twice); a list is a real list;
 * a clock is a `<time>` that announces its label; the calendar marks today with
 * `aria-current`; the avatar's disc is decorative and its accessible name is the
 * operator's name.
 */

/** Read a closed count off the snapshot. Missing snapshot reads as zero. */
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

/** Read a closed text source off the snapshot. */
function sourceText(
  source: "vault.name" | "domains.names" | "goals.titles",
  snapshot: VaultSnapshot | null,
): string | string[] {
  if (!snapshot) return source === "vault.name" ? "" : [];
  if (source === "vault.name") return snapshot.lifequest.name;
  if (source === "domains.names") {
    return snapshot.domains
      .filter((domain) => !domain.meta.archivedAt)
      .map((domain) => domain.meta.name);
  }
  return snapshot.goals.map((goal) => goal.name);
}

/** Two letters at most: identity a theme can draw without an image. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function toneClass(widget: CompositionWidget): string {
  return widget.tone
    ? `composition-widget--${widget.tone}`
    : "composition-widget--accent";
}

function widgetClass(widget: CompositionWidget, kind: string): string {
  return ["composition-widget", `composition-widget--${kind}`, toneClass(widget)].join(
    " ",
  );
}

const ringStyleFor = (index: number, total: number): CSSProperties =>
  ({
    "--composition-angle": `${Math.round((360 / Math.max(total, 1)) * index)}deg`,
  }) as CSSProperties;

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
        toneClass(widget),
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

function Avatar({
  widget,
  snapshot,
  ringStyle,
}: {
  widget: CompositionAvatar;
  snapshot: VaultSnapshot | null;
  ringStyle: CSSProperties;
}) {
  const name = sourceText("vault.name", snapshot) as string;
  return (
    <span
      className={widgetClass(widget, "avatar")}
      data-testid="composition-widget"
      data-widget-type="avatar"
      data-widget-region={widget.region}
      data-widget-data={widget.data}
      style={ringStyle}
      role="img"
      aria-label={name ? `${widget.label}: ${name}` : widget.label}
      title={name ? `${widget.label}: ${name}` : widget.label}
    >
      <span className="composition-avatar__disc" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="composition-widget__label" aria-hidden="true">
        {widget.label}
      </span>
    </span>
  );
}

function List({
  widget,
  snapshot,
  ringStyle,
}: {
  widget: CompositionList;
  snapshot: VaultSnapshot | null;
  ringStyle: CSSProperties;
}) {
  const source = sourceText(widget.data, snapshot) as string[];
  const items = source.slice(0, widget.limit ?? 3);
  return (
    <div
      className={widgetClass(widget, "list")}
      data-testid="composition-widget"
      data-widget-type="list"
      data-widget-region={widget.region}
      data-widget-data={widget.data}
      style={ringStyle}
    >
      <span className="composition-widget__label">{widget.label}</span>
      <ul className="composition-list__items" aria-label={widget.label}>
        {items.length === 0 ? (
          <li className="composition-list__item composition-list__item--empty">
            None
          </li>
        ) : (
          items.map((item) => (
            <li key={item} className="composition-list__item">
              {item}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function Clock({
  widget,
  ringStyle,
}: {
  widget: CompositionClock;
  ringStyle: CSSProperties;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // A minute is the smallest unit drawn; the tick keeps it honest without
    // waking the page every second.
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const formatted = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: widget.format === "12h",
  }).format(now);
  return (
    <time
      className={widgetClass(widget, "clock")}
      data-testid="composition-widget"
      data-widget-type="clock"
      data-widget-region={widget.region}
      style={ringStyle}
      dateTime={now.toISOString()}
      aria-label={`${widget.label}: ${formatted}`}
      title={`${widget.label}: ${formatted}`}
    >
      <span className="composition-widget__label">{widget.label}</span>
      <span className="composition-widget__value">{formatted}</span>
    </time>
  );
}

function Calendar({
  widget,
  ringStyle,
}: {
  widget: CompositionCalendar;
  ringStyle: CSSProperties;
}) {
  const today = new Date();
  const monday = new Date(today);
  const weekday = (today.getDay() + 6) % 7; // Monday = 0
  monday.setDate(today.getDate() - weekday);
  const days = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + offset);
    return day;
  });
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
  }).format(today);
  return (
    <div
      className={widgetClass(widget, "calendar")}
      data-testid="composition-widget"
      data-widget-type="calendar"
      data-widget-region={widget.region}
      style={ringStyle}
      role="group"
      aria-label={`${widget.label}, ${monthLabel}`}
    >
      <span className="composition-widget__label">
        {widget.label}
        <span className="composition-calendar__month">{monthLabel}</span>
      </span>
      <span className="composition-calendar__week">
        {days.map((day) => {
          const isToday =
            day.getDate() === today.getDate() &&
            day.getMonth() === today.getMonth() &&
            day.getFullYear() === today.getFullYear();
          return (
            <span
              key={day.toISOString()}
              className={[
                "composition-calendar__day",
                isToday ? "composition-calendar__day--today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isToday ? "date" : undefined}
            >
              {day.getDate()}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function Brief({
  widget,
  snapshot,
  ringStyle,
}: {
  widget: CompositionBrief;
  snapshot: VaultSnapshot | null;
  ringStyle: CSSProperties;
}) {
  const value = sourceValue(widget.data, snapshot);
  return (
    <div
      className={widgetClass(widget, "brief")}
      data-testid="composition-widget"
      data-widget-type="brief"
      data-widget-region={widget.region}
      data-widget-data={widget.data}
      style={ringStyle}
      title={`${widget.label}: ${value}`}
    >
      <span className="composition-widget__label">{widget.label}</span>
      <span className="composition-widget__value">{value}</span>
      {widget.caption ? (
        <span className="composition-brief__caption">{widget.caption}</span>
      ) : null}
    </div>
  );
}

function Widget({
  widget,
  snapshot,
  index,
  total,
}: {
  widget: CompositionWidget;
  snapshot: VaultSnapshot | null;
  index: number;
  total: number;
}) {
  const ringStyle = ringStyleFor(index, total);

  if (widget.type === "quickAction") {
    return <QuickAction widget={widget} ringStyle={ringStyle} />;
  }

  if (widget.type === "meter") {
    const value = sourceValue(widget.data, snapshot);
    const now = Math.max(0, Math.min(widget.max, value));
    const percent = Math.round((now / widget.max) * 100);
    return (
      <div
        className={widgetClass(widget, "meter")}
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

  if (widget.type === "avatar") {
    return <Avatar widget={widget} snapshot={snapshot} ringStyle={ringStyle} />;
  }

  if (widget.type === "list") {
    return <List widget={widget} snapshot={snapshot} ringStyle={ringStyle} />;
  }

  if (widget.type === "clock") {
    return <Clock widget={widget} ringStyle={ringStyle} />;
  }

  if (widget.type === "calendar") {
    return <Calendar widget={widget} ringStyle={ringStyle} />;
  }

  if (widget.type === "brief") {
    return <Brief widget={widget} snapshot={snapshot} ringStyle={ringStyle} />;
  }

  const value = sourceValue(widget.data, snapshot);
  return (
    <span
      className={widgetClass(widget, "badge")}
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
      snapshot={snapshot}
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
