import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { periodBounds, periodTitle } from "./period.ts";
import { listDomains } from "./domains.ts";
import { unlockedAreas } from "./domain-lens.ts";
import { vaultPaths } from "./paths.ts";
import {
  defaultReviewAvailability,
  formatReviewOpening,
  reviewAvailabilityFromUnknown,
  reviewOpensAt,
} from "./review-availability.ts";
import {
  REVIEW_PAGE_COMMON_HEADINGS,
  getReviewPageTemplate,
} from "./review-templates.ts";
import {
  USER_ACTOR,
  type Actor,
  type Result,
  type ReviewAvailability,
  type ReviewCadence,
  type ReviewIndexEntry,
  type ReviewManifest,
  type ReviewMigrationPeriod,
  type ReviewMigrationReport,
  type ReviewNotebook,
  type ReviewPage,
  type ReviewPageBody,
  type ReviewPageWriteOutcome,
  type ReviewPageFile,
  type ReviewPageSummary,
  type ReviewRecord,
  type ReviewScopeState,
  type ReviewWriteCode,
  type ReviewWriteOutcome,
  type WeekStartDay,
} from "./types.ts";

/**
 * Fort-Knox AGENT-09: the review notebook is a vault document like any other,
 * so every write leaves one life-log line naming the actor. The event types are
 * new names, not a change to an existing one, so a reader that ignores unknown
 * types keeps working.
 */
async function logReview(
  rootPath: string,
  type:
    | "review.ensured"
    | "review.written"
    | "review.marked-done"
    | "review.unlocked"
    | "review.applied"
    | "review.migrated",
  summary: string,
  payload: Record<string, unknown>,
  actor: Actor,
): Promise<void> {
  // Reviews span domains, so the line carries no domain slug. A logging failure
  // must not fail the write that already landed: same rule the map uses.
  await appendLog(rootPath, { domainSlug: null, type, summary, payload, actor });
}

const OVERALL = "overall";
// The four common H2s are the synthesis contract every page carries, so they are
// defined once in the page-template module and reused here for validation and
// emission. An area's template may only add headings after them.
const DOMAIN_HEADINGS = REVIEW_PAGE_COMMON_HEADINGS;
type RequiredHeading = (typeof REVIEW_PAGE_COMMON_HEADINGS)[number];

const NOTEBOOK_SCHEMA_VERSION = 1;
const PAGE_SCHEMA_VERSION = 1;
const MIGRATION_SCHEMA_VERSION = 1;

/**
 * The daily review's shape, stated once. Every page writer refuses an area scope
 * on the daily cadence with this exact sentence, so the page and the companion
 * quote the same rule.
 */
export const DAILY_REVIEW_NO_AREAS = "The daily review is one general review — it has no area sections.";

/** One live area's slice of a review notebook, as the checklist reports it. */
export type ReviewAreaState = {
  slug: string;
  name: string;
  status: "missing" | "draft" | "done";
};

/**
 * The notebook's area checklist: which live areas exist, which have a page
 * (draft) and which are done. This is the read the page's progress line and the
 * overall review's gate share, so "every area is reviewed" cannot mean two
 * different things in two places.
 */
export type ReviewAreaChecklist = {
  cadence: ReviewCadence;
  period: string;
  areas: ReviewAreaState[];
  done: number;
  total: number;
  allDone: boolean;
  /** Display names of the areas not done, in vault order. */
  remaining: string[];
};

/**
 * A review period is a notebook — a manifest plus one markdown page per scope —
 * and the pages are the unit of concurrent work.
 *
 *  - One async mutex per notebook (this module's `reviewLocks`) is shared by
 *    every door: the renderer's IPC queue, the companion's tool calls, the
 *    snapshot pass, a Decision apply. Structural operations (page creation,
 *    status, lock, order) and every lock check run inside it, so a lock that
 *    lands during a page write wins and the write returns `LOCKED`.
 *  - A page file owns its prose, status, session id and `rev`, and a page write
 *    is a compare-and-swap on that page's rev. Two writes to different pages do
 *    not conflict (they only queue on the mutex); two writes to the same page
 *    return `CONFLICT` with the page as it stands instead of silently merging.
 *  - The manifest owns identity, order and lock, and its `rev` counts structural
 *    changes only. Page body writes move the page's rev, never the manifest's.
 *
 * The pre-notebook layout (one file per period) is still readable for one
 * release: `readNotebookView` projects it read-only, and the migration splits it
 * into a notebook. Writes to a period the migration has not reached are refused
 * with `LEGACY_LAYOUT` rather than half-written in the old shape.
 */
const reviewLocks = new Map<string, Promise<void>>();

function withReviewLock<T>(
  rootPath: string,
  cadence: string,
  period: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${rootPath}\u0000${cadence}\u0000${period}`;
  const previous = reviewLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  reviewLocks.set(key, tail);
  // The map is only an ordering aid; dropping a settled tail keeps it from
  // growing with one entry per period a session ever touched.
  void tail.finally(() => {
    if (reviewLocks.get(key) === tail) reviewLocks.delete(key);
  });
  return run;
}

function todayIso(): string {
  return new Date().toISOString();
}

function isOverall(scope: string): boolean {
  return scope === OVERALL;
}

/**
 * Read a review rev from frontmatter. The frontmatter reader keeps bare scalars
 * as strings, so a writer that emits `rev: 7` reads back as `"7"`; both shapes
 * mean the same version and anything else reads as 0 (a version no write
 * produces, so a stale reader still conflicts).
 */
function parseReviewRev(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return 0;
}

/**
 * A markdown body with line endings normalised and trailing blank lines
 * dropped. The frontmatter writer always terminates the body with one newline,
 * so every read would otherwise carry a trailing newline the emitter does not
 * produce and a no-op save would look like a change on every pass.
 */
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

/**
 * The two settings this module needs: which day a week starts on (it decides a
 * weekly period's bounds) and when each cadence's review opens.
 *
 * A missing or unreadable settings.json is not an error here — the review read
 * path must keep working on a vault whose settings are being repaired — so the
 * defaults answer instead.
 */
type ReviewSettings = {
  weekStartDay: WeekStartDay;
  availability: ReviewAvailability;
};

async function readSettings(rootPath: string): Promise<ReviewSettings> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.settingsJson, "utf8");
    const parsed = JSON.parse(raw) as {
      weekStartDay?: string;
      reviewAvailability?: unknown;
    };
    return {
      weekStartDay: parsed.weekStartDay === "sunday" ? "sunday" : "monday",
      availability: reviewAvailabilityFromUnknown(parsed.reviewAvailability),
    };
  } catch {
    return {
      weekStartDay: "monday",
      availability: defaultReviewAvailability(),
    };
  }
}

/**
 * Why a review of this period may not be written yet, or null when it may.
 *
 * The one sentence the operator reads comes from one place: `ensureReviewPage`
 * and every page writer gate on this, so the page (which ensures first) and a
 * direct autosave refuse with exactly the same words.
 */
function reviewNotOpenError(
  settings: ReviewSettings,
  cadence: ReviewCadence,
  period: string,
  now: Date = new Date(),
): string | null {
  const opensAt = reviewOpensAt(cadence, period, settings.weekStartDay, settings.availability);
  if (!opensAt.ok) return opensAt.error;
  if (opensAt.value.getTime() <= now.getTime()) return null;
  return `This review is not available yet: it opens ${formatReviewOpening(opensAt.value)}.`;
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

/** The live areas, in vault sort order, as the checklist and tab order use them. */
async function readLiveAreas(
  rootPath: string,
): Promise<{ slug: string; name: string }[]> {
  const listed = await listDomains(rootPath);
  if (!listed.ok) return [];
  return unlockedAreas(listed.value).map((d) => ({ slug: d.slug, name: d.meta.name }));
}

function failure(
  code: ReviewWriteCode,
  error: string,
  current?: ReviewRecord,
): ReviewWriteOutcome {
  return current === undefined
    ? { ok: false, error, code }
    : { ok: false, error, code, current };
}

function pageFailure(
  code: ReviewWriteCode,
  error: string,
  current?: ReviewPageBody,
): ReviewPageWriteOutcome {
  return current === undefined
    ? { ok: false, code, error, message: error }
    : { ok: false, code, error, message: error, current };
}

function codeForError(error: string): ReviewWriteCode {
  if (/not found/i.test(error)) return "NOT_FOUND";
  if (/locked/i.test(error)) return "LOCKED";
  return "MALFORMED";
}

// ── page markdown ────────────────────────────────────────────────────────────

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start += 1;
  while (end > start && lines[end - 1]!.trim() === "") end -= 1;
  return lines.slice(start, end);
}

type BodySection = {
  level: number;
  text: string;
  content: string[];
  parentH2: string | null;
};

type ParsedBody = {
  sections: BodySection[];
  contentMap: Map<string, string[]>;
};

/**
 * Split a markdown body into its heading-addressed blocks.
 *
 * The map's key is the heading text for a level-2 heading, and
 * `"<H2>\u0000<H3>"` for a level-3 heading under one. Headings that do not fit
 * either live only in `sections`, which is what lets a page keep an operator's
 * extra heading instead of dropping it.
 */
function parseBodySections(body: string): ParsedBody {
  const lines = body.split("\n");
  const sections: BodySection[] = [];
  let current: BodySection | null = null;
  let currentH2: string | null = null;

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      const level = m[1]!.length;
      const text = m[2]!.trim();
      current = { level, text, content: [], parentH2: level >= 3 ? currentH2 : null };
      if (level === 2) {
        currentH2 = text;
      }
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);

  const contentMap = new Map<string, string[]>();
  for (const section of sections) {
    if (section.level === 2) {
      contentMap.set(section.text, trimBlankEdges(section.content));
    } else if (section.level >= 3 && section.parentH2 !== null) {
      contentMap.set(
        section.parentH2 + "\u0000" + section.text,
        trimBlankEdges(section.content),
      );
    }
  }
  return { sections, contentMap };
}

/**
 * One parsed page body: its H1 title, the four required sections — with any
 * deeper headings written inside them — and the extras that stand on their own.
 */
type ParsedPage = {
  title: string | null;
  required: Map<RequiredHeading, string[]>;
  /**
   * `###`+ sections written under a required H2, kept with that section rather
   * than at the end of the page. Extras are kept in place (S4).
   */
  requiredChildren: Map<RequiredHeading, BodySection[]>;
  extras: BodySection[];
};

