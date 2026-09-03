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
  });

  it("has RFC-style laws", () => {
    const readme = read("LAWS/README.md");
    assert.match(readme, /MUST/);
    assert.match(read("LAWS/IDENTITY.md"), /MUST NOT require an account/);
    assert.match(read("LAWS/SECRETS.md"), /MUST NOT be stored in the vault/);
    assert.match(read("LAWS/DOMAIN-FILTER.md"), /domain switcher MUST/);
    assert.match(read("LAWS/WINGS.md"), /MUST NOT filter/);
    assert.match(read("LAWS/DOCTRINE.md"), /MUST NOT be edited in place/);
  });

  it("documents shared UI rules", () => {
    const src = read("apps/desktop/src/components/ui/AGENTS.md");
    assert.match(src, /Button/);
    assert.match(src, /hex/);
    assert.match(src, /pill/);
    assert.match(src, /\.shell/);
  });
});
