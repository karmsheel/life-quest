import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  Project,
  SignalCreateInput,
  SignalFileAttachment,
  SignalPriority,
  SignalRecord,
  SignalStatus,
  SignalUpdatePatch,
} from "@lifequest/vault-core/pure";
import {
  ArrowUp,
  Download,
  FileText,
  Link2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import {
  SIGNAL_PRIORITIES,
  SIGNAL_STATUSES,
  unlockedAreas,
} from "@lifequest/vault-core/pure";
import {
  looksLikeImage,
  prepareImageFile,
} from "@/components/images/image-files";
import { api } from "@/lib/ipc";
import {
  SIGNAL_PRIORITY_LABELS,
  SIGNAL_STATUS_LABELS,
  formatSignalFileSize,
  formatSignalWhen,
  linkHost,
  parseLink,
  projectDisplayLabel,
  signalPriorityLabel,
  signalRowDomainLabel,
  signalStatusLabel,
  signalVisible,
  taskForSignal,
  taskFromSignal,
} from "@/lib/signal-chain";
import { useVault } from "@/state/VaultProvider";
import { useSignalImageUrls } from "./useSignalImageUrls";

/** The largest picture the vault will take, repeated here for a fast refusal. */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Quick-fire capture, shared with the dock's chain composer: Enter logs,
 * Shift+Enter breaks the line, and a composing keystroke (IME) or a held-down
 * repeat never submits on its own.
 */
export function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (e.repeat) return;
  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}

/** A picture chosen but not yet logged; its preview URL lives until it is. */
type PendingImage = {
  file: File;
  name: string;
  previewUrl: string;
};

/** Any other file chosen but not yet logged; the bytes are read on Log. */
type PendingFile = {
  file: File;
  name: string;
  size: number;
};

/**
 * Notebox is the general capture surface: a thought, a picture, any file, or a
 * link — all in one box. The words are the body, and an attachment is what the
 * words may be short about. A capture with an attachment may have no body; a
 * plain text capture still needs words.
 *
 * The composer follows the chat composer's pattern: one plus control at the
 * bottom left takes any file, and a link is attached by pasting a URL into the
 * field rather than by a form of its own. Only one attachment rides a capture.
 */
