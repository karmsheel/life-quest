import type { MapToolDef } from "./map/tools.ts";
import type { Actor, ReviewCadence } from "./types.ts";
import { createDecision } from "./decisions.ts";
import { isReviewCadence } from "./period.ts";
import { getPeriodPack } from "./period-pack.ts";
import {
  composeReviewPageWrite,
  getReview,
  getReviewPageBody,
  listReviewIndex,
  markReviewDone,
  unlockReview,
  writeReview,
  writeReviewPage,
} from "./reviews.ts";
import { getReviewSkill, writeReviewSkill } from "./review-skills.ts";

export const REVIEW_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_review",
    description:
      "Read a review by cadence and period. With scope (\"overall\" or an area slug) returns that page only — your page, its four headings, its status and the file's rev to quote back when you write. Without scope returns the whole file (legacy read).",
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
      "Write one page of a review. Call get_review with the same scope first, then pass the body of that page (one # title and the four ## headings) and its rev. Only that scope's headings are replaced, so another area's review is never touched. A CONFLICT means the file moved under you: read the page again and re-apply your section. Locked reviews become a pending Decision. Without scope, writes a legacy whole-file body.",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        period: { type: "string" },
        scope: { type: "string" },
        body: { type: "string" },
        baseRev: { type: "number" },
      },
      required: ["cadence", "period", "body"],
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
      if (scope === null) return { review: result.value };
      const page = await getReviewPageBody(root, cp.cadence, cp.period, scope);
      if (!page.ok) return vaultError(page.error);
      // `review` rides along for the grant projection the tool door applies to
      // connected agents; a companion reads `page`.
      return { review: result.value, page: page.value };
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
      const scope = typeof args.scope === "string" ? args.scope : null;
      const baseRev = typeof args.baseRev === "number" ? args.baseRev : undefined;

      // No scope is the pre-page contract: a whole-file body from a session that
      // was started before scopes existed. It still lands, but it has no guard
      // beyond the mutex — the page and scoped paths are the safe ones.
      if (scope === null) {
        const written = await writeReview(root, {
          cadence: cp.cadence,
          period: cp.period,
          bodyMarkdown: body,
          actor,
          baseRev,
        });
        if (!written.ok) {
          if (written.code === "LOCKED" && written.current) {
            const decision = await createDecision(root, {
              target: { type: "review", cadence: cp.cadence, period: cp.period },
              proposedBodyMarkdown: body,
              previousBodyMarkdown: written.current.bodyMarkdown,
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
          return writeError(written.error, written.code);
        }
        return { review: written.value };
      }

      // A scoped write is a page merge: the companion owns these headings and
      // nothing else.
      const written = await writeReviewPage(root, {
        cadence: cp.cadence,
        period: cp.period,
        scope,
        bodyMarkdown: body,
        actor,
        baseRev,
      });
      if (written.ok) {
        return { review: written.value, scope };
      }
      if (written.code === "LOCKED") {
        // The approved change has to be a whole-file body, so compose the same
        // merge the write would have landed against the current file rather than
        // storing the companion's page as if it were the whole review.
        const composed = await composeReviewPageWrite(root, {
          cadence: cp.cadence,
          period: cp.period,
          scope,
          bodyMarkdown: body,
        });
        if (!composed.ok) return vaultError(composed.error);
        let current = written.current;
        if (!current) {
          const reread = await getReview(root, cp.cadence, cp.period);
          if (!reread.ok) return writeError(reread.error, "NOT_FOUND");
          current = reread.value;
        }
        const decision = await createDecision(root, {
          target: { type: "review", cadence: cp.cadence, period: cp.period },
          proposedBodyMarkdown: composed.value.bodyMarkdown,
          previousBodyMarkdown: current.bodyMarkdown,
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
      if (!result.ok) return vaultError(result.error);
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

    default:
      return { error: { code: "MALFORMED", message: "Unknown tool" } };
  }
}
