/**
 * Drives the shell sidebar harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/shell-sidebar.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/shell-sidebar.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * NOT covered here: whether Windows lets the click through the titlebar's drag
 * band. Synthetic DOM clicks bypass the OS hit test, so the `-webkit-app-region:
 * no-drag` carve-out on the toggle can only be confirmed by clicking it in the
 * real window. Nothing asserts that carve-out any more — the source-text
 * contract that read it out of the CSS went with the unit tests.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/shell-sidebar.html";
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
  const rail = document.querySelector(".nav-rail");
  const header = document.querySelector(".nav-rail__header");
  const controls = header
    ? Array.from(header.querySelectorAll("button, a, input, select, [role=button]"))
    : [];
  const titlebar = document.querySelector(".window-titlebar");
  const leading = document.querySelector(".window-titlebar__leading");
  const vault = document.querySelector(".window-titlebar__vault");
  const railToggle = document.querySelector(".nav-rail .nav-toggle");
  const titlebarToggle = document.querySelector(".window-titlebar__nav-toggle");
  const main = document.querySelector(".shell__main");
  const chat = document.querySelector(".chat-panel");
  const shell = document.querySelector(".shell");
  const titlebarHeight = px(root.getPropertyValue("--window-titlebar-height"));

  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;height:0;width:var(--shell-nav-width)";
  document.body.appendChild(probe);
  const track = probe.offsetWidth;
  probe.remove();

  // Who owns the window's top-left corner right now: the point titlebar text
  // would collide with if nothing had stepped aside.
  const cornerEl = document.elementFromPoint(
    Math.round(track / 2),
    Math.round(titlebarHeight / 2)
  );

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    tokens: {
      track,
      frame: px(root.getPropertyValue("--shell-frame")),
      titlebarHeight
    },
    rail: rail
      ? {
          box: box(rail),
          marginTop: getComputedStyle(rail).marginTop,
          marginLeft: getComputedStyle(rail).marginLeft,
          marginBottom: getComputedStyle(rail).marginBottom,
          borderRightWidth: getComputedStyle(rail).borderRightWidth,
          borderTopWidth: getComputedStyle(rail).borderTopWidth,
          borderBottomWidth: getComputedStyle(rail).borderBottomWidth,
          borderLeftWidth: getComputedStyle(rail).borderLeftWidth,
          borderRadius: getComputedStyle(rail).borderRadius,
          background: getComputedStyle(rail).backgroundColor,
          scrollTop: rail.scrollTop,
          scrollHeight: rail.scrollHeight,
          clientHeight: rail.clientHeight
        }
      : null,
    railDisplay: rail ? getComputedStyle(rail).display : null,
    header: header
      ? {
          box: box(header),
          appRegion: getComputedStyle(header).getPropertyValue("-webkit-app-region"),
          controls: controls.map((el) => ({
            tag: el.tagName.toLowerCase(),
            label: el.getAttribute("aria-label"),
            title: el.getAttribute("title")
          }))
        }
      : null,
    railToggle: railToggle
      ? {
          label: railToggle.getAttribute("aria-label"),
          box: box(railToggle),
          appRegion: getComputedStyle(railToggle).getPropertyValue("-webkit-app-region")
        }
      : null,
    titlebarToggle: titlebarToggle
      ? {
          label: titlebarToggle.getAttribute("aria-label"),
          box: box(titlebarToggle)
        }
      : null,
    firstLink: box(document.querySelector(".nav-rail__link")),
    titlebar: box(titlebar),
    leading: box(leading),
    vault: vault
      ? {
          box: box(vault),
          text: (vault.textContent || "").trim(),
          background: getComputedStyle(vault).backgroundColor,
          color: getComputedStyle(vault).color,
          radius: getComputedStyle(vault).borderRadius,
          href: vault.getAttribute("href"),
          appRegion: getComputedStyle(vault).getPropertyValue("-webkit-app-region")
        }
      : null,
    legacyBrand: Boolean(
      document.querySelector(".window-titlebar__brand") ||
        document.querySelector(".window-titlebar__logo") ||
        document.querySelector(".window-titlebar__label")
    ),
    leadingText: (leading?.textContent || "").trim(),
    titlebarBackground: titlebar
      ? getComputedStyle(titlebar).backgroundColor
      : null,
    main: box(main),
    mainBackground: main ? getComputedStyle(main).backgroundColor : null,
    sheet: main
      ? {
          box: box(main),
          borderRadius: getComputedStyle(main).borderRadius,
          borderTopWidth: getComputedStyle(main).borderTopWidth,
          borderRightWidth: getComputedStyle(main).borderRightWidth,
          borderBottomWidth: getComputedStyle(main).borderBottomWidth,
          borderLeftWidth: getComputedStyle(main).borderLeftWidth,
          background: getComputedStyle(main).backgroundColor,
          boxShadow: getComputedStyle(main).boxShadow
        }
      : null,
    chat: chat
      ? {
          box: box(chat),
          borderRadius: getComputedStyle(chat).borderRadius,
          borderTopWidth: getComputedStyle(chat).borderTopWidth,
          borderRightWidth: getComputedStyle(chat).borderRightWidth,
          borderBottomWidth: getComputedStyle(chat).borderBottomWidth,
          borderLeftWidth: getComputedStyle(chat).borderLeftWidth,
          background: getComputedStyle(chat).backgroundColor,
          backdropFilter: getComputedStyle(chat).backdropFilter,
          boxShadow: getComputedStyle(chat).boxShadow,
          marginRight: getComputedStyle(chat).marginRight,
          marginBottom: getComputedStyle(chat).marginBottom
        }
      : null,
    shell: shell
      ? {
          className: shell.className,
          gridTemplateColumns: getComputedStyle(shell).gridTemplateColumns,
          gap: getComputedStyle(shell).gap,
          box: box(shell)
        }
      : null,
    corner: cornerEl
      ? {
          tag: cornerEl.tagName.toLowerCase(),
          className: typeof cornerEl.className === "string" ? cornerEl.className : "",
          insideRail: Boolean(rail && rail.contains(cornerEl)),
          insideTitlebar: Boolean(titlebar && titlebar.contains(cornerEl))
        }
      : null,
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

/** A "highlighted" chip paints a real fill — any alpha above a rounding crumb,
 *  and not the surface behind it. */
