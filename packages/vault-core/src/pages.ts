import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  PAGE_BLOCK_KINDS,
  METRIC_AGGS,
  CHART_TYPES,
  type Actor,
  type PageBlock,
  type PageBlockKind,
  type PageListEntry,
  type PageRecord,
  type PageWriteResult,
  type Result,
} from "./types.ts";

function isPageBlockKind(kind: string): kind is PageBlockKind {
  return (PAGE_BLOCK_KINDS as readonly string[]).includes(kind);
}

function isMetricAgg(agg: string): agg is "sum" | "count" | "last" {
  return (METRIC_AGGS as readonly string[]).includes(agg);
}

function isChartType(t: string): t is "bar" | "line" {
  return (CHART_TYPES as readonly string[]).includes(t);
}

function isValidDate(s: string | null): boolean {
  if (s === null) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validateBlocks(
  blocks: unknown,
  registry: { databases: Array<{ id: string; columns: Array<{ id: string }> }> } | null,
): Result<PageBlock[]> {
  if (!Array.isArray(blocks)) {
    return { ok: false, error: "blocks must be an array" };
  }
  let dateRangeCount = 0;
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "block must be an object" };
    }
    const b = raw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) {
      return { ok: false, error: "block id is required" };
    }
    if (!isPageBlockKind(b.kind)) {
      return { ok: false, error: `Unknown block kind: ${String(b.kind)}` };
    }
    if (b.kind === "date-range") {
      dateRangeCount++;
      if (dateRangeCount > 1) {
        return { ok: false, error: "At most one date-range block per page" };
      }
      if (!isValidDate(b.start as string | null) || !isValidDate(b.end as string | null)) {
        return { ok: false, error: "date-range start/end must be YYYY-MM-DD or null" };
      }
      if (b.start !== null && b.end !== null && (b.start as string) > (b.end as string)) {
        return { ok: false, error: "date-range start must be <= end" };
      }
    }
    if (b.kind === "markdown") {
      if (typeof b.markdown !== "string") {
        return { ok: false, error: "markdown block requires markdown string" };
      }
    }
    if (b.kind === "bound-table") {
      if (typeof b.databaseId !== "string" || !b.databaseId) {
        return { ok: false, error: "bound-table requires databaseId" };
      }
      if (registry) {
        if (!registry.databases.some((d) => d.id === b.databaseId)) {
          return { ok: false, error: `Database not found: ${b.databaseId}` };
        }
      }
    }
    if (b.kind === "metric") {
      if (typeof b.databaseId !== "string" || !b.databaseId) {
        return { ok: false, error: "metric requires databaseId" };
      }
      if (typeof b.columnId !== "string" || !b.columnId) {
        return { ok: false, error: "metric requires columnId" };
      }
      if (!isMetricAgg(b.agg)) {
        return { ok: false, error: `Invalid metric agg: ${String(b.agg)}` };
      }
      if (registry) {
        const db = registry.databases.find((d) => d.id === b.databaseId);
        if (!db) return { ok: false, error: `Database not found: ${b.databaseId}` };
        if (!db.columns.some((c) => c.id === b.columnId)) {
          return { ok: false, error: `Column not found: ${b.columnId}` };
        }
      }
      if (b.convertToZar !== undefined && typeof b.convertToZar !== "boolean") {
        return { ok: false, error: "convertToZar must be boolean" };
      }
    }
    if (b.kind === "chart") {
      if (!isChartType(b.chartType)) {
        return { ok: false, error: `Invalid chart type: ${String(b.chartType)}` };
      }
      if (typeof b.databaseId !== "string" || !b.databaseId) {
        return { ok: false, error: "chart requires databaseId" };
      }
      if (typeof b.xColumnId !== "string" || !b.xColumnId) {
        return { ok: false, error: "chart requires xColumnId" };
      }
      if (typeof b.yColumnId !== "string" || !b.yColumnId) {
        return { ok: false, error: "chart requires yColumnId" };
      }
      if (registry) {
        const db = registry.databases.find((d) => d.id === b.databaseId);
        if (!db) return { ok: false, error: `Database not found: ${b.databaseId}` };
        if (!db.columns.some((c) => c.id === b.xColumnId)) {
          return { ok: false, error: `Column not found: ${b.xColumnId}` };
        }
        if (!db.columns.some((c) => c.id === b.yColumnId)) {
          return { ok: false, error: `Column not found: ${b.yColumnId}` };
        }
      }
    }
    // goal-progress, deadline, budget-vs-actual, net-worth have no extra fields to validate
    if (b.kind === "scenario-compare") {
      if (typeof b.assumptionSetId !== "string" || !(b.assumptionSetId as string).trim()) {
        return { ok: false, error: "scenario-compare requires a non-empty assumptionSetId" };
      }
      if (b.compareSetId !== undefined && b.compareSetId !== null) {
        if (typeof b.compareSetId !== "string" || !(b.compareSetId as string).trim()) {
          return { ok: false, error: "scenario-compare compareSetId must be a non-empty string" };
        }
      }
    }
  }
  return { ok: true, value: blocks as PageBlock[] };
}

async function isDomainLive(root: string, slug: string): Promise<boolean> {
  try {
    const metaPath = vaultPaths(root).domainJson(slug);
    const raw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(raw);
    return meta.archivedAt == null;
  } catch {
    return false;
  }
}

