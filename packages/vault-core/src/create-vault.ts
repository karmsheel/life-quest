import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { openVault } from "./open-vault.ts";
import { vaultPaths } from "./paths.ts";
import {
  DEFAULT_HERMES_URL,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  SCHEMA_VERSION,
  SEED_DOMAINS,
  type DomainMeta,
  type LifequestJson,
  type Result,
  type VaultSettings,
  type VaultSnapshot,
} from "./types.ts";

export async function createVault(
  rootPath: string,
  name = "Personal",
): Promise<Result<VaultSnapshot>> {
  try {
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.root, { recursive: true });

    try {
      await fs.access(paths.lifequestJson);
      return { ok: false, error: `Vault already exists at ${paths.root}` };
    } catch {
      // lifequest.json missing — proceed
    }

    const now = new Date().toISOString();
    const lifequest: LifequestJson = {
      schemaVersion: SCHEMA_VERSION,
      id: randomUUID(),
      name,
      createdAt: now,
    };
    await atomicWriteFile(paths.lifequestJson, `${JSON.stringify(lifequest, null, 2)}\n`);

    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await fs.mkdir(paths.decisionsDir, { recursive: true });
    await fs.mkdir(paths.domainsDir, { recursive: true });

    const settings: VaultSettings = {
      hermesBaseUrl: DEFAULT_HERMES_URL,
      theme: "system",
    };
    await atomicWriteFile(paths.settingsJson, `${JSON.stringify(settings, null, 2)}\n`);
    await atomicWriteFile(paths.agentsJson, `${JSON.stringify({ hires: [] }, null, 2)}\n`);
    await atomicWriteFile(paths.logJsonl, "");

    for (let i = 0; i < SEED_DOMAINS.length; i++) {
      const seed = SEED_DOMAINS[i]!;
      const meta: DomainMeta = {
        name: seed.name,
        description: null,
        color: null,
        sortOrder: i,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await fs.mkdir(paths.domainDir(seed.slug), { recursive: true });
      await atomicWriteFile(paths.domainJson(seed.slug), `${JSON.stringify(meta, null, 2)}\n`);

      for (const kind of DOCUMENT_KINDS) {
        const md = serializeFrontmatter(
          {
            title: DOCUMENT_KIND_LABELS[kind],
            locked: false,
            updatedAt: now,
          },
          "",
        );
        await atomicWriteFile(paths.documentMd(seed.slug, kind), md);
      }

      const logRes = await appendLog(paths.root, {
        domainSlug: seed.slug,
        type: "domain.created",
        summary: `Created domain ${seed.name}`,
        payload: { name: seed.name },
      });
      if (!logRes.ok) return logRes;
    }

    return openVault(paths.root);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
