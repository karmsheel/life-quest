import { todayLocalIso } from "./map/public.ts";
import type { MapToolDef } from "./map/tools.ts";
import type { Actor } from "./types.ts";
import { captureUtterance, undoCapture, correctCapture } from "./capture.ts";

export const CAPTURE_TOOL_DEFS: MapToolDef[] = [
  {
    name: "capture_transaction",
    description: "Parse a natural-language description of an expense or income and post a transaction. Requires an unambiguous amount and account. Returns a receipt naming the amount, currency, date, account, and category.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The transaction description, e.g. 'Bought food for R85 today'." },
        threadId: { type: "string", description: "Optional thread id for undo/correct grouping. Defaults to 'companion'." },
        today: { type: "string", description: "Optional YYYY-MM-DD date for 'today'. Defaults to local date." },
      },
      required: ["text"],
    },
  },
  {
    name: "undo_capture",
    description: "Undo the most recent capture_transaction in this thread. Deletes the captured transaction row. A second undo in the same thread returns 'Nothing to undo' and deletes nothing.",
    parameters: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Optional thread id. Defaults to 'companion'." },
      },
    },
  },
  {
    name: "correct_capture",
    description: "Re-parse a corrected description against the same transaction row that was last posted in this thread. Updates in place; does not create a second row. If the corrected text is still ambiguous, leaves the existing row unchanged.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The corrected transaction description." },
        threadId: { type: "string", description: "Optional thread id. Defaults to 'companion'." },
        today: { type: "string", description: "Optional YYYY-MM-DD date for 'today'. Defaults to local date." },
      },
      required: ["text"],
    },
  },
];

export async function executeCaptureTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "capture_transaction": {
      const text = typeof args.text === "string" ? args.text : "";
      const threadId = typeof args.threadId === "string" && args.threadId ? args.threadId : "companion";
      const today = typeof args.today === "string" && args.today ? args.today : todayLocalIso();
      const result = await captureUtterance(root, { text, today, threadId, actor });
      return result.ok ? result.value : { error: { code: "FAILED", message: result.error } };
    }
    case "undo_capture": {
      const threadId = typeof args.threadId === "string" && args.threadId ? args.threadId : "companion";
      const result = await undoCapture(root, { threadId, actor });
      return result.ok ? result.value : { error: { code: "FAILED", message: result.error } };
    }
    case "correct_capture": {
      const text = typeof args.text === "string" ? args.text : "";
      const threadId = typeof args.threadId === "string" && args.threadId ? args.threadId : "companion";
      const today = typeof args.today === "string" && args.today ? args.today : todayLocalIso();
      const result = await correctCapture(root, { text, today, threadId, actor });
      return result.ok ? result.value : { error: { code: "FAILED", message: result.error } };
    }
    default:
      return { error: { code: "MALFORMED", message: "Unknown capture tool" } };
  }
}
