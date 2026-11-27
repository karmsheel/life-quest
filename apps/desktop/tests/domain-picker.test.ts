import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  choiceFromLegacyVariant,
  layerDomainPicker,
  mergeDomainPickerOverride,
  parseDomainPickerChoice,
  resolveDomainPicker,
} from "../shared/domain-picker.ts";
import { layerChrome, parseThemeFile, resolveChrome } from "../shared/theme-file.ts";

const baseFile = {
  name: "lens",
  label: "Lens",
};

describe("domain picker recipe", () => {
  it("resolves the four shipped modes", () => {
    assert.deepEqual(resolveDomainPicker({ mode: "life-mark" }), {
      arrangement: "centre",
      mark: "circle",
      labels: "names",
      chips: "segment",
    });
    assert.deepEqual(resolveDomainPicker({ mode: "named-strip" }), {
      arrangement: "leading",
      mark: "chip",
      labels: "names",
      chips: "segment",
    });
    assert.deepEqual(resolveDomainPicker({ mode: "initials" }), {
      arrangement: "centre",
      mark: "circle",
      labels: "initials",
      chips: "segment",
    });
    assert.deepEqual(resolveDomainPicker({ mode: "stack" }), {
      arrangement: "stack",
      mark: "chip",
      labels: "names",
      chips: "segment",
    });
  });

  it("layers one axis over a shipped mode without dropping the mode", () => {
    const choice = layerDomainPicker(
      { mode: "named-strip" },
      { recipe: { chips: "pill" } },
    );
    assert.equal(choice.mode, "named-strip");
    assert.equal(resolveDomainPicker(choice).chips, "pill");
    assert.equal(resolveDomainPicker(choice).arrangement, "leading");
  });

  it("does not invent a mode when an override only names an axis", () => {
    const merged = mergeDomainPickerOverride(undefined, {
      recipe: { labels: "initials" },
    });
    assert.equal(merged.mode, undefined);
    assert.deepEqual(merged.recipe, { labels: "initials" });
  });

  it("refuses an unknown mode and an unknown axis by field name", () => {
    const mode = parseDomainPickerChoice(
      { mode: "orb" },
      "chrome.domainPicker",
    );
    assert.equal(mode.ok, false);
    if (!mode.ok) {
      assert.match(mode.error, /chrome\.domainPicker\.mode must be one of/);
    }
    const axis = parseDomainPickerChoice(
      { mode: "custom", recipe: { mark: "halo" } },
      "chrome.domainPicker",
    );
    assert.equal(axis.ok, false);
    if (!axis.ok) {
      assert.equal(
        axis.error,
        "chrome.domainPicker.recipe.mark must be one of circle, chip",
      );
    }
  });
});

describe("domain picker and the older variant", () => {
  it("maps a variant-only file onto the shape that variant already drew", () => {
    assert.deepEqual(choiceFromLegacyVariant("segmented"), { mode: "life-mark" });
    assert.deepEqual(choiceFromLegacyVariant("pill"), {
      mode: "life-mark",
      recipe: { chips: "pill" },
    });
    assert.equal(choiceFromLegacyVariant("icons").mode, "initials");
    assert.equal(choiceFromLegacyVariant("list").mode, "stack");

    const icons = resolveChrome({
      domainSwitcher: { place: "left-rail", variant: "icons", frame: "pill" },
    });
    assert.equal(icons.domainPicker.mode, "initials");
    assert.equal(resolveDomainPicker(icons.domainPicker).labels, "initials");

    const list = resolveChrome({
      domainSwitcher: { place: "left-rail", variant: "list", frame: "bare" },
    });
    assert.equal(list.domainPicker.mode, "stack");
    assert.equal(resolveDomainPicker(list.domainPicker).arrangement, "stack");
  });

  it("lets a named recipe win over a leftover variant", () => {
    const worn = resolveChrome({
      domainSwitcher: { place: "titlebar-center", variant: "list", frame: "pill" },
      domainPicker: { mode: "life-mark" },
    });
    assert.equal(worn.domainPicker.mode, "life-mark");
    assert.equal(resolveDomainPicker(worn.domainPicker).arrangement, "centre");
    assert.equal(worn.domainSwitcher.variant, "list");
  });

  it("layers an operator axis onto a variant-only theme without pinning the mode", () => {
    const worn = layerChrome(
      { domainSwitcher: { place: "titlebar-center", variant: "icons", frame: "pill" } },
      { domainPicker: { recipe: { chips: "pill" } } },
    );
    assert.equal(worn.domainPicker.mode, "initials");
    assert.equal(resolveDomainPicker(worn.domainPicker).chips, "pill");
    assert.equal(resolveDomainPicker(worn.domainPicker).mark, "circle");
  });

  it("lets the operator's mode outrank the theme's variant", () => {
    const worn = layerChrome(
      { domainSwitcher: { place: "left-rail", variant: "list", frame: "pill" } },
      { domainPicker: { mode: "named-strip" } },
    );
    assert.equal(worn.domainPicker.mode, "named-strip");
    assert.equal(resolveDomainPicker(worn.domainPicker).arrangement, "leading");
  });

  it("refuses a theme file's bad mode and keeps a good one", () => {
    const bad = parseThemeFile({
      ...baseFile,
      chrome: { domainPicker: { mode: "orb" } },
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.match(bad.error, /chrome\.domainPicker\.mode must be one of/);
    }
    const good = parseThemeFile({
      ...baseFile,
      chrome: {
        domainPicker: { mode: "named-strip", recipe: { labels: "initials" } },
      },
    });
    assert.equal(good.ok, true);
    if (good.ok) {
      assert.equal(good.theme.chrome?.domainPicker?.mode, "named-strip");
      const worn = resolveChrome(good.theme.chrome);
      assert.equal(resolveDomainPicker(worn.domainPicker).arrangement, "leading");
      assert.equal(resolveDomainPicker(worn.domainPicker).labels, "initials");
    }
  });
});
