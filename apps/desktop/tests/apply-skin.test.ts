import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgeVarsFromColors, forgeVarsFromSkin } from "../src/lib/themes/apply-skin.ts";
import { BUILTIN_SKINS, DEFAULT_SKIN_NAME } from "../src/lib/themes/presets.ts";
import type { SkinColors } from "../src/lib/themes/types.ts";

const sample: SkinColors = {
  background: "#111111",
  foreground: "#eeeeee",
  card: "#222222",
  cardForeground: "#eeeeee",
  muted: "#333333",
  mutedForeground: "#aaaaaa",
  popover: "#222222",
  popoverForeground: "#eeeeee",
  primary: "#ff0000",
  primaryForeground: "#ffffff",
  secondary: "#444444",
  secondaryForeground: "#eeeeee",
  accent: "#555555",
  accentForeground: "#eeeeee",
  border: "#666666",
  input: "#777777",
  ring: "#0000ff",
  destructive: "#990000",
  destructiveForeground: "#ffffff",
};

const FORBIDDEN = [
  "--bg",
  "--bg-app",
  "--text",
  "--fg",
  "--accent",
  "--accent-fg",
  "--accent-hover",
  "--accent-strong",
  "--muted",
  "--danger",
  "--red",
  "--selected",
  "--selected-soft",
  "--bg-elevated",
  "--bg-muted",
  "--text-muted",
];

describe("forgeVarsFromColors", () => {
  it("writes semantic tokens from SkinColors fields", () => {
    const vars = forgeVarsFromColors(sample);
    assert.equal(vars["--background"], "#111111");
    assert.equal(vars["--foreground"], "#eeeeee");
    assert.equal(vars["--card"], "#222222");
    assert.equal(vars["--primary"], "#ff0000");
    assert.equal(vars["--primary-foreground"], "#ffffff");
    assert.equal(vars["--destructive"], "#990000");
    assert.equal(vars["--border"], "#666666");
    // --input is the former --border-strong (computed), not raw SkinColors.input
    assert.equal(vars["--input"], "#969696");
    assert.equal(vars["--ring"], "#0000ff");
    assert.equal(vars["--muted-foreground"], "#aaaaaa");
    assert.equal(vars["--muted-surface"], "#333333");
    assert.match(vars["--accent-fill"] ?? "", /#0000ff|0,\s*0,\s*255/);
  });

  it("does not treat Forge accent as brand primary", () => {
    const vars = forgeVarsFromColors(sample);
    assert.equal(vars["--primary"], "#ff0000");
    assert.notEqual(vars["--primary"], "#555555");
  });

  it("does not inline legacy alias names", () => {
    const vars = forgeVarsFromColors(sample);
    for (const key of FORBIDDEN) {
      assert.equal(vars[key], undefined, key);
    }
  });
});

describe("forgeVarsFromSkin", () => {
  it("emits --background and --primary for forge-os", () => {
    const vars = forgeVarsFromSkin(BUILTIN_SKINS[DEFAULT_SKIN_NAME], "light");
    assert.ok(vars["--background"]);
    assert.ok(vars["--primary"]);
    assert.equal(vars["--bg"], undefined);
    assert.equal(vars["--accent"], undefined);
  });
});
