import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { shouldHoldSplash } from "../src/components/shell/splashHold.ts";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("shouldHoldSplash", () => {
  it("holds at 0ms even when ready and not booting", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 0,
        booting: false,
        ensuring: false,
        kind: "ready",
      }),
      true,
    );
  });

  it("holds while vault is booting after the floor", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 900,
        booting: true,
        ensuring: false,
        kind: "ready",
      }),
      true,
    );
  });

  it("holds while companion is ensuring", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 900,
        booting: false,
        ensuring: true,
        kind: null,
      }),
      true,
    );
  });

  it("releases when ready, not booting, and past the floor", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 800,
        booting: false,
        ensuring: false,
        kind: "ready",
      }),
      false,
    );
  });

  it("releases immediately on needs_install", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 0,
        booting: true,
        ensuring: false,
        kind: "needs_install",
      }),
      false,
    );
  });
});

describe("splash markup and gate", () => {
  it("puts LIFE QUEST in a #splash sibling of #root", () => {
    const html = read("index.html");
    assert.match(html, /id="splash"/);
    assert.match(html, /LIFE QUEST/);
    assert.match(html, /href="\.\/splash\.css"/);
    assert.match(read("public/theme-boot.js"), /__LQ_SPLASH_T0/);
    const splashIdx = html.indexOf('id="splash"');
    const rootIdx = html.indexOf('id="root"');
    assert.ok(splashIdx !== -1 && rootIdx !== -1 && splashIdx < rootIdx);
  });

  it("gates boot with SplashGate instead of Loading copy", () => {
    const app = read("src/App.tsx");
    assert.match(app, /SplashGate/);
    assert.equal(app.includes("Loading…"), false);
    const gate = read("src/components/shell/SplashGate.tsx");
    assert.match(gate, /shouldHoldSplash/);
    assert.match(gate, /splash--out/);
  });
});
