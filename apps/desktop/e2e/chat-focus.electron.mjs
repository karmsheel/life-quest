/**
 * Drives the full-screen chat harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-focus.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-focus.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same geometry, no eyeballing the app required. It
 * carries the shipped layout before the mode, the mode entered through the
 * dock's control and through its shortcut, the round trips back to the exact
 * boxes it started from, the mode toggled from a real `Ctrl+Shift+F` keydown
 * through the browser's input pipeline, the dock collapsed out from under the
 * mode, the mode opened from a collapsed dock (where the shortcut is the only
 * door left), the rail-collapsed arrangement and the dock-side-left
 * arrangement.
 *
 * The mode is one session-only shell state, so the door and the shortcut must
 * move the same marks: the shell wears `shell--chat-focus`, the page stops
 * painting, the dock takes the whole workspace right of the rail down to the
 * window's bottom, the divider leaves, and the rail keeps the window's leading
 * edge. The transcript and the composer band keep their readable measure while
 * the tab strip and the header stay full width. The bottom action bar is a card
 * in that column: it follows the composer box's measure, floats with a margin on
 * every side and wears the composer's soft corner — in the mode and in the split
 * dock alike — so it never reaches past the field it belongs to. The mode's one
 * door sits in that bar, immediately after the Notebox; the top row (strip and
 * header) carries no full-screen control, and the window strip is still the
 * day/night control and the gear.
 *
 * NOT covered here: whether a real mouse can press the dock's control through
 * whatever is painted over it. The rig clicks it with `el.click()` (the same
 * gesture the chat-side rig uses for the titlebar's theme control), so a
 * hit-testing regression is not in its path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-focus.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };
/** `56rem` at the bench's 16px root: the contract's readable measure. */
const MEASURE = 56 * 16;

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
  const styleOf = (el) => (el ? getComputedStyle(el) : null);
  const iconClass = (el) => {
    const svg = el ? el.querySelector("svg") : null;
    if (!svg) return null;
    // lucide-react stamps two spellings (a camel fallback and the kebab name), so
    // the raw class list is kept and the assertion reads the contract's spelling
    // out of it; a bare find would pick the fallback for digit-suffixed icons.
    return Array.from(svg.classList)
      .filter((name) => name.startsWith("lucide-"))
      .join(" ");
  };
  const present = (el) => {
    if (!el) return null;
    const s = styleOf(el);
    const b = box(el);
    return {
      box: b,
      display: s.display,
      visibility: s.visibility,
      visible:
        s.display !== "none" &&
        s.visibility !== "hidden" &&
        b.width > 0 &&
        b.height > 0
    };
  };
  const measureOf = (el) => {
    if (!el) return null;
    const s = styleOf(el);
    return {
      box: box(el),
      display: s.display,
      visibility: s.visibility,
      maxWidth: s.maxWidth,
      width: s.width,
      marginLeft: s.marginLeft,
      marginRight: s.marginRight,
      paddingLeft: s.paddingLeft,
      paddingRight: s.paddingRight
    };
  };

  const shell = document.querySelector(".shell");
  const rail = document.querySelector(".nav-rail");
  const main = document.querySelector(".shell__main");
  const chat = document.querySelector(".chat-panel");
  const launcher = document.querySelector(".chat-launcher");
  const divider = document.querySelector(".chat-divider");
  const tabs = document.querySelector(".chat-panel__tabs");
  const header = document.querySelector(".chat-panel__header");
  const body = document.querySelector(".chat-panel__body");
  const footer = document.querySelector(".chat-panel__footer");
  const messages = document.querySelector(".chat-panel__messages");
  const composer = document.querySelector(".chat-panel__composer");
  const composerBox = document.querySelector(".chat-panel__composer-box");
  const actions = document.querySelector(".chat-panel__actions");
  const trailing = document.querySelector(".window-titlebar__trailing");
  const dockCtl = document.querySelector('[data-testid="chat-fullscreen"]');
  const plus = document.querySelector(".chat-panel__tab-new");

  // The mode's door lives in the dock's bottom action bar now, not in the top
  // row. The top row is measured as the negative — the strip, the header, or
  // both, with no full-screen control in either — and the bar is measured as
  // the card it is, against the composer box it belongs to.
  const topRow = tabs || header;
  const topRowInfo = topRow
    ? {
        className: String(topRow.className || ""),
        isTabs: topRow.classList.contains("chat-panel__tabs"),
        isHeader: topRow.classList.contains("chat-panel__header"),
        box: box(topRow),
        holdsControl: Boolean(dockCtl && topRow.contains(dockCtl)),
        fullScreenControls: topRow.querySelectorAll(".chat-focus-toggle").length,
        children: Array.from(topRow.children).map((el) => ({
          classes: String(el.className || ""),
          box: box(el),
          holdsControl: Boolean(dockCtl && el.contains(dockCtl))
        }))
      }
    : null;

  // The top row's negative: neither the strip nor the header carries the door
  // any more, on any surface. Measured over both elements rather than only the
  // one in front, because a header the run has not opened is still in the DOM.
  const topRowCopy = {
    tabs: tabs ? tabs.querySelectorAll(".chat-focus-toggle").length : 0,
    header: header ? header.querySelectorAll(".chat-focus-toggle").length : 0
  };

  const barStyle = actions ? styleOf(actions) : null;
  const barBox = actions ? box(actions) : null;
  const noteboxSlot = actions
    ? actions.querySelector('[aria-label="Notebox"]')
    : null;
  const newChatSlot = actions
    ? actions.querySelector('[aria-label="New chat"]')
    : null;
  const shortcutsSlot = actions
    ? actions.querySelector('[data-testid="chat-shortcuts-action"]')
    : null;
  const controlIndex =
    actions && dockCtl ? Array.from(actions.children).indexOf(dockCtl) : -1;
  const noteboxIndex =
    actions && noteboxSlot
      ? Array.from(actions.children).indexOf(noteboxSlot)
      : -1;
  const actionsInfo = actions
    ? {
        className: String(actions.className || ""),
        box: barBox,
        width: barStyle.width,
        maxWidth: barStyle.maxWidth,
        marginTop: px(barStyle.marginTop),
        marginRight: px(barStyle.marginRight),
        marginBottom: px(barStyle.marginBottom),
        marginLeft: px(barStyle.marginLeft),
        borderRadius: barStyle.borderRadius,
        border: {
          top: px(barStyle.borderTopWidth),
          right: px(barStyle.borderRightWidth),
          bottom: px(barStyle.borderBottomWidth),
          left: px(barStyle.borderLeftWidth)
        },
        paddingLeft: px(barStyle.paddingLeft),
        paddingRight: px(barStyle.paddingRight),
        paddingTop: px(barStyle.paddingTop),
        paddingBottom: px(barStyle.paddingBottom),
        background: barStyle.backgroundColor,
        overflow: {
          scrollWidth: actions.scrollWidth,
          clientWidth: actions.clientWidth
        },
        containsControl: Boolean(dockCtl && actions.contains(dockCtl)),
        controlIndex,
        noteboxIndex,
        noteboxBox: noteboxSlot ? box(noteboxSlot) : null,
        newChatBox: newChatSlot ? box(newChatSlot) : null,
        shortcutsBox: shortcutsSlot ? box(shortcutsSlot) : null,
        labels: Array.from(actions.querySelectorAll(".chat-panel__action")).map(
          (el) => el.getAttribute("aria-label")
        ),
        // The bar's own row: every action and the badge, so an overflow can be
        // named rather than guessed at.
        children: Array.from(actions.children).map((el) => ({
          classes: String(el.className || ""),
          label: el.getAttribute("aria-label"),
          box: box(el),
          inside:
            Boolean(barBox) &&
            box(el).left >= barBox.left &&
            box(el).right <= barBox.right &&
            box(el).top >= barBox.top &&
            box(el).bottom <= barBox.bottom
        }))
      }
    : null;

  const composerBoxInfo = composerBox
    ? {
        box: box(composerBox),
        maxWidth: styleOf(composerBox).maxWidth,
        width: styleOf(composerBox).width
      }
    : null;

  const control = (el) =>
    el
      ? {
          found: true,
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute("data-testid"),
          classes: String(el.className || ""),
          label: el.getAttribute("aria-label"),
          title: el.getAttribute("title"),
          pressed: el.getAttribute("aria-pressed"),
          icon: iconClass(el),
          box: box(el),
          display: styleOf(el).display,
          visibility: styleOf(el).visibility
        }
      : { found: false };

  const cluster = trailing
    ? Array.from(trailing.children).map((el) => ({
        tag: el.tagName.toLowerCase(),
        classes: String(el.className || ""),
        testid: el.getAttribute("data-testid"),
        label: el.getAttribute("aria-label"),
        icon: iconClass(el),
        box: box(el)
      }))
    : [];

  /*
   * The strip's negative reading: the mode has one door, in the dock's bottom
   * action bar, so the window strip must carry no full-screen control at all and
   * no leftover words from the removed copy. Both are measured rather than
   * assumed, because a control that has merely been moved out of sight is still
   * a second door the operator can tab to.
   */
  const stripChatControls = trailing
    ? Array.from(trailing.querySelectorAll(".chat-focus-toggle"))
    : [];
  const staleMainPageLabels = new Set();
  for (const el of document.querySelectorAll("[aria-label], [title]")) {
    for (const value of [
      el.getAttribute("aria-label"),
      el.getAttribute("title")
    ]) {
      if (typeof value === "string" && /main page/i.test(value)) {
        staleMainPageLabels.add(value);
      }
    }
  }
  const strip = {
    present: Boolean(trailing),
    box: trailing ? box(trailing) : null,
    childCount: trailing ? trailing.children.length : 0,
    classes: cluster.map((entry) => entry.classes),
    testids: cluster.map((entry) => entry.testid),
    holdsChatFocus:
      stripChatControls.length > 0 ||
      Boolean(trailing && trailing.matches(".chat-focus-toggle")),
    hasMainPageControl: Boolean(
      document.querySelector('[data-testid="titlebar-main-page"]')
    ),
    staleMainPageLabels: Array.from(staleMainPageLabels)
  };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const railBox = rail ? box(rail) : null;
  const mainStyle = main ? styleOf(main) : null;
  const chatStyle = chat ? styleOf(chat) : null;

  const owner = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (rail && rail.contains(el)) return "rail";
    if (launcher && launcher.contains(el)) return "launcher";
    if (chat && chat.contains(el)) return "dock";
    if (main && main.contains(el)) return "main";
    if (document.querySelector(".window-titlebar")?.contains(el)) return "titlebar";
    return "other";
  };

  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;height:0;width:var(--shell-nav-width)";
  document.body.appendChild(probe);
  const track = probe.offsetWidth;
  probe.style.width = "var(--shell-nav-width-collapsed)";
  const collapsedTrack = probe.offsetWidth;
  probe.style.width = "var(--shell-frame)";
  const frame = probe.offsetWidth;
  probe.remove();

  const rootStyle = getComputedStyle(document.documentElement);
  const titlebarHeight = px(rootStyle.getPropertyValue("--window-titlebar-height"));
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const railRight = railBox ? railBox.right : 0;
  const mainAreaX = Math.round(railRight + (viewportWidth - railRight) / 2);

  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    tokens: { track, collapsedTrack, frame, titlebarHeight, rootFontSize },
    route:
      typeof window.chatFocusHarnessRoute === "string"
        ? window.chatFocusHarnessRoute
        : null,
    keys: Array.isArray(window.chatFocusHarnessKeys)
      ? window.chatFocusHarnessKeys.slice()
      : null,
    shell: shell
      ? {
          className: String(shell.className),
          gridTemplateColumns: styleOf(shell).gridTemplateColumns,
          box: box(shell)
        }
      : null,
    rail: rail ? { box: box(rail), display: styleOf(rail).display } : null,
    main: main
      ? {
          box: box(main),
          display: styleOf(main).display,
          visibility: mainStyle.visibility
        }
      : null,
    chat: chat
      ? {
          box: box(chat),
          display: styleOf(chat).display,
          visibility: chatStyle.visibility,
          className: String(chat.className)
        }
      : null,
    launcher: launcher
      ? { box: box(launcher), position: styleOf(launcher).position }
      : null,
    divider: { present: Boolean(divider), box: divider ? box(divider) : null },
    dockControl: control(dockCtl),
    topRow: topRowInfo,
    topRowCopy,
    bar: actionsInfo,
    composerBox: composerBoxInfo,
    strip,
    cluster,
    content: {
      tabs: present(tabs),
      header: present(header),
      messages: present(messages),
      composer: present(composer),
      actions: present(actions)
    },
    measure: { body: measureOf(body), footer: measureOf(footer) },
    owners: {
      mainArea: owner(mainAreaX, 200),
      bottomRight: owner(viewportWidth - 2, viewportHeight - 4),
      bottomLeft: owner(2, viewportHeight - 4),
      trailingInner: owner(viewportWidth - 3, 200)
    },
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }
  };
})()`;

const failures = [];
/** The scenario being run, so a failure can also be attributed to its step. */
let currentScenario = null;
const scenarioFailures = {};
const beginScenario = (name) => {
  currentScenario = name;
  scenarioFailures[name] = [];
};
const check = (label, condition, detail) => {
  if (!condition) {
    const message = `${label}: ${detail}`;
    failures.push(message);
    if (currentScenario) scenarioFailures[currentScenario].push(message);
  }
  return Boolean(condition);
};

/**
 * The last step the rig reached.
 *
 * A throw anywhere inside the run leaves the report carrying only the catch
 * branch, so without this a failure reads as a bare "Script failed to execute"
 * with no indication of which evaluation produced it.
 */
let step = "start";
const at = (name) => {
  step = name;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tolerance = 1) =>
  typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tolerance;

/**
 * The layout every unfocused arrangement has to keep: the rail on the window's
 * leading edge, the page painting beside it, the dock beside the page, and the
 * divider in the seam between them.
 */
function checkUnfocused(label, state) {
  check(
    `${label}: the shell is open and not in the mode`,
    String(state.shell?.className ?? "").includes("shell--chat-open") &&
      !String(state.shell?.className ?? "").includes("shell--chat-focus"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the rail holds the window's leading edge`,
    Boolean(state.rail) && state.rail.box.left === 0 && state.rail.box.top === 0,
    `rail ${JSON.stringify(state.rail?.box)}`,
  );
  check(
    `${label}: the page is painting`,
    Boolean(state.main) &&
      state.main.display !== "none" &&
      state.main.box.width > 0 &&
      state.main.box.height > 0,
    `main ${JSON.stringify(state.main)}`,
  );
  check(
    `${label}: the page owns the column beside the rail`,
    state.owners.mainArea === "main",
    `owner at the page's column is ${state.owners.mainArea}`,
  );
  check(
    `${label}: the dock is beside the page`,
    Boolean(state.chat) && state.chat.display !== "none",
    `dock ${JSON.stringify(state.chat)}`,
  );
  check(
    `${label}: the divider is drawn on the open dock`,
    state.divider.present === true,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: the trailing pane reaches the window's trailing edge`,
    state.chat?.box.right === state.viewport.width ||
      state.main?.box.right === state.viewport.width,
    `dock right ${state.chat?.box.right}px, page right ${state.main?.box.right}px vs window ${state.viewport.width}px`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );
}

