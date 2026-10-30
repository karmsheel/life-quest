import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  USER_ACTOR,
  amendDecision,
  createDecision,
  createVault,
  listDecisions,
  parseFrontmatter,
  readLog,
  resolveDecision,
  vaultPaths,
  type DecisionRecord,
  type LifeEvent,
} from "@lifequest/vault-core";
import { executeTool } from "../electron/map-tools.ts";

/**
 * Amend then approve, end to end, against a real vault on disk.
 *
 * The operator's inbox edit is the whole product path: a companion files a
 * pending Decision through the same `create_project` MCP tool the companion
 * calls, the operator amends it with the same `amendDecision` the
 * `decision:amend` IPC handler calls, and approving it runs the same
 * `resolveDecision` the Approve button calls. Every claim below is asserted
 * against the real `.lifequest/decisions/<id>.json` file, the real project file
 * the approval writes, and the real Life log — not against a mock.
 *
 * It runs under `node --experimental-strip-types --test` from `apps/desktop`,
 * so it needs no Electron and no dev server: vault-core is plain Node.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The amendment is written but the record still says pending with the
 *     agent's spelling, or the display title and the body title disagree.
 *  2. The first amendment overwrites `previousBodyMarkdown` instead of keeping
 *     the agent's proposal in `originalProposed*`, so the inbox cannot show or
 *     restore what was actually proposed.
 *  3. The edit is not logged, is logged twice, or is logged without the note.
 *  4. Approval applies the agent's original proposal, not the edited one, or the
 *     project file is written with the typo.
 *  5. A second edit replaces `originalProposed*` with the first edit, so
 *     `revert` restores the operator's own first attempt rather than the agent's
 *     proposal.
 *  6. An answered Decision can be amended after the fact, changing what the
 *     operator approved out from under the applied file.
 *  7. `revert` leaves a stale amendment flag, or refuses a Decision that was
 *     never amended with the wrong answer.
 *  8. A body that can never parse is accepted, so the operator approves a
 *     Decision that cannot apply.
 *  9. The exact-proposal editor can retarget an edit: changing `id`, `type`, or
 *     `op` inside the JSON changes what the Decision applies to while its target
 *     file stays the old one.
 * 10. A terminal apply failure on an edited proposal still flips the Decision to
 *     rejected, destroying the record the operator was in the middle of fixing.
 *     The unedited behaviour (KAR-64) must keep flipping to rejected.
 * 11. A title-only edit does not move the title into the body where approval
 *     reads it, or a body-first edit does not derive the display title.
 * 12. Prose targets (doctrine/library) are forced through JSON and their edit is
 *     refused, or a prose body is JSON-stringified on the way to disk.
 * 13. `list_decisions` hides whether a proposal was edited, so an agent cannot
 *     tell what the operator actually approved.
 * 14. The artifact is written by a failing run. Failures throw, so the artifact
 *     only exists for a run that held.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT = path.join(
  desktopRoot,
  "e2e/artifacts/decision-amend-engine.json",
);

const COMPANION = { type: "agent" as const, id: "companion", name: "Hermes" };
/** A paired agent's read grant, used for the MCP `list_decisions` claim. */
const READ_GRANT = {
  agentId: "qa-e2e",
  name: "QA E2E agent",
  access: "read" as const,
  domainSlugs: ["financial"],
  schedule: false,
};

type Check = { claim: string; pass: boolean; facts: Record<string, unknown> };

const roots: string[] = [];

async function freshVault(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `lifequest-amend-${label}-`));
  roots.push(root);
  const created = await createVault(root, "Decision amend E2E");
  assert.equal(created.ok, true, created.ok ? "" : `createVault failed: ${created.error}`);
  return root;
}

