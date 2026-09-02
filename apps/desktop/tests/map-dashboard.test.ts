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
  it("imports COLOR_IDS and dashboardDays from vault-core/map", () => {
    const src = read("src/components/map/Dashboard.tsx");
    assert.match(
      src,
      /import \{[^}]*\bCOLOR_IDS\b[^}]*\} from ["']@lifequest\/vault-core\/map["']/,
    );
    assert.match(
      src,
      /import \{[^}]*\bdashboardDays\b[^}]*\} from ["']@lifequest\/vault-core\/map["']/,
    );
  });

  it("paints key colors with themed data-map-color, not hardcoded PALETTE hex", () => {
    const dashboard = read("src/components/map/Dashboard.tsx");
    assert.match(dashboard, /data-map-color=\{/);
    assert.equal(dashboard.includes("PALETTE"), false);

    const month = read("src/components/map/MonthPage.tsx");
    assert.match(month, /data-map-color=\{/);
    assert.equal(month.includes("PALETTE"), false);

    const keys = read("src/components/map/KeyPanel.tsx");
    assert.match(keys, /data-map-color=\{/);
    assert.equal(keys.includes("PALETTE"), false);
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
  });
});
