/**
 * Drives the documents-lock harness in a real Electron window and turns what
 * the Documents page actually renders into
 * `e2e/artifacts/documents-lock-ui.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/documents-lock-ui.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. THE MENU LIVES IN THE PAGE'S CORNER, AND ONLY FOR AN OPEN NOTE. Landing on
 *     /documents with one note in the library and an empty composer draws no
 *     corner, no badge and no menu at all. Opening the seeded card (one
 *     `libraryGet`) draws the state badge and the three-dot trigger at the
 *     header's top-right edge, with the menu closed. Measuring the boxes is what
 *     makes "top right" a fact: the trigger's right edge is the header's, its top
 *     is the header's first line, and the badge sits on that same line, to its
 *     left, on the page's right half.
 *  2. THE LOCK IS THE MENU'S FIRST ITEM. Opening the trigger draws a role=menu
 *     popover anchored under it and right-aligned to it. Its FIRST item is the
 *     role=menuitemcheckbox lock row, unchecked while the note is unlocked, with
 *     a track and a thumb it can draw; the caption reads "Lock". Propose change
 *     is absent while unlocked (there is nothing to propose against), and Delete
 *     note is present, LAST, and wears the destructive ink (its computed colour
 *     differs from the lock row's).
 *  3. CHOOSING THE LOCK WRITES ONCE AND LEAVES THE MENU OPEN. One click records
 *     exactly one `librarySetLocked(note id, true)`, the item flips to
 *     aria-checked=true / data-locked=true, the menu stays mounted, the badge
 *     reads Locked, the title and body become read-only and the domain checkbox
 *     disabled; Propose change appears SECOND, Delete stays last. The bottom
 *     composer row never grows Delete/Propose buttons again: the menu is the one
 *     place those acts live.
 *  4. IT TOGGLES BACK. A second click records exactly one
 *     `librarySetLocked(note id, false)`, the badge reads Unlocked, the controls
 *     are editable again and Propose change is gone.
 *  5. ESCAPE DISMISSES AND RETURNS THE KEYBOARD. Opening the menu moves focus
 *     into it; Escape closes it and the trigger is the active element
 *     afterwards. A press outside the menu closes it too, and neither dismissal
 *     writes anything.
 *  6. THE MENU'S ACTIONS ACT ON THE OPEN NOTE. Locking again puts Propose change
 *     second; choosing it closes the menu (the trigger reads aria-expanded=false)
 *     and opens the Propose change dialog, WITHOUT filing a Decision (opening the
 *     dialog is not submitting it). Choosing Delete note closes the menu and asks
 *     through the app's own ConfirmDialog ("Delete note", the note is "hidden
 *     from the library"); only confirming records exactly one
 *     `libraryDelete(note id)`, and the composer resets: no menu, no badge, no
 *     note card, the empty-library message back.
 *  7. NOTHING ELSE REACHED THE BRIDGE, AND NOTHING IS ON FIRE. No bridge method
 *     outside the recording stub was called (a page that grows a dependency fails
 *     by name), and no console error was logged.
 *
 * Falsification: every claim is read back from the rendered DOM and from the
 * recorded stub. A page that keeps its old bottom Delete/Propose buttons fails
 * claim 3; a lock item that closes the menu fails claim 3; a menu whose actions
 * run before closing fails claim 6; an Escape that leaves focus in the menu
 * fails claim 5.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/documents-lock-ui.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const NOTE_ID = "note-harness-1";
const NOTE_TITLE = "Harness note";

/** Read the notes page's corner, menu, composer and dialogs off the page. */
const SAMPLE = `(() => {
  const q = (sel, root = document) => root.querySelector(sel);
  const text = (el) => (el ? (el.textContent || "").trim() : null);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const paint = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      color: s.color,
      background: s.backgroundColor,
      position: s.position,
      zIndex: s.zIndex,
    };
  };

  const header = q(".documents-page__header");
  const corner = q('[data-testid="documents-page-corner"]');
  const trigger = q('[data-testid="note-page-menu"]');
  const popover = q('[data-testid="note-page-menu-popover"]');
  const badge = q(".doc-status-badge");
  const menuItems = popover
    ? Array.from(
        popover.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]'),
      )
    : [];
  const item = (testId) =>
    menuItems.find((el) => el.getAttribute("data-testid") === testId) ?? null;
  const itemSample = (el) => {
    if (!el) return null;
    return {
      testId: el.getAttribute("data-testid"),
      role: el.getAttribute("role"),
      ariaChecked: el.getAttribute("aria-checked"),
      ariaLabel: el.getAttribute("aria-label"),
      ariaExpanded: el.getAttribute("aria-expanded"),
      dataLocked: el.getAttribute("data-locked"),
      className: el.className,
      caption: text(el.querySelector(".page-menu__item-label")),
      hasTrack: Boolean(el.querySelector(".page-menu__track")),
      hasThumb: Boolean(el.querySelector(".page-menu__thumb")),
      disabled: el.disabled === true,
      paint: paint(el),
      box: box(el),
    };
  };

  const titleInput = q(".library-composer > label.field > input");
  const bodyTextarea = q(".library-composer > label.field > textarea");
  const domainCheckbox = q(
    '.library-composer .library-tag-picker input[type="checkbox"]',
  );
  const actions = q(".library-actions");
  const actionButtons = actions
    ? Array.from(actions.querySelectorAll("button"))
    : [];

  const proposeDialog = q(".propose-dialog");
  const confirmDialog = q(".confirm-dialog");
  const confirmButton = q(".confirm-dialog__confirm");
  const cancelButton = q(".confirm-dialog__cancel");

  return {
    skin: document.documentElement.dataset.skin ?? null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    header: box(header),
    corner: box(corner),
    trigger: trigger
      ? {
          testId: trigger.getAttribute("data-testid"),
          box: box(trigger),
          className: trigger.className,
          haspopup: trigger.getAttribute("aria-haspopup"),
          expanded: trigger.getAttribute("aria-expanded"),
          label: trigger.getAttribute("aria-label"),
          insideHeader: header ? header.contains(trigger) : null,
          insideCorner: corner ? corner.contains(trigger) : null,
        }
      : null,
    popover: popover
      ? {
          box: box(popover),
          role: popover.getAttribute("role"),
          label: popover.getAttribute("aria-label"),
          className: popover.className,
          paint: paint(popover),
          itemOrder: menuItems.map((el) => el.getAttribute("data-testid")),
          itemCount: menuItems.length,
        }
      : null,
    items: {
      lock: itemSample(item("note-lock-toggle")),
      propose: itemSample(item("note-propose")),
      delete: itemSample(item("note-delete")),
    },
    badge: badge
      ? {
          box: box(badge),
          text: text(badge),
          locked: badge.getAttribute("data-locked"),
          className: badge.className,
          insideHeader: header ? header.contains(badge) : null,
          insideCorner: corner ? corner.contains(badge) : null,
        }
      : null,
    composer: {
      titleValue: titleInput ? titleInput.value : null,
      titleReadOnly: titleInput ? titleInput.readOnly : null,
      bodyValue: bodyTextarea ? bodyTextarea.value : null,
      bodyReadOnly: bodyTextarea ? bodyTextarea.readOnly : null,
      domainDisabled: domainCheckbox ? domainCheckbox.disabled : null,
      domainChecked: domainCheckbox ? domainCheckbox.checked : null,
      saveDisabled: (() => {
        const save = actions?.querySelector('button[type="submit"]');
        return save ? save.disabled : null;
      })(),
      actionLabels: actionButtons.map((b) => (b.textContent || "").trim()),
      dangerButtons: actions
        ? actions.querySelectorAll(".btn-danger").length
        : null,
      proposeButtons: actionButtons.filter(
        (b) => (b.textContent || "").trim() === "Propose change",
      ).length,
      lockHint: text(q(".library-lock-hint")),
    },
    cards: document.querySelectorAll(".library-list .doc-card").length,
    selectedCards: document.querySelectorAll(".library-list .doc-card.is-selected")
      .length,
    emptyMessage: text(q(".documents-page > p.muted")),
    proposeDialog: proposeDialog
      ? {
          role: proposeDialog.getAttribute("role"),
          modal: proposeDialog.getAttribute("aria-modal"),
          heading: text(q("#propose-dialog-title")),
          hint: text(q(".propose-dialog__hint")),
          textareas: proposeDialog.querySelectorAll("textarea").length,
          buttons: Array.from(proposeDialog.querySelectorAll("button")).map(
            (b) => (b.textContent || "").trim(),
          ),
        }
      : null,
    confirmDialog: confirmDialog
      ? {
          role: confirmDialog.getAttribute("role"),
          modal: confirmDialog.getAttribute("aria-modal"),
          title: text(q(".confirm-dialog__title")),
          message: text(q(".confirm-dialog__message")),
          confirmLabel: confirmButton
            ? confirmButton.getAttribute("aria-label") ?? text(confirmButton)
            : null,
          confirmText: text(confirmButton),
          cancelLabel: cancelButton
            ? cancelButton.getAttribute("aria-label") ?? text(cancelButton)
            : null,
          buttons: Array.from(confirmDialog.querySelectorAll("button")).map(
            (b) => (b.textContent || "").trim(),
          ),
        }
      : null,
    activeElement: document.activeElement
      ? {
          testId: document.activeElement.getAttribute("data-testid"),
          tag: document.activeElement.tagName,
          insidePopover: popover
            ? popover.contains(document.activeElement)
            : false,
          insideTrigger: trigger
            ? trigger.contains(document.activeElement)
            : false,
        }
      : null,
  };
})()`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        value = undefined;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

