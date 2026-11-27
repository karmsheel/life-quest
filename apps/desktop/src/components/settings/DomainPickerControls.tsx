import { useId } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  DOMAIN_PICKER_AXIS_LABELS,
  DOMAIN_PICKER_CHOICES,
  DOMAIN_PICKER_MODE_BLURBS,
  DOMAIN_PICKER_MODE_LABELS,
  resolveDomainPicker,
  type DomainPickerChoice,
  type DomainPickerChoiceMode,
  type DomainPickerRecipe,
  type ThemeChromeOverride,
} from "@/lib/themes/theme-file";

/**
 * The area lens's recipe, as one control.
 *
 * Settings → Appearance and the Theme Studio's Components section edit the same
 * `DomainPickerChoice` through this component. Uncontrolled, it reads the worn
 * chrome and writes the operator's `chromeOverride.domainPicker`. Controlled,
 * it paints the draft theme passed as `value` and hands each patch to
 * `onChange`. The wrapper decides where that patch lands.
 *
 * The mode row names the four shipped modes — presets over the four axes — and
 * `custom`. A mode is data, never code: every axis is a closed enum the
 * renderer already knows how to draw.
 *
 * The axis rows stay visible for a shipped mode too. A mode is a preset, not a
 * lock, so the rows show the resolved recipe and an axis pick writes only that
 * axis. `custom` is the one pick that materialises the whole recipe, so leaving
 * a shipped mode does not snap the axes back to life mark.
 *
 * There is no Reset button here. In Settings the Layout section's one Reset
 * drops the whole override, this branch included.
 */

type Axis = keyof DomainPickerRecipe;

/** The axes in the order the file comment names them. */
const AXES: readonly Axis[] = ["arrangement", "mark", "labels", "chips"];

const AXIS_LABELS: Readonly<Record<Axis, string>> = {
  arrangement: "Arrangement",
  mark: "Mark",
  labels: "Labels",
  chips: "Chips",
};

export interface DomainPickerControlsProps {
  /** Controlled mode: the choice to render (the draft's resolved picker). */
  value?: DomainPickerChoice;
  /** Controlled mode only: one pick, for the owner to merge into its draft. */
  onChange?: (patch: ThemeChromeOverride) => void;
  /** Prefix for every data-testid; defaults to the Settings ids. */
  testIdPrefix?: string;
}

export function DomainPickerControls({
  value,
  onChange,
  testIdPrefix = "settings-",
}: DomainPickerControlsProps = {}) {
  const { chrome, chromeOverride, setChromeOverride } = useTheme();
  const controlled = value !== undefined;
  const choice = value ?? chrome.domainPicker;
  const recipe = resolveDomainPicker(choice);
  const headingId = useId();
  const labelPrefix = useId();
  const yours = !controlled && chromeOverride.domainPicker !== undefined;

  const pick = (patch: ThemeChromeOverride) => {
    if (controlled) {
      onChange?.(patch);
      return;
    }
    setChromeOverride(patch);
  };

  /*
   * `custom` carries the recipe on screen, so choosing it does not jump back
   * to life mark's axes. A shipped mode names only the mode, and any axis the
   * choice already has stays layered on the new preset.
   */
  const pickMode = (mode: DomainPickerChoiceMode) =>
    pick({ domainPicker: mode === "custom" ? { mode, recipe } : { mode } });

  const pickAxis = (axis: Axis, axisValue: string) =>
    pick({
      domainPicker: { recipe: { [axis]: axisValue } as Partial<DomainPickerRecipe> },
    });

  return (
    <section
      className="theme-layout"
      aria-labelledby={headingId}
      data-testid={`${testIdPrefix}domain-picker-panel`}
    >
      <div className="theme-layout__header">
        <div className="theme-layout__heading">
          <h3 className="theme-layout__title" id={headingId}>
            Area lens
          </h3>
          <p className="theme-layout__intro">
            {controlled ? (
              <>
                The area lens, as the file&rsquo;s <code>chrome.domainPicker</code>:
                one of four shipped modes, or your own combination of four closed
                axes — data the renderer already draws, never code. The studio
                paints the draft, so the lens changes as you pick; that is the
                preview. Where the lens sits stays in Chrome.
              </>
            ) : (
              <>
                A theme proposes the area lens&rsquo;s shape — one of four shipped
                modes, or a combination of four closed axes, which is data, never
                code. A pick marked &ldquo;yours&rdquo; outranks the theme and
                survives swapping it; <strong>Reset to theme</strong> (Layout,
                above) hands it back with every other chrome pick. Where the lens
                sits stays in Layout.
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
                  data-testid={`${testIdPrefix}domain-picker-yours`}
                  title="You picked the lens's shape; it overrides the theme's"
                >
                  <span className="theme-layout__yours-dot" aria-hidden="true" />
                  yours
                </span>
              ) : null}
            </div>
          </div>
          <div
            className="ui-segmented ui-segmented--sm theme-layout__control theme-layout__control--wrap"
            role="radiogroup"
            aria-labelledby={`${labelPrefix}-mode`}
          >
            {DOMAIN_PICKER_CHOICES.map((mode) => {
              const active = choice.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Mode: ${DOMAIN_PICKER_MODE_LABELS[mode]}`}
                  className={`ui-segmented__option${active ? " is-active" : ""}`}
                  data-testid={`${testIdPrefix}domain-picker-mode-${mode}`}
                  onClick={() => pickMode(mode)}
                >
                  {DOMAIN_PICKER_MODE_LABELS[mode]}
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
                {Object.entries(DOMAIN_PICKER_AXIS_LABELS[axis]).map(
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
                        data-testid={`${testIdPrefix}domain-picker-${axis}-${axisValue}`}
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
        {DOMAIN_PICKER_MODE_BLURBS[choice.mode]}{" "}
        {controlled
          ? "Picks paint the draft at once; only Save writes the file."
          : "A lens that outranks the theme is marked “yours” until Reset to theme."}
      </p>
    </section>
  );
}
