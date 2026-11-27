import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import { applyScriptBlock, parseScriptSource, runScriptBlock } from "./script-block.ts";

/**
 * A page id, as the vault writes one: `randomUUID()` output is hex and dashes,
 * and older ids are alphanumeric/hyphen/underscore. No dot, no path separator,
 * no empty string — the id is concatenated into a filename
 * (`domains/<slug>/pages/<id>.json`), so this grammar is the first fence against
 * a traversing id, and it sits in the tool layer so a caller can never hand the
 * engine a path-shaped id at all.
 *
 * Fort-Knox AGENT-03: without this, an agent with Write in one domain could pass
 * `../../other-domain/pages/<id>` and have `applyScriptBlock` write another
 * domain's page (`vaultPaths.domainPage` only fences the vault root).
 */
const PAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The page id, or `null` when the argument is not one. */
function pageIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return PAGE_ID.test(id) ? id : null;
}

export const SCRIPT_TOOL_DEFS: MapToolDef[] = [
  {
    name: "apply_script_block",
    description:
      "Write one script block onto a page. The script is a read-only SELECT or a JSON object of read-only queries and https fetches against that domain's database. This path applies immediately and does not file a Decision; name the script in your reply. Every other page edit still goes through Decisions.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain that owns the page, e.g. 'financial'." },
        pageId: { type: "string", description: "The page id to write the script block onto (the id, never a path)." },
        blockId: { type: "string", description: "Optional existing script block id to replace. Omit to append a new block." },
        name: { type: "string", description: "Short human name for the script block, e.g. 'Spend count'." },
        source: { type: "string", description: "One read-only SELECT, or a JSON object with queries and https fetches." },
      },
      required: ["domainSlug", "pageId", "name", "source"],
    },
  },
  {
    name: "run_script_block",
    description:
      "Run a script source against the domain's database without saving it. Returns the queries, their columns and rows, and any fetch results. Do not claim a script ran unless this tool returned queries or fetches. An agent caller may run read-only queries only: https fetches are the operator's, run from the page's own Run button.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain whose database is queried, e.g. 'health'." },
        source: {
          type: "string",
          description:
            "One read-only SELECT, or a JSON object with read-only queries (agent callers: queries only, no fetches).",
        },
      },
      required: ["domainSlug", "source"],
    },
  },
];

export async function executeScriptTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "apply_script_block": {
      const domainSlug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      // AGENT-03: validate the id before any path is built. A caller that sends
      // a path answers MALFORMED and nothing is read or written.
      const pageId = pageIdOf(args.pageId);
      if (pageId === null) {
        return {
          error: {
            code: "MALFORMED",
            message: "pageId must be a page id (letters, digits, dashes, underscores), not a path",
          },
        };
      }
      const scriptName = typeof args.name === "string" ? args.name : "";
      const source = typeof args.source === "string" ? args.source : "";
      const blockId = typeof args.blockId === "string" && args.blockId ? args.blockId : undefined;
      const result = await applyScriptBlock(root, { domainSlug, pageId, blockId, name: scriptName, source, actor });
      if (!result.ok) return { error: { code: "FAILED", message: result.error } };
      return {
        applied: true,
        name: result.value.name,
        blockId: result.value.blockId,
        decision: false,
      };
    }
    case "run_script_block": {
      const domainSlug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const source = typeof args.source === "string" ? args.source : "";
      // Fort-Knox AGENT-04: a model-driven caller (the companion included) must
      // not fetch. The reason is the whole finding: the model chooses the URL,
      // so any data it has read can be put in the query string, and the reply is
      // a network client the grant never mentioned. The operator's own page Run
      // button does not come through here (renderer IPC → vault-service →
      // runScriptBlock), so its fetches keep working and are SSRF-hardened
      // there. Refused rather than stripped: silently dropping the fetches would
      // let a turn believe it had checked a figure it never fetched.
      const parsed = parseScriptSource(source);
      if (!parsed.ok) return { error: { code: "MALFORMED", message: parsed.error } };
      if (actor.type === "agent" && parsed.value.fetches.length > 0) {
        return {
          error: {
            code: "FORBIDDEN",
            message:
              "Script fetches are the operator's: an agent may run read-only queries only. " +
              "Remove the fetches and send the queries, or ask the operator to run the script.",
          },
        };
      }
      const result = await runScriptBlock(root, { domainSlug, source });
      return result.ok ? result.value : { error: { code: "FAILED", message: result.error } };
    }
    default:
      return { error: { code: "MALFORMED", message: "Unknown script tool" } };
  }
}
