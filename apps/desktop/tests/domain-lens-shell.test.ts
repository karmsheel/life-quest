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

describe("main-process domain lens", () => {
  it("does not seed or persist the active domain pref on vault open", () => {
    const src = read("electron/vault-service.ts");
    assert.equal(src.includes("Seed active domain"), false);
    assert.match(src, /currentLens/);
    assert.match(src, /domainSetActive\(slug: string \| null\)/);
    assert.equal(
      /await setActiveDomain\(snapshot\.lifequest\.id/.test(src),
      false,
    );
    assert.match(src, /libraryList/);
    assert.match(src, /libraryCreate/);
  });

  it("MCP and get_doctrine use the in-memory lens", () => {
    const mcp = read("electron/pairing-door.ts");
    // The door passes the live lens per request and never reads a persisted
    // one, so a lens change does not need a vault write to take effect.
    assert.match(mcp, /activeSlug|executeTool/);
    assert.equal(mcp.includes("getActiveDomain"), false);

    const tools = read("electron/map-tools.ts");
    assert.match(tools, /domains:/);
    assert.match(tools, /activeSlug/);
  });
});

describe("renderer domain lens", () => {
  it("drops the first-live-domain fallback and exposes Overview", () => {
    const hook = read("src/components/shell/useActiveDomain.ts");
    assert.equal(hook.includes("live[0]"), false);
    assert.match(hook, /useDomainLens/);
    assert.match(hook, /overviewLens|kind === "overview"|kind === 'overview'/);

    const provider = read("src/state/VaultProvider.tsx");
    assert.match(provider, /setLens/);
    assert.match(provider, /overviewLens/);
    assert.match(provider, /domainGetActive/);

    const switcher = read("src/components/shell/DomainSwitcher.tsx");
    assert.match(switcher, /Overview/);
    assert.match(switcher, /aria-label="Domain lens"/);
    assert.match(switcher, /overviewLens/);
    assert.match(switcher, /OVERVIEW_KEY = ["']__overview__["']/);
    assert.match(switcher, /!result\.ok/);
    assert.match(switcher, /result\.error/);

    const settings = read("src/components/settings/SettingsDomains.tsx");
    assert.match(settings, /setActiveSlug\(null\)/);
    assert.equal(settings.includes("setActiveSlug(result.value.slug)"), false);
  });
});

describe("lens filtering", () => {
  it("Signal-Chain timeline has no in-page domain filter", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.equal(src.includes("recordVisible"), false);
    assert.equal(src.includes("filterDomain"), false);
    assert.equal(src.includes("lensSlug"), false);
    assert.match(src, /useDomainLens/);
    assert.match(src, /signalVisible/);
    assert.match(src, /- unassigned -/);
  });

  it("Home, Log, Act, Personnel, and Decisions use recordVisible", () => {
    for (const file of [
      "src/pages/home-pins/DoctrineCard.tsx",
      "src/pages/home-pins/GoalProgressCard.tsx",
      "src/pages/home-pins/DeadlineBanner.tsx",
      "src/pages/ActPage.tsx",
      "src/components/log/LifeLogFeed.tsx",
      "src/components/personnel/PersonnelStudio.tsx",
      "src/components/decisions/DecisionsInbox.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /recordVisible|filterByLens/, file);
    }
    const home = read("src/pages/HomePage.tsx");
    assert.equal(home.includes('href: "/chart"'), false);
    assert.equal(home.includes('to="/documents"'), false);
    assert.equal(home.includes("rowLocked"), false);
    assert.equal(home.includes("is-locked"), false);
    assert.equal(home.includes("useUnlockedRooms"), false);

    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /Overview/);
  });
});

describe("doctrine indexes", () => {
  it("routes Dream/Architecture editors by slug and kind", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="\/dream\/:slug\/:kind"/);
    assert.match(app, /path="\/track\/:slug\/:kind"/);
    assert.match(app, /DreamPage/);
    assert.equal(app.includes('RoomPage room="dream"'), false);

    const editor = read("src/components/documents/DocumentEditor.tsx");
    assert.match(editor, /slug: string/);
    assert.equal(editor.includes("useActiveDomain"), false);

    const index = read("src/components/doctrine/DoctrineIndex.tsx");
    assert.match(index, /\/dream\//);
    assert.equal(index.includes("rowLocked"), false);
    assert.equal(index.includes("is-locked"), false);
    assert.equal(index.includes("isNonEmptyBody"), false);
  });
});

describe("documents library page", () => {
  it("is a library, not doctrine cards", () => {
    const src = read("src/pages/DocumentsPage.tsx");
    assert.match(src, /libraryList/);
    assert.match(src, /recordVisibleMulti/);
    assert.equal(src.includes("DOC_CARDS"), false);
    assert.equal(src.includes('href: "/dream"'), false);
  });
});
