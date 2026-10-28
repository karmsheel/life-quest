import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * A path that names something inside the vault must not be able to walk.
 *
 * `safeJoin`/`assertUnderRoot` are a LEXICAL guard: they stop `..` from leaving
 * the vault root but say nothing about what an id may contain, and they cannot
 * see a symlink. Every id or name that becomes one path segment (page id, block
 * id, database id, mapping id, project id, library note id, view id, cadence,
 * period, date, domain slug, attachment name) therefore goes through
 * `assertSafeSegment` first, and every read/write goes through
 * `assertPhysicalContainment`, which walks the real directory tree with lstat.
 *
 * Two failure classes, both as errors rather than silent clamping so a caller
 * cannot mistake a refused path for a written one:
 *  - `VaultPathError`: the segment or the final path is not a legal vault path;
 *  - `VaultSymlinkError`: a component inside the vault is a symlink. A vault
 *    folder can arrive through sync/git/shared storage, and a link inside it can
 *    point anywhere on the machine: reads would leak the target and writes would
 *    clobber it.
 */
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

export class VaultSymlinkError extends VaultPathError {
  constructor(message: string) {
    super(message);
    this.name = "VaultSymlinkError";
  }
}

/** Segments are short; ids are UUIDs and filenames, never documents. */
const SEGMENT_MAX_LENGTH = 128;

/**
 * Characters that may never appear in one vault path segment: both separators,
 * the Windows drive/stream colon, NUL and the control range, and the Windows
 * reserved characters. Nothing the product mints contains any of them.
 */
