import path from "node:path";

export function vaultPaths(root: string) {
  const rootPath = path.resolve(root);
  return {
    root: rootPath,
    lifequestJson: path.join(rootPath, "lifequest.json"),
    domainsDir: path.join(rootPath, "domains"),
    lifequestDir: path.join(rootPath, ".lifequest"),
    settingsJson: path.join(rootPath, ".lifequest", "settings.json"),
    agentsJson: path.join(rootPath, ".lifequest", "agents.json"),
    logJsonl: path.join(rootPath, ".lifequest", "log.jsonl"),
    decisionsDir: path.join(rootPath, ".lifequest", "decisions"),
    signalChainDir: path.join(rootPath, ".lifequest", "signal-chain"),
    domainDir: (slug: string) => safeJoin(rootPath, "domains", slug),
    domainJson: (slug: string) => safeJoin(rootPath, "domains", slug, "domain.json"),
    documentMd: (slug: string, kind: string) =>
      safeJoin(rootPath, "domains", slug, `${kind}.md`),
    domainMediaDir: (slug: string) => safeJoin(rootPath, "domains", slug, "media"),
    domainMediaFile: (slug: string, name: string) =>
      safeJoin(rootPath, "domains", slug, "media", name),
    decisionJson: (id: string) =>
      safeJoin(rootPath, ".lifequest", "decisions", `${id}.json`),
    signalChainJson: (id: string) =>
      safeJoin(rootPath, ".lifequest", "signal-chain", `${id}.json`),
    mapJson: path.join(rootPath, ".lifequest", "map.json"),
    goalsJson: path.join(rootPath, ".lifequest", "goals.json"),
    aboutMd: path.join(rootPath, ".lifequest", "about.md"),
    documentsDir: path.join(rootPath, "documents"),
    libraryDocumentMd: (id: string) =>
      safeJoin(rootPath, "documents", `${id}.md`),
    // KAR-7 project documents
    projectsDir: path.join(rootPath, "projects"),
    projectMd: (id: string) => safeJoin(rootPath, "projects", `${id}.md`),
    reviewsDir: path.join(rootPath, "reviews"),
    reviewsCadenceDir: (cadence: string) =>
      safeJoin(rootPath, "reviews", cadence),
    reviewMd: (cadence: string, period: string) =>
      safeJoin(rootPath, "reviews", cadence, `${period}.md`),
    planningDir: path.join(rootPath, "planning"),
    planningCadenceDir: (cadence: string) =>
      safeJoin(rootPath, "planning", cadence),
    planningMd: (cadence: string, period: string) =>
      safeJoin(rootPath, "planning", cadence, `${period}.md`),
    // KAR-55 domain database paths
    domainDataDir: (slug: string) => safeJoin(rootPath, "domains", slug, "data"),
    domainSqlite: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "domain.sqlite"),
    domainRegistry: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "registry.json"),
    domainBooks: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "books.json"),
    domainFilesDir: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "files"),
    domainFile: (slug: string, fileId: string, name: string) =>
      safeJoin(rootPath, "domains", slug, "data", "files", fileId, name),
    domainMappingsDir: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "mappings"),
    domainMapping: (slug: string, mappingId: string) =>
      safeJoin(rootPath, "domains", slug, "data", "mappings", `${mappingId}.json`),
    // KAR-59 adapter sync files
    domainSyncIndex: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "sync-index.json"),
    domainSyncQueue: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "sync-queue.json"),
    domainConflicts: (slug: string) =>
      safeJoin(rootPath, "domains", slug, "data", "conflicts.json"),
    // KAR-60 page and pin paths
    domainPagesDir: (slug: string) => safeJoin(rootPath, "domains", slug, "pages"),
    domainPage: (slug: string, pageId: string) =>
      safeJoin(rootPath, "domains", slug, "pages", `${pageId}.json`),
    domainPins: (slug: string) => safeJoin(rootPath, "domains", slug, "pins.json"),
    // Agent-built dashboard views (plan.md design, 2026-09-30)
    domainViewsDir: (slug: string) => safeJoin(rootPath, "domains", slug, "views"),
    domainView: (slug: string, viewId: string) =>
      safeJoin(rootPath, "domains", slug, "views", `${viewId}.json`),
    overviewPins: path.join(rootPath, ".lifequest", "overview-pins.json"),
    cacheDir: path.join(rootPath, ".lifequest", "cache"),
  };
}

/** Ensure target stays under rootPath. */
export function assertUnderRoot(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  // Allow target === root (rel === ""). Reject only true parent traversal
  // (not false positives like a relative segment named "..foo").
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes vault root: ${targetPath}`);
  }
}

/** Join segments under root and reject path traversal. */
export function safeJoin(rootPath: string, ...segments: string[]): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...segments);
  assertUnderRoot(root, target);
  return target;
}
