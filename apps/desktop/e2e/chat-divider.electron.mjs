/**
 * Drives the page/dock divider in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-divider.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-divider.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same geometry, no eyeballing the app required.
 *
 * Input is dispatched through `webContents.sendInputEvent` — the browser's own
 * input pipeline — never through a hand-built pointer event, so the gesture that
 * is measured is the gesture an operator makes. The pointer cannot leave the
 * window, so "drag far past where the dock may go" is a move to the window's own
 * edge: the clamp is what stops the column, and the check is that it stopped
 * where the frame said it must.
 *
 * NOT covered here: whether a real display's pointer capture survives the window
 * losing focus mid-drag (only the operator's own window manager can stage that).
 * The rig's Escape leg covers the cancel path itself.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-divider.html";
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
  const num = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };
  const border = (style) => ({
    top: style.borderTopWidth,
    right: style.borderRightWidth,
    bottom: style.borderBottomWidth,
    left: style.borderLeftWidth
  });

  const shell = document.querySelector(".shell");
  const rail = document.querySelector(".shell > .nav-rail");
  const main = document.querySelector(".shell__main");
  const dock = document.querySelector(".chat-panel");
  const launcher = document.querySelector(".chat-launcher");
  const divider = document.querySelector(".chat-divider");
  const shellStyle = shell ? getComputedStyle(shell) : null;
  const dividerStyle = divider ? getComputedStyle(divider) : null;
  const bar = divider ? getComputedStyle(divider, "::after") : null;
  const mainStyle = main ? getComputedStyle(main) : null;
  const dockStyle = dock ? getComputedStyle(dock) : null;
  const launcherStyle = launcher ? getComputedStyle(launcher) : null;
  const launcherMark = launcher?.querySelector(".chat-launcher__mark") ?? null;
  const railStyle = rail ? getComputedStyle(rail) : null;
  const tracks = shellStyle ? shellStyle.gridTemplateColumns.trim().split(/\\s+/) : [];
  const side = divider ? divider.dataset.side : null;

  // Which pane owns a point on the window: the boxes can be right while the
  // wrong pane is painted there, and the handle's own strip is the one thing that
  // may legitimately be over both.
  const owner = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (divider && (el === divider || divider.contains(el))) return "divider";
    if (rail && rail.contains(el)) return "rail";
    if (launcher && launcher.contains(el)) return "launcher";
    if (main && main.contains(el)) return "sheet";
    if (dock && dock.contains(el)) return "dock";
    return "other";
  };
  const dividerBox = box(divider);
  const midY = dividerBox ? Math.round((dividerBox.top + dividerBox.bottom) / 2) : 0;
  const mainBox = box(main);
  const dockBox = box(dock);

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    },
    tokens: {
      rootChatbarWidth: getComputedStyle(document.documentElement)
        .getPropertyValue("--chatbar-width")
        .trim(),
      frame: num(getComputedStyle(document.documentElement).getPropertyValue("--shell-frame")),
      navWidth: num(
        getComputedStyle(document.documentElement).getPropertyValue("--shell-nav-width")
      )
    },
    shell: shell
      ? {
          box: box(shell),
          className: shell.className,
          clientWidth: shell.clientWidth,
          inlineChatbarWidth: shell.style.getPropertyValue("--chatbar-width") || null,
          chatMin: num(shellStyle.getPropertyValue("--chat-min")),
          chatMax: num(shellStyle.getPropertyValue("--chat-max")),
          chatColumn: shellStyle.getPropertyValue("--chat-column").trim(),
          tracks: tracks.map((track) => Math.round(parseFloat(track))),
          dragging: shell.hasAttribute("data-divider-dragging")
        }
      : null,
    rail: rail ? { box: box(rail), display: railStyle.display } : null,
    main: main
      ? {
          box: mainBox,
          border: border(mainStyle),
          radiusTopLeft: mainStyle.borderTopLeftRadius
        }
      : null,
    dock: dock ? { box: dockBox, border: border(dockStyle), className: dock.className } : null,
    launcher: launcher
      ? {
          box: box(launcher),
          label: launcher.getAttribute("aria-label"),
          position: launcherStyle.position,
          mark: Boolean(launcherMark)
        }
      : null,
    divider: divider
      ? {
          found: true,
          box: dividerBox,
          side,
          role: divider.getAttribute("role"),
          orientation: divider.getAttribute("aria-orientation"),
          label: divider.getAttribute("aria-label"),
          valueNow: num(divider.getAttribute("aria-valuenow")),
          valueMin: num(divider.getAttribute("aria-valuemin")),
          valueMax: num(divider.getAttribute("aria-valuemax")),
          dragging: divider.hasAttribute("data-dragging"),
          border: border(dividerStyle),
          background: dividerStyle.backgroundColor,
          cursor: dividerStyle.cursor,
          focused: document.activeElement === divider,
          hovered: divider.matches(":hover"),
          bar: { left: num(bar.left), width: num(bar.width), opacity: num(bar.opacity) }
        }
      : { found: false },
    // The line the panes actually meet on: the sheet's trailing edge when the dock
    // trails it, the dock's own trailing edge when the dock leads.
    seam: side === "left"
      ? (dockBox ? dockBox.right : null)
      : (mainBox ? mainBox.right : null),
    dockTrack:
      tracks.length === 3 && side
        ? Math.round(parseFloat(tracks[side === "left" ? 1 : 2]))
        : null,
    owners: dividerBox
      ? {
          handleCentre: owner(dividerBox.left + Math.round(dividerBox.width / 2), midY),
          handleLeadingPixel: owner(dividerBox.left + 1, midY),
          sheetInner: mainBox ? owner(mainBox.left + mainBox.width - 30, midY) : null,
          dockInner: dockBox ? owner(dockBox.left + 30, midY) : null
        }
      : null,
    announce: (
      document.querySelector('[data-testid="chat-divider-status"]')?.textContent || ""
    ).trim()
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/**
 * The last step the rig reached: a throw anywhere leaves the catch branch, and
 * without this the failure reads as a bare "Script failed to execute" with no
 * indication of which evaluation produced it.
 */
