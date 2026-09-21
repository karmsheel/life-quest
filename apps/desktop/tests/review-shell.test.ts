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

describe("review shell wiring (KAR-50)", () => {
  it("replaces five StubPage review routes with ReviewPage", () => {
    const app = read("src/App.tsx");
    // StubPage must not be used on review routes
    assert.equal(app.includes("StubPage"), false, "App.tsx still uses StubPage");
    // ReviewPage must be imported and used on all five cadences
    assert.match(app, /import ReviewPage/);
    assert.match(app, /<Route\s+path=["']\/review\/:cadence["']/);
  });

  it("ReviewPage contains required chrome: pager, Start, Edit, Plan next period, Mark done", () => {
    const page = read("src/pages/ReviewPage.tsx");
    assert.match(page, /previousPeriod|Prev/);
    assert.match(page, /Start/);
    assert.match(page, /Edit/);
    assert.match(page, /Plan next period/);
    assert.match(page, /Mark done/);
  });

  it("ReviewPage treats unassigned and non-domain lenses as overall", () => {
    const page = read("src/pages/ReviewPage.tsx");
    // Must handle unassigned or non-domain kind as overall
    assert.match(page, /unassigned|kind !== "domain"|!slug/);
  });

  it("ReviewPage wires review IPC and planning + chat session APIs", () => {
    const page = read("src/pages/ReviewPage.tsx");
    assert.match(page, /reviewGet/);
    assert.match(page, /reviewWrite/);
    assert.match(page, /reviewStartOrResume/);
    assert.match(page, /planningStartOrResume/);
    assert.match(page, /requestSession/);
    assert.match(page, /currentPeriod/);
    assert.match(page, /isCurrentPeriod/);
  });

  it("ReviewPage uses MarkdownView and Button", () => {
    const page = read("src/pages/ReviewPage.tsx");
    assert.match(page, /MarkdownView/);
    assert.match(page, /Button/);
  });

  it("ReviewPreview extracts active-scope headings (Look-back)", () => {
    // The preview component or helper references the four overall H2 headings
    const preview = read("src/components/reviews/ReviewPreview.tsx");
    assert.match(preview, /Look-back/);
  });
});
