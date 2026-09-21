import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(desktopRoot, "../..");

function readDesktop(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

function readRepo(relFromRepo: string): string {
  return fs.readFileSync(path.join(repoRoot, relFromRepo), "utf8");
}

describe("review IPC channels", () => {
  const channels = [
    "review:get",
    "review:ensure",
    "review:write",
    "review:markDone",
    "review:unlock",
    "review:periodPack",
    "planning:ensure",
  ];

  it("wires all review/planning channels in main, preload, vite-env, vault-service", () => {
    const main = readDesktop("electron/main.ts");
    const preload = readDesktop("electron/preload.ts");
    const viteEnv = readDesktop("src/vite-env.d.ts");
    const service = readDesktop("electron/vault-service.ts");

    for (const ch of channels) {
      assert.match(main, new RegExp(ch.replace(":", "\\:")), `main missing ${ch}`);
      assert.match(
        preload,
        new RegExp(ch.replace(":", "\\:")),
        `preload missing ${ch}`,
      );
    }

    for (const name of [
      "reviewGet",
      "reviewEnsure",
      "reviewWrite",
      "reviewMarkDone",
      "reviewUnlock",
      "reviewPeriodPack",
      "planningEnsure",
    ]) {
      assert.match(preload, new RegExp(name), `preload API missing ${name}`);
      assert.match(viteEnv, new RegExp(name), `vite-env missing ${name}`);
      assert.match(service, new RegExp(`export async function ${name}`), `vault-service missing ${name}`);
    }

    assert.match(service, /USER_ACTOR/);
    assert.match(service, /writeReview/);
    assert.match(service, /getPeriodPack/);
    assert.match(service, /ensurePlanningStub/);
  });
});

describe("VaultSnapshot review index fields", () => {
  it("declares reviews, planning, weeklyFileCount on VaultSnapshot and fills them in open-vault", () => {
    const types = readRepo("packages/vault-core/src/types.ts");
    assert.match(types, /reviews:\s*ReviewIndexEntry\[\]/);
    assert.match(types, /planning:/);
    assert.match(types, /weeklyFileCount:\s*number/);

    const openVault = readRepo("packages/vault-core/src/open-vault.ts");
    assert.match(openVault, /listReviewIndex/);
    assert.match(openVault, /listPlanningIndex/);
    assert.match(openVault, /countWeeklyVaultFiles/);
    assert.match(openVault, /weeklyFileCount/);
    assert.match(openVault, /reviews:/);
    assert.match(openVault, /planning:/);
  });
});

describe("SettingsVault week-start disable", () => {
  it("disables week start using weeklyFileCount", () => {
    const src = readDesktop("src/components/settings/SettingsVault.tsx");
    assert.match(src, /weeklyFileCount/);
    assert.match(
      src,
      /Cannot change while weekly review or planning files exist\./,
    );
    assert.match(src, /disabled/);

    const segmented = readDesktop("src/components/ui/SegmentedControl.tsx");
    assert.match(segmented, /disabled\?:/);
  });
});
