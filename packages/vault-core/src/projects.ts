import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { loadGoals } from "./goals.ts";
import { listDomains } from "./domains.ts";
import { openVault } from "./open-vault.ts";
import { listSignals } from "./signal-chain.ts";
import { vaultPaths } from "./paths.ts";
import type { MapToolDef } from "./map/tools.ts";
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  USER_ACTOR,
  type Actor,
  type DecisionRecord,
  type LifeEvent,
  type Project,
  type ProjectCommand,
  type ProjectCreateInput,
  type ProjectListEntry,
  type ProjectListResult,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectUpdate,
  type ProjectUpdatePatch,
  type Result,
  type SignalRecord,
  type Task,
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
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

function isProjectPriority(value: unknown): value is ProjectPriority {
  return typeof value === "string" && (PROJECT_PRIORITIES as readonly string[]).includes(value);
}

/** Progress is a whole percent; a timeline can show 63 but never 63.5. */
function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A project id is its filename, so it is always one safe path segment. */
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A calendar date, not merely something Date.parse accepts. `Date.parse` rolls
 * 2026-02-31 over into March, so the round-trip through UTC is what rejects a
 * day that does not exist.
 */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------
// Field validation shared by the operator CRUD, the agent command, and the
// file parser. Free-text single-line fields are trimmed; anything that cannot
// round-trip through a frontmatter scalar is refused by name rather than
// silently written as something else.
// ---------------------------------------------------------------------------

function isSingleLine(value: string): boolean {
  return !/[\r\n]/.test(value);
}

function parseRequiredLine(value: unknown, field: string): Result<string> {
  if (typeof value !== "string") return fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return fail(`${field} is required`);
  if (!isSingleLine(trimmed)) return fail(`${field} must be a single line`);
  return ok(trimmed);
}

/** A field whose frontmatter default is the empty string (`summary`, `stateNote`). */
function parseDefaultLine(value: unknown, field: string): Result<string> {
  if (value === undefined) return ok("");
  if (typeof value !== "string") return fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!isSingleLine(trimmed)) return fail(`${field} must be a single line`);
  return ok(trimmed);
}

