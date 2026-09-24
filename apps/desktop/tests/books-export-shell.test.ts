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

describe("books-export IPC wiring", () => {
  it("preload/main/vault-service/vite-env mention db:exportBooks / db:restoreBooks and dbExportBooks / dbRestoreBooks", () => {
    const preload = read("electron/preload.ts");
    assert.match(preload, /db:exportBooks/);
    assert.match(preload, /db:restoreBooks/);
    assert.match(preload, /dbExportBooks/);
    assert.match(preload, /dbRestoreBooks/);

    const main = read("electron/main.ts");
    assert.match(main, /db:exportBooks/);
    assert.match(main, /db:restoreBooks/);

    const vaultService = read("electron/vault-service.ts");
    assert.match(vaultService, /dbExportBooks/);
    assert.match(vaultService, /dbRestoreBooks/);

    const viteEnv = read("src/vite-env.d.ts");
    assert.match(viteEnv, /dbExportBooks/);
    assert.match(viteEnv, /dbRestoreBooks/);
    assert.match(viteEnv, /DomainBooksExport/);
  });

  it("SettingsVault mentions dbExportBooks, dbRestoreBooks, and confirmation", () => {
    const src = read("src/components/settings/SettingsVault.tsx");
    assert.match(src, /dbExportBooks/);
    assert.match(src, /dbRestoreBooks/);
    assert.match(src, /confirm/i);
    assert.match(src, /checkbox/i);
    assert.match(src, /Restore/i);
  });

  it("Restore is not invoked on render (no unguarded dbRestoreBooks call)", () => {
    const src = read("src/components/settings/SettingsVault.tsx");
    // dbRestoreBooks must not appear inside a useEffect with empty deps or top-level
    assert.equal(/useEffect\(\(\)\s*=>\s*\{[^}]*dbRestoreBooks/s.test(src), false);
    // No direct call at module scope or outside a handler
    // Check that the only calls are inside onRestoreBooks function
    const lines = src.split("\n");
    let outsideHandler = false;
    let inHandler = false;
    let handlerBraceDepth = 0;
    for (const line of lines) {
      if (/onRestoreBooks/.test(line)) {
        inHandler = true;
        handlerBraceDepth = 0;
      }
      if (inHandler) {
        for (const ch of line) {
          if (ch === "{") handlerBraceDepth++;
          if (ch === "}") handlerBraceDepth--;
        }
        if (handlerBraceDepth <= 0 && line.includes("}")) {
          inHandler = false;
        }
      }
      if (!inHandler && /dbRestoreBooks\(/.test(line)) {
        outsideHandler = true;
      }
    }
    assert.equal(outsideHandler, false);
  });

  it("source does not add a git hook, husky, or post-merge", () => {
    const vaultService = read("electron/vault-service.ts");
    assert.equal(/post-merge/.test(vaultService), false);
    assert.equal(/post-commit/.test(vaultService), false);
    assert.equal(/post-checkout/.test(vaultService), false);
    assert.equal(/husky/.test(vaultService), false);
    assert.equal(/\.git\/hooks/.test(vaultService), false);
  });

  it("source does not add Finance kit install UI or ingest drop-zone", () => {
    const settingsVault = read("src/components/settings/SettingsVault.tsx");
    assert.equal(/kit.?install/i.test(settingsVault), false);
    assert.equal(/drop.?zone/i.test(settingsVault), false);
    assert.equal(/ingest/i.test(settingsVault), false);
  });
});
