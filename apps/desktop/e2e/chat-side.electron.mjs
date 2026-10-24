/**
 * Drives the chat-side harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-side.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-side.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same geometry, no eyeballing the app required. It
 * carries both arrangements — dock right and dock left — plus the compositions
 * the swap has to survive (a collapsed dock on either side, a collapsed rail, and
 * both at once) and the round trip back to where it started.
 *
 * NOT covered here: whether Windows lets the click through the titlebar's drag
 * band. Synthetic DOM clicks bypass the OS hit test, so the `-webkit-app-region:
 * no-drag` carve-out on the switch can only be confirmed by clicking it in the
 * real window. It is the same carve-out every other titlebar control relies on:
 * the strip is a drag handle and the trailing cluster opts out.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-side.html";
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
  // The icon a control is wearing, read off the svg lucide tags it with: the
  // arrows have to follow the side the dock is standing on, and a label alone
  // would pass on a control pointing the wrong way.
  const iconClass = (el) => {
    const svg = el ? el.querySelector("svg") : null;
    if (!svg) return null;
    return Array.from(svg.classList).find((name) => name.startsWith("lucide-")) ?? null;
  };
  const border = (style) => ({
    top: style.borderTopWidth,
    right: style.borderRightWidth,
    bottom: style.borderBottomWidth,
    left: style.borderLeftWidth
  });

  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;height:0;width:var(--shell-nav-width)";
  document.body.appendChild(probe);
  const track = probe.offsetWidth;
  probe.style.width = "var(--chatbar-width)";
  const chatTrack = probe.offsetWidth;
  probe.remove();

  // The accent as the browser resolved it, so the launcher's resting and hover
  // fills can be compared against the same colour the rest of the app wears.
  const accentProbe = document.createElement("div");
  accentProbe.style.background = "var(--accent)";
  document.body.appendChild(accentProbe);
  const accentBackground = getComputedStyle(accentProbe).backgroundColor;
  accentProbe.remove();

  const paperProbe = document.createElement("div");
  paperProbe.style.background = "var(--background)";
  document.body.appendChild(paperProbe);
  const paperBackground = getComputedStyle(paperProbe).backgroundColor;
  paperProbe.remove();

  const rail = document.querySelector(".nav-rail");
  const main = document.querySelector(".shell__main");
  const chat = document.querySelector(".chat-panel");
  const launcher = document.querySelector(".chat-launcher");
  const actions = document.querySelector(".chat-panel__actions");
  const collapseAction = document.querySelector(".chat-panel__action--collapse");
  const shell = document.querySelector(".shell");
  const titlebar = document.querySelector(".window-titlebar");
  const vault = document.querySelector(".window-titlebar__vault");
  const trailing = document.querySelector(".window-titlebar__trailing");
  const sideSwitch = document.querySelector(".window-titlebar__side-switch");
  const chatToggle = document.querySelector(".window-titlebar__chat-toggle");
  const titlebarHeight = px(root.getPropertyValue("--window-titlebar-height"));
  const frame = px(root.getPropertyValue("--shell-frame"));
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const mainStyle = main ? getComputedStyle(main) : null;
  const chatStyle = chat ? getComputedStyle(chat) : null;
  const launcherStyle = launcher ? getComputedStyle(launcher) : null;
  const launcherMark = launcher?.querySelector(".chat-launcher__mark") ?? null;
  const launcherMarkStyle = launcherMark ? getComputedStyle(launcherMark) : null;

  // Which pane owns a point on the window. The panes' boxes can be right while
  // the wrong one is actually painted there — a dock left at \`z-index: 20\` over
  // a sheet that never moved would still measure as swapped.
  const owner = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (rail && rail.contains(el)) return "rail";
    if (launcher && launcher.contains(el)) return "launcher";
    if (main && main.contains(el)) return "sheet";
    if (chat && chat.contains(el)) return "dock";
    if (titlebar && titlebar.contains(el)) return "titlebar";
    return "other";
  };

  return {
    viewport: { width: vw, height: vh },
    tokens: {
      track,
      chatTrack,
      frame,
      rootFontSize,
      titlebarHeight,
      radiusSm: root.getPropertyValue("--radius-sm").trim()
    },
    theme: {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      skin: document.documentElement.getAttribute("data-skin")
    },
    vaultText: (vault?.textContent || "").trim(),
    accentBackground,
    paperBackground,
    shell: shell
      ? {
          className: shell.className,
          gridTemplateColumns: getComputedStyle(shell).gridTemplateColumns,
          box: box(shell)
        }
      : null,
    rail: rail
      ? {
          box: box(rail),
          display: getComputedStyle(rail).display,
          background: getComputedStyle(rail).backgroundColor
        }
      : null,
    main: main
      ? {
          box: box(main),
          radius: {
            topLeft: mainStyle.borderTopLeftRadius,
            topRight: mainStyle.borderTopRightRadius,
            bottomRight: mainStyle.borderBottomRightRadius,
            bottomLeft: mainStyle.borderBottomLeftRadius
          },
          border: border(mainStyle),
          background: mainStyle.backgroundColor,
          boxShadow: mainStyle.boxShadow
        }
      : null,
    chat: chat
      ? {
          box: box(chat),
          className: chat.className,
          border: border(chatStyle),
          background: chatStyle.backgroundColor,
          backdropFilter: chatStyle.backdropFilter,
          boxShadow: chatStyle.boxShadow,
          heading: (document.querySelector(".chat-panel__heading")?.textContent || "").trim()
        }
      : null,
    launcher: launcher
      ? {
          box: box(launcher),
          label: launcher.getAttribute("aria-label"),
          title: launcher.getAttribute("title"),
          position: launcherStyle.position,
          borderRadius: launcherStyle.borderRadius,
          background: launcherStyle.backgroundColor,
          color: launcherStyle.color,
          borderColor: launcherStyle.borderTopColor,
          borderWidth: launcherStyle.borderTopWidth,
          mark: Boolean(launcherMark),
          markMask: launcherMarkStyle
            ? launcherMarkStyle.maskImage || launcherMarkStyle.webkitMaskImage
            : null,
          markWidth: launcherMarkStyle ? px(launcherMarkStyle.width) : null,
          markHeight: launcherMarkStyle ? px(launcherMarkStyle.height) : null
        }
      : null,
    actions: actions
      ? {
          box: box(actions),
          controls: Array.from(actions.querySelectorAll("button")).map((el) => ({
            label: el.getAttribute("aria-label"),
            icon: iconClass(el),
            disabled: el.disabled
          }))
        }
      : null,
    collapseAction: collapseAction
      ? {
          label: collapseAction.getAttribute("aria-label"),
          title: collapseAction.getAttribute("title"),
          icon: iconClass(collapseAction),
          box: box(collapseAction)
        }
      : null,
    titlebar: titlebar
      ? {
          box: box(titlebar),
          background: getComputedStyle(titlebar).backgroundColor
        }
      : null,
    trailing: trailing
      ? {
          box: box(trailing),
          controls: Array.from(trailing.children).map((el) => ({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === "string" ? el.className : "",
            label: el.getAttribute("aria-label"),
            icon: iconClass(el),
            box: box(el)
          }))
        }
      : null,
    sideSwitch: sideSwitch
      ? {
          found: true,
          label: sideSwitch.getAttribute("aria-label"),
          title: sideSwitch.getAttribute("title"),
          pressed: sideSwitch.getAttribute("aria-pressed"),
          icon: iconClass(sideSwitch),
          box: box(sideSwitch)
        }
      : { found: false },
    chatToggle: chatToggle
      ? {
          label: chatToggle.getAttribute("aria-label"),
          icon: iconClass(chatToggle),
          box: box(chatToggle)
        }
      : null,
    owners: {
      topLeft: owner(Math.round(track / 2), Math.round(titlebarHeight / 2)),
      bottomLeft: owner(2, vh - 4),
      bottomRight: owner(vw - 2, vh - 4),
      // Half a dock's column in from the trailing edge: inside the dock when it
      // holds that edge, inside the sheet when it has been swapped away.
      trailingInner: owner(vw - Math.round(chatTrack / 2), vh - 4)
    },
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

/** One hairline, or none: the seam's line is a border, and a doubled seam is two. */
const isHairline = (value) => {
  const width = parseFloat(value ?? "0");
  return Number.isFinite(width) && width > 0 && width <= 1;
};
const isZero = (value) => parseFloat(value ?? "0") === 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The geometry both whole arrangements are held to. `side` names where the dock
 * is standing, so every claim is stated once and read in both directions — a
 * failure says which arrangement broke it.
 */
