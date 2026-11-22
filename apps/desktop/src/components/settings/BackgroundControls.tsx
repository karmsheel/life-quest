import { useId, useState } from "react";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import {
  BACKGROUND_IMAGE_BLURS,
  BACKGROUND_IMAGE_DIMS,
  BACKGROUND_IMAGE_FITS,
  BACKGROUND_IMAGE_POSITIONS,
  DEFAULT_BACKGROUND_IMAGE,
  type BackgroundImageBlur,
  type BackgroundImageDim,
  type BackgroundImageFit,
  type BackgroundImagePosition,
  type ThemeBackgroundImage,
  type ThemeScene,
  type ThemeSceneOverride,
} from "@/lib/themes/theme-file";

/**
 * Settings → Appearance: the picture layer, the rung above the drawn scene.
 *
 * A theme file may name a picture — a file already stored in the app profile's
 * `backgrounds/` — and this section is where the operator chooses their own,
 * tunes how it fills the page, and hands it back. The picture is copied into
 * the profile, never the vault, and never a path: the shared model's file-name
 * rule is the vocabulary, the app reads the bytes and paints them.
 *
 * The rows reuse MaterialControls/SceneControls' shape — same header, same
 * `settings-card__row theme-material__row` rows, same segmented buttons — so the
 * Appearance stack reads as one family. The Picture row is the one custom row:
 * it carries a file name, two actions and a refusal line.
 *
 * Optional controlled props (D9) let the Extensions studio edit the same picks
 * as a draft theme: `value` is the resolved scene, `onChange` receives the
 * patch, and no override is written. Settings renders it with no props and keeps
 * the ids the rigs know.
 */

type PictureAxis = "fit" | "position" | "dim" | "blur";

const FIT_LABELS: Record<BackgroundImageFit, string> = {
  cover: "Cover",
  contain: "Contain",
  tile: "Tile",
};
const POSITION_LABELS: Record<BackgroundImagePosition, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
};
const DIM_LABELS: Record<BackgroundImageDim, string> = {
  none: "None",
  soft: "Soft",
  strong: "Strong",
};
const BLUR_LABELS: Record<BackgroundImageBlur, string> = {
  none: "None",
  soft: "Soft",
  deep: "Deep",
};

interface PictureAxisSpec {
  axis: PictureAxis;
  /** data-testid of the whole control (`background-fit` and so on). */
  testId: string;
  label: string;
  hint: string;
  options: readonly { value: string; label: string }[];
}

const AXES: readonly PictureAxisSpec[] = [
  {
    axis: "fit",
    testId: "background-fit",
    label: "Fit",
    hint: "Cover fills the page, Contain shows the whole picture, Tile repeats it.",
    options: BACKGROUND_IMAGE_FITS.map((value) => ({
      value,
      label: FIT_LABELS[value],
    })),
  },
  {
    axis: "position",
    testId: "background-position",
    label: "Position",
    hint: "Where the picture sits when it does not fill the page.",
    options: BACKGROUND_IMAGE_POSITIONS.map((value) => ({
      value,
      label: POSITION_LABELS[value],
    })),
  },
  {
    axis: "dim",
    testId: "background-dim",
    label: "Dim",
    hint: "A scrim over the picture, so the page keeps its contrast.",
    options: BACKGROUND_IMAGE_DIMS.map((value) => ({
      value,
      label: DIM_LABELS[value],
    })),
  },
  {
    axis: "blur",
    testId: "background-blur",
    label: "Blur",
    hint: "Softens the picture; its edges are scaled away so no band shows.",
    options: BACKGROUND_IMAGE_BLURS.map((value) => ({
      value,
      label: BLUR_LABELS[value],
    })),
  },
];

export interface BackgroundControlsProps {
  /** Controlled scene: the decoration to describe. */
  value?: ThemeScene;
  /** Controlled mode only: the patch the operator just picked. */
  onChange?: (patch: ThemeSceneOverride) => void;
  /** Prefix for every data-testid; "" leaves the Settings ids untouched. */
  testIdPrefix?: string;
}

