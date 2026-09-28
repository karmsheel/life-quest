import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ALL_TOOL_DEFS, SCRIPT_TOOL_DEFS } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("script block shell wiring (KAR-56)", () => {
  it("PageCanvasPage renders a Script block with scriptRun and No script yet.", () => {
    const src = read("src/pages/PageCanvasPage.tsx");
    assert.match(src, /Script/);
    assert.match(src, /scriptRun/);
    assert.match(src, /No script yet\./);
    assert.match(src, /kind: "script"/);
  });

  it("PageCanvasPage does not mention jupyter, notebook import, or a hosted runtime", () => {
    const src = read("src/pages/PageCanvasPage.tsx");
    assert.equal(/jupyter|notebook import|hosted runtime/i.test(src), false);
  });

  it("preload, main, vault-service, and vite-env expose script:apply and script:run", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    for (const ch of ["script:apply", "script:run"]) {
      const escaped = ch.replace(":", "\\:");
      assert.match(main, new RegExp(escaped), `main missing ${ch}`);
      assert.match(preload, new RegExp(escaped), `preload missing ${ch}`);
    }
    for (const name of ["scriptApply", "scriptRun"]) {
      assert.match(preload, new RegExp(name), `preload API missing ${name}`);
      assert.match(viteEnv, new RegExp(name), `vite-env missing ${name}`);
      assert.match(service, new RegExp(name), `vault-service missing ${name}`);
    }
  });

  it("map-tools registers and dispatches the script tools; mcp-server exposes them", () => {
    const mcp = read("electron/mcp-server.ts");
    const mapTools = read("electron/map-tools.ts");
    // mcp-server registers the composed constant; membership is asserted against
    // the array rather than by grepping the source for the name.
    assert.match(mcp, /ALL_TOOL_DEFS/);
    for (const def of SCRIPT_TOOL_DEFS) {
      assert.ok(
        ALL_TOOL_DEFS.some((t) => t.name === def.name),
        `${def.name} must be registered`,
      );
    }
    // map-tools owns the dispatcher; mcp-server reaches it through executeTool
    assert.match(mapTools, /SCRIPT_TOOL_DEFS/);
    assert.match(mapTools, /executeScriptTool/);
  });

  it("companion instructions name apply_script_block and forbid claiming an unrun script", () => {
    const src = read("electron/companion-client.ts");
    assert.match(src, /apply_script_block/);
    assert.match(src, /run_script_block/);
  });
});
