/**
 * Composition — the R4 rung: a theme may place a *closed* vocabulary of small
 * widgets on a *closed* vocabulary of named regions.
 *
 * This file is the contract, not the renderer. Everything here is data: no
 * code, no CSS, no DOM, no images. That is deliberate. The shell's promise is
 * that a theme is a document the app knows how to draw; the moment a theme can
 * place arbitrary markup it can imitate the Decisions surface, cover the way
 * out, or read things it was never given.
 *
 * The three closed sets are the whole surface an author (or the companion)
 * needs to know:
 *
 *  - `COMPOSITION_REGIONS`   — where a widget may stand.
 *  - `COMPOSITION_WIDGET_TYPES` — what it may be (badge, meter).
 *  - `COMPOSITION_DATA_SOURCES` — what it may read (counts the shell already
 *    holds; a widget never fetches, subscribes or computes new state).
 *
 * Parsing is total and field-named, in the same style as the palette and chrome
 * parsers: a typo comes back as `composition.widgets[1].region must be one of
 * …`, never as a half-worn theme.
 *
 * The renderer (R4.1) draws only what `resolveComposition` hands it, and the
 * operator's override is one axis — wear the theme's widgets, or none — so the
 * way back is always the same: Settings › Appearance › Composition › Reset.
 */

/** Where a composition widget may stand. Closed. */
export type CompositionRegion =
  | "page.masthead"
  | "page.footer"
  | "rail.top"
  | "rail.footer";

export const COMPOSITION_REGIONS: readonly CompositionRegion[] = [
  "page.masthead",
  "page.footer",
  "rail.top",
  "rail.footer",
];

/**
 * How a region lays its widgets out. Closed, and grown one rung at a time:
 * `stack` ships with R4.1 (a vertical list in reading order); `grid` and
 * `polar` are the R4.2 constructs and are refused by today's parser rather than
 * silently ignored.
 */
export type CompositionLayout = "stack";

export const COMPOSITION_LAYOUTS: readonly CompositionLayout[] = ["stack"];

/** The widget vocabulary. Closed: a theme cannot add to it. */
export type CompositionWidgetType = "badge" | "meter";

export const COMPOSITION_WIDGET_TYPES: readonly CompositionWidgetType[] = [
  "badge",
  "meter",
];

/**
 * The data a widget may read, bound to the vault snapshot the shell already
 * holds. A source is a count or a small integer; nothing here is a route, a
 * URL, a file path or free text from the vault.
 */
export type CompositionDataSource =
  | "domains.count"
  | "agents.count"
  | "decisions.count"
  | "goals.count"
  | "reviews.count"
  | "weekly.files";

export const COMPOSITION_DATA_SOURCES: readonly CompositionDataSource[] = [
  "domains.count",
  "agents.count",
  "decisions.count",
  "goals.count",
  "reviews.count",
  "weekly.files",
];

/** A widget's accent: named token families only, never a colour. */
export type CompositionTone = "accent" | "muted" | "success" | "warning";

export const COMPOSITION_TONES: readonly CompositionTone[] = [
  "accent",
  "muted",
  "success",
  "warning",
];

export type CompositionBadge = {
  type: "badge";
  region: CompositionRegion;
  /** The count it shows, e.g. "goals.count" → "Goals 4". */
  data: CompositionDataSource;
  /** What the count is, in the operator's words (≤ 32 chars). */
  label: string;
  tone?: CompositionTone;
};

export type CompositionMeter = {
  type: "meter";
  region: CompositionRegion;
  /** The count it fills from, e.g. "weekly.files" → "3 of 7". */
  data: CompositionDataSource;
  label: string;
  /** The denominator: an integer the widget draws the numerator against. */
  max: number;
  tone?: CompositionTone;
};

export type CompositionWidget = CompositionBadge | CompositionMeter;

/** A composition as it arrives from a theme file, before defaults fill the gaps. */
export type ThemeCompositionFile = {
  layout?: CompositionLayout;
  widgets?: CompositionWidget[];
};

/** A composition the shell will draw: a layout and at least one widget. */
export type ThemeComposition = {
  layout: CompositionLayout;
  widgets: CompositionWidget[];
};

/** The operator's own composition pick: wear the theme's widgets, or none. */
export type CompositionOverride = {
  enabled?: boolean;
};

/** A region more crowded than this stops being a widget row and becomes a wall. */
export const MAX_COMPOSITION_WIDGETS = 6;

/** Labels are the one place an author writes words; keep them a widget, not a page. */
export const MAX_COMPOSITION_LABEL = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | string {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return `${field} must be one of ${allowed.join(", ")}`;
  }
  return value as T;
}

/**
 * Parse `theme.composition`. Missing composition is not an error: it is a theme
 * with no widgets, which is what every R0–R3 theme is.
 */
