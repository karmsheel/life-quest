/**
 * The area lens, as data.
 *
 * The title-bar lens is the control whose only job is "which part of the life
 * is on screen". Its shape is a thing the operator is allowed to disagree with,
 * the same way the chat dock's agent picker is: a round LIFE mark in the centre
 * is right for someone who thinks of Life as the union, and wrong for someone
 * who wants a plain row, a letter each, or a column in the rail. So the shape
 * is a **recipe** — four closed axes — and the app ships four *named modes*
 * that are presets over those axes:
 *
 *   life-mark     centre + circle + names + segment   the default
 *   named-strip   leading + chip + names + segment    LIFE first, one row
 *   initials      centre + circle + initials + segment  letters, LIFE still a circle
 *   stack         stack + chip + names + segment      LIFE on top, then rows
 *
 * A theme may name any of those, or `custom` and set the axes itself. The
 * vocabulary is closed on purpose: a mode is a combination of values the
 * renderer already knows how to draw. Nothing in a theme can ship code, a
 * stylesheet, or a component name.
 *
 * Where the lens sits (`chrome.domainSwitcher.place`) and the dock's frame
 * stay placement. This recipe is only the shape. An older file that never
 * names `domainPicker` still wears a shape: its `domainSwitcher.variant` maps
 * onto a choice (`segmented` → life mark, `pill` → life mark with pill chips,
 * `icons` → initials, `list` → stack). Once `domainPicker` is set, it wins.
 *
 * The renderer (`DomainSwitcher.tsx`) reads only the resolved recipe and sets
 * `data-*` attributes; the stylesheet owns the pixels. A new mode is data plus
 * one CSS block, not another component.
 *
 * This module is in `shared/` because three callers need the same rules: the
 * renderer, main's theme parser, and the E2E rigs. It touches neither the
 * vault nor the DOM.
 */

/** The modes the app ships. Their order is the order the Studio offers. */
export const DOMAIN_PICKER_MODES = [
  "life-mark",
  "named-strip",
  "initials",
  "stack",
] as const;
export type DomainPickerMode = (typeof DOMAIN_PICKER_MODES)[number];

/**
 * What a theme may name: a shipped mode, or `custom`. `custom` still resolves
 * to a recipe; it is not an escape hatch out of the vocabulary.
 */
export const DOMAIN_PICKER_CHOICES = [...DOMAIN_PICKER_MODES, "custom"] as const;
export type DomainPickerChoiceMode = (typeof DOMAIN_PICKER_CHOICES)[number];

export const DOMAIN_PICKER_ARRANGEMENTS = ["centre", "leading", "stack"] as const;
export type DomainPickerArrangement = (typeof DOMAIN_PICKER_ARRANGEMENTS)[number];

export const DOMAIN_PICKER_MARKS = ["circle", "chip"] as const;
export type DomainPickerMark = (typeof DOMAIN_PICKER_MARKS)[number];

export const DOMAIN_PICKER_LABELS = ["names", "initials"] as const;
export type DomainPickerLabels = (typeof DOMAIN_PICKER_LABELS)[number];

export const DOMAIN_PICKER_CHIPS = ["segment", "pill"] as const;
export type DomainPickerChips = (typeof DOMAIN_PICKER_CHIPS)[number];

/** The four axes, fully resolved. Every mode is one point in this space. */
export type DomainPickerRecipe = {
  arrangement: DomainPickerArrangement;
  mark: DomainPickerMark;
  labels: DomainPickerLabels;
  chips: DomainPickerChips;
};

/**
 * The modes, spelled out.
 *
 * `life-mark` is the bar as it ships: a round LIFE in the centre, names on
 * either side. `named-strip` is the row LIFE leads, with no circle.
 * `initials` keeps that circle and spends the width on letters. `stack` is
 * the column the rail is built for, LIFE as its first row.
 */
export const DOMAIN_PICKER_PRESETS: Readonly<
  Record<DomainPickerMode, DomainPickerRecipe>
