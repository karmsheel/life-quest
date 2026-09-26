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

describe("finance kit shell wiring (KAR-61)", () => {
  it("DataPage and HomePage mention Install Finance kit and kitInstallFinance", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    const homePage = read("src/pages/HomePage.tsx");
    assert.match(dataPage, /Install Finance kit/);
    assert.match(dataPage, /kitInstallFinance/);
    assert.match(dataPage, /showFinanceInstall/);
    assert.match(homePage, /Install Finance kit/);
    assert.match(homePage, /kitInstallFinance/);
    assert.match(homePage, /showFinanceInstall/);
  });

  it("DatabasePage does not mention Install Finance kit", () => {
    const dbPage = read("src/pages/DatabasePage.tsx");
    assert.ok(!dbPage.includes("Install Finance kit"), "DatabasePage should not mention Install Finance kit");
  });

  it("PageCanvasPage mentions budget-vs-actual, net-worth, scenario-compare, and Install", () => {
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.match(canvasPage, /budget-vs-actual/);
    assert.match(canvasPage, /net-worth/);
    assert.match(canvasPage, /scenario-compare/);
    assert.match(canvasPage, /Install Finance kit/);
  });

  it("PageCanvasPage does not mention jupyter, notebook import, or a hosted runtime", () => {
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.equal(/jupyter|notebook import|hosted runtime/i.test(canvasPage), false);
  });

  it("preload/main/vault-service/vite-env mention kit:installFinance / kitInstallFinance", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    assert.match(main, /kit:installFinance/);
    assert.match(preload, /kit:installFinance/);
    assert.match(service, /kitInstallFinance/);
    assert.match(viteEnv, /kitInstallFinance/);
  });

  it("source does not mention Google Sheets / Notion connect UI (KAR-59: adapter kinds now required)", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    const dbPage = read("src/pages/DatabasePage.tsx");
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    // KAR-59: DatabasePage now requires google-sheet, notion, url adapter kinds
    assert.ok(dbPage.includes("google-sheet"), "DatabasePage should mention google-sheet");
    assert.ok(dbPage.includes("notion"), "DatabasePage should mention notion");
    assert.ok(dbPage.includes("url"), "DatabasePage should mention url");
    // DataPage and Canvas should not mention the API URLs (only in transport)
    assert.ok(!dataPage.includes("spreadsheets.google"), "DataPage should not mention Google Sheets URL");
    assert.ok(!dbPage.includes("spreadsheets.google"), "DatabasePage should not mention Google Sheets URL");
    assert.ok(!canvasPage.includes("spreadsheets.google"), "Canvas should not mention Google Sheets URL");
  });
});
