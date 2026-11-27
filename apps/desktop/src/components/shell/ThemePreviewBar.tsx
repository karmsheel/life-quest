import { useTheme } from "@/components/theme/ThemeProvider";

/**
 * The bar that asks before a theme stays.
 *
 * The companion writes a theme file, the window wears it at once, and this bar
 * is the whole consent gate: ten seconds to look, Keep to make it the theme, or
 * Revert (or wait) to hand the window back. Nothing here touches the vault —
 * a theme is presentation, and the worst case is a shell that looks wrong for
 * ten seconds.
 */
export function ThemePreviewBar() {
  const { themePreview, themeError, keepThemePreview, revertThemePreview } =
    useTheme();

  if (themePreview) {
    return (
      <div
        className="theme-preview-bar"
        data-testid="theme-preview-bar"
        role="status"
      >
        <span className="theme-preview-bar__text">
          Trying <strong>{themePreview.label}</strong> from{" "}
          <code>{themePreview.file}</code>. Reverts in 10s.
        </span>
        <button
          type="button"
          className="theme-preview-bar__button theme-preview-bar__button--keep"
          data-testid="theme-keep"
          onClick={keepThemePreview}
        >
          Keep theme
        </button>
        <button
          type="button"
          className="theme-preview-bar__button"
          data-testid="theme-revert"
          onClick={revertThemePreview}
        >
          Revert
        </button>
      </div>
    );
  }

  if (themeError) {
    return (
      <div
        className="theme-preview-bar theme-preview-bar--error"
        data-testid="theme-error"
        role="alert"
      >
        <span className="theme-preview-bar__text">
          Theme refused: {themeError}
        </span>
        <button
          type="button"
          className="theme-preview-bar__button"
          data-testid="theme-dismiss"
          onClick={revertThemePreview}
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
