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

  // The sidebar's rows in paint order, with the group each one sits under. The
  // group label is a sibling row of its own, so the walk keeps the last one seen.
  let group = "";
  const rows = [];
  for (const li of Array.from(document.querySelectorAll(".chats-rail__rows > li"))) {
    if (li.classList.contains("chats-rail__group")) {
      group = text(li);
      continue;
    }
    rows.push({
      group,
      label: text(li.querySelector(".chats-rail__label")),
      when: text(li.querySelector(".chats-rail__when")),
      active: li.hasAttribute("data-active"),
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
          groups: Array.from(document.querySelectorAll(".chats-rail__group")).map(text)
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
    check(
      "one open chat draws no tab strip",
      landing.tabCount === 0,
      `${landing.tabCount} tabs`,
    );
    check(
      "the composer is ready on landing",
      landing.composer !== null && !landing.composer.disabled,
      JSON.stringify(landing.composer),
    );
    screenshots.push(await shot("landing"));

    // 2 — a row click loads that chat into the dock, and a second open chat
    // gives the strip its first pair of tabs.
    check("clicking a sidebar row opened it", await clickSidebarRow("Bravo budget"), "no row button");
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
      "two open chats now show two tabs",
      opened.tabCount === 2 &&
        opened.tabs.map((tab) => tab.label).join("/") === "Alpha planning/Bravo budget",
      JSON.stringify(opened.tabs),
    );
    check(
      "the clicked chat is the active tab and the active row",
      opened.tabs.find((tab) => tab.label === "Bravo budget")?.active === true &&
        opened.rows.find((row) => row.label === "Bravo budget")?.active === true,
      JSON.stringify({ tabs: opened.tabs, rows: opened.rows }),
    );

    // 3 — send in Bravo, then switch to Alpha and send there while Bravo is
    // still in the air. The two turns must not serialise.
    check("sent in Bravo", (await typeAndSend("Plan the bravo budget")) === "sent", "composer refused");
    const bravoLive = await settle();
    check(
      "Bravo's turn reached the bridge as Bravo",
      bravoLive.calls.at(-1)?.sessionId === "chat-bravo",
      JSON.stringify(bravoLive.calls),
    );
    check(
      "Bravo's tab and row both show the live turn",
      bravoLive.tabs.find((tab) => tab.label === "Bravo budget")?.live === true &&
        bravoLive.rows.find((row) => row.label === "Bravo budget")?.live === true,
      JSON.stringify({ tabs: bravoLive.tabs, rows: bravoLive.rows }),
    );
    check(
      "the sidebar counts the running chat",
      bravoLive.rail?.liveCount === "1 running",
      JSON.stringify(bravoLive.rail?.liveCount),
    );

    check("switched back to Alpha", await clickTab("Alpha planning"), "no Alpha tab");
    const alphaReady = await settle();
    check(
      "Alpha's composer is usable while Bravo runs",
      alphaReady.composer !== null && !alphaReady.composer.disabled,
      JSON.stringify(alphaReady.composer),
    );
    check(
      "switching did not drop Bravo's live tab",
      alphaReady.tabs.find((tab) => tab.label === "Bravo budget")?.live === true,
      JSON.stringify(alphaReady.tabs),
    );

    check("sent in Alpha", (await typeAndSend("Plan the alpha launch")) === "sent", "composer refused");
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

    // 4 — frames land in the chat that owns them, even when it is not on screen.
    await emit("chat-bravo", { type: "run.started", runId: "run-bravo" });
    await emit("chat-bravo", { type: "assistant.delta", text: "BRAVO-ONLY-1 " });
    await emit("chat-alpha", { type: "assistant.delta", text: "ALPHA-ONLY-1 " });
    await emit("chat-bravo", { type: "assistant.delta", text: "BRAVO-ONLY-2 " });
    await emit("chat-alpha", { type: "assistant.delta", text: "ALPHA-ONLY-2" });
    const interleaved = await settle();
    const alphaText = interleaved.messages.map((m) => m.content).join(" | ");
    check(
      "Alpha's thread holds only Alpha's deltas",
      alphaText.includes("ALPHA-ONLY-1") &&
        alphaText.includes("ALPHA-ONLY-2") &&
        !alphaText.includes("BRAVO-ONLY"),
      alphaText,
    );

    check("switched to Bravo", await clickTab("Bravo budget"), "no Bravo tab");
    const bravoThread = await settle();
    const bravoText = bravoThread.messages.map((m) => m.content).join(" | ");
    check(
      "Bravo's thread holds only Bravo's deltas",
      bravoText.includes("BRAVO-ONLY-1") &&
        bravoText.includes("BRAVO-ONLY-2") &&
        !bravoText.includes("ALPHA-ONLY"),
      bravoText,
    );
    check(
      "the user's own turn is still in Bravo's transcript",
      bravoText.includes("Plan the bravo budget"),
      bravoText,
    );

    // 5 — the turns settle, and the live marks go with them.
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

    // 6 — closing a tab leaves the chat in the sidebar, and lands on a neighbour.
    check("closed Alpha's tab", await closeTab("Alpha planning"), "no close control");
    const closed = await settle();
    check(
      "closing a tab hands over to its neighbour",
      // One open chat draws no strip, so the hand-over is read off the thread
      // and the sidebar's active row rather than off a tab that is now alone.
      closed.tabCount === 0 &&
        closed.heading === "Bravo budget" &&
        closed.rows.find((row) => row.active)?.label === "Bravo budget",
      JSON.stringify({ tabs: closed.tabs, heading: closed.heading, rows: closed.rows }),
    );
    check(
      "the closed chat is still in the sidebar",
      closed.rows.some((row) => row.label === "Alpha planning"),
      JSON.stringify(closed.rows.map((row) => row.label)),
    );

    // 7 — the sidebar's own management: pin reaches the bridge and moves the row.
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

    // 8 — archive removes the row, keeps the open thread where it is.
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
      !archived.rows.some((row) => row.label === "Alpha planning") &&
        archived.rowCount === 4,
      JSON.stringify(archived.rows.map((row) => row.label)),
    );
    check(
      "archiving a closed chat did not move the open thread",
      archived.heading === "Bravo budget" && archived.tabCount === 0,
      JSON.stringify({ heading: archived.heading, tabs: archived.tabs }),
    );

    // 9 — delete asks through the app's own dialog, and only then writes.
    check("opened Bravo's menu again", await openSidebarMenu("Bravo budget"), "no menu control");
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

    check("opened Bravo's menu once more", await openSidebarMenu("Bravo budget"), "no menu control");
    check("clicked Delete again", await clickSidebarMenuItem("Delete chat"), "no Delete item");
    check("confirmed the delete", await clickDialog("confirm"), "no confirm control");
    const deleted = await settle();
    check(
      "the delete reached the bridge for Bravo",
      deleted.deleteCalls.at(-1) === "chat-bravo",
      JSON.stringify(deleted.deleteCalls),
    );
    check(
      "the deleted chat left the sidebar",
      !deleted.rows.some((row) => row.label === "Bravo budget") && deleted.rowCount === 3,
      JSON.stringify(deleted.rows.map((row) => row.label)),
    );
    check(
      "deleting the open chat closes its tab and shows the list",
      deleted.tabCount === 0 && deleted.list && deleted.heading === "Chats",
      JSON.stringify({ tabs: deleted.tabs, list: deleted.list, heading: deleted.heading }),
    );

    // 10 — a run for a chat nobody opened appears as a tab without stealing the
    // screen. This is the scheduled-automation case.
    check("opened Charlie", await clickSidebarRow("Charlie retro"), "no Charlie row");
    const charlie = await settle();
    check(
      "Charlie is the open chat",
      charlie.heading === "Charlie retro" &&
        charlie.tabCount === 0 &&
        charlie.rows.find((row) => row.active)?.label === "Charlie retro",
      JSON.stringify({ tabs: charlie.tabs, rows: charlie.rows }),
    );
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
      background.heading === "Charlie retro" &&
        background.tabs.find((tab) => tab.label === "Charlie retro")?.active === true,
      JSON.stringify({ heading: background.heading, tabs: background.tabs }),
    );
    check(
      "the background chat's sidebar row shows it running",
      background.rows.find((row) => row.label === "Delta automation")?.live === true,
      JSON.stringify(background.rows),
    );
    screenshots.push(await shot("background"));

    // 11 — closing a live tab stops its run, and the tab does not come back on
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
      lateFrame.tabCount === 0 && lateFrame.heading === "Charlie retro",
      JSON.stringify({ tabs: lateFrame.tabs, heading: lateFrame.heading }),
    );
    check(
      "the late frame still landed in the chat's own run",
      lateFrame.rows.find((row) => row.label === "Delta automation")?.live === true,
      JSON.stringify(lateFrame.rows),
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: DEFAULT_SIZE,
      screenshots,
      states: {
        landing,
        opened,
        bravoLive,
        alphaReady,
        bothLive,
        interleaved,
        bravoThread,
        finished,
        closed,
        pinned,
        archived,
        asked,
        declined,
        deleted,
        charlie,
        background,
        closedLive,
        lateFrame,
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
      ["bravo live", state.bravoLive.rowCount, state.bravoLive.tabCount, "bravo", state.bravoLive.heading, state.bravoLive.calls.length, ""],
      ["both live", state.bothLive.rowCount, state.bothLive.tabCount, "alpha + bravo", state.bothLive.heading, state.bothLive.calls.length, ""],
      ["finished", state.finished.rowCount, state.finished.tabCount, "", state.finished.heading, "", ""],
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
