/**
 * Read-time display labels for a Decision body.
 *
 * A Decision body carries the write payload verbatim, and that payload names its
 * data by id: a relation cell holds the target row's id (`47083ecb-…` where the
 * operator needs to read "Groceries"), a cell map is keyed by column id (so the
 * card's "Field" column reads `8f3d2b41…` for every column added through
 * add_column), a view spec names the columns it measures and groups by, a page
 * block holds the database and column ids it is bound to, and a mapping holds
 * the column ids it maps onto. The propose path already resolves a label for the
 * title; this resolves the same labels for everything the body shows.
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

/**
 * How many Decisions are labelled at once.
 *
 * The inbox labels every Decision it lists, not just the pending ones, and a
 * real vault holds ~800 of them: resolving them one at a time made the display
 * pass cost about a second on the operator's vault. The reads behind a label
 * (a registry file, a row in SQLite) are independent per Decision, so a bounded
 * batch overlaps their I/O. It stays bounded because each database-row decision
 * can open SQLite, and the pass runs in the same process as the app's IPC.
 */
const LABEL_CONCURRENCY = 8;

/**
 * Run `run` over `items` with at most `limit` in flight, preserving order.
 *
 * Local to this file for the same reason `listDecisions` has its own copy: it is
 * a dozen lines, the repo takes no dependency for it, and the two files are read
 * together. The result lands at the item's index, so the labelled array is in
 * exactly the order the inbox was handed.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await run(items[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

/** A block's id field paired with the name field this module adds for it. */
const BLOCK_COLUMN_FIELDS = [
  ["columnId", "columnName"],
  ["xColumnId", "xColumnName"],
  ["yColumnId", "yColumnName"],
] as const;

/**
 * Return the same decisions with display names filled in where the vault can
 * answer for a raw id: `cellLabels` / `previousCellLabels` for a row write,
 * `columnNames` for the field keys those cell maps carry, `relationDatabaseName`
 * for an add-column proposal, per-block names for a page, and `databaseName` +
 * `columnName` for a mapping. A body that needs nothing keeps its exact stored
 * text, so the inbox's "Exact proposal" view stays byte-identical to the file.
 */
export async function withDecisionDisplayLabels(
  root: string,
  decisions: DecisionRecord[],
  cache: LabelCache = new Map(),
): Promise<DecisionRecord[]> {
  // Databases are re-read per reference: a page's blocks and a batch of row
  // writes touch the same database over and over, and the registry is a file.
  // Both maps are shared by every decision in the batch, which is what makes
  // the concurrency below a win rather than the same reads repeated in parallel:
  // a vault's hundreds of Decisions name a handful of databases, and the first
  // one to resolve a key fills the map for the rest. Two workers can still miss
  // the same key at the same moment and read it twice; that is a wasted read,
  // never a different answer, because both reads ask the same file for the same
  // name. Guarding the in-flight key would mean caching promises, which is more
  // machinery than a duplicate registry read is worth.
  const metas: MetaCache = new Map();
  return mapLimit(decisions, LABEL_CONCURRENCY, (decision) =>
    withLabels(root, decision, cache, metas),
  );
}

async function withLabels(
  root: string,
  decision: DecisionRecord,
  cache: LabelCache,
  metas: MetaCache,
): Promise<DecisionRecord> {
  const { target } = decision;
  if (target.type === "database-row" || target.type === "database") {
    return withDatabaseLabels(root, decision, cache, metas);
  }
  if (target.type === "database-batch") {
    return withBatchLabels(root, decision, target.domainSlug, target.databaseId, cache);
  }
  if (target.type === "page") {
    return withPageBlockNames(root, decision, target.domainSlug, metas);
  }
  if (target.type === "mapping") {
    return withMappingNames(root, decision, target.domainSlug, metas);
  }
  if (target.type === "view") {
    return withViewNames(root, decision, target.domainSlug, metas);
  }
  return decision;
}

