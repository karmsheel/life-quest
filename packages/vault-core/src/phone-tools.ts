/**
 * The companion's three phone tools.
 *
 * A draft is not a transaction. The phone can only queue one; the companion
 * turns one into a row here, through the same `captureUtterance` the chat has
 * always used, and only after the operator has confirmed it in that chat. The
 * tools are companion-only: a paired agent is refused by `toolAllowed` and
 * never sees them in its manifest.
 *
 * The verification available to this layer is shape, not intent: one draft can
 * produce at most one row, a resolved draft is refused rather than re-posted,
 * an id that does not exist posts nothing, and a concurrent pair of calls is
 * serialised per draft. Whether the operator actually said yes is the same
 * trust `capture_transaction` has always run on — the model is instructed and
 * the operator reads the receipt.
 */
import type { MapToolDef } from "./map/tools.ts";
import { captureUtterance } from "./capture.ts";
import {
  PHONE_DRAFT_MAX_TEXT,
  isClientId,
  normalizeDraftText,
} from "./phone.ts";
import {
  amendPhoneDraftText,
  listPhoneDrafts,
  readPhoneDraft,
  resolvePhoneDraft,
} from "./phone-queue.ts";
import type { Actor } from "./types.ts";

const MALFORMED = (message: string) => ({ error: { code: "MALFORMED", message } });
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "No phone draft with that id" } };

export const PHONE_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_phone_drafts",
    description:
      "List the drafts the operator queued on their phone that are still waiting to be posted or dismissed. Read-only. A draft is not a transaction and posting one is a separate call.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "post_phone_draft",
    description:
      "Post one draft the operator queued on their phone. Call it only after the operator confirms that draft in this chat. Pass the draft's clientId; pass `text` when the operator corrects the wording, so the correction is what the capture parses. Returns the capture receipt, the question the capture still needs answered (the draft stays pending), or the draft's existing resolution if it was already handled. Never invent a clientId.",
    parameters: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description: "The draft's id, exactly as the list_phone_drafts result or the turn's instructions gave it.",
        },
        text: {
          type: "string",
          description:
            "The operator's corrected wording for the draft. Omit when the draft's own text is already right.",
        },
      },
      required: ["clientId"],
    },
  },
  {
    name: "dismiss_phone_draft",
    description:
      "Dismiss a phone draft the operator does not want posted. Writes no transaction. Idempotent: dismissing an already-resolved draft reports its resolution.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "The draft's id." },
      },
      required: ["clientId"],
    },
  },
];

/**
 * One post per draft at a time, in this process. A second call waits for the
 * first and then reports the resolution, so a double-clicked confirmation
 * cannot produce two transactions.
 */
const posting = new Map<string, Promise<unknown>>();

async function withPostLock<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
  const running = posting.get(clientId);
  if (running) await running.catch(() => undefined);
  const task = fn();
  posting.set(clientId, task);
  try {
    return await task;
  } finally {
    if (posting.get(clientId) === task) posting.delete(clientId);
  }
}

async function postDraft(
  root: string,
  actor: Actor,
  clientId: string,
  textOverride: string | undefined,
): Promise<unknown> {
  const read = await readPhoneDraft(root, clientId);
  if (!read.ok) return NOT_FOUND;
  const draft = read.value;
  if (draft.status !== "pending") {
    return {
      clientId,
      alreadyResolved: draft.status,
      rowId: draft.rowId,
      receipt: draft.receipt,
    };
  }

  let text = draft.text;
  if (textOverride !== undefined) {
    const normalized = normalizeDraftText(textOverride);
    if (normalized === null) {
      return MALFORMED(`Draft text must be 1–${PHONE_DRAFT_MAX_TEXT} characters`);
    }
    text = normalized;
    const amended = await amendPhoneDraftText(root, clientId, text);
    if (!amended.ok) return NOT_FOUND;
  }

  const captured = await captureUtterance(root, {
    text,
    // The capture's "today" is the day the draft was written, so a draft
    // saying "today" lands on the day the operator meant, not the sync day.
    today: draft.captureDate,
    threadId: `phone:${clientId}`,
    actor,
    phoneDraftId: clientId,
  });
  if (!captured.ok) return MALFORMED(captured.error);

  const outcome = captured.value;
  if (!outcome.posted) {
    return {
      clientId,
      posted: false,
      ask: outcome.ask,
      draftStillPending: true,
    };
  }

  const resolved = await resolvePhoneDraft(root, clientId, {
    status: "posted",
    rowId: outcome.rowId,
    receipt: outcome.receipt,
  });
  return resolved.ok
    ? { clientId, ...outcome, resolved: true }
    : { clientId, ...outcome, resolved: false, resolveError: resolved.error };
}

async function dismissDraft(root: string, clientId: string): Promise<unknown> {
  const read = await readPhoneDraft(root, clientId);
  if (!read.ok) return NOT_FOUND;
  if (read.value.status !== "pending") {
    return { clientId, alreadyResolved: read.value.status };
  }
  const resolved = await resolvePhoneDraft(root, clientId, { status: "dismissed" });
  if (!resolved.ok) return { clientId, alreadyResolved: resolved.error };
  return { clientId, status: "dismissed" };
}

/** Dispatch for the three phone tools; map-tools calls this by name. */
export async function executePhoneTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const clientId =
    typeof args.clientId === "string" ? args.clientId : "";

  switch (name) {
    case "list_phone_drafts": {
      const listed = await listPhoneDrafts(root, { status: "pending" });
      if (!listed.ok) return MALFORMED(listed.error);
      return {
        drafts: listed.value.drafts.map((draft) => ({
          clientId: draft.clientId,
          text: draft.text,
          captureDate: draft.captureDate,
          capturedAt: draft.capturedAt,
          deviceName: draft.deviceName,
        })),
        count: listed.value.drafts.length,
      };
    }
    case "post_phone_draft": {
      if (!isClientId(clientId)) {
        return MALFORMED("clientId must be a UUID v4");
      }
      const textOverride =
        typeof args.text === "string" ? args.text : undefined;
      return withPostLock(clientId, () =>
        postDraft(root, actor, clientId, textOverride),
      );
    }
    case "dismiss_phone_draft": {
      if (!isClientId(clientId)) {
        return MALFORMED("clientId must be a UUID v4");
      }
      return dismissDraft(root, clientId);
    }
    default:
      return MALFORMED(`Unknown phone tool ${name}`);
  }
}
