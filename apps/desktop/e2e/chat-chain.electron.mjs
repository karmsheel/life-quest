/**
 * Drives the dock's chain view — the Life-Chain reached from the bottom bar —
 * in a real Electron window and turns the measurements into
 * `e2e/artifacts/chat-chain.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/chat-chain.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * The harness page is the dock's own (`e2e/chat-sessions.html`) — this is a
 * second driver for the same component, not a second page. What it measures
 * that no source-text test could: where the chain stack actually sits, the order
 * its rows paint in, and that a signal logged here is on screen afterwards
 * without the user touching the scrollbar.
 *
 * NOT covered here: the vault itself. The rig answers from
 * `fixtures/signal-chain.json` through the same bridge calls the main process
 * exposes, so "the write reached disk" is asserted at the bridge boundary only.
 * The file layer below it is not asserted anywhere: this repo's suite is
 * E2E-only, and no rig opens a real vault.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
// Its own profile: the dock resumes `localStorage` state between runs, and the
// session rigs share this panel. Sharing one cache makes a landing-view check
// depend on whichever rig ran last.
app.setPath("userData", path.join(artifactsDir, "userdata", "chat-chain"));

const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-sessions.html";
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
  const style = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
  const panel = document.querySelector(".chat-panel");
  const chainBody = document.querySelector(".chat-panel__body--chain");
  const chatBody = document.querySelector(".chat-panel__body:not(.chat-panel__body--chain)");
  const chainList = document.querySelector(".chat-panel__chain-list");
  const items = Array.from(document.querySelectorAll(".chat-panel__chain-item"));
  const field = document.querySelector('[aria-label="Log a signal"]');
  const chatField = document.querySelector('[aria-label="Message Hermes"]');
  const send = document.querySelector(".chat-panel__send");
  const footer = document.querySelector(".chat-panel__footer");

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panel: box(panel),
    heading: text(document.querySelector(".chat-panel__heading")),
    threadHeader: Boolean(document.querySelector(".chat-panel__header--thread")),
    chatListPresent: document.querySelector(".chat-panel__list") !== null,
    chatBody: chatBody
      ? { box: box(chatBody), display: style(chatBody, "display"), hidden: chatBody.hidden }
      : null,
    chainBody: chainBody
      ? {
          box: box(chainBody),
          display: style(chainBody, "display"),
          hidden: chainBody.hidden,
          clientHeight: chainBody.clientHeight,
          scrollHeight: chainBody.scrollHeight,
          scrollTop: Math.round(chainBody.scrollTop),
          overflowY: style(chainBody, "overflowY"),
          paddingTop: parseFloat(style(chainBody, "paddingTop")) || 0,
          paddingBottom: parseFloat(style(chainBody, "paddingBottom")) || 0
        }
      : null,
    chainList: chainList
      ? {
          box: box(chainList),
          direction: style(chainList, "flexDirection"),
          marginTop: style(chainList, "marginTop"),
          position: style(chainList, "position"),
          // The thread is the list's ::before: a computed style on a pseudo is
          // the only handle a driver has on a decoration that is not an element.
          thread: (() => {
            const line = getComputedStyle(chainList, "::before");
            return {
              borderStyle: line.borderLeftStyle,
              borderWidth: parseFloat(line.borderLeftWidth) || 0,
              left: parseFloat(line.left) || 0,
              top: parseFloat(line.top) || 0,
              bottom: parseFloat(line.bottom) || 0,
              content: line.content
            };
          })()
        }
      : null,
    // DOM order, which for this list is top-to-bottom on screen: oldest first.
    items: items.map((li) => {
      const stamp = li.querySelector(".chat-panel__chain-stamp");
      const message = li.querySelector(".chat-panel__chain-message");
      const assign = li.querySelector(".chat-panel__chain-assign");
      const menuBtn = li.querySelector(".chat-panel__chain-menu-btn");
      const edit = li.querySelector(".chat-panel__chain-edit-input");
      return {
        body: text(li.querySelector(".chat-panel__chain-body")),
        title: text(li.querySelector(".chat-panel__chain-title")),
        day: text(li.querySelector(".chat-panel__chain-stamp-day")),
        time: text(li.querySelector(".chat-panel__chain-stamp-time")),
        assign: assign
          ? {
              value: assign.value,
              options: Array.from(assign.options).map((o) => o.value),
              disabled: assign.disabled === true
            }
          : null,
        menu: menuBtn
          ? {
              present: true,
              expanded: menuBtn.getAttribute("aria-expanded") === "true",
              items: Array.from(li.querySelectorAll('[role="menuitem"]')).map((b) => text(b))
            }
          : { present: false },
        editing: Boolean(edit),
        editValue: edit ? edit.value : null,
        box: box(li),
        stamp: box(stamp),
        message: box(message),
        assignBox: box(assign),
        // The two blocks have to differ in colour, not merely in text: the date
        // box is the grey one, and a rig that samples both is how that is said.
        stampBackground: stamp ? getComputedStyle(stamp).backgroundColor : null,
        messageBackground: message ? getComputedStyle(message).backgroundColor : null
      };
    }),
    empty: text(document.querySelector(".chat-panel__chain-empty")),
    field: field
      ? {
          present: true,
          box: box(field),
          value: field.value,
          disabled: field.disabled === true,
          placeholder: field.getAttribute("placeholder"),
          rows: field.getAttribute("rows")
        }
      : { present: false },
    chatField: chatField ? { present: true, box: box(chatField), value: chatField.value } : { present: false },
    send: send
      ? {
          present: true,
          box: box(send),
          disabled: send.disabled === true,
          label: send.getAttribute("aria-label"),
          state: send.getAttribute("data-state"),
          type: send.getAttribute("type")
        }
      : { present: false },
    footer: footer ? { box: box(footer), hidden: footer.hidden } : null,
    actionsBar: box(document.querySelector(".chat-panel__actions")),
    actions: Array.from(document.querySelectorAll(".chat-panel__action")).map((b) => ({
      label: b.getAttribute("aria-label"),
      pressed: b.getAttribute("aria-pressed") === "true",
      disabled: b.disabled === true
    })),
    // Painted bubbles only: the thread's bubbles stay in the DOM while another
    // surface is up (the body is hidden, not unmounted), and a display:none row
    // has a 0x0 box — counting nodes reports a transcript that is not on screen.
    transcript: Array.from(document.querySelectorAll(".chat-panel__message-content"))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => text(el).slice(0, 60)),
    createCalls: window.__lqSignalCreateCalls ?? [],
    updateCalls: window.__lqSignalUpdateCalls ?? [],
    deleteCalls: window.__lqSignalDeleteCalls ?? [],
    signalListCalls: window.__lqSignalListCalls ?? 0,
    messageCalls: window.__lqMessageCalls ?? [],
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run(SAMPLE);
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  /**
   * Poll for the state the last action should produce, and name the predicate
   * that never came true. A fixed sleep reads as a product bug when it is only a
   * slow render, so every wait carries its own deadline.
   */
  const waitFor = async (predicate, label, ms = 6000) => {
    const deadline = Date.now() + ms;
    let state = await sample();
    while (!predicate(state)) {
      if (Date.now() > deadline) {
        failures.push(`${label}: never came true within ${ms}ms`);
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      state = await sample();
    }
    return state;
  };

  const clickAria = (label) =>
    run(`(() => {
      const el = document.querySelector('[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Type into a React-controlled field the way a person does. */
  const typeInto = (selector, value) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

  const pressEnter = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return true;
    })()`);

  /** Click the nth element matching a selector, in DOM order. */
  const click = (selector, index = 0) =>
    run(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Pick an option the way a person does: set the value, fire the event React listens for. */
  const selectOption = (selector, index, value) =>
    run(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);

  /** Click the button with this visible text inside a container. */
  const clickText = (selector, label) =>
    run(`(() => {
      const target = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .find((b) => ((b.textContent || "").trim()) === ${JSON.stringify(label)});
      if (!target) return false;
      target.click();
      return true;
    })()`);

  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `chat-chain-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    return file;
  };

  /**
   * Every item in DOM order, top strictly increasing = the DOM order is the
   * order the rows paint in, oldest first.
   */
  const descendsOnScreen = (items) =>
    items.every((item, index) => index === 0 || item.box.top > items[index - 1].box.top - 0.5);

  /** How far apart two `rgb(...)`/`rgba(...)` colours are, per channel. */
  const channelDelta = (a, b) => {
    const parse = (value) => String(value ?? "").match(/[\d.]+/g)?.map(Number) ?? [];
    const [x, y] = [parse(a), parse(b)];
    if (x.length < 3 || y.length < 3) return 0;
    return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]));
  };

  let report;
  const screenshots = [];
  const timeout = setTimeout(() => {
    console.error("chat-chain: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    const expected = await run("window.chatHarnessSignals");

    // 1 — the dock still lands on a thread; the chain is not up and has not
    // been read yet.
    const landing = await waitFor(
      (state) => state.threadHeader && state.heading && state.chatField.present,
      "the dock lands on a thread",
    );
    check("the dock landed on a thread", landing.threadHeader, `heading "${landing.heading}"`);
    check(
      "the thread's transcript paints before the chain is up",
      landing.transcript.length > 0,
      `${landing.transcript.length} painted bubbles on landing`,
    );
    check(
      "the chain is not up on landing",
      landing.chainBody !== null &&
        landing.chainBody.hidden === true &&
        landing.chainBody.display === "none",
      `chain body ${JSON.stringify(landing.chainBody)}`,
    );
    check(
      "the chain was not read before it was asked for",
      landing.signalListCalls === 0,
      `${landing.signalListCalls} list calls`,
    );
    check(
      "the chain slot is live on landing, and not marked active",
      landing.actions[3]?.disabled === false && landing.actions[3]?.pressed === false,
      `slot ${JSON.stringify(landing.actions[3])}`,
    );

    // 2 — the slot swaps the panel to the chain and reads it.
    const clicked = await clickAria("Life-Chain");
    const chain = await waitFor(
      (state) => state.chainBody?.hidden === false && state.items.length === expected.total,
      "the chain view lists every signal",
    );
    check("clicked the Life-Chain slot", clicked, "no Life-Chain slot in the bottom bar");
    check(
      "the chain header names the surface",
      chain.heading === "Life-Chain",
      `heading "${chain.heading}"`,
    );
    check(
      "the chain slot is marked active, and history is not",
      chain.actions[3]?.pressed === true && chain.actions[0]?.pressed === false,
      `slots ${JSON.stringify(chain.actions.map((slot) => [slot.label, slot.pressed]))}`,
    );
    check(
      "the chat transcript is gone while the chain is up",
      chain.chatBody?.hidden === true &&
        chain.chatBody?.display === "none" &&
        chain.transcript.length === 0,
      `chat body ${JSON.stringify(chain.chatBody)}, ${chain.transcript.length} bubbles`,
    );
    check(
      "the chat field is not mounted behind the chain's",
      chain.chatField.present === false && chain.field.present === true,
      `chat field ${chain.chatField.present}, chain field ${chain.field.present}`,
    );
    check(
      "the chain field is empty, enabled and labelled",
      chain.field.value === "" &&
        chain.field.disabled === false &&
        chain.field.placeholder === "Log a signal…",
      `field ${JSON.stringify(chain.field)}`,
    );
    check(
      "the send control is absent until there is something to log",
      chain.send.present === false,
      `send ${JSON.stringify(chain.send)}`,
    );
    check(
      "every signal is on the chain, exactly once",
      chain.items.length === expected.total,
      `${chain.items.length} rows vs ${expected.total} in the fixture`,
    );
    check(
      "the DOM runs oldest first, newest last",
      chain.items[0]?.body === expected.oldestBody &&
        chain.items[chain.items.length - 1]?.body === expected.newestBody,
      `first "${chain.items[0]?.body?.slice(0, 40)}" vs oldest "${expected.oldestBody.slice(0, 40)}"`,
    );
    check(
      "the list is a plain column, so the DOM order is the reading order",
      chain.chainList?.direction === "column",
      `flex-direction ${chain.chainList?.direction}`,
    );
    check(
      "on screen the chain reads top-down, oldest first",
      descendsOnScreen(chain.items),
      chain.items
        .map((item, index) => `${index}:${item.box.top}`)
        .join(" "),
    );
    check(
      "the chain fills past the panel, so it is a scroller",
      (chain.chainBody?.scrollHeight ?? 0) > (chain.chainBody?.clientHeight ?? 0) &&
        chain.chainBody?.overflowY === "auto",
      `scroll ${chain.chainBody?.scrollHeight}px in ${chain.chainBody?.clientHeight}px, overflow ${chain.chainBody?.overflowY}`,
    );
    check(
      "the chain opens with the scroll on the newest entry",
      Math.abs(
        (chain.chainBody?.scrollTop ?? 0) +
          (chain.chainBody?.clientHeight ?? 0) -
          (chain.chainBody?.scrollHeight ?? 0),
      ) <= 2,
      `scrollTop ${chain.chainBody?.scrollTop} + ${chain.chainBody?.clientHeight} vs scrollHeight ${chain.chainBody?.scrollHeight}`,
    );
    check(
      "the newest signal is on screen, above the composer",
      (chain.items[chain.items.length - 1]?.box.top ?? 0) >= (chain.chainBody?.box.top ?? 0) - 1 &&
        (chain.items[chain.items.length - 1]?.box.bottom ?? 0) <=
          (chain.chainBody?.box.bottom ?? 0) + 1,
      `newest ${JSON.stringify(chain.items[chain.items.length - 1]?.box)} in the body ${JSON.stringify(chain.chainBody?.box)}`,
    );
    check(
      "the oldest signal is scrolled out above the fold",
      (chain.items[0]?.box.bottom ?? 0) < (chain.chainBody?.box.top ?? 0) + 1,
      `oldest ends at ${chain.items[0]?.box.bottom}px, body starts at ${chain.chainBody?.box.top}px`,
    );
    check(
      "the chain composer sits above the action bar",
      (chain.footer?.box.bottom ?? 0) <= (chain.actionsBar?.top ?? 0) + 1,
      `composer ends at ${chain.footer?.box.bottom}px, bar starts at ${chain.actionsBar?.top}px`,
    );
    const oldestRow = chain.items[0];
    const newestRow = chain.items[chain.items.length - 1];
    check(
      "the newest row's date box is on screen with its message",
      (newestRow?.stamp.top ?? 0) >= (chain.chainBody?.box.top ?? 0) - 1 &&
        (newestRow?.stamp.bottom ?? 0) <= (chain.chainBody?.box.bottom ?? 0) + 1,
      `newest stamp ${JSON.stringify(newestRow?.stamp)} in the body ${JSON.stringify(chain.chainBody?.box)}`,
    );
    check(
      "each row is two blocks: the date stamp beside the message",
      chain.items.every(
        (item) => item.stamp && item.message && item.stamp.right <= item.message.left + 1,
      ),
      `first row stamp ${JSON.stringify(oldestRow.stamp)} message ${JSON.stringify(oldestRow.message)}`,
    );
    check(
      "the date block is the square one",
      chain.items.every(
        (item) => Math.abs(item.stamp.width - item.stamp.height) <= 2 && item.stamp.width >= 44,
      ),
      `stamps ${JSON.stringify(chain.items.slice(0, 3).map((item) => [item.stamp.width, item.stamp.height]))}`,
    );
    check(
      "the date block is the grey one",
      chain.items.every(
        (item) => channelDelta(item.stampBackground, item.messageBackground) >= 8,
      ),
      `stamp ${oldestRow.stampBackground} vs message ${oldestRow.messageBackground}`,
    );
    check(
      "the stamp carries the date over the time",
      chain.items.every((item) => item.day.length > 0 && /\d/.test(item.time)),
      `stamps ${JSON.stringify(chain.items.slice(0, 3).map((item) => [item.day, item.time]))}`,
    );
    check(
      "the assignment picker sits under the message box, not under the rail",
      chain.items.every(
        (item) =>
          item.assignBox !== null &&
          item.assignBox.top >= item.message.bottom - 1 &&
          Math.abs(item.assignBox.left - item.message.left) <= 1,
      ),
      `first row assign ${JSON.stringify(oldestRow.assignBox)} under message ${JSON.stringify(oldestRow.message)}`,
    );
    check(
      "the picker offers unassigned and the live domains, and no archived one",
      chain.items.every(
        (item) =>
          item.assign?.options.join(",") === expected.assignOptions.join(",") &&
          !(item.assign?.options ?? []).includes(expected.archivedDomain),
      ) &&
        chain.items.filter((item) => item.assign?.value === expected.domainSlug).length === 1,
      `options ${JSON.stringify(chain.items[0]?.assign?.options)} vs ${JSON.stringify(expected.assignOptions)}, values ${JSON.stringify(chain.items.map((item) => item.assign?.value))}`,
    );
    check(
      "the dashed line runs down the rail, through every date box, thicker than a hairline",
      chain.chainList?.position === "relative" &&
        chain.chainList?.thread?.borderStyle === "dashed" &&
        chain.chainList.thread.borderWidth > 1 &&
        chain.chainList.thread.borderWidth <= 3 &&
        chain.chainList.thread.top === 0 &&
        chain.chainList.thread.bottom === 0 &&
        // The line is positioned against the list, the stamps against the
        // window: compare them in the list's own frame or this says nothing.
        chain.items.every(
          (item) =>
            chain.chainList.thread.left >= item.stamp.left - (chain.chainList?.box.left ?? 0) &&
            chain.chainList.thread.left <= item.stamp.right - (chain.chainList?.box.left ?? 0),
        ),
      `thread ${JSON.stringify(chain.chainList?.thread)} vs stamps ${JSON.stringify(
        chain.items
          .slice(0, 2)
          .map((item) => [
            item.stamp.left - (chain.chainList?.box.left ?? 0),
            item.stamp.right - (chain.chainList?.box.left ?? 0),
          ]),
      )}`,
    );
    check(
      "the line is one unbroken run: it spans the list the stamps live in",
      (chain.chainList?.box.top ?? 0) <= (oldestRow.stamp.top ?? 0) + 1 &&
        (chain.chainList?.box.bottom ?? 0) >=
          (chain.items[chain.items.length - 1]?.stamp.bottom ?? 0) - 1,
      `list ${JSON.stringify(chain.chainList?.box)}, stamps ${oldestRow.stamp.top}..${chain.items[chain.items.length - 1]?.stamp.bottom}`,
    );
    // The 3-dot control opens on its own row, carries both actions, and closes.
    const menuOpened = await click(".chat-panel__chain-menu-btn", 1);
    const menu = await waitFor(
      (state) => state.items[1]?.menu.expanded === true,
      "the row menu opens",
    );
    check(
      "the 3-dot control opens a menu on the message it belongs to",
      menuOpened &&
        menu.items[1]?.menu.items.join("/") === "Edit/Delete" &&
        menu.items.filter((item) => item.menu.expanded).length === 1,
      `menus ${JSON.stringify(menu.items.map((item) => [item.menu.expanded, item.menu.items]))}`,
    );
    await click(".chat-panel__chain-menu-btn", 1);
    const menuClosed = await waitFor(
      (state) => state.items[1]?.menu.expanded === false,
      "the row menu closes",
    );
    check(
      "the same control closes it again, without writing",
      menuClosed.items.every((item) => item.menu.expanded === false) &&
        menuClosed.updateCalls.length === 0 &&
        menuClosed.deleteCalls.length === 0,
      `${menuClosed.items.filter((item) => item.menu.expanded).length} menus open, ${menuClosed.updateCalls.length} updates`,
    );
    check(
      "nothing spills past the window",
      chain.overflow.scrollWidth <= chain.overflow.clientWidth,
      `${chain.overflow.scrollWidth}px vs ${chain.overflow.clientWidth}px`,
    );
    screenshots.push(await shot("overflow"));

    // 3 — logging writes through the bridge, and what was written is on screen
    // afterwards without touching the scrollbar.
    await typeInto('[aria-label="Log a signal"]', "Buy the standing desk before Monday");
    const typed = await waitFor(
      (state) => state.send.present === true,
      "the send control appears with a draft",
    );
    check(
      "the send control appears with a draft and is armed",
      typed.send.present === true &&
        typed.send.disabled === false &&
        typed.send.type === "submit" &&
        typed.send.state === "send",
      `send ${JSON.stringify(typed.send)}`,
    );
    await clickAria("Log signal");
    const logged = await waitFor(
      (state) => state.createCalls.length === 1 && state.items.length === expected.total + 1,
      "the logged signal is on the chain",
    );
    check(
      "the log reached the bridge as a thought with no title and no domain",
      JSON.stringify(logged.createCalls[0]) ===
        JSON.stringify({
          type: "thought",
          title: null,
          body: "Buy the standing desk before Monday",
          domainSlug: null,
        }),
      `bridge saw ${JSON.stringify(logged.createCalls[0])}`,
    );
    check(
      "the chain was re-read after the write",
      logged.signalListCalls === landing.signalListCalls + 2,
      `${logged.signalListCalls} list calls`,
    );
    check(
      "the logged signal is the newest, and on screen",
      logged.items[logged.items.length - 1]?.body === "Buy the standing desk before Monday" &&
        (logged.items[logged.items.length - 1]?.box.top ?? 0) >= (logged.chainBody?.box.top ?? 0) - 1 &&
        (logged.items[logged.items.length - 1]?.box.bottom ?? 0) <=
          (logged.chainBody?.box.bottom ?? 0) + 1,
      `last ${JSON.stringify(logged.items[logged.items.length - 1])}`,
    );
    check(
      "the field cleared, and the control went with it",
      logged.field.value === "" && logged.send.present === false,
      `field "${logged.field.value}", send ${logged.send.present}`,
    );
    check(
      "logging a signal sent no chat traffic",
      logged.messageCalls.length === landing.messageCalls.length,
      `message calls ${logged.messageCalls.length} vs ${landing.messageCalls.length}`,
    );
    screenshots.push(await shot("logged"));

    // 4 — Enter logs too. The dock reuses the Life-Chain page's own key handler,
    // so a composing keystroke or a held-down repeat cannot submit on its own.
    await typeInto('[aria-label="Log a signal"]', "Ask the accountant about the VAT window");
    await waitFor(
      (state) => state.send.present === true,
      "the send control appears before pressing Enter",
    );
    const enterPressed = await pressEnter('[aria-label="Log a signal"]');
    const entered = await waitFor(
      (state) => state.createCalls.length === 2,
      "Enter logs the signal",
    );
    check("dispatched Enter on the field", enterPressed, "no chain field to type into");
    check(
      "Enter logs without the button",
      entered.createCalls[1]?.body === "Ask the accountant about the VAT window" &&
        entered.items[entered.items.length - 1]?.body === "Ask the accountant about the VAT window",
      `bridge saw ${JSON.stringify(entered.createCalls[1])}`,
    );

    // 5 — the row's own controls. The 3-dot menu's Edit and Delete, and the
    // assignment picker, each write through the same bridge calls the page uses.
    const loggedRows = expected.total + 2;
    const afterDelete = loggedRows - 1;
    const editedBody = "Rewritten: the migration fails when two writes share a second";
    await click(".chat-panel__chain-menu-btn", 0);
    await waitFor(
      (state) => state.items[0]?.menu.expanded === true,
      "the 3-dot menu opens on the oldest row",
    );
    const editClicked = await clickAria("Edit signal");
    const editing = await waitFor(
      (state) => state.items[0]?.editing === true,
      "the row opens its editor",
    );
    check(
      "Edit opens the row's own text, in the message box",
      editClicked &&
        editing.items[0]?.editValue === expected.oldestBody &&
        editing.items[0]?.message !== null &&
        editing.items[0]?.stamp !== null,
      `editor "${String(editing.items[0]?.editValue).slice(0, 40)}", message ${JSON.stringify(editing.items[0]?.message)}`,
    );
    // Cancel first: the way out has to leave the record alone.
    const cancelClicked = await clickText(".chat-panel__chain-edit-actions button", "Cancel");
    const cancelled = await waitFor(
      (state) => state.items[0]?.editing === false,
      "the editor closes",
    );
    check(
      "Cancel leaves the row as it was, and writes nothing",
      cancelClicked &&
        cancelled.items[0]?.body === expected.oldestBody &&
        cancelled.updateCalls.length === 0,
      `body "${cancelled.items[0]?.body?.slice(0, 40)}", ${cancelled.updateCalls.length} updates`,
    );
    await click(".chat-panel__chain-menu-btn", 0);
    await waitFor(
      (state) => state.items[0]?.menu.expanded === true,
      "the 3-dot menu opens again",
    );
    await clickAria("Edit signal");
    await waitFor((state) => state.items[0]?.editing === true, "the editor opens again");
    await typeInto(".chat-panel__chain-edit-input", editedBody);
    const saveClicked = await clickText(".chat-panel__chain-edit-actions button", "Save");
    const saved = await waitFor(
      (state) => state.items[0]?.body === editedBody && state.items[0]?.editing === false,
      "the edit lands on the chain",
    );
    check(
      "Save wrote the edit as a body patch on that signal",
      saveClicked &&
        JSON.stringify(saved.updateCalls[0]) ===
          JSON.stringify({ id: expected.oldestId, patch: { body: editedBody } }),
      `bridge saw ${JSON.stringify(saved.updateCalls[0])}`,
    );
    check(
      "the edited row keeps its place, and the chain its length",
      saved.items.length === loggedRows && saved.items[0]?.body === editedBody,
      `${saved.items.length} rows of ${loggedRows}, first "${saved.items[0]?.body?.slice(0, 30)}"`,
    );
    // The picker under the message box, writing the domain.
    const assignPicked = await selectOption(".chat-panel__chain-assign", 0, expected.domainSlug);
    const assigned = await waitFor(
      (state) => state.items[0]?.assign?.value === expected.domainSlug,
      "the picked domain sticks",
    );
    check(
      "the picker wrote the domain through the bridge",
      assignPicked &&
        JSON.stringify(assigned.updateCalls[1]) ===
          JSON.stringify({ id: expected.oldestId, patch: { domainSlug: expected.domainSlug } }),
      `bridge saw ${JSON.stringify(assigned.updateCalls[1])}`,
    );
    check(
      "the picker shows what the record now holds",
      assigned.items.filter((item) => item.assign?.value === expected.domainSlug).length === 2,
      `values ${JSON.stringify(assigned.items.map((item) => item.assign?.value))}`,
    );
    // Delete, from the newest row's own menu.
    const doomedBody = assigned.items[assigned.items.length - 1]?.body;
    await click(".chat-panel__chain-menu-btn", assigned.items.length - 1);
    await waitFor(
      (state) => state.items[state.items.length - 1]?.menu.expanded === true,
      "the 3-dot menu opens on the newest row",
    );
    const deleteClicked = await clickAria("Delete signal");
    // The delete asks through the dock's own confirm dialog, so the bridge call
    // only follows the answer.
    const deleteConfirmed = await click(".confirm-dialog__confirm");
    const deleted = await waitFor(
      (state) => state.deleteCalls.length === 1 && state.items.length === afterDelete,
      "the deleted signal leaves the chain",
    );
    check("clicked Delete in a row menu", deleteClicked, "no Delete entry in the menu");
    check(
      "the delete asked, and answering it reached the bridge",
      deleteConfirmed,
      "no confirm dialog opened, or no control to answer it",
    );
    check(
      "Delete reached the bridge with the id of the row it was opened from",
      deleted.deleteCalls[0]?.body === doomedBody && Boolean(deleted.deleteCalls[0]?.id),
      `bridge saw ${JSON.stringify(deleted.deleteCalls[0])} for "${String(doomedBody).slice(0, 30)}"`,
    );
    check(
      "that row is gone, and only that row",
      deleted.items.length === afterDelete &&
        !deleted.items.some((item) => item.body === doomedBody) &&
        deleted.items[0]?.body === editedBody,
      `${deleted.items.length} rows, "${String(doomedBody).slice(0, 30)}" present ${deleted.items.some((item) => item.body === doomedBody)}`,
    );
    check(
      "the row menu closed with the delete",
      deleted.items.every((item) => item.menu.expanded === false),
      `${deleted.items.filter((item) => item.menu.expanded).length} menus open`,
    );
    screenshots.push(await shot("row-controls"));

    // 6 — a short chain rests on the composer instead of hanging from the top.
    await clickAria("Life-Chain");
    const backToThread = await waitFor(
      (state) => state.threadHeader && state.chatField.present === true,
      "the Life-Chain slot toggles back to the thread",
    );
    check(
      "the chain slot toggles the panel back",
      backToThread.chainBody?.hidden === true && backToThread.chatField.present === true,
      `chain body hidden ${backToThread.chainBody?.hidden}, chat field ${backToThread.chatField.present}`,
    );
    await run("window.__lqSignalLimit = 3");
    await clickAria("Life-Chain");
    const short = await waitFor(
      (state) => state.chainBody?.hidden === false && state.items.length === 3,
      "the short chain lists three signals",
    );
    check(
      "a chain that fits is not a scroller",
      (short.chainBody?.scrollHeight ?? 0) <= (short.chainBody?.clientHeight ?? 0),
      `scroll ${short.chainBody?.scrollHeight}px in ${short.chainBody?.clientHeight}px`,
    );
    const shortListBottom = short.chainList?.box.bottom ?? 0;
    const shortBodyBottom = short.chainBody?.box.bottom ?? 0;
    const shortPadBottom = short.chainBody?.paddingBottom ?? 0;
    check(
      "the short chain rests on the composer",
      Math.abs(shortListBottom - (shortBodyBottom - shortPadBottom)) <= 2,
      `list ends at ${shortListBottom}px, body content ends at ${shortBodyBottom - shortPadBottom}px`,
    );
    check(
      "and the space it is growing into is above it",
      (short.chainList?.box.top ?? 0) > (short.chainBody?.box.top ?? 0) + (short.chainBody?.paddingTop ?? 0) + 8,
      `list starts at ${short.chainList?.box.top}px, body content starts at ${(short.chainBody?.box.top ?? 0) + (short.chainBody?.paddingTop ?? 0)}px`,
    );
    check(
      "the short chain still reads top-down",
      descendsOnScreen(short.items),
      short.items.map((item, index) => `${index}:${item.box.top}`).join(" "),
    );
    check(
      "logging gained no signal on the re-read",
      short.items.length === 3 && short.createCalls.length === 2,
      `${short.items.length} rows, ${short.createCalls.length} creates`,
    );
    screenshots.push(await shot("short"));

    // 7 — the chat list is still one click away, and the chain's own read is
    // what puts the logged signals back on screen.
    await run("window.__lqSignalLimit = null");
    const historyClicked = await clickAria("Chat history");
    const chatList = await waitFor(
      (state) => state.chatListPresent === true,
      "the chats list opens from the chain",
    );
    check("clicked Chat history", historyClicked, "no Chat history slot");
    check(
      "the chats list replaces the chain",
      chatList.chatListPresent === true && chatList.chainBody?.hidden === true,
      `list ${chatList.chatListPresent}, chain hidden ${chatList.chainBody?.hidden}`,
    );
    check(
      "the chats list did not ask for the chain",
      chatList.signalListCalls === short.signalListCalls,
      `${chatList.signalListCalls} list calls vs ${short.signalListCalls}`,
    );

    await clickAria("Life-Chain");
    const reread = await waitFor(
      (state) => state.chainBody?.hidden === false && state.items.length === afterDelete,
      "the chain re-reads both logged signals",
    );
    check(
      "a fresh read carries the writes, and drops the deleted signal",
      reread.items[reread.items.length - 1]?.body === "Buy the standing desk before Monday" &&
        reread.items.some(
          (item) => item.body === "Ask the accountant about the VAT window",
        ) === false &&
        reread.items[0]?.body === editedBody,
      `last "${reread.items[reread.items.length - 1]?.body?.slice(0, 40)}", first "${reread.items[0]?.body?.slice(0, 40)}"`,
    );
    check(
      "the read carries the writes: the edited body and the assigned domain survive it",
      reread.items[0]?.assign?.value === expected.domainSlug,
      `oldest row domain "${reread.items[0]?.assign?.value}"`,
    );
    check(
      "re-reading did not write anything",
      reread.createCalls.length === 2 &&
        reread.updateCalls.length === 2 &&
        reread.deleteCalls.length === 1,
      `${reread.createCalls.length} creates, ${reread.updateCalls.length} updates, ${reread.deleteCalls.length} deletes`,
    );
    screenshots.push(await shot("reread"));

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      fixture: expected,
      states: {
        landing,
        chain,
        typed,
        logged,
        entered,
        editing,
        cancelled,
        saved,
        assigned,
        deleted,
        backToThread,
        short,
        chatList,
        reread,
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

  const reportFile = path.join(artifactsDir, "chat-chain.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const states = report.states;
  if (states) {
    const table = [["state", "view", "rows", "body h", "scroll h", "newest top", "list top", "list bottom", "creates", "newest stamp"]];
    const rows = [
      ["landing", states.landing],
      ["chain (overflow)", states.chain],
      ["with a draft", states.typed],
      ["logged", states.logged],
      ["enter-logged", states.entered],
      ["editing", states.editing],
      ["cancelled", states.cancelled],
      ["edited + assigned", states.saved],
      ["assigned", states.assigned],
      ["deleted", states.deleted],
      ["chain (short)", states.short],
      ["chat list", states.chatList],
      ["re-read", states.reread],
    ];
    for (const [name, state] of rows) {
      const items = state.items ?? [];
      const newest = items[items.length - 1];
      table.push([
        name,
        state.threadHeader ? "thread" : state.chatListPresent ? "list" : state.chainBody?.hidden === false ? "chain" : "—",
        String(items.length),
        String(state.chainBody?.clientHeight ?? "—"),
        String(state.chainBody?.scrollHeight ?? "—"),
        String(newest ? newest.box.top : "—"),
        String(state.chainList?.box.top ?? "—"),
        String(state.chainList?.box.bottom ?? "—"),
        String((state.createCalls ?? []).length),
        newest ? `${newest.day} ${newest.time}` : "—",
      ]);
    }
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
    for (const row of table) console.log(format(row));
    console.log("");
  }
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat chain: PASS" : "chat chain: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-chain: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
