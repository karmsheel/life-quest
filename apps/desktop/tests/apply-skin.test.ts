import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgeVarsFromColors, forgeVarsFromSkin } from "../src/lib/themes/apply-skin.ts";
import { mix } from "../src/lib/themes/color.ts";
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
  "--border-strong",
];

describe("forgeVarsFromColors", () => {
  it("writes semantic tokens from SkinColors fields", () => {
    const vars = forgeVarsFromColors(sample);
    assert.equal(vars["--card"], "#222222");
    assert.equal(vars["--background"], "#222222");
    assert.equal(vars["--canvas-base"], "#111111");
    assert.equal(vars["--foreground"], "#eeeeee");
    assert.equal(vars["--primary"], "#ff0000");
    assert.equal(vars["--primary-foreground"], "#ffffff");
    assert.equal(vars["--destructive"], "#990000");
    assert.equal(vars["--border"], "#666666");
    assert.equal(vars["--input"], "#969696");
    assert.equal(vars["--ring"], "#0000ff");
    assert.equal(vars["--muted-foreground"], "#aaaaaa");
    assert.equal(vars["--muted-surface"], "#333333");
    assert.match(vars["--accent-fill"] ?? "", /#0000ff|0,\s*0,\s*255/);
  });

  it("mixes canvas-base when background equals card", () => {
    const light = forgeVarsFromColors({
      ...sample,
      background: "#faf9f7",
      card: "#faf9f7",
      popover: "#faf9f7",
      foreground: "#1a1916",
    });
    assert.equal(light["--background"], "#faf9f7");
    assert.equal(light["--card"], "#faf9f7");
    assert.equal(light["--canvas-base"], mix("#faf9f7", "#1a1916", 0.06));
    assert.notEqual(light["--canvas-base"], light["--card"]);

    const darkSame = forgeVarsFromColors({
      ...sample,
      background: "#111111",
      card: "#111111",
      popover: "#111111",
    });
    assert.equal(darkSame["--canvas-base"], mix("#111111", "#000000", 0.15));
    assert.notEqual(darkSame["--canvas-base"], darkSame["--card"]);
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

  it("writes --card-glass from card and skips --backdrop-panel", () => {
    const dark = forgeVarsFromColors(sample);
    assert.match(dark["--card-glass"] ?? "", /#222222/);
    assert.match(dark["--card-glass"] ?? "", /60%/);
    assert.equal(dark["--backdrop-panel"], undefined);

    const light = forgeVarsFromColors({
      ...sample,
      background: "#faf9f7",
      card: "#faf9f7",
      popover: "#faf9f7",
      foreground: "#1a1916",
    });
    assert.match(light["--card-glass"] ?? "", /#faf9f7/);
    assert.match(light["--card-glass"] ?? "", /52%/);
    assert.equal(light["--backdrop-panel"], undefined);
  });
});

describe("forgeVarsFromSkin", () => {
  it("emits --background and --primary for forge-os", () => {
    const vars = forgeVarsFromSkin(BUILTIN_SKINS[DEFAULT_SKIN_NAME], "light");
    assert.ok(vars["--background"]);
    assert.ok(vars["--primary"]);
    assert.ok(vars["--canvas-base"]);
    assert.equal(vars["--background"], vars["--card"]);
    assert.notEqual(vars["--canvas-base"], vars["--card"]);
    assert.equal(vars["--bg"], undefined);
    assert.equal(vars["--accent"], undefined);
  });
});
