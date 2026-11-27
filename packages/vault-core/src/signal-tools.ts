import type { MapToolDef } from "./map/tools.ts";
import { isDomainLive } from "./domain-databases.ts";
import { appendLog } from "./log.ts";
import { createSignal, listSignals, updateSignal } from "./signal-chain.ts";
import {
  SIGNAL_PRIORITIES,
  SIGNAL_STATUSES,
  SIGNAL_TYPES,
  type Actor,
  type SignalPriority,
  type SignalStatus,
  type SignalType,
  type SignalUpdatePatch,
} from "./types.ts";

/**
 * The companion's Notebox surface: the operator's captured thoughts, ideas,
 * and notices — the single Inbox of external information.
 *
 * Reads are direct. `create_signal` applies immediately, like a task write: a
 * signal is a capture, and making the operator approve each one would turn the
 * companion's "log this idea" into a Decision queue. `update_signal` is a direct
 * write for the same reason: triaging a capture (its area, project, status,
 * priority, title or body) is work on a note, not doctrine, and a Decision per
 * triage click would make the inbox unusable. Both writes are still attributed
 * and traceable — each appends a life-log line naming the actor passed to
 * executeTool, so the operator can always see what the agent changed and when.
 * Duplicate control is deliberately the operator's eye plus `list_signals`
 * (the spec does not ask the companion to dedupe unsupervised).
 *
 * The failure shape is the database tools' one ({ error: { code, message } }),
 * so a model reads one refusal vocabulary across the harness.
 */
export const SIGNAL_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_signals",
    description:
      "List captured signals (thoughts, ideas, notices) newest first. Optionally filter by " +
      "domainSlug, type, status and projectId. Returns { signals, total, skipped } where total " +
      "is the filtered count before limit. This is also how you check for an existing signal " +
      "before adding one, and how you read the inbox: status 'inbox' is untriaged work.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: {
          type: "string",
          description: "Optional domain slug to limit results, e.g. 'health'.",
        },
        type: {
          type: "string",
          description: "Optional signal type filter: one of: thought, idea, notice, other.",
        },
        status: {
          type: "string",
          enum: [...SIGNAL_STATUSES],
          description: "Optional triage status filter: one of: inbox, triaged, acting, done, dropped.",
        },
        projectId: {
          type: "string",
          description: "Optional live project id; only captures filed under that project.",
        },
        limit: { type: "number", description: "Max signals to return (default 50, max 200)." },
      },
    },
  },
  {
    name: "get_signal",
    description:
      "Return one signal by id, including its full body, area, project, status, priority and " +
      "where it was captured from. Returns { signal }.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_signal",
    description:
      "Capture one signal (a thought, idea, notice, or other observation) immediately. This is " +
      "not Decision-gated: the signal is written now and logged in the life log under your name. " +
      "type must be one of: thought, idea, notice, other; body is the observation itself. " +
      "Optionally file it under a live project, a triage status and the operator's priority, and " +
      "name where it came in from. Returns { signal }. Use list_signals first if you are unsure " +
      "it is not already captured.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "One of: thought, idea, notice, other.",
        },
        body: { type: "string" },
        title: {
          type: "string",
          description: "Optional short title; omit to keep the body as the signal.",
        },
        domainSlug: {
          type: "string",
          description: "Optional live domain slug this belongs to.",
        },
        projectId: {
          type: "string",
          description: "Optional live project id from projects/ that this capture belongs to.",
        },
        status: {
          type: "string",
          enum: [...SIGNAL_STATUSES],
          description: "Optional triage status; one of: inbox (the default), triaged, acting, done, dropped.",
        },
        priority: {
          type: "string",
          enum: [...SIGNAL_PRIORITIES],
          description: "Optional operator ordering: one of high, normal, low.",
        },
        capturedFrom: {
          type: "string",
          description: "Optional free-text origin, e.g. 'Chrome — AI tab group' or 'Notion — Action Items'.",
        },
      },
      required: ["type", "body"],
    },
  },
  {
    name: "update_signal",
    description:
      "Change one captured signal by id — its area, project, triage status, priority, title or " +
      "body. This is a direct write like create_signal, not Decision-gated: a capture is a note, " +
      "not doctrine. Send only the fields to change; null clears domainSlug, projectId, priority " +
      "or title. status must be one of inbox, triaged, acting, done, dropped; priority one of " +
      "high, normal, low; projectId must name a live project. Returns { signal }.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id of the signal to change." },
        domainSlug: {
          type: ["string", "null"],
          description: "Optional live domain slug, or null to unassign.",
        },
        projectId: {
          type: ["string", "null"],
          description: "Optional live project id, or null to unfile it from its project.",
        },
        status: {
          type: "string",
          enum: [...SIGNAL_STATUSES],
          description: "Where the capture stands as work: inbox, triaged, acting, done, dropped.",
        },
        priority: {
          type: ["string", "null"],
          enum: [...SIGNAL_PRIORITIES, null],
          description: "The operator's ordering: high, normal, low, or null for unset.",
        },
        title: {
          type: ["string", "null"],
          description: "Optional short title, or null to remove one.",
        },
        body: {
          type: "string",
          description: "The description. Empty is refused unless the signal carries an attachment.",
        },
      },
      required: ["id"],
    },
  },
];

