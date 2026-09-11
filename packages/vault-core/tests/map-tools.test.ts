import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  commandForGoalTool,
  commandForTool,
  GOALS_TOOL_DEFS,
  MAP_TOOL_DEFS,
} from "../src/map/tools.ts";

describe("commandForTool", () => {
  it("maps create_event", () => {
    const cmd = commandForTool("create_event", {
      year: 2026,
      title: "File",
      date: "2026-04-15",
    });
    assert.deepEqual(cmd, {
      type: "createEvent",
      year: 2026,
      title: "File",
      date: "2026-04-15",
    });
  });
  it("maps create_task links.goalId", () => {
    const cmd = commandForTool("create_task", {
      title: "Run",
      links: { goalId: "g1" },
    });
    assert.deepEqual(cmd, {
      type: "createTask",
      title: "Run",
      links: { goalId: "g1" },
    });
  });
  it("returns null for get_state, get_doctrine, list_goals", () => {
    assert.equal(commandForTool("get_state", {}), null);
    assert.equal(commandForTool("get_doctrine", {}), null);
    assert.equal(commandForGoalTool("list_goals", {}), null);
  });
  it("returns null for unknown and removed period-goal tools", () => {
    assert.equal(commandForTool("create_period_goal", {}), null);
    assert.equal(commandForTool("forge_document", {}), null);
  });
});

describe("tool defs", () => {
  it("exposes event tools and goal tools, not period goals", () => {
    const mapNames = MAP_TOOL_DEFS.map((t) => t.name);
    const goalNames = GOALS_TOOL_DEFS.map((t) => t.name);
    assert.equal(mapNames.includes("create_event"), true);
    assert.equal(mapNames.includes("create_period_goal"), false);
    assert.deepEqual(goalNames, [
      "list_goals",
      "create_goal",
      "update_goal",
      "delete_goal",
    ]);
  });
});

describe("commandForGoalTool", () => {
  it("maps create_goal", () => {
    assert.deepEqual(commandForGoalTool("create_goal", { name: "Ship" }), {
      type: "createGoal",
      name: "Ship",
    });
  });
});