export function BackgroundControls({
  value,
  onChange,
  testIdPrefix = "",
}: BackgroundControlsProps = {}) {
  const {
    scene,
    sceneOverride,
    setSceneOverride,
    resetBackgroundOverride,
  } = useTheme();
  const controlled = value !== undefined;
  const effectiveScene = value ?? scene;
  const picture = effectiveScene.background.image;
  const headingId = useId();
  const labelPrefix = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Test id helper: the studio prefix, or the Settings id untouched. */
  const idFor = (base: string) => (controlled ? `${testIdPrefix}${base}` : base);

  const overrideImage =
    controlled ? undefined : sceneOverride.background?.image;
  /** A picture the operator picked — as opposed to the theme's or none. */
  const pictureIsYours = overrideImage !== undefined && overrideImage !== null;
  /** Any picture pick at all, including `null` (the theme's picture hidden). */
  const hasImagePick = overrideImage !== undefined;

  const emit = (patch: ThemeSceneOverride) => {
    if (controlled) {
      onChange?.(patch);
      return;
    }
    setSceneOverride(patch);
  };

  /** Ask main for a file dialog; main copies the picture and answers its name. */
  const choose = async () => {
    const bridge = window.lifequest;
    if (!bridge?.themePickBackground || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await bridge.themePickBackground();
      if (!answer.ok) {
        setRefusal(answer.error);
        return;
      }
      // A cancelled dialog is not a refusal: it changes nothing.
      if (!answer.value) return;
      // The studio keeps the draft picture's axes while swapping its file; the
      // Settings pick is the operator's own and starts from the model defaults.
      const image: ThemeBackgroundImage = {
        file: answer.value.file,
        ...(controlled && picture
          ? {
              fit: picture.fit,
              position: picture.position,
              dim: picture.dim,
              blur: picture.blur,
            }
          : DEFAULT_BACKGROUND_IMAGE),
      };
      emit({ background: { image } });
    } catch {
      setRefusal("That picture could not be chosen.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hide the picture. `image: null` is a real override value — it hides a
   * picture the theme carries — while a whole object is emitted for an axis
   * pick, so a patch never leaves a half image.
   */
  const remove = () => {
    setRefusal(null);
    emit({ background: { image: null } });
  };

  const pickAxis = (axis: PictureAxis, option: string) => {
    if (!picture) return;
    const next = { ...picture, [axis]: option } as ThemeBackgroundImage;
    emit({ background: { image: next } });
  };

  return (
    <section
      className="theme-material theme-background"
      aria-labelledby={headingId}
      data-testid={controlled ? `${testIdPrefix}background-panel` : "theme-background"}
    >
      <div className="theme-material__header">
        <div className="theme-material__heading">
          <h3 className="theme-material__title" id={headingId}>
            Background
          </h3>
          <p className="theme-material__intro">
            {controlled ? (
              <>
                The picture the theme file names. It is stored in the app profile,
                not the vault; picks paint the draft at once and only{" "}
                <strong>Save</strong> writes them.
              </>
            ) : (
              <>
                A picture of your own, copied into this installation&rsquo;s
                profile — never the vault. It replaces the drawn sky while it is
                set, and <strong>Reset to theme</strong> hands the theme&rsquo;s
                picture (or its sky) back.
              </>
            )}
          </p>
        </div>
        {controlled ? null : (
          <Button
            variant="outline"
            className="theme-material__reset"
            data-testid="background-reset"
            disabled={!hasImagePick}
            onClick={() => resetBackgroundOverride()}
          >
            <RotateCcw size={13} aria-hidden />
            Reset to theme
          </Button>
        )}
      </div>

      <div className="theme-material__rows">
        <div
          className="settings-card__row theme-material__row"
          data-testid={idFor("background-picture")}
        >
          <div className="settings-card__copy">
            <div className="settings-card__label theme-material__label">
              <span id={`${labelPrefix}-picture`}>Picture</span>
              {pictureIsYours ? (
                <span
                  className="theme-material__yours"
                  data-testid={idFor("background-picture-yours")}
                  title="You picked this picture; it overrides the theme's"
                >
                  <span
                    className="theme-material__yours-dot"
                    aria-hidden="true"
                  />
                  yours
                </span>
              ) : null}
            </div>
            <p className="theme-material__hint">
              Choose a picture from disk. It is copied into this
              installation&rsquo;s profile, never the vault, and it replaces the
              drawn sky while it is set.
            </p>
          </div>
          <div className="settings-card__control theme-background__picture-control">
            {picture ? (
              <span
                className="theme-background__picture-name"
                data-testid={idFor("background-picture-name")}
                title={picture.file}
              >
                {picture.file}
              </span>
            ) : null}
            <Button
              variant="outline"
              data-testid={idFor("background-choose")}
              disabled={busy}
              aria-label={picture ? "Replace the background picture" : "Choose a background picture"}
              onClick={() => void choose()}
            >
              <ImagePlus size={13} aria-hidden />
              {picture ? "Replace…" : "Choose picture…"}
            </Button>
            {picture ? (
              <Button
                variant="ghost"
                destructive
                data-testid={idFor("background-remove")}
                aria-label="Remove the background picture"
                onClick={remove}
              >
                <Trash2 size={13} aria-hidden />
                Remove
              </Button>
            ) : null}
          </div>
        </div>

        {refusal ? (
          <p
            className="form-error theme-background__refusal"
            role="alert"
            data-testid={idFor("background-picture-error")}
          >
            {refusal}
          </p>
        ) : null}

        {AXES.map((spec) => {
          const effective = picture
            ? picture[spec.axis]
            : DEFAULT_BACKGROUND_IMAGE[spec.axis];
          const labelId = `${labelPrefix}-${spec.axis}`;
          return (
            <div
              key={spec.axis}
              className="settings-card__row theme-material__row"
            >
              <div className="settings-card__copy">
                <div className="settings-card__label theme-material__label">
                  <span id={labelId}>{spec.label}</span>
                </div>
                <p className="theme-material__hint">{spec.hint}</p>
              </div>
              <div
                className="ui-segmented ui-segmented--sm theme-material__control"
                role="radiogroup"
                aria-labelledby={labelId}
                aria-disabled={picture ? undefined : true}
                data-testid={idFor(spec.testId)}
              >
                {spec.options.map((option) => {
                  const active = effective === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={!picture}
                      aria-label={`${spec.label}: ${option.label}`}
                      className={`ui-segmented__option${active ? " is-active" : ""}`}
                      data-testid={idFor(
                        `background-option-${spec.axis}-${option.value}`,
                      )}
                      onClick={() => pickAxis(spec.axis, option.value)}
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
