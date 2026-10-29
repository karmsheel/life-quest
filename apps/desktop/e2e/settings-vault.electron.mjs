/**
 * Drives the settings-vault harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/settings-vault.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *   node e2e/settings-vault.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * NOT covered here: whether the folder that was opened really holds the vault
 * the page now names. The rig answers from a stubbed bridge, so it asserts what
 * the settings page DOES with the payload it is handed — the question asked, the
 * path the answer carries, and what stays on screen when the open is refused.
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
const baseUrl =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/settings-vault.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };
/**
 * A second, wider window. The settings sheet caps its own width, so this is the
 * proof that the cap holds: the panel and its card must not move while the mat
 * on either side doubles. 1500 fits inside this box's 1600px display with the
 * window frame included.
 */
const WIDE_SIZE = { width: 1500, height: 900 };
/** `72rem` in the app's root (16px) — the settings sheet's own measure. */
const SHEET_MEASURE_PX = 72 * 16;

/** The two vaults the harness holds: the one open on load, the one it opens. */
const VAULT_A = { id: "vault-a", name: "Harness Vault A", path: "/harness/vault-a" };
const VAULT_B = { id: "vault-b", name: "Harness Vault B", path: "/harness/vault-b" };
const REFUSAL = "No LifeQuest vault in that folder.";
const RESTORE_REFUSAL = "Books.json for this domain could not be read.";
/** Long enough for the driver to catch the control while the open is in flight. */
const OPEN_DELAY_MS = 600;

/**
 * Everything the driver compares is read off the real DOM: boxes come from
 * `getBoundingClientRect` (the layout engine, not the stylesheet's intent) and
 * radii from computed style (what the button actually wears). The sample is a
 * function body, so the driver can call it as many times as a state needs.
 */