/** A moment's pause, so two amendedAt stamps can differ at millisecond grain. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

async function readDecisions(root: string): Promise<DecisionRecord[]> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
  return listed.ok ? listed.value : [];
}

async function getDecision(root: string, id: string): Promise<DecisionRecord> {
  const all = await readDecisions(root);
  const found = all.find((decision) => decision.id === id);
  assert.ok(found, `Decision ${id} is not in the inbox list`);
  return found;
}

async function readEvents(root: string): Promise<LifeEvent[]> {
  const log = await readLog(root);
  assert.equal(log.ok, true, log.ok ? "" : log.error);
  return log.ok ? log.value : [];
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
}

/** File a project createProject Decision the way the companion's tool does. */
async function fileProject(
  root: string,
  title: string,
  summary: string,
  domainSlug = "financial",
): Promise<DecisionRecord> {
  const result = (await executeTool(
    root,
    null,
    "create_project",
    { title, summary, domainSlug },
    COMPANION,
  )) as { decisionId?: string; status?: string; error?: unknown };
  assert.ok(
    result.decisionId,
    `the companion's create_project filed no Decision: ${JSON.stringify(result)}`,
  );
  assert.equal(result.status, "pending", "a filed proposal must start pending");
  return getDecision(root, result.decisionId!);
}

/** File a database Decision whose body parses but whose apply path fails terminally. */
async function fileTerminallyFailingDatabaseDecision(
  root: string,
): Promise<{ decision: DecisionRecord; body: Record<string, unknown> }> {
  const body = {
    op: "add-column",
    databaseName: "Missing",
    rowLabel: null,
    previousCells: null,
    cells: null,
    expectedUpdatedAt: null,
    name: "X",
    type: "bogus",
  };
  const filed = await createDecision(root, {
    target: { type: "database", domainSlug: "financial", databaseId: "missing-db" },
    proposedTitle: "Add a bogus column",
    proposedBodyMarkdown: JSON.stringify(body),
    actor: COMPANION,
  });
  assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
  return { decision: filed.ok ? filed.value : (undefined as unknown as DecisionRecord), body };
}

/**
 * Assert an amendment is refused AND that it wrote nothing: the record file is
 * byte-identical afterwards. A refusal that still rewrites the file would be a
 * silent change the operator never asked for.
 */
async function expectAmendRefused(
  root: string,
  id: string,
  input: Parameters<typeof amendDecision>[2],
  errorPattern: RegExp,
): Promise<string> {
  const filePath = vaultPaths(root).decisionJson(id);
  const before = await fs.readFile(filePath, "utf8");
  const amended = await amendDecision(root, id, input);
  assert.equal(amended.ok, false, `the amendment was accepted but should have been refused`);
  const error = amended.ok ? "" : amended.error;
  assert.match(error, errorPattern);
  assert.equal(
    await fs.readFile(filePath, "utf8"),
    before,
    "a refused amendment rewrote the Decision file",
  );
  return error;
}

