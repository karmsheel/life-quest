import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ALL_TOOL_DEFS, CAPTURE_TOOL_DEFS } from "@lifequest/vault-core";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("conversational capture shell wiring (KAR-62)", () => {
  it("mcp-server.ts and map-tools.ts mention CAPTURE_TOOL_DEFS and executeCaptureTool", () => {
    const mcp = read("electron/mcp-server.ts");
    const mapTools = read("electron/map-tools.ts");
    // mcp-server registers the one composed constant, so membership is asserted
    // against the array itself rather than by grepping mcp-server for the name.
    assert.match(mcp, /ALL_TOOL_DEFS/);
    for (const def of CAPTURE_TOOL_DEFS) {
      assert.ok(
        ALL_TOOL_DEFS.some((t) => t.name === def.name),
        `${def.name} must be registered`,
      );
    }
    assert.match(mapTools, /CAPTURE_TOOL_DEFS/);
    assert.match(mapTools, /executeCaptureTool/);
  });

  it("companion-client.ts mentions capture_transaction", () => {
    const companion = read("electron/companion-client.ts");
    assert.match(companion, /capture_transaction/);
  });

  it("preload, main, vault-service, and vite-env mention kit:setCaptureAccount and kitSetCaptureAccount", () => {
    const preload = read("electron/preload.ts");
    const main = read("electron/main.ts");
    const service = read("electron/vault-service.ts");
    const viteEnv = read("src/vite-env.d.ts");
    assert.match(preload, /kitSetCaptureAccount/);
    assert.match(main, /kit:setCaptureAccount/);
    assert.match(service, /kitSetCaptureAccount/);
    assert.match(viteEnv, /kitSetCaptureAccount/);
  });

  it("DataPage.tsx contains Default capture account and kitSetCaptureAccount", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    assert.match(dataPage, /Default capture account/);
    assert.match(dataPage, /kitSetCaptureAccount/);
  });

  it("source does not add a Plaid or TrueLayer string, and does not add a general update_transaction tool", () => {
    const mapTools = read("electron/map-tools.ts");
    const mcp = read("electron/mcp-server.ts");
    const dataPage = read("src/pages/DataPage.tsx");
    const service = read("electron/vault-service.ts");
    assert.equal(/Plaid/i.test(mapTools), false);
    assert.equal(/TrueLayer/i.test(mapTools), false);
    assert.equal(/Plaid/i.test(mcp), false);
    assert.equal(/TrueLayer/i.test(mcp), false);
    assert.equal(/Plaid/i.test(dataPage), false);
    assert.equal(/TrueLayer/i.test(dataPage), false);
    assert.equal(/Plaid/i.test(service), false);
    assert.equal(/TrueLayer/i.test(service), false);
    // No general update_transaction tool
    assert.equal(/update_transaction/.test(mapTools), false);
    assert.equal(/update_transaction/.test(mcp), false);
    assert.equal(/update_transaction/.test(service), false);
  });
});
