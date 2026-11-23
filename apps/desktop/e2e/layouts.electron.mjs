/**
 * Drives the layouts harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/layouts.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/layouts.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same geometry, no eyeballing the app required. It
 * carries the shipped studio before the picker is touched, the popover open over
 * that studio, the trigger/Escape/outside-press closes, both even splits (their
 * boxes, which must differ), full agent through the card and through the dock's
 * own full-screen control and Mod+Shift+F, the collapse that falls back to
 * Studio, the collapsed-dock pick that reopens the dock, the split held with the
 * rail at its icon column, and the exact round trip back to Studio.
 *
 * The picker is one control in the window strip and four buttons in a popover;
 * the arrangements it writes are the dock's own state. So the rig clicks real
 * DOM, measures real boxes, and compares the card's arrangement against the
 * state the dock's own doors produce — the card is derived from those doors and
 * must not disagree with them.
 *
 * NOT covered here: whether a real mouse can press the picker through whatever
 * is painted over it. The rig clicks the trigger and the cards with `el.click()`
 * (the same gesture the chat-side and chat-focus rigs use), so a hit-testing
 * regression is not in its path. The *outside* press and Escape, whose whole
 * point is the event path, are delivered through the browser's real input
 * pipeline.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/layouts.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The four cards, in the order the contract lists them. */
const CARD_IDS = ["studio", "page-agent", "agent-page", "agent"];
const CARD_LABELS = {
  studio: "Studio",
  "page-agent": "Page · Agent",
  "agent-page": "Agent · Page",
  agent: "Full agent",
};
/** `2.75rem` at the bench's 16px root: the layouts button's width. */
const TRIGGER_WIDTH = 2.75 * 16;
/** `--shell-frame`, measured rather than assumed; the trailing pane's slack. */
const FRAME_FALLBACK = 12;

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
  const text = (el) =>
    el ? String(el.textContent || "").replace(/\\s+/g, " ").trim() : "";
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
          expanded: el.getAttribute("aria-expanded"),
          haspopup: el.getAttribute("aria-haspopup"),
          controls: el.getAttribute("aria-controls"),
          icon: iconClass(el),
          box: box(el),
          display: styleOf(el).display,
          visibility: styleOf(el).visibility
        }
      : { found: false };

  const shell = document.querySelector(".shell");
  const rail = document.querySelector(".nav-rail");
  const main = document.querySelector(".shell__main");
  const chat = document.querySelector(".chat-panel");
  const launcher = document.querySelector(".chat-launcher");
  const divider = document.querySelector(".chat-divider");
  const tabs = document.querySelector(".chat-panel__tabs");
  const header = document.querySelector(".chat-panel__header");
  const actions = document.querySelector(".chat-panel__actions");
  const trailing = document.querySelector(".window-titlebar__trailing");
  const trigger = document.querySelector('[data-testid="layouts-trigger"]');
  const menu = document.querySelector('[data-testid="layouts-menu"]');
  const dockFullscreen = document.querySelector('[data-testid="chat-fullscreen"]');
  const dockSwap = document.querySelector('[data-testid="chat-side-switch"]');
  const dockCollapse = document.querySelector('[data-testid="chat-collapse"]');
  const navToggle = document.querySelector(".nav-rail .nav-toggle");

  const cluster = trailing
    ? Array.from(trailing.children).map((el) => ({
        tag: el.tagName.toLowerCase(),
        classes: String(el.className || ""),
        testid: el.getAttribute("data-testid"),
        label: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        expanded: el.getAttribute("aria-expanded"),
        haspopup: el.getAttribute("aria-haspopup"),
        icon: iconClass(el),
        box: box(el),
        display: styleOf(el).display,
        visibility: styleOf(el).visibility
      }))
    : [];

  const cardInfo = (card) => {
    const testid = card.getAttribute("data-testid");
    const id =
      typeof testid === "string" && testid.startsWith("layout-option-")
        ? testid.slice("layout-option-".length)
        : null;
    const thumb = card.querySelector(".layout-thumb");
    const panes = thumb
      ? Array.from(thumb.querySelectorAll(".layout-thumb__pane")).map((pane) => {
          const state = present(pane);
          return {
            pane: pane.getAttribute("data-pane"),
            box: state ? state.box : null,
            display: state ? state.display : null,
            visibility: state ? state.visibility : null,
            visible: state ? state.visible : false
          };
        })
      : [];
    const state = present(card);
    return {
      id,
      testid,
      role: card.getAttribute("role"),
      checked: card.getAttribute("aria-checked"),
      classes: String(card.className || ""),
      text: text(card),
      box: box(card),
      display: state ? state.display : null,
      visibility: state ? state.visibility : null,
      visible: state ? state.visible : false,
      thumb: thumb
        ? { present: true, classes: String(thumb.className || ""), panes }
        : { present: false, classes: "", panes: [] }
    };
  };
  const cards = menu
    ? Array.from(menu.querySelectorAll(".layouts-menu__card")).map(cardInfo)
    : [];
  const menuInfo = menu
    ? {
        present: true,
        box: box(menu),
        classes: String(menu.className || ""),
        role: menu.getAttribute("role"),
        label: menu.getAttribute("aria-label"),
        text: text(menu),
        parentIsBody: menu.parentElement === document.body,
        insideAppRoot: Boolean(menu.closest(".app-root")),
        insideShell: Boolean(menu.closest(".shell")),
        sectionTitles: Array.from(
          menu.querySelectorAll(".settings-menu__section-title")
        ).map(text),
        cardCount: cards.length,
        cards,
        activeCards: cards
          .filter((card) => card.checked === "true")
          .map((card) => card.id)
      }
    : {
        present: false,
        box: null,
        classes: "",
        role: null,
        label: null,
        text: "",
        parentIsBody: false,
        insideAppRoot: false,
        insideShell: false,
        sectionTitles: [],
        cardCount: 0,
        cards: [],
        activeCards: []
      };

  const active = document.activeElement;
  const activeState =
    active && active !== document.body
      ? {
          tag: active.tagName.toLowerCase(),
          testid: active.getAttribute("data-testid"),
          label: active.getAttribute("aria-label"),
          insideTrigger: Boolean(trigger && trigger.contains(active))
        }
      : {
          tag: active ? active.tagName.toLowerCase() : null,
          testid: null,
          label: null,
          insideTrigger: false
        };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const railBox = rail ? box(rail) : null;
  const railRight = railBox ? railBox.right : 0;

  const owner = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (rail && rail.contains(el)) return "rail";
    if (launcher && launcher.contains(el)) return "launcher";
    if (chat && chat.contains(el)) return "dock";
    if (main && main.contains(el)) return "main";
    if (document.querySelector(".window-titlebar")?.contains(el)) {
      return "titlebar";
    }
    return "other";
  };

  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;height:0;width:var(--shell-nav-width)";
  document.body.appendChild(probe);
  const track = probe.offsetWidth;
  probe.style.width = "var(--shell-nav-width-collapsed)";
  const collapsedTrack = probe.offsetWidth;
  probe.style.width = "var(--shell-frame)";
  const frame = probe.offsetWidth;
  probe.remove();

  const rootStyle = getComputedStyle(document.documentElement);
  const titlebarHeight = px(
    rootStyle.getPropertyValue("--window-titlebar-height")
  );
  const rootFontSize = parseFloat(
    getComputedStyle(document.documentElement).fontSize
  );

  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    tokens: { track, collapsedTrack, frame, titlebarHeight, rootFontSize },
    route:
      typeof window.__layoutsHarnessRoute === "string"
        ? window.__layoutsHarnessRoute
        : null,
    keys: Array.isArray(window.__layoutsHarnessKeys)
      ? window.__layoutsHarnessKeys.slice()
      : null,
    shell: shell
      ? {
          className: String(shell.className),
          dataLayout: shell.getAttribute("data-layout"),
          gridTemplateColumns: styleOf(shell).gridTemplateColumns,
          box: box(shell)
        }
      : null,
    rail: rail
      ? {
          box: box(rail),
          display: styleOf(rail).display,
          visibility: styleOf(rail).visibility
        }
      : null,
    main: main
      ? {
          box: box(main),
          display: styleOf(main).display,
          visibility: styleOf(main).visibility
        }
      : null,
    chat: chat
      ? {
          box: box(chat),
          display: styleOf(chat).display,
          visibility: styleOf(chat).visibility,
          className: String(chat.className)
        }
      : null,
    launcher: launcher
      ? { box: box(launcher), position: styleOf(launcher).position }
      : null,
    divider: { present: Boolean(divider), box: divider ? box(divider) : null },
    trailing: trailing
      ? { present: true, box: box(trailing), childCount: trailing.children.length }
      : { present: false, box: null, childCount: 0 },
    cluster,
    trigger: control(trigger),
    menu: menuInfo,
    dock: {
      fullscreen: control(dockFullscreen),
      swap: control(dockSwap),
      collapse: control(dockCollapse)
    },
    navToggle: control(navToggle),
    content: {
      tabs: present(tabs),
      header: present(header),
      actions: present(actions)
    },
    owners: {
      atRailRight: owner(Math.round(railRight) + 12, 400),
      atGlass: owner(viewportWidth - 12, 400),
      bottomRight: owner(viewportWidth - 2, viewportHeight - 4),
      bottomLeft: owner(2, viewportHeight - 4)
    },
    focus: activeState,
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
const classesOf = (state) => String(state?.shell?.className ?? "");
const hasClass = (state, name) =>
  classesOf(state).split(/\s+/).includes(name);

