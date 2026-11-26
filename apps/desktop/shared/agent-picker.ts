/**
 * The agent picker, as data.
 *
 * The chat dock has one control whose only job is "who answers next". That
 * control is small enough to look like a detail, but it is a *component the
 * operator is allowed to disagree with*: a dense two-badge strip is right for
 * someone who switches agents ten times an hour and wrong for someone who has
 * picked one agent and wants the composer quiet. So the picker's shape is not
 * hard-coded; it is a **recipe** — four closed axes — and the app ships three
 * *named modes* that are presets over those axes:
 *
 *   one-mark     menu + no label + accent ring      the default, quietest
 *   named-chip   menu + the agent's name + accent   explicit about who answers
 *   quiet-stack  inline roster + no label + hairline  both marks, no capsule
 *
 * A theme may name any of those, or `custom` and set the axes itself. That is
 * what "creating your own mechanism" means here, and it is deliberate that the
 * vocabulary is closed: a mode is a combination of values the renderer already
 * knows how to draw. Nothing in a theme can ship code, a stylesheet, or a
 * component name — the same rule the rest of the theme file follows (see
 * `theme-file.ts`), so a broken third-party theme can never make the dock
 * unopenable, the CSP has to stay narrow for exactly one renderer, and the
 * modes validate by name instead of by executing something.
 *
 * Why the axes are these four:
 *
 *  - `roster`  whether the agents are laid out in the open (inline) or folded
 *              into one trigger that opens a menu. This is the one axis that
 *              changes behaviour, not just pixels: a menu costs a second click.
 *  - `labels`  how much of the agent is named. `none` is a mark; `agent` names
 *              the answering one; `all` names every row of an inline roster.
 *  - `ring`    how the active choice is marked: the accent (brand) ring, or a
 *              hairline that defers to the composer's own accent outline.
 *  - `size`    the mark's optical size, for docks that run dense or airy.
 *
 * The renderer (`AgentSwitcher.tsx`) reads only the resolved recipe and sets
 * `data-*` attributes; the stylesheet owns the pixels. That split is what lets
 * a rigs test assert the *choice* without asserting a layout, and what keeps a
 * new mode a data change plus one CSS block rather than another component.
 *
 * This module is in `shared/` because three callers need the same rules: the
 * renderer that draws the picker, main's theme parser (which must refuse a bad
 * mode by field name), and the E2E rigs. It touches neither the vault nor the
 * DOM.
 */

/** The modes the app ships. Their order is the order the Studio offers. */
export const AGENT_PICKER_MODES = ["one-mark", "named-chip", "quiet-stack"] as const;
export type AgentPickerMode = (typeof AGENT_PICKER_MODES)[number];

/**
 * What a theme may name: a shipped mode, or `custom` — the author's own
 * combination of the four axes. `custom` still resolves to a recipe; it is not
 * an escape hatch out of the vocabulary.
 */
export const AGENT_PICKER_CHOICES = [...AGENT_PICKER_MODES, "custom"] as const;
export type AgentPickerChoiceMode = (typeof AGENT_PICKER_CHOICES)[number];

export const AGENT_PICKER_ROSTERS = ["menu", "inline"] as const;
export type AgentPickerRoster = (typeof AGENT_PICKER_ROSTERS)[number];

export const AGENT_PICKER_LABELS = ["none", "agent", "all"] as const;
export type AgentPickerLabels = (typeof AGENT_PICKER_LABELS)[number];

export const AGENT_PICKER_RINGS = ["accent", "hairline"] as const;
export type AgentPickerRing = (typeof AGENT_PICKER_RINGS)[number];

export const AGENT_PICKER_SIZES = ["compact", "default", "large"] as const;
export type AgentPickerSize = (typeof AGENT_PICKER_SIZES)[number];

/** The four axes, fully resolved. Every mode is one point in this space. */
export type AgentPickerRecipe = {
  roster: AgentPickerRoster;
  labels: AgentPickerLabels;
  ring: AgentPickerRing;
  size: AgentPickerSize;
};

