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

  it("filters the nav rail by the active wing and keeps pinned items", () => {
    const src = read("src/components/shell/NavRail.tsx");
    assert.match(src, /useWing/);
    assert.match(src, /item\.wing === active/);
    assert.match(src, /!item\.wing/);
    assert.match(src, /to=["']\/home["']/);
  });

  it("renders Outlet in AppShell instead of a children prop", () => {
    const src = read("src/components/shell/AppShell.tsx");
    assert.match(
      src,
      /import \{[^}]*\bOutlet\b[^}]*\} from ["']react-router-dom["']/,
    );
    assert.match(src, /<Outlet\s*\/>/);
    assert.match(
      src,
      /className=["']shell__content["']>\s*<Outlet\s*\/>/,
    );
    assert.equal(/\bchildren\b/.test(src), false);
  });

  it("uses one layout AppShell with nested page routes", () => {
    const src = read("src/App.tsx");
    assert.equal(src.includes("ShellRoute"), false);
    assert.equal(src.includes("<AppShell>"), false);
    assert.match(src, /<AppShell\s*\/>/);

    const layoutOpen =
      /<Route\s+element=\{[\s\S]*?<AppShell\s*\/>[\s\S]*?\}\s*>/.exec(src);
    assert.ok(
      layoutOpen,
      "expected a parent Route whose element is AppShell (or RequireVault wrapping AppShell)",
    );

    const afterOpen = src.slice(layoutOpen.index + layoutOpen[0].length);
    const layoutEnd = afterOpen.indexOf("</Route>");
    assert.ok(layoutEnd >= 0, "expected the layout Route to close");
    const nested = afterOpen.slice(0, layoutEnd);

    assert.match(nested, /<Route\s+path=["']\/home["']/);
    assert.match(nested, /<Route\s+path=["']\/chart["']/);
    assert.match(nested, /<Route\s+path=["']\/act["']/);
    assert.match(nested, /<Route\s+path=["']\/log["']/);
    assert.equal(nested.includes("/welcome"), false);

    assert.match(
      src,
      /<Route\s+path=["']\/welcome["']\s+element=\{<WelcomePage\s*\/>\}\s*\/>/,
    );
  });
});
