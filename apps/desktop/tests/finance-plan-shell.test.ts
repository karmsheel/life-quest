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

describe("finance plan loop shell wiring (KAR-57)", () => {
  it("PageCanvasPage mentions all four API names and the required strings", () => {
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.match(canvasPage, /financeBudgetVsActual/);
    assert.match(canvasPage, /financeNetWorth/);
    assert.match(canvasPage, /financeScenarioCompare/);
    assert.match(canvasPage, /No budgets yet./);
    assert.match(canvasPage, /No accounts or holdings yet./);
    assert.match(canvasPage, /ZAR conversion requires an FX rate/);
    assert.match(canvasPage, /Compare with/);
  });

  it("PageCanvasPage does NOT contain No projection yet", () => {
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.ok(!canvasPage.includes("No projection yet."), "should not contain 'No projection yet.'");
  });

  it("preload/main/vault-service/vite-env mention all four channels and API names", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    const channels = [
      "finance:budgetVsActual",
      "finance:netWorth",
      "finance:scenarioCompare",
      "finance:saveAssumptionSet",
    ];
    for (const ch of channels) {
      const escaped = ch.replace(":", "\\:");
      assert.match(main, new RegExp(escaped), `main missing ${ch}`);
      assert.match(preload, new RegExp(escaped), `preload missing ${ch}`);
    }

    const apiNames = [
      "financeBudgetVsActual",
      "financeNetWorth",
      "financeScenarioCompare",
      "financeSaveAssumptionSet",
    ];
    for (const name of apiNames) {
      assert.match(preload, new RegExp(name), `preload API missing ${name}`);
      assert.match(viteEnv, new RegExp(name), `vite-env missing ${name}`);
      assert.match(service, new RegExp(name), `vault-service missing ${name}`);
    }
  });

  it("PageCanvasPage does not mention jupyter, notebook import, or a hosted runtime", () => {
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.equal(/jupyter|notebook import|hosted runtime/i.test(canvasPage), false);
  });

  it("DatabasePage still does not mention Install Finance kit", () => {
    const dbPage = read("src/pages/DatabasePage.tsx");
    assert.ok(!dbPage.includes("Install Finance kit"), "DatabasePage should not mention Install Finance kit");
  });
});
