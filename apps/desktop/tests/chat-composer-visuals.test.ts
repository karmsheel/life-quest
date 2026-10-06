import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const css = (): string =>
  fs.readFileSync(path.join(desktopRoot, "src/styles/global.css"), "utf8");

const read = (relFromDesktop: string): string =>
  fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");

/**
 * The composer's surface, as shipped. This is where the design decision is
 * recorded: the accent lives on the field's own border and the band around it
 * carries nothing, which is the inverse of the tinted frame the field used to
 * sit inside. The negative assertions are the point — they are what stops the
 * old look growing back a piece at a time.
 *
 * Measured evidence: `e2e/composer-autogrow.electron.mjs` (the "composer chrome"
 * checks, read off the real element in a real layout engine), wrapper
 * `tests/composer-autogrow-e2e.test.ts`, artifact
 * `e2e/artifacts/composer-autogrow.json` + `composer-autogrow-focused.png`.
 *
 * Anchored with `^…\{[^}]*\}` rather than a bounded gap: the rules asserted here
 * are single-level, so a `[^}]*` body cannot swallow a neighbour, and an
 * attribute or declaration added between the two ends does not break the match.
 */
describe("chat composer surface", () => {
  it("the field wears the accent as a thicker ring of its own", () => {
    const source = css();
    const field = source.match(/^\.chat-panel__composer-input\s*\{[^}]*\}/m);
    assert.ok(field, ".chat-panel__composer-input rule");
    assert.match(field[0], /border:\s*2px solid var\(--accent\)/);
    // The neutral hairline is what the accent ring replaced.
    assert.equal(/border:\s*1px solid var\(--border\)/.test(field[0]), false);
  });

  it("the band around the field paints no fill and no hairline of its own", () => {
    const source = css();
    const footer = source.match(/^\.chat-panel__footer\s*\{[^}]*\}/m);
    assert.ok(footer, ".chat-panel__footer rule");
    assert.match(footer[0], /padding:\s*0\.75rem/);
    // The old frame, both halves: its tint and its top hairline.
    assert.equal(/background/.test(footer[0]), false);
    assert.equal(/border/.test(footer[0]), false);
  });

  it("selecting the field adds a glow and leaves the ring where it was", () => {
    const source = css();
    const focus = source.match(/^\.chat-panel__composer-input:focus\s*\{[^}]*\}/m);
    assert.ok(focus, ".chat-panel__composer-input:focus rule");
    assert.match(focus[0], /outline:\s*none/);
    assert.match(focus[0], /box-shadow:/);
    assert.match(focus[0], /0 0 0 3px color-mix\(in srgb, var\(--accent\)/);
    assert.match(focus[0], /0 0 14px 2px color-mix\(in srgb, var\(--accent\)/);
    // Selection is extra light, not a second colour: no border-colour override.
    assert.equal(/border-color/.test(focus[0]), false);
  });
});

/**
 * The composer's runtime row — the model and thinking pills, and the two hops
 * that carry a pick to the gateway. This is the design record for a decision
 * that is easy to undo by accident:
 *
 *  - The row is *absent*, not empty, when the gateway served no catalog: a
 *    companion that is not up must leave the composer exactly as it was.
 *  - The pick rides the turn (`runtime` → the chat body), and nothing is sent
 *    when nothing was picked, so an untouched composer sends the old body.
 *  - The menu opens upward and paints its own surface; the row paints nothing.
 *  - `ultra` is deliberately not offered — this transport cannot say which wire
 *    level a route would clamp it to.
 *
 * Measured evidence: `e2e/composer-model-pills.electron.mjs`, wrapper
 * `tests/composer-model-pills-e2e.test.ts`, artifact
 * `e2e/artifacts/composer-model-pills.json`.
 */
