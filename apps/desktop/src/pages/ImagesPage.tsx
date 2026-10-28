import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { VaultImage, VisionBoardBlock } from "@lifequest/vault-core";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import { VisionBoardEditor, type BoardStatus } from "@/components/images/VisionBoardEditor";
import { newBlockId } from "@/components/images/block-id";
import {
  IMAGE_ACCEPT,
  formatImageBytes,
  looksLikeImage,
  prepareImageFile,
} from "@/components/images/image-files";
import { useImageUrls } from "@/components/images/useImageUrls";
import { api } from "@/lib/ipc";

/** How long the page waits after the last change before it writes the document. */
const AUTOSAVE_DELAY_MS = 700;
/** How long a caption edit waits before it is written to the library. */
const CAPTION_DELAY_MS = 700;

/**
 * Define → Images: the vault-level picture library, and the one vision
 * document written beside it.
 *
 * The page is two surfaces in one sheet. On the left, the library: every
 * picture the operator has uploaded, each with its caption and the two verbs
 * that matter — add it to the document, or remove it from the vault. On the
 * right, the document: a Notion-shaped stack of text, heading, bullet and
 * picture blocks, saved by itself shortly after the operator stops writing.
 *
 * The two are joined by ids, never by paths. A picture block names an image id;
 * the library names the file it stored. That is why removing a picture does not
 * rewrite the document — the block keeps its place and draws as missing, so the
 * operator can replace the picture rather than lose the sentence around it.
 *
 * Uploads accept PNG, JPEG, GIF and WebP up to 8 MB. The vault sniffs the
 * bytes; this page only filters the picker and reports the vault's refusal. The
 * document is autosaved as a whole; there is no Save control because there is
 * nothing to forget.
 */
