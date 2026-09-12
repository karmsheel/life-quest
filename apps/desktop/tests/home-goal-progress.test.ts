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
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /filterByLens/);
    assert.match(home, /snapshot\?\.goals/);
    assert.match(home, /status\s*===\s*["']open["']/);
    assert.match(home, /home-card/);
    assert.match(home, /Goals/);
  });

  it("shows numeric current/target and pace helper when a deadline exists", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /goal\.current/);
    assert.match(home, /goal\.target/);
    assert.match(home, /goal\.metric/);
    assert.match(home, /formatGoalPace|goalPace/);
    assert.match(home, /type=["']number["']/);
  });

  it("shows definition-of-done text with a checkbox that marks done via updateGoal", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /definitionOfDone/);
    assert.match(home, /type=["']checkbox["']/);
    assert.match(home, /type:\s*["']updateGoal["']/);
    assert.match(home, /status:\s*["']done["']/);
    assert.match(home, /goalsApply/);
  });

  it("keeps the checkbox checked while applying and surfaces apply errors", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /if\s*\(\s*!result\.ok\s*\)/);
    assert.match(home, /className="form-error"/);
    assert.match(home, /role="alert"/);
    assert.match(home, /setError\(/);
    assert.equal(
      /checked=\{false\}/.test(home),
      false,
      "DoD checkbox must not be locked unchecked; keep it checked while apply is in flight",
    );
    assert.match(home, /checked=\{/);
  });

  it("filters goals with the domain lens (recordVisible / filterByLens)", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /filterByLens\(/);
    assert.match(home, /useDomainLens/);
  });

  it("has no streaks, points, XP, or celebration chrome", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.equal(/streak/i.test(home), false);
    assert.equal(/\bpoints\b/i.test(home), false);
    assert.equal(/\bxp\b/i.test(home), false);
    assert.equal(/celebration/i.test(home), false);
    assert.equal(/scoreboard/i.test(home), false);
  });

  it("does not restyle Life Map Dashboard.tsx for this issue", () => {
    const mapDash = read("src/components/map/Dashboard.tsx");
    assert.equal(mapDash.includes("definitionOfDone"), false);
    assert.equal(mapDash.includes("formatGoalPace"), false);
  });
});