function checkArrangement(label, state, side) {
  const { track, frame, titlebarHeight, chatTrack } = state.tokens;
  const { height: viewportHeight, width: viewportWidth } = state.viewport;
  const rail = state.rail;
  const main = state.main;
  const chat = state.chat;
  const intoDock = side === "left" ? chat : main;
  const last = side === "left" ? main : chat;

  check(`${label}: the rail is on screen`, Boolean(rail), "no .nav-rail in the shell");
  check(
    `${label}: the rail holds the window's leading edge`,
    rail?.box.left === 0 && rail?.box.top === 0 && rail?.box.bottom === viewportHeight,
    `rail ${JSON.stringify(rail?.box)} of ${viewportWidth}x${viewportHeight}`,
  );
  check(
    `${label}: the rail's column is the one the tokens ask for`,
    rail?.box.width === track,
    `rail width ${rail?.box.width}px vs ${track}px`,
  );
  check(`${label}: the sheet exists`, Boolean(main), "no .shell__main in the shell");
  check(`${label}: the dock exists`, Boolean(chat), "no .chat-panel in the shell");
  check(
    `${label}: the titlebar chip wears the vault's name`,
    state.vaultText === state.vaultName,
    `chip "${state.vaultText}" vs vault "${state.vaultName}"`,
  );

  // The swap, stated as the one thing it is: which of the two panes leads. The
  // two panes then abut — the trailing edge of the leading one is the leading
  // edge of the other — so the swap cannot leave a gap or an overlap behind.
  const dockLeads = (chat?.box.left ?? 0) < (main?.box.left ?? 0);
  check(
    `${label}: the dock is ${side === "left" ? "ahead of" : "behind"} the sheet`,
    side === "left" ? dockLeads : !dockLeads,
    `dock left ${chat?.box.left}px, sheet left ${main?.box.left}px`,
  );
  const seam = side === "left" ? chat?.box.right : main?.box.right;
  const neighbour = side === "left" ? main?.box.left : chat?.box.left;
  check(
    `${label}: the two panes abut with no gap and no overlap`,
    seam === neighbour,
    `dock/sheet seam ${seam}px vs neighbour ${neighbour}px`,
  );

  // The rail holds the first track and the dock takes the one it is standing in:
  // the middle column when swapped — the rail's trailing edge — and the last one
  // beside the sheet when it is not. A dock still carrying the frame's slack after
  // the swap would run over the sheet instead of the mat.
  check(
    `${label}: the dock starts at the edge of the pane before it`,
    chat?.box.left === (side === "left" ? rail?.box.right : main?.box.right),
    `dock left ${chat?.box.left}px vs ${side === "left" ? "rail" : "sheet"} edge ${side === "left" ? rail?.box.right : main?.box.right}px`,
  );
  const expectedDockWidth = side === "left" ? chatTrack : chatTrack + frame;
  check(
    `${label}: the dock asks for ${side === "left" ? "its own column and no more" : "its column plus the frame's slack"}`,
    chat?.box.width === expectedDockWidth,
    `dock width ${chat?.box.width}px vs ${expectedDockWidth}px (column ${chatTrack}px + ${side === "left" ? 0 : frame}px)`,
  );
  check(
    `${label}: the leading pane stops where its column does`,
    intoDock?.box.left === track,
    `leading pane left ${intoDock?.box.left}px vs ${track}px`,
  );

  // Whichever pane is last reaches the window's own trailing edge: the dock does
  // it with its own width, the sheet with the frame's slack added to its track.
  check(
    `${label}: the trailing pane reaches the window's trailing edge`,
    last?.box.right === viewportWidth,
    `${side === "left" ? "sheet" : "dock"} right ${last?.box.right}px vs window ${viewportWidth}px`,
  );

  // One pane gap under the strip, and both panes reach the window's bottom edge.
  for (const [name, pane] of [
    ["sheet", main],
    ["dock", chat],
  ]) {
    check(
      `${label}: the ${name} keeps one pane gap under the strip`,
      pane?.box.top === titlebarHeight + frame,
      `${name} top ${pane?.box.top}px vs strip ${titlebarHeight}px + gap ${frame}px`,
    );
    check(
      `${label}: the ${name} reaches the window's bottom edge`,
      pane?.box.bottom === viewportHeight,
      `${name} bottom ${pane?.box.bottom}px vs window ${viewportHeight}px`,
    );
  }

  // Exactly one hairline between the two panes, on the sheet's edge facing the
  // dock — and none anywhere else on either box.
  const sheetSeam = side === "left" ? main?.border?.left : main?.border?.right;
  const sheetFar = side === "left" ? main?.border?.right : main?.border?.left;
  check(
    `${label}: the sheet draws the seam facing the dock`,
    isHairline(sheetSeam),
    `sheet ${side === "left" ? "left" : "right"} border ${sheetSeam}`,
  );
  check(
    `${label}: the sheet's other edges stay square and line-free`,
    isZero(sheetFar) && isZero(main?.border?.top) && isZero(main?.border?.bottom),
    `sheet borders t/r/b/l ${main?.border?.top}/${main?.border?.right}/${main?.border?.bottom}/${main?.border?.left}`,
  );
  check(
    `${label}: the dock paints no line of its own`,
    isZero(chat?.border?.top) &&
      isZero(chat?.border?.right) &&
      isZero(chat?.border?.bottom) &&
      isZero(chat?.border?.left),
    `dock borders t/r/b/l ${chat?.border?.top}/${chat?.border?.right}/${chat?.border?.bottom}/${chat?.border?.left}`,
  );

  // The sheet's one rounded corner stays on its leading top; the corner that sits
  // on the window's own edge stays square, because a curve there notches the pane
  // gap open against the window.
  check(
    `${label}: the sheet keeps its leading top corner`,
    main?.radius?.topLeft === state.tokens.radiusSm,
    `top-left radius ${main?.radius?.topLeft} vs --radius-sm ${state.tokens.radiusSm}`,
  );
  for (const [corner, radius] of [
    ["trailing top (on the window's edge)", main?.radius?.topRight],
    ["bottom right", main?.radius?.bottomRight],
    ["bottom left", main?.radius?.bottomLeft],
  ]) {
    check(
      `${label}: the sheet's ${corner} corner is square`,
      isZero(radius),
      `${corner} radius ${radius}`,
    );
  }

  // The dock keeps the sheet's own surface, and no frost or shadow of its own.
  check(
    `${label}: the dock wears the page canvas, not a surface of its own`,
    chat?.background === main?.background,
    `dock ${chat?.background} vs sheet ${main?.background}`,
  );
  check(
    `${label}: the dock is neither frosted nor floating`,
    chat?.backdropFilter === "none" && chat?.boxShadow === "none",
    `backdrop ${chat?.backdropFilter}, shadow ${chat?.boxShadow}`,
  );

  // And the boxes are not merely stated — the window's own corners are painted by
  // the pane the geometry says is there.
  check(
    `${label}: the window's bottom-right corner is the trailing pane's`,
    state.owners.bottomRight === (side === "left" ? "sheet" : "dock"),
    `bottom-right owner ${state.owners.bottomRight}`,
  );
  check(
    `${label}: the window's bottom-left corner is still the rail's`,
    state.owners.bottomLeft === "rail",
    `bottom-left owner ${state.owners.bottomLeft}`,
  );
  check(
    `${label}: the window's top-left corner is still the rail's`,
    state.owners.topLeft === "rail",
    `top-left owner ${state.owners.topLeft}`,
  );
  // Half a dock's column in from the trailing edge belongs to the trailing pane,
  // which is the sheet once the dock has been swapped away.
  check(
    `${label}: the trailing pane owns the column beside the window's edge`,
    state.owners.trailingInner === (side === "left" ? "sheet" : "dock"),
    `inner owner ${state.owners.trailingInner}`,
  );

  // Nothing spills sideways: the pane carrying the frame's slack lands on the
  // window's edge instead of opening a scrollbar there.
  check(
    `${label}: nothing spills past the window`,
    state.overflow.scrollWidth <= viewportWidth &&
      state.overflow.clientWidth <= viewportWidth,
    `scrollWidth ${state.overflow.scrollWidth}px, clientWidth ${state.overflow.clientWidth}px vs window ${viewportWidth}px`,
  );
}

