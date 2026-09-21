import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { isFuturePeriod, periodBounds, periodTitle } from "./period.ts";
import { listDomains } from "./domains.ts";
import { vaultPaths } from "./paths.ts";
import {
  type Actor,
  type Result,
  type ReviewCadence,
  type ReviewIndexEntry,
  type ReviewRecord,
  type ReviewScopeState,
  type WeekStartDay,
} from "./types.ts";

const OVERALL = "overall";
const DOMAIN_HEADINGS = ["Look-back", "Keep", "Change", "Next-period intent"] as const;

function isOverall(scope: string): boolean {
  return scope === OVERALL;
}

function todayIso(): string {
  return new Date().toISOString();
}

async function readSettings(rootPath: string): Promise<WeekStartDay> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.settingsJson, "utf8");
    const parsed = JSON.parse(raw) as { weekStartDay?: string };
    return parsed.weekStartDay === "sunday" ? "sunday" : "monday";
  } catch {
    return "monday";
  }
}

async function readDomainNames(rootPath: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const listed = await listDomains(rootPath);
  if (!listed.ok) return names;
  for (const d of listed.value) {
    names.set(d.slug, d.meta.name);
  }
  return names;
}

function buildOverallSkeleton(): string {
  const lines: string[] = [];
  for (const h of DOMAIN_HEADINGS) {
    lines.push(`## ${h}`, "");
  }
  return lines.join("\n");
}

function buildDomainSkeleton(name: string): string {
  const lines: string[] = [`## ${name}`, ""];
  for (const h of DOMAIN_HEADINGS) {
    lines.push(`### ${h}`, "");
  }
  return lines.join("\n");
}

function hasRequiredHeadings(body: string, scopeNames: Map<string, string>): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const h of DOMAIN_HEADINGS) {
    if (!body.includes(`## ${h}`)) missing.push(h);
  }
  return { ok: missing.length === 0, missing };
}

function extractHeadings(body: string): Array<{ level: number; text: string; idx: number }> {
  const lines = body.split("\n");
  const result: Array<{ level: number; text: string; idx: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      result.push({ level: m[1]!.length, text: m[2]!.trim(), idx: i });
    }
  }
  return result;
}

function isValidReviewFile(filePath: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(filePath) || /^\d{4}-\d{2}\.md$/.test(filePath) || /^\d{4}-Q[1-4]\.md$/.test(filePath) || /^\d{4}\.md$/.test(filePath);
}

async function parseReviewFile(
  rootPath: string,
  cadence: string,
  period: string,
): Promise<Result<ReviewRecord>> {
  const paths = vaultPaths(rootPath);
  const filePath = paths.reviewMd(cadence, period);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const { data, body } = parseFrontmatter(raw);
    // Validate required fields for a review file
    if (
      typeof data.cadence !== "string" ||
      typeof data.period !== "string" ||
      typeof data.scopes !== "object" ||
      data.scopes === null
    ) {
      return { ok: false, error: "Invalid review file: missing required fields" };
    }
    const scopes = data.scopes as Record<string, ReviewScopeState>;
    if (!scopes.overall) scopes.overall = { status: "draft", sessionId: null };
    return {
      ok: true,
      value: {
        cadence: cadence as ReviewCadence,
        period,
        weekStartDay: (typeof data.weekStartDay === "string" ? data.weekStartDay : "monday") as WeekStartDay,
        locked: data.locked === true,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : todayIso(),
        title: typeof data.title === "string" ? data.title : periodTitle(cadence as ReviewCadence, period, await readSettings(rootPath)),
        scopes,
        bodyMarkdown: body,
      },
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "Review file not found" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function canonicalizeBody(
  body: string,
  record: ReviewRecord,
  domainNames: Map<string, string>,
): string {
  // Parse existing headings and their content blocks
  const lines = body.split("\n");
  const sections: Array<{ level: number; text: string; content: string[] }> = [];
  let current: { level: number; text: string; content: string[] } | null = null;

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1]!.length, text: m[2]!.trim(), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);

  // Build required sections
  const out: string[] = [];
  out.push(`# ${record.title}`);

  // Overall required H2s
  for (const h of DOMAIN_HEADINGS) {
    out.push("", `## ${h}`, "");
  }

  // Domain sections (from frontmatter scopes, excluding overall)
  const domainSlugs = Object.keys(record.scopes).filter((s) => s !== OVERALL);
  for (const slug of domainSlugs) {
    const name = domainNames.get(slug) ?? slug;
    out.push("", `## ${name}`, "");
    for (const h of DOMAIN_HEADINGS) {
      out.push(`### ${h}`, "");
    }
  }

  // Extra headings (not required) — preserve after required blocks
  const requiredTexts = new Set<string>();
  requiredTexts.add(record.title);
  for (const h of DOMAIN_HEADINGS) requiredTexts.add(h);
  for (const slug of domainSlugs) {
    const name = domainNames.get(slug) ?? slug;
    requiredTexts.add(name);
  }

  for (const section of sections) {
    if (section.level === 1) continue; // H1 handled
    if (requiredTexts.has(section.text)) continue;
    out.push("", `${"#".repeat(section.level)} ${section.text}`, ...section.content);
  }

  return out.join("\n");
}

