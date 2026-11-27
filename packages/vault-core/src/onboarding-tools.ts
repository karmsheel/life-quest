import type { MapToolDef } from "./map/tools.ts";
import {
  ONBOARDING_AREA_MAX,
  ONBOARDING_AREA_MIN,
  ONBOARDING_TABLE_COLUMN_MAX,
  confirmOnboarding,
  discardOnboardingProposal,
  readOnboardingRecord,
  startOnboarding,
  writeOnboardingProposal,
} from "./onboarding.ts";
import { DATABASE_COLUMN_TYPES, type Actor } from "./types.ts";

/**
 * The companion's one onboarding tool: `propose_onboarding_unlock`.
 *
 * P1 Amendment 2 (2026-11-09): the interview is PASSIVE. The operator is never
 * asked to unlock anything — after the conversation the companion has heard
 * enough, calling this tool validates and writes the proposal and then applies it
 * in the same request (`confirmOnboarding({ keepProposal: true })`): the 1–3
 * areas open, the doctrine is drafted, at most one table is created and the one
 * note is written. The app's card is only an ANNOUNCEMENT of what was opened, with
 * one Continue button, and the kept proposal file is that card's receipt.
 *
 * The five seeded area slugs are NOT enumerated in the schema on purpose: they
 * are the companion's private rubric, which it carries in its own instructions.
 * The engine is what refuses a slug outside that set (and an area that is
 * already open), so the taxonomy never has to be leaked into a tool result for
 * the rules to hold.
 */
export const ONBOARDING_TOOL_DEFS: MapToolDef[] = [
  {
    name: "propose_onboarding_unlock",
    description:
      "Open what the onboarding interview heard, right now. Calling this OPENS the " +
      `${ONBOARDING_AREA_MIN}–${ONBOARDING_AREA_MAX} areas immediately: it unlocks them, writes their ` +
      "premise/what/why/how drafts, creates at most one table and writes the one note. There is no " +
      "question and no consent step — the app then shows the operator a card that says what was " +
      "opened (\"After analyzing our conversation, I've opened up the Health and Business areas for " +
      "you.\"), with a single Continue button. So call it ONCE, only when you have genuinely heard " +
      "enough; do not call it early to ask whether they want it.\n" +
      `- \`areas\`: ${ONBOARDING_AREA_MIN}–${ONBOARDING_AREA_MAX} seeded areas the interview heard ` +
      "in the operator's own words, each with its four doctrine drafts (premise, what, why, how), " +
      "all four required and non-empty — an opened area must never be blank. Never name an area " +
      "that is already open. Do not enumerate the five areas to the operator; the card names only " +
      "the ones this call opened.\n" +
      "- `table`: at most ONE table, drawn from the conversation's clearest ask, on one of the " +
      `opened areas, with 1–${ONBOARDING_TABLE_COLUMN_MAX} hand-written columns ` +
      "(`text` | `number` | `date` | `select` | `checkbox` | `file`; `select` needs `options`; " +
      "`relation` is not available yet). Pass null when the interview asked for none.\n" +
      "- `note`: required. One short note of the conversation, written into the Life area, so the " +
      "session has a record outside the chat transcript. `title` defaults to " +
      "\"First conversation — <today>\".\n" +
      "Refused once onboarding is complete (never reopen what is already open, and never run the " +
      "interview again). If the call errors, nothing was left half-open as a receipt — tell the " +
      "operator plainly and do not re-ask the interview's questions. Never write anything the " +
      "operator did not say.",
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
 * Dispatch one onboarding tool call.
 *
 * The tool is a WRITE THAT ALSO APPLIES: write the proposal, then run the same
 * batch the old confirmation card ran, with `keepProposal: true` so the applied
 * proposal stays behind as the announcement card's receipt. By the time this
 * resolves the record is `completed`, `onboarding.completed` is logged once and
 * the areas are open — the renderer paints the announcement from vault truth.
 *
 * A failed apply never leaves a receipt: the proposal file is deleted and the
 * error returned, so the companion can retry (the record stays in progress).
 * The app's tool wrapper repaints for any tool that is not read-only (this one is
 * in `COMPANION_ONLY_TOOLS`, not read-only), which is what makes the card appear.
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
              "Onboarding is complete; the interview does not run again and no area can be reopened.",
          },
        };
      }
      // A companion turn can open areas before the operator clicks Begin. Start
      // the interview under the companion's actor first (idempotent), so the
      // `onboarding.started` event names who began it; the writer's own implicit
      // start then sees `in_progress` and does nothing.
      if (recordRes.value.status === "not_started") {
        const startRes = await startOnboarding(root, actor);
        if (!startRes.ok) return { error: { code: "IO", message: startRes.error } };
      }
      const written = await writeOnboardingProposal(root, args);
      if (!written.ok) {
        const code = written.error.includes("Onboarding is complete") ? "FORBIDDEN" : "MALFORMED";
        return { error: { code, message: written.error } };
      }
      // Apply it now. The receipt is kept on success; on failure it must not
      // linger — a card announcing an opening that did not land is a lie.
      const applied = await confirmOnboarding(root, { keepProposal: true });
      if (!applied.ok) {
        await discardOnboardingProposal(root);
        return { error: { code: "FAILED", message: applied.error } };
      }
      return {
        proposal: written.value,
        // `opened.areas` carries the names as well as the slugs: the companion
        // needs to be able to say what it opened without re-deriving a display
        // name, and the card's copy is drawn from the kept receipt, not from here.
        opened: {
          areas: written.value.areas.map((area) => ({ slug: area.slug, name: area.name })),
          table: applied.value.table,
          note: applied.value.note,
        },
      };
    }

    default:
      return { error: { code: "MALFORMED", message: `Unknown onboarding tool: ${name}` } };
  }
}
