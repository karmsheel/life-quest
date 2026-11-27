import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { listDomains } from "./domains.ts";
import { unlockedAreas } from "./domain-lens.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  USER_ACTOR,
  type Actor,
  type Result,
} from "./types.ts";

/**
 * A live area's page contract: the headings its pages carry beyond the four
 * common ones.
 *
 * The four common H2s are the Life-review synthesis contract and are required on
 * every page, so a template never lists them; it names only the area's own
 * sections, in the order the page keeps them. A template is therefore "the
 * allowed extras", and may be absent: a page with no template is exactly the
 * four-heading skeleton.
 *
 * The file is `.lifequest/reviews/pages/<area-slug>.md`, beside the cadence
 * skills and outside `reviews/<cadence>/` so that a period scan never sees it.
 */
export const REVIEW_PAGE_COMMON_HEADINGS = [
  "Look-back",
  "Keep",
  "Change",
  "Next-period intent",
] as const;

/** How many extra sections a template may name. */
export const REVIEW_PAGE_TEMPLATE_MAX_EXTRAS = 12;

/** The template as the engine reads it. `exists` is false when there is no file. */
export type ReviewPageTemplate = {
  scope: string;
  /** The area's own section names, in template order. Never the four common ones. */
  extras: string[];
  exists: boolean;
  /** What stopped a heading from being part of the contract; reported, never thrown. */
  problems: string[];
};

const HEADING = /^(#{1,6})\s+(.*)$/;

function isCommonHeading(text: string): boolean {
  return (REVIEW_PAGE_COMMON_HEADINGS as readonly string[]).includes(text);
}

/**
 * Parse a template body without touching disk. Tolerant by design: a broken
 * line is reported in `problems` and skipped, so one typo cannot make an area's
 * page unreadable or unstorable — the caller shows the problem and keeps the
 * headings that did parse.
 */
export function parseReviewPageTemplate(markdown: string): {
  title: string | null;
  extras: string[];
  problems: string[];
} {
  const extras: string[] = [];
  const problems: string[] = [];
  let title: string | null = null;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const match = HEADING.exec(raw);
    if (!match) continue;
    const level = match[1]!.length;
    const text = match[2]!.trim();
    if (!text) continue;
    if (level === 1) {
      if (title !== null) {
        problems.push(`a page template has one # title only; ignored "# ${text}"`);
        continue;
      }
      if (extras.length > 0) {
        problems.push(`the # title must come before the ## headings; ignored "# ${text}"`);
        continue;
      }
      title = text;
      continue;
    }
    if (level > 2) {
      problems.push(`"${raw.trim()}" is a level-${level} heading; a template names ## sections only`);
      continue;
    }
    if (isCommonHeading(text)) {
      problems.push(
        `"## ${text}" is one of the four common headings every page already carries; a template names only this area's own sections`,
      );
      continue;
    }
    if (extras.includes(text)) {
      problems.push(`the template repeats "## ${text}"`);
      continue;
    }
    extras.push(text);
  }
  return { title, extras, problems };
}

/**
 * The canonical form of a template: an optional single `# title` line, then one
 * `##` line per extra in order. Pure, so the page writer can canonicalise an
 * operator's template without a disk read; content under a heading is not part
 * of the contract and is dropped rather than stored.
 */
export function canonicalizeReviewPageTemplate(markdown: string): {
  markdown: string;
  title: string | null;
  extras: string[];
  problems: string[];
} {
  const parsed = parseReviewPageTemplate(markdown);
  const lines = [
    ...(parsed.title ? [`# ${parsed.title}`, ""] : []),
    ...parsed.extras.map((extra) => `## ${extra}`),
  ];
  return {
    markdown: lines.join("\n\n"),
    title: parsed.title,
    extras: parsed.extras,
    problems: parsed.problems,
  };
}

/**
 * A template's canonical markdown from its extras alone — what the writer emits
 * and what a launch or a migration could seed an area's contract with.
 */
export function reviewPageTemplateSeed(extras: readonly string[]): string {
  return extras.map((extra) => `## ${extra}`).join("\n\n");
}

async function isLiveArea(rootPath: string, slug: string): Promise<boolean> {
  const listed = await listDomains(rootPath);
  if (!listed.ok) return false;
  return unlockedAreas(listed.value).some((domain) => domain.slug === slug);
}

function validateScope(scope: string, live: boolean): string | null {
  if (scope === "overall") {
    return 'The overall page has no page template — a template names one area\'s own sections.';
  }
  if (!live) {
    return `Area is not live: ${scope} — a page template is written for a live area only.`;
  }
  return null;
}

function validateTemplate(parsed: {
  extras: string[];
  problems: string[];
}): string | null {
  if (parsed.problems.length > 0) {
    return `Invalid page template: ${parsed.problems.join("; ")}.`;
  }
  if (parsed.extras.length === 0) {
    return "Invalid page template: it names no extra headings. Name the area's own ## sections, or delete the template file.";
  }
  if (parsed.extras.length > REVIEW_PAGE_TEMPLATE_MAX_EXTRAS) {
    return `Invalid page template: it names ${parsed.extras.length} extra headings; the most is ${REVIEW_PAGE_TEMPLATE_MAX_EXTRAS}.`;
  }
  return null;
}

async function readTemplateFile(
  rootPath: string,
  scope: string,
): Promise<Result<ReviewPageTemplate | null>> {
  try {
    const raw = await fs.readFile(vaultPaths(rootPath).reviewPageTemplateMd(scope), "utf8");
    const parsed = canonicalizeReviewPageTemplate(raw);
    return {
      ok: true,
      value: {
        scope,
        extras: parsed.extras,
        exists: true,
        problems:
          parsed.extras.length === 0
            ? [...parsed.problems, "it names no extra headings"]
            : parsed.problems,
      },
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: null };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read one area's page template.
 *
 * A missing file is not an error: it means the area's pages are exactly the four
 * common headings. Parsing problems come back in `problems` — the read never
 * throws over a template the operator edited by hand.
 */
export async function getReviewPageTemplate(
  rootPath: string,
  scope: string,
): Promise<Result<ReviewPageTemplate>> {
  try {
    const read = await readTemplateFile(rootPath, scope);
    if (!read.ok) return read;
    return {
      ok: true,
      value: read.value ?? { scope, extras: [], exists: false, problems: [] },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Replace one live area's page template.
 *
 * Writing the contract does not rewrite a single page: seeding reads it when a
 * page is created, and the page writer applies its order the next time that page
 * is written. That is what makes "tailor Health's sections" a contract change,
 * not a migration of the operator's finished reports.
 *
 * Fort-Knox AGENT-09: the write leaves a life-log line naming the actor, because
 * the template decides the shape of every later report of that area.
 */
export async function writeReviewPageTemplate(
  rootPath: string,
  scope: string,
  markdown: string,
  actor: Actor = USER_ACTOR,
): Promise<Result<ReviewPageTemplate>> {
  try {
    const live = await isLiveArea(rootPath, scope);
    const scopeError = validateScope(scope, live);
    if (scopeError) return { ok: false, error: scopeError };
    const canonical = canonicalizeReviewPageTemplate(markdown);
    const problem = validateTemplate(canonical);
    if (problem) return { ok: false, error: problem };
    await atomicWriteFile(
      vaultPaths(rootPath).reviewPageTemplateMd(scope),
      `${canonical.markdown}\n`,
    );
    await appendLog(rootPath, {
      domainSlug: null,
      type: "review.template-written",
      summary: `Wrote the ${scope} page template`,
      payload: { scope, extras: canonical.extras.length },
      actor,
    });
    return getReviewPageTemplate(rootPath, scope);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
