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

describe("plan hook shell (KAR-46)", () => {
  it("GoalsPage contains 'Plan this period' button", () => {
    const page = read("src/pages/GoalsPage.tsx");
    assert.match(page, /Plan this period/);
  });

  it("GoalsPage defaults cadence to weekly", () => {
    const page = read("src/pages/GoalsPage.tsx");
    assert.match(page, /weekly/);
    // Default state or value
    assert.match(page, /useState.*weekly|value="weekly"|default.*weekly/);
  });

  it("GoalsPage cadence options include monthly, quarterly, yearly", () => {
    const page = read("src/pages/GoalsPage.tsx");
    assert.match(page, /monthly/);
    assert.match(page, /quarterly/);
    assert.match(page, /yearly/);
  });

  it("GoalsPage does NOT include a daily plan cadence option", () => {
    const page = read("src/pages/GoalsPage.tsx");
    // "daily" must not appear as a plan cadence option
    // Check that there's no "daily" in the cadence picker options
    const cadenceSection = page.slice(
      page.indexOf("weekly"),
      page.indexOf("Plan this period"),
    );
    assert.doesNotMatch(cadenceSection, /"daily"/);
    assert.doesNotMatch(cadenceSection, /'daily'/);
    assert.doesNotMatch(cadenceSection, /`daily`/);
  });

  it("GoalsPage mentions planningStartOrResume, requestSession, and currentPeriod", () => {
    const page = read("src/pages/GoalsPage.tsx");
    assert.match(page, /planningStartOrResume/);
    assert.match(page, /requestSession/);
    assert.match(page, /currentPeriod/);
  });
});
