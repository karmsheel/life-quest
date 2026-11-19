/**
 * Drives the chat dock's reading settings in a real Electron window and turns
 * the layout engine's own measurements into
 * `e2e/artifacts/chat-display.{json,png}`.
 *
 * Two pages, one window, one profile — because the settings belong to the window
 * (localStorage), not the vault, and the whole point is that two surfaces read
 * the same stored pair:
 *
 *  1. `e2e/chat-panel.html?reading=1` — the real ChatPanel and its CSS with the
 *     `ChatDisplayProvider` on top (`?reading=1`, the only flag this rig uses;
 *     the same page without it is what every other rig measures). The transcript
 *     wears the two custom properties the provider publishes on `.chat-panel`:
 *     `--chat-reading-scale` (zoom / 100) and `--chat-reading-line` (the line
 *     spacing). The rig reads the computed font-size and line-height of the
 *     assistant's answer, not the CSS source, so a var the stylesheet forgot to
 *     apply fails here.
 *
 *  2. `e2e/settings-sheet.html` — the real settings sheet, wrapped in the same
 *     `ChatDisplayProvider` (the harness does it; without it the reading page
 *     throws and the sheet blanks). The rig opens Settings → Chat display,
 *     checks the stored 110% is on the page, drives the line-spacing buttons and
 *     the zoom stepper, and proves the preview is drawn with the transcript's
 *     own measures.
 *
 * The shared contract is proved last: after the settings page picks 1.75 line
 * spacing and the dock's keys zoom it to 120%, reloading the chat page must wear
 * exactly that pair — the two surfaces cannot disagree because they read one
 * storage key through one provider.
 *
 * Run with the dev server up on 5173 (the Lead's `lifequest-e2e` wrapper puts
 * THIS checkout there):
 *
 *   node e2e/chat-display.electron.mjs
 *
 * The Ctrl+wheel gesture is dispatched through the DevTools protocol's
 * `Input.dispatchMouseEvent` rather than `webContents.sendInputEvent`. Electron
 * 44 drops a synthesized wheel event's `modifiers` (the page sees `ctrlKey:
 * false` even with `modifiers: ["control"]`, and holding a real Control keyDown
 * does not put it back), so the dock's `closest(".chat-panel")` + `ctrlKey`
 * gesture cannot be driven that way; the DevTools path goes through the same
 * browser input pipeline and does deliver a trusted `WheelEvent` with
 * `ctrlKey: true`. The rig asserts the delivered event's modifiers and reads the
 * modifier from the page's own wheel log, so this is the operator's Ctrl+wheel
 * and not a scripted call into the provider. `modifiers: 2` is CDP's Ctrl bit
 * (Alt 1, Ctrl 2, Meta 4, Shift 8).
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact; the two pictures are the shipped dock and the shipped settings sheet,
 * not mocks.
 *
 * ── every way this could fail, written down before the code ───────────────────
 *
 *  Defaults (the setting the dock ships with)
 *   D1. The transcript keeps the old flat `line-height: 1.45`, so 1.5 is claimed
 *       but not worn: the answer's line-height/font-size ratio is not ≈1.5.
 *   D2. The base message font is not 13px (0.8125rem of a 16px root): the
 *       calc's rem base or the root's size regressed.
 *   D3. The provider's custom properties never reach `.chat-panel`: the zoom
 *       vars are missing (empty), so a rig reading them cannot tell "default"
 *       from "not wired".
 *
 *  Ctrl + wheel (over the dock)
 *   D4. The wheel listener is not registered, is passive, or its
 *       `closest(".chat-panel")` guard rejects the transcript: the gesture does
 *       nothing and the font-size never steps.
 *   D5. The direction is upside down: `deltaY < 0` steps down instead of up.
 *   D6. One wheel event steps more or less than one 10% notch (14.3px at 100%).
 *   D7. The gesture zooms while the pointer is outside the dock — a global wheel
 *       handler would make the whole window a zoom surface.
 *
 *  Ctrl + = / - / 0 (from the keyboard)
 *   D8. The window keydown handler is missing or ignores the modifier: real
 *       keyDown/keyUp events move nothing.
 *   D9. Ctrl+= maps to the wrong key (`Equal`/`Plus`) and the dock never sees
 *       "="; the report records what the page's own key listener received.
 *   D10. Ctrl+0 does not return to 100% and 1.5 line spacing, leaving the dock
 *        at a size the operator cannot undo without the settings page.
 *
 *  Persistence
 *   D11. A step is not written to localStorage (`writeChatDisplaySettings`
 *        missing or effects dropped): the reload forgets the 110%.
 *   D12. The mount does not read it back (`readChatDisplaySettings` or the key
 *        name drifts): the reload wears 100% while storage says 110.
 *
 *  The dock's entrance to the settings page
 *   D13. The bottom action bar's link is missing, is a button without an href, or
 *        its href/route is not `/settings?tab=reading`; the operator has no way
 *        to the page from the surface it changes.
 *   D14. Its accessible name is not "Chat display settings" (aria-label dropped
 *        or replaced by a bare glyph's title).
 *
 *  Settings → Chat display
 *   D15. The page throws or the sheet blanks: the harness mounts `SettingsPage`
 *        without `ChatDisplayProvider`, so `useChatDisplay()` rejects and the
 *        whole sheet unmounts.
 *   D16. The 13th section is not in the nav, the label is not "Chat display", or
 *        the view id is not `reading`: `/settings?tab=reading` falls back to
 *        Appearance.
 *   D17. The page's row labels are missing ("Text size", "Line spacing"): the
 *        section renders but says nothing about its two axes.
 *   D18. The zoom read-back is not the stored 110%: the page reads its own
 *        state instead of the window's settings.
 *   D19. The preview does not follow the chosen size/spacing: it is a static
 *        sample, not the transcript's measures (its data-zoom /
 *        data-line-spacing and computed ratio do not move).
 *   D20. Picking Relaxed writes no line spacing, or writes one the dock cannot
 *        read (2 vs 1.75, number vs string): storage stays 1.5.
 *   D21. Zoom-in does not grow the preview or update the read-back percent.
 *   D22. Reset leaves the page at the old pair instead of 100% / 1.5.
 *
 *  The shared contract
 *   D23. The settings page's choice is not worn by the dock on the next load:
 *        the two surfaces disagree (different key, different normalization), so
 *        the settings page is decoration rather than the dock's settings.
 *
 *  Report / harness
 *   D24. The driver throws or hangs: the failure lands in the report with the
 *        marks it reached, and the process exits non-zero.
 *   D25. A screenshot is missing or empty: both PNGs are written through
 *        `capturePage` and checked to exist with bytes.
 *   D26. `report.pass` and the exit code disagree: both are derived from
 *        `failures`, and the wrapper re-reads them.
 *
 * Every check is named, and every failure lands in `report.failures` with its
 * measured numbers, so a regression names the field it broke rather than just
 * "the reading settings failed".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/chat-panel.html?reading=1";
const settingsUrl =
  process.env.LIFEQUEST_E2E_SETTINGS_URL ??
  "http://127.0.0.1:5173/e2e/settings-sheet.html";

/**
 * This rig's own Electron profile, wiped before every run.
 *
 * The reading settings live in localStorage, which is per profile — and the
 * other rigs' profiles live under `artifacts/userdata/` between runs. A profile
 * that still carried last run's 120% would make "the dock ships at 100%" a
 * measurement of an old run. The directory is deleted first, so the first load
 * always sees an empty storage and the shipped defaults.
 */