/**
 * The window strip's trailing cluster: the layouts control leads the shipped
 * pair (day/night, gear), and the three are the same 2.75rem button. A control
 * that exists somewhere else in the strip is not a control the operator finds.
 */
function checkCluster(label, state) {
  const strip = state.trailing;
  check(
    `${label}: the window strip's trailing cluster is on screen`,
    strip?.present === true && Boolean(strip?.box),
    `trailing ${JSON.stringify(strip)}`,
  );
  const cluster = Array.isArray(state.cluster) ? state.cluster : [];
  check(
    `${label}: the trailing cluster holds exactly the three controls`,
    strip?.childCount === 3 && cluster.length === 3,
    `cluster ${JSON.stringify(cluster.map((entry) => entry.classes))}`,
  );
  check(
    `${label}: the layouts control leads the cluster`,
    String(cluster[0]?.classes ?? "").includes("layouts-menu__trigger") &&
      cluster[0]?.testid === "layouts-trigger",
    `first cluster item ${JSON.stringify(cluster[0])}`,
  );
  check(
    `${label}: the day/night control follows the layouts control`,
    String(cluster[1]?.classes ?? "").includes("theme-mode-toggle"),
    `second cluster item ${JSON.stringify(cluster[1]?.classes)}`,
  );
  check(
    `${label}: the gear trails the cluster`,
    String(cluster[2]?.classes ?? "").includes("settings-menu"),
    `third cluster item ${JSON.stringify(cluster[2]?.classes)}`,
  );
  const boxes = cluster.map((entry) => entry.box);
  check(
    `${label}: the three strip controls are drawn left to right`,
    Boolean(boxes[0] && boxes[1] && boxes[2]) &&
      boxes[0].right <= boxes[1].left &&
      boxes[1].right <= boxes[2].left,
    `boxes ${JSON.stringify(boxes)}`,
  );
  check(
    `${label}: the three strip controls are the same 2.75rem button`,
    Boolean(boxes[0] && boxes[1] && boxes[2]) &&
      near(boxes[0].width, TRIGGER_WIDTH, 1) &&
      near(boxes[1].width, TRIGGER_WIDTH, 1) &&
      near(boxes[2].width, TRIGGER_WIDTH, 1),
    `widths ${JSON.stringify(boxes.map((entry) => entry?.width))} vs ${TRIGGER_WIDTH}px`,
  );
  check(
    `${label}: the three strip controls are 100% tall and share the strip's band`,
    Boolean(boxes[0] && boxes[1] && boxes[2]) &&
      near(boxes[0].height, state.tokens?.titlebarHeight, 1) &&
      near(boxes[0].height, boxes[1].height, 1) &&
      near(boxes[0].height, boxes[2].height, 1) &&
      near(boxes[0].top, boxes[1].top, 1) &&
      near(boxes[0].bottom, boxes[1].bottom, 1) &&
      near(boxes[1].top, boxes[2].top, 1) &&
      near(boxes[1].bottom, boxes[2].bottom, 1),
    `heights ${JSON.stringify(boxes.map((entry) => entry?.height))}, tops ${JSON.stringify(boxes.map((entry) => entry?.top))} vs strip ${state.tokens?.titlebarHeight}px`,
  );
}

/** The layouts trigger itself, in the cluster, wearing the contract's marks. */
function checkTrigger(label, state, expanded) {
  const trigger = state.trigger;
  check(
    `${label}: the strip carries the layouts control`,
    trigger?.found === true,
    "no [data-testid=layouts-trigger] in the strip",
  );
  if (!trigger?.found) return;
  check(
    `${label}: the control is marked as the layouts door`,
    String(trigger.classes ?? "").includes("layouts-menu__trigger") &&
      String(trigger.classes ?? "").includes("window-titlebar__btn"),
    `classes ${JSON.stringify(trigger.classes)}`,
  );
  check(
    `${label}: the control names itself Layouts`,
    trigger.label === "Layouts" && trigger.title === "Layouts",
    `aria-label ${JSON.stringify(trigger.label)}, title ${JSON.stringify(trigger.title)}`,
  );
  check(
    `${label}: the control announces a menu`,
    trigger.haspopup === "menu",
    `aria-haspopup ${JSON.stringify(trigger.haspopup)}`,
  );
  check(
    `${label}: the control's expanded state follows the popover`,
    trigger.expanded === String(expanded),
    `aria-expanded ${JSON.stringify(trigger.expanded)} (want ${expanded})`,
  );
  check(
    `${label}: the control wears a lucide icon`,
    typeof trigger.icon === "string" && trigger.icon.includes("lucide-"),
    `icon ${JSON.stringify(trigger.icon)}`,
  );
  check(
    `${label}: the control is painted`,
    Boolean(trigger.box) &&
      trigger.display !== "none" &&
      trigger.visibility !== "hidden" &&
      trigger.box.width > 0 &&
      trigger.box.height > 0,
    `trigger ${JSON.stringify(trigger)}`,
  );
  check(
    `${label}: the control is the leading item of the cluster`,
    state.cluster?.[0]?.testid === "layouts-trigger",
    `first cluster testid ${JSON.stringify(state.cluster?.[0]?.testid)}`,
  );
}

/**
 * The popover: portalled to the body, titled, and holding exactly the four
 * `menuitemradio` cards with one checked — the active arrangement's.
 */
