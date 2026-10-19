import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-write.ts";
import { listDomains } from "./domains.ts";
import { periodBounds } from "./period.ts";
import { vaultPaths } from "./paths.ts";
import { ensureReview, getReview, writeReview } from "./reviews.ts";
import { applyViewDefaults, resolveViewBlocks, runViewBlocks } from "./views.ts";
import {
  type Actor,
  type ComposedViewRunResult,
  type Result,
  type ReviewCadence,
  type ReviewPrepopulateResult,
  type ReviewSnapshotDirective,
  type ReviewSnapshotOutcome,
  type ReviewSkill,
  type ViewBlockSpec,
  type ViewSpec,
} from "./types.ts";

/**
 * The review skill: what a cadence's review session is told to do, and what the
 * app fills in before the interview begins.
 *
 * Two halves in one file, because they are one intention. The prose is injected
 * verbatim into the session's instructions, so "ask about sleep", "keep it under
 * a page", "compare against the previous review" are the operator's own standing
 * rules rather than a guess the model makes each time. The fenced directives are
 * executed by the app instead of the model, because a figure that is supposed to
 * be there when the operator opens the review must not depend on a gateway being
 * up or a model choosing to fetch it. That is the difference between a snapshot
 * and a question.
 *
 * The file is per cadence and vault-scoped: `.lifequest/reviews/weekly.md`. An
 * operator who asks the companion to "always put my week's spending in the
 * Financial section" is not asking for a prompt tweak, they are asking for a
 * directive, and the companion writes one here with `write_review_skill`.
 *
 * WHY A DEFAULT AND NOT A SEED. `getReviewSkill` answers with the shipped
 * default when the file is missing and does not write it. A read that created a
 * file would freeze the default at the version that first ran; keeping the read
 * pure means a later release can improve a cadence's starting rules and every
 * operator who never edited theirs gets it. `ensureReviewSkill` is the write,
 * and it only runs from the one place a session actually starts.
 */

/** The fence that carries one directive: ```lifequest-snapshot */
const SNAPSHOT_FENCE_OPEN = /^```lifequest-snapshot\s*$/;
const FENCE_CLOSE = /^```\s*$/;

/** Machine markers in the review body: what a written block is found by. */
export function snapshotOpenMarker(id: string): string {
  return `<!-- lifequest:snapshot:${id} -->`;
}

export function snapshotCloseMarker(id: string): string {
  return `<!-- /lifequest:snapshot:${id} -->`;
}

/**
 * The four sub-headings every domain section carries, and what a directive may
 * name. Kept here rather than imported from `reviews.ts` because this module
 * decides where a block goes, and a section name outside this set has no
 * heading to land under.
 */
export const REVIEW_SECTIONS = [
  "Look-back",
  "Keep",
  "Change",
  "Next-period intent",
] as const;

/**
 * The shipped rules for a cadence. Each one carries the finance snapshot, whose
 * window is the review's own period: the week's spending in a weekly review, the
 * day's in a daily one, with no second copy of the rules to keep in step.
 */
function financeSnapshotBlock(): Record<string, unknown>[] {
  return [
    {
      id: "total",
      title: "Spend",
      presentation: "metric",
      groupBy: null,
      timeBucket: null,
      timeColumnId: "date",
      timeWindow: "all",
      filters: [],
      measure: "sum",
      measureColumnId: "amount",
      per: null,
      sort: { by: "value", dir: "desc" },
      limit: 12,
      convertToZar: true,
      columns: [],
      span: 2,
    },
    {
      id: "by-category",
      title: "By category",
      presentation: "table",
      groupBy: "category",
      timeBucket: null,
      timeColumnId: "date",
      timeWindow: "all",
      filters: [],
      measure: "sum",
      measureColumnId: "amount",
      per: null,
      sort: { by: "value", dir: "desc" },
      limit: 12,
      convertToZar: true,
      columns: [],
      span: 2,
    },
  ];
}

export const FINANCE_SNAPSHOT_ID = "finance-spend";

