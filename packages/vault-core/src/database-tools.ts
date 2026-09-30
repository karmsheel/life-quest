import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MapToolDef } from "./map/tools.ts";
import type {
  Actor,
  DatabaseBatchDecisionBody,
  DatabaseColumnType,
  DatabaseDecisionBody,
  DatabaseMeta,
} from "./types.ts";
import {
  DATABASE_COLUMN_TYPES,
  FINANCE_DB_IDS,
  FINANCE_DOMAIN_SLUG,
} from "./types.ts";
import {
  checkDatabaseCells,
  countRows,
  getDatabase,
  getRow,
  isDomainLive,
  listDatabases,
  listRows,
  validateRowCells,
} from "./domain-databases.ts";
import { listSyncConflicts } from "./adapters.ts";
import { listInstalledKits } from "./finance-kit.ts";
import { createDecision, listDecisions, resolveDecision } from "./decisions.ts";
import { readAutoApproveInserts } from "./agents.ts";
import { lookupExternalId } from "./ingest.ts";
import { vaultPaths } from "./paths.ts";

const INSERT_ROWS_MAX = 200;

/**
 * KAR-63: one generic tool set keyed on (domainSlug, databaseId), covering every
 * database in every live domain. Deliberately not one tool per finance database:
 * each kit install or hand-made database would need new MCP code, and the agent
 * would have to memorise a closed enum of ids.
 *
 * `required` is advisory documentation for the model only — mcp-server's buildShape
 * marks every property optional and never reads it, and the planner path passes raw
 * model JSON with no schema validation at all. All real validation happens in
 * executeDatabaseTool.
 *
 * No tool declares an `actor` parameter. The actor comes solely from executeTool's
 * actor argument; a model-controlled parameter is not an identity source.
 */
export const DATABASE_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_databases",
    description:
      "List every database in every live domain, plus the kits installed in each domain. Kits are " +
      "recorded per domain, so the kit field is always keyed by domain. Use this to discover " +
      "databases (e.g. finance:accounts) and to check whether the finance kit is installed. Returns " +
      "{ kits: [{ domainSlug, kits }], databases: [{ domainSlug, database }] }.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "Optional domain slug to limit results, e.g. 'financial'.",
        },
      },
    },
  },
  {
    name: "get_database",
    description:
      "Return the schema (column ids, names, types, options, relation targets) for one database. " +
      "Use this to learn the exact column ids before building a cells map.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
      },
      required: ["domainSlug", "databaseId"],
    },
  },
  {
    name: "list_rows",
    description:
      "List rows in a database with optional pagination. Results are ordered by createdAt then id. " +
      "No filtering is applied. Returns row ids and cell values keyed by column id.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        limit: { type: "number", description: "Max rows to return (default 100, max 500)." },
        offset: { type: "number", description: "Row offset for pagination (default 0)." },
      },
      required: ["domainSlug", "databaseId"],
    },
  },
  {
    name: "get_row",
    description: "Return one row by id, including its full cells map and updatedAt.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        id: { type: "string" },
      },
      required: ["domainSlug", "databaseId", "id"],
    },
  },
  {
    name: "list_decisions",
    description:
      "List Decisions filed by the agent, newest first. Read-only: this tool cannot approve or " +
      "reject. Use it to check whether a proposed write was approved or rejected before proposing " +
      "a replacement.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional filter: 'pending' | 'approved' | 'rejected'." },
        limit: { type: "number", description: "Max rows (default 20, max 100)." },
      },
    },
  },
  {
    name: "upsert_row",
    description:
      "Propose creating or fully replacing a row in a database. Cells is a map of column id to " +
      "value and MUST contain the complete set of cells for an existing row (read the row with " +
      "get_row first); this is a replace, not a patch. Every call files a Decision; the operator " +
      "approves it in Decisions. A rejected Decision must not be retried as a silent write. " +
      "A create in a database on the operator's insert allowlist can return posted: true. An update stays pending until the operator approves it.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        id: {
          type: "string",
          description: "Row id for an update. Omit entirely to create a new row (a UUID is generated).",
        },
        cells: {
          type: "object",
          additionalProperties: true,
          description: "Map of column id to typed value. Free-form; must be a JSON object.",
        },
      },
      required: ["domainSlug", "databaseId", "cells"],
    },
  },
  {
    name: "insert_rows",
    description:
      "Insert many new rows into one database. rows is an array of cell objects, at most 200, and this call does not take row ids. One call files one Decision titled Insert N rows into the database. Use upsert_row for a single new row or any edit. The result includes posted and rowCount. Claim that rows landed only when posted is true. status pending means one Decision is waiting; name the database and the count. status rejected includes reason; do not send those same rows again.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        rows: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: "Cell objects keyed by column id. At most 200. This call does not take row ids.",
        },
      },
      required: ["domainSlug", "databaseId", "rows"],
    },
  },
  {
    name: "delete_row",
    description:
      "Propose deleting a row by id. Files a Decision. The operator approves or rejects it in " +
      "Decisions; a rejected Decision must not be retried silently.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        id: { type: "string" },
      },
      required: ["domainSlug", "databaseId", "id"],
    },
  },
  {
    name: "create_database",
    description:
      "Propose creating a new empty database in a live domain. Files a Decision naming the database id " +
      "it proposes. Columns are added by a separate add_column call, one per column (also " +
      "Decision-gated).",
    parameters: {
      type: "object",
      properties: { domainSlug: { type: "string" }, name: { type: "string" } },
      required: ["domainSlug", "name"],
    },
  },
  {
    name: "add_column",
    description:
      "Propose adding one column to an existing database. Files a Decision. The relation target is " +
      "an existing databaseId, so a self-referential or newly created column cannot be added in the " +
      "same call.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        databaseId: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          description: "One of: text, number, date, select, checkbox, relation, file.",
        },
        options: { type: "array", description: "Required for type 'select'." },
        relationDatabaseId: { type: "string", description: "Required for type 'relation'." },
      },
      required: ["domainSlug", "databaseId", "name", "type"],
    },
  },
];

