import {
  ensurePlanningStub,
  ensureReview,
  getPeriodPack,
  getReviewAreaChecklist,
  getReviewNotebook,
  getReviewPageTemplate,
  getReviewSkill,
  openVault,
  periodTitle,
  setPlanningSessionId,
  setReviewSessionId,
  type PeriodPack,
  type Result,
  type ReviewCadence,
  type ReviewPageSummary,
  type ReviewRecord,
  type VaultSnapshot,
  type WeekStartDay,
} from "@lifequest/vault-core";
import type { HermesSession } from "./companion-client.js";

export type BoundSessionKind = "review" | "plan";

export type BoundSessionRef = {
  kind: BoundSessionKind;
  cadence: ReviewCadence;
  period: string;
  scope: string;
};

export type BoundSessionResult = {
  sessionId: string;
  created: boolean;
  kickoff: string;
  /**
   * The chat's own row, exactly as the gateway made it.
   *
   * The renderer's chat store reads the session list once and then only after a
   * turn settles, so an id alone leaves a chat this page created out of the
   * sidebar for the whole interview. The row travels back with the id for the
   * same reason every other page-started chat hands the dock the row it created:
   * the tab and the Chats list wear its name from the first paint.
   */
  session: HermesSession;
};

export type CompanionSessionFns = {
  /**
   * Bring the agent up, or name why it cannot be. Absent in a test that has no
   * gateway to reach; present in the app, where a session cannot be created
   * without one and the failure has to read like something the operator can act
   * on rather than like `fetch failed`.
   */
  open?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  list: () => Promise<
    { ok: true; value: HermesSession[] } | { ok: false; error: string }
  >;
  create: (
    title: string,
  ) => Promise<
    { ok: true; value: HermesSession } | { ok: false; error: string }
  >;
};

const CADENCE_LABEL: Record<ReviewCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export function resolveBoundSession(
  storedId: string | null | undefined,
  listed: Array<{ id: string }>,
): "reuse" | "create" {
  if (storedId && listed.some((s) => s.id === storedId)) return "reuse";
  return "create";
}

function periodClause(
  cadence: ReviewCadence,
  period: string,
  weekStartDay: WeekStartDay,
): string {
  const title = periodTitle(cadence, period, weekStartDay);
  const prefix = `${CADENCE_LABEL[cadence]} review · `;
  if (title.startsWith(prefix)) return title.slice(prefix.length);
  // A week's title leads with its number — `W46 Review: 9-15 Nov '26` — so the
  // clause is the span after the `W46 Review: ` head.
  const weekHead = /^W\d{1,2} Review: /.exec(title);
  return weekHead ? title.slice(weekHead[0].length) : title;
}

function scopeSuffix(scope: "overall" | string, domainName?: string | null): string {
  if (scope === "overall") return "";
  const name = (domainName ?? scope).trim();
  return name ? ` (${name})` : "";
}

export function boundSessionTitle(input: {
  kind: BoundSessionKind;
  cadence: ReviewCadence;
  period: string;
  scope: "overall" | string;
  domainName?: string | null;
  weekStartDay: WeekStartDay;
}): string {
  const cadenceWord = CADENCE_LABEL[input.cadence];
  const clause = periodClause(input.cadence, input.period, input.weekStartDay);
  const head = input.kind === "review" ? "Review" : "Plan";
  if (input.scope !== "overall") {
    const name = (input.domainName ?? input.scope).trim() || input.scope;
    return `${head} · ${cadenceWord} · ${name} · ${clause}`;
  }
  return `${head} · ${cadenceWord} · ${clause}`;
}

/** The bound page's contract extras, quoted for a session that must keep them. */
function templateClause(extras: readonly string[] | undefined): string {
  if (!extras || extras.length === 0) {
    return " This area has no page template, so its page carries the four common headings only.";
  }
  const quoted = extras.map((extra) => `"${extra}"`).join(", ");
  return ` This area's page template names its own sections ${quoted}; keep them, in that order, after the four common headings.`;
}

