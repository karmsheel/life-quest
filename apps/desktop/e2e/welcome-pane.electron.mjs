/**
 * Drives the welcome pane harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/welcome-pane.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/welcome-pane.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/welcome-pane.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

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
  const px = (value) => Math.round(parseFloat(value) || 0);
  const root = getComputedStyle(document.documentElement);
  const titlebar = document.querySelector(".window-titlebar");
  const body = document.querySelector(".app-root__body");
  const pane = document.querySelector(".welcome");

  // The token this pane is supposed to wear, read back as the browser computes
  // it so a hex token and an rgb() computed value can be compared directly.
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;background:var(--background);border:1px solid var(--border)";
  document.body.appendChild(probe);
  const tokenPage = getComputedStyle(probe).backgroundColor;
  const tokenBorder = getComputedStyle(probe).borderTopColor;
  probe.remove();

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    tokens: {
      frame: px(root.getPropertyValue("--shell-frame")),
      titlebarHeight: px(root.getPropertyValue("--window-titlebar-height")),
      pageCanvas: tokenPage,
      border: tokenBorder
    },
    titlebar: box(titlebar),
    titlebarBackground: titlebar ? getComputedStyle(titlebar).backgroundColor : null,
    body: body
      ? {
          box: box(body),
          paddingTop: getComputedStyle(body).paddingTop,
          paddingRight: getComputedStyle(body).paddingRight,
          paddingBottom: getComputedStyle(body).paddingBottom,
          paddingLeft: getComputedStyle(body).paddingLeft
        }
      : null,
    pane: pane
      ? {
          box: box(pane),
          borderRadius: getComputedStyle(pane).borderRadius,
          borderTopWidth: getComputedStyle(pane).borderTopWidth,
          borderRightWidth: getComputedStyle(pane).borderRightWidth,
          borderBottomWidth: getComputedStyle(pane).borderBottomWidth,
          borderLeftWidth: getComputedStyle(pane).borderLeftWidth,
          borderTopColor: getComputedStyle(pane).borderTopColor,
          background: getComputedStyle(pane).backgroundColor,
          boxShadow: getComputedStyle(pane).boxShadow,
          marginRight: getComputedStyle(pane).marginRight,
          marginBottom: getComputedStyle(pane).marginBottom,
          tag: pane.tagName.toLowerCase(),
          parentIsBody: pane.parentElement === body
        }
      : null,
    card: box(document.querySelector(".welcome-card")),
    heading: (document.querySelector(".welcome-card h1")?.textContent || "").trim(),
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to so a test run is not a white sheet
  // flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers. Painting is the switch
    // above.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.welcomeHarnessReady !== "object") return null;
          await window.welcomeHarnessReady;
          return document.querySelector(".welcome") ? true : null;
        })()`);
        if (ready === true) return;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  let report;
  const timeout = setTimeout(() => {
    console.error("welcome-pane: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 220));

    const state = await sample();
    const { frame, titlebarHeight, pageCanvas, border } = state.tokens;
    const { width: viewportWidth, height: viewportHeight } = state.viewport;
    const box = state.pane?.box;
    const pane = state.pane;

    // 1 — the harness rendered the real boot surface, not a stub.
    check("the welcome pane exists", Boolean(state.pane), "no .welcome in the window");
    check(
      "the pane holds the real welcome card",
      Boolean(state.card) && state.heading === "LifeQuest",
      `card ${JSON.stringify(state.card)}, heading "${state.heading}"`,
    );
    check(
      "the pane sits directly in the app body",
      state.pane?.parentIsBody === true,
      `pane parent is the app body: ${state.pane?.parentIsBody}`,
    );
    check(
      "the strip above it is the titlebar",
      state.titlebar?.top === 0 && state.titlebar?.height === titlebarHeight,
      `titlebar ${JSON.stringify(state.titlebar)} vs height ${titlebarHeight}px`,
    );

    // 2 — the frame: one pane gap under the strip, and no mat at all on the
    // other three sides, where the pane reaches the window's own edges.
    check(
      "the pane keeps one pane gap under the strip",
      box?.top === titlebarHeight + frame,
      `pane top ${box?.top}px vs strip ${titlebarHeight}px + gap ${frame}px`,
    );
    check(
      "the pane reaches the window's leading edge",
      box?.left === 0,
      `pane left ${box?.left}px — no rail exists on this surface to inset it`,
    );
    check(
      "the pane reaches the window's trailing edge",
      box?.right === viewportWidth,
      `pane right ${box?.right}px vs window ${viewportWidth}px`,
    );
    check(
      "the pane reaches the window's bottom edge",
      box?.bottom === viewportHeight,
      `pane bottom ${box?.bottom}px vs window ${viewportHeight}px`,
    );
    // The escape has to be exactly one pane gap, not zero and not an overshoot:
    // the tray keeps its padding, and the pane's negative margins carry the pane
    // past it to the window's edge.
    const paddedRight =
      (state.body?.box.right ?? 0) - parseFloat(state.body?.paddingRight ?? "0");
    const paddedBottom =
      (state.body?.box.bottom ?? 0) - parseFloat(state.body?.paddingBottom ?? "0");
    check(
      "the pane overhangs the tray's padded box by one pane gap on both edges",
      (box?.right ?? 0) - paddedRight === frame &&
        (box?.bottom ?? 0) - paddedBottom === frame,
      `trailing overhang ${(box?.right ?? 0) - paddedRight}px, bottom overhang ${(box?.bottom ?? 0) - paddedBottom}px vs pane gap ${frame}px`,
    );

    // 3 — the corner a flush pane would otherwise leave open: a radius shows the
    // canvas through the notch, which is the gap coming back at the two corners
    // that now sit on the window's own edges.
    check(
      "the pane stays square",
      pane?.borderRadius === "0px",
      `radius ${pane?.borderRadius}`,
    );

    // 4 — the pane is the only box here, so its hairline is the only line.
    check(
      "the pane wears a hairline on all four sides",
      [
        pane?.borderTopWidth,
        pane?.borderRightWidth,
        pane?.borderBottomWidth,
        pane?.borderLeftWidth,
      ].every((width) => parseFloat(width ?? "0") > 0 && parseFloat(width ?? "0") <= 1),
      `borders t/r/b/l ${pane?.borderTopWidth}/${pane?.borderRightWidth}/${pane?.borderBottomWidth}/${pane?.borderLeftWidth}`,
    );
    check(
      "that hairline is the token's own border",
      pane?.borderTopColor === border,
      `pane border ${pane?.borderTopColor} vs --border ${border}`,
    );
    // Flush with three window edges, a shadow here would be clipped on all three
    // and survive only as a halo above the top seam — a second line where the
    // hairline is meant to be the only one. The sheet is the pane that keeps one.
    check(
      "no shadow survives the flush pane",
      pane?.boxShadow === "none",
      `shadow ${pane?.boxShadow}`,
    );

    // 5 — the surface: the same page canvas the workspace sheet stands on. At
    // night that is the deepest ink in the window, and the mat, the cards and the
    // panels all step up off it.
    check(
      "the pane wears the page canvas the workspace sheet uses",
      pane?.background === pageCanvas,
      `pane ${pane?.background} vs --background ${pageCanvas}`,
    );

    // 6 — the escapes are negative margins on the two flush edges, so neither
    // may overshoot into a scrollbar.
    check(
      "nothing spills past the window",
      state.overflow.scrollWidth <= viewportWidth &&
        state.overflow.clientWidth <= viewportWidth,
      `scrollWidth ${state.overflow.scrollWidth}px, clientWidth ${state.overflow.clientWidth}px vs window ${viewportWidth}px`,
    );

    const fullShot = await win.webContents.capturePage();
    const fullFile = path.join(artifactsDir, "welcome-pane.png");
    fs.writeFileSync(fullFile, fullShot.toPNG());

    // The evidence for the flush corner: the window's own bottom-right, where a
    // surviving mat or a rounded corner would both show.
    const cornerShot = await win.webContents.capturePage({
      x: viewportWidth - 420,
      y: viewportHeight - 260,
      width: 420,
      height: 260,
    });
    const cornerFile = path.join(artifactsDir, "welcome-pane-corner.png");
    fs.writeFileSync(cornerFile, cornerShot.toPNG());

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      tokens: state.tokens,
      state,
      screenshots: [fullFile, cornerFile],
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

  const reportFile = path.join(artifactsDir, "welcome-pane.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const pane = report.state?.pane;
  if (pane) {
    console.log(
      `pane L/T/R/B ${pane.box.left}/${pane.box.top}/${pane.box.right}/${pane.box.bottom}` +
        ` of ${report.state.viewport.width}x${report.state.viewport.height}` +
        `  radius ${pane.borderRadius}  margins ${pane.marginRight}/${pane.marginBottom}`,
    );
  }
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "welcome pane: PASS" : "welcome pane: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`welcome-pane: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