function requireOk<T>(r: Result<T>, msg: string): asserts r is { ok: true; value: T } {
  if (!r.ok) throw new Error(`${msg}: ${r.error}`);
}

export async function ensureReview(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string },
): Promise<Result<ReviewRecord>> {
  try {
    const weekStartDay = await readSettings(rootPath);
    const future = isFuturePeriod(input.cadence, input.period, weekStartDay);
    if (future) {
      return { ok: false, error: "Cannot create a future review" };
    }

    const paths = vaultPaths(rootPath);
    const filePath = paths.reviewMd(input.cadence, input.period);

    // Check if file exists
    let existing: ReviewRecord | null = null;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const { data, body } = parseFrontmatter(raw);
      const scopes = (typeof data.scopes === "object" && data.scopes !== null
        ? (data.scopes as Record<string, ReviewScopeState>)
        : {}) as Record<string, ReviewScopeState>;
      if (!scopes.overall) scopes.overall = { status: "draft", sessionId: null };
      existing = {
        cadence: input.cadence,
        period: input.period,
        weekStartDay: (typeof data.weekStartDay === "string" ? data.weekStartDay : weekStartDay) as WeekStartDay,
        locked: data.locked === true,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : todayIso(),
        title: typeof data.title === "string" ? data.title : periodTitle(input.cadence, input.period, weekStartDay),
        scopes,
        bodyMarkdown: body,
      };
    } catch {
      // file missing — create below
    }

    const domainNames = await readDomainNames(rootPath);

    if (!existing) {
      // Create new
      const title = periodTitle(input.cadence, input.period, weekStartDay);
      const overallSection = buildOverallSkeleton();
      let body = `# ${title}\n\n${overallSection}`;

      const scopes: Record<string, ReviewScopeState> = {
        overall: { status: "draft", sessionId: null },
      };

      if (!isOverall(input.scope)) {
        const name = domainNames.get(input.scope) ?? input.scope;
        body += "\n\n" + buildDomainSkeleton(name);
        scopes[input.scope] = { status: "draft", sessionId: null };
      }

      const now = todayIso();
      const md = serializeFrontmatter(
        {
          cadence: input.cadence,
          period: input.period,
          weekStartDay,
          locked: false,
          updatedAt: now,
          title,
          scopes,
        },
        body,
      );
      await atomicWriteFile(filePath, md);
      return parseReviewFile(rootPath, input.cadence, input.period);
    }

    // File exists
    if (isOverall(input.scope)) {
      // already ensured overall by existing
      return { ok: true, value: existing };
    }

    // Domain scope — ensure section
    if (existing.scopes[input.scope]) {
      return { ok: true, value: existing };
    }

    // Append domain section
    const name = domainNames.get(input.scope) ?? input.scope;
    const newBody = existing.bodyMarkdown + "\n\n" + buildDomainSkeleton(name);
    existing.scopes[input.scope] = { status: "draft", sessionId: null };
    existing.updatedAt = todayIso();

    const md = serializeFrontmatter(
      {
        cadence: existing.cadence,
        period: existing.period,
        weekStartDay: existing.weekStartDay,
        locked: existing.locked,
        updatedAt: existing.updatedAt,
        title: existing.title,
        scopes: existing.scopes,
      },
      newBody,
    );
    await atomicWriteFile(filePath, md);
    return parseReviewFile(rootPath, input.cadence, input.period);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getReview(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord>> {
  return parseReviewFile(rootPath, cadence, period);
}

export async function writeReview(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; bodyMarkdown: string; actor: Actor },
): Promise<Result<ReviewRecord>> {
  try {
    const existing = await parseReviewFile(rootPath, input.cadence, input.period);
    if (!existing.ok) return existing;
    const record = existing.value;

    if (record.locked) {
      return { ok: false, error: "LOCKED" };
    }

    // Validate required headings
    const domainNames = await readDomainNames(rootPath);
    const missing: string[] = [];
    for (const h of DOMAIN_HEADINGS) {
      if (!input.bodyMarkdown.includes(`## ${h}`)) missing.push(h);
    }
    if (missing.length > 0) {
      return { ok: false, error: `Missing required headings: ${missing.join(", ")}` };
    }

    // Canonicalize
    const now = todayIso();
    record.updatedAt = now;
    record.bodyMarkdown = canonicalizeBody(input.bodyMarkdown, record, domainNames);

    const filePath = vaultPaths(rootPath).reviewMd(input.cadence, input.period);
    const md = serializeFrontmatter(
      {
        cadence: record.cadence,
        period: record.period,
        weekStartDay: record.weekStartDay,
        locked: record.locked,
        updatedAt: record.updatedAt,
        title: record.title,
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

export async function markReviewDone(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string },
): Promise<Result<ReviewRecord>> {
  try {
    const existing = await parseReviewFile(rootPath, input.cadence, input.period);
    if (!existing.ok) return existing;
    const record = existing.value;

    if (isOverall(input.scope)) {
      record.scopes.overall.status = "done";
      record.locked = true;
    } else {
      const scope = record.scopes[input.scope];
      if (!scope) {
        return { ok: false, error: `Domain scope not found: ${input.scope}` };
      }
      scope.status = "done";
    }

    record.updatedAt = todayIso();
    const filePath = vaultPaths(rootPath).reviewMd(input.cadence, input.period);
    const md = serializeFrontmatter(
      {
        cadence: record.cadence,
        period: record.period,
        weekStartDay: record.weekStartDay,
        locked: record.locked,
        updatedAt: record.updatedAt,
        title: record.title,
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

export async function unlockReview(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord>> {
  try {
    const existing = await parseReviewFile(rootPath, cadence, period);
    if (!existing.ok) return existing;
    const record = existing.value;

    record.locked = false;
    record.updatedAt = todayIso();

    const filePath = vaultPaths(rootPath).reviewMd(cadence, period);
    const md = serializeFrontmatter(
      {
        cadence: record.cadence,
        period: record.period,
        weekStartDay: record.weekStartDay,
        locked: false,
        updatedAt: record.updatedAt,
        title: record.title,
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

export async function setReviewSessionId(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; sessionId: string },
): Promise<Result<ReviewRecord>> {
  try {
    const existing = await parseReviewFile(rootPath, input.cadence, input.period);
    if (!existing.ok) return existing;
    const record = existing.value;

    if (!record.scopes[input.scope]) {
      record.scopes[input.scope] = { status: "draft", sessionId: null };
    }
    record.scopes[input.scope]!.sessionId = input.sessionId;
    record.updatedAt = todayIso();

    const filePath = vaultPaths(rootPath).reviewMd(input.cadence, input.period);
    const md = serializeFrontmatter(
      {
        cadence: record.cadence,
        period: record.period,
        weekStartDay: record.weekStartDay,
        locked: record.locked,
        updatedAt: record.updatedAt,
        title: record.title,
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

export async function listReviewIndex(rootPath: string): Promise<Result<ReviewIndexEntry[]>> {
  try {
    const paths = vaultPaths(rootPath);
    const entries: ReviewIndexEntry[] = [];

    const cadences = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
    for (const cadence of cadences) {
      const cadDir = paths.reviewsCadenceDir(cadence);
      let files: import("node:fs").Dirent[];
      try {
        files = await fs.readdir(cadDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        const period = f.name.replace(/\.md$/, "");
        const r = await parseReviewFile(rootPath, cadence, period);
        if (!r.ok) {
          entries.push({
            cadence,
            period,
            locked: false,
            scopes: {},
            error: r.error,
          });
        } else {
          const rec = r.value;
          entries.push({
            cadence,
            period,
            locked: rec.locked,
            scopes: rec.scopes,
          });
        }
      }
    }

    return { ok: true, value: entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyLockedReviewBody(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  bodyMarkdown: string,
): Promise<Result<ReviewRecord>> {
  try {
    const existing = await parseReviewFile(rootPath, cadence, period);
    if (!existing.ok) return existing;
    const record = existing.value;

    const domainNames = await readDomainNames(rootPath);
    record.updatedAt = todayIso();
    record.bodyMarkdown = canonicalizeBody(bodyMarkdown, record, domainNames);
    record.locked = true;

    const filePath = vaultPaths(rootPath).reviewMd(cadence, period);
    const md = serializeFrontmatter(
      {
        cadence: record.cadence,
        period: record.period,
        weekStartDay: record.weekStartDay,
        locked: true,
        updatedAt: record.updatedAt,
        title: record.title,
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