export function SignalChainFeed() {
  const { snapshot, refresh } = useVault();
  const lens = useDomainLens();
  // A capture or a row is assigned to an area; the base container and locked
  // areas are never offered.
  const liveDomains = unlockedAreas(snapshot?.domains ?? []);
  const allDomains = (snapshot?.domains ?? []).map((d) => ({
    slug: d.slug,
    name: d.meta.name,
  }));
  /**
   * What a capture files under: the area lens at the top, never a second choice
   * in the box. Filing somewhere else is the switcher's job, so the box cannot
   * disagree with the page the operator is looking at. The Life lens is the
   * general area, so a capture there is unassigned and reads "Life (general)".
   */
  const captureArea =
    lens.kind === "domain"
      ? (liveDomains.find((d) => d.slug === lens.slug) ?? null)
      : null;
  const captureAreaName = captureArea?.meta.name ?? "Life (general)";

  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [skipped, setSkipped] = useState(0);
  /** The live project register, read once; a row names and offers its project. */
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  /**
   * The triage filters above the list: status and project. The area is not one
   * of them — the domain picker at the top is the one area filter for Notebox.
   */
  const [statusFilter, setStatusFilter] = useState<SignalStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string | "all">("all");
  /** The row's delete asks in the app's own dialog, not the platform's. */
  const { ask, dialog } = useConfirm();

  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  /** The preview URL as it stands, so an unmount can revoke the last one. */
  const pendingImageRef = useRef<PendingImage | null>(null);
  pendingImageRef.current = pendingImage;

  // The list is the chain narrowed twice: by the area lens at the top, which is
  // the one area filter, and by the status and project filters below it. The
  // two combine rather than replace, so an area tab shows that area's inbox in
  // whatever triage cut the operator picked.
  const visible = useMemo(
    () =>
      records.filter((r) => {
        if (!signalVisible(lens, r.domainSlug)) return false;
        if (statusFilter !== "all" && (r.status ?? "inbox") !== statusFilter) {
          return false;
        }
        if (projectFilter !== "all" && r.projectId !== projectFilter) {
          return false;
        }
        return true;
      }),
    [records, lens, statusFilter, projectFilter],
  );
  const imagePaths = useMemo(
    () =>
      records
        .map((r) =>
          r.attachment?.kind === "image" ? r.attachment.relPath : null,
        )
        .filter((path): path is string => path !== null),
    [records],
  );
  const { urls: imageUrls, missing: missingImages } =
    useSignalImageUrls(imagePaths);

  useEffect(() => {
    return () => {
      if (pendingImageRef.current) {
        URL.revokeObjectURL(pendingImageRef.current.previewUrl);
      }
    };
  }, []);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const result = await api().signalChainList();
      if (!result.ok) {
        setError(result.error);
        setRecords([]);
        setSkipped(0);
        return;
      }
      setRecords(result.value.records);
      setSkipped(result.value.skipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chain");
      setRecords([]);
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The inbox files a capture against a live project, so the page reads the
  // project register once. A vault that cannot answer still triages by status
  // and area: the project cell falls back to the id the record stores.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api().projectsList();
        if (!cancelled) setProjects(result.ok ? result.value.records : []);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function clearPendingImage() {
    if (pendingImageRef.current) {
      URL.revokeObjectURL(pendingImageRef.current.previewUrl);
      pendingImageRef.current = null;
    }
    setPendingImage(null);
  }

  function clearPendingFile() {
    setPendingFile(null);
  }

  function clearLink() {
    setLink(null);
  }

  /**
   * One attachment per capture: whatever arrives replaces what was waiting, and
   * the preview URL the old picture held is released rather than leaked.
   */
  function attachImage(file: File) {
    if (file.size > IMAGE_MAX_BYTES) {
      setError("That image is larger than 8 MB.");
      return;
    }
    setError(null);
    setPendingFile(null);
    setLink(null);
    if (pendingImageRef.current) {
      URL.revokeObjectURL(pendingImageRef.current.previewUrl);
    }
    const next: PendingImage = {
      file,
      name: file.name || "Image",
      previewUrl: URL.createObjectURL(file),
    };
    pendingImageRef.current = next;
    setPendingImage(next);
  }

  /**
   * The single plus control takes any file. A picture keeps its preview; every
   * other file becomes a name-and-size chip, and the vault decides on Log
   * whether the type may be kept.
   */
  function attachAnyFile(file: File) {
    if (looksLikeImage(file)) {
      attachImage(file);
      return;
    }
    setError(null);
    clearPendingImage();
    setLink(null);
    setPendingFile({
      file,
      name: file.name || "File",
      size: file.size,
    });
  }

  /** A pasted URL is a link capture — it never enters the body as text. */
  function attachLink(url: string) {
    setError(null);
    clearPendingImage();
    setPendingFile(null);
    setLink(url);
  }

  function onPickFiles(files: FileList | null) {
    const file = files ? files[0] : undefined;
    if (file) attachAnyFile(file);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    // A file on the clipboard is the paste: a screenshot or a copied document
    // rides the capture rather than being dropped.
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      attachAnyFile(files[0]);
      return;
    }
    // A URL pasted on its own becomes the link chip; a URL inside a sentence is
    // just text and pastes normally.
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const parsed = parseLink(text);
    if ("url" in parsed) {
      e.preventDefault();
      attachLink(parsed.url);
    }
  }

  // ── dropping any file on the composer ────────────────────────────────────
  function onDragEnter(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLFormElement>) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(e: DragEvent<HTMLFormElement>) {
    const files = Array.from(e.dataTransfer?.files ?? []);
    dragDepth.current = 0;
    setDragging(false);
    if (files.length === 0) return;
    // A file dropped on the window must never become a navigation, whatever it
    // is: the composer owns the gesture and takes anything.
    e.preventDefault();
    attachAnyFile(files[0]);
  }

  function clearComposer() {
    clearPendingImage();
    setPendingFile(null);
    setLink(null);
    setBody("");
    setEditingId(null);
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const hasAttachment =
      pendingImage !== null || pendingFile !== null || link !== null;
    if ((!body.trim() && !hasAttachment) || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let attachment: SignalCreateInput["attachment"] = null;
      if (pendingImage) {
        const prepared = await prepareImageFile(pendingImage.file);
        attachment = {
          kind: "image",
          bytes: prepared.bytes,
          name: prepared.name,
          width: prepared.width,
          height: prepared.height,
        };
      } else if (pendingFile) {
        // Any other file is handed over as bytes; the type is a claim from the
        // picker, and the vault sanitises and refuses active content itself.
        attachment = {
          kind: "file",
          bytes: new Uint8Array(await pendingFile.file.arrayBuffer()),
          name: pendingFile.name,
          mime: pendingFile.file.type || "",
        };
      } else if (link) {
        attachment = { kind: "link", url: link };
      }
      const result = await api().signalChainCreate({
        type: "thought",
        title: null,
        body,
        domainSlug: captureArea?.slug ?? null,
        attachment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      clearComposer();
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add signal");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onSave(id: string, patch: SignalUpdatePatch) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update signal");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /**
   * Triage writes one field and then re-reads the chain quietly: the row's
   * state and every filter chip downstream are the vault's answer, not an
   * optimistic echo. Status is always one of the five strings; "No project" is
   * an empty option in the DOM and must be sent as null, never "".
   */
  async function onTriage(id: string, patch: SignalUpdatePatch) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update signal");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onAssign(id: string, nextDomain: string | null) {
    const current = records.find((r) => r.id === id)?.domainSlug ?? null;
    if (current === nextDomain) return;
    await onTriage(id, { domainSlug: nextDomain });
  }

  /**
   * Delete asks first. The write is a soft one — the record keeps its `deletedAt`
   * stamp and stays in the vault — so the question says that rather than claiming
   * the write is final.
   */
  function onDelete(id: string) {
    ask({
      title: "Delete signal",
      message: "The signal is hidden from the chain. Its record and messages stay in the vault.",
      confirmLabel: "Delete signal",
      destructive: true,
      run: () => void runDelete(id),
    });
  }

  async function runDelete(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainDelete(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (editingId === id) setEditingId(null);
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete signal");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onMakeTask(signal: SignalRecord) {
    if (busyRef.current) return;
    const existing = taskForSignal(snapshot?.map?.tasks ?? [], signal.id);
    if (existing) return;
    const derived = taskFromSignal(signal);
    if (!derived.title) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().mapApply({
        type: "createTask",
        title: derived.title,
        notes: derived.notes,
        column: "backlog",
        // A capture filed to a project hands that link to the task too, so the
        // project page reaches the same work from both ends.
        links: {
          signalId: signal.id,
          ...(signal.projectId ? { projectId: signal.projectId } : {}),
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
      // A task exists, so the capture has become work: it stands Acting on the
      // inbox. A refused status write must not hide the task that did land, so
      // it is reported and the list is re-read either way.
      const statusResult = await api().signalChainUpdate(signal.id, {
        status: "acting",
      });
      if (!statusResult.ok) setError(statusResult.error);
      await load({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to make task");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const composerHasSomething =
    body.trim().length > 0 ||
    pendingImage !== null ||
    pendingFile !== null ||
    link !== null;

  return (
    <div className="signal-chain">
      <header className="signal-chain__header">
        <h1 className="stub-page__title">Notebox</h1>
        <p className="stub-page__desc muted">
          A database of what you notice. Log now; assign later.
        </p>
      </header>

      <form
        className={`signal-chain__composer${dragging ? " signal-chain__composer--dragging" : ""}`}
        data-testid="chain-composer"
        onSubmit={onAdd}
        aria-label="Capture a signal"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
        }}
        onDrop={onDrop}
      >
        {pendingImage ? (
          <div className="signal-chain__attachment" data-testid="chain-pending-image-wrap">
            <img
              className="signal-chain__attachment-image"
              data-testid="chain-pending-image"
              src={pendingImage.previewUrl}
              alt={pendingImage.name}
              draggable={false}
            />
            <div className="signal-chain__attachment-meta">
              <span className="signal-chain__attachment-name">
                {pendingImage.name}
              </span>
              <span className="signal-chain__attachment-hint muted">
                It will be kept in the vault with this capture.
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="signal-chain__attachment-remove"
              aria-label="Remove the attached image"
              title="Remove the attached image"
              onClick={clearPendingImage}
              disabled={busy}
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
        ) : null}

        {pendingFile ? (
          <div
            className="signal-chain__pending-file"
            data-testid="chain-pending-file"
          >
            <span className="signal-chain__pending-file-icon" aria-hidden>
              <FileText size={15} />
            </span>
            <span className="signal-chain__pending-file-name">
              {pendingFile.name}
            </span>
            <span className="signal-chain__pending-file-size muted">
              {formatSignalFileSize(pendingFile.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="signal-chain__attachment-remove"
              aria-label="Remove the attached file"
              title="Remove the attached file"
              onClick={clearPendingFile}
              disabled={busy}
            >
              <X size={14} aria-hidden />
            </Button>
          </div>
        ) : null}

        <textarea
          aria-label="Log a signal"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onComposerKeyDown}
          onPaste={onPaste}
          placeholder="What's on your mind?"
          rows={3}
          autoFocus
        />

        {link ? (
          <div className="signal-chain__link-chip" data-testid="chain-link-chip">
            <Link2 size={14} aria-hidden />
            <span className="signal-chain__link-host">
              {linkHost(link) || link}
            </span>
            <span className="signal-chain__link-url muted">{link}</span>
            <Button
              type="button"
              variant="ghost"
              className="signal-chain__attachment-remove"
              aria-label="Remove the attached link"
              title="Remove the attached link"
              onClick={clearLink}
              disabled={busy}
            >
              <X size={14} aria-hidden />
            </Button>
          </div>
        ) : null}

        {/* The composer's one control row: what a capture can carry on the
            leading edge, where it files and the commit on the trailing one.
            The commit is the page's primary action and wears the app's
            primary button, so it reads as the point of the box rather than a
            caption beside it. */}
        <div className="signal-chain__composer-footer">
          <div className="signal-chain__composer-tools">
            {/* The one attachment control, at the row's leading edge: a plus
                that takes any file — a picture keeps its preview, anything
                else becomes a chip — and a link arrives by pasting a URL. */}
            <Button
              type="button"
              variant="ghost"
              className="signal-chain__attach-plus"
              data-testid="chain-attach-file"
              aria-label="Attach a file"
              title="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Plus size={16} aria-hidden />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              data-testid="chain-file-input"
              onChange={(e) => {
                onPickFiles(e.target.files);
                // Clear the picker so choosing the same file twice still fires.
                e.target.value = "";
              }}
            />
          </div>
          <div className="signal-chain__composer-commit">
            {/* The capture's area, following the lens at the top rather than a
                picker of its own. A readout, not a select: filing elsewhere is
                the switcher's job, so there is no second place to disagree. */}
            <span
              className="signal-chain__area"
              data-testid="chain-area-readout"
              data-area-slug={captureArea?.slug ?? ""}
              title="A capture files under the area picked at the top. Switch areas there to file somewhere else."
            >
              <span className="signal-chain__area-label">Area</span>
              <span
                className="signal-chain__area-value"
                data-testid="chain-area-value"
              >
                {captureAreaName}
              </span>
            </span>
            <Button
              type="submit"
              variant="primary"
              className="signal-chain__log"
              disabled={busy || !composerHasSomething}
            >
              <ArrowUp size={15} aria-hidden />
              <span>Log</span>
            </Button>
          </div>
        </div>
      </form>

      {skipped > 0 ? (
        <p className="form-error" role="status">
          {skipped} signal file(s) could not be read.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {snapshot?.mapError ? (
        <p className="form-error" role="alert">
          {snapshot.mapError}
        </p>
      ) : null}

      {/* The box and the filters are separate jobs: space and a hairline keep
          the capture surface from reading as the first filter. */}
      <hr
        className="signal-chain__rule"
        role="separator"
        aria-orientation="horizontal"
        data-testid="chain-rule"
      />

      {/* The triage band above the list, on one line. The area is not a
          filter here: the domain picker at the top is Notebox's one area
          filter, so the band names it in a readout and offers the two cuts
          that are the page's own — status and project. Selects rather than
          rows of chips keep the band from pushing the chain down the page,
          and each picker's own value is the filter it applies. The area
          readout sits at the right end, the last thing the row says. */}
      <div
        className="signal-chain__filters"
        role="group"
        aria-label="Filter the inbox"
      >
        <label className="signal-chain__filter">
          <span className="signal-chain__filter-label">Status</span>
          <select
            className="signal-chain__filter-select"
            aria-label="Filter by status"
            data-testid="signal-filter-status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as SignalStatus | "all")
            }
          >
            <option value="all">All</option>
            {SIGNAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SIGNAL_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="signal-chain__filter">
          <span className="signal-chain__filter-label">Project</span>
          <select
            className="signal-chain__filter-select"
            aria-label="Filter by project"
            data-testid="signal-filter-project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">All</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <span
          className="signal-chain__filter signal-chain__filter--area"
          data-testid="signal-filter-domain-readout"
          data-area-slug={captureArea?.slug ?? ""}
          title="The domain picker at the top is Notebox's area filter."
        >
          <span className="signal-chain__filter-label">Area</span>
          <span className="signal-chain__filter-value">
            {captureAreaName}
          </span>
        </span>
      </div>

      {loading ? (
        <p className="muted">Loading chain…</p>
      ) : records.length === 0 ? (
        <p className="muted signal-chain__empty" data-testid="signal-empty">
          Nothing on the chain yet. Write something above.
        </p>
      ) : visible.length === 0 ? (
        <p className="muted signal-chain__empty" data-testid="signal-filter-empty">
          No signals match these filters.
        </p>
      ) : (
        <ul className="signal-chain__list">
          {visible.map((item) => {
            const imageAttachment =
              item.attachment?.kind === "image" ? item.attachment : null;
            return (
              <SignalRow
                key={item.id}
                signal={item}
                imageUrl={
                  imageAttachment ? imageUrls[imageAttachment.relPath] : undefined
                }
                imageMissing={
                  imageAttachment
                    ? Boolean(missingImages[imageAttachment.relPath])
                    : false
                }
                liveDomains={liveDomains.map((d) => ({
                  slug: d.slug,
                  name: d.meta.name,
                }))}
                allDomains={allDomains}
                projects={projects}
                editing={editingId === item.id}
                busy={busy}
                mapReady={Boolean(snapshot?.map)}
                linkedTaskId={taskForSignal(snapshot?.map?.tasks ?? [], item.id)?.id}
                onEdit={() => setEditingId(item.id)}
                onCancel={() => setEditingId(null)}
                onSave={onSave}
                onAssign={(id, slug) => void onAssign(id, slug)}
                onTriage={onTriage}
                onDelete={() => void onDelete(item.id)}
                onMakeTask={() => void onMakeTask(item)}
              />
            );
          })}
        </ul>
      )}
      {dialog}
    </div>
  );
}

function SignalRow(props: {
  signal: SignalRecord;
  imageUrl: string | undefined;
  imageMissing: boolean;
  liveDomains: { slug: string; name: string }[];
  allDomains: { slug: string; name: string }[];
  projects: Project[];
  editing: boolean;
  busy: boolean;
  mapReady: boolean;
  linkedTaskId: string | undefined;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (id: string, patch: SignalUpdatePatch) => Promise<void>;
  onAssign: (id: string, domainSlug: string | null) => void;
  onTriage: (id: string, patch: SignalUpdatePatch) => Promise<void>;
  onDelete: () => void;
  onMakeTask: () => void;
}) {
  const s = props.signal;
  const [domainSlug, setDomainSlug] = useState(s.domainSlug ?? "");
  const [body, setBody] = useState(s.body);

  /** A record written before the inbox has no status key; it reads Inbox. */
  const status: SignalStatus = s.status ?? "inbox";
  const priority: SignalPriority | null = s.priority ?? null;

  useEffect(() => {
    if (!props.editing) return;
    setDomainSlug(s.domainSlug ?? "");
    setBody(s.body);
  }, [props.editing, s]);

  const domainOptions = props.liveDomains.slice();
  if (s.domainSlug && !domainOptions.some((d) => d.slug === s.domainSlug)) {
    const archived = props.allDomains.find((d) => d.slug === s.domainSlug);
    domainOptions.push({
      slug: s.domainSlug,
      name: archived?.name ?? s.domainSlug,
    });
  }

  // The project picker offers the live register. A record whose project is gone
  // keeps its id as an option, so the select shows what is stored rather than
  // silently falling back to "No project" and misreporting the row.
  const projectOptions = props.projects.map((p) => ({
    id: p.id,
    title: p.title,
  }));
  if (s.projectId && !projectOptions.some((p) => p.id === s.projectId)) {
    projectOptions.push({ id: s.projectId, title: s.projectId });
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Escape") return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    props.onCancel();
  }

  const derivedTask = taskFromSignal(s);

  if (props.editing) {
    return (
      <li className="signal-row signal-row--editing">
        <form
          className="signal-row__form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSave(s.id, {
              body,
              domainSlug: domainSlug.trim() ? domainSlug : null,
            });
          }}
          onKeyDown={onEditKeyDown}
        >
          <span className="muted signal-row__when">
            {formatSignalWhen(s.createdAt)}
          </span>
          <label className="field">
            Description
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              required={!s.attachment}
            />
          </label>
          <label className="field">
            Area
            <select
              value={domainSlug}
              onChange={(e) => setDomainSlug(e.target.value)}
            >
              <option value="">Life (general)</option>
              {domainOptions.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="signal-row__actions">
            <Button
              type="submit"
              variant="ghost"
              disabled={props.busy || (!body.trim() && !s.attachment)}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={props.onCancel}
              disabled={props.busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className="signal-row"
      data-testid="signal-row"
      data-attachment={s.attachment?.kind ?? "text"}
      // The row's triage state, readable without opening a select: the inbox
      // rig (and a stylesheet) can tell what the record says at a glance.
      data-status={status}
      data-priority={priority ?? "none"}
      data-project-id={s.projectId ?? ""}
      data-domain-slug={s.domainSlug ?? ""}
    >
      <div className="signal-row__content">
        {/* The triage facts first: where it came from, what it is filed to and
            where it stands. Every cell has a word, never an empty span. */}
        <div className="signal-row__meta">
          <span
            className="signal-row__chip signal-row__chip--area"
            data-testid="signal-domain"
          >
            {signalRowDomainLabel(s.domainSlug, props.allDomains)}
          </span>
          <span className="signal-row__chip" data-testid="signal-project">
            {projectDisplayLabel(s.projectId, props.projects)}
          </span>
          <span
            className={`signal-row__chip signal-row__chip--status signal-row__chip--status-${status}`}
            data-testid="signal-status"
          >
            {signalStatusLabel(status)}
          </span>
          <span
            className={`signal-row__chip signal-row__chip--priority signal-row__chip--priority-${priority ?? "none"}`}
            data-testid="signal-priority"
          >
            {signalPriorityLabel(priority)}
          </span>
          {s.capturedFrom ? (
            <span
              className="signal-row__chip signal-row__chip--from"
              data-testid="signal-captured-from"
              title={s.capturedFrom}
            >
              {s.capturedFrom}
            </span>
          ) : null}
        </div>
        {s.attachment?.kind === "image" ? (
          <figure className="signal-row__figure">
            {props.imageUrl ? (
              <img
                className="signal-row__image"
                data-testid="signal-image"
                src={props.imageUrl}
                alt={s.body.trim() || s.attachment.name}
                loading="lazy"
                width={s.attachment.width ?? undefined}
                height={s.attachment.height ?? undefined}
              />
            ) : (
              <span className="signal-row__image-missing muted">
                {props.imageMissing
                  ? "That picture is missing from the vault."
                  : "Loading picture…"}
              </span>
            )}
            <figcaption className="signal-row__image-name muted">
              {s.attachment.name}
            </figcaption>
          </figure>
        ) : null}
        {s.attachment?.kind === "link" ? (
          <a
            className="signal-row__link"
            data-testid="signal-link"
            href={s.attachment.url}
            target="_blank"
            rel="noreferrer"
            title={s.attachment.url}
          >
            <Link2 size={15} aria-hidden />
            <span className="signal-row__link-host">
              {linkHost(s.attachment.url) || s.attachment.url}
            </span>
            <span className="signal-row__link-url muted">
              {s.attachment.url}
            </span>
          </a>
        ) : null}
        {s.attachment?.kind === "file" ? (
          <SignalFileCard attachment={s.attachment} />
        ) : null}
        {s.title ? <h3 className="signal-row__title">{s.title}</h3> : null}
        {s.body ? <p className="signal-row__body">{s.body}</p> : null}
      </div>
      <time className="signal-row__when muted" dateTime={s.createdAt}>
        {formatSignalWhen(s.createdAt)}
      </time>
      <div className="signal-row__side">
        <div className="signal-row__triage">
          <select
            className="signal-row__triage-select"
            aria-label="Status"
            title="Status"
            data-testid="signal-status-select"
            value={status}
            disabled={props.busy}
            onChange={(e) => {
              const next = e.target.value as SignalStatus;
              if (next === status) return;
              void props.onTriage(s.id, { status: next });
            }}
          >
            {SIGNAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {SIGNAL_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            className="signal-row__triage-select"
            aria-label="Priority"
            title="Priority"
            data-testid="signal-priority-select"
            value={priority ?? ""}
            disabled={props.busy}
            onChange={(e) => {
              const raw = e.target.value;
              const next = raw ? (raw as SignalPriority) : null;
              if (next === priority) return;
              void props.onTriage(s.id, { priority: next });
            }}
          >
            <option value="">None</option>
            {SIGNAL_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {SIGNAL_PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            className="signal-row__triage-select"
            aria-label="Project"
            title="Project"
            data-testid="signal-project-select"
            value={s.projectId ?? ""}
            disabled={props.busy}
            onChange={(e) => {
              const raw = e.target.value;
              const next = raw ? raw : null;
              if (next === (s.projectId ?? null)) return;
              void props.onTriage(s.id, { projectId: next });
            }}
          >
            <option value="">No project</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </div>
        <select
          className="signal-row__domain"
          aria-label="Area"
          value={s.domainSlug ?? ""}
          disabled={props.busy}
          onChange={(e) => {
            const v = e.target.value.trim();
            const next = v ? v : null;
            if (next === s.domainSlug) return;
            props.onAssign(s.id, next);
          }}
        >
          <option value="">Life (general)</option>
          {domainOptions.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="signal-row__actions">
          {props.linkedTaskId ? (
            <Button
              variant="ghost"
              to={"/act?task=" + encodeURIComponent(props.linkedTaskId)}
            >Open task</Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={props.onMakeTask}
              disabled={props.busy || !props.mapReady || !derivedTask.title}
            >Make task</Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="signal-row__icon-btn"
            aria-label="Edit"
            onClick={props.onEdit}
            disabled={props.busy}
          >
            <Pencil size={16} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            destructive
            className="signal-row__icon-btn"
            aria-label="Delete"
            onClick={props.onDelete}
            disabled={props.busy}
          >
            <Trash2 size={16} aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * A captured non-image file is a card, not a line of text: the stored name is
 * the label, its size is the evidence, and Save hands the operator a copy. The
 * bytes live in the vault under a guarded path, so a save is one bridge read
 * turned into a download — the renderer never touches the filesystem directly.
 */
function SignalFileCard({ attachment }: { attachment: SignalFileAttachment }) {
  const [state, setState] = useState<"idle" | "loading" | "missing">("idle");

  async function onSave() {
    if (state === "loading") return;
    setState("loading");
    try {
      const result = await api().signalChainReadFile(attachment.relPath);
      if (!result.ok) {
        setState("missing");
        return;
      }
      const { bytes, mime } = result.value;
      const blob = new Blob([bytes as BlobPart], {
        type: mime || attachment.mime || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // The download is handed to the browser on the next task, so the blob URL
      // outlives this handler by a moment rather than being revoked under it.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("idle");
    } catch {
      setState("missing");
    }
  }

  return (
    <div className="signal-row__file" data-testid="signal-file">
      <span className="signal-row__file-icon" aria-hidden>
        <FileText size={16} />
      </span>
      <div className="signal-row__file-meta">
        <span className="signal-row__file-name" data-testid="signal-file-name">
          {attachment.name}
        </span>
        <span className="signal-row__file-size muted">
          {formatSignalFileSize(attachment.size)}
        </span>
        {state === "loading" ? (
          <span className="signal-row__file-status muted" role="status">
            Loading file…
          </span>
        ) : null}
        {state === "missing" ? (
          <span className="signal-row__file-status form-error" role="alert">
            That file is missing from the vault.
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        className="signal-row__file-save"
        data-testid="signal-file-save"
        aria-label="Save the attached file"
        title="Save the attached file"
        onClick={() => void onSave()}
        disabled={state === "loading"}
      >
        <Download size={14} aria-hidden />
        <span>Save</span>
      </Button>
    </div>
  );
}
