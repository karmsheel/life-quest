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
  USER_ACTOR,
  type Actor,
  type Result,
  type ReviewAvailability,
  type ReviewCadence,
  type ReviewIndexEntry,
  type ReviewPageBody,
  type ReviewRecord,
  type ReviewScopeState,
  type ReviewWriteCode,
  type ReviewWriteOutcome,
  type WeekStartDay,
} from "./types.ts";

/**
 * Fort-Knox AGENT-09: the review file is a vault document like any other, so
 * every write to it leaves one life-log line naming the actor. Before this the
 * whole module logged nothing: a companion could rewrite a review (or a
 * connected agent mark a scope done) and the life log could not say who did it.
 *
 * The event types are new names, not a change to an existing one, so a reader
 * that ignores unknown types keeps working (the feed renders `e.type` as-is).
 */
async function logReview(
  rootPath: string,
  type: "review.ensured" | "review.written" | "review.marked-done" | "review.unlocked" | "review.applied",
  summary: string,
  payload: Record<string, unknown>,
  actor: Actor,
): Promise<void> {
  // Reviews span domains, so the line carries no domain slug. A logging failure
  // must not fail the write that already landed: same rule the map uses.
  await appendLog(rootPath, { domainSlug: null, type, summary, payload, actor });
}

const OVERALL = "overall";
const DOMAIN_HEADINGS = ["Look-back", "Keep", "Change", "Next-period intent"] as const;

/**
 * The daily review's shape, stated once. Both `ensureReview` and
 * `markReviewDone` refuse an area scope on the daily cadence with this exact
 * sentence, so the page and the companion quote the same rule.
 */
export const DAILY_REVIEW_NO_AREAS = "The daily review is one general review — it has no area sections.";

/** One live area's slice of a review file, as the checklist reports it. */
export type ReviewAreaState = {
  slug: string;
  name: string;
  status: "missing" | "draft" | "done";
};

/**
 * The review file's area checklist: which live areas exist, which have a
 * section (draft) and which are done. This is the read the page's rail and the
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
 * One review file per cadence+period is a document, and a document has no
 * concurrent-write story of its own: the page autosave, the companion's tool
 * calls, the snapshot pass and a Decision apply are four writers on one file.
 * Before this they all rewrote the whole body from a read they made earlier, so
 * the last one won and silently dropped the others' prose while the frontmatter
 * still said the work was done.
 *
 * Two guards fix that without changing the storage shape:
 *
 *  - One mutex per cadence+period, shared by every door (the renderer IPC queue,
 *    the companion's tool calls, the snapshot pass), so a read-modify-write is
 *    never interleaved.
 *  - A content `rev` on the file and compare-and-swap on the whole-body writes
 *    (the page autosave, the snapshot pass). A writer that read rev N gets
 *    `CONFLICT` — with the current record — instead of overwriting rev N+1.
 *
 * The companion's writes are *scope* writes (`write_review` with a scope, see
 * `review-tools.ts`), and a scope write merges inside the mutex: it replaces only
 * that scope's headings, so two area sessions on the same period do not need to
 * fight over a version at all. The whole-body path stays for the page's own
 * editor, which is the one writer that legitimately owns the whole document.
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

function failure(
  code: ReviewWriteCode,
  error: string,
  current?: ReviewRecord,
): ReviewWriteOutcome {
  return current === undefined
    ? { ok: false, error, code }
    : { ok: false, error, code, current };
}

function codeForError(error: string): ReviewWriteCode {
  return /not found/i.test(error) ? "NOT_FOUND" : "MALFORMED";
}

/**
 * The two settings this module needs: which day a week starts on (it decides a
 * weekly period's bounds) and when each cadence's review opens.
 *
 * A missing or unreadable settings.json is not an error here — the review read
 * path must keep working on a vault whose settings are being repaired — so the
 * defaults answer instead. The value is read on every gate rather than cached,
 * because the operator can change a window from Settings while the Review page
 * is open and the next write has to see the new one.
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
 * The one sentence the operator reads comes from one place: `ensureReview` and
 * `writeReview` both gate on this, so the board page (which ensures first) and a
 * direct autosave refuse with exactly the same words. A period that cannot be
 * dated at all is refused with the parser's own error rather than being treated
 * as open, because a malformed key is not a window anyone opened.
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

/** The file the record came from, serialized with the same frontmatter keys. */
/** The content version from a review file, old files (and junk) reading as 0. */
function parseReviewRev(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return 0;
}

