/**
 * Drives the review-window harness in a real Electron window and turns what the
 * shipped Review page and Settings sheet actually render into
 * `e2e/artifacts/review-window.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node_modules/.bin/electron e2e/review-window.electron.mjs
 *
 * Exit code 0 = every scenario matched. The JSON report is the repeatable
 * artifact: same command, same claims, whatever hour the suite happens to run —
 * every page load pins its own instant in the URL, and the harness replaces
 * `Date` with that instant before React mounts.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. THE PAGE OPENS ON THE LATEST OPEN PERIOD, not the calendar's. Five cadences
 *     are sampled on both sides of their opening minute: before it the page is on
 *     the previous period and says when the current one opens; at the minute it
 *     is on the current one and says nothing.
 *  2. THE NOTE NAMES THE OPENING INSTANT. The text is read off the rendered DOM,
 *     not recomputed here: "The daily review for the current period opens
 *     15 Nov 2026 at 18:00."
 *  3. NEXT STOPS AT THE OPEN PERIOD, and Prev still reaches an older one; with
 *     Next enabled again there.
 *  4. THE VAULT'S SETTING DRIVES THE PAGE. The same 19:00 minute with daily set
 *     to 20:00 still shows yesterday, which the shipped 18:00 default would not.
 *  5. THE SETTINGS REVIEW TAB IS THE REAL SHEET: five rows with the defaults,
 *     each preview naming its opening; Save sends the WHOLE `reviewAvailability`
 *     object (the engine replaces the field, so a partial patch would reset the
 *     other cadences); Restore defaults puts the five rows back.
 *  6. The page is the REAL Review page inside the REAL shell, not a mock: the nav
 *     rail, the titlebar and the page's own header are sampled.
 *  7. No bridge call this rig does not model, and no console error.
 *
 * NOT covered here: that any of it reaches disk (that is the engine half,
 * `tests/review-availability-engine-e2e.test.ts`).
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
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/review-window.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The shipped windows, repeated here so the rig can seed the vault and check
 *  what the settings page wrote without importing the renderer bundle. */
const DEFAULTS = {
  daily: { daysBeforeEnd: 0, timeOfDay: "18:00" },
  weekly: { daysBeforeEnd: 0, timeOfDay: "08:00" },
  monthly: { daysBeforeEnd: 1, timeOfDay: "00:00" },
  quarterly: { daysBeforeEnd: 2, timeOfDay: "00:00" },
  yearly: { daysBeforeEnd: 6, timeOfDay: "00:00" },
};

const CADENCES = ["daily", "weekly", "monthly", "quarterly", "yearly"];

