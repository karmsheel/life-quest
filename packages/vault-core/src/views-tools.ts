import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import {
  listViews,
  runView,
  validateViewSpec,
} from "./views.ts";
import { getDatabase } from "./domain-databases.ts";
import { setPins } from "./pins.ts";
import type { Pin, Result, ViewSpec, ViewRunResult } from "./types.ts";

/**
 * Agent-built dashboard views (plan.md design, slice 3): the companion's tool
 * surface for views. The companion never emits SQL and never writes a view
 * file directly — preview_view runs the exact same parameterized read the
 * dashboard card will, propose_view files one Decision per view, and
 * propose_pins only ever reorders, re-spans, or unpins an existing pinned
 * board's view pins. Approval still lives with the operator in the Decisions
 * card.
 */

export const VIEW_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_views",
    description:
      "List the saved views in a domain: id, title, presentation, and the database each reads. " +
      "Use this to see what is already on or available to the dashboard before proposing a new view.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain, e.g. 'financial'." },
      },
      required: ["domainSlug"],
    },
  },
  {
    name: "preview_view",
    description:
      "Run a view spec against a domain database and return what the dashboard card would show: " +
      "rows of [label, value], warnings, and the shared currency. Nothing is saved. Use this to " +
      "check the numbers before proposing a view. At most three previews per data question, then " +
      "write the comparison in prose instead of another chart.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain, e.g. 'financial'." },
        spec: { type: "object", description: "The view spec (same shape propose_view takes)." },
      },
      required: ["domainSlug", "spec"],
    },
  },
  {
    name: "propose_view",
    description:
      "Propose a saved view so the operator can pin it on their dashboard. Files one Decision " +
      "with the full spec and a preview of the rows it produces today; nothing is saved until the " +
      "operator approves. Name the view in your reply and reference the decision id. The spec must " +
      "come from a successful preview_view in the same conversation.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain, e.g. 'financial'." },
        spec: { type: "object", description: "The view spec to propose." },
      },
      required: ["domainSlug", "spec"],
    },
  },
  {
    name: "propose_pins",
    description:
      "Propose changes to one board's pins: reorder pins, move a view pin between one cell and a " +
      "full row (span), or unpin a view by leaving it out. The array is the complete board, so " +
      "keep every pin you do not change and keep their order meaningful. Files one Decision; " +
      "nothing is written until the operator approves. Do not use this to add a view pin — say " +
      "which proposed view to pin in your reply and let the operator pin it.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: ["string", "null"],
          description: "The board: a domain slug like 'financial', or null for the Overview board.",
        },
        pins: { type: "array", description: "The complete new pin list for that board." },
      },
      required: ["domainSlug", "pins"],
    },
  },
];

export async function executeViewTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_views": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const res = await listViews(root, slug);
      if (!res.ok) return toolError(res.error);
      return {
        views: res.value.map((v) => ({
          id: v.id,
          title: v.title,
          presentation: v.presentation,
          databaseId: v.databaseId,
        })),
      };
    }

    case "preview_view": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const specRes = parseSpec(args.spec);
      if (!specRes.ok) return toolError(specRes.error);
      const live = await getDatabase(root, slug, specRes.value.databaseId);
      if (!live.ok) return toolError(live.error);
      const check = validateViewSpec(specRes.value, live.value);
      if (!check.ok) return toolError(check.error);
      const run = await runView(root, slug, specRes.value);
      if (!run.ok) return toolError(run.error);
      return previewShape(run.value);
    }

    case "propose_view": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const specRes = parseSpec(args.spec);
      if (!specRes.ok) return toolError(specRes.error);
      const spec = specRes.value;
      const live = await getDatabase(root, slug, spec.databaseId);
      if (!live.ok) return toolError(live.error);
      const check = validateViewSpec(spec, live.value);
      if (!check.ok) return toolError(check.error);
      // The preview rides inside the Decision so the operator sees today's
      // rows at approve time without running the view themselves.
      const run = await runView(root, slug, spec);
      const preview = run.ok ? previewShape(run.value) : { error: run.error };
      const { fileViewDecision } = await import("./views.ts");
      const filed = await fileViewDecision(root, actor, slug, spec, preview);
      if (!filed.ok) return toolError(filed.error);
      return { proposed: true, viewId: filed.value.viewId, decisionId: filed.value.decisionId };
    }

    case "propose_pins": {
      const domainSlug =
        args.domainSlug === null || args.domainSlug === undefined
          ? null
          : typeof args.domainSlug === "string" && args.domainSlug.trim()
            ? args.domainSlug
            : null;
      if (args.domainSlug != null && domainSlug === null) return toolError("domainSlug must be a slug or null");
      const pinsRes = parsePins(args.pins);
      if (!pinsRes.ok) return toolError(pinsRes.error);
      const res = await setPins(root, domainSlug, pinsRes.value, actor);
      if (!res.ok) return toolError(res.error);
      // setPins files a Decision for an agent actor and leaves the board file
      // untouched; a user actor here would write directly, so only agents get
      // this tool (dispatch is companion-only).
      if (res.value.applied) return { applied: true, pins: res.value.pins };
      return {
        proposed: true,
        decisionId: res.value.decision.id,
        status: res.value.decision.status,
      };
    }

    default:
      return toolError(`Unknown view tool: ${name}`);
  }
}

