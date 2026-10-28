import type { MapToolDef } from "./map/tools.ts";
import { isDomainLive } from "./domain-databases.ts";
import { appendLog } from "./log.ts";
import { createSignal, listSignals } from "./signal-chain.ts";
import { SIGNAL_TYPES, type Actor, type SignalType } from "./types.ts";

/**
 * The companion's Life-Chain surface: the operator's captured thoughts, ideas,
 * and notices.
 *
 * Reads are direct. `create_signal` applies immediately, like a task write: a
 * signal is a capture, and making the operator approve each one would turn the
 * companion's "log this idea" into a Decision queue. It is still attributed and
 * traceable — the write appends a `signal.created` life-log line naming the
 * actor passed to executeTool, so the operator can always see what the agent
 * captured and when. Duplicate control is deliberately the operator's eye plus
 * `list_signals` (the spec does not ask the companion to dedupe unsupervised).
 *
 * The failure shape is the database tools' one ({ error: { code, message } }),
 * so a model reads one refusal vocabulary across the harness.
 */
export const SIGNAL_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_signals",
    description:
      "List captured signals (thoughts, ideas, notices) newest first. Optionally filter by " +
      "domainSlug and type. Returns { signals, total, skipped } where total is the filtered " +
      "count before limit. This is also how you check for an existing signal before adding one.",
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
        limit: { type: "number", description: "Max signals to return (default 50, max 200)." },
      },
    },
  },
  {
    name: "get_signal",
    description: "Return one signal by id, including its full body and domain. Returns { signal }.",
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
      "Returns { signal }. Use list_signals first if you are unsure it is not already captured.",
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
      },
      required: ["type", "body"],
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
      const limit = pageInt(args.limit, { min: 1, max: 200, fallback: 50 });
      if (!limit.ok) return limit.result;

      const listed = await listSignals(root);
      if (!listed.ok) return fail("FAILED", listed.error);
      let signals = listed.value.records;
      if (domainSlug !== null) signals = signals.filter((s) => s.domainSlug === domainSlug);
      if (args.type !== undefined && args.type !== null) {
        signals = signals.filter((s) => s.type === args.type);
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

      const created = await createSignal(root, {
        type: args.type,
        body: String(args.body),
        title: typeof args.title === "string" ? args.title : null,
        domainSlug,
      });
      if (!created.ok) {
        if (/^Invalid signal type|^body is required/.test(created.error)) {
          return fail("VALIDATION", created.error);
        }
        if (/^Unknown domain: /.test(created.error)) {
          return fail("NOT_FOUND", created.error);
        }
        return fail("FAILED", created.error);
      }

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
        payload: { signalId: signal.id, type: signal.type },
        actor,
      });

      return { signal };
    }

    default:
      return fail("VALIDATION", `Unknown signal tool: ${name}`);
  }
}