const userDataDir = path.join(artifactsDir, "userdata", "chat-display");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

/** Wide enough for the dock's default column, tall enough for a full transcript. */
const WINDOW = { width: 1280, height: 900 };

/** The reading measures the feature contract fixes. */
const BASE_FONT_PX = 13;
const DEFAULT_RATIO = 1.5;
const RELAXED_RATIO = 1.75;
const ZOOM_STEP = 10;
/** A font-size is measured from a computed length; a tenth of a px is enough. */
const FONT_TOLERANCE_PX = 0.4;
/** line-height / font-size is a ratio of two computed lengths. */
const RATIO_TOLERANCE = 0.05;

/** Where the two surfaces keep the pair, and the pair they start from. */
const STORAGE_KEY = "lifequest-chat-display";

const DOCK_PNG = "chat-display-dock.png";
const SETTINGS_PNG = "chat-display-settings.png";

/** The font a zoom of `percent` should draw the transcript at. */
const expectedFontPx = (percent) =>
  Math.round(((BASE_FONT_PX * percent) / 100) * 100) / 100;

/**
 * The chat page's snapshot: the custom properties the dock publishes, the
 * assistant answer's computed type (the prose the operator reads), the dock's
 * settings link and the window's stored pair — one read from one layout pass.
 */
const CHAT_SAMPLE = `(() => {
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const px = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };
  const panel = document.querySelector(".chat-panel");
  if (!panel) return null;
  const answer = document.querySelector(
    ".chat-panel__message--assistant .chat-panel__message-content"
  );
  const link = document.querySelector('[data-testid="chat-display-settings"]');
  const panelStyle = getComputedStyle(panel);
  const answerStyle = answer ? getComputedStyle(answer) : null;
  const fontPx = answerStyle ? px(answerStyle.fontSize) : null;
  const linePx = answerStyle ? px(answerStyle.lineHeight) : null;
  const panelRect = panel.getBoundingClientRect();
  let stored = null;
  try {
    const raw = window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = "unreadable";
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    chatSurface: panel.getAttribute("data-chat-surface"),
    panel: {
      left: round(panelRect.left),
      top: round(panelRect.top),
      right: round(panelRect.right),
      bottom: round(panelRect.bottom),
      width: round(panelRect.width),
      height: round(panelRect.height)
    },
    readingScale: (panelStyle.getPropertyValue("--chat-reading-scale") || "").trim(),
    readingLine: (panelStyle.getPropertyValue("--chat-reading-line") || "").trim(),
    answer:
      fontPx !== null && linePx !== null
        ? {
            fontPx,
            linePx,
            ratio: round(linePx / fontPx),
            text: (answer.textContent || "").trim()
          }
        : null,
    answerRows: document.querySelectorAll(".chat-panel__message--assistant").length,
    stored,
    link: link
      ? {
          present: true,
          tag: link.tagName,
          ariaLabel: link.getAttribute("aria-label"),
          title: link.getAttribute("title"),
          href: link.getAttribute("href"),
          insideActionBar: Boolean(link.closest(".chat-panel__actions"))
        }
      : null,
    keyLog: (window.__lqChatDisplayKeys || []).slice(-8),
    wheelLog: (window.__lqChatDisplayWheels || []).slice(-8)
  };
})()`;

/**
 * The settings page's snapshot: the view the sheet is showing, the reading
 * page's own read-back (percent, line buttons), the preview's data attributes
 * and computed prose type, and the window's stored pair.
 */
const SETTINGS_SAMPLE = `(() => {
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const px = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const viewEl = document.querySelector("[data-settings-view]");
  // The reading page is the only one that draws the preview; without it the
  // sheet is on another page and the reading numbers below are nulls.
  const preview = document.querySelector('[data-testid="chat-display-preview"]');
  const prose = preview
    ? preview.querySelector(".chat-display-preview__prose")
    : null;
  const proseStyle = prose ? getComputedStyle(prose) : null;
  const fontPx = proseStyle ? px(proseStyle.fontSize) : null;
  const linePx = proseStyle ? px(proseStyle.lineHeight) : null;
  const zoomValueEl = document.querySelector('[data-testid="chat-display-zoom-value"]');
  const zoomInEl = document.querySelector('[data-testid="chat-display-zoom-in"]');
  const zoomOutEl = document.querySelector('[data-testid="chat-display-zoom-out"]');
  const resetEl = document.querySelector('[data-testid="chat-display-reset"]');
  const labels = Array.from(document.querySelectorAll(".settings-card__label")).map(
    (el) => text(el)
  );
  const nav = Array.from(document.querySelectorAll(".settings-nav-item")).map((el) => ({
    label: text(el.querySelector(".settings-nav-item__label")),
    active: el.classList.contains("is-active")
  }));
  const lineButtons = Array.from(
    document.querySelectorAll('[data-testid^="chat-display-line-"]')
  ).map((el) => ({
    testid: el.getAttribute("data-testid"),
    value: el.getAttribute("data-value"),
    pressed: el.getAttribute("aria-pressed"),
    active: el.classList.contains("is-active"),
    label: text(el)
  }));
  let stored = null;
  try {
    const raw = window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = "unreadable";
  }
  return {
    view: viewEl ? viewEl.getAttribute("data-settings-view") : null,
    panelTitle: text(document.querySelector(".settings-panel__title")),
    navLabels: nav.map((row) => row.label),
    navChatDisplayActive: nav.some(
      (row) => row.label === "Chat display" && row.active
    ),
    labels,
    zoom: {
      value: zoomValueEl ? text(zoomValueEl) : null,
      inPresent: Boolean(zoomInEl),
      outPresent: Boolean(zoomOutEl),
      resetPresent: Boolean(resetEl),
      inDisabled: zoomInEl ? zoomInEl.disabled : null,
      outDisabled: zoomOutEl ? zoomOutEl.disabled : null
    },
    preview: preview
      ? {
          present: true,
          dataZoom: preview.getAttribute("data-zoom"),
          dataLineSpacing: preview.getAttribute("data-line-spacing"),
          readingScale: (
            getComputedStyle(preview).getPropertyValue("--chat-reading-scale") || ""
          ).trim(),
          readingLine: (
            getComputedStyle(preview).getPropertyValue("--chat-reading-line") || ""
          ).trim(),
          proseFontPx: fontPx,
          proseLinePx: linePx,
          proseRatio:
            fontPx !== null && linePx !== null ? round(linePx / fontPx) : null
        }
      : null,
    lineButtons,
    stored
  };
})()`;