/**
 * The titlebar's trailing cluster: the switch is there, next to the settings, and
 * the two chat controls' arrows follow the side the dock is standing on.
 */
function checkControls(label, state, side) {
  const controls = state.trailing?.controls ?? [];
  const classes = controls.map((control) => control.className);

  check(
    `${label}: the switch is in the titlebar's trailing cluster`,
    state.sideSwitch?.found === true,
    "no .window-titlebar__side-switch in the titlebar",
  );
  check(
    `${label}: the switch carries an icon of its own`,
    state.sideSwitch?.icon === "lucide-arrow-left-right",
    `switch icon ${JSON.stringify(state.sideSwitch?.icon)}`,
  );
  check(
    `${label}: the switch names the move it makes`,
    state.sideSwitch?.label ===
      (side === "left"
        ? "Move chat to the right of the page"
        : "Move chat to the left of the page"),
    `switch label ${JSON.stringify(state.sideSwitch?.label)}`,
  );
  check(
    `${label}: the switch reads its own state`,
    state.sideSwitch?.pressed === String(side === "left"),
    `aria-pressed ${JSON.stringify(state.sideSwitch?.pressed)} with the dock on the ${side}`,
  );

  // Order, read off the DOM rather than off the pixels: settings, then the
  // switch, then the collapse control. A cluster with the switch on the far side
  // of the window controls would still "contain" it.
  const settingsAt = classes.findIndex((name) => name.includes("settings-menu"));
  const switchAt = classes.findIndex((name) => name.includes("side-switch"));
  const collapseAt = classes.findIndex((name) => name.includes("chat-toggle"));
  check(
    `${label}: the switch sits beside the settings`,
    settingsAt >= 0 && switchAt === settingsAt + 1,
    `cluster order ${JSON.stringify(classes)}`,
  );
  check(
    `${label}: the collapse control follows the switch`,
    collapseAt === switchAt + 1,
    `cluster order ${JSON.stringify(classes)}`,
  );
  check(
    `${label}: the switch is a full-height titlebar control`,
    state.sideSwitch?.box?.height === state.tokens.titlebarHeight &&
      state.sideSwitch?.box?.top === state.trailing?.box.top &&
      state.sideSwitch?.box?.right === state.chatToggle?.box?.left,
    `switch ${JSON.stringify(state.sideSwitch?.box)} in a strip of ${state.tokens.titlebarHeight}px, collapse at ${JSON.stringify(state.chatToggle?.box)}`,
  );

  // The arrows point into the pane they open, on whichever side it stands.
  check(
    `${label}: the collapse control's arrow follows the dock`,
    state.chatToggle?.icon ===
      `lucide-panel-${side === "left" ? "left" : "right"}-close`,
    `collapse icon ${JSON.stringify(state.chatToggle?.icon)} with the dock on the ${side}`,
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the theme
  // the app itself defaults to (tokens.css, [data-theme="dark"]) so a test run is
  // not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const shot = async (name, rect) => {
    const image = await win.webContents.capturePage(rect);
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.chatSideHarnessReady !== "object") return null;
          await window.chatSideHarnessReady;
          return typeof window.chatSideHarnessVaultName === "string"
            ? window.chatSideHarnessVaultName
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

  /** Real pointer motion, so the bubble's own :hover is what is measured. */
  const hover = async (selector) => {
    const point = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2)
      };
    })()`);
    if (!point) throw new Error(`no element for ${selector}`);
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: point.x,
      y: point.y,
    });
  };

  const parkPointer = () =>
    win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });

  let report;
  const timeout = setTimeout(() => {
    console.error("chat-side: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    at("shipped arrangement");
    const right = await settled();
    right.vaultName = vaultName;
    const { height: viewportHeight, width: viewportWidth } = right.viewport;
    const rightShot = await shot("chat-side-right.png");
    // A 1:1 crop of the shipped seam: the sheet's leading top corner, beside the
    // rail, on the arrangement every operator starts from.
    const rightSeamShot = await shot("chat-side-right-seam.png", {
      x: Math.max(0, right.tokens.track - 90),
      y: Math.max(0, right.tokens.titlebarHeight - 10),
      width: Math.min(240, viewportWidth),
      height: 140,
    });

    checkArrangement("right", right, "right");
    checkControls("right", right, "right");
    check(
      "right: the shell wears the shipped arrangement class",
      right.shell?.className?.includes("shell--chat-right") === true,
      `shell classes ${JSON.stringify(right.shell?.className)}`,
    );

    // 2 — one click, and the two panes trade places.
    at("swapped arrangement");
    await click(".window-titlebar__side-switch");
    const left = await settled();
    left.vaultName = vaultName;
    const leftShot = await shot("chat-side-left.png");
    // The same seam, one column to the right and now between the dock and the
    // sheet: the arrangement's two visual claims — the one hairline and the one
    // rounded corner — in a single crop.
    const leftSeamShot = await shot("chat-side-left-seam.png", {
      x: Math.max(0, left.tokens.track + left.tokens.chatTrack - 90),
      y: Math.max(0, left.tokens.titlebarHeight - 10),
      width: Math.min(240, viewportWidth),
      height: 140,
    });

    checkArrangement("left", left, "left");
    checkControls("left", left, "left");
    check(
      "left: the shell wears the swapped arrangement class",
      left.shell?.className?.includes("shell--chat-left") === true,
      `shell classes ${JSON.stringify(left.shell?.className)}`,
    );
    check(
      "left: the rail is where the swap left it",
      same(left.rail?.box, right.rail?.box),
      `rail ${JSON.stringify(left.rail?.box)} vs ${JSON.stringify(right.rail?.box)}`,
    );
    check(
      "left: the bottom-bar collapse arrow follows the dock",
      left.collapseAction?.label === "Collapse chat" &&
        left.collapseAction?.icon === "lucide-panel-left-close",
      `label ${JSON.stringify(left.collapseAction?.label)}, icon ${JSON.stringify(left.collapseAction?.icon)}`,
    );

    // The track list, read out as well as the boxes: the tracks carry the column
    // widths the panes are built from, and the swap has to move the dock's own
    // column — not merely the boxes standing in them.
    const rightTracks = (right.shell?.gridTemplateColumns ?? "").split(" ");
    const leftTracks = (left.shell?.gridTemplateColumns ?? "").split(" ");
    check(
      "the swapped shell puts the dock's column first",
      rightTracks.length === 3 &&
        leftTracks.length === 3 &&
        leftTracks[0] === rightTracks[0] &&
        parseFloat(leftTracks[1]) === left.tokens.chatTrack &&
        parseFloat(rightTracks[2]) === right.tokens.chatTrack,
      `right tracks ${rightTracks.join(" ")}, left tracks ${leftTracks.join(" ")}`,
    );

    // 3 — collapsed, the dock leaves the grid entirely: no strip at the window's
    // edge, one floating mark in the corner its side asks for, and the sheet takes
    // the column and the seam back. With the dock on the leading side the mark is
    // at the window's bottom left, on the page beside the rail — the rail keeps
    // the corner itself, so the inset is measured from its trailing edge. The
    // launcher is the way in; the titlebar control is still the second one.
    at("collapsed dock");
    await click(".window-titlebar__chat-toggle");
    const dockCollapsed = await settled();
    const collapsedShot = await shot("chat-side-left-collapsed.png");
    check(
      "left/collapsed dock: the panel leaves the layout",
      dockCollapsed.chat === null,
      `dock ${JSON.stringify(dockCollapsed.chat)}`,
    );
    check(
      "left/collapsed dock: its grid column goes to zero",
      parseFloat((dockCollapsed.shell.gridTemplateColumns.split(" ")[1] ?? "NaN")) === 0,
      `tracks ${dockCollapsed.shell.gridTemplateColumns}`,
    );
    check(
      "left/collapsed dock: the sheet takes the whole frame back",
      dockCollapsed.main.box.left === dockCollapsed.tokens.track &&
        dockCollapsed.main.box.right === dockCollapsed.viewport.width,
      `sheet ${JSON.stringify(dockCollapsed.main.box)} in a ${dockCollapsed.viewport.width}px window, rail ends at ${dockCollapsed.tokens.track}px`,
    );
    check(
      "left/collapsed dock: the sheet draws no seam to a dock that is gone",
      isZero(dockCollapsed.main.border.left) &&
        isZero(dockCollapsed.main.border.right),
      `sheet borders left ${dockCollapsed.main.border.left}, right ${dockCollapsed.main.border.right}`,
    );
    check(
      "left/collapsed dock: the agent floats at the bottom left, beside the rail",
      Boolean(dockCollapsed.launcher) &&
        dockCollapsed.launcher.position === "fixed" &&
        dockCollapsed.launcher.box.left < dockCollapsed.viewport.width / 2 &&
        dockCollapsed.launcher.box.top > dockCollapsed.viewport.height / 2 &&
        // The dock's vacated column starts at the rail's trailing edge, and the
        // mark wears the same one-rem inset the trailing arrangement wears.
        dockCollapsed.launcher.box.left ===
          dockCollapsed.tokens.track + dockCollapsed.tokens.rootFontSize &&
        dockCollapsed.viewport.height - dockCollapsed.launcher.box.bottom ===
          dockCollapsed.tokens.frame + dockCollapsed.tokens.rootFontSize,
      `launcher ${JSON.stringify(dockCollapsed.launcher)} in ${JSON.stringify(dockCollapsed.viewport)}`,
    );
    check(
      "left/collapsed dock: the night mark is black on the orange button",
      dockCollapsed.launcher?.color === "rgb(0, 0, 0)",
      `night ink ${JSON.stringify(dockCollapsed.launcher?.color)}`,
    );
    check(
      "left/collapsed dock: the floating mark is the Nous girl",
      Boolean(dockCollapsed.launcher?.mark) &&
        dockCollapsed.launcher.markWidth > 0 &&
        dockCollapsed.launcher.markHeight > 0 &&
        String(dockCollapsed.launcher.markMask).includes("girl_steampunk"),
      `mark ${JSON.stringify(dockCollapsed.launcher?.mark)}, ${dockCollapsed.launcher?.markWidth}x${dockCollapsed.launcher?.markHeight}, mask ${JSON.stringify(dockCollapsed.launcher?.markMask)}`,
    );
    check(
      "left/collapsed dock: the floating mark names the dock it opens",
      dockCollapsed.launcher?.label === "Open Hermes chat" &&
        dockCollapsed.launcher?.title === "Open Hermes chat",
      `label ${JSON.stringify(dockCollapsed.launcher?.label)}, title ${JSON.stringify(dockCollapsed.launcher?.title)}`,
    );
    check(
      "left/collapsed dock: the titlebar control still names the way in",
      dockCollapsed.chatToggle?.label === "Expand chat",
      `titlebar control ${JSON.stringify(dockCollapsed.chatToggle?.label)}`,
    );

    // 3b — the resting and hover fills, read in night mode: the dark theme's
    // accent is a little too bright at rest, so the button steps it down; the
    // hover puts that same accent back, which is the highlight the operator knew.
    at("collapsed launcher hover");
    await hover(".chat-launcher");
    const dockCollapsedHover = await settled();
    const hoverShot = await shot("chat-side-launcher-hover.png");
    check(
      "left/collapsed dock: the resting fill is lowered from the accent",
      dockCollapsed.launcher.background !== dockCollapsed.accentBackground,
      `resting ${dockCollapsed.launcher.background} vs accent ${dockCollapsed.accentBackground}`,
    );
    check(
      "left/collapsed dock: hover is exactly the accent the button used to wear",
      dockCollapsedHover.launcher.background === dockCollapsed.accentBackground,
      `hover ${dockCollapsedHover.launcher.background} vs accent ${dockCollapsed.accentBackground}`,
    );
    await parkPointer();
    await settled();

    // 3c — the same mark in day mode: it keeps the dark gray the paper field
    // needs rather than night's black, and the day button keeps the accent at rest.
    at("collapsed launcher light theme");
    await click(".theme-mode-toggle");
    const dockCollapsedLight = await settled();
    const lightShot = await shot("chat-side-launcher-light.png");
    check(
      "left/collapsed dock: the day theme switches the mark to dark gray",
      dockCollapsedLight.launcher.color !== dockCollapsed.launcher.color &&
        dockCollapsedLight.launcher.color === "rgb(51, 51, 51)",
      `day ink ${dockCollapsedLight.launcher.color} vs night ${dockCollapsed.launcher.color}`,
    );
    check(
      "left/collapsed dock: the day fill is paper, outlined in the accent",
      dockCollapsedLight.launcher.background === dockCollapsedLight.paperBackground &&
        dockCollapsedLight.launcher.background !== dockCollapsedLight.accentBackground &&
        dockCollapsedLight.launcher.borderColor === dockCollapsedLight.accentBackground &&
        parseFloat(dockCollapsedLight.launcher.borderWidth) >= 1,
      `day fill ${dockCollapsedLight.launcher.background} vs paper ${dockCollapsedLight.paperBackground}, outline ${dockCollapsedLight.launcher.borderWidth} ${dockCollapsedLight.launcher.borderColor} vs accent ${dockCollapsedLight.accentBackground}`,
    );
    await click(".theme-mode-toggle");
    const dockCollapsedDarkAgain = await settled();
    check(
      "left/collapsed dock: returning to night restores the lowered fill and black mark",
      dockCollapsedDarkAgain.launcher.background === dockCollapsed.launcher.background &&
        dockCollapsedDarkAgain.launcher.color === dockCollapsed.launcher.color,
      `night ${dockCollapsedDarkAgain.launcher.background}/${dockCollapsedDarkAgain.launcher.color} vs ${dockCollapsed.launcher.background}/${dockCollapsed.launcher.color}`,
    );

    at("reopened dock");
    await click(".chat-launcher");
    const dockReopened = await settled();
    check(
      "reopening from the floating mark lands back on the swapped geometry",
      same(dockReopened.main.box, left.main.box) &&
        same(dockReopened.chat.box, left.chat.box) &&
        dockReopened.launcher === null,
      `sheet ${JSON.stringify(dockReopened.main.box)} vs ${JSON.stringify(left.main.box)}, dock ${JSON.stringify(dockReopened.chat.box)} vs ${JSON.stringify(left.chat.box)}, launcher ${JSON.stringify(dockReopened.launcher)}`,
    );

    // 4 — and with the rail gone the dock inherits the window's leading edge, so
    // the two swaps do not fight over the first track.
    at("collapsed rail");
    await click(".nav-rail .nav-toggle");
    const railCollapsed = await settled();
    check(
      "left/collapsed rail: the rail leaves the grid",
      railCollapsed.rail === null || railCollapsed.rail.display === "none",
      `rail ${JSON.stringify(railCollapsed.rail)}`,
    );
    check(
      "left/collapsed rail: the dock takes the window's leading edge",
      railCollapsed.chat.box.left === 0,
      `dock left ${railCollapsed.chat.box.left}px`,
    );
    check(
      "left/collapsed rail: the panes still abut",
      railCollapsed.chat.box.right === railCollapsed.main.box.left,
      `dock right ${railCollapsed.chat.box.right}px vs sheet left ${railCollapsed.main.box.left}px`,
    );
    check(
      "left/collapsed rail: the sheet still reaches the window's trailing edge",
      railCollapsed.main.box.right === railCollapsed.viewport.width,
      `sheet right ${railCollapsed.main.box.right}px vs window ${railCollapsed.viewport.width}px`,
    );
    check(
      "left/collapsed rail: the dock is still the narrow-ish chat column",
      railCollapsed.chat.box.width === railCollapsed.tokens.chatTrack,
      `dock width ${railCollapsed.chat.box.width}px vs ${railCollapsed.tokens.chatTrack}px`,
    );

    // 4b — both gone: the mark still follows the dock's column, and that column
    // now starts at the window's own leading edge. This is the case a constant
    // inset would get wrong: the rail's width has left the sum.
    at("collapsed rail and dock");
    await click(".window-titlebar__chat-toggle");
    const railAndDockCollapsed = await settled();
    const bothCollapsedShot = await shot("chat-side-collapsed-both.png");
    check(
      "left/collapsed rail + dock: the mark takes the window's leading edge",
      Boolean(railAndDockCollapsed.launcher) &&
        railAndDockCollapsed.launcher.box.left ===
          railAndDockCollapsed.tokens.rootFontSize &&
        railAndDockCollapsed.launcher.box.top >
          railAndDockCollapsed.viewport.height / 2 &&
        railAndDockCollapsed.viewport.height -
          railAndDockCollapsed.launcher.box.bottom ===
          railAndDockCollapsed.tokens.frame +
            railAndDockCollapsed.tokens.rootFontSize,
      `launcher ${JSON.stringify(railAndDockCollapsed.launcher)} with the rail ${JSON.stringify(railAndDockCollapsed.rail)}`,
    );
    at("reopened dock under a collapsed rail");
    await click(".chat-launcher");
    const dockBackUnderCollapsedRail = await settled();
    check(
      "reopening under a collapsed rail lands back on the leading geometry",
      same(dockBackUnderCollapsedRail.chat.box, railCollapsed.chat.box) &&
        same(dockBackUnderCollapsedRail.main.box, railCollapsed.main.box) &&
        dockBackUnderCollapsedRail.launcher === null,
      `dock ${JSON.stringify(dockBackUnderCollapsedRail.chat.box)} vs ${JSON.stringify(railCollapsed.chat.box)}, sheet ${JSON.stringify(dockBackUnderCollapsedRail.main.box)} vs ${JSON.stringify(railCollapsed.main.box)}`,
    );

    at("restored rail");
    await click(".window-titlebar__nav-toggle");
    const railRestored = await settled();
    check(
      "restoring the rail lands back on the swapped geometry",
      same(railRestored.rail?.box, left.rail?.box) &&
        same(railRestored.main.box, left.main.box) &&
        same(railRestored.chat.box, left.chat.box),
      `rail ${JSON.stringify(railRestored.rail?.box)}, sheet ${JSON.stringify(railRestored.main.box)}, dock ${JSON.stringify(railRestored.chat.box)}`,
    );

    // 5 — the round trip: the same click again, and the shell is exactly where it
    // started. Not "close enough": every box, the track list and the controls.
    at("round trip");
    await click(".window-titlebar__side-switch");
    const restored = await settled();
    restored.vaultName = vaultName;
    checkArrangement("restored", restored, "right");
    checkControls("restored", restored, "right");
    for (const [name, before, after] of [
      ["rail", right.rail?.box, restored.rail?.box],
      ["sheet", right.main?.box, restored.main?.box],
      ["dock", right.chat?.box, restored.chat?.box],
      ["switch", right.sideSwitch?.box, restored.sideSwitch?.box],
    ]) {
      check(
        `round trip: the ${name} box is the one the run started from`,
        same(before, after),
        `${name} ${JSON.stringify(after)} vs ${JSON.stringify(before)}`,
      );
    }
    check(
      "round trip: the grid track list is the one the run started from",
      right.shell?.gridTemplateColumns === restored.shell?.gridTemplateColumns,
      `${restored.shell?.gridTemplateColumns} vs ${right.shell?.gridTemplateColumns}`,
    );
    check(
      "round trip: the switch points the other way again",
      restored.sideSwitch?.icon === right.sideSwitch?.icon &&
        restored.sideSwitch?.label === right.sideSwitch?.label &&
        restored.chatToggle?.icon === right.chatToggle?.icon,
      `switch ${restored.sideSwitch?.icon}/${restored.sideSwitch?.label}, collapse ${restored.chatToggle?.icon}`,
    );
    check(
      "round trip: the panes are painted where they started",
      same(restored.owners, right.owners),
      `owners ${JSON.stringify(restored.owners)} vs ${JSON.stringify(right.owners)}`,
    );
    const restoredShot = await shot("chat-side-restored.png");

    // 6 — the dock's own way out: the trailing action of the bottom bar. It has
    // to be in the bottom-right corner, wear the arrow that points out of the
    // side the dock is on, and do exactly what the titlebar control does.
    at("bottom bar collapse");
    const barBox = restored.actions?.box;
    const collapseBox = restored.collapseAction?.box;
    check(
      "restored: the bottom bar carries a collapse control",
      Boolean(restored.collapseAction),
      `collapse action ${JSON.stringify(restored.collapseAction)}`,
    );
    check(
      "restored: the collapse control is the bar's trailing action",
      Boolean(barBox && collapseBox) &&
        collapseBox.left > barBox.left + barBox.width / 2 &&
        collapseBox.right <= barBox.right &&
        barBox.right - collapseBox.right <= 10 &&
        collapseBox.top >= barBox.top &&
        collapseBox.bottom <= barBox.bottom,
      `action ${JSON.stringify(collapseBox)} in bar ${JSON.stringify(barBox)}`,
    );
    check(
      "restored: the bottom-bar collapse names its move and its side",
      restored.collapseAction?.label === "Collapse chat" &&
        restored.collapseAction?.icon === "lucide-panel-right-close",
      `label ${JSON.stringify(restored.collapseAction?.label)}, icon ${JSON.stringify(restored.collapseAction?.icon)}`,
    );

    await click(".chat-panel__action--collapse");
    const barCollapsed = await settled();
    const barCollapsedShot = await shot("chat-side-launcher-right.png");
    check(
      "bottom bar collapse: the panel leaves and the floating mark returns",
      barCollapsed.chat === null &&
        Boolean(barCollapsed.launcher) &&
        barCollapsed.launcher.position === "fixed",
      `dock ${JSON.stringify(barCollapsed.chat)}, launcher ${JSON.stringify(barCollapsed.launcher)}`,
    );
    check(
      "bottom bar collapse: the sheet reclaims the dock's side of the window",
      barCollapsed.main.box.right === barCollapsed.viewport.width &&
        isZero(barCollapsed.main.border.left) &&
        isZero(barCollapsed.main.border.right),
      `sheet ${JSON.stringify(barCollapsed.main.box)} in ${barCollapsed.viewport.width}px, borders ${barCollapsed.main.border.left}/${barCollapsed.main.border.right}`,
    );
    check(
      "bottom bar collapse: the mark keeps the trailing corner for a trailing dock",
      Boolean(barCollapsed.launcher) &&
        barCollapsed.launcher.box.left > barCollapsed.viewport.width / 2 &&
        barCollapsed.launcher.box.top > barCollapsed.viewport.height / 2 &&
        barCollapsed.viewport.width - barCollapsed.launcher.box.right ===
          barCollapsed.tokens.frame + barCollapsed.tokens.rootFontSize &&
        barCollapsed.viewport.height - barCollapsed.launcher.box.bottom ===
          barCollapsed.tokens.frame + barCollapsed.tokens.rootFontSize,
      `launcher ${JSON.stringify(barCollapsed.launcher)} in ${JSON.stringify(barCollapsed.viewport)}`,
    );

    // 6b — the reported gesture: the side is swapped while the dock is already
    // collapsed. There is no dock to watch, so the mark is the only thing on
    // screen that can say which side the chat is on; it has to move with it, and
    // move back, without the dock being reopened in between.
    at("swapped side while collapsed");
    await click(".window-titlebar__side-switch");
    const collapsedSwapped = await settled();
    const collapsedSwappedShot = await shot("chat-side-collapsed-swapped.png");
    check(
      "collapsed swap: the mark follows the dock to the leading edge",
      Boolean(collapsedSwapped.launcher) &&
        collapsedSwapped.launcher.position === "fixed" &&
        collapsedSwapped.launcher.box.left ===
          collapsedSwapped.tokens.track + collapsedSwapped.tokens.rootFontSize &&
        collapsedSwapped.launcher.box.top >
          collapsedSwapped.viewport.height / 2,
      `launcher ${JSON.stringify(collapsedSwapped.launcher)} with ${JSON.stringify(collapsedSwapped.shell?.className)}`,
    );
    check(
      "collapsed swap: the dock is on the leading side and still collapsed",
      collapsedSwapped.chat === null &&
        collapsedSwapped.shell?.className?.includes("shell--chat-left") === true,
      `dock ${JSON.stringify(collapsedSwapped.chat)}, shell ${JSON.stringify(collapsedSwapped.shell?.className)}`,
    );
    at("swapped back while collapsed");
    await click(".window-titlebar__side-switch");
    const collapsedSwappedBack = await settled();
    check(
      "collapsed swap back: the mark returns to the trailing corner",
      Boolean(collapsedSwappedBack.launcher) &&
        same(collapsedSwappedBack.launcher.box, barCollapsed.launcher.box) &&
        collapsedSwappedBack.chat === null,
      `launcher ${JSON.stringify(collapsedSwappedBack.launcher?.box)} vs ${JSON.stringify(barCollapsed.launcher.box)}`,
    );

    at("bottom bar reopen");
    await click(".chat-launcher");
    const barReopened = await settled();
    check(
      "bottom bar collapse: the floating mark opens the same dock back",
      same(barReopened.main.box, restored.main.box) &&
        same(barReopened.chat.box, restored.chat.box) &&
        barReopened.launcher === null,
      `sheet ${JSON.stringify(barReopened.main.box)} vs ${JSON.stringify(restored.main.box)}, dock ${JSON.stringify(barReopened.chat.box)} vs ${JSON.stringify(restored.chat.box)}`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      tokens: right.tokens,
      theme: right.theme,
      right,
      left,
      dockCollapsed,
      dockCollapsedHover,
      dockCollapsedLight,
      dockCollapsedDarkAgain,
      railCollapsed,
      dockReopened,
      railAndDockCollapsed,
      dockBackUnderCollapsedRail,
      railRestored,
      restored,
      barCollapsed,
      collapsedSwapped,
      collapsedSwappedBack,
      barReopened,
      screenshots: [
        rightShot,
        rightSeamShot,
        leftShot,
        leftSeamShot,
        collapsedShot,
        hoverShot,
        lightShot,
        bothCollapsedShot,
        restoredShot,
        barCollapsedShot,
        collapsedSwappedShot,
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

  const reportFile = path.join(artifactsDir, "chat-side.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [["arrangement", "rail L/R", "sheet L/R", "dock L/R", "dock w", "owner BR"]];
  for (const [label, state] of [
    ["dock right", report.right],
    ["dock left", report.left],
    ["left/collapsed dock", report.dockCollapsed],
    ["left/collapsed rail", report.railCollapsed],
    ["round trip", report.restored],
    ["bottom bar collapsed", report.barCollapsed],
  ]) {
    if (!state?.main) continue;
    rows.push([
      label,
      state.rail ? `${state.rail.box.left}/${state.rail.box.right}` : "none",
      `${state.main.box.left}/${state.main.box.right}`,
      state.chat ? `${state.chat.box.left}/${state.chat.box.right}` : "—",
      state.chat ? String(state.chat.box.width) : "—",
      String(state.owners?.bottomRight ?? "—"),
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) {
    console.log(row.map((value, i) => value.padEnd(widths[i])).join("  "));
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat side: PASS" : "chat side: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-side: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
