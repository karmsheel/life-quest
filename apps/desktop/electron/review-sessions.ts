import {
  ensurePlanningStub,
  ensureReview,
  getPeriodPack,
  getReviewAreaChecklist,
  getReviewSkill,
  openVault,
  periodTitle,
  setPlanningSessionId,
  setReviewSessionId,
  type PeriodPack,
  type Result,
  type ReviewCadence,
  type VaultSnapshot,
  type WeekStartDay,
} from "@lifequest/vault-core";

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
    { ok: true; value: Array<{ id: string }> } | { ok: false; error: string }
  >;
  create: (
    title: string,
  ) => Promise<
    | { ok: true; value: { id: string; title: string } }
    | { ok: false; error: string }
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
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
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
}): string {
  const title = periodTitle(input.cadence, input.period, input.weekStartDay);
  const suffix = scopeSuffix(input.scope, input.domainName);
  if (input.kind !== "review") {
    return `Let's plan ${title}${suffix}. Previous period's review is in your instructions (or noted missing/draft). Ask what to focus on. Do not write a plan file yet.`;
  }
  // The cadence's skill fills the figures; both cadences read them the same way.
  const figures =
    "Read the review file with get_review first — the app has already filled in the figures this cadence's skill asks for, inside `<!-- lifequest:snapshot -->` markers, so work from those numbers rather than fetching them again. Use get_period_pack for the period's own days.";
  if (input.cadence === "daily") {
    // One general review of the day: the daily cadence has no area scopes, and
    // a kickoff that implied them would send the companion looking for sections
    // the page never renders.
    return `Let's assemble the ${title}${suffix}. This is one general review of the day as a whole — the daily review has no area sections, so write the overall sections only. Interview me through look-back, keep, change, and next-period intent. ${figures} When the report is ready, propose marking this review complete with mark_review_done.`;
  }
  if (input.scope === "overall") {
    // The life review is the summary pass: it reads every area's section and
    // speaks across them, so its kickoff is not the generic one.
    const count =
      typeof input.areaCount === "number" && input.areaCount > 0
        ? ` (${input.areaCount} areas)`
        : "";
    return `Let's assemble the ${title}${suffix}. This is the whole-life review: every area review for this period is complete${count}. Read the file with get_review and go across each area's Look-back, Keep, Change and Next-period intent — what the areas say together, where they pull against each other, and what that means for the life vision. Write the overall sections only, synthesising from the areas rather than repeating a single one. Interview me through the four overall headings. ${figures} When the report is ready, propose marking this review complete with mark_review_done.`;
  }
  const name = (input.domainName ?? input.scope).trim() || input.scope;
  return `Let's assemble the ${title}${suffix}. This is the ${name} review — this period's part of the life review. Write into the ## ${name} section only and leave the other sections alone. Interview me through the four ### headings for this area. ${figures} When this area's report is ready, propose marking the ${name} review complete with mark_review_done.`;
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
    return "Review scope: the whole life — the overall review. The area sections in this file are complete: read every one and synthesise across them rather than repeating a single area.";
  }
  const name = (input.domainName ?? input.scope).trim() || input.scope;
  return `Review scope: the ${name} area — write only the ## ${name} section and leave the other sections alone.`;
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
  /**
   * The bound cadence. Optional because the pack carries it when the pack
   * read succeeded; daily needs it to describe itself as the day as a whole.
   */
  cadence?: ReviewCadence;
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
    "Skeleton rules: overall uses ## Look-back / ## Keep / ## Change / ## Next-period intent; domain sections use the same four ### headings.",
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
  const kickoff = boundKickoff({
    kind,
    cadence: input.cadence,
    period: input.period,
    scope: input.scope,
    domainName,
    weekStartDay,
    areaCount,
  });

  const storedId = ensured.value.scopes[input.scope]?.sessionId ?? null;
  const listed = await companion.list();
  if (!listed.ok) return listed;

  if (resolveBoundSession(storedId, listed.value) === "reuse" && storedId) {
    return { ok: true, value: { sessionId: storedId, created: false, kickoff } };
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

  return { ok: true, value: { sessionId, created: true, kickoff } };
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
  return formatReviewContext({
    kind: bound.kind,
    pack,
    skill: skill.ok
      ? { markdown: skill.value.markdown, problems: skill.value.problems }
      : null,
    scope: bound.scope,
    domainName,
    cadence: bound.cadence,
  });
}