/** Every page of the notebook, named so the life review can read each one first. */
function notebookPagesClause(pages: readonly ReviewPageSummary[] | undefined): string {
  if (!pages || pages.length === 0) return "";
  const named = pages
    .map((page) => `${page.title} (${page.scope}, ${page.status})`)
    .join("; ");
  return ` The notebook's pages: ${named}.`;
}

export function boundKickoff(input: {
  kind: BoundSessionKind;
  cadence: ReviewCadence;
  period: string;
  scope: "overall" | string;
  domainName?: string | null;
  weekStartDay: WeekStartDay;
  /**
   * How many live area reviews this period has, when the caller resolved the
   * checklist. The life review's kickoff names the count so the companion knows
   * it is summarising N sections rather than one.
   */
  areaCount?: number | null;
  /** The bound area's template extras, in template order. */
  templateExtras?: readonly string[];
  /** Every page in the notebook, for the life review's cross-page synthesis. */
  pages?: readonly ReviewPageSummary[];
}): string {
  const title = periodTitle(input.cadence, input.period, input.weekStartDay);
  const suffix = scopeSuffix(input.scope, input.domainName);
  if (input.kind !== "review") {
    return `Let's plan ${title}${suffix}. Previous period's review is in your instructions (or noted missing/draft). Ask what to focus on. Do not write a plan file yet.`;
  }
  // The cadence's skill fills the figures; both cadences read them the same way.
  const figures =
    "Read your page with get_review (pass this scope) — the app has already filled in the figures this cadence's skill asks for, inside `<!-- lifequest:snapshot -->` markers, so work from those numbers rather than fetching them again. Use get_period_pack for the period's own days.";
  if (input.cadence === "daily") {
    // One general review of the day: the daily cadence has no area scopes, and
    // a kickoff that implied them would send the companion looking for sections
    // the page never renders.
    return `Let's assemble the ${title}${suffix}. This is one general review of the day as a whole — the daily review has no area sections, so write the overall sections only. Interview me through look-back, keep, change, and next-period intent. ${figures} When the report is ready, propose marking this review complete with mark_review_done.`;
  }
  if (input.scope === "overall") {
    // The life review is the summary pass: it reads every area's page and
    // speaks across them, so its kickoff is not the generic one.
    const count =
      typeof input.areaCount === "number" && input.areaCount > 0
        ? ` (${input.areaCount} areas)`
        : "";
    return `Let's assemble the ${title}${suffix}. This is the whole-life review: every area review for this period is complete${count}. Read every area page with get_review first (one call per area scope).${notebookPagesClause(input.pages)} The overall page has no area sections: synthesise the area pages under the four common headings — Look-back, Keep, Change, Next-period intent — without copying an area's own extra sections, and never rewrite an area page. Write the overall page only (get_review with scope "overall", then write_review with that scope and its rev), synthesising from the areas rather than repeating a single one. Interview me through the four overall headings. ${figures} When the report is ready, propose marking this review complete with mark_review_done.`;
  }
  const name = (input.domainName ?? input.scope).trim() || input.scope;
  return `Let's assemble the ${title}${suffix}. This is the ${name} review — this period's part of the life review. Your page is get_review with scope "${input.scope}" → write_review with the same scope, the page body (one # title, the four common ## headings, and this area's own sections) and the rev it returned.${templateClause(input.templateExtras)} Leave every other page alone. Interview me through the four common headings and this area's own sections. ${figures} When this area's report is ready, propose marking the ${name} review complete with mark_review_done.`;
}

