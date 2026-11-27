import type { MapToolDef } from "./map/tools.ts";
import type { Actor, ReviewCadence, ReviewRecord } from "./types.ts";
import { createDecision } from "./decisions.ts";
import { isReviewCadence } from "./period.ts";
import { getPeriodPack } from "./period-pack.ts";
import {
  getReview,
  getReviewNotebook,
  getReviewPageBody,
  listReviewIndex,
  markReviewDone,
  unlockReview,
  writeReviewPage,
} from "./reviews.ts";
import { getReviewSkill, writeReviewSkill } from "./review-skills.ts";
import {
  getReviewPageTemplate,
  writeReviewPageTemplate,
} from "./review-templates.ts";

export const REVIEW_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_review",
    description:
      "Read a review by cadence and period. With scope (\"overall\" or an area slug) returns that page only — your page as it stands: its # title, the four common ## headings, and every extra section it holds (its area's template sections and any operator headings, with their prose), plus its status and the page rev to quote back when you write. Without scope returns the notebook summary and the whole review as the compatibility read.",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        period: { type: "string" },
        scope: { type: "string" },
      },
      required: ["cadence", "period"],
    },
  },
  {
    name: "list_reviews",
    description: "List review index entries",
    parameters: { type: "object", properties: { cadence: { type: "string" } } },
  },
  {
    name: "write_review",
    description:
      "Write one page of a review. Call get_review with the same scope first, then pass the page body exactly as read — one # title, the four common ## headings, and every extra section the page holds (its area's template sections and any operator headings, with their prose), kept in place — plus its baseRev. The body replaces the whole page, so a section you drop is deleted; a template never backfills an existing page. Only that page is replaced, so another area's review is never touched. A CONFLICT means the page changed under you: read it again and re-apply only your section to the body it returns. A locked review files the page as a pending Decision instead of writing it.",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        period: { type: "string" },
        scope: { type: "string" },
        body: { type: "string" },
        baseRev: { type: "number" },
      },
      required: ["cadence", "period", "scope", "body", "baseRev"],
    },
  },
  {
    name: "mark_review_done",
    description: "Mark overall (locks) or a domain section done",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        period: { type: "string" },
        scope: { type: "string" },
      },
      required: ["cadence", "period", "scope"],
    },
  },
  {
    name: "unlock_review",
    description:
      "Unlock a locked review so it can be edited in place. Operator-only: an agent's call is refused, because the lock is what routes an agent's review edit into a Decision.",
    parameters: {
      type: "object",
      properties: { cadence: { type: "string" }, period: { type: "string" } },
      required: ["cadence", "period"],
    },
  },
  {
    name: "get_period_pack",
    description: "Prescribed data pack for a review period and scope",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        period: { type: "string" },
        scope: { type: "string" },
      },
      required: ["cadence", "period"],
    },
  },
  {
    name: "get_review_skill",
    description:
      "Read a cadence's standing review rules — the file handed to every review session of that cadence",
    parameters: {
      type: "object",
      properties: { cadence: { type: "string" } },
      required: ["cadence"],
    },
  },
  {
    name: "write_review_skill",
    description:
      "Replace a cadence's standing review rules. Add a rule here when the operator asks for something every review of that cadence should do. A ```lifequest-snapshot fence holding one JSON directive makes the app itself fill that figure in before the session starts: {id, domain, section, title, window: \"period\"|\"all\", spec: <view spec>}. Keep every fence you are not replacing.",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        markdown: { type: "string" },
      },
      required: ["cadence", "markdown"],
    },
  },
  {
    name: "get_review_template",
    description:
      "Read a live area's page template: the extra ## headings its review pages seed with and keep in this order. The four common headings (Look-back, Keep, Change, Next-period intent) are required on every page and are never listed in a template — a template names only the area's own sections. No file means the area's pages are exactly the four common headings.",
    parameters: {
      type: "object",
      properties: { scope: { type: "string" } },
      required: ["scope"],
    },
  },
  {
    name: "write_review_template",
    description:
      "Replace one live area's page template: an optional # title and one or more ## headings naming the area's own sections, in the order a page keeps them. The four common headings are always required on every page and must not be listed here; an H3, a duplicate, or a template with no extras is refused, as is scope \"overall\". A new page of the area is seeded with the four common headings then these extras in order; existing pages are only reordered the next time they are written, never rewritten by this tool.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string" },
        markdown: { type: "string" },
      },
      required: ["scope", "markdown"],
    },
  },
];

/**
 * The refusal half of every tool answer.
 *
 * It is its own type, not a member of `Record<string, unknown>`, so that a
 * successful answer and a refused one can be told apart by `"error" in result`
 * — the shape `requireCadencePeriod` relies on to hand back one or the other.
 */
type ReviewToolError = { error: { code: string; message: string } };

type ReviewToolResult = Record<string, unknown> | ReviewToolError;

