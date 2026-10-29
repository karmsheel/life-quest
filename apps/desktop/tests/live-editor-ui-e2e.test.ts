import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The shared note box on the two surfaces that are not the Daily Note: the
 * doctrine document editor and the Review page's editor. The claims themselves
 * live in `e2e/live-editor.electron.mjs`, which drives the harness; this file
 * runs that driver and refuses a report that does not hold.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up.
 *
 * The artifact is `e2e/artifacts/live-editor.json` plus the three `.png`s the
 * driver captures: same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/live-editor.json");
const SHOTS = [
  "live-editor-document.png",
  "live-editor-locked.png",
  "live-editor-review.png",
].map((name) => path.join(desktopRoot, "e2e/artifacts", name));

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/live-editor.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
type Box = {
  heading: string | null;
  body: string | null;
  blockCount: number;
  rendering: number;
  writingLines: number;
  editing: boolean;
  inputValue: string | null;
  readOnly: boolean | null;
  boxes: number;
  splits: number;
  previews: number;
  showsMarkers: boolean | null;
  images: number;
  imageSrc: string | null;
  inputRect: Rect | null;
  renderedRect: Rect | null;
  headingRect: Rect | null;
  lockBadge: string | null;
  lockBadgeRect: Rect | null;
  lockSwitchRect: Rect | null;
  lockSwitch: {
    role: string | null;
    checked: string | null;
    caption: string;
    locked: string | null;
    hasTrack: boolean;
  } | null;
};
type SaveCall = { slug: string; kind: string; body: string; title?: string };
type MediaCall = { slug: string; mime: string; bytes: number };
type ReviewWrite = { cadence: string; period: string; body: string };

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    skin: { name: string | null; applied: string | null };
    document: Box;
    openedParagraph: Box;
    saved: Box;
    documentLockCalls: string[];
    documentLocked: Box;
    documentUnlockCalls: string[];
    documentAfterLockCycle: Box;
    saves: SaveCall[];
    media: MediaCall[];
    pasted: Box;
    withImage: Box;
    mediaReads: string[];
    locked: Box;
    lockedAfterClick: Box;
    review: Box;
    reviewOpened: Box;
    reviewActions: string[];
    reviewWrites: ReviewWrite[];
    reviewWritesSettled: number;
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  };
};

