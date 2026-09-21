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
