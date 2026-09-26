import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import { applyScriptBlock, runScriptBlock } from "./script-block.ts";

export const SCRIPT_TOOL_DEFS: MapToolDef[] = [
  {
    name: "apply_script_block",
    description:
      "Write one script block onto a page. The script is a read-only SELECT or a JSON object of read-only queries and https fetches against that domain's database. This path applies immediately and does not file a Decision; name the script in your reply. Every other page edit still goes through Decisions.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain that owns the page, e.g. 'financial'." },
        pageId: { type: "string", description: "The page id to write the script block onto." },
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
      "Run a script source against the domain's database without saving it. Returns the queries, their columns and rows, and any fetch results. Do not claim a script ran unless this tool returned queries or fetches.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain whose database is queried, e.g. 'health'." },
        source: { type: "string", description: "One read-only SELECT, or a JSON object with queries and https fetches." },
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
      const pageId = typeof args.pageId === "string" ? args.pageId : "";
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
      const result = await runScriptBlock(root, { domainSlug, source });
      return result.ok ? result.value : { error: { code: "FAILED", message: result.error } };
    }
    default:
      return { error: { code: "MALFORMED", message: "Unknown script tool" } };
  }
}
