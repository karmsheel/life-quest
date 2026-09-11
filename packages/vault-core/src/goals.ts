import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { listDomains } from "./domains.ts";
import { appendLog } from "./log.ts";
import { fail, ok } from "./map/errors.ts";
import type { Result as MapResult } from "./map/types.ts";
import { vaultPaths } from "./paths.ts";
import type {
  Goal,
  GoalStatus,
  GoalsApplyContext,
  GoalsCommand,
  Result,
} from "./types.ts";

const STATUSES: GoalStatus[] = ["open", "done"];

function assertDomain(
  slug: string | null,
  live: ReadonlySet<string>,
): MapResult<void> {
  if (slug === null) return ok(undefined);
  if (!live.has(slug)) return fail("MALFORMED", "Domain is not a live domain");
  return ok(undefined);
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
      const goal: Goal = {
        id: ctx.id(),
        name,
        notes: command.notes ?? "",
        status: "open",
        domainSlug,
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

function isGoal(value: unknown): value is Goal {
  if (!value || typeof value !== "object") return false;
  const g = value as Partial<Goal>;
  return (
    typeof g.id === "string" &&
    typeof g.name === "string" &&
    typeof g.notes === "string" &&
    (g.status === "open" || g.status === "done") &&
    (g.domainSlug === null || typeof g.domainSlug === "string")
  );
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
      !Array.isArray((parsed as { goals?: unknown }).goals) ||
      !(parsed as { goals: unknown[] }).goals.every(isGoal)
    ) {
      return { ok: false, error: "Goals store has invalid shape", malformed: true };
    }
    return { ok: true, value: (parsed as { goals: Goal[] }).goals };
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
  });
  return { ok: true, value: result.value };
}