function serializeRecord(record: ReviewRecord): string {
  return serializeFrontmatter(
    {
      cadence: record.cadence,
      period: record.period,
      weekStartDay: record.weekStartDay,
      locked: record.locked,
      updatedAt: record.updatedAt,
      title: record.title,
      scopes: record.scopes,
      rev: record.rev,
    },
    record.bodyMarkdown,
  );
}

async function writeRecord(filePath: string, record: ReviewRecord): Promise<void> {
  await atomicWriteFile(filePath, serializeRecord(record));
}

/**
 * A section's own prose, without the blank lines the emitter supplies itself.
 *
 * Every section is written as heading, one blank line, content — so blank lines
 * captured at the edges of that content are the emitter's, not the operator's,
 * and keeping them makes the writer grow its own file. It did: writing the same
 * body twice turned one blank line per heading into four and then into seven,
 * because each pass captured the previous pass's separators as content and then
 * added its own. Blank lines INSIDE a section are the operator's and stay, which
 * is what a paragraph break between two thoughts looks like in the file.
 */
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
 * Split a review body into its heading-addressed blocks.
 *
 * The map's key is the heading text for the overall H2s, and
 * `"<Area>\u0000<Subheading>"` for the four `###` headings under a domain H2 —
 * the same key the emitter uses, so parsing and emitting cannot disagree.
 * Headings that are neither (an operator's extra heading) live only in
 * `sections` and are re-emitted in place by the emitter.
 */
function parseBodySections(body: string): ParsedBody {
  const lines = body.split("\n");
  const sections: BodySection[] = [];
  let current: BodySection | null = null;
  // Track the most recent H2 so level-3 headings under a domain can be keyed distinctly.
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
      // Only map under a domain H2, not the overall H2s.
      const isOverallH2 = DOMAIN_HEADINGS.includes(section.parentH2 as (typeof DOMAIN_HEADINGS)[number]);
      if (!isOverallH2) {
        contentMap.set(
          section.parentH2 + "\u0000" + section.text,
          trimBlankEdges(section.content),
        );
      }
    }
  }
  return { sections, contentMap };
}

/**
 * Emit the file as blocks joined by one blank line, which is the same shape the
 * skeleton is written in — so a review planted by `ensureReview` and a review
 * rewritten by this function are the same file, and the writer is a fixed point
 * on its own output rather than growing one blank line per save.
 *
 * Domain sections come from `record.scopes` order (not from the body), so a
 * scope added by `ensureReview` or a page write appears even before its section
 * exists, and a scope's section is present in the file iff its state is.
 */
function emitBody(
  record: ReviewRecord,
  parsed: ParsedBody,
  domainNames: Map<string, string>,
): string {
  const blocks: string[] = [`# ${record.title}`];
  const withContent = (heading: string, content: string[]): string =>
    content.length > 0 ? `${heading}\n\n${content.join("\n")}` : heading;

  // Overall required H2s — preserve existing content.
  for (const h of DOMAIN_HEADINGS) {
    blocks.push(withContent(`## ${h}`, parsed.contentMap.get(h) ?? []));
  }

  // Domain sections (from frontmatter scopes, excluding overall).
  const domainSlugs = Object.keys(record.scopes).filter((s) => s !== OVERALL);
  for (const slug of domainSlugs) {
    const name = domainNames.get(slug) ?? slug;
    const sub: string[] = [`## ${name}`];
    for (const h of DOMAIN_HEADINGS) {
      sub.push(withContent(`### ${h}`, parsed.contentMap.get(name + "\u0000" + h) ?? []));
    }
    blocks.push(sub.join("\n\n"));
  }

  // Extra headings (not required) — preserve after required blocks.
  const requiredTexts = new Set<string>();
  requiredTexts.add(record.title);
  for (const h of DOMAIN_HEADINGS) requiredTexts.add(h);
  for (const slug of domainSlugs) {
    requiredTexts.add(domainNames.get(slug) ?? slug);
  }

  for (const section of parsed.sections) {
    if (section.level === 1) continue; // H1 handled
    if (requiredTexts.has(section.text)) continue;
    blocks.push(
      withContent(
        `${"#".repeat(section.level)} ${section.text}`,
        trimBlankEdges(section.content),
      ),
    );
  }

  return blocks.join("\n\n");
}