function checkMenu(label, state, expectedActive) {
  const menu = state.menu;
  check(
    `${label}: the popover is open`,
    menu?.present === true,
    `menu ${JSON.stringify(menu?.present)}`,
  );
  if (!menu?.present) return;
  check(
    `${label}: the popover is a menu named Layouts`,
    menu.role === "menu" && menu.label === "Layouts",
    `role ${JSON.stringify(menu.role)}, aria-label ${JSON.stringify(menu.label)}`,
  );
  check(
    `${label}: the popover wears the shipped popover classes`,
    String(menu.classes).includes("settings-menu__popover") &&
      String(menu.classes).includes("settings-menu__popover--portal") &&
      String(menu.classes).includes("layouts-menu__popover"),
    `classes ${JSON.stringify(menu.classes)}`,
  );
  check(
    `${label}: the popover is portalled to the body, not drawn inside the shell`,
    menu.parentIsBody === true &&
      menu.insideAppRoot === false &&
      menu.insideShell === false,
    `parentIsBody ${menu.parentIsBody}, insideAppRoot ${menu.insideAppRoot}, insideShell ${menu.insideShell}`,
  );
  check(
    `${label}: the popover carries the section title "Layouts"`,
    Array.isArray(menu.sectionTitles) &&
      menu.sectionTitles.some((title) => String(title).includes("Layouts")),
    `section titles ${JSON.stringify(menu.sectionTitles)}`,
  );
  check(
    `${label}: the popover is painted on the window`,
    Boolean(menu.box) &&
      menu.box.width > 0 &&
      menu.box.height > 0 &&
      menu.box.left >= 0 &&
      menu.box.top >= 0 &&
      menu.box.right <= state.viewport.width &&
      menu.box.bottom <= state.viewport.height,
    `box ${JSON.stringify(menu.box)} of ${JSON.stringify(state.viewport)}`,
  );

  const cards = Array.isArray(menu.cards) ? menu.cards : [];
  check(
    `${label}: the popover holds exactly four cards`,
    menu.cardCount === 4 && cards.length === 4,
    `card count ${menu.cardCount}`,
  );
  check(
    `${label}: the four cards are Studio, Page · Agent, Agent · Page, Full agent`,
    same(
      cards.map((card) => card.id),
      CARD_IDS,
    ),
    `cards ${JSON.stringify(cards.map((card) => card.id))}`,
  );
  for (const id of CARD_IDS) {
    const card = cards.find((entry) => entry.id === id);
    check(
      `${label}: the ${CARD_LABELS[id]} card is drawn`,
      Boolean(card) &&
        card.visible === true &&
        card.display !== "none" &&
        String(card.classes).includes("layouts-menu__card"),
      `card ${JSON.stringify(card && { classes: card.classes, box: card.box })}`,
    );
    if (!card) continue;
    check(
      `${label}: the ${CARD_LABELS[id]} card is a radio item`,
      card.role === "menuitemradio",
      `role ${JSON.stringify(card.role)}`,
    );
    check(
      `${label}: the ${CARD_LABELS[id]} card is labelled correctly`,
      card.text === CARD_LABELS[id],
      `text ${JSON.stringify(card.text)} (want ${JSON.stringify(CARD_LABELS[id])})`,
    );
    check(
      `${label}: the ${CARD_LABELS[id]} card draws its own thumbnail`,
      card.thumb?.present === true &&
        String(card.thumb.classes).includes("layout-thumb") &&
        String(card.thumb.classes).includes(`layout-thumb--${id}`),
      `thumbnail ${JSON.stringify(card.thumb?.classes)}`,
    );
    const panes = card.thumb?.panes ?? [];
    const pane = (name) => panes.find((entry) => entry.pane === name) ?? null;
    check(
      `${label}: the ${CARD_LABELS[id]} card's rail pane is always drawn`,
      Boolean(pane("rail")?.visible),
      `panes ${JSON.stringify(panes)}`,
    );
    check(
      `${label}: the ${CARD_LABELS[id]} card's agent pane is drawn`,
      Boolean(pane("agent")?.visible),
      `panes ${JSON.stringify(panes)}`,
    );
    if (id === "agent") {
      check(
        `${label}: the Full agent card draws no page pane`,
        pane("page") === null || pane("page").visible === false,
        `panes ${JSON.stringify(panes)}`,
      );
    } else {
      check(
        `${label}: the ${CARD_LABELS[id]} card draws its page pane`,
        Boolean(pane("page")?.visible),
        `panes ${JSON.stringify(panes)}`,
      );
    }
  }

  const active = Array.isArray(menu.activeCards) ? menu.activeCards : [];
  check(
    `${label}: exactly one card reads as active`,
    active.length === 1,
    `checked cards ${JSON.stringify(active)}`,
  );
  check(
    `${label}: the active card is ${CARD_LABELS[expectedActive]}`,
    active.length === 1 && active[0] === expectedActive,
    `checked cards ${JSON.stringify(active)} (want ${JSON.stringify(expectedActive)})`,
  );
  for (const card of cards) {
    const checked = card.checked === "true";
    check(
      `${label}: ${CARD_LABELS[card.id]} card's checked state is a boolean string`,
      card.checked === "true" || card.checked === "false",
      `aria-checked ${JSON.stringify(card.checked)}`,
    );
    check(
      `${label}: ${CARD_LABELS[card.id]} card's is-active class matches its check state`,
      checked === String(card.classes).split(/\s+/).includes("is-active"),
      `aria-checked ${JSON.stringify(card.checked)}, classes ${JSON.stringify(card.classes)}`,
    );
  }
}

function checkClosed(label, state) {
  check(
    `${label}: the popover is closed`,
    state.menu?.present === false,
    `menu ${JSON.stringify(state.menu?.present)}`,
  );
  check(
    `${label}: the trigger reports the popover closed`,
    state.trigger?.expanded === "false",
    `aria-expanded ${JSON.stringify(state.trigger?.expanded)}`,
  );
}

function checkPagePainted(label, state) {
  check(
    `${label}: the page is painted`,
    Boolean(state.main) &&
      state.main.display !== "none" &&
      state.main.visibility !== "hidden" &&
      state.main.box.width > 0 &&
      state.main.box.height > 0,
    `main ${JSON.stringify(state.main)}`,
  );
}

function checkDockPainted(label, state) {
  check(
    `${label}: the dock is painted`,
    Boolean(state.chat) &&
      state.chat.display !== "none" &&
      state.chat.visibility !== "hidden" &&
      state.chat.box.width > 0,
    `dock ${JSON.stringify(state.chat)}`,
  );
}

/**
 * The shipped studio: the dock at its own width, the page beside it, the seam's
 * handle drawn. With `base` the whole arrangement must be box-for-box the
 * starting one (the exact round trip).
 */