function toolError(message: string): { error: { code: string; message: string } } {
  return { error: { code: "FAILED", message } };
}

/** Accept a full spec (schemaVersion 1) or a shape missing it. */
function parseSpec(raw: unknown): Result<ViewSpec> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "spec must be an object" };
  }
  const spec = raw as Record<string, unknown>;
  if (spec.schemaVersion === undefined || spec.schemaVersion === null) {
    return { ok: true, value: { ...(spec as Omit<ViewSpec, "schemaVersion">), schemaVersion: 1 } as ViewSpec };
  }
  if (spec.schemaVersion !== 1) {
    return { ok: false, error: `Unsupported view schemaVersion: ${String(spec.schemaVersion)}` };
  }
  return { ok: true, value: spec as unknown as ViewSpec };
}

function parsePins(raw: unknown): Result<Pin[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "pins must be an array" };
  const out: Pin[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: "every pin must be an object" };
    }
    const pin = p as Record<string, unknown>;
    if (pin.id === undefined || pin.id === null) {
      return { ok: false, error: `pin ${out.length}: id is required` };
    }
    if (pin.kind === "view") {
      if (typeof pin.domainSlug !== "string" || !pin.domainSlug) {
        return { ok: false, error: `pin ${out.length}: view pin requires domainSlug` };
      }
      if (typeof pin.viewId !== "string" || !pin.viewId) {
        return { ok: false, error: `pin ${out.length}: view pin requires viewId` };
      }
      if (pin.span !== 1 && pin.span !== 2) {
        return { ok: false, error: `pin ${out.length}: span must be 1 or 2` };
      }
      out.push({ id: String(pin.id), kind: "view", domainSlug: pin.domainSlug, viewId: pin.viewId, span: pin.span as 1 | 2 });
    } else if (pin.kind === "page") {
      if (typeof pin.domainSlug !== "string" || !pin.domainSlug) {
        return { ok: false, error: `pin ${out.length}: page pin requires domainSlug` };
      }
      if (typeof pin.pageId !== "string" || !pin.pageId) {
        return { ok: false, error: `pin ${out.length}: page pin requires pageId` };
      }
      out.push({ id: String(pin.id), kind: "page", domainSlug: pin.domainSlug, pageId: pin.pageId });
    } else if (pin.kind === "system") {
      out.push({ id: String(pin.id), kind: "system", system: pin.system as never });
    } else {
      return { ok: false, error: `pin ${out.length}: unknown pin kind ${String(pin.kind)}` };
    }
  }
  return { ok: true, value: out };
}

/** The compact shape a preview or proposal shows: rows plus warnings. */
function previewShape(run: ViewRunResult): {
  columns: string[];
  rows: Array<[string, number]>;
  warnings: string[];
  currency: ViewRunResult["currency"];
  rowCount: number;
} {
  return {
    columns: run.columns,
    rows: run.rows,
    warnings: run.warnings,
    currency: run.currency,
    rowCount: run.rows.length,
  };
}