function vaultError(error: string): ReviewToolError {
  const code = /not found/i.test(error) ? "NOT_FOUND" : "MALFORMED";
  return { error: { code, message: error } };
}

/**
 * A refused review write, in the vocabulary the caller can act on. `LOCKED` is
 * answered by the Decision branch before this, so it only appears when a locked
 * write could not even be composed.
 */
/** The compatibility whole-file record, or null when the period is unreadable — a write already landed, so a projection failure must not fail it. */
async function compatRecordOrNull(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<ReviewRecord | null> {
  const record = await getReview(rootPath, cadence, period);
  return record.ok ? record.value : null;
}

function writeError(message: string, code: string): ReviewToolError {
  return { error: { code, message } };
}

function requireCadencePeriod(
  args: Record<string, unknown>,
): { cadence: ReviewCadence; period: string } | ReviewToolError {
  const cadence = args.cadence;
  const period = args.period;
  if (typeof cadence !== "string" || !cadence) {
    return { error: { code: "MALFORMED", message: "cadence is required" } };
  }
  if (!isReviewCadence(cadence)) {
    return { error: { code: "MALFORMED", message: `Invalid cadence: ${cadence}` } };
  }
  if (typeof period !== "string" || !period) {
    return { error: { code: "MALFORMED", message: "period is required" } };
  }
  return { cadence, period };
}

export async function executeReviewTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<ReviewToolResult> {
  switch (name) {
    case "get_review": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      const result = await getReview(root, cp.cadence, cp.period);
      if (!result.ok) return vaultError(result.error);
      const scope = typeof args.scope === "string" ? args.scope : null;
      const notebookRes = await getReviewNotebook(root, cp.cadence, cp.period);
      const notebook = notebookRes.ok
        ? {
            title: notebookRes.value.title,
            locked: notebookRes.value.locked,
            order: notebookRes.value.order,
            legacy: notebookRes.value.legacy,
            pages: notebookRes.value.pages.map((page) => ({
              scope: page.scope,
              title: page.title,
              status: page.status,
              rev: page.rev,
            })),
          }
        : null;
      if (scope === null) return { review: result.value, notebook };
      const page = await getReviewPageBody(root, cp.cadence, cp.period, scope);
      if (!page.ok) return vaultError(page.error);
      // `review` rides along for the grant projection the tool door applies to
      // connected agents; a companion reads `page`.
      return { review: result.value, notebook, page: page.value };
    }

    case "list_reviews": {
      const listed = await listReviewIndex(root);
      if (!listed.ok) return vaultError(listed.error);
      let reviews = listed.value;
      if (typeof args.cadence === "string") {
        if (!isReviewCadence(args.cadence)) {
          return { error: { code: "MALFORMED", message: `Invalid cadence: ${args.cadence}` } };
        }
        reviews = reviews.filter((entry) => entry.cadence === args.cadence);
      }
      return { reviews };
    }

    case "write_review": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      const body = args.body;
      if (typeof body !== "string") {
        return { error: { code: "MALFORMED", message: "body is required" } };
      }
      const scope = args.scope;
      if (typeof scope !== "string" || !scope.trim()) {
        return {
          error: {
            code: "MALFORMED",
            message:
              'scope is required — pass "overall" or the area slug you were assigned (the daily review has "overall" only)',
          },
        };
      }
      if (typeof args.baseRev !== "number") {
        return {
          error: {
            code: "MALFORMED",
            message:
              "baseRev is required — call get_review with the same scope and pass the page rev it returned",
          },
        };
      }

      const written = await writeReviewPage(root, {
        cadence: cp.cadence,
        period: cp.period,
        scope,
        bodyMarkdown: body,
        baseRev: args.baseRev,
        actor,
      });
      if (written.ok) {
        return {
          review: await compatRecordOrNull(root, cp.cadence, cp.period),
          page: written.page,
          scope,
        };
      }
      if (written.code === "LOCKED") {
        // A locked review has one write path left: an approved Decision against
        // the page the companion was editing, carrying the page body as proposed.
        const current = written.current;
        const pageRes =
          current === undefined
            ? await getReviewPageBody(root, cp.cadence, cp.period, scope)
            : null;
        const base = current ?? (pageRes && pageRes.ok ? pageRes.value : null);
        if (!base) return writeError("Review locked and the page could not be read", "LOCKED");
        const decision = await createDecision(root, {
          target: {
            type: "review-page",
            cadence: cp.cadence,
            period: cp.period,
            scope,
            rev: base.rev,
          },
          proposedTitle: base.title,
          proposedBodyMarkdown: body,
          previousBodyMarkdown: base.bodyMarkdown,
          actor,
        });
        if (!decision.ok) return vaultError(decision.error);
        return {
          decision: true,
          id: decision.value.id,
          decisionId: decision.value.id,
          status: decision.value.status,
        };
      }
      if (written.code === "CONFLICT") {
        return {
          error: {
            code: "CONFLICT",
            message:
              "The page changed on disk since you read it. Call get_review with the same scope, then re-apply only your section to the body it returns; keep every other section and its prose exactly as read.",
          },
          current: written.current ?? null,
        };
      }
      return writeError(written.error, written.code);
    }

    case "mark_review_done": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      const scope = typeof args.scope === "string" ? args.scope : "overall";
      const result = await markReviewDone(root, {
        cadence: cp.cadence,
        period: cp.period,
        scope,
        // AGENT-09: the life-log line names the actor that marked it.
        actor,
      });
      if (!result.ok) {
        // The gate is not malformed input: it is a state the companion can name
        // and the operator can clear, so it gets its own code.
        if (/^Finish every area review first/.test(result.error)) {
          return { error: { code: "GATED", message: result.error } };
        }
        if (/locked/i.test(result.error)) {
          return { error: { code: "LOCKED", message: result.error } };
        }
        return vaultError(result.error);
      }
      return { review: result.value };
    }

    case "unlock_review": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      // AGENT-14: user-actor-only in the engine. An agent caller (the companion
      // included) is refused there; report that refusal in the grant's own
      // vocabulary rather than as a malformed argument. A connected agent never
      // reaches this branch at all (the name is not in a grant set any more).
      const result = await unlockReview(root, cp.cadence, cp.period, actor);
      if (!result.ok) {
        if (result.error === "Only the operator can unlock a review") {
          return { error: { code: "FORBIDDEN", message: result.error } };
        }
        return vaultError(result.error);
      }
      return { review: result.value };
    }

    case "get_period_pack": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      const scope = typeof args.scope === "string" ? args.scope : "overall";
      const result = await getPeriodPack(root, {
        cadence: cp.cadence,
        period: cp.period,
        scope,
      });
      if (!result.ok) return vaultError(result.error);
      return { pack: result.value };
    }

    case "get_review_skill": {
      const cadence = args.cadence;
      if (typeof cadence !== "string" || !isReviewCadence(cadence)) {
        return { error: { code: "MALFORMED", message: `Invalid cadence: ${String(cadence)}` } };
      }
      const skill = await getReviewSkill(root, cadence);
      if (!skill.ok) return vaultError(skill.error);
      return {
        skill: {
          cadence: skill.value.cadence,
          markdown: skill.value.markdown,
          snapshots: skill.value.snapshots.map((d) => ({
            id: d.id,
            domain: d.domain,
            section: d.section,
            title: d.title,
            window: d.window,
          })),
          problems: skill.value.problems,
          fileWritten: skill.value.exists,
        },
      };
    }

    case "write_review_skill": {
      const cadence = args.cadence;
      if (typeof cadence !== "string" || !isReviewCadence(cadence)) {
        return { error: { code: "MALFORMED", message: `Invalid cadence: ${String(cadence)}` } };
      }
      const markdown = args.markdown;
      if (typeof markdown !== "string" || !markdown.trim()) {
        return { error: { code: "MALFORMED", message: "markdown is required" } };
      }
      const written = await writeReviewSkill(root, cadence, markdown, actor);
      if (!written.ok) return vaultError(written.error);
      return {
        skill: {
          cadence: written.value.cadence,
          markdown: written.value.markdown,
          snapshots: written.value.snapshots.map((d) => ({
            id: d.id,
            domain: d.domain,
            section: d.section,
            title: d.title,
            window: d.window,
          })),
          problems: written.value.problems,
          fileWritten: true,
        },
      };
    }

    case "get_review_template": {
      const scope = args.scope;
      if (typeof scope !== "string" || !scope.trim()) {
        return {
          error: {
            code: "MALFORMED",
            message: 'scope is required — pass the area slug whose page contract you are reading',
          },
        };
      }
      const template = await getReviewPageTemplate(root, scope);
      if (!template.ok) return vaultError(template.error);
      return {
        template: {
          scope: template.value.scope,
          extras: template.value.extras,
          exists: template.value.exists,
          problems: template.value.problems,
          fileWritten: template.value.exists,
        },
      };
    }

    case "write_review_template": {
      const scope = args.scope;
      if (typeof scope !== "string" || !scope.trim()) {
        return {
          error: {
            code: "MALFORMED",
            message: 'scope is required — pass the area slug whose page contract you are replacing',
          },
        };
      }
      const markdown = args.markdown;
      if (typeof markdown !== "string" || !markdown.trim()) {
        return { error: { code: "MALFORMED", message: "markdown is required" } };
      }
      const written = await writeReviewPageTemplate(root, scope, markdown, actor);
      if (!written.ok) return vaultError(written.error);
      return {
        template: {
          scope: written.value.scope,
          extras: written.value.extras,
          exists: written.value.exists,
          problems: written.value.problems,
          fileWritten: true,
        },
      };
    }

    default:
      return { error: { code: "MALFORMED", message: "Unknown tool" } };
  }
}