export default function ImagesPage() {
  const { ask, dialog } = useConfirm();
  const [images, setImages] = useState<VaultImage[] | null>(null);
  const [blocks, setBlocks] = useState<VisionBoardBlock[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [status, setStatus] = useState<BoardStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const imagesRef = useRef<VaultImage[] | null>(null);
  imagesRef.current = images;
  const blocksRef = useRef<VisionBoardBlock[]>([]);
  blocksRef.current = blocks;
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const captionTimers = useRef(new Map<string, number>());

  const { urls, missing } = useImageUrls(images);

  // ── load both halves once ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [library, board] = await Promise.all([
          api().imagesList(),
          api().imagesBoardGet(),
        ]);
        if (cancelled) return;
        if (library.ok) {
          setImages(library.value);
        } else {
          setImages([]);
          setError(library.error);
        }
        if (board.ok) {
          setBlocks(board.value.blocks);
          setStatus("saved");
        } else {
          setError(board.error);
          setStatus("error");
        }
        setBoardLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setImages([]);
        setError(e instanceof Error ? e.message : "Could not load the image library");
        setBoardLoaded(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── the document's autosave ──────────────────────────────────────────────
  const writeBoard = useCallback(async (next: VisionBoardBlock[]) => {
    setStatus("saving");
    try {
      const result = await api().imagesBoardSave({ blocks: next });
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }
      dirty.current = false;
      setStatus("saved");
      setError(null);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "The vision document was not saved");
    }
  }, []);

  const commitBlocks = useCallback(
    (next: VisionBoardBlock[]) => {
      setBlocks(next);
      blocksRef.current = next;
      dirty.current = true;
      setStatus("saving");
      setNotice(null);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void writeBoard(blocksRef.current);
      }, AUTOSAVE_DELAY_MS);
    },
    [writeBoard],
  );

  // A page that is left with a write still on the clock saves it rather than
  // dropping the last sentence the operator typed.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      if (dirty.current) void api().imagesBoardSave({ blocks: blocksRef.current });
      for (const timer of captionTimers.current.values()) window.clearTimeout(timer);
      captionTimers.current.clear();
    };
  }, []);

  // Ctrl/Cmd+S is the same write for the operator who asks anyway.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!boardLoaded) return;
      event.preventDefault();
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void writeBoard(blocksRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boardLoaded, writeBoard]);

  // ── the library ──────────────────────────────────────────────────────────
  const uploadFiles = useCallback(
    async (files: File[]): Promise<VaultImage[]> => {
      const list = files.filter(looksLikeImage);
      if (list.length === 0) return [];
      setUploading(true);
      setError(null);
      setNotice(null);
      const saved: VaultImage[] = [];
      let lastError: string | null = null;
      for (const file of list) {
        try {
          const prepared = await prepareImageFile(file);
          const result = await api().imagesSave({
            bytes: prepared.bytes,
            mime: prepared.mime,
            name: prepared.name,
            width: prepared.width,
            height: prepared.height,
          });
          if (!result.ok) {
            lastError = result.error;
            continue;
          }
          saved.push(result.value);
        } catch (e) {
          lastError = e instanceof Error ? e.message : "That picture could not be uploaded";
        }
      }
      if (saved.length > 0) {
        setImages((prev) => [...(prev ?? []), ...saved]);
        setNotice(
          saved.length === 1
            ? `"${saved[0]!.name}" added to the library.`
            : `${saved.length} pictures added to the library.`,
        );
      }
      if (lastError) setError(lastError);
      setUploading(false);
      return saved;
    },
    [],
  );

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    void uploadFiles(list);
  }

  function setCaption(id: string, caption: string) {
    setImages((prev) =>
      prev ? prev.map((image) => (image.id === id ? { ...image, caption } : image)) : prev,
    );
    const existing = captionTimers.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      captionTimers.current.delete(id);
      void api()
        .imagesUpdate(id, { caption })
        .then((result) => {
          if (!result.ok) setError(result.error);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "The caption was not saved");
        });
    }, CAPTION_DELAY_MS);
    captionTimers.current.set(id, timer);
  }

  function flushCaption(id: string) {
    const timer = captionTimers.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    captionTimers.current.delete(id);
    const image = imagesRef.current?.find((entry) => entry.id === id);
    if (!image) return;
    void api()
      .imagesUpdate(id, { caption: image.caption })
      .then((result) => {
        if (!result.ok) setError(result.error);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "The caption was not saved");
      });
  }

  function removeImage(image: VaultImage) {
    ask({
      title: "Remove this picture?",
      message: `"${image.name}" will be removed from the vault. The vision document keeps its place, and the picture shows as missing there.`,
      confirmLabel: "Remove picture",
      destructive: true,
      run: () => {
        void (async () => {
          const result = await api().imagesDelete(image.id);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setImages((prev) =>
            prev ? prev.filter((entry) => entry.id !== image.id) : prev,
          );
          setNotice(`"${image.name}" removed from the library.`);
        })();
      },
    });
  }

  function insertImage(image: VaultImage) {
    commitBlocks([
      ...blocksRef.current,
      { id: newBlockId(), kind: "image", imageId: image.id, caption: "" },
    ]);
    setNotice(`"${image.name}" added to the vision document.`);
  }

  // ── dropping pictures on the page (the document handles its own drops) ────
  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer?.files ?? []).filter(looksLikeImage);
    dragDepth.current = 0;
    setDragging(false);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  const imageCount = images?.length ?? 0;
  const libraryReady = images !== null;
  const documentReady = boardLoaded;

  const pictureCountLabel = useMemo(
    () => `${imageCount} ${imageCount === 1 ? "picture" : "pictures"}`,
    [imageCount],
  );

  // The drop overlay and the remove question are the page's siblings rather
  // than its children: `.images-studio` is a size container, so `fixed`
  // descendants are held inside its box and would scroll away with the page.
  return (
    <>
      <div
        className={`images-studio${dragging ? " images-studio--dragging" : ""}`}
        data-testid="images-studio"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        }}
        onDrop={onDrop}
      >
        <header className="images-studio__header">
          <p className="images-studio__eyebrow">Define</p>
          <h1 className="images-studio__title">Images</h1>
          <p className="images-studio__lead">
            The pictures of the life you are defining. Upload them once, then write
            the vision beside them as text, headings, lists and pictures.
          </p>
        </header>

        {error ? (
          <p
            className="images-studio__banner images-studio__banner--error"
            role="alert"
            data-testid="images-error"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="images-studio__banner" role="status" data-testid="images-notice">
            {notice}
          </p>
        ) : null}

        <div className="images-studio__layout">
          <section
            className="images-library"
            aria-labelledby="images-library-heading"
            data-testid="images-library"
          >
            <div className="images-library__head">
              <h2 id="images-library-heading">Library</h2>
              <span className="images-library__count" data-testid="images-count">
                {imageCount}
              </span>
              {imageCount > 0 ? (
                <span className="images-library__summary">{pictureCountLabel}</span>
              ) : null}
              <Button
                variant="primary"
                className="images-library__upload"
                data-testid="images-upload-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Upload pictures"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                hidden
                data-testid="images-file-input"
                onChange={(event) => {
                  onPickFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
            <p className="images-library__hint">
              Drag pictures anywhere on this page, or use Upload. Click a picture to
              put it in the vision document.
            </p>

            {!libraryReady ? (
              <p className="images-library__empty" data-testid="images-loading">
                Loading the library…
              </p>
            ) : imageCount === 0 ? (
              <div className="images-library__empty" data-testid="images-empty">
                <p className="images-library__empty-title">No pictures yet.</p>
                <p className="images-library__empty-hint">
                  Upload the first picture, or drop one on this page.
                </p>
              </div>
            ) : (
              <ul className="images-library__grid" data-testid="images-grid">
                {images!.map((image) => (
                  <li
                    className="image-card"
                    key={image.id}
                    data-testid={`image-card-${image.id}`}
                  >
                    <button
                      type="button"
                      className="image-card__preview"
                      data-testid={`image-insert-${image.id}`}
                      aria-label={`Add ${image.name} to the vision document`}
                      title="Add to the vision document"
                      onClick={() => insertImage(image)}
                    >
                      {urls[image.relPath] ? (
                        <img
                          src={urls[image.relPath]}
                          alt={image.caption || image.name}
                          loading="lazy"
                          width={image.width ?? undefined}
                          height={image.height ?? undefined}
                        />
                      ) : (
                        <span className="image-card__waiting">
                          {missing[image.relPath] ? "Missing from the vault" : "Loading…"}
                        </span>
                      )}
                    </button>
                    <div className="image-card__body">
                      <input
                        className="image-card__caption"
                        data-testid={`image-caption-${image.id}`}
                        value={image.caption}
                        placeholder="Add a caption"
                        aria-label={`Caption for ${image.name}`}
                        onChange={(event) => setCaption(image.id, event.target.value)}
                        onBlur={() => flushCaption(image.id)}
                      />
                      <p className="image-card__meta">
                        {image.name} · {formatImageBytes(image.bytes)}
                      </p>
                      <div className="image-card__actions">
                        <button
                          type="button"
                          className="image-card__action"
                          onClick={() => insertImage(image)}
                        >
                          Add to document
                        </button>
                        <button
                          type="button"
                          className="image-card__action image-card__action--quiet"
                          onClick={() => removeImage(image)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {documentReady ? (
            <VisionBoardEditor
              blocks={blocks}
              images={images ?? []}
              urls={urls}
              missingImages={missing}
              status={status}
              onUploadFiles={uploadFiles}
              onChange={commitBlocks}
            />
          ) : (
            <section className="vision-board" data-testid="vision-board-loading">
              <h2>The vision</h2>
              <p className="vision-board__empty">
                {loading ? "Loading the document…" : "The document could not be loaded."}
              </p>
            </section>
          )}
        </div>
      </div>

      {dragging ? (
        <div className="images-studio__drop" data-testid="images-drop-overlay" aria-hidden="true">
          Drop pictures to upload them
        </div>
      ) : null}

      {dialog}
    </>
  );
}
