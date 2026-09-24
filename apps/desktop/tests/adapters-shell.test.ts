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

describe("adapter shell wiring (KAR-59)", () => {
  it("preload, main, vault-service, and vite-env mention adapter IPC channels", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const viteEnv = read("src/vite-env.d.ts");
    const service = read("electron/vault-service.ts");

    assert.match(main, /db:linkAdapter/);
    assert.match(main, /db:unlinkAdapter/);
    assert.match(main, /db:sync/);
    assert.match(main, /db:listConflicts/);
    assert.match(main, /db:resolveConflict/);

    assert.match(preload, /dbLinkAdapter/);
    assert.match(preload, /dbUnlinkAdapter/);
    assert.match(preload, /dbSync/);
    assert.match(preload, /dbListConflicts/);
    assert.match(preload, /dbResolveConflict/);

    assert.match(service, /dbLinkAdapter/);
    assert.match(service, /dbUnlinkAdapter/);
    assert.match(service, /dbSync/);
    assert.match(service, /dbListConflicts/);
    assert.match(service, /dbResolveConflict/);

    assert.match(viteEnv, /dbLinkAdapter/);
    assert.match(viteEnv, /dbUnlinkAdapter/);
    assert.match(viteEnv, /dbSync/);
    assert.match(viteEnv, /dbListConflicts/);
    assert.match(viteEnv, /dbResolveConflict/);
  });

  it("DatabasePage.tsx contains Keep local, Keep remote, Skip, google-sheet, notion, and url", () => {
    const dbPage = read("src/pages/DatabasePage.tsx");
    assert.match(dbPage, /Keep local/);
    assert.match(dbPage, /Keep remote/);
    assert.match(dbPage, /Skip/);
    assert.match(dbPage, /google-sheet/);
    assert.match(dbPage, /notion/);
    assert.match(dbPage, /url/);
  });

  it("DataPage.tsx contains Refresh linked and dbSync", () => {
    const dataPage = read("src/pages/DataPage.tsx");
    assert.match(dataPage, /Refresh linked/);
    assert.match(dataPage, /dbSync/);
  });

  it("secrets.ts encrypts adapter secrets with safeStorage", () => {
    const secrets = read("electron/secrets.ts");
    assert.match(secrets, /adapterSecrets/);
    assert.match(secrets, /safeStorage/);
    assert.match(secrets, /encryptString/);
  });

  it("adapter-transport.ts contains sheets.googleapis.com and api.notion.com", () => {
    const transport = read("electron/adapter-transport.ts");
    assert.match(transport, /sheets.googleapis.com/);
    assert.match(transport, /api.notion.com/);
  });

  it("source under apps/desktop does not contain plaid, truelayer, TrueLayer, or Sign in with Google", () => {
    const main = read("electron/main.ts");
    const preload = read("electron/preload.ts");
    const service = read("electron/vault-service.ts");
    const transport = read("electron/adapter-transport.ts");
    const dbPage = read("src/pages/DatabasePage.tsx");
    const dataPage = read("src/pages/DataPage.tsx");

    const all = [main, preload, service, transport, dbPage, dataPage].join("\n");
    assert.equal(/plaid/i.test(all), false, "should not mention plaid");
    assert.equal(/truelayer/i.test(all), false, "should not mention truelayer");
    assert.equal(/TrueLayer/i.test(all), false, "should not mention TrueLayer");
    assert.equal(/Sign in with Google/i.test(all), false, "should not mention Sign in with Google");
  });

  it("vault-service.ts vaultOpen still returns the openVault result when sync throws", () => {
    const service = read("electron/vault-service.ts");
    // vaultOpen should have a try/catch around sync and return res (not throw)
    assert.match(service, /vaultOpen/);
    assert.match(service, /try\s*\{[\s\S]*syncLinkedDatabases[\s\S]*catch/);
    // The return res should be after the catch block's closing brace
    const vaultOpenMatch = service.match(/export async function vaultOpen[\s\S]*?^\}/m);
    assert.ok(vaultOpenMatch, "vaultOpen function should exist");
    const vaultOpenBody = vaultOpenMatch[0];
    // Find the catch block's closing brace (first } after the catch keyword)
    const catchStart = vaultOpenBody.indexOf("catch");
    const catchCloseIdx = vaultOpenBody.indexOf("}", catchStart);
    const returnIdx = vaultOpenBody.indexOf("return res", catchCloseIdx);
    assert.ok(returnIdx > catchCloseIdx, "return res should be after the catch block");
  });

  it("vault-service.ts ingestAccept mentions sync after accept", () => {
    const service = read("electron/vault-service.ts");
    assert.match(service, /ingestAccept/);
    // The sync call should appear after the accept call
    const acceptIdx = service.indexOf("acceptIngestRows");
    const syncIdx = service.indexOf("syncDatabase", acceptIdx);
    assert.ok(syncIdx > acceptIdx, "syncDatabase should appear after acceptIngestRows in ingestAccept");
  });
});
