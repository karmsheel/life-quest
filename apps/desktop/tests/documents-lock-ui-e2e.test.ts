import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(
  desktopRoot,
  "e2e/artifacts/documents-lock-ui.json",
);

/**
 * The rig renders the real Documents page in a real layout engine, so it needs
 * the Vite dev server. With the server down the test skips; `npm run dev` in
 * another terminal brings it up.
 */
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
      [path.join(desktopRoot, "e2e/documents-lock-ui.electron.mjs")],
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

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type Paint = {
  color: string;
  background: string;
  position: string;
  zIndex: string;
};

type Item = {
  testId: string | null;
  role: string | null;
  ariaChecked: string | null;
  ariaLabel: string | null;
  ariaExpanded: string | null;
  dataLocked: string | null;
  className: string;
  caption: string | null;
  hasTrack: boolean;
  hasThumb: boolean;
  disabled: boolean;
  paint: Paint;
  box: Box;
};

type Trigger = {
  testId: string | null;
  box: Box;
  className: string;
  haspopup: string | null;
  expanded: string | null;
  label: string | null;
  insideHeader: boolean | null;
  insideCorner: boolean | null;
};

type Popover = {
  box: Box;
  role: string | null;
  label: string | null;
  className: string;
  paint: Paint;
  itemOrder: (string | null)[];
  itemCount: number;
};

type Badge = {
  box: Box;
  text: string | null;
  locked: string | null;
  className: string;
  insideHeader: boolean | null;
  insideCorner: boolean | null;
};

type ActiveElement = {
  testId: string | null;
  tag: string;
  insidePopover: boolean;
  insideTrigger: boolean;
};

type PageSample = {
  skin: string | null;
  viewport: { width: number; height: number };
  header: Box | null;
  corner: Box | null;
  trigger: Trigger | null;
  popover: Popover | null;
  items: {
    lock: Item | null;
    propose: Item | null;
    delete: Item | null;
  };
  badge: Badge | null;
  composer: {
    titleValue: string | null;
    titleReadOnly: boolean | null;
    bodyValue: string | null;
    bodyReadOnly: boolean | null;
    domainDisabled: boolean | null;
    domainChecked: boolean | null;
    saveDisabled: boolean | null;
    actionLabels: string[];
    dangerButtons: number | null;
    proposeButtons: number;
    lockHint: string | null;
  };
  cards: number;
  selectedCards: number;
  emptyMessage: string | null;
  proposeDialog: {
    role: string | null;
    modal: string | null;
    heading: string | null;
    hint: string | null;
    textareas: number;
    buttons: string[];
  } | null;
  confirmDialog: {
    role: string | null;
    modal: string | null;
    title: string | null;
    message: string | null;
    confirmLabel: string | null;
    confirmText: string | null;
    cancelLabel: string | null;
    buttons: string[];
  } | null;
  activeElement: ActiveElement | null;
};

type LockCall = { id: string; locked: boolean };

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    skin: { name: string | null; applied: string | null };
    landing: PageSample;
    opened: PageSample;
    openedNoteGetCalls: string[];
    menuUnlocked: PageSample;
    lockedMenuOpen: PageSample;
    lockCalls: LockCall[];
    lockedItemOrder: string[];
    unlockCalls: LockCall[];
    unlockedAgain: PageSample;
    unlockedAgainItemOrder: string[];
    focusInMenu: ActiveElement;
    escapeClosed: PageSample;
    outsideClosed: PageSample;
    proposeOpen: PageSample;
    confirmOpen: PageSample;
    afterDelete: PageSample;
    deleteCalls: string[];
    unexpectedBridgeCalls: string[];
    noteWrites: { updates: unknown[]; creates: unknown[] };
    bridgeCalls: {
      libraryList: number;
      libraryGet: string[];
      librarySetLocked: LockCall[];
      libraryDelete: string[];
      decisionCreate: unknown[];
    };
    consoleErrors: string[];
    artifacts: {
      json: string;
      landing: string;
      openMenu: string;
      lockedMenu: string;
    };
  };
  samples: Record<string, PageSample>;
};

/**
 * The Documents/notes page menu, as the operator sees it: a three-dot trigger in
 * the page's corner that only exists while a note is open, a lock as its first
 * item, "Propose change" behind it while the note is locked, and "Delete note"
 * (danger, last) always. Choosing the lock writes once and leaves the menu open;
 * the action items close it and act on the open note.
 */
