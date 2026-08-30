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

describe("wing shell wiring", () => {
  it("mounts WingProvider inside AppShell", () => {
    const src = read("src/components/shell/AppShell.tsx");
    assert.match(
      src,
      /import \{ WingProvider \} from ["']\.\/WingProvider["']/,
    );
    assert.match(src, /<WingProvider>/);
    assert.match(src, /<\/WingProvider>/);
  });

  it("replaces the TopBar vault name with WingTabs", () => {
    const topBar = read("src/components/shell/TopBar.tsx");
    assert.match(
      topBar,
      /import \{ WingTabs \} from ["']\.\/WingTabs["']/,
    );
    assert.match(topBar, /<WingTabs\s*\/>/);
    assert.equal(topBar.includes("top-bar__vault-name"), false);
    assert.equal(topBar.includes("lifequest.name"), false);

    const tabs = read("src/components/shell/WingTabs.tsx");
    assert.match(tabs, /role="tablist"/);
    assert.match(tabs, /aria-label="App wing"/);
    assert.match(tabs, /role="tab"/);
    assert.match(tabs, /ArrowLeft/);
    assert.match(tabs, /ArrowRight/);

    const css = read("src/styles/global.css");
    assert.match(css, /\.top-bar__wings\s*\{/);
    assert.equal(css.includes(".top-bar__vault-name"), false);
  });
});