/**
 * The window strip: the mode has one door, in the dock's bottom action bar, so
 * the strip's trailing cluster is the day/night control and the gear — in that
 * order — and
 * nothing in it opens the mode. A second door here is exactly the duplicate the
 * change removed, so it is asserted absent in every arrangement the run samples,
 * not only while the mode is on.
 */
function checkStrip(label, state) {
  const strip = state.strip;
  check(
    `${label}: the window strip's trailing cluster is on screen`,
    strip?.present === true && Boolean(strip?.box),
    `strip ${JSON.stringify(strip)}`,
  );
  const classes = Array.isArray(strip?.classes) ? strip.classes : [];
  check(
    `${label}: the strip's trailing cluster is the shipped pair`,
    strip?.childCount === 2 && classes.length === 2,
    `cluster ${JSON.stringify(classes)}`,
  );
  check(
    `${label}: the day/night control leads the strip's cluster`,
    String(classes[0] ?? "").includes("theme-mode-toggle"),
    `cluster ${JSON.stringify(classes)}`,
  );
  check(
    `${label}: the settings menu trails the strip's cluster`,
    String(classes[1] ?? "").includes("settings-menu"),
    `cluster ${JSON.stringify(classes)}`,
  );
  check(
    `${label}: no full-screen control rides the window strip`,
    strip?.holdsChatFocus === false && strip?.hasMainPageControl === false,
    `chat-focus-toggle on the strip: ${strip?.holdsChatFocus}, titlebar-main-page: ${strip?.hasMainPageControl}`,
  );
  check(
    `${label}: the Collapse/Restore main page labels are gone from the app`,
    Array.isArray(strip?.staleMainPageLabels) &&
      strip.staleMainPageLabels.length === 0,
    `labels ${JSON.stringify(strip?.staleMainPageLabels)}`,
  );

  const boxes = state.cluster ?? [];
  check(
    `${label}: the strip's pair is drawn day/night then gear, left to right`,
    Boolean(boxes[0]?.box && boxes[1]?.box) &&
      boxes[0].box.right <= boxes[1].box.left,
    `boxes ${JSON.stringify([boxes[0]?.box, boxes[1]?.box])}`,
  );
}

