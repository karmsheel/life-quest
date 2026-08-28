import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("packaged renderer boot", () => {
  it("loads theme-boot with a relative path", () => {
    const html = fs.readFileSync(
      path.join(desktopRoot, "index.html"),
      "utf8",
    );
    assert.match(html, /src="\.\/theme-boot\.js"/);
    assert.equal(html.includes('src="/theme-boot.js"'), false);
  });
});

describe("app identity", () => {
  it("sets the Electron name to LifeQuest before whenReady", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "electron", "main.ts"),
      "utf8",
    );
    const nameIdx = src.indexOf('app.setName("LifeQuest")');
    const readyIdx = src.indexOf("app.whenReady");
    assert.notEqual(nameIdx, -1);
    assert.notEqual(readyIdx, -1);
    assert.ok(nameIdx < readyIdx);
  });
});