async function readRegistry(
  registryPath: string,
): Promise<{ databases: Array<{ id: string; columns: Array<{ id: string }> }> } | null> {
  try {
    const raw = await fs.readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.databases)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function readPageFile(filePath: string): Promise<PageRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.id === "string" &&
      typeof parsed.domainSlug === "string" &&
      typeof parsed.title === "string" &&
      Array.isArray(parsed.blocks)
    ) {
      return parsed as PageRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export async function listPages(
  root: string,
  domainSlug?: string | null,
): Promise<Result<PageListEntry[]>> {
  try {
    const paths = vaultPaths(root);
    const entries: PageListEntry[] = [];

    const slugs: string[] = domainSlug == null ? [] : [domainSlug];
    if (domainSlug == null) {
      // Union: read all live domains
      try {
        const domainEntries = await fs.readdir(paths.domainsDir, { withFileTypes: true });
        for (const entry of domainEntries) {
          if (!entry.isDirectory()) continue;
          const metaPath = paths.domainJson(entry.name);
          try {
            const raw = await fs.readFile(metaPath, "utf8");
            const meta = JSON.parse(raw);
            if (meta.archivedAt == null) slugs.push(entry.name);
          } catch {}
        }
      } catch {}
    }

    for (const slug of slugs) {
      const pagesDir = paths.domainPagesDir(slug);
      try {
        const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true });
        for (const entry of pageEntries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          const pageId = entry.name.replace(/\.json$/, "");
          const page = await readPageFile(paths.domainPage(slug, pageId));
          if (page) {
            entries.push({ domainSlug: slug, page });
          }
        }
      } catch {
        // missing pages/ → that domain contributes []
      }
    }

    return { ok: true, value: entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getPage(
  root: string,
  slug: string,
  pageId: string,
): Promise<Result<PageRecord>> {
  try {
    const paths = vaultPaths(root);
    const filePath = paths.domainPage(slug, pageId);
    const page = await readPageFile(filePath);
    if (!page) {
      return { ok: false, error: `Page not found: ${pageId}` };
    }
    return { ok: true, value: page };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createPage(
  root: string,
  slug: string,
  input: { title: string },
): Promise<Result<PageRecord>> {
  try {
    const title = input.title?.trim();
    if (!title) return { ok: false, error: "Page title is required" };
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const paths = vaultPaths(root);
    const pagesDir = paths.domainPagesDir(slug);
    await fs.mkdir(pagesDir, { recursive: true });

    const now = new Date().toISOString();
    const page: PageRecord = {
      id: randomUUID(),
      domainSlug: slug,
      title,
      blocks: [],
      createdAt: now,
      updatedAt: now,
    };

    const filePath = paths.domainPage(slug, page.id);
    await atomicWriteFile(filePath, `${JSON.stringify(page, null, 2)}\n`);

    await appendLog(root, {
      domainSlug: slug,
      type: "page.created",
      summary: `Created page ${title}`,
      payload: { pageId: page.id, title },
    });

    return { ok: true, value: page };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updatePage(
  root: string,
  slug: string,
  pageId: string,
  input: { title?: string; blocks?: PageBlock[] },
  actor: Actor,
): Promise<Result<PageWriteResult>> {
  try {
    const paths = vaultPaths(root);
    const filePath = paths.domainPage(slug, pageId);
    const existing = await readPageFile(filePath);
    if (!existing) {
      return { ok: false, error: `Page not found: ${pageId}` };
    }

    // Validate blocks if provided
    let blocks = existing.blocks;
    if (input.blocks !== undefined) {
      const registryPath = paths.domainRegistry(slug);
      const registry = await readRegistry(registryPath);
      const validation = validateBlocks(input.blocks, registry);
      if (!validation.ok) return validation;
      blocks = validation.value;
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title) return { ok: false, error: "Page title is required" };

    const now = new Date().toISOString();
    const updated: PageRecord = {
      ...existing,
      title,
      blocks,
      updatedAt: now,
    };

    // Agent actor → create Decision, do NOT write
    if (actor.type === "agent") {
      const { createDecision } = await import("./decisions.ts");
      const decisionRes = await createDecision(root, {
        target: { type: "page", domainSlug: slug, pageId },
        proposedTitle: title,
        previousTitle: existing.title,
        proposedBodyMarkdown: JSON.stringify({ title, blocks }, null, 2),
        actor,
      });
      if (!decisionRes.ok) return decisionRes;
      return { ok: true, value: { applied: false, decision: decisionRes.value } };
    }

    // User actor → write file
    await atomicWriteFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);
    return { ok: true, value: { applied: true, page: updated } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deletePage(
  root: string,
  slug: string,
  pageId: string,
): Promise<Result<{ id: string }>> {
  try {
    const paths = vaultPaths(root);
    const filePath = paths.domainPage(slug, pageId);
    try {
      await fs.unlink(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Page not found: ${pageId}` };
      }
      throw e;
    }

    // Strip matching page pins from domain board and overview board
    const { listPins, setPins, defaultPins } = await import("./pins.ts");

    // Domain board
    const domainPinsRes = await listPins(root, slug);
    if (domainPinsRes.ok) {
      const remaining = domainPinsRes.value.filter(
        (p) => !(p.kind === "page" && p.domainSlug === slug && p.pageId === pageId),
      );
      if (remaining.length !== domainPinsRes.value.length) {
        await setPins(root, slug, remaining, { type: "user" });
      }
    }

    // Overview board
    const overviewPinsRes = await listPins(root, null);
    if (overviewPinsRes.ok) {
      const remaining = overviewPinsRes.value.filter(
        (p) => !(p.kind === "page" && p.domainSlug === slug && p.pageId === pageId),
      );
      if (remaining.length !== overviewPinsRes.value.length) {
        await setPins(root, null, remaining, { type: "user" });
      }
    }

    return { ok: true, value: { id: pageId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