function parsePageBody(body: string): ParsedPage {
  const parsed = parseBodySections(normalizeBody(body));
  const page: ParsedPage = {
    title: null,
    required: new Map(),
    requiredChildren: new Map(),
    extras: [],
  };
  // The required H2 the current run of deeper headings was written under. A
  // deeper heading belongs to the section it follows, so it is held there and
  // emitted back inside it; only headings outside any H2 are page-level extras.
  let insideRequired: RequiredHeading | null = null;
  for (const section of parsed.sections) {
    if (section.level === 1) {
      if (page.title === null) page.title = section.text;
      else page.extras.push(section);
      insideRequired = null;
      continue;
    }
    if (section.level === 2) {
      if (DOMAIN_HEADINGS.includes(section.text as RequiredHeading) && !page.required.has(section.text as RequiredHeading)) {
        const heading = section.text as RequiredHeading;
        page.required.set(heading, trimBlankEdges(section.content));
        insideRequired = heading;
        continue;
      }
      page.extras.push(section);
      insideRequired = null;
      continue;
    }
    if (insideRequired !== null) {
      const children = page.requiredChildren.get(insideRequired) ?? [];
      children.push({ ...section, content: trimBlankEdges(section.content) });
      page.requiredChildren.set(insideRequired, children);
      continue;
    }
    page.extras.push(section);
  }
  return page;
}

/**
 * Validate a page: one H1 plus exactly the four required H2s. Extra headings are
 * first-class (S4): page-level ones are preserved after the required ones, and
 * deeper ones stay inside the required section they were written under.
 */
function validatePage(page: ParsedPage): Result<ParsedPage> {
  const missing = DOMAIN_HEADINGS.filter((h) => !page.required.has(h));
  if (missing.length > 0) {
    return { ok: false, error: `Missing required headings: ${missing.join(", ")}` };
  }
  const repeated = page.extras.find(
    (section) => section.level === 2 && DOMAIN_HEADINGS.includes(section.text as RequiredHeading),
  );
  if (repeated) {
    return { ok: false, error: `A review page repeats the heading: ${repeated.text}` };
  }
  const secondTitle = page.extras.find((section) => section.level === 1);
  if (secondTitle) {
    return { ok: false, error: "A review page has one # title only" };
  }
  return { ok: true, value: page };
}

function headingLine(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

/**
 * Group extras into heading blocks: each H2 with the H3+ sections that follow
 * it. A page's own sections are groups, so ordering one can never detach the
 * sub-headings an operator wrote under it.
 */
function groupExtras(extras: BodySection[]): BodySection[][] {
  const groups: BodySection[][] = [];
  for (const section of extras) {
    if (section.level <= 2 || groups.length === 0) groups.push([section]);
    else groups[groups.length - 1]!.push(section);
  }
  return groups;
}

/**
 * A page's extras in contract order: the headings the area's template names
 * first, in template order, then every other extra in the order the page had it.
 *
 * The template only orders and seeds — it never rejects an unknown heading, so
 * an operator's own section is still first-class and still preserved.
 */
function orderExtras(
  extras: BodySection[],
  templateExtras: readonly string[],
): BodySection[][] {
  const remaining = groupExtras(extras);
  const ordered: BodySection[][] = [];
  for (const name of templateExtras) {
    const at = remaining.findIndex(
      (group) => group[0]!.level === 2 && group[0]!.text === name,
    );
    if (at === -1) continue;
    ordered.push(remaining.splice(at, 1)[0]!);
  }
  return [...ordered, ...remaining];
}

/**
 * Emit a canonical page: H1 title, the four required H2s in fixed order, then
 * the area's template extras it holds (template order), then any other extras in
 * page order. A missing template leaves the extras exactly as they were.
 */
function emitPageBody(
  title: string,
  page: ParsedPage,
  templateExtras: readonly string[] = [],
): string {
  const blocks: string[] = [`# ${title}`];
  const withContent = (heading: string, content: string[]): string =>
    content.length > 0 ? `${heading}\n\n${content.join("\n")}` : heading;
  for (const h of DOMAIN_HEADINGS) {
    blocks.push(withContent(`## ${h}`, page.required.get(h) ?? []));
    // A deeper heading written inside this required section stays inside it, in
    // the order it had, so canonicalising never moves the operator's sub-section
    // to the end of the page.
    for (const child of page.requiredChildren.get(h) ?? []) {
      blocks.push(withContent(headingLine(child.level, child.text), trimBlankEdges(child.content)));
    }
  }
  for (const group of orderExtras(page.extras, templateExtras)) {
    for (const section of group) {
      blocks.push(
        withContent(headingLine(section.level, section.text), trimBlankEdges(section.content)),
      );
    }
  }
  return blocks.join("\n\n");
}

/** A page's title: the notebook title for `overall`, the area's display name otherwise. */
function pageTitleFor(
  scope: string,
  notebookTitle: string,
  domainNames: Map<string, string>,
  recordedTitle?: string,
): string {
  if (isOverall(scope)) return notebookTitle;
  return recordedTitle ?? domainNames.get(scope) ?? scope;
}

/**
 * An empty page skeleton — what a freshly created page and a not-started page
 * read as. A live area's template extras follow the four common headings, empty
 * and in template order; the overall page never takes them.
 */
function emptyPageBody(title: string, extras: readonly string[] = []): string {
  const page: ParsedPage = {
    title,
    required: new Map(),
    requiredChildren: new Map(),
    extras: extras.map((text) => ({ level: 2, text, content: [], parentH2: null })),
  };
  return emitPageBody(title, page, extras);
}

/**
 * A live area's template extras, in template order. A missing or unreadable
 * template is simply no template: reading a page must never fail because its
 * area's contract could not be read, and a broken file is reported by
 * `getReviewPageTemplate` rather than here.
 */
async function readTemplateExtras(
  rootPath: string,
  scope: string,
): Promise<string[]> {
  if (isOverall(scope)) return [];
  const template = await getReviewPageTemplate(rootPath, scope);
  return template.ok ? template.value.extras : [];
}

// ── manifest and page files ──────────────────────────────────────────────────

function isNotFound(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

function parseManifest(raw: string, cadence: string, period: string): Result<ReviewManifest> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Invalid review notebook: review.json is not an object" };
  }
  const m = data as Record<string, unknown>;
  if (
    typeof m.title !== "string" ||
    !Array.isArray(m.order) ||
    !m.order.every((s) => typeof s === "string") ||
    m.order[0] !== OVERALL ||
    typeof m.rev !== "number" ||
    typeof m.locked !== "boolean"
  ) {
    return { ok: false, error: "Invalid review notebook: review.json is missing required fields" };
  }
  if (m.cadence !== cadence || m.period !== period) {
    return {
      ok: false,
      error: `Invalid review notebook: review.json names ${String(m.cadence)}/${String(m.period)}, not ${cadence}/${period}`,
    };
  }
  const weekStartDay: WeekStartDay = m.weekStartDay === "sunday" ? "sunday" : "monday";
  const order = m.order as string[];
  if (new Set(order).size !== order.length) {
    return { ok: false, error: "Invalid review notebook: review.json repeats a scope in order" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: NOTEBOOK_SCHEMA_VERSION,
      cadence: cadence as ReviewCadence,
      period,
      weekStartDay,
      title: m.title,
      locked: m.locked,
      order,
      rev: Math.max(0, Math.floor(m.rev)),
      createdAt: typeof m.createdAt === "string" ? m.createdAt : todayIso(),
      updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : todayIso(),
    },
  };
}

