import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  AREA_SEEDS,
  BASE_AREA_SLUG,
  COMPANION_ACTOR,
  confirmOnboarding,
  createVault,
  discardOnboardingProposal,
  getDocument,
  listDatabases,
  listDomains,
  listPages,
  readLog,
  readOnboardingProposal,
  readOnboardingRecord,
  startOnboarding,
  unlockDomain,
  writeOnboardingProposal,
} from "@lifequest/vault-core";

/**
 * P1: the onboarding record, the proposal and the one confirmed batch.
 *
 * This rig runs the engine half against a real vault on disk — no window, no
 * fixture objects. It holds the contract the dock and the companion both read:
 *
 *  1. A new vault is `not_started`; a vault with no onboarding file (every
 *     existing vault) and a vault with a corrupt one read as `completed`, and
 *     reading never creates the file.
 *  2. `startOnboarding` is idempotent and logs `onboarding.started` once.
 *  3. The proposal validator is the gate, not the prompt: 1–3 *locked seeded*
 *     areas, all four doctrine bodies each, at most one table inside one of the
 *     proposed areas, one required note. Rejections write nothing.
 *  4. Confirming applies the batch — unlocks (flag flips only), doctrine bodies
 *     with the companion as author, one table, one note page, `domain.unlocked`
 *     per area and a single `onboarding.completed` — then marks the record
 *     complete, deletes the proposal and refuses a second confirm.
 *  5. The card's unticked lines are honoured: a doctrine kind, the table and the
 *     note can each be left out, and the record still completes.
 *
 * The artifact is `e2e/artifacts/onboarding-engine.json`.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(desktopRoot, "e2e/artifacts/onboarding-engine.json");

type Check = { label: string; pass: boolean; detail: string | null };
const checks: Check[] = [];

function check(label: string, pass: boolean, detail: unknown = null): void {
  checks.push({
    label,
    pass,
    detail: detail === null ? null : String(detail),
  });
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function onboardingPath(root: string): string {
  return path.join(root, ".lifequest", "onboarding.json");
}

function proposalPath(root: string): string {
  return path.join(root, ".lifequest", "onboarding-proposal.json");
}

function domainMeta(root: string, slug: string): Record<string, unknown> {
  return readJson(path.join(root, "domains", slug, "domain.json")) as Record<
    string,
    unknown
  >;
}

type ProposalArea = { slug: string; doctrine: Record<string, string> };

const DOCTRINE = {
  premise: "I am someone who needs sleep to think straight.",
  what: "A week where I wake without an alarm.",
  why: "Because the work I care about needs a rested head.",
  how: "Lights out by 22:30 on weekdays.",
};

function area(slug: string): ProposalArea {
  return { slug, doctrine: { ...DOCTRINE } };
}

function goodProposal(areas: ProposalArea[] = [area("health"), area("business")]) {
  return {
    areas,
    table: {
      areaSlug: "health",
      name: "Sleep log",
      columns: [
        { name: "Night", type: "date" },
        { name: "Hours", type: "number" },
      ],
    },
    note: {
      title: "First conversation",
      body: "We talked about sleep, the work I want back, and what a rested week looks like.",
    },
  };
}

async function freshVault(prefix: string): Promise<string> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(workDir, "vault");
  const created = await createVault(root, "Onboarding engine rig");
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  return root;
}

describe("onboarding: one proposal, one confirmation, one completed record", () => {
  it("records, validates, confirms and refuses a second confirm", async () => {
    const root = await freshVault("lq-onboarding-engine-");

    // ── 1. a new vault starts not_started ────────────────────────────────
    const seeded = await readOnboardingRecord(root);
    check("a new vault is not_started", seeded.ok && seeded.value.status === "not_started", seeded.ok ? seeded.value.status : seeded.error);
    check(
      "the new vault wrote the record at creation",
      fs.existsSync(onboardingPath(root)),
      onboardingPath(root),
    );

    const started = await startOnboarding(root);
    check("start moves the record to in_progress", started.ok && started.value.status === "in_progress", started.ok ? started.value.status : started.error);
    check("start stamps startedAt", started.ok && typeof started.value.startedAt === "string", started.ok ? started.value.startedAt : started.error);
    const startedAgain = await startOnboarding(root);
    check("start is idempotent", startedAgain.ok && startedAgain.value.status === "in_progress", startedAgain.ok ? startedAgain.value.status : startedAgain.error);

    const afterStartLog = await readLog(root);
    const startedEvents = afterStartLog.ok
      ? afterStartLog.value.filter((e) => e.type === "onboarding.started")
      : [];
    check("onboarding.started is logged once", startedEvents.length === 1, startedEvents.length);

    // ── 2. the validator is the gate ─────────────────────────────────────
    const rejects = async (label: string, input: unknown): Promise<void> => {
      const res = await writeOnboardingProposal(root, input);
      check(label, res.ok === false, res.ok ? "accepted" : res.error);
    };

    await rejects("no areas is refused", { ...goodProposal([]), areas: [] });
    await rejects(
      "four areas is refused (the cap is three)",
      goodProposal([area("health"), area("mind"), area("financial"), area("business")]),
    );
    await rejects("the base Life area is refused", goodProposal([area(BASE_AREA_SLUG)]));
    await rejects("an unknown area is refused", goodProposal([area("intake")]));
    await rejects("a duplicate area is refused", goodProposal([area("health"), area("health")]));
    await rejects(
      "a missing doctrine kind is refused",
      goodProposal([
        {
          slug: "health",
          doctrine: { premise: DOCTRINE.premise, what: DOCTRINE.what, why: DOCTRINE.why },
        },
      ]),
    );
    await rejects(
      "an empty doctrine body is refused",
      goodProposal([{ slug: "health", doctrine: { ...DOCTRINE, how: "   " } }]),
    );
    await rejects("a note is required", { ...goodProposal([area("health")]), note: undefined });
    await rejects("an empty note is refused", {
      ...goodProposal([area("health")]),
      note: { title: "First conversation", body: "  " },
    });
    await rejects("a table outside the proposed areas is refused", {
      ...goodProposal([area("health")]),
      table: { areaSlug: "business", name: "Offers", columns: [{ name: "Name", type: "text" }] },
    });
    await rejects("a table with no columns is refused", {
      ...goodProposal(),
      table: { areaSlug: "health", name: "Sleep log", columns: [] },
    });
    await rejects("a relation column is refused in P1", {
      ...goodProposal(),
      table: {
        areaSlug: "health",
        name: "Sleep log",
        columns: [{ name: "Owner", type: "relation" }],
      },
    });

    const afterRejects = await readOnboardingProposal(root);
    check(
      "a refused proposal writes nothing",
      afterRejects.ok && afterRejects.value === null,
      afterRejects.ok ? afterRejects.value : afterRejects.error,
    );

    // ── 3. a locked-area rule uses the directory, not the hinge ──────────
    // Check it in its own vault: the main vault's Health must stay locked for
    // the batch below, and an unlocked area is not an interview area.
    const alreadyUnlockedRoot = await freshVault("lq-onboarding-unlocked-");
    const unlockedHealth = await unlockDomain(alreadyUnlockedRoot, "health");
    check("Health can be unlocked outside onboarding", unlockedHealth.ok === true, unlockedHealth.ok ? "" : unlockedHealth.error);
    const unlockedRejection = await writeOnboardingProposal(alreadyUnlockedRoot, goodProposal([area("health")]));
    check(
      "an already-unlocked area cannot be proposed",
      unlockedRejection.ok === false,
      unlockedRejection.ok ? "accepted" : unlockedRejection.error,
    );

    // ── 4. the good proposal lands and is readable ───────────────────────
    const written = await writeOnboardingProposal(root, goodProposal());
    check("the proposal is accepted", written.ok === true, written.ok ? "" : written.error);
    if (!written.ok) return;
    check("the proposal derives the area names from the seed", written.value.areas.map((a) => a.name).join(",") === "Health,Business", written.value.areas.map((a) => a.name));
    check("the proposal survives a re-read", fs.existsSync(proposalPath(root)), proposalPath(root));
    const snapshotProposal = await readOnboardingProposal(root);
    check(
      "readOnboardingProposal returns the written proposal",
      snapshotProposal.ok && snapshotProposal.value !== null && snapshotProposal.value.areas.length === 2,
      snapshotProposal.ok ? snapshotProposal.value?.areas.map((a) => a.slug) : snapshotProposal.error,
    );

    // ── 5. nothing is applied before the confirmation ────────────────────
    check("Health is still locked before confirming", domainMeta(root, "health").unlockedAt === null, domainMeta(root, "health").unlockedAt);
    check("Business is still locked before confirming", domainMeta(root, "business").unlockedAt === null, domainMeta(root, "business").unlockedAt);
    const preConfirmDocs = await listDomains(root);
    check("the areas are still there as locked seeds", preConfirmDocs.ok && preConfirmDocs.value.some((d) => d.slug === "health" && d.meta.unlockedAt === null), null);

    // ── 6. confirming applies the whole batch ────────────────────────────
    const confirmed = await confirmOnboarding(root);
    check("the confirm succeeds", confirmed.ok === true, confirmed.ok ? "" : confirmed.error);
    if (!confirmed.ok) return;
    check("the confirm reports both areas", confirmed.value.areas.join(",") === "health,business", confirmed.value.areas);
    check("the confirm reports the table", confirmed.value.table === true, confirmed.value.table);
    check("the confirm reports the note", confirmed.value.note === true, confirmed.value.note);

    check("Health is unlocked", typeof domainMeta(root, "health").unlockedAt === "string", domainMeta(root, "health").unlockedAt);
    check("Business is unlocked", typeof domainMeta(root, "business").unlockedAt === "string", domainMeta(root, "business").unlockedAt);
    check("Mind stays locked", domainMeta(root, "mind").unlockedAt === null, domainMeta(root, "mind").unlockedAt);

    for (const kind of ["premise", "what", "why", "how"] as const) {
      const doc = await getDocument(root, "health", kind);
      check(`Health ${kind} carries the operator's words`, doc.ok && doc.value.bodyMarkdown.trim().includes(DOCTRINE[kind].slice(0, 12)), doc.ok ? doc.value.bodyMarkdown.slice(0, 40) : doc.error);
    }
    const businessDoc = await getDocument(root, "business", "why");
    check("Business doctrine is drafted too", businessDoc.ok && businessDoc.value.bodyMarkdown.trim().length > 0, businessDoc.ok ? businessDoc.value.bodyMarkdown.slice(0, 40) : businessDoc.error);

    const databases = await listDatabases(root, "health");
    const sleepLog = databases.ok ? databases.value.find((entry) => entry.database.name === "Sleep log") : undefined;
    check("the one table is created in Health", sleepLog !== undefined, databases.ok ? databases.value.map((entry) => entry.database.name) : databases.error);
    check("the table carries both columns", sleepLog?.database.columns.length === 2, sleepLog?.database.columns.map((c) => `${c.name}:${c.type}`));

    const pages = await listPages(root, BASE_AREA_SLUG);
    const note = pages.ok ? pages.value.find((p) => p.page.title === "First conversation") : undefined;
    check("the interview note is a page in Life", note !== undefined, pages.ok ? pages.value.map((p) => p.page.title) : pages.error);
    const noteBlocks = note?.page.blocks.filter((b) => b.kind === "markdown") ?? [];
    check(
      "the note carries the words outside the transcript",
      noteBlocks.some((b) => b.kind === "markdown" && b.markdown.includes("rested week")),
      noteBlocks,
    );

    const record = await readOnboardingRecord(root);
    check("the record is completed", record.ok && record.value.status === "completed", record.ok ? record.value.status : record.error);
    check("completedAt is stamped", record.ok && typeof record.value.completedAt === "string", record.ok ? record.value.completedAt : record.error);
    check("the record lists the unlocked areas", record.ok && record.value.unlockedAreas.join(",") === "health,business", record.ok ? record.value.unlockedAreas : record.error);
    check("the proposal is gone after confirming", !fs.existsSync(proposalPath(root)), fs.existsSync(proposalPath(root)));

    const log = await readLog(root);
    const events = log.ok ? log.value : [];
    check(
      "each unlock is a domain.unlocked event",
      ["health", "business"].every((slug) => events.some((e) => e.type === "domain.unlocked" && e.domainSlug === slug)),
      events.filter((e) => e.type === "domain.unlocked").map((e) => e.domainSlug),
    );
    const completed = events.filter((e) => e.type === "onboarding.completed");
    check("one onboarding.completed event", completed.length === 1, completed.length);
    check(
      "the completed event carries the manifest",
      completed.length === 1 && JSON.stringify(completed[0]?.payload).includes("health"),
      completed[0]?.payload,
    );
    check(
      "doctrine writes are attributed to the companion",
      events.filter((e) => e.type === "document.updated" && e.actor?.type === "agent").length > 0,
      events.filter((e) => e.type === "document.updated").map((e) => e.actor?.name),
    );

    const second = await confirmOnboarding(root);
    check("a second confirm is refused", second.ok === false, second.ok ? "accepted" : second.error);
    const lateProposal = await writeOnboardingProposal(root, goodProposal([area("mind")]));
    check("a proposal after completion is refused", lateProposal.ok === false, lateProposal.ok ? "accepted" : lateProposal.error);

    // ── 7. the artifact ──────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const report = {
      pass: checks.every((c) => c.pass),
      vault: root,
      checks,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    const writtenReport = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")) as { pass: boolean; checks: Check[] };
    assert.equal(
      writtenReport.pass,
      true,
      `one or more checks failed: ${JSON.stringify(writtenReport.checks.filter((c) => !c.pass))}`,
    );
  });

  it("treats a missing or corrupt onboarding file as completed and never creates it", async () => {
    // Legacy vault: the file simply is not there.
    const legacy = await freshVault("lq-onboarding-legacy-");
    fs.rmSync(onboardingPath(legacy), { force: true });
    const legacyRead = await readOnboardingRecord(legacy);
    check("a missing file reads as completed", legacyRead.ok && legacyRead.value.status === "completed", legacyRead.ok ? legacyRead.value.status : legacyRead.error);
    check("reading does not create the file", !fs.existsSync(onboardingPath(legacy)), fs.existsSync(onboardingPath(legacy)));

    // Corrupt vault: the file is there but unreadable.
    const corrupt = await freshVault("lq-onboarding-corrupt-");
    fs.writeFileSync(onboardingPath(corrupt), "{ not json", "utf8");
    const corruptRead = await readOnboardingRecord(corrupt);
    check("a corrupt file reads as completed, never not_started", corruptRead.ok && corruptRead.value.status === "completed", corruptRead.ok ? corruptRead.value.status : corruptRead.error);

    // Malformed shape (valid JSON, wrong fields) is the same.
    const weird = await freshVault("lq-onboarding-weird-");
    fs.writeFileSync(onboardingPath(weird), JSON.stringify({ status: "banana" }), "utf8");
    const weirdRead = await readOnboardingRecord(weird);
    check("an unknown status reads as completed", weirdRead.ok && weirdRead.value.status === "completed", weirdRead.ok ? weirdRead.value.status : weirdRead.error);
  });

  it("honours the card's unticked lines: skip a doctrine kind, the table and the note", async () => {
    const root = await freshVault("lq-onboarding-slice-");
    await startOnboarding(root);
    const proposed = await writeOnboardingProposal(root, {
      areas: [area("health")],
      table: { areaSlug: "health", name: "Sleep log", columns: [{ name: "Hours", type: "number" }] },
      note: { title: "First conversation", body: "A short record." },
    });
    check("the sliced proposal is accepted", proposed.ok === true, proposed.ok ? "" : proposed.error);

    const skipped = await confirmOnboarding(root, {
      skipDoctrineKinds: ["how"],
      includeTable: false,
      includeNote: false,
    });
    check("the sliced confirm succeeds", skipped.ok === true, skipped.ok ? "" : skipped.error);
    if (!skipped.ok) return;
    check("the result reports no table", skipped.value.table === false, skipped.value.table);
    check("the result reports no note", skipped.value.note === false, skipped.value.note);
    check("Health still unlocks", typeof domainMeta(root, "health").unlockedAt === "string", domainMeta(root, "health").unlockedAt);

    const how = await getDocument(root, "health", "how");
    check("the skipped doctrine kind stays empty", how.ok && how.value.bodyMarkdown.trim() === "", how.ok ? how.value.bodyMarkdown : how.error);
    const what = await getDocument(root, "health", "what");
    check("the kept doctrine kinds are written", what.ok && what.value.bodyMarkdown.trim().length > 0, what.ok ? what.value.bodyMarkdown.slice(0, 40) : what.error);
    const dbs = await listDatabases(root, "health");
    check("no table is created when the line is unticked", dbs.ok && dbs.value.length === 0, dbs.ok ? dbs.value.map((entry) => entry.database.name) : dbs.error);
    const pages = await listPages(root, BASE_AREA_SLUG);
    check("no note is created when the line is unticked", pages.ok && pages.value.length === 0, pages.ok ? pages.value.map((p) => p.page.title) : pages.error);

    const record = await readOnboardingRecord(root);
    check("the record still completes", record.ok && record.value.status === "completed", record.ok ? record.value.status : record.error);

    assert.deepEqual(checks.filter((c) => !c.pass), [], "all checks must hold");
  });

  it("discards a proposal without unlocking or completing", async () => {
    const root = await freshVault("lq-onboarding-discard-");
    await startOnboarding(root);
    const proposed = await writeOnboardingProposal(root, goodProposal([area("mind")]));
    check("the discard proposal is accepted", proposed.ok === true, proposed.ok ? "" : proposed.error);
    const discarded = await discardOnboardingProposal(root);
    check("discard succeeds", discarded.ok === true, discarded.ok ? "" : discarded.error);
    check("the proposal file is gone", !fs.existsSync(proposalPath(root)), fs.existsSync(proposalPath(root)));
    const record = await readOnboardingRecord(root);
    check("discarding leaves the interview in progress", record.ok && record.value.status === "in_progress", record.ok ? record.value.status : record.error);
    check("discarding unlocks nothing", domainMeta(root, "mind").unlockedAt === null, domainMeta(root, "mind").unlockedAt);
    const confirmedWithNothing = await confirmOnboarding(root);
    check("confirm with no proposal is refused", confirmedWithNothing.ok === false, confirmedWithNothing.ok ? "accepted" : confirmedWithNothing.error);
  });
});