const failures = [];
const marks = [];
const startedAt = Date.now();
const mark = (label) => marks.push({ ms: Date.now() - startedAt, label });

const check = (label, condition, detail) => {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}: ${detail}`);
  return ok;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const near = (value, expected, tolerance) =>
  typeof value === "number" && Math.abs(value - expected) <= tolerance;

/** Step one line-spacing button or zoom control, the way a hand clicks it. */
const CLICK = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.click();
  return true;
})()`;

const CLICK_NAV = (label) => `(() => {
  const el = Array.from(document.querySelectorAll(".settings-nav-item")).find(
    (item) =>
      (((item.querySelector(".settings-nav-item__label") || {}).textContent) || "").trim() ===
      ${JSON.stringify(label)}
  );
  if (!el) return false;
  el.click();
  return true;
})()`;

/** Wait on a page predicate: a real wait, never a fixed sleep. */
async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The app's own default theme, so a test run is not a white sheet flashing
  // across the operator's screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers; painting is switched on
    // above, and throttling off here.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const frames = () =>
    run(
      "(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; })()",
    );

  const waitFor = async (expression, budget = 8_000) => {
    const deadline = Date.now() + budget;
    for (;;) {
      try {
        if (await run(`Boolean(${expression})`)) return true;
      } catch {
        // A page mid-navigation has no document yet; keep waiting rather than
        // turning a load into a failure.
      }
      if (Date.now() >= deadline) return false;
      await sleep(100);
    }
  };

  /**
   * The page's own input log, so a failure can say whether the real input event
   * reached the page at all — "Ctrl+0 did nothing" is ambiguous without it.
   */
  const installInputLog = () =>
    run(`(() => {
      window.__lqChatDisplayKeys = [];
      window.__lqChatDisplayWheels = [];
      window.addEventListener("keydown", (event) => {
        window.__lqChatDisplayKeys.push({
          key: event.key,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          alt: event.altKey,
          defaultPrevented: event.defaultPrevented
        });
      }, true);
      window.addEventListener("wheel", (event) => {
        window.__lqChatDisplayWheels.push({
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          deltaY: event.deltaY,
          // The class the wheel landed on: proof the in-dock event hit the
          // dock's own listener target and did not just scroll the page.
          target:
            event.target && event.target.className
              ? String(event.target.className).slice(0, 60)
              : null,
          defaultPrevented: event.defaultPrevented
        });
      }, true);
      return true;
    })()`);

  const readChat = async (label) => {
    const value = await run(CHAT_SAMPLE);
    if (!value) throw new Error(`${label}: the dock page returned no sample`);
    return value;
  };

  const readSettings = async (label) => {
    const value = await run(SETTINGS_SAMPLE);
    if (!value) throw new Error(`${label}: the settings page returned no sample`);
    return value;
  };

  /** The dock's computed reading scale, as the wait predicate for a gesture. */
  const scaleIs = (scale) => `(() => {
    const panel = document.querySelector(".chat-panel");
    if (!panel) return false;
    return (getComputedStyle(panel).getPropertyValue("--chat-reading-scale") || "").trim() ===
      ${JSON.stringify(scale)};
  })()`;

  const zoomValueIs = (value) => `(() => {
    const el = document.querySelector('[data-testid="chat-display-zoom-value"]');
    return Boolean(el) && ((el.textContent || "").trim()) === ${JSON.stringify(value)};
  })()`;

  const previewLineIs = (value) => `(() => {
    const el = document.querySelector('[data-testid="chat-display-preview"]');
    return Boolean(el) && el.getAttribute("data-line-spacing") === ${JSON.stringify(value)};
  })()`;

  const previewZoomIs = (value) => `(() => {
    const el = document.querySelector('[data-testid="chat-display-preview"]');
    return Boolean(el) && el.getAttribute("data-zoom") === ${JSON.stringify(value)};
  })()`;

  /**
   * Load the chat harness page and wait for its ready flag, its transcript rows
   * and the input log. Called for the first load and for the reload leg, so the
   * two cannot drift.
   */
  const loadChatPage = async () => {
    await win.loadURL(url);
    await waitFor("Boolean(window.chatPanelHarnessReady)", 15_000);
    await run("window.chatPanelHarnessReady.then(() => true)");
    await installInputLog();
    await waitFor(
      `document.querySelector(".chat-panel__message--assistant .chat-panel__message-content") !== null`,
      10_000,
    );
    await frames();
  };

  /**
   * Load the settings harness page, open the sheet over the rig page, and switch
   * it to Settings → Chat display. Returns the two presses for the report.
   */
  const loadSettingsPage = async () => {
    await win.loadURL(settingsUrl);
    await waitFor("Boolean(window.settingsSheetReady)", 15_000);
    await run("window.settingsSheetReady.then(() => true)");
    await waitFor(`document.querySelector("[data-rig-open-settings]") !== null`, 10_000);
    const opened = await run(CLICK("[data-rig-open-settings]"));
    await waitFor(`document.querySelector(".settings-overlay__panel") !== null`, 10_000);
    const clicked = await run(CLICK_NAV("Chat display"));
    await waitFor(
      `document.querySelector('[data-testid="chat-display-preview"]') !== null`,
      10_000,
    );
    await frames();
    return { opened, clicked };
  };

  /**
   * A real Ctrl+wheel through Chromium's own input pipeline.
   *
   * `webContents.sendInputEvent({ type: "mouseWheel", modifiers: ["control"] })`
   * was the first thing tried: on Electron 44 the page receives a trusted wheel
   * event with `ctrlKey: false`, so the dock's gesture cannot be driven through
   * it. The DevTools `Input.dispatchMouseEvent` command goes through the same
   * pipeline and does carry the modifier — the wheel log below proves the page
   * saw `ctrlKey: true`, and the dock zooms the way it does for a real wheel.
   * `deltaY` is negative for a scroll up (zoom in), matching the DOM event the
   * dock's listener branches on.
   */
  const wheelWithCtrl = async (point, deltaY) => {
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: 0,
      deltaY,
      modifiers: 2,
      pointerType: "mouse",
    });
    await sleep(80);
    await frames();
  };

  /** A real keystroke with Ctrl held: keyDown, then keyUp. */
  const pressCtrl = async (keyCode) => {
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode,
      modifiers: ["control"],
    });
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "keyUp",
      keyCode,
      modifiers: ["control"],
    });
    await sleep(140);
    await frames();
  };

  /** Focus a window so the real key events land in it. */
  const focusWindow = async () => {
    win.show();
    win.focus();
    win.webContents.focus();
    await sleep(250);
  };

  const capture = async (file) => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(file, image.toPNG());
    return { path: file, bytes: fs.statSync(file).size };
  };

  let report = null;
  let defaults = null;
  let wheelOutside = null;
  let wheelUp = null;
  let wheelDown = null;
  let keyPlus = null;
  let keyMinus = null;
  let keyZero = null;
  let persistenceBefore = null;
  let persistenceAfter = null;
  let dockLink = null;
  let settingsSheet = null;
  let settingsOpened = null;
  let settingsRelaxed = null;
  let settingsZoomed = null;
  let settingsReset = null;
  let settingsFinal = null;
  let contract = null;
  let dockArtifact = null;
  let settingsArtifact = null;
  let settingsArtifactSheet = null;

  const timeout = setTimeout(() => {
    // A hang must still leave an artifact that says where it hung: the wrapper
    // reads `failures` and the marks say which step never settled.
    fs.writeFileSync(
      path.join(artifactsDir, "chat-display.json"),
      `${JSON.stringify(
        {
          url,
          settingsUrl,
          ranAt: new Date().toISOString(),
          window: WINDOW,
          marks,
          failures: [...failures, "timed out after 150s"],
          pass: false,
        },
        null,
        2,
      )}\n`,
    );
    console.error("chat-display: timed out after 150s");
    app.exit(1);
  }, 150_000);

  try {
    // ── the chat dock, at its shipped reading settings ──────────────────────
    await loadChatPage();
    mark("chat-loaded");

    win.setContentSize(WINDOW.width, WINDOW.height);
    await sleep(250);
    win.showInactive();
    // Real input events (wheel, keys) are delivered to the page's focused
    // window; the dock-chrome rig proved the same for the rename field.
    await focusWindow();
    // The Ctrl+wheel leg needs the DevTools protocol (see the header): attach
    // once, before the first wheel is dispatched.
    try {
      win.webContents.debugger.attach("1.3");
      mark("input-attached");
    } catch (error) {
      failures.push(
        `wheel:input: could not attach the DevTools protocol for Ctrl+wheel ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }

    defaults = await readChat("defaults");
    mark("defaults");

    check(
      "default:answer-present",
      defaults.answer !== null,
      "the dock's assistant answer did not render, so there is no prose to measure",
    );
    check(
      "default:font-size",
      defaults.answer !== null &&
        near(defaults.answer.fontPx, BASE_FONT_PX, FONT_TOLERANCE_PX),
      `the answer's font-size is ${
        defaults.answer ? defaults.answer.fontPx : "?"
      }px, expected ${BASE_FONT_PX}px`,
    );
    check(
      "default:line-ratio",
      defaults.answer !== null &&
        near(defaults.answer.ratio, DEFAULT_RATIO, RATIO_TOLERANCE),
      `the answer's line-height/font-size is ${
        defaults.answer ? defaults.answer.ratio : "?"
      }, expected ${DEFAULT_RATIO} (a flat 1.45 line-height shows up here)`,
    );
    check(
      "default:reading-scale",
      defaults.readingScale === "1",
      `--chat-reading-scale is ${JSON.stringify(
        defaults.readingScale,
      )} on .chat-panel, expected "1"`,
    );
    check(
      "default:reading-line",
      defaults.readingLine === String(DEFAULT_RATIO),
      `--chat-reading-line is ${JSON.stringify(
        defaults.readingLine,
      )} on .chat-panel, expected "${DEFAULT_RATIO}"`,
    );

    // ── Ctrl + wheel: one notch per event, only over the dock ───────────────
    if (!defaults.panel) {
      failures.push("wheel:point: the dock's box was not measurable");
    } else {
      const panel = defaults.panel;
      const wheelPoint = {
        x: (panel.left + panel.right) / 2,
        y: (panel.top + panel.bottom) / 2,
      };

      // D7 — a Ctrl-wheel outside the dock must not zoom it: the listener is the
      // dock's gesture, not the window's.
      await wheelWithCtrl({ x: 2, y: 2 }, -120);
      wheelOutside = await readChat("wheel-outside");
      check(
        "wheel:outside-dock-ignored",
        wheelOutside.readingScale === "1",
        `Ctrl+wheel outside the dock changed --chat-reading-scale to ${JSON.stringify(
          wheelOutside.readingScale,
        )}`,
      );

      // D4, D5, D6 — one event, one 10% notch up: font 13 → 14.3.
      await wheelWithCtrl(wheelPoint, -120);
      const steppedUp = await waitFor(scaleIs("1.1"), 5_000);
      wheelUp = await readChat("wheel-up");
      mark("wheel-up");
      // The delivered event really carried Ctrl and was the in-dock wheel: the
      // rig proves the gesture, not a scripted call into the provider.
      const wheelLog = wheelUp.wheelLog || [];
      const deliveredWheel = wheelLog[wheelLog.length - 1] ?? null;
      check(
        "wheel:ctrl-delivered",
        deliveredWheel !== null &&
          deliveredWheel.ctrl === true &&
          deliveredWheel.deltaY < 0,
        `the last wheel the page saw was ${JSON.stringify(
          deliveredWheel,
        )}, expected a trusted Ctrl+wheel-up (log: ${JSON.stringify(wheelLog)})`,
      );
      check(
        "wheel:up-reaches-scale",
        steppedUp && wheelUp.readingScale === "1.1",
        `Ctrl+wheel up left --chat-reading-scale at ${JSON.stringify(
          wheelUp.readingScale,
        )} after 5s (wheels seen: ${JSON.stringify(wheelUp.wheelLog)})`,
      );
      check(
        "wheel:up-one-step",
        wheelUp.answer !== null &&
          near(wheelUp.answer.fontPx, expectedFontPx(110), FONT_TOLERANCE_PX),
        `one Ctrl+wheel-up event drew the answer at ${
          wheelUp.answer ? wheelUp.answer.fontPx : "?"
        }px, expected one 10% step (${expectedFontPx(110)}px)`,
      );
      check(
        "wheel:up-keeps-line-ratio",
        wheelUp.answer !== null &&
          near(wheelUp.answer.ratio, DEFAULT_RATIO, RATIO_TOLERANCE),
        `wheel zoom changed the line ratio to ${
          wheelUp.answer ? wheelUp.answer.ratio : "?"
        } (expected ${DEFAULT_RATIO})`,
      );

      // The same gesture down takes it back: 110 → 100.
      await wheelWithCtrl(wheelPoint, 120);
      const steppedDown = await waitFor(scaleIs("1"), 5_000);
      wheelDown = await readChat("wheel-down");
      mark("wheel-down");
      check(
        "wheel:down-reaches-scale",
        steppedDown && wheelDown.readingScale === "1",
        `Ctrl+wheel down left --chat-reading-scale at ${JSON.stringify(
          wheelDown.readingScale,
        )} after 5s`,
      );
      check(
        "wheel:down-decreases",
        wheelDown.answer !== null && near(wheelDown.answer.fontPx, BASE_FONT_PX, FONT_TOLERANCE_PX),
        `Ctrl+wheel down drew the answer at ${
          wheelDown.answer ? wheelDown.answer.fontPx : "?"
        }px, expected back to ${BASE_FONT_PX}px`,
      );
    }

    // ── Ctrl + = / - / 0 ─────────────────────────────────────────────────────
    await focusWindow();
    const beforeKeys = await readChat("keys-baseline");
    check(
      "keys:baseline",
      beforeKeys.readingScale === "1",
      `the keyboard leg starts at --chat-reading-scale ${JSON.stringify(
        beforeKeys.readingScale,
      )}, expected "1"`,
    );

    await pressCtrl("=");
    const plusArrived = await waitFor(scaleIs("1.1"), 5_000);
    keyPlus = await readChat("key-plus");
    mark("key-plus");
    check(
      "keys:ctrl-equals-increases",
      plusArrived && keyPlus.readingScale === "1.1",
      `Ctrl+= left --chat-reading-scale at ${JSON.stringify(
        keyPlus.readingScale,
      )} after 5s; the page's key log was ${JSON.stringify(keyPlus.keyLog)}`,
    );
    check(
      "keys:ctrl-equals-font",
      keyPlus.answer !== null &&
        near(keyPlus.answer.fontPx, expectedFontPx(110), FONT_TOLERANCE_PX),
      `Ctrl+= drew the answer at ${
        keyPlus.answer ? keyPlus.answer.fontPx : "?"
      }px, expected ${expectedFontPx(110)}px`,
    );

    await pressCtrl("-");
    const minusArrived = await waitFor(scaleIs("1"), 5_000);
    keyMinus = await readChat("key-minus");
    mark("key-minus");
    check(
      "keys:ctrl-minus-decreases",
      minusArrived && keyMinus.readingScale === "1",
      `Ctrl+- left --chat-reading-scale at ${JSON.stringify(
        keyMinus.readingScale,
      )}; the page's key log was ${JSON.stringify(keyMinus.keyLog)}`,
    );

    // Reset from a zoomed state, not from 100%: Ctrl+0 has to undo a step.
    await pressCtrl("=");
    await waitFor(scaleIs("1.1"), 5_000);
    await pressCtrl("=");
    await waitFor(scaleIs("1.2"), 5_000);
    const zoomedForReset = await readChat("key-zoomed");
    check(
      "keys:zoomed-before-reset",
      zoomedForReset.readingScale === "1.2",
      `two Ctrl+= presses reached ${JSON.stringify(
        zoomedForReset.readingScale,
      )}, expected "1.2" before the reset`,
    );
    await pressCtrl("0");
    const zeroArrived = await waitFor(scaleIs("1"), 5_000);
    keyZero = await readChat("key-zero");
    mark("key-zero");
    check(
      "keys:ctrl-zero-resets",
      zeroArrived && keyZero.readingScale === "1",
      `Ctrl+0 left --chat-reading-scale at ${JSON.stringify(
        keyZero.readingScale,
      )}; the page's key log was ${JSON.stringify(keyZero.keyLog)}`,
    );
    check(
      "keys:ctrl-zero-font",
      keyZero.answer !== null && near(keyZero.answer.fontPx, BASE_FONT_PX, FONT_TOLERANCE_PX),
      `Ctrl+0 drew the answer at ${
        keyZero.answer ? keyZero.answer.fontPx : "?"
      }px, expected ${BASE_FONT_PX}px`,
    );
    check(
      "keys:ctrl-zero-line-ratio",
      keyZero.answer !== null &&
        near(keyZero.answer.ratio, DEFAULT_RATIO, RATIO_TOLERANCE),
      `Ctrl+0 left the line ratio at ${
        keyZero.answer ? keyZero.answer.ratio : "?"
      }, expected ${DEFAULT_RATIO}`,
    );

    // ── persistence: the window remembers the size it was left at ───────────
    await pressCtrl("=");
    await waitFor(scaleIs("1.1"), 5_000);
    persistenceBefore = await readChat("persistence-before");
    mark("persistence-before");
    check(
      "persistence:written",
      persistenceBefore.stored !== null &&
        typeof persistenceBefore.stored === "object" &&
        persistenceBefore.stored.zoom === 110,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(
        persistenceBefore.stored,
      )} after stepping to 110%`,
    );

    await loadChatPage();
    mark("reloaded");
    persistenceAfter = await readChat("persistence-after");
    check(
      "persistence:reload-keeps-scale",
      persistenceAfter.readingScale === "1.1",
      `after reload --chat-reading-scale is ${JSON.stringify(
        persistenceAfter.readingScale,
      )}, expected "1.1" from localStorage`,
    );
    check(
      "persistence:reload-keeps-font",
      persistenceAfter.answer !== null &&
        near(persistenceAfter.answer.fontPx, expectedFontPx(110), FONT_TOLERANCE_PX),
      `after reload the answer is drawn at ${
        persistenceAfter.answer ? persistenceAfter.answer.fontPx : "?"
      }px, expected ${expectedFontPx(110)}px`,
    );

    // ── the dock's door to Settings → Chat display ──────────────────────────
    dockLink = persistenceAfter.link;
    check(
      "dock-link:present",
      dockLink !== null && dockLink.present === true,
      "the dock's bottom action bar has no [data-testid=\"chat-display-settings\"] link",
    );
    check(
      "dock-link:accessible-name",
      dockLink !== null && dockLink.ariaLabel === "Chat display settings",
      `the link's accessible name is ${JSON.stringify(
        dockLink ? dockLink.ariaLabel : null,
      )}, expected "Chat display settings"`,
    );
    check(
      "dock-link:href",
      dockLink !== null &&
        typeof dockLink.href === "string" &&
        dockLink.href.startsWith("/settings") &&
        dockLink.href.includes("tab=reading"),
      `the link's href is ${JSON.stringify(
        dockLink ? dockLink.href : null,
      )}, expected a route to /settings?tab=reading`,
    );
    check(
      "dock-link:in-action-bar",
      dockLink !== null && dockLink.insideActionBar === true,
      "the link is not in the dock's bottom action bar, where its siblings are",
    );

    // ── Settings → Chat display ─────────────────────────────────────────────
    settingsSheet = await loadSettingsPage();
    mark("settings-loaded");
    settingsOpened = await readSettings("settings-opened");

    check(
      "settings:sheet-opened",
      settingsSheet.opened === true,
      "the settings sheet could not be opened from the harness page",
    );
    check(
      "settings:nav-clicked",
      settingsSheet.clicked === true,
      "no nav item labelled \"Chat display\" could be pressed",
    );
    check(
      "settings:view",
      settingsOpened.view === "reading",
      `the sheet is showing ${JSON.stringify(settingsOpened.view)}, expected "reading"`,
    );
    check(
      "settings:nav-active",
      settingsOpened.navChatDisplayActive === true,
      `the nav's active row is not "Chat display" (${JSON.stringify(
        settingsOpened.navLabels,
      )})`,
    );
    check(
      "settings:labels",
      settingsOpened.labels.includes("Text size") &&
        settingsOpened.labels.includes("Line spacing"),
      `the page's row labels are ${JSON.stringify(
        settingsOpened.labels,
      )}, expected "Text size" and "Line spacing"`,
    );
    // D18 — the page reads the window's stored pair, not a fresh default.
    check(
      "settings:zoom-read-back",
      settingsOpened.zoom.value === "110%",
      `the zoom read-back is ${JSON.stringify(
        settingsOpened.zoom.value,
      )}, expected the stored "110%"`,
    );
    check(
      "settings:controls",
      settingsOpened.zoom.inPresent &&
        settingsOpened.zoom.outPresent &&
        settingsOpened.zoom.resetPresent,
      `the zoom controls are ${JSON.stringify(settingsOpened.zoom)}`,
    );
    check(
      "settings:preview-attributes",
      settingsOpened.preview !== null &&
        settingsOpened.preview.dataZoom === "110" &&
        settingsOpened.preview.dataLineSpacing === String(DEFAULT_RATIO),
      `the preview's attributes are zoom=${JSON.stringify(
        settingsOpened.preview ? settingsOpened.preview.dataZoom : null,
      )} line=${JSON.stringify(
        settingsOpened.preview ? settingsOpened.preview.dataLineSpacing : null,
      )}, expected 110 / ${DEFAULT_RATIO}`,
    );
    check(
      "settings:preview-font",
      settingsOpened.preview !== null &&
        near(settingsOpened.preview.proseFontPx, expectedFontPx(110), FONT_TOLERANCE_PX),
      `the preview's prose is ${
        settingsOpened.preview ? settingsOpened.preview.proseFontPx : "?"
      }px, expected ${expectedFontPx(110)}px`,
    );
    check(
      "settings:preview-ratio",
      settingsOpened.preview !== null &&
        near(settingsOpened.preview.proseRatio, DEFAULT_RATIO, RATIO_TOLERANCE),
      `the preview's line ratio is ${
        settingsOpened.preview ? settingsOpened.preview.proseRatio : "?"
      }, expected ${DEFAULT_RATIO}`,
    );

    // ── Relaxed (1.75): the page writes it and the preview wears it ─────────
    const relaxedPressed = await run(CLICK('[data-testid="chat-display-line-relaxed"]'));
    const relaxedArrived = await waitFor(previewLineIs(String(RELAXED_RATIO)), 5_000);
    settingsRelaxed = await readSettings("settings-relaxed");
    mark("settings-relaxed");
    const relaxedButton = settingsRelaxed.lineButtons.find(
      (button) => button.testid === "chat-display-line-relaxed",
    );
    check(
      "settings:relaxed-clicked",
      relaxedPressed === true,
      "the Relaxed line-spacing button could not be pressed",
    );
    check(
      "settings:relaxed-preview-line",
      relaxedArrived &&
        settingsRelaxed.preview !== null &&
        settingsRelaxed.preview.dataLineSpacing === String(RELAXED_RATIO),
      `pressing Relaxed left the preview at line spacing ${JSON.stringify(
        settingsRelaxed.preview ? settingsRelaxed.preview.dataLineSpacing : null,
      )}, expected ${RELAXED_RATIO}`,
    );
    check(
      "settings:relaxed-preview-ratio",
      settingsRelaxed.preview !== null &&
        near(settingsRelaxed.preview.proseRatio, RELAXED_RATIO, RATIO_TOLERANCE),
      `the preview's line ratio is ${
        settingsRelaxed.preview ? settingsRelaxed.preview.proseRatio : "?"
      }, expected ${RELAXED_RATIO}`,
    );
    check(
      "settings:relaxed-stored",
      settingsRelaxed.stored !== null &&
        typeof settingsRelaxed.stored === "object" &&
        settingsRelaxed.stored.lineSpacing === RELAXED_RATIO,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(
        settingsRelaxed.stored,
      )} after pressing Relaxed`,
    );
    check(
      "settings:relaxed-button-state",
      Boolean(relaxedButton) &&
        relaxedButton.pressed === "true" &&
        relaxedButton.active === true,
      `the Relaxed button is ${JSON.stringify(relaxedButton)}`,
    );

    // ── zoom-in: the preview grows and the read-back follows ────────────────
    const relaxedFont = settingsRelaxed.preview ? settingsRelaxed.preview.proseFontPx : null;
    const zoomInPressed = await run(CLICK('[data-testid="chat-display-zoom-in"]'));
    const zoomInArrived = await waitFor(zoomValueIs("120%"), 5_000);
    const zoomInPreviewArrived = await waitFor(previewZoomIs("120"), 5_000);
    settingsZoomed = await readSettings("settings-zoomed");
    mark("settings-zoomed");
    check(
      "settings:zoom-in-clicked",
      zoomInPressed === true,
      "the zoom-in control could not be pressed",
    );
    check(
      "settings:zoom-in-read-back",
      zoomInArrived && settingsZoomed.zoom.value === "120%",
      `the zoom read-back is ${JSON.stringify(
        settingsZoomed.zoom.value,
      )} after pressing +, expected "120%"`,
    );
    check(
      "settings:zoom-in-preview-grows",
      zoomInPreviewArrived &&
        settingsZoomed.preview !== null &&
        relaxedFont !== null &&
        settingsZoomed.preview.proseFontPx > relaxedFont + 0.5 &&
        near(settingsZoomed.preview.proseFontPx, expectedFontPx(120), FONT_TOLERANCE_PX),
      `the preview's prose went from ${relaxedFont}px to ${
        settingsZoomed.preview ? settingsZoomed.preview.proseFontPx : "?"
      }px, expected ${expectedFontPx(120)}px`,
    );
    check(
      "settings:zoom-in-keeps-line",
      settingsZoomed.preview !== null &&
        near(settingsZoomed.preview.proseRatio, RELAXED_RATIO, RATIO_TOLERANCE),
      `zooming changed the preview's line ratio to ${
        settingsZoomed.preview ? settingsZoomed.preview.proseRatio : "?"
      }, expected ${RELAXED_RATIO}`,
    );

    // ── Reset: back to 100% / 1.5 ───────────────────────────────────────────
    const resetPressed = await run(CLICK('[data-testid="chat-display-reset"]'));
    const resetArrived = await waitFor(
      `(() => {
        const zoom = document.querySelector('[data-testid="chat-display-zoom-value"]');
        const preview = document.querySelector('[data-testid="chat-display-preview"]');
        return Boolean(zoom) && Boolean(preview) &&
          ((zoom.textContent || "").trim()) === "100%" &&
          preview.getAttribute("data-line-spacing") === "1.5";
      })()`,
      5_000,
    );
    settingsReset = await readSettings("settings-reset");
    mark("settings-reset");
    check(
      "settings:reset-clicked",
      resetPressed === true,
      "the reset control could not be pressed",
    );
    check(
      "settings:reset-read-back",
      resetArrived && settingsReset.zoom.value === "100%",
      `the zoom read-back is ${JSON.stringify(
        settingsReset.zoom.value,
      )} after reset, expected "100%"`,
    );
    check(
      "settings:reset-line",
      settingsReset.preview !== null &&
        settingsReset.preview.dataLineSpacing === String(DEFAULT_RATIO),
      `reset left the preview at line spacing ${JSON.stringify(
        settingsReset.preview ? settingsReset.preview.dataLineSpacing : null,
      )}, expected ${DEFAULT_RATIO}`,
    );
    check(
      "settings:reset-preview",
      settingsReset.preview !== null &&
        near(settingsReset.preview.proseFontPx, BASE_FONT_PX, FONT_TOLERANCE_PX) &&
        near(settingsReset.preview.proseRatio, DEFAULT_RATIO, RATIO_TOLERANCE),
      `reset left the preview at ${
        settingsReset.preview ? settingsReset.preview.proseFontPx : "?"
      }px / ${
        settingsReset.preview ? settingsReset.preview.proseRatio : "?"
      } ratio, expected ${BASE_FONT_PX}px / ${DEFAULT_RATIO}`,
    );
    check(
      "settings:reset-stored",
      settingsReset.stored !== null &&
        typeof settingsReset.stored === "object" &&
        settingsReset.stored.zoom === 100 &&
        settingsReset.stored.lineSpacing === DEFAULT_RATIO,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(
        settingsReset.stored,
      )} after reset`,
    );

    // Leave the window on a non-default pair the dock must wear: 100% / 1.75.
    const relaxedAgainPressed = await run(
      CLICK('[data-testid="chat-display-line-relaxed"]'),
    );
    const relaxedAgainArrived = await waitFor(previewLineIs(String(RELAXED_RATIO)), 5_000);
    settingsFinal = await readSettings("settings-final");
    mark("settings-final");
    check(
      "settings:contract-clicked",
      relaxedAgainPressed === true && relaxedAgainArrived === true,
      "the Relaxed button could not be pressed a second time to leave a non-default pair stored",
    );

    // ── the shared contract: the dock wears what the settings page wrote ────
    await loadChatPage();
    mark("contract-loaded");
    contract = await readChat("contract");
    check(
      "contract:scale",
      contract.readingScale === "1",
      `after the settings page chose 100% / 1.75, the dock's --chat-reading-scale is ${JSON.stringify(
        contract.readingScale,
      )}, expected "1"`,
    );
    check(
      "contract:line",
      contract.readingLine === String(RELAXED_RATIO),
      `after the settings page chose 100% / 1.75, the dock's --chat-reading-line is ${JSON.stringify(
        contract.readingLine,
      )}, expected "${RELAXED_RATIO}"`,
    );
    check(
      "contract:font",
      contract.answer !== null &&
        near(contract.answer.fontPx, BASE_FONT_PX, FONT_TOLERANCE_PX),
      `the dock's answer is ${contract.answer ? contract.answer.fontPx : "?"}px, expected ${BASE_FONT_PX}px`,
    );
    check(
      "contract:line-ratio",
      contract.answer !== null &&
        near(contract.answer.ratio, RELAXED_RATIO, RATIO_TOLERANCE),
      `the dock's answer line ratio is ${
        contract.answer ? contract.answer.ratio : "?"
      }, expected the settings page's ${RELAXED_RATIO}`,
    );

    // ── the two pictures of the shipped surfaces ────────────────────────────
    // The dock at a non-default size AND spacing: two Ctrl+= steps on top of the
    // 1.75 the settings page chose.
    await focusWindow();
    await pressCtrl("=");
    await pressCtrl("=");
    const dockArtifactArrived = await waitFor(scaleIs("1.2"), 5_000);
    await frames();
    await sleep(150);
    dockArtifact = await readChat("artifact-dock");
    mark("artifact-dock");
    check(
      "artifact:dock-state",
      dockArtifactArrived &&
        dockArtifact.readingScale === "1.2" &&
        dockArtifact.readingLine === String(RELAXED_RATIO) &&
        dockArtifact.answer !== null &&
        near(dockArtifact.answer.fontPx, expectedFontPx(120), FONT_TOLERANCE_PX),
      `the dock picture is taken at scale ${JSON.stringify(
        dockArtifact.readingScale,
      )} / line ${JSON.stringify(dockArtifact.readingLine)} / ${
        dockArtifact.answer ? dockArtifact.answer.fontPx : "?"
      }px, expected 1.2 / ${RELAXED_RATIO} / ${expectedFontPx(120)}px`,
    );

    // The picture is taken on the dock page, before the settings page replaces
    // it: this one has to show the transcript at 120% / 1.75, which is the
    // state the checks above just measured.
    const dockShot = await capture(path.join(artifactsDir, DOCK_PNG));
    mark("capture-dock");
    check(
      "screenshot:dock",
      fs.existsSync(dockShot.path) && dockShot.bytes > 0,
      `${DOCK_PNG} missing or empty (${dockShot.bytes} bytes)`,
    );

    settingsArtifactSheet = await loadSettingsPage();
    settingsArtifact = await readSettings("artifact-settings");
    mark("artifact-settings");
    check(
      "artifact:settings-state",
      settingsArtifactSheet.clicked === true &&
        settingsArtifact.zoom.value === "120%" &&
        settingsArtifact.preview !== null &&
        near(settingsArtifact.preview.proseFontPx, expectedFontPx(120), FONT_TOLERANCE_PX),
      `the settings picture shows ${JSON.stringify(
        settingsArtifact.zoom.value,
      )} / ${JSON.stringify(
        settingsArtifact.preview ? settingsArtifact.preview.dataLineSpacing : null,
      )} / ${
        settingsArtifact.preview ? settingsArtifact.preview.proseFontPx : "?"
      }px, expected the dock's 120% / ${RELAXED_RATIO} / ${expectedFontPx(120)}px`,
    );

    const settingsShot = await capture(path.join(artifactsDir, SETTINGS_PNG));
    mark("capture-settings");
    check(
      "screenshot:settings",
      fs.existsSync(settingsShot.path) && settingsShot.bytes > 0,
      `${SETTINGS_PNG} missing or empty (${settingsShot.bytes} bytes)`,
    );

    // ── the artifact ────────────────────────────────────────────────────────
    report = {
      url,
      settingsUrl,
      ranAt: new Date().toISOString(),
      window: WINDOW,
      contract: {
        baseFontPx: BASE_FONT_PX,
        defaultLineSpacing: DEFAULT_RATIO,
        relaxedLineSpacing: RELAXED_RATIO,
        zoomStepPercent: ZOOM_STEP,
        storageKey: STORAGE_KEY,
        fontTolerancePx: FONT_TOLERANCE_PX,
        ratioTolerance: RATIO_TOLERANCE,
      },
      wheelInput: {
        path: "Input.dispatchMouseEvent",
        modifiers: 2,
        reason:
          "Electron 44 drops a synthesized wheel event's `modifiers`; the DevTools input path delivers a trusted Ctrl+wheel",
      },
      defaults,
      wheel: {
        outsideDock: wheelOutside,
        up: wheelUp,
        down: wheelDown,
      },
      keys: {
        plus: keyPlus,
        minus: keyMinus,
        zero: keyZero,
      },
      persistence: {
        before: persistenceBefore,
        after: persistenceAfter,
      },
      dockLink,
      settings: {
        sheet: settingsSheet,
        opened: settingsOpened,
        relaxed: settingsRelaxed,
        zoomed: settingsZoomed,
        reset: settingsReset,
        final: settingsFinal,
      },
      sharedContract: contract,
      artifacts: {
        dock: { path: path.join(artifactsDir, DOCK_PNG), bytes: dockShot.bytes },
        settings: {
          path: path.join(artifactsDir, SETTINGS_PNG),
          bytes: settingsShot.bytes,
        },
      },
      dockArtifact,
      settingsArtifact,
      marks,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      settingsUrl,
      ranAt: new Date().toISOString(),
      window: WINDOW,
      wheelInput: {
        path: "Input.dispatchMouseEvent",
        modifiers: 2,
        reason:
          "Electron 44 drops a synthesized wheel event's `modifiers`; the DevTools input path delivers a trusted Ctrl+wheel",
      },
      defaults,
      wheel: { outsideDock: wheelOutside, up: wheelUp, down: wheelDown },
      keys: { plus: keyPlus, minus: keyMinus, zero: keyZero },
      persistence: { before: persistenceBefore, after: persistenceAfter },
      dockLink,
      settings: {
        sheet: settingsSheet,
        opened: settingsOpened,
        relaxed: settingsRelaxed,
        zoomed: settingsZoomed,
        reset: settingsReset,
        final: settingsFinal,
      },
      sharedContract: contract,
      dockArtifact,
      settingsArtifact,
      marks,
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "chat-display.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  // A short read-out for the console: the dock's pair through each gesture, then
  // the settings page's read-back, then the shared contract.
  const describeDock = (sample) =>
    sample
      ? `${sample.readingScale} / ${sample.readingLine} — ` +
        `${sample.answer ? sample.answer.fontPx : "?"}px, ratio ` +
        `${sample.answer ? sample.answer.ratio : "?"}, stored ${JSON.stringify(sample.stored)}`
      : "—";
  const describeSettings = (sample) =>
    sample
      ? `${sample.view} ${sample.zoom.value} — preview ` +
        `${sample.preview ? sample.preview.dataZoom : "?"} / ` +
        `${sample.preview ? sample.preview.dataLineSpacing : "?"} — ` +
        `${sample.preview ? sample.preview.proseFontPx : "?"}px, ratio ` +
        `${sample.preview ? sample.preview.proseRatio : "?"}, stored ` +
        `${JSON.stringify(sample.stored)}`
      : "—";
  console.log(`defaults:    ${describeDock(report.defaults)}`);
  console.log(`wheel up:    ${describeDock(report.wheel?.up)}`);
  console.log(`wheel down:  ${describeDock(report.wheel?.down)}`);
  console.log(`Ctrl+=:      ${describeDock(report.keys?.plus)}`);
  console.log(`Ctrl+-:      ${describeDock(report.keys?.minus)}`);
  console.log(`Ctrl+0:      ${describeDock(report.keys?.zero)}`);
  console.log(`reload:      ${describeDock(report.persistence?.after)}`);
  console.log(
    `dock link:   ${report.dockLink ? JSON.stringify(report.dockLink.href) : "—"} / ` +
      `${report.dockLink ? JSON.stringify(report.dockLink.ariaLabel) : "—"}`,
  );
  console.log(`settings:    ${describeSettings(report.settings?.opened)}`);
  console.log(`  relaxed:   ${describeSettings(report.settings?.relaxed)}`);
  console.log(`  zoom in:   ${describeSettings(report.settings?.zoomed)}`);
  console.log(`  reset:     ${describeSettings(report.settings?.reset)}`);
  console.log(`contract:    ${describeDock(report.sharedContract)}`);
  console.log(`dock shot:   ${report.artifacts?.dock.path} (${report.artifacts?.dock.bytes} bytes)`);
  console.log(
    `sheet shot:  ${report.artifacts?.settings.path} (${report.artifacts?.settings.bytes} bytes)`,
  );
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat display: PASS" : "chat display: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-display: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
