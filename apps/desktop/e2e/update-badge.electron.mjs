/**
 * Drives the auto-update badge and popup in a real Electron window and turns the
 * measurements into `e2e/artifacts/update-badge.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/update-badge.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required. It
 * carries the glow itself — the halo's own layers, the two tokens they are drawn
 * with, and the distance the halo reaches against the room the rail gives it — so
 * "the build number glows when a newer release exists" is a set of numbers in a
 * file rather than a screenshot to squint at.
 *
 * NOT covered here: whether the download really happens, whether the bytes are
 * the release's, and whether Windows is handed the file. This rig stubs the
 * bridge, so all three are out of its reach by construction —
 * `update-install.electron.mjs` runs the real main process and the real preload
 * against a feed it owns and covers exactly those.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/update-badge.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/**
 * The build this rig is looking at, off the app's own `package.json` — the same
 * file the badge and the harness both read. Written down here it would rot on the
 * next release.
 */
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
).version;

/** The release the harness's stub feed offers. It must stay newer than the app. */
const OFFERED = "0.4.0";

/** `0.4.0` and `0.1.1` as comparable numbers, for the fixture guard below. */
function versionTuple(text) {
  return text.split(".").map((part) => parseInt(part, 10));
}
function isNewer(candidate, than) {
  const a = versionTuple(candidate);
  const b = versionTuple(than);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

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
  const root = getComputedStyle(document.documentElement);
  const chip = document.querySelector(".nav-rail__version");
  const rail = document.querySelector(".nav-rail");
  const dialog = document.querySelector(".update-dialog");
  const progressBar = document.querySelector(".update-dialog__bar[role=progressbar]");
  const fill = document.querySelector(".update-dialog__bar-fill");
  const notes = document.querySelector(".update-dialog__notes-body");
  const progressText = document.querySelector("[data-update-progress]");
  const error = document.querySelector(".update-dialog__error");
  const chipStyle = chip ? getComputedStyle(chip) : null;
  // The halo lives on the chip's own layer, not on the chip: the breath animates
  // that layer's opacity, so the shadow it paints is read back as written rather
  // than as the oklab() Chromium reports for an interpolated one.
  const haloStyle = chip ? getComputedStyle(chip, "::after") : null;
  const token = (name) => root.getPropertyValue(name).trim();

  // The token layer with its colour space resolved: this skin writes
  // --accent-fill as a color-mix, and a custom property's computed value is the
  // substituted text rather than a colour. Painting it here is what turns it into
  // the numbers a shadow is compared against.
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0";
  document.body.appendChild(probe);
  const resolveInk = (value) => {
    probe.style.backgroundColor = value;
    return getComputedStyle(probe).backgroundColor;
  };
  const tokensResolved = {
    accent: resolveInk("var(--accent)"),
    accentFill: resolveInk("var(--accent-fill)"),
    accentSoft: resolveInk("var(--accent-soft)")
  };
  probe.remove();

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    search: window.location.search,
    harnessScenario: window.updateHarness ? window.updateHarness.scenario : null,
    listenerAttached:
      window.updateHarness && typeof window.updateHarness.listenerAttached === "function"
        ? window.updateHarness.listenerAttached()
        : null,
    // Both harnesses expose a calls record, and each records only the channels
    // its own surface can reach — so every field is read defensively rather than
    // assumed to exist.
    calls: window.updateHarness
      ? (() => {
          const c = window.updateHarness.calls;
          const list = (value) => (Array.isArray(value) ? value : []);
          return {
            check: list(c.check).length,
            checkOptions: list(c.check),
            install: list(c.install).length,
            openRoll: list(c.openRoll).length,
            setToken: list(c.setToken),
            clearToken: typeof c.clearToken === "number" ? c.clearToken : 0,
            installAsset: list(c.install)[0] ?? null
          };
        })()
      : null,
    chip: chip
      ? {
          tag: chip.tagName.toLowerCase(),
          className: chip.className,
          text: (chip.textContent || "").trim(),
          dataState: chip.getAttribute("data-update-state"),
          dataVersion: chip.getAttribute("data-update-version"),
          ariaLabel: chip.getAttribute("aria-label"),
          ariaHaspopup: chip.getAttribute("aria-haspopup"),
          ariaExpanded: chip.getAttribute("aria-expanded"),
          title: chip.getAttribute("title"),
          type: chip.getAttribute("type"),
          box: box(chip),
          color: chipStyle.color,
          background: chipStyle.backgroundColor,
          boxShadow: chipStyle.boxShadow,
          borderRadius: chipStyle.borderRadius,
          cursor: chipStyle.cursor,
          animationName: chipStyle.animationName,
          halo: {
            boxShadow: haloStyle.boxShadow,
            opacity: Number(haloStyle.opacity),
            animationName: haloStyle.animationName,
            content: haloStyle.content,
            pointerEvents: haloStyle.pointerEvents,
            inset: [haloStyle.top, haloStyle.right, haloStyle.bottom, haloStyle.left].join(" ")
          },
          tokens: {
            accent: token("--accent"),
            accentFill: token("--accent-fill"),
            accentSoft: token("--accent-soft"),
            resolved: tokensResolved
          }
        }
      : null,
    rail: rail
      ? {
          box: box(rail),
          scrollTop: rail.scrollTop,
          scrollHeight: rail.scrollHeight,
          clientHeight: rail.clientHeight,
          background: getComputedStyle(rail).backgroundColor
        }
      : null,
    dialog: dialog
      ? {
          box: box(dialog),
          role: dialog.getAttribute("role"),
          ariaModal: dialog.getAttribute("aria-modal"),
          ariaLabelledby: dialog.getAttribute("aria-labelledby"),
          dataVersion: dialog.getAttribute("data-update-dialog"),
          title: (dialog.querySelector(".update-dialog__title")?.textContent || "").trim(),
          versionsText: (
            dialog.querySelector('[data-update-body="versions"]')?.textContent || ""
          )
            .replace(/\\s+/g, " ")
            .trim(),
          fileLine: (dialog.querySelector(".update-dialog__file")?.textContent || "").trim(),
          buttons: Array.from(
            dialog.querySelectorAll(".update-dialog__actions button")
          ).map((el) => ({
            label: el.getAttribute("aria-label") || (el.textContent || "").trim(),
            disabled: el.disabled,
            className: el.className
          })),
          notesToggle: Boolean(dialog.querySelector(".update-dialog__notes-toggle")),
          notesBody: notes ? (notes.textContent || "").trim() : null,
          progressText: progressText ? (progressText.textContent || "").trim() : null,
          progressNow: progressBar ? progressBar.getAttribute("aria-valuenow") : null,
          fillWidth: fill ? getComputedStyle(fill).width : null,
          error: error ? (error.textContent || "").trim() : null
        }
      : null,
    backdropPresent: Boolean(document.querySelector(".update-dialog-backdrop")),
    settings: (() => {
      const summary = document.querySelector("[data-update-summary]");
      const token = document.querySelector("[data-update-token]");
      const input = document.querySelector(".settings-updates__token input");
      if (!summary && !token) return null;
      const text = (sel) => {
        const el = document.querySelector(sel);
        return el ? (el.textContent || "").trim() : null;
      };
      return {
        summaryState: summary ? summary.getAttribute("data-update-summary") : null,
        summaryText: summary ? (summary.textContent || "").trim() : null,
        token: token ? token.getAttribute("data-update-token") : null,
        tokenText: token ? (token.textContent || "").trim() : null,
        inputValue: input ? input.value : null,
        buttons: Array.from(
          document.querySelectorAll(".settings-page-shell button[aria-label]")
        ).map((el) => ({
          label: el.getAttribute("aria-label"),
          disabled: el.disabled
        })),
        message: text(".form-message"),
        error: text(".form-error")
      };
    })(),
    dom: {
      hasRail: Boolean(rail),
      hasChip: Boolean(chip),
      hasShell: Boolean(document.querySelector(".shell")),
      errors: Array.isArray(window.__harnessErrors) ? window.__harnessErrors : null,
      railHtml: rail ? rail.innerHTML.slice(0, 600) : null,
      bodyText: (document.body.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200)
    },
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight
    }
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/**
 * A colour as `{ rgb, alpha }`, where `rgb` is the 0-255 triple.
 *
 * Two serialisations have to be understood here, because this skin's
 * `--accent-fill` is itself a `color-mix`: Chromium writes a plain palette ink as
 * `rgb()`/`rgba()`, and the *resolved* mix as `color(srgb r g b / a)` with 0-1
 * floats. They are the same colour either way, so both are normalised to the same
 * key and the comparison between them is exact — which is what makes "the halo
 * wears the accent" a claim about the palette rather than about a string format.
 */
