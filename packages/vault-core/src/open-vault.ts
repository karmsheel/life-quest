import fs from "node:fs/promises";
import path from "node:path";
import { countWeeklyVaultFiles } from "./agents.ts";
import { readOrCreateDoctrineFile } from "./domain-documents.ts";
import { loadGoals } from "./goals.ts";
import { readLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import { ensureMapOnOpen } from "./map/persist.ts";
import { listPlanningIndex } from "./planning-stubs.ts";
import { listReviewIndex } from "./reviews.ts";
import {
  DOCUMENT_KINDS,
  SCHEMA_VERSION,
  type AgentHire,
  type DecisionRecord,
  type DocumentKind,
  type DoctrineDocument,
  type DomainMeta,
  type DomainRecord,
  type Goal,
  type LifequestJson,
  type PlanningIndexEntry,
  type Result,
  type ReviewIndexEntry,
  type VaultSettings,
  type VaultSnapshot,
} from "./types.ts";

async function loadDomain(rootPath: string, slug: string): Promise<DomainRecord> {
  const paths = vaultPaths(rootPath);
  const metaRaw = await fs.readFile(paths.domainJson(slug), "utf8");
  const meta = JSON.parse(metaRaw) as DomainMeta;
  const documents = {} as Record<DocumentKind, DoctrineDocument>;
  for (const kind of DOCUMENT_KINDS) {
    documents[kind] = await readOrCreateDoctrineFile(
      paths.documentMd(slug, kind),
      kind,
    );
  }
  return { slug, meta, documents };
}

export async function openVault(rootPath: string): Promise<Result<VaultSnapshot>> {
  try {
    const paths = vaultPaths(rootPath);
    const lifequestRaw = await fs.readFile(paths.lifequestJson, "utf8");
    const lifequest = JSON.parse(lifequestRaw) as LifequestJson;
    if (lifequest.schemaVersion !== SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Unsupported schemaVersion ${String((lifequest as { schemaVersion?: unknown }).schemaVersion)}; expected ${SCHEMA_VERSION}`,
      };
    }

    const settingsRaw = await fs.readFile(paths.settingsJson, "utf8");
    const parsedSettings = JSON.parse(settingsRaw) as VaultSettings;
    const settings: VaultSettings = {
      ...parsedSettings,
      weekStartDay:
        parsedSettings.weekStartDay === "sunday" ||
        parsedSettings.weekStartDay === "monday"
          ? parsedSettings.weekStartDay
          : "monday",
    };

    const agentsRaw = await fs.readFile(paths.agentsJson, "utf8");
    const agentsParsed = JSON.parse(agentsRaw) as { hires?: AgentHire[] };
    const agents = Array.isArray(agentsParsed.hires) ? agentsParsed.hires : [];

    let decisions: DecisionRecord[] = [];
    try {
      const decisionEntries = await fs.readdir(paths.decisionsDir, { withFileTypes: true });
      for (const entry of decisionEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(paths.decisionsDir, entry.name), "utf8");
        decisions.push(JSON.parse(raw) as DecisionRecord);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }

    const logRes = await readLog(paths.root);
    if (!logRes.ok) return logRes;
    const log = logRes.value;

    const domains: DomainRecord[] = [];
    try {
      const domainEntries = await fs.readdir(paths.domainsDir, { withFileTypes: true });
      const slugs = domainEntries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      for (const slug of slugs) {
        domains.push(await loadDomain(paths.root, slug));
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }

    // Stable domain order by sortOrder then slug
    domains.sort((a, b) => {
      if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
      return a.slug.localeCompare(b.slug);
    });

    let map: VaultSnapshot["map"] = null;
    let mapError: string | null = null;
    const mapRes = await ensureMapOnOpen(paths.root);
    if (mapRes.ok) {
      map = mapRes.value;
    } else {
      mapError = mapRes.error;
    }

    let goals: Goal[] = [];
    let goalsError: string | null = null;
    const goalsRes = await loadGoals(paths.root);
    if (goalsRes.ok) {
      goals = goalsRes.value;
    } else {
      goalsError = goalsRes.error;
    }

    let reviews: ReviewIndexEntry[] = [];
    const reviewsRes = await listReviewIndex(paths.root);
    if (reviewsRes.ok) {
      reviews = reviewsRes.value;
    }

    let planning: PlanningIndexEntry[] = [];
    const planningRes = await listPlanningIndex(paths.root);
    if (planningRes.ok) {
      planning = planningRes.value;
    }

    let weeklyFileCount = 0;
    try {
      weeklyFileCount = await countWeeklyVaultFiles(paths.root);
    } catch {
      weeklyFileCount = 0;
    }

    return {
      ok: true,
      value: {
        rootPath: paths.root,
        lifequest,
        settings,
        domains,
        agents,
        decisions,
        log,
        map,
        mapError,
        goals,
        goalsError,
        reviews,
        planning,
        weeklyFileCount,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
