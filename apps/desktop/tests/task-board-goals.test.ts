import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

const src = read("src/components/tasks/TaskBoard.tsx");
const act = read("src/pages/ActPage.tsx");

describe("TaskBoard goal picker", () => {
  it("links tasks to vault Goals, not period goals", () => {
    assert.match(src, /goalId/);
    assert.equal(src.includes("periodGoalId"), false);
    assert.equal(src.includes("periodGoals"), false);
    assert.match(src, /goals: Goal\[\]/);
  });
});

describe("TaskBoard open from query", () => {
  it("expands initialOpenId when the task exists", () => {
    assert.match(src, /initialOpenId/);
    assert.match(src, /setOpenId\(initialOpenId\)/);
    assert.match(src, /state\.tasks\.some/);
  });

  it("ActPage passes the task search param into TaskBoard", () => {
    assert.match(act, /useSearchParams/);
    assert.match(act, /params\.get\("task"\)/);
    assert.match(act, /initialOpenId=/);
  });
});