export type DatabaseErrorCode = "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "FAILED";

export type DatabaseToolResult =
  | Record<string, unknown>
  | { error: { code: DatabaseErrorCode; message: string } };

function fail(code: DatabaseErrorCode, message: string): DatabaseToolResult {
  return { error: { code, message } };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Map an engine `Result` failure to a tool error code. Result failures carry a
 * bare string, so the classification is by prefix.
 */
function engineError(error: string): DatabaseToolResult {
  if (
    error.startsWith("Database not found: ") ||
    error.startsWith("Domain not found or archived: ") ||
    error.startsWith("Row not found")
  ) {
    return fail("NOT_FOUND", error);
  }
  if (
    error.startsWith("Unknown column id in cells: ") ||
    error.startsWith("Column ") ||
    error.includes("value not in options") ||
    error.includes("relation target missing") ||
    error.includes("invalid file path") ||
    error === "Database name is required" ||
    // The engine's own argument checks.
    error === "select requires at least one option" ||
    error === "relation requires relationDatabaseId" ||
    // The extra proposed-write rules: a relation naming a row that does not
    // exist, and the posted-transaction invariants. All are permanent.
    error.includes("references a row that does not exist") ||
    error.startsWith("A posted transaction") ||
    error === "provenance expects a string" ||
    // The dedup rule.
    error.startsWith("An external_id of ")
  ) {
    return fail("VALIDATION", error);
  }
  return fail("FAILED", error);
}

function prefixRowError(rowNumber: number, error: string): DatabaseToolResult {
  const mapped = engineError(error);
  if (!("error" in mapped)) return mapped;
  return fail(mapped.error.code, `Row ${rowNumber}: ${mapped.error.message}`);
}

function pageInt(
  value: unknown,
  opts: { min: number; max: number; fallback: number; label: string },
): { ok: true; value: number } | { ok: false; result: DatabaseToolResult } {
  if (value === undefined || value === null) return { ok: true, value: opts.fallback };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return {
      ok: false,
      result: fail("VALIDATION", `${opts.label} must be an integer between ${opts.min} and ${opts.max}`),
    };
  }
  if (value < opts.min || value > opts.max) {
    return {
      ok: false,
      result: fail("VALIDATION", `${opts.label} must be between ${opts.min} and ${opts.max}`),
    };
  }
  return { ok: true, value };
}

