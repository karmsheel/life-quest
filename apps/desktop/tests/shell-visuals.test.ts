import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readCss(): string {
  return fs.readFileSync(path.join(desktopRoot, "src/styles/global.css"), "utf8");
}

describe("shell visuals", () => {
  it("paints the window as canvas and the studio as a sheet", () => {
    const css = readCss();
    assert.match(css, /body\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root__body\s*\{[\s\S]*?padding:\s*var\(--shell-frame\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?border-radius:\s*var\(--radius-lg\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?box-shadow:\s*var\(--shadow-sm\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?border-radius:\s*var\(--radius-lg\)/);
  });

  it("keeps the titlebar flush on canvas", () => {
    const css = readCss();
    assert.match(css, /\.window-titlebar\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.equal(
      /\.window-titlebar\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/.test(css),
      false,
    );
    assert.match(css, /\.window-titlebar__btn\s*\{[\s\S]*?border-radius:\s*0/);
  });

  it("does not turn boot status into a sheet", () => {
    const css = readCss();
    assert.equal(/\.centered-status\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/.test(css), false);
  });

  it("pills buttons and uses the concentric scale on shared chrome", () => {
    const css = readCss();
    assert.match(css, /\.btn\s*\{[\s\S]*?border-radius:\s*var\(--radius-pill\)/);
    assert.match(css, /\.field input\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-md\)/);
    assert.match(css, /\.nav-rail__link\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.recent-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-panel__icon\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-nav-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
  });
});