function financeSnapshotJson(): string {
  return JSON.stringify(
    {
      id: FINANCE_SNAPSHOT_ID,
      domain: "financial",
      section: "Look-back",
      title: "Spending this period",
      window: "period",
      spec: {
        databaseId: "finance:transactions",
        title: "Spending this period",
        presentation: "metric",
        groupBy: null,
        timeBucket: null,
        timeColumnId: "date",
        timeWindow: "all",
        filters: [],
        measure: "sum",
        measureColumnId: "amount",
        per: null,
        sort: { by: "value", dir: "desc" },
        limit: 12,
        convertToZar: true,
        columns: [],
        blocks: financeSnapshotBlock(),
      },
    },
    null,
    2,
  );
}

function defaultSkillMarkdown(cadence: ReviewCadence): string {
  const shared = [
    "## How to run this review",
    "",
    "- Work from the review file the app has open. Read it with `get_review` before you change anything.",
    "- Look-back is for what happened, told straight. Keep is for what worked and should stay. Change is for what to do differently. Next-period intent is for what the next period is for.",
    "- Prefer the operator's own words over your summary of them. `get_period_pack` carries the period's daily notes, log, tasks, goals and events — use it rather than asking for facts it already holds.",
    "- Write into the section you were asked about, and leave the other sections as they are.",
    "- When the report is ready, propose `mark_review_done` rather than marking it done yourself.",
    "",
  ];
  const perCadence: Record<ReviewCadence, string[]> = {
    daily: [
      "- One day is small: keep it to a few honest lines rather than a report.",
      "- The one question worth asking every day is what the day was actually for.",
    ],
    weekly: [
      "- A week is where patterns start to show. Name the one pattern worth changing, not five.",
      "- Compare against the previous week's review when there is one.",
    ],
    monthly: [
      "- A month is where a goal either has a pulse or does not. Check the open goals before you write intent.",
    ],
    quarterly: [
      "- A quarter is long enough that the honest question is what to stop doing.",
    ],
    yearly: [
      "- A year is a story, not a list. Read the months before you write the year.",
    ],
  };
  return [
    "---",
    `cadence: ${cadence}`,
    "---",
    "# " + cadence.charAt(0).toUpperCase() + cadence.slice(1) + " review skill",
    "",
    "Standing rules for this cadence's review sessions. Edit freely, or ask the",
    "companion to add a rule — the whole file is handed to the review session.",
    "",
    ...shared,
    ...perCadence[cadence],
    "",
    "## Snapshots",
    "",
    "Each fenced block below names a figure the app itself writes into the review",
    "before the interview starts, so the numbers are there whether or not the agent",
    "is running. `window: period` means the block reads exactly the review's own",
    "period. Marked blocks are refreshed in place on every Start.",
    "",
    "```lifequest-snapshot",
    financeSnapshotJson(),
    "```",
    "",
  ].join("\n");
}

export function defaultReviewSkill(cadence: ReviewCadence): string {
  return defaultSkillMarkdown(cadence);
}

/**
 * The directives in a skill file.
 *
 * A fence that is not a JSON object, or that is missing an id, a domain or a
 * spec, is reported rather than thrown: a typo in one directive must not be
 * able to stop a review's other snapshots from being written, and the operator
 * needs to be told which one to fix.
 */
