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
    // The rail is flush now: it pays the tray's frame back on three sides and
    // reaches over the titlebar row. The measured box — insets, height, and the
    // one control in its topband — is asserted by the shell-sidebar e2e rig;
    // what only source can cover is the app-region carve-out, because a drag
    // region wins OS hit-testing over the DOM and no synthetic click sees it.
    assert.match(
      css,
      /\.nav-rail\s*\{[\s\S]*?margin-top:\s*calc\(-1 \* \(var\(--shell-frame\) \+ var\(--window-titlebar-height\)\)\)/,
    );
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?border-right:\s*1px solid var\(--border\)/);
    assert.equal(/\.nav-rail\s*\{[^}]*border-radius/.test(css), false);
    assert.equal(/\.nav-rail\s*\{[^}]*box-shadow/.test(css), false);
    assert.match(css, /\.nav-rail__header\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
    assert.match(css, /\.nav-toggle\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/);
    // The shell reserves the rail's column in the strip in both states, and the
    // toggle floats in it rather than taking flow space — so neither it nor the
    // chip moves when the rail opens or closes.
    assert.match(
      css,
      /\.window-titlebar--nav-column\s+\.window-titlebar__leading\s*\{[\s\S]*?padding-left:\s*var\(--shell-nav-width\)/,
    );
    assert.match(
      css,
      /\.window-titlebar__leading\s+\.window-titlebar__nav-toggle\s*\{[\s\S]*?position:\s*absolute[\s\S]*?left:\s*calc\(\(var\(--shell-nav-width\) - var\(--nav-toggle-size\)\) \/ 2\)/,
    );
    assert.match(css, /\.shell__main\s*\{[\s\S]*?background:\s*var\(--card\)/);
    // The sheet is square, and keeps exactly one hairline: its top edge, the
    // line under the titlebar. The leading and trailing hairlines belong to the
    // rail and the dock, so the sheet must not double them, and its bottom edge
    // is left to the mat. Radius and the three side borders are gone for good.
    assert.equal(/\.shell__main\s*\{[^}]*border-radius/.test(css), false);
    assert.match(css, /\.shell__main\s*\{[^}]*border:\s*0/);
    assert.match(css, /\.shell__main\s*\{[^}]*border-top:\s*1px solid var\(--border\)/);
    assert.equal(/\.shell__main\s*\{[^}]*border-left:/.test(css), false);
    assert.equal(/\.shell__main\s*\{[^}]*border-right:/.test(css), false);
    assert.equal(/\.shell__main\s*\{[^}]*border-bottom:/.test(css), false);
    assert.equal(/\.shell__main\s*\{[^}]*background:\s*var\(--card-glass\)/.test(css), false);
    // The dock is a pane on the sheet's own surface, and the only flush one:
    // square, unfrosted, no shadow, one leading hairline, escaping the tray's
    // frame on the right and bottom the way the rail escapes it on the left.
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?border-left:\s*1px solid var\(--border\)/);
    assert.match(
      css,
      /\.chat-panel\s*\{[\s\S]*?width:\s*calc\(var\(--chat-column\) \+ var\(--shell-frame\)\)/,
    );
    assert.match(
      css,
      /\.chat-panel\s*\{[\s\S]*?height:\s*calc\(100% \+ var\(--shell-frame\)\)/,
    );
    assert.equal(/\.chat-panel\s*\{[^}]*var\(--card-glass\)/.test(css), false);
    assert.equal(/\.chat-panel\s*\{[^}]*backdrop-filter/.test(css), false);
    assert.equal(/\.chat-panel\s*\{[^}]*box-shadow/.test(css), false);
    assert.equal(/\.chat-panel\s*\{[^}]*border-radius/.test(css), false);
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
