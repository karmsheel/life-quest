/**
 * E2E for the Decision intake funnel: every proposal a companion turn makes is
 * filed as a pending Decision. One turn can carry several proposals in several
 * `lifequest-decision` fences, so parsing must return ALL of them, filing must
 * create one pending Decision per proposal, and one bad fence must neither
 * erase a good one nor abort the turn.
 *
 * This drives the real vault-core against a real temp vault (createVault), the
 * real Decision files on disk, and the same `listDecisions` +
 * `withDecisionDisplayLabels` the Decisions page reads through. `npm test` runs
 * it without a dev server. The Electron rig proves the rendered page; this
 * proves the funnel never drops a proposal and never approves one.
 *
 * Ways this can fail (written before the assertions, per AGENTS.md):
 *  1. one-decision-per-turn: the second/third fence in a turn is dropped.
 *  2. a malformed fence erases an earlier valid proposal, or the whole turn
 *     stops at the bad fence.
 *  3. a completed write tool (`create_goal`) suppresses every fence in the turn.
 *  4. filing APPLIES the change (creates the project, updates the doctrine)
 *     instead of filing a pending Decision the operator has to approve.
 *  5. the same proposal in two turns files twice.
 *  6. the `{"decisions":[...]}` array form files only the first entry.
 *  7. `fileUnsolicited:false` still parses and files (the operator turned
 *     unsolicited filing off), or a turn with no fence reports something other
 *     than `none`.
 *  8. the Decisions page read path throws on a filed Decision, or the filed
 *     Decision is not `pending`.
 *  9. one corrupt Decision file blanks the inbox: `listDecisions` fails (every
 *     readable Decision disappears), or `openVault` fails so the app refuses to
 *     draw at boot. The broken file must also be reported once — not on every
 *     repaint — and left byte-identical on disk.
 *
 * Artifact: `e2e/artifacts/decision-intake.json` — per-scenario pass/fail, the
 * fence text, the parsed changes, the filed Decision ids/kinds/actors, the
 * read-path result, and the corrupt-file survival details. The assertion runs on
 * the same JSON it writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  COMPANION_ACTOR,
  USER_ACTOR,
  applyGoalsCommand,
  collectImpliedTurn,
  createVault,
  fileImpliedChanges,
  listDecisions,
  openVault,
  projectCreate,
  projectGet,
  readLog,
  withDecisionDisplayLabels,
} from "@lifequest/vault-core";
import type { DecisionRecord, LifeEvent } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(desktopRoot, "e2e/artifacts/decision-intake.json");

const FENCE_MARKER = "```lifequest-decision";

/** One `lifequest-decision` fenced block carrying one JSON proposal. */
function fence(value: unknown): string {
  return `${FENCE_MARKER}\n${JSON.stringify(value)}\n\`\`\``;
}

/** A fence whose body is not JSON at all. */
function malformedFence(): string {
  return `${FENCE_MARKER}\n{ "kind": "doctrine", "domainSlug": }\n\`\`\``;
}

type ScenarioResult = {
  name: string;
  pass: boolean;
  error: string | null;
  [detail: string]: unknown;
};

type FiledEntry = {
  scenario: string;
  root: string;
  decisionId: string;
  targetType: string;
  kind: string;
  status: string;
  actor: string;
};

const roots: string[] = [];
const filedLog: FiledEntry[] = [];
const results: ScenarioResult[] = [];

async function freshVault(label: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lq-decision-intake-"));
  roots.push(root);
  const created = await createVault(root, `Decision Intake ${label}`);
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  return root;
}

function kindOf(change: { kind: string }): string {
  return change.kind;
}

