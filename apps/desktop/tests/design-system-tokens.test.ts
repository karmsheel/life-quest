import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { auditDesignSystem } from "../scripts/design-system-tokens.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("design-system-tokens", () => {
  it("reports no findings on the current tree", () => {
    const findings = auditDesignSystem(desktopRoot);
    assert.deepEqual(findings, []);
  });
});
