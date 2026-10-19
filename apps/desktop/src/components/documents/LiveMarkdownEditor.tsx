import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { MarkdownView } from "./MarkdownView";

/**
 * One box, live preview — the Obsidian model, without the second pane.
 *
 * Every markdown editor in the studio is this component: a daily note, a doctrine
 * document, a review's own file. The markdown is always its own source: every
 * keystroke re-serializes the block into the caller's value, so the page's draft
 * is never behind what is on screen. What differs from a textarea is only how the
 * source is *shown*: all of it but the block under the caret is rendered, and the
 * block under the caret is its raw markdown. Nothing is ever hidden that the
 * operator cannot open, and no byte of the file is invented by the renderer — the
 * box and the file agree by construction.
 *
 * The unit is the block, and the separator between two blocks is exactly one
 * blank line, because that is the unit the markdown renderer
 * (`doctrineMarkdownToHtml`) has: paragraphs, headings, lists and fenced code.
 * Blocks are joined with exactly one blank line, so a new block *is* a paragraph
 * break and Enter never leaves the file in a shape the operator cannot see.
 *
 * BLANK LINES ARE THE OPERATOR'S. A block of its own that holds nothing is a
 * blank line in the file, and the file keeps it: two blank lines between two
 * paragraphs stay two. This was untrue in both directions — the parser split on
 * *two or more* newlines, so the writer's own separator swallowed the empty block
 * on the way back in and the blank line vanished the moment the caret moved —
 * which is what "I cannot place empty lines between paragraphs" was. The parser
 * now splits on exactly the separator it joins with, which makes the two
 * inverses: no keystroke can lose a block or invent one.
 */

/**
 * The note as the blocks that render in it. A note with no prose is one empty block.
 *
 * Splitting on exactly `\n\n` is what makes this the inverse of
 * `serializeBlocks`: `"A\n\n\n\nB"` is `["A", "", "B"]` — a blank paragraph the
 * operator typed — and not the `["A", "B"]` that splitting on `\n{2,}` produces.
 *
 * A fenced code block is one block, so a blank line inside a fence is the code's
 * own text rather than a break: the fence state is counted as the parts are
 * walked, and a part read while a fence is open is appended to the block the
 * fence opened in.
 */
export function parseBlocks(markdown: string): string[] {
  // The vault stores a note as its prose and exactly one newline; that newline is
  // the file's, not the last paragraph's, so it is not part of a block.
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (normalized === "") return [""];
  const blocks: string[] = [];
  let inFence = false;
  for (const part of normalized.split("\n\n")) {
    if (inFence && blocks.length > 0) {
      blocks[blocks.length - 1] = `${blocks[blocks.length - 1]!}\n\n${part}`;
    } else {
      blocks.push(part);
    }
    const fences = part.match(/^\s*```/gm)?.length ?? 0;
    if (fences % 2 === 1) inFence = !inFence;
  }
  while (blocks.length > 1 && blocks[blocks.length - 1]!.trim() === "") blocks.pop();
  return blocks;
}

/** The blocks as the markdown file holds them. A trailing empty block is not prose. */
export function serializeBlocks(blocks: string[]): string {
  const kept = [...blocks];
  while (kept.length > 1 && kept[kept.length - 1]!.trim() === "") kept.pop();
  return kept.join("\n\n");
}

function sameBlocks(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((block, index) => block === b[index]);
}

const FENCE = /^\s*```/;
const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
/** What the renderer eats at the start of a line rather than showing it. */
const LINE_PREFIX = /^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+|```[^\n]*)/;
const INLINE_MARKER = /^(?:\*\*|__|\*|_|`)/;
const LINK = /^\[([^\]]*)\]\([^)]*\)/;
const HEADING_PREFIX = /^#{1,6}\s+/;

/**
 * The marks a keyboard shortcut writes, in the order the file will hold them.
 *
 * Underline is the one mark markdown has no syntax for, so it is the one tag the
 * renderer passes through: `<u>`. That is also what Obsidian produces, which is
 * the point — the file stays portable to any other markdown tool rather than
 * picking up a private convention this app alone understands.
 */
const MARKS = {
  b: { open: "**", close: "**" },
  i: { open: "*", close: "*" },
  u: { open: "<u>", close: "</u>" },
} as const;

/** True while the caret sits inside an unclosed fence, where Enter is a newline. */
function insideFence(text: string, index: number): boolean {
  let open = false;
  for (const line of text.slice(0, index).split("\n")) {
    if (FENCE.test(line)) open = !open;
  }
  return open;
}