describe("amend then approve, end to end", () => {
  it("edits a pending Decision in place, applies the edited version, and refuses unsafe edits", async () => {
    const claims: Check[] = [];
    const record = (claim: string, facts: Record<string, unknown>): void => {
      claims.push({ claim, pass: true, facts });
    };

    const root = await freshVault("main");
    const paths = vaultPaths(root);

    // ── Claim 1: the operator's edit is stored on the pending record, the
    //    agent's proposal is preserved, and the act is logged and on disk. ────
    const p1 = await fileProject(root, "Buid a garden deck", "Outdoor build");
    assert.equal(p1.status, "pending");
    assert.equal(p1.actor.type, "agent", "the proposal must be the companion's, not the operator's");
    assert.equal(p1.proposedTitle, "Buid a garden deck");
    const p1AgentBody = p1.proposedBodyMarkdown;
    const p1AgentBodyParsed = JSON.parse(p1AgentBody) as Record<string, unknown>;
    assert.equal(p1AgentBodyParsed.title, "Buid a garden deck");

    const editedP1Body = {
      ...p1AgentBodyParsed,
      title: "Build a garden deck",
      summary: "Outdoor build, cedar frame",
      bodyMarkdown: "Cedar frame, two planters, sealed.",
    };
    const amended1 = await amendDecision(root, p1.id, {
      proposedTitle: "Build a garden deck",
      proposedBodyMarkdown: JSON.stringify(editedP1Body),
      note: "Fix the spelling",
    });
    assert.equal(amended1.ok, true, amended1.ok ? "" : amended1.error);
    if (!amended1.ok) return;
    const p1AfterAmend = amended1.value;

    assert.equal(p1AfterAmend.status, "pending", "an amended Decision must stay pending");
    assert.equal(p1AfterAmend.proposedTitle, "Build a garden deck");
    assert.deepEqual(JSON.parse(p1AfterAmend.proposedBodyMarkdown), editedP1Body);
    assert.equal(p1AfterAmend.originalProposedTitle, "Buid a garden deck");
    assert.equal(p1AfterAmend.originalProposedBodyMarkdown, p1AgentBody);
    assert.ok(p1AfterAmend.amendedAt, "amendedAt must be stamped");
    assert.ok(!Number.isNaN(Date.parse(p1AfterAmend.amendedAt ?? "")));
    assert.deepEqual(p1AfterAmend.amendedBy, USER_ACTOR, "the operator is the amender");
    assert.equal(p1AfterAmend.amendmentNote, "Fix the spelling");
    assert.equal(
      p1AfterAmend.previousBodyMarkdown,
      p1.previousBodyMarkdown,
      "the amendment must not move the previous body",
    );
    assert.equal(p1AfterAmend.previousBodyMarkdown, null);

    const amendLogsAfterFirst = (await readEvents(root)).filter(
      (event) => event.type === "decision.amended",
    );
    assert.equal(amendLogsAfterFirst.length, 1, "exactly one amendment must be logged");
    const firstAmendLog = amendLogsAfterFirst[0]!;
    assert.match(firstAmendLog.summary, /^Amended decision: /);
    assert.deepEqual(firstAmendLog.actor, USER_ACTOR);
    assert.equal((firstAmendLog.payload as { id?: string } | null)?.id, p1.id);
    assert.equal((firstAmendLog.payload as { note?: string } | null)?.note, "Fix the spelling");

    const p1Stored = await readJsonFile(paths.decisionJson(p1.id));
    assert.deepEqual(p1Stored, p1AfterAmend, "the file on disk is not the amended record");
    record(
      "1. A pending project proposal is amended in place: edited title/body, agent's original preserved, operator stamped, note stored, previous body untouched, one decision.amended logged, and the same record is on disk.",
      {
        decisionId: p1.id,
        agentTitle: "Buid a garden deck",
        amendedTitle: p1AfterAmend.proposedTitle,
        originalProposedTitle: p1AfterAmend.originalProposedTitle,
        originalProposedBodyMarkdown: p1AfterAmend.originalProposedBodyMarkdown,
        amendedAt: p1AfterAmend.amendedAt,
        amendedBy: p1AfterAmend.amendedBy,
        amendmentNote: p1AfterAmend.amendmentNote,
        previousBodyMarkdown: p1AfterAmend.previousBodyMarkdown,
        amendLogCount: amendLogsAfterFirst.length,
        storedFile: `.lifequest/decisions/${p1.id}.json`,
      },
    );

    // ── Claim 2: approval applies the EDITED version, writes the project file,
    //    keeps the edited proposal on the Decision, and logs the resolution. ─
    const approved1 = await resolveDecision(root, p1.id, "approved");
    assert.equal(approved1.ok, true, approved1.ok ? "" : approved1.error);
    if (!approved1.ok) return;
    const p1Approved = approved1.value;
    assert.equal(p1Approved.status, "approved");
    assert.ok(p1Approved.resolvedAt, "an approved Decision must carry resolvedAt");
    assert.equal(p1Approved.proposedTitle, "Build a garden deck");
    assert.deepEqual(JSON.parse(p1Approved.proposedBodyMarkdown), editedP1Body);
    assert.equal(p1Approved.originalProposedTitle, "Buid a garden deck");

    assert.equal(p1.target.type, "project", "the filed Decision must target a project");
    const projectId = p1.target.type === "project" ? (p1.target.id ?? "") : "";
    assert.ok(projectId, "the project Decision carries no project id");

    const projectRaw = await fs.readFile(paths.projectMd(projectId), "utf8");
    const project = parseFrontmatter(projectRaw);
    assert.equal(project.data.title, "Build a garden deck", "the project file has the typo");
    assert.equal(project.data.summary, "Outdoor build, cedar frame");
    assert.match(project.body, /Cedar frame/, "the project file lost the added detail");

    const p1StoredAfterApprove = await readJsonFile(paths.decisionJson(p1.id));
    assert.equal(p1StoredAfterApprove.status, "approved");
    const resolvedLogs = (await readEvents(root)).filter(
      (event) =>
        event.type === "decision.resolved" &&
        (event.payload as { id?: string } | null)?.id === p1.id,
    );
    assert.equal(resolvedLogs.length, 1, "exactly one resolution must be logged");
    assert.equal(
      (resolvedLogs[0]!.payload as { resolution?: string } | null)?.resolution,
      "approved",
    );
    record(
      "2. Approving the amended Decision applies the edited proposal: the project file on disk carries the edited title and added detail, the Decision is approved and keeps the edit, and decision.resolved is logged.",
      {
        projectFile: `projects/${projectId}.md`,
        projectTitle: project.data.title,
        projectSummary: project.data.summary,
        projectBodyHasDetail: /Cedar frame/.test(project.body),
        decisionStatus: p1Approved.status,
        resolvedAt: p1Approved.resolvedAt,
        resolvedLogCount: resolvedLogs.length,
      },
    );

    // ── Claim 3: a second amendment before resolve keeps the agent's first
    //    proposal as the original; the operator's first edit is not promoted. ─
    const p2 = await fileProject(root, "Water the plants", "Keep them alive");
    const p2AgentBody = p2.proposedBodyMarkdown;
    const p2AgentBodyParsed = JSON.parse(p2AgentBody) as Record<string, unknown>;

    const p2FirstBody = { ...p2AgentBodyParsed, title: "Water all the plants" };
    const p2FirstAmend = await amendDecision(root, p2.id, {
      proposedTitle: "Water all the plants",
      proposedBodyMarkdown: JSON.stringify(p2FirstBody),
      note: "first edit",
    });
    assert.equal(p2FirstAmend.ok, true, p2FirstAmend.ok ? "" : p2FirstAmend.error);
    if (!p2FirstAmend.ok) return;

    await tick();
    const p2SecondBody = {
      ...p2FirstBody,
      title: "Water the plants daily",
      bodyMarkdown: "Check the soil first.",
    };
    const p2SecondAmend = await amendDecision(root, p2.id, {
      proposedTitle: "Water the plants daily",
      proposedBodyMarkdown: JSON.stringify(p2SecondBody),
      note: "second edit",
    });
    assert.equal(p2SecondAmend.ok, true, p2SecondAmend.ok ? "" : p2SecondAmend.error);
    if (!p2SecondAmend.ok) return;
    const p2AfterSecond = p2SecondAmend.value;
    assert.equal(p2AfterSecond.originalProposedTitle, "Water the plants");
    assert.equal(p2AfterSecond.originalProposedBodyMarkdown, p2AgentBody);
    assert.equal(p2AfterSecond.proposedTitle, "Water the plants daily");
    assert.equal(p2AfterSecond.amendmentNote, "second edit");
    assert.notEqual(
      p2AfterSecond.amendedAt,
      p2FirstAmend.value.amendedAt,
      "the second edit must move amendedAt",
    );
    record(
      "3. A second amendment before resolve edits the proposal again and does not overwrite originalProposedTitle/body: the agent's first proposal stays the original.",
      {
        decisionId: p2.id,
        agentTitle: "Water the plants",
        originalAfterFirst: p2FirstAmend.value.originalProposedTitle,
        originalAfterSecond: p2AfterSecond.originalProposedTitle,
        originalBodyAfterSecond: p2AfterSecond.originalProposedBodyMarkdown,
        proposedTitleAfterSecond: p2AfterSecond.proposedTitle,
        amendedAtFirst: p2FirstAmend.value.amendedAt,
        amendedAtSecond: p2AfterSecond.amendedAt,
      },
    );

    // ── Claim 5: unsafe amendments are refused and write nothing. ───────────
    const amendLogsBeforeRefusals = (await readEvents(root)).filter(
      (event) => event.type === "decision.amended",
    ).length;

    const invalidJsonError = await expectAmendRefused(
      root,
      p2.id,
      { proposedBodyMarkdown: "{ this is not json" },
      /valid JSON/,
    );
    const idChangeError = await expectAmendRefused(
      root,
      p2.id,
      { proposedBodyMarkdown: JSON.stringify({ ...p2SecondBody, id: "another-project" }) },
      /id cannot be changed/,
    );
    const typeChangeError = await expectAmendRefused(
      root,
      p2.id,
      { proposedBodyMarkdown: JSON.stringify({ ...p2SecondBody, type: "closeProject" }) },
      /type cannot be changed/,
    );
    const emptyTitleError = await expectAmendRefused(
      root,
      p2.id,
      { proposedTitle: "   " },
      /non-empty/,
    );
    assert.equal(
      (await readEvents(root)).filter((event) => event.type === "decision.amended").length,
      amendLogsBeforeRefusals,
      "a refused amendment must not log",
    );

    const db1Filed = await fileTerminallyFailingDatabaseDecision(root);
    const db1 = db1Filed.decision;
    const opChangeError = await expectAmendRefused(
      root,
      db1.id,
      { proposedBodyMarkdown: JSON.stringify({ ...db1Filed.body, op: "create-database" }) },
      /op cannot be changed/,
    );
    record(
      "5. An amendment with a non-JSON body on a JSON target is refused; changing id, type, or op inside a JSON body is refused; an empty/whitespace proposedTitle is refused. Each refusal leaves the Decision file byte-identical and logs nothing.",
      {
        invalidJsonError,
        idChangeError,
        typeChangeError,
        opChangeError,
        emptyTitleError,
        storedFileUnchanged: true,
        amendLogsUnchanged: true,
      },
    );

    // ── Claim 6: revert restores the agent's proposal and clears the edit;
    //    revert on a never-amended Decision is refused. ───────────────────────
    const amendedLogsBeforeRevert = (await readEvents(root)).filter(
      (event) => event.type === "decision.amended",
    ).length;
    const reverted = await amendDecision(root, p2.id, { revert: true });
    assert.equal(reverted.ok, true, reverted.ok ? "" : reverted.error);
    if (!reverted.ok) return;
    const p2Restored = reverted.value;
    assert.equal(p2Restored.proposedTitle, "Water the plants");
    assert.equal(p2Restored.proposedBodyMarkdown, p2AgentBody);
    assert.equal(p2Restored.originalProposedTitle, null);
    assert.equal(p2Restored.originalProposedBodyMarkdown, null);
    assert.equal(p2Restored.amendedAt, null);
    assert.equal(p2Restored.amendedBy, null);
    assert.equal(p2Restored.amendmentNote, null);
    assert.deepEqual(
      await readJsonFile(paths.decisionJson(p2.id)),
      p2Restored,
      "revert must write the restored record to disk",
    );
    const revertLogs = (await readEvents(root)).filter(
      (event) => event.type === "decision.amended",
    );
    assert.equal(revertLogs.length, amendedLogsBeforeRevert + 1);
    const revertLog = revertLogs[revertLogs.length - 1]!;
    assert.equal((revertLog.payload as { reverted?: boolean } | null)?.reverted, true);
    assert.match(revertLog.summary, /Restored the original proposal/);

    const neverAmendedRevertError = await expectAmendRefused(
      root,
      db1.id,
      { revert: true },
      /no original proposal to restore/,
    );
    record(
      "6. revert:true restores the agent's original title and body, clears amendedAt/amendedBy/amendmentNote and the originals, and writes the file; revert on a never-amended Decision is refused with \"no original proposal to restore\".",
      {
        decisionId: p2.id,
        restoredTitle: p2Restored.proposedTitle,
        restoredBodyMatchesAgent: p2Restored.proposedBodyMarkdown === p2AgentBody,
        clearedAmendFields: {
          amendedAt: p2Restored.amendedAt,
          amendedBy: p2Restored.amendedBy,
          amendmentNote: p2Restored.amendmentNote,
        },
        revertLogPayload: revertLog.payload,
        neverAmendedRevertError,
      },
    );

    // ── Claim 7: title derivation from the body, and prose targets. ──────────
    const p3 = await fileProject(root, "Buid a hedge", "Trim the border");
    const p3AgentBody = p3.proposedBodyMarkdown;
    const p3Body = {
      ...(JSON.parse(p3AgentBody) as Record<string, unknown>),
      title: "Plant the hedge",
    };
    const p3Amend = await amendDecision(root, p3.id, {
      // No proposedTitle: the body carries the title approval will write.
      proposedBodyMarkdown: JSON.stringify(p3Body),
      note: "Name it plainly",
    });
    assert.equal(p3Amend.ok, true, p3Amend.ok ? "" : p3Amend.error);
    if (!p3Amend.ok) return;
    assert.equal(
      p3Amend.value.proposedTitle,
      "Plant the hedge",
      "the display title must be derived from the project body",
    );
    assert.equal(p3Amend.value.originalProposedTitle, "Buid a hedge");
    assert.equal(p3Amend.value.originalProposedBodyMarkdown, p3AgentBody);

    const doctrineFiled = await createDecision(root, {
      target: { type: "doctrine", domainSlug: "health", kind: "why" },
      proposedTitle: "Sleep more",
      proposedBodyMarkdown: "Rest when you can.",
      actor: COMPANION,
    });
    assert.equal(doctrineFiled.ok, true, doctrineFiled.ok ? "" : doctrineFiled.error);
    if (!doctrineFiled.ok) return;
    const doctrine = doctrineFiled.value;
    const doctrineProse = "Rest is when the body repairs. Aim for eight hours a night.";
    const doctrineAmend = await amendDecision(root, doctrine.id, {
      proposedTitle: "Sleep eight hours",
      proposedBodyMarkdown: doctrineProse,
      note: "Be specific",
    });
    assert.equal(doctrineAmend.ok, true, doctrineAmend.ok ? "" : doctrineAmend.error);
    if (!doctrineAmend.ok) return;
    assert.equal(doctrineAmend.value.proposedTitle, "Sleep eight hours");
    assert.equal(doctrineAmend.value.proposedBodyMarkdown, doctrineProse);
    assert.equal(doctrineAmend.value.proposedBodyMarkdown.startsWith("{"), false);
    assert.equal(doctrineAmend.value.originalProposedTitle, "Sleep more");
    assert.equal(doctrineAmend.value.originalProposedBodyMarkdown, "Rest when you can.");
    const doctrineOnDisk = await readJsonFile(paths.decisionJson(doctrine.id));
    assert.equal(doctrineOnDisk.proposedBodyMarkdown, doctrineProse);
    record(
      "7. Amending a project create's BODY title with no proposedTitle yields the derived display title. A doctrine Decision accepts a prose (non-JSON) body and proposedTitle as its title.",
      {
        projectDecisionId: p3.id,
        derivedProposedTitle: p3Amend.value.proposedTitle,
        projectOriginalTitle: p3Amend.value.originalProposedTitle,
        doctrineDecisionId: doctrine.id,
        doctrineProposedTitle: doctrineAmend.value.proposedTitle,
        doctrineProposedBodyMarkdown: doctrineAmend.value.proposedBodyMarkdown,
        doctrineOriginalTitle: doctrineAmend.value.originalProposedTitle,
        doctrineProseOnDisk: doctrineOnDisk.proposedBodyMarkdown,
      },
    );

    // ── Claim 8: an edited proposal that cannot apply stays pending; the same
    //    body unedited keeps the existing KAR-64 rejected behaviour. ─────────
    const db1Amend = await amendDecision(root, db1.id, {
      proposedBodyMarkdown: JSON.stringify({ ...db1Filed.body, name: "Bogus column" }),
      note: "Try to fix it",
    });
    assert.equal(db1Amend.ok, true, db1Amend.ok ? "" : db1Amend.error);
    if (!db1Amend.ok) return;

    const db1Approve = await resolveDecision(root, db1.id, "approved");
    assert.equal(db1Approve.ok, false, "an edited proposal still failed to apply, but approval said ok");
    const db1ApplyError = db1Approve.ok ? "" : db1Approve.error;
    assert.match(db1ApplyError, /Unknown column type/);
    const db1After = await getDecision(root, db1.id);
    assert.equal(db1After.status, "pending", "an edited proposal's terminal failure must leave it pending");
    assert.equal(db1After.reason, null, "an edited proposal must not be recorded as a rejection");
    assert.ok(db1After.amendedAt, "the edited proposal must keep its amendment");
    assert.equal(
      (await readEvents(root)).filter(
        (event) =>
          event.type === "decision.resolved" &&
          (event.payload as { id?: string } | null)?.id === db1.id,
      ).length,
      0,
      "a kept-pending edited proposal must log no resolution",
    );

    const db2Filed = await fileTerminallyFailingDatabaseDecision(root);
    const db2 = db2Filed.decision;
    assert.equal(db2.amendedAt, null, "the contrast Decision must be unedited");
    const db2Approve = await resolveDecision(root, db2.id, "approved");
    assert.equal(db2Approve.ok, false, "the terminal failure should be reported, not applied");
    const db2ApplyError = db2Approve.ok ? "" : db2Approve.error;
    assert.match(db2ApplyError, /Unknown column type/);
    const db2After = await getDecision(root, db2.id);
    assert.equal(
      db2After.status,
      "rejected",
      "an UNEDITED proposal with a terminal apply failure must still flip to rejected (KAR-64)",
    );
    assert.equal(db2After.reason, db2ApplyError, "the rejection must carry the apply error as its reason");
    assert.ok(db2After.resolvedAt, "a recorded rejection must carry resolvedAt");
    const db2ResolvedLogs = (await readEvents(root)).filter(
      (event) =>
        event.type === "decision.resolved" &&
        (event.payload as { id?: string } | null)?.id === db2.id,
    );
    assert.equal(db2ResolvedLogs.length, 1);
    assert.equal(
      (db2ResolvedLogs[0]!.payload as { resolution?: string } | null)?.resolution,
      "rejected",
    );
    assert.match(db2ResolvedLogs[0]!.summary, /no longer applies/);
    record(
      "8. An operator-edited proposal that fails at apply TERMINALLY returns ok:false and stays pending (reason null, no resolution logged). The same body on an UNEDITED Decision still flips to rejected with the reason and a decision.resolved log (KAR-64 preserved).",
      {
        edited: {
          decisionId: db1.id,
          applyError: db1ApplyError,
          statusAfterApprove: db1After.status,
          reason: db1After.reason,
          amendedAt: db1After.amendedAt,
          resolvedLogCount: 0,
        },
        unedited: {
          decisionId: db2.id,
          applyError: db2ApplyError,
          statusAfterApprove: db2After.status,
          reason: db2After.reason,
          resolvedAt: db2After.resolvedAt,
          resolvedLogCount: db2ResolvedLogs.length,
        },
      },
    );

    // ── Claim 4: an answered Decision is history; a missing id is not found. ─
    const approvedAmendError = await expectAmendRefused(
      root,
      p1.id,
      { proposedTitle: "Build a deck" },
      /already approved/,
    );
    const rejectedAmendError = await expectAmendRefused(
      root,
      db2.id,
      { proposedTitle: "Add a column" },
      /already rejected/,
    );
    const missingId = randomUUID();
    const missingAmend = await amendDecision(root, missingId, { proposedTitle: "Anything" });
    assert.equal(missingAmend.ok, false);
    const missingError = missingAmend.ok ? "" : missingAmend.error;
    assert.match(missingError, new RegExp(`Decision not found: ${missingId}`));
    record(
      "4. Amending an approved or rejected Decision is refused with \"already\"; amending a missing id is refused with \"Decision not found\".",
      { approvedAmendError, rejectedAmendError, missingId, missingError },
    );

    // ── Claim 9: the MCP `list_decisions` tool reports the amendment. ───────
    const p4 = await fileProject(root, "Clean the gutters", "Before the rain");
    assert.equal(p4.amendedAt, null);

    const toolResult = (await executeTool(
      root,
      null,
      "list_decisions",
      {},
      COMPANION,
      READ_GRANT,
    )) as {
      decisions?: Array<{
        id: string;
        status: string;
        proposedTitle: string | null;
        amended?: boolean;
      }>;
      error?: unknown;
    };
    assert.ok(
      Array.isArray(toolResult.decisions),
      `list_decisions through the tool layer returned no decisions: ${JSON.stringify(toolResult)}`,
    );
    const toolById = new Map(toolResult.decisions!.map((decision) => [decision.id, decision]));
    const p3Tool = toolById.get(p3.id);
    const p4Tool = toolById.get(p4.id);
    assert.ok(p3Tool, "the amended Decision is missing from the tool's list");
    assert.ok(p4Tool, "the untouched Decision is missing from the tool's list");
    assert.equal(p3Tool!.amended, true, "list_decisions must report an amended Decision as amended");
    assert.equal(p3Tool!.proposedTitle, "Plant the hedge");
    assert.equal(p4Tool!.amended, false, "list_decisions must report an untouched Decision as not amended");

    const readById = new Map((await readDecisions(root)).map((decision) => [decision.id, decision]));
    const p3Read = readById.get(p3.id);
    const p4Read = readById.get(p4.id);
    assert.ok(p3Read && p4Read);
    assert.ok(p3Read!.amendedAt, "the amended Decision must carry amendedAt on read");
    assert.equal(p4Read!.amendedAt, null, "the untouched Decision must carry no amendedAt");
    record(
      "9. list_decisions through the MCP tool layer reports amended:true for an amended Decision (with the edited proposedTitle) and amended:false for an untouched one; the vault read carries the same amendedAt fact.",
      {
        amendedDecisionId: p3.id,
        amended: p3Tool!.amended,
        amendedProposedTitle: p3Tool!.proposedTitle,
        untouchedDecisionId: p4.id,
        untouchedAmended: p4Tool!.amended,
        amendedAtOnRead: p3Read!.amendedAt,
        untouchedAmendedAtOnRead: p4Read!.amendedAt,
      },
    );

    // ── The repeatable artifact: only a run that held writes one. ───────────
    const report = {
      pass: true,
      ranAt: new Date().toISOString(),
      command:
        "cd apps/desktop && node --experimental-strip-types --test tests/decision-amend-engine-e2e.test.ts",
      vaultRoot: "<temporary, removed after the run>",
      claims,
      passCount: claims.length,
      failCount: 0,
      files: {
        decisionsDir: ".lifequest/decisions/<id>.json",
        editedProjectFile: `projects/${projectId}.md`,
        log: ".lifequest/log.jsonl",
        artifact: "apps/desktop/e2e/artifacts/decision-amend-engine.json",
      },
    };
    await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
    await fs.writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);

    assert.equal(claims.length, 9, "every claim must be named in the artifact");
    for (const claim of claims) {
      assert.equal(claim.pass, true, `claim failed: ${claim.claim}`);
    }

    for (const dir of roots) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