export function parseSnapshotDirectives(markdown: string): {
  directives: ReviewSnapshotDirective[];
  problems: string[];
} {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const directives: ReviewSnapshotDirective[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    if (!SNAPSHOT_FENCE_OPEN.test(lines[i]!)) continue;
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !FENCE_CLOSE.test(lines[i]!)) {
      body.push(lines[i]!);
      i += 1;
    }
    const label = `snapshot ${directives.length + problems.length + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.join("\n"));
    } catch (e) {
      problems.push(
        `${label}: not valid JSON (${e instanceof Error ? e.message : String(e)})`,
      );
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      problems.push(`${label}: the fence must hold one JSON object`);
      continue;
    }
    const raw = parsed as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const domain = typeof raw.domain === "string" ? raw.domain.trim() : "";
    if (!id) {
      problems.push(`${label}: "id" is required`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${label}: duplicate id "${id}"`);
      continue;
    }
    if (!domain) {
      problems.push(`${label} (${id}): "domain" is required`);
      continue;
    }
    const spec = raw.spec;
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      problems.push(`${label} (${id}): "spec" must be one view spec object`);
      continue;
    }
    const section =
      typeof raw.section === "string" && raw.section.trim()
        ? raw.section.trim()
        : "Look-back";
    if (!REVIEW_SECTIONS.includes(section as (typeof REVIEW_SECTIONS)[number])) {
      problems.push(
        `${label} (${id}): "section" must be one of ${REVIEW_SECTIONS.join(", ")}`,
      );
      continue;
    }
    const window =
      raw.window === "all" ? "all" : raw.window === "period" || raw.window == null ? "period" : null;
    if (window === null) {
      problems.push(`${label} (${id}): "window" must be "period" or "all"`);
      continue;
    }
    seen.add(id);
    directives.push({
      id,
      domain,
      section,
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : "Snapshot",
      window,
      spec: applyViewDefaults(
        spec as Omit<ViewSpec, "schemaVersion">,
      ) as Omit<ViewSpec, "schemaVersion">,
    });
  }
  return { directives, problems };
}

function skillFrom(cadence: ReviewCadence, markdown: string, exists: boolean): ReviewSkill {
  const { directives, problems } = parseSnapshotDirectives(markdown);
  return { cadence, markdown, snapshots: directives, problems, exists };
}

