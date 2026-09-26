import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { loadGoals } from "./goals.ts";
import { listDomains } from "./domains.ts";
import { vaultPaths } from "./paths.ts";
import type { MapToolDef } from "./map/tools.ts";
import {
  PROJECT_STATUSES,
  USER_ACTOR,
  type Actor,
  type Project,
  type ProjectCommand,
  type ProjectCreateInput,
  type ProjectListResult,
  type ProjectStatus,
  type ProjectUpdatePatch,
  type Result,
} from "./types.ts";

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function asError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as string[]).includes(value);
}

/**
 * A project must name one live Goal and, when it names a domain, one live domain.
 * A stored goalId is never cascaded away when the goal is later deleted; these
 * checks only run on writes that set a new value.
 */
async function assertGoalLive(rootPath: string, goalId: string): Promise<Result<void>> {
  if (!goalId.trim()) return fail("goalId is required");
  const goals = await loadGoals(rootPath);
  if (!goals.ok) return fail(goals.error);
  if (!goals.value.some((g) => g.id === goalId)) {
    return fail(`Goal not found: ${goalId}`);
  }
  return ok(undefined);
}

async function assertDomainLive(
  rootPath: string,
  domainSlug: string | null,
): Promise<Result<void>> {
  if (domainSlug === null) return ok(undefined);
  if (!domainSlug.trim()) return fail("Unknown domain: ");
  const domains = await listDomains(rootPath);
  if (!domains.ok) return fail(domains.error);
  const live = domains.value.some(
    (d) => d.slug === domainSlug && !d.meta.archivedAt,
  );
  if (!live) return fail(`Domain not found or archived: ${domainSlug}`);
  return ok(undefined);
}

function parseProjectFile(id: string, raw: string): Project | null {
  if (!id.trim()) return null;
  const { data, body } = parseFrontmatter(raw);
  if (typeof data.title !== "string" || !data.title.trim()) return null;
  if (typeof data.goalId !== "string" || !data.goalId.trim()) return null;
  if (!isProjectStatus(data.status)) return null;
  if (!isIso(data.createdAt) || !isIso(data.updatedAt)) return null;
  // `domain` on disk; null means unassigned. A blank or non-string value is malformed.
  let domainSlug: string | null;
  if (data.domain === null || data.domain === undefined) {
    domainSlug = null;
  } else if (typeof data.domain === "string" && data.domain.trim()) {
    domainSlug = data.domain;
  } else {
    return null;
  }
  return {
    id,
    title: data.title,
    bodyMarkdown: body,
    goalId: data.goalId,
    domainSlug,
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

async function writeProjectFile(rootPath: string, record: Project): Promise<void> {
  const paths = vaultPaths(rootPath);
  await fs.mkdir(paths.projectsDir, { recursive: true });
  const raw = serializeFrontmatter(
    {
      title: record.title,
      goalId: record.goalId,
      domain: record.domainSlug,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    record.bodyMarkdown,
  );
  // formatValue quotes scalars with spaces; keep unquoted titles for readability.
  await atomicWriteFile(
    paths.projectMd(record.id),
    raw.replace(/^title: "([^"\\]+)"$/m, "title: $1"),
  );
}

async function readProject(
  rootPath: string,
  id: string,
): Promise<Result<Project>> {
  try {
    const filePath = vaultPaths(rootPath).projectMd(id);
    const raw = await fs.readFile(filePath, "utf8");
    const record = parseProjectFile(id, raw);
    if (!record) return fail(`Project not found or malformed: ${id}`);
    return ok(record);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fail(`Project not found: ${id}`);
    return fail(asError(e));
  }
}

export async function projectList(
  rootPath: string,
): Promise<Result<ProjectListResult>> {
  try {
    const paths = vaultPaths(rootPath);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.projectsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return ok({ records: [], skipped: 0 });
      }
      throw e;
    }

    const records: Project[] = [];
    let skipped = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const id = entry.name.slice(0, -".md".length);
      try {
        const raw = await fs.readFile(paths.projectMd(id), "utf8");
        const record = parseProjectFile(id, raw);
        if (!record) {
          skipped += 1;
          continue;
        }
        records.push(record);
      } catch {
        skipped += 1;
      }
    }
    records.sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return a.id.localeCompare(b.id);
    });
    return ok({ records, skipped });
  } catch (e) {
    return fail(asError(e));
  }
}

export async function projectGet(
  rootPath: string,
  id: string,
): Promise<Result<Project>> {
  return readProject(rootPath, id);
}

