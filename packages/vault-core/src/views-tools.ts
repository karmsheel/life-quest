import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import {
  listViews,
  runViewBlocks,
  validateViewSpec,
  getView,
  MAX_VIEW_BLOCKS,
} from "./views.ts";
import { getDatabase } from "./domain-databases.ts";
import { listPins, setPins } from "./pins.ts";
import { getPage } from "./pages.ts";
import { SYSTEM_PIN_KINDS } from "./types.ts";
import type { ComposedViewRunResult, Pin, Result, ViewSpec } from "./types.ts";

/**
 * Agent-built dashboard views (plan.md design). The Dashboard is the home pin
 * board — one per lens: the Overview board and one board per domain. The
 * companion reads it with get_dashboard and rearranges it with
 * arrange_dashboard, which applies at once for the companion (this is the
 * agent-arranged interface the design promises) and files one Decision for a
 * connected agent. Saving a NEW view still goes through a Decision in both
 * cases: propose_view files it, approval saves it, THEN it can be pinned.
 *
 * The companion never emits SQL: preview_view runs the same parameterized read
 * the dashboard card will. At most three previews per data question, then
 * write the comparison in prose instead of another chart.
 *
 * Composed views (2026-10-07): a spec may carry `blocks`, so one pinned card can
 * hold a metric, a table, and a chart together — which is what "a weekly summary"
 * actually means. The shape is taught in the tool descriptions rather than left
 * to be discovered, because a model that has only ever written one aggregate
 * will invent a second view instead of a second block.
 */

export const VIEW_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_dashboard",
    description:
      "Read one dashboard (pin board) as it currently stands: every pin in order with its human " +
      "label, kind, and span. domainSlug names a domain's dashboard; null names the Overview " +
      "dashboard. Call this before arranging so you change the real board, not an imagined one.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: ["string", "null"],
          description: "The dashboard: a domain slug like 'financial', or null for the Overview dashboard.",
        },
      },
      required: ["domainSlug"],
    },
  },
  {
    name: "arrange_dashboard",
    description:
      "Set one dashboard's pins: reorder, add a saved view pin (span 1 = one cell, 2 = full row), " +
      "or unpin by leaving a pin out. The array is the COMPLETE board, so keep every pin you do " +
      "not change and keep their order meaningful. You can only pin views that are already saved " +
      "(see list_views); a view you proposed but the operator has not approved yet cannot be " +
      "pinned. Read get_dashboard first and send back the full board with your changes.\n\n" +
      "A pin's `domainSlug` is the domain that OWNS the view, which is not always the board's: the " +
      "Overview board (domainSlug: null) is the cross-domain board and accepts any live domain's " +
      "view, so a financial weekly summary belongs there. A domain board still shows only its own " +
      "domain's views, and a page pin must belong to the board's domain.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: ["string", "null"],
          description: "The dashboard: a domain slug like 'financial', or null for the Overview dashboard.",
        },
        pins: { type: "array", description: "The complete new pin list for that board." },
      },
      required: ["domainSlug", "pins"],
    },
  },
  {
    name: "list_views",
    description:
      "List the saved views in a domain: id, title, presentation, and the database each reads. " +
      "Use this to see what is already available to pin before proposing a new view.",
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
      "write the comparison in prose instead of another chart.\n\n" +
      "A spec is either ONE aggregate (query fields at the top level) or a COMPOSED view: add a " +
      "`blocks` array (up to " + MAX_VIEW_BLOCKS + ") and each entry is one panel of the same card, " +
      'e.g. {"schemaVersion":1,"databaseId":"finance:transactions","title":"Weekly expenses",' +
      '"blocks":[{"id":"total","title":"Last 3 weeks","presentation":"metric",...},' +
      '{"id":"weeks","title":"Week by week","presentation":"table",...}]}. Each block carries its ' +
      "own presentation (table | bar | line | metric), filters, and measure; a field a block omits " +
      "is inherited from the top-level query fields. Use blocks whenever the operator asks for a " +
      '"summary" that needs more than one figure — a metric plus its table is one card, not two views.',
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
      "Propose a saved view so it can be pinned on a dashboard. Files one Decision with the full " +
      "spec and a preview of the rows it produces today; nothing is saved until the operator " +
      "approves. After approval the view is pinnable via arrange_dashboard. Name the view in " +
      "your reply and reference the decision id. The spec must come from a successful " +
      "preview_view in the same conversation. A composed spec (see preview_view) is proposed the " +
      "same way: the whole card is one Decision.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The domain, e.g. 'financial'." },
        spec: { type: "object", description: "The view spec to propose." },
      },
      required: ["domainSlug", "spec"],
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
    case "get_dashboard": {
      const domainSlug = parseBoardSlug(args.domainSlug);
      if (domainSlug === INVALID) return toolError("domainSlug must be a slug or null");
      const res = await listPins(root, domainSlug);
      if (!res.ok) return toolError(res.error);
      return { domainSlug, pins: await Promise.all(res.value.map((p) => describePin(root, p))) };
    }

    case "arrange_dashboard": {
      const domainSlug = parseBoardSlug(args.domainSlug);
      if (domainSlug === INVALID) return toolError("domainSlug must be a slug or null");
      const pinsRes = parsePins(args.pins);
      if (!pinsRes.ok) return toolError(pinsRes.error);
      const res = await setPins(root, domainSlug, pinsRes.value, actor);
      if (!res.ok) return toolError(res.error);
      if (res.value.applied) {
        // The companion's path: the board moved at once, no Decision exists.
        return { applied: true, pins: res.value.pins.map((p) => p.id) };
      }
      // A connected agent's path: setPins filed the Decision untouched.
      return {
        proposed: true,
        decisionId: res.value.decision.id,
        status: res.value.decision.status,
      };
    }

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
      const error = await checkSpec(root, slug, specRes.value);
      if (error) return toolError(error);
      const run = await runViewBlocks(root, slug, specRes.value);
      if (!run.ok) return toolError(run.error);
      return previewShape(run.value);
    }

    case "propose_view": {
      const slug = typeof args.domainSlug === "string" ? args.domainSlug : "";
      const specRes = parseSpec(args.spec);
      if (!specRes.ok) return toolError(specRes.error);
      const spec = specRes.value;
      const error = await checkSpec(root, slug, spec);
      if (error) return toolError(error);
      // The preview rides inside the Decision so the operator sees today's
      // rows at approve time without running the view themselves.
      const run = await runViewBlocks(root, slug, spec);
      const preview = run.ok ? previewShape(run.value) : { error: run.error };
      const { fileViewDecision } = await import("./views.ts");
      const filed = await fileViewDecision(root, actor, slug, spec, preview);
      if (!filed.ok) return toolError(filed.error);
      return { proposed: true, decisionId: filed.value.decisionId };
    }

    default:
      return toolError(`Unknown view tool: ${name}`);
  }
}

