import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Link } from "react-router-dom";
import type { VaultImage } from "@lifequest/vault-core";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/useConfirm";
import {
  IMAGE_ACCEPT,
  formatImageBytes,
  looksLikeImage,
  prepareImageFile,
} from "@/components/images/image-files";
import { useImageUrls } from "@/components/images/useImageUrls";
import { api } from "@/lib/ipc";

/** How long a caption edit waits before it is written to the library. */
const CAPTION_DELAY_MS = 700;

/**
 * Define → Images: the vault-level picture library.
 *
 * This page is the library and nothing else. Pictures are uploaded here, kept as
 * files in the vault, captioned, and removed; the vision they belong to is
 * written on the **Vision** page, where the board's picture picker reads this
 * same library. Keeping the two apart is what lets the operator browse and prune
 * pictures without scrolling past a document, and write the vision without the
 * gallery taking half the sheet.
 *
 * Uploads accept PNG, JPEG, GIF and WebP up to 8 MB. The vault sniffs the bytes;
 * this page only filters the picker and reports the vault's refusal. Removing a
 * picture asks first, and the vision board keeps its block where the picture was
 * — the block draws as missing until it is replaced.
 */
export default function ImagesPage() {
  const { ask, dialog } = useConfirm();
  const [images, setImages] = useState<VaultImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const imagesRef = useRef<VaultImage[] | null>(null);
  imagesRef.current = images;
  const captionTimers = useRef(new Map<string, number>());

  const { urls, missing } = useImageUrls(images);

  // ── the library, once ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api().imagesList();
        if (cancelled) return;
        if (result.ok) {
          setImages(result.value);
        } else {
          setImages([]);
          setError(result.error);
        }
      } catch (e) {
        if (cancelled) return;
        setImages([]);
        setError(
          e instanceof Error ? e.message : "Could not load the image library",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of captionTimers.current.values()) {
        window.clearTimeout(timer);
      }
      captionTimers.current.clear();
    };
  }, []);

  // ── uploads ──────────────────────────────────────────────────────────────
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
          lastError =
            e instanceof Error ? e.message : "That picture could not be uploaded";
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
    void uploadFiles(Array.from(files));
  }

  // ── captions and removal ─────────────────────────────────────────────────
  function setCaption(id: string, caption: string) {
    setImages((prev) =>
      prev
        ? prev.map((image) => (image.id === id ? { ...image, caption } : image))
        : prev,
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
      message: `"${image.name}" will be removed from the vault. The vision board keeps its block, and the picture shows as missing there.`,
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

  // ── dropping pictures anywhere on the page ────────────────────────────────
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
  const pictureCountLabel = `${imageCount} ${
    imageCount === 1 ? "picture" : "pictures"
  }`;

  // The drop overlay and the remove question are the page's siblings rather
  // than its children, so neither is trapped by a scrolling or containing
  // ancestor on the page itself.
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
            The pictures of the life you are defining. Upload them here; the
            vision they belong to is written beside them on the Vision page.
          </p>
          <p className="images-studio__crosslink">
            <Link to="/vision">Open the Vision page</Link> to write the vision
            board.
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
          <p
            className="images-studio__banner"
            role="status"
            data-testid="images-notice"
          >
            {notice}
          </p>
        ) : null}

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
            Drag pictures anywhere on this page, or use Upload. Caption them
            here; the Vision board reads this library.
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
                  <div className="image-card__preview">
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
                        {missing[image.relPath]
                          ? "Missing from the vault"
                          : "Loading…"}
                      </span>
                    )}
                  </div>
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
      </div>

      {dragging ? (
        <div
          className="images-studio__drop"
          data-testid="images-drop-overlay"
          aria-hidden="true"
        >
          Drop pictures to upload them
        </div>
      ) : null}

      {dialog}
    </>
  );
}
