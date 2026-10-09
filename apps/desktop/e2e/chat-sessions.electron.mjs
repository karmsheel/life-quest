/**
 * Drives the chat-sessions harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/chat-sessions.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-sessions.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * NOT covered here: the HTTP hop. The rig answers from a fixture (seeded out of
 * the profile's state.db), so that `PATCH /api/sessions/{id}` really carries
 * `{pinned}`/`{title}`/`{archived}` to the gateway is asserted at the bridge
 * boundary only — no test in this repo opens that hop.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-sessions.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The bottom action bar's slots, in order: three live, one still reserved. */
const ACTION_SLOTS = [
  "Chat history",
  "New chat",
  "Search chats (coming soon)",
  "Life-Chain",
];

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
  const panel = document.querySelector(".chat-panel");
  const list = document.querySelector(".chat-panel__list");
  const ul = document.querySelector(".chat-panel__sessions");
  const items = Array.from(document.querySelectorAll(".chat-panel__session-item"));
  const body = document.querySelector(".chat-panel__body");
  const footer = document.querySelector(".chat-panel__footer");
  const composer = document.querySelector(".chat-panel__composer-input");
  const threadHeader = document.querySelector(".chat-panel__header--thread");
  const renameInput = document.querySelector(".chat-panel__rename-input");

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panel: box(panel),
    heading: text(document.querySelector(".chat-panel__heading")),
    list: list
      ? {
          box: box(list),
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          overflowY: getComputedStyle(list).overflowY
        }
      : null,
    listMaxHeight: ul ? getComputedStyle(ul).maxHeight : null,
    groups: Array.from(document.querySelectorAll(".chat-panel__sessions-group")).map(text),
    rowCount: items.length,
    rows: items.map((li) => {
      const button = li.querySelector(".chat-panel__session");
      return {
        label: text(li.querySelector(".chat-panel__session-label")),
        when: text(li.querySelector(".chat-panel__session-when")),
        pinned: Boolean(li.querySelector(".chat-panel__session-pin")),
        active: button ? button.getAttribute("aria-current") === "true" : false
      };
    }),
    lastRow: items.length ? box(items[items.length - 1]) : null,
    body: body
      ? { box: box(body), display: getComputedStyle(body).display, hidden: body.hidden }
      : null,
    footer: footer
      ? { box: box(footer), display: getComputedStyle(footer).display, hidden: footer.hidden }
      : null,
    composer: composer
      ? {
          box: box(composer),
          display: getComputedStyle(composer).display,
          // The caret is half of what the field is for, and this is the only
          // handle a driver has on it: the :focus pseudo-class does not match
          // while the window itself is unfocused (showInactive), while
          // document.activeElement is set either way.
          focused: document.activeElement === composer
        }
      : null,
    /** What holds the caret, named so a failed check can say where it went. */
    active: (() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute("aria-label"),
        composer: el === composer
      };
    })(),
    threadHeader: threadHeader
      ? {
          box: box(threadHeader),
          label: text(threadHeader.querySelector(".chat-panel__heading--thread")),
          actions: Array.from(threadHeader.querySelectorAll("button")).map((b) =>
            b.getAttribute("aria-label")
          )
        }
      : null,
    renaming: Boolean(renameInput),
    renameValue: renameInput ? renameInput.value : null,
    rowMenu: (() => {
      const menu = document.querySelector(".chat-panel__session-menu");
      if (!menu) return null;
      return Array.from(menu.querySelectorAll("[role='menuitem']")).map((b) =>
        b.getAttribute("aria-label")
      );
    })(),
    rowMenuRowIndex: (() => {
      const menu = document.querySelector(".chat-panel__session-menu");
      if (!menu) return null;
      const item = menu.closest(".chat-panel__session-item");
      return item ? items.indexOf(item) : null;
    })(),
    rowMenuBtnCount: document.querySelectorAll(".chat-panel__session-menu-btn").length,
    rowMenuBox: box(document.querySelector(".chat-panel__session-menu")),
    rowMenuItems: Array.from(
      document.querySelectorAll(".chat-panel__session-menu [role='menuitem']")
    ).map((b) => ({
      label: b.getAttribute("aria-label"),
      color: getComputedStyle(b).color
    })),
    rowMenuBackground: (() => {
      const menu = document.querySelector(".chat-panel__session-menu");
      return menu ? getComputedStyle(menu).backgroundColor : null;
    })(),
    rowRename: Boolean(document.querySelector(".chat-panel__session-rename")),
    rowRenameValue: (() => {
      const field = document.querySelector(
        ".chat-panel__session-rename .chat-panel__rename-input"
      );
      return field ? field.value : null;
    })(),
    lastChatStored: window.localStorage.getItem("lifequest.companion.lastSessionId"),
    messages: Array.from(document.querySelectorAll(".chat-panel__message-content")).map((el) =>
      text(el).slice(0, 80)
    ),
    actionsBar: box(document.querySelector(".chat-panel__actions")),
    actionsBarBackground: (() => {
      const el = document.querySelector(".chat-panel__actions");
      return el ? getComputedStyle(el).backgroundColor : null;
    })(),
    footerBackground: (() => {
      const el = document.querySelector(".chat-panel__footer");
      return el ? getComputedStyle(el).backgroundColor : null;
    })(),
    headerIconSize: (() => {
      const svg = document.querySelector(".chat-panel__header--thread button svg");
      return svg ? Math.round(svg.getBoundingClientRect().width) : null;
    })(),
    actions: Array.from(document.querySelectorAll(".chat-panel__action")).map((b) => {
      const svg = b.querySelector("svg");
      return {
        label: b.getAttribute("aria-label"),
        pressed: b.getAttribute("aria-pressed") === "true",
        disabled: b.disabled === true,
        opacity: Number(getComputedStyle(b).opacity),
        background: getComputedStyle(b).backgroundColor,
        iconSize: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
        icon: svg
          ? Array.from(svg.classList)
              .filter((c) => c.indexOf("lucide-") === 0)
              .join(" ")
          : null
      };
    }),
    patchCalls: window.__lqPatchCalls ?? [],
    createCalls: window.__lqCreateCalls ?? [],
    deleteCalls: window.__lqDeleteCalls ?? [],
    confirmDialog: (() => {
      const dialog = document.querySelector(".confirm-dialog");
      const backdrop = document.querySelector(".confirm-dialog-backdrop");
      if (!dialog || !backdrop) return null;
      const dialogBox = box(dialog);
      const confirmBtn = dialog.querySelector(".confirm-dialog__confirm");
      const cancelBtn = dialog.querySelector(".confirm-dialog__cancel");
      const panelBox = document.querySelector(".chat-panel");
      const panel = panelBox ? panelBox.getBoundingClientRect() : null;
      const centreX = dialogBox ? dialogBox.left + dialogBox.width / 2 : 0;
      const centreY = dialogBox ? dialogBox.top + dialogBox.height / 2 : 0;
      return {
        title: text(dialog.querySelector(".confirm-dialog__title")),
        message: text(dialog.querySelector(".confirm-dialog__message")),
        confirmLabel: confirmBtn ? confirmBtn.getAttribute("aria-label") : null,
        cancelLabel: cancelBtn ? cancelBtn.getAttribute("aria-label") : null,
        box: dialogBox,
        backdrop: box(backdrop),
        // A scrim that does not paint is not a scrim: the card would float with
        // nothing de-emphasised behind it.
        backdropBackground: getComputedStyle(backdrop).backgroundColor,
        // How far the card's centre sits from the window's centre, and from the
        // dock's: the first is the contract, the second is what the operator
        // complained about (a native dialog put it on the display's centre).
        offsetFromWindowX: Math.round(centreX - window.innerWidth / 2),
        offsetFromWindowY: Math.round(centreY - window.innerHeight / 2),
        offsetFromPanelX: panel
          ? Math.round(centreX - (panel.left + panel.width / 2))
          : null
      };
    })(),
    messageCalls: window.__lqMessageCalls ?? [],
    listCalls: window.__lqListCalls ?? 0,
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

