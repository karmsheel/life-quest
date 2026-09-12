import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

describe("library lock UI", () => {
  it("DocumentsPage can lock, unlock, and propose", () => {
    const src = read("src/pages/DocumentsPage.tsx");
    assert.match(src, /librarySetLocked/);
    assert.match(src, /Propose change/);
    assert.match(src, /type: "library"/);
  });
});

describe("Decisions inbox", () => {
  it("drops forged copy and shows who proposed", () => {
    const src = read("src/components/decisions/DecisionsInbox.tsx");
    assert.equal(/forged/i.test(src), false);
    assert.match(src, /No pending proposals/);
    assert.match(src, /actorDisplayName|You/);
    assert.match(src, /recordVisibleMulti/);
    assert.match(src, /domainSlugs/);
  });
});

describe("Life log actor", () => {
  it("renders who on document and decision events", () => {
    const src = read("src/components/log/LifeLogFeed.tsx");
    assert.match(src, /actorDisplayName/);
  });
});

describe("Home and Act lock copy", () => {
  it("Home and Act say locked not forged", () => {
    const home = read("src/pages/HomePage.tsx");
    assert.match(home, /locked/);
    assert.equal(/forged/i.test(home), false);
    const act = read("src/pages/ActPage.tsx");
    assert.match(act, /not locked/);
    assert.equal(/forged/i.test(act), false);
  });
});