export function findBoundSession(
  snapshot: Pick<VaultSnapshot, "reviews" | "planning">,
  sessionId: string,
): BoundSessionRef | null {
  for (const entry of snapshot.reviews) {
    for (const [scope, state] of Object.entries(entry.scopes)) {
      if (state.sessionId === sessionId) {
        return {
          kind: "review",
          cadence: entry.cadence,
          period: entry.period,
          scope,
        };
      }
    }
  }
  for (const entry of snapshot.planning) {
    for (const [scope, state] of Object.entries(entry.scopes)) {
      if (state.sessionId === sessionId) {
        return {
          kind: "plan",
          cadence: entry.cadence,
          period: entry.period,
          scope,
        };
      }
    }
  }
  return null;
}

/**
 * The one line that tells the companion which slice of the review file it is
 * writing. It is omitted when the caller does not name a scope, so the two
 * older callers (and their tests) keep the exact context they had.
 */
function reviewScopeLine(input: {
  cadence?: ReviewCadence;
  scope?: "overall" | string;
  domainName?: string | null;
  pack: Result<PeriodPack>;
}): string | null {
  if (input.scope === undefined) return null;
  const cadence = input.cadence ?? (input.pack.ok ? input.pack.value.cadence : undefined);
  if (cadence === "daily") {
    return "Review scope: the day as a whole — the daily review has no area sections; do not create any.";
  }
  if (input.scope === "overall") {
    return "Review scope: the whole life — the overall page. Every area page for this period is complete: read each one with get_review (pass its scope) and synthesise across them rather than repeating a single area.";
  }
  const name = (input.domainName ?? input.scope).trim() || input.scope;
  return `Review scope: the ${name} area page — call get_review with scope "${input.scope}", then write_review with that scope and its rev; leave every other section and area alone.`;
}

/**
 * What a bound session is told before its first turn.
 *
 * The cadence's own skill file is carried verbatim and ahead of everything else,
 * because it is the operator's standing instruction for this kind of session
 * rather than data about it: the period pack is what the period held, and this
 * is what to do with it. A session that has to rediscover "always ask about
 * sleep" every week is a session that will not ask.
 */
export function formatReviewContext(input: {
  kind: BoundSessionKind;
  pack: Result<PeriodPack>;
  skill?: { markdown: string; problems: string[] } | null;
  /** The bound scope, when the caller knows it: "overall" or a domain slug. */
  scope?: "overall" | string;
  /** The scope's display name, for the `## <Name>` section line. */
  domainName?: string | null;
  /** The bound cadence. Optional because the pack carries it when the pack
   * read succeeded; daily needs it to describe itself as the day as a whole.
   */
  cadence?: ReviewCadence;
  /** The bound area's page template extras, in template order. */
  templateExtras?: readonly string[];
  /** Every page of the notebook, for the overall page's cross-page contract. */
  pages?: readonly ReviewPageSummary[];
}): string {
  const lines = [`Bound session kind: ${input.kind}`];
  if (input.kind === "review" && input.skill) {
    lines.push(
      "Standing rules for this cadence, written by the operator. Follow them; they outrank your own habits:",
      "--- REVIEW SKILL (the operator's own standing rules) ---",
      input.skill.markdown.trim(),
      "--- END REVIEW SKILL ---",
    );
    if (input.skill.problems.length > 0) {
      lines.push(
        `Snapshot rules that did not parse and were NOT run: ${input.skill.problems.join("; ")}`,
      );
    }
    lines.push(
      "Figures the app already filled in sit inside `<!-- lifequest:snapshot -->` markers in the review file. Refresh them rather than duplicating them, and leave the markers in place: they are how the next Start finds the block.",
    );
  }
  if (input.kind === "review") {
    const scopeLine = reviewScopeLine(input);
    if (scopeLine) lines.push(scopeLine);
  }
  lines.push(
    "Page contract: every page needs the four common ## headings — Look-back, Keep, Change, Next-period intent. A live area's page template names that area's own sections as extra ## headings: they come after the four, and the page keeps them in template order. The overall page has no area sections: synthesise the area pages under the four common headings without copying an area's extras, and never rewrite an area page.",
  );
  if (input.kind === "review") {
    const cadence = input.cadence ?? (input.pack.ok ? input.pack.value.cadence : undefined);
    if (cadence !== "daily" && input.scope !== undefined && input.scope !== "overall") {
      lines.push(
        input.templateExtras && input.templateExtras.length > 0
          ? `This page's area sections, in template order: ${input.templateExtras.map((extra) => `"${extra}"`).join(", ")}. Keep them after the four common headings.`
          : "This area has no page template: its page carries only the four common headings unless you add a section of the area's own.",
      );
    }
    if (input.scope === "overall" && input.pages && input.pages.length > 0) {
      const named = input.pages
        .map((page) => `${page.title} (${page.scope}, ${page.status})`)
        .join("; ");
      lines.push(
        `Pages in this notebook: ${named}. Read every area page with get_review before you synthesise them on the overall page.`,
      );
    }
  }
  lines.push(
    "If write_review answers CONFLICT, the file moved under you: read your page again with get_review and re-apply your section — never resend the body you already had.",
  );
  if (input.kind === "review") {
    lines.push(
      "A review starts by re-deriving the companion brief from what this period held, with set_companion_brief: typed, sourced, expiring items — at most five — so the Dashboard's brief is current before the session goes deep. Read get_companion_brief first when you need to see what the operator dismissed or let lapse.",
    );
    lines.push("When the report is ready, propose mark_review_done.");
  } else {
    lines.push("Do not write a plan file yet.");
  }
  if (input.pack.ok) {
    lines.push(JSON.stringify(input.pack.value));
  } else {
    lines.push(
      JSON.stringify({
        missingSources: [] as string[],
        error: input.pack.error,
      }),
    );
  }
  return lines.join("\n");
}

