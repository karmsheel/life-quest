/**
 * The studio's composition model — the pure half of the Fields view.
 *
 * The editor never invents vocabulary: the closed sets, caps and types all come
 * from the shared `composition.ts` the parser and the shell draw from, so a
 * control can only offer values that a theme file may legally hold. This module
 * turns "the operator moved this widget / changed that layout" into a new
 * `ThemeFile` carrying exactly the schema's own keys — nothing extra is ever
 * written back.
 *
 * Two invariants make the form safe to build on:
 *  - every widget a control produces is valid by construction (defaults per
 *    type, legal enum values only, labels sliced to the cap);
 *  - `composition` exists exactly when there is at least one widget. The parser
 *    requires 1–8 widgets, so removing the last widget removes the key rather
 *    than serialising an empty array it would refuse.
 */
import {
  COMPOSITION_DATA_SOURCES,
  COMPOSITION_LAYOUTS,
  COMPOSITION_POLAR_RADII,
  COMPOSITION_REGIONS,
  COMPOSITION_ROUTES,
  COMPOSITION_TEXT_SOURCES,
  COMPOSITION_TONES,
  COMPOSITION_WIDGET_TYPES,
  MAX_COMPOSITION_LABEL,
  MAX_COMPOSITION_LIST_ITEMS,
  MAX_COMPOSITION_WIDGETS,
  type CompositionClockFormat,
  type CompositionDataSource,
  type CompositionLayout,
  type CompositionPolarRadius,
  type CompositionRegion,
  type CompositionRoute,
  type CompositionTextSource,
  type CompositionTone,
  type CompositionWidget,
  type CompositionWidgetType,
  type ThemeFile,
} from "@/lib/themes/theme-file";

/** The words the operator reads for each closed set. One place, so a new enum is a type error. */
export const REGION_LABELS: Record<CompositionRegion, string> = {
  "page.masthead": "Page masthead",
  "page.footer": "Page footer",
  "page.orbit": "Page orbit",
  "rail.top": "Sidebar top",
  "rail.footer": "Sidebar footer",
};

export const WIDGET_TYPE_LABELS: Record<CompositionWidgetType, string> = {
  badge: "Badge",
  meter: "Meter",
  quickAction: "Quick action",
  avatar: "Avatar",
  list: "List",
  clock: "Clock",
  calendar: "Calendar",
  brief: "Brief",
};

export const LAYOUT_LABELS: Record<CompositionLayout, string> = {
  stack: "Stack",
  grid: "Grid",
  polar: "Polar",
};

export const POLAR_RADIUS_LABELS: Record<CompositionPolarRadius, string> = {
  tight: "Tight",
  default: "Default",
  wide: "Wide",
};

export const DATA_SOURCE_LABELS: Record<CompositionDataSource, string> = {
  "domains.count": "Domains",
  "agents.count": "Agents",
  "decisions.count": "Decisions",
  "goals.count": "Goals",
  "reviews.count": "Reviews",
  "weekly.files": "Weekly files",
};

export const TEXT_SOURCE_LABELS: Record<CompositionTextSource, string> = {
  "vault.name": "Vault name",
  "domains.names": "Domain names",
  "goals.titles": "Goal titles",
};

export const ROUTE_LABELS: Record<CompositionRoute, string> = {
  home: "Home",
  goals: "Goals",
  projects: "Projects",
  data: "Data",
  notes: "Notes",
  automations: "Automations",
};

export const TONE_LABELS: Record<CompositionTone, string> = {
  accent: "Accent",
  muted: "Muted",
  success: "Success",
  warning: "Warning",
};

/**
 * What each region does, in the operator's words. These are the studio's inline
 * hints: a rule the parser enforces (page.orbit only draws in polar) is said out
 * loud here rather than discovered by a refused save.
 */
export const REGION_HINTS: Record<CompositionRegion, string> = {
  "page.masthead": "Above the page title. Draws in every layout.",
  "page.footer": "Below the page content. Draws in every layout.",
  "page.orbit":
    "Only the polar layout draws this. Picking it switches the layout to polar; leaving polar moves its widgets to the page masthead.",
  "rail.top": "At the top of the sidebar. Draws in every layout.",
  "rail.footer": "At the bottom of the sidebar. Draws in every layout.",
};

/**
 * The working shape of a composition in the studio. It is deliberately more
 * forgiving than `ThemeComposition`: the editor starts from "no widgets" and
 * carries the layout/columns/radius the operator picked before the first widget
 * exists, so the controls do not jump around.
 */
export interface StudioComposition {
  layout: CompositionLayout;
  columns: 2 | 3;
  radius: CompositionPolarRadius;
  widgets: CompositionWidget[];
}

/** Read a theme into the studio's working shape. No composition ⇒ stack, no widgets. */
export function studioCompositionOf(theme: ThemeFile): StudioComposition {
  const composition = theme.composition;
  return {
    layout: composition?.layout ?? "stack",
    columns: composition?.columns ?? 2,
    radius: composition?.radius ?? "default",
    widgets: composition?.widgets ?? [],
  };
}

/**
 * Put the working shape back into the theme. Only schema keys survive: the input
 * theme was already parser-shaped, and the composition object is built field by
 * field — layout, optional grid columns or polar radius, widgets and nothing
 * else. An empty widget list removes the key entirely (valid: no widgets).
 */
export function withStudioComposition(
  theme: ThemeFile,
  studio: StudioComposition,
): ThemeFile {
  const next: ThemeFile = { ...theme };
  if (studio.widgets.length === 0) {
    delete next.composition;
    return next;
  }
  next.composition = {
    layout: studio.layout,
    widgets: studio.widgets,
    ...(studio.layout === "grid" ? { columns: studio.columns } : {}),
    ...(studio.layout === "polar" ? { radius: studio.radius } : {}),
  };
  return next;
}