function lineAround(text: string, index: number): { start: number; end: number; text: string } {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const found = text.indexOf("\n", index);
  const end = found === -1 ? text.length : found;
  return { start, end, text: text.slice(start, end) };
}

function onFirstLine(text: string, index: number): boolean {
  return !text.slice(0, index).includes("\n");
}

function onLastLine(text: string, index: number): boolean {
  return !text.slice(index).includes("\n");
}

/**
 * Write one inline mark around the selection, or take it off again.
 *
 * Every case the operator can be in is answered rather than only the easy one:
 * a selection already wrapped in the mark is unwrapped (so the shortcut toggles,
 * as it does in Obsidian), a selection that carries the marks inside it has those
 * stripped, and an empty selection gets the marks with the caret left between
 * them, ready to type into. A `setRangeText` writes the DOM without firing an
 * event, so the `input` is dispatched by hand — that is what tells React the
 * controlled value moved.
 */
function applyMark(
  el: HTMLTextAreaElement,
  mark: { open: string; close: string },
): void {
  const { open, close } = mark;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value;
  const selected = text.slice(start, end);
  let caretStart = start;
  let caretEnd = end;

  if (
    start >= open.length &&
    text.slice(start - open.length, start) === open &&
    text.slice(end, end + close.length) === close
  ) {
    // Wrapped from the outside: take the marks off and select the prose again.
    el.setRangeText(close, end, end + close.length, "preserve");
    el.setRangeText("", start - open.length, start, "preserve");
    caretStart = start - open.length;
    caretEnd = end - open.length;
  } else if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    // Wrapped inside the selection: strip its own marks.
    const bare = selected.slice(open.length, selected.length - close.length);
    el.setRangeText(bare, start, end, "preserve");
    caretStart = start;
    caretEnd = start + bare.length;
  } else if (selected.length === 0) {
    el.setRangeText(`${open}${close}`, start, end, "preserve");
    caretStart = start + open.length;
    caretEnd = caretStart;
  } else {
    el.setRangeText(`${open}${selected}${close}`, start, end, "preserve");
    caretStart = start + open.length;
    caretEnd = end + open.length;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(caretStart, caretEnd);
}

/**
 * Make the caret's own line a heading of this level, or prose again at level 0.
 *
 * Any heading the line already carries is replaced rather than stacked, so
 * pressing `Ctrl+2` on an `# H1` gives the H2 the operator asked for.
 */
function applyHeading(el: HTMLTextAreaElement, level: number): void {
  const text = el.value;
  const line = lineAround(text, el.selectionStart);
  const bare = line.text.replace(HEADING_PREFIX, "");
  const wrapped = level === 0 ? bare : `${"#".repeat(level)} ${bare}`;
  const caret = Math.max(
    0,
    el.selectionStart - line.start + (wrapped.length - line.text.length),
  );
  el.setRangeText(wrapped, line.start, line.end, "preserve");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  const at = line.start + Math.min(caret, wrapped.length);
  el.setSelectionRange(at, at);
}

/**
 * The source index of the n-th character the renderer shows, so a click lands the
 * caret where it was aimed rather than at the end of the paragraph.
 *
 * Inline markers are skipped because the renderer eats them. A paragraph's own
 * line breaks become one space (the renderer joins its lines with " "), so they
 * count as one visible character too — unless the block is a list, a quote or a
 * fence, whose lines are separate elements and contribute nothing between them.
 */
