import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultImage, VisionBoardBlock } from "@lifequest/vault-core";
import { VisionBoardEditor, type BoardStatus } from "./VisionBoardEditor";
import { looksLikeImage, prepareImageFile } from "./image-files";
import { useImageUrls } from "./useImageUrls";
import { api } from "@/lib/ipc";

/** How long the page waits after the last change before it writes the document. */
const AUTOSAVE_DELAY_MS = 700;

/**
 * The vision board: the one long document written in blocks, on the Vision
 * page under Define.
 *
 * The pictures themselves live in the Images library; this panel only names
 * them by id. So the document keeps its place when a picture is removed from
 * the library — the image block draws as missing until it is replaced — and the
 * library can be browsed, captioned and pruned without touching a sentence of
 * the vision.
 *
 * The panel owns the vault reads (the library, for the picker and the
 * pictures), the autosave, and the errors; `VisionBoardEditor` owns only the
 * interaction state. A picture dropped or pasted into the document is uploaded
 * through the same library call the Images page uses, then inserted as a block.
 */
export function VisionBoardPanel() {
  const [images, setImages] = useState<VaultImage[] | null>(null);
  const [blocks, setBlocks] = useState<VisionBoardBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<BoardStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const imagesRef = useRef<VaultImage[] | null>(null);
  imagesRef.current = images;
  const blocksRef = useRef<VisionBoardBlock[]>([]);
  blocksRef.current = blocks;
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const { urls, missing } = useImageUrls(images);

  // ── load the library and the document once ────────────────────────────────
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
          setStatus("error");
          setError(board.error);
        }
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setImages([]);
        setStatus("error");
        setError(
          e instanceof Error ? e.message : "Could not load the vision board",
        );
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── autosave ──────────────────────────────────────────────────────────────
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
      setError(
        e instanceof Error ? e.message : "The vision board was not saved",
      );
    }
  }, []);

  const commitBlocks = useCallback(
    (next: VisionBoardBlock[]) => {
      setBlocks(next);
      blocksRef.current = next;
      dirty.current = true;
      setStatus("saving");
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
      if (dirty.current) {
        void api()
          .imagesBoardSave({ blocks: blocksRef.current })
          .catch(() => undefined);
      }
    };
  }, []);

  // Ctrl/Cmd+S is the same write for the operator who asks anyway.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      if (!loaded) return;
      event.preventDefault();
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void writeBoard(blocksRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loaded, writeBoard]);

  /** Pictures dropped or pasted into the document go into the library first. */
  const uploadFiles = useCallback(async (files: File[]): Promise<VaultImage[]> => {
    const list = files.filter(looksLikeImage);
    if (list.length === 0) return [];
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
          e instanceof Error
            ? e.message
            : "That picture could not be added to the library";
      }
    }
    if (saved.length > 0) {
      setImages((prev) => [...(prev ?? []), ...saved]);
      setError(null);
    }
    if (lastError) setError(lastError);
    return saved;
  }, []);

  return (
    <div className="vision-board-panel" data-testid="vision-board-panel">
      {error ? (
        <p
          className="images-studio__banner images-studio__banner--error"
          role="alert"
          data-testid="vision-board-error"
        >
          {error}
        </p>
      ) : null}
      {loaded ? (
        <VisionBoardEditor
          title="Vision board"
          lead="Write the vision as blocks. Pictures come from the Images library — add one with Picture, or drop one straight into the document."
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
          <h2>Vision board</h2>
          <p className="vision-board__empty">Loading the vision board…</p>
        </section>
      )}
    </div>
  );
}