describe("composer model and thinking pills", () => {
  const composer = () =>
    read("src/components/hermes/ComposerModelControls.tsx");

  it("opens no row at all when the gateway served no catalog", () => {
    const source = composer();
    assert.match(source, /if \(!catalog \|\| catalog\.providers\.length === 0\) return null;/);
    // …and the panel only ever mounts it with the catalog it read.
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /<ComposerModelControls[\s\S]{0,220}catalog=\{modelCatalog\}/);
  });

  it("mounts once, on the thread surface, never on the chain's log field", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.equal(
      (chat.match(/<ComposerModelControls/g) ?? []).length,
      1,
      "the dock gained or lost a runtime control row",
    );
    // The chain writes a vault record, not an agent turn: its composer must not
    // offer a model. The one instance sits inside the thread's own form.
    assert.match(chat, /onSubmit=\{\(e\) => void onSubmit\(e\)\}/);
  });

  it("the pick rides the turn as `runtime`, and only when one was made", () => {
    assert.match(read("src/components/hermes/ChatPanel.tsx"), /runtime: runtimePick,/);
    const companion = read("electron/companion.ts");
    assert.match(companion, /\.\.\.runtimeRequestBody\(runtime\)/);
    const client = read("electron/companion-client.ts");
    // Absent fields leave the body as it was: no model, no options, no override.
    assert.match(client, /if \(model\) body\.model = model;/);
    assert.match(client, /if \(provider\) body\.provider = provider;/);
    // `off` is not a wire value; it is the reasoning switch, turned off.
    assert.match(
      client,
      /effort === "off"[\s\S]{0,120}body\.model_options = \{ reasoning: \{ enabled: false \} \}/,
    );
    // The ladder is the gateway's own, minus the step a route would clamp.
    const ladder = client.match(/COMPOSER_REASONING_EFFORTS = \[[^\]]*\]/);
    assert.ok(ladder, "the effort ladder left the main-side module");
    assert.equal(/ultra/.test(ladder[0]), false, "ultra needs a wire level to name");
    for (const effort of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      assert.match(ladder[0], new RegExp(`"${effort}"`));
    }
  });

  it("keeps the pick on the chat, not on the client", () => {
    const chat = read("src/components/hermes/ChatPanel.tsx");
    assert.match(chat, /const RUNTIME_PINS_KEY = "lifequest\.companion\.runtimePins";/);
    // Keyed by session id, and derived from the chat that is open.
    assert.match(chat, /runtimePins\[sessionId\]/);
    assert.match(
      chat,
      /function updateRuntimePick\(next: CompanionRuntimeOverride\) \{[\s\S]{0,140}if \(!activeId\) return;/,
    );
    // The superseded design was one pick for the whole client, carried into every
    // chat. Per-chat scope was a named request, so that key must not come back.
    assert.equal(
      /"lifequest\.companion\.runtime"/.test(chat),
      false,
      "the client-wide pick key is back beside the per-chat pins",
    );
    // And the menu's provider is the chat's: browsing Anthropic in one chat must
    // not decide the list the next chat opens on.
    const controls = read("src/components/hermes/ComposerModelControls.tsx");
    assert.match(controls, /if \(menu === "model" && openMenu !== "model"\) setProviderSlug\(""\);/);
  });

  it("lists a provider's models newest-first, with Automatic above them", () => {
    const controls = read("src/components/hermes/ComposerModelControls.tsx");
    // The catalogue's own order is oldest-first; the menu shows the reversed copy.
    assert.match(controls, /const modelRows = \[\.\.\.\(list\?\.models \?\? \[\]\)\]\.reverse\(\);/);
    assert.match(controls, /\{modelRows\.map\(\(model\) => \{/);
    assert.equal(
      /\{\(list\?\.models \?\? \[\]\)\.map/.test(controls),
      false,
      "the menu renders the catalogue's own order directly again",
    );
    // Automatic is the escape hatch, not a model: it stays above the models.
    const automatic = controls.indexOf("Automatic, the profile's default model");
    const models = controls.indexOf("{modelRows.map");
    assert.ok(
      automatic > 0 && models > automatic,
      "Automatic no longer precedes the model rows",
    );
  });

  it("the row paints nothing and its menu opens upward onto its own surface", () => {
    const source = css();
    const row = source.match(/^\.chat-panel__composer-controls\s*\{[^}]*\}/m);
    assert.ok(row, ".chat-panel__composer-controls rule");
    assert.match(row[0], /position:\s*relative/);
    assert.equal(/background/.test(row[0]), false, "the runtime row paints a fill of its own");
    assert.equal(/border/.test(row[0]), false, "the runtime row paints a hairline of its own");

    const menu = source.match(/^\.chat-panel__composer-menu\s*\{[^}]*\}/m);
    assert.ok(menu, ".chat-panel__composer-menu rule");
    assert.match(menu[0], /position:\s*absolute/);
    assert.match(menu[0], /bottom:\s*calc\(100% \+ 0\.35rem\)/);
    assert.match(menu[0], /background:\s*var\(--card\)/);
    // The composer is the bottom of the panel, so the menu must open upward:
    // anchoring it to `top` would hang it off the bottom of the window.
    assert.equal(/[^-]top:/.test(menu[0]), false, "the menu is anchored downward");
  });

  it("the pill marks a pick of the operator's own, and cannot submit the field", () => {
    const source = composer();
    assert.match(source, /data-override=\{pickedModel \? "true" : "false"\}/);
    assert.match(source, /aria-haspopup="menu"/);
    assert.match(source, /aria-expanded=\{openMenu === "model"\}/);
    assert.match(source, /role="menuitemradio"/);
    // Inside the composer's form, so every control in the row must be
    // type="button" or Enter on a pill would submit the draft above it.
    assert.equal(/<button\n?\s*type="submit"/.test(source), false);
    assert.match(read("src/styles/global.css"), /\.chat-panel__pill\[data-override="true"\]\s*\{[^}]*border-color:\s*color-mix/);
  });

  it("offers only a model the gateway can route, and only where the catalog allows it", () => {
    const source = composer();
    // An unauthenticated provider is offered inert, so a pick cannot become an
    // auth error on the next turn.
    assert.match(source, /disabled=\{!provider\.authenticated\}/);
    // Thinking off only where the catalog says this model may stop thinking.
    assert.match(source, /if \(effort === "off" && !canDisableReasoning\) return null;/);
    // The thinking pill follows the Desktop rule: present when the model has a
    // reasoning control at all, not only when it may be switched off.
    assert.match(source, /const supportsReasoning = choice\?\.reasoning === true;/);
    assert.match(source, /\{supportsReasoning \? \(/);
  });
});