const UNSAFE_SEGMENT_CHARS = /[/\\:\u0000-\u001f\u007f*?"<>|]/;

/**
 * Validate one path segment. Rejects traversal (`.`/`..`, any embedded `..`),
 * separators, absolute paths, NUL, drive letters, reserved characters, trailing
 * dots/spaces (Windows silently strips them, so `..`-like names can reappear)
 * and over-long values. Other characters (spaces, unicode) are allowed so a
 * vault with an unusual-but-harmless directory name still opens.
 */
export function assertSafeSegment(segment: string, what = "path segment"): string {
  if (typeof segment !== "string" || segment.length === 0) {
    throw new VaultPathError(`Invalid ${what}: empty`);
  }
  if (segment.length > SEGMENT_MAX_LENGTH) {
    throw new VaultPathError(`Invalid ${what}: too long`);
  }
  if (UNSAFE_SEGMENT_CHARS.test(segment)) {
    throw new VaultPathError(`Invalid ${what}: ${JSON.stringify(segment)}`);
  }
  if (segment === "." || segment === ".." || segment.includes("..")) {
    throw new VaultPathError(`Invalid ${what}: ${JSON.stringify(segment)}`);
  }
  if (segment.startsWith(" ") || segment.endsWith(".") || segment.endsWith(" ")) {
    throw new VaultPathError(`Invalid ${what}: ${JSON.stringify(segment)}`);
  }
  return segment;
}

/** A domain slug is a segment; this name documents why the check exists. */
export function assertDomainSlug(slug: string): string {
  return assertSafeSegment(slug, "domain slug");
}

/**
 * The real path of a vault root, cached per lexical root.
 *
 * The root itself is allowed to be a symlink (`~/vault -> /data/vault`): what is
 * not allowed is anything inside the vault being one. Resolving the root once
 * per process keeps the per-write cost to a few lstats on the components below
 * it. A moved vault leaves a stale entry here, which fails closed (a path that
 * no longer resolves is refused), never open.
 */
const realRoots = new Map<string, string>();

export async function realVaultRoot(rootPath: string): Promise<string> {
  const key = path.resolve(rootPath);
  const cached = realRoots.get(key);
  if (cached) return cached;
  const real = await fs.realpath(key);
  realRoots.set(key, real);
  return real;
}

/** Drop a cached root (a test helper; production never moves an open vault). */
export function forgetVaultRoot(rootPath: string): void {
  realRoots.delete(path.resolve(rootPath));
}

async function lstatOrNull(targetPath: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.lstat(targetPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Refuse a final component that is a symlink. This is the version callers use
 * when they hold a file path but not the vault root (a doctrine file read from
 * `openVault`, for instance): it catches a symlinked file but cannot see a
 * symlinked ancestor.
 */
export async function assertNoSymlinkLeaf(targetPath: string): Promise<void> {
  const link = await lstatOrNull(targetPath);
  if (link?.isSymbolicLink()) {
    throw new VaultSymlinkError(`Vault path is a symlink: ${targetPath}`);
  }
}

/**
 * Physical containment: interpret the target relative to the REAL vault root and
 * walk every existing component below it with lstat.
 *
 * - lexical containment first, so an absolute/`..` target is refused even when
 *   the root does not exist yet;
 * - a component that is a symlink is refused, whatever it points at (a link that
 *   stays inside the vault still lets one domain read another's directory);
 * - a missing component ends the walk: it, and everything under it, does not
 *   exist yet, so a write will create real directories beneath verified-real
 *   parents (`fs.mkdir` does not follow links for components it creates). A read
 *   simply hits ENOENT afterwards and reports it the way it always did.
 *
 * Returns the resolved real path of the deepest existing component (or the
 * candidate path when nothing below the root exists).
 */
export async function assertPhysicalContainment(
  rootPath: string,
  targetPath: string,
  _mode: "read" | "write" = "read",
): Promise<string> {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new VaultPathError(`Path escapes vault root: ${targetPath}`);
  }
  let realRoot: string;
  try {
    realRoot = await realVaultRoot(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // The vault root does not exist yet. Every path below it is about to be
      // created by the caller (vault creation), so the lexical check stands.
      return target;
    }
    throw e;
  }

  let current = realRoot;
  for (const component of rel.split(path.sep)) {
    if (!component || component === "." || component === "..") {
      throw new VaultPathError(`Path escapes vault root: ${targetPath}`);
    }
    const next = path.join(current, component);
    const stat = await lstatOrNull(next);
    if (stat === null) return next;
    if (stat.isSymbolicLink()) {
      throw new VaultSymlinkError(`Vault path contains a symlink: ${targetPath}`);
    }
    current = next;
  }
  return current;
}

/** Throwing guard for a resolved path a caller is about to read. */
export async function assertSafeVaultRead(rootPath: string, targetPath: string): Promise<void> {
  await assertPhysicalContainment(rootPath, targetPath, "read");
}

/** Throwing guard for a resolved path the caller is about to create/replace. */
export async function assertSafeVaultWrite(rootPath: string, targetPath: string): Promise<void> {
  await assertPhysicalContainment(rootPath, targetPath, "write");
}

/**
 * Synchronous belt to `assertPhysicalContainment`'s braces.
 *
 * The path builders below are synchronous by contract (they are called from
 * dozens of call sites that build a path and then use it), so the symlink walk
 * for those is synchronous too. It is a handful of `lstatSync` calls on the
 * components below the root — not on the root itself, which is allowed to be a
 * symlink (`~/vault -> /data/vault`) — and it throws `VaultSymlinkError` on the
 * first link it finds. That closes the sinks that build a path and never ask the
 * async guard, including destructive ones (`deleteDomain`'s recursive rm through
 * a symlinked `domains/`).
 */
function assertNoSymlinkComponentsSync(rootPath: string, segments: readonly string[]): void {
  let current = rootPath;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: import("node:fs").Stats;
    try {
      stat = fsSync.lstatSync(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return; // rest is created later
      throw e;
    }
    if (stat.isSymbolicLink()) {
      throw new VaultSymlinkError(`Vault path contains a symlink: ${current}`);
    }
  }
}

export function vaultPaths(root: string) {
  const rootPath = path.resolve(root);
  /**
   * Validate, refuse symlinked components, join — the builder kernel.
   *
   * Every builder below goes through this: it validates the segment grammar
   * (see `assertSafeSegment`) and walks the components that already exist below
   * the root with `lstatSync`, refusing a symlink without needing an `await`.
   */
  const build = (...segments: string[]): string => {
    assertNoSymlinkComponentsSync(rootPath, segments);
    return safeJoin(rootPath, ...segments);
  };
  return {
    root: rootPath,
    get lifequestJson(): string {
      return build("lifequest.json");
    },
    get domainsDir(): string {
      return build("domains");
    },
    get lifequestDir(): string {
      return build(".lifequest");
    },
    get settingsJson(): string {
      return build(".lifequest", "settings.json");
    },
    get agentsJson(): string {
      return build(".lifequest", "agents.json");
    },
    // KAR-70: the connected-agent roster. No secrets live here.
    get connectedAgentsJson(): string {
      return build(".lifequest", "connected-agents.json");
    },
    get logJsonl(): string {
      return build(".lifequest", "log.jsonl");
    },
    get decisionsDir(): string {
      return build(".lifequest", "decisions");
    },
    // A manual decision is a record, not a proposal, so it is stored apart from
    // the inbox: nothing in the approval path can ever see one. The id becomes a
    // file name, so it goes through the same segment fence as everything else.
    get manualDecisionsDir(): string {
      return build(".lifequest", "manual-decisions");
    },
    manualDecisionJson: (id: string) =>
      build(".lifequest", "manual-decisions", assertSafeSegment(id, "manual decision id") + ".json"),
    get signalChainDir(): string {
      return build(".lifequest", "signal-chain");
    },
    domainDir: (slug: string) => build("domains", assertDomainSlug(slug)),
    domainJson: (slug: string) => build("domains", assertDomainSlug(slug), "domain.json"),
    documentMd: (slug: string, kind: string) =>
      build("domains", assertDomainSlug(slug), assertSafeSegment(kind, "document kind") + ".md"),
    domainMediaDir: (slug: string) => build("domains", assertDomainSlug(slug), "media"),
    domainMediaFile: (slug: string, name: string) =>
      build("domains", assertDomainSlug(slug), "media", assertSafeSegment(name, "media name")),
    decisionJson: (id: string) =>
      build(".lifequest", "decisions", assertSafeSegment(id, "decision id") + ".json"),
    signalChainJson: (id: string) =>
      build(".lifequest", "signal-chain", assertSafeSegment(id, "signal id") + ".json"),
    get mapJson(): string {
      return build(".lifequest", "map.json");
    },
    get goalsJson(): string {
      return build(".lifequest", "goals.json");
    },
    get automationsJson(): string {
      return build(".lifequest", "automations.json");
    },
    get aboutMd(): string {
      return build(".lifequest", "about.md");
    },
    get documentsDir(): string {
      return build("documents");
    },
    libraryDocumentMd: (id: string) =>
      build("documents", assertSafeSegment(id, "library note id") + ".md"),
    // KAR-7 project documents
    get projectsDir(): string {
      return build("projects");
    },
    projectMd: (id: string) =>
      build("projects", assertSafeSegment(id, "project id") + ".md"),
    get reviewsDir(): string {
      return build("reviews");
    },
    reviewsCadenceDir: (cadence: string) =>
      build("reviews", assertSafeSegment(cadence, "review cadence")),
    reviewMd: (cadence: string, period: string) =>
      build(
        "reviews",
        assertSafeSegment(cadence, "review cadence"),
        assertSafeSegment(period, "review period") + ".md",
      ),
    // The cadence's standing rules for a review session. It lives under
    // `.lifequest` rather than beside the periods so that a directory scan of
    // `reviews/<cadence>/` still finds review files and nothing else.
    get reviewSkillsDir(): string {
      return build(".lifequest", "reviews");
    },
    reviewSkillMd: (cadence: string) =>
      build(".lifequest", "reviews", assertSafeSegment(cadence, "review cadence") + ".md"),
    get planningDir(): string {
      return build("planning");
    },
    planningCadenceDir: (cadence: string) =>
      build("planning", assertSafeSegment(cadence, "planning cadence")),
    planningMd: (cadence: string, period: string) =>
      build(
        "planning",
        assertSafeSegment(cadence, "planning cadence"),
        assertSafeSegment(period, "planning period") + ".md",
      ),
    // Daily notes — one markdown file per local calendar date
    get notesDir(): string {
      return build("notes");
    },
    get dailyNotesDir(): string {
      return build("notes", "daily");
    },
    dailyNoteMd: (date: string) =>
      build("notes", "daily", assertSafeSegment(date, "daily note date") + ".md"),
    // Ideal State — any number of titled, freeform markdown documents. The id is
    // the filename; the operator's title lives in the frontmatter, so renaming a
    // document never moves a file.
    get idealStateDir(): string {
      return build("notes", "ideal-state");
    },
    idealStateMd: (id: string) =>
      build("notes", "ideal-state", assertSafeSegment(id, "ideal state id") + ".md"),
    // KAR-55 domain database paths
    domainDataDir: (slug: string) => build("domains", assertDomainSlug(slug), "data"),
    domainSqlite: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "domain.sqlite"),
    domainRegistry: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "registry.json"),
    domainBooks: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "books.json"),
    domainFilesDir: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "files"),
    domainFile: (slug: string, fileId: string, name: string) =>
      build(
        "domains",
        assertDomainSlug(slug),
        "data",
        "files",
        assertSafeSegment(fileId, "file id"),
        assertSafeSegment(name, "file name"),
      ),
    domainMappingsDir: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "mappings"),
    domainMapping: (slug: string, mappingId: string) =>
      build(
        "domains",
        assertDomainSlug(slug),
        "data",
        "mappings",
        assertSafeSegment(mappingId, "mapping id") + ".json",
      ),
    // KAR-59 adapter sync files
    domainSyncIndex: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "sync-index.json"),
    domainSyncQueue: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "sync-queue.json"),
    domainConflicts: (slug: string) =>
      build("domains", assertDomainSlug(slug), "data", "conflicts.json"),
    // KAR-60 page and pin paths
    domainPagesDir: (slug: string) => build("domains", assertDomainSlug(slug), "pages"),
    domainPage: (slug: string, pageId: string) =>
      build(
        "domains",
        assertDomainSlug(slug),
        "pages",
        assertSafeSegment(pageId, "page id") + ".json",
      ),
    domainPins: (slug: string) => build("domains", assertDomainSlug(slug), "pins.json"),
    // Agent-built dashboard views (plan.md design, 2026-09-30)
    domainViewsDir: (slug: string) => build("domains", assertDomainSlug(slug), "views"),
    domainView: (slug: string, viewId: string) =>
      build(
        "domains",
        assertDomainSlug(slug),
        "views",
        assertSafeSegment(viewId, "view id") + ".json",
      ),
    get overviewPins(): string {
      return build(".lifequest", "overview-pins.json");
    },
    get cacheDir(): string {
      return build(".lifequest", "cache");
    },
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
