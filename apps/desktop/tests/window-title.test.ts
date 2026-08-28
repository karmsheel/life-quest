import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { windowTitleLabel } from "../src/components/shell/window-title.ts";

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
