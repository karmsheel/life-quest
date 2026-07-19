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
    domainDir: (slug: string) => path.join(rootPath, "domains", slug),
    domainJson: (slug: string) => path.join(rootPath, "domains", slug, "domain.json"),
    documentMd: (slug: string, kind: string) =>
      path.join(rootPath, "domains", slug, `${kind}.md`),
    decisionJson: (id: string) =>
      path.join(rootPath, ".lifequest", "decisions", `${id}.json`),
  };
}

/** Ensure target stays under rootPath. */
export function assertUnderRoot(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
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