function serializeManifest(manifest: ReviewManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function readManifest(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewManifest | null>> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.reviewManifest(cadence, period), "utf8");
    return parseManifest(raw, cadence, period);
  } catch (e) {
    if (isNotFound(e)) return { ok: true, value: null };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function writeManifest(
  rootPath: string,
  manifest: ReviewManifest,
): Promise<void> {
  await atomicWriteFile(
    vaultPaths(rootPath).reviewManifest(manifest.cadence, manifest.period),
    serializeManifest(manifest),
  );
}

function parsePageFile(raw: string, expectedScope: string): Result<ReviewPageFile> {
  const { data, body } = parseFrontmatter(raw);
  if (typeof data.scope !== "string" || data.scope !== expectedScope) {
    return {
      ok: false,
      error: `Invalid review page ${expectedScope}.md: scope is ${String(data.scope)}`,
    };
  }
  if (typeof data.title !== "string" || !data.title.trim()) {
    return { ok: false, error: `Invalid review page ${expectedScope}.md: title is missing` };
  }
  const status = data.status === "done" ? "done" : "draft";
  return {
    ok: true,
    value: {
      schemaVersion: PAGE_SCHEMA_VERSION,
      scope: expectedScope,
      title: data.title,
      status,
      sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
      rev: parseReviewRev(data.rev),
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : todayIso(),
      bodyMarkdown: normalizeBody(body),
    },
  };
}

async function readPageFile(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  scope: string,
): Promise<Result<ReviewPageFile | null>> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.reviewPageMd(cadence, period, scope), "utf8");
    return parsePageFile(raw, scope);
  } catch (e) {
    if (isNotFound(e)) return { ok: true, value: null };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function writePageFile(
  rootPath: string,
  page: ReviewPageFile,
  cadence: ReviewCadence,
  period: string,
): Promise<void> {
  const content = serializeFrontmatter(
    {
      schemaVersion: page.schemaVersion,
      scope: page.scope,
      title: page.title,
      status: page.status,
      sessionId: page.sessionId,
      rev: page.rev,
      updatedAt: page.updatedAt,
    },
    page.bodyMarkdown,
  );
  await atomicWriteFile(vaultPaths(rootPath).reviewPageMd(cadence, period, page.scope), content);
}

// ── notebook read ────────────────────────────────────────────────────────────

type NotebookDisk = {
  manifest: ReviewManifest;
  /** Pages in manifest order; a missing file for an ordered scope is an error. */
  pages: Map<string, ReviewPageFile>;
};

type NotebookView =
  | { kind: "notebook"; disk: NotebookDisk; dir: string }
  | { kind: "legacy"; record: ReviewRecord; file: string }
  | { kind: "missing" };

/**
 * Read the on-disk state of one period: notebook, legacy file, or nothing.
 *
 * A directory with pages but no readable manifest is an error, never a silently
 * recreated notebook: that would orphan pages the operator can still read.
 */
async function readNotebookView(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<NotebookView>> {
  const paths = vaultPaths(rootPath);
  const manifestRes = await readManifest(rootPath, cadence, period);
  if (!manifestRes.ok) return manifestRes;
  const manifest = manifestRes.value;
  if (manifest === null) {
    // No manifest: is there a notebook directory at all? An existing directory
    // whose manifest vanished is damage, not an empty period.
    let dirEntries: string[] = [];
    try {
      dirEntries = await fs.readdir(paths.reviewNotebookDir(cadence, period));
    } catch (e) {
      if (!isNotFound(e)) return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (dirEntries.length > 0) {
      return {
        ok: false,
        error: `Invalid review notebook: ${cadence}/${period} has pages but no readable review.json`,
      };
    }
    const legacy = await readLegacyReview(rootPath, cadence, period);
    if (!legacy.ok) return legacy;
    if (legacy.value === null) return { ok: true, value: { kind: "missing" } };
    return {
      ok: true,
      value: {
        kind: "legacy",
        record: legacy.value,
        file: paths.reviewMd(cadence, period),
      },
    };
  }

  const pages = new Map<string, ReviewPageFile>();
  for (const scope of manifest.order) {
    const pageRes = await readPageFile(rootPath, cadence, period, scope);
    if (!pageRes.ok) return pageRes;
    if (pageRes.value === null) {
      return {
        ok: false,
        error: `Invalid review notebook: the manifest lists "${scope}" but its page file is missing`,
      };
    }
    pages.set(scope, pageRes.value);
  }
  // A page file the manifest does not list is damage: it would never be shown
  // and could be clobbered by the next page creation. The index reports it.
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(paths.reviewNotebookDir(cadence, period), { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const scope = entry.name.replace(/\.md$/, "");
    if (!pages.has(scope)) {
      return {
        ok: false,
        error: `Invalid review notebook: ${scope}.md exists but review.json does not list it`,
      };
    }
  }
  return { ok: true, value: { kind: "notebook", disk: { manifest, pages }, dir: paths.reviewNotebookDir(cadence, period) } };
}

/** The notebook's composite content version, used by the compatibility projection. */
function notebookContentRev(disk: NotebookDisk): number {
  let total = disk.manifest.rev;
  for (const page of disk.pages.values()) total += page.rev;
  return total;
}

function pageSummary(page: ReviewPageFile): ReviewPageSummary {
  return {
    scope: page.scope,
    title: page.title,
    status: page.status,
    sessionId: page.sessionId,
    rev: page.rev,
    updatedAt: page.updatedAt,
    chars: page.bodyMarkdown.length,
  };
}

function notebookFromDisk(disk: NotebookDisk, dir: string): ReviewNotebook {
  return {
    cadence: disk.manifest.cadence,
    period: disk.manifest.period,
    title: disk.manifest.title,
    weekStartDay: disk.manifest.weekStartDay,
    locked: disk.manifest.locked,
    order: [...disk.manifest.order],
    rev: notebookContentRev(disk),
    pages: disk.manifest.order.map((scope) => pageSummary(disk.pages.get(scope)!)),
    path: dir,
    legacy: false,
  };
}

export async function getReviewNotebook(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewNotebook>> {
  try {
    const view = await readNotebookView(rootPath, cadence, period);
    if (!view.ok) return view;
    if (view.value.kind === "missing") return { ok: false, error: "Review file not found" };
    if (view.value.kind === "legacy") {
      return { ok: true, value: legacyNotebook(view.value.record, view.value.file) };
    }
    return { ok: true, value: notebookFromDisk(view.value.disk, view.value.dir) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The page as the companion and the page read it, from whichever layout the period has. */
export async function getReviewPageBody(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  scope: string,
): Promise<Result<ReviewPageBody>> {
  if (cadence === "daily" && !isOverall(scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  try {
    const view = await readNotebookView(rootPath, cadence, period);
    if (!view.ok) return view;
    if (view.value.kind === "missing") return { ok: false, error: "Review file not found" };
    if (view.value.kind === "legacy") {
      return { ok: true, value: legacyPageBody(view.value.record, scope, await readDomainNames(rootPath)) };
    }
    const disk = notebookDiskOf(view.value);
    if (disk === null) return { ok: false, error: "Review file not found" };
    const page = disk.pages.get(scope);
    if (page) {
      return {
        ok: true,
        value: {
          scope,
          title: page.title,
          status: page.status,
          sessionId: page.sessionId,
          rev: page.rev,
          updatedAt: page.updatedAt,
          locked: disk.manifest.locked,
          bodyMarkdown: page.bodyMarkdown,
        },
      };
    }
    const domainNames = await readDomainNames(rootPath);
    if (!isOverall(scope) && !domainNames.has(scope)) {
      return { ok: false, error: `Area not found: ${scope}` };
    }
    const title = pageTitleFor(scope, disk.manifest.title, domainNames);
    return {
      ok: true,
      value: {
        scope,
        title,
        status: "missing",
        sessionId: null,
        rev: 0,
        updatedAt: null,
        locked: disk.manifest.locked,
        bodyMarkdown: emptyPageBody(title, await readTemplateExtras(rootPath, scope)),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The full page record, including its notebook identity. */
export async function getReviewPage(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  scope: string,
): Promise<Result<ReviewPage>> {
  const page = await getReviewPageBody(rootPath, cadence, period, scope);
  if (!page.ok) return page;
  return {
    ok: true,
    value: {
      cadence,
      period,
      ...page.value,
    },
  };
}

// ── legacy (pre-notebook) layout: read-only projection ──────────────────────

/**
 * Read the old one-file review layout: frontmatter (cadence, period, title,
 * weekStartDay, locked, scopes, updatedAt) + a body whose areas are H2 sections
 * with the four required H3s.
 *
 * This exists for two consumers only: the migration, which splits it, and the
 * compatibility projection, which keeps the app readable if the migration has
 * not run. Nothing writes this shape.
 */
async function readLegacyReview(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord | null>> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.reviewMd(cadence, period), "utf8");
    const { data, body } = parseFrontmatter(raw);
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
        cadence,
        period,
        weekStartDay: (typeof data.weekStartDay === "string" ? data.weekStartDay : "monday") as WeekStartDay,
        locked: data.locked === true,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : todayIso(),
        title:
          typeof data.title === "string"
            ? data.title
            : periodTitle(cadence, period, (await readSettings(rootPath)).weekStartDay),
        rev: parseReviewRev(data.rev),
        scopes,
        bodyMarkdown: normalizeBody(body),
      },
    };
  } catch (e) {
    if (isNotFound(e)) return { ok: true, value: null };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One scope's page projected out of a legacy whole-file body. */
function legacyPageBody(
  record: ReviewRecord,
  scope: string,
  domainNames: Map<string, string>,
): ReviewPageBody {
  const page = projectLegacyPage(record, scope, domainNames);
  const state = record.scopes[scope];
  return {
    scope,
    title: page.title,
    status: state ? state.status : "missing",
    sessionId: state?.sessionId ?? null,
    rev: record.rev,
    updatedAt: state ? record.updatedAt : null,
    locked: record.locked,
    bodyMarkdown: page.bodyMarkdown,
  };
}

function projectLegacyPage(
  record: ReviewRecord,
  scope: string,
  domainNames: Map<string, string>,
): { title: string; bodyMarkdown: string } {
  const parsed = parseBodySections(record.bodyMarkdown);
  if (isOverall(scope)) {
    const page: ParsedPage = { title: record.title, required: new Map(), requiredChildren: new Map(), extras: [] };
    for (const h of DOMAIN_HEADINGS) page.required.set(h, parsed.contentMap.get(h) ?? []);
    return { title: record.title, bodyMarkdown: emitPageBody(record.title, page) };
  }
  const name = domainNames.get(scope) ?? scope;
  const page: ParsedPage = { title: name, required: new Map(), requiredChildren: new Map(), extras: [] };
  for (const h of DOMAIN_HEADINGS) {
    page.required.set(h, parsed.contentMap.get(name + "\u0000" + h) ?? []);
  }
  // Extras inside the area's H2 section stay with this page (H3+ sections
  // whose parent is the area heading and whose text is not required).
  for (const section of parsed.sections) {
    if (section.level < 3 || section.parentH2 !== name) continue;
    if (DOMAIN_HEADINGS.includes(section.text as RequiredHeading)) continue;
    page.extras.push({ ...section, level: Math.max(2, section.level - 1) });
  }
  return { title: name, bodyMarkdown: emitPageBody(name, page) };
}

function legacyNotebook(record: ReviewRecord, file: string): ReviewNotebook {
  const order = [OVERALL, ...Object.keys(record.scopes).filter((scope) => scope !== OVERALL)];
  return {
    cadence: record.cadence,
    period: record.period,
    title: record.title,
    weekStartDay: record.weekStartDay,
    locked: record.locked,
    order,
    rev: record.rev,
    pages: order.map((scope) => ({
      scope,
      title: scope === OVERALL ? record.title : scope,
      status: record.scopes[scope]?.status ?? "draft",
      sessionId: record.scopes[scope]?.sessionId ?? null,
      rev: record.rev,
      updatedAt: record.updatedAt,
      chars: 0,
    })),
    path: file,
    legacy: true,
  };
}

// ── compatibility projection ────────────────────────────────────────────────

/**
 * Assemble the old `ReviewRecord` from a notebook, read-only.
 *
 * This keeps every existing read consumer working for one release: the period
 * pack, the dashboard, the pairing projection, the Review page's editor, and an
 * older Decision. The body is the overall page followed by each area page
 * demoted one heading level, so an area page's `##` becomes the old `###` and
 * its H1 becomes the old `## <name>`.
 */
function assembleCompatRecord(disk: NotebookDisk): ReviewRecord {
  const { manifest, pages } = disk;
  const overall = pages.get(OVERALL)!;
  const scopes: Record<string, ReviewScopeState> = {};
  for (const scope of manifest.order) {
    const page = pages.get(scope)!;
    scopes[scope] = { status: page.status, sessionId: page.sessionId };
  }
  const withContent = (heading: string, content: string[]): string =>
    content.length > 0 ? `${heading}\n\n${content.join("\n")}` : heading;
  const overallParsed = parseBodySections(overall.bodyMarkdown);
  const body: string[] = [`# ${manifest.title}`];
  for (const h of DOMAIN_HEADINGS) {
    body.push(withContent(`## ${h}`, overallParsed.contentMap.get(h) ?? []));
  }
  // Area pages come next, each demoted one level: the page's H1 becomes the old
  // `## <Area>` heading and its `##` sections become the old `###` ones.
  for (const scope of manifest.order) {
    if (scope === OVERALL) continue;
    const page = pages.get(scope)!;
    const lines = normalizeBody(page.bodyMarkdown).split("\n");
    const demoted: string[] = [];
    let skippedTitle = false;
    for (const line of lines) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!heading) {
        demoted.push(line);
        continue;
      }
      const level = heading[1]!.length;
      if (level === 1 && !skippedTitle) {
        skippedTitle = true;
        demoted.push(`## ${page.title}`);
        continue;
      }
      demoted.push(headingLine(Math.min(6, level + 1), heading[2]!.trim()));
    }
    body.push(demoted.join("\n"));
  }
  // The overall page's extras (an operator's own top-level sections) were at the
  // end of the old file, after the area sections; keep them there.
  for (const section of overallParsed.sections) {
    if (section.level === 1) continue;
    if (section.level === 2 && DOMAIN_HEADINGS.includes(section.text as RequiredHeading)) continue;
    if (section.level >= 3 && section.parentH2 !== null && DOMAIN_HEADINGS.includes(section.parentH2 as RequiredHeading)) continue;
    body.push(
      withContent(headingLine(section.level, section.text), trimBlankEdges(section.content)),
    );
  }
  return {
    cadence: manifest.cadence,
    period: manifest.period,
    weekStartDay: manifest.weekStartDay,
    locked: manifest.locked,
    updatedAt: maxIso(manifest.updatedAt, ...[...pages.values()].map((p) => p.updatedAt)),
    title: manifest.title,
    scopes,
    bodyMarkdown: body.join("\n\n"),
    rev: notebookContentRev(disk),
    pages: manifest.order.map((scope) => pageSummary(pages.get(scope)!)),
    notebookRev: notebookContentRev(disk),
  };
}

function maxIso(...values: string[]): string {
  let max = "";
  for (const value of values) {
    if (typeof value === "string" && value > max) max = value;
  }
  return max || todayIso();
}

/**
 * The compatibility read. A notebook is assembled; a legacy file is returned as
 * it stands; a missing period is "Review file not found" (the sentence the page
 * and the tools already speak).
 */
export async function getReview(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord>> {
  try {
    const view = await readNotebookView(rootPath, cadence, period);
    if (!view.ok) return view;
    if (view.value.kind === "missing") return { ok: false, error: "Review file not found" };
    if (view.value.kind === "legacy") return { ok: true, value: view.value.record };
    return { ok: true, value: assembleCompatRecord(view.value.disk) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── area checklist ──────────────────────────────────────────────────────────

function areaStatus(status: string | undefined): ReviewAreaState["status"] {
  if (!status) return "missing";
  return status === "done" ? "done" : "draft";
}

function overallReviewRefusal(remaining: ReviewAreaState[]): string {
  const parts = remaining.map(
    (area) => `${area.name}: ${area.status === "draft" ? "in progress" : "not started"}`,
  );
  return `Finish every area review first — ${parts.join("; ")}.`;
}

/**
 * The area checklist for one notebook: one entry per live area (the
 * `unlockedAreas` the rest of the app offers, in vault order), with that area's
 * page status. A period with no notebook is not an error — every area is
 * missing, which is what a fresh period looks like.
 */
export async function getReviewAreaChecklist(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewAreaChecklist>> {
  if (cadence === "daily") {
    return {
      ok: true,
      value: {
        cadence,
        period,
        areas: [],
        done: 0,
        total: 0,
        allDone: true,
        remaining: [],
      },
    };
  }
  try {
    const live = await readLiveAreas(rootPath);
    const view = await readNotebookView(rootPath, cadence, period);
    if (!view.ok) return view;
    const statusOf = (slug: string): string | undefined => {
      if (view.value.kind === "notebook") return view.value.disk.pages.get(slug)?.status;
      if (view.value.kind === "legacy") return view.value.record.scopes[slug]?.status;
      return undefined;
    };
    const areas: ReviewAreaState[] = live.map((area) => ({
      slug: area.slug,
      name: area.name,
      status: areaStatus(statusOf(area.slug)),
    }));
    const done = areas.filter((area) => area.status === "done").length;
    return {
      ok: true,
      value: {
        cadence,
        period,
        areas,
        done,
        total: areas.length,
        allDone: done === areas.length,
        remaining: areas.filter((area) => area.status !== "done").map((area) => area.name),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── structural writes ───────────────────────────────────────────────────────

/**
 * Where a newly created page belongs in the manifest order: its area's vault
 * sort position at creation time. Archived areas (no live position) go last.
 */
function insertionIndex(order: string[], scope: string, live: { slug: string }[]): number {
  const liveIndex = new Map(live.map((area, index) => [area.slug, index]));
  const target = liveIndex.get(scope);
  if (target === undefined) return order.length;
  for (let i = 1; i < order.length; i += 1) {
    const other = liveIndex.get(order[i]!);
    if (other !== undefined && other > target) return i;
  }
  return order.length;
}

function insertScope(order: string[], scope: string, live: { slug: string }[]): string[] {
  const next = [...order];
  next.splice(insertionIndex(next, scope, live), 0, scope);
  return next;
}

function blankPage(
  scope: string,
  title: string,
  now: string,
  templateExtras: readonly string[] = [],
): ReviewPageFile {
  return {
    schemaVersion: PAGE_SCHEMA_VERSION,
    scope,
    title,
    status: "draft",
    sessionId: null,
    rev: 1,
    updatedAt: now,
    bodyMarkdown: emptyPageBody(title, templateExtras),
  };
}

/**
 * Create the notebook (manifest + overall page, and the requested area page when
 * one is named) for a period that has none.
 */
async function createNotebook(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
  scope: string,
  domainNames: Map<string, string>,
  live: { slug: string; name: string }[],
  now: string,
): Promise<NotebookDisk> {
  const title = periodTitle(cadence, period, weekStartDay);
  const overall = blankPage(OVERALL, title, now);
  const pages = new Map<string, ReviewPageFile>([[OVERALL, overall]]);
  const order = [OVERALL];
  if (!isOverall(scope)) {
    const page = blankPage(
      scope,
      pageTitleFor(scope, title, domainNames),
      now,
      await readTemplateExtras(rootPath, scope),
    );
    pages.set(scope, page);
    order.push(scope);
  } else if (live.length === 0) {
    // No areas: overall alone.
  }
  const manifest: ReviewManifest = {
    schemaVersion: NOTEBOOK_SCHEMA_VERSION,
    cadence,
    period,
    weekStartDay,
    title,
    locked: false,
    order,
    rev: 1,
    createdAt: now,
    updatedAt: now,
  };
  for (const page of pages.values()) await writePageFile(rootPath, page, cadence, period);
  await writeManifest(rootPath, manifest);
  return { manifest, pages };
}

/**
 * Ensure the period's notebook exists, and that `scope` has a page.
 *
 * Creating the overall page is the notebook's birth; creating an area page only
 * adds that page and its manifest order entry. A locked notebook refuses a new
 * page (`LOCKED`); the overall page always exists.
 */
export async function ensureReviewPage(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string },
): Promise<Result<ReviewNotebook>> {
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const settings = await readSettings(rootPath);
      const notOpen = reviewNotOpenError(settings, input.cadence, input.period);
      if (notOpen) return { ok: false, error: notOpen };

      const view = await readNotebookView(rootPath, input.cadence, input.period);
      if (!view.ok) return view;
      const domainNames = await readDomainNames(rootPath);
      if (!isOverall(input.scope) && !domainNames.has(input.scope)) {
        return { ok: false, error: `Area not found: ${input.scope}` };
      }
      if (view.value.kind === "legacy") {
        return {
          ok: false,
          error: `This review is still in the previous layout and is being migrated — ${input.cadence}/${input.period}`,
        };
      }
      if (view.value.kind === "missing") {
        const live = await readLiveAreas(rootPath);
        const disk = await createNotebook(
          rootPath,
          input.cadence,
          input.period,
          settings.weekStartDay,
          input.scope,
          domainNames,
          live,
          todayIso(),
        );
        await logReview(
          rootPath,
          "review.ensured",
          isOverall(input.scope)
            ? `Started the ${disk.manifest.title}`
            : `Added the ${pageTitleFor(input.scope, disk.manifest.title, domainNames)} page to the ${disk.manifest.title}`,
          { cadence: input.cadence, period: input.period, scope: input.scope },
          USER_ACTOR,
        );
        return { ok: true, value: notebookFromDisk(disk, vaultPaths(rootPath).reviewNotebookDir(input.cadence, input.period)) };
      }

      const disk = view.value.disk;
      if (isOverall(input.scope) || disk.pages.has(input.scope)) {
        return { ok: true, value: notebookFromDisk(disk, view.value.dir) };
      }
      if (disk.manifest.locked) {
        return {
          ok: false,
          error: `LOCKED: ${disk.manifest.title} is locked, so no page can be added`,
        };
      }
      const live = await readLiveAreas(rootPath);
      const now = todayIso();
      const page = blankPage(
        input.scope,
        pageTitleFor(input.scope, disk.manifest.title, domainNames),
        now,
        await readTemplateExtras(rootPath, input.scope),
      );
      disk.manifest.order = insertScope(disk.manifest.order, input.scope, live);
      disk.manifest.rev += 1;
      disk.manifest.updatedAt = now;
      disk.pages.set(input.scope, page);
      await writePageFile(rootPath, page, input.cadence, input.period);
      await writeManifest(rootPath, disk.manifest);
      await logReview(
        rootPath,
        "review.ensured",
        `Added the ${page.title} page to the ${disk.manifest.title}`,
        { cadence: input.cadence, period: input.period, scope: input.scope },
        USER_ACTOR,
      );
      return { ok: true, value: notebookFromDisk(disk, view.value.dir) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

// ── page writes ─────────────────────────────────────────────────────────────

type PreparedPage = {
  page: ReviewPageFile;
  created: boolean;
};

/**
 * Add the template extras a page being created does not already carry, so a page
 * born from `write_review` is seeded exactly like one born from `ensure`. An
 * existing page never takes a section this way — the contract seeds new pages
 * only, and a contract change must not add headings to a page already written.
 */
function seedTemplateExtras(
  page: ParsedPage,
  templateExtras: readonly string[],
): ParsedPage {
  if (templateExtras.length === 0) return page;
  const present = new Set(
    page.extras.filter((section) => section.level === 2).map((section) => section.text),
  );
  const missing: BodySection[] = templateExtras
    .filter((name) => !present.has(name))
    .map((text) => ({ level: 2, text, content: [], parentH2: null }));
  if (missing.length === 0) return page;
  return { ...page, extras: [...missing, ...page.extras] };
}

/**
 * Validate and canonicalise a page body against the page's title, returning the
 * page file it would write. The area's template extras order the extras the page
 * already holds; a template never adds a section to an existing page.
 */
function preparePageWrite(
  current: ReviewPageFile | null,
  scope: string,
  title: string,
  bodyMarkdown: string,
  now: string,
  templateExtras: readonly string[] = [],
): Result<PreparedPage> {
  const parsed = parsePageBody(bodyMarkdown);
  const validated = validatePage(parsed);
  if (!validated.ok) return validated;
  const page = current === null ? seedTemplateExtras(validated.value, templateExtras) : validated.value;
  const body = emitPageBody(title, page, templateExtras);
  if (current && current.bodyMarkdown === body) {
    return { ok: true, value: { page: current, created: false } };
  }
  return {
    ok: true,
    value: {
      page: {
        schemaVersion: PAGE_SCHEMA_VERSION,
        scope,
        title,
        status: current?.status ?? "draft",
        sessionId: current?.sessionId ?? null,
        rev: (current?.rev ?? 0) + 1,
        updatedAt: now,
        bodyMarkdown: body,
      },
      created: current === null,
    },
  };
}

/**
 * Write one page — the companion's path, and once the tabbed page ships, the
 * editor's too.
 *
 * `baseRev` is the page rev the caller read. Inside the mutex the engine re-reads
 * that page; a mismatch returns `CONFLICT` with the page as it stands and writes
 * nothing. Writes to different pages never compare their revs, which is what lets
 * two area interviews run at the same time.
 */
export async function writeReviewPage(
  rootPath: string,
  input: {
    cadence: ReviewCadence;
    period: string;
    scope: string;
    bodyMarkdown: string;
    baseRev: number;
    actor: Actor;
  },
): Promise<import("./types.ts").ReviewPageWriteOutcome> {
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return pageFailure("MALFORMED", DAILY_REVIEW_NO_AREAS);
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const view = await readNotebookView(rootPath, input.cadence, input.period);
      if (!view.ok) return pageFailure(codeForError(view.error), view.error);
      if (view.value.kind === "missing") {
        return pageFailure("NOT_FOUND", "Review file not found");
      }
      if (view.value.kind === "legacy") {
        return pageFailure(
          "LEGACY_LAYOUT",
          "This review is still in the previous layout and is being migrated; try again after it is split.",
        );
      }
      const disk = view.value.disk;
      const existing = disk.pages.get(input.scope) ?? null;
      const domainNames = await readDomainNames(rootPath);
      if (!isOverall(input.scope) && !domainNames.has(input.scope) && existing === null) {
        return pageFailure("NOT_FOUND", `Area not found: ${input.scope}`);
      }
      const currentPage = existing ? pageBodyFromFile(disk, existing) : undefined;
      if (disk.manifest.locked) {
        return pageFailure("LOCKED", "LOCKED", currentPage);
      }
      const currentRev = existing?.rev ?? 0;
      if (input.baseRev !== currentRev) {
        return pageFailure("CONFLICT", "CONFLICT", currentPage);
      }
      const settings = await readSettings(rootPath);
      const notOpen = reviewNotOpenError(settings, input.cadence, input.period);
      if (notOpen) return pageFailure("NOT_OPEN", notOpen, currentPage);

      const title = existing
        ? existing.title
        : pageTitleFor(input.scope, disk.manifest.title, domainNames);
      const prepared = preparePageWrite(
        existing,
        input.scope,
        title,
        input.bodyMarkdown,
        todayIso(),
        await readTemplateExtras(rootPath, input.scope),
      );
      if (!prepared.ok) {
        return pageFailure("MALFORMED", prepared.error, currentPage);
      }
      if (!prepared.value.created && prepared.value.page === existing) {
        const page = pageBodyFromFile(disk, existing!);
        return { ok: true, page, notebookRev: notebookContentRev(disk) };
      }

      const page = prepared.value.page;
      if (prepared.value.created) {
        const live = await readLiveAreas(rootPath);
        if (!isOverall(page.scope)) {
          disk.manifest.order = insertScope(disk.manifest.order, page.scope, live);
        }
        disk.manifest.rev += 1;
      }
      disk.manifest.updatedAt = page.updatedAt;
      disk.pages.set(page.scope, page);
      await writePageFile(rootPath, page, input.cadence, input.period);
      if (prepared.value.created) await writeManifest(rootPath, disk.manifest);
      await logReview(
        rootPath,
        "review.written",
        `Wrote the ${isOverall(page.scope) ? "life" : page.title} page of the ${disk.manifest.title}`,
        {
          cadence: input.cadence,
          period: input.period,
          scope: page.scope,
          chars: page.bodyMarkdown.length,
        },
        input.actor,
      );
      return { ok: true, page: pageBodyFromFile(disk, page), notebookRev: notebookContentRev(disk) };
    } catch (e) {
      return pageFailure("MALFORMED", e instanceof Error ? e.message : String(e));
    }
  });
}

/** The notebook disk of a view, or null when the period has no notebook. */
function notebookDiskOf(view: NotebookView): NotebookDisk | null {
  return view.kind === "notebook" ? view.disk : null;
}

function pageBodyFromFile(disk: NotebookDisk, page: ReviewPageFile): ReviewPageBody {
  return {
    scope: page.scope,
    title: page.title,
    status: page.status,
    sessionId: page.sessionId,
    rev: page.rev,
    updatedAt: page.updatedAt,
    locked: disk.manifest.locked,
    bodyMarkdown: page.bodyMarkdown,
  };
}

/**
 * Apply an approved page body. The notebook is locked by definition when a
 * Decision was filed against it, so this is the one write that ignores the lock
 * — but it still obeys the page CAS: a page that moved since the proposal was
 * approved refuses `CONFLICT` (the Decision reads that as STALE and stays
 * pending) instead of applying stale prose.
 */
export async function applyReviewPageBody(
  rootPath: string,
  input: {
    cadence: ReviewCadence;
    period: string;
    scope: string;
    bodyMarkdown: string;
    baseRev: number;
    actor?: Actor;
  },
): Promise<import("./types.ts").ReviewPageWriteOutcome> {
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const view = await readNotebookView(rootPath, input.cadence, input.period);
      if (!view.ok) return pageFailure(codeForError(view.error), view.error);
      if (view.value.kind !== "notebook") {
        return pageFailure("NOT_FOUND", "Review notebook not found");
      }
      const disk = view.value.disk;
      const page = disk.pages.get(input.scope);
      if (!page) return pageFailure("NOT_FOUND", `Page not found: ${input.scope}`);
      if (page.rev !== input.baseRev) {
        return pageFailure("CONFLICT", "STALE", pageBodyFromFile(disk, page));
      }
      const prepared = preparePageWrite(
        page,
        input.scope,
        page.title,
        input.bodyMarkdown,
        todayIso(),
        await readTemplateExtras(rootPath, input.scope),
      );
      if (!prepared.ok) return pageFailure("MALFORMED", prepared.error, pageBodyFromFile(disk, page));
      if (prepared.value.page === page) {
        return { ok: true, page: pageBodyFromFile(disk, page), notebookRev: notebookContentRev(disk) };
      }
      const written = prepared.value.page;
      disk.pages.set(written.scope, written);
      disk.manifest.updatedAt = written.updatedAt;
      await writePageFile(rootPath, written, input.cadence, input.period);
      await logReview(
        rootPath,
        "review.applied",
        `Applied an approved change to the ${written.title} page of the ${disk.manifest.title}`,
        { cadence: input.cadence, period: input.period, scope: written.scope, chars: written.bodyMarkdown.length },
        input.actor ?? USER_ACTOR,
      );
      return { ok: true, page: pageBodyFromFile(disk, written), notebookRev: notebookContentRev(disk) };
    } catch (e) {
      return pageFailure("MALFORMED", e instanceof Error ? e.message : String(e));
    }
  });
}

// ── status and lock ─────────────────────────────────────────────────────────

/**
 * Mark one scope done. An area page's status never locks anything; the overall
 * page is the gate and the lock: it refuses while a live area's page is not
 * done (the refusal names them), and success locks the notebook.
 */
export async function markReviewDone(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; actor?: Actor },
): Promise<Result<ReviewRecord>> {
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const view = await readNotebookView(rootPath, input.cadence, input.period);
      if (!view.ok) return view;
      if (view.value.kind === "missing") return { ok: false, error: "Review file not found" };
      if (view.value.kind === "legacy") {
        return {
          ok: false,
          error: "This review is still in the previous layout and is being migrated; try again after it is split.",
        };
      }
      const disk = view.value.disk;
      if (disk.manifest.locked) return { ok: false, error: "LOCKED" };

      if (isOverall(input.scope)) {
        if (input.cadence !== "daily") {
          const checklist = await getReviewAreaChecklist(rootPath, input.cadence, input.period);
          if (!checklist.ok) return checklist;
          const notDone = checklist.value.areas.filter((area) => area.status !== "done");
          if (notDone.length > 0) {
            return { ok: false, error: overallReviewRefusal(notDone) };
          }
        }
        const page = disk.pages.get(OVERALL)!;
        page.status = "done";
        page.updatedAt = todayIso();
        disk.manifest.locked = true;
        disk.manifest.rev += 1;
        disk.manifest.updatedAt = page.updatedAt;
        disk.pages.set(OVERALL, page);
        await writePageFile(rootPath, page, input.cadence, input.period);
        await writeManifest(rootPath, disk.manifest);
      } else {
        const page = disk.pages.get(input.scope);
        if (!page) return { ok: false, error: `Domain scope not found: ${input.scope}` };
        page.status = "done";
        page.updatedAt = todayIso();
        disk.manifest.rev += 1;
        disk.manifest.updatedAt = page.updatedAt;
        disk.pages.set(input.scope, page);
        await writePageFile(rootPath, page, input.cadence, input.period);
        await writeManifest(rootPath, disk.manifest);
      }
      await logReview(
        rootPath,
        "review.marked-done",
        `Marked ${input.scope} done on the ${disk.manifest.title}`,
        { cadence: input.cadence, period: input.period, scope: input.scope, locked: disk.manifest.locked },
        input.actor ?? USER_ACTOR,
      );
      return { ok: true, value: assembleCompatRecord(disk) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Unlock a locked notebook so it can be edited in place.
 *
 * Fort-Knox AGENT-14: user-actor-only. The review lock's whole job is to route
 * an agent's edit into a pending Decision, and an agent that could unlock first
 * could then write the "final" review directly.
 */
export async function unlockReview(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  actor: Actor = USER_ACTOR,
): Promise<Result<ReviewRecord>> {
  if (actor.type !== "user") {
    return { ok: false, error: "Only the operator can unlock a review" };
  }
  return withReviewLock(rootPath, cadence, period, async () => {
    try {
      const view = await readNotebookView(rootPath, cadence, period);
      if (!view.ok) return view;
      if (view.value.kind === "missing") return { ok: false, error: "Review file not found" };
      if (view.value.kind === "legacy") {
        return {
          ok: false,
          error: "This review is still in the previous layout and is being migrated; try again after it is split.",
        };
      }
      const disk = view.value.disk;
      disk.manifest.locked = false;
      disk.manifest.rev += 1;
      disk.manifest.updatedAt = todayIso();
      await writeManifest(rootPath, disk.manifest);
      await logReview(
        rootPath,
        "review.unlocked",
        `Unlocked the ${disk.manifest.title}`,
        { cadence, period },
        actor,
      );
      return { ok: true, value: assembleCompatRecord(disk) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Bind one page to its companion chat. A page that does not exist yet is created
 * first (with the skeleton), which is the same shape the old scope entry took.
 * A locked notebook refuses — binding a chat to a report nobody may change would
 * be the first write of a session that can never land.
 */
export async function setReviewSessionId(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; sessionId: string },
): Promise<Result<ReviewRecord>> {
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const view = await readNotebookView(rootPath, input.cadence, input.period);
      if (!view.ok) return view;
      if (view.value.kind === "missing") return { ok: false, error: "Review file not found" };
      if (view.value.kind === "legacy") {
        return {
          ok: false,
          error: "This review is still in the previous layout and is being migrated; try again after it is split.",
        };
      }
      const disk = view.value.disk;
      if (disk.manifest.locked) return { ok: false, error: "LOCKED" };
      const domainNames = await readDomainNames(rootPath);
      let page = disk.pages.get(input.scope);
      if (!page) {
        if (!isOverall(input.scope) && !domainNames.has(input.scope)) {
          return { ok: false, error: `Area not found: ${input.scope}` };
        }
        const live = await readLiveAreas(rootPath);
        page = blankPage(
          input.scope,
          pageTitleFor(input.scope, disk.manifest.title, domainNames),
          todayIso(),
          await readTemplateExtras(rootPath, input.scope),
        );
        if (!isOverall(page.scope)) {
          disk.manifest.order = insertScope(disk.manifest.order, page.scope, live);
        }
        disk.manifest.rev += 1;
      }
      page.sessionId = input.sessionId;
      page.updatedAt = todayIso();
      disk.manifest.updatedAt = page.updatedAt;
      disk.pages.set(page.scope, page);
      await writePageFile(rootPath, page, input.cadence, input.period);
      await writeManifest(rootPath, disk.manifest);
      return { ok: true, value: assembleCompatRecord(disk) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

// ── index ───────────────────────────────────────────────────────────────────

async function indexNotebook(rootPath: string, cadence: ReviewCadence, period: string): Promise<ReviewIndexEntry> {
  const view = await readNotebookView(rootPath, cadence, period);
  if (!view.ok) {
    return { cadence, period, locked: false, scopes: {}, error: view.error };
  }
  if (view.value.kind === "missing") {
    return { cadence, period, locked: false, scopes: {}, error: "Review file not found" };
  }
  if (view.value.kind === "legacy") {
    const record = view.value.record;
    const scopes: ReviewIndexEntry["scopes"] = {};
    for (const [scope, state] of Object.entries(record.scopes)) {
      scopes[scope] = { status: state.status, sessionId: state.sessionId };
    }
    return {
      cadence,
      period,
      locked: record.locked,
      scopes,
      updatedAt: record.updatedAt,
      pageCount: Object.keys(scopes).length,
      doneCount: Object.values(scopes).filter((state) => state.status === "done").length,
    };
  }
  const disk = view.value.disk;
  const scopes: ReviewIndexEntry["scopes"] = {};
  let done = 0;
  for (const scope of disk.manifest.order) {
    const page = disk.pages.get(scope)!;
    scopes[scope] = { status: page.status, sessionId: page.sessionId };
    if (page.status === "done") done += 1;
  }
  return {
    cadence,
    period,
    locked: disk.manifest.locked,
    scopes,
    updatedAt: maxIso(disk.manifest.updatedAt, ...[...disk.pages.values()].map((page) => page.updatedAt)),
    pageCount: disk.manifest.order.length,
    doneCount: done,
  };
}

/**
 * One row per review period, whichever layout it is in: notebook directories and
 * the compatibility release's legacy `.md` files are both periods. A damaged
 * period is a row with an error so the index can report it rather than hide it.
 */
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
        const period = f.name.replace(/\.md$/, "");
        if (f.isFile() && f.name.endsWith(".md")) {
          entries.push(await indexNotebook(rootPath, cadence, period));
        } else if (f.isDirectory()) {
          entries.push(await indexNotebook(rootPath, cadence, f.name));
        }
      }
    }
    return { ok: true, value: entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── compatibility whole-body read/write ─────────────────────────────────────

/**
 * Split a legacy whole-file body into the pages it now belongs to.
 *
 * The body's shape is the old file: H1 title, the four overall H2s, then one
 * `## <Area name>` per area with four `###` headings. Splitting is how the
 * unchanged Review page keeps saving while the tabbed page is built: the whole
 * body is still the editor's unit, but each page is a separate file underneath.
 *
 * Unmatched level-2 headings (an operator's extra section) and their prose go to
 * the overall page; extra headings inside an area section stay with that area.
 */
function splitWholeBody(
  bodyMarkdown: string,
  disk: NotebookDisk,
  domainNames: Map<string, string>,
  live: { slug: string; name: string }[],
): Result<{
  pages: Map<string, ParsedPage>;
  newScopes: string[];
}> {
  const parsed = parseBodySections(normalizeBody(bodyMarkdown));
  const overall: ParsedPage = { title: disk.manifest.title, required: new Map(), requiredChildren: new Map(), extras: [] };
  for (const h of DOMAIN_HEADINGS) {
    overall.required.set(h, parsed.contentMap.get(h) ?? []);
  }

  // Map an area section's display heading back to its scope: the recorded page
  // title first, then the live area name. Unknown headings are operator extras.
  const scopeByName = new Map<string, string>();
  for (const page of disk.pages.values()) {
    if (isOverall(page.scope)) continue;
    scopeByName.set(page.title, page.scope);
  }
  for (const area of live) scopeByName.set(area.name, area.slug);

  const areaPages = new Map<string, ParsedPage>();
  const newScopes: string[] = [];
  let currentScope: string | null = null;

  for (const section of parsed.sections) {
    if (section.level === 1) {
      // The body's H1 is the document title the compatibility editor shows. The
      // notebook owns the title in its manifest (a page's H1 is derived from it),
      // so the editor's H1 is not stored: the projection re-emits the manifest's.
      currentScope = null;
      continue;
    }
    if (section.level === 2) {
      if (DOMAIN_HEADINGS.includes(section.text as RequiredHeading)) {
        currentScope = null;
        continue;
      }
      const scope = scopeByName.get(section.text);
      if (scope === undefined) {
        overall.extras.push(section);
        currentScope = null;
        continue;
      }
      currentScope = scope;
      if (!areaPages.has(scope)) {
        const existing = disk.pages.get(scope);
        const title = existing?.title ?? section.text;
        const page: ParsedPage = { title, required: new Map(), requiredChildren: new Map(), extras: [] };
        for (const h of DOMAIN_HEADINGS) {
          page.required.set(h, parsed.contentMap.get(section.text + "\u0000" + h) ?? []);
        }
        areaPages.set(scope, page);
        if (!existing) newScopes.push(scope);
      }
      continue;
    }
    // H3+: a required sub-heading is already captured in its area page; any other
    // heading is the operator's extra and stays in the page it appeared in.
    if (currentScope === null) {
      overall.extras.push(section);
      continue;
    }
    if (DOMAIN_HEADINGS.includes(section.text as RequiredHeading)) continue;
    const page = areaPages.get(currentScope)!;
    page.extras.push({ ...section, level: Math.max(2, section.level - 1) });
  }

  const pages = new Map<string, ParsedPage>([[OVERALL, overall]]);
  for (const [scope, page] of areaPages) pages.set(scope, page);
  return { ok: true, value: { pages, newScopes } };
}

/** Canonicalise every page from a split and write the ones whose body changed. */
async function writeSplitPages(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  disk: NotebookDisk,
  split: { pages: Map<string, ParsedPage>; newScopes: string[] },
  live: { slug: string; name: string }[],
  actor: Actor,
): Promise<Result<{ changed: boolean; disk: NotebookDisk }>> {
  let changed = false;
  let structural = false;
  const now = todayIso();
  for (const [scope, parsed] of split.pages) {
    const existing = disk.pages.get(scope) ?? null;
    const title = existing?.title ?? (isOverall(scope) ? disk.manifest.title : parsed.title ?? scope);
    const validated = validatePage(parsed);
    if (!validated.ok) return validated;
    const body = emitPageBody(
      title,
      validated.value,
      await readTemplateExtras(rootPath, scope),
    );
    if (existing && existing.bodyMarkdown === body) continue;
    const page: ReviewPageFile = {
      schemaVersion: PAGE_SCHEMA_VERSION,
      scope,
      title,
      status: existing?.status ?? "draft",
      sessionId: existing?.sessionId ?? null,
      rev: (existing?.rev ?? 0) + 1,
      updatedAt: now,
      bodyMarkdown: body,
    };
    if (!existing) {
      structural = true;
      if (!isOverall(scope)) disk.manifest.order = insertScope(disk.manifest.order, scope, live);
    }
    disk.pages.set(scope, page);
    await writePageFile(rootPath, page, cadence, period);
    changed = true;
  }
  if (structural) disk.manifest.rev += 1;
  if (changed) {
    disk.manifest.updatedAt = now;
    await writeManifest(rootPath, disk.manifest);
    await logReview(
      rootPath,
      "review.written",
      `Wrote the ${disk.manifest.title}`,
      { cadence, period, chars: assembleCompatRecord(disk).bodyMarkdown.length },
      actor,
    );
  }
  return { ok: true, value: { changed, disk } };
}

/**
 * Write the whole body — the compatibility editor's path, used by the unchanged
 * Review page for one release.
 *
 * The editor still owns every heading, so it still says which version it read:
 * `baseRev` is the compatibility rev (the notebook's composite content version),
 * and a mismatch returns `CONFLICT` with the current record rather than
 * overwriting prose the operator has not seen.
 */
export async function writeReview(
  rootPath: string,
  input: {
    cadence: ReviewCadence;
    period: string;
    bodyMarkdown: string;
    actor: Actor;
    baseRev?: number;
  },
): Promise<ReviewWriteOutcome> {
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const view = await readNotebookView(rootPath, input.cadence, input.period);
      if (!view.ok) return failure(codeForError(view.error), view.error);
      if (view.value.kind === "missing") return failure("NOT_FOUND", "Review file not found");
      if (view.value.kind === "legacy") {
        return failure(
          "LEGACY_LAYOUT",
          "This review is still in the previous layout and is being migrated; try again after it is split.",
        );
      }
      const disk = view.value.disk;
      const currentCompat = assembleCompatRecord(disk);
      if (disk.manifest.locked) return failure("LOCKED", "LOCKED", currentCompat);
      const settings = await readSettings(rootPath);
      const notOpen = reviewNotOpenError(settings, disk.manifest.cadence, disk.manifest.period);
      if (notOpen) return failure("NOT_OPEN", notOpen, currentCompat);
      const missing = DOMAIN_HEADINGS.filter((h) => !input.bodyMarkdown.includes(`## ${h}`));
      if (missing.length > 0) {
        return failure("MALFORMED", `Missing required headings: ${missing.join(", ")}`, currentCompat);
      }
      if (typeof input.baseRev === "number" && input.baseRev !== currentCompat.rev) {
        return failure("CONFLICT", "CONFLICT", currentCompat);
      }
      const domainNames = await readDomainNames(rootPath);
      const live = await readLiveAreas(rootPath);
      // An empty body before the first page was written is not a split, it is
      // the editor sending what it was handed; treat the four headings check as
      // the contract and let the split write exactly what changed.
      const split = splitWholeBody(input.bodyMarkdown, disk, domainNames, live);
      if (!split.ok) return failure("MALFORMED", split.error, currentCompat);
      const written = await writeSplitPages(
        rootPath,
        input.cadence,
        input.period,
        disk,
        split.value,
        live,
        input.actor,
      );
      if (!written.ok) return failure("MALFORMED", written.error, currentCompat);
      const next = await readNotebookView(rootPath, input.cadence, input.period);
      if (!next.ok) return failure(codeForError(next.error), next.error);
      if (next.value.kind !== "notebook") return failure("MALFORMED", "The notebook vanished while it was written");
      return { ok: true, value: assembleCompatRecord(next.value.disk) };
    } catch (e) {
      return failure("MALFORMED", e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * The compatibility ensure: create the notebook, and the requested page when the
 * caller named an area. Returns the compatibility record the page renders.
 */
export async function ensureReview(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string },
): Promise<Result<ReviewRecord>> {
  const ensured = await ensureReviewPage(rootPath, input);
  if (!ensured.ok) return ensured;
  return getReview(rootPath, input.cadence, input.period);
}

/** The legacy whole-body Decision apply: split the approved body, ignoring the lock. */
export async function applyLockedReviewBody(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  bodyMarkdown: string,
  actor: Actor = USER_ACTOR,
  previousBodyMarkdown?: string,
): Promise<Result<ReviewRecord>> {
  return withReviewLock(rootPath, cadence, period, async () => {
    try {
      const view = await readNotebookView(rootPath, cadence, period);
      if (!view.ok) return view;
      if (view.value.kind !== "notebook") {
        return { ok: false, error: "Review notebook not found" };
      }
      const disk = view.value.disk;
      const domainNames = await readDomainNames(rootPath);
      const live = await readLiveAreas(rootPath);
      // A legacy Decision's body is a whole-file body proposed against the file
      // it saw; when that file is still current, split it as-is. When it moved,
      // the three-way merge keeps the headings whose content moved on.
      const merged =
        previousBodyMarkdown === undefined
          ? bodyMarkdown
          : mergeWholeBodies(disk, previousBodyMarkdown, bodyMarkdown, domainNames);
      if (merged === null) {
        return {
          ok: false,
          error: "Invalid review body: it no longer holds the four required headings",
        };
      }
      const split = splitWholeBody(merged, disk, domainNames, live);
      if (!split.ok) return split;
      disk.manifest.locked = true;
      await writeManifest(rootPath, disk.manifest);
      const written = await writeSplitPages(
        rootPath,
        cadence,
        period,
        disk,
        split.value,
        live,
        actor,
      );
      if (!written.ok) return written;
      const next = await readNotebookView(rootPath, cadence, period);
      if (!next.ok) return next;
      if (next.value.kind !== "notebook") return { ok: false, error: "Review notebook not found" };
      return { ok: true, value: assembleCompatRecord(next.value.disk) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * A three-way merge for a legacy Decision's whole-file body: a heading is taken
 * from the proposal only when the file still holds what the proposal was based
 * on. This is the Phase 0 guard kept for the one release legacy Decisions exist.
 */
function mergeWholeBodies(
  disk: NotebookDisk,
  previousBodyMarkdown: string,
  proposedBodyMarkdown: string,
  domainNames: Map<string, string>,
): string | null {
  const current = assembleCompatRecord(disk).bodyMarkdown;
  const previous = parseBodySections(previousBodyMarkdown);
  const proposed = parseBodySections(proposedBodyMarkdown);
  const now = parseBodySections(current);
  for (const [key, value] of proposed.contentMap) {
    const before = previous.contentMap.get(key);
    const here = now.contentMap.get(key);
    if (before !== undefined && here !== undefined && contentsEqual(before, here)) {
      now.contentMap.set(key, value);
      continue;
    }
    if (before === undefined && here === undefined) now.contentMap.set(key, value);
  }
  // Emit through the same whole-file shape the split understands: overall H1 +
  // four H2 + areas. The split re-reads headings, so the contentMap is enough to
  // rebuild the four required sections; extras are not part of the merge.
  void domainNames;
  const lines: string[] = [`# ${disk.manifest.title}`];
  for (const h of DOMAIN_HEADINGS) {
    const content = now.contentMap.get(h) ?? [];
    lines.push(content.length > 0 ? `## ${h}\n\n${content.join("\n")}` : `## ${h}`);
  }
  return lines.join("\n\n");
}

function contentsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * The one-release migration: split every legacy `reviews/<cadence>/<period>.md`
 * into a notebook, verify the prose survived, archive the old file, and write a
 * marker so it runs once.
 *
 * Safety rules, in order of importance: never delete a legacy file that did not
 * verify; never write a marker when anything failed; be idempotent (a second run
 * with the marker present does nothing). A period that fails is reported; the
 * app keeps working against its legacy file through the compatibility read.
 */
export async function migrateLegacyReviews(
  rootPath: string,
): Promise<Result<ReviewMigrationReport>> {
  const paths = vaultPaths(rootPath);
  try {
    const marker = await readMigrationMarker(rootPath);
    if (marker !== null) {
      return { ok: true, value: { ...marker, alreadyDone: true } };
    }
    const domainNames = await readDomainNames(rootPath);
    const live = await readLiveAreas(rootPath);
    const periods: ReviewMigrationPeriod[] = [];
    const cadences = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
    for (const cadence of cadences) {
      const cadDir = paths.reviewsCadenceDir(cadence);
      let files: import("node:fs").Dirent[] = [];
      try {
        files = await fs.readdir(cadDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of files) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const period = entry.name.replace(/\.md$/, "");
        periods.push(
          await migrateOneLegacyPeriod(
            rootPath,
            cadence,
            period,
            domainNames,
            live,
          ),
        );
      }
    }
    const report: ReviewMigrationReport = {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      migratedAt: todayIso(),
      alreadyDone: false,
      periods,
    };
    await atomicWriteFile(paths.reviewMigrationMarker, `${JSON.stringify(report, null, 2)}\n`);
    for (const period of periods) {
      if (period.status !== "migrated") continue;
      await appendLog(rootPath, {
        domainSlug: null,
        type: "review.migrated",
        summary: `Split the ${period.cadence} review ${period.period} into a notebook`,
        payload: {
          cadence: period.cadence,
          period: period.period,
          scope: null,
          written: 1,
          skipped: 0,
          failed: 0,
        },
        actor: USER_ACTOR,
      });
    }
    return { ok: true, value: report };
  } catch (e) {
    // Nothing that already moved is reverted; the marker is absent, so the next
    // open retries the periods that are still in the old layout.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function readMigrationMarker(
  rootPath: string,
): Promise<ReviewMigrationReport | null> {
  try {
    const raw = await fs.readFile(vaultPaths(rootPath).reviewMigrationMarker, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(data.periods)) return null;
    const periods: ReviewMigrationPeriod[] = [];
    for (const entry of data.periods) {
      if (!entry || typeof entry !== "object") continue;
      const p = entry as Record<string, unknown>;
      if (typeof p.cadence !== "string" || typeof p.period !== "string") continue;
      if (p.status !== "migrated" && p.status !== "skipped" && p.status !== "failed") continue;
      periods.push({
        cadence: p.cadence as ReviewCadence,
        period: p.period,
        status: p.status,
        ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
      });
    }
    return {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      migratedAt: typeof data.migratedAt === "string" ? data.migratedAt : todayIso(),
      alreadyDone: true,
      periods,
    };
  } catch {
    return null;
  }
}

/**
 * Split one legacy file. The notebook is written, then read back and compared
 * with the legacy file's own text; only a verified split archives the legacy
 * file. A failure is reported and the legacy file is left exactly where it was.
 */
async function migrateOneLegacyPeriod(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  domainNames: Map<string, string>,
  live: { slug: string; name: string }[],
): Promise<ReviewMigrationPeriod> {
  try {
    const legacy = await readLegacyReview(rootPath, cadence, period);
    if (!legacy.ok) {
      return { cadence, period, status: "failed", reason: legacy.error };
    }
    const record = legacy.value;
    if (record === null) {
      return { cadence, period, status: "skipped", reason: "the file was already moved" };
    }

    // A retry after a crash: the notebook exists, the legacy file was not
    // archived. Verify the existing notebook matches the legacy file; only then
    // archive. A mismatch is a failure the operator must see, not a rewrite.
    const existing = await readNotebookView(rootPath, cadence, period);
    if (!existing.ok) {
      return { cadence, period, status: "failed", reason: existing.error };
    }
    const notebookDir = vaultPaths(rootPath).reviewNotebookDir(cadence, period);
    if (existing.value.kind === "notebook") {
      const assembled = assembleCompatRecord(existing.value.disk);
      const verified = verifyMigration(record, assembled);
      if (verified !== null) {
        return { cadence, period, status: "failed", reason: verified };
      }
      await archiveLegacyFile(rootPath, cadence, period);
      return { cadence, period, status: "migrated" };
    }

    const disk: NotebookDisk = {
      manifest: {
        schemaVersion: NOTEBOOK_SCHEMA_VERSION,
        cadence,
        period,
        weekStartDay: record.weekStartDay,
        title: record.title,
        locked: record.locked,
        order: [OVERALL, ...Object.keys(record.scopes).filter((scope) => scope !== OVERALL)],
        rev: 1,
        createdAt: record.updatedAt,
        updatedAt: record.updatedAt,
      },
      pages: new Map(),
    };
    // Pages from the legacy scopes, plus any area section the scopes map does not
    // name (the migration keeps that prose rather than dropping it).
    const domainNamesForSplit = new Map(domainNames);
    for (const scope of Object.keys(record.scopes)) {
      if (isOverall(scope)) continue;
      if (!domainNamesForSplit.has(scope)) domainNamesForSplit.set(scope, scope);
    }
    const parsedBody = parseBodySections(record.bodyMarkdown);
    const nameToScope = new Map<string, string>([[record.title, OVERALL]]);
    for (const scope of Object.keys(record.scopes)) {
      if (isOverall(scope)) continue;
      nameToScope.set(domainNamesForSplit.get(scope) ?? scope, scope);
    }
    // Area headings inside this body name scopes; the canonical heading is the
    // recorded display name. Headings that map to no scope stay on the overall
    // page as extras.
    const overall: ParsedPage = { title: record.title, required: new Map(), requiredChildren: new Map(), extras: [] };
    for (const h of DOMAIN_HEADINGS) {
      overall.required.set(h, parsedBody.contentMap.get(h) ?? []);
    }
    const areaPages = new Map<string, ParsedPage>();
    for (const scope of Object.keys(record.scopes)) {
      if (isOverall(scope)) continue;
      const title = domainNamesForSplit.get(scope) ?? scope;
      const page: ParsedPage = { title, required: new Map(), requiredChildren: new Map(), extras: [] };
      for (const h of DOMAIN_HEADINGS) {
        page.required.set(h, parsedBody.contentMap.get(title + "\u0000" + h) ?? []);
      }
      areaPages.set(scope, page);
    }
    let currentScope: string | null = null;
    for (const section of parsedBody.sections) {
      if (section.level === 0) continue;
      if (section.level === 1) {
        currentScope = null;
        if (section.text !== record.title) overall.extras.push(section);
        continue;
      }
      if (section.level === 2) {
        if (DOMAIN_HEADINGS.includes(section.text as RequiredHeading)) {
          currentScope = null;
          continue;
        }
        const scope = nameToScope.get(section.text);
        if (scope === undefined || scope === OVERALL) {
          overall.extras.push(section);
          currentScope = null;
          continue;
        }
        currentScope = scope;
        continue;
      }
      if (currentScope === null) {
        overall.extras.push(section);
        continue;
      }
      if (DOMAIN_HEADINGS.includes(section.text as RequiredHeading)) continue;
      const page = areaPages.get(currentScope)!;
      page.extras.push({ ...section, level: Math.max(2, section.level - 1) });
    }

    const now = record.updatedAt;
    const pages = new Map<string, ReviewPageFile>();
    const overallPage: ReviewPageFile = {
      schemaVersion: PAGE_SCHEMA_VERSION,
      scope: OVERALL,
      title: record.title,
      status: record.scopes[OVERALL]?.status ?? "draft",
      sessionId: record.scopes[OVERALL]?.sessionId ?? null,
      rev: 1,
      updatedAt: now,
      bodyMarkdown: emitPageBody(record.title, overall),
    };
    pages.set(OVERALL, overallPage);
    for (const scope of disk.manifest.order) {
      if (isOverall(scope)) continue;
      const page = areaPages.get(scope)!;
      const pageTitle = page.title ?? scope;
      pages.set(scope, {
        schemaVersion: PAGE_SCHEMA_VERSION,
        scope,
        title: pageTitle,
        status: record.scopes[scope]?.status ?? "draft",
        sessionId: record.scopes[scope]?.sessionId ?? null,
        rev: 1,
        updatedAt: now,
        bodyMarkdown: emitPageBody(pageTitle, page),
      });
    }
    disk.pages = pages;
    for (const page of pages.values()) {
      await writePageFile(rootPath, page, cadence, period);
    }
    await writeManifest(rootPath, disk.manifest);

    const reread = await readNotebookView(rootPath, cadence, period);
    if (!reread.ok) {
      await removeNotebookDir(notebookDir);
      return { cadence, period, status: "failed", reason: reread.error };
    }
    if (reread.value.kind !== "notebook") {
      await removeNotebookDir(notebookDir);
      return { cadence, period, status: "failed", reason: "the written notebook could not be read back" };
    }
    const assembled = assembleCompatRecord(reread.value.disk);
    const verified = verifyMigration(record, assembled);
    if (verified !== null) {
      await removeNotebookDir(notebookDir);
      return { cadence, period, status: "failed", reason: verified };
    }
    await archiveLegacyFile(rootPath, cadence, period);
    return { cadence, period, status: "migrated" };
  } catch (e) {
    return {
      cadence,
      period,
      status: "failed",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

async function removeNotebookDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Best effort: the legacy file stays, and the next open reports the mismatch
    // again rather than losing it.
  }
}

async function archiveLegacyFile(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<void> {
  const paths = vaultPaths(rootPath);
  await fs.mkdir(paths.reviewLegacyArchiveMd(cadence, period).replace(/\/[^/]+$/, ""), {
    recursive: true,
  });
  await fs.rename(paths.reviewMd(cadence, period), paths.reviewLegacyArchiveMd(cadence, period));
}

/**
 * Verify a split against the file it came from. `null` means verified; a string
 * is the reason it failed.
 *
 * The comparison is on *blocks*: every heading with the prose directly under it,
 * normalised and compared as a multiset. That proves nothing was dropped or
 * duplicated (the acceptance criterion) while allowing the two ordering moves
 * the split makes by design: an area section's heading level changes, and an
 * operator's top-level extra section moves from the end of the file onto the
 * overall page. Lock, title, week start, statuses and session ids compare exactly.
 */
function verifyMigration(legacy: ReviewRecord, assembled: ReviewRecord): string | null {
  if (legacy.title !== assembled.title) {
    return `title changed: ${JSON.stringify(legacy.title)} → ${JSON.stringify(assembled.title)}`;
  }
  if (legacy.locked !== assembled.locked) {
    return `lock changed: ${legacy.locked} → ${assembled.locked}`;
  }
  if (legacy.weekStartDay !== assembled.weekStartDay) {
    return `week start changed: ${legacy.weekStartDay} → ${assembled.weekStartDay}`;
  }
  const legacyScopes = { ...legacy.scopes };
  const assembledScopes = { ...assembled.scopes };
  for (const scope of new Set([...Object.keys(legacyScopes), ...Object.keys(assembledScopes)])) {
    const before = legacyScopes[scope];
    const after = assembledScopes[scope];
    if (!before || !after) return `scope ${scope} exists on one side only`;
    if (before.status !== after.status) {
      return `scope ${scope} status changed: ${before.status} → ${after.status}`;
    }
    if ((before.sessionId ?? null) !== (after.sessionId ?? null)) {
      return `scope ${scope} session changed`;
    }
  }
  // Compare blocks that carry prose. An empty heading is structure, not text:
  // a scope key with state but no section is *given* the four empty headings by
  // the migration, and an empty heading that existed before is still there (the
  // page skeleton holds it) — neither is a lost word. Every block with content
  // must appear exactly once on the other side.
  const legacyBlocks = textBlocks(legacy.bodyMarkdown).filter(blockHasProse);
  const assembledBlocks = textBlocks(assembled.bodyMarkdown).filter(blockHasProse);
  if (legacyBlocks.length !== assembledBlocks.length) {
    return `the split has ${assembledBlocks.length} text blocks, the file had ${legacyBlocks.length}`;
  }
  const sortedBefore = [...legacyBlocks].sort();
  const sortedAfter = [...assembledBlocks].sort();
  for (let i = 0; i < sortedBefore.length; i += 1) {
    if (sortedBefore[i] !== sortedAfter[i]) {
      return `prose differs after the split: ${JSON.stringify(sortedBefore[i])} → ${JSON.stringify(sortedAfter[i])}`;
    }
  }
  return null;
}

/**
 * The blocks a review body is made of: each heading line (level normalised away,
 * because a page level is a storage detail) plus the non-blank, trimmed prose
 * lines directly under it. A block with neither heading nor content contributes
 * nothing.
 */
function blockHasProse(block: string): boolean {
  return block.includes("\n") && block.slice(block.indexOf("\n") + 1).trim() !== "";
}

function textBlocks(bodyMarkdown: string): string[] {
  const blocks: string[] = [];
  let heading: string | null = null;
  let content: string[] = [];
  const flush = (): void => {
    if (heading === null && content.length === 0) return;
    blocks.push(`${heading ?? ""}\n${content.join("\n")}`);
    heading = null;
    content = [];
  };
  for (const line of normalizeBody(bodyMarkdown).split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2]!.trim();
      continue;
    }
    if (line.trim() === "") continue;
    content.push(line.trim());
  }
  flush();
  return blocks;
}