/** RGB channels of a computed colour in 0–255, whatever syntax it resolved to. */
const channels = (color) => {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  // `color(srgb …)` reports 0–1 floats while `rgb()`/`rgba()` report 0–255.
  // Without normalising, cross-syntax comparisons pass for free (238 against
  // 0.74 "gaps" 237 and no colour change is ever detected).
  return raw.length === 3 && raw.every((value) => value <= 1.0001)
    ? raw.map((value) => value * 255)
    : raw;
};

/** Alpha of a computed colour: 1 when it carries none. */
const alphaOf = (color) => {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3] : 1;
};

/** Largest per-channel gap between two computed colours; NaN when unparseable. */
const channelDelta = (a, b) => {
  const x = channels(a);
  const y = channels(b);
  if (x.length < 3 || y.length < 3) return NaN;
  return Math.max(...x.map((value, index) => Math.abs(value - y[index])));
};

const last = (list) => (list.length ? list[list.length - 1] : null);

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

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const clickAria = (label) =>
    run(`(async () => {
      const el = document.querySelector('[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /**
   * The same press, the way a person makes it: a real one focuses the control
   * before it fires, so the caret starts on the button — which is exactly what
   * the composer has to take it back from. `clickAria` cannot show that: a
   * programmatic click never moves focus, so the field would still hold the
   * caret for free and a missing hand-back would measure as a pass.
   */
  const pressAria = (label) =>
    run(`(async () => {
      const el = document.querySelector('[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!el) return false;
      el.focus();
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const clickRow = (index) =>
    run(`(async () => {
      const el = document.querySelectorAll(".chat-panel__session")[${index}];
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  const typeRename = (value) =>
    run(`(async () => {
      const el = document.querySelector(".chat-panel__rename-input");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const save = document.querySelector('[aria-label="Save name"]');
      if (!save) return false;
      save.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** The 3-dot control on one chat row, or on the row the open menu belongs to. */
  const openRowMenu = (index) =>
    run(`(async () => {
      const el = document.querySelectorAll(".chat-panel__session-menu-btn")[${index}];
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** One item of the open row menu, by the aria-label the menu wears. */
  const clickMenuItem = (label) =>
    run(`(async () => {
      const el = document.querySelector('.chat-panel__session-menu [aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Renaming from the list: the field replaces the row, Save commits it. */
  const typeRowRename = (value) =>
    run(`(async () => {
      const el = document.querySelector(".chat-panel__session-rename .chat-panel__rename-input");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const save = document.querySelector('[aria-label="Save chat name"]');
      if (!save) return false;
      save.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** One of the dock's own confirm dialog's answers. */
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
    const file = path.join(artifactsDir, `chat-sessions-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  let report;
  const screenshots = [];
  const timeout = setTimeout(() => {
    console.error("chat-sessions: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatHarnessReady.then(() => true)");
    const expected = await run("window.chatHarnessExpected");
    const ids = await run("window.chatHarnessIds");
    const labels = await run("window.chatHarnessLabels");

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // 1 — the panel lands on a thread (the chat it opened last, else the newest)
    // and the transcript is chat, not tool traffic.
    const landing = await settle();
    check("panel opened on a thread", landing.threadHeader !== null, `view is ${landing.list ? "list" : "unknown"}`);
    check(
      "the thread names the newest chat",
      landing.threadHeader?.label === expected.newestLabel,
      `header "${landing.threadHeader?.label}" vs "${expected.newestLabel}"`,
    );
    check(
      "landing loaded that chat's transcript",
      landing.messageCalls.includes(ids[0]),
      `message calls ${JSON.stringify(landing.messageCalls)}`,
    );
    check(
      "tool rows are not chat bubbles",
      landing.messages.length === 4 &&
        !landing.messages.some((message) => message.includes("get_doctrine")),
      `${landing.messages.length} bubbles: ${JSON.stringify(landing.messages)}`,
    );
    check("the list is not up behind the thread", landing.list === null, "list rendered in thread view");
    check(
      "the composer is up in the thread",
      (landing.composer?.box.height ?? 0) > 0,
      `composer box ${JSON.stringify(landing.composer?.box)}`,
    );
    check(
      "the action bar holds its four slots",
      JSON.stringify(landing.actions.map((slot) => slot.label)) === JSON.stringify(ACTION_SLOTS),
      `slots ${JSON.stringify(landing.actions.map((slot) => slot.label))}`,
    );
    check(
      "the action bar sits at the bottom of the chatbar",
      Math.abs((landing.panel?.bottom ?? 0) - (landing.actionsBar?.bottom ?? -99)) <= 2,
      `bar ends at ${landing.actionsBar?.bottom}px, panel ends at ${landing.panel?.bottom}px`,
    );
    check(
      "the action bar clears the composer",
      (landing.actionsBar?.top ?? 0) >= (landing.footer?.box.bottom ?? 0) - 1,
      `bar starts at ${landing.actionsBar?.top}px, composer ends at ${landing.footer?.box.bottom}px`,
    );
    check(
      "the last two slots are live and the search slot is still reserved",
      JSON.stringify(landing.actions.map((slot) => slot.disabled)) ===
        JSON.stringify([false, false, true, false]),
      `disabled flags ${JSON.stringify(landing.actions.map((slot) => slot.disabled))}`,
    );
    check(
      "the slots wear four distinct icons",
      new Set(landing.actions.map((slot) => slot.icon)).size === ACTION_SLOTS.length,
      `icons ${JSON.stringify(landing.actions.map((slot) => slot.icon))}`,
    );
    check(
      "the reserved slot is dimmed, not just inert",
      landing.actions[0]?.opacity === 1 &&
        landing.actions[1]?.opacity === 1 &&
        (landing.actions[2]?.opacity ?? 1) < 1 &&
        landing.actions[3]?.opacity === 1,
      `opacities ${JSON.stringify(landing.actions.map((slot) => slot.opacity))}`,
    );
    check(
      "the action icons are all one size, and bigger",
      new Set(landing.actions.map((slot) => slot.iconSize)).size === 1 &&
        (landing.actions[0]?.iconSize ?? 0) >= 18,
      `sizes ${JSON.stringify(landing.actions.map((slot) => slot.iconSize))}`,
    );
    check(
      "the action icons are larger than the thread header's",
      (landing.actions[0]?.iconSize ?? 0) > (landing.headerIconSize ?? 99),
      `${landing.actions[0]?.iconSize}px in the bar vs ${landing.headerIconSize}px in the header`,
    );
    check(
      "the action bar is a different surface from the composer",
      channelDelta(landing.actionsBarBackground, landing.footerBackground) >= 8,
      `bar ${landing.actionsBarBackground} vs composer ${landing.footerBackground} (max channel gap ${channelDelta(landing.actionsBarBackground, landing.footerBackground)})`,
    );
    check(
      "history is not marked active on a thread",
      landing.actions[0]?.pressed === false,
      `pressed ${landing.actions[0]?.pressed}`,
    );
    screenshots.push(await shot("thread"));

    // 2 — the list is a page: it owns the panel's height and holds every chat.
    const opened = await clickAria("All chats");
    const list = await settle();
    check("clicked All chats", opened, "no back control in the thread header");
    check("the list view is up", list.list !== null, "no .chat-panel__list after All chats");
    check(
      "the list owns the panel height",
      (list.list?.box.height ?? 0) >= (list.panel?.height ?? 0) * 0.6,
      `list ${list.list?.box.height}px in a ${list.panel?.height}px panel`,
    );
    check(
      "the strip's 11rem cap is off in list view",
      list.listMaxHeight === "none",
      `max-height ${list.listMaxHeight}`,
    );
    check(
      "every chat row is inside the list box",
      (list.lastRow?.bottom ?? 0) <= (list.list?.box.bottom ?? 0) + 1,
      `last row ends at ${list.lastRow?.bottom}px, list box ends at ${list.list?.box.bottom}px`,
    );
    check(
      "all live chats are listed",
      list.rowCount === expected.rows,
      `${list.rowCount} rows vs ${expected.rows} live`,
    );
    check(
      "archived chats are not listed",
      !list.rows.some((row) => row.label === "Old scratch pad"),
      "the archived fixture chat is on screen",
    );
    check(
      "hidden chats are not listed",
      !list.rows.some((row) => row.label === "Debug: tool loop"),
      "the hidden fixture chat is on screen",
    );
    check(
      "nothing is pinned yet, so no group headers",
      list.groups.length === 0,
      `groups ${JSON.stringify(list.groups)}`,
    );
    check(
      "the transcript does not paint in list view",
      list.body?.display === "none" && (list.body?.box.height ?? 0) === 0,
      `body display ${list.body?.display}, box ${JSON.stringify(list.body?.box)}`,
    );
    check(
      "the composer does not paint in list view",
      (list.composer?.box.height ?? 0) === 0,
      `composer box ${JSON.stringify(list.composer?.box)}`,
    );
    check(
      "the panel keeps its column across the swap",
      list.panel?.width === landing.panel?.width &&
        list.panel?.left === landing.panel?.left,
      `list ${JSON.stringify(list.panel)} vs thread ${JSON.stringify(landing.panel)}`,
    );
    check(
      "nothing spills past the window",
      list.overflow.scrollWidth <= list.overflow.clientWidth,
      `scrollWidth ${list.overflow.scrollWidth}px vs window ${list.overflow.clientWidth}px`,
    );
    check(
      "the action bar survives the swap to the list",
      JSON.stringify(list.actions.map((slot) => slot.label)) === JSON.stringify(ACTION_SLOTS),
      `slots ${JSON.stringify(list.actions.map((slot) => slot.label))}`,
    );
    check(
      "history is marked active in the list",
      list.actions[0]?.pressed === true,
      `pressed ${list.actions[0]?.pressed}`,
    );
    check(
      "the active slot paints a tint, not a slab",
      alphaOf(list.actions[0]?.background) > 0.05 &&
        alphaOf(list.actions[0]?.background) <= 0.5,
      `active fill ${list.actions[0]?.background} (alpha ${alphaOf(list.actions[0]?.background)}; a --selected slab would be opaque)`,
    );
    check(
      "the idle slots paint no fill",
      alphaOf(list.actions[1]?.background) === 0,
      `idle fill ${list.actions[1]?.background}`,
    );
    check(
      "the list stops above the action bar",
      (list.list?.box.bottom ?? 0) <= (list.actionsBar?.top ?? 0) + 1,
      `list ends at ${list.list?.box.bottom}px, bar starts at ${list.actionsBar?.top}px`,
    );
    screenshots.push(await shot("list"));

    // 2b — the history slot is the same swap, reachable from the bottom of the bar.
    await clickAria("Chat history");
    const toggledBack = await settle();
    check(
      "the history slot returns to the thread",
      toggledBack.threadHeader !== null && toggledBack.list === null,
      `thread ${Boolean(toggledBack.threadHeader)}, list ${Boolean(toggledBack.list)}`,
    );
    await clickAria("Chat history");
    const toggledList = await settle();
    check(
      "the history slot reopens the list",
      toggledList.list !== null && toggledList.threadHeader === null,
      `list ${Boolean(toggledList.list)}, thread ${Boolean(toggledList.threadHeader)}`,
    );
    check(
      "the history round trip changed no chat state",
      toggledList.patchCalls.length === list.patchCalls.length &&
        toggledList.createCalls.length === list.createCalls.length,
      `patches ${toggledList.patchCalls.length}, creates ${toggledList.createCalls.length}`,
    );

    // 3 — opening a row swaps in that chat's thread (not the resumed one).
    const thirdLabel = list.rows[2].label;
    const thirdId = ids[labels.indexOf(thirdLabel)];
    const rowClicked = await clickRow(2);
    const thread = await settle();
    check("clicked a chat row", rowClicked, "no row at index 2");
    check("the row click opens a thread", thread.threadHeader !== null, "still on the list");
    check(
      "the thread names the clicked chat",
      thread.threadHeader?.label === thirdLabel,
      `header "${thread.threadHeader?.label}" vs row "${thirdLabel}"`,
    );
    check(
      "the row click loaded the clicked id",
      last(thread.messageCalls) === thirdId,
      `loaded ${last(thread.messageCalls)} for a row that is ${thirdId}`,
    );
    check("the list is gone while the thread is up", thread.list === null, "both surfaces painted");

    // 4 — pin: the write reaches the bridge, the section appears, the row moves.
    const pinClicked = await clickAria("Pin chat");
    const pinned = await settle();
    const pinCall = last(pinned.patchCalls);
    check("clicked Pin chat", pinClicked, "no Pin chat control");
    check(
      "pin wrote the flag to the bridge",
      pinCall?.id === thirdId && pinCall?.patch?.pinned === true,
      `bridge saw ${JSON.stringify(pinCall)} for ${thirdId}`,
    );
    check(
      "the control flips to Unpin",
      Boolean(pinned.threadHeader?.actions.includes("Unpin chat")),
      `actions ${JSON.stringify(pinned.threadHeader?.actions)}`,
    );
    check(
      "the pin does not touch the transcript",
      pinned.messages.length === thread.messages.length,
      `${pinned.messages.length} bubbles vs ${thread.messages.length}`,
    );

    await clickAria("All chats");
    const pinnedList = await settle();
    check(
      "a Pinned section appeared above Recent",
      JSON.stringify(pinnedList.groups) === JSON.stringify(["Pinned", "Recent"]),
      `groups ${JSON.stringify(pinnedList.groups)}`,
    );
    check(
      "the pinned chat leads the list",
      pinnedList.rows[0]?.label === thirdLabel,
      `first row "${pinnedList.rows[0]?.label}" vs pinned "${thirdLabel}"`,
    );
    check(
      "the pinned row is marked",
      pinnedList.rows[0]?.pinned === true,
      `row ${JSON.stringify(pinnedList.rows[0])}`,
    );
    check(
      "pinning loses no chats",
      pinnedList.rowCount === expected.rows,
      `${pinnedList.rowCount} rows vs ${expected.rows}`,
    );
    screenshots.push(await shot("pinned"));

    // 5 — unpin puts it back in Recent and takes the section with it.
    await clickRow(0);
    await settle();
    const unpinClicked = await clickAria("Unpin chat");
    const unpinned = await settle();
    check("clicked Unpin chat", unpinClicked, "no Unpin chat control");
    check(
      "unpin wrote the flag to the bridge",
      last(unpinned.patchCalls)?.patch?.pinned === false,
      `bridge saw ${JSON.stringify(last(unpinned.patchCalls))}`,
    );
    await clickAria("All chats");
    const unpinnedList = await settle();
    check(
      "the Pinned section is gone",
      unpinnedList.groups.length === 0,
      `groups ${JSON.stringify(unpinnedList.groups)}`,
    );
    check(
      "the chat is back in the flat list",
      unpinnedList.rows.some((row) => row.label === thirdLabel && !row.pinned),
      "the unpinned chat is missing from Recent",
    );

    // 6 — rename: inline field, write to the bridge, new name in both surfaces.
    await clickRow(2);
    await settle();
    const renameClicked = await clickAria("Rename chat");
    const renaming = await settle();
    check("clicked Rename chat", renameClicked, "no Rename chat control");
    check(
      "the rename field starts from the visible name",
      renaming.renaming && renaming.renameValue === thirdLabel,
      `field ${JSON.stringify(renaming.renameValue)} vs "${thirdLabel}"`,
    );
    const typed = await typeRename("Lisbon trip planning");
    const renamed = await settle();
    check("typed a new name and submitted", typed, "no rename field to fill");
    check(
      "rename wrote the title to the bridge",
      last(renamed.patchCalls)?.patch?.title === "Lisbon trip planning",
      `bridge saw ${JSON.stringify(last(renamed.patchCalls))}`,
    );
    check(
      "the thread wears the new name",
      renamed.threadHeader?.label === "Lisbon trip planning",
      `header "${renamed.threadHeader?.label}"`,
    );
    check(
      "the rename field closed",
      renamed.renaming === false,
      "the field is still up after saving",
    );
    await clickAria("All chats");
    const renamedList = await settle();
    check(
      "the list wears the new name",
      renamedList.rows.some((row) => row.label === "Lisbon trip planning"),
      `rows ${JSON.stringify(renamedList.rows.map((row) => row.label))}`,
    );
    check(
      "the old name is gone",
      !renamedList.rows.some((row) => row.label === thirdLabel),
      "both names are listed",
    );
    screenshots.push(await shot("renamed"));

    // 7 — archive: the write reaches the bridge and the chat leaves the list.
    await clickRow(2);
    await settle();
    const archiveClicked = await clickAria("Archive chat");
    const archived = await settle();
    check("clicked Archive chat", archiveClicked, "no Archive chat control");
    check(
      "archive wrote the flag to the bridge",
      last(archived.patchCalls)?.patch?.archived === true &&
        last(archived.patchCalls)?.id === thirdId,
      `bridge saw ${JSON.stringify(last(archived.patchCalls))} for ${thirdId}`,
    );
    check(
      "archiving leaves the list up",
      archived.list !== null && archived.threadHeader === null,
      `list ${Boolean(archived.list)}, thread ${Boolean(archived.threadHeader)}`,
    );
    check(
      "the archived chat is gone from the list",
      archived.rowCount === expected.rows - 1 &&
        !archived.rows.some((row) => row.label === "Lisbon trip planning"),
      `${archived.rowCount} rows, names ${JSON.stringify(archived.rows.map((row) => row.label))}`,
    );
    screenshots.push(await shot("archived"));

    // 8 — the reserved slot holds its place and does nothing; the new-chat slot
    // creates one chat through the bridge and opens its (empty) thread. The
    // chain slot is live now and swaps the panel, so it is not clicked here —
    // `chat-chain.electron.mjs` owns that.
    const beforeReserved = archived.patchCalls.length + archived.createCalls.length;
    await run(
      `(document.querySelector('[aria-label="Search chats (coming soon)"]').click(), true)`,
    );
    const reserved = await settle();
    check(
      "the reserved slot does nothing",
      reserved.patchCalls.length + reserved.createCalls.length === beforeReserved &&
        reserved.list !== null,
      `calls ${reserved.patchCalls.length + reserved.createCalls.length} vs ${beforeReserved}, view ${reserved.list ? "list" : "thread"}`,
    );

    const newClicked = await pressAria("New chat");
    const created = await settle();
    check("clicked New chat", newClicked, "no New chat slot in the action bar");
    check(
      "the New chat slot created a session through the bridge",
      created.createCalls.length === 1,
      `bridge saw ${JSON.stringify(created.createCalls)}`,
    );
    check(
      "the New chat slot opened its empty thread",
      created.threadHeader !== null && created.messages.length === 0,
      `thread ${Boolean(created.threadHeader)}, ${created.messages.length} bubbles`,
    );
    check(
      "creating a chat touched no session flags",
      created.patchCalls.length === archived.patchCalls.length,
      `patches ${created.patchCalls.length} vs ${archived.patchCalls.length}`,
    );
    check(
      "the new chat is the open one",
      created.threadHeader?.label === "New chat",
      `header "${created.threadHeader?.label}"`,
    );
    check(
      "the New chat slot leaves the caret in the composer",
      created.composer?.focused === true,
      `caret on ${JSON.stringify(created.active)}`,
    );

    // 9 — an empty chat is the New chat slot's destination, not its raw
    // material: leaving it for another chat and clicking the slot again returns
    // to that blank chat rather than stacking a second one.
    const blankId = last(created.messageCalls);
    await clickAria("All chats");
    await settle();
    const rowMoved = await clickRow(2);
    await settle();
    check("moved off the empty chat", rowMoved, "no chat row at index 2");
    const reusedClicked = await pressAria("New chat");
    const reused = await settle();
    check("clicked New chat again", reusedClicked, "no New chat slot in the action bar");
    check(
      "the New chat slot reused the empty chat instead of minting another",
      reused.createCalls.length === created.createCalls.length,
      `bridge saw ${JSON.stringify(reused.createCalls)}`,
    );
    check(
      "the reused chat is the blank one that was open",
      blankId !== null && last(reused.messageCalls) === blankId,
      `loaded ${last(reused.messageCalls)} for the blank chat ${blankId}`,
    );
    check(
      "the reused chat is still named New chat and still empty",
      reused.threadHeader?.label === "New chat" && reused.messages.length === 0,
      `header "${reused.threadHeader?.label}", ${reused.messages.length} bubbles`,
    );
    check(
      "reusing a chat leaves the caret in the composer",
      reused.composer?.focused === true,
      `caret on ${JSON.stringify(reused.active)}`,
    );

    // 9b — the same slot, pressed while its blank chat is already the open one,
    // changes no state at all: no create, no load, not even a view swap. The
    // caret still has to land in the field, so this is the case that a
    // focus rule hung only on state changes would miss.
    const againClicked = await pressAria("New chat");
    const again = await settle();
    check(
      "clicked New chat while its own chat was already open",
      againClicked,
      "no New chat slot in the action bar",
    );
    check(
      "pressing New chat on the chat it already opened still leaves the caret in the composer",
      again.composer?.focused === true,
      `caret on ${JSON.stringify(again.active)}`,
    );
    await clickAria("All chats");
    const reusedList = await settle();
    check(
      "reusing a chat added no row to the list",
      reusedList.rowCount === expected.rows,
      `${reusedList.rowCount} rows vs ${expected.rows} (one archived, one created blank)`,
    );

    // 10 — the row's own 3-dot menu: every listed chat is manageable in place,
    // and the control that opened a menu closes it again.
    const menuBase = reusedList;
    const menuRowLabel = menuBase.rows[1]?.label ?? "";
    const menuRowId = ids[labels.indexOf(menuRowLabel)];
    check(
      "every listed chat carries its own 3-dot control",
      menuBase.rowMenuBtnCount === menuBase.rowCount && menuBase.rowMenuBtnCount > 0,
      `${menuBase.rowMenuBtnCount} controls for ${menuBase.rowCount} rows`,
    );
    check(
      "no menu is open before it is asked for",
      menuBase.rowMenu === null,
      `menu ${JSON.stringify(menuBase.rowMenu)}`,
    );
    const menuOpened = await openRowMenu(1);
    const menuState = await settle();
    check("clicked a row's 3-dot control", menuOpened, "no 3-dot control at index 1");
    check(
      "the row menu offers Edit, Archive and Delete",
      JSON.stringify(menuState.rowMenu) ===
        JSON.stringify(["Edit chat", "Archive chat", "Delete chat"]),
      `items ${JSON.stringify(menuState.rowMenu)}`,
    );
    check(
      "the menu opens on the row whose control was clicked",
      menuState.rowMenuRowIndex === 1,
      `menu on row ${menuState.rowMenuRowIndex}, control on row 1 ("${menuRowLabel}")`,
    );
    check(
      "the menu paints an opaque surface inside the list",
      (menuState.rowMenuBox?.height ?? 0) > 0 &&
        alphaOf(menuState.rowMenuBackground) > 0.9 &&
        (menuState.rowMenuBox?.right ?? 0) <= (menuState.list?.box.right ?? -1) + 1,
      `box ${JSON.stringify(menuState.rowMenuBox)}, background ${menuState.rowMenuBackground}`,
    );
    check(
      "only Delete wears the destructive colour",
      menuState.rowMenuItems.length === 3 &&
        channelDelta(menuState.rowMenuItems[1]?.color, menuState.rowMenuItems[0]?.color) <= 2 &&
        channelDelta(menuState.rowMenuItems[2]?.color, menuState.rowMenuItems[0]?.color) >= 8,
      `item colours ${JSON.stringify(menuState.rowMenuItems.map((item) => item.color))}`,
    );
    check(
      "opening the menu wrote nothing",
      menuState.patchCalls.length === menuBase.patchCalls.length &&
        menuState.deleteCalls.length === menuBase.deleteCalls.length,
      `patches ${menuState.patchCalls.length}, deletes ${menuState.deleteCalls.length}`,
    );
    screenshots.push(await shot("row-menu"));
    await openRowMenu(1);
    const menuShut = await settle();
    check(
      "the control closes its own menu",
      menuShut.rowMenu === null && menuShut.rowMenuBtnCount === menuShut.rowCount,
      `menu ${JSON.stringify(menuShut.rowMenu)}`,
    );
    screenshots.push(await shot("row-menu-closed"));

    // 11 — Edit renames the row in place: the list manages a chat without
    // opening it, and the write reaches the bridge.
    await openRowMenu(1);
    const editClicked = await clickMenuItem("Edit chat");
    const rowRenameStarted = await settle();
    check("clicked Edit chat", editClicked, "no Edit chat item in the row menu");
    check(
      "the row becomes the field, starting from its own name",
      rowRenameStarted.rowRename && rowRenameStarted.rowRenameValue === menuRowLabel,
      `field ${JSON.stringify(rowRenameStarted.rowRenameValue)} vs "${menuRowLabel}"`,
    );
    check(
      "the field takes the row's 3-dot control with it",
      rowRenameStarted.rowMenuBtnCount === rowRenameStarted.rowCount - 1,
      `${rowRenameStarted.rowMenuBtnCount} controls for ${rowRenameStarted.rowCount} rows`,
    );
    check(
      "the edit did not open the chat it renamed",
      rowRenameStarted.threadHeader === null &&
        last(rowRenameStarted.messageCalls) === last(menuBase.messageCalls),
      `thread ${Boolean(rowRenameStarted.threadHeader)}, loaded ${last(rowRenameStarted.messageCalls)}`,
    );
    const rowTyped = await typeRowRename("Kitchen reno quotes");
    const rowRenamed = await settle();
    check("typed a new row name and submitted", rowTyped, "no row rename field to fill");
    check(
      "the row's rename wrote the title to the bridge",
      last(rowRenamed.patchCalls)?.patch?.title === "Kitchen reno quotes" &&
        last(rowRenamed.patchCalls)?.id === menuRowId,
      `bridge saw ${JSON.stringify(last(rowRenamed.patchCalls))} for ${menuRowId}`,
    );
    check(
      "the renamed row wears the new name, in the list, with no thread opened",
      rowRenamed.rows[1]?.label === "Kitchen reno quotes" &&
        rowRenamed.threadHeader === null &&
        rowRenamed.list !== null,
      `row 1 "${rowRenamed.rows[1]?.label}", thread ${Boolean(rowRenamed.threadHeader)}`,
    );
    check(
      "the field closed and the control came back",
      rowRenamed.rowRename === false && rowRenamed.rowMenuBtnCount === rowRenamed.rowCount,
      `rename ${rowRenamed.rowRename}, controls ${rowRenamed.rowMenuBtnCount}/${rowRenamed.rowCount}`,
    );
    screenshots.push(await shot("row-renamed"));

    // 12 — Archive from the row: the same write the thread header's control
    // makes, and the chat leaves the list without opening its thread.
    await openRowMenu(1);
    const archiveRowClicked = await clickMenuItem("Archive chat");
    const rowArchived = await settle();
    check("clicked Archive chat", archiveRowClicked, "no Archive chat item in the row menu");
    check(
      "the row's archive wrote the flag to the bridge",
      last(rowArchived.patchCalls)?.patch?.archived === true &&
        last(rowArchived.patchCalls)?.id === menuRowId,
      `bridge saw ${JSON.stringify(last(rowArchived.patchCalls))} for ${menuRowId}`,
    );
    check(
      "the archived row left the list and the list stayed up",
      rowArchived.rowCount === rowRenamed.rowCount - 1 &&
        !rowArchived.rows.some((row) => row.label === "Kitchen reno quotes") &&
        rowArchived.list !== null &&
        rowArchived.threadHeader === null,
      `${rowArchived.rowCount} rows vs ${rowRenamed.rowCount}, thread ${Boolean(rowArchived.threadHeader)}`,
    );

    // 13 — Delete asks first, in the dock's own dialog: centred in the window the
    // application is running in (a platform dialog centres on the display),
    // naming the chat it will take. Cancelling writes nothing; answering removes
    // the chat.
    const deleteRowLabel = rowArchived.rows[1]?.label ?? "";
    const deleteRowId = ids[labels.indexOf(deleteRowLabel)];
    await openRowMenu(1);
    const deleteClicked = await clickMenuItem("Delete chat");
    const deleteAsked = await settle();
    check("clicked Delete chat", deleteClicked, "no Delete chat item in the row menu");
    check(
      "the delete asked before it wrote",
      deleteAsked.confirmDialog !== null && deleteAsked.deleteCalls.length === 0,
      `dialog ${JSON.stringify(deleteAsked.confirmDialog)}, deletes ${JSON.stringify(deleteAsked.deleteCalls)}`,
    );
    check(
      "the question names the chat it will take",
      deleteAsked.confirmDialog?.title === "Delete chat" &&
        (deleteAsked.confirmDialog?.message ?? "").includes(deleteRowLabel),
      `title "${deleteAsked.confirmDialog?.title}", message "${deleteAsked.confirmDialog?.message}"`,
    );
    check(
      "the dialog is centred in the application window",
      Math.abs(deleteAsked.confirmDialog?.offsetFromWindowX ?? 999) <= 2 &&
        Math.abs(deleteAsked.confirmDialog?.offsetFromWindowY ?? 999) <= 2,
      `card centre is ${deleteAsked.confirmDialog?.offsetFromWindowX}px across and ${deleteAsked.confirmDialog?.offsetFromWindowY}px down from the window's centre`,
    );
    check(
      "and it is not centred on the dock it was asked from",
      Math.abs(deleteAsked.confirmDialog?.offsetFromPanelX ?? 0) > 40,
      `card centre is ${deleteAsked.confirmDialog?.offsetFromPanelX}px from the dock's centre (a native dialog put it on the display's)`,
    );
    check(
      "the scrim covers the window",
      (deleteAsked.confirmDialog?.backdrop?.width ?? 0) >= deleteAsked.viewport.width - 1 &&
        (deleteAsked.confirmDialog?.backdrop?.height ?? 0) >= deleteAsked.viewport.height - 1,
      `backdrop ${JSON.stringify(deleteAsked.confirmDialog?.backdrop)} in a ${deleteAsked.viewport.width}x${deleteAsked.viewport.height} window`,
    );
    check(
      "the scrim actually paints",
      alphaOf(deleteAsked.confirmDialog?.backdropBackground) > 0.1,
      `scrim fill ${deleteAsked.confirmDialog?.backdropBackground}`,
    );
    check(
      "the dialog closes the row menu it was asked from",
      deleteAsked.rowMenu === null,
      `menu ${JSON.stringify(deleteAsked.rowMenu)}`,
    );
    screenshots.push(await shot("delete-confirm"));

    const cancelled = await clickDialog("cancel");
    const deleteDeclined = await settle();
    check("clicked Cancel in the confirm dialog", cancelled, "no Cancel control in the dialog");
    check(
      "a cancelled delete wrote nothing and kept the row",
      deleteDeclined.confirmDialog === null &&
        deleteDeclined.deleteCalls.length === 0 &&
        deleteDeclined.rowCount === rowArchived.rowCount,
      `dialog ${JSON.stringify(deleteDeclined.confirmDialog)}, deletes ${JSON.stringify(deleteDeclined.deleteCalls)}, rows ${deleteDeclined.rowCount}`,
    );

    // Retrying is the row's menu again, then the other answer.
    await openRowMenu(1);
    await clickMenuItem("Delete chat");
    const askedAgain = await settle();
    check(
      "the row asks again after a cancelled delete",
      askedAgain.confirmDialog !== null,
      `dialog ${JSON.stringify(askedAgain.confirmDialog)}`,
    );
    const deleteAgain = await clickDialog("confirm");
    const deleted = await settle();
    check("clicked Delete chat in the confirm dialog", deleteAgain, "no Delete control in the dialog");
    check(
      "an accepted delete reached the bridge",
      last(deleted.deleteCalls) === deleteRowId,
      `bridge saw ${JSON.stringify(deleted.deleteCalls)} for ${deleteRowId}`,
    );
    check(
      "the deleted row is gone from the list",
      deleted.rowCount === deleteDeclined.rowCount - 1 &&
        !deleted.rows.some((row) => row.label === deleteRowLabel),
      `${deleted.rowCount} rows vs ${deleteDeclined.rowCount}, ${JSON.stringify(deleted.rows.map((row) => row.label))}`,
    );
    check(
      "answering closed the dialog and wrote no session flags",
      deleted.confirmDialog === null && deleted.patchCalls.length === deleteDeclined.patchCalls.length,
      `dialog ${JSON.stringify(deleted.confirmDialog)}, patches ${deleted.patchCalls.length}`,
    );
    screenshots.push(await shot("row-deleted"));

    // 14 — deleting the chat that is open leaves no active row and clears the
    // stored last-chat pointer, so the next launch does not resume a chat that
    // no longer exists.
    await clickRow(0);
    const reopened = await settle();
    const openChatId = last(reopened.messageCalls);
    await clickAria("All chats");
    const activeList = await settle();
    const activeIndex = activeList.rows.findIndex((row) => row.active);
    check(
      "the chat that was opened is the active row in the list",
      activeIndex >= 0 && last(activeList.messageCalls) === openChatId,
      `active index ${activeIndex} of ${activeList.rowCount}, loaded ${last(activeList.messageCalls)}`,
    );
    const openChatLabel = activeList.rows[activeIndex]?.label ?? "";
    await openRowMenu(activeIndex);
    const openDeleteClicked = await clickMenuItem("Delete chat");
    const openAsked = await settle();
    const openDeleteConfirmed = await clickDialog("confirm");
    const openDeleted = await settle();
    check(
      "deleted the open chat",
      openDeleteClicked && openDeleteConfirmed && openAsked.confirmDialog !== null,
      "no menu on the active row, or no dialog to answer",
    );
    check(
      "the open chat's delete reached the bridge",
      last(openDeleted.deleteCalls) === openChatId,
      `bridge saw ${JSON.stringify(openDeleted.deleteCalls)} for ${openChatId}`,
    );
    check(
      "the deleted chat left the list and no row is active",
      !openDeleted.rows.some((row) => row.label === openChatLabel) &&
        openDeleted.rows.every((row) => !row.active),
      `active rows ${JSON.stringify(openDeleted.rows.filter((row) => row.active).map((row) => row.label))}`,
    );
    check(
      "the stored last-chat pointer is cleared",
      openDeleted.lastChatStored === null,
      `localStorage holds ${JSON.stringify(openDeleted.lastChatStored)}`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      fixture: expected,
      states: {
        landing,
        list,
        toggledBack,
        toggledList,
        thread,
        pinned,
        pinnedList,
        unpinnedList,
        renamed,
        renamedList,
        archived,
        reserved,
        created,
        reused,
        again,
        reusedList,
        menuState,
        menuShut,
        rowRenameStarted,
        rowRenamed,
        rowArchived,
        deleteAsked,
        deleteDeclined,
        deleted,
        activeList,
        openDeleted,
      },
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
        `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "chat-sessions.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const states = report.states;
  if (states) {
    const table = [["state", "view", "rows", "groups", "list h", "last row", "patches", "label"]];
    const rows = [
      ["landing", states.landing],
      ["list", states.list],
      ["history toggle", states.toggledList],
      ["row→thread", states.thread],
      ["pinned", states.pinnedList],
      ["unpinned", states.unpinnedList],
      ["renamed", states.renamed],
      ["renamed list", states.renamedList],
      ["archived", states.archived],
      ["new chat", states.created],
      ["new chat reuse", states.reused],
      ["new chat again", states.again],
      ["reuse list", states.reusedList],
      ["row menu", states.menuState],
      ["row edit", states.rowRenameStarted],
      ["row renamed", states.rowRenamed],
      ["row archived", states.rowArchived],
      ["delete asked", states.deleteAsked],
      ["delete cancelled", states.deleteDeclined],
      ["row deleted", states.deleted],
      ["open chat deleted", states.openDeleted],
    ];
    for (const [name, state] of rows) {
      table.push([
        name,
        state.threadHeader ? "thread" : state.list ? "list" : "—",
        String(state.rowCount),
        state.groups.join("+") || "—",
        state.list ? `${state.list.box.height}` : "—",
        state.lastRow ? `${state.lastRow.bottom}` : "—",
        String(state.patchCalls.length),
        state.threadHeader?.label ?? "—",
      ]);
    }
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
    for (const row of table) console.log(format(row));
    console.log("");
  }
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat sessions: PASS" : "chat sessions: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-sessions: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
