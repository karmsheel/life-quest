import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import { getDailyNote, listDailyNotes } from "./daily-notes.ts";
import { isValidLocalIsoDate, todayLocalIso } from "./period.ts";

/**
 * The companion's daily-note surface: read-only, on purpose.
 *
 * The note for a day is the operator's own writing — "the user can write one note
 * for the day" — so the agent may cite it and never author it. A review session
 * receives the notes inside its period window through the period pack; these two
 * tools are how it asks for the index, or for a day outside the window it was
 * handed.
 */
export const DAILY_NOTE_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_daily_notes",
    description:
      "List the operator's daily notes (their journal), newest first, as an index of " +
      "date (YYYY-MM-DD) plus when each was last written. Pass start and/or end to " +
      "limit the index to a window. Days that have not happened and files that name no " +
      "usable day are reported separately, not as notes. This returns no note bodies: " +
      "use get_daily_note for one, or get_period_pack to receive the notes inside a " +
      "review's window.",
    parameters: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "Earliest date to include, YYYY-MM-DD (inclusive).",
        },
        end: {
          type: "string",
          description: "Latest date to include, YYYY-MM-DD (inclusive).",
        },
        limit: {
          type: "number",
          description: "Maximum number of days to return (default 60, max 400).",
        },
      },
    },
  },
  {
    name: "get_daily_note",
    description:
      "Read the operator's daily note for one local date (YYYY-MM-DD), including its " +
      "markdown body. A day with no note is not an error: it comes back as found: " +
      "false, which means the operator wrote nothing that day.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "The note's local calendar date, YYYY-MM-DD.",
        },
      },
      required: ["date"],
    },
  },
];

type DailyNoteToolResult =
  | Record<string, unknown>
  | { error: { code: string; message: string } };

function invalid(message: string): DailyNoteToolResult {
  return { error: { code: "MALFORMED", message } };
}

/**
 * `actor` is accepted so this executor has the shape every other one has at the
 * dispatch site, and is deliberately unused: there is no write path here to
 * attribute, and the operator is the only author of a daily note.
 */
export async function executeDailyNoteTool(
  root: string,
  _actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<DailyNoteToolResult> {
  switch (name) {
    case "list_daily_notes": {
      const start = args.start;
      const end = args.end;
      if (start !== undefined && (typeof start !== "string" || !isValidLocalIsoDate(start))) {
        return invalid(`Invalid start date: ${String(start)}`);
      }
      if (end !== undefined && (typeof end !== "string" || !isValidLocalIsoDate(end))) {
        return invalid(`Invalid end date: ${String(end)}`);
      }
      if (typeof start === "string" && typeof end === "string" && start > end) {
        return invalid(`start ${start} is after end ${end}`);
      }

      const rawLimit = args.limit;
      let limit = 60;
      if (rawLimit !== undefined) {
        if (
          typeof rawLimit !== "number" ||
          !Number.isFinite(rawLimit) ||
          !Number.isInteger(rawLimit) ||
          rawLimit < 1 ||
          rawLimit > 400
        ) {
          return invalid("limit must be an integer between 1 and 400");
        }
        limit = rawLimit;
      }

      const listed = await listDailyNotes(root);
      if (!listed.ok) {
        return { error: { code: "IO", message: listed.error } };
      }
      // Two kinds of row are on disk but are not days the operator has written:
      // a file that names no usable day, and a day that has not happened. Both
      // are reported rather than handed over as notes, exactly as the review pack
      // leaves them out.
      const unreadable = listed.value
        .filter((entry) => entry.error)
        .map((entry) => entry.date);
      const today = todayLocalIso();
      const future = listed.value
        .filter((entry) => !entry.error && entry.date > today)
        .map((entry) => entry.date);
      let days = listed.value.filter(
        (entry) => !entry.error && entry.date <= today,
      );
      if (typeof start === "string") days = days.filter((entry) => entry.date >= start);
      if (typeof end === "string") days = days.filter((entry) => entry.date <= end);
      // Newest first: a journal is asked about from its most recent end.
      days = days.slice().reverse();
      const total = days.length;
      const truncated = total > limit;
      if (truncated) days = days.slice(0, limit);
      return { days, total, truncated, unreadable, future };
    }

    case "get_daily_note": {
      const date = args.date;
      if (typeof date !== "string" || !isValidLocalIsoDate(date)) {
        return invalid(`Invalid date: ${String(date)}`);
      }
      const found = await getDailyNote(root, date);
      if (!found.ok) {
        if (/not found/i.test(found.error)) return { date, found: false, note: null };
        return { error: { code: "IO", message: found.error } };
      }
      return { date, found: true, note: found.value };
    }

    default:
      return invalid(`Unknown tool: ${name}`);
  }
}
