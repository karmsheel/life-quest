import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { shouldHoldSplash } from "../src/components/shell/splashHold.ts";
import { lastVaultToReopen } from "../src/state/lastVault.ts";

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
        elapsedMs: 2000,
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
        elapsedMs: 2000,
        booting: false,
        ensuring: true,
        kind: null,
      }),
      true,
    );
  });

  it("holds at 800ms when ready so the floor can reach 1500ms", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 800,
        booting: false,
        ensuring: false,
        kind: "ready",
      }),
      true,
    );
  });

  it("releases when ready, not booting, and past the floor", () => {
    assert.equal(
      shouldHoldSplash({
        elapsedMs: 1500,
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

describe("lastVaultToReopen", () => {
  it("returns the most recent path when no vault is open", () => {
    assert.equal(
      lastVaultToReopen(null, [
        { path: "C:\\vaults\\life" },
        { path: "C:\\vaults\\old" },
      ]),
      "C:\\vaults\\life",
    );
  });

  it("returns null when a vault is already open or recents are empty", () => {
    assert.equal(lastVaultToReopen({ root: "x" }, [{ path: "C:\\vaults\\life" }]), null);
    assert.equal(lastVaultToReopen(null, []), null);
    assert.equal(lastVaultToReopen(null, [{ path: "  " }]), null);
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

  it("reopens the most recent vault during boot", () => {
    const src = read("src/state/VaultProvider.tsx");
    assert.match(src, /lastVaultToReopen/);
    assert.match(src, /vaultOpen\(reopen\)/);
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