/**
 * The page-contract facts a session's prompts quote: the bound area's template
 * extras, and — for the overall page — every page of the notebook. A failed read
 * is an empty contract, not a failed session: the prompt then simply makes no
 * claim the engine cannot back.
 */
async function resolvePageContract(
  root: string,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string },
): Promise<{ templateExtras: string[]; pages: ReviewPageSummary[] }> {
  const templateExtras: string[] = [];
  const pages: ReviewPageSummary[] = [];
  if (input.cadence === "daily") return { templateExtras, pages };
  if (input.scope === "overall") {
    const notebook = await getReviewNotebook(root, input.cadence, input.period);
    if (notebook.ok) pages.push(...notebook.value.pages);
    return { templateExtras, pages };
  }
  const template = await getReviewPageTemplate(root, input.scope);
  if (template.ok) templateExtras.push(...template.value.extras);
  return { templateExtras, pages };
}

async function resolveDomainName(
  root: string,
  scope: "overall" | string,
): Promise<{ weekStartDay: WeekStartDay; domainName: string | null }> {
  const snap = await openVault(root);
  if (!snap.ok) {
    return { weekStartDay: "monday", domainName: scope === "overall" ? null : scope };
  }
  const domainName =
    scope === "overall"
      ? null
      : (snap.value.domains.find((d) => d.slug === scope)?.meta.name ?? scope);
  return {
    weekStartDay: snap.value.settings.weekStartDay ?? "monday",
    domainName,
  };
}

