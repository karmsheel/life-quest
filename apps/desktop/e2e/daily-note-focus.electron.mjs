/**
 * Drives Daily Note "focus mode" in a real Electron window and turns what the
 * page and the sheet actually render into `e2e/artifacts/daily-note-focus.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/daily-note-focus.electron.mjs
 *
 * Exit code 0 = every step ran. The JSON report is the repeatable artifact: the
 * test file (`tests/daily-note-focus-ui-e2e.test.ts`) holds the assertions, this
 * file holds the interactions and the measurements, so a failure names a state
 * rather than a line of driver code.
 *
 * The page is the EXISTING daily-note harness (`e2e/daily-note.html`), so the
 * surface under test is the shipped one: the real shell, the real rail, the real
 * Daily Note page and the real `LiveMarkdownEditor`, with only the IPC bridge
 * stubbed. The driver waits on `window.dailyNoteReady` before it samples, so a
 * slow first Vite transform is never mistaken for a page that never painted.
 *
 * What is measured that a screenshot cannot show: the trigger's place in the
 * title row and its distance from Analyze note; the sheet's own frame, panel
 * measure and centring in a 1280px window; the title's centre against the panel's
 * centre; the cross's corner; the scrim's computed backdrop-filter and its dim;
 * that the page behind is still mounted; that the page of paper is headed by the
 * day's date and footed by the autosave band and the day's own acts, each in its
 * own place; which of the three dismissals closed it; and that a sentence typed
 * in the modal reaches the day's autosave ledger on the day the page was showing,
 * then reads back in the page editor behind.
 *
 * ── How this rig can fail (written before the assertions) ────────────────────
 *
 *  1. The trigger is missing, is not in the header's title row, is not the last
 *     control before Analyze note, or is not the icon-only button it claims to
 *     be (a labelled word, no aria-label, no icon, or an icon squeezed to a
 *     sliver inside a box that is otherwise the right size).
 *  2. Clicking it paints no sheet, or the sheet is not the shared frame: the
 *     root must carry both `data-focus-overlay` and `data-sheet-overlay`, and the
 *     panel must be `.focus-overlay__panel`.
 *  3. The panel is not a page of paper: not the page's own measure, narrower
 *     than the writing column it replaced, or not centred horizontally.
 *  4. The title is not "Daily Note", not centred over the panel, or not at the
 *     panel's top; the cross is not inside the panel, not in its top-right,
 *     or not labelled "Close focus mode".
 *  4a. The page shows two headings: the sheet's own title is still painted
 *     above the date, so the page is headed twice instead of once.
 *  4b. The date is not the page's one heading: not centred on the panel's true
 *     centre, not a heading, or not above the prose it heads.
 *  5. The scrim does not blur or does not dim (no `blur(...)` in the computed
 *     backdrop-filter, an opaque background).
 *  6. Focus mode replaces the page instead of covering it: `.daily-note` or
 *     `.nav-rail` leaves the DOM, so closing would not hand the page back.
 *  7. The modal editor is not the shared one box: `[data-testid=
 *     "daily-note-focus-editor"]` must be a `.note-live` inside
 *     `.focus-overlay__note`, and the sheet must draw exactly one of them.
 *  8. The body does not lock while it is up (`document.body.style.overflow`).
 *  9. Any of the three exits fails: the cross does not close it, a real press on
 *     the scrim does not close it, Escape does not close it — or the press
 *     lands on the panel, in which case the scrim test proved nothing.
 * 10. Typing in the modal does not write the SAME draft: the sentence never
 *     reaches `window.dailyNoteWrites`, reaches it for a day other than
 *     `window.dailyNoteToday`, or is written while the page shows another day.
 * 11. Closing loses the draft: the page editor behind must hold the sentence as
 *     prose or as its open writing line.
 * 12. The page of paper is not headed by the day, or the date sits under the
 *     prose rather than over it.
 * 13. The page of paper has no foot, the foot sits above the prose, the
 *     autosave band is missing or collapses when it has no words (so the page
 *     jumps when the notification lands), or the day's own acts are missing.
 * 14. A console error happened, or the page reached a bridge method this rig
 *     does not model (`window.dailyNoteUnexpectedCalls`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/daily-note.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };
/** The page of paper's own measure: 56rem at the app's 16px root. */
const PANEL_MEASURE = 56 * 16;
/** The sentence typed in the modal: distinctive, and no markdown of its own. */
const SENTENCE = "Focus mode: the note was written with the day on one surface.";
/** The sheet's exit motion outlives the close request; the unmount is after it. */
const EXIT_MS = 140;
/** The page's autosave is a timer; a rig that waits less would read it as lost. */
const AUTOSAVE_SETTLE_MS = 700;