async function withDatabaseLabels(
  root: string,
  decision: DecisionRecord,
  cache: LabelCache,
  metas: MetaCache,
): Promise<DecisionRecord> {
  const { target } = decision;
  if (target.type !== "database-row" && target.type !== "database") return decision;

  const body = parseBody(decision.proposedBodyMarkdown);
  if (!body) return decision;

  // Through the shared MetaCache rather than `getDatabase` directly: the
  // registry is a file and an inbox of hundreds of Decisions names the same few
  // databases, so this is the read that was repeated most.
  const meta = await databaseMeta(root, target.domainSlug, target.databaseId, metas);
  if (!meta) return decision;

  const added: Record<string, unknown> = {};
  if (body.op === "upsert" || body.op === "delete") {
    const cells = await cellDisplayLabels(
      root,
      target.domainSlug,
      meta,
      asCellMap(body.cells),
      cache,
    );
    const previous = await cellDisplayLabels(
      root,
      target.domainSlug,
      meta,
      asCellMap(body.previousCells),
      cache,
    );
    if (Object.keys(cells).length > 0) added.cellLabels = cells;
    if (Object.keys(previous).length > 0) added.previousCellLabels = previous;
    // The table's "Field" column is the cell map's KEY, i.e. the column id.
    // An id minted by add_column is a uuid, so the body carries the names
    // beside the ids exactly as it carries relation labels beside cell values.
    const names = columnNamesFor(meta, [asCellMap(body.cells), asCellMap(body.previousCells)]);
    if (Object.keys(names).length > 0) added.columnNames = names;
  } else if (body.op === "add-column" && typeof body.relationDatabaseId === "string") {
    const relation = await databaseMeta(
      root,
      target.domainSlug,
      body.relationDatabaseId,
      metas,
    );
    if (relation) added.relationDatabaseName = relation.name;
  } else if (body.op === "delete-database" || body.op === "merge-databases") {
    // A lifecycle card names the doomed database (a delete) or the surviving
    // target (a merge) as prose, and a merge also names every source it removes.
    // Refresh those names from the registry so a rename since the card was filed
    // reads as the operator's current name — the ids beside them stay exactly as
    // stored, because the apply path writes from them. A name that no longer
    // resolves keeps the one the proposal recorded: a source that is already
    // gone is history, not a name to invent.
    if (typeof body.databaseName !== "string" || body.databaseName !== meta.name) {
      added.databaseName = meta.name;
    }
    if (body.op === "merge-databases" && Array.isArray(body.sources)) {
      const refreshed: unknown[] = [];
      let renamed = false;
      for (const source of body.sources) {
        if (!isRecord(source) || typeof source.databaseId !== "string") {
          refreshed.push(source);
          continue;
        }
        const sourceMeta = await databaseMeta(
          root,
          target.domainSlug,
          source.databaseId,
          metas,
        );
        if (!sourceMeta || sourceMeta.name === source.name) {
          refreshed.push(source);
          continue;
        }
        refreshed.push({ ...source, name: sourceMeta.name });
        renamed = true;
      }
      if (renamed) added.sources = refreshed;
    }
  }

  if (Object.keys(added).length === 0) return decision;
  return {
    ...decision,
    proposedBodyMarkdown: JSON.stringify({ ...body, ...added }, null, 2),
  };
}

/**
 * A batch insert's rows are new rows, so each row's relation cell holds the same
 * target row id a single-row write's does — and an id is not what the operator
 * reads. Every row gains its own `cellLabels`, the sibling the row write gets, so
 * the card's per-row table shows the name while the cell keeps the id behind it.
 * The database comes from the target, not the body: a batch body names none.
 */
