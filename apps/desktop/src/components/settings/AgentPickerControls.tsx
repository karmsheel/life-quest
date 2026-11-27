import { useId } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  AGENT_PICKER_AXIS_LABELS,
  AGENT_PICKER_CHOICES,
  AGENT_PICKER_MODE_BLURBS,
  AGENT_PICKER_MODE_LABELS,
  resolveAgentPicker,
  type AgentPickerChoice,
  type AgentPickerChoiceMode,
  type AgentPickerRecipe,
  type ThemeChromeOverride,
} from "@/lib/themes/theme-file";

/**
 * The agent picker's recipe, as one control.
 *
 * Settings → Appearance and the Theme Studio's Components section edit the same
 * `AgentPickerChoice` through this component, with the D9 contract
 * `LayoutControls` already implements: uncontrolled it reads the worn chrome and
 * writes the operator's `chromeOverride.agentPicker`; controlled it paints the
 * draft theme passed as `value` and hands each patch to `onChange` instead. The
 * wrapper decides where that patch lands, so neither surface owns its own rows.
 *
 * The mode row names the three shipped modes — presets over the four axes — and
 * `custom`, the author's own point in the same space. A mode is *data, never
 * code*: every axis is a closed enum the renderer already knows how to draw, so
 * a theme can be wrong about the picker's look but can never ship a stylesheet,
 * a component or a script, and a broken file cannot make the dock unopenable.
 *
 * The four axis rows stay visible for a shipped mode too. A mode is a preset,
 * not a lock: `resolveAgentPicker` layers a choice's `recipe` over the preset,
 * so "named-chip with a large mark" is a legal theme file today. Hiding the
 * axes would push that state into hand-edited JSON — the one thing this editor
 * exists to avoid — so the rows show the *resolved* recipe (`resolveAgentPicker`
 * of the choice, so a preset's unset axes read as the values it draws) and an
 * axis pick writes only that axis. A shipped mode plus one change therefore
 * stays a mode plus one axis, never a flattened four-axis `custom` recipe.
 *
 * Changing the mode changes the preset the axes sit on; it does not clear the
 * axes the choice already names, again because the model layers them. The rows
 * show that result, so a leftover axis is visible rather than silent, and the
 * only mode pick that materialises a whole recipe is `custom` — the one mode
 * whose whole meaning is "these four values are mine".
 *
 * There is no Reset button here, on purpose. In Settings `resetChromeOverride`
 * drops the whole override object, including this branch, and its one button
 * already sits at the top of the Appearance section (`chrome-reset`); a second
 * button would promise a narrower scope than the provider has. In the Studio
 * there is nothing to reset to — the draft *is* the theme.
 *
 * The option buttons mirror `SegmentedControl`'s markup and classes rather than
 * calling it, for the same reason `LayoutControls` does: each option carries its
 * own `data-testid` and the mode row carries the "yours" marker.
 */

type Axis = keyof AgentPickerRecipe;

/** The axes in the order the file comment names them; words are the row labels. */
const AXES: readonly Axis[] = ["roster", "labels", "ring", "size"];

const AXIS_LABELS: Readonly<Record<Axis, string>> = {
  roster: "Roster",
  labels: "Labels",
  ring: "Ring",
  size: "Size",
};

export interface AgentPickerControlsProps {
  /** Controlled mode: the choice to render (the draft's resolved picker). */
  value?: AgentPickerChoice;
  /** Controlled mode only: one pick, for the owner to merge into its draft. */
  onChange?: (patch: ThemeChromeOverride) => void;
  /** Prefix for every data-testid; defaults to the Settings ids. */
  testIdPrefix?: string;
}

