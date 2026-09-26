import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { vaultPaths } from "../src/paths.ts";
import { parseFrontmatter } from "../src/frontmatter.ts";
import {
  projectClose,
  projectCreate,
  projectGet,
  projectList,
  projectUpdate,
  PROJECT_TOOL_DEFS,
  commandForProjectTool,
} from "../src/projects.ts";
import { applyGoalsCommand, loadGoals } from "../src/goals.ts";
import { applyMapCommand, loadMapState } from "../src/map/persist.ts";
import { createDecision, resolveDecision, listDecisions } from "../src/decisions.ts";
import { WRITE_TOOL_NAMES } from "../src/implied-decision.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

describe("projects", () => {
  let dir: string;
  let root: string;
  let goalId: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-projects-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "Projects")).ok, true);
    const made = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Ship the studio",
      domainSlug: "financial",
    });
    assert.equal(made.ok, true, made.ok ? "" : made.error);
    if (!made.ok) return;
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    goalId = loaded.value[0].id;
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function readFrontmatter(id: string) {
    const raw = await fs.readFile(vaultPaths(root).projectMd(id), "utf8");
    return parseFrontmatter(raw);
  }

  it("projectCreate writes projects/{id}.md with goalId, domain, and open status", async () => {
    const created = await projectCreate(root, {
      title: "Ship the studio",
      goalId,
      domainSlug: "financial",
      bodyMarkdown: "Notes live here.",
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.equal(created.value.status, "open");
    assert.equal(created.value.goalId, goalId);
    assert.equal(created.value.domainSlug, "financial");

    const paths = vaultPaths(root);
    assert.equal(paths.projectsDir, path.join(vaultPaths(root).root, "projects"));
    const raw = await fs.readFile(paths.projectMd(created.value.id), "utf8");
    const { data, body } = parseFrontmatter(raw);
    assert.equal(data.title, "Ship the studio");
    assert.equal(data.goalId, goalId);
    assert.equal(data.domain, "financial");
    assert.equal(data.status, "open");
    assert.equal(typeof data.createdAt, "string");
    assert.equal(typeof data.updatedAt, "string");
    assert.equal(body.trim(), "Notes live here.");
  });

  it("an unassigned project stores domain: null and projectList returns it", async () => {
    const created = await projectCreate(root, {
      title: "No domain project",
      goalId,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const { data } = await readFrontmatter(created.value.id);
    assert.equal(data.domain, null);

    const listed = await projectList(root);
    assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
    if (!listed.ok) return;
    assert.equal(listed.value.skipped, 0);
    assert.ok(listed.value.records.some((r) => r.id === created.value.id));
  });

  it("operator projectUpdate changes the body and can close, with no decision file", async () => {
    const created = await projectCreate(root, { title: "Editable", goalId });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const before = await listDecisions(root);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    const decisionsBefore = before.value.length;

    const updated = await projectUpdate(root, created.value.id, {
      bodyMarkdown: "Rewritten notes.",
      status: "closed",
    });
    assert.equal(updated.ok, true, updated.ok ? "" : updated.error);
    if (!updated.ok) return;
    assert.equal(updated.value.status, "closed");
    assert.equal(updated.value.bodyMarkdown.trim(), "Rewritten notes.");

    const { data } = await readFrontmatter(created.value.id);
    assert.equal(data.status, "closed");
    assert.equal(String(data.title), "Editable");

    const after = await listDecisions(root);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.length, decisionsBefore, "operator write files no Decision");
  });

  it("projectUpdate can reopen and can retarget the goal", async () => {
    const created = await projectCreate(root, { title: "Reopenable", goalId });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const other = await applyGoalsCommand(root, { type: "createGoal", name: "Second" });
    assert.equal(other.ok, true);
    if (!other.ok) return;
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const otherId = loaded.value.find((g) => g.name === "Second")?.id;
    assert.ok(otherId);

    const reopened = await projectUpdate(root, created.value.id, { status: "open" });
    assert.equal(reopened.ok, true, reopened.ok ? "" : reopened.error);
    if (!reopened.ok) return;
    assert.equal(reopened.value.status, "open");

    const retargeted = await projectUpdate(root, created.value.id, { goalId: otherId });
    assert.equal(retargeted.ok, true, retargeted.ok ? "" : retargeted.error);
    if (!retargeted.ok) return;
    assert.equal(retargeted.value.goalId, otherId);
  });

  it("a status other than open or closed fails", async () => {
    const created = await projectCreate(root, { title: "Bad status", goalId });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const bad = await projectUpdate(root, created.value.id, {
      status: "planned" as never,
    });
    assert.equal(bad.ok, false);
    const still = await projectGet(root, created.value.id);
    assert.equal(still.ok, true);
    if (!still.ok) return;
    assert.equal(still.value.status, "open");
  });

  it("projectClose sets closed and keeps the file", async () => {
    const created = await projectCreate(root, { title: "Closable", goalId });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const closed = await projectClose(root, created.value.id);
    assert.equal(closed.ok, true, closed.ok ? "" : closed.error);
    if (!closed.ok) return;
    assert.equal(closed.value.status, "closed");
    const { data } = await readFrontmatter(created.value.id);
    assert.equal(data.status, "closed");
    // Closing again succeeds and stays closed.
    const again = await projectClose(root, created.value.id);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.value.status, "closed");
  });

  it("projectClose on a missing id fails", async () => {
    const res = await projectClose(root, "does-not-exist");
    assert.equal(res.ok, false);
  });

  it("a missing goal fails create and writes no file", async () => {
    const before = await fs.readdir(vaultPaths(root).projectsDir);
    const res = await projectCreate(root, {
      title: "Orphan",
      goalId: "no-such-goal",
    });
    assert.equal(res.ok, false);
    const after = await fs.readdir(vaultPaths(root).projectsDir);
    assert.deepEqual(after, before);
  });

  it("an empty title fails create", async () => {
    const res = await projectCreate(root, { title: "   ", goalId });
    assert.equal(res.ok, false);
  });

  it("an unknown or archived domain fails the write", async () => {
    const unknown = await projectCreate(root, {
      title: "Bad domain",
      goalId,
      domainSlug: "nope",
    });
    assert.equal(unknown.ok, false);

    const created = await projectCreate(root, { title: "Fine", goalId });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    // Archive the domain, then a further write naming it must fail.
    const metaPath = vaultPaths(root).domainJson("financial");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    meta.archivedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    const archived = await projectUpdate(root, created.value.id, {
      domainSlug: "financial",
    });
    assert.equal(archived.ok, false);

    meta.archivedAt = null;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  });

  it("a stored goalId survives the goal being deleted", async () => {
    const created = await projectCreate(root, { title: "Keeper", goalId });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    // A later delete of the goal must not cascade into the project file.
    const removed = await applyGoalsCommand(root, { type: "deleteGoal", id: goalId });
    assert.equal(removed.ok, true, removed.ok ? "" : removed.error);
    const after = await projectGet(root, created.value.id);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.goalId, goalId);
  });

  it("a task links.projectId survives applyMapCommand and loadMapState", async () => {
    // The goal-deletion test above removed the suite's goalId, so make a fresh one.
    const made2 = await applyGoalsCommand(root, { type: "createGoal", name: "Link goal" });
    assert.equal(made2.ok, true, made2.ok ? "" : made2.error);
    const loadedGoals = await loadGoals(root);
    assert.equal(loadedGoals.ok, true);
    if (!loadedGoals.ok) return;
    const liveGoalId = loadedGoals.value.find((g) => g.name === "Link goal")?.id;
    assert.ok(liveGoalId);

    const made = await projectCreate(root, { title: "Linkable", goalId: liveGoalId });
    assert.equal(made.ok, true, made.ok ? "" : made.error);
    if (!made.ok) return;

    const applied = await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "Point at the project",
        links: { projectId: made.value.id },
      },
      "user",
    );
    assert.equal(applied.ok, true, applied.ok ? "" : applied.error);

    const state = await loadMapState(root);
    assert.equal(state.ok, true, state.ok ? "" : state.error);
    if (!state.ok) return;
    const task = state.value.tasks.find((t) => t.title === "Point at the project");
    assert.ok(task, "task survives the round trip");
    assert.equal(task.links.projectId, made.value.id);
  });

  it("an unknown projectId on a task is stored, not rejected", async () => {
    const made2 = await applyGoalsCommand(root, { type: "createGoal", name: "Dangling goal" });
    assert.equal(made2.ok, true, made2.ok ? "" : made2.error);
    const loadedGoals = await loadGoals(root);
    assert.equal(loadedGoals.ok, true);
    if (!loadedGoals.ok) return;
    const liveGoalId = loadedGoals.value.find((g) => g.name === "Dangling goal")?.id;
    assert.ok(liveGoalId);

    const applied = await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "Dangling project link",
        links: { projectId: "missing-project" },
      },
      "user",
    );
    assert.equal(applied.ok, true, applied.ok ? "" : applied.error);
    if (!applied.ok) return;
    assert.equal(applied.value.tasks.find((t) => t.title === "Dangling project link")?.links.projectId, "missing-project");
  });
});

