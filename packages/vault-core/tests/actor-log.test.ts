import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { readLog } from "../src/log.ts";
import { applyMapCommand } from "../src/map/persist.ts";
import { captureUtterance, undoCapture } from "../src/capture.ts";
import { applyScriptBlock } from "../src/script-block.ts";
import { applyGoalsCommand } from "../src/goals.ts";
import { projectCreate } from "../src/projects.ts";
import { createDecision, resolveDecision } from "../src/decisions.ts";
import { createPage } from "../src/pages.ts";
import { USER_ACTOR, type Actor } from "../src/types.ts";

const HIRE: Actor = { type: "agent", id: "hire-1", name: "Ada" };

async function logOf(root: string) {
  const res = await readLog(root);
  assert.equal(res.ok, true);
  if (!res.ok) return [];
  return res.value;
}

async function eventsOfType(root: string, type: string) {
  return (await logOf(root)).filter((e) => e.type === type);
}

describe("actor on the life log (KAR-9)", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-actor-log-"));
    root = path.join(dir, "vault");
    const created = await createVault(root, "ActorLogTest");
    assert.equal(created.ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("operator applyMapCommand logs actor.type === 'user'", async () => {
    const res = await applyMapCommand(
      root,
      { type: "createTask", title: "Operator task" },
      "user",
    );
    assert.equal(res.ok, true);
    const created = await eventsOfType(root, "map.task.created");
    const last = created[created.length - 1];
    assert.equal(last.actor?.type, "user");
  });

  it("agent applyMapCommand with a vault actor logs that agent's id and name", async () => {
    const res = await applyMapCommand(
      root,
      { type: "createTask", title: "Agent task" },
      "agent",
      undefined,
      HIRE,
    );
    assert.equal(res.ok, true);
    const created = await eventsOfType(root, "map.task.created");
    const last = created[created.length - 1];
    assert.deepEqual(last.actor, { type: "agent", id: "hire-1", name: "Ada" });
  });

  it("postCapture logs capture.posted with the given actor", async () => {
    const { installFinanceKit } = await import("../src/finance-kit.ts");
    const { upsertRow } = await import("../src/domain-databases.ts");
    const installed = await installFinanceKit(root, USER_ACTOR);
    assert.equal(installed.ok, true);
    // A capture only posts when the account is unambiguous, so seed one.
    const account = await upsertRow(root, "financial", "finance:accounts", {
      cells: { name: "Cash", type: "checking", currency: "ZAR" },
    });
    assert.equal(account.ok, true);

    const posted = await captureUtterance(root, {
      text: "Bought food for R85 today",
      today: "2026-09-27",
      threadId: "t-actor-1",
      actor: HIRE,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    assert.equal(posted.value.posted, true);

    const events = await eventsOfType(root, "capture.posted");
    const last = events[events.length - 1];
    assert.deepEqual(last.actor, { type: "agent", id: "hire-1", name: "Ada" });
    assert.equal(last.domainSlug, "financial");
    assert.match(last.summary, /85/);
  });

  it("undoCapture logs capture.undone with the given actor", async () => {
    const undone = await undoCapture(root, { threadId: "t-actor-1", actor: HIRE });
    assert.equal(undone.ok, true);
    const events = await eventsOfType(root, "capture.undone");
    const last = events[events.length - 1];
    assert.deepEqual(last.actor, { type: "agent", id: "hire-1", name: "Ada" });
  });

  it("applyScriptBlock sets LifeEvent.actor to the given agent, not null", async () => {
    const page = await createPage(root, "health", { title: "Runbook" });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    const applied = await applyScriptBlock(root, {
      domainSlug: "health",
      pageId: page.value.id,
      name: "Report",
      source: "print('hi')",
      actor: HIRE,
    });
    assert.equal(applied.ok, true);
    const events = await eventsOfType(root, "page.script-applied");
    const last = events[events.length - 1];
    assert.deepEqual(last.actor, { type: "agent", id: "hire-1", name: "Ada" });
  });

  it("goal approve of an agent decision logs the goal line with that agent", async () => {
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Agent goal",
      proposedBodyMarkdown: JSON.stringify({ type: "createGoal", name: "Agent goal" }),
      actor: HIRE,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const before = (await eventsOfType(root, "goal.created")).length;
    const resolved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(resolved.ok, true);
    const after = await eventsOfType(root, "goal.created");
    assert.equal(after.length, before + 1);
    const last = after[after.length - 1];
    assert.deepEqual(last.actor, { type: "agent", id: "hire-1", name: "Ada" });
  });

  it("goal reject of an agent decision logs nothing new from apply", async () => {
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Rejected goal",
      proposedBodyMarkdown: JSON.stringify({ type: "createGoal", name: "Rejected goal" }),
      actor: HIRE,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const before = (await eventsOfType(root, "goal.created")).length;
    const resolved = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(resolved.ok, true);
    const after = await eventsOfType(root, "goal.created");
    assert.equal(after.length, before);
  });

  it("project approve logs the project line with the agent", async () => {
    // A goal must exist for a project to link to.
    const goal = await applyGoalsCommand(root, { type: "createGoal", name: "Host goal" });
    assert.equal(goal.ok, true);
    if (!goal.ok) return;
    const goalId = goal.value[goal.value.length - 1].id;
    const projectId = "project-actor-1";

    const created = await createDecision(root, {
      target: { type: "project" },
      proposedTitle: "Agent project",
      proposedBodyMarkdown: JSON.stringify({
        type: "createProject",
        id: projectId,
        title: "Agent project",
        goalId,
        domainSlug: null,
      }),
      actor: HIRE,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const resolved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(resolved.ok, true);

    const events = await eventsOfType(root, "project.created");
    const mine = events.filter((e) => (e.payload as { id?: string } | null)?.id === projectId);
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0].actor, { type: "agent", id: "hire-1", name: "Ada" });
  });

  it("operator projectCreate still logs the user", async () => {
    const goals = await applyGoalsCommand(root, { type: "createGoal", name: "Ops goal" });
    assert.equal(goals.ok, true);
    if (!goals.ok) return;
    const goalId = goals.value[goals.value.length - 1].id;
    const res = await projectCreate(root, { title: "Operator project", goalId });
    assert.equal(res.ok, true);
    const events = await eventsOfType(root, "project.created");
    const last = events[events.length - 1];
    assert.deepEqual(last.actor, { type: "user" });
  });

  it("kit.installed approve of an agent decision logs that agent", async () => {
    // The finance kit is already installed by the capture test above, so use a
    // fresh vault for this one.
    const sub = await fs.mkdtemp(path.join(os.tmpdir(), "lq-actor-kit-"));
    const kitRoot = path.join(sub, "vault");
    const created = await createVault(kitRoot, "ActorKitTest");
    assert.equal(created.ok, true);

    const decision = await createDecision(kitRoot, {
      target: { type: "kit-install", kit: "finance" },
      proposedTitle: "Install the finance kit",
      proposedBodyMarkdown: "",
      actor: HIRE,
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) {
      await fs.rm(sub, { recursive: true, force: true });
      return;
    }
    const resolved = await resolveDecision(kitRoot, decision.value.id, "approved");
    assert.equal(resolved.ok, true);

    const res = await readLog(kitRoot);
    assert.equal(res.ok, true);
    const installed = (res.ok ? res.value : []).filter((e) => e.type === "kit.installed");
    assert.equal(installed.length, 1);
    assert.deepEqual(installed[0].actor, { type: "agent", id: "hire-1", name: "Ada" });
    await fs.rm(sub, { recursive: true, force: true });
  });
});
