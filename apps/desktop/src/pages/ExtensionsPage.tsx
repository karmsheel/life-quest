import { useEffect, useRef, useState } from "react";
import { Blocks, FolderOpen, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  parseThemeFile,
  resolveChrome,
  type ThemeFile,
} from "@/lib/themes/theme-file";

/**
 * Settings has the list; this page is the workshop.
 *
 * Everything the companion can write is here as a first-class object the
 * operator can select, switch on or off, edit and create without leaving the
 * app. It is still data, never code: creation and saving both pass through
 * main's own `parseThemeFile` gate (the same rules the companion's `write_theme`
 * tool uses), so a file that reaches the profile is always one the shell can
 * draw — and an edit that would not parse is refused by field name before
 * anything is written.
 *
 * "Active" is the kept file — the extension the window is actually wearing.
 * Switching it off hands the window back its default look; switching another on
 * replaces it, because a window wears exactly one theme file at a time.
 */
const FILE_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The one-line summary a card shows: what this file actually changes. */
function chipsOf(theme: ThemeFile): string[] {
  const chrome = resolveChrome(theme.chrome);
  const chips: string[] = [];
  chips.push(theme.colors ? "Palette" : "Inherits palette");
  chips.push(`wings ${chrome.wingSwitcher.place}`);
  chips.push(`domains ${chrome.domainSwitcher.place}`);
  if (theme.material) chips.push("Material");
  if (theme.scene?.background) chips.push(`sky ${theme.scene.background.preset}`);
  if (theme.composition) {
    chips.push(`composition · ${theme.composition.widgets.length} widgets`);
  }
  return chips;
}

type Validation =
  | { ok: true; label: string; widgets: number | null }
  | { ok: false; error: string };

