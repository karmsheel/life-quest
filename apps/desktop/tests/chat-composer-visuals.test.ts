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