describe("documents lock ui e2e", () => {
  it("moves the note's lock, propose and delete into the corner page menu", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // The harness painted in the app's own skin, not the base tokens.
    assert.ok(report.checks.skin.name, "the harness named no skin");
    assert.equal(report.checks.skin.applied, report.checks.skin.name);

    // ── Landing: one note in the library, no note open ───────────────────────
    // The corner (badge + menu) exists only while a note is open; an empty
    // composer has nothing to lock, propose on, or delete.
    const landing = report.checks.landing;
    assert.equal(landing.cards, 1, "the library did not list the seeded note");
    assert.equal(landing.selectedCards, 0, "the library landed with a note open");
    assert.equal(landing.trigger, null, "an empty composer drew a note menu");
    assert.equal(landing.badge, null, "an empty composer drew a state badge");
    assert.equal(landing.popover, null, "an empty composer drew an open menu");
    assert.equal(landing.corner, null, "an empty composer drew a page corner");
    assert.equal(landing.composer.titleValue, "", "the composer landed with a title");

    // ── Opening the note: the corner appears, menu closed, actions target it ─
    const opened = report.checks.opened;
    assert.deepEqual(
      report.checks.openedNoteGetCalls,
      ["note-harness-1"],
      "opening the note did not ask the library for exactly the seeded note",
    );
    assert.ok(opened.trigger, "opening the note drew no page menu trigger");
    const trigger = opened.trigger!;
    assert.equal(trigger.haspopup, "menu");
    assert.equal(trigger.expanded, "false", "the menu was open as soon as the note opened");
    assert.equal(trigger.label, "Note actions");
    assert.equal(
      trigger.className,
      "btn btn-ghost page-menu__trigger page-corner__action",
      "the trigger does not wear the page-menu classes",
    );
    assert.equal(trigger.insideHeader, true, "the trigger left the page header");
    assert.equal(trigger.insideCorner, true, "the trigger left the page corner");
    const header = opened.header;
    assert.ok(header, "the page recorded no header box");
    assert.ok(
      trigger.box.top - header!.top <= 32,
      `the trigger is not on the header's first line: trigger top ${trigger.box.top}, header top ${header!.top}`,
    );
    assert.ok(
      trigger.box.right >= header!.right - 8,
      `the trigger is not at the header's right edge: trigger right ${trigger.box.right}, header right ${header!.right}`,
    );

    assert.ok(opened.badge, "opening the note drew no state badge");
    const badge = opened.badge!;
    assert.equal(badge.text, "Unlocked");
    assert.equal(badge.locked, "false");
    assert.equal(badge.insideHeader, true, "the badge left the page header");
    assert.equal(badge.insideCorner, true, "the badge left the page corner");
    assert.ok(
      badge.box.right <= trigger.box.left + 2,
      `the badge is not to the left of the menu: badge right ${badge.box.right}, menu left ${trigger.box.left}`,
    );
    const badgeMid = (badge.box.top + badge.box.bottom) / 2;
    const triggerMid = (trigger.box.top + trigger.box.bottom) / 2;
    assert.ok(
      Math.abs(badgeMid - triggerMid) <= 8,
      `the badge is not on the menu's line: badge mid ${badgeMid}, menu mid ${triggerMid}`,
    );
    assert.ok(
      badge.box.left >= header!.left + header!.width / 2,
      `the badge is not on the page's right half: badge left ${badge.box.left}`,
    );
    assert.equal(opened.popover, null);
    assert.equal(opened.composer.titleReadOnly, false);
    assert.equal(opened.composer.bodyReadOnly, false);
    assert.equal(opened.composer.domainDisabled, false);
    assert.equal(opened.composer.domainChecked, true, "the seeded note's domain is not checked");
    // The bottom row keeps Save/Cancel and nothing else: Delete and Propose
    // live in the menu now.
    assert.equal(opened.composer.dangerButtons, 0, "the bottom row still offers Delete");
    assert.equal(opened.composer.proposeButtons, 0, "the bottom row still offers Propose");
    assert.ok(opened.composer.actionLabels.includes("Save"));
    assert.ok(opened.composer.actionLabels.includes("Cancel"));

    // ── The open menu: lock first, Delete last, anchored under the trigger ──
    const menuUnlocked = report.checks.menuUnlocked;
    const popover = menuUnlocked.popover;
    assert.ok(popover, "opening the trigger drew no popover");
    assert.equal(popover!.role, "menu");
    assert.equal(popover!.label, "Note actions");
    assert.ok(
      popover!.className.split(/\s+/).includes("page-menu__popover"),
      `the popover's class list is ${JSON.stringify(popover!.className)}`,
    );
    assert.equal(popover!.paint.position, "absolute", "the popover does not float over the page");
    assert.equal(menuUnlocked.trigger!.expanded, "true");
    assert.ok(
      popover!.box.top >= menuUnlocked.trigger!.box.bottom + 3,
      "the popover is not anchored under the trigger",
    );
    assert.ok(
      Math.abs(popover!.box.right - menuUnlocked.trigger!.box.right) <= 2,
      "the popover is not right-aligned to the trigger",
    );
    assert.equal(popover!.itemOrder[0], "note-lock-toggle", "the lock is not the menu's first item");
    const lockUnlocked = menuUnlocked.items.lock;
    assert.ok(lockUnlocked, "the open menu drew no lock item");
    assert.equal(lockUnlocked!.role, "menuitemcheckbox");
    assert.equal(lockUnlocked!.ariaChecked, "false");
    assert.equal(lockUnlocked!.dataLocked, "false");
    assert.equal(lockUnlocked!.ariaLabel, "Lock this note");
    assert.equal(lockUnlocked!.caption, "Lock");
    assert.equal(lockUnlocked!.hasTrack, true, "the lock item drew no track");
    assert.equal(lockUnlocked!.hasThumb, true, "the lock item drew no thumb");
    assert.equal(menuUnlocked.items.propose, null, "an unlocked note offered Propose change");
    assert.equal(
      popover!.itemOrder.at(-1),
      "note-delete",
      `Delete is not the menu's last item: ${JSON.stringify(popover!.itemOrder)}`,
    );
    const deleteUnlocked = menuUnlocked.items.delete;
    assert.ok(deleteUnlocked, "the open menu offered no Delete item");
    assert.equal(deleteUnlocked!.role, "menuitem");
    assert.equal(deleteUnlocked!.caption, "Delete note");
    assert.ok(
      deleteUnlocked!.className.split(/\s+/).includes("page-menu__item--danger"),
      `the Delete item's class list is ${JSON.stringify(deleteUnlocked!.className)}`,
    );
    assert.notEqual(
      deleteUnlocked!.paint.color,
      lockUnlocked!.paint.color,
      "the Delete item is not drawn in the destructive ink",
    );

    // ── Choosing the lock writes once and leaves the menu open ──────────────
    assert.deepEqual(
      report.checks.lockCalls,
      [{ id: "note-harness-1", locked: true }],
      "locking did not write the library exactly once with the open note",
    );
    const lockedMenu = report.checks.lockedMenuOpen;
    assert.ok(lockedMenu.popover, "choosing the lock closed the menu");
    assert.equal(lockedMenu.badge?.text, "Locked");
    assert.equal(lockedMenu.badge?.locked, "true");
    const lockLocked = lockedMenu.items.lock;
    assert.ok(lockLocked, "the locked menu lost its lock item");
    assert.equal(lockLocked!.ariaChecked, "true");
    assert.equal(lockLocked!.dataLocked, "true");
    assert.equal(lockLocked!.ariaLabel, "Unlock this note");
    assert.equal(lockLocked!.caption, "Lock");
    assert.equal(lockLocked!.hasTrack, true);
    assert.equal(lockLocked!.hasThumb, true);
    assert.equal(lockedMenu.composer.titleReadOnly, true, "a locked note's title is editable");
    assert.equal(lockedMenu.composer.bodyReadOnly, true, "a locked note's body is editable");
    assert.equal(lockedMenu.composer.domainDisabled, true, "a locked note's domain picker is enabled");
    assert.equal(lockedMenu.composer.saveDisabled, true, "a locked note's Save is enabled");
    assert.match(lockedMenu.composer.lockHint ?? "", /Unlock to edit/);
    assert.equal(lockedMenu.composer.dangerButtons, 0, "the locked bottom row grew a Delete button");
    assert.equal(lockedMenu.composer.proposeButtons, 0, "the locked bottom row grew a Propose button");
    assert.deepEqual(
      report.checks.lockedItemOrder,
      ["note-lock-toggle", "note-propose", "note-delete"],
      "the locked menu's item order is wrong",
    );
    assert.equal(lockedMenu.items.propose?.role, "menuitem");
    assert.equal(lockedMenu.items.propose?.caption, "Propose change");
    assert.ok(
      lockedMenu.items.delete?.className.split(/\s+/).includes("page-menu__item--danger"),
    );

    // ── It toggles back ─────────────────────────────────────────────────────
    assert.deepEqual(
      report.checks.unlockCalls,
      [
        { id: "note-harness-1", locked: true },
        { id: "note-harness-1", locked: false },
      ],
      "the lock did not write both directions with the open note",
    );
    const unlockedAgain = report.checks.unlockedAgain;
    assert.ok(unlockedAgain.popover, "unlocking closed the menu");
    assert.deepEqual(
      report.checks.unlockedAgainItemOrder,
      ["note-lock-toggle", "note-delete"],
      "the unlocked menu's item order is wrong",
    );
    assert.equal(unlockedAgain.badge?.text, "Unlocked");
    assert.equal(unlockedAgain.items.propose, null, "Propose change stayed after unlocking");
    assert.equal(unlockedAgain.composer.titleReadOnly, false);
    assert.equal(unlockedAgain.composer.bodyReadOnly, false);
    assert.equal(unlockedAgain.composer.domainDisabled, false);
    assert.equal(unlockedAgain.composer.dangerButtons, 0);
    assert.equal(unlockedAgain.composer.proposeButtons, 0);

    // ── Escape dismisses the menu and hands the keyboard back ───────────────
    assert.equal(
      report.checks.focusInMenu.insidePopover,
      true,
      "opening the menu left focus outside it",
    );
    const escaped = report.checks.escapeClosed;
    assert.equal(escaped.popover, null, "Escape did not close the menu");
    assert.equal(escaped.trigger?.expanded, "false");
    assert.equal(
      escaped.activeElement?.testId,
      "note-page-menu",
      `Escape left focus on ${JSON.stringify(escaped.activeElement)}`,
    );
    // A press outside dismisses it too, and neither dismissal writes anything.
    const outside = report.checks.outsideClosed;
    assert.equal(outside.popover, null, "an outside press did not close the menu");
    assert.equal(outside.trigger?.expanded, "false");
    assert.equal(outside.proposeDialog, null, "an outside press opened a dialog");

    // ── Propose change: closes the menu, opens the dialog, files nothing ────
    const proposeOpen = report.checks.proposeOpen;
    assert.ok(proposeOpen.proposeDialog, "choosing Propose change opened no dialog");
    assert.equal(proposeOpen.proposeDialog!.role, "dialog");
    assert.equal(proposeOpen.proposeDialog!.modal, "true");
    assert.equal(proposeOpen.proposeDialog!.heading, "Propose change");
    assert.match(proposeOpen.proposeDialog!.hint ?? "", /Decisions/);
    assert.ok(proposeOpen.proposeDialog!.textareas >= 2);
    assert.ok(proposeOpen.proposeDialog!.buttons.includes("Submit proposal"));
    assert.equal(proposeOpen.trigger?.expanded, "false", "the menu stayed over the dialog");
    assert.deepEqual(
      report.checks.bridgeCalls.decisionCreate,
      [],
      "opening Propose change filed a Decision without submitting it",
    );

    // ── Delete note: asks first, then deletes once and resets the composer ──
    const confirmOpen = report.checks.confirmOpen;
    assert.ok(confirmOpen.confirmDialog, "choosing Delete note opened no confirmation");
    assert.equal(confirmOpen.confirmDialog!.role, "dialog");
    assert.equal(confirmOpen.confirmDialog!.modal, "true");
    assert.equal(confirmOpen.confirmDialog!.title, "Delete note");
    assert.match(confirmOpen.confirmDialog!.message ?? "", /hidden from the library/);
    assert.equal(confirmOpen.confirmDialog!.confirmLabel, "Delete note");
    assert.equal(confirmOpen.confirmDialog!.cancelLabel, "Cancel");
    assert.equal(confirmOpen.trigger?.expanded, "false", "the menu stayed over the confirmation");
    assert.deepEqual(
      report.checks.deleteCalls,
      ["note-harness-1"],
      "confirming did not write the delete exactly once with the open note",
    );

    const afterDelete = report.checks.afterDelete;
    assert.equal(afterDelete.trigger, null, "the composer did not reset: the menu is still there");
    assert.equal(afterDelete.badge, null, "the composer did not reset: the badge is still there");
    assert.equal(afterDelete.popover, null, "a menu is still open after deleting the note");
    assert.equal(afterDelete.composer.titleValue, "", "the composer kept the deleted note's title");
    assert.equal(afterDelete.cards, 0, "the deleted note is still listed");
    assert.match(afterDelete.emptyMessage ?? "", /No notes yet/);

    // ── Nothing else reached the bridge, and nothing is on fire ─────────────
    assert.deepEqual(
      report.checks.unexpectedBridgeCalls,
      [],
      "the page called bridge methods this rig does not model",
    );
    assert.deepEqual(report.checks.noteWrites, { updates: [], creates: [] });
    assert.deepEqual(
      report.checks.bridgeCalls.librarySetLocked,
      [
        { id: "note-harness-1", locked: true },
        { id: "note-harness-1", locked: false },
        { id: "note-harness-1", locked: true },
      ],
      "the note's lock was not the only thing written, in order",
    );
    assert.deepEqual(report.checks.consoleErrors, []);

    // The artifacts the hand-over points at: the open menu (this change), the
    // locked note with its menu, and the landing page with no menu at all.
    for (const name of [
      "documents-lock-ui.json",
      "documents-lock-ui.png",
      "documents-lock-ui-open.png",
      "documents-lock-ui-locked.png",
    ]) {
      const artifact = path.join(desktopRoot, "e2e/artifacts", name);
      assert.equal(fs.existsSync(artifact), true, `${name} was not written`);
      assert.ok(fs.statSync(artifact).size > 1000, `${name} is not a rendered artifact`);
    }
  });
});
