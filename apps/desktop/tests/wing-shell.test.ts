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
    assert.equal(topBar.includes("Agent locked"), false);
    assert.equal(topBar.includes("setLock"), false);
    assert.equal(topBar.includes("lock-switch"), false);

    const tabs = read("src/components/shell/WingTabs.tsx");
    assert.match(tabs, /role="tablist"/);
    assert.match(tabs, /aria-label="App wing"/);
    assert.match(tabs, /role="tab"/);
    assert.match(tabs, /ArrowLeft/);
    assert.match(tabs, /ArrowRight/);

    const css = read("src/styles/global.css");
    assert.match(css, /\.top-bar__wings\s*\{/);
    assert.equal(css.includes(".top-bar__vault-name"), false);
    assert.equal(css.includes(".lock-switch"), false);
    assert.equal(css.includes(".lock-label"), false);
  });

  it("renders the domain switcher as open segmented buttons", () => {
    const src = read("src/components/shell/DomainSwitcher.tsx");
    assert.match(src, /className="ui-segmented domain-switcher__tabs"/);
    assert.match(src, /ui-segmented__option/);
    assert.match(src, /role="radiogroup"/);
    assert.match(src, /ArrowLeft/);
    assert.match(src, /ArrowRight/);
    assert.equal(src.includes("<select"), false);
    assert.equal(src.includes("domain-switcher__select"), false);

    const css = read("src/styles/global.css");
    assert.equal(css.includes(".domain-switcher__select"), false);
    assert.match(css, /\.domain-switcher__tabs\s*\{/);
  });

  it("filters the nav rail by the active wing and keeps pinned items", () => {
    const src = read("src/components/shell/NavRail.tsx");
    assert.match(src, /useWing/);
    assert.match(src, /item\.wing === active/);
    assert.match(src, /item\.pin === ["']top["']/);
    assert.match(src, /item\.pin === ["']bottom["']/);
    assert.equal(src.includes("nav-rail__brand"), false);
    assert.equal(src.includes("useUnlockedRooms"), false);
    assert.equal(src.includes("nav-rail__link--locked"), false);
    assert.equal(src.includes("nav-rail__lock"), false);
  });

  it("pins Life-Chain and Decisions at the top, then a divider, then wing items and Log", () => {
    const src = read("src/components/shell/NavRail.tsx");
    assert.match(
      src,
      /topPinned\.map\(renderItem\)[\s\S]*nav-rail__divider[\s\S]*wingItems\.map\(renderItem\)[\s\S]*nav-rail__divider[\s\S]*bottomPinned\.map\(renderItem\)/,
    );
    const dividers = src.match(/nav-rail__divider/g) ?? [];
    assert.equal(dividers.length, 2);
  });

  it("labels the desktop package version at the bottom of the nav rail", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    assert.equal(pkg.version, "0.1.0");

    const src = read("src/components/shell/NavRail.tsx");
    assert.match(src, /import \{ version \} from ["']\.\.\/\.\.\/\.\.\/package\.json["']/);
    assert.match(
      src,
      /bottomPinned\.map\(renderItem\)[\s\S]*nav-rail__version[\s\S]*v\{version\}/,
    );

    const css = read("src/styles/global.css");
    assert.match(css, /\.nav-rail__version\s*\{[^}]*text-align:\s*center/);
    assert.match(css, /\.nav-rail__version\s*\{[^}]*color:\s*var\(--muted\)/);
  });

  it("labels Dashboard and Life-Chain on the page", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /home-dashboard__eyebrow[^>]*>Dashboard</);
    assert.equal(home.includes('muted">Home<'), false);

    const chain = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(chain, />Life-Chain</);
    assert.equal(chain.includes("Life Signal Chain"), false);
  });

  it("does not gate Plan or Execute pages behind a room lock", () => {
    for (const file of [
      "src/pages/ChartPage.tsx",
      "src/pages/ArchitecturePage.tsx",
      "src/pages/ActPage.tsx",
      "src/pages/RoomPage.tsx",
      "src/pages/DailySchedulePage.tsx",
    ]) {
      const src = read(file);
      assert.equal(src.includes("RoomLockGate"), false, file);
    }
    const css = read("src/styles/global.css");
    assert.equal(css.includes(".room-lock-gate"), false);
    assert.equal(css.includes(".nav-rail__link--locked"), false);
  });

  it("renders Outlet in AppShell instead of a children prop", () => {
    const src = read("src/components/shell/AppShell.tsx");
    assert.match(
      src,
      /import \{[^}]*\bOutlet\b[^}]*\} from ["']react-router-dom["']/,
    );
    assert.match(src, /<Outlet\s*\/>/);
    assert.match(src, /["']shell__content["']/);
    assert.match(src, /shell__content[\s\S]*?<Outlet\s*\/>/);
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
    assert.match(nested, /<Route\s+path=["']\/goals["']/);
    assert.match(nested, /<Route\s+path=["']\/chart["']/);
    assert.match(nested, /<Route\s+path=["']\/act["']/);
    assert.match(nested, /<Route\s+path=["']\/daily["']/);
    assert.match(nested, /<Route\s+path=["']\/review\/:cadence["']/);
    assert.match(nested, /<Route\s+path=["']\/log["']/);
    assert.equal(nested.includes("/welcome"), false);

    assert.match(
      src,
      /<Route\s+path=["']\/welcome["']\s+element=\{<WelcomePage\s*\/>\}\s*\/>/,
    );
  });

  it("imports ReviewPage for Review cadence routes", () => {
    const src = read("src/App.tsx");
    assert.match(
      src,
      /import ReviewPage from ["']@\/pages\/ReviewPage["']/,
    );
  });

  it("Daily Schedule page has clock and leftover", () => {
    const src = read("src/pages/DailySchedulePage.tsx");
    assert.match(src, />Daily Schedule</);
    assert.match(src, />Clock</);
    assert.match(src, />Leftover</);
    assert.match(src, /ensureLiveDay/);
    assert.match(src, /liveDayView/);
    assert.equal(src.includes("RoomLockGate"), false);
  });
});