/**
 * The mode's one door: the dock's bottom action bar. A control that exists in
 * the wrong corner is not a control the operator finds, so placement and label
 * are asserted — and the bar is checked as the card it now is: the composer
 * box's width, a margin on every side, the composer's soft corner. The top row
 * and the window strip are checked for the copies that used to sit there.
 */
function checkDoors(label, state, focused) {
  const expectedDockLabel = focused ? "Exit full screen chat" : "Full screen chat";
  const expectedIcon = focused ? "lucide-minimize-2" : "lucide-maximize-2";
  const expectedPressed = focused ? "true" : "false";

  const dock = state.dockControl;
  const bar = state.bar;
  const chatBox = state.chat?.box;
  const composerBox = state.composerBox?.box;
  const barBox = bar?.box;

  check(
    `${label}: the dock's bottom action bar carries the full-screen control`,
    dock.found === true && bar?.containsControl === true,
    "no [data-testid=chat-fullscreen] in .chat-panel__actions",
  );
  check(
    `${label}: the dock control is marked as the mode's control`,
    String(dock.classes ?? "").includes("chat-focus-toggle") &&
      String(dock.classes ?? "").includes("chat-panel__action"),
    `dock control classes ${JSON.stringify(dock.classes)}`,
  );
  check(
    `${label}: the dock control names the move it makes`,
    dock.label === expectedDockLabel && dock.title === expectedDockLabel,
    `label ${JSON.stringify(dock.label)}, title ${JSON.stringify(dock.title)}`,
  );
  check(
    `${label}: the dock control's pressed state follows the mode`,
    dock.pressed === expectedPressed,
    `aria-pressed ${JSON.stringify(dock.pressed)}`,
  );
  check(
    `${label}: the dock control wears the mode's icon`,
    String(dock.icon ?? "").includes(expectedIcon),
    `icon ${JSON.stringify(dock.icon)}`,
  );
  check(
    `${label}: the dock control is painted`,
    Boolean(dock.box) &&
      dock.display !== "none" &&
      dock.visibility !== "hidden" &&
      dock.box.width > 0 &&
      dock.box.height > 0,
    `dock control ${JSON.stringify(dock)}`,
  );

  // The leading group, in DOM order and on screen: New chat, then the Notebox,
  // then the door. "Next to the Notebox" is measured as the slot immediately
  // after it, not as "somewhere on the left".
  check(
    `${label}: the door follows the Notebox in the bar's leading group`,
    bar?.controlIndex === bar?.noteboxIndex + 1 &&
      Boolean(bar?.noteboxBox && dock.box && bar?.newChatBox && bar?.shortcutsBox) &&
      bar.noteboxBox.right <= dock.box.left &&
      dock.box.left - bar.noteboxBox.right <= 8 &&
      bar.newChatBox.left < bar.noteboxBox.left &&
      dock.box.right < bar.shortcutsBox.left,
    `slots ${JSON.stringify(bar?.labels)}, indices ${bar?.noteboxIndex}/${bar?.controlIndex}, notebox ${JSON.stringify(bar?.noteboxBox)}, door ${JSON.stringify(dock.box)}, new chat ${JSON.stringify(bar?.newChatBox)}, shortcuts ${JSON.stringify(bar?.shortcutsBox)}`,
  );

  // The top row is not a door any more: the strip (and the header, whether or
  // not it is the row in front) carries no full-screen control.
  check(
    `${label}: the dock's top row carries no full-screen control`,
    state.topRowCopy?.tabs === 0 &&
      state.topRowCopy?.header === 0 &&
      (state.topRow?.holdsControl ?? false) === false,
    `top row copy ${JSON.stringify(state.topRowCopy)}, row holds control: ${state.topRow?.holdsControl}`,
  );

  // The card: the composer box's own width and edges, not the dock's. The field
  // is the measure the bar belongs to, on both the split dock and the full-screen
  // column, so its two borders line up with the composer box's two borders.
  check(
    `${label}: the bar keeps the composer box's measure`,
    Boolean(barBox && composerBox) &&
      near(barBox.width, composerBox.width, 1) &&
      near(barBox.left, composerBox.left, 1) &&
      near(barBox.right, composerBox.right, 1),
    `bar ${JSON.stringify(barBox)} vs composer box ${JSON.stringify(composerBox)}`,
  );
  check(
    `${label}: the bar never reaches past the dock's edges`,
    Boolean(barBox && chatBox) &&
      barBox.left >= chatBox.left + 4 &&
      barBox.right <= chatBox.right - 4,
    `bar ${JSON.stringify(barBox)} in dock ${JSON.stringify(chatBox)}`,
  );
  check(
    `${label}: the bar floats with a margin on every side`,
    Boolean(barBox && chatBox) &&
      barBox.top > (state.measure?.footer?.box?.bottom ?? barBox.top) &&
      barBox.bottom < chatBox.bottom &&
      chatBox.bottom - barBox.bottom >= 4 &&
      bar.marginTop > 0 &&
      bar.marginBottom > 0,
    `margins ${bar?.marginTop}/${bar?.marginBottom}, bar ${JSON.stringify(barBox)} under composer band ${JSON.stringify(state.measure?.footer?.box)} in dock ${JSON.stringify(chatBox)}`,
  );
  check(
    `${label}: the bar wears a full hairline and a soft corner`,
    bar.border.top === 1 &&
      bar.border.right === 1 &&
      bar.border.bottom === 1 &&
      bar.border.left === 1 &&
      parseFloat(bar.borderRadius) > 2,
    `border ${JSON.stringify(bar?.border)}, radius ${JSON.stringify(bar?.borderRadius)}`,
  );
  check(
    `${label}: the bar's row stays inside the card`,
    Boolean(barBox) &&
      bar.overflow.scrollWidth <= bar.overflow.clientWidth + 1 &&
      bar.children.every((child) => child.inside === true),
    `overflow ${JSON.stringify(bar?.overflow)}, children ${JSON.stringify(bar?.children)}`,
  );

  checkStrip(label, state);
}

