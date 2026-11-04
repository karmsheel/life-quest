/**
 * Proves the dock's tab strip survives an app restart: every chat that was open
 * comes back, in the same order, with the same tab in front.
 *
 * Two real Electron processes share one profile
 * (`e2e/artifacts/userdata/chat-tabs-restore`): `--phase=seed` opens three chats
 * as tabs, puts one of them in front and quits; `--phase=verify` launches the
 * same profile and reads what the dock landed on. Inside the verify process the
 * page is then reloaded a few times (a fresh renderer against the same profile)
 * to prove the reconciliation rules without paying for an Electron boot each
 * time.
 *
 * Run with the dev server up:
 *
 *   node e2e/chat-tabs-restore.electron.mjs --phase=seed
 *   node e2e/chat-tabs-restore.electron.mjs --phase=verify
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact, and the screenshots are captured by this rig's own window.
 *
 * System in isolation — the ways it can fail, written down before the assertions:
 *
 *  1. Only the last chat comes back (the reported bug): three tabs in, one tab
 *     out.
 *  2. The tabs come back in a different order, so the strip lies about what the
 *     operator had open.
 *  3. The wrong tab is in front — the operator's last click is not what the
 *     landing shows — or the heading names a different chat than the active tab.
 *  4. The remembered tab of a chat archived or deleted in Hermes Desktop while
 *     the app was shut is resurrected: a tab with no row and no thread behind it.
 *  5. The vanished front tab takes the whole strip with it, or the neighbour
 *     hand-over picks a tab that was not next to it.
 *  6. The restore writes the empty mount over the memory before reading it, so
 *     the strip is lost on the first restart (the hydrate guard).
 *  7. A deliberately closed strip resurrects: after every tab is closed, a
 *     restart reopens chats the operator put away.
 *  8. A first launch (no memory at all) restores something: zero or several
 *     tabs, or no thread at all.
 *  9. The active tab is restored but its transcript is never read, so the thread
 *     opens empty.
 * 10. The strip is restored but not drawn (one tab drawn for three remembered).
 * 11. The persisted payload lives in memory only: the second process finds no
 *     strip, i.e. storage was never flushed.
 * 12. The harness stubs the IPC bridge, not storage, so anything persisted here
 *     went through the shipping store and the shipping persistence module.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: the harness's ready signal waits on frames.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const userDataDir = path.join(artifactsDir, "userdata", "chat-tabs-restore");
const reportPath = path.join(artifactsDir, "chat-tabs-restore.json");
const baseUrl =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/chat-tabs.html";
const phase =
  (process.argv.find((arg) => arg.startsWith("--phase=")) ?? "--phase=verify")
    .slice("--phase=".length);
const isSeed = phase === "seed";

// The seed run is the app's first launch on this profile; the verify run is the
// restart. Wiping only before the seed is what makes the storage survive the
// process boundary the way a quit-and-relaunch does.
if (isSeed) fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };

/** What one read of the dock says, in the parts this rig makes claims about. */
const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const tabs = Array.from(document.querySelectorAll(".chat-panel__tab")).map((tab) => ({
    label: text(tab.querySelector(".chat-panel__tab-label")),
    active: tab.querySelector("[role=tab]")?.getAttribute("aria-selected") === "true",
  }));
  return {
    surface: document.querySelector(".chat-panel")?.getAttribute("data-chat-surface") ?? null,
    heading: text(
      document.querySelector(".chat-panel__heading--thread") ??
        document.querySelector(".chat-panel__heading")
    ),
    tabs,
    tabCount: tabs.length,
    thread: Boolean(document.querySelector(".chat-panel__header--thread")),
    // The blank "Ask Hermes" slate the thread shows when there is no chat in
    // front: a closed strip lands there, never on a history page.
    emptySlate: text(document.querySelector(".chat-panel__empty-title")),
    railLabels: Array.from(document.querySelectorAll(".chats-rail__label"))
      .map(text)
      .filter(Boolean),
    messageCalls: window.__lqMessageCalls ?? [],
    stored: window.localStorage.getItem("lifequest.companion.openTabs"),
  };
})()`;

const url = (extra = "") => {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return extra ? `${baseUrl}${separator}${extra}` : baseUrl;
};

const labels = (state) => state.tabs.map((tab) => tab.label).join(" | ");
const activeTab = (state) => state.tabs.find((tab) => tab.active)?.label ?? null;

function readStored(state) {
  try {
    const parsed = JSON.parse(state.stored ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return null;
  }
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
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 220) => {
    await wait(ms);
    return sample();
  };

  /** Load one boot of the harness and wait for its first paint. */
  const boot = async (target) => {
    await win.loadURL(target);
    win.showInactive();
    await run("window.chatTabsHarnessReady.then(() => true)");
    return settle(320);
  };

  const failures = [];
  const check = (name, ok, detail = "") => {
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `chat-tabs-restore-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return file;
  };

  const middleClickRow = (label) =>
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

  const clickTab = (label) =>
    run(`(async () => {
      const tab = Array.from(document.querySelectorAll(".chat-panel__tab")).find(
        (el) => ((el.querySelector(".chat-panel__tab-label")?.textContent) || "").trim() === ${JSON.stringify(label)}
      );
      const button = tab?.querySelector("[role=tab]");
      if (!button) return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /**
   * Archive a chat from its sidebar row, the way an operator puts a chat away.
   *
   * Archiving the chat in front closes its tab and hands the front to its
   * neighbour; archiving the last open chat opens a blank New chat instead. A
   * tab therefore reaches zero by deleting the last chat, not by archiving it.
   */
  const archiveFromSidebar = (label) =>
    run(`(async () => {
      const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
        (li) => (li.querySelector(".chats-rail__label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const menuButton = row?.querySelector(".chats-rail__menu-btn");
      if (!menuButton) return false;
      menuButton.click();
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      await frame(); await frame(); await frame();
      const item = row.querySelector('[role=menuitem][aria-label="Archive chat"]');
      if (!item) return false;
      item.click();
      await frame(); await frame(); await frame();
      return true;
    })()`);

  /**
   * Delete a chat from its sidebar row, answering the dock's own confirmation.
   * Deleting the last open chat is the gesture that leaves the strip empty.
   */
  const deleteFromSidebar = (label) =>
    run(`(async () => {
      const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
        (li) => (li.querySelector(".chats-rail__label")?.textContent || "").trim() === ${JSON.stringify(label)}
      );
      const menuButton = row?.querySelector(".chats-rail__menu-btn");
      if (!menuButton) return false;
      menuButton.click();
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      await frame(); await frame(); await frame();
      const item = row.querySelector('[role=menuitem][aria-label="Delete chat"]');
      if (!item) return false;
      item.click();
      await frame(); await frame(); await frame();
      const confirm = document.querySelector(".confirm-dialog__confirm");
      if (!confirm) return false;
      confirm.click();
      await frame(); await frame(); await frame();
      return true;
    })()`);

  /**
   * Where the run had got to, in order, for the report a watchdog has to write
   * when it kills a driver that never reaches the end.
   */
  const startedAt = Date.now();
  const marks = [];
  const mark = (label) => marks.push({ ms: Date.now() - startedAt, label });
  const states = {};

  const timeout = setTimeout(() => {
    fs.writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          phase,
          url: baseUrl,
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

  let pass = false;
  try {
    if (isSeed) {
      mark("seed:boot");
      const landing = await boot(url("keep=1"));
      states.landing = landing;
      check(
        "a profile with no memory lands on one open chat",
        landing.surface === "thread" &&
          landing.tabCount === 0 &&
          landing.heading === "Alpha planning",
        JSON.stringify({
          surface: landing.surface,
          tabCount: landing.tabCount,
          heading: landing.heading,
        }),
      );

      mark("seed:open-bravo");
      check("open Bravo in a second tab", await middleClickRow("Bravo budget"));
      const twoTabs = await settle();
      states.seededTwo = twoTabs;
      check(
        "the second tab is a second chat, not a replacement",
        labels(twoTabs) === "Alpha planning | Bravo budget",
        labels(twoTabs),
      );
      check(
        "the new tab is in front",
        activeTab(twoTabs) === "Bravo budget" && twoTabs.heading === "Bravo budget",
        `active ${activeTab(twoTabs)}, heading ${twoTabs.heading}`,
      );

      mark("seed:open-charlie");
      check("open Charlie in a third tab", await middleClickRow("Charlie retro"));
      const threeTabs = await settle();
      states.seededThree = threeTabs;
      check(
        "three chats are open as three tabs in the order they were made",
        labels(threeTabs) === "Alpha planning | Bravo budget | Charlie retro",
        labels(threeTabs),
      );

      mark("seed:front-the-first-tab");
      check("bring the first tab to the front", await clickTab("Alpha planning"));
      const seeded = await settle(320);
      states.seeded = seeded;
      check(
        "the tab in front is the chat the operator left in front",
        activeTab(seeded) === "Alpha planning" && seeded.heading === "Alpha planning",
        `active ${activeTab(seeded)}, heading ${seeded.heading}`,
      );
      const stored = readStored(seeded);
      check(
        "the strip is written to the profile before the app quits",
        stored?.tabs.join(",") === "chat-alpha,chat-bravo,chat-charlie" &&
          stored?.activeId === "chat-alpha",
        seeded.stored ?? "nothing stored",
      );
      await shot("seeded");

      // The next process is only a restart if this one's storage really reached
      // disk; flush it the way a quit does instead of trusting the next boot.
      await win.webContents.session.flushStorageData();
      mark("seed:done");
      pass = failures.length === 0;
    } else {
      mark("verify:boot");
      const restored = await boot(url("keep=1"));
      states.restored = restored;
      check(
        "every open chat comes back as a tab, in the same order",
        labels(restored) === "Alpha planning | Bravo budget | Charlie retro",
        labels(restored),
      );
      check(
        "the tab that was in front is in front again",
        activeTab(restored) === "Alpha planning" && restored.heading === "Alpha planning",
        `active ${activeTab(restored)}, heading ${restored.heading}`,
      );
      check(
        "the restored strip is drawn",
        restored.tabCount === 3 && restored.surface === "thread",
        `${restored.tabCount} tabs on ${restored.surface}`,
      );
      check(
        "the front chat's transcript is read, not left empty",
        restored.messageCalls.includes("chat-alpha"),
        JSON.stringify(restored.messageCalls),
      );
      const storedOnRestart = readStored(restored);
      check(
        "the restart found the remembered strip rather than rebuilding one",
        storedOnRestart?.tabs.join(",") === "chat-alpha,chat-bravo,chat-charlie" &&
          storedOnRestart?.activeId === "chat-alpha",
        restored.stored ?? "nothing stored",
      );
      await shot("restored");

      mark("verify:navigate");
      check("click the second restored tab", await clickTab("Bravo budget"));
      const second = await settle();
      states.second = second;
      check(
        "a restored tab still navigates",
        activeTab(second) === "Bravo budget" && second.heading === "Bravo budget",
        `active ${activeTab(second)}, heading ${second.heading}`,
      );
      check("click the third restored tab", await clickTab("Charlie retro"));
      const third = await settle(320);
      states.third = third;
      check(
        "the front tab is remembered from the last click",
        activeTab(third) === "Charlie retro" && readStored(third)?.activeId === "chat-charlie",
        `${third.stored ?? "nothing stored"}`,
      );

      // Reload with Charlie archived as if Hermes Desktop had archived it while
      // this app was shut. The renderer is fresh; the profile's memory is the
      // same one the previous boot wrote.
      mark("verify:archived-reload");
      const neighbour = await boot(url("keep=1&archived=chat-charlie"));
      states.neighbour = neighbour;
      check(
        "a remembered chat that vanished is dropped from the strip",
        labels(neighbour) === "Alpha planning | Bravo budget",
        labels(neighbour),
      );
      check(
        "the vanished front tab hands over to the tab beside it",
        activeTab(neighbour) === "Bravo budget" && neighbour.heading === "Bravo budget",
        `active ${activeTab(neighbour)}, heading ${neighbour.heading}`,
      );
      check(
        "the archived chat is gone from the sidebar too",
        !neighbour.railLabels.includes("Charlie retro"),
        JSON.stringify(neighbour.railLabels),
      );
      const reconciled = readStored(neighbour);
      check(
        "the remembered strip drops the vanished id instead of keeping a ghost",
        reconciled?.tabs.join(",") === "chat-alpha,chat-bravo" &&
          reconciled?.activeId === "chat-bravo",
        neighbour.stored ?? "nothing stored",
      );
      await shot("neighbour");

      // Put the working set away the way an operator does: archiving the front
      // chat closes its tab and hands the front to the one beside it, staying on
      // the thread; archiving the last open chat opens a blank New chat. Neither
      // leaves the thread: the dock shows the blank slate, never a history page
      // to pick another chat from — that fallback is the reported fault.
      mark("verify:archive-front-tab");
      check("archive the front chat from the sidebar", await archiveFromSidebar("Bravo budget"));
      const oneLeft = await settle(360);
      states.oneLeft = oneLeft;
      check(
        "archiving the front chat leaves the other tab open with the front",
        readStored(oneLeft)?.tabs.join(",") === "chat-alpha" &&
          readStored(oneLeft)?.activeId === "chat-alpha",
        oneLeft.stored ?? "nothing stored",
      );
      check(
        "archiving the chat takes it out of the sidebar",
        !oneLeft.railLabels.includes("Bravo budget"),
        JSON.stringify(oneLeft.railLabels),
      );
      check(
        "archiving the front chat stays on the thread",
        oneLeft.surface === "thread" && oneLeft.heading === "Alpha planning",
        `${oneLeft.surface} / ${oneLeft.heading}`,
      );

      mark("verify:archive-last-tab");
      check("archive the last open chat from the sidebar", await archiveFromSidebar("Alpha planning"));
      const blankChat = await settle(420);
      states.blankChat = blankChat;
      check(
        "archiving the last open chat leaves a blank New chat on the thread",
        blankChat.surface === "thread" &&
          blankChat.tabCount === 0 &&
          blankChat.heading === "New chat",
        JSON.stringify({
          tabs: blankChat.tabCount,
          surface: blankChat.surface,
          heading: blankChat.heading,
        }),
      );
      const blankStored = readStored(blankChat);
      check(
        "the blank New chat is the remembered strip",
        blankStored?.tabs.length === 1 &&
          blankStored?.activeId === blankStored?.tabs[0],
        blankChat.stored ?? "nothing stored",
      );
      await shot("blank-chat");

      // The other memory: a deliberately emptied strip. Deleting the last chat
      // (the blank one just opened) closes its tab and lands on the thread's
      // blank slate, and a restart must not undo that decision.
      mark("verify:delete-last-tab");
      check("delete the blank chat from the sidebar", await deleteFromSidebar("New chat"));
      const closed = await settle(360);
      states.closed = closed;
      check(
        "deleting the last open chat lands on the thread's blank slate",
        closed.tabCount === 0 &&
          closed.surface === "thread" &&
          closed.emptySlate === "Ask Hermes" &&
          closed.heading === "Chat",
        JSON.stringify({
          tabs: closed.tabCount,
          surface: closed.surface,
          heading: closed.heading,
          slate: closed.emptySlate,
        }),
      );
      const emptied = readStored(closed);
      check(
        "a deliberately closed strip is remembered as closed",
        emptied?.tabs.length === 0 && emptied?.activeId === null,
        closed.stored ?? "nothing stored",
      );

      // The last boot: same profile, full fixture again. A closed strip must stay
      // closed — the landing is the thread's blank slate, not a chat reopened
      // behind the operator's back and not a history page.
      mark("verify:closed-relaunch");
      const relaunch = await boot(url("keep=1"));
      states.relaunch = relaunch;
      check(
        "a closed strip stays closed across a restart",
        relaunch.tabCount === 0 &&
          relaunch.surface === "thread" &&
          relaunch.emptySlate === "Ask Hermes" &&
          relaunch.heading === "Chat",
        JSON.stringify({
          tabs: relaunch.tabCount,
          surface: relaunch.surface,
          heading: relaunch.heading,
          slate: relaunch.emptySlate,
        }),
      );
      check(
        "no chat is resumed over the closed strip",
        relaunch.messageCalls.length === 0,
        JSON.stringify(relaunch.messageCalls),
      );
      const emptyOnRestart = readStored(relaunch);
      check(
        "the empty strip is the memory that survived the restart",
        emptyOnRestart?.tabs.length === 0 && emptyOnRestart?.activeId === null,
        relaunch.stored ?? "nothing stored",
      );
      await shot("closed");
      mark("verify:done");
      pass = failures.length === 0;
    }
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        phase,
        url: baseUrl,
        ranAt: new Date().toISOString(),
        window: DEFAULT_SIZE,
        screenshots,
        states,
        marks,
        failures,
        pass,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`${isSeed ? "chat-tabs-restore seed" : "chat-tabs-restore verify"}: ${pass ? "pass" : "fail"}`);
  for (const failure of failures) console.error(`FAIL ${failure}`);
  for (const state of Object.entries(states)) {
    const value = state[1];
    console.log(
      `  ${state[0]}: ${value.tabCount} tabs [${labels(value)}] active ${activeTab(value)} · ${value.surface} · ${value.heading}`,
    );
  }

  app.exit(pass ? 0 : 1);
}

app.whenReady().then(main);
