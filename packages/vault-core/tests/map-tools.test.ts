import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandForTool } from "../src/map/tools.ts";

describe("commandForTool", () => {
  it("maps create_task", () => {
    const cmd = commandForTool("create_task", { title: "Run" });
    assert.deepEqual(cmd, { type: "createTask", title: "Run" });
  });
  it("returns null for get_state and get_doctrine", () => {
    assert.equal(commandForTool("get_state", {}), null);
    assert.equal(commandForTool("get_doctrine", {}), null);
  });
  it("returns null for unknown tools", () => {
    assert.equal(commandForTool("forge_document", {}), null);
  });
});