/**
 * The live-domain filter lives in the tool layer, not the engine. listDatabases
 * does not filter archived domains on the explicit-slug path, and fixing that in
 * the engine would change what dbList returns to the operator's Data rail — a
 * side effect of an agent-facing fix. Archived and absent domains are
 * indistinguishable to the agent by design; the message names the slug.
 *
 * This also closes the silent-empty-result trap: listRows returns ok:true, []
 * when the SQLite file is missing, so a read against a missing domain would
 * otherwise read as "no accounts".
 */
async function requireLiveDomain(
  root: string,
  domainSlug: unknown,
): Promise<{ ok: true; slug: string } | { ok: false; result: DatabaseToolResult }> {
  if (!isNonEmptyString(domainSlug)) {
    return { ok: false, result: fail("VALIDATION", "domainSlug is required") };
  }
  if (!(await isDomainLive(root, domainSlug))) {
    return {
      ok: false,
      result: fail(
        "NOT_FOUND",
        `Domain not found or archived: ${domainSlug}. It may not exist, or it may be archived.`,
      ),
    };
  }
  return { ok: true, slug: domainSlug };
}

/**
 * KAR-63 §8: the domain set comes from paths.domainsDir, not from listDatabases.
 * listDatabases builds its entries from each registry's databases list, so a live
 * domain with no databases yet contributes no entry and would never be scanned —
 * and "this domain exists but the finance kit is not installed" is exactly the
 * question the kits field exists to answer.
 */
async function liveDomainSlugs(root: string): Promise<string[]> {
  const paths = vaultPaths(root);
  const slugs: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(paths.domainsDir, { withFileTypes: true });
  } catch {
    return slugs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await isDomainLive(root, entry.name)) slugs.push(entry.name);
  }
  return slugs;
}

/**
 * KAR-65 §3.2: used only to title a Decision and enable the extra finance checks.
 * It is deliberately NOT used to decide whether to gate: the gate is
 * unconditional, for every database in every live domain under any sotMode.
 */
const isFinanceDb = (domainSlug: string, databaseId: string): boolean =>
  domainSlug === FINANCE_DOMAIN_SLUG &&
  (Object.values(FINANCE_DB_IDS) as string[]).includes(databaseId);