/** Wait two frames, so a style change the rig just asked for has painted. */
function nextPaint(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

/** Click something in the page, by selector, and let React commit. */
async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return false;
       el.click();
       return true;
     })()`,
  );
  if (!clicked) throw new Error(`no element for ${selector}`);
  await new Promise((resolve) => setTimeout(resolve, 60));
}

/** A real mouse press, through the browser's own pipeline. */
function pressAt(win, x, y) {
  win.webContents.sendInputEvent({ type: "mouseMove", x, y });
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function pointAt(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  return point;
}

/** Escape, through the browser's own pipeline, as a real key event. */
function pressEscape(win) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
}

const read = (win, expression) => win.webContents.executeJavaScript(expression);
const sample = (win) => read(win, SAMPLE);
const lockCalls = (win) => read(win, "window.documentsLockLockCalls ?? []");
const deleteCalls = (win) => read(win, "window.documentsLockDeleteCalls ?? []");
const getCalls = (win) => read(win, "window.documentsLockGetCalls ?? []");
const decisionCalls = (win) =>
  read(win, "window.documentsLockDecisionCalls ?? []");

async function openMenu(win) {
  const open = await read(
    win,
    `Boolean(document.querySelector('[data-testid="note-page-menu-popover"]'))`,
  );
  if (!open) await click(win, '[data-testid="note-page-menu"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="note-page-menu-popover"]'))`,
    "the note menu to open",
  );
}

