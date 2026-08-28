import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("window chrome (main)", () => {
  const src = read("electron/main.ts");

  it("hides the native title bar and keeps the frame", () => {
    assert.match(src, /titleBarStyle:\s*["']hidden["']/);
    assert.match(src, /titleBarOverlay/);
    assert.match(src, /TITLEBAR_OVERLAY_HEIGHT\s*=\s*32/);
    assert.equal(src.includes("frame: false"), false);
    assert.equal(src.includes("frame:false"), false);
  });

  it("removes the application menu on Windows and Linux", () => {
    assert.match(src, /removeMenu\s*\(/);
  });

  it("keeps View-menu accelerators without a visible menu bar", () => {
    assert.match(src, /before-input-event/);
    assert.match(src, /toggleDevTools/);
    assert.match(src, /["']F12["']/);
    assert.match(src, /["']F11["']/);
    assert.match(src, /app\.quit\s*\(/);
  });

  it("exposes overlay and window-control IPC", () => {
    assert.match(src, /window:getChrome/);
    assert.match(src, /window:setTitleBarOverlay/);
    assert.match(src, /window:minimize/);
    assert.match(src, /window:toggleMaximize/);
    assert.match(src, /window:close/);
    assert.match(src, /window:isMaximized/);
    assert.match(src, /window:maximizeChanged/);
  });
});

describe("window chrome (preload)", () => {
  const src = read("electron/preload.ts");

  it("exposes windowChrome on the existing lifequest bridge", () => {
    assert.match(src, /windowChrome\s*:/);
    assert.match(src, /window:getChrome/);
    assert.match(src, /window:setTitleBarOverlay/);
    assert.match(src, /window:minimize/);
    assert.match(src, /window:toggleMaximize/);
    assert.match(src, /window:close/);
    assert.match(src, /window:isMaximized/);
    assert.match(src, /window:maximizeChanged/);
  });
});