/** Every review scenario: a pinned instant, a cadence, and what must paint. */
const REVIEW_SCENARIOS = [
  {
    name: "dailyBefore",
    params: { cadence: "daily", now: "2026-11-15T17:59:00" },
    expect: {
      title: "Daily review",
      periodLabel: "Daily review · 14 Nov 2026",
      note: "The daily review for the current period opens 15 Nov 2026 at 18:00.",
      nextDisabled: true,
    },
    shot: "daily-before",
  },
  {
    name: "dailyOpen",
    params: { cadence: "daily", now: "2026-11-15T18:00:00" },
    expect: {
      title: "Daily review",
      periodLabel: "Daily review · 15 Nov 2026",
      note: null,
      nextDisabled: true,
    },
    shot: "daily-open",
  },
  {
    name: "weeklyBefore",
    params: { cadence: "weekly", now: "2026-11-10T09:00:00" },
    expect: {
      title: "Weekly review",
      periodLabel: "Weekly review · Week of 2 Nov 2026",
      note: "The weekly review for the current period opens 15 Nov 2026 at 08:00.",
      nextDisabled: true,
    },
    shot: "weekly-before",
  },
  {
    name: "weeklyOpen",
    params: { cadence: "weekly", now: "2026-11-15T08:00:00" },
    expect: {
      title: "Weekly review",
      periodLabel: "Weekly review · Week of 9 Nov 2026",
      note: null,
      nextDisabled: true,
    },
  },
  {
    name: "monthlyBefore",
    params: { cadence: "monthly", now: "2026-11-28T12:00:00" },
    expect: {
      title: "Monthly review",
      periodLabel: "Monthly review · Oct 2026",
      note: "The monthly review for the current period opens 29 Nov 2026 at 00:00.",
      nextDisabled: true,
    },
  },
  {
    name: "monthlyOpen",
    params: { cadence: "monthly", now: "2026-11-29T00:00:00" },
    expect: {
      title: "Monthly review",
      periodLabel: "Monthly review · Nov 2026",
      note: null,
      nextDisabled: true,
    },
    shot: "monthly-open",
  },
  {
    name: "quarterlyBefore",
    params: { cadence: "quarterly", now: "2026-12-28T12:00:00" },
    expect: {
      title: "Quarterly review",
      periodLabel: "Quarterly review · 2026 Q3",
      note: "The quarterly review for the current period opens 29 Dec 2026 at 00:00.",
      nextDisabled: true,
    },
  },
  {
    name: "quarterlyOpen",
    params: { cadence: "quarterly", now: "2026-12-29T00:00:00" },
    expect: {
      title: "Quarterly review",
      periodLabel: "Quarterly review · 2026 Q4",
      note: null,
      nextDisabled: true,
    },
  },
  {
    name: "yearlyBefore",
    params: { cadence: "yearly", now: "2026-12-24T23:59:00" },
    expect: {
      title: "Yearly review",
      periodLabel: "Yearly review · 2025",
      note: "The yearly review for the current period opens 25 Dec 2026 at 00:00.",
      nextDisabled: true,
    },
    shot: "yearly-before",
  },
  {
    name: "yearlyOpen",
    params: { cadence: "yearly", now: "2026-12-25T00:00:00" },
    expect: {
      title: "Yearly review",
      periodLabel: "Yearly review · 2026",
      note: null,
      nextDisabled: true,
    },
  },
  {
    // The same minute as dailyBefore, but the vault opens daily at 20:00: the
    // page must follow the SETTING, not the shipped default.
    name: "honoursSetting",
    params: {
      cadence: "daily",
      now: "2026-11-15T19:00:00",
      availability: JSON.stringify({
        ...DEFAULTS,
        daily: { daysBeforeEnd: 0, timeOfDay: "20:00" },
      }),
    },
    expect: {
      title: "Daily review",
      periodLabel: "Daily review · 14 Nov 2026",
      note: "The daily review for the current period opens 15 Nov 2026 at 20:00.",
      nextDisabled: true,
    },
  },
];

const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
  const value = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.value : null;
  };
  return {
    path: document.body.dataset.rigPath || null,
    rigView: window.reviewWindowRigView || null,
    pinnedNow: window.reviewWindowRigNow || null,
    shell: Boolean(document.querySelector(".nav-rail")),
    title: text(document.querySelector(".review-page__title")),
    periodLabel: text(document.querySelector('[data-testid="review-period"]')),
    note: text(document.querySelector('[data-testid="review-window-note"]')),
    error: text(document.querySelector('[data-testid="review-error"]')),
    notice: text(document.querySelector('[data-testid="review-notice"]')),
    nextDisabled: (() => {
      const el = document.querySelector('[data-testid="review-next"]');
      return el ? el.disabled : null;
    })(),
    prevDisabled: (() => {
      const el = document.querySelector('[data-testid="review-prev"]');
      return el ? el.disabled : null;
    })(),
    editor: Boolean(document.querySelector(".note-live")),
    windowNoVault: Boolean(document.querySelector(".muted")),
    settings: (() => {
      const days = {}, times = {}, previews = {};
      for (const id of ${JSON.stringify(CADENCES)}) {
        days[id] = value('[data-testid="settings-review-days-' + id + '"]');
        times[id] = value('[data-testid="settings-review-time-' + id + '"]');
        previews[id] = text(
          document.querySelector('[data-testid="settings-review-preview-' + id + '"]')
        );
      }
      return {
        view:
          (document.querySelector("[data-settings-view]") || {
            getAttribute: () => null,
          }).getAttribute("data-settings-view") || null,
        overlay: Boolean(document.querySelector("[data-settings-overlay]")),
        backgroundReview: Boolean(document.querySelector(".review-page")),
        navLabels: Array.from(
          document.querySelectorAll(".settings-nav-item__label")
        ).map(text),
        days,
        times,
        previews,
        savePresent: Boolean(
          document.querySelector('[data-testid="settings-review-save"]')
        ),
        resetPresent: Boolean(
          document.querySelector('[data-testid="settings-review-reset"]')
        ),
        error: text(document.querySelector('[data-testid="settings-review-error"]')),
        notice: text(
          document.querySelector('[data-testid="settings-review-notice"]')
        ),
      };
    })(),
  };
})()`;

const scenarios = {};
const screenshots = [];
const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

function frames(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

function run(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function shot(win, name) {
  await frames(win);
  // A fresh checkout has no artifacts directory: it is gitignored, so the first
  // run in a worktree is the one that has to make it.
  fs.mkdirSync(artifactsDir, { recursive: true });
  const image = await win.webContents.capturePage();
  const file = `review-window-${name}.png`;
  fs.writeFileSync(path.join(artifactsDir, file), image.toPNG());
  screenshots.push(file);
  return file;
}

/** Load a scenario URL and wait for the surface it asks for to paint. */
async function load(win, params) {
  const query = new URLSearchParams(params);
  query.set("v", String(Date.now()));
  await win.loadURL(`${url}?${query.toString()}`);
  await waitFor(win, "Boolean(window.reviewWindowRigReady)", "reviewWindowRigReady");
  await frames(win);
  return sample(win);
}

/** Press a button the way a person does, by its testid. */
function click(win, testId) {
  return run(
    win,
    `(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
}

