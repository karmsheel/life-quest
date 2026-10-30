/**
 * Drives the settings sheet in a real Electron window and turns the measurements
 * into `e2e/artifacts/settings-sheet.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/settings-sheet.electron.mjs
 *
 * Exit code 0 = every step ran. The JSON report is the repeatable artifact: the
 * test file (`tests/settings-sheet-e2e.test.ts`) holds the assertions, this file
 * holds the interactions and the measurements, so a failure names a state rather
 * than a line of driver code.
 *
 * What is measured that a screenshot cannot show: the panel's own measure and
 * its centring in the window, the floating search bar's measure, pill ends and
 * the panel border that crosses its axis, the absent title band between that bar
 * and the section column, the scrim's computed `backdrop-filter`, the
 * cross's corner, the search field's effect on the section list, which
 * dismissal did what, and the two favourites lists the star feeds.
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
  "http://127.0.0.1:5173/e2e/settings-sheet.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The theme the driver stars, and the query that finds its page. */
const STARRED_SKIN = "Ember";
const SECTION_COUNT = 10;

/**
 * A theme in the shape the app installs: the Forge palette, hex only, every
 * colour `applySkin` reads. Installed by the rig through the same `change` event
 * the OS file dialog raises.
 */
const INSTALLED_THEME = {
  name: "harbour",
  label: "Harbour",
  description: "Installed by the settings-sheet rig",
  colors: {
    background: "#0b1220",
    foreground: "#e8eef7",
    card: "#121a2b",
    cardForeground: "#e8eef7",
    muted: "#1a2436",
    mutedForeground: "#8fa0b8",
    popover: "#121a2b",
    popoverForeground: "#e8eef7",
    primary: "#4aa3ff",
    primaryForeground: "#06101f",
    secondary: "#16304f",
    secondaryForeground: "#e8eef7",
    accent: "#4aa3ff",
    accentForeground: "#06101f",
    border: "#22304a",
    input: "#2c3d5c",
    ring: "#4aa3ff",
    destructive: "#e5484d",
    destructiveForeground: "#ffffff",
  },
};

/** The same file with the palette gutted: refused, with the field named. */
const BROKEN_THEME = {
  name: "broken",
  label: "Broken",
  colors: { background: "#0b1220" },
};

