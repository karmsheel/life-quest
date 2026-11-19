import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Blocks, FolderOpen, Pencil, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  useTheme,
  type ThemeHistoryVersion,
} from "@/components/theme/ThemeProvider";
import { StudioFields } from "@/components/theme/studio/StudioFields";
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

/**
 * A saved version is named by how long ago the snapshot was taken: "just now"
 * is the save the operator is looking at, and anything older than a week is a
 * date. The rows have no other chronology on screen, so this is the ordering
 * cue as well as the timestamp.
 */
function relativeTime(savedAt: string): string {
  const then = Date.parse(savedAt);
  if (Number.isNaN(then)) return "unknown time";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Editing = {
  file: string;
  raw: string;
  saving: boolean;
  /**
   * Which editor the file is open in. Fields is the studio (default when the
   * file parses); JSON is the raw editor that has always been here.
   */
  tab: EditorTab;
};

type EditorTab = "fields" | "json";

/**
 * The parsed theme the studio can edit, or `null` when the file does not parse
 * and only the JSON tab can open. `parseThemeFile` is the shared gate, so the
 * draft starts as exactly what the shell would wear — and carries only the
 * schema's own keys, never the raw file's.
 */
function themeOfRaw(raw: string): ThemeFile | null {
  try {
    const parsed = parseThemeFile(JSON.parse(raw));
    return parsed.ok ? parsed.theme : null;
  } catch {
    return null;
  }
}

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
    readThemeHistory,
    restoreThemeVersion,
    importTheme,
    setDraftTheme,
    draftDiscarded,
  } = useTheme();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftSource, setDraftSource] = useState<"blank" | "current">("blank");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  /** `null` while the history read is in flight; `[]` is a readable empty list. */
  const [history, setHistory] = useState<ThemeHistoryVersion[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /**
   * The studio's working theme. The page owns it and hands every change to the
   * provider's `setDraftTheme`, which paints it without writing, keeping or
   * previewing. `null` means the JSON tab — or a file that does not parse.
   */
  const [draft, setDraft] = useState<ThemeFile | null>(null);
  /** True after an external write took the draft away; the editor says why. */
  const [draftLost, setDraftLost] = useState(false);
  /**
   * True after main refused the last Save. The provider put the exact refusal
   * in `themeError`; the studio shows it under Save, where the operator acted.
   */
  const [saveRefused, setSaveRefused] = useState(false);
  const fieldsTabRef = useRef<HTMLButtonElement | null>(null);
  const jsonTabRef = useRef<HTMLButtonElement | null>(null);
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

  const editingFile = editing?.file ?? null;

  /*
   * Read the open file's saved versions. Keyed on the file name, not the editing
   * object: every keystroke rebuilds that object, and re-reading history on each
   * one would be a round-trip per character. A restore re-reads explicitly.
   */
  useEffect(() => {
    if (editingFile === null) {
      setHistory(null);
      setHistoryFailed(false);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryFailed(false);
    void readThemeHistory(editingFile).then((versions) => {
      if (cancelled) return;
      if (versions === null) {
        // The provider already put main's refusal in the error banner; the
        // section only has to stop claiming it is still loading.
        setHistory([]);
        setHistoryFailed(true);
        return;
      }
      setHistory(versions);
    });
    return () => {
      cancelled = true;
    };
  }, [editingFile, readThemeHistory]);

  /*
   * An external write abandons the draft in the provider (the bytes under the
   * editor are no longer the ones it is editing). The page cannot keep drafting
   * over them: say what happened, drop its copy, and show the landed bytes in
   * the JSON tab so the operator can look and re-enter Fields deliberately.
   */
  const discardedRef = useRef(draftDiscarded);
  useEffect(() => {
    if (draftDiscarded === discardedRef.current) return;
    discardedRef.current = draftDiscarded;
    setDraftLost(true);
    setDraft(null);
    setEditing((current) => (current ? { ...current, tab: "json" } : current));
    if (editingFile === null) return;
    let cancelled = false;
    void readThemeFile(editingFile).then((raw) => {
      if (cancelled || raw === null) return;
      setEditing((current) =>
        current && current.file === editingFile ? { ...current, raw } : current,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [draftDiscarded, editingFile, readThemeFile]);

  // Leaving the page mid-draft must not leave the shell wearing a draft no
  // editor owns any more. A save's own preview survives: ending draft mode
  // never repaints over a live preview.
  useEffect(() => () => setDraftTheme(null), [setDraftTheme]);

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
    setDraftLost(false);
    setSaveRefused(false);
    const raw = await readThemeFile(file);
    if (raw === null) return;
    // The parsed file is the draft's starting point. Opening the editor is the
    // moment a preview (if one is counting down) becomes a draft instead: the
    // provider cancels it without flashing the kept look in between.
    const parsed = themeOfRaw(raw);
    setEditing({ file, raw, saving: false, tab: parsed ? "fields" : "json" });
    setDraft(parsed);
    // `null` also ends a draft left over from a previously opened file; a file
    // that does not parse has no fields view, so the shell goes back to kept.
    setDraftTheme(parsed);
  }

  /** Close the editor, ending any draft. Cancel is a true undo of the paint. */
  function closeEditor() {
    setDraftTheme(null);
    setDraft(null);
    setDraftLost(false);
    setSaveRefused(false);
    setEditing(null);
  }

  /**
   * Fields ⇄ JSON. The draft survives the switch: going to JSON serialises the
   * draft (pretty, two spaces and a newline) so the textarea shows what the
   * shell is wearing; coming back parses the textarea, but only when it is
   * valid — an invalid raw stays on JSON where the status line names the field.
   */
  function switchTab(tab: EditorTab): boolean {
    if (!editing || editing.tab === tab) return true;
    if (tab === "json") {
      setEditing({
        ...editing,
        tab,
        raw: draft ? `${JSON.stringify(draft, null, 2)}\n` : editing.raw,
      });
      return true;
    }
    const parsed = themeOfRaw(editing.raw);
    if (!parsed) return false;
    setDraft(parsed);
    setDraftTheme(parsed);
    setEditing({ ...editing, tab: "fields" });
    return true;
  }

  const focusTab = (tab: EditorTab) =>
    (tab === "fields" ? fieldsTabRef : jsonTabRef).current?.focus();

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const target: EditorTab = editing?.tab === "fields" ? "json" : "fields";
    focusTab(switchTab(target) ? target : "json");
  };

  async function onSave() {
    if (!editing || validation === null || !validation.ok) return;
    setEditing({ ...editing, saving: true });
    const written = await writeThemeFile(editing.file, editing.raw);
    if (!written) {
      setEditing({ ...editing, saving: false });
      return;
    }
    // The write left its own preview running; ending draft mode must not
    // repaint the kept theme over it (the provider knows the difference).
    setDraftTheme(null);
    setDraft(null);
    setDraftLost(false);
    setStatus(`Saved ${editing.file}.`);
    setEditing(null);
  }

  /**
   * Save what the studio built. The draft is serialised with the schema's own
   * keys and written through the same main-side gate as the JSON editor; the
   * write then previews through the watcher, and only Save has touched disk.
   */
  async function onStudioSave() {
    if (!editing || !draft) return;
    setEditing({ ...editing, saving: true });
    setSaveRefused(false);
    const written = await writeThemeFile(
      editing.file,
      `${JSON.stringify(draft, null, 2)}\n`,
    );
    if (!written) {
      // Main's refusal is already in `themeError`; flag it so the studio shows
      // the exact sentence under Save instead of only in the page banner.
      setSaveRefused(true);
      setEditing({ ...editing, saving: false });
      return;
    }
    setDraftTheme(null);
    setDraft(null);
    setDraftLost(false);
    setStatus(`Saved ${editing.file}.`);
    setEditing(null);
  }

  /** Paint the theme the studio just built; the provider writes nothing. */
  function onDraftChange(next: ThemeFile) {
    // One edit is one fresh attempt: an old refusal must not outlive the bytes
    // it named.
    setSaveRefused(false);
    setDraft(next);
    setDraftTheme(next);
  }

  async function onImport() {
    setError(null);
    setStatus(null);
    setImporting(true);
    const imported = await importTheme();
    setImporting(false);
    // A cancelled dialog is not a status: the operator closed it on purpose.
    if (!imported) return;
    setStatus(`Imported ${imported.file}.`);
  }

  /**
   * Put one saved version back. The restore writes from main, so the open
   * editor has to be re-read too — showing history change under a textarea that
   * still holds the replaced bytes would invite saving the wrong thing. The
   * write previews through the provider like any other.
   */
  async function onRestore(id: string) {
    if (!editing) return;
    setError(null);
    setStatus(null);
    setRestoringId(id);
    const restored = await restoreThemeVersion(editing.file, id);
    if (!restored) {
      setRestoringId(null);
      return;
    }
    const raw = await readThemeFile(editing.file);
    if (raw !== null) {
      setEditing((current) =>
        current && current.file === editing.file ? { ...current, raw } : current,
      );
    }
    const versions = await readThemeHistory(editing.file);
    if (versions === null) {
      setHistory([]);
      setHistoryFailed(true);
    } else {
      setHistory(versions);
      setHistoryFailed(false);
    }
    setStatus(
      `Restored ${editing.file}. It previews for 10 seconds — keep it to make it yours.`,
    );
    setRestoringId(null);
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
            data-testid="extensions-import"
            disabled={importing}
            onClick={() => void onImport()}
          >
            <Upload size={13} aria-hidden />
            {importing ? "Importing…" : "Import from file"}
          </Button>
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
                Fields is the visual editor; JSON is the raw file. Saved files
                are re-validated in the main process, the refusal names the
                field, and a save previews through the same ten-second gate as a
                companion write.
              </p>
            </div>
            <Button
              variant="ghost"
              data-testid="extension-editor-cancel"
              onClick={closeEditor}
            >
              <X size={13} aria-hidden />
              Close
            </Button>
          </div>

          <div
            className="extensions-page__tabs"
            role="tablist"
            aria-label="Editor view"
          >
            <button
              ref={fieldsTabRef}
              type="button"
              role="tab"
              aria-selected={editing.tab === "fields"}
              tabIndex={editing.tab === "fields" ? 0 : -1}
              className={`extensions-page__tab${editing.tab === "fields" ? " is-active" : ""}`}
              data-testid="extension-editor-tab-fields"
              onClick={() => {
                if (!switchTab("fields")) focusTab("json");
              }}
              onKeyDown={onTabKeyDown}
            >
              Fields
            </button>
            <button
              ref={jsonTabRef}
              type="button"
              role="tab"
              aria-selected={editing.tab === "json"}
              tabIndex={editing.tab === "json" ? 0 : -1}
              className={`extensions-page__tab${editing.tab === "json" ? " is-active" : ""}`}
              data-testid="extension-editor-tab-json"
              onClick={() => switchTab("json")}
              onKeyDown={onTabKeyDown}
            >
              JSON
            </button>
          </div>

          {draftLost ? (
            <p
              className="form-error"
              role="alert"
              data-testid="studio-draft-discarded"
            >
              The file changed on disk — your draft was discarded. The landed
              bytes are in the JSON tab; switch back to Fields to edit them.
            </p>
          ) : null}

          {editing.tab === "fields" ? (
            <div role="tabpanel" aria-label="Fields editor">
              {draft ? (
                <StudioFields
                  draft={draft}
                  onChange={onDraftChange}
                  onSave={() => void onStudioSave()}
                  onCancel={closeEditor}
                  saving={editing.saving}
                  refusal={saveRefused ? themeError : null}
                />
              ) : (
                <p className="extensions-page__empty">
                  This file does not parse, so there is no fields view to draw.
                  Fix it in the JSON tab and switch back to Fields once it is
                  valid.
                </p>
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-label="JSON editor">
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
                className={
                  validation?.ok ? "extensions-page__valid" : "form-error"
                }
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
            </div>
          )}

          <section
            className="extensions-page__history"
            aria-label={`History of ${editing.file}`}
            data-testid="extension-history"
          >
            <h3 className="extensions-page__history-title">History</h3>
            <p className="extensions-page__history-note muted">
              Every save keeps the bytes it replaces, outside the theme list. A
              restore writes the snapshot back through the same gate, so it
              previews and is itself undoable.
            </p>
            {history === null ? (
              <p className="extensions-page__history-empty">Loading…</p>
            ) : historyFailed ? (
              <p className="extensions-page__history-empty">
                History could not be read — the error is above.
              </p>
            ) : history.length === 0 ? (
              <p
                className="extensions-page__history-empty"
                data-testid="extension-history-empty"
              >
                No saved versions yet — the first save starts history.
              </p>
            ) : (
              <ul className="extensions-page__history-list">
                {history.map((version) => (
                  <li
                    key={version.id}
                    className="extensions-page__history-row"
                    data-testid="extension-history-row"
                    data-version-id={version.id}
                    data-label={version.label}
                  >
                    <span className="extensions-page__history-time">
                      {relativeTime(version.savedAt)}
                    </span>
                    <span className="extensions-page__history-label">
                      {version.label}
                    </span>
                    <span className="extensions-page__history-bytes">
                      {version.bytes} B
                    </span>
                    <Button
                      variant="ghost"
                      data-testid="extension-history-restore"
                      aria-label={`Restore version ${version.label}, saved ${relativeTime(version.savedAt)}`}
                      disabled={restoringId !== null}
                      onClick={() => void onRestore(version.id)}
                    >
                      {restoringId === version.id ? "Restoring…" : "Restore"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
