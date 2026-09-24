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

describe("ingest shell wiring", () => {
  it("DataPage mentions drop / ingestFile / .csv / .pdf and requires a database", () => {
    const src = read("src/pages/DataPage.tsx");
    assert.match(src, /ingestFile/);
    assert.match(src, /ingestProposeMapping/);
    assert.match(src, /\.csv/);
    assert.match(src, /\.pdf/);
    assert.match(src, /drop/i);
    // Requires a database (select or domain lens)
    assert.match(src, /select/i);
  });

  it("DataPage / DatabasePage do not call domainSetActive or setActiveSlug", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    const dbPage = read("src/pages/DatabasePage.tsx");
    assert.ok(!dataPage.includes("domainSetActive"), "DataPage should not call domainSetActive");
    assert.ok(!dataPage.includes("setActiveSlug"), "DataPage should not call setActiveSlug");
    assert.ok(!dbPage.includes("domainSetActive"), "DatabasePage should not call domainSetActive");
    assert.ok(!dbPage.includes("setActiveSlug"), "DatabasePage should not call setActiveSlug");
  });

  it("DatabasePage mentions ingestListBatches / ingestAccept / ingestReject / No ingest rows", () => {
    const src = read("src/pages/DatabasePage.tsx");
    assert.match(src, /ingestListBatches/);
    assert.match(src, /ingestAccept/);
    assert.match(src, /ingestReject/);
    assert.match(src, /ingestEditRow/);
    assert.match(src, /No ingest rows/);
  });

  it("preload/main/vault-service/vite-env mention ingest: channels and API names", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    const channels = [
      "ingest:file",
      "ingest:proposeMapping",
      "ingest:listMappings",
      "ingest:listBatches",
      "ingest:listRows",
      "ingest:editRow",
      "ingest:accept",
      "ingest:reject",
    ];
    for (const ch of channels) {
      const escaped = ch.replace(":", "\\:");
      assert.match(main, new RegExp(escaped), `main missing ${ch}`);
      assert.match(preload, new RegExp(escaped), `preload missing ${ch}`);
    }

    const apiNames = [
      "ingestFile",
      "ingestProposeMapping",
      "ingestListMappings",
      "ingestListBatches",
      "ingestListRows",
      "ingestEditRow",
      "ingestAccept",
      "ingestReject",
    ];
    for (const name of apiNames) {
      assert.match(preload, new RegExp(name), `preload API missing ${name}`);
      assert.match(viteEnv, new RegExp(name), `vite-env missing ${name}`);
      assert.match(service, new RegExp(name), `vault-service missing ${name}`);
    }
  });

  it("source does not mention Google Sheets / Notion connect UI (KAR-59 updates: adapter kinds now required)", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    const dbPage = read("src/pages/DatabasePage.tsx");
    // KAR-59: DatabasePage now requires google-sheet, notion, url adapter kinds
    assert.ok(dbPage.includes("google-sheet"), "DatabasePage should mention google-sheet");
    assert.ok(dbPage.includes("notion"), "DatabasePage should mention notion");
    assert.ok(dbPage.includes("url"), "DatabasePage should mention url");
    // DataPage should not mention spreadsheets.google (no connect UI there)
    assert.ok(!dataPage.includes("spreadsheets.google"), "DataPage should not mention Google Sheets URL");
    // DatabasePage should not contain the Google Sheets API URL (only in transport)
    assert.ok(!dbPage.includes("spreadsheets.google"), "DatabasePage should not mention Google Sheets URL");
  });

  it("source does not add Finance kit install UI to DatabasePage", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    const dbPage = read("src/pages/DatabasePage.tsx");
    // DataPage may show Install Finance kit for Financial domain
    assert.ok(dataPage.includes("Install Finance kit"), "DataPage should add Finance kit install UI");
    assert.ok(!dbPage.includes("Install Finance kit"), "DatabasePage should not add Finance kit install UI");
  });
});
