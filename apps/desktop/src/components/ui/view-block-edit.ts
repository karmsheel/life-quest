import type {
  DatabaseMeta,
  SavedView,
  ViewBlock,
  ViewPresentation,
} from "@lifequest/vault-core";

/**
 * Changing how one object of a dashboard card is displayed.
 *
 * The rule that matters is the one this file used to get wrong: **a
 * presentation is a drawing, not a query.** The old implementation retargeted
 * the object's groupBy, timeBucket and measure to fit the chosen shape, so
 * pressing "Bar" on a one-number panel grouped it by the first date column and
 * pressing "Table" afterwards left a table of one row per transaction date —
 * the operator's "Spending by month" card came back with plain transactions and
 * no month totals. The card had not lost its numbers; its query had been
 * rewritten to ask a different question.
 *
 * So this is now a copy with one field changed. An object that cannot be drawn
 * the way the operator asked (a row listing cannot become a bar chart without
 * an aggregate; a period average is one number) is offered only the shapes it
 * can hold, and the query is never touched.
 */

/** The order the controls read in: least to most structured. */
export const BLOCK_PRESENTATIONS: readonly ViewPresentation[] = [
  "metric",
  "table",
  "bar",
  "line",
];

export function presentationLabel(presentation: ViewPresentation): string {
  if (presentation === "metric") return "Metric";
  if (presentation === "table") return "Table";
  if (presentation === "bar") return "Bar";
  if (presentation === "line") return "Line";
  return "List";
}

/** Whether an object prints rows rather than folding them. Mirrors vault-core. */
function isRowObject(block: ViewBlock): boolean {
  return (
    !block.from &&
    ((Array.isArray(block.columns) && block.columns.length > 0) || block.presentation === "list")
  );
}

/**
 * The ways this object can be drawn without changing what it holds.
 *
 * A row object has `list` and `table` — the same rows, two captions. An
 * aggregate has all four; a period average is already one number, so it keeps
 * the metric it is. Nothing here depends on the database's column types, which
 * is the point: a chart's x-axis is whatever the object grouped by.
 */
export function availablePresentations(
  block: ViewBlock,
  _db: DatabaseMeta | null = null,
): ViewPresentation[] {
  if (isRowObject(block)) return ["list", "table"];
  if (block.measure === "avg-per") return ["metric"];
  return [...BLOCK_PRESENTATIONS];
}

/**
 * The same block, drawn differently — or null when this object cannot be drawn
 * that way. Only `presentation` changes; every query field is carried over
 * untouched, which is what makes the tab row safe to press.
 */
export function retargetBlock(
  block: ViewBlock,
  target: ViewPresentation,
  db: DatabaseMeta | null = null,
): ViewBlock | null {
  if (!availablePresentations(block, db).includes(target)) return null;
  return { ...block, presentation: target };
}

/**
 * The spec to save after one object's presentation changed.
 *
 * A composed card keeps its root query fields — they are the defaults its other
 * objects inherit — and only the named block moves. A single-aggregate card has
 * no blocks, so the root fields themselves are the object that moved.
 */
export function applyPresentation(
  view: SavedView,
  blockId: string,
  target: ViewPresentation,
  db: DatabaseMeta | null,
): { ok: true; spec: Record<string, unknown> } | { ok: false; error: string } {
  const blocks = view.blocks;
  if (Array.isArray(blocks) && blocks.length > 0) {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index < 0) return { ok: false, error: `Block not found: ${blockId}` };
    const next = retargetBlock(blocks[index] as ViewBlock, target, db);
    if (!next) return { ok: false, error: `This object cannot be drawn as a ${target}.` };
    const nextBlocks = blocks.map((b, i) => (i === index ? next : b));
    return { ok: true, spec: { ...strippedSpec(view), blocks: nextBlocks } };
  }
  // One-aggregate view: the root query fields ARE the object.
  const root = { ...(view as unknown as ViewBlock), id: blockId, title: view.title };
  const next = retargetBlock(root, target, db);
  if (!next) return { ok: false, error: `This object cannot be drawn as a ${target}.` };
  const { id: _id, title: _title, span: _span, ...query } = next;
  return { ok: true, spec: { ...strippedSpec(view), ...query } };
}

/**
 * A saved view without the fields the file writer owns. Sending `id` and the
 * timestamps back would round-trip them into the written file, and `saveView`
 * already owns all three.
 */
function strippedSpec(view: SavedView): Record<string, unknown> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = view;
  return rest as unknown as Record<string, unknown>;
}
