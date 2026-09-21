import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { vaultPaths } from "./paths.ts";
import {
  type PlanningIndexEntry,
  type PlanningStub,
  type Result,
  type ReviewCadence,
} from "./types.ts";

function todayIso(): string {
  return new Date().toISOString();
}

async function parsePlanningFile(
  rootPath: string,
  cadence: string,
  period: string,
): Promise<Result<PlanningStub>> {
  const paths = vaultPaths(rootPath);
  const filePath = paths.planningMd(cadence, period);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const { data, body } = parseFrontmatter(raw);
    if (
      typeof data.cadence !== "string" ||
      typeof data.period !== "string" ||
      typeof data.scopes !== "object" ||
      data.scopes === null
    ) {
      return { ok: false, error: "Planning stub file not found" };
    }
    const scopes = data.scopes as Record<string, { sessionId: string | null }>;
    if (!scopes.overall) scopes.overall = { sessionId: null };
    return {
      ok: true,
      value: {
        cadence: cadence as ReviewCadence,
        period,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : todayIso(),
        scopes,
        bodyMarkdown: body,
      },
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "Planning stub file not found" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function ensurePlanningStub(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string },
): Promise<Result<PlanningStub>> {
  try {
    const paths = vaultPaths(rootPath);
    const filePath = paths.planningMd(input.cadence, input.period);

    let existing: PlanningStub | null = null;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const { data, body } = parseFrontmatter(raw);
      const scopes = (typeof data.scopes === "object" && data.scopes !== null
        ? (data.scopes as Record<string, { sessionId: string | null }>)
        : {}) as Record<string, { sessionId: string | null }>;
      if (!scopes.overall) scopes.overall = { sessionId: null };
      existing = {
        cadence: input.cadence,
        period: input.period,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : todayIso(),
        scopes,
        bodyMarkdown: body,
      };
    } catch {
      // file missing — create below
    }

    if (!existing) {
      const scopes: Record<string, { sessionId: string | null }> = {
        overall: { sessionId: null },
      };
      if (input.scope !== "overall") {
        scopes[input.scope] = { sessionId: null };
      }
      const now = todayIso();
      const md = serializeFrontmatter(
        {
          cadence: input.cadence,
          period: input.period,
          updatedAt: now,
          scopes,
        },
        "",
      );
      await atomicWriteFile(filePath, md);
      return parsePlanningFile(rootPath, input.cadence, input.period);
    }

    // File exists — ensure overall is present
    if (!existing.scopes.overall) {
      existing.scopes.overall = { sessionId: null };
    }

    // Idempotent: if scope already exists, return as-is
    if (existing.scopes[input.scope]) {
      return { ok: true, value: existing };
    }

    // Add new scope
    existing.scopes[input.scope] = { sessionId: null };
    existing.updatedAt = todayIso();

    const md = serializeFrontmatter(
      {
        cadence: existing.cadence,
        period: existing.period,
        updatedAt: existing.updatedAt,
        scopes: existing.scopes,
      },
      existing.bodyMarkdown,
    );
    await atomicWriteFile(filePath, md);
    return parsePlanningFile(rootPath, input.cadence, input.period);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getPlanningStub(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<PlanningStub>> {
  return parsePlanningFile(rootPath, cadence, period);
}

export async function setPlanningSessionId(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string; sessionId: string },
): Promise<Result<PlanningStub>> {
  try {
    const existing = await parsePlanningFile(rootPath, input.cadence, input.period);
    if (!existing.ok) return existing;
    const record = existing.value;

    if (!record.scopes[input.scope]) {
      record.scopes[input.scope] = { sessionId: null };
    }
    record.scopes[input.scope]!.sessionId = input.sessionId;
    record.updatedAt = todayIso();

    const filePath = vaultPaths(rootPath).planningMd(input.cadence, input.period);
    const md = serializeFrontmatter(
      {
        cadence: record.cadence,
        period: record.period,
        updatedAt: record.updatedAt,
        scopes: record.scopes,
      },
      record.bodyMarkdown,
    );
    await atomicWriteFile(filePath, md);
    return { ok: true, value: record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listPlanningIndex(
  rootPath: string,
): Promise<Result<PlanningIndexEntry[]>> {
  try {
    const paths = vaultPaths(rootPath);
    const entries: PlanningIndexEntry[] = [];

    const cadences = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
    for (const cadence of cadences) {
      const cadDir = paths.planningCadenceDir(cadence);
      let files: import("node:fs").Dirent[];
      try {
        files = await fs.readdir(cadDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        const period = f.name.replace(/\.md$/, "");
        const r = await parsePlanningFile(rootPath, cadence, period);
        if (!r.ok) {
          // skip corrupt file — do not throw
          continue;
        }
        const rec = r.value;
        entries.push({
          cadence,
          period,
          scopes: rec.scopes,
        });
      }
    }

    return { ok: true, value: entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
