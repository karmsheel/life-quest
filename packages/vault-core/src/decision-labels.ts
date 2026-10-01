/**
 * Read-time display labels for a Decision body.
 *
 * A database Decision body carries the write payload verbatim, and for a
 * relation column that payload is the target row's id — `47083ecb-…` where the
 * operator needs to read "Groceries". The propose path already resolves a label
 * for the title; this resolves the same labels for the cells.
 *
 * Resolved on read rather than baked in at propose time for two reasons: a
 * Decision filed before this existed renders the same way, and a category the
 * operator renamed since shows the name it has now. Nothing here writes — the
 * stored file keeps the raw payload the apply path uses.
 */
import { cellDisplayLabels, getDatabase } from "./domain-databases.ts";
import type { DatabaseDecisionBody, DecisionRecord } from "./types.ts";

type LabelCache = Map<string, string | null>;

/**
 * Return the same decisions with `cellLabels` / `previousCellLabels` filled in
 * where the vault can answer for a raw id, plus `relationDatabaseName` for an
 * add-column proposal. A body that needs nothing keeps its exact stored text,
 * so the inbox's "Exact proposal" view stays byte-identical to the file.
 */
export async function withDecisionCellLabels(
  root: string,
  decisions: DecisionRecord[],
  cache: LabelCache = new Map(),
): Promise<DecisionRecord[]> {
  const out: DecisionRecord[] = [];
  for (const decision of decisions) {
    out.push(await withLabels(root, decision, cache));
  }
  return out;
}

async function withLabels(
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

  const added: Partial<DatabaseDecisionBody> = {};
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

function parseBody(text: string): DatabaseDecisionBody | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const body = parsed as DatabaseDecisionBody;
    return typeof body.op === "string" ? body : null;
  } catch {
    return null;
  }
}

function asCellMap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
