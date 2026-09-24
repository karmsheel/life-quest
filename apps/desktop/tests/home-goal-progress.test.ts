import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("Home dashboard live goal progress (KAR-8)", () => {
  it("lists open goals for the current lens from snapshot.goals", () => {
    const widget = read("src/pages/home-pins/GoalProgressCard.tsx");
    const home = read("src/pages/HomePage.tsx");
    assert.match(widget, /filterByLens/);
    assert.match(widget, /snapshot\?\.goals/);
    assert.match(widget, /status\s*===\s*["']open["']/);
    assert.match(widget, /home-card/);
    assert.match(widget, /Goals/);
    assert.match(home, /GoalProgressCard/);
  });

  it("shows numeric current/target and pace helper when a deadline exists", () => {
    const widget = read("src/pages/home-pins/GoalProgressCard.tsx");
    assert.match(widget, /goal\.current/);
    assert.match(widget, /goal\.target/);
    assert.match(widget, /goal\.metric/);
    assert.match(widget, /formatGoalPace|goalPace/);
    assert.match(widget, /type=["']number["']/);
  });

  it("shows definition-of-done text with a checkbox that marks done via updateGoal", () => {
    const widget = read("src/pages/home-pins/GoalProgressCard.tsx");
    assert.match(widget, /definitionOfDone/);
    assert.match(widget, /type=["']checkbox["']/);
    assert.match(widget, /type:\s*["']updateGoal["']/);
    assert.match(widget, /status:\s*["']done["']/);
    assert.match(widget, /goalsApply/);
  });

  it("keeps the checkbox checked while applying and surfaces apply errors", () => {
    const widget = read("src/pages/home-pins/GoalProgressCard.tsx");
    assert.match(widget, /if\s*\(\s*!result\.ok\s*\)/);
    assert.match(widget, /className="form-error"/);
    assert.match(widget, /role="alert"/);
    assert.match(widget, /setError\(/);
    assert.equal(
      /checked=\{false\}/.test(widget),
      false,
      "DoD checkbox must not be locked unchecked; keep it checked while apply is in flight",
    );
    assert.match(widget, /checked=\{/);
  });

  it("filters goals with the domain lens (recordVisible / filterByLens)", () => {
    const widget = read("src/pages/home-pins/GoalProgressCard.tsx");
    const home = read("src/pages/HomePage.tsx");
    assert.match(widget, /filterByLens\(/);
    assert.match(widget, /useDomainLens/);
    assert.match(home, /useDomainLens/);
  });

  it("has no streaks, points, XP, or celebration chrome", () => {
    const home = read("src/pages/HomePage.tsx");
    const widget = read("src/pages/home-pins/GoalProgressCard.tsx");
    assert.equal(/streak/i.test(home), false);
    assert.equal(/\bpoints\b/i.test(home), false);
    assert.equal(/\bxp\b/i.test(home), false);
    assert.equal(/celebration/i.test(home), false);
    assert.equal(/scoreboard/i.test(home), false);
    assert.equal(/streak/i.test(widget), false);
    assert.equal(/\bpoints\b/i.test(widget), false);
    assert.equal(/\bxp\b/i.test(widget), false);
    assert.equal(/celebration/i.test(widget), false);
    assert.equal(/scoreboard/i.test(widget), false);
  });

  it("does not restyle Life Map Dashboard.tsx for this issue", () => {
    const mapDash = read("src/components/map/Dashboard.tsx");
    assert.equal(mapDash.includes("definitionOfDone"), false);
    assert.equal(mapDash.includes("formatGoalPace"), false);
  });
});
