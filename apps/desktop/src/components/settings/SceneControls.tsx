import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import {
  SCENE_BACKDROPS,
  SCENE_CANVAS_FRAMES,
  SCENE_CARD_FRAMES,
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
 * Optional controlled props (D9) let the Extensions studio edit the same four
 * picks as a draft theme: `value` is the resolved scene, `onChange` receives the
 * patch, and no override is written. Settings renders it with no props and keeps
 * today's behaviour and ids.
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
  horizon: "Horizon",
  mesh: "Mesh",
};
const INTENSITY_LABELS: Record<ThemeScene["background"]["intensity"], string> = {
  calm: "Calm",
  default: "Default",
  lively: "Lively",
};
const CANVAS_FRAME_LABELS: Record<ThemeScene["frames"]["canvas"], string> = {
  none: "None",
  hairline: "Hairline",
  double: "Double",
  halo: "Halo",
};
const CARD_FRAME_LABELS: Record<ThemeScene["frames"]["cards"], string> = {
  theme: "Theme",
  outline: "Outline",
  raised: "Raised",
};

export interface SceneControlsProps {
  /** Controlled scene: the resolved decoration to render. */
  value?: ThemeScene;
  /** Controlled mode only: the group/axis the operator just picked. */
  onChange?: (patch: ThemeSceneOverride) => void;
  /** Prefix for every data-testid; "" leaves the Settings ids untouched. */
  testIdPrefix?: string;
}

type Group = keyof ThemeScene;
type AxisValue =
  | ThemeScene["background"]["preset"]
  | ThemeScene["background"]["intensity"]
  | ThemeScene["frames"][keyof ThemeScene["frames"]];

interface SceneAxis {
  group: Group;
  axis: string;
  testId: string;
  label: string;
  options: readonly { value: AxisValue; label: string }[];
  hint: string;
}

const AXES: readonly SceneAxis[] = [
  {
    group: "background",
    axis: "preset",
    testId: "scene-background",
    label: "Sky",
    hint: "Drawn by the app from a closed vocabulary: six procedural skies. A picture of your own lives in the Background section below.",
    options: SCENE_BACKDROPS.map((value) => ({
      value,
      label: PRESET_LABELS[value],
    })),
  },
  {
    group: "background",
    axis: "intensity",
    testId: "scene-intensity",
    label: "Intensity",
    hint: "How much motion the scene spends; reduced-motion turns it off entirely.",
    options: SCENE_INTENSITIES.map((value) => ({
      value,
      label: INTENSITY_LABELS[value],
    })),
  },
  {
    group: "frames",
    axis: "canvas",
    testId: "scene-canvas-frame",
    label: "Page frame",
    hint: "A decorative edge inside the page canvas; it never eats a control's space.",
    options: SCENE_CANVAS_FRAMES.map((value) => ({
      value,
      label: CANVAS_FRAME_LABELS[value],
    })),
  },
  {
    group: "frames",
    axis: "cards",
    testId: "scene-card-frame",
    label: "Card frame",
    hint: "How the page's cards are drawn: as the theme's own, outlined, or lifted.",
    options: SCENE_CARD_FRAMES.map((value) => ({
      value,
      label: CARD_FRAME_LABELS[value],
    })),
  },
];

export function SceneControls({
  value,
  onChange,
  testIdPrefix = "",
}: SceneControlsProps = {}) {
  const { scene, sceneOverride, setSceneOverride, resetSceneOverride } =
    useTheme();
  const controlled = value !== undefined;
  const effectiveScene = value ?? scene;
  const headingId = useId();
  const labelPrefix = useId();
  const hasOverrides = !controlled && Object.keys(sceneOverride).length > 0;

  const pick = (patch: ThemeSceneOverride) => {
    if (controlled) {
      onChange?.(patch);
      return;
    }
    setSceneOverride(patch);
  };

  return (
    <section
      className="theme-material theme-scene"
      aria-labelledby={headingId}
      data-testid={controlled ? `${testIdPrefix}scene-panel` : "theme-scene"}
    >
      <div className="theme-material__header">
        <div className="theme-material__heading">
          <h3 className="theme-material__title" id={headingId}>
            Scene
          </h3>
          <p className="theme-material__intro">
            {controlled ? (
              <>
                The decoration the theme file names. Picks paint the draft at
                once and only <strong>Save</strong> writes them; reduced-motion
                still turns the motion off in the shell.
              </>
            ) : (
              <>
                The decoration behind the page. A theme picks one of the bundled
                skies and how lively it runs; your pick outranks it, and{" "}
                <strong>Reset to theme</strong> hands it back.
              </>
            )}
          </p>
        </div>
        {controlled ? null : (
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
        )}
      </div>

      <div className="theme-material__rows">
        {AXES.map((spec) => {
          const group = effectiveScene[spec.group] as Record<string, AxisValue>;
          const effective = group[spec.axis];
          const overridden =
            !controlled &&
            spec.axis in
              ((sceneOverride[spec.group] ?? {}) as Record<string, unknown>);
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
                data-testid={
                  controlled ? `${testIdPrefix}${spec.testId}` : spec.testId
                }
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
                      data-testid={
                        controlled
                          ? `${testIdPrefix}scene-option-${spec.axis}-${option.value}`
                          : `scene-option-${spec.axis}-${option.value}`
                      }
                      onClick={() =>
                        pick({
                          [spec.group]: { [spec.axis]: option.value },
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
