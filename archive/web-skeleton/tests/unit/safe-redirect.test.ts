import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeInternalPath } from "../../lib/safe-redirect.ts";

describe("safeInternalPath", () => {
  it("accepts internal app paths", () => {
    assert.equal(safeInternalPath("/home"), "/home");
    assert.equal(safeInternalPath("/dream"), "/dream");
    assert.equal(safeInternalPath("/domains"), "/domains");
    assert.equal(safeInternalPath("/settings?tab=hermes"), "/settings?tab=hermes");
  });

  it("rejects open redirects and protocol-relative URLs", () => {
    assert.equal(safeInternalPath("//evil.com"), "/home");
    assert.equal(safeInternalPath("https://evil.com"), "/home");
    assert.equal(safeInternalPath("http://evil.com/phish"), "/home");
    assert.equal(safeInternalPath("evil.com"), "/home");
  });

  it("rejects auth pages and empty/null values", () => {
    assert.equal(safeInternalPath("/sign-in"), "/home");
    assert.equal(safeInternalPath("/sign-up"), "/home");
    assert.equal(safeInternalPath("/sign-in?from=/home"), "/home");
    assert.equal(safeInternalPath(null), "/home");
    assert.equal(safeInternalPath(undefined), "/home");
    assert.equal(safeInternalPath(""), "/home");
  });

  it("uses custom fallback when provided", () => {
    assert.equal(safeInternalPath("//evil.com", "/dream"), "/dream");
    assert.equal(safeInternalPath(null, "/domains"), "/domains");
  });
});
