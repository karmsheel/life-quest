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

describe("data rail shell wiring", () => {
  it("NAV_ITEMS has Data, href /data, wing home, between Dashboard and Personnel", () => {
    const src = read("src/components/shell/nav-items.ts");
    assert.match(src, /id:\s*["']data["']/);
    assert.match(src, /href:\s*["']\/data["']/);
    assert.match(src, /label:\s*["']Data["']/);
    assert.match(src, /icon:\s*Database/);
    assert.match(src, /wing:\s*["']home["']/);
    // Verify order: dashboard, data, personnel
    const dashboardIdx = src.indexOf('id: "dashboard"');
    const dataIdx = src.indexOf('id: "data"');
    const personnelIdx = src.indexOf('id: "personnel"');
    assert.ok(dashboardIdx > 0 && dataIdx > 0 && personnelIdx > 0);
    assert.ok(dashboardIdx < dataIdx);
    assert.ok(dataIdx < personnelIdx);
  });

  it("App.tsx mounts /data and /data/:slug/:dbId", () => {
    const src = read("src/App.tsx");
    assert.match(src, /<Route\s+path=["']\/data["']/);
    assert.match(src, /<Route\s+path=["']\/data\/:slug\/:dbId["']/);
    assert.match(src, /import DataPage/);
    assert.match(src, /import DatabasePage/);
  });

  it("wing.ts maps /data and /data/health/x to home", () => {
    const src = read("src/components/shell/wing.ts");
    assert.match(src, /["']\/data["']:\s*["']home["']/);
    // wingForPath handles /data/ prefix
    const wing = read("src/components/shell/wing.ts");
    assert.match(wing, /startsWith\(["']\/data\/["']\)/);
  });

  it("DataPage mentions dbList, dbCreate, No databases yet, and a domain select", () => {
    const src = read("src/pages/DataPage.tsx");
    assert.match(src, /dbList/);
    assert.match(src, /dbCreate/);
    assert.match(src, /No databases yet/);
    assert.match(src, /<select/);
    assert.match(src, /selectedDomain/);
    assert.match(src, /Select a domain to create a database in/);
  });

  it("DataPage and DatabasePage do not call domainSetActive or setActiveSlug", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    const dbPage = read("src/pages/DatabasePage.tsx");
    assert.ok(!dataPage.includes("domainSetActive"), "DataPage should not call domainSetActive");
    assert.ok(!dataPage.includes("setActiveSlug"), "DataPage should not call setActiveSlug");
    assert.ok(!dbPage.includes("domainSetActive"), "DatabasePage should not call domainSetActive");
    assert.ok(!dbPage.includes("setActiveSlug"), "DatabasePage should not call setActiveSlug");
  });

  it("DatabasePage mentions dbGet, dbListRows, dbUpsertRow, dbAddColumn, dbDeleteRow", () => {
    const src = read("src/pages/DatabasePage.tsx");
    assert.match(src, /dbGet/);
    assert.match(src, /dbListRows/);
    assert.match(src, /dbUpsertRow/);
    assert.match(src, /dbAddColumn/);
    assert.match(src, /dbDeleteRow/);
    assert.match(src, /dbList/);
    assert.match(src, /Number\.isFinite/);
  });

  it("preload/main/vault-service/vite-env mention all db: channels and API names", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    const channels = [
      "db:list",
      "db:get",
      "db:create",
      "db:addColumn",
      "db:listRows",
      "db:getRow",
      "db:upsertRow",
      "db:deleteRow",
      "db:fileSave",
    ];
    for (const ch of channels) {
      const escaped = ch.replace(":", "\\:");
      assert.match(main, new RegExp(escaped), `main missing ${ch}`);
      assert.match(preload, new RegExp(escaped), `preload missing ${ch}`);
    }

    const apiNames = [
      "dbList",
      "dbGet",
      "dbCreate",
      "dbAddColumn",
      "dbListRows",
      "dbGetRow",
      "dbUpsertRow",
      "dbDeleteRow",
      "dbFileSave",
    ];
    for (const name of apiNames) {
      assert.match(preload, new RegExp(name), `preload API missing ${name}`);
      assert.match(viteEnv, new RegExp(name), `vite-env missing ${name}`);
      assert.match(service, new RegExp(name), `vault-service missing ${name}`);
    }
  });

  it("source does add a Pages nav item and /pages route (KAR-60)", () => {
    const navItems = read("src/components/shell/nav-items.ts");
    const app = read("src/App.tsx");
    assert.ok(navItems.includes('id: "pages"'), "should have pages nav item");
    assert.ok(app.includes('path="/pages"'), "should have /pages route");
  });
});
