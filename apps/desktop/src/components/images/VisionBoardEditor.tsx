import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { VaultImage, VisionBoardBlock } from "@lifequest/vault-core";
import { newBlockId } from "./block-id.ts";
import { looksLikeImage } from "./image-files.ts";

/** How the page reports the autosave of the document. */
export type BoardStatus = "idle" | "saving" | "saved" | "error";

type FocusRequest = {
  blockId: string;
  /** Which bullet line, when the block holds several. */
  item?: number;
  /** Where the caret lands, defaulting to the end of the field. */
  caret?: number;
};

export type VisionBoardEditorProps = {
  blocks: VisionBoardBlock[];
  /** The library, for image blocks and the picture picker. */
  images: VaultImage[];
  /** relPath → blob URL; a block whose picture has none is drawn as missing. */
  urls: Record<string, string>;
  missingImages: Record<string, true>;
  status: BoardStatus;
  /** Uploads the files and answers with the library rows that were stored. */
  onUploadFiles: (files: File[]) => Promise<VaultImage[]>;
  onChange: (next: VisionBoardBlock[]) => void;
};

function BlockButton({
  label,
  title,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="vblock__control"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/**
 * The vision document: a Notion-shaped stack of blocks, written beside the
 * picture library.
 *
 * The editor is deliberately a block list rather than a rich-text surface. Each
 * block is one of four things — prose, a heading, a list, a picture with its
 * caption — and the operations are the ones a person expects from a document:
 * Enter starts the next block, Backspace at the start of an empty block removes
 * it, a picture can be dropped or pasted straight into the text, and blocks can
 * be reordered.
 *
 * The document belongs to the page: this component holds only the interaction
 * state (which field has focus, whether the picture picker is up) and reports
 * every change through `onChange`. That keeps autosave, the vault, and the
 * errors in one place, and makes the editor a pure function of its props for the
 * rig.
 */
export function VisionBoardEditor({
  blocks,
  images,
  urls,
  missingImages,
  status,
  onUploadFiles,
  onChange,
}: VisionBoardEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement | null>());
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const imagesById = useMemo(() => {
    const map = new Map<string, VaultImage>();
    for (const image of images) map.set(image.id, image);
    return map;
  }, [images]);

  const statusLabel =
    status === "saving" ? "Saving…" : status === "error" ? "Not saved" : "Saved";

  // Focus after the render that created the field, never during the event that
  // asked for it: the new block does not exist in the DOM yet.
  useEffect(() => {
    if (!focusRequest) return;
    const root = blockRefs.current.get(focusRequest.blockId);
    if (!root) {
      setFocusRequest(null);
      return;
    }
    const target =
      focusRequest.item === undefined
        ? root.querySelector<HTMLElement>("[data-block-input]")
        : root.querySelector<HTMLInputElement>(
            `[data-bullet-index="${focusRequest.item}"]`,
          );
    if (target) {
      target.focus();
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const at = focusRequest.caret ?? target.value.length;
        try {
          target.setSelectionRange(at, at);
        } catch {
          // Some input states (a file field, a number field) refuse selection.
        }
      }
    }
    setFocusRequest(null);
  }, [focusRequest, blocks]);

  const commit = useCallback(
    (next: VisionBoardBlock[]) => {
      blocksRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const indexOf = (id: string) => blocksRef.current.findIndex((b) => b.id === id);

  const patchBlock = useCallback(
    (id: string, patch: (block: VisionBoardBlock) => VisionBoardBlock) => {
      commit(blocksRef.current.map((b) => (b.id === id ? patch(b) : b)));
    },
    [commit],
  );

  const replaceBlock = useCallback(
    (id: string, next: VisionBoardBlock) => {
      commit(blocksRef.current.map((b) => (b.id === id ? next : b)));
    },
    [commit],
  );

  function insertAfter(id: string, block: VisionBoardBlock) {
    const current = blocksRef.current;
    const index = current.findIndex((b) => b.id === id);
    const at = index < 0 ? current.length : index + 1;
    commit([...current.slice(0, at), block, ...current.slice(at)]);
    setFocusRequest({ blockId: block.id });
  }

  function removeBlock(id: string) {
    const current = blocksRef.current;
    const index = current.findIndex((b) => b.id === id);
    if (index < 0) return;
    const next = [...current.slice(0, index), ...current.slice(index + 1)];
    commit(next);
    const neighbour = next[index - 1] ?? next[index];
    if (neighbour) setFocusRequest({ blockId: neighbour.id });
  }

  function moveBlock(id: string, delta: -1 | 1) {
    const current = [...blocksRef.current];
    const index = current.findIndex((b) => b.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return;
    const [block] = current.splice(index, 1);
    current.splice(target, 0, block!);
    commit(current);
  }

  function addText() {
    const block: VisionBoardBlock = { id: newBlockId(), kind: "text", text: "" };
    commit([...blocksRef.current, block]);
    setFocusRequest({ blockId: block.id });
  }

  function addHeading() {
    const block: VisionBoardBlock = { id: newBlockId(), kind: "heading", text: "" };
    commit([...blocksRef.current, block]);
    setFocusRequest({ blockId: block.id });
  }

  function addBullets() {
    const block: VisionBoardBlock = {
      id: newBlockId(),
      kind: "bullets",
      items: [""],
    };
    commit([...blocksRef.current, block]);
    setFocusRequest({ blockId: block.id, item: 0 });
  }

  function addImage(image: VaultImage) {
    const block: VisionBoardBlock = {
      id: newBlockId(),
      kind: "image",
      imageId: image.id,
      caption: "",
    };
    commit([...blocksRef.current, block]);
    setPickerOpen(false);
  }

  async function uploadIntoDocument(files: File[], afterBlockId?: string) {
    const uploaded = await onUploadFiles(files);
    if (uploaded.length === 0) return;
    const current = blocksRef.current;
    const index = afterBlockId ? current.findIndex((b) => b.id === afterBlockId) : -1;
    const at = index < 0 ? current.length : index + 1;
    const added: VisionBoardBlock[] = uploaded.map((image) => ({
      id: newBlockId(),
      kind: "image",
      imageId: image.id,
      caption: "",
    }));
    commit([...current.slice(0, at), ...added, ...current.slice(at)]);
    setPickerOpen(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer?.files ?? []).filter(looksLikeImage);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadIntoDocument(files);
  }

  function onPaste(
    event: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
    blockId: string,
  ) {
    const files = Array.from(event.clipboardData?.files ?? []).filter(looksLikeImage);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadIntoDocument(files, blockId);
  }

  function onTextKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    block: Extract<VisionBoardBlock, { kind: "text" }>,
  ) {
    const element = event.currentTarget;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const caret = element.selectionStart ?? block.text.length;
      const after = block.text.slice(caret);
      const nextBlock: VisionBoardBlock = {
        id: newBlockId(),
        kind: "text",
        text: after,
      };
      const index = indexOf(block.id);
      const current = blocksRef.current;
      if (index < 0) return;
      commit([
        ...current.slice(0, index),
        { ...block, text: block.text.slice(0, caret) },
        nextBlock,
        ...current.slice(index + 1),
      ]);
      setFocusRequest({ blockId: nextBlock.id, caret: 0 });
      return;
    }
    if (event.key === "Backspace" && element.selectionStart === 0 && element.selectionEnd === 0) {
      const index = indexOf(block.id);
      const previous = index > 0 ? blocksRef.current[index - 1] : undefined;
      if (block.text !== "" && previous?.kind === "text") {
        event.preventDefault();
        const caret = previous.text.length;
        const current = blocksRef.current;
        commit([
          ...current.slice(0, index - 1),
          { ...previous, text: previous.text + block.text },
          ...current.slice(index + 1),
        ]);
        setFocusRequest({ blockId: previous.id, caret });
        return;
      }
      event.preventDefault();
      removeBlock(block.id);
    }
  }

  function onHeadingKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    block: Extract<VisionBoardBlock, { kind: "heading" }>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      insertAfter(block.id, { id: newBlockId(), kind: "text", text: "" });
      return;
    }
    if (
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0 &&
      block.text === ""
    ) {
      event.preventDefault();
      removeBlock(block.id);
    }
  }

  function onBulletKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    block: Extract<VisionBoardBlock, { kind: "bullets" }>,
    itemIndex: number,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      const items = [...block.items];
      items.splice(itemIndex + 1, 0, "");
      replaceBlock(block.id, { ...block, items });
      setFocusRequest({ blockId: block.id, item: itemIndex + 1 });
      return;
    }
    if (
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0 &&
      block.items[itemIndex] === ""
    ) {
      event.preventDefault();
      if (block.items.length > 1) {
        const items = block.items.filter((_, i) => i !== itemIndex);
        replaceBlock(block.id, { ...block, items });
        setFocusRequest({
          blockId: block.id,
          item: Math.max(0, itemIndex - 1),
        });
      } else {
        removeBlock(block.id);
      }
    }
  }

  function renderBlock(block: VisionBoardBlock, index: number) {
    const first = index === 0;
    const last = index === blocks.length - 1;
    const controls = (
      <div className="vblock__controls" aria-label="Block controls">
        <BlockButton
          label="Move block up"
          onClick={() => moveBlock(block.id, -1)}
          disabled={first}
          testId="block-move-up"
        >
          ↑
        </BlockButton>
        <BlockButton
          label="Move block down"
          onClick={() => moveBlock(block.id, 1)}
          disabled={last}
          testId="block-move-down"
        >
          ↓
        </BlockButton>
        <BlockButton
          label="Remove block"
          onClick={() => removeBlock(block.id)}
          testId="block-remove"
        >
          ×
        </BlockButton>
      </div>
    );

    if (block.kind === "heading") {
      return (
        <div
          key={block.id}
          className="vblock"
          data-kind="heading"
          data-testid={`vblock-${block.id}`}
          ref={(el) => {
            blockRefs.current.set(block.id, el);
          }}
        >
          {controls}
          <input
            className="vblock__heading"
            data-block-input
            data-testid="block-heading"
            value={block.text}
            placeholder="Heading"
            aria-label="Heading block"
            onChange={(e) => replaceBlock(block.id, { ...block, text: e.target.value })}
            onKeyDown={(e) => onHeadingKeyDown(e, block)}
          />
        </div>
      );
    }

    if (block.kind === "text") {
      return (
        <div
          key={block.id}
          className="vblock"
          data-kind="text"
          data-testid={`vblock-${block.id}`}
          ref={(el) => {
            blockRefs.current.set(block.id, el);
          }}
        >
          {controls}
          <textarea
            className="vblock__text"
            data-block-input
            data-testid="block-text"
            value={block.text}
            placeholder="Write…"
            aria-label="Text block"
            rows={1}
            onChange={(e) => replaceBlock(block.id, { ...block, text: e.target.value })}
            onKeyDown={(e) => onTextKeyDown(e, block)}
            onPaste={(e) => onPaste(e, block.id)}
          />
        </div>
      );
    }

    if (block.kind === "bullets") {
      return (
        <div
          key={block.id}
          className="vblock"
          data-kind="bullets"
          data-testid={`vblock-${block.id}`}
          ref={(el) => {
            blockRefs.current.set(block.id, el);
          }}
        >
          {controls}
          <div className="vblock__bullets" role="list">
            {block.items.map((item, itemIndex) => (
              <div className="vblock__bullet" role="listitem" key={itemIndex}>
                <span className="vblock__bullet-dot" aria-hidden="true">
                  •
                </span>
                <input
                  className="vblock__bullet-input"
                  data-block-input={itemIndex === 0 ? true : undefined}
                  data-bullet-index={itemIndex}
                  data-testid="block-bullet"
                  value={item}
                  placeholder="List item"
                  aria-label={`Bullet ${itemIndex + 1}`}
                  onChange={(e) => {
                    const items = block.items.map((raw, i) =>
                      i === itemIndex ? e.target.value : raw,
                    );
                    replaceBlock(block.id, { ...block, items });
                  }}
                  onKeyDown={(e) => onBulletKeyDown(e, block, itemIndex)}
                  onPaste={(e) => onPaste(e, block.id)}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    const image = imagesById.get(block.imageId);
    const url = image ? urls[image.relPath] : undefined;
    const gone = !image || (image ? Boolean(missingImages[image.relPath]) : true);
    return (
      <div
        key={block.id}
        className="vblock"
        data-kind="image"
        data-testid={`vblock-${block.id}`}
      >
        {controls}
        {url ? (
          <img
            className="vblock__image"
            src={url}
            alt={block.caption || image?.name || "Picture in the vision document"}
            width={image?.width ?? undefined}
            height={image?.height ?? undefined}
          />
        ) : (
          <p className="vblock__image-missing" data-testid="block-image-missing">
            {gone
              ? "This picture is no longer in the library."
              : "Loading picture…"}
          </p>
        )}
        <input
          className="vblock__caption"
          data-testid="block-image-caption"
          value={block.caption}
          placeholder="Add a caption"
          aria-label="Picture caption"
          onChange={(e) =>
            replaceBlock(block.id, { ...block, caption: e.target.value })
          }
        />
      </div>
    );
  }

  return (
    <section
      className="vision-board"
      aria-labelledby="vision-board-heading"
      data-testid="vision-board"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <header className="vision-board__header">
        <div className="vision-board__heading">
          <h2 id="vision-board-heading">The vision</h2>
          <span
            className="vision-board__status"
            data-testid="vision-board-status"
            data-status={status}
          >
            {statusLabel}
          </span>
        </div>
        <p className="vision-board__lead">
          Write it as blocks. Add pictures from the library beside this
          document, drop one in, or paste one into a text block.
        </p>
      </header>

      {blocks.length === 0 ? (
        <p className="vision-board__empty" data-testid="vision-board-empty">
          The document is empty. Start with a text block, or add a picture.
        </p>
      ) : (
        <div className="vision-board__blocks">
          {blocks.map((block, index) => renderBlock(block, index))}
        </div>
      )}

      <div className="vision-board__add" role="toolbar" aria-label="Add a block">
        <span className="vision-board__add-label">Add</span>
        <button
          type="button"
          className="vision-board__add-button"
          data-testid="board-add-text"
          onClick={addText}
        >
          Text
        </button>
        <button
          type="button"
          className="vision-board__add-button"
          data-testid="board-add-heading"
          onClick={addHeading}
        >
          Heading
        </button>
        <button
          type="button"
          className="vision-board__add-button"
          data-testid="board-add-bullets"
          onClick={addBullets}
        >
          Bullets
        </button>
        <button
          type="button"
          className="vision-board__add-button"
          data-testid="board-add-image"
          onClick={() => setPickerOpen(true)}
        >
          Picture
        </button>
      </div>

      {pickerOpen ? (
        <div
          className="vision-board__picker"
          role="dialog"
          aria-label="Add a picture"
          data-testid="image-picker"
        >
          <div className="vision-board__picker-head">
            <strong>Add a picture</strong>
            <button
              type="button"
              className="vision-board__picker-close"
              data-testid="image-picker-close"
              onClick={() => setPickerOpen(false)}
            >
              Close
            </button>
          </div>
          {images.length === 0 ? (
            <p className="vision-board__picker-empty">
              Upload a picture from the library first.
            </p>
          ) : (
            <div className="vision-board__picker-grid">
              {images.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  className="vision-board__picker-option"
                  data-testid={`picker-image-${image.id}`}
                  onClick={() => addImage(image)}
                >
                  {urls[image.relPath] ? (
                    <img src={urls[image.relPath]} alt="" />
                  ) : (
                    <span>{image.name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
