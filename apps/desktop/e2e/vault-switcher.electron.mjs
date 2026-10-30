/**
 * Drives the vault-switcher harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/vault-switcher.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *   node e2e/vault-switcher.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * NOT covered here: whether the folder the picker returns really holds the vault
 * it claims. The rig answers from a stubbed bridge, so it asserts what the
 * titlebar and the switcher DO with the payload they are handed — the control
 * that is clicked, the path the answer carries, the name the chip ends up
 * wearing, and what stays on screen when the open is refused.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/vault-switcher.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The vault open on load, and the two the dialog can switch to. */
const VAULT_A = { id: "vault-a", name: "Harness Vault A", path: "/harness/vault-a" };
const VAULT_B = { id: "vault-b", name: "Harness Vault B", path: "/harness/vault-b" };
const VAULT_C = { id: "vault-c", name: "Harness Vault C", path: "/harness/vault-c" };
const REFUSAL = "No LifeQuest vault in that folder.";
/** Long enough for the driver to catch the dialog while the open is in flight. */
const OPEN_DELAY_MS = 600;

const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const round = (n) => Math.round(n);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left),
      top: round(r.top),
      right: round(r.right),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height)
    };
  };
  const active = document.activeElement;
  const chip = document.querySelector(".window-titlebar__vault");
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  const backdrop = document.querySelector(".vault-switcher-backdrop");
  const rows = Array.from(document.querySelectorAll(".vault-switcher__row")).map((row) => ({
    path: row.getAttribute("data-vault-path"),
    name: text(row.querySelector(".vault-switcher__row-name")),
    pathText: text(row.querySelector(".vault-switcher__row-path")),
    current: row.getAttribute("aria-current") === "true",
    openNow: text(row.querySelector(".vault-switcher__current")),
    disabled: row.disabled === true
  }));
  const folder = dialog ? dialog.querySelector("[data-vault-open-folder]") : null;
  const close = dialog ? dialog.querySelector("[data-vault-close]") : null;
  const probe = document.querySelector("#harness-probe");
  const loc = document.querySelector("#router-probe");
  const calls = window.vaultCalls || { dialog: [], open: [], recent: 0 };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    chip: chip
      ? {
          tag: chip.tagName,
          text: text(chip),
          haspopup: chip.getAttribute("aria-haspopup"),
          expanded: chip.getAttribute("aria-expanded"),
          focused: active === chip,
          appRegion: getComputedStyle(chip).getPropertyValue("-webkit-app-region")
        }
      : null,
    dialog: dialog
      ? {
          title: text(dialog.querySelector(".vault-switcher__title")),
          alert: text(dialog.querySelector('[role="alert"]')),
          busy: dialog.getAttribute("aria-busy") === "true",
          activeInside: dialog.contains(active),
          portal: backdrop ? backdrop.parentElement === document.body : false,
          rows: rows,
          folder: folder
            ? {
                label: text(folder),
                disabled: folder.disabled === true,
                className: folder.className
              }
            : null,
          close: close
            ? { label: close.getAttribute("aria-label"), disabled: close.disabled === true }
            : null
        }
      : null,
    rects: { backdrop: rect(backdrop), dialog: rect(dialog) },
    probe: probe
      ? {
          vault: probe.getAttribute("data-vault"),
          recents: Number(probe.getAttribute("data-recents"))
        }
      : null,
    location: loc
      ? { pathname: loc.getAttribute("data-pathname"), key: loc.getAttribute("data-key") }
      : null,
    trail: Array.isArray(window.routerTrail) ? [...window.routerTrail] : [],
    calls: {
      dialog: [...calls.dialog],
      open: [...calls.open],
      recent: calls.recent
    }
  };
})()`;

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask the window for a size, then PROVE it took it by measuring the real
 * viewport. The window manager on this box clamps a resize that lands on the
 * same frame as the first `showInactive`, and a rig that asserts geometry
 * against the clamped size measures a layout the operator never sees.
 */
async function sizeWindow(win, width, height, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    win.setContentSize(width, height);
    await sleep(150);
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
    await sleep(ms);
    return sample();
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `vault-switcher-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return path.basename(file);
  };

  /** Click the control a selector names, through its own click handler. */
  const click = async (selector) => {
    const clicked = await run(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      return true;
    })()`);
    if (!clicked) throw new Error(`no element for ${selector}`);
  };

  /** Real input, through the browser's own pipeline. */
  const mouse = (type, x, y) => {
    win.webContents.sendInputEvent({
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1,
    });
  };

  const key = (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  };

  /**
   * A scrim pixel that is really the scrim. A press only dismisses if it lands:
   * `sendInputEvent` at a point hits whatever is on top there, and a point that
   * landed on the card would be a control press dressed up as a dismissal.
   */
  const scrimPoint = async () => {
    const point = await run(`(() => {
      const backdrop = document.querySelector(".vault-switcher-backdrop");
      if (!backdrop) return { error: "no backdrop" };
      const r = backdrop.getBoundingClientRect();
      const candidates = [
        { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) },
        { x: Math.round(r.right - 12), y: Math.round(r.top + r.height / 2) },
        { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) }
      ];
      for (const candidate of candidates) {
        if (document.elementFromPoint(candidate.x, candidate.y) === backdrop) {
          return candidate;
        }
      }
      return { error: "no scrim pixel exposed around the card" };
    })()`);
    if (point.error) throw new Error(`cannot click the scrim: ${point.error}`);
    return point;
  };

  /** A harness knob: what the picker answers, whether the open is refused, how slow. */
  const setKnob = (name, value) =>
    run(
      `(() => { window.vaultKnobs[${JSON.stringify(name)}](${JSON.stringify(value)}); return true; })()`,
    );

  const rowSelector = (rootPath) => `[data-vault-path="${rootPath}"]`;
  const otherRows = (state) => (state.dialog?.rows ?? []).filter((row) => !row.current);
  const currentRows = (state) => (state.dialog?.rows ?? []).filter((row) => row.current);
  const rowFor = (state, rootPath) =>
    (state.dialog?.rows ?? []).find((row) => row.path === rootPath) ?? null;

  let report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: { open: VAULT_A, switchTo: VAULT_B, refused: VAULT_C, refusal: REFUSAL },
    states: {},
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await run("window.vaultSwitcherHarnessReady.then(() => true)");

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    // Shown, without focus, before the first capture. On this machine a window
    // that was never shown produces no compositor frame, so `capturePage()`
    // never settles; `showInactive()` is what makes a hidden rig paint.
    win.showInactive();
    await sizeWindow(win, DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);

    // 1 — the chip is a button that promises a dialog, and nothing is asked yet.
    const landing = await settle();
    check(
      "the vault chip is a button, not the NavLink that did nothing",
      landing.chip?.tag === "BUTTON",
      `chip is a ${JSON.stringify(landing.chip?.tag)}`,
    );
    check(
      "the chip still wears the open vault's name",
      landing.chip?.text === VAULT_A.name,
      `chip text ${JSON.stringify(landing.chip?.text)} vs ${JSON.stringify(VAULT_A.name)}`,
    );
    check(
      "the chip announces the dialog it opens, and that it is closed",
      landing.chip?.haspopup === "dialog" && landing.chip?.expanded === "false",
      `aria-haspopup ${JSON.stringify(landing.chip?.haspopup)}, aria-expanded ${JSON.stringify(landing.chip?.expanded)}`,
    );
    check(
      "the chip stays clickable in the window's drag band",
      landing.chip?.appRegion === "no-drag",
      `app-region ${JSON.stringify(landing.chip?.appRegion)}`,
    );
    check(
      "no dialog is drawn before the chip is clicked",
      landing.dialog === null,
      `a dialog is on screen: ${JSON.stringify(landing.dialog?.title)}`,
    );
    check(
      "the page booted on the open vault with its three recents",
      landing.probe?.vault === VAULT_A.path && landing.probe?.recents === 3,
      `probe vault ${JSON.stringify(landing.probe?.vault)}, recents ${landing.probe?.recents}`,
    );
    check(
      "nothing is asked, and no vault opened, before a click",
      landing.calls.dialog.length === 0 &&
        landing.calls.open.length === 0 &&
        landing.calls.recent >= 1,
      `dialog ${JSON.stringify(landing.calls.dialog)}, open ${JSON.stringify(landing.calls.open)}, recent ${landing.calls.recent}`,
    );
    screenshots.push(await shot("landing"));

    // 2 — clicking the chip opens the modal, listing the provider's recents with
    //     the open vault marked.
    await click(".window-titlebar__vault");
    const opened = await settle();
    check(
      "clicking the chip opens the Switch vault dialog",
      opened.dialog !== null && opened.dialog.title === "Switch vault",
      `dialog ${JSON.stringify(opened.dialog?.title ?? null)}`,
    );
    check(
      "the chip reads as expanded while the dialog is up",
      opened.chip?.expanded === "true",
      `aria-expanded ${JSON.stringify(opened.chip?.expanded)}`,
    );
    check(
      "the dialog lists every recent vault with its name and path",
      opened.dialog?.rows.length === 3 &&
        opened.dialog.rows.map((row) => row.name).join("|") ===
          [VAULT_A.name, VAULT_B.name, VAULT_C.name].join("|") &&
        opened.dialog.rows.map((row) => row.pathText).join("|") ===
          [VAULT_A.path, VAULT_B.path, VAULT_C.path].join("|"),
      `rows ${JSON.stringify(opened.dialog?.rows)}`,
    );
    check(
      "the open vault is marked, and only it",
      currentRows(opened).length === 1 &&
        currentRows(opened)[0]?.path === VAULT_A.path &&
        currentRows(opened)[0]?.openNow === "Open now",
      `current ${JSON.stringify(currentRows(opened))}`,
    );
    check(
      "the open vault's own row is a status, not a switch",
      rowFor(opened, VAULT_A.path)?.disabled === true,
      `current row disabled ${JSON.stringify(rowFor(opened, VAULT_A.path)?.disabled)}`,
    );
    check(
      "the other vaults can be opened from their rows",
      otherRows(opened).length === 2 && otherRows(opened).every((row) => !row.disabled),
      `other rows ${JSON.stringify(otherRows(opened))}`,
    );
    check(
      "the dialog offers a way to a folder it has never opened",
      opened.dialog?.folder !== null &&
        opened.dialog?.folder?.label === "Open another folder…" &&
        opened.dialog?.folder?.disabled === false &&
        /\bbtn\b/.test(opened.dialog?.folder?.className ?? ""),
      `folder action ${JSON.stringify(opened.dialog?.folder)}`,
    );
    check(
      "the dialog can be dismissed from its own close control",
      opened.dialog?.close?.label === "Close vault switcher" &&
        opened.dialog?.close?.disabled === false,
      `close ${JSON.stringify(opened.dialog?.close)}`,
    );
    check(
      "opening the dialog moves focus into it",
      opened.dialog?.activeInside === true,
      "focus stayed outside the dialog",
    );
    check(
      "the dialog is portalled to the body, so the titlebar cannot clip it",
      opened.dialog?.portal === true,
      "the backdrop is not a child of document.body",
    );
    check(
      "opening the dialog asks for nothing",
      opened.calls.dialog.length === 0 && opened.calls.open.length === 0,
      `dialog ${JSON.stringify(opened.calls.dialog)}, open ${JSON.stringify(opened.calls.open)}`,
    );
    screenshots.push(await shot("open"));

    // 3 — Escape dismisses, and hands focus back to the chip.
    key("Escape");
    const escaped = await settle(220);
    check(
      "Escape closes the dialog",
      escaped.dialog === null && escaped.chip?.expanded === "false",
      `dialog ${escaped.dialog === null ? "gone" : "still up"}, aria-expanded ${JSON.stringify(escaped.chip?.expanded)}`,
    );
    check(
      "Escape hands focus back to the chip",
      escaped.chip?.focused === true,
      "focus did not return to the chip",
    );
    check(
      "dismissing asks nothing and moves no vault",
      escaped.calls.dialog.length === 0 &&
        escaped.calls.open.length === 0 &&
        escaped.chip?.text === VAULT_A.name,
      `dialog ${JSON.stringify(escaped.calls.dialog)}, open ${JSON.stringify(escaped.calls.open)}, chip ${JSON.stringify(escaped.chip?.text)}`,
    );

    // 4 — the scrim dismisses too, through a real press on a scrim pixel.
    await click(".window-titlebar__vault");
    await settle(140);
    const scrim = await scrimPoint();
    mouse("mouseDown", scrim.x, scrim.y);
    await sleep(40);
    mouse("mouseUp", scrim.x, scrim.y);
    const scrimmed = await settle(220);
    check(
      "clicking the scrim closes the dialog",
      scrimmed.dialog === null && scrimmed.chip?.expanded === "false",
      `dialog ${scrimmed.dialog === null ? "gone" : "still up"}, aria-expanded ${JSON.stringify(scrimmed.chip?.expanded)}`,
    );
    check(
      "the scrim hands focus back to the chip",
      scrimmed.chip?.focused === true,
      "focus did not return to the chip",
    );

    // 5 — a cancelled picker: the dialog stays up, and nothing else is asked.
    await click(".window-titlebar__vault");
    await settle(140);
    await setKnob("setDialogAnswer", null);
    await click("[data-vault-open-folder]");
    const cancelled = await settle();
    check(
      "Open another folder asks the platform picker",
      cancelled.calls.dialog.length === 1 && cancelled.calls.dialog[0] === null,
      `dialog asks ${JSON.stringify(cancelled.calls.dialog)}`,
    );
    check(
      "a cancelled picker opens no vault and asks nothing else",
      cancelled.calls.open.length === 0,
      `open ${JSON.stringify(cancelled.calls.open)}`,
    );
    check(
      "a cancelled picker leaves the dialog up on the same vault",
      cancelled.dialog !== null &&
        cancelled.chip?.expanded === "true" &&
        cancelled.chip?.text === VAULT_A.name &&
        cancelled.probe?.vault === VAULT_A.path,
      `dialog ${cancelled.dialog === null ? "gone" : "up"}, chip ${JSON.stringify(cancelled.chip?.text)}, vault ${JSON.stringify(cancelled.probe?.vault)}`,
    );
    check(
      "a cancelled picker reports no refusal",
      cancelled.dialog?.alert === "",
      `alert ${JSON.stringify(cancelled.dialog?.alert)}`,
    );
    check(
      "the controls come back live after a cancelled picker",
      cancelled.dialog?.folder?.label === "Open another folder…" &&
        cancelled.dialog?.folder?.disabled === false &&
        otherRows(cancelled).every((row) => !row.disabled),
      `folder ${JSON.stringify(cancelled.dialog?.folder)}, rows ${JSON.stringify(cancelled.dialog?.rows)}`,
    );

    // 6 — picking a row calls vaultOpen with exactly that path, and while the
    //     open is in flight the whole dialog is closed for further switches.
    await setKnob("setDialogAnswer", VAULT_C.path);
    await setKnob("setOpenDelay", OPEN_DELAY_MS);
    await click(rowSelector(VAULT_B.path));
    const inFlight = await settle(140);
    check(
      "picking a vault opens exactly the row's path",
      inFlight.calls.open.length === 1 && inFlight.calls.open[0] === VAULT_B.path,
      `open ${JSON.stringify(inFlight.calls.open)}`,
    );
    check(
      "picking a recent vault never asks the platform picker",
      inFlight.calls.dialog.length === 1,
      `dialog asks ${JSON.stringify(inFlight.calls.dialog)}`,
    );
    check(
      "the dialog stays up while the switch is in flight",
      inFlight.dialog !== null && inFlight.chip?.expanded === "true",
      `dialog ${inFlight.dialog === null ? "gone" : "up"}`,
    );
    check(
      "every row is disabled while the switch is in flight",
      inFlight.dialog !== null && inFlight.dialog.rows.every((row) => row.disabled),
      `rows ${JSON.stringify(inFlight.dialog?.rows)}`,
    );
    check(
      "the dialog says it is busy, and its folder action closes with it",
      inFlight.dialog?.busy === true &&
        inFlight.dialog?.folder?.disabled === true &&
        inFlight.dialog?.folder?.label === "Opening…" &&
        inFlight.dialog?.close?.disabled === true,
      `busy ${JSON.stringify(inFlight.dialog?.busy)}, folder ${JSON.stringify(inFlight.dialog?.folder)}, close ${JSON.stringify(inFlight.dialog?.close)}`,
    );
    check(
      "the old vault is still the one on screen mid-flight",
      inFlight.chip?.text === VAULT_A.name && inFlight.probe?.vault === VAULT_A.path,
      `chip ${JSON.stringify(inFlight.chip?.text)}, vault ${JSON.stringify(inFlight.probe?.vault)}`,
    );
    check(
      "the switch has not gone home mid-flight",
      inFlight.location?.key === landing.location?.key,
      `location key ${JSON.stringify(inFlight.location?.key)} vs ${JSON.stringify(landing.location?.key)}`,
    );
    screenshots.push(await shot("in-flight"));

    // 7 — the switch lands: dialog gone, new name on the chip, and /home.
    const switched = await settle(OPEN_DELAY_MS + 350);
    check(
      "a finished switch closes the dialog",
      switched.dialog === null && switched.chip?.expanded === "false",
      `dialog ${switched.dialog === null ? "gone" : "still up"}, aria-expanded ${JSON.stringify(switched.chip?.expanded)}`,
    );
    check(
      "the chip now wears the new vault's name",
      switched.chip?.text === VAULT_B.name && switched.probe?.vault === VAULT_B.path,
      `chip ${JSON.stringify(switched.chip?.text)}, vault ${JSON.stringify(switched.probe?.vault)}`,
    );
    check(
      "the switch opened exactly one vault, the row's path",
      switched.calls.open.length === 1 && switched.calls.open[0] === VAULT_B.path,
      `open ${JSON.stringify(switched.calls.open)}`,
    );
    check(
      "the switch re-read the recent list, so the next start reopens the new vault",
      switched.calls.recent > inFlight.calls.recent,
      `recent ${inFlight.calls.recent} → ${switched.calls.recent}`,
    );
    check(
      "the switch navigates home",
      switched.location?.pathname === "/home" &&
        switched.location?.key !== landing.location?.key &&
        switched.trail[switched.trail.length - 1] ===
          `/home|${switched.location?.key}`,
      `pathname ${JSON.stringify(switched.location?.pathname)}, key ${JSON.stringify(switched.location?.key)} vs ${JSON.stringify(landing.location?.key)}, trail ${JSON.stringify(switched.trail)}`,
    );
    check(
      "focus is back on the chip after a completed switch",
      switched.chip?.focused === true,
      "focus did not return to the chip",
    );
    screenshots.push(await shot("switched"));

    // 8 — a refused folder: the refusal is named inside the dialog, the old
    //     vault stays, and the operator can try again without reopening it.
    await click(".window-titlebar__vault");
    await settle(140);
    await setKnob("setOpenRefuses", true);
    await setKnob("setOpenDelay", 0);
    await click(rowSelector(VAULT_C.path));
    const refused = await settle(260);
    check(
      "a refused folder names the refusal inside the dialog",
      refused.dialog !== null && refused.dialog.alert === REFUSAL,
      `alert ${JSON.stringify(refused.dialog?.alert ?? null)}`,
    );
    check(
      "a refused folder keeps the dialog up, on the vault that is still open",
      refused.chip?.expanded === "true" &&
        refused.chip?.text === VAULT_B.name &&
        refused.probe?.vault === VAULT_B.path,
      `dialog ${refused.dialog === null ? "gone" : "up"}, chip ${JSON.stringify(refused.chip?.text)}, vault ${JSON.stringify(refused.probe?.vault)}`,
    );
    check(
      "the refused open carried the row's path",
      refused.calls.open[refused.calls.open.length - 1] === VAULT_C.path,
      `open ${JSON.stringify(refused.calls.open)}`,
    );
    check(
      "a refused switch does not go home",
      refused.location?.key === switched.location?.key,
      `location key ${JSON.stringify(refused.location?.key)} vs ${JSON.stringify(switched.location?.key)}`,
    );
    check(
      "a refused switch leaves the rows usable for another try",
      refused.dialog?.folder?.disabled === false &&
        otherRows(refused).length > 0 &&
        otherRows(refused).every((row) => !row.disabled),
      `folder ${JSON.stringify(refused.dialog?.folder)}, rows ${JSON.stringify(refused.dialog?.rows)}`,
    );
    screenshots.push(await shot("refused"));

    // 9 — a refusal does not trap the operator, and the next opening starts
    //     clean rather than greeting them with the last refusal.
    key("Escape");
    const dismissed = await settle(220);
    check(
      "a refusal does not trap the operator in the dialog",
      dismissed.dialog === null && dismissed.chip?.focused === true,
      `dialog ${dismissed.dialog === null ? "gone" : "still up"}, chip focused ${JSON.stringify(dismissed.chip?.focused)}`,
    );
    await click(".window-titlebar__vault");
    const reopened = await settle(160);
    check(
      "the next opening starts without the last refusal",
      reopened.dialog !== null && reopened.dialog.alert === "",
      `alert ${JSON.stringify(reopened.dialog?.alert ?? null)}`,
    );

    report.states = {
      landing,
      opened,
      escaped,
      scrimmed,
      cancelled,
      inFlight,
      switched,
      refused,
      dismissed,
      reopened,
    };
    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "vault-switcher.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const states = report.states;
  if (states.landing) {
    const table = [
      ["state", "chip", "dialog", "rows (open now)", "alert", "opens", "location"],
    ];
    for (const [name, state] of [
      ["landing", states.landing],
      ["opened", states.opened],
      ["escape", states.escaped],
      ["scrim", states.scrimmed],
      ["pick cancelled", states.cancelled],
      ["open in flight", states.inFlight],
      ["switched", states.switched],
      ["open refused", states.refused],
      ["dismissed", states.dismissed],
      ["reopened", states.reopened],
    ]) {
      table.push([
        name,
        state?.chip?.text ?? "—",
        state?.dialog ? `${state.dialog.title}${state.dialog.busy ? " (busy)" : ""}` : "—",
        state?.dialog
          ? `${state.dialog.rows.length} (${state.dialog.rows.filter((row) => row.current).length})`
          : "—",
        state?.dialog?.alert || "—",
        JSON.stringify(state?.calls?.open ?? []),
        state?.location?.pathname ?? "—",
      ]);
    }
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    for (const row of table) {
      console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
    }
    console.log("");
  }

  console.log(`report: ${reportFile}`);
  for (const failure of report.failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "vault switcher: PASS" : "vault switcher: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`vault-switcher: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