/**
 * The modes, spelled out.
 *
 * Each preset is the *reason* the mode exists, so the values are commented
 * rather than left to the reader: `one-mark` is quiet because the roster is in
 * the menu; `named-chip` costs a word; `quiet-stack` keeps both marks in sight
 * but drops the capsule so the composer's own outline is the only frame.
 */
export const AGENT_PICKER_PRESETS: Readonly<
  Record<AgentPickerMode, AgentPickerRecipe>
> = {
  "one-mark": {
    roster: "menu",
    labels: "none",
    ring: "accent",
    size: "default",
  },
  "named-chip": {
    roster: "menu",
    labels: "agent",
    ring: "accent",
    size: "default",
  },
  "quiet-stack": {
    roster: "inline",
    labels: "none",
    ring: "hairline",
    size: "default",
  },
};

/**
 * Where a file's recipe starts before any axis of its own is read.
 *
 * `custom` starts from the default mode's recipe on purpose: an author who
 * writes `mode: "custom"` and one axis gets the rest of the default look, not
 * an undefined state the renderer would have to guess at.
 */
export const AGENT_PICKER_CUSTOM_BASE: AgentPickerRecipe =
  AGENT_PICKER_PRESETS["one-mark"];

/**
 * One theme's (or one operator's) pick. A file may name a mode, a mode plus
 * some axes, or `custom` plus axes. The axes layer over the mode's preset, so
 * "named-chip but large" is expressible without inventing a fourth mode.
 */
export type AgentPickerChoice = {
  mode: AgentPickerChoiceMode;
  /** Only the axes this choice changes. Absent is the preset's own value. */
  recipe?: Partial<AgentPickerRecipe>;
};

/** What the shell wears when no theme and no operator says otherwise. */
export const DEFAULT_AGENT_PICKER: AgentPickerChoice = { mode: "one-mark" };

/** Human words for the mode, shared by the Studio, the rigs and the docs. */
export const AGENT_PICKER_MODE_LABELS: Readonly<
  Record<AgentPickerChoiceMode, string>
> = {
  "one-mark": "One mark",
  "named-chip": "Named chip",
  "quiet-stack": "Quiet stack",
  custom: "Custom",
};

export const AGENT_PICKER_MODE_BLURBS: Readonly<
  Record<AgentPickerChoiceMode, string>
> = {
  "one-mark":
    "Only the answering agent's mark, in the composer's gutter. The roster opens from a menu.",
  "named-chip":
    "The same trigger, with the agent's name beside it — the picker says who answers.",
  "quiet-stack":
    "Both marks inline, no capsule: one hairline each, the active one marked. One click to switch.",
  custom: "Your own combination of the four axes below.",
};

export const AGENT_PICKER_AXIS_LABELS: Readonly<
  Record<keyof AgentPickerRecipe, Record<string, string>>
> = {
  roster: { menu: "Menu", inline: "Inline" },
  labels: { none: "None", agent: "Agent", all: "All" },
  ring: { accent: "Accent", hairline: "Hairline" },
  size: { compact: "Compact", default: "Default", large: "Large" },
};

/**
 * The recipe a choice actually draws.
 *
 * A preset, then the choice's own axes over it. Written once here so the
 * renderer, the Studio's preview and a rig's expectation can never disagree
 * about what `named-chip` + `{ size: "large" }` means.
 */
export function resolveAgentPicker(
  choice?: Partial<AgentPickerChoice> | null,
): AgentPickerRecipe {
  const mode = choice?.mode ?? DEFAULT_AGENT_PICKER.mode;
  const base =
    mode === "custom"
      ? AGENT_PICKER_CUSTOM_BASE
      : (AGENT_PICKER_PRESETS[mode as AgentPickerMode] ?? AGENT_PICKER_CUSTOM_BASE);
  return { ...base, ...(choice?.recipe ?? {}) };
}