export function AgentPickerControls({
  value,
  onChange,
  testIdPrefix = "settings-",
}: AgentPickerControlsProps = {}) {
  const { chrome, chromeOverride, setChromeOverride } = useTheme();
  const controlled = value !== undefined;
  const choice = value ?? chrome.agentPicker;
  // What the picker actually draws right now: presets' axes show their drawn
  // values, so the rows annotate the result rather than an absent field.
  const recipe = resolveAgentPicker(choice);
  const headingId = useId();
  const labelPrefix = useId();
  const yours = !controlled && chromeOverride.agentPicker !== undefined;

  const pick = (patch: ThemeChromeOverride) => {
    if (controlled) {
      onChange?.(patch);
      return;
    }
    setChromeOverride(patch);
  };

  /*
   * `custom` is the one mode that is not a preset: it means "these axes are
   * mine", so its pick carries the recipe the operator is looking at. Writing
   * bare `{ mode: "custom" }` would resolve from `AGENT_PICKER_CUSTOM_BASE`
   * (one-mark) and visibly reset labels and ring the moment they left a shipped
   * mode. A shipped mode pick names only the mode, so the axes the choice
   * already has survive it — the model layers recipes, and the rows above show
   * the result.
   */
  const pickMode = (mode: AgentPickerChoiceMode) =>
    pick({ agentPicker: mode === "custom" ? { mode, recipe } : { mode } });

  const pickAxis = (axis: Axis, value: string) =>
    pick({
      agentPicker: { recipe: { [axis]: value } as Partial<AgentPickerRecipe> },
    });

  return (
    <section
      className="theme-layout"
      aria-labelledby={headingId}
      data-testid={`${testIdPrefix}agent-picker-panel`}
    >
      <div className="theme-layout__header">
        <div className="theme-layout__heading">
          <h3 className="theme-layout__title" id={headingId}>
            Agent picker
          </h3>
          <p className="theme-layout__intro">
            {controlled ? (
              <>
                The dock&rsquo;s agent picker, as the file&rsquo;s{" "}
                <code>chrome.agentPicker</code>: one of three shipped modes, or
                your own combination of four closed axes — data the renderer
                already draws, never code. The studio paints the draft, so the
                picker in the dock behind changes as you pick; that is the
                preview.
              </>
            ) : (
              <>
                A theme proposes the dock&rsquo;s agent picker — one of three
                shipped modes, or a combination of four closed axes, which is
                data, never code. A pick marked &ldquo;yours&rdquo; outranks the
                theme and survives swapping it; <strong>Reset to theme</strong>{" "}
                (Layout, above) hands it back with every other chrome pick.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="theme-layout__rows">
        <div className="settings-card__row theme-layout__row">
          <div className="settings-card__copy">
            <div className="settings-card__label theme-layout__label">
              <span id={`${labelPrefix}-mode`}>Mode</span>
              {yours ? (
                <span
                  className="theme-layout__yours"
                  data-testid={`${testIdPrefix}agent-picker-yours`}
                  title="You picked the picker's shape; it overrides the theme's"
                >
                  <span className="theme-layout__yours-dot" aria-hidden="true" />
                  yours
                </span>
              ) : null}
            </div>
          </div>
          <div
            className="ui-segmented ui-segmented--sm theme-layout__control"
            role="radiogroup"
            aria-labelledby={`${labelPrefix}-mode`}
          >
            {AGENT_PICKER_CHOICES.map((mode) => {
              const active = choice.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Mode: ${AGENT_PICKER_MODE_LABELS[mode]}`}
                  className={`ui-segmented__option${active ? " is-active" : ""}`}
                  data-testid={`${testIdPrefix}agent-picker-mode-${mode}`}
                  onClick={() => pickMode(mode)}
                >
                  {AGENT_PICKER_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>
        </div>

        {AXES.map((axis) => {
          const labelId = `${labelPrefix}-${axis}`;
          return (
            <div key={axis} className="settings-card__row theme-layout__row">
              <div className="settings-card__copy">
                <div className="settings-card__label theme-layout__label">
                  <span id={labelId}>{AXIS_LABELS[axis]}</span>
                </div>
              </div>
              <div
                className="ui-segmented ui-segmented--sm theme-layout__control"
                role="radiogroup"
                aria-labelledby={labelId}
              >
                {Object.entries(AGENT_PICKER_AXIS_LABELS[axis]).map(
                  ([axisValue, axisLabel]) => {
                    const active = recipe[axis] === axisValue;
                    return (
                      <button
                        key={axisValue}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`${AXIS_LABELS[axis]}: ${axisLabel}`}
                        className={`ui-segmented__option${active ? " is-active" : ""}`}
                        data-testid={`${testIdPrefix}agent-picker-${axis}-${axisValue}`}
                        onClick={() => pickAxis(axis, axisValue)}
                      >
                        {axisLabel}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="theme-layout__note">
        {AGENT_PICKER_MODE_BLURBS[choice.mode]}{" "}
        {controlled
          ? "Picks paint the draft at once; only Save writes the file."
          : "A picker that outranks the theme is marked “yours” until Reset to theme."}
      </p>
    </section>
  );
}
