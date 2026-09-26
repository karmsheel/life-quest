import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { createDecision, resolveDecision, listDecisions } from "../src/decisions.ts";
import { loadGoals, applyGoalsCommand } from "../src/goals.ts";
import { applyMapCommand, loadMapState } from "../src/map/persist.ts";
import { commandForTool } from "../src/map/tools.ts";
import { USER_ACTOR, type GoalsCommand } from "../src/types.ts";

const agent = { type: "agent" as const, id: "a1", name: "Hermes" };

async function goalNames(root: string): Promise<string[]> {
  const loaded = await loadGoals(root);
  assert.equal(loaded.ok, true, loaded.ok ? "" : loaded.error);
  if (!loaded.ok) return [];
  return loaded.value.map((g) => g.name);
}

async function dayTypeNames(root: string): Promise<string[]> {
  const state = await loadMapState(root);
  assert.equal(state.ok, true, state.ok ? "" : state.error);
  if (!state.ok) return [];
  return state.value.dayTypes.map((d) => d.name);
}

describe("agent decisions for goals and day templates", () => {
  let dir: string;
  let root: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-agent-decisions-"));
    root = path.join(dir, "vault");
    assert.equal((await createVault(root, "AgentDecisions")).ok, true);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("create_goal files a pending Decision; goals.json unchanged until approve", async () => {
    const before = await goalNames(root);
    const command: GoalsCommand = {
      type: "createGoal",
      name: "Agent goal",
      domainSlug: "health",
    };
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Agent goal",
      proposedBodyMarkdown: JSON.stringify(command),
      domainSlugs: ["health"],
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.target.type, "goal");
    assert.deepEqual(created.value.domainSlugs, ["health"]);
    assert.deepEqual(await goalNames(root), before, "goals.json unchanged before approve");

    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    assert.ok((await goalNames(root)).includes("Agent goal"), "approve adds the goal");
  });

  it("create_goal reject leaves goals.json unchanged", async () => {
    const before = await goalNames(root);
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Rejected goal",
      proposedBodyMarkdown: JSON.stringify({ type: "createGoal", name: "Rejected goal" }),
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const rejected = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(rejected.ok, true);
    assert.deepEqual(await goalNames(root), before, "reject must not add the goal");
  });

  it("update_goal records previousBodyMarkdown of the current goal", async () => {
    const seeded = await applyGoalsCommand(root, { type: "createGoal", name: "Existing goal" });
    assert.equal(seeded.ok, true);
    if (!seeded.ok) return;
    const existing = seeded.value[seeded.value.length - 1];
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Existing goal renamed",
      proposedBodyMarkdown: JSON.stringify({
        type: "updateGoal",
        id: existing.id,
        name: "Existing goal renamed",
      }),
      previousBodyMarkdown: JSON.stringify(existing),
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.equal(created.value.previousBodyMarkdown, JSON.stringify(existing));
    await resolveDecision(root, created.value.id, "approved");
    assert.ok((await goalNames(root)).includes("Existing goal renamed"));
  });

  it("a goal decision with a non-JSON body fails approve and stays pending", async () => {
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Broken goal",
      proposedBodyMarkdown: "not json at all",
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, false, "approve must fail on a non-JSON goal body");
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const still = listed.value.find((d) => d.id === created.value.id);
    assert.equal(still?.status, "pending", "a failed approve leaves the decision pending");
  });

  it("create_day_type files a pending Decision; dayTypes unchanged until approve", async () => {
    const before = await dayTypeNames(root);
    const command = commandForTool("create_day_type", { name: "Deep work", color: "teal" });
    assert.ok(command);
    const created = await createDecision(root, {
      target: { type: "day-template" },
      proposedTitle: "Deep work",
      proposedBodyMarkdown: JSON.stringify(command),
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.equal(created.value.status, "pending");
    assert.equal(created.value.target.type, "day-template");
    assert.deepEqual(created.value.domainSlugs, []);
    assert.deepEqual(await dayTypeNames(root), before, "dayTypes unchanged before approve");

    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    assert.ok((await dayTypeNames(root)).includes("Deep work"), "approve adds the day type");
  });

  it("delete_day_type reject leaves dayTypes unchanged", async () => {
    // Seed a throwaway day type directly (operator path) so there is something to delete.
    const seeded = await applyMapCommand(
      root,
      { type: "createDayType", name: "Deletable", color: "gold" },
      "user",
    );
    assert.equal(seeded.ok, true, seeded.ok ? "" : seeded.error);
    const state = await loadMapState(root);
    assert.equal(state.ok, true);
    if (!state.ok) return;
    const target = state.value.dayTypes[0];
    assert.ok(target, "seeded vault has at least one day type");
    const before = await dayTypeNames(root);
    const command = commandForTool("delete_day_type", { id: target!.id });
    assert.ok(command);
    const created = await createDecision(root, {
      target: { type: "day-template" },
      proposedTitle: target!.name,
      proposedBodyMarkdown: JSON.stringify(command),
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const rejected = await resolveDecision(root, created.value.id, "rejected");
    assert.equal(rejected.ok, true);
    assert.deepEqual(await dayTypeNames(root), before, "reject must not delete the day type");
  });

  it("set_default_weekly_items approve applies through applyMapCommand as user", async () => {
    const command = commandForTool("set_default_weekly_items", {
      items: [{ id: "wi-1", text: "Review" }],
    });
    assert.ok(command);
    const created = await createDecision(root, {
      target: { type: "day-template" },
      proposedTitle: "Day template",
      proposedBodyMarkdown: JSON.stringify(command),
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const state = await loadMapState(root);
    assert.equal(state.ok, true);
    if (!state.ok) return;
    assert.equal(state.value.defaultWeek.weeklyItems.length, 1);
    assert.equal(state.value.defaultWeek.weeklyItems[0]?.text, "Review");
  });

  it("a day-template decision with a non-JSON body fails approve and stays pending", async () => {
    const created = await createDecision(root, {
      target: { type: "day-template" },
      proposedTitle: "Day template",
      proposedBodyMarkdown: "nope",
      actor: agent,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const approved = await resolveDecision(root, created.value.id, "approved");
    assert.equal(approved.ok, false, "approve must fail on a non-JSON day-template body");
    const listed = await listDecisions(root);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(
      listed.value.find((d) => d.id === created.value.id)?.status,
      "pending",
    );
  });

  it("goal and day-template targets are not treated as library notes", async () => {
    const created = await createDecision(root, {
      target: { type: "goal" },
      proposedTitle: "Labelled goal",
      proposedBodyMarkdown: JSON.stringify({ type: "createGoal", name: "Labelled goal" }),
      actor: USER_ACTOR,
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    assert.match(created.value.title, /Goal/);
    const dt = await createDecision(root, {
      target: { type: "day-template" },
      proposedTitle: "Named template",
      proposedBodyMarkdown: "irrelevant",
      actor: agent,
    });
    assert.equal(dt.ok, true, dt.ok ? "" : dt.error);
    if (!dt.ok) return;
    assert.match(dt.value.title, /Day template/);
  });
});