function validate(raw: string): Validation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Not JSON: ${messageOf(error)}` };
  }
  const parsed = parseThemeFile(json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    label: parsed.theme.label,
    widgets: parsed.theme.composition?.widgets.length ?? null,
  };
}

type Editing = { file: string; raw: string; saving: boolean };

export default function ExtensionsPage() {
  const {
    themeFiles,
    keptFile,
    themePreview,
    themeError,
    applyThemeFile,
    keepThemeFile,
    clearKeptTheme,
    removeThemeFile,
    refreshThemeFiles,
    openThemesFolder,
    readThemeFile,
    writeThemeFile,
  } = useTheme();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftSource, setDraftSource] = useState<"blank" | "current">("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const refreshedOnMount = useRef(false);

  useEffect(() => {
    if (refreshedOnMount.current) return;
    refreshedOnMount.current = true;
    void refreshThemeFiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A pending "Remove?" must not outlive the file it names.
  useEffect(() => {
    if (confirmFile === null) return;
    if (!themeFiles.some((entry) => entry.file === confirmFile)) {
      setConfirmFile(null);
    }
  }, [confirmFile, themeFiles]);

  const validation = editing === null ? null : validate(editing.raw);

  async function onCreate() {
    setError(null);
    setStatus(null);
    const label = draftLabel.trim();
    if (label.length < 2) {
      setError("Give the extension a name of at least two characters.");
      return;
    }
    const base = slugOf(label);
    if (!FILE_SLUG.test(base)) {
      setError("That name does not make a usable file name — use letters or digits.");
      return;
    }
    let file = `${base}.json`;
    let suffix = 2;
    while (themeFiles.some((entry) => entry.file === file)) {
      file = `${base.slice(0, 30)}-${suffix}.json`;
      suffix += 1;
    }
    let starter: Record<string, unknown>;
    if (draftSource === "current") {
      const source = keptFile ?? themeFiles[0]?.file ?? null;
      if (!source) {
        setError("There is no file to copy yet — start blank instead.");
        return;
      }
      const raw = await readThemeFile(source);
      if (raw === null) return;
      try {
        starter = {
          ...(JSON.parse(raw) as Record<string, unknown>),
          name: base,
          label,
          description: `Created in Extensions, copied from ${source}.`,
        };
      } catch (error) {
        setError(`Could not copy ${source}: ${messageOf(error)}`);
        return;
      }
    } else {
      starter = {
        name: base,
        label,
        description: "Created in Extensions. Add colours, chrome, material, scene or widgets — nothing here can ship code.",
        material: {
          radius: "soft",
          shadow: "soft",
          typeScale: "default",
          density: "default",
          motion: "calm",
          backdrop: "plain",
        },
      };
    }
    setBusy(true);
    const written = await writeThemeFile(file, JSON.stringify(starter, null, 2));
    setBusy(false);
    if (!written) return;
    setCreating(false);
    setDraftLabel("");
    setStatus(`Created ${file}. It previews for 10 seconds — keep it to make it yours.`);
  }

  async function onEdit(file: string) {
    setError(null);
    setStatus(null);
    const raw = await readThemeFile(file);
    if (raw === null) return;
    setEditing({ file, raw, saving: false });
  }

  async function onSave() {
    if (!editing || validation === null || !validation.ok) return;
    setEditing({ ...editing, saving: true });
    const written = await writeThemeFile(editing.file, editing.raw);
    if (!written) {
      setEditing({ ...editing, saving: false });
      return;
    }
    setStatus(`Saved ${editing.file}.`);
    setEditing(null);
  }

  async function onRemove(file: string) {
    if (confirmFile !== file) {
      setConfirmFile(file);
      setStatus(null);
      return;
    }
    setConfirmFile(null);
    setStatus(null);
    await removeThemeFile(file);
  }

  const activeFile = keptFile;

  return (
    <div className="extensions-page" data-testid="extensions-page">
      <header className="extensions-page__header">
        <div>
          <h1 className="stub-page__title">Extensions</h1>
          <p className="stub-page__desc muted">
            Data files that change how LifeQuest looks and behaves. Today that is
            themes — palette, material, chrome, scene and page widgets — written
            here or by the companion. Nothing here is code: every save is
            re-validated by the main process, and a refusal names the field.
          </p>
        </div>
        <div className="extensions-page__header-actions">
          <Button
            variant="outline"
            data-testid="extensions-open-folder"
            onClick={() => void openThemesFolder()}
          >
            <FolderOpen size={13} aria-hidden />
            Open folder
          </Button>
          <Button
            variant="primary"
            data-testid="extensions-create"
            disabled={creating || busy}
            onClick={() => {
              setCreating(true);
              setError(null);
              setStatus(null);
            }}
          >
            <Plus size={14} aria-hidden />
            New extension
          </Button>
        </div>
      </header>

      <p className="extensions-page__summary muted" data-testid="extensions-count">
        {themeFiles.length} extension{themeFiles.length === 1 ? "" : "s"} ·{" "}
        {activeFile ? (
          <>
            active: <code>{activeFile}</code>
          </>
        ) : (
          "none active — the shell is wearing its default look"
        )}
        {themePreview ? (
          <>
            {" "}
            · previewing <code>{themePreview.file}</code>
          </>
        ) : null}
      </p>

      {themeError ? (
        <p className="form-error" role="alert" data-testid="extensions-error">
          {themeError}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert" data-testid="extensions-page-error">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="form-message" role="status" data-testid="extensions-status">
          {status}
        </p>
      ) : null}

      {creating ? (
        <section
          className="extensions-page__create"
          aria-label="New extension"
          data-testid="extension-create-panel"
        >
          <label className="extensions-page__field">
            <span>Name</span>
            <input
              type="text"
              value={draftLabel}
              data-testid="extension-create-label"
              placeholder="e.g. Night Runway"
              maxLength={48}
              onChange={(event) => setDraftLabel(event.target.value)}
            />
          </label>
          <fieldset className="extensions-page__source">
            <legend>Start from</legend>
            <label>
              <input
                type="radio"
                name="extension-source"
                value="blank"
                checked={draftSource === "blank"}
                data-testid="extension-create-blank"
                onChange={() => setDraftSource("blank")}
              />
              Blank — name, material baseline, nothing else
            </label>
            <label>
              <input
                type="radio"
                name="extension-source"
                value="current"
                checked={draftSource === "current"}
                data-testid="extension-create-copy"
                onChange={() => setDraftSource("current")}
              />
              Copy the active look{keptFile ? ` (${keptFile})` : ""}
            </label>
          </fieldset>
          <div className="extensions-page__create-actions">
            <Button
              variant="primary"
              data-testid="extension-create-submit"
              disabled={busy}
              onClick={() => void onCreate()}
            >
              {busy ? "Creating…" : "Create extension"}
            </Button>
            <Button
              variant="ghost"
              data-testid="extension-create-cancel"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              <X size={13} aria-hidden />
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {editing ? (
        <section
          className="extensions-page__editor"
          aria-label={`Editing ${editing.file}`}
          data-testid="extension-editor"
        >
          <div className="extensions-page__editor-header">
            <div>
              <h2 className="extensions-page__editor-title">
                <Pencil size={14} aria-hidden />
                Editing <code>{editing.file}</code>
              </h2>
              <p className="muted">
                Saved files are re-validated in the main process; the refusal
                names the field. A save previews through the same ten-second gate
                as a companion write.
              </p>
            </div>
            <Button
              variant="ghost"
              data-testid="extension-editor-cancel"
              onClick={() => setEditing(null)}
            >
              <X size={13} aria-hidden />
              Close
            </Button>
          </div>
          <textarea
            className="extensions-page__editor-raw"
            spellCheck={false}
            value={editing.raw}
            data-testid="extension-editor-raw"
            aria-label={`Raw JSON of ${editing.file}`}
            onChange={(event) =>
              setEditing({ ...editing, raw: event.target.value })
            }
          />
          <p
            className={validation?.ok ? "extensions-page__valid" : "form-error"}
            role={validation?.ok ? "status" : "alert"}
            data-testid="extension-editor-status"
          >
            {validation === null
              ? ""
              : validation.ok
                ? `Valid extension — ${validation.label}${validation.widgets === null ? "" : `, ${validation.widgets} widgets`}.`
                : validation.error}
          </p>
          <div className="extensions-page__editor-actions">
            <Button
              variant="primary"
              data-testid="extension-editor-save"
              disabled={!validation?.ok || editing.saving}
              onClick={() => void onSave()}
            >
              {editing.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </section>
      ) : null}

      {themeFiles.length === 0 ? (
        <p className="extensions-page__empty">
          No extensions yet. Create one here, or let the companion write a
          <code> .json</code> file into the profile&rsquo;s <code>themes/</code>{" "}
          folder.
        </p>
      ) : (
        <ul className="extensions-page__list">
          {themeFiles.map(({ file, theme }) => {
            const isActive = keptFile === file;
            const confirming = confirmFile === file;
            const previewing = themePreview?.file === file;
            return (
              <li
                key={file}
                className={
                  isActive
                    ? "extension-card extension-card--active"
                    : "extension-card"
                }
                data-testid={`extension-${file.replace(/\.json$/i, "")}`}
                data-active={isActive ? "true" : "false"}
              >
                <div className="extension-card__main">
                  <div className="extension-card__title">
                    <Blocks size={15} aria-hidden className="extension-card__icon" />
                    <h2 className="extension-card__label">{theme.label}</h2>
                    <code className="extension-card__file">{file}</code>
                    {previewing ? (
                      <span
                        className="extension-card__pill"
                        data-testid="extension-previewing"
                      >
                        Previewing
                      </span>
                    ) : null}
                    {isActive ? (
                      <span
                        className="extension-card__pill extension-card__pill--active"
                        data-testid="extension-active"
                      >
                        Active
                      </span>
                    ) : null}
                  </div>
                  {theme.description ? (
                    <p className="extension-card__desc">{theme.description}</p>
                  ) : null}
                  <p className="extension-card__chips">
                    {chipsOf(theme).map((chip) => (
                      <span className="extension-chip" key={chip}>
                        {chip}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="extension-card__actions">
                  <label className="extension-switch">
                    <span className="extension-switch__label">Active</span>
                    <button
                      type="button"
                      role="switch"
                      className="extension-switch__control"
                      aria-checked={isActive}
                      aria-label={`${isActive ? "Deactivate" : "Activate"} ${theme.label}`}
                      data-testid="extension-toggle"
                      onClick={() =>
                        isActive
                          ? void clearKeptTheme()
                          : keepThemeFile(file)
                      }
                    >
                      <span className="extension-switch__knob" aria-hidden />
                    </button>
                  </label>
                  <Button
                    variant="outline"
                    data-testid="extension-try"
                    aria-label={`Preview ${theme.label} — 10-second preview`}
                    onClick={() => applyThemeFile(file)}
                  >
                    Try
                  </Button>
                  <Button
                    variant="ghost"
                    data-testid="extension-edit"
                    aria-label={`Edit ${theme.label}`}
                    onClick={() => void onEdit(file)}
                  >
                    <Pencil size={13} aria-hidden />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    destructive={confirming}
                    data-testid="extension-remove"
                    aria-label={
                      confirming
                        ? `Remove? ${file} — press again to confirm`
                        : `Remove ${file}`
                    }
                    onClick={() => void onRemove(file)}
                  >
                    {confirming ? "Remove?" : "Remove"}
                  </Button>
                  {confirming ? (
                    <Button
                      variant="ghost"
                      data-testid="extension-remove-cancel"
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
    </div>
  );
}
