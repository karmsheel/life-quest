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