/** Run one scenario; record pass/fail instead of aborting the remaining ones. */
async function scenario(
  name: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    const detail = await run();
    results.push({ name, pass: true, error: null, ...detail });
  } catch (e) {
    results.push({
      name,
      pass: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function listPending(root: string): Promise<DecisionRecord[]> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
  return listed.ok ? listed.value : [];
}

/** Every `decision.unreadable` line the vault's log carries, in order. */
async function unreadableLogEntries(root: string): Promise<LifeEvent[]> {
  const log = await readLog(root);
  assert.equal(log.ok, true, log.ok ? "" : log.error);
  return (log.ok ? log.value : []).filter((event) => event.type === "decision.unreadable");
}

function track(root: string, scenarioName: string, decisions: readonly DecisionRecord[]): void {
  for (const decision of decisions) {
    filedLog.push({
      scenario: scenarioName,
      root,
      decisionId: decision.id,
      targetType: decision.target.type,
      kind: decision.target.type,
      status: decision.status,
      actor: decision.actor.type === "agent" ? `${decision.actor.id}:${decision.actor.name}` : decision.actor.type,
    });
  }
}

function decisionFileExists(root: string, id: string): boolean {
  return fs.existsSync(path.join(root, ".lifequest", "decisions", `${id}.json`));
}

describe("decision intake funnel", () => {
  it("files every proposal a turn carries as its own pending Decision", async () => {
    try {
      // ── 1. three fences in one turn ────────────────────────────────────
      await scenario("three fences in one turn file three pending Decisions in order", async () => {
        const root = await freshVault("three");
        const doctrineBody = "I train because the work should outlast the mood of the day.";
        const libraryBody = "Lights out at 22:30; screens off an hour before.";
        const text = [
          "I looked at this week and I want to change three things.",
          fence({
            kind: "doctrine",
            domainSlug: "health",
            documentKind: "why",
            title: "Purpose",
            body: doctrineBody,
          }),
          "Second, a note to keep:",
          fence({
            kind: "library",
            title: "Sleep protocol",
            body: libraryBody,
            domainSlugs: ["health"],
          }),
          "And one goal for the month:",
          fence({
            kind: "goal",
            command: {
              type: "createGoal",
              name: "Sleep eight hours",
              domainSlug: "health",
              definitionOfDone: "8 hours on five nights a week",
            },
          }),
        ].join("\n\n");

        const collected = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: text,
          completedToolNames: [],
        });
        assert.equal(collected.failures.length, 0, `unexpected fence failures: ${JSON.stringify(collected.failures)}`);
        assert.equal(collected.changes.length, 3, `a turn with three fences yielded ${collected.changes.length} change(s)`);
        assert.deepEqual(collected.changes.map(kindOf), ["doctrine", "library", "goal"]);

        const filed = await fileImpliedChanges(root, collected.changes);
        assert.equal(filed.errors.length, 0, `filing errored: ${JSON.stringify(filed.errors)}`);
        assert.equal(filed.skipped, 0, "a first-time turn skipped a proposal");
        assert.equal(filed.filed.length, 3, `three proposed changes filed ${filed.filed.length} Decision(s)`);
        assert.deepEqual(
          filed.filed.map((decision) => decision.target.type),
          ["doctrine", "library", "goal"],
          "the filed order does not match the fence order",
        );
        track(root, "three fences", filed.filed);

        const listed = await listPending(root);
        assert.equal(listed.length, 3, `the vault holds ${listed.length} Decision(s), not 3`);
        for (const decision of listed) {
          assert.equal(decision.status, "pending", `${decision.id} is not pending`);
          assert.deepEqual(decision.actor, COMPANION_ACTOR, "a companion turn filed under the wrong actor");
          assert.equal(decisionFileExists(root, decision.id), true, `${decision.id} has no file on disk`);
        }
        const byId = new Map(listed.map((decision) => [decision.id, decision]));
        assert.deepEqual(
          filed.filed.map((decision) => byId.get(decision.id)?.target.type),
          ["doctrine", "library", "goal"],
          "the vault's own read lost one of the filed Decisions",
        );
        const doctrine = byId.get(filed.filed[0]!.id)!;
        assert.equal(doctrine.proposedBodyMarkdown, doctrineBody);
        const library = byId.get(filed.filed[1]!.id)!;
        assert.equal(library.proposedBodyMarkdown, libraryBody);
        assert.equal(library.proposedTitle, "Sleep protocol");
        const goal = byId.get(filed.filed[2]!.id)!;
        assert.equal(JSON.parse(goal.proposedBodyMarkdown).name, "Sleep eight hours");

        return {
          root,
          fenceCount: 3,
          reason: collected.reason,
          changes: collected.changes.map(kindOf),
          filed: filed.filed.length,
          skipped: filed.skipped,
          errors: filed.errors.length,
          decisions: listed.map((decision) => ({
            id: decision.id,
            targetType: decision.target.type,
            status: decision.status,
            actor: decision.actor,
          })),
        };
      });

      // ── 2. a project create + a project close in one turn ──────────────
      await scenario("project create and project close both file as pending project Decisions", async () => {
        const root = await freshVault("projects");
        const goalResult = await applyGoalsCommand(
          root,
          { type: "createGoal", name: "Ship the intake fix", domainSlug: "health" },
          USER_ACTOR,
        );
        assert.equal(goalResult.ok, true, goalResult.ok ? "" : goalResult.error);
        const goalId = goalResult.ok ? goalResult.value.find((goal) => goal.name === "Ship the intake fix")?.id : undefined;
        assert.ok(goalId, "the seeded goal has no id");

        const seeded = await projectCreate(
          root,
          { title: "Rebuild the morning", goalId: goalId!, domainSlug: "health", bodyMarkdown: "Old shape." },
          USER_ACTOR,
        );
        assert.equal(seeded.ok, true, seeded.ok ? "" : seeded.error);
        const projectId = seeded.ok ? seeded.value.id : "";
        assert.equal(seeded.ok ? seeded.value.status : "", "open", "the operator project did not start open");

        const text = [
          "Two project moves from this turn:",
          fence({
            kind: "project",
            command: {
              type: "createProject",
              title: "Evening wind-down",
              goalId: goalId!,
              domainSlug: "health",
              bodyMarkdown: "Phase one: lights down at 22:00.",
            },
          }),
          fence({ kind: "project", command: { type: "closeProject", id: projectId } }),
        ].join("\n\n");

        const collected = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: text,
          completedToolNames: [],
        });
        assert.equal(collected.failures.length, 0, `unexpected fence failures: ${JSON.stringify(collected.failures)}`);
        assert.equal(collected.changes.length, 2, `two project fences yielded ${collected.changes.length} change(s)`);
        assert.deepEqual(collected.changes.map(kindOf), ["project", "project"]);

        const filed = await fileImpliedChanges(root, collected.changes);
        assert.equal(filed.errors.length, 0, `filing errored: ${JSON.stringify(filed.errors)}`);
        assert.equal(filed.skipped, 0);
        assert.equal(filed.filed.length, 2, `two project proposals filed ${filed.filed.length} Decision(s)`);
        track(root, "project create+close", filed.filed);
        for (const decision of filed.filed) {
          assert.equal(decision.target.type, "project", "a project proposal did not file a project target");
          assert.equal(decision.status, "pending", "a project proposal was filed as anything but pending");
          assert.equal(decisionFileExists(root, decision.id), true);
        }

        const listed = await listPending(root);
        assert.equal(listed.length, 2);
        assert.deepEqual(
          listed.map((decision) => decision.target.type),
          ["project", "project"],
        );
        assert.deepEqual(
          listed.map((decision) => decision.status),
          ["pending", "pending"],
        );

        // Filing must not apply: the operator's project is still open, and the
        // proposed new project has not been written yet.
        const stillOpen = await projectGet(root, projectId);
        assert.equal(stillOpen.ok, true, stillOpen.ok ? "" : stillOpen.error);
        assert.equal(stillOpen.ok ? stillOpen.value.status : "", "open", "filing a close approved it");

        const createDecision = listed.find((decision) => decision.proposedBodyMarkdown.includes("createProject"));
        assert.ok(createDecision, "the create-project proposal is not in the vault");
        const createBody = JSON.parse(createDecision!.proposedBodyMarkdown) as {
          type: string;
          id: string;
          title: string;
          goalId: string;
        };
        assert.equal(createBody.title, "Evening wind-down");
        assert.equal(createBody.goalId, goalId);
        assert.ok(
          createBody.id,
          "the create-project Decision carries no propose-time id, so approving it would write a project under id \"undefined\"",
        );
        const notYetCreated = await projectGet(root, createBody.id);
        assert.equal(notYetCreated.ok, false, "filing a create-project proposal created the project");
        const closeDecision = listed.find((decision) => decision.proposedBodyMarkdown.includes("closeProject"));
        assert.ok(closeDecision, "the close-project proposal is not in the vault");
        assert.equal(JSON.parse(closeDecision!.proposedBodyMarkdown).id, projectId);

        return {
          root,
          reason: collected.reason,
          changes: collected.changes.map(kindOf),
          filed: filed.filed.length,
          skipped: filed.skipped,
          errors: filed.errors.length,
          seededProject: { id: projectId, status: "open" },
          proposedProjectId: createBody.id,
          decisions: listed.map((decision) => ({
            id: decision.id,
            targetType: decision.target.type,
            status: decision.status,
          })),
        };
      });

      // ── 3. a malformed fence must not erase a valid proposal ───────────
      await scenario("a malformed fence is reported and the valid proposals still file", async () => {
        const root = await freshVault("malformed");
        const validText = fence({
          kind: "library",
          title: "Hydration",
          body: "1.5L before noon.",
          domainSlugs: ["health"],
        });

        // bad fence first, good fence second: exactly one failure, one change.
        const badThenGood = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: `${malformedFence()}\n\n${validText}`,
          completedToolNames: [],
        });
        assert.equal(badThenGood.changes.length, 1, `malformed-first turn yielded ${badThenGood.changes.length} change(s)`);
        assert.equal(badThenGood.changes[0]?.kind, "library");
        assert.equal(badThenGood.failures.length, 1, `malformed-first turn reported ${badThenGood.failures.length} failure(s)`);
        assert.equal(badThenGood.failures[0]?.fenceIndex, 0, "the failure does not name the malformed fence");
        assert.equal(badThenGood.failures[0]?.reason, "malformed", `failure reason was ${badThenGood.failures[0]?.reason}`);
        assert.equal(typeof badThenGood.failures[0]?.detail, "string");

        // good fence first, bad fence second: the later bad fence must not
        // erase the earlier valid proposal.
        const goodThenBad = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: `${validText}\n\n${malformedFence()}`,
          completedToolNames: [],
        });
        assert.equal(goodThenBad.changes.length, 1, `good-then-bad turn yielded ${goodThenBad.changes.length} change(s)`);
        assert.equal(goodThenBad.failures.length, 1);
        assert.equal(goodThenBad.failures[0]?.fenceIndex, 1, "the failure does not name the trailing malformed fence");

        // good, bad, good: both good proposals survive with one reported failure.
        const goodBadGood = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: [
            validText,
            malformedFence(),
            fence({ kind: "library", title: "Protein", body: "30g at breakfast.", domainSlugs: ["health"] }),
          ].join("\n\n"),
          completedToolNames: [],
        });
        assert.equal(goodBadGood.changes.length, 2, `good/bad/good turn yielded ${goodBadGood.changes.length} change(s)`);
        assert.equal(goodBadGood.failures.length, 1);

        const filed = await fileImpliedChanges(root, goodBadGood.changes);
        assert.equal(filed.errors.length, 0, `filing errored: ${JSON.stringify(filed.errors)}`);
        assert.equal(filed.skipped, 0);
        assert.equal(filed.filed.length, 2, `two valid proposals filed ${filed.filed.length} Decision(s)`);
        track(root, "malformed", filed.filed);
        const listed = await listPending(root);
        assert.equal(listed.length, 2, "a malformed fence changed how many Decisions were filed");
        assert.deepEqual(
          listed.map((decision) => decision.status),
          ["pending", "pending"],
        );
        assert.deepEqual(
          listed.map((decision) => decision.proposedTitle).sort(),
          ["Hydration", "Protein"],
        );

        return {
          root,
          validFirstFence: badThenGood.failures[0]?.fenceIndex,
          failureReason: badThenGood.failures[0]?.reason,
          failureDetail: badThenGood.failures[0]?.detail,
          changes: { badThenGood: 1, goodThenBad: 1, goodBadGood: 2 },
          failures: { badThenGood: 1, goodThenBad: 1, goodBadGood: 1 },
          filed: filed.filed.length,
          skipped: filed.skipped,
          errors: filed.errors.length,
          decisions: listed.map((decision) => ({
            id: decision.id,
            title: decision.proposedTitle,
            status: decision.status,
          })),
        };
      });

      // ── 4. a completed write tool no longer suppresses the turn ────────
      await scenario("a completed create_goal tool does not suppress the non-goal fences", async () => {
        const root = await freshVault("write-tool");
        const doctrineBody = "The week is the unit of planning, not the day.";
        const text = [
          "The goal is created. Two more things from the same turn:",
          fence({
            kind: "doctrine",
            domainSlug: "intellectual",
            documentKind: "how",
            title: "Strategy (How)",
            body: doctrineBody,
          }),
          fence({ kind: "library", title: "Weekly review ritual", body: "Sunday, 18:00.", domainSlugs: ["intellectual"] }),
        ].join("\n\n");

        const collected = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: text,
          completedToolNames: ["create_goal"],
        });
        assert.notEqual(collected.reason, "write-tool", "a completed write tool still suppressed the turn");
        assert.equal(collected.failures.length, 0, `unexpected fence failures: ${JSON.stringify(collected.failures)}`);
        assert.equal(collected.changes.length, 2, `a turn with a completed create_goal yielded ${collected.changes.length} change(s)`);

        const filed = await fileImpliedChanges(root, collected.changes);
        assert.equal(filed.errors.length, 0, `filing errored: ${JSON.stringify(filed.errors)}`);
        assert.equal(filed.skipped, 0);
        assert.equal(filed.filed.length, 2, `two non-goal proposals filed ${filed.filed.length} Decision(s)`);
        track(root, "write-tool", filed.filed);
        const listed = await listPending(root);
        assert.equal(listed.length, 2, "the completed write tool cost a Decision");
        for (const decision of listed) {
          assert.equal(decision.status, "pending");
        }

        return {
          root,
          reason: collected.reason,
          completedToolNames: ["create_goal"],
          changes: collected.changes.map(kindOf),
          filed: filed.filed.length,
          skipped: filed.skipped,
          errors: filed.errors.length,
          decisions: listed.map((decision) => ({
            id: decision.id,
            targetType: decision.target.type,
            status: decision.status,
          })),
        };
      });

      // ── 5. the identical proposal across two turns files once ──────────
      await scenario("the identical proposal in two turns files exactly once", async () => {
        const root = await freshVault("dedupe");
        const text = fence({
          kind: "doctrine",
          domainSlug: "health",
          documentKind: "premise",
          title: "Beliefs & Premise",
          body: "Rest is training, not slack.",
        });

        const firstTurn = collectImpliedTurn({ fileUnsolicited: true, assistantText: text, completedToolNames: [] });
        const secondTurn = collectImpliedTurn({ fileUnsolicited: true, assistantText: text, completedToolNames: [] });
        assert.equal(firstTurn.changes.length, 1);
        assert.equal(secondTurn.changes.length, 1);

        const first = await fileImpliedChanges(root, firstTurn.changes);
        assert.equal(first.filed.length, 1, `the first turn filed ${first.filed.length} Decision(s)`);
        assert.equal(first.skipped, 0);
        const second = await fileImpliedChanges(root, secondTurn.changes);
        assert.equal(second.errors.length, 0, `the second turn errored: ${JSON.stringify(second.errors)}`);
        assert.equal(second.filed.length, 0, "the second turn filed the identical proposal again");
        assert.equal(second.skipped, 1, `the second turn reported skipped=${second.skipped}, not 1`);

        const listed = await listPending(root);
        assert.equal(listed.length, 1, `the vault holds ${listed.length} Decision(s) for one identical proposal`);
        track(root, "dedupe", first.filed);

        return {
          root,
          firstFiled: first.filed.length,
          secondFiled: second.filed.length,
          secondSkipped: second.skipped,
          decisionsInVault: listed.length,
          decisions: listed.map((decision) => ({ id: decision.id, status: decision.status })),
        };
      });

      // ── 6. the {"decisions":[...]} array form ──────────────────────────
      await scenario("one fence with a decisions array files every entry", async () => {
        const root = await freshVault("array");
        const text = fence({
          decisions: [
            {
              kind: "doctrine",
              domainSlug: "emotional",
              documentKind: "what",
              title: "Vision & Desire",
              body: "I want to name what I feel before it names me.",
            },
            {
              kind: "library",
              title: "Journaling prompts",
              body: "What did I avoid today, and why?",
              domainSlugs: ["emotional"],
            },
            { kind: "goal", command: { type: "createGoal", name: "Weekly review", domainSlug: "emotional" } },
          ],
        });

        const collected = collectImpliedTurn({ fileUnsolicited: true, assistantText: text, completedToolNames: [] });
        assert.equal(collected.failures.length, 0, `unexpected fence failures: ${JSON.stringify(collected.failures)}`);
        assert.equal(collected.changes.length, 3, `the array form yielded ${collected.changes.length} change(s)`);
        assert.deepEqual(collected.changes.map(kindOf), ["doctrine", "library", "goal"]);

        const filed = await fileImpliedChanges(root, collected.changes);
        assert.equal(filed.errors.length, 0, `filing errored: ${JSON.stringify(filed.errors)}`);
        assert.equal(filed.skipped, 0);
        assert.equal(filed.filed.length, 3, `the array form filed ${filed.filed.length} Decision(s)`);
        track(root, "array", filed.filed);
        const listed = await listPending(root);
        assert.equal(listed.length, 3, "the array form lost an entry on the vault read");
        for (const decision of listed) {
          assert.equal(decision.status, "pending");
        }

        return {
          root,
          reason: collected.reason,
          changes: collected.changes.map(kindOf),
          filed: filed.filed.length,
          skipped: filed.skipped,
          errors: filed.errors.length,
          decisions: listed.map((decision) => ({
            id: decision.id,
            targetType: decision.target.type,
            status: decision.status,
          })),
        };
      });

      // ── 7. no fence, and unsolicited filing turned off ─────────────────
      await scenario("no fence reports none and fileUnsolicited:false reports disabled", async () => {
        const root = await freshVault("off");
        const none = collectImpliedTurn({
          fileUnsolicited: true,
          assistantText: "Your sleep looks fine. No document changes from me this turn.",
          completedToolNames: [],
        });
        assert.equal(none.changes.length, 0, "prose without a fence produced a change");
        assert.equal(none.failures.length, 0, "prose without a fence produced a failure");
        assert.equal(none.reason, "none", `a fence-free turn reported reason ${none.reason}`);

        const disabled = collectImpliedTurn({
          fileUnsolicited: false,
          assistantText: fence({
            kind: "library",
            title: "Unsolicited",
            body: "This must not file.",
            domainSlugs: ["health"],
          }),
          completedToolNames: [],
        });
        assert.equal(disabled.changes.length, 0, "fileUnsolicited:false still produced a change");
        assert.equal(disabled.reason, "disabled", `fileUnsolicited:false reported reason ${disabled.reason}`);

        const filedNone = await fileImpliedChanges(root, none.changes);
        assert.equal(filedNone.filed.length, 0);
        assert.equal(filedNone.skipped, 0);
        assert.equal(filedNone.errors.length, 0);
        assert.equal((await listPending(root)).length, 0, "an empty turn filed a Decision");

        return {
          root,
          noFence: { changes: none.changes.length, failures: none.failures.length, reason: none.reason },
          disabled: { changes: disabled.changes.length, reason: disabled.reason },
          decisionsInVault: 0,
        };
      });

      // ── 8. the Decisions page's read path over every filed Decision ────
      await scenario("withDecisionDisplayLabels reads every filed Decision as pending", async () => {
        assert.ok(roots.length > 0, "no vaults from the earlier scenarios");
        const readVaults: {
          root: string;
          decisions: number;
          pending: number;
          ids: string[];
        }[] = [];
        let totalDecisions = 0;
        let totalResolved = 0;

        for (const root of roots) {
          const listed = await listPending(root);
          totalDecisions += listed.length;
          const resolved = await withDecisionDisplayLabels(root, listed);
          totalResolved += resolved.length;
          assert.equal(
            resolved.length,
            listed.length,
            `withDecisionDisplayLabels returned ${resolved.length} of ${listed.length} Decisions`,
          );
          for (const decision of resolved) {
            assert.equal(decision.status, "pending", `${decision.id} is not pending on the read path`);
            assert.equal(typeof decision.proposedBodyMarkdown, "string");
            assert.ok(decision.proposedBodyMarkdown.length > 0, `${decision.id} has an empty body`);
            assert.deepEqual(
              resolved.find((entry) => entry.id === decision.id)?.target,
              decision.target,
              "the read path rewrote a Decision target",
            );
          }
          // Every Decision this test filed into this vault must come back.
          const expectedIds = filedLog
            .filter((entry) => entry.root === root)
            .map((entry) => entry.decisionId);
          const knownIds = new Set(listed.map((decision) => decision.id));
          for (const id of expectedIds) {
            assert.equal(knownIds.has(id), true, `${id} vanished from listDecisions`);
          }
          assert.equal(
            listed.length,
            expectedIds.length,
            `the vault holds ${listed.length} Decisions but ${expectedIds.length} were filed`,
          );
          readVaults.push({
            root,
            decisions: listed.length,
            pending: listed.filter((decision) => decision.status === "pending").length,
            ids: listed.map((decision) => decision.id),
          });
        }

        assert.equal(
          totalDecisions,
          filedLog.length,
          `the read path saw ${totalDecisions} Decisions but ${filedLog.length} were filed`,
        );
        assert.equal(totalResolved, totalDecisions);
        assert.equal(
          readVaults.reduce((sum, vault) => sum + vault.pending, 0),
          totalDecisions,
          "a filed Decision is not pending",
        );

        return { readVaults, totalDecisions, totalResolved };
      });

      // ── 9. one corrupt Decision file must not blank the inbox ──────────
      await scenario("a corrupt Decision file is skipped, reported once, and never rewritten", async () => {
        const root = await freshVault("corrupt");
        const text = [
          "Two small changes, and one of the Decision files on disk is damaged:",
          fence({
            kind: "doctrine",
            domainSlug: "health",
            documentKind: "how",
            title: "Strategy (How)",
            body: "Two sessions a week, minimum.",
          }),
          fence({ kind: "library", title: "Gym bag", body: "Pack it the night before.", domainSlugs: ["health"] }),
        ].join("\n\n");
        const collected = collectImpliedTurn({ fileUnsolicited: true, assistantText: text, completedToolNames: [] });
        assert.equal(collected.changes.length, 2);
        const filed = await fileImpliedChanges(root, collected.changes);
        assert.equal(filed.errors.length, 0, `filing errored: ${JSON.stringify(filed.errors)}`);
        assert.equal(filed.filed.length, 2, `filed ${filed.filed.length} of 2 readable Decisions`);
        track(root, "corrupt-file", filed.filed);
        const expectedIds = filed.filed.map((decision) => decision.id).sort();

        // A file the inbox cannot parse, written behind the app's back (a bad
        // sync, a half-finished write, a hand edit).
        const decisionsDir = path.join(root, ".lifequest", "decisions");
        const brokenPath = path.join(decisionsDir, "broken.json");
        const brokenText = "{ not json\n";
        fs.writeFileSync(brokenPath, brokenText);
        assert.equal((await unreadableLogEntries(root)).length, 0, "a file was reported unreadable before anyone read it");

        // The inbox read: ok, the two readable Decisions, no throw.
        const first = await listDecisions(root);
        assert.equal(first.ok, true, first.ok ? "" : `listDecisions failed: ${first.error}`);
        const firstList = first.ok ? first.value : [];
        assert.equal(firstList.length, 2, `the inbox drew ${firstList.length} of 2 readable Decisions`);
        assert.deepEqual(firstList.map((decision) => decision.id).sort(), expectedIds);
        for (let i = 1; i < firstList.length; i += 1) {
          assert.ok(
            firstList[i - 1]!.createdAt <= firstList[i]!.createdAt,
            "listDecisions no longer sorts by createdAt",
          );
        }

        // Reported once, naming the file.
        const afterFirstRead = await unreadableLogEntries(root);
        assert.equal(
          afterFirstRead.length,
          1,
          `the unreadable file was reported ${afterFirstRead.length} time(s), expected 1`,
        );
        assert.ok(
          afterFirstRead[0]!.summary.includes("broken.json"),
          `the log line does not name the file: ${afterFirstRead[0]!.summary}`,
        );
        const payload = afterFirstRead[0]!.payload as { file?: unknown; error?: unknown } | null;
        assert.equal(payload?.file, "broken.json");
        assert.equal(typeof payload?.error, "string");

        // A second read adds no second line: the inbox is read on every repaint.
        const second = await listDecisions(root);
        assert.equal(second.ok, true);
        assert.equal((second.ok ? second.value : []).length, 2);
        const afterSecondRead = await unreadableLogEntries(root);
        assert.equal(
          afterSecondRead.length,
          1,
          `a second inbox read reported the file again (${afterSecondRead.length} log lines)`,
        );

        // Nothing deleted, nothing rewritten: the damaged file is still exact.
        assert.equal(fs.readFileSync(brokenPath, "utf8"), brokenText, "the corrupt Decision file was rewritten");
        assert.deepEqual(
          fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).sort(),
          [...expectedIds.map((id) => `${id}.json`), "broken.json"].sort(),
          "reading the inbox added or removed a Decision file",
        );

        // The operator read path still draws the readable two.
        const resolved = await withDecisionDisplayLabels(root, firstList);
        assert.equal(resolved.length, 2, `the display path drew ${resolved.length} of 2 Decisions`);
        assert.deepEqual(resolved.map((decision) => decision.id).sort(), expectedIds);
        for (const decision of resolved) {
          assert.equal(decision.status, "pending");
        }

        // The boot path: a snapshot read skips the damaged file instead of failing.
        const opened = await openVault(root);
        assert.equal(opened.ok, true, opened.ok ? "" : `openVault failed: ${opened.error}`);
        const snapshotDecisions = opened.ok ? opened.value.decisions : [];
        assert.equal(
          snapshotDecisions.length,
          2,
          `openVault kept ${snapshotDecisions.length} of 2 readable Decisions`,
        );
        assert.deepEqual(snapshotDecisions.map((decision) => decision.id).sort(), expectedIds);
        assert.equal(fs.readFileSync(brokenPath, "utf8"), brokenText, "openVault rewrote the corrupt Decision file");
        assert.equal(
          (await unreadableLogEntries(root)).length,
          1,
          "openVault reported the same unreadable file again",
        );

        return {
          root,
          readableDecisions: firstList.length,
          expectedIds,
          unreadable: {
            file: "broken.json",
            summary: afterFirstRead[0]!.summary,
            reason: payload?.error,
          },
          logLinesAfterFirstRead: afterFirstRead.length,
          logLinesAfterSecondRead: afterSecondRead.length,
          brokenFileUnchanged: true,
          displayLabels: resolved.length,
          openVault: {
            ok: opened.ok,
            decisions: snapshotDecisions.length,
            ids: snapshotDecisions.map((decision) => decision.id),
          },
        };
      });

      // ── artifact: one JSON file with per-scenario pass/fail ─────────────
      const filedTotal = filedLog.length;
      const readDetail = results.find((result) => result.name.startsWith("withDecisionDisplayLabels"));
      const corruptDetail = results.find((result) => result.name.startsWith("a corrupt Decision file")) as
        | { logLinesAfterSecondRead?: unknown; openVault?: { decisions?: unknown } }
        | undefined;
      const report = {
        pass: results.every((result) => result.pass),
        ranAt: new Date().toISOString(),
        command: "cd apps/desktop && node --experimental-strip-types --test tests/decision-intake-e2e.test.ts",
        surface: "packages/vault-core/src/implied-decision.ts collectImpliedTurn + fileImpliedChanges",
        failureModes: [
          "the second/third fence in a turn is dropped (one-decision-per-turn)",
          "a malformed fence erases an earlier valid proposal or aborts the turn",
          "a completed write tool suppresses every fence",
          "filing applies the change instead of filing a pending Decision",
          "the identical proposal files twice",
          "the decisions array form files only its first entry",
          "fileUnsolicited:false still files",
          "the Decisions page read path throws on a filed Decision",
          "one corrupt Decision file fails listDecisions and blanks the inbox",
          "one corrupt Decision file fails openVault so the app refuses to draw at boot",
          "an unreadable Decision is reported on every repaint instead of once",
          "the corrupt Decision file is deleted or rewritten by a read",
        ],
        companionActor: COMPANION_ACTOR,
        scenarios: results,
        totals: {
          scenarios: results.length,
          passed: results.filter((result) => result.pass).length,
          failed: results.filter((result) => !result.pass).length,
          decisionsFiled: filedTotal,
          decisionsReadPending: readDetail?.totalDecisions,
          corruptDecisionFilesSkipped: 1,
          unreadableReportsLogged: corruptDetail?.logLinesAfterSecondRead,
          openVaultDecisions: corruptDetail?.openVault?.decisions,
        },
        filed: filedLog,
      };
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

      // The artifact is the deliverable, so assert on the file that was written.
      const writtenText = fs.readFileSync(REPORT, "utf8");
      const written = JSON.parse(writtenText) as typeof report;
      assert.equal(written.pass, true, `scenario failures:\n${written.scenarios
        .filter((result) => !result.pass)
        .map((result) => `  - ${result.name}: ${result.error}`)
        .join("\n")}`);
      assert.equal(written.scenarios.length, 9, "the artifact does not carry all nine scenarios");
      assert.deepEqual(written.scenarios, results);
      assert.equal(written.totals.failed, 0);
      assert.equal(written.filed.length, written.totals.decisionsFiled);
      assert.ok(written.filed.every((entry) => entry.status === "pending"));
      assert.equal(written.totals.unreadableReportsLogged, 1, "the artifact does not show report-once");
      assert.equal(written.totals.openVaultDecisions, 2, "the artifact does not show the boot read surviving");
      assert.equal(
        new Set(written.filed.map((entry) => entry.decisionId)).size,
        written.filed.length,
        "the artifact lists the same Decision twice",
      );
    } finally {
      for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
