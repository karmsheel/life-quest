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
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/settings-vault.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The two vaults the harness holds: the one open on load, the one it opens. */
const VAULT_A = { id: "vault-a", name: "Harness Vault A", path: "/harness/vault-a" };
const VAULT_B = { id: "vault-b", name: "Harness Vault B", path: "/harness/vault-b" };
const REFUSAL = "No LifeQuest vault in that folder.";
/** Long enough for the driver to catch the control while the open is in flight. */
const OPEN_DELAY_MS = 600;

const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const rows = Array.from(document.querySelectorAll(".settings-card__row"));
  const folderRow = rows.find(
    (row) => text(row.querySelector(".settings-card__label")) === "Vault folder"
  );
  const button = folderRow ? folderRow.querySelector("button") : null;
  const identity = Array.from(document.querySelectorAll(".settings-vault > div")).map((div) => ({
    label: text(div.querySelector("dt")),
    value: text(div.querySelector("dd"))
  }));
  const calls = window.vaultCalls || { dialog: [], open: [], recent: 0 };
  const identityValue = (label) => {
    const entry = identity.find((item) => item.label === label);
    return entry ? entry.value : null;
  };
  const alert = document.querySelector('[role="alert"].form-error');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    identity,
    vaultName: identityValue("Name"),
    vaultId: identityValue("Id"),
    vaultPath: identityValue("Path"),
    folderRowLabel: folderRow ? text(folderRow.querySelector(".settings-card__label")) : null,
    folderRowDescription: folderRow ? text(folderRow.querySelector(".settings-card__desc")) : null,
    button: button
      ? {
          label: text(button),
          className: button.className,
          disabled: button.disabled
        }
      : null,
    error: alert ? text(alert) : null,
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

  /** Click the control whose own label is `label`. */
  const clickButton = (label) =>
    run(`(() => {
      const el = Array.from(document.querySelectorAll("button")).find(
        (b) => ((b.textContent || "").trim() === ${JSON.stringify(label)})
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

  let report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: { open: VAULT_A, switchTo: VAULT_B, refusal: REFUSAL },
    states: {},
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
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

    // 1 — the page painted with a live control, and nothing is asked yet.
    const landing = await settle();
    check(
      "the settings page names the vault that is open",
      landing.vaultPath === VAULT_A.path &&
        landing.vaultId === VAULT_A.id &&
        landing.vaultName === VAULT_A.name,
      `path ${JSON.stringify(landing.vaultPath)}, id ${JSON.stringify(landing.vaultId)}, name ${JSON.stringify(landing.vaultName)}`,
    );
    check(
      "the folder row offers a control",
      landing.folderRowLabel === "Vault folder" && landing.button !== null,
      `label ${JSON.stringify(landing.folderRowLabel)}, button ${JSON.stringify(landing.button)}`,
    );
    check(
      "the row says what the control does",
      /vault folder/i.test(landing.folderRowDescription ?? "") &&
        (landing.folderRowDescription ?? "").length > 40,
      `description ${JSON.stringify(landing.folderRowDescription)}`,
    );
    check(
      "the control wears the app's own button, not a raw one",
      (landing.button?.className ?? "").includes("btn"),
      `button wears "${landing.button?.className}"`,
    );
    check(
      "the control is live before anything is asked",
      landing.button?.disabled === false && landing.button?.label === "Change folder…",
      `label ${JSON.stringify(landing.button?.label)}, disabled ${landing.button?.disabled}`,
    );
    check(
      "nothing is asked, and no vault is opened, before a click",
      landing.calls.dialog.length === 0 &&
        landing.calls.open.length === 0 &&
        landing.error === null,
      `dialog ${JSON.stringify(landing.calls.dialog)}, open ${JSON.stringify(landing.calls.open)}, error ${JSON.stringify(landing.error)}`,
    );
    screenshots.push(await shot("landing"));

    // 2 — a cancelled picker asks no open and moves nothing.
    await setKnob("setDialogAnswer", null);
    const cancelledClick = await clickButton("Change folder…");
    const cancelled = await settle();
    check("clicked Change folder on the vault row", cancelledClick, "no Change folder control");
    check(
      "the click asked the platform for a folder",
      cancelled.calls.dialog.length === 1 && cancelled.calls.dialog[0] === null,
      `dialog ${JSON.stringify(cancelled.calls.dialog)}`,
    );
    check(
      "a cancelled picker opened no vault",
      cancelled.calls.open.length === 0,
      `open ${JSON.stringify(cancelled.calls.open)}`,
    );
    check(
      "a cancelled picker left the open vault on screen",
      cancelled.vaultPath === VAULT_A.path &&
        cancelled.vaultId === VAULT_A.id &&
        cancelled.error === null,
      `path ${JSON.stringify(cancelled.vaultPath)}, id ${JSON.stringify(cancelled.vaultId)}, error ${JSON.stringify(cancelled.error)}`,
    );
    check(
      "the control came back live after the cancelled ask",
      cancelled.button?.disabled === false,
      `disabled ${cancelled.button?.disabled}`,
    );

    // 3 — while the open is in flight the control is closed, so a second
    //     dialog cannot be asked over the first.
    await setKnob("setDialogAnswer", VAULT_B.path);
    await setKnob("setOpenDelay", OPEN_DELAY_MS);
    await clickButton("Change folder…");
    const inFlight = await settle(120);
    check(
      "the control is closed while the open is in flight",
      inFlight.button?.disabled === true && inFlight.button?.label === "Opening…",
      `label ${JSON.stringify(inFlight.button?.label)}, disabled ${inFlight.button?.disabled}`,
    );
    check(
      "the open is still in flight while the control is closed",
      inFlight.calls.open.length === 1 && inFlight.calls.open[0] === VAULT_B.path,
      `open ${JSON.stringify(inFlight.calls.open)}`,
    );
    check(
      "the old vault is still on screen while the open is in flight",
      inFlight.vaultPath === VAULT_A.path,
      `path ${JSON.stringify(inFlight.vaultPath)}`,
    );
    screenshots.push(await shot("in-flight"));

    const switched = await settle(OPEN_DELAY_MS + 200);
    check(
      "the open carried the folder the picker answered",
      switched.calls.dialog[switched.calls.dialog.length - 1] === VAULT_B.path &&
        switched.calls.open.length === 1,
      `dialog ${JSON.stringify(switched.calls.dialog)}, open ${JSON.stringify(switched.calls.open)}`,
    );
    check(
      "the switch replaced the vault the page names",
      switched.vaultPath === VAULT_B.path &&
        switched.vaultId === VAULT_B.id &&
        switched.vaultName === VAULT_B.name,
      `path ${JSON.stringify(switched.vaultPath)}, id ${JSON.stringify(switched.vaultId)}, name ${JSON.stringify(switched.vaultName)}`,
    );
    check(
      "the switch re-read the recent list, so the next start reopens the new vault",
      switched.calls.recent > landing.calls.recent,
      `recent ${landing.calls.recent} → ${switched.calls.recent}`,
    );
    check(
      "the control came back live after the switch",
      switched.button?.disabled === false,
      `disabled ${switched.button?.disabled}`,
    );
    screenshots.push(await shot("switched"));

    // 4 — a refused folder keeps the operator on the same surface, on the
    //     same vault, with the refusal named.
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
      `open ${JSON.stringify(refused.calls.open)}`,
    );
    check(
      "a refused folder says why",
      refused.error === REFUSAL,
      `error ${JSON.stringify(refused.error)}`,
    );
    check(
      "a refused folder kept the operator on the same vault",
      refused.vaultPath === VAULT_B.path && refused.vaultId === VAULT_B.id,
      `path ${JSON.stringify(refused.vaultPath)}, id ${JSON.stringify(refused.vaultId)}`,
    );
    check(
      "a refused folder left the switch control on the surface",
      refused.button !== null && refused.button.disabled === false,
      `button ${JSON.stringify(refused.button)}`,
    );
    check(
      "a refused folder did not re-read the recent list",
      refused.calls.recent === recentBeforeRefusal,
      `recent ${recentBeforeRefusal} → ${refused.calls.recent}`,
    );
    screenshots.push(await shot("refused"));

    report.states = { landing, cancelled, inFlight, switched, refused };
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
    const table = [["state", "path", "button", "error", "dialog asks", "opens"]];
    for (const [name, state] of [
      ["landing", states.landing],
      ["picker cancelled", states.cancelled],
      ["open in flight", states.inFlight],
      ["switched", states.switched],
      ["open refused", states.refused],
    ]) {
      table.push([
        name,
        state?.vaultPath ?? "—",
        state?.button ? `${state.button.label}${state.button.disabled ? " (closed)" : ""}` : "—",
        state?.error ?? "—",
        String(state?.calls?.dialog?.length ?? "—"),
        JSON.stringify(state?.calls?.open ?? []),
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
