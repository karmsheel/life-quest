/**
 * Drives the shell sidebar harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/shell-sidebar.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/shell-sidebar.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required. It carries
 * the colour ladder too — night and day, surface ink and luminance — so the
 * "darkest page canvas" claim is a number in a file, not a screenshot to squint at.
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
  const dockActions = document.querySelector(".chat-panel__actions");
  const topBar = document.querySelector(".top-bar");
  const chatHeader = document.querySelector(".chat-panel__header");
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
      titlebarHeight,
      radiusSm: root.getPropertyValue("--radius-sm").trim()
    },
    theme: {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      skin: document.documentElement.getAttribute("data-skin"),
      canvasBase: root.getPropertyValue("--canvas-base").trim(),
      background: root.getPropertyValue("--background").trim(),
      card: root.getPropertyValue("--card").trim(),
      bgPanel: root.getPropertyValue("--bg-panel").trim(),
      mutedSurface: root.getPropertyValue("--muted-surface").trim()
    },
    cards: Object.fromEntries(
      Array.from(document.querySelectorAll("[data-probe]")).map((el) => [
        el.getAttribute("data-probe"),
        getComputedStyle(el).backgroundColor
      ])
    ),
    dockActions: dockActions
      ? getComputedStyle(dockActions).backgroundColor
      : null,
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
          backdropFilter: getComputedStyle(rail).backdropFilter,
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
    topBar: topBar
      ? {
          box: box(topBar),
          borderBottomWidth: getComputedStyle(topBar).borderBottomWidth,
          borderBottomColor: getComputedStyle(topBar).borderBottomColor,
          background: getComputedStyle(topBar).backgroundColor
        }
      : null,
    chatHeader: chatHeader
      ? {
          box: box(chatHeader),
          borderBottomWidth: getComputedStyle(chatHeader).borderBottomWidth,
          borderBottomColor: getComputedStyle(chatHeader).borderBottomColor,
          background: getComputedStyle(chatHeader).backgroundColor
        }
      : null,
    sheet: main
      ? {
          box: box(main),
          borderRadius: getComputedStyle(main).borderRadius,
          borderTopLeftRadius: getComputedStyle(main).borderTopLeftRadius,
          borderTopRightRadius: getComputedStyle(main).borderTopRightRadius,
          borderBottomRightRadius: getComputedStyle(main).borderBottomRightRadius,
          borderBottomLeftRadius: getComputedStyle(main).borderBottomLeftRadius,
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

/**
 * The last step the rig reached.
 *
 * A throw anywhere inside the run leaves `report` as the catch branch, so without
 * this the failure reads as a bare "Script failed to execute" with no indication
 * of which evaluation produced it — which is a bisect instead of a diagnosis.
 */