> = {
  "life-mark": {
    arrangement: "centre",
    mark: "circle",
    labels: "names",
    chips: "segment",
  },
  "named-strip": {
    arrangement: "leading",
    mark: "chip",
    labels: "names",
    chips: "segment",
  },
  initials: {
    arrangement: "centre",
    mark: "circle",
    labels: "initials",
    chips: "segment",
  },
  stack: {
    arrangement: "stack",
    mark: "chip",
    labels: "names",
    chips: "segment",
  },
};

/**
 * Where a file's recipe starts before any axis of its own is read.
 *
 * `custom` starts from life mark on purpose: an author who writes
 * `mode: "custom"` and one axis gets the rest of the default look.
 */
export const DOMAIN_PICKER_CUSTOM_BASE: DomainPickerRecipe =
  DOMAIN_PICKER_PRESETS["life-mark"];

/**
 * One theme's (or one operator's) pick. A file may name a mode, a mode plus
 * some axes, or `custom` plus axes. The axes layer over the mode's preset.
 */
export type DomainPickerChoice = {
  mode: DomainPickerChoiceMode;
  /** Only the axes this choice changes. Absent is the preset's own value. */
  recipe?: Partial<DomainPickerRecipe>;
};

/** What the lens wears when no theme and no operator says otherwise. */
export const DEFAULT_DOMAIN_PICKER: DomainPickerChoice = { mode: "life-mark" };

/**
 * The variant an older theme file used for this same shape, before the lens
 * had a recipe of its own. `undefined` is the segmented default.
 */
export type LegacyDomainVariant = "segmented" | "pill" | "icons" | "list";

/**
 * The shape a variant-only file already drew.
 *
 * `pill` is life mark with round chips, because that variant never moved LIFE
 * out of the centre — it only rounded the row. The other three are the modes
 * whose pictures those variants already were.
 */
export function choiceFromLegacyVariant(
  variant?: LegacyDomainVariant | null,
): DomainPickerChoice {
  switch (variant) {
    case "pill":
      return { mode: "life-mark", recipe: { chips: "pill" } };
    case "icons":
      return { mode: "initials" };
    case "list":
      return { mode: "stack" };
    default:
      return { mode: "life-mark" };
  }
}

/** Human words for the mode, shared by the Studio, the rigs and the docs. */
export const DOMAIN_PICKER_MODE_LABELS: Readonly<
  Record<DomainPickerChoiceMode, string>
> = {
  "life-mark": "Life mark",
  "named-strip": "Named strip",
  initials: "Initials",
  stack: "Stack",
  custom: "Custom",
};

export const DOMAIN_PICKER_MODE_BLURBS: Readonly<
  Record<DomainPickerChoiceMode, string>
> = {
  "life-mark":
    "A round LIFE button in the centre, with the area names on either side.",
  "named-strip":
    "LIFE leads one row of chips, the same shape as the areas. No circle.",
  initials:
    "The centred LIFE circle, and each area as its letter — the strip stays short.",
  stack:
    "LIFE on top and the areas as rows under it. The shape the rail's column is built for.",
  custom: "Your own combination of the four axes below.",
};

export const DOMAIN_PICKER_AXIS_LABELS: Readonly<
  Record<keyof DomainPickerRecipe, Record<string, string>>
> = {
  arrangement: { centre: "Centre", leading: "Leading", stack: "Stack" },
  mark: { circle: "Circle", chip: "Chip" },
  labels: { names: "Names", initials: "Initials" },
  chips: { segment: "Segment", pill: "Pill" },
};

/**
 * The recipe a choice actually draws.
 *
 * A preset, then the choice's own axes over it. Written once here so the
 * renderer, the Studio's preview and a rig's expectation can never disagree
 * about what `life-mark` + `{ chips: "pill" }` means.
 */
export function resolveDomainPicker(
  choice?: Partial<DomainPickerChoice> | null,
): DomainPickerRecipe {
  const mode = choice?.mode ?? DEFAULT_DOMAIN_PICKER.mode;
  const base =
    mode === "custom"
      ? DOMAIN_PICKER_CUSTOM_BASE
      : (DOMAIN_PICKER_PRESETS[mode as DomainPickerMode] ??
        DOMAIN_PICKER_CUSTOM_BASE);
  return { ...base, ...(choice?.recipe ?? {}) };
}

