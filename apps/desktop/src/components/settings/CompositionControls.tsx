import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";

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
 */
export function CompositionControls() {
  const {
    themeFile,
    composition,
    compositionOverride,
    setCompositionOverride,
    resetCompositionOverride,
  } = useTheme();
  const headingId = useId();

  if (!themeFile?.composition) return null;

  const hidden = composition === null;
  const hasOverride = compositionOverride.enabled === false;
  const count = themeFile.composition.widgets.length;
  const regions = [
    ...new Set(themeFile.composition.widgets.map((widget) => widget.region)),
  ];

  return (
    <section
      className="theme-material theme-composition"
      aria-labelledby={headingId}
      data-testid="theme-composition"
    >
      <div className="theme-material__header">
        <div className="theme-material__heading">
          <h3 className="theme-material__title" id={headingId}>
            Composition
          </h3>
          <p className="theme-material__intro">
            {count} — {count === 1 ? "widget" : "widgets"} the worn theme places
            on {regions.join(", ")}. The app draws them from a closed vocabulary;
            hide them here and <strong>Reset to theme</strong> brings them back.
          </p>
        </div>
        <Button
          variant="outline"
          className="theme-material__reset"
          data-testid="composition-reset"
          disabled={!hasOverride}
          onClick={() => resetCompositionOverride()}
        >
          <RotateCcw size={13} aria-hidden />
          Reset to theme
        </Button>
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
              data-testid="composition-toggle"
              aria-pressed={!hidden}
              onClick={() =>
                setCompositionOverride(hidden ? {} : { enabled: false })
              }
            >
              {hidden ? "Show widgets" : "Hide widgets"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
