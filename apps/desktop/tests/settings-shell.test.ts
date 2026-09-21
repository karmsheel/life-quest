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

describe("domains settings wiring", () => {
  it("lists Domains as a settings section", () => {
    const views = read("src/lib/settings-views.ts");
    assert.match(views, /id:\s*["']domains["']/);
    assert.match(views, /label:\s*["']Domains["']/);
    assert.match(views, /"domains"/);
  });

  it("renders the domains manager from SettingsContent", () => {
    const content = read("src/components/settings/SettingsContent.tsx");
    assert.match(
      content,
      /import \{ SettingsDomains \} from ["']\.\/SettingsDomains["']/,
    );
    assert.match(content, /case ["']domains["']:\s*return <SettingsDomains\s*\/>/);
  });

  it("redirects /domains to the settings domains tab", () => {
    const app = read("src/App.tsx");
    assert.equal(app.includes("DomainsPage"), false);
    assert.match(
      app,
      /path=["']\/domains["'][\s\S]*to=["']\/settings\?tab=domains["']/,
    );
  });

  it("does not keep a standalone Domains page", () => {
    const pagePath = path.join(desktopRoot, "src/pages/DomainsPage.tsx");
    assert.equal(fs.existsSync(pagePath), false);
  });
});

describe("about me copy", () => {
  it("treats about me as lifestyle context, not a command surface", () => {
    const src = read("src/components/settings/SettingsAbout.tsx");
    assert.match(src, /Agents treat this as lifestyle context/);
    assert.equal(/agent\s+lock/i.test(src), false);
  });
});

describe("vault week start", () => {
  it("Vault settings exposes week start", () => {
    const src = read("src/components/settings/SettingsVault.tsx");
    assert.match(src, /Week starts on/);
    assert.match(src, /weekStartDay/);
    assert.match(src, /monday/);
    assert.match(src, /sunday/);
  });
});

describe("settings primitives migration", () => {
  const files = [
    "src/components/settings/SettingsAppearance.tsx",
    "src/components/settings/SettingsVault.tsx",
    "src/components/settings/SettingsHermes.tsx",
    "src/components/settings/SettingsAbout.tsx",
    "src/components/settings/SettingsDomains.tsx",
  ];

  it("uses SettingsSection in every settings view", () => {
    for (const file of files) {
      const src = read(file);
      assert.match(src, /SettingsSection/, file);
      assert.equal(src.includes("settings-panel__heading"), false, file);
    }
  });

  it("replaces raw btn classes with Button", () => {
    for (const file of files) {
      const src = read(file);
      assert.equal(src.includes('className="btn'), false, file);
    }
    const hermes = read("src/components/settings/SettingsHermes.tsx");
    assert.match(hermes, /from ["']@\/components\/ui\/Button["']/);
    assert.match(hermes, /variant=["']primary["']/);
    assert.match(hermes, /destructive/);
    const appearance = read("src/components/settings/SettingsAppearance.tsx");
    assert.match(appearance, /SettingsRow/);
  });
});