/**
 * Type into one of the settings inputs: through the element's own value setter
 * and the `input` event React listens for. Assigning `.value` directly leaves
 * React's state behind and the next render undoes it.
 */
function typeInto(win, testId, value) {
  return run(
    win,
    `(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`,
  );
}

function settingsRows(sampleValue) {
  return CADENCES.map((id) => ({
    id,
    days: sampleValue.settings.days[id],
    time: sampleValue.settings.times[id],
    preview: sampleValue.settings.previews[id],
  }));
}

/** What the five rows must hold when the vault carries the shipped defaults. */
function defaultRows() {
  return [
    {
      id: "daily",
      days: "0",
      time: "18:00",
      preview: "Opens each day at 18:00.",
    },
    {
      id: "weekly",
      days: "0",
      time: "08:00",
      preview: "Opens on the week's last day at 08:00.",
    },
    {
      id: "monthly",
      days: "1",
      time: "00:00",
      preview: "Opens 1 day before the period ends, at 00:00.",
    },
    {
      id: "quarterly",
      days: "2",
      time: "00:00",
      preview: "Opens 2 days before the period ends, at 00:00.",
    },
    {
      id: "yearly",
      days: "6",
      time: "00:00",
      preview: "Opens 6 days before the period ends, at 00:00.",
    },
  ];
}

/** What the settings page must send: the whole object, daily moved to 20:00. */
function editedAvailability() {
  return { ...DEFAULTS, daily: { daysBeforeEnd: 0, timeOfDay: "20:00" } };
}