/** A nullable scalar; an empty string is the same as null. */
function parseOptionalLine(value: unknown, field: string): Result<string | null> {
  if (value === undefined || value === null) return ok(null);
  if (typeof value !== "string") return fail(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (!trimmed) return ok(null);
  if (!isSingleLine(trimmed)) return fail(`${field} must be a single line`);
  return ok(trimmed);
}

function parseBody(value: unknown): Result<string> {
  if (value === undefined || value === null) return ok("");
  if (typeof value !== "string") return fail("bodyMarkdown must be a string");
  return ok(value);
}

function parseStatusField(value: unknown): Result<ProjectStatus> {
  if (!isProjectStatus(value)) return fail(`Invalid project status: ${String(value)}`);
  return ok(value);
}

function parsePriorityField(value: unknown): Result<ProjectPriority | null> {
  if (value === undefined || value === null) return ok(null);
  if (!isProjectPriority(value)) return fail(`Invalid project priority: ${String(value)}`);
  return ok(value);
}

function parseDateField(value: unknown, field: string): Result<string | null> {
  if (value === undefined || value === null) return ok(null);
  if (typeof value !== "string") return fail(`${field} must be YYYY-MM-DD or null`);
  const trimmed = value.trim();
  if (!trimmed) return ok(null);
  if (!isValidIsoDate(trimmed)) return fail(`${field} must be a real date in YYYY-MM-DD form`);
  return ok(trimmed);
}

function parseProgressField(value: unknown): Result<number> {
  if (!isPercent(value)) return fail("progress must be an integer between 0 and 100");
  return ok(value);
}

// ---------------------------------------------------------------------------
// Live references. A project names at most one goal and one domain; a stored id
// is never cascaded away when the goal/domain is later deleted, so these checks
// only run on writes that set a new value.
// ---------------------------------------------------------------------------

async function assertGoalLive(rootPath: string, goalId: string | null): Promise<Result<void>> {
  if (goalId === null) return ok(undefined);
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
  const domains = await listDomains(rootPath);
  if (!domains.ok) return fail(domains.error);
  const live = domains.value.some((d) => d.slug === domainSlug && !d.meta.archivedAt);
  if (!live) return fail(`Domain not found or archived: ${domainSlug}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// One markdown file per project. The schema is fixed and ships with the app;
// an older file carries only title/goal/domain/status/timestamps and reads with
// every new field defaulted, so opening an existing vault migrates nothing.
// ---------------------------------------------------------------------------

function parseProjectUpdate(value: unknown): ProjectUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !entry.id.trim()) return null;
  if (!isIso(entry.at)) return null;
  if (typeof entry.note !== "string") return null;
  const progress =
    entry.progress === undefined || entry.progress === null ? null : entry.progress;
  if (progress !== null && !isPercent(progress)) return null;
  if (entry.actorName !== undefined && entry.actorName !== null && typeof entry.actorName !== "string") {
    return null;
  }
  return {
    id: entry.id,
    at: entry.at,
    note: entry.note,
    progress,
    actorName: typeof entry.actorName === "string" ? entry.actorName : null,
  };
}

function parseProjectFile(id: string, raw: string): Project | null {
  if (!id.trim()) return null;
  const { data, body } = parseFrontmatter(raw);
  if (typeof data.title !== "string" || !data.title.trim()) return null;
  if (data.summary !== undefined && typeof data.summary !== "string") return null;
  if (data.stateNote !== undefined && typeof data.stateNote !== "string") return null;
  if (!isIso(data.createdAt) || !isIso(data.updatedAt)) return null;

  // `goalId` is optional now: a project can start before it is filed under a goal.
  let goalId: string | null = null;
  if (data.goalId !== undefined && data.goalId !== null) {
    if (typeof data.goalId !== "string") return null;
    goalId = data.goalId.trim() || null;
  }

  // `domain` on disk; null means unassigned.
  let domainSlug: string | null = null;
  if (data.domain !== undefined && data.domain !== null) {
    if (typeof data.domain !== "string") return null;
    domainSlug = data.domain.trim() || null;
  }

  // Absent status reads as `open`, which is what every old file was written as.
  let status: ProjectStatus = "open";
  if (data.status !== undefined && data.status !== null) {
    if (!isProjectStatus(data.status)) return null;
    status = data.status;
  }

  let priority: ProjectPriority | null = null;
  if (data.priority !== undefined && data.priority !== null) {
    if (!isProjectPriority(data.priority)) return null;
    priority = data.priority;
  }

  const readDate = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return isValidIsoDate(trimmed) ? trimmed : undefined;
  };
  const startDate = readDate(data.startDate);
  if (startDate === undefined) return null;
  const targetDate = readDate(data.targetDate);
  if (targetDate === undefined) return null;

  // serializeFrontmatter writes numbers as bare scalars and parseFrontmatter
  // hands every bare scalar back as a string, so a written `progress: 40` reads
  // as "40". Coercing here is what keeps the round trip numeric.
  let progress = 0;
  if (data.progress !== undefined && data.progress !== null) {
    let numeric: number | null = null;
    if (typeof data.progress === "number") {
      numeric = data.progress;
    } else if (typeof data.progress === "string" && /^\d+$/.test(data.progress.trim())) {
      numeric = Number(data.progress.trim());
    }
    if (numeric === null || !isPercent(numeric)) return null;
    progress = numeric;
  }

  let nextAction: string | null = null;
  if (data.nextAction !== undefined && data.nextAction !== null) {
    if (typeof data.nextAction !== "string") return null;
    nextAction = data.nextAction.trim() || null;
  }

  let updates: ProjectUpdate[] = [];
  if (data.updates !== undefined && data.updates !== null) {
    if (!Array.isArray(data.updates)) return null;
    updates = [];
    for (const rawUpdate of data.updates) {
      const parsed = parseProjectUpdate(rawUpdate);
      if (!parsed) return null;
      updates.push(parsed);
    }
  }

  return {
    id,
    title: data.title.trim(),
    summary: typeof data.summary === "string" ? data.summary.trim() : "",
    bodyMarkdown: body,
    stateNote: typeof data.stateNote === "string" ? data.stateNote.trim() : "",
    goalId,
    domainSlug,
    status,
    priority,
    startDate,
    targetDate,
    progress,
    nextAction,
    updates,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/**
 * Force a plain text scalar to be quoted on its frontmatter line.
 *
 * `formatValue` only quotes strings that contain a space, colon or hash, so a
 * summary of "[]" or a state note of "true" would be written bare and read back
 * as an array or a boolean. These fields are free text: quoting them explicitly
 * keeps `parseFrontmatter` in its string branch whatever the text happens to
 * look like.
 */
function quoteTextScalar(raw: string, key: string, value: string): string {
  if (!value) return raw;
  const prefix = `${key}: `;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith(prefix)) {
      lines[i] = `${prefix}${JSON.stringify(value)}`;
      break;
    }
  }
  return lines.join("\n");
}

async function writeProjectFile(rootPath: string, record: Project): Promise<void> {
  const paths = vaultPaths(rootPath);
  await fs.mkdir(paths.projectsDir, { recursive: true });
  // Every field is persisted, including the ones this release added: the
  // frontmatter IS the project. `updates` serialises as a one-line JSON array,
  // which is what lets the parser read it back as structured data.
  const serialized = serializeFrontmatter(
    {
      title: record.title,
      summary: record.summary,
      stateNote: record.stateNote,
      goalId: record.goalId,
      domain: record.domainSlug,
      status: record.status,
      priority: record.priority,
      startDate: record.startDate,
      targetDate: record.targetDate,
      progress: record.progress,
      nextAction: record.nextAction,
      updates: record.updates,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    record.bodyMarkdown,
  );
  let raw = serialized;
  for (const [key, value] of [
    ["summary", record.summary],
    ["stateNote", record.stateNote],
    ["nextAction", record.nextAction ?? ""],
  ] as const) {
    raw = quoteTextScalar(raw, key, value);
  }
  // formatValue quotes scalars with spaces; keep unquoted titles for readability.
  await atomicWriteFile(
    paths.projectMd(record.id),
    raw.replace(/^title: "([^"\\]+)"$/m, "title: $1"),
  );
}

async function readProject(rootPath: string, id: string): Promise<Result<Project>> {
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

/** Operator create. Writes the file immediately; the agent path files a Decision. */
export async function projectCreate(
  rootPath: string,
  input: ProjectCreateInput,
  actor: Actor = USER_ACTOR,
): Promise<Result<Project>> {
  try {
    if (!input || typeof input !== "object") return fail("Project input is required");
    const raw = input as unknown as Record<string, unknown>;

    const title = parseRequiredLine(raw.title, "title");
    if (!title.ok) return title;
    const summary = parseDefaultLine(raw.summary, "summary");
    if (!summary.ok) return summary;
    const stateNote = parseDefaultLine(raw.stateNote, "stateNote");
    if (!stateNote.ok) return stateNote;
    const bodyMarkdown = parseBody(raw.bodyMarkdown);
    if (!bodyMarkdown.ok) return bodyMarkdown;
    const goalId = parseOptionalLine(raw.goalId, "goalId");
    if (!goalId.ok) return goalId;
    const domainSlug = parseOptionalLine(raw.domainSlug, "domainSlug");
    if (!domainSlug.ok) return domainSlug;
    const status =
      raw.status === undefined ? ok<ProjectStatus>("open") : parseStatusField(raw.status);
    if (!status.ok) return status;
    const priority = parsePriorityField(raw.priority);
    if (!priority.ok) return priority;
    const startDate = parseDateField(raw.startDate, "startDate");
    if (!startDate.ok) return startDate;
    const targetDate = parseDateField(raw.targetDate, "targetDate");
    if (!targetDate.ok) return targetDate;
    const progress =
      raw.progress === undefined ? ok<number>(0) : parseProgressField(raw.progress);
    if (!progress.ok) return progress;
    const nextAction = parseOptionalLine(raw.nextAction, "nextAction");
    if (!nextAction.ok) return nextAction;

    // An id may be supplied by the approve path, so the Decision's minted id is
    // the filename the operator finally sees. It must be one path segment: the
    // id is joined under projects/, and `safeJoin` would only stop a traversal
    // that left the vault, not one that landed at the vault root.
    let id: string = randomUUID();
    if (raw.id !== undefined) {
      if (typeof raw.id !== "string" || !PROJECT_ID.test(raw.id.trim())) {
        return fail("id must be a filename-safe string");
      }
      id = raw.id.trim();
    }

    const goal = await assertGoalLive(rootPath, goalId.value);
    if (!goal.ok) return goal;
    const domain = await assertDomainLive(rootPath, domainSlug.value);
    if (!domain.ok) return domain;

    const now = new Date().toISOString();
    const record: Project = {
      id,
      title: title.value,
      summary: summary.value,
      bodyMarkdown: bodyMarkdown.value,
      stateNote: stateNote.value,
      goalId: goalId.value,
      domainSlug: domainSlug.value,
      status: status.value,
      priority: priority.value,
      startDate: startDate.value,
      targetDate: targetDate.value,
      progress: progress.value,
      nextAction: nextAction.value,
      updates: [],
      createdAt: now,
      updatedAt: now,
    };
    await writeProjectFile(rootPath, record);
    const logged = await appendLog(rootPath, {
      domainSlug: record.domainSlug,
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
    if (!patch || typeof patch !== "object") return fail("Project patch is required");
    const loaded = await readProject(rootPath, id);
    if (!loaded.ok) return loaded;

    const current = loaded.value;
    const raw = patch as unknown as Record<string, unknown>;
    const next: Project = { ...current };
    let changed = false;

    const applyFields = async (): Promise<Result<Project> | null> => {
      if (raw.title !== undefined) {
        const title = parseRequiredLine(raw.title, "title");
        if (!title.ok) return title;
        next.title = title.value;
        changed = true;
      }
      if (raw.summary !== undefined) {
        const summary = parseDefaultLine(raw.summary, "summary");
        if (!summary.ok) return summary;
        next.summary = summary.value;
        changed = true;
      }
      if (raw.stateNote !== undefined) {
        const stateNote = parseDefaultLine(raw.stateNote, "stateNote");
        if (!stateNote.ok) return stateNote;
        next.stateNote = stateNote.value;
        changed = true;
      }
      if (raw.bodyMarkdown !== undefined) {
        const bodyMarkdown = parseBody(raw.bodyMarkdown);
        if (!bodyMarkdown.ok) return bodyMarkdown;
        next.bodyMarkdown = bodyMarkdown.value;
        changed = true;
      }
      if (raw.goalId !== undefined) {
        const goalId = parseOptionalLine(raw.goalId, "goalId");
        if (!goalId.ok) return goalId;
        // Only a new value is checked: deleting the goal later must not make
        // every unrelated edit of the project fail.
        if (goalId.value !== current.goalId) {
          const goal = await assertGoalLive(rootPath, goalId.value);
          if (!goal.ok) return goal;
        }
        next.goalId = goalId.value;
        changed = true;
      }
      if (raw.domainSlug !== undefined) {
        const domainSlug = parseOptionalLine(raw.domainSlug, "domainSlug");
        if (!domainSlug.ok) return domainSlug;
        if (domainSlug.value !== current.domainSlug) {
          const domain = await assertDomainLive(rootPath, domainSlug.value);
          if (!domain.ok) return domain;
        }
        next.domainSlug = domainSlug.value;
        changed = true;
      }
      if (raw.status !== undefined) {
        const status = parseStatusField(raw.status);
        if (!status.ok) return status;
        next.status = status.value;
        changed = true;
      }
      if (raw.priority !== undefined) {
        const priority = parsePriorityField(raw.priority);
        if (!priority.ok) return priority;
        next.priority = priority.value;
        changed = true;
      }
      if (raw.startDate !== undefined) {
        const startDate = parseDateField(raw.startDate, "startDate");
        if (!startDate.ok) return startDate;
        next.startDate = startDate.value;
        changed = true;
      }
      if (raw.targetDate !== undefined) {
        const targetDate = parseDateField(raw.targetDate, "targetDate");
        if (!targetDate.ok) return targetDate;
        next.targetDate = targetDate.value;
        changed = true;
      }
      if (raw.progress !== undefined) {
        const progress = parseProgressField(raw.progress);
        if (!progress.ok) return progress;
        next.progress = progress.value;
        changed = true;
      }
      if (raw.nextAction !== undefined) {
        const nextAction = parseOptionalLine(raw.nextAction, "nextAction");
        if (!nextAction.ok) return nextAction;
        next.nextAction = nextAction.value;
        changed = true;
      }
      return null;
    };
    const fieldError = await applyFields();
    if (fieldError) return fieldError;

    if (raw.addUpdate !== undefined) {
      const parsed = parseAddUpdate(raw.addUpdate);
      if (!parsed.ok) return parsed;
      const minted: ProjectUpdate = {
        id: randomUUID(),
        at: new Date().toISOString(),
        note: parsed.value.note,
        progress: parsed.value.progress,
        // The operator has no name to record; a named agent does.
        actorName: actor.type === "agent" ? actor.name : null,
      };
      next.updates = [...next.updates, minted];
      // A logged percent is also the project's percent: the timeline and the
      // bar never disagree about where the project is.
      if (parsed.value.progress !== null) next.progress = parsed.value.progress;
      changed = true;
    }

    if (!changed) return ok(current);
    next.updatedAt = new Date().toISOString();
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

function parseAddUpdate(
  value: unknown,
): Result<{ note: string; progress: number | null }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("addUpdate must be an object with a note");
  }
  const raw = value as Record<string, unknown>;
  // The note lives inside the frontmatter's JSON array, not in a scalar, so it
  // may be prose; only emptiness is refused.
  if (typeof raw.note !== "string" || !raw.note.trim()) {
    return fail("addUpdate.note is required");
  }
  let progress: number | null = null;
  if (raw.progress !== undefined && raw.progress !== null) {
    const parsed = parseProgressField(raw.progress);
    if (!parsed.ok) return parsed;
    progress = parsed.value;
  }
  return ok({ note: raw.note.trim(), progress });
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
// Agent reads. Direct, no Decision: the companion must be able to answer
// "where are my projects?" without asking the operator to approve a read.
// ---------------------------------------------------------------------------

export const PROJECT_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_projects",
    description:
      "List the operator's Projects as compact records: status, priority, progress, summary, " +
      "current state note, next action, goal and domain, dates. No bodies and no progress " +
      "timelines are included; use get_project for one project in full. Filter by status, " +
      "goalId or domainSlug. Reads the vault directly and creates nothing.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...PROJECT_STATUSES] },
        goalId: { type: "string" },
        domainSlug: { type: "string" },
      },
    },
  },
  {
    name: "get_project",
    description:
      "Read one Project in full by id: every attribute, its context document (bodyMarkdown) " +
      "and its progress timeline (updates), plus the work collated around it — tasks linked " +
      "by links.projectId, the signals reached through those tasks, the Decisions filed " +
      "against this project, and its recent project log lines. A project is not a document: " +
      "call this, not get_document.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The project id, which is its filename in projects/." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_project",
    description:
      "Propose a new Project with any of its built-in attributes. Files a pending Decision; " +
      "nothing is written until the operator approves.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string", description: "One line: what this is." },
        goalId: { type: ["string", "null"], description: "Optional live goal id." },
        domainSlug: { type: ["string", "null"], description: "Optional live domain slug." },
        body: { type: "string", description: "The project's context document." },
        status: { type: "string", enum: [...PROJECT_STATUSES] },
        priority: { type: ["string", "null"], enum: [...PROJECT_PRIORITIES, null] },
        startDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
        targetDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
        progress: { type: "number", description: "Whole percent, 0-100." },
        nextAction: { type: ["string", "null"] },
        stateNote: { type: "string", description: "Where it stands right now." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_project",
    description:
      "Propose a change to a Project by id: any attribute, plus addUpdate to append one entry " +
      "to the progress timeline (and set the percent when it carries one). Files a pending " +
      "Decision; nothing is written until the operator approves.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        goalId: { type: ["string", "null"] },
        domainSlug: { type: ["string", "null"] },
        body: { type: "string" },
        status: { type: "string", enum: [...PROJECT_STATUSES] },
        priority: { type: ["string", "null"], enum: [...PROJECT_PRIORITIES, null] },
        startDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
        targetDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
        progress: { type: "number", description: "Whole percent, 0-100." },
        nextAction: { type: ["string", "null"] },
        stateNote: { type: "string" },
        addUpdate: {
          type: "object",
          properties: {
            note: { type: "string" },
            progress: { type: ["number", "null"], description: "Whole percent, 0-100." },
          },
          required: ["note"],
        },
      },
      required: ["id"],
    },
  },
  {
    name: "close_project",
    description:
      "Propose closing a Project by id. Files a pending Decision; nothing is written until " +
      "the operator approves.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
];

export function isProjectReadTool(name: string): boolean {
  return name === "list_projects" || name === "get_project";
}

export type ProjectToolResult =
  | Record<string, unknown>
  | { error: { code: string; message: string } };

function toolError(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function toListEntry(project: Project): ProjectListEntry {
  return {
    id: project.id,
    title: project.title,
    summary: project.summary,
    stateNote: project.stateNote,
    goalId: project.goalId,
    domainSlug: project.domainSlug,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate,
    targetDate: project.targetDate,
    progress: project.progress,
    nextAction: project.nextAction,
    updatedAt: project.updatedAt,
  };
}

const PROJECT_LOG_LIMIT = 20;

/**
 * A Decision belongs to this project when its target names the id. Decisions
 * filed before the target carried an id are found through their proposed body,
 * which was the command JSON: the id is in there even though the target is not.
 */
function decisionNamesProject(decision: DecisionRecord, projectId: string): boolean {
  if (decision.target.type !== "project") return false;
  if (decision.target.id === projectId) return true;
  try {
    const body: unknown = JSON.parse(decision.proposedBodyMarkdown);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (record.id === projectId) return true;
      const patch = record.patch;
      if (patch && typeof patch === "object" && !Array.isArray(patch)) {
        if ((patch as Record<string, unknown>).id === projectId) return true;
      }
    }
  } catch {
    // Not JSON: fall back to the plain "mentions the id" check below.
  }
  return decision.proposedBodyMarkdown.includes(projectId);
}

function projectLogLines(log: LifeEvent[], projectId: string): LifeEvent[] {
  const matching = log.filter((event) => {
    if (typeof event.type !== "string" || !event.type.startsWith("project.")) return false;
    const payload = event.payload;
    return (
      !!payload &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).id === projectId
    );
  });
  // "Recent" means the tail of the log; the whole history of a long project
  // would crowd out the project itself in the tool result.
  return matching.slice(-PROJECT_LOG_LIMIT);
}

async function executeListProjects(
  root: string,
  args: Record<string, unknown>,
): Promise<ProjectToolResult> {
  const listed = await projectList(root);
  if (!listed.ok) return toolError("IO", listed.error);
  let records = listed.value.records;

  if (args.status !== undefined) {
    if (!isProjectStatus(args.status)) {
      return toolError("MALFORMED", `Invalid project status: ${String(args.status)}`);
    }
    records = records.filter((record) => record.status === args.status);
  }
  if (args.goalId !== undefined) {
    if (typeof args.goalId !== "string" || !args.goalId.trim()) {
      return toolError("MALFORMED", "goalId must be a non-empty string");
    }
    const goalId = args.goalId.trim();
    records = records.filter((record) => record.goalId === goalId);
  }
  if (args.domainSlug !== undefined) {
    if (typeof args.domainSlug !== "string" || !args.domainSlug.trim()) {
      return toolError("MALFORMED", "domainSlug must be a non-empty string");
    }
    const domainSlug = args.domainSlug.trim();
    records = records.filter((record) => record.domainSlug === domainSlug);
  }

  return { projects: records.map(toListEntry), total: records.length };
}

async function executeGetProject(
  root: string,
  args: Record<string, unknown>,
): Promise<ProjectToolResult> {
  if (typeof args.id !== "string" || !args.id.trim()) {
    return toolError("MALFORMED", "id is required");
  }
  const id = args.id.trim();
  const loaded = await projectGet(root, id);
  if (!loaded.ok) {
    return toolError(/not found/i.test(loaded.error) ? "NOT_FOUND" : "IO", loaded.error);
  }

  const snapshot = await openVault(root);
  if (!snapshot.ok) return toolError("IO", snapshot.error);
  const signals = await listSignals(root);
  if (!signals.ok) return toolError("IO", signals.error);

  const tasks: Task[] = (snapshot.value.map?.tasks ?? []).filter(
    (task) => task.links?.projectId === id,
  );
  const linkedSignalIds = new Set<string>();
  for (const task of tasks) {
    if (typeof task.links?.signalId === "string" && task.links.signalId) {
      linkedSignalIds.add(task.links.signalId);
    }
  }
  const linkedSignals: SignalRecord[] = signals.value.records.filter((signal) =>
    linkedSignalIds.has(signal.id),
  );
  const decisions = snapshot.value.decisions
    .filter((decision) => decisionNamesProject(decision, id))
    .map((decision) => ({
      id: decision.id,
      target: decision.target,
      status: decision.status,
      title: decision.title,
      proposedTitle: decision.proposedTitle,
      rationale: decision.rationale,
      actor: decision.actor,
      createdAt: decision.createdAt,
      resolvedAt: decision.resolvedAt,
    }));
  const log = projectLogLines(snapshot.value.log, id);

  // Flat, not nested under `project`: a reader asks for project.title and
  // project.tasks from the same object, and every other tool here answers with
  // the record at the top level.
  return {
    ...loaded.value,
    tasks,
    signals: linkedSignals,
    decisions,
    log,
  } as Record<string, unknown>;
}

/**
 * The direct-read half of the companion's project surface. `list_projects` and
 * `get_project` never file a Decision; write tools go through
 * `commandForProjectTool` instead.
 */
export async function executeProjectReadTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ProjectToolResult> {
  const rec = args && typeof args === "object" ? args : {};
  switch (name) {
    case "list_projects":
      return executeListProjects(root, rec);
    case "get_project":
      return executeGetProject(root, rec);
    default:
      return toolError("MALFORMED", `Unknown project read tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Agent writes. These never touch the file; they build the command the desktop
// propose path wraps in a pending Decision, exactly as the goal tools do.
// ---------------------------------------------------------------------------

export function commandForProjectTool(
  name: string,
  args: Record<string, unknown>,
): ProjectCommand | null {
  const rec = args && typeof args === "object" ? args : {};
  switch (name) {
    case "create_project":
      return createProjectCommand(rec);
    case "update_project":
      return updateProjectCommand(rec);
    case "close_project": {
      const id = parseRequiredLine(rec.id, "id");
      if (!id.ok) return null;
      return { type: "closeProject", id: id.value };
    }
    default:
      return null;
  }
}

function createProjectCommand(raw: Record<string, unknown>): ProjectCommand | null {
  const title = parseRequiredLine(raw.title, "title");
  if (!title.ok) return null;
  const goalId = parseOptionalLine(raw.goalId, "goalId");
  if (!goalId.ok) return null;
  const domainSlug = parseOptionalLine(raw.domainSlug, "domainSlug");
  if (!domainSlug.ok) return null;

  const command: Extract<ProjectCommand, { type: "createProject" }> = {
    type: "createProject",
    // Allocated here so approve writes the file under this exact id.
    id: randomUUID(),
    title: title.value,
    goalId: goalId.value,
    domainSlug: domainSlug.value,
  };

  if (raw.body !== undefined) {
    const body = parseBody(raw.body);
    if (!body.ok) return null;
    command.bodyMarkdown = body.value;
  }
  if (raw.summary !== undefined) {
    const summary = parseDefaultLine(raw.summary, "summary");
    if (!summary.ok) return null;
    command.summary = summary.value;
  }
  if (raw.stateNote !== undefined) {
    const stateNote = parseDefaultLine(raw.stateNote, "stateNote");
    if (!stateNote.ok) return null;
    command.stateNote = stateNote.value;
  }
  if (raw.status !== undefined) {
    const status = parseStatusField(raw.status);
    if (!status.ok) return null;
    command.status = status.value;
  }
  if (raw.priority !== undefined) {
    const priority = parsePriorityField(raw.priority);
    if (!priority.ok) return null;
    command.priority = priority.value;
  }
  if (raw.startDate !== undefined) {
    const startDate = parseDateField(raw.startDate, "startDate");
    if (!startDate.ok) return null;
    command.startDate = startDate.value;
  }
  if (raw.targetDate !== undefined) {
    const targetDate = parseDateField(raw.targetDate, "targetDate");
    if (!targetDate.ok) return null;
    command.targetDate = targetDate.value;
  }
  if (raw.progress !== undefined) {
    const progress = parseProgressField(raw.progress);
    if (!progress.ok) return null;
    command.progress = progress.value;
  }
  if (raw.nextAction !== undefined) {
    const nextAction = parseOptionalLine(raw.nextAction, "nextAction");
    if (!nextAction.ok) return null;
    command.nextAction = nextAction.value;
  }
  return command;
}

function updateProjectCommand(raw: Record<string, unknown>): ProjectCommand | null {
  const id = parseRequiredLine(raw.id, "id");
  if (!id.ok) return null;
  const patch: ProjectUpdatePatch = {};

  if (raw.title !== undefined) {
    const title = parseRequiredLine(raw.title, "title");
    if (!title.ok) return null;
    patch.title = title.value;
  }
  if (raw.summary !== undefined) {
    const summary = parseDefaultLine(raw.summary, "summary");
    if (!summary.ok) return null;
    patch.summary = summary.value;
  }
  if (raw.stateNote !== undefined) {
    const stateNote = parseDefaultLine(raw.stateNote, "stateNote");
    if (!stateNote.ok) return null;
    patch.stateNote = stateNote.value;
  }
  if (raw.body !== undefined) {
    const body = parseBody(raw.body);
    if (!body.ok) return null;
    patch.bodyMarkdown = body.value;
  }
  if (raw.goalId !== undefined) {
    const goalId = parseOptionalLine(raw.goalId, "goalId");
    if (!goalId.ok) return null;
    patch.goalId = goalId.value;
  }
  if (raw.domainSlug !== undefined) {
    const domainSlug = parseOptionalLine(raw.domainSlug, "domainSlug");
    if (!domainSlug.ok) return null;
    patch.domainSlug = domainSlug.value;
  }
  if (raw.status !== undefined) {
    const status = parseStatusField(raw.status);
    if (!status.ok) return null;
    patch.status = status.value;
  }
  if (raw.priority !== undefined) {
    const priority = parsePriorityField(raw.priority);
    if (!priority.ok) return null;
    patch.priority = priority.value;
  }
  if (raw.startDate !== undefined) {
    const startDate = parseDateField(raw.startDate, "startDate");
    if (!startDate.ok) return null;
    patch.startDate = startDate.value;
  }
  if (raw.targetDate !== undefined) {
    const targetDate = parseDateField(raw.targetDate, "targetDate");
    if (!targetDate.ok) return null;
    patch.targetDate = targetDate.value;
  }
  if (raw.progress !== undefined) {
    const progress = parseProgressField(raw.progress);
    if (!progress.ok) return null;
    patch.progress = progress.value;
  }
  if (raw.nextAction !== undefined) {
    const nextAction = parseOptionalLine(raw.nextAction, "nextAction");
    if (!nextAction.ok) return null;
    patch.nextAction = nextAction.value;
  }
  if (raw.addUpdate !== undefined) {
    if (!raw.addUpdate || typeof raw.addUpdate !== "object" || Array.isArray(raw.addUpdate)) {
      return null;
    }
    const entry = raw.addUpdate as Record<string, unknown>;
    if (typeof entry.note !== "string" || !entry.note.trim()) return null;
    const addUpdate: { note: string; progress?: number | null } = {
      note: entry.note.trim(),
    };
    if (entry.progress !== undefined) {
      if (entry.progress === null) {
        addUpdate.progress = null;
      } else {
        const progress = parseProgressField(entry.progress);
        if (!progress.ok) return null;
        addUpdate.progress = progress.value;
      }
    }
    patch.addUpdate = addUpdate;
  }

  // A patch that names nothing is a no-op, not a Decision the operator has to
  // read and decline; the caller treats null as an unknown tool.
  if (Object.keys(patch).length === 0) return null;
  return { type: "updateProject", id: id.value, patch };
}
