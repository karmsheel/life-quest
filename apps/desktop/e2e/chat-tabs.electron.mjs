/**
 * Drives the chat-tabs harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-tabs.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-tabs.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * NOT covered here: the HTTP hop. The rig answers from a fixture, so that a
 * frame really carries `sessionId` over IPC is asserted at the bridge boundary
 * only — the main-process stamping is covered by the type + the shipping
 * envelope, not by a live gateway.
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
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-tabs.html";
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
  const text = (el) => ((el && el.textContent) || "").trim();
  // Computed display, not presence: the hover-only controls stay in the DOM and
  // are hidden by CSS, and the resting time/pin marks are hidden the same way.
  const shown = (el) => Boolean(el) && window.getComputedStyle(el).display !== "none";
  const shownBox = (el) =>
    Boolean(el) && window.getComputedStyle(el).display !== "none" && el.offsetParent !== null;
  const rail = document.querySelector(".chats-rail");
  const panel = document.querySelector(".chat-panel");
  const composer = document.querySelector(".chat-panel__composer-input");
  const threadHeader = document.querySelector(".chat-panel__header--thread");
  const chatsHeader = document.querySelector(".chats-rail__header");
  const chatsTitle = chatsHeader?.querySelector(".chats-rail__title");
  const chatsControls = chatsHeader
    ? Array.from(chatsHeader.querySelectorAll(".chats-rail__header-actions button"))
    : [];
  const searchInput = document.querySelector(".chats-rail__search-input");
  const viewMenu = document.querySelector(".chats-rail__view-menu");

  // One flat list: the pinned rows first (in pin order), the rest after them,
  // then the archived band when the view asks for it. A row's pin mark is a
  // resting decoration and its pin/archive buttons live in a hover-only span, so
  // both are reported by computed display rather than by presence in the DOM.
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
      when: text(when),
      whenVisible: shown(when),
      active: li.hasAttribute("data-active"),
      archived: li.hasAttribute("data-archived"),
      archivedTag: text(li.querySelector(".chats-rail__archived-tag")),
      disabled: Boolean(rowMain && rowMain.disabled),
      live: li.hasAttribute("data-live"),
      approval: li.hasAttribute("data-approval"),
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
          : null,
        beforePin: Boolean(archive && pin && archive.nextElementSibling === pin)
      },
      box: box(li)
    });
  }

  const tabs = Array.from(document.querySelectorAll(".chat-panel__tab")).map((tab) => ({
    label: text(tab.querySelector(".chat-panel__tab-label")),
    active: tab.querySelector("[role=tab]")?.getAttribute("aria-selected") === "true",
    live: tab.hasAttribute("data-live"),
    approval: tab.hasAttribute("data-approval"),
    close: tab.querySelector(".chat-panel__tab-close")?.getAttribute("aria-label") ?? null
  }));

  const messages = Array.from(document.querySelectorAll(".chat-panel__message")).map((m) => ({
    role: text(m.querySelector(".chat-panel__message-role")),
    content: text(m.querySelector(".chat-panel__message-content"))
  }));

  const dialog = document.querySelector(".confirm-dialog");

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    shell: box(document.querySelector(".shell")),
    rail: rail
      ? {
          box: box(rail),
          label: rail.getAttribute("aria-label"),
          title: text(rail.querySelector(".chats-rail__title")),
          liveCount: text(rail.querySelector(".chats-rail__live-count")),
          newChat: Boolean(rail.querySelector(".chats-rail__new")),
          newChatBox: box(rail.querySelector(".chats-rail__new")),
          groups: Array.from(document.querySelectorAll(".chats-rail__group")).map(text),
          empty: text(rail.querySelector(".chats-rail__empty")),
          // The New chat button is a button, not a menu row: its icon and label
          // sit as one centred pair. Measure the pair's gaps to the button's
          // own edges instead of trusting the CSS rule.
          newChatCentered: (() => {
            const button = rail.querySelector(".chats-rail__new");
            if (!button) return null;
            const buttonBox = button.getBoundingClientRect();
            const parts = Array.from(button.children).map((child) =>
              child.getBoundingClientRect()
            );
            if (parts.length === 0) return null;
            const left = Math.min(...parts.map((part) => part.left));
            const right = Math.max(...parts.map((part) => part.right));
            return (
              Math.abs(
                Math.round(left - buttonBox.left) -
                  Math.round(buttonBox.right - right)
              ) <= 1
            );
          })(),
          // The dead space above and below the rows is part of the design: the
          // rail breathes instead of starting flush against its title/edge.
          paddingTop: Number.parseFloat(window.getComputedStyle(rail).paddingTop) || 0,
          paddingBottom: Number.parseFloat(window.getComputedStyle(rail).paddingBottom) || 0,
          header: chatsHeader
            ? {
                box: box(chatsHeader),
                titleBox: box(chatsTitle),
                controls: chatsControls.map((control) => ({
                  label: control.getAttribute("aria-label"),
                  box: box(control)
                }))
              }
            : null,
          search: searchInput
            ? {
                box: box(searchInput),
                panelBox: box(document.querySelector(".chats-rail__search")),
                value: searchInput.value,
                placeholder: searchInput.getAttribute("placeholder"),
                focused: document.activeElement === searchInput
              }
            : null,
          viewMenu: viewMenu
            ? {
                box: box(viewMenu),
                title: text(viewMenu.querySelector(".chats-rail__menu-title")),
                items: Array.from(
                  viewMenu.querySelectorAll('[role="menuitemradio"]')
                ).map((el) => ({
                  label: el.getAttribute("aria-label"),
                  checked: el.getAttribute("aria-checked") === "true"
                }))
              }
            : null,
          listOptions: window.__lqListOptions ?? []
        }
      : null,
    rows,
    rowCount: rows.length,
    tabs,
    tabCount: tabs.length,
    heading: text(
      document.querySelector(".chat-panel__heading--thread") ??
        document.querySelector(".chat-panel__heading")
    ),
    list: Boolean(document.querySelector(".chat-panel__list")),
    thread: Boolean(threadHeader),
    panel: box(panel),
    composer: composer
      ? {
          box: box(composer),
          value: composer.value,
          disabled: composer.disabled,
          focused: document.activeElement === composer
        }
      : null,
    active: (() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute("aria-label"),
        composer: el === composer
      };
    })(),
    messages,
    dialog: dialog
      ? {
          title: text(dialog.querySelector(".confirm-dialog__title")),
          message: text(dialog.querySelector(".confirm-dialog__message")),
          confirm: Boolean(dialog.querySelector(".confirm-dialog__confirm"))
        }
      : null,
    calls: window.__lqCalls ?? [],
    patchCalls: window.__lqPatchCalls ?? [],
    deleteCalls: window.__lqDeleteCalls ?? [],
    messageCalls: window.__lqMessageCalls ?? [],
    stopCalls: window.__lqStopCalls ?? []
  };
})()`;

/**
 * Slide the window so the ambient pointer cannot sit over the chats rail.
 *
 * This rig is the first in the suite whose assertions read `:hover`, and it
 * reads them on a SHOWN window (a hidden window takes no pointer at all). The
 * bench shares one X display with the operator's app, so the cursor may already
 * be resting over a chat row when the rig starts: the window would inherit that
 * hover on show and the "at rest" landing sample would measure a hover the rig
 * never produced.
 *
 * The window nearly fills the display, so there is no corner clear of the
 * cursor; what the sample needs is narrower — the cursor not over the chat
 * rows. Moving the window horizontally by its one free strip (the difference
 * between the display and the window) either pushes the rail under a different
 * screen x or pushes the cursor outside the window. One of the two extremes
 * always maps the ambient pointer off the rail, for any cursor position.
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

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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

  /** Press a control inside one row, the way a pointer would land on it. */
  const clickRowControl = (label, selector) =>
    run(`(async () => {
      const row = ${findRowScript(label)};
      const target = row ? row.querySelector(${JSON.stringify(selector)}) : null;
      if (!target) return false;
      target.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const clickSidebarMenuItem = (label) =>
    run(`(async () => {
      const el = document.querySelector('.chats-rail__menu [aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** A header control of the chats section, by its accessible name. */
  const clickRailControl = (label) =>
    run(`(async () => {
      const el = Array.from(document.querySelectorAll(".chats-rail__header-actions button")).find(
        (button) => button.getAttribute("aria-label") === ${JSON.stringify(label)}
      );
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Type into the chats search field, through React's own input handling. */
  const typeSearch = (next) =>
    run(`(async () => {
      const el = document.querySelector(".chats-rail__search-input");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(next)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    })()`);

  /** Close the search with the cross in its own field. */
  const closeSearchBox = () =>
    run(`(async () => {
      const el = document.querySelector(".chats-rail__search-clear");
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** A press anywhere outside the field: the sidebar's list is the nearest one. */
  const pressOutsideSearch = () =>
    run(`(async () => {
      const el = document.querySelector(".chats-rail__list");
      if (!el) return false;
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Escape in the field. */
  const pressEscapeSearch = () =>
    run(`(async () => {
      const el = document.querySelector(".chats-rail__search-input");
      if (!el) return false;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** One option of the chats section's view menu. */
  const clickViewOption = (label) =>
    run(`(async () => {
      const el = Array.from(document.querySelectorAll(".chats-rail__view-menu [role=menuitemradio]")).find(
        (item) => item.getAttribute("aria-label") === ${JSON.stringify(label)}
      );
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const clickTab = (label) =>
    run(`(async () => {
      const tab = Array.from(document.querySelectorAll(".chat-panel__tab")).find(
        (el) => (el.querySelector(".chat-panel__tab-label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const button = tab?.querySelector("[role=tab]");
      if (!button) return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const closeTab = (label) =>
    run(`(async () => {
      const tab = Array.from(document.querySelectorAll(".chat-panel__tab")).find(
        (el) => (el.querySelector(".chat-panel__tab-label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const button = tab?.querySelector(".chat-panel__tab-close");
      if (!button) return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const typeAndSend = (text) =>
    run(`(async () => {
      const el = document.querySelector(".chat-panel__composer-input");
      if (!el) return "missing";
      if (el.disabled) return "disabled";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const send = document.querySelector('[aria-label="Send message"]');
      if (!send) return "no-send";
      send.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return "sent";
    })()`);

  const emit = (sessionId, event) =>
    run(`window.__lqEmit(${JSON.stringify(sessionId)}, ${JSON.stringify(event)})`);

  const clickDialog = (which) =>
    run(`(async () => {
      const el = document.querySelector(".confirm-dialog__${which}");
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `chat-tabs-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  let report;
  const screenshots = [];
  const timeout = setTimeout(() => {
    console.error("chat-tabs: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatTabsHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    // The window is shown so a REAL pointer can drive `:hover`; slide it so the
    // operator's parked cursor cannot decide the landing state for us.
    const railRect = await run(`(() => {
      const r = document.querySelector(".chats-rail")?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right } : null;
    })()`);
    placeWindowOffTheRail(win, railRect ?? { left: 0, right: 260 });
    win.showInactive();
    // Park the pointer away from the rows before the first sample: a cursor an
    // operator left over the window must not decide whether landing is "at rest".
    await unhover();

    // 1 — the sidebar lists every live chat in one flat list, pinned first, and
    // the dock lands on a thread with one tab (so the strip is not noise).
    const landing = await settle(300);
    check("the left sidebar lists the chats", landing.rowCount === 5, `${landing.rowCount} rows`);
    check(
      "the New chat button centres its icon and label",
      landing.rail?.newChatCentered === true,
      JSON.stringify({ centered: landing.rail?.newChatCentered }),
    );
    check(
      "the pinned chat is the first row of the flat list",
      landing.rows[0]?.label === "Pinned note" && landing.rows[0]?.pinned === true,
      JSON.stringify(landing.rows.map((r) => [r.label, r.pinned])),
    );
    check(
      "every other row is unpinned",
      landing.rows.slice(1).every((row) => row.pinned === false),
      JSON.stringify(landing.rows.map((r) => [r.label, r.pinned])),
    );
    check(
      "only the pinned row wears a resting pin mark",
      landing.rows[0]?.pinState === true &&
        landing.rows.slice(1).every((row) => row.pinState === false),
      JSON.stringify(landing.rows.map((r) => [r.label, r.pinState])),
    );
    check(
      "the resting rows show their time",
      landing.rows.every((row) => row.whenVisible),
      JSON.stringify(landing.rows.map((r) => [r.label, r.whenVisible])),
    );
    check(
      "pin and archive are hover-only",
      landing.rows.every((row) => !row.actionsVisible),
      JSON.stringify(landing.rows.map((r) => [r.label, r.actionsVisible])),
    );
    // The rail breathes above and below its rows instead of starting flush
    // against its frame.
    check(
      "the rail keeps dead space above and below its rows",
      (landing.rail?.paddingTop ?? 0) >= 10 && (landing.rail?.paddingBottom ?? 0) >= 10,
      JSON.stringify({
        paddingTop: landing.rail?.paddingTop,
        paddingBottom: landing.rail?.paddingBottom,
      }),
    );
    check(
      "the dock lands on the newest chat",
      landing.heading === "Alpha planning" && landing.thread && !landing.list,
      `heading "${landing.heading}", list ${landing.list}`,
    );
    check("one open chat draws no tab strip", landing.tabCount === 0, `${landing.tabCount} tabs`);
    check(
      "the composer is ready on landing",
      landing.composer !== null && !landing.composer.disabled,
      JSON.stringify(landing.composer),
    );
    screenshots.push(await shot("landing"));

    // 1b — pin and archive are hover-only: a real pointer over a row reveals
    // them and the resting time/pin mark step aside, on that row only.
    check("hovered the pinned row", await hoverSidebarRow("Pinned note"), "no row to hover");
    const hovered = await settle();
    const hoveredPinnedRow = hovered.rows.find((row) => row.label === "Pinned note");
    check(
      "hovering a row reveals its actions, and only that row's",
      hoveredPinnedRow?.actionsVisible === true &&
        hovered.rows.filter((row) => row.actionsVisible).length === 1,
      JSON.stringify(hovered.rows.map((r) => [r.label, r.actionsVisible])),
    );
    check(
      "the resting time and pin mark step aside under the pointer",
      hoveredPinnedRow?.whenVisible === false && hoveredPinnedRow?.pinState === false,
      JSON.stringify({ when: hoveredPinnedRow?.whenVisible, pinState: hoveredPinnedRow?.pinState }),
    );
    check(
      "the pinned row's hover control is Unpin, filled, right after Archive",
      hoveredPinnedRow?.pin.exists === true &&
        hoveredPinnedRow?.pin.visible === true &&
        hoveredPinnedRow?.pin.label === "Unpin chat" &&
        hoveredPinnedRow?.pin.dataPinned === "true" &&
        hoveredPinnedRow?.pin.filled === true &&
        hoveredPinnedRow?.archive.visible === true &&
        hoveredPinnedRow?.archive.label === "Archive chat" &&
        hoveredPinnedRow?.archive.beforePin === true,
      JSON.stringify({ pin: hoveredPinnedRow?.pin, archive: hoveredPinnedRow?.archive }),
    );

    check("hovered an unpinned row", await hoverSidebarRow("Alpha planning"), "no row to hover");
    const hoveredUnpinned = await settle();
    const alphaHover = hoveredUnpinned.rows.find((row) => row.label === "Alpha planning");
    check(
      "the unpinned row's hover control is Pin, outline, and visible",
      hoveredUnpinned.rows.filter((row) => row.actionsVisible).length === 1 &&
        alphaHover?.actionsVisible === true &&
        alphaHover?.pin.visible === true &&
        alphaHover?.pin.label === "Pin chat" &&
        alphaHover?.pin.dataPinned === null &&
        alphaHover?.pin.filled === false,
      JSON.stringify({ pin: alphaHover?.pin, actions: alphaHover?.actionsVisible }),
    );
    check(
      "the unpinned row's archive control sits right before the pin",
      alphaHover?.archive.visible === true &&
        alphaHover?.archive.label === "Archive chat" &&
        alphaHover?.archive.beforePin === true,
      JSON.stringify(alphaHover?.archive),
    );
    // The artifact: one row lit up with its pin and archive icons.
    screenshots.push(await shot("hover"));

    check("moved the pointer off the rows", await unhover(), "no neutral point");
    const unhovered = await settle();
    check(
      "the hover controls go away with the pointer",
      unhovered.rows.every((row) => !row.actionsVisible),
      JSON.stringify(unhovered.rows.map((r) => [r.label, r.actionsVisible])),
    );
    check(
      "the resting time and pin mark come back",
      unhovered.rows.every((row) => row.whenVisible) &&
        unhovered.rows.find((row) => row.label === "Pinned note")?.pinState === true,
      JSON.stringify(unhovered.rows.map((r) => [r.label, r.whenVisible, r.pinState])),
    );

    // 2 — a plain click is navigation: the clicked chat takes over the main chat
    // and no tab is added.
    check("clicked Bravo", await clickSidebarRow("Bravo budget"), "no row button");
    const opened = await settle();
    check(
      "the dock shows the chat the row named",
      opened.heading === "Bravo budget" && opened.thread,
      `heading "${opened.heading}"`,
    );
    check(
      "the transcript read is the clicked chat's",
      opened.messageCalls.at(-1) === "chat-bravo",
      JSON.stringify(opened.messageCalls.slice(-3)),
    );
    check(
      "a plain click added no tab",
      opened.tabCount === 0,
      `${opened.tabCount} tabs — the strip should still be hidden with one chat`,
    );
    check(
      "the clicked chat is the active row",
      opened.rows.find((row) => row.label === "Bravo budget")?.active === true,
      JSON.stringify(opened.rows),
    );

    // 3 — a middle click keeps the chat in front and gives the clicked chat its
    // own tab. If step 2 had added a tab instead of replacing, this would draw
    // three; two is the proof that the plain click navigated.
    check("middle-clicked Alpha", await middleClickSidebarRow("Alpha planning"), "no row button");
    const middleOpened = await settle();
    check(
      "a middle click opens the chat in a new tab",
      middleOpened.tabCount === 2 &&
        middleOpened.tabs.map((tab) => tab.label).join("/") === "Bravo budget/Alpha planning" &&
        middleOpened.tabs[1]?.active === true &&
        middleOpened.heading === "Alpha planning",
      JSON.stringify({ tabs: middleOpened.tabs, heading: middleOpened.heading }),
    );

    // 4 — the row menu offers the same gesture in words.
    check("opened Delta's menu", await openSidebarMenu("Delta automation"), "no menu control");
    check(
      "clicked Open in new tab",
      await clickSidebarMenuItem("Open in new tab"),
      "no Open in new tab item",
    );
    const menuOpened = await settle();
    check(
      "the menu's Open in new tab adds a tab",
      menuOpened.tabCount === 3 &&
        menuOpened.tabs.map((tab) => tab.label).join("/") ===
          "Bravo budget/Alpha planning/Delta automation" &&
        menuOpened.heading === "Delta automation",
      JSON.stringify({ tabs: menuOpened.tabs, heading: menuOpened.heading }),
    );

    // 5 — closing that tab lands on a neighbour and keeps the chat listed.
    check("closed Delta's tab", await closeTab("Delta automation"), "no close control");
    const menuClosed = await settle();
    check(
      "closing a tab hands over to its neighbour",
      menuClosed.tabCount === 2 &&
        menuClosed.tabs.map((tab) => tab.label).join("/") === "Bravo budget/Alpha planning" &&
        menuClosed.heading === "Alpha planning",
      JSON.stringify({ tabs: menuClosed.tabs, heading: menuClosed.heading }),
    );
    check(
      "the closed chat is still in the sidebar",
      menuClosed.rows.some((row) => row.label === "Delta automation"),
      JSON.stringify(menuClosed.rows.map((row) => row.label)),
    );

    // 6 — send in Alpha, then switch to Bravo and send there while Alpha is
    // still in the air. The two turns must not serialise.
    check("sent in Alpha", (await typeAndSend("Plan the alpha launch")) === "sent", "composer refused");
    const alphaLive = await settle();
    check(
      "Alpha's turn reached the bridge as Alpha",
      alphaLive.calls.at(-1)?.sessionId === "chat-alpha",
      JSON.stringify(alphaLive.calls),
    );
    check(
      "Alpha's tab and row both show the live turn",
      alphaLive.tabs.find((tab) => tab.label === "Alpha planning")?.live === true &&
        alphaLive.rows.find((row) => row.label === "Alpha planning")?.live === true,
      JSON.stringify({ tabs: alphaLive.tabs, rows: alphaLive.rows }),
    );
    check(
      "the sidebar counts the running chat",
      alphaLive.rail?.liveCount === "1 running",
      JSON.stringify(alphaLive.rail?.liveCount),
    );

    check("switched to Bravo", await clickTab("Bravo budget"), "no Bravo tab");
    const bravoReady = await settle();
    check(
      "Bravo's composer is usable while Alpha runs",
      bravoReady.composer !== null && !bravoReady.composer.disabled,
      JSON.stringify(bravoReady.composer),
    );
    check(
      "switching did not drop Alpha's live tab",
      bravoReady.tabs.find((tab) => tab.label === "Alpha planning")?.live === true,
      JSON.stringify(bravoReady.tabs),
    );
    check("sent in Bravo", (await typeAndSend("Plan the bravo budget")) === "sent", "composer refused");
    const bothLive = await settle();
    check(
      "both turns are in the air at once",
      bothLive.calls.length === 2 &&
        bothLive.tabs.filter((tab) => tab.live).length === 2 &&
        bothLive.rows.filter((row) => row.live).length === 2,
      JSON.stringify({ calls: bothLive.calls, tabs: bothLive.tabs, rows: bothLive.rows }),
    );
    check(
      "the sidebar counts both running chats",
      bothLive.rail?.liveCount === "2 running",
      JSON.stringify(bothLive.rail?.liveCount),
    );
    screenshots.push(await shot("parallel"));

    // 7 — frames land in the chat that owns them, even when it is not on screen.
    await emit("chat-bravo", { type: "run.started", runId: "run-bravo" });
    await emit("chat-bravo", { type: "assistant.delta", text: "BRAVO-ONLY-1 " });
    await emit("chat-alpha", { type: "assistant.delta", text: "ALPHA-ONLY-1 " });
    await emit("chat-bravo", { type: "assistant.delta", text: "BRAVO-ONLY-2 " });
    await emit("chat-alpha", { type: "assistant.delta", text: "ALPHA-ONLY-2" });
    const interleaved = await settle();
    const bravoText = interleaved.messages.map((m) => m.content).join(" | ");
    check(
      "Bravo's thread holds only Bravo's deltas",
      bravoText.includes("BRAVO-ONLY-1") &&
        bravoText.includes("BRAVO-ONLY-2") &&
        !bravoText.includes("ALPHA-ONLY") &&
        bravoText.includes("Plan the bravo budget"),
      bravoText,
    );

    check("switched to Alpha", await clickTab("Alpha planning"), "no Alpha tab");
    const alphaThread = await settle();
    const alphaText = alphaThread.messages.map((m) => m.content).join(" | ");
    check(
      "Alpha's thread holds only Alpha's deltas",
      alphaText.includes("ALPHA-ONLY-1") &&
        alphaText.includes("ALPHA-ONLY-2") &&
        !alphaText.includes("BRAVO-ONLY"),
      alphaText,
    );

    // 8 — the turns settle, and the live marks go with them.
    await emit("chat-alpha", { type: "run.completed" });
    await emit("chat-bravo", { type: "run.completed" });
    await run("window.__lqFinishChat('chat-alpha')");
    await run("window.__lqFinishChat('chat-bravo')");
    const finished = await settle();
    check(
      "no tab stays live once the turns end",
      finished.tabs.every((tab) => !tab.live),
      JSON.stringify(finished.tabs),
    );
    check(
      "no row stays live once the turns end",
      finished.rows.every((row) => !row.live),
      JSON.stringify(finished.rows),
    );
    check(
      "the running count goes away with the last turn",
      !finished.rail?.liveCount,
      JSON.stringify(finished.rail?.liveCount),
    );

    // 9 — a plain click mid-turn still replaces the main chat: the running chat
    // is split into its own tab first, so the reply is never hidden.
    check("sent in Alpha again", (await typeAndSend("Alpha follow-up")) === "sent", "composer refused");
    const alphaAgain = await settle();
    check(
      "Alpha is live again",
      alphaAgain.tabs.find((tab) => tab.label === "Alpha planning")?.live === true,
      JSON.stringify(alphaAgain.tabs),
    );
    check("clicked Charlie while Alpha runs", await clickSidebarRow("Charlie retro"), "no row button");
    const split = await settle();
    check(
      "the plain click replaced the main chat",
      split.heading === "Charlie retro" && split.thread,
      `heading "${split.heading}"`,
    );
    check(
      "the running chat was split into its own tab rather than lost",
      split.tabCount === 3 &&
        split.tabs.find((tab) => tab.label === "Charlie retro")?.active === true &&
        split.tabs.find((tab) => tab.label === "Alpha planning")?.live === true,
      JSON.stringify(split.tabs),
    );
    check(
      "the running chat's tab is still there",
      split.tabs.some((tab) => tab.label === "Alpha planning"),
      JSON.stringify(split.tabs),
    );
    await emit("chat-alpha", { type: "run.completed" });
    await run("window.__lqFinishChat('chat-alpha')");
    const splitSettled = await settle();
    check(
      "the split tab settles with its run",
      splitSettled.tabs.every((tab) => !tab.live),
      JSON.stringify(splitSettled.tabs),
    );

    // 10 — the row's hover pin control: one patch to the bridge, and the row
    // becomes the very first row (a fresh pin leads the list).
    check("hovered Bravo", await hoverSidebarRow("Bravo budget"), "no row to hover");
    const hoveredBravo = await settle();
    check(
      "Bravo's hover pin control is visible before the click",
      hoveredBravo.rows.find((row) => row.label === "Bravo budget")?.pin.visible === true,
      JSON.stringify(hoveredBravo.rows.find((row) => row.label === "Bravo budget")?.pin),
    );
    check(
      "clicked Bravo's hover pin",
      await clickRowControl("Bravo budget", ".chats-rail__pin-btn"),
      "no pin control",
    );
    check("moved the pointer off the rows after the pin", await unhover(), "no neutral point");
    const pinned = await settle();
    check(
      "Pin reached the bridge for Bravo",
      pinned.patchCalls.at(-1)?.id === "chat-bravo" &&
        pinned.patchCalls.at(-1)?.patch.pinned === true,
      JSON.stringify(pinned.patchCalls.at(-1)),
    );
    check(
      "the newly pinned chat is the very first row",
      pinned.rows[0]?.label === "Bravo budget" && pinned.rows[0]?.pinned === true,
      JSON.stringify(pinned.rows.map((row) => [row.label, row.pinned])),
    );
    check(
      "the pinned row shows its resting pin mark and its hover controls are gone",
      pinned.rows[0]?.pinState === true && pinned.rows.every((row) => !row.actionsVisible),
      JSON.stringify(pinned.rows.map((row) => [row.label, row.pinState, row.actionsVisible])),
    );

    // 10b — the same control toggles: Unpin un-pins, and the row leaves the front.
    check("hovered the now-pinned Bravo", await hoverSidebarRow("Bravo budget"), "no row to hover");
    const hoveredPinned = await settle();
    const pinnedHover = hoveredPinned.rows.find((row) => row.label === "Bravo budget");
    check(
      "the pinned row's hover control reads Unpin and is filled",
      pinnedHover?.pin.visible === true &&
        pinnedHover?.pin.label === "Unpin chat" &&
        pinnedHover?.pin.dataPinned === "true" &&
        pinnedHover?.pin.filled === true &&
        pinnedHover?.pinState === false,
      JSON.stringify(pinnedHover?.pin),
    );
    check(
      "clicked Bravo's hover Unpin",
      await clickRowControl("Bravo budget", ".chats-rail__pin-btn"),
      "no pin control",
    );
    check("moved the pointer off the rows after the unpin", await unhover(), "no neutral point");
    const unpinned = await settle();
    check(
      "Unpin reached the bridge for Bravo",
      unpinned.patchCalls.at(-1)?.id === "chat-bravo" &&
        unpinned.patchCalls.at(-1)?.patch.pinned === false,
      JSON.stringify(unpinned.patchCalls.at(-1)),
    );
    const unpinnedBravo = unpinned.rows.find((row) => row.label === "Bravo budget");
    check(
      "the unpinned chat left the front and lost its pin mark",
      unpinnedBravo?.pinned === false &&
        unpinnedBravo?.pinState === false &&
        unpinned.rows[0]?.label === "Pinned note",
      JSON.stringify(unpinned.rows.map((row) => [row.label, row.pinned, row.pinState])),
    );

    // 10c — pin it again, so the archive/delete/background states below run
    // against the same list they always did (Bravo pinned, three rows after).
    check("hovered Bravo once more", await hoverSidebarRow("Bravo budget"), "no row to hover");
    check(
      "clicked Bravo's pin again",
      await clickRowControl("Bravo budget", ".chats-rail__pin-btn"),
      "no pin control",
    );
    check("moved the pointer off the rows after the re-pin", await unhover(), "no neutral point");
    const repinned = await settle();
    check(
      "Bravo is pinned again and back at the front",
      repinned.patchCalls.at(-1)?.id === "chat-bravo" &&
        repinned.patchCalls.at(-1)?.patch.pinned === true &&
        repinned.rows[0]?.label === "Bravo budget" &&
        repinned.rows[0]?.pinned === true,
      JSON.stringify({
        patch: repinned.patchCalls.at(-1),
        rows: repinned.rows.map((row) => [row.label, row.pinned]),
      }),
    );

    // 11 — the hover archive control removes the row and the tab it had.
    check("hovered Alpha", await hoverSidebarRow("Alpha planning"), "no row to hover");
    const hoveredAlpha = await settle();
    check(
      "Alpha's hover archive control is visible before the click",
      hoveredAlpha.rows.find((row) => row.label === "Alpha planning")?.archive.visible === true,
      JSON.stringify(hoveredAlpha.rows.find((row) => row.label === "Alpha planning")?.archive),
    );
    check(
      "clicked Alpha's hover archive",
      await clickRowControl("Alpha planning", ".chats-rail__archive-btn"),
      "no archive control",
    );
    check("moved the pointer off the rows after the archive", await unhover(), "no neutral point");
    const archived = await settle();
    check(
      "Archive reached the bridge for Alpha",
      archived.patchCalls.at(-1)?.id === "chat-alpha" &&
        archived.patchCalls.at(-1)?.patch.archived === true,
      JSON.stringify(archived.patchCalls.at(-1)),
    );
    check(
      "the archived chat left the sidebar",
      !archived.rows.some((row) => row.label === "Alpha planning") && archived.rowCount === 4,
      JSON.stringify(archived.rows.map((row) => row.label)),
    );
    check(
      "the archived chat's tab went with it",
      archived.tabs.every((tab) => tab.label !== "Alpha planning"),
      JSON.stringify(archived.tabs),
    );
    check(
      "archiving a background tab did not move the open thread",
      archived.heading === "Charlie retro",
      `heading "${archived.heading}"`,
    );

    // 12 — delete asks through the app's own dialog, and only then writes.
    check("opened Charlie's menu", await openSidebarMenu("Charlie retro"), "no menu control");
    check("clicked Delete", await clickSidebarMenuItem("Delete chat"), "no Delete item");
    const asked = await settle();
    check(
      "delete asked first, in the app's dialog",
      asked.dialog?.title === "Delete chat" && asked.dialog?.confirm === true,
      JSON.stringify(asked.dialog),
    );
    check("delete wrote nothing before the answer", asked.deleteCalls.length === 0, JSON.stringify(asked.deleteCalls));
    check("answered the dialog", await clickDialog("cancel"), "no cancel control");
    const declined = await settle();
    check("a cancelled delete wrote nothing", declined.deleteCalls.length === 0, JSON.stringify(declined.deleteCalls));
    check("a cancelled delete kept the row", declined.rowCount === 4, `${declined.rowCount} rows`);

    check("opened Charlie's menu once more", await openSidebarMenu("Charlie retro"), "no menu control");
    check("clicked Delete again", await clickSidebarMenuItem("Delete chat"), "no Delete item");
    check("confirmed the delete", await clickDialog("confirm"), "no confirm control");
    const deleted = await settle();
    check(
      "the delete reached the bridge for Charlie",
      deleted.deleteCalls.at(-1) === "chat-charlie",
      JSON.stringify(deleted.deleteCalls),
    );
    check(
      "the deleted chat left the sidebar",
      !deleted.rows.some((row) => row.label === "Charlie retro") && deleted.rowCount === 3,
      JSON.stringify(deleted.rows.map((row) => row.label)),
    );
    check(
      "deleting the open chat hands over to its neighbour tab",
      deleted.heading === "Bravo budget" && deleted.tabCount === 0,
      JSON.stringify({ tabs: deleted.tabs, heading: deleted.heading }),
    );

    // 13 — a run for a chat nobody opened appears as a tab without stealing the
    // screen. This is the scheduled-automation case.
    await emit("chat-delta", { type: "run.started", runId: "run-delta" });
    await emit("chat-delta", { type: "assistant.delta", text: "DELTA-BACKGROUND" });
    const background = await settle();
    check(
      "a background run grows a tab",
      background.tabCount === 2 &&
        background.tabs.some((tab) => tab.label === "Delta automation" && tab.live),
      JSON.stringify(background.tabs),
    );
    check(
      "the background run does not steal the active chat",
      background.heading === "Bravo budget" &&
        background.tabs.find((tab) => tab.label === "Bravo budget")?.active === true,
      JSON.stringify({ heading: background.heading, tabs: background.tabs }),
    );
    check(
      "the background chat's sidebar row shows it running",
      background.rows.find((row) => row.label === "Delta automation")?.live === true,
      JSON.stringify(background.rows),
    );
    screenshots.push(await shot("background"));

    // 14 — closing a live tab stops its run, and the tab does not come back on
    // the frames that were already on the wire.
    check("closed the live Delta tab", await closeTab("Delta automation"), "no close control");
    const closedLive = await settle();
    check(
      "closing a live tab stopped its run",
      closedLive.stopCalls.includes("run-delta"),
      JSON.stringify(closedLive.stopCalls),
    );
    await emit("chat-delta", { type: "assistant.delta", text: " LATE" });
    const lateFrame = await settle();
    check(
      "a late frame does not resurrect the closed tab",
      lateFrame.tabCount === 0 && lateFrame.heading === "Bravo budget",
      JSON.stringify({ tabs: lateFrame.tabs, heading: lateFrame.heading }),
    );
    check(
      "the late frame still landed in the chat's own run",
      lateFrame.rows.find((row) => row.label === "Delta automation")?.live === true,
      JSON.stringify(lateFrame.rows),
    );

    // 15 — the chats header carries its two controls in line with the heading:
    // search the list, and choose which views (all chats or hidden archives)
    // the list is drawn from.
    const header = await settle();
    check(
      "the chats header carries a search and a view control",
      header.rail?.header?.controls.map((control) => control.label).join("/") ===
        "Search chats/View options",
      JSON.stringify(header.rail?.header?.controls),
    );
    check(
      "both header controls sit on the heading's row",
      Boolean(header.rail?.header) &&
        header.rail.header.controls.every(
          (control) =>
            Math.abs(
              (control.box.top + control.box.bottom) / 2 -
                (header.rail.header.titleBox.top + header.rail.header.titleBox.bottom) / 2,
            ) <= 4,
        ),
      JSON.stringify(header.rail?.header),
    );
    check(
      "no search box before the icon is clicked",
      header.rail?.search === null,
      JSON.stringify(header.rail?.search),
    );
    check(
      "no view menu before the icon is clicked",
      header.rail?.viewMenu === null,
      JSON.stringify(header.rail?.viewMenu),
    );

    // 16 — the search icon opens a full-width field; typing narrows the rows to
    // the chats that match, without touching the dock.
    check("clicked search", await clickRailControl("Search chats"), "no search control");
    const searchOpen = await settle();
    check(
      "the search icon turns the header into a search box",
      searchOpen.rail?.search?.focused === true &&
        searchOpen.rail.search.value === "" &&
        searchOpen.rail.search.placeholder === "Search chats",
      JSON.stringify(searchOpen.rail?.search),
    );
    check(
      "the field takes the header's own line",
      Boolean(searchOpen.rail?.search && searchOpen.rail.header) &&
        searchOpen.rail.header.titleBox === null &&
        searchOpen.rail.header.controls.length === 0 &&
        searchOpen.rail.search.panelBox.top >= searchOpen.rail.header.box.top - 1 &&
        searchOpen.rail.search.panelBox.bottom <=
          searchOpen.rail.header.box.bottom + 1,
      JSON.stringify({
        search: searchOpen.rail?.search?.panelBox,
        header: searchOpen.rail?.header,
      }),
    );
    check(
      "the field spans the row the title and icons had",
      Boolean(searchOpen.rail?.search && searchOpen.rail.newChatBox) &&
        Math.abs(
          searchOpen.rail.search.panelBox.left -
            searchOpen.rail.newChatBox.left,
        ) <= 1 &&
        Math.abs(
          searchOpen.rail.search.panelBox.right -
            searchOpen.rail.newChatBox.right,
        ) <= 1,
      `search ${JSON.stringify(searchOpen.rail?.search?.panelBox)} vs New chat ${JSON.stringify(searchOpen.rail?.newChatBox)}`,
    );
    check("typed in the search box", await typeSearch("delta"), "no search input");
    const searched = await settle();
    check(
      "the search narrows the rows to the match",
      searched.rows.map((row) => row.label).join("/") === "Delta automation" &&
        searched.rail?.groups.length === 0,
      JSON.stringify(searched.rows.map((row) => [row.group, row.label])),
    );
    check(
      "searching leaves the open chat alone",
      searched.heading === "Bravo budget",
      `heading "${searched.heading}"`,
    );
    screenshots.push(await shot("search"));
    check("typed a miss", await typeSearch("zzz"), "no search input");
    const noMatch = await settle();
    check(
      "a search with no match says so",
      noMatch.rowCount === 0 &&
        (noMatch.rail?.empty ?? "").includes("No chats match"),
      JSON.stringify({ rows: noMatch.rowCount, empty: noMatch.rail?.empty }),
    );
    check(
      "the archived chats are not searchable while the view hides them",
      (await typeSearch("alpha")) && (await settle()).rowCount === 0,
      "an archived chat came back through the search while hidden",
    );
    check("closed the search with its cross", await closeSearchBox(), "no close control");
    const closedByCross = await settle();
    check(
      "the cross restores the chats header",
      closedByCross.rail?.search === null &&
        closedByCross.rail?.header?.titleBox !== null &&
        closedByCross.rail?.header?.controls.length === 2 &&
        closedByCross.rowCount === 3,
      JSON.stringify({
        search: closedByCross.rail?.search,
        header: closedByCross.rail?.header,
        rows: closedByCross.rowCount,
      }),
    );
    check("reopened the search", await clickRailControl("Search chats"), "no search control");
    await settle();
    check("pressed outside the field", await pressOutsideSearch(), "no list to press");
    const closedByOutside = await settle();
    check(
      "a press outside the field closes it and restores the header",
      closedByOutside.rail?.search === null &&
        closedByOutside.rail?.header?.controls.length === 2,
      JSON.stringify({
        search: closedByOutside.rail?.search,
        header: closedByOutside.rail?.header,
      }),
    );
    check("reopened the search once more", await clickRailControl("Search chats"), "no search control");
    await settle();
    check("pressed Escape in the field", await pressEscapeSearch(), "no search input");
    const closedByEscape = await settle();
    check(
      "Escape also closes the field",
      closedByEscape.rail?.search === null &&
        closedByEscape.rail?.header?.controls.length === 2,
      JSON.stringify(closedByEscape.rail?.header),
    );

    // 17 — the view options icon opens the filter: hide the archived chats, or
    // show them as their own greyed, restorable group.
    check("opened view options", await clickRailControl("View options"), "no view control");
    const viewMenu = await settle();
    check(
      "the view menu names its two views",
      viewMenu.rail?.viewMenu?.title === "View options" &&
        JSON.stringify(viewMenu.rail.viewMenu.items) ===
          JSON.stringify([
            { label: "Hide archived chats", checked: true },
            { label: "Show archived chats", checked: false },
          ]),
      JSON.stringify(viewMenu.rail?.viewMenu),
    );
    screenshots.push(await shot("view-options"));
    check(
      "clicked Show archived chats",
      await clickViewOption("Show archived chats"),
      "no Show archived item",
    );
    const archivedShown = await settle(420);
    check(
      "the archived chats came into the list",
      archivedShown.rowCount === 6,
      `${archivedShown.rowCount} rows: ${JSON.stringify(archivedShown.rows.map((row) => row.label))}`,
    );
    check(
      "the view asked the list for the archived rows",
      archivedShown.rail?.listOptions.at(-1)?.includeArchived === true,
      JSON.stringify(archivedShown.rail?.listOptions),
    );
    check(
      "the archived chats sit in their own group",
      archivedShown.rail?.groups.includes("Archived") &&
        archivedShown.rows
          .filter((row) => row.archived)
          .map((row) => row.label)
          .sort()
          .join("/") === "Alpha planning/Echo archived/Foxtrot archived",
      JSON.stringify(archivedShown.rows.map((row) => [row.group, row.label, row.archived])),
    );
    check(
      "archived rows are greyed, tagged and not openable",
      archivedShown.rows
        .filter((row) => row.archived)
        .every(
          (row) =>
            row.archivedTag === "Archived" &&
            row.disabled === true &&
            row.group === "Archived",
        ),
      JSON.stringify(archivedShown.rows.filter((row) => row.archived)),
    );
    check(
      "the live chats are still listed above them",
      archivedShown.rows.filter((row) => !row.archived).length === 3,
      JSON.stringify(archivedShown.rows.filter((row) => !row.archived).map((row) => row.label)),
    );
    check(
      "the show-archived view does not change the open chat",
      archivedShown.heading === "Bravo budget",
      `heading "${archivedShown.heading}"`,
    );
    screenshots.push(await shot("archived-view"));
    check("clicked an archived row", await clickSidebarRow("Echo archived"), "no archived row");
    const archivedClick = await settle();
    check(
      "an archived row cannot be opened",
      archivedClick.heading === "Bravo budget" &&
        archivedClick.messageCalls.at(-1) !== "chat-echo",
      JSON.stringify({ heading: archivedClick.heading, reads: archivedClick.messageCalls.slice(-2) }),
    );
    check("searched the archived view", await clickRailControl("Search chats"), "no search control");
    check("typed an archived title", await typeSearch("echo"), "no search input");
    const archivedSearch = await settle();
    check(
      "the search finds an archived chat while the view shows them",
      archivedSearch.rowCount === 1 && archivedSearch.rows[0]?.archived === true,
      JSON.stringify(archivedSearch.rows.map((row) => [row.label, row.archived])),
    );
    check("closed the archived search", await closeSearchBox(), "no close control");
    await settle();
    check(
      "restored the archived chat",
      (await openSidebarMenu("Echo archived")) &&
        (await clickSidebarMenuItem("Unarchive chat")),
      "no Unarchive item",
    );
    const unarchived = await settle();
    check(
      "Unarchive reached the bridge",
      unarchived.patchCalls.at(-1)?.id === "chat-echo" &&
        unarchived.patchCalls.at(-1)?.patch.archived === false,
      JSON.stringify(unarchived.patchCalls.at(-1)),
    );
    check(
      "the restored chat rejoined the flat live list",
      unarchived.rows.find((row) => row.label === "Echo archived")?.archived === false &&
        unarchived.rows.find((row) => row.label === "Echo archived")?.group === "" &&
        unarchived.rowCount === 6,
      JSON.stringify(unarchived.rows.map((row) => [row.group, row.label, row.archived])),
    );
    check("opened view options again", await clickRailControl("View options"), "no view control");
    const viewMenuShown = await settle();
    check(
      "the view menu marks the current view",
      JSON.stringify(viewMenuShown.rail?.viewMenu?.items) ===
        JSON.stringify([
          { label: "Hide archived chats", checked: false },
          { label: "Show archived chats", checked: true },
        ]),
      JSON.stringify(viewMenuShown.rail?.viewMenu),
    );
    check(
      "clicked Hide archived chats",
      await clickViewOption("Hide archived chats"),
      "no Hide archived item",
    );
    const archivedHidden = await settle(420);
    check(
      "hiding the archived view takes the archived rows out again",
      archivedHidden.rowCount === 4 &&
        !archivedHidden.rail?.groups.includes("Archived") &&
        archivedHidden.rail?.listOptions.at(-1)?.includeArchived === false,
      JSON.stringify({
        rows: archivedHidden.rows.map((row) => [row.group, row.label]),
        listOptions: archivedHidden.rail?.listOptions,
      }),
    );
    check(
      "the restored chat survives the view being hidden",
      archivedHidden.rows.some((row) => row.label === "Echo archived" && !row.archived),
      JSON.stringify(archivedHidden.rows.map((row) => row.label)),
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: DEFAULT_SIZE,
      screenshots,
      states: {
        landing,
        hovered,
        hoveredUnpinned,
        unhovered,
        opened,
        middleOpened,
        menuOpened,
        menuClosed,
        alphaLive,
        bravoReady,
        bothLive,
        interleaved,
        alphaThread,
        finished,
        alphaAgain,
        split,
        splitSettled,
        hoveredBravo,
        pinned,
        hoveredPinned,
        unpinned,
        repinned,
        hoveredAlpha,
        archived,
        asked,
        declined,
        deleted,
        background,
        closedLive,
        lateFrame,
        header,
        searchOpen,
        searched,
        noMatch,
        closedByCross,
        closedByOutside,
        closedByEscape,
        viewMenu,
        archivedShown,
        archivedClick,
        archivedSearch,
        unarchived,
        viewMenuShown,
        archivedHidden,
      },
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  fs.writeFileSync(
    path.join(artifactsDir, "chat-tabs.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const state = report.states;
  if (state) {
    const table = [
      ["state", "rows", "tabs", "live", "heading", "calls", "patches"],
      ["landing", state.landing.rowCount, state.landing.tabCount, "", state.landing.heading, "", ""],
      ["hovered", state.hovered.rowCount, state.hovered.tabCount, "", state.hovered.heading, "", ""],
      ["hovered unpinned", state.hoveredUnpinned.rowCount, state.hoveredUnpinned.tabCount, "", state.hoveredUnpinned.heading, "", ""],
      ["unhovered", state.unhovered.rowCount, state.unhovered.tabCount, "", state.unhovered.heading, "", ""],
      ["opened", state.opened.rowCount, state.opened.tabCount, "", state.opened.heading, "", ""],
      ["middle", state.middleOpened.rowCount, state.middleOpened.tabCount, "", state.middleOpened.heading, "", ""],
      ["menu", state.menuOpened.rowCount, state.menuOpened.tabCount, "", state.menuOpened.heading, "", ""],
      ["alpha live", state.alphaLive.rowCount, state.alphaLive.tabCount, "alpha", state.alphaLive.heading, state.alphaLive.calls.length, ""],
      ["both live", state.bothLive.rowCount, state.bothLive.tabCount, "alpha + bravo", state.bothLive.heading, state.bothLive.calls.length, ""],
      ["finished", state.finished.rowCount, state.finished.tabCount, "", state.finished.heading, "", ""],
      ["split", state.split.rowCount, state.split.tabCount, "alpha", state.split.heading, "", ""],
      ["pinned", state.pinned.rowCount, state.pinned.tabCount, "", state.pinned.heading, "", state.pinned.patchCalls.length],
      ["unpinned", state.unpinned.rowCount, state.unpinned.tabCount, "", state.unpinned.heading, "", state.unpinned.patchCalls.length],
      ["repinned", state.repinned.rowCount, state.repinned.tabCount, "", state.repinned.heading, "", state.repinned.patchCalls.length],
      ["archived", state.archived.rowCount, state.archived.tabCount, "", state.archived.heading, "", state.archived.patchCalls.length],
      ["deleted", state.deleted.rowCount, state.deleted.tabCount, "", state.deleted.heading, "", ""],
      ["background", state.background.rowCount, state.background.tabCount, "delta", state.background.heading, "", ""],
    ];
    console.log(table.map((row) => row.join(" | ")).join("\n"));
  }
  for (const failure of report.failures ?? []) console.error(`FAIL ${failure}`);
  console.log(`chat-tabs: ${report.pass ? "pass" : "fail"}`);

  app.exit(report.pass ? 0 : 1);
}

app.whenReady().then(main);
