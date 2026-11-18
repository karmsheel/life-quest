/**
 * Drives the Settings → Composer page in a real Electron window and turns the
 * measurements into `e2e/artifacts/settings-composer.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/settings-composer.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * The page this rig answers: the chip on the composer's send key. The message
 * box has always sent on Ctrl/Cmd+Enter and broken the line on Enter; the tab
 * beside Keyboard lets the operator ask for the other keyboard — Enter sends,
 * Shift+Enter breaks the line — and keeps that choice across launches. The rig
 * proves the tab, the page, both radio states, the hint that explains them, the
 * storage that remembers them, and that the sheet's search can still find them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/settings-composer.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

// Its own Electron profile: a rig sharing a profile with another run would
// start on that run's `lifequest-composer-send-key`.
const userDataDir = path.join(artifactsDir, "userdata", "settings-composer");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

/** The words the page must carry, from the feature contract. */
const HEADING = "Composer";
const SUBTITLE = "How the message box sends";
const ROW_LABEL = "Send with";
const STORAGE_KEY = "lifequest-composer-send-key";
const MODIFIED_LABEL = "Ctrl/Cmd+Enter";
const ENTER_LABEL = "Enter";

/** The section column, in the order the sheet ships it. */
const NAV_ORDER = [
  "Appearance",
  "Keyboard",
  "Composer",
  "Areas",
  "Vault",
  "Hermes",
  "Agent",
  "Review",
  "Questions",
  "Decisions",
  "Updates",
  "About me",
  "Developer",
];

const SAMPLE = `(() => {
  const round = (value) => Math.round(value);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: round(r.left), top: round(r.top), right: round(r.right),
      bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const storage = () => {
    try {
      return localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    } catch {
      return "unavailable";
    }
  };

  const page = document.querySelector("[data-composer-settings]");
  const group = document.querySelector('[role="group"][aria-label="Send key"]');
  const radios = group
    ? Array.from(group.querySelectorAll('[role="radio"]')).map((button) => ({
        label: text(button),
        checked: button.getAttribute("aria-checked"),
        box: box(button),
      }))
    : [];
  const hint = document.querySelector("[data-composer-send-hint]");
  const search = document.querySelector(".settings-overlay__search-input");
  const nav = Array.from(document.querySelectorAll(".settings-nav-item")).map((el) => ({
    label: text(el.querySelector(".settings-nav-item__label")),
    match: text(el.querySelector(".settings-nav-item__match")) || null,
    active:
      el.classList.contains("is-active") || el.getAttribute("aria-current") === "page",
  }));
  const rows = Array.from(document.querySelectorAll(".settings-card__row")).map((row) => ({
    label: text(row.querySelector(".settings-card__label")),
    box: box(row),
  }));
  const sendRow = rows.find((row) => row.label === ${JSON.stringify(ROW_LABEL)}) || null;
  const content = document.querySelector(".settings-card");
  const panel = document.querySelector(".settings-overlay__panel");

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    nav,
    heading: text(document.querySelector(".settings-panel__title")),
    subtitle: text(document.querySelector(".settings-panel__subtitle")),
    pagePresent: Boolean(page),
    sendKey: attr(page, "data-composer-send-key"),
    pageBox: box(page),
    groupPresent: Boolean(group),
    groupBox: box(group),
    radios,
    sendRow,
    rowLabels: rows.map((row) => row.label),
    hint: hint
      ? {
          sendKey: attr(hint, "data-composer-send-hint"),
          role: attr(hint, "role"),
          text: text(hint),
          box: box(hint),
        }
      : null,
    search: search
      ? {
          value: search.value,
          label: search.getAttribute("aria-label"),
          box: box(search),
        }
      : null,
    panelView: attr(document.querySelector("[data-settings-view]"), "data-settings-view"),
    panel: panel ? { box: box(panel) } : null,
    content: content ? { box: box(content) } : null,
    stored: storage(),
    sheet: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
  };
})()`;

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
  return Boolean(ok);
};

const saysEnterSends = (value) =>
  /enter[\s\S]{0,80}send/i.test(value) && /shift\s*\+\s*enter/i.test(value) &&
  /(break|newline|new line)/i.test(value);