function sourceOffsetForVisible(source: string, visible: number): number {
  const linesJoin = !/^\s*(?:[-*+]|\d+\.|>|```)/.test(source);
  let seen = 0;
  let index = 0;
  let atLineStart = true;
  while (index < source.length && seen < visible) {
    const rest = source.slice(index);
    if (atLineStart) {
      const prefix = LINE_PREFIX.exec(rest);
      if (prefix) {
        index += prefix[0].length;
        atLineStart = false;
        continue;
      }
      atLineStart = false;
    }
    const char = source[index]!;
    if (char === "\n") {
      seen += linesJoin ? 1 : 0;
      index += 1;
      atLineStart = true;
      continue;
    }
    const link = LINK.exec(rest);
    if (link) {
      const label = link[1]!;
      if (seen + label.length < visible) {
        seen += label.length;
        index += link[0].length;
        continue;
      }
      return index + 1 + Math.max(0, visible - seen - 1);
    }
    const marker = INLINE_MARKER.exec(rest);
    if (marker) {
      index += marker[0].length;
      continue;
    }
    seen += 1;
    index += 1;
  }
  return Math.min(index, source.length);
}

/** Where in the block's source the pointer was, or undefined to fall back to the end. */
function sourceOffsetAt(
  x: number,
  y: number,
  block: HTMLElement,
  source: string,
): number | undefined {
  const point = document.caretRangeFromPoint?.(x, y);
  if (!point) return undefined;
  if (!block.contains(point.startContainer)) return undefined;
  const range = document.createRange();
  range.selectNodeContents(block);
  try {
    range.setEnd(point.startContainer, point.startOffset);
  } catch {
    return undefined;
  }
  return sourceOffsetForVisible(source, range.toString().length);
}

/** The first image on a paste or a drop, or null when the gesture carries none. */
function firstImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of data.files) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

export type LiveMarkdownEditorProps = {
  /** The note's markdown. The caller owns it; this component never holds a draft. */
  value: string;
  /** Called with the whole note after every edit — there is no separate save step. */
  onChange: (next: string) => void;
  /** Media inside a block resolves against this slug. */
  slug: string;
  ariaLabel: string;
  /**
   * What an empty paragraph says. A page that passes nothing prints nothing: a
   * blank line in the note is a blank line on the page, and a placeholder on an
   * empty page is printed once, not once per blank paragraph.
   */
  placeholder?: string;
  testId?: string;
  /** Open the caret on an empty note: an empty page is an invitation to write. */
  autoFocusEmpty?: boolean;
  /** Read the note and never write it: a locked document. */
  readOnly?: boolean;
  /**
   * A file pasted or dropped on the box. Returns the markdown to put at the caret,
   * or null for "saved, but nothing to insert".
   */
  onInsertFile?: (file: File) => Promise<string | null>;
  /** Layout the host wants on the box itself. */
  className?: string;
};

export function LiveMarkdownEditor({
  value,
  onChange,
  slug,
  ariaLabel,
  placeholder,
  testId,
  autoFocusEmpty = false,
  readOnly = false,
  onInsertFile,
  className,
}: LiveMarkdownEditorProps) {
  const [blocks, setBlocks] = useState<string[]>(() => parseBlocks(value));
  const [editing, setEditing] = useState<number | null>(null);
  // Bumped whenever the caret must be placed by hand rather than by the browser.
  const [focusTick, setFocusTick] = useState(0);

  const area = useRef<HTMLTextAreaElement | null>(null);
  const caret = useRef<number | null>(null);
  const emitted = useRef(value);
  const blocksRef = useRef(blocks);
  const editingRef = useRef<number | null>(null);
  const autoFocused = useRef(false);

  // Declared first: the effects below read the blocks through this mirror, and
  // effects run in order.
  useEffect(() => {
    blocksRef.current = blocks;
    editingRef.current = editing;
  });

  const emit = useCallback(
    (next: string[]) => {
      blocksRef.current = next;
      setBlocks(next);
      const serialized = serializeBlocks(next);
      emitted.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  // A value that did not come from this component is the file talking: a day was
  // opened, or a save came back with the vault's own normalization. The file is
  // the truth, so the blocks are rebuilt from it and the caret leaves.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const next = parseBlocks(value);
    setBlocks((current) => (sameBlocks(current, next) ? current : next));
    setEditing((current) =>
      current !== null && sameBlocks(blocksRef.current, next) ? current : null,
    );
  }, [value]);

  useEffect(() => {
    if (!autoFocusEmpty || autoFocused.current || readOnly) return;
    if (blocks.length !== 1 || blocks[0]!.trim() !== "") return;
    autoFocused.current = true;
    caret.current = 0;
    setEditing(0);
  }, [autoFocusEmpty, blocks, readOnly]);

  // A document that locks while its line is open closes the line: there is no
  // writing surface on a locked document at all, rather than a disabled one.
  useEffect(() => {
    if (readOnly) setEditing(null);
  }, [readOnly]);

  useLayoutEffect(() => {
    if (editing === null) return;
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const at = caret.current ?? el.value.length;
    caret.current = null;
    el.setSelectionRange(at, at);
  }, [editing, focusTick]);

  // The box is one continuous page: the writing line is exactly as tall as what
  // is written in it, so the swap between rendered and raw never moves the text.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  /**
   * The block just left keeps whatever it was typed as; the note is re-cut from
   * it, so trailing blank lines become the blank lines markdown already had.
   */
  const settle = useCallback((): string[] => {
    const normalized = parseBlocks(serializeBlocks(blocksRef.current));
    if (!sameBlocks(blocksRef.current, normalized)) emit(normalized);
    return blocksRef.current;
  }, [emit]);

  const beginEdit = useCallback(
    (index: number, at?: number, match?: string) => {
      if (readOnly) return;
      const current = settle();
      // Blocks can be re-cut by settling (a blank line typed into the open one
      // splits it), so the paragraph is found by its own text when it is known.
      let target = index;
      if (match !== undefined) {
        const found = current.indexOf(match);
        if (found !== -1) target = found;
      }
      caret.current = at ?? null;
      setEditing(Math.max(0, Math.min(target, current.length - 1)));
      setFocusTick((tick) => tick + 1);
    },
    [readOnly, settle],
  );

  const endEdit = useCallback(() => {
    settle();
    setEditing(null);
  }, [settle]);

  const replaceInBlock = useCallback(
    (index: number, text: string) => {
      const next = [...blocksRef.current];
      next[index] = text;
      emit(next);
    },
    [emit],
  );

  /** End this block here and open the next one: a paragraph break is a new block. */
  const splitBlock = useCallback(
    (index: number, before: string, after: string) => {
      const next = [...blocksRef.current];
      next.splice(index, 1, before, after);
      emit(next);
      caret.current = 0;
      setEditing(index + 1);
      setFocusTick((tick) => tick + 1);
    },
    [emit],
  );

  const onInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (editing === null) return;
    replaceInBlock(editing, event.target.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (editing === null) return;
    const text = el.value;
    const index = editing;

    // The formatting keys, which are the ones an operator arrives with from
    // Obsidian: Ctrl/Cmd+B, I and U for the inline marks, and Ctrl/Cmd+1..6 for
    // a heading on the caret's own line (0 puts it back to prose). They only
    // claim the keystroke when nothing else is held, so Ctrl+Shift+... stays
    // whatever the platform means by it.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      const mark = key === "b" ? MARKS.b : key === "i" ? MARKS.i : key === "u" ? MARKS.u : null;
      if (mark) {
        event.preventDefault();
        applyMark(el, mark);
        return;
      }
      if (/^[0-6]$/.test(event.key)) {
        event.preventDefault();
        applyHeading(el, Number.parseInt(event.key, 10));
        return;
      }
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      // Inside a fence, Enter is a newline: a code block is one block.
      if (insideFence(text, el.selectionStart)) return;
      const line = lineAround(text, el.selectionStart);
      const item = LIST_ITEM.exec(line.text);
      if (item) {
        const [, indent, marker, rest] = item;
        if (rest!.trim() !== "") {
          // The list continues, inside this block: one list stays one block.
          event.preventDefault();
          const next = /^\d+\.$/.test(marker!)
            ? `${Number.parseInt(marker!, 10) + 1}.`
            : marker!;
          el.setRangeText(
            `\n${indent}${next} `,
            el.selectionStart,
            el.selectionEnd,
            "end",
          );
          // setRangeText writes the DOM without an event; React needs telling.
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        // Enter on an empty item leaves the list instead of growing it.
        event.preventDefault();
        splitBlock(index, text.slice(0, line.start).replace(/\n+$/, ""), "");
        return;
      }
      event.preventDefault();
      splitBlock(index, text.slice(0, el.selectionStart), text.slice(el.selectionEnd));
      return;
    }

    if (
      event.key === "Backspace" &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0 &&
      index > 0
    ) {
      // Backspace at the very start deletes the blank line above: the two blocks
      // become one, exactly as they would in the raw file.
      event.preventDefault();
      const previous = blocksRef.current[index - 1] ?? "";
      const next = [...blocksRef.current];
      next.splice(index - 1, 2, `${previous}\n${text}`);
      emit(next);
      caret.current = previous.length;
      setEditing(index - 1);
      setFocusTick((tick) => tick + 1);
      return;
    }

    if (event.key === "ArrowUp" && index > 0 && onFirstLine(text, el.selectionStart)) {
      event.preventDefault();
      beginEdit(index - 1);
      return;
    }
    if (
      event.key === "ArrowDown" &&
      index < blocks.length - 1 &&
      onLastLine(text, el.selectionEnd)
    ) {
      event.preventDefault();
      beginEdit(index + 1, 0);
    }
  };

  const onBlockMouseDown = (index: number) => (event: ReactMouseEvent<HTMLDivElement>) => {
    // A locked note is read, not activated: the press is left alone so the
    // operator can still select the prose and copy it.
    if (readOnly || event.button !== 0 || editing === index) return;
    // No blur fires for this click: the block left behind is settled here, so the
    // pointer never races a re-render to reach the block it aimed at.
    event.preventDefault();
    const source = blocksRef.current[index] ?? "";
    beginEdit(
      index,
      sourceOffsetAt(event.clientX, event.clientY, event.currentTarget, source),
      source,
    );
  };

  /** The empty room under the last line is the way to start the next paragraph. */
  const onBoxMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-note-block]")) return;
    event.preventDefault();
    const last = blocksRef.current.length - 1;
    if (last >= 0 && blocksRef.current[last]!.trim() === "") {
      beginEdit(last, 0);
      return;
    }
    const next = [...blocksRef.current, ""];
    emit(next);
    caret.current = 0;
    setEditing(next.length - 1);
    setFocusTick((tick) => tick + 1);
  };

  const onBlockKeyDown = (index: number) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    beginEdit(index, 0);
  };

  /** Put an image where the gesture landed, once the host has saved it. */
  const takeFile = async (
    file: File,
    index: number | null,
    start: number,
    end: number,
  ): Promise<void> => {
    if (!onInsertFile) return;
    const markdown = await onInsertFile(file);
    if (markdown === null) return;
    const node = area.current;
    if (node && index !== null) {
      // The operator may have moved on while the file was being written: the
      // caret is only honoured if it is still the line the file was dropped on.
      const from = index === editingRef.current ? Math.min(start, node.value.length) : node.value.length;
      const to = index === editingRef.current ? Math.min(Math.max(end, from), node.value.length) : from;
      node.focus();
      node.setRangeText(markdown, from, to, "end");
      node.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // No line is open: the image becomes a paragraph of its own, in the place a
    // paragraph would have gone.
    const next = [...blocksRef.current];
    const last = next.length - 1;
    if (last >= 0 && next[last]!.trim() === "") next[last] = markdown;
    else next.push(markdown);
    emit(next);
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const file = firstImageFile(event.clipboardData);
    if (!file || !onInsertFile) return;
    event.preventDefault();
    const node = area.current;
    void takeFile(file, editingRef.current, node?.selectionStart ?? 0, node?.selectionEnd ?? 0);
  };

  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const file = firstImageFile(event.dataTransfer);
    if (!file || !onInsertFile) return;
    event.preventDefault();
    const node = area.current;
    void takeFile(file, editingRef.current, node?.selectionStart ?? 0, node?.selectionEnd ?? 0);
  };

  return (
    <div
      className={className ? `note-live ${className}` : "note-live"}
      data-testid={testId}
      data-read-only={readOnly ? "true" : undefined}
      onMouseDown={onBoxMouseDown}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={(event) => {
        if (!readOnly && onInsertFile) event.preventDefault();
      }}
    >
      <div className="note-live__prose">
        {blocks.map((block, index) =>
          index === editing ? (
            <div className="note-live__block" data-note-block={index} key={index}>
              <textarea
                ref={area}
                className="note-live__input"
                data-testid={testId ? `${testId}-input` : undefined}
                value={block}
                rows={1}
                spellCheck
                aria-label={ariaLabel}
                placeholder={placeholder}
                onChange={onInput}
                onKeyDown={onKeyDown}
                onBlur={endEdit}
              />
            </div>
          ) : (
            <div
              className="note-live__block"
              data-note-block={index}
              key={index}
              tabIndex={readOnly ? undefined : 0}
              onMouseDown={onBlockMouseDown(index)}
              onKeyDown={onBlockKeyDown(index)}
            >
              {block.trim() === "" ? (
                // An empty paragraph is a blank line, and it draws as one: the
                // operator typed it, the file holds it, and it has to be visible
                // or the thing they just did looks like it did nothing. The LAST
                // block is the exception — it is the empty line under the note
                // waiting to be written, and a trailing blank line is not prose,
                // so it prints the placeholder or nothing at all.
                index === blocks.length - 1 ? (
                  placeholder ? (
                    <p className="note-live__placeholder">{placeholder}</p>
                  ) : null
                ) : (
                  <p className="note-live__blank" aria-hidden="true" />
                )
              ) : (
                <MarkdownView markdown={block} slug={slug} />
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
