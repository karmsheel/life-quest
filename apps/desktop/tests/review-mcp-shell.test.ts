import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ALL_TOOL_DEFS, REVIEW_TOOL_DEFS } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");

function readDesktop(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("review MCP tools wiring", () => {
  it("the pairing door registers the composed constant, which includes REVIEW_TOOL_DEFS", () => {
    const mcp = readDesktop("electron/pairing-door.ts");
    assert.match(mcp, /ALL_TOOL_DEFS/);
    for (const def of REVIEW_TOOL_DEFS) {
      assert.ok(
        ALL_TOOL_DEFS.some((t) => t.name === def.name),
        `${def.name} must be registered`,
      );
    }
  });

  it("map-tools dispatches REVIEW_TOOL_DEFS via executeReviewTool", () => {
    const mapTools = readDesktop("electron/map-tools.ts");
    assert.match(mapTools, /REVIEW_TOOL_DEFS/);
    assert.match(mapTools, /executeReviewTool/);
    for (const name of [
      "get_review",
      "list_reviews",
      "write_review",
      "mark_review_done",
      "unlock_review",
      "get_period_pack",
    ]) {
      assert.match(mapTools, new RegExp(name), `map-tools missing ${name}`);
    }
  });

  it("vault-core index exports REVIEW_TOOL_DEFS and executeReviewTool", () => {
    const index = readRepo("packages/vault-core/src/index.ts");
    assert.match(index, /REVIEW_TOOL_DEFS/);
    assert.match(index, /executeReviewTool/);
  });
});
