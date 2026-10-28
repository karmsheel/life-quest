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
import { app, BrowserWindow, nativeTheme } from "electron";

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
  const rail = document.querySelector(".chats-rail");
  const panel = document.querySelector(".chat-panel");
  const composer = document.querySelector(".chat-panel__composer-input");
  const threadHeader = document.querySelector(".chat-panel__header--thread");
  const chatsHeader = document.querySelector(".chats-rail__header");
  const chatsTitle = chatsHeader?.querySelector(".chats-rail__title");
  const chatsControls = chatsHeader
    ? Array.from(chatsHeader.querySelectorAll(".chats-rail__actions button"))
    : [];
  const searchInput = document.querySelector(".chats-rail__search-input");
  const viewMenu = document.querySelector(".chats-rail__view-menu");

  // The sidebar's rows in paint order, with the group each one sits under. The
  // group label is a sibling row of its own, so the walk keeps the last one seen.
  let group = "";
  const rows = [];
  for (const li of Array.from(document.querySelectorAll(".chats-rail__rows > li"))) {
    if (li.classList.contains("chats-rail__group")) {
      group = text(li);
      continue;
    }
    // The "nothing matched" line is a row of the list, not a chat.
    if (li.classList.contains("chats-rail__empty")) continue;
    rows.push({
      group,
      label: text(li.querySelector(".chats-rail__label")),
      when: text(li.querySelector(".chats-rail__when")),
      active: li.hasAttribute("data-active"),
      archived: li.hasAttribute("data-archived"),
      archivedTag: text(li.querySelector(".chats-rail__archived-tag")),
      disabled: Boolean(li.querySelector(".chats-rail__row-main")?.disabled),
      live: li.hasAttribute("data-live"),
      approval: li.hasAttribute("data-approval"),
      menuOpen: Boolean(li.querySelector(".chats-rail__menu"))
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
          groups: Array.from(document.querySelectorAll(".chats-rail__group")).map(text),
          empty: text(rail.querySelector(".chats-rail__empty")),
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
      const el = Array.from(document.querySelectorAll(".chats-rail__actions button")).find(
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

  /** Clear the search field with its own control. */
  const clearSearch = () =>
    run(`(async () => {
      const el = document.querySelector(".chats-rail__search-clear");
      if (!el) return false;
      el.click();
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
    win.showInactive();

    // 1 — the sidebar lists every live chat, pinned first, and the dock lands on
    // a thread with one tab (so the strip is not noise).
    const landing = await settle(300);
    check("the left sidebar lists the chats", landing.rowCount === 5, `${landing.rowCount} rows`);
    check(
      "pinned chats sit in their own group, first",
      landing.rows[0]?.group === "Pinned" && landing.rows[0]?.label === "Pinned note",
      JSON.stringify(landing.rows.map((r) => [r.group, r.label])),
    );
    check(
      "the recent chats follow under a Recent heading",
      landing.rail?.groups.join("/") === "Pinned/Recent" &&
        landing.rows.filter((r) => r.group === "Recent").length === 4,
      JSON.stringify(landing.rail?.groups),
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

    // 10 — the sidebar's own management: pin reaches the bridge and moves the row.
    check("opened Bravo's menu", await openSidebarMenu("Bravo budget"), "no menu control");
    check("clicked Pin", await clickSidebarMenuItem("Pin chat"), "no Pin item");
    const pinned = await settle();
    check(
      "Pin reached the bridge for Bravo",
      pinned.patchCalls.at(-1)?.id === "chat-bravo" &&
        pinned.patchCalls.at(-1)?.patch.pinned === true,
      JSON.stringify(pinned.patchCalls.at(-1)),
    );
    check(
      "the pinned chat moved under the Pinned heading",
      pinned.rows[0]?.group === "Pinned" && pinned.rows[0]?.label === "Bravo budget",
      JSON.stringify(pinned.rows.map((row) => [row.group, row.label])),
    );

    // 11 — archive removes the row and the tab it had.
    check("opened Alpha's menu", await openSidebarMenu("Alpha planning"), "no menu control");
    check("clicked Archive", await clickSidebarMenuItem("Archive chat"), "no Archive item");
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
      "the search icon opens a full search box",
      searchOpen.rail?.search?.focused === true &&
        searchOpen.rail.search.value === "" &&
        searchOpen.rail.search.placeholder === "Search chats",
      JSON.stringify(searchOpen.rail?.search),
    );
    check(
      "the search box takes the list's own column",
      Boolean(searchOpen.rail?.search && searchOpen.rail.header) &&
        searchOpen.rail.search.panelBox.width >=
          searchOpen.rail.header.box.width - 6,
      `search ${JSON.stringify(searchOpen.rail?.search?.panelBox)} vs header ${JSON.stringify(searchOpen.rail?.header?.box)}`,
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
    check("cleared the search", await clearSearch(), "no clear control");
    const cleared = await settle();
    check(
      "clearing the search restores the rows",
      cleared.rowCount === 3 && cleared.rail?.search?.value === "",
      JSON.stringify({ rows: cleared.rowCount, search: cleared.rail?.search }),
    );
    check("closed the search box", await clickRailControl("Search chats"), "no search control");
    const searchClosed = await settle();
    check(
      "the search icon closes the box",
      searchClosed.rail?.search === null,
      JSON.stringify(searchClosed.rail?.search),
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
    check("cleared the archived search", await clearSearch(), "no clear control");
    check("closed the archived search", await clickRailControl("Search chats"), "no search control");
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
      "the restored chat left the Archived group",
      unarchived.rows.find((row) => row.label === "Echo archived")?.archived === false &&
        unarchived.rows.find((row) => row.label === "Echo archived")?.group === "Recent" &&
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
        pinned,
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
        cleared,
        searchClosed,
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
      ["opened", state.opened.rowCount, state.opened.tabCount, "", state.opened.heading, "", ""],
      ["middle", state.middleOpened.rowCount, state.middleOpened.tabCount, "", state.middleOpened.heading, "", ""],
      ["menu", state.menuOpened.rowCount, state.menuOpened.tabCount, "", state.menuOpened.heading, "", ""],
      ["alpha live", state.alphaLive.rowCount, state.alphaLive.tabCount, "alpha", state.alphaLive.heading, state.alphaLive.calls.length, ""],
      ["both live", state.bothLive.rowCount, state.bothLive.tabCount, "alpha + bravo", state.bothLive.heading, state.bothLive.calls.length, ""],
      ["finished", state.finished.rowCount, state.finished.tabCount, "", state.finished.heading, "", ""],
      ["split", state.split.rowCount, state.split.tabCount, "alpha", state.split.heading, "", ""],
      ["pinned", state.pinned.rowCount, state.pinned.tabCount, "", state.pinned.heading, "", state.pinned.patchCalls.length],
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