/** The mode's one layout: rail, then the dock to the window's edges. */
function checkFocused(label, state, base) {
  const railWidth = base.rail?.box.width ?? base.tokens.track;
  check(
    `${label}: the shell wears the mode class`,
    String(state.shell?.className ?? "").includes("shell--chat-focus"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the dock is open and is not collapsed in the mode`,
    String(state.shell?.className ?? "").includes("shell--chat-open") &&
      !String(state.shell?.className ?? "").includes("shell--chat-collapsed"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the rail is still on screen`,
    Boolean(state.rail) &&
      state.rail.display !== "none" &&
      state.rail.box.width > 0,
    `rail ${JSON.stringify(state.rail)}`,
  );
  check(
    `${label}: the rail keeps the window's leading edge`,
    state.rail?.box.left === 0 &&
      state.rail?.box.top === 0 &&
      state.rail?.box.bottom === state.viewport.height,
    `rail ${JSON.stringify(state.rail?.box)} of ${JSON.stringify(state.viewport)}`,
  );
  check(
    `${label}: the rail box is the one the run started from`,
    same(state.rail?.box, base.rail?.box),
    `rail ${JSON.stringify(state.rail?.box)} vs ${JSON.stringify(base.rail?.box)}`,
  );
  check(
    `${label}: the page is not painted`,
    !state.main ||
      state.main.display === "none" ||
      (state.main.box.width === 0 && state.main.box.height === 0),
    `main ${JSON.stringify(state.main)}`,
  );
  check(
    `${label}: the dock is painted`,
    Boolean(state.chat) &&
      state.chat.display !== "none" &&
      state.chat.visibility !== "hidden",
    `dock ${JSON.stringify(state.chat)}`,
  );
  check(
    `${label}: the dock starts at the rail's trailing edge`,
    state.chat?.box.left === state.rail?.box.right,
    `dock left ${state.chat?.box.left}px vs rail right ${state.rail?.box.right}px`,
  );
  check(
    `${label}: the trailing pane reaches the window's trailing edge`,
    state.chat?.box.right === state.viewport.width ||
      state.main?.box.right === state.viewport.width,
    `dock right ${state.chat?.box.right}px, page right ${state.main?.box.right}px vs window ${state.viewport.width}px`,
  );
  check(
    `${label}: the dock meets the window strip with no gap`,
    state.chat?.box.top === state.tokens.titlebarHeight,
    `dock top ${state.chat?.box.top}px vs strip bottom ${state.tokens.titlebarHeight}px`,
  );
  check(
    `${label}: the dock reaches the window's bottom edge`,
    state.chat?.box.bottom === state.viewport.height,
    `dock bottom ${state.chat?.box.bottom}px vs window ${state.viewport.height}px`,
  );
  check(
    `${label}: the dock fills the workspace right of the rail`,
    state.chat?.box.width === state.viewport.width - (state.rail?.box.width ?? 0),
    `dock width ${state.chat?.box.width}px vs ${state.viewport.width}px - ${state.rail?.box.width}px`,
  );
  check(
    `${label}: the rail is the track the arrangement asks for`,
    state.rail?.box.width === railWidth,
    `rail width ${state.rail?.box.width}px vs ${railWidth}px`,
  );
  check(
    `${label}: the divider is absent`,
    state.divider.present === false,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: the floating launcher is not on screen`,
    state.launcher === null,
    `launcher ${JSON.stringify(state.launcher)}`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );

  // The dock's own content is all still drawn: tabs, header, transcript,
  // composer and bottom bar.
  for (const [name, rect] of Object.entries(state.content ?? {})) {
    check(
      `${label}: the dock still draws its ${name}`,
      Boolean(rect) && rect.visible === true,
      `${name} ${JSON.stringify(rect)}`,
    );
  }
  const chatBox = state.chat?.box;
  // The strip and the header lead the dock full width, but the action bar is
  // not chrome across the glass any more: it follows the composer box into the
  // readable measure, gauge-lined with the field. checkDoors asserts that
  // alignment; here the mode's own measure is the claim.
  for (const [name, rect] of [
    ["tab strip", state.content?.tabs],
    ["header", state.content?.header],
  ]) {
    check(
      `${label}: the ${name} stays full width`,
      Boolean(rect?.box && chatBox) && near(rect.box.width, chatBox.width, 1),
      `${name} width ${rect?.box?.width}px vs dock ${chatBox?.width}px`,
    );
  }
  check(
    `${label}: the action bar narrows to the composer box's measure`,
    Boolean(state.bar?.box && state.composerBox?.box && chatBox) &&
      state.bar.box.width < chatBox.width - 8 &&
      near(state.bar.box.width, state.composerBox.box.width, 1) &&
      near(state.bar.box.left, state.composerBox.box.left, 1) &&
      near(state.bar.box.right, state.composerBox.box.right, 1),
    `bar ${JSON.stringify(state.bar?.box)} vs composer box ${JSON.stringify(state.composerBox?.box)} in dock ${JSON.stringify(chatBox)}`,
  );

  // The readable measure: `width: 100%`, `max-width: 56rem`, centred.
  for (const [name, measure] of [
    ["transcript", state.measure?.body],
    ["composer band", state.measure?.footer],
  ]) {
    check(
      `${label}: the ${name} narrows to the readable measure`,
      Boolean(measure) &&
        measure.display !== "none" &&
        measure.maxWidth === `${MEASURE}px`,
      `${name} max-width ${JSON.stringify(measure?.maxWidth)}`,
    );
    check(
      `${label}: the ${name} is centred at the readable measure`,
      Boolean(measure?.box && chatBox) &&
        near(measure.box.width, MEASURE, 1) &&
        near(
          parseFloat(measure.marginLeft),
          parseFloat(measure.marginRight),
          1,
        ) &&
        near(
          measure.box.left + measure.box.right,
          chatBox.left + chatBox.right,
          2,
        ) &&
        measure.box.left >= chatBox.left &&
        measure.box.right <= chatBox.right,
      `${name} ${JSON.stringify(measure?.box)}, margins ${measure?.marginLeft}/${measure?.marginRight}, dock ${JSON.stringify(chatBox)}`,
    );
  }

  // The window's own corners are painted by the panes the geometry says.
  check(
    `${label}: the workspace beside the rail is the dock`,
    state.owners.mainArea === "dock",
    `owner at the page's column is ${state.owners.mainArea}`,
  );
  check(
    `${label}: the window's bottom-right corner is the dock's`,
    state.owners.bottomRight === "dock",
    `bottom-right owner ${state.owners.bottomRight}`,
  );
  check(
    `${label}: the window's bottom-left corner is still the rail's`,
    state.owners.bottomLeft === "rail",
    `bottom-left owner ${state.owners.bottomLeft}`,
  );
  check(
    `${label}: nothing spills past the window`,
    state.overflow.scrollWidth <= state.viewport.width &&
      state.overflow.clientWidth <= state.viewport.width,
    `scrollWidth ${state.overflow.scrollWidth}px, clientWidth ${state.overflow.clientWidth}px vs window ${state.viewport.width}px`,
  );
}

/** The exact pre-focus geometry, compared box for box. */
function checkRestored(label, before, after) {
  check(
    `${label}: the mode class is gone`,
    !String(after.shell?.className ?? "").includes("shell--chat-focus"),
    `shell classes ${JSON.stringify(after.shell?.className)}`,
  );
  check(
    `${label}: the shell class list is the one the run started from`,
    after.shell?.className === before.shell?.className,
    `${JSON.stringify(after.shell?.className)} vs ${JSON.stringify(before.shell?.className)}`,
  );
  check(
    `${label}: the shell box is the one the run started from`,
    same(after.shell?.box, before.shell?.box),
    `${JSON.stringify(after.shell?.box)} vs ${JSON.stringify(before.shell?.box)}`,
  );
  check(
    `${label}: the grid tracks are the ones the run started from`,
    after.shell?.gridTemplateColumns === before.shell?.gridTemplateColumns,
    `${after.shell?.gridTemplateColumns} vs ${before.shell?.gridTemplateColumns}`,
  );
  for (const [name, beforeBox, afterBox] of [
    ["rail", before.rail?.box, after.rail?.box],
    ["page", before.main?.box, after.main?.box],
    ["dock", before.chat?.box, after.chat?.box],
  ]) {
    check(
      `${label}: the ${name} box is the one the run started from`,
      same(beforeBox, afterBox),
      `${JSON.stringify(afterBox)} vs ${JSON.stringify(beforeBox)}`,
    );
  }
  check(
    `${label}: the action bar card is back on the box it started from`,
    same(after.bar?.box, before.bar?.box) &&
      same(after.composerBox?.box, before.composerBox?.box),
    `bar ${JSON.stringify(after.bar?.box)} vs ${JSON.stringify(before.bar?.box)}; composer box ${JSON.stringify(after.composerBox?.box)} vs ${JSON.stringify(before.composerBox?.box)}`,
  );
  check(
    `${label}: the divider is back on the seam`,
    after.divider.present === before.divider.present,
    `divider ${JSON.stringify(after.divider)} vs ${JSON.stringify(before.divider)}`,
  );
  check(
    `${label}: the door names the shipped move again`,
    after.dockControl.label === before.dockControl.label &&
      after.dockControl.pressed === before.dockControl.pressed &&
      after.dockControl.icon === before.dockControl.icon,
    `dock ${after.dockControl.label}/${after.dockControl.pressed}/${after.dockControl.icon}`,
  );
  check(
    `${label}: no second full-screen door returned to the strip`,
    after.strip?.holdsChatFocus === false &&
      after.strip?.hasMainPageControl === false &&
      after.strip?.childCount === 2,
    `strip ${JSON.stringify(after.strip)}`,
  );
  check(
    `${label}: the page is painted on the same boxes again`,
    same(after.owners, before.owners),
    `${JSON.stringify(after.owners)} vs ${JSON.stringify(before.owners)}`,
  );
}

/** Collapsing the dock while in the mode: the dock's own door out of it. */
function checkCollapsedExit(label, state) {
  check(
    `${label}: the shell is collapsed and out of the mode`,
    String(state.shell?.className ?? "").includes("shell--chat-collapsed") &&
      !String(state.shell?.className ?? "").includes("shell--chat-focus"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the page is back`,
    Boolean(state.main) &&
      state.main.display !== "none" &&
      state.main.box.width > 0 &&
      state.main.box.height > 0,
    `main ${JSON.stringify(state.main)}`,
  );
  check(
    `${label}: the dock pane is gone`,
    state.chat === null,
    `dock ${JSON.stringify(state.chat)}`,
  );
  check(
    `${label}: the floating launcher is back`,
    Boolean(state.launcher) && state.launcher.position === "fixed",
    `launcher ${JSON.stringify(state.launcher)}`,
  );
  check(
    `${label}: the dock's own control is not on screen`,
    state.dockControl.found === false,
    `dock control ${JSON.stringify(state.dockControl)}`,
  );
  // The strip is still the shipped pair while the dock is collapsed: the mode's
  // one door left with the dock, but no second door replaces it up there.
  checkStrip(label, state);
  check(
    `${label}: the divider is gone with the dock`,
    state.divider.present === false,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: the page owns the workspace again`,
    state.owners.mainArea === "main",
    `owner at the page's column is ${state.owners.mainArea}`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );
}

/** `Ctrl+Shift+F` arrived as a trusted keydown and toggled the mode. */
function checkShortcutKeys(label, state, expectedCount) {
  const keys = state.keys;
  check(
    `${label}: every pressed key was recorded by the page`,
    Array.isArray(keys) && keys.length === expectedCount,
    `${JSON.stringify(keys)} (want ${expectedCount} keydowns)`,
  );
  if (!Array.isArray(keys)) return;
  for (const key of keys) {
    check(
      `${label}: the browser delivered a trusted Ctrl+Shift+F keydown`,
      key.ctrl === true &&
        key.shift === true &&
        key.alt === false &&
        key.meta === false &&
        key.trusted === true &&
        String(key.key).toLowerCase() === "f",
      `key ${JSON.stringify(key)}`,
    );
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the theme
  // the app itself defaults to so a test run is not a white sheet flashing.
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
  const frames = () =>
    run(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
    );

  const shot = async (name, rect) => {
    const image = await win.webContents.capturePage(rect);
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  const waitForHarness = async (timeoutMs = 40_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.chatFocusHarnessReady !== "object") return null;
          await window.chatFocusHarnessReady;
          return typeof window.chatFocusHarnessVaultName === "string"
            ? window.chatFocusHarnessVaultName
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

  const settle = async (ms = 220) => {
    await sleep(ms);
    await frames();
    return sample();
  };

  const waitFor = async (expression, description, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await run(expression)) return;
      } catch (error) {
        lastError = error;
      }
      await sleep(60);
    }
    throw new Error(
      `[${step}] timed out waiting for ${description}${lastError ? `: ${lastError}` : ""}`,
    );
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
    if (!clicked) throw new Error(`[${step}] no element for ${selector}`);
  };

  const parkPointer = () =>
    win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });

  const blurActive = () =>
    run(`(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return true;
    })()`);

  /**
   * A real key press through the browser's input pipeline, as an operator's
   * keyboard delivers it — not a synthetic DOM event. The harness logs every
   * keydown it sees, so the report proves the modifier flags were carried and
   * the event was trusted.
   */
  const press = async (keyCode, modifiers = []) => {
    await blurActive();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    await sleep(30);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(140);
    await frames();
  };

  const focusClassExpression = `(() => {
    const shell = document.querySelector(".shell");
    const chat = document.querySelector(".chat-panel");
    return Boolean(
      shell &&
        shell.className.includes("shell--chat-focus") &&
        chat &&
        getComputedStyle(chat).display !== "none",
    );
  })()`;
  const unfocusedExpression = `(() => {
    const shell = document.querySelector(".shell");
    const chat = document.querySelector(".chat-panel");
    const main = document.querySelector(".shell__main");
    return Boolean(
      shell &&
        !shell.className.includes("shell--chat-focus") &&
        chat &&
        main &&
        getComputedStyle(main).display !== "none",
    );
  })()`;
  const collapsedExpression = `(() => {
    const shell = document.querySelector(".shell");
    const launcher = document.querySelector(".chat-launcher");
    return Boolean(
      shell &&
        shell.className.includes("shell--chat-collapsed") &&
        !document.querySelector(".chat-panel") &&
        launcher,
    );
  })()`;
  const reopenedExpression = `(() => {
    const shell = document.querySelector(".shell");
    return Boolean(
      shell &&
        shell.className.includes("shell--chat-focus") &&
        !shell.className.includes("shell--chat-collapsed") &&
        document.querySelector(".chat-panel") &&
        !document.querySelector(".chat-launcher"),
    );
  })()`;

  const states = {};
  const screenshots = [];
  const record = (name, state) => {
    states[name] = state;
    return state;
  };
  const capture = async (file, rect) => {
    const written = await shot(file, rect);
    if (!screenshots.includes(written)) screenshots.push(written);
    return written;
  };

  let report;
  const timeout = setTimeout(() => {
    console.error("chat-focus: timed out after 150s");
    app.exit(1);
  }, 150_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(300);
    win.showInactive();
    // The controls are checked for their resting look, not a hover.
    await parkPointer();

    // 1 — the shipped layout, before the mode: rail, page, dock, divider.
    at("shipped layout");
    beginScenario("shipped layout");
    const initial = record("initial", await settle());
    initial.vaultName = vaultName;
    const tokens = initial.tokens;
    check(
      "shipped layout: the window is 1280x900",
      initial.viewport.width === 1280 && initial.viewport.height === 900,
      `viewport ${JSON.stringify(initial.viewport)}`,
    );
    check(
      "shipped layout: the strip is the shipped 32px",
      tokens.titlebarHeight === 32,
      `titlebar height ${tokens.titlebarHeight}px`,
    );
    check(
      "shipped layout: the shell frame is the shipped 12px",
      tokens.frame === 12,
      `frame ${tokens.frame}px`,
    );
    check(
      "shipped layout: the rail is the shipped 256px",
      tokens.track === 256,
      `rail track ${tokens.track}px`,
    );
    check(
      "shipped layout: the collapsed rail is the shipped 56px",
      tokens.collapsedTrack === 56,
      `collapsed rail track ${tokens.collapsedTrack}px`,
    );
    check(
      "shipped layout: the root type size is 16px so 56rem is 896px",
      tokens.rootFontSize === 16,
      `root font size ${tokens.rootFontSize}px`,
    );
    checkUnfocused("shipped layout", initial);
    checkDoors("shipped layout", initial, false);
    await capture("chat-focus-initial.png");

    // 2 — the dock's own door: one click, and the mode takes the workspace.
    at("dock door: enter");
    beginScenario("dock door: enter");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(focusClassExpression, "the mode's shell class");
    const focusedViaDock = record("focusedViaDock", await settle());
    checkFocused("dock door", focusedViaDock, initial);
    checkDoors("dock door", focusedViaDock, true);
    await capture("chat-focus.png");
    await capture("chat-focus-strip.png", {
      x: 0,
      y: 0,
      width: DEFAULT_SIZE.width,
      height: 140,
    });
    const focusChat = focusedViaDock.chat?.box;
    if (focusChat) {
      await capture("chat-focus-measure.png", {
        x: Math.max(0, focusChat.left),
        y: focusChat.top,
        width: Math.min(focusChat.width, DEFAULT_SIZE.width - focusChat.left),
        height: Math.min(420, DEFAULT_SIZE.height - focusChat.top),
      });
      // The bottom of the dock, 1:1: the composer box, the action-bar card with
      // its margin and corner, and the mode's door at the card's leading edge.
      const barCropTop = Math.max(0, focusChat.bottom - 190);
      await capture("chat-focus-actions.png", {
        x: Math.max(0, focusChat.left),
        y: barCropTop,
        width: Math.min(focusChat.width, DEFAULT_SIZE.width - focusChat.left),
        height: Math.min(190, DEFAULT_SIZE.height - barCropTop),
      });
    }

    // 3 — the same door closes it, and the shell is exactly where it started.
    at("dock door: exit");
    beginScenario("dock door: exit");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(unfocusedExpression, "the page and the mode class gone");
    const restoredAfterDock = record("restoredAfterDock", await settle());
    checkRestored("dock door exit", initial, restoredAfterDock);
    checkDoors("dock door exit", restoredAfterDock, false);
    await capture("chat-focus-restored.png");

    // 4 — the shortcut: a real Ctrl+Shift+F through the browser's input
    // pipeline toggles the mode both ways. With one door in the dock, this is
    // the other way an operator reaches the mode.
    at("shortcut: enter");
    beginScenario("shortcut: enter");
    await press("F", ["control", "shift"]);
    await waitFor(focusClassExpression, "the mode's shell class from Ctrl+Shift+F");
    const shortcutFocused = record("shortcutFocused", await settle());
    checkFocused("shortcut", shortcutFocused, initial);
    checkDoors("shortcut", shortcutFocused, true);
    checkShortcutKeys("shortcut on", shortcutFocused, 1);
    await capture("chat-focus-shortcut.png");

    at("shortcut: exit");
    beginScenario("shortcut: exit");
    await press("F", ["control", "shift"]);
    await waitFor(unfocusedExpression, "the page and the mode class gone");
    const shortcutRestored = record("shortcutRestored", await settle());
    checkRestored("shortcut exit", initial, shortcutRestored);
    checkShortcutKeys("shortcut off", shortcutRestored, 2);

    // 5 — collapsing the dock while the mode is on leaves the mode: the dock's
    // own close is the way out, and the page and launcher come back.
    at("collapse the dock while in the mode");
    beginScenario("collapse while in the mode");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(focusClassExpression, "the mode's shell class");
    await click('[data-testid="chat-collapse"]');
    await waitFor(collapsedExpression, "the collapsed dock and the launcher");
    const collapsedFromFocus = record("collapsedFromFocus", await settle());
    checkCollapsedExit("collapse while focused", collapsedFromFocus);
    await capture("chat-focus-collapsed.png");

    // 6 — the shortcut from a collapsed dock: with the dock hidden there is no
    // control to press, so Ctrl+Shift+F is the only door left. Entering the mode
    // has to reopen the dock (a mode with no dock would be a blank page), and
    // the same key has to bring the whole arrangement back.
    at("enter from a collapsed dock: shortcut");
    beginScenario("from collapsed: shortcut");
    await press("F", ["control", "shift"]);
    await waitFor(reopenedExpression, "the mode with the dock reopened");
    const focusFromCollapsed = record("focusFromCollapsed", await settle());
    checkFocused("from collapsed", focusFromCollapsed, initial);
    checkDoors("from collapsed", focusFromCollapsed, true);
    check(
      "from collapsed: entering the mode reopened the dock",
      focusFromCollapsed.chat !== null &&
        String(focusFromCollapsed.shell?.className ?? "").includes(
          "shell--chat-open",
        ),
      `dock ${JSON.stringify(focusFromCollapsed.chat)}, shell ${JSON.stringify(focusFromCollapsed.shell?.className)}`,
    );
    checkShortcutKeys("from collapsed on", focusFromCollapsed, 3);
    await capture("chat-focus-from-collapsed.png");

    at("exit from the reopened dock: shortcut");
    await press("F", ["control", "shift"]);
    await waitFor(unfocusedExpression, "the page and the mode class gone");
    const restoredFromCollapsed = record(
      "restoredFromCollapsed",
      await settle(),
    );
    checkRestored("from collapsed exit", initial, restoredFromCollapsed);
    checkShortcutKeys("from collapsed off", restoredFromCollapsed, 4);

    // 7 — the rail collapsed to its icon column first: the dock starts at 56px,
    // the rail's own track, not the window's edge.
    at("rail collapsed: arrangement before");
    beginScenario("rail collapsed: base");
    await click(".nav-rail .nav-toggle");
    await waitFor(
      `(() => {
        const shell = document.querySelector(".shell");
        const rail = document.querySelector(".nav-rail");
        return Boolean(
          shell &&
            shell.className.includes("shell--nav-collapsed") &&
            rail &&
            Math.round(rail.getBoundingClientRect().width) === 56,
        );
      })()`,
      "the collapsed rail",
    );
    const railCollapsedBase = record("railCollapsedBase", await settle());
    check(
      "rail collapsed: the rail shrinks to its icon column",
      railCollapsedBase.rail?.box.width === railCollapsedBase.tokens.collapsedTrack &&
        railCollapsedBase.rail?.display !== "none",
      `rail ${JSON.stringify(railCollapsedBase.rail)} vs ${railCollapsedBase.tokens.collapsedTrack}px`,
    );
    checkUnfocused("rail collapsed", railCollapsedBase);
    checkDoors("rail collapsed", railCollapsedBase, false);

    at("rail collapsed: enter");
    beginScenario("rail collapsed: enter");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(focusClassExpression, "the mode's shell class");
    const railCollapsedFocused = record("railCollapsedFocused", await settle());
    checkFocused("rail-collapsed", railCollapsedFocused, railCollapsedBase);
    checkDoors("rail-collapsed", railCollapsedFocused, true);
    check(
      "rail-collapsed: the dock starts at the thin rail's trailing edge",
      railCollapsedFocused.chat?.box.left ===
        railCollapsedFocused.tokens.collapsedTrack &&
        railCollapsedFocused.chat?.box.left ===
          railCollapsedFocused.rail?.box.right,
      `dock left ${railCollapsedFocused.chat?.box.left}px vs collapsed track ${railCollapsedFocused.tokens.collapsedTrack}px and rail right ${railCollapsedFocused.rail?.box.right}px`,
    );
    await capture("chat-focus-rail-collapsed.png");

    at("rail collapsed: exit");
    beginScenario("rail collapsed: exit");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(unfocusedExpression, "the page and the mode class gone");
    const railCollapsedRestored = record(
      "railCollapsedRestored",
      await settle(),
    );
    checkRestored("rail-collapsed exit", railCollapsedBase, railCollapsedRestored);

    at("restore the rail");
    beginScenario("rail restore");
    await click(".nav-rail .nav-toggle");
    await waitFor(
      `(() => {
        const shell = document.querySelector(".shell");
        const rail = document.querySelector(".nav-rail");
        return Boolean(
          shell &&
            !shell.className.includes("shell--nav-collapsed") &&
            rail &&
            Math.round(rail.getBoundingClientRect().width) === ${tokens.track},
        );
      })()`,
      "the expanded rail",
    );
    const railRestored = record("railRestored", await settle());
    checkRestored("rail restore", initial, railRestored);
    checkDoors("rail restore", railRestored, false);

    // 8 — the dock on the leading side: the mode ignores the side. The dock is
    // still immediately right of the rail, reaches the window's trailing edge
    // and draws no divider.
    at("dock left: arrangement before");
    beginScenario("dock left: base");
    await click('[data-testid="chat-side-switch"]');
    await waitFor(
      `(() => {
        const shell = document.querySelector(".shell");
        const chat = document.querySelector(".chat-panel");
        const rail = document.querySelector(".nav-rail");
        if (!shell || !chat || !rail) return false;
        return (
          shell.className.includes("shell--chat-left") &&
          Math.round(chat.getBoundingClientRect().left) ===
            Math.round(rail.getBoundingClientRect().right)
        );
      })()`,
      "the leading-side dock",
    );
    const sideLeftBase = record("sideLeftBase", await settle());
    check(
      "dock left: the dock is immediately right of the rail",
      sideLeftBase.chat?.box.left === sideLeftBase.rail?.box.right,
      `dock left ${sideLeftBase.chat?.box.left}px vs rail right ${sideLeftBase.rail?.box.right}px`,
    );
    checkUnfocused("dock left", sideLeftBase);
    checkDoors("dock left", sideLeftBase, false);

    at("dock left: enter");
    beginScenario("dock left: enter");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(focusClassExpression, "the mode's shell class");
    const sideLeftFocused = record("sideLeftFocused", await settle());
    checkFocused("dock-left", sideLeftFocused, sideLeftBase);
    checkDoors("dock-left", sideLeftFocused, true);
    check(
      "dock-left: the mode ignores the dock's side",
      sideLeftFocused.chat?.box.left === sideLeftFocused.rail?.box.right &&
        sideLeftFocused.chat?.box.right === sideLeftFocused.viewport.width &&
        sideLeftFocused.divider.present === false &&
        String(sideLeftFocused.shell?.className ?? "").includes(
          "shell--chat-left",
        ),
      `dock ${JSON.stringify(sideLeftFocused.chat?.box)}, rail right ${sideLeftFocused.rail?.box.right}px, divider ${sideLeftFocused.divider.present}, shell ${JSON.stringify(sideLeftFocused.shell?.className)}`,
    );
    await capture("chat-focus-side-left.png");

    at("dock left: exit");
    beginScenario("dock left: exit");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(unfocusedExpression, "the page and the mode class gone");
    const sideLeftRestored = record("sideLeftRestored", await settle());
    checkRestored("dock-left exit", sideLeftBase, sideLeftRestored);

    at("dock back to the trailing side");
    beginScenario("dock back");
    await click('[data-testid="chat-side-switch"]');
    await waitFor(
      `(() => {
        const shell = document.querySelector(".shell");
        return Boolean(
          shell && shell.className.includes("shell--chat-right") && !shell.className.includes("shell--chat-left"),
        );
      })()`,
      "the trailing-side dock",
    );
    const finalRestored = record("finalRestored", await settle());
    checkRestored("final", initial, finalRestored);
    checkDoors("final", finalRestored, false);

    // 9 — the dock at its floor: the card keeps the composer box's measure and
    // its row still fits inside itself at the 300px dock, because a bar that
    // spills out of its own rounded edge is the failure this shape invites.
    at("narrow dock: the card at the floor");
    beginScenario("narrow dock");
    await run(`(() => {
      document.querySelector(".shell")?.style.setProperty("--chatbar-width", "300px");
      return true;
    })()`);
    const narrowDock = record("narrowDock", await settle(360));
    check(
      "narrow dock: the dock reached its 300px floor",
      Boolean(narrowDock.chat?.box) && narrowDock.chat.box.width <= 312,
      `dock ${JSON.stringify(narrowDock.chat?.box)}`,
    );
    checkDoors("narrow dock", narrowDock, false);
    await capture("chat-focus-narrow.png");
    await run(`(() => {
      document.querySelector(".shell")?.style.removeProperty("--chatbar-width");
      return true;
    })()`);
    const narrowRestored = record("narrowRestored", await settle(360));
    checkRestored("narrow restore", initial, narrowRestored);
    checkDoors("narrow restore", narrowRestored, false);

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      tokens,
      viewport: initial.viewport,
      ...states,
      scenarios: Object.entries(scenarioFailures).map(([name, list]) => ({
        name,
        pass: list.length === 0,
        failures: list,
      })),
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
      scenarios: Object.entries(scenarioFailures).map(([name, list]) => ({
        name,
        pass: list.length === 0,
        failures: list,
      })),
      screenshots,
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "chat-focus.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [
    [
      "state",
      "shell",
      "rail L/R",
      "page L/R",
      "dock L/R/T/B",
      "ctrl",
      "divider",
    ],
  ];
  for (const [name, state] of Object.entries(states)) {
    if (!state?.shell) continue;
    rows.push([
      name,
      String(state.shell.className).replace("shell", "").trim() || "—",
      state.rail ? `${state.rail.box.left}/${state.rail.box.right}` : "none",
      state.main ? `${state.main.box.left}/${state.main.box.right}` : "none",
      state.chat
        ? `${state.chat.box.left}/${state.chat.box.right}/${state.chat.box.top}/${state.chat.box.bottom}`
        : "none",
      state.dockControl?.found
        ? `${state.dockControl.pressed}/${state.dockControl.label}`
        : "—",
      state.divider?.present ? "yes" : "no",
    ]);
  }
  const widths = rows[0].map((_, index) =>
    Math.max(...rows.map((row) => String(row[index]).length)),
  );
  for (const row of rows) {
    console.log(
      row.map((value, index) => String(value).padEnd(widths[index])).join("  "),
    );
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const file of report.screenshots ?? []) console.log(`shot: ${file}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat focus: PASS" : "chat focus: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-focus: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