describe("live editor ui e2e", () => {
  it("edits the doctrine document and the review in one box, and never a locked one", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) fs.rmSync(shot, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // ── the document editor is one box, reading as prose ────────────────────
    const doc = report.checks.document;
    assert.equal(doc.heading, "Vision & Desire · Health");
    assert.equal(doc.boxes, 1, "the page does not draw exactly one editor box");
    assert.equal(doc.splits, 0, "the split editor grid is still on the page");
    assert.equal(doc.previews, 0, "a preview pane is still on the page");
    assert.equal(doc.editing, false, "the document opened its writing line before it was clicked");
    assert.equal(doc.readOnly, false, "an unlocked document came up read-only");
    assert.equal(doc.blockCount, 2, "the document did not render its two paragraphs");
    assert.equal(doc.showsMarkers, false, "raw markdown is painted in the box");
    assert.match(String(doc.body), /Three sessions a week, no exceptions\./);

    // The doctrine page's lock: the badge is back beside the document's name,
    // and the switch sits in the page's top-right column.
    assert.equal(doc.lockBadge, "Unlocked");
    assert.equal(doc.lockSwitch?.role, "switch");
    assert.equal(doc.lockSwitch?.checked, "false");
    assert.equal(doc.lockSwitch?.caption, "Lock");
    assert.equal(doc.lockSwitch?.hasTrack, true, "the document's switch drew no track");
    assert.ok(doc.headingRect, "the document's name recorded no box");
    assert.ok(doc.lockBadgeRect, "the document's badge recorded no box");
    assert.ok(doc.lockSwitchRect, "the document's switch recorded no box");
    const headingMid = (doc.headingRect.top + doc.headingRect.bottom) / 2;
    const badgeMid = (doc.lockBadgeRect.top + doc.lockBadgeRect.bottom) / 2;
    assert.ok(
      Math.abs(headingMid - badgeMid) <= 6,
      `the document badge is not on the name's line: badge mid ${badgeMid}, heading mid ${headingMid}`,
    );
    assert.ok(
      doc.lockBadgeRect.right < doc.lockSwitchRect.left,
      "the document badge is not left of the switch",
    );
    assert.ok(
      doc.lockSwitchRect.left >= doc.headingRect.right,
      "the document switch is not in the page's right column",
    );
    assert.deepEqual(report.checks.documentLockCalls, ["documentSetLocked:health:what:true"]);
    assert.equal(report.checks.documentLocked.lockBadge, "Locked");
    assert.equal(report.checks.documentLocked.lockSwitch?.checked, "true");
    assert.equal(
      report.checks.documentLocked.readOnly,
      true,
      "locking the document from the header switch left the box editable",
    );
    assert.equal(
      report.checks.documentUnlockCalls.at(-1),
      "documentSetLocked:health:what:false",
      "unlocking the document did not write the unlock",
    );
    assert.equal(
      report.checks.documentAfterLockCycle.blockCount,
      2,
      "the document did not come back whole after the lock round-trip",
    );

    // Opening one paragraph shows that paragraph's markdown, in the column the
    // prose held, and leaves the paragraph above it rendered.
    const opened = report.checks.openedParagraph;
    assert.equal(opened.inputValue, "**Three sessions** a week, no exceptions.");
    assert.equal(opened.writingLines, 1, "more than one writing line opened");
    assert.equal(opened.rendering, 1, "opening one paragraph did not leave the other rendered");
    assert.match(String(opened.body), /A calm, strong body at 60\./);
    assert.equal(
      opened.inputRect?.left,
      opened.renderedRect?.left,
      "the writing line opened in a column of its own beside the prose",
    );

    // Save carries the note the box holds, blank line and markdown included.
    assert.equal(report.checks.saves.length, 1, "the save was not a single write");
    assert.equal(report.checks.saves[0]!.kind, "what");
    assert.equal(
      report.checks.saves[0]!.body.trimEnd(),
      "A calm, strong body at 60.\n\nWalking daily, and **three sessions** a week.",
      "the file did not get the note the box held",
    );
    assert.match(String(report.checks.saved.body), /Walking daily, and three sessions a week\./);

    // ── a pasted image is saved once and lands in the note ──────────────────
    assert.equal(report.checks.media.length, 1, "the paste did not save exactly one file");
    assert.equal(report.checks.media[0]!.mime, "image/png");
    assert.equal(report.checks.media[0]!.bytes, 4, "the saved bytes are not the dropped file's");
    assert.match(
      String(report.checks.pasted.inputValue),
      /!\[\]\(media\/rig-shot\.png\)/,
      "the pasted image's markdown never reached the note",
    );
    assert.equal(report.checks.withImage.images, 1, "the box did not render the image it was given");
    assert.ok(
      report.checks.mediaReads.some((call) => call.endsWith("media/rig-shot.png")),
      `the box did not resolve the image by its own path: ${JSON.stringify(report.checks.mediaReads)}`,
    );

    // ── a locked document offers no writing surface at all ──────────────────
    assert.equal(report.checks.locked.readOnly, true, "the locked document was not read-only");
    assert.equal(report.checks.locked.editing, false, "a locked document opened a writing line");
    assert.equal(report.checks.locked.lockBadge, "Locked");
    assert.equal(
      report.checks.locked.lockSwitch?.checked,
      "true",
      "the locked document's switch is off",
    );
    assert.equal(
      report.checks.lockedAfterClick.writingLines,
      0,
      "a click on a locked document opened a writing line",
    );

    // ── the review editor is the same box ──────────────────────────────────
    const review = report.checks.review;
    assert.equal(review.boxes, 1, "the review page does not draw exactly one editor box");
    assert.equal(review.splits, 0, "the review page still draws the split editor");
    assert.equal(review.previews, 0, "the review page still draws a preview pane");
    assert.equal(review.blockCount, 3, "the review did not render its own file");
    assert.equal(review.showsMarkers, false, "raw markdown is painted in the review box");
    assert.match(String(review.body), /Two walks, and one late night\./);
    // The review document is the page: no Edit/Save pair gates it any more, and
    // these two names appearing again would mean the document went back behind a
    // mode the operator has to enter.
    assert.equal(
      report.checks.reviewActions.includes("Edit"),
      false,
      "the review page offers an Edit control again",
    );
    assert.equal(
      report.checks.reviewActions.includes("Save"),
      false,
      "the review page offers a Save control again",
    );
    assert.equal(
      report.checks.reviewOpened.inputValue,
      "Two walks, and **one** late night.",
      "the opened review paragraph is not its own markdown",
    );
    assert.equal(report.checks.reviewOpened.rendering, 2, "opening one paragraph rendered others");
    assert.equal(report.checks.reviewWrites.length, 1, "the review save was not a single write");
    assert.equal(
      report.checks.reviewWrites[0]!.body.trimEnd(),
      "# Week of 12 Oct 2026\n\n## Health\n\nTwo walks, and three late nights.",
      "the review file did not get the note the box held",
    );
    assert.equal(
      report.checks.reviewWritesSettled,
      1,
      "the review page kept writing a review it had already written",
    );

    // Nothing reached the bridge that this rig does not model, and the pages
    // logged nothing while the notes were being written.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(shot), true, `driver captured no screenshot ${shot}`);
    }
  });
});