/**
 * A new widget of `type` on `region`, valid as produced: every required field
 * has its default and every optional field is a value the parser accepts. Labels
 * are short nouns so the operator's first look on the shell is readable.
 */
export function defaultWidget(
  type: CompositionWidgetType,
  region: CompositionRegion,
): CompositionWidget {
  switch (type) {
    case "meter":
      return { type, region, data: "weekly.files", label: "Meter", max: 7 };
    case "quickAction":
      return { type, region, route: "home", label: "Quick action" };
    case "avatar":
      return { type, region, data: "vault.name", label: "Avatar" };
    case "list":
      return { type, region, data: "domains.names", label: "List", limit: 3 };
    case "clock":
      return { type, region, label: "Clock", format: "24h" };
    case "calendar":
      return { type, region, label: "Calendar" };
    case "brief":
      return { type, region, data: "goals.count", label: "Brief" };
    case "badge":
    default:
      return { type: "badge", region, data: "goals.count", label: "Badge" };
  }
}

/**
 * Change a widget's type without losing what the operator already wrote. The
 * label and tone are common to every widget; everything else is re-defaulted,
 * because a data source is not a route and a caption is not a max.
 */
export function retypeWidget(
  widget: CompositionWidget,
  type: CompositionWidgetType,
): CompositionWidget {
  if (widget.type === type) return widget;
  const next = defaultWidget(type, widget.region);
  return {
    ...next,
    label: widget.label.slice(0, MAX_COMPOSITION_LABEL),
    ...(widget.tone ? { tone: widget.tone } : {}),
  } as CompositionWidget;
}

/**
 * Move a widget to another region. `page.orbit` is only legal in the polar
 * layout; the caller switches the layout when this returns true, so the draft
 * never carries a widget the parser would refuse.
 */
export function regionNeedsPolar(region: CompositionRegion): boolean {
  return region === "page.orbit";
}

/**
 * When the layout leaves polar, any orbit widget has nowhere to draw. Move it to
 * the page masthead (the first region, always drawn) rather than letting it
 * become an invalid file; the count tells the studio to say what it did.
 */
export function moveOrbitWidgetsToMasthead(widgets: CompositionWidget[]): {
  widgets: CompositionWidget[];
  moved: number;
} {
  let moved = 0;
  const next = widgets.map((widget) => {
    if (widget.region !== "page.orbit") return widget;
    moved += 1;
    return { ...widget, region: "page.masthead" } as CompositionWidget;
  });
  return { widgets: next, moved };
}

/** Swap the widget at `index` with its neighbour; array order is the draw order. */
export function moveWidget(
  widgets: CompositionWidget[],
  index: number,
  direction: -1 | 1,
): CompositionWidget[] {
  const target = index + direction;
  if (index < 0 || index >= widgets.length) return widgets;
  if (target < 0 || target >= widgets.length) return widgets;
  const next = [...widgets];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** The live summary a role="status" line reads out: "3 widgets: 1 badge, 2 quick actions". */
export function compositionSummary(widgets: CompositionWidget[]): string {
  if (widgets.length === 0) return "No widgets yet — add one below.";
  const counts = new Map<CompositionWidgetType, number>();
  for (const widget of widgets) {
    counts.set(widget.type, (counts.get(widget.type) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([type, count]) => {
    const noun = WIDGET_TYPE_LABELS[type].toLowerCase();
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  });
  return `${widgets.length} widget${widgets.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

/** The legal values every studio control offers, in the shared vocabulary's order. */
export const STUDIO_OFFERS = {
  regions: COMPOSITION_REGIONS,
  widgetTypes: COMPOSITION_WIDGET_TYPES,
  layouts: COMPOSITION_LAYOUTS,
  dataSources: COMPOSITION_DATA_SOURCES,
  textSources: COMPOSITION_TEXT_SOURCES,
  routes: COMPOSITION_ROUTES,
  tones: COMPOSITION_TONES,
  polarRadii: COMPOSITION_POLAR_RADII,
} as const;

export const STUDIO_CAPS = {
  widgets: MAX_COMPOSITION_WIDGETS,
  label: MAX_COMPOSITION_LABEL,
  listLimit: MAX_COMPOSITION_LIST_ITEMS,
} as const;

/**
 * Does this widget type read a count source, a text source, or neither? The form
 * asks the model rather than hard-coding a list that could drift from the parser.
 */
export function dataKindOf(
  type: CompositionWidgetType,
): "count" | "text" | "route" | "none" {
  switch (type) {
    case "badge":
    case "meter":
    case "brief":
      return "count";
    case "avatar":
    case "list":
      return "text";
    case "quickAction":
      return "route";
    case "clock":
    case "calendar":
    default:
      return "none";
  }
}

/** The count sources a widget type may read — list/avatar handle text instead. */
export function countSourcesFor(type: CompositionWidgetType): readonly CompositionDataSource[] {
  return dataKindOf(type) === "count" ? COMPOSITION_DATA_SOURCES : [];
}

/** The text sources a widget type may read; avatar is fixed to the vault's name. */
export function textSourcesFor(type: CompositionWidgetType): readonly CompositionTextSource[] {
  if (type === "avatar") return ["vault.name"];
  if (type === "list") return ["domains.names", "goals.titles"];
  return [];
}

/** Clock faces offered by the format control. */
export const CLOCK_FORMATS: readonly CompositionClockFormat[] = ["24h", "12h"];
