import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import { getPage, listPages } from "./pages.ts";
import { isDomainLive } from "./domain-databases.ts";

/**
 * The companion's read-only page surface.
 *
 * A page is a domain's dashboard document: its blocks are how the operator has
 * arranged what a domain shows, and the agent reads them to answer "what is on
 * my Health board" or to cite a page it was pointed at. There is no write tool
 * here on purpose — pages are the operator's arrangement, and the existing
 * Decision-gated page update path is not part of this surface.
 *
 * The failure shape is the database tools' one ({ error: { code, message } }),
 * so a model reads one refusal vocabulary across the harness.
 */
export const PAGE_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_pages",
    description:
      "List pages in one live domain, or in every live domain when no domainSlug is " +
      "given. Each entry names its domain and carries the full page (id, title, blocks, " +
      "timestamps). Returns { pages, total }. Use get_page for one page.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "Optional domain slug to limit results, e.g. 'health'.",
        },
      },
    },
  },
  {
    name: "get_page",
    description:
      "Read one page by domain slug and page id, including its blocks. Returns { page }. " +
      "Use list_pages first to learn the page ids in a domain.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        pageId: { type: "string" },
      },
      required: ["domainSlug", "pageId"],
    },
  },
];

export type PageErrorCode = "NOT_FOUND" | "VALIDATION" | "FAILED";

export type PageToolResult =
  | Record<string, unknown>
  | { error: { code: PageErrorCode; message: string } };

function fail(code: PageErrorCode, message: string): PageToolResult {
  return { error: { code, message } };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Archived and absent domains are indistinguishable to the agent by design, as
 * in the database tools; the message names the slug. Checking here rather than
 * trusting listPages also stops the silent-empty trap: a read against a missing
 * domain would otherwise answer "this domain has no pages".
 */
async function requireLiveDomain(
  root: string,
  domainSlug: unknown,
): Promise<{ ok: true; slug: string } | { ok: false; result: PageToolResult }> {
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
 * `actor` is accepted so this executor has the shape every other one has at the
 * dispatch site, and is deliberately unused: both tools are reads, and a page
 * write stays on its own Decision-gated path.
 */
export async function executePageTool(
  root: string,
  _actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<PageToolResult> {
  switch (name) {
    case "list_pages": {
      // No domainSlug means every live domain; listPages already filters
      // archived domains on that path. With a slug, the live check is the
      // tool's, so an archived domain never reads as an empty one.
      let slug: string | null = null;
      if (args.domainSlug !== undefined && args.domainSlug !== null) {
        const live = await requireLiveDomain(root, args.domainSlug);
        if (!live.ok) return live.result;
        slug = live.slug;
      }
      const listed = await listPages(root, slug);
      if (!listed.ok) return fail("FAILED", listed.error);
      return { pages: listed.value, total: listed.value.length };
    }

    case "get_page": {
      if (!isNonEmptyString(args.pageId)) {
        return fail("VALIDATION", "pageId is required");
      }
      const live = await requireLiveDomain(root, args.domainSlug);
      if (!live.ok) return live.result;
      const page = await getPage(root, live.slug, String(args.pageId));
      if (!page.ok) {
        // The engine's only "no page" answer is a not-found string; everything
        // else out of getPage is an I/O failure.
        return fail(/^Page not found/.test(page.error) ? "NOT_FOUND" : "FAILED", page.error);
      }
      return { page: page.value };
    }

    default:
      return fail("VALIDATION", `Unknown page tool: ${name}`);
  }
}
