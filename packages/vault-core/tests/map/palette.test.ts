import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { COLOR_IDS, isColorId, PALETTE } from "../../src/map/palette.ts";

describe("palette", () => {
  it("has eight named colors with hex values", () => {
    assert.equal(COLOR_IDS.length, 8);
    for (const id of COLOR_IDS) {
      assert.match(String(PALETTE[id]), /^#[0-9A-F]{6}$/);
    }
  });

  it("rejects unknown ids", () => {
    assert.equal(isColorId("gold"), true);
    assert.equal(isColorId("#fff"), false);
  });
});