const saysModifiedSends = (value) =>
  /enter[\s\S]{0,80}break/i.test(value) &&
  /(ctrl\/cmd\+enter|ctrl \+ \/ \+ cmd|ctrl\/cmd)/i.test(value) &&
  /send/i.test(value);

async function main() {
  // Paint in the theme the app defaults to, so a rig run is not a white sheet
  // flashing across the screen.
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

  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const pageErrors = [];
  win.webContents.on("console-message", (event, level, message) => {
    const value =
      typeof event?.message === "string" ? event.message : typeof message === "string" ? message : "";
    const severity = typeof event?.level === "string" ? event.level : level;
    if (severity === "error" || (typeof severity === "number" && severity >= 3)) {
      pageErrors.push(String(value).slice(0, 500));
    }
  });

  /**
   * Wait for the harness page's ready promise, but never forever: a page that
   * throws before settling would otherwise hang the driver until its wrapper
   * kills it, and the report — the artifact this rig exists to write — would
   * never appear.
   */
  const waitHarnessReady = async (timeoutMs = 25_000) => {
    const ready = run("window.settingsComposerHarnessReady.then(() => true)");
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
    const outcome = await Promise.race([ready, timeout]);
    if (outcome !== "timeout") return;
    const body = await run(
      "(() => ({ text: document.body.innerText.slice(0, 1500), html: document.body.innerHTML.length, scripts: [...document.scripts].map((s) => s.src) }))()",
    ).catch(() => null);
    throw new Error(
      `the harness page never signalled ready; page errors: ${JSON.stringify(pageErrors)}; body: ${JSON.stringify(body)}`,
    );
  };

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 280) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  /**
   * The sheet arrives with a CSS entry animation. A capture taken during it is a
   * half-opaque frame of the page behind the sheet, which is not the surface the
   * operator opens — so wait for the sheet's animations to finish before taking
   * the picture. Bounded: a decorative loop must not hang the rig.
   */
  const waitForPaintSettled = async (timeoutMs = 1_500) => {
    await run(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const deadline = Date.now() + ${timeoutMs};
      while (Date.now() < deadline) {
        const running = document.getAnimations().filter(
          (animation) => animation.playState === "running"
        );
        if (running.length === 0) break;
        await Promise.race([running[0].finished.catch(() => {}), sleep(50)]);
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      return true;
    })()`);
  };

  /** The frames the report lists; each call site records the one it took. */
  const shot = async (name) => {
    // The sheet finishes arriving first, then the compositor gets a beat to
    // commit the frame that is captured.
    await waitForPaintSettled();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, name);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return path.basename(file);
  };

  const clickRadio = (label) =>
    run(`(() => {
      const group = document.querySelector('[role="group"][aria-label="Send key"]');
      if (!group) return false;
      const button = Array.from(group.querySelectorAll('[role="radio"]')).find(
        (el) => ((el.textContent || "").trim()) === ${JSON.stringify(label)}
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);

  /**
   * Type into the sheet's field the way a keyboard does: through the input's own
   * value setter, then the `input` event React listens for. Assigning `value`
   * directly leaves React's state behind and the next render undoes it.
   */
  const typeQuery = (value) =>
    run(`(() => {
      const input = document.querySelector(".settings-overlay__search-input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

  const clearStorage = () =>
    run(`(() => {
      try {
        localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
        return true;
      } catch {
        return false;
      }
    })()`);

  const screenshots = [];
  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: { navOrder: NAV_ORDER, storageKey: STORAGE_KEY },
    pass: false,
    failures,
    states: {},
    screenshots,
    pageErrors,
  };

  try {
    await win.loadURL(url);
    await waitHarnessReady();
    // A hidden window does not reliably advance compositor-driven CSS
    // animations, and the sheet's arrival is one: capturing it while hidden can
    // hand back a half-faded, dim frame of the page behind it. Show the window
    // before anything is measured or photographed, so the entry animation runs
    // to completion on the same schedule the operator sees.
    win.showInactive();

    // A choice left by an earlier run would decide the default state before
    // anything here is pressed — rigs share this profile between runs. The
    // reload is the start state the assertions below assume.
    await clearStorage();
    await win.webContents.reload();
    await waitHarnessReady();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const opened = await settle();
    report.states.opened = opened;

    // ── 1. the tab: the sheet's own nav, with Composer after Keyboard ──────
    check(
      "the section column lists the thirteen tabs",
      opened.nav.length === NAV_ORDER.length,
      `nav ${JSON.stringify(opened.nav.map((row) => row.label))}`,
    );
    check(
      "the section column is in the app's order",
      JSON.stringify(opened.nav.map((row) => row.label)) === JSON.stringify(NAV_ORDER),
      `nav ${JSON.stringify(opened.nav.map((row) => row.label))}`,
    );
    check(
      "Composer follows Keyboard",
      opened.nav[1]?.label === "Keyboard" && opened.nav[2]?.label === "Composer",
      `nav ${JSON.stringify(opened.nav.slice(1, 3).map((row) => row.label))}`,
    );
    check(
      "the Composer tab is the open one",
      opened.nav[2]?.active === true && opened.panelView === "composer",
      `active ${JSON.stringify(opened.nav.filter((row) => row.active).map((row) => row.label))}, ` +
        `panel ${JSON.stringify(opened.panelView)}`,
    );

    // ── 2. the page: heading, subtitle, the root the choice lives on ──────
    check(
      "the page renders its root",
      opened.pagePresent === true,
      `[data-composer-settings] ${opened.pagePresent}`,
    );
    check(
      "the page is titled Composer",
      opened.heading === HEADING,
      `heading ${JSON.stringify(opened.heading)}`,
    );
    check(
      "the page says how the message box sends",
      opened.subtitle === SUBTITLE,
      `subtitle ${JSON.stringify(opened.subtitle)}`,
    );
    check(
      "the Send with row is on the page",
      Boolean(opened.sendRow),
      `rows ${JSON.stringify(opened.rowLabels)}`,
    );

    // ── 3. the default: Ctrl/Cmd+Enter sends, the hint says so ─────────────
    check(
      "a fresh window sends on Ctrl/Cmd+Enter",
      opened.sendKey === "modified",
      `root says ${JSON.stringify(opened.sendKey)}`,
    );
    check(
      "the send key is a two-option group",
      opened.groupPresent === true && opened.radios.length === 2,
      `group ${opened.groupPresent}, ${opened.radios.length} radio(s)`,
    );
    check(
      "the two options are named",
      JSON.stringify(opened.radios.map((radio) => radio.label)) ===
        JSON.stringify([MODIFIED_LABEL, ENTER_LABEL]),
      `options ${JSON.stringify(opened.radios.map((radio) => radio.label))}`,
    );
    check(
      "the default option is checked",
      opened.radios[0]?.checked === "true" && opened.radios[1]?.checked === "false",
      `checked ${JSON.stringify(opened.radios.map((radio) => radio.checked))}`,
    );
    check(
      "the hint explains the default keyboard",
      opened.hint?.sendKey === "modified" &&
        opened.hint?.role === "status" &&
        saysModifiedSends(opened.hint?.text ?? ""),
      `hint ${JSON.stringify(opened.hint)}`,
    );
    check(
      "a fresh window has stored nothing yet",
      opened.stored === null || opened.stored === "modified",
      `stored ${JSON.stringify(opened.stored)}`,
    );

    screenshots.push(await shot("settings-composer.png"));

    // ── 4. "Enter" moves the choice to the root, the radio and storage ─────
    check("the Enter option could be pressed", await clickRadio(ENTER_LABEL), "no Enter option");
    const enter = await settle();
    report.states.enter = enter;
    check(
      "pressing Enter moves the root",
      enter.sendKey === "enter",
      `root says ${JSON.stringify(enter.sendKey)}`,
    );
    check(
      "pressing Enter moves the radio",
      enter.radios[0]?.checked === "false" && enter.radios[1]?.checked === "true",
      `checked ${JSON.stringify(enter.radios.map((radio) => radio.checked))}`,
    );
    check(
      "pressing Enter stores exactly the choice",
      enter.stored === "enter",
      `stored ${JSON.stringify(enter.stored)}`,
    );
    check(
      "the hint explains the Enter keyboard",
      enter.hint?.sendKey === "enter" && saysEnterSends(enter.hint?.text ?? ""),
      `hint ${JSON.stringify(enter.hint)}`,
    );

    screenshots.push(await shot("settings-composer-enter.png"));

    // ── 5. the choice is storage, not session state ────────────────────────
    await win.webContents.reload();
    await waitHarnessReady();
    const reloaded = await settle(360);
    report.states.reloaded = reloaded;
    check(
      "the reload keeps the chosen keyboard",
      reloaded.sendKey === "enter" &&
        reloaded.radios[1]?.checked === "true" &&
        reloaded.stored === "enter",
      `root ${JSON.stringify(reloaded.sendKey)}, checked ${JSON.stringify(
        reloaded.radios.map((radio) => radio.checked),
      )}, stored ${JSON.stringify(reloaded.stored)}`,
    );
    check(
      "the reload keeps the whole sheet",
      reloaded.nav.length === NAV_ORDER.length && reloaded.panelView === "composer",
      `${reloaded.nav.length} nav row(s), panel ${JSON.stringify(reloaded.panelView)}`,
    );

    // ── 6. and back again: Ctrl/Cmd+Enter is stored the same way ───────────
    check(
      "the Ctrl/Cmd+Enter option could be pressed",
      await clickRadio(MODIFIED_LABEL),
      "no Ctrl/Cmd+Enter option",
    );
    const restored = await settle();
    report.states.restored = restored;
    check(
      "pressing Ctrl/Cmd+Enter puts the default back",
      restored.sendKey === "modified" &&
        restored.radios[0]?.checked === "true" &&
        restored.stored === "modified",
      `root ${JSON.stringify(restored.sendKey)}, checked ${JSON.stringify(
        restored.radios.map((radio) => radio.checked),
      )}, stored ${JSON.stringify(restored.stored)}`,
    );

    // ── 7. the sheet's own search can find the page ────────────────────────
    check("the search field could be typed into", await typeQuery("enter"), "no search field");
    const searched = await settle();
    report.states.searched = searched;
    check(
      "searching for the key narrows the section column",
      searched.nav.length > 0 && searched.nav.length < NAV_ORDER.length,
      `nav ${JSON.stringify(searched.nav.map((row) => row.label))}`,
    );
    check(
      "searching for the key keeps Composer",
      searched.nav.some((row) => row.label === "Composer"),
      `nav ${JSON.stringify(searched.nav.map((row) => row.label))}`,
    );
    check(
      "the panel follows the search",
      searched.panelView === "composer",
      `panel ${JSON.stringify(searched.panelView)}`,
    );
    check(
      "the search field holds the query",
      searched.search?.value === "enter",
      `field ${JSON.stringify(searched.search?.value)}`,
    );

    screenshots.push(await shot("settings-composer-search.png"));

    // ── 8. nothing widens the sheet ────────────────────────────────────────
    check(
      "the page does not scroll sideways",
      searched.sheet.scrollWidth <= searched.sheet.clientWidth + 1,
      `scrollWidth ${searched.sheet.scrollWidth}px vs clientWidth ${searched.sheet.clientWidth}px`,
    );

    // ── 9. the page stayed quiet ───────────────────────────────────────────
    check(
      "the page logged no errors",
      pageErrors.length === 0,
      `page errors ${JSON.stringify(pageErrors)}`,
    );

    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "settings-composer.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const opened = report.states.opened;
  if (opened) {
    const table = [
      ["state", "nav", "composer at", "root", "checked", "stored", "hint"],
      [
        "opened",
        String(opened.nav.length),
        String(opened.nav.findIndex((row) => row.label === "Composer") + 1),
        String(opened.sendKey),
        String(opened.radios.find((radio) => radio.checked === "true")?.label),
        String(opened.stored),
        String(opened.hint?.sendKey),
      ],
      [
        "enter",
        String(report.states.enter?.nav.length),
        String(
          (report.states.enter?.nav ?? []).findIndex((row) => row.label === "Composer") + 1,
        ),
        String(report.states.enter?.sendKey),
        String(report.states.enter?.radios[1]?.checked),
        String(report.states.enter?.stored),
        String(report.states.enter?.hint?.sendKey),
      ],
    ];
    const widths = table[0].map((_, i) =>
      Math.max(...table.map((row) => String(row[i] ?? "").length)),
    );
    for (const row of table) {
      console.log(row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  "));
    }
    console.log("");
  }

  console.log(`report: ${reportFile}`);
  for (const failure of report.failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "settings composer: PASS" : "settings composer: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`settings-composer: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
