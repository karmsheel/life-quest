import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { listDomains } from "./domains.ts";
import { appendLog } from "./log.ts";
import { fail, ok } from "./map/errors.ts";
import type { Result as MapResult } from "./map/types.ts";
import { vaultPaths } from "./paths.ts";
import type {
  Actor,
  Goal,
  GoalStatus,
  GoalsApplyContext,
  GoalsCommand,
  Result,
} from "./types.ts";
import { USER_ACTOR } from "./types.ts";

const STATUSES: GoalStatus[] = ["open", "done"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDomain(
  slug: string | null,
  live: ReadonlySet<string>,
): MapResult<void> {
  if (slug === null) return ok(undefined);
  if (!live.has(slug)) return fail("MALFORMED", "Domain is not a live domain");
  return ok(undefined);
}

function parseDeadline(value: string | null | undefined): MapResult<string | null> {
  if (value === undefined || value === null || value.trim() === "") return ok(null);
  const s = value.trim();
  if (!ISO_DATE.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`))) {
    return fail("MALFORMED", "Deadline must be YYYY-MM-DD");
  }
  return ok(s);
}

function parseMeasure(
  metric: string | null | undefined,
  target: number | null | undefined,
): MapResult<{ metric: string | null; target: number | null }> {
  const m =
    metric === undefined || metric === null ? null : metric.trim() || null;
  const t = target === undefined || target === null ? null : target;
  if (t !== null && !Number.isFinite(t)) {
    return fail("MALFORMED", "Target must be a number");
  }
  if ((m === null) !== (t === null)) {
    return fail("MALFORMED", "Metric and target must be set together");
  }
  return ok({ metric: m, target: t });
}

function parseDefinition(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const s = value.trim();
  return s === "" ? null : s;
}

function parseCurrent(
  metric: string | null,
  current: number | null | undefined,
): MapResult<number | null> {
  if (metric === null) return ok(null);
  if (current === undefined || current === null) return ok(0);
  if (!Number.isFinite(current)) {
    return fail("MALFORMED", "Current must be a number");
  }
  return ok(current);
}

export function applyGoalCommand(
  goals: Goal[],
  command: GoalsCommand,
  ctx: GoalsApplyContext,
): MapResult<Goal[]> {
  const live = new Set(ctx.liveDomainSlugs);
  switch (command.type) {
    case "createGoal": {
      const name = command.name.trim();
      if (!name) return fail("MALFORMED", "Goal name is required");
      const domainSlug = command.domainSlug ?? null;
      const domain = assertDomain(domainSlug, live);
      if (!domain.ok) return domain;
      const deadline = parseDeadline(command.deadline);
      if (!deadline.ok) return deadline;
      const measure = parseMeasure(command.metric, command.target);
      if (!measure.ok) return measure;
      const current = parseCurrent(measure.value.metric, command.current);
      if (!current.ok) return current;
      const goal: Goal = {
        id: ctx.id(),
        name,
        notes: command.notes ?? "",
        status: "open",
        domainSlug,
        deadline: deadline.value,
        metric: measure.value.metric,
        target: measure.value.target,
        definitionOfDone: parseDefinition(command.definitionOfDone),
        current: current.value,
      };
      return ok([...goals, goal]);
    }
    case "updateGoal": {
      const idx = goals.findIndex((g) => g.id === command.id);
      if (idx < 0) return fail("NOT_FOUND", "Goal not found");
      const next: Goal = { ...goals[idx] };
      if (command.name !== undefined) {
        const name = command.name.trim();
        if (!name) return fail("MALFORMED", "Goal name is required");
        next.name = name;
      }
      if (command.notes !== undefined) next.notes = command.notes;
      if (command.status !== undefined) {
        if (!STATUSES.includes(command.status)) {
          return fail("MALFORMED", "Invalid status");
        }
        next.status = command.status;
      }
      if (command.domainSlug !== undefined) {
        const domain = assertDomain(command.domainSlug, live);
        if (!domain.ok) return domain;
        next.domainSlug = command.domainSlug;
      }
      if (command.deadline !== undefined) {
        const deadline = parseDeadline(command.deadline);
        if (!deadline.ok) return deadline;
        next.deadline = deadline.value;
      }
      if (command.metric !== undefined || command.target !== undefined) {
        const measure = parseMeasure(
          command.metric !== undefined ? command.metric : next.metric,
          command.target !== undefined ? command.target : next.target,
        );
        if (!measure.ok) return measure;
        next.metric = measure.value.metric;
        next.target = measure.value.target;
        if (measure.value.metric === null) {
          next.current = null;
        } else if (next.current === null) {
          next.current = 0;
        }
      }
      if (command.current !== undefined) {
        const current = parseCurrent(next.metric, command.current);
        if (!current.ok) return current;
        next.current = current.value;
      } else if (next.metric === null) {
        next.current = null;
      }
      if (command.definitionOfDone !== undefined) {
        next.definitionOfDone = parseDefinition(command.definitionOfDone);
      }
      const copy = goals.slice();
      copy[idx] = next;
      return ok(copy);
    }
    case "deleteGoal": {
      if (!goals.some((g) => g.id === command.id)) {
        return fail("NOT_FOUND", "Goal not found");
      }
      return ok(goals.filter((g) => g.id !== command.id));
    }
    default: {
      const _exhaustive: never = command;
      return fail("MALFORMED", `Unhandled command ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function coerceGoal(value: unknown): Goal | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  if (typeof g.id !== "string" || typeof g.name !== "string" || typeof g.notes !== "string") {
    return null;
  }
  if (g.status !== "open" && g.status !== "done") return null;
  if (g.domainSlug !== null && typeof g.domainSlug !== "string") return null;
  if (g.deadline !== undefined && g.deadline !== null && typeof g.deadline !== "string") {
    return null;
  }
  if (g.metric !== undefined && g.metric !== null && typeof g.metric !== "string") {
    return null;
  }
  if (g.target !== undefined && g.target !== null && typeof g.target !== "number") {
    return null;
  }
  if (
    g.definitionOfDone !== undefined &&
    g.definitionOfDone !== null &&
    typeof g.definitionOfDone !== "string"
  ) {
    return null;
  }
  if (g.current !== undefined && g.current !== null && typeof g.current !== "number") {
    return null;
  }
  const metric = g.metric === undefined ? null : (g.metric as string | null);
  let current: number | null;
  if (metric === null) {
    current = null;
  } else if (g.current === undefined || g.current === null) {
    current = 0;
  } else {
    current = g.current as number;
  }
  return {
    id: g.id,
    name: g.name,
    notes: g.notes,
    status: g.status,
    domainSlug: g.domainSlug as string | null,
    deadline: g.deadline === undefined ? null : (g.deadline as string | null),
    metric,
    target: g.target === undefined ? null : (g.target as number | null),
    definitionOfDone:
      g.definitionOfDone === undefined ? null : (g.definitionOfDone as string | null),
    current,
  };
}

export async function loadGoals(
  rootPath: string,
): Promise<Result<Goal[]> | { ok: false; error: string; malformed: true }> {
  const p = vaultPaths(rootPath).goalsJson;
  try {
    const raw = await fs.readFile(p, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Goals store is not valid JSON", malformed: true };
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { goals?: unknown }).goals)
    ) {
      return { ok: false, error: "Goals store has invalid shape", malformed: true };
    }
    const coerced = (parsed as { goals: unknown[] }).goals.map(coerceGoal);
    if (coerced.some((g) => g === null)) {
      return { ok: false, error: "Goals store has invalid shape", malformed: true };
    }
    return { ok: true, value: coerced as Goal[] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: [] };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function liveDomainSlugsFromDisk(rootPath: string): Promise<Result<string[]>> {
  const listed = await listDomains(rootPath);
  if (!listed.ok) return listed;
  return {
    ok: true,
    value: listed.value.filter((d) => !d.meta.archivedAt).map((d) => d.slug),
  };
}

function logFor(
  command: GoalsCommand,
  after: Goal[],
  prior: Goal | undefined,
): {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  domainSlug: string | null;
} {
  if (command.type === "createGoal") {
    const g = after[after.length - 1];
    return {
      type: "goal.created",
      summary: `Created goal ${g.name}`,
      payload: { id: g.id, name: g.name },
      domainSlug: g.domainSlug,
    };
  }
  if (command.type === "updateGoal") {
    const g = after.find((x) => x.id === command.id);
    return {
      type: "goal.updated",
      summary: "Updated goal",
      payload: { id: command.id },
      domainSlug: g?.domainSlug ?? null,
    };
  }
  return {
    type: "goal.deleted",
    summary: "Deleted goal",
    payload: { id: command.id },
    domainSlug: prior?.domainSlug ?? null,
  };
}

export async function applyGoalsCommand(
  rootPath: string,
  command: GoalsCommand,
  actor: Actor = USER_ACTOR,
): Promise<Result<Goal[]>> {
  const loaded = await loadGoals(rootPath);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const live = await liveDomainSlugsFromDisk(rootPath);
  if (!live.ok) return live;
  const prior =
    command.type === "deleteGoal"
      ? loaded.value.find((g) => g.id === command.id)
      : undefined;
  const result = applyGoalCommand(loaded.value, command, {
    id: () => randomUUID(),
    liveDomainSlugs: live.value,
  });
  if (!result.ok) {
    return { ok: false, error: `${result.error.code}: ${result.error.message}` };
  }
  try {
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await atomicWriteFile(
      paths.goalsJson,
      `${JSON.stringify({ goals: result.value }, null, 2)}\n`,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const ev = logFor(command, result.value, prior);
  await appendLog(rootPath, {
    domainSlug: ev.domainSlug,
    type: ev.type,
    summary: ev.summary,
    payload: ev.payload,
    actor,
  });
  return { ok: true, value: result.value };
}
