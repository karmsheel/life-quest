import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isThemePreference, resolveThemePreference } from "../src/lib/theme.ts";
import {
  BUILTIN_SKINS,
  DEFAULT_SKIN_NAME,
  filterSkinsForPreference,
  skinSupportsBothModes,
} from "../src/lib/themes/presets.ts";

describe("resolveThemePreference", () => {
  it("keeps an explicit light or dark preference", () => {
    assert.equal(resolveThemePreference("light", true), "light");
    assert.equal(resolveThemePreference("dark", false), "dark");
  });

  it("follows the system preference when asked", () => {
    assert.equal(resolveThemePreference("system", true), "dark");
    assert.equal(resolveThemePreference("system", false), "light");
  });

  it("accepts only system, light, or dark strings", () => {
    assert.equal(isThemePreference("dark"), true);
    assert.equal(isThemePreference("dim"), false);
  });
});

describe("skins", () => {
  it("defaults to Forge OS", () => {
    assert.equal(DEFAULT_SKIN_NAME, "forge-os");
    assert.ok(BUILTIN_SKINS["forge-os"]);
  });

  it("Forge OS and Nous support both day and night palettes", () => {
    assert.equal(skinSupportsBothModes(BUILTIN_SKINS["forge-os"]), true);
    assert.equal(skinSupportsBothModes(BUILTIN_SKINS.nous), true);
  });

  it("system preference lists only dual-palette skins", () => {
    const skins = filterSkinsForPreference(Object.values(BUILTIN_SKINS), "system");
    assert.ok(skins.every(skinSupportsBothModes));
    assert.ok(skins.some((s) => s.name === "forge-os"));
    assert.ok(skins.some((s) => s.name === "nous"));
    assert.ok(!skins.some((s) => s.name === "cyberpunk"));
  });

  it("dark preference includes dark-only skins", () => {
    const skins = filterSkinsForPreference(Object.values(BUILTIN_SKINS), "dark");
    assert.ok(skins.some((s) => s.name === "cyberpunk"));
    assert.ok(skins.some((s) => s.name === "midnight"));
  });
});