export type SignalErrorCode = "NOT_FOUND" | "VALIDATION" | "FAILED";

export type SignalToolResult =
  | Record<string, unknown>
  | { error: { code: SignalErrorCode; message: string } };

function fail(code: SignalErrorCode, message: string): SignalToolResult {
  return { error: { code, message } };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isSignalType(value: unknown): value is SignalType {
  return typeof value === "string" && (SIGNAL_TYPES as readonly string[]).includes(value);
}

function isSignalStatus(value: unknown): value is SignalStatus {
  return typeof value === "string" && (SIGNAL_STATUSES as readonly string[]).includes(value);
}

function isSignalPriority(value: unknown): value is SignalPriority {
  return typeof value === "string" && (SIGNAL_PRIORITIES as readonly string[]).includes(value);
}

function pageInt(
  value: unknown,
  opts: { min: number; max: number; fallback: number },
): { ok: true; value: number } | { ok: false; result: SignalToolResult } {
  if (value === undefined || value === null) return { ok: true, value: opts.fallback };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return {
      ok: false,
      result: fail("VALIDATION", `limit must be an integer between ${opts.min} and ${opts.max}`),
    };
  }
  if (value < opts.min || value > opts.max) {
    return {
      ok: false,
      result: fail("VALIDATION", `limit must be between ${opts.min} and ${opts.max}`),
    };
  }
  return { ok: true, value };
}

/**
 * Archived and absent domains are indistinguishable to the agent by design, as
 * in the database tools; the message names the slug. Signal storage itself only
 * checks that the domain directory exists, so this is the layer that keeps an
 * archived domain from collecting new captures.
 */