export function parseComposition(
  raw: unknown,
):
  | { ok: true; composition: ThemeComposition }
  | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "composition must be an object" };
  }

  let layout: CompositionLayout = "stack";
  if (raw.layout !== undefined) {
    const parsed = oneOf(
      raw.layout,
      COMPOSITION_LAYOUTS,
      "composition.layout",
    );
    if (!COMPOSITION_LAYOUTS.includes(parsed as CompositionLayout)) {
      return { ok: false, error: parsed };
    }
    layout = parsed as CompositionLayout;
  }

  if (!Array.isArray(raw.widgets)) {
    return { ok: false, error: "composition.widgets must be an array" };
  }
  if (raw.widgets.length < 1 || raw.widgets.length > MAX_COMPOSITION_WIDGETS) {
    return {
      ok: false,
      error: `composition.widgets must hold 1–${MAX_COMPOSITION_WIDGETS} widgets`,
    };
  }

  const widgets: CompositionWidget[] = [];
  for (let index = 0; index < raw.widgets.length; index += 1) {
    const field = `composition.widgets[${index}]`;
    const widget = raw.widgets[index];
    if (!isRecord(widget)) {
      return { ok: false, error: `${field} must be an object` };
    }

    const type = oneOf(widget.type, COMPOSITION_WIDGET_TYPES, `${field}.type`);
    if (!COMPOSITION_WIDGET_TYPES.includes(type as CompositionWidgetType)) {
      return { ok: false, error: type };
    }

    const region = oneOf(
      widget.region,
      COMPOSITION_REGIONS,
      `${field}.region`,
    );
    if (!COMPOSITION_REGIONS.includes(region as CompositionRegion)) {
      return { ok: false, error: region };
    }

    const data = oneOf(widget.data, COMPOSITION_DATA_SOURCES, `${field}.data`);
    if (!COMPOSITION_DATA_SOURCES.includes(data as CompositionDataSource)) {
      return { ok: false, error: data };
    }

    if (
      typeof widget.label !== "string" ||
      widget.label.trim() === "" ||
      widget.label.length > MAX_COMPOSITION_LABEL
    ) {
      return {
        ok: false,
        error: `${field}.label must be a non-empty string of at most ${MAX_COMPOSITION_LABEL} chars`,
      };
    }

    let tone: CompositionTone | undefined;
    if (widget.tone !== undefined) {
      const parsedTone = oneOf(widget.tone, COMPOSITION_TONES, `${field}.tone`);
      if (!COMPOSITION_TONES.includes(parsedTone as CompositionTone)) {
        return { ok: false, error: parsedTone };
      }
      tone = parsedTone as CompositionTone;
    }

    if (type === "meter") {
      if (
        typeof widget.max !== "number" ||
        !Number.isInteger(widget.max) ||
        widget.max < 1 ||
        widget.max > 1000
      ) {
        return {
          ok: false,
          error: `${field}.max must be an integer from 1 to 1000`,
        };
      }
      widgets.push({
        type: "meter",
        region: region as CompositionRegion,
        data: data as CompositionDataSource,
        label: widget.label,
        max: widget.max,
        ...(tone ? { tone } : {}),
      });
    } else {
      widgets.push({
        type: "badge",
        region: region as CompositionRegion,
        data: data as CompositionDataSource,
        label: widget.label,
        ...(tone ? { tone } : {}),
      });
    }
  }

  return { ok: true, composition: { layout, widgets } };
}

/** A theme with no widgets resolves to nothing to draw. */
export function resolveComposition(
  composition?: ThemeCompositionFile | null,
): ThemeComposition | null {
  if (!composition || !composition.widgets || composition.widgets.length === 0) {
    return null;
  }
  return { layout: composition.layout ?? "stack", widgets: composition.widgets };
}

/**
 * Layer the operator's pick over the theme's: composition is a single "wear it
 * or not" axis in R4.1. Hiding it is reversible by Reset, and Reset is outside
 * every theme's reach.
 */
export function layerComposition(
  composition?: ThemeCompositionFile | null,
  override?: CompositionOverride | null,
): ThemeComposition | null {
  if (override?.enabled === false) return null;
  return resolveComposition(composition);
}

/**
 * The composition lines of the authoring vocabulary. Kept in this module so the
 * closed sets and the words a companion is taught cannot drift apart.
 */
export const COMPOSITION_VOCABULARY = [
  "composition (optional): { layout: stack, widgets: [ …1–6 ] } places small widgets on named regions. No code, no CSS, no images, no arbitrary text beyond a 32-char label.",
  "composition.widgets[].type: badge | meter; region: page.masthead | page.footer | rail.top | rail.footer; data: domains.count | agents.count | decisions.count | goals.count | reviews.count | weekly.files.",
  "composition.widgets[].label: ≤32 chars. tone: accent | muted | success | warning (optional). meter also needs max: an integer 1–1000 — the badge draws 'label value', the meter draws 'label value/max' as a bar.",
  "The operator can hide the composition in Settings › Appearance › Composition, and Reset hands it back to the theme; a composition never draws chrome, a Decision, or a control that can remove the way out.",
].join("\n");
