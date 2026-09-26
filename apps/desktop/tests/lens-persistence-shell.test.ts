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

describe("KAR-6: lens persistence across quit", () => {
  it("main process persists the active domain lens per vault", () => {
    const src = read("electron/vault-service.ts");
    // Imports the prefs store for saving/reading the per-vault lens
    assert.match(src, /getActiveDomain/);
    assert.match(src, /setActiveDomain/);
    // rememberOpen reads the persisted lens for this vault ID
    assert.match(
      src,
      /getActiveDomain\(snapshot\.lifequest\.id\)/,
    );
    // domainSetActive persists the lens (both slug and null → void setActiveDomain)
    assert.match(
      src,
      /setActiveDomain\(currentVaultId/,
    );
  });

  it("setActiveDomain in recent-vaults.ts accepts null (overview)", () => {
    const prefs = read("electron/recent-vaults.ts");
    assert.match(prefs, /setActiveDomain\(/);
    assert.match(prefs, /slug: string \| null/);
  });

  it("renderer restores the persisted lens on open instead of forcing Overview", () => {
    const provider = read("src/state/VaultProvider.tsx");
    assert.match(provider, /domainGetActive/);
    assert.match(provider, /resolveRestoredLens/);
    assert.match(provider, /shouldClearLensForSnapshot/);
    // Opening a vault applies that vault's saved lens, including Overview.
    assert.match(provider, /await restoreLens\(result\.value\)/);
    assert.match(provider, /await restoreLens\(opened\.value\)/);
    assert.match(provider, /await restoreLens\(snapResult\.value\)/);
    const applySnapshot = provider.match(
      /const applySnapshot = useCallback\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(applySnapshot, "applySnapshot callback");
    assert.match(applySnapshot[0], /shouldClearLensForSnapshot/);
    assert.doesNotMatch(
      applySnapshot[0],
      /previousVaultId !== next\.lifequest\.id[\s\S]*domainSetActive\(null\)/,
    );
  });

  it("lens switcher sends setLens with the domain lens during boot restore", () => {
    const provider = read("src/state/VaultProvider.tsx");
    // setLens result drives the restored lens state
    assert.match(
      provider,
      /setLens\(/,
    );
  });
});