/** A cadence's rules: the file when it is there, the shipped default when not. */
export async function getReviewSkill(
  rootPath: string,
  cadence: ReviewCadence,
): Promise<Result<ReviewSkill>> {
  const file = vaultPaths(rootPath).reviewSkillMd(cadence);
  try {
    const markdown = await fs.readFile(file, "utf8");
    return { ok: true, value: skillFrom(cadence, markdown, true) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: true,
        value: skillFrom(cadence, defaultReviewSkill(cadence), false),
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Write one cadence's rules, and only if there is no file yet for `ensure`.
 * An edited skill is never overwritten: the operator's rules are theirs.
 */
async function writeSkillFile(file: string, markdown: string): Promise<Result<true>> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function ensureReviewSkill(
  rootPath: string,
  cadence: ReviewCadence,
): Promise<Result<ReviewSkill>> {
  const file = vaultPaths(rootPath).reviewSkillMd(cadence);
  const existing = await getReviewSkill(rootPath, cadence);
  if (!existing.ok) return existing;
  if (existing.value.exists) return existing;
  const written = await writeSkillFile(file, existing.value.markdown);
  if (!written.ok) return written;
  return getReviewSkill(rootPath, cadence);
}

export async function writeReviewSkill(
  rootPath: string,
  cadence: ReviewCadence,
  markdown: string,
): Promise<Result<ReviewSkill>> {
  const written = await writeSkillFile(
    vaultPaths(rootPath).reviewSkillMd(cadence),
    markdown,
  );
  if (!written.ok) return written;
  return getReviewSkill(rootPath, cadence);
}

// ---------------------------------------------------------------------------
// The block a snapshot writes
// ---------------------------------------------------------------------------

/** `1234.5` → `1,234.5`; the dashboard's own grouping, without a locale. */
export function formatSnapshotNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  const negative = rounded < 0;
  const [whole, fraction] = Math.abs(rounded).toFixed(2).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction === "00" ? grouped : `${grouped}.${fraction}`;
  return negative ? `-${trimmed}` : trimmed;
}

function unitSuffix(currency: ComposedViewRunResult["blocks"][number]["result"]["currency"]): string {
  return currency && currency !== "mixed" ? ` (${currency})` : "";
}

/** `next_date` → `Next date`, the way a card heads a column it grouped by. */
function humanizeId(id: string): string {
  const spaced = id.replace(/[_-]+/g, " ").trim();
  if (!spaced) return id;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A cell that cannot break a table: pipes and newlines are escaped out. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * One run rendered as the markdown that goes into the review.
 *
 * The shapes mirror the dashboard card's own: a metric prints its number, a
 * listing keeps its rows, and an aggregate prints its fold — so a snapshot reads
 * as a small version of the same card rather than a second way of saying it.
 */
export function renderSnapshotMarkdown(
  directive: ReviewSnapshotDirective,
  run: ComposedViewRunResult,
  options: {
    windowLabel?: string;
    buckets?: Array<"day" | "week" | "month" | null>;
    groups?: Array<string | null>;
  } = {},
): { markdown: string; groups: number } {
  const out: string[] = [];
  const covers = options.windowLabel ? ` · ${options.windowLabel}` : "";
  out.push(`**${directive.title}**${covers}`);
  out.push("");

  let groups = 0;
  run.blocks.forEach((block, index) => {
    const result = block.result;
    const named = run.blocks.length > 1 && block.title ? [`_${block.title}_`, ""] : [];
    if (result.listRows && result.listRows.length > 0) {
      groups += result.listRows.length;
      out.push(...named);
      out.push(`| ${result.columns.map(cell).join(" | ")} |`);
      out.push(`| ${result.columns.map(() => "---").join(" | ")} |`);
      for (const row of result.listRows) {
        out.push(`| ${row.map((v) => cell(String(v))).join(" | ")} |`);
      }
      out.push("");
      return;
    }
    if (block.presentation === "metric") {
      const value = result.rows[0]?.[1] ?? 0;
      groups += 1;
      out.push(
        `${formatSnapshotNumber(value)}${unitSuffix(result.currency)}${result.rows.length === 0 ? " — no rows in this window" : ""}`,
      );
      out.push("");
      return;
    }
    if (result.rows.length === 0) {
      out.push("_No rows in this window._");
      out.push("");
      return;
    }
    groups += result.rows.length;
    const bucket = options.buckets?.[index] ?? null;
    const grouped = options.groups?.[index] ?? null;
    const label = bucket
      ? bucket === "day"
        ? "Day"
        : bucket === "week"
          ? "Week"
          : "Month"
      : grouped
        ? humanizeId(grouped)
        : "Group";
    out.push(...named);
    out.push(`| ${cell(label)} | Total${unitSuffix(result.currency)} |`);
    out.push("| --- | --- |");
    for (const [name, value] of result.rows) {
      out.push(`| ${cell(name)} | ${formatSnapshotNumber(value)} |`);
    }
    out.push("");
  });

  if (run.warnings.length > 0) {
    out.push(
      ...run.warnings.map((w) => `> ${w}`),
      "",
    );
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return { markdown: out.join("\n"), groups };
}

// ---------------------------------------------------------------------------
// Putting a block into the review body
// ---------------------------------------------------------------------------

type SectionSpan = {
  /** The line index of the `###` heading the block belongs after. */
  headingIndex: number;
  /** The line index just past this section's own content. */
  endIndex: number;
};

/**
 * Where a directive's section is, if the review has one.
 *
 * Addressed by the domain's DISPLAY name, because that is what the review file
 * carries: `## Financial`, not `## financial`. A review that has no such section
 * is left alone rather than given one — inventing a domain section would change
 * which scopes the review claims to cover, which is the operator's decision.
 */
function findSection(
  lines: string[],
  domainName: string,
  section: string,
): SectionSpan | null {
  let inDomain = false;
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      if (inDomain && headingIndex >= 0) return { headingIndex, endIndex: i };
      inDomain = h2[1] === domainName;
      headingIndex = -1;
      continue;
    }
    if (!inDomain) continue;
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      if (headingIndex >= 0) return { headingIndex, endIndex: i };
      if (h3[1] === section) headingIndex = i;
      continue;
    }
    const h1 = /^#\s+/.exec(line);
    if (h1) {
      if (headingIndex >= 0) return { headingIndex, endIndex: i };
      inDomain = false;
      headingIndex = -1;
    }
  }
  if (inDomain && headingIndex >= 0) return { headingIndex, endIndex: lines.length };
  return null;
}

/**
 * Put one rendered snapshot where it belongs, replacing what a previous run put
 * there. Replacement is by the marker pair, not by section: the operator's own
 * prose in the same section is never touched, and running Start twice leaves one
 * block rather than two.
 */
export function upsertSnapshotBlock(
  body: string,
  directive: ReviewSnapshotDirective,
  domainName: string,
  markdown: string,
): { body: string; status: "written" | "unchanged" | "skipped"; reason?: string } {
  const open = snapshotOpenMarker(directive.id);
  const close = snapshotCloseMarker(directive.id);
  const block = [open, "", ...markdown.split("\n"), "", close];
  const lines = body.replace(/\r\n/g, "\n").split("\n");

  const openAt = lines.indexOf(open);
  if (openAt !== -1) {
    const closeAt = lines.indexOf(close, openAt + 1);
    const end = closeAt === -1 ? openAt + 1 : closeAt + 1;
    const next = [...lines.slice(0, openAt), ...block, ...lines.slice(end)];
    const joined = next.join("\n");
    return {
      body: joined,
      status: joined === body ? "unchanged" : "written",
    };
  }

  const found = findSection(lines, domainName, directive.section);
  if (!found) {
    return {
      body,
      status: "skipped",
      reason: `this review has no "${directive.section}" section under ${domainName}`,
    };
  }
  // Straight after the heading and whatever blank lines follow it, so the block
  // opens the section and the operator's prose reads under it.
  let at = found.headingIndex + 1;
  while (at < lines.length && lines[at]!.trim() === "") at += 1;
  const next = [...lines.slice(0, at), ...block, "", ...lines.slice(at)];
  return { body: next.join("\n"), status: "written" };
}

/**
 * Fill a review from its cadence's skill, before the interview starts.
 *
 * This is the app doing the reading, not the model: the operator opens a weekly
 * review and the week's spending is already under Financial, whether or not a
 * gateway is up. Everything it touches is inside a marker pair of its own, so
 * the operator's writing in the same file is never at risk, and a locked review
 * is not touched at all — locking means "this is finished".
 */
export async function prepopulateReview(
  rootPath: string,
  input: { cadence: ReviewCadence; period: string; scope: string; actor: Actor },
): Promise<Result<ReviewPrepopulateResult>> {
  const review = await getReview(rootPath, input.cadence, input.period);
  if (!review.ok) return review;
  let record = review.value;

  if (record.locked) {
    return {
      ok: true,
      value: {
        cadence: input.cadence,
        period: input.period,
        scope: input.scope,
        outcomes: [],
        applied: 0,
        planted: [],
        locked: true,
        bodyMarkdown: record.bodyMarkdown,
      },
    };
  }

  const skill = await ensureReviewSkill(rootPath, input.cadence);
  if (!skill.ok) return skill;

  const wanted = skill.value.snapshots.filter(
    (d) => input.scope === "overall" || d.domain === input.scope,
  );
  if (wanted.length === 0 && skill.value.problems.length === 0) {
    return {
      ok: true,
      value: {
        cadence: input.cadence,
        period: input.period,
        scope: input.scope,
        outcomes: [],
        applied: 0,
        planted: [],
        locked: false,
        bodyMarkdown: record.bodyMarkdown,
      },
    };
  }

  const listed = await listDomains(rootPath);
  const names = new Map<string, string>();
  if (listed.ok) {
    for (const d of listed.value) names.set(d.slug, d.meta.name);
  }

  /**
   * A rule names a domain, so the review gets that domain's section.
   *
   * Without this the shipped weekly rule is inert on any review the operator has
   * not already started a domain scope on — the directive would skip every week
   * for want of a `## Financial` heading, which is not what "the week's spending
   * belongs under Financial" means. Planting goes through `ensureReview` with
   * that domain as its scope, which is the existing, tested way a section and
   * its scope state appear together; nothing here invents structure of its own.
   */
  const planted: string[] = [];
  for (const directive of wanted) {
    const domainName = names.get(directive.domain) ?? directive.domain;
    if (findSection(record.bodyMarkdown.split("\n"), domainName, directive.section)) {
      continue;
    }
    if (planted.includes(directive.domain)) continue;
    const grown = await ensureReview(rootPath, {
      cadence: input.cadence,
      period: input.period,
      scope: directive.domain,
    });
    if (grown.ok) planted.push(directive.domain);
  }
  if (planted.length > 0) {
    const reread = await getReview(rootPath, input.cadence, input.period);
    if (reread.ok) record = reread.value;
  }

  const bounds = periodBounds(
    input.cadence,
    input.period,
    record.weekStartDay,
  );
  if (!bounds.ok) return bounds;

  const outcomes: ReviewSnapshotOutcome[] = skill.value.problems.map((problem, index) => ({
    id: `unparsed-${index + 1}`,
    domain: "",
    section: "",
    title: "Snapshot rule",
    status: "failed" as const,
    reason: problem,
  }));

  let body = record.bodyMarkdown;
  let applied = 0;
  for (const directive of wanted) {
    const domainName = names.get(directive.domain) ?? directive.domain;
    if (!findSection(body.split("\n"), domainName, directive.section)) {
      outcomes.push({
        id: directive.id,
        domain: directive.domain,
        section: directive.section,
        title: directive.title,
        status: "skipped",
        reason: `this review has no "${directive.section}" section under ${domainName}`,
      });
      continue;
    }
    const run = await runSnapshot(rootPath, directive, bounds.value);
    if (!run.ok) {
      outcomes.push({
        id: directive.id,
        domain: directive.domain,
        section: directive.section,
        title: directive.title,
        status: "failed",
        reason: run.error,
      });
      continue;
    }
    const rendered = renderSnapshotMarkdown(directive, run.value.run, {
      windowLabel:
        directive.window === "period"
          ? `${bounds.value.start} → ${bounds.value.end}`
          : "all time",
      buckets: run.value.blocks.map((b) => b.timeBucket),
      groups: run.value.blocks.map((b) => b.groupBy),
    });
    const upserted = upsertSnapshotBlock(body, directive, domainName, rendered.markdown);
    body = upserted.body;
    if (upserted.status === "skipped") {
      outcomes.push({
        id: directive.id,
        domain: directive.domain,
        section: directive.section,
        title: directive.title,
        status: "skipped",
        reason: upserted.reason,
      });
      continue;
    }
    if (upserted.status === "written") applied += 1;
    outcomes.push({
      id: directive.id,
      domain: directive.domain,
      section: directive.section,
      title: directive.title,
      status: upserted.status,
      groups: rendered.groups,
    });
  }

  const value = (bodyMarkdown: string): ReviewPrepopulateResult => ({
    cadence: input.cadence,
    period: input.period,
    scope: input.scope,
    outcomes,
    applied,
    planted,
    locked: false,
    bodyMarkdown,
  });

  if (applied === 0 && planted.length === 0) {
    return { ok: true, value: value(record.bodyMarkdown) };
  }

  const written = await writeReview(rootPath, {
    cadence: input.cadence,
    period: input.period,
    bodyMarkdown: body,
    actor: input.actor,
  });
  if (!written.ok) return written;
  return { ok: true, value: value(written.value.bodyMarkdown) };
}

/**
 * One directive's read. A `period` directive has its window rewritten to the
 * review's own bounds — at the root and on every block that reads a date — so
 * the same shipped rule is a day's spending in a daily review and a year's in a
 * yearly one, with no per-cadence copy of the spec.
 */
async function runSnapshot(
  rootPath: string,
  directive: ReviewSnapshotDirective,
  bounds: { start: string; end: string },
): Promise<Result<{ run: ComposedViewRunResult; blocks: ViewBlockSpec[] }>> {
  const spec = directive.spec as Omit<ViewSpec, "schemaVersion">;
  const windowed =
    directive.window === "period"
      ? ({ kind: "custom", start: bounds.start, end: bounds.end } as const)
      : null;
  const next: Omit<ViewSpec, "schemaVersion"> = {
    ...spec,
    ...(windowed ? { timeWindow: windowed } : {}),
    ...(spec.blocks
      ? {
          blocks: spec.blocks.map((b) =>
            windowed && b.timeColumnId ? { ...b, timeWindow: windowed } : b,
          ),
        }
      : {}),
  };
  const resolved = { ...next, schemaVersion: 1 } as ViewSpec;
  const run = await runViewBlocks(rootPath, directive.domain, resolved);
  if (!run.ok) return run;
  // The blocks as the runner saw them, so the markdown's own headings can be
  // as honest as the card's: a weekly bucket is headed "Week", not "Group".
  return { ok: true, value: { run: run.value, blocks: resolveViewBlocks(resolved) } };
}
