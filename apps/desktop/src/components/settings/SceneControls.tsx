import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import {
  SCENE_BACKDROPS,
  SCENE_INTENSITIES,
  type ThemeScene,
  type ThemeSceneOverride,
} from "@/lib/themes/theme-file";

/**
 * Settings → Appearance: the scene layer, the decoration rung.
 *
 * A theme names one of the bundled procedural backgrounds and how lively it
 * runs. These controls are the operator's disagreement: pick another sky or
 * quiet the one the theme chose, without touching the file. Picks are layered
 * over the theme, marked "yours", and persisted per window; Reset hands the
 * scene back to the theme.
 *
 * The classes are the material section's — the two sections are one stack of
 * rows and sharing the stylesheet is what keeps them the same shape — but the
 * ids and testids are this section's own.
 */
const PRESET_LABELS: Record<ThemeScene["background"]["preset"], string> = {
  plain: "Plain",
  starfield: "Starfield",
  orbit: "Orbit",
  aurora: "Aurora",
};
const INTENSITY_LABELS: Record<ThemeScene["background"]["intensity"], string> = {
  calm: "Calm",
  default: "Default",
  lively: "Lively",
};

type Axis = keyof ThemeScene["background"];
type AxisValue = ThemeScene["background"][Axis];

interface SceneAxis {
  axis: Axis;
  testId: string;
  label: string;
  options: readonly { value: AxisValue; label: string }[];
  hint: string;
}

const AXES: readonly SceneAxis[] = [
  {
    axis: "preset",
    testId: "scene-background",
    label: "Background",
    hint: "Drawn by the app from a closed vocabulary — never an image or a stylesheet.",
    options: SCENE_BACKDROPS.map((value) => ({
      value,
      label: PRESET_LABELS[value],
    })),
  },
  {
    axis: "intensity",
    testId: "scene-intensity",
    label: "Intensity",
    hint: "How much motion the scene spends; reduced-motion turns it off entirely.",
    options: SCENE_INTENSITIES.map((value) => ({
      value,
      label: INTENSITY_LABELS[value],
    })),
  },
];

export function SceneControls() {
  const { scene, sceneOverride, setSceneOverride, resetSceneOverride } =
    useTheme();
  const headingId = useId();
  const labelPrefix = useId();
  const hasOverrides = Object.keys(sceneOverride).length > 0;

  return (
    <section
      className="theme-material theme-scene"
      aria-labelledby={headingId}
      data-testid="theme-scene"
    >
      <div className="theme-material__header">
        <div className="theme-material__heading">
          <h3 className="theme-material__title" id={headingId}>
            Scene
          </h3>
          <p className="theme-material__intro">
            The decoration behind the page. A theme picks one of the bundled
            skies and how lively it runs; your pick outranks it, and{" "}
            <strong>Reset to theme</strong> hands it back.
          </p>
        </div>
        <Button
          variant="outline"
          className="theme-material__reset"
          data-testid="scene-reset"
          disabled={!hasOverrides}
          onClick={() => resetSceneOverride()}
        >
          <RotateCcw size={13} aria-hidden />
          Reset to theme
        </Button>
      </div>

      <div className="theme-material__rows">
        {AXES.map((spec) => {
          const effective = scene.background[spec.axis];
          const overridden = spec.axis in (sceneOverride.background ?? {});
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
                      title="You picked this; it overrides the theme's"
                    >
                      <span
                        className="theme-material__yours-dot"
                        aria-hidden="true"
                      />
                      yours
                    </span>
                  ) : null}
                </div>
                <p className="theme-material__hint">{spec.hint}</p>
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
                      data-testid={`scene-option-${spec.axis}-${option.value}`}
                      onClick={() =>
                        setSceneOverride({
                          background: {
                            [spec.axis]: option.value,
                          },
                        } as ThemeSceneOverride)
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
