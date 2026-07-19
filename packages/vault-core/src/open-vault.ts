import fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { readLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DOCUMENT_KINDS,
  SCHEMA_VERSION,
  type AgentHire,
  type DecisionRecord,
  type DocumentKind,
  type DocumentStatus,
  type DoctrineDocument,
  type DomainMeta,
  type DomainRecord,
  type LifequestJson,
  type Result,
  type VaultSettings,
  type VaultSnapshot,
} from "./types.ts";

async function readDoctrineFile(filePath: string, kind: DocumentKind): Promise<DoctrineDocument> {
  const raw = await fs.readFile(filePath, "utf8");
  const st = await fs.stat(filePath);
  const { data, body } = parseFrontmatter(raw);
  return {
    kind,
    title: typeof data.title === "string" ? data.title : kind[0]!.toUpperCase() + kind.slice(1),
    status: (data.status as DocumentStatus) || "draft",
    forgedAt: (data.forgedAt as string | null) ?? null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : st.mtime.toISOString(),
    bodyMarkdown: body,
    mtimeMs: st.mtimeMs,
  };
}

async function loadDomain(rootPath: string, slug: string): Promise<DomainRecord> {
  const paths = vaultPaths(rootPath);
  const metaRaw = await fs.readFile(paths.domainJson(slug), "utf8");
  const meta = JSON.parse(metaRaw) as DomainMeta;
  const documents = {} as Record<DocumentKind, DoctrineDocument>;
  for (const kind of DOCUMENT_KINDS) {
    documents[kind] = await readDoctrineFile(paths.documentMd(slug, kind), kind);
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
    const settings = JSON.parse(settingsRaw) as VaultSettings;

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
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
