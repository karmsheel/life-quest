import { useEffect, useId, useRef, useState } from "react";
import { Check, Download, FolderOpen } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import { resolveChrome } from "@/lib/themes/theme-file";

/**
 * Settings → Appearance: the theme files sitting in the app profile's `themes/`
 * folder.
 *
 * This is the operator's side of the v2 preview gate. The companion (or the
 * operator, by hand) drops a JSON file in the profile; the provider wears it for
 * ten seconds and then hands the window back unless it is kept. This list is
 * where a file already seen can be tried again, kept deliberately, or removed —
 * so every row names the file it acts on, and removal asks twice.
 *
 * The directory itself is never edited here: removal asks main to delete the
 * file, and the provider re-reads the directory afterwards. Nothing on this page
 * writes a theme file; the companion's tools own writing, Export owns saving a
 * copy, and Open folder hands the operator the OS file manager.
 */
export function ThemeFiles() {
  const {
    themeFiles,
    keptFile,
    applyThemeFile,
    keepThemeFile,
    removeThemeFile,
    refreshThemeFiles,
    openThemesFolder,
    exportCurrentTheme,
    themeError,
  } = useTheme();

  const headingId = useId();
  /** Which row is one press away from its file being deleted. */
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  /** The last thing an action here did, if it is worth a sentence. */
  const [status, setStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /** Guards the one-shot read below against StrictMode's double-invoked effect. */
  const refreshedOnMount = useRef(false);

  /*
   * Read the directory when this page opens. The provider already reads it at
   * startup and on `onThemesChanged`, so this one call exists for the operator
   * who dropped a file in while Settings was closed: opening Appearance should
   * show it without a restart.
   */
  useEffect(() => {
    if (refreshedOnMount.current) return;
    refreshedOnMount.current = true;
    void refreshThemeFiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * A pending confirm must not outlive the file it named. If a refresh (or the
   * operator's own removal elsewhere) takes the row away, the next press of a
   * "Remove?" in this list would otherwise be the confirming press for a file
   * the operator never saw change. Clearing it is the safe side.
   */
  useEffect(() => {
    if (confirmFile === null) return;
    if (!themeFiles.some((entry) => entry.file === confirmFile)) {
      setConfirmFile(null);
    }
  }, [confirmFile, themeFiles]);

  async function onOpenFolder() {
    setStatus(null);
    try {
      await openThemesFolder();
    } catch {
      setStatus("Could not open the themes folder.");
    }
  }

  async function onExport() {
    setStatus(null);
    setExporting(true);
    try {
      const saved = await exportCurrentTheme();
      /*
       * `null` is the operator cancelling the save dialog — not an error and not
       * a save. Show nothing: the button returning to its normal state is the
       * whole answer.
       */
      if (saved) setStatus(`Saved ${saved.path}`);
    } catch {
      setStatus("Could not export the current theme.");
    } finally {
      setExporting(false);
    }
  }

  /** First press arms the row, second press deletes; Cancel (or another row) disarms. */
  async function onRemove(file: string) {
    if (confirmFile !== file) {
      setStatus(null);
      setConfirmFile(file);
      return;
    }
    setConfirmFile(null);
    setStatus(null);
    try {
      await removeThemeFile(file);
    } catch {
      // The provider reports the failed delete through `themeError`; this keeps
      // the press from vanishing if the call itself rejects.
      setStatus(`Could not remove ${file}.`);
    }
  }

  return (
    <section
      className="theme-files"
      aria-labelledby={headingId}
      data-testid="theme-files"
    >
      <div className="theme-files__header">
        <div className="theme-files__heading">
          <h3 className="theme-files__title" id={headingId}>
            Theme files
          </h3>
          <p className="theme-files__intro">
            Theme files are JSON files in the app profile&rsquo;s{" "}
            <code>themes/</code> folder — written by the companion or by hand. A
            new or changed file previews for 10 seconds unless you keep it.
          </p>
        </div>
        <div className="theme-files__actions">
          <Button
            variant="outline"
            className="theme-files__action"
            data-testid="theme-open-folder"
            onClick={() => void onOpenFolder()}
          >
            <FolderOpen size={13} aria-hidden />
            Open folder
          </Button>
          <Button
            variant="outline"
            className="theme-files__action"
            data-testid="theme-export-current"
            disabled={exporting}
            onClick={() => void onExport()}
          >
            <Download size={13} aria-hidden />
            {exporting ? "Exporting…" : "Export current theme"}
          </Button>
        </div>
      </div>

      {themeError ? (
        <p
          className="form-error theme-files__message"
          role="alert"
          data-testid="theme-file-error"
        >
          {themeError}
        </p>
      ) : null}
      {status ? (
        <p
          className="form-message theme-files__message"
          role="status"
          data-testid="theme-file-status"
        >
          {status}
        </p>
      ) : null}

      {themeFiles.length === 0 ? (
        <p className="theme-files__empty">
          No theme files yet. Drop a <code>.json</code> file in that folder — the
          companion can write one too — and it appears here, previewing for 10
          seconds unless you keep it.
        </p>
      ) : (
        <ul className="theme-files__list">
          {themeFiles.map(({ file, theme }) => {
            const chrome = resolveChrome(theme.chrome);
            const isKept = file === keptFile;
            const confirming = file === confirmFile;
            return (
              <li
                key={file}
                className="theme-files__row"
                data-testid={`theme-file-row-${file.replace(/\.json$/i, "")}`}
              >
                <div className="theme-files__copy">
                  <div className="theme-files__name">
                    <span className="theme-files__label">{theme.label}</span>
                    <span className="theme-files__file">{file}</span>
                  </div>
                  {theme.description ? (
                    <p className="theme-files__desc">{theme.description}</p>
                  ) : null}
                  <p className="theme-files__chrome">
                    wings <code>{chrome.wingSwitcher.place}</code> · domains{" "}
                    <code>{chrome.domainSwitcher.place}</code>
                  </p>
                </div>
                <div className="theme-files__row-actions">
                  <Button
                    variant="outline"
                    className="theme-files__row-button"
                    data-testid="theme-file-try"
                    aria-label={`Try ${theme.label} — 10-second preview`}
                    onClick={() => applyThemeFile(file)}
                  >
                    Try
                  </Button>
                  {isKept ? (
                    <span
                      className="theme-files__kept"
                      data-testid="theme-file-kept"
                    >
                      <Check size={12} aria-hidden />
                      Kept
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      className="theme-files__row-button"
                      data-testid="theme-file-keep"
                      aria-label={`Keep ${theme.label}`}
                      onClick={() => keepThemeFile(file)}
                    >
                      Keep
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="theme-files__row-button"
                    data-testid="theme-file-remove"
                    destructive={confirming}
                    aria-label={
                      confirming
                        ? `Remove? ${file} — press again to confirm`
                        : `Remove ${file}`
                    }
                    title={
                      confirming
                        ? `Press again to delete ${file} from the profile`
                        : `Remove ${file} from the profile`
                    }
                    onClick={() => void onRemove(file)}
                  >
                    {confirming ? "Remove?" : "Remove"}
                  </Button>
                  {confirming ? (
                    <Button
                      variant="ghost"
                      className="theme-files__row-button"
                      data-testid="theme-file-remove-cancel"
                      aria-label={`Cancel removing ${file}`}
                      onClick={() => setConfirmFile(null)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