let step = "start";
const at = (name) => {
  step = name;
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

/**
 * WCAG relative luminance of a computed `rgb()` colour, 0 = black, 1 = white.
 * The ladder is an ordering claim, so it is asserted on gamma-corrected numbers
 * rather than on the hex strings — a skin is free to move the inks as long as the
 * order holds.
 */
const luminance = (color) => {
  const match = /^rgba?\(([^)]+)\)$/.exec(color ?? "");
  if (!match) return Number.NaN;
  const [r, g, b] = match[1]
    .split(",")
    .slice(0, 3)
    .map((part) => parseFloat(part) / 255);
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** The ladder as numbers, for the report and the stdout table. */
const ladderOf = (state) => {
  const surfaces = {
    chrome: state.rail?.background ?? null,
    titlebar: state.titlebarBackground ?? null,
    page: state.mainBackground ?? null,
    dock: state.chat?.background ?? null,
    dockActions: state.dockActions ?? null,
    card: state.cards?.["home-card"] ?? null,
    viewCard: state.cards?.["view-card"] ?? null,
  };
  return {
    dataTheme: state.theme?.dataTheme ?? null,
    skin: state.theme?.skin ?? null,
    tokens: state.theme ?? null,
    surfaces,
    luminance: Object.fromEntries(
      Object.entries(surfaces).map(([key, color]) => [key, luminance(color)]),
    ),
  };
};

/**
 * The app's own scrollbar, measured on the two scrollers the operator names: the
 * sheet's content (`.shell__content`) and the chat transcript
 * (`.chat-panel__body`).
 *
 * What makes this falsifiable is the GUTTER. Chromium lays out a styled
 * scrollbar at exactly the width the CSS asks for, and leaves a platform bar at
 * the platform's own width — 15 to 17 px on Windows. So `offsetWidth -
 * clientWidth` is 8 on a scroller that got the app's treatment and something
 * else on one that did not, and no amount of eyeballing is needed to tell them
 * apart.
 *
 * The pseudo-element reads are Chromium's; where an engine does not answer for
 * them the field is null and the gutter above still carries the claim. That is
 * recorded rather than assumed: `pseudoReadable` in the report says which kind of
 * run this was, so a silently-absent assertion cannot pass for a held one.
 */
const SCROLL_CHROME = `(() => {
  const read = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
    const track = getComputedStyle(el, "::-webkit-scrollbar-track");
    const bar = getComputedStyle(el, "::-webkit-scrollbar");
    const r = el.getBoundingClientRect();
    return {
      selector,
      box: {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height)
      },
      // 0 when nothing overflows: the claim below refuses that run first.
      gutterX: el.offsetWidth - el.clientWidth,
      gutterY: el.offsetHeight - el.clientHeight,
      overflowsY: el.scrollHeight > el.clientHeight,
      // Whether the browser itself considers this scroller hovered. This is what
      // separates "the rig cannot make a hidden window hover" — which is a limit
      // of the rig and is recorded as one — from "the hover rule does not fire",
      // which would be a bug in the stylesheet.
      hovered: el.matches(":hover"),
      barWidth: bar ? bar.width : null,
      thumbBackground: thumb ? thumb.backgroundColor : null,
      thumbRadius: thumb ? thumb.borderTopLeftRadius : null,
      trackBackground: track ? track.backgroundColor : null
    };
  };
  const root = getComputedStyle(document.documentElement);
  return {
    sheet: read(".shell__content"),
    transcript: read(".chat-panel__body"),
    thumbToken: root.getPropertyValue("--scrollbar-thumb").trim(),
    mutedForeground: root.getPropertyValue("--muted-foreground").trim(),
    accent: root.getPropertyValue("--accent").trim(),
    primary: root.getPropertyValue("--primary").trim()
  };
})()`;

/**
 * A colour's alpha, or NaN when the value is not a colour at all.
 *
 * Chromium answers a plain `rgba()` for a transparent thumb but a
 * `color(srgb r g b / a)` for one painted by `color-mix()`, so both forms are
 * read here rather than only the first.
 */
const alphaOf = (color) => {
  const value = (color ?? "").trim();
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[,/ ]+/).filter(Boolean).map(parseFloat);
    return parts.length > 3 ? parts[3] : 1;
  }
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value);
  if (srgb) {
    const parts = srgb[1].split(/[/ ]+/).filter(Boolean).map(parseFloat);
    return parts.length > 3 ? parts[3] : 1;
  }
  return Number.NaN;
};

/**
 * The scrollbar claims for one palette. `label` names the mode the caller put the
 * window in, so a failure says which run it came from.
 *
 * Every scroller in the window is styled, but only two of them are *asserted*: a
 * claim needs a region that really scrolls, and these are the two the operator
 * named. The rail, the settings overlays and the dialogs take the same rule by
 * cascade, so a regression in the rule shows up here.
 */
