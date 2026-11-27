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
 * with, and the distance the halo reaches against the room the rail's header
 * gives the version line — so "the build number glows when a newer release
 * exists" is a set of numbers in a file rather than a screenshot to squint at.
 *
 * It also drives the click that makes the glow unnecessary to wait for: the build
 * number is a control at launch, so the operator can force the feed themselves.
 * The `slow` scenario holds that forced check open so the popup's checking state
 * is measured too, and then answers it with the release the operator can install
 * the usual way.
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
  const chip = document.querySelector(".update-badge");
  const label = document.querySelector(".update-badge__label");
  // The chip's home: the rail's version slot at the TOP of the column — the div
  // inside the header, directly under the centred lockup. The slot holds the
  // build number with the optional words centred under it; the header's box is
  // the band that stack lives in, and the header's own slack is the room the halo
  // has to fit. The old caption row (.nav-rail__meta) is retired, so the foot
  // below is measured as one row: the Log, the vault chip and the collapse
  // toggle.
  const versionSlot = document.querySelector(".nav-rail__version");
  const versionStyle = versionSlot ? getComputedStyle(versionSlot) : null;
  const versionControls = versionSlot
    ? Array.from(versionSlot.querySelectorAll("button"))
    : [];
  const lastVersionControl = versionControls.length
    ? versionControls[versionControls.length - 1]
    : null;
  const versionPadding = versionStyle
    ? {
        top: parseFloat(versionStyle.paddingTop) || 0,
        right: parseFloat(versionStyle.paddingRight) || 0,
        bottom: parseFloat(versionStyle.paddingBottom) || 0,
        left: parseFloat(versionStyle.paddingLeft) || 0
      }
    : null;
  const rail = document.querySelector(".nav-rail");
  const railHeader = document.querySelector(".nav-rail__header");
  const railHeaderStyle = railHeader ? getComputedStyle(railHeader) : null;
  const brand = document.querySelector(".nav-rail__brand-button");
  const foot = document.querySelector(".nav-rail__foot");
  const footRow = document.querySelector(".nav-rail__foot-row");
  const logRow = footRow ? footRow.querySelector(".nav-rail__link") : null;
  const vault = document.querySelector(".nav-rail__vault");
  const toggle = document.querySelector(".nav-rail__collapse");
  const metaRowRetired = document.querySelector(".nav-rail__meta") === null;
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
    captionCount: document.querySelectorAll(".update-badge__label").length,
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
          dataPreview: chip.getAttribute("data-update-preview"),
          ariaLabel: chip.getAttribute("aria-label"),
          ariaHaspopup: chip.getAttribute("aria-haspopup"),
          ariaExpanded: chip.getAttribute("aria-expanded"),
          title: chip.getAttribute("title"),
          type: chip.getAttribute("type"),
          inVersion: Boolean(versionSlot && versionSlot.contains(chip)),
          inRail: Boolean(rail && rail.contains(chip)),
          inHeader: Boolean(railHeader && railHeader.contains(chip)),
          inFoot: Boolean(foot && foot.contains(chip)),
          inDockBar: Boolean(
            document.querySelector(".chat-panel__actions")?.contains(chip)
          ),
          underLockup: Boolean(
            brand && chip && box(chip).top >= box(brand).bottom - 1
          ),
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
    // The rail's version line, read as a line: its box and padding say where the
    // chip sits in it, and its child/control list says the chip is the slot's
    // only control (the words beside it are a paragraph, not a second one). The
    // words' retreat is a container query on the HEADER, so the header's
    // container identity is measured here too — and its box is the band the halo
    // has to fit. The foot's own row says where the retirement sent the toggle.
    version: versionSlot
      ? {
          box: box(versionSlot),
          padding: versionPadding,
          display: versionStyle.display,
          flexDirection: versionStyle.flexDirection,
          alignItems: versionStyle.alignItems,
          justifyContent: versionStyle.justifyContent,
          gap: versionStyle.gap,
          containerType: versionStyle.containerType,
          containerName: versionStyle.containerName,
          inHeader: Boolean(railHeader && railHeader.contains(versionSlot)),
          containsChip: Boolean(chip && versionSlot.contains(chip)),
          containsLabel: Boolean(label && versionSlot.contains(label)),
          childCount: versionSlot.children.length,
          firstChildIsChip: versionSlot.firstElementChild === chip,
          lastChildIsLabel: Boolean(label) && versionSlot.lastElementChild === label,
          lastControlIsChip: lastVersionControl === chip,
          lastControlAriaLabel: lastVersionControl
            ? lastVersionControl.getAttribute("aria-label")
            : null,
          controls: versionControls.map((el) => ({
            tag: el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute("aria-label"),
            testId: el.getAttribute("data-testid"),
            className: el.className,
            box: box(el)
          })),
          headerBox: railHeader ? box(railHeader) : null,
          headerContainerType: railHeaderStyle
            ? railHeaderStyle.containerType
            : null,
          headerContainerName: railHeaderStyle
            ? railHeaderStyle.containerName
            : null,
          brandBox: brand ? box(brand) : null,
          footBox: foot ? box(foot) : null,
          footRowBox: footRow ? box(footRow) : null,
          footChildCount: foot ? foot.children.length : null,
          logRowBox: logRow ? box(logRow) : null,
          vaultBox: vault ? box(vault) : null,
          toggleInFootRow: Boolean(footRow && toggle && footRow.contains(toggle)),
          metaRowRetired
        }
      : null,
    toggle: toggle
      ? {
          ariaLabel: toggle.getAttribute("aria-label"),
          box: box(toggle),
          display: getComputedStyle(toggle).display
        }
      : null,
    rail: rail
      ? {
          box: box(rail),
          scrollTop: rail.scrollTop,
          scrollHeight: rail.scrollHeight,
          clientHeight: rail.clientHeight,
          display: getComputedStyle(rail).display,
          direction: getComputedStyle(rail).flexDirection,
          background: getComputedStyle(rail).backgroundColor
        }
      : null,
    railHeader: railHeader
      ? {
          box: box(railHeader),
          display: railHeaderStyle.display,
          containerType: railHeaderStyle.containerType,
          containerName: railHeaderStyle.containerName
        }
      : null,
    // The words that come with the glow. Read as a paragraph, not as a control:
    // what makes this line safe in a bar of action buttons is that it is not one.
    label: label
      ? {
          tag: label.tagName.toLowerCase(),
          text: (label.textContent || "").trim(),
          dataLabel: label.getAttribute("data-update-label"),
          inVersion: Boolean(versionSlot && versionSlot.contains(label)),
          underChip: label.previousElementSibling === chip,
          display: getComputedStyle(label).display,
          visibility: getComputedStyle(label).visibility,
          focusables: label.querySelectorAll(
            "button, a[href], input, select, textarea, [tabindex], [role=button], [role=link]"
          ).length,
          box: box(label),
          color: getComputedStyle(label).color,
          fontSize: getComputedStyle(label).fontSize,
          lineHeight: getComputedStyle(label).lineHeight,
          textTransform: getComputedStyle(label).textTransform,
          letterSpacing: getComputedStyle(label).letterSpacing,
          tabIndex: label.getAttribute("tabindex"),
          role: label.getAttribute("role"),
          cursor: getComputedStyle(label).cursor,
          html: label.outerHTML.slice(0, 200),
          overflow: {
            scrollWidth: label.scrollWidth,
            clientWidth: label.clientWidth
          }
        }
      : null,
    dialog: dialog
      ? {
          box: box(dialog),
          role: dialog.getAttribute("role"),
          ariaModal: dialog.getAttribute("aria-modal"),
          ariaLabelledby: dialog.getAttribute("aria-labelledby"),
          view: dialog.getAttribute("data-update-view"),
          dataVersion: dialog.getAttribute("data-update-dialog"),
          kicker: (dialog.querySelector(".update-dialog__kicker")?.textContent || "").trim(),
          kickerKind: (() => {
            const el = dialog.querySelector(".update-dialog__kicker");
            return el ? el.getAttribute("data-update-kicker") : null;
          })(),
          title: (dialog.querySelector(".update-dialog__title")?.textContent || "").trim(),
          versionsText: (
            dialog.querySelector('[data-update-body]')?.textContent || ""
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
    chipFocused: chip ? document.activeElement === chip : null,
    settings: (() => {
      const summary = document.querySelector("[data-update-summary]");
      const token = document.querySelector("[data-update-token]");
      const input = document.querySelector(".settings-updates__token input");
      // The Developer page's control is a switch, not a checkbox: its state is
      // aria-checked, and its box is what proves it sits beside the copy.
      const previewToggle = document.querySelector(
        '[role="switch"][aria-label="Preview the update badge"]'
      );
      const previewState = document.querySelector("[data-developer-state]");
      const previewRow = previewToggle
        ? previewToggle.closest(".settings-card__row")
        : null;
      const previewCopy = previewRow
        ? previewRow.querySelector(".settings-card__copy")
        : null;
      const previewDesc = previewRow
        ? previewRow.querySelector(".settings-card__desc")
        : null;
      const previewTrack = previewToggle
        ? previewToggle.querySelector(".ui-toggle__track")
        : null;
      const previewThumb = previewToggle
        ? previewToggle.querySelector(".ui-toggle__thumb")
        : null;
      const previewList = document.querySelector("[data-developer-settings]");
      if (!summary && !token && !previewToggle) return null;
      const text = (sel) => {
        const el = document.querySelector(sel);
        return el ? (el.textContent || "").trim() : null;
      };
      const stored = (() => {
        try {
          return window.localStorage.getItem("lifequest-update-preview");
        } catch {
          return "unavailable";
        }
      })();
      return {
        summaryState: summary ? summary.getAttribute("data-update-summary") : null,
        summaryText: summary ? (summary.textContent || "").trim() : null,
        /** True when the page still asks the operator for a token. */
        hasTokenField: Boolean(token || input),
        note: text(".settings-card__desc"),
        previewTag: previewToggle ? previewToggle.tagName.toLowerCase() : null,
        previewRole: previewToggle ? previewToggle.getAttribute("role") : null,
        previewChecked: previewToggle
          ? previewToggle.getAttribute("aria-checked") === "true"
          : null,
        previewState: previewState ? previewState.getAttribute("data-developer-state") : null,
        previewNote: previewState ? (previewState.textContent || "").trim() : null,
        storedPreview: stored,
        // Geometry: the switch's own box, the row it belongs to, and the copy it
        // sits beside. A toggle on the right is a set of coordinates, not a class.
        previewBox: box(previewToggle),
        previewRowBox: box(previewRow),
        previewCopyBox: box(previewCopy),
        previewDescBox: box(previewDesc),
        previewTrackBox: box(previewTrack),
        previewThumbBox: box(previewThumb),
        previewTrackBackground: previewTrack
          ? getComputedStyle(previewTrack).backgroundColor
          : null,
        previewThumbTransform: previewThumb
          ? getComputedStyle(previewThumb).transform
          : null,
        previewRowDisplay: previewRow ? getComputedStyle(previewRow).display : null,
        previewRowJustify: previewRow
          ? getComputedStyle(previewRow).justifyContent
          : null,
        previewList: previewList
          ? {
              display: getComputedStyle(previewList).display,
              direction: getComputedStyle(previewList).flexDirection,
              rows: previewList.querySelectorAll(":scope > .settings-card__row").length
            }
          : null,
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
      hasVersionSlot: Boolean(versionSlot),
      hasChip: Boolean(chip),
      hasShell: Boolean(document.querySelector(".shell")),
      metaRowRetired,
      errors: Array.isArray(window.__harnessErrors) ? window.__harnessErrors : null,
      railHtml: rail ? rail.innerHTML.slice(0, 600) : null,
      versionHtml: versionSlot ? versionSlot.innerHTML.slice(0, 600) : null,
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

/** Two measured boxes as the same box, to within a rounding pixel. */
const sameBox = (a, b) =>
  Boolean(a && b) &&
  ["left", "top", "right", "bottom", "width", "height"].every(
    (key) => Math.abs(a[key] - b[key]) <= 1,
  );

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

  /**
   * Wait for the page's harness to say it has mounted something.
   *
   * Each poll is raced against a page-side timeout on purpose: `executeJavaScript`
   * resolves when the expression's promise does, so a harness whose ready promise
   * never settles would hang this rig until its watchdog instead of failing with a
   * reason. This way the loop keeps making progress and the report can name what
   * the page actually threw.
   */
  const waitForHarness = async () => {
    const deadline = Date.now() + 30_000;
    let lastError = "harness globals never appeared";
    for (;;) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.updateHarnessReady !== "object") return "no-globals";
          return Promise.race([
            window.updateHarnessReady.then(() => "ready"),
            new Promise((r) => setTimeout(() => r("pending"), 1500)),
          ]);
        })()`);
        if (ready === "ready") return;
        lastError =
          ready === "pending"
            ? `the harness's ready signal never fired; the page threw ${JSON.stringify(
                await run("window.__harnessErrors ?? null"),
              )}`
            : "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      if (Date.now() > deadline) throw new Error(lastError);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };

  const loadScenario = async (scenario, view = "badge", preview = null) => {
    // The scenario rides the page's own query string rather than localStorage:
    // the driver has to choose one before this page has ever been loaded, and
    // there is no origin to write to until then. `view` picks which harness page
    // mounts — the dock's badge, or a Settings panel. Pages rather than one
    // branch, because a page's module graph is evaluated once per load and a flag
    // read off its query string decides what that one page mounts.
    //
    // `preview` seeds the Developer switch, through the same storage key the switch
    // itself writes. It is written on *every* load — `null` means off — so one pass
    // cannot inherit the last one's state and turn a later assertion green for the
    // wrong reason.
    const page = view === "badge" ? "update-badge.html" : "update-settings.html";
    const params = new URLSearchParams({ scenario, preview: preview ? "1" : "0" });
    if (view !== "badge") {
      params.set("view", view === "developer" ? "developer" : "updates");
    }
    const target = `${url.replace(/[^/]*$/, page)}?${params.toString()}`;
    console.log(`[update-badge] loading ${view}/${scenario} preview=${Boolean(preview)}`);

    // Vite re-optimises its dependencies the first time a new import appears, and
    // answers the in-flight module request with a 504 while it reloads: that load
    // never registers the harness globals, so waiting on it can only time out. A
    // second load is the cure, and cheaper than asking the operator to warm the
    // dev server before every run.
    for (let attempt = 1; ; attempt += 1) {
      await win.loadURL(target);
      try {
        await waitForHarness();
        break;
      } catch (error) {
        if (attempt >= 3) {
          throw new Error(`harness never became ready for ${scenario}: ${error.message}`);
        }
        console.log(
          `[update-badge] reloading ${view}/${scenario} (attempt ${attempt + 1}): ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 300));
    win.showInactive();
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return run(SAMPLE);
  };

  /** Wait for a page-side expression the rail's own transition decides. */
  const waitFor = async (expression, description, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await run(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error(`timed out waiting for ${description}`);
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

  const shootRailTop = async (name) => {
    const state = await run(SAMPLE);
    // The crop the operator would call "the top of the sidebar": the lockup and
    // the version line under it with the glowing number, plus the wing band's
    // first row for context. The header's box starts above the window's top
    // edge because the rail escapes the titlebar, so the crop is clamped.
    const versionBox = state.version?.box;
    const headerBox = state.version?.headerBox;
    const railBox = state.rail?.box;
    const x = Math.max(0, Math.round((railBox?.left ?? 0) - 8));
    const y = Math.max(0, Math.round(headerBox?.top ?? 0));
    const width = Math.min(
      DEFAULT_SIZE.width - x,
      Math.max(240, Math.round((railBox?.width ?? 256) + 16)),
    );
    const height = Math.min(
      DEFAULT_SIZE.height - y,
      Math.round((headerBox?.height ?? 96) + 16),
    );
    const image = await win.webContents.capturePage({ x, y, width, height });
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

    if (
      !check(
        "chip exists",
        Boolean(resting.chip),
        "no .update-badge in the rail's version slot",
      )
    ) {
      console.error(`[update-badge] dom: ${JSON.stringify(resting.dom, null, 2)}`);
      throw new Error("no version chip rendered");
    }

    // The badge is at the top of the rail now: the version slot inside the
    // header, directly under the centred lockup. The rail is still the column it
    // was — one flex column whose topband carries the window's top strip in this
    // track, and it still does not scroll.
    check(
      "the rail is still one column with its topband and does not scroll",
      resting.rail?.scrollTop === 0 &&
        (resting.rail?.scrollHeight ?? 0) <= (resting.rail?.clientHeight ?? 0) &&
        resting.rail?.display === "flex" &&
        resting.rail?.direction === "column" &&
        Boolean(resting.railHeader?.box) &&
        Math.abs(
          (resting.railHeader?.box.width ?? -1) - (resting.rail?.box.width ?? 0),
        ) <= 2,
      `scrollTop ${resting.rail?.scrollTop}, content ${resting.rail?.scrollHeight}px in ${resting.rail?.clientHeight}px, display ${resting.rail?.display}/${resting.rail?.direction}, topband ${JSON.stringify(resting.railHeader?.box)} vs rail ${JSON.stringify(resting.rail?.box)}`,
    );
    const versionBox = resting.version?.box;
    const versionPadding = resting.version?.padding;
    const headerBox = resting.version?.headerBox;
    const footRowBox = resting.version?.footRowBox;
    const railBox = resting.rail?.box;
    check(
      "the badge has left the dock's action bar for the rail's version slot",
      resting.chip.inRail === true &&
        resting.chip.inVersion === true &&
        resting.chip.inHeader === true &&
        resting.chip.inFoot === false &&
        resting.chip.inDockBar === false &&
        resting.version?.containsChip === true &&
        resting.version?.inHeader === true,
      `in rail ${resting.chip.inRail}, in version slot ${resting.chip.inVersion}, in header ${resting.chip.inHeader}, in foot ${resting.chip.inFoot}, in dock bar ${resting.chip.inDockBar}`,
    );

    // The badge sits under the lockup, not on the column's floor: the header's
    // band holds the mark and the version it belongs to, and the version line is
    // centred on the rail's own column.
    check(
      "the badge sits under the lockup in the header",
      Boolean(versionBox && headerBox && resting.version?.brandBox) &&
        resting.version.brandBox.bottom <= versionBox.top + 1 &&
        versionBox.top >= headerBox.top &&
        versionBox.bottom <= headerBox.bottom &&
        resting.chip.underLockup === true,
      `version line ${JSON.stringify(versionBox)}, lockup ${JSON.stringify(resting.version?.brandBox)}, header ${JSON.stringify(headerBox)}`,
    );
    check(
      "the version line is centred on the rail's column",
      Boolean(versionBox && railBox) &&
        Math.abs(
          (versionBox.left + versionBox.right) / 2 -
            (railBox.left + railBox.right) / 2,
        ) <= 2,
      `version line ${JSON.stringify(versionBox)}, rail ${JSON.stringify(railBox)}`,
    );

    // The foot is one row now: the Log, the vault chip and the collapse toggle.
    // The version line is not in it — the retired caption row (`.nav-rail__meta`)
    // is gone from the DOM — and the slot clears the foot entirely.
    check(
      "the rail's foot is one row, with no version line in it",
      Boolean(footRowBox && resting.version?.vaultBox && resting.toggle?.box) &&
        resting.version?.metaRowRetired === true &&
        resting.version?.footChildCount === 1 &&
        resting.version?.toggleInFootRow === true &&
        resting.chip.inFoot === false &&
        Boolean(resting.version?.logRowBox) &&
        resting.version.logRowBox.left >= footRowBox.left - 1 &&
        resting.version.vaultBox.left >= resting.version.logRowBox.right - 1 &&
        resting.toggle.box.left >= resting.version.vaultBox.right - 1 &&
        versionBox.bottom < footRowBox.top,
      `version line ${JSON.stringify(versionBox)}, foot row ${JSON.stringify(footRowBox)}, foot children ${resting.version?.footChildCount}, Log ${JSON.stringify(resting.version?.logRowBox)}, vault ${JSON.stringify(resting.version?.vaultBox)}, version in foot ${resting.chip.inFoot}`,
    );

    // The slot holds the words and the number, and nothing else: the chip is the
    // slot's only control (the words are a paragraph), so the collapse toggle is
    // not beside the badge any more — it lives in the foot row.
    check(
      "the version slot holds the words and the number, and nothing else",
      resting.version?.childCount === 2 &&
        resting.version?.containsLabel === true &&
        resting.version?.controls.length === 1 &&
        resting.version?.lastControlIsChip === true &&
        resting.version?.firstChildIsChip === true &&
        resting.version?.lastChildIsLabel === true &&
        resting.version?.lastControlAriaLabel !== "Collapse sidebar" &&
        resting.version?.toggleInFootRow === true &&
        resting.toggle?.ariaLabel === "Collapse sidebar" &&
        resting.toggle?.display !== "none",
      `children ${resting.version?.childCount}, controls ${JSON.stringify(resting.version?.controls.map((control) => control.ariaLabel))}, last control ${JSON.stringify(resting.version?.lastControlAriaLabel)}, toggle ${JSON.stringify(resting.toggle)}`,
    );
    check(
      "the sidebar toggle trails the vault chip at the rail's corner",
      Boolean(
        resting.toggle?.box && resting.version?.vaultBox && footRowBox,
      ) &&
        resting.version.vaultBox.left < resting.toggle.box.left &&
        resting.toggle.box.right <= footRowBox.right + 1 &&
        footRowBox.right >= (railBox?.right ?? 0) - 8,
      `vault ${JSON.stringify(resting.version?.vaultBox)}, toggle ${JSON.stringify(resting.toggle?.box)}, foot row ${JSON.stringify(footRowBox)}, rail ${JSON.stringify(railBox)}`,
    );
    check(
      "the chip sits inside the version line's own box",
      Boolean(versionBox && versionPadding && resting.chip.box) &&
        resting.chip.box.left >= versionBox.left + versionPadding.left - 0.5 &&
        resting.chip.box.right <= versionBox.right - versionPadding.right + 0.5 &&
        resting.chip.box.top >= versionBox.top &&
        resting.chip.box.bottom <= versionBox.bottom,
      `chip ${JSON.stringify(resting.chip.box)} vs version line ${JSON.stringify(versionBox)} padding ${JSON.stringify(versionPadding)}`,
    );
    check(
      "the chip is no taller than the version line",
      Boolean(versionBox && versionPadding && resting.chip.box) &&
        resting.chip.box.height <=
          versionBox.height - versionPadding.top - versionPadding.bottom + 1,
      `chip ${resting.chip.box?.height}px, line ${((versionBox?.height ?? 0) - (versionPadding?.top ?? 0) - (versionPadding?.bottom ?? 0)).toFixed(1)}px`,
    );
    check(
      "the version line stays inside the header and clears the foot",
      Boolean(versionBox && headerBox && footRowBox && railBox) &&
        versionBox.bottom <= headerBox.bottom &&
        versionBox.left >= railBox.left &&
        versionBox.right <= railBox.right &&
        versionBox.bottom < footRowBox.top,
      `version line ${JSON.stringify(versionBox)} in header ${JSON.stringify(headerBox)} / rail ${JSON.stringify(railBox)}, foot row ${JSON.stringify(footRowBox)}`,
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
        resting.chip.className.includes("update-badge--available"),
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

    // ── the words under the pill ────────────────────────────────────────────
    // A glowing `v0.1.4` is a state without a sentence. The words have to say
    // what it means, and stay a paragraph — a second focus stop in a bar of
    // action controls with nothing to do would be worse than the glow alone.
    //
    // The words are the version slot's second line, centred on the number. The
    // container query that retires them under a narrow header is measured below.
    const labelInk = resting.chip.tokens.resolved.accent;
    check(
      "the glow is explained in words",
      resting.label?.tag === "p" && resting.label?.text === "Update available",
      `caption ${JSON.stringify(resting.label?.text)} as <${resting.label?.tag}>`,
    );
    check(
      "the caption sits centred under the build number in the version slot",
      resting.label?.inVersion === true &&
        resting.label?.underChip === true &&
        resting.label?.display !== "none" &&
        resting.version?.display === "flex" &&
        resting.version?.flexDirection === "column" &&
        resting.version?.alignItems === "center",
      `caption display ${JSON.stringify(resting.label?.display)}, in version slot ${resting.label?.inVersion}, under chip ${resting.label?.underChip}, slot ${JSON.stringify(resting.version?.display)}/${JSON.stringify(resting.version?.flexDirection)}/${JSON.stringify(resting.version?.alignItems)}`,
    );
    // The words are the number's own second line: directly under it, sharing its
    // centre, and still inside the version slot.
    check(
      "the caption is centred under the number",
      Boolean(resting.label?.box && resting.chip.box && versionBox) &&
        resting.label.box.top >= resting.chip.box.bottom - 1 &&
        resting.label.box.top - resting.chip.box.bottom <= 12 &&
        Math.abs(
          (resting.label.box.left + resting.label.box.right) / 2 -
            (resting.chip.box.left + resting.chip.box.right) / 2,
        ) <= 2 &&
        resting.label.box.left >= versionBox.left - 1 &&
        resting.label.box.right <= versionBox.right + 1 &&
        (resting.label.overflow.scrollWidth ?? Infinity) <=
          (resting.label.overflow.clientWidth ?? 0),
      `caption ${JSON.stringify(resting.label?.box)} vs chip ${JSON.stringify(resting.chip?.box)} in version line ${JSON.stringify(versionBox)}, overflow ${JSON.stringify(resting.label?.overflow)}`,
    );
    check(
      "the caption is text, not a second control",
      resting.label?.tag === "p" &&
        resting.label?.tabIndex === null &&
        resting.label?.role === null &&
        resting.label?.focusables === 0,
      `tag ${resting.label?.tag}, tabindex ${JSON.stringify(resting.label?.tabIndex)}, role ${JSON.stringify(resting.label?.role)}, focusables ${resting.label?.focusables}`,
    );
    check(
      "the caption wears the state ink",
      resting.label?.color === parseColor(labelInk)?.rgb,
      `color ${resting.label?.color} vs --accent ${labelInk}`,
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
    // The halo has to fit the version line's own band: the rail clips at its own
    // edge, and the header holds the lockup and the version line. Measured from
    // the header's box — the gap under the lockup and the header's bottom inset
    // are the room the bloom has to bloom into, the way the retired caption row's
    // padding used to be.
    const reach = Math.max(...layers.map((layer) => layer.blur + layer.spread));
    const room =
      headerBox && resting.chip.box
        ? Math.min(
            resting.chip.box.left - headerBox.left,
            headerBox.right - resting.chip.box.right,
            resting.chip.box.top - headerBox.top,
            headerBox.bottom - resting.chip.box.bottom,
          )
        : 0;
    check(
      "the halo fits the version line's own band in the header",
      layers.length > 0 && reach <= room,
      `the halo reaches ${reach.toFixed(1)}px into the ${room}px the header gives the version line — the rail would slice it flat`,
    );
    check(
      "the halo breathes, unless the operator asked for stillness",
      resting.reducedMotion
        ? halo?.animationName === "none"
        : halo?.animationName === "update-badge-breathe",
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

    screenshots.push(await shootRailTop("update-badge-rail-glow.png"));
    screenshots.push(await shoot("update-badge-resting.png"));

    // ── 1b — the thin rail: the version line retires with the words ──────────
    // The header is the words' query container, and 56px cannot hold the build
    // number as a target worth aiming at: the version slot leaves the layout
    // entirely in the icon column instead of squeezing the number into the rail's
    // edge where the halo would be sliced off. The rail's own collapse control
    // drives the probe, and reopening leaves every later state on the shipped
    // wide rail.
    await run(`(() => {
      document.querySelector(".nav-rail__collapse")?.click();
      return true;
    })()`);
    await waitFor(
      '(() => Boolean(document.querySelector(".shell")?.className.includes("shell--nav-collapsed")))()',
      "the collapsed rail",
    );
    const narrow = await settle(360);
    const narrowVersion = narrow.version;
    const narrowRailBox = narrow.rail?.box ?? null;
    check(
      "the rail really collapsed to its icon column",
      Boolean(narrowRailBox) && narrowRailBox.width <= 58,
      `rail ${JSON.stringify(narrowRailBox)}`,
    );
    check(
      "the header is still the container the words retreat from",
      typeof narrowVersion?.headerContainerType === "string" &&
        narrowVersion.headerContainerType.includes("inline-size") &&
        String(narrowVersion.headerContainerName ?? "").includes("rail-header"),
      `container-type ${JSON.stringify(narrowVersion?.headerContainerType)}, name ${JSON.stringify(narrowVersion?.headerContainerName)}`,
    );
    check(
      "a thin rail retires the version line with the words",
      narrowVersion?.display === "none" &&
        narrow.captionCount === 1 &&
        Boolean(narrow.chip?.box) &&
        narrow.chip.box.width === 0 &&
        narrow.chip.box.height === 0,
      `version line display ${JSON.stringify(narrowVersion?.display)}, chip ${JSON.stringify(narrow.chip?.box)}, count ${narrow.captionCount}`,
    );
    check(
      "the thin rail paints no build-number control",
      narrow.chip?.inRail === true &&
        narrowVersion?.containsChip === true &&
        narrowVersion?.box?.width === 0 &&
        narrowVersion?.box?.height === 0 &&
        narrow.toggle === null,
      `chip ${JSON.stringify(narrow.chip?.box)}, version line ${JSON.stringify(narrowVersion?.box)}, toggle ${JSON.stringify(narrow.toggle)}`,
    );
    // The header's emblem is the way back; reopening restores the shipped rail.
    await run(`(() => {
      document.querySelector(".nav-rail__header .nav-toggle")?.click();
      return true;
    })()`);
    await waitFor(
      '(() => !document.querySelector(".shell")?.className.includes("shell--nav-collapsed"))()',
      "the expanded rail",
    );
    const narrowRestored = await settle(360);
    check(
      "the rail comes back with its version line and chip unchanged",
      sameBox(narrowRestored.version?.box, resting.version?.box) &&
        sameBox(narrowRestored.chip?.box, resting.chip?.box),
      `version line ${JSON.stringify(narrowRestored.version?.box)} vs ${JSON.stringify(resting.version?.box)}, chip ${JSON.stringify(narrowRestored.chip?.box)} vs ${JSON.stringify(resting.chip?.box)}`,
    );
    check(
      "the caption comes back with the wide rail",
      narrowRestored.captionCount === 1 &&
        narrowRestored.label?.display !== "none" &&
        narrowRestored.label?.text === "Update available" &&
        narrowRestored.label?.inVersion === true,
      `caption ${JSON.stringify(narrowRestored.label)}`,
    );

    // ── 2 — the popup ───────────────────────────────────────────────────────
    const clicked = await click(".update-badge");
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
    check(
      "showing a release already in hand costs no second check",
      opened.calls?.check === 1 && opened.dialog?.view === "offer",
      `update:check called ${opened.calls?.check} times, view ${opened.dialog?.view}`,
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
    await click(".update-badge");
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

    // ── 5 — the operator's manual check: quiet at launch, offered after a click
    // The flow the version number exists for. The launch's check finds nothing,
    // so the bar is quiet — and still a control. The click forces the feed, the
    // popup says it is asking, and the answer that comes back is the usual offer.
    await loadScenario("slow");
    const manualRest = await settle();
    if (
      !check(
        "a build with nothing to install still has a control",
        manualRest.chip?.tag === "button" && manualRest.chip?.type === "button",
        `no clickable build number: tag ${manualRest.chip?.tag} type ${manualRest.chip?.type}`,
      )
    ) {
      console.error(`[update-badge] dom: ${JSON.stringify(manualRest.dom, null, 2)}`);
      throw new Error("the quiet build number is not a control");
    }
    check(
      "the quiet control looks quiet and says what it does",
      manualRest.chip?.dataVersion === null &&
        manualRest.chip?.ariaHaspopup === "dialog" &&
        manualRest.chip?.ariaExpanded === "false" &&
        (manualRest.chip?.ariaLabel ?? "").includes("Check for updates") &&
        manualRest.chip?.title === "Check for updates" &&
        manualRest.chip?.boxShadow === "none" &&
        !(manualRest.chip?.className ?? "").includes("--available") &&
        manualRest.label === null,
      `data ${JSON.stringify(manualRest.chip?.dataVersion)}, haspopup ${manualRest.chip?.ariaHaspopup}, ` +
        `expanded ${manualRest.chip?.ariaExpanded}, label ${JSON.stringify(manualRest.chip?.ariaLabel)}, ` +
        `title ${JSON.stringify(manualRest.chip?.title)}, halo ${JSON.stringify(manualRest.chip?.halo?.boxShadow)}, ` +
        `class ${manualRest.chip?.className}, caption ${JSON.stringify(manualRest.label)}`,
    );
    check(
      "the launch still asks the feed exactly once",
      manualRest.calls?.check === 1,
      `update:check called ${manualRest.calls?.check} times`,
    );

    await click(".update-badge");
    const asking = await settle(320);
    check(
      "clicking the build number checks the feed by hand",
      asking.calls?.check === 2 && asking.calls?.checkOptions?.[1]?.force === true,
      `checks ${JSON.stringify(asking.calls?.checkOptions)}`,
    );
    check(
      "the popup says the check is still running",
      asking.dialog?.view === "checking" &&
        (asking.dialog?.versionsText ?? "").includes("Asking GitHub"),
      `view ${asking.dialog?.view}, body ${JSON.stringify(asking.dialog?.versionsText)}`,
    );
    check(
      "a running check offers no install and a way out",
      !(asking.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install",
      ) &&
        (asking.dialog?.buttons ?? []).some((button) => button.label === "Close"),
      `buttons ${JSON.stringify(asking.dialog?.buttons)}`,
    );
    screenshots.push(await shoot("update-badge-checking.png"));

    // The answer arrives while the popup is open: the same panel becomes the
    // offer, with the usual install action — the operator asked, and got a release.
    const answered = await run(`window.updateHarness.answer("available")`);
    check("the held check can be answered", answered === true, "no pending check to answer");
    const manual = await settle(360);
    check(
      "the manual check's answer becomes the offer in place",
      manual.dialog?.view === "offer" &&
        manual.dialog?.dataVersion === OFFERED &&
        manual.chip?.dataVersion === OFFERED,
      `view ${manual.dialog?.view}, release ${JSON.stringify(manual.dialog?.dataVersion)}, chip ${JSON.stringify(manual.chip?.dataVersion)}`,
    );
    check(
      "the offer carries the usual install",
      (manual.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install" && !button.disabled,
      ),
      `buttons ${JSON.stringify(manual.dialog?.buttons)}`,
    );
    screenshots.push(await shoot("update-badge-manual.png"));
    await pressEscape();
    const manualClosed = await settle();
    check(
      "the manual check's popup can be dismissed",
      manualClosed.dialog === null,
      "Escape left the popup open after a manual check",
    );

    // ── 6 — up to date: no glow, but the operator still gets a clean answer ─
    await loadScenario("current");
    const upToDate = await settle();
    check(
      "an up-to-date build keeps its quiet control",
      upToDate.chip?.tag === "button" &&
        upToDate.chip?.ariaHaspopup === "dialog" &&
        Boolean(upToDate.chip?.ariaLabel?.includes("Check for updates")),
      `tag ${upToDate.chip?.tag}, haspopup ${upToDate.chip?.ariaHaspopup}, label ${JSON.stringify(upToDate.chip?.ariaLabel)}`,
    );
    check(
      "an up-to-date build has no glow",
      upToDate.chip?.boxShadow === "none" &&
        !(upToDate.chip?.className ?? "").includes("--available"),
      `box-shadow ${JSON.stringify(upToDate.chip?.boxShadow)}, class ${upToDate.chip?.className}`,
    );
    check(
      "an up-to-date build names no release it is not offering",
      upToDate.chip?.dataVersion === null,
      `data ${JSON.stringify(upToDate.chip?.dataVersion)}`,
    );
    // The words are a claim about this launch, so a bar with nothing to install
    // must not carry them: they would be chrome that is always there, saying
    // something that is never true.
    check(
      "an up-to-date build says nothing about an update",
      upToDate.label === null,
      `caption ${JSON.stringify(upToDate.label)}, chip ${JSON.stringify(upToDate.chip?.text)}`,
    );
    // The chip is a quiet line in the header's band, not something that changes
    // the rail's size: the available state adds ink and the words, never a taller
    // line or a taller header. The slot's own width follows its content — the
    // words make it wider — so the claim is the header's box and the line's
    // height, which is what the retired caption row's fixed box used to carry.
    check(
      "the available state did not change the header's band or the line's height",
      sameBox(resting.railHeader?.box, upToDate.railHeader?.box) &&
        Boolean(resting.version?.box && upToDate.version?.box) &&
        resting.version.box.height === upToDate.version.box.height &&
        sameBox(resting.rail?.box, upToDate.rail?.box),
      `header available ${JSON.stringify(resting.railHeader?.box)} vs up-to-date ${JSON.stringify(upToDate.railHeader?.box)}, line height ${resting.version?.box?.height} vs ${upToDate.version?.box?.height}`,
    );
    check(
      "an up-to-date build still asks the feed once",
      upToDate.calls?.check === 1,
      `update:check called ${upToDate.calls?.check} times`,
    );

    await click(".update-badge");
    const afterClick = await settle(360);
    check(
      "clicking a quiet build number checks the feed again",
      afterClick.calls?.check === 2 && afterClick.calls?.checkOptions?.[1]?.force === true,
      `checks ${JSON.stringify(afterClick.calls?.checkOptions)}`,
    );
    check(
      "and answers that the build is up to date",
      afterClick.dialog?.view === "up-to-date" &&
        (afterClick.dialog?.versionsText ?? "").includes(`v${APP_VERSION}`) &&
        (afterClick.dialog?.versionsText ?? "").includes("newest release"),
      `view ${afterClick.dialog?.view}, body ${JSON.stringify(afterClick.dialog?.versionsText)}`,
    );
    check(
      "an up-to-date answer offers no install, but a way to ask again",
      !(afterClick.dialog?.buttons ?? []).some(
        (button) => button.label === "Download and install",
      ) &&
        (afterClick.dialog?.buttons ?? []).some(
          (button) => button.label === "Check for updates again",
        ) &&
        (afterClick.dialog?.buttons ?? []).some((button) => button.label === "Close"),
      `buttons ${JSON.stringify(afterClick.dialog?.buttons)}`,
    );
    screenshots.push(await shoot("update-badge-current.png"));

    await click('.update-dialog button[aria-label="Check for updates again"]');
    const checkedAgain = await settle(360);
    check(
      "the up-to-date popup can ask again",
      checkedAgain.calls?.check === 3 &&
        checkedAgain.calls?.checkOptions?.[2]?.force === true,
      `checks ${JSON.stringify(checkedAgain.calls?.checkOptions)}`,
    );
    await pressEscape();
    const currentClosed = await settle();
    check(
      "the up-to-date popup can be dismissed",
      currentClosed.dialog === null,
      "Escape left the up-to-date popup on screen",
    );
    check(
      "dismissing the popup returns the keyboard to the build number",
      currentClosed.chipFocused === true,
      `focus landed on ${JSON.stringify(currentClosed.chipFocused)}`,
    );

    // ── 7 — a bridge that does not know this channel ────────────────────────
    await loadScenario("junk");
    const junk = await settle();
    check(
      "an unreadable answer leaves the rail's version slot standing",
      Boolean(junk.version) &&
        junk.version?.containsChip === true &&
        junk.chip?.tag === "button",
      `version line ${JSON.stringify(junk.version?.box)}, chip ${junk.chip?.tag}`,
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
    check(
      "an unreadable answer never says an update is available",
      junk.label === null,
      `caption ${JSON.stringify(junk.label)}`,
    );

    // The operator can still ask, and still gets an answer: a failed check is
    // reported in the same panel, with a way to try again and a way out.
    await click(".update-badge");
    const junkClicked = await settle(360);
    check(
      "a failed launch check can be asked again by hand",
      junkClicked.calls?.check === 2 &&
        junkClicked.calls?.checkOptions?.[1]?.force === true,
      `checks ${JSON.stringify(junkClicked.calls?.checkOptions)}`,
    );
    check(
      "a check that cannot answer says so",
      junkClicked.dialog?.view === "error" &&
        (junkClicked.dialog?.versionsText ?? "").includes("could not reach"),
      `view ${junkClicked.dialog?.view}, body ${JSON.stringify(junkClicked.dialog?.versionsText)}`,
    );
    check(
      "a failed check offers a retry and a way out",
      (junkClicked.dialog?.buttons ?? []).some(
        (button) => button.label === "Try the update check again",
      ) &&
        (junkClicked.dialog?.buttons ?? []).some((button) => button.label === "Close"),
      `buttons ${JSON.stringify(junkClicked.dialog?.buttons)}`,
    );
    await pressEscape();
    const junkClosed = await settle();
    check(
      "the failed check popup can be dismissed",
      junkClosed.dialog === null,
      "Escape left the failed check popup on screen",
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
      "the rail's version slot survives the remount",
      Boolean(afterRemount.version) &&
        afterRemount.version?.containsChip === true &&
        afterRemount.chip?.tag === "button",
      `version line ${Boolean(afterRemount.version)}, chip ${afterRemount.chip?.tag}`,
    );
    screenshots.push(await shoot("update-badge-junk.png"));

    // ── 8 — Settings → Updates: what the feed said, and asking by hand ──────
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
    const settingsLabels = (settings.settings?.buttons ?? []).map((button) => button.label);
    check(
      "the view offers a check by hand and the release page",
      settingsLabels.includes("Check for updates now") &&
        settingsLabels.includes("Open the release page"),
      `buttons ${JSON.stringify(settingsLabels)}`,
    );
    // The feed is public: nothing on this page asks the operator for a secret.
    check(
      "the view holds no token field",
      settings.settings?.hasTokenField === false,
      `a token field is still on the page: ${settings.settings?.hasTokenField}`,
    );
    check(
      "the view says the feed is public",
      (settings.settings?.note ?? "").includes("public"),
      `note ${JSON.stringify(settings.settings?.note)}`,
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

    // ── 9 — Settings → Developer: the preview switch ────────────────────────
    await loadScenario("current", "developer", false);
    const developer = await settle();
    check(
      "the Developer page renders a switch, not a checkbox",
      developer.settings?.previewTag === "button" &&
        developer.settings?.previewRole === "switch" &&
        developer.settings?.previewChecked === false,
      `tag ${developer.settings?.previewTag}, role ${developer.settings?.previewRole}, checked ${developer.settings?.previewChecked}`,
    );
    check(
      "the switch starts off, with nothing glowing",
      developer.settings?.previewState === "off" &&
        !(developer.settings?.previewNote ?? "").includes("9.9.9"),
      `state ${developer.settings?.previewState}, note ${JSON.stringify(developer.settings?.previewNote)}`,
    );
    check(
      "the switch sits at the row's trailing edge",
      developer.settings?.previewBox != null &&
        developer.settings?.previewRowBox != null &&
        Math.abs(
          developer.settings.previewRowBox.right - developer.settings.previewBox.right,
        ) <= 2 &&
        developer.settings.previewBox.top <= developer.settings.previewRowBox.top + 8,
      `switch ${JSON.stringify(developer.settings?.previewBox)}, row ${JSON.stringify(developer.settings?.previewRowBox)}`,
    );
    check(
      "the toggle has its own column, right of the description",
      (developer.settings?.previewCopyBox?.right ?? Infinity) <=
        (developer.settings?.previewBox?.left ?? 0) - 12 &&
        (developer.settings?.previewDescBox?.right ?? Infinity) <=
          (developer.settings?.previewBox?.left ?? 0) - 12,
      `copy ${JSON.stringify(developer.settings?.previewCopyBox)}, desc ${JSON.stringify(developer.settings?.previewDescBox)}, switch ${JSON.stringify(developer.settings?.previewBox)}`,
    );
    check(
      "the Developer page is a list a second switch can join",
      developer.settings?.previewList?.display === "flex" &&
        developer.settings?.previewList?.direction === "column" &&
        developer.settings?.previewList?.rows === 1 &&
        developer.settings?.previewRowDisplay === "flex" &&
        developer.settings?.previewRowJustify === "space-between",
      `list ${JSON.stringify(developer.settings?.previewList)}, row display ${developer.settings?.previewRowDisplay}, justify ${developer.settings?.previewRowJustify}`,
    );

    screenshots.push(await shoot("update-badge-developer-off.png"));

    await click('[role="switch"][aria-label="Preview the update badge"]');
    const previewOn = await settle(320);
    check(
      "turning the switch on writes the preference",
      previewOn.settings?.storedPreview === "1",
      `stored ${JSON.stringify(previewOn.settings?.storedPreview)}`,
    );
    check(
      "the switch reports itself on",
      previewOn.settings?.previewChecked === true &&
        previewOn.settings?.previewState === "previewing",
      `checked ${previewOn.settings?.previewChecked}, state ${previewOn.settings?.previewState}`,
    );
    check(
      "the on state is drawn without moving the row",
      previewOn.settings?.previewThumbTransform !==
        developer.settings?.previewThumbTransform &&
        previewOn.settings?.previewTrackBackground !==
          developer.settings?.previewTrackBackground &&
        previewOn.settings?.previewBox?.width ===
          developer.settings?.previewBox?.width &&
        previewOn.settings?.previewBox?.height ===
          developer.settings?.previewBox?.height,
      `thumb ${JSON.stringify(previewOn.settings?.previewThumbTransform)} vs ${JSON.stringify(developer.settings?.previewThumbTransform)}, track ${JSON.stringify(previewOn.settings?.previewTrackBackground)} vs ${JSON.stringify(developer.settings?.previewTrackBackground)}, box ${JSON.stringify(previewOn.settings?.previewBox)} vs ${JSON.stringify(developer.settings?.previewBox)}`,
    );
    check(
      "the page says what the preview is showing",
      (previewOn.settings?.previewNote ?? "").includes("9.9.9"),
      `note ${JSON.stringify(previewOn.settings?.previewNote)}`,
    );

    screenshots.push(await shoot("update-badge-developer.png"));

    // ── 10 — and the dock's bar really glows from it ────────────────────────
    // The feed says "up to date"; the only reason for a glow is the switch.
    await loadScenario("current", "badge", true);
    const previewBar = await settle();
    check(
      "the preview makes the build number glow",
      previewBar.chip?.tag === "button" &&
        previewBar.chip?.dataPreview === "true" &&
        previewBar.chip?.boxShadow === "none",
      `tag ${previewBar.chip?.tag}, preview ${previewBar.chip?.dataPreview}, halo ${JSON.stringify(previewBar.chip?.halo?.boxShadow)}`,
    );
    check(
      "the preview's halo rests on its own layer, like a real one",
      parseShadowLayers(previewBar.chip?.halo?.boxShadow ?? "").length === 2,
      `halo ${JSON.stringify(previewBar.chip?.halo?.boxShadow)}`,
    );
    // The preview exists to show the whole affordance, words included: a preview
    // missing the caption would let a layout bug through the very surface built
    // to catch it.
    check(
      "the preview shows the caption too, and marks it as a preview",
      previewBar.label?.text === "Update available" &&
        previewBar.label?.dataLabel === "preview" &&
        previewBar.label?.inVersion === true &&
        previewBar.label?.underChip === true,
      `caption ${JSON.stringify(previewBar.label?.text)} (${previewBar.label?.dataLabel}), in version slot ${previewBar.label?.inVersion}, under chip ${previewBar.label?.underChip}`,
    );
    check(
      "the preview glow keeps the feed's answer quiet",
      previewBar.calls?.check === 1,
      `update:check called ${previewBar.calls?.check} times`,
    );

    await click(".update-badge");
    const previewDialog = await settle();
    check(
      "the preview opens the popup",
      Boolean(previewDialog.dialog),
      `dialog ${JSON.stringify(previewDialog.dialog)}`,
    );
    check(
      "the preview answers the click from its own stand-in",
      previewDialog.calls?.check === 1,
      `update:check called ${previewDialog.calls?.check} times`,
    );
    check(
      "the popup says it is a preview",
      previewDialog.dialog?.kickerKind === "preview" &&
        (previewDialog.dialog?.kicker ?? "").includes("Preview"),
      `kicker ${JSON.stringify(previewDialog.dialog?.kicker)} (${previewDialog.dialog?.kickerKind})`,
    );
    check(
      "the preview names a version that cannot be installed",
      previewDialog.dialog?.dataVersion === "9.9.9" &&
        !(previewDialog.dialog?.buttons ?? []).some(
          (button) => button.label === "Download and install",
        ),
      `version ${previewDialog.dialog?.dataVersion}, buttons ${JSON.stringify(
        (previewDialog.dialog?.buttons ?? []).map((button) => button.label),
      )}`,
    );
    check(
      "the preview's install path is unreachable",
      previewDialog.calls?.install === 0,
      `updateInstall called ${previewDialog.calls?.install} times`,
    );
    screenshots.push(await shoot("update-badge-preview.png"));

    // ── 11 — a real release outranks the preview ───────────────────────────
    // The switch on, and the feed offering something: the popup must be the
    // release, not the preview. A switch that could hide an upgrade would be
    // worse than no switch.
    await loadScenario("available", "badge", true);
    const shadowed = await settle();
    check(
      "a real release wins over the preview",
      shadowed.chip?.dataVersion === OFFERED &&
        shadowed.chip?.dataPreview === "false",
      `offering ${shadowed.chip?.dataVersion}, preview ${shadowed.chip?.dataPreview}`,
    );
    check(
      "and its caption is the release's, not the preview's",
      shadowed.label?.text === "Update available" &&
        shadowed.label?.dataLabel === "available",
      `caption ${JSON.stringify(shadowed.label?.text)} (${shadowed.label?.dataLabel})`,
    );
    await click(".update-badge");
    const shadowedDialog = await settle();
    check(
      "and its popup is the real one",
      shadowedDialog.dialog?.dataVersion === OFFERED &&
        shadowedDialog.dialog?.kickerKind === "release" &&
        (shadowedDialog.dialog?.buttons ?? []).some(
          (button) => button.label === "Download and install",
        ),
      `version ${shadowedDialog.dialog?.dataVersion}, kicker ${shadowedDialog.dialog?.kickerKind}, buttons ${JSON.stringify(
        (shadowedDialog.dialog?.buttons ?? []).map((button) => button.label),
      )}`,
    );

    // Leave the machine as it was found — and prove the switch clears the
    // preference rather than merely drawing itself unchecked. Seeded on, turned
    // off here, so the round trip is the assertion.
    await loadScenario("current", "developer", true);
    const developerOn = await settle();
    check(
      "a stored preference brings the switch up already on",
      developerOn.settings?.previewChecked === true &&
        developerOn.settings?.previewState === "previewing",
      `checked ${developerOn.settings?.previewChecked}, state ${developerOn.settings?.previewState}`,
    );
    await click('[role="switch"][aria-label="Preview the update badge"]');
    const developerOff = await settle(320);
    check(
      "turning the switch off clears the preference",
      developerOff.settings?.previewChecked === false &&
        developerOff.settings?.storedPreview === null &&
        developerOff.settings?.previewState === "off",
      `checked ${developerOff.settings?.previewChecked}, stored ${JSON.stringify(developerOff.settings?.storedPreview)}, state ${developerOff.settings?.previewState}`,
    );

    // Nothing anywhere in the run may have thrown: an uncaught render error
    // unmounts the tree to an empty `#root`, which every state above would then
    // report as "no chip" rather than as what it actually was.
    const thrown = Object.entries({
      available: resting,
      opened,
      notesOpen,
      installing,
      installFailed: failed,
      manualRest,
      asking,
      manual,
      manualClosed,
      upToDate,
      afterClick,
      checkedAgain,
      currentClosed,
      junk,
      junkClicked,
      junkClosed,
      afterRemount,
      settings,
      checked,
      developer,
      previewOn,
      previewBar,
      previewDialog,
      shadowed,
      shadowedDialog,
      developerOn,
      developerOff,
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
        narrow,
        narrowRestored,
        opened,
        notesOpen,
        installing,
        halfway,
        installFailed: failed,
        manualRest,
        asking,
        manual,
        manualClosed,
        upToDate,
        afterClick,
        checkedAgain,
        currentClosed,
        junk,
        junkClicked,
        junkClosed,
        afterRemount,
        settings,
        checked,
        developer,
        previewOn,
        previewBar,
        previewDialog,
        shadowed,
        shadowedDialog,
        developerOn,
        developerOff,
      },
      narrowGlow: {
        // The thin rail retires the version line with the words, so there is no
        // painted halo to measure there; the wide-rail glow is the one tested.
        reach: 0,
        room: 0,
        captionDisplay: narrow.label?.display ?? null,
        version: narrow.version?.box ?? null,
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
    ["state", "chip", "class", "caption", "halo", "dialog", "actions", "progress"],
    [
      "available",
      report.states?.available?.chip?.tag ?? "—",
      String(report.states?.available?.chip?.className ?? "—"),
      report.states?.available?.label?.text ?? "none",
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
      "—",
      report.states?.installing?.dialog?.title ?? "—",
      String((report.states?.installing?.dialog?.buttons ?? []).length),
      report.states?.halfway?.dialog?.progressNow ?? "—",
    ],
    [
      "checking",
      report.states?.asking?.chip?.tag ?? "—",
      "—",
      "—",
      "—",
      report.states?.asking?.dialog?.view ?? "—",
      String((report.states?.asking?.dialog?.buttons ?? []).length),
      "—",
    ],
    [
      "manual offer",
      report.states?.manual?.chip?.tag ?? "—",
      "—",
      "—",
      "—",
      report.states?.manual?.dialog?.view ?? "—",
      String((report.states?.manual?.dialog?.buttons ?? []).length),
      "—",
    ],
    [
      "up to date",
      report.states?.upToDate?.chip?.tag ?? "—",
      String(report.states?.upToDate?.chip?.className ?? "—"),
      report.states?.upToDate?.label?.text ?? "none",
      String(report.states?.upToDate?.chip?.boxShadow ?? "—"),
      report.states?.afterClick?.dialog?.view ?? "—",
      String((report.states?.afterClick?.dialog?.buttons ?? []).length),
      "—",
    ],
    [
      "junk bridge",
      report.states?.junk?.chip?.tag ?? "—",
      String(report.states?.junk?.chip?.className ?? "—"),
      report.states?.junk?.label?.text ?? "none",
      String(report.states?.junk?.chip?.boxShadow ?? "—"),
      report.states?.junkClicked?.dialog?.view ?? "—",
      String((report.states?.junkClicked?.dialog?.buttons ?? []).length),
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