/**
 * Layer one choice's axes over another's.
 *
 * The theme proposes; the operator's own pick may agree about the mode and
 * still change one axis. Deep-merging the recipe is the whole reason this is
 * not a spread.
 */
export function layerDomainPicker(
  theme?: Partial<DomainPickerChoice> | null,
  override?: Partial<DomainPickerChoice> | null,
): DomainPickerChoice {
  const mode = override?.mode ?? theme?.mode ?? DEFAULT_DOMAIN_PICKER.mode;
  const recipe = { ...(theme?.recipe ?? {}), ...(override?.recipe ?? {}) };
  return Object.keys(recipe).length > 0 ? { mode, recipe } : { mode };
}

/**
 * Accumulate one operator pick onto what the override already holds.
 *
 * Deliberately *not* `layerDomainPicker`: that one resolves, and resolving
 * needs a mode. This one merges a patch log, so the mode is written only when
 * the operator actually chose one. A bare axis must not pin the lens to life
 * mark and overrule a theme that named another mode.
 */
export function mergeDomainPickerOverride(
  current?: Partial<DomainPickerChoice> | null,
  patch?: Partial<DomainPickerChoice> | null,
): Partial<DomainPickerChoice> {
  const recipe = { ...(current?.recipe ?? {}), ...(patch?.recipe ?? {}) };
  const mode = patch?.mode ?? current?.mode;
  const merged: Partial<DomainPickerChoice> = {};
  if (mode !== undefined) merged.mode = mode;
  if (Object.keys(recipe).length > 0) merged.recipe = recipe;
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate one closed-enum axis and name the field when it is not a member. */
function readAxis<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): { ok: true; value: T } | { ok: false; error: string } {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return { ok: false, error: `${path} must be one of ${allowed.join(", ")}` };
  }
  return { ok: true, value: value as T };
}

/**
 * Read `chrome.domainPicker` (or an operator override of it) into a choice.
 *
 * Refusals name the exact field. `path` is the caller's prefix:
 * `chrome.domainPicker` in a theme file, an override's own name in Settings.
 */
export function parseDomainPickerChoice(
  raw: unknown,
  path: string,
): { ok: true; value: DomainPickerChoice } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: `${path} must be an object` };
  }
  const mode = readAxis(raw.mode, DOMAIN_PICKER_CHOICES, `${path}.mode`);
  if (!mode.ok) return mode;

  const value: DomainPickerChoice = { mode: mode.value };
  const recipe = raw.recipe;
  if (recipe !== undefined) {
    if (!isRecord(recipe)) {
      return { ok: false, error: `${path}.recipe must be an object` };
    }
    const axes: Partial<DomainPickerRecipe> = {};
    if (recipe.arrangement !== undefined) {
      const arrangement = readAxis(
        recipe.arrangement,
        DOMAIN_PICKER_ARRANGEMENTS,
        `${path}.recipe.arrangement`,
      );
      if (!arrangement.ok) return arrangement;
      axes.arrangement = arrangement.value;
    }
    if (recipe.mark !== undefined) {
      const mark = readAxis(recipe.mark, DOMAIN_PICKER_MARKS, `${path}.recipe.mark`);
      if (!mark.ok) return mark;
      axes.mark = mark.value;
    }
    if (recipe.labels !== undefined) {
      const labels = readAxis(
        recipe.labels,
        DOMAIN_PICKER_LABELS,
        `${path}.recipe.labels`,
      );
      if (!labels.ok) return labels;
      axes.labels = labels.value;
    }
    if (recipe.chips !== undefined) {
      const chips = readAxis(recipe.chips, DOMAIN_PICKER_CHIPS, `${path}.recipe.chips`);
      if (!chips.ok) return chips;
      axes.chips = chips.value;
    }
    if (Object.keys(axes).length > 0) value.recipe = axes;
  }
  return { ok: true, value };
}