let step = "start";
const at = (name) => {
  step = name;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One whole arrangement's claims, stated once and read in both directions.
 *
 * `side` names where the dock stands; every number is compared against the
 * report's own measurements rather than against a constant, so a failure says
 * which pane moved and by how much.
 */
function checkArrangement(label, state, side) {
  const dock = state.dock;
  const main = state.main;
  const rail = state.rail;
  const divider = state.divider;
  const viewport = state.viewport;
  const frame = state.tokens.frame;

  check(`${label}: the rail is on screen`, Boolean(rail), "no .nav-rail in the shell");
  check(
    `${label}: the pane abutting the window's trailing edge reaches it`,
    (side === "left" ? main.box.right : dock.box.right) === viewport.width,
    `trailing pane right ${side === "left" ? main.box.right : dock.box.right}px vs window ${viewport.width}px`,
  );
  check(
    `${label}: the two panes abut with no gap and no overlap`,
    side === "left" ? dock.box.right === main.box.left : main.box.right === dock.box.left,
    `dock ${dock.box.left}/${dock.box.right}, sheet ${main.box.left}/${main.box.right}`,
  );

  // The box carries the frame's slack only on the trailing side; the column is
  // the same number either way, and the handle is placed from it.
  const expectedDockWidth = side === "left" ? state.dockTrack : state.dockTrack + frame;
  check(
    `${label}: the dock's box is its column${side === "left" ? "" : " plus the frame's slack"}`,
    dock.box.width === expectedDockWidth,
    `dock width ${dock.box.width}px vs column ${state.dockTrack}px + ${side === "left" ? 0 : frame}px`,
  );
  check(
    `${label}: the column the grid drew is the one the pane stands in`,
    state.dockTrack === (side === "left" ? dock.box.width : dock.box.width - frame),
    `grid column ${state.dockTrack}px vs dock box ${dock.box.width}px`,
  );

  // The seam, the handle and the line: one hairline on the sheet's edge facing
  // the dock, no fill or border of the handle's own, and the handle straddling
  // the line it moves.
  const seam = side === "left" ? main.box.left : main.box.right;
  const hairline = side === "left" ? main.border.left : main.border.right;
  check(
    `${label}: the sheet draws the one hairline on the seam`,
    parseFloat(hairline) > 0 && parseFloat(hairline) <= 1,
    `sheet ${side === "left" ? "left" : "right"} border ${hairline}`,
  );
  check(
    `${label}: the sheet's other edges stay line-free`,
    parseFloat(side === "left" ? main.border.right : main.border.left) === 0 &&
      parseFloat(main.border.top) === 0 &&
      parseFloat(main.border.bottom) === 0,
    `sheet borders t/r/b/l ${main.border.top}/${main.border.right}/${main.border.bottom}/${main.border.left}`,
  );
  check(
    `${label}: the dock paints no line of its own`,
    [dock.border.top, dock.border.right, dock.border.bottom, dock.border.left].every(
      (width) => parseFloat(width) === 0,
    ),
    `dock borders t/r/b/l ${dock.border.top}/${dock.border.right}/${dock.border.bottom}/${dock.border.left}`,
  );
  check(`${label}: the seam is the panes' own edge`, state.seam === seam, `seam ${state.seam}px vs sheet edge ${seam}px`);

  check(
    `${label}: there is a handle on the seam`,
    divider.found === true,
    "no .chat-divider in the shell",
  );
  if (!divider.found) return;
  check(
    `${label}: the handle knows which side it is on`,
    divider.side === side,
    `handle side ${JSON.stringify(divider.side)} with the dock on the ${side}`,
  );
  check(
    `${label}: the handle is the separator a keyboard can reach`,
    divider.role === "separator" && divider.orientation === "vertical",
    `role ${divider.role}, orientation ${divider.orientation}`,
  );
  check(
    `${label}: the handle straddles the seam it moves`,
    divider.box.left === seam - 2 &&
      divider.box.left < seam &&
      divider.box.right > seam,
    `handle ${divider.box.left}..${divider.box.right} around seam ${seam}px`,
  );
  check(
    `${label}: the handle is the thing on its own strip`,
    state.owners.handleCentre === "divider" &&
      state.owners.handleLeadingPixel === "divider",
    `centre ${state.owners.handleCentre}, leading pixel ${state.owners.handleLeadingPixel}`,
  );
  // The boxes can be right while the wrong pane is painted there; both panes have
  // to own their own middle, and the handle must not have quietly become a wall
  // down the page.
  check(
    `${label}: each pane is painted where its box says`,
    state.owners.sheetInner === "sheet" && state.owners.dockInner === "dock",
    `sheet middle ${state.owners.sheetInner}, dock middle ${state.owners.dockInner}`,
  );
  check(
    `${label}: the handle paints no line or fill of its own`,
    [divider.border.top, divider.border.right, divider.border.bottom, divider.border.left].every(
      (width) => parseFloat(width) === 0,
    ) && divider.background === "rgba(0, 0, 0, 0)",
    `handle borders t/r/b/l ${divider.border.top}/${divider.border.right}/${divider.border.bottom}/${divider.border.left}, background ${divider.background}`,
  );
  // The bar it grows when addressed: two pixels, landing on the seam.
  check(
    `${label}: the handle's bar is the two pixels on the seam`,
    divider.bar.width === 2 && divider.bar.left === 1,
    `bar ${divider.bar.left}px in, ${divider.bar.width}px wide`,
  );
  check(
    `${label}: the bar is quiet until it is addressed`,
    divider.dragging ? divider.bar.opacity === 1 : divider.bar.opacity === 0,
    `bar opacity ${divider.bar.opacity} (dragging ${divider.dragging})`,
  );

  // The handle's own value is the column on screen, inside the range the frame
  // declared.
  check(
    `${label}: the handle reports the column it is on`,
    divider.valueNow === state.dockTrack,
    `aria-valuenow ${divider.valueNow}px vs column ${state.dockTrack}px`,
  );
  check(
    `${label}: the handle reports the frame's range`,
    divider.valueMin === state.shell.chatMin &&
      divider.valueMax === state.shell.chatMax &&
      divider.valueNow >= divider.valueMin &&
      divider.valueNow <= divider.valueMax,
    `value ${divider.valueNow} in [${divider.valueMin}, ${divider.valueMax}], shell range [${state.shell.chatMin}, ${state.shell.chatMax}]`,
  );
  check(
    `${label}: the dock's column respects the frame's range in the stylesheet too`,
    state.dockTrack >= state.shell.chatMin && state.dockTrack <= state.shell.chatMax,
    `column ${state.dockTrack}px outside [${state.shell.chatMin}, ${state.shell.chatMax}]`,
  );

  // The page keeps its own floor, and nothing spills sideways.
  check(
    `${label}: the page keeps its floor`,
    main.box.width >= 400,
    `sheet ${main.box.width}px wide`,
  );
  check(
    `${label}: nothing spills past the window`,
    state.doc.scrollWidth <= viewport.width && state.doc.clientWidth <= viewport.width,
    `scrollWidth ${state.doc.scrollWidth}px, clientWidth ${state.doc.clientWidth}px vs window ${viewport.width}px`,
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
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
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const shot = async (name, rect) => {
    const image = await win.webContents.capturePage(rect);
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.chatDividerHarnessReady !== "object") return null;
          await window.chatDividerHarnessReady;
          return typeof window.chatDividerHarnessVaultName === "string"
            ? window.chatDividerHarnessVaultName
            : null;
        })()`);
        if (typeof ready === "string") return ready;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await sleep(250);
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(250);
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settled = async (ms = 220) => {
    await sleep(ms);
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
   * A point on the handle that is really on it. A press is only a press if it
   * lands: `sendInputEvent` at a rect hits whatever is on top there, and a handle
   * under a pane would silently drag nothing.
   */
  const handleCentre = async () => {
    const point = await run(`(() => {
      const el = document.querySelector(".chat-divider");
      if (!el) return { error: "no handle" };
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        inside: Boolean(hit && (hit === el || el.contains(hit))),
        hit: hit ? (typeof hit.className === "string" && hit.className ? hit.className : hit.tagName) : null
      };
    })()`);
    if (point.error) throw new Error(`no handle to press: ${point.error}`);
    if (!point.inside) {
      throw new Error(
        `the handle's own centre is not on it (it hits ${JSON.stringify(point.hit)})`,
      );
    }
    return point;
  };

  /**
   * One drag through the browser's input pipeline.
   *
   * The press lands on the handle's centre and the pointer walks to the target in
   * steps, because a single jump would let a handler that only heard `up` pass the
   * geometry that follows. The target is clamped to the window: a pointer cannot
   * leave it, and "past the end of the range" is the window's own edge.
   */
  const dragBy = async (dx, { onHold } = {}) => {
    const point = await handleCentre();
    const target = Math.round(
      Math.max(1, Math.min(DEFAULT_SIZE.width - 2, point.x + dx)),
    );
    mouse("mouseDown", point.x, point.y);
    await sleep(40);
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      mouse("mouseMove", Math.round(point.x + ((target - point.x) * i) / steps), point.y);
      await sleep(16);
    }
    if (onHold) await onHold();
    mouse("mouseUp", target, point.y);
    await sleep(120);
    // Park the pointer off the seam. The handle travels with the hand, so after a
    // drag the pointer is usually still standing on it — and a rig that sampled
    // the handle's hover state from there would be measuring the gesture it just
    // made rather than the state it left behind.
    await park();
    await sleep(80);
    return { from: point.x, to: target, travelled: target - point.x };
  };

  /** Move the pointer off the seam and off every control: no hover, no press. */
  const park = async () => {
    mouse("mouseMove", 4, 4);
    await sleep(30);
  };

  const screenshots = [];
  let report;
  const timeout = setTimeout(() => {
    console.error("chat-divider: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    win.showInactive();

    // ── 1. The instrument, before the claim ────────────────────────────────
    at("shipped arrangement");
    const shipped = await settled();
    shipped.vaultName = vaultName;
    checkArrangement("shipped", shipped, "right");
    check(
      "shipped: the dock is on the trailing side",
      shipped.shell.className.includes("shell--chat-right"),
      `shell classes ${shipped.shell.className}`,
    );
    check(
      "shipped: the width is still the tokens' before anybody drags it",
      shipped.shell.inlineChatbarWidth === null,
      `inline --chatbar-width ${JSON.stringify(shipped.shell.inlineChatbarWidth)}`,
    );
    check(
      "shipped: the dock's column is the token's own width",
      same([shipped.tokens.rootChatbarWidth, shipped.dockTrack], [
        shipped.tokens.rootChatbarWidth,
        shipped.dockTrack,
      ]) && shipped.dockTrack > 0,
      `token ${shipped.tokens.rootChatbarWidth} → column ${shipped.dockTrack}px`,
    );
    screenshots.push(await shot("chat-divider-shipped.png"));

    // ── 1b. The hover: the cursor is the offer, and nothing is drawn ───────
    at("hovering the seam");
    const hoverPoint = await handleCentre();
    mouse("mouseMove", hoverPoint.x, hoverPoint.y);
    // The bar has no hover state to settle into; this only lets the pointer's
    // own :hover land, so the sample below is not reading the frame before it.
    await sleep(220);
    const hover = await settled(0);
    hover.vaultName = vaultName;
    checkArrangement("hover", hover, "right");
    check(
      "hover: the pointer is really on the handle",
      hover.divider.hovered === true,
      `handle :hover ${hover.divider.hovered}`,
    );
    check(
      "hover: the handle still offers the column-resize cursor",
      hover.divider.cursor === "col-resize",
      `cursor ${JSON.stringify(hover.divider.cursor)}`,
    );
    check(
      "hover: the handle draws no accent bar",
      hover.divider.bar.opacity === 0,
      `bar opacity ${hover.divider.bar.opacity}`,
    );
    screenshots.push(
      await shot("chat-divider-hover.png", {
        x: Math.max(0, shipped.seam - 60),
        y: Math.max(0, shipped.tokens.frame + 60),
        width: 120,
        height: 160,
      }),
    );
    await park();
    await sleep(80);

    // ── 2. The drag: the seam follows the hand, 1:1 and the right way round ─
    at("drag the trailing dock narrower");
    const narrower = await dragBy(40, {
      // A crop of the handle under the hand: the accent bar only exists while it
      // is being addressed, so this is the one moment it can be photographed.
      onHold: async () => {
        screenshots.push(
          await shot("chat-divider-handle-held.png", {
            x: Math.max(0, shipped.seam - 60),
            y: Math.max(0, shipped.tokens.frame + 60),
            width: 120,
            height: 160,
          }),
        );
      },
    });
    const afterNarrower = await settled();
    afterNarrower.vaultName = vaultName;
    checkArrangement("narrower", afterNarrower, "right");
    check(
      "narrower: the seam tracked the pointer one for one",
      afterNarrower.seam - shipped.seam === narrower.travelled,
      `seam moved ${afterNarrower.seam - shipped.seam}px for a pointer that travelled ${narrower.travelled}px`,
    );
    check(
      "narrower: dragging the trailing dock towards the page narrowed it",
      afterNarrower.dockTrack === shipped.dockTrack - narrower.travelled,
      `column ${shipped.dockTrack} → ${afterNarrower.dockTrack}px for ${narrower.travelled}px of travel`,
    );
    check(
      "narrower: the page took the room the dock gave up",
      afterNarrower.main.box.width === shipped.main.box.width + narrower.travelled,
      `sheet ${shipped.main.box.width} → ${afterNarrower.main.box.width}px`,
    );
    check(
      "narrower: the committed width is in the shell's own style",
      afterNarrower.shell.inlineChatbarWidth === `${afterNarrower.dockTrack}px`,
      `inline --chatbar-width ${JSON.stringify(afterNarrower.shell.inlineChatbarWidth)} vs column ${afterNarrower.dockTrack}px`,
    );
    check(
      "narrower: the gesture said what it did",
      afterNarrower.announce === `Chat dock ${afterNarrower.dockTrack} pixels wide.`,
      `status ${JSON.stringify(afterNarrower.announce)}`,
    );
    check(
      "narrower: the drag state is gone once the pointer is up",
      afterNarrower.shell.dragging === false && afterNarrower.divider.dragging === false,
      `shell dragging ${afterNarrower.shell.dragging}, handle dragging ${afterNarrower.divider.dragging}`,
    );
    check(
      "narrower: the token itself was not touched",
      afterNarrower.tokens.rootChatbarWidth === shipped.tokens.rootChatbarWidth,
      `token ${afterNarrower.tokens.rootChatbarWidth} vs ${shipped.tokens.rootChatbarWidth}`,
    );

    // ── 3. The floor: the dock cannot be squeezed out of existence ─────────
    at("floor of the range");
    await dragBy(5000);
    const floor = await settled();
    floor.vaultName = vaultName;
    checkArrangement("floor", floor, "right");
    check(
      "floor: the drag stopped at the frame's own minimum",
      floor.dockTrack === floor.shell.chatMin && floor.shell.chatMin === floor.divider.valueMin,
      `column ${floor.dockTrack}px, min ${floor.shell.chatMin}px`,
    );
    check(
      "floor: the page kept its floor",
      floor.main.box.width >= 400,
      `sheet ${floor.main.box.width}px wide`,
    );
    screenshots.push(await shot("chat-divider-right-floor.png"));

    // ── 4. The ceiling: the dock cannot be dragged over the page ───────────
    at("ceiling of the range");
    await dragBy(-5000);
    const ceiling = await settled();
    ceiling.vaultName = vaultName;
    checkArrangement("ceiling", ceiling, "right");
    check(
      "ceiling: the drag stopped at the frame's own maximum",
      ceiling.dockTrack === ceiling.shell.chatMax &&
        ceiling.shell.chatMax === ceiling.divider.valueMax,
      `column ${ceiling.dockTrack}px, max ${ceiling.shell.chatMax}px`,
    );
    check(
      "ceiling: the page still has its floor and no less",
      ceiling.main.box.width >= 400,
      `sheet ${ceiling.main.box.width}px wide`,
    );
    check(
      "ceiling: the dock never takes more than the ratio allows",
      ceiling.dockTrack <= Math.round(ceiling.shell.clientWidth * 0.7),
      `column ${ceiling.dockTrack}px vs 70% of ${ceiling.shell.clientWidth}px`,
    );
    screenshots.push(await shot("chat-divider-right-ceiling.png"));

    // ── 5. Back off the bound: the drag is not stuck at an end ─────────────
    at("back off the ceiling");
    await dragBy(160);
    const eased = await settled();
    eased.vaultName = vaultName;
    checkArrangement("eased", eased, "right");
    check(
      "eased: a drag away from the ceiling moves the column again",
      eased.dockTrack === ceiling.dockTrack - 160,
      `column ${ceiling.dockTrack} → ${eased.dockTrack}px for 160px of travel`,
    );

    // ── 6. The swap: a width the operator chose travels with the dock ──────
    at("swapped arrangement");
    await click(".window-titlebar__side-switch");
    const swapped = await settled();
    swapped.vaultName = vaultName;
    checkArrangement("swapped", swapped, "left");
    check(
      "swapped: the dock is on the leading side",
      swapped.shell.className.includes("shell--chat-left"),
      `shell classes ${swapped.shell.className}`,
    );
    check(
      "swapped: the width travelled with the dock",
      swapped.dockTrack === eased.dockTrack,
      `column ${eased.dockTrack}px → ${swapped.dockTrack}px across the swap`,
    );
    check(
      "swapped: the dock leads the page, against the rail",
      swapped.dock.box.left === swapped.rail.box.right &&
        swapped.dock.box.width === swapped.dockTrack,
      `dock ${swapped.dock.box.left}/${swapped.dock.box.width}px vs rail right ${swapped.rail.box.right}px and column ${swapped.dockTrack}px`,
    );
    check(
      "swapped: the range did not change with the side",
      swapped.shell.chatMin === eased.shell.chatMin &&
        swapped.shell.chatMax === eased.shell.chatMax,
      `range [${swapped.shell.chatMin}, ${swapped.shell.chatMax}] vs [${eased.shell.chatMin}, ${eased.shell.chatMax}]`,
    );
    screenshots.push(await shot("chat-divider-swapped.png"));

    // ── 7. The same gesture, the other way round ───────────────────────────
    at("drag the leading dock wider");
    const swapDrag = await dragBy(120);
    const swapWider = await settled();
    swapWider.vaultName = vaultName;
    checkArrangement("swapped/wider", swapWider, "left");
    check(
      "swapped/wider: the seam tracked the pointer one for one",
      swapWider.seam - swapped.seam === swapDrag.travelled,
      `seam moved ${swapWider.seam - swapped.seam}px for a pointer that travelled ${swapDrag.travelled}px`,
    );
    check(
      "swapped/wider: dragging the leading dock away from the page widened it",
      swapWider.dockTrack === swapped.dockTrack + swapDrag.travelled,
      `column ${swapped.dockTrack} → ${swapWider.dockTrack}px for ${swapDrag.travelled}px of travel`,
    );
    check(
      "swapped/wider: the page gave up the room",
      swapWider.main.box.width === swapped.main.box.width - swapDrag.travelled,
      `sheet ${swapped.main.box.width} → ${swapWider.main.box.width}px`,
    );

    at("leading ceiling");
    await dragBy(5000);
    const swapCeiling = await settled();
    swapCeiling.vaultName = vaultName;
    checkArrangement("swapped/ceiling", swapCeiling, "left");
    check(
      "swapped/ceiling: the leading dock is held to the same ceiling",
      swapCeiling.dockTrack === swapCeiling.shell.chatMax,
      `column ${swapCeiling.dockTrack}px vs max ${swapCeiling.shell.chatMax}px`,
    );
    at("leading floor");
    await dragBy(-5000);
    const swapFloor = await settled();
    swapFloor.vaultName = vaultName;
    checkArrangement("swapped/floor", swapFloor, "left");
    check(
      "swapped/floor: the leading dock is held to the same floor",
      swapFloor.dockTrack === swapFloor.shell.chatMin,
      `column ${swapFloor.dockTrack}px vs min ${swapFloor.shell.chatMin}px`,
    );
    screenshots.push(await shot("chat-divider-left-floor.png"));

    // ── 8. The collapse: the tab does not throw the width away ─────────────
    at("collapsed dock");
    await click(".window-titlebar__chat-toggle");
    const collapsed = await settled();
    collapsed.vaultName = vaultName;
    check(
      "collapsed: the dock is no longer a pane in the grid",
      collapsed.dock === null && collapsed.shell.chatColumn === "0px",
      `dock ${JSON.stringify(collapsed.dock)}, chat column ${JSON.stringify(collapsed.shell.chatColumn)}`,
    );
    check(
      "collapsed: there is no handle without a seam",
      collapsed.divider.found === false,
      `handle ${JSON.stringify(collapsed.divider)}`,
    );
    check(
      "collapsed: the width is remembered, not reset",
      collapsed.shell.inlineChatbarWidth === `${swapFloor.dockTrack}px`,
      `inline --chatbar-width ${JSON.stringify(collapsed.shell.inlineChatbarWidth)} vs ${swapFloor.dockTrack}px`,
    );
    check(
      "collapsed: the agent is one floating mark at the bottom right",
      Boolean(collapsed.launcher) &&
        collapsed.launcher.position === "fixed" &&
        collapsed.launcher.mark === true &&
        collapsed.launcher.label === "Open Hermes chat" &&
        collapsed.launcher.box.left > collapsed.viewport.width / 2 &&
        collapsed.launcher.box.top > collapsed.viewport.height / 2,
      `launcher ${JSON.stringify(collapsed.launcher)}`,
    );
    screenshots.push(await shot("chat-divider-collapsed.png"));

    at("reopened dock");
    await click(".chat-launcher");
    const reopened = await settled();
    reopened.vaultName = vaultName;
    checkArrangement("reopened", reopened, "left");
    check(
      "reopened: the dock comes back the width it was left",
      reopened.dockTrack === swapFloor.dockTrack,
      `column ${reopened.dockTrack}px vs ${swapFloor.dockTrack}px`,
    );

    // ── 9. The keyboard: a separator's arrows, in the same range ───────────
    // The arrows move the DIVIDER, the way it points — the window-splitter
    // pattern, and the only reading that does not flip meaning with the side. On
    // the leading side that makes ArrowRight the wider dock; on the trailing side
    // it is the narrower one, and the last leg below reads exactly that.
    at("keyboard");
    const focused = await run(`(() => {
      const el = document.querySelector(".chat-divider");
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    })()`);
    check("keyboard: the handle can hold focus", focused === true, "focus() did not land on the handle");
    key("Right");
    await sleep(120);
    const keyWider = await settled();
    checkArrangement("keyboard/wider", keyWider, "left");
    check(
      "keyboard: ArrowRight moved the leading dock wider by one step",
      keyWider.dockTrack === reopened.dockTrack + 16,
      `column ${reopened.dockTrack} → ${keyWider.dockTrack}px`,
    );
    check(
      "keyboard: the press is committed and announced",
      keyWider.shell.inlineChatbarWidth === `${keyWider.dockTrack}px` &&
        keyWider.announce === `Chat dock ${keyWider.dockTrack} pixels wide.`,
      `inline ${JSON.stringify(keyWider.shell.inlineChatbarWidth)}, status ${JSON.stringify(keyWider.announce)}`,
    );
    check(
      "keyboard: the handle kept the focus it was given",
      keyWider.divider.focused === true,
      "the handle lost focus to the key press",
    );
    key("Left");
    await sleep(120);
    const keyBack = await settled();
    check(
      "keyboard: ArrowLeft moved it back",
      keyBack.dockTrack === reopened.dockTrack,
      `column ${keyWider.dockTrack} → ${keyBack.dockTrack}px`,
    );
    key("Left");
    await sleep(120);
    const keyFloor = await settled();
    checkArrangement("keyboard/floor", keyFloor, "left");
    check(
      "keyboard: at the floor the press says so and changes nothing",
      keyFloor.dockTrack === keyFloor.shell.chatMin &&
        keyFloor.announce === "The chat dock is already as narrow as it goes.",
      `column ${keyFloor.dockTrack}px, min ${keyFloor.shell.chatMin}px, status ${JSON.stringify(keyFloor.announce)}`,
    );

    // ── 10. A cancelled gesture is not a width ─────────────────────────────
    at("cancelled drag");
    const held = await handleCentre();
    mouse("mouseDown", held.x, held.y);
    await sleep(40);
    mouse("mouseMove", Math.round(held.x + 200), held.y);
    // The bar fades in over 120 ms; wait the ramp out, because the claim below is
    // the state it settles in rather than the frame it passed through.
    await sleep(220);
    const midDrag = await settled(0);
    check(
      "cancelled: the pane really did move under the hand",
      midDrag.dockTrack > keyFloor.dockTrack && midDrag.shell.dragging === true,
      `column ${keyFloor.dockTrack} → ${midDrag.dockTrack}px, shell dragging ${midDrag.shell.dragging}`,
    );
    check(
      "cancelled: the bar shows while the hand is on the seam",
      midDrag.divider.bar.opacity === 1 && midDrag.divider.dragging === true,
      `bar opacity ${midDrag.divider.bar.opacity}, handle dragging ${midDrag.divider.dragging}`,
    );
    key("Escape");
    await sleep(120);
    mouse("mouseUp", held.x + 200, held.y);
    await sleep(180);
    const cancelled = await settled();
    cancelled.vaultName = vaultName;
    checkArrangement("cancelled", cancelled, "left");
    check(
      "cancelled: the column went back where the gesture found it",
      cancelled.dockTrack === keyFloor.dockTrack &&
        cancelled.shell.inlineChatbarWidth === `${keyFloor.dockTrack}px`,
      `column ${cancelled.dockTrack}px vs ${keyFloor.dockTrack}px, inline ${JSON.stringify(cancelled.shell.inlineChatbarWidth)}`,
    );
    check(
      "cancelled: nothing was left mid-gesture",
      cancelled.shell.dragging === false && cancelled.divider.dragging === false,
      `shell dragging ${cancelled.shell.dragging}, handle dragging ${cancelled.divider.dragging}`,
    );
    check(
      "cancelled: the cancel said so",
      cancelled.announce === "Width change cancelled.",
      `status ${JSON.stringify(cancelled.announce)}`,
    );

    // ── 11. And the round trip: the same click, the same pane, the width kept ─
    at("round trip");
    await click(".window-titlebar__side-switch");
    const restored = await settled();
    restored.vaultName = vaultName;
    checkArrangement("restored", restored, "right");
    check(
      "round trip: the dock is back on the trailing side",
      restored.shell.className.includes("shell--chat-right") &&
        restored.divider.side === "right",
      `shell classes ${restored.shell.className}, handle side ${restored.divider.side}`,
    );
    check(
      "round trip: the operator's width came back with it",
      restored.dockTrack === cancelled.dockTrack &&
        restored.seam === restored.main.box.right,
      `column ${restored.dockTrack}px vs ${cancelled.dockTrack}px, seam ${restored.seam}px vs sheet right ${restored.main.box.right}px`,
    );
    screenshots.push(await shot("chat-divider-restored.png"));

    // The same arrow on the other side of the swap, and the reason the contract
    // is stated as "the divider moves where you point it": ArrowLeft is the wider
    // dock on the trailing side and the narrower one on the leading side.
    at("keyboard on the trailing side");
    await run(`(() => {
      document.querySelector(".chat-divider")?.focus();
      return true;
    })()`);
    key("Left");
    await sleep(120);
    const keyTrailing = await settled();
    keyTrailing.vaultName = vaultName;
    checkArrangement("keyboard/trailing", keyTrailing, "right");
    check(
      "keyboard/trailing: ArrowLeft moved the trailing dock wider by one step",
      keyTrailing.dockTrack === restored.dockTrack + 16,
      `column ${restored.dockTrack} → ${keyTrailing.dockTrack}px`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      tokens: shipped.tokens,
      shipped,
      hover,
      narrower,
      afterNarrower,
      floor,
      ceiling,
      eased,
      swapped,
      swapDrag,
      swapWider,
      swapCeiling,
      swapFloor,
      collapsed,
      reopened,
      keyWider,
      keyBack,
      keyFloor,
      midDrag,
      cancelled,
      restored,
      keyTrailing,
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
        `threw at ${step}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "chat-divider.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [
    ["state", "side", "dock track", "dock box", "sheet", "seam", "divider", "range"],
  ];
  for (const [label, state] of [
    ["shipped", report.shipped],
    ["narrower", report.afterNarrower],
    ["floor", report.floor],
    ["ceiling", report.ceiling],
    ["eased", report.eased],
    ["swapped", report.swapped],
    ["swapped/wider", report.swapWider],
    ["collapsed", report.collapsed],
    ["reopened", report.reopened],
    ["keyboard/floor", report.keyFloor],
    ["cancelled", report.cancelled],
    ["restored", report.restored],
    ["keyboard/trailing", report.keyTrailing],
  ]) {
    if (!state?.dock) continue;
    rows.push([
      label,
      state.divider?.side ?? "—",
      String(state.dockTrack ?? "—"),
      `${state.dock.box.left}/${state.dock.box.right}`,
      `${state.main.box.left}/${state.main.box.right}`,
      String(state.seam ?? "—"),
      String(state.divider?.valueNow ?? "—"),
      state.shell ? `${state.shell.chatMin}–${state.shell.chatMax}` : "—",
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) {
    console.log(row.map((value, i) => value.padEnd(widths[i])).join("  "));
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat divider: PASS" : "chat divider: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-divider: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
