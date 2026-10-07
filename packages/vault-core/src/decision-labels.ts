/**
 * Read-time display labels for a Decision body.
 *
 * A Decision body carries the write payload verbatim, and that payload names its
 * data by id: a relation cell holds the target row's id (`47083ecb-…` where the
 * operator needs to read "Groceries"), a page block holds the database and column
 * ids it is bound to, and a mapping holds the column ids it maps onto. The
 * propose path already resolves a label for the title; this resolves the same
 * labels for everything the body shows.
 *
 * Resolved on read rather than baked in at propose time for two reasons: a
 * Decision filed before this existed renders the same way, and a category or
 * column the operator renamed since shows the name it has now. Nothing here
 * writes — the stored file keeps the raw payload the apply path uses, which is
 * why every resolved name is a *sibling* field (`cellLabels`, `databaseName`,
 * `columnName`, …) and never replaces the id.
 */
import { FINANCE_DB_IDS, type DatabaseMeta, type DecisionRecord } from "./types.ts";
import { cellDisplayLabels, getDatabase, getRow, rowDisplayLabel } from "./domain-databases.ts";

type LabelCache = Map<string, string | null>;
type MetaCache = Map<string, DatabaseMeta | null>;

/** A block's id field paired with the name field this module adds for it. */
const BLOCK_COLUMN_FIELDS = [
  ["columnId", "columnName"],
  ["xColumnId", "xColumnName"],
  ["yColumnId", "yColumnName"],
] as const;

/**
 * Return the same decisions with display names filled in where the vault can
 * answer for a raw id: `cellLabels` / `previousCellLabels` for a row write,
 * `relationDatabaseName` for an add-column proposal, per-block names for a page,
 * and `databaseName` + `columnName` for a mapping. A body that needs nothing
 * keeps its exact stored text, so the inbox's "Exact proposal" view stays
 * byte-identical to the file.
 */
export async function withDecisionDisplayLabels(
  root: string,
  decisions: DecisionRecord[],
  cache: LabelCache = new Map(),
): Promise<DecisionRecord[]> {
  // Databases are re-read per reference: a page's blocks and a batch of row
  // writes touch the same database over and over, and the registry is a file.
  const metas: MetaCache = new Map();
  const out: DecisionRecord[] = [];
  for (const decision of decisions) {
    out.push(await withLabels(root, decision, cache, metas));
  }
  return out;
}

async function withLabels(
  root: string,
  decision: DecisionRecord,
  cache: LabelCache,
  metas: MetaCache,
): Promise<DecisionRecord> {
  const { target } = decision;
  if (target.type === "database-row" || target.type === "database") {
    return withDatabaseLabels(root, decision, cache);
  }
  if (target.type === "page") {
    return withPageBlockNames(root, decision, target.domainSlug, metas);
  }
  if (target.type === "mapping") {
    return withMappingNames(root, decision, target.domainSlug, metas);
  }
  return decision;
}

async function withDatabaseLabels(
  root: string,
  decision: DecisionRecord,
  cache: LabelCache,
): Promise<DecisionRecord> {
  const { target } = decision;
  if (target.type !== "database-row" && target.type !== "database") return decision;

  const body = parseBody(decision.proposedBodyMarkdown);
  if (!body) return decision;

  const db = await getDatabase(root, target.domainSlug, target.databaseId);
  if (!db.ok) return decision;

  const added: Record<string, unknown> = {};
  if (body.op === "upsert" || body.op === "delete") {
    const cells = await cellDisplayLabels(
      root,
      target.domainSlug,
      db.value,
      asCellMap(body.cells),
      cache,
    );
    const previous = await cellDisplayLabels(
      root,
      target.domainSlug,
      db.value,
      asCellMap(body.previousCells),
      cache,
    );
    if (Object.keys(cells).length > 0) added.cellLabels = cells;
    if (Object.keys(previous).length > 0) added.previousCellLabels = previous;
  } else if (body.op === "add-column" && typeof body.relationDatabaseId === "string") {
    const relation = await getDatabase(root, target.domainSlug, body.relationDatabaseId);
    if (relation.ok) added.relationDatabaseName = relation.value.name;
  }

  if (Object.keys(added).length === 0) return decision;
  return {
    ...decision,
    proposedBodyMarkdown: JSON.stringify({ ...body, ...added }, null, 2),
  };
}

/**
 * A page block names its data by id — the database it is bound to, the columns
 * it groups and sums, the assumption set it compares. None of that is readable
 * as an id, so each unresolved-looking reference gains a name sibling. The ids
 * stay where they are: the page file is written from this body on approve.
 */