function parseColor(text) {
  const rgb = /^rgba?\(([^)]+)\)$/.exec((text ?? "").trim());
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    const nums = parts.slice(0, 3).map((part) => parseFloat(part));
    const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
    return { rgb: `rgb(${nums.join(", ")})`, alpha };
  }
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec((text ?? "").trim());
  if (srgb) {
    const body = srgb[1].split("/");
    const nums = body[0]
      .trim()
      .split(/\s+/)
      .map((part) => Math.round(parseFloat(part) * 255));
    const alpha = body.length > 1 ? parseFloat(body[1]) : 1;
    return { rgb: `rgb(${nums.join(", ")})`, alpha };
  }
  return null;
}

/**
 * Every layer of a computed `box-shadow`, in order. Chromium writes the colour
 * first, then the offsets, and a spread only when one was given.
 */
function parseShadowLayers(boxShadow) {
  return (boxShadow ?? "")
    .split(/,(?![^(]*\))/)
    .map((part) => {
      const colour = /(rgba?\([^)]*\)|color\(srgb[^)]*\))/.exec(part);
      const nums = [...part.matchAll(/(-?[\d.]+)px/g)].map((match) =>
        parseFloat(match[1]),
      );
      if (!colour || nums.length < 3) return null;
      return {
        color: parseColor(colour[1]),
        x: nums[0],
        y: nums[1],
        blur: nums[2],
        spread: nums[3] ?? 0,
      };
    })
    .filter(Boolean);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the theme
  // the app itself defaults to, so a test run is not a white sheet flashing
  // across the screen.
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

  // The page's own complaints, kept: a React tree that throws without an error
  // boundary unmounts to an empty `#root` and says nothing to the DOM, so
  // without this the report reads "no chip" rather than naming the error.
  const pageConsole = [];
  win.webContents.on("console-message", (...args) => {
    const details = args[1];
    const level =
      details && typeof details === "object" ? String(details.level ?? "") : String(args[1] ?? "");
    const message =
      details && typeof details === "object" ? String(details.message ?? "") : String(args[2] ?? "");
    if (level === "error" || level === "3") pageConsole.push(message);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.log(`[update-badge] RENDERER GONE ${JSON.stringify(details)}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.log(`[update-badge] DID FAIL LOAD ${code} ${description} ${url}`);
  });

  const loadScenario = async (scenario, view = "rail") => {
    // The scenario rides the page's own query string rather than localStorage:
    // the driver has to choose one before this page has ever been loaded, and
    // there is no origin to write to until then. `view` picks which harness page
    // mounts — the rail's chip, or the Settings view. Two pages rather than one
    // branch, because a page's module graph is evaluated once per load and a flag
    // read off its query string decides what that one page mounts.
    const page = view === "settings" ? "update-settings.html" : "update-badge.html";
    const target = `${url.replace(/[^/]*$/, page)}?scenario=${scenario}`;
    console.log(`[update-badge] loading ${view}/${scenario}`);
    await win.loadURL(target);
    const deadline = Date.now() + 30_000;
    let lastError = "harness globals never appeared";
    for (;;) {
      try {
        // Raced against a page-side timeout on purpose: `executeJavaScript`
        // resolves when the expression's promise does, so a harness whose ready
        // promise never settles would hang this rig until its watchdog instead of
        // failing with a reason. This way the loop keeps making progress and the
        // report can name what the page actually threw.
        const ready = await run(`(async () => {
          if (typeof window.updateHarnessReady !== "object") return "no-globals";
          return Promise.race([
            window.updateHarnessReady.then(() => "ready"),
            new Promise((r) => setTimeout(() => r("pending"), 1500)),
          ]);
        })()`);
        if (ready === "ready") break;
        lastError =
          ready === "pending"
            ? `the harness's ready signal never fired; the page threw ${JSON.stringify(
                await run("window.__harnessErrors ?? null"),
              )}`
            : "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      if (Date.now() > deadline) {
        throw new Error(`harness never became ready for ${scenario}: ${lastError}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 300));
    win.showInactive();
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return run(SAMPLE);
  };

  const click = async (selector) =>
    run(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const pressEscape = async () =>
    run(`(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const shoot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  const shootRailFoot = async (name) => {
    const chip = await run(SAMPLE);
    const y = Math.max(0, (chip.rail?.box.bottom ?? DEFAULT_SIZE.height) - 150);
    const image = await win.webContents.capturePage({
      x: 0,
      y,
      width: Math.max(240, chip.rail?.box.width ?? 240),
      height: 150,
    });
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  let report;
  const screenshots = [];
  const timeout = setTimeout(() => {
    console.error("update-badge: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    // The fixture has to still mean what the assertions below say it means: an
    // offered release this build already matched would turn every one of them into
    // a test of the "up to date" branch, and pass for the wrong reason.
    check(
      "the offered release is still newer than this build",
      isNewer(OFFERED, APP_VERSION),
      `the rig offers ${OFFERED} to a build of ${APP_VERSION} — raise the fixture`,
    );

    // ── 1 — a newer release: the build number glows and opens the upgrade ────
    await loadScenario("available");
    const resting = await settle();

    if (!check("chip exists", Boolean(resting.chip), "no .nav-rail__version in the rail")) {
      console.error(`[update-badge] dom: ${JSON.stringify(resting.dom, null, 2)}`);
      throw new Error("no version chip rendered");
    }
    check(
      "the rail is still one column with the topband in it",
      resting.rail?.scrollTop === 0 &&
        (resting.rail?.scrollHeight ?? 0) <= (resting.rail?.clientHeight ?? 0),
      `scrollTop ${resting.rail?.scrollTop}, content ${resting.rail?.scrollHeight}px in ${resting.rail?.clientHeight}px`,
    );

    // The line itself: still the build number, now a control.
    check(
      "the version line is a button when a release exists",
      resting.chip.tag === "button" && resting.chip.type === "button",
      `tag ${resting.chip.tag} type ${resting.chip.type}`,
    );
    check(
      "the chip wears the available state",
      resting.chip.dataState === "available" &&
        resting.chip.className.includes("nav-rail__version--available"),
      `state ${resting.chip.dataState}, class ${resting.chip.className}`,
    );
    check(
      "the line still reads the running version",
      resting.chip.text === `v${APP_VERSION}`,
      `text ${JSON.stringify(resting.chip.text)}`,
    );
    check(
      "the chip names the release it is offering",
      resting.chip.dataVersion === OFFERED,
      `data-update-version ${JSON.stringify(resting.chip.dataVersion)}`,
    );
    check(
      "the chip is a labelled, dismissible popup trigger",
      typeof resting.chip.ariaLabel === "string" &&
        resting.chip.ariaLabel.includes(OFFERED) &&
        resting.chip.ariaHaspopup === "dialog" &&
        resting.chip.ariaExpanded === "false",
      `aria-label ${JSON.stringify(resting.chip.ariaLabel)}, haspopup ${resting.chip.ariaHaspopup}, expanded ${resting.chip.ariaExpanded}`,
    );
    check(
      "the chip is a pill, not a pane",
      resting.chip.borderRadius !== "0px" && resting.chip.borderRadius !== "",
      `radius ${resting.chip.borderRadius}`,
    );

    // ── the glow ────────────────────────────────────────────────────────────
    const halo = resting.chip.halo;
    const ink = resting.chip.tokens.resolved;
    check(
      "the halo is painted by the chip's own layer",
      halo?.content === '""' &&
        halo?.pointerEvents === "none" &&
        halo?.inset === "0px 0px 0px 0px",
      `content ${JSON.stringify(halo?.content)}, pointer-events ${halo?.pointerEvents}, inset ${JSON.stringify(halo?.inset)}`,
    );
    const layers = parseShadowLayers(halo?.boxShadow ?? "");
    check(
      "the halo is a hairline and a bloom",
      layers.length === 2,
      `layers ${JSON.stringify(layers)}`,
    );
    check(
      "the hairline is the state ink",
      layers[0]?.color?.rgb === parseColor(ink.accent)?.rgb,
      `hairline ${JSON.stringify(layers[0]?.color)} vs --accent ${JSON.stringify(ink.accent)}`,
    );
    check(
      "the bloom is the accent's own translucent fill",
      layers[1]?.color?.rgb === parseColor(ink.accentFill)?.rgb &&
        layers[1]?.color?.alpha === parseColor(ink.accentFill)?.alpha &&
        (layers[1]?.color?.alpha ?? 0) > 0.05,
      `bloom ${JSON.stringify(layers[1]?.color)} vs --accent-fill ${JSON.stringify(ink.accentFill)}`,
    );
    check(
      "the halo is light around the chip, not a lift under it",
      layers.length > 0 &&
        layers.every(
          (layer) =>
            layer.x === 0 && layer.y === 0 && (layer.blur > 0 || layer.spread > 0),
        ),
      `layers ${JSON.stringify(layers)}`,
    );
    // The halo has to fit the room the rail gives it. `.nav-rail` clips its
    // overflow at its own edge, so a bloom wider than the padding around the chip
    // does not fade out — it is sliced off flat, which reads as a box rather than
    // as light. The chip is centred for exactly this reason.
    const reach = Math.max(...layers.map((layer) => layer.blur + layer.spread));
    const room = Math.min(
      (resting.chip.box?.left ?? 0) - (resting.rail?.box.left ?? 0),
      (resting.rail?.box.right ?? 0) - (resting.chip.box?.right ?? 0),
    );
    check(
      "the halo fits inside the rail's own clip",
      layers.length > 0 && reach <= room,
      `the halo reaches ${reach.toFixed(1)}px into ${room}px of room — the rail would slice it flat`,
    );
    check(
      "the halo breathes, unless the operator asked for stillness",
      resting.reducedMotion
        ? halo?.animationName === "none"
        : halo?.animationName === "nav-rail-version-breathe",
      `reduced motion ${resting.reducedMotion}, animation ${halo?.animationName}`,
    );
    check(
      "the breath is on the halo's own layer, so it never repaints the chip",
      resting.chip.animationName === "none" &&
        Number.isFinite(halo?.opacity) &&
        (halo?.opacity ?? 0) > 0 &&
        (halo?.opacity ?? 0) <= 1,
      `chip animation ${resting.chip.animationName}, halo opacity ${halo?.opacity}`,
    );
    check(
      "the chip sits on the accent's own translucent fill",
      resting.chip.background === ink.accentFill,
      `background ${resting.chip.background} vs --accent-fill resolved to ${ink.accentFill}`,
    );
    check(
      "the chip's ink is the state ink",
      resting.chip.color === parseColor(ink.accent)?.rgb,
      `color ${resting.chip.color} vs --accent resolved to ${ink.accent}`,
    );

    // One check per launch, even under StrictMode's second mount effect.
    check(
      "the launch asks the feed exactly once",
      resting.calls?.check === 1,
      `update:check called ${resting.calls?.check} times`,
    );
    check(
      "nothing spilled past the window",
      resting.overflow.scrollWidth <= resting.overflow.clientWidth,
      `scrollWidth ${resting.overflow.scrollWidth} vs ${resting.overflow.clientWidth}`,
    );

    screenshots.push(await shootRailFoot("update-badge-rail-glow.png"));
    screenshots.push(await shoot("update-badge-resting.png"));

    // ── 2 — the popup ───────────────────────────────────────────────────────
    const clicked = await click(".nav-rail__version");
    check("the glowing build number is clickable", clicked, "no chip to click");
    const opened = await settle();

    check(
      "clicking the build number opens the popup",
      Boolean(opened.dialog) && opened.backdropPresent,
      `dialog ${JSON.stringify(opened.dialog)}, backdrop ${opened.backdropPresent}`,
    );
    check(
      "the popup is a modal dialog",
      opened.dialog?.role === "dialog" &&
        opened.dialog?.ariaModal === "true" &&
        Boolean(opened.dialog?.ariaLabelledby),
      `role ${opened.dialog?.role}, aria-modal ${opened.dialog?.ariaModal}, labelledby ${opened.dialog?.ariaLabelledby}`,
    );
    check(
      "the popup names the release",
      opened.dialog?.title === `LifeQuest ${OFFERED}` && opened.dialog?.dataVersion === OFFERED,
      `title ${JSON.stringify(opened.dialog?.title)}, data ${JSON.stringify(opened.dialog?.dataVersion)}`,
    );
    check(
      "the popup names both versions",
      (opened.dialog?.versionsText ?? "").includes(`v${APP_VERSION}`) &&
        (opened.dialog?.versionsText ?? "").includes(OFFERED),
      `body ${JSON.stringify(opened.dialog?.versionsText)}`,
    );
    check(
      "the popup names the file it will download",
      (opened.dialog?.fileLine ?? "").includes(`LifeQuest-${OFFERED}-setup.exe`),
      `file line ${JSON.stringify(opened.dialog?.fileLine)}`,
    );
    const labels = (opened.dialog?.buttons ?? []).map((button) => button.label);
    check(
      "the popup offers install, the release page, and a way out",
      labels.includes("Download and install") &&
        labels.includes("Open the release page") &&
        labels.includes("Not now"),
      `buttons ${JSON.stringify(labels)}`,
    );
    check(
      "the chip reports the popup as open",
      opened.chip?.ariaExpanded === "true",
      `aria-expanded ${opened.chip?.ariaExpanded}`,
    );

    // The release notes sit behind a disclosure; opening it shows the body as
    // written, never parsed into the app.
    check(
      "the notes start folded away",
      opened.dialog?.notesToggle === true && opened.dialog?.notesBody === null,
      `toggle ${opened.dialog?.notesToggle}, body ${JSON.stringify(opened.dialog?.notesBody)}`,
    );
    await click(".update-dialog__notes-toggle");
    const notesOpen = await settle();
    check(
      "opening the notes shows what changed",
      (notesOpen.dialog?.notesBody ?? "").includes("The build number glows"),
      `notes ${JSON.stringify(notesOpen.dialog?.notesBody)}`,
    );

    screenshots.push(await shoot("update-badge-dialog.png"));

    // ── 3 — the install itself ──────────────────────────────────────────────
    await click('.update-dialog button[aria-label="Download and install"]');
    const installing = await settle();
    check(
      "the install reaches the bridge exactly once",
      installing.calls?.install === 1,
      `updateInstall called ${installing.calls?.install} times`,
    );
    check(
      "the bridge is handed the release's own installer",
      installing.calls?.installAsset?.name === `LifeQuest-${OFFERED}-setup.exe`,
      `asset ${JSON.stringify(installing.calls?.installAsset)}`,
    );
    check(
      "the popup reports the install as running",
      (installing.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install" && button.disabled,
      ) &&
        (installing.dialog?.buttons ?? []).some(
          (button) => button.label === "Not now" && button.disabled,
        ),
      `buttons ${JSON.stringify(installing.dialog?.buttons)}`,
    );

    // A progress event through the bridge listener the provider installed.
    const pushed = await run(`window.updateHarness.push(1048576, 4194304)`);
    check("the bridge's progress listener is attached", pushed === true, "no listener");
    const halfway = await settle();
    check(
      "the popup draws the download's progress",
      (halfway.dialog?.progressText ?? "").includes("25%") &&
        halfway.dialog?.progressNow === "25",
      `text ${JSON.stringify(halfway.dialog?.progressText)}, valuenow ${halfway.dialog?.progressNow}`,
    );

    // Not dismissible mid-flight: the download reports itself here.
    await pressEscape();
    const stillOpen = await settle();
    check(
      "the popup cannot be dismissed while the installer is arriving",
      Boolean(stillOpen.dialog),
      "Escape closed the popup mid-download",
    );

    // ── 4 — an install that fails is reported, and the popup reopens ────────
    await loadScenario("install-fails");
    await click(".nav-rail__version");
    await settle();
    await click('.update-dialog button[aria-label="Download and install"]');
    const failed = await settle(400);
    check(
      "a failed install is reported",
      (failed.dialog?.error ?? "").includes("no handler"),
      `error ${JSON.stringify(failed.dialog?.error)}`,
    );
    check(
      "a failed install offers the action again",
      (failed.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install" && !button.disabled,
      ),
      `buttons ${JSON.stringify(failed.dialog?.buttons)}`,
    );
    await pressEscape();
    const dismissed = await settle();
    check(
      "a failed install can still be dismissed",
      dismissed.dialog === null,
      "Escape left the popup on screen after a failed install",
    );

    // ── 5 — up to date: no glow, and no control at all ──────────────────────
    await loadScenario("current");
    const upToDate = await settle();
    check(
      "an up-to-date build keeps its quiet paragraph",
      upToDate.chip?.tag === "p",
      `tag ${upToDate.chip?.tag}`,
    );
    check(
      "an up-to-date build has no glow",
      upToDate.chip?.boxShadow === "none" &&
        !(upToDate.chip?.className ?? "").includes("--available"),
      `box-shadow ${JSON.stringify(upToDate.chip?.boxShadow)}, class ${upToDate.chip?.className}`,
    );
    check(
      "an up-to-date build offers no popup trigger",
      upToDate.chip?.ariaHaspopup === null && upToDate.chip?.dataVersion === null,
      `haspopup ${upToDate.chip?.ariaHaspopup}, data ${upToDate.chip?.dataVersion}`,
    );
    check(
      "an up-to-date build still asks the feed once",
      upToDate.calls?.check === 1,
      `update:check called ${upToDate.calls?.check} times`,
    );
    await click(".nav-rail__version");
    const afterClick = await settle();
    check(
      "clicking a quiet build number opens nothing",
      afterClick.dialog === null && afterClick.backdropPresent === false,
      `dialog ${JSON.stringify(afterClick.dialog)}`,
    );
    screenshots.push(await shoot("update-badge-current.png"));

    // ── 6 — a bridge that does not know this channel ────────────────────────
    await loadScenario("junk");
    const junk = await settle();
    check(
      "an unreadable answer leaves the rail standing",
      Boolean(junk.rail) && junk.chip?.tag === "p",
      `rail ${JSON.stringify(junk.rail?.box)}, chip ${junk.chip?.tag}`,
    );
    check(
      "an unreadable answer is never treated as an update",
      junk.chip?.boxShadow === "none" &&
        !(junk.chip?.className ?? "").includes("--available") &&
        junk.dialog === null,
      `box-shadow ${JSON.stringify(junk.chip?.boxShadow)}, dialog ${JSON.stringify(junk.dialog)}`,
    );
    check(
      "the provider did subscribe to the progress channel",
      junk.listenerAttached === true,
      `listenerAttached ${junk.listenerAttached}`,
    );
    // The one failure no amount of clicking can reach: the subscription's
    // *cleanup*. A handle that is not a function must be left alone rather than
    // called, so unmounting the provider has to be survivable at all.
    const remounted = await run(`window.updateHarness.remount()`);
    check("the provider can be remounted", remounted === true, "no remount hook");
    const afterRemount = await settle(320);
    check(
      "unmounting with a junk progress handle does not throw",
      (afterRemount.dom?.errors?.length ?? 0) === 0,
      `errors ${JSON.stringify(afterRemount.dom?.errors)}`,
    );
    check(
      "the rail survives the remount",
      Boolean(afterRemount.rail) && afterRemount.chip?.tag === "p",
      `rail ${Boolean(afterRemount.rail)}, chip ${afterRemount.chip?.tag}`,
    );
    screenshots.push(await shoot("update-badge-junk.png"));

    // ── 7 — the Settings view: the token, and asking by hand ────────────────
    await loadScenario("available", "settings");
    const settings = await settle();
    check(
      "the Settings view renders its own surface",
      Boolean(settings.settings),
      `settings ${JSON.stringify(settings.settings)}`,
    );
    check(
      "the launch's check reaches the Settings view too",
      settings.calls?.check === 1,
      `update:check called ${settings.calls?.check} times`,
    );
    check(
      "the view reports the release the feed found",
      settings.settings?.summaryState === "available" &&
        (settings.settings?.summaryText ?? "").includes(OFFERED) &&
        (settings.settings?.summaryText ?? "").includes(APP_VERSION),
      `summary ${JSON.stringify(settings.settings?.summaryText)} (${settings.settings?.summaryState})`,
    );
    check(
      "a token that is not stored says so",
      settings.settings?.token === "unset" && settings.settings?.tokenText === "Not set",
      `token ${settings.settings?.token} / ${JSON.stringify(settings.settings?.tokenText)}`,
    );
    const settingsLabels = (settings.settings?.buttons ?? []).map((button) => button.label);
    check(
      "the view offers the token, a check, and the release page",
      settingsLabels.includes("Save GitHub token") &&
        settingsLabels.includes("Remove GitHub token") &&
        settingsLabels.includes("Check for updates now") &&
        settingsLabels.includes("Open the release page"),
      `buttons ${JSON.stringify(settingsLabels)}`,
    );
    check(
      "removing is not offered when there is nothing to remove",
      (settings.settings?.buttons ?? []).some(
        (button) => button.label === "Remove GitHub token" && button.disabled,
      ),
      `buttons ${JSON.stringify(settings.settings?.buttons)}`,
    );

    // Type into the field the way a person does, then save.
    await run(`(() => {
      const input = document.querySelector(".settings-updates__token input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "ghp_harness_token");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await click('button[aria-label="Save GitHub token"]');
    const saved = await settle(320);
    check(
      "saving hands the token to main",
      saved.calls?.setToken?.length === 1 &&
        saved.calls.setToken[0] === "ghp_harness_token",
      `updateSetToken called with ${JSON.stringify(saved.calls?.setToken)}`,
    );
    check(
      "the view then reports the token as stored",
      saved.settings?.token === "set" && saved.settings?.tokenText === "Stored",
      `token ${saved.settings?.token} / ${JSON.stringify(saved.settings?.tokenText)}`,
    );
    check(
      "the field is cleared rather than holding the secret",
      saved.settings?.inputValue === "",
      `input value ${JSON.stringify(saved.settings?.inputValue)}`,
    );
    check(
      "saving confirms itself",
      (saved.settings?.message ?? "").includes("secure storage"),
      `message ${JSON.stringify(saved.settings?.message)}`,
    );
    check(
      "removing is offered once a token is stored",
      (saved.settings?.buttons ?? []).some(
        (button) => button.label === "Remove GitHub token" && !button.disabled,
      ),
      `buttons ${JSON.stringify(saved.settings?.buttons)}`,
    );

    // "Check now" is the operator asking by hand, so it must force the feed.
    await click('button[aria-label="Check for updates now"]');
    const checked = await settle(360);
    check(
      "checking by hand reaches the feed again",
      checked.calls?.check === 2,
      `update:check called ${checked.calls?.check} times`,
    );
    check(
      "the hand's check forces the feed rather than replaying the session",
      checked.calls?.checkOptions?.[1]?.force === true,
      `options ${JSON.stringify(checked.calls?.checkOptions)}`,
    );

    screenshots.push(await shoot("update-badge-settings.png"));

    await click('button[aria-label="Remove GitHub token"]');
    const removed = await settle(320);
    check(
      "removing calls the bridge once",
      removed.calls?.clearToken === 1,
      `updateClearToken called ${removed.calls?.clearToken} times`,
    );
    check(
      "the view returns to not-set",
      removed.settings?.token === "unset" && removed.settings?.tokenText === "Not set",
      `token ${removed.calls?.clearToken} / ${JSON.stringify(removed.settings?.tokenText)}`,
    );

    // Nothing anywhere in the run may have thrown: an uncaught render error
    // unmounts the tree to an empty `#root`, which every state above would then
    // report as "no chip" rather than as what it actually was.
    const thrown = Object.entries({
      available: resting,
      opened,
      notesOpen,
      installing,
      halfway,
      installFailed: failed,
      upToDate,
      junk,
      afterRemount,
      settings,
      saved,
      checked,
      removed,
    })
      .filter(([, state]) => (state.dom?.errors?.length ?? 0) > 0)
      .map(([name, state]) => `${name}: ${JSON.stringify(state.dom?.errors)}`);
    check("nothing threw during the run", thrown.length === 0, thrown.join(" | "));

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      states: {
        available: resting,
        opened,
        notesOpen,
        installing,
        halfway,
        installFailed: failed,
        upToDate,
        junk,
        afterRemount,
        settings,
        saved,
        checked,
        removed,
      },
      glow: {
        accent: resting.chip?.tokens?.accent ?? null,
        accentFill: resting.chip?.tokens?.accentFill ?? null,
        resolved: ink,
        chipInk: resting.chip?.color ?? null,
        chipFill: resting.chip?.background ?? null,
        halo: resting.chip?.halo?.boxShadow ?? null,
        layers,
        reach,
        room,
        animation: resting.chip?.halo?.animationName ?? null,
        reducedMotion: resting.reducedMotion,
      },
      screenshots,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "update-badge.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [
    ["state", "chip", "class", "halo", "dialog", "actions", "progress"],
    [
      "available",
      report.states?.available?.chip?.tag ?? "—",
      String(report.states?.available?.chip?.className ?? "—"),
      report.glow?.halo ? `${report.glow.reach.toFixed(1)}px <= ${report.glow.room}px` : "—",
      "closed",
      "—",
      "—",
    ],
    [
      "opened",
      report.states?.opened?.chip?.tag ?? "—",
      "—",
      "—",
      report.states?.opened?.dialog?.title ?? "—",
      String((report.states?.opened?.dialog?.buttons ?? []).length),
      "—",
    ],
    [
      "installing",
      "—",
      "—",
      "—",
      report.states?.installing?.dialog?.title ?? "—",
      String((report.states?.installing?.dialog?.buttons ?? []).length),
      report.states?.halfway?.dialog?.progressNow ?? "—",
    ],
    [
      "up to date",
      report.states?.upToDate?.chip?.tag ?? "—",
      String(report.states?.upToDate?.chip?.className ?? "—"),
      String(report.states?.upToDate?.chip?.boxShadow ?? "—"),
      "closed",
      "—",
      "—",
    ],
    [
      "junk bridge",
      report.states?.junk?.chip?.tag ?? "—",
      String(report.states?.junk?.chip?.className ?? "—"),
      String(report.states?.junk?.chip?.boxShadow ?? "—"),
      "closed",
      "—",
      "—",
    ],
  ];
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => String(row[i]).length)),
  );
  for (const row of rows) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
  }

  if (report.glow?.halo) {
    console.log("");
    console.log(`halo:  ${report.glow.halo}`);
    console.log(
      `inks:  hairline ${JSON.stringify(report.glow.layers?.[0]?.color)} vs --accent ${JSON.stringify(report.glow.resolved?.accent)}`,
    );
    console.log(
      `       bloom ${JSON.stringify(report.glow.layers?.[1]?.color)} vs --accent-fill ${JSON.stringify(report.glow.resolved?.accentFill)}`,
    );
    console.log(
      `room:  the halo reaches ${report.glow.reach.toFixed(1)}px into the ${report.glow.room}px the rail gives it`,
    );
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  // The page's own errors, when it had any: a rig that only prints "no chip" for
  // a tree that threw says nothing about why.
  for (const line of pageConsole.slice(-12)) console.log(`CONSOLE ${line.slice(0, 400)}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "update badge: PASS" : "update badge: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`update-badge: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
