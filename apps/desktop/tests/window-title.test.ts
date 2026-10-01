import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  vaultTitleName,
  windowTitleLabel,
} from "../src/components/shell/window-title.ts";

describe("windowTitleLabel", () => {
  it("uses LifeQuest when no vault name is present", () => {
    assert.equal(windowTitleLabel(null), "LifeQuest");
    assert.equal(windowTitleLabel(undefined), "LifeQuest");
    assert.equal(windowTitleLabel(""), "LifeQuest");
    assert.equal(windowTitleLabel("   "), "LifeQuest");
  });

  it("prefixes the vault name with LifeQuest", () => {
    assert.equal(windowTitleLabel("Personal"), "LifeQuest — Personal");
  });
});

describe("vaultTitleName", () => {
  it("wears the vault's own name, falling back to the app name with no vault", () => {
    assert.equal(vaultTitleName("Personal"), "Personal");
    assert.equal(vaultTitleName("  Personal  "), "Personal");
    assert.equal(vaultTitleName(""), "LifeQuest");
    assert.equal(vaultTitleName("   "), "LifeQuest");
    assert.equal(vaultTitleName(null), "LifeQuest");
    assert.equal(vaultTitleName(undefined), "LifeQuest");
  });
});
