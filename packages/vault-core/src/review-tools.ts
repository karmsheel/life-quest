import type { MapToolDef } from "./map/tools.ts";
import type { Actor, ReviewCadence } from "./types.ts";
import { createDecision } from "./decisions.ts";
import { isReviewCadence } from "./period.ts";
import { getPeriodPack } from "./period-pack.ts";
import {
  getReview,
  listReviewIndex,
  markReviewDone,
  unlockReview,
  writeReview,
} from "./reviews.ts";

export const REVIEW_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_review",
    description: "Read a review file by cadence and period",
    parameters: {
      type: "object",
      properties: { cadence: { type: "string" }, period: { type: "string" } },
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
    description: "Write a review body. Locked reviews become a pending Decision.",
    parameters: {
      type: "object",
      properties: {
        cadence: { type: "string" },
        period: { type: "string" },
        body: { type: "string" },
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
    description: "Unlock a locked review so it can be edited in place",
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
];

type ReviewToolResult =
  | Record<string, unknown>
  | { error: { code: string; message: string } };

function vaultError(error: string): ReviewToolResult {
  const code = /not found/i.test(error) ? "NOT_FOUND" : "MALFORMED";
  return { error: { code, message: error } };
}

function requireCadencePeriod(
  args: Record<string, unknown>,
): { cadence: ReviewCadence; period: string } | ReviewToolResult {
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
      return { review: result.value };
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
      const written = await writeReview(root, {
        cadence: cp.cadence,
        period: cp.period,
        bodyMarkdown: body,
        actor,
      });
      if (!written.ok) {
        if (written.error === "LOCKED") {
          const current = await getReview(root, cp.cadence, cp.period);
          if (!current.ok) return vaultError(current.error);
          const decision = await createDecision(root, {
            target: { type: "review", cadence: cp.cadence, period: cp.period },
            proposedBodyMarkdown: body,
            previousBodyMarkdown: current.value.bodyMarkdown,
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
        return vaultError(written.error);
      }
      return { review: written.value };
    }

    case "mark_review_done": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      const scope = typeof args.scope === "string" ? args.scope : "overall";
      const result = await markReviewDone(root, {
        cadence: cp.cadence,
        period: cp.period,
        scope,
      });
      if (!result.ok) return vaultError(result.error);
      return { review: result.value };
    }

    case "unlock_review": {
      const cp = requireCadencePeriod(args);
      if ("error" in cp) return cp;
      const result = await unlockReview(root, cp.cadence, cp.period);
      if (!result.ok) return vaultError(result.error);
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

    default:
      return { error: { code: "MALFORMED", message: "Unknown tool" } };
  }
}