const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, centerY: r.top + r.height / 2 };
  };
  const radius = (el) => {
    if (!el) return null;
    const value = parseFloat(getComputedStyle(el).borderTopLeftRadius);
    return Number.isFinite(value) ? value : null;
  };

  const rows = Array.from(document.querySelectorAll(".settings-card__row"));
  const labelOf = (row) => (row && (row.querySelector(".settings-card__label")?.textContent ?? "").trim()) || "";
  const rowByLabel = (label) => rows.find((row) => labelOf(row) === label) ?? null;

  const identity = Array.from(document.querySelectorAll(".settings-vault > div")).map((div) => ({
    label: text(div.querySelector("dt")),
    value: text(div.querySelector("dd")),
    row: box(div),
    labelBox: box(div.querySelector("dt")),
    valueBox: box(div.querySelector("dd"))
  }));
  const identityValue = (label) => {
    const entry = identity.find((item) => item.label === label);
    return entry ? entry.value : null;
  };

  const sections = Array.from(
    document.querySelectorAll(".settings-overlay__main-scroll > section")
  ).map((section) => box(section));

  /*
   * The frame around the page is part of the contract too: the settings sheet
   * stops at its own measure on a wide window, so what grows is the mat on
   * either side of the panel — never the panel. The card inside it is the
   * operator-visible proof that the page's line stays put.
   */
  const panel = document.querySelector(".sheet-overlay__panel--settings");
  const sheet = document.querySelector(".sheet-overlay--settings");
  const card = document.querySelector(".settings-card");

  const folderRow = rowByLabel("Vault folder");
  const folderButton = folderRow ? folderRow.querySelector("button") : null;

  const weekRow = rowByLabel("Week starts on");
  const weekControl = weekRow ? weekRow.querySelector(".ui-segmented") : null;
  const weekOptions = weekControl
    ? Array.from(weekControl.querySelectorAll("button"))
    : [];
  const weekOption = (label) => weekOptions.find((button) => text(button) === label) ?? null;
  const weekCopy = weekRow ? weekRow.querySelector(".settings-card__desc") : null;

  const books = rows
    .filter((row) => row.classList.contains("settings-card__row--books"))
    .map((row) => {
      const toggle = row.querySelector('[role="switch"]');
      const buttons = Array.from(row.querySelectorAll("button.btn"));
      const exportButton = buttons.find((button) => text(button) === "Export books") ?? null;
      const restoreButton = buttons.find((button) => text(button) === "Restore books") ?? null;
      return {
        label: text(row.querySelector(".settings-card__label")),
        description: text(row.querySelector(".settings-card__desc")),
        row: box(row),
        copy: box(row.querySelector(".settings-card__copy")),
        labelBox: box(row.querySelector(".settings-card__label")),
        control: box(row.querySelector(".settings-card__control")),
        checkboxCount: row.querySelectorAll('input[type="checkbox"]').length,
        toggle: toggle
          ? {
              checked: toggle.getAttribute("aria-checked"),
              text: text(toggle),
              className: toggle.className,
              disabled: toggle.disabled,
              box: box(toggle),
              track: box(toggle.querySelector(".ui-toggle__track")),
              thumb: box(toggle.querySelector(".ui-toggle__thumb")),
              labelBox: box(toggle.querySelector(".ui-toggle__label"))
            }
          : null,
        exportButton: exportButton
          ? {
              text: text(exportButton),
              disabled: exportButton.disabled,
              radius: radius(exportButton),
              className: exportButton.className,
              box: box(exportButton)
            }
          : null,
        restoreButton: restoreButton
          ? {
              text: text(restoreButton),
              disabled: restoreButton.disabled,
              radius: radius(restoreButton),
              box: box(restoreButton)
            }
          : null,
        messages: Array.from(row.querySelectorAll(".settings-books__message")).map((message) => ({
          text: text(message),
          role: message.getAttribute("role"),
          error: message.classList.contains("form-error")
        }))
      };
    });

  const alert = document.querySelector('[role="alert"].form-error');
  const calls = window.vaultCalls || {};
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    frame: {
      sheet: box(sheet),
      panel: box(panel),
      card: box(card),
      leftGutter: panel && sheet ? panel.getBoundingClientRect().left - sheet.getBoundingClientRect().left : null,
      rightGutter: panel && sheet ? sheet.getBoundingClientRect().right - panel.getBoundingClientRect().right : null
    },
    identity,
    vaultName: identityValue("Name"),
    vaultId: identityValue("Id"),
    vaultPath: identityValue("Path"),
    sections,
    folderRow: folderRow
      ? {
          label: labelOf(folderRow),
          description: text(folderRow.querySelector(".settings-card__desc")),
          copy: box(folderRow.querySelector(".settings-card__copy")),
          control: box(folderRow.querySelector(".settings-card__control")),
          labelBox: box(folderRow.querySelector(".settings-card__label")),
          button: folderButton
            ? {
                label: text(folderButton),
                className: folderButton.className,
                disabled: folderButton.disabled,
                radius: radius(folderButton)
              }
            : null
        }
      : null,
    weekStart: weekRow
      ? {
          label: labelOf(weekRow),
          description: weekCopy ? text(weekCopy) : null,
          copy: box(weekRow.querySelector(".settings-card__copy")),
          labelBox: box(weekRow.querySelector(".settings-card__label")),
          control: box(weekControl),
          controlClassName: weekControl ? weekControl.className : null,
          height: weekControl ? box(weekControl).height : null,
          width: weekControl ? box(weekControl).width : null,
          disabled: weekOption("Monday") ? weekOption("Monday").disabled : null,
          active:
            weekOption("Monday")?.getAttribute("aria-checked") === "true"
              ? "monday"
              : weekOption("Sunday")?.getAttribute("aria-checked") === "true"
                ? "sunday"
                : null
        }
      : null,
    books,
    error: alert ? text(alert) : null,
    calls: {
      dialog: [...(calls.dialog ?? [])],
      open: [...(calls.open ?? [])],
      recent: calls.recent ?? 0,
      settings: [...(calls.settings ?? [])],
      export: [...(calls.export ?? [])],
      restore: [...(calls.restore ?? [])]
    }
  };
})()`;

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

/** `undefined`-safe, readable rendering of a measured value in a failure line. */
const show = (value) => JSON.stringify(value ?? null);

/**
 * Ask the window for a size, then PROVE it took it by measuring the real
 * viewport. The window manager on this box clamps a resize that lands on the
 * same frame as the first `showInactive` (a 1280x900 ask measures 922x1001),
 * and a rig that asserts geometry against the clamped size measures a sheet
 * narrower than its contract and fails checks that have nothing to do with the
 * component. The second ask sticks, so the loop is short; if it never sticks,
 * the rig fails loudly rather than asserting against the wrong layout.
 */
async function sizeWindow(win, width, height, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    win.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const measured = await win.webContents.executeJavaScript(
      "({ w: window.innerWidth, h: window.innerHeight })",
      true,
    );
    if (measured?.w === width && measured?.h === height) return measured;
  }
  throw new Error(
    `the window would not take ${width}x${height} — the rig cannot assert geometry`,
  );
}

async function main() {
  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers. Painting is the
    // switch at the top of this file.
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
    return sample();
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `settings-vault-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return path.basename(file);
  };

  /** Click the control whose own label is `label`, anywhere on the page. */
  const clickButton = (label) =>
    run(`(() => {
      const el = Array.from(document.querySelectorAll("button")).find(
        (b) => ((b.textContent || "").trim() === ${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Click a labelled control inside the books row for `domain`. */
  const clickBookControl = (domain, label, selector = "button") =>
    run(`(() => {
      const row = Array.from(document.querySelectorAll(".settings-card__row--books")).find(
        (candidate) => ((candidate.querySelector(".settings-card__label")?.textContent ?? "").trim() === ${JSON.stringify(domain)})
      );
      if (!row) return false;
      const el = Array.from(row.querySelectorAll(${JSON.stringify(selector)})).find(
        (candidate) => ((candidate.textContent || "").trim() === ${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Click the switch that arms restore on the books row for `domain`. */
  const clickBookSwitch = (domain) =>
    run(`(() => {
      const row = Array.from(document.querySelectorAll(".settings-card__row--books")).find(
        (candidate) => ((candidate.querySelector(".settings-card__label")?.textContent ?? "").trim() === ${JSON.stringify(domain)})
      );
      if (!row) return false;
      const toggle = row.querySelector('[role="switch"]');
      if (!toggle) return false;
      toggle.click();
      return true;
    })()`);

  /** Click a week-start option by its visible label. */
  const clickWeekStart = (label) =>
    run(`(() => {
      const row = Array.from(document.querySelectorAll(".settings-card__row")).find(
        (candidate) => ((candidate.querySelector(".settings-card__label")?.textContent ?? "").trim() === "Week starts on")
      );
      if (!row) return false;
      const el = Array.from(row.querySelectorAll(".ui-segmented button")).find(
        (candidate) => ((candidate.textContent || "").trim() === ${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** A harness knob: what the picker answers, whether the open is refused. */
  const setKnob = (name, value) =>
    run(
      `(() => { window.vaultKnobs[${JSON.stringify(name)}](${JSON.stringify(value)}); return true; })()`,
    );

  const book = (state, label) =>
    state.books.find((candidate) => candidate.label === label) ?? null;

  let report = {
    url: baseUrl,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: {
      open: VAULT_A,
      switchTo: VAULT_B,
      refusal: REFUSAL,
      restoreRefusal: RESTORE_REFUSAL,
    },
    states: {},
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(baseUrl);
    await run("window.settingsVaultHarnessReady.then(() => true)");

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    // Shown, without focus, before the first capture. On this machine a window
    // that was never shown produces no compositor frame, so `capturePage()`
    // never settles and the rig dies at its watchdog having printed only the
    // step it was on. The suite's `disable-backgrounding-occluded-windows`
    // switch keeps an occluded window's rAF firing, but it does not make a
    // hidden window paint, so the capture still hangs here — `showInactive()`
    // is what makes this rig run on this box.
    win.showInactive();
    await sizeWindow(win, DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 1 — the page painted, with the vault it knows, before anything is asked.
    const landing = await settle();
    check(
      "the settings page names the vault that is open",
      landing.vaultPath === VAULT_A.path &&
        landing.vaultId === VAULT_A.id &&
        landing.vaultName === VAULT_A.name,
      `path ${show(landing.vaultPath)}, id ${show(landing.vaultId)}, name ${show(landing.vaultName)}`,
    );

    // The identity list is rows, not stacked headings: label on the leading
    // edge, value on the trailing one, each row ruled off from the next.
    check(
      "the identity list is three label/value rows",
      landing.identity.length === 3 &&
        landing.identity.every((entry) => entry.label && entry.value),
      `identity ${show(landing.identity.map((entry) => [entry.label, entry.value]))}`,
    );
    check(
      "each identity value sits to the right of its label",
      landing.identity.every(
        (entry) =>
          entry.labelBox && entry.valueBox && entry.labelBox.right <= entry.valueBox.left,
      ),
      `rows ${show(
        landing.identity.map((entry) => [
          entry.label,
          entry.labelBox?.right,
          entry.valueBox?.left,
        ]),
      )}`,
    );
    check(
      "identity rows are spaced apart rather than stacked",
      landing.identity.every((entry, index) => {
        if (index === 0) return true;
        const previous = landing.identity[index - 1];
        // Rows abut (the hairline is the next row's border), so the space that
        // matters is between the previous value and the next label.
        return entry.labelBox && previous.valueBox
          ? entry.labelBox.top - previous.valueBox.bottom >= 12
          : false;
      }),
      `gaps ${show(
        landing.identity.map((entry, index) =>
          index === 0
            ? null
            : (entry.labelBox?.top ?? 0) - (landing.identity[index - 1].valueBox?.bottom ?? 0),
        ),
      )}`,
    );

    // Two blocks on this page (Vault and Books): the heading of the second must
    // not butt against the card of the first.
    check(
      "the two settings blocks are separated",
      landing.sections.length >= 2 &&
        landing.sections[1].top - landing.sections[0].bottom >= 24,
      `sections ${show(landing.sections)}`,
    );

    // 2 — the vault-folder row: one line, name left, control right, a real gap.
    check(
      "the folder row offers the app's own control",
      landing.folderRow?.label === "Vault folder" &&
        landing.folderRow?.button !== null &&
        (landing.folderRow?.button?.className ?? "").includes("btn"),
      `row ${show(landing.folderRow?.label)}, button ${show(landing.folderRow?.button)}`,
    );
    check(
      "the folder row says what the control does",
      /vault folder/i.test(landing.folderRow?.description ?? "") &&
        (landing.folderRow?.description ?? "").length > 40,
      `description ${show(landing.folderRow?.description)}`,
    );
    check(
      "the folder row's control is on the trailing edge, clear of its copy",
      landing.folderRow?.copy &&
        landing.folderRow?.control &&
        landing.folderRow.control.left > landing.folderRow.copy.right &&
        landing.folderRow.control.left - landing.folderRow.copy.right >= 16,
      `copy right ${show(landing.folderRow?.copy?.right)}, control left ${show(
        landing.folderRow?.control?.left,
      )}`,
    );
    check(
      "the folder control is live before anything is asked",
      landing.folderRow?.button?.disabled === false &&
        landing.folderRow?.button?.label === "Change folder…",
      `label ${show(landing.folderRow?.button?.label)}, disabled ${show(
        landing.folderRow?.button?.disabled,
      )}`,
    );
    check(
      "the folder control wears the settings card's corner, not the pill",
      (landing.folderRow?.button?.radius ?? 999) <= 12,
      `radius ${show(landing.folderRow?.button?.radius)}`,
    );

    // 3 — the week-start control is on the label's line, and compact.
    check(
      "the week-start row is labelled and controlled",
      landing.weekStart?.label === "Week starts on" &&
        landing.weekStart?.controlClassName?.includes("ui-segmented--sm"),
      `label ${show(landing.weekStart?.label)}, class ${show(
        landing.weekStart?.controlClassName,
      )}`,
    );
    check(
      "the week-start control rides on its heading's line",
      landing.weekStart?.labelBox &&
        landing.weekStart?.control &&
        Math.abs(landing.weekStart.control.top - landing.weekStart.labelBox.top) <= 8 &&
        landing.weekStart.control.left > landing.weekStart.labelBox.right,
      `label top ${show(landing.weekStart?.labelBox?.top)}, control top ${show(
        landing.weekStart?.control?.top,
      )}, label right ${show(landing.weekStart?.labelBox?.right)}, control left ${show(
        landing.weekStart?.control?.left,
      )}`,
    );
    check(
      "the week-start control is small, not a full-width bar",
      (landing.weekStart?.height ?? 999) <= 30 &&
        (landing.weekStart?.width ?? 999) <= 240,
      `size ${show(landing.weekStart?.width)}x${show(landing.weekStart?.height)}`,
    );
    check(
      "a live week-start setting does not claim it cannot change",
      landing.weekStart?.description === null,
      `description ${show(landing.weekStart?.description)}`,
    );
    screenshots.push(await shot("landing"));

    // 2b — the sheet has a measure, not a share. On a wider window the panel
    //      keeps its width, the page's card keeps its width, and the extra
    //      window becomes mat on both sides of a centred panel.
    await sizeWindow(win, WIDE_SIZE.width, WIDE_SIZE.height);
    const wide = await settle(320);
    const wideGutters = wide.frame.leftGutter + wide.frame.rightGutter;
    check(
      "the settings sheet fits its own measure at the standard window",
      Math.abs((landing.frame.panel?.width ?? 0) - SHEET_MEASURE_PX) <= 1,
      `panel ${show(landing.frame.panel?.width)} vs measure ${SHEET_MEASURE_PX}`,
    );
    check(
      "the settings sheet does not grow with a wider window",
      Math.abs((wide.frame.panel?.width ?? 0) - (landing.frame.panel?.width ?? 0)) <= 1,
      `panel ${show(wide.frame.panel?.width)} after widening from ${show(landing.frame.panel?.width)}`,
    );
    check(
      "the page inside the sheet keeps its width on a wider window",
      Math.abs((wide.frame.card?.width ?? 0) - (landing.frame.card?.width ?? 0)) <= 1,
      `card ${show(wide.frame.card?.width)} after widening from ${show(landing.frame.card?.width)}`,
    );
    check(
      "the wider window grew mat on both sides instead of widening the sheet",
      (wide.frame.leftGutter ?? 0) >= 100 &&
        (wide.frame.rightGutter ?? 0) >= 100 &&
        wideGutters - ((landing.frame.leftGutter ?? 0) + (landing.frame.rightGutter ?? 0)) >= 100,
      `gutters ${show([
        landing.frame.leftGutter,
        landing.frame.rightGutter,
        wide.frame.leftGutter,
        wide.frame.rightGutter,
      ])}`,
    );
    check(
      "the capped panel is centred in the window",
      Math.abs((wide.frame.leftGutter ?? 0) - (wide.frame.rightGutter ?? 0)) <= 2,
      `left ${show(wide.frame.leftGutter)}, right ${show(wide.frame.rightGutter)}`,
    );
    screenshots.push(await shot("wide"));
    await sizeWindow(win, DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await settle(260);

    // 4 — the week-start switch changes the setting, in place.
    const weekClicked = await clickWeekStart("Sunday");
    const week = await settle();
    check("clicked Sunday on the week-start row", weekClicked, "no Sunday option");
    check(
      "the week-start switch asks the vault for the chosen day",
      week.calls.settings.length === 1 && week.calls.settings[0].weekStartDay === "sunday",
      `settings ${show(week.calls.settings)}`,
    );
    check(
      "the chosen day is the one now shown as active",
      week.weekStart?.active === "sunday",
      `active ${show(week.weekStart?.active)}`,
    );
    screenshots.push(await shot("week-start"));

    // 5 — books: export is live, restore is armed only by its switch, and the
    // switch is a large track (not a checkbox) on the row's trailing edge.
    check(
      "the books block has one row per live domain, archived ones filtered out",
      landing.books.length === 2 &&
        landing.books.some((row) => row.label === "Health") &&
        landing.books.some((row) => row.label === "Finance") &&
        !landing.books.some((row) => row.label === "Retired"),
      `rows ${show(landing.books.map((row) => row.label))}`,
    );
    for (const row of landing.books) {
      check(
        `the ${row.label} row has no checkbox`,
        row.checkboxCount === 0,
        `checkboxes ${row.checkboxCount}`,
      );
      check(
        `the ${row.label} row gates restore with a labelled switch`,
        row.toggle !== null &&
          row.toggle.checked === "false" &&
          /allow restore/i.test(row.toggle.text),
        `toggle ${show(row.toggle)}`,
      );
      check(
        `the ${row.label} switch is large enough to read as the way in`,
        (row.toggle?.track?.width ?? 0) >= 40 && (row.toggle?.track?.height ?? 0) >= 20,
        `track ${show(row.toggle?.track)}`,
      );
      check(
        `the ${row.label} restore is closed until the switch arms it`,
        row.restoreButton?.disabled === true && row.exportButton?.disabled === false,
        `restore ${show(row.restoreButton?.disabled)}, export ${show(
          row.exportButton?.disabled,
        )}`,
      );
      check(
        `${row.label}'s buttons wear the card corner, not the pill`,
        (row.exportButton?.radius ?? 999) <= 12 && (row.restoreButton?.radius ?? 999) <= 12,
        `radii ${show([row.exportButton?.radius, row.restoreButton?.radius])}`,
      );
      check(
        `${row.label}'s name is on the left and its controls on the right`,
        row.labelBox &&
          row.control &&
          row.control.left > row.labelBox.right &&
          row.control.left - row.copy.right >= 16,
        `label right ${show(row.labelBox?.right)}, copy right ${show(
          row.copy?.right,
        )}, control left ${show(row.control?.left)}`,
      );
    }
    check(
      "books rows are spaced apart rather than stacked",
      landing.books.length >= 2 &&
        (landing.books[1]?.labelBox?.top ?? 0) -
          (landing.books[0]?.labelBox?.bottom ?? 0) >=
          40,
      `gap ${show(
        (landing.books[1]?.labelBox?.top ?? 0) -
          (landing.books[0]?.labelBox?.bottom ?? 0),
      )}`,
    );
    check(
      "nothing was written before the operator asked",
      landing.calls.export.length === 0 &&
        landing.calls.restore.length === 0 &&
        landing.calls.dialog.length === 0 &&
        landing.calls.open.length === 0 &&
        landing.error === null,
      `export ${show(landing.calls.export)}, restore ${show(landing.calls.restore)}, error ${show(landing.error)}`,
    );

    // 6 — export writes, and says so on its own row.
    const exported = await clickBookControl("Health", "Export books");
    const exportState = await settle();
    check("clicked Export books on the Health row", exported, "no Export books control");
    check(
      "export asked the vault for the Health domain",
      show(exportState.calls.export) === show(["health"]),
      `export ${show(exportState.calls.export)}`,
    );
    check(
      "export reported itself on the Health row, not another",
      (book(exportState, "Health")?.messages ?? []).some(
        (message) => message.role === "status" && /exported books for health/i.test(message.text),
      ) &&
        (book(exportState, "Finance")?.messages ?? []).length === 0,
      `messages ${show(exportState.books.map((row) => [row.label, row.messages]))}`,
    );

    // 7 — arming one row opens that row's restore and leaves the other closed.
    const armedClick = await clickBookSwitch("Health");
    const armed = await settle();
    check("clicked the Health restore switch", armedClick, "no switch on the Health row");
    check(
      "the Health switch is on and its restore is open",
      book(armed, "Health")?.toggle?.checked === "true" &&
        book(armed, "Health")?.restoreButton?.disabled === false,
      `toggle ${show(book(armed, "Health")?.toggle?.checked)}, restore ${show(
        book(armed, "Health")?.restoreButton?.disabled,
      )}`,
    );
    check(
      "arming one domain does not arm another",
      book(armed, "Finance")?.restoreButton?.disabled === true &&
        book(armed, "Finance")?.toggle?.checked === "false",
      `finance restore ${show(book(armed, "Finance")?.restoreButton?.disabled)}`,
    );
    screenshots.push(await shot("books-armed"));

    // 8 — a restore carries the confirmation, then the row disarms itself.
    const restoredClick = await clickBookControl("Health", "Restore books");
    const restored = await settle();
    check("clicked Restore books on the Health row", restoredClick, "no Restore books control");
    check(
      "restore asked the vault to confirm-restore the Health domain",
      show(restored.calls.restore) === show(["health"]),
      `restore ${show(restored.calls.restore)}`,
    );
    check(
      "a finished restore disarms its row again",
      book(restored, "Health")?.toggle?.checked === "false" &&
        book(restored, "Health")?.restoreButton?.disabled === true,
      `toggle ${show(book(restored, "Health")?.toggle?.checked)}, restore ${show(
        book(restored, "Health")?.restoreButton?.disabled,
      )}`,
    );

    // 9 — a refused restore names the failure on the row that asked for it.
    await setKnob("setRestoreRefuses", true);
    await clickBookSwitch("Health");
    await settle(120);
    await clickBookControl("Health", "Restore books");
    const refusedRestore = await settle();
    check(
      "a refused restore reached the vault",
      show(refusedRestore.calls.restore) === show(["health", "health"]),
      `restore ${show(refusedRestore.calls.restore)}`,
    );
    check(
      "a refused restore says why on its own row",
      (book(refusedRestore, "Health")?.messages ?? []).some(
        (message) => message.role === "alert" && message.text === RESTORE_REFUSAL,
      ) &&
        (book(refusedRestore, "Finance")?.messages ?? []).length === 0,
      `messages ${show(refusedRestore.books.map((row) => [row.label, row.messages]))}`,
    );
    // Clean up: a successful restore clears the row's error again, which also
    // proves the error is not sticky once the next attempt works.
    await setKnob("setRestoreRefuses", false);
    await clickBookControl("Health", "Restore books");
    const recovered = await settle();
    check(
      "a later successful restore clears the refused message",
      (book(recovered, "Health")?.messages ?? []).every((message) => !message.error) &&
        book(recovered, "Health")?.toggle?.checked === "false",
      `messages ${show(book(recovered, "Health")?.messages)}`,
    );

    // 10 — a cancelled folder picker asks no open and moves nothing.
    await setKnob("setDialogAnswer", null);
    const cancelledClick = await clickButton("Change folder…");
    const cancelled = await settle();
    check("clicked Change folder on the vault row", cancelledClick, "no Change folder control");
    check(
      "the click asked the platform for a folder",
      cancelled.calls.dialog.length === 1 && cancelled.calls.dialog[0] === null,
      `dialog ${show(cancelled.calls.dialog)}`,
    );
    check(
      "a cancelled picker opened no vault",
      cancelled.calls.open.length === 0,
      `open ${show(cancelled.calls.open)}`,
    );
    check(
      "a cancelled picker left the open vault on screen",
      cancelled.vaultPath === VAULT_A.path &&
        cancelled.vaultId === VAULT_A.id &&
        cancelled.error === null,
      `path ${show(cancelled.vaultPath)}, id ${show(cancelled.vaultId)}, error ${show(cancelled.error)}`,
    );
    check(
      "the control came back live after the cancelled ask",
      cancelled.folderRow?.button?.disabled === false,
      `disabled ${show(cancelled.folderRow?.button?.disabled)}`,
    );

    // 11 — while the open is in flight the control is closed, so a second
    //      dialog cannot be asked over the first.
    await setKnob("setDialogAnswer", VAULT_B.path);
    await setKnob("setOpenDelay", OPEN_DELAY_MS);
    await clickButton("Change folder…");
    const inFlight = await settle(120);
    check(
      "the control is closed while the open is in flight",
      inFlight.folderRow?.button?.disabled === true &&
        inFlight.folderRow?.button?.label === "Opening…",
      `label ${show(inFlight.folderRow?.button?.label)}, disabled ${show(
        inFlight.folderRow?.button?.disabled,
      )}`,
    );
    check(
      "the open is still in flight while the control is closed",
      inFlight.calls.open.length === 1 && inFlight.calls.open[0] === VAULT_B.path,
      `open ${show(inFlight.calls.open)}`,
    );
    check(
      "the old vault is still on screen while the open is in flight",
      inFlight.vaultPath === VAULT_A.path,
      `path ${show(inFlight.vaultPath)}`,
    );
    screenshots.push(await shot("in-flight"));

    const switched = await settle(OPEN_DELAY_MS + 200);
    check(
      "the open carried the folder the picker answered",
      switched.calls.dialog[switched.calls.dialog.length - 1] === VAULT_B.path &&
        switched.calls.open.length === 1,
      `dialog ${show(switched.calls.dialog)}, open ${show(switched.calls.open)}`,
    );
    check(
      "the switch replaced the vault the page names",
      switched.vaultPath === VAULT_B.path &&
        switched.vaultId === VAULT_B.id &&
        switched.vaultName === VAULT_B.name,
      `path ${show(switched.vaultPath)}, id ${show(switched.vaultId)}, name ${show(switched.vaultName)}`,
    );
    check(
      "the switch re-read the recent list, so the next start reopens the new vault",
      switched.calls.recent > landing.calls.recent,
      `recent ${landing.calls.recent} → ${switched.calls.recent}`,
    );
    check(
      "the control came back live after the switch",
      switched.folderRow?.button?.disabled === false,
      `disabled ${show(switched.folderRow?.button?.disabled)}`,
    );
    screenshots.push(await shot("switched"));

    // 12 — a refused folder keeps the operator on the same surface, on the
    //      same vault, with the refusal named.
    await setKnob("setOpenRefuses", true);
    await setKnob("setOpenDelay", 0);
    const refusedClick = await clickButton("Change folder…");
    const refused = await settle();
    const recentBeforeRefusal = switched.calls.recent;
    check("clicked Change folder again after the switch", refusedClick, "no Change folder control");
    check(
      "the refusal reached the vault it was offered",
      refused.calls.open.length === 2 &&
        refused.calls.open[refused.calls.open.length - 1] === VAULT_B.path,
      `open ${show(refused.calls.open)}`,
    );
    check(
      "a refused folder says why",
      refused.error === REFUSAL,
      `error ${show(refused.error)}`,
    );
    check(
      "a refused folder kept the operator on the same vault",
      refused.vaultPath === VAULT_B.path && refused.vaultId === VAULT_B.id,
      `path ${show(refused.vaultPath)}, id ${show(refused.vaultId)}`,
    );
    check(
      "a refused folder left the switch control on the surface",
      refused.folderRow?.button !== null &&
        refused.folderRow?.button?.disabled === false,
      `button ${show(refused.folderRow?.button)}`,
    );
    check(
      "a refused folder did not re-read the recent list",
      refused.calls.recent === recentBeforeRefusal,
      `recent ${recentBeforeRefusal} → ${refused.calls.recent}`,
    );
    screenshots.push(await shot("refused"));

    // 13 — the locked week-start state, reached by reloading the harness with
    //      weekly files present: the control closes and the row says why.
    await win.loadURL(`${baseUrl}?weeklyFiles=3`);
    await run("window.settingsVaultHarnessReady.then(() => true)");
    const locked = await settle(320);
    check(
      "with weekly files present the week-start control is closed",
      locked.weekStart?.disabled === true,
      `disabled ${show(locked.weekStart?.disabled)}`,
    );
    check(
      "the locked week-start row says why it cannot change",
      /cannot change/i.test(locked.weekStart?.description ?? ""),
      `description ${show(locked.weekStart?.description)}`,
    );
    check(
      "the locked control is still compact and on the heading's line",
      (locked.weekStart?.height ?? 999) <= 30 &&
        Math.abs(
          (locked.weekStart?.control?.top ?? 0) -
            (locked.weekStart?.labelBox?.top ?? 0),
        ) <= 8,
      `week start ${show(locked.weekStart)}`,
    );
    screenshots.push(await shot("week-locked"));

    report.states = {
      landing,
      wide,
      weekStart: week,
      exportState,
      booksArmed: armed,
      booksRestored: restored,
      booksRefused: refusedRestore,
      booksRecovered: recovered,
      folderCancelled: cancelled,
      folderInFlight: inFlight,
      switched,
      folderRefused: refused,
      weekLocked: locked,
    };
    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "settings-vault.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const states = report.states;
  if (states.landing) {
    const table = [
      ["state", "vault", "week", "folder control", "books armed", "restores"],
    ];
    const row = (name, state) => [
      name,
      state?.vaultName ?? "—",
      state?.weekStart?.active ?? "—",
      state?.folderRow?.button?.label ?? "—",
      (state?.books ?? []).map((entry) => `${entry.label}:${entry.toggle?.checked}`).join(" "),
      show(state?.calls?.restore ?? []),
    ];
    table.push(row("landing", states.landing));
    table.push(row("wide window", states.wide));
    table.push(row("week start", states.weekStart));
    table.push(row("books armed", states.booksArmed));
    table.push(row("books restored", states.booksRestored));
    table.push(row("folder cancelled", states.folderCancelled));
    table.push(row("open in flight", states.folderInFlight));
    table.push(row("switched", states.switched));
    table.push(row("open refused", states.folderRefused));
    table.push(row("week locked", states.weekLocked));
    const widths = table[0].map((_, i) => Math.max(...table.map((cells) => cells[i].length)));
    for (const cells of table) {
      console.log(cells.map((cell, i) => cell.padEnd(widths[i])).join("  "));
    }
    console.log("");
  }

  console.log(`report: ${reportFile}`);
  for (const failure of report.failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "settings vault: PASS" : "settings vault: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`settings-vault: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