async function closeMenuIfOpen(win) {
  const open = await read(
    win,
    `Boolean(document.querySelector('[data-testid="note-page-menu-popover"]'))`,
  );
  if (!open) return;
  await pressEscape(win);
  await waitFor(
    win,
    `!document.querySelector('[data-testid="note-page-menu-popover"]')`,
    "the note menu to close",
  );
}

async function main() {
  const sessionPartition = `documents-lock-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers. Painting is the switch
    // above; this keeps timers honest.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.documentsLockReady)", "documentsLockReady");

  const checks = {};
  const shots = {};

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every design claim below would be about the wrong theme.
  checks.skin = await read(
    win,
    "({ name: window.documentsLockSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(
      `the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`,
    );
  }

  // ── 1. landing: one note in the library, no note open ─────────────────────
  await waitFor(
    win,
    "document.querySelectorAll('.library-list .doc-card').length === 1",
    "the seeded note card",
  );
  const landing = await sample(win);
  checks.landing = landing;
  if (landing.cards !== 1) {
    failure(`the library listed ${landing.cards} cards, expected the one seeded note`);
  }
  if (landing.selectedCards !== 0) {
    failure("the library landed with the note already open");
  }
  if (landing.composer.titleValue !== "") {
    failure(
      `the composer landed with a title: ${JSON.stringify(landing.composer.titleValue)}`,
    );
  }
  if (landing.trigger) {
    failure("an empty composer still drew the note menu trigger");
  }
  if (landing.badge) {
    failure("an empty composer still drew the note state badge");
  }
  if (landing.popover) {
    failure("an empty composer still drew an open note menu");
  }
  if (landing.corner) {
    failure("an empty composer still drew the page corner");
  }
  shots.landing = await win.webContents.capturePage();

  // ── 2. open the seeded note: the corner appears, the menu is closed ───────
  const getsBefore = (await getCalls(win)).length;
  await click(win, ".library-list .doc-card");
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="note-page-menu"]'))`,
    "the page menu after opening the note",
  );
  await waitFor(
    win,
    `(() => {
       const i = document.querySelector('.library-composer > label.field > input');
       return i && i.value === ${JSON.stringify(NOTE_TITLE)};
     })()`,
    "the composer to load the note",
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('.library-tag-picker input[type="checkbox"]'))`,
    "the composer's domain picker",
  );

  const openedGets = await getCalls(win);
  checks.openedNoteGetCalls = openedGets;
  if (openedGets.length - getsBefore !== 1) {
    failure(
      `opening the note called libraryGet ${openedGets.length - getsBefore} times, expected 1`,
    );
  }
  if (openedGets[openedGets.length - 1] !== NOTE_ID) {
    failure(
      `opening the note asked for ${JSON.stringify(openedGets[openedGets.length - 1])}, expected ${NOTE_ID}`,
    );
  }

  const opened = await sample(win);
  checks.opened = opened;
  if (!opened.trigger) {
    failure("opening the note drew no page menu trigger");
  } else {
    if (opened.trigger.haspopup !== "menu") {
      failure(
        `the trigger's aria-haspopup read ${JSON.stringify(opened.trigger.haspopup)}`,
      );
    }
    if (opened.trigger.expanded !== "false") {
      failure(
        `the trigger landed aria-expanded=${JSON.stringify(opened.trigger.expanded)}`,
      );
    }
    if (opened.trigger.label !== "Note actions") {
      failure(
        `the trigger is named ${JSON.stringify(opened.trigger.label)}, expected "Note actions"`,
      );
    }
    if (opened.trigger.className !==
      "btn btn-ghost page-menu__trigger page-corner__action") {
      failure(
        `the trigger's class list is ${JSON.stringify(opened.trigger.className)}`,
      );
    }
    if (!opened.trigger.insideHeader) {
      failure("the page menu trigger is outside the page's header");
    }
    if (!opened.trigger.insideCorner) {
      failure("the page menu trigger is outside the page's corner");
    }
    const header = opened.header;
    if (!header) {
      failure("the page recorded no header box");
    } else {
      if (opened.trigger.box.top - header.top > 32) {
        failure(
          `the trigger is not on the header's first line: trigger top ${opened.trigger.box.top}, header top ${header.top}`,
        );
      }
      if (opened.trigger.box.right < header.right - 8) {
        failure(
          `the trigger is not at the header's right edge: trigger right ${opened.trigger.box.right}, header right ${header.right}`,
        );
      }
    }
  }

  if (!opened.badge) {
    failure("opening the note drew no lock state badge");
  } else {
    if (opened.badge.text !== "Unlocked") {
      failure(
        `the opened note's badge read ${JSON.stringify(opened.badge.text)}`,
      );
    }
    if (opened.badge.locked !== "false") {
      failure(
        `the opened note's badge data-locked read ${JSON.stringify(opened.badge.locked)}`,
      );
    }
    if (!opened.badge.insideHeader) {
      failure("the state badge is outside the page's header");
    }
    if (!opened.badge.insideCorner) {
      failure("the state badge left the page's corner");
    }
    if (opened.trigger) {
      if (opened.badge.box.right > opened.trigger.box.left + 2) {
        failure(
          `the badge is not to the left of the menu: badge right ${opened.badge.box.right}, menu left ${opened.trigger.box.left}`,
        );
      }
      const badgeMid = (opened.badge.box.top + opened.badge.box.bottom) / 2;
      const triggerMid = (opened.trigger.box.top + opened.trigger.box.bottom) / 2;
      if (Math.abs(badgeMid - triggerMid) > 8) {
        failure(
          `the badge is not on the menu's line: badge mid ${badgeMid}, menu mid ${triggerMid}`,
        );
      }
      if (opened.header && opened.badge.box.left < opened.header.left + opened.header.width / 2) {
        failure(
          `the badge is not on the page's right half: badge left ${opened.badge.box.left}, header ${opened.header.left}..${opened.header.left + opened.header.width}`,
        );
      }
    }
  }

  if (opened.popover || opened.items.lock) {
    failure("the menu was open as soon as the note opened");
  }
  if (opened.composer.titleReadOnly !== false) {
    failure("an unlocked note's title is read-only");
  }
  if (opened.composer.bodyReadOnly !== false) {
    failure("an unlocked note's body is read-only");
  }
  if (opened.composer.domainDisabled !== false) {
    failure("an unlocked note's domain picker is disabled");
  }
  if (opened.composer.domainChecked !== true) {
    failure("the seeded note's domain was not checked");
  }
  if (opened.composer.dangerButtons !== 0) {
    failure(
      `the composer's bottom row still offers ${opened.composer.dangerButtons} danger button(s)`,
    );
  }
  if (opened.composer.proposeButtons !== 0) {
    failure("the composer's bottom row still offers Propose change");
  }
  if (!opened.composer.actionLabels.includes("Save")) {
    failure(
      `the composer's actions are ${JSON.stringify(opened.composer.actionLabels)}, expected Save`,
    );
  }
  if (!opened.composer.actionLabels.includes("Cancel")) {
    failure("the open note's composer offered no Cancel");
  }

  // ── 3. the open menu: the lock leads it, Delete is last ───────────────────
  await openMenu(win);
  const menuUnlocked = await sample(win);
  checks.menuUnlocked = menuUnlocked;

  const pop = menuUnlocked.popover;
  if (!pop) {
    failure("opening the menu drew no popover");
  } else {
    if (pop.role !== "menu") {
      failure(`the popover's role read ${JSON.stringify(pop.role)}`);
    }
    if (pop.label !== "Note actions") {
      failure(`the popover is named ${JSON.stringify(pop.label)}`);
    }
    if (!pop.className.split(/\s+/).includes("page-menu__popover")) {
      failure(`the popover's class list is ${JSON.stringify(pop.className)}`);
    }
    if (pop.paint.position !== "absolute") {
      failure(
        `the popover does not float over the page: position ${JSON.stringify(pop.paint.position)}`,
      );
    }
    if (!menuUnlocked.trigger) {
      failure("the trigger vanished while its menu was open");
    } else {
      if (menuUnlocked.trigger.expanded !== "true") {
        failure(
          `the open menu's trigger read aria-expanded=${JSON.stringify(menuUnlocked.trigger.expanded)}`,
        );
      }
      if (pop.box.top < menuUnlocked.trigger.box.bottom + 3) {
        failure(
          `the popover is not anchored under the trigger: popover top ${pop.box.top}, trigger bottom ${menuUnlocked.trigger.box.bottom}`,
        );
      }
      if (Math.abs(pop.box.right - menuUnlocked.trigger.box.right) > 2) {
        failure(
          `the popover is not right-aligned to the trigger: popover right ${pop.box.right}, trigger right ${menuUnlocked.trigger.box.right}`,
        );
      }
    }
  }

  const first = menuUnlocked.popover?.itemOrder[0] ?? null;
  if (first !== "note-lock-toggle") {
    failure(`the menu's first item is ${JSON.stringify(first)}, expected the lock`);
  }
  const lockUnlocked = menuUnlocked.items.lock;
  if (!lockUnlocked) {
    failure("the open menu drew no lock item");
  } else {
    if (lockUnlocked.role !== "menuitemcheckbox") {
      failure(`the lock item's role read ${JSON.stringify(lockUnlocked.role)}`);
    }
    if (lockUnlocked.ariaChecked !== "false") {
      failure(
        `an unlocked note's lock item read aria-checked=${JSON.stringify(lockUnlocked.ariaChecked)}`,
      );
    }
    if (lockUnlocked.dataLocked !== "false") {
      failure(
        `an unlocked note's lock item read data-locked=${JSON.stringify(lockUnlocked.dataLocked)}`,
      );
    }
    if (lockUnlocked.ariaLabel !== "Lock this note") {
      failure(
        `the unlocked lock item is named ${JSON.stringify(lockUnlocked.ariaLabel)}`,
      );
    }
    if (lockUnlocked.caption !== "Lock") {
      failure(
        `the unlocked lock item's caption read ${JSON.stringify(lockUnlocked.caption)}`,
      );
    }
    if (!lockUnlocked.hasTrack || !lockUnlocked.hasThumb) {
      failure("the lock item drew no track/thumb");
    }
  }

  if (menuUnlocked.items.propose) {
    failure("an unlocked note's menu offered Propose change");
  }
  const last = menuUnlocked.popover?.itemOrder.at(-1) ?? null;
  if (last !== "note-delete") {
    failure(`the menu's last item is ${JSON.stringify(last)}, expected Delete note`);
  }
  const deleteUnlocked = menuUnlocked.items.delete;
  if (!deleteUnlocked) {
    failure("the open menu offered no Delete note item");
  } else {
    if (deleteUnlocked.role !== "menuitem") {
      failure(`the Delete item's role read ${JSON.stringify(deleteUnlocked.role)}`);
    }
    if (deleteUnlocked.caption !== "Delete note") {
      failure(
        `the Delete item's caption read ${JSON.stringify(deleteUnlocked.caption)}`,
      );
    }
    if (!deleteUnlocked.className.split(/\s+/).includes("page-menu__item--danger")) {
      failure(
        `the Delete item's class list is ${JSON.stringify(deleteUnlocked.className)}`,
      );
    }
    if (lockUnlocked && deleteUnlocked.paint.color === lockUnlocked.paint.color) {
      failure(
        `the Delete item is not drawn in the destructive ink: both items are ${deleteUnlocked.paint.color}`,
      );
    }
  }
  shots.open = await win.webContents.capturePage();

  // ── 4. choosing the lock writes once and leaves the menu open ─────────────
  const locksBefore = (await lockCalls(win)).length;
  await click(win, '[data-testid="note-lock-toggle"]');
  await waitFor(
    win,
    `(() => {
       const el = document.querySelector('[data-testid="note-lock-toggle"]');
       return el && el.getAttribute('aria-checked') === 'true' && !el.disabled;
     })()`,
    "the lock item to read checked and settled",
  );
  await waitFor(
    win,
    `(() => {
       const b = document.querySelector('.doc-status-badge');
       return b && b.getAttribute('data-locked') === 'true';
     })()`,
    "the badge to read Locked",
  );
  await waitFor(
    win,
    `(() => {
       const i = document.querySelector('.library-composer > label.field > input');
       return i && i.readOnly === true;
     })()`,
    "the composer to become read-only",
  );

  const callsAfterLock = await lockCalls(win);
  checks.lockCalls = callsAfterLock;
  if (callsAfterLock.length - locksBefore !== 1) {
    failure(
      `locking wrote the bridge ${callsAfterLock.length - locksBefore} times, expected 1`,
    );
  }
  const lockedCall = callsAfterLock[callsAfterLock.length - 1];
  if (lockedCall?.id !== NOTE_ID) {
    failure(
      `locking addressed ${JSON.stringify(lockedCall?.id)}, expected ${NOTE_ID}`,
    );
  }
  if (lockedCall?.locked !== true) {
    failure(
      `locking sent locked=${JSON.stringify(lockedCall?.locked)}, expected true`,
    );
  }

  const lockedMenu = await sample(win);
  checks.lockedMenuOpen = lockedMenu;
  if (!lockedMenu.popover) {
    failure("choosing the lock closed the menu — a menuitemcheckbox must keep it open");
  }
  const lockLocked = lockedMenu.items.lock;
  if (!lockLocked) {
    failure("the locked note's menu lost its lock item");
  } else {
    if (lockLocked.ariaChecked !== "true") {
      failure(
        `the locked note's lock item read aria-checked=${JSON.stringify(lockLocked.ariaChecked)}`,
      );
    }
    if (lockLocked.dataLocked !== "true") {
      failure(
        `the locked note's lock item read data-locked=${JSON.stringify(lockLocked.dataLocked)}`,
      );
    }
    if (lockLocked.ariaLabel !== "Unlock this note") {
      failure(
        `the locked lock item is named ${JSON.stringify(lockLocked.ariaLabel)}`,
      );
    }
    if (lockLocked.caption !== "Lock") {
      failure(
        `the locked lock item's caption read ${JSON.stringify(lockLocked.caption)}`,
      );
    }
    if (!lockLocked.hasTrack || !lockLocked.hasThumb) {
      failure("the locked lock item drew no track/thumb");
    }
  }
  if (lockedMenu.badge?.text !== "Locked") {
    failure(
      `the locked note's badge read ${JSON.stringify(lockedMenu.badge?.text)}`,
    );
  }
  if (lockedMenu.badge?.locked !== "true") {
    failure(
      `the locked note's badge data-locked read ${JSON.stringify(lockedMenu.badge?.locked)}`,
    );
  }
  if (lockedMenu.composer.titleReadOnly !== true) {
    failure("the locked note's title is still editable");
  }
  if (lockedMenu.composer.bodyReadOnly !== true) {
    failure("the locked note's body is still editable");
  }
  if (lockedMenu.composer.domainDisabled !== true) {
    failure("the locked note's domain picker is still enabled");
  }
  if (lockedMenu.composer.saveDisabled !== true) {
    failure("the locked note's Save is still enabled");
  }
  if (!(lockedMenu.composer.lockHint ?? "").includes("Unlock to edit")) {
    failure(
      `the locked hint read ${JSON.stringify(lockedMenu.composer.lockHint)}`,
    );
  }
  if (lockedMenu.composer.dangerButtons !== 0) {
    failure("the locked note's bottom row grew a Delete button");
  }
  if (lockedMenu.composer.proposeButtons !== 0) {
    failure("the locked note's bottom row grew a Propose button");
  }

  const lockedOrder = lockedMenu.popover?.itemOrder ?? [];
  checks.lockedItemOrder = lockedOrder;
  if (lockedOrder[0] !== "note-lock-toggle") {
    failure(`the locked menu's first item is ${JSON.stringify(lockedOrder[0])}`);
  }
  if (lockedOrder[1] !== "note-propose") {
    failure(
      `Propose change is not the locked menu's second item: ${JSON.stringify(lockedOrder)}`,
    );
  }
  if (lockedOrder.at(-1) !== "note-delete") {
    failure(
      `Delete note is not the locked menu's last item: ${JSON.stringify(lockedOrder)}`,
    );
  }
  const proposeLocked = lockedMenu.items.propose;
  if (!proposeLocked) {
    failure("the locked note's menu offered no Propose change item");
  } else {
    if (proposeLocked.role !== "menuitem") {
      failure(
        `Propose change's role read ${JSON.stringify(proposeLocked.role)}`,
      );
    }
    if (proposeLocked.caption !== "Propose change") {
      failure(
        `Propose change's caption read ${JSON.stringify(proposeLocked.caption)}`,
      );
    }
  }
  const deleteLocked = lockedMenu.items.delete;
  if (!deleteLocked) {
    failure("the locked note's menu lost its Delete item");
  } else if (
    !deleteLocked.className.split(/\s+/).includes("page-menu__item--danger")
  ) {
    failure(
      `the locked Delete item's class list is ${JSON.stringify(deleteLocked.className)}`,
    );
  }
  shots.locked = await win.webContents.capturePage();

  // ── 5. it toggles back ────────────────────────────────────────────────────
  await click(win, '[data-testid="note-lock-toggle"]');
  await waitFor(
    win,
    `(() => {
       const el = document.querySelector('[data-testid="note-lock-toggle"]');
       return el && el.getAttribute('aria-checked') === 'false' && !el.disabled;
     })()`,
    "the lock item to read unchecked and settled",
  );
  await waitFor(
    win,
    `(() => {
       const i = document.querySelector('.library-composer > label.field > input');
       return i && i.readOnly === false;
     })()`,
    "the composer to become editable again",
  );
  const callsAfterUnlock = await lockCalls(win);
  checks.unlockCalls = callsAfterUnlock;
  if (callsAfterUnlock.length - locksBefore !== 2) {
    failure(
      `the two lock presses wrote the bridge ${callsAfterUnlock.length - locksBefore} times, expected 2`,
    );
  }
  const unlockCall = callsAfterUnlock[callsAfterUnlock.length - 1];
  if (unlockCall?.id !== NOTE_ID || unlockCall?.locked !== false) {
    failure(
      `unlocking sent ${JSON.stringify(unlockCall)}, expected ${NOTE_ID} / false`,
    );
  }
  const unlockedAgain = await sample(win);
  checks.unlockedAgain = unlockedAgain;
  if (!unlockedAgain.popover) {
    failure("unlocking closed the menu — a menuitemcheckbox must keep it open");
  }
  const unlockedAgainOrder = unlockedAgain.popover?.itemOrder ?? [];
  checks.unlockedAgainItemOrder = unlockedAgainOrder;
  if (unlockedAgainOrder.join(",") !== "note-lock-toggle,note-delete") {
    failure(
      `the unlocked menu's item order is ${JSON.stringify(unlockedAgainOrder)}, expected [lock, delete]`,
    );
  }
  if (unlockedAgain.badge?.text !== "Unlocked") {
    failure(
      `the unlocked note's badge read ${JSON.stringify(unlockedAgain.badge?.text)}`,
    );
  }
  if (unlockedAgain.items.propose) {
    failure("Propose change stayed in the menu after unlocking");
  }
  if (unlockedAgain.composer.titleReadOnly !== false) {
    failure("unlocking did not make the title editable");
  }
  if (unlockedAgain.composer.bodyReadOnly !== false) {
    failure("unlocking did not make the body editable");
  }
  if (unlockedAgain.composer.domainDisabled !== false) {
    failure("unlocking did not re-enable the domain picker");
  }
  if (unlockedAgain.composer.dangerButtons !== 0) {
    failure("unlocking restored a Delete button in the bottom row");
  }
  if (unlockedAgain.composer.proposeButtons !== 0) {
    failure("unlocking restored a Propose button in the bottom row");
  }

  // ── 6. Escape dismisses the menu and hands the keyboard back ──────────────
  // The lock press leaves the menu open; close it first so the opening below is
  // a fresh one whose focus move the rig can see.
  await closeMenuIfOpen(win);
  await openMenu(win);
  await waitFor(
    win,
    `(() => {
       const pop = document.querySelector('[data-testid="note-page-menu-popover"]');
       return Boolean(pop) && pop.contains(document.activeElement);
     })()`,
    "focus to move into the open menu",
  );
  const focusInMenu = (await sample(win)).activeElement;
  checks.focusInMenu = focusInMenu;
  if (!focusInMenu?.insidePopover) {
    failure(
      `opening the menu left focus outside it: ${JSON.stringify(focusInMenu)}`,
    );
  }
  pressEscape(win);
  await waitFor(
    win,
    `!document.querySelector('[data-testid="note-page-menu-popover"]')`,
    "the menu to close on Escape",
  );
  const escaped = await sample(win);
  checks.escapeClosed = escaped;
  if (escaped.popover) {
    failure("Escape did not close the menu");
  }
  if (escaped.trigger?.expanded !== "false") {
    failure(
      `Escape left the trigger aria-expanded=${JSON.stringify(escaped.trigger?.expanded)}`,
    );
  }
  if (escaped.activeElement?.testId !== "note-page-menu") {
    failure(
      `Escape left focus on ${JSON.stringify(escaped.activeElement)}, expected the trigger`,
    );
  }

  // ── 7. a press outside dismisses it too, and writes nothing ──────────────
  await openMenu(win);
  const locksBeforeOutside = (await lockCalls(win)).length;
  const deletesBeforeOutside = (await deleteCalls(win)).length;
  const outsidePoint = await read(
    win,
    `(() => {
       const el = document.querySelector('.documents-page__intro');
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
     })()`,
  );
  if (!outsidePoint) {
    failure("the page's intro recorded no box to press outside the menu");
  } else {
    pressAt(win, outsidePoint.x, outsidePoint.y);
    await waitFor(
      win,
      `!document.querySelector('[data-testid="note-page-menu-popover"]')`,
      "the menu to close on an outside press",
    );
    const outside = await sample(win);
    checks.outsideClosed = outside;
    if (outside.popover) failure("an outside press did not close the menu");
    if (outside.trigger?.expanded !== "false") {
      failure(
        `an outside press left the trigger aria-expanded=${JSON.stringify(outside.trigger?.expanded)}`,
      );
    }
    if (outside.proposeDialog || outside.confirmDialog) {
      failure("an outside press opened a dialog");
    }
    if ((await lockCalls(win)).length !== locksBeforeOutside) {
      failure("an outside press wrote the lock");
    }
    if ((await deleteCalls(win)).length !== deletesBeforeOutside) {
      failure("an outside press wrote the delete");
    }
  }

  // ── 8. lock again, then Propose change from the menu ─────────────────────
  await openMenu(win);
  const locksBeforePropose = (await lockCalls(win)).length;
  await click(win, '[data-testid="note-lock-toggle"]');
  await waitFor(
    win,
    `(() => {
       const el = document.querySelector('[data-testid="note-lock-toggle"]');
       return el && el.getAttribute('aria-checked') === 'true' && !el.disabled;
     })()`,
    "the note to lock again before proposing",
  );
  if ((await lockCalls(win)).length - locksBeforePropose !== 1) {
    failure("locking again before proposing did not write exactly once");
  }

  const decisionsBefore = (await decisionCalls(win)).length;
  await click(win, '[data-testid="note-propose"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="note-page-menu-popover"]')`,
    "the menu to close on Propose change",
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('.propose-dialog'))`,
    "the propose dialog to open",
  );
  const proposeOpen = await sample(win);
  checks.proposeOpen = proposeOpen;
  if (!proposeOpen.proposeDialog) {
    failure("choosing Propose change opened no dialog");
  } else {
    if (proposeOpen.proposeDialog.role !== "dialog") {
      failure(
        `the propose dialog's role read ${JSON.stringify(proposeOpen.proposeDialog.role)}`,
      );
    }
    if (proposeOpen.proposeDialog.modal !== "true") {
      failure("the propose dialog is not aria-modal");
    }
    if (proposeOpen.proposeDialog.heading !== "Propose change") {
      failure(
        `the propose dialog's heading read ${JSON.stringify(proposeOpen.proposeDialog.heading)}`,
      );
    }
    if (!(proposeOpen.proposeDialog.hint ?? "").includes("Decisions")) {
      failure(
        `the propose dialog's hint read ${JSON.stringify(proposeOpen.proposeDialog.hint)}`,
      );
    }
    if (proposeOpen.proposeDialog.textareas < 2) {
      failure(
        `the propose dialog drew ${proposeOpen.proposeDialog.textareas} textarea(s)`,
      );
    }
    if (!proposeOpen.proposeDialog.buttons.includes("Submit proposal")) {
      failure(
        `the propose dialog's buttons are ${JSON.stringify(proposeOpen.proposeDialog.buttons)}`,
      );
    }
  }
  if (proposeOpen.trigger?.expanded !== "false") {
    failure("the menu stayed open over the propose dialog");
  }
  if ((await decisionCalls(win)).length !== decisionsBefore) {
    failure("opening Propose change filed a Decision without submitting it");
  }

  // Close the dialog through its own Cancel, not the menu.
  await click(win, ".propose-dialog__actions .btn-secondary");
  await waitFor(
    win,
    `!document.querySelector('.propose-dialog')`,
    "the propose dialog to close",
  );

  // ── 9. Delete note asks first, then deletes once and resets ──────────────
  const deletesBefore = (await deleteCalls(win)).length;
  await openMenu(win);
  await click(win, '[data-testid="note-delete"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="note-page-menu-popover"]')`,
    "the menu to close on Delete note",
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('.confirm-dialog'))`,
    "the delete confirmation to open",
  );
  const confirmOpen = await sample(win);
  checks.confirmOpen = confirmOpen;
  if (!confirmOpen.confirmDialog) {
    failure("choosing Delete note opened no confirmation");
  } else {
    if (confirmOpen.confirmDialog.role !== "dialog") {
      failure(
        `the confirm dialog's role read ${JSON.stringify(confirmOpen.confirmDialog.role)}`,
      );
    }
    if (confirmOpen.confirmDialog.modal !== "true") {
      failure("the confirm dialog is not aria-modal");
    }
    if (confirmOpen.confirmDialog.title !== "Delete note") {
      failure(
        `the confirm dialog's title read ${JSON.stringify(confirmOpen.confirmDialog.title)}`,
      );
    }
    if (!(confirmOpen.confirmDialog.message ?? "").includes("hidden from the library")) {
      failure(
        `the confirm dialog's message read ${JSON.stringify(confirmOpen.confirmDialog.message)}`,
      );
    }
    if (confirmOpen.confirmDialog.confirmLabel !== "Delete note") {
      failure(
        `the confirm control is named ${JSON.stringify(confirmOpen.confirmDialog.confirmLabel)}`,
      );
    }
    if (confirmOpen.confirmDialog.cancelLabel !== "Cancel") {
      failure(
        `the cancel control is named ${JSON.stringify(confirmOpen.confirmDialog.cancelLabel)}`,
      );
    }
  }
  if (confirmOpen.trigger?.expanded !== "false") {
    failure("the menu stayed open over the delete confirmation");
  }
  if ((await deleteCalls(win)).length !== deletesBefore) {
    failure("Delete note deleted before the question was answered");
  }

  await click(win, ".confirm-dialog__confirm");
  await waitFor(
    win,
    `(window.documentsLockDeleteCalls ?? []).length > ${deletesBefore}`,
    "the delete to reach the bridge",
  );
  await waitFor(
    win,
    `!document.querySelector('.confirm-dialog')`,
    "the confirm dialog to close after confirming",
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="note-page-menu"]')`,
    "the composer to reset (no menu)",
  );
  await waitFor(
    win,
    `(() => {
       const i = document.querySelector('.library-composer > label.field > input');
       return i && i.value === '';
     })()`,
    "the composer to clear",
  );
  // The delete's reload is async: wait for the empty library to say so before
  // sampling, or the rig could read the list the page has not replaced yet.
  await waitFor(
    win,
    `(() => {
       const p = document.querySelector('.documents-page > p.muted');
       return Boolean(p) && p.textContent.includes('No notes yet');
     })()`,
    "the empty-library message after the delete",
  );
  const afterDelete = await sample(win);
  checks.afterDelete = afterDelete;
  const finalDeletes = await deleteCalls(win);
  checks.deleteCalls = finalDeletes;
  if (finalDeletes.length - deletesBefore !== 1) {
    failure(
      `confirming wrote the delete ${finalDeletes.length - deletesBefore} times, expected 1`,
    );
  }
  if (finalDeletes[finalDeletes.length - 1] !== NOTE_ID) {
    failure(
      `the delete addressed ${JSON.stringify(finalDeletes[finalDeletes.length - 1])}, expected ${NOTE_ID}`,
    );
  }
  if (afterDelete.trigger) {
    failure("the composer did not reset: the note menu is still there");
  }
  if (afterDelete.badge) {
    failure("the composer did not reset: the state badge is still there");
  }
  if (afterDelete.popover) {
    failure("a menu is still open after deleting the note");
  }
  if (afterDelete.confirmDialog) {
    failure("the confirmation stayed up after confirming");
  }
  if (afterDelete.composer.titleValue !== "") {
    failure(
      `the composer kept a title after the delete: ${JSON.stringify(afterDelete.composer.titleValue)}`,
    );
  }
  if (afterDelete.cards !== 0) {
    failure(`the deleted note is still listed (${afterDelete.cards} card(s))`);
  }
  if (!(afterDelete.emptyMessage ?? "").includes("No notes yet")) {
    failure(
      `the empty library did not say so: ${JSON.stringify(afterDelete.emptyMessage)}`,
    );
  }

  // ── 10. nothing unexpected, nothing on fire ───────────────────────────────
  const unexpected = await read(win, "window.documentsLockUnexpectedCalls");
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(
      `the page called bridge methods this rig does not model: ${unexpected.join(", ")}`,
    );
  }
  const updates = await read(win, "window.documentsLockUpdateCalls ?? []");
  const creates = await read(win, "window.documentsLockCreateCalls ?? []");
  checks.noteWrites = { updates, creates };
  if (updates.length > 0) {
    failure(`a note update reached the bridge: ${JSON.stringify(updates)}`);
  }
  if (creates.length > 0) {
    failure(`a note create reached the bridge: ${JSON.stringify(creates)}`);
  }
  checks.bridgeCalls = {
    libraryList: await read(win, "window.documentsLockListCalls ?? 0"),
    libraryGet: await getCalls(win),
    librarySetLocked: await lockCalls(win),
    libraryDelete: finalDeletes,
    decisionCreate: await decisionCalls(win),
  };
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) {
    failure(`console errors: ${consoleErrors.join(" | ")}`);
  }

  const artifacts = {
    json: "e2e/artifacts/documents-lock-ui.json",
    landing: "e2e/artifacts/documents-lock-ui.png",
    openMenu: "e2e/artifacts/documents-lock-ui-open.png",
    lockedMenu: "e2e/artifacts/documents-lock-ui-locked.png",
  };
  checks.artifacts = artifacts;

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    samples: {
      landing,
      opened,
      menuUnlocked,
      lockedMenuOpen: lockedMenu,
      unlockedAgain,
      proposeOpen,
      confirmOpen,
      afterDelete,
    },
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "documents-lock-ui.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(artifactsDir, "documents-lock-ui.png"),
    shots.landing.toPNG(),
  );
  fs.writeFileSync(
    path.join(artifactsDir, "documents-lock-ui-open.png"),
    shots.open.toPNG(),
  );
  fs.writeFileSync(
    path.join(artifactsDir, "documents-lock-ui-locked.png"),
    shots.locked.toPNG(),
  );

  console.log(
    `landing:  cards ${landing.cards}, menu ${landing.trigger ? "shown" : "absent"}, badge ${landing.badge ? "shown" : "absent"}`,
  );
  console.log(
    `opened:   badge ${opened.badge?.text}, trigger ${opened.trigger ? "shown" : "absent"}, menu ${opened.popover ? "open" : "closed"}`,
  );
  console.log(
    `menu:     order ${JSON.stringify(menuUnlocked.popover?.itemOrder ?? [])}, lock ${lockUnlocked?.ariaChecked}`,
  );
  console.log(
    `locked:   badge ${lockedMenu.badge?.text}, order ${JSON.stringify(lockedMenu.popover?.itemOrder ?? [])}, reads ${lockedMenu.composer.titleReadOnly}/${lockedMenu.composer.domainDisabled}`,
  );
  console.log(
    `writes:   ${JSON.stringify(checks.lockCalls)} then delete ${JSON.stringify(finalDeletes)}`,
  );
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("documents-lock-ui rig timed out");
  app.exit(1);
}, 90_000);