/** A short human label for a row, for the Decision title the operator reads. */
function rowLabel(db: DatabaseMeta, cells: Record<string, unknown>): string {
  const byName = (name: string) => db.columns.find((c) => c.name.toLowerCase() === name)?.id;
  for (const key of ["payee", "name", "title", "account", "category", "date"]) {
    const id = byName(key);
    if (!id) continue;
    const v = cells[id];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function decisionTitle(
  op: DatabaseDecisionBody["op"],
  db: DatabaseMeta | null,
  domainSlug: string,
  label: string | null,
  name?: string,
): string {
  if (op === "create-database") return `New database "${name}" in ${domainSlug}`;
  if (op === "add-column") return `Add column "${name}" to ${db?.name ?? "database"}`;
  if (isFinanceDb(domainSlug, db?.id ?? "")) {
    return `${label ? `${label} in ` : "Row in "}${db?.name ?? "finance"}`;
  }
  if (op === "delete") return `Delete row from ${db?.name ?? "database"}`;
  return `${label ? `${label} in ` : "New row in "}${db?.name ?? "database"}`;
}

/**
 * KAR-65 §4: a sync conflict on the target row blocks the proposal. The match is
 * row-scoped, because conflicts are per row / external id — one unrelated conflict
 * must not block every write to a database. rowId is matched first: it is the
 * direct local row identifier and the tool already has it in hand. Matching on
 * externalId alone never fires for a chat-posted row, which carries
 * external_id: null.
 *
 * Conflict *resolution* stays operator-only: resolveSyncConflict is a write, and
 * exposing it would be an ungated mutation path.
 */
async function checkConflicts(
  root: string,
  domainSlug: string,
  db: DatabaseMeta,
  rowId: string | null,
  cells: Record<string, unknown> | null,
): Promise<DatabaseToolResult | null> {
  if (db.adapter === null) return null;
  const listed = await listSyncConflicts(root, domainSlug, db.id);
  const conflicts = listed.ok ? listed.value : [];
  if (conflicts.length === 0) return null;

  const names = conflicts.map((c) => c.rowId ?? c.externalId).join(", ");

  if (rowId == null) {
    // A create is unmatchable by construction: there is no external_id cell to
    // compare and no row to match. This is the one case where the block is
    // database-scoped, because a create genuinely cannot be attributed to a
    // specific conflicting row.
    return {
      error: {
        code: "CONFLICT",
        message:
          "Resolve the outstanding sync conflicts on this database before proposing a new row. " +
          `Conflicting rows: ${names}`,
      },
    };
  }

  const externalIdColId = db.columns.find(
    (c) => c.name.toLowerCase() === "external_id" || c.id === "external_id",
  )?.id;
  const proposedExternalId =
    externalIdColId && cells ? (cells[externalIdColId] as string | undefined) : undefined;

  const match = conflicts.find(
    (c) =>
      (c.rowId != null && c.rowId === rowId) ||
      (proposedExternalId != null && c.externalId != null && c.externalId === proposedExternalId),
  );
  if (!match) return null;
  return {
    error: {
      code: "CONFLICT",
      message:
        "This row has an unresolved sync conflict. Resolve it in the studio, then propose again. " +
        `Conflicting rows: ${names}`,
    },
  };
}

/** An allowlisted create resolves in this call. Anything else stays pending and writes nothing. */
async function finishWrite(
  root: string,
  decisionId: string,
  rowCount: number,
  allow: boolean,
): Promise<DatabaseToolResult> {
  if (!allow) return { decisionId, status: "pending", posted: false, rowCount };
  const resolved = await resolveDecision(root, decisionId, "approved");
  if (resolved.ok) return { decisionId, status: "approved", posted: true, rowCount };
  const listed = await listDecisions(root);
  const record = listed.ok ? listed.value.find((d) => d.id === decisionId) : undefined;
  if (record?.status === "rejected") {
    return {
      decisionId,
      status: "rejected",
      posted: false,
      rowCount,
      reason: record.reason ?? resolved.error,
    };
  }
  return { decisionId, status: "pending", posted: false, rowCount, reason: resolved.error };
}

async function allowInsert(
  root: string,
  domainSlug: string,
  databaseId: string,
): Promise<boolean> {
  const list = await readAutoApproveInserts(root);
  return list.some((entry) => entry.domainSlug === domainSlug && entry.databaseId === databaseId);
}

/** File the Decision and return the tool's success shape. Nothing is written here. */
async function fileDecision(
  root: string,
  actor: Actor,
  input: {
    target:
      | { type: "database-row"; domainSlug: string; databaseId: string; rowId: string | null }
      | { type: "database"; domainSlug: string; databaseId: string }
      | { type: "database-batch"; domainSlug: string; databaseId: string };
    proposedTitle: string;
    body: DatabaseDecisionBody;
    previousBodyMarkdown: string | null;
  },
): Promise<DatabaseToolResult> {
  const created = await createDecision(root, {
    target: input.target,
    proposedTitle: input.proposedTitle,
    proposedBodyMarkdown: JSON.stringify(input.body, null, 2),
    previousBodyMarkdown: input.previousBodyMarkdown,
    // The actor is the one executeTool received, never one from args: a
    // model-controlled parameter is not an identity source.
    actor,
  });
  if (!created.ok) return engineError(created.error);
  return { decisionId: created.value.id, status: created.value.status };
}

async function fileBatchDecision(
  root: string,
  actor: Actor,
  input: {
    target: { type: "database-batch"; domainSlug: string; databaseId: string };
    proposedTitle: string;
    body: DatabaseBatchDecisionBody;
  },
): Promise<DatabaseToolResult> {
  const created = await createDecision(root, {
    target: input.target,
    proposedTitle: input.proposedTitle,
    proposedBodyMarkdown: JSON.stringify(input.body, null, 2),
    previousBodyMarkdown: null,
    // The actor is the function argument, never one from args.
    actor,
  });
  if (!created.ok) return engineError(created.error);
  return { decisionId: created.value.id, status: created.value.status };
}

export async function executeDatabaseTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<DatabaseToolResult> {
  switch (name) {
    // Reads are direct. They never create Decisions: they are idempotent, leave
    // no trace, and the agent needs them to discover the schemas it must write.
    case "list_databases": {
      const requested = args.domainSlug;
      let slugs: string[];
      let scope: string | null;
      if (requested !== undefined && requested !== null) {
        const live = await requireLiveDomain(root, requested);
        if (!live.ok) return live.result;
        slugs = [live.slug];
        scope = live.slug;
      } else {
        slugs = await liveDomainSlugs(root);
        scope = null;
      }

      // Kits come from the existing listInstalledKits, keyed per domain. A domain
      // with no registry.json yields [] — the accessor already catches.
      const kits: Array<{ domainSlug: string; kits: string[] }> = [];
      for (const slug of slugs) {
        const installed = await listInstalledKits(root, slug);
        kits.push({ domainSlug: slug, kits: installed.ok ? installed.value : [] });
      }

      const listed = await listDatabases(root, scope);
      if (!listed.ok) return engineError(listed.error);
      const databases = listed.value.filter((entry) => slugs.includes(entry.domainSlug));
      return { kits, databases };
    }

    case "get_database": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      const db = await getDatabase(root, live.slug, String(args.databaseId));
      if (!db.ok) return engineError(db.error);
      return { database: db.value };
    }

    case "list_rows": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      const limit = pageInt(args.limit, { min: 1, max: 500, fallback: 100, label: "limit" });
      if (!limit.ok) return limit.result;
      const offset = pageInt(args.offset, {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        fallback: 0,
        label: "offset",
      });
      if (!offset.ok) return offset.result;

      const databaseId = String(args.databaseId);
      // Presence is checked before the engine so a missing arg is VALIDATION
      // rather than a NOT_FOUND from a malformed lookup.
      const db = await getDatabase(root, live.slug, databaseId);
      if (!db.ok) return engineError(db.error);

      const listed = await listRows(root, live.slug, databaseId, {
        limit: limit.value,
        offset: offset.value,
      });
      if (!listed.ok) return engineError(listed.error);
      const total = await countRows(root, live.slug, databaseId);
      return {
        rows: listed.value,
        // Without the total, a truncated page is indistinguishable from a
        // complete answer.
        total: total.ok ? total.value : listed.value.length,
        limit: limit.value,
        offset: offset.value,
      };
    }

    case "get_row": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      if (!isNonEmptyString(args.id)) {
        return fail("VALIDATION", "id is required");
      }
      const row = await getRow(
        root,
        live.slug,
        String(args.databaseId),
        String(args.id),
      );
      if (!row.ok) return engineError(row.error);
      return { row: row.value };
    }

    case "list_decisions": {
      // Read-only. The agent can see the outcome of its proposals but cannot
      // resolve one: resolveDecision takes a resolution, so wiring it to MCP
      // would hand the agent the approve button. This is what makes "do not
      // retry a rejected write" enforceable.
      const limit = pageInt(args.limit, { min: 1, max: 100, fallback: 20, label: "limit" });
      if (!limit.ok) return limit.result;
      if (args.status !== undefined && args.status !== null) {
        if (args.status !== "pending" && args.status !== "approved" && args.status !== "rejected") {
          return fail("VALIDATION", "status must be one of: pending, approved, rejected");
        }
      }
      const listed = await listDecisions(root);
      if (!listed.ok) return engineError(listed.error);
      let items = listed.value;
      if (args.status) items = items.filter((d) => d.status === args.status);
      const ordered = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        decisions: ordered.slice(0, limit.value).map((d) => ({
          id: d.id,
          status: d.status,
          proposedTitle: d.proposedTitle,
          createdAt: d.createdAt,
          // A terminal apply failure records why, so the agent can tell a
          // proposal to re-read and start over from one to leave alone.
          reason: d.reason,
        })),
      };
    }

    // ─── Writes. Every one of these files a Decision; nothing is written here. ──
    case "upsert_row": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      if (args.id !== undefined && args.id !== null && !isNonEmptyString(args.id)) {
        return fail("VALIDATION", "id must be a non-empty string when provided");
      }
      const cells = args.cells;
      if (cells === null || typeof cells !== "object" || Array.isArray(cells)) {
        return fail("VALIDATION", "cells must be a JSON object keyed by column id");
      }
      const cellMap = cells as Record<string, unknown>;
      // validateCells passes vacuously on {}, so an empty map is rejected here.
      if (Object.keys(cellMap).length === 0) {
        return fail("VALIDATION", "cells must not be empty");
      }

      const { slug: domainSlug } = live;
      const databaseId = String(args.databaseId);
      const rowId = isNonEmptyString(args.id) ? String(args.id) : null;

      const db = await getDatabase(root, domainSlug, databaseId);
      if (!db.ok) return engineError(db.error);
      const dbMeta = db.value;

      const conflict = await checkConflicts(root, domainSlug, dbMeta, rowId, cellMap);
      if (conflict) return conflict;

      // Dedup reuses the ingest predicate, keyed on external_id alone, so the
      // agent's rule cannot drift from the path it mirrors. A chat-posted row
      // carries external_id: null and is correctly not rejected by this.
      const externalIdColId = dbMeta.columns.find(
        (c) => c.name.toLowerCase() === "external_id" || c.id === "external_id",
      )?.id;
      const externalId = externalIdColId ? cellMap[externalIdColId] : undefined;
      if (typeof externalId === "string" && externalId) {
        if (await lookupExternalId(root, domainSlug, databaseId, externalId)) {
          return fail("VALIDATION", `An external_id of ${externalId} already exists in this database`);
        }
      }

      // Capture the current state so the inbox shows a real before/after, and so
      // the apply can refuse a proposal made against a row that has moved on.
      let previousCells: Record<string, unknown> | null = null;
      let expectedUpdatedAt: string | null = null;
      if (rowId) {
        const existing = await getRow(root, domainSlug, databaseId, rowId);
        if (!existing.ok) return engineError(existing.error);
        previousCells = existing.value.cells as Record<string, unknown>;
        expectedUpdatedAt = existing.value.updatedAt;
      }

      // The relation-row-exists and posted-transaction rules are checked at
      // propose time too, so a bad proposal is never filed in the first place.
      const referential = await checkDatabaseCells(root, domainSlug, databaseId, cellMap);
      if (!referential.ok) return engineError(referential.error);

      const label = rowLabel(dbMeta, cellMap) || null;
      const body: DatabaseDecisionBody = {
        op: "upsert",
        databaseName: dbMeta.name,
        rowLabel: label,
        previousCells,
        cells: cellMap,
        expectedUpdatedAt,
      };
      const filed = await fileDecision(root, actor, {
        target: { type: "database-row", domainSlug, databaseId, rowId },
        proposedTitle: decisionTitle("upsert", dbMeta, domainSlug, label),
        body,
        previousBodyMarkdown: previousCells ? JSON.stringify(previousCells, null, 2) : null,
      });
      if ("error" in filed) return filed;
      const decisionId = String((filed as { decisionId: string }).decisionId);
      const allow = rowId === null && (await allowInsert(root, domainSlug, databaseId));
      return finishWrite(root, decisionId, 1, allow);
    }

    case "delete_row": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      if (!isNonEmptyString(args.id)) {
        return fail("VALIDATION", "id is required");
      }
      const { slug: domainSlug } = live;
      const databaseId = String(args.databaseId);
      const rowId = String(args.id);

      const db = await getDatabase(root, domainSlug, databaseId);
      if (!db.ok) return engineError(db.error);
      const dbMeta = db.value;

      const existing = await getRow(root, domainSlug, databaseId, rowId);
      if (!existing.ok) return engineError(existing.error);
      const previousCells = existing.value.cells as Record<string, unknown>;

      const conflict = await checkConflicts(root, domainSlug, dbMeta, rowId, previousCells);
      if (conflict) return conflict;

      const label = rowLabel(dbMeta, previousCells) || null;
      const body: DatabaseDecisionBody = {
        op: "delete",
        databaseName: dbMeta.name,
        rowLabel: label,
        previousCells,
        cells: null,
        expectedUpdatedAt: existing.value.updatedAt,
      };
      return fileDecision(root, actor, {
        target: { type: "database-row", domainSlug, databaseId, rowId },
        proposedTitle: decisionTitle("delete", dbMeta, domainSlug, label),
        body,
        previousBodyMarkdown: JSON.stringify(previousCells, null, 2),
      });
    }

    case "create_database": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.name)) {
        return fail("VALIDATION", "name is required");
      }
      const { slug: domainSlug } = live;
      const name = String(args.name).trim();

      // The id is minted here, at propose time, and carried through the body. The
      // alternative — creating the database before filing — is the ungated write
      // this design exists to prevent, and it would leave an un-approved database
      // behind on rejection. No name-uniqueness check: duplicate names stay legal
      // for the agent and the operator alike.
      const newDatabaseId = randomUUID();
      const body: DatabaseDecisionBody = {
        op: "create-database",
        databaseId: newDatabaseId,
        name,
        databaseName: name,
        rowLabel: null,
        previousCells: null,
        cells: null,
        expectedUpdatedAt: null,
      };
      return fileDecision(root, actor, {
        target: { type: "database", domainSlug, databaseId: newDatabaseId },
        proposedTitle: decisionTitle("create-database", null, domainSlug, null, name),
        body,
        previousBodyMarkdown: null,
      });
    }

    case "add_column": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      if (!isNonEmptyString(args.name)) {
        return fail("VALIDATION", "name is required");
      }
      if (!isNonEmptyString(args.type)) {
        return fail("VALIDATION", "type is required");
      }
      const type = String(args.type) as DatabaseColumnType;
      if (!(DATABASE_COLUMN_TYPES as readonly string[]).includes(type)) {
        return fail(
          "VALIDATION",
          `Unknown column type: ${type}. One of: ${DATABASE_COLUMN_TYPES.join(", ")}`,
        );
      }
      const options = Array.isArray(args.options) ? args.options.map(String) : undefined;
      if (type === "select" && (!options || options.length < 1)) {
        return fail("VALIDATION", "select requires at least one option");
      }
      const relationDatabaseId = isNonEmptyString(args.relationDatabaseId)
        ? String(args.relationDatabaseId)
        : undefined;
      if (type === "relation" && !relationDatabaseId) {
        return fail("VALIDATION", "relation requires relationDatabaseId");
      }
      if (type !== "relation" && relationDatabaseId !== undefined) {
        return fail("VALIDATION", "relationDatabaseId is only valid for type 'relation'");
      }

      const { slug: domainSlug } = live;
      const databaseId = String(args.databaseId);
      const db = await getDatabase(root, domainSlug, databaseId);
      if (!db.ok) return engineError(db.error);
      const dbMeta = db.value;

      if (relationDatabaseId) {
        const target = await getDatabase(root, domainSlug, relationDatabaseId);
        if (!target.ok) return engineError(target.error);
      }

      // The target deliberately identifies only the database: addDatabaseColumn
      // mints the column id itself, so the Decision cannot name a column. The
      // column spec lives in the body, which is what the operator approves.
      const name = String(args.name).trim();
      const body: DatabaseDecisionBody = {
        op: "add-column",
        name,
        type,
        options,
        relationDatabaseId,
        databaseName: dbMeta.name,
        rowLabel: null,
        previousCells: null,
        cells: null,
        expectedUpdatedAt: null,
      };
      return fileDecision(root, actor, {
        target: { type: "database", domainSlug, databaseId },
        proposedTitle: decisionTitle("add-column", dbMeta, domainSlug, null, name),
        body,
        previousBodyMarkdown: null,
      });
    }

    case "insert_rows": {
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      if (!isNonEmptyString(args.databaseId)) {
        return fail("VALIDATION", "databaseId is required");
      }
      const { slug: domainSlug } = live;
      const databaseId = String(args.databaseId);
      const db = await getDatabase(root, domainSlug, databaseId);
      if (!db.ok) return engineError(db.error);
      const dbMeta = db.value;

      const rowsArg = args.rows;
      if (!Array.isArray(rowsArg) || rowsArg.length < 1 || rowsArg.length > INSERT_ROWS_MAX) {
        return fail("VALIDATION", "rows must be an array of 1 to 200 cell objects");
      }

      const conflict = await checkConflicts(root, domainSlug, dbMeta, null, null);
      if (conflict) return conflict;

      const externalIdColId = dbMeta.columns.find(
        (c) => c.name.toLowerCase() === "external_id" || c.id === "external_id",
      )?.id;
      const seenExternal = new Set<string>();
      const batchRows: DatabaseBatchDecisionBody["rows"] = [];
      for (let i = 0; i < rowsArg.length; i++) {
        const rowNumber = i + 1;
        const cells = rowsArg[i];
        if (cells === null || typeof cells !== "object" || Array.isArray(cells)) {
          return fail("VALIDATION", `Row ${rowNumber}: cells must be a JSON object keyed by column id`);
        }
        const cellMap = cells as Record<string, unknown>;
        if (Object.keys(cellMap).length === 0) {
          return fail("VALIDATION", `Row ${rowNumber}: cells must not be empty`);
        }

        const typed = await validateRowCells(root, domainSlug, databaseId, cellMap);
        if (!typed.ok) return prefixRowError(rowNumber, typed.error);
        const referential = await checkDatabaseCells(root, domainSlug, databaseId, cellMap);
        if (!referential.ok) return prefixRowError(rowNumber, referential.error);

        const externalId = externalIdColId ? cellMap[externalIdColId] : undefined;
        if (typeof externalId === "string" && externalId) {
          if (
            seenExternal.has(externalId) ||
            (await lookupExternalId(root, domainSlug, databaseId, externalId))
          ) {
            return fail(
              "VALIDATION",
              `Row ${rowNumber}: An external_id of ${externalId} already exists in this database`,
            );
          }
          seenExternal.add(externalId);
        }

        batchRows.push({
          id: randomUUID(),
          cells: cellMap,
          rowLabel: rowLabel(dbMeta, cellMap) || null,
        });
      }

      const proposedTitle = `Insert ${rowsArg.length} rows into ${dbMeta.name}`;
      const filed = await fileBatchDecision(root, actor, {
        target: { type: "database-batch", domainSlug, databaseId },
        proposedTitle,
        body: { op: "insert-rows", databaseName: dbMeta.name, rows: batchRows },
      });
      if ("error" in filed) return filed;
      const decisionId = String((filed as { decisionId: string }).decisionId);
      return finishWrite(
        root,
        decisionId,
        rowsArg.length,
        await allowInsert(root, domainSlug, databaseId),
      );
    }

    default:
      return fail("VALIDATION", `Unknown database tool: ${name}`);
  }
}
