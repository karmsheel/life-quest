import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readTokens(): string {
  return fs.readFileSync(path.join(desktopRoot, "src/styles/tokens.css"), "utf8");
}

describe("token contract", () => {
  it("defines semantic tokens with the current light hex values", () => {
    const css = readTokens();
    assert.match(css, /--canvas-base:\s*#faf9f7/);
    assert.match(css, /--background:\s*#fffefc/);
    assert.match(css, /--foreground:\s*#1a1916/);
    assert.match(css, /--card:\s*#fffefc/);
    assert.match(css, /--muted-surface:\s*#eef1f5/);
    assert.match(css, /--muted-foreground:\s*#74716b/);
    assert.match(css, /--primary:\s*#c96442/);
    assert.match(css, /--primary-foreground:\s*#ffffff/);
    assert.match(css, /--destructive:\s*#9c2a25/);
    assert.match(css, /--input:\s*#c9d0da/);
    assert.match(css, /--ring:\s*#2563eb/);
    assert.match(css, /--accent-fill:\s*rgba\(37,\s*99,\s*235,\s*0\.16\)/);
    assert.match(css, /--primary-hover:\s*#b45a3b/);
  });

  it("aliases legacy names instead of storing a second hex vocabulary", () => {
    const css = readTokens();
    assert.match(css, /--bg:\s*var\(--background\)/);
    assert.match(css, /--bg-app:\s*var\(--background\)/);
    assert.match(css, /--bg-elevated:\s*var\(--card\)/);
    assert.match(css, /--bg-muted:\s*var\(--muted-surface\)/);
    assert.match(css, /--text:\s*var\(--foreground\)/);
    assert.match(css, /--fg:\s*var\(--foreground\)/);
    assert.match(css, /--text-muted:\s*var\(--muted-foreground\)/);
    assert.match(css, /--muted:\s*var\(--muted-foreground\)/);
    assert.match(css, /--accent:\s*var\(--primary\)/);
    assert.match(css, /--accent-fg:\s*var\(--primary-foreground\)/);
    assert.match(css, /--accent-hover:\s*var\(--primary-hover\)/);
    assert.match(css, /--accent-strong:\s*var\(--primary-hover\)/);
    assert.match(css, /--danger:\s*var\(--destructive\)/);
    assert.match(css, /--red:\s*var\(--destructive\)/);
    assert.match(css, /--selected:\s*var\(--ring\)/);
    assert.match(css, /--selected-soft:\s*var\(--accent-fill\)/);
    assert.match(css, /--border-strong:\s*var\(--input\)/);
    assert.equal(/--accent:\s*#/.test(css), false);
    assert.equal(/--bg:\s*#/.test(css), false);
    assert.equal(/--muted:\s*#/.test(css), false);
  });

  it("keeps dark paper values on semantic tokens", () => {
    const css = readTokens();
    assert.match(css, /\[data-theme="dark"\][\s\S]*--canvas-base:\s*#1a1917/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--background:\s*#2a2825/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--card:\s*#2a2825/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--primary:\s*#d97a56/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--foreground:\s*#e8e4dc/);
  });

  it("defines concentric radii and the shell frame", () => {
    const css = readTokens();
    assert.match(css, /--radius-xs:\s*6px/);
    assert.match(css, /--radius-sm:\s*12px/);
    assert.match(css, /--radius:\s*12px/);
    assert.match(css, /--radius-md:\s*18px/);
    assert.match(css, /--radius-lg:\s*24px/);
    assert.match(css, /--radius-pill:\s*999px/);
    assert.match(css, /--shell-frame:\s*12px/);
  });

  it("does not alias --canvas-base through --background", () => {
    const css = readTokens();
    assert.equal(/--canvas-base:\s*var\(/.test(css), false);
    assert.match(css, /--bg:\s*var\(--background\)/);
    assert.match(css, /--accent:\s*var\(--primary\)/);
  });

  it("defines quiet frost glass tokens", () => {
    const css = readTokens();
    assert.match(
      css,
      /:root\s*\{[\s\S]*?--card-glass:\s*color-mix\(in srgb,\s*var\(--card\)\s*52%,\s*transparent\)/,
    );
    assert.match(
      css,
      /:root\s*\{[\s\S]*?--backdrop-panel:\s*blur\(18px\)\s*saturate\(160%\)\s*brightness\(1\.02\)/,
    );
    assert.match(
      css,
      /\[data-theme="dark"\]\s*\{[\s\S]*?--card-glass:\s*color-mix\(in srgb,\s*var\(--card\)\s*60%,\s*transparent\)/,
    );
    assert.match(
      css,
      /\[data-theme="dark"\]\s*\{[\s\S]*?--backdrop-panel:\s*blur\(18px\)\s*saturate\(160%\)\s*brightness\(1\.08\)/,
    );
    assert.equal(/--card-glass:\s*var\(--card\)/.test(css), false);
  });
});