function checkStudio(label, state, base) {
  check(
    `${label}: the shell announces the studio arrangement`,
    state.shell?.dataLayout === "studio",
    `data-layout ${JSON.stringify(state.shell?.dataLayout)}`,
  );
  check(
    `${label}: the shell is neither split nor full-agent`,
    !hasClass(state, "shell--layout-split") &&
      !hasClass(state, "shell--chat-focus"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the dock is open`,
    hasClass(state, "shell--chat-open") && !hasClass(state, "shell--chat-collapsed"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  const railWidth = state.rail?.box?.width ?? state.tokens?.track;
  check(
    `${label}: the rail holds the window's leading edge`,
    Boolean(state.rail) &&
      state.rail.display !== "none" &&
      state.rail.box.left === 0 &&
      state.rail.box.top === 0 &&
      state.rail.box.width === railWidth,
    `rail ${JSON.stringify(state.rail)}`,
  );
  checkPagePainted(label, state);
  checkDockPainted(label, state);
  // Studio is "the dock at its own width, current side": the two cards that
  // split the frame set the side, and Studio keeps it rather than snapping the
  // dock back to the shipped corner. Both arrangements are the studio; the one
  // the run started from is the trailing one.
  const dockLeads = hasClass(state, "shell--chat-left");
  check(
    `${label}: the studio's two panes abut in the side's order`,
    Boolean(state.main?.box && state.chat?.box) &&
      (dockLeads
        ? state.chat.box.left === state.rail?.box?.right &&
          state.main.box.left === state.chat.box.right
        : state.main.box.left === state.rail?.box?.right &&
          state.chat.box.left === state.main.box.right),
    `rail right ${state.rail?.box?.right}px, page ${JSON.stringify(state.main?.box)}, dock ${JSON.stringify(state.chat?.box)}`,
  );
  check(
    `${label}: the trailing pane reaches the window's trailing glass`,
    (dockLeads ? state.main?.box?.right : state.chat?.box?.right) ===
      state.viewport.width,
    `page right ${state.main?.box?.right}px, dock right ${state.chat?.box?.right}px vs window ${state.viewport.width}px`,
  );
  check(
    `${label}: the studio keeps the dock at its own width, not a split half`,
    Boolean(state.main?.box && state.chat?.box) &&
      state.chat.box.width < state.viewport.width - (state.rail?.box?.width ?? 0),
    `dock width ${state.chat?.box?.width}px`,
  );
  check(
    `${label}: the studio's seam is draggable`,
    state.divider.present === true,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: no floating launcher is on screen`,
    state.launcher === null,
    `launcher ${JSON.stringify(state.launcher)}`,
  );
  check(
    `${label}: the pane beside the rail is the one the side names`,
    state.owners?.atRailRight === (dockLeads ? "dock" : "main"),
    `owner just right of the rail ${JSON.stringify(state.owners?.atRailRight)}`,
  );
  check(
    `${label}: the window's bottom-right corner is the one the side names`,
    state.owners?.bottomRight === (dockLeads ? "main" : "dock"),
    `bottom-right owner ${JSON.stringify(state.owners?.bottomRight)}`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );
  check(
    `${label}: nothing spills past the window`,
    state.overflow.scrollWidth <= state.viewport.width &&
      state.overflow.clientWidth <= state.viewport.width,
    `scrollWidth ${state.overflow.scrollWidth}px vs window ${state.viewport.width}px`,
  );
  if (base) checkRestoredStudio(label, base, state);
}

/** The exact pre-pick studio, compared box for box. */
function checkRestoredStudio(label, before, after) {
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
    `${JSON.stringify(after.shell?.gridTemplateColumns)} vs ${JSON.stringify(before.shell?.gridTemplateColumns)}`,
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
    `${label}: the divider is back on the studio seam`,
    after.divider.present === before.divider.present,
    `divider ${JSON.stringify(after.divider.present)} vs ${JSON.stringify(before.divider.present)}`,
  );
  check(
    `${label}: the panes paint the same corners again`,
    same(after.owners, before.owners),
    `${JSON.stringify(after.owners)} vs ${JSON.stringify(before.owners)}`,
  );
  check(
    `${label}: the launcher is still not on screen`,
    after.launcher === null,
    `launcher ${JSON.stringify(after.launcher)}`,
  );
}

/**
 * An even split: after the rail the page and the agent take a half each, the
 * leading pane abuts the rail, the trailing pane carries the frame's slack to
 * the window's trailing glass, and no divider is drawn.
 */
