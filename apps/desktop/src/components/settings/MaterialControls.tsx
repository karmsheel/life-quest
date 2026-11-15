import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import {
  BACKDROPS,
  DENSITIES,
  MOTIONS,
  RADII,
  SHADOWS,
  TYPE_SCALES,
  type ThemeMaterial,
} from "@/lib/themes/theme-file";

/**
 * Settings → Appearance: the material layer, the first rung above colour.
 *
 * A theme file proposes named steps on six axes — radius, elevation, type
 * scale, density, motion and backdrop — and this section is where the operator
 * can disagree with it. Every pick is layered over the theme (`materialOverride`
 * in the provider), marked "yours" so a themed window and an operator-tuned one
 * are told apart at a glance, and persisted per window. Reset hands every axis
 * back to the theme the window is wearing, including a preview it has not kept.
 *
 * The option buttons mirror the shared `SegmentedControl` primitive's markup and
 * classes rather than calling it: every option needs its own `data-testid` and
 * the label line carries the override marker, neither of which the primitive
 * exposes.
 */

type Axis = keyof ThemeMaterial;
type AxisValue = ThemeMaterial[Axis];

interface MaterialAxis {
  axis: Axis;
  /** data-testid of the whole control (`material-radius` and so on). */
  testId: string;
  label: string;
  options: readonly { value: AxisValue; label: string }[];
}

/*
 * The enum arrays are the themes' own vocabulary, imported from the shared
 * model so the words on this page are the words a theme file may use. The label
 * records are keyed by the enum, so a value added to the model is a type error
 * here until it is named.
 */
const RADIUS_LABELS: Record<ThemeMaterial["radius"], string> = {
  sharp: "Sharp",
  soft: "Soft",
  round: "Round",
};
const SHADOW_LABELS: Record<ThemeMaterial["shadow"], string> = {
  flat: "Flat",
  soft: "Soft",
  deep: "Deep",
};
const TYPE_SCALE_LABELS: Record<ThemeMaterial["typeScale"], string> = {
  compact: "Compact",
  default: "Default",
  airy: "Airy",
};
const DENSITY_LABELS: Record<ThemeMaterial["density"], string> = {
  compact: "Compact",
  default: "Default",
  airy: "Airy",
};
const MOTION_LABELS: Record<ThemeMaterial["motion"], string> = {
  none: "None",
  calm: "Calm",
  lively: "Lively",
};
const BACKDROP_LABELS: Record<ThemeMaterial["backdrop"], string> = {
  plain: "Plain",
  wash: "Wash",
  grid: "Grid",
};

const AXES = [
  {
    axis: "radius",
    testId: "material-radius",
    label: "Radius",
    options: RADII.map((value) => ({ value, label: RADIUS_LABELS[value] })),
  },
  {
    axis: "shadow",
    testId: "material-shadow",
    label: "Elevation",
    options: SHADOWS.map((value) => ({ value, label: SHADOW_LABELS[value] })),
  },
  {
    axis: "typeScale",
    testId: "material-type-scale",
    label: "Type scale",
    options: TYPE_SCALES.map((value) => ({
      value,
      label: TYPE_SCALE_LABELS[value],
    })),
  },
  {
    axis: "density",
    testId: "material-density",
    label: "Density",
    options: DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value] })),
  },
  {
    axis: "motion",
    testId: "material-motion",
    label: "Motion",
    options: MOTIONS.map((value) => ({ value, label: MOTION_LABELS[value] })),
  },
  {
    axis: "backdrop",
    testId: "material-backdrop",
    label: "Backdrop",
    options: BACKDROPS.map((value) => ({
      value,
      label: BACKDROP_LABELS[value],
    })),
  },
] satisfies readonly MaterialAxis[];

export function MaterialControls() {
  const {
    material,
    materialOverride,
    setMaterialOverride,
    resetMaterialOverride,
  } = useTheme();
  const headingId = useId();
  const labelPrefix = useId();
  const hasOverrides = Object.keys(materialOverride).length > 0;

  return (
    <section
      className="theme-material"
      aria-labelledby={headingId}
      data-testid="theme-material"
    >
      <div className="theme-material__header">
        <div className="theme-material__heading">
          <h3 className="theme-material__title" id={headingId}>
            Material
          </h3>
          <p className="theme-material__intro">
            A theme picks these named steps, and you can override any of them. A
            pick marked &ldquo;yours&rdquo; outranks the theme and survives
            swapping it; <strong>Reset to theme</strong> hands every axis back.
          </p>
        </div>
        <Button
          variant="outline"
          className="theme-material__reset"
          data-testid="material-reset"
          disabled={!hasOverrides}
          onClick={() => resetMaterialOverride()}
        >
          <RotateCcw size={13} aria-hidden />
          Reset to theme
        </Button>
      </div>

      <div className="theme-material__rows">
        {AXES.map((spec) => {
          const effective: AxisValue = material[spec.axis];
          const overridden = spec.axis in materialOverride;
          const labelId = `${labelPrefix}-${spec.axis}`;
          return (
            <div
              key={spec.axis}
              className="settings-card__row theme-material__row"
            >
              <div className="settings-card__copy">
                <div className="settings-card__label theme-material__label">
                  <span id={labelId}>{spec.label}</span>
                  {overridden ? (
                    <span
                      className="theme-material__yours"
                      data-testid={`${spec.testId}-yours`}
                      title="You picked this step; it overrides the theme's"
                    >
                      <span
                        className="theme-material__yours-dot"
                        aria-hidden="true"
                      />
                      yours
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                className="ui-segmented ui-segmented--sm theme-material__control"
                role="radiogroup"
                aria-labelledby={labelId}
                data-testid={spec.testId}
              >
                {spec.options.map((option) => {
                  const active = effective === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`${spec.label}: ${option.label}`}
                      className={`ui-segmented__option${active ? " is-active" : ""}`}
                      data-testid={`material-option-${spec.axis}-${option.value}`}
                      onClick={() =>
                        setMaterialOverride({
                          [spec.axis]: option.value,
                        } as Partial<ThemeMaterial>)
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
