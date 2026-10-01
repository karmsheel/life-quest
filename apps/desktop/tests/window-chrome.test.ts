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

describe("window chrome (renderer)", () => {
  it("mounts WindowTitleBar at the app root", () => {
    const src = read("src/App.tsx");
    assert.match(src, /import \{ WindowTitleBar \} from ["']@\/components\/shell\/WindowTitleBar["']/);
    assert.match(src, /className="app-root"/);
    assert.match(src, /<WindowTitleBar\s*\/>/);
    assert.match(src, /className="app-root__body"/);
  });

  it("syncs overlay caption colors from theme tokens", () => {
    const src = read("src/components/theme/ThemeProvider.tsx");
    assert.match(src, /window\.lifequest\?\.windowChrome/);
    assert.match(src, /setTitleBarOverlay/);
    assert.match(src, /getPropertyValue\(["']--canvas-base["']\)/);
    assert.match(src, /getPropertyValue\(["']--foreground["']\)/);
    assert.equal(src.includes('getPropertyValue("--background")'), false);
    assert.equal(src.includes("getPropertyValue('--background')"), false);
    assert.equal(src.includes('getPropertyValue("--bg")'), false);
    assert.equal(src.includes("getPropertyValue('--bg')"), false);
    assert.equal(src.includes('getPropertyValue("--text")'), false);
  });

  it("sizes the titlebar with overlay env vars and fills remaining height", () => {
    const css = read("src/styles/global.css");
    const tokens = read("src/styles/tokens.css");
    assert.match(tokens, /--window-titlebar-height:\s*32px/);
    assert.match(css, /\.app-root\b/);
    assert.match(css, /\.window-titlebar\b/);
    assert.match(css, /-webkit-app-region:\s*drag/);
    assert.match(css, /titlebar-area-height/);
    assert.match(css, /titlebar-area-width/);
    assert.match(css, /titlebar-area-x/);
    assert.equal(/\.shell \{[\s\S]*?min-height:\s*100vh/.test(css), false);
    assert.equal(/\.nav-rail \{[\s\S]*?height:\s*100vh/.test(css), false);
    assert.match(css, /\.welcome \{[\s\S]*?min-height:\s*100%/);
    assert.match(css, /\.centered-status \{[\s\S]*?min-height:\s*100%/);
  });

  it("puts the chat collapse toggle in the titlebar next to window controls", () => {
    const titlebar = read("src/components/shell/WindowTitleBar.tsx");
    const chat = read("src/components/hermes/ChatPanel.tsx");
    const shell = read("src/components/shell/AppShell.tsx");
    const app = read("src/App.tsx");
    const css = read("src/styles/global.css");

    assert.match(titlebar, /Collapse chat/);
    assert.match(titlebar, /Expand chat/);
    assert.match(titlebar, /useChatDock/);
    assert.match(titlebar, /window-titlebar__trailing/);
    assert.match(titlebar, /window-titlebar__btn/);
    assert.equal(chat.includes("Collapse chat"), false);
    assert.match(shell, /useChatDock/);
    assert.match(app, /ChatDockProvider/);
    assert.match(
      css,
      /\.window-titlebar__trailing\s*\{[\s\S]*?titlebar-area-width/,
    );
    assert.match(
      css,
      /\.window-titlebar__trailing\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/,
    );
  });

  it("vertically centers titlebar control icons in their hit targets", () => {
    const css = read("src/styles/global.css");
    assert.match(css, /\.window-titlebar__btn\s*\{[^}]*height:\s*100%/);
    assert.match(css, /\.window-titlebar__btn\s*\{[^}]*padding:\s*0/);
    assert.match(css, /\.window-titlebar__btn\s*\{[^}]*line-height:\s*0/);
    assert.match(css, /\.window-titlebar__trailing svg\s*\{[^}]*display:\s*block/);
    assert.match(
      css,
      /\.window-titlebar__trailing svg\s*\{[^}]*transform:\s*translateY\(1px\)/,
    );
  });

  it("puts settings and day/night toggles in the titlebar next to chat collapse", () => {
    const titlebar = read("src/components/shell/WindowTitleBar.tsx");
    const nav = read("src/components/shell/NavRail.tsx");

    assert.match(titlebar, /NavThemeModeToggle/);
    assert.match(titlebar, /SettingsMenu/);
    assert.match(titlebar, /placement=["']bottom-end["']/);
    assert.equal(nav.includes("NavThemeModeToggle"), false);
    assert.equal(nav.includes("SettingsMenu"), false);
    assert.equal(nav.includes("nav-rail__settings"), false);
  });

  it("names the vault in the titlebar, not the nav rail", () => {
    const titlebar = read("src/components/shell/WindowTitleBar.tsx");
    const nav = read("src/components/shell/NavRail.tsx");
    const css = read("src/styles/global.css");

    assert.match(titlebar, /window-titlebar__leading/);
    assert.match(titlebar, /window-titlebar__vault/);
    assert.match(titlebar, /to=["']\/home["']/);
    assert.match(titlebar, /vaultTitleName\(/);
    // The app's mark and wordmark are gone from the strip: it wears the
    // workspace's own name, on a highlighted chip.
    assert.equal(titlebar.includes("LQ"), false);
    assert.equal(titlebar.includes("window-titlebar__logo"), false);
    assert.equal(titlebar.includes("window-titlebar__label"), false);
    assert.equal(css.includes(".window-titlebar__logo"), false);
    assert.equal(css.includes(".window-titlebar__brand"), false);
    assert.equal(css.includes(".window-titlebar__label"), false);
    assert.equal(nav.includes("nav-rail__brand"), false);
    assert.equal(nav.includes("nav-rail__logo"), false);
    assert.match(
      css,
      /\.window-titlebar__vault\s*\{[\s\S]*?background:\s*var\(--accent-tint\)/,
    );
    assert.match(
      css,
      /\.window-titlebar__vault\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/,
    );
  });
});
