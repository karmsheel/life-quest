import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(desktopRoot, "..", "..");

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("electron-builder.yml", () => {
  it("locks the private Windows dir target", () => {
    const yml = read("electron-builder.yml");
    assert.match(yml, /^appId:\s*com\.lifequest\.desktop\s*$/m);
    assert.match(yml, /^productName:\s*LifeQuest\s*$/m);
    assert.match(yml, /^executableName:\s*LifeQuest\s*$/m);
    assert.match(yml, /^ {2}output:\s*release\s*$/m);
    assert.match(yml, /^asar:\s*true\s*$/m);
    assert.match(yml, /^npmRebuild:\s*false\s*$/m);
    assert.match(yml, /^forceCodeSigning:\s*false\s*$/m);
    assert.match(yml, /^publish:\s*null\s*$/m);
    assert.match(yml, /^ {2}main:\s*dist-electron\/main\.js\s*$/m);
    assert.match(yml, /- dist\/\*\*\/\*/);
    assert.match(yml, /- dist-electron\/\*\*\/\*/);
    assert.match(yml, /target:\s*dir/);
    assert.match(yml, /- x64/);
    assert.equal(yml.includes("nsis"), false);
    assert.equal(yml.includes("electron-updater"), false);
  });
});

describe("package scripts and deps", () => {
  it("packages from a wrapper that disables cert discovery", () => {
    const wrapper = read("scripts/package.mjs");
    assert.match(wrapper, /CSC_IDENTITY_AUTO_DISCOVERY/);
    assert.match(wrapper, /--win/);
    assert.match(wrapper, /--dir/);
    assert.match(wrapper, /--config\.electronVersion=/);
    assert.match(wrapper, /electron\/package\.json/);
  });

  it("keeps bundled libraries out of production dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(pkg.scripts.package, "npm run build && node ./scripts/package.mjs");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.dependencies?.react, undefined);
    assert.equal(pkg.dependencies?.["@lifequest/vault-core"], undefined);
    assert.ok(pkg.devDependencies.react);
    assert.ok(pkg.devDependencies["react-dom"]);
    assert.ok(pkg.devDependencies["react-router-dom"]);
    assert.ok(pkg.devDependencies["lucide-react"]);
    assert.ok(pkg.devDependencies["@lifequest/vault-core"]);
    assert.ok(pkg.devDependencies["electron-builder"]);
  });

  it("exposes package at the repo root", () => {
    const root = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(root.scripts.package, "npm run package -w @lifequest/desktop");
  });
});

describe("gitignore", () => {
  it("ignores electron-builder output", () => {
    const gi = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    assert.match(gi, /^release$/m);
  });
});