function verifyReviewScenario(scenario, sampleValue) {
  const { name, expect } = scenario;
  if (!sampleValue.shell) failure(`${name}: the Review page did not render inside the app shell`);
  if (!sampleValue.editor) failure(`${name}: the Review page drew no document`);
  if (sampleValue.title !== expect.title) {
    failure(
      `${name}: the page is titled ${JSON.stringify(sampleValue.title)}, expected ${JSON.stringify(expect.title)}`,
    );
  }
  if (sampleValue.periodLabel !== expect.periodLabel) {
    failure(
      `${name}: the page shows ${JSON.stringify(sampleValue.periodLabel)}, expected ${JSON.stringify(expect.periodLabel)}`,
    );
  }
  if ((sampleValue.note ?? null) !== expect.note) {
    failure(
      `${name}: the window note reads ${JSON.stringify(sampleValue.note)}, expected ${JSON.stringify(expect.note)}`,
    );
  }
  if (sampleValue.nextDisabled !== expect.nextDisabled) {
    failure(
      `${name}: Next disabled is ${sampleValue.nextDisabled}, expected ${expect.nextDisabled}`,
    );
  }
  if (sampleValue.error) failure(`${name}: the page reported an error: ${sampleValue.error}`);
}

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `review-window-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") consoleErrors.push(e.message);
  });

  // ── 1. the ten boundary scenarios on the real Review page ────────────────
  for (const scenario of REVIEW_SCENARIOS) {
    const sampleValue = await load(win, scenario.params);
    scenarios[scenario.name] = { params: scenario.params, ...sampleValue };
    verifyReviewScenario(scenario, sampleValue);
    if (scenario.shot) await shot(win, scenario.shot);
  }

  // ── 2. Prev still reaches an older period, and Next is enabled there ─────
  const atOpen = await load(win, { cadence: "daily", now: "2026-11-15T18:00:00" });
  const clickedPrev = await click(win, "review-prev");
  if (!clickedPrev) failure("prevNav: the Prev control was not on the page");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="review-period"]')?.textContent || "").trim() === "Daily review · 14 Nov 2026"`,
    "the previous daily period",
  );
  await frames(win);
  const previous = await sample(win);
  scenarios.prevNav = { params: { from: atOpen.periodLabel }, ...previous };
  if (previous.periodLabel !== "Daily review · 14 Nov 2026") {
    failure(
      `prevNav: Prev landed on ${JSON.stringify(previous.periodLabel)}, expected "Daily review · 14 Nov 2026"`,
    );
  }
  if (previous.nextDisabled !== false) {
    failure("prevNav: Next is still disabled while viewing an older period");
  }
  // And Next walks back to the open period.
  const clickedNext = await click(win, "review-next");
  if (!clickedNext) failure("prevNav: the Next control was not on the page");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="review-period"]')?.textContent || "").trim() === "Daily review · 15 Nov 2026"`,
    "the open daily period after Next",
  );
  await frames(win);
  const returned = await sample(win);
  scenarios.nextBack = { params: {}, ...returned };
  if (returned.nextDisabled !== true) {
    failure("prevNav: Next did not stop at the open period");
  }

  // ── 3. the Settings review tab is the real sheet, over the real page ─────
  const settingsLoaded = await load(win, {
    cadence: "daily",
    now: "2026-11-15T19:00:00",
    view: "settings",
  });
  scenarios.settingsDefaults = { params: { view: "settings" }, ...settingsLoaded };
  const settingsSheet = settingsLoaded.settings;
  if (settingsSheet.view !== "review") {
    failure(
      `settingsDefaults: the sheet opened on ${JSON.stringify(settingsSheet.view)}, expected "review"`,
    );
  }
  if (!settingsSheet.overlay) failure("settingsDefaults: the settings sheet did not render");
  if (!settingsSheet.backgroundReview) {
    failure("settingsDefaults: the sheet does not sit over the Review page it was opened from");
  }
  if (settingsSheet.navLabels.length !== 14) {
    failure(
      `settingsDefaults: the section column holds ${settingsSheet.navLabels.length} sections, expected 14`,
    );
  }
  if (!settingsSheet.navLabels.includes("Review")) {
    failure(
      `settingsDefaults: the section column has no Review entry: ${JSON.stringify(settingsSheet.navLabels)}`,
    );
  }
  if (!settingsSheet.savePresent || !settingsSheet.resetPresent) {
    failure("settingsDefaults: the Save / Restore defaults controls are missing");
  }
  const loadedRows = settingsRows(settingsLoaded);
  if (!sameJson(loadedRows, defaultRows())) {
    failure(
      `settingsDefaults: the five rows read ${JSON.stringify(loadedRows)}, expected ${JSON.stringify(defaultRows())}`,
    );
  }
  if (settingsSheet.error) {
    failure(`settingsDefaults: the page reported an error on open: ${settingsSheet.error}`);
  }
  await shot(win, "settings");

  // ── 4. edit daily to 20:00 and save the whole object ────────────────────
  const typed = await typeInto(win, "settings-review-time-daily", "20:00");
  if (typed !== "20:00") failure(`settingsSaved: the time field reads ${JSON.stringify(typed)}`);
  await frames(win);
  const edited = await sample(win);
  scenarios.settingsEdited = { params: {}, ...edited };
  if (edited.settings.times.daily !== "20:00") {
    failure(
      `settingsSaved: the edited row reads ${JSON.stringify(edited.settings.times.daily)}, expected "20:00"`,
    );
  }
  const clickedSave = await click(win, "settings-review-save");
  if (!clickedSave) failure("settingsSaved: the Save control was not on the page");
  await waitFor(
    win,
    `(window.reviewWindowRig?.settingsUpdates ?? []).length > 0`,
    "the settings write to reach the bridge",
  );
  await waitFor(
    win,
    `(document.querySelector('[data-testid="settings-review-notice"]')?.textContent || "").includes("saved")`,
    "the save notice",
  );
  await frames(win);
  const saved = await sample(win);
  scenarios.settingsSaved = { params: {}, ...saved };
  const settingsWrites = await run(win, "window.reviewWindowRig.settingsUpdates");
  scenarios.settingsUpdates = settingsWrites;
  if (settingsWrites.length !== 1) {
    failure(`settingsSaved: the settings page wrote ${settingsWrites.length} times, expected 1`);
  }
  const patch = settingsWrites[0] ?? {};
  if (!sameJson(patch.reviewAvailability, editedAvailability())) {
    failure(
      `settingsSaved: the Save patch carried ${JSON.stringify(patch.reviewAvailability)}, expected the WHOLE object ${JSON.stringify(editedAvailability())}`,
    );
  }
  if (saved.settings.times.daily !== "20:00") {
    failure(
      `settingsSaved: after Save the daily row reads ${JSON.stringify(saved.settings.times.daily)}`,
    );
  }
  const otherCadencesUntouched = ["weekly", "monthly", "quarterly", "yearly"].every(
    (id) => sameJson(patch.reviewAvailability?.[id], DEFAULTS[id]),
  );
  if (!otherCadencesUntouched) {
    failure("settingsSaved: the Save patch reset a cadence the operator did not edit");
  }
  if (!/saved/i.test(saved.settings.notice ?? "")) {
    failure(`settingsSaved: the notice reads ${JSON.stringify(saved.settings.notice)}`);
  }

  // ── 5. Restore defaults puts the five rows back (a draft, not a write) ──
  const clickedReset = await click(win, "settings-review-reset");
  if (!clickedReset) failure("settingsReset: the Restore defaults control was not on the page");
  await waitFor(
    win,
    `(document.querySelector('[data-testid="settings-review-notice"]')?.textContent || "").includes("Defaults restored")`,
    "the restore notice",
  );
  await frames(win);
  const reset = await sample(win);
  scenarios.settingsReset = { params: {}, ...reset };
  const resetRows = settingsRows(reset);
  if (!sameJson(resetRows, defaultRows())) {
    failure(
      `settingsReset: the rows read ${JSON.stringify(resetRows)}, expected the defaults ${JSON.stringify(defaultRows())}`,
    );
  }
  if (!/Defaults restored/i.test(reset.settings.notice ?? "")) {
    failure(`settingsReset: the notice reads ${JSON.stringify(reset.settings.notice)}`);
  }
  const afterResetWrites = await run(win, "window.reviewWindowRig.settingsUpdates");
  if (afterResetWrites.length !== 1) {
    failure(
      `settingsReset: restoring defaults wrote to the vault without a Save (${afterResetWrites.length} writes)`,
    );
  }

  // ── 6. nothing unexpected, nothing on fire ──────────────────────────────
  const unexpected = await run(win, "window.reviewWindowRig.unexpectedCalls");
  const calls = await run(win, "window.reviewWindowRig.calls");
  for (const name of unexpected) {
    failure(`the page called bridge methods this rig does not model: ${name}`);
  }
  for (const message of consoleErrors) failure(`console error: ${message}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    scenarios,
    screenshots,
    calls,
    unexpectedBridgeCalls: unexpected,
    consoleErrors,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "review-window.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `[review-window] ${errors.length === 0 ? "PASS" : "FAIL"} — ${errors.length} failure(s)`,
  );
  console.log(
    `[review-window] scenarios: ${Object.keys(scenarios).join(", ")}`,
  );
  console.log(`[review-window] screenshots: ${screenshots.join(", ")}`);
  for (const message of errors) console.log(`  ✗ ${message}`);
  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

setTimeout(() => {
  console.error("review-window rig timed out");
  app.exit(1);
}, 150_000);

app
  .whenReady()
  .then(main)
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`review-window rig threw: ${message}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "review-window.json"),
      `${JSON.stringify(
        {
          pass: false,
          failures: [...errors, message],
          scenarios,
          screenshots,
          calls: [],
          unexpectedBridgeCalls: [],
          consoleErrors: [],
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  });
