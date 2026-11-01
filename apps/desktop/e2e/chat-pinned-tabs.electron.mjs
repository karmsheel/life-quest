/**
 * Drives the pinned-chat tab harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-pinned-tabs.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-pinned-tabs.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact, and the screenshots are the rig's own capturePage of the shipped
 * shell.
 *
 * System in isolation — the ways it can fail, written down before the
 * assertions:
 *
 *  1. A pinned chat is not a tab at boot. The pin is durable Hermes state, so a
 *     pinned chat must be in the strip on the landing, ahead of the chats this
 *     run opened, without anything being clicked first.
 *  2. The pinned tab is drawn as a normal tab — a label and a close control —
 *     instead of a square with the chat's first letter and a small pin. Closing
 *     it would then silently drop a tab the operator made permanent.
 *  3. A pinned row still offers the hover Archive control, or its three-dot
 *     menu still offers Archive/Delete: both would take a pinned chat out from
 *     under its permanent tab.
 *  4. Right-clicking a pinned tab offers anything other than Unpin (the way out
 *     is unpinning first).
 *  5. Right-clicking an unpinned tab offers anything other than Pin, Rename,
 *     Archive and Delete — the four verbs the reference client offers.
 *  6. Unpin does not reach the gateway, or the tab does not become a normal tab
 *     with a close control again.
 *  7. The sidebar row does not regain its Archive hover control (or its
 *     Archive/Delete menu items) once the pin is gone.
 *  8. Pin from the tab menu does not re-pin, or the square does not come back.
 *  9. Rename from the tab menu does not open the header field on that tab's
 *     chat, or the commit does not patch that chat's title.
 * 10. Archive from the tab menu leaves the row or the tab behind.
 * 11. Delete from the tab menu writes without asking, or the ask is not the
 *     app's own dialog.
 * 12. A strip with a single pinned tab is not drawn: the pinned square is the
 *     reason the strip exists, so one pinned tab is still a strip.
 * 13. The dock header keeps its Archive icon while the active chat is pinned.
 * 14. Bridge stubs masking real calls — anything the surfaces reach for that is
 *     not named in `e2e/chat-tabs.tsx` must not throw.
 *
 * The IPC bridge is stubbed by the harness page (there is no Electron preload on
 * the dev-server page); the real ChatsSidebar, ChatPanel, ChatSessionsProvider,
 * CSS and layout engine are shipping code. The default fixture has "Pinned note"
 * pinned; the page clears the profile-local chat memory on load, so the landing
 * is deterministic.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme, screen } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const reportPath = path.join(artifactsDir, "chat-pinned-tabs.json");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-tabs.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** What one read of the shipped surfaces says, in the parts this rig claims. */
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
  const text = (el) => ((el && el.textContent) || "").trim();
  // Computed display, not presence: the hover-only controls stay in the DOM and
  // are hidden by CSS, and the resting pin marks are hidden the same way.
  const shown = (el) => Boolean(el) && window.getComputedStyle(el).display !== "none";
  const shownBox = (el) =>
    Boolean(el) && window.getComputedStyle(el).display !== "none" && el.offsetParent !== null;
  const panel = document.querySelector(".chat-panel");
  const threadHeader = document.querySelector(".chat-panel__header--thread");
  const headerActions = threadHeader
    ? Array.from(threadHeader.querySelectorAll(".chat-panel__header-actions button"))
    : [];

  // The sidebar rows, one flat list: pinned rows first (in pin order), then the
  // activity order. A row's pin mark is a resting decoration and its pin/archive
  // controls live in a hover-only span, so both are reported by computed display
  // rather than by presence in the DOM.
  const rows = [];
  let group = "";
  for (const li of Array.from(document.querySelectorAll(".chats-rail__rows > li"))) {
    if (li.classList.contains("chats-rail__group")) {
      group = text(li);
      continue;
    }
    // The "nothing matched" line is a row of the list, not a chat.
    if (li.classList.contains("chats-rail__empty")) continue;
    const when = li.querySelector(".chats-rail__when");
    const pinState = li.querySelector(".chats-rail__pin-state");
    const actions = li.querySelector(".chats-rail__actions");
    const pin = li.querySelector(".chats-rail__pin-btn");
    const archive = li.querySelector(".chats-rail__archive-btn");
    const rowMain = li.querySelector(".chats-rail__row-main");
    const svg = pin ? pin.querySelector("svg") : null;
    rows.push({
      group,
      label: text(li.querySelector(".chats-rail__label")),
      whenVisible: shown(when),
      active: li.hasAttribute("data-active"),
      archived: li.hasAttribute("data-archived"),
      menuOpen: Boolean(li.querySelector(".chats-rail__menu")),
      pinned: li.getAttribute("data-pinned") === "true",
      pinState: shown(pinState),
      actionsVisible: shown(actions),
      pin: {
        exists: Boolean(pin),
        visible: shownBox(pin),
        label: pin ? (pin.getAttribute("aria-label") ?? pin.getAttribute("title")) : null,
        dataPinned: pin ? pin.getAttribute("data-pinned") : null,
        filled: Boolean(svg) && svg.getAttribute("fill") === "currentColor"
      },
      archive: {
        exists: Boolean(archive),
        visible: shownBox(archive),
        label: archive
          ? (archive.getAttribute("aria-label") ?? archive.getAttribute("title"))
          : null
      },
      box: box(li)
    });
  }

  // The dock's strip. A pinned chat draws as a square: a letter and a small pin,
  // no label and no close control. Those are reported separately so a square is
  // read as a square rather than as a normal tab that lost its label.
  const tabs = Array.from(document.querySelectorAll(".chat-panel__tab")).map((tab) => {
    const main = tab.matches("[role=tab]") ? tab : tab.querySelector("[role=tab]");
    const labelEl = tab.querySelector(".chat-panel__tab-label");
    const letterEl = tab.querySelector(".chat-panel__tab-letter");
    const pinEl = tab.querySelector(".chat-panel__tab-pin");
    const closeEl = tab.querySelector(".chat-panel__tab-close");
    return {
      label: text(labelEl),
      letter: letterEl ? text(letterEl) : null,
      name: main
        ? (main.getAttribute("aria-label") ?? main.getAttribute("title") ?? "").trim()
        : "",
      pinned: tab.getAttribute("data-pinned") === "true",
      pin: Boolean(pinEl),
      pinVisible: shown(pinEl),
      close: closeEl ? (closeEl.getAttribute("aria-label") ?? "") : null,
      hasClose: Boolean(closeEl),
      active: main ? main.getAttribute("aria-selected") === "true" : null,
      box: box(tab)
    };
  });

  const stripEl = document.querySelector(".chat-panel__tabs");
  const menuEl = document.querySelector(".chat-panel__tab-menu");
  const railMenuEl = document.querySelector(
    ".chats-rail__row[data-menu-open] .chats-rail__menu"
  );
  const dialogEl = document.querySelector(".confirm-dialog");
  const renameEl = document.querySelector(".chat-panel__rename-input");

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    surface: panel ? panel.getAttribute("data-chat-surface") : null,
    thread: Boolean(threadHeader),
    heading: text(
      document.querySelector(".chat-panel__heading--thread") ??
        document.querySelector(".chat-panel__heading")
    ),
    rows,
    rowCount: rows.length,
    tabs,
    tabCount: tabs.length,
    strip: stripEl ? { box: box(stripEl) } : null,
    // The tab context menu when one is open: a fixed popover (not a strip
    // child), so its on-screen box is read here instead of assumed.
    tabMenu: menuEl
      ? {
          box: box(menuEl),
          menuFor: menuEl.getAttribute("data-menu-for"),
          tabId: menuEl.getAttribute("data-tab-id"),
          itemLabels: Array.from(menuEl.querySelectorAll('[role="menuitem"]')).map(
            (item) => item.getAttribute("aria-label")
          )
        }
      : null,
    // The sidebar's three-dot menu when one is open, with the row it hangs off.
    railMenu: railMenuEl
      ? {
          box: box(railMenuEl),
          itemLabels: Array.from(railMenuEl.querySelectorAll("button")).map(
            (item) => item.getAttribute("aria-label")
          ),
          rowLabel: text(
            railMenuEl.closest(".chats-rail__row")?.querySelector(".chats-rail__label")
          )
        }
      : null,
    header: threadHeader
      ? { actions: headerActions.map((button) => button.getAttribute("aria-label")) }
      : null,
    renaming: Boolean(renameEl),
    renameValue: renameEl ? renameEl.value : null,
    dialog: dialogEl
      ? {
          title: text(dialogEl.querySelector(".confirm-dialog__title")),
          message: text(dialogEl.querySelector(".confirm-dialog__message")),
          confirm: Boolean(dialogEl.querySelector(".confirm-dialog__confirm"))
        }
      : null,
    patchCalls: window.__lqPatchCalls ?? [],
    deleteCalls: window.__lqDeleteCalls ?? []
  };
})()`;

/**
 * Slide the window so the ambient pointer cannot sit over the chats rail.
 *
 * The pinned-row hover checks read `:hover`, and a window shown on the shared X
 * display inherits whatever hover the operator's parked cursor happens to be
 * over. Moving the window horizontally by its one free strip either pushes the
 * rail under a different screen x or pushes the cursor outside the window; one
 * of the two extremes always maps the ambient pointer off the rail.
 */
function placeWindowOffTheRail(win, rail) {
  const display = screen.getPrimaryDisplay().workArea;
  const bounds = win.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const maxX = Math.max(display.x, display.x + display.width - bounds.width);
  const contentY = cursor.y - bounds.y;
  // Above or below the window is already clear of every row.
  if (contentY < 0 || contentY > bounds.height) return;
  // A few pixels of slack: the row's own padding is not part of its hover box,
  // but landing the pointer on the rail's edge is too close to be a fact.
  const railLeft = rail.left - 8;
  const railRight = rail.right + 8;
  const clear = (x) => {
    const contentX = cursor.x - x;
    return contentX < railLeft || contentX > railRight;
  };
  const x = [display.x, maxX].find(clear) ?? display.x;
  win.setPosition(x, bounds.y);
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

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 240) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const failures = [];
  const check = (name, ok, detail = "") => {
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `chat-pinned-tabs-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return file;
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const clickSidebarRow = (label) =>
    run(`(async () => {
      const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
        (li) => (li.querySelector(".chats-rail__label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const button = row?.querySelector(".chats-rail__row-main");
      if (!button) return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** The same row, pressed with the middle button: "open a new tab". */
  const middleClickSidebarRow = (label) =>
    run(`(async () => {
      const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
        (li) => (li.querySelector(".chats-rail__label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const button = row?.querySelector(".chats-rail__row-main");
      if (!button) return false;
      button.dispatchEvent(new MouseEvent("mousedown", { button: 1, bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** The row's three-dot menu, toggled by its own control. */
  const openSidebarMenu = (label) =>
    run(`(async () => {
      const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
        (li) => (li.querySelector(".chats-rail__label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const button = row?.querySelector(".chats-rail__menu-btn");
      if (!button) return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const findRowScript = (label) =>
    `Array.from(document.querySelectorAll(".chats-rail__rows .chats-rail__row")).find(
      (li) => (li.querySelector(".chats-rail__label")?.textContent || "").trim() === ${JSON.stringify(label)}
    )`;

  /** The row's centre in window content coordinates, from a live layout read. */
  const rowCenter = (label) =>
    run(`(() => {
      const row = ${findRowScript(label)};
      if (!row) return null;
      const r = row.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

  const rowActionsVisible = (label) =>
    run(`(() => {
      const row = ${findRowScript(label)};
      const actions = row ? row.querySelector(".chats-rail__actions") : null;
      return Boolean(actions) && window.getComputedStyle(actions).display !== "none";
    })()`);

  /*
   * CSS :hover only follows a real pointer — a synthetic `mouseover` DOM event
   * does not move the browser's hover state. So hover goes through the window's
   * input pipeline. `showInactive` leaves the window unfocused; if that pipeline
   * ignores the move, the same event goes over the devtools protocol instead,
   * and stays there for the rest of the run (both are then sent together).
   */
  let pointerViaCdp = false;
  const cdpMove = async (x, y) => {
    const wc = win.webContents;
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      clickCount: 0,
    });
  };
  const movePointer = async (x, y) => {
    win.webContents.sendInputEvent({ type: "mouseMove", x, y });
    if (pointerViaCdp) {
      try {
        await cdpMove(x, y);
      } catch {
        pointerViaCdp = false;
      }
    }
    await wait(120);
  };

  const hoverSidebarRow = async (label) => {
    const center = await rowCenter(label);
    if (!center) return false;
    // Coordinates are window content DIPs: keep them inside the content box.
    const x = clamp(Math.round(center.x), 1, DEFAULT_SIZE.width - 2);
    const y = clamp(Math.round(center.y), 1, DEFAULT_SIZE.height - 2);
    await movePointer(x, y);
    if (!(await rowActionsVisible(label))) {
      try {
        await cdpMove(x, y);
        pointerViaCdp = true;
        await wait(120);
      } catch {
        pointerViaCdp = false;
      }
    }
    await wait(60);
    return true;
  };

  /** Park the pointer outside every sidebar row so :hover clears. */
  const unhover = async () => {
    await movePointer(8, 8);
    await wait(120);
    return true;
  };

  /** A press on a dock tab's own button. */
  const clickPinnedTab = () =>
    run(`(async () => {
      const tab = document.querySelector('.chat-panel__tab[data-pinned="true"]');
      const button = tab ? (tab.matches("[role=tab]") ? tab : tab.querySelector("[role=tab]")) : null;
      if (!button) return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Right-click a tab, at its centre, through the DOM's contextmenu event. */
  const rightClickTab = (expression) =>
    run(`(async () => {
      const tab = ${expression};
      if (!tab) return null;
      const rect = tab.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      tab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: x,
          clientY: y
        })
      );
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return { x, y };
    })()`);

  const rightClickPinnedTab = () =>
    rightClickTab(`document.querySelector('.chat-panel__tab[data-pinned="true"]')`);

  const rightClickTabLabel = (label) =>
    rightClickTab(`Array.from(document.querySelectorAll(".chat-panel__tab")).find(
      (el) => (el.querySelector(".chat-panel__tab-label")?.textContent || "").trim() === ${JSON.stringify(label)}
    )`);

  /** One item of the open tab context menu, by its accessible name. */
  const clickTabMenuItem = (label) =>
    run(`(async () => {
      const item = Array.from(document.querySelectorAll(".chat-panel__tab-menu [role=menuitem]")).find(
        (el) => el.getAttribute("aria-label") === ${JSON.stringify(label)}
      );
      if (!item) return false;
      item.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Escape, the menu's keyboard dismissal. */
  const pressEscape = () =>
    run(`(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Type into the thread header's rename field, through React's own input. */
  const typeThreadRename = (text) =>
    run(`(async () => {
      const el = document.querySelector(".chat-panel__rename-input");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    })()`);

  /** Submit the header rename field, the way Enter or the check does. */
  const submitRename = () =>
    run(`(async () => {
      const form = document.querySelector(".chat-panel__rename");
      if (!form) return false;
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** One control of the app's own confirm dialog. */
  const clickDialog = (which) =>
    run(`(async () => {
      const el = document.querySelector(".confirm-dialog__${which}");
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const states = {};
  const startedAt = Date.now();
  const marks = [];
  const mark = (label) => {
    marks.push({ ms: Date.now() - startedAt, label });
  };

  const timeout = setTimeout(() => {
    fs.writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          url,
          ranAt: new Date().toISOString(),
          window: DEFAULT_SIZE,
          screenshots,
          states,
          marks,
          failures: [...failures, "timed out after 90s"],
          pass: false,
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  }, 90_000);

  // A page that never finishes loading must say so rather than sit until the
  // watchdog: the renderer's own events are the only account of why it did not.
  win.webContents.on("did-finish-load", () => mark("did-finish-load"));
  win.webContents.on("did-fail-load", (_event, code, description, failedUrl) =>
    mark(`did-fail-load ${code} ${description} ${failedUrl}`),
  );
  win.webContents.on("render-process-gone", (_event, details) =>
    mark(`render-process-gone ${details.reason}`),
  );
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) mark(`console ${level}: ${String(message).slice(0, 240)}`);
  });

  let report;
  try {
    mark("load:start");
    await win.loadURL(url);
    mark("load:done");
    await run("window.chatTabsHarnessReady.then(() => true)");
    mark("harness:ready");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await wait(250);
    // The window is shown so a REAL pointer can drive `:hover`; slide it so the
    // operator's parked cursor cannot decide the landing state for us.
    const railRect = await run(`(() => {
      const r = document.querySelector(".chats-rail")?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right } : null;
    })()`);
    placeWindowOffTheRail(win, railRect ?? { left: 0, right: 260 });
    win.showInactive();
    // Park the pointer away from the rows before the first sample.
    await unhover();

    // 1 — the pinned chat is a tab at boot, drawn as a square ahead of the chat
    // the dock opened: first letter, a small pin, no label, no close control.
    mark("landing");
    const landing = await settle(300);
    states.landing = landing;
    check(
      "the landing draws two tabs: the pinned square first, the open chat second",
      landing.tabCount === 2 &&
        landing.tabs[0]?.pinned === true &&
        landing.tabs[0]?.letter === "P" &&
        landing.tabs[0]?.pin === true &&
        landing.tabs[0]?.hasClose === false &&
        landing.tabs[0]?.label === "" &&
        landing.tabs[1]?.pinned === false &&
        landing.tabs[1]?.label === "Alpha planning" &&
        landing.tabs[1]?.hasClose === true,
      JSON.stringify(landing.tabs),
    );
    check(
      "the pinned square is a compact tab, not a full-width one",
      typeof landing.tabs[0]?.box?.width === "number" &&
        typeof landing.tabs[1]?.box?.width === "number" &&
        landing.tabs[0].box.width < landing.tabs[1].box.width,
      JSON.stringify({ pinned: landing.tabs[0]?.box, normal: landing.tabs[1]?.box }),
    );
    check(
      "the dock landed on the open chat, not on the pinned tab",
      landing.heading === "Alpha planning" &&
        landing.tabs[1]?.active === true &&
        landing.surface === "thread",
      JSON.stringify({ heading: landing.heading, tabs: landing.tabs }),
    );
    check(
      "the dock header carries no chat controls",
      JSON.stringify(landing.header?.actions ?? []) === "[]",
      JSON.stringify(landing.header),
    );
    check(
      "the sidebar marks the pinned row and puts it first",
      landing.rows[0]?.label === "Pinned note" && landing.rows[0]?.pinned === true,
      JSON.stringify(landing.rows.map((row) => [row.label, row.pinned])),
    );
    await shot("landing");

    // 2 — clicking the square opens the pinned chat; the header hides the
    // Archive icon, because a pinned chat must be unpinned before it can be put
    // away (its tab is permanent).
    mark("active-pinned");
    check("clicked the pinned tab", await clickPinnedTab(), "no pinned tab");
    const activePinned = await settle();
    states.activePinned = activePinned;
    check(
      "the pinned chat is the open thread when its square is clicked",
      activePinned.heading === "Pinned note" &&
        activePinned.tabs.find((tab) => tab.pinned)?.active === true,
      JSON.stringify({ heading: activePinned.heading, tabs: activePinned.tabs }),
    );
    check(
      "the dock header still carries no chat controls while a pinned chat is active",
      JSON.stringify(activePinned.header?.actions ?? []) === "[]",
      JSON.stringify(activePinned.header),
    );
    await shot("active-pinned");

    // 3 — the sidebar's pinned row: hovering reveals the Unpin control only.
    // Archive would take a pinned chat out from under its permanent tab.
    mark("pinned-row-hover");
    check("hovered the pinned row", await hoverSidebarRow("Pinned note"), "no row to hover");
    const pinnedRowHover = await settle();
    states.pinnedRowHover = pinnedRowHover;
    const pinnedRow = pinnedRowHover.rows.find((row) => row.label === "Pinned note");
    check(
      "hovering the pinned row reveals its actions, and only that row's",
      pinnedRow?.actionsVisible === true &&
        pinnedRowHover.rows.filter((row) => row.actionsVisible).length === 1,
      JSON.stringify(pinnedRowHover.rows.map((row) => [row.label, row.actionsVisible])),
    );
    check(
      "the pinned row's hover pin reads Unpin and is filled",
      pinnedRow?.pin.visible === true &&
        pinnedRow?.pin.label === "Unpin chat" &&
        pinnedRow?.pin.dataPinned === "true" &&
        pinnedRow?.pin.filled === true,
      JSON.stringify(pinnedRow?.pin),
    );
    check(
      "the pinned row hides its hover Archive control",
      pinnedRow?.archive.visible === false,
      JSON.stringify(pinnedRow?.archive),
    );

    // 4 — the pinned row's three-dot menu offers no Archive and no Delete: the
    // way out of a pinned row is Unpin.
    mark("pinned-row-menu");
    check("opened the pinned row's menu", await openSidebarMenu("Pinned note"), "no menu control");
    const pinnedRowMenu = await settle();
    states.pinnedRowMenu = pinnedRowMenu;
    check(
      "the pinned row's menu offers Unpin, and no Archive or Delete",
      pinnedRowMenu.railMenu?.rowLabel === "Pinned note" &&
        pinnedRowMenu.railMenu.itemLabels.includes("Unpin chat") &&
        !pinnedRowMenu.railMenu.itemLabels.includes("Archive chat") &&
        !pinnedRowMenu.railMenu.itemLabels.includes("Delete chat"),
      JSON.stringify(pinnedRowMenu.railMenu),
    );
    await shot("pinned-row-menu");
    check("closed the pinned row's menu", await openSidebarMenu("Pinned note"), "no menu control");
    await settle();
    check("moved the pointer off the rows", await unhover(), "no neutral point");
    await settle();

    // 5 — right-clicking the pinned tab offers exactly one verb: Unpin.
    mark("pinned-tab-menu");
    check("right-clicked the pinned tab", await rightClickPinnedTab(), "no pinned tab");
    const pinnedTabMenu = await settle();
    states.pinnedTabMenu = pinnedTabMenu;
    check(
      "a pinned tab's menu is Unpin and nothing else",
      pinnedTabMenu.tabMenu?.menuFor === "pinned" &&
        pinnedTabMenu.tabMenu.tabId === "chat-pinned" &&
        JSON.stringify(pinnedTabMenu.tabMenu.itemLabels) === JSON.stringify(["Unpin chat"]),
      JSON.stringify(pinnedTabMenu.tabMenu),
    );
    check(
      "the tab menu is drawn wholly inside the window",
      Boolean(pinnedTabMenu.tabMenu?.box) &&
        pinnedTabMenu.tabMenu.box.left >= 0 &&
        pinnedTabMenu.tabMenu.box.top >= 0 &&
        pinnedTabMenu.tabMenu.box.right <= pinnedTabMenu.viewport.width &&
        pinnedTabMenu.tabMenu.box.bottom <= pinnedTabMenu.viewport.height &&
        pinnedTabMenu.tabMenu.box.height > 20,
      JSON.stringify({
        menu: pinnedTabMenu.tabMenu?.box,
        viewport: pinnedTabMenu.viewport,
      }),
    );
    await shot("pinned-tab-menu");

    // 6 — Escape dismisses the menu; the next step reopens it to use it.
    mark("menu-escape");
    check("pressed Escape", await pressEscape(), "no keydown");
    const menuEscaped = await settle();
    states.menuEscaped = menuEscaped;
    check(
      "Escape closes the tab menu",
      menuEscaped.tabMenu === null,
      JSON.stringify(menuEscaped.tabMenu),
    );

    // 7 — Unpin from the tab menu: the patch reaches the gateway, the square
    // becomes a normal tab with a close control, and the header's Archive icon
    // comes back because the active chat is no longer pinned.
    mark("unpin");
    check("right-clicked the pinned tab again", await rightClickPinnedTab(), "no pinned tab");
    await settle();
    check("clicked Unpin in the tab menu", await clickTabMenuItem("Unpin chat"), "no Unpin item");
    const unpinnedTab = await settle();
    states.unpinnedTab = unpinnedTab;
    check(
      "Unpin reached the bridge for the pinned chat",
      unpinnedTab.patchCalls.at(-1)?.id === "chat-pinned" &&
        unpinnedTab.patchCalls.at(-1)?.patch.pinned === false,
      JSON.stringify(unpinnedTab.patchCalls.at(-1)),
    );
    const normalTab = unpinnedTab.tabs.find((tab) => tab.label === "Pinned note");
    check(
      "the square became a normal tab with a close control",
      unpinnedTab.tabMenu === null &&
        unpinnedTab.tabCount === 2 &&
        unpinnedTab.tabs.every((tab) => tab.pinned === false) &&
        normalTab?.hasClose === true &&
        normalTab?.letter === null,
      JSON.stringify(unpinnedTab.tabs),
    );
    check(
      "the dock header carries no chat controls once the chat is unpinned",
      JSON.stringify(unpinnedTab.header?.actions ?? []) === "[]",
      JSON.stringify(unpinnedTab.header),
    );
    await shot("unpinned-tab");

    // 8 — the sidebar row regains both the hover Archive control and the
    // Archive/Delete menu items the pin was hiding.
    mark("unpinned-row");
    check("hovered the now-unpinned row", await hoverSidebarRow("Pinned note"), "no row to hover");
    const unpinnedRowHover = await settle();
    states.unpinnedRowHover = unpinnedRowHover;
    const nowUnpinnedRow = unpinnedRowHover.rows.find((row) => row.label === "Pinned note");
    check(
      "the unpinned row's hover controls are Pin and Archive again",
      nowUnpinnedRow?.actionsVisible === true &&
        nowUnpinnedRow?.pin.visible === true &&
        nowUnpinnedRow?.pin.label === "Pin chat" &&
        nowUnpinnedRow?.archive.visible === true &&
        nowUnpinnedRow?.archive.label === "Archive chat",
      JSON.stringify({ pin: nowUnpinnedRow?.pin, archive: nowUnpinnedRow?.archive }),
    );
    check("opened the unpinned row's menu", await openSidebarMenu("Pinned note"), "no menu control");
    const unpinnedRowMenu = await settle();
    states.unpinnedRowMenu = unpinnedRowMenu;
    check(
      "the unpinned row's menu carries Pin, Rename, Archive and Delete",
      unpinnedRowMenu.railMenu?.rowLabel === "Pinned note" &&
        unpinnedRowMenu.railMenu.itemLabels.includes("Pin chat") &&
        unpinnedRowMenu.railMenu.itemLabels.includes("Rename chat") &&
        unpinnedRowMenu.railMenu.itemLabels.includes("Archive chat") &&
        unpinnedRowMenu.railMenu.itemLabels.includes("Delete chat"),
      JSON.stringify(unpinnedRowMenu.railMenu),
    );
    await shot("unpinned-row-menu");
    check("closed the unpinned row's menu", await openSidebarMenu("Pinned note"), "no menu control");
    await settle();
    check("moved the pointer off the rows again", await unhover(), "no neutral point");
    await settle();

    // 9 — right-clicking an unpinned tab offers the four verbs.
    mark("unpinned-tab-menu");
    check("right-clicked the unpinned tab", await rightClickTabLabel("Pinned note"), "no tab");
    const unpinnedTabMenu = await settle();
    states.unpinnedTabMenu = unpinnedTabMenu;
    check(
      "an unpinned tab's menu is Pin, Rename, Archive and Delete",
      unpinnedTabMenu.tabMenu?.menuFor === "unpinned" &&
        unpinnedTabMenu.tabMenu.tabId === "chat-pinned" &&
        JSON.stringify(unpinnedTabMenu.tabMenu.itemLabels) ===
          JSON.stringify(["Pin chat", "Rename chat", "Archive chat", "Delete chat"]),
      JSON.stringify(unpinnedTabMenu.tabMenu),
    );

    // 10 — Pin from that menu re-pins: the square comes back at the front.
    mark("repin");
    check("clicked Pin in the tab menu", await clickTabMenuItem("Pin chat"), "no Pin item");
    const repinned = await settle();
    states.repinned = repinned;
    check(
      "Pin reached the bridge for the chat",
      repinned.patchCalls.at(-1)?.id === "chat-pinned" &&
        repinned.patchCalls.at(-1)?.patch.pinned === true,
      JSON.stringify(repinned.patchCalls.at(-1)),
    );
    check(
      "the pinned square came back at the front of the strip",
      repinned.tabMenu === null &&
        repinned.tabCount === 2 &&
        repinned.tabs[0]?.pinned === true &&
        repinned.tabs[0]?.letter === "P" &&
        repinned.tabs[0]?.pin === true &&
        repinned.tabs[0]?.hasClose === false,
      JSON.stringify(repinned.tabs),
    );
    await shot("repinned-tab");

    // 11 — Rename from the tab menu opens the header field on that tab's chat,
    // and the commit patches that chat's title.
    mark("rename");
    check("right-clicked the unpinned Alpha tab", await rightClickTabLabel("Alpha planning"), "no Alpha tab");
    await settle();
    check("clicked Rename in the tab menu", await clickTabMenuItem("Rename chat"), "no Rename item");
    const renameOpen = await settle();
    states.renameOpen = renameOpen;
    check(
      "Rename opens the header field on that tab's chat",
      renameOpen.renaming === true &&
        renameOpen.renameValue === "Alpha planning" &&
        renameOpen.tabMenu === null,
      JSON.stringify({
        renaming: renameOpen.renaming,
        value: renameOpen.renameValue,
        menu: renameOpen.tabMenu,
      }),
    );
    check("typed a new name", await typeThreadRename("Alpha renamed"), "no rename field");
    check("submitted the rename", await submitRename(), "no rename form");
    const renamed = await settle();
    states.renamed = renamed;
    check(
      "the rename patched the tab's chat title",
      renamed.patchCalls.at(-1)?.id === "chat-alpha" &&
        renamed.patchCalls.at(-1)?.patch.title === "Alpha renamed",
      JSON.stringify(renamed.patchCalls.at(-1)),
    );
    check(
      "the renamed chat's heading and tab show the new name",
      renamed.heading === "Alpha renamed" &&
        renamed.tabs.some((tab) => tab.label === "Alpha renamed") &&
        renamed.renaming === false,
      JSON.stringify({ heading: renamed.heading, tabs: renamed.tabs }),
    );
    await shot("renamed-tab");

    // 12 — Archive from the tab menu removes the row and the tab; the pinned
    // square is then the strip's only tab, and the strip is still drawn.
    mark("archive");
    check("right-clicked the renamed tab", await rightClickTabLabel("Alpha renamed"), "no Alpha tab");
    await settle();
    check("clicked Archive in the tab menu", await clickTabMenuItem("Archive chat"), "no Archive item");
    const archivedFromTabMenu = await settle();
    states.archivedFromTabMenu = archivedFromTabMenu;
    check(
      "Archive reached the bridge for the tab's chat",
      archivedFromTabMenu.patchCalls.at(-1)?.id === "chat-alpha" &&
        archivedFromTabMenu.patchCalls.at(-1)?.patch.archived === true,
      JSON.stringify(archivedFromTabMenu.patchCalls.at(-1)),
    );
    check(
      "archiving from the tab menu removed the row and the tab",
      !archivedFromTabMenu.rows.some((row) => row.label === "Alpha renamed") &&
        !archivedFromTabMenu.tabs.some((tab) => tab.label === "Alpha renamed"),
      JSON.stringify({
        rows: archivedFromTabMenu.rows.map((row) => row.label),
        tabs: archivedFromTabMenu.tabs,
      }),
    );
    check(
      "one pinned tab still draws the strip, with the pinned square as its only tab",
      archivedFromTabMenu.tabCount === 1 &&
        archivedFromTabMenu.tabs[0]?.pinned === true &&
        archivedFromTabMenu.strip !== null &&
        archivedFromTabMenu.heading === "Pinned note",
      JSON.stringify({
        tabs: archivedFromTabMenu.tabs,
        strip: archivedFromTabMenu.strip,
        heading: archivedFromTabMenu.heading,
      }),
    );
    await shot("archived-from-tab-menu");

    // 13 — a second, unpinned tab for the delete step.
    mark("bravo-tab");
    check(
      "middle-clicked Bravo for a second tab",
      await middleClickSidebarRow("Bravo budget"),
      "no row button",
    );
    const bravoTab = await settle();
    states.bravoTab = bravoTab;
    check(
      "Bravo opened as a normal tab beside the pinned square",
      bravoTab.tabCount === 2 &&
        bravoTab.tabs[1]?.label === "Bravo budget" &&
        bravoTab.tabs[1]?.active === true &&
        bravoTab.heading === "Bravo budget",
      JSON.stringify(bravoTab.tabs),
    );

    // 14 — Delete from the tab menu asks in the app's own dialog, writes only
    // on yes, and hands the dock back to the pinned tab.
    mark("delete");
    check("right-clicked Bravo's tab", await rightClickTabLabel("Bravo budget"), "no Bravo tab");
    await settle();
    check("clicked Delete in the tab menu", await clickTabMenuItem("Delete chat"), "no Delete item");
    const deleteAsked = await settle();
    states.deleteAsked = deleteAsked;
    check(
      "Delete asks first, in the app's own dialog",
      deleteAsked.dialog?.title === "Delete chat" &&
        deleteAsked.dialog?.confirm === true &&
        deleteAsked.deleteCalls.length === 0,
      JSON.stringify({ dialog: deleteAsked.dialog, deletes: deleteAsked.deleteCalls }),
    );
    await shot("delete-dialog");
    check("confirmed the delete", await clickDialog("confirm"), "no confirm control");
    const deleted = await settle();
    states.deleted = deleted;
    check(
      "the delete reached the bridge for Bravo",
      deleted.deleteCalls.at(-1) === "chat-bravo",
      JSON.stringify(deleted.deleteCalls),
    );
    check(
      "the deleted chat left the row list and the strip",
      !deleted.rows.some((row) => row.label === "Bravo budget") &&
        !deleted.tabs.some((tab) => tab.label === "Bravo budget"),
      JSON.stringify({
        rows: deleted.rows.map((row) => row.label),
        tabs: deleted.tabs,
      }),
    );

    // 15 — what is left is the pinned square, alone in a strip that is still
    // drawn: the pin, not a second tab, is why the strip exists.
    mark("final");
    const final = await settle();
    states.final = final;
    check(
      "the pinned chat's square is the strip's one tab, and the strip is still drawn",
      final.tabCount === 1 &&
        final.tabs[0]?.pinned === true &&
        final.tabs[0]?.letter === "P" &&
        final.tabs[0]?.pin === true &&
        final.tabs[0]?.hasClose === false &&
        final.strip !== null,
      JSON.stringify({ tabs: final.tabs, strip: final.strip }),
    );
    check(
      "the dock landed on the pinned chat after the delete",
      final.heading === "Pinned note" && final.surface === "thread",
      JSON.stringify({ heading: final.heading, surface: final.surface }),
    );
    await shot("final");

    mark("done");
    report = {
      url,
      ranAt: new Date().toISOString(),
      window: DEFAULT_SIZE,
      screenshots,
      marks,
      states,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      window: DEFAULT_SIZE,
      screenshots,
      marks,
      states,
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  // The table is a convenience for the operator; a run that threw before it
  // reached the landing has nothing to print, and the report above already says
  // why.
  const table = states.landing && states.final ? [
    ["state", "rows", "tabs", "pinned", "heading", "menu"],
    [
      "landing",
      states.landing.rowCount,
      states.landing.tabCount,
      states.landing.tabs.filter((tab) => tab.pinned).length,
      states.landing.heading,
      "",
    ],
    [
      "active pinned",
      states.activePinned.rowCount,
      states.activePinned.tabCount,
      states.activePinned.tabs.filter((tab) => tab.pinned).length,
      states.activePinned.heading,
      "",
    ],
    [
      "pinned tab menu",
      states.pinnedTabMenu.rowCount,
      states.pinnedTabMenu.tabCount,
      "",
      states.pinnedTabMenu.heading,
      JSON.stringify(states.pinnedTabMenu.tabMenu?.itemLabels),
    ],
    [
      "unpinned tab",
      states.unpinnedTab.rowCount,
      states.unpinnedTab.tabCount,
      states.unpinnedTab.tabs.filter((tab) => tab.pinned).length,
      states.unpinnedTab.heading,
      "",
    ],
    [
      "unpinned tab menu",
      states.unpinnedTabMenu.rowCount,
      states.unpinnedTabMenu.tabCount,
      "",
      states.unpinnedTabMenu.heading,
      JSON.stringify(states.unpinnedTabMenu.tabMenu?.itemLabels),
    ],
    [
      "repinned",
      states.repinned.rowCount,
      states.repinned.tabCount,
      states.repinned.tabs.filter((tab) => tab.pinned).length,
      states.repinned.heading,
      "",
    ],
    [
      "renamed",
      states.renamed.rowCount,
      states.renamed.tabCount,
      states.renamed.tabs.filter((tab) => tab.pinned).length,
      states.renamed.heading,
      "",
    ],
    [
      "archived from tab menu",
      states.archivedFromTabMenu.rowCount,
      states.archivedFromTabMenu.tabCount,
      states.archivedFromTabMenu.tabs.filter((tab) => tab.pinned).length,
      states.archivedFromTabMenu.heading,
      "",
    ],
    [
      "deleted",
      states.deleted.rowCount,
      states.deleted.tabCount,
      states.deleted.tabs.filter((tab) => tab.pinned).length,
      states.deleted.heading,
      JSON.stringify(states.deleted.deleteCalls),
    ],
    [
      "final",
      states.final.rowCount,
      states.final.tabCount,
      states.final.tabs.filter((tab) => tab.pinned).length,
      states.final.heading,
      "",
    ],
  ]
    : null;
  if (table) console.log(table.map((row) => row.join(" | ")).join("\n"));
  for (const failure of report.failures ?? []) console.error(`FAIL ${failure}`);
  console.log(`chat-pinned-tabs: ${report.pass ? "pass" : "fail"}`);

  app.exit(report.pass ? 0 : 1);
}

app.whenReady().then(main);
