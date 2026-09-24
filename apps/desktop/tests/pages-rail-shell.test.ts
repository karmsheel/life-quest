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

describe("pages rail shell wiring (KAR-60)", () => {
  it("NAV_ITEMS has Pages, href /pages, wing home, after Data and before Personnel", () => {
    const src = read("src/components/shell/nav-items.ts");
    assert.match(src, /id:\s*["']pages["']/);
    assert.match(src, /href:\s*["']\/pages["']/);
    assert.match(src, /label:\s*["']Pages["']/);
    assert.match(src, /wing:\s*["']home["']/);
    // Verify order: data, pages, personnel
    const dataIdx = src.indexOf('id: "data"');
    const pagesIdx = src.indexOf('id: "pages"');
    const personnelIdx = src.indexOf('id: "personnel"');
    assert.ok(dataIdx > 0 && pagesIdx > 0 && personnelIdx > 0);
    assert.ok(dataIdx < pagesIdx);
    assert.ok(pagesIdx < personnelIdx);
  });

  it("App.tsx mounts /pages and /pages/:slug/:pageId", () => {
    const src = read("src/App.tsx");
    assert.match(src, /<Route\s+path=["']\/pages["']/);
    assert.match(src, /<Route\s+path=["']\/pages\/:slug\/:pageId["']/);
    assert.match(src, /import PagesPage/);
    assert.match(src, /import PageCanvasPage/);
  });

  it("wing.ts maps /pages and /pages/health/x to home", () => {
    const src = read("src/components/shell/wing.ts");
    assert.match(src, /["']\/pages["']:\s*["']home["']/);
    assert.match(src, /startsWith\(["']\/pages\/["']\)/);
  });

  it("PagesPage mentions pageList, pageCreate, No pages yet, and a domain select", () => {
    const src = read("src/pages/PagesPage.tsx");
    assert.match(src, /pageList/);
    assert.match(src, /pageCreate/);
    assert.match(src, /No pages yet/);
    assert.match(src, /<select/);
    assert.match(src, /selectedDomain/);
    assert.match(src, /Select a domain to create a page in/);
    assert.match(src, /pageCreate\(target, \{ title: name \}\)/);
  });

  it("PagesPage / PageCanvasPage do not call domainSetActive or setActiveSlug", () => {
    const pagesPage = read("src/pages/PagesPage.tsx");
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.ok(!pagesPage.includes("domainSetActive"), "PagesPage should not call domainSetActive");
    assert.ok(!pagesPage.includes("setActiveSlug"), "PagesPage should not call setActiveSlug");
    assert.ok(!canvasPage.includes("domainSetActive"), "PageCanvasPage should not call domainSetActive");
    assert.ok(!canvasPage.includes("setActiveSlug"), "PageCanvasPage should not call setActiveSlug");
  });

  it("PageCanvasPage mentions pageGet, pageUpdate, the seven core kinds, and no script/finance kinds", () => {
    const src = read("src/pages/PageCanvasPage.tsx");
    assert.match(src, /pageGet/);
    assert.match(src, /pageUpdate/);
    // Seven core kinds
    assert.match(src, /markdown/);
    assert.match(src, /bound-table/);
    assert.match(src, /metric/);
    assert.match(src, /date-range/);
    assert.match(src, /chart/);
    assert.match(src, /goal-progress/);
    assert.match(src, /deadline/);
    // No script/finance kinds as addable
    assert.equal(/script.*block|addable.*script/i.test(src), false);
    assert.equal(src.includes("budget-vs-actual"), false);
    assert.equal(src.includes("net-worth"), false);
    assert.equal(src.includes("scenario-compare"), false);
  });

  it("preload/main/vault-service/vite-env mention all page: and pins: channels and API names", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    const channels = [
      "page:list",
      "page:get",
      "page:create",
      "page:update",
      "page:delete",
      "pins:list",
      "pins:set",
    ];
    for (const ch of channels) {
      const escaped = ch.replace(":", "\\:");
      assert.match(main, new RegExp(escaped), `main missing ${ch}`);
      assert.match(preload, new RegExp(escaped), `preload missing ${ch}`);
    }

    const apiNames = [
      "pageList",
      "pageGet",
      "pageCreate",
      "pageUpdate",
      "pageDelete",
      "pinsList",
      "pinsSet",
    ];
    for (const name of apiNames) {
      assert.match(preload, new RegExp(name), `preload API missing ${name}`);
      assert.match(viteEnv, new RegExp(name), `vite-env missing ${name}`);
      assert.match(service, new RegExp(name), `vault-service missing ${name}`);
    }
  });

  it("HomePage mentions pinsList, SYSTEM_PIN_KINDS or system kind strings, goal-progress, deadline", () => {
    const src = read("src/pages/HomePage.tsx");
    assert.match(src, /pinsList/);
    assert.match(src, /SYSTEM_PIN_KINDS|goal-progress|deadline/);
    assert.match(src, /goal-progress/);
    assert.match(src, /deadline/);
  });

  it("source does not add Finance kit install UI", () => {
    const pagesPage = read("src/pages/PagesPage.tsx");
    const canvasPage = read("src/pages/PageCanvasPage.tsx");
    assert.equal(/install.*finance|finance.*install/i.test(pagesPage), false);
    assert.equal(/install.*finance|finance.*install/i.test(canvasPage), false);
  });
});