describe("agent project Decisions", () => {
  let dir: string;
  let root: string;
  let goalId: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-projects-decision-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "ProjectDecisions")).ok, true);
    const made = await applyGoalsCommand(root, { type: "createGoal", name: "Agent goal" });
    assert.equal(made.ok, true, made.ok ? "" : made.error);
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    goalId = loaded.value[0].id;
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("create_project files a pending Decision and writes no markdown; approve creates that id", async () => {
    const id = crypto.randomUUID();
    const command = {
      type: "createProject" as const,
      id,
      title: "Agent project",
      goalId,
      domainSlug: null,
      bodyMarkdown: "Agent notes.",
    };
    const created = await createDecision(root, {
      target: { type: "project" },
      proposedTitle: "Agent project",
      proposedBodyMarkdown: JSON.stringify(command),
      previousBodyMarkdown: null,
      domainSlugs: [],
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.target.type, "project");

    // Not on disk yet.
    await assert.rejects(() => fs.readFile(vaultPaths(root).projectMd(id), "utf8"));

    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const file = await projectGet(root, id);
    assert.equal(file.ok, true, file.ok ? "" : file.error);
    if (!file.ok) return;
    assert.equal(file.value.title, "Agent project");
    assert.equal(file.value.status, "open");
    assert.equal(file.value.goalId, goalId);
  });

  it("create_project reject creates nothing", async () => {
    const id = crypto.randomUUID();
    const created = await createDecision(root, {
      target: { type: "project" },
      proposedTitle: "Rejected project",
      proposedBodyMarkdown: JSON.stringify({
        type: "createProject",
        id,
        title: "Rejected project",
        goalId,
        domainSlug: null,
      }),
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const rejected = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(rejected.ok, true, rejected.ok ? "" : rejected.error);
    const got = await projectGet(root, id);
    assert.equal(got.ok, false);
  });

  it("close_project leaves the file open until approve", async () => {
    const created = await projectCreate(root, { title: "To close", goalId });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;

    const decision = await createDecision(root, {
      target: { type: "project" },
      proposedTitle: created.value.title,
      proposedBodyMarkdown: JSON.stringify({ type: "closeProject", id: created.value.id }),
      previousBodyMarkdown: JSON.stringify(created.value),
      domainSlugs: [],
      actor: agent,
    });
    assert.equal(decision.ok, true, decision.ok ? "" : decision.error);
    if (!decision.ok) return;

    const stillOpen = await projectGet(root, created.value.id);
    assert.equal(stillOpen.ok, true);
    if (!stillOpen.ok) return;
    assert.equal(stillOpen.value.status, "open", "file untouched before approve");

    const approved = await resolveDecision(root, decision.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const nowClosed = await projectGet(root, created.value.id);
    assert.equal(nowClosed.ok, true);
    if (!nowClosed.ok) return;
    assert.equal(nowClosed.value.status, "closed");
  });

  it("approve of a non-project command body fails and leaves the decision pending", async () => {
    const created = await createDecision(root, {
      target: { type: "project" },
      proposedTitle: "Bogus",
      proposedBodyMarkdown: JSON.stringify({ type: "deleteEverything" }),
      actor: agent,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, false);
    const still = await listDecisions(root);
    assert.equal(still.ok, true);
    if (!still.ok) return;
    const found = still.value.find((d) => d.id === created.value.id);
    assert.equal(found?.status, "pending");
  });
});

describe("project agent tools", () => {
  it("exposes create_project and close_project and nothing else", () => {
    const names = PROJECT_TOOL_DEFS.map((t) => t.name);
    assert.deepEqual(names, ["create_project", "close_project"]);
  });

  it("commandForProjectTool builds a createProject and a closeProject command", () => {
    const created = commandForProjectTool("create_project", {
      title: "T",
      goalId: "g1",
      domainSlug: "health",
      body: "notes",
    });
    assert.ok(created);
    assert.equal(created.type, "createProject");
    if (created.type !== "createProject") return;
    assert.equal(created.title, "T");
    assert.equal(created.goalId, "g1");
    assert.equal(created.domainSlug, "health");
    assert.equal(created.bodyMarkdown, "notes");
    assert.equal(typeof created.id, "string");

    const closed = commandForProjectTool("close_project", { id: "p1" });
    assert.ok(closed);
    assert.deepEqual(closed, { type: "closeProject", id: "p1" });

    assert.equal(commandForProjectTool("update_project", {}), null);
    assert.equal(commandForProjectTool("delete_project", {}), null);
  });

  it("both project write tools are in WRITE_TOOL_NAMES", () => {
    assert.ok(WRITE_TOOL_NAMES.includes("create_project"));
    assert.ok(WRITE_TOOL_NAMES.includes("close_project"));
  });
});