function canonicalizeBody(
  body: string,
  record: ReviewRecord,
  domainNames: Map<string, string>,
): string {
  return emitBody(record, parseBodySections(body), domainNames);
}

function missingHeadings(body: string): string[] {
  const missing: string[] = [];
  for (const h of DOMAIN_HEADINGS) {
    if (!body.includes(`## ${h}`)) missing.push(h);
  }
  return missing;
}

/**
 * Validate one page's markdown and return its four sections.
 *
 * A page is the contract the companion writes: one H1 title and exactly the four
 * required H2s. Rejecting extra headings here (rather than letting the emitter
 * park them at the end of the file) is what keeps a page write from quietly
 * moving one area's prose into another's — the failure mode the old
 * whole-body write made possible.
 */
function pageContentMap(pageBody: string): Result<Map<string, string[]>> {
  const parsed = parseBodySections(pageBody);
  const content = new Map<string, string[]>();
  for (const section of parsed.sections) {
    if (section.level === 1) continue;
    if (section.level === 2) {
      if (!DOMAIN_HEADINGS.includes(section.text as (typeof DOMAIN_HEADINGS)[number])) {
        return {
          ok: false,
          error: `A review page has one # title and the four required ## headings only — unexpected heading: ${section.text}`,
        };
      }
      if (content.has(section.text)) {
        return {
          ok: false,
          error: `A review page repeats the heading: ${section.text}`,
        };
      }
      content.set(section.text, trimBlankEdges(section.content));
      continue;
    }
    return {
      ok: false,
      error: `A review page has no sub-headings — move the text under "### ${section.text}" into the four ## sections`,
    };
  }
  const missing = DOMAIN_HEADINGS.filter((h) => !content.has(h));
  if (missing.length > 0) {
    return { ok: false, error: `Missing required headings: ${missing.join(", ")}` };
  }
  return { ok: true, value: content };
}

/**
 * One scope's page, projected out of the whole file: the overall page is the
 * H1 plus the four H2s, an area page is the H1 plus that area's four `###`
 * headings re-headed as `##`.
 */
function pageBodyForRecord(
  record: ReviewRecord,
  scope: string,
  domainNames: Map<string, string>,
): string {
  const parsed = parseBodySections(record.bodyMarkdown);
  const withContent = (heading: string, content: string[]): string =>
    content.length > 0 ? `${heading}\n\n${content.join("\n")}` : heading;
  const blocks: string[] = [];
  if (isOverall(scope)) {
    blocks.push(`# ${record.title}`);
    for (const h of DOMAIN_HEADINGS) {
      blocks.push(withContent(`## ${h}`, parsed.contentMap.get(h) ?? []));
    }
    return blocks.join("\n\n");
  }
  const name = domainNames.get(scope) ?? scope;
  blocks.push(`# ${name}`);
  for (const h of DOMAIN_HEADINGS) {
    blocks.push(
      withContent(`## ${h}`, parsed.contentMap.get(name + "\u0000" + h) ?? []),
    );
  }
  return blocks.join("\n\n");
}

/**
 * Merge one page into the whole body, in memory.
 *
 * Only the keys belonging to `scope` are replaced; every other area's prose, the
 * overall sections and any extra headings keep the content they already had.
 * This is the write that lets two area interviews run at the same time: each one
 * owns its own headings, and the mutex makes the read-merge-write atomic.
 *
 * Mutates `record.scopes` when the scope is new (the caller owns that record).
 */
function composeBodyWithPage(
  record: ReviewRecord,
  scope: string,
  pageBody: string,
  domainNames: Map<string, string>,
): Result<string> {
  const page = pageContentMap(pageBody);
  if (!page.ok) return page;
  const name = isOverall(scope) ? null : domainNames.get(scope) ?? scope;
  const parsed = parseBodySections(record.bodyMarkdown);
  for (const h of DOMAIN_HEADINGS) {
    const key = name === null ? h : `${name}\u0000${h}`;
    parsed.contentMap.set(key, page.value.get(h)!);
  }
  if (!isOverall(scope) && !record.scopes[scope]) {
    record.scopes[scope] = { status: "draft", sessionId: null };
  }
  return { ok: true, value: emitBody(record, parsed, domainNames) };
}

function contentsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * The three-way merge a locked review's Decision apply uses.
 *
 * A Decision on a locked review was proposed against the body the operator had
 * when they approved the change. The file may have moved since (an unlock and a
 * re-lock, another Decision applying first). Applying the proposed body wholesale
 * was the stale-write bug: it could put an area's old prose back over newer
 * prose. So each heading is taken from the proposal only when the file still
 * holds what the proposal was based on; otherwise the file's newer content wins.
 */
function mergeReviewBodies(
  record: ReviewRecord,
  previousBodyMarkdown: string,
  proposedBodyMarkdown: string,
  domainNames: Map<string, string>,
): Result<string> {
  const current = parseBodySections(record.bodyMarkdown);
  const previous = parseBodySections(previousBodyMarkdown);
  const proposed = parseBodySections(proposedBodyMarkdown);
  for (const [key, value] of proposed.contentMap) {
    const before = previous.contentMap.get(key);
    const now = current.contentMap.get(key);
    if (before !== undefined && now !== undefined && contentsEqual(before, now)) {
      current.contentMap.set(key, value);
      continue;
    }
    // A heading the proposal introduced and the file does not have yet: take it.
    // (Neither side has it, so there is no newer prose to protect.)
    if (before === undefined && now === undefined) {
      current.contentMap.set(key, value);
    }
  }
  return { ok: true, value: emitBody(record, current, domainNames) };
}

function areaStatus(state: ReviewScopeState | undefined): ReviewAreaState["status"] {
  if (!state) return "missing";
  return state.status === "done" ? "done" : "draft";
}

/**
 * The overall review's refusal, built from the checklist's live areas in vault
 * order. The prefix is part of the operator-facing contract: the page and the
 * rig assert it, so it is spelled once here.
 */
function overallReviewRefusal(remaining: ReviewAreaState[]): string {
  const parts = remaining.map(
    (area) => `${area.name}: ${area.status === "draft" ? "in progress" : "not started"}`,
  );
  return `Finish every area review first — ${parts.join("; ")}.`;
}

