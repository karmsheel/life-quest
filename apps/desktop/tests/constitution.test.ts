import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("product constitution", () => {
  it("has PRODUCT.md with purpose and anti-references", () => {
    const src = read("PRODUCT.md");
    assert.match(src, /## Users/);
    assert.match(src, /## Product Purpose/);
    assert.match(src, /## Anti-references/);
    assert.match(src, /chatbot wrapper/);
    assert.match(src, /Premise → Vision → Purpose → Strategy/);
    assert.match(src, /does not open without the companion/);
    assert.match(src, /Capture is not the studio/);
    assert.doesNotMatch(src, /optionally talking to Hermes/);
  });

  it("README.md matches VISION identity", () => {
    const src = read("README.md");
    assert.match(src, /Premise → Vision → Purpose → Strategy/);
    assert.match(src, /does not open without the companion/);
    assert.doesNotMatch(src, /Hermes remains an optional/);
    assert.doesNotMatch(src, /Why → What → How/);
    assert.doesNotMatch(src, /## Hermes \(optional\)/);
  });

  it("has DESIGN.md with canvas ladder and remaining Phase 2 do-not-do", () => {
    const src = read("DESIGN.md");
    assert.match(src, /Grounded life studio/);
    assert.match(src, /--accent-fill/);
    assert.match(src, /--muted-surface/);
    assert.match(src, /--canvas-base/);
    assert.match(src, /PageShell/);
    assert.match(src, /card-glass/);
    assert.match(src, /--radius-pill/);
    assert.match(src, /--shell-frame/);
    assert.match(src, /\.nav-rail/);
    assert.match(src, /\.chat-panel/);
  });

  it("has RFC-style laws", () => {
    const readme = read("LAWS/README.md");
    assert.match(readme, /MUST/);
    assert.match(read("LAWS/IDENTITY.md"), /MUST NOT require an account/);
    assert.match(read("LAWS/SECRETS.md"), /MUST NOT be stored in the vault/);
    assert.match(read("LAWS/DOMAIN-FILTER.md"), /domain switcher MUST/);
    assert.match(read("LAWS/WINGS.md"), /MUST NOT filter/);
    assert.match(read("LAWS/DOCTRINE.md"), /MUST NOT be edited in place/);
    assert.match(read("LAWS/DOCTRINE.md"), /four doctrine sections/);
    assert.match(read("LAWS/DOCTRINE.md"), /Agents MUST NOT lock or unlock/);
    assert.match(read("LAWS/DOCTRINE.md"), /pending Decision/);
    assert.match(read("LAWS/COMPANION.md"), /MUST NOT open without the companion/);
  });

  it("documents shared UI rules", () => {
    const src = read("apps/desktop/src/components/ui/AGENTS.md");
    assert.match(src, /Button/);
    assert.match(src, /hex/);
    assert.match(src, /pill/);
    assert.match(src, /\.shell/);
    assert.match(src, /pane/);
  });

  it("LAWS/DOCTRINE.md has agent lock rules", () => {
    const src = read("LAWS/DOCTRINE.md");
    assert.match(src, /Agents MUST NOT lock or unlock/);
    assert.match(src, /pending Decision/);
  });
});
