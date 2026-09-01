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
    const mcp = read("electron/mcp-server.ts");
    assert.match(mcp, /getActiveSlug/);
    assert.equal(mcp.includes("getActiveDomain(mcpVaultId)"), false);

    const tools = read("electron/map-tools.ts");
    assert.match(tools, /domains:/);
    assert.match(tools, /activeSlug/);
  });
});