/**
 * Read the trigger, the page behind, and the sheet (when one is up) straight off
 * the rendered DOM. The same sample is taken from every state, so a state that
 * should be closed and one that should be open differ only by what is mounted.
 */
const SAMPLE = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left),
      top: round(r.top),
      right: round(r.right),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height),
    };
  };
  const centre = (b) => (b ? { x: round(b.left + b.width / 2), y: round(b.top + b.height / 2) } : null);
  const text = (el) => ((el && el.textContent) || "").trim();

  const header = document.querySelector(".daily-note__header");
  const titleRow = document.querySelector(".daily-note__title-row");
  const actions = document.querySelector(".daily-note__actions");
  const trigger = document.querySelector('[data-testid="daily-note-focus"]');
  const automations = document.querySelector(".daily-note__automations");
  const analyze = automations ? automations.querySelector("button") : null;

  const overlay = document.querySelector("[data-focus-overlay]");
  const panel = document.querySelector(".focus-overlay__panel");
  const chrome = document.querySelector(".focus-overlay__chrome");
  // The sheet's title is looked up by its id, not by its class: the frame gives
  // it the visually-hidden class instead of the title class when the title is
  // hidden, and the id is what labels the dialog either way.
  const sheetTitle = document.querySelector("#sheet-overlay-title");
  const close = document.querySelector(".focus-overlay__close");
  const sheetBody = document.querySelector(".focus-overlay__body");
  const note = document.querySelector(".focus-overlay__note");
  const editor = document.querySelector('[data-testid="daily-note-focus-editor"]');
  const focusInput = document.querySelector('[data-testid="daily-note-focus-editor-input"]');
  const overlayStyle = overlay ? getComputedStyle(overlay) : null;

  // The page of paper: the day's date at the top, the prose in the middle, and
  // the foot under it with the autosave band and the day's own acts.
  const pageDate = document.querySelector('[data-testid="focus-overlay-date"]');
  const foot = document.querySelector(".focus-overlay__foot");
  const statusLine = document.querySelector('[data-testid="focus-overlay-status"]');
  const focusActions = document.querySelector(".focus-overlay__actions");
  const focusAction = focusActions ? focusActions.querySelector("button") : null;

  const page = document.querySelector(".daily-note");
  const rail = document.querySelector(".nav-rail");
  const pageEditor = document.querySelector(".daily-note__editor .note-live");
  // What the operator would read as the note behind the sheet: the writing line
  // as its raw markdown when one is open, every other paragraph as its prose.
  const pageBlocks = pageEditor
    ? Array.from(pageEditor.querySelectorAll("[data-note-block]"))
    : [];
  const pageBody = pageBlocks
    .map((el) => {
      const area = el.querySelector("textarea");
      if (area) return area.value;
      if (el.querySelector(".note-live__placeholder")) return "";
      return el.textContent || "";
    })
    .join("\\n\\n")
    .trim();

  const triggerBox = box(trigger);
  const automationsBox = box(automations);
  const analyzeBox = box(analyze);
  const panelBox = box(panel);
  const footBox = box(foot);

  return {
    path: location.pathname,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyOverflowStyle: document.body.style.overflow,
    pageMounted: Boolean(page),
    railMounted: Boolean(rail),
    pageEditorMounted: Boolean(pageEditor),
    pageEditorOpenLine: Boolean(pageEditor && pageEditor.querySelector("textarea")),
    pageEditorBody: pageEditor ? pageBody : null,
    trigger: trigger
      ? {
          present: true,
          tag: trigger.tagName,
          box: triggerBox,
          centre: centre(triggerBox),
          ariaLabel: trigger.getAttribute("aria-label"),
          titleAttr: trigger.getAttribute("title"),
          text: (trigger.textContent || "").trim(),
          svg: Boolean(trigger.querySelector("svg")),
          // The icon's *own* box, not just its presence: the trigger is icon-only,
          // so an icon squeezed to a sliver by a padding override is a control
          // that looks like an empty square however present the <svg> is.
          svgBox: box(trigger.querySelector("svg")),
          disabled: Boolean(trigger.disabled),
          inHeader: Boolean(header && header.contains(trigger)),
          inTitleRow: Boolean(titleRow && titleRow.contains(trigger)),
          inActions: Boolean(actions && actions.contains(trigger)),
          // The contract's "immediately before the automations": same cluster,
          // with the automations as the very next sibling.
          domImmediatelyBeforeAutomations: Boolean(
            trigger.nextElementSibling && trigger.nextElementSibling === automations
          ),
        }
      : { present: false },
    automations: automations
      ? {
          present: true,
          box: automationsBox,
          centre: centre(automationsBox),
          analyzeBox,
          analyzeTestId: analyze ? analyze.getAttribute("data-testid") : null,
        }
      : { present: false, box: null, centre: null, analyzeBox: null, analyzeTestId: null },
    titleRow: box(titleRow),
    overlay: overlay
      ? {
          present: true,
          className: overlay.className,
          dataFocusOverlay: overlay.hasAttribute("data-focus-overlay"),
          dataSheetOverlay: overlay.hasAttribute("data-sheet-overlay"),
          box: box(overlay),
          position: overlayStyle.position,
          zIndex: overlayStyle.zIndex,
          backdropFilter:
            overlayStyle.backdropFilter || overlayStyle.webkitBackdropFilter || null,
          background: overlayStyle.backgroundColor,
        }
      : null,
    panel: panel
      ? {
          box: panelBox,
          centre: centre(panelBox),
          className: panel.className,
          inOverlay: Boolean(overlay && overlay.contains(panel)),
        }
      : null,
    chrome: chrome
      ? {
          box: box(chrome),
          inPanel: Boolean(panel && panel.contains(chrome)),
          borderBottom: getComputedStyle(chrome).borderBottomWidth,
        }
      : null,
    title: sheetTitle
      ? {
          box: box(sheetTitle),
          centre: centre(box(sheetTitle)),
          text: text(sheetTitle),
          inPanel: Boolean(panel && panel.contains(sheetTitle)),
          topOffset: panelBox ? round(box(sheetTitle).top - panelBox.top) : null,
          className: sheetTitle.className,
          // The sheet's title is the frame's accessible name, not a piece of
          // chrome: it is hidden from view but must still be in the document,
          // because the dialog is labelled by it.
          hiddenFromView: Boolean(
            sheetTitle.classList.contains("visually-hidden") ||
              getComputedStyle(sheetTitle).position === "absolute",
          ),
          // A hidden title paints nothing: its box must not be a visible strip
          // of the panel above the date. "Paints nothing" is read from the
          // rendered box rather than from the class, so a rule that hid the
          // title some other way would still be caught.
          visibleBox: (() => {
            const b = box(sheetTitle);
            if (!b) return null;
            const style = getComputedStyle(sheetTitle);
            const clipped =
              style.overflow === "hidden" &&
              (b.width <= 2 || b.height <= 2 || style.clipPath !== "none");
            return { ...b, clipped: clipped || b.width <= 2 || b.height <= 2 };
          })(),
        }
      : null,
    close: close
      ? {
          box: box(close),
          centre: centre(box(close)),
          ariaLabel: close.getAttribute("aria-label"),
          titleAttr: close.getAttribute("title"),
          inPanel: Boolean(panel && panel.contains(close)),
          topOffset: panelBox ? round(box(close).top - panelBox.top) : null,
        }
      : null,
    body: sheetBody
      ? { box: box(sheetBody), inPanel: Boolean(panel && panel.contains(sheetBody)) }
      : null,
    // The page's heading: the day, centred over the prose.
    pageDate: pageDate
      ? {
          box: box(pageDate),
          centre: centre(box(pageDate)),
          text: text(pageDate),
          inPanel: Boolean(panel && panel.contains(pageDate)),
          tag: pageDate.tagName,
          // The date has to sit above the prose it heads, not under it.
          aboveNote: Boolean(note && box(pageDate).bottom <= box(note).top + 1),
          // It is the page's ONE heading, so it is centred on the page's true
          // centre — the same centre the sheet's own title used to hold.
          centredOnPanel: Boolean(
            panelBox && Math.abs(centre(box(pageDate)).x - panelBox.left - panelBox.width / 2) <= 2,
          ),
          textAlign: getComputedStyle(pageDate).textAlign,
          fontSize: getComputedStyle(pageDate).fontSize,
        }
      : null,
    note: note ? { box: box(note), inPanel: Boolean(panel && panel.contains(note)) } : null,
    // The page's foot: the autosave band and the day's own acts, below the prose.
    foot: foot
      ? {
          box: footBox,
          inPanel: Boolean(panel && panel.contains(foot)),
          belowNote: Boolean(note && footBox.top >= box(note).bottom - 1),
        }
      : null,
    statusLine: statusLine
      ? {
          box: box(statusLine),
          text: text(statusLine),
          inFoot: Boolean(foot && foot.contains(statusLine)),
          // The band is reserved whether or not it has words: a page whose foot
          // changes height when the notification lands jumps under the hand.
          minHeight: getComputedStyle(statusLine).minHeight,
        }
      : null,
    focusActions: focusActions
      ? {
          present: true,
          box: box(focusActions),
          inFoot: Boolean(foot && foot.contains(focusActions)),
          actionBox: box(focusAction),
          actionTestId: focusAction ? focusAction.getAttribute("data-testid") : null,
          actionText: focusAction ? text(focusAction) : null,
          actionDisabled: focusAction ? Boolean(focusAction.disabled) : null,
          actionSvg: focusAction ? Boolean(focusAction.querySelector("svg")) : null,
        }
      : { present: false, box: null, inFoot: false, actionBox: null, actionTestId: null },
    editor: editor
      ? {
          box: box(editor),
          className: editor.className,
          noteLive: editor.classList.contains("note-live"),
          inNote: Boolean(note && note.contains(editor)),
          inPanel: Boolean(panel && panel.contains(editor)),
          inputValue: focusInput ? focusInput.value : null,
        }
      : null,
    focusInput: focusInput
      ? {
          value: focusInput.value,
          focused: document.activeElement === focusInput,
          ariaLabel: focusInput.getAttribute("aria-label"),
        }
      : null,
    noteLiveInsideOverlay: overlay ? overlay.querySelectorAll(".note-live").length : 0,
    writes: (window.dailyNoteWrites ?? []).length,
    unexpectedCalls: [...(window.dailyNoteUnexpectedCalls ?? [])],
  };
})()`;

const states = {};
const steps = {};
const failures = [];

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

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const run = (expression, userGesture = false) =>
    win.webContents.executeJavaScript(expression, userGesture);

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await run(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
    );
    return sample();
  };

  const record = (name, value) => {
    states[name] = value;
    return value;
  };

  const step = (name, value) => {
    steps[name] = value;
    return value;
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, name);
    fs.mkdirSync(artifactsDir, { recursive: true });
    const png = image.toPNG();
    fs.writeFileSync(file, png);
    screenshots.push(name);
    const size = image.getSize();
    return { file: name, bytes: png.length, width: size.width, height: size.height };
  };

  const click = (selector) =>
    run(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`,
      true,
    );

  const overlayPresent = () =>
    run("Boolean(document.querySelector('[data-focus-overlay]'))");

  /** Escape from the body: a real key event bubbles through document to window. */
  const pressEscape = () =>
    run(
      `(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
        );
        return true;
      })()`,
      true,
    );

  /**
   * A real press at a window point: what is under it, and a mousedown on it. The
   * press the sheet's scrim handler answers must start on the overlay itself, so
   * the hit is read and recorded — a press that lands on the panel closes
   * nothing and proves nothing.
   */
  const pressAt = (x, y) =>
    run(
      `(() => {
        const el = document.elementFromPoint(${x}, ${y});
        if (!el) return { hit: null, isOverlay: false, isPanel: false };
        const info = {
          hit: String(el.className || el.tagName),
          tag: el.tagName,
          isOverlay: el.hasAttribute("data-focus-overlay"),
          isPanel: Boolean(el.closest && el.closest(".focus-overlay__panel")),
        };
        el.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: ${x},
            clientY: ${y},
          })
        );
        return info;
      })()`,
      true,
    );

  /** Open focus mode from the page's own trigger, and wait for the sheet to paint. */
  const openFocus = async () => {
    const opened = await click('[data-testid="daily-note-focus"]');
    if (!opened) throw new Error("the page has no focus-mode trigger to press");
    await waitFor(win, "Boolean(document.querySelector('[data-focus-overlay]'))", "focus mode to open");
    return settle();
  };

  /** Close it and wait out the frame's exit motion before sampling the page. */
  const waitClosed = async (label) => {
    await waitFor(
      win,
      "!document.querySelector('[data-focus-overlay]')",
      label,
      EXIT_MS + 5_000,
    );
    return settle();
  };

  /**
   * The modal editor opens the caret on the last paragraph (`autoEdit`). If it
   * is not already open, press a paragraph the way a person would and wait for
   * the writing line.
   */
  const ensureFocusLine = async () => {
    if (await run(`Boolean(document.querySelector('[data-testid="daily-note-focus-editor-input"]'))`)) {
      return true;
    }
    await run(
      `(() => {
        const block = document.querySelector('.focus-overlay__note [data-note-block]');
        if (!block) return false;
        block.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
        );
        return true;
      })()`,
      true,
    );
    await waitFor(
      win,
      "Boolean(document.querySelector('[data-testid=\"daily-note-focus-editor-input\"]'))",
      "the modal editor's writing line",
      4_000,
    );
    return true;
  };

  /**
   * Type into the modal the way a keyboard does: the textarea's own value setter,
   * then the `input` event React listens for. Assigning `value` directly leaves
   * React's state behind and the next render undoes it.
   */
  const typeInFocus = (value) =>
    run(
      `(() => {
        const el = document.querySelector('[data-testid="daily-note-focus-editor-input"]');
        if (!el) return null;
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        ).set;
        setter.call(el, ${JSON.stringify(value)});
        el.setSelectionRange(el.value.length, el.value.length);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return { value: el.value, focused: document.activeElement === el };
      })()`,
      true,
    );

  /**
   * Catch the autosave band while the write is in flight.
   *
   * The page's autosave is a debounce, so the "Saving…" words arrive only in
   * the moment between the last keystroke and the write landing — a rig that
   * sampled once after settling would read the band at rest and never see the
   * notification at all.
   *
   * Two things make this catch work, and both are about the same race:
   *
   *  - The poll is on the band's own text, NOT a full `sample()`. `sample()`
   *    waits on three animation frames, which is slow enough to step straight
   *    over the window the notification lives in and read the band at rest
   *    forever.
   *  - The poll takes the band with it. The words vanish the instant the write
   *    lands, so a poll that saw the words and then called `sample()` would
   *    read the band empty by the time the sample landed — the notification
   *    would be caught and lost in the same breath. So the poll reads the
   *    words and the band's box together, in one call, and returns that.
   */
  const catchSavingBand = async () => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const caught = await run(
        `(() => {
          const el = document.querySelector('[data-testid="focus-overlay-status"]');
          if (!el) return null;
          const text = (el.textContent || "").trim();
          if (!text.includes("Saving") && !text.includes("Not saved")) return null;
          const r = el.getBoundingClientRect();
          const round = (n) => Math.round(n * 100) / 100;
          return {
            text,
            box: {
              left: round(r.left),
              top: round(r.top),
              right: round(r.right),
              bottom: round(r.bottom),
              width: round(r.width),
              height: round(r.height),
            },
            minHeight: getComputedStyle(el).minHeight,
            inFoot: Boolean(el.closest(".focus-overlay__foot")),
          };
        })()`,
      );
      if (caught && caught.text) return caught;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return null;
  };

  /** The day's autosave ledger, read as the write the focus editor's sentence owes. */
  const waitForFocusWrite = (today) =>
    waitFor(
      win,
      `(window.dailyNoteWrites ?? []).some(
        (write) =>
          write &&
          write.date === ${JSON.stringify(today)} &&
          (write.body ?? "").includes(${JSON.stringify(SENTENCE)})
      )`,
      "the sentence typed in focus mode to autosave on the shown day",
      AUTOSAVE_SETTLE_MS + 12_000,
    );

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: { sentence: SENTENCE },
    checks: {},
    states,
    steps,
    screenshots,
    consoleErrors,
    unexpectedCalls: [],
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await waitFor(win, "Boolean(window.dailyNoteReady)", "dailyNoteReady", 30_000);
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const today = await run("window.dailyNoteToday");
    report.checks.today = today;
    if (!today) throw new Error("the harness named no today");

    // 1 — the page as it stands: the trigger in the header's title row, directly
    //     before the automations, and the page it belongs to.
    record("landing", await settle());
    const landing = states.landing;
    if (!landing.trigger.present) throw new Error("the page draws no focus-mode trigger");
    step("triggerPresent", true);

    // 2 — open it from the app, not from a URL: that is how it is reached.
    const openedSample = await openFocus();
    record("opened", openedSample);
    step("openedClick", true);

    // 3 — the cross is a dismissal.
    step("crossClick", await click(".focus-overlay__close"));
    record("closedByCross", await waitClosed("the sheet to leave after the cross"));

    // 4 — a real press on the scrim is another. The point is outside the panel
    //     and already read: it must be the overlay itself, not the panel.
    const reopenedForScrim = await openFocus();
    record("reopenedForScrim", reopenedForScrim);
    if (!reopenedForScrim.panel) throw new Error("the reopened sheet painted no panel to measure");
    const scrimPoint = {
      x: Math.round(reopenedForScrim.panel.box.left / 2),
      y: Math.round(reopenedForScrim.panel.box.top + 40),
    };
    step("scrimPoint", scrimPoint);
    step("scrimHit", await pressAt(scrimPoint.x, scrimPoint.y));
    record("closedByScrim", await waitClosed("the sheet to leave after the scrim press"));

    // 5 — and Escape is the third.
    const reopenedForEscape = await openFocus();
    record("reopenedForEscape", reopenedForEscape);
    step("escapeSent", await pressEscape());
    record("closedByEscape", await waitClosed("the sheet to leave after Escape"));

    // 6 — typing in the modal writes the SAME draft the page holds, for the day
    //     the page is showing, and closing hands that draft back to the page.
    const reopenedForTyping = await openFocus();
    record("reopenedForTyping", reopenedForTyping);
    step("typedLineOpen", await ensureFocusLine());

    // The autosave band, caught while the write is still in flight: the page's
    // foot must show "Saving…" in a band that was already there.
    //
    // The catch runs CONCURRENTLY with the typing, not after it. The band shows
    // its words only while the draft is dirty, and the dirty window is the
    // page's autosave debounce — about 700ms. Typing first and catching after
    // spends a third of that window on the typing's own settle, so the catch
    // can arrive after the write landed and read the band at rest forever.
    // Polling in parallel means the rig is already watching when the words land.
    const savingCatch = catchSavingBand();
    step("typed", await typeInFocus(SENTENCE));
    record("typedModal", await settle());
    if (!states.typedModal.overlay) {
      throw new Error("the modal closed while the sentence was being typed into it");
    }

    const savingSample = await savingCatch;
    if (!savingSample) {
      throw new Error(
        "the saving notification never appeared on the page's foot while a write was in flight",
      );
    }
    record("saving", savingSample);
    step("savingBandText", savingSample.text ?? null);
    step("savingBandHeight", savingSample.box?.height ?? null);
    step("savingBandInFoot", savingSample.inFoot ?? null);
    step("restBandHeight", reopenedForTyping.statusLine?.box?.height ?? null);

    await waitForFocusWrite(today);
    const writes = await run("(window.dailyNoteWrites ?? []).slice()");
    report.checks.writes = writes;
    const written = writes.find(
      (write) => write && write.date === today && (write.body ?? "").includes(SENTENCE),
    );
    step("focusWrite", written ?? null);
    record("savedByFocus", await settle());

    // The picture of the shipped surface: the panel, its centred title and the
    // editor, over the blurred page — captured while the sheet is still up.
    const shotInfo = await shot("daily-note-focus.png");
    step("screenshot", { ...shotInfo, whileOpen: Boolean(states.savedByFocus.overlay) });
    step("screenshotWhileOpen", Boolean(states.savedByFocus.overlay));

    // 7 — close it and hand the draft back to the page behind.
    step("closeAfterTypingSent", await pressEscape());
    record("pageAfterFocus", await waitClosed("the sheet to leave after typing"));

    report.unexpectedCalls = await run(
      "(window.dailyNoteUnexpectedCalls ?? []).slice()",
    );
    report.pass = true;
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }

  report.pass = report.pass && failures.length === 0;

  const reportFile = path.join(artifactsDir, "daily-note-focus.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [
    [
      "state",
      "page",
      "sheet",
      "body-overflow",
      "panel-width",
      "date",
      "foot",
      "band",
      "writes",
    ],
  ];
  for (const [name, state] of Object.entries(states)) {
    // A state can be null when a catch missed its window: the summary table is
    // printed after the report is written, so a crash here would leave a good
    // report behind a non-zero exit — a failure the reader cannot account for.
    if (!state) {
      table.push([name, "—", "—", "—", "—", "—", "—", "—", "—"]);
      continue;
    }
    table.push([
      name,
      state.pageMounted ? "mounted" : "gone",
      state.overlay ? "open" : "closed",
      state.bodyOverflowStyle || "—",
      state.panel ? String(state.panel.box.width) : "—",
      state.pageDate ? String(state.pageDate.text).slice(0, 22) : "—",
      state.foot ? (state.foot.belowNote ? "below" : "above") : "—",
      // The caught band is its own shape (text + box, taken in one poll); the
      // sampled states carry the band under `statusLine`.
      state.statusLine
        ? JSON.stringify(state.statusLine.text)
        : state.text
          ? JSON.stringify(state.text)
          : "—",
      String(state.writes ?? "—"),
    ]);
  }
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((row) => String(row[i]).length)),
  );
  for (const row of table) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
  }

  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "daily note focus: PASS" : "daily note focus: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`daily-note-focus: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
