import type { MapToolDef } from "./map/tools.ts";
import {
  ONBOARDING_AREA_MAX,
  ONBOARDING_AREA_MIN,
  ONBOARDING_TABLE_COLUMN_MAX,
  readOnboardingProposal,
  readOnboardingRecord,
  startOnboarding,
  writeOnboardingProposal,
} from "./onboarding.ts";
import { DATABASE_COLUMN_TYPES, type Actor } from "./types.ts";

/**
 * The companion's one onboarding tool: `propose_onboarding_unlock`.
 *
 * The interview's confirmation is a SINGLE operator-confirmed batch, so the
 * companion's only write is one proposal. Nothing in it reaches the vault until
 * the operator confirms the card the app draws from it; calling the tool again
 * replaces the pending proposal (the operator asked for a change) — which is also
 * how "proposalPending" is revised.
 *
 * The five seeded area slugs are NOT enumerated in the schema on purpose: they
 * are the companion's private rubric, which it carries in its own instructions.
 * The engine is what refuses a slug outside that set (and an area that is
 * already unlocked), so the taxonomy never has to be leaked into a tool result
 * for the rules to hold.
 */
export const ONBOARDING_TOOL_DEFS: MapToolDef[] = [
  {
    name: "propose_onboarding_unlock",
    description:
      "Propose what the onboarding interview heard, as ONE confirmation card. This writes the " +
      "vault's pending onboarding proposal; NOTHING in it becomes real until the operator " +
      "confirms the card. Call it once, when the interview has heard enough, then let the card do " +
      `the talking.\n` +
      `- \`areas\`: ${ONBOARDING_AREA_MIN}–${ONBOARDING_AREA_MAX} seeded areas the interview heard ` +
      "in the operator's own words, each with its four doctrine drafts (premise, what, why, how), " +
      "all four required and non-empty. Never propose an area that is already unlocked. Do not " +
      "enumerate or name the areas to the operator before this card lists what was heard.\n" +
      "- `table`: at most ONE table, drawn from the conversation's clearest ask, on one of the " +
      `proposed areas, with 1–${ONBOARDING_TABLE_COLUMN_MAX} hand-written columns ` +
      "(`text` | `number` | `date` | `select` | `checkbox` | `file`; `select` needs `options`; " +
      "`relation` is not available yet). Pass null when the interview asked for none.\n" +
      "- `note`: required. One short note of the conversation, written into the Life area, so the " +
      "session has a record outside the chat transcript. `title` defaults to " +
      "\"First conversation — <today>\".\n" +
      "If the operator asks for a change after the card is up, call this tool again with the " +
      "revised proposal; the new one replaces the pending one. Refused once onboarding is " +
      "complete. Never write anything the operator did not say.",
    parameters: {
      type: "object",
      properties: {
        areas: {
          type: "array",
          description:
            `${ONBOARDING_AREA_MIN}–${ONBOARDING_AREA_MAX} seeded areas the interview heard, ` +
            "each with a slug and its four doctrine bodies.",
          items: {
            type: "object",
            properties: {
              slug: {
                type: "string",
                description: "The seeded area's slug, exactly as it appears in your rubric.",
              },
              doctrine: {
                type: "object",
                description:
                  "The four doctrine bodies drafted from the operator's words. All four are " +
                  "required and must be non-empty.",
                properties: {
                  premise: { type: "string", description: "Beliefs & Premise — what they hold about this area." },
                  what: { type: "string", description: "Vision & Desire — what they want it to become." },
                  why: { type: "string", description: "Purpose — why it matters to them." },
                  how: { type: "string", description: "Strategy — how they intend to get there." },
                },
                required: ["premise", "what", "why", "how"],
              },
            },
            required: ["slug", "doctrine"],
          },
        },
        table: {
          type: ["object", "null"],
          description:
            "At most one table, from the conversation's clearest ask, on one of the proposed " +
            "areas. Null when there is none.",
          properties: {
            areaSlug: {
              type: "string",
              description: "One of this proposal's area slugs.",
            },
            name: { type: "string", description: "The table's name, as the operator said it." },
            columns: {
              type: "array",
              description: `1–${ONBOARDING_TABLE_COLUMN_MAX} columns.`,
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The column's name." },
                  type: {
                    type: "string",
                    enum: DATABASE_COLUMN_TYPES.filter((type) => type !== "relation"),
                    description: "The column's type. `relation` is not available in the first interview.",
                  },
                  options: {
                    type: "array",
                    items: { type: "string" },
                    description: "Required for `select`: its options.",
                  },
                },
                required: ["name", "type"],
              },
            },
          },
          required: ["areaSlug", "name", "columns"],
        },
        note: {
          type: "object",
          description: "Required: the one short note of the interview.",
          properties: {
            title: {
              type: "string",
              description: "Optional; defaults to \"First conversation — <today>\".",
            },
            body: { type: "string", description: "The note itself, in the operator's words." },
          },
          required: ["body"],
        },
      },
      required: ["areas", "note"],
    },
  },
];

type OnboardingToolResult = Record<string, unknown> | { error: { code: string; message: string } };

/**
 * Dispatch one onboarding tool call. The only tool is a write, and it does not
 * emit a data revision itself: the app's tool wrapper repaints for any tool that
 * is not read-only (this one is in `COMPANION_ONLY_TOOLS`, not read-only), which
 * is what makes the dock's card appear when the proposal lands.
 *
 * Errors are returned with the rule that broke, so the companion can retry once
 * with a corrected proposal instead of guessing.
 */
export async function executeOnboardingTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<OnboardingToolResult> {
  switch (name) {
    case "propose_onboarding_unlock": {
      const recordRes = await readOnboardingRecord(root);
      if (!recordRes.ok) return { error: { code: "IO", message: recordRes.error } };
      if (recordRes.value.status === "completed") {
        return {
          error: {
            code: "FORBIDDEN",
            message:
              "Onboarding is complete; the interview does not run again and no proposal can be filed.",
          },
        };
      }
      // A companion turn can propose before the operator clicks Begin. Start the
      // interview under the companion's actor first (idempotent), so the
      // `onboarding.started` event names who began it; the writer's own implicit
      // start then sees `in_progress` and does nothing.
      const started = recordRes.value.status === "not_started";
      if (started) {
        const startRes = await startOnboarding(root, actor);
        if (!startRes.ok) return { error: { code: "IO", message: startRes.error } };
      }
      const written = await writeOnboardingProposal(root, args);
      if (!written.ok) {
        const code = written.error.includes("Onboarding is complete") ? "FORBIDDEN" : "MALFORMED";
        return { error: { code, message: written.error } };
      }
      // Confirm the pending card is the one just written; a read-back also tells
      // the companion the exact shape the operator will be asked to confirm.
      const pending = await readOnboardingProposal(root);
      if (!pending.ok) {
        return { error: { code: "IO", message: pending.error } };
      }
      return {
        proposal: pending.value ?? written.value,
        note:
          "The confirmation card is in front of the operator. Nothing has been written yet — " +
          "unlocks, doctrine, table and note all apply only when they confirm. If they ask for a " +
          "change, call this tool again with the revised proposal.",
        ...(started ? { started: true } : {}),
      };
    }

    default:
      return { error: { code: "MALFORMED", message: `Unknown onboarding tool: ${name}` } };
  }
}