/** Operator create. Writes the file immediately; status is always `open`. */
export async function projectCreate(
  rootPath: string,
  input: ProjectCreateInput,
  actor: Actor = USER_ACTOR,
): Promise<Result<Project>> {
  try {
    const title = input.title.trim();
    if (!title) return fail("title is required");
    const goal = await assertGoalLive(rootPath, input.goalId);
    if (!goal.ok) return goal;
    const domainSlug = input.domainSlug ?? null;
    const domain = await assertDomainLive(rootPath, domainSlug);
    if (!domain.ok) return domain;

    const now = new Date().toISOString();
    const record: Project = {
      id: input.id ?? randomUUID(),
      title,
      bodyMarkdown: input.bodyMarkdown ?? "",
      goalId: input.goalId,
      domainSlug,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await writeProjectFile(rootPath, record);
    const logged = await appendLog(rootPath, {
      domainSlug,
      type: "project.created",
      summary: `${actor.type === "agent" ? actor.name : "You"} created ${record.title}`,
      payload: { id: record.id, title: record.title, goalId: record.goalId },
      actor,
    });
    if (!logged.ok) return logged;
    return ok(record);
  } catch (e) {
    return fail(asError(e));
  }
}

/** Operator edit, including reopen and close. Writes the file immediately. */
export async function projectUpdate(
  rootPath: string,
  id: string,
  patch: ProjectUpdatePatch,
  actor: Actor = USER_ACTOR,
): Promise<Result<Project>> {
  try {
    const loaded = await readProject(rootPath, id);
    if (!loaded.ok) return loaded;

    let title = loaded.value.title;
    if (patch.title !== undefined) {
      title = patch.title.trim();
      if (!title) return fail("title is required");
    }
    let goalId = loaded.value.goalId;
    if (patch.goalId !== undefined && patch.goalId !== loaded.value.goalId) {
      const goal = await assertGoalLive(rootPath, patch.goalId);
      if (!goal.ok) return goal;
      goalId = patch.goalId;
    }
    let domainSlug = loaded.value.domainSlug;
    if (patch.domainSlug !== undefined) {
      const next = patch.domainSlug;
      if (next !== domainSlug) {
        const domain = await assertDomainLive(rootPath, next);
        if (!domain.ok) return domain;
      }
      domainSlug = next;
    }
    let status = loaded.value.status;
    if (patch.status !== undefined) {
      if (!isProjectStatus(patch.status)) {
        return fail(`Invalid project status: ${String(patch.status)}`);
      }
      status = patch.status;
    }

    const next: Project = {
      ...loaded.value,
      title,
      bodyMarkdown:
        patch.bodyMarkdown !== undefined
          ? patch.bodyMarkdown
          : loaded.value.bodyMarkdown,
      goalId,
      domainSlug,
      status,
      updatedAt: new Date().toISOString(),
    };
    await writeProjectFile(rootPath, next);
    const logged = await appendLog(rootPath, {
      domainSlug: next.domainSlug,
      type: "project.updated",
      summary: `${actor.type === "agent" ? actor.name : "You"} updated ${next.title}`,
      payload: { id: next.id, title: next.title, status: next.status },
      actor,
    });
    if (!logged.ok) return logged;
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}

/** Close a project. Leaves the file in place, clears no task links, and logs project.closed. */
export async function projectClose(
  rootPath: string,
  id: string,
  actor: Actor = USER_ACTOR,
): Promise<Result<Project>> {
  try {
    const loaded = await readProject(rootPath, id);
    if (!loaded.ok) return loaded;
    if (loaded.value.status === "closed") return loaded;
    const next: Project = {
      ...loaded.value,
      status: "closed",
      updatedAt: new Date().toISOString(),
    };
    await writeProjectFile(rootPath, next);
    const logged = await appendLog(rootPath, {
      domainSlug: next.domainSlug,
      type: "project.closed",
      summary: `${actor.type === "agent" ? actor.name : "You"} closed ${next.title}`,
      payload: { id: next.id, title: next.title },
      actor,
    });
    if (!logged.ok) return logged;
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}

// ---------------------------------------------------------------------------
// Agent tools. These never write the file; they only build the command that the
// desktop executeTool path wraps in a pending Decision.
// ---------------------------------------------------------------------------

export const PROJECT_TOOL_DEFS: MapToolDef[] = [
  {
    name: "create_project",
    description:
      "Propose a new Project: a markdown vault document linked to one Goal. Files a pending Decision; nothing is written until the operator approves.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        goalId: { type: "string" },
        domainSlug: { type: "string" },
        body: { type: "string" },
      },
      required: ["title", "goalId"],
    },
  },
  {
    name: "close_project",
    description:
      "Propose closing a Project by id. Files a pending Decision; nothing is written until the operator approves.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
];

export function commandForProjectTool(
  name: string,
  args: Record<string, unknown>,
): ProjectCommand | null {
  if (name === "create_project") {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) return null;
    const goalId = typeof args.goalId === "string" ? args.goalId.trim() : "";
    if (!goalId) return null;
    const domainSlug =
      typeof args.domainSlug === "string" && args.domainSlug.trim()
        ? args.domainSlug.trim()
        : null;
    const body = typeof args.body === "string" ? args.body : undefined;
    return {
      type: "createProject",
      // Allocated here so approve writes the file under this exact id.
      id: randomUUID(),
      title,
      goalId,
      domainSlug,
      ...(body !== undefined ? { bodyMarkdown: body } : {}),
    };
  }
  if (name === "close_project") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) return null;
    return { type: "closeProject", id };
  }
  return null;
}
