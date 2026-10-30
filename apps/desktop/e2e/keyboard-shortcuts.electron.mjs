/**
 * Drives the keyboard-shortcuts harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/keyboard-shortcuts.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/keyboard-shortcuts.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same states, no eyeballing the app required. It carries
 * the page's defaults, a search, a recording, a rebound movement that really
 * moves, a refused conflict, a reserved combination, a cleared binding, a
 * per-row reset, Restore all defaults, the page after a window reload, the
 * typing guard, and the shipped movements (panels, page steps, direct wing jump,
 * settings surface).
 *
 * Every key is sent through `webContents.sendInputEvent` with its modifiers —
 * the same input pipeline an operator's keyboard uses — not a synthetic DOM
 * event. The harness logs each keydown it sees, so the report proves the
 * modifier flags were carried.
 *
 * The test file (`tests/keyboard-shortcuts-e2e.test.ts`) holds the assertions
 * too; this driver records the states and runs the same checks so a failing run
 * names the state rather than a line of driver code.
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
  "http://127.0.0.1:5173/e2e/keyboard-shortcuts.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const STORAGE_KEY = "lifequest-keyboard-shortcuts";

/** The 14 movements and the binding each default resolves to on this Linux bench
 *  (`Mod` is Ctrl here). The contract is `src/lib/shortcuts.ts`. */
const EXPECTED_DEFAULTS = {
  "wing.home": "Ctrl+1",
  "wing.define": "Ctrl+2",
  "wing.plan": "Ctrl+3",
  "wing.execute": "Ctrl+4",
  "wing.review": "Ctrl+5",
  "wing.next": "Ctrl+PageDown",
  "wing.previous": "Ctrl+PageUp",
  "page.next": "Ctrl+Shift+PageDown",
  "page.previous": "Ctrl+Shift+PageUp",
  "history.back": "Alt+ArrowLeft",
  "history.forward": "Alt+ArrowRight",
  "panel.sidebar.toggle": "Ctrl+B",
  "panel.chat.toggle": "Ctrl+J",
  "surface.settings.open": "Ctrl+Comma",
};

/** The page's four groups, in the order the action table declares them. */
const EXPECTED_GROUPS = [
  { id: "wings", rows: 7 },
  { id: "pages", rows: 4 },
  { id: "panels", rows: 2 },
  { id: "surfaces", rows: 1 },
];

const SHOTS = {
  defaults: "keyboard-shortcuts-defaults.png",
  search: "keyboard-shortcuts-search.png",
  recording: "keyboard-shortcuts-recording.png",
  rebound: "keyboard-shortcuts-rebound.png",
  conflict: "keyboard-shortcuts-conflict.png",
  cleared: "keyboard-shortcuts-cleared.png",
  reload: "keyboard-shortcuts-reload.png",
  typing: "keyboard-shortcuts-typing-guard.png",
  dock: "keyboard-shortcuts-dock.png",
  dockLive: "keyboard-shortcuts-dock-live.png",
  dockEditing: "keyboard-shortcuts-dock-editing.png",
};

/**
 * One snapshot of the page, the shell and the store.
 *
 * Everything the checks need is read here, and anything that is not there comes
 * back as `null` / `false` / an empty list, so a missing element is a named
 * failure in the assertions instead of a selector throwing somewhere in the
 * driver.
 */
