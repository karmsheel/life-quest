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
  SignalCreateInput,
  SignalRecord,
  SignalUpdatePatch,
} from "@lifequest/vault-core/pure";
import { ImagePlus, Link2, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { unlockedAreas } from "@lifequest/vault-core/pure";
import {
  IMAGE_ACCEPT,
  looksLikeImage,
  prepareImageFile,
} from "@/components/images/image-files";
import { api } from "@/lib/ipc";
import {
  formatSignalWhen,
  linkHost,
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

/**
 * Turn the text the operator pasted into a link, or say why it is not one. The
 * vault validates again on write, but a refused URL must not wait for a round
 * trip to say so.
 */
function parseLink(raw: string): { url: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Paste the link you want to keep." };
  if (trimmed.length > 2048) return { error: "That link is too long to keep." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "Links must be an absolute http or https URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Links must be an absolute http or https URL." };
  }
  return { url: parsed.href };
}

/**
 * Life-Chain is the general capture surface: a thought, a picture with a
 * description, or a link with one. All three are one box — the words are the
 * body, and an attachment is what the words may be short about. A capture with
 * an attachment may have no body; a plain text capture still needs words.
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

  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  /** The row's delete asks in the app's own dialog, not the platform's. */
  const { ask, dialog } = useConfirm();

  const [domainSlug, setDomainSlug] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  /** The preview URL as it stands, so an unmount can revoke the last one. */
  const pendingImageRef = useRef<PendingImage | null>(null);
  pendingImageRef.current = pendingImage;

  const visible = useMemo(
    () => records.filter((r) => signalVisible(lens, r.domainSlug)),
    [records, lens],
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

  function clearPendingImage() {
    if (pendingImageRef.current) {
      URL.revokeObjectURL(pendingImageRef.current.previewUrl);
      pendingImageRef.current = null;
    }
    setPendingImage(null);
  }

  function attachFile(file: File) {
    if (!looksLikeImage(file)) {
      setError("Images must be PNG, JPEG, GIF or WebP.");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError("That image is larger than 8 MB.");
      return;
    }
    setError(null);
    // One attachment per capture: a picture replaces whatever was attached, and
    // the preview URL the old picture held is released rather than leaked.
    if (link) {
      setLink(null);
      setLinkOpen(false);
      setLinkDraft("");
      setLinkError(null);
    }
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

  function onPickFiles(files: FileList | null) {
    const file = files ? Array.from(files).find(looksLikeImage) : undefined;
    if (file) attachFile(file);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    const image = files.find(looksLikeImage);
    if (!image) return;
    // The image is the paste; the field keeps whatever text the operator typed.
    e.preventDefault();
    attachFile(image);
  }

  // ── dropping a picture on the composer ───────────────────────────────────
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
    // is: the composer owns the gesture and says what it will take.
    e.preventDefault();
    const image = files.find(looksLikeImage);
    if (!image) {
      setError("Only PNG, JPEG, GIF or WebP pictures can be dropped here.");
      return;
    }
    attachFile(image);
  }

  // ── the link ─────────────────────────────────────────────────────────────
  function openLinkField() {
    setLinkOpen(true);
    setLinkError(null);
    setLinkDraft(link ?? "");
  }

  function addLink() {
    const parsed = parseLink(linkDraft);
    if ("error" in parsed) {
      setLinkError(parsed.error);
      return;
    }
    if (pendingImageRef.current) clearPendingImage();
    setLink(parsed.url);
    setLinkOpen(false);
    setLinkDraft("");
    setLinkError(null);
    setError(null);
  }

  function removeLink() {
    setLink(null);
    setLinkOpen(false);
    setLinkDraft("");
    setLinkError(null);
  }

  function onLinkFieldKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    // Enter here adds the link; it must not log the capture half-filled.
    e.preventDefault();
    addLink();
  }

  function clearComposer() {
    clearPendingImage();
    setLink(null);
    setLinkOpen(false);
    setLinkDraft("");
    setLinkError(null);
    setBody("");
    setDomainSlug("");
    setEditingId(null);
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const hasAttachment = pendingImage !== null || link !== null;
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
      } else if (link) {
        attachment = { kind: "link", url: link };
      }
      const result = await api().signalChainCreate({
        type: "thought",
        title: null,
        body,
        domainSlug: domainSlug.trim() ? domainSlug : null,
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

  async function onAssign(id: string, nextDomain: string | null) {
    const current = records.find((r) => r.id === id)?.domainSlug ?? null;
    if (current === nextDomain) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, {
        domainSlug: nextDomain,
      });
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
        links: { signalId: signal.id },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to make task");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const composerHasSomething =
    body.trim().length > 0 || pendingImage !== null || link !== null;

  return (
    <div className="signal-chain">
      <header className="signal-chain__header">
        <h1 className="stub-page__title">Quick Notes</h1>
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

        <textarea
          aria-label="Log a signal"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onComposerKeyDown}
          onPaste={onPaste}
          placeholder="What's on your mind?"
          rows={6}
          autoFocus
        />

        {linkOpen ? (
          <div className="signal-chain__link-form">
            <input
              className="signal-chain__link-input"
              aria-label="Link URL"
              placeholder="https://…"
              value={linkDraft}
              onChange={(e) => {
                setLinkDraft(e.target.value);
                if (linkError) setLinkError(null);
              }}
              onKeyDown={onLinkFieldKeyDown}
              autoFocus
            />
            <Button
              type="button"
              variant="ghost"
              data-testid="chain-link-add"
              onClick={addLink}
            >
              Add link
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label="Cancel the link"
              onClick={removeLink}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {linkError ? (
          <p className="form-error" role="alert" data-testid="chain-link-error">
            {linkError}
          </p>
        ) : null}
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
              onClick={removeLink}
              disabled={busy}
            >
              <X size={14} aria-hidden />
            </Button>
          </div>
        ) : null}

        <div className="signal-chain__composer-tools">
          <Button
            type="button"
            variant="ghost"
            className="signal-chain__tool"
            data-testid="chain-attach-image"
            aria-label="Attach an image"
            title="Attach an image — or drop or paste one"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || link !== null}
          >
            <ImagePlus size={16} aria-hidden />
            <span>Image</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            data-testid="chain-file-input"
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            className="signal-chain__tool"
            data-testid="chain-attach-link"
            aria-label="Attach a link"
            title="Keep a link with a description"
            onClick={openLinkField}
            disabled={busy || link !== null || pendingImage !== null}
          >
            <Link2 size={16} aria-hidden />
            <span>Link</span>
          </Button>
        </div>

        <div className="signal-chain__composer-footer">
          <label className="field">
            Area
            <select
              value={domainSlug}
              onChange={(e) => setDomainSlug(e.target.value)}
            >
              <option value="">- unassigned -</option>
              {liveDomains.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.meta.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            variant="ghost"
            disabled={busy || !composerHasSomething}
          >
            Log
          </Button>
        </div>
        <p className="signal-chain__hint">
          <kbd>Enter</kbd> to log · <kbd>Shift+Enter</kbd> for a new line · drop
          or paste a picture
        </p>
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

      {loading ? (
        <p className="muted">Loading chain…</p>
      ) : records.length === 0 ? (
        <p className="muted signal-chain__empty">
          Nothing on the chain yet. Write something above.
        </p>
      ) : visible.length === 0 ? (
        <p className="muted signal-chain__empty">
          No unassigned or matching signals in this area.
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
                editing={editingId === item.id}
                busy={busy}
                mapReady={Boolean(snapshot?.map)}
                linkedTaskId={taskForSignal(snapshot?.map?.tasks ?? [], item.id)?.id}
                onEdit={() => setEditingId(item.id)}
                onCancel={() => setEditingId(null)}
                onSave={onSave}
                onAssign={(id, slug) => void onAssign(id, slug)}
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
  editing: boolean;
  busy: boolean;
  mapReady: boolean;
  linkedTaskId: string | undefined;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (id: string, patch: SignalUpdatePatch) => Promise<void>;
  onAssign: (id: string, domainSlug: string | null) => void;
  onDelete: () => void;
  onMakeTask: () => void;
}) {
  const s = props.signal;
  const [domainSlug, setDomainSlug] = useState(s.domainSlug ?? "");
  const [body, setBody] = useState(s.body);

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
              <option value="">- unassigned -</option>
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
    >
      <div className="signal-row__content">
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
        {s.title ? <h3 className="signal-row__title">{s.title}</h3> : null}
        {s.body ? <p className="signal-row__body">{s.body}</p> : null}
      </div>
      <time className="signal-row__when muted" dateTime={s.createdAt}>
        {formatSignalWhen(s.createdAt)}
      </time>
      <div className="signal-row__side">
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
          <option value="">- unassigned -</option>
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