function checkScrollChrome(label, scroll) {
  const both = [scroll.sheet, scroll.transcript];
  check(
    `${label}: both named scrollers exist and really overflow`,
    both.every((region) => region && region.overflowsY),
    `sheet ${JSON.stringify(scroll.sheet?.overflowsY)} / transcript ${JSON.stringify(scroll.transcript?.overflowsY)}`,
  );

  for (const [name, region] of [
    ["the sheet's content", scroll.sheet],
    ["the chat transcript", scroll.transcript],
  ]) {
    if (!region) {
      check(`${label}: ${name} was found`, false, "the region is not in the tree");
      continue;
    }
    // The load-bearing one: the platform bar is 15-17px on Windows and the app's
    // is 0.5rem. A gutter of 8 is proof the app's rules won, not a proxy for it.
    check(
      `${label}: ${name} wears the app's 8px bar, not the platform's`,
      region.gutterX === 8,
      `gutter ${region.gutterX}px (bar width ${JSON.stringify(region.barWidth)})`,
    );
    if (region.thumbBackground !== null) {
      // Drawn at rest, and quiet: present enough to read as a bar, faint enough
      // not to compete with the content. A fully transparent thumb is the failure
      // this pins shut — it is invisible, and an operator reads that as "there is
      // no scrollbar here".
      check(
        `${label}: ${name} draws its thumb at rest, quietly`,
        alphaOf(region.thumbBackground) > 0 && alphaOf(region.thumbBackground) <= 0.2,
        `thumb background ${JSON.stringify(region.thumbBackground)}`,
      );
      check(
        `${label}: ${name} draws no track`,
        alphaOf(region.trackBackground) === 0,
        `track background ${JSON.stringify(region.trackBackground)}`,
      );
    }
  }

  // The ink is a neutral taken from the palette's mid ink — the same one muted
  // text wears — and never the accent. A brand-tinted scrollbar is chrome wearing
  // the brand's colour, which is what this pins shut.
  check(
    `${label}: the thumb ink is the palette's mid ink, not the accent`,
    scroll.thumbToken !== "" &&
      scroll.thumbToken === scroll.mutedForeground &&
      scroll.thumbToken !== scroll.accent &&
      scroll.thumbToken !== scroll.primary,
    `--scrollbar-thumb ${JSON.stringify(scroll.thumbToken)} vs --muted-foreground ${JSON.stringify(scroll.mutedForeground)}, --accent ${JSON.stringify(scroll.accent)}`,
  );
}

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

  /**
   * The harness's own theme switch: `applyThemePreference` + `applySkin`, the two
   * calls the provider makes when the preference or the skin changes. It returns
   * the skin it resolved, so a sweep can prove the palette landed rather than
   * measure the previous one.
   */
  const applyTheme = async (skinName, mode) => {
    const applied = await run(
      `window.shellHarnessApplyTheme?.(${JSON.stringify(skinName)}, ${JSON.stringify(mode)}) ?? null`,
    );
    check(
      `the harness switched to ${skinName} ${mode}`,
      applied === skinName,
      `harness resolved ${JSON.stringify(applied)}`,
    );
    return applied;
  };

  /**
   * Every night palette in the app. Named here rather than discovered so a run
   * measures a fixed set; the suite cross-checks this list against the skin
   * registry, so a new dark skin cannot land without being measured.
   */
  const NIGHT_SKINS = [
    "forge-os",
    "nous",
    "nous-classic",
    "midnight",
    "ember",
    "mono",
    "cyberpunk",
  ];

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

    // The rig pins the palette it measures. A rig shares this window's storage
    // with the operator's own dev profile, so whatever skin and mode they last
    // chose would otherwise decide what "expanded" is painted in — and a forge-os
    // claim measured on another palette is worse than no claim at all.
    await applyTheme("forge-os", "dark");

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

    // 5 — the workspace sheet is flush to the rail and the dock, and keeps its
    // one pane gap only under the strip. The chrome around it is a single band of
    // mat: the rail wears the titlebar's own fill with no frost in between.
    check(
      "the sheet abuts the rail's trailing edge",
      expanded.main?.left === track,
      `sheet left ${expanded.main?.left}px vs rail right ${expanded.rail?.box.right}px`,
    );
    check(
      "the chrome is one band: the rail wears the titlebar's fill, unfrosted",
      expanded.rail?.background === expanded.titlebarBackground &&
        expanded.rail?.backdropFilter === "none",
      `rail ${expanded.rail?.background} backdrop ${expanded.rail?.backdropFilter} vs titlebar ${expanded.titlebarBackground}`,
    );
    check(
      "the sheet closes the gap to the dock and the window's bottom",
      Boolean(
        expanded.main &&
          expanded.chat &&
          expanded.main.right === expanded.chat.box.left &&
          expanded.main.bottom === viewportHeight,
      ),
      `sheet right ${expanded.main?.right}px vs dock left ${expanded.chat?.box.left}px, sheet bottom ${expanded.main?.bottom}px vs window ${viewportHeight}px`,
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
      "the dock paints no line of its own",
      expanded.chat?.borderTopWidth === "0px" &&
        expanded.chat?.borderRightWidth === "0px" &&
        expanded.chat?.borderBottomWidth === "0px" &&
        expanded.chat?.borderLeftWidth === "0px",
      `borders t/r/b/l ${expanded.chat?.borderTopWidth}/${expanded.chat?.borderRightWidth}/${expanded.chat?.borderBottomWidth}/${expanded.chat?.borderLeftWidth}`,
    );
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
      "the sheet keeps its pane gap under the strip",
      expanded.main?.top === titlebarHeight + frame,
      `sheet top ${expanded.main?.top}px (want ${titlebarHeight + frame}px)`,
    );
    // One rounded corner: the leading top, next to the wing selector's first tab,
    // where the mat is on both sides of the corner. The other three stay square —
    // a radius there would notch the rail's seam or the window's own edge.
    check(
      "the sheet's leading top corner is the only rounded one",
      expanded.sheet?.borderTopLeftRadius === expanded.tokens?.radiusSm &&
        expanded.sheet?.borderTopRightRadius === "0px" &&
        expanded.sheet?.borderBottomRightRadius === "0px" &&
        expanded.sheet?.borderBottomLeftRadius === "0px",
      `corners tl/tr/br/bl ${expanded.sheet?.borderTopLeftRadius}/${expanded.sheet?.borderTopRightRadius}/${expanded.sheet?.borderBottomRightRadius}/${expanded.sheet?.borderBottomLeftRadius} vs --radius-sm ${expanded.tokens?.radiusSm}`,
    );
    // One line between panes, and only one: the sheet's trailing hairline, the
    // seam with the dock. The sheet's top and leading edges paint nothing — the
    // rail meets it as a change of fill, and the pane gap is what separates it from
    // the strip — and neither neighbour draws an edge of its own.
    check(
      "the sheet wears one hairline, on its trailing edge",
      parseFloat(expanded.sheet?.borderRightWidth ?? "0") > 0 &&
        parseFloat(expanded.sheet?.borderRightWidth ?? "0") <= 1 &&
        expanded.sheet?.borderTopWidth === "0px" &&
        expanded.sheet?.borderBottomWidth === "0px" &&
        expanded.sheet?.borderLeftWidth === "0px",
      `borders t/r/b/l ${expanded.sheet?.borderTopWidth}/${expanded.sheet?.borderRightWidth}/${expanded.sheet?.borderBottomWidth}/${expanded.sheet?.borderLeftWidth}`,
    );
    check(
      "the rail meets the sheet with no line between them",
      expanded.rail?.borderRightWidth === "0px" &&
        expanded.sheet?.borderLeftWidth === "0px",
      `rail right ${expanded.rail?.borderRightWidth}, sheet left ${expanded.sheet?.borderLeftWidth}`,
    );
    check(
      "the sheet's top edge sits one pane gap under the strip",
      expanded.sheet?.box.top === titlebarHeight + frame,
      `sheet top at y=${expanded.sheet?.box.top}px, strip ends at ${titlebarHeight}px, pane gap ${frame}px`,
    );
    // The line the strip reads as its own is the top bar's, under the wing and
    // domain selectors — not a frame on the sheet's top edge.
    check(
      "the line under the wing and domain selectors is the top bar's own",
      parseFloat(expanded.topBar?.borderBottomWidth ?? "0") > 0 &&
        parseFloat(expanded.topBar?.borderBottomWidth ?? "0") <= 1 &&
        expanded.topBar?.background === expanded.mainBackground,
      `top bar bottom ${expanded.topBar?.borderBottomWidth} on ${expanded.topBar?.background} vs page ${expanded.mainBackground}`,
    );
    // ...and it is one line across both panes: the dock's header wears the same
    // band height, so the two underlines land on the same row rather than stepping
    // a pixel apart where they meet.
    check(
      "the sheet's top bar and the dock's header are one band",
      Boolean(expanded.topBar && expanded.chatHeader) &&
        expanded.topBar.box.top === expanded.chatHeader.box.top &&
        expanded.topBar.box.bottom === expanded.chatHeader.box.bottom &&
        expanded.topBar.box.top === titlebarHeight + frame &&
        parseFloat(expanded.chatHeader.borderBottomWidth || "0") > 0,
      `top bar ${JSON.stringify(expanded.topBar?.box)} vs dock header ${JSON.stringify(expanded.chatHeader?.box)}, header underline ${expanded.chatHeader?.borderBottomWidth}`,
    );
    check(
      "the chip lines up with the sheet's leading edge",
      expanded.vault?.box.left === expanded.main?.left,
      `chip at ${expanded.vault?.box.left}px vs sheet at ${expanded.main?.left}px`,
    );

    // The night ladder: the studio is a frame around the darkest page. The page
    // canvas is the floor, the cards step up off it, and the chrome band — the rail
    // and the strip — wears the dock's own quiet band, under the cards and clear of
    // the floor.
    const night = ladderOf(expanded);
    const { chrome, page, card, viewCard } = night.luminance;
    const band = night.luminance.dockActions;
    check(
      "the rig is painted in the night skin",
      night.dataTheme === "dark" && night.skin === "forge-os",
      `theme ${night.dataTheme}, skin ${night.skin}`,
    );
    check(
      "the card probes are on screen",
      Number.isFinite(card) && Number.isFinite(viewCard),
      `probe fills ${JSON.stringify(expanded.cards)}`,
    );
    check(
      "night: the chrome band wears the dock's own action band",
      Number.isFinite(band) &&
        night.surfaces.chrome === night.surfaces.dockActions &&
        night.tokens.canvasBase === night.tokens.mutedSurface,
      `mat ${night.surfaces.chrome} vs .chat-panel__actions ${night.surfaces.dockActions}; tokens ${night.tokens.canvasBase} vs ${night.tokens.mutedSurface}`,
    );
    check(
      "night: the chrome band sits under the cards and off the page",
      chrome > page && chrome < card && chrome < viewCard,
      `mat ${chrome.toFixed(4)} between page ${page.toFixed(4)} and card ${card.toFixed(4)}/${viewCard.toFixed(4)}`,
    );
    check(
      "night: the cards step up off the page canvas",
      card > page && viewCard > page,
      `card ${night.surfaces.card} (${card.toFixed(4)}), view card ${night.surfaces.viewCard} (${viewCard.toFixed(4)}) vs page ${page.toFixed(4)}`,
    );
    check(
      "night: the page canvas is the darkest surface in the window",
      [chrome, night.luminance.titlebar, page, night.luminance.dock, band, card, viewCard].every(
        (lum) => Number.isFinite(lum) && lum >= page,
      ),
      `page ${page.toFixed(4)} against ${JSON.stringify(night.luminance)}`,
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
    // The seam where the two bands meet, zoomed to the one line they should share —
    // the claim the colour and border checks make, in pixels.
    const seamShot = await win.webContents.capturePage({
      x: Math.max(0, (expanded.chat?.box.left ?? 0) - 140),
      y: titlebarHeight,
      width: 280,
      height: 120,
    });
    const seamFile = path.join(artifactsDir, "shell-sidebar-seam.png");
    fs.writeFileSync(seamFile, seamShot.toPNG());

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
      collapsed.main?.left === 0,
      `sheet left ${collapsed.main?.left}px — with no rail the sheet starts on the window's own edge`,
    );
    check(
      "the collapse leaves the sheet flush to the dock",
      Boolean(
        collapsed.main &&
          collapsed.chat &&
          collapsed.main.right === collapsed.chat.box.left,
      ),
      `sheet right ${collapsed.main?.right}px vs dock left ${collapsed.chat?.box.left}px`,
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

    // 8 — the ladder is a *night* ladder. Day keeps its own order, where the mat
    // and the panels sink below the sheet; the same rig, the same skin and only
    // the mode flipped, so a day that inherited the night inks fails here rather
    // than on the operator's screen.
    await applyTheme("forge-os", "light");
    const day = await settled();

    const dawn = ladderOf(day);
    check(
      "day renders the same skin in its own mode",
      dawn.dataTheme === "light" && dawn.skin === "forge-os",
      `theme ${dawn.dataTheme}, skin ${dawn.skin}`,
    );
    check(
      "day: the mat still sinks below the sheet",
      dawn.luminance.chrome < dawn.luminance.page &&
        dawn.luminance.titlebar < dawn.luminance.page,
      `mat ${dawn.surfaces.chrome} (${dawn.luminance.chrome.toFixed(4)}) and titlebar ${dawn.luminance.titlebar.toFixed(4)} vs sheet ${dawn.surfaces.page} (${dawn.luminance.page.toFixed(4)})`,
    );
    check(
      "day: the panels still recess below the sheet",
      dawn.luminance.card < dawn.luminance.page,
      `card ${dawn.surfaces.card} (${dawn.luminance.card.toFixed(4)}) vs sheet ${dawn.luminance.page.toFixed(4)}`,
    );

    const dayShot = await win.webContents.capturePage();
    const dayFile = path.join(artifactsDir, "shell-sidebar-day.png");
    fs.writeFileSync(dayFile, dayShot.toPNG());

    // 8a — the scrollbar is chrome, so it takes the same two claims the ladder
    // does: it is the app's own bar in both modes, and its ink comes from the
    // palette that is on. Measured here in daylight, where a wrong ink is a dark
    // smudge on a white sheet rather than a subtlety.
    at("scroll-chrome: at rest");
    const dayScroll = await run(SCROLL_CHROME);
    checkScrollChrome("day", dayScroll);

    // Nothing is hovered yet, and in this rig nothing can be: a hidden window
    // never establishes `:hover` from a synthetic pointer — measured, not assumed,
    // via `el.matches(":hover")` in the sample above. So this read IS the resting
    // state, and the hovered one is produced below by the only device that can.
    const scrollRest = {
      sheet: dayScroll.sheet?.thumbBackground ?? null,
      transcript: dayScroll.transcript?.thumbBackground ?? null,
    };
    let scrollSheetHover = { sheet: null, transcript: null };
    let scrollHover = { sheet: null, transcript: null };

    /** Wait for painted frames, bounded — the settle a style change needs. */
    const paint = () =>
      run(
        `new Promise((resolve) => {
           let frames = 0;
           const tick = () => {
             frames += 1;
             if (frames >= 3) resolve(true);
             else requestAnimationFrame(tick);
           };
           requestAnimationFrame(tick);
         })`,
      );

    // And the bar is hover-only, which is the whole of the Hermes treatment: not
    // drawn at rest, drawn when the pointer is in the region it belongs to, and
    // still not drawn in the *other* region — a custom scrollbar follows its own
    // scroller, not hover anywhere in the app.
    //
    // A hidden window cannot be made to hover. That is measured, not assumed: with
    // the pointer dispatched through the browser's own input pipeline,
    // `el.matches(":hover")` still reads false in this rig, so every painted
    // reading of the hovered bar returned the resting one. The device that can
    // produce the state is the one DevTools uses — `CSS.forcePseudoState` over the
    // debugger — and it is used here for exactly that reason. Where the debugger
    // is unavailable the claims below are not silently skipped: `hoverForced` in
    // the report says so, and the resting, gutter and ink claims still carry.
    const forced = { hoverForced: false, error: null };
    const forcePseudo = async (selector, on) => {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) {
        dbg.attach("1.3");
        await dbg.sendCommand("DOM.enable");
        await dbg.sendCommand("CSS.enable");
      }
      const { root } = await dbg.sendCommand("DOM.getDocument", { depth: 1 });
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      if (!nodeId) throw new Error(`no node for ${selector}`);
      await dbg.sendCommand("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: on ? ["hover"] : [],
      });
    };
    // No strip capture here, deliberately.
    //
    // A 1:1 crop of the edge is the obvious visual proof, and it cannot be taken
    // from this rig: `capturePage` of a small rect stops settling once the
    // debugger session below is open — the window never returns a bitmap and the
    // rig dies on its own watchdog. That was measured, twice, and it is also why
    // the crops taken before the state was forced came back byte-identical.
    //
    // So the hover claim rests on the computed thumb — which does change, and which
    // went red before the state was forced — and the visual check is the full-window
    // captures, where the resting bar is now drawn and therefore visible, plus the
    // running app where the pointer is real.

    at("scroll-chrome: forced hover");
    try {
      await forcePseudo(".shell__content", true);
      await paint();
      const overSheet = await run(SCROLL_CHROME);
      await forcePseudo(".shell__content", false);
      await forcePseudo(".chat-panel__body", true);
      await paint();
      const overTranscript = await run(SCROLL_CHROME);
      await forcePseudo(".chat-panel__body", false);

      scrollSheetHover = {
        sheet: overSheet.sheet?.thumbBackground ?? null,
        transcript: overSheet.transcript?.thumbBackground ?? null,
      };
      scrollHover = {
        transcript: overTranscript.transcript?.thumbBackground ?? null,
        sheet: overTranscript.sheet?.thumbBackground ?? null,
      };
      forced.hoverForced = true;
    } catch (error) {
      forced.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }

    check(
      "day: at rest both regions draw a quiet thumb",
      alphaOf(scrollRest.sheet) > 0 && alphaOf(scrollRest.transcript) > 0,
      `sheet ${JSON.stringify(scrollRest.sheet)}, transcript ${JSON.stringify(scrollRest.transcript)}`,
    );
    if (forced.hoverForced) {
      check(
        "day: hovering the sheet strengthens its thumb and leaves the transcript at rest",
        alphaOf(scrollSheetHover.sheet) > alphaOf(scrollRest.sheet) &&
          alphaOf(scrollSheetHover.transcript) === alphaOf(scrollRest.transcript),
        `sheet ${JSON.stringify(scrollSheetHover.sheet)} (rest ${JSON.stringify(scrollRest.sheet)}), transcript ${JSON.stringify(scrollSheetHover.transcript)}`,
      );
      check(
        "day: hovering the transcript strengthens its thumb and leaves the sheet at rest",
        alphaOf(scrollHover.transcript) > alphaOf(scrollRest.transcript) &&
          alphaOf(scrollHover.sheet) === alphaOf(scrollRest.sheet),
        `transcript ${JSON.stringify(scrollHover.transcript)} (rest ${JSON.stringify(scrollRest.transcript)}), sheet ${JSON.stringify(scrollHover.sheet)}`,
      );
    } else {
      failures.push(
        `day: the hovered scrollbar was NOT measured — the debugger could not force :hover (${forced.error ?? "unknown"})`,
      );
    }

    // 9 — the night ladder holds for every dark palette, not just the default one.
    // The same four claims per skin: the page canvas is the deepest surface in the
    // window, the cards step up off it, the mat is its own ink and not the page,
    // and the mat and the dock's action row are one material.
    const skins = {};
    const scrolls = {};
    const skinShots = [];
    for (const skinName of NIGHT_SKINS) {
      await applyTheme(skinName, "dark");
      const ladder = ladderOf(await settled());
      skins[skinName] = ladder;

      // The scrollbar rides the same sweep: it is chrome, so every palette has to
      // give it its own mid ink, and the app's own bar has to survive every one.
      const scroll = await run(SCROLL_CHROME);
      scrolls[skinName] = scroll;
      checkScrollChrome(`night[${skinName}]`, scroll);

      const skinShot = await win.webContents.capturePage();
      const skinFile = path.join(artifactsDir, `shell-sidebar-night-${skinName}.png`);
      fs.writeFileSync(skinFile, skinShot.toPNG());
      skinShots.push(skinFile);

      const { luminance, surfaces, tokens } = ladder;
      const floors = [
        "chrome",
        "titlebar",
        "dock",
        "dockActions",
        "card",
        "viewCard",
      ];
      const lum = (key) => (luminance[key] ?? Number.NaN).toFixed(4);
      check(
        `night[${skinName}]: the rig is on that skin`,
        ladder.skin === skinName && ladder.dataTheme === "dark",
        `theme ${ladder.dataTheme}, skin ${ladder.skin}`,
      );
      check(
        `night[${skinName}]: every surface was measured`,
        floors.every((key) => Number.isFinite(luminance[key])),
        `fills ${JSON.stringify(surfaces)}`,
      );
      check(
        `night[${skinName}]: the mat and the dock's action band are one ink`,
        surfaces.chrome === surfaces.dockActions &&
          tokens.canvasBase === tokens.mutedSurface,
        `mat ${surfaces.chrome} vs .chat-panel__actions ${surfaces.dockActions}; tokens ${tokens.canvasBase} vs ${tokens.mutedSurface}`,
      );
      // An imported theme can carry its own elevation direction. `nous` is a
      // faithful copy of GitHub Dark Default, whose cards sit *below* its page.
      // The inverted branch asserts that direction rather than skipping the
      // claim, so a palette that drifts either way still fails.
      const inverted =
        (await run(
          `window.shellHarnessDarkLadder?.(${JSON.stringify(skinName)}) ?? "standard"`,
        )) === "inverted";
      if (inverted) {
        check(
          `night[${skinName}]: the cards sit below the page canvas (upstream ladder)`,
          luminance.card <= luminance.page && luminance.viewCard <= luminance.page,
          `card ${surfaces.card} (${lum("card")}) / viewCard ${surfaces.viewCard} (${lum("viewCard")}) vs page ${surfaces.page} (${lum("page")}) — this skin declares darkLadder "inverted"`,
        );
        check(
          `night[${skinName}]: the mat is still its own ink, above the page`,
          surfaces.chrome !== surfaces.page && luminance.chrome > luminance.page,
          `mat ${surfaces.chrome} (${lum("chrome")}) vs page ${surfaces.page} (${lum("page")})`,
        );
      } else {
        check(
          `night[${skinName}]: the page canvas is the darkest surface in the window`,
          floors.every((key) => luminance[key] >= luminance.page),
          `page ${lum("page")} against ${JSON.stringify(Object.fromEntries(floors.map((key) => [key, lum(key)])))}`,
        );
        check(
          `night[${skinName}]: the mat is its own ink, not the page`,
          surfaces.chrome !== surfaces.page && luminance.chrome > luminance.page,
          `mat ${surfaces.chrome} (${lum("chrome")}) vs page ${surfaces.page} (${lum("page")})`,
        );
        check(
          `night[${skinName}]: the cards step up off the page canvas`,
          luminance.card > luminance.page && luminance.viewCard > luminance.page,
          `card ${surfaces.card} (${lum("card")}) vs page ${surfaces.page} (${lum("page")})`,
        );
      }
    }

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      tokens: expanded.tokens,
      expanded,
      collapsed,
      restored,
      day,
      ladder: { night, day: dawn, skins },
      scroll: {
        day: dayScroll,
        night: scrolls,
        hover: {
          pointerOut: scrollRest,
          overSheet: scrollSheetHover,
          overTranscript: scrollHover,
          // How the hovered state was produced. A hidden window cannot be made to
          // hover by dispatching a pointer (`matches(":hover")` stays false), so the
          // state is forced through the debugger, the way DevTools' `:hov` panel
          // does. Recorded here because it is the difference between a measured
          // claim and an unmeasurable one.
          forcedByDebugger: forced.hoverForced,
          forceError: forced.error,
        },
        // Whether this engine answers for the scrollbar pseudo-elements at all.
        // Where it does not, the gutter is the claim that carries this section,
        // and the absence is visible here instead of passing for a held one.
        pseudoReadable: dayScroll.sheet?.thumbBackground !== null,
      },
      reclaimedPx: (expanded.main?.left ?? 0) - (collapsed.main?.left ?? 0),
      screenshots: [
        expandedFile,
        cornerFile,
        seamFile,
        collapsedFile,
        dayFile,
        ...skinShots,
      ],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw at ${step}: ${error instanceof Error ? error.message : String(error)}`,
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

  // The ladder, palette by palette: surface ink and its luminance, so the ordering
  // the run asserts is readable without opening the JSON.
  if (report.ladder) {
    const cell = (data, key) =>
      data?.surfaces?.[key]
        ? `${data.surfaces[key]} ${(data.luminance[key] ?? Number.NaN).toFixed(4)}`
        : "—";
    const rows = [
      ["palette", "mat (chrome)", "page canvas", "card", "dock action band"],
    ];
    const row = (label, data) =>
      rows.push([
        label,
        cell(data, "chrome"),
        cell(data, "page"),
        cell(data, "card"),
        cell(data, "dockActions"),
      ]);
    for (const [name, data] of Object.entries(report.ladder.skins ?? {})) {
      row(`night ${name}`, data);
    }
    if (report.ladder.day) row("day forge-os", report.ladder.day);
    const widths = rows[0].map((_, i) =>
      Math.max(...rows.map((row) => row[i].length)),
    );
    console.log("");
    for (const row of rows) {
      console.log(row.map((value, i) => value.padEnd(widths[i])).join("  "));
    }
  }

  // The scrollbar, palette by palette: the gutter that proves the app's bar
  // replaced the platform's, and the ink it drew with.
  if (report.scroll) {
    const rows = [["palette", "sheet gutter", "sheet thumb ink", "transcript gutter", "transcript thumb ink"]];
    const row = (label, data) =>
      rows.push([
        label,
        data?.sheet ? `${data.sheet.gutterX}px` : "—",
        data?.thumbToken || "—",
        data?.transcript ? `${data.transcript.gutterX}px` : "—",
        data?.thumbToken || "—",
      ]);
    row("day forge-os", report.scroll.day);
    for (const [name, data] of Object.entries(report.scroll.night ?? {})) {
      row(`night ${name}`, data);
    }
    rows.push([
      "pointer out",
      "—",
      JSON.stringify(report.scroll.hover?.pointerOut?.sheet ?? null),
      "—",
      JSON.stringify(report.scroll.hover?.pointerOut?.transcript ?? null),
    ]);
    rows.push([
      "over sheet",
      "—",
      JSON.stringify(report.scroll.hover?.overSheet?.sheet ?? null),
      "—",
      JSON.stringify(report.scroll.hover?.overSheet?.transcript ?? null),
    ]);
    rows.push([
      "over transcript",
      "—",
      JSON.stringify(report.scroll.hover?.overTranscript?.sheet ?? null),
      "—",
      JSON.stringify(report.scroll.hover?.overTranscript?.transcript ?? null),
    ]);
    const widths = rows[0].map((_, i) =>
      Math.max(...rows.map((r) => r[i].length)),
    );
    console.log("");
    for (const r of rows) {
      console.log(r.map((value, i) => value.padEnd(widths[i])).join("  "));
    }
    console.log(
      `scrollbar pseudo-elements readable: ${report.scroll.pseudoReadable}`,
    );
  }

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