async function startOrResumeBoundSession(
  root: string,
  kind: BoundSessionKind,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string },
  companion: CompanionSessionFns,
): Promise<Result<BoundSessionResult>> {
  const ensured =
    kind === "review"
      ? await ensureReview(root, input)
      : await ensurePlanningStub(root, input);
  if (!ensured.ok) return ensured;
  // A locked review is a finished report. Starting an interview on it would bind
  // a chat whose every write becomes a Decision against a document nobody
  // intends to change; the page hides Start for the same reason.
  if (kind === "review" && (ensured.value as ReviewRecord).locked) {
    return { ok: false, error: "This review is locked. Unlock it before starting another interview." };
  }

  // The document exists before the agent is asked for anything, so a gateway
  // that is down cannot take the review file down with it.
  if (companion.open) {
    const opened = await companion.open();
    if (!opened.ok) return opened;
  }

  const { weekStartDay, domainName } = await resolveDomainName(root, input.scope);
  const title = boundSessionTitle({
    kind,
    cadence: input.cadence,
    period: input.period,
    scope: input.scope,
    domainName,
    weekStartDay,
  });
  // The life review summarises the area reviews, so its kickoff names how many
  // sections it is summarising. A checklist failure is not fatal to starting —
  // the kickoff simply omits the count rather than taking the session down.
  let areaCount: number | null = null;
  if (kind === "review" && input.cadence !== "daily" && input.scope === "overall") {
    const checklist = await getReviewAreaChecklist(root, input.cadence, input.period);
    if (checklist.ok) areaCount = checklist.value.total;
  }
  const contract =
    kind === "review"
      ? await resolvePageContract(root, input)
      : { templateExtras: [], pages: [] };
  const kickoff = boundKickoff({
    kind,
    cadence: input.cadence,
    period: input.period,
    scope: input.scope,
    domainName,
    weekStartDay,
    areaCount,
    templateExtras: contract.templateExtras,
    pages: contract.pages,
  });

  const storedId = ensured.value.scopes[input.scope]?.sessionId ?? null;
  const listed = await companion.list();
  if (!listed.ok) return listed;

  if (resolveBoundSession(storedId, listed.value) === "reuse" && storedId) {
    const reused = listed.value.find((session) => session.id === storedId);
    // An id the list named but did not carry is not a row the dock can show;
    // creating a fresh chat is the honest answer rather than a bare id.
    if (reused) {
      return {
        ok: true,
        value: { sessionId: storedId, created: false, kickoff, session: reused },
      };
    }
  }

  const created = await companion.create(title);
  if (!created.ok) return created;
  const sessionId = created.value.id;

  if (kind === "review") {
    await setReviewSessionId(root, {
      cadence: input.cadence,
      period: input.period,
      scope: input.scope,
      sessionId,
    });
  } else {
    await setPlanningSessionId(root, {
      cadence: input.cadence,
      period: input.period,
      scope: input.scope,
      sessionId,
    });
  }

  return {
    ok: true,
    value: { sessionId, created: true, kickoff, session: created.value },
  };
}

export async function startOrResumeReviewSession(
  root: string,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string },
  companion: CompanionSessionFns,
): Promise<Result<BoundSessionResult>> {
  return startOrResumeBoundSession(root, "review", input, companion);
}

export async function startOrResumePlanSession(
  root: string,
  input: { cadence: ReviewCadence; period: string; scope: "overall" | string },
  companion: CompanionSessionFns,
): Promise<Result<BoundSessionResult>> {
  return startOrResumeBoundSession(root, "plan", input, companion);
}

export async function buildBoundReviewContext(
  root: string,
  snapshot: Pick<VaultSnapshot, "reviews" | "planning">,
  sessionId: string,
): Promise<string | undefined> {
  const bound = findBoundSession(snapshot, sessionId);
  if (!bound) return undefined;
  const pack = await getPeriodPack(root, {
    cadence: bound.cadence,
    period: bound.period,
    scope: bound.scope,
  });
  if (bound.kind !== "review") {
    return formatReviewContext({ kind: bound.kind, pack });
  }
  const skill = await getReviewSkill(root, bound.cadence);
  // The context has to name the scope and its section the same way the kickoff
  // and the page do, so resolve the display name here rather than letting the
  // companion infer it from a slug.
  const { domainName } = await resolveDomainName(root, bound.scope);
  const contract = await resolvePageContract(root, {
    cadence: bound.cadence,
    period: bound.period,
    scope: bound.scope,
  });
  return formatReviewContext({
    kind: bound.kind,
    pack,
    skill: skill.ok
      ? { markdown: skill.value.markdown, problems: skill.value.problems }
      : null,
    scope: bound.scope,
    domainName,
    cadence: bound.cadence,
    templateExtras: contract.templateExtras,
    pages: contract.pages,
  });
}
