import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import type {
  CompositionOverride,
  ThemeComposition,
} from "@/lib/themes/theme-file";

/**
 * Settings → Appearance: the composition layer, the rung above scene.
 *
 * A theme may place a few widgets — a count, a bar — on the page's masthead,
 * its foot, or the rail. These controls are the operator's one disagreement:
 * hide them without editing the file. The pick is layered over the theme,
 * marked "yours", persisted per window, and **Reset to theme** hands the
 * composition back.
 *
 * The section only appears for a worn (or previewed) theme that carries a
 * composition: a theme with no widgets has nothing here to disagree with.
 *
 * Optional controlled props (D9) let the Extensions studio drive the same
 * toggle against a draft: pass `composition` (the widgets being described) and
 * `value` (the operator's pick) plus `onChange`. With no props this is exactly
 * the override-bound Settings component it has always been.
 */
export interface CompositionControlsProps {
  /** Controlled: the composition to describe. `undefined` means use the window's. */
  composition?: ThemeComposition | null;
  /** Controlled: the operator's pick; `enabled: false` is the only value. */
  value?: CompositionOverride;
  onChange?: (next: CompositionOverride) => void;
  /** Prefix for every data-testid; "" leaves the Settings ids untouched. */
  testIdPrefix?: string;
}

export function CompositionControls({
  composition: controlledComposition,
  value,
  onChange,
  testIdPrefix = "",
}: CompositionControlsProps = {}) {
  const theme = useTheme();
  const headingId = useId();
  const controlled = controlledComposition !== undefined;

  const themeComposition = theme.themeFile?.composition ?? null;
  const composition = controlled ? controlledComposition : themeComposition;
  const override = controlled ? (value ?? {}) : theme.compositionOverride;

  // A theme with no widgets has nothing to hide; the section stays out of the
  // stack in either mode.
  if (!composition) return null;

  const hidden = controlled
    ? override.enabled === false
    : theme.composition === null;
  const hasOverride = !controlled && override.enabled === false;
  const count = composition.widgets.length;
  const regions = [...new Set(composition.widgets.map((widget) => widget.region))];

  const toggle = () => {
    if (controlled) {
      onChange?.(hidden ? {} : { enabled: false });
      return;
    }
    theme.setCompositionOverride(hidden ? {} : { enabled: false });
  };

  return (
    <section
      className="theme-material theme-composition"
      aria-labelledby={headingId}
      data-testid={
        controlled ? `${testIdPrefix}composition-panel` : "theme-composition"
      }
    >
      <div className="theme-material__header">
        <div className="theme-material__heading">
          <h3 className="theme-material__title" id={headingId}>
            Composition
          </h3>
          <p className="theme-material__intro">
            {count} — {count === 1 ? "widget" : "widgets"} the theme places on{" "}
            {regions.join(", ")}. The app draws them from a closed vocabulary;
            hide them here and <strong>Reset to theme</strong> brings them back.
          </p>
        </div>
        {controlled ? null : (
          <Button
            variant="outline"
            className="theme-material__reset"
            data-testid="composition-reset"
            disabled={!hasOverride}
            onClick={() => theme.resetCompositionOverride()}
          >
            <RotateCcw size={13} aria-hidden />
            Reset to theme
          </Button>
        )}
      </div>

      <div className="theme-material__rows">
        <div className="settings-card__row theme-material__row">
          <div className="settings-card__copy">
            <div className="settings-card__label theme-material__label">
              <span>Theme widgets</span>
              {hasOverride ? (
                <span
                  className="theme-material__yours"
                  data-testid="composition-yours"
                  title="You hid these; the theme still carries them"
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
              Hiding is an operator pick, not a theme edit: the file keeps its
              widgets and Reset hands them back.
            </p>
          </div>
          <div className="theme-material__control">
            <Button
              variant={hidden ? "outline" : "primary"}
              data-testid={
                controlled
                  ? `${testIdPrefix}composition-toggle`
                  : "composition-toggle"
              }
              aria-pressed={!hidden}
              onClick={toggle}
            >
              {hidden ? "Show widgets" : "Hide widgets"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