const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const present = (selector) => Boolean(document.querySelector(selector));

  const overlay = document.querySelector("[data-settings-overlay]");
  const search = document.querySelector(".settings-overlay__search-input");
  const main = document.querySelector(".settings-overlay__main");
  const shell = document.querySelector(".shell");
  const input = document.querySelector("[data-rig-input]");

  const nav = Array.from(document.querySelectorAll(".settings-nav-item")).map((el) => ({
    label: text(el.querySelector(".settings-nav-item__label")),
    active: el.classList.contains("is-active"),
    match: text(el.querySelector(".settings-nav-item__match")) || null,
  }));

  const groups = Array.from(document.querySelectorAll("[data-shortcut-group]")).map((group) => ({
    id: attr(group, "data-shortcut-group"),
    rows: Array.from(group.querySelectorAll("[data-shortcut-row]")).map((row) =>
      attr(row, "data-shortcut-row"),
    ),
  }));

  const rows = Array.from(document.querySelectorAll("[data-shortcut-row]")).map((row) => {
    const keys = row.querySelector("[data-shortcut-keys]");
    const keycaps = keys
      ? Array.from(keys.querySelectorAll(".settings-shortcuts__keycap")).map(text)
      : [];
    const defaultLine = row.querySelector(".settings-shortcuts__default");
    return {
      id: attr(row, "data-shortcut-row"),
      label: text(row.querySelector(".settings-shortcuts__label")),
      binding: attr(row, "data-binding"),
      recording: attr(row, "data-recording") === "true",
      customized: attr(row, "data-customized") === "true",
      prompt: Boolean(row.querySelector("[data-shortcut-recording-prompt]")),
      keysValue: keys ? attr(keys, "data-shortcut-keys") : null,
      keycaps,
      defaultText: defaultLine ? text(defaultLine) : null,
      buttons: Array.from(row.querySelectorAll("button")).map((button) =>
        attr(button, "aria-label"),
      ),
    };
  });

  const error = document.querySelector('[data-shortcuts-message="error"]');
  const resetAll = document.querySelector("[data-shortcuts-reset-all]");
  const footer = document.querySelector(".settings-shortcuts__footer");
  const footerStatus = footer ? footer.querySelector('[role="status"]') : null;

  let storage = null;
  try {
    storage = window.localStorage.getItem("lifequest-keyboard-shortcuts");
  } catch (storageError) {
    storage = "unavailable";
  }

  const wingTabs = Array.from(
    document.querySelectorAll(".top-bar__wings [role='tab']"),
  ).map((tab) => ({
    label: text(tab),
    selected: tab.getAttribute("aria-selected") === "true",
  }));

  /** On screen now — not merely in the DOM: the dock keeps every surface mounted
   *  and hides the ones it is not showing. */
  const visible = (el) => {
    if (!el) return false;
    if (el.hasAttribute("hidden")) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  };

  const iconClass = (el) => {
    const svg = el ? el.querySelector("svg") : null;
    if (!svg) return null;
    return Array.from(svg.classList).find((name) => name.startsWith("lucide-")) ?? null;
  };

  const chatPanel = document.querySelector("aside.chat-panel");
  const chatShortcutsHeader = document.querySelector(".chat-panel__header--shortcuts");
  const chatFooter = document.querySelector(".chat-panel__footer");
  const chatShortcutsBody = document.querySelector(".chat-panel__body--shortcuts");
  const chatComposer = document.querySelector(".chat-panel__composer");
  const chatBack = document.querySelector(
    '.chat-panel__header--shortcuts button[aria-label="Back to chat"]',
  );
  const chatPencil = document.querySelector(
    '.chat-panel__header--shortcuts a[aria-label="Change keyboard shortcuts in Settings"]',
  );
  const trailing = document.querySelector(".window-titlebar__trailing");
  const shortcutsButton = document.querySelector(
    "button.window-titlebar__shortcuts",
  );

  const chatShortcutGroups = Array.from(
    document.querySelectorAll("[data-chat-shortcut-group]"),
  ).map((group) => ({
    id: attr(group, "data-chat-shortcut-group"),
    rows: Array.from(group.querySelectorAll("[data-chat-shortcut-row]")).map((row) =>
      attr(row, "data-chat-shortcut-row"),
    ),
  }));

  const chatShortcutRows = Array.from(
    document.querySelectorAll("[data-chat-shortcut-row]"),
  ).map((row) => {
    const keys = row.querySelector("[data-chat-shortcut-keys]");
    const edit = row.querySelector("button.chat-shortcuts__edit");
    const cancel = row.querySelector(
      'button[aria-label^="Cancel changing the shortcut for"]',
    );
    return {
      id: attr(row, "data-chat-shortcut-row"),
      label: text(row.querySelector(".chat-shortcuts__label")),
      binding: attr(row, "data-binding"),
      changed: attr(row, "data-changed") === "true",
      recording: attr(row, "data-recording") === "true",
      prompt: Boolean(row.querySelector("[data-chat-shortcut-recording-prompt]")),
      edit: edit
        ? {
            present: true,
            label: attr(edit, "aria-label"),
            title: attr(edit, "title"),
          }
        : { present: false, label: null, title: null },
      cancel: cancel
        ? { present: true, label: attr(cancel, "aria-label") }
        : { present: false, label: null },
      keysValue: keys ? attr(keys, "data-chat-shortcut-keys") : null,
      keycaps: keys
        ? Array.from(keys.querySelectorAll(".chat-shortcuts__keycap")).map(text)
        : [],
    };
  });

  const trailingChildren = Array.from(trailing ? trailing.children : []).map((el) => ({
    tag: el.tagName.toLowerCase(),
    className: typeof el.className === "string" ? el.className : "",
    label: attr(el, "aria-label"),
    pressed: attr(el, "aria-pressed"),
    icon: iconClass(el),
  }));

  return {
    path: document.body.dataset.rigPath || null,
    overlayOpen: Boolean(overlay),
    panelPresent: Boolean(document.querySelector(".settings-overlay__panel")),
    bodyOverflow: getComputedStyle(document.body).overflow,
    backgroundPage: Boolean(document.querySelector("[data-rig-page='home']")),
    backgroundPages: Array.from(document.querySelectorAll("[data-rig-page]")).map((el) => ({
      name: attr(el, "data-rig-page"),
      title: text(el.querySelector("h1")),
    })),
    viewedTab: attr(main, "data-settings-view"),
    nav,
    navEmpty: text(document.querySelector(".settings-overlay__nav-empty")) || null,
    pageTitle: text(document.querySelector(".settings-panel__title")),
    pageSubtitle: text(document.querySelector(".settings-panel__subtitle")),
    shortcutsRoot: present("[data-settings-shortcuts]"),
    groups,
    rows,
    promptCount: document.querySelectorAll("[data-shortcut-recording-prompt]").length,
    error: error ? text(error) : null,
    status: footerStatus ? text(footerStatus) : null,
    resetAll: resetAll
      ? { present: true, disabled: resetAll.disabled }
      : { present: false, disabled: null },
    storage,
    shellClass: shell ? shell.className : null,
    chatPanel: present(".chat-panel"),
    dock: chatPanel
      ? {
          surface: attr(chatPanel, "data-chat-surface"),
          ariaLabel: attr(chatPanel, "aria-label"),
          shortcutsHeading: text(
            chatShortcutsHeader
              ? chatShortcutsHeader.querySelector(".chat-panel__heading")
              : null,
          ),
          back: chatBack
            ? { present: true, label: attr(chatBack, "aria-label") }
            : { present: false, label: null },
          pencil: chatPencil
            ? {
                present: true,
                label: attr(chatPencil, "aria-label"),
                href: attr(chatPencil, "href"),
              }
            : { present: false, label: null, href: null },
          footerHidden: chatFooter ? chatFooter.hasAttribute("hidden") : null,
          footerVisible: visible(chatFooter),
          composerVisible: visible(chatComposer),
          bodyVisible: visible(chatShortcutsBody),
          shortcutsRoot: present("[data-chat-shortcuts]"),
          hint: text(document.querySelector(".chat-shortcuts__hint")),
          editCount: document.querySelectorAll(".chat-shortcuts__edit").length,
          recordingPromptCount: document.querySelectorAll(
            "[data-chat-shortcut-recording-prompt]",
          ).length,
          editingError: text(
            document.querySelector("[data-chat-shortcuts-error]"),
          ) || null,
          groups: chatShortcutGroups,
          rows: chatShortcutRows,
        }
      : null,
    titlebar: {
      shortcuts: shortcutsButton
        ? {
            present: true,
            label: attr(shortcutsButton, "aria-label"),
            title: attr(shortcutsButton, "title"),
            pressed: attr(shortcutsButton, "aria-pressed"),
            icon: iconClass(shortcutsButton),
            inTrailing: Boolean(trailing && trailing.contains(shortcutsButton)),
          }
        : {
            present: false,
            label: null,
            title: null,
            pressed: null,
            icon: null,
            inTrailing: false,
          },
      trailing: trailingChildren,
    },
    wingTabs,
    selectedWing: (() => {
      const selected = wingTabs.find((tab) => tab.selected);
      return selected ? selected.label : null;
    })(),
    vaultText: text(document.querySelector(".window-titlebar__vault")),
    focused: document.activeElement
      ? {
          tag: document.activeElement.tagName.toLowerCase(),
          id: document.activeElement.id || null,
          className:
            typeof document.activeElement.className === "string"
              ? document.activeElement.className
              : null,
        }
      : null,
    input: input
      ? {
          present: true,
          value: input.value,
          focused: document.activeElement === input,
        }
      : { present: false, value: null, focused: false },
    searchValue: search ? search.value : null,
    searchFocused: search ? document.activeElement === search : false,
    keyLog: (window.keyboardShortcutsKeyLog || []).slice(-6),
  };
})()`;

const states = {};
const steps = {};
const screenshots = [];
const failures = [];

const check = (label, condition, detail) => {
  if (!condition) failures.push(`${step} — ${label}: ${detail}`);
  return Boolean(condition);
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const rowById = (state, id) => (state?.rows ?? []).find((row) => row.id === id) || null;

const dockRow = (state, id) =>
  (state?.dock?.rows ?? []).find((row) => row.id === id) || null;


/** The bindings object in storage, `null` when nothing is stored, or the string
 *  "unparseable" — never a throw, so a check can name the bad artifact. */
const storedBindings = (state) => {
  if (state?.storage === null) return null;
  try {
    const parsed = JSON.parse(state.storage);
    return parsed &&
      typeof parsed === "object" &&
      parsed.bindings &&
      typeof parsed.bindings === "object"
      ? parsed.bindings
      : null;
  } catch (error) {
    return "unparseable";
  }
};

const lastKey = (state) => {
  const log = state?.keyLog ?? [];
  return log.length ? log[log.length - 1] : null;
};

function checkRows(state, label) {
  check(
    `${label}: the page renders exactly the fourteen movements`,
    state.rows.length === 14,
    `${state.rows.length} rows: ${JSON.stringify(state.rows.map((row) => row.id))}`,
  );
  for (const [id, binding] of Object.entries(EXPECTED_DEFAULTS)) {
    const row = rowById(state, id);
    check(
      `${label}: the ${id} row carries its default`,
      row !== null && row.binding === binding,
      `row ${JSON.stringify(row && row.binding)} vs ${binding}`,
    );
  }
}

/** A structured state recorded under `name`, with the last step set first. */
let step = "start";
const at = (name) => {
  step = name;
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

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
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frames = () =>
    run(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
    );

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(250);
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 180) => {
    await sleep(ms);
    await frames();
    return sample();
  };

  /**
   * Poll a page-side condition before the next sample.
   *
   * React Router resolves a navigation in a transition, so a click on a nav row
   * can return before the panel it opened has painted. Sampling on a timer would
   * make the rig flaky; every state-changing interaction below names the DOM fact
   * it is waiting for instead.
   */
  const waitFor = async (expression, description, timeoutMs = 6_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await run(expression);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(60);
    }
    throw new Error(
      `[${step}] timed out waiting for ${description}${lastError ? `: ${lastError}` : ""}`,
    );
  };

  const record = async (name, readyExpression) => {
    if (readyExpression) await waitFor(readyExpression, `${name} to settle`);
    const state = await settle();
    states[name] = state;
    return state;
  };

  const shot = async (key) => {
    await frames();
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, SHOTS[key]);
    fs.writeFileSync(file, image.toPNG());
    if (!screenshots.includes(SHOTS[key])) screenshots.push(SHOTS[key]);
    return SHOTS[key];
  };

  /**
   * Vite re-optimises dependencies the first time a new import appears and
   * reloads the page when it does, which clears the harness globals mid-wait —
   * so poll instead of assuming the first evaluate lands after the module ran.
   */
  const waitForHarness = async (timeoutMs = 40_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const name = await run(`(async () => {
          if (typeof window.keyboardShortcutsReady !== "object") return null;
          await window.keyboardShortcutsReady;
          return typeof window.keyboardShortcutsVaultName === "string"
            ? window.keyboardShortcutsVaultName
            : null;
        })()`);
        if (typeof name === "string") return name;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await sleep(250);
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  /**
   * A real key press: keyDown/keyUp through the browser's input pipeline, with
   * the modifiers as Electron names them. No `char` event unless the caller
   * types text — a shortcut is a keydown, and a `char` would leak a character
   * into whatever field happens to hold the caret.
   */
  const press = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    await sleep(25);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(110);
    await frames();
  };

  /** Type text the way a keyboard does: keyDown, char, keyUp per character. */
  const typeText = async (value) => {
    for (const character of value) {
      const keyCode = character === " " ? "Space" : character;
      win.webContents.sendInputEvent({ type: "keyDown", keyCode });
      win.webContents.sendInputEvent({ type: "char", keyCode });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode });
      await sleep(35);
    }
    await frames();
  };

  const focusSelector = async (selector) => {
    const focused = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.focus();
      return document.activeElement === el;
    })()`);
    if (!focused) throw new Error(`[${step}] no focusable element for ${selector}`);
    await frames();
  };

  const blurActive = () =>
    run(`(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return document.activeElement === document.body;
    })()`);

  const scrollTo = async (selector, block = "center") => {
    const scrolled = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: ${JSON.stringify(block)} });
      return true;
    })()`);
    if (!scrolled) throw new Error(`[${step}] cannot scroll to ${selector}`);
    await frames();
    await sleep(40);
  };

  const scrollMainTop = () =>
    run(`(() => {
      const scroller =
        document.querySelector(".settings-overlay__main-scroll") ||
        document.querySelector(".settings-overlay__main");
      if (!scroller) return false;
      scroller.scrollTop = 0;
      return true;
    })()`);

  const clickSelector = async (selector) => {
    const clicked = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`[${step}] no element for ${selector}`);
    await frames();
  };

  const clickNav = async (label, viewId) => {
    const clicked = await run(`(() => {
      const el = Array.from(document.querySelectorAll(".settings-nav-item")).find(
        (item) =>
          (((item.querySelector(".settings-nav-item__label") || {}).textContent) || "").trim() ===
          ${JSON.stringify(label)}
      );
      if (!el) return false;
      el.scrollIntoView({ block: "nearest" });
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`[${step}] no settings nav row named "${label}"`);
    if (viewId) {
      await waitFor(
        `(() => {
          const main = document.querySelector("main.settings-overlay__main");
          return Boolean(main && main.getAttribute("data-settings-view") === ${JSON.stringify(viewId)});
        })()`,
        `the ${viewId} settings panel`,
      );
    }
    await frames();
  };

  const clickRowButton = async (actionId, labelPrefix) => {
    const clicked = await run(`(() => {
      const row = document.querySelector('[data-shortcut-row="${actionId}"]');
      if (!row) return false;
      const button = Array.from(row.querySelectorAll("button")).find((el) =>
        (el.getAttribute("aria-label") || "").startsWith(${JSON.stringify(labelPrefix)})
      );
      if (!button) return false;
      button.scrollIntoView({ block: "nearest" });
      button.click();
      return true;
    })()`);
    if (!clicked) {
      throw new Error(`[${step}] no "${labelPrefix}" button in row ${actionId}`);
    }
    await frames();
  };

  const openSettings = async () => {
    await press(",", ["control"]);
    await waitFor(
      "Boolean(document.querySelector('[data-settings-overlay]'))",
      "the settings sheet to open",
    );
    return settle();
  };

  const timeout = setTimeout(() => {
    console.error("keyboard-shortcuts: timed out after 180s");
    app.exit(1);
  }, 180_000);

  let report;

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // A stored binding left by an earlier run would make "every movement is on
    // its default" pass before anything was proved. Clear it, then reload so the
    // provider reads the empty store at mount, exactly as a fresh launch would.
    await run(
      "(() => { try { localStorage.removeItem('lifequest-keyboard-shortcuts'); } catch (error) {} return true; })()",
    );
    await win.webContents.reload();
    await waitForHarness();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    win.showInactive();

    // —— 0 — the harness itself: the shell, the page behind it, nothing stored.
    at("landing");
    const landing = await record("landing");
    check("the shell is on the home stub", landing.path === "/home", `path ${landing.path}`);
    check(
      "the home stub carries the rig input",
      landing.input.present === true,
      `input ${JSON.stringify(landing.input)}`,
    );
    check(
      "the run starts with no stored overrides",
      landing.storage === null,
      `storage ${JSON.stringify(landing.storage)}`,
    );
    check(
      "the titlebar wears the harness vault's name",
      landing.vaultText === vaultName,
      `chip ${JSON.stringify(landing.vaultText)} vs ${JSON.stringify(vaultName)}`,
    );

    // —— 1 (dock) — the titlebar's shortcuts control opens the dock onto its
    //        read-only reference: the shared table, every movement on its
    //        default, Back to the thread, and no composer under it.
    at("dock shortcuts from the titlebar");
    const dockThread = await record(
      "dockThread",
      'document.querySelector(".chat-panel").getAttribute("data-chat-surface") === "thread"',
    );
    const trailingClasses = (dockThread.titlebar.trailing ?? []).map(
      (child) => child.className,
    );
    check(
      "the dock starts on the thread surface",
      dockThread.dock !== null &&
        dockThread.dock.surface === "thread" &&
        dockThread.dock.composerVisible === true,
      `surface ${JSON.stringify(dockThread.dock && dockThread.dock.surface)}, composer ${JSON.stringify(dockThread.dock && dockThread.dock.composerVisible)}`,
    );
    check(
      "the titlebar carries a Keyboard shortcuts control",
      dockThread.titlebar.shortcuts.present === true &&
        dockThread.titlebar.shortcuts.label === "Keyboard shortcuts" &&
        dockThread.titlebar.shortcuts.title === "Keyboard shortcuts" &&
        dockThread.titlebar.shortcuts.pressed === "false" &&
        dockThread.titlebar.shortcuts.inTrailing === true,
      `control ${JSON.stringify(dockThread.titlebar.shortcuts)}`,
    );
    check(
      "the shortcuts control sits immediately before the settings menu",
      trailingClasses.findIndex((name) => name.includes("window-titlebar__shortcuts")) ===
        trailingClasses.findIndex((name) => name.includes("settings-menu")) - 1,
      `trailing cluster ${JSON.stringify(trailingClasses)}`,
    );
    check(
      "the trailing cluster keeps its shipped order",
      ["theme-mode-toggle", "window-titlebar__shortcuts", "settings-menu", "window-titlebar__side-switch", "window-titlebar__chat-toggle"].every(
        (needle, index) => String(trailingClasses[index] ?? "").includes(needle),
      ),
      `trailing cluster ${JSON.stringify(trailingClasses)}`,
    );

    at("the dock renders the shortcuts reference");
    await clickSelector(".window-titlebar__shortcuts");
    const dockDefaults = await record(
      "dockDefaults",
      'document.querySelector("aside.chat-panel").getAttribute("data-chat-surface") === "shortcuts"',
    );
    await shot("dock");
    const dock = dockDefaults.dock;
    check(
      "the titlebar control turns the dock onto the shortcuts surface",
      dock !== null && dock.surface === "shortcuts",
      `surface ${JSON.stringify(dock && dock.surface)}`,
    );
    check(
      "the dock page is titled Keyboard shortcuts and carries its way back",
      dock.shortcutsHeading === "Keyboard shortcuts" &&
        dock.back.present === true &&
        dock.back.label === "Back to chat",
      `heading ${JSON.stringify(dock.shortcutsHeading)}, back ${JSON.stringify(dock.back)}`,
    );
    check(
      "the dock page carries the Settings pencil",
      dock.pencil.present === true &&
        dock.pencil.label === "Change keyboard shortcuts in Settings" &&
        dock.pencil.href === "/settings?tab=shortcuts",
      `pencil ${JSON.stringify(dock.pencil)}`,
    );
    check(
      "the dock page renders the shortcuts table read-only",
      dock.shortcutsRoot === true &&
        same(
          dock.groups.map((group) => ({ id: group.id, rows: group.rows.length })),
          EXPECTED_GROUPS,
        ) &&
        dock.rows.length === 14,
      `root ${dock.shortcutsRoot}, groups ${JSON.stringify(dock.groups)}, rows ${dock.rows.length}`,
    );
    check(
      "every dock row is on its default binding",
      dock.rows.every(
        (row) => row.binding === EXPECTED_DEFAULTS[row.id] && !row.changed,
      ),
      `rows ${JSON.stringify(dock.rows.map((row) => [row.id, row.binding, row.changed]))}`,
    );
    check(
      "the dock prints the default keycaps",
      same(dockRow(dockDefaults, "wing.next").keycaps, ["Ctrl", "PgDn"]) &&
        same(dockRow(dockDefaults, "history.back").keycaps, ["Alt", "←"]) &&
        same(dockRow(dockDefaults, "surface.settings.open").keycaps, ["Ctrl", ","]),
      `keycaps ${JSON.stringify(dock.rows.map((row) => [row.id, row.keycaps]))}`,
    );
    check(
      "the dock hint says all movements are on their defaults",
      typeof dock.hint === "string" &&
        dock.hint.includes("All on their default keys."),
      `hint ${JSON.stringify(dock.hint)}`,
    );
    check(
      "the dock hides its composer and footer on the reference",
      dock.footerHidden === true &&
        dock.footerVisible === false &&
        dock.composerVisible === false &&
        dock.bodyVisible === true,
      `footer hidden ${dock.footerHidden}, footer visible ${dock.footerVisible}, composer ${dock.composerVisible}, body ${dock.bodyVisible}`,
    );
    check(
      "the titlebar control reports itself pressed on the page",
      dockDefaults.titlebar.shortcuts.pressed === "true",
      `pressed ${JSON.stringify(dockDefaults.titlebar.shortcuts.pressed)}`,
    );

    at("dock Back returns to the thread");
    await clickSelector(
      '.chat-panel__header--shortcuts button[aria-label="Back to chat"]',
    );
    const dockBack = await record(
      "dockBackToThread",
      'document.querySelector(".chat-panel").getAttribute("data-chat-surface") === "thread"',
    );
    check(
      "Back returns the dock to the thread",
      dockBack.dock.surface === "thread" &&
        dockBack.dock.composerVisible === true,
      `surface ${JSON.stringify(dockBack.dock.surface)}, composer ${dockBack.dock.composerVisible}`,
    );
    check(
      "the titlebar control stops reporting pressed off the page",
      dockBack.titlebar.shortcuts.pressed === "false",
      `pressed ${JSON.stringify(dockBack.titlebar.shortcuts.pressed)}`,
    );

    // —— 1 — the shipped surface shortcut opens settings over the page, and the
    //        Keyboard page is one nav row away.
    at("open settings from Ctrl+Comma");
    const opened = await openSettings();
    steps.openedBy = "Ctrl+Comma";
    check(
      "the settings sheet is the app's own overlay",
      opened.panelPresent === true && opened.bodyOverflow === "hidden",
      `panel ${opened.panelPresent}, body overflow ${opened.bodyOverflow}`,
    );
    check(
      "the home stub stayed mounted behind the sheet",
      opened.backgroundPage === true,
      `background pages ${JSON.stringify(opened.backgroundPages)}`,
    );
    check(
      "the settings nav shows a Keyboard row",
      opened.nav.some((row) => row.label === "Keyboard"),
      `nav ${JSON.stringify(opened.nav.map((row) => row.label))}`,
    );

    at("Keyboard page defaults");
    await clickNav("Keyboard", "shortcuts");
    const defaults = await record(
      "defaults",
      "document.querySelectorAll('[data-shortcut-row]').length === 14",
    );
    await scrollMainTop();
    await frames();
    await shot("defaults");

    check(
      "the Keyboard nav row is the active one",
      (defaults.nav.find((row) => row.label === "Keyboard") || {}).active === true,
      `nav ${JSON.stringify(defaults.nav)}`,
    );
    check(
      "the page is the shortcuts view",
      defaults.viewedTab === "shortcuts",
      `view ${JSON.stringify(defaults.viewedTab)}`,
    );
    check(
      "the page title is Keyboard shortcuts",
      defaults.pageTitle === "Keyboard shortcuts",
      `title ${JSON.stringify(defaults.pageTitle)}`,
    );
    check(
      "the page root is the shortcuts card",
      defaults.shortcutsRoot === true,
      "no [data-settings-shortcuts]",
    );
    check(
      "the page has the four groups the action table declares",
      same(
        defaults.groups.map((group) => ({ id: group.id, rows: group.rows.length })),
        EXPECTED_GROUPS,
      ),
      `groups ${JSON.stringify(defaults.groups)}`,
    );
    checkRows(defaults, "defaults");
    check(
      "every wired default keycap is printed",
      same(rowById(defaults, "wing.next").keycaps, ["Ctrl", "PgDn"]) &&
        same(rowById(defaults, "history.back").keycaps, ["Alt", "←"]) &&
        same(rowById(defaults, "surface.settings.open").keycaps, ["Ctrl", ","]) &&
        same(rowById(defaults, "page.next").keycaps, ["Ctrl", "Shift", "PgDn"]) &&
        same(rowById(defaults, "wing.home").keycaps, ["Ctrl", "1"]),
      `keycaps ${JSON.stringify(
        Object.fromEntries(defaults.rows.map((row) => [row.id, row.keycaps])),
      )}`,
    );
    check(
      "every row is an un-customized, non-recording default",
      defaults.rows.every((row) => !row.customized && !row.recording && !row.prompt) &&
        defaults.promptCount === 0,
      `rows ${JSON.stringify(defaults.rows.map((row) => [row.id, row.customized, row.recording]))}`,
    );
    check(
      "no overrides are stored on the first visit",
      storedBindings(defaults) === null && defaults.storage === null,
      `storage ${JSON.stringify(defaults.storage)}`,
    );
    check(
      "the footer says every movement is on its default",
      typeof defaults.status === "string" &&
        defaults.status.includes("Every movement is on its default key."),
      `status ${JSON.stringify(defaults.status)}`,
    );
    check(
      "Restore all defaults starts disabled",
      defaults.resetAll.present === true && defaults.resetAll.disabled === true,
      `reset all ${JSON.stringify(defaults.resetAll)}`,
    );

    // —— 2 — the sheet's search finds the Keyboard page by the word an operator
    //        would type, and keeps the panel on its subject.
    at("search for shortcut");
    await focusSelector(".settings-overlay__search-input");
    await typeText("shortcut");
    const searched = await record(
      "searched",
      `document.querySelectorAll(".settings-nav-item").length === 1 &&
        document.querySelectorAll("[data-shortcut-row]").length === 14`,
    );
    await shot("search");
    check(
      "searching \"shortcut\" narrows the nav to the Keyboard row",
      same(searched.nav.map((row) => row.label), ["Keyboard"]),
      `nav ${JSON.stringify(searched.nav)}`,
    );
    check(
      "the narrowed row is active",
      searched.nav[0].active === true,
      `nav ${JSON.stringify(searched.nav)}`,
    );
    check(
      "the search found the page, not just the row",
      searched.viewedTab === "shortcuts" &&
        searched.pageTitle === "Keyboard shortcuts" &&
        searched.shortcutsRoot === true,
      `view ${JSON.stringify(searched.viewedTab)}, title ${JSON.stringify(searched.pageTitle)}`,
    );
    check(
      "the search input carries the query",
      searched.searchValue === "shortcut",
      `search ${JSON.stringify(searched.searchValue)}`,
    );

    at("clear search");
    await clickSelector(".settings-overlay__search-clear");
    const searchCleared = await record(
      "searchCleared",
      'document.querySelectorAll(".settings-nav-item").length === 10',
    );
    check(
      "clearing the search restores the whole section list",
      searchCleared.nav.length === 10 && searchCleared.searchValue === "",
      `${searchCleared.nav.length} rows, search ${JSON.stringify(searchCleared.searchValue)}`,
    );
    check(
      "the panel stays on the Keyboard page after clearing",
      searchCleared.viewedTab === "shortcuts",
      `view ${JSON.stringify(searchCleared.viewedTab)}`,
    );

    // —— 3 — record a new key for Next wing; it is stored, it is drawn, and it
    //        moves the shell once the sheet is gone.
    at("record Next wing");
    await clickRowButton("wing.next", "Change shortcut for");
    const recording = await record(
      "recording",
      "document.querySelector('[data-shortcut-row=\"wing.next\"]').getAttribute('data-recording') === 'true'",
    );
    await scrollTo('[data-shortcut-row="wing.next"]');
    await shot("recording");
    const recordingRow = rowById(recording, "wing.next");
    check(
      "the Next wing row says it is recording",
      recordingRow.recording === true && recordingRow.prompt === true,
      `row ${JSON.stringify(recordingRow)}`,
    );
    check(
      "the recording prompt is the page's own",
      recording.promptCount === 1 && recordingRow.buttons.includes("Cancel changing the shortcut for Next wing"),
      `prompts ${recording.promptCount}, buttons ${JSON.stringify(recordingRow.buttons)}`,
    );

    at("press Ctrl+Alt+N");
    await press("N", ["control", "alt"]);
    const rebound = await record(
      "rebound",
      "document.querySelector('[data-shortcut-row=\"wing.next\"]').getAttribute('data-binding') === 'Ctrl+Alt+N'",
    );
    await scrollTo('[data-shortcut-row="wing.next"]');
    await shot("rebound");
    const reboundRow = rowById(rebound, "wing.next");
    check(
      "the recorded combination is the row's binding",
      reboundRow.binding === "Ctrl+Alt+N",
      `binding ${JSON.stringify(reboundRow.binding)}`,
    );
    check(
      "the rebound row is marked customized and its default is named",
      reboundRow.customized === true &&
        reboundRow.defaultText === "Default: Ctrl + PgDn",
      `customized ${reboundRow.customized}, default ${JSON.stringify(reboundRow.defaultText)}`,
    );
    check(
      "the rebound row draws the pressed keycaps",
      same(reboundRow.keycaps, ["Ctrl", "Alt", "N"]),
      `keycaps ${JSON.stringify(reboundRow.keycaps)}`,
    );
    check(
      "recording stopped once the binding was accepted",
      reboundRow.recording === false &&
        rebound.promptCount === 0 &&
        rebound.error === null,
      `row ${JSON.stringify(reboundRow)}, prompts ${rebound.promptCount}, error ${JSON.stringify(rebound.error)}`,
    );
    check(
      "storage carries only the override",
      same(storedBindings(rebound), { "wing.next": "Ctrl+Alt+N" }),
      `storage ${JSON.stringify(rebound.storage)}`,
    );
    check(
      "the footer counts one changed movement",
      typeof rebound.status === "string" &&
        rebound.status.includes("1 movement is changed"),
      `status ${JSON.stringify(rebound.status)}`,
    );

    at("close the sheet and use the new key");
    await press("Escape");
    const closedAfterRebind = await record(
      "closedAfterRebind",
      '!document.querySelector("[data-settings-overlay]") && document.body.dataset.rigPath === "/home"',
    );
    check(
      "Escape closes the sheet once nothing is recording",
      closedAfterRebind.overlayOpen === false &&
        closedAfterRebind.path === "/home",
      `overlay ${closedAfterRebind.overlayOpen}, path ${closedAfterRebind.path}`,
    );
    // —— 3 (dock) — the dock reads the same provider the Settings page writes:
    //        the row it just rebound shows its new keys, and the hint counts it.
    at("the dock reflects the live binding");
    await clickSelector(".window-titlebar__shortcuts");
    const dockLive = await record(
      "dockLive",
      'document.querySelector("aside.chat-panel").getAttribute("data-chat-surface") === "shortcuts"',
    );
    await shot("dockLive");
    const liveDockRow = dockRow(dockLive, "wing.next");
    check(
      "the dock row shows the binding the settings page just stored",
      liveDockRow !== null &&
        liveDockRow.binding === "Ctrl+Alt+N" &&
        liveDockRow.changed === true &&
        same(liveDockRow.keycaps, ["Ctrl", "Alt", "N"]),
      `row ${JSON.stringify(liveDockRow)}`,
    );
    check(
      "the dock hint counts the one changed movement",
      typeof dockLive.dock.hint === "string" &&
        dockLive.dock.hint.includes(
          "1 movement is changed from the defaults.",
        ),
      `hint ${JSON.stringify(dockLive.dock.hint)}`,
    );
    check(
      "the customized row is the only changed row in the dock",
      dockLive.dock.rows
        .filter((row) => row.changed)
        .map((row) => row.id)
        .join(",") === "wing.next",
      `changed ${JSON.stringify(dockLive.dock.rows.filter((row) => row.changed).map((row) => row.id))}`,
    );

    at("the dock pencil opens the settings page");
    await clickSelector(
      '.chat-panel__header--shortcuts a[aria-label="Change keyboard shortcuts in Settings"]',
    );
    const dockPencil = await record(
      "dockPencilSettings",
      'Boolean(document.querySelector("[data-settings-overlay]")) && document.body.dataset.rigPath === "/settings?tab=shortcuts"',
    );
    check(
      "the pencil opens settings on the shortcuts page",
      dockPencil.overlayOpen === true &&
        dockPencil.viewedTab === "shortcuts" &&
        dockPencil.pageTitle === "Keyboard shortcuts",
      `overlay ${dockPencil.overlayOpen}, view ${JSON.stringify(dockPencil.viewedTab)}, title ${JSON.stringify(dockPencil.pageTitle)}`,
    );
    check(
      "the dock stays on its reference behind the sheet",
      dockPencil.dock.surface === "shortcuts",
      `surface ${JSON.stringify(dockPencil.dock.surface)}`,
    );

    at("Escape closes the sheet, not the dock page");
    await press("Escape");
    const dockAfterSettings = await record(
      "dockAfterSettingsClose",
      '!document.querySelector("[data-settings-overlay]") && document.querySelector("aside.chat-panel").getAttribute("data-chat-surface") === "shortcuts"',
    );
    check(
      "Escape closes the settings sheet and leaves the dock on the reference",
      dockAfterSettings.overlayOpen === false &&
        dockAfterSettings.path === "/home" &&
        String(dockAfterSettings.shellClass).includes("shell--chat-open") &&
        dockAfterSettings.dock.surface === "shortcuts",
      `overlay ${dockAfterSettings.overlayOpen}, path ${dockAfterSettings.path}, shell ${JSON.stringify(dockAfterSettings.shellClass)}, surface ${JSON.stringify(dockAfterSettings.dock.surface)}`,
    );
    await clickSelector(
      '.chat-panel__header--shortcuts button[aria-label="Back to chat"]',
    );
    const dockBackAfterSettings = await record(
      "dockBackAfterSettings",
      'document.querySelector(".chat-panel").getAttribute("data-chat-surface") === "thread"',
    );
    check(
      "the dock returns to the thread before the movement step",
      dockBackAfterSettings.dock.surface === "thread",
      `surface ${JSON.stringify(dockBackAfterSettings.dock.surface)}`,
    );

    await press("N", ["control", "alt"]);
    const reboundMovement = await record(
      "reboundMovement",
      'document.body.dataset.rigPath === "/dream"',
    );
    const reboundKey = lastKey(reboundMovement);
    check(
      "Ctrl+Alt+N now moves to the next wing",
      reboundMovement.path === "/dream" && reboundMovement.selectedWing === "Define",
      `path ${reboundMovement.path}, wing ${reboundMovement.selectedWing}`,
    );
    check(
      "the movement key arrived through the input pipeline with both modifiers",
      reboundKey !== null &&
        reboundKey.key === "n" &&
        reboundKey.ctrl === true &&
        reboundKey.alt === true,
      `key ${JSON.stringify(reboundKey)}`,
    );

    // —— 4 — a combination another movement owns is refused, the refusal names
    //        that movement, and the runner stands down while the row records.
    at("conflict with Toggle sidebar");
    await openSettings();
    await clickNav("Keyboard", "shortcuts");
    await clickRowButton("wing.previous", "Change shortcut for");
    await record(
      "recordingPrevious",
      'document.querySelector(\'[data-shortcut-row="wing.previous"]\').getAttribute("data-recording") === "true"',
    );
    await press("B", ["control"]);
    const conflict = await record(
      "conflict",
      'Boolean(document.querySelector(\'[data-shortcuts-message="error"]\'))',
    );
    await scrollTo('[data-shortcuts-message="error"]');
    await shot("conflict");
    const conflictRow = rowById(conflict, "wing.previous");
    const conflictKey = lastKey(conflict);
    check(
      "the conflict error names the movement that owns the key",
      typeof conflict.error === "string" && conflict.error.includes("Toggle sidebar"),
      `error ${JSON.stringify(conflict.error)}`,
    );
    check(
      "the refused row keeps its binding",
      conflictRow.binding === "Ctrl+PageUp",
      `binding ${JSON.stringify(conflictRow.binding)}`,
    );
    check(
      "the refused row is still recording",
      conflictRow.recording === true && conflict.promptCount === 1,
      `row ${JSON.stringify(conflictRow)}, prompts ${conflict.promptCount}`,
    );
    check(
      "the runner did not fire the conflicting movement",
      !String(conflict.shellClass).includes("shell--nav-collapsed"),
      `shell ${JSON.stringify(conflict.shellClass)}`,
    );
    check(
      "the conflicting key really was Ctrl+B",
      conflictKey !== null &&
        conflictKey.key === "b" &&
        conflictKey.ctrl === true &&
        conflictKey.alt === false,
      `key ${JSON.stringify(conflictKey)}`,
    );
    check(
      "the refusal wrote nothing to storage",
      same(storedBindings(conflict), { "wing.next": "Ctrl+Alt+N" }),
      `storage ${JSON.stringify(conflict.storage)}`,
    );

    at("Escape cancels the recording, not the sheet");
    await press("Escape");
    const conflictCancelled = await record("conflictCancelled");
    check(
      "the sheet is still open after cancelling the recording",
      conflictCancelled.overlayOpen === true && conflictCancelled.viewedTab === "shortcuts",
      `overlay ${conflictCancelled.overlayOpen}, view ${conflictCancelled.viewedTab}`,
    );
    check(
      "the row stopped recording without changing",
      rowById(conflictCancelled, "wing.previous").recording === false &&
        rowById(conflictCancelled, "wing.previous").binding === "Ctrl+PageUp" &&
        conflictCancelled.promptCount === 0,
      `row ${JSON.stringify(rowById(conflictCancelled, "wing.previous"))}`,
    );
    check(
      "the error banner is gone once the recording is cancelled",
      conflictCancelled.error === null,
      `error ${JSON.stringify(conflictCancelled.error)}`,
    );
    await press("Escape");
    const conflictClosed = await record(
      "conflictClosed",
      '!document.querySelector("[data-settings-overlay]") && document.body.dataset.rigPath === "/dream"',
    );
    check(
      "a second Escape closes the sheet",
      conflictClosed.overlayOpen === false && conflictClosed.path === "/dream",
      `overlay ${conflictClosed.overlayOpen}, path ${conflictClosed.path}`,
    );

    // —— 2 (dock) — a collapsed dock opens ON the reference from the titlebar,
    //        and the chat-resume effect must not paint a thread over it.
    at("collapsed dock opens on the reference");
    await clickSelector(".window-titlebar__chat-toggle");
    const dockCollapsed = await record(
      "dockCollapsedForShortcuts",
      '!document.querySelector("aside.chat-panel") && document.querySelector(".shell").classList.contains("shell--chat-collapsed")',
    );
    check(
      "the chat toggle collapses the dock",
      dockCollapsed.chatPanel === false &&
        String(dockCollapsed.shellClass).includes("shell--chat-collapsed") &&
        dockCollapsed.titlebar.shortcuts.pressed === "false",
      `panel ${dockCollapsed.chatPanel}, shell ${JSON.stringify(dockCollapsed.shellClass)}, pressed ${JSON.stringify(dockCollapsed.titlebar.shortcuts.pressed)}`,
    );

    await clickSelector(".window-titlebar__shortcuts");
    const dockReopened = await record(
      "dockReopenedOnShortcuts",
      'document.querySelector(".shell").classList.contains("shell--chat-open") && Boolean(document.querySelector("aside.chat-panel")) && document.querySelector("aside.chat-panel").getAttribute("data-chat-surface") === "shortcuts"',
    );
    check(
      "the control opens the collapsed dock onto the shortcuts surface",
      dockReopened.chatPanel === true &&
        String(dockReopened.shellClass).includes("shell--chat-open") &&
        dockReopened.dock.surface === "shortcuts" &&
        dockReopened.titlebar.shortcuts.pressed === "true",
      `panel ${dockReopened.chatPanel}, shell ${JSON.stringify(dockReopened.shellClass)}, surface ${JSON.stringify(dockReopened.dock && dockReopened.dock.surface)}, pressed ${JSON.stringify(dockReopened.titlebar.shortcuts.pressed)}`,
    );
    check(
      "the reopened reference keeps its composer hidden",
      dockReopened.dock.footerHidden === true &&
        dockReopened.dock.composerVisible === false &&
        dockReopened.dock.rows.length === 14,
      `footer hidden ${dockReopened.dock.footerHidden}, composer ${dockReopened.dock.composerVisible}, rows ${dockReopened.dock.rows.length}`,
    );

    // A late resume would replace the surface after the click; give the mount
    // effect time to run, then assert the dock is still where the operator put it.
    await sleep(450);
    const dockReopenedSettled = await record(
      "dockReopenedSettled",
      'document.querySelector("aside.chat-panel").getAttribute("data-chat-surface") === "shortcuts"',
    );
    check(
      "the chat-resume effect does not replace the surface the control asked for",
      dockReopenedSettled.dock.surface === "shortcuts" &&
        dockReopenedSettled.path === "/dream",
      `surface ${JSON.stringify(dockReopenedSettled.dock.surface)}, path ${dockReopenedSettled.path}`,
    );

    at("the reopened reference also returns to the thread");
    await clickSelector(
      '.chat-panel__header--shortcuts button[aria-label="Back to chat"]',
    );
    const dockReopenedBack = await record(
      "dockReopenedBack",
      'document.querySelector(".chat-panel").getAttribute("data-chat-surface") === "thread"',
    );
    check(
      "Back returns the reopened dock to the thread",
      dockReopenedBack.dock.surface === "thread",
      `surface ${JSON.stringify(dockReopenedBack.dock.surface)}`,
    );

    // —— 5 — app/OS space stays reserved.
    at("reserved combination");
    await openSettings();
    await clickNav("Keyboard", "shortcuts");
    await clickRowButton("history.back", "Change shortcut for");
    await press("W", ["control"]);
    const reserved = await record(
      "reserved",
      'Boolean(document.querySelector(\'[data-shortcuts-message="error"]\'))',
    );
    const reservedRow = rowById(reserved, "history.back");
    check(
      "Ctrl+W is refused as reserved",
      typeof reserved.error === "string" && /reserved/i.test(reserved.error),
      `error ${JSON.stringify(reserved.error)}`,
    );
    check(
      "the reserved combination leaves the row's binding alone",
      reservedRow.binding === "Alt+ArrowLeft",
      `binding ${JSON.stringify(reservedRow.binding)}`,
    );
    check(
      "the reserved refusal keeps the row recording",
      reservedRow.recording === true,
      `row ${JSON.stringify(reservedRow)}`,
    );
    check(
      "the reserved refusal wrote nothing",
      same(storedBindings(reserved), { "wing.next": "Ctrl+Alt+N" }),
      `storage ${JSON.stringify(reserved.storage)}`,
    );

    at("cancel reserved recording");
    await press("Escape");
    const reservedCancelled = await record(
      "reservedCancelled",
      '!document.querySelector(\'[data-shortcuts-message="error"]\') && Boolean(document.querySelector("[data-settings-overlay]"))',
    );
    check(
      "cancelling the reserved recording keeps the sheet up",
      reservedCancelled.overlayOpen === true &&
        rowById(reservedCancelled, "history.back").recording === false,
      `overlay ${reservedCancelled.overlayOpen}`,
    );

    // —— 6 — Backspace is the way to say "no key at all".
    at("clear a binding with Backspace");
    await clickRowButton("history.back", "Change shortcut for");
    await press("Backspace");
    const cleared = await record(
      "cleared",
      "document.querySelector('[data-shortcut-row=\"history.back\"]').getAttribute('data-binding') === 'unassigned'",
    );
    await scrollTo('[data-shortcut-row="history.back"]');
    await shot("cleared");
    const clearedRow = rowById(cleared, "history.back");
    check(
      "Backspace leaves the row unassigned",
      clearedRow.binding === "unassigned" && same(clearedRow.keycaps, []),
      `row ${JSON.stringify(clearedRow)}`,
    );
    check(
      "the cleared row is still customized: null is a choice",
      clearedRow.customized === true &&
        clearedRow.defaultText === "Default: Alt + ←",
      `customized ${clearedRow.customized}, default ${JSON.stringify(clearedRow.defaultText)}`,
    );
    check(
      "storage records the deliberate null",
      same(storedBindings(cleared), {
        "wing.next": "Ctrl+Alt+N",
        "history.back": null,
      }),
      `storage ${JSON.stringify(cleared.storage)}`,
    );

    // —— 7 — Reset restores one row; Restore all defaults empties the store.
    at("reset one row");
    await clickRowButton("history.back", "Reset shortcut for");
    const resetRow = await record(
      "resetRow",
      "!document.querySelector('[data-shortcut-row=\"history.back\"]').hasAttribute('data-customized')",
    );
    const resetRowState = rowById(resetRow, "history.back");
    check(
      "per-row Reset puts the default back",
      resetRowState.binding === "Alt+ArrowLeft" &&
        same(resetRowState.keycaps, ["Alt", "←"]),
      `row ${JSON.stringify(resetRowState)}`,
    );
    check(
      "per-row Reset removes that row's override",
      resetRowState.customized === false &&
        resetRowState.defaultText === null &&
        same(storedBindings(resetRow), { "wing.next": "Ctrl+Alt+N" }),
      `row ${JSON.stringify(resetRowState)}, storage ${JSON.stringify(resetRow.storage)}`,
    );
    check(
      "the Reset control is gone once the row is a default again",
      !resetRowState.buttons.some((label) => String(label).startsWith("Reset shortcut for")),
      `buttons ${JSON.stringify(resetRowState.buttons)}`,
    );

    at("restore all defaults");
    await clickSelector("[data-shortcuts-reset-all]");
    const resetAll = await record(
      "resetAll",
      "document.querySelectorAll('[data-customized=\"true\"]').length === 0",
    );
    check(
      "Restore all defaults empties the stored bindings",
      same(storedBindings(resetAll), {}),
      `storage ${JSON.stringify(resetAll.storage)}`,
    );
    check(
      "every row is on its default again",
      resetAll.rows.every((row) => !row.customized && row.binding === EXPECTED_DEFAULTS[row.id]),
      `rows ${JSON.stringify(resetAll.rows.map((row) => [row.id, row.binding, row.customized]))}`,
    );
    check(
      "Restore all defaults disables itself again",
      resetAll.resetAll.disabled === true,
      `reset all ${JSON.stringify(resetAll.resetAll)}`,
    );
    check(
      "the footer is back to the all-defaults copy",
      typeof resetAll.status === "string" &&
        resetAll.status.startsWith("Every movement is on its default key."),
      `status ${JSON.stringify(resetAll.status)}`,
    );

    // —— 8 — a custom binding is storage, and the movement keeps working after
    //        the window reloads.
    at("rebind for persistence");
    await clickRowButton("wing.next", "Change shortcut for");
    await press("N", ["control", "alt"]);
    const reboundAgain = await record(
      "reboundAgain",
      "document.querySelector('[data-shortcut-row=\"wing.next\"]').getAttribute('data-binding') === 'Ctrl+Alt+N'",
    );
    check(
      "the re-bound movement is stored",
      same(storedBindings(reboundAgain), { "wing.next": "Ctrl+Alt+N" }),
      `storage ${JSON.stringify(reboundAgain.storage)}`,
    );
    await press("Escape");
    const beforeReload = await record(
      "beforeReload",
      '!document.querySelector("[data-settings-overlay]")',
    );
    check(
      "the sheet closes back onto the page it was opened over",
      beforeReload.overlayOpen === false && beforeReload.path === "/dream",
      `overlay ${beforeReload.overlayOpen}, path ${beforeReload.path}`,
    );

    at("reload the window");
    await win.webContents.reload();
    await waitForHarness();
    await sleep(300);
    const afterReload = await record(
      "afterReload",
      'document.body.dataset.rigPath === "/home" && !document.querySelector("[data-settings-overlay]")',
    );
    check(
      "the reloaded window starts on the home stub",
      afterReload.path === "/home" && afterReload.overlayOpen === false,
      `path ${afterReload.path}, overlay ${afterReload.overlayOpen}`,
    );
    check(
      "the stored override survived the reload",
      same(storedBindings(afterReload), { "wing.next": "Ctrl+Alt+N" }),
      `storage ${JSON.stringify(afterReload.storage)}`,
    );

    at("the reloaded settings page");
    await openSettings();
    await clickNav("Keyboard", "shortcuts");
    const reloadPage = await record(
      "reloadPage",
      "document.querySelectorAll('[data-shortcut-row]').length === 14",
    );
    await scrollTo('[data-shortcut-row="wing.next"]');
    await shot("reload");
    const reloadPageRow = rowById(reloadPage, "wing.next");
    check(
      "the reloaded page shows the custom binding on its row",
      reloadPageRow.binding === "Ctrl+Alt+N" &&
        reloadPageRow.customized === true &&
        reloadPageRow.defaultText === "Default: Ctrl + PgDn",
      `row ${JSON.stringify(reloadPageRow)}`,
    );

    await press("Escape");
    const reloadSheetClosed = await record(
      "reloadSheetClosed",
      '!document.querySelector("[data-settings-overlay]") && document.body.dataset.rigPath === "/home"',
    );
    check(
      "the sheet closes back onto home after the reload",
      reloadSheetClosed.overlayOpen === false && reloadSheetClosed.path === "/home",
      `overlay ${reloadSheetClosed.overlayOpen}, path ${reloadSheetClosed.path}`,
    );
    await press("N", ["control", "alt"]);
    const reloadMovement = await record(
      "reloadMovement",
      'document.body.dataset.rigPath === "/dream"',
    );
    check(
      "the custom key still moves the shell after the reload",
      reloadMovement.path === "/dream" && reloadMovement.selectedWing === "Define",
      `path ${reloadMovement.path}, wing ${reloadMovement.selectedWing}`,
    );

    // —— 9 — a bare key must not fire while the operator is typing in a field.
    at("bind a bare key");
    await press("1", ["control"]);
    const homeForTyping = await record(
      "homeForTyping",
      'document.body.dataset.rigPath === "/home"',
    );
    check(
      "Ctrl+1 goes home before the typing guard",
      homeForTyping.path === "/home" && homeForTyping.selectedWing === "Home",
      `path ${homeForTyping.path}, wing ${homeForTyping.selectedWing}`,
    );
    await openSettings();
    await clickNav("Keyboard", "shortcuts");
    await clickRowButton("wing.next", "Change shortcut for");
    await press("N");
    const bareBinding = await record(
      "bareBinding",
      "document.querySelector('[data-shortcut-row=\"wing.next\"]').getAttribute('data-binding') === 'N'",
    );
    const bareRow = rowById(bareBinding, "wing.next");
    check(
      "a bare key can be recorded",
      bareRow.binding === "N" && same(bareRow.keycaps, ["N"]),
      `row ${JSON.stringify(bareRow)}`,
    );
    check(
      "the bare binding is stored",
      same(storedBindings(bareBinding), { "wing.next": "N" }),
      `storage ${JSON.stringify(bareBinding.storage)}`,
    );
    await press("Escape");
    const typingSheetClosed = await record(
      "typingSheetClosed",
      '!document.querySelector("[data-settings-overlay]") && document.body.dataset.rigPath === "/home"',
    );
    check(
      "the sheet is closed for the typing test",
      typingSheetClosed.overlayOpen === false && typingSheetClosed.path === "/home",
      `overlay ${typingSheetClosed.overlayOpen}, path ${typingSheetClosed.path}`,
    );

    at("type n in the rig input");
    await focusSelector("[data-rig-input]");
    await typeText("n");
    const typingGuarded = await record(
      "typingGuarded",
      '(document.querySelector("[data-rig-input]") || {}).value === "n"',
    );
    await shot("typing");
    check(
      "the field received the character",
      typingGuarded.input.value === "n",
      `input ${JSON.stringify(typingGuarded.input)}`,
    );
    check(
      "the field has the caret",
      typingGuarded.input.focused === true,
      `focused ${JSON.stringify(typingGuarded.focused)}`,
    );
    check(
      "the bare binding did not fire while typing",
      typingGuarded.path === "/home" && typingGuarded.selectedWing === "Home",
      `path ${typingGuarded.path}, wing ${typingGuarded.selectedWing}`,
    );

    at("leave the field and press n");
    const blurred = await blurActive();
    steps.blurredToBody = blurred;
    await press("n");
    const typingReleased = await record(
      "typingReleased",
      'document.body.dataset.rigPath === "/dream"',
    );
    check(
      "the same key moves the shell once the caret leaves the field",
      typingReleased.path === "/dream" && typingReleased.selectedWing === "Define",
      `path ${typingReleased.path}, wing ${typingReleased.selectedWing}`,
    );

    // —— 10 — the shipped movements from the page: panels, page steps, direct
    //         wing jump and the settings surface.
    at("shipped movements");
    await press("1", ["control"]);
    const homeForMovements = await record(
      "homeForMovements",
      'document.body.dataset.rigPath === "/home"',
    );
    check(
      "Ctrl+1 takes the shell home",
      homeForMovements.path === "/home" && homeForMovements.selectedWing === "Home",
      `path ${homeForMovements.path}, wing ${homeForMovements.selectedWing}`,
    );

    at("Ctrl+B toggles the sidebar");
    await press("B", ["control"]);
    const navCollapsed = await record(
      "navCollapsed",
      'document.querySelector(".shell").classList.contains("shell--nav-collapsed")',
    );
    check(
      "Ctrl+B collapses the sidebar",
      String(navCollapsed.shellClass).includes("shell--nav-collapsed"),
      `shell ${JSON.stringify(navCollapsed.shellClass)}`,
    );
    await press("B", ["control"]);
    const navExpanded = await record(
      "navExpanded",
      '!document.querySelector(".shell").classList.contains("shell--nav-collapsed")',
    );
    check(
      "Ctrl+B expands the sidebar again",
      !String(navExpanded.shellClass).includes("shell--nav-collapsed"),
      `shell ${JSON.stringify(navExpanded.shellClass)}`,
    );

    at("Ctrl+J toggles the chat");
    await press("J", ["control"]);
    const chatCollapsed = await record(
      "chatCollapsed",
      'document.querySelector(".shell").classList.contains("shell--chat-collapsed")',
    );
    check(
      "Ctrl+J collapses the chat dock",
      String(chatCollapsed.shellClass).includes("shell--chat-collapsed") &&
        chatCollapsed.chatPanel === false,
      `shell ${JSON.stringify(chatCollapsed.shellClass)}, panel ${chatCollapsed.chatPanel}`,
    );
    await press("J", ["control"]);
    const chatOpen = await record(
      "chatOpen",
      'document.querySelector(".shell").classList.contains("shell--chat-open")',
    );
    check(
      "Ctrl+J opens the chat dock again",
      String(chatOpen.shellClass).includes("shell--chat-open") &&
        chatOpen.chatPanel === true,
      `shell ${JSON.stringify(chatOpen.shellClass)}, panel ${chatOpen.chatPanel}`,
    );

    at("Ctrl+Shift+PageDown steps the home pages");
    await press("PageDown", ["control", "shift"]);
    const pageOne = await record(
      "pageOne",
      'document.body.dataset.rigPath === "/data"',
    );
    check(
      "Ctrl+Shift+PageDown goes Home to Data",
      pageOne.path === "/data",
      `path ${pageOne.path}`,
    );
    await press("PageDown", ["control", "shift"]);
    const pageTwo = await record(
      "pageTwo",
      'document.body.dataset.rigPath === "/pages"',
    );
    check(
      "Ctrl+Shift+PageDown goes Data to Pages",
      pageTwo.path === "/pages" && pageTwo.selectedWing === "Home",
      `path ${pageTwo.path}, wing ${pageTwo.selectedWing}`,
    );

    at("Ctrl+Shift+PageUp steps back");
    await press("PageUp", ["control", "shift"]);
    const pageBack = await record(
      "pageBack",
      'document.body.dataset.rigPath === "/data"',
    );
    check(
      "Ctrl+Shift+PageUp steps Pages back to Data",
      pageBack.path === "/data" && pageBack.selectedWing === "Home",
      `path ${pageBack.path}, wing ${pageBack.selectedWing}`,
    );

    at("Ctrl+2 jumps to Define");
    await press("2", ["control"]);
    const directWing = await record(
      "directWing",
      'document.body.dataset.rigPath === "/dream"',
    );
    check(
      "Ctrl+2 jumps straight to the Define wing",
      directWing.path === "/dream" && directWing.selectedWing === "Define",
      `path ${directWing.path}, wing ${directWing.selectedWing}`,
    );

    at("Ctrl+Comma opens settings from the page");
    await press(",", ["control"]);
    const settingsOpened = await record(
      "settingsOpened",
      'Boolean(document.querySelector("[data-settings-overlay]")) && document.body.dataset.rigPath === "/settings"',
    );
    check(
      "Ctrl+Comma opens the settings sheet over the page",
      settingsOpened.overlayOpen === true && settingsOpened.path === "/settings",
      `overlay ${settingsOpened.overlayOpen}, path ${settingsOpened.path}`,
    );
    await press("Escape");
    const settingsClosed = await record(
      "settingsClosed",
      '!document.querySelector("[data-settings-overlay]") && document.body.dataset.rigPath === "/dream"',
    );
    check(
      "Escape closes the sheet back onto the page it covered",
      settingsClosed.overlayOpen === false && settingsClosed.path === "/dream",
      `overlay ${settingsClosed.overlayOpen}, path ${settingsClosed.path}`,
    );

    // —— 11 (dock editing) — the dock's page is an editor too: every row has a
    //        pencil, the recording is the provider's one recorder (no settings
    //        sheet opens), refusals stay on the page, and a saved key works.
    //        Restore Next wing first so the documented Ctrl+PageDown conflict
    //        below is the real one.
    at("restore Next wing for dock editing");
    await openSettings();
    await clickNav("Keyboard", "shortcuts");
    await clickRowButton("wing.next", "Reset shortcut for");
    const dockEditingSetup = await record(
      "dockEditingSetup",
      "document.querySelectorAll('[data-customized=\"true\"]').length === 0",
    );
    check(
      "the set-up reset leaves every movement on its default",
      same(storedBindings(dockEditingSetup), {}),
      `storage ${JSON.stringify(dockEditingSetup.storage)}`,
    );
    await press("Escape");
    const dockEditingSetupClosed = await record(
      "dockEditingSetupClosed",
      '!document.querySelector("[data-settings-overlay]")',
    );
    check(
      "the set-up settings sheet closes back onto the page it covered",
      dockEditingSetupClosed.overlayOpen === false &&
        dockEditingSetupClosed.path === "/dream",
      `overlay ${dockEditingSetupClosed.overlayOpen}, path ${dockEditingSetupClosed.path}`,
    );

    at("the dock page carries a pencil on every row");
    await clickSelector(".window-titlebar__shortcuts");
    const dockEditReady = await record(
      "dockEditReady",
      'document.querySelector("aside.chat-panel").getAttribute("data-chat-surface") === "shortcuts"',
    );
    const editDock = dockEditReady.dock;
    check(
      "the dock page is open on the shortcuts surface",
      editDock !== null && editDock.surface === "shortcuts",
      `surface ${JSON.stringify(editDock && editDock.surface)}`,
    );
    check(
      "every movement row carries exactly one edit pencil",
      editDock.editCount === 14 &&
        editDock.rows.length === 14 &&
        editDock.rows.every((row) => row.edit.present === true),
      `${editDock.editCount} pencils, rows ${JSON.stringify(editDock.rows.map((row) => [row.id, row.edit.present]))}`,
    );
    check(
      "each pencil names the movement it edits",
      editDock.rows.every(
        (row) => row.edit.label === `Change shortcut for ${row.label}`,
      ),
      `labels ${JSON.stringify(editDock.rows.map((row) => [row.id, row.edit.label]))}`,
    );
    check(
      "the pencils cover all four groups",
      same(
        editDock.groups.map((group) => ({ id: group.id, rows: group.rows.length })),
        EXPECTED_GROUPS,
      ) &&
        editDock.groups.every((group) =>
          group.rows.every((id) => dockRow(dockEditReady, id)?.edit.present === true),
        ),
      `groups ${JSON.stringify(editDock.groups)}`,
    );
    check(
      "the dock page still carries the header pencil to Settings",
      editDock.pencil.present === true &&
        editDock.pencil.label === "Change keyboard shortcuts in Settings",
      `header pencil ${JSON.stringify(editDock.pencil)}`,
    );
    check(
      "nothing is recording when the dock page opens",
      editDock.recordingPromptCount === 0 &&
        editDock.rows.every((row) => !row.recording && !row.prompt) &&
        editDock.editingError === null,
      `prompts ${editDock.recordingPromptCount}, error ${JSON.stringify(editDock.editingError)}`,
    );

    at("edit Toggle sidebar from the dock");
    await clickSelector(
      '[data-chat-shortcut-row="panel.sidebar.toggle"] .chat-shortcuts__edit',
    );
    const dockRecording = await record(
      "dockRecording",
      'document.querySelector(\'[data-chat-shortcut-row="panel.sidebar.toggle"]\').getAttribute("data-recording") === "true"',
    );
    await scrollTo('[data-chat-shortcut-row="panel.sidebar.toggle"]', "center");
    await shot("dockEditing");
    const dockRecordingRow = dockRow(dockRecording, "panel.sidebar.toggle");
    check(
      "the dock row enters the provider's recording state",
      dockRecordingRow.recording === true &&
        dockRecordingRow.prompt === true &&
        same(dockRecordingRow.keycaps, []) &&
        dockRecording.dock.recordingPromptCount === 1,
      `row ${JSON.stringify(dockRecordingRow)}`,
    );
    check(
      "the recording row offers its cancel control",
      dockRecordingRow.cancel.present === true &&
        dockRecordingRow.cancel.label ===
          "Cancel changing the shortcut for Toggle sidebar" &&
        dockRecordingRow.edit.present === false,
      `cancel ${JSON.stringify(dockRecordingRow.cancel)}, edit ${JSON.stringify(dockRecordingRow.edit)}`,
    );
    check(
      "the dock stays on its page: the settings sheet did not open",
      dockRecording.overlayOpen === false &&
        dockRecording.dock.surface === "shortcuts",
      `overlay ${dockRecording.overlayOpen}, surface ${JSON.stringify(dockRecording.dock.surface)}`,
    );

    at("save Toggle sidebar as Ctrl+Alt+Y");
    await press("Y", ["control", "alt"]);
    const dockSaved = await record(
      "dockSaved",
      'document.querySelector(\'[data-chat-shortcut-row="panel.sidebar.toggle"]\').getAttribute("data-binding") === "Ctrl+Alt+Y"',
    );
    const dockSavedRow = dockRow(dockSaved, "panel.sidebar.toggle");
    check(
      "the dock row shows the saved binding and keycaps",
      dockSavedRow.binding === "Ctrl+Alt+Y" &&
        dockSavedRow.changed === true &&
        same(dockSavedRow.keycaps, ["Ctrl", "Alt", "Y"]),
      `row ${JSON.stringify(dockSavedRow)}`,
    );
    check(
      "the saved binding ends the recording and returns the pencil",
      dockSavedRow.recording === false &&
        dockSavedRow.prompt === false &&
        dockSavedRow.edit.present === true &&
        dockSaved.dock.recordingPromptCount === 0,
      `row ${JSON.stringify(dockSavedRow)}`,
    );
    check(
      "the dock page writes the binding to storage",
      same(storedBindings(dockSaved), { "panel.sidebar.toggle": "Ctrl+Alt+Y" }),
      `storage ${JSON.stringify(dockSaved.storage)}`,
    );
    check(
      "the dock hint counts the one edited movement",
      typeof dockSaved.dock.hint === "string" &&
        dockSaved.dock.hint.includes("1 movement is changed from the defaults."),
      `hint ${JSON.stringify(dockSaved.dock.hint)}`,
    );
    check(
      "saving from the dock did not open the settings sheet",
      dockSaved.overlayOpen === false,
      `overlay ${dockSaved.overlayOpen}, path ${dockSaved.path}`,
    );

    at("the dock-recorded key toggles the sidebar");
    // The titlebar's vault link, not Ctrl+1: the wing shortcut returns to the
    // wing's last page, which the page-step test above left at /pages.
    await clickSelector(".window-titlebar__vault");
    const dockEditHome = await record(
      "dockEditHome",
      'document.body.dataset.rigPath === "/home"',
    );
    check(
      "the shell is on the home page for the movement",
      dockEditHome.path === "/home" && dockEditHome.selectedWing === "Home",
      `path ${dockEditHome.path}, wing ${dockEditHome.selectedWing}`,
    );
    await press("Y", ["control", "alt"]);
    const dockEditCollapsed = await record(
      "dockEditCollapsed",
      'document.querySelector(".shell").classList.contains("shell--nav-collapsed")',
    );
    check(
      "Ctrl+Alt+Y collapses the sidebar",
      String(dockEditCollapsed.shellClass).includes("shell--nav-collapsed"),
      `shell ${JSON.stringify(dockEditCollapsed.shellClass)}`,
    );
    await press("Y", ["control", "alt"]);
    const dockEditExpanded = await record(
      "dockEditExpanded",
      '!document.querySelector(".shell").classList.contains("shell--nav-collapsed")',
    );
    check(
      "Ctrl+Alt+Y expands the sidebar again",
      !String(dockEditExpanded.shellClass).includes("shell--nav-collapsed"),
      `shell ${JSON.stringify(dockEditExpanded.shellClass)}`,
    );

    at("dock conflict names Next wing");
    await clickSelector(
      '[data-chat-shortcut-row="surface.settings.open"] .chat-shortcuts__edit',
    );
    const dockConflictRecording = await record(
      "dockConflictRecording",
      'document.querySelector(\'[data-chat-shortcut-row="surface.settings.open"]\').getAttribute("data-recording") === "true"',
    );
    check(
      "the Open settings row is recording with its binding unchanged",
      dockRow(dockConflictRecording, "surface.settings.open").binding ===
        "Ctrl+Comma" &&
        dockRow(dockConflictRecording, "surface.settings.open").recording === true,
      `row ${JSON.stringify(dockRow(dockConflictRecording, "surface.settings.open"))}`,
    );
    await press("PageDown", ["control"]);
    const dockConflict = await record(
      "dockConflict",
      'Boolean(document.querySelector("[data-chat-shortcuts-error]"))',
    );
    check(
      "the dock conflict names the movement that owns Ctrl+PageDown",
      typeof dockConflict.dock.editingError === "string" &&
        dockConflict.dock.editingError.includes("Next wing"),
      `error ${JSON.stringify(dockConflict.dock.editingError)}`,
    );
    check(
      "the refused dock row keeps its binding and keeps recording",
      dockRow(dockConflict, "surface.settings.open").binding === "Ctrl+Comma" &&
        dockRow(dockConflict, "surface.settings.open").recording === true &&
        dockConflict.dock.recordingPromptCount === 1,
      `row ${JSON.stringify(dockRow(dockConflict, "surface.settings.open"))}`,
    );
    check(
      "the conflict did not fire the runner and navigate",
      dockConflict.path === "/home" && dockConflict.overlayOpen === false,
      `path ${dockConflict.path}, overlay ${dockConflict.overlayOpen}`,
    );
    await press("Escape");
    const dockConflictCancelled = await record(
      "dockConflictCancelled",
      '!document.querySelector("[data-chat-shortcuts-error]") && !document.querySelector(\'[data-chat-shortcut-row="surface.settings.open"]\').hasAttribute("data-recording")',
    );
    check(
      "Escape cancels the dock recording and clears the error",
      dockConflictCancelled.dock.editingError === null &&
        dockRow(dockConflictCancelled, "surface.settings.open").recording ===
          false &&
        dockConflictCancelled.dock.recordingPromptCount === 0,
      `error ${JSON.stringify(dockConflictCancelled.dock.editingError)}, row ${JSON.stringify(dockRow(dockConflictCancelled, "surface.settings.open"))}`,
    );
    check(
      "cancelling keeps the dock on the shortcuts page",
      dockConflictCancelled.dock.surface === "shortcuts" &&
        dockConflictCancelled.overlayOpen === false,
      `surface ${JSON.stringify(dockConflictCancelled.dock.surface)}, overlay ${dockConflictCancelled.overlayOpen}`,
    );

    at("dock reserved combination");
    await clickSelector(
      '[data-chat-shortcut-row="history.back"] .chat-shortcuts__edit',
    );
    await press("W", ["control"]);
    const dockReserved = await record(
      "dockReserved",
      'Boolean(document.querySelector("[data-chat-shortcuts-error]"))',
    );
    check(
      "the dock refuses Ctrl+W as reserved",
      typeof dockReserved.dock.editingError === "string" &&
        /reserved/i.test(dockReserved.dock.editingError),
      `error ${JSON.stringify(dockReserved.dock.editingError)}`,
    );
    check(
      "the reserved refusal leaves the dock row's binding alone",
      dockRow(dockReserved, "history.back").binding === "Alt+ArrowLeft" &&
        dockRow(dockReserved, "history.back").recording === true,
      `row ${JSON.stringify(dockRow(dockReserved, "history.back"))}`,
    );
    await press("Escape");
    const dockReservedCancelled = await record(
      "dockReservedCancelled",
      '!document.querySelector("[data-chat-shortcuts-error]") && !document.querySelector(\'[data-chat-shortcut-row="history.back"]\').hasAttribute("data-recording")',
    );
    check(
      "cancelling the reserved recording clears the dock error",
      dockReservedCancelled.dock.editingError === null &&
        dockRow(dockReservedCancelled, "history.back").binding === "Alt+ArrowLeft",
      `error ${JSON.stringify(dockReservedCancelled.dock.editingError)}`,
    );

    at("dock Backspace clears Back");
    await clickSelector(
      '[data-chat-shortcut-row="history.back"] .chat-shortcuts__edit',
    );
    const dockClearRecording = await record(
      "dockClearRecording",
      'document.querySelector(\'[data-chat-shortcut-row="history.back"]\').getAttribute("data-recording") === "true"',
    );
    check(
      "the Back row is recording from the dock",
      dockRow(dockClearRecording, "history.back").recording === true,
      `row ${JSON.stringify(dockRow(dockClearRecording, "history.back"))}`,
    );
    await press("Backspace");
    const dockCleared = await record(
      "dockCleared",
      'document.querySelector(\'[data-chat-shortcut-row="history.back"]\').getAttribute("data-binding") === "unassigned"',
    );
    const dockClearedRow = dockRow(dockCleared, "history.back");
    check(
      "Backspace leaves the dock row unassigned and changed",
      dockClearedRow.binding === "unassigned" &&
        dockClearedRow.changed === true &&
        same(dockClearedRow.keycaps, []) &&
        dockClearedRow.edit.present === true,
      `row ${JSON.stringify(dockClearedRow)}`,
    );
    check(
      "the dock clear writes the deliberate null to storage",
      same(storedBindings(dockCleared), {
        "panel.sidebar.toggle": "Ctrl+Alt+Y",
        "history.back": null,
      }),
      `storage ${JSON.stringify(dockCleared.storage)}`,
    );
    check(
      "the dock hint counts both changed movements",
      typeof dockCleared.dock.hint === "string" &&
        dockCleared.dock.hint.includes("2 movements are changed from the defaults."),
      `hint ${JSON.stringify(dockCleared.dock.hint)}`,
    );
    check(
      "the dock stayed on its page through all editing",
      dockCleared.dock.surface === "shortcuts" &&
        dockCleared.overlayOpen === false &&
        String(dockCleared.shellClass).includes("shell--chat-open"),
      `surface ${JSON.stringify(dockCleared.dock.surface)}, overlay ${dockCleared.overlayOpen}, shell ${JSON.stringify(dockCleared.shellClass)}`,
    );

    steps.expectedDefaults = EXPECTED_DEFAULTS;
    steps.expectedGroups = EXPECTED_GROUPS;

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      storageKey: STORAGE_KEY,
      expected: {
        defaults: EXPECTED_DEFAULTS,
        groups: EXPECTED_GROUPS,
      },
      states,
      steps,
      screenshots,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      states,
      steps,
      screenshots,
      failures: [
        ...failures,
        `threw at ${step}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "keyboard-shortcuts.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [["state", "path", "sheet", "rows", "custom", "storage"]];
  for (const [name, state] of Object.entries(states)) {
    if (!state || !state.rows) continue;
    table.push([
      name,
      state.path ?? "—",
      state.overlayOpen ? "open" : "closed",
      String(state.rows.length),
      String(state.rows.filter((row) => row.customized).length),
      state.storage === null ? "none" : String(state.storage).slice(0, 48),
    ]);
  }
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((row) => String(row[i]).length)),
  );
  for (const row of table) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "keyboard shortcuts: PASS" : "keyboard shortcuts: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(
      `keyboard-shortcuts: ${error instanceof Error ? error.stack : error}`,
    );
    app.exit(1);
  });