const isHighlighted = (color) => {
  const match = /^rgba?\(([^)]+)\)$/.exec(color ?? "");
  if (!match) return false;
  const parts = match[1].split(",").map((part) => parseFloat(part));
  const alpha = parts.length > 3 ? parts[3] : 1;
  return alpha > 0.05;
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  // Returns the vault name the harness handed the shell.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.shellHarnessReady !== "object") return null;
          await window.shellHarnessReady;
          return typeof window.shellHarnessVaultName === "string"
            ? window.shellHarnessVaultName
            : null;
        })()`);
        if (typeof ready === "string") return ready;
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

  const settled = async (ms = 220) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const clickToggle = async (selector) =>
    run(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  let report;
  const timeout = setTimeout(() => {
    console.error("shell-sidebar: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    const expanded = await settled();
    const { track, frame, titlebarHeight } = expanded.tokens;
    const { height: viewportHeight, width: viewportWidth } = expanded.viewport;

    // 1 — flush: the rail owns the window's top, left and bottom edges.
    check("rail exists", Boolean(expanded.rail), "no .nav-rail in the shell");
    check(
      "rail flush left",
      expanded.rail?.box.left === 0,
      `left inset ${expanded.rail?.box.left}px`,
    );
    check(
      "rail flush top",
      expanded.rail?.box.top === 0,
      `top inset ${expanded.rail?.box.top}px`,
    );
    check(
      "rail flush bottom",
      expanded.rail?.box.bottom === viewportHeight,
      `bottom ${expanded.rail?.box.bottom}px vs window ${viewportHeight}px`,
    );
    check(
      "rail spans the window height",
      expanded.rail?.box.height === viewportHeight,
      `height ${expanded.rail?.box.height}px vs window ${viewportHeight}px`,
    );
    check(
      "rail keeps the track width",
      expanded.rail?.box.width === track,
      `rail ${expanded.rail?.box.width}px vs --shell-nav-width ${track}px`,
    );
    check(
      "rail stays square and paints no line of its own",
      expanded.rail?.borderRadius === "0px" &&
        expanded.rail?.borderLeftWidth === "0px" &&
        expanded.rail?.borderTopWidth === "0px" &&
        expanded.rail?.borderBottomWidth === "0px" &&
        expanded.rail?.borderRightWidth === "0px",
      `radius ${expanded.rail?.borderRadius}, borders ${expanded.rail?.borderTopWidth}/${expanded.rail?.borderRightWidth}/${expanded.rail?.borderBottomWidth}/${expanded.rail?.borderLeftWidth}`,
    );

    // 2 — the topband: the titlebar row, carrying exactly one control.
    check(
      "topband sits on the window edge",
      expanded.header?.box.top === 0 && expanded.header?.box.bottom === titlebarHeight,
      `band ${expanded.header?.box.top}–${expanded.header?.box.bottom}px vs titlebar height ${titlebarHeight}px`,
    );
    check(
      "topband holds one control",
      expanded.header?.controls.length === 1,
      `controls ${JSON.stringify(expanded.header?.controls)}`,
    );
    check(
      "that control is the collapse toggle",
      expanded.railToggle?.label === "Collapse sidebar",
      `label ${JSON.stringify(expanded.railToggle?.label)}`,
    );
    check(
      "nav rows start under the topband",
      (expanded.firstLink?.top ?? 0) >= (expanded.header?.box.bottom ?? 0),
      `first row top ${expanded.firstLink?.top}px vs band bottom ${expanded.header?.box.bottom}px`,
    );

    // 3 — paint order: the rail's topband, not the titlebar, owns the corner.
    check(
      "rail paints over the titlebar",
      expanded.corner?.insideRail === true,
      `corner element ${JSON.stringify(expanded.corner)}`,
    );

    // 4 — the strip wears the vault's own name on a highlighted chip, stepped
    // aside by the track width; the app mark and wordmark are gone.
    check(
      "titlebar text clears the rail",
      (expanded.vault?.box.left ?? 0) >= (expanded.rail?.box.right ?? track),
      `vault chip starts at ${expanded.vault?.box.left}px, rail ends at ${expanded.rail?.box.right}px`,
    );
    check(
      "strip shows the vault name and nothing else",
      expanded.vault?.text === vaultName && expanded.leadingText === vaultName,
      `chip "${expanded.vault?.text}" / leading "${expanded.leadingText}" vs vault "${vaultName}"`,
    );
    check(
      "the app mark and wordmark are gone",
      expanded.legacyBrand === false,
      "a brand/logo/label element is still in the titlebar",
    );
    check(
      "the vault chip is highlighted",
      isHighlighted(expanded.vault?.background) &&
        expanded.vault?.background !== expanded.titlebarBackground,
      `chip background ${expanded.vault?.background} on ${expanded.titlebarBackground}`,
    );
    check(
      "the chip has square corners",
      expanded.vault?.radius === "0px",
      `radius ${expanded.vault?.radius}`,
    );
    check(
      "the chip fills the strip with no margin at the top",
      expanded.vault?.box.top === 0 &&
        expanded.vault?.box.height === titlebarHeight,
      `chip top ${expanded.vault?.box.top}px, height ${expanded.vault?.box.height}px vs strip ${titlebarHeight}px`,
    );
    check(
      "the chip still goes home and stays clickable",
      (expanded.vault?.href ?? "").endsWith("/home") &&
        expanded.vault?.appRegion === "no-drag",
      `href ${expanded.vault?.href}, app-region ${expanded.vault?.appRegion}`,
    );
    check(
      "no toggle doubles up while the rail is open",
      expanded.titlebarToggle === null,
      `titlebar toggle present: ${JSON.stringify(expanded.titlebarToggle)}`,
    );
    check(
      "the toggle sits centred in the rail column",
      expanded.railToggle?.box.left ===
        Math.round((track - (expanded.railToggle?.box.width ?? 0)) / 2),
      `rail toggle starts at ${expanded.railToggle?.box.left}px, column centre would be ${Math.round((track - (expanded.railToggle?.box.width ?? 0)) / 2)}px`,
    );

    // 5 — the workspace sheet's three insets are one pane gap each, on every
    // side it does not share with the rail, and its leading gap is the same
    // pane gap rather than a frame stacked on a gap.
    check(
      "the sheet's gaps match on both sides",
      expanded.main &&
        expanded.rail &&
        expanded.chat &&
        expanded.main.left - expanded.rail.box.right ===
          expanded.chat.box.left - expanded.main.right,
      `rail→sheet ${(expanded.main?.left ?? 0) - (expanded.rail?.box.right ?? 0)}px vs sheet→chat ${(expanded.chat?.box.left ?? 0) - (expanded.main?.right ?? 0)}px`,
    );
    check(
      "the leading gap is one pane gap",
      expanded.main?.left === track + frame,
      `sheet left ${expanded.main?.left}px vs rail ${track}px + gap ${frame}px`,
    );
    // The panel is the rightmost pane now, and it is flush rather than inset.
    check(
      "the chat panel is flush to the window's right and bottom",
      viewportWidth - (expanded.chat?.box.right ?? 0) === 0 &&
        (expanded.chat?.box.bottom ?? 0) === viewportHeight,
      `right inset ${viewportWidth - (expanded.chat?.box.right ?? 0)}px, panel bottom ${expanded.chat?.box.bottom}px of ${viewportHeight}px`,
    );
    check(
      "the chat panel has square corners",
      expanded.chat?.borderRadius === "0px",
      `radius ${expanded.chat?.borderRadius}`,
    );
    check(
      "the chat panel wears only its top hairline",
      expanded.chat?.borderRightWidth === "0px" &&
        expanded.chat?.borderBottomWidth === "0px" &&
        expanded.chat?.borderLeftWidth === "0px" &&
        parseFloat(expanded.chat?.borderTopWidth ?? "0") > 0 &&
        parseFloat(expanded.chat?.borderTopWidth ?? "0") <= 1,
      `borders t/r/b/l ${expanded.chat?.borderTopWidth}/${expanded.chat?.borderRightWidth}/${expanded.chat?.borderBottomWidth}/${expanded.chat?.borderLeftWidth}`,
    );
    // The top hairline has to be the same line the sheet's top edge carries:
    // one level, under the strip, spanning the dock as well as the sheet.
    check(
      "the panel's top edge is level with the sheet's",
      expanded.chat?.box.top === titlebarHeight + frame,
      `panel top ${expanded.chat?.box.top}px vs sheet top ${titlebarHeight + frame}px`,
    );
    check(
      "the chat panel wears the sheet's own surface, unfrosted",
      expanded.chat?.backdropFilter === "none" &&
        expanded.chat?.background === expanded.mainBackground,
      `panel ${expanded.chat?.background} backdrop ${expanded.chat?.backdropFilter} vs sheet ${expanded.mainBackground}`,
    );
    check(
      "no shadow survives the flush panel",
      expanded.chat?.boxShadow === "none",
      `shadow ${expanded.chat?.boxShadow}`,
    );
    check(
      "the sheet keeps its frame on the top and bottom",
      expanded.main?.top === titlebarHeight + frame &&
        viewportHeight - (expanded.main?.bottom ?? 0) === frame,
      `sheet top ${expanded.main?.top}px (want ${titlebarHeight + frame}px), bottom inset ${viewportHeight - (expanded.main?.bottom ?? 0)}px`,
    );
    // The sheet's own chrome: square, wearing a hairline on all four sides —
    // the page's box, drawn one pane gap in from the rail and the dock.
    check(
      "the sheet has square corners",
      expanded.sheet?.borderRadius === "0px",
      `radius ${expanded.sheet?.borderRadius}`,
    );
    check(
      "the sheet wears a hairline on all four sides",
      [
        expanded.sheet?.borderTopWidth,
        expanded.sheet?.borderRightWidth,
        expanded.sheet?.borderBottomWidth,
        expanded.sheet?.borderLeftWidth,
      ].every(
        (width) => parseFloat(width ?? "0") > 0 && parseFloat(width ?? "0") <= 1,
      ),
      `borders t/r/b/l ${expanded.sheet?.borderTopWidth}/${expanded.sheet?.borderRightWidth}/${expanded.sheet?.borderBottomWidth}/${expanded.sheet?.borderLeftWidth}`,
    );
    // One line per seam: the sheet's frame, with neither neighbour painting an
    // edge of its own into the same pane gap.
    check(
      "each seam carries the sheet's frame alone",
      expanded.sheet?.borderLeftWidth !== "0px" &&
        expanded.sheet?.borderRightWidth !== "0px" &&
        expanded.rail?.borderRightWidth === "0px" &&
        expanded.chat?.borderLeftWidth === "0px",
      `rail right ${expanded.rail?.borderRightWidth}, sheet left ${expanded.sheet?.borderLeftWidth}, sheet right ${expanded.sheet?.borderRightWidth}, dock left ${expanded.chat?.borderLeftWidth}`,
    );
    check(
      "that hairline sits on the sheet's top edge, one pane gap under the strip",
      expanded.sheet?.box.top === titlebarHeight + frame,
      `hairline at y=${expanded.sheet?.box.top}px, strip ends at ${titlebarHeight}px, pane gap ${frame}px`,
    );
    check(
      "the chip lines up with the sheet's leading border",
      expanded.vault?.box.left === expanded.main?.left,
      `chip at ${expanded.vault?.box.left}px vs sheet at ${expanded.main?.left}px`,
    );
    check(
      "nothing spills past the window",
      expanded.overflow.scrollWidth <= viewportWidth,
      `scrollWidth ${expanded.overflow.scrollWidth}px vs window ${viewportWidth}px`,
    );
    check(
      "rail does not scroll its own topband away",
      expanded.rail?.scrollTop === 0 &&
        (expanded.rail?.scrollHeight ?? 0) <= (expanded.rail?.clientHeight ?? 0),
      `scrollTop ${expanded.rail?.scrollTop}, content ${expanded.rail?.scrollHeight}px in ${expanded.rail?.clientHeight}px`,
    );

    const expandedShot = await win.webContents.capturePage();
    const expandedFile = path.join(artifactsDir, "shell-sidebar-expanded.png");
    fs.writeFileSync(expandedFile, expandedShot.toPNG());
    const cornerShot = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: 420,
      height: 260,
    });
    const cornerFile = path.join(artifactsDir, "shell-sidebar-corner.png");
    fs.writeFileSync(cornerFile, cornerShot.toPNG());

    // 6 — the toggle collapses: rail gone, column given back, way back in place.
    const clickedCollapse = await clickToggle(".nav-rail .nav-toggle");
    check("collapse toggle clicked", clickedCollapse, "no rail toggle to click");
    const collapsed = await settled();

    check(
      "collapse removes the rail",
      collapsed.rail === null || collapsed.railDisplay === "none",
      `rail ${collapsed.rail ? `display:${collapsed.railDisplay}` : "kept in the tree"}`,
    );
    check(
      "collapse gives the column back",
      collapsed.main?.left === frame,
      `sheet left ${collapsed.main?.left}px vs frame ${frame}px`,
    );
    check(
      "the collapse spares the sheet-to-chat gap",
      Boolean(
        collapsed.main &&
          collapsed.chat &&
          collapsed.chat.box.left - collapsed.main.right === frame,
      ),
      `sheet→chat ${(collapsed.chat?.box.left ?? 0) - (collapsed.main?.right ?? 0)}px vs frame ${frame}px`,
    );
    check(
      "reopen toggle lands on the titlebar",
      collapsed.titlebarToggle?.label === "Expand sidebar",
      `titlebar toggle ${JSON.stringify(collapsed.titlebarToggle)}`,
    );
    check(
      "the strip keeps its column once the rail is gone",
      (collapsed.vault?.box.left ?? 0) >= track,
      `vault chip starts at ${collapsed.vault?.box.left}px — the reserved column collapsed with the rail`,
    );
    check(
      "the toggle does not move between states",
      Boolean(
        collapsed.titlebarToggle &&
          expanded.railToggle &&
          ["left", "top", "width", "height"].every(
            (key) =>
              collapsed.titlebarToggle.box[key] === expanded.railToggle.box[key],
          ),
      ),
      `rail ${JSON.stringify(expanded.railToggle?.box)} vs titlebar ${JSON.stringify(collapsed.titlebarToggle?.box)}`,
    );
    check(
      "the vault chip does not move between states",
      Boolean(
        collapsed.vault &&
          expanded.vault &&
          ["left", "top", "width", "height"].every(
            (key) => collapsed.vault.box[key] === expanded.vault.box[key],
          ),
      ),
      `expanded ${JSON.stringify(expanded.vault?.box)} vs collapsed ${JSON.stringify(collapsed.vault?.box)}`,
    );
    check(
      "the vault chip keeps its name once collapsed",
      collapsed.vault?.text === vaultName,
      `chip "${collapsed.vault?.text}"`,
    );
    check(
      "corner belongs to the titlebar once collapsed",
      collapsed.corner?.insideTitlebar === true,
      `corner element ${JSON.stringify(collapsed.corner)}`,
    );
    check(
      "collapse spares the chat column",
      collapsed.chat?.box.left === expanded.chat?.box.left &&
        collapsed.chat?.box.width === expanded.chat?.box.width,
      `chat ${JSON.stringify(collapsed.chat?.box)} vs ${JSON.stringify(expanded.chat?.box)}`,
    );

    const collapsedShot = await win.webContents.capturePage();
    const collapsedFile = path.join(artifactsDir, "shell-sidebar-collapsed.png");
    fs.writeFileSync(collapsedFile, collapsedShot.toPNG());

    // 7 — and it expands again to exactly the box it started from.
    const clickedExpand = await clickToggle(".window-titlebar__nav-toggle");
    check("reopen toggle clicked", clickedExpand, "no titlebar toggle to click");
    const restored = await settled();

    check(
      "reopen restores the rail box",
      JSON.stringify(restored.rail?.box) === JSON.stringify(expanded.rail?.box),
      `restored ${JSON.stringify(restored.rail?.box)} vs ${JSON.stringify(expanded.rail?.box)}`,
    );
    check(
      "reopen restores the sheet offset",
      restored.main?.left === expanded.main?.left,
      `sheet left ${restored.main?.left}px vs ${expanded.main?.left}px`,
    );
    check(
      "reopen restores the titlebar offset",
      restored.vault?.box.left === expanded.vault?.box.left,
      `vault chip left ${restored.vault?.box.left}px vs ${expanded.vault?.box.left}px`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      tokens: expanded.tokens,
      expanded,
      collapsed,
      restored,
      reclaimedPx: (expanded.main?.left ?? 0) - (collapsed.main?.left ?? 0),
      screenshots: [expandedFile, cornerFile, collapsedFile],
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

  const reportFile = path.join(artifactsDir, "shell-sidebar.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [report.expanded, report.collapsed, report.restored].filter(
    (state) => state && state.tokens,
  );
  const labels = ["expanded", "collapsed", "restored"];
  // The collapsed shell keeps a `display: none` rail in the tree, so its toggle
  // measures 0x0 — report the toggle that is actually on screen.
  const visibleToggleLeft = (state) => {
    const boxes = [state.railToggle?.box, state.titlebarToggle?.box].filter(
      (box) => box && box.width > 0,
    );
    return boxes.length ? String(boxes[0].left) : "—";
  };
  const table = [
    ["state", "rail L/T/B", "rail size", "band ctrls", "toggle L", "chip L", "sheet L", "corner"],
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const state = rows[i];
    table.push([
      labels[i],
      state.rail ? `${state.rail.box.left}/${state.rail.box.top}/${state.rail.box.bottom}` : "none",
      state.rail ? `${state.rail.box.width}x${state.rail.box.height}` : "—",
      state.header ? String(state.header.controls.length) : "—",
      visibleToggleLeft(state),
      String(state.vault?.box.left ?? "—"),
      String(state.main?.left ?? "—"),
      state.corner ? (state.corner.insideRail ? "rail" : "titlebar") : "—",
    ]);
  }
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  for (const row of table) console.log(format(row));
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "shell sidebar: PASS" : "shell sidebar: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`shell-sidebar: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
