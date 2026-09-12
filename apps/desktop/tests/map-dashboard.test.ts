import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

describe("Life Map dashboard", () => {
  it("imports dashboardDays from vault-core/map and has no period-goal paint", () => {
    const src = read("src/components/map/Dashboard.tsx");
    assert.match(
      src,
      /import \{[^}]*\bdashboardDays\b[^}]*\} from ["']@lifequest\/vault-core\/map["']/,
    );
    assert.equal(src.includes("createPeriodGoal"), false);
    assert.equal(src.includes("startPaint"), false);
    assert.equal(src.includes("KeyPanel"), false);
    assert.match(src, /EventPanel/);
  });

  it("EventPanel adds createEvent with a domain picker", () => {
    const panel = read("src/components/map/EventPanel.tsx");
    assert.match(panel, /type: "createEvent"/);
    assert.match(panel, /domainSlug/);
    assert.match(panel, /goalId/);
    assert.equal(panel.includes("createPeriodGoal"), false);
    assert.equal(panel.includes("PALETTE"), false);
  });
});

describe("Life Map theme", () => {
  it("calendar chrome uses theme tokens instead of light-mode hex", () => {
    const src = read("src/styles/map.css");
    const leftovers = [
      "#fbfcfd",
      "#eef3f8",
      "#dbe7f3",
      "#eef1f4",
      "#fff3cd",
      "#e0c36a",
      "#5c4a12",
      "#d5dbe1",
      "#f3f4f6",
      "#8b949e",
    ];
    for (const hex of leftovers) {
      assert.equal(
        src.toLowerCase().includes(hex),
        false,
        `map.css still hardcodes ${hex}`,
      );
    }
    assert.match(src, /\.life-map \.day-cell[\s\S]*?background:\s*var\(--bg-elevated\)/);
    assert.match(src, /\.life-map \.month-name[\s\S]*?background:\s*var\(--bg-muted\)/);
    assert.match(src, /\[data-map-color="gold"\]/);
    assert.match(src, /--map-event-default/);
  });
});
