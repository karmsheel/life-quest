import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/tasks/TaskBoard.tsx"),
  "utf8",
);

describe("TaskBoard goal picker", () => {
  it("links tasks to vault Goals, not period goals", () => {
    assert.match(src, /goalId/);
    assert.equal(src.includes("periodGoalId"), false);
    assert.equal(src.includes("periodGoals"), false);
    assert.match(src, /goals: Goal\[\]/);
  });
});
