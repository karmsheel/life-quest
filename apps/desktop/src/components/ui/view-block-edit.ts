import type {
  DatabaseMeta,
  SavedView,
  ViewBlock,
  ViewPresentation,
} from "@lifequest/vault-core";

/**
 * Changing how one block of a dashboard card is displayed, without breaking it.
 *
 * The four presentations do not take the same query. A metric is one number and
 * must not group; a table and a bar need a groupBy; a line needs a date groupBy
 * with a timeBucket. So "make this a bar chart" is not a relabel — it is a
 * retarget of the block's query, and doing it by hand in a form is how an
 * operator ends up with a card that refuses to draw.
 *
 * This is the one place that knows how to move a block between presentations. It
 * answers `null` when the move cannot be expressed against the database at all
 * (a line with no date column to group by), which is what lets the card offer
 * only the switches that will actually work.
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
  return "Line";
}

function columnsOfType(db: DatabaseMeta | null, type: string): string[] {
  return (db?.columns ?? []).filter((c) => c.type === type).map((c) => c.id);
}

/**
 * The same block, aimed at another presentation — or null when the database
 * cannot express it.
 *
 * The rule is "change as little as possible": an existing groupBy and timeBucket
 * are kept whenever the target allows them, so switching a weekly table to a bar
 * chart keeps the weeks, and switching back to a table returns the operator to
 * exactly what they had.
 */
export function retargetBlock(
  block: ViewBlock,
  target: ViewPresentation,
  db: DatabaseMeta | null,
): ViewBlock | null {
  const dateColumns = columnsOfType(db, "date");
  const groupable = (db?.columns ?? []).filter(
    (c) => c.type === "select" || c.type === "relation" || c.type === "text",
  ).map((c) => c.id);

  // Which column this block groups by now, and whether it is a date.
  const current = block.groupBy ?? null;
  const currentIsDate = current !== null && dateColumns.includes(current);

  /** The date column a window or a line should act on. */
  const dateFor = (): string | null =>
    (block.timeColumnId && dateColumns.includes(block.timeColumnId)
      ? block.timeColumnId
      : null) ??
    (currentIsDate ? current : null) ??
    dateColumns[0] ??
    null;

  if (target === "metric") {
    // One number for the whole window: no grouping at all.
    return { ...block, presentation: "metric", groupBy: null, timeBucket: null };
  }

  if (target === "line") {
    // A line's x-axis is time, so it needs a date to group by and a bucket to
    // collapse it into points. A block that already groups by a date keeps its
    // bucket; one that does not takes the first date column the database has.
    const groupBy = currentIsDate ? current : dateFor();
    if (groupBy === null) return null;
    const timeBucket = block.timeBucket ?? "month";
    return {
      ...block,
      presentation: "line",
      groupBy,
      timeBucket,
      // A window is only honoured when the block names the column it acts on.
      timeColumnId: block.timeWindow == null || block.timeWindow === "all"
        ? block.timeColumnId
        : (block.timeColumnId ?? groupBy),
    };
  }

  // table | bar: grouped, but not necessarily by time.
  const groupBy = current ?? dateFor() ?? groupable[0] ?? null;
  if (groupBy === null) return null;
  const groupIsDate = dateColumns.includes(groupBy);
  const timeBucket = groupIsDate ? (block.timeBucket ?? null) : null;
  return {
    ...block,
    presentation: target,
    groupBy,
    timeBucket,
    timeColumnId: block.timeWindow == null || block.timeWindow === "all"
      ? (groupIsDate ? groupBy : block.timeColumnId)
      : (block.timeColumnId ?? (groupIsDate ? groupBy : null)),
  };
}

/** Every presentation this block could be switched to, itself included. */
export function availablePresentations(
  block: ViewBlock,
  db: DatabaseMeta | null,
): ViewPresentation[] {
  return BLOCK_PRESENTATIONS.filter((p) => retargetBlock(block, p, db) !== null);
}

/**
 * The spec to save after one block's presentation changed.
 *
 * A composed card keeps its root query fields — they are the defaults its other
 * blocks inherit — and only the named block moves. A single-aggregate card has no
 * blocks, so the root fields themselves are the block that moved.
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
    if (!next) return { ok: false, error: `This database cannot draw a ${target} here.` };
    const nextBlocks = blocks.map((b, i) => (i === index ? next : b));
    return { ok: true, spec: { ...strippedSpec(view), blocks: nextBlocks } };
  }
  // One-aggregate view: the root query fields ARE the block.
  const root = { ...(view as unknown as ViewBlock), id: blockId, title: view.title };
  const next = retargetBlock(root, target, db);
  if (!next) return { ok: false, error: `This database cannot draw a ${target} here.` };
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
