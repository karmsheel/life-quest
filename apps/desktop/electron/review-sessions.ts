import {
  ensurePlanningStub,
  ensureReview,
  getPeriodPack,
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
    return `Let's assemble the ${title}${suffix}. Interview me through look-back, keep, change, and next-period intent. Use get_period_pack and get_review. When the report is ready, propose marking this review complete.`;
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

export function formatReviewContext(input: {
  kind: BoundSessionKind;
  pack: Result<PeriodPack>;
}): string {
  const lines = [
    `Bound session kind: ${input.kind}`,
    "Skeleton rules: overall uses ## Look-back / ## Keep / ## Change / ## Next-period intent; domain sections use the same four ### headings.",
  ];
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
  return formatReviewContext({ kind: bound.kind, pack });
}