const SAMPLE = `(() => {
  const round = (n) => Math.round(n);
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
  const text = (el) => ((el && el.textContent) || "").trim();

  const overlay = document.querySelector("[data-settings-overlay]");
  const panel = document.querySelector(".settings-overlay__panel");
  const chrome = document.querySelector(".settings-overlay__chrome");
  const navColumn = document.querySelector(".settings-overlay__nav");
  const close = document.querySelector(".settings-overlay__close");
  const search = document.querySelector(".settings-overlay__search-input");
  const searchBar = document.querySelector(".settings-overlay__search");
  const overlayStyle = overlay ? getComputedStyle(overlay) : null;
  const panelStyle = panel ? getComputedStyle(panel) : null;
  const popover = document.querySelector(".settings-menu__popover");

  const nav = Array.from(document.querySelectorAll(".settings-nav-item")).map((el) => ({
    label: text(el.querySelector(".settings-nav-item__label")),
    match: text(el.querySelector(".settings-nav-item__match")) || null,
    active: el.classList.contains("is-active"),
  }));

  /** The Appearance grid: every theme this window can wear, with its star. */
  const themes = Array.from(
    document.querySelectorAll(".settings-appearance__skins .skin-tile")
  ).map((tile) => {
    const radio = tile.querySelector(".settings-menu__skin-option");
    const star = tile.querySelector(".skin-tile__star");
    return {
      name: tile.getAttribute("data-skin"),
      label: text(tile.querySelector(".settings-menu__skin-label")),
      active: radio ? radio.getAttribute("aria-checked") === "true" : null,
      starred: star ? star.getAttribute("aria-pressed") === "true" : null,
    };
  });

  const installed = Array.from(
    document.querySelectorAll(".settings-theme-installed__item")
  ).map((item) => ({
    name: item.getAttribute("data-installed-skin"),
    label: text(item.querySelector(".settings-theme-installed__name")),
  }));

  const installInput = document.querySelector("[data-theme-install-input]");

  const question = document.querySelector(".confirm-dialog-backdrop");
  const questionCard = document.querySelector(".confirm-dialog");
  const questionBox = box(questionCard);
  const questionCentre = questionBox
    ? document.elementFromPoint(
        Math.round(questionBox.left + questionBox.width / 2),
        Math.round(questionBox.top + questionBox.height / 2)
      )
    : null;

  return {
    path: document.body.dataset.rigPath || null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyOverflow: getComputedStyle(document.body).overflow,
    backgroundPage: Boolean(document.querySelector('[data-rig-page="home"]')),
    overlay: overlay
      ? {
          box: box(overlay),
          position: overlayStyle.position,
          zIndex: overlayStyle.zIndex,
          backdropFilter:
            overlayStyle.backdropFilter || overlayStyle.webkitBackdropFilter || null,
          background: overlayStyle.backgroundColor,
          panel: panel
            ? {
                box: box(panel),
                radius: panelStyle.borderRadius,
                background: panelStyle.backgroundColor,
                borderColor: panelStyle.borderColor,
              }
            : null,
          chrome: box(chrome),
        }
      : null,
    close: close
      ? {
          box: box(close),
          label: close.getAttribute("aria-label"),
          title: close.getAttribute("title"),
        }
      : null,
    search: search
      ? {
          box: box(search),
          bar: box(searchBar),
          // The bar's own corner: a pill, so the radius is half its height.
          radius: searchBar
            ? parseFloat(getComputedStyle(searchBar).borderTopLeftRadius)
            : null,
          value: search.value,
          placeholder: search.getAttribute("placeholder"),
          label: search.getAttribute("aria-label"),
          focused: document.activeElement === search,
        }
      : null,
    // The section column's leading edge is where the "no title band" contract is
    // read: it must start at the panel's own top edge.
    navBox: box(navColumn),
    chromeBox: box(chrome),
    // The search left the top strip for the floating band on the panel's edge;
    // count it across the sheet so a second copy would still be caught.
    searchInputs: document.querySelectorAll(
      "[data-settings-overlay] input[type='search']"
    ).length,
    nav,
    navEmpty: text(document.querySelector(".settings-overlay__nav-empty")) || null,
    panelView:
      (document.querySelector("[data-settings-view]") || { getAttribute: () => null })
        .getAttribute("data-settings-view") || null,
    panelTitle: text(document.querySelector(".settings-panel__title")) || null,
    themes,
    themeCount: themes.length,
    starredNote: text(document.querySelector(".settings-appearance__skin-starred")) || null,
    installed,
    installInput: Boolean(installInput),
    installError:
      text(document.querySelector(".settings-theme-install__message.form-error")) || null,
    installNotice:
      text(document.querySelector(".settings-theme-install__message.form-message")) || null,
    menuOpen: Boolean(popover),
    menu: popover
      ? {
          labels: Array.from(
            popover.querySelectorAll(".skin-tile .settings-menu__skin-label")
          ).map(text),
          empty: text(popover.querySelector(".settings-menu__quick-empty")) || null,
          grid: box(popover.querySelector(".settings-menu__skin-grid")),
        }
      : null,
    question: question
      ? {
          zIndex: getComputedStyle(question).zIndex,
          box: questionBox,
          /** What actually paints at the card's centre. */
          centreHit: questionCentre ? String(questionCentre.className || questionCentre.tagName) : null,
          focus: document.activeElement
            ? String(document.activeElement.className || document.activeElement.tagName)
            : null,
        }
      : null,
    storedFavorites: (() => {
      try {
        return localStorage.getItem("lifequest-skin-favorites");
      } catch {
        return "unavailable";
      }
    })(),
  };
})()`;

