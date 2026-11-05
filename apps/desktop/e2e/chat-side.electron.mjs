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
 * the swap has to survive (a collapsed dock on either side, the rail shrunk to
 * its thin icon column, and both at once) and the round trip back to where it
 * started. The rail never leaves the layout, so a collapsed rail is measured as
 * a 56px track the dock follows, not as a window edge the dock inherits.
 *
 * NOT covered here: whether Windows lets a click through the titlebar's drag
 * band. The switch is no longer in that band — it moved into the dock's bottom
 * action bar, which is ordinary content — so the `-webkit-app-region` carve-out
 * is not in its path. The titlebar controls the rig clicks (the theme toggle)
 * are the ones that still rely on that carve-out.
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
  // The rail's collapsed track, read the same way: a collapsed rail keeps a
  // column of its own, so the rig compares the dock's start against a number
  // rather than assuming the first track is zero.
  probe.style.width = "var(--shell-nav-width-collapsed)";
  const collapsedTrack = probe.offsetWidth;
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

  // The muted ink the bottom bar's actions rest in, resolved the same way as the
  // fills above so the side switch is compared against the token the CSS uses
  // rather than a hard-coded colour.
  const mutedProbe = document.createElement("div");
  mutedProbe.style.background = "var(--muted)";
  document.body.appendChild(mutedProbe);
  const mutedBackground = getComputedStyle(mutedProbe).backgroundColor;
  mutedProbe.remove();

  const rail = document.querySelector(".nav-rail");
  const main = document.querySelector(".shell__main");
  const chat = document.querySelector(".chat-panel");
  const launcher = document.querySelector(".chat-launcher");
  const actions = document.querySelector(".chat-panel__actions");
  const collapseAction = document.querySelector(".chat-panel__action--collapse");
  // The build number now lives in the dock's bottom bar, right of the collapse
  // control: the bar's last control holds the window's bottom-right end.
  const versionBadge = document.querySelector(".update-badge");
  const shell = document.querySelector(".shell");
  const titlebar = document.querySelector(".window-titlebar");
  // The vault chip lives in the rail's foot now, one half of the footer row
  // beside Log. Its name is read from the chip's own name span, not the button's
  // text: the collapsed initials are in the DOM in both states, so the button's
  // textContent would join the two words together.
  const vault = document.querySelector(".nav-rail__vault");
  const trailing = document.querySelector(".window-titlebar__trailing");
  // The switch moved into the dock's bottom action bar; the titlebar no longer
  // carries it or the old collapse toggle, and the SAMPLE keeps both facts so
  // the assertions can say "here" and "not there" rather than only one.
  const sideSwitch = document.querySelector('[data-testid="chat-side-switch"]');
  // The shortcuts reference moved into this same bar, beside the switch: the
  // titlebar carries it no more, so both facts are sampled.
  const shortcutsAction = document.querySelector('[data-testid="chat-shortcuts-action"]');
  const staleTitlebar = {
    side: Boolean(document.querySelector(".window-titlebar__side-switch")),
    collapse: Boolean(document.querySelector(".window-titlebar__chat-toggle")),
    shortcuts: Boolean(document.querySelector(".window-titlebar__shortcuts")),
  };
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
      collapsedTrack,
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
    vaultText: (vault?.querySelector(".nav-rail__vault-name")?.textContent || "").trim(),
    accentBackground,
    paperBackground,
    mutedBackground,
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
          // The bar's own action buttons; the version badge is a control in the
          // same row but not one of the dock's surface actions, so it is measured
          // separately below.
          controls: Array.from(actions.querySelectorAll(".chat-panel__action")).map((el) => ({
            label: el.getAttribute("aria-label"),
            icon: iconClass(el),
            disabled: el.disabled
          })),
          badge: versionBadge
            ? {
                label: versionBadge.getAttribute("aria-label"),
                text: (versionBadge.textContent || "").trim(),
                box: box(versionBadge)
              }
            : null
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
          background: getComputedStyle(sideSwitch).backgroundColor,
          color: getComputedStyle(sideSwitch).color,
          icon: iconClass(sideSwitch),
          box: box(sideSwitch)
        }
      : { found: false },
    shortcutsAction: shortcutsAction
      ? {
          found: true,
          label: shortcutsAction.getAttribute("aria-label"),
          title: shortcutsAction.getAttribute("title"),
          pressed: shortcutsAction.getAttribute("aria-pressed"),
          icon: iconClass(shortcutsAction),
          box: box(shortcutsAction)
        }
      : { found: false },
    staleTitlebar,
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
    `${label}: the rail's vault chip wears the vault's name`,
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

  // Both panes meet the strip directly and reach the window's bottom edge.
  for (const [name, pane] of [
    ["sheet", main],
    ["dock", chat],
  ]) {
    check(
      `${label}: the ${name} meets the strip with no gap`,
      pane?.box.top === titlebarHeight,
      `${name} top ${pane?.box.top}px vs strip bottom ${titlebarHeight}px`,
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

  // The sheet is square on every corner: it is a pane, not a card, and no corner
  // of it is notched out of the mat — in either arrangement.
  for (const [corner, radius] of [
    ["leading top", main?.radius?.topLeft],
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
 * Where the controls live. The titlebar's trailing cluster ends at the settings
 * menu — no chat control rides the drag band any more — and the dock's bottom
 * action bar carries the side switch immediately before the collapse it belongs
 * with, in the order the bar ships.
 */
function checkControls(label, state, side) {
  const controls = state.trailing?.controls ?? [];
  const classes = controls.map((control) => control.className);
  const expectedSwitchLabel =
    side === "left"
      ? "Move chat to the right of the page"
      : "Move chat to the left of the page";

  // The titlebar's trailing cluster is the theme control and the settings menu.
  // The keyboard-shortcuts control, like the two chat controls that left before
  // it, now lives in the dock's own bar; a stale copy anywhere in the strip is
  // the regression this guards, because a "contained" control is not a correctly
  // placed one.
  const expectedTrailing = ["theme-mode-toggle", "settings-menu"];
  check(
    `${label}: the titlebar's trailing cluster is theme, shortcuts, settings`,
    controls.length === expectedTrailing.length &&
      expectedTrailing.every((needle, index) =>
        String(classes[index] ?? "").includes(needle),
      ),
    `cluster ${JSON.stringify(classes)}`,
  );
  check(
    `${label}: the titlebar carries no chat side switch`,
    state.staleTitlebar?.side === false,
    "a .window-titlebar__side-switch is still in the strip",
  );
  check(
    `${label}: the titlebar carries no chat collapse toggle`,
    state.staleTitlebar?.collapse === false,
    "a .window-titlebar__chat-toggle is still in the strip",
  );
  check(
    `${label}: the titlebar carries no keyboard-shortcuts control`,
    state.staleTitlebar?.shortcuts === false,
    "a .window-titlebar__shortcuts is still in the strip",
  );

  // The switch itself, inside the open dock's bottom bar.
  check(
    `${label}: the switch is in the dock's bottom action bar`,
    state.sideSwitch?.found === true,
    "no [data-testid=chat-side-switch] while the dock is open",
  );
  check(
    `${label}: the switch carries an icon of its own`,
    state.sideSwitch?.icon === "lucide-arrow-left-right",
    `switch icon ${JSON.stringify(state.sideSwitch?.icon)}`,
  );
  check(
    `${label}: the switch names the move it makes`,
    state.sideSwitch?.label === expectedSwitchLabel,
    `switch label ${JSON.stringify(state.sideSwitch?.label)}`,
  );
  // The switch is a move, not a toggle: it names the direction the next click
  // takes the dock and must rest as bar chrome on either side. A highlighted
  // switch would read as "active" for an operator whose dock simply lives on
  // the leading edge, so no side may carry a pressed fill.
  check(
    `${label}: the switch carries no pressed state`,
    state.sideSwitch?.pressed === null,
    `aria-pressed ${JSON.stringify(state.sideSwitch?.pressed)} with the dock on the ${side}`,
  );
  check(
    `${label}: the switch rests neutral`,
    state.sideSwitch?.background === "rgba(0, 0, 0, 0)" &&
      state.sideSwitch?.color === state.mutedBackground,
    `background ${JSON.stringify(state.sideSwitch?.background)} (want transparent), ink ${JSON.stringify(state.sideSwitch?.color)} vs muted ${JSON.stringify(state.mutedBackground)}`,
  );

  // The bar's order, read off the DOM rather than off the pixels: the new-chat
  // slot, the chain, then the trailing trio — the shortcuts reference, the side
  // switch and the way out. "Chat history" left the bar with the list surface,
  // so its return is a stale slot rather than a shipped one.
  const barLabels = (state.actions?.controls ?? []).map((control) => control.label);
  check(
    `${label}: the bar carries its five actions in order`,
    same(barLabels, [
      "New chat",
      "Life-Chain",
      "Keyboard shortcuts",
      expectedSwitchLabel,
      "Collapse chat",
    ]),
    `bar ${JSON.stringify(barLabels)}`,
  );
  check(
    `${label}: the shortcuts control sits immediately before the switch`,
    state.shortcutsAction?.found === true &&
      state.shortcutsAction?.label === "Keyboard shortcuts" &&
      state.shortcutsAction?.icon === "lucide-keyboard" &&
      Boolean(state.shortcutsAction?.box && state.sideSwitch?.box) &&
      state.shortcutsAction.box.right < state.sideSwitch.box.left &&
      state.sideSwitch.box.left - state.shortcutsAction.box.right <= 8 &&
      Boolean(state.actions?.box) &&
      state.shortcutsAction.box.top >= state.actions.box.top &&
      state.shortcutsAction.box.bottom <= state.actions.box.bottom,
    `shortcuts ${JSON.stringify(state.shortcutsAction)} vs switch ${JSON.stringify(state.sideSwitch?.box)}`,
  );
  check(
    `${label}: the switch sits immediately before the collapse control`,
    Boolean(state.actions?.box && state.sideSwitch?.box && state.collapseAction?.box) &&
      state.sideSwitch.box.right < state.collapseAction.box.left &&
      state.collapseAction.box.left - state.sideSwitch.box.right <= 8 &&
      state.sideSwitch.box.top >= state.actions.box.top &&
      state.sideSwitch.box.bottom <= state.actions.box.bottom &&
      state.sideSwitch.box.right <= state.actions.box.right,
    `switch ${JSON.stringify(state.sideSwitch?.box)} vs collapse ${JSON.stringify(state.collapseAction?.box)} in bar ${JSON.stringify(state.actions?.box)}`,
  );

  // The collapse arrow points out of the pane it closes, on whichever side the
  // dock stands.
  check(
    `${label}: the collapse control's arrow follows the dock`,
    state.collapseAction?.icon ===
      `lucide-panel-${side === "left" ? "left" : "right"}-close`,
    `collapse icon ${JSON.stringify(state.collapseAction?.icon)} with the dock on the ${side}`,
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

  // The dock's bottom action bar, 1:1: the side switch lives here and nowhere
  // else, so this crop is the picture the neutral-rest claim is about.
  const barCrop = (state) => {
    const bar = state.actions?.box;
    if (!bar) return undefined;
    const x = Math.max(0, bar.left);
    const y = Math.max(0, bar.top);
    return {
      x,
      y,
      width: Math.min(bar.width, state.viewport.width - x),
      height: Math.min(bar.height, state.viewport.height - y),
    };
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
    // The switch is checked for its resting look, not a hover: park the pointer
    // in the window's leading corner before the first sample.
    await parkPointer();

    at("shipped arrangement");
    const right = await settled();
    right.vaultName = vaultName;
    const { height: viewportHeight, width: viewportWidth } = right.viewport;
    const rightShot = await shot("chat-side-right.png");
    const rightBarShot = await shot("chat-side-right-bar.png", barCrop(right));
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

    // 2 — one click on the dock's own switch, and the two panes trade places.
    at("swapped arrangement");
    await click('[data-testid="chat-side-switch"]');
    const left = await settled();
    left.vaultName = vaultName;
    const leftShot = await shot("chat-side-left.png");
    const leftBarShot = await shot("chat-side-left-bar.png", barCrop(left));
    // The same seam, one column to the right and now between the dock and the
    // sheet: the arrangement's two visual claims — the one hairline and the
    // square corner above it — in a single crop.
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
    // launcher is the only way in: the dock's own bar, and with it the side
    // switch and the collapse control, is not rendered while the pane is gone.
    at("collapsed dock");
    await click('[data-testid="chat-collapse"]');
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
      "left/collapsed dock: the dock's own controls are not on screen",
      dockCollapsed.sideSwitch?.found === false &&
        dockCollapsed.collapseAction === null &&
        dockCollapsed.actions === null,
      `switch ${JSON.stringify(dockCollapsed.sideSwitch)}, collapse ${JSON.stringify(dockCollapsed.collapseAction)}, bar ${JSON.stringify(dockCollapsed.actions)}`,
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

    // 4 — the rail collapses to its icon column; it does not leave the grid. The
    // dock therefore does not inherit the window's leading edge: it keeps starting
    // at the rail's trailing edge, which is now the collapsed track rather than
    // 256px. Only the first track moves, so the panes must still abut and the sheet
    // must still own the window's trailing edge. Measuring the dock against the
    // window instead of the rail is exactly the old doctrine this protects.
    at("collapsed rail");
    await click(".nav-rail .nav-toggle");
    const railCollapsed = await settled();
    // The composition that says what the thin rail is: the dock still open, the
    // rail still painting its icons beside it. A rail that had left the grid would
    // put the dock on the window's own edge, and this shot would show the page's
    // icons crowding the window frame instead.
    const railCollapsedShot = await shot("chat-side-left-rail-collapsed.png");
    check(
      "left/collapsed rail: the rail is still on screen",
      Boolean(railCollapsed.rail) && railCollapsed.rail.display !== "none",
      `rail ${JSON.stringify(railCollapsed.rail)}`,
    );
    check(
      "left/collapsed rail: the rail wears the collapsed track the token asks for",
      railCollapsed.rail?.box.width === railCollapsed.tokens.collapsedTrack,
      `rail width ${railCollapsed.rail?.box.width}px vs --shell-nav-width-collapsed ${railCollapsed.tokens.collapsedTrack}px`,
    );
    check(
      "left/collapsed rail: the shell reports the collapsed rail",
      railCollapsed.shell?.className?.includes("shell--nav-collapsed") === true,
      `shell classes ${JSON.stringify(railCollapsed.shell?.className)}`,
    );
    check(
      "left/collapsed rail: the dock starts at the rail's trailing edge",
      railCollapsed.chat.box.left === railCollapsed.rail?.box.right &&
        railCollapsed.chat.box.left === railCollapsed.tokens.collapsedTrack,
      `dock left ${railCollapsed.chat.box.left}px vs rail right ${railCollapsed.rail?.box.right}px, collapsed track ${railCollapsed.tokens.collapsedTrack}px`,
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

    // 4b — both collapsed: the mark still follows the dock's column, and that
    // column now starts at the collapsed rail's trailing edge — 56px — rather than
    // at the window's own edge. The rail's width is still in the sum, only smaller;
    // a constant inset would be wrong in both states.
    at("collapsed rail and dock");
    await click('[data-testid="chat-collapse"]');
    const railAndDockCollapsed = await settled();
    const bothCollapsedShot = await shot("chat-side-collapsed-both.png");
    check(
      "left/collapsed rail + dock: the mark sits one rem inside the collapsed rail",
      Boolean(railAndDockCollapsed.launcher) &&
        railAndDockCollapsed.launcher.box.left ===
          railAndDockCollapsed.tokens.collapsedTrack +
            railAndDockCollapsed.tokens.rootFontSize &&
        railAndDockCollapsed.launcher.box.left ===
          railAndDockCollapsed.rail?.box.right +
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
      "reopening under a collapsed rail lands back on the rail-adjacent geometry",
      same(dockBackUnderCollapsedRail.chat.box, railCollapsed.chat.box) &&
        same(dockBackUnderCollapsedRail.main.box, railCollapsed.main.box) &&
        dockBackUnderCollapsedRail.launcher === null,
      `dock ${JSON.stringify(dockBackUnderCollapsedRail.chat.box)} vs ${JSON.stringify(railCollapsed.chat.box)}, sheet ${JSON.stringify(dockBackUnderCollapsedRail.main.box)} vs ${JSON.stringify(railCollapsed.main.box)}`,
    );

    // 4c — restoring the rail is the same control that collapsed it, because the
    // toggle stayed in the rail: the way back out is where the way in was. The
    // expanded arrangement comes back — rail 256, dock at the rail's trailing
    // edge, sheet on the window's trailing edge — with the rail's own box stated
    // rather than only the panes it moved.
    at("restored rail");
    await click(".nav-rail .nav-toggle");
    const railRestored = await settled();
    check(
      "restoring the rail drops the collapsed class",
      railRestored.shell?.className?.includes("shell--nav-collapsed") === false,
      `shell classes ${JSON.stringify(railRestored.shell?.className)}`,
    );
    check(
      "restoring the rail gives the dock back the expanded track",
      railRestored.rail?.box.width === railRestored.tokens.track &&
        railRestored.chat.box.left === railRestored.rail?.box.right,
      `rail width ${railRestored.rail?.box.width}px vs ${railRestored.tokens.track}px, dock left ${railRestored.chat.box.left}px`,
    );
    check(
      "restoring the rail lands back on the swapped geometry",
      same(railRestored.rail?.box, left.rail?.box) &&
        same(railRestored.main.box, left.main.box) &&
        same(railRestored.chat.box, left.chat.box),
      `rail ${JSON.stringify(railRestored.rail?.box)}, sheet ${JSON.stringify(railRestored.main.box)}, dock ${JSON.stringify(railRestored.chat.box)}`,
    );

    // 5 — the round trip: the same click on the dock's switch again, and the
    // shell is exactly where it started. Not "close enough": every box, the
    // track list and the controls.
    at("round trip");
    await click('[data-testid="chat-side-switch"]');
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
        restored.collapseAction?.icon === right.collapseAction?.icon,
      `switch ${restored.sideSwitch?.icon}/${restored.sideSwitch?.label}, collapse ${restored.collapseAction?.icon}`,
    );
    check(
      "round trip: the panes are painted where they started",
      same(restored.owners, right.owners),
      `owners ${JSON.stringify(restored.owners)} vs ${JSON.stringify(right.owners)}`,
    );
    const restoredShot = await shot("chat-side-restored.png");

    // 6 — the dock's own way out: the second-to-trailing action of the bottom bar,
    // with the build number beyond it at the window's own bottom-right end. It is
    // the only way out now that the titlebar carries no collapse control, and it
    // wears the arrow that points out of the side the dock is on.
    at("bottom bar collapse");
    const barBox = restored.actions?.box;
    const collapseBox = restored.collapseAction?.box;
    const badgeBox = restored.actions?.badge?.box;
    check(
      "restored: the bottom bar carries a collapse control",
      Boolean(restored.collapseAction),
      `collapse action ${JSON.stringify(restored.collapseAction)}`,
    );
    check(
      "restored: the version badge holds the bar's trailing end",
      Boolean(barBox && badgeBox) &&
        badgeBox.left > (collapseBox?.right ?? 0) &&
        badgeBox.right <= barBox.right &&
        barBox.right - badgeBox.right <= 10 &&
        badgeBox.top >= barBox.top &&
        badgeBox.bottom <= barBox.bottom,
      `badge ${JSON.stringify(badgeBox)} in bar ${JSON.stringify(barBox)}, collapse ends at ${collapseBox?.right}px`,
    );
    check(
      "restored: the collapse control sits just left of the version badge",
      Boolean(collapseBox && badgeBox) &&
        collapseBox.left > barBox.left + barBox.width / 2 &&
        collapseBox.right <= badgeBox.left &&
        badgeBox.left - collapseBox.right <= 12 &&
        collapseBox.top >= barBox.top &&
        collapseBox.bottom <= barBox.bottom,
      `action ${JSON.stringify(collapseBox)} vs badge ${JSON.stringify(badgeBox)} in bar ${JSON.stringify(barBox)}`,
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

    // 6b — the swap is only reachable from the open dock: collapsed, the pane's
    // bar is not rendered and the launcher is the only control on screen. So the
    // reported gesture becomes "open, swap, collapse": the mark has to follow the
    // side the dock was swapped to, and the same three clicks have to carry it
    // back. A swap attempted while collapsed would find no control at all, which
    // is exactly what the reopened state asserts before it clicks.
    at("swapped side, then collapsed");
    await click(".chat-launcher");
    const swappedOpenFromBar = await settled();
    check(
      "collapsed swap: reopening returns the bar's switch",
      swappedOpenFromBar.launcher === null &&
        swappedOpenFromBar.sideSwitch?.found === true &&
        swappedOpenFromBar.sideSwitch?.pressed === null,
      `launcher ${JSON.stringify(swappedOpenFromBar.launcher)}, switch ${JSON.stringify(swappedOpenFromBar.sideSwitch)}`,
    );
    await click('[data-testid="chat-side-switch"]');
    const collapsedSwapOpen = await settled();
    collapsedSwapOpen.vaultName = vaultName;
    checkArrangement("collapsed swap/open", collapsedSwapOpen, "left");
    checkControls("collapsed swap/open", collapsedSwapOpen, "left");
    await click('[data-testid="chat-collapse"]');
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
        collapsedSwapped.sideSwitch?.found === false &&
        collapsedSwapped.shell?.className?.includes("shell--chat-left") === true,
      `dock ${JSON.stringify(collapsedSwapped.chat)}, switch ${JSON.stringify(collapsedSwapped.sideSwitch)}, shell ${JSON.stringify(collapsedSwapped.shell?.className)}`,
    );
    at("swapped back, then collapsed");
    await click(".chat-launcher");
    const collapsedSwapReopened = await settled();
    check(
      "collapsed swap back: the mark opened the dock back onto its switch",
      collapsedSwapReopened.launcher === null &&
        collapsedSwapReopened.sideSwitch?.found === true,
      `launcher ${JSON.stringify(collapsedSwapReopened.launcher)}, switch ${JSON.stringify(collapsedSwapReopened.sideSwitch)}`,
    );
    await click('[data-testid="chat-side-switch"]');
    const collapsedSwapBackOpen = await settled();
    collapsedSwapBackOpen.vaultName = vaultName;
    checkArrangement("collapsed swap back/open", collapsedSwapBackOpen, "right");
    check(
      "collapsed swap back: the open dock swapped to the trailing side",
      collapsedSwapBackOpen.shell?.className?.includes("shell--chat-right") === true &&
        collapsedSwapBackOpen.sideSwitch?.label === "Move chat to the left of the page",
      `shell ${JSON.stringify(collapsedSwapBackOpen.shell?.className)}, switch ${JSON.stringify(collapsedSwapBackOpen.sideSwitch?.label)}`,
    );
    await click('[data-testid="chat-collapse"]');
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
      collapsedSwapOpen,
      collapsedSwapped,
      collapsedSwapBackOpen,
      collapsedSwappedBack,
      barReopened,
      screenshots: [
        rightShot,
        rightBarShot,
        rightSeamShot,
        leftShot,
        leftBarShot,
        leftSeamShot,
        collapsedShot,
        hoverShot,
        lightShot,
        railCollapsedShot,
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
