import fs from "node:fs/promises";
import type { MapToolDef } from "./map/tools.ts";
import { countRows, getDatabase, getRow, isDomainLive, listDatabases, listRows } from "./domain-databases.ts";
import { listInstalledKits } from "./finance-kit.ts";
import { vaultPaths } from "./paths.ts";

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
    error === "Database name is required"
  ) {
    return fail("VALIDATION", error);
  }
  return fail("FAILED", error);
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

export async function executeDatabaseTool(
  root: string,
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

    default:
      return fail("VALIDATION", `Unknown database tool: ${name}`);
  }
}
