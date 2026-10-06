/**
 * Drives the settings-domains harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/settings-domains.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/settings-domains.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * NOT covered here: whether the write itself lands in the vault. The rig answers
 * from a stubbed bridge, so it asserts the question, its geometry, and which call
 * the answer carries — the vault side of `domainArchive`/`domainDelete` is not
 * in this window.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/settings-domains.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The live domain the rig archives, and the archived one it deletes. */
const LIVE_SLUG = "health";
const ARCHIVED_SLUG = "career-old";
const ARCHIVED_NAME = "Career (old)";

const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const card = document.querySelector(".confirm-dialog");
  const backdrop = document.querySelector(".confirm-dialog-backdrop");
  const sheet = document.querySelector(".shell__content");
  const sheetBox = box(sheet);
  const dialogBox = box(card);
  const confirmBtn = dialogBox ? card.querySelector(".confirm-dialog__confirm") : null;
  const cancelBtn = dialogBox ? card.querySelector(".confirm-dialog__cancel") : null;
  const calls = window.domainCalls || { archive: [], remove: [] };

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    cards: Array.from(document.querySelectorAll(".domain-card")).map((el) =>
      text(el.querySelector(".domain-card__name"))
    ),
    archived: Array.from(document.querySelectorAll(".archived-list__item")).map(text),
    sheet: sheetBox,
    archiveCalls: [...calls.archive],
    deleteCalls: [...calls.remove],
    dialog: dialogBox
      ? {
          title: text(card.querySelector(".confirm-dialog__title")),
          message: text(card.querySelector(".confirm-dialog__message")),
          confirmLabel: text(confirmBtn),
          confirmClass: confirmBtn ? confirmBtn.className : null,
          cancelClass: cancelBtn ? cancelBtn.className : null,
          confirmColor: confirmBtn ? getComputedStyle(confirmBtn).color : null,
          cancelColor: cancelBtn ? getComputedStyle(cancelBtn).color : null,
          box: dialogBox,
          backdrop: box(backdrop),
          backdropBackground: backdrop ? getComputedStyle(backdrop).backgroundColor : null,
          // Card centre minus the window's centre: the contract is ~0. Minus the
          // sheet's centre: what it must not be.
          offsetFromWindowX: Math.round(dialogBox.left + dialogBox.width / 2 - window.innerWidth / 2),
          offsetFromWindowY: Math.round(dialogBox.top + dialogBox.height / 2 - window.innerHeight / 2),
          offsetFromSheetX:
            sheetBox === null
              ? null
              : Math.round(
                  dialogBox.left + dialogBox.width / 2 - (sheetBox.left + sheetBox.width / 2)
                ),
          clippedBySheet:
            sheetBox === null
              ? null
              : dialogBox.top < sheetBox.top - 1 ||
                dialogBox.bottom > sheetBox.bottom + 1 ||
                dialogBox.left < sheetBox.left - 1 ||
                dialogBox.right > sheetBox.right + 1
        }
      : null
  };
})()`;

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

const last = (list) => (list.length ? list[list.length - 1] : null);

/** Largest per-channel gap between two computed colours; NaN when unparseable. */
function channels(color) {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length === 3 && raw.every((value) => value <= 1.0001)
    ? raw.map((value) => value * 255)
    : raw;
}
function channelDelta(a, b) {
  const x = channels(a);
  const y = channels(b);
  if (x.length < 3 || y.length < 3) return Number.NaN;
  return Math.max(...x.map((value, index) => Math.abs(value - y[index])));
}

/** Alpha of a computed colour: 1 when it carries none. */
function alphaOf(color) {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3] : 1;
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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
    const file = path.join(artifactsDir, `settings-domains-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return path.basename(file);
  };

  /** Click the control whose own label is `label`, inside `scope`. */
  const clickButton = (scope, label) =>
    run(`(() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(scope)})).find(
        (b) => ((b.textContent || "").trim() === ${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** One of the dock's own confirm dialog's answers. */
  const clickDialog = (which) =>
    run(`(async () => {
      const el = document.querySelector(".confirm-dialog__${which}");
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  let report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: { live: LIVE_SLUG, archived: ARCHIVED_SLUG },
    states: {},
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await run("window.settingsDomainsHarnessReady.then(() => true)");

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 1 — the page painted, the sheet is a real sheet, and nothing is asked yet.
    const landing = await settle();
    check(
      "the settings page painted both lists",
      landing.cards.length === 2 && landing.archived.length === 1,
      `cards ${JSON.stringify(landing.cards)}, archived ${JSON.stringify(landing.archived)}`,
    );
    check(
      "the sheet is the window's own content pane, not the window",
      (landing.sheet?.width ?? 0) > 0 && (landing.sheet?.width ?? 0) < landing.viewport.width,
      `sheet ${JSON.stringify(landing.sheet)} in a ${landing.viewport.width}px window`,
    );
    check(
      "nothing is asked, and nothing is written, before a click",
      landing.dialog === null &&
        landing.archiveCalls.length === 0 &&
        landing.deleteCalls.length === 0,
      `dialog ${JSON.stringify(landing.dialog)}, calls ${JSON.stringify(landing.archiveCalls)}`,
    );

    // 2 — Archive is the soft write: it asks, plainly, and writes nothing yet.
    const archiveClicked = await clickButton(".domain-card__actions button", "Archive");
    const asked = await settle();
    check("clicked Archive on a live domain", archiveClicked, "no Archive control in the card");
    check(
      "the archive asked before it wrote",
      asked.dialog !== null && asked.archiveCalls.length === 0,
      `dialog ${JSON.stringify(asked.dialog)}, calls ${JSON.stringify(asked.archiveCalls)}`,
    );
    check(
      "the question is named for the write it guards",
      asked.dialog?.title === "Archive domain",
      `title "${asked.dialog?.title}"`,
    );
    check(
      "the card is centred in the window",
      Math.abs(asked.dialog?.offsetFromWindowX ?? 999) <= 2 &&
        Math.abs(asked.dialog?.offsetFromWindowY ?? 999) <= 2,
      `card centre is ${asked.dialog?.offsetFromWindowX}px across and ${asked.dialog?.offsetFromWindowY}px down from the window's centre`,
    );
    check(
      "and it is not centred on the sheet it was asked from",
      Math.abs(asked.dialog?.offsetFromSheetX ?? 0) > 40,
      `card centre is ${asked.dialog?.offsetFromSheetX}px from the sheet's centre`,
    );
    check(
      "the scroller does not clip it",
      asked.dialog?.clippedBySheet === false,
      `clipped ${asked.dialog?.clippedBySheet}: card ${JSON.stringify(asked.dialog?.box)} against sheet ${JSON.stringify(asked.sheet)}`,
    );
    check(
      "the scrim covers the window and paints",
      (asked.dialog?.backdrop?.width ?? 0) >= asked.viewport.width - 1 &&
        (asked.dialog?.backdrop?.height ?? 0) >= asked.viewport.height - 1 &&
        alphaOf(asked.dialog?.backdropBackground) > 0.1,
      `backdrop ${JSON.stringify(asked.dialog?.backdrop)} fill ${asked.dialog?.backdropBackground}`,
    );
    check(
      "the soft write wears no danger",
      (asked.dialog?.confirmClass ?? "").includes("btn-primary") &&
        !(asked.dialog?.confirmClass ?? "").includes("btn-danger"),
      `confirm control wears "${asked.dialog?.confirmClass}"`,
    );
    screenshots.push(await shot("archive-confirm"));

    // 3 — Cancelling writes nothing at all.
    const cancelled = await clickDialog("cancel");
    const declined = await settle();
    check("clicked Cancel in the confirm dialog", cancelled, "no Cancel control in the dialog");
    check(
      "a cancelled archive wrote nothing",
      declined.dialog === null &&
        declined.archiveCalls.length === 0 &&
        declined.deleteCalls.length === 0,
      `dialog ${JSON.stringify(declined.dialog)}, calls ${JSON.stringify(declined.archiveCalls)}/${JSON.stringify(declined.deleteCalls)}`,
    );

    // 4 — The retry: the same click, the answer this time.
    await clickButton(".domain-card__actions button", "Archive");
    await settle();
    const archiveConfirmed = await clickDialog("confirm");
    const archived = await settle();
    check("answered the archive", archiveConfirmed, "no confirm control in the dialog");
    check(
      "the answer carried the slug of the row it was opened on",
      last(archived.archiveCalls) === LIVE_SLUG && archived.deleteCalls.length === 0,
      `archive ${JSON.stringify(archived.archiveCalls)}, delete ${JSON.stringify(archived.deleteCalls)}`,
    );
    check(
      "answering closed the question",
      archived.dialog === null,
      `dialog ${JSON.stringify(archived.dialog)}`,
    );

    // 5 — Delete is the final one, and it is the one that wears the danger.
    const deleteClicked = await clickButton(".archived-list__actions button", "Delete");
    const deleteAsked = await settle();
    check(
      "clicked Delete on an archived domain",
      deleteClicked,
      "no Delete control in the archived row",
    );
    check(
      "the delete asked before it wrote",
      deleteAsked.dialog !== null && deleteAsked.deleteCalls.length === 0,
      `dialog ${JSON.stringify(deleteAsked.dialog)}, calls ${JSON.stringify(deleteAsked.deleteCalls)}`,
    );
    check(
      "the question names the domain it will take",
      (deleteAsked.dialog?.message ?? "").includes(ARCHIVED_NAME),
      `message "${deleteAsked.dialog?.message}"`,
    );
    check(
      "the final write wears the danger",
      (deleteAsked.dialog?.confirmClass ?? "").includes("btn-danger") &&
        channelDelta(deleteAsked.dialog?.confirmColor, deleteAsked.dialog?.cancelColor) > 40,
      `confirm wears "${deleteAsked.dialog?.confirmClass}", colour gap ${channelDelta(
        deleteAsked.dialog?.confirmColor,
        deleteAsked.dialog?.cancelColor,
      )}`,
    );
    check(
      "the delete's card is centred in the window too",
      Math.abs(deleteAsked.dialog?.offsetFromWindowX ?? 999) <= 2 &&
        Math.abs(deleteAsked.dialog?.offsetFromWindowY ?? 999) <= 2,
      `card centre is ${deleteAsked.dialog?.offsetFromWindowX}px across and ${deleteAsked.dialog?.offsetFromWindowY}px down from the window's centre`,
    );
    screenshots.push(await shot("delete-confirm"));

    const deleteConfirmed = await clickDialog("confirm");
    const deleted = await settle();
    check("answered the delete", deleteConfirmed, "no confirm control in the dialog");
    check(
      "the delete carried the archived row's slug, and no archive did",
      deleteConfirmed &&
        last(deleted.deleteCalls) === ARCHIVED_SLUG &&
        deleted.deleteCalls.length === 1 &&
        deleted.archiveCalls.length === 1,
      `delete ${JSON.stringify(deleted.deleteCalls)}, archive ${JSON.stringify(deleted.archiveCalls)}`,
    );
    check(
      "answering the delete closed the question",
      deleted.dialog === null,
      `dialog ${JSON.stringify(deleted.dialog)}`,
    );

    report.states = {
      landing,
      asked,
      declined,
      archived,
      deleteAsked,
      deleted,
    };
    report.pass = failures.length === 0;
  } catch (error) {
    report.failures = [
      ...failures,
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ];
    report.pass = false;
  }

  const reportFile = path.join(artifactsDir, "settings-domains.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const states = report.states;
  if (states.asked) {
    const table = [["state", "dialog", "card centre", "sheet centre", "archive calls", "delete calls"]];
    for (const [name, state] of [
      ["landing", states.landing],
      ["archive asked", states.asked],
      ["archive cancelled", states.declined],
      ["archive answered", states.archived],
      ["delete asked", states.deleteAsked],
      ["delete answered", states.deleted],
    ]) {
      table.push([
        name,
        state?.dialog ? state.dialog.title : "—",
        state?.dialog
          ? `${state.dialog.offsetFromWindowX},${state.dialog.offsetFromWindowY}`
          : "—",
        state?.dialog ? String(state.dialog.offsetFromSheetX) : "—",
        JSON.stringify(state?.archiveCalls ?? []),
        JSON.stringify(state?.deleteCalls ?? []),
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
  console.log(report.pass ? "settings domains: PASS" : "settings domains: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`settings-domains: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
