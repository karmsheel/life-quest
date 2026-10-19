import {
  ensurePlanningStub,
  ensureReview,
  getPeriodPack,
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
}): string {
  const title = periodTitle(input.cadence, input.period, input.weekStartDay);
  const suffix = scopeSuffix(input.scope, input.domainName);
  if (input.kind === "review") {
    return `Let's assemble the ${title}${suffix}. Interview me through look-back, keep, change, and next-period intent. Read the review file with get_review first — the app has already filled in the figures this cadence's skill asks for, inside \`<!-- lifequest:snapshot -->\` markers, so work from those numbers rather than fetching them again. Use get_period_pack for the period's own days. When the report is ready, propose marking this review complete.`;
  }
  return `Let's plan ${title}${suffix}. Previous period's review is in your instructions (or noted missing/draft). Ask what to focus on. Do not write a plan file yet.`;
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
  lines.push(
    "Skeleton rules: overall uses ## Look-back / ## Keep / ## Change / ## Next-period intent; domain sections use the same four ### headings.",
  );
  if (input.kind === "review") {
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
  const kickoff = boundKickoff({
    kind,
    cadence: input.cadence,
    period: input.period,
    scope: input.scope,
    domainName,
    weekStartDay,
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
  return formatReviewContext({
    kind: bound.kind,
    pack,
    skill: skill.ok
      ? { markdown: skill.value.markdown, problems: skill.value.problems }
      : null,
  });
}
