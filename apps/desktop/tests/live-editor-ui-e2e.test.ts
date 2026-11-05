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
 * The artifact is `e2e/artifacts/live-editor.json` plus the four `.png`s the
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
  "live-editor-menu.png",
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
type MenuItem = {
  testid: string | null;
  role: string | null;
  text: string;
  label: string | null;
  checked: string | null;
  expanded: string | null;
  disabled: boolean;
};
type PageMenuInfo = {
  tag: string;
  classes: string;
  haspopup: string | null;
  expanded: string | null;
  label: string | null;
  svgCount: number;
};
type PopoverInfo = {
  role: string | null;
  label: string | null;
  classes: string;
  firstItemTestId: string | null;
};
type LockItem = {
  role: string | null;
  checked: string | null;
  label: string | null;
  caption: string;
  locked: string | null;
  hasTrack: boolean;
  hasThumb: boolean;
};
type DialogInfo = {
  role: string | null;
  heading: string | null;
  classes: string;
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
  headerRect: Rect | null;
  headingRect: Rect | null;
  lockBadge: string | null;
  lockBadgeRect: Rect | null;
  pageMenu: PageMenuInfo | null;
  pageMenuTriggerRect: Rect | null;
  pageMenuPopover: PopoverInfo | null;
  pageMenuPopoverRect: Rect | null;
  menuItems: MenuItem[] | null;
  lockSwitchRect: Rect | null;
  lockSwitch: LockItem | null;
  docActions: string[] | null;
  proposeDialog: DialogInfo | null;
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
    documentMenu: Box;
    documentLockCalls: string[];
    documentLocked: Box;
    documentUnlockCalls: string[];
    documentUnlocked: Box;
    documentAfterLockCycle: Box;
    documentRelockCalls: string[];
    documentMenuLocked: Box;
    proposeDialog: Box;
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

    // ── the doctrine page's actions are behind one three-dot menu ───────────
    // Closed on landing: the trigger is the whole surface, and a page's actions
    // are not furniture in the document.
    const initialMenu = doc.pageMenu;
    assert.ok(initialMenu, "the doctrine page drew no page menu trigger");
    for (const cls of ["btn", "btn-ghost", "page-menu__trigger", "page-corner__action"]) {
      assert.ok(
        initialMenu!.classes.split(/\s+/).includes(cls),
        `the page menu trigger is missing class ${cls}: ${initialMenu!.classes}`,
      );
    }
    assert.equal(initialMenu!.haspopup, "menu");
    assert.equal(initialMenu!.expanded, "false", "the page menu was expanded on landing");
    assert.equal(initialMenu!.label, "Document actions");
    assert.equal(initialMenu!.svgCount, 1, "the page menu trigger did not draw one icon");
    assert.equal(doc.pageMenuPopover, null, "the closed page menu put a popover in the document");
    assert.equal(doc.menuItems, null, "the closed page menu put items in the document");
    assert.equal(doc.lockSwitch, null, "the closed page menu put its lock item in the document");
    assert.equal(doc.lockBadge, "Unlocked");
    assert.deepEqual(
      doc.docActions,
      ["Save"],
      "the unlocked document's bottom row is not Save alone",
    );

    // Open: the popover is the menu, its FIRST item is the lock, and the lock is
    // a checkbox item whose track and thumb draw the state it announces.
    const menuOpen = report.checks.documentMenu;
    assert.equal(menuOpen.pageMenu?.expanded, "true");
    assert.equal(menuOpen.pageMenuPopover?.role, "menu");
    assert.equal(menuOpen.pageMenuPopover?.label, "Document actions");
    assert.ok(
      (menuOpen.pageMenuPopover?.classes ?? "").split(/\s+/).includes("page-menu__popover"),
      `the page menu popover is not .page-menu__popover: ${menuOpen.pageMenuPopover?.classes}`,
    );
    assert.equal(
      menuOpen.pageMenuPopover?.firstItemTestId,
      "document-lock-toggle",
      "the page menu's first item is not the lock",
    );
    assert.equal(menuOpen.lockSwitch?.role, "menuitemcheckbox");
    assert.equal(menuOpen.lockSwitch?.checked, "false");
    assert.equal(menuOpen.lockSwitch?.locked, "false");
    assert.equal(menuOpen.lockSwitch?.label, "Lock this document");
    assert.equal(menuOpen.lockSwitch?.caption, "Lock");
    assert.equal(menuOpen.lockSwitch?.hasTrack, true, "the document's lock item drew no track");
    assert.equal(menuOpen.lockSwitch?.hasThumb, true, "the document's lock item drew no thumb");
    assert.equal(menuOpen.menuItems?.length, 1, "the unlocked menu held more than the lock");
    assert.equal(menuOpen.lockBadge, "Unlocked");

    // Geometry, measured rather than assumed: the trigger is the header's
    // top-right control, the popover hangs under it right-aligned inside the page
    // column, and the badge is still on the document's name line, left of the
    // trigger.
    const headerBox = menuOpen.headerRect!;
    const headingBox = menuOpen.headingRect!;
    const badgeBox = menuOpen.lockBadgeRect!;
    const triggerBox = menuOpen.pageMenuTriggerRect!;
    const popoverBox = menuOpen.pageMenuPopoverRect!;
    assert.ok(
      headerBox && headingBox && badgeBox && triggerBox && popoverBox,
      "the page menu or the page's lock chrome recorded no box",
    );
    const headingMid = (headingBox.top + headingBox.bottom) / 2;
    const badgeMid = (badgeBox.top + badgeBox.bottom) / 2;
    assert.ok(
      Math.abs(headingMid - badgeMid) <= 6,
      `the document badge is not on the name's line: badge mid ${badgeMid}, heading mid ${headingMid}`,
    );
    assert.ok(badgeBox.left >= headingBox.left, "the document badge sits left of the name");
    assert.ok(
      badgeBox.right < triggerBox.left,
      "the document badge is not left of the page menu",
    );
    assert.ok(
      triggerBox.left >= headingBox.right,
      "the page menu is not in the page's right column",
    );
    assert.ok(
      Math.abs(headerBox.right - triggerBox.right) <= 2,
      `the page menu trigger (right ${triggerBox.right}) is not at the page's right edge (${headerBox.right})`,
    );
    assert.ok(
      Math.abs(triggerBox.top - headerBox.top) <= 4,
      `the page menu trigger (top ${triggerBox.top}) is not on the header's top row (${headerBox.top})`,
    );
    assert.ok(
      popoverBox.top >= triggerBox.bottom,
      `the page menu popover (top ${popoverBox.top}) is not under the trigger (bottom ${triggerBox.bottom})`,
    );
    assert.ok(
      popoverBox.top - triggerBox.bottom <= 14,
      `the page menu popover floats ${popoverBox.top - triggerBox.bottom}px below the trigger`,
    );
    assert.ok(
      Math.abs(popoverBox.right - triggerBox.right) <= 2,
      `the page menu popover (right ${popoverBox.right}) is not right-aligned to the trigger (right ${triggerBox.right})`,
    );
    assert.ok(
      popoverBox.right <= headerBox.right + 2 && popoverBox.left >= headerBox.left,
      `the page menu popover [${popoverBox.left}, ${popoverBox.right}] leaves the page column [${headerBox.left}, ${headerBox.right}]`,
    );

    // One click on the lock: exactly one write, the menu stays open, the page
    // behind it turns read-only, the bottom row disappears, and Propose change
    // becomes the menu's second item.
    assert.deepEqual(report.checks.documentLockCalls, ["documentSetLocked:health:what:true"]);
    const lockedDoc = report.checks.documentLocked;
    assert.equal(lockedDoc.lockBadge, "Locked");
    assert.equal(lockedDoc.lockSwitch?.checked, "true");
    assert.equal(lockedDoc.lockSwitch?.locked, "true");
    assert.equal(lockedDoc.lockSwitch?.label, "Unlock this document");
    assert.equal(
      lockedDoc.readOnly,
      true,
      "locking the document from the menu left the box editable",
    );
    assert.equal(
      lockedDoc.docActions,
      null,
      "the locked document still drew a bottom actions row",
    );
    assert.equal(
      lockedDoc.pageMenu?.expanded,
      "true",
      "the page menu closed when its lock item was chosen",
    );
    assert.ok(
      lockedDoc.pageMenuPopover,
      "the page menu closed when its lock item was chosen",
    );
    assert.equal(lockedDoc.menuItems?.length, 2);
    assert.equal(lockedDoc.menuItems?.[1]?.testid, "document-propose");
    assert.equal(lockedDoc.menuItems?.[1]?.role, "menuitem");
    assert.equal(lockedDoc.menuItems?.[1]?.text, "Propose change");

    // Choosing the lock again unlocks in place: one write the other way, the
    // bottom Save row back, and the locked-only action gone from the menu.
    assert.deepEqual(report.checks.documentUnlockCalls, [
      "documentSetLocked:health:what:true",
      "documentSetLocked:health:what:false",
    ]);
    const unlockedDoc = report.checks.documentUnlocked;
    assert.equal(unlockedDoc.lockBadge, "Unlocked");
    assert.equal(
      unlockedDoc.readOnly,
      false,
      "unlocking the document from the menu left the box read-only",
    );
    assert.equal(unlockedDoc.lockSwitch?.checked, "false");
    assert.equal(unlockedDoc.menuItems?.length, 1, "the unlocked menu kept the propose item");
    assert.deepEqual(
      unlockedDoc.docActions,
      ["Save"],
      "the unlocked document's bottom row is not Save alone",
    );
    assert.ok(
      unlockedDoc.pageMenuPopover,
      "the page menu closed when its lock item was chosen",
    );
    assert.equal(
      report.checks.documentAfterLockCycle.blockCount,
      2,
      "the document did not come back whole after the lock round-trip",
    );

    // Locked once more for the claim below, and its open menu is the artifact
    // picture: the lock first, Propose change second.
    assert.deepEqual(report.checks.documentRelockCalls, [
      "documentSetLocked:health:what:true",
      "documentSetLocked:health:what:false",
      "documentSetLocked:health:what:true",
    ]);
    const menuLocked = report.checks.documentMenuLocked;
    assert.equal(menuLocked.lockBadge, "Locked");
    assert.equal(menuLocked.readOnly, true);
    assert.equal(menuLocked.pageMenu?.expanded, "true");
    assert.equal(menuLocked.menuItems?.[1]?.testid, "document-propose");

    // Propose change closes the menu before opening the dialog.
    const proposed = report.checks.proposeDialog;
    assert.equal(proposed.proposeDialog?.role, "dialog");
    assert.equal(proposed.proposeDialog?.heading, "Propose change");
    assert.equal(
      proposed.pageMenuPopover,
      null,
      "the page menu stayed open behind the propose change dialog",
    );
    assert.equal(
      proposed.menuItems,
      null,
      "the page menu stayed open behind the propose change dialog",
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
    // The lock came from the menu above, and a fresh visit arrives with the menu
    // closed: the menu's items are not furniture in the page.
    assert.equal(
      report.checks.locked.pageMenu?.expanded,
      "false",
      "the locked document arrived with its page menu open",
    );
    assert.equal(
      report.checks.locked.lockSwitch,
      null,
      "the locked document put its page menu items in the page before it was opened",
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
