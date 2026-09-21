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

describe("Task 6 / KAR-49 — Review IPC shell", () => {
  it("vault-core types.ts declares reviews, planning, weeklyFileCount on VaultSnapshot", () => {
    const types = read("../../packages/vault-core/src/types.ts");
    assert.match(types, /reviews:/, "types.ts must declare reviews:");
    assert.match(types, /planning:/, "types.ts must declare planning:");
    assert.match(
      types,
      /weeklyFileCount:/,
      "types.ts must declare weeklyFileCount:",
    );
    assert.match(
      types,
      /ReviewIndexEntry/,
      "types.ts must import/reference ReviewIndexEntry",
    );
    assert.match(
      types,
      /PlanningIndexEntry/,
      "types.ts must import/reference PlanningIndexEntry",
    );
  });

  it("vault-core open-vault.ts fills reviews, planning, weeklyFileCount", () => {
    const src = read("../../packages/vault-core/src/open-vault.ts");
    assert.match(src, /listReviewIndex/);
    assert.match(src, /listPlanningIndex/);
    assert.match(src, /countWeeklyVaultFiles/);
    assert.match(
      src,
      /reviews:/,
      "open-vault.ts must assign reviews in the snapshot",
    );
    assert.match(
      src,
      /planning:/,
      "open-vault.ts must assign planning in the snapshot",
    );
    assert.match(
      src,
      /weeklyFileCount/,
      "open-vault.ts must assign weeklyFileCount in the snapshot",
    );
  });

  it("electron/vault-service.ts exposes reviewGet, reviewEnsure, reviewWrite, reviewMarkDone, reviewUnlock, reviewPeriodPack, planningEnsure", () => {
    const src = read("electron/vault-service.ts");
    assert.match(src, /reviewGet/);
    assert.match(src, /reviewEnsure/);
    assert.match(src, /reviewWrite/);
    assert.match(src, /reviewMarkDone/);
    assert.match(src, /reviewUnlock/);
    assert.match(src, /reviewPeriodPack/);
    assert.match(src, /planningEnsure/);
    assert.match(src, /getReview/);
    assert.match(src, /ensureReview/);
    assert.match(src, /writeReview/);
    assert.match(src, /markReviewDone/);
    assert.match(src, /unlockReview/);
    assert.match(src, /getPeriodPack/);
    assert.match(src, /ensurePlanningStub/);
  });

  it("electron/main.ts registers review and planning IPC channels", () => {
    const src = read("electron/main.ts");
    assert.match(src, /"review:get"/);
    assert.match(src, /"review:ensure"/);
    assert.match(src, /"review:write"/);
    assert.match(src, /"review:markDone"/);
    assert.match(src, /"review:unlock"/);
    assert.match(src, /"review:periodPack"/);
    assert.match(src, /"planning:ensure"/);
  });

  it("electron/preload.ts exposes review/planning IPC calls via contextBridge", () => {
    const src = read("electron/preload.ts");
    assert.match(src, /"review:get"/);
    assert.match(src, /"review:ensure"/);
    assert.match(src, /"review:write"/);
    assert.match(src, /"review:markDone"/);
    assert.match(src, /"review:unlock"/);
    assert.match(src, /"review:periodPack"/);
    assert.match(src, /"planning:ensure"/);
  });

  it("src/vite-env.d.ts declares review/planning methods on LifequestApi", () => {
    const src = read("src/vite-env.d.ts");
    assert.match(src, /reviewGet/);
    assert.match(src, /reviewEnsure/);
    assert.match(src, /reviewWrite/);
    assert.match(src, /reviewMarkDone/);
    assert.match(src, /reviewUnlock/);
    assert.match(src, /reviewPeriodPack/);
    assert.match(src, /planningEnsure/);
  });

  it("SettingsVault disables week-start using weeklyFileCount", () => {
    const src = read("src/components/settings/SettingsVault.tsx");
    assert.match(src, /weeklyFileCount/);
    assert.match(src, /disabled/);
  });

  it("SegmentedControl accepts an optional disabled prop", () => {
    const src = read("src/components/ui/SegmentedControl.tsx");
    assert.match(src, /disabled/);
  });
});