async function requireLiveDomain(
  root: string,
  domainSlug: unknown,
): Promise<{ ok: true; slug: string } | { ok: false; result: SignalToolResult }> {
  if (!isNonEmptyString(domainSlug)) {
    return { ok: false, result: fail("VALIDATION", "domainSlug must be a non-empty string") };
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
 * One field of an update, read the way the tool door reads every argument: a
 * present key that cannot be the stored shape is refused by name rather than
 * passed to the engine to be guessed at. `undefined` is absence, `null` clears.
 */
function readOptionalPatchString(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; result: SignalToolResult } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, result: fail("VALIDATION", `${field} must be a string or null`) };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

/**
 * The engine's refusal strings, mapped to the tool vocabulary the model reads.
 * The value is named in the engine's own message, so the CLASSIFICATION is the
 * only thing added here.
 */
function mapSignalWriteError(error: string): SignalToolResult {
  if (/^Signal not found/.test(error)) return fail("NOT_FOUND", error);
  if (/^Unknown domain: |^Unknown project: /.test(error)) return fail("NOT_FOUND", error);
  if (
    /^Invalid signal type|^Invalid signal status|^Invalid signal priority|^A capture needs|^body is required|^body must|^title |^domainSlug |^projectId |^priority |^capturedFrom /.test(
      error,
    )
  ) {
    return fail("VALIDATION", error);
  }
  return fail("FAILED", error);
}

export async function executeSignalTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<SignalToolResult> {
  switch (name) {
    case "list_signals": {
      let domainSlug: string | null = null;
      if (args.domainSlug !== undefined && args.domainSlug !== null) {
        const live = await requireLiveDomain(root, args.domainSlug);
        if (!live.ok) return live.result;
        domainSlug = live.slug;
      }
      if (args.type !== undefined && args.type !== null && !isSignalType(args.type)) {
        return fail("VALIDATION", `type must be one of: ${SIGNAL_TYPES.join(", ")}`);
      }
      let status: SignalStatus | null = null;
      if (args.status !== undefined && args.status !== null) {
        if (!isSignalStatus(args.status)) {
          return fail("VALIDATION", `status must be one of: ${SIGNAL_STATUSES.join(", ")}`);
        }
        status = args.status;
      }
      let projectId: string | null = null;
      if (args.projectId !== undefined && args.projectId !== null) {
        if (!isNonEmptyString(args.projectId)) {
          return fail("VALIDATION", "projectId must be a non-empty string");
        }
        projectId = args.projectId.trim();
      }
      const limit = pageInt(args.limit, { min: 1, max: 200, fallback: 50 });
      if (!limit.ok) return limit.result;

      const listed = await listSignals(root);
      if (!listed.ok) return fail("FAILED", listed.error);
      let signals = listed.value.records;
      if (domainSlug !== null) signals = signals.filter((s) => s.domainSlug === domainSlug);
      if (args.type !== undefined && args.type !== null) {
        signals = signals.filter((s) => s.type === args.type);
      }
      if (status !== null) {
        // A legacy record has no status key and reads as the inbox default.
        signals = signals.filter((s) => (s.status ?? "inbox") === status);
      }
      if (projectId !== null) {
        signals = signals.filter((s) => s.projectId === projectId);
      }
      // listSignals already orders newest first; trimming a slice keeps that.
      const total = signals.length;
      return {
        signals: signals.slice(0, limit.value),
        total,
        // Malformed files the chain reader dropped, so a short list is not read
        // as "the rest never existed".
        skipped: listed.value.skipped,
      };
    }

    case "get_signal": {
      if (!isNonEmptyString(args.id)) return fail("VALIDATION", "id is required");
      // signal-chain.ts exports no single-record read (its live lookup is
      // private), and listSignals already drops tombstones and malformed files —
      // one scan of a vault-scale chain is simpler than duplicating that parsing.
      const listed = await listSignals(root);
      if (!listed.ok) return fail("FAILED", listed.error);
      const signal = listed.value.records.find((s) => s.id === args.id);
      if (!signal) return fail("NOT_FOUND", `Signal not found: ${args.id}`);
      return { signal };
    }

    case "create_signal": {
      // Validated here for a tool-shaped error, then again by createSignal: the
      // engine's own check is the one that must hold for every writer, and this
      // one names the offending value for the model.
      if (!isSignalType(args.type)) {
        return fail("VALIDATION", `type must be one of: ${SIGNAL_TYPES.join(", ")}`);
      }
      if (!isNonEmptyString(args.body)) return fail("VALIDATION", "body is required");
      if (
        args.title !== undefined &&
        args.title !== null &&
        typeof args.title !== "string"
      ) {
        return fail("VALIDATION", "title must be a string when provided");
      }
      let domainSlug: string | null = null;
      if (args.domainSlug !== undefined && args.domainSlug !== null) {
        const live = await requireLiveDomain(root, args.domainSlug);
        if (!live.ok) return live.result;
        domainSlug = live.slug;
      }
      let projectId: string | null = null;
      if (args.projectId !== undefined && args.projectId !== null) {
        if (!isNonEmptyString(args.projectId)) {
          return fail("VALIDATION", "projectId must be a non-empty string");
        }
        projectId = args.projectId.trim();
      }
      let status: SignalStatus | undefined;
      if (args.status !== undefined && args.status !== null) {
        if (!isSignalStatus(args.status)) {
          return fail("VALIDATION", `status must be one of: ${SIGNAL_STATUSES.join(", ")}`);
        }
        status = args.status;
      }
      let priority: SignalPriority | null = null;
      if (args.priority !== undefined && args.priority !== null) {
        if (!isSignalPriority(args.priority)) {
          return fail("VALIDATION", `priority must be one of: ${SIGNAL_PRIORITIES.join(", ")}`);
        }
        priority = args.priority;
      }
      let capturedFrom: string | null = null;
      if (args.capturedFrom !== undefined && args.capturedFrom !== null) {
        if (typeof args.capturedFrom !== "string") {
          return fail("VALIDATION", "capturedFrom must be a string when provided");
        }
        capturedFrom = args.capturedFrom.trim() || null;
      }

      const created = await createSignal(root, {
        type: args.type,
        body: String(args.body),
        title: typeof args.title === "string" ? args.title : null,
        domainSlug,
        projectId,
        status,
        priority,
        capturedFrom,
      });
      if (!created.ok) return mapSignalWriteError(created.error);

      const signal = created.value;
      // The signal is already on disk when this runs, so a failed append must
      // not turn a successful capture into an error the model would retry — the
      // same rule map writes follow ("do not roll them back if the life-log
      // append fails; the command itself succeeded"). The actor recorded here is
      // the one executeTool was handed, never a model-supplied identity.
      await appendLog(root, {
        domainSlug: signal.domainSlug,
        type: "signal.created",
        summary: `Created signal${signal.title ? `: ${signal.title}` : ""}`,
        payload: {
          signalId: signal.id,
          type: signal.type,
          status: signal.status ?? "inbox",
          projectId: signal.projectId ?? null,
        },
        actor,
      });

      return { signal };
    }

    case "update_signal": {
      if (!isNonEmptyString(args.id)) return fail("VALIDATION", "id is required");
      const patch: SignalUpdatePatch = {};
      const changed: string[] = [];

      if (args.domainSlug !== undefined) {
        if (args.domainSlug === null) {
          patch.domainSlug = null;
          changed.push("domainSlug");
        } else {
          const live = await requireLiveDomain(root, args.domainSlug);
          if (!live.ok) return live.result;
          patch.domainSlug = live.slug;
          changed.push("domainSlug");
        }
      }
      if (args.projectId !== undefined) {
        const project = readOptionalPatchString(args.projectId, "projectId");
        if (!project.ok) return project.result;
        patch.projectId = project.value;
        changed.push("projectId");
      }
      if (args.status !== undefined) {
        if (!isSignalStatus(args.status)) {
          return fail("VALIDATION", `status must be one of: ${SIGNAL_STATUSES.join(", ")}`);
        }
        patch.status = args.status;
        changed.push("status");
      }
      if (args.priority !== undefined) {
        if (args.priority === null || args.priority === "") {
          patch.priority = null;
        } else if (!isSignalPriority(args.priority)) {
          return fail("VALIDATION", `priority must be one of: ${SIGNAL_PRIORITIES.join(", ")}`);
        } else {
          patch.priority = args.priority;
        }
        changed.push("priority");
      }
      if (args.title !== undefined) {
        if (args.title !== null && typeof args.title !== "string") {
          return fail("VALIDATION", "title must be a string or null");
        }
        patch.title = typeof args.title === "string" ? args.title : null;
        changed.push("title");
      }
      if (args.body !== undefined) {
        if (typeof args.body !== "string") {
          return fail("VALIDATION", "body must be a string");
        }
        patch.body = args.body;
        changed.push("body");
      }
      if (changed.length === 0) {
        return fail(
          "VALIDATION",
          "Provide at least one field to update: domainSlug, projectId, status, priority, title, body",
        );
      }

      const updated = await updateSignal(root, args.id, patch);
      if (!updated.ok) return mapSignalWriteError(updated.error);
      const signal = updated.value;
      await appendLog(root, {
        domainSlug: signal.domainSlug,
        type: "signal.updated",
        summary: `Updated signal${signal.title ? `: ${signal.title}` : ""} (${changed.join(", ")})`,
        payload: {
          signalId: signal.id,
          changed,
          status: signal.status ?? "inbox",
          projectId: signal.projectId ?? null,
        },
        actor,
      });
      return { signal };
    }

    default:
      return fail("VALIDATION", `Unknown signal tool: ${name}`);
  }
}