/**
 * Layer one choice's axes over another's.
 *
 * The theme proposes; the operator's own chrome pick may agree with it about
 * the mode and still change one axis. Deep-merging the recipe is the whole
 * reason this is not a spread: a shallow merge would drop the theme's axes the
 * moment the operator touched a different one.
 */
export function layerAgentPicker(
  theme?: Partial<AgentPickerChoice> | null,
  override?: Partial<AgentPickerChoice> | null,
): AgentPickerChoice {
  const mode = override?.mode ?? theme?.mode ?? DEFAULT_AGENT_PICKER.mode;
  const recipe = { ...(theme?.recipe ?? {}), ...(override?.recipe ?? {}) };
  return Object.keys(recipe).length > 0 ? { mode, recipe } : { mode };
}

/**
 * Accumulate one operator pick onto what the override already holds.
 *
 * Deliberately *not* `layerAgentPicker`: that one resolves, and resolving needs
 * a mode. This one merges a patch log, so the mode is written only when the
 * operator actually chose one. If a bare axis pick materialised a mode, an
 * override stored against a theme wearing `named-chip` would pin the whole
 * picker to `one-mark` the moment they touched Size — the operator's one axis
 * would silently overrule the theme's choice, which is the opposite of what
 * "outrank the theme" means. Resolution happens once, later, in `layerChrome`,
 * where the theme's mode is still visible if the override never named one.
 */
export function mergeAgentPickerOverride(
  current?: Partial<AgentPickerChoice> | null,
  patch?: Partial<AgentPickerChoice> | null,
): Partial<AgentPickerChoice> {
  const recipe = { ...(current?.recipe ?? {}), ...(patch?.recipe ?? {}) };
  const mode = patch?.mode ?? current?.mode;
  const merged: Partial<AgentPickerChoice> = {};
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
 * Read `chrome.agentPicker` (or an operator override of it) into a choice.
 *
 * Refusals name the exact field, the way the rest of `theme-file.ts` does, so a
 * typo is a named error in the editor rather than a dock that silently wears
 * something else. `path` is the caller's prefix: `chrome.agentPicker` in a theme
 * file, an override's own name in Settings.
 */
export function parseAgentPickerChoice(
  raw: unknown,
  path: string,
): { ok: true; value: AgentPickerChoice } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: `${path} must be an object` };
  }
  const mode = readAxis(raw.mode, AGENT_PICKER_CHOICES, `${path}.mode`);
  if (!mode.ok) return mode;

  const value: AgentPickerChoice = { mode: mode.value };
  const recipe = raw.recipe;
  if (recipe !== undefined) {
    if (!isRecord(recipe)) {
      return { ok: false, error: `${path}.recipe must be an object` };
    }
    const axes: Partial<AgentPickerRecipe> = {};
    if (recipe.roster !== undefined) {
      const roster = readAxis(recipe.roster, AGENT_PICKER_ROSTERS, `${path}.recipe.roster`);
      if (!roster.ok) return roster;
      axes.roster = roster.value;
    }
    if (recipe.labels !== undefined) {
      const labels = readAxis(recipe.labels, AGENT_PICKER_LABELS, `${path}.recipe.labels`);
      if (!labels.ok) return labels;
      axes.labels = labels.value;
    }
    if (recipe.ring !== undefined) {
      const ring = readAxis(recipe.ring, AGENT_PICKER_RINGS, `${path}.recipe.ring`);
      if (!ring.ok) return ring;
      axes.ring = ring.value;
    }
    if (recipe.size !== undefined) {
      const size = readAxis(recipe.size, AGENT_PICKER_SIZES, `${path}.recipe.size`);
      if (!size.ok) return size;
      axes.size = size.value;
    }
    if (Object.keys(axes).length > 0) value.recipe = axes;
  }
  return { ok: true, value };
}
