import type { MapToolDef } from "./map/tools.ts";
import {
  BRIEF_DISMISSALS_SHOWN,
  readCompanionBrief,
  setCompanionBrief,
} from "./companion-brief.ts";
import {
  BRIEF_ITEMS_MAX,
  BRIEF_KINDS,
  BRIEF_TEXT_MAX,
  BRIEF_WHY_MAX,
  type Actor,
  type BriefItemInput,
} from "./types.ts";

/**
 * The companion's brief surface: one read, one replace, and no dismiss.
 *
 * `set_companion_brief` is the only writer and the vault refuses any actor but
 * the companion. The operator's verb — dismissing an item — is deliberately NOT
 * here: the companion must not be able to clear its own mistakes, and must not
 * be able to "complete" an item it got wrong. That call is the operator's UI,
 * over IPC, as a user actor.
 *
 * The two tools are the companion's memory of its own brief: read it at the
 * start of a session to see what it said yesterday and what the operator
 * answered, then re-derive it when the day or the facts change. A write is a
 * REPLACEMENT, never an append, so yesterday's items disappear unless they are
 * written again.
 */
export const COMPANION_BRIEF_TOOL_DEFS: MapToolDef[] = [
  {
    name: "get_companion_brief",
    description:
      "Read the companion brief: the operator's dashboard card that says what you would tell them " +
      "if you had thirty seconds with them this morning. Returns `writtenAt`, the ACTIVE items " +
      "(current and not dismissed, in priority order), and the last " +
      `${BRIEF_DISMISSALS_SHOWN} dismissals — the operator's answers plus any \`expired-unseen\` ` +
      "items nobody acted on. An item past its expiry is not active; it is still visible in the " +
      "dismissal log as `expired-unseen`, which is your feedback. Read this at the start of a " +
      "session before writing a new brief. Do not ask the operator to read it out to you.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "set_companion_brief",
    description:
      "Write the companion brief for today. This REPLACES the whole active set in one call: an " +
      "item not present in `items` is gone, because the brief is re-derived every day, not " +
      "appended to. At most " +
      `${BRIEF_ITEMS_MAX} items; each item is TYPED, SOURCED and EXPIRING, never free text:\n` +
      "- `kind`: watch (body, money, a risk) | prompt (a question to think about, not a task) | " +
      "ahead (a deadline, renewal or follow-up falling due) | commitment (the operator said they " +
      "would do X and has not) | pattern (the same thing said, done or avoided N times).\n" +
      `- \`text\`: the one line they read, 1–${BRIEF_TEXT_MAX} characters.\n` +
      `- \`why\`: the justification, 1–${BRIEF_WHY_MAX} characters. Required — a brief item ` +
      "without a reason is wallpaper.\n" +
      "- `sourceRef`: where it came from, e.g. \"note 2026-11-05\", \"signal:<id>\", " +
      "\"task:<id>\", \"conversation 2026-11-04\".\n" +
      "- `domainSlug`: null for vault-wide, or a domain slug to show it only on that board's lens.\n" +
      "- `priority`: 1–5, where 1 is read first.\n" +
      "- `expiresAt`: optional ISO instant after `createdAt` (the server stamps createdAt). Omit " +
      "it and prompt/ahead stand until the end of the local day, while watch/commitment/pattern " +
      "stand seven days. Nothing here is turned into a task or a Decision.\n" +
      "The operator dismisses items themselves (done / not-useful / wrong / later); you cannot " +
      "clear an item or mark it done. The reply returns the stored set and " +
      "`expiredSincePreviousWrite` — how many of your previous items lapsed with no answer — so " +
      "you can see what you got wrong. Write a fresh brief at the end of a daily-note pass, at " +
      "the top of a weekly review, and when a note is revised.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description:
            `The complete new active set, at most ${BRIEF_ITEMS_MAX} items. Each item requires ` +
            "kind, text, why and priority; sourceRef, domainSlug and expiresAt are optional.",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: [...BRIEF_KINDS],
                description: "watch | prompt | ahead | commitment | pattern",
              },
              text: {
                type: "string",
                description: `The line the operator reads (1–${BRIEF_TEXT_MAX} characters).`,
              },
              why: {
                type: "string",
                description: `Why it is on the brief (1–${BRIEF_WHY_MAX} characters). Required.`,
              },
              sourceRef: {
                type: "string",
                description:
                  "Where it came from, e.g. \"note 2026-11-05\", \"signal:<id>\", " +
                  "\"task:<id>\", \"conversation 2026-11-04\".",
              },
              domainSlug: {
                type: "string",
                description:
                  "A domain slug to show the item only on that board's lens; null for vault-wide.",
              },
              priority: {
                type: "number",
                description: "1–5; 1 is read first.",
              },
              expiresAt: {
                type: "string",
                description:
                  "ISO instant after now. Omit for the kind's default (prompt/ahead: end of " +
                  "the local day; watch/commitment/pattern: seven days).",
              },
            },
            required: ["kind", "text", "why", "priority"],
          },
        },
      },
      required: ["items"],
    },
  },
];

type BriefToolResult = Record<string, unknown> | { error: { code: string; message: string } };

function invalid(message: string): BriefToolResult {
  return { error: { code: "MALFORMED", message } };
}

/**
 * `now` is accepted for the same reason the view and note tools accept it: a
 * test that claims what "today" means has to be able to say which day it is
 * drawing on. Production omits it and gets the real clock.
 */
export async function executeCompanionBriefTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
  now: Date = new Date(),
): Promise<BriefToolResult> {
  switch (name) {
    case "get_companion_brief": {
      const res = await readCompanionBrief(root, now);
      if (!res.ok) return { error: { code: "IO", message: res.error } };
      const empty = res.value.items.length === 0;
      return {
        writtenAt: res.value.writtenAt,
        writtenBy: res.value.writtenBy,
        items: res.value.items,
        dismissals: res.value.dismissals,
        ...(res.value.problems.length > 0 ? { problems: res.value.problems } : {}),
        ...(empty
          ? {
              note:
                "The brief has no active items. Write the next one with set_companion_brief; " +
                "the card says \"Nothing on the brief today\" until you do.",
            }
          : {}),
      };
    }

    case "set_companion_brief": {
      const res = await setCompanionBrief(
        root,
        actor,
        { items: args.items as BriefItemInput[] },
        now,
      );
      if (!res.ok) {
        const code = res.error === "the brief is written by the companion only" ? "FORBIDDEN" : "MALFORMED";
        return { error: { code, message: res.error } };
      }
      return {
        writtenAt: res.value.brief.writtenAt,
        writtenBy: res.value.brief.writtenBy,
        items: res.value.brief.items,
        expiredSincePreviousWrite: res.value.expiredSincePreviousWrite,
      };
    }

    default:
      return invalid(`Unknown companion brief tool: ${name}`);
  }
}