async function withPageBlockNames(
  root: string,
  decision: DecisionRecord,
  domainSlug: string,
  metas: MetaCache,
): Promise<DecisionRecord> {
  const body = parseJsonObject(decision.proposedBodyMarkdown);
  if (!body || !Array.isArray(body.blocks)) return decision;

  let named = false;
  const blocks: unknown[] = [];
  for (const block of body.blocks) {
    if (!isRecord(block)) {
      blocks.push(block);
      continue;
    }
    const names = await blockNames(root, domainSlug, block, metas);
    if (Object.keys(names).length === 0) {
      blocks.push(block);
      continue;
    }
    blocks.push({ ...block, ...names });
    named = true;
  }

  if (!named) return decision;
  return { ...decision, proposedBodyMarkdown: JSON.stringify({ ...body, blocks }, null, 2) };
}

/** The name siblings for one block: its database, its columns, its assumption set. */
async function blockNames(
  root: string,
  domainSlug: string,
  block: Record<string, unknown>,
  metas: MetaCache,
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const databaseId = typeof block.databaseId === "string" ? block.databaseId : "";
  const meta = databaseId ? await databaseMeta(root, domainSlug, databaseId, metas) : null;
  if (meta) names.databaseName = meta.name;

  // A block's columns belong to the block's own database (validateBlocks checks
  // exactly that), so one registry read answers all of them.
  for (const [idField, nameField] of BLOCK_COLUMN_FIELDS) {
    const id = block[idField];
    if (typeof id !== "string" || !id) continue;
    const column = meta?.columns.find((c) => c.id === id);
    if (column) names[nameField] = column.name;
  }

  for (const [idField, nameField] of [
    ["assumptionSetId", "assumptionSetName"],
    ["compareSetId", "compareSetName"],
  ] as const) {
    const id = block[idField];
    if (typeof id !== "string" || !id) continue;
    const name = await assumptionSetName(root, domainSlug, id, metas);
    if (name) names[nameField] = name;
  }

  return names;
}

/** An assumption set is a row in the finance kit's assumption-sets database. */
async function assumptionSetName(
  root: string,
  domainSlug: string,
  rowId: string,
  metas: MetaCache,
): Promise<string | null> {
  const meta = await databaseMeta(root, domainSlug, FINANCE_DB_IDS.assumptionSets, metas);
  if (!meta) return null;
  const row = await getRow(root, domainSlug, meta.id, rowId);
  if (!row.ok) return null;
  const label = rowDisplayLabel(meta, row.value.cells).trim();
  return label ? label : null;
}

/**
 * A mapping names the database it writes into and a column id per incoming
 * source column. The mapping file is written from this body on approve, so the
 * ids stay and the names are added beside them.
 */
async function withMappingNames(
  root: string,
  decision: DecisionRecord,
  domainSlug: string,
  metas: MetaCache,
): Promise<DecisionRecord> {
  const body = parseJsonObject(decision.proposedBodyMarkdown);
  if (!body || typeof body.databaseId !== "string" || !body.databaseId) return decision;

  const meta = await databaseMeta(root, domainSlug, body.databaseId, metas);
  if (!meta) return decision;

  const columns = Array.isArray(body.columns) ? body.columns : null;
  const mapped = columns?.map((column) => {
    if (!isRecord(column)) return column;
    const id = typeof column.columnId === "string" ? column.columnId : "";
    if (!id) return column;
    const name = meta.columns.find((c) => c.id === id)?.name;
    return name ? { ...column, columnName: name } : column;
  });

  return {
    ...decision,
    proposedBodyMarkdown: JSON.stringify(
      { ...body, databaseName: meta.name, ...(mapped ? { columns: mapped } : {}) },
      null,
      2,
    ),
  };
}

/** The registry entry for a database in this domain, or null if it has none. */
async function databaseMeta(
  root: string,
  domainSlug: string,
  databaseId: string,
  metas: MetaCache,
): Promise<DatabaseMeta | null> {
  const key = `${domainSlug}\u0000${databaseId}`;
  const cached = metas.get(key);
  if (cached !== undefined) return cached;
  const db = await getDatabase(root, domainSlug, databaseId);
  const meta = db.ok ? db.value : null;
  metas.set(key, meta);
  return meta;
}

/** A decision body that is a JSON object without an `op` (page, mapping, pins). */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBody(text: string): Record<string, unknown> | null {
  const body = parseJsonObject(text);
  return body && typeof body.op === "string" ? body : null;
}

function asCellMap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