function checkSplit(label, state, layout) {
  const pageLeads = layout === "page-agent";
  const railRight = state.rail?.box?.right ?? 0;
  const remaining = state.viewport.width - railRight;
  const half = remaining / 2;
  const midpoint = railRight + half;

  check(
    `${label}: the shell announces the ${layout} arrangement`,
    state.shell?.dataLayout === layout,
    `data-layout ${JSON.stringify(state.shell?.dataLayout)}`,
  );
  check(
    `${label}: the shell wears the even-split class`,
    hasClass(state, "shell--layout-split"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the shell announces which pane leads`,
    hasClass(state, pageLeads ? "shell--chat-right" : "shell--chat-left"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the shell is neither full-agent nor collapsed`,
    !hasClass(state, "shell--chat-focus") &&
      !hasClass(state, "shell--chat-collapsed") &&
      hasClass(state, "shell--chat-open"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the rail still holds the window's leading edge`,
    Boolean(state.rail) &&
      state.rail.display !== "none" &&
      state.rail.box.left === 0 &&
      state.rail.box.width > 0,
    `rail ${JSON.stringify(state.rail)}`,
  );
  checkPagePainted(label, state);
  checkDockPainted(label, state);
  check(
    `${label}: the leading pane abuts the rail's trailing edge`,
    (pageLeads ? state.main?.box?.left : state.chat?.box?.left) === railRight,
    `${pageLeads ? "page" : "agent"} left ${pageLeads ? state.main?.box?.left : state.chat?.box?.left}px vs rail right ${railRight}px`,
  );
  check(
    `${label}: the trailing pane reaches the window's trailing glass`,
    (pageLeads ? state.chat?.box?.right : state.main?.box?.right) ===
      state.viewport.width,
    `trailing right ${pageLeads ? state.chat?.box?.right : state.main?.box?.right}px vs window ${state.viewport.width}px`,
  );
  check(
    `${label}: the two panes abut with no gutter between them`,
    (pageLeads ? state.main?.box?.right : state.chat?.box?.right) ===
      (pageLeads ? state.chat?.box?.left : state.main?.box?.left),
    `page ${JSON.stringify(state.main?.box)} vs agent ${JSON.stringify(state.chat?.box)}`,
  );
  check(
    `${label}: the seam sits halfway across the frame after the rail`,
    Boolean(
      (pageLeads ? state.chat?.box?.left : state.main?.box?.left) !== undefined,
    ) &&
      near(
        pageLeads ? state.chat?.box?.left : state.main?.box?.left,
        midpoint,
        2,
      ),
    `seam ${pageLeads ? state.chat?.box?.left : state.main?.box?.left}px vs midpoint ${midpoint}px (rail right ${railRight}px, window ${state.viewport.width}px)`,
  );
  check(
    `${label}: the two panes are the same width`,
    Boolean(state.main?.box && state.chat?.box) &&
      near(state.main.box.width, state.chat.box.width, 2),
    `page ${state.main?.box?.width}px vs agent ${state.chat?.box?.width}px`,
  );
  check(
    `${label}: the split is half the frame after the rail each`,
    Boolean(state.main?.box && state.chat?.box) &&
      near(state.main.box.width, half, 2) &&
      near(state.chat.box.width, half, 2),
    `page ${state.main?.box?.width}px, agent ${state.chat?.box?.width}px vs half ${half}px`,
  );
  check(
    `${label}: the split draws no divider`,
    state.divider.present === false,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: no floating launcher is on screen`,
    state.launcher === null,
    `launcher ${JSON.stringify(state.launcher)}`,
  );
  for (const [name, rect] of [
    ["tab strip", state.content?.tabs],
    ["bottom action bar", state.content?.actions],
  ]) {
    check(
      `${label}: the dock still draws its ${name}`,
      Boolean(rect) && rect.visible === true,
      `${name} ${JSON.stringify(rect)}`,
    );
  }
  check(
    `${label}: the dock meets the window strip and the window bottom`,
    Boolean(state.chat?.box && state.tokens) &&
      near(state.chat.box.top, state.tokens.titlebarHeight, 1) &&
      state.chat.box.bottom === state.viewport.height,
    `dock ${JSON.stringify(state.chat?.box)} vs strip ${state.tokens?.titlebarHeight}px, window ${state.viewport.height}px`,
  );
  check(
    `${label}: the page also reaches the window bottom`,
    Boolean(state.main?.box) && state.main.box.bottom === state.viewport.height,
    `page ${JSON.stringify(state.main?.box)}`,
  );
  check(
    `${label}: the panes own the columns the split names`,
    (pageLeads && state.owners?.atRailRight === "main" &&
      state.owners?.atGlass === "dock") ||
      (!pageLeads && state.owners?.atRailRight === "dock" &&
        state.owners?.atGlass === "main"),
    `owner right of rail ${JSON.stringify(state.owners?.atRailRight)}, owner at glass ${JSON.stringify(state.owners?.atGlass)}`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );
  check(
    `${label}: nothing spills past the window`,
    state.overflow.scrollWidth <= state.viewport.width &&
      state.overflow.clientWidth <= state.viewport.width,
    `scrollWidth ${state.overflow.scrollWidth}px vs window ${state.viewport.width}px`,
  );
}

/** Full agent: the dock's own full-screen state, reached from the card. */
function checkAgent(label, state, base) {
  check(
    `${label}: the shell announces the full-agent arrangement`,
    state.shell?.dataLayout === "agent",
    `data-layout ${JSON.stringify(state.shell?.dataLayout)}`,
  );
  check(
    `${label}: the shell wears the full-screen chat class`,
    hasClass(state, "shell--chat-focus"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the shell is neither split nor collapsed`,
    !hasClass(state, "shell--layout-split") &&
      !hasClass(state, "shell--chat-collapsed") &&
      hasClass(state, "shell--chat-open"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: the page is not painted`,
    !state.main ||
      state.main.display === "none" ||
      (state.main.box.width === 0 && state.main.box.height === 0),
    `main ${JSON.stringify(state.main)}`,
  );
  checkDockPainted(label, state);
  check(
    `${label}: the agent starts at the rail's trailing edge`,
    state.chat?.box?.left === state.rail?.box?.right,
    `dock left ${state.chat?.box?.left}px vs rail right ${state.rail?.box?.right}px`,
  );
  check(
    `${label}: the agent fills the workspace to the window's glass`,
    state.chat?.box?.right === state.viewport.width &&
      near(state.chat?.box?.top, state.tokens?.titlebarHeight, 1) &&
      state.chat?.box?.bottom === state.viewport.height,
    `dock ${JSON.stringify(state.chat?.box)} vs window ${JSON.stringify(state.viewport)}, strip ${state.tokens?.titlebarHeight}px`,
  );
  check(
    `${label}: the full agent draws no divider`,
    state.divider.present === false,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: the workspace beside the rail is the dock`,
    state.owners?.atRailRight === "dock" && state.owners?.atGlass === "dock",
    `owner right of rail ${JSON.stringify(state.owners?.atRailRight)}, owner at glass ${JSON.stringify(state.owners?.atGlass)}`,
  );
  check(
    `${label}: no floating launcher is on screen`,
    state.launcher === null,
    `launcher ${JSON.stringify(state.launcher)}`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );
  if (base) {
    check(
      `${label}: the rail box is the one the run started from`,
      same(state.rail?.box, base.rail?.box),
      `${JSON.stringify(state.rail?.box)} vs ${JSON.stringify(base.rail?.box)}`,
    );
  }
}

/** Two states that must be the same shipped arrangement, box for box. */
function checkSameArrangement(label, a, b) {
  for (const [name, left, right] of [
    ["shell class list", a.shell?.className, b.shell?.className],
    ["data-layout", a.shell?.dataLayout, b.shell?.dataLayout],
    ["shell box", a.shell?.box, b.shell?.box],
    ["grid tracks", a.shell?.gridTemplateColumns, b.shell?.gridTemplateColumns],
    ["rail box", a.rail?.box, b.rail?.box],
    ["page box", a.main?.box, b.main?.box],
    ["dock box", a.chat?.box, b.chat?.box],
    ["divider", a.divider, b.divider],
    ["corners", a.owners, b.owners],
  ]) {
    check(
      `${label}: the ${name} matches the dock's own full-screen state`,
      same(left, right),
      `${JSON.stringify(left)} vs ${JSON.stringify(right)}`,
    );
  }
}

/** Collapsing the dock leaves no split: the arrangement falls back to Studio. */
function checkCollapsed(label, state) {
  check(
    `${label}: the shell is collapsed`,
    hasClass(state, "shell--chat-collapsed") &&
      !hasClass(state, "shell--chat-open") &&
      !hasClass(state, "shell--layout-split") &&
      !hasClass(state, "shell--chat-focus"),
    `shell classes ${JSON.stringify(state.shell?.className)}`,
  );
  check(
    `${label}: collapsing the dock leaves no split and falls back to Studio`,
    state.shell?.dataLayout === "studio",
    `data-layout ${JSON.stringify(state.shell?.dataLayout)}`,
  );
  check(
    `${label}: the dock pane leaves the grid`,
    state.chat === null,
    `dock ${JSON.stringify(state.chat)}`,
  );
  check(
    `${label}: the floating launcher is on screen`,
    Boolean(state.launcher) && state.launcher.position === "fixed",
    `launcher ${JSON.stringify(state.launcher)}`,
  );
  checkPagePainted(label, state);
  check(
    `${label}: the page owns the workspace beside the rail again`,
    state.owners?.atRailRight === "main",
    `owner just right of the rail ${JSON.stringify(state.owners?.atRailRight)}`,
  );
  check(
    `${label}: no divider is drawn with the dock gone`,
    state.divider.present === false,
    `divider ${JSON.stringify(state.divider)}`,
  );
  check(
    `${label}: the popover is closed`,
    state.menu?.present === false,
    `menu ${JSON.stringify(state.menu?.present)}`,
  );
  check(
    `${label}: the page route is unchanged`,
    state.route === "/home",
    `route ${JSON.stringify(state.route)}`,
  );
}

/** Mod+Shift+F arrived as a trusted keydown and moved the layout both ways. */
function checkShortcutKeys(label, state, expectedCount) {
  const keys = Array.isArray(state.keys)
    ? state.keys.filter(
        (key) =>
          typeof key?.key === "string" && key.key.toLowerCase() === "f",
      )
    : [];
  check(
    `${label}: every pressed Mod+Shift+F was recorded by the page`,
    keys.length === expectedCount,
    `${keys.length} F keydowns (want ${expectedCount}): ${JSON.stringify(keys)}`,
  );
  for (const key of keys) {
    check(
      `${label}: the browser delivered a trusted Ctrl+Shift+F keydown`,
      key.ctrl === true &&
        key.shift === true &&
        key.alt === false &&
        key.meta === false &&
        key.trusted === true,
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

  const run = (expression) =>
    win.webContents.executeJavaScript(expression, true);
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
          if (typeof window.__layoutsHarnessReady !== "object") return null;
          await window.__layoutsHarnessReady;
          return typeof window.__layoutsHarnessVaultName === "string"
            ? window.__layoutsHarnessVaultName
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

  /** A real key press through the browser's input pipeline, as an operator's
   *  keyboard delivers it — not a synthetic DOM event. */
  const press = async (keyCode, modifiers = []) => {
    await blurActive();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    await sleep(30);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(140);
    await frames();
  };

  /** A real pointer press at a point, so the outside-press dismissal is tested
   *  through the event path an operator's mouse actually uses. */
  const pressAt = async (x, y) => {
    win.webContents.sendInputEvent({ type: "mouseMove", x, y });
    await sleep(20);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await sleep(20);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await sleep(140);
    await frames();
  };

  const menuOpenExpression = `(() => {
    const menu = document.querySelector('[data-testid="layouts-menu"]');
    const trigger = document.querySelector('[data-testid="layouts-trigger"]');
    return Boolean(
      menu && trigger && trigger.getAttribute("aria-expanded") === "true"
    );
  })()`;
  const menuClosedExpression = `(() => {
    const menu = document.querySelector('[data-testid="layouts-menu"]');
    const trigger = document.querySelector('[data-testid="layouts-trigger"]');
    return Boolean(
      !menu && trigger && trigger.getAttribute("aria-expanded") === "false"
    );
  })()`;
  const layoutExpression = (layout) => `(() => {
    const shell = document.querySelector(".shell");
    return Boolean(shell && shell.getAttribute("data-layout") === ${JSON.stringify(layout)});
  })()`;
  const splitExpression = (layout) => `(() => {
    const shell = document.querySelector(".shell");
    if (!shell || shell.getAttribute("data-layout") !== ${JSON.stringify(layout)}) return false;
    const main = document.querySelector(".shell__main");
    const chat = document.querySelector(".chat-panel");
    if (!main || !chat) return false;
    const mainBox = main.getBoundingClientRect();
    const chatBox = chat.getBoundingClientRect();
    const railBox = document.querySelector(".nav-rail")?.getBoundingClientRect();
    if (!railBox) return false;
    const pageLeads = ${JSON.stringify(layout)} === "page-agent";
    const leadingLeft = pageLeads ? mainBox.left : chatBox.left;
    const trailingRight = pageLeads ? chatBox.right : mainBox.right;
    return Boolean(
      shell.className.includes("shell--layout-split") &&
        Math.round(leadingLeft) === Math.round(railBox.right) &&
        Math.round(trailingRight) === window.innerWidth &&
        !document.querySelector(".chat-divider")
    );
  })()`;
  const studioExpression = `(() => {
    const shell = document.querySelector(".shell");
    const main = document.querySelector(".shell__main");
    const chat = document.querySelector(".chat-panel");
    return Boolean(
      shell &&
        shell.getAttribute("data-layout") === "studio" &&
        !shell.className.includes("shell--layout-split") &&
        !shell.className.includes("shell--chat-focus") &&
        main &&
        chat &&
        getComputedStyle(main).display !== "none" &&
        document.querySelector(".chat-divider")
    );
  })()`;
  const agentExpression = `(() => {
    const shell = document.querySelector(".shell");
    const main = document.querySelector(".shell__main");
    const chat = document.querySelector(".chat-panel");
    if (!shell || !chat) return false;
    const mainPainted =
      main &&
      getComputedStyle(main).display !== "none" &&
      main.getBoundingClientRect().width > 0;
    return Boolean(
      shell.getAttribute("data-layout") === "agent" &&
        shell.className.includes("shell--chat-focus") &&
        !mainPainted
    );
  })()`;
  const collapsedExpression = `(() => {
    const shell = document.querySelector(".shell");
    const launcher = document.querySelector(".chat-launcher");
    return Boolean(
      shell &&
        shell.className.includes("shell--chat-collapsed") &&
        !document.querySelector(".chat-panel") &&
        launcher
    );
  })()`;
  const reopenedExpression = `(() => {
    const shell = document.querySelector(".shell");
    return Boolean(
      shell &&
        document.querySelector(".chat-panel") &&
        !document.querySelector(".chat-launcher") &&
        !shell.className.includes("shell--chat-collapsed")
    );
  })()`;
  const railCollapsedExpression = `(() => {
    const shell = document.querySelector(".shell");
    const rail = document.querySelector(".nav-rail");
    return Boolean(
      shell &&
        shell.className.includes("shell--nav-collapsed") &&
        rail &&
        Math.round(rail.getBoundingClientRect().width) === 56
    );
  })()`;
  const studioRightExpression = `(() => {
    const shell = document.querySelector(".shell");
    return Boolean(
      shell &&
        shell.getAttribute("data-layout") === "studio" &&
        shell.className.includes("shell--chat-open") &&
        shell.className.includes("shell--chat-right") &&
        !shell.className.includes("shell--layout-split") &&
        !shell.className.includes("shell--chat-focus") &&
        document.querySelector(".chat-divider")
    );
  })()`;
  const railExpandedExpression = `(() => {
    const shell = document.querySelector(".shell");
    const rail = document.querySelector(".nav-rail");
    return Boolean(
      shell &&
        !shell.className.includes("shell--nav-collapsed") &&
        rail &&
        Math.round(rail.getBoundingClientRect().width) === 256
    );
  })()`;

  /** Open the picker and confirm it appeared, then sample it. */
  const openMenu = async (name) => {
    at(`${name}: open`);
    await click('[data-testid="layouts-trigger"]');
    await waitFor(menuOpenExpression, "the layouts popover");
    return settle();
  };
  /** Close the picker with the trigger and confirm the layout did not move. */
  const closeMenu = async (name) => {
    at(`${name}: close with the trigger`);
    await click('[data-testid="layouts-trigger"]');
    await waitFor(menuClosedExpression, "the layouts popover to close");
    return settle();
  };
  /** Open, check the active card, then close — the derived-state read. */
  const checkActiveCard = async (name, expected, recordAs) => {
    const state = await openMenu(`${name}: active card`);
    checkMenu(`${name} active`, state, expected);
    if (recordAs) record(recordAs, state);
    const after = await closeMenu(`${name}: active card`);
    checkClosed(`${name} active`, after);
    return state;
  };
  /** Pick a card from an already-open popover. */
  const pick = async (name, layout) => {
    at(`${name}: pick ${layout}`);
    await click(`[data-testid="layout-option-${layout}"]`);
    const expected =
      layout === "agent"
        ? agentExpression
        : layout === "studio"
          ? studioExpression
          : splitExpression(layout);
    await waitFor(expected, `the ${layout} arrangement`);
    return settle();
  };

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
    console.error("layouts: timed out after 180s");
    app.exit(1);
  }, 180_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(300);
    win.showInactive();
    // The controls are checked for their resting look, not a hover.
    await parkPointer();

    // 1 — the shipped studio, before the picker is touched.
    at("studio: shipped arrangement");
    beginScenario("studio: shipped arrangement");
    const initial = record("initial", await settle());
    initial.vaultName = vaultName;
    const tokens = initial.tokens;
    check(
      "studio: the window is 1280x900",
      initial.viewport.width === 1280 && initial.viewport.height === 900,
      `viewport ${JSON.stringify(initial.viewport)}`,
    );
    check(
      "studio: the strip is the shipped 32px",
      tokens.titlebarHeight === 32,
      `titlebar height ${tokens.titlebarHeight}px`,
    );
    check(
      "studio: the shell frame is the shipped 12px",
      tokens.frame === FRAME_FALLBACK,
      `frame ${tokens.frame}px`,
    );
    check(
      "studio: the rail is the shipped 256px",
      tokens.track === 256,
      `rail track ${tokens.track}px`,
    );
    check(
      "studio: the collapsed rail is the shipped 56px",
      tokens.collapsedTrack === 56,
      `collapsed rail track ${tokens.collapsedTrack}px`,
    );
    checkStudio("studio", initial);
    checkCluster("studio", initial);
    checkTrigger("studio", initial, false);
    checkClosed("studio", initial);

    // 2 — the popover, open over the studio: four cards, one active.
    at("popover: opens over the studio");
    beginScenario("popover: opens over the studio");
    const menuOpen = record("menuOpen", await openMenu("popover over studio"));
    checkTrigger("popover open", menuOpen, true);
    checkMenu("popover open", menuOpen, "studio");
    checkStudio("popover open", menuOpen);
    await capture("layouts.png");

    // 3 — the trigger is its own second door: a second press closes it.
    at("popover: trigger closes");
    beginScenario("popover: trigger closes");
    const closedViaTrigger = record(
      "closedViaTrigger",
      await closeMenu("popover"),
    );
    checkClosed("trigger close", closedViaTrigger);
    checkStudio("trigger close", closedViaTrigger);

    // 4 — Escape closes it and hands focus back to the trigger.
    at("popover: escape closes");
    beginScenario("popover: escape closes");
    await openMenu("escape");
    await press("Escape");
    await waitFor(menuClosedExpression, "the popover closed by Escape");
    const closedViaEscape = record("closedViaEscape", await settle());
    checkClosed("escape", closedViaEscape);
    checkStudio("escape", closedViaEscape);
    check(
      "escape: focus returns to the layouts trigger",
      closedViaEscape.focus?.insideTrigger === true &&
        closedViaEscape.focus?.testid === "layouts-trigger",
      `focus ${JSON.stringify(closedViaEscape.focus)}`,
    );

    // 5 — an outside press closes it, through the browser's real input path.
    at("popover: outside press closes");
    beginScenario("popover: outside press closes");
    await openMenu("outside press");
    await pressAt(320, 520);
    await waitFor(menuClosedExpression, "the popover closed by an outside press");
    const closedViaOutside = record("closedViaOutside", await settle());
    checkClosed("outside press", closedViaOutside);
    checkStudio("outside press", closedViaOutside);

    // 6 — Page · Agent: the card closes the popover and applies the split.
    at("page-agent: pick applies the split");
    beginScenario("page-agent: pick applies the split");
    await openMenu("page-agent pick");
    const pageAgent = record("pageAgent", await pick("page-agent", "page-agent"));
    checkClosed("page-agent", pageAgent);
    checkSplit("page-agent", pageAgent, "page-agent");
    await capture("layouts-page-agent.png");
    await checkActiveCard("page-agent", "page-agent", "pageAgentMenu");

    // 7 — the dock's own swap flips the derived layout to Agent · Page.
    at("swap: flips the split to agent-page");
    beginScenario("swap: flips the split to agent-page");
    await click('[data-testid="chat-side-switch"]');
    await waitFor(splitExpression("agent-page"), "the agent-page arrangement");
    const agentPage = record("agentPage", await settle());
    checkSplit("agent-page", agentPage, "agent-page");
    check(
      "agent-page: the arrangement is the mirror of page-agent",
      pageAgent.main?.box?.left === agentPage.chat?.box?.left &&
        pageAgent.chat?.box?.left === agentPage.main?.box?.left,
      `page-agent page ${JSON.stringify(pageAgent.main?.box)} / agent ${JSON.stringify(pageAgent.chat?.box)}; agent-page agent ${JSON.stringify(agentPage.chat?.box)} / page ${JSON.stringify(agentPage.main?.box)}`,
    );
    await capture("layouts-agent-page.png");
    await checkActiveCard("agent-page", "agent-page", "agentPageMenu");

    // 8 — swap back: both card arrangements are reachable, and neither is a
    // one-way door.
    at("swap: back to page-agent");
    beginScenario("swap: back to page-agent");
    await click('[data-testid="chat-side-switch"]');
    await waitFor(splitExpression("page-agent"), "the page-agent arrangement");
    const swappedBack = record("swappedBack", await settle());
    checkSplit("page-agent again", swappedBack, "page-agent");
    check(
      "swap back: the page-agent boxes come back exactly",
      same(swappedBack.main?.box, pageAgent.main?.box) &&
        same(swappedBack.chat?.box, pageAgent.chat?.box),
      `${JSON.stringify(swappedBack.main?.box)} / ${JSON.stringify(swappedBack.chat?.box)} vs ${JSON.stringify(pageAgent.main?.box)} / ${JSON.stringify(pageAgent.chat?.box)}`,
    );

    // 9 — Studio from the picker: the exact pre-pick arrangement.
    at("studio: round trip");
    beginScenario("studio: round trip");
    await openMenu("studio round trip");
    const restoredStudio = record("restoredStudio", await pick("studio", "studio"));
    checkClosed("studio round trip", restoredStudio);
    checkStudio("studio round trip", restoredStudio, initial);
    await capture("layouts-restored.png");
    await checkActiveCard("studio round trip", "studio", "restoredStudioMenu");

    // 10 — Full agent from the card: the dock's own full-screen state.
    at("agent: pick applies full agent");
    beginScenario("agent: pick applies full agent");
    await openMenu("full agent pick");
    const agentCard = record("agentCard", await pick("full agent", "agent"));
    checkClosed("full agent", agentCard);
    checkAgent("full agent card", agentCard, initial);
    await capture("layouts-agent.png");
    await checkActiveCard("full agent", "agent", "agentCardMenu");

    // 11 — the dock's own full-screen control writes the same arrangement. The
    // card is derived, so the picker must read `agent` behind the door too.
    at("dock full-screen: matches the card");
    beginScenario("dock full-screen: matches the card");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(studioExpression, "the studio back from full agent");
    const dockExit = record("dockExit", await settle());
    checkStudio("dock full-screen exit", dockExit, initial);
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(agentExpression, "full-screen chat from the dock's control");
    const dockFullscreen = record("dockFullscreen", await settle());
    checkAgent("dock full-screen", dockFullscreen, initial);
    checkSameArrangement("dock full-screen", dockFullscreen, agentCard);
    await capture("layouts-dock-fullscreen.png");
    await checkActiveCard("dock full-screen", "agent", "dockFullscreenMenu");
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(studioExpression, "the studio back from the dock door");
    const dockRestored = record("dockRestored", await settle());
    checkStudio("dock door exit", dockRestored, initial);

    // 11b — the mode lies over the arrangement, it does not replace it. Picking
    // Full agent from a split and leaving the mode through the dock's own control
    // has to put the split back, on the same boxes — the card and the dock's
    // control are one mode, and a mode that ate the arrangement underneath it
    // would make the picker's answer and the window disagree after the exit.
    at("full agent over a split");
    beginScenario("full agent over a split");
    await openMenu("split under full agent");
    const splitUnderAgent = await pick("split under full agent", "page-agent");
    checkSplit("split under full agent: split first", splitUnderAgent, "page-agent");
    await openMenu("full agent over split");
    const agentOverSplit = record(
      "agentOverSplit",
      await pick("full agent over split", "agent"),
    );
    checkClosed("full agent over split", agentOverSplit);
    checkAgent("full agent over split", agentOverSplit, initial);
    await click('[data-testid="chat-fullscreen"]');
    await waitFor(splitExpression("page-agent"), "the split back under the mode");
    const splitRestored = record("splitRestored", await settle());
    checkSplit("full agent over split: exit", splitRestored, "page-agent");
    check(
      "full agent over a split: the boxes come back exactly",
      same(splitRestored.main?.box, splitUnderAgent.main?.box) &&
        same(splitRestored.chat?.box, splitUnderAgent.chat?.box),
      `${JSON.stringify(splitRestored.main?.box)} / ${JSON.stringify(splitRestored.chat?.box)} vs ${JSON.stringify(splitUnderAgent.main?.box)} / ${JSON.stringify(splitUnderAgent.chat?.box)}`,
    );
    await checkActiveCard(
      "full agent over split: exit",
      "page-agent",
      "splitRestoredMenu",
    );
    // Back to the studio for the shortcut scenario that follows.
    await openMenu("full agent over split: studio");
    const backToStudioFromSplit = await pick(
      "full agent over split: studio",
      "studio",
    );
    checkStudio("full agent over split: studio", backToStudioFromSplit, initial);

    // 12 — Mod+Shift+F is the dock's keyboard door; the card follows it, and
    // the same key brings the studio back.
    at("shortcut: Mod+Shift+F");
    beginScenario("shortcut: Mod+Shift+F");
    await press("F", ["control", "shift"]);
    await waitFor(agentExpression, "full-screen chat from Mod+Shift+F");
    const shortcutOn = record("shortcutOn", await settle());
    checkAgent("shortcut on", shortcutOn, initial);
    checkShortcutKeys("shortcut on", shortcutOn, 1);
    await checkActiveCard("shortcut on", "agent", "shortcutOnMenu");
    await press("F", ["control", "shift"]);
    await waitFor(studioExpression, "the studio back from Mod+Shift+F");
    const shortcutOff = record("shortcutOff", await settle());
    checkStudio("shortcut off", shortcutOff, initial);
    checkShortcutKeys("shortcut off", shortcutOff, 2);

    // 13 — collapsing the dock while a split is on leaves no split: the
    // arrangement falls back to Studio, with the page and launcher back.
    at("collapse while split");
    beginScenario("collapse while split");
    await openMenu("collapse while split");
    const beforeCollapse = await pick("collapse while split", "page-agent");
    checkSplit("collapse while split: before", beforeCollapse, "page-agent");
    await click('[data-testid="chat-collapse"]');
    await waitFor(collapsedExpression, "the collapsed dock and the launcher");
    const collapsedWhileSplit = record(
      "collapsedWhileSplit",
      await settle(),
    );
    checkCollapsed("collapse while split", collapsedWhileSplit);
    await capture("layouts-collapsed.png");
    const collapsedMenu = record(
      "collapsedMenu",
      await openMenu("collapse while split: active card"),
    );
    checkMenu("collapsed menu", collapsedMenu, "studio");
    const collapsedMenuClosed = record(
      "collapsedMenuClosed",
      await closeMenu("collapse while split: active card"),
    );
    checkClosed("collapsed menu", collapsedMenuClosed);
    checkCollapsed("collapsed menu closed", collapsedMenuClosed);

    // 14 — every pick opens the dock: a card pressed from the collapsed state
    // reopens the pane and applies its arrangement.
    at("collapsed pick: reopens the dock");
    beginScenario("collapsed pick: reopens the dock");
    await openMenu("collapsed pick");
    const collapsedPick = record(
      "collapsedPick",
      await pick("collapsed pick", "page-agent"),
    );
    check(
      "collapsed pick: the dock is open again",
      collapsedPick.chat !== null && hasClass(collapsedPick, "shell--chat-open"),
      `dock ${JSON.stringify(collapsedPick.chat)}, shell ${JSON.stringify(collapsedPick.shell?.className)}`,
    );
    check(
      "collapsed pick: the launcher is gone with the reopened dock",
      collapsedPick.launcher === null,
      `launcher ${JSON.stringify(collapsedPick.launcher)}`,
    );
    checkSplit("collapsed pick", collapsedPick, "page-agent");

    // 15 — the split with the rail at its icon column: the remaining frame is
    // split evenly, from the thin rail's trailing edge to the glass.
    at("rail collapsed: base");
    beginScenario("rail collapsed: even split");
    await openMenu("rail collapsed: base");
    const backToStudio = await pick("rail collapsed: base", "studio");
    checkStudio("rail collapsed: base", backToStudio, initial);
    await click(".nav-rail .nav-toggle");
    await waitFor(railCollapsedExpression, "the collapsed rail");
    const railCollapsedBase = record("railCollapsedBase", await settle());
    checkStudio("rail collapsed base", railCollapsedBase);
    check(
      "rail collapsed: the rail shrinks to its icon column",
      railCollapsedBase.rail?.box?.width ===
        railCollapsedBase.tokens.collapsedTrack,
      `rail ${JSON.stringify(railCollapsedBase.rail?.box)} vs ${railCollapsedBase.tokens.collapsedTrack}px`,
    );

    at("rail collapsed: page-agent split");
    beginScenario("rail collapsed: page-agent split");
    await openMenu("rail collapsed split");
    const railCollapsedSplit = record(
      "railCollapsedSplit",
      await pick("rail collapsed split", "page-agent"),
    );
    checkClosed("rail collapsed split", railCollapsedSplit);
    checkSplit("rail collapsed page-agent", railCollapsedSplit, "page-agent");
    check(
      "rail collapsed: the page starts at the thin rail's trailing edge",
      railCollapsedSplit.main?.box?.left ===
        railCollapsedSplit.tokens.collapsedTrack &&
        railCollapsedSplit.main?.box?.left ===
          railCollapsedSplit.rail?.box?.right,
      `page left ${railCollapsedSplit.main?.box?.left}px vs collapsed track ${railCollapsedSplit.tokens.collapsedTrack}px and rail right ${railCollapsedSplit.rail?.box?.right}px`,
    );
    await capture("layouts-rail-collapsed.png");

    at("rail collapsed: agent-page split");
    beginScenario("rail collapsed: agent-page split");
    await click('[data-testid="chat-side-switch"]');
    await waitFor(splitExpression("agent-page"), "the agent-page arrangement");
    const railCollapsedAgentPage = record(
      "railCollapsedAgentPage",
      await settle(),
    );
    checkSplit("rail collapsed agent-page", railCollapsedAgentPage, "agent-page");
    check(
      "rail collapsed agent-page: the agent starts at the thin rail's trailing edge",
      railCollapsedAgentPage.chat?.box?.left ===
        railCollapsedAgentPage.tokens.collapsedTrack,
      `dock left ${railCollapsedAgentPage.chat?.box?.left}px vs collapsed track ${railCollapsedAgentPage.tokens.collapsedTrack}px`,
    );
    await checkActiveCard("rail collapsed", "agent-page", "railCollapsedMenu");

    // 16 — back to Studio. The Studio card is "the dock at its own width, the
    // current side", and the split we came from was Agent · Page, so Studio
    // comes back with the dock leading. Trading the sides then lands on the
    // exact boxes the run started from.
    at("final: restored studio");
    beginScenario("final: restored studio");
    await openMenu("final");
    const finalStudioLeading = record(
      "finalStudioLeading",
      await pick("final", "studio"),
    );
    checkStudio("final (Studio keeps the current side)", finalStudioLeading);
    check(
      "final: Studio keeps the dock on the current side",
      hasClass(finalStudioLeading, "shell--chat-left") &&
        !hasClass(finalStudioLeading, "shell--layout-split"),
      `shell classes ${JSON.stringify(finalStudioLeading.shell?.className)}`,
    );
    await click(".nav-rail .nav-toggle");
    await waitFor(railExpandedExpression, "the expanded rail");
    const finalLeadinRail = record(
      "finalStudioLeadingRail",
      await settle(),
    );
    checkStudio("final (leading side, rail restored)", finalLeadinRail);
    await click('[data-testid="chat-side-switch"]');
    await waitFor(
      studioRightExpression,
      "the studio with the dock trailing again",
    );
    const final = record("final", await settle());
    checkStudio("final", final, initial);
    checkCluster("final", final);
    checkTrigger("final", final, false);
    checkClosed("final", final);
    const finalMenu = record("finalMenu", await openMenu("final active card"));
    checkMenu("final", finalMenu, "studio");
    const finalClosed = record("finalClosed", await closeMenu("final active card"));
    checkClosed("final closed", finalClosed);
    checkStudio("final closed", finalClosed, initial);

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

  const reportFile = path.join(artifactsDir, "layouts.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [
    ["state", "layout", "rail L/R", "page L/R", "dock L/R/T/B", "divider", "active"],
  ];
  for (const [name, state] of Object.entries(states)) {
    if (!state?.shell) continue;
    rows.push([
      name,
      String(state.shell.dataLayout ?? "—"),
      state.rail ? `${state.rail.box.left}/${state.rail.box.right}` : "none",
      state.main ? `${state.main.box.left}/${state.main.box.right}` : "none",
      state.chat
        ? `${state.chat.box.left}/${state.chat.box.right}/${state.chat.box.top}/${state.chat.box.bottom}`
        : "none",
      state.divider?.present ? "yes" : "no",
      state.menu?.present ? (state.menu.activeCards ?? []).join(",") : "—",
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
  console.log(report.pass ? "layouts: PASS" : "layouts: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`layouts: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
