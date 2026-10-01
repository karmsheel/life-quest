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
 * boundary only — see the wiring assertions in `tests/companion-shell.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-sessions.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The bottom action bar's slots, in order: two live, two reserved. */
const ACTION_SLOTS = [
  "Chat history",
  "New chat",
  "Search chats (coming soon)",
  "More chat actions (coming soon)",
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
      ? { box: box(composer), display: getComputedStyle(composer).display }
      : null,
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
    messages: Array.from(document.querySelectorAll(".chat-panel__message-content")).map((el) =>
      text(el).slice(0, 80)
    ),
    actionsBar: box(document.querySelector(".chat-panel__actions")),
    actions: Array.from(document.querySelectorAll(".chat-panel__action")).map((b) => {
      const svg = b.querySelector("svg");
      return {
        label: b.getAttribute("aria-label"),
        pressed: b.getAttribute("aria-pressed") === "true",
        disabled: b.disabled === true,
        opacity: Number(getComputedStyle(b).opacity),
        icon: svg
          ? Array.from(svg.classList)
              .filter((c) => c.indexOf("lucide-") === 0)
              .join(" ")
          : null
      };
    }),
    patchCalls: window.__lqPatchCalls ?? [],
    createCalls: window.__lqCreateCalls ?? [],
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

const last = (list) => (list.length ? list[list.length - 1] : null);

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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
      "the first two slots are live and the last two are reserved",
      JSON.stringify(landing.actions.map((slot) => slot.disabled)) ===
        JSON.stringify([false, false, true, true]),
      `disabled flags ${JSON.stringify(landing.actions.map((slot) => slot.disabled))}`,
    );
    check(
      "the slots wear four distinct icons",
      new Set(landing.actions.map((slot) => slot.icon)).size === ACTION_SLOTS.length,
      `icons ${JSON.stringify(landing.actions.map((slot) => slot.icon))}`,
    );
    check(
      "the reserved slots are dimmed, not just inert",
      landing.actions[0]?.opacity === 1 &&
        landing.actions[1]?.opacity === 1 &&
        (landing.actions[2]?.opacity ?? 1) < 1 &&
        (landing.actions[3]?.opacity ?? 1) < 1,
      `opacities ${JSON.stringify(landing.actions.map((slot) => slot.opacity))}`,
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

    // 8 — the reserved slots hold their place and do nothing; the new-chat slot
    // creates one chat through the bridge and opens its (empty) thread.
    const beforeReserved = archived.patchCalls.length + archived.createCalls.length;
    await run(
      `(document.querySelector('[aria-label="Search chats (coming soon)"]').click(),
        document.querySelector('[aria-label="More chat actions (coming soon)"]').click(),
        true)`,
    );
    const reserved = await settle();
    check(
      "the reserved slots do nothing",
      reserved.patchCalls.length + reserved.createCalls.length === beforeReserved &&
        reserved.list !== null,
      `calls ${reserved.patchCalls.length + reserved.createCalls.length} vs ${beforeReserved}, view ${reserved.list ? "list" : "thread"}`,
    );

    const newClicked = await clickAria("New chat");
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