/** The sentinel `parseBoardSlug` returns for an argument that is neither. */
const INVALID = Symbol("invalid-board");

/**
 * A board argument: a domain slug, or `null` for the Overview board. An absent
 * value is the Overview board too, because that is what a caller meant by not
 * naming one; a value that is neither a string nor null is a mistake worth
 * reporting rather than silently reinterpreting as Overview.
 */
function parseBoardSlug(raw: unknown): string | null | typeof INVALID {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim()) return raw;
  return INVALID;
}

/** Validate one spec against its live database; the error string, or null. */
async function checkSpec(
  root: string,
  slug: string,
  spec: ViewSpec,
): Promise<string | null> {
  const live = await getDatabase(root, slug, spec.databaseId);
  if (!live.ok) return live.error;
  const check = validateViewSpec(spec, live.value);
  return check.ok ? null : check.error;
}

function toolError(message: string): { error: { code: string; message: string } } {
  return { error: { code: "FAILED", message } };
}

/** One board entry as the agent sees it: kind + a human label. */
async function describePin(root: string, pin: Pin): Promise<Record<string, unknown>> {
  if (pin.kind === "system") {
    return { kind: "system", system: pin.system, label: pin.system, id: pin.id };
  }
  if (pin.kind === "page") {
    const page = await getPage(root, pin.domainSlug, pin.pageId);
    return {
      kind: "page",
      id: pin.id,
      domainSlug: pin.domainSlug,
      pageId: pin.pageId,
      label: page.ok ? page.value.title : pin.pageId,
      span: 1,
    };
  }
  const view = await getView(root, pin.domainSlug, pin.viewId);
  return {
    kind: "view",
    id: pin.id,
    domainSlug: pin.domainSlug,
    viewId: pin.viewId,
    label: view.ok ? view.value.title : pin.viewId,
    presentation: view.ok ? view.value.presentation : null,
    span: pin.span,
  };
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
  const knownSystems = SYSTEM_PIN_KINDS as readonly string[];
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
      if (typeof pin.system !== "string" || !knownSystems.includes(pin.system)) {
        return { ok: false, error: `pin ${out.length}: unknown system pin kind ${String(pin.system)}` };
      }
      out.push({ id: String(pin.id), kind: "system", system: pin.system as never });
    } else {
      return { ok: false, error: `pin ${out.length}: unknown pin kind ${String(pin.kind)}` };
    }
  }
  return { ok: true, value: out };
}

/**
 * The compact shape a preview or proposal shows: every block's rows, plus the
 * warnings rolled up. A one-aggregate view is one block named after its
 * presentation, so a caller reads one shape either way.
 */
function previewShape(run: ComposedViewRunResult): {
  title: string;
  blocks: Array<{
    id: string;
    title: string;
    presentation: string;
    columns: string[];
    rows: Array<[string, number]>;
    rowCount: number;
    currency: ComposedViewRunResult["blocks"][number]["result"]["currency"];
  }>;
  warnings: string[];
} {
  return {
    title: run.title,
    blocks: run.blocks.map((b) => ({
      id: b.id,
      title: b.title,
      presentation: b.presentation,
      columns: b.result.columns,
      rows: b.result.rows,
      rowCount: b.result.rows.length,
      currency: b.result.currency,
    })),
    warnings: run.warnings,
  };
}