async function parseReviewFile(
  rootPath: string,
  cadence: string,
  period: string,
): Promise<Result<ReviewRecord>> {
  const paths = vaultPaths(rootPath);
  // The path builder validates its segments (path containment, vault-warden's
  // VAULT-06) and throws on a traversing cadence/period. Built inside the try so
  // the read path keeps its Result contract: `get_review` with a bad period is
  // an error result, never a rejected tool call.
  try {
    const filePath = paths.reviewMd(cadence, period);
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
        title: typeof data.title === "string" ? data.title : periodTitle(cadence as ReviewCadence, period, (await readSettings(rootPath)).weekStartDay),
        // A file written before the field existed reads as 0: a version no write
        // produces, so a page that read it still gets CONFLICT on a stale save.
        // The frontmatter reader does not infer numbers from bare scalars, and
        // the writer emits this one unquoted, so both shapes are accepted.
        rev: parseReviewRev(data.rev),
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

/**
 * The area checklist for one review file: one entry per live area (the
 * `unlockedAreas` the rest of the app offers, in vault order), with the scope's
 * own status. A file that does not exist yet is not an error — it is every
 * area missing, which is exactly what a fresh period looks like. A file that
 * exists but cannot be parsed keeps its read error, so a broken review is
 * reported rather than silently read as unreviewed.
 */
export async function getReviewAreaChecklist(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewAreaChecklist>> {
  // Daily has no area sections at all: the checklist is empty and complete.
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
    const listed = await listDomains(rootPath);
    if (!listed.ok) return listed;

    const parsed = await parseReviewFile(rootPath, cadence, period);
    let scopes: Record<string, ReviewScopeState> | null = null;
    if (parsed.ok) {
      scopes = parsed.value.scopes;
    } else if (parsed.error !== "Review file not found") {
      return parsed;
    }

    const areas: ReviewAreaState[] = unlockedAreas(listed.value).map((domain) => ({
      slug: domain.slug,
      name: domain.meta.name,
      status: areaStatus(scopes?.[domain.slug]),
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

export async function ensureReview(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string },
): Promise<Result<ReviewRecord>> {
  // The daily cadence is one general review: it has no area scopes, so an
  // area section would be a heading the page never shows and the companion
  // would then be asked to fill. Refuse before touching the file.
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const settings = await readSettings(rootPath);
      const weekStartDay = settings.weekStartDay;
      // A review may only be started once its own window has opened. This replaced
      // the old "not a future period" check: the window is a stricter question
      // than the calendar's, because a weekly review is not writable merely
      // because its week has started.
      const notOpen = reviewNotOpenError(settings, input.cadence, input.period);
      if (notOpen) {
        return { ok: false, error: notOpen };
      }

      const paths = vaultPaths(rootPath);
      const filePath = paths.reviewMd(input.cadence, input.period);

      const existing = await parseReviewFile(rootPath, input.cadence, input.period);
      const existingRecord = existing.ok ? existing.value : null;

      const domainNames = await readDomainNames(rootPath);

      if (!existingRecord) {
        // Create new.
        const title = periodTitle(input.cadence, input.period, weekStartDay);
        let body = `# ${title}\n\n${buildOverallSkeleton()}`;

        const scopes: Record<string, ReviewScopeState> = {
          overall: { status: "draft", sessionId: null },
        };

        if (!isOverall(input.scope)) {
          const name = domainNames.get(input.scope) ?? input.scope;
          body += "\n\n" + buildDomainSkeleton(name);
          scopes[input.scope] = { status: "draft", sessionId: null };
        }

        const now = todayIso();
        const record: ReviewRecord = {
          cadence: input.cadence,
          period: input.period,
          weekStartDay,
          locked: false,
          updatedAt: now,
          title,
          scopes,
          bodyMarkdown: body,
          rev: 1,
        };
        await writeRecord(filePath, record);
        // AGENT-09: an ensured review is a write (the file did not exist).
        await logReview(
          rootPath,
          "review.ensured",
          `Started the ${title}`,
          { cadence: input.cadence, period: input.period, scope: input.scope },
          USER_ACTOR,
        );
        return parseReviewFile(rootPath, input.cadence, input.period);
      }

      const record = existingRecord;

      // File exists.
      if (isOverall(input.scope)) {
        // Already ensured overall by existing.
        return { ok: true, value: record };
      }

      // Domain scope — ensure section.
      if (record.scopes[input.scope]) {
        return { ok: true, value: record };
      }

      // A locked review is finished: no new section may be added to it.
      if (record.locked) {
        return { ok: false, error: "LOCKED" };
      }

      // Append the domain section (and its scope state) to the body and the map.
      const name = domainNames.get(input.scope) ?? input.scope;
      const parsed = parseBodySections(record.bodyMarkdown);
      record.scopes[input.scope] = { status: "draft", sessionId: null };
      // `emitBody` renders one section per scope state, so adding the scope is
      // the whole edit; appending a skeleton as well would plant it twice.
      record.bodyMarkdown = emitBody(record, parsed, domainNames);
      record.rev += 1;
      record.updatedAt = todayIso();

      await writeRecord(filePath, record);
      // AGENT-09: adding a domain section is a write too.
      await logReview(
        rootPath,
        "review.ensured",
        `Added the ${name} section to the ${record.title}`,
        { cadence: input.cadence, period: input.period, scope: input.scope },
        USER_ACTOR,
      );
      return parseReviewFile(rootPath, input.cadence, input.period);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
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

export async function getReview(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
): Promise<Result<ReviewRecord>> {
  return parseReviewFile(rootPath, cadence, period);
}

/**
 * One scope's page, read from the file. This is what the companion's
 * `get_review` with a scope returns: the prose it is allowed to write, the rev to
 * quote back, and the status/session facts the old whole-file read carried.
 */
export async function getReviewPageBody(
  rootPath: string,
  cadence: ReviewCadence,
  period: string,
  scope: string,
): Promise<Result<ReviewPageBody>> {
  if (cadence === "daily" && !isOverall(scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  const review = await parseReviewFile(rootPath, cadence, period);
  if (!review.ok) return review;
  const record = review.value;
  const domainNames = await readDomainNames(rootPath);
  if (!isOverall(scope) && !domainNames.has(scope)) {
    return { ok: false, error: `Area not found: ${scope}` };
  }
  const state = record.scopes[scope];
  return {
    ok: true,
    value: {
      scope,
      status: state ? state.status : "missing",
      sessionId: state?.sessionId ?? null,
      rev: record.rev,
      locked: record.locked,
      bodyMarkdown: pageBodyForRecord(record, scope, domainNames),
    },
  };
}

/**
 * Write the whole body — the page editor's path.
 *
 * This is the one writer that legitimately owns every heading, so it is the one
 * that must say which version it read: `baseRev` is the `rev` from the record the
 * editor loaded, and a mismatch returns `CONFLICT` with the file as it stands
 * rather than overwriting prose the operator has not seen. `baseRev` absent is
 * the pre-guard behaviour, kept for callers that are not a long-lived editor.
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
      const existing = await parseReviewFile(rootPath, input.cadence, input.period);
      if (!existing.ok) return failure(codeForError(existing.error), existing.error);
      const record = existing.value;

      if (record.locked) return failure("LOCKED", "LOCKED", record);

      // Writing is gated after the read and lock checks and before canonicalizing
      // anything: the page autosaves as the operator types, and an autosave that
      // raced the window's opening must not write a body the review page would
      // then refuse to draw. The same sentence `ensureReview` uses is returned.
      const settings = await readSettings(rootPath);
      const notOpen = reviewNotOpenError(settings, record.cadence, record.period);
      if (notOpen) return failure("NOT_OPEN", notOpen, record);

      // Validate required headings.
      const missing = missingHeadings(input.bodyMarkdown);
      if (missing.length > 0) {
        return failure("MALFORMED", `Missing required headings: ${missing.join(", ")}`, record);
      }

      // Compare-and-swap: the editor says which version its box was built from.
      // A no-op save that carries an old rev still conflicts — the box is stale
      // even if this particular save would have written the same characters.
      if (typeof input.baseRev === "number" && input.baseRev !== record.rev) {
        return failure("CONFLICT", "CONFLICT", record);
      }

      const domainNames = await readDomainNames(rootPath);
      const previousBody = record.bodyMarkdown;
      const nextBody = canonicalizeBody(input.bodyMarkdown, record, domainNames);

      // The page autosaves the body it already sent; a second write of the same
      // body is not a change, and must not bump the rev under another writer.
      if (nextBody === previousBody) {
        return { ok: true, value: record };
      }

      record.bodyMarkdown = nextBody;
      record.rev += 1;
      record.updatedAt = todayIso();
      await writeRecord(vaultPaths(rootPath).reviewMd(input.cadence, input.period), record);
      // AGENT-09: one line per real edit, naming who wrote the review. A no-op
      // autosave writes nothing to the log, so the feed stays a record of changes
      // rather than of keystrokes.
      await logReview(
        rootPath,
        "review.written",
        `Wrote the ${record.title}`,
        { cadence: input.cadence, period: input.period, chars: record.bodyMarkdown.length },
        input.actor,
      );
      // The file is the truth, and it is handed back as the file holds it.
      const reread = await parseReviewFile(rootPath, input.cadence, input.period);
      if (!reread.ok) return failure(codeForError(reread.error), reread.error);
      return reread;
    } catch (e) {
      return failure("MALFORMED", e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * Write one scope's page — the companion's path.
 *
 * The page body carries its own title and the four headings; the engine reads
 * the file fresh under the mutex and replaces only that scope's keys, so a write
 * to Health cannot touch Finance's prose, the overall sections, or an operator's
 * extra heading. This is why the page write needs no `baseRev`: cross-scope
 * changes are not a conflict, they are other people's work. A same-scope race
 * is last-write-wins, which is the same page being written twice.
 */
export async function writeReviewPage(
  rootPath: string,
  input: {
    cadence: ReviewCadence;
    period: string;
    scope: string;
    bodyMarkdown: string;
    actor: Actor;
    baseRev?: number;
  },
): Promise<ReviewWriteOutcome> {
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return failure("MALFORMED", DAILY_REVIEW_NO_AREAS);
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const existing = await parseReviewFile(rootPath, input.cadence, input.period);
      if (!existing.ok) return failure(codeForError(existing.error), existing.error);
      const record = existing.value;

      if (record.locked) return failure("LOCKED", "LOCKED", record);

      const settings = await readSettings(rootPath);
      const notOpen = reviewNotOpenError(settings, record.cadence, record.period);
      if (notOpen) return failure("NOT_OPEN", notOpen, record);

      const domainNames = await readDomainNames(rootPath);
      if (!isOverall(input.scope) && !domainNames.has(input.scope)) {
        return failure("NOT_FOUND", `Area not found: ${input.scope}`, record);
      }

      const composed = composeBodyWithPage(
        record,
        input.scope,
        input.bodyMarkdown,
        domainNames,
      );
      if (!composed.ok) return failure("MALFORMED", composed.error, record);

      if (composed.value === record.bodyMarkdown) {
        return { ok: true, value: record };
      }

      record.bodyMarkdown = composed.value;
      record.rev += 1;
      record.updatedAt = todayIso();
      await writeRecord(vaultPaths(rootPath).reviewMd(input.cadence, input.period), record);
      await logReview(
        rootPath,
        "review.written",
        `Wrote the ${input.scope === OVERALL ? "life" : input.scope} page of the ${record.title}`,
        {
          cadence: input.cadence,
          period: input.period,
          scope: input.scope,
          chars: record.bodyMarkdown.length,
        },
        input.actor,
      );
      const reread = await parseReviewFile(rootPath, input.cadence, input.period);
      if (!reread.ok) return failure(codeForError(reread.error), reread.error);
      return reread;
    } catch (e) {
      return failure("MALFORMED", e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * The whole body a page write *would* produce, without writing it.
 *
 * A locked review turns the companion's page write into a Decision, and a
 * Decision stores a whole-file body (that is its contract today). This composes
 * the same merge the write would have landed, so the approved change is the
 * change the companion asked for and not a stale re-read of the file.
 */
export async function composeReviewPageWrite(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; bodyMarkdown: string },
): Promise<Result<{ bodyMarkdown: string; record: ReviewRecord }>> {
  const existing = await parseReviewFile(rootPath, input.cadence, input.period);
  if (!existing.ok) return existing;
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  const domainNames = await readDomainNames(rootPath);
  if (!isOverall(input.scope) && !domainNames.has(input.scope)) {
    return { ok: false, error: `Area not found: ${input.scope}` };
  }
  const record = existing.value;
  const composed = composeBodyWithPage(record, input.scope, input.bodyMarkdown, domainNames);
  if (!composed.ok) return composed;
  return { ok: true, value: { bodyMarkdown: composed.value, record } };
}

export async function markReviewDone(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; actor?: Actor },
): Promise<Result<ReviewRecord>> {
  if (input.cadence === "daily" && !isOverall(input.scope)) {
    return { ok: false, error: DAILY_REVIEW_NO_AREAS };
  }
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const existing = await parseReviewFile(rootPath, input.cadence, input.period);
      if (!existing.ok) return existing;
      const record = existing.value;

      if (record.locked) return { ok: false, error: "LOCKED" };

      if (isOverall(input.scope)) {
        // The life review is the summary of the area reviews, so it cannot be
        // finished before they are. Daily has no area sections and is never
        // gated: its one general review is the whole file.
        if (input.cadence !== "daily") {
          const checklist = await getReviewAreaChecklist(rootPath, input.cadence, input.period);
          if (!checklist.ok) return checklist;
          const notDone = checklist.value.areas.filter((area) => area.status !== "done");
          if (notDone.length > 0) {
            return { ok: false, error: overallReviewRefusal(notDone) };
          }
        }
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
      await writeRecord(vaultPaths(rootPath).reviewMd(input.cadence, input.period), record);
      // AGENT-09: a scope transition is an attributable write. Marking `overall`
      // done also locks the review, which is the state the operator expects to be
      // final, so "who marked this done" has to be answerable.
      await logReview(
        rootPath,
        "review.marked-done",
        `Marked ${input.scope} done on the ${record.title}`,
        { cadence: input.cadence, period: input.period, scope: input.scope, locked: record.locked },
        input.actor ?? USER_ACTOR,
      );
      return { ok: true, value: record };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Unlock a locked review so it can be edited in place.
 *
 * Fort-Knox AGENT-14: this is user-actor-only. The review lock's whole job is to
 * route an agent's edit into a pending Decision, and an agent that could call
 * `unlock_review` first could then write the "final" review directly — which is
 * exactly what a prompt-injected companion could do when the tool was open to
 * every actor. The operator's own unlock comes through the renderer IPC, which
 * passes the user actor (or nothing, which defaults to it).
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
      const existing = await parseReviewFile(rootPath, cadence, period);
      if (!existing.ok) return existing;
      const record = existing.value;

      record.locked = false;
      record.updatedAt = todayIso();

      await writeRecord(vaultPaths(rootPath).reviewMd(cadence, period), record);
      // AGENT-09: unlocking a "final" review is an attributable event.
      await logReview(
        rootPath,
        "review.unlocked",
        `Unlocked the ${record.title}`,
        { cadence, period },
        actor,
      );
      return { ok: true, value: record };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export async function setReviewSessionId(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; sessionId: string },
): Promise<Result<ReviewRecord>> {
  return withReviewLock(rootPath, input.cadence, input.period, async () => {
    try {
      const existing = await parseReviewFile(rootPath, input.cadence, input.period);
      if (!existing.ok) return existing;
      const record = existing.value;

      // A locked review is read-only all the way down: binding a new chat to it
      // would be the first write of a session that can never land.
      if (record.locked) return { ok: false, error: "LOCKED" };

      if (!record.scopes[input.scope]) {
        record.scopes[input.scope] = { status: "draft", sessionId: null };
      }
      record.scopes[input.scope]!.sessionId = input.sessionId;
      record.updatedAt = todayIso();

      await writeRecord(vaultPaths(rootPath).reviewMd(input.cadence, input.period), record);
      return { ok: true, value: record };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
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

/**
 * Apply an approved change to a locked review.
 *
 * `previousBodyMarkdown` is what the Decision was proposed against (see
 * `DecisionTarget`), and `mergeReviewBodies` uses it to keep a heading whose
 * file content moved on since the proposal. It is optional only for callers that
 * predate the merge; without it the approved body is applied whole.
 */
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
      const existing = await parseReviewFile(rootPath, cadence, period);
      if (!existing.ok) return existing;
      const record = existing.value;

      // Approving an edited body is still a write, so it obeys the same window
      // rule as `writeReview`: a Decision filed against a period whose review has
      // not opened yet cannot land its body ahead of the review.
      const settings = await readSettings(rootPath);
      const notOpen = reviewNotOpenError(settings, cadence, period);
      if (notOpen) {
        return { ok: false, error: notOpen };
      }

      const domainNames = await readDomainNames(rootPath);
      const nextBody =
        previousBodyMarkdown === undefined
          ? canonicalizeBody(bodyMarkdown, record, domainNames)
          : (() => {
              const merged = mergeReviewBodies(record, previousBodyMarkdown, bodyMarkdown, domainNames);
              return merged.ok ? merged.value : null;
            })();
      if (nextBody === null) {
        return {
          ok: false,
          error: "Invalid review body: it no longer holds the four required headings",
        };
      }

      if (nextBody === record.bodyMarkdown && record.locked) {
        return { ok: true, value: record };
      }

      record.updatedAt = todayIso();
      if (nextBody !== record.bodyMarkdown) record.rev += 1;
      record.bodyMarkdown = nextBody;
      record.locked = true;

      await writeRecord(vaultPaths(rootPath).reviewMd(cadence, period), record);
      // AGENT-09: a locked-review Decision that approved and applied is a review
      // write; name the actor the approval carried (decisions.ts passes none yet,
      // so this reads as the operator approving, which is the consent that landed
      // it).
      await logReview(
        rootPath,
        "review.applied",
        `Applied an approved change to the ${record.title}`,
        { cadence, period, chars: record.bodyMarkdown.length },
        actor,
      );
      return { ok: true, value: record };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