async function withBatchLabels(
  root: string,
  decision: DecisionRecord,
  domainSlug: string,
  databaseId: string,
  cache: LabelCache,
): Promise<DecisionRecord> {
  const body = parseBody(decision.proposedBodyMarkdown);
  if (!body || body.op !== "insert-rows" || !Array.isArray(body.rows)) return decision;

  const db = await getDatabase(root, domainSlug, databaseId);
  if (!db.ok) return decision;

  let labelled = false;
  const rows: unknown[] = [];
  const cellMaps: Array<Record<string, unknown> | null> = [];
  for (const row of body.rows) {
    if (!isRecord(row)) {
      rows.push(row);
      continue;
    }
    const cells = asCellMap(row.cells);
    cellMaps.push(cells);
    const labels = await cellDisplayLabels(root, domainSlug, db.value, cells, cache);
    if (Object.keys(labels).length === 0) {
      rows.push(row);
      continue;
    }
    rows.push({ ...row, cellLabels: labels });
    labelled = true;
  }

  // The field keys are shared by every row of the batch: one database, one
  // column id per field. The names live on the body, not on each row.
  const names = columnNamesFor(db.value, cellMaps);
  if (Object.keys(names).length > 0) labelled = true;

  if (!labelled) return decision;
  return {
    ...decision,
    proposedBodyMarkdown: JSON.stringify(
      { ...body, rows, ...(Object.keys(names).length > 0 ? { columnNames: names } : {}) },
      null,
      2,
    ),
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
async function blockNames(  root: string,
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

/**
 * A dashboard-view Decision carries the spec that will be saved: a database plus
 * the column ids its measures, grouping, window and listing name. The card's
 * "Measure" and "Group by" rows are the operator's only description of the card
 * they are approving, so each id gains the column name directly beside it. The
 * spec is written from the stored body on approve; these are read-time siblings.
 */
const VIEW_COLUMN_FIELDS = [
  ["measureColumnId", "measureColumnName"],
  ["groupBy", "groupByName"],
  ["timeColumnId", "timeColumnName"],
] as const;

async function withViewNames(
  root: string,
  decision: DecisionRecord,
  domainSlug: string,
  metas: MetaCache,
): Promise<DecisionRecord> {
  const body = parseJsonObject(decision.proposedBodyMarkdown);
  if (!body || !isRecord(body.spec)) return decision;
  const spec = body.spec;
  const databaseId = typeof spec.databaseId === "string" ? spec.databaseId : "";
  if (!databaseId) return decision;

  const meta = await databaseMeta(root, domainSlug, databaseId, metas);
  if (!meta) return decision;

  const ids = new Set<string>();
  const names = viewQueryNames(meta, spec);
  collectViewColumnIds(spec, ids);

  const blocks = Array.isArray(spec.blocks) ? spec.blocks : null;
  const namedBlocks = blocks?.map((block) => {
    if (!isRecord(block)) return block;
    collectViewColumnIds(block, ids);
    const blockFieldNames = viewQueryNames(meta, block);
    return Object.keys(blockFieldNames).length > 0 ? { ...block, ...blockFieldNames } : block;
  });

  const columnNames = columnNameMapFor(meta, ids);
  const namedSpec: Record<string, unknown> = { ...spec, ...names };
  if (namedBlocks) namedSpec.blocks = namedBlocks;
  // `columnNames` is the whole-referenced-set map the card uses for a listing's
  // columns and a filter's column; the singular fields above name the two rows
  // the card prints as prose.
  if (Object.keys(columnNames).length > 0) namedSpec.columnNames = columnNames;

  if (Object.keys(names).length === 0 && Object.keys(columnNames).length === 0) return decision;
  return {
    ...decision,
    proposedBodyMarkdown: JSON.stringify({ ...body, spec: namedSpec }, null, 2),
  };
}

/** The name siblings a single view query names: its measure, grouping and window column. */
function viewQueryNames(
  meta: DatabaseMeta,
  query: Record<string, unknown>,
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [idField, nameField] of VIEW_COLUMN_FIELDS) {
    const id = query[idField];
    if (typeof id !== "string" || !id) continue;
    const name = columnNameFor(meta, id);
    if (name) names[nameField] = name;
  }
  return names;
}

/** Every column id a view query references, including a listing's columns and filters. */
function collectViewColumnIds(query: Record<string, unknown>, ids: Set<string>): void {
  for (const [idField] of VIEW_COLUMN_FIELDS) {
    const id = query[idField];
    if (typeof id === "string" && id) ids.add(id);
  }
  if (Array.isArray(query.columns)) {
    for (const id of query.columns) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  if (Array.isArray(query.filters)) {
    for (const filter of query.filters) {
      if (!isRecord(filter)) continue;
      if (typeof filter.columnId === "string" && filter.columnId) ids.add(filter.columnId);
    }
  }
}

/** The names for every cell-map key the body carries, keyed the same way. */
function columnNamesFor(
  meta: DatabaseMeta,
  cellMaps: Array<Record<string, unknown> | null>,
): Record<string, string> {
  const ids = new Set<string>();
  for (const cells of cellMaps) {
    if (!cells) continue;
    for (const id of Object.keys(cells)) ids.add(id);
  }
  return columnNameMapFor(meta, ids);
}

function columnNameMapFor(meta: DatabaseMeta, ids: Iterable<string>): Record<string, string> {
  const names: Record<string, string> = {};
  for (const id of ids) {
    const name = columnNameFor(meta, id);
    if (name) names[id] = name;
  }
  return names;
}

function columnNameFor(meta: DatabaseMeta, id: string): string | null {
  const name = meta.columns.find((column) => column.id === id)?.name.trim();
  return name ? name : null;
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
