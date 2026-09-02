import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
// Node --experimental-strip-types cannot load .tsx; helper lives in .ts and is re-exported from Button.tsx.
import { buttonClassName } from "../src/components/ui/buttonClassName.ts";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("buttonClassName", () => {
  it("maps variants onto existing btn classes", () => {
    assert.equal(buttonClassName({}), "btn btn-secondary");
    assert.equal(buttonClassName({ variant: "outline" }), "btn btn-secondary");
    assert.equal(buttonClassName({ variant: "primary" }), "btn btn-primary");
    assert.equal(buttonClassName({ variant: "ghost" }), "btn btn-ghost");
    assert.equal(buttonClassName({ destructive: true }), "btn btn-danger");
    assert.equal(
      buttonClassName({ variant: "primary", destructive: true }),
      "btn btn-danger",
    );
    assert.equal(
      buttonClassName({ variant: "primary", className: "ml-auto" }),
      "btn btn-primary ml-auto",
    );
  });
});

describe("Button source", () => {
  it("renders Link when to is set and defaults type to button", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "src/components/ui/Button.tsx"),
      "utf8",
    );
    assert.match(src, /from ["']react-router-dom["']/);
    assert.match(src, /to\?:/);
    assert.match(src, /type = ["']button["']/);
    assert.equal(src.includes("@radix-ui"), false);
  });
});
