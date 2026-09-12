import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readCss(): string {
  return fs.readFileSync(path.join(desktopRoot, "src/styles/global.css"), "utf8");
}

function readMapCss(): string {
  return fs.readFileSync(path.join(desktopRoot, "src/styles/map.css"), "utf8");
}

describe("shell visuals", () => {
  it("paints three studio panes on a gapped canvas tray", () => {
    const css = readCss();
    assert.match(css, /body\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root__body\s*\{[\s\S]*?padding:\s*var\(--shell-frame\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?gap:\s*var\(--shell-frame\)/);
    assert.equal(/\.shell\s*\{[^}]*background:\s*var\(--card\)/.test(css), false);
    assert.equal(/\.shell\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/.test(css), false);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?background:\s*var\(--card-glass\)/);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?backdrop-filter:\s*var\(--backdrop-panel\)/);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?-webkit-backdrop-filter:\s*var\(--backdrop-panel\)/);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?box-shadow:[\s\S]*?inset 0 1px 0/);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.shell__main\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.shell__main\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.equal(/\.shell__main\s*\{[^}]*background:\s*var\(--card-glass\)/.test(css), false);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?background:\s*var\(--card-glass\)/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?backdrop-filter:\s*var\(--backdrop-panel\)/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?-webkit-backdrop-filter:\s*var\(--backdrop-panel\)/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?box-shadow:[\s\S]*?inset 0 1px 0/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(
      css,
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)[\s\S]*?\.nav-rail[\s\S]*?background:\s*var\(--card\)/,
    );
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
    assert.match(css, /\.settings-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.nav-rail__link\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.recent-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-panel__icon\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-nav-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
  });

  it("bleeds Life Map inside the studio sheet on /chart only", () => {
    const css = readCss();
    assert.match(css, /\.shell__content--bleed\s*\{[\s\S]*?padding:\s*0/);
    assert.match(css, /\.shell__content--bleed\s*\{[\s\S]*?overflow:\s*hidden/);
    const mapCss = readMapCss();
    assert.match(
      mapCss,
      /\.shell__content--bleed\s*>\s*\.life-map\s*\{[\s\S]*?height:\s*100%/,
    );
    assert.match(
      mapCss,
      /\.shell__content--bleed\s*>\s*\.life-map\s*\{[\s\S]*?overflow:\s*auto/,
    );
    assert.match(
      mapCss,
      /\.shell__content--bleed\s*>\s*\.life-map\s*\{[\s\S]*?min-height:\s*0/,
    );
    const shell = fs.readFileSync(
      path.join(desktopRoot, "src/components/shell/AppShell.tsx"),
      "utf8",
    );
    assert.match(shell, /useLocation/);
    assert.match(shell, /pathname === ["']\/chart["']/);
    assert.match(shell, /shell__content--bleed/);
    assert.equal(shell.includes('pathname === "/dream"'), false);
    assert.equal(shell.includes('pathname === "/track"'), false);
  });

  it("lets Welcome scroll long content inside the sheet", () => {
    const css = readCss();
    assert.equal(/\.welcome\s*\{[^}]*overflow:\s*hidden/.test(css), false);
    assert.match(css, /\.welcome\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?border:\s*1px solid var\(--border\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?box-shadow:\s*var\(--shadow-sm\)/);
  });
});