const states = {};
const steps = {};
const failures = [];

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

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

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

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `settings-sheet-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return path.basename(file);
  };

  const waitReady = () =>
    run("window.settingsSheetReady.then(() => true)");

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const clickNav = (label) =>
    run(`(() => {
      const el = Array.from(document.querySelectorAll(".settings-nav-item")).find(
        (item) =>
          (((item.querySelector(".settings-nav-item__label") || {}).textContent) || "").trim() ===
          ${JSON.stringify(label)}
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const clickStar = (label) =>
    run(`(() => {
      const el = Array.from(document.querySelectorAll(".skin-tile__star")).find((button) =>
        (button.getAttribute("aria-label") || "").includes(${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Unstar everything except `keep`, one press per theme, as a hand would. */
  const unstarAllExcept = (keep) =>
    run(`(() => {
      const pressed = Array.from(document.querySelectorAll(".skin-tile__star")).filter(
        (button) =>
          !(button.getAttribute("aria-label") || "").includes(${JSON.stringify(keep)}) &&
          button.getAttribute("aria-pressed") === "true"
      );
      for (const button of pressed) button.click();
      return pressed.length;
    })()`);

  /**
   * Install a theme the way the file picker does: the page cannot open the OS
   * dialog, but it can hand the input the same File the dialog would, and the
   * component's own `change` handler runs from there.
   */
  const pickThemeFile = (json, filename = "theme.json") =>
    run(`(() => {
      const input = document.querySelector("[data-theme-install-input]");
      if (!input) return false;
      const file = new File([${JSON.stringify(json)}], ${JSON.stringify(filename)}, {
        type: "application/json",
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);

  const removeInstalled = (label) =>
    run(`(() => {
      const el = Array.from(document.querySelectorAll(".settings-theme-installed__remove")).find(
        (button) => (button.getAttribute("aria-label") || "").includes(${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
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

  /**
   * Escape, from the body: a real key event starts at the focused element and
   * bubbles up through `document` to `window`, so both listeners hear it. (The
   * sheet listens on `window`, the quick menu on `document`; dispatching on
   * `window` itself would miss the menu's.)
   */
  const pressEscape = () =>
    run(`(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
      return true;
    })()`);

  /** A real press at a window point: what is under it, and a mousedown on it. */
  const pressAt = (x, y) =>
    run(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return { hit: null };
      const hit = el.hasAttribute("data-settings-overlay")
        ? "scrim"
        : (el.className || el.tagName);
      el.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: ${x},
          clientY: ${y},
        })
      );
      return { hit: String(hit) };
    })()`);

  /** A real press on the open panel's own search field. */
  const pressInsidePanel = () =>
    run(`(() => {
      const el =
        document.querySelector(".settings-overlay__search-input") ||
        document.querySelector(".settings-overlay__panel");
      if (!el) return { hit: null };
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      el.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
      return { hit: String(el.className || el.tagName) };
    })()`);

  const record = (name, value) => {
    states[name] = value;
    return value;
  };

  const step = (name, value) => {
    steps[name] = value;
    return value;
  };

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: {
      starredSkin: STARRED_SKIN,
      sectionCount: SECTION_COUNT,
      installedTheme: { name: INSTALLED_THEME.name, label: INSTALLED_THEME.label },
    },
    states,
    steps,
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await waitReady();

    // A favourites list left over from an earlier run would make "starring
    // Ember" look like it worked before it was pressed.
    await run("localStorage.removeItem('lifequest-skin-favorites')");
    await win.webContents.reload();
    await waitReady();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 1 — the page the sheet will be drawn over.
    record("landing", await settle());

    // 2 — open it from the app, not from a URL: that is how it is reached.
    const openedClick = await click("[data-rig-open-settings]");
    record("opened", await settle());
    step("openedClick", openedClick);
    await shot("opened");

    // 3 — the search bar narrows the list in place.
    await typeQuery("vault");
    record("searchedVault", await settle());

    // 4 — a theme name finds the page that holds the themes.
    await typeQuery("ember");
    record("searchedTheme", await settle());
    await shot("search-theme");

    // 5 — nothing matches: the panel keeps its subject.
    await typeQuery("zzzz");
    record("searchedNone", await settle());

    // 6 — clearing restores the whole list.
    const clearedClick = await click(".settings-overlay__search-clear");
    record("cleared", await settle());
    step("clearedClick", clearedClick);

    // 7 — a press inside the frame must not dismiss it.
    const insidePress = await pressInsidePanel();
    record("insidePress", await settle());
    step("insidePressHit", insidePress.hit);

    // 7b — a question raised over the sheet: above it, and it takes Escape.
    const askedClick = await click("[data-rig-ask]");
    record("question", await settle());
    step("questionClick", askedClick);
    await shot("question-over-sheet");
    await pressEscape();
    record("questionCancelled", await settle());

    // 8 — a press on the scrim does.
    const outsidePress = await pressAt(6, 6);
    record("closedByScrimPress", await settle());
    step("closedByScrimHit", outsidePress.hit);

    // 9 — Escape over a half-typed query clears it before it closes anything.
    await click("[data-rig-open-settings]");
    await settle();
    await typeQuery("vault");
    record("queryBeforeEscape", await settle());
    await pressEscape();
    record("escapeCleared", await settle());
    await pressEscape();
    record("closedByEscape", await settle());

    // 10 — Appearance, where themes are starred, installed and removed. Every
    //      theme starts starred: the quick menu opens on the whole set.
    await click("[data-rig-open-settings]");
    await settle();
    await typeQuery("theme");
    await settle();
    await click(".settings-overlay__search-clear");
    await settle();
    await clickNav("Appearance");
    record("appearance", await settle());

    // 11 — curate down to one: the quick menu is the starred list, so the other
    //      six should leave it.
    const unstarred = await unstarAllExcept(STARRED_SKIN);
    record("curatedOne", await settle());
    step("unstarredCount", unstarred);

    // 12 — the menu now offers exactly that one theme.
    const crossClick = await click(".settings-overlay__close");
    record("closedByCross", await settle());
    step("crossClick", crossClick);
    await click(".settings-menu__trigger");
    record("menuCurated", await settle());
    await shot("quick-menu-curated");

    // 13 — unstar the last one: the menu has nothing to offer, and says so.
    await pressEscape();
    await settle();
    await click("[data-rig-open-settings]");
    await settle();
    const unstarredLast = await clickStar(STARRED_SKIN);
    record("curatedNone", await settle());
    step("unstarredLast", unstarredLast);
    await click(".settings-overlay__close");
    await settle();
    await click(".settings-menu__trigger");
    record("menuEmpty", await settle());
    await shot("quick-menu-empty");

    // 14 — star it again, then install a theme from a file. Installing stars it,
    //      so the new theme is reachable from the quick menu immediately.
    await pressEscape();
    await settle();
    await click("[data-rig-open-settings]");
    await settle();
    const reStarred = await clickStar(STARRED_SKIN);
    record("restarred", await settle());
    step("reStarred", reStarred);
    const installPick = await pickThemeFile(JSON.stringify(INSTALLED_THEME));
    record("installed", await settle());
    step("installPick", installPick);
    await shot("installed");

    // 14b — the installed theme is findable by the sheet's own search.
    await typeQuery(INSTALLED_THEME.label.toLowerCase());
    record("searchInstalled", await settle());
    await click(".settings-overlay__search-clear");
    await settle();

    // 15 — a file that is not a theme is refused, naming the field that failed.
    const brokenPick = await pickThemeFile(JSON.stringify(BROKEN_THEME), "broken.json");
    record("installRefused", await settle());
    step("brokenPick", brokenPick);

    // 16 — remove the installed theme again: the grid, the list and the menu
    //      all lose it, and the curated star list keeps the one that remains.
    const removed = await removeInstalled(INSTALLED_THEME.label);
    record("removed", await settle());
    step("removeClick", removed);

    // 17 — the curated list is storage, not session state.
    await click(".settings-overlay__close");
    await settle();
    await click(".settings-menu__trigger");
    record("menuAfterInstall", await settle());
    await win.webContents.reload();
    await waitReady();
    await settle();
    await click(".settings-menu__trigger");
    record("menuAfterReload", await settle());
    await shot("quick-menu-after-reload");

    report.pass = true;
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }

  report.pass = report.pass && failures.length === 0;

  const reportFile = path.join(artifactsDir, "settings-sheet.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [["state", "path", "sheet", "nav", "themes", "menu"]];
  for (const [name, state] of Object.entries(states)) {
    table.push([
      name,
      state?.path ?? "—",
      state?.overlay ? "open" : "closed",
      String(state?.nav?.length ?? "—"),
      String(state?.themeCount ?? "—"),
      (state?.menu?.labels ?? []).join("+") || (state?.menu?.empty ? "(empty)" : "—"),
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
  console.log(report.pass ? "settings sheet: PASS" : "settings sheet: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`settings-sheet: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
